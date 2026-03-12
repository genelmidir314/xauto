require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function migrate() {
  await pool.query(`
    ALTER TABLE sources
    ADD COLUMN IF NOT EXISTS last_tweet_id TEXT,
    ADD COLUMN IF NOT EXISTS x_user_id TEXT,
    ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS next_check_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS resolve_status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS last_error TEXT;
  `);

  await pool.query(`
    UPDATE sources
    SET next_check_at = NOW()
    WHERE next_check_at IS NULL;
  `);

  await pool.query(`
    ALTER TABLE tweets
    ADD COLUMN IF NOT EXISTS media JSONB,
    ADD COLUMN IF NOT EXISTS x_url TEXT,
    ADD COLUMN IF NOT EXISTS media_uploadable BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS media_validation_error TEXT;
  `);

  await pool.query(`
    ALTER TABLE drafts
    ADD COLUMN IF NOT EXISTS viral_score INTEGER,
    ADD COLUMN IF NOT EXISTS viral_reason TEXT,
    ADD COLUMN IF NOT EXISTS scored_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS use_comment BOOLEAN NOT NULL DEFAULT true;
  `);

  await pool.query(`
    ALTER TABLE queue
    ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS last_error TEXT;
  `);

  await pool.query(`
    UPDATE queue
    SET attempts = COALESCE(attempts, 0),
        updated_at = COALESCE(updated_at, created_at, NOW());
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
    CREATE TABLE IF NOT EXISTS reply_sources (
      id SERIAL PRIMARY KEY,
      handle TEXT UNIQUE NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      last_tweet_id TEXT,
      x_user_id TEXT,
      last_checked_at TIMESTAMP,
      next_check_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reply_candidates (
      id SERIAL PRIMARY KEY,
      tweet_id TEXT UNIQUE NOT NULL,
      author_handle TEXT,
      text TEXT,
      like_count INTEGER NOT NULL DEFAULT 0,
      retweet_count INTEGER NOT NULL DEFAULT 0,
      reply_count INTEGER NOT NULL DEFAULT 0,
      viral_score INTEGER,
      tweet_created_at TIMESTAMP,
      ingested_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reply_drafts (
      id SERIAL PRIMARY KEY,
      tweet_id TEXT UNIQUE NOT NULL,
      reply_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reply_queue (
      id SERIAL PRIMARY KEY,
      draft_id INTEGER NOT NULL REFERENCES reply_drafts(id) ON DELETE CASCADE,
      scheduled_at TIMESTAMP NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reply_history (
      id SERIAL PRIMARY KEY,
      draft_id INTEGER NOT NULL REFERENCES reply_drafts(id) ON DELETE CASCADE,
      posted_at TIMESTAMP NOT NULL DEFAULT NOW(),
      x_reply_id TEXT
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

  console.log("✅ Migration tamam: runtime schema alanlari genisletildi");
  await pool.end();
}

migrate().catch((e) => {
  console.error("❌ Migration hata:", e);
  process.exit(1);
});