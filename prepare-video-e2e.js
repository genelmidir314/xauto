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

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function buildFinalText(draft) {
  const c = String(draft.comment_tr || "").trim();
  const t = String(draft.translation_tr || "").trim();
  if (c && t) return `${c}\n\n${t}`;
  return c || t || "";
}

function hasOAuth1aEnv() {
  return !!(
    process.env.X_CONSUMER_KEY &&
    process.env.X_CONSUMER_SECRET &&
    process.env.X_ACCESS_TOKEN &&
    process.env.X_ACCESS_SECRET
  );
}

function printHelp() {
  console.log(`
Hazırlık:
  node prepare-video-e2e.js

Örnekler:
  node prepare-video-e2e.js --mode=queue --delaySec=90
  node prepare-video-e2e.js --mode=post-now
  node prepare-video-e2e.js --draftId=123 --mode=queue

Seçenekler:
  --draftId=<id>      Belirli draft'ı seç
  --mode=queue        Worker ile canlı test hazırla (varsayılan)
  --mode=post-now     Server UI / endpoint ile canlı test hazırla
  --delaySec=<sn>     Queue testi için scheduled_at gecikmesi
  --listOnly          Sadece uygun draft'ı bul, DB'ye dokunma
  --help              Yardımı göster
`);
}

async function loadDraftById(draftId) {
  const r = await pool.query(
    `
    SELECT
      d.id,
      d.status,
      d.comment_tr,
      d.translation_tr,
      d.viral_score,
      d.created_at,
      t.tweet_id,
      t.source_handle,
      t.x_url,
      t.media,
      EXISTS(SELECT 1 FROM history h WHERE h.draft_id = d.id) AS already_posted
    FROM drafts d
    JOIN tweets t ON t.tweet_id = d.tweet_id
    WHERE d.id = $1
    LIMIT 1
    `,
    [draftId]
  );
  return r.rows[0] || null;
}

async function findEligibleVideoDraft() {
  const r = await pool.query(
    `
    SELECT
      d.id,
      d.status,
      d.comment_tr,
      d.translation_tr,
      d.viral_score,
      d.created_at,
      t.tweet_id,
      t.source_handle,
      t.x_url,
      t.media,
      EXISTS(SELECT 1 FROM history h WHERE h.draft_id = d.id) AS already_posted
    FROM drafts d
    JOIN tweets t ON t.tweet_id = d.tweet_id
    WHERE t.media IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(t.media::jsonb) AS m(elem)
        WHERE m.elem->>'type' IN ('video', 'animated_gif')
      )
    ORDER BY COALESCE(d.viral_score, 0) DESC, d.id DESC
    LIMIT 200
    `
  );

  for (const row of r.rows) {
    try {
      const candidate = buildUploadCandidate(row.media);
      if (!candidate) continue;
      if (candidate.type === "photo") continue;
      return { row, candidate };
    } catch {
      // variants eksik veya uygun mp4 yoksa sıradaki adaya geç
    }
  }

  return null;
}

async function prepareQueueTest(draft, delaySec) {
  const scheduledAt = new Date(Date.now() + delaySec * 1000);

  await pool.query("BEGIN");
  try {
    await pool.query(`DELETE FROM queue WHERE draft_id=$1`, [draft.id]);
    await pool.query(`UPDATE drafts SET status='approved' WHERE id=$1`, [draft.id]);
    await pool.query(
      `
      INSERT INTO queue (draft_id, scheduled_at, status, attempts, created_at, updated_at, last_error)
      VALUES ($1, $2, 'waiting', 0, NOW(), NOW(), NULL)
      `,
      [draft.id, scheduledAt]
    );
    await pool.query("COMMIT");
  } catch (e) {
    await pool.query("ROLLBACK");
    throw e;
  }

  return scheduledAt;
}

async function printQueueStatus(draftId) {
  const q = await pool.query(
    `
    SELECT id, status, scheduled_at, attempts, last_error
    FROM queue
    WHERE draft_id=$1
    ORDER BY id DESC
    LIMIT 1
    `,
    [draftId]
  );
  return q.rows[0] || null;
}

