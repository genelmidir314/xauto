require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const r = await pool.query(`UPDATE sources SET active=true;`);
  console.log(`✅ Active=true yapıldı. Etkilenen satır: ${r.rowCount}`);
  await pool.end();
}

run().catch((e) => {
  console.error("❌ Hata:", e);
  process.exit(1);
});