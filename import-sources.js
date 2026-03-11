require("dotenv").config();
const fs = require("fs");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {

  const data = fs.readFileSync("sources.csv", "utf8");
  const rows = data.split("\n").slice(1);

  for (const row of rows) {

    if (!row.trim()) continue;

    const [handle, tier, category, active] = row.split(",");

    await pool.query(
      `INSERT INTO sources (handle, tier, category, active)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (handle) DO NOTHING`,
      [handle, tier, category, active === "true"]
    );

    console.log("added:", handle);

  }

  console.log("Import tamamlandı 🚀");
  process.exit();
}

run();