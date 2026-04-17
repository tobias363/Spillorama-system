---
game: game2
name: Rocket Bingo
slug: rocket
ticketGrid: 3x5
centerCell: none
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
    notes: "Hel rad (5 celler) eller hel kolonne (3 celler)"
  - id: bingo
    name: "Full Card"
    claimType: BINGO
    prizePercent: 70
    order: 2
    notes: "Alle 15 celler markert"
miniGames: []  # Game 2 har ingen mini-games
audioVoicePacks: []  # Lydfiler ikke portet ennå (README: MVP-begrensning)
features:
  chat: false  # Ikke portet, planlagt iterasjon 2
  doubleAnnounce: false
  luckyNumber: true
  ticketReplace: false
  hallDisplayBroadcast: false  # BIN-498 delt
  blindTickets: false  # Legacy Game2BuyBlindTickets — BIN-511 pending
  rocketStacking: true  # G2-signatur: rakettstabling-animasjon
complianceModel: hall-based
spillvettLimits:
  dailyLoss: 900
  monthlyLoss: 4400
  sessionMs: 3600000
  pauseMs: 300000
  selfExclusionMs: 31536000000
parityStatus: MVP  # MVP-nivå — flere features gjenstår (se §Kjente avvik)
commitRef: de23e274855356a2755fc30b32bcc8ed1ad8d1c2
---

# Game 2 Canonical Spec — Rocket Bingo

