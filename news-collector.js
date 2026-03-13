/**
 * news-collector.js
 * news_sources'daki RSS feed'lerinden haber çeker, news_items'a yazar.
 *
 * Çalıştır: node news-collector.js
 */

require("dotenv").config();
const { Pool } = require("pg");
const Parser = require("rss-parser");

const parser = new Parser({ timeout: 10000 });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const sources = await pool.query(
    `SELECT id, name, feed_url FROM news_sources WHERE active = true ORDER BY id`
  );

  if (sources.rows.length === 0) {
    console.log("⚠️ news_sources bos. Haber kaynagi ekleyin.");
    await pool.end();
    return;
  }

  console.log(`✅ Haber kaynagi: ${sources.rows.length}`);

  let totalInserted = 0;

  for (const s of sources.rows) {
    try {
      const feed = await parser.parseURL(s.feed_url);
      const items = feed.items || [];
      let inserted = 0;

      for (const item of items.slice(0, 15)) {
        const title = String(item.title || "").trim();
        const link = String(item.link || item.guid || "").trim();
        const summary = String(item.contentSnippet || item.content || item.summary || "").trim().slice(0, 500);

        if (!title) continue;
        if (!link) continue;

        await pool.query(
          `INSERT INTO news_items (source_id, title, link, summary)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (link) DO UPDATE SET
             title = EXCLUDED.title,
             summary = EXCLUDED.summary,
             fetched_at = NOW()`,
          [s.id, title, link, summary || null]
        );
        inserted++;
      }

      await pool.query(
        `UPDATE news_sources SET last_fetch_at = NOW() WHERE id = $1`,
        [s.id]
      );

      totalInserted += inserted;
      console.log(`- ${s.name}: ${inserted} haber`);
    } catch (e) {
      console.error(`- ${s.name} hata:`, e.message);
    }
  }

  console.log(`\n✅ Toplam: ${totalInserted} haber eklendi/guncellendi.`);
  await pool.end();
}

run().catch((e) => {
  console.error("❌ news-collector hata:", e.message);
  process.exit(1);
});
