---
game: game3
name: Monster Bingo / Mønsterbingo
marketName: "Spill 3 / Mønsterbingo"
slug: monsterbingo
regulatoryCategory: Hovedspill
ticketGrid: 3x3
centerCell: none  # Ingen fri sentercelle (kun 9 reelle tall i [1, 21])
ballRange: [1, 21]
maxDrawsPerRound: 21
ticketTypes:
  - code: standard
    weight: 1
maxTicketWeights: 30
autoArm: false
patterns:
  - id: coverall
    name: "Coverall"
    claimType: BINGO
    prizePercent: 80
    order: 1
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
3×3-port). Erstatter forrige versjon fra 2026-04-17 som spesifiserte 5×5 / 1..75.

> **Viktig:** Spill 3 er en **hybrid** av Spill 2's runtime (3×3 / 1..21 / full-
> bong-vinner) og Spill 1's visuelle stil (ball queue, chat, banner). Per Tobias:
> "Det skal være 3x3 bonger" + "ball-range likt som Spill 2" (= 1-21).

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
  → Billett-kjøp (eksplisitt via BuyPopup)
  → Arming via bet:arm
  → RUNNING (auto-draw)
  → Per draw: kule dropper inn i AnimatedBallQueue
  → Coverall lander på en spillers brett
    → Auto-claim + payout
    → Round ENDED med G3_FULL_HOUSE
    → (Perpetual restart håndteres av scheduler — scope-cut for nåværende PR)
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
| Ball-range | `DEFAULT_GAME3_CONFIG.maxBallValue` | 1–21 |
| Drawbag-size | `DEFAULT_GAME3_CONFIG.drawBagSize` | 21 |
| Grid | Backend ticket-generator (`generate3x3Ticket`) | 3×3 (9 celler) |
| Coverall-prosent | `variantConfig.patterns[0].prizePercent` (eller default) | 80 % av pool |
| Lucky-bonus | `variantConfig.luckyNumberPrize` | 0 (deaktivert) |

---

## 4. Ticket types

Kun `Standard` (én type). Ingen per-type varianter (i motsetning til Spill 1
som har 8 farger).

```typescript
ticketTypes: [
  { name: "Standard", type: "game3-3x3", priceMultiplier: 1, ticketCount: 1 },
]
```

---

## 5. Win-patterns

**KUN Coverall** (full 3×3-bong, alle 9 celler matchet). Ingen Row 1-4 eller
delvise patterns. Ingen mini-games.

```typescript
patterns: []  // Tom — Game3Engine evaluerer Coverall direkte via hasFull3x3()
```

Engine-laget bruker `hasFull3x3(ticket, drawnSet)` som vinner-predicate
(samme funksjon som Spill 2). Premie-prosent default 80 % av pool — kan
overstyres via admin-konfig.

---

## 6. Mini-games

**Game 3 har ingen mini-games.** `miniGames: []` i front-matter. Samme som
Spill 2.

---

## 7. Animert kulekø (Spill 1-stil)

Beholdt fra forrige spec — er G3's signatur og passer hybrid-modellen.

- Vertikal FIFO-kø, venstre side av skjermen
- Maks 5 synlige kuler
- Nye kuler dropper inn fra toppen med `power2.in` (akselerasjon)
- Skala 1.2× → 1.0× ved ankomst (matcher Unity `highlightScale`)
- Full kø: eldste fader ut, resten skyves ned, ny dropper inn
- Fargekodet etter tallområde — for 1..21 fordeles fargene over hele rangen

---

## 8. Socket-kontrakt

Identisk wire-shape som forrige Spill 3-implementasjon for bakoverkompat.
Endringer i payload-innhold:

| Event | Nytt innhold |
|-------|---------------|
| `g3:pattern:changed` | `activePatterns` har KUN Coverall (singleton) |
| `g3:pattern:auto-won` | `patternName: "Coverall"`, `isFullHouse: true` |
| `room:state` | `currentGame.tickets` er 3×3 grids |

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
| Ticket mark | scale pulse | Standard fra G2 |

---

## 11. Kjente avvik fra legacy

