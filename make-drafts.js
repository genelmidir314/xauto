require("dotenv").config();
const { Pool } = require("pg");
const { inspectStoredMedia } = require("./x-media-upload");
const { ensureTweetMediaValidationSchema } = require("./tweet-media-validation");
const {
  COMMENT_TRANSLATION_FORMAT_KEY,
  COMMENT_TRANSLATION_SOURCE_LINK_FORMAT_KEY,
} = require("./draft-format");

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL yok");
  process.exit(1);
}

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const FALLBACK_LINK_SCORE_THRESHOLD = Number(
  process.env.FALLBACK_LINK_SCORE_THRESHOLD || 80
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function cleanupTweetText(text) {
  let t = String(text || "").trim();

  // RT prefix kaldır
  t = t.replace(/^RT\s+@[\w_]+:\s*/i, "");

  // t.co linkleri kaldır
  t = t.replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/gi, "");

  // fazla boşlukları toparla
  t = t.replace(/\s+/g, " ").trim();

  return t;
}

function looksTurkish(text) {
  const s = String(text || "");
  return /[çğıöşüÇĞİÖŞÜ]/.test(s) || /\b(ve|bir|bu|çok|ama|gibi|neden|nasıl|mi|mı|mu|mü)\b/i.test(s);
}

function scoreVirality(sourceHandle, text, hasMedia) {
  let score = 50;
  const reasons = [];

  const t = cleanupTweetText(text);
  const h = String(sourceHandle || "").toLowerCase();

  if (hasMedia) {
    score += 20;
    reasons.push("media");
  }

  if (t.length >= 25 && t.length <= 180) {
    score += 10;
    reasons.push("ideal_length");
  }

  if (/\?/.test(t)) {
    score += 5;
    reasons.push("question");
  }

  if (/\d/.test(t)) {
    score += 5;
    reasons.push("numbers");
  }

  if (
    h.includes("futbol") ||
    h.includes("football") ||
    h.includes("espn") ||
    h.includes("goal") ||
    h.includes("433")
  ) {
    score += 10;
    reasons.push("sports");
  }

  if (
    h.includes("rainmaker") ||
    h.includes("history") ||
    h.includes("figen")
  ) {
    score += 8;
    reasons.push("viral_source");
  }

  if (
    h.includes("karpathy") ||
    h.includes("sama") ||
    h.includes("ylecun")
  ) {
    score += 6;
    reasons.push("tech_source");
  }

  if (score > 100) score = 100;
  if (score < 0) score = 0;

  return {
    score,
    reason: reasons.join(", "),
  };
}

async function openaiChat(systemPrompt, userPrompt, temperature = 0.4) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY yok");
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  const textBody = await res.text();
  let json = null;
  try {
    json = JSON.parse(textBody);
  } catch (_) {}

  if (!res.ok) {
    throw new Error(`OpenAI hata ${res.status}: ${textBody.slice(0, 500)}`);
  }

  const out = String(json?.choices?.[0]?.message?.content || "").trim();
  if (!out) {
    throw new Error("OpenAI boş cevap döndü");
  }

  return out;
}

async function translateToTurkish(text) {
  const input = cleanupTweetText(text);

  console.log("TRANSLATE INPUT:", input);

  if (!input) {
    console.log("OPENAI RESULT [translation]: [empty input]");
    return "";
  }

  if (looksTurkish(input)) {
    console.log("OPENAI RESULT [translation]: [already turkish]");
    return input;
  }

  if (!OPENAI_API_KEY) {
    console.log("⚠️ OPENAI_API_KEY yok, çeviri yapılmadı.");
    return input;
  }

  try {
    const out = await openaiChat(
      `
You translate tweets into Turkish.

Goal:
Produce a natural Turkish tweet that people would actually write.

Rules:
- Remove RT prefix
- Remove t.co links
- Keep meaning identical
- Keep tone conversational
- Maximum ~200 characters
- Do not add explanations
- Do not include the original language
- If the tweet is already Turkish return it unchanged

Output ONLY the Turkish tweet.
      `,
      input,
      0.2
    );

    console.log("OPENAI RESULT [translation]:", out);
    return out;
  } catch (e) {
    console.log("⚠️ OpenAI çeviri exception:", e.message);
    return input;
  }
}

function fallbackComment(sourceHandle, text) {
  const h = String(sourceHandle || "").toLowerCase();
  const cleaned = cleanupTweetText(text);

  if (
    h.includes("futbol") ||
    h.includes("football") ||
    h.includes("espn") ||
    h.includes("goal") ||
    h.includes("433")
  ) {
    return "Bu görüntüde en dikkat çekici detay ne sence?";
  }

  if (
    h.includes("rainmaker") ||
    h.includes("history") ||
    h.includes("figen")
  ) {
    return "Böyle içerikler neden bu kadar ilgi çekiyor sence?";
  }

  if (
    h.includes("karpathy") ||
    h.includes("sama") ||
    h.includes("ylecun")
  ) {
    return "Buradaki en kritik nokta sence ne?";
  }

  if (cleaned.includes("?")) {
    return "Sence burada asıl kritik nokta ne?";
  }

  return "Bu içerik hakkında sen ne düşünüyorsun?";
}

