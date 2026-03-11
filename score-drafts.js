// score-drafts.js
// pending draft'ları skorlar: viral_score 0-100
// NOT: make-drafts.js zaten skorlama yapıyor. Bu script toplu yeniden skorlama için.
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function countMatches(text, regex) {
  const m = text.match(regex);
  return m ? m.length : 0;
}

function scoreTextSignals(text) {
  const t = (text || "").trim();
  const lower = t.toLowerCase();

  let score = 50;
  const reasons = [];

  const len = t.length;
  if (len >= 80 && len <= 200) { score += 12; reasons.push("ideal_length"); }
  else if (len >= 40 && len < 80) { score += 8; reasons.push("ok_length"); }
  else if (len > 200 && len <= 260) { score += 6; reasons.push("long_ok"); }
  else if (len > 260) { score -= 8; reasons.push("too_long"); }
  else if (len < 30) { score -= 10; reasons.push("too_short"); }

  const nums = countMatches(t, /\b\d+(\.\d+)?%?\b/g);
  if (nums >= 2) { score += 10; reasons.push("numbers"); }
  else if (nums === 1) { score += 6; reasons.push("one_number"); }

  const years = countMatches(t, /\b(18|19|20)\d{2}\b/g);
  if (years >= 1) { score += 6; reasons.push("year_hook"); }

  if (/(wild|insane|crazy|shocking|unexpected|you won't believe|mind-blowing)/i.test(t)) {
    score += 7; reasons.push("curiosity_words");
  }
  if (/(this is why|here's why|the reason|how it works|what happened)/i.test(t)) {
    score += 7; reasons.push("explainer_hook");
  }

  if (t.includes("?")) { score += 5; reasons.push("question"); }

  if (/(agree\?|what do you think|thoughts\?|your take|comment|retweet|share)/i.test(t)) {
    score += 6; reasons.push("cta");
  }

  const links = countMatches(t, /https?:\/\/\S+/gi);
  if (links >= 1) { score -= 8; reasons.push("has_link"); }

  const tags = countMatches(t, /#\w+/g);
  if (tags >= 3) { score -= 10; reasons.push("too_many_hashtags"); }
  else if (tags === 1 || tags === 2) { score -= 3; reasons.push("hashtags"); }

  const emojis = countMatches(t, /[\u{1F300}-\u{1FAFF}]/gu);
  if (emojis >= 1 && emojis <= 3) { score += 3; reasons.push("few_emojis"); }
  if (emojis >= 6) { score -= 6; reasons.push("too_many_emojis"); }

  if (/(markets|inflation|rates|recession|stocks|crypto|fed|economy)/i.test(lower)) {
    score += 6; reasons.push("news_finance");
  }

  // otomasyon kokusu azaltma
  if (/\b(i|my|me)\b/i.test(t)) { score -= 2; reasons.push("first_person"); }

  return { score: clamp(Math.round(score), 0, 100), reasons };
}

async function run() {
  const status = process.argv.includes("--approved") ? "approved" : "pending";
  const limit = 500;

  const res = await pool.query(
    `
    SELECT id, translation_tr, comment_tr
    FROM drafts
    WHERE status=$1
    ORDER BY created_at ASC
    LIMIT $2
    `,
    [status, limit]
  );

  console.log(`✅ Drafts to score: ${res.rows.length}`);

  let updated = 0;
  for (const d of res.rows) {
    const text = `${(d.comment_tr || "").trim()}\n\n${(d.translation_tr || "").trim()}`.trim();
    const { score, reasons } = scoreTextSignals(text);

    await pool.query(
      `
      UPDATE drafts
      SET viral_score=$2,
          viral_reason=$3,
          scored_at=NOW()
      WHERE id=$1
      `,
      [d.id, score, reasons.join(",")]
    );

    updated++;
    console.log(`scored draft_id=${d.id} score=${score}`);
  }

  console.log(`🚀 Done. updated=${updated}`);
  await pool.end();
}

run().catch((e) => {
  console.error("❌ score-drafts error:", e);
  process.exit(1);
});