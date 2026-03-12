require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sources (
      id SERIAL PRIMARY KEY,
      handle TEXT UNIQUE NOT NULL,
      tier INTEGER NOT NULL DEFAULT 2,
      category TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      last_tweet_id TEXT,
      x_user_id TEXT,
      last_checked_at TIMESTAMP,
      next_check_at TIMESTAMP,
      resolve_status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    UPDATE sources
    SET next_check_at = NOW()
    WHERE next_check_at IS NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tweets (
      id SERIAL PRIMARY KEY,
      tweet_id TEXT UNIQUE NOT NULL,
      source_handle TEXT,
      text TEXT,
      lang TEXT,
      like_count INTEGER NOT NULL DEFAULT 0,
      repost_count INTEGER NOT NULL DEFAULT 0,
      reply_count INTEGER NOT NULL DEFAULT 0,
      has_media BOOLEAN NOT NULL DEFAULT false,
      media JSONB,
      x_url TEXT,
      media_uploadable BOOLEAN NOT NULL DEFAULT false,
      media_validation_error TEXT,
      tweet_created_at TIMESTAMP,
      ingested_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS drafts (
      id SERIAL PRIMARY KEY,
      tweet_id TEXT UNIQUE NOT NULL,
      comment_tr TEXT,
      translation_tr TEXT,
      use_comment BOOLEAN NOT NULL DEFAULT true,
      format_key TEXT,
      viral_score INTEGER,
      viral_reason TEXT,
      scored_at TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'pending', -- pending/approved/rejected/posted/failed
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE drafts ADD COLUMN IF NOT EXISTS use_comment BOOLEAN NOT NULL DEFAULT true;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS queue (
      id SERIAL PRIMARY KEY,
      draft_id INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
      scheduled_at TIMESTAMP NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting', -- waiting/processing/done/failed
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS history (
      id SERIAL PRIMARY KEY,
      draft_id INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
      posted_at TIMESTAMP NOT NULL DEFAULT NOW(),
      x_post_id TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      active_start_hour INTEGER NOT NULL,
      active_end_hour INTEGER NOT NULL,
      min_post_interval_minutes INTEGER NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    INSERT INTO schedule_settings (
      id,
      active_start_hour,
      active_end_hour,
      min_post_interval_minutes,
      updated_at
    )
    VALUES (1, 6, 1, 57, NOW())
    ON CONFLICT (id) DO NOTHING;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS collector_runs (
      id SERIAL PRIMARY KEY,
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMP,
      due_sources INTEGER NOT NULL DEFAULT 0,
      processed_sources INTEGER NOT NULL DEFAULT 0,
      user_id_resolves INTEGER NOT NULL DEFAULT 0,
      timeline_calls INTEGER NOT NULL DEFAULT 0,
      new_tweets INTEGER NOT NULL DEFAULT 0,
      media_tweets INTEGER NOT NULL DEFAULT 0,
      draft_candidates INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS follow_queue (
      id SERIAL PRIMARY KEY,
      handle TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      followed_at TIMESTAMP,
      last_error TEXT,
      next_follow_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(handle)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS source_performance (
      source_id INTEGER PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
      last_run_at TIMESTAMP,
      last_success_at TIMESTAMP,
      resolve_calls INTEGER NOT NULL DEFAULT 0,
      timeline_calls INTEGER NOT NULL DEFAULT 0,
      new_tweets_found INTEGER NOT NULL DEFAULT 0,
      media_tweets_found INTEGER NOT NULL DEFAULT 0,
      draft_candidates INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      last_result TEXT,
      last_error TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  console.log("✅ Database tabloları oluşturuldu.");
  await pool.end();
}

init().catch((e) => {
  console.error("❌ DB init hata:", e);
  process.exit(1);
});