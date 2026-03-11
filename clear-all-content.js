/**
 * Tüm draft, queue, history ve tweet kayıtlarını siler.
 * Sources ve schedule_settings korunur.
 *
 * Çalıştır: node clear-all-content.js
 */

require("dotenv").config();
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL yok");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const queueRes = await client.query("DELETE FROM queue");
    const historyRes = await client.query("DELETE FROM history");
    const draftsRes = await client.query("DELETE FROM drafts");
    const tweetsRes = await client.query("DELETE FROM tweets");

    await client.query("COMMIT");

    console.log("✅ Silindi:");
    console.log(`   queue: ${queueRes.rowCount}`);
    console.log(`   history: ${historyRes.rowCount}`);
    console.log(`   drafts: ${draftsRes.rowCount}`);
    console.log(`   tweets: ${tweetsRes.rowCount}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error("❌ Hata:", e.message);
  process.exit(1);
});
