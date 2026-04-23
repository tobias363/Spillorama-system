---
game: game1
name: Hovedspill (Classic Bingo)
slug: bingo
altSlug: game_1
ticketGrid: 5x5
centerCell: free
ballRange: [1, 75]
maxDrawsPerRound: 75
ticketTypes:
  - code: small-yellow
    weight: 1
  - code: small-white
    weight: 1
  - code: small-red
    weight: 1
  - code: large-white
    weight: 3
  - code: elvis
    weight: 2
  - code: trafficLight
    weight: 3
maxTicketWeights: 30
autoArm: false
patterns:
  - id: 1-rad
    name: "1 Rad"
    claimType: LINE
    prizePercent: 30
    order: 1
  - id: full-plate
    name: "Full Plate"
    claimType: BINGO
    prizePercent: 70
    order: 2
miniGames:
  - wheelOfFortune
  - treasureChest
  - mysteryGame   # BIN-505 — backend rotation active; client UI via MysteryGameOverlay
  - colorDraft    # BIN-506 — backend rotation active; client UI via ColorDraftOverlay
miniGameRotation: round-robin  # wheel → chest → mystery → colorDraft → wheel …
audioVoicePacks:
  - no-male
  - no-female
  - en
audioClipsPerPack: 60
features:
  chat: true
  doubleAnnounce: toggle
  luckyNumber: true
  ticketReplace: true  # Elvis replace — BIN-509 improvement pending
  hallDisplayBroadcast: false  # BIN-498 port pending
complianceModel: hall-based
spillvettLimits:
  dailyLoss: 900
  monthlyLoss: 4400
  sessionMs: 3600000
  pauseMs: 300000
  selfExclusionMs: 31536000000
commitRef: d78ea214c7693e5f3181cef807cfcc85a65f347b
---

# Game 1 Canonical Spec — Hovedspill (Classic Bingo)

**Formål:** Frosset spesifikasjon av Game 1 sin faktiske oppførsel i `apps/backend/` + `packages/game-client/` per 2026-04-17. Brukes som referansepunkt for paritet-arbeid (BIN-525 parity matrix) og som mal for Game 2/3/5 canonical specs (BIN-529/530/531).

> **Autoritativ sannhets-kilde.** Ved uenighet mellom denne filen, README-filer per spill, og kode: kode vinner → oppdater denne filen. Se §Redigerings-policy under.

---

## 1. Identifikasjon

| Felt | Verdi |
|------|-------|
| Navn (NO) | Hovedspill (Classic Bingo) |
| Backend-slug | `bingo` (og legacy-alias `game_1`) |
| Frontend-pakke | `packages/game-client/src/games/game1/` |
| Backend-logikk | `apps/backend/src/game/BingoEngine.ts` (delt med andre varianter) |
| Game type | Multiplayer, sanntid, hall-basert |
| Legacy-referanse | `legacy/unity-backend/Game/Game1/Sockets/game1.js` |

---

## 2. Spillflyt

```
Lobby (spillerliste, nedtelling)
  → Billett-kjøp (per-type valg, server-autoritativ stake)
  → Arming (bet:arm med TicketSelection[])
  → Nedtelling MM:SS (backend-schedulert)
  → RUNNING (auto-draw eller host-start)
  → Trekning (drawIndex 0..74)
  → LINE-claim (1 Rad — første spiller som får rad)
  → BINGO-claim (Full Plate — første spiller som får alle)
  → Mini-game (wheel/chest, server-trigger)
  → Slutt (resultat, utbetaling, auto-loop til Lobby)
```

**Klient-state-maskin** (`Game1Controller.ts:22`):
- `LOADING` → (snapshot + syncReady via BIN-500) → `WAITING` / `PLAYING` / `SPECTATING` avhengig av `gameStatus` og `myTickets.length`
- `WAITING`: ingen aktiv runde — countdown mot neste, buy-popup tilgjengelig
- `PLAYING`: aktiv runde, spilleren har billetter
- `SPECTATING` (BIN-507 levert): aktiv runde, spilleren har 0 billetter. Ser live trekning + chat + patterns. Kan kjøpe for neste runde via buy-popup. Overgang til `PLAYING` ved neste `onGameStarted` hvis spilleren armet `preRoundTickets`.
- `ENDED`: resultater vises, auto-dismiss til `WAITING` etter 5 sek

---

## 3. Konfigurerbare verdier

