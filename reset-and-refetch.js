// reset-and-refetch.js
// Tum listeleri sifirlar, queue'yu temizler, draftlari pending'e alir,
// collector ile yeni tweet ceker, make-drafts ile draft uretir.
//
// Kullanim: node reset-and-refetch.js

require("dotenv").config();
const path = require("path");
const { Pool } = require("pg");
const { execSync } = require("child_process");

const nodeDir = path.dirname(process.execPath);
const pathEnv = nodeDir + path.delimiter + (process.env.PATH || "");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  console.log("1/5 Queue temizleniyor...");
  const qDel = await pool.query(`DELETE FROM queue`);
  console.log(`   ${qDel.rowCount} queue kaydi silindi.`);

  console.log("2/5 History temizleniyor...");
  const hDel = await pool.query(`DELETE FROM history`);
  console.log(`   ${hDel.rowCount} history kaydi silindi.`);

  console.log("3/5 Tum draftlar pending'e aliniyor...");
  const dUpd = await pool.query(
    `UPDATE drafts
     SET status='pending'
     WHERE status IN ('approved','queued','rejected','failed','posted')
     RETURNING id`
  );
  console.log(`   ${dUpd.rowCount} draft pending'e alindi.`);

  await pool.end();

  const childEnv = { ...process.env, PATH: pathEnv };
  console.log("4/5 Collector calistiriliyor (yeni tweetler cekiliyor)...");
  execSync("node collector-once.js", {
    stdio: "inherit",
    cwd: __dirname,
    env: childEnv,
  });

  console.log("5/5 Make-drafts calistiriliyor (draft uretimi)...");
  execSync("node make-drafts.js", {
    stdio: "inherit",
    cwd: __dirname,
    env: childEnv,
  });

  console.log("\nBitti. Inbox sayfasini yenileyin.");
}

run().catch((e) => {
  console.error("Hata:", e);
  process.exit(1);
});
