// auto-approve-top.js
// pending içinden viral_score'a göre en iyi N taneyi approved yapar.
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function getArg(name, fallback) {
  const arg = process.argv.find((x) => x.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.split("=").slice(1).join("=") || fallback;
}
function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

async function run() {
  const count = clampInt(getArg("count", "20"), 1, 200, 20);
  const minScore = clampInt(getArg("minScore", "60"), 0, 100, 60);

  const q = await pool.query(
    `
    SELECT id, viral_score
    FROM drafts
    WHERE status='pending'
      AND viral_score IS NOT NULL
      AND viral_score >= $1
    ORDER BY viral_score DESC, created_at ASC
    LIMIT $2
    `,
    [minScore, count]
  );

  console.log(`✅ Candidates (>=${minScore}): ${q.rowCount}`);

  let approved = 0;
  for (const r of q.rows) {
    await pool.query(`UPDATE drafts SET status='approved' WHERE id=$1`, [r.id]);
    approved++;
  }

  console.log(`🚀 Approved=${approved}`);
  await pool.end();
}

run().catch((e) => {
  console.error("❌ auto-approve-top error:", e);
  process.exit(1);
});