# Chip-saldo / gevinst-desync — diagnose 2026-04-26

**Status:** Root cause identifisert. UI-tallene ER korrekte gitt det DB sier — det er DB-state som er feil (orphan stale reservation som ikke er expired).

**Bug-rapport:**
- Tobias' chip viser `Saldo: 5 664 kr / Gevinst: 0 kr`
- Prod-DB viser `deposit_balance: 5742 / winnings_balance: 192 / balance: 5934`
- Differanse: **-78 kr saldo, -192 kr gevinst, totalt -270 kr**

## TL;DR

Et `app_wallet_reservations`-row med `amount_cents = 270` (NOK, ikke cents — kolonnen er feilnavngitt) henger som `status='active'` selv om `expires_at = 18:03:03` har passert (now = 18:06:28). `WalletReservationExpiryService` har enten ikke kjørt sin tick siden 17:33, eller er ikke aktiv på prod-noden.

**Augmenteren** i `apps/backend/src/routes/wallet.ts:476` bruker winnings-first-policy:
```
reservedFromWinnings = min(winningsBalance, totalReserved) = min(192, 270) = 192
reservedFromDeposit = totalReserved - reservedFromWinnings = 78
availableWinnings = 192 - 192 = 0   ← chip
availableDeposit = 5742 - 78 = 5664 ← chip
```

Begge tall stemmer eksakt med UI. Bug-en er **ikke** i chip-rendering eller cache-stale; det er **én orphan-reservation som ikke ble swept**.

## Bevis-kjede

### 1. API-respons fra prod (logget inn som testbruker som matcher Tobias' wallet)

Login-respons: `"balance": 5664` (dette er `availableBalance`, ikke gross).

`GET /api/wallet/me`:
```json
{
  "account": {
    "id": "wallet-user-27436825-50ae-4ce6-bf67-7eda5956d4e3",
    "balance": 5934,
    "depositBalance": 5742,
    "winningsBalance": 192,
    "reservedDeposit": 78,
    "reservedWinnings": 192,
    "availableDeposit": 5664,
    "availableWinnings": 0,
    "availableBalance": 5664
  }
}
```

### 2. DB-state for `wallet_accounts` — matcher det Tobias rapporterte

```
deposit_balance:  5742.000000
winnings_balance:  192.000000
balance:          5934.000000  (generert kolonne)
```

### 3. DB-state for `app_wallet_reservations` — orphan-rad funnet

```
                  id                  | amount_cents |  status   |          created_at           |         committed_at          |         expires_at         
--------------------------------------+--------------+-----------+-------------------------------+-------------------------------+----------------------------
 c0e0d319-86c8-45b5-8dba-a31d96c3b07e |          240 | committed | 2026-04-26 17:53:33.242912+00 | 2026-04-26 17:54:00.253269+00 | (n/a)
 27eee909-dc0b-4dde-98c7-4e5699a45a6c |          270 | active    | 2026-04-26 17:33:03.715565+00 | NULL                          | 2026-04-26 18:03:03.717+00  ← ORPHAN
 a7362cba-cacd-4f5c-be97-0e7cadb3034a |           90 | committed | 2026-04-26 17:21:29.731937+00 | 2026-04-26 17:26:28.254508+00 | (n/a)
```

`NOW() = 2026-04-26 18:06:28` ⇒ orphan har vært expired i 3m25s, men ikke markert.

### 4. Augmenter-aritmetikk validerer UI-tallene

`apps/backend/src/routes/wallet.ts:458-490` `augmentAccountWithReservations()`:

```typescript
const reservations = await walletAdapter.listActiveReservations(account.id);
// returns 1 row with amount = 270 (treated as NOK)
let totalReserved = 270;

const reservedFromWinnings = Math.min(account.winningsBalance, totalReserved);
//  = Math.min(192, 270) = 192
const reservedFromDeposit = totalReserved - reservedFromWinnings;
//  = 270 - 192 = 78

const availableDeposit = Math.max(0, account.depositBalance - reservedFromDeposit);
//  = 5742 - 78 = 5664
const availableWinnings = Math.max(0, account.winningsBalance - reservedFromWinnings);
//  = 192 - 192 = 0
```

**Tallene UI viser er nøyaktig hva augmenter-en regner ut.** Chip-rendering er ikke buggy.

## Hvorfor er reservasjonen orphan?

