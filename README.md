# XAuto

X (Twitter) kaynak hesaplardan medyalı tweet toplayan, Türkçe draft üreten ve planlı paylaşım yapan yarı-otomatik sistem.

## Akış

```
sources → collector → tweets → make-drafts → drafts → queue → poster-worker → history
```

- **sources**: Takip edilecek X hesapları
- **collector-once.js**: Kaynaklardan medyalı tweet çeker
- **make-drafts.js**: Tweet’leri Türkçe yorum/çeviri ile draft’a dönüştürür
- **server.js**: Inbox / Queue / History UI + API
- **poster-worker.js**: Kuyruktaki işleri X’e post eder

## Gereksinimler

- Node.js 18+
- PostgreSQL (Neon vb. desteklenir)
- X API erişimi (Bearer + OAuth1a veya sadece Bearer)
- OpenAI API key (draft çeviri/yorum için, opsiyonel)

## Kurulum

```bash
npm install
```

`.env` dosyası oluştur:

```env
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
X_USER_BEARER=...          # X okuma + yazma (tercih edilen)
X_CONSUMER_KEY=...         # OAuth1a (video upload için gerekli)
X_CONSUMER_SECRET=...
X_ACCESS_TOKEN=...
X_ACCESS_SECRET=...
OPENAI_API_KEY=...         # Opsiyonel; yoksa fallback yorum kullanılır
```

## Veritabanı

İlk kurulum:

```bash
node db-init.js
```

Mevcut DB’ye yeni kolonlar eklemek için:

```bash
node db-migrate.js
```

Şema doğrulama (transaction içinde test, rollback):

```bash
node schema-smoke-test.js
```

## Çalıştırma

### 1. Server (UI + API)

```bash
node server.js
```

Tarayıcıda: http://localhost:3000

### 2. Collector (tek seferlik)

```bash
node collector-once.js
```

Kaynakları periyodik taramak için bu script’i cron/Task Scheduler ile çalıştır.

### 3. Draft üretimi (tek seferlik)

```bash
node make-drafts.js
```

### 4. Poster worker (sürekli)

```bash
node poster-worker.js
```

Aktif saatler (varsayılan 06:00–01:00 TR) ve minimum aralık (57 dk) içinde kuyruktan post atar.

## Yardımcı scriptler

| Script | Açıklama |
|--------|----------|
| `import-sources.js` | `sources.csv` ile kaynak ekler |
| `debug-db.js` | Tablo sayıları ve özet |
| `cleanup-invalid-media-drafts.js --apply` | Kullanılamaz medyalı draft’ları reject eder |
| `trigger-post-now.js --draftId=N` | Belirli draft’ı hemen post eder |
| `prepare-video-e2e.js` | Video E2E test hazırlığı |
| `verify-video-e2e.js --draftId=N` | Video E2E doğrulama |

## Testler

```bash
npm test              # Birim testleri (schedule, draft-format, source-tier)
npm run test:smoke    # DB şema smoke testi (transaction + rollback)
```

## npm scriptler

```bash
npm run video:e2e:prepare
npm run video:e2e:verify
npm run post-now:trigger   # --draftId=... gerekli
npm run post:delete       # X post silme
npm run drafts:cleanup-invalid-media
```

## Ortam değişkenleri

| Değişken | Açıklama |
|----------|----------|
| `DATABASE_URL` | PostgreSQL bağlantı dizesi |
| `X_USER_BEARER` | X API Bearer token |
| `X_CONSUMER_KEY`, `X_CONSUMER_SECRET` | OAuth1a (video upload için) |
| `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | OAuth1a |
| `OPENAI_API_KEY` | Draft çeviri/yorum (opsiyonel) |
| `WORKER_ACTIVE_START_HOUR` | Aktif başlangıç saati (0–23) |
| `WORKER_ACTIVE_END_HOUR` | Aktif bitiş saati |
| `WORKER_MIN_POST_INTERVAL_MINUTES` | Min post aralığı (dk) |
| `WORKER_DRY_RUN` | `true` ise worker post atmaz |
| `XAUTO_ADMIN_TOKEN` | Uzaktan POST için token (opsiyonel) |

## Güvenlik

- POST endpoint’leri varsayılan olarak sadece localhost’tan kabul edilir.
- Uzaktan erişim için `.env` içinde `XAUTO_ADMIN_TOKEN` tanımlayıp isteklerde `X-Admin-Token` header’ı gönderin.
- `.env` ve `storageState.json` `.gitignore` içindedir; commit etmeyin.
