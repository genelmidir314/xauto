/**
 * Gündem modülü için news_sources, news_items, news_drafts tablolarını oluşturur.
 * Server startup'ta çağrılır - deploy sonrası /news-ui sayfası çalışması için.
 */

async function ensureNewsSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news_sources (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      feed_url TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT true,
      last_fetch_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news_items (
      id SERIAL PRIMARY KEY,
      source_id INTEGER REFERENCES news_sources(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      link TEXT,
      summary TEXT,
      media_url TEXT,
      fetched_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(link)
    )
  `);
  await pool.query(`ALTER TABLE news_items ADD COLUMN IF NOT EXISTS media_url TEXT`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news_drafts (
      id SERIAL PRIMARY KEY,
      item_id INTEGER REFERENCES news_items(id) ON DELETE CASCADE,
      post_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      posted_at TIMESTAMP,
      x_post_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    INSERT INTO news_sources (name, feed_url) VALUES
      ('BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml'),
      ('Reuters', 'https://feeds.reuters.com/reuters/topNews'),
      ('Anadolu Ajansi', 'https://www.aa.com.tr/tr/rss/default?cat=guncel'),
      ('CNN Turk', 'https://www.cnnturk.com/feed/rss/turkiye'),
      ('Haberler.com', 'https://www.haberler.com/rss/'),
      ('T24', 'https://www.t24.com.tr/rss/haberler'),
      ('Haber3', 'https://www.haber3.com/rss'),
      ('Vatan', 'https://gazetevatan.com/rss/gundem.xml'),
      ('A Haber', 'https://www.ahaber.com.tr/rss/gundem.xml'),
      ('Sol', 'https://haber.sol.org.tr/rss.xml'),
      ('10haber', 'https://10haber.net/feed/')
    ON CONFLICT (feed_url) DO NOTHING
  `);
}

module.exports = { ensureNewsSchema };
