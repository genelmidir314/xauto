/**
 * collector-from-link.js
 * X linkinden tek tweet çeker ve tweets tablosuna yazar.
 * Sonra make-drafts ile draft üretilebilir.
 *
 * Çalıştır:
 *   node collector-from-link.js "https://x.com/user/status/123"
 *   COLLECTOR_FROM_LINK_URL="https://x.com/..." node collector-from-link.js
 */

require("dotenv").config();
const { Pool } = require("pg");
const { getTweetById } = require("./x-api");
const { inspectStoredMedia } = require("./x-media-upload");
const { ensureTweetMediaValidationSchema } = require("./tweet-media-validation");

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL yok");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function parseTweetIdFromUrl(url) {
  const s = String(url || "").trim();
  const m = s.match(/status\/(\d+)/);
  return m ? m[1] : null;
}

function buildXUrl(handle, tweetId) {
  const h = String(handle || "").replace(/^@/, "");
  if (h) return `https://x.com/${h}/status/${tweetId}`;
  return `https://x.com/i/status/${tweetId}`;
}

async function run() {
  await ensureTweetMediaValidationSchema(pool);

  const url =
    process.argv[2]?.trim() ||
    process.env.COLLECTOR_FROM_LINK_URL?.trim() ||
    "";
  const tweetId = parseTweetIdFromUrl(url);

  if (!tweetId) {
    console.error("❌ Gecersiz X linki. Ornek: https://x.com/user/status/123456789");
    process.exit(1);
  }

  console.log(`🔗 Tweet ID: ${tweetId}`);

  const { tweet } = await getTweetById(tweetId);
  const t = tweet;

  const metrics = t.public_metrics || {};
  const like = metrics.like_count ?? 0;
  const repost = metrics.retweet_count ?? metrics.repost_count ?? 0;
  const reply = metrics.reply_count ?? 0;

  const mediaList = Array.isArray(t.__media) ? t.__media : [];
  const hasMedia = mediaList.length > 0;
  const mediaInspection = inspectStoredMedia(mediaList);
  const mediaUploadable = mediaInspection.ok && !!mediaInspection.candidate;
  const mediaValidationError = mediaInspection.error || null;

  const authorHandle = t.__author_username || null;

  await pool.query(
    `INSERT INTO tweets
     (tweet_id, source_handle, text, lang, like_count, repost_count, reply_count, has_media, media, x_url, media_uploadable, media_validation_error, tweet_created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (tweet_id) DO UPDATE SET
       text = EXCLUDED.text,
       source_handle = EXCLUDED.source_handle,
       lang = EXCLUDED.lang,
       like_count = EXCLUDED.like_count,
       repost_count = EXCLUDED.repost_count,
       reply_count = EXCLUDED.reply_count,
       has_media = EXCLUDED.has_media,
       media = EXCLUDED.media,
       x_url = EXCLUDED.x_url,
       media_uploadable = EXCLUDED.media_uploadable,
       media_validation_error = EXCLUDED.media_validation_error,
       tweet_created_at = EXCLUDED.tweet_created_at`,
    [
      t.id,
      authorHandle,
      t.text || null,
      t.lang || null,
      like,
      repost,
      reply,
      hasMedia,
      JSON.stringify(mediaList),
      buildXUrl(authorHandle, t.id),
      mediaUploadable,
      mediaValidationError,
      t.created_at ? new Date(t.created_at) : null,
    ]
  );

  await pool.end();
  console.log(
    `✅ Tweet yazildi. @${authorHandle || "?"} | medya: ${hasMedia ? "var" : "yok"} | Draft icin "Draft Uret" tiklayin.`
  );
}

run().catch((e) => {
  console.error("❌ Collector from-link hata:", e?.message || e);
  process.exit(1);
});
