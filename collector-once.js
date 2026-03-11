require("dotenv").config();
const { Pool } = require("pg");
const { getUserId, getLatestTweetsByUserId } = require("./x-api");
const { inspectStoredMedia } = require("./x-media-upload");
const { ensureTweetMediaValidationSchema } = require("./tweet-media-validation");
const {
  clampTier,
  computeNextCheckAt,
  computeResolveRetryAt,
  ensureSourcesManagementSchema,
} = require("./source-tier");
const {
  createCollectorRunMetrics,
  ensureCollectorMetricsSchema,
  recordCollectorRun,
  upsertSourcePerformance,
} = require("./collector-metrics");

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL yok");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function buildXUrl(handle, tweetId) {
  const h = String(handle || "").replace(/^@/, "");
  return `https://x.com/${h}/status/${tweetId}`;
}

async function run() {
  await ensureSourcesManagementSchema(pool);
  await ensureCollectorMetricsSchema(pool);
  await ensureTweetMediaValidationSchema(pool);

  const sources = await pool.query(
    `SELECT id, handle, tier, category, last_tweet_id, x_user_id, next_check_at, resolve_status
     FROM sources
     WHERE active = true
       AND (next_check_at IS NULL OR next_check_at <= NOW())
     ORDER BY tier ASC, next_check_at ASC NULLS FIRST, id ASC
     LIMIT 50`
  );

  const runMetrics = createCollectorRunMetrics(sources.rows.length);

  console.log(`✅ Kaynak sayısı: ${sources.rows.length}`);

  for (const s of sources.rows) {
    const sourceId = s.id;
    const handle = s.handle;
    const sinceId = s.last_tweet_id;
    const tier = clampTier(s.tier);
    const now = new Date();
    const sourceMetrics = {
      lastRunAt: new Date(),
      lastSuccessAt: null,
      resolveCalls: 0,
      timelineCalls: 0,
      newTweetsFound: 0,
      mediaTweetsFound: 0,
      draftCandidates: 0,
      errorCount: 0,
      lastResult: "started",
      lastError: null,
    };

    try {
      runMetrics.processedSources += 1;
      let userId = s.x_user_id;
      if (!userId) {
        runMetrics.userIdResolves += 1;
        sourceMetrics.resolveCalls += 1;
        userId = await getUserId(handle);
        await pool.query(
          `
          UPDATE sources
          SET x_user_id = $2,
              resolve_status = 'resolved',
              last_error = NULL
          WHERE id = $1
          `,
          [sourceId, userId]
        );
      }

      runMetrics.timelineCalls += 1;
      sourceMetrics.timelineCalls += 1;
      const tweets = await getLatestTweetsByUserId(userId, sinceId);
      const nextCheckAt = computeNextCheckAt(tier, now);
      runMetrics.newTweets += tweets.length;
      sourceMetrics.newTweetsFound += tweets.length;

      if (tweets.length === 0) {
        console.log(`- ${handle}: yeni tweet yok`);
        await pool.query(
          `
          UPDATE sources
          SET last_checked_at = NOW(),
              next_check_at = $2,
              resolve_status = CASE WHEN x_user_id IS NOT NULL THEN 'resolved' ELSE resolve_status END,
              last_error = NULL
          WHERE id = $1
          `,
          [sourceId, nextCheckAt]
        );
        sourceMetrics.lastSuccessAt = new Date();
        sourceMetrics.lastResult = "no_new_tweets";
        await upsertSourcePerformance(pool, sourceId, sourceMetrics);
        continue;
      }

      let newestId = sinceId;
      let insertedCount = 0;
      let skippedNoMedia = 0;

      for (const t of tweets) {
        const metrics = t.public_metrics || {};
        const like = metrics.like_count ?? 0;
        const repost = metrics.retweet_count ?? metrics.repost_count ?? 0;
        const reply = metrics.reply_count ?? 0;

        const mediaList = Array.isArray(t.__media) ? t.__media : [];
        const hasMedia = mediaList.length > 0;
        const mediaInspection = inspectStoredMedia(mediaList);
        const mediaUploadable = mediaInspection.ok && !!mediaInspection.candidate;
        const mediaValidationError = mediaInspection.error || null;

        // ✅ SADECE MEDYALI TWEETLERİ AL
        if (!hasMedia) {
          skippedNoMedia += 1;
          if (!newestId || BigInt(t.id) > BigInt(newestId)) newestId = t.id;
          continue;
        }

        if (mediaUploadable) {
          runMetrics.mediaTweets += 1;
          runMetrics.draftCandidates += 1;
          sourceMetrics.mediaTweetsFound += 1;
          sourceMetrics.draftCandidates += 1;
        }

        await pool.query(
          `INSERT INTO tweets
           (tweet_id, source_handle, text, lang, like_count, repost_count, reply_count, has_media, media, x_url, media_uploadable, media_validation_error, tweet_created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (tweet_id) DO UPDATE SET
             text = EXCLUDED.text,
             lang = EXCLUDED.lang,
             like_count = EXCLUDED.like_count,
             repost_count = EXCLUDED.repost_count,
             reply_count = EXCLUDED.reply_count,
             has_media = EXCLUDED.has_media,
             media = EXCLUDED.media,
             x_url = EXCLUDED.x_url,
             media_uploadable = EXCLUDED.media_uploadable,
             media_validation_error = EXCLUDED.media_validation_error,
             tweet_created_at = EXCLUDED.tweet_created_at`,
          [
            t.id,
            handle,
            t.text || null,
            t.lang || null,
            like,
            repost,
            reply,
            true,
            JSON.stringify(mediaList),
            buildXUrl(handle, t.id),
            mediaUploadable,
            mediaValidationError,
            t.created_at ? new Date(t.created_at) : null,
          ]
        );

        insertedCount += 1;

        if (!newestId || BigInt(t.id) > BigInt(newestId)) newestId = t.id;
      }

      await pool.query(
        `
        UPDATE sources
        SET last_tweet_id = $2,
            x_user_id = COALESCE(x_user_id, $3),
            last_checked_at = NOW(),
            next_check_at = $4,
            resolve_status = 'resolved',
            last_error = NULL
        WHERE id = $1
        `,
        [sourceId, newestId, userId, nextCheckAt]
      );

      sourceMetrics.lastSuccessAt = new Date();
      sourceMetrics.lastResult =
        sourceMetrics.draftCandidates > 0
          ? "new_media_tweets"
          : insertedCount > 0
            ? "media_not_uploadable"
            : "tweets_without_media";
      await upsertSourcePerformance(pool, sourceId, sourceMetrics);

      console.log(
        `✅ ${handle}: ${insertedCount} medyalı tweet yazıldı, ${skippedNoMedia} medyasız atlandı (last=${newestId})`
      );
    } catch (e) {
      console.log(`❌ ${handle}: ${e.message}`);
      runMetrics.errorCount += 1;
      sourceMetrics.errorCount += 1;
      sourceMetrics.lastResult = "error";
      sourceMetrics.lastError = String(e.message || e).slice(0, 1000);
      await pool.query(
        `
        UPDATE sources
        SET last_checked_at = NOW(),
            next_check_at = $2,
            resolve_status = CASE
              WHEN $3 ILIKE '%User id bulunamadı%' THEN 'failed'
              WHEN x_user_id IS NOT NULL THEN 'resolved'
              ELSE 'pending'
            END,
            last_error = $4
        WHERE id = $1
        `,
        [sourceId, computeResolveRetryAt(now), e.message || "", String(e.message || e).slice(0, 1000)]
      );
      await upsertSourcePerformance(pool, sourceId, sourceMetrics);
    }
  }

  const summaryNote = `due=${runMetrics.dueSources} processed=${runMetrics.processedSources} resolves=${runMetrics.userIdResolves} timeline=${runMetrics.timelineCalls}`;
  await recordCollectorRun(pool, runMetrics, summaryNote);

  await pool.end();
  console.log("🚀 Collector run bitti.");
}

run().catch((e) => {
  console.error("❌ Collector genel hata:", e);
  process.exit(1);
});