// seed-tweets.js
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const now = new Date();

  const sample = [
    { tweet_id: "mock_1", source_handle: "sama", text: "Big week for AI. Things are moving fast.", lang: "en" },
    { tweet_id: "mock_2", source_handle: "FT", text: "Markets are pricing in a new risk regime.", lang: "en" },
    { tweet_id: "mock_3", source_handle: "historyinmemes", text: "This photo is from 1912 and it’s wild.", lang: "en" },
  ];

  for (const t of sample) {
    await pool.query(
      `INSERT INTO tweets (tweet_id, source_handle, text, lang, like_count, repost_count, reply_count, has_media, tweet_created_at)
       VALUES ($1,$2,$3,$4,0,0,0,false,$5)
       ON CONFLICT (tweet_id) DO NOTHING`,
      [t.tweet_id, t.source_handle, t.text, t.lang, now]
    );
  }

  console.log("✅ Mock tweetler eklendi.");
  await pool.end();
}

run().catch((e) => {
  console.error("❌ seed hata:", e);
  process.exit(1);
});