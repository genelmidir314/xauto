// bulk-queue.js
// Amaç: pending veya approved draftları otomatik sıraya dizmek
// Kullanım örnekleri:
// node bulk-queue.js --status=pending --count=20 --gapMin=30
// node bulk-queue.js --status=approved --count=10 --gapMin=45

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
  const status = String(getArg("status", "approved")).toLowerCase(); // pending|approved
  const count = clampInt(getArg("count", "20"), 1, 200, 20);
  const gapMin = clampInt(getArg("gapMin", "30"), 5, 240, 30);

  if (!["pending", "approved"].includes(status)) {
    console.error("❌ --status sadece pending veya approved olabilir.");
    process.exit(1);
  }

  console.log(`✅ Bulk queue başlıyor: status=${status} count=${count} gapMin=${gapMin}`);

  // Kuyrukta bekleyen var mı? En sona eklemek için son scheduled_at’i bul
  const lastQ = await pool.query(
    `SELECT scheduled_at
     FROM queue
     WHERE status='waiting'
     ORDER BY scheduled_at DESC
     LIMIT 1`
  );

  let baseTime = new Date();
  if (lastQ.rowCount === 1 && lastQ.rows[0].scheduled_at) {
    const t = new Date(lastQ.rows[0].scheduled_at);
    if (t.getTime() > baseTime.getTime()) baseTime = t;
  }

  // Aday draftları çek (queue içinde olmayanlardan)
  const drafts = await pool.query(
    `SELECT d.id
     FROM drafts d
     WHERE d.status=$1
       AND NOT EXISTS (
         SELECT 1
         FROM queue q
         WHERE q.draft_id = d.id
       )
     ORDER BY created_at ASC
     LIMIT $2`,
    [status, count]
  );

  console.log("✅ Aday draft:", drafts.rowCount);

  let queued = 0;

  for (let i = 0; i < drafts.rows.length; i++) {
    const draftId = drafts.rows[i].id;

    const scheduledAt = new Date(baseTime.getTime() + gapMin * 60 * 1000 * (i + 1));

    // queue insert
    await pool.query(
      `INSERT INTO queue (draft_id, scheduled_at, status)
       VALUES ($1, $2, 'waiting')`,
      [draftId, scheduledAt]
    );

    queued++;
    console.log(`⏱️ queued draft_id=${draftId} at ${scheduledAt.toISOString()}`);
  }

  console.log(`🚀 Bitti. queued=${queued}`);
  await pool.end();
}

run().catch((e) => {
  console.error("❌ bulk-queue hata:", e);
  process.exit(1);
});