# Game 1 — Spillfaser og pengeflyt (Databingo / Classic Bingo)

**Sist oppdatert:** 2026-04-16
**Gjelder:** `packages/game-client/src/games/game1/` + `backend/src/game/`

---

## Arkitekturprinsipp

> **Server-autoritativ for alle pengebelop.**
> Backend beregner innsats, premiepott og utbetaling. Klienten mottar ferdige tall
> via `playerStakes` i `room:update` og viser dem direkte. Klienten kalkulerer
> **aldri** penger selv — unntatt en overgangsfallback i `StakeCalculator.ts` som
> kan fjernes etter full utrulling.

Dataflyt:

```
Backend (BingoEngine)
  ├── buildRoomUpdatePayload()  → beregner playerStakes per spiller
  └── room:update               → sender til alle klienter

Klient (GameBridge → GameState)
  └── myStake                   → vises i LeftInfoPanel / CenterTopPanel
```

---

## Fase 1: Billettkjop (bet:arm)

### Flyt

```
Spiller klikker "Kjop"
  → Game1BuyPopup.onBuy()
  → Game1Controller.handleBuy()
  → socket.armBet({ roomCode, armed: true })
  → Backend: gameEvents.ts legger playerId i armedPlayerIdsByRoom
  → Backend: broadcaster sender room:update med oppdaterte armedPlayerIds + playerStakes
  → Klient: GameBridge parser payload → isArmed = true, myStake = beregnet belop
```

### Viktige detaljer

| Steg | Fil | Beskrivelse |
|------|-----|-------------|
| UI-popup | `components/Game1BuyPopup.ts` | 3-kolonne grid med antall, pluss/minus, totalpris |
| Controller | `Game1Controller.ts` | `handleBuy()` kaller `socket.armBet()`, skjuler popup ved suksess |
| Socket handler | `backend/src/sockets/gameEvents.ts` | `bet:arm` event — legger til/fjerner fra `armedPlayerIdsByRoom` |
| State-lagring | `backend/src/util/roomState.ts` | `armedPlayerIdsByRoom: Map<string, Set<string>>` |
| Payload-bygging | `backend/src/util/roomHelpers.ts` | `buildRoomUpdatePayload()` beregner `playerStakes` |

### Avbestilling

Spilleren kan avbestille bonger mellom runder via `handleCancelTickets()`:

```
socket.armBet({ roomCode, armed: false })
  → Backend fjerner fra armedPlayerIds
  → room:update med myStake = 0
```

---

## Fase 2: Spillstart og wallet-debet

Nar nedtellingen nar null starter `DrawScheduler` en ny runde:

```
DrawScheduler.tick()
  → BingoEngine.startGame({
      roomCode,
      armedPlayerIds,      // Kun armede spillere deltar
      entryFee,
      payoutPercent
    })
```

### BingoEngine.startGame() — steg for steg

1. **Filtrer kvalifiserte spillere** — kun de i `armedPlayerIds` som fortsatt er i rommet
2. **Debet wallet** — for hver spiller:
   ```typescript
   walletAdapter.transfer(
     player.walletId,
     houseAccountId,
     entryFee,
     { idempotencyKey: `buyin-${gameId}-${player.id}` }
   )
   ```
3. **Registrer i compliance** — `compliance.recordLossEntry()` + `compliance.incrementSessionGameCount()`
4. **Generer tickets** — basert pa `ticketTypes` og `ticketsPerPlayer`
5. **Sett opp premiepott** — `prizePool = entryFee * eligiblePlayers.length`

### Feilhandtering (HOEY-4)

Debiterte spillere spores i `debitedPlayers[]`. Hvis en transfer feiler midt i loopen:

```typescript
// Kompenser: refunder alle allerede debiterte spillere
const { failedRefunds } = await this.refundDebitedPlayers(
  debitedPlayers, houseAccountId, entryFee, roomCode, gameId
);
```

Hvis ticket-generering feiler ETTER alle debiteringer, utfores samme refund-logikk.

---

