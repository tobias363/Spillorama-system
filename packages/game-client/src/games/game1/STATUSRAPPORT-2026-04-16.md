# Spill 1 — Komplett statusrapport for prosjektleder

**Dato:** 16. april 2026
**Utarbeidet av:** Claude (AI-assistert utvikler)
**Periode:** 15.–16. april 2026 (2 arbeidsdager)
**Prosjekt:** Migrering av Spill 1 (Databingo) fra Unity WebGL til web-native (PixiJS + TypeScript)

---

## 1. Oppsummering

Over to dager har vi gjort omfattende arbeid med å koble Spill 1 web-native klient til backend og matche Unity-funksjonalitet. Arbeidet har dekket backend-endringer, frontend-arkitektur, lydsystem, animasjoner og dokumentasjon.

**Status: Koden er implementert men ikke fullstendig stabilt testet i produksjonslikt miljø.**

---

## 2. Hva som ble gjort

### Dag 1 (15. april): Grunnarbeid

| Oppgave | Beskrivelse |
|---------|-------------|
| **Server-autoritativ innsats** | Backend beregner `playerStakes` og sender i `room:update`. Klienten viser tallet direkte — ingen klient-side pengeberegning. |
| **armedPlayerIds** | Lagt til i `RoomUpdatePayload` slik at klient vet hvem som har kjøpt bonger. |
| **isArmed + myStake** | Lagt til i `GameState` via `GameBridge`. |
| **StakeCalculator** | Isolert modul med 4 regler for innsatsvisning + 22 tester. |
| **Dobbel armBet-fix** | PlayScreen kalte `socket.armBet` direkte OG controller kalte det — fikset til enveis dataflyt. |
| **600 kr spectator-bug** | `preRoundTickets` ble brukt som kjøpssignal — fikset med `isArmed`-sjekk. |
| **Kjøp-popup redesign** | 3-kolonners grid med +/- per bongtype, gjennomsiktig bakgrunn. |
| **Dokumentasjon** | `logic/README.md` (kritiske faser), `PORTERING-GUIDE.md` (erfaringer). |

### Dag 2 (16. april): Unity-matching + 5 sprinter

| Sprint | Innhold | Commits |
|--------|---------|---------|
| **Sprint 1** | Trekk-kapasitet, ball-farger Databingo60 (5 kolonner à 12), reconnect, display-format (zero-pad), lucky number picker 60 tall | `1fb536c3` |
| **Sprint 2** | One-to-go celle-blink (1.5x/1.0s/elastic), ticket bakgrunns-blink, BINGO pulse (0.85x→1.05x ×5), pattern breathe (1.06x) | `2439f746` |
| **Sprint 3** | Komplett lydsystem: 3 stemmepakker (norsk mann/kvinne, engelsk — 60 clips hver), BINGO-lyd, markerings-lyd, dobbel annonsering, språk-valg | `56606e98` |
| **Sprint 4** | Elvis replace bugfix, alle 4 mini-spill verifisert (WoF, TC, Mystery, Color Draft) | `0eeaf6f0` |
| **Sprint 5** | Nedtelling MM:SS, rad-gevinst farger (Bilde/Ramme/Full Hus), chat slide-resize, pris på kort | `e4e22a06` |
| **Resterende** | Bong-flip animasjon, large ticket variant (52px), dobbel annonsering toggle, host start-knapp, per-hall spillerdata | `e055cf23`, `250ceee7` |
| **Per-type bongkjøp** | Spillere velger spesifikke bongtyper med vektsystem (Small=1, Large=3, Elvis=2) | `93c984ee` |
| **Auto-arm fjernet** | Spillere må eksplisitt kjøpe — ingen automatisk deltakelse | `dc03e24e` |
| **Dev-lobby** | Login med ekte backend-auth, hall-velger, spillkort-valg | `bada91e9` |
| **Spectator countdown-fix** | Countdown vises ikke mens spill kjører (spectator ser siste trukne nummer) | `806ab84c` |

### Totalt volum

