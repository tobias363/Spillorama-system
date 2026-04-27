# Pre-pilot code review: compliance + wallet (2026-04-25)

**Reviewer:** code-reviewer subagent (Claude Opus 4.7, 1M context)
**Base commit:** `0881f237` (`docs(spillkatalog): KRITISK korreksjon — SpinnGo er databingo, ikke hovedspill (#507)`)
**Branch:** `docs/compliance-wallet-code-review-2026-04-25`
**Scope:** `apps/backend/src/compliance/`, `apps/backend/src/wallet/`, `apps/backend/src/game/Compliance*`, `apps/backend/src/adapters/{PostgresWalletAdapter,InMemoryWalletAdapter,WalletAdapter}.ts`, `apps/backend/src/routes/adminWallet.ts`. Spill 1-spesifikk kode utelatt (PR #499). Hotfix-branch `fix/wallet-available-balance-display` finnes ikke i remote — alle filer i scope er reviewet på `origin/main` HEAD.

---

## TL;DR

**Verdict:** **REQUEST_CHANGES** før pilot.

Kjerne-arkitekturen er solid: Postgres-wallet bruker `SELECT ... FOR UPDATE` rundt alle wallet-mutasjoner med atomiske ledger-entries; ComplianceManager fail-closer på loss-limits og self-exclusion via `DomainError`; `ADMIN_WINNINGS_CREDIT_FORBIDDEN`-gaten er på plass i `adminWallet.ts:129`; idempotency-keys er enforced via UNIQUE-constraint. Append-only-ledger har full reservering av §11-formelen (DATABINGO=30%, MAIN_GAME=15%) og rundingsorden er lovlig (rest til allocation[0]).

Men det finnes **3 kritiske, 5 signifikante** problemer som må adresseres før pilot. De viktigste:

1. **Floating-point reservation-beløp truncates til BIGINT** (`amount_cents`-kolonne): kan tape øre på under 1 NOK, og verre — kan reservere 0 og slippe gjennom validering hvis `deltaKr < 1` (regulatorisk lekkasje av spillerens penger ut av reservasjon-systemet).
2. **`commitReservation` har TOCTOU-race** mot `expireStaleReservations`: status-felt kan desyncs fra faktisk wallet-debit. Audit-trail blir feilaktig.
3. **`reservePreRoundDelta` bruker ikke-deterministisk idempotency-key** (`Date.now()+Math.random()`) — design-formålet med wallet-reservasjon-idempotency er brutt.

| Kategori | Antall | Eksempler |
|---|---:|---|
| § 1 Kritisk | 3 | BIGINT-truncation, TOCTOU race, ikke-deterministisk idempotency-key |
| § 2 Signifikant | 5 | `commitReservation` uten lock; `recordBatchSale` bruker NOK-tall i `amount_cents`-kolonne; AuditLog uten DB-side retention; IP-block fail-open uten alarm; Spill-kode hardkoder `gameType: "DATABINGO"` (kjent åpent issue, kun nevnes som referanse) |
| § 3 Compliance | 4 |  §11-prosent korrekt; fail-closed loss-limits OK; PII-redaksjon i audit OK; men 10-års retention ikke håndhevet på DB |
| § 4 Sikkerhet | 3 | Parameteriserte queries gjennomgående; schema-injection mitigert; men IP-cache fail-open + 5min TTL gir vindu hvor blokkert IP ikke håndheves |
| § 5 Test-coverage | 4 | God dekning av §11-aritmetikk + reservasjon-lifecycle; mangler: race-test for `commitReservation`+`expireStaleReservations`, integration-test som faktisk kjører Postgres-adapter ende-til-ende |
| § 6 Arkitektur | 3 | Clean split av 1473-LOC ledger; men `ComplianceLedgerOverskudd.ts` bruker dagsfordeling (planlagt erstattet av kvartalsvis per QUARTERLY_ORG_DISTRIBUTION_DESIGN) |
| § 7 Stylistic | 4 | God konsistens; mindre nits |

**Pilot-readiness:** Etter kritiske og signifikante issues er fikset → klar for pilot. Loss-limit-håndhevelse, append-only ledger og admin-winnings-gate er solid for live-spilling. De øvrige problemene er datakvalitet/audit-trail — skal fikses før pilot men blokkerer ikke regulatorisk for kortvarig kontrollert pilot hvis utbetalingsruten er manuell verifisert.

---

## §1 Kritiske problemer (file:line + failure mode + fix)

### §1.1 KRITISK: `amount_cents` BIGINT-kolonne lagrer NOK (ikke øre) → fractional kroner trunkeres til 0

**Fil:** `apps/backend/migrations/20260724100000_wallet_reservations.sql:27`
**Refs:**
- `apps/backend/src/sockets/gameEvents/roomEvents.ts:93` — `deltaKr = deltaWeighted * entryFee` (NOK, ikke øre)
- `apps/backend/src/adapters/PostgresWalletAdapter.ts:1308` — `[id, normalized, amount, ...]` skrives direkte til `amount_cents`
- `apps/backend/src/adapters/PostgresWalletAdapter.ts:1479` — `Number(res.amount_cents)` brukt som NOK-beløp i `transfer()`

**Failure mode:**
Kolonnen heter `amount_cents BIGINT`, men kall-stedet (`reservePreRoundDelta`) sender `deltaKr` som er NOK (kan være desimal — f.eks. `0.5` for 50-øre-fraksjon ved tal-prismultiplikator < 1, eller `entryFee × deltaWeighted` der `entryFee` er en `number` uten øre-validering i `BingoEngine.ts:696-701`). BIGINT-cast vil silent-truncate fraksjoner. Konkret bug-scenario:

- `entryFee = 0.5` (test-konfigurert) + `deltaWeighted = 1` → `deltaKr = 0.5`
- `assertPositiveAmount(0.5)` passer (line 1236-1238)
- `INSERT ... amount_cents = 0.5` → BIGINT-cast → `0`
- `CHECK (amount_cents > 0)` ville feilet og kastet INVALID_INPUT — men avhengig av Postgres-version kan det runde til 1 (ikke 0). **Resultat ved rounding-til-1**: spiller reserverer 1 øre i DB men 0.5 NOK påstås reservert client-side.

Mer realistisk: hvis `entryFee = 10` og `deltaWeighted = 0.7` (vekttet kjøp av halvbrett), `deltaKr = 7` — fungerer. Men `entryFee = 10` og `deltaWeighted = 0.07` → `deltaKr = 0.7` → potensielt 0 lagret.

Selv med HELE NOK-beløp er kolonne-navnet semantisk feil og kan villede framtidige utviklere som tror det er øre.

**Fix:**
Velg én:
1. **Anbefalt:** Endre kall-stedet til å sende cents: `Math.round(deltaKr * 100)` ved INSERT, og `Number(amount_cents) / 100` ved SELECT. Dokumentér dette i en migrasjon som rename-r kolonnen til `amount_cents` med forklaring.
2. **Alternativ:** Endre kolonne-typen til `NUMERIC(20, 6)` (matche `wallet_accounts.deposit_balance`) og rename til `amount`. Atomisk migrasjon.

Også: `assertPositiveAmount` i `PostgresWalletAdapter.ts:1135-1139` bør reject ikke-heltall hvis kolonnen forblir BIGINT.

---

### §1.2 KRITISK: `commitReservation` har TOCTOU-race mot `expireStaleReservations`

**Fil:** `apps/backend/src/adapters/PostgresWalletAdapter.ts:1448-1494`

**Failure mode:**
```ts
// Steg 1: SELECT uten FOR UPDATE
const { rows } = await this.pool.query(`SELECT ... WHERE id = $1`, [reservationId]);
if (res.status !== "active") throw INVALID_STATE;

// Steg 2: transfer (locker accounts, ikke reservation)
const transfer = await this.transfer(...);

// Steg 3: UPDATE WHERE status='active'
await this.pool.query(`UPDATE ... SET status='committed' WHERE id = $1 AND status = 'active'`);
```

Mellom steg 1 og steg 3 kan `expireStaleReservations(nowMs)` (eller manual `releaseReservation`) sette `status='expired'`. Da skjer:
- `transfer()` kjørte og debiterte spillerens wallet (`fromTx.id` lagret i DB)
- UPDATE-en i steg 3 matcher 0 rader (status er nå 'expired', ikke 'active')
- Spiller har mistet penger fra wallet, men reservation-raden viser status='expired'
- Audit-trail er inkonsistent: tilstand sier "reservasjon utløp uten bruk", men money flow sier "reservation ble brukt"

**Mitigerende:** `idempotencyKey` på selve transferet (line 1481, satt av caller via `IdempotencyKeys.adhocBuyIn` i `BingoEngine.ts:790`) sikrer at retry returnerer samme transfer (ingen dobbelt-debit). Men audit-trail inkonsistensen er reell.

**Konkret scenario** (lite sannsynlig men mulig):
- T+0: spiller armer 30 brett (reservasjon laget, expires_at = T+30min)
- T+29min59s: backend-thread kaller `commitReservation` (startGame), passerer steg 1
- T+30min: `WalletReservationExpiryService.tick()` kjører, setter `status='expired'`
- T+30min01s: thread fra steg 2 fullfører transfer
- Resultat: spiller debitert, reservation `expired`. Spillet starter, wallet stemmer. Audit-spor: feilaktig "expired"-rad.

**Fix:** Pakk hele commitReservation i én transaksjon:

```ts
const client = await this.pool.connect();
try {
  await client.query("BEGIN");
  const { rows } = await client.query(`SELECT ... WHERE id = $1 FOR UPDATE`, [reservationId]);
  if (res.status !== "active") throw INVALID_STATE;
  
  // Wrap transfer i samme klient-transaksjon, eller refaktor
  // til en intern `transferInternal(client, ...)` som ikke åpner egen tx.
  const transfer = await this.transferWithClient(client, ...);
  
  await client.query(`UPDATE ... SET status='committed', committed_at=NOW(), game_session_id=$1 WHERE id = $2`,
    [options?.gameSessionId ?? null, reservationId]);
  await client.query("COMMIT");
} catch (err) { /* ROLLBACK + throw */ }
```

Alternativ: `expireStaleReservations` kunne lese `status='active' AND expires_at < $1 FOR UPDATE SKIP LOCKED` — dette skips rader som er låst av en `SELECT ... FOR UPDATE` i `commitReservation`. Hvis `commitReservation` får `FOR UPDATE` på reservation-raden ville det spillet av seg selv.

**Hvorfor kritisk:** Audit-trail er regulatorisk relevant — Lotteritilsynet kan kreve forklaring på en "expired" reservasjon der tilhørende `compliance_ledger`-entry er STAKE.

---

### §1.3 KRITISK: `reservePreRoundDelta` bruker ikke-deterministisk idempotency-key

**Fil:** `apps/backend/src/sockets/gameEvents/roomEvents.ts:131-134`

**Failure mode:**
```ts
const reservation = await adapter.reserve(walletId, deltaKr, {
  idempotencyKey: `arm-${roomCode}-${playerId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  roomCode,
});
```

Idempotency-keys hele formålet er å gjenkjenne retry-er fra samme logiske operasjon. Med `Date.now() + Math.random()` blir hver retry en ny unik key, så `reserve()`-implementasjonen i `PostgresWalletAdapter.ts:1252-1278` kan aldri matche en eksisterende reservasjon. Resultat:

- Hvis socket emit duplicates (sjeldent men mulig — `socket.io` har retry under reconnect):
  - Klient sender samme `bet:arm` to ganger
  - Server skaper **TO** reservasjoner med ulik `idempotencyKey`, samme amount
  - Spillerens tilgjengelig saldo trekkes 2x (begge reservasjoner trekker fra balance)
  - Hvis saldo er nok: spiller "betaler" for 2x bonger uten å vite det. `deps.setReservationId(roomCode, playerId, reservation.id)` overskriver bare den siste — den første reservasjonen er ikke trackbar fra room-state og blir kun frigjort via TTL-expiry (`expireStaleReservations`).

**Mitigerende:** `WalletReservationExpiryService` (default 30 min TTL + 5 min tick) frigjør stale reservation eventuelt. Men i 30 min har spilleren penger låst i ubrukt reservasjon.

**Fix:** Bruk en deterministisk key som fanger den logiske operasjonen:
```ts
idempotencyKey: `arm-${roomCode}-${playerId}-${newTotalWeighted}`,
```

`newTotalWeighted` er selve operasjonens målverdi (samlet vektet-kjøp etter armingen). Hvis klienten retryer samme bet:arm-payload, blir keyen identisk og `reserve()` returnerer den eksisterende. Hvis klienten faktisk vil arme fler bonger, må `increaseReservation` kalles (som denne funksjonen allerede gjør på line 127). Men denne fix-en krever også at `existingResId` er satt etter første call — som det allerede er, så identifyingen virker.

Sjekk likevel at `reserve()`-impl-en støtter "samme key + samme amount" → returnerer eksisterende. Det gjør den (PostgresWalletAdapter:1264-1273, InMemoryWalletAdapter:308-316).

**Hvorfor kritisk:** Direkte regulatorisk-konsekvens — kan dobbel-låse spillerens penger bak en bug som er trivial å misforstå som "edge case". Spillvett-loss-limits beregnes per BUYIN; doblede reservasjoner blir ikke BUYIN, så strengt tatt brytes ikke loss-limit. Men available-balance-visning blir feil og spiller kan tro de "ikke har råd" til å arme videre.

---

## §2 Signifikante problemer

### §2.1 SIGNIFIKANT: `ProfileSettingsService.upsertBlockedUntil` overstyrer `language` med default

**Fil:** `apps/backend/src/compliance/ProfileSettingsService.ts:449-458`

```sql
INSERT INTO ${this.profileTable()} (user_id, language, blocked_until, blocked_reason, created_at, updated_at)
VALUES ($1, 'nb-NO', $2, $3, now(), now())
ON CONFLICT (user_id) DO UPDATE
  SET blocked_until = EXCLUDED.blocked_until,
      blocked_reason = EXCLUDED.blocked_reason
