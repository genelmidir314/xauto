// viral-score.js
// Amaç: metin + kaynak sinyallerinden 0-100 viral skor üretmek.
// NOT: Bu saf heuristik. Sonra istersen OpenAI ile "model skoru" ekleriz.

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function countMatches(text, regex) {
  const m = text.match(regex);
  return m ? m.length : 0;
}

function scoreTextSignals(text) {
  const t = (text || "").trim();
  const lower = t.toLowerCase();

  let score = 0;
  const reasons = [];

  // 1) Uzunluk (çok kısa da kötü, çok uzun da kötü)
  const len = t.length;
  if (len >= 80 && len <= 200) { score += 12; reasons.push("ideal_length"); }
  else if (len >= 40 && len < 80) { score += 8; reasons.push("ok_length"); }
  else if (len > 200 && len <= 260) { score += 6; reasons.push("long_ok"); }
  else if (len > 260) { score -= 8; reasons.push("too_long"); }
  else if (len < 30) { score -= 10; reasons.push("too_short"); }

  // 2) Sayılar / istatistik / yıllar (viral çalışır)
  const nums = countMatches(t, /\b\d+(\.\d+)?%?\b/g);
  if (nums >= 2) { score += 10; reasons.push("numbers"); }
  else if (nums === 1) { score += 6; reasons.push("one_number"); }

  const years = countMatches(t, /\b(18|19|20)\d{2}\b/g);
  if (years >= 1) { score += 6; reasons.push("year_hook"); }

  // 3) Merak boşluğu / şaşırtma
  if (/(wild|insane|crazy|shocking|unexpected|you won't believe|mind-blowing)/i.test(t)) {
    score += 7; reasons.push("curiosity_words");
  }
  if (/(this is why|here's why|the reason|how it works|what happened)/i.test(t)) {
    score += 7; reasons.push("explainers");
  }

  // 4) Soru işareti (etkileşim)
  if (t.includes("?")) { score += 5; reasons.push("question"); }

  // 5) Komut/CTA (retweet/yorum tetikler)
  if (/(agree\?|what do you think|thoughts\?|your take|comment|retweet|share)/i.test(t)) {
    score += 6; reasons.push("cta");
  }

  // 6) Aşırı link / spam kokusu
  const links = countMatches(t, /https?:\/\/\S+/gi);
  if (links >= 1) { score -= 8; reasons.push("has_link"); }

  // 7) Çok fazla hashtag (spam gibi)
  const tags = countMatches(t, /#\w+/g);
  if (tags >= 3) { score -= 10; reasons.push("too_many_hashtags"); }
  else if (tags === 1 || tags === 2) { score -= 3; reasons.push("hashtags"); }

  // 8) Emoji yoğunluğu (biraz iyi, fazlası kötü)
  const emojis = countMatches(t, /[\u{1F300}-\u{1FAFF}]/gu);
  if (emojis >= 1 && emojis <= 3) { score += 3; reasons.push("few_emojis"); }
  if (emojis >= 6) { score -= 6; reasons.push("too_many_emojis"); }

  // 9) Haber/finans kelimeleri (FT/Economist vb)
  if (/(markets|inflation|rates|recession|stocks|crypto|fed|economy)/i.test(lower)) {
    score += 6; reasons.push("news_finance");
  }

  // 10) Aşırı “ben” dili (otomasyon gibi durmasın)
  if (/\b(i|my|me)\b/i.test(t)) { score -= 2; reasons.push("first_person"); }

  return { score, reasons };
}

function scoreSourceSignals(source) {
  // source: { tier, category, handle }
  let score = 0;
  const reasons = [];

  const tier = Number(source?.tier || 2);
  const cat = String(source?.category || "").toLowerCase();

  if (tier === 1) { score += 12; reasons.push("tier1_source"); }
  else if (tier === 2) { score += 7; reasons.push("tier2_source"); }
  else { score += 3; reasons.push("tier3_source"); }

  if (cat.includes("viral")) { score += 8; reasons.push("viral_category"); }
  if (cat.includes("news")) { score += 6; reasons.push("news_category"); }
  if (cat.includes("ai")) { score += 5; reasons.push("ai_category"); }
  if (cat.includes("business")) { score += 4; reasons.push("business_category"); }

  // Bazı handle'lar genelde iyi perform eder (örnek)
  const h = String(source?.handle || "").toLowerCase();
  if (["historyinmemes", "rainmaker1973", "morbidful"].includes(h)) {
    score += 6; reasons.push("strong_handle");
  }

  return { score, reasons };
}

function viralScore({ baseText, source }) {
  const t = scoreTextSignals(baseText);
  const s = scoreSourceSignals(source);

  let total = 50; // baseline
  total += t.score;
  total += s.score;

  total = clamp(Math.round(total), 0, 100);

  const reasons = [...s.reasons, ...t.reasons];

  // Çok basit "risk" filtresi: çok kısa + link varsa daha da kırp
  const lower = (baseText || "").toLowerCase();
  if ((baseText || "").length < 40 && /https?:\/\//i.test(lower)) total = clamp(total - 15, 0, 100);

  return { score: total, reasons };
}

module.exports = { viralScore };