- **~20 commits**
- **~60 filer endret**
- **~2500 linjer kode** (ekskludert lydfiler)
- **184 lydfiler** kopiert fra Unity
- **3 dokumentasjonsfiler** (audit, porteringsguide, logic README)
- **66 automatiserte tester** passerer

---

## 3. Kjente problemer og bugs

### 3.1 KRITISK: Trekk-kapasitet var satt til 60, skal være 75

**Status:** Fikset i .env (BINGO_MAX_DRAWS_PER_ROUND=75)

**Bakgrunn:** Databingo bruker 75-balls trekkpose (tradisjonell bingo) selv om bongene kun har tall 1-60. De 15 ekstra tallene (61-75) er "tomme" trekk. Jeg satte feilaktig 60 basert på at bongene bruker 60 tall.

**Konsekvens:** Spill stoppet etter 60 trekk i stedet for 75, noe som betyr at spillere aldri kunne fullføre alle mønstre i noen runder.

### 3.2 HØY: Bonger vises ikke konsistent

**Symptom:** Spilleren kjøper bonger, men de rendres ikke alltid etter at spillet starter.

**Mulige årsaker:**
1. Race condition mellom `onGameStarted` og `room:update` — tickets kan være tomme i den første RUNNING-snapshoten
2. Spilleren armer ETTER at scheduleren har startet spillet — de blir spectator i stedet for deltaker
3. Stale checkpoints fra backend gjenoppretter et gammelt spill

**Trenger:** Grundig debugging i et kontrollert testmiljø der man kan reprodusere konsistent.

### 3.3 HØY: Rate limiting blokkerer testing

**Symptom:** Etter flere raske page-refreshes under debugging, returnerer backend `RATE_LIMITED` på `room:join`. Spilleren kan ikke joine rommet → svart skjerm.

**Workaround:** Restart backend for å nullstille rate-limiter.

**Anbefaling:** Øk rate-limit for dev/test-miljø, eller legg til retry-logikk i klienten.

### 3.4 MEDIUM: Ball-farger bruker Databingo60 kolonner

**Endring gjort:** Ball-farger ble endret fra Bingo75 (15 per kolonne) til Databingo60 (12 per kolonne). Men Unity bruker Bingo75-mapping for TV-display.

**Trenger avklaring:** Skal ball-farger matche Databingo60 (korrekt for tallene) eller Bingo75 (korrekt for Unity TV)?

### 3.5 MEDIUM: Dev-lobby krever manuell innlogging

**Symptom:** Lagret sesjon fra localStorage utløper, passord-felt vises som fylt men er tomt.

**Anbefaling:** Legg til token-refresh logikk, eller auto-login med lagret token.

### 3.6 LAV: Spectator-opplevelse

Spectator (ingen kjøpte bonger) ser:
- Kuler i tube (OK)
- Ingen bonger (korrekt — de har ikke kjøpt)
- "Innsats: —" (korrekt)
- Nedtelling vises IKKE under aktiv runde (fikset)

Men: Buy-popup vises automatisk ved enter, som kan være forvirrende midt i en runde.

---

## 4. Arkitekturbeslutninger tatt

| Beslutning | Begrunnelse | Risiko |
|------------|-------------|--------|
| **Server-autoritativ pengevisning** | Eliminerer hele klassen av synk-bugs. Backend beregner `playerStakes`. | Lav — standard i regulerte systemer |
| **Per-type bongkjøp med vektsystem** | Matcher Unity: Small=1, Large=3, Elvis=2. Max 30 slots. | Medium — ny backend-logikk, trenger E2E-testing |
| **Ingen auto-arm** | Spillere må aktivt velge å kjøpe. Fjernet 2 auto-arm kall. | Lav — matcher Unity-oppførsel |
| **Controller eier nettverket** | PlayScreen signalerer kun intent, controller kaller socket. | Lav — ren arkitektur |
| **Fallback i StakeCalculator** | Server-verdi foretrekkes, klient-beregning som backup. | Lav — kan fjernes etter full utrulling |

---

## 5. Filer opprettet/endret

### Nye filer (15 stk)

