require("dotenv").config();
const { Pool } = require("pg");
const { inspectStoredMedia } = require("./x-media-upload");
const { ensureTweetMediaValidationSchema } = require("./tweet-media-validation");
const {
  COMMENT_TRANSLATION_FORMAT_KEY,
  COMMENT_TRANSLATION_SOURCE_LINK_FORMAT_KEY,
  composeDraftText,
} = require("./draft-format");

const MAX_TWEET_LENGTH = 280;

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL yok");
  process.exit(1);
}

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
let OPENAI_KEY_VALID = !!OPENAI_API_KEY;
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

const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 45000);
const OPENAI_MAX_RETRIES = Number(process.env.OPENAI_MAX_RETRIES || 3);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function openaiChat(systemPrompt, userPrompt, temperature = 0.4) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY yok");
  }

  let lastError = null;
  for (let attempt = 1; attempt <= OPENAI_MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

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
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const textBody = await res.text();
      let json = null;
      try {
        json = JSON.parse(textBody);
      } catch (_) {}

      if (!res.ok) {
        const err = new Error(`OpenAI hata ${res.status}: ${textBody.slice(0, 500)}`);
        err.status = res.status;
        throw err;
      }

      const out = String(json?.choices?.[0]?.message?.content || "").trim();
      if (!out) {
        throw new Error("OpenAI boş cevap döndü");
      }

      return out;
    } catch (e) {
      lastError = e;
      const status = e?.status;
      const isRetryable =
        status === 429 ||
        (status >= 500 && status < 600) ||
        e?.name === "AbortError" ||
        e?.message?.includes("fetch");

      if (isRetryable && attempt < OPENAI_MAX_RETRIES) {
        const waitMs = Math.min(2000 * Math.pow(2, attempt - 1), 15000);
        console.log(`⚠️ OpenAI attempt ${attempt}/${OPENAI_MAX_RETRIES} failed: ${e.message}. ${waitMs}ms sonra tekrar denenecek.`);
        await sleep(waitMs);
      } else {
        throw lastError;
      }
    }
  }
  throw lastError;
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

  if (!OPENAI_API_KEY || !OPENAI_KEY_VALID) {
    if (!OPENAI_KEY_VALID) console.log("⚠️ OpenAI key geçersiz, çeviri atlandı.");
    else console.log("⚠️ OPENAI_API_KEY yok, çeviri yapılmadı.");
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

  if (!OPENAI_API_KEY || !OPENAI_KEY_VALID) {
    if (!OPENAI_KEY_VALID) console.log("⚠️ OpenAI key geçersiz, yorum fallback kullanılacak.");
    else console.log("⚠️ OPENAI_API_KEY yok, yorum fallback kullanılacak.");
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
    console.log("   (Detay: " + (e.cause?.message || e.stack?.split("\n")[0] || "") + ")");
    return fallbackComment(sourceHandle, cleanOriginal);
  }
}

/**
 * Yorum + çeviri 280 karakteri geçiyorsa OpenAI ile kısaltır.
 * @returns {{ commentTr: string, translationTr: string }}
 */
async function shortenDraftToFit(commentTr, translationTr, formatKey, xUrl) {
  const composed = composeDraftText(commentTr, translationTr, formatKey, xUrl);
  if (composed.length <= MAX_TWEET_LENGTH) {
    return { commentTr, translationTr };
  }

  if (!OPENAI_API_KEY) {
    console.log("⚠️ OPENAI_API_KEY yok, kısaltma yapılamadı. Orijinal kullanılacak.");
    return { commentTr, translationTr };
  }

  try {
    const out = await openaiChat(
      `You shorten Turkish tweets to fit within ${MAX_TWEET_LENGTH} characters (Twitter limit).

Rules:
- Keep the structure: first line = short comment/question, blank line, then main content
- Preserve meaning and tone
- If there is a URL at the end, keep it unchanged
- Output format: COMMENT\\n\\nTRANSLATION or COMMENT\\n\\nTRANSLATION\\n\\nURL
- Output ONLY the shortened tweet, no explanations`,
      `Shorten this tweet to max ${MAX_TWEET_LENGTH} characters:\n\n${composed}`,
      0.3
    );

    const parts = out.split(/\n\n+/);
    let newComment = commentTr;
    let newTranslation = translationTr;

    if (parts.length >= 2) {
      newComment = parts[0].trim();
      newTranslation = parts.slice(1).join("\n\n").trim();
    } else if (parts.length === 1) {
      newTranslation = parts[0].trim();
    }

    const shortened = composeDraftText(newComment, newTranslation, formatKey, xUrl);
    if (shortened.length > MAX_TWEET_LENGTH) {
      console.log("⚠️ OpenAI kısaltma yeterli değil, orijinal kullanılıyor.");
      return { commentTr, translationTr };
    }

    console.log(`OPENAI RESULT [shorten]: ${composed.length} -> ${shortened.length} karakter`);
    return { commentTr: newComment, translationTr: newTranslation };
  } catch (e) {
    console.log("⚠️ OpenAI kısaltma exception:", e.message);
    return { commentTr, translationTr };
  }
}

async function verifyOpenAIKey() {
  if (!OPENAI_API_KEY) return false;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      signal: controller.signal,
    });
    clearTimeout(t);
    if (res.status === 401) {
      console.log("⚠️ OPENAI_API_KEY geçersiz (401). Yorumlar ve çeviriler fallback ile üretilecek.");
      OPENAI_KEY_VALID = false;
      return false;
    }
    if (res.status === 429) {
      console.log("⚠️ OpenAI rate limit (429). Devam ediliyor, retry ile denenecek.");
      return true;
    }
    return res.ok;
  } catch (e) {
    console.log("⚠️ OpenAI key doğrulama atlandı:", e.message);
    return true;
  }
}

async function run() {
  console.log("🚀 make-drafts başladı");
  if (OPENAI_API_KEY) {
    const ok = await verifyOpenAIKey();
    if (ok) {
      console.log("✅ OPENAI_API_KEY geçerli – yorumlar AI ile üretilecek");
    } else if (OPENAI_API_KEY.length > 10) {
      console.log("⚠️ OPENAI_API_KEY var ama doğrulama başarısız. Fallback kullanılacak.");
    }
  } else {
    console.log("⚠️ OPENAI_API_KEY YOK – yorumlar fallback ile üretilecek (Render → Environment → OPENAI_API_KEY ekleyin)");
  }
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
    let commentTr = await generateComment(
      sourceHandle,
      originalText,
      translationTr,
      hasMedia
    );
    const xUrl = String(row.x_url || "").trim();
    const shortened = await shortenDraftToFit(
      commentTr,
      translationTr,
      draftFormatKey,
      xUrl
    );
    commentTr = shortened.commentTr;
    const finalTranslationTr = shortened.translationTr;
    await pool.query(
      `
      INSERT INTO drafts
      (tweet_id, comment_tr, translation_tr, format_key, status, created_at, viral_score, viral_reason)
      VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
      `,
      [
        tweetId,
        commentTr,
        finalTranslationTr,
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