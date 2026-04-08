# Bingosystem Spillorama

Komplett spillplattform med lobby, 5 Unity WebGL-bingospill, wallet, auth, compliance og admin.

Utviklet av ekstern leverandor (AIS Technolabs). Vi har overtatt kildekoden og gjor videre utvikling. CandyMania er integrert i dette systemet via iframe med kobling til lommebok.

> **Viktig:** Dette er **hovedsystemet**. Lobbyen, spillkatalogen, brukerhandtering, wallet og alle Unity-spillene lever her. CandyMania er det eneste spillet med separat backend — det er integrert via iframe med delt lommebok.

---

## To prosjekter — tydelig skille

### 1. Bingosystem Spillorama (DETTE prosjektet)

- **Mappe:** `/Users/tobiashaugen/Projects/Bingo-system/`
- **Repo:** `tobias363/bingosystem`
- **Deploy:** `bingo-system-jsso.onrender.com`
- **Hva det er:** Hele plattformen — lobby, auth, wallet, compliance, admin, spillkatalog, og alle 5 Unity WebGL-bingospill. CandyMania er integrert her via iframe med kobling til lommebok.

Lobbyen (`/web/`) viser alle tilgjengelige spill:

| Spill | Type | Status | Beskrivelse |
|-------|------|--------|-------------|
| Papir bingo | Unity WebGL | Stengt | Klassisk papirbingo-tema |
| Lynbingo | Unity WebGL | Apen | Lynrask bingo |
| BingoBonanza | Unity WebGL | Apen | Bonanza-variant |
| Turbomania | Unity WebGL | Apen | Turbo bingospill |
| SpinnGo | Unity WebGL | Apen | SpinnGo-variant |
| **Candy Mania** | **iframe** | **Apen** | Eget utviklet — separat backend |

De forste 5 spillene er Unity WebGL-spill fra Spillorama-prosjektet som kjorer direkte i dette systemet. Candy Mania er eneste spill med separat backend og integreres via iframe.

### 2. CandyMania (separat prosjekt)

- **Mappe:** `/Users/tobiashaugen/Projects/Candy/`
- **Repo:** `tobias363/candy-web`
- **Deploy:** `candy-backend-ldvg.onrender.com`
- **Hva det er:** Kun CandyMania-spillmotoren og React-frontenden. Eget utviklet bingospill med sanntidstrekninger.

CandyMania har **egen backend** (Express + Socket.IO) og **egen database**. Den embeddes i Bingo-system via iframe med delt lommebok (PostMessage-bro).

---

## Hvor skal endringer gjores?

| Jeg vil... | Prosjekt | Mappe |
|------------|----------|-------|
| Endre lobbyen (UI, spillkort, bilder) | **Bingosystem Spillorama** | `frontend/` |
| Legge til spillbilder/thumbnails | **Bingosystem Spillorama** | `frontend/assets/games/` |
| Endre spillkatalogen | **Bingosystem Spillorama** | `backend/src/platform/` |
| Endre auth/wallet/compliance | **Bingosystem Spillorama** | `backend/src/` |
| Endre Unity WebGL-spillene | **Bingosystem Spillorama** | `Spillorama/` (Unity 6) |
| Endre CandyMania spillogikk | **CandyMania** | `candy-web/src/` |
| Endre CandyMania backend/motor | **CandyMania** | `backend/src/` |
| Endre iframe-integrasjonen (Candy ↔ lommebok) | **Begge** | Spillorama: `backend/public/game/index.html`, Candy: `candy-web/src/domain/embed/` |

---

## Arkitektur

```
┌─────────────────────────────────────────────────────┐
│           Bingo-system (denne repoen)               │
│           bingo-system-jsso.onrender.com            │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Backend  │  │ Frontend │  │ Spillorama Unity │  │
│  │ Express  │  │ Lobby    │  │ 5 WebGL-spill:   │  │
│  │ Socket.IO│  │ /web/    │  │ - Papir bingo    │  │
│  │ Postgres │  │ Auth     │  │ - Lynbingo       │  │
│  │ Wallet   │  │ Wallet   │  │ - BingoBonanza   │  │
│  │ Admin    │  │ Admin    │  │ - Turbomania     │  │
│  └────┬─────┘  └────┬─────┘  │ - SpinnGo        │  │
│       │              │        └────────┬─────────┘  │
│       └──────┬───────┘                 │            │
│              │    ┌────────────────────┘            │
│              ▼    ▼                                  │
│       ┌──────────────────┐                          │
│       │ /game/  WebGL    │ ← Unity-spillene         │
│       │ /view-game/  TV  │ ← SpilloramaTv           │
│       └──────────────────┘                          │
│              │                                       │
│              │ iframe + PostMessage                  │
│              ▼                                       │
│       ┌──────────────────┐                          │
│       │  Candy Mania     │ ← separat repo/backend   │
│       │  candy-backend-  │   tobias363/candy-web     │
│       │  ldvg.onrender   │   Delt lommebok via       │
│       │  .com            │   PostMessage             │
│       └──────────────────┘                          │
└─────────────────────────────────────────────────────┘
```

---

## Spillbilder

Thumbnails hentet fra Spillorama Unity-prosjektet ligger i `frontend/assets/games/`:

