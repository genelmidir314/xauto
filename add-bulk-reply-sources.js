/**
 * Reply kaynaklarına toplu handle ekler.
 * Çalıştır: node add-bulk-reply-sources.js
 */

require("dotenv").config();
const { Pool } = require("pg");

const HANDLES = [
  "pubity", "daily_loud", "historyinmemes", "nowthisnews", "433",
  "espn", "bleacherreport", "houseofhighlights", "nasa", "spacex",
  "techcrunch", "theverge", "wired", "openai", "sama",
];

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL yok");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  let count = 0;
  for (const h of HANDLES) {
    const handle = String(h || "").trim().replace(/^@/, "");
    if (!handle) continue;
    await pool.query(
      `INSERT INTO reply_sources (handle, active) VALUES ($1, true) ON CONFLICT (handle) DO NOTHING`,
      [handle]
    );
    count += 1;
  }
  await pool.end();
  console.log(`✅ ${count} reply kaynağı eklendi.`);
}

run().catch((e) => {
  console.error("❌ Hata:", e?.message || e);
  process.exit(1);
});