| Parameter | Kilde | Default | Gyldig range |
|-----------|-------|---------|--------------|
| Ball-range | `apps/backend/src/game/BingoEngine.ts:196` (`MAX_BINGO_BALLS_75`) | 1–75 | 1–75 |
| `maxDrawsPerRound` | `apps/backend/src/util/envConfig.ts:59` | 30 (clampet `Math.min(60, …)` — **BUG per [BIN-520](https://linear.app/bingosystem/issue/BIN-520)**, skal være 75) | 1–75 |
| `maxTicketWeights` | Backend arm-validering | 30 | 1–30 |
| Mini-round-interval | `envConfig.ts:53` | 30 000 ms | ≥ 30 000 |
| Daglig tapsgrense | `envConfig.ts:54` | 900 NOK | ≥ 0 |
| Månedlig tapsgrense | `envConfig.ts:55` | 4 400 NOK | ≥ 0 |
| Sesjonsgrense | `envConfig.ts:56` | 60 min | ≥ 0 |
| Selv-utelukkelse min | `envConfig.ts:58` | 365 dager | ≥ 365 dager (hardkodet min) |
| Payout-prosent | `envConfig.ts:85` | 80 % | 0–100 % |
| Auto-play produksjon | `envConfig.ts:64` | false (må eksplisitt aktiveres) | bool |
| Checkpoint | `envConfig.ts:96` | true (hvis DB er satt) | bool |

---

## 4. Ticket types og vekt-system

Kundens kjøp sendes som `TicketSelection[]` i `bet:arm`:

```ts
interface TicketSelection {
  type: string;   // kode, se tabell under
  qty: number;
}
```

Backend genererer billetter per type. Vekt-systemet begrenser total valgt volum (`sum(qty * weight) ≤ 30`):

| Type-kode | Beskrivelse | Vekt | Pris-multiplikator |
|-----------|-------------|------|--------------------|
| `small-yellow` | Gul bakgrunn, 5×5-grid | 1 | entryFee × 1 |
| `small-white` | Hvit bakgrunn, 5×5-grid | 1 | entryFee × 1 |
| `small-red` | Rød bakgrunn, 5×5-grid | 1 | entryFee × 1 |
| `large-white` | Stor cellestørrelse (52 px vs 44 px), 5×5-grid | 3 | entryFee × 3 |
| `elvis` | Dobbelt-kort: to billetter som deler samme claim; bytting mulig midt i kjøp | 2 | entryFee × 2 |
| `trafficLight` | Tre billetter gruppert | 3 | entryFee × 3 |

**Ingen auto-arm.** Spiller må klikke "Kjøp" i pop-up for hver runde. Auto-arm ble fjernet 2026-04-16 (`Game1Controller.ts:156`, commit `dc03e24e`).

---

## 5. Win-patterns

Default i `BingoEngine.ts:142`:

| Pattern | Claim-type | Prize % | Order | Design-ref |
|---------|-----------|---------|-------|-----------|
| `1-rad` ("1 Rad") | `LINE` | 30 | 1 | 1 |
| `full-plate` ("Full Plate") | `BINGO` | 70 | 2 | 2 |

**Flere mønstre (bilde, ramme, etc.)** finnes som UI-visning i `PatternMiniGrid.ts` men er ikke aktive claim-regler. Utvidelse hører til paritet-arbeid per [BIN-525](https://linear.app/bingosystem/issue/BIN-525) og [BIN-528](https://linear.app/bingosystem/issue/BIN-528)-oppfølgere.

**Claim er server-autoritativ.** Klient deteksjon (`ClaimDetector.ts`) er kun for UI-knapp-state. Server validerer via `PatternValidator`.

---

## 6. Mini-games

Server-trigget etter BINGO-claim. `BingoEngine.ts:1297` alternerer:

```
drawIndex 0 (first BINGO)  → wheelOfFortune
drawIndex 1 (second BINGO) → treasureChest
drawIndex 2                → mysteryGame
drawIndex 3                → colorDraft
drawIndex 4                → wheelOfFortune (wraps)
...
```

**4-veis rotasjon aktiv (backend).** Wheel → Chest → Mystery → ColorDraft, implementert i `BingoEngine.MINIGAME_ROTATION` ([BIN-505](https://linear.app/bingosystem/issue/BIN-505) + [BIN-506](https://linear.app/bingosystem/issue/BIN-506)). Klient-UI finnes som stubs (`MysteryGameOverlay.ts`, `ColorDraftOverlay.ts`); full klient-integrasjon spores som egne oppfølgings-issuer.

**Wheel of Fortune:** 8 segmenter, default prize-tabell i `BingoEngine.ts:1282` (`MINIGAME_PRIZES`). GSAP `rotateZ`-animasjon. Spiller klikker "spin", server velger segment deterministisk.

**Treasure Chest:** N kister, spiller klikker, server velger prize. Visning: sprite-swap + GSAP scale.

**Mystery Game:** Ball-picker. 8 balls som vises hemmelig; spiller velger én, server avslører prize. Samme `minigame:play { selectedIndex }`-kontrakt som Treasure Chest.

**Color Draft:** Color-pick variant. Spiller velger én av flere fargeknapper, server avslører prize. Samme `minigame:play`-kontrakt.

**Prize-konfigurasjon:** Alle fire typer bruker `MINIGAME_PRIZES` per-default. Admin-konfigurerbar prize-tabell per mini-game-type er en oppfølgende issue — legacy leste fra `otherGame`-collection, hvilket skal porters når Admin-panelet får support.

---

## 7. Audio

`AudioManager.ts`:
- 3 stemmepakker: `no-male`, `no-female`, `en`
- 60 nummerannouncement-clips per pakke
- 4 SFX: `bingo`, `mark`, `click`, `notification`
- Double-announce toggle (gjentar tall én gang)
- Per-runde dedup (samme tall ikke spilles to ganger selv ved resync)
- Mobile unlock via user-gesture ved spillstart

Filer i `packages/game-client/public/assets/game1/audio/`.

---

## 8. Billettrendering og animasjoner

Alle animasjoner bruker **GSAP** (lisens-TBD per [BIN-538](https://linear.app/bingosystem/issue/BIN-538)):

| Animasjon | Parametre | Utløser |
|-----------|-----------|---------|
| One-to-go celle-blink | scale 1.5×, 1.0 s, `elastic.out` | Celle trenger 1 til for claim |
| Billett-bakgrunn-blink | Oscillering normal/0xFFE83D, 0.5 s per fase | Samme (bakgrunn-variant) |
| BINGO pulse | scale 0.85×→1.05×, 0.25 s per fase, 5 reps | BINGO-claim |
| Pattern breathe | scale 1.06×, 0.5 s, `easeInOutSine` | Aktivt pattern |
| Ticket flip | `scaleX 1→0→1`, 0.5 s total, auto-flip tilbake etter 3 s | Tap på billett |
| Chat slide | width 0.25 s | Chat toggle |

---

## 9. Socket-kontrakt

**Client → Server:**

| Event | Payload |
|-------|---------|
| `room:create` / `room:join` | `{ roomCode, playerName?, hallId? }` |
| `bet:arm` | `{ armed, ticketSelections: TicketSelection[] }` |
| `bet:disarm` | `{}` |
| `ticket:mark` | `{ number }` (planlagt slim per [BIN-499](https://linear.app/bingosystem/issue/BIN-499)) |
| `ticket:replace` | `{ ticketId }` (planlagt per [BIN-509](https://linear.app/bingosystem/issue/BIN-509)) |
| `claim:submit` | `{ type: "LINE" \| "BINGO" }` |
| `lucky-number:select` | `{ luckyNumber }` |
| `minigame:play` | `{ type, selectedIndex? }` |
| `chat:send` | `{ message, emojiId? }` |
| `start-game` | `{}` (host/manual start) |

**Server → Client:**

| Event | Payload |
|-------|---------|
| `room:update` | `RoomUpdatePayload` (se `socket-events.ts:119`) |
| `draw:new` | `{ number, drawIndex, gameId }` |
| `pattern:won` | `{ patternId, patternName, winnerId, wonAtDraw }` |
| `minigame:activated` | `{ type, roundId, prizeSegments? }` |
| `minigame:result` | `{ type, prize, detail }` |
| `chat:message` | `{ senderId, senderName, message, ts }` |
| `wallet:balance` | `{ balance }` |
| `error` | `{ code, message }` |

Full liste i `packages/shared-types/src/socket-events.ts`.

---

## 10. Checkpoint og recovery

- Persist ved hver draw når `BINGO_CHECKPOINT_ENABLED=true` (default)
- Backend lagrer rom-state + ledger i `apps/backend/store/` (Postgres-adapter)
- Ved server-restart: recovery fra checkpoint, rom gjenopptas
- Klient-reconnect: backend sender fresh `room:update` + draws fra snapshot
- Event-buffer for klient-late-join: [BIN-501](https://linear.app/bingosystem/issue/BIN-501) (ikke levert)

---

## 11. Compliance

- **Hall-basert Spillvett** (ikke player-basert): tapsgrenser, pause og self-exclusion per hall
- **Fail-closed**: DB-feil → spiller blokkeres fra nye runder
- **KYC**: ikke påkrevd for Game 1 i dag (påkrevd kun for G4/G5 — [BIN-514](https://linear.app/bingosystem/issue/BIN-514))
- **Server-autoritativ** claim-validering, stake-beregning, draw-rekkefølge
- **Audit-spor**: `apps/backend/src/compliance/` skriver ledger-entries (se [BIN-526](https://linear.app/bingosystem/issue/BIN-526) for E2E-test)

---

## 12. Kjente avvik fra legacy

Referanse: `legacy/unity-backend/Game/Game1/Sockets/game1.js`

| Legacy-feature | Status i ny stack | Issue |
|----------------|-------------------|-------|
| `AdminHallDisplayLogin` / `TvscreenUrlForPlayers` | ❌ Mangler | [BIN-498](https://linear.app/bingosystem/issue/BIN-498) |
| `SelectMystery` (mini-game) | 🟡 Backend i main (4-veis rotasjon aktiv); klient-UI gjennom `minigame:play { selectedIndex }` er stub (`MysteryGameOverlay`) — full klient-integrasjon i oppfølgings-issue | [BIN-505](https://linear.app/bingosystem/issue/BIN-505) |
| `SelectColorDraft` (mini-game) | 🟡 Backend i main (4-veis rotasjon aktiv); klient-UI gjennom `minigame:play { selectedIndex }` er stub (`ColorDraftOverlay`) | [BIN-506](https://linear.app/bingosystem/issue/BIN-506) |
| `ReplaceElvisTickets` (in-place replace) | 🟡 Implementert som disarm+rearm, trenger real replace | [BIN-509](https://linear.app/bingosystem/issue/BIN-509) |
| `replaceAmount` debitering | ❌ Ikke koblet | [BIN-521](https://linear.app/bingosystem/issue/BIN-521) (dup → 509) |
| `ticket:mark` per-merking fanout | 🔴 Fortsatt kvadratisk broadcast | [BIN-499](https://linear.app/bingosystem/issue/BIN-499) |
| `MAX_DRAWS` 75 | 🔴 Fortsatt 60 i config-clamp | [BIN-520](https://linear.app/bingosystem/issue/BIN-520) |
| Chat-persistens til DB (`GameChatHistory`) | ❌ Mangler (in-memory) | [BIN-516](https://linear.app/bingosystem/issue/BIN-516) |

Se [`docs/engineering/PARITY_MATRIX.md`](PARITY_MATRIX.md) (skrives i [BIN-525](https://linear.app/bingosystem/issue/BIN-525)) for komplett fremdrift.

---

## 13. Filer (primærreferanser)

**Backend (ny stack):**
- `apps/backend/src/game/BingoEngine.ts` — rom-lifecycle, draws, claims, mini-games
- `apps/backend/src/game/variantConfig.ts` — ticket-types + patterns per variant
- `apps/backend/src/sockets/gameEvents.ts` — socket-handlere
- `apps/backend/src/util/schedulerSetup.ts` — auto-draw
- `apps/backend/src/util/envConfig.ts` — konfig-verdier
- `apps/backend/src/util/roomHelpers.ts` — `buildRoomUpdatePayload`
- `apps/backend/migrations/20260413000001_initial_schema.sql` — DB-schema

**Klient (ny stack):**
- `packages/game-client/src/games/game1/Game1Controller.ts` — state-maskin
- `packages/game-client/src/games/game1/screens/PlayScreen.ts` — gameplay-UI
- `packages/game-client/src/games/game1/components/` — UI-komponenter
- `packages/game-client/src/games/game1/logic/StakeCalculator.ts` — server-autoritativ stake-visning
- `packages/game-client/src/bridge/GameBridge.ts` — socket ↔ state oversetter
- `packages/game-client/src/audio/AudioManager.ts` — audio-håndtering
- `packages/shared-types/src/socket-events.ts` — wire-kontrakt

**Legacy (referanse):**
- `legacy/unity-backend/Game/Game1/Sockets/game1.js` — legacy socket-handlere
- `legacy/unity-client/Assets/_Project/_Scripts/Panels/Game/Game 1/` — legacy Unity-UI

---

## 14. Redigerings-policy

Denne filen er **frosset** — endringer krever PR som oppdaterer både fila og koden samtidig (eller bare fila, hvis kodeendring allerede er i main og fila henger etter).

**Når oppdatere:**

1. Kode-endring som endrer spesifisert oppførsel (f.eks. legge til mini-game, endre pattern-prize, endre ball-range)
2. Kjent avvik lukkes (§12-rad endres fra ❌/🟡 til ✅)
3. Ny commit-ref i YAML front-matter `commitRef:` når vesentlige endringer landes

**Ikke oppdatere:** for ren refaktorering som ikke endrer spesifikasjon, eller for midlertidige eksperimenter.

**Parity-matrix-generator** (planlagt i [BIN-525](https://linear.app/bingosystem/issue/BIN-525)) vil lese YAML front-matter automatisk — ikke endre felt-struktur uten å oppdatere generatoren.

---

## 15. Revisjonshistorikk

| Dato | Commit-ref | Endring |
|------|-----------|---------|
| 2026-04-17 | `d78ea214` (BIN-523 state på tid for skriving) | Initial canonical spec, levert per [BIN-528](https://linear.app/bingosystem/issue/BIN-528) |
