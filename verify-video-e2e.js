require("dotenv").config();
const { Pool } = require("pg");
const { buildUploadCandidate } = require("./x-media-upload");

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL yok");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function getArg(name, fallback = null) {
  const arg = process.argv.find((x) => x.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.split("=").slice(1).join("=") || fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function printHelp() {
  console.log(`
Doğrulama:
  node verify-video-e2e.js --draftId=123

Seçenekler:
  --draftId=<id>   Kontrol edilecek draft
  --help           Yardımı göster
`);
}

async function loadReport(draftId) {
  const r = await pool.query(
    `
    SELECT
      d.id,
      d.status AS draft_status,
      d.comment_tr,
      d.translation_tr,
      d.viral_score,
      t.tweet_id,
      t.source_handle,
      t.x_url,
      t.media,
      q.id AS queue_id,
      q.status AS queue_status,
      q.scheduled_at,
      q.attempts,
      q.last_error,
      h.id AS history_id,
      h.posted_at,
      h.x_post_id
    FROM drafts d
    LEFT JOIN tweets t ON t.tweet_id = d.tweet_id
    LEFT JOIN LATERAL (
      SELECT id, status, scheduled_at, attempts, last_error
      FROM queue
      WHERE draft_id = d.id
      ORDER BY id DESC
      LIMIT 1
    ) q ON true
    LEFT JOIN LATERAL (
      SELECT id, posted_at, x_post_id
      FROM history
      WHERE draft_id = d.id
      ORDER BY id DESC
      LIMIT 1
    ) h ON true
    WHERE d.id = $1
    LIMIT 1
    `,
    [draftId]
  );

  return r.rows[0] || null;
}

async function run() {
  if (hasFlag("help")) {
    printHelp();
    await pool.end();
    return;
  }

  const draftId = Number(getArg("draftId", ""));
  if (!Number.isFinite(draftId) || draftId < 1) {
    throw new Error("--draftId gerekli");
  }

  const row = await loadReport(draftId);
  if (!row) {
    throw new Error(`Draft bulunamadi: ${draftId}`);
  }

  let mediaType = "none";
  try {
    const candidate = buildUploadCandidate(row.media);
    mediaType = candidate?.type || "none";
  } catch {
    mediaType = "video_missing_variant";
  }

  console.log("=== VIDEO E2E RAPOR ===");
  console.log(`draft_id=${row.id}`);
  console.log(`tweet_id=${row.tweet_id || "-"}`);
  console.log(`source=${row.source_handle || "-"}`);
  console.log(`draft_status=${row.draft_status}`);
  console.log(`media_type=${mediaType}`);
  console.log(`queue_id=${row.queue_id || "-"}`);
  console.log(`queue_status=${row.queue_status || "-"}`);
  console.log(`scheduled_at=${row.scheduled_at || "-"}`);
  console.log(`attempts=${row.attempts ?? "-"}`);
  console.log(`history_id=${row.history_id || "-"}`);
  console.log(`posted_at=${row.posted_at || "-"}`);
  console.log(`x_post_id=${row.x_post_id || "-"}`);

  if (row.last_error) {
    console.log(`last_error=${row.last_error}`);
  }

  if (row.history_id && row.draft_status === "posted") {
    console.log("✅ PASS: draft history'ye yazildi ve posted durumuna gecti.");
  } else if (row.queue_status === "failed") {
    console.log("❌ FAIL: queue failed durumunda.");
  } else if (row.queue_status === "waiting" || row.queue_status === "processing") {
    console.log("⏳ BEKLIYOR: worker henuz tamamlamamis olabilir.");
  } else {
    console.log("ℹ️ Durum ara asamada veya manuel inceleme gerekli.");
  }

  await pool.end();
}

run().catch(async (e) => {
  console.error("❌ verify-video-e2e hata:", e.message || e);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
