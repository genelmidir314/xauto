/**
 * reply-collector.js
 * reply_sources'taki hesapların viral tweet'lerini reply_candidates'a toplar.
 * Post sisteminden tamamen bağımsız.
 *
 * Çalıştır: node reply-collector.js
 */

require("dotenv").config();
const { Pool } = require("pg");
const { getUserId, getLatestTweetsByUserId } = require("./x-api");

const MIN_ENGAGEMENT =
  Number(process.env.REPLY_MIN_ENGAGEMENT || 50) || 50;

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL yok");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function engagementScore(like, retweet, reply) {
  const l = Number(like || 0) || 0;
  const r = Number(retweet || 0) || 0;
  const p = Number(reply || 0) || 0;
  return l + r * 2 + p;
}

async function run() {
  const sources = await pool.query(
    `SELECT id, handle, last_tweet_id, x_user_id
     FROM reply_sources
     WHERE active = true
     ORDER BY id ASC
     LIMIT 30`
  );

  if (sources.rows.length === 0) {
    console.log("⚠️ reply_sources bos. Reply hedefi ekleyin.");
    await pool.end();
    return;
  }

  console.log(`✅ Reply kaynak sayısı: ${sources.rows.length}`);

  let totalInserted = 0;

  for (const s of sources.rows) {
    const handle = s.handle;
    let userId = s.x_user_id;

    try {
      if (!userId) {
        userId = await getUserId(handle);
        await pool.query(
          `UPDATE reply_sources SET x_user_id = $2 WHERE id = $1`,
          [s.id, userId]
        );
      }

      const tweets = await getLatestTweetsByUserId(userId, s.last_tweet_id);
      let newestId = s.last_tweet_id;
      let inserted = 0;

      for (const t of tweets) {
        const metrics = t.public_metrics || {};
        const like = metrics.like_count ?? 0;
        const retweet = metrics.retweet_count ?? metrics.repost_count ?? 0;
        const reply = metrics.reply_count ?? 0;
        const score = engagementScore(like, retweet, reply);

        if (score < MIN_ENGAGEMENT) {
          if (!newestId || BigInt(t.id) > BigInt(newestId)) newestId = t.id;
          continue;
        }

        await pool.query(
          `INSERT INTO reply_candidates
           (tweet_id, author_handle, text, like_count, retweet_count, reply_count, viral_score, tweet_created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (tweet_id) DO UPDATE SET
             like_count = EXCLUDED.like_count,
             retweet_count = EXCLUDED.retweet_count,
             reply_count = EXCLUDED.reply_count,
             viral_score = EXCLUDED.viral_score`,
          [
            t.id,
            handle,
            t.text || null,
            like,
            retweet,
            reply,
            score,
            t.created_at ? new Date(t.created_at) : null,
          ]
        );

        inserted += 1;
        if (!newestId || BigInt(t.id) > BigInt(newestId)) newestId = t.id;
      }

      await pool.query(
        `UPDATE reply_sources SET last_tweet_id = $2, last_checked_at = NOW() WHERE id = $1`,
        [s.id, newestId]
      );

      totalInserted += inserted;
      console.log(`✅ @${handle}: ${inserted} viral tweet eklendi`);
    } catch (e) {
      console.log(`❌ @${handle}: ${e.message}`);
    }
  }

  await pool.end();
  console.log(`🚀 Reply collector bitti. Toplam: ${totalInserted} aday.`);
}

run().catch((e) => {
  console.error("❌ Reply collector hata:", e?.message || e);
  process.exit(1);
});
