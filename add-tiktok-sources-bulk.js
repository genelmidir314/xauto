/**
 * Toplu TikTok kullanici ekleme.
 * Kullanim: node add-tiktok-sources-bulk.js
 */

require("dotenv").config();
const { Pool } = require("pg");
const { ensureTikTokSchema } = require("./ensure-tiktok-schema");

function normalizeTikTokInput(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  if (s.includes("tiktok.com")) return s;
  const username = s.replace(/^@/, "");
  if (!username || !/^[\w.]+$/.test(username)) return null;
  return `https://www.tiktok.com/@${username}`;
}

const USERNAMES = [
  "charlidamelio", "addisonre", "bellapoarch", "avani", "twinmelody",
  "nishaguragain", "domelipa", "yodelinghaley", "itsjojosiwa", "hannahstocking",
  "lexibrookerivera", "baileygrey", "carlalazzari", "daniellegersh", "alixearle",
  "oliviadunne", "madi", "lorengray", "annaxsitar", "briannam",
  "sofiamuse", "elenagenevinne", "valentinafradegrada", "anokhina_liza", "nataliesole",
  "veronicabielik", "dancemoms", "dancewithme", "justmaiko_female", "addisonreclips",
  "sofiiiiagomez", "itsjojosiwa_fans",
  "justmaiko", "michael.le", "noahbeck", "spencerx", "jasonderulo",
  "tonylopez", "ondreazlopez", "riyaz.14",
];

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await ensureTikTokSchema(pool);

  let added = 0;
  for (const u of USERNAMES) {
    const url = normalizeTikTokInput(u);
    if (!url) continue;
    try {
      await pool.query(
        `INSERT INTO tiktok_sources (url, active) VALUES ($1, true)
         ON CONFLICT (url) DO UPDATE SET active = true`,
        [url]
      );
      added++;
      console.log("+", url);
    } catch (e) {
      console.error("!", u, e.message);
    }
  }

  await pool.end();
  console.log(`\n${added} kaynak eklendi/guncellendi.`);
}

run().catch((e) => {
  console.error("Hata:", e.message);
  process.exit(1);
});