Tre kommitterte reservasjoner i tidsserien:

1. **17:21:29** reservert 90 kr → committed 17:26:28 (4 brett buy-in 90 kr)
2. **17:33:03** reservert **270 kr** → **ALDRI committed/released** ← orphan
3. **17:53:33** reservert 240 kr → committed 17:54:00 (4 brett buy-in 240 kr)

Mellom 17:33 og 17:53 (20 minutter) skjedde noe som armed 270 kr (mer enn et enkelt 4-brett kjøp på 240 kr) men aldri committet eller frigjorde. Mulige årsaker:

1. **Server-krasj mellom `bet:arm` og `startGame`** — samsvarer med BIN-693 Option B docs som sier dette er nettopp den situasjonen `expireStaleReservations` skal håndtere.
2. **Klient-side cancel/disarm som ikke kalte `releaseReservation` korrekt** — hvis `cancelAll` ble kjørt men `clearReservationId` aldri ble kalt på server-side, ligger reservasjonen igjen.
3. **Feilet `increaseReservation`-call som lekket en partial reservation** — hvis Tobias armed 4 brett (240 kr) og deretter prøvde å legge til 1 brett (60 kr) men feilet halvveis, kan totalen ha blitt feil-summert til 270.

Vi har ikke nok logger i denne worktreen til å avgjøre hvilken — sjekk Render-logger 17:30-17:35 for `bet:arm` / `releaseReservation` / `[wallet-reservation]`-meldinger.

## Hvorfor sweepet ikke `WalletReservationExpiryService` denne?

`WalletReservationExpiryService.start()` kalles i `apps/backend/src/index.ts:2623`. Default tick-interval er 5 minutter (`WALLET_RESERVATION_EXPIRY_TICK_MS`).

Reservasjonen expired 18:03:03. Vi sjekket 18:04:45 (1m42s senere) → ikke swept ennå (forventet — neste tick kommer ~5 min etter forrige tick). Sjekket igjen 18:06:28 (3m25s etter expiry) → **fortsatt ikke swept**.

Sannsynlige forklaringer:
- **Tick interval drift**: hvis siste tick var 17:30, neste er 17:35, deretter 17:40, …, 18:00, 18:05 → kunne gått glipp av rad som expired 18:03 hvis tick-en på 18:05 ikke har kjørt før vi sjekket 18:06.
- **Multi-node deploy + Redis-lock**: `JobScheduler.lock` brukes for daily-report osv., men **`WalletReservationExpiryService` har ingen lock** (sjekk `apps/backend/src/wallet/WalletReservationExpiryService.ts` — den lager bare `setInterval` uten distributed-lock-koordinasjon). På Render starter ingen mer enn 1 instans for "starter" plan, så det burde ikke være et issue, men hvis worktre-en kjører flere noder ville det vært et problem.
- **Service ikke startet**: `walletReservationExpiryService.start()` er gated på `if (jobsEnabled)` på linje 2615-2619. Hvis env-var deaktiverer jobs i en deploy-konfig vil ingen sweep kjøre.

Verifiser med Render-logger: søk etter `[wallet-reservation-expiry] expired N stale reservations` (logges kun når count > 0). Hvis null treff på 24 timer ⇒ servicen kjører ikke.

## To bugs å fikse, én tabbe å rydde

### Bug 1 — orphan reservation må sweepes nå (akutt)

Manuell DB-fix for å låse opp Tobias' chip-saldo umiddelbart:

```sql
UPDATE app_wallet_reservations
   SET status = 'expired', released_at = NOW()
 WHERE id = '27eee909-dc0b-4dde-98c7-4e5699a45a6c'
   AND status = 'active';
```

Etter denne oppdateringen vil `GET /api/wallet/me` returnere `availableDeposit=5742, availableWinnings=192, availableBalance=5934` og chip-en vil vise korrekt.

### Bug 2 — bekreft at expiry-cron faktisk kjører på prod

- Render-logger: søk etter `[wallet-reservation-expiry] expired` (kun når count > 0) ELLER legg til alltid-logg per tick i `WalletReservationExpiryService.tick()` for å se "puls".
- Hvis ikke startet: sjekk `jobsEnabled` env-flag og `WALLET_RESERVATION_EXPIRY_TICK_MS`.
- Vurder å redusere tick-intervallet på prod fra 5 min til 1 min for raskere recovery.