## Fase 3: Innsatsvisning (StakeCalculator)

**Fil:** `logic/StakeCalculator.ts`

### Strategi

```typescript
if (input.myStake !== undefined && input.myStake !== null) {
  return input.myStake;  // Server-autoritativ — foretrekkes alltid
}
// Fallback: klient-beregning (kun under utrulling)
```

### De 4 reglene

| # | Tilstand | Kilde | Resultat |
|---|----------|-------|----------|
| 1 | `RUNNING` + egne tickets | `myTickets` | Faktisk innsats (sum av ticket-priser) |
| 2 | `RUNNING` + ingen tickets | — | 0 (spectator, vises som "—") |
| 3 | Mellom runder + `isArmed` | `preRoundTickets` | Forventet innsats for neste runde |
| 4 | Mellom runder + ikke armet | — | 0 (vises som "—") |

### Viktig: preRoundTickets er IKKE kjopssignal

Backend genererer `preRoundTickets` for ALLE spillere som ikke deltar i aktiv runde —
ogsa de som ikke har kjopt. Disse brukes kun til a vise brett pa skjermen.
`isArmed` (fra `armedPlayerIds`) er den **eneste palitelige indikatoren** pa et eksplisitt kjop.

### Hjelpefunksjon

```typescript
export function stakeFromState(state: GameState): number
```

Trekker ut alle felter fra `GameState` og kaller `calculateStake()`.

---

## Fase 4: Claim og premieutbetaling

### LINE (1 Rad)

```
Spiller kaller claim({ type: "LINE" })
  → BingoEngine.claim()
  → Validering: har spilleren en komplett linje?
  → Utbetaling: 30% av prizePool (fra pattern.prizePercent)
  → walletAdapter.transfer(
      houseAccountId, player.walletId, payout,
      { idempotencyKey: `line-prize-${gameId}-${claimId}` }
    )
  → PrizePolicyManager.capPayout() begrenser maks enkeltpremie
  → compliance.recordLossEntry() — negativ PAYOUT
  → ComplianceLedger.recordEntry({ eventType: "PRIZE", ... })
```

### BINGO (Full Plate)

```
Spiller kaller claim({ type: "BINGO" })
  → KRITISK-4/BIN-242: Race condition guard
    → Sjekk: er BINGO allerede claimet? → avvis med "BINGO_ALREADY_CLAIMED"
  → Utbetaling: resterende prizePool (etter LINE-utbetalinger)
  → Samme wallet-transfer og compliance-registrering som LINE
  → game.endedReason = "BINGO_CLAIMED" → spillet avsluttes
```

### Premiebegrensning (PrizePolicyManager)

| Parameter | Beskrivelse |
|-----------|-------------|
| `singlePrizeCap` | Maks utbetaling per enkeltpremie |
| `dailyExtraPrizeCap` | Maks totale ekstrapremieutbetalinger per dag |
| Scope | Per hall, per spilltype (DATABINGO) |

Fil: `backend/src/game/PrizePolicyManager.ts`

---

## Compliance og revisjonsspor

### Dual-registrering

Alle monetare hendelser registreres i **to** systemer:

| System | Fil | Formal |
|--------|-----|--------|
| `ComplianceManager` | `backend/src/game/ComplianceManager.ts` | Tapsgrenser (daglig/manedlig), spillokt-sporing, spillvett |
| `ComplianceLedger` | `backend/src/game/ComplianceLedger.ts` | Revisjonsspor for Lotteritilsynet — STAKE, PRIZE, EXTRA_PRIZE, ORG_DISTRIBUTION |

### ComplianceManager-hendelser

```typescript
// Ved buyin (Fase 2):
compliance.recordLossEntry(walletId, hallId, {
  type: "BUYIN", amount: entryFee, reason: "BINGO_BUYIN"
});

// Ved premie (Fase 4):
compliance.recordLossEntry(walletId, hallId, {
  type: "PAYOUT", amount: -payoutAmount
});
```

### ComplianceLedger-poster

