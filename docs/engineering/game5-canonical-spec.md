---
game: game5
name: Spillorama Bingo
slug: spillorama
ticketGrid: 3x5
centerCell: none
ballRange: [1, 60]
maxDrawsPerRound: 60
ticketTypes:
  - code: standard
    weight: 1
  - code: blue
    weight: 1
  - code: green
    weight: 1
  - code: red
    weight: 1
  - code: purple
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
miniGames:
  - rouletteWheel
  - freeSpinJackpot  # Pending — BIN-531 oppfølger + rulettfysikk fra BIN-519
miniGameRotation: single-per-game  # Ikke roterende — aktiveres ved spesifikke triggere
audioVoicePacks: []
features:
  chat: false
  doubleAnnounce: false
  luckyNumber: false  # G5 bruker rulett i stedet
  ticketReplace: false  # SwapTicket ikke portet — BIN-510
  hallDisplayBroadcast: false
  ticketSwap: false  # BIN-510 pending
  freeSpinJackpot: false  # BIN-531 oppfølger pending
  kycGate: false  # BIN-514 pending for G5
  rouletteWheel: true  # G5-signatur, ren GSAP (fysikk fra BIN-531/matter.js pending)
  drumRotation: false  # Unity-kontinuerlig hjulrotasjon ikke portet
complianceModel: hall-based
spillvettLimits:
  dailyLoss: 900
  monthlyLoss: 4400
  sessionMs: 3600000
  pauseMs: 300000
  selfExclusionMs: 31536000000
parityStatus: MVP  # Rulett visuell, men flere G5-unike features gjenstår
commitRef: 300b248cd3975ba0a723c9a911cc187979e79af1
---

# Game 5 Canonical Spec — Spillorama Bingo

