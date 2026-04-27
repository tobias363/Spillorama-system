# Win-audit: Solo-test 1700 kr i rom 4RCQSX (2026-04-27)

## TL;DR

- **Status:** VERIFISERT KORREKT — alle 5 phaser matematisk og finansielt validert mot drawnNumbers, ticket-grids og wallet-transaksjoner.
- **1700 kr** (100 + 200 + 200 + 200 + 1000) utbetalt til wallet `wallet-user-2f986c8d-4dd5-4b6d-8e48-0221e3bc735b` (player-id `0e7d75e6-1f8b-45ef-a281-1e45d9179531`, navn "TestBruker81632").
- **Korreksjon:** Game-id `83ad4a34-f78d-4dbd-b872-831f898f0cb7` som ble oppgitt i oppdraget endte faktisk uten gevinst (`endedReason="MAX_DRAWS_REACHED"`, ingen claims). Den faktiske 1700-kr-utbetalingen ligger i **`d3bf1467-e08f-4e27-97c1-3632f5d37557`** — runden som ble spilt rett etter (kl. 10:53–10:55 UTC) i samme rom 4RCQSX.
- Audit gjennomført fra public `/api/rooms/{code}` + `/api/wallets/{walletId}/transactions` — admin-token var ikke tilgjengelig (admin-bootstrap-endpoint disabled, ADMIN_BOOTSTRAP_SECRET ikke satt på prod). Disse to public endpointene ga full evidens.

## Kontekst

- **Endpoint:** `https://spillorama-system.onrender.com`
- **Room code:** `4RCQSX` (hall-id `011d4757-6c0f-4dd9-ae98-d928acfffc7a`)
- **Spiller:** TestBruker81632 — eneste deltaker (`participatingPlayerIds` har bare én id)
- **Game id (vinnende):** `d3bf1467-e08f-4e27-97c1-3632f5d37557`
- **Tidsvindu:** 2026-04-27 10:53:06.781Z → 10:55:25.147Z (≈2 min 18 s)
- **Drawn numbers:** 70 av 75 (BINGO_CLAIMED stoppet trekninger ved Fullt Hus på draw 70)
- **Tickets kjøpt:** 7 stk Small Yellow

Game-id i oppdraget (`83ad4a34-f78d-4dbd-b872-831f898f0cb7`) er den FORRIGE runden (10:50–10:52) — den har 75 trekninger uten claims (`endedReason: MAX_DRAWS_REACHED`) og null payouts. Det er altså `d3bf1467` som er den 1700-kr-runden Tobias refererer til.

## Verifikasjon per phase

For hver phase: jeg gjenskapte `drawn_set = drawnNumbers[0:wonAtDraw]` og sjekket hvilken ticket (av de 7) som hadde nok komplette rader/kolonner (sentercelle = 0 = FREE) til å oppfylle mønsteret. Validert i `/tmp/audit_check.py`.

| Phase | Pattern | Amount (kr) | wonAtDraw | Vinnende ticket-idx (0-6) | Linjer brukt | Validert? |
|---|---|---|---|---|---|---|
| 1 | 1 Rad | 100 | 24 | 1 | R2 | ✓ |
| 2 | 2 Rader | 200 | 47 | 5 | R1+R2 (også R0 var nær) | ✓ |
| 3 | 3 Rader | 200 | 52 | 5 | R0+R1+R2 | ✓ |
| 4 | 4 Rader | 200 | 63 | 0 | R2+R3+C3+C4 | ✓ |
| 5 | Fullt Hus | 1000 | 70 | 5 | hele 5×5 grid | ✓ |

**Eksempel — Fullt Hus (ticket 5, draws 1–70):**
```
Row 0:  [1] [16] [33] [50] [62]
Row 1:  [2] [18] [35] [52] [64]
Row 2: [10] [22]    *  [57] [70]
Row 3: [11] [27] [39] [59] [71]
Row 4: [12] [29] [40] [60] [73]
```
Alle 24 nummer + sentercelle FREE (`*`) er dekket. 25/25 = 100% ✓.

**Eksempel — 4 Rader (ticket 0, draws 1–63):** R2+R3 (rad-linjer) + C3+C4 (kolonne-linjer) = 4 linjer. ✓

## Wallet-tx audit

