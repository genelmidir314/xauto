/**
 * follow-worker.js
 * - follow_queue tablosundan sırayla pending kayıtları alır
 * - Belirli aralıklarla (FOLLOW_INTERVAL_MINUTES) takip eder
 * - OAuth 1.0a veya X_USER_BEARER ile user context gerekli
 *
 * Çalıştır: node follow-worker.js
 * Devre dışı: XAUTO_SKIP_FOLLOW_WORKER=true
 */

require("dotenv").config();
const { Pool } = require("pg");
const { getUserId } = require("./x-api");
const { getMe, followUser } = require("./lib/x-follow");

const POLL_SECONDS = Number(process.env.FOLLOW_POLL_SECONDS || 60);
const INTERVAL_MINUTES = Number(process.env.FOLLOW_INTERVAL_MINUTES || 10);
const DRY_RUN =
  String(process.env.FOLLOW_DRY_RUN || "false").toLowerCase() === "true";

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL yok");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function takeNextPending() {
  const r = await pool.query(
    `
    SELECT id, handle
    FROM follow_queue
    WHERE status = 'pending'
      AND (next_follow_at IS NULL OR next_follow_at <= NOW())
    ORDER BY id ASC
    LIMIT 1
    `
  );
  return r.rows[0] || null;
}

async function markFollowed(id) {
  await pool.query(
    `
    UPDATE follow_queue
    SET status = 'followed',
        followed_at = NOW(),
        last_error = NULL,
        next_follow_at = NULL
    WHERE id = $1
    `,
    [id]
  );
}

async function markFailed(id, errorMsg, retryAt) {
  await pool.query(
    `
    UPDATE follow_queue
    SET last_error = $2,
        next_follow_at = $3
    WHERE id = $1
    `,
    [id, String(errorMsg || "").slice(0, 500), retryAt]
  );
}

async function runOne() {
  const row = await takeNextPending();
  if (!row) return false;

  const { id, handle } = row;
  const cleanHandle = String(handle || "").trim().replace(/^@/, "");
  if (!cleanHandle) {
    await markFailed(id, "Handle bos", null);
    return true;
  }

  try {
    const targetUserId = await getUserId(cleanHandle);
    const myUserId = await getMe();

    if (DRY_RUN) {
      console.log(`🟡 DRY_RUN: @${cleanHandle} (${targetUserId}) takip edilecek`);
      await markFollowed(id);
      return true;
    }

    await followUser(myUserId, targetUserId);
    await markFollowed(id);
    console.log(`✅ @${cleanHandle} takip edildi`);
    return true;
  } catch (e) {
    const msg = e?.message || String(e);
    const retryAt = new Date(Date.now() + INTERVAL_MINUTES * 60 * 1000);
    await markFailed(id, msg, retryAt);
    console.log(`❌ @${cleanHandle}: ${msg}`);
    return true;
  }
}

async function loop() {
  const started = await runOne();
  if (!started) {
    await sleep(POLL_SECONDS * 1000);
    return;
  }
  // Bir takip yaptıysak, aralık kadar bekle
  await sleep(INTERVAL_MINUTES * 60 * 1000);
}

async function main() {
  if (process.env.XAUTO_SKIP_FOLLOW_WORKER === "true") {
    console.log("Follow worker atlanıyor (XAUTO_SKIP_FOLLOW_WORKER=true)");
    process.exit(0);
  }

  console.log(
    `🚀 Follow worker başladı. Aralık: ${INTERVAL_MINUTES} dk, poll: ${POLL_SECONDS} sn${DRY_RUN ? " [DRY_RUN]" : ""}`
  );

  for (;;) {
    try {
      await loop();
    } catch (e) {
      console.error("Follow worker hata:", e?.message || e);
      await sleep(POLL_SECONDS * 1000);
    }
  }
}

main().catch((e) => {
  console.error("❌ Follow worker:", e);
  process.exit(1);
});
