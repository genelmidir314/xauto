/**
 * Bekleyen kuyruk satirlarinin scheduled_at zincirini hesaplar.
 * Anchor: son Gercek post (history.posted_at) + interval — boylece worker cooldown ile uyumlu kalir.
 */
const {
  getScheduleSettings,
  getIntervalForSlot,
} = require("../schedule-settings");
const { normalizeToActiveWindowTz } = require("./schedule-timezone");

function maxDate(a, b) {
  return new Date(Math.max(new Date(a).getTime(), new Date(b).getTime()));
}

async function getSchedulingAnchor(pool, scheduleSettingsArg) {
  const scheduleSettings = scheduleSettingsArg || (await getScheduleSettings(pool));
  const now = new Date();

  const historyRes = await pool.query(`
    SELECT posted_at FROM history ORDER BY posted_at DESC LIMIT 1
  `);

  let anchorMillis = now.getTime();
  if (historyRes.rowCount > 0 && historyRes.rows[0].posted_at) {
    anchorMillis = new Date(historyRes.rows[0].posted_at).getTime();
  }

  const intervals =
    scheduleSettings.postIntervalMinutes ?? [scheduleSettings.minPostIntervalMinutes];
  const firstInterval = getIntervalForSlot(intervals, 0);
  let next = new Date(anchorMillis + firstInterval * 60 * 1000);
  next = maxDate(next, now);
  return normalizeToActiveWindowTz(scheduleSettings, next);
}

async function rescheduleWaitingQueue(pool, scheduleSettingsArg) {
  const scheduleSettings = scheduleSettingsArg || (await getScheduleSettings(pool));
  const waitingQ = await pool.query(`
    SELECT id, draft_id, scheduled_at
    FROM queue
    WHERE status = 'waiting'
    ORDER BY scheduled_at ASC, id ASC
  `);

  if (waitingQ.rowCount === 0) return 0;

  let slot = await getSchedulingAnchor(pool, scheduleSettings);
  const intervals =
    scheduleSettings.postIntervalMinutes ?? [scheduleSettings.minPostIntervalMinutes];

  for (let i = 0; i < waitingQ.rows.length; i++) {
    const row = waitingQ.rows[i];
    await pool.query(`UPDATE queue SET scheduled_at=$2, updated_at=NOW() WHERE id=$1`, [
      row.id,
      slot,
    ]);

    const nextInterval = getIntervalForSlot(intervals, i + 1);
    slot = new Date(slot.getTime() + nextInterval * 60 * 1000);
    slot = normalizeToActiveWindowTz(scheduleSettings, slot);
  }

  return waitingQ.rowCount;
}

module.exports = {
  maxDate,
  getSchedulingAnchor,
  rescheduleWaitingQueue,
};
