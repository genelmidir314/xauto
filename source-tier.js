require("dotenv").config();

const SOURCE_TIER_CHECK_INTERVALS = {
  1: 15,
  2: 60,
  3: 180,
};

function clampTier(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(3, Math.trunc(n)));
}

function normalizeHandle(handle) {
  return String(handle || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function getTierCheckIntervalMinutes(tier) {
  return SOURCE_TIER_CHECK_INTERVALS[clampTier(tier)] || SOURCE_TIER_CHECK_INTERVALS[2];
}

function computeNextCheckAt(tier, fromDate = new Date()) {
  const base = new Date(fromDate);
  return new Date(
    base.getTime() + getTierCheckIntervalMinutes(tier) * 60 * 1000
  );
}

function computeResolveRetryAt(fromDate = new Date(), delayMinutes = 360) {
  const base = new Date(fromDate);
  return new Date(base.getTime() + delayMinutes * 60 * 1000);
}

function validateSourceInput(input = {}) {
  const handle = normalizeHandle(input.handle || input.username);
  if (!handle) {
    throw new Error("Kullanici adi bos olamaz");
  }

  const tier = clampTier(input.tier);
  const category = String(input.category || "").trim() || null;
  const active =
    input.active === undefined ? true : String(input.active) !== "false";

  return {
    handle,
    tier,
    category,
    active,
  };
}

async function ensureSourcesManagementSchema(pool) {
  await pool.query(`
    ALTER TABLE sources
    ADD COLUMN IF NOT EXISTS last_tweet_id TEXT,
    ADD COLUMN IF NOT EXISTS x_user_id TEXT,
    ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS next_check_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS resolve_status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS last_error TEXT
  `);

  await pool.query(`
    UPDATE sources
    SET next_check_at = NOW()
    WHERE next_check_at IS NULL
  `);

  await pool.query(`
    UPDATE sources
    SET resolve_status = CASE
      WHEN x_user_id IS NOT NULL THEN 'resolved'
      ELSE COALESCE(resolve_status, 'pending')
    END
    WHERE resolve_status IS NULL OR resolve_status = ''
  `);
}

module.exports = {
  SOURCE_TIER_CHECK_INTERVALS,
  clampTier,
  computeNextCheckAt,
  computeResolveRetryAt,
  ensureSourcesManagementSchema,
  getTierCheckIntervalMinutes,
  normalizeHandle,
  validateSourceInput,
};
