/**
 * Takip kuyruğuna toplu handle ekler.
 * Çalıştır: node add-bulk-follow-queue.js
 */

require("dotenv").config();
const { Pool } = require("pg");

const BULK_HANDLES = `
pubity
daily_loud
unusualvideos
crazyclips
internet_hall
fasc1nate
historyinmemes
interesting_ai
nowthisnews
noncontextclips
culturecrave
dexerto
dramalert
complex
worldstar
rap
barstoolsports
bleacherreport
espn
sportscenter
brfootball
433
overtime
houseofhighlights
nbaontnt
nbacentral
mlb
ufc
onechampionship
motorsport
topgear
autocar
jalopnik
tesla
spacex
elonmusk
nasa
natgeo
natgeowild
discovery
sciencechannel
ifls
sciencenature
popularmechanics
wired
techcrunch
theverge
engadget
gizmodo
mashable
cnet
ign
gamespot
kotaku
pcgamer
rockpapershot
nintendolife
playstation
xbox
steam
epicgames
riotgames
valorant
leagueoflegends
fortnitegame
callofduty
battlefield
pubg
apexlegends
minecraft
roblox
gta
rockstargames
netflix
primevideo
hulu
hbomax
disneyplus
paramountplus
peacock
spotify
applemusic
youtube
tiktok
instagram
snapchat
reddit
9gag
imgur
memecentral
memezar
memelord
memedaily
dailymemes
memeculture
memeworld
memefeed
memes
funnyvideos
funnyclips
funnyfails
failarmy
peopleareawesome
bestfails
viralhog
storyful
ladbible
unilad
sportbible
foodbible
gamingbible
vt
vtco
boredpanda
insider
businessinsider
forbes
bloomberg
reuters
bbcnews
cnn
nytimes
washingtonpost
guardian
time
newsweek
axios
vice
buzzfeed
huffpost
theatlantic
slate
vox
politico
thehill
abcnews
cbsnews
nbcnews
skynews
aljazeera
dwnews
france24
euronews
apnews
usatoday
latimes
nypost
dailymail
metro
independent
mirror
sun
telegraph
economist
financialtimes
wallstreetjournal
marketwatch
investingcom
coindesk
cointelegraph
decryptmedia
bitcoinmagazine
binance
coinbase
krakenfx
okx
bybit
bitfinex
kucoincom
cryptocom
solana
ethereum
bitcoin
dogecoin
cardano
polkadot
chainlink
uniswap
aaveaave
opensea
rarible
superrare
foundationapp
midjourney
openai
stabilityai
runwayml
huggingface
deeplearningai
andrewng
lexfridman
naval
sama
paulg
balajis
a16z
ycombinator
producthunt
indiehackers
levelsio
startup
startups
techstars
500global
`.trim().split("\n").map((h) => h.trim().replace(/^@/, "")).filter(Boolean);

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL yok");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  let count = 0;

  for (const handle of BULK_HANDLES) {
    const h = String(handle || "").trim().replace(/^@/, "");
    if (!h) continue;

    await pool.query(
      `INSERT INTO follow_queue (handle, status)
       VALUES ($1, 'pending')
       ON CONFLICT (handle) DO UPDATE SET
         status = 'pending',
         last_error = NULL,
         next_follow_at = NULL`,
      [h]
    );
    count += 1;
  }

  console.log(`✅ Takip kuyruğu güncellendi. Toplam: ${count} handle eklendi/güncellendi.`);
  await pool.end();
}

run().catch((e) => {
  console.error("❌ Hata:", e?.message || e);
  process.exit(1);
});
