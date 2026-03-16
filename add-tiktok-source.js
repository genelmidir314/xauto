/**
 * add-tiktok-source.js
 * tiktok_sources tablosuna URL ekler.
 *
 * Kullanim:
 *   node add-tiktok-source.js "https://www.tiktok.com/@user/video/123"
 *   node add-tiktok-source.js --url="https://..."
 */

require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function getArg(name, fallback = null) {
  const arg = process.argv.find((x) => x.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.split("=").slice(1).join("=") || fallback;
}

function getUrlFromArgs() {
  const url = getArg("url");
  if (url) return url;
  const pos = process.argv.findIndex((a) => a.startsWith("http"));
  return pos >= 0 ? process.argv[pos] : null;
}

async function run() {
  const url = getUrlFromArgs();
  if (!url || !url.includes("tiktok.com")) {
    console.error("Kullanim: node add-tiktok-source.js <tiktok_url>");
    process.exit(1);
  }

  const { ensureTikTokSchema } = require("./ensure-tiktok-schema");
  await ensureTikTokSchema(pool);

  await pool.query(
    `
    INSERT INTO tiktok_sources (url, active)
    VALUES ($1, true)
    ON CONFLICT (url) DO UPDATE SET active = true
    `,
    [url.trim()]
  );

  console.log("✅ Kaynak eklendi:", url);
  await pool.end();
}

run().catch((e) => {
  console.error("Hata:", e.message);
  process.exit(1);
});
