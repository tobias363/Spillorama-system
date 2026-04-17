---
game: game3
name: Monster Bingo / Mønsterbingo
slug: monsterbingo
ticketGrid: 5x5
centerCell: free  # Samme som G1
ballRange: [1, 60]
maxDrawsPerRound: 60
ticketTypes:
  - code: standard
    weight: 1
maxTicketWeights: 30
autoArm: false  # Fjernet 2026-04-17 — port fra G1 (commit fra denne PR-en)
patterns:
  - id: line
    name: "Line"
    claimType: LINE
    prizePercent: 30
    order: 1
  - id: bingo
    name: "Full Card"
    claimType: BINGO
    prizePercent: 70
    order: 2
miniGames: []  # Ingen mini-games
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
complianceModel: hall-based
spillvettLimits:
  dailyLoss: 900
  monthlyLoss: 4400
  sessionMs: 3600000
  pauseMs: 300000
  selfExclusionMs: 31536000000
parityStatus: MVP
commitRef: 1efb4c93ae33b3a52c3c9c914008d08fbb6217f6
---

# Game 3 Canonical Spec — Monster Bingo / Mønsterbingo

**Formål:** Frosset spesifikasjon av Game 3 per 2026-04-17. Siste per-spill canonical spec i serien G1/G2/G3/G5.

> **Viktig:** Game 3 er MVP. Animert kulekø fungerer som G3-signatur, men waypoint-bane og mønster-animasjoner gjenstår. Se §11 for avvik.

---

## 1. Identifikasjon

| Felt | Verdi |
|------|-------|
| Navn (NO) | Mønsterbingo (Monster Bingo i kodebase) |
| Backend-slug | `monsterbingo` |
| Frontend-pakke | `packages/game-client/src/games/game3/` |
| Backend-logikk | `apps/backend/src/game/BingoEngine.ts` (delt) |
| Game type | Multiplayer, sanntid, hall-basert (5×5 med animert kulekø) |
| Legacy-referanse | `legacy/unity-backend/Game/Game3/Sockets/game3.js` |

---

## 2. Spillflyt

```
Lobby (spillerliste, nedtelling)
  → Billett-kjøp (auto-arm i MVP)
  → Arming via bet:arm
  → Nedtelling
  → RUNNING (auto-draw)
  → Per draw: kule dropper inn i AnimatedBallQueue
  → LINE-claim
  → BINGO-claim (Full Card)
  → Slutt
```

**Klient-state-maskin** (`Game3Controller.ts:11`): `LOADING` → `LOBBY` → `PLAYING` → `ENDED`. Samme mønster som G2/G5; SPECTATING-fase ikke portet fra G1.

---

## 3. Konfigurerbare verdier

| Parameter | Kilde | Default |
|-----------|-------|---------|
| Ball-range | `BingoEngine.ts:196` (`MAX_BINGO_BALLS_60`) | 1–60 |
| Grid | Backend ticket-generator | 5×5 (25 celler, fri sentercelle) |

G3 har **samme grid som G1** (5×5 med fri sentercelle) men bruker 60-ball range (ikke 75 som G1). Dette er en viktig forskjell: G1 er `BINGO75_SLUGS` (75 baller), G3 er ikke.

---

## 4. Ticket types

Kun `standard` i dag. Ingen per-type varianter (i motsetning til G1 som har Small/Large/Elvis).

---

## 5. Win-patterns

Samme default som G2/G5 (`BingoEngine.ts:142`): LINE (30 %) + Full Card (70 %).

**G3-navnet "Mønsterbingo"** antyder at spillet historisk hadde flere mønstre (derfor navnet "pattern bingo"). Legacy `PrefabBingoGame3Pattern.cs` hadde ping-pong animasjoner for flere mønstre, men dette er ikke portet. Utvidelse til flere patterns er egen oppfølging.

---

## 6. Mini-games

**Game 3 har ingen mini-games.** `miniGames: []` i front-matter. Samme som G2.

---

## 7. Animert kulekø (G3-signatur)

**Port av Unity `BingoNumberBalls` + `BallScript`:**

- Vertikal FIFO-kø, venstre side av skjermen
- Maks 5 synlige kuler
- Nye kuler dropper inn fra toppen med `power2.in` (akselerasjon)
- Skala 1.2× → 1.0× ved ankomst (matcher Unity `highlightScale`)
- Full kø: eldste fader ut, resten skyves ned, ny dropper inn
- Fargekodet etter tallområde (rød/oransje/gull/teal/blå)

**Ikke portet (MVP-begrensninger):**

- **Waypoint-bane** (Unity `BallPathRottate.cs`): Unity lerp'er kule langs waypoints med `speed modifier`. Ny klient bruker enkel vertikal drop. Kan utvides med GSAP-timeline.
- **Pattern-animasjon** (Unity `PrefabBingoGame3Pattern.cs`): ✅ Portet via `components/PatternBanner.ts` — navn på neste un-won pattern vises i banner på toppen av gameplay-området med GSAP `sine.inOut` yoyo-pulse (1.0x ↔ 1.08x, 0.6 s). Cellnivå-preview utsatt (krever `cells`-array i `PatternDefinition`).

