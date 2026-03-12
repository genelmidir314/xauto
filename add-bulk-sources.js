/**
 * Toplu X hesaplarını sources.csv'e ekler.
 * Kategori ve tier otomatik atanır.
 *
 * Çalıştır: node add-bulk-sources.js
 */

const fs = require("fs");
const path = require("path");

const BULK_HANDLES = `
433
433Futbol
ESPNFC
goal
brfootball
footballontnt
CBSSportsGolazo
SkySportsPL
FOXSoccer
beINSPORTS_EN
DAZNFootball
SportsCenter
BleacherReport
HouseofHighlights
Overtime
FIFAWorldCup
ChampionsLeague
EuropaLeague
UEFAcom
LaLigaEN
SerieA_EN
Bundesliga_EN
Ligue1_ENG
MLS
MLSsoccer
NWSL
NFL
NBA
MLB
NHL
ufc
PFLMMA
ONEChampionship
WWE
MotoGP
F1
TrollFootball
FootyHumour
MenInBlazers
OneFootball
FootballJOE
GoalsXtra
Pubity
DailyLoud
DudespostingWs
NoContextHumans
memezar
fasc1nate
Morbidful
historyinmemes
internetarchive
Rainmaker1973
TheFigen_
NatureIsAmazing
AMAZlNGNATURE
EarthPix
ScienceNaturePage
WonderOfScience
PhysicsAstronomy
SpaceExplored
NASAEarth
NASA
ESA
SpaceX
CuriosityRover
NASAPersevere
NatGeo
NatGeoWild
BBCScienceNews
BBCWorld
BBCNews
CNN
CNBC
BusinessInsider
Reuters
AP
Bloomberg
TechCrunch
TheEconomist
guardian
nytimes
washingtonpost
WSJ
TIME
Forbes
FortuneMagazine
BarstoolSports
ComplexSports
TMZSports
WorldStar
DailyMail
ladbible
unilad
uniladtech
uniladadventure
uniladmag
thechive
FailArmy
BestFails
EpicFails
FailArmyHQ
NextLevelSkill
OddIyTerrifying
BeAmazed
interesting_aIl
DidYouKnow
KnowledgeFeed
ScienceAlert
IFLScience
RealTimeWWII
historydefined
historyphotographed
historycoolkids
HistoricPics
archaeologyart
artofvisuals
VisualsDaily
VisualContent
ShotOnIphone
NatGeoTravel
LonelyPlanet
Discovery
DiscoveryUK
ScienceChannel
AnimalPlanet
BBCearth
EarthFocus
EarthOfficial
WildlifePlanet
WildlifeWorld
NatGeoAnimals
AnimalKingdom
AnimalsBeingBros
AnimalsDoingThings
dog_rates
WeRateDogs
CatsOfTwitter
catsofinstagram
memes
memesdaily
memecentral
MemeHub
DankMemes
TheFunnyIntrovert
FunnyVines
ComedyCentral
TheOnion
Reductress
BoredPanda
BuzzFeed
BuzzFeedVideo
BuzzFeedAnimals
BuzzFeedNews
BuzzFeedTech
IGN
IGNDeals
GameSpot
GameInformer
Dexerto
Kotaku
Polygon
PCGamer
RockstarGames
PlayStation
Xbox
NintendoAmerica
Steam
EpicGames
Ubisoft
EA
RiotGames
VALORANT
LeagueOfLegends
FortniteGame
CallofDuty
PUBG
PUBGEsports
PUBGMobile
ApexLegends
Overwatch
RocketLeague
CSGO
HLTVorg
DotEsports
DexertoEsports
ESL
ESLCS
BLASTPremier
FACEIT
RedBullGaming
RedBull
RedBullRacing
MonsterEnergy
GoPro
GoProUK
GoProFrance
GoProGermany
GoProItalia
DroneDJ
DroneLife
DroneWorld
DJIGlobal
DJISupport
DJIEnterprise
DJIStudio
DJIPro
DroneVideos
DroneNature
DroneFootage
DroneView
ViralHog
Storyful
JukinMedia
NowThis
NowThisNews
NowThisEarth
NowThisFuture
NowThisPolitics
Upworthy
Goodable
Tanksgoodnews
TheDodo
TheDodoPets
TheDodoAnimals
TheDodoRescue
TheDodoLife
People
PeopleStyle
PeopleTV
EntertainmentTonight
TMZ
TMZLive
TMZTV
PopCrave
PopBase
DiscussingFilm
DiscussingFilmNews
CultureCrave
FilmUpdates
MovieUpdates
BoxOffice
CinemaBlend
Collider
ScreenRant
Variety
HollywoodReporter
IndieWire
Deadline
RottenTomatoes
IMAX
Netflix
NetflixGeeked
NetflixFilm
PrimeVideo
PrimeVideoUK
DisneyPlus
HBO
HBOmax
ParamountPlus
AppleTV
AppleTVPlus
SonyPictures
WarnerBros
UniversalPics
MarvelStudios
Marvel
DCOfficial
DCComics
StarWars
Lucasfilm
Pixar
Dreamworks
Illumination
Nickelodeon
CartoonNetwork
AdultSwim
Anime
Crunchyroll
Funimation
AnimeNewsNet
AnimeTV
ShonenJump
Naruto
DragonBall
AttackOnTitan
OnePieceAnime
DemonSlayer
JujutsuKaisen
TokyoGhoul
MyHeroAcademia
BleachAnime
Boruto
Pokemon
PokemonGoApp
PokemonTCG
PokemonNews
NintendoUK
NintendoEurope
NintendoFrance
NintendoItalia
NintendoGermany
NintendoSpain
PlayStationUK
PlayStationEU
PlayStationDE
PlayStationFR
PlayStationES
XboxUK
XboxP3
XboxGamePass
XboxSupport
SteamDB
SteamStatus
EpicGamesStore
RockstarSupport
UbisoftSupport
EAHelp
Activision
Blizzard_Ent
Bethesda
BethesdaSupport
BethesdaStudios
BethesdaGear
`.trim().split("\n").map((h) => h.trim()).filter(Boolean);

