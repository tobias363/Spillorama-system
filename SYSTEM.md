# Bingo System - Komplett Systemdokumentasjon

## Innholdsfortegnelse

1. [Systemarkitektur](#systemarkitektur)
2. [Mappestruktur](#mappestruktur)
3. [Backend](#backend)
4. [Frontend & Admin](#frontend--admin)
5. [Spillorama (Unity)](#spillorama-unity)
6. [SpilloramaTv (Unity)](#spilloramatv-unity)
7. [Candy Game (Unity)](#candy-game-unity)
8. [Candy-integrasjon (iframe)](#candy-integrasjon-iframe)
9. [Utvikling og bygging](#utvikling-og-bygging)
10. [Deploy](#deploy)
11. [Tredjeparts-tjenester](#tredjeparts-tjenester)
12. [Miljøvariabler](#miljøvariabler)

---

## Systemarkitektur

```
┌─────────────────────────────────────────────────────────────────┐
│                        Spillere (nettleser / app)               │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐│
│  │  Spillorama  │  │ SpilloramaTv │  │   Candy (iframe)       ││
│  │  WebGL       │  │ WebGL        │  │   WebGL                ││
│  │  (spillerkl.)│  │ (hall-TV)    │  │   (selvstendig spill)  ││
│  └──────┬───────┘  └──────┬───────┘  └──────────┬─────────────┘│
│         │ Socket.IO        │ Socket.IO + REST     │ Socket.IO    │
└─────────┼──────────────────┼─────────────────────┼──────────────┘
          │                  │                     │
┌─────────▼──────────────────▼─────────────────────▼──────────────┐
│                    Backend (Node.js / Express)                   │
│                    Port 4000 (Render)                            │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ REST API    │  │ Socket.IO    │  │ Integration API        │ │
│  │ /api/*      │  │ Sanntid      │  │ /api/integration/*     │ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ PostgreSQL  │  │ Wallet       │  │ Swedbank Pay           │ │
│  │ (brukere,   │  │ (file/pg/    │  │ (innskudd)             │ │
│  │  spill, etc)│  │  http/extern)│  │                        │ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Dataflyt

1. **Spillorama** (hovedspillet) kobler til backend via Socket.IO for sanntids bingospill
2. **SpilloramaTv** kobler til backend for å vise spillstatus på hall-TV
3. **Candy** kjører som selvstendig WebGL-app i iframe, kommuniserer via Socket.IO med egen launch-token-flyt
4. **Frontend** (portalen) viser spillkatalog, wallet, og launcher for alle spill
5. **Admin** gir operatører kontroll over haller, spill, compliance og romkontroll

---

## Mappestruktur

```
Bingo-system/
├── SYSTEM.md                          # <-- Denne filen
├── CANDY-INTEGRATION.md               # Detaljert Candy-dokumentasjon
├── env.conf                           # Legacy env (gammel backend, IKKE bruk)
│
├── Spillorama/                        # Unity-prosjekt: Spillorama + SpilloramaTv
│   ├── Assets/
│   │   ├── _Project/                  # Alt egenutviklet innhold
│   │   │   ├── _Scripts/             # 206 C# scripts
│   │   │   ├── _Scenes/             # 7 Unity scenes
│   │   │   ├── Prefabs/             # UI-prefabs
│   │   │   ├── Sprites/             # Grafiske assets
│   │   │   ├── Sounds/              # Lydeffekter
│   │   │   ├── Fonts/               # Skrifttyper
│   │   │   └── Animations/          # Animasjonsclips
│   │   ├── Vuplex/                   # WebView-plugin (lisensiert)
│   │   ├── Firebase/                 # Push-notifikasjoner
│   │   ├── Best HTTP/               # Socket.IO-bibliotek
│   │   ├── WebGLTemplates/
│   │   │   ├── Spill Game/          # WebGL-template for spillerklient
│   │   │   └── Spillorama Tv/       # WebGL-template for hall-TV
│   │   ├── Keystore/Wonga/          # Android signing keystore
│   │   ├── Firebase Data/           # google-services.json + plist
│   │   └── Editor/                  # Build-scripts (Unity Editor)
│   ├── ProjectSettings/
│   │   └── ProjectVersion.txt       # Unity 6000.0.58f2
│   └── Packages/
│       └── manifest.json
│
├── bingo_in_20_3_26_latest/          # Backend + Frontend + Candy
│   ├── backend/
│   │   ├── src/
│   │   │   ├── index.ts             # Hovedserver (Express + Socket.IO)
│   │   │   ├── game/                # BingoEngine, compliance, tickets
│   │   │   ├── platform/            # PlatformService, AdminAccessPolicy
│   │   │   ├── adapters/            # Wallet-adaptere (file/http/pg/extern)
│   │   │   ├── integration/         # Tredjeparts-integrasjon
│   │   │   ├── payments/            # SwedbankPayService
│   │   │   ├── launch/              # CandyLaunchTokenStore
│   │   │   ├── admin/               # Settings catalog
│   │   │   └── compliance/          # Compliance-tester
│   │   ├── public/
│   │   │   └── web/                 # Kompilert Candy Web SPA
│   │   │       ├── index.html
│   │   │       └── assets/          # React-build (hashed filer)
│   │   ├── data/
│   │   │   └── wallets.json         # File-basert wallet (dev)
│   │   ├── .env                     # Miljøvariabler (ikke i git)
│   │   ├── .env.example             # Mal for .env
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── frontend/
│   │   ├── index.html               # Hovedportal (spillerklient)
│   │   ├── app.js                   # Portal-logikk (vanilla JS)
│   │   ├── style.css                # Stilark
│   │   ├── admin/
│   │   │   ├── index.html           # Admin-panel
│   │   │   └── app.js               # Admin-logikk
│   │   ├── web/                     # Fallback Candy Web-assets
│   │   └── assets/                  # Bilder, ikoner
│   │
│   ├── Candy/                        # Unity-prosjekt: Candy Mania
│   │   ├── Assets/
│   │   │   ├── Script/              # 33 C# game scripts
│   │   │   ├── Scenes/              # Theme1, Theme2, Bonus
│   │   │   ├── Editor/              # WebGLBuild.cs
│   │   │   └── Plugins/             # DOTween
│   │   ├── ProjectSettings/
│   │   │   └── ProjectVersion.txt   # Unity 6000.3.10f1
│   │   └── Packages/
│   │
│   ├── candy-web/                    # TypeScript wrapper (kompilert)
│   │
│   ├── scripts/
│   │   ├── unity-webgl-build.sh     # Bygger Candy WebGL
│   │   ├── release-candy.sh         # Bygger + publiserer Candy
│   │   ├── deploy-backend.sh        # Trigger Render deploy
│   │   ├── release-all.sh           # Full release-pipeline
│   │   ├── release.env.example      # Mal for release-config
│   │   └── release.env              # Lokal release-config
│   │
│   ├── .github/workflows/
│   │   ├── ci.yml                   # Type-check + test
│   │   ├── deploy-staging.yml       # Auto-deploy staging
│   │   ├── deploy-production.yml    # Produksjon-deploy
│   │   └── compliance-gate.yml      # Compliance-tester
│   │
│   └── docs/                        # Ytterligere dokumentasjon
```

---

## Backend

### Teknologistack

| Komponent | Teknologi |
|-----------|-----------|
| Runtime | Node.js (TypeScript) |
| Framework | Express.js 4.21 |
| Sanntid | Socket.IO 4.8 |
| Database | PostgreSQL |
| Bygging | tsc (TypeScript compiler) |
| Utvikling | tsx watch (hot reload) |

### Starte backend

```bash
cd bingo_in_20_3_26_latest

# Utvikling (hot reload)
npm run dev

# Produksjon
npm run build && npm run start
```

Backend starter på `http://localhost:4000`.

### Database

Backend oppretter tabeller automatisk ved oppstart:
- `app_users` - Brukere og autentisering
- `app_sessions` - Sesjoner
- `app_games` - Spillkatalog
- `app_game_settings_change_log` - Endringslogg
- `app_halls` - Bingohaller
- `app_terminals` - Terminaler
- `app_hall_game_config` - Hall-spesifikke spillregler

### Wallet-system

Wallet-provider velges via `WALLET_PROVIDER`:
- **`file`** (standard) - JSON-fil, enklest for utvikling
- **`postgres`** - PostgreSQL-tabell, for produksjon
- **`http`** - Ekstern wallet-API
- **`external`** - Full ekstern integrasjon (for tredjeparts bingosystemer)

### REST API-oversikt

| Kategori | Prefix | Eksempel-endepunkter |
|----------|--------|---------------------|
| Autentisering | `/api/auth/` | register, login, logout, me |
| KYC | `/api/kyc/` | verify, me |
| Spillkatalog | `/api/games/` | list, candy launch-token |
| Haller | `/api/halls/` | list |
| Wallet | `/api/wallet/me/` | balance, compliance, loss-limits |
| Betaling | `/api/payments/swedbank/` | topup-intent, confirm |
| Bingo-rom | `/api/rooms/` | list, state, end, extra-draw |
| Admin | `/api/admin/` | halls, games, settings, rooms, compliance |
| Integrasjon | `/api/integration/` | launch, session/kill, session/refresh |

### Socket.IO-hendelser

**Romhåndtering:**
- `room:create` - Opprett nytt spillrom
- `room:join` - Bli med i rom
- `room:resume` - Gjenoppkoble
- `room:state` - Hent romstatus

**Spillkontroll:**
- `game:start` - Start runde (med innskudd)
- `game:end` - Avslutt runde
- `draw:next` - Trekk neste tall
- `draw:extra:purchase` - Kjøp ekstra trekk

**Spillerhandlinger:**
- `ticket:mark` - Merk tall på billett
- `claim:submit` - Krev gevinst (line/bingo)

**Server → Klient:**
- `room:update` - Broadcast romoppdatering til alle spillere
- `draw:new` - Nytt trukket tall

### Compliance (norsk regelverk)

Backend håndhever:
- `BINGO_DAILY_LOSS_LIMIT` - Daglig tapsgrense (standard: 900 NOK)
- `BINGO_MONTHLY_LOSS_LIMIT` - Månedlig tapsgrense (standard: 4400 NOK)
- `BINGO_PLAY_SESSION_LIMIT_MS` - Maks spilløkt (standard: 1 time)
- `BINGO_PAUSE_DURATION_MS` - Obligatorisk pause (standard: 5 min)
- `BINGO_MIN_ROUND_INTERVAL_MS` - Minimum mellom runder (standard: 30s)
- Selvutelukking (minimum 365 dager)

---

## Frontend & Admin

### Frontend (Spillerportal)

**Teknologi:** Vanilla JavaScript + Socket.IO + CSS  
**Servert fra:** `frontend/index.html` på `/`

**Funksjonalitet:**
- Innlogging/registrering
- Spillkatalog med tre spill: Candy, Roma, Bingo
- Wallet-håndtering med Swedbank Pay
- KYC-verifisering
- Compliance-kontroller (tapsgrenser, pauser, selvutelukking)
- Profilhåndtering

**Spillstart:**
- **Candy/Roma** ("Instant Launch"): Henter launch-token → åpner Candy Web i ny side/iframe
- **Bingo**: Direkte Socket.IO-tilkobling for live-spill i portalen

### Admin-panel

**Teknologi:** Vanilla JavaScript med RBAC  
**Servert fra:** `frontend/admin/index.html` på `/admin/`

**Seksjoner:**
- Spillinnstillinger (per spill)
- Candy Mania (scheduler, auto-draw, RTP)
- Spillkatalog
- Haller og terminaler
- Hall-spillregler
- Wallet compliance
- Prize policy
- Romkontroll (start/stopp/trekk manuelt)
- Rapporter og endringslogg

**Roller:** ADMIN, HALL_OPERATOR, SUPPORT, PLAYER

---

## Spillorama (Unity)

### Prosjektinfo

| | |
|-|-|
| **Prosjektsti** | `Spillorama/` |
| **Unity-versjon** | 6000.0.58f2 (Unity 6) |
| **Plattformer** | WebGL, iOS, Android, Windows |
| **Språk** | Norsk + Engelsk (I2 Localization) |

### 5 bingospill

| Spill | Beskrivelse | Nøkkelscript |
|-------|-------------|--------------|
| **Game 1** | 5x5 mønstermatching, Elvis-billetter, flere rader | Game1GamePlayPanel.cs (2574 linjer) |
| **Game 2** | 3x3 grid, rakettoppskyting, lucky number, auto-play | Game2GamePlayPanel.cs (1173 linjer) |
| **Game 3** | Balltrekning med fysikkanimasjon | Game3GamePlayPanel.cs (1407 linjer) |
| **Game 4** | Temavarianter med asset bundles | Game4GamePlayPanel.cs (1622 linjer) |
| **Game 5** | Minispill: rulett, trommel, gratisspinn | Game5GamePlayPanel.cs (1081 linjer) |

### Minispill

- **Lykkehjulet** (FortuneWheelManager.cs) - Spinn med vinkelhastighet
- **Mysterispill** (MysteryGamePanel.cs) - Skjult utvalg
- **Skattekiste** (PrefabTreasureChest.cs) - Premieavsløring
- **Rulett** (Game5RouletteWheelController.cs)
- **Trommelrotasjon** (DrumRotation.cs)

### Scenes

| Scene | Formål | I build? |
|-------|--------|----------|
| `Admin Bingo Hall Display` | Hall-TV skjerm (admin) | **Ja (aktiv)** |
| `Game` | Hovedspill | Nei |
| `Loading` | Lasteskjerm | Nei |
| `WheelOfFortune` | Lykkehjulet | Nei |
| `Custom Socket URL` | Dynamisk URL | Nei |
| `SamplePhysics` | Testing | Nei |
| `Test` | Testing | Nei |

> **Merk:** Build-settings har kun `Admin Bingo Hall Display` aktivert. For spillerklienten må `Game`-scenen aktiveres i Build Settings.

### Servertilkobling

Spillorama bruker `Constants.SERVER`-enum for å velge server:

```
Live:         https://bingoadmin.aistechnolabs.pro
Staging:      https://bingoadmin.aistechnolabs.pro
Info:         https://spillorama.aistechnolabs.info
Development:  https://bingoadmin.aistechnolabs.in
DynamicWebgl: Leser URL fra PlayerPrefs
Custom:       Leser URL fra PlayerPrefs
Local:        http://192.168.1.42:3002
```

**For ny backend:** Bruk `DynamicWebgl`-modus eller oppdater URLs i `Constants.cs` til Render-URL.

Server velges i Unity Inspector på `GameSocketManager`-objektet.

### Nøkkelscripts

| Script | Linjer | Formål |
|--------|--------|--------|
| EventManager.cs | 1995 | All Socket.IO-kommunikasjon, REST-kall |
| GameSocketManager.cs | ~900 | Socket.IO tilkobling, servervalg, reconnect |
| BingoHallDisplay.cs | 1883 | Admin TV-skjerm med spillresultater |
| BingoTicket.cs | 1356 | Billettlogikk, markering, farging |
| Game1GamePlayPanel.cs | 2574 | Game 1 komplett spillflyt |
| UIManager.cs | 639 | Sentral UI-kontroller |
| webViewManager.cs | 597 | Vuplex WebView for betalinger/profil |
| Utility.cs | 1090 | Hjelpefunksjoner, språk, versjon |
| Constants.cs | ~300 | Server-URLer, hendelsesnavn, enums |

### Tredjepartsbiblioteker

| Bibliotek | Formål |
|-----------|--------|
| **BestHTTP** | Socket.IO-implementasjon |
| **Vuplex WebView** | In-game nettleser (betalinger, profil) |
| **I2 Localization** | Flerspråkstøtte |
| **Firebase** | Push-notifikasjoner |
| **LeanTween** | Animasjons-tweening |
| **Newtonsoft.Json** | JSON-parsing |
| **TextMesh Pro** | Tekst-rendering |

---

## SpilloramaTv (Unity)

SpilloramaTv er **samme Unity-prosjekt** som Spillorama, men bygget med en annen scene og WebGL-template.

### Forskjeller fra Spillorama

| | Spillorama | SpilloramaTv |
|-|-----------|--------------|
| **Scene** | Game.unity | Admin Bingo Hall Display.unity |
| **WebGL template** | Spill Game/ | Spillorama Tv/ |
| **Formål** | Spillerklient | Hall-TV display |
| **Bruker** | Spillere | Bingohall-operatører |
| **Interaksjon** | Full | Kun visning |

### Hvordan bygge SpilloramaTv

1. Åpne Spillorama-prosjektet i Unity
2. Gå til Build Settings
3. Sett `Admin Bingo Hall Display` som eneste aktive scene
4. Velg WebGL-template: `Spillorama Tv`
5. Bygg til `public/view-game/`

### SpilloramaTv-template

Templaten inkluderer JavaScript-funksjoner som Unity kaller:
- `requestGameData()` - Henter spilldata via token fra URL
- `requestDomainData()` - Sender server-URL til Unity
- `openSpilloramaTab()` - Åpner Spillorama i ny fane
- `CloseSpilloramaTvScreenTab()` - Lukker TV-fanen

---

## Candy Game (Unity)

### Prosjektinfo

| | |
|-|-|
| **Prosjektsti** | `bingo_in_20_3_26_latest/Candy/` |
| **Unity-versjon** | 6000.3.10f1 (Unity 6) |
| **Plattform** | WebGL |
| **Backend** | bingosystem-3.onrender.com |

### Scenes

| Scene | Formål | I build? |
|-------|--------|----------|
| `Theme1` | Hovedspill | **Ja** |
| `Theme2` | Alternativt tema | Nei |
| `Bonus` | Bonusrunde | Nei |

### Spillmekanikk

Candy er et bingo-basert spill med 4 kort (5x3 grid, 15 tall per kort):

1. **Kortgenerering** - NumberGenerator lager 4 kort med tilfeldige tall
2. **Balltrekning** - BallManager animerer baller (75 mulige)
3. **Mønstermatching** - PaylineManager sjekker gevinstmønstre
4. **Ekstra baller** - Bonusspinn (SlotController) for ekstra trekk
5. **Bonusrunde** - Egen scene med slotmaskin-mekanikk
6. **Auto-spin** - Automatisk spill (begrenset i produksjon)

### Sanntid vs. lokal modus

Candy støtter to moduser:
- **Realtime** (`useRealtimeBackend = true`): Socket.IO mot backend, multiplayer
- **Lokal**: Enkelspiller uten server (for testing)

### Nøkkelscripts

| Script | Linjer | Formål |
|--------|--------|--------|
| APIManager.cs | 1035 | Orkestrator for realtime/lokal |
| APIManager.RealtimeState.cs | 1520 | Romstatus-parsing |
| APIManager.RealtimePlayFlow.cs | 401 | Spillrunde-flyt |
| BingoRealtimeClient.cs | 787 | Socket.IO-klient (ren C#) |
| NumberGenerator.cs | 1205 | Kortgenerering, mønstermatching |
| GameManager.cs | 324 | Spillstate, wallet-visning |
| BallManager.cs | 655 | Ballanimasjon |
| UIManager.cs | 353 | Knapper, auto-spin |
| TopperManager.cs | 533 | Mønstervisning |
| BonusControl.cs | 423 | Bonusrunde |
| BingoAutoLogin.cs | 581 | Automatisk innlogging |

### Socket.IO-protokoll (Candy)

Candy implementerer sin egen Socket.IO-klient med `ClientWebSocket`:

```
Tilkobling: ws://backend/socket.io/?EIO=4&transport=websocket
Pakketyper: 0=open, 2=ping, 3=pong, 40=connect, 42=event, 43=ack
```

**Hendelser:**
- `room:create` / `room:join` - Romhåndtering
- `game:start` - Start runde med innskudd
- `draw:next` - Trekk neste tall
- `ticket:mark` - Merk tall
- `claim:submit` - Krev gevinst ("BINGO", "TWO_LINE", "ONE_LINE")
- `room:state` - Hent status
- `room:configure` - Konfigurer rom

### Spilltilstander

```
NONE → WAITING → RUNNING → ENDED → CLEANUP → (loop)
```

### WebGL Build

Candy har et dedikert build-script i `Assets/Editor/WebGLBuild.cs`:

```bash
# Bygg fra kommandolinje
cd bingo_in_20_3_26_latest
bash scripts/unity-webgl-build.sh

# Eller fra Unity: Tools → Candy → Build → WebGL
```

---

## Candy-integrasjon (iframe)

> Se også [CANDY-INTEGRATION.md](CANDY-INTEGRATION.md) for full teknisk dokumentasjon.

### Oversikt

Candy kjører som et **selvstendig produkt** som embeddes via iframe. Dette designet gjør det mulig å:
- Leie ut Candy til andre bingosystemer
- Oppdatere Candy uavhengig av hovedsystemet
- Isolere wallet-transaksjoner via adapter-mønster

### Launch-flyt (eget system)

```
1. Spiller klikker "Spill nå" i portalen
2. Frontend kaller POST /api/games/candy/launch-token
3. Backend validerer spiller, lager launch-token (120s TTL)
4. Frontend redirecter til Candy Web med ?launchToken=xxx
5. Candy Web kaller POST /api/games/candy/launch-resolve
6. Candy Web initialiserer med credentials → Socket.IO tilkobling
```

### Launch-flyt (tredjepartssystem)

```
1. Tredjepart kaller POST /api/integration/launch med API-nøkkel
2. Backend mapper ekstern spiller → intern spiller/wallet
3. Backend returnerer embed-URL med launch-token
4. Tredjepart viser iframe med Candy
5. Candy spiller med wallet debit/credit mot tredjeparts API
6. Backend sender spillresultater via webhook til tredjepart
```

### Wallet-integrasjon

For tredjeparts-integrasjon implementerer provideren tre endepunkter:

| Endepunkt | Formål |
|-----------|--------|
| `GET /balance?playerId=X` | Hent saldo |
| `POST /debit` | Trekk penger (innskudd) |
| `POST /credit` | Legg til penger (gevinst) |

Backend har innebygd:
- Circuit breaker (5 feil → 30s pause)
- Balance caching (5s TTL)
- Credit retry med eksponentiell backoff (maks 5 forsøk)
- Lokal transaksjonslogg for avstemming

---

## Utvikling og bygging

### Forutsetninger

| Verktøy | Versjon | Formål |
|---------|---------|--------|
| **Node.js** | v20+ | Backend |
| **PostgreSQL** | 15+ | Database |
| **Unity Hub** | Nyeste | Unity-prosjekthåndtering |
| **Unity 6000.3.10f1** | | Candy-prosjektet |
| **Unity 6000.0.58f2** | | Spillorama-prosjektet |

### Lokal utvikling - Backend

```bash
# 1. Start PostgreSQL
brew services start postgresql@18

# 2. Opprett database (kun første gang)
createdb bingo_dev

# 3. Konfigurer miljø
cd bingo_in_20_3_26_latest/backend
cp .env.example .env
# Rediger .env: sett APP_PG_CONNECTION_STRING=postgres://bruker@localhost:5432/bingo_dev

# 4. Installer og start
npm install
npm run dev    # http://localhost:4000
```

### Lokal utvikling - Candy

```bash
# 1. Åpne Unity Hub
# 2. Add project → velg bingo_in_20_3_26_latest/Candy/
# 3. Åpne med Unity 6000.3.10f1
# 4. Åpne scene: Assets/Scenes/Theme1.unity
# 5. Gjør endringer
# 6. Bygg WebGL:

cd bingo_in_20_3_26_latest
bash scripts/unity-webgl-build.sh

# Eller i Unity: Tools → Candy → Build → WebGL
```

### Lokal utvikling - Spillorama

```bash
# 1. Installer Unity 6000.0.58f2 via Unity Hub
#    - Huk av for WebGL Build Support
#    - Huk av for iOS Build Support (hvis relevant)
#    - Huk av for Android Build Support (hvis relevant)

# 2. Åpne Unity Hub
# 3. Add project → velg Spillorama/
# 4. Åpne med Unity 6000.0.58f2

# 5. Velg scene avhengig av hva du bygger:
#    - Spillerklient: Assets/_Project/_Scenes/Game.unity
#    - Hall-TV: Assets/_Project/_Scenes/Admin Bingo Hall Display.unity

# 6. Konfigurer server:
#    - Velg "Socket And Event Manager" i Hierarchy
#    - Sett server-enum til ønsket miljø (DynamicWebgl for ny backend)

# 7. Bygg:
#    - File → Build Settings
#    - Velg WebGL
#    - Velg riktig WebGL template (Spill Game / Spillorama Tv)
#    - Build
```

### Oppdatere server-URL for Spillorama

For at Spillorama skal koble til ny backend (Render), oppdater `Constants.cs`:

```csharp
// Assets/_Project/_Scripts/Templates/Constants.cs
public static string ProductionBaseUrl = "https://din-backend.onrender.com";
```

Eller bruk `DynamicWebgl`-modus som leser URL fra WebGL-runtime.

### Bygg Spillorama WebGL (spillerklient)

1. I Unity Build Settings: aktiver **Game.unity**, deaktiver andre scenes
2. WebGL Template: **Spill Game**
3. Bygg til `bingo_in_20_3_26_latest/public/web/`
4. Kopier Build/-mappen til backend

### Bygg SpilloramaTv WebGL

1. I Unity Build Settings: aktiver **Admin Bingo Hall Display.unity**, deaktiver andre
2. WebGL Template: **Spillorama Tv**
3. Bygg til `bingo_in_20_3_26_latest/public/view-game/`

---

## Deploy

### Render (Backend + Frontend)

Backend kjører på Render. Deploy trigges via:

```bash
# Manuell deploy-trigger
cd bingo_in_20_3_26_latest
bash scripts/deploy-backend.sh
```

Konfigurer i `scripts/release.env`:
```bash
RENDER_DEPLOY_HOOK_URL=https://api.render.com/deploy/srv-...
RENDER_HEALTHCHECK_URL=https://din-backend.onrender.com/admin/
```

### Candy Release

```bash
cd bingo_in_20_3_26_latest

# 1. Bygg WebGL
bash scripts/unity-webgl-build.sh

# 2. Publiser (lokal, rsync, eller S3)
bash scripts/release-candy.sh
```

Publiseringsmodus i `release.env`:
- `CANDY_PUBLISH_MODE=local` - Kopierer til lokal mappe
- `CANDY_PUBLISH_MODE=rsync` - Rsync til server
- `CANDY_PUBLISH_MODE=s3` - Last opp til S3 + CloudFront

### CI/CD (GitHub Actions)

| Workflow | Trigger | Handling |
|----------|---------|----------|
| `ci.yml` | PR / push til main | Type-check, tester, bygg |
| `deploy-staging.yml` | Push til main | Auto-deploy til staging |
| `deploy-production.yml` | Manuell / auto | Produksjon-deploy med healthcheck |
| `compliance-gate.yml` | PR | Compliance-tester |

---

## Tredjeparts-tjenester

| Tjeneste | Formål | Konfig |
|----------|--------|--------|
| **Swedbank Pay** | Betalingsinnløsning (innskudd) | `SWEDBANK_PAY_*` env vars |
| **Firebase** (spillorama-81245) | Push-notifikasjoner | google-services.json / plist |
| **Vuplex** | In-game WebView (Spillorama) | Lisensiert Unity-plugin |
| **Render** | Backend hosting | Deploy hook |
| **PostgreSQL** | Database | Connection string |

### Firebase-konfig

Firebase brukes for push-notifikasjoner i Spillorama WebGL:

```javascript
// I Spill Game/index.html template
const firebaseConfig = {
  apiKey: "AIzaSyCDX8TKN3YQhX9EmN5A2PGZ99Z-DZTBKM8",
  authDomain: "spillorama-81245.firebaseapp.com",
  projectId: "spillorama-81245",
  storageBucket: "spillorama-81245.firebasestorage.app",
  messagingSenderId: "839491165887",
  appId: "1:839491165887:web:8e199d92d3acafbaccb00a"
};
```

---

## Miljøvariabler

### Backend (.env)

```bash
# === Kjerne ===
NODE_ENV=development|production
PORT=4000
CORS_ALLOWED_ORIGINS=http://localhost:4000

# === Database ===
APP_PG_CONNECTION_STRING=postgres://user@localhost:5432/bingo_dev
APP_PG_SCHEMA=public
AUTH_SESSION_TTL_HOURS=168

# === Wallet ===
WALLET_PROVIDER=file|postgres|http|external
WALLET_CURRENCY=NOK
WALLET_DEFAULT_INITIAL_BALANCE=1000

# === Compliance ===
BINGO_MIN_ROUND_INTERVAL_MS=30000
BINGO_DAILY_LOSS_LIMIT=900
BINGO_MONTHLY_LOSS_LIMIT=4400
BINGO_PLAY_SESSION_LIMIT_MS=3600000
BINGO_PAUSE_DURATION_MS=300000

# === Auto-play ===
AUTO_ROUND_START_ENABLED=true
AUTO_ROUND_START_INTERVAL_MS=180000
AUTO_DRAW_ENABLED=true
AUTO_DRAW_INTERVAL_MS=1200
CANDY_PAYOUT_PERCENT=100

# === Swedbank Pay ===
SWEDBANK_PAY_API_BASE_URL=https://api.externalintegration.payex.com
SWEDBANK_PAY_ACCESS_TOKEN=
SWEDBANK_PAY_PAYEE_ID=
SWEDBANK_PAY_MERCHANT_BASE_URL=http://localhost:4000

# === Integrasjon (for tredjepartssystemer) ===
INTEGRATION_ENABLED=false
INTEGRATION_API_KEY=
INTEGRATION_WEBHOOK_URL=
INTEGRATION_WEBHOOK_SECRET=
ALLOWED_EMBED_ORIGINS=
```

### Release (scripts/release.env)

```bash
CANDY_RELEASE_CHANNEL=staging|production
CANDY_PUBLISH_MODE=none|local|rsync|s3
CANDY_PROMOTE_LIVE=false
RENDER_DEPLOY_HOOK_URL=
RENDER_HEALTHCHECK_URL=
```
