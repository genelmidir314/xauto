/**
 * tiktok-collector-once.js
 * tiktok_sources tablosundaki URL'leri tarar, videoları indirir, tiktok_items'a yazar.
 *
 * Kullanim:
 *   node tiktok-collector-once.js
 *
 * Cron: Her 15-60 dk'da bir calistirilabilir.
 */

require("dotenv").config();
const { Pool } = require("pg");
const path = require("path");
const { ensureTikTokSchema } = require("./ensure-tiktok-schema");
const { downloadTikTokVideo, TIKTOK_DOWNLOAD_DIR } = require("./tiktok-download");

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL yok");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const CHECK_INTERVAL_MINUTES = Number(
  process.env.TIKTOK_CHECK_INTERVAL_MINUTES || 60
);

function scoreViral(viewCount, likeCount, commentCount) {
  const v = Number(viewCount) || 0;
  const l = Number(likeCount) || 0;
  const c = Number(commentCount) || 0;
  const engagement = l + c * 2;
  const hours = 24;
  const velocity = v > 0 ? engagement / (v / 1000) : 0;
  const velocityScore = Math.min(15, Math.log10(1 + velocity) * 3);
  const engagementScore = Math.min(10, Math.log10(1 + engagement) * 2);
  return Math.round(35 + velocityScore + engagementScore);
}

async function run() {
  await ensureTikTokSchema(pool);

  const sources = await pool.query(
    `
    SELECT id, url, last_checked_at
    FROM tiktok_sources
    WHERE active = true
      AND (next_check_at IS NULL OR next_check_at <= NOW())
    ORDER BY next_check_at ASC NULLS FIRST, id ASC
    LIMIT 20
    `
  );

  if (sources.rows.length === 0) {
    console.log("✅ Tarama yapilacak tiktok source yok.");
    await pool.end();
    return;
  }

  console.log(`✅ Kaynak sayisi: ${sources.rows.length}`);

  for (const s of sources.rows) {
    const url = s.url;
    try {
      const result = await downloadTikTokVideo(url, TIKTOK_DOWNLOAD_DIR);
      const localPath = result.localPath || result;
      const meta = result.metadata || {};
      const videoId = meta.id || path.basename(localPath, path.extname(localPath));
      const author = meta.uploader || meta.uploader_id || meta.creator || null;
      const caption = meta.title || meta.description || null;
      const viewCount = meta.view_count ?? meta.play_count ?? 0;
      const likeCount = meta.like_count ?? 0;
      const commentCount = meta.comment_count ?? 0;
      const viralScore = scoreViral(viewCount, likeCount, commentCount);
      const created = meta.timestamp ? new Date(meta.timestamp * 1000) : null;

      await pool.query(
        `
        INSERT INTO tiktok_items
        (video_id, source_url, author_handle, caption, video_url, local_path,
         view_count, like_count, comment_count, viral_score, created_at, ingested_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        ON CONFLICT (video_id) DO UPDATE SET
          local_path = EXCLUDED.local_path,
          view_count = EXCLUDED.view_count,
          like_count = EXCLUDED.like_count,
          comment_count = EXCLUDED.comment_count,
          viral_score = EXCLUDED.viral_score,
          caption = COALESCE(EXCLUDED.caption, tiktok_items.caption)
        `,
        [
          videoId,
          url,
          author,
          caption,
          url,
          localPath,
          viewCount,
          likeCount,
          commentCount,
          viralScore,
          created,
        ]
      );

      await pool.query(
        `
        UPDATE tiktok_sources
        SET last_checked_at = NOW(),
            next_check_at = NOW() + ($2 || ' minutes')::interval
        WHERE id = $1
        `,
        [s.id, String(CHECK_INTERVAL_MINUTES)]
      );

      console.log(
        `✅ ${url.slice(0, 50)}...: video_id=${videoId} score=${viralScore}`
      );
    } catch (e) {
      console.error(`❌ ${url}: ${e.message}`);
      await pool.query(
        `
        UPDATE tiktok_sources
        SET last_checked_at = NOW(),
            next_check_at = NOW() + ($2 || ' minutes')::interval
        WHERE id = $1
        `,
        [s.id, String(CHECK_INTERVAL_MINUTES)]
      );
    }
  }

  await pool.end();
  console.log("🚀 TikTok collector run bitti.");
}

run().catch((e) => {
  console.error("❌ TikTok collector hata:", e);
  process.exit(1);
});