Public endpoint `GET /api/wallets/wallet-user-2f986c8d-4dd5-4b6d-8e48-0221e3bc735b/transactions?limit=200` returnerte 27 transaksjoner. 5 matcher de 10 `payoutTransactionIds` i claims-arrayet (de andre 5 er debit-side fra house-account, ikke i denne wallet'en):

| tx-id (8 chars) | type | amount | reason | createdAt |
|---|---|---|---|---|
| `e1b96f5e` | TRANSFER_IN | 100 | "1 Rad prize 4RCQSX" | 10:53:53.068Z |
| `f06b5028` | TRANSFER_IN | 200 | "2 Rader prize 4RCQSX" | 10:54:39.101Z |
| `644b8c93` | TRANSFER_IN | 200 | "3 Rader prize 4RCQSX" | 10:54:49.103Z |
| `073d0c3d` | TRANSFER_IN | 200 | "4 Rader prize 4RCQSX" | 10:55:11.109Z |
| `8708217e` | TRANSFER_IN | 1000 | "Fullt Hus prize 4RCQSX" | 10:55:25.119Z |

**Sum credit til wallet `wallet-user-2f986c8d-...`: 1700 kr** ✓

Hver tx er linket til riktig claim via `claims[N].payoutTransactionIds[1]` (credit-leg av transferen). `payoutAmount` på claim matcher `amount` på tx, og `claim.createdAt` matcher tx `createdAt` innen ~1 ms (samme transaksjon).

## Konfigurert payout-policy

`patterns`-arrayet i game-snapshot:
```
1 Rad      design=1 prize1=100   winningType=fixed
2 Rader    design=2 prize1=200   winningType=fixed
3 Rader    design=3 prize1=200   winningType=fixed
4 Rader    design=4 prize1=200   winningType=fixed
Fullt Hus  design=0 prize1=1000  winningType=fixed
```

Disse beløpene matcher `DEFAULT_NORSK_BINGO_CONFIG` (BingoEngine fixed-prize-modus). Ingen RTP-cap traff (`rtpCapped: false` på alle 5 claims, `payoutWasCapped: false`).

`payoutPolicyVersion`-felt på alle 5 claims: `52d7f306-6ed8-4767-be7b-786d497c9aa7` (samme versjon — ingen runtime-endring under runden).

## Sluttkommentar

- **Ingen avvik funnet.** Alle 5 phaser har en ticket i spillerens 7-ticket-portefølje som matematisk oppfyller mønsteret ved oppgitt `wonAtDraw`. Wallet-credits matcher pattern-payouts beløp-for-beløp og time-stempel-til-time-stempel.
- Engine plukket vinnende ticket-indeks per phase (1=ticket 1, 2/3/5=ticket 5, 4=ticket 0). Spiller kunne i prinsippet ha vunnet 1 Rad eller 4 Rader på flere tickets samtidig, men engine premierte korrekt: én vinnende ticket per phase.
- `endedReason="BINGO_CLAIMED"` ved draw 70 (av maks 75) viser engine stoppet trekkingen så snart Fullt Hus ble vunnet — korrekt regulatorisk oppførsel.
- **Hall-binding:** alle claims har `winnerId` = test-bruker, `lineWinnerId` og `bingoWinnerId` peker på samme spiller. `prizePool=70`, `maxPayoutBudget=56` (med `payoutPercent=80%`) er bypasset av `winningType=fixed` — utbetalt 1700 kr fra house-account uavhengig av prize-pool. Dette er korrekt for fixed-prize-modus.
- **Begrensning:** auditen er gjort uten admin-token, så jeg har ikke direkte sett `app_compliance_ledger`-entries (`/api/admin/payout-audit`) eller hash-chain'en i `app_payout_audit`. Public endepunktene ga imidlertid all kritisk evidens (claims-array og wallet-transactions er begge bygget på samme PRIZE-flyt, så en mismatch der ville indikert tampering).

## Reproduserbarhet

For å re-audite:
```bash
# Hent komplett snapshot inkl. claims + tickets + drawnNumbers
curl -s https://spillorama-system.onrender.com/api/rooms/4RCQSX | jq '.data.gameHistory[] | select(.id=="d3bf1467-e08f-4e27-97c1-3632f5d37557")'

# Hent wallet-transactions
curl -s 'https://spillorama-system.onrender.com/api/wallets/wallet-user-2f986c8d-4dd5-4b6d-8e48-0221e3bc735b/transactions?limit=200' | jq '.data[] | select(.reason | test("prize 4RCQSX"))'

# Kjør pattern-verifisering
python3 /tmp/audit_check.py    # Se denne PR for innhold
```

NB: data forsvinner ut av room-snapshot etter X game-rotasjoner (gameHistory beholder kun de N siste rundene per room). Audit må kjøres mens runden er innenfor history-vinduet, eller via `/api/admin/games/{gameId}/replay`-endepunktet (krever admin-token).
