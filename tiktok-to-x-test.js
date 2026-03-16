/**
 * tiktok-to-x-test.js
 * TikTok URL -> indir -> X'e yukle (test)
 *
 * Kullanim:
 *   node tiktok-to-x-test.js "https://www.tiktok.com/@user/video/123"
 *   node tiktok-to-x-test.js --url="..." --post   # Gercek post (dikkat!)
 *
 * Varsayilan: sadece indir + upload testi, post atilmaz
 */

require("dotenv").config();
const path = require("path");

async function downloadTikTok(url) {
  const outputDir = path.join(process.cwd(), "tiktok-downloads");
  const { downloadTikTokVideo } = require("./tiktok-download.js");
  return downloadTikTokVideo(url, outputDir);
}

function getArg(name, fallback = null) {
  const arg = process.argv.find((x) => x.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.split("=").slice(1).join("=") || fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function getUrlFromArgs() {
  const url = getArg("url");
  if (url) return url;
  const pos = process.argv.findIndex((a) => a.startsWith("http"));
  return pos >= 0 ? process.argv[pos] : null;
}

async function run() {
  const url = getUrlFromArgs();
  if (!url) {
    console.error("Kullanim: node tiktok-to-x-test.js <tiktok_url> [--post]");
    process.exit(1);
  }

  const doPost = hasFlag("post");

  console.log("1) TikTok video indiriliyor...");
  const result = await downloadTikTok(url);
  const localPath = typeof result === "string" ? result : result.localPath;
  console.log("   Indirildi:", localPath);

  const { uploadVideoFromLocalFile } = require("./x-media-upload");
  const X_AUTH = {
    userBearer: process.env.X_USER_BEARER || "",
    consumerKey: process.env.X_CONSUMER_KEY || "",
    consumerSecret: process.env.X_CONSUMER_SECRET || "",
    accessToken: process.env.X_ACCESS_TOKEN || "",
    accessSecret: process.env.X_ACCESS_SECRET || "",
  };

  console.log("2) X'e video yukleniyor...");
  const result = await uploadVideoFromLocalFile(localPath, X_AUTH);
  console.log("   mediaId:", result.mediaId, "type:", result.type);

  if (doPost) {
    const API_BASE = process.env.X_API_BASE || "https://api.twitter.com";
    const crypto = require("crypto");
    const X_CONSUMER_KEY = process.env.X_CONSUMER_KEY || "";
    const X_CONSUMER_SECRET = process.env.X_CONSUMER_SECRET || "";
    const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN || "";
    const X_ACCESS_SECRET = process.env.X_ACCESS_SECRET || "";

    function percentEncode(str) {
      return encodeURIComponent(str).replace(/[!'()*]/g, (c) =>
        "%" + c.charCodeAt(0).toString(16).toUpperCase()
      );
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
      const signingKey = `${percentEncode(X_CONSUMER_SECRET)}&${percentEncode(X_ACCESS_SECRET)}`;
      oauthParams.oauth_signature = crypto
        .createHmac("sha1", signingKey)
        .update(baseString)
        .digest("base64");
      return (
        "OAuth " +
        Object.keys(oauthParams)
          .sort()
          .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
          .join(", ")
      );
    }

    const postUrl = `${API_BASE}/2/tweets`;
    const text = `TikTok test - ${new Date().toISOString().slice(0, 10)}`;
    const payload = {
      text,
      media: { media_ids: [result.mediaId] },
    };

    const res = await fetch(postUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: buildOAuth1Header("POST", postUrl),
      },
      body: JSON.stringify(payload),
    });

    const body = await res.text();
    if (!res.ok) {
      throw new Error(`X API ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = JSON.parse(body);
    const xId = json?.data?.id || json?.id;
    console.log("3) Post atildi. x_post_id:", xId);
    console.log("   https://x.com/i/web/status/" + xId);
  } else {
    console.log("3) Post atilmadi (--post ile gercek post yapilir)");
  }

  console.log("Tamam.");
}

run().catch((e) => {
  console.error("Hata:", e.message || e);
  process.exit(1);
});
