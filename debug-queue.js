/**
 * Queue durumunu kontrol et - neden post atılmıyor?
 * node debug-queue.js
 */
require("dotenv").config();
const { Pool } = require("pg");
const { getScheduleSettings } = require("./schedule-settings");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log("=== Queue Debug ===\n");

  const nowDb = await pool.query("SELECT NOW() AS now");
  const now = nowDb.rows[0].now;
  console.log("DB NOW():", now);
  console.log("Node Date():", new Date().toISOString());
  console.log("");

  const scheduleSettings = await getScheduleSettings(pool);
  console.log("Schedule:", `${scheduleSettings.activeStartHour}:00-${scheduleSettings.activeEndHour}:00, interval=${scheduleSettings.minPostIntervalMinutes}m`);
  console.log("");

  const waiting = await pool.query(`
    SELECT q.id, q.draft_id, q.scheduled_at, q.status, q.attempts,
           (q.scheduled_at <= NOW()) AS is_due
    FROM queue q
    WHERE q.status = 'waiting'
    ORDER BY q.scheduled_at ASC
    LIMIT 5
  `);

  console.log("Waiting jobs (first 5):");
  if (waiting.rowCount === 0) {
    console.log("  (none)");
  } else {
    for (const r of waiting.rows) {
      const due = r.scheduled_at <= now ? "DUE" : "future";
      console.log(`  id=${r.id} draft_id=${r.draft_id} scheduled_at=${r.scheduled_at} ${due}`);
    }
  }
  console.log("");

  const dueCount = await pool.query(`
    SELECT COUNT(*)::int AS c FROM queue
    WHERE status='waiting' AND scheduled_at <= NOW()
  `);
  console.log("Due jobs (scheduled_at <= NOW()):", dueCount.rows[0].c);
  console.log("");

  const lastPosted = await pool.query(`
    SELECT posted_at FROM history ORDER BY posted_at DESC LIMIT 1
  `);
  if (lastPosted.rowCount > 0) {
    const diff = (new Date() - new Date(lastPosted.rows[0].posted_at)) / 60000;
    console.log("Last posted:", lastPosted.rows[0].posted_at, `(${Math.floor(diff)} min ago)`);
  } else {
    console.log("Last posted: (never)");
  }
  console.log("");

  const workerProcs = await pool.query(`
    SELECT pid, state, query_start, state_change
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND application_name LIKE '%node%' OR query LIKE '%queue%'
    LIMIT 5
  `).catch(() => ({ rows: [] }));
  console.log("Active DB connections: (check if poster-worker is connected)");
  console.log("");

  console.log("=== Checklist ===");
  console.log("1. poster-worker calisiyor mu?  node poster-worker.js");
  console.log("2. Aktif saat icinde mi? (", scheduleSettings.activeStartHour, "-", scheduleSettings.activeEndHour, ")");
  console.log("3. WORKER_DRY_RUN=false mi?");
  console.log("4. X auth (X_USER_BEARER veya OAuth1a) ayarli mi?");

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