async function run() {
  if (hasFlag("help")) {
    printHelp();
    await pool.end();
    return;
  }

  const mode = String(getArg("mode", "queue")).toLowerCase();
  const draftId = getArg("draftId", null);
  const delaySec = clampInt(getArg("delaySec", "90"), 5, 3600, 90);
  const listOnly = hasFlag("listOnly");

  if (!["queue", "post-now"].includes(mode)) {
    throw new Error("--mode sadece queue veya post-now olabilir");
  }

  let picked = null;
  if (draftId) {
    const row = await loadDraftById(Number(draftId));
    if (!row) throw new Error(`Draft bulunamadi: ${draftId}`);
    const candidate = buildUploadCandidate(row.media);
    if (!candidate || candidate.type === "photo") {
      throw new Error("Secilen draft videolu/gif uygun aday degil");
    }
    picked = { row, candidate };
  } else {
    picked = await findEligibleVideoDraft();
  }

  if (!picked) {
    throw new Error(
      "Uygun videolu draft bulunamadi. Videolu tweet yok, draft olusmamis ya da secilen videolarda kullanilabilir mp4 variant bulunmuyor."
    );
  }

  const { row, candidate } = picked;
  const finalText = buildFinalText(row);
  const queueStatus = await printQueueStatus(row.id);

  console.log("✅ Test draft secildi");
  console.log(`draft_id=${row.id}`);
  console.log(`tweet_id=${row.tweet_id}`);
  console.log(`source=${row.source_handle || "-"}`);
  console.log(`draft_status=${row.status}`);
  console.log(`already_posted=${row.already_posted}`);
  console.log(`media_type=${candidate.type}`);
  console.log(`media_url=${candidate.url}`);
  console.log(`source_url=${row.x_url || "-"}`);
  console.log(`text_length=${finalText.length}`);
  if (queueStatus) {
    console.log(
      `existing_queue=id:${queueStatus.id} status:${queueStatus.status} scheduled_at:${queueStatus.scheduled_at?.toISOString?.() || queueStatus.scheduled_at}`
    );
  }

  if (!hasOAuth1aEnv()) {
    console.log(
      "⚠️ Canli video upload icin OAuth1a env eksik. X_CONSUMER_KEY/SECRET ve X_ACCESS_TOKEN/SECRET gerekli."
    );
  }

  if (row.already_posted) {
    throw new Error("Bu draft zaten history'de gorunuyor; canli test icin yeni bir draft sec.");
  }
  if (!finalText) {
    throw new Error("Draft metni bos; once yorum/ceviri alanlarini doldur.");
  }
  if (finalText.length > 280) {
    throw new Error(`Draft metni cok uzun: ${finalText.length}`);
  }

  if (listOnly) {
    console.log("ℹ️ --listOnly aktif, DB degisikligi yapilmadi.");
    await pool.end();
    return;
  }

  if (mode === "queue") {
    const scheduledAt = await prepareQueueTest(row, delaySec);
    console.log("");
    console.log("=== CANLI QUEUE TEST AKISI ===");
    console.log(`1) Server'i ac: node server.js`);
    console.log(`2) Worker'i ac: node poster-worker.js`);
    console.log(`3) Queue UI: http://localhost:3000/queue-ui`);
    console.log(`4) History UI: http://localhost:3000/history-ui`);
    console.log(`5) Dogrulama: node verify-video-e2e.js --draftId=${row.id}`);
    console.log("");
    console.log(`Hazirlandi: draft_id=${row.id} scheduled_at=${scheduledAt.toISOString()}`);
  } else {
    const inboxStatus = row.status === "queued" ? "approved" : row.status;
    console.log("");
    console.log("=== CANLI POST NOW TEST AKISI ===");
    console.log(`1) Server'i ac: node server.js`);
    console.log(`2) Inbox UI: http://localhost:3000/inbox?status=${encodeURIComponent(inboxStatus)}`);
    console.log(`3) UTF-8 guvenli helper ile tetikle:`);
    console.log(
      `   node trigger-post-now.js --draftId=${row.id}`
    );
    console.log(`4) Dogrulama: node verify-video-e2e.js --draftId=${row.id}`);
    console.log("");
    console.log(`Hazir: draft_id=${row.id} media_type=${candidate.type}`);
  }

  await pool.end();
}

run().catch(async (e) => {
  console.error("❌ prepare-video-e2e hata:", e.message || e);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
