// reset-drafts-to-pending.js
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const r = await pool.query(
    `UPDATE drafts
     SET status='pending'
     WHERE status IN ('approved','queued','rejected','failed','posted')
     RETURNING id, tweet_id, status`
  );

  console.log(`✅ Pending'e dönen draft sayısı: ${r.rowCount}`);
  await pool.end();
}

run().catch((e) => {
  console.error("❌ Hata:", e);
  process.exit(1);
});