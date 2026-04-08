# Spillorama Bingo System

Lobby og spillplattform med Unity WebGL-spill, wallet, auth, compliance og admin.

CandyMania-spillet er et separat prosjekt som integreres via iframe med delt lommebok.

---

## Arkitektur

```
┌──────────────────────────────────────────────┐
│              Spillorama System                │
│  (denne repoen)                               │
│                                               │
│  ┌──────────┐  ┌───────────┐  ┌───────────┐  │
│  │ Backend  │  │ Frontend  │  │ Spillorama│  │
│  │ Express  │  │ Lobby     │  │ Unity     │  │
│  │ Socket.IO│  │ Portal    │  │ WebGL     │  │
│  │ Postgres │  │ Admin     │  │ 5 spill   │  │
│  └────┬─────┘  └─────┬─────┘  └─────┬─────┘  │
│       │               │              │        │
│       └───────┬───────┘              │        │
│               │    ┌─────────────────┘        │
│               ▼    ▼                          │
│       ┌──────────────────┐                    │
│       │  /game/ WebGL    │                    │
│       │  /view-game/ TV  │                    │
│       └──────────────────┘                    │
│               │                               │
│               │ iframe + PostMessage          │
│               ▼                               │
│       ┌──────────────────┐                    │
│       │  CandyMania      │  ← separat repo   │
│       │  (iframe embed)  │    med egen backend│
│       │  Delt lommebok   │                    │
│       └──────────────────┘                    │
└──────────────────────────────────────────────┘
```

## Mappestruktur

| Mappe | Teknologi | Beskrivelse |
|-------|-----------|-------------|
| `backend/` | Express + Socket.IO + TypeScript | System-backend: auth, wallet, compliance, admin API, spillkatalog |
| `frontend/` | Vanilla JS | Portal (lobby), admin-panel |
| `Spillorama/` | Unity 6 (6000.3.10f1) C# | Unity WebGL-prosjekt med 5 bingospill + SpilloramaTv |
| `scripts/` | Bash | Build, deploy og release-automatisering |
| `docs/` | Markdown | Teknisk dokumentasjon |

## CandyMania-integrasjon

CandyMania er et **separat prosjekt med egen backend** som integreres i Spillorama via iframe:

1. Spiller logger inn i lobbyen (`/`)
2. Klikker "Candy" i spillkatalogen
3. Backend oppretter launch-token via `/api/games/candy/launch-token`
4. Redirect til `/web/#lt=TOKEN` — CandyMania laster i iframe
5. Wallet-transaksjoner (debit/credit/balance) via PostMessage-bro i `backend/public/game/index.html`

Se `CANDY-INTEGRATION.md` for full teknisk beskrivelse.

## Lokal utvikling

```bash
# Start backend
npm --prefix backend install
cp backend/.env.example backend/.env   # konfigurer PostgreSQL
npm run dev                             # http://localhost:4000

# Lobby:        http://localhost:4000/
# Admin:        http://localhost:4000/admin
# Spillorama:   http://localhost:4000/game/
# SpilloramaTv: http://localhost:4000/view-game/
```

### Unity WebGL-build

```bash
# Åpne Spillorama i Unity Hub (6000.3.10f1)
# AIS → Build Settings → Dynamic Webgl Build Production
# File → Build Settings → WebGL → Build

# Eller via CLI:
scripts/unity-webgl-build.sh
```

## Tjenester (Render)

| Tjeneste | URL |
|----------|-----|
| Bingo System | `bingo-system-jsso.onrender.com` |

## Spillkatalog

| Spill | Type | Route | Beskrivelse |
|-------|------|-------|-------------|
| `bingo` | Direkte | `/bingo` | Multiplayer bingo i lobbyen |
| `spillorama` | WebGL | `/game/` | Unity WebGL med 5 bingospill |
| `candy` | iframe | `/web/` | CandyMania (separat backend, delt lommebok) |
| `roma` | iframe | — | Roma-spillet |
