/**
 * poster-worker.js (PRO - SAFE + SINGLETON)
 * - Queue'dan zamanı gelen 1 işi alır (SKIP LOCKED)
 * - AKTİF SAATLER: 06:00 - 01:00 (TR) dışında post atmaz
 * - MIN ARALIK: 57 dakika dolmadan yeni post atmaz (history + local cooldown)
 * - TEK WORKER KİLİDİ: pg_advisory_lock ile aynı anda 2 worker çalışamaz
 * - X'e post atar (OAuth2 user token veya OAuth1a)
 * - history'ye yazar, draft status=posted yapar, queue status=done yapar
 * - retry + backoff + rate limit yönetir
 *
 * Çalıştır:
 *   node poster-worker.js
 */

require("dotenv").config();
const { Pool } = require("pg");
const crypto = require("crypto");
const { uploadMediaFromStoredMedia } = require("./x-media-upload");
const { composeDraftText, isSourceLinkFallbackFormat } = require("./draft-format");
const {
  ensureScheduleSettingsTable,
  getScheduleSettings,
  formatHourLabel,
} = require("./schedule-settings");

const API_BASE = process.env.X_API_BASE || "https://api.twitter.com";

const POLL_SECONDS = Number(process.env.WORKER_POLL_SECONDS || 30);
const MAX_ATTEMPTS = Number(process.env.WORKER_MAX_ATTEMPTS || 5);
const DRY_RUN =
  String(process.env.WORKER_DRY_RUN || "false").toLowerCase() === "true";

// OAuth2 User token (Authorization: Bearer <USER_TOKEN>)
const X_USER_BEARER = process.env.X_USER_BEARER || "";

// OAuth 1.0a creds
const X_CONSUMER_KEY = process.env.X_CONSUMER_KEY || "";
const X_CONSUMER_SECRET = process.env.X_CONSUMER_SECRET || "";
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN || "";
const X_ACCESS_SECRET = process.env.X_ACCESS_SECRET || "";
const X_AUTH = {
  userBearer: X_USER_BEARER,
  consumerKey: X_CONSUMER_KEY,
  consumerSecret: X_CONSUMER_SECRET,
  accessToken: X_ACCESS_TOKEN,
  accessSecret: X_ACCESS_SECRET,
};

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

function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => {
    return "%" + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

function buildOAuth1Header(method, url) {
  const oauthParams = {
    oauth_consumer_key: X_CONSUMER_KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };

  const baseUrl = url.split("?")[0];

  const paramString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(paramString),
  ].join("&");

  const signingKey = `${percentEncode(X_CONSUMER_SECRET)}&${percentEncode(
    X_ACCESS_SECRET
  )}`;

  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  oauthParams.oauth_signature = signature;

  const header =
    "OAuth " +
    Object.keys(oauthParams)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
      .join(", ");

  return header;
}

function hasOAuth2UserToken() {
  return !!X_USER_BEARER && X_USER_BEARER.length > 20;
}

function hasOAuth1a() {
  return (
    !!X_CONSUMER_KEY &&
    !!X_CONSUMER_SECRET &&
    !!X_ACCESS_TOKEN &&
    !!X_ACCESS_SECRET
  );
}

function isWithinActiveWindow(scheduleSettings, d = new Date()) {
  const h = d.getHours();
  const start = scheduleSettings.activeStartHour;
  const end = scheduleSettings.activeEndHour;

  if (start === end) return true; // 24 saat

  if (start < end) return h >= start && h < end;
  return h >= start || h < end; // wrap
}

function minutesUntilNextActive(scheduleSettings, d = new Date()) {
  const start = scheduleSettings.activeStartHour;
  const now = new Date(d);

  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(start, 0, 0, 0);

  if (now.getTime() >= next.getTime()) next.setDate(next.getDate() + 1);
  return Math.ceil((next.getTime() - now.getTime()) / 60000);
}

async function getLastPostedAtFromDb() {
  const r = await pool.query(
    `SELECT posted_at FROM history ORDER BY posted_at DESC LIMIT 1`
  );
  if (r.rowCount === 0) return null;
  return new Date(r.rows[0].posted_at);
}