function getCategory(handle) {
  const h = handle.toLowerCase();
  if (/(sports|football|soccer|league|nfl|nba|mlb|nhl|ufc|f1|motogp|wwe|champions|uefa|fifa|mls|nwsl|golazo|dazn|bein|espn|goal|bleacher|overtime|barstool|complex|tmzsports)/.test(h)) return "Sports";
  if (/(news|bbc|cnn|reuters|bloomberg|economist|guardian|times|forbes|techcrunch|business|fortune|ap|wsj|washingtonpost)/.test(h)) return "News";
  if (/(nasa|esa|spacex|spaceexplored|physics|astronomy|sciencealert|iflscience|discovery|sciencechannel|curiosity|persevere|wonderofscience)/.test(h)) return "Science";
  if (/(nature|earthpix|earthfocus|earthofficial|wildlife|animalkingdom|natgeowild|bbcearth|natgeoanimals|earth|planet)/.test(h)) return "Nature";
  if (/(ign|gamespot|gameinformer|playstation|xbox|nintendo|steam|epicgames|riotgames|fortnite|pubg|apex|overwatch|rocketleague|esports|gaming|kotaku|polygon|pcgamer|dexerto|hltv|esl|blast|faceit|rockstar|bethesda|activision|blizzard|valorant|leagueoflegends|callofduty)/.test(h)) return "Gaming";
  if (/(thedodo|weratedogs|dog_rates|catsoftwitter|catsofinstagram|theodopets|theodoanimals|theodorescue|theodolife|animalsbeingbros|animalsdoingthings)/.test(h)) return "Pets";
  if (/(tmz|buzzfeed|comedy|onion|people|entertainment|film|movie|netflix|hbo|marvel|dc|starwars|variety|hollywood|cinema|boxoffice|popcrave|discussingfilm|pixar|disney|warner|universal|sony|nickelodeon|cartoon|anime|crunchyroll|funimation)/.test(h)) return "Entertainment";
  if (/(viral|memes|fail|humour|funny|pubity|dailyloud|history|rainmaker|beamazed|oddly|ladbible|unilad|thechive|boredpanda|fasc1nate|morbidful|storyful|jukinmedia|viralhog)/.test(h)) return "Viral";
  return "Viral";
}

function getTier(handle, category) {
  const h = handle.toLowerCase();
  if (category === "Sports" && /^(433|goal|bleacherreport|houseofhighlights|sportscenter|nfl|nba|espn)$/.test(h)) return 1;
  if (category === "Viral" && /^(pubity|historyinmemes|rainmaker|failarmy|beamazed|memes)$/.test(h)) return 1;
  if (category === "Science" && /^(nasa|spacex|natgeo)$/.test(h)) return 1;
  return 2;
}

function run() {
  const csvPath = path.join(__dirname, "sources.csv");
  const existing = fs.readFileSync(csvPath, "utf8");
  const existingHandles = new Set();
  const lines = existing.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const handle = lines[i].split(",")[0]?.trim();
    if (handle) existingHandles.add(handle.toLowerCase());
  }

  const header = "handle,tier,category,active\n";
  const existingRows = lines.slice(1).filter((r) => r.trim());
  const newRows = [];

  for (const handle of BULK_HANDLES) {
    if (!handle) continue;
    const h = handle.trim().replace(/^@/, "");
    if (!h) continue;
    if (existingHandles.has(h.toLowerCase())) continue;
    existingHandles.add(h.toLowerCase());
    const category = getCategory(h);
    const tier = getTier(h, category);
    newRows.push(`${h},${tier},${category},true`);
  }

  const allRows = [...existingRows, ...newRows];
  const out = header + allRows.join("\n") + (allRows.length ? "\n" : "");
  fs.writeFileSync(csvPath, out, "utf8");
  console.log(`sources.csv güncellendi. Yeni eklenen: ${newRows.length}, toplam: ${allRows.length}`);
}

run();
