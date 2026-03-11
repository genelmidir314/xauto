// playwright-login.js
// Amaç: X'e MANUEL login ol (passkey dahil) ve session'ı kaydet.
// Sonraki çalıştırmalarda otomasyon login'e gitmez.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const STORAGE_PATH = path.join(__dirname, "storageState.json");

async function main() {
  console.log("🚀 X Login başlıyor (Chrome açılacak).");
  console.log("✅ X'e normal şekilde giriş yap (passkey kullanabilirsin).");
  console.log("✅ Ana sayfada olduğunu görünce bu terminale geri dön ve ENTER'a bas.");

  const browser = await chromium.launch({
    headless: false,
    channel: "chrome",
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://x.com/i/flow/login", { waitUntil: "domcontentloaded" });

  // Kullanıcı manuel login olacak
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });

  // Basit kontrol: x.com'da mıyız?
  const url = page.url();
  console.log("🔎 Current URL:", url);

  // Session kaydet
  await context.storageState({ path: STORAGE_PATH });

  await browser.close();

  if (fs.existsSync(STORAGE_PATH)) {
    console.log("✅ storageState.json kaydedildi:", STORAGE_PATH);
    console.log("⚠️ Bu dosyayı kimseyle paylaşma. .gitignore'a ekle.");
  } else {
    console.log("❌ storageState.json oluşmadı.");
  }
}

main().catch((e) => {
  console.error("❌ Login script error:", e);
  process.exit(1);
});