```typescript
// Innsats:
{ eventType: "STAKE", gameType: "DATABINGO", amount: entryFee }

// Premie:
{ eventType: "PRIZE", gameType: "DATABINGO", amount: payoutAmount }
```

---

## Sikkerhetsmekanismer

| Kode | Mekanisme | Fil |
|------|-----------|-----|
| **KRITISK-8** | Deltaker-sjekk — kun spillere som faktisk deltar kan claime | `BingoEngine.ts` |
| **KRITISK-4** | BINGO race guard — avviser duplikat BINGO-claims | `BingoEngine.ts` |
| **HOEY-4** | Refund failsafe — refunderer alle debiterte ved feil | `BingoEngine.ts` |
| **BIN-239** | Idempotency keys pa alle wallet-transfers | `BingoEngine.ts` |
| **BIN-250** | Mid-loop feil → refunder allerede debiterte | `BingoEngine.ts` |
| **HOEY-7** | Checkpoint-skriving etter LINE/BINGO payout | `BingoEngine.ts` |

### Idempotency key-format

```
buyin:        buyin-${gameId}-${playerId}
LINE-premie:  line-prize-${gameId}-${claimId}
BINGO-premie: bingo-prize-${gameId}-${claimId}
```

---

## Filreferanser

### Backend

| Fil | Ansvar |
|-----|--------|
| `backend/src/game/BingoEngine.ts` | Spillmotor — startGame, claim, wallet-operasjoner |
| `backend/src/game/ComplianceManager.ts` | Tapsgrenser, spillokt, spillvett |
| `backend/src/game/ComplianceLedger.ts` | Revisjonsspor (STAKE/PRIZE/EXTRA_PRIZE) |
| `backend/src/game/PrizePolicyManager.ts` | Premiebegrensning per hall |
| `backend/src/game/PayoutAuditTrail.ts` | Utbetalings-audit |
| `backend/src/util/roomHelpers.ts` | `buildRoomUpdatePayload()` — beregner playerStakes |
| `backend/src/util/roomState.ts` | `armedPlayerIdsByRoom` — in-memory arm-status |
| `backend/src/sockets/gameEvents.ts` | Socket-handlinger (bet:arm, claim, etc.) |
| `backend/src/draw-engine/DrawScheduler.ts` | Automatisk rundest art, trekking |

### Frontend

| Fil | Ansvar |
|-----|--------|
| `games/game1/Game1Controller.ts` | State machine, handleBuy/handleClaim routing |
| `games/game1/logic/StakeCalculator.ts` | Innsatsberegning (server-autoritativ + fallback) |
| `games/game1/logic/StakeCalculator.test.ts` | Fulldekkende tester for alle 4 regler + grensecaser |
| `games/game1/components/Game1BuyPopup.ts` | Kjopsdialog med antall-velger |
| `games/game1/screens/PlayScreen.ts` | Hovedspillskjerm — 5x5 grids, claim-knapper |
| `games/game1/components/LeftInfoPanel.ts` | Viser innsats, premiepott, spillerinfo |
| `bridge/GameBridge.ts` | Oversetter room:update → GameState (inkl. myStake, isArmed) |

---

## Sekvensdiagram (forenklet)

```
Spiller          Klient                   Backend                 Wallet
  |                |                         |                      |
  |--klikk kjop--->|                         |                      |
  |                |---bet:arm(true)--------->|                      |
  |                |                         |--armedPlayerIds[]---->|
  |                |<--room:update(stakes)----|                      |
  |                |                         |                      |
  |                |   [nedtelling = 0]      |                      |
  |                |                         |--startGame()--------->|
  |                |                         |  debit(idempotency)-->|
  |                |                         |  compliance.record()  |
  |                |<--room:update(RUNNING)---|                      |
  |                |                         |                      |
  |--klikk claim-->|                         |                      |
  |                |---claim(LINE)----------->|                      |
  |                |                         |--prizePolicyCap()---->|
  |                |                         |  payout(idempotency)->|
  |                |<--pattern:won(payout)----|                      |
```