| Fil | Tilhorende spill |
|-----|-----------------|
| `godterihuset.png` | Candy Mania |
| `papirbingo.png` | Papir bingo |
| `galopp.png` | (tema-thumbnail) |
| `gold-digger.png` | (tema-thumbnail) |
| `spillorama.png` | Spillorama generisk |
| `bingo_1.png` – `bingo_4.png` | Generelle spillvalg-bilder |

---

## Mappestruktur

```
.
├── backend/              # Express + Socket.IO backend (TypeScript)
│   ├── src/
│   │   ├── adapters/     # Wallet, BingoSystem, integrasjoner
│   │   ├── admin/        # Admin API + RBAC
│   │   ├── compliance/   # RTP/tapsgrense-tester
│   │   ├── game/         # BingoEngine spillmotor
│   │   ├── integration/  # Hall/venue-integrasjon
│   │   ├── launch/       # Launch-token store
│   │   ├── payments/     # Swedbank Pay
│   │   └── platform/     # Auth, sessions, spillkatalog
│   ├── public/
│   │   ├── game/         # Spillorama WebGL build (/game/)
│   │   ├── view-game/    # SpilloramaTv WebGL (/view-game/)
│   │   └── web/          # CandyMania bygget frontend (/web/)
│   └── package.json
├── frontend/             # Lobby-portal + admin
│   ├── assets/
│   │   └── games/        # Spillbilder (thumbnails fra Unity)
│   ├── admin/            # Admin-panel
│   ├── app.js            # Lobby-applikasjon
│   ├── style.css
│   └── index.html
├── Spillorama/           # Unity 6 WebGL-prosjekt (ekskludert fra git, 1.4GB)
├── scripts/              # Build, deploy, release
├── docs/                 # Teknisk dokumentasjon
└── render.yaml           # Render deploy-konfigurasjon
```

---

## Deploy-flyt — slik pusher du endringer

### Branch protection

`main`-branchen er **beskyttet**. Du kan ikke pushe direkte. Alle endringer ma ga via **Pull Request (PR)** med godkjente status checks.

### Steg-for-steg: Bingosystem Spillorama

```bash
# 1. Ga til prosjektmappa
cd /Users/tobiashaugen/Projects/Bingo-system

# 2. Opprett feature-branch fra main
git checkout main && git pull
git checkout -b feat/min-endring

# 3. Gjor endringer, stage og commit
git add <filer>
git commit -m "feat: beskrivelse av endring"

# 4. Push branch og lag PR
git push -u origin feat/min-endring
gh pr create --base main --title "feat: beskrivelse"

# 5. Merge PR pa GitHub (krever godkjente status checks)
# -> Render deployer automatisk fra main (3-5 min)
```

### Steg-for-steg: CandyMania

```bash
# 1. Ga til prosjektmappa
cd /Users/tobiashaugen/Projects/Candy

# 2. Gjor endringer i candy-web eller backend
# ... rediger filer ...

# 3. Commit og push direkte til main (ingen branch protection)
git add <filer>
git commit -m "feat: beskrivelse av endring"
git push origin main
# -> Render deployer automatisk (3-5 min)
```

### Oppdatere CandyMania-frontenden i Bingosystem Spillorama

Nar du endrer CandyMania (`candy-web/`), ma du **ogsa oppdatere builden i Bingosystem** for at endringene vises i lobbyen:

```bash
# 1. Bygg candy-web
cd /Users/tobiashaugen/Projects/Candy/candy-web
npm install && npm run build

# 2. Kopier build til Bingosystem
cp -r dist/* /Users/tobiashaugen/Projects/Bingo-system/backend/public/web/
cp -r dist/* /Users/tobiashaugen/Projects/Bingo-system/frontend/web/

# 3. Commit og push via PR i Bingosystem
cd /Users/tobiashaugen/Projects/Bingo-system
git checkout -b feat/update-candy-build
git add backend/public/web/ frontend/web/
git commit -m "chore: oppdater candy-web build"
git push -u origin feat/update-candy-build
gh pr create --base main --title "chore: oppdater candy-web build"
```

> **Viktig:** Begge steg er nodvendige. Candy-backenden og Bingosystemet deployer separat. Hvis du bare pusher til `candy-web`, vil endringene kun vises pa `candy-backend-ldvg.onrender.com`, men **ikke** i lobbyen pa `bingo-system-jsso.onrender.com`.

### Oversikt: hva trigger deploy hvor?

| Handling | Resultat |
|----------|----------|
| Merge PR til `main` i `tobias363/bingosystem` | Bingo System deployer pa Render |
| Push til `main` i `tobias363/candy-web` | CandyMania-backend deployer pa Render |
| Endre candy-web uten a oppdatere Bingosystem | Endringer vises KUN pa candy-backend, IKKE i lobbyen |

---

## Lokal utvikling

```bash
# Start Bingo-system backend
npm --prefix backend install
cp backend/.env.example backend/.env   # konfigurer PostgreSQL
npm run dev                             # http://localhost:4000

# Lobby:        http://localhost:4000/web/
# Admin:        http://localhost:4000/admin
# Spillorama:   http://localhost:4000/game/
# SpilloramaTv: http://localhost:4000/view-game/
```

---

## Tjenester (Render)

| Tjeneste | URL | Repo | Branch |
|----------|-----|------|--------|
| Bingo System (lobby + alt) | `bingo-system-jsso.onrender.com` | `tobias363/bingosystem` | `main` |
| CandyMania (kun spillet) | `candy-backend-ldvg.onrender.com` | `tobias363/candy-web` | `main` |
