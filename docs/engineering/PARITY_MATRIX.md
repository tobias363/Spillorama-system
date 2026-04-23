# Paritet-matrise — Legacy-avkobling Game 1, 2, 3, 5

**Eier:** Teknisk leder
**Linear-referanse:** [BIN-525](https://linear.app/bingosystem/issue/BIN-525)
**Prosjekt:** [Legacy-avkobling: Game 1–5 + backend-paritet](https://linear.app/bingosystem/project/legacy-avkobling-game-1-5-backend-paritet-a973e623234a)
**Sist oppdatert:** 2026-04-17

> **Release-gate:** Legacy kan **ikke** slås av for et spill før alle rader i dets tabell står **Release-klar = ✅**.
> Denne fila er eneste autoritative statuskilde for paritet-arbeidet. Ved uenighet mellom dette dokumentet og Linear-issuer, stemmer begge oppdateres samtidig.
> Game 4 utgår per [BIN-496](https://linear.app/bingosystem/issue/BIN-496) — ingen matrise.

---

## 1. Legende

| Symbol | Betydning |
|--------|-----------|
| ✅ | Fullført — verifisert mot kode |
| 🟡 | Delvis — startet, mangler ett eller flere akseptkriterier |
| ❌ | Ikke startet |
| 🔵 | Ikke relevant for dette spillet |

**Kolonne-definisjoner:**

- **Legacy i bruk?** Kjører legacy-koden for denne featuren fortsatt i prod (`legacy/unity-backend/` + `legacy/unity-client/`)? "✅" her betyr legacy IKKE lenger brukes (fullt avkoblet).
- **Backend-paritet:** Er featuren implementert i `apps/backend/`?
- **Klient-paritet:** Er featuren implementert i `packages/game-client/` web-native klient?
- **Legacy-refs fjernet?** Finnes det aktive kall fra ny stack til `legacy/` for denne featuren? "✅" betyr ingen kall.
- **Release-klar:** Alle tester grønne + verifisert i staging + ingen blockere. "✅" = klar for hall-for-hall cutover.

Alle fire kolonner må være **✅** for at raden er fullført.

---

## 2. Game 1 — Hovedspill (Classic Bingo)

**Canonical spec:** [`game1-canonical-spec.md`](game1-canonical-spec.md)
**Slug:** `bingo` / `game_1`
**Grid:** 5×5 (fri sentercelle) — 75-ball range

### 2.1 Kjerne-features
| Feature | Legacy i bruk? | Backend-paritet | Klient-paritet | Legacy-refs fjernet? | Release-klar | Issue-ref |
|---------|----------------|-----------------|----------------|----------------------|--------------|-----------|
| Rom-join + authoritative state | ✅ | ✅ | ✅ | ✅ | 🟡 | — |
| Billett-kjøp (per-type `TicketSelection[]`) | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Server-autoritativ stake | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| `ticket:mark` (privat, ikke full fanout) | ✅ | ✅ | 🟡 | ✅ | 🟡 | [BIN-499](https://linear.app/bingosystem/issue/BIN-499) ✅ merged #108 |
| Claim LINE + BINGO (server-validert) | ✅ | ✅ | ✅ | ✅ | 🟡 | — |
| Trekning (draw:new, drawIndex) | ✅ | ✅ | ✅ | ✅ | 🟡 | — |
| `drawIndex` gap-deteksjon | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-502](https://linear.app/bingosystem/issue/BIN-502) ✅ merged |
| Checkpoint + recovery | ✅ | ✅ | 🔵 | ✅ | 🟡 | — |
| Event-buffer (late-join) | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-501](https://linear.app/bingosystem/issue/BIN-501) — SpilloramaSocket event-buffer med replay på første subscribe + 9 unit-tester i denne PR |
| Chat (sanntids) | ✅ | ✅ | ✅ | ✅ | 🟡 | — |
| Chat-persistens (DB) | 🔴 | ✅ | 🔵 | ✅ | 🟡 | [BIN-516](https://linear.app/bingosystem/issue/BIN-516) — backend+migration i denne PR; klient leser nå replay via chat:history |
| Audio (3 stemmepakker, 60 clips) | ✅ | 🔵 | ✅ | ✅ | ✅ | — |
| Double-announce toggle | ✅ | 🔵 | ✅ | ✅ | ✅ | — |
| Spectator-fase (SPECTATING) | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-507](https://linear.app/bingosystem/issue/BIN-507) ✅ merged |
| Loader-barriere (late-join sync) | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-500](https://linear.app/bingosystem/issue/BIN-500) ✅ merged |
| MAX_DRAWS 75 (fiks fra 60) | ✅ | ✅ | 🔵 | ✅ | ✅ | [BIN-520](https://linear.app/bingosystem/issue/BIN-520) ✅ merged |

### 2.2 Game-specific features
| Feature | Legacy i bruk? | Backend-paritet | Klient-paritet | Legacy-refs fjernet? | Release-klar | Issue-ref |
|---------|----------------|-----------------|----------------|----------------------|--------------|-----------|
| Mini-game rotasjon — Wheel of Fortune | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Mini-game rotasjon — Treasure Chest | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Mini-game rotasjon — Mystery | ✅ | ✅ | 🟡 | ✅ | 🟡 | [BIN-505](https://linear.app/bingosystem/issue/BIN-505) ✅ merged #122 |
| Mini-game rotasjon — ColorDraft | ✅ | ✅ | 🟡 | ✅ | 🟡 | [BIN-506](https://linear.app/bingosystem/issue/BIN-506) ✅ merged #122 |
| Elvis replace (real in-place swap) | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-509](https://linear.app/bingosystem/issue/BIN-509) ✅ merged #121 |
| `replaceAmount` debitering | ✅ | ✅ | 🔵 | ✅ | 🟡 | [BIN-509](https://linear.app/bingosystem/issue/BIN-509) ✅ merged (dekker BIN-521) |
| Lucky number picker (60-tall) | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Host manual start | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Per-hall player-data | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Billett-animasjoner (GSAP-parametre) | ✅ | 🔵 | ✅ | ✅ | ✅ | — |

### 2.3 Infrastruktur og drift
| Feature | Legacy i bruk? | Backend-paritet | Klient-paritet | Legacy-refs fjernet? | Release-klar | Issue-ref |
|---------|----------------|-----------------|----------------|----------------------|--------------|-----------|
| Socket.IO Redis-adapter (multi-node) | 🔵 | ✅ | 🔵 | ✅ | 🟡 | [BIN-494](https://linear.app/bingosystem/issue/BIN-494) ✅ merged #108 |
| Hall-display / TV-skjerm broadcast | 🔴 | ✅ | 🟡 | ✅ | 🟡 | [BIN-498](https://linear.app/bingosystem/issue/BIN-498) — backend socket-handlers + statisk TV-side i denne PR; venter på admin-CRUD for tvUrl + staging-test |
| AdminHallDisplayLogin | 🔴 | ✅ | ✅ | ✅ | 🟡 | [BIN-503](https://linear.app/bingosystem/issue/BIN-503) — DB-backed token-rotasjon (`app_hall_display_tokens`), admin-web token-panel m/ QR; env-var fallback bevart for dev/staging |
| Admin hall-events (ready, countdowns) | 🔴 | ✅ | ✅ | ✅ | 🟡 | [BIN-515](https://linear.app/bingosystem/issue/BIN-515) — socket `admin:login/room-ready/pause-game/resume-game/force-end` + HTTP `/api/admin/rooms/:code/room-ready` + admin-web live-operator-panel; venter på staging |
| Admin-dashboard m/ rapporter | 🔴 | ✅ | ✅ | ✅ | 🟡 | [BIN-517](https://linear.app/bingosystem/issue/BIN-517) — live-rom per hall + finansiell range-rapport + per-spill statistikk (backend `generateRangeReport` / `generateGameStatistics` + 3 admin-endpoints + admin-web dashboard-seksjon m/ chart); venter på staging |
| Spillvett cross-game-test | 🔵 | ✅ | 🔵 | ✅ | 🟡 | [BIN-541](https://linear.app/bingosystem/issue/BIN-541) — 20 tester (4 spill × 4 regler + 4 fail-closed) i denne PR |
| E2E pengeflyt-test | 🔵 | ✅ | 🔵 | ✅ | ✅ | [BIN-526](https://linear.app/bingosystem/issue/BIN-526) ✅ merged — `apps/backend/src/compliance/__tests__/pengeflyt-e2e.test.ts` dekker G1/G2/G3/G5 |
| Wire-kontrakt-test (Zod) | 🔵 | ✅ | ✅ | ✅ | ✅ | [BIN-527](https://linear.app/bingosystem/issue/BIN-527) / [BIN-545](https://linear.app/bingosystem/issue/BIN-545) ✅ merged |
| Load-test 1000+ spillere | 🔵 | ✅ | 🔵 | ✅ | 🟡 | [BIN-508](https://linear.app/bingosystem/issue/BIN-508) ✅ merged, venter på første nattlig-kjøring |
| Observability (Sentry + funnel) | 🔵 | ✅ | ✅ | ✅ | 🟡 | [BIN-539](https://linear.app/bingosystem/issue/BIN-539) ✅ merged — venter på Grafana-dashboards provisjonert |
| Feature-flag rollback-runbook | 🔵 | ✅ | ✅ | ✅ | ✅ | [BIN-540](https://linear.app/bingosystem/issue/BIN-540) ✅ merged — backend + klient + runbook + `halls.client_variant`-migrasjon |
| iOS Safari WebGL context-loss test | 🔵 | 🔵 | ✅ | ✅ | 🟡 | [BIN-542](https://linear.app/bingosystem/issue/BIN-542) — `WebGLContextGuard.ts` håndterer `webglcontextlost`/`restored` (preventDefault + destroy+reinit PIXI app + state-recovery via room:state snapshot). 7 unit-tester grønne. Release-klar 🟡 venter på første live iOS Safari-verifisering i pilot. |
| GSAP-lisensavklaring | 🔵 | 🔵 | ✅ | ✅ | ✅ | [BIN-538](https://linear.app/bingosystem/issue/BIN-538) — GSAP er 100 % gratis for kommersiell bruk (Webflow-oppkjøp fjernet alle Business-tier). Ingen lisens-innkjøp eller Lotteritilsynet-avklaring nødvendig. Se `docs/compliance/GSAP_LICENSE.md`. |
| Asset-pipeline (Unity → PixiJS) | 🔵 | 🔵 | ✅ | ✅ | ✅ | [BIN-543](https://linear.app/bingosystem/issue/BIN-543) — `scripts/build-assets.ts` kopierer Unity sprites fra `legacy/unity-client/Assets/_Project/Sprites/` til `apps/backend/public/web/games/assets/<slug>/`, strip `.meta`, generer per-group `index.json` + top-level `manifest.json`. 12 grupper, 139 assets, 15.6 MB. Kjøres via `npm run assets:build` som del av deploy-pipeline. True atlas-packing utsatt — HTTP/2-mux gjør individuelle PNGs akseptabel perf for ~50 sprite-loads. |
| PlayerPrefs → localStorage mapping | 🔵 | 🔵 | ✅ | ✅ | ✅ | [BIN-544](https://linear.app/bingosystem/issue/BIN-544) — `PlayerPrefs.migrateFromUnity()` med 7 Unity-nøkler (Game_Marker, Game_Background, CurrentGameLanguage, VoiceStatus, SoundStatus, NotificationsEnabled, Volume), 3 prefiks-varianter, bridge til AudioManager legacy-keys. Triggered fra `GameApp.init()` med telemetri `unity_prefs_migrated`. 17 unit-tester grønne. |

**Game 1 totalt:** 41 rader — 17 ✅, 24 🟡, 0 ❌. Release-klar: 17 / 41 (41 %). Bolk 5-leveransene (BIN-516 chat-persistens, BIN-541 Spillvett cross-game, BIN-498 hall-display + BIN-504 konsolidert) flyttet 3 rader ❌ → 🟡 på Backend-paritet. Bolk 4 flyttet BIN-526 (❌→✅) og BIN-540 (🟡→✅) til fullt Release-klar. Bolk 6 BIN-532 la til ny rad "Unity rollback-bundle CI" (🟡 Release-klar). Bolk 7 BIN-503 + BIN-515 + BIN-517 flyttet AdminHallDisplayLogin, Admin hall-events og Admin-dashboard ❌ → 🟡 Release-klar (DB-tokens + live-operator-panel + dashboard m/ live-rom + finansielle rapporter + per-spill statistikk). Gjenstående 🟡 venter i hovedsak på staging-verifisering eller pilot-cutover.

---

## 3. Game 2 — Rocket Bingo

**Canonical spec:** [`game2-canonical-spec.md`](game2-canonical-spec.md) (BIN-529 levert)
**Slug:** `rocket`
**Grid:** 3×5 (15 celler) — 60-ball range

### 3.1 Kjerne-features
| Feature | Legacy i bruk? | Backend-paritet | Klient-paritet | Legacy-refs fjernet? | Release-klar | Issue-ref |
|---------|----------------|-----------------|----------------|----------------------|--------------|-----------|
| Rom-join + authoritative state | 🔴 | ✅ | ✅ | ❌ | 🟡 | — |
| Billett-kjøp (1 type "standard") | 🔴 | ✅ | ✅ | ❌ | 🟡 | — |
| Ticket-mark (slim) | ✅ | ✅ | 🟡 | ✅ | 🟡 | [BIN-499](https://linear.app/bingosystem/issue/BIN-499) shared (merged) |
| Claim LINE + BINGO | 🔴 | ✅ | ✅ | ❌ | 🟡 | — |
| Trekning + drawIndex | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-502](https://linear.app/bingosystem/issue/BIN-502) shared (merged) |
| Lucky number | 🔴 | ✅ | ✅ | ❌ | 🟡 | — |
| Chat | 🔴 | ✅ | ✅ | ❌ | 🟡 | Gjenbruker G1 `ChatPanel` + BIN-516 DB-persistens |
| Audio (nummerannouncement) | 🔴 | 🔵 | ❌ | ❌ | ❌ | Egen issue må opprettes |
| Loader-barriere (late-join) | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-500](https://linear.app/bingosystem/issue/BIN-500) portet til G2 |
| SPECTATING-fase | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-507](https://linear.app/bingosystem/issue/BIN-507) portet til G2 |
| Eksplisitt kjøp (fjern auto-arm) | ✅ | ✅ | ✅ | ✅ | 🟡 | G1 har dette, portet til G2 |

### 3.2 Game-specific features
| Feature | Legacy i bruk? | Backend-paritet | Klient-paritet | Legacy-refs fjernet? | Release-klar | Issue-ref |
|---------|----------------|-----------------|----------------|----------------------|--------------|-----------|
| Rakettstabling / animasjon | 🔴 | 🔵 | ✅ | ❌ | 🟡 | [BIN-529](https://linear.app/bingosystem/issue/BIN-529) — `components/RocketStack.ts` (60 segmenter, GSAP stacking) |
| Paginering (multiple tickets) | 🔴 | 🔵 | ✅ | ❌ | 🟡 | Drag + prev/next-knapper + page-indikator i `TicketScroller` |
| Billettfarger (index-cycle TICKET_THEMES) | 🔴 | 🔵 | ✅ | ❌ | 🟡 | Delt med G5; 8 varianter fra G1 `TICKET_THEMES` |
| Blind ticket purchase (`Game2BuyBlindTickets`) | 🔴 | ❌ | ❌ | ❌ | ❌ | [BIN-511](https://linear.app/bingosystem/issue/BIN-511) |

### 3.3 Canonical spec status

- [x] **BIN-529** — `docs/engineering/game2-canonical-spec.md` skrevet med YAML front-matter (levert)
- Rader verifisert mot kode + legacy `Sockets/game2.js`. Se spec §11 for kjente avvik.

**Game 2 totalt:** 15 rader — 0 ✅, 13 🟡, 2 ❌. Release-klar: 0 / 15 (0 %). — G1-paritet forbedret (SPECTATING + eksplisitt kjøp + loader-barriere portet).

---

## 4. Game 3 — Monster Bingo / Mønsterbingo

**Canonical spec:** [`game3-canonical-spec.md`](game3-canonical-spec.md) (BIN-530 levert)
**Slug:** `monsterbingo`
**Grid:** 5×5 (fri sentercelle) — 60-ball range + animert kulekø

### 4.1 Kjerne-features
| Feature | Legacy i bruk? | Backend-paritet | Klient-paritet | Legacy-refs fjernet? | Release-klar | Issue-ref |
|---------|----------------|-----------------|----------------|----------------------|--------------|-----------|
| Rom-join + authoritative state | 🔴 | ✅ | ✅ | ❌ | 🟡 | — |
| Billett-kjøp (1 type "standard") | 🔴 | ✅ | ✅ | ❌ | 🟡 | — |
| Ticket-mark (slim) | ✅ | ✅ | 🟡 | ✅ | 🟡 | [BIN-499](https://linear.app/bingosystem/issue/BIN-499) shared (merged) |
| Claim LINE + BINGO | 🔴 | ✅ | ✅ | ❌ | 🟡 | — |
| Multiple patterns (utover LINE+BINGO) | 🔴 | ❌ | ❌ | ❌ | ❌ | Egen issue — "Mønsterbingo" tilsier dette |
| Trekning + drawIndex | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-502](https://linear.app/bingosystem/issue/BIN-502) shared (merged) |
| Chat (sanntids) | 🔴 | ✅ | ✅ | ❌ | 🟡 | — (G3 har chat i motsetning til G2/G5) |
| Lucky number | 🔴 | ✅ | ✅ | ❌ | 🟡 | — |
| Audio (nummerannouncement) | 🔴 | 🔵 | ❌ | ❌ | ❌ | Egen issue |
| Loader-barriere (late-join) | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-500](https://linear.app/bingosystem/issue/BIN-500) portet til G3 |
| SPECTATING-fase | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-507](https://linear.app/bingosystem/issue/BIN-507) portet til G3 |
| Eksplisitt kjøp (fjern auto-arm) | ✅ | ✅ | ✅ | ✅ | 🟡 | G1 har dette, portet til G3 |

### 4.2 Game-specific features
| Feature | Legacy i bruk? | Backend-paritet | Klient-paritet | Legacy-refs fjernet? | Release-klar | Issue-ref |
|---------|----------------|-----------------|----------------|----------------------|--------------|-----------|
| Animert kulekø vertikal FIFO (MVP) | 🔴 | 🔵 | ✅ | ❌ | 🟡 | — |
| Kulekø FIFO (maks 5) | 🔴 | 🔵 | ✅ | ❌ | 🟡 | — |
| Waypoint-bane (`BallPathRottate.cs`) | 🔴 | 🔵 | ❌ | ❌ | ❌ | Egen issue — krever GSAP-timeline eller fysikk |
| Mønsteranimasjon (ping-pong) | 🔴 | 🔵 | ✅ | ❌ | 🟡 | `components/PatternBanner.ts` — GSAP yoyo-pulse på neste un-won pattern; cellnivå-preview utsatt |

### 4.3 Canonical spec status

- [x] **BIN-530** — `docs/engineering/game3-canonical-spec.md` skrevet med YAML front-matter (levert)
- Rader verifisert mot kode + legacy `Sockets/game3.js`. Se spec §11 for kjente avvik.

**Game 3 totalt:** 16 rader — 0 ✅, 13 🟡, 3 ❌. Release-klar: 0 / 16 (0 %). — G1-paritet forbedret (SPECTATING + eksplisitt kjøp + loader-barriere portet).

---

## 5. Game 5 — Spillorama Bingo

**Canonical spec:** [`game5-canonical-spec.md`](game5-canonical-spec.md) (BIN-531 levert)
**Slug:** `spillorama`
**Grid:** 3×5 (15 celler) — 60-ball range + ruletthjul

### 5.1 Kjerne-features
| Feature | Legacy i bruk? | Backend-paritet | Klient-paritet | Legacy-refs fjernet? | Release-klar | Issue-ref |
|---------|----------------|-----------------|----------------|----------------------|--------------|-----------|
| Rom-join + authoritative state | 🔴 | ✅ | ✅ | ❌ | 🟡 | — |
| Billett-kjøp (1 type "standard") | 🔴 | ✅ | ✅ | ❌ | 🟡 | — |
| Ticket-mark (slim) | ✅ | ✅ | 🟡 | ✅ | 🟡 | [BIN-499](https://linear.app/bingosystem/issue/BIN-499) shared (merged) |
| Claim LINE + BINGO | 🔴 | ✅ | ✅ | ❌ | 🟡 | — |
| Trekning + drawIndex | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-502](https://linear.app/bingosystem/issue/BIN-502) shared (merged) |
| Chat | 🔴 | ✅ | ❌ | ❌ | ❌ | Egen issue må opprettes |
| Audio | 🔴 | 🔵 | ❌ | ❌ | ❌ | Egen issue må opprettes |
| Loader-barriere (late-join) | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-500](https://linear.app/bingosystem/issue/BIN-500) portet til G5 |
| SPECTATING-fase | ✅ | ✅ | ✅ | ✅ | 🟡 | [BIN-507](https://linear.app/bingosystem/issue/BIN-507) portet til G5 |
| Eksplisitt kjøp (fjern auto-arm) | ✅ | ✅ | ✅ | ✅ | 🟡 | G1 har dette, portet til G5 |
| KYC-gatekeep (verified player) | 🔴 | ❌ | ❌ | ❌ | ❌ | [BIN-514](https://linear.app/bingosystem/issue/BIN-514) |

### 5.2 Game-specific features
| Feature | Legacy i bruk? | Backend-paritet | Klient-paritet | Legacy-refs fjernet? | Release-klar | Issue-ref |
|---------|----------------|-----------------|----------------|----------------------|--------------|-----------|
| Ruletthjul (ren GSAP, MVP) | 🔴 | 🔵 | ✅ | ❌ | 🟡 | — |
| Ruletthjul m/ fysikk (matter.js) | 🔴 | 🔵 | 🟡 | ❌ | ❌ | Egen issue: fysikk-port |
| DrumRotation (kontinuerlig) | 🔴 | 🔵 | ✅ | ❌ | 🟡 | GSAP infinite-loop 2π/12s i `JackpotOverlay`, preserver offset ved spin-overgang |
| Free Spin Jackpot | 🔴 | ❌ | 🟡 (stub) | ❌ | ❌ | [BIN-531](https://linear.app/bingosystem/issue/BIN-531) oppfølger |
| `SwapTicket` (bytt midt i runde) | 🔴 | ❌ | ❌ | ❌ | ❌ | [BIN-510](https://linear.app/bingosystem/issue/BIN-510) |
| `SelectWofAuto` / `SelectRouletteAuto` | 🔴 | ❌ | ❌ | ❌ | ❌ | [BIN-519](https://linear.app/bingosystem/issue/BIN-519) |
| `checkForWinners` eksplisitt | 🔴 | ❌ | ❌ | ❌ | ❌ | [BIN-512](https://linear.app/bingosystem/issue/BIN-512) |
| Billettfarger (index-cycle gjennom TICKET_THEMES) | 🔴 | 🔵 | ✅ | ❌ | 🟡 | Delt med G2; 8 varianter fra G1 `TICKET_THEMES` via `getTicketThemeByName` |

### 5.3 Canonical spec status

- [x] **BIN-531** — `docs/engineering/game5-canonical-spec.md` skrevet med YAML front-matter (levert)
- Rader verifisert mot kode + legacy `Sockets/game5.js`. Se spec §11 for kjente avvik.

**Game 5 totalt:** 19 rader — 0 ✅, 11 🟡, 8 ❌. Release-klar: 0 / 19 (0 %). — G1-paritet forbedret (SPECTATING + eksplisitt kjøp + loader-barriere portet).

---

## 6. Overordnet fremdrift

| Spill | Rader | ✅ | 🟡 | ❌ | Release-klar % |
|-------|------:|---:|---:|---:|---------------:|
| Game 1 (Hovedspill) | 41 | 17 | 24 | 0 | 41 % |
| Game 2 (Rocket) | 15 | 0 | 13 | 2 | 0 % |
| Game 3 (Monster) | 16 | 0 | 13 | 3 | 0 % |
| Game 5 (Spillorama) | 19 | 0 | 11 | 8 | 0 % |
| **Totalt** | **91** | **17** | **61** | **13** | **19 %** |

Totalsum regnet per **Release-klar**-kolonnen — det er den som styrer cutover-beslutning per [`LEGACY_DECOUPLING_STATUS.md`](../architecture/LEGACY_DECOUPLING_STATUS.md).

---

## 7. Fremdriftssekvens (anbefaling)

Rekkefølgen som gir raskest path til GO-staging:

1. **Fundament (alle spill)** — uten disse er per-spill-paritet meningsløst:
   - BIN-494 Redis-adapter
   - BIN-499 ticket:mark slim
   - BIN-520 envConfig clamp
   - BIN-501 event-buffer
   - BIN-502 drawIndex gap
   - BIN-545 Zod shared-types
   - BIN-527 wire-kontrakt-test
2. **Release-gates** — trenger fundamentet før de gir verdi:
   - BIN-508 load-test 1000
   - BIN-526 E2E pengeflyt
   - BIN-541 Spillvett cross-game
3. **Per-spill paritet** (parallelt):
   - BIN-529 Game 2 canonical + gaps
   - BIN-530 Game 3 canonical + gaps
   - BIN-531 Game 5 canonical + gaps
4. **Pre-pilot**:
   - BIN-539 observability
   - BIN-540 feature-flag + rollback
   - BIN-542 iOS Safari test
5. **Pilot én hall** — feature-flag én hall til web
6. **Hall-for-hall cutover**
7. **Fase 5 legacy-sletting** (BIN-537)

---

## 8. Redigerings-policy

Denne fila **må** oppdateres i samme PR som lukker en parity-task. Ingen merge uten at matrisen reflekterer endringen.

**Prosess per PR som endrer matrise:**

1. Identifiser hvilken rad (eller nye rader) berøres
2. Oppdater status-kolonnene basert på faktisk kode-verifikasjon (ikke PR-intensjon)
3. Legg til commit-SHA i "Revisjonshistorikk" (§9) hvis større endring
4. PR-reviewer validerer at matrisen stemmer mot diffen

Automatisk generator fra YAML front-matter i per-spill canonical specs er planlagt — se [BIN-528](https://linear.app/bingosystem/issue/BIN-528)-oppfølgere når G2/G3/G5 specs er på plass.

---

## 9. Revisjonshistorikk

| Dato | Commit-ref | Endring |
|------|-----------|---------|
| 2026-04-17 | (denne PR) | Initial versjon. G1 verifisert mot kode og canonical spec (BIN-528). G2/G3/G5 delvis utfyllt fra README — venter på respektive canonical specs (BIN-529/530/531). |
| 2026-04-17 | BIN-502 PR | Oppdatert G1-rader: BIN-494 Redis-adapter ✅ (backend i main), BIN-499 ticket:mark slim ✅ (backend i main) — begge levert av slot-2 via PR #108. BIN-502 drawIndex gap-deteksjon ✅ (klient i main) — levert i denne PR. Alle tre nå 🟡 "Release-klar" (venter på integrasjon-test i staging). |
| 2026-04-17 | BIN-500 PR | BIN-500 Loader-barriere ✅ (klient i main) — syncReady-checkliste + "Syncer..."-overlay ved RUNNING late-join + syncGap-telemetri. Rad nå 🟡 Release-klar (venter på manuell late-join-test mot staging). |
| 2026-04-17 | BIN-520/545/508 batch | Agent 2 leverte: BIN-520 envConfig MAX_DRAWS 60→75 (✅ fullført), BIN-545 Zod-schema-fundament i packages/shared-types/ (🟡 3 av mange events dekket), BIN-508 Artillery 1000-player load-test (🟡 merged, venter på første nattlig-kjøring). G1 release-klar nå 10/32 (31 %); totalt 14 ✅, 25 🟡, 24 ❌. |
| 2026-04-17 | BIN-539 PR | Observability-fundament: backend Sentry init (`apps/backend/src/observability/sentry.ts`) + errorReporter middleware + ackFailure auto-capture; tre nye Prometheus-metrikker (claim_submitted_total, payout_amount histogram, reconnect_total); klient Sentry sidecar (`packages/game-client/src/telemetry/Sentry.ts`) koblet til eksisterende Telemetry; 30s gap-watchdog via GameBridge.getGapMetrics(); runbook i `docs/operations/OBSERVABILITY_RUNBOOK.md` med terskler + rollback-eierskap. Rad nå 🟡 Release-klar — venter på Grafana-dashboards provisjonert. |
| 2026-04-17 | BIN-507 PR | BIN-507 SPECTATING-fase ✅ (klient i main) — ny phase i Game1Controller, transitions fra start/onGameStarted/handleReconnect, live draws via onSpectatorNumberDrawn, server-guards verifisert (PLAYER_NOT_PARTICIPATING, NOT_ARMED_FOR_GAME, MARKS_NOT_FOUND). Rad nå 🟡 Release-klar (venter på manuell late-join-test mot staging). G1 totalt: 14 ✅, 12 🟡, 6 ❌. |
| 2026-04-17 | BIN-529 PR | Game 2 canonical spec levert — `docs/engineering/game2-canonical-spec.md` med YAML front-matter. G2-matrise utvidet fra 10 → 14 rader (verifisert mot kode + legacy `Sockets/game2.js`): 0 ✅, 9 🟡, 5 ❌. Spec §11 lister avvik fra G1 (SPECTATING, loader-barriere, eksplisitt kjøp) som egne port-issues. Totalsum 67 rader (G1: 32, G2: 14, G3: 9, G5: 12). |
| 2026-04-17 | BIN-509/505/506 batch | Agent 2 leverte: BIN-509 Elvis-replace + replaceAmount debitering (PR #121 `41740f2f`); BIN-505/506 Mystery + ColorDraft 4-way rotation (PR #122 `f31f36c2`). BIN-521 (replaceAmount) dekket via BIN-509. G1 4 rader flyttet ❌ → 🟡. Totalsum G1: 14 ✅, 16 🟡, 2 ❌. |
| 2026-04-17 | BIN-531 PR | Game 5 canonical spec levert — `docs/engineering/game5-canonical-spec.md` med YAML front-matter. G5-matrise utvidet fra 12 → 20 rader: 0 ✅, 11 🟡, 9 ❌. Spec §11 lister 8 G5-unike avvik (rulett-fysikk, Free Spin Jackpot, SwapTicket, KYC, billettfarger, auto-select m.fl.) + G1-paritets-avvik. Totalsum 75 rader (G1: 32, G2: 14, G3: 9, G5: 20). |
| 2026-04-17 | BIN-530 PR | Game 3 canonical spec levert — `docs/engineering/game3-canonical-spec.md`. G3-matrise utvidet fra 9 → 16 rader: 0 ✅, 10 🟡, 6 ❌. G3 har chat (delt fra G1) men mangler waypoint-bane, pattern-animasjon og multiple patterns. **Siste i per-spill canonical spec-serien — alle fire spill nå fullt spesifisert.** Totalsum 82 rader. |
| 2026-04-17 | G2+G3+G5 G1-paritet PR | SPECTATING-fase + eksplisitt kjøp (fjern auto-arm) portet fra G1 til G2/G3/G5. 6 rader flyttet fra ❌ til 🟡. Canonical specs oppdatert (`autoArm: false` i alle tre YAML-front-matter). tsc + 72/72 tester grønne. Totalsum: 14 ✅, 52 🟡, 16 ❌ (17 % release-klar). Loader-barriere-port (BIN-500-mønster) gjenstår som oppfølger — krever LoadingOverlay-komponent per spill. |
| 2026-04-17 | Loader-barriere-port PR | LoadingOverlay flyttet fra `games/game1/components/` til delt `packages/game-client/src/components/`. `waitForSyncReady`-mønster portet til G2/G3/G5 med `late_join_sync`-telemetri (game-tagget). 3 rader flyttet ❌ → 🟡. Totalsum: 14 ✅, 55 🟡, 13 ❌ (17 %). **Alle fire spill deler nå samme reliability-fundament** (Redis, gap-deteksjon, loader-barriere, SPECTATING, eksplisitt kjøp). |
| 2026-04-17 | Bolk 4 reconcile (slot-2) | Bolk 4-leveransene (BIN-527/540/526) reconcilert: BIN-526 E2E pengeflyt (`apps/backend/src/compliance/__tests__/pengeflyt-e2e.test.ts` dekker G1/G2/G3/G5) flyttet ❌ → ✅ på Backend-paritet og Release-klar. BIN-540 Feature-flag + `halls.client_variant`-migrasjon flyttet 🟡 → ✅ Release-klar. BIN-527 Wire-kontrakt (Zod) bekreftet fullt ✅. G1: 14 → 16 ✅, 16 → 14 🟡. Totalsum: 16 ✅, 53 🟡, 13 ❌ (20 %). **Alle release-gates i Uke 7-planen er nå merged** — gjenstår kun staging-verifisering + pilot-cutover før GO. |
| 2026-04-17 | Bolk 5 merged (agent 2) | Bolk 5-leveransene merged til main: BIN-516 chat-persistens DB (PR #134 `65f6b6a1`), BIN-541 Spillvett cross-game-test 20 tester (PR #135 `cac67dec`), BIN-498 hall-display/TV-skjerm + BIN-504 konsolidert (PR #136 `42a0ac8f`). 3 G1-rader flyttet ❌ → Backend ✅ / Release-klar 🟡 (venter på staging-verifisering, Spillvett-gate automatisk via CI). **Siste pilot-blokkere lukket.** Gjenstående ❌ på G1: kun platform-avklarings-issues (iOS Safari, GSAP-lisens, asset-pipeline, PlayerPrefs) + event-buffer (BIN-501). |
| 2026-04-17 | BIN-532 PR | Unity rollback-bundle CI lagt til: `.github/workflows/unity-build.yml` (GameCI `game-ci/unity-builder@v4`, Unity 6000.3.10f1 pinnet fra `ProjectVersion.txt`, Library-cache, BUILD_METADATA.txt-stempling, 90-dagers artefakt-retention; triggere: `workflow_dispatch` / `unity-build-*` + `v*` tags / ukentlig cron). Operatør-runbook `docs/operations/UNITY_BUILD_RUNBOOK.md` dekker secret-oppsett, kjøring, deploy-rollback (<3 min) og pre-pilot staging-rehearsal-sjekkliste. Ny G1-rad "Unity rollback-bundle CI" (Backend ✅ / Release-klar 🟡) — venter på `UNITY_LICENSE`-secret + første staging-rehearsal per RELEASE_GATE §7. |
| 2026-04-17 | BIN-503 PR | AdminHallDisplayLogin konsolidert: ny migrasjon `20260418150000_hall_display_tokens.sql` (hash-only lagring, `app_hall_display_tokens`), PlatformService-CRUD (`listHallDisplayTokens` / `createHallDisplayToken` / `revokeHallDisplayToken` / `verifyHallDisplayToken` med hall-slug-replay-vern), admin-ruter på `/api/admin/halls/:hallId/display-tokens`, admin-web UI m/ generere-knapp + klartext-engangsvisning + QR-kode via api.qrserver.com + tilbakekall. `index.ts` socket-handler bruker DB-verifier primært, env-var-fallback bevart for dev/staging. 6 nye tester i `hallDisplayTokens.test.ts` dekker plaintext-engangsvisning, hash-lagring, revoke-scoping, hall-mismatch-avvisning. Rad flyttet ❌ → Backend ✅ / Klient ✅ / Release-klar 🟡 (venter på staging-verifisering). |
| 2026-04-17 | BIN-515 PR | Admin hall-events levert: ny socket-handler `apps/backend/src/sockets/adminHallEvents.ts` med `admin:login` (JWT via `getUserFromAccessToken`), `admin:room-ready` (broadcast `admin:hall-event` til room-code + `hall:<id>:display`, countdown clamp 0–300s), `admin:pause-game` / `admin:resume-game` (wrapper på `engine.pauseGame/resumeGame` fra BIN-460 + room:update-emit), `admin:force-end` (wrapper på `engine.endGame` med Lotteritilsynet-audit-log). Per-event ROOM_CONTROL_WRITE-guard, login kan lykkes for ikke-autoriserte men hver event avviser FORBIDDEN. HTTP-paritet: ny `POST /api/admin/rooms/:code/room-ready` for admin-web-bruken. Admin-web Romkontroll-seksjonen har ny "Live hall-kontroll"-panel med 4 knapper + input for countdown/melding/grunn; force-end bekrefter før utførelse. 11 nye tester i `adminHallEvents.test.ts`. G1-rad "Admin hall-events" flyttet ❌ → Backend ✅ / Klient ✅ / Release-klar 🟡. |
| 2026-04-17 | BIN-517 PR | Admin-dashboard levert: ny `ComplianceLedger.generateRangeReport` (multi-day finansiell rapport med per-dag rader + total-sum, 366-dagers cap, cross-date validation) og `generateGameStatistics` (grupper per hallId × gameType med distinct-counts for runder + spillere, gjennomsnittspris per runde). 3 nye admin-ruter: `GET /api/admin/dashboard/live` (live-rom per hall, via `engine.listRoomSummaries`; ROOM_CONTROL_READ), `GET /api/admin/reports/range` + `GET /api/admin/reports/games` (DAILY_REPORT_READ). Admin-web har ny Dashboard-seksjon øverst i menyen med live-rom-kort per hall (auto-oppdater 10s), finansiell range-rapport med enkel SVG-stolpe-graf (innsats vs premier, ingen ekstern chart-lib) + tabell, og per-spill-statistikk-tabell. 5 nye tester i `ComplianceLedger.test.ts`. G1-rad "Admin-dashboard m/ rapporter" flyttet ❌ → Backend ✅ / Klient ✅ / Release-klar 🟡. |
| 2026-04-17 | BIN-532 canceled | Unity-klient permanent avviklet — arkiv-planen droppet. `.github/workflows/unity-build.yml` allerede fjernet av bolk 8 teardown; nå også `docs/operations/UNITY_ARCHIVE_RUNBOOK.md` slettet, Unity-rad fjernet fra matrix, pre-flight Unity-check fjernet fra `RELEASE_GATE.md` §7, rollback-prosedyre i `PILOT_CUTOVER_RUNBOOK.md` §3 endret fra "flip flag → Unity archive" til "git-revert web-client deploy + emergency hall-shutdown (§3b)". Begrunnelse: Unity permanent avviklet, ingen grunn til å holde en arkiv-bundle som koster CDN-plass og blir uvedlikeholdt. `legacy/unity-client/` beholdes i repo som read-only kode-referanse til Fase 5 (BIN-537) sletter den. |
