/**
 * Tüm aktif kaynakları hemen "due" yapar (next_check_at = NOW).
 * Collector'ın bir sonraki çalışmasında tüm kaynaklar taranır.
 *
 * Çalıştır: node reset-sources-due.js
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
  const r = await pool.query(
    "UPDATE sources SET next_check_at = NOW() WHERE active = true RETURNING handle"
  );
  console.log(`✅ ${r.rowCount} kaynak due yapıldı:`, r.rows.map((x) => x.handle).join(", "));
  await pool.end();
}

run().catch((e) => {
  console.error("❌ Hata:", e.message);
  process.exit(1);
});
