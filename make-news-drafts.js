/**
 * make-news-drafts.js
 * news_items'dan OpenAI ile 20 özgün X postu üretir.
 *
 * Çalıştır: node make-news-drafts.js
 */

require("dotenv").config();
const { Pool } = require("pg");
const { openaiChat } = require("./lib/openai-comment");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const TARGET_COUNT = 20;
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();

async function generateNewsPosts(newsItems) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY yok");
  }

  const headlines = newsItems
    .map((i, idx) => `${idx + 1}. ${i.title}${i.summary ? " (" + i.summary.slice(0, 100) + "...)" : ""}`)
    .join("\n");

  const systemPrompt = `Sen bir sosyal medya içerik uzmanısın. Verilen haber başlıklarından X (Twitter) için özgün Türkçe postlar yazıyorsun.

Kurallar:
- Her post tamamen farklı olsun (açı, ton, vurgu)
- Max 280 karakter (X limiti)
- Türkçe
- Haber, yorum, soru, istatistik gibi farklı formatlar kullan
- Tekrarlayan ifade kullanma
- Doğrudan kopyala-yapıştır yapma
- Her postun sonuna KESINLIKLE haberle alakalı 3 hashtag ekle (örn: #Gundem #Ekonomi #Turkiye). Hashtag'ler konuyla ilgili olmali, rastgele kullanma.
- Sadece post metni, başka açıklama yok`;

  const userPrompt = `Bu haberlerden tam ${TARGET_COUNT} adet birbirinden farklı X postu yaz. Her satırda sadece bir post. Numara veya işaret koyma. Her satır ayrı bir post.
Her postun sonunda o habere ozel 3 hashtag olmali (toplam 280 karakter icinde).

Haberler:
${headlines}`;

  const out = await openaiChat(systemPrompt, userPrompt, 0.7);
  const lines = out
    .split("\n")
    .map((l) => l.replace(/^\d+[\.\)]\s*/, "").trim())
    .filter((l) => l.length > 0 && l.length <= 280);

  return lines.slice(0, TARGET_COUNT);
}

async function run() {
  await pool.query(
    `DELETE FROM news_drafts WHERE status = 'pending'`
  );

  const items = await pool.query(
    `SELECT id, title, link, summary FROM news_items n
     WHERE n.id NOT IN (
       SELECT item_id FROM news_drafts WHERE item_id IS NOT NULL
     )
     ORDER BY n.fetched_at DESC LIMIT 50`
  );

  if (items.rows.length === 0) {
    console.log("⚠️ news_items bos. Önce news-collector çalıştırın.");
    await pool.end();
    return;
  }

  console.log(`✅ Haber sayısı: ${items.rows.length}`);

  let posts = [];
  try {
    posts = await generateNewsPosts(items.rows);
    console.log(`✅ OpenAI'dan ${posts.length} post üretildi.`);
  } catch (e) {
    console.error("❌ OpenAI hata:", e.message);
    await pool.end();
    process.exit(1);
  }

  if (posts.length === 0) {
    console.log("⚠️ Üretilen post yok.");
    await pool.end();
    return;
  }

  const itemIds = items.rows.map((r) => r.id);
  let inserted = 0;

  for (let i = 0; i < posts.length; i++) {
    const itemId = itemIds[i % itemIds.length];
    await pool.query(
      `INSERT INTO news_drafts (item_id, post_text, status)
       VALUES ($1, $2, 'pending')`,
      [itemId, posts[i]]
    );
    inserted++;
  }

  console.log(`✅ ${inserted} draft eklendi.`);
  await pool.end();
}

run().catch((e) => {
  console.error("❌ make-news-drafts hata:", e.message);
  process.exit(1);
});
