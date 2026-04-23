# Lokal test-setup: TV-skjerm + Spill 1 bonusspill

**Formål:** Kjør hele stacken lokalt slik at Tobias kan verifisere
(a) TV-skjermen (PR #411 merget til main) og
(b) Spill 1 sine fire mini-games (Wheel of Fortune, Treasure Chest, ColorDraft, Oddsen)
i én runde, uten manuell oppretting av haller, brukere eller schedules.

**Gjelder:** `apps/backend` + `apps/admin-web` + `packages/game-client`.

---

## 1. Forutsetninger

- PostgreSQL 16+ kjører lokalt (enten via Homebrew/Postgres.app eller via
  prosjektets `docker-compose up -d postgres redis` — sistnevnte tar også
  opp Redis hvis du trenger socket-adapter / scheduler-lock-provider).
- Node.js 20+ og npm 10+ installert.
- `apps/backend/.env` er kopiert fra `.env.example` og har satt
  minimum disse variablene:
  ```
  APP_PG_CONNECTION_STRING=postgres://spillorama:spillorama@localhost:5432/spillorama
  WALLET_PROVIDER=postgres
  WALLET_PG_CONNECTION_STRING=postgres://spillorama:spillorama@localhost:5432/spillorama
  PORT=3000
  AUTO_ROUND_START_ENABLED=false
  ```
  `PORT=3000` er viktig — `apps/admin-web/vite.config.ts` proxyer `/api` og
  `/socket.io` til `http://localhost:3000`. Default i `apps/backend/src/index.ts`
  er 4000; sett den eksplisitt til 3000 lokalt for at Vite-proxyen skal treffe.

- Alle avhengigheter installert fra repo-root: `npm install`.

---

## 2. Steg 1 — Migrasjoner + demo-seed

```bash
cd apps/backend
npm run migrate
npm run seed:demo-tv-bonus
```

`seed:demo-tv-bonus` er idempotent — kjør så mange ganger du vil. Den
oppretter:

- Hall `demo-hall` med auto-generert `tv_token`.
- `admin@spillorama.no` (rolle ADMIN) og `demo-player@spillorama.no`
  (rolle PLAYER, bundet til `demo-hall`).
- Hall-gruppe `Demo Group (Lokal Test)` med `demo-hall` som eneste
  medlem (kreves av `app_game1_scheduled_games.group_hall_id` FK).
- `app_game_management` for Spill 1 (slug `bingo`, game_type_id `game_1`)
  med alle fire mini-games aktivert i `config_json.spill1.miniGames`.
- `app_schedules` + `app_daily_schedules` med `otherData.scheduleId` slik
  at scheduler-ticken også vil spawne instanser fremover.
- `app_game1_scheduled_games` direkte-INSERT i status `purchase_open` slik
  at admin kan starte spillet umiddelbart uten å vente på scheduler-tick.
- Topup 1000 NOK på `demo-player` sin wallet (kun hvis wallet-adapter er
  postgres-basert; ellers må du topup manuelt via admin-UI).

Output-eksempel:

```
✓ Demo-data seedet.
────────────────────────────────────────────────────────────────────────
Backend:        http://localhost:3000          (når PORT=3000 i .env)
Admin-web:      http://localhost:5174/admin/
Game-client:    via admin-web dev-server (se runbook)

Admin login:    admin@spillorama.no / Admin1234Demo!
Player login:   demo-player@spillorama.no / Player1234Demo!

Hall:           demo-hall (id: <uuid>)
TV-URL:         http://localhost:5174/admin/#/tv/<hallId>/<tvToken>
Winners-URL:    http://localhost:5174/admin/#/tv/<hallId>/<tvToken>/winners
────────────────────────────────────────────────────────────────────────
```

Kopier TV-URL og Winners-URL fra din egen terminal — hall-id + tv-token er
unike per seed.

---

## 3. Steg 2 — Start dev-servere

Tre dev-servere kjører parallelt. Åpne tre terminaler (eller bruk et
tmux/iTerm-splitt).

### Terminal A — Backend (port 3000)

```bash
cd apps/backend
npm run dev
```

Backend-loggen skal vise:

- `GameType/SubGame/Pattern/SavedGame catalog ready` (BIN-620..627).
- `[tv-screen] route mounted /api/tv/:hallId/:tvToken/state` (eller tilsvarende).
- Hvis `AUTO_ROUND_START_ENABLED=false` nevner den ikke auto-round — det er
  ønsket: vi vil kontrollere master-start manuelt for denne demoen.

### Terminal B — Admin-web (port 5174)

```bash
npm run dev:admin
```

Åpner vite på `http://localhost:5174/admin/`. TV-rutene ligger på
`#/tv/<hallId>/<tvToken>` og er unntatt auth-gaten.

### Terminal C — Game-client (bundlet inn i backend public/)

```bash
npm run dev:games
```

Game-client builder til `apps/backend/public/web/games/`. I dev-modus må du
re-kjøre når du har endret game-client-kode; for ren testing av TV +
mini-games er dette steget stort sett irrelevant med mindre du er usikker
på at backend serverer nyeste bundle.

---

## 4. Steg 3 — Åpne TV-skjermen

1. Kopier TV-URL fra seed-output.
2. Åpne i en nettleser (full-screen anbefalt hvis du har ekstra monitor).
3. Du skal se:
   - Header `SPILL-O-RAMA BINGO` øverst.
   - Voice-dropdown med 3 valg (placeholder — audio-filer mangler ennå).
   - Pattern-tabell (1 Rad + Full Plate med tilhørende prize-%).
   - Countdown-feltet viser tid til neste spill starter.
   - Når draw-en begynner: stor sirkel med siste trukne tall + rad av
     fem siste baller.
   - Rød gradient-bakgrunn med gull-tekst.

Hvis siden viser `Laster…` i mer enn noen få sekunder:

- Sjekk at backend er oppe på port 3000 (`curl http://localhost:3000/health`).
- Sjekk i Chrome DevTools → Network at `/api/tv/<hallId>/<tvToken>/state`
  returnerer 200 JSON. 404 betyr at token eller hall-id er feil eller at
  hall er inaktiv.

---

## 5. Steg 4 — Logg inn som admin og start spillet

1. I et nytt nettleser-vindu: `http://localhost:5174/admin/`.
2. Logg inn som `admin@spillorama.no / Admin1234Demo!`.
3. Naviger: **Game Management** (eller **Spill**-seksjonen — legacy-navn
   kan variere). Du skal se `Demo Spill 1 (TV + Bonusspill)` med status
   `purchase_open`.
4. Trykk på den — se detaljer og **Start**. Dette går gjennom master-start-
   flyten for `app_game1_scheduled_games` (status → `running`), etter at
   minimum én ticket er kjøpt av en spiller.

> **Rekkefølge:** Start spillet FØR du logger inn som spiller. Admin
> setter status til `ready_to_start` (eller holder på `purchase_open`),
> spiller kjøper billett og status går videre til `running`. Hvis du
> starter spillet uten kjøpte billetter vil det gå til `completed` uten
> å trekke tall.

---

## 6. Steg 5 — Logg inn som demo-player og spill til BINGO

1. I et tredje nettleser-vindu (eller inkognito): `http://localhost:5174/admin/`
   — samme URL, men game-client kjører innebygd i admin-web-shellet for
   lobby + kjøp.
2. Logg inn som `demo-player@spillorama.no / Player1234Demo!`.
3. Spilleren skal ha 1000 NOK deposit-saldo (ble seedet). Hvis saldoen er
   0 kr — se §Feilsøking under om wallet-provider.
4. Gå til Spill 1-lobby. `Demo Spill 1 (TV + Bonusspill)` skal være
   synlig med status `purchase_open`.
5. Kjøp minimum ett gult (500 øre = 5 kr) kort. Du kan kjøpe flere for å
   øke sjansen for raske BINGO.
6. Admin trykker nå **Start** i Terminal B → status går til `running` →
   TV-skjermen begynner å vise trukne tall.
7. Auto-draw er av per `AUTO_ROUND_START_ENABLED=false`. Admin må trekke
   baller manuelt via admin-UI, eller aktivere auto-draw i testen.
8. Spill videre til du får **BINGO** (Full Plate). Dette trigger mini-game
   — LINE-wins (1 Rad) trigger IKKE mini-game.

---

## 7. Steg 6 — Observér mini-games i rotasjon

Etter BINGO trigger `Game1MiniGameOrchestrator.maybeTriggerFor()` neste
mini-game basert på `config.spill1.miniGames`.

> **Viktig avvik mellom spec og implementasjon (M1):**
> Kanonisk spec `docs/engineering/game1-canonical-spec.md` sier
> `miniGameRotation: round-robin` (wheel → chest → colordraft → oddsen →
> wheel...), men `Game1MiniGameOrchestrator.maybeTriggerFor()` velger
> alltid **første** type i lista (`activeTypes[0]` — se kommentar i
> kildekoden: `"M1: alltid første aktive type."`). Rotasjonslogikken er
> stubbet for M2+. Så i praksis vil du alltid få `wheel` når alle fire
> er konfigurert i den rekkefølgen seedet setter.

**For å teste alle fire mini-games i praksis:**

- **Enkel vei:** Endre rekkefølgen i `config_json.spill1.miniGames` via
  admin GameManagement-editor, eller kjør en variant av seed-scriptet
  som setter kun én type om gangen. Første type = den som trigges.
- **Ekte rotasjon krever implementasjon:** Se TODO i
  `apps/backend/src/game/minigames/Game1MiniGameOrchestrator.ts` linje
  ~270 — rotasjons-count + `count % N`-logikk må wires opp.

### Forventet oppførsel per mini-game

> **Type-navnekonvensjon:** Det nye scheduled-games-frameworket (brukt her)
> bruker typene `wheel | chest | colordraft | oddsen` — se
> `apps/backend/src/game/minigames/types.ts` §MiniGameType. Legacy
> BingoEngine-host-player-room-modus bruker `wheelOfFortune | treasureChest |
> mysteryGame | colorDraft`. `oddsen` i det nye frameworket tilsvarer
> legacy `mysteryGame` (M5-implementasjonen, se `MiniGameOddsenEngine.ts`).

| Navn (marketing) | Framework-type | Klient-UI | Server-logikk |
|------------------|----------------|-----------|---------------|
| **Wheel of Fortune** | `wheel` | Spilleren trykker "Spin". Hjul med segmenter (ulike premier) roterer og stopper på ett. | Server velger segment tilfeldig (vektet fra config). Klient har ingen valg — kun animasjon. |
| **Treasure Chest** | `chest` | 3 kister vises. Spilleren velger én; den åpnes og viser premien. | Server legger premien på tilfeldig kiste. Spilleren sender `chestIdx`; server sjekker om det er vinner-kisten. |
| **ColorDraft** | `colordraft` | Spilleren velger en farge ut av N tilgjengelige slots. Matcher server-valgt farge = premie. | Server trekker vinner-farge tilfeldig. Klient sender valgt farge; match = payoutCents > 0. |
| **Oddsen** (aka legacy "Mystery") | `oddsen` | Vinner velger ett av tallene 55/56/57. Cross-round: resolves i NESTE spill ved terskel-draw. | Server persisterer valg i `app_game1_oddsen_state`. Hvis valgt tall trekkes i neste spill → pot utbetales til winnings-konto. Ingen umiddelbar payout. |

### Hva skal du se i UI?

- **Spillet (klient):** Mini-game overlay over spill-canvas. Animasjon +
  prize-displayed modal.
- **Wallet:** Saldo øker med `payoutCents / 100` NOK etter mini-game.
- **Backend-logg:**
  ```
  [game1-mini-game-orchestrator] triggered { type: 'wheel', resultId: '…', scheduledGameId: '…' }
  [game1-mini-game-orchestrator] completed { resultId: '…', payoutCents: 12500 }
  ```
- **DB:** Ny rad i `app_game1_mini_game_results` med `completed_at` satt.

---

## 8. Design-verifikasjon

### TV-skjerm (rute `#/tv/:hallId/:tvToken`)

- Rød radial gradient-bakgrunn (ikke flat farge).
- Gull-tekst for header + countdown.
- Pattern-tabell med highlighted-rad for aktiv pattern.
- Siste trukne tall: stor (≥ 200px) sirkel midt på skjermen.
- Siste fem baller: horisontal rad under.
- Voice-dropdown øverst til høyre (placeholder — velger persisteres i
  `localStorage` per hall).
- Poll-interval 2 sekunder mot `/api/tv/:hallId/:tvToken/state`.
- Ved `status === "ended"` bytter siden automatisk til Winners-siden
  etter 30 sekunder.

### Winners-siden (rute `#/tv/:hallId/:tvToken/winners`)

- Tre store bokser (typisk "Hovedvinner" / "Neste spill" / "Hall-info").
- Tabell med vinnere per pattern: Rad 1, Rad 2, Rad 3, Rad 4, Full House.
- Samme red/gold-designspråk som TV-skjermen.

### Mini-games (klient)

- Modal overlay som dekker spill-canvas (ikke hele skjermen — lobby-
  navigasjon synlig).
- Hvert spill har egen animasjon (GSAP/PixiJS). Premie-modal ved slutten.
- Premie-beløpet skal matche `payoutCents / 100` i DB.

---

## 9. Feilsøking

### `ROOM_NOT_FOUND` eller `HALL_MISMATCH`
Test-brukere mangler `hall_id`. Kjør:

```bash
npm --prefix apps/backend run seed:test-users
```

Dette patcher eksisterende `@spillorama.no` / `@example.com`-brukere
uten `hall_id` til `notodden` (hall-slug fra `seed-halls.ts`). Hvis
seed-demo-tv-bonus allerede har satt `hall_id = demo-hall`, er dette unødvendig.

### TV-URL gir 404 / `TV_TOKEN_INVALID`
- Hall er inaktiv (`is_active = false`).
- `tv_token` er NULL på hall-raden (skulle ikke skje siden migrasjon
  `20260423000100_halls_tv_token.sql` backfiller + setter NOT NULL).
- Du har kopiert feil URL. Sjekk i DB:
  ```sql
  SELECT id, slug, is_active, tv_token FROM app_halls WHERE slug = 'demo-hall';
  ```

### Spilleren har 0 kr saldo
Seed-scriptet topup-er 1000 NOK, men kun hvis `wallet_accounts`-tabellen
finnes. Sjekk:

```sql
SELECT deposit_balance, winnings_balance, balance
FROM wallet_accounts
WHERE id = (SELECT wallet_id FROM app_users WHERE email = 'demo-player@spillorama.no');
```

Hvis ingen rad: `WALLET_PROVIDER=file` eller `=memory` er aktivt. Enten
bytt til `postgres` i `.env` og re-seed, eller topup manuelt via admin-
UI.

### Mini-game trigges ikke
- **1 Rad (LINE-win)** trigger ikke mini-game. Kun **Full Plate
  (BINGO-win)** gjør det.
- Sjekk at `app_game_management.config_json.spill1.miniGames` har minst
  én gyldig type (`wheel`, `chest`, `colordraft`, `oddsen`). Seed
  setter alle fire.
- Sjekk backend-logg for `game1_minigame.trigger_skipped` med
  `reason: "IMPLEMENTATION_NOT_REGISTERED"` — hvis denne kommer, er en
  mini-game-engine ikke wiret opp. Se
  `apps/backend/src/game/minigames/` for tilgjengelige engines.

### Backend starter ikke
- `EADDRINUSE :3000` — annen prosess bruker porten. `lsof -i :3000` for
  å finne den.
- Postgres mangler — `docker-compose up -d postgres` eller start local
  Postgres.
- Migrasjoner feilet — sjekk feil-loggen og `node-pg-migrate` output.

### Admin-web proxyer feil
Hvis `/api/...`-kall returnerer HTML eller 502, så peker Vite-proxyen
til feil port. `apps/admin-web/vite.config.ts` forventer backend på
`localhost:3000`. Sett `PORT=3000` i `apps/backend/.env` og restart
backend.

---

## 10. Rydde opp

```bash
# Drop demo-rader:
psql "$APP_PG_CONNECTION_STRING" <<'EOF'
  DELETE FROM app_game1_scheduled_games WHERE id = 'sg-demo-spill1';
  DELETE FROM app_daily_schedules WHERE id = 'ds-demo-spill1';
  DELETE FROM app_schedules WHERE id = 'sched-demo-spill1';
  DELETE FROM app_game_management WHERE id = 'gm-demo-spill1';
  DELETE FROM app_hall_group_members WHERE hall_id = (SELECT id FROM app_halls WHERE slug = 'demo-hall');
  DELETE FROM app_hall_groups WHERE name = 'Demo Group (Lokal Test)';
  DELETE FROM app_users WHERE email IN ('admin@spillorama.no', 'demo-player@spillorama.no');
  DELETE FROM app_halls WHERE slug = 'demo-hall';
EOF
```

Eller kjør seed på nytt — den er idempotent, og eksisterende rader blir
bare oppdatert til status `active/purchase_open` igjen.

---

## Referanser

- `docs/engineering/game1-canonical-spec.md` — Spill 1 autoritativ spec
  (§miniGameRotation: round-robin, §patterns: 1-Rad + Full Plate).
- `apps/backend/src/routes/tvScreen.ts` — TV-route (public, ingen auth).
- `apps/backend/src/game/TvScreenService.ts` — state/winners-builder.
- `apps/backend/src/game/minigames/` — fire mini-game-engines +
  orchestrator.
- `apps/admin-web/src/pages/tv/TVScreenPage.ts` — TV-klient (polling 2s).
- `apps/admin-web/src/pages/tv/WinnersPage.ts` — Winners-klient.
- `apps/backend/scripts/seed-demo-tv-and-bonus.ts` — seed-scriptet.
- `docs/architecture/SPILLKATALOG.md` — Spillorama markedsføringsnavn
  (Spill 1 = Classic Bingo, backend-slug `bingo`).