**Formål:** Frosset spesifikasjon av Game 2 sin faktiske oppførsel i `apps/backend/` + `packages/game-client/src/games/game2/` per 2026-04-17. Referansepunkt for paritet-arbeid ([BIN-525](https://linear.app/bingosystem/issue/BIN-525) parity matrix) og release-gate mot legacy Game 2.

> **Viktig:** Game 2 er MVP — flere legacy-features mangler. Se §11 for konkrete avvik. Ved uenighet mellom denne filen, `game2/README.md`, og kode: kode vinner → oppdater denne filen.

---

## 1. Identifikasjon

| Felt | Verdi |
|------|-------|
| Navn (NO) | Rocket Bingo |
| Backend-slug | `rocket` |
| Frontend-pakke | `packages/game-client/src/games/game2/` |
| Backend-logikk | `apps/backend/src/game/BingoEngine.ts` (delt) |
| Game type | Multiplayer, sanntid, hall-basert |
| Legacy-referanse | `legacy/unity-backend/Game/Game2/Sockets/game2.js` |

---

## 2. Spillflyt

```
Lobby (spillerliste, nedtelling)
  → Billett-kjøp (auto-arm i MVP — se §11.1)
  → Arming via bet:arm
  → Nedtelling (GSAP scale/color pulse)
  → RUNNING (auto-draw)
  → Trekning (drawIndex 0..59, ball-range 1-60)
  → LINE-claim
  → BINGO-claim (Full Card)
  → Slutt (resultat, auto-loop til Lobby)
```

**Klient-state-maskin** (`Game2Controller.ts:11`):
- `LOADING` → `LOBBY` → `PLAYING` → `ENDED` → tilbake til `LOBBY`
- **SPECTATING mangler** — avvik fra Game 1 (BIN-507 kun levert for G1). Oppfølging: egen issue hvis spectator-UX er krav for G2.

---

## 3. Konfigurerbare verdier

| Parameter | Kilde | Default | Gyldig range |
|-----------|-------|---------|--------------|
| Ball-range | `apps/backend/src/game/BingoEngine.ts:196` (`MAX_BINGO_BALLS_60`) | 1–60 | 1–60 |
| `maxDrawsPerRound` | `apps/backend/src/util/envConfig.ts:59` | 30 (clampet 75) | 1–75 |
| `maxTicketWeights` | Backend arm-validering | 30 | 1–30 |
| Grid | Backend ticket-generator | 3×5 (15 celler) | fast |

Kritisk: `rocket`-slug er **ikke** i `BINGO75_SLUGS` i `BingoEngine.ts:198`, så ball-range er 60 (ikke 75 som G1).

---

## 4. Ticket types

Kun én type i dag (`standard`): 3×5 grid, 15 celler, tall 1-60. Vekt 1.

Legacy hadde `Game2BuyBlindTickets` ([BIN-511](https://linear.app/bingosystem/issue/BIN-511)) som lot spillere kjøpe "blind" ticket uten forhåndsvisning. Ikke portet.

Ticket-kjøpet følger samme `TicketSelection[]`-kontrakt som G1 (`shared-types/socket-events.ts:71`):

```ts
interface TicketSelection { type: string; qty: number; }
```

For G2 sendes `{ type: "standard", qty: n }` (eller tom for auto-arm-MVP-path).

---

## 5. Win-patterns

Default i `BingoEngine.ts:142` (delt med G1, men G2 har andre claim-dimensjoner):

| Pattern | Claim-type | Prize % | Order | G2-betydning |
|---------|-----------|---------|-------|--------------|
| `line` | `LINE` | 30 | 1 | Hel rad (5 celler) eller hel kolonne (3 celler) |
| `bingo` (Full Card) | `BINGO` | 70 | 2 | Alle 15 celler markert |

Claim server-validert via `PatternValidator` — samme som G1.

---

## 6. Mini-games

**Game 2 har ingen mini-games.** `miniGames: []` i front-matter.

Dette skiller G2 fra G1 (wheel + chest) og G5 (rulett). Avviker også fra legacy Game 2 som heller ikke hadde mini-games — så paritet er opprettholdt.

---

## 7. Audio

**Lydfiler ikke portet** (MVP-begrensning per `game2/README.md`). `audioVoicePacks: []`. Oppfølging: egen issue når G2 prioriteres for full release.

---

## 8. Rakettstabling og animasjoner

G2-signatur: rakettstabling-animasjon (LeanTween i Unity → GSAP i web). MVP har enkel versjon; visuell polish gjenstår.

| Animasjon | Parametre | Utløser |
|-----------|-----------|---------|
| Countdown pulse | GSAP scale + color, varierende frekvens | Active countdown |
| Claim-button pulse | GSAP scale repeat | Når LINE/BINGO er mulig |
| Cell mark | scale 1 → 1.15 → 1, 0.4 s | Tall markeres |
| Raketstabling | 60 segmenter, GSAP `back.out(2)` scale-in + `power1.out` fade-in, ~0.35 s | Hver draw under RUNNING; `syncTo(drawCount)` ved late-join/SPECTATING |

---

## 9. Socket-kontrakt

Deler kontrakt med G1 + G3 + G5 via `packages/shared-types/src/socket-events.ts`. Ingen G2-unike events i ny stack.

**Client → Server** (samme som G1):
- `room:create` / `room:join` med `gameSlug: "rocket"`
- `bet:arm` med `{ armed, ticketSelections }`
- `claim:submit` (LINE / BINGO)
- `lucky-number:select`

**Server → Client** (samme som G1): `room:update`, `draw:new`, `pattern:won`, `wallet:balance`, osv.

Zod-schemas (BIN-545) dekker de delte payloadene: `RoomUpdatePayload`, `DrawNewPayload`, `ClaimSubmitPayload`. Drawindex-gap-deteksjon (BIN-502) fungerer automatisk for G2 fordi `GameBridge` er delt.

---

## 10. Checkpoint og recovery

Samme som G1: persist ved hver draw, recovery fra snapshot ved reconnect. `BINGO_CHECKPOINT_ENABLED=true` default.

Event-buffer ([BIN-501](https://linear.app/bingosystem/issue/BIN-501)) ikke levert — gjelder alle spill, ikke G2-spesifikt.

---

## 11. Kjente avvik fra legacy

Referanse: `legacy/unity-backend/Game/Game2/Sockets/game2.js`

### 11.1 G2-spesifikke avvik

| Legacy-feature | Status i ny stack | Oppfølging |
|----------------|-------------------|------------|
| `Game2BuyBlindTickets` | ❌ Ikke portet | [BIN-511](https://linear.app/bingosystem/issue/BIN-511) |
| `Game2PlanList` (hall-schedule) | 🟡 Delvis — håndteres via hall_game_schedules, men ikke via eget socket-event | Egen issue hvis nødvendig |
| `Game2TicketPurchaseData` | 🟡 Delvis — gameVariant i room:update dekker mesteparten | OK |
| Chat (`SendGameChat`, `GameChatHistory`) | ❌ Ikke portet | Egen issue |
| Lydfiler / nummerannouncement | ❌ Ikke portet | Egen issue |
| Auto-arm ved join | ✅ Har (avviker fra G1 som eksplisitt fjernet) | Vurder om dette bør være eksplisitt kjøp som G1 |
| Rocket-stabling polish | ✅ Levert (BIN-529 — `components/RocketStack.ts`) | Lyd + partikkel-effekter kan komme senere |
| `LeftRocketRoom` (spesifikk leave-event) | 🟡 Dekket av generelt `disconnect`-handling | OK |

### 11.2 Delte avvik (gjelder alle spill)

Se [PARITY_MATRIX.md](PARITY_MATRIX.md) §2.3 "Infrastruktur og drift" for delte rader: Redis-adapter (levert), hall-display (BIN-498), load-test (BIN-508), observability (BIN-539), feature-flag (BIN-540), Spillvett cross-game (BIN-541), iOS Safari (BIN-542), GSAP-lisens (BIN-538), asset-pipeline (BIN-543), PlayerPrefs (BIN-544).

### 11.3 Avvik mot Game 1

Game 1 har fått flere forbedringer som Game 2 ennå ikke har:

- SPECTATING-fase ([BIN-507](https://linear.app/bingosystem/issue/BIN-507) kun for G1)
- Loader-barriere ([BIN-500](https://linear.app/bingosystem/issue/BIN-500) kun for G1 `Game1Controller`)
- Eksplisitt kjøp (auto-arm fjernet kun i G1)

Disse bør portes til G2 som oppfølger når G2-paritet prioriteres — egne issues.

---

## 12. Filer (primærreferanser)

**Backend (delt med G1/G3/G5):**
- `apps/backend/src/game/BingoEngine.ts` — rom-lifecycle, draws, claims
- `apps/backend/src/game/variantConfig.ts` — ticket-types per variant
- `apps/backend/src/sockets/gameEvents.ts` — socket-handlere

**Klient (G2-spesifikk):**
- `packages/game-client/src/games/game2/Game2Controller.ts` — state-maskin
- `packages/game-client/src/games/game2/screens/PlayScreen.ts` — gameplay-UI
- `packages/game-client/src/games/game2/components/TicketCard.ts` — 3×5 grid
- `packages/game-client/src/games/game2/components/TicketScroller.ts` — scroll
- `packages/game-client/src/games/game2/logic/ClaimDetector.ts` — LINE/BINGO
- `packages/game-client/src/games/game2/logic/TicketSorter.ts` — best-first

**Delt klient:**
- `packages/game-client/src/bridge/GameBridge.ts` — snapshot → state (inkl. drawIndex-gap BIN-502)
- `packages/game-client/src/net/SpilloramaSocket.ts` — socket-wrapper
- `packages/shared-types/src/socket-events.ts` + `wireContract.ts` — typer + Zod-schemas

**Legacy (referanse):**
- `legacy/unity-backend/Game/Game2/Sockets/game2.js`
- `legacy/unity-client/Assets/_Project/_Scripts/Panels/Game/Game 2/`

---

## 13. Redigerings-policy

Samme som G1 canonical spec: PR som endrer G2-adferd MÅ oppdatere denne filen i samme PR.

**Parity-matrix-generator** (planlagt) leser YAML front-matter — ikke endre felt-struktur uten å oppdatere generatoren.

---

## 14. Revisjonshistorikk

| Dato | Commit-ref | Endring |
|------|-----------|---------|
| 2026-04-17 | `de23e274` (state ved skriving) | Initial canonical spec per BIN-529. MVP-nivå dokumentert; flere oppfølgings-issues listet i §11. |
