require("dotenv").config();
const { Pool } = require("pg");
const { composeDraftText } = require("./draft-format");
const OAuth = require("oauth-1.0a");
const crypto = require("crypto");

const API_BASE = process.env.X_API_BASE || "https://api.twitter.com";
const POLL_SECONDS = Number(process.env.WORKER_POLL_SECONDS || 30);
const MAX_ATTEMPTS = Number(process.env.WORKER_MAX_ATTEMPTS || 5);
const DRY_RUN = String(process.env.WORKER_DRY_RUN || "false").toLowerCase() === "true";

const X_CONSUMER_KEY = process.env.X_CONSUMER_KEY || "";
const X_CONSUMER_SECRET = process.env.X_CONSUMER_SECRET || "";
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN || "";
const X_ACCESS_SECRET = process.env.X_ACCESS_SECRET || "";

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL yok");
  process.exit(1);
}
if (!X_CONSUMER_KEY || !X_CONSUMER_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_SECRET) {
  console.error("❌ OAuth1a env eksik: X_CONSUMER_KEY/SECRET + X_ACCESS_TOKEN/SECRET lazım");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const oauth = new OAuth({
  consumer: { key: X_CONSUMER_KEY, secret: X_CONSUMER_SECRET },
  signature_method: "HMAC-SHA1",
  hash_function(base_string, key) {
    return crypto.createHmac("sha1", key).update(base_string).digest("base64");
  },
});

const token = { key: X_ACCESS_TOKEN, secret: X_ACCESS_SECRET };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function xPostTweet(text) {
  const url = `${API_BASE}/2/tweets`;
  const body = { text };

  if (DRY_RUN) {
    console.log("🟡 DRY_RUN tweet:", text);
    return { id: `dry_${Date.now()}` };
  }

  const request_data = { url, method: "POST" };
  const authHeader = oauth.toHeader(oauth.authorize(request_data, token));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let json = null;
  try { json = JSON.parse(raw); } catch (_) {}

  if (!res.ok) {
    const err = new Error(`X API error ${res.status}: ${raw}`);
    err.status = res.status;
    err.raw = raw;
    err.json = json;
    err.headers = res.headers;
    throw err;
  }

  return json?.data || json;
}

function classifyRetry(err) {
  const s = err?.status;
  if (s === 402) return { retryable: false, waitMs: 0, reason: "credits" };
  if (s === 401 || s === 403) return { retryable: false, waitMs: 0, reason: "auth" };
  if (s === 429) {
    let wait = 60_000;
    const ra = err.headers?.get?.("retry-after");
    if (ra) wait = Number(ra) * 1000;
    return { retryable: true, waitMs: Math.max(wait, 30_000), reason: "rate_limit" };
  }
  if (s >= 500 && s <= 599) return { retryable: true, waitMs: 30_000, reason: "server" };
  if (!s) return { retryable: true, waitMs: 15_000, reason: "network" };
  return { retryable: false, waitMs: 0, reason: "client" };
}

async function takeOneDueJob() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const q = await client.query(
      `
      SELECT id, draft_id, scheduled_at, attempts
      FROM queue
      WHERE status='waiting'
        AND scheduled_at <= NOW()
      ORDER BY scheduled_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
      `
    );
    if (q.rowCount === 0) {
      await client.query("COMMIT");
      return null;
    }
    const job = q.rows[0];
    const nextAttempts = (job.attempts || 0) + 1;

    await client.query(
      `UPDATE queue SET status='processing', attempts=$2, updated_at=NOW() WHERE id=$1`,
      [job.id, nextAttempts]
    );
    await client.query("COMMIT");
    return { ...job, attempts: nextAttempts };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function loadDraft(draftId) {
  const r = await pool.query(
    `SELECT d.id, d.tweet_id, d.comment_tr, d.translation_tr, d.format_key, d.status, t.x_url
     FROM drafts d
     LEFT JOIN tweets t ON t.tweet_id = d.tweet_id
     WHERE d.id=$1`,
    [draftId]
  );
  return r.rowCount ? r.rows[0] : null;
}

function composeFinalText(d) {
  return composeDraftText(d.comment_tr, d.translation_tr, d.format_key, d.x_url);
}

async function isAlreadyPosted(draftId) {
  const r = await pool.query(`SELECT 1 FROM history WHERE draft_id=$1 LIMIT 1`, [draftId]);
  return r.rowCount > 0;
}

async function markQueueDone(id) {
  await pool.query(`UPDATE queue SET status='done', updated_at=NOW(), last_error=NULL WHERE id=$1`, [id]);
}
async function markQueueFailed(id, msg) {
  await pool.query(`UPDATE queue SET status='failed', updated_at=NOW(), last_error=$2 WHERE id=$1`, [id, (msg||"").slice(0,2000)]);
}
async function returnToWaitingWithDelay(id, delayMs, msg) {
  await pool.query(
    `UPDATE queue
     SET status='waiting',
         scheduled_at = NOW() + ($2 || ' milliseconds')::interval,
         updated_at=NOW(),
         last_error=$3
     WHERE id=$1`,
    [id, String(delayMs), (msg||"").slice(0,2000)]
  );
}

async function writeHistory(draftId, xPostId) {
  await pool.query(
    `INSERT INTO history (draft_id, posted_at, x_post_id) VALUES ($1, NOW(), $2)`,
    [draftId, xPostId || null]
  );
}
async function markDraftPosted(draftId) {
  await pool.query(`UPDATE drafts SET status='posted' WHERE id=$1`, [draftId]);
}

async function tick() {
  const job = await takeOneDueJob();
  if (!job) return false;

  const { id: queueId, draft_id: draftId, attempts } = job;

  try {
    const draft = await loadDraft(draftId);
    if (!draft) {
      await markQueueFailed(queueId, "Draft not found");
      return true;
    }

    if (await isAlreadyPosted(draftId) || draft.status === "posted") {
      await markQueueDone(queueId);
      return true;
    }

    const text = composeFinalText(draft);
    if (!text) {
      await markQueueFailed(queueId, "Empty tweet text");
      return true;
    }
    if (text.length > 280) {
      await markQueueFailed(queueId, `Text too long: ${text.length}`);
      return true;
    }

    console.log(`🟢 Posting draft_id=${draftId} queue_id=${queueId} attempts=${attempts}`);
    const resp = await xPostTweet(text);
    const xId = resp?.id || null;

    await writeHistory(draftId, xId);
    await markDraftPosted(draftId);
    await markQueueDone(queueId);

    console.log(`✅ Posted draft_id=${draftId} x_post_id=${xId || "?"}`);
    return true;
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`❌ Post failed queue_id=${queueId} draft_id=${draftId}:`, msg);

    if (attempts >= MAX_ATTEMPTS) {
      await markQueueFailed(queueId, `Max attempts reached. Last: ${msg}`);
      return true;
    }

    const d = classifyRetry(err);
    if (!d.retryable) {
      await markQueueFailed(queueId, `Non-retryable (${d.reason}): ${msg}`);
      return true;
    }

    const base = d.waitMs || 15000;
    const backoff = base * Math.pow(2, Math.max(0, attempts - 1));
    const jitter = Math.floor(Math.random() * 5000);
    const waitMs = Math.min(backoff + jitter, 15 * 60 * 1000);

    await returnToWaitingWithDelay(queueId, waitMs, `Retry in ${waitMs}ms (${d.reason}): ${msg}`);
    return true;
  }
}

async function main() {
  console.log("🚀 Poster Worker (oauth-1.0a) başladı");
  console.log(`poll=${POLL_SECONDS}s maxAttempts=${MAX_ATTEMPTS} dryRun=${DRY_RUN}`);

  while (true) {
    try {
      let didWork = false;
      for (let i = 0; i < 5; i++) {
        const worked = await tick();
        if (!worked) break;
        didWork = true;
        await sleep(500);
      }
      if (!didWork) await sleep(POLL_SECONDS * 1000);
    } catch (e) {
      console.error("❌ Worker loop error:", e?.message || e);
      await sleep(10_000);
    }
  }
}

main().catch((e) => {
  console.error("❌ Fatal:", e);
  process.exit(1);
});