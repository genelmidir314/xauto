require("dotenv").config();
const { Pool } = require("pg");

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

async function loadDraft(draftId) {
  const r = await pool.query(
    `
    SELECT id, comment_tr, translation_tr
    FROM drafts
    WHERE id=$1
    LIMIT 1
    `,
    [draftId]
  );
  return r.rows[0] || null;
}

async function run() {
  const draftId = Number(getArg("draftId", ""));
  const baseUrl = String(getArg("baseUrl", "http://localhost:3000"));

  if (!Number.isFinite(draftId) || draftId < 1) {
    throw new Error("--draftId gerekli");
  }

  const draft = await loadDraft(draftId);
  if (!draft) {
    throw new Error(`Draft bulunamadi: ${draftId}`);
  }

  const response = await fetch(`${baseUrl}/drafts/${draftId}/post-now`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      comment_tr: draft.comment_tr,
      translation_tr: draft.translation_tr,
    }),
  });

  const bodyText = await response.text();
  console.log(bodyText);

  if (!response.ok) {
    process.exit(1);
  }
}

run()
  .catch((e) => {
    console.error("❌ trigger-post-now hata:", e.message || e);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch {}
  });
