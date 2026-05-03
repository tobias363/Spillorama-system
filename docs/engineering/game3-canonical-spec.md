---
game: game3
name: Monster Bingo / Mønsterbingo
marketName: "Spill 3 / Mønsterbingo"
slug: monsterbingo
regulatoryCategory: Hovedspill
ticketGrid: 5x5
centerCell: none  # Ingen fri sentercelle (alle 25 cellene er reelle tall)
ballRange: [1, 75]
maxDrawsPerRound: 75
ticketTypes:
  - code: standard
    weight: 1
maxTicketWeights: 30
autoArm: false
patterns:
  - id: row-1
    name: "Row 1"
    claimType: LINE
    prizePercent: 10
    ballNumberThreshold: 15
    order: 1
  - id: row-2
    name: "Row 2"
    claimType: LINE
    prizePercent: 10
    ballNumberThreshold: 25
    order: 2
  - id: row-3
    name: "Row 3"
    claimType: LINE
    prizePercent: 10
    ballNumberThreshold: 40
    order: 3
  - id: row-4
    name: "Row 4"
    claimType: LINE
    prizePercent: 10
    ballNumberThreshold: 55
    order: 4
  - id: full-house
    name: "Full House"
    claimType: BINGO
    prizePercent: 60
    order: 5
miniGames: []  # Ingen mini-games — Spill 3 er rent mønsterspill
audioVoicePacks: []  # Ikke portet
features:
  chat: true  # G3 har chat (delt fra G1)
  doubleAnnounce: false
  luckyNumber: true
  ticketReplace: false
  hallDisplayBroadcast: false
  animatedBallQueue: true  # G3-signatur: vertikal FIFO-kø
  waypointBallPath: false  # Unity BallPathRottate.cs ikke portet
  patternAnimation: false  # Ping-pong skala ikke portet
  perpetualLoop: true  # Aldri stopper — utbetal → ny runde automatisk
  globalRoom: true  # ETT globalt rom (MONSTERBINGO), ingen group-of-halls
complianceModel: hall-based
spillvettLimits:
  dailyLoss: 900
  monthlyLoss: 4400
  sessionMs: 3600000
  pauseMs: 300000
  selfExclusionMs: 31536000000
parityStatus: MVP
revisionDate: 2026-05-03
---

# Game 3 Canonical Spec — Monster Bingo / Mønsterbingo