// ✅ Local cooldown: DB gecikse bile aynı process ikinci post'u engeller
let lastPostedAtLocal = null;

async function ensureCooldownAndWindow() {
  const scheduleSettings = await getScheduleSettings(pool);
  const now = new Date();

  // 1) aktif pencere
  if (!isWithinActiveWindow(scheduleSettings, now)) {
    const mins = minutesUntilNextActive(scheduleSettings, now);
    console.log(
      `⏸️ Aktif saat dışında. Sonraki aktif başlangıca ~${mins} dk. (start=${formatHourLabel(
        scheduleSettings.activeStartHour
      )})`
    );
    await sleep(Math.max(60_000, mins * 60_000));
    return false;
  }

  // 2) min aralık (DB + Local)
  let lastDb = null;
  try {
    lastDb = await getLastPostedAtFromDb();
  } catch (e) {
    // DB anlık okunamazsa local ile yine frenleriz
  }

  const last =
    lastPostedAtLocal && lastDb
      ? new Date(Math.max(lastPostedAtLocal.getTime(), lastDb.getTime()))
      : (lastPostedAtLocal || lastDb);

  if (last) {
    const diffMs = now.getTime() - last.getTime();
    const minMs = scheduleSettings.minPostIntervalMinutes * 60_000;

    if (diffMs < minMs) {
      const waitMs = minMs - diffMs;
      const waitMin = Math.ceil(waitMs / 60_000);
      console.log(
        `⏸️ Cooldown: Son post ${Math.floor(
          diffMs / 60_000
        )} dk önce. En az ${
          scheduleSettings.minPostIntervalMinutes
        } dk olmalı. ~${waitMin} dk bekliyorum.`
      );
      await sleep(Math.max(30_000, waitMs));
      return false;
    }
  }

  return true;
}

async function xPostTweet(text, mediaIds = []) {
  const url = `${API_BASE}/2/tweets`;
  const payload = { text };

  if (Array.isArray(mediaIds) && mediaIds.length > 0) {
    payload.media = {
      media_ids: mediaIds.map(String),
    };
  }

  if (DRY_RUN) {
    console.log("🟡 DRY_RUN tweet:", text);
    return { id: `dry_${Date.now()}`, dryRun: true };
  }

  const headers = { "Content-Type": "application/json" };

  // OAuth 1a öncelikli: Bearer (App-Only) post atmaya yetmez, 403 döner
  if (hasOAuth1a()) {
    headers["Authorization"] = buildOAuth1Header("POST", url);
  } else if (hasOAuth2UserToken()) {
    headers["Authorization"] = `Bearer ${X_USER_BEARER}`;
  } else {
    throw new Error(
      "X auth yok: Tweet atmak için OAuth1a (X_CONSUMER_KEY/.../X_ACCESS_SECRET) veya X_USER_BEARER gerekli."
    );
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const textBody = await res.text();
  let json = null;
  try {
    json = JSON.parse(textBody);
  } catch (_) {}

  if (!res.ok) {
    const err = new Error(
      `X API error ${res.status}: ${textBody?.slice(0, 500) || ""}`
    );
    err.status = res.status;
    err.body = textBody;
    err.json = json;
    err.headers = res.headers;
    throw err;
  }

  return json?.data || json;
}

function classifyRetry(err) {
  const status = err?.status;

  if (status === 402) return { retryable: false, waitMs: 0, reason: "credits_depleted" };
  if (status === 401 || status === 403) return { retryable: false, waitMs: 0, reason: "auth" };

  if (status === 429) {
    let wait = 60_000;
    try {
      const ra = err.headers?.get("retry-after");
      if (ra) wait = Number(ra) * 1000;
    } catch (_) {}
    return { retryable: true, waitMs: Math.max(wait, 30_000), reason: "rate_limit" };
  }

  if (status >= 500 && status <= 599) return { retryable: true, waitMs: 30_000, reason: "server" };
  if (!status) return { retryable: true, waitMs: 15_000, reason: "network" };

  return { retryable: false, waitMs: 0, reason: "client" };
}

async function takeOneDueJob() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Node Date kullan - scheduling ile ayni timezone (DB NOW() timezone uyumsuzlugu onlenir)
    const now = new Date();
    const q = await client.query(
      `
      SELECT id, draft_id, scheduled_at, attempts
      FROM queue
      WHERE status='waiting'
        AND scheduled_at <= $1
      ORDER BY scheduled_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
      `,
      [now]
    );

    if (q.rowCount === 0) {
      const countRes = await client.query(
        `SELECT COUNT(*) AS c FROM queue WHERE status='waiting'`
      );
      const waitingCount = countRes.rows?.[0]?.c ?? 0;
      if (waitingCount > 0) {
        const sample = await client.query(
          `SELECT id, draft_id, scheduled_at FROM queue WHERE status='waiting' ORDER BY scheduled_at ASC LIMIT 1`
        );
        const s = sample.rows?.[0];
        console.log(
          `⏳ Due job yok. now=${now.toISOString()} waiting=${waitingCount} en_yakın_scheduled=${s?.scheduled_at || "?"}`
        );
      }
      await client.query("COMMIT");
      return null;
    }

    const job = q.rows[0];
    const nextAttempts = (job.attempts || 0) + 1;

    await client.query(
      `
      UPDATE queue
      SET status='processing',
          attempts=$2,
          updated_at=NOW()
      WHERE id=$1
      `,
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
    `
    SELECT d.id, d.tweet_id, d.comment_tr, d.translation_tr, d.format_key, d.status, t.media, t.x_url
    FROM drafts d
    LEFT JOIN tweets t ON t.tweet_id = d.tweet_id
    WHERE d.id=$1
    `,
    [draftId]
  );
  if (r.rowCount === 0) return null;
  return r.rows[0];
}

