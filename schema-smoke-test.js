require("dotenv").config();
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL yok");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const draftRes = await client.query(
      `
      INSERT INTO drafts (
        tweet_id,
        comment_tr,
        translation_tr,
        format_key,
        status,
        created_at,
        viral_score,
        viral_reason,
        scored_at
      )
      VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7,NOW())
      RETURNING id, viral_score, viral_reason
      `,
      [
        `smoke_test_${Date.now()}`,
        "smoke comment",
        "smoke translation",
        "comment_plus_translation",
        "pending",
        77,
        "schema_smoke",
      ]
    );

    const draftId = draftRes.rows[0].id;

    const queueRes = await client.query(
      `
      INSERT INTO queue (
        draft_id,
        scheduled_at,
        status,
        attempts,
        created_at,
        updated_at,
        last_error
      )
      VALUES ($1, NOW(), 'waiting', 0, NOW(), NOW(), NULL)
      RETURNING id, attempts, updated_at
      `,
      [draftId]
    );

    await client.query(
      `
      UPDATE queue
      SET status='failed',
          attempts=attempts + 1,
          updated_at=NOW(),
          last_error=$2
      WHERE id=$1
      `,
      [queueRes.rows[0].id, "smoke failure"]
    );

    const verifyRes = await client.query(
      `
      SELECT
        d.viral_score,
        d.viral_reason,
        q.status,
        q.attempts,
        q.last_error
      FROM drafts d
      JOIN queue q ON q.draft_id = d.id
      WHERE d.id = $1
      `,
      [draftId]
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          smoke: verifyRes.rows[0],
        },
        null,
        2
      )
    );

    await client.query("ROLLBACK");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error("❌ schema smoke test hata:", error);
  process.exit(1);
});
