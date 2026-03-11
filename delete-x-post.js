require("dotenv").config();
const crypto = require("crypto");

const API_BASE = process.env.X_API_BASE || "https://api.twitter.com";
const X_USER_BEARER = process.env.X_USER_BEARER || "";
const X_CONSUMER_KEY = process.env.X_CONSUMER_KEY || "";
const X_CONSUMER_SECRET = process.env.X_CONSUMER_SECRET || "";
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN || "";
const X_ACCESS_SECRET = process.env.X_ACCESS_SECRET || "";

function getArg(name, fallback = null) {
  const arg = process.argv.find((x) => x.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.split("=").slice(1).join("=") || fallback;
}

function percentEncode(str) {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function hasOAuth1a() {
  return !!(
    X_CONSUMER_KEY &&
    X_CONSUMER_SECRET &&
    X_ACCESS_TOKEN &&
    X_ACCESS_SECRET
  );
}

function hasOAuth2UserToken() {
  return !!X_USER_BEARER && X_USER_BEARER.length > 20;
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

async function deleteTweet(tweetId) {
  const url = `${API_BASE}/2/tweets/${encodeURIComponent(tweetId)}`;
  const headers = {};

  if (hasOAuth1a()) {
    headers.Authorization = buildOAuth1Header("DELETE", url);
  } else if (hasOAuth2UserToken()) {
    headers.Authorization = `Bearer ${X_USER_BEARER}`;
  } else {
    throw new Error(
      "X auth eksik. Silmek için OAuth1a veya OAuth2 user-context gerekli."
    );
  }

  const res = await fetch(url, {
    method: "DELETE",
    headers,
  });

  const bodyText = await res.text();
  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch {}

  if (!res.ok) {
    throw new Error(`X delete error ${res.status}: ${bodyText.slice(0, 500)}`);
  }

  return json;
}

async function run() {
  const tweetId = String(getArg("id", "")).trim();
  if (!tweetId) {
    throw new Error("Kullanim: node delete-x-post.js --id=<tweet_id>");
  }

  const result = await deleteTweet(tweetId);
  console.log(JSON.stringify({ ok: true, tweetId, result }, null, 2));
}

run().catch((e) => {
  console.error("❌ delete-x-post hata:", e.message || e);
  process.exit(1);
});
