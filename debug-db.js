// debug-db.js
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const url = process.env.DATABASE_URL || "";
  const safeUrl = url.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@");

  console.log("✅ DATABASE_URL (masked):", safeUrl);

  const tSources = await pool.query(`SELECT COUNT(*)::int AS c FROM sources;`);
  const tTweets = await pool.query(`SELECT COUNT(*)::int AS c FROM tweets;`);
  const tDrafts = await pool.query(`SELECT COUNT(*)::int AS c FROM drafts;`);
  const tQueue = await pool.query(`SELECT COUNT(*)::int AS c FROM queue;`);
  const tHistory = await pool.query(`SELECT COUNT(*)::int AS c FROM history;`);

  const draftByStatus = await pool.query(`
    SELECT status, COUNT(*)::int AS c
    FROM drafts
    GROUP BY status
    ORDER BY status;
  `);

  const lastTweets = await pool.query(`
    SELECT tweet_id, source_handle, left(text, 80) AS text80, ingested_at
    FROM tweets
    ORDER BY ingested_at DESC
    LIMIT 5;
  `);

  console.log("\n--- COUNTS ---");
  console.log("sources:", tSources.rows[0].c);
  console.log("tweets:", tTweets.rows[0].c);
  console.log("drafts:", tDrafts.rows[0].c);
  console.log("queue:", tQueue.rows[0].c);
  console.log("history:", tHistory.rows[0].c);

  console.log("\n--- DRAFTS BY STATUS ---");
  console.table(draftByStatus.rows);

  console.log("\n--- LAST 5 TWEETS ---");
  console.table(lastTweets.rows);

  await pool.end();
}

run().catch((e) => {
  console.error("❌ debug hata:", e);
  process.exit(1);
});