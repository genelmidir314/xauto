require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const r1 = await pool.query("SELECT COUNT(*)::int AS c FROM sources;");
  const r2 = await pool.query("SELECT COUNT(*)::int AS c FROM sources WHERE active=true;");
  const top = await pool.query(
    "SELECT id, handle, tier, category, active, last_tweet_id FROM sources ORDER BY id ASC LIMIT 20;"
  );

  console.log("Total sources:", r1.rows[0].c);
  console.log("Active sources:", r2.rows[0].c);
  console.table(top.rows);

  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});