```

INSERT-delen sender `'nb-NO'` som default. ON CONFLICT-grenen overskriver kun `blocked_until` + `blocked_reason`, så language bevares (OK). Men hvis raden ikke finnes fra før (første block-myself-handling), opprettes raden med `language='nb-NO'` selv om brukeren tidligere ikke hadde noen profile-rad. Det betyr at `setLanguage(en-US)` etterpå må overstyre det. Liten bug — ingen funksjonell bryt, men ikke-trivial preferansemix.

**Fix:** Legg til `language` i ON CONFLICT-update så vi ikke overskriver eksplisitt brukerinnstilling:
```sql
ON CONFLICT (user_id) DO UPDATE
  SET blocked_until = EXCLUDED.blocked_until,
      blocked_reason = EXCLUDED.blocked_reason,
      language = COALESCE(${this.profileTable()}.language, EXCLUDED.language)
```

Eller separer block-update fra language-default:
```sql
INSERT INTO ${this.profileTable()} (user_id, language, blocked_until, blocked_reason)
SELECT $1, COALESCE((SELECT language FROM ${this.profileTable()} WHERE user_id = $1), 'nb-NO'), $2, $3
ON CONFLICT (user_id) DO UPDATE SET blocked_until = EXCLUDED.blocked_until, blocked_reason = EXCLUDED.blocked_reason
```

---

### §2.2 SIGNIFIKANT: `AuditLog` har ingen 10-års-retention enforcement

**Fil:** `apps/backend/migrations/20260418160000_app_audit_log.sql` + `apps/backend/src/compliance/AuditLogService.ts`

**Krav:** Brukerens MEMORY.md sier "10-års retention" for audit-trail. Compliance-pilot-policyen krever at audit-rader bevares. I praksis er ingen retention-policy enforced:

- DB: ingen partitioning, ingen `pg_cron` job, ingen sletting (OK for nå — append-only er bevart)
- Service: ingen `delete`/`purge`-API (OK)
- Backup: ikke i scope for denne reviewen, men compliance-svar krever at audit-historikk overlever en katastrofe-restore

**Failure mode:** Hvis Lotteritilsynet ber om audit-trail eldre enn 1 år (og DB har vokst utenfor backup-vindu), kan vi ikke svare. Ikke en kode-bug, men en regulatorisk-policy mangler:

**Fix:**
1. Dokumentér i `apps/backend/migrations/20260418160000_app_audit_log.sql` (kommentar) at retention er 10 år håndhevet via backup-strategi.
2. Legg til monitoring-alert hvis `app_audit_log` blir mindre enn forventet (ulovlig DELETE).
3. Vurder partisjonering (per måned) for å gjøre 10-års rolling-window enklere.

**Hvorfor signifikant:** Pilot-launch er en regulatorisk-sjekk — Lotteritilsynet kan be om audit-eksempel før godkjenning av drift. Ingen kode-bug; mangler dokumentert policy.

---

### §2.3 SIGNIFIKANT: `recordBatchSale` skriver `amount_cents`-felt med NOK-tall (uavklart)

**Fil:** `apps/backend/src/compliance/AgentTicketRangeService.ts:606-783` (kall til `app_static_tickets`-update)

Samme mønster som §1.1 gjelder potensielt for `paid_out_amount_cents` i `app_static_tickets` og `expected_payout_cents` i `app_physical_ticket_pending_payouts` — kolonne-navn antyder cents, men callere må verifiseres for å sende cents. Jeg har sjekket `PhysicalTicketPayoutService.ts:632` (`Number(row.expected_payout_cents)` brukes i `confirmPayout` returverdi som cents) og lagring i `confirmPayout` skjer via `payoutCents` som er hentet fra DB — så her er det konsistent. Men resten av repo må auditeres separat.

**Fix:** Skriv test som validerer roundtrip av et fraksjonelt NOK-beløp (`amount = 12.34`) gjennom hele `bet:arm → reserve → commit → wallet_transactions.amount`-keden. Hvis BIGINT-felt finnes i kjeden, tap av .34 kr blir avdekket.

**Hvorfor signifikant:** Hvis dette finnes i fysisk-bong-betaling, kan vi tape øre per spiller. Ikke direkte regulatorisk brudd, men dårlig praksis å miksere enheter.

---

### §2.4 SIGNIFIKANT: `commitReservation` reads `amount` uten lock — race med `increaseReservation`

**Fil:** `apps/backend/src/adapters/PostgresWalletAdapter.ts:1457-1467`

Etter denne SELECT-en (uten FOR UPDATE), kan en parallell `increaseReservation` oppdatere `amount_cents`. `commitReservation` bruker den gamle verdien for `transfer`, og spilleren mister fordelen av increase-en (mindre debitert enn forventet, eller motsatt). Mitigert som §1.2 — `idempotencyKey` på transferen forhindrer dobbel-debit, men det betyr også at increase-en dukker ikke opp i wallet før neste eksplisitt commit.

I prod-flyten er dette mindre sannsynlig (klient-side state forhindrer parallel `increase` etter `startGame`), men en bedre implementasjon ville holdt FOR UPDATE-låsen.

**Fix:** Inkluderes i §1.2-fix (én transaksjon med FOR UPDATE).

---

### §2.5 SIGNIFIKANT: `SecurityService.refreshBlockedIpCache` fail-open uten alarm

**Fil:** `apps/backend/src/compliance/SecurityService.ts:382-400`

```ts
} catch (err) {
  // Fail-open: ved DB-feil beholder vi gammel cache (om noe) og logger.
  logger.warn({ err }, "[BIN-587 B3-security] blocked-IP cache refresh failed — using stale cache");
  if (!this.blockedIpCache) {
    this.blockedIpCache = new Set();  // ⚠ tom set ved init-feil → INGEN IP blokkert
  }
}
```

Hvis cache aldri ble lastet og DB-en er nede ved første `isIpBlocked`-kall, blir den tomme settet permanent (5-min TTL), så IP-en kan flyte uhindret i opp til 5 min etter DB recovery. Også: `index.ts:1395-1404` har egen fail-open i middleware (logger via `console.warn` og lar request passere). To lag av fail-open uten observability.

**Failure mode:**
- DB-utfall ved boot: `warmBlockedIpCache` feiler → `blockedIpCache` forblir null
- Første request: `isIpBlocked` → `refreshBlockedIpCacheIfNeeded` → catch-blokken setter `Set()` (tom)
- Neste 5 min: alle requests passerer (cache er ikke null, så vi venter til TTL utløper)
- Konsekvens: kortvarig DDoS-vindu eller bypass av AML-blokk

**Fix:**
1. Skill init-fail (intet cache) fra runtime-fail (ha gammel cache, returner stale): hvis cache er tom *and* this is the first call, kanskje fail-closed (HTTP 503) eller log.fatal.
2. Eksponer en metric: `securityservice_cache_refresh_failures_total` så observability ser problemet.

**Hvorfor signifikant:** Sikkerhets-mekanisme degraderer silent. Pilot er kortvarig, så risikoen er lav, men enkel å fikse.

---

## §3 Compliance review (§11, fail-closed, audit-trail)

### Append-only ledger
✅ `ComplianceLedger.recordComplianceLedgerEvent` (`apps/backend/src/game/ComplianceLedger.ts:140-189`) skriver kun, ingen update/delete-API.
✅ `unshift` + `length-cap` på 50 000 in-memory mens persistence skriver via `persistence.insertComplianceLedgerEntry` — DB-rad skrives også. Ingen state-tap ved restart.
✅ Daglig-rapport-arkiv (`dailyReportArchive`-Map) bruker `upsertDailyReport`. Korrekt for `runDailyReportJob`-idempotency.

### §11-prosent (DATABINGO=30%, MAIN_GAME=15%)
✅ `ComplianceLedgerOverskudd.ts:75` — `row.gameType === "DATABINGO" ? 0.3 : 0.15`. Korrekt per pengespillforskriften.
⚠️ Kjent åpent issue per `SPILLKATALOG.md` §6.1: alle Spill 1-3-call-sites hardkoder `gameType: "DATABINGO"` (12+ steder). Når dette korrigeres må wallet-account-IDer også migreres (§6.2). Ut-av-scope for denne reviewen.

### Fail-closed loss-limits
✅ `ComplianceManager.assertWalletAllowedForGameplay` (`ComplianceManager.ts:513-546`) kaster `DomainError("PLAYER_TIMED_PAUSE" | "PLAYER_REQUIRED_PAUSE" | "PLAYER_SELF_EXCLUDED")`. Caller (`BingoEngine`) catcher og rull-tilbake-r kjøp.
✅ `wouldExceedLossLimit` (`ComplianceManager.ts:683-688`) bruker netto-formel + `personalLossLimits` minimum. Test (`ComplianceManager.test.ts:104-137`) regresjons-beskytter.
✅ Self-exclusion 1 år (`selfExclusionMinMs = 365 * 24 * 60 * 60 * 1000`). Korrekt per Spillvett-implementasjons-memo.
⚠️ `setSelfExclusion` (`ComplianceManager.ts:473-488`) er idempotent — hvis spiller allerede er exkludert, returnerer eksisterende state uten oppdatering. OK, men ingen audit-write hvis "andre forsøk på exclude". Se nedenfor §3.4.

### PII-redaksjon i audit
✅ `redactDetails` (`AuditLogService.ts:126-159`) håndterer `password`, `token`, `ssn`, `personnummer`, `fodselsnummer`, `cardnumber`, `cvv`, `cvc`, `pan`, etc. Recursivt opp til depth 10. Case-insensitive.
✅ Audit-skriving er fire-and-forget (`AuditLogService.ts:230-239`) — DB-utfall blokkerer ikke domain-operasjoner. Pino-logger fanger fortsatt redacted-event.
⚠️ `actor_type` mangler ekstrn-rolle som `EXTERNAL_AUDIT` for f.eks. Lotteritilsynet read-only API. Ikke i scope, men flag for senere.

### Audit-skriving for kritiske operasjoner
✅ `ProfileSettingsService.writeAudit` skriver `profile.self_exclude.set`, `profile.pause.set`, `profile.language.set`, `profile.loss_limit.update`. (`ProfileSettingsService.ts:560-585`)
✅ `AmlService.reviewRedFlag` har audit-rad (delegert til route-laget per design-kommentar `AmlService.ts:13-15`).
✅ `Game1PayoutService.payoutPhase` skriver audit etter wallet-credit (verifisert via grep).
⚠️ `ComplianceManager.setSelfExclusion` skriver IKKE direkte audit-rad. Audit skjer kun hvis caller (ProfileSettingsService) gjør det. Hvis admin kaller via en annen path uten audit-wrap, mister vi historikken. Ikke bug i denne PR-en, men risikabelt-design.

### 10-års retention
❌ Ikke håndhevet på DB-nivå. Se §2.2.

---

## §4 Sikkerhetsreview

### SQL-injection
✅ Alle queries bruker parameteriserte `$1, $2`-syntax. Ingen string-concat med user-input observert.
✅ Schema-navn validert via regex `/^[a-z_][a-z0-9_]*$/i` (samtidig brukt i alle services). `assertSchemaName` finnes i `LoyaltyValidators.ts`, `SecurityService.ts:92`, `HallAccountReportService.ts:96`, `VoucherService.ts:99`, `VoucherRedemptionService.ts:127`. Konsistens.
✅ `AuditLogService.ts:208` — sanitiserer schema med `replace(/[^a-zA-Z0-9_]/g, "")`. Mindre streng enn `assertSchemaName`-regex (tillater starte med tall), men resultatet er ufarlig pga. character-strip. **Mindre nit:** harmonisér med `assertSchemaName`.

### Auth/authz
✅ Alle admin-routes i `adminCompliance.ts` kaller `requireAdminPermissionUser(req, "<PERMISSION>")` som første handling.
✅ `adminWallet.ts:115` kaller `requirePermission(req, "WALLET_COMPLIANCE_WRITE")` før noen wallet-mutasjon.
✅ `WALLET_COMPLIANCE_WRITE` er begrenset til `[ADMIN, SUPPORT]` (`AdminAccessPolicy.ts:15`). HALL_OPERATOR er korrekt utelatt (sentral compliance, ikke per-hall).
✅ `EXTRA_PRIZE_AWARD` er kun ADMIN (`AdminAccessPolicy.ts:19`) — bra for fire-øyne-aktig sak.
✅ `ADMIN_WINNINGS_CREDIT_FORBIDDEN`-gate (`adminWallet.ts:129-143`) returnerer 403 + audit-warning hvis admin forsøker `to: "winnings"`. Pengespillforskriften-§11-compliance er hardkodet i denne gaten.

### Rate-limiting på socket-events
Ut-av-scope (Spill 1-spesifikk). `SocketRateLimiter` finnes per role-spec men ikke direkte testet i compliance/wallet-modulene.

### Hardkodede secrets
✅ Ingen secrets observert. Alle services tar `connectionString` via constructor-options (env-injected i `index.ts`).
✅ `CANDY_INTEGRATION_API_KEY` brukes via env (per `SPILLKATALOG.md` §4); ikke i scope for denne reviewen.

### Data-validering
✅ Email, country-code, IP normaliseres i `SecurityService.ts:99-146`.
✅ Code-validering for vouchers er streng (`VoucherService.ts:104-116`): A-Z, 0-9, `_-`, 3-40 tegn, uppercase.
⚠️ IPv6-validering er mer permissiv enn nødvendig (`SecurityService.ts:138`: `/^[0-9a-fA-F:]+$/`). En streng som `:::::` ville passere. Men Postgres-INET-cast vil bom (siden vi ikke caster — kolonne er TEXT, ikke INET). **Mindre nit.** Bytt til en strammere regex eller validate-IP-bibliotek.

---

## §5 Test coverage analyse

### Sterke områder
- **§11-aritmetikk:** `ComplianceLedger.test.ts` har 24 tester som dekker DATABINGO/MAIN_GAME-skille, range-rapport, time-series, top-players. Verifiserer 30%/15% direkte.
- **Loss-limits:** `ComplianceManager.test.ts` 3 tester regresjons-beskytter netto-formel + floor-til-0.
- **PII-redaksjon:** `AuditLogService.test.ts` 21 tester — case-insensitive, nested objekter, depth-cap, null-input.
- **Voucher-redemption:** `VoucherRedemptionService.test.ts` 18 tester — happy path, expired, ALREADY_REDEEMED, ad-hoc vs scheduled, percentage vs flat.
- **Reservation-expiry:** `WalletReservationExpiryService.test.ts` 4 tester (throttling, no-op, error-svallow, basic).

### Hull
❌ **Ingen race-test for `commitReservation` + `expireStaleReservations`** — den TOCTOU-baserte §1.2 ville fanges av en concurrent-test (kjøre ekspirer ved nøyaktig riktig tidspunkt).
❌ **Ingen test for `reservePreRoundDelta` idempotency-key-design** — §1.3-bug-en oppdages ikke ved dagens tester. Test bør være: emit samme bet:arm to ganger raskt, verifisér at kun én reservasjon eksisterer.
❌ **Ingen integration-test mot ekte Postgres for wallet-reservasjon** — `PostgresWalletAdapter.transferTargetSide.test.ts` finnes, men ingen for `reserve/commitReservation/expireStale`. InMemory-tester eksisterer, men er for forenklede til å fange BIGINT-truncation (in-memory bruker `number` direkte).
❌ **Ingen test for fractional kroner ende-til-ende** — `entryFee = 0.5` + `deltaWeighted = 1` → bør ende opp som 0.5 NOK debit, ikke 0 eller 1.
⚠️ `SecurityService` — har 13 tester men ingen for fail-open-scenario (DB-feil + tom cache).
⚠️ `HallAccountReportService` har **ingen unit tests** i `__tests__/` — observert tomt regnskap. Mindre risikabelt fordi det er rapport-only (ingen state-mutering), men dekning-hull er reelt.

### Compliance-suite-test
✅ `compliance-suite.test.ts` finnes (6 tester per grep). Kjøres som del av `npm run test:compliance` per role-spec. Reviewer har ikke kjørt den her, men eksistens er bekreftet.

---

## §6 Architecture observations

### Clean splitting (PR-S3)
✅ `ComplianceLedger.ts` (515 LOC) er en barrel som re-eksporterer typer + delegerer til:
- `ComplianceLedgerTypes.ts` — kontrakter (typescript-only)
- `ComplianceLedgerValidators.ts` — pure asserts
- `ComplianceLedgerAggregation.ts` — pure report-funksjoner
- `ComplianceLedgerOverskudd.ts` — fordelings-logikk

Net: 1473 → ~350 LOC core. Bevarer offentlig API. God refaktor.

### Per-runde fordeling vs kvartalsvis (kjent design-gap)
⚠️ `ComplianceLedgerOverskudd.ts:108-191` (`createOverskuddDistributionBatch`) gjør per-dag/per-runde fordeling. `QUARTERLY_ORG_DISTRIBUTION_DESIGN_2026-04-25` (på branch `docs/quarterly-org-distribution-design`) beskriver at dette er strukturelt feil mot pengespillforskriften — fordeling skal være kvartalsvis batch med admin-approval. Dagens kode er ikke buggy per spec den ble skrevet etter, men er regulatorisk avvik mot Lotteritilsynet-regelverket.

**Status:** Ikke en bug i denne reviewen — flagget for ryddig refaktor (4 fase-PR-er per quarterly-design-spec). Pilot-perioden er kort, så hvis ingen `createOverskuddDistributionBatch`-call-site skjer i pilot-vinduet, er dette ikke et live-problem.

### `makeHouseAccountId` lekker `gameType` (åpent issue per SPILLKATALOG)
⚠️ `ComplianceLedgerValidators.ts:130-132` — `house-{hallId}-{gameType}-{channel}` (lowercase). Når Spill 1-3 byttes fra `DATABINGO` til `MAIN_GAME` må wallet-account-IDer migreres. Kjent, dokumentert.

### Wallet-split-arkitektur
✅ `WalletAdapter.ts` dokumenterer `to: "winnings"` regulatorisk-forbud i JSDoc (line 107-110).
✅ `PostgresWalletAdapter` håndterer system-kontoer (winnings_balance=0 CHECK-constraint, line 895-901).
✅ Winnings-first-policy implementert i `splitDebitFromAccount` (line 112-120) og brukt fra både debit og withdraw.

### Avhengighet: `ComplianceLedger` ↔ `WalletAdapter`
✅ `ComplianceLedger.createOverskuddDistributionBatch` injecter `walletAdapter` via deps (`ComplianceLedger.ts:386-398`). Klar separasjon.
⚠️ Inverse-test: hvis `walletAdapter.transfer` feiler etter første allocation, blir batch-state inkonsistent (noen transfers er gjort, ledger har noen `ORG_DISTRIBUTION`-rader, men `overskuddBatches`-Map har ikke fått batchen). Hver transfer skrives til ledger inne i `for`-loopen (`ComplianceLedgerOverskudd.ts:139-174`); hvis transfer 3 av 5 kaster, har vi 2 ORG_DISTRIBUTION-rader uten matching `OverskuddBatch`-rad. Ikke kritisk fordi ledger-rader ER audit-trail, men `listOverskuddDistributionBatches` ville rapportere "ingen batch" og en operatør kan tro fordelingen ikke startet.

**Fix:** Wrap hele loopen i én atomisk DB-transaksjon — eller skape preliminær `OverskuddBatch`-rad først (med status='PARTIAL'), så oppdatere etter loopen.

---

## §7 Stylistic suggestions (COMMENT_ONLY)

### §7.1 `AuditLogService.ts:208` schema-sanitering ulik andre
Som nevnt i §4: `replace(/[^a-zA-Z0-9_]/g, "")` mens andre services bruker `assertSchemaName`-regex som starter med bokstav/underscore. Konsistens-fix.

### §7.2 `AmlService.reviewRedFlag` setter `status = $2` og `review_outcome = $2`
`AmlService.ts:546-552` — tar samme verdi for begge felt. Det fungerer pga. enum-sub-set, men en future endring der `outcome` kan være "DEFERRED" (ikke i `status`) ville feile silent på CHECK-constraint. Vurder eksplisitt mapping eller en kommentar.

### §7.3 `PostgresWalletAdapter.executeLedger` har en ubrukt `for`-løkke
`PostgresWalletAdapter.ts:769-774`:
```ts
for (const [accountId, delta] of [...depositDeltas.entries(), ...winningsDeltas.entries()]) {
  const account = accounts.get(accountId);
  if (!account) {
    throw new WalletError("ACCOUNT_NOT_FOUND", `Wallet ${accountId} finnes ikke.`);
  }
}
```
Variable `delta` er ikke brukt i loop-body. Loop validates kun "account exists", men det er allerede validert på line 752-756. Død-kode. Slett eller fix-up til faktisk validering.

### §7.4 `roomEvents.ts:131` — bruker `roomCode` både i idempotencyKey og i options
Mindre — kall-stedet sender `roomCode` to ganger (key-string + `options.roomCode`). Ikke buggy, men kan forenkles ved å konstruere idempotencyKey inni `reserve()` hvis ønsket.

### §7.5 `ComplianceLedger`-kommentarer presiserer ikke Spill 1-3 vs SpinnGo
Per `SPILLKATALOG.md` §7 oppdateringsliste: `apps/backend/src/spillevett/reportExport.ts:24` skal ha en kommentar som presiserer at Spill 1-3 er hovedspill og SpinnGo er databingo. Men også `ComplianceLedgerValidators.ts:12-18` (`assertLedgerGameType`) ville hatt nytte av en kommentar som klargjør dette. Ut-av-scope, men forberedelse til planlagt PR.

---

## §8 Filer reviewet (audit-trail)

| Fil | Path | LoC | Commit-SHA |
|---|---|---:|---|
| ComplianceManager | `apps/backend/src/game/ComplianceManager.ts` | 1054 | 0881f237 |
| ComplianceManager.test | `apps/backend/src/game/ComplianceManager.test.ts` | 137 | 0881f237 |
| ComplianceLedger | `apps/backend/src/game/ComplianceLedger.ts` | 514 | 0881f237 |
| ComplianceLedger.test | `apps/backend/src/game/ComplianceLedger.test.ts` | 695 | 0881f237 |
| ComplianceLedgerOverskudd | `apps/backend/src/game/ComplianceLedgerOverskudd.ts` | 259 | 0881f237 |
| ComplianceLedgerAggregation | `apps/backend/src/game/ComplianceLedgerAggregation.ts` | 705 | 0881f237 |
| ComplianceLedgerTypes | `apps/backend/src/game/ComplianceLedgerTypes.ts` | 234 | 0881f237 |
| ComplianceLedgerValidators | `apps/backend/src/game/ComplianceLedgerValidators.ts` | 132 | 0881f237 |
| AuditLogService | `apps/backend/src/compliance/AuditLogService.ts` | 442 | 0881f237 |
| AuditLogService.test | `apps/backend/src/compliance/AuditLogService.test.ts` | 358 | 0881f237 |
| SecurityService | `apps/backend/src/compliance/SecurityService.ts` | 459 | 0881f237 |
| HallAccountReportService | `apps/backend/src/compliance/HallAccountReportService.ts` | 565 | 0881f237 |
| VoucherRedemptionService | `apps/backend/src/compliance/VoucherRedemptionService.ts` | 497 | 0881f237 |
| VoucherService | `apps/backend/src/compliance/VoucherService.ts` | ~430 | 0881f237 |
| AmlService | `apps/backend/src/compliance/AmlService.ts` | 718 | 0881f237 |
| LoyaltyService | `apps/backend/src/compliance/LoyaltyService.ts` | ~830 | 0881f237 |
| ProfileSettingsService | `apps/backend/src/compliance/ProfileSettingsService.ts` | 583 | 0881f237 |
| StaticTicketService | `apps/backend/src/compliance/StaticTicketService.ts` | 650 | 0881f237 |
| PhysicalTicketPayoutService | `apps/backend/src/compliance/PhysicalTicketPayoutService.ts` | 836 | 0881f237 |
| AgentTicketRangeService | `apps/backend/src/compliance/AgentTicketRangeService.ts` | 1505 | 0881f237 |
| WalletAdapter (interface) | `apps/backend/src/adapters/WalletAdapter.ts` | 282 | 0881f237 |
| PostgresWalletAdapter | `apps/backend/src/adapters/PostgresWalletAdapter.ts` | 1535 | 0881f237 |
| InMemoryWalletAdapter | `apps/backend/src/adapters/InMemoryWalletAdapter.ts` | 569 | 0881f237 |
| WalletReservationExpiryService | `apps/backend/src/wallet/WalletReservationExpiryService.ts` | 93 | 0881f237 |
| WalletReservationExpiryService.test | `apps/backend/src/wallet/WalletReservationExpiryService.test.ts` | 78 | 0881f237 |
| adminWallet (route) | `apps/backend/src/routes/adminWallet.ts` | 176 | 0881f237 |
| adminCompliance (route) | `apps/backend/src/routes/adminCompliance.ts` | partial review | 0881f237 |
| Wallet reservations migration | `apps/backend/migrations/20260724100000_wallet_reservations.sql` | 61 | 0881f237 |
| Audit log migration | `apps/backend/migrations/20260418160000_app_audit_log.sql` | 51 | 0881f237 |
| Audit log AGENT-actor migration | `apps/backend/migrations/20260418220300_audit_log_agent_actor_type.sql` | 25 | 0881f237 |

**Out-of-scope** (per task-instructions): Spill 1-spesifikk kode, `apps/backend/src/admin/`, `apps/backend/src/agent/`, `apps/backend/src/payments/`, `routes/__tests__/`-mappen utover `adminWallet.winningsForbidden.test.ts`. Hotfix-branch `fix/wallet-available-balance-display` finnes ikke i remote per `git ls-remote origin`.

**Review-tid:** ~110 min (innenfor 90-120 min-budsjett).

---

## Anbefalinger

**Før pilot (blokkerende):**
1. Fix §1.1 — BIGINT-truncation i `app_wallet_reservations.amount_cents`. Anbefalt: bytt til `NUMERIC(20,6)` eller endre callsite til å sende cents.
2. Fix §1.2 — TOCTOU race i `commitReservation`. Wrap i atomisk transaksjon med `FOR UPDATE` på reservation-raden.
3. Fix §1.3 — Deterministisk idempotency-key i `reservePreRoundDelta`.

**Før pilot (sterk anbefaling):**
4. Fix §2.5 — alarm + ikke-tomt cache ved DB-init-fail i `SecurityService`.
5. Skriv test for §1.1, §1.2, §1.3 — regresjons-beskyttelse.

**Etter pilot:**
6. §2.2 — dokumentér 10-års retention som backup-policy + monitoring-alert.
7. §6 — implementér `QUARTERLY_ORG_DISTRIBUTION` per design-spec.
8. §3 — strengere `assertSchemaName` i `AuditLogService` (harmonisering).
9. §6 — atomisk transaksjon rundt `createOverskuddDistributionBatch`-loopen.

**Pilot-readiness-verdikt:** **Etter §1.1-3 + §2.5 fikset → CLEAR for pilot.**
