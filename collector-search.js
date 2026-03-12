/**
 * collector-search.js
 * Kelime veya hashtag ile X Search API'den videolu tweet çeker.
 * Kullanıcı/sources'dan bağımsız.
 *
 * Çalıştır:
 *   node collector-search.js "#teknoloji"
 *   node collector-search.js "AI"
 *   COLLECTOR_SEARCH_QUERY="#viral" node collector-search.js
 */

require("dotenv").config();
const { Pool } = require("pg");
const { searchTweetsRecent } = require("./x-api");
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

function buildXUrl(handle, tweetId) {
  const h = String(handle || "").replace(/^@/, "");
  if (h) return `https://x.com/${h}/status/${tweetId}`;
  return `https://x.com/i/status/${tweetId}`;
}

async function run() {
  await ensureTweetMediaValidationSchema(pool);

  const query =
    process.argv[2]?.trim() ||
    process.env.COLLECTOR_SEARCH_QUERY?.trim() ||
    "";
  if (!query) {
    console.error("❌ Query gerekli: node collector-search.js \"#hashtag\" veya COLLECTOR_SEARCH_QUERY=...");
    process.exit(1);
  }

  console.log(`🔍 Search: "${query}" (medyali tweetler filtrelenir)`);

  const { tweets } = await searchTweetsRecent(query, { maxResults: 100 });

  let insertedCount = 0;
  let skippedNoMedia = 0;

  for (const t of tweets) {
    const metrics = t.public_metrics || {};
    const like = metrics.like_count ?? 0;
    const repost = metrics.retweet_count ?? metrics.repost_count ?? 0;
    const reply = metrics.reply_count ?? 0;

    const mediaList = Array.isArray(t.__media) ? t.__media : [];
    const hasMedia = mediaList.length > 0;
    const mediaInspection = inspectStoredMedia(mediaList);
    const mediaUploadable = mediaInspection.ok && !!mediaInspection.candidate;
    const mediaValidationError = mediaInspection.error || null;

    if (!hasMedia) {
      skippedNoMedia += 1;
      continue;
    }

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
        true,
        JSON.stringify(mediaList),
        buildXUrl(authorHandle, t.id),
        mediaUploadable,
        mediaValidationError,
        t.created_at ? new Date(t.created_at) : null,
      ]
    );

    insertedCount += 1;
  }

  await pool.end();
  console.log(
    `✅ Search tamamlandı. ${insertedCount} medyalı tweet yazıldı, ${skippedNoMedia} medyasız atlandı.`
  );
}

run().catch((e) => {
  console.error("❌ Collector search hata:", e?.message || e);
  process.exit(1);
});
