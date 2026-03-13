/**
 * sources.csv'deki listeyi veritabanına tamamen yükler.
 * Önce tüm mevcut sources silinir, sonra CSV'den import edilir.
 *
 * Çalıştır: node replace-sources.js
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const csvPath = path.join(__dirname, "sources.csv");
  const data = fs.readFileSync(csvPath, "utf8");
  const lines = data.split("\n").slice(1).filter((r) => r.trim());

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const delRes = await client.query("DELETE FROM sources");
    console.log(`Eski sources silindi: ${delRes.rowCount}`);

    let added = 0;
    for (const row of lines) {
      const [handle, tier, category, active] = row.split(",").map((s) => s?.trim());
      if (!handle) continue;

      await client.query(
        `INSERT INTO sources (handle, tier, category, active)
         VALUES ($1,$2,$3,$4)`,
        [handle, tier || "2", category || "Viral", active !== "false"]
      );
      added += 1;
    }

    await client.query("COMMIT");
    console.log(`Yeni sources eklendi: ${added}`);
    console.log("Replace tamamlandı.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error("Hata:", e.message);
  process.exit(1);
});
