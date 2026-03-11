require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { chromium } = require("playwright");
const { composeDraftText } = require("./draft-format");

const POLL_SECONDS = Number(process.env.WORKER_POLL_SECONDS || 30);
const MAX_ATTEMPTS = Number(process.env.WORKER_MAX_ATTEMPTS || 5);
const DRY_RUN = String(process.env.WORKER_DRY_RUN || "false").toLowerCase() === "true";

const STORAGE_PATH = path.join(__dirname, "storageState.json");
const TARGET_TZ = process.env.TZ || "Europe/Istanbul";

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL yok");
  process.exit(1);
}
if (!fs.existsSync(STORAGE_PATH)) {
  console.error("❌ storageState.json yok. Önce: node playwright-login.js");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function composeFinalText(d) {
  return composeDraftText(d.comment_tr, d.translation_tr, d.format_key, d.x_url);
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

async function isAlreadyPosted(draftId) {
  const r = await pool.query(`SELECT 1 FROM history WHERE draft_id=$1 LIMIT 1`, [draftId]);
  return r.rowCount > 0;
}

async function writeHistory(draftId, xUrl) {
  await pool.query(
    `INSERT INTO history (draft_id, posted_at, x_post_id) VALUES ($1, NOW(), $2)`,
    [draftId, xUrl || null]
  );
}

async function markDraftPosted(draftId) {
  await pool.query(`UPDATE drafts SET status='posted' WHERE id=$1`, [draftId]);
}

async function markQueueDone(queueId) {
  await pool.query(`UPDATE queue SET status='done', updated_at=NOW(), last_error=NULL WHERE id=$1`, [queueId]);
}

async function markQueueFailed(queueId, msg) {
  await pool.query(
    `UPDATE queue SET status='failed', updated_at=NOW(), last_error=$2 WHERE id=$1`,
    [queueId, (msg || "").slice(0, 2000)]
  );
}

async function returnToWaitingWithDelay(queueId, delayMs, msg) {
  await pool.query(
    `UPDATE queue
     SET status='waiting',
         scheduled_at = NOW() + ($2 || ' milliseconds')::interval,
         updated_at=NOW(),
         last_error=$3
     WHERE id=$1`,
    [queueId, String(delayMs), (msg || "").slice(0, 2000)]
  );
}

function classifyRetry(err) {
  // UI otomasyonda hata tipleri farklı olur
  const m = (err?.message || "").toLowerCase();
  if (m.includes("captcha") || m.includes("challenge") || m.includes("verify")) {
    return { retryable: false, waitMs: 0, reason: "human_verification" };
  }
  if (m.includes("timeout") || m.includes("navigation")) {
    return { retryable: true, waitMs: 30_000, reason: "timeout" };
  }
  return { retryable: true, waitMs: 20_000, reason: "generic" };
}

async function ensureLoggedIn(page) {
  // Session bozuldu mu kontrol: timeline'a gidince login akışına düşerse anlayacağız
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });

  const url = page.url();
  if (url.includes("/i/flow/login") || url.includes("/login")) {
    throw new Error("Login required (session expired). Run: node playwright-login.js");
  }
}

async function postTweetViaUI(text) {
  if (DRY_RUN) {
    console.log("🟡 DRY_RUN tweet:", text);
    return { url: "dryrun://tweet" };
  }

  const browser = await chromium.launch({
    headless: false,          // ilk günlerde false kalsın (görerek kontrol)
    channel: "chrome",
  });

  const context = await browser.newContext({
    storageState: STORAGE_PATH,
    locale: "tr-TR",
    timezoneId: TARGET_TZ,
  });

  const page = await context.newPage();

  try {
    await ensureLoggedIn(page);

    // Tweet compose ekranı
    await page.goto("https://x.com/compose/post", { waitUntil: "domcontentloaded" });

    // Textbox selector (X UI değişebiliyor — en stabil yaklaşım: role tabanlı)
    const textbox = page.getByRole("textbox");
    await textbox.waitFor({ timeout: 30_000 });
    await textbox.fill(text);

    // Post button (bazı arayüzlerde "Post", TR'de "Gönder" olabilir)
    // İkisini de deneriz:
    const postBtn =
      page.getByRole("button", { name: /post|gönder|tweet/i }).first();

    await postBtn.waitFor({ timeout: 30_000 });
    await postBtn.click();

    // Tweet atıldı mı? URL home'a dönebilir; en pratik doğrulama: kısa bekle
    await page.waitForTimeout(3000);

    // x_post_id olarak bir URL yakalamak zor (UI değişken).
    // Şimdilik null yazacağız. İstersen sonra profile'dan son tweeti çekip URL yazdırırız.
    await context.storageState({ path: STORAGE_PATH }); // session güncelle
    return { url: null };
  } finally {
    await context.close();
    await browser.close();
  }
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

    console.log(`🟢 UI Posting draft_id=${draftId} queue_id=${queueId} attempts=${attempts}`);
    const resp = await postTweetViaUI(text);

    await writeHistory(draftId, resp?.url || null);
    await markDraftPosted(draftId);
    await markQueueDone(queueId);

    console.log(`✅ UI Posted draft_id=${draftId}`);
    return true;
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`❌ UI Post failed queue_id=${queueId} draft_id=${draftId}:`, msg);

    if (attempts >= MAX_ATTEMPTS) {
      await markQueueFailed(queueId, `Max attempts reached. Last: ${msg}`);
      return true;
    }

    const d = classifyRetry(err);
    if (!d.retryable) {
      await markQueueFailed(queueId, `Non-retryable (${d.reason}): ${msg}`);
      return true;
    }

    const base = d.waitMs || 20000;
    const backoff = base * Math.pow(2, Math.max(0, attempts - 1));
    const jitter = Math.floor(Math.random() * 5000);
    const waitMs = Math.min(backoff + jitter, 10 * 60 * 1000);

    await returnToWaitingWithDelay(queueId, waitMs, `Retry in ${waitMs}ms (${d.reason}): ${msg}`);
    return true;
  }
}

async function main() {
  console.log("🚀 Poster Worker (Playwright UI) başladı");
  console.log(`poll=${POLL_SECONDS}s maxAttempts=${MAX_ATTEMPTS} dryRun=${DRY_RUN}`);

  while (true) {
    try {
      let didWork = false;
      for (let i = 0; i < 3; i++) {
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
