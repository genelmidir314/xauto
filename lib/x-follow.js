/**
 * lib/x-follow.js
 * - getMe() -> authenticated user id
 * - followUser(targetUserId) -> follow target
 *
 * OAuth 1.0a veya OAuth 2.0 User Context gerekli (poster ile aynı)
 */

const crypto = require("crypto");
const API_BASE = process.env.X_API_BASE || "https://api.twitter.com";
const X_USER_BEARER = process.env.X_USER_BEARER || "";
const X_CONSUMER_KEY = process.env.X_CONSUMER_KEY || "";
const X_CONSUMER_SECRET = process.env.X_CONSUMER_SECRET || "";
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN || "";
const X_ACCESS_SECRET = process.env.X_ACCESS_SECRET || "";

function hasOAuth2UserToken() {
  return !!X_USER_BEARER && X_USER_BEARER.length > 20;
}

function hasOAuth1a() {
  return (
    !!X_CONSUMER_KEY &&
    !!X_CONSUMER_SECRET &&
    !!X_ACCESS_TOKEN &&
    !!X_ACCESS_SECRET
  );
}

function ensureAuth() {
  if (hasOAuth1a() || hasOAuth2UserToken()) return;
  throw new Error(
    "Takip icin OAuth1a (X_CONSUMER_KEY/.../X_ACCESS_SECRET) veya X_USER_BEARER gerekli."
  );
}

function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => {
    return "%" + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

function buildOAuth1Header(method, url) {
  const oauthParams = {
    oauth_consumer_key: X_CONSUMER_KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };

  const baseUrl = url.split("?")[0];
  const paramString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join("&");
  const baseString = [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(paramString),
  ].join("&");
  const signingKey = `${percentEncode(X_CONSUMER_SECRET)}&${percentEncode(
    X_ACCESS_SECRET
  )}`;
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");
  oauthParams.oauth_signature = signature;
  return (
    "OAuth " +
    Object.keys(oauthParams)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
      .join(", ")
  );
}

function getAuthHeaders(method, url, body = null) {
  ensureAuth();
  const headers = { "Content-Type": "application/json" };
  if (hasOAuth1a()) {
    headers["Authorization"] = buildOAuth1Header(method, url);
  } else {
    headers["Authorization"] = `Bearer ${X_USER_BEARER}`;
  }
  return headers;
}

async function getMe() {
  const url = `${API_BASE}/2/users/me`;
  const headers = getAuthHeaders("GET", url);

  const res = await fetch(url, {
    method: "GET",
    headers,
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}

  if (!res.ok) {
    const err = new Error(`X API getMe ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.body = text;
    err.json = json;
    throw err;
  }

  const id = json?.data?.id;
  if (!id) throw new Error("getMe: user id alinamadi");
  return id;
}

async function followUser(sourceUserId, targetUserId) {
  const url = `${API_BASE}/2/users/${encodeURIComponent(sourceUserId)}/following`;
  const headers = getAuthHeaders("POST", url);
  const body = JSON.stringify({ target_user_id: String(targetUserId) });

  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}

  if (!res.ok) {
    const err = new Error(
      `X API follow ${res.status}: ${text.slice(0, 300)}`
    );
    err.status = res.status;
    err.body = text;
    err.json = json;
    throw err;
  }

  return json?.data || json;
}

module.exports = {
  getMe,
  followUser,
  hasOAuth1a,
  hasOAuth2UserToken: hasOAuth2UserToken,
};
