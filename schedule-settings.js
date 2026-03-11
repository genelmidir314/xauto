require("dotenv").config();

const DEFAULT_ACTIVE_START_HOUR = Number(
  process.env.WORKER_ACTIVE_START_HOUR || 6
);
const DEFAULT_ACTIVE_END_HOUR = Number(process.env.WORKER_ACTIVE_END_HOUR || 1);
const DEFAULT_MIN_POST_INTERVAL_MINUTES = Number(
  process.env.WORKER_MIN_POST_INTERVAL_MINUTES || 57
);

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function defaultScheduleSettings() {
  return {
    activeStartHour: clampInt(DEFAULT_ACTIVE_START_HOUR, 0, 23, 6),
    activeEndHour: clampInt(DEFAULT_ACTIVE_END_HOUR, 0, 23, 1),
    minPostIntervalMinutes: clampInt(
      DEFAULT_MIN_POST_INTERVAL_MINUTES,
      5,
      24 * 60,
      57
    ),
  };
}

function normalizeScheduleSettings(row = {}) {
  const defaults = defaultScheduleSettings();
  return {
    activeStartHour: clampInt(
      row.active_start_hour ?? row.activeStartHour,
      0,
      23,
      defaults.activeStartHour
    ),
    activeEndHour: clampInt(
      row.active_end_hour ?? row.activeEndHour,
      0,
      23,
      defaults.activeEndHour
    ),
    minPostIntervalMinutes: clampInt(
      row.min_post_interval_minutes ?? row.minPostIntervalMinutes,
      5,
      24 * 60,
      defaults.minPostIntervalMinutes
    ),
  };
}

function computeActiveWindowMinutes(settings) {
  const start = settings.activeStartHour;
  const end = settings.activeEndHour;

  if (start === end) return 24 * 60;
  if (start < end) return (end - start) * 60;
  return (24 - start + end) * 60;
}

function computeDailyLimit(settings) {
  const activeMinutes = computeActiveWindowMinutes(settings);
  return Math.max(1, Math.floor(activeMinutes / settings.minPostIntervalMinutes));
}

function validateScheduleSettingsInput(input = {}) {
  const normalized = normalizeScheduleSettings(input);

  const startHour = Number(input.activeStartHour ?? input.active_start_hour);
  const endHour = Number(input.activeEndHour ?? input.active_end_hour);
  const interval = Number(
    input.minPostIntervalMinutes ?? input.min_post_interval_minutes
  );

  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
    throw new Error("Baslangic saati 0-23 arasinda olmali");
  }
  if (!Number.isInteger(endHour) || endHour < 0 || endHour > 23) {
    throw new Error("Bitis saati 0-23 arasinda olmali");
  }
  if (!Number.isInteger(interval) || interval < 5 || interval > 24 * 60) {
    throw new Error("Paylasim araligi 5-1440 dakika arasinda olmali");
  }

  return normalized;
}

function formatHourLabel(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function toPublicScheduleSettings(settings) {
  const normalized = normalizeScheduleSettings(settings);
  return {
    ...normalized,
    dailyLimit: computeDailyLimit(normalized),
    activeWindowText: `${formatHourLabel(
      normalized.activeStartHour
    )}-${formatHourLabel(normalized.activeEndHour)}`,
  };
}

async function ensureScheduleSettingsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      active_start_hour INTEGER NOT NULL,
      active_end_hour INTEGER NOT NULL,
      min_post_interval_minutes INTEGER NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  const defaults = defaultScheduleSettings();
  await pool.query(
    `
    INSERT INTO schedule_settings (
      id,
      active_start_hour,
      active_end_hour,
      min_post_interval_minutes,
      updated_at
    )
    VALUES (1, $1, $2, $3, NOW())
    ON CONFLICT (id) DO NOTHING
    `,
    [
      defaults.activeStartHour,
      defaults.activeEndHour,
      defaults.minPostIntervalMinutes,
    ]
  );
}

async function getScheduleSettings(pool) {
  const r = await pool.query(
    `
    SELECT active_start_hour, active_end_hour, min_post_interval_minutes, updated_at
    FROM schedule_settings
    WHERE id = 1
    LIMIT 1
    `
  );

  if (r.rowCount === 0) {
    await ensureScheduleSettingsTable(pool);
    return getScheduleSettings(pool);
  }

  return toPublicScheduleSettings(r.rows[0]);
}

async function updateScheduleSettings(pool, input) {
  const next = validateScheduleSettingsInput(input);
  await pool.query(
    `
    INSERT INTO schedule_settings (
      id,
      active_start_hour,
      active_end_hour,
      min_post_interval_minutes,
      updated_at
    )
    VALUES (1, $1, $2, $3, NOW())
    ON CONFLICT (id)
    DO UPDATE SET
      active_start_hour = EXCLUDED.active_start_hour,
      active_end_hour = EXCLUDED.active_end_hour,
      min_post_interval_minutes = EXCLUDED.min_post_interval_minutes,
      updated_at = NOW()
    `,
    [
      next.activeStartHour,
      next.activeEndHour,
      next.minPostIntervalMinutes,
    ]
  );
  return getScheduleSettings(pool);
}

module.exports = {
  computeActiveWindowMinutes,
  computeDailyLimit,
  defaultScheduleSettings,
  ensureScheduleSettingsTable,
  formatHourLabel,
  getScheduleSettings,
  toPublicScheduleSettings,
  updateScheduleSettings,
  validateScheduleSettingsInput,
};