**Formål:** Frosset spesifikasjon av Game 5 sin faktiske oppførsel i `apps/backend/` + `packages/game-client/src/games/game5/` per 2026-04-17. Referansepunkt for paritet-arbeid ([BIN-525](https://linear.app/bingosystem/issue/BIN-525) parity matrix) og release-gate mot legacy Game 5.

> **Viktig:** Game 5 er MVP. Rulett-animasjonen fungerer men er ren GSAP uten fysikk. Free Spin Jackpot, ticket-swap og KYC-gate mangler. Se §11 for konkrete avvik.

---

## 1. Identifikasjon

| Felt | Verdi |
|------|-------|
| Navn (NO) | Spillorama Bingo |
| Backend-slug | `spillorama` |
| Frontend-pakke | `packages/game-client/src/games/game5/` |
| Backend-logikk | `apps/backend/src/game/BingoEngine.ts` (delt) |
| Game type | Hybrid (multiplayer-lobby + rulett-animasjon per draw) |
| Legacy-referanse | `legacy/unity-backend/Game/Game5/Sockets/game5.js` |

---

## 2. Spillflyt

```
Lobby (spillerliste, nedtelling)
  → Billett-kjøp (valg av 1-5 farger — MVP har kun "standard")
  → Arming via bet:arm
  → Nedtelling (GSAP)
  → RUNNING (auto-draw eller host-start)
  → Per draw: rulett-animasjon spinner, tall trekkes
  → LINE-claim
  → BINGO-claim (Full Card)
  → Slutt (resultat + evt. Free Spin Jackpot-trigger)
```

**Klient-state-maskin** (`Game5Controller.ts:12`):
- `LOADING` → `LOBBY` → `PLAYING` → `ENDED` → tilbake til `LOBBY`
- **SPECTATING mangler** (kun G1 har det via BIN-507). Port nødvendig for full paritet.

---

## 3. Konfigurerbare verdier

| Parameter | Kilde | Default | Gyldig range |
|-----------|-------|---------|--------------|
| Ball-range | `BingoEngine.ts:196` (`MAX_BINGO_BALLS_60`) | 1–60 | 1–60 |
| `maxDrawsPerRound` | `envConfig.ts:59` | 30 (clampet 75) | 1–75 |
| Grid | Backend ticket-generator | 3×5 (15 celler) | fast |
| Rulett-segmenter | `RouletteWheel.ts` | 8 | fast |

---

## 4. Ticket types

MVP har kun én type (`standard`). Legacy har 4 farge-varianter (blå, grønn, rød, lilla) + swap-funksjon. Farge-varianter er skissert i YAML front-matter men ikke implementert i kode ennå.

Swap-funksjon ([BIN-510](https://linear.app/bingosystem/issue/BIN-510)) lar spiller bytte én ticket for en annen farge midt i runde — ikke portet.

---

## 5. Win-patterns

Samme som G2 (delt via `BingoEngine.ts:142`):

| Pattern | Claim-type | Prize % |
|---------|-----------|---------|
| `line` | LINE | 30 |
| `bingo` (Full Card) | BINGO | 70 |

**checkForWinners eksplisitt endepunkt** ([BIN-512](https://linear.app/bingosystem/issue/BIN-512)) — legacy hadde dette for on-demand vinner-sjekk. Ny stack bruker automatisk claim ved server-side validering — endepunktet er ikke portert. Vurder om det er nødvendig.

---

## 6. Mini-games og rulett

**Rulett (G5-signatur, implementert MVP):**
- 8 fargerike segmenter med tall 1-60
- Spin-animasjon: 5 fulle rotasjoner + mållanding (GSAP `power3.out`)
- Gul pil-peker øverst (statisk)
- Etter landing: tall zoomes til senter (matcher Unity `HighlightBall`)
- **Rent visuelt** — backend bestemmer trukket tall via vanlig `draw:new`, rulett spinner synkront
- Ingen fysikk (Unity bruker `Rigidbody2D` + `Collider2D` — kreves [`matter.js`](https://brm.io/matter-js/) eller egen løsning for full paritet)

**Auto-select** ([BIN-519](https://linear.app/bingosystem/issue/BIN-519)):
- `SelectWofAuto` (legacy) — auto-velg på Wheel of Fortune (G1-delt)
- `SelectRouletteAuto` (legacy) — auto-velg på Rulett
- Ingen av disse er portet.

**Free Spin Jackpot** — ikke portet. Se `components/JackpotOverlay.ts` — stub eksisterer men backend-endepunkt mangler.

---

## 7. KYC-gate

Legacy `isGameAvailbaleForVerifiedPlayer` ([BIN-514](https://linear.app/bingosystem/issue/BIN-514)) blokkerer spillere uten verifisert identitet fra G5. Ikke portet. Krever:
- Backend-validering ved `room:join`/`bet:arm`
- Klient-UI for KYC-gate-varsling

For pilot må KYC være aktiv eller eksplisitt dokumentert som avvik fra compliance.

---

## 8. Audio og animasjoner

Samme begrensninger som G2: lyd ikke portet, animasjoner er MVP.

**Rulett-animasjon parametre:**
- Spin: 5 rotasjoner, 4-5 s total, `power3.out`
- Zoom: scale 7× → 1×, 0.5 s, `back.out(1.7)`

---

## 9. Socket-kontrakt

Deler basis-kontrakt med G1/G2/G3. G5-unike legacy-events *ikke portet*:

| Legacy-event | Formål | Status | Issue |
|--------------|--------|--------|-------|
| `Game5Data` | Hent room-data | 🟡 Dekket av generisk `room:update` | — |
| `Game5Play` | Send spill-handling | 🟡 Dekket av generisk `bet:arm` + `claim:submit` | — |
| `SwapTicket` | Bytt ticket-farge | ❌ | [BIN-510](https://linear.app/bingosystem/issue/BIN-510) |
| `checkForWinners` | On-demand vinner-sjekk | ❌ | [BIN-512](https://linear.app/bingosystem/issue/BIN-512) |
| `WheelOfFortuneData` | WoF-prize-tabell | 🟡 Dekket av mini-game-system (BIN-505/506) | — |
| `PlayWheelOfFortune` | Send WoF-valg | 🟡 Dekket av generisk `minigame:play` | — |
| `SelectWofAuto` | Auto-velg WoF | ❌ | [BIN-519](https://linear.app/bingosystem/issue/BIN-519) |
| `SelectRouletteAuto` | Auto-velg rulett | ❌ | [BIN-519](https://linear.app/bingosystem/issue/BIN-519) |
| `isGameAvailbaleForVerifiedPlayer` | KYC-gate | ❌ | [BIN-514](https://linear.app/bingosystem/issue/BIN-514) |
| `LeftRoom` | Spesifikk leave | 🟡 Dekket av generelt `disconnect` | — |

---

## 10. Checkpoint og recovery

Samme som G1/G2. `BINGO_CHECKPOINT_ENABLED=true` default. Shared gap-deteksjon fra [BIN-502](https://linear.app/bingosystem/issue/BIN-502) fungerer for G5.

---

## 11. Kjente avvik fra legacy

### 11.1 G5-spesifikke avvik

| Legacy-feature | Status i ny stack | Issue |
|----------------|-------------------|-------|
| SwapTicket (bytt ticket-farge) | ❌ | [BIN-510](https://linear.app/bingosystem/issue/BIN-510) |
| Free Spin Jackpot | ❌ (stub-UI eksisterer) | Del av G5 paritet — egen oppfølger |
| KYC-gate for verifiserte spillere | ❌ | [BIN-514](https://linear.app/bingosystem/issue/BIN-514) |
| `checkForWinners` on-demand | ❌ | [BIN-512](https://linear.app/bingosystem/issue/BIN-512) |
| SelectWofAuto / SelectRouletteAuto | ❌ | [BIN-519](https://linear.app/bingosystem/issue/BIN-519) |
| 4+ billettfarger (index-cycle) | ✅ Portet — gjenbruker G1 `TICKET_THEMES` (8 varianter) via `getTicketThemeByName(ticket.color, i)`. `ticket.color` fra backend tillater framtidig SwapTicket. | — |
| Rulett med fysikk (Rigidbody2D + Collider2D) | 🟡 Ren GSAP, ingen fysikk | Egen issue hvis fysikk må matches |
| DrumRotation (kontinuerlig) | ✅ Portet — GSAP infinite-loop 2π/12s på `JackpotOverlay` wheelInner mens spiller venter; killed før spin-tween og preserver offset ved overgang | — |

### 11.2 Delte avvik (gjelder alle spill)

Samme som G2 — se `PARITY_MATRIX.md` §2.3. Redis, load-test, observability er ✅ takket være fundament-arbeidet fra agent 2.

### 11.3 Avvik mot Game 1

Game 5 mangler G1-forbedringer:
- SPECTATING-fase ([BIN-507](https://linear.app/bingosystem/issue/BIN-507) kun G1)
- Loader-barriere ([BIN-500](https://linear.app/bingosystem/issue/BIN-500) kun G1)
- Eksplisitt kjøp (G5 har fortsatt auto-arm)

---

## 12. Filer (primærreferanser)

**Backend (delt):**
- `apps/backend/src/game/BingoEngine.ts`
- `apps/backend/src/sockets/gameEvents.ts`

**Klient (G5-spesifikk):**
- `packages/game-client/src/games/game5/Game5Controller.ts` — state-maskin + gameSlug
- `packages/game-client/src/games/game5/screens/PlayScreen.ts` — 3×5 grids + rulett (høyreside)
- `packages/game-client/src/games/game5/components/RouletteWheel.ts` — rulett-animasjon
- `packages/game-client/src/games/game5/components/JackpotOverlay.ts` — stub

**Delt klient** (via G2 gjenbruk):
- `packages/game-client/src/games/game2/screens/LobbyScreen.ts`
- `packages/game-client/src/games/game2/components/TicketCard.ts`
- `packages/game-client/src/games/game2/logic/ClaimDetector.ts`

**Legacy:**
- `legacy/unity-backend/Game/Game5/Sockets/game5.js`
- `legacy/unity-client/Assets/_Project/_Scripts/Panels/Game/Game 5/`

---

## 13. Redigerings-policy

Samme som G1/G2 canonical spec. PR som endrer G5-adferd MÅ oppdatere denne filen.

---

## 14. Revisjonshistorikk

| Dato | Commit-ref | Endring |
|------|-----------|---------|
| 2026-04-17 | `300b248c` (state ved skriving) | Initial canonical spec per BIN-531. MVP-nivå; 8 G5-spesifikke avvik listet i §11. Rulett implementert men uten fysikk. Free Spin Jackpot + SwapTicket + KYC-gate som oppfølgere. |