### 11.1 Bevisste valg (Tobias-direktiv 2026-05-03)

| Legacy-feature | Status i ny stack | Begrunnelse |
|----------------|-------------------|-------------|
| 5×5 / 1..75-bonger | ❌ Erstattet med 3×3 / 1..21 | Tobias: "Det skal være 3x3 bonger" |
| Row 1-4 patterns | ❌ Fjernet — kun Coverall | Tobias: "alt med trekning og visning av bonger er likt" som Spill 2 |
| Master/start/stop | ❌ Fjernet | Tobias: "ETT globalt rom" |
| Group of halls | ❌ Fjernet | Tobias: "Ingen group-of-halls" |
| Pattern-cycler-engine | ❌ Erstattet med full-bong-predicate | Forenkling — passer perpetual-loop-modell |

### 11.2 Scope-cuts for nåværende PR

| Feature | Status | Plan |
|---------|--------|------|
| Perpetual loop (auto-restart etter Coverall) | 🟡 Engine signaliserer ENDED + endedReason="G3_FULL_HOUSE", men auto-restart-tikk er ikke implementert | Egen oppfølger — krever scheduler eller cron-tick som triggerer ny `startGame` |
| Schedule-håndtering | 🟡 Spill 3 antas å være "alltid på" — ingen schedule-restriksjon | Egen oppfølger hvis Tobias trenger schedule-vinduer |
| Visuell pixel-paritet med Spill 1 | 🟡 Bruker Spill 1-komponenter, men ikke alle (mini-grid, full pattern-display, etc.) | Iterativ polish post-pilot |

### 11.3 Beholdt fra Spill 1-paritet

- AnimatedBallQueue (G3-signatur, beholdt fra forrige spec)
- Chat-panel (delt med Spill 1)
- Pattern-banner-konsept (nå singleton Coverall)

---

## 12. Filer

**Backend:**
- `apps/backend/src/game/Game3Engine.ts` — subklasse av BingoEngine, full-3×3-detection
- `apps/backend/src/game/variantConfig.ts` — `DEFAULT_GAME3_CONFIG` (3×3 / 1..21)
- `apps/backend/src/game/ticket.ts` — `generate3x3Ticket` (delt med Spill 2),
  `uses3x3Ticket` (matcher BÅDE G2 og G3)
- `apps/backend/src/game/ledgerGameTypeForSlug.ts` — Spill 3 → MAIN_GAME (15 %)

**Klient (Spill 3-spesifikk):**
- `packages/game-client/src/games/game3/Game3Controller.ts` — `gameSlug: "monsterbingo"`
- `packages/game-client/src/games/game3/screens/PlayScreen.ts` — 3×3 grids + chat + kulekø
- `packages/game-client/src/games/game3/components/AnimatedBallQueue.ts` — G3-signatur
- `packages/game-client/src/games/game3/components/PatternBanner.ts` — Coverall-banner

**Delt fra Spill 1/Spill 2:**
- `packages/game-client/src/components/ChatPanel.ts` (chat — delt med Spill 1)
- `packages/game-client/src/games/game2/components/TicketCard.ts` (gridSize="3x3")
- `packages/game-client/src/games/game2/screens/LobbyScreen.ts`
- `packages/game-client/src/games/game2/screens/EndScreen.ts`
- `packages/game-client/src/games/game2/logic/ClaimDetector.ts`

---

## 13. Redigerings-policy

PR som endrer G3-adferd MÅ oppdatere denne filen.

---

## 14. Revisjonshistorikk

| Dato | Endring |
|------|---------|
| 2026-04-17 | Initial canonical spec (BIN-530). 5×5 / 1..75 / Row 1-4 + Coverall, MVP med animert kulekø som G3-signatur. |
| 2026-05-03 | **Rewrite per Tobias-direktiv**: 3×3 / 1..21 hybrid (Spill 2-runtime + Spill 1-stil). Fjernet Row 1-4 patterns, master/start/stop, group-of-halls. Coverall som eneste vinner-pattern. ETT globalt rom. Perpetual loop-fundament (auto-restart-tikk er scope-cut). |
