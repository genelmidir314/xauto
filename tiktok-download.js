/**
 * tiktok-download.js
 * yt-dlp ile TikTok video indirir.
 *
 * Kullanim:
 *   node tiktok-download.js "https://www.tiktok.com/@user/video/123"
 *   node tiktok-download.js --url="https://..."
 *
 * Cikti: indirilen dosya yolu (stdout) veya hata (stderr, exit 1)
 */

require("dotenv").config();
const path = require("path");
const fs = require("fs");

const YTDlpWrap = require("yt-dlp-wrap").default;

const TIKTOK_DOWNLOAD_DIR =
  process.env.TIKTOK_DOWNLOAD_DIR ||
  path.join(process.cwd(), "tiktok-downloads");

function getArg(name, fallback = null) {
  const arg = process.argv.find((x) => x.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.split("=").slice(1).join("=") || fallback;
}

function getUrlFromArgs() {
  const url = getArg("url");
  if (url) return url;
  const pos = process.argv.findIndex((a) => a.startsWith("http"));
  return pos >= 0 ? process.argv[pos] : null;
}

async function ensureYtDlp() {
  const binDir = path.join(process.cwd(), ".yt-dlp-bin");
  const binPath = path.join(
    binDir,
    process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"
  );

  if (fs.existsSync(binPath)) {
    return binPath;
  }

  console.error("yt-dlp binary bulunamadi, indiriliyor...");
  fs.mkdirSync(binDir, { recursive: true });
  await YTDlpWrap.downloadFromGithub(binDir);
  return binPath;
}

async function downloadTikTokVideo(url, outputDir = TIKTOK_DOWNLOAD_DIR) {
  const cleanUrl = String(url || "").trim();
  if (!cleanUrl || !cleanUrl.includes("tiktok.com")) {
    throw new Error("Gecersiz TikTok URL");
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const outputTemplate = path.join(outputDir, "%(id)s.%(ext)s");

  const ytDlpPath = await ensureYtDlp();
  const ytDlp = new YTDlpWrap(ytDlpPath);

  const args = [
    cleanUrl,
    "-f",
    "best[ext=mp4]/best",
    "-o",
    outputTemplate,
    "--no-warnings",
    "--no-playlist",
  ];

  await ytDlp.execPromise(args);

  const files = fs.readdirSync(outputDir);
  const videos = files
    .filter((f) => f.endsWith(".mp4") || f.endsWith(".webm"))
    .map((f) => ({
      path: path.join(outputDir, f),
      mtime: fs.statSync(path.join(outputDir, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (videos.length === 0) {
    throw new Error("Video indirildi ama dosya bulunamadi");
  }

  const localPath = videos[0].path;
  let metadata = {};
  try {
    metadata = await ytDlp.getVideoInfo(cleanUrl);
  } catch (_) {}

  return { localPath, metadata };
}

/** Kullanici profilinden video URL listesi alir (yt-dlp --flat-playlist). */
async function getTikTokUserVideoUrls(userProfileUrl, limit = 10) {
  const cleanUrl = String(userProfileUrl || "").trim();
  if (!cleanUrl || !cleanUrl.includes("tiktok.com") || cleanUrl.includes("/video/")) {
    throw new Error("Kullanici profil URL gerekli (orn: https://tiktok.com/@username)");
  }

  const ytDlpPath = await ensureYtDlp();
  const ytDlp = new YTDlpWrap(ytDlpPath);

  const args = [
    cleanUrl,
    "--flat-playlist",
    "--print",
    "%(webpage_url)s",
    "-I",
    `1:${Math.min(limit, 20)}`,
    "--no-warnings",
  ];

  const stdout = await ytDlp.execPromise(args);
  const urls = (stdout || "")
    .split("\n")
    .map((u) => u.trim())
    .filter((u) => u && u.includes("/video/"));
  return urls;
}

async function run() {
  const url = getUrlFromArgs();
  if (!url) {
    console.error("Kullanim: node tiktok-download.js <tiktok_url>");
    console.error("  veya: node tiktok-download.js --url=<tiktok_url>");
    process.exit(1);
  }

  const result = await downloadTikTokVideo(url);
  const out = typeof result === "string" ? result : result.localPath;
  console.log(out);
}

if (require.main === module) {
  run().catch((e) => {
    console.error("Hata:", e.message || e);
    process.exit(1);
  });
}

module.exports = {
  downloadTikTokVideo,
  getTikTokUserVideoUrls,
  TIKTOK_DOWNLOAD_DIR,
};