### Tabbe — kolonnenavn `amount_cents` lyver (lavprioritet)

`app_wallet_reservations.amount_cents` lagrer faktisk NOK (ikke øre/cents). Eksempel-rader: 90, 240, 270, 2.40 (faktisk lagret som `2.40`). Hele kjeden i `PostgresWalletAdapter`:
- `reserve()` insert: `[$3 = amount-i-NOK]` linje 1419
- `mapReservationRow()`: `amount: Number(row.amount_cents)` linje 1301 — leser direkte uten å dele på 100

Konsistens-bug 0 her, men kolonnenavnet er misvisende. Bør **enten**:
- (a) Migrer kolonnen til faktisk cents/øre (× 100, og oppdater lese-paths)
- (b) Renavn kolonnen `amount_nok` så det matcher virkeligheten

Anbefaling: (b) er enklere og involverer ingen verdi-konvertering. Lavt prioritet — påvirker ikke logikken — men gjør koden mindre forvirrende for nye utviklere.

## Hva chip-koden gjør riktig

Vi sjekket grundig om det var en cache-stale eller render-bug. Det er det ikke:

- `apps/backend/public/web/lobby.js:333` `refreshBalanceNow()` har cache-buster `?_=${Date.now()}` (BIN-2026-04-26-fix).
- `apps/backend/public/web/lobby.js:300` `applyWalletToHeader()` foretrekker `availableDeposit`/`availableWinnings` fra API, fall-back til `depositBalance`/`winningsBalance`.
- `apps/backend/public/web/lobby.js:412` `_balanceSyncHandler` håndterer både full available-payload og legacy gross-payload, hopper aldri over render uten autoritativ refetch.
- `packages/game-client/src/bridge/GameBridge.ts:334` emitterer `me.balance` (= server-side available) på hver `room:update`.

Renderingen er korrekt — den viser hva serveren sier, og serveren regner ut det korrekt fra reservation-state. Det er reservation-state som har orphan-rader.

## Henvisninger

- `apps/backend/src/routes/wallet.ts:458-490` — augmentAccountWithReservations (winnings-first)
- `apps/backend/src/adapters/PostgresWalletAdapter.ts:1281-1318` — reservasjons-skjema + map
- `apps/backend/src/adapters/PostgresWalletAdapter.ts:1607-1619` — listActiveReservations
- `apps/backend/src/adapters/PostgresWalletAdapter.ts:1634-1646` — expireStaleReservations
- `apps/backend/src/wallet/WalletReservationExpiryService.ts:1-93` — bakgrunns-tick
- `apps/backend/src/index.ts:1000` — service-instansiering
- `apps/backend/src/index.ts:2623` — service-start (gated på jobsEnabled)
- `apps/backend/src/sockets/gameEvents/roomEvents.ts:131` — bet:arm reserveringskall
- `apps/backend/public/web/lobby.js:300-325` — applyWalletToHeader
- `apps/backend/public/web/lobby.js:333-341` — refreshBalanceNow med cache-buster
- `apps/backend/public/web/lobby.js:397-467` — balanceChanged event-handler
- `packages/game-client/src/bridge/GameBridge.ts:334-338` — emit balanceChanged

## Neste skritt

1. **Akutt**: kjør UPDATE-SQL ovenfor for å frigjøre Tobias' chip nå.
2. **Kort sikt (i dag)**: verifiser via Render-logger at `WalletReservationExpiryService` faktisk tikker.
3. **Mellom-sikt (denne uken)**: legg til en startup-sweep så orphan-reservasjoner som overlevde en server-restart ikke blokkerer chips ved første brukerbesøk etter restart. Kall `expireStaleReservations(Date.now())` én gang ved boot, før første tick-interval.
4. **Lavt prioritet**: rename `amount_cents` → `amount_nok` for å matche faktisk lagring.

## Fix-prioritet

| Tiltak | Effort | Innvirkning |
|---|---|---|
| Manuell SQL-sweep nå | 30s | Tobias' chip korrekt umiddelbart |
| Verifiser cron tikker | 15min | Bekrefter at fremtidige orphans blir swept |
| Boot-sweep ved start | 30min | Robust mot server-restart-orphans |
| Tick-interval ned til 60s | 5min | Raskere recovery, billig |
| Rename `amount_cents` | 2t | Kun cleanup |