**Formål:** Frosset spesifikasjon av Game 3 per **2026-05-03** (Tobias-direktiv:
revert til 5×5 / 1..75 etter kortvarig 3×3-port i PR #860).

> **Viktig:** Spill 3 er **funksjonelt og visuelt likt Spill 1** — samme
> 5×5-bonger uten free-center, samme 75 baller, samme Row 1-4 + Coverall-
> patterns, samme draw-mekanikk. Den **eneste** strukturelle forskjellen er at
> Spill 3 har KUN ÉN ticket-type ("Standard"), mens Spill 1 har 8 farger.
>
> Per Tobias 2026-05-03 (revert-direktiv):
> > "75 baller og 5x5 bonger uten free i midten. Du kan duplisere spill 1 så
> > kan vi endre når det er gjort. Alt av design skal være likt bare at her er
> > det kun 1 type bonger og man spiller om mønstre. Logikken med å trekke
> > baller og markere bonger er fortsatt helt lik."

---

## 1. Identifikasjon

| Felt | Verdi |
|------|-------|
| Markedsføringsnavn | Spill 3 / Mønsterbingo |
| Backend-slug | `monsterbingo` (også `mønsterbingo`, `game_3`) |
| Frontend-pakke | `packages/game-client/src/games/game3/` |
| Backend-logikk | `apps/backend/src/game/Game3Engine.ts` (subklasse av BingoEngine) |
| Game type | Multiplayer, sanntid, ETT globalt rom (`MONSTERBINGO`) |
| Regulatorisk kategori | Hovedspill (15 % til organisasjoner) |
| Legacy-referanse | `legacy/unity-backend/Game/Game3/Sockets/game3.js` |

---

## 2. Spillflyt

```
Lobby (spillerliste)
  → Billett-kjøp (eksplisitt via BuyPopup — kun "Standard"-type)
  → Arming via bet:arm
  → RUNNING (auto-draw)
  → Per draw: kule dropper inn i AnimatedBallQueue
  → Pattern-cycler evaluerer Row 1-4 etter ball-thresholds (15/25/40/55)
  → Auto-claim utløses når en spillers brett matcher aktivt pattern
  → Coverall lander på en spillers brett
    → Auto-claim + payout
    → Round ENDED med G3_FULL_HOUSE
    → PerpetualRoundService scheduler ny runde automatisk (default 5s delay)
```

**Klient-state-maskin** (`Game3Controller.ts`): `LOADING` → `LOBBY` →
`PLAYING` (eller `SPECTATING`) → `ENDED`.

**Per Tobias 2026-05-03:**
> "Spill 2 og 3 har ETT globalt rom. Ingen group-of-halls, ingen master/start/
> stop. Aldri stopper — utbetal gevinst → fortsetter automatisk."

---

## 3. Konfigurerbare verdier

| Parameter | Kilde | Default |
|-----------|-------|---------|
| Ball-range | `DEFAULT_GAME3_CONFIG.maxBallValue` | 1–75 |
| Drawbag-size | `DEFAULT_GAME3_CONFIG.drawBagSize` | 75 |
| Grid | Backend ticket-generator (`generate5x5NoCenterTicket`) | 5×5 (25 celler) |
| Row 1-4 prosent | `variantConfig.patterns[i].prizePercent` | 10 % hver |
| Coverall-prosent | `variantConfig.patterns[4].prizePercent` | 60 % av pool |
| Row 1-4 ball-thresholds | `variantConfig.patterns[i].ballNumberThreshold` | 15 / 25 / 40 / 55 |
| Lucky-bonus | `variantConfig.luckyNumberPrize` | 0 (deaktivert) |

---

## 4. Ticket types

**Kun `Standard` (én type).** Ingen per-type varianter (i motsetning til Spill 1
som har 8 farger). Dette er den **eneste** strukturelle forskjellen mellom
Spill 1 og Spill 3.

```typescript
ticketTypes: [
  { name: "Standard", type: "monsterbingo-5x5", priceMultiplier: 1, ticketCount: 1 },
]
```

Ticket-format: 5×5 grid, 25 unike tall fordelt per BINGO-kolonne (B:1-15,
I:16-30, N:31-45, G:46-60, O:61-75). **Ingen fri sentercelle** —
(2,2)-cellen holder et reelt N-kolonne-tall.

---

## 5. Win-patterns

5 patterns, identisk med Spill 1's struktur men med ett mindre ticket-type-
oppslag (siden alle Spill 3-bonger har samme prosent):

| Pattern | claimType | prizePercent | ballNumberThreshold |
|---------|-----------|--------------|---------------------|
| Row 1 | LINE | 10 % | 15 |
| Row 2 | LINE | 10 % | 25 |
| Row 3 | LINE | 10 % | 40 |
| Row 4 | LINE | 10 % | 55 |
| Full House (Coverall) | BINGO | 60 % | — (ingen threshold) |

`PatternCycler` (`apps/backend/src/game/PatternCycler.ts`) håndterer aktivering
og deaktivering basert på ball-thresholds — samme infrastruktur som ble
introdusert i BIN-615 / PR-C3b for den opprinnelige 5×5-Spill 3.

`patternEvalMode: "auto-claim-on-draw"` — engine evaluerer alle aktive patterns
etter hver draw og auto-utløser claim for vinnere uten at spilleren trenger å
trykke "Bingo!".

---

## 6. Mini-games

**Game 3 har ingen mini-games.** `miniGames: []` i front-matter. Forskjell fra
Spill 1 som har Wheel of Fortune / Treasure Chest / Mystery / ColorDraft.

---

## 7. Animert kulekø (Spill 1-stil)

Beholdt fra forrige spec — er G3's signatur og passer modellen:

- Vertikal FIFO-kø, venstre side av skjermen
- Maks 5 synlige kuler
- Nye kuler dropper inn fra toppen med `power2.in` (akselerasjon)
- Skala 1.2× → 1.0× ved ankomst (matcher Unity `highlightScale`)
- Full kø: eldste fader ut, resten skyves ned, ny dropper inn
- Fargekodet etter BINGO-kolonne (B/I/N/G/O)

---

## 8. Socket-kontrakt

Identisk wire-shape som forrige Spill 3-implementasjon:

| Event | Innhold |
|-------|---------|
| `g3:pattern:changed` | `activePatterns` med Row 1-4 + Coverall basert på ball-thresholds |
| `g3:pattern:auto-won` | `patternName` (Row 1/2/3/4/Full House), `isFullHouse`, `pricePerWinner` |
| `room:state` | `currentGame.tickets` er 5×5 grids uten free-center |

---

## 9. Checkpoint og recovery

Samme som G1/G2/G5. Shared infrastruktur fra BIN-502.

---

## 10. Audio og animasjoner

**Lyd ikke portet.** `audioVoicePacks: []`.

**Animasjoner:**

| Animasjon | Parametre | Utløser |
|-----------|-----------|---------|
| Ball drop (kulekø) | `power2.in`, ~0.4 s | Per `draw:new` |
| Ball highlight | scale 1.2× → 1.0×, 0.2 s | Ved ankomst i kulekø |
| Ball fade-out | opacity 1 → 0, 0.3 s | Eldste i full kø |
| Ticket mark | scale pulse | Standard fra G1 |

---

## 11. Kjente avvik fra Spill 1

### 11.1 Bevisste valg (Tobias-direktiv 2026-05-03)

| Feature | Spill 1 | Spill 3 |
|---------|---------|---------|
| Ticket-typer | 8 farger (Small/Large × Yellow/White/Purple etc.) | **1 type** ("Standard") |
| Mini-games | Wheel/Chest/Mystery/ColorDraft (rotasjon) | **Ingen** |
| Master/start/stop | Ja (master-rolle, group-of-halls) | **Nei** (ETT globalt rom) |
| Schedule-håndtering | Ja (per hall-vindu) | **Nei** (alltid på, perpetual loop) |
| Free centre cell | Ja (sentercelle = 0) | **Nei** (alle 25 celler er tall) |
| Ball-range | 1–75 | 1–75 (likt) |
| Patterns Row 1-4 + Coverall | Ja | Ja (likt) |
| Auto-claim på draw | Ja (BIN-694) | Ja (likt) |
| Chat-panel | Ja | Ja (likt, delt komponent) |
| Animated ball queue | Ja | Ja (G3-signatur, lik Spill 1) |
| Perpetual loop | Nei | **Ja** (PerpetualRoundService) |

### 11.2 Perpetual loop

- Implementert via `PerpetualRoundService`
  (`apps/backend/src/game/PerpetualRoundService.ts`) — wired på
  `bingoAdapter.onGameEnded` i `index.ts`.
- Default delay 5 sek mellom Coverall og ny runde.
- Env-flagg: `PERPETUAL_LOOP_ENABLED` / `PERPETUAL_LOOP_DELAY_MS` /
  `PERPETUAL_LOOP_DISABLED_SLUGS`.
- Spawner første runde via `spawnFirstRoundIfNeeded()` ved første
  `room:join` (PR #868).

### 11.3 Beholdt fra Spill 1-paritet

- AnimatedBallQueue (G3-signatur, beholdt)
- Chat-panel (delt med Spill 1)
- Pattern-banner som visuell indikator
- 5×5-grid + 75-ball-mekanikk
- Row 1-4 + Coverall

---

## 12. Filer

**Backend:**
- `apps/backend/src/game/Game3Engine.ts` — subklasse av BingoEngine, pattern-cycler
- `apps/backend/src/game/variantConfig.ts` — `DEFAULT_GAME3_CONFIG` (5×5 / 1..75 / 5 patterns / 1 ticket-type)
- `apps/backend/src/game/ticket.ts` — `generate5x5NoCenterTicket`,
  `uses5x5NoCenterTicket` (matcher Spill 3-slugs)
- `apps/backend/src/game/PatternCycler.ts` — pattern aktivering/deaktivering
  basert på ball-thresholds (delt med BingoEngine)
- `apps/backend/src/game/PerpetualRoundService.ts` — auto-restart etter Coverall
- `apps/backend/src/game/ledgerGameTypeForSlug.ts` — Spill 3 → MAIN_GAME (15 %)

**Klient (Spill 3-spesifikk):**
- `packages/game-client/src/games/game3/Game3Controller.ts` — `gameSlug: "monsterbingo"`
- `packages/game-client/src/games/game3/screens/PlayScreen.ts` — 5×5 grids + chat + kulekø
- `packages/game-client/src/games/game3/components/AnimatedBallQueue.ts` — G3-signatur
- `packages/game-client/src/games/game3/components/PatternBanner.ts` — pattern-banner

**Delt fra Spill 1:**
- `packages/game-client/src/components/ChatPanel.ts` (chat — delt med Spill 1)
- `packages/game-client/src/games/game1/components/TicketCard.ts` (gridSize="5x5")
- `packages/game-client/src/games/game1/screens/LobbyScreen.ts` (lobby-stil)

---

## 13. Redigerings-policy

PR som endrer G3-adferd MÅ oppdatere denne filen.

---

## 14. Revisjonshistorikk

| Dato | Endring |
|------|---------|
| 2026-04-17 | Initial canonical spec (BIN-530). 5×5 / 1..75 / Row 1-4 + Coverall, MVP med animert kulekø som G3-signatur. |
| 2026-05-03 | PR #860: kortvarig portet til 3×3 / 1..21 / Coverall-only (hybrid Spill 2-runtime + Spill 1-stil). |
| 2026-05-03 | **Revertert** per Tobias-direktiv tilbake til 5×5 / 1..75 / Row 1-4 + Coverall, men med kun 1 ticket-type ("Standard"). Perpetual loop fra PR #863 + #868 bevart. |
