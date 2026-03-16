/**
 * ensure-tiktok-schema.js
 * TikTok tablolarını oluşturur veya günceller.
 */

async function ensureTikTokSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tiktok_sources (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT true,
      last_checked_at TIMESTAMP,
      next_check_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tiktok_items (
      id SERIAL PRIMARY KEY,
      video_id TEXT NOT NULL UNIQUE,
      source_url TEXT NOT NULL,
      author_handle TEXT,
      caption TEXT,
      video_url TEXT,
      local_path TEXT,
      view_count INTEGER NOT NULL DEFAULT 0,
      like_count INTEGER NOT NULL DEFAULT 0,
      comment_count INTEGER NOT NULL DEFAULT 0,
      viral_score INTEGER,
      created_at TIMESTAMP,
      ingested_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE drafts
    ADD COLUMN IF NOT EXISTS tiktok_item_id INTEGER REFERENCES tiktok_items(id) ON DELETE SET NULL;
  `);
}

module.exports = { ensureTikTokSchema };
