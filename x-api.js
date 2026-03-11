// x-api.js
// - getUserId(handle)
// - getLatestTweetsByUserId(userId, sinceId)
//
// App bearer ile okuma
// Quoted tweet medyasını da toplar

const API_BASE = process.env.X_API_BASE || "https://api.twitter.com";
const X_BEARER =
  process.env.X_USER_BEARER ||
  process.env.X_BEARER ||
  process.env.BEARER_TOKEN ||
  "";

function getBearer() {
  const token = String(X_BEARER || "").trim();
  if (!token || token.length < 20) {
    throw new Error("Bearer token yok/eksik (.env kontrol et)");
  }
  return token;
}

async function xFetch(path) {
  const token = getBearer();
  const url = `${API_BASE}${path}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}

  if (!res.ok) {
    const err = new Error(`X API ${res.status} ${path}: ${text.slice(0, 500)}`);
    err.status = res.status;
    err.body = text;
    err.json = json;
    throw err;
  }

  return json;
}

async function getUserId(handle) {
  const clean = String(handle || "").trim().replace(/^@/, "");
  if (!clean) throw new Error("Handle boş");

  const j = await xFetch(`/2/users/by/username/${encodeURIComponent(clean)}`);
  const id = j?.data?.id;
  if (!id) throw new Error("User id bulunamadı");
  return id;
}

function mediaMapFromIncludes(includes) {
  const list = includes?.media || [];
  return new Map(list.map((m) => [m.media_key, m]));
}

function tweetMapFromIncludes(includes) {
  const list = includes?.tweets || [];
  return new Map(list.map((t) => [t.id, t]));
}

function normalizeMediaKeys(mediaKeys, mediaMap, sourceLabel) {
  if (!Array.isArray(mediaKeys) || mediaKeys.length === 0) return [];

  return mediaKeys
    .map((k) => mediaMap.get(k))
    .filter(Boolean)
    .map((m) => ({
      media_key: m.media_key || null,
      type: m.type || null,
      url: m.url || null,
      preview_image_url: m.preview_image_url || null,
      duration_ms: m.duration_ms || null,
      variants: Array.isArray(m.variants)
        ? m.variants.map((variant) => ({
            bit_rate: variant?.bit_rate ?? null,
            content_type: variant?.content_type || null,
            url: variant?.url || null,
          }))
        : [],
      alt_text: m.alt_text || null,
      width: m.width || null,
      height: m.height || null,
      source: sourceLabel || "self",
    }));
}

function normalizeMedia(tweet, includes) {
  const mediaMap = mediaMapFromIncludes(includes);
  const includesTweetMap = tweetMapFromIncludes(includes);

  const out = [];

  // 1) Ana tweet medyası
  const selfKeys = tweet?.attachments?.media_keys || [];
  out.push(...normalizeMediaKeys(selfKeys, mediaMap, "self"));

  // 2) Quoted tweet medyası
  const refs = tweet?.referenced_tweets || [];
  const quoted = refs.find((r) => r.type === "quoted");
  if (quoted?.id) {
    const qt = includesTweetMap.get(quoted.id);
    const quotedKeys = qt?.attachments?.media_keys || [];
    out.push(...normalizeMediaKeys(quotedKeys, mediaMap, "quoted"));
  }

  return out;
}

async function getLatestTweetsByUserId(userId, sinceId) {
  const params = new URLSearchParams({
    max_results: "10",
    "tweet.fields": "created_at,lang,public_metrics,attachments,referenced_tweets",
    "media.fields":
      "media_key,type,url,preview_image_url,alt_text,width,height,duration_ms,variants",
    "expansions":
      "attachments.media_keys,referenced_tweets.id,referenced_tweets.id.attachments.media_keys",
  });

  if (sinceId) {
    params.set("since_id", String(sinceId));
  }

  const j = await xFetch(`/2/users/${encodeURIComponent(userId)}/tweets?${params.toString()}`);
  const tweets = Array.isArray(j?.data) ? j.data : [];
  const includes = j?.includes || {};

  for (const t of tweets) {
    t.__media = normalizeMedia(t, includes);
  }

  return tweets;
}

module.exports = {
  getUserId,
  getLatestTweetsByUserId,
};