async function generateComment(sourceHandle, originalText, translationTr, hasMedia) {
  const cleanOriginal = cleanupTweetText(originalText);
  const cleanTranslation = cleanupTweetText(translationTr);

  if (!OPENAI_API_KEY) {
    console.log("⚠️ OPENAI_API_KEY yok, yorum fallback kullanılacak.");
    return fallbackComment(sourceHandle, cleanOriginal);
  }

  try {
    const mediaHint = hasMedia ? "Bu tweet medya içeriyor." : "Bu tweet medya içermiyor.";

    const out = await openaiChat(
      `
You are writing a short Turkish comment for a repost-style social media workflow.

Goal:
Write ONE natural Turkish comment line that can be placed above a translated tweet.

Rules:
- Write in Turkish
- Sound natural, sharp, and human
- 1 sentence only
- Ideally 6 to 14 words
- Do not summarize the whole tweet
- Do not translate the tweet again
- Do not use emojis
- Do not use hashtags
- Avoid generic boring lines
- The comment should invite curiosity, reaction, or thought
- If the content is sports, comment should focus on the striking detail
- If the content is tech/AI, comment should focus on the key implication
- If the content is viral/history, comment should focus on why it is interesting

Output ONLY the Turkish comment sentence.
      `,
      `
Source handle: ${sourceHandle}
Original tweet:
${cleanOriginal}

Turkish translation:
${cleanTranslation}

${mediaHint}
      `,
      0.7
    );

    console.log("OPENAI RESULT [comment]:", out);
    return out;
  } catch (e) {
    console.log("⚠️ OpenAI yorum exception:", e.message);
    return fallbackComment(sourceHandle, cleanOriginal);
  }
}

async function run() {
  console.log("🚀 make-drafts başladı");
  console.log(`OPENAI_API_KEY len=${OPENAI_API_KEY.length || 0}`);
  await ensureTweetMediaValidationSchema(pool);

  const candidates = await pool.query(
    `
    SELECT
      t.tweet_id,
      t.source_handle,
      t.text,
      t.lang,
      t.has_media,
      t.media,
      t.x_url,
      t.tweet_created_at
    FROM tweets t
    LEFT JOIN drafts d ON d.tweet_id = t.tweet_id
    WHERE d.tweet_id IS NULL
      AND t.has_media = true
      AND t.text IS NOT NULL
      AND length(trim(t.text)) > 0
    ORDER BY t.tweet_created_at DESC NULLS LAST
    LIMIT 100
    `
  );

  console.log(`✅ Draft adayı (medyalı): ${candidates.rows.length}`);

  let created = 0;

  for (const row of candidates.rows) {
    const tweetId = row.tweet_id;
    const sourceHandle = row.source_handle;
    const originalText = cleanupTweetText(row.text || "");
    const hasMedia = row.has_media === true;
    const mediaInspection = inspectStoredMedia(row.media);

    if (!originalText) {
      console.log(`- atlandı (boş text): ${tweetId}`);
      continue;
    }

    const viral = scoreVirality(sourceHandle, originalText, hasMedia);
    const shouldUseSourceLinkFallback =
      (!mediaInspection.ok || !mediaInspection.candidate) &&
      viral.score >= FALLBACK_LINK_SCORE_THRESHOLD &&
      String(row.x_url || "").trim();

    if (!mediaInspection.ok || !mediaInspection.candidate) {
      if (shouldUseSourceLinkFallback) {
        console.log(
          `- fallback draft'a donustu: ${tweetId} score=${viral.score} reason=${
            mediaInspection.error || "-"
          }`
        );
      } else {
        console.log(
          `- atlandi (kullanilamaz medya): ${tweetId} score=${viral.score} reason=${
            mediaInspection.error || "-"
          }`
        );
        continue;
      }
    }

    const draftFormatKey = shouldUseSourceLinkFallback
      ? COMMENT_TRANSLATION_SOURCE_LINK_FORMAT_KEY
      : COMMENT_TRANSLATION_FORMAT_KEY;

    const translationTr = await translateToTurkish(originalText);
    const commentTr = await generateComment(
      sourceHandle,
      originalText,
      translationTr,
      hasMedia
    );
    await pool.query(
      `
      INSERT INTO drafts
      (tweet_id, comment_tr, translation_tr, format_key, status, created_at, viral_score, viral_reason)
      VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
      `,
      [
        tweetId,
        commentTr,
        translationTr,
        draftFormatKey,
        "pending",
        viral.score,
        viral.reason,
      ]
    );

    created += 1;
    console.log(
      `✅ draft oluşturuldu: ${tweetId} (${sourceHandle}) score=${viral.score} format=${draftFormatKey}`
    );
  }

  await pool.end();
  console.log(`🚀 make-drafts tamam. oluşturulan=${created}`);
}

run().catch((e) => {
  console.error("❌ make-drafts hata:", e);
  process.exit(1);
});