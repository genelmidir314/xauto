# XAuto – Sunucuya Deploy Rehberi

## Mimari

```mermaid
flowchart TB
    subgraph server [Sunucu]
        subgraph processes [Sürekli Çalışan]
            serverJs[server.js]
            posterWorker[poster-worker.js]
        end
        subgraph cron [Cron]
            collector[collector-once.js]
            makeDrafts[make-drafts.js]
        end
    end

    serverJs -->|spawn| posterWorker
    DB[(PostgreSQL)]
    serverJs --> DB
    posterWorker --> DB
    collector --> DB
    makeDrafts --> DB
```

`server.js` poster-worker'ı spawn eder; tek process yeterli.

## Gereksinimler

- **Node.js 18+**
- **PostgreSQL** (Neon, Supabase, Railway vb.)
- **pm2** (process yönetimi)
- **Sunucu** (VPS, DigitalOcean, Hetzner, AWS EC2 vb.)

## Kurulum Adımları

### 1. Projeyi Sunucuya Al

```bash
git clone <repo-url> xauto
cd xauto
```

### 2. Bağımlılıkları Yükle

```bash
npm install
```

### 3. Ortam Değişkenleri

```bash
cp .env.example .env
# .env dosyasını düzenleyip gerçek değerleri girin
```

Zorunlu: `DATABASE_URL`, `X_USER_BEARER`  
**AI yorumlar için:** `OPENAI_API_KEY` (yoksa fallback yorumlar kullanılır)  
Video için: `X_CONSUMER_KEY`, `X_CONSUMER_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`  
Gerçek post için: `WORKER_DRY_RUN=false`

### 4. Veritabanı

```bash
node db-init.js
```

Mevcut DB'ye yeni kolonlar eklemek için:

```bash
node db-migrate.js
```

### 5. pm2 ile Başlat

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # Sunucu yeniden başladığında otomatik başlatma
```

### 6. Cron (Opsiyonel)

Collector ve make-drafts'ı periyodik çalıştırmak için:

```cron
# Her 30 dakikada collector, ardından make-drafts
*/30 * * * * cd /path/to/xauto && node collector-once.js && node make-drafts.js
```

`/path/to/xauto` yerine proje dizininizi yazın.

Alternatif: UI'daki "Tweet Çek" ve "Draft Üret" butonlarını kullanabilirsiniz.

### 7. Reverse Proxy (HTTPS)

Nginx örneği:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
}
```

Caddy ile:

```
reverse_proxy localhost:3000
```

## Render Özel Ayarlar

### TZ (Türkiye saati)

Environment Variables'a ekle: `TZ=Europe/Istanbul`

### Uyku modunu önleme (Free tier)

Render free planda 15 dk istek gelmezse servis uyur. UptimeRobot ile 5 dk'da bir ping at:

- https://uptimerobot.com → Add Monitor
- URL: `https://xauto.onrender.com/health`
- Interval: 5 dakika

### OPENAI_API_KEY (AI yorumlar)

**Yorumlar AI ile üretilmiyorsa** (fallback kullanılıyorsa):

1. Render → xauto → Environment → `OPENAI_API_KEY` ekleyin (OpenAI API key)
2. Deploy sonrası `https://xauto.onrender.com/debug-counts` → `auth.openaiKey: true` olmalı
3. make-drafts loglarında `✅ OPENAI_API_KEY SET` görünmeli; `⚠️ OPENAI_API_KEY YOK` görürseniz key eksik

### Debug endpoint'leri

- `/health` – `ok`, `posterWorkerRunning`, `posterWorkerRestartCount`
- `/debug-counts` – İstatistikler + auth durumu + queue durumu (serverNow, waitingJobs, isDue)

## Sorun Giderme: Post Atılmıyor ("beklemede" Kalıyor)

### 1. Poster worker çalışıyor mu?

```bash
curl https://xauto.onrender.com/health
```

`posterWorkerRunning: true` olmalı. `false` ise worker çökmüş veya başlamamış.

**Çözüm:** Render → xauto → Manual Deploy (veya servisi yeniden başlat). Worker artık crash sonrası otomatik yeniden başlar (max 10 deneme).

### 2. Uyku modu (Render Free tier)

15 dk istek gelmezse servis uyur; bu sürede post atılmaz.

**Çözüm:** UptimeRobot ile 5 dk'da bir `https://xauto.onrender.com/health` ping atın.

### 3. Aktif saat penceresi

Worker sadece 06:00–01:00 (TR) arasında post atar. Bu saatler dışındaysa bekler.

### 4. Cooldown

Son post'tan sonra en az 57 dk beklenir (schedule_settings ile değiştirilebilir).

### 5. Job due mu?

`/debug-counts` → `queueDebug.waitingJobs` → her job için `isDue: true` olmalı (süre geçtiyse).

### 6. Manuel post

"Şimdi Paylaş" butonu çalışıyorsa X auth doğru; sorun worker tarafında.

### 7. Render Logs

Render → xauto → Logs:
- `Poster worker başlatıldı` – worker başladı
- `Poster worker çıktı: code=...` – worker çöktü
- `Poster worker yeniden başlatılıyor` – otomatik yeniden başlatma
- `⏸️ Aktif saat dışında` – pencere dışı
- `⏸️ Cooldown` – aralık beklemesi
- `⏳ Due job yok` – scheduled_at henüz gelmemiş

## Kontrol Listesi

- [ ] `WORKER_DRY_RUN=false` (.env)
- [ ] `DATABASE_URL` geçerli
- [ ] X API credentials tanımlı
- [ ] Health check: `curl http://localhost:3000/health`
- [ ] pm2 log: `pm2 logs xauto`

## Yararlı Komutlar

```bash
pm2 status
pm2 logs xauto
pm2 restart xauto
pm2 stop xauto
```
