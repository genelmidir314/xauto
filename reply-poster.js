/**
 * reply-poster.js
 * reply_queue'dan sırayla reply atar.
 * Post sisteminden tamamen bağımsız.
 *
 * Çalıştır: node reply-poster.js
 * Devre dışı: XAUTO_SKIP_REPLY_POSTER=true
 */

require("dotenv").config();
const { Pool } = require("pg");
const { postReply } = require("./lib/x-reply");

const POLL_SECONDS = Number(process.env.REPLY_POLL_SECONDS || 60);
const INTERVAL_MINUTES = Number(process.env.REPLY_INTERVAL_MINUTES || 5);
const DRY_RUN =
  String(process.env.REPLY_DRY_RUN || "false").toLowerCase() === "true";

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

async function takeOneDueJob() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `
      SELECT q.id AS queue_id, q.draft_id, d.tweet_id, d.reply_text
      FROM reply_queue q
      JOIN reply_drafts d ON d.id = q.draft_id
      WHERE q.status = 'waiting'
        AND q.scheduled_at <= NOW()
      ORDER BY q.scheduled_at ASC
      LIMIT 1
      FOR UPDATE OF q SKIP LOCKED
      `
    );
    const job = r.rows[0] || null;
    if (job) {
      await client.query(
        `UPDATE reply_queue SET status = 'processing' WHERE id = $1`,
        [job.queue_id]
      );
    }
    await client.query("COMMIT");
    return job;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function markDone(queueId) {
  await pool.query(
    `UPDATE reply_queue SET status = 'done', last_error = NULL WHERE id = $1`,
    [queueId]
  );
}

async function markFailed(queueId, msg) {
  await pool.query(
    `UPDATE reply_queue SET status = 'failed', last_error = $2 WHERE id = $1`,
    [queueId, String(msg || "").slice(0, 500)]
  );
}

async function markDraftPosted(draftId) {
  await pool.query(
    `UPDATE reply_drafts SET status = 'posted' WHERE id = $1`,
    [draftId]
  );
}

async function writeHistory(draftId, xReplyId) {
  await pool.query(
    `INSERT INTO reply_history (draft_id, posted_at, x_reply_id) VALUES ($1, NOW(), $2)`,
    [draftId, xReplyId || null]
  );
}

async function runOne() {
  const job = await takeOneDueJob();
  if (!job) return false;

  const { queue_id, draft_id, tweet_id, reply_text } = job;

  try {
    if (DRY_RUN) {
      console.log(`🟡 DRY_RUN reply: "${reply_text?.slice(0, 50)}..." -> ${tweet_id}`);
    } else {
      const result = await postReply(reply_text, tweet_id);
      const xReplyId = result?.id;

      await writeHistory(draft_id, xReplyId);
      await markDraftPosted(draft_id);
    }

    await markDone(queue_id);
    console.log(`✅ Reply atıldı: ${tweet_id}`);
  } catch (e) {
    await markFailed(queue_id, e?.message || e);
    console.log(`❌ Reply hata: ${e?.message || e}`);
  }

  return true;
}

async function loop() {
  const didWork = await runOne();
  if (didWork) {
    await sleep(INTERVAL_MINUTES * 60 * 1000);
  } else {
    await sleep(POLL_SECONDS * 1000);
  }
}

async function main() {
  if (process.env.XAUTO_SKIP_REPLY_POSTER === "true") {
    console.log("Reply poster atlanıyor (XAUTO_SKIP_REPLY_POSTER=true)");
    process.exit(0);
  }

  console.log(
    `🚀 Reply poster başladı. Aralık: ${INTERVAL_MINUTES} dk${DRY_RUN ? " [DRY_RUN]" : ""}`
  );

  for (;;) {
    try {
      await loop();
    } catch (e) {
      console.error("Reply poster hata:", e?.message || e);
      await sleep(POLL_SECONDS * 1000);
    }
  }
}

main().catch((e) => {
  console.error("❌ Reply poster:", e);
  process.exit(1);
});