function composeFinalText(draft) {
  return composeDraftText(
    draft.comment_tr,
    draft.translation_tr,
    draft.format_key,
    draft.x_url
  );
}

async function isAlreadyPosted(draftId) {
  const r = await pool.query(`SELECT 1 FROM history WHERE draft_id=$1 LIMIT 1`, [draftId]);
  return r.rowCount > 0;
}

async function markQueueDone(queueId) {
  await pool.query(
    `UPDATE queue SET status='done', updated_at=NOW(), last_error=NULL WHERE id=$1`,
    [queueId]
  );
}

async function markQueueFailed(queueId, msg) {
  await pool.query(
    `UPDATE queue SET status='failed', updated_at=NOW(), last_error=$2 WHERE id=$1`,
    [queueId, msg?.slice(0, 2000) || "failed"]
  );
}

async function returnToWaitingWithDelay(queueId, delayMs, msg) {
  await pool.query(
    `
    UPDATE queue
    SET status='waiting',
        scheduled_at = NOW() + ($2 || ' milliseconds')::interval,
        updated_at=NOW(),
        last_error=$3
    WHERE id=$1
    `,
    [queueId, String(delayMs), msg?.slice(0, 2000) || null]
  );
}

async function writeHistory(draftId, xPostId) {
  await pool.query(
    `INSERT INTO history (draft_id, posted_at, x_post_id)
     VALUES ($1, NOW(), $2)`,
    [draftId, xPostId || null]
  );
}

async function markDraftPosted(draftId) {
  await pool.query(`UPDATE drafts SET status='posted' WHERE id=$1`, [draftId]);
}