| Fil | Formål |
|-----|--------|
| `games/game1/logic/StakeCalculator.ts` | Server-autoritativ innsatsberegning |
| `games/game1/logic/StakeCalculator.test.ts` | 22 tester |
| `games/game1/logic/README.md` | Dokumentasjon: spillfaser, compliance |
| `games/game1/PORTERING-GUIDE.md` | Migrasjonserfaringer for Spill 2/3 |
| `games/game1/AUDIT-RAPPORT.md` | 42-punkts gap-analyse Unity vs web |
| `games/game1/STATUSRAPPORT-2026-04-16.md` | Denne rapporten |
| `public/assets/game1/audio/en/*.ogg` | 60 engelske nummerannounseringer |
| `public/assets/game1/audio/no-male/*.ogg` | 60 norsk mann annunseringer |
| `public/assets/game1/audio/no-female/*.ogg` | 60 norsk kvinne annunseringer |
| `public/assets/game1/audio/sfx/*` | 4 lydeffekter (bingo, mark, click, notification) |
| `index.html` | Dev-lobby med login og spillvelger |

### Endrede backend-filer (8 stk)

| Fil | Endring |
|-----|---------|
| `backend/src/util/roomHelpers.ts` | `playerStakes`, `armedPlayerIds`, `disableBuyAfterBalls`, per-type stake beregning |
| `backend/src/util/roomState.ts` | `TicketSelection[]` per armet spiller |
| `backend/src/util/schedulerSetup.ts` | `armedPlayerSelections` til startGame |
| `backend/src/sockets/gameEvents.ts` | `bet:arm` med `ticketSelections`, vekt-validering |
| `backend/src/game/BingoEngine.ts` | Per-spiller ticket-generering, per-type debitering, `hallId` på Player |
| `backend/src/game/types.ts` | `hallId` på Player |
| `backend/src/index.ts` | Wiring av nye deps |
| `backend/src/sockets/__tests__/testServer.ts` | Test-oppdateringer |

### Endrede frontend-filer (~15 stk)

| Fil | Endring |
|-----|---------|
| `bridge/GameBridge.ts` | `isArmed`, `myStake`, `canStartNow`, `replaceAmount`, `disableBuyAfterBalls`, `hallId`, window guard |
| `bridge/GameBridge.test.ts` | `playerStakes` + `armedPlayerIds` i mock |
| `games/game1/Game1Controller.ts` | handleBuy med selections, reconnect, auto-arm fjernet, audio sync, host start |
| `games/game1/screens/PlayScreen.ts` | TicketGridScroller, CenterBall, stakeFromState, spectator countdown fix, chat resize, price display |
| `games/game1/components/Game1BuyPopup.ts` | 3-kolonne grid, per-type selections, transparent backdrop |
| `games/game1/components/BallTube.ts` | Databingo60 ball-farger |
| `games/game1/components/CalledNumbersOverlay.ts` | Databingo60 farger |
| `games/game1/components/LuckyNumberPicker.ts` | 60 tall (var 75) |
| `games/game1/components/LeftInfoPanel.ts` | MM:SS countdown, zero-pad, per-hall display |
| `games/game1/components/CenterBall.ts` | Zero-pad, stopCountdown |
| `games/game1/components/CenterTopPanel.ts` | Bilde/Ramme/Full Hus, host start-knapp, active/inactive colors |
| `games/game1/components/ChatPanelV2.ts` | Slide-animasjon 0.25s |
| `games/game1/components/SettingsPanel.ts` | Lyd-toggle, gjenta tall-toggle |
| `games/game1/components/PatternMiniGrid.ts` | Breathe 1.06x, 0.5s |
| `audio/AudioManager.ts` | Komplett rewrite: 3 stemmepakker, sekvensert BINGO-lyd, dedup |
| `components/BingoCell.ts` | One-to-go blink 1.5x/1.0s/elastic |
| `games/game2/components/TicketCard.ts` | Bg blink, BINGO pulse, flip, large variant, price |
| `shared-types/src/socket-events.ts` | `TicketSelection`, `playerStakes`, `armedPlayerIds` |
| `shared-types/src/game.ts` | `Player.hallId` |
| `net/SpilloramaSocket.ts` | `ticketSelections` i armBet |
| `games/registry.ts` | `registryReady` promise |
| `core/GameApp.ts` | `await registryReady` |
| `main.ts` | Dev-lobby delegering |

