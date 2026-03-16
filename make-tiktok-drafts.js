/**
 * make-tiktok-drafts.js
 * tiktok_items'dan draft üretir (OpenAI yorum + mevcut queue akışı).
 *
 * Kullanim:
 *   node make-tiktok-drafts.js
 */

require("dotenv").config();
const { Pool } = require("pg");
const path = require("path");
const { ensureTikTokSchema } = require("./ensure-tiktok-schema");
const { TIKTOK_VIDEO_FORMAT_KEY } = require("./draft-format");
const { generateComment, translateToTurkish } = require("./lib/openai-comment");

const MAX_TWEET_LENGTH = 280;

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL yok");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function cleanupText(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

async function run() {
  await ensureTikTokSchema(pool);

  const candidates = await pool.query(
    `
    SELECT ti.id, ti.video_id, ti.source_url, ti.author_handle, ti.caption,
           ti.local_path, ti.viral_score
    FROM tiktok_items ti
    LEFT JOIN drafts d ON d.tiktok_item_id = ti.id
    WHERE d.id IS NULL
      AND ti.local_path IS NOT NULL
    ORDER BY ti.viral_score DESC NULLS LAST, ti.id DESC
    LIMIT 50
    `
  );

  console.log(`✅ TikTok draft adayi: ${candidates.rows.length}`);

  let created = 0;
  for (const row of candidates.rows) {
    const caption = cleanupText(row.caption) || (row.author_handle ? `@${row.author_handle} TikTok videosu` : "TikTok videosu");
    const translationTr = await translateToTurkish(caption);
    const authorHandle = row.author_handle || "tiktok";
    const commentTr = await generateComment(
      authorHandle,
      caption,
      translationTr || caption,
      true
    );
    const text = commentTr.trim();
    if (!text) {
      console.log(`- atlandi (bos yorum): ${row.video_id}`);
      continue;
    }

    const finalText =
      text.length > MAX_TWEET_LENGTH
        ? text.slice(0, MAX_TWEET_LENGTH - 3) + "..."
        : text;

    const tweetId = `tiktok_${row.video_id}`;

    await pool.query(
      `
      INSERT INTO drafts
      (tweet_id, comment_tr, translation_tr, format_key, status, viral_score, viral_reason, tiktok_item_id)
      VALUES ($1, $2, $3, $4, 'pending', $5, 'tiktok', $6)
      ON CONFLICT (tweet_id) DO NOTHING
      `,
      [tweetId, finalText, translationTr, TIKTOK_VIDEO_FORMAT_KEY, row.viral_score || 50, row.id]
    );

    if ((await pool.query(`SELECT 1 FROM drafts WHERE tweet_id=$1`, [tweetId]))
      .rowCount > 0) {
      created += 1;
      console.log(`✅ draft: ${tweetId} (${row.video_id})`);
    }
  }

  await pool.end();
  console.log(`🚀 make-tiktok-drafts tamam. olusturulan=${created}`);
}

run().catch((e) => {
  console.error("❌ make-tiktok-drafts hata:", e);
  process.exit(1);
});
