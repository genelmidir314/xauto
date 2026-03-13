/**
 * server.js (XAuto)
 * - Inbox UI
 * - Queue UI
 * - History UI
 * - Viral score + media
 * - Approve -> auto queue
 * - Post now
 * - Queue cancel
 * - Auto reschedule after cancel / add
 * - Media upload support for "Post now"
 * - Poster worker otomatik başlatılır (XAUTO_SKIP_POSTER_WORKER=true ile devre dışı)
 *
 * Çalıştır:
 *   node server.js
 */

require("dotenv").config();
const path = require("path");
const { spawn } = require("child_process");

const nodeDir = path.dirname(process.execPath);
const pathEnv = nodeDir + path.delimiter + (process.env.PATH || "");
const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");
const { inspectStoredMedia, uploadMediaFromStoredMedia } = require("./x-media-upload");
const {
  composeDraftText,
  isSourceLinkFallbackFormat,
} = require("./draft-format");
const {
  ensureScheduleSettingsTable,
  getScheduleSettings,
  updateScheduleSettings,
  formatHourLabel,
} = require("./schedule-settings");
const {
  SOURCE_TIER_CHECK_INTERVALS,
  clampTier,
  computeNextCheckAt,
  ensureSourcesManagementSchema,
  validateSourceInput,
} = require("./source-tier");
const {
  ensureCollectorMetricsSchema,
  getCollectorMetricsSummary,
} = require("./collector-metrics");
const { ensureTweetMediaValidationSchema } = require("./tweet-media-validation");
const { ensureNewsSchema } = require("./ensure-news-schema");
const { generateComment } = require("./lib/openai-comment");
const { renderPageShell } = require("./ui/common");
const { renderInboxPage } = require("./ui/inbox-page");
const { renderHistoryPage } = require("./ui/history-page");
const { renderSourcesPage } = require("./ui/sources-page");
const { renderCollectorPage } = require("./ui/collector-page");
const { renderFollowPage } = require("./ui/follow-page");
const { renderReplyPage } = require("./ui/reply-page");
const { renderNewsPage } = require("./ui/news-page");

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true }));

// Tarayici cache'ini devre disi birak (eski UI gosterimini onlemek icin)
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  next();
});

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL yok (.env içine koy)");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const PORT = process.env.PORT || 3000;
const WRITE_ACCESS_TOKEN = String(
  process.env.XAUTO_ADMIN_TOKEN || process.env.ADMIN_TOKEN || ""
).trim();

// ===== X AUTH =====
const API_BASE = process.env.X_API_BASE || "https://api.twitter.com";
const X_USER_BEARER = process.env.X_USER_BEARER || "";
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

function normalizeIp(ip) {
  const value = String(ip || "").trim();
  if (value.startsWith("::ffff:")) return value.slice(7);
  return value;
}

function isLoopbackAddress(ip) {
  const value = normalizeIp(ip);
  return value === "127.0.0.1" || value === "::1";
}

function getWriteAccessTokenFromRequest(req) {
  const headerToken = String(req.get("x-admin-token") || "").trim();
  if (headerToken) return headerToken;

  const authHeader = String(req.get("authorization") || "").trim();
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? String(match[1] || "").trim() : "";
}

function hasValidWriteAccessToken(req) {
  if (!WRITE_ACCESS_TOKEN) return false;

  const provided = getWriteAccessTokenFromRequest(req);
  if (!provided || provided.length !== WRITE_ACCESS_TOKEN.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(provided),
    Buffer.from(WRITE_ACCESS_TOKEN)
  );
}

function hasLocalWriteAccess(req) {
  return (
    isLoopbackAddress(req.ip) ||
    isLoopbackAddress(req.socket?.remoteAddress)
  );
}

function canPerformWrite(req) {
  return hasLocalWriteAccess(req) || hasValidWriteAccessToken(req);
}

app.use((req, res, next) => {
  if (req.method !== "POST") return next();
  if (canPerformWrite(req)) return next();

  return res.status(403).json({
    ok: false,
    error: WRITE_ACCESS_TOKEN
      ? "Yazma islemleri sadece localhost veya gecerli X-Admin-Token ile yapilabilir."
      : "Yazma islemleri varsayilan olarak sadece localhost'tan kabul edilir.",
  });
});

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtStatusPill(status) {
  const map = {
    pending: "pill pending",
    approved: "pill approved",
    queued: "pill queued",
    rejected: "pill rejected",
    posted: "pill posted",
  };
  return map[status] || "pill";
}

function composePreview(comment, translation, formatKey, xUrl) {
  return composeDraftText(comment, translation, formatKey, xUrl);
}