async function tickOnce() {
  const okToRun = await ensureCooldownAndWindow();
  if (!okToRun) return false;

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
    if (!text || text.trim().length < 1) {
      await markQueueFailed(queueId, "Empty tweet text");
      return true;
    }

    if (text.length > 280) {
      await markQueueFailed(queueId, `Text too long: ${text.length}`);
      return true;
    }

    console.log(`🟢 Posting draft_id=${draftId} queue_id=${queueId} attempts=${attempts}`);

    const uploadedMedia = isSourceLinkFallbackFormat(draft.format_key)
      ? null
      : await uploadMediaFromStoredMedia(draft.media, X_AUTH, {
          dryRun: DRY_RUN,
        });
    const mediaIds = uploadedMedia ? [uploadedMedia.mediaId] : [];
    const resp = await xPostTweet(text, mediaIds);
    const xId = resp?.id || resp?.data?.id || null;

    await writeHistory(draftId, xId);
    await markDraftPosted(draftId);
    await markQueueDone(queueId);

    // ✅ local cooldown'u anında güncelle (DB'yi beklemeden)
    lastPostedAtLocal = new Date();

    console.log(
      `✅ Posted draft_id=${draftId} x_post_id=${xId || "?"} media=${
        uploadedMedia?.type || "none"
      }`
    );
    return true;
  } catch (err) {
    const msg = err?.message ? err.message : String(err);
    console.error(`❌ Post failed queue_id=${queueId} draft_id=${draftId}:`, msg);

    if (attempts >= MAX_ATTEMPTS) {
      await markQueueFailed(queueId, `Max attempts reached. Last: ${msg}`);
      return true;
    }

    const decision = classifyRetry(err);
    if (!decision.retryable) {
      await markQueueFailed(queueId, `Non-retryable (${decision.reason}): ${msg}`);
      return true;
    }

    const base = decision.waitMs || 15000;
    const backoff = base * Math.pow(2, Math.max(0, attempts - 1));
    const jitter = Math.floor(Math.random() * 5000);
    const waitMs = Math.min(backoff + jitter, 15 * 60 * 1000);

    await returnToWaitingWithDelay(
      queueId,
      waitMs,
      `Retry in ${waitMs}ms (${decision.reason}): ${msg}`
    );
    return true;
  }
}

// ✅ TEK WORKER KİLİDİ: aynı DB'de aynı anda 2 worker çalıştırmayı engeller
// Deploy sonrası eski process'in lock'u PostgreSQL tarafından temizlenene kadar retry
const LOCK_KEY = 909090;
const LOCK_MAX_RETRIES = 5;
const LOCK_RETRY_DELAY_MS = 5000;

async function acquireSingletonLock() {
  for (let attempt = 1; attempt <= LOCK_MAX_RETRIES; attempt++) {
    const client = await pool.connect();
    try {
      const r = await client.query(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK_KEY]);
      const ok = r.rows?.[0]?.ok === true;

      if (ok) {
        console.log("🔒 Singleton lock alındı. (Tek worker çalışacak)");
        return client;
      }

      client.release();
      if (attempt < LOCK_MAX_RETRIES) {
        console.log(
          `⏳ Lock alınamadı (deploy sonrası olabilir). ${LOCK_RETRY_DELAY_MS / 1000}s sonra tekrar (${attempt}/${LOCK_MAX_RETRIES})`
        );
        await sleep(LOCK_RETRY_DELAY_MS);
      }
    } catch (e) {
      client.release();
      throw e;
    }
  }

  console.error("❌ Başka bir poster-worker zaten çalışıyor (advisory lock alınamadı). Çıkıyorum.");
  process.exit(2);
}

async function main() {
  await ensureScheduleSettingsTable(pool);
  const scheduleSettings = await getScheduleSettings(pool);
  console.log("🚀 Poster Worker başladı");
  console.log(
    `poll=${POLL_SECONDS}s maxAttempts=${MAX_ATTEMPTS} dryRun=${DRY_RUN} | window=${formatHourLabel(
      scheduleSettings.activeStartHour
    )}-${formatHourLabel(
      scheduleSettings.activeEndHour
    )} | minInterval=${scheduleSettings.minPostIntervalMinutes}m`
  );

  if (!hasOAuth1a() && !hasOAuth2UserToken()) {
    console.log("⚠️ Tweet atmak için OAuth1a (X_CONSUMER_KEY/.../X_ACCESS_SECRET) veya X_USER_BEARER gerekli.");
  } else if (hasOAuth1a()) {
    console.log("✅ Post auth: OAuth 1.0a (önerilen)");
  } else {
    console.log("✅ Post auth: Bearer (OAuth 2.0 User Context gerekli, App-Only yetmez)");
  }

  // ✅ lock
  await acquireSingletonLock();

  while (true) {
    try {
      const worked = await tickOnce();

      if (!worked) {
        await sleep(POLL_SECONDS * 1000);
      } else {
        await sleep(2_000);
      }
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