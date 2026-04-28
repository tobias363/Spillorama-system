# Testbruker prod-diagnose — 2026-04-28

**Status:** Diagnose-only. Ingen kode-endringer. Anbefalt fix-PR i §6.

**Symptom Tobias rapporterer:** "bugs når jeg tester med testbrukeren. både gevinster og at spillet stopper" (28. april 2026).

**Forrige forensic (PR #688):** kunne ikke reprodusere i ad-hoc unit-test der `DEFAULT_NORSK_BINGO_CONFIG` (fixed-prize) brukes direkte. Konkluderte med at bug-en må være prod-spesifikk og listet 4 hypoteser som krevde prod-data for å avgjøre.

**Denne diagnosen:** identifiserer kode-pathen som matcher symptom og peker på rotårsaken.

---

## 1. Prod-state-snapshot

Tatt 2026-04-28 12:28 UTC mot `https://spillorama-system.onrender.com`:

```json
{
  "rooms": 2,
  "stuckRooms": 0,
  "totalDetections": 0,
  "halls": 23,
  "walletProvider": "postgres",
  "swedbankConfigured": false
}
```

**Aktive rom:**
- `BINGO_B18B7928-3469-4B71-A34D-3F81A1B09A88` — status PLAYING/RUNNING
- `BINGO_C4A191FC-2C7B-4E62-A0DE-B2D52F613FC4` — status PLAYING/RUNNING

**Konklusjoner fra prod-state:**
- 4RCQSX-room-collision er **ryddet** — boot-sweep fra PR #682 fungerer.
- Ingen stuck rooms.
- Begge canonical-rom med UUID-format `BINGO_<UUID>` matcher hallId.
- Ingen tegn til ad-hoc rom som ikke er ryddet opp.

Med andre ord: **room-state-laget er ikke kilden til bug-en**. Boot-sweep + canonical-aware lookup virker som forventet.

---

## 2. Rotårsak — `prizePercent ?? 0`-fallback i payout-beregning

Bug-en ligger i samspillet mellom **admin-UI default mode** og **engine prize-beregning**.

### 2.1 Admin-UI default

`apps/admin-web/src/pages/games/gameManagement/GameManagementAddForm.ts:360`:

```typescript
const mode = prize?.mode ?? "percent";   // ← default = "percent"
```

`apps/admin-web/src/pages/games/gameManagement/GameManagementAddForm.ts:627`:

```typescript
prizePerPattern: {},   // ← tom ved opprettelse av ny ticket-color
```

`apps/admin-web/src/pages/games/gameManagement/GameManagementAddForm.ts:679`:

```typescript
modeSelect?.value === "fixed" ? "fixed" : "percent";
```

**Konsekvens:** Når admin oppretter en ny Spill 1-konfigurasjon og ikke eksplisitt setter `fixed`-mode + et beløp, lagres `prizePerPattern` enten som `{}` (tom) eller med `mode: "percent", amount: <noe>`.

### 2.2 Mapper-output

`apps/backend/src/game/spill1VariantMapper.ts:280-302` (`patternConfigForPhase`):

```typescript
if (rawPrize && typeof rawPrize === "object") {
  if (rawPrize.mode === "fixed") {
    return { name, claimType, design, prizePercent: 0, winningType: "fixed", prize1: amount };
  }
  // Default mode = percent (explicit or undefined).
  return { name, claimType, design, prizePercent: amount };   // ← INGEN winningType
}
```

**Kritisk:** når `mode === "percent"`, settes `prizePercent: amount` men **ingen `winningType`** propageres. Dette betyr at `isFixedPrizePattern(pattern)` returnerer `false`.

`apps/backend/src/game/BingoEngine.ts:97-106`:

```typescript
function isFixedPrizePattern(pattern: { winningType?: ... }): boolean {
  return pattern.winningType === "fixed";
}
```

Hvis `prizePerPattern` er tom (`{}`), faller mapperen til fallback-pattern. Men det viktigste er at admin-UI default = `percent`.

### 2.3 Engine-beregning ved `mode === "percent"`

**Path A: Per-color-evaluator** (`BingoEnginePatternEval.evaluateActivePhase`):

`apps/backend/src/game/BingoEnginePatternEval.ts:358-362`:

```typescript
} else {
  totalPhasePrize = Math.floor(
    game.prizePool * (prizeSource.prizePercent ?? 0) / 100,
  );
}
```

`prizePerWinner = Math.floor(totalPhasePrize / winnerIds.length)`.

**Path B: Manual claim (`BingoEngine.submitClaim`)** — to tilsvarende grener:

`apps/backend/src/game/BingoEngine.ts:2206-2208` (LINE):

```typescript
const requestedPayout = lineIsFixedPrize
  ? Math.max(0, linePattern!.prize1 ?? 0)
  : Math.floor(game.prizePool * (linePattern?.prizePercent ?? 30) / 100);
```

`apps/backend/src/game/BingoEngine.ts:2380-2382` (BINGO):

```typescript
const requestedPayout = bingoIsFixedPrize
  ? Math.max(0, bingoPattern!.prize1 ?? 0)
  : game.remainingPrizePool;
```

### 2.4 Resultat ved liten/null pool

For testbruker-scenario (1 spiller, Demo Hall, `entryFee=0` eller meget lav):
- `game.prizePool ≈ 0` (ingen reell debit i Demo Hall, eller minimal entryFee)
- `prizePercent ?? 0 = 0` (admin-UI ikke satt eksplisitt 30%)
- `totalPhasePrize = Math.floor(0 * 0 / 100) = 0`
- `prizePerWinner = 0`
- **`payoutPhaseWinner` kalles med `prizePerWinner=0`**

`apps/backend/src/game/BingoEngine.ts:1489`:

```typescript
if (payout > 0) {
  // wallet.transfer ...
  // game.bingoWinnerId = player.id (linje 2420)
  // game.status = "ENDED" (linje 2495)
  // game.endedReason = "BINGO_CLAIMED" (linje 2497)
}
```

**Når `payout === 0`:**
- `wallet.transfer` blir aldri kalt → **ingen winnings krediteres** ← matcher Tobias-symptom #1
- `game.status = "ENDED"` settes aldri (i BINGO-grenen) → **runden henger** uten BINGO_CLAIMED ← matcher Tobias-symptom #2
- Pattern-resultatet markeres `isWon=true` med `payoutAmount=0` → UI viser "vinner" uten utbetaling

### 2.5 Hvordan dette unnslapp ad-hoc unit-test

`BingoEngine.demoHallPayout.test.ts` bruker `DEFAULT_NORSK_BINGO_CONFIG` direkte (linje 123). Den configen har eksplisitt `winningType: "fixed", prize1: 100/200/200/200/1000` (variantConfig.ts:302-306). Testen treffer derfor `isFixedPrize === true`-grenen og payout = 100 kr uavhengig av `prizePool`. Den fanger ikke regresjonen i prod-pathen der admin-UI har satt `mode: "percent"`.

---

## 3. Hva matcher med Tobias-symptom

| Symptom | Sannsynlig årsak |
|---|---|
| "ingen gevinster blir gitt" | `payout === 0` → `wallet.transfer` skipped → winnings ikke kreditert |
| "spillet stopper" | I BINGO-grenen: `game.status = "ENDED"` ligger inne i `if (payout > 0)`-blokken (BingoEngine.ts:2495). Ved `payout === 0` ender runden aldri formelt; UI henger på "fase vunnet" men spillet er låst i RUNNING |

---

## 4. Hvorfor reproduserbare i prod, ikke ad-hoc test

| Path | `winningType` | `payout` | Kreditert |
|---|---|---|---|
| Ad-hoc test (`DEFAULT_NORSK_BINGO_CONFIG`) | `"fixed"` | `prize1` (100 kr) | ✅ |
| Prod (admin saved `mode: "percent"`, default 0% / lav pool) | undefined | 0 | ❌ |
| Prod (admin saved `mode: "fixed", amount: 100`) | `"fixed"` | 100 kr | ✅ |
| Prod (admin saved `mode: "percent", amount: 30`, pool > 0) | undefined | `pool*30/100` | ✅ (men kan være < 1 kr ved liten pool) |

**Hypotese-rangering:**
1. **Mest sannsynlig:** Demo Hall har Spill 1-konfigurasjon der admin-UI lagret `prizePerPattern` med `mode: "percent"` (default), enten med `amount: 0` eller manglende. Se også scenario der admin valgte percent-mode med 30% — i 1-spiller, lav-pool scenario blir resultatet `Math.floor(10 * 30 / 100) = 3 kr` per fase, som ser ut som "ingen gevinster" relativt til forventning.
2. **Sekundært:** Demo Hall-bypass kombinert med `entryFee=0` gir `prizePool=0`, så også fixed-prize blir 0 i percent-grenen (ingen pool-cap-bypass for percent-mode).

---

## 5. Diagnose-spørsmål for Tobias

For å bekrefte rot-årsaken trenger vi:

1. **GameManagement-config for Demo Hall (`isTestHall=true`):** hva er `config_json.spill1.ticketColors[*].prizePerPattern[*]`? Forventet: `{mode: "percent", amount: 30}` eller tom.

   **SQL (kjør i prod-DB med admin-tilgang):**
   ```sql
   SELECT id, hall_id, game_type_slug, config_json->'spill1'->'ticketColors'
   FROM app_game_management
   WHERE game_type_slug IN ('bingo', 'game_1', 'norsk-bingo')
     AND hall_id IN (
       SELECT id FROM app_halls WHERE is_test_hall = TRUE
     );
   ```

2. **Wallet-transactions for testbruker etter "vinn":** finnes det `TRANSFER_IN`-rader med `target_side='winnings'` etter siste runde?

   **SQL:**
   ```sql
   SELECT type, amount, target_side, reason, created_at
   FROM app_wallet_transactions
   WHERE wallet_id = '<testbruker-wallet-id>'
   ORDER BY created_at DESC
   LIMIT 20;
   ```

3. **Compliance-ledger PRIZE-events for testbruker:**
   ```sql
   SELECT event_type, amount, hall_id, created_at
   FROM app_rg_compliance_ledger
   WHERE wallet_id = '<testbruker-wallet-id>'
     AND event_type = 'PRIZE'
   ORDER BY created_at DESC LIMIT 10;
   ```

Hvis SQL #2 og #3 returnerer 0 rader etter siste rapporterte "vinn", så bekrefter det at `payout === 0`.

---

## 6. Anbefalt fix-PR

Fix-PR scope (utenfor denne diagnose-task):

### Fix 1: `wallet.transfer` skal også kalles ved `payout === 0` for å markere phase-state korrekt

Endre `BingoEngine.payoutPhaseWinner` (linje 1489) til å **alltid** sette state-mutasjoner uavhengig av `payout > 0`. Skille mellom "betalt 0 kr" (legitimt for percent-mode med 0% eller pool=0) og "ingen vinning" (skal aldri skje).

```typescript
// Forslag:
if (payout > 0) {
  // wallet.transfer og refreshPlayerBalancesForWallet
}
// State-mutasjoner ALLTID:
game.bingoWinnerId = player.id;
game.status = "ENDED";  // for BINGO-claims
game.endedReason = "BINGO_CLAIMED";
```

Tilsvarende fix i:
- `BingoEngine.submitClaim` LINE-grenen (linje 2230)
- `BingoEngine.submitClaim` BINGO-grenen (linje 2401)

### Fix 2: Mapperen skal aldri produsere `prizePercent: 0` uten `winningType: "fixed"`

`spill1VariantMapper.ts:patternConfigForPhase` — når `mode === "percent" && amount === 0`, fall tilbake til fallback-pattern (DEFAULT_NORSK_BINGO_CONFIG har `winningType: "fixed", prize1: ...`). Eller: throw en valideringsfeil i admin-UI submit som krever ikke-null amount.

### Fix 3: Admin-UI default skal være `mode: "fixed"` for nye configs

`GameManagementAddForm.ts:679` — endre default fra `"percent"` til `"fixed"`. Og `GameManagementAddForm.ts:627` — initialiser nye ticket-colors med `prizePerPattern` matchende DEFAULT_NORSK_BINGO_CONFIG (fixed 100/200/200/200/1000).

### Fix 4: Regression-test som dekker mapper-pathen

Utvide `BingoEngine.demoHallPayout.test.ts` med en variant som bruker `buildVariantConfigFromSpill1Config` med `mode: "percent"` og asserter at hverken winnings krediteres uten gyldig pool, ELLER at game.status faktisk endrer seg ved Fullt Hus.

---

## 7. Rask recovery for nåværende testbruker

Hvis Tobias trenger umiddelbar fix uten å vente på fix-PR:

1. **Admin-UI:** åpne GameManagement for Demo Hall sin Spill 1-konfig, set `mode: "fixed"` for alle 5 patterns på alle ticket-colors med beløp 100/200/200/200/1000. Save.
2. **DB-direkte (krever admin-DB-tilgang):**
   ```sql
   UPDATE app_game_management
   SET config_json = jsonb_set(
     config_json,
     '{spill1}',
     '{...komplett config med mode:fixed...}'
   )
   WHERE hall_id = '<demo-hall-id>';
   ```

3. **Server-restart:** ikke nødvendig — `bindVariantConfigForRoom` re-fetch per room ved `room:join` (sjekket roomState.ts:351).

---

## 8. Konklusjon

**Hypotese-match:** prod-spesifikt config-binding-bug i samspillet mellom admin-UI default `mode: "percent"` og engine-grenen som bruker `prizePool * prizePercent / 100`.

**Hvorfor ad-hoc test ikke fanget det:** testen bruker `DEFAULT_NORSK_BINGO_CONFIG` med `winningType: "fixed"` direkte og treffer aldri percent-grenen.

**Boot-sweep og room-state-laget:** ikke kilden. 0 stuckRooms, ingen 4RCQSX-rester. PR #682 funket.

**Anbefalt next step:**
1. Tobias bekrefter med SQL #1 i §5 hvilken `prizePerPattern.mode` som er lagret for Demo Hall.
2. Hvis confirmed `mode: "percent"`: opprett fix-PR med endringene i §6 (Fix 1 + Fix 2 minimum).
3. Quick-fix i mellomtiden: oppdater Demo Hall config til `mode: "fixed"` via admin-UI eller direkte SQL.

---

**Kilder:**
- `apps/backend/src/game/BingoEngine.ts:1436-1517` (payoutPhaseWinner)
- `apps/backend/src/game/BingoEngine.ts:2196-2530` (submitClaim LINE/BINGO)
- `apps/backend/src/game/BingoEnginePatternEval.ts:358-485` (evaluateActivePhase)
- `apps/backend/src/game/spill1VariantMapper.ts:256-306` (patternConfigForPhase)
- `apps/backend/src/game/variantConfig.ts:288-312` (DEFAULT_NORSK_BINGO_CONFIG)
- `apps/admin-web/src/pages/games/gameManagement/GameManagementAddForm.ts:360, 627, 679` (admin defaults)
- `apps/backend/src/game/BingoEngine.demoHallPayout.test.ts` (eksisterende regression-vakt)

**Diagnose laget av:** Claude (Opus 4.7 1M-context) etter forespørsel fra Tobias 2026-04-28.

**Branch:** `docs/testbruker-diagnose-2026-04-28`
