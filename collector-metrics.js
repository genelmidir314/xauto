require("dotenv").config();

async function ensureCollectorMetricsSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS collector_runs (
      id SERIAL PRIMARY KEY,
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMP,
      due_sources INTEGER NOT NULL DEFAULT 0,
      processed_sources INTEGER NOT NULL DEFAULT 0,
      user_id_resolves INTEGER NOT NULL DEFAULT 0,
      timeline_calls INTEGER NOT NULL DEFAULT 0,
      new_tweets INTEGER NOT NULL DEFAULT 0,
      media_tweets INTEGER NOT NULL DEFAULT 0,
      draft_candidates INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS source_performance (
      source_id INTEGER PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
      last_run_at TIMESTAMP,
      last_success_at TIMESTAMP,
      resolve_calls INTEGER NOT NULL DEFAULT 0,
      timeline_calls INTEGER NOT NULL DEFAULT 0,
      new_tweets_found INTEGER NOT NULL DEFAULT 0,
      media_tweets_found INTEGER NOT NULL DEFAULT 0,
      draft_candidates INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      last_result TEXT,
      last_error TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
}

function createCollectorRunMetrics(dueSources = 0) {
  return {
    startedAt: new Date(),
    dueSources,
    processedSources: 0,
    userIdResolves: 0,
    timelineCalls: 0,
    newTweets: 0,
    mediaTweets: 0,
    draftCandidates: 0,
    errorCount: 0,
  };
}

async function recordCollectorRun(pool, metrics, notes = null) {
  const finishedAt = new Date();
  const r = await pool.query(
    `
    INSERT INTO collector_runs (
      started_at,
      finished_at,
      due_sources,
      processed_sources,
      user_id_resolves,
      timeline_calls,
      new_tweets,
      media_tweets,
      draft_candidates,
      error_count,
      notes,
      created_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
    RETURNING *
    `,
    [
      metrics.startedAt,
      finishedAt,
      metrics.dueSources || 0,
      metrics.processedSources || 0,
      metrics.userIdResolves || 0,
      metrics.timelineCalls || 0,
      metrics.newTweets || 0,
      metrics.mediaTweets || 0,
      metrics.draftCandidates || 0,
      metrics.errorCount || 0,
      notes,
    ]
  );

  return r.rows[0];
}

async function upsertSourcePerformance(pool, sourceId, payload) {
  await pool.query(
    `
    INSERT INTO source_performance (
      source_id,
      last_run_at,
      last_success_at,
      resolve_calls,
      timeline_calls,
      new_tweets_found,
      media_tweets_found,
      draft_candidates,
      error_count,
      last_result,
      last_error,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
    ON CONFLICT (source_id)
    DO UPDATE SET
      last_run_at = EXCLUDED.last_run_at,
      last_success_at = COALESCE(EXCLUDED.last_success_at, source_performance.last_success_at),
      resolve_calls = source_performance.resolve_calls + EXCLUDED.resolve_calls,
      timeline_calls = source_performance.timeline_calls + EXCLUDED.timeline_calls,
      new_tweets_found = source_performance.new_tweets_found + EXCLUDED.new_tweets_found,
      media_tweets_found = source_performance.media_tweets_found + EXCLUDED.media_tweets_found,
      draft_candidates = source_performance.draft_candidates + EXCLUDED.draft_candidates,
      error_count = source_performance.error_count + EXCLUDED.error_count,
      last_result = EXCLUDED.last_result,
      last_error = EXCLUDED.last_error,
      updated_at = NOW()
    `,
    [
      sourceId,
      payload.lastRunAt || new Date(),
      payload.lastSuccessAt || null,
      payload.resolveCalls || 0,
      payload.timelineCalls || 0,
      payload.newTweetsFound || 0,
      payload.mediaTweetsFound || 0,
      payload.draftCandidates || 0,
      payload.errorCount || 0,
      payload.lastResult || null,
      payload.lastError || null,
    ]
  );
}

async function getCollectorMetricsSummary(pool) {
  const totalsQ = await pool.query(`
    SELECT
      COUNT(*)::int AS total_runs,
      COALESCE(SUM(due_sources), 0)::int AS due_sources,
      COALESCE(SUM(processed_sources), 0)::int AS processed_sources,
      COALESCE(SUM(user_id_resolves), 0)::int AS user_id_resolves,
      COALESCE(SUM(timeline_calls), 0)::int AS timeline_calls,
      COALESCE(SUM(new_tweets), 0)::int AS new_tweets,
      COALESCE(SUM(media_tweets), 0)::int AS media_tweets,
      COALESCE(SUM(draft_candidates), 0)::int AS draft_candidates,
      COALESCE(SUM(error_count), 0)::int AS error_count
    FROM collector_runs
  `);

  const lastRunQ = await pool.query(`
    SELECT *
    FROM collector_runs
    ORDER BY id DESC
    LIMIT 1
  `);

  const topSourcesQ = await pool.query(`
    SELECT
      s.handle,
      sp.source_id,
      sp.media_tweets_found,
      sp.draft_candidates,
      sp.timeline_calls,
      sp.error_count,
      sp.last_result,
      sp.updated_at
    FROM source_performance sp
    JOIN sources s ON s.id = sp.source_id
    ORDER BY sp.draft_candidates DESC, sp.media_tweets_found DESC, sp.updated_at DESC
    LIMIT 5
  `);

  const errorSourcesQ = await pool.query(`
    SELECT
      s.handle,
      sp.source_id,
      sp.error_count,
      sp.last_error,
      sp.updated_at
    FROM source_performance sp
    JOIN sources s ON s.id = sp.source_id
    WHERE sp.error_count > 0
    ORDER BY sp.updated_at DESC, sp.error_count DESC
    LIMIT 5
  `);

  const recentRunsQ = await pool.query(`
    SELECT
      id,
      started_at,
      finished_at,
      due_sources,
      processed_sources,
      user_id_resolves,
      timeline_calls,
      new_tweets,
      media_tweets,
      draft_candidates,
      error_count,
      notes
    FROM collector_runs
    ORDER BY id DESC
    LIMIT 12
  `);

  const trendQ = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '24 hours')::int AS runs_24h,
      COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '7 days')::int AS runs_7d,
      COALESCE(SUM(draft_candidates) FILTER (WHERE started_at >= NOW() - INTERVAL '24 hours'), 0)::int AS drafts_24h,
      COALESCE(SUM(draft_candidates) FILTER (WHERE started_at >= NOW() - INTERVAL '7 days'), 0)::int AS drafts_7d,
      COALESCE(SUM(new_tweets) FILTER (WHERE started_at >= NOW() - INTERVAL '24 hours'), 0)::int AS new_tweets_24h,
      COALESCE(SUM(new_tweets) FILTER (WHERE started_at >= NOW() - INTERVAL '7 days'), 0)::int AS new_tweets_7d,
      COALESCE(SUM(timeline_calls) FILTER (WHERE started_at >= NOW() - INTERVAL '24 hours'), 0)::int AS timeline_calls_24h,
      COALESCE(SUM(timeline_calls) FILTER (WHERE started_at >= NOW() - INTERVAL '7 days'), 0)::int AS timeline_calls_7d,
      COALESCE(SUM(error_count) FILTER (WHERE started_at >= NOW() - INTERVAL '24 hours'), 0)::int AS errors_24h,
      COALESCE(SUM(error_count) FILTER (WHERE started_at >= NOW() - INTERVAL '7 days'), 0)::int AS errors_7d
    FROM collector_runs
  `);

  const sourceCountsQ = await pool.query(`
    SELECT
      COUNT(*)::int AS total_sources,
      COUNT(*) FILTER (WHERE active = true)::int AS active_sources,
      COUNT(*) FILTER (WHERE active = true AND x_user_id IS NOT NULL)::int AS cached_sources,
      COUNT(*) FILTER (WHERE resolve_status = 'resolved')::int AS resolved_sources,
      COUNT(*) FILTER (WHERE resolve_status = 'pending')::int AS pending_sources,
      COUNT(*) FILTER (WHERE resolve_status = 'failed')::int AS failed_sources
    FROM sources
  `);

  const invalidMediaQ = await pool.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE has_media = true AND COALESCE(media_uploadable, false) = false
      )::int AS invalid_tweets,
      COUNT(*) FILTER (
        WHERE has_media = true AND COALESCE(media_uploadable, false) = true
      )::int AS uploadable_tweets
    FROM tweets
  `);

  const invalidDraftsQ = await pool.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE COALESCE(t.media_uploadable, false) = false
          AND d.status <> 'posted'
      )::int AS invalid_non_posted_drafts,
      COUNT(*) FILTER (
        WHERE COALESCE(t.media_uploadable, false) = false
          AND q.id IS NOT NULL
      )::int AS invalid_queued_drafts
    FROM drafts d
    JOIN tweets t ON t.tweet_id = d.tweet_id
    LEFT JOIN queue q ON q.draft_id = d.id
  `);

  const invalidMediaSourcesQ = await pool.query(`
    SELECT
      source_handle AS handle,
      COUNT(*)::int AS invalid_tweets
    FROM tweets
    WHERE has_media = true
      AND COALESCE(media_uploadable, false) = false
      AND source_handle IS NOT NULL
    GROUP BY source_handle
    ORDER BY invalid_tweets DESC, source_handle ASC
    LIMIT 5
  `);

  const totals = totalsQ.rows[0] || {};
  const sourceCounts = sourceCountsQ.rows[0] || {};
  const invalidMedia = invalidMediaQ.rows[0] || {};
  const invalidDrafts = invalidDraftsQ.rows[0] || {};
  const lastRun = lastRunQ.rows[0] || null;
  const trend = trendQ.rows[0] || {};
  const totalRuns = Number(totals.total_runs || 0);
  const dueSources = Number(totals.due_sources || 0);
  const processedSources = Number(totals.processed_sources || 0);
  const userIdResolves = Number(totals.user_id_resolves || 0);
  const timelineCalls = Number(totals.timeline_calls || 0);
  const activeSources = Number(sourceCounts.active_sources || 0);
  const lastRunDueSources = Number(lastRun?.due_sources || 0);

  return {
    totals: {
      ...totals,
      ...sourceCounts,
      ...invalidMedia,
      ...invalidDrafts,
      resolve_cache_hits: Math.max(0, processedSources - userIdResolves),
      due_filter_savings: Math.max(0, activeSources - lastRunDueSources),
      yield_per_timeline:
        timelineCalls > 0
          ? (Number(totals.draft_candidates || 0) / timelineCalls).toFixed(2)
          : "0.00",
    },
    lastRun,
    trend,
    recentRuns: recentRunsQ.rows,
    topSources: topSourcesQ.rows,
    recentErrors: errorSourcesQ.rows,
    invalidMediaSources: invalidMediaSourcesQ.rows,
    totalRuns,
  };
}

module.exports = {
  createCollectorRunMetrics,
  ensureCollectorMetricsSchema,
  getCollectorMetricsSummary,
  recordCollectorRun,
  upsertSourcePerformance,
};
