require("dotenv").config();
const { Pool } = require("pg");
const { inspectStoredMedia } = require("./x-media-upload");
const { ensureTweetMediaValidationSchema } = require("./tweet-media-validation");
const {
  COMMENT_TRANSLATION_FORMAT_KEY,
  COMMENT_TRANSLATION_SOURCE_LINK_FORMAT_KEY,
  composeDraftText,
} = require("./draft-format");
const {
  cleanupTweetText,
  openaiChat,
  generateComment,
  generateHashtags,
  setOpenAIKeyValid,
} = require("./lib/openai-comment");

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

function looksTurkish(text) {
  const s = String(text || "");
  return /[çğıöşüÇĞİÖŞÜ]/.test(s) || /\b(ve|bir|bu|çok|ama|gibi|neden|nasıl|mi|mı|mu|mü)\b/i.test(s);
}

function scoreVirality(sourceHandle, text, hasMedia, options = {}) {
  const like = Math.max(0, Number(options.like_count) || 0);
  const retweet = Math.max(0, Number(options.repost_count) || 0);
  const reply = Math.max(0, Number(options.reply_count) || 0);
  const tweetCreatedAt = options.tweet_created_at;

  let score = 35;
  const reasons = [];

  // engagement_velocity * 3: (like + retweet*2 + reply*2) / hours, log-normalized
  const totalEngagement = like + retweet * 2 + reply * 2;
  const hoursSincePost = tweetCreatedAt
    ? (Date.now() - new Date(tweetCreatedAt).getTime()) / (1000 * 60 * 60)
    : 24;
  const velocity = hoursSincePost > 0.1 ? totalEngagement / Math.max(0.1, hoursSincePost) : 0;
  const velocityScore = Math.min(12, Math.log10(1 + velocity) * 3);
  if (velocityScore > 0) {
    score += velocityScore;
    reasons.push("velocity");
  }

  // retweet_count * 2 + reply_count * 2: engagement component, log-normalized
  const engagementRaw = retweet * 2 + reply * 2 + like;
  const engagementScore = Math.min(10, Math.log10(1 + engagementRaw) * 3);
  if (engagementScore > 0) {
    score += engagementScore;
    reasons.push("engagement");
  }

  // video_bonus
  if (hasMedia) {
    score += 15;
    reasons.push("media");
  }
  score += 5;
  reasons.push("video_bonus");

  // recency_bonus: son 24h +10, son 72h +5
  if (hoursSincePost < 24) {
    score += 10;
    reasons.push("recency_24h");
  } else if (hoursSincePost < 72) {
    score += 5;
    reasons.push("recency_72h");
  }

  const t = cleanupTweetText(text);
  const h = String(sourceHandle || "").toLowerCase();

  if (t.length >= 25 && t.length <= 180) {
    score += 8;
    reasons.push("ideal_length");
  }

  if (/\?/.test(t)) {
    score += 4;
    reasons.push("question");
  }

  if (/\d/.test(t)) {
    score += 4;
    reasons.push("numbers");
  }

  if (
    h.includes("futbol") ||
    h.includes("football") ||
    h.includes("espn") ||
    h.includes("goal") ||
    h.includes("433")
  ) {
    score += 8;
    reasons.push("sports");
  }

  if (
    h.includes("rainmaker") ||
    h.includes("history") ||
    h.includes("figen")
  ) {
    score += 6;
    reasons.push("viral_source");
  }

  if (
    h.includes("karpathy") ||
    h.includes("sama") ||
    h.includes("ylecun")
  ) {
    score += 5;
    reasons.push("tech_source");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    reason: reasons.join(", "),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 5,
        messages: [{ role: "user", content: "Say OK" }],
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (res.status === 401) {
      console.log("⚠️ OPENAI_API_KEY geçersiz (401). Yorumlar ve çeviriler fallback ile üretilecek.");
      OPENAI_KEY_VALID = false;
      setOpenAIKeyValid(false);
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
      t.tweet_created_at,
      t.like_count,
      t.repost_count,
      t.reply_count
    FROM tweets t
    LEFT JOIN drafts d ON d.tweet_id = t.tweet_id
    WHERE d.tweet_id IS NULL
      AND t.tweet_id NOT IN (SELECT tweet_id FROM rejected_tweet_ids)
      AND t.has_media = true
      AND t.media IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(t.media) AS m(elem)
        WHERE m.elem->>'type' IN ('video', 'animated_gif')
      )
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

    const viral = scoreVirality(sourceHandle, originalText, hasMedia, {
      like_count: row.like_count,
      repost_count: row.repost_count,
      reply_count: row.reply_count,
      tweet_created_at: row.tweet_created_at,
    });
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
    const hashtagsTr = await generateHashtags(commentTr, finalTranslationTr, originalText);
    await pool.query(
      `
      INSERT INTO drafts
      (tweet_id, comment_tr, translation_tr, hashtags_tr, format_key, status, created_at, viral_score, viral_reason)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8)
      `,
      [
        tweetId,
        commentTr,
        finalTranslationTr,
        hashtagsTr || null,
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