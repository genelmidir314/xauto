require("dotenv").config();
const { Pool } = require("pg");
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

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function syncTweetMediaValidation() {
  const tweets = await pool.query(
    `
    SELECT id, tweet_id, media, has_media
    FROM tweets
    WHERE has_media = true
    ORDER BY id ASC
    `
  );

  let uploadableCount = 0;
  let invalidCount = 0;

  for (const row of tweets.rows) {
    const inspection = inspectStoredMedia(row.media);
    const uploadable = inspection.ok && !!inspection.candidate;
    const reason = inspection.error || null;

    if (uploadable) uploadableCount += 1;
    else invalidCount += 1;

    await pool.query(
      `
      UPDATE tweets
      SET media_uploadable = $2,
          media_validation_error = $3
      WHERE id = $1
      `,
      [row.id, uploadable, reason]
    );
  }

  return {
    scanned: tweets.rows.length,
    uploadableCount,
    invalidCount,
  };
}

async function findInvalidDrafts() {
  const r = await pool.query(
    `
    SELECT
      d.id,
      d.status,
      d.tweet_id,
      t.source_handle,
      t.media_validation_error,
      EXISTS(SELECT 1 FROM history h WHERE h.draft_id = d.id) AS already_posted,
      EXISTS(SELECT 1 FROM queue q WHERE q.draft_id = d.id) AS in_queue
    FROM drafts d
    JOIN tweets t ON t.tweet_id = d.tweet_id
    WHERE t.has_media = true
      AND COALESCE(t.media_uploadable, false) = false
    ORDER BY d.id ASC
    `
  );

  return r.rows;
}

async function rejectInvalidDrafts(rows) {
  let affected = 0;
  for (const row of rows) {
    if (row.already_posted) continue;
    await pool.query(`DELETE FROM queue WHERE draft_id = $1`, [row.id]);
    await pool.query(`UPDATE drafts SET status = 'rejected' WHERE id = $1`, [row.id]);
    affected += 1;
  }
  return affected;
}

async function run() {
  const apply = hasFlag("apply");
  await ensureTweetMediaValidationSchema(pool);
  const syncSummary = await syncTweetMediaValidation();
  const invalidDrafts = await findInvalidDrafts();

  let rejectedCount = 0;
  if (apply) {
    rejectedCount = await rejectInvalidDrafts(invalidDrafts);
  }

  console.log("✅ medya validasyon senkronu tamam");
  console.log(JSON.stringify(syncSummary, null, 2));
  console.log(`invalid_drafts=${invalidDrafts.length}`);
  if (invalidDrafts.length > 0) {
    console.table(
      invalidDrafts.map((row) => ({
        id: row.id,
        status: row.status,
        tweet_id: row.tweet_id,
        source_handle: row.source_handle,
        in_queue: row.in_queue,
        already_posted: row.already_posted,
        reason: row.media_validation_error,
      }))
    );
  }

  if (apply) {
    console.log(`rejected_count=${rejectedCount}`);
  } else {
    console.log("Dry run icin listeleme yapildi. Uygulamak icin --apply kullan.");
  }

  await pool.end();
}

run().catch(async (e) => {
  console.error("❌ cleanup-invalid-media-drafts hata:", e);
  try {
    await pool.end();
  } catch (_) {}
  process.exit(1);
});
