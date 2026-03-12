/**
 * make-reply-drafts.js
 * reply_candidates'tan AI ile yorum üretir, reply_drafts'a yazar.
 * Günlük limit: REPLY_AI_DAILY_LIMIT (varsayılan 30)
 *
 * Çalıştır: node make-reply-drafts.js
 */

require("dotenv").config();
const { Pool } = require("pg");
const { generateReplyToTweet } = require("./lib/openai-comment");

const DAILY_LIMIT = Number(process.env.REPLY_AI_DAILY_LIMIT || 30) || 30;

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL yok");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const todayCount = await pool.query(
    `SELECT COUNT(*)::int AS n FROM reply_drafts WHERE created_at >= CURRENT_DATE`
  );
  const createdToday = todayCount.rows[0]?.n ?? 0;
  const remaining = Math.max(0, DAILY_LIMIT - createdToday);

  if (remaining <= 0) {
    console.log(`⚠️ Günlük limit (${DAILY_LIMIT}) doldu. Yarın tekrar deneyin.`);
    await pool.end();
    return;
  }

  const candidates = await pool.query(
    `
    SELECT c.id, c.tweet_id, c.author_handle, c.text, c.viral_score
    FROM reply_candidates c
    LEFT JOIN reply_drafts d ON d.tweet_id = c.tweet_id
    WHERE d.tweet_id IS NULL
    ORDER BY c.viral_score DESC NULLS LAST, c.ingested_at DESC
    LIMIT $1
    `,
    [remaining]
  );

  console.log(
    `✅ Aday: ${candidates.rows.length} (bugün: ${createdToday}/${DAILY_LIMIT}, kalan: ${remaining})`
  );

  let created = 0;

  for (const row of candidates.rows) {
    const replyText = await generateReplyToTweet(
      row.author_handle,
      row.text || ""
    );

    await pool.query(
      `INSERT INTO reply_drafts (tweet_id, reply_text, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (tweet_id) DO NOTHING`,
      [row.tweet_id, replyText]
    );

    created += 1;
    console.log(`✅ @${row.author_handle}: "${replyText.slice(0, 50)}..."`);
  }

  await pool.end();
  console.log(`🚀 make-reply-drafts tamam. Oluşturulan: ${created}`);
}

run().catch((e) => {
  console.error("❌ make-reply-drafts hata:", e?.message || e);
  process.exit(1);
});
