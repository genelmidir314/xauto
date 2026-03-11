require("dotenv").config();

async function ensureTweetMediaValidationSchema(pool) {
  await pool.query(`
    ALTER TABLE tweets
    ADD COLUMN IF NOT EXISTS media JSONB,
    ADD COLUMN IF NOT EXISTS x_url TEXT,
    ADD COLUMN IF NOT EXISTS media_uploadable BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS media_validation_error TEXT
  `);
}

module.exports = {
  ensureTweetMediaValidationSchema,
};