`packages/game-client/src/games/game3/components/AnimatedBallQueue.ts` inneholder MVP-logikken.

---

## 8. Socket-kontrakt

Deler basis-kontrakt med G1/G2/G5. G3-unike legacy-events:

| Legacy-event | Status | Merknad |
|--------------|--------|---------|
| `Game3Room` | 🟡 Dekket av generisk `room:join` | — |
| `Game3PlanList` | 🟡 Dekket av hall_game_schedules | — |
| `GetGame3PurchaseData` | 🟡 Dekket av `room:update` gameVariant | — |
| `PurchaseGame3Tickets` | 🟡 Dekket av generisk `bet:arm` | — |
| `CancelGameTickets` / `CancelTicket` | 🟡 Dekket av `bet:arm` med `armed: false` | — |
| `SelectLuckyNumber` | 🟡 Dekket av generisk `lucky-number:select` | — |
| `SendGameChat` / `GameChatHistory` | ✅ Chat portet for G3 (i motsetning til G2/G5) | — |
| `LeftRoom` | 🟡 Dekket av `disconnect` | — |

**G3 har chat aktivt** — det skiller seg fra G2 og G5 som mangler chat. Delt implementasjon med G1.

---

## 9. Checkpoint og recovery

Samme som G1/G2/G5. Shared fra BIN-502 (drawIndex gap-deteksjon) og BIN-500 (loader-barriere er G1-only).

---

## 10. Audio og animasjoner

**Lyd ikke portet.** `audioVoicePacks: []`.

**Animasjoner:**

| Animasjon | Parametre | Utløser |
|-----------|-----------|---------|
| Ball drop (kulekø) | `power2.in`, ~0.4 s | Per `draw:new` |
| Ball highlight | scale 1.2× → 1.0×, 0.2 s | Ved ankomst i kulekø |
| Ball fade-out | opacity 1 → 0, 0.3 s | Eldste i full kø |
| Ticket mark | scale pulse | Standard fra G2 |

---

## 11. Kjente avvik fra legacy

### 11.1 G3-spesifikke avvik

| Legacy-feature | Status i ny stack | Oppfølging |
|----------------|-------------------|------------|
| Animert kulekø (vertikal FIFO) | ✅ MVP implementert | — |
| Waypoint-bane for kule (`BallPathRottate.cs`) | ❌ Enkel vertikal drop i stedet | Egen issue hvis fysikk kreves |
| Pattern-animasjon (`PrefabBingoGame3Pattern.cs`) | ❌ Ping-pong skala ikke portet | Egen issue |
| Multiple win-patterns (utover LINE + BINGO) | ❌ | Egen issue — "Mønsterbingo"-navnet tilsier dette er kjerne |
| Audio / nummerannouncement | ❌ | Egen issue |
| `Game3PlanList` som dedikert socket-event | 🟡 Dekket av hall_game_schedules | OK |

### 11.2 Delte avvik

Samme som G2/G5 — se `PARITY_MATRIX.md` §2.3. Redis, load-test, observability er ✅ takket være fundament-arbeidet.

### 11.3 Avvik mot Game 1

G3 mangler G1-forbedringer: SPECTATING-fase, loader-barriere, eksplisitt kjøp. Port nødvendig for full paritet.

---

## 12. Filer

**Backend (delt):**
- `apps/backend/src/game/BingoEngine.ts`
- `apps/backend/src/sockets/gameEvents.ts`

**Klient (G3-spesifikk):**
- `packages/game-client/src/games/game3/Game3Controller.ts` — `gameSlug: "monsterbingo"`
- `packages/game-client/src/games/game3/screens/PlayScreen.ts` — 5×5 grids + chat + kulekø
- `packages/game-client/src/games/game3/components/AnimatedBallQueue.ts` — G3-signatur-animasjon

**Delt fra G1/G2:**
- `packages/game-client/src/games/game1/components/ChatPanel.ts` (chat delt med G3)
- `packages/game-client/src/games/game2/components/TicketCard.ts`
- `packages/game-client/src/games/game2/screens/LobbyScreen.ts`
- `packages/game-client/src/games/game2/logic/ClaimDetector.ts`

**Legacy:**
- `legacy/unity-backend/Game/Game3/Sockets/game3.js`
- `legacy/unity-client/Assets/_Project/_Scripts/Panels/Game/Game 3/`

---

## 13. Redigerings-policy

Samme som G1/G2/G5. PR som endrer G3-adferd MÅ oppdatere denne filen.

---

## 14. Revisjonshistorikk

| Dato | Commit-ref | Endring |
|------|-----------|---------|
| 2026-04-17 | `1efb4c93` (state ved skriving) | Initial canonical spec per BIN-530. MVP med animert kulekø som G3-signatur. Waypoint-bane, pattern-animasjon og multiple patterns som oppfølgere. Siste i per-spill canonical spec-serien. |