function formatDateTR(dateValue) {
  if (!dateValue) return "-";
  const d = new Date(dateValue);
  return d.toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtQueueStatusTR(status) {
  const map = {
    waiting: "beklemede",
    processing: "paylasiliyor",
    done: "tamamlandi",
    failed: "hata",
  };
  return map[status] || status;
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function clampUiLimit(value, fallback = 200) {
  const n = Number(value || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(50, Math.min(500, Math.trunc(n)));
}

function mediaHtml(media, xUrl) {
  if (!media) return "";

  let arr = media;
  if (typeof media === "string") {
    try {
      arr = JSON.parse(media);
    } catch {
      arr = null;
    }
  }

  if (!Array.isArray(arr) || arr.length === 0) return "";

  const items = arr
    .slice(0, 4)
    .map((m) => {
      const type = m?.type || "media";
      const url = m?.url || null;
      const preview = m?.preview_image_url || null;
      const alt = m?.alt_text || type;

      if (type === "photo" && url) {
        return `
        <div class="mediaItem">
          <img class="mediaImg" src="${esc(url)}" alt="${esc(
          alt
        )}" loading="lazy" />
        </div>
      `;
      }

      if ((type === "video" || type === "animated_gif") && preview) {
        return `
        <div class="mediaItem">
          <a class="mediaLink" href="${esc(
            xUrl || "#"
          )}" target="_blank" rel="noopener noreferrer">
            <img class="mediaImg" src="${esc(preview)}" alt="${esc(
          alt
        )}" loading="lazy" />
            <div class="mediaBadge">${esc(type.toUpperCase())}</div>
          </a>
        </div>
      `;
      }

      if (preview || url) {
        const thumb = preview || url;
        return `
        <div class="mediaItem">
          <a class="mediaLink" href="${esc(
            xUrl || "#"
          )}" target="_blank" rel="noopener noreferrer">
            <img class="mediaImg" src="${esc(thumb)}" alt="${esc(
          alt
        )}" loading="lazy" />
            <div class="mediaBadge">${esc(type.toUpperCase())}</div>
          </a>
        </div>
      `;
      }

      return "";
    })
    .join("");

  if (!items) return "";
  return `<div class="mediaGrid">${items}</div>`;
}

// =====================
// X POST HELPERS
// =====================
function percentEncode(str) {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
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

  return (
    "OAuth " +
    Object.keys(oauthParams)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
      .join(", ")
  );
}

function hasOAuth2UserToken() {
  return !!X_USER_BEARER && X_USER_BEARER.length > 20;
}

function hasOAuth1a() {
  return !!(
    X_CONSUMER_KEY &&
    X_CONSUMER_SECRET &&
    X_ACCESS_TOKEN &&
    X_ACCESS_SECRET
  );
}

async function xPostTweet(text, mediaIds = []) {
  const url = `${API_BASE}/2/tweets`;

  const headers = {
    "Content-Type": "application/json",
  };

  // Önce OAuth1a dene
  if (hasOAuth1a()) {
    headers.Authorization = buildOAuth1Header("POST", url);
  }
  // Sonra OAuth2 user-context bearer
  else if (hasOAuth2UserToken()) {
    headers.Authorization = `Bearer ${X_USER_BEARER}`;
  } else {
    throw new Error(
      "X auth eksik. Tweet atmak için OAuth1a veya OAuth2 user-context gerekli."
    );
  }

  const payload = { text };

  if (Array.isArray(mediaIds) && mediaIds.length > 0) {
    payload.media = {
      media_ids: mediaIds.map(String),
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text();
  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch {}

  if (!res.ok) {
    throw new Error(`X API error ${res.status}: ${bodyText.slice(0, 500)}`);
  }

  return json?.data || json;
}

async function uploadDraftMediaToX(media) {
  return uploadMediaFromStoredMedia(media, X_AUTH);
}

// =====================
// DB / SCHEDULE HELPERS
// =====================
async function getCounts() {
  const r = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM sources) AS sources,
      (SELECT COUNT(*)::int FROM tweets)  AS tweets,
      (SELECT COUNT(*)::int FROM drafts)  AS drafts,
      (SELECT COUNT(*)::int FROM queue)   AS queue,
      (SELECT COUNT(*)::int FROM history) AS history
  `);

  const rb = await pool.query(`
    SELECT
      CASE WHEN status='queued' THEN 'approved' ELSE status END AS status,
      COUNT(*)::int AS c
    FROM drafts
    GROUP BY 1
    ORDER BY status
  `);

  const approvedQ = await pool.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE d.status IN ('approved', 'queued')
      )::int AS total,
      COUNT(*) FILTER (
        WHERE d.status IN ('approved', 'queued') AND q.queue_id IS NULL
      )::int AS ready,
      COUNT(*) FILTER (
        WHERE d.status IN ('approved', 'queued') AND q.queue_id IS NOT NULL
      )::int AS queued
    FROM drafts d
    LEFT JOIN LATERAL (
      SELECT q1.id AS queue_id
      FROM queue q1
      WHERE q1.draft_id = d.id
      ORDER BY q1.id DESC
      LIMIT 1
    ) q ON true
  `);

  return {
    ...r.rows[0],
    drafts_by_status: rb.rows,
    approved_breakdown: approvedQ.rows[0],
  };
}

async function listSources(limit = 50) {
  const r = await pool.query(
    `
    SELECT
      id,
      handle,
      tier,
      category,
      active,
      x_user_id,
      last_tweet_id,
      last_checked_at,
      next_check_at,
      resolve_status,
      last_error,
      created_at
    FROM sources
    ORDER BY tier ASC, active DESC, next_check_at ASC NULLS FIRST, id ASC
    LIMIT $1
    `,
    [limit]
  );

  return r.rows.map((row) => ({
    ...row,
    tier: clampTier(row.tier),
  }));
}

function isWithinActiveWindow(date, scheduleSettings) {
  const h = date.getHours();
  const start = scheduleSettings.activeStartHour;
  const end = scheduleSettings.activeEndHour;

  if (start === end) return true;
  if (start < end) return h >= start && h < end;
  return h >= start || h < end;
}

function nextActiveStart(scheduleSettings, fromDate = new Date()) {
  const d = new Date(fromDate);
  const next = new Date(d);
  next.setSeconds(0, 0);
  next.setHours(scheduleSettings.activeStartHour, 0, 0, 0);

  if (d.getTime() >= next.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function normalizeToActiveWindow(date, scheduleSettings) {
  const d = new Date(date);
  if (isWithinActiveWindow(d, scheduleSettings)) return d;
  return nextActiveStart(scheduleSettings, d);
}

function maxDate(a, b) {
  return new Date(Math.max(new Date(a).getTime(), new Date(b).getTime()));
}

async function getSchedulingAnchor(scheduleSettingsArg) {
  const scheduleSettings = scheduleSettingsArg || (await getScheduleSettings(pool));
  const now = new Date();

  const anchorQ = await pool.query(`
    SELECT scheduled_at
    FROM queue
    WHERE status IN ('processing','done')
    ORDER BY scheduled_at DESC
    LIMIT 1
  `);

  if (anchorQ.rowCount === 0) {
    return normalizeToActiveWindow(now, scheduleSettings);
  }

  const anchor = new Date(anchorQ.rows[0].scheduled_at);
  // Gelecekteki anchor'ları engelle (hatalı veri / önceki bug)
  const effectiveAnchor = anchor.getTime() > now.getTime() ? now : anchor;
  const next = new Date(
    effectiveAnchor.getTime() + scheduleSettings.minPostIntervalMinutes * 60 * 1000
  );
  return normalizeToActiveWindow(maxDate(next, now), scheduleSettings);
}

async function rescheduleWaitingQueue(scheduleSettingsArg) {
  const scheduleSettings = scheduleSettingsArg || (await getScheduleSettings(pool));
  const waitingQ = await pool.query(`
    SELECT id, draft_id, scheduled_at
    FROM queue
    WHERE status = 'waiting'
    ORDER BY scheduled_at ASC, id ASC
  `);

  if (waitingQ.rowCount === 0) return 0;

  let slot = await getSchedulingAnchor(scheduleSettings);

  for (const row of waitingQ.rows) {
    await pool.query(
      `UPDATE queue SET scheduled_at=$2, updated_at=NOW() WHERE id=$1`,
      [row.id, slot]
    );

    slot = new Date(
      slot.getTime() + scheduleSettings.minPostIntervalMinutes * 60 * 1000
    );
    slot = normalizeToActiveWindow(slot, scheduleSettings);
  }

  return waitingQ.rowCount;
}

/** Sadece okuma - reschedule YAPMAZ. Dashboard/gösterim için. */
async function getNextSlotForDisplay(scheduleSettingsArg) {
  const scheduleSettings = scheduleSettingsArg || (await getScheduleSettings(pool));
  const lastWaiting = await pool.query(`
    SELECT scheduled_at
    FROM queue
    WHERE status = 'waiting'
    ORDER BY scheduled_at DESC
    LIMIT 1
  `);
  if (lastWaiting.rowCount > 0) {
    const next = new Date(
      new Date(lastWaiting.rows[0].scheduled_at).getTime() +
        scheduleSettings.minPostIntervalMinutes * 60 * 1000
    );
    return normalizeToActiveWindow(next, scheduleSettings);
  }
  return await getSchedulingAnchor(scheduleSettings);
}

async function computeNextScheduleAt(scheduleSettingsArg) {
  const scheduleSettings = scheduleSettingsArg || (await getScheduleSettings(pool));
  await rescheduleWaitingQueue(scheduleSettings);

  const lastWaiting = await pool.query(`
    SELECT scheduled_at
    FROM queue
    WHERE status = 'waiting'
    ORDER BY scheduled_at DESC
    LIMIT 1
  `);

  if (lastWaiting.rowCount === 0) {
    return await getSchedulingAnchor(scheduleSettings);
  }

  const next = new Date(
    new Date(lastWaiting.rows[0].scheduled_at).getTime() +
      scheduleSettings.minPostIntervalMinutes * 60 * 1000
  );
  return normalizeToActiveWindow(next, scheduleSettings);
}

async function enqueueDraft(draftId) {
  const exists = await pool.query(
    `SELECT id, scheduled_at, status FROM queue WHERE draft_id=$1 ORDER BY id DESC LIMIT 1`,
    [draftId]
  );

  if (exists.rowCount > 0) {
    return {
      alreadyQueued: true,
      scheduledAt: exists.rows[0].scheduled_at,
      queueStatus: exists.rows[0].status,
    };
  }

  const scheduledAt = await computeNextScheduleAt();

  await pool.query(
    `
    INSERT INTO queue (draft_id, scheduled_at, status, attempts, created_at, updated_at)
    VALUES ($1, $2, 'waiting', 0, NOW(), NOW())
    `,
    [draftId, scheduledAt]
  );

  await rescheduleWaitingQueue();

  const q = await pool.query(
    `SELECT scheduled_at, status FROM queue WHERE draft_id=$1 ORDER BY id DESC LIMIT 1`,
    [draftId]
  );

  return {
    alreadyQueued: false,
    scheduledAt: q.rows[0].scheduled_at,
    queueStatus: q.rows[0].status,
  };
}

async function cancelQueueItem(queueId) {
  const q = await pool.query(`SELECT id, draft_id, status FROM queue WHERE id=$1`, [
    queueId,
  ]);

  if (q.rowCount === 0) {
    throw new Error("Queue kaydı bulunamadı");
  }

  const item = q.rows[0];

  if (item.status === "processing") {
    throw new Error("Processing durumundaki kayıt iptal edilemez");
  }

  await pool.query(`DELETE FROM queue WHERE id=$1`, [queueId]);

  const draftState = await pool.query(`SELECT status FROM drafts WHERE id=$1`, [
    item.draft_id,
  ]);

  if (
    draftState.rowCount > 0 &&
    draftState.rows[0].status !== "posted" &&
    draftState.rows[0].status !== "rejected"
  ) {
    await pool.query(`UPDATE drafts SET status='rejected' WHERE id=$1`, [
      item.draft_id,
    ]);
  }

  const rescheduledCount = await rescheduleWaitingQueue();
  return { ok: true, draftId: item.draft_id, rescheduledCount };
}

async function loadDraftFull(draftId) {
  const r = await pool.query(
    `
    SELECT d.*, t.source_handle, t.x_url, t.media
    FROM drafts d
    LEFT JOIN tweets t ON t.tweet_id = d.tweet_id
    WHERE d.id=$1
    `,
    [draftId]
  );
  if (r.rowCount === 0) return null;
  return r.rows[0];
}

function buildFinalTextFromDraft(draft) {
  const comment = draft.use_comment !== false ? draft.comment_tr : "";
  return composeDraftText(
    comment,
    draft.translation_tr,
    draft.format_key,
    draft.x_url
  );
}

async function directPostDraftNow(draftId) {
  const draft = await loadDraftFull(draftId);
  if (!draft) throw new Error("Draft bulunamadı");

  const sourceLinkFallback = isSourceLinkFallbackFormat(draft.format_key);
  if (!sourceLinkFallback) {
    const mediaInspection = inspectStoredMedia(draft.media);
    if (!mediaInspection.ok) {
      throw new Error(mediaInspection.error || "Draft medyasi paylasim icin uygun degil.");
    }
  }

  const text = buildFinalTextFromDraft(draft);
  if (!text) throw new Error("Paylaşılacak metin boş");
  if (text.length > 280) throw new Error(`Metin çok uzun: ${text.length}`);

  const already = await pool.query(
    `SELECT 1 FROM history WHERE draft_id=$1 LIMIT 1`,
    [draftId]
  );
  if (already.rowCount > 0) {
    throw new Error("Bu draft zaten paylaşılmış");
  }

  const uploadedMedia = sourceLinkFallback ? null : await uploadDraftMediaToX(draft.media);
  const mediaIds = uploadedMedia ? [uploadedMedia.mediaId] : [];

  const posted = await xPostTweet(text, mediaIds);
  const xId = posted?.id || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const recheck = await client.query(
      `SELECT 1 FROM history WHERE draft_id=$1 LIMIT 1`,
      [draftId]
    );
    if (recheck.rowCount > 0) {
      throw new Error("Bu draft zaten paylaşılmış");
    }

    await client.query(
      `INSERT INTO history (draft_id, posted_at, x_post_id) VALUES ($1, NOW(), $2)`,
      [draftId, xId]
    );

    await client.query(`UPDATE drafts SET status='posted' WHERE id=$1`, [draftId]);
    await client.query(`DELETE FROM queue WHERE draft_id=$1`, [draftId]);

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }

  await rescheduleWaitingQueue();

  return {
    xPostId: xId,
    mediaAttached: mediaIds.length > 0,
    mediaType: uploadedMedia?.type || null,
  };
}

const uiHelpers = {
  esc,
  fmtStatusPill,
  fmtQueueStatusTR,
  composePreview,
  formatDateTR,
  mediaHtml,
  writeTokenRequired: !!WRITE_ACCESS_TOKEN,
};

function normalizeInboxFilters(query = {}) {
  const rawStatus = String(query.status || "pending").toLowerCase();
  const rawQueueView = String(query.queueView || "").toLowerCase();
  const rawPendingMedia = String(query.pendingMedia || "").toLowerCase();
  const rawSource = String(query.source || "").trim().replace(/^@/, "");
  const rawCategory = String(query.category || "").trim() || null;
  const status = rawStatus === "queued" ? "approved" : rawStatus;
  const allowedStatuses = new Set(["pending", "approved", "rejected", "posted"]);
  const nextStatus = allowedStatuses.has(status) ? status : "pending";

  let queueView = "all";
  if (nextStatus === "approved") {
    queueView = "queued";
  }

  const pendingMedia =
    nextStatus === "pending" && ["all", "video"].includes(rawPendingMedia)
      ? rawPendingMedia || "all"
      : "all";

  const sourceFilter = rawSource.length > 0 ? rawSource : null;
  const categoryFilter = rawCategory && rawCategory.length > 0 ? rawCategory : null;

  return { status: nextStatus, queueView, pendingMedia, sourceFilter, categoryFilter };
}

function getTodayBoundsTR() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

async function getDashboardStats(scheduleSettingsArg) {
  const scheduleSettings = scheduleSettingsArg || (await getScheduleSettings(pool));
  const { start, end } = getTodayBoundsTR();

  const todayQ = await pool.query(
    `
    SELECT COUNT(*)::int AS c
    FROM queue
    WHERE scheduled_at >= $1
      AND scheduled_at <= $2
    `,
    [start, end]
  );

  const nextSlot = await getNextSlotForDisplay(scheduleSettings);
  const todayScheduled = Number(todayQ.rows[0]?.c || 0);
  const remainingSlots = Math.max(0, scheduleSettings.dailyLimit - todayScheduled);
  const isDailyLimitReached = todayScheduled >= scheduleSettings.dailyLimit;

  return {
    todayScheduled,
    nextSlot,
    nextSlotText: formatDateTR(nextSlot),
    dailyLimit: scheduleSettings.dailyLimit,
    remainingSlots,
    isDailyLimitReached,
    scheduleSettings,
  };
}

// =====================
// ROUTES
// =====================
app.get("/health", (req, res) =>
  res.json({
    ok: true,
    posterWorkerRunning: !!posterWorkerChild,
    posterWorkerRestartCount,
  })
);

app.get("/debug-counts", async (req, res) => {
  try {
    const ck = !!process.env.X_CONSUMER_KEY;
    const cs = !!process.env.X_CONSUMER_SECRET;
    const at = !!process.env.X_ACCESS_TOKEN;
    const as = !!process.env.X_ACCESS_SECRET;
    const bearer = !!process.env.X_USER_BEARER;
    const oauth1a = ck && cs && at && as;
    const openaiKey = !!process.env.OPENAI_API_KEY;
    const auth = { oauth1a, oauth1aVars: { consumerKey: ck, consumerSecret: cs, accessToken: at, accessSecret: as }, bearer, openaiKey };
    const counts = await getCounts();
    const dashboard = await getDashboardStats();
    const collectorMetrics = await getCollectorMetricsSummary(pool);

    const now = new Date();
    const queueR = await pool.query(
      `SELECT id, draft_id, scheduled_at, status FROM queue WHERE status='waiting' ORDER BY scheduled_at ASC LIMIT 3`
    );
    const queueDebug = {
      serverNow: now.toISOString(),
      serverNowTR: now.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }),
      TZ: process.env.TZ || "(not set)",
      posterWorkerRunning: !!posterWorkerChild,
      posterWorkerRestartCount,
      waitingJobs: queueR.rows.map((row) => ({
        ...row,
        isDue: new Date(row.scheduled_at).getTime() <= now.getTime(),
      })),
    };

    res.json({ auth, queueDebug, ...counts, dashboard, collectorMetrics });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/openai-check", async (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !String(key).trim()) {
    return res.json({
      ok: false,
      valid: false,
      status: "missing",
      message: "OPENAI_API_KEY tanımlı değil. Render → Environment → OPENAI_API_KEY ekleyin.",
    });
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 5,
        messages: [{ role: "user", content: "Say OK" }],
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (r.status === 401) {
      return res.json({
        ok: false,
        valid: false,
        status: "invalid",
        message: "OPENAI_API_KEY geçersiz (401). Key yanlış veya süresi dolmuş olabilir.",
      });
    }
    if (r.status === 429) {
      return res.json({
        ok: true,
        valid: true,
        status: "rate_limit",
        message: "OpenAI rate limit (429). Geçici, retry ile devam edilebilir.",
      });
    }
    if (!r.ok) {
      const text = await r.text();
      return res.json({
        ok: false,
        valid: false,
        status: "error",
        message: `OpenAI hata ${r.status}: ${text.slice(0, 200)}`,
      });
    }
    return res.json({
      ok: true,
      valid: true,
      status: "ok",
      message: "OPENAI_API_KEY geçerli – AI yorumlar kullanılacak.",
    });
  } catch (e) {
    return res.json({
      ok: false,
      valid: false,
      status: "error",
      message: `Doğrulama hatası: ${e?.message || e}`,
    });
  }
});

app.get("/collector-metrics", async (req, res) => {
  try {
    const collectorMetrics = await getCollectorMetricsSummary(pool);
    res.json(collectorMetrics);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/source-performance", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
    const r = await pool.query(
      `
      SELECT
        sp.*,
        s.handle,
        s.tier,
        s.active
      FROM source_performance sp
      JOIN sources s ON s.id = sp.source_id
      ORDER BY sp.updated_at DESC, sp.draft_candidates DESC
      LIMIT $1
      `,
      [limit]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/collector-ui", async (req, res) => {
  const limit = clampUiLimit(req.query.limit, 50);

  try {
    const [collectorMetrics, performanceRows] = await Promise.all([
      getCollectorMetricsSummary(pool),
      pool
        .query(
          `
          SELECT
            sp.*,
            s.handle,
            s.tier,
            s.active
          FROM source_performance sp
          JOIN sources s ON s.id = sp.source_id
          ORDER BY sp.draft_candidates DESC, sp.media_tweets_found DESC, sp.updated_at DESC
          LIMIT $1
          `,
          [limit]
        )
        .then((result) => result.rows),
    ]);

    res.send(
      renderCollectorPage({
        collectorMetrics,
        performanceRows,
        helpers: uiHelpers,
        limit,
      })
    );
  } catch (e) {
    res
      .status(500)
      .send(renderPageShell("Error", `<pre>${esc(e.stack || e.message)}</pre>`));
  }
});

app.get("/schedule-settings", async (req, res) => {
  try {
    const scheduleSettings = await getScheduleSettings(pool);
    res.json(scheduleSettings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/sources", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
    const sources = await listSources(limit);
    res.json({
      rows: sources,
      tierCheckIntervals: SOURCE_TIER_CHECK_INTERVALS,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/sources", async (req, res) => {
  try {
    const next = validateSourceInput(req.body || {});
    const nextCheckAt = computeNextCheckAt(next.tier);
    const r = await pool.query(
      `
      INSERT INTO sources (
        handle,
        tier,
        category,
        active,
        next_check_at,
        resolve_status,
        last_error,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, 'pending', NULL, NOW())
      ON CONFLICT (handle)
      DO UPDATE SET
        tier = EXCLUDED.tier,
        category = EXCLUDED.category,
        active = EXCLUDED.active,
        next_check_at = CASE
          WHEN sources.next_check_at IS NULL THEN EXCLUDED.next_check_at
          ELSE sources.next_check_at
        END
      RETURNING id, handle, tier, category, active
      `,
      [next.handle, next.tier, next.category, next.active, nextCheckAt]
    );
    res.json({
      ok: true,
      row: r.rows[0],
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/sources/:id/save", async (req, res) => {
  const id = Number(req.params.id);
  const tier = clampTier(req.body?.tier);
  const category = String(req.body?.category || "").trim() || null;
  const active = String(req.body?.active) === "false" ? false : !!req.body?.active;

  try {
    const nextCheckAt = active ? computeNextCheckAt(tier, new Date()) : null;
    await pool.query(
      `
      UPDATE sources
      SET tier = $2,
          category = $3,
          active = $4,
          next_check_at = CASE
            WHEN $4 = true THEN COALESCE(next_check_at, $5)
            ELSE NULL
          END
      WHERE id = $1
      `,
      [id, tier, category, active, nextCheckAt]
    );

    const refreshed = await listSources(200);
    const row = refreshed.find((item) => item.id === id) || null;
    res.json({ ok: true, row });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/sources/:id/check-now", async (req, res) => {
  const id = Number(req.params.id);

  try {
    await pool.query(
      `
      UPDATE sources
      SET active = true,
          next_check_at = NOW(),
          resolve_status = CASE
            WHEN x_user_id IS NOT NULL THEN 'resolved'
            ELSE 'pending'
          END,
          last_error = NULL
      WHERE id = $1
      `,
      [id]
    );

    const refreshed = await listSources(200);
    const row = refreshed.find((item) => item.id === id) || null;
    res.json({ ok: true, row });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/sources/:id/delete", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const r = await pool.query(`DELETE FROM sources WHERE id = $1 RETURNING id, handle`, [id]);
    if (!r.rows[0]) {
      return res.status(404).json({ error: "source not found" });
    }
    res.json({ ok: true, row: r.rows[0] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/sources/remove-failed", async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM sources WHERE resolve_status = 'failed' RETURNING id, handle`
    );
    res.json({ ok: true, deletedCount: r.rowCount });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/schedule-settings", async (req, res) => {
  try {
    const scheduleSettings = await updateScheduleSettings(pool, req.body || {});
    const rescheduledCount = await rescheduleWaitingQueue(scheduleSettings);
    const dashboard = await getDashboardStats(scheduleSettings);
    res.json({
      ok: true,
      scheduleSettings,
      dashboard,
      rescheduledCount,
      summary: `${formatHourLabel(
        scheduleSettings.activeStartHour
      )}-${formatHourLabel(
        scheduleSettings.activeEndHour
      )} / ${scheduleSettings.minPostIntervalMinutes} dk`,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/run-collector", async (req, res) => {
  if (collectorRunning) {
    return res.status(409).json({ ok: false, error: "Collector zaten calisiyor." });
  }
  collectorRunning = true;
  res.json({ ok: true, message: "Collector baslatildi. Tamamlaninca sayfayi yenileyin." });
  runScript("collector-once.js")
    .then(() => { collectorRunning = false; })
    .catch((err) => {
      collectorRunning = false;
      console.error("Collector hata:", err?.message || err);
    });
});

app.post("/run-make-drafts", async (req, res) => {
  if (makeDraftsRunning) {
    return res.status(409).json({ ok: false, error: "Make-drafts zaten calisiyor." });
  }
  makeDraftsRunning = true;
  makeDraftsChild = null;
  res.json({ ok: true, message: "Make-drafts baslatildi. Tamamlaninca sayfayi yenileyin." });
  runScriptWithChild("make-drafts.js", (child) => { makeDraftsChild = child; })
    .then(() => { makeDraftsRunning = false; makeDraftsChild = null; })
    .catch((err) => {
      makeDraftsRunning = false;
      makeDraftsChild = null;
      console.error("Make-drafts hata:", err?.message || err);
    });
});

app.post("/cancel-make-drafts", (req, res) => {
  if (!makeDraftsRunning || !makeDraftsChild) {
    return res.json({ ok: true, message: "Make-drafts calismiyor." });
  }
  try {
    makeDraftsChild.kill("SIGTERM");
    makeDraftsChild = null;
    makeDraftsRunning = false;
    res.json({ ok: true, message: "Make-drafts iptal edildi." });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "Iptal basarisiz." });
  }
});

app.get("/drafts", async (req, res) => {
  const { status, queueView, pendingMedia, sourceFilter, categoryFilter } = normalizeInboxFilters(req.query);
  const limit = Math.min(Number(req.query.limit || 200), 500);

  try {
    const sourceCondition = sourceFilter
      ? " AND t.source_handle ILIKE $5"
      : "";
    const sourcePattern = sourceFilter ? `%${sourceFilter}%` : "";
    const categoryCondition = categoryFilter
      ? ` AND (s.category = $${sourceFilter ? 6 : 5})`
      : "";
    let params = [status, status, pendingMedia, limit];
    if (sourceFilter) params.push(sourcePattern);
    if (categoryFilter) params.push(categoryFilter);

    const orderBy =
      status === "approved"
        ? "ORDER BY q.scheduled_at ASC NULLS LAST, d.id DESC"
        : "ORDER BY COALESCE(d.viral_score,0) DESC, d.id DESC";

    const r = await pool.query(
      `
      SELECT
        d.*,
        CASE WHEN d.status='queued' THEN 'approved' ELSE d.status END AS normalized_status,
        t.text AS original_text,
        t.source_handle,
        t.x_url,
        t.media,
        t.has_media,
        t.media_uploadable,
        t.media_validation_error,
        s.category AS source_category,
        q.id AS queue_id,
        q.scheduled_at,
        q.status AS queue_status
      FROM drafts d
      LEFT JOIN tweets t ON t.tweet_id = d.tweet_id
      LEFT JOIN sources s ON t.source_handle IS NOT NULL AND s.handle IS NOT NULL
        AND LOWER(TRIM(BOTH '@' FROM t.source_handle)) = LOWER(TRIM(s.handle))
      LEFT JOIN LATERAL (
        SELECT q1.id, q1.scheduled_at, q1.status
        FROM queue q1
        WHERE q1.draft_id = d.id
        ORDER BY q1.id DESC
        LIMIT 1
      ) q ON true
      WHERE (CASE WHEN d.status='queued' THEN 'approved' ELSE d.status END) = $1
        AND (
          $2 <> 'approved'
          OR (q.id IS NOT NULL)
        )
        AND (
          $2 <> 'pending'
          OR $3 = 'all'
          OR (
            $3 = 'video'
            AND t.media IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(t.media) AS m(elem)
              WHERE m.elem->>'type' IN ('video', 'animated_gif')
            )
          )
        )${sourceCondition}${categoryCondition}
      ${orderBy}
      LIMIT $4
      `,
      params
    );
    res.json(
      r.rows.map((row) => ({
        ...row,
        raw_status: row.status,
        status: row.normalized_status,
        is_queued: !!row.queue_id,
      }))
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/drafts/bulk-approve", async (req, res) => {
  const count = Math.min(Math.max(1, Number(req.body?.count || 10)), 50);

  try {
    const drafts = await pool.query(
      `
      SELECT id FROM drafts
      WHERE status = 'pending'
      ORDER BY COALESCE(viral_score, 0) DESC, id ASC
      LIMIT $1
      `,
      [count]
    );

    let approved = 0;
    for (const row of drafts.rows) {
      await pool.query(
        `UPDATE drafts SET status='approved' WHERE id=$1`,
        [row.id]
      );
      await enqueueDraft(row.id);
      approved++;
    }

    const dashboard = await getDashboardStats();
    res.json({
      ok: true,
      approvedCount: approved,
      message: `${approved} draft onaylandi ve siraya eklendi.`,
      dashboard,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/drafts/bulk-reject", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  if (ids.length === 0) return res.json({ ok: true, rejectedCount: 0 });

  try {
    await pool.query(`DELETE FROM queue WHERE draft_id = ANY($1::int[])`, [ids]);
    const r = await pool.query(
      `UPDATE drafts SET status = 'rejected' WHERE id = ANY($1::int[]) AND status = 'pending' RETURNING id`,
      [ids]
    );
    res.json({ ok: true, rejectedCount: r.rowCount });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/drafts/:id/regenerate-comment", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const r = await pool.query(
      `
      SELECT d.id, d.comment_tr, d.translation_tr, t.text AS original_text, t.source_handle, t.has_media
      FROM drafts d
      LEFT JOIN tweets t ON t.tweet_id = d.tweet_id
      WHERE d.id=$1
      `,
      [id]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Draft bulunamadi" });
    }
    const row = r.rows[0];
    const commentTr = await generateComment(
      row.source_handle || "",
      row.original_text || "",
      row.translation_tr || "",
      row.has_media === true
    );
    await pool.query(
      `UPDATE drafts SET comment_tr=$2 WHERE id=$1`,
      [id, commentTr]
    );
    res.json({ ok: true, comment_tr: commentTr });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "Yorum uretilemedi" });
  }
});

app.post("/drafts/:id/save", async (req, res) => {
  const id = Number(req.params.id);
  const { comment_tr, translation_tr, use_comment } = req.body || {};
  const nextComment = normalizeOptionalText(comment_tr);
  const nextTranslation = normalizeOptionalText(translation_tr);
  const useCommentParam = use_comment === undefined ? null : !!use_comment;
  try {
    await pool.query(
      `
      UPDATE drafts
      SET comment_tr = COALESCE($2, comment_tr),
          translation_tr = COALESCE($3, translation_tr),
          use_comment = COALESCE($4, use_comment)
      WHERE id=$1
      `,
      [id, nextComment, nextTranslation, useCommentParam]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/drafts/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  const allowed = new Set(["pending", "approved", "rejected", "posted"]);
  if (!allowed.has(status)) return res.status(400).json({ error: "bad status" });

  try {
    if (status === "pending" || status === "rejected") {
      await pool.query(`DELETE FROM queue WHERE draft_id=$1`, [id]);
    }
    await pool.query(`UPDATE drafts SET status=$2 WHERE id=$1`, [id, status]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/clear-drafts", async (req, res) => {
  const { status } = req.body || {};
  const allowed = new Set(["rejected", "posted"]);
  if (!allowed.has(status)) {
    return res.status(400).json({ ok: false, error: "status rejected veya posted olmali" });
  }
  try {
    if (status === "rejected") {
      await pool.query(
        `INSERT INTO rejected_tweet_ids (tweet_id)
         SELECT tweet_id FROM drafts WHERE status = 'rejected'
         ON CONFLICT (tweet_id) DO NOTHING`
      );
    }
    const r = await pool.query(`DELETE FROM drafts WHERE status = $1`, [status]);
    res.json({ ok: true, deletedCount: r.rowCount });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/drafts/:id/approve-and-queue", async (req, res) => {
  const id = Number(req.params.id);
  const { comment_tr, translation_tr, use_comment } = req.body || {};
  const nextComment = normalizeOptionalText(comment_tr);
  const nextTranslation = normalizeOptionalText(translation_tr);
  const useCommentParam = use_comment === undefined ? null : !!use_comment;

  try {
    await pool.query(
      `
      UPDATE drafts
      SET status='approved',
          comment_tr = COALESCE($2, comment_tr),
          translation_tr = COALESCE($3, translation_tr),
          use_comment = COALESCE($4, use_comment)
      WHERE id=$1
      `,
      [id, nextComment, nextTranslation, useCommentParam]
    );

    const result = await enqueueDraft(id);
    const dashboard = await getDashboardStats();

    res.json({
      ok: true,
      ...result,
      scheduledAtText: formatDateTR(result.scheduledAt),
      dashboard,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/drafts/:id/queue", async (req, res) => {
  const id = Number(req.params.id);
  const { comment_tr, translation_tr, use_comment } = req.body || {};
  const nextComment = normalizeOptionalText(comment_tr);
  const nextTranslation = normalizeOptionalText(translation_tr);
  const useCommentParam = use_comment === undefined ? null : !!use_comment;

  try {
    await pool.query(
      `
      UPDATE drafts
      SET status='approved',
          comment_tr = COALESCE($2, comment_tr),
          translation_tr = COALESCE($3, translation_tr),
          use_comment = COALESCE($4, use_comment)
      WHERE id=$1
      `,
      [id, nextComment, nextTranslation, useCommentParam]
    );

    const result = await enqueueDraft(id);
    const dashboard = await getDashboardStats();

    res.json({
      ok: true,
      ...result,
      scheduledAtText: formatDateTR(result.scheduledAt),
      dashboard,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/drafts/:id/post-now", async (req, res) => {
  const id = Number(req.params.id);
  const { comment_tr, translation_tr, use_comment } = req.body || {};
  const nextComment = normalizeOptionalText(comment_tr);
  const nextTranslation = normalizeOptionalText(translation_tr);
  const useCommentParam = use_comment === undefined ? null : !!use_comment;

  try {
    await pool.query(
      `
      UPDATE drafts
      SET comment_tr = COALESCE($2, comment_tr),
          translation_tr = COALESCE($3, translation_tr),
          use_comment = COALESCE($4, use_comment)
      WHERE id=$1
      `,
      [id, nextComment, nextTranslation, useCommentParam]
    );

    const result = await directPostDraftNow(id);
    const dashboard = await getDashboardStats();

    res.json({
      ok: true,
      ...result,
      dashboard,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/queue/:id/cancel", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const result = await cancelQueueItem(id);
    const dashboard = await getDashboardStats();
    res.json({ ok: true, ...result, dashboard });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/queue/:id/retry", async (req, res) => {
  const id = Number(req.params.id);

  try {
    const q = await pool.query(
      `SELECT id, status FROM queue WHERE id = $1`,
      [id]
    );
    if (q.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Queue kaydi bulunamadi" });
    }
    if (q.rows[0].status !== "failed") {
      return res.status(400).json({ ok: false, error: "Sadece failed kayitlar yeniden siraya alinabilir" });
    }
    const scheduleSettings = await getScheduleSettings(pool);
    const nextSlot = await getNextSlotForDisplay(scheduleSettings);
    await pool.query(
      `UPDATE queue SET status = 'waiting', last_error = NULL, attempts = 0, scheduled_at = $2, updated_at = NOW() WHERE id = $1`,
      [id, nextSlot]
    );
    const dashboard = await getDashboardStats();
    res.json({ ok: true, dashboard });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =====================
// UI
// =====================
app.get(["/", "/inbox"], async (req, res) => {
  const { status, queueView, pendingMedia, sourceFilter, categoryFilter } = normalizeInboxFilters(req.query);
  const limit = clampUiLimit(req.query.limit, 200);

  try {
    const counts = await getCounts();
    const scheduleSettings = await getScheduleSettings(pool);
    const dashboard = await getDashboardStats(scheduleSettings);

    const sourceCondition = sourceFilter
      ? " AND t.source_handle ILIKE $5"
      : "";
    const sourcePattern = sourceFilter ? `%${sourceFilter}%` : "";
    const categoryCondition = categoryFilter
      ? ` AND (s.category = $${sourceFilter ? 6 : 5})`
      : "";
    let params = [status, status, pendingMedia, limit];
    if (sourceFilter) params.push(sourcePattern);
    if (categoryFilter) params.push(categoryFilter);

    const orderBy =
      status === "approved"
        ? "ORDER BY q.scheduled_at ASC NULLS LAST, d.id DESC"
        : "ORDER BY COALESCE(d.viral_score,0) DESC, d.id DESC";

    const categoriesResult = await pool.query(
      `SELECT DISTINCT category FROM sources WHERE category IS NOT NULL AND category <> '' ORDER BY category`
    );
    const categoryOptions = categoriesResult.rows.map((r) => r.category);

    const r = await pool.query(
      `
      SELECT
        d.*,
        CASE WHEN d.status='queued' THEN 'approved' ELSE d.status END AS normalized_status,
        t.text AS original_text,
        t.source_handle,
        t.x_url,
        t.media,
        t.has_media,
        t.media_uploadable,
        t.media_validation_error,
        s.category AS source_category,
        q.id AS queue_id,
        q.scheduled_at,
        q.status AS queue_status
      FROM drafts d
      LEFT JOIN tweets t ON t.tweet_id = d.tweet_id
      LEFT JOIN sources s ON t.source_handle IS NOT NULL AND s.handle IS NOT NULL
        AND LOWER(TRIM(BOTH '@' FROM t.source_handle)) = LOWER(TRIM(s.handle))
      LEFT JOIN LATERAL (
        SELECT q1.id, q1.scheduled_at, q1.status
        FROM queue q1
        WHERE q1.draft_id = d.id
        ORDER BY q1.id DESC
        LIMIT 1
      ) q ON true
      WHERE (CASE WHEN d.status='queued' THEN 'approved' ELSE d.status END) = $1
        AND (
          $2 <> 'approved'
          OR (q.id IS NOT NULL)
        )
        AND (
          $2 <> 'pending'
          OR $3 = 'all'
          OR (
            $3 = 'video'
            AND t.media IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(t.media) AS m(elem)
              WHERE m.elem->>'type' IN ('video', 'animated_gif')
            )
          )
        )${sourceCondition}${categoryCondition}
      ${orderBy}
      LIMIT $4
      `,
      params
    );
    res.send(
      renderInboxPage({
        status,
        limit,
        queueView,
        pendingMedia,
        sourceFilter: sourceFilter || "",
        categoryFilter: categoryFilter || "",
        categoryOptions: categoryOptions || [],
        rows: r.rows.map((row) => ({
          ...row,
          raw_status: row.status,
          status: row.normalized_status,
          is_queued: !!row.queue_id,
        })),
        counts,
        dashboard,
        helpers: uiHelpers,
        scheduleSettings,
      })
    );
  } catch (e) {
    res
      .status(500)
      .send(renderPageShell("Error", `<pre>${esc(e.stack || e.message)}</pre>`));
  }
});

app.get("/sources-ui", async (req, res) => {
  const limit = clampUiLimit(req.query.limit, 100);

  try {
    const sources = await listSources(limit);
    const collectorMetrics = await getCollectorMetricsSummary(pool);
    res.send(
      renderSourcesPage({
        sources,
        tierCheckIntervals: SOURCE_TIER_CHECK_INTERVALS,
        collectorMetrics,
        helpers: uiHelpers,
        limit,
      })
    );
  } catch (e) {
    res
      .status(500)
      .send(renderPageShell("Error", `<pre>${esc(e.stack || e.message)}</pre>`));
  }
});

app.get("/follow-queue", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
    const r = await pool.query(
      `SELECT id, handle, status, followed_at, last_error, next_follow_at, created_at
       FROM follow_queue
       ORDER BY status ASC, id ASC
       LIMIT $1`,
      [limit]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/follow-queue", async (req, res) => {
  try {
    const handle = String(req.body?.handle || "").trim().replace(/^@/, "");
    if (!handle) {
      return res.status(400).json({ ok: false, error: "Handle bos" });
    }
    await pool.query(
      `INSERT INTO follow_queue (handle, status)
       VALUES ($1, 'pending')
       ON CONFLICT (handle) DO UPDATE SET status = 'pending', last_error = NULL, next_follow_at = NULL`,
      [handle]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/follow-queue/:id/delete", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: "Gecersiz id" });
    }
    await pool.query("DELETE FROM follow_queue WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/follow-queue/:id/retry", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: "Gecersiz id" });
    }
    await pool.query(
      `UPDATE follow_queue SET next_follow_at = NULL, last_error = NULL WHERE id = $1 AND status = 'pending'`,
      [id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/follow-ui", async (req, res) => {
  const limit = clampUiLimit(req.query.limit, 100);
  try {
    const r = await pool.query(
      `SELECT id, handle, status, followed_at, last_error, next_follow_at, created_at
       FROM follow_queue
       ORDER BY status ASC, id ASC
       LIMIT $1`,
      [limit]
    );
    res.send(
      renderFollowPage({
        items: r.rows,
        helpers: uiHelpers,
        limit,
      })
    );
  } catch (e) {
    res
      .status(500)
      .send(renderPageShell("Error", `<pre>${esc(e.stack || e.message)}</pre>`));
  }
});

app.get("/reply-sources", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, handle, active, last_checked_at FROM reply_sources ORDER BY id ASC`
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/reply-sources", async (req, res) => {
  try {
    const handle = String(req.body?.handle || "").trim().replace(/^@/, "");
    if (!handle) return res.status(400).json({ ok: false, error: "Handle bos" });
    await pool.query(
      `INSERT INTO reply_sources (handle, active) VALUES ($1, true) ON CONFLICT (handle) DO NOTHING`,
      [handle]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/reply-sources/:id/delete", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Gecersiz id" });
    await pool.query("DELETE FROM reply_sources WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/run-reply-collector", async (req, res) => {
  if (replyCollectorRunning) {
    return res.status(409).json({ ok: false, error: "Reply collector zaten calisiyor." });
  }
  replyCollectorRunning = true;
  res.json({ ok: true, message: "Reply collector baslatildi." });
  runScript("reply-collector.js")
    .then(() => { replyCollectorRunning = false; })
    .catch((err) => {
      replyCollectorRunning = false;
      console.error("Reply collector hata:", err?.message || err);
    });
});

app.post("/run-make-reply-drafts", async (req, res) => {
  if (replyMakeDraftsRunning) {
    return res.status(409).json({ ok: false, error: "Make-reply-drafts zaten calisiyor." });
  }
  replyMakeDraftsRunning = true;
  res.json({ ok: true, message: "AI yorum uretimi baslatildi." });
  runScript("make-reply-drafts.js")
    .then(() => { replyMakeDraftsRunning = false; })
    .catch((err) => {
      replyMakeDraftsRunning = false;
      console.error("Make-reply-drafts hata:", err?.message || err);
    });
});

app.get("/reply-drafts", async (req, res) => {
  try {
    const status = req.query.status || "pending";
    const r = await pool.query(
      `
      SELECT d.id, d.tweet_id, d.reply_text, d.status, d.created_at,
             c.author_handle, c.text AS original_text, c.viral_score
      FROM reply_drafts d
      LEFT JOIN reply_candidates c ON c.tweet_id = d.tweet_id
      WHERE d.status = $1
      ORDER BY d.created_at DESC
      LIMIT 100
      `,
      [status]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/reply-drafts/:id/approve", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Gecersiz id" });
    const draft = await pool.query(
      `SELECT id, tweet_id FROM reply_drafts WHERE id = $1 AND status = 'pending'`,
      [id]
    );
    if (draft.rowCount === 0) return res.status(404).json({ ok: false, error: "Draft bulunamadi" });
    const intervalMin = Number(process.env.REPLY_INTERVAL_MINUTES || 5) || 5;
    const scheduledAt = new Date(Date.now() + intervalMin * 60 * 1000);
    await pool.query(
      `INSERT INTO reply_queue (draft_id, scheduled_at, status) VALUES ($1, $2, 'waiting')`,
      [id, scheduledAt]
    );
    await pool.query(`UPDATE reply_drafts SET status = 'approved' WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/reply-drafts/:id/reject", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Gecersiz id" });
    await pool.query(`UPDATE reply_drafts SET status = 'rejected' WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

let newsCollectorRunning = false;
let newsMakeDraftsRunning = false;

app.get("/news-sources", async (req, res) => {
  try {
    const r = await pool.query("SELECT id, name, feed_url, last_fetch_at FROM news_sources ORDER BY id");
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/news-sources", async (req, res) => {
  try {
    const { name, feed_url } = req.body || {};
    if (!name || !feed_url) {
      return res.status(400).json({ ok: false, error: "name ve feed_url gerekli" });
    }
    await pool.query(
      `INSERT INTO news_sources (name, feed_url) VALUES ($1, $2)
       ON CONFLICT (feed_url) DO NOTHING`,
      [String(name).trim(), String(feed_url).trim()]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/news-sources/:id/delete", async (req, res) => {
  const id = Number(req.params.id);
  try {
    await pool.query("DELETE FROM news_sources WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/run-news-collector", async (req, res) => {
  if (newsCollectorRunning) {
    return res.status(409).json({ ok: false, error: "News collector zaten calisiyor." });
  }
  newsCollectorRunning = true;
  res.json({ ok: true, message: "News collector baslatildi. Tamamlaninca sayfayi yenileyin." });
  runScript("news-collector.js")
    .then(() => { newsCollectorRunning = false; })
    .catch((err) => {
      newsCollectorRunning = false;
      console.error("News collector hata:", err?.message || err);
    });
});

app.post("/run-make-news-drafts", async (req, res) => {
  if (newsMakeDraftsRunning) {
    return res.status(409).json({ ok: false, error: "Make-news-drafts zaten calisiyor." });
  }
  newsMakeDraftsRunning = true;
  res.json({ ok: true, message: "Make-news-drafts baslatildi. Tamamlaninca sayfayi yenileyin." });
  runScript("make-news-drafts.js")
    .then(() => { newsMakeDraftsRunning = false; })
    .catch((err) => {
      newsMakeDraftsRunning = false;
      console.error("Make-news-drafts hata:", err?.message || err);
    });
});

app.get("/news-drafts", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT d.id, d.post_text, d.status
       FROM news_drafts d
       WHERE d.status IN ('pending','posted')
       ORDER BY d.created_at DESC LIMIT 30`
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/news-drafts/:id/post-now", async (req, res) => {
  const id = Number(req.params.id);
  const { post_text } = req.body || {};
  try {
    const draft = await pool.query(
      `SELECT d.id, d.post_text, d.status, i.media_url
       FROM news_drafts d
       LEFT JOIN news_items i ON i.id = d.item_id
       WHERE d.id = $1`,
      [id]
    );
    if (draft.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Draft bulunamadi" });
    }
    const row = draft.rows[0];
    if (row.status !== "pending") {
      return res.status(400).json({ ok: false, error: "Bu draft zaten paylasildi" });
    }
    const text = (post_text || row.post_text || "").trim();
    if (!text) {
      return res.status(400).json({ ok: false, error: "Post metni bos" });
    }
    if (text.length > 280) {
      return res.status(400).json({ ok: false, error: "Metin 280 karakterden uzun" });
    }
    let mediaIds = [];
    const mediaUrl = row.media_url?.trim();
    if (mediaUrl) {
      try {
        const mediaArray = [{ type: "photo", url: mediaUrl }];
        const uploaded = await uploadMediaFromStoredMedia(mediaArray, X_AUTH);
        if (uploaded?.mediaId) mediaIds = [uploaded.mediaId];
      } catch (mediaErr) {
        console.warn("News media upload failed:", mediaErr?.message);
      }
    }
    const posted = await xPostTweet(text, mediaIds);
    const xId = posted?.id || null;
    await pool.query(
      `UPDATE news_drafts SET status = 'posted', posted_at = NOW(), x_post_id = $2 WHERE id = $1`,
      [id, xId]
    );
    res.json({ ok: true, xPostId: xId });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/news-drafts/:id/delete", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const r = await pool.query(
      `UPDATE news_drafts SET status = 'deleted' WHERE id = $1 AND status IN ('pending','posted') RETURNING id`,
      [id]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Draft bulunamadi veya zaten silindi" });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/news-ui", async (req, res) => {
  try {
    const [sourcesRes, draftsRes, countsRes] = await Promise.all([
      pool.query("SELECT id, name, feed_url, last_fetch_at FROM news_sources ORDER BY id"),
      pool.query(
        `SELECT d.id, d.post_text, d.status, d.item_id, i.media_url, i.title AS item_title
         FROM news_drafts d
         LEFT JOIN news_items i ON i.id = d.item_id
         WHERE d.status IN ('pending','posted')
         ORDER BY d.created_at DESC LIMIT 30`
      ),
      pool.query(
        `SELECT
          (SELECT COUNT(*)::int FROM news_sources WHERE active = true) AS sources,
          (SELECT COUNT(*)::int FROM news_items) AS items,
          (SELECT COUNT(*)::int FROM news_drafts WHERE status = 'pending') AS pending,
          (SELECT COUNT(*)::int FROM news_drafts WHERE status = 'posted') AS posted`
      ),
    ]);
    const counts = countsRes.rows[0] || {};
    res.send(
      renderNewsPage({
        sources: sourcesRes.rows,
        drafts: draftsRes.rows,
        helpers: uiHelpers,
        counts,
      })
    );
  } catch (e) {
    res
      .status(500)
      .send(renderPageShell("Error", `<pre>${esc(e.stack || e.message)}</pre>`));
  }
});

app.get("/reply-ui", async (req, res) => {
  try {
    const [sourcesRes, draftsRes, countsRes] = await Promise.all([
      pool.query("SELECT id, handle FROM reply_sources WHERE active = true ORDER BY id"),
      pool.query(
        `SELECT d.id, d.tweet_id, d.reply_text, d.status, c.author_handle, c.text AS original_text
         FROM reply_drafts d
         LEFT JOIN reply_candidates c ON c.tweet_id = d.tweet_id
         WHERE d.status IN ('pending','approved')
         ORDER BY d.created_at DESC LIMIT 50`
      ),
      pool.query(
        `SELECT
          (SELECT COUNT(*)::int FROM reply_sources WHERE active = true) AS sources,
          (SELECT COUNT(*)::int FROM reply_candidates) AS candidates,
          (SELECT COUNT(*)::int FROM reply_drafts WHERE status = 'pending') AS pending_drafts,
          (SELECT COUNT(*)::int FROM reply_queue WHERE status = 'waiting') AS queued`
      ),
    ]);
    const counts = countsRes.rows[0] || {};
    res.send(
      renderReplyPage({
        sources: sourcesRes.rows,
        drafts: draftsRes.rows,
        helpers: uiHelpers,
        counts,
      })
    );
  } catch (e) {
    res
      .status(500)
      .send(renderPageShell("Error", `<pre>${esc(e.stack || e.message)}</pre>`));
  }
});

app.get("/queue-ui", (req, res) => {
  res.redirect(302, "/inbox?status=approved");
});

app.get("/queue", async (req, res) => {
  try {
    const r = await pool.query(
      `
      SELECT
        q.*,
        d.tweet_id,
        d.viral_score,
        (COALESCE(d.comment_tr,'') || E'\n\n' || COALESCE(d.translation_tr,'')) AS text
      FROM queue q
      JOIN drafts d ON d.id = q.draft_id
      ORDER BY q.scheduled_at ASC
      LIMIT 500
      `
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/history-ui", async (req, res) => {
  const limit = clampUiLimit(req.query.limit, 200);
  try {
    const r = await pool.query(
      `
      SELECT
        h.id,
        h.draft_id,
        h.posted_at,
        h.x_post_id,
        d.tweet_id,
        d.viral_score,
        t.x_url,
        (COALESCE(d.comment_tr,'') || E'\n\n' || COALESCE(d.translation_tr,'')) AS text
      FROM history h
      JOIN drafts d ON d.id = h.draft_id
      LEFT JOIN tweets t ON t.tweet_id = d.tweet_id
      ORDER BY h.posted_at DESC
      LIMIT $1
      `
      ,
      [limit]
    );

    res.send(
      renderHistoryPage({
        rows: r.rows,
        helpers: uiHelpers,
        limit,
      })
    );
  } catch (e) {
    res
      .status(500)
      .send(renderPageShell("Error", `<pre>${esc(e.stack || e.message)}</pre>`));
  }
});

app.get("/history", async (req, res) => {
  try {
    const format = String(req.query.format || "").toLowerCase();
    const limit = Math.min(Number(req.query.limit || 500), 2000);

    const r = await pool.query(
      `
      SELECT
        h.id,
        h.draft_id,
        h.posted_at,
        h.x_post_id,
        d.tweet_id,
        d.viral_score,
        (COALESCE(d.comment_tr,'') || E'\n\n' || COALESCE(d.translation_tr,'')) AS text
      FROM history h
      JOIN drafts d ON d.id = h.draft_id
      ORDER BY h.posted_at DESC
      LIMIT $1
      `,
      [limit]
    );

    if (format === "csv") {
      const headers = ["id", "draft_id", "posted_at", "x_post_id", "tweet_id", "viral_score", "text"];
      const escapeCsv = (v) => {
        const s = String(v ?? "").replace(/"/g, '""');
        return s.includes(",") || s.includes("\n") || s.includes('"') ? `"${s}"` : s;
      };
      const lines = [
        headers.join(","),
        ...r.rows.map((row) =>
          headers.map((h) => escapeCsv(row[h])).join(",")
        ),
      ];
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="xauto-history-${new Date().toISOString().slice(0, 10)}.csv"`
      );
      return res.send("\uFEFF" + lines.join("\n"));
    }

    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

let posterWorkerChild = null;
let followWorkerChild = null;
let replyPosterChild = null;
let collectorRunning = false;
let replyCollectorRunning = false;
let replyMakeDraftsRunning = false;
let makeDraftsRunning = false;
let makeDraftsChild = null;
let posterWorkerRestartCount = 0;
const POSTER_WORKER_MAX_RESTARTS = 10;
const POSTER_WORKER_RESTART_DELAY_MS = 5000;

function runScript(scriptName) {
  return runScriptWithChild(scriptName, null);
}

function runScriptWithEnv(scriptName, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, scriptName)], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: __dirname,
      env: { ...process.env, PATH: pathEnv, ...extraEnv },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else if (child.killed || signal === "SIGTERM") resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `Exit code ${code}`));
    });
    child.on("error", reject);
  });
}

function runScriptWithChild(scriptName, onSpawn) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, scriptName)], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: __dirname,
      env: { ...process.env, PATH: pathEnv },
    });
    if (typeof onSpawn === "function") onSpawn(child);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else if (child.killed || signal === "SIGTERM") resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `Exit code ${code}`));
    });
    child.on("error", reject);
  });
}

function startPosterWorker() {
  if (process.env.XAUTO_SKIP_POSTER_WORKER === "true") {
    console.log("Poster worker atlanıyor (XAUTO_SKIP_POSTER_WORKER=true)");
    return;
  }
  const workerPath = path.join(__dirname, "poster-worker.js");
  posterWorkerChild = spawn(process.execPath, [workerPath], {
    stdio: "inherit",
    cwd: __dirname,
    env: process.env,
  });
  posterWorkerChild.on("error", (err) => {
    console.error("Poster worker hata:", err?.message || err);
  });
  posterWorkerChild.on("exit", (code, signal) => {
    posterWorkerChild = null;
    if (code !== null && code !== 0) {
      console.error(`Poster worker çıktı: code=${code} signal=${signal}`);
    }
    // code=2: lock alınamadı (başka instance çalışıyor) – yeniden başlatma
    if (code === 2) {
      console.log("Poster worker lock alamadı (başka instance var). Yeniden başlatılmıyor.");
      return;
    }
    // SIGTERM/SIGINT: graceful shutdown – yeniden başlatma
    if (signal === "SIGTERM" || signal === "SIGINT") return;
    // Crash recovery: gerçek çökme durumunda yeniden başlat
    if (posterWorkerRestartCount < POSTER_WORKER_MAX_RESTARTS) {
      posterWorkerRestartCount += 1;
      console.log(
        `Poster worker yeniden başlatılıyor (${posterWorkerRestartCount}/${POSTER_WORKER_MAX_RESTARTS}) - ${POSTER_WORKER_RESTART_DELAY_MS}ms sonra`
      );
      setTimeout(() => {
        if (!posterWorkerChild) startPosterWorker();
      }, POSTER_WORKER_RESTART_DELAY_MS);
    } else {
      console.error(
        `Poster worker max restart (${POSTER_WORKER_MAX_RESTARTS}) aşıldı. Manuel restart gerekli.`
      );
    }
  });
  console.log("Poster worker başlatıldı");
}

function startFollowWorker() {
  if (process.env.XAUTO_SKIP_FOLLOW_WORKER === "true") {
    console.log("Follow worker atlanıyor (XAUTO_SKIP_FOLLOW_WORKER=true)");
    return;
  }
  const workerPath = path.join(__dirname, "follow-worker.js");
  followWorkerChild = spawn(process.execPath, [workerPath], {
    stdio: "inherit",
    cwd: __dirname,
    env: process.env,
  });
  followWorkerChild.on("error", (err) => {
    console.error("Follow worker hata:", err?.message || err);
  });
  followWorkerChild.on("exit", (code, signal) => {
    followWorkerChild = null;
    if (code !== null && code !== 0) {
      console.error(`Follow worker çıktı: code=${code} signal=${signal}`);
    }
  });
  console.log("Follow worker başlatıldı");
}

function startReplyPoster() {
  if (process.env.XAUTO_SKIP_REPLY_POSTER === "true") {
    console.log("Reply poster atlanıyor (XAUTO_SKIP_REPLY_POSTER=true)");
    return;
  }
  const workerPath = path.join(__dirname, "reply-poster.js");
  replyPosterChild = spawn(process.execPath, [workerPath], {
    stdio: "inherit",
    cwd: __dirname,
    env: process.env,
  });
  replyPosterChild.on("error", (err) => {
    console.error("Reply poster hata:", err?.message || err);
  });
  replyPosterChild.on("exit", (code, signal) => {
    replyPosterChild = null;
    if (code !== null && code !== 0) {
      console.error(`Reply poster çıktı: code=${code} signal=${signal}`);
    }
  });
  console.log("Reply poster başlatıldı");
}

async function startServer() {
  await ensureScheduleSettingsTable(pool);
  await ensureSourcesManagementSchema(pool);
  await ensureCollectorMetricsSchema(pool);
  await ensureTweetMediaValidationSchema(pool);
  await ensureNewsSchema(pool);
  app.listen(PORT, () => {
    console.log(`Server çalışıyor: http://localhost:${PORT}`);
    console.log(
      WRITE_ACCESS_TOKEN
        ? "Yazma endpoint korumasi: localhost veya X-Admin-Token"
        : "Yazma endpoint korumasi: sadece localhost"
    );
    startPosterWorker();
    startFollowWorker();
    startReplyPoster();
  });
}

process.on("SIGINT", () => {
  if (posterWorkerChild) posterWorkerChild.kill("SIGTERM");
  if (followWorkerChild) followWorkerChild.kill("SIGTERM");
  if (replyPosterChild) replyPosterChild.kill("SIGTERM");
  process.exit(0);
});
process.on("SIGTERM", () => {
  if (posterWorkerChild) posterWorkerChild.kill("SIGTERM");
  if (followWorkerChild) followWorkerChild.kill("SIGTERM");
  if (replyPosterChild) replyPosterChild.kill("SIGTERM");
  process.exit(0);
});

startServer().catch((e) => {
  console.error("❌ Server startup error:", e);
  process.exit(1);
});