---

## 6. Test-dekning

| Testsuite | Antall | Status |
|-----------|--------|--------|
| StakeCalculator | 22 | ✅ Passerer |
| GameBridge | 17 | ✅ Passerer |
| ClaimDetector | 24 | ✅ Passerer |
| TicketSorter | 5 | ✅ Passerer |
| **Totalt** | **66** | **✅ Alle passerer** |

**Mangler:** E2E-tester, visuell regresjonstesting, ytelsestesting.

---

## 7. Unity-paritet (42 audit-punkter)

Basert på grundig gjennomgang av 14 Unity-filer (~5000 linjer) ble 42 gap identifisert. Alle er adressert i kode. En ytterligere verifikasjon (58 punkter) ble gjort som bekreftet funksjonell komplettenhet.

**Gjenværende usikkerhet:** Visuell 1:1 matching er ikke verifisert i et side-by-side-oppsett med Unity-spillet kjørende. Fargeverdier fra Unity Inspector-data er ikke ekstrahert (de er serialisert i prefab-filer, ikke i C#-kode).

---

## 8. Anbefalinger videre

### Umiddelbart (denne uken)

1. **Fiks trekk-kapasitet til 75** ✅ Gjort i .env
2. **Grundig E2E-test** i kontrollert miljø med 2+ spillere
3. **Verifiser ball-farge-mapping** — avklar om Databingo60 (12 per kolonne) eller Bingo75 (15 per kolonne) er korrekt
4. **Test bongkjøp-flyt** — kjøp → arm → start → trekking → claim → utbetaling
5. **Øk rate-limit i dev-miljø** for å unngå blokkering under testing

### Neste sprint (uke 17)

6. **Spill 2 (Rocket Bingo)** — bruk PORTERING-GUIDE.md for å gjøre samme arbeid
7. **Spill 3 (Mønsterbingo)** — deler mye med Spill 2
8. **Visuell regresjonstesting** — side-by-side med Unity screenshots
9. **Ytelsestesting** — 30 bonger, 75 trekk, 10+ spillere

### Teknisk gjeld

10. **Backend: BINGO75_SLUGS** — `BingoEngine.ts` genererer 75-balls drawBag for "game_1" via `BINGO75_SLUGS`. Dette er korrekt oppførsel men bør dokumenteres.
11. **Frontend: `as const` i tester** — TS-feil med readonly arrays, workaround med eksplisitt typing.
12. **Frontend: Git-workflow** — Lokale endringer gikk tapt flere ganger pga. `git checkout` og manglende commits. Innfør hyppigere commits.

---

## 9. Risikovurdering

| Risiko | Sannsynlighet | Konsekvens | Tiltak |
|--------|---------------|------------|--------|
| Pengeberegning feil | Lav | Kritisk | Server-autoritativ + 22 tester |
| Bongkjøp feiler stille | Medium | Høy | E2E-test med wallet-verifisering |
| Checkpoint-gjenoppretting korrupt | Lav | Høy | Slett checkpoints ved deploy |
| Rate limiting i produksjon | Lav | Medium | Retry-logikk i klient |
| Lydfiler mangler i prod | Medium | Lav | Verifiser asset-deploy pipeline |

---

## 10. Kontaktpunkt

- **Kodebase:** `packages/game-client/src/games/game1/`
- **Backend:** `backend/src/game/BingoEngine.ts`, `backend/src/util/roomHelpers.ts`
- **Dokumentasjon:** `AUDIT-RAPPORT.md`, `PORTERING-GUIDE.md`, `logic/README.md`
- **Tester:** `npx vitest run` fra `packages/game-client/`
- **Dev-lobby:** `http://localhost:5173/web/games/` (krever backend på port 4000)
