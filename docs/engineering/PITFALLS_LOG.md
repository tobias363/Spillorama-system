# Spillorama Pitfalls Log — kumulativ fallgruve-katalog

**Status:** Autoritativ. Alle fallgruver oppdaget i prosjektet samles her.
**Sist oppdatert:** 2026-05-17
**Eier:** PM-AI (vedlikeholdes ved hver agent-sesjon + hver PR-merge med learning)

> **Tobias-direktiv 2026-05-10:** *"Når agenter jobber og du verifiserer arbeidet deres er det ekstremt viktig at alt blir dokumentert og at fallgruver blir forklart slik at man ikke går i de samme fellene fremover. Det er virkelig det som vil være forskjellen på om vi får et fungerende system eller er alltid bakpå og krangler med gammel kode/funksjoner."*

---

## Hvorfor denne loggen eksisterer

Spillorama-prosjektet har siden 2026-04 hatt 12+ PM-handoffs, 1100+ commits og ~50 agent-sesjoner. **Hvert PM-handoff har dokumentert fallgruver** — men de er spredt over 14+ filer, ikke aggregert. Resultat: nye agenter og PM-er gjentar gamle feil fordi kunnskapen ikke er gjenfinnbar.

Denne loggen er **single source of truth** for "ting som har feilet før, hvorfor det feilet, og hvordan unngå å gjenta det". Krav:

1. **Hver gang en agent eller PM oppdager en fallgruve** → legg til entry her
2. **Hver gang du skal lage et agent-prompt** → søk denne loggen for relatert kategori
3. **Hver gang en PR har "Hva fungerte ikke"** i post-mortem → entry skal speilers her
4. **Aldri slett entries** — selv etter fix er kunnskapen verdifull historisk

Loggen er **kumulativ** — eldste entries beholdes selv om koden er fikset, fordi mønsteret kan dukke opp igjen.

---

## Hvordan bruke denne loggen

### For PM (deg)
1. **Før agent-spawn:** søk etter fallgruve-kategori for domenet agenten skal jobbe på
2. **I agent-prompt:** inkluder relevante "Kjente fallgruver"-pekere som referanser
3. **Etter agent-leveranse:** legg til nye fallgruver agenten oppdaget

### For agenter
1. **Ved oppstart:** les seksjonen som matcher ditt scope (compliance, wallet, spill1, etc.)
2. **Ved oppdaget bug/avvik:** legg til ny entry i samme PR
3. **Ved unsikkerhet:** søk loggen før du gjetter

### For Tobias
- Kvartalsvis review: identifiser mønstre, beslutt om noen fallgruver krever arkitektur-endring (ny ADR)

---

## Indeks

| Kategori | Antall entries | Sist oppdatert |
|---|---:|---|
| [§1 Compliance & Regulatorisk](#1-compliance--regulatorisk) | 9 | 2026-05-10 |
| [§2 Wallet & Pengeflyt](#2-wallet--pengeflyt) | 11 | 2026-05-14 |
| [§3 Spill 1, 2, 3 arkitektur](#3-spill-1-2-3-arkitektur) | 19 | 2026-05-15 |
| [§4 Live-rom-state](#4-live-rom-state) | 10 | 2026-05-16 |
| [§5 Git & PR-flyt](#5-git--pr-flyt) | 16 | 2026-05-15 |
| [§6 Test-infrastruktur](#6-test-infrastruktur) | 25 | 2026-05-17 |
| [§7 Frontend / Game-client](#7-frontend--game-client) | 47 | 2026-05-16 |
| [§8 Doc-disiplin](#8-doc-disiplin) | 8 | 2026-05-15 |
| [§9 Konfigurasjon / Environment](#9-konfigurasjon--environment) | 10 | 2026-05-16 |
| [§10 Routing & Permissions](#10-routing--permissions) | 3 | 2026-05-10 |
| [§11 Agent-orkestrering](#11-agent-orkestrering) | 26 | 2026-05-17 |
| [§12 DB-resilience](#12-db-resilience) | 1 | 2026-05-14 |

**Total:** 186 entries (per 2026-05-17)

---

## §1 Compliance & Regulatorisk

### §1.1 — 2500 kr cap KUN for databingo, ALDRI hovedspill

**Severity:** P0 (regulatorisk)
**Oppdaget:** 2026-04-25 (audit), fixet i PR #443
**Symptom:** `applySinglePrizeCap` aktivert på Spill 1/2/3-paths → premier capped feilaktig
**Root cause:** Hard-coded `gameType: "DATABINGO"` for alle spill i `Game2Engine.ts:986-988`, `Game3Engine.ts:1137`
**Fix:** Bruk `ledgerGameTypeForSlug(slug)` — returnerer `MAIN_GAME` for `bingo`/`rocket`/`monsterbingo`, `DATABINGO` for `spillorama`
**Prevention:**
- Aldri hardkode `gameType: "DATABINGO"` for noe annet enn `slug === "spillorama"`
- Pre-pilot regression-test: betal 5000 kr på Spill 1 Innsatsen → ikke capped
**Related:**
- [`SPILL_REGLER_OG_PAYOUT.md`](../architecture/SPILL_REGLER_OG_PAYOUT.md) §4
- [`SPILLKATALOG.md`](../architecture/SPILLKATALOG.md)
- `apps/backend/src/game/ledgerGameTypeForSlug.ts`

### §1.2 — Compliance-ledger MÅ binde til kjøpe-hall, IKKE master_hall_id

**Severity:** P0 (§71-rapport-feil per Lotteritilsynet)
**Oppdaget:** 2026-04-24 R3-research, fixet i PR #443
**Symptom:** Multi-hall Spill 1-runde der spillere fra Hall B kjøper bonger, men compliance-ledger binder til master-hall (Hall A) → §71-rapporten viser feil hall-omsetning
**Root cause:** `Game1TicketPurchaseService:606` brukte `room.hallId` (master-hall) istedenfor `actor_hall_id` (kjøpe-hall)
**Fix:** Alle wallet-touch-paths må bruke `actor_hall_id`-feltet fra request-context, IKKE `room.hallId`
**Prevention:**
- Mini-game payouts, pot-evaluator, jackpot-payouts — ALLE bindes til kjøpe-hall
- Test: kjøp bong fra Hall B i master=Hall A-runde → verifiser ledger-rad har `actor_hall_id=Hall B`
**Related:**
- PR #443 multi-hall-binding fix
- `Game1TicketPurchaseService.ts:606`, `Game1PayoutService.ts:390`
- [`PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md`](../operations/PILOT_FLOW_TEST_CHECKLIST_2026-05-08.md) §6

### §1.3 — Audit-trail er APPEND-ONLY, aldri UPDATE/DELETE

**Severity:** P0 (regulatorisk + tampering)
**Oppdaget:** 2026-04-26 (BIN-764 etablert)
**Symptom:** Forsøk på korrigere feilaktig audit-event ved UPDATE → bryter hash-chain → §71-rapport invalid
**Root cause:** Hash-chain audit-trail (BIN-764) bruker `prev_hash → curr_hash → entry_hash`-kjede. Endre én rad bryter alle etterfølgende.
**Fix:** Ved feil → skriv NY korrigerings-rad som refererer originalen via `details.correction_of`. Aldri rør eksisterende.
**Prevention:**
- ALDRI `UPDATE app_compliance_audit_log` eller `app_wallet_entries`
- ALDRI `DELETE` fra audit-tabeller
- ALDRI direct INSERT (bypass `AuditLogService.record()`)
- DB-policy / triggere bør håndheve dette (TODO post-pilot)
**Related:**
- [ADR-0004](../adr/0004-hash-chain-audit.md) hash-chain audit-trail
- `apps/backend/src/compliance/AuditLogService.ts`

### §1.4 — Spill 4 er DATABINGO, ikke hovedspill

**Severity:** P1 (terminologi-forvirring → §11-prosent-feil)
**Oppdaget:** 2026-04-23 (feil spikret), korrigert 2026-04-25
**Symptom:** "Spill 4" markedsføring assumed å være hovedspill (15%) men er faktisk databingo (30% + 2500 kr cap)
**Root cause:** Markedsførings-navn "Spill 4" = SpinnGo = `spillorama` slug = legacy `game5` kode-navn = DATABINGO regulatorisk
**Fix:** Sjekk SPILLKATALOG.md før du gjør antakelser om §11-prosent
**Prevention:**
- "Spill X"-nummerering matcher IKKE `gameN`-kode-navn — sjekk slug
- Game 4 / `game4` / `themebingo` er **deprecated (BIN-496)** — ikke bruk
**Related:**
- [`SPILLKATALOG.md`](../architecture/SPILLKATALOG.md) komplett mapping

### §1.5 — §66 5-min pause håndheves SERVER-SIDE

**Severity:** P1 (regulatorisk)
**Oppdaget:** Designet 2026-04 (BIN-585)
**Symptom:** Klient kunne potensielt overstyre obligatorisk pause via lokal cache
**Root cause:** Pause-state holdes på server (`ResponsibleGamingPersistence`), aldri klient-side
**Fix:** All §66-håndhevelse skjer i `RgRestrictionService` på backend. Klient ser kun "blocked"-flag.
**Prevention:**
- Aldri implementer pause-logikk i game-client
- Aldri stol på klient-payload for compliance-state
- Validér via `complianceManager.assertCanPlay()` ved hver wallet-touch

### §1.6 — Self-exclusion (§23) er IKKE hevbar

**Severity:** P0 (regulatorisk)
**Oppdaget:** Designet 2026-04
**Symptom:** Admin forsøker å fjerne self-exclusion før 1 år har gått → Lotteritilsynet-brudd
**Root cause:** §23 sier minimum 1 år, ikke hevbar tidligere — selv av admin
**Fix:** Backend avviser `lift_self_exclusion` hvis `excluded_at + 1 year > now()`
**Prevention:**
- Aldri legg til "force-unlift"-knapp i admin-UI
- DB-CHECK constraint på rg_restrictions

### §1.7 — `auto-multiplikator` gjelder per bongfarge, IKKE per ticket-pris flat

**Severity:** P1 (premie-feil)
**Oppdaget:** 2026-04 design-spec
**Symptom:** Premier hardkodet flat istedenfor `base × (ticketPrice / 500)` skalering
**Root cause:** Standard hovedspill bruker `prize_multiplier_mode = "auto"` med `bingoBase` for 5 kr-bong. Backend skalerer.
**Fix:** Engine-bridge MÅ skalere: hvit (5kr)×1, gul (10kr)×2, lilla (15kr)×3
**Prevention:**
- Trafikklys avviker (`explicit_per_color`) — bruk `prizesPerRowColor`
- Oddsen har egne `bingoBaseLow`/`bingoBaseHigh` med target-draw-bucket
**Related:**
- [`SPILL_REGLER_OG_PAYOUT.md`](../architecture/SPILL_REGLER_OG_PAYOUT.md) §3 + §5 + §6

### §1.8 — Multi-vinner-deling: pot per bongstørrelse, IKKE flat

**Severity:** P1 (premie-fordelings-feil)
**Oppdaget:** 2026-05-08 (Tobias bekreftet regel)
**Symptom:** Multi-vinner ble flat-delt (50/50) eller per-vinner-uavhengig — bryter "innsats avgjør gevinst"-prinsippet
**Root cause:** `Game1DrawEngineService.payoutPerColorGroups` med "firstColor's pattern" eller PR #995 per-vinner — begge feil
**Fix:** Pot per bongstørrelse → andel = pot[size] / antall_vinnende_bonger_i_samme_størrelse. Floor-rest til HOUSE_RETAINED.
**Prevention:**
- Lilla-spillere må ALLTID vinne mer enn gul-spillere ved same vinst (3:2:1-forhold på Rad/Bingo)
- Test: 2 hvit + 2 lilla på Rad 1 base=100 → hver hvit får 50, hver lilla får 150
**Related:**
- [`SPILL_REGLER_OG_PAYOUT.md`](../architecture/SPILL_REGLER_OG_PAYOUT.md) §9
- Status 2026-05-08: regel definert, engine-pathen MÅ rebuiles for å matche §9.7-formel

### §1.9 — Payout MÅ bygge color-slug fra (family-color + size), IKKE bruke family direkte

**Severity:** P0 (REGULATORISK — spillere får for lav premie, auto-mult gikk tapt)
**Oppdaget:** 2026-05-14 — Tobias-test, runde `7dcbc3ba-bb64-4596-8410-f0bfe269efd6`: Yellow Rad 1 utbetalt 100 kr (skal være 200), Purple Rad 2 utbetalt 200 kr (skal være 300)
**Symptom:** `app_game1_phase_winners.prize_amount_cents` reflekterer HVIT base × 1 i stedet for HVIT base × color-multiplier. Auto-multiplikator (yellow×2, purple×3) går tapt for ALLE rad-faser. DB-bevis verifisert via direkte SELECT.
**Root cause:**
- `app_game1_ticket_assignments.ticket_color` lagres som FAMILY-form ("yellow"/"purple"/"white") av `Game1TicketPurchaseService`
- `payoutPerColorGroups` brukte `winner.ticketColor` direkte som lookup-key for `patternsByColor`
- `patternsByColor` keys er ENGINE-NAVN ("Small Yellow"/"Large Purple") via `SCHEDULER_COLOR_SLUG_TO_NAME`-mapping
- Ingen match → fall til `__default__` matrise (DEFAULT_NORSK_BINGO_CONFIG) → HVIT-base brukes for alle bongfarger

**Fix (PR #<this-PR>):**
- Ny helper `resolveColorSlugFromAssignment(color, size)` bygger slug-form ("small_yellow"/"large_purple") fra (family-color + size)
- `Game1WinningAssignment` utvidet med optional `ticketSize?: "small" | "large"`
- `evaluateAndPayoutPhase` SELECT inkluderer `a.ticket_size`
- `payoutPerColorGroups` grupperer på slug-key (ikke family-key) → engine-name-lookup matcher patternsByColor
- Broadcast-prizePerWinner-beregning i `evaluateAndPayoutPhase` (line ~2596) bruker også slug-key
- `computeOrdinaryWinCentsByHallPerColor` (pot-evaluator) bruker slug-key for consistency

**Prevention:**
- ALDRI bruk `winner.ticketColor` direkte som key for `patternsByColor`/`spill1.ticketColors[]` — bygg slug først
- ALDRI bruk `pattern.prize1` (HVIT base) for payout-amount uten å gange med color-multiplier
- ALDRI fjern `a.ticket_size` fra payout-SELECT i `evaluateAndPayoutPhase`
- Compliance-ledger PRIZE-entry MÅ logge `bongMultiplier` + `potCentsForBongSize` for §71-sporbarhet
- Tester: 6+ tester per fase × hver farge × multi-vinner-scenario

**Related:**
- `apps/backend/src/game/Game1DrawEngineService.ts` — `payoutPerColorGroups` + `evaluateAndPayoutPhase`
- `apps/backend/src/game/Game1DrawEngineHelpers.ts` — `resolveColorSlugFromAssignment`
- `apps/backend/src/game/Game1PayoutService.ts` — `Game1WinningAssignment.ticketSize`
- `apps/backend/src/game/Game1DrawEnginePotEvaluator.ts` — `computeOrdinaryWinCentsByHallPerColor`
- [`SPILL_REGLER_OG_PAYOUT.md`](../architecture/SPILL_REGLER_OG_PAYOUT.md) §3 — auto-multiplikator-regelen
- PR #1408 + PR #1413 — ticket_config_json + gameVariant.ticketTypes (relatert kontekst)
- `.claude/skills/spill1-master-flow/SKILL.md` — seksjon "Payout-pipeline auto-multiplikator"

---

## §2 Wallet & Pengeflyt

### §2.1 — Wallet 2.-vinn-bug (cache-stale efter Game1-payout)

**Severity:** P0 (KRITISK, pengetap-risiko)
**Oppdaget:** 2026-04-26, fixet i PR #553 (4 timer)
**Symptom:** Spiller vinner 2 ganger på rad i samme runde → 2.-utbetaling ble redusert eller mistet pga stale wallet-cache
**Root cause:** Klient-cache av wallet-saldo ikke invalidert efter første payout → 2. wallet-debit/credit-kall brukte gammel saldo som baseline
**Fix:** `Cache-Control: no-store` på `/api/wallet/me`-routes (PR #553) + force-refresh efter payout
**Prevention:**
- Aldri stol på klient-cached wallet-saldo for noe regulatorisk
- Refresh wallet-saldo etter HVER payout-event (server kan emit `wallet:state` socket-event)
- Test: 2 wins på Rad 1 + Rad 2 i samme runde → begge premier kreditert korrekt

### §2.2 — `BIN-611` race condition: SELECT-before-BEGIN gir UNIQUE-violation

**Severity:** P0 (concurrency-bug)
**Oppdaget:** 2026-04-18 BIN-611
**Symptom:** Parallelle retries av samme idempotency-key → første gjør SELECT (ikke funnet), andre gjør BEGIN+INSERT → første prøver INSERT → UNIQUE_VIOLATION crash
**Root cause:** `PostgresWalletAdapter.singleAccountMovement` (linje 438-441) gjorde dedup-SELECT FØR `BEGIN`-transaksjon
**Fix:** Flytt SELECT inn i transaksjon med `FOR UPDATE` lock på idempotency-key-rad
**Prevention:**
- Alle dedup-sjekker for wallet-operasjoner MÅ være inne i transaksjonen
- Bruk `INSERT ... ON CONFLICT DO NOTHING RETURNING *` for atomic dedup
**Related:** `apps/backend/src/adapters/PostgresWalletAdapter.ts`

### §2.3 — `BIN-612` ExternalWalletAdapter retry-er 5× ved ALLE feil

**Severity:** P0 (KRITISK, dobbeltutbetaling-risiko)
**Oppdaget:** 2026-04-18 BIN-612
**Symptom:** `providerCredit` retry-er 5× ved alle feil-typer — også 4xx (validation, ikke retry-able) → dobbeltutbetaling
**Root cause:** Asymmetri: `providerDebit` har eksponentiell backoff + skill mellom retry-able/non-retry-able. `providerCredit` mangler dette.
**Fix:** Klassifiser feil som retryable (5xx, timeout, network) vs non-retryable (4xx, validation). Kun retry førstnevnte.
**Prevention:**
- Wallet-credit/-debit MÅ ha samme retry-strategi
- Test: mock 4xx-svar fra provider → ingen retry
- Test: mock 503 → retry max 3× med backoff

### §2.4 — Outbox-pattern på alle wallet-operasjoner

**Severity:** P0 (atomicity)
**Oppdaget:** 2026-04-26 BIN-761 etablert
**Symptom:** Wallet-debit + socket-emit i to separate operasjoner → crash mellom dem → wallet debited men klient vet ikke
**Root cause:** Wallet-state og event-emit må være atomic
**Fix:** Outbox-pattern: skriv `app_event_outbox` i samme TX som wallet-mutation. Worker-prosess emit-er events fra outbox.
**Prevention:**
- Aldri `socket.emit()` direkte etter wallet-mutering
- Bruk `WalletAdapter.transfer({ idempotencyKey, ... })` som håndterer outbox internt
**Related:**
- [ADR-0005](../adr/0005-outbox-pattern.md)
- BIN-761

### §2.5 — REPEATABLE READ, ikke SERIALIZABLE for wallet-debit

**Severity:** P1 (performance + correctness)
**Oppdaget:** 2026-04-26 BIN-762
**Symptom:** SERIALIZABLE gir for mange retry-able conflicts på wallet-debit → throughput-tap
**Root cause:** Wallet-debit trenger READ + WRITE-konsistens, ikke full serializability
**Fix:** Bruk REPEATABLE READ med `SELECT ... FOR UPDATE` på saldo-rad
**Prevention:**
- Aldri eskaler til SERIALIZABLE uten case-by-case-vurdering
- BIN-762 etablerte REPEATABLE READ som baseline

### §2.6 — Aldri direct INSERT i `app_wallet*`-tabeller

**Severity:** P0 (konsistens)
**Symptom:** Direct INSERT bypasser dedup-sjekk + outbox-skriving → orphan-rader
**Fix:** Bruk `WalletAdapter`-interface for ALLE wallet-mutasjoner
**Prevention:**
- Code-review: grep etter `INSERT INTO app_wallet` og `INSERT INTO app_compliance_ledger` i nye PR-er
- Architecture-lint kan fange dette

### §2.7 — Idempotency-key for ALLE wallet-operasjoner

**Severity:** P0 (dobbel-debit-prevensjon)
**Oppdaget:** Designet 2026-04 BIN-767
**Symptom:** Operasjon uten idempotency-key → re-tries skaper duplikater
**Fix:** Hver operasjon må ha eksplisitt key via `IdempotencyKeys.<operation>(...)`
**Prevention:**
- Hard rule: ingen wallet-operasjon uten idempotency-key
- 90-dager TTL cleanup (BIN-767)
**Related:** `apps/backend/src/wallet/IdempotencyKeys.ts`

### §2.8 — Aldri direct MCP-write mot prod-DB (ADR-0023)

**Severity:** P0 (regulatorisk-brudd + wallet-integritet)
**Oppdaget:** Designet 2026-05-14 etter Tobias-direktiv om Evolution-grade DB-robusthet
**Symptom:**
- Agent eller PM kjører `INSERT/UPDATE/DELETE` mot `postgres-spillorama-prod` via MCP
- Direct `UPDATE wallet_entries` bryter REPEATABLE READ-isolation + hash-chain → risiko for double-payout (ekte penger)
- Direct `UPDATE wallet_accounts SET balance=...` blir avvist av DB uansett (`balance` er `GENERATED ALWAYS` fra `deposit_balance + winnings_balance`)
- Direct `UPDATE app_audit_log` bryter audit-hash-chain → audit-data avvist av Lotteritilsynet
- Direct `UPDATE app_rg_restrictions SET timed_pause_until=NULL` overstyrer §66 spillvett → dagsbøter 5k-50k NOK/hendelse
- Schema-drift mellom prod og `apps/backend/migrations/` → neste deploy kan korrupte data
**Fix:**
- Prod-MCP (`postgres-spillorama-prod`) MÅ være `@modelcontextprotocol/server-postgres` (read-only by design)
- All schema-/data-korreksjon i prod går via migration-PR (forward-only, ADR-0014)
- Korreksjon i audit-tabeller (`app_audit_log`): append-only `audit_correction`-rad med `original_id` i JSONB-payload
- Korreksjon i wallet (`wallet_entries`): append motpost-rad med `side=CREDIT|DEBIT`, `amount > 0` (balance re-genereres automatisk)
**Prevention:**
- Verifiser ved ny sesjon: `claude mcp list | grep "postgres-spillorama-prod"` → må vise `@modelcontextprotocol/server-postgres`
- Lokal dev-DB (`postgres-spillorama`) kan ha write-capable MCP (`uvx postgres-mcp --access-mode=unrestricted`) — kun localhost
- PR-template har checkbox: "[ ] Ingen direct MCP-write mot prod-DB (ADR-0023)"
- Hvis prod-MCP byttes til write-capable → COMPLIANCE-BRUDD → eskalere til Tobias umiddelbart
**Related:**
- [ADR-0023 — MCP write-access policy](../adr/0023-mcp-write-access-policy.md)
- [ADR-0004 — Hash-chain audit-trail](../adr/0004-hash-chain-audit.md)
- [ADR-0005 — Outbox-pattern](../adr/0005-outbox-pattern.md)
- [ADR-0014 — Idempotent migrations](../adr/0014-idempotent-migrations.md)
- `~/.claude.json` user-scope MCP-config

---

### §2.9 — Wallet integrity-check må kjøres cron, ikke kun on-demand

**Severity:** P0 (Lotteritilsynet-relevant audit-window)
**Oppdaget:** 2026-05-14 — Tobias-direktiv etter Evolution-grade DB-fundament-arbeid
**Symptom:**
- Wallet `balance` blir gradvis ut av sync med `wallet_entries`-sum, ingen merker det før nattlig recon
- Hash-chain-brudd får leve i 24+ timer før `WalletAuditVerifier` (nightly) fanger det
- Når Lotteritilsynet spør "når oppdaget dere bruddet?", svar > 1t er pinlig
- "Vi vet det hver morgen kl 03:00" er ikke nok — pilot-spilling skjer kveld
**Fix:**
- Cron-driven `scripts/ops/wallet-integrity-watcher.sh` (OBS-10, 2026-05-14) hver time
- Sjekker to invariants strukturelt (rask, < 2s mot dev-DB):
  - I1 — balance-sum mot ledger-signed-sum (CREDIT=+amount, DEBIT=-amount)
  - I2 — hash-chain-link: row.previous_entry_hash ≡ predecessor.entry_hash per account_id
- Brudd → Linear-issue Urgent + Slack/disk fallback
- Per-wallet_id dedup 24t i `STATE_FILE` så vi ikke spammer
- IKKE write-active — kun SELECT mot DB
**Prevention:**
- `scripts/__tests__/ops/wallet-integrity-watcher.test.sh` — 48 tester (Q1+Q2 JSON-shaping, dedup, Linear DRY_RUN, pre-flight, integration smoke)
- Watcher er disabled by default — Tobias aktiverer manuelt etter pilot-test
- ALDRI gjør watcher write-active (compliance-brudd ved write-mot-prod)
- ALDRI senk `LINEAR_ISSUE_DEDUP_HOURS` < 6 — Linear-spam ved gjentakende brudd
- Watcher fanger 90% strukturelt; nattlig `WalletAuditVerifier` er fortsatt back-up for full SHA-256-verify
- Hvis ny wallet-mutasjon innføres → verifiser I1+I2 ikke brytes (test mot lokal DB)
**Related:**
- `docs/operations/WALLET_INTEGRITY_WATCHER_RUNBOOK.md` — full runbook + eskalering §6
- [ADR-0004 — Hash-chain audit-trail](../adr/0004-hash-chain-audit.md)
- [ADR-0005 — Outbox-pattern](../adr/0005-outbox-pattern.md)
- [ADR-0023 — MCP write-access policy](../adr/0023-mcp-write-access-policy.md)
- §2.6 (direct INSERT forbudt), §2.8 (MCP write-forbud), §6.x (test-infra-mønster matcher OBS-9)

### §2.10 — Arm-cycle-id må bumpes ved player-level full-disarm (IDEMPOTENCY_MISMATCH ved gjenkjøp etter cancel)

**Severity:** P0 (Sentry SPILLORAMA-BACKEND-6, pilot-blokker for buy-flow)
**Oppdaget:** 2026-05-15 — Tobias-rapportert reproduksjon via Sentry-issue
**Symptom:**
- Spiller kjøper bonger → avbestiller alle via × → forlater spillet → kommer tilbake → kjøper bonger igjen
- Backend kaster `WalletError: IDEMPOTENCY_MISMATCH` med melding
  `Reservasjon med samme key (arm-{roomCode}-{userId}-{cycleId}-{N}) har beløp 60, ikke 180`
- Spilleren ser "Uventet feil" — pilot-blokker for buy-flow
**Root cause:**
- `bet:arm` idempotency-key er deterministisk:
  `arm-{roomCode}-{playerId}-{armCycleId}-{newTotalWeighted}`
- `armCycleId` ble KUN bumpet ved `disarmAllPlayers` (game:start), IKKE ved
  player-level full disarm (`bet:arm wantArmed=false` cancelAll eller
  `ticket:cancel fullyDisarmed=true`).
- Dermed: gjenkjøp etter cancel kunne kollidere med stale (released) reservation-key
  hvis weighted-count matchet — særlig fordi `clearReservationId` clearer
  in-memory mapping så `adapter.reserve()` (ikke `increaseReservation`) kalles.
**Fix (PR 2026-05-15):**
- `RoomStateManager.bumpArmCycle(roomCode)` — nytt API som sletter `armCycleByRoom[roomCode]`
- Wired i `GameEventsDeps.bumpArmCycle?` (optional, backward-compat for tests)
- Kalt fra `releasePreRoundReservation` (roomEvents.ts) etter full release
- Kalt fra `ticket:cancel`-handler (ticketEvents.ts) når `fullyDisarmed=true`
**Prevention:**
- Reconnect-flapping innen samme arm-cycle (ingen cancel) får SAMME key → idempotent retry preserveres
- Partial cancel bumper IKKE → bruker `increaseReservation` på neste arm
- Andre spillere i samme rom påvirkes ikke i praksis (de bruker `existingResId` → `increaseReservation`)
- Tester: `roomEvents.cancelThenRebuyIdempotency.test.ts` — 4 tester
  (cancel-then-rebuy m/samme weighted, m/ulikt beløp, reconnect-resiliens, bump-id-API)
**Related:**
- `apps/backend/src/sockets/gameEvents/roomEvents.ts:240-265` (`releasePreRoundReservation`)
- `apps/backend/src/sockets/gameEvents/ticketEvents.ts:270-280` (ticket:cancel handler)
- `apps/backend/src/util/roomState.ts` (`bumpArmCycle` + `getOrCreateArmCycleId`)
- `apps/backend/src/adapters/PostgresWalletAdapter.ts:1991-2008` (`reserveImpl` IDEMPOTENCY_MISMATCH check)
- §2.7 (idempotency-key for ALLE wallet-operasjoner) — denne entry presiserer key-scoping

### §2.11 — Load-test topup må ikke direct-update `wallet_accounts`

**Severity:** P1 (test-infra kan skjule eller skape wallet-reconciliation-avvik)
**Oppdaget:** 2026-05-16 (GoH full-plan load-test 4 haller x 20 spillere)
**Symptom:** Backend-start/monitor viser wallet-reconciliation-divergence for syntetiske demo-load-brukere etter test-runner-reset. Spillerne kan ha høy `wallet_accounts.deposit_balance`, men ledger/hash-chain viser ikke tilsvarende topup-hendelser.
**Root cause:** `scripts/dev/goh-full-plan-run.mjs` fyller lokale syntetiske wallet-balances med direkte `UPDATE wallet_accounts`. Det er praktisk for lokal load-test, men går utenom wallet-adapter, wallet-entries, outbox, hash-chain og compliance-sporing.
**Fix:** Bruk direct-update kun som midlertidig lokal test-harness. Før dette blir staging/prod-nær load-test må topup gjøres via wallet-adapter/API eller en ledger-konsistent test-reset som skriver alle relevante wallet/audit-rader atomisk.
**Prevention:**
- Nye load-test-runnere skal ikke mutere `wallet_accounts` direkte uten eksplisitt lokal-only guard og dokumentert reconciliation-konsekvens.
- Hvis test-runner trenger saldo, preferer `PostgresWalletAdapter.topUp()` eller et test-only admin-endpoint som går gjennom samme ledger/outbox-path som ekte topup.
- Kjør wallet-reconciliation etter load-test og dokumenter om avvik er test-harness-indusert eller produktbug.
**Related:**
- `scripts/dev/goh-full-plan-run.mjs`
- `docs/operations/GOH_FULL_PLAN_TEST_RESULT_2026-05-16.md`
- `docs/evidence/20260516-goh-full-plan-run/`
- §2.6 (aldri direct INSERT i wallet-tabeller), §2.9 (wallet integrity watcher)

---

## §3 Spill 1, 2, 3 arkitektur

> **🚨 Kanonisk cross-spill-sammenligning: [`SPILL_ARCHITECTURE_OVERVIEW.md`](../architecture/SPILL_ARCHITECTURE_OVERVIEW.md).** Den dekker full sammenligningstabell, bridge-pattern, phase-state-machine, og felles invariants. Fallgruvene under er klassifisert per-§ med severity og fix.

### §3.1 — KRITISK: Spill 1, 2, 3 har FUNDAMENTALT forskjellige arkitekturer

**Severity:** P0 (antakelser overføres feil → bryter implementasjon)
**Oppdaget:** Tobias-direktiv 2026-05-08
**Symptom:** Agent prøver å bruke perpetual-loop-pattern på Spill 1, eller master-rolle på Spill 2/3
**Root cause:** Tre forskjellige grunn-arkitekturer:
- **Spill 1** (`bingo`): per-hall lobby + GoH-master-rom + plan-runtime + scheduled-games
- **Spill 2** (`rocket`): ETT globalt rom + perpetual loop + auto-tick
- **Spill 3** (`monsterbingo`): ETT globalt rom + perpetual loop + sequential phase-state-machine
**Prevention:**
- Les FØRST [`SPILL_ARCHITECTURE_OVERVIEW.md`](../architecture/SPILL_ARCHITECTURE_OVERVIEW.md) for cross-spill-sammenligning
- For dyp implementasjon: les `SPILL[1-3]_IMPLEMENTATION_STATUS_2026-05-08.md` for spillet du jobber med
- Aldri kopier antakelser fra ett spill til et annet
- Hvis koden krangler mot doc-en: doc-en vinner, fix koden
**Related:**
- [`SPILL_ARCHITECTURE_OVERVIEW.md`](../architecture/SPILL_ARCHITECTURE_OVERVIEW.md) ← ENESTE source-of-truth for cross-spill-sammenligning
- [`SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`](../architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md)
- [`SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md`](../architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md)
- [`SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md`](../architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md)
- CLAUDE.md "Spill 1, 2, 3 fundament"-blokk

### §3.2 — Spill 1 har INGEN auto-restart, Spill 2/3 HAR

**Severity:** P0 (regulatorisk: master-trigger vs auto)
**Oppdaget:** 2026-05-09 sesjon
**Symptom:** DrawScheduler auto-startet runder for `bingo`-rom → "spill running uten å ha startet" (Tobias rapporterte)
**Root cause:** DrawScheduler-cron auto-restartet ALLE perpetual-rom uavhengig av slug
**Fix:** Kill-switch i `schedulerSetup.ts:135-200`: hvis `slug === "bingo"` → blokker auto-start
**Prevention:**
- Spill 1 = master-styrt → kun `MasterActionService.start` kan starte engine
- Spill 2/3 = perpetual → `PerpetualRoundService.handleGameEnded` schedulerer ny runde
- Hvis du legger til ny slug → bestem eksplisitt om den er master-styrt eller perpetual

### §3.3 — Spill 2 ROCKET = ETT globalt rom for ALLE haller

**Severity:** P0 (singleton-konstrukten)
**Oppdaget:** Designet 2026-05
**Symptom:** Forsøk på spawne flere `rocket`-rom (eks. per hall) → bryter singleton-invariant
**Root cause:** `canonicalRoomCode("rocket")` returnerer alltid `"ROCKET"` med `effectiveHallId: null`. Partial unique idx på `app_spill2_config(active=TRUE)`.
**Fix:** Aldri prøv å lage hall-spesifikke `rocket`-rom. Hall-binding skjer i ledger-events, ikke i room-code.
**Prevention:**
- Hvis du finner kode som spawn-er flere `rocket`-rom → det er bug, fix umiddelbart
- Test: spawn 4 klienter med ulik `hallId` → alle havner i room `ROCKET`

### §3.4 — Spill 3 phase-state-machine: sequential, ikke parallel

**Severity:** P0 (Tobias-revert 2026-05-03)
**Oppdaget:** PR #860 ble revertet 2026-05-03
**Symptom:** PR #860 portet Spill 3 til 3×3 / 1..21-form med parallel pattern-eval — Tobias revertet
**Root cause:** Spill 3 skal være 5×5 / 75-baller med sequential phases (Rad 1 → 3s pause → Rad 2 → ... → Fullt Hus)
**Fix:** Bruk `Game3PhaseStateMachine.ts` med `autoClaimPhaseMode=true` flag
**Prevention:**
- Aldri reverter Spill 3 til 3×3-form eller parallel-pattern-eval
- Pattern-navn-mapping: bridge bruker `"1 Rad"`, state-machine bruker `"Rad 1"` — `phasePatternIndexFromName` aksepterer begge
- T/X/7/Pyramide-pattern var PR #860-formen som ble revertet — IKKE bruk
**Related:** [`SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md`](../architecture/SPILL3_IMPLEMENTATION_STATUS_2026-05-08.md) §1.1

### §3.5 — Master-handlinger: ingen "Avbryt spill", ingen "Hopp over"

**Severity:** P1 (UX/regulatorisk)
**Oppdaget:** Tobias-direktiv 2026-05-08
**Prevention:**
- Master kan IKKE hoppe over neste spill i sekvensen (alltid umiddelbart neste)
- "Avbryt spill" er IKKE master-action — flyttet til admin-only (regulatorisk-tung)
- Master kan starte/stoppe uavhengig av om andre haller er ready (ready = informativ, ikke gate)

### §3.6 — Master-hall valg: `app_hall_groups.master_hall_id`-kolonne

**Severity:** P1 (UI rendering bug)
**Oppdaget:** 2026-05-09 sesjon
**Symptom:** Master-knapp vises ikke i UI selv om GoH har master
**Root cause:** Eldre seed-script lagret kun `master_hall_id` i `extra_json.masterHallId`, ikke i kolonnen → `GameLobbyAggregator.computeMasterHallId` leser fra kolonnen og returnerte null
**Fix:** Set BÅDE kolonne OG extra_json (BIN-1034 / 2026-05-08)
**Prevention:**
- Ny seed-rad MÅ sette `app_hall_groups.master_hall_id` direkte
- Ved migration: backfill kolonnen fra eksisterende `extra_json.masterHallId`
**Related:** `apps/backend/scripts/seed-demo-pilot-day.ts:1857-1880`

### §3.7 — Bridge-pattern for Spill 2/3 config

**Severity:** P1 (consistency)
**Oppdaget:** Designet 2026-05-08
**Symptom:** Direkte bruk av `Spill2Config` / `Spill3Config` på engine-laget → tett kobling
**Fix:** `Spill2GlobalRoomService.buildVariantConfigFromSpill2Config()` + Spill 3-tilsvarende oversetter til engine-format
**Prevention:**
- Ny config-felt? → oppdater bridge-funksjonen samtidig
- Tester verifiserer mappingen (`roomState.bindSpill2Config.test.ts`)

### §3.8 — `PerpetualRoundOpeningWindowGuard` (BIN-823 fix 2026-05-08)

**Severity:** P0 (regulatorisk åpningstid)
**Oppdaget:** 2026-05-08, fixet i PR #1051
**Symptom:** Spill 2 perpetual-loop spawnet runder utenfor `Spill2Config.openingTimeStart/End`-vindu — Lotteritilsynet-brudd
**Root cause:** `canSpawnRound`-callback returnerte `null` for `rocket`-slug (kun Spill 3-grenen var implementert)
**Fix:** Factory-pattern i `PerpetualRoundOpeningWindowGuard.ts` — felles helper for Spill 2 + Spill 3, wireup via `index.ts:281, 3025-3026`
**Prevention:**
- Test: sett `openingTimeEnd = "12:00"` kl 13:00 → ingen ny runde spawnes
- Wiring-regression-test bevarer factory-injection
**Related:** [`SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md`](../architecture/SPILL2_IMPLEMENTATION_STATUS_2026-05-08.md) §3.8 + §10.2

### §3.9 — `lazy-spawn` av scheduled-game krever cron-race-håndtering

**Severity:** P1 (race-condition)
**Oppdaget:** 2026-05-09 sesjon
**Symptom:** Mark-ready feilet pga `Game1HallReadyService` aksepterte kun `scheduled`/`purchase_open`-status, ikke `ready_to_start`
**Root cause:** `Game1ScheduleTickService` cron flipper status: `scheduled → purchase_open → ready_to_start`. Lazy-spawn kunne treffe etter cron-flip.
**Fix:** Aksepter hele "pre-running"-vinduet (`scheduled` + `purchase_open` + `ready_to_start`) i `markReady()` og `unmarkReady()`
**Prevention:**
- Tester må dekke cron-race-scenarier (lazy-spawn rett før cron-tick)

### §3.10 — Stuck plan-run etter NATURLIG runde-end (PR #1403 dekket ikke alt)

> **🚨 Etterskrift 2026-05-15:** §3.10-§3.13 var 4 tidligere fix-forsøk på Next Game Display-bug som alle var ufullstendige. Komplett fix kom i Trinn 3 (PR #1477 + #1478 + #1481 = §3.14-§3.16). Rot-årsak-analyse i [`NEXT_GAME_DISPLAY_FUNDAMENT_AUDIT_2026-05-14.md §6`](../architecture/NEXT_GAME_DISPLAY_FUNDAMENT_AUDIT_2026-05-14.md#6-identifiserte-bugs-trinn-3--alle-fixed). Disse §3.10-§3.13-entries er beholdt for historisk kontekst, men løsningen i §3.14-§3.16 er autoritativ.

**Severity:** P0 (pilot-blokker — fryser klient på "Laster")
**Oppdaget:** 2026-05-14 — Tobias-test + `audit:db --quick` (P1 stuck-plan-run × 1, samme mønster i 50+ min for forrige run)
**Symptom:** Plan-run `status='running'` med scheduled-game `status='completed'` i 30s+. Ingen ny scheduled-game spawnet. Klient som joiner får tomt room-snapshot (`currentGame` mangler) → evig "Laster..."
**Root cause:** PR #1403 `MasterActionService.reconcileStuckPlanRuns()` kjører bare på `start()` og `advanceToNext()` (manuell master-handling). Naturlig runde-end (auto-draw fullført + vinner kåret) triggrer ingen reconcile — plan-run sitter "running" inntil noen klikker.
**Fix (PR #1407):** Tredje reconcile-mekanisme i `GamePlanRunCleanupService.reconcileNaturalEndStuckRuns()` — poll-tick (30s) som auto-finisher plan-runs der scheduled-game er `completed` + > threshold-tid (default 30s). Audit-event `plan_run.reconcile_natural_end` (unikt fra `plan_run.reconcile_stuck` i PR #1403).
**Prevention:**
- Tester må dekke "naturlig runde-end uten manuell advance" (12+ unit + 14 job + 2 integration i PR #1407)
- Threshold-konfig: env `PLAN_RUN_NATURAL_END_RECONCILE_THRESHOLD_MS=30000`
- ALDRI fjern denne reconcile-mekanismen uten å verifisere at master ALLTID kaller advance/finish etter naturlig runde-end (han gjør IKKE det i pilot-flyten)
- Komplementært til PR #1403 (master-actions) + cron 03:00 (gårsdagens stale) — fjerne én bryter dekningen

### §3.11 — Ticket-pris-propagering må gjøres i TO faser (BUG-F2)

**Severity:** P0 (pilot-blokker — spillere ser feil priser)
**Oppdaget:** 2026-05-14 (Tobias-rapport 07:55 "alle bonger har 20 kr verdi")
**Symptom:** Pre-game (mellom runder, før master trykker Start) viser feil priser i buy-popup:
- Yellow 5 kr → klient viser **20 kr** (skal være 10 kr)
- Purple 5 kr → klient viser **30 kr** (skal være 15 kr)
- Backend `GET /api/rooms/<code>` returnerer `gameVariant.ticketTypes` med flat `priceMultiplier: 1` for ALLE farger istedenfor riktige per-farge-multipliers (Yellow=2, Purple=3)

**Root cause:** PR #1375 (`Game1MasterControlService.onEngineStarted`) løste post-engine-start-pathen ved å binde `roomState.roomConfiguredEntryFeeByRoom + variantByRoom` fra `ticket_config_json` ved engine-start. Men pre-game-vinduet — fra `app_game1_scheduled_games`-rad INSERT-es til master trykker "Start" — var ikke dekket. I dette vinduet kan spillere allerede joine rommet og åpne buy-popup. Klient (`PlayScreen.ts:606`) faller til `state.entryFee ?? 10` × flat `priceMultiplier: 1`, og Yellow med yellow-multiplier(2) gir `10 × 2 = 20 kr`.

**Fix (PR #1408):** To-fase binding-pipeline:
1. **Fase 1 (pre-engine, NY):** `GamePlanEngineBridge.onScheduledGameCreated`-hook binder `roomState.roomConfiguredEntryFeeByRoom + variantByRoom` POST-INSERT av scheduled-game-rad. Wired i `index.ts` via `gamePlanEngineBridge.setOnScheduledGameCreated(...)`. Hooken kjører FØR engine starter.
2. **Fase 2 (post-engine, eksisterende):** `Game1MasterControlService.onEngineStarted` (PR #1375) re-binder samme felter ved engine-start. Defense-in-depth.

**Hvordan unngå regresjon:**

> **🚨 IKKE FJERN den ene fasen uten å verifisere at den andre dekker pathen.** Begge er nødvendige fordi pre-game og post-engine er forskjellige tilstander av samme room. Hvis du fjerner fase 1, kommer 20kr-buggen tilbake umiddelbart.

- Når du jobber med ticket-pris-pipeline må du IKKE fjerne `setOnScheduledGameCreated`-wiring i `index.ts` eller `onScheduledGameCreated`-hook i `GamePlanEngineBridge.ts` uten å verifisere at room-snapshot fortsatt har korrekt `gameVariant.ticketTypes` med per-farge multipliers PRE-game.
- Skill `spill1-master-flow` har egen seksjon "Ticket-pris-propagering" som dokumenterer to-fase-binding i detalj.

**Prevention:**
- Tester: `apps/backend/src/game/GamePlanEngineBridge.onScheduledGameCreated.test.ts` (9 tester — pre-engine) + `Game1MasterControlService.onEngineStarted.test.ts` (5 tester — post-engine)
- Verifikasjon: room-snapshot etter scheduled-game-INSERT MÅ ha `gameVariant.ticketTypes` med korrekte per-farge multipliers (Yellow=2, Purple=3) FØR master starter engine
- Pilot-test-checklist 2026-Q3: legg til "Pre-game buy-popup viser riktig pris" som blokkerende sjekk
- **NY (PR #1411, sub-bug PR #1408):** `buildVariantConfigFromSpill1Config` MÅ mappe `ticketColors[].priceNok` til per-farge multipliers i `gameVariant.ticketTypes`. PR #1408's hook setter `roomConfiguredEntryFeeByRoom` men IKKE multipliers — det måtte løses i `spill1VariantMapper.ticketTypeFromSlug` med en `minPriceNok`-baseline (`priceNok / minPriceNok`). Hvis du fjerner denne mappingen, kommer 20kr/30kr-buggen tilbake i room-snapshot (men IKKE i lobby-API som har egen path via `lobbyTicketTypes.ts`). Tester: `apps/backend/src/game/spill1VariantMapper.test.ts` har 7 nye PR #1411-tester (Standard Bingo `[1,3,2,6,3,9]`, Trafikklys `[1,3]`, hvit+gul `[1,3,2,6]`, tom-fallback, idempotent, priceNok=0-fallback, blandet priceNok).

**Related:**
- `apps/backend/src/game/GamePlanEngineBridge.ts:onScheduledGameCreated`
- `apps/backend/src/index.ts` (setOnScheduledGameCreated-wiring)
- `apps/backend/src/game/Game1MasterControlService.ts:onEngineStarted` (PR #1375)
- `apps/backend/src/game/spill1VariantMapper.ts:ticketTypeFromSlug` (PR #1411 — per-farge multipliers)
- `packages/game-client/src/games/game1/logic/lobbyTicketTypes.ts:buildBuyPopupTicketConfigFromLobby` (referansemattematikk for `priceMultiplier`)
- `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` §2 (Yellow×2, Purple×3 auto-multiplier-regel)
- §3.10 (komplementær — stuck-plan-run-fix landet i PR #1407)

### §3.12 — Plan-advance bug: master starter ny plan-run på position=1 hver gang

**Severity:** P0 (pilot-blokker — spillet kommer aldri videre i spilleplanen)
**Oppdaget:** 2026-05-14 (Tobias-rapport 09:58)
**Symptom:** Master starter plan-run → Bingo (position=1) → spiller ferdig → PR #1407 reconciler finisher plan-run → master klikker "Start neste spill" → ny plan-run = position=1 (Bingo igjen). Spillet kommer aldri til 1000-spill, 5×500, osv.

DB-evidens (forrige observasjon):
```sql
SELECT id, status, current_position, started_at FROM app_game_plan_run
WHERE business_date=CURRENT_DATE ORDER BY started_at;
-- run1: 09:49:08 → finished, position=1 (Bingo)
-- run2: 09:55:19 → finished, position=1 (Bingo)
-- run3: starter igjen på position=1 (Bingo)
```

Master-audit viste KUN "start"-actions, ingen "advance".

**Tobias-direktiv (KANONISK):**
> "Hvert spill spilles kun en gang deretter videre til nytt spill. Vi må fikse at hvert spill spilles kun en gang deretter videre til nytt spill."

**Root cause:** F-Plan-Reuse (PR #1006, 2026-05-09) introduserte `getOrCreateForToday` DELETE+INSERT-flyt for å la master starte ny runde samme dag etter accidental stop. INSERT hardkodet `current_position=1` på den nye raden — uavhengig av hvor langt forrige plan-run faktisk kom. Resultat: Bingo (pos=1) ble repetert i en loop, plan-sekvensen progresserte aldri.

**Fix:** `GamePlanRunService.getOrCreateForToday` capturer `previousPosition = existing.currentPosition` FØR DELETE. INSERT-ing av ny plan-run bruker dynamisk `current_position`:
- `previousPosition < plan.items.length` → `nextPosition = previousPosition + 1` (advance)
- `previousPosition >= plan.items.length` → `nextPosition = 1` (wrap til ny syklus)
- Plan med 0 items eller previousPosition er null → `nextPosition = 1` (defensive default)

Audit-event `game_plan_run.recreate_after_finish` utvidet med:
```json
{
  "previousRunId": "<UUID>",
  "previousPosition": 1,
  "newPosition": 2,
  "autoAdvanced": true,
  "planItemCount": 13
}
```

**Prevention:**
- ALDRI fjern `previousPosition`-tracking eller `nextPosition`-beregningen — uten den loops Bingo evig
- ALDRI fjern `planService.getById(matched.id)`-kallet for items count
- `planService.list()` returnerer `GamePlan[]` UTEN items — du MÅ kalle `getById` for å få `GamePlanWithItems.items.length`
- Hvis du endrer plan-sekvens-mekanismen (eks. legger til "Hopp over"-knapp eller eksplisitt "advance"), husk at `getOrCreateForToday` auto-advance er DEFAULT-stien. Manuell advance er en separat path som overstyrer

**Related:**
- `apps/backend/src/game/GamePlanRunService.ts:getOrCreateForToday` (PR <this-PR>)
- `apps/backend/src/game/GamePlanService.ts:list` (returnerer `GamePlan[]` uten items)
- `apps/backend/src/game/GamePlanService.ts:getById` (returnerer `GamePlanWithItems`)
- PR #1407 (`GamePlanRunCleanupService.reconcileNaturalEndStuckRuns` — finisher plan-runs som blir stuck etter naturlig runde-end; komplementært, ikke konflikt)
- Tester: `apps/backend/src/game/__tests__/GamePlanRunService.autoAdvanceFromFinished.test.ts` (10 tester)
- Skill `spill1-master-flow` §"Auto-advance fra finished plan-run"

### §3.13 — Lobby-API må vise NESTE position i sekvens etter finished plan-run

**Severity:** P0 (pilot — master ser feil "neste spill"-navn)
**Oppdaget:** 2026-05-14 (Tobias-rapport 13:00 — samme dag som PR #1422 landet)
**Symptom:** Master-UI viser "Start neste spill — Bingo" selv etter Bingo (position=1) er ferdigspilt. Skal vise "1000-spill" (position=2).

DB-evidens (verifisert av Tobias 13:00):
```sql
SELECT id, status, current_position FROM app_game_plan_run WHERE business_date = CURRENT_DATE;
-- 792541b4 finished position=1

SELECT position, slug FROM app_game_plan_item WHERE plan_id = (...) ORDER BY position;
-- 1: bingo, 2: 1000-spill, 3: 5x500, ..., 13: tv-extra
```

Lobby-API output (FØR fix):
```
GET /api/games/spill1/lobby?hallId=demo-hall-001
→ nextGame: NULL
→ runStatus: finished
→ overallStatus: finished
```

Master-UI faller tilbake til default `plan_items[0]` (Bingo) når `nextGame` er null → viser "Start neste spill — Bingo" istedet for "1000-spill".

**Root cause:** `Game1LobbyService.getLobbyState` returnerte `nextScheduledGame: null` ved enhver finished plan-run, uavhengig av om planen var helt ferdig eller bare på posisjon 1. `GameLobbyAggregator.buildPlanMeta` clampet `positionForDisplay = Math.min(currentPosition, items.length)` så `catalogSlug` reflekterte ALLTID den siste ferdigspilte posisjon, ikke neste.

**Fix:**
- `Game1LobbyService.getLobbyState`: når `run.status='finished'` OG `currentPosition < items.length`, returner `nextScheduledGame` fra `plan.items[currentPosition + 1]` (1-indeksert) med `status='idle'`. Nytt felt `planCompletedForToday` settes `true` kun når `currentPosition >= items.length` (matcher `PLAN_COMPLETED_FOR_TODAY`-DomainError i `getOrCreateForToday`).
- `GameLobbyAggregator.buildPlanMeta`: når `planRun.status='finished'` OG `rawPosition < items.length`, advance `positionForDisplay = rawPosition + 1` så `catalogSlug`/`catalogDisplayName` peker til NESTE plan-item. Jackpot-override-lookup endret fra `String(planRun.currentPosition)` til `String(positionForDisplay)` for konsistens — den nye plan-run-en som spawnes vil ha override-key matching dette feltet.

**Komplementært til PR #1422:** Backend create-logikk advancer korrekt; lobby-API må også vise korrekt UI-state.

**Prevention:**
- Tester for finished-state med ulike posisjoner (siste position, mid-plan, 13-item demo)
- ALDRI returner `nextScheduledGame: null` ved finished plan-run uten å først sjekke `currentPosition < items.length`
- ALDRI clamp `positionForDisplay` til `Math.min(rawPosition, items.length)` uten å håndtere finished-state separat
- Master-UI sin "Start neste spill"-knapp leser `lobby.nextScheduledGame.catalogDisplayName` (med fallback til "Bingo") — fix sikrer at fallback aldri trigges når plan har items igjen
- `Spill1LobbyState.planCompletedForToday` (shared-type) er optional for backwards-compat under utrulling; default-tolkning `false`

**Related:**
- `apps/backend/src/game/Game1LobbyService.ts` (finished-branch + ny `planCompletedForToday`-flag)
- `apps/backend/src/game/GameLobbyAggregator.ts:buildPlanMeta` (auto-advance positionForDisplay)
- `packages/shared-types/src/api.ts:Spill1LobbyState` (ny optional `planCompletedForToday`)
- PR #1422 (backend create-logikk — `getOrCreateForToday` auto-advance)
- §3.12 (komplementær — DB-side fix av samme bug-klasse)
- Tester: `apps/backend/src/game/Game1LobbyService.test.ts` (5 nye tester), `apps/backend/src/game/__tests__/GameLobbyAggregator.test.ts` (2 nye tester)

### §3.14a — Plan-run state-machine: 4 forskjellige mekanismer kan mutere current_position (Agent C-funn)

**Severity:** P1 (strukturelt — antagelig rotårsak til Next Game Display-bug)
**Oppdaget:** 2026-05-14 (Agent C research-leveranse, `docs/research/NEXT_GAME_DISPLAY_AGENT_C_PLANRUN_2026-05-14.md`)
**Symptom:** Master ser inkonsistent "neste spill"-tekst etter `dev:nuke` eller etter naturlig runde-end. Kortvarige race-windows mellom reconcile/cleanup/start/advance kan returnere forskjellig state innen 1 sek.

**Root cause:** Det er 4 forskjellige måter `app_game_plan_run.current_position` kan endres på, pluss F-Plan-Reuse DELETE+INSERT-flyten:
1. `MasterActionService.start` → `planRunService.start` (idle → running, position=1)
2. `MasterActionService.start` → `planRunService.advanceToNext` (running+terminal-current → running, position++)
3. `MasterActionService.start` → `getOrCreateForToday` F-Plan-Reuse (finished → DELETE+INSERT med nextPosition)
4. `MasterActionService.advance` → `planRunService.advanceToNext` (running → running, position++ ELLER finished)
5. `agentGamePlan.ts:loadCurrent` (lazy-create=true) → `getOrCreateForToday` F-Plan-Reuse (lobby-API mutation)

Hver mekanisme har egen audit-event, race-window, og soft-fail-strategi.

**Konkrete bugs identifisert:**
1. `MasterActionService.advance` kaller `reconcileStuckPlanRuns` FØR `advanceToNext`. Reconcile finisher stuck plan-run → advanceToNext kaster `GAME_PLAN_RUN_INVALID_TRANSITION` fordi status nå er `finished`. Master får uventet 400-feil.
2. `reconcileNaturalEndStuckRuns` (PR #1407) sjekker kun `WHERE pr.status = 'running'` — `paused` plan-run kan bli stuck for alltid hvis scheduled-game er completed mens plan-run er paused.
3. `getOrCreateForToday` har race-window mellom find/DELETE/INSERT som kan svelge F-Plan-Reuse auto-advance silent (DELETE matcher 0 rader hvis cleanup-cron raced med master-action).
4. Bridge-spawn etter `advanceToNext` har race-window for dual scheduled-games — aggregator kan rapportere `BRIDGE_FAILED`-warning som BLOCKING_WARNING_CODES og blokkere master.

**Anbefalt fix:**

> **KORTSIKTIG (quick-fix for Next Game Display):** Fjern lazy-create fra `agentGamePlan.ts:loadCurrent` (linje 308-326). Sett `lazyCreate=false` som default. F-Plan-Reuse skal KUN trigge fra eksplisitt `MasterActionService.start` etter master-klikk. Lobby-API beregner "neste spill" fra `plan.items[0]` (Bingo) hvis ingen plan-run finnes.

> **LANGSIKTIG (rewrite — Plan C-mandatet aktuelt):** Event-sourced plan-run:
> - `app_game_plan_run` blir read-model
> - State-overganger genererer events i `app_game_plan_run_events` (append-only)
> - Projection-jobb rebuilder read-model fra events
> - Sjekkpunkt: ingen race-windows fordi events er totalt-ordrede

**Prevention:**
- IKKE legg til en 5. mekanisme for å endre `current_position` uten å konsolidere de 4 eksisterende
- Hvis du legger til ny audit-event for state-overgang, dokumenter race-vinduer mot eksisterende mekanismer
- Lazy-create-stien skal ALDRI mutere DB — read-paths er read-only
- Quick-fix er P0 hvis Next Game Display fortsatt rapporteres etter PR #1422 + #1431 + #1427

**Related:**
- `apps/backend/src/game/GamePlanRunService.ts` (4 mutasjons-metoder + F-Plan-Reuse)
- `apps/backend/src/game/MasterActionService.ts` (sekvenseringsmotor — `reconcileStuckPlanRuns` private helper)
- `apps/backend/src/game/GamePlanRunCleanupService.ts` (cron + poll-tick — `reconcileNaturalEndStuckRuns`)
- `apps/backend/src/routes/agentGamePlan.ts:307-339` (loadCurrent lazy-create-mutasjon — PRIMÆR MISTANKE)
- §3.10 (PR #1407 — komplementært, ikke samme bug)
- §3.12 (PR #1422 — BUG E auto-advance, samme klasse)
- §3.13 (PR #1431 — lobby-API komplementært)
- `docs/research/NEXT_GAME_DISPLAY_AGENT_C_PLANRUN_2026-05-14.md` (full data-collection)
### §3.14 — Dual-spawn til `app_game1_scheduled_games` (Bølge 4 FIXED 2026-05-15)

**Severity:** P0 (rot-årsak B til Next Game Display master-konsoll bug)
**Oppdaget:** 2026-05-14 (Agent D research)
**Status:** ✅ FIXED 2026-05-15 (branch `fix/bolge-4-skip-legacy-spawn-for-plan-haller-2026-05-15`)
**Symptom:** Master-konsoll viste feil "Neste spill" fordi legacy-cron `Game1ScheduleTickService.spawnUpcomingGame1Games` spawnet scheduled-game-rad parallelt med plan-runtime's bridge-spawn.

**Root cause (pre-fix):** Bølge 4 fra `PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md` §7 var IKKE fullført:
- `Game1ScheduleTickService.spawnUpcomingGame1Games` (legacy, cron-tick) hadde INGEN guard "skip if hall has active plan".
- `GamePlanEngineBridge.createScheduledGameForPlanRunPosition` (bridge, master-trigger) spawnet uavhengig.
- Idempotency-keys disjunkte: legacy = `(daily_schedule_id, scheduled_day, sub_game_index)` UNIQUE, bridge = `(plan_run_id, plan_position) WHERE NOT terminal`. Forskjellige keys → DB tolererer to konkurrerende rader.
- Plan-runtime (Bølge 1-3, 2026-05-08) erstattet legacy-spawn for plan-haller, men legacy-cron ble aldri skrudd av. Bølge 4 (deaktivere legacy) ble glemt.

**Hva mitigerte pre-fix:**
- F-NEW-3 `releaseStaleRoomCodeBindings` (2026-05-12) auto-canceller stale rader med samme `room_code` ved bridge-INSERT — kompensasjon, ikke fix.

**Fix (2026-05-15):** `Game1ScheduleTickService.spawnUpcomingGame1Games` skipper nå haller med aktiv `app_game_plan_run`-rad for samme business_date.

Implementasjon:
- Ny privat helper `checkHallsWithActivePlanRuns(hallIds, dateRange)`: bulk-query mot `app_game_plan_run` for kandidat-haller i lookahead-vinduet, returnerer Set med keys `${hallId}|${isoDay}` for O(1)-lookup.
- I spawn-loopen sjekkes `activePlanRunKeys.has(${masterHallId}|${isoDay})` etter daily-schedule + weekday-validering. Hvis hall har plan-run for dagen → skip (teller som `skippedSchedules`).
- Plan-run-query-feil (eks. test-DB uten migrasjoner) → fail-open: warning logges, legacy-spawn fortsetter normalt.
- Audit-event på debug-nivå: `bolge-4.legacy_spawn_skipped_due_to_plan`.

Hvorfor sjekke FAKTISK plan-run-rad (ikke bare plan-config):
- Plan-config viser BARE at hall *kan* ha plan på denne ukedagen
- Plan-run viser at master har FAKTISK startet eller bridge har spawnet en runde for (hall, dato)
- Strengere guard — slår kun inn etter plan-runtime tas i bruk; bakoverkompat ellers

**Tester som dekker:** `apps/backend/src/game/Game1ScheduleTickService.test.ts` (6 nye Bølge 4-tester):
1. Skip legacy-spawn for plan-haller (positiv case)
2. Legacy-spawn fortsatt aktiv for ikke-plan-haller (negativ case)
3. Blandet — én plan-hall + én legacy-hall i samme tick
4. Skip kun gjelder spesifikk (hall, dato) — andre dager spawnes
5. DB-feil i plan-run-query → fail-open
6. Ingen plan-run-query når kandidat-haller er tom

**Prevention:**
- ALDRI fjern F-NEW-3 `releaseStaleRoomCodeBindings` — guard og kompensasjon er komplementære (defense-in-depth)
- Audit-event på debug-nivå lar ops monitorere antall skip per tick
- Verifiser i prod: `SELECT count(*) FROM app_game1_scheduled_games WHERE daily_schedule_id IS NOT NULL AND plan_run_id IS NOT NULL` skal være 0

**Related:**
- `apps/backend/src/game/Game1ScheduleTickService.ts` (linje 390-444 ny helper, 489-505 pre-fetch, 700-728 skip-guard)
- `apps/backend/src/game/GamePlanEngineBridge.ts:887-1465` (bridge spawn)
- `docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md` §5 C1, §7 Bølge 4
- `docs/research/NEXT_GAME_DISPLAY_AGENT_D_SCHEDULEDGAME_2026-05-14.md` §3 + §6.2

### §3.15 — `GamePlanRunService.start()` overskriver `current_position = 1` (FIXED 2026-05-15)

**Severity:** P0 (rot-årsak til "Bingo igjen" i Next Game Display)
**Oppdaget:** 2026-05-14 (Agent D research, samme dag som PR #1422 fix-poke landet)
**Status:** ✅ FIXED 2026-05-15 (branch `fix/bug-d1-planrun-start-hardcode-2026-05-15`, Agent A407 — Fix-agent BUG-D1)
**Symptom:** Etter `getOrCreateForToday` beregner riktig `nextPosition=2` (per PR #1422), `start()`-UPDATE overskriver `current_position` til 1. Bingo (position 1) re-startes i stedet for 1000-spill (position 2).

**Root cause:** `apps/backend/src/game/GamePlanRunService.ts:780` (pre-fix) hadde hardkodet `current_position = 1` i UPDATE-en:

```sql
UPDATE app_game_plan_run
SET status = 'running',
    started_at = COALESCE(started_at, now()),
    current_position = 1,            -- ⚠️ ALLTID 1, uavhengig av nextPosition
    master_user_id = $2,
    updated_at = now()
WHERE id = $1
```

Dette var arv fra opprinnelig implementasjon før PR #1422 introduserte `previousPosition`-tracking i `getOrCreateForToday`. INSERT-en satte `nextPosition` korrekt, men `start()` overskrev.

**Hva mitigerte pre-fix:**
- `MasterActionService.start()` (linje 607-672) hadde egen advance-logikk som sjekket `currentScheduledGame` for `current_position` og advancerte plan-run hvis scheduled-game var terminal.
- Det dekket hovedpath (master-start etter natural-end) men IKKE alle scenarier — særlig ikke fresh state der ingen scheduled-game-rad ennå eksisterte for cp=1, så Bingo ble re-startet før advance-logikken slo inn.

**Fix (2026-05-15):** Fjernet `current_position = 1` fra `start()`-UPDATE. `getOrCreateForToday`-INSERT er nå eneste sannhet for `current_position` ved start. `start()` flipper kun state-machine (idle → running) + setter `started_at` + `master_user_id` — den rør IKKE posisjonen.

```diff
 UPDATE app_game_plan_run
 SET status = 'running',
     started_at = COALESCE(started_at, now()),
-    current_position = 1,
     master_user_id = $2,
     updated_at = now()
 WHERE id = $1
```

**Tester som dekker:**
- `apps/backend/src/game/__tests__/GamePlanRunService.startPreservesPosition.test.ts` (6 tester):
  1. `start()` bevarer cp=2 (regression for selve bug-en)
  2. SQL-UPDATE inneholder ikke `current_position = ` (strukturell guard)
  3. cp=5 bevares (vilkårlig mid-plan position)
  4. cp=1 bevares (sanity-test for første-spill)
  5. Audit-event `game_plan_run.start` skrives uendret
  6. `GAME_PLAN_RUN_INVALID_TRANSITION` kastes ved non-idle status (uendret guard)

**Prevention:**
- ALDRI overstyr `current_position` i status-transition-UPDATE-er — kun i `getOrCreateForToday`-INSERT eller eksplisitt advance/rollback-paths
- MasterActionService advance-logikk er fortsatt på plass som defense-in-depth — den fanger edge-cases der scheduled-game-rad er ute av sync med plan-run-position
- Strukturell test #2 ovenfor blokkerer regresjon: hvis noen reintroduserer `current_position = X` i `start()`-UPDATE, vil testen feile på SQL-regex

**Related:**
- `apps/backend/src/game/GamePlanRunService.ts:776-795` (`start()` — fix applied)
- `apps/backend/src/game/GamePlanRunService.ts:536-749` (`getOrCreateForToday` — eneste sannhet for position ved start)
- `apps/backend/src/game/MasterActionService.ts:607-672` (advance-mitigation, fortsatt på plass)
- §3.12 (komplementær — DB-side fix landet i PR #1422)
- §3.10-§3.14 (4 tidligere fix-forsøk på "neste spill"-display — denne fix-en lukker rot-årsaken på server-side)
- `docs/research/NEXT_GAME_DISPLAY_AGENT_D_SCHEDULEDGAME_2026-05-14.md` §5.1 / §6.1
- `docs/architecture/NEXT_GAME_DISPLAY_FUNDAMENT_AUDIT_2026-05-14.md` (audit-skall som koordinerte 6 research-agenter)

---

### §3.16 — `engine.UPDATE status='completed'` manglet WHERE-status-guard (FIXED 2026-05-15, BUG-D6)

**Severity:** P1 (data-integritet — terminal-status `cancelled`/`finished` kunne overskrives av engine)
**Oppdaget:** 2026-05-14 (Agent D research §5.6)
**Fixed:** 2026-05-15 (PR for BUG-D6)
**Symptom:** Hvis master eller cron har satt scheduled-game til `cancelled` mens engine fortsatt har en pending endRound-call, kunne engine overskrive `cancelled` med `completed`. Audit-trail blir korrupt — Lotteritilsynet ville ikke kunne reprodusere "hvorfor sluttet runden". Også: hvis CRIT-7 rollback satte status tilbake til `purchase_open`/`ready_to_start`, ville engine senere overskrive til `completed` selv om engine-state ikke matchet.

**Root cause:** `apps/backend/src/game/Game1DrawEngineService.ts:1411-1420` (endRound-pathen, isFinished=true) hadde UPDATE-statement uten WHERE-status-guard:

```sql
-- FØR fix
UPDATE app_game1_scheduled_games
SET status='completed', actual_end_time = COALESCE(actual_end_time, now()), updated_at = now()
WHERE id = $1
```

Ingen `AND status IN (...)`-clause som beskytter terminal status.

**Fix:** La til guard som forhindrer flip fra terminal status:

```diff
 UPDATE app_game1_scheduled_games
 SET status='completed', actual_end_time = COALESCE(actual_end_time, now()), updated_at = now()
-WHERE id = $1
+WHERE id = $1
+  AND status IN ('running', 'paused')
```

Engine kan kun completed-flippe fra ikke-terminal status (`running`, `paused`). Hvis raden allerede er `cancelled`/`completed`/`finished`, no-op'er UPDATE-en (rowCount=0). Service-koden avhenger IKKE av rowCount==1 — transaksjonen fortsetter normalt.

**Kanonisk pattern (alle UPDATE som flipper til terminal status):**

```sql
UPDATE <table>
SET status = '<terminal>', ...
WHERE id = $1
  AND status IN (<ikke-terminal-statuser>)
```

**Prevention:**
- 4 regression-tester i `apps/backend/src/game/__tests__/Game1DrawEngineService.bugD6StatusGuard.test.ts`:
  - Test 1: WHERE-clause inneholder `AND status IN ('running', 'paused')`
  - Test 2: WHERE-clause inneholder IKKE `'cancelled'` / `'finished'` (vil ikke whiteliste terminal status)
  - Test 3: Idempotent ved rowCount=0 (no-op hvis raden allerede er terminal)
  - Test 4: Eksakt SQL-form matcher fix-diff (forhindrer regression via "smart refactor")
- Pattern: alle UPDATE som flipper til terminal status SKAL ha guard. Aldri whiteliste terminal status i guarden — det åpner for race-overskrivning igjen.

**Related:**
- Agent D research §5.6 / §6.4
- §3.X dual-spawn (Bølge 4) — relatert race-conditions
- §3.15 (`GamePlanRunService.start()` overskriver current_position) — samme overordnede mønster: state-transitions må ha guards som forhindrer rådata-overskrivning
- `apps/backend/src/game/Game1DrawEngineService.ts:1412-1421` (etter fix)
- `.claude/skills/spill1-master-flow/SKILL.md` §"Vanlige feil" entry 14
- `docs/architecture/NEXT_GAME_DISPLAY_FUNDAMENT_AUDIT_2026-05-14.md`

---

### §3.17 — Master-start spawnet `ready_to_start` og startet engine i samme request (FIXED 2026-05-15)

**Severity:** P0 (pilot-blokker — ekte pengekjøp fikk ikke reelt kjøpsvindu før trekning)
**Oppdaget:** 2026-05-15 (live-test + `purchase_open` forensic baseline)
**Symptom:** Spill 1 gikk direkte fra plan/master-start til running/completed. Spillere hadde enten 0 kjøp eller kjøp millisekunder før engine-start. Live baseline viste target-game `f7fa6583-285c-4b16-9285-127d21fe692f` med `scheduled_start=18:38:42.835`, `actual_start=18:38:42.928`, og kjøp kl. `18:38:42.897` — ca. 30 ms før engine-start. Det er ikke et operativt `purchase_open`-vindu.

**Root cause:** Plan-runtime-pathen brukte `GamePlanEngineBridge` til å opprette scheduled-game direkte som `ready_to_start`, og `MasterActionService.start()` kalte `Game1MasterControlService.startGame()` i samme HTTP-request. Cron/seed-tid kunne påvirke legacy scheduled-flow, men var ikke rot-årsaken for master/plan-flowen.

**Fix:**
1. `GamePlanEngineBridge.createScheduledGameForPlanRunPosition()` oppretter nye plan-runtime-rader med `status='purchase_open'`.
2. `scheduled_start_time` settes ca. 120 sekunder frem som forventet draw-start/timer for UI/observability, ikke som automatisk engine-trigger.
3. `MasterActionService.start()` returnerer uten `startGame()` når bridgen nettopp har opprettet en fresh `purchase_open`-rad.
4. Neste master-start på samme eksisterende `purchase_open`-rad gjenbruker bridgen og starter engine.
5. `MasterActionService.advance()` har samme defense-in-depth: fresh ny planposisjon åpner `purchase_open`, ikke `running`.
6. Admin/agent UI skiller "Bongesalg åpnet" fra "Spill 1 startet" og labelen "Start trekninger nå" fra "Start neste spill".

**Prevention:**
- Før implementation på gjentatt live-test-feil: kjør `npm run forensics:purchase-open -- --phase before-master ...` og legg evidence path i agent-kontrakt.
- Ikke behandle dette som en ren cron/seed-feil før plan/master-pathen er bevist frisk. Forensic baseline viste at master pathen selv startet engine for fort.
- Aldri merge endring som setter ny plan-runtime scheduled-game direkte til `ready_to_start` uten å bevise at engine-start fortsatt krever et separat master-kall.
- UI skal aldri vise "Spill 1 startet" når backend returnerer `scheduledGameStatus='purchase_open'`.
- E2E-tester skal ikke bruke `markHallReady()` som "åpne salg". Etter two-step-fixen betyr første masterStart `purchase_open`; `markHallReady()` betyr at hallen er ferdig med salg og kan blokkere videre kjøp med `PURCHASE_CLOSED_FOR_HALL`.
- Stateful pilot-flow E2E må resettes til plan-posisjon 1 i lokal CI/test-DB før hver spec. Hvis ikke arver senere specs dagens auto-advance og kan treffe jackpot-posisjon 7 uten jackpot-override.

**Tests:**
- `apps/backend/src/game/__tests__/MasterActionService.test.ts`
  - `start: idle → running spawner fresh purchase_open uten engine.startGame`
  - `start: idempotent re-start på running purchase_open → bridge gjenbrukes og engine.startGame kalles`
  - `start: running run med completed scheduled-game auto-advancer til ny purchase_open`
  - `advance: running → next position + fresh purchase_open uten engine.startGame`
- `apps/backend/src/game/__tests__/GamePlanEngineBridge.cancelledRowReuse.regression.test.ts`
- `apps/backend/src/game/__tests__/GamePlanEngineBridge.multiGoHIntegration.test.ts`
- `tests/e2e/helpers/rest.ts` — `openPurchaseWindow()` + lokal CI/test-DB plan-run-reset
- `tests/e2e/spill1-*.spec.ts` — kjøp skjer i `purchase_open` før `markHallReady()`

**Related:**
- `/tmp/purchase-open-forensics-2026-05-15T21-56-07Z.md`
- `/tmp/agent-contract-purchase-open-pm-self.md`
- `apps/backend/src/game/GamePlanEngineBridge.ts`
- `apps/backend/src/game/MasterActionService.ts`
- `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts`
- `apps/admin-web/src/pages/agent-portal/NextGamePanel.ts`
- `.claude/skills/spill1-master-flow/SKILL.md` v1.20.0

### §3.18 — Natural-end reconcile må aldri `finish`-e midt i en flerposisjonsplan

**Severity:** P0 (full spilleplan stopper etter første runde)
**Oppdaget:** 2026-05-16 (GoH full-plan runner stoppet etter runde 1 i tidligere runde med `plan_run.running + scheduled_game.completed`)
**Symptom:** Første Spill 1-runde fullfører normalt, men cleanup/reconcile tolker mellom-runde-state som stuck natural-end og setter plan-run til `finished`. Neste planposisjon åpnes ikke, eller runner/PM ser at planen stopper lenge før alle 13 planposisjoner er spilt.
**Root cause:** Natural-end-reconcile sjekket `plan_run=running + scheduled_game=completed` uten å skille mellom:
- normal mid-plan mellomtilstand etter en completed current-position, der master/runner skal advance til neste position
- ekte slutt på plan, der current-position er siste plan-item
**Fix:** `GamePlanRunCleanupService.reconcileNaturalEndStuckRuns()` joiner nå mot `app_game_plan_item` og completed scheduled-game på `(plan_run_id, plan_position)`, og krever `current_position >= item_count` før den kan markere plan-run som finished.
**Prevention:**
- Alle reconcile-regler må modellere planposisjon, ikke bare scheduled-game-status.
- Unit-test må ha scenario for `current_position=1` i 13-spills plan med completed scheduled-game: skal ikke finish-e planen.
- Full-plan-runner skal kjøre alle 13 planposisjoner etter endring i cleanup/reconcile.
**Related:**
- `apps/backend/src/game/GamePlanRunCleanupService.ts`
- `apps/backend/src/game/__tests__/GamePlanRunCleanupService.naturalEndReconcile.test.ts`
- `apps/backend/src/__tests__/GamePlanRunCleanupService.naturalEndReconcile.integration.test.ts`
- `docs/operations/GOH_FULL_PLAN_TEST_RESULT_2026-05-16.md`
- `.claude/skills/spill1-master-flow/SKILL.md` v1.21.0

---

## §4 Live-rom-state

### §4.1 — Phantom-rom etter restart → FLUSHALL Redis

**Severity:** P2 (dev-stack)
**Oppdaget:** Daglig under utvikling
**Symptom:** Backend gjenoppretter rooms fra Redis efter restart → spøkelses-rom som ikke matcher DB-state
**Fix:** `docker exec spillorama-system-redis-1 redis-cli FLUSHALL` + restart backend
**Prevention:**
- `npm run dev:all -- --reset-state` for ren restart
- I prod: ikke et problem siden Redis-state og DB-state synkes via outbox

### §4.2 — Stale plan-runs ved instans-krasj

**Severity:** P1 (UI viser STALE_PLAN_RUN-warning)
**Oppdaget:** 2026-05-08
**Symptom:** Master-konsoll viser warning fra gårsdagens leftover plan-run
**Fix:** `GamePlanRunCleanupService` — cron 03:00 Oslo + inline self-heal-hook
**Prevention:**
- `getOrCreateForToday` self-healer stale runs
- SQL-cleanup ved utviklingsfeil:
  ```sql
  UPDATE app_game_plan_run SET status='finished', finished_at=now()
  WHERE status NOT IN ('finished','idle');
  ```

### §4.3 — Recovery-snapshot må deep-clone phase-state

**Severity:** P0 (R10 invariants brudd)
**Oppdaget:** 2026-05-08 R10 chaos-test design
**Symptom:** Spill 3 phase-state ikke survival-er instans-restart → `currentPhaseIndex` reset til 0 → spillere mister rad-vinster
**Fix:** `BingoEngine.serializeGame` deep-cloner `spill3PhaseState` (array clone for `phasesWon`)
**Prevention:**
- Hvis du legger til nye state-felter til `GameState` → oppdater `serializeGame` + `restoreFromCheckpoint` samtidig
- R10-test verifiserer I1-I5 invariants

### §4.4 — `GamePlanEngineBridge` cancelled-rad-gjenbruk

**Severity:** P0 (kjent bug, ikke pilot-blokker)
**Oppdaget:** 2026-05-09 sesjon
**Symptom:** Mark-ready feiler med `GAME_NOT_READY_ELIGIBLE: 'cancelled'` etter at runde har vært cancelled tidligere samme dag
**Root cause:** `createScheduledGameForPlanRunPosition` gjenbruker eksisterende rader på `(plan_run_id, plan_position)` uten status-filter
**Fix-anbefaling:** Filter `WHERE status NOT IN ('cancelled','finished')` på idempotency-lookup
**Status:** Åpen — workaround er SQL-cleanup
**Prevention:** Test: cancel runde → forsøk advance → verifiser ny rad spawner, ikke gjenbruker cancelled

### §4.4b — `GamePlanEngineBridge` lazy-binding-fallback brøt klient-flyt (FIKSET F-NEW-3)

**Severity:** P0 (pilot-blokker — armed tickets ble foreldreløse, spiller -160 kr men `MyTickets: 0`)
**Oppdaget:** 2026-05-12 (Tobias-test: armed 4 tickets som spiller, master Start → bonger forsvant, saldo trekt)
**Symptom:** Bridge fikk 23505 på `idx_app_game1_scheduled_games_room_code`, falt tilbake til `roomCode: null`. Klient-flyt kunne ikke joine (`io.to(NULL)`), tvang `createRoom` → ny `playerId` → 0 ticket-assignments → spiller mistet bongene.
**Root cause:** En stale aktiv `app_game1_scheduled_games`-rad (`scheduled/purchase_open/ready_to_start/running/paused`) holdt den kanoniske `BINGO_<groupId>`-koden. Unique-indeksen (partial: ekskluderer `'completed'`/`'cancelled'`) blokkerte ny INSERT med samme room_code. Lazy-binding-fallback satte room_code=NULL — engine ble bundet uten klient-rute-key.
**Fix (F-NEW-3):** `releaseStaleRoomCodeBindings(roomCode, runId, position, ...)` kjøres FØR INSERT. Finner stale aktive rader med samme room_code men ANNEN (plan_run_id, plan_position), setter `status='cancelled'` med `stop_reason='auto_cancelled_by_bridge_takeover'` + audit-entry i `app_game1_master_audit`. Etter release lykkes INSERT med room_code satt opp-front. 23505 etter release → retry én gang; hvis fortsatt 23505 → kast `ROOM_CODE_CONFLICT` (ikke degradering til NULL).
**Prevention:**
- ALDRI degrader til `room_code=NULL` ved 23505 — det brekker auto-draw-tick + klient-join atomisk
- Stale aktive rader skal cancelleres med audit-spor, ikke ignoreres
- Tester: `GamePlanEngineBridge.takeover.test.ts` verifiserer 9 scenarier (ingen/én/flere stale, race-cancellet, idempotency, retry-with-rollback, regresjon)
**Related:**
- `apps/backend/src/game/GamePlanEngineBridge.ts:releaseStaleRoomCodeBindings`
- `apps/backend/src/game/__tests__/GamePlanEngineBridge.takeover.test.ts`
- PR `fix/spill1-bridge-takeover-existing-room-2026-05-12`

### §4.4c — Plan-run stuck på 'running' når scheduled-game terminal (I16, F-02, FIKSET)

**Severity:** P1 (kunde-symptom: popup vises ikke, ingen joinable game etter test)
**Oppdaget:** 2026-05-13 (Tobias' manuelle test 1.5h etter E2E-suite, ~1h diagnose)
**Symptom:** `runStatus=running, scheduledStatus=completed` etter test-runs — `Game1LobbyService` returnerer `nextScheduledGame.scheduledGameId` pekende på avsluttet runde → klient kan ikke joine, popup mounter aldri.
**Root cause:** `MasterActionService.stop()` kaster `ENGINE_FAILED` via `wrapEngineError` HVIS engine.stopGame feiler, FØR `planRunService.finish()` rakk å kjøre. Plan-run-state og scheduled-game-state er to uavhengige state-maskiner — partial-failure i stop-flyt etterlater dem usynkronisert. Tester (`resetPilotState`) som catcher `masterStop`-errors maskerer problemet.
**Fix (I16):** `Game1LobbyService.tryReconcileTerminalScheduledGame` auto-healer state på lobby-poll-read-path:
- **Siste plan-position + terminal scheduled-game** → auto-finish plan-run via `planRunService.finish` (idempotent, audit-actor `system:lobby-auto-reconcile`)
- **Ikke-siste position + terminal scheduled-game** → hide scheduled-game fra response (`scheduledGameId=null`, overallStatus='idle') så klient ikke prøver å joine; master må advance manuelt
- **Fail-safe:** DB-feil under finish logges men kaster aldri — neste poll prøver igjen
- **Concurrency:** race mellom to lobby-polls håndteres av `changeStatus`-validering — den andre kaster `GAME_PLAN_RUN_INVALID_TRANSITION` (fanget)
**Prevention:**
- ALDRI fjern `TERMINAL_SCHEDULED_GAME_STATUSES`-set fra `Game1LobbyService` uten å replisere logikken
- ALDRI legg til write-paths i `Game1LobbyService` uten å dokumentere det i doc-header
- Når du ser `runStatus=running + scheduledStatus=completed` lokalt: neste lobby-poll skal hele state automatisk (innen 10s) — IKKE manuelt SQL-cleanup hvis testen skal verifisere atferden
**Related:**
- `apps/backend/src/game/Game1LobbyService.ts:730-833`
- `apps/backend/src/game/__tests__/Game1LobbyService.reconcile.test.ts` (10 unit-tester)
- FRAGILITY_LOG F-02 (status: FIXED)
- BUG_CATALOG I16
- Branch `fix/plan-run-auto-reconcile-2026-05-13`

### §4.5 — Aldri `io.emit()` — alltid `io.to(roomCode)`

**Severity:** P0 (skala-katastrofe)
**Oppdaget:** Designet 2026-05
**Symptom:** Full broadcast på 1500-spillere-skala blokkerer event-loop og spiser bandwidth
**Fix:** Targeted broadcast per rom; per-spiller-strip for perpetual-rom (ADR-011)
**Prevention:**
- Code-review fanger `io.emit()` automatisk
- Alle nye socket-paths må bruke `io.to(roomCode).emit(...)`
- Wave 3b reduserte `room:update` payload fra 314 KB til 0.8 KB pr mottaker
**Related:** [ADR-0013](../adr/0013-per-recipient-broadcast-perpetual-rooms.md)

### §4.6 — Idempotente socket-events med `clientRequestId`

**Severity:** P0 (R5 mandat)
**Oppdaget:** 2026-05-08 BIN-813
**Symptom:** Socket-disconnect midt i `ticket:mark` → klient retry-er → server får 2 events → dobbel-mark
**Fix:** `withSocketIdempotency`-wrapper på `ticket:mark`, `claim:submit`, `bet:arm` — Redis-dedup med 5-min TTL på `(userId, eventName, clientRequestId)`
**Prevention:**
- Alle nye socket-events som muterer state MÅ bruke wrapper
- Fail-soft ved Redis-utfall (wallet-laget er fortsatt idempotent som defense-in-depth)
**Related:** [ADR-0005](../adr/0005-outbox-pattern.md), tester `withSocketIdempotency.test.ts`

### §4.7 — DR-runbook S1-S7-navne-kollisjon (mandat vs runbook)

**Severity:** P1 (forvirring under press → feil prosedyre)
**Oppdaget:** 2026-05-10 av Plan-agent under R12-valideringsplan-arbeid (BIN-816)
**Symptom:** Ops/compliance leser "S5"-prosedyre i én doc og forventer en annen i annen doc — ulik forståelse under incident
**Root cause:** To dokumenter bruker SAMME notasjon "S1-S7" for ULIKE scenario-sett:
- `docs/operations/LIVE_ROOM_DR_RUNBOOK.md` bruker S1-S7 for INFRASTRUKTUR-scenarier:
  - S1: Backend-instans-krasj
  - S2: Redis-failover
  - S3: Postgres failover
  - S4: Region-down
  - S5: DDoS
  - S6: Rolling restart
  - S7: Perpetual-loop-leak
- `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md` referer til S1-S7 for APPLICATION/COMPLIANCE-scenarier:
  - S1: Master-hall fail
  - S2: Multi-hall desync
  - S3: Ledger poison
  - S4: Wallet corruption
  - S5: Rate-limit cascade
  - S6: RNG drift
  - S7: Network partition
**Fix-plan (per `R12_DR_VALIDATION_PLAN.md` §8):**
- Re-numerér ELLER eksplisitt cross-reference mellom mandat-S1-S7 og runbook-S1-S7
- Legg mapping-tabell øverst i `LIVE_ROOM_DR_RUNBOOK.md`
- Når denne fallgruven slår inn, kan compliance-eier følge feil prosedyre under press
**Prevention:**
- Aldri bruk samme notasjon (S1-S7, P0-P3, etc.) for to ulike kategorier i samme prosjekt
- Code-/doc-review: hvis du ser overlappende numbering, krev cross-reference
- Test: kan ny ops/compliance lese "S5 trigget" og umiddelbart vite hvilken prosedyre uten konflikt?
**Related:**
- [`R12_DR_VALIDATION_PLAN.md`](../operations/R12_DR_VALIDATION_PLAN.md) §8 (foreslått fix)
- BIN-816 R12 DR-runbook validering

### §4.8 — Catalog-lookup N+1 i master advance/resume under GoH-load

**Severity:** P1 (performance/observability — ikke funksjonell fail, men skalerer feil under live-rom)
**Oppdaget:** 2026-05-16 (GoH 4x80 full-plan-test med Sentry/PostHog aktiv)
**Symptom:** Postrun Sentry viste ny `SPILLORAMA-BACKEND-A` og økt `SPILLORAMA-BACKEND-8`, begge `N+1 Query`, på `POST /api/agent/game1/master/advance` og `POST /api/agent/game1/master/resume`.
**Root cause:** `GamePlanService.fetchItems()` hadde en kommentar om batch, men gjorde likevel sekvensielle `catalogService.getById(cid)` for hver unique catalog id. Under plan-runtime master-actions førte dette til gjentatte `SELECT ... FROM app_game_catalog WHERE id = $1`.
**Fix:** `GameCatalogService.getByIds(ids)` leser catalog entries med `WHERE id = ANY($1::text[])`. `GamePlanService.fetchItems()` bruker batch-path i produksjon, med fallback til `getById` kun når unit-tester injiserer tiny stubs.
**Prevention:**
- Når Sentry flagger N+1 på master-actions, sjekk først plan/catalog enrichment og services som går gjennom plan items.
- Ikke stol på kommentarer som sier "batch" uten å verifisere faktisk SQL-call count.
- Tester som stubber services må ikke tvinge produksjonskode til å beholde N+1. Bruk batch-metode i ekte service og fallback kun for explicit stubs.
**Related:**
- `apps/backend/src/game/GameCatalogService.ts:getByIds`
- `apps/backend/src/game/GamePlanService.ts:fetchCatalogEntries`
- `apps/backend/src/game/GamePlanService.test.ts`
- `docs/evidence/20260516-observability-goh-80-postrun-2026-05-16T22-48-56-853Z/`
- `docs/operations/GOH_FULL_PLAN_4X80_TEST_RESULT_2026-05-16.md`

---

## §5 Git & PR-flyt

### §5.1 — Squash-merge SHA-mismatch ved kjedede PR-er

**Severity:** P1 (utvikling-friksjon)
**Oppdaget:** 2026-05-10 sesjon
**Symptom:** PR B basert på PR A. Når A squash-merges, får A ny SHA → B refererer original → CONFLICTING/DIRTY
**Fix-mønstre:**
1. **Sekvensiell merge + rebase:** vent på A merger, rebase B mot ny main, push (3× CI)
2. **Combined PR fra start:** lag som én PR med cherry-pick alle commits (PR #1132 brukte denne)
3. **Merge istedenfor squash:** bevarer SHA-er men forurenser commit-historikk
**Prevention:**
- Hvis du planlegger ≥2 relaterte PR-er → vurder combined PR fra start
- Aldri base PR B på open PR A uten å være forberedt på rebase-arbeid

### §5.2 — Aldri `git add -A` (.env og secrets-risk)

**Severity:** P0 (security)
**Symptom:** `git add -A` plukker `.env`, `.env.backup`, `tobias-keys.json` etc.
**Fix:** Stage spesifikke filer: `git add path/to/file.ts`
**Prevention:**
- `.gitignore` dekker mest, men ikke alt
- Pre-commit hook (`secret-scanner`) fanger noen tilfeller
- Code-review: sjekk PR-diff for `.env*` eller credentials

### §5.3 — Aldri `--no-verify` på commit

**Severity:** P1 (umiddelbar feilkilde)
**Symptom:** Bypass av pre-commit-hook → senere CI-fail i andre PR-er
**Fix:** Fix hooks-feil, ikke bypass
**Prevention:**
- Hvis hook feiler: investigér root-cause (sannsynligvis manglende deps i worktree)

### §5.4 — Tobias rør ALDRI git lokalt — PM eier git pull

**Severity:** P0 (workflow)
**Oppdaget:** Tobias-direktiv 2026-05-08
**Prevention:**
- Etter HVER PR-merge: PM må `git pull` i hovedrepoet
- Gi Tobias hot-reload-restart-kommando med `cd /Users/...`-prefiks (han er ofte i `~`)
- Standard restart:
  ```bash
  cd /Users/tobiashaugen/Projects/Spillorama-system && lsof -nP -iTCP:5174 -sTCP:LISTEN -t 2>/dev/null | xargs -r kill -9 && VITE_DEV_BACKEND_URL=http://localhost:4000 npm --prefix apps/admin-web run dev
  ```

### §5.5 — Done-policy (ADR-0010): commit til main + file:line + grønn test

**Severity:** P0 (regulatorisk-sporbarhet)
**Oppdaget:** 2026-04-17 etter 4 falske Done-funn
**Prevention:**
- Aldri lukk Linear-issue på branch-merge alene
- Krev: commit-SHA på main, file:line-bevis, grønn CI eller test-bevis

### §5.6 — PM verifiserer CI etter PR-åpning (5-10 min)

**Severity:** P1 (auto-merge fail-mode)
**Oppdaget:** 2026-05-09 (memory: feedback_pm_verify_ci.md)
**Symptom:** Auto-merge fyrer KUN ved ekte CI-grønning, ikke ved INFRA-fail (schema-gate stale, flaky tests, dependabot)
**Fix:** Periodisk sjekk `gh pr checks <nr>` etter 5-10 min
**Prevention:**
- Hvis ≥ 3 PR-er feiler samme måte → INFRA-bug → root-cause-fix før mer arbeid

### §5.7 — Conventional Commits er BLOKKERENDE (danger.yml rule 7)

**Severity:** P1 (PR avvises uten match)
**Oppdaget:** 2026-04 CI-config
**Format:** `<type>(<scope>): <subject>` på PR-tittel
**Types:** `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`
**Scopes:** `backend`, `game-client`, `admin-web`, `shared-types`, `infra`, `compliance`
**Prevention:**
- Sjekk PR-tittel matcher regex før push

### §5.8 — `.husky/pre-commit-fragility-check.sh` krever bash 4 (declare -A) — **FIXED 2026-05-13**

**Status:** ✅ FIXED 2026-05-13 — se `scripts/check-fragility-comprehension.mjs` + thin bash 3.2 wrapper.
**Severity:** P1 (blokkerer commits på macOS hvis wired)
**Oppdaget:** 2026-05-13 (under comprehension-verification-utvikling)
**Symptom:** Scriptet brukte `declare -A FRAGILITY_MAP=()` (bash 4 associative arrays). macOS default bash er 3.2.57 — feiler med `declare: -A: invalid option` ved kjøring. Scriptet ble lagt til i PR #1326 men var ikke vanntett wiret i `.husky/pre-commit` (dokumentert som "ikke wiret" i kommentar på linje 18-21, men faktisk koden på linje 66-68 wiret den — som ville feilet på Mac).
**Root cause:**
- macOS har bash 3.2 av lisens-grunner (GPL v3 i bash 4+). Apple-developer-stack bruker `zsh` som default, men husky kaller `bash` eksplisitt.
- Linux/CI har bash 5 — der fungerer scriptet
**Fix (2026-05-13):** Strategi A (Node-port). Logikken er flyttet til `scripts/check-fragility-comprehension.mjs` (matcher mønsteret fra `scripts/check-pm-gate.mjs` og `scripts/verify-context-comprehension.mjs`). `.husky/pre-commit-fragility-check.sh` er nå en tynn bash 3.2-kompatibel wrapper som delegerer til Node-scriptet via `exec node`. Wiret inn som Trinn 3 i `.husky/pre-commit` parallelt med fixen. Test-suite i `scripts/__tests__/check-fragility-comprehension.test.mjs` (34 tester, inkluderer bash 3.2-kompatibilitetssjekk).
**Prevention:**
- Bash 4-features (`declare -A`, `mapfile`, `readarray`, `${var,,}`, `${var^^}`, `${!arr[@]}`) skal ikke brukes i hooks
- Hvis bash 3.2-grenser er for trange, port hooken til Node (matcher mønster fra `check-pm-gate.mjs`)
- Test alle nye hooks lokalt på macOS før wiring (kjør `/bin/bash -n .husky/<file>.sh` for syntax-check; kjør hele scriptet på `/bin/bash` for runtime-test)
- Ny test i `check-fragility-comprehension.test.mjs` (`wrapper bruker ikke bash 4-features`) håndhever dette automatisk for fragility-wrapperen

### §5.9 — Cascade-rebase når N agenter appender til samme docs (AGENT_EXECUTION_LOG)

**Severity:** P1 (PM-friction, kan forsinke PR-merges med timer)
**Oppdaget:** 2026-05-13 (Wave 2/3 sesjon med 12 parallelle agenter)
**Symptom:** Hver av 12 agenter merger til main → neste 11 PR-er blir CONFLICTING/DIRTY på `docs/engineering/AGENT_EXECUTION_LOG.md`. Cascade-rebase × 14 iterasjoner på én dag. Hver iterasjon krever manuell konflikt-resolvering.
**Root cause:** AGENT_EXECUTION_LOG.md, PITFALLS_LOG.md, og `.github/pull_request_template.md` er additive-append-filer som alle agenter touch'er. Når én PR merger, alle andres samme-file-edits blir merge-konflikt.
**Fix:**
- Auto-rebase-workflow `.github/workflows/auto-rebase-on-merge.yml` (PR #1342, Phase 2)
- Python-resolver `/tmp/resolve-additive.py` for å auto-resolve additive conflicts
- Cascade-rebase-script `/tmp/wave3-rebase.sh` som rebaserer + auto-resolverer + force-pusher
**Prevention:**
- Forutsi cascade FØR multi-agent-orkestrering: hvilke filer alle vil touch?
- Deklarér forventede conflicts i `/tmp/active-agents.json.conflictsAcknowledged` så PM vet planen
- Vurder kombinert-PR-pattern (cherry-pick alle commits til én PR fra main) for ≥ 5 parallelle agenter på samme docs-filer
**Related:**
- PR #1342 (auto-rebase workflow)
- `/tmp/active-agents.json` registry
- `docs/engineering/PM_PUSH_CONTROL.md`

### §5.10 — Add/add merge conflicts trenger `-X ours`, ikke additive merge

**Severity:** P1 (filsystem-skade hvis ikke håndtert)
**Oppdaget:** 2026-05-13 (under D1 PM Push Control Phase 2 cascade-merge)
**Symptom:** Add/add conflict (begge sider opprettet samme fil med ulikt innhold) → naive merge legger BÅDE versjoner i samme fil → 1381 linjer kaotisk JS som ikke parses
**Root cause:** Python-additive-merge-resolver håndterer kun `<<<<<<< HEAD ... =======` blokker. Add/add conflicter har full-file-konflikt med fil-level-markører. Ekstra logikk trengs.
**Fix:** `git merge -X ours <branch>` for add/add conflicts der HEAD er korrekt versjon. Eller `-X theirs` hvis branch er kanonisk. Aldri begge-versjoner-konkatenert.
**Prevention:**
- Sjekk om begge sider opprettet samme fil: `git status` viser `AA` for add/add
- Hvis ja: bruk `-X ours` / `-X theirs` istedenfor håndmerge
- Aldri lim sammen JS/TS-filer manuelt
**Related:**
- D1 PM Push Control Phase 2 (2026-05-13 mid-sesjon)
- `scripts/pm-push-control.mjs` duplisering

### §5.11 — Generic GitHub check-navn må ikke brukes i branch protection

**Severity:** P1 (merge-policy blir tvetydig)
**Oppdaget:** 2026-05-15 etter PR #1515
**Symptom:** Nye knowledge-control workflows eksponerte check-navnene `enforce` og `validate`. Hvis slike navn legges inn i branch protection, er det uklart hvilken gate som faktisk er required. PM/reviewer kan tro at PM-gate, knowledge-protocol eller PITFALLS-validator er låst, mens GitHub bare ser et generisk context-navn.
**Root cause:** GitHub Actions bruker job-navn som check context. Når workflow-jobben heter `enforce` eller `validate`, mister branch protection den domenespesifikke meningen.
**Fix:** Alle gates som skal kunne bli required checks må ha eksplisitte, stabile job-navn:
- `pm-gate-enforcement`
- `knowledge-protocol-enforcement`
- `pitfalls-id-validation`
**Prevention:**
- Før branch protection endres: kjør en PR og bekreft faktisk check-navn med `gh pr checks <nr>`
- Ikke legg generiske navn som `enforce`, `validate`, `check` eller `test` inn i required checks
- Dokumenter eksakte check-navn i lock-/auditdokumentet før de aktiveres som required
**Related:**
- PR #1515 pre-lock knowledge-control hardening
- Issue #1518 unique knowledge-gate check names

### §5.12 — Required reviews uten approver-roster gir lockout eller falsk trygghet

**Severity:** P1 (governance-kontroll kan blokkere hotfix eller se trygg ut uten reell reviewer)
**Oppdaget:** 2026-05-15 under access-/approval-audit etter branch-protection-hardening.
**Symptom:** Det er fristende å aktivere "Require approving review" fordi repoet håndterer live-rom og ekte penger. Men GitHub-audit viste bare én reell ansvarlig approver (`tobias363`) og én write/legacy-konto (`tobias50`). CODEOWNERS peker også til `@tobias363` for alle kritiske paths.
**Root cause:** Required reviews er en god kontroll først når revieweren er uavhengig, navngitt og tilgjengelig. Hvis author/owner er samme person som CODEOWNER, kan GitHub-regelen enten blokkere egne PR-er eller skape prosess-teater der en sekundær konto "approver" uten reell uavhengighet.
**Fix:** Ikke aktiver required reviews før `docs/operations/ACCESS_APPROVAL_MATRIX.md` §6-§7 er oppfylt:
- Minst én uavhengig approver er onboardet.
- CODEOWNERS er oppdatert til team/rolle-handles eller konkrete backup-approvers.
- Hotfix-flow er testet med branch protection aktiv.
- Emergency-labels og post-merge-review er etablert.
**Prevention:**
- Før branch protection endres: audit `collaborators`, `CODEOWNERS` og faktisk reviewer-roster.
- High-risk PR-er skal fortsatt ha synlig Tobias-godkjenning i PR-kommentar/review.
- Dokumenter hvorfor required reviews er av hvis reviewer-roster ikke finnes. Det er et bevisst risikovalg, ikke et hull.
- Ikke bruk en sekundær konto som "uavhengig reviewer" hvis det er samme menneske.
**Related:**
- `docs/operations/ACCESS_APPROVAL_MATRIX.md`
- `.github/CODEOWNERS`
- `docs/engineering/KNOWLEDGE_CONTROL_PRELOCK_REVIEW_2026-05-15.md`

### §5.13 — GitHub Actions output må aldri få fallback-linje i command substitution

**Severity:** P2 (post-merge watcher blir rød selv om det ikke finnes rebase-arbeid)
**Oppdaget:** 2026-05-15 etter merge av PR #1527.
**Symptom:** `Auto-rebase open PRs on merge` feilet etter en grønn merge med:
`Unable to process file command 'output' successfully` og `Invalid format '0'`.
Workflow-loggen viste `Found 0` på egen linje før `0 overlapping open PR(s)`.
**Root cause:** `COUNT=$(echo "$OVERLAPPING" | tr ' ' '\n' | grep -cv '^$' || echo 0)` kan produsere to linjer når `grep` returnerer exit 1 ved null matches: først `0` fra `grep -c`, så fallback `0` fra `echo 0`. Når dette skrives som `overlap_count=$COUNT` til `$GITHUB_OUTPUT`, blir output-filen flerlinjet og GitHub avviser linjen.
**Fix:** Håndter null-listen eksplisitt før count:
```bash
OVERLAPPING=$(printf '%s\n' "$OVERLAPPING" | tr ' ' '\n' | sed '/^$/d' | sort -un | tr '\n' ' ' | sed 's/[[:space:]]*$//')
if [ -z "$OVERLAPPING" ]; then
  COUNT=0
else
  COUNT=$(printf '%s\n' "$OVERLAPPING" | tr ' ' '\n' | grep -c .)
fi
```
**Prevention:**
- Når en workflow skriver til `$GITHUB_OUTPUT`, verifiser at hver output-verdi er én linje.
- Unngå `cmd || echo fallback` inne i command substitution hvis `cmd` kan skrive output før exit 1.
- Test både "0 treff" og "1+ treff" for post-merge automation.
**Related:**
- `.github/workflows/auto-rebase-on-merge.yml`
- `pm-orchestration-pattern` skill v1.2.1

### §5.14 — PR-label gates må hente labels live, ikke fra stale event-payload

**Severity:** P1 (godkjent PM-bypass blokkeres selv etter korrekt label)
**Oppdaget:** 2026-05-15 på PR #1529 etter `approved-pm-bypass` var lagt til.
**Symptom:** `pm-gate-enforcement` feilet med `gate-bypass krever label approved-pm-bypass` selv om PR-en hadde labelen. Rerun av samme workflow feilet også.
**Root cause:** Workflowen leste `context.payload.pull_request.labels`. GitHub Actions rerun bruker opprinnelig event-payload fra `opened`/`synchronize`; labels lagt til etter eventet finnes ikke i payloaden, selv på rerun.
**Fix:** Hent labels live i valideringssteget:
```js
const { data: liveIssue } = await github.rest.issues.get({
  owner: context.repo.owner,
  repo: context.repo.repo,
  issue_number: pr.number,
});
const labels = new Set((liveIssue.labels || [])
  .map((l) => typeof l === 'string' ? l : l.name)
  .filter(Boolean));
```
**Prevention:**
- Alle PR-gates som avhenger av labels, review-state eller merge-state må hente live state via GitHub API.
- Bruk event-payload kun for immutable metadata som PR-nummer og SHA.
- Test label-gates med sekvensen: open PR uten label → legg til label → rerun workflow.
**Related:**
- `.github/workflows/pm-gate-enforcement.yml`
- `pm-orchestration-pattern` skill v1.2.2

### §5.15 — Required check må ikke ha PR path-filter som gjør checken missing

**Severity:** P1 (branch protection deadlock)
**Oppdaget:** 2026-05-15 etter merge av PR #1531, under manuell auto-doc PR #1532.
**Symptom:** PR #1532 hadde alle triggete required checks grønne, men merge var blokkert. Admin-merge feilet med `Required status check "pitfalls-id-validation" is expected.`
**Root cause:** Branch protection forventer check-context `pitfalls-id-validation`, men `.github/workflows/pitfalls-id-validate.yml` hadde `pull_request.paths` som bare trigget på `PITFALLS_LOG.md`, `scripts/check-pitfalls-ids.mjs` eller workflow-fila. Auto-doc PR-er endrer kun `docs/auto-generated/*`, så workflowen ble aldri opprettet. For GitHub branch protection er "workflow ikke trigget" ikke det samme som "check passert".
**Fix:** Fjern `pull_request.paths` fra required-check-workflowen slik at `pitfalls-id-validation` alltid kjører på PR. Behold eventuelt `push.paths` for main hvis ønsket, men PR-siden må alltid produsere check-context.
**Prevention:**
- Alle checks som ligger i branch protection må kjøre på alle PR-er, eller ha en separat always-run aggregator/check som rapporterer success når scope er irrelevant.
- Ikke bruk `paths:` på required PR-checks med mindre branch protection peker til en always-present wrapper-jobb.
- Test required-check-endringer med en docs-only PR og verifiser `gh pr checks --required <nr>` viser checken som `pass`, ikke missing.
**Related:**
- `.github/workflows/pitfalls-id-validate.yml`
- PR #1532 (`auto-doc/refresh-snapshot`)

### §5.16 — Diff-baserte PR-gates må skippe non-open PR-events

**Severity:** P2 (falske røde checks etter merge)
**Oppdaget:** 2026-05-15 etter auto-doc PR #1532 ble merget og branch slettet.
**Symptom:** `Delta Report Gate` og `Bug Resurrection Check` kjørte på en `pull_request`-event etter merge, prøvde å diff-e `base.sha..head.sha`, og feilet med `fatal: bad object <head_sha>` / `Invalid revision range`. PR-en var allerede merget, men post-merge CI-status så rød ut og kunne skape feil eskalering.
**Root cause:** Workflowene trigget også på `edited` for å støtte bypass/ack i PR-body. `edited` kan komme etter at PR er merged/closed. Da kan head-branch være slettet, og checkouten har ikke lenger head-objektet som diff-gaten forventer.
**Fix:** Legg job-level guard på diff-baserte PR-gates:
```yaml
if: ${{ github.event.pull_request.state == 'open' }}
```
Dette beholder håndheving på åpne PR-er, inkludert `edited` før merge, men skipper stale post-merge events.
**Prevention:**
- Alle PR-gates som leser `pull_request.head.sha`, kjører `git diff base..head`, `git rev-list base..head` eller blame på PR-commits må ha `state == 'open'`-guard.
- Hvis en gate må kjøre etter merge, bruk merge-commit/main-SHA eksplisitt, ikke PR-head-SHA.
- Post-merge watcher skal skille mellom rød main-run og rød lukket-PR-run før eskalering.
**Related:**
- `.github/workflows/delta-report-gate.yml`
- `.github/workflows/bug-resurrection-check.yml`
- PR #1532 (`auto-doc/refresh-snapshot`)

---

## §6 Test-infrastruktur

### §6.1 — e2e-workflow har ingen migrate-step → BIN-828

**Severity:** P0 (CI-blokker)
**Oppdaget:** 2026-05-09
**Symptom:** PR #1091 flyttet `wallet_accounts/transactions/entries/reservations` CREATE TABLE ut av `PostgresWalletAdapter.initializeSchema()`. Production fungerer (render.yaml kjører `npm run migrate`), men e2e-workflow har INGEN migrate-step → 9 røde main-e2e-runs
**Fix:** Kalle `bootstrapWalletSchemaForTests` i `Spill1FullDay.e2e.test.ts`-`startSession()` (PR #1127)
**Prevention:**
- E2E-tester bruker fresh test-schema — krever explicit bootstrap
- Helper finnes: `walletSchemaTestUtil.ts.bootstrapWalletSchemaForTests`
- Aldri bruk i prod-koden — kun test-only

### §6.2 — Smoke-test API-shape forventninger feiler

**Severity:** P3 (test-infra-bug)
**Oppdaget:** 2026-05-10 sesjon
**Symptom:** `pilot-smoke-test.sh` antok `.data` er flat array, men `/api/admin/hall-groups` returnerer `{"ok":true,"data":{"groups":[...]}}`
**Fix:** Bruk `.data.groups[]` for hall-groups (objekt-wrapper)
**Prevention:**
- Verifiser API-shape med live curl FØR du skriver smoke-test
- Endpoints kan ha forskjellig shape — sjekk OpenAPI-spec

### §6.3 — Mock vs ekte DB i tester

**Severity:** P1 (false confidence)
**Oppdaget:** 2026-04 designet
**Symptom:** Mocked tests passed but prod-migration feilet
**Fix:** Wallet/compliance-tester bruker integration-test mod ekte Postgres (`WALLET_PG_TEST_CONNECTION_STRING`)
**Prevention:**
- For REPEATABLE READ-paths: ALDRI mock — bruk integration-test
- Memory-only adapter er kun for unit-isolation

### §6.4 — Worktree pre-commit hook + dependencies

**Severity:** P2 (dev-friksjon)
**Oppdaget:** 2026-05-10 sesjon
**Symptom:** Agent committer i worktree → pre-commit hook feiler hvis worktreen mangler dependencies
**Fix:** Worktree må ha node_modules installert (eller gjenbruke main-repo via symlink)
**Prevention:**
- `.husky/`-config deles, men deps må være per-worktree
- Test-engineer / agent som jobber i worktree må ha node_modules

### §6.5 — `.crdownload`-filer i wireframe-katalog (FIXED P3, 2026-04-23)

- **Symptom:** Wireframes i `docs/wireframes/` med `.crdownload`-suffiks → ufullstendige filer
- **Fix:** Re-last fra Tobias' originale kilde
- **Prevention:** Sjekk filstørrelse / PDF-validity før commit

### §6.6 — Manuell iterasjons-loop konvergerer ikke

**Severity:** P0 (prosjekt-eksistensielt)
**Oppdaget:** 2026-05-13 (etter 3-dagers buy-flow-iterasjon)
**Symptom:** PM/agent itererer på buy-flow-bugs med Tobias som manuell verifikator. Hver loop: rapport → gjetting → fix → manual test → ny bug. 5-10 min per iterasjon. Etter 3 dager: marginal fremgang, 4-5 åpne bugs fortsatt. Tobias: "Vi er nødt til å endre kurs."

**Root cause:**
- Manuell verifisering har ingen state-determinisme
- Debug-output viser symptom, ikke race/state
- Ingen catalog over hva som er testet
- Tilbakekoblings-loop er for treg til å konvergere

**Fix (etablert 2026-05-13):**
- Bygg fullverdig E2E-test FØR fortsatt iterasjon — 13s deterministisk
- Hver ny bug fanges av test FØRST, fix etterpå
- Test-runner viser dump av BUY-DEBUG + buy-api-responses + fix-suggestions ved failure
- Se `docs/engineering/PILOT_TEST_FLOW_AND_KNOWLEDGE_PROTOCOL.md`

**Prevention:**
- **HARD REGEL:** Maks 2 manuelle iterasjoner på samme bug uten å skrive automatisk test
- Hvis bug sees 2+ ganger → STOPP iterasjon, skriv test som reproduserer, deretter fix
- Spawn autonomous-loop agent hvis test-bygging tar > 1 time

**Vitnesbyrd om effekt:**
Samme bugs som tok 3 dager manuelt (I8/I9/I10) ble avdekket og fikset på én autonomous-agent-kjøring etter test-infra var på plass. Se commit `9aad3063` på `feat/autonomous-pilot-test-loop-2026-05-13`.

### §6.7 — Sessions-state-resett mellom E2E-test-runs

**Severity:** P2 (test-flakiness)
**Oppdaget:** 2026-05-13
**Symptom:** Andre test-run feilet med `PLAYER_ALREADY_IN_ROOM` — engine fjernet ikke player-slot ved game-end (regulatorisk korrekt for vinner-visning).
**Fix:** `resetPilotState` i `tests/e2e/helpers/rest.ts` kaller IKKE bare `masterStop` men også `DELETE /api/admin/rooms/BINGO_DEMO-PILOT-GOH` for å rive ned GoH-rommet helt.
**Prevention:** Test-cleanup må adressere alle state-eiere: master action, room state, players, og spilleren sin daglige tapsgrense (`raisePlayerLossLimits`).

### §6.8 — Dev-user redirect-race forstyrrer Playwright

**Severity:** P3 (test-harness, ikke prod)
**Oppdaget:** 2026-05-13
**Symptom:** `page.goto('/web/?dev-user=email')` trigger `window.location.replace()`. Playwright klikket på bingo-tile FØR redirect var ferdig → lobby reloadet og click var tapt.
**Fix:** Pre-seed `localStorage` med session-token direkte istedenfor å bruke `?dev-user=`-redirect. Pre-seed `sessionStorage.lobby.activeHallId` så lobby joiner pilot-hall.
**Prevention:**
- Test-harness skal ALDRI avhenge av timing av redirects
- Direct state-injection > URL-baserte triggers
- Når test-flakiness sees, sjekk om timing-avhengighet er skjult

### §6.9 — Scheduled Spill 1 og BingoEngine er separate state-systemer

**Severity:** P2 (test-design — kritisk å forstå for E2E)
**Oppdaget:** 2026-05-13 (Rad-vinst-test development)
**Symptom:** `GET /api/rooms/BINGO_DEMO-PILOT-GOH` returnerte `currentGame: null` selv om scheduled-runden var `status=running`. Test-polling kunne ikke se draws-progresjon.
**Root cause:** Spill 1 har TO separate state-systemer:
- **BingoEngine** (in-memory) eier `roomCode → hostPlayerId-rom`-state for ad-hoc-spill (legacy). For scheduled Spill 1 brukes BingoEngine kun til player-slot-tracking, IKKE til runde-state.
- **Game1DrawEngineService** (DB-backed) eier scheduled-runde-state via `app_game1_scheduled_games` + `app_game1_game_state`. `drawsCompleted`, `currentPhase`, `isPaused` ligger her.

`/api/rooms/:code` returnerer BingoEngine-snapshot. For scheduled Spill 1 returnerer dette tomt `currentGame` fordi BingoEngine ikke har en aktiv "game" — kun en player-slot-container.

**Fix:** Tester må bruke `/api/admin/game1/games/:gameId` (krever GAME1_GAME_READ) som returnerer `engineState` fra Game1DrawEngineService:
```typescript
const detail = await fetch(`/api/admin/game1/games/${gameId}`, { headers: { Authorization: `Bearer ${token}` } });
// detail.data.engineState.drawsCompleted, .currentPhase, .isPaused, .pausedAtPhase
```

**Prevention:**
- Test-design: bruk admin-API for scheduled-game-state, ikke BingoEngine-room-API
- Doc-en (`SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`) beskriver dette, men er lett å glipp
- Hvis du ser `currentGame: null` på et rom som SKAL ha en aktiv runde — det er ikke en bug, det er feil endpoint

### §6.10 — Admin REST `/api/admin/rooms/<code>/draw-next` blokkert for scheduled Spill 1

**Severity:** P3 (test-design)
**Oppdaget:** 2026-05-13
**Symptom:** `POST /api/admin/rooms/BINGO_DEMO-PILOT-GOH/draw-next` returnerer `USE_SCHEDULED_API: "Scheduled Spill 1 må trekkes via Game1DrawEngineService — ikke BingoEngine."`
**Root cause:** `BingoEngine.drawNextNumber` kaster `USE_SCHEDULED_API` for scheduled Spill 1 (slug=bingo). Legacy room-endpointet er for ikke-scheduled room-engine, ikke plan-runtime scheduled-game.

**Konsekvens for tester:** Tester som bruker room-endpointet vil aldri trekke scheduled Spill 1. Før 2026-05-15 betydde dette at man måtte vente på auto-tick/socket. Etter PR #1548 skal E2E bruke test-only `scheduledDrawNext()` i stedet.

**Fix:** For E2E finnes nå test-only `POST /api/admin/game1/games/:gameId/e2e-draw-next` (kun `NODE_ENV=test` eller `E2E_ENABLE_MANUAL_GAME1_DRAW=1`) som wrapper `Game1DrawEngineService.drawNext`. Ikke eksponer dette som vanlig prod-admin-endpoint uten separat sikkerhets-/compliance-vurdering.

**Prevention:** Scheduled Spill 1-tester må bruke scheduled-game-id og `scheduledDrawNext()`. Legacy `/api/admin/rooms/:code/draw-next` er fortsatt feil flate for plan-runtime Spill 1.

### §6.11 — macOS BSD awk støtter ikke `match(..., array)` (GNU awk-only)

**Severity:** P1 (script-portabilitet)
**Oppdaget:** 2026-05-13
**Symptom:** Bash-script som bruker `awk 'match($0, /regex/, m) { print m[1] }'` feiler på macOS med `awk: syntax error at source line 2`
**Root cause:** macOS default awk er BSD awk (`/usr/bin/awk`, "awk version 20200816"). BSD awk støtter `match()` som boolean, men IKKE 3-arg-formen som lagrer match-grupper i array. Det er GNU awk-extension.
**Fix:** Bruk bash regex med `BASH_REMATCH` istedet:
```bash
PARSE_REGEX='^\[([^]]+)\] \[(P[0-3])\] ([^:]+):[[:space:]]*(.*)$'
if [[ "$line" =~ $PARSE_REGEX ]]; then
  echo "${BASH_REMATCH[1]}"  # iso
  echo "${BASH_REMATCH[2]}"  # severity
fi
```
**Prevention:** Bruk **kun** POSIX awk-features i scripts som skal kjøre på macOS. Hvis du må bruke `match(..., array)`, krev `gawk` (brew install gawk) og dokumenter avhengigheten.

**Forekomster:**
- `scripts/monitor-push-to-pm.sh` (originalt awk-basert, fikset til bash regex 2026-05-13)
- `scripts/__tests__/monitor-severity-classification.test.sh` (samme fix)

### §6.12 — macOS default-bash er 3.2; zsh er current shell

**Severity:** P2 (test-portabilitet)
**Oppdaget:** 2026-05-13
**Symptom:** Bash-tests kjørt med `bash scripts/test.sh` (uten shebang) bruker zsh siden Tobias' shell er zsh — `BASH_REMATCH` finnes ikke, tester feiler stille
**Root cause:** macOS Catalina+ defaultet til zsh som login-shell. Interactive shell-prompt + `bash`-kommando-aliaser bruker zsh-kompatibilitets-lag. Eksplisitt `bash` peker likevel til `/bin/bash` (3.2.57), men shebang `#!/usr/bin/env bash` kan hente zsh-mode hvis env-PATH er rart.

**Fix:**
1. Eksplisitt shebang: `#!/usr/bin/env bash` (ALDRI `#!/bin/sh`)
2. Tester kjøres med `/bin/bash scripts/test.sh` for å sikre rett bash
3. Verifiser med `echo $BASH_VERSION` i scriptet — skal returnere `3.2.57(1)-release` på macOS

**Prevention:** Test-scripts skal verifisere `BASH_VERSION` er ikke-tom i sanity-sjekk. Hvis tom → script kjører under zsh/sh → fail fast.

### §6.13 — FIFO writes blokker uten reader

**Severity:** P1 (daemon hang)
**Oppdaget:** 2026-05-13
**Symptom:** Bash-daemon som gjør `echo "msg" > /tmp/fifo` hang-er evig hvis ingen `tail -f /tmp/fifo` kjører
**Root cause:** POSIX FIFO-semantikk: `open(O_WRONLY)` blokkerer til en reader åpner samme FIFO (`open(O_RDONLY)`). I daemon-context betyr det at hver push hang-er hvis PM-sesjon ikke aktivt leser.
**Fix:** Åpne FIFO rw på file descriptor 3 ved daemon-startup:
```bash
exec 3<>"$FIFO"
# Nå har daemon alltid sin egen reader. Writes blokkerer aldri:
echo "msg" >&3
```
Kjernen buffer ~64 KB FIFO-data. Eksterne `tail -f /tmp/fifo`-readers får sin egen kopi av byte-strømmen via separat open().

**Alternative som IKKE virker på macOS:** `timeout 2 bash -c "echo ... > fifo"` — fordi `timeout`-kommando ikke finnes på macOS by default (kun via `brew install coreutils` som `gtimeout`).

**Prevention:** Daemon som skriver til FIFO MÅ åpne den rw-mode på FD-allocation i startup. Sjekk med `lsof -p <pid>` at FD 3 har FIFO-en åpen.

### §6.14 — `tail -F` child-prosesser orphaner ved parent-kill

**Severity:** P2 (daemon cleanup)
**Oppdaget:** 2026-05-13
**Symptom:** `kill -TERM <daemon-pid>` lar `tail -F`-children leve videre, akkumulerer over tid
**Root cause:** Når et bash-script forker `tail -F ... | while read line; do ... done &`, subshell-er har egen process group. SIGTERM til parent dreper kun parent — children fortsetter med PPID=1 (orphaned to init).
**Fix:** Kill process-gruppen, ikke bare lederen:
```bash
# Negativ PID = signaler hele process-group
kill -TERM "-$PID" 2>/dev/null || kill -TERM "$PID"
# Etterfølg med pkill -f sweep for stragglers:
pkill -KILL -f 'pattern-script-name' 2>/dev/null
```
**Prevention:** Wrappers som starter daemoner med children MÅ:
1. Bruke `kill -TERM -PID` for process-group-signaling
2. Sweep med `pkill -f` etter cleanup som sikkerhets-nett
3. `set +m` for å disable job-control-spam ("Terminated: 15"-stderr)

### §6.15 — `set -o pipefail` + `awk '...' | head -N` → SIGPIPE exit 141

**Severity:** P1 (CI-blokker, falske negativer)
**Oppdaget:** 2026-05-13 (CI på PR #1336 skill-mapping-validate)
**Symptom:** GitHub Actions workflow feiler med exit code 141 selv om innholdet er korrekt
**Root cause:** Når `awk` prøver å skrive mer enn `head` leser, mottar awk SIGPIPE. Med `set -o pipefail` blir 141 propagert som job-exit-code → CI faller.
**Fix:** Implementer line-limit INSIDE awk via NR-counter istedenfor pipe til head:
```bash
# DÅRLIG (SIGPIPE-risk):
awk '/pattern/' "$file" | head -15

# BEDRE:
awk '/pattern/ && ++c <= 15' "$file"
```
**Prevention:**
- Vær varsom med `awk | head -N` under `pipefail` — alltid line-limit i awk
- Alternativ: `set +o pipefail` rundt slik blokk + reset etterpå
- I CI-workflows: `set -eu` (uten pipefail) er ofte tryggere for utility-pipelines
**Related:**
- PR #1336 (skill-mapping-validate.yml SIGPIPE fix)
- `.github/workflows/skill-mapping-validate.yml`

### §6.16 — npm workspace package-lock isolation krever `--workspaces=false`

**Severity:** P1 (CI EUSAGE-feil, Stryker/test-deps mismatch)
**Oppdaget:** 2026-05-13 (CI på PR #1339 Stryker mutation testing)
**Symptom:** `npm --prefix apps/backend ci` feiler med EUSAGE / "Missing: <package>" selv etter root `npm install` lagt til child-package
**Root cause:** `npm install <pkg> --prefix apps/backend` (uten flag) skriver til root `package-lock.json`, IKKE `apps/backend/package-lock.json`. Men `npm --prefix apps/backend ci` leser KUN child-lock. Mismatch → EUSAGE.
**Fix:** Bruk `--workspaces=false` flag for å tvinge child-workspace til å skrive til EGEN package-lock:
```bash
npm install --prefix apps/backend --workspaces=false --save-dev <package>
```
**Prevention:**
- I monorepo med workspaces: nytt dev-deps i child må committes til child-lock OG root-lock
- Pre-commit-test: `cd apps/backend && npm ls <package>` skal returnere installed version
- CI bruker `npm --prefix apps/backend ci` — verifiser child-lock har deps
**Related:**
- PR #1339 (Stryker mutation testing) — package-lock workspace bug
- `apps/backend/package.json` devDependencies

### §6.17 — `pg_stat_statements`-extension installert via migration ≠ aktivert; krever `shared_preload_libraries` på prosess-oppstart

**Severity:** P1 (observability black hole — installert verktøy gir null data)
**Oppdaget:** 2026-05-14 (Tobias: "vi skulle vente med database verktøy men alt er satt opp slik at vi ser alt som skjer i databasen")
**Symptom:** Migration `20261225000000_enable_pg_stat_statements.sql` kjørte vellykket (`CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`). `SELECT * FROM pg_extension WHERE extname='pg_stat_statements'` returnerte 1 rad → utvikler antok at observability var aktiv. Men `SELECT * FROM pg_stat_statements` ga ALDRI noen rader (eller bare leftover-data fra et tidligere session). PgHero-dashboardet viste tomme tabeller.
**Root cause:** `pg_stat_statements` er ikke en vanlig extension. Den hooker inn i Postgres' query-executor og kan KUN lastes hvis `shared_preload_libraries` inkluderer `pg_stat_statements` ved prosess-oppstart. `CREATE EXTENSION` registrerer extension-en i `pg_extension`-tabellen, men selve query-trackingen krever at biblioteket er lastet via `shared_preload_libraries` (settable kun via `command:` til postgres-prosessen, eller `postgresql.conf` med restart).
**Fix:** Sett `shared_preload_libraries=pg_stat_statements` på Postgres-prosessen ved oppstart. I `docker-compose.yml`:
```yaml
postgres:
  image: postgres:16-alpine
  command:
    - "postgres"
    - "-c"
    - "shared_preload_libraries=pg_stat_statements"
    - "-c"
    - "pg_stat_statements.track=all"
    - "-c"
    - "pg_stat_statements.max=10000"
    - "-c"
    - "log_min_duration_statement=100"
```
Etter `docker-compose down && docker-compose up -d postgres` vil queries faktisk tracker. Verifiser via `SHOW shared_preload_libraries;` (skal vise `pg_stat_statements`).
**Prevention:**
- I migration-doc-en for tools som krever `shared_preload_libraries`, STÅR det eksplisitt at compose-config må endres — IKKE bare migration. Sjekk om migration-doc-en din inneholder en slik instruks og om den faktisk er gjennomført.
- Sjekkliste når du legger til nye DB-extensions: er det en `shared_preload_libraries`-extension? Hvis ja, oppdater både migration OG `docker-compose.yml` i samme PR.
- Verifiser end-to-end at observability faktisk samler data — ikke bare at extension er registrert. Test-spørring: `SELECT count(*) FROM pg_stat_statements;` skal returnere > 0 etter trafikk.
- Andre Postgres-extensions med samme krav: `pg_cron`, `auto_explain`, `pg_prewarm`, `pg_repack`. Hvis du noensinne ser `must be loaded via shared_preload_libraries` i feilmeldingen — det er denne fallgruven.
**Related:**
- `apps/backend/migrations/20261225000000_enable_pg_stat_statements.sql` — migration-doc-en advarte om dette i kommentar-blokken, men ble glemt
- `docker-compose.yml` postgres-service `command:`-blokk (OBS-7-fix 2026-05-14)
- `scripts/dev/start-all.mjs` `--observability`-flag (OBS-8-integrasjon)
- `docs/operations/PGHERO_PGBADGER_RUNBOOK.md` §3 (aktivering-doc)
- PR feat/db-observability-activate-2026-05-14

---

### §6.17a — Manuelle SQL-queries for runde-debug er sløsete; bruk Round-replay-API

**Severity:** P2 (operational efficiency, ikke en regresjons-bug)
**Oppdaget:** 2026-05-14 (Tobias-direktiv etter to runder 7dcbc3ba + 330597ef der PM måtte gjøre 5-10 SQL-queries per runde for å forstå hva som skjedde)
**Symptom:** PM/Tobias spør "ble auto-multiplikator anvendt riktig?" eller "hvorfor finishet plan-run uten å advance?" og må manuelt sammenstille rader fra `app_game1_scheduled_games`, `app_game1_draws`, `app_game1_phase_winners`, `app_game1_master_audit`, `app_game1_ticket_purchases`, `app_compliance_outbox`, `app_rg_compliance_ledger` — typisk 5-10 queries per runde. Feiltolkninger og sløsing av PM-tid.
**Root cause:** Spill 1 har designet seg fragmentert audit-trail-tabell per tema (purchases / draws / winners / master-audit / ledger), noe som er korrekt arkitektonisk men gir overhead ved enkeltrunde-analyse.
**Fix:** Bruk Round-replay-API. ÉN curl-kommando returnerer komplett event-tidsserie + summary + automatisk anomaly-deteksjon:
```bash
curl -s "http://localhost:4000/api/_dev/debug/round-replay/<scheduled-game-id>?token=$RESET_TEST_PLAYERS_TOKEN" | jq .
```
- `metadata` — alle scheduled-game-felter + catalog + plan-run-status
- `timeline[]` — kronologisk sortert: scheduled_game_created, ticket_purchase, master_action, draw, phase_winner, compliance_ledger, scheduled_game_completed
- `summary` — totals, winners med `expectedCents` vs `prizeCents` + `match`-flag (auto-mult-validert)
- `anomalies[]` — payout_mismatch (critical), missing_advance (info), stuck_plan_run (warn), double_stake (critical), preparing_room_hang (warn)
- `errors{}` — fail-soft per kilde

**Prevention:**
- Når du ber agent debug-e en runde: send round-replay-output i prompten istedet for å la agenten kjøre manuelle SQL
- PM-rutinen ved Tobias-rapport "rar runde 7abc..": `curl round-replay/7abc → jq '.data.anomalies' → handle på det`
- Endepunktet er compliance-grade audit-trail — ALDRI fjern uten ADR-prosess (§71-pengespillforskriften krever sporbarhet)

**Related:**
- PR feat/round-replay-api-2026-05-14 (initial implementasjon)
- `apps/backend/src/observability/roundReplayBuilder.ts` — service
- `apps/backend/src/observability/roundReplayAnomalyDetector.ts` — detektor
- `apps/backend/src/routes/devRoundReplay.ts` — token-gated route
- Skills `spill1-master-flow` v1.5.0 — full spec
- §3.10 + §3.11 — relaterte payout/auto-mult-fallgruver som anomaly-detektoren fanger automatisk

---

### §6.18 — Synthetic bingo-test må kjøres FØR pilot — ikke etter

**Severity:** P0 (pilot-blokker hvis hoppet over)
**Oppdaget:** 2026-05-14 (Tobias-direktiv: "Vi trenger ALLEREDE NÅ et synthetic end-to-end-test")
**Symptom:** Pilot går live uten end-to-end-verifikasjon av at en hel runde fungerer (master-start → N spillere kjøper M bonger → engine trekker → vinner deteksjon → payout → compliance-ledger → wallet konsistent). Hvis I1 (wallet-konservering) eller I2 (compliance-ledger) brytes på pilot-haller, har vi REGULATORISK eksponering mot Lotteritilsynet.
**Root cause:** R4 (load-test 1000 — BIN-817) er post-pilot. R2/R3 (chaos) dekker failover/reconnect, ikke en hel runde. Det manglet et småskala-precursor-test som kunne kjøres på 60 sek og fange grunnleggende invariant-brudd.
**Fix:** `scripts/synthetic/spill1-round-bot.ts` + `spill1-round-runner.sh` etablert 2026-05-14. Verifiserer **seks invarianter (I1-I6)**:
- I1 Wallet-konservering: `SUM(før) − SUM(spent) + SUM(payout) == SUM(etter)`
- I2 Compliance-ledger: minst STAKE per kjøp + PRIZE per payout
- I3 Hash-chain intakt (WARN inntil dev-endpoint legges til)
- I4 Draw-sequence consistency
- I5 Idempotency (clientRequestId → samme purchaseId på re-submit)
- I6 Round-end-state: `scheduled_game.status === 'finished'`

**Prevention:**
- ALLTID kjør `npm run test:synthetic` pre-pilot-deploy (ikke etter)
- Sett `RESET_TEST_PLAYERS_TOKEN=spillorama-2026-test` for full validering inkl. replay-API
- Exit-code 0 = PASS, 1 = FAIL → pilot pauses, 2 = preflight-failure (backend down)
- Mode `--dry-run` for CI smoke-tests (<5 sek, ingen wallet-mutering)
- Sjekk PITFALLS-pekere FØR du spawner agent som rør master-flow / purchase / payout: hvis synthetic-testen FEILER på den runden, har de andre §-ene konkrete root-cause-hint

**Related:**
- Bot: `scripts/synthetic/spill1-round-bot.ts`
- Invariants: `scripts/synthetic/invariants.ts`
- Runbook: `docs/operations/SYNTHETIC_BINGO_TEST_RUNBOOK.md`
- Skill `casino-grade-testing` v1.2.0
- Skill `live-room-robusthet-mandate` v1.3.0
- Skill `spill1-master-flow` v1.9.0
- BIN-817 (R4) — full load-test post-pilot

---

### §6.19 — E2E plan-run-reset brukte DB `CURRENT_DATE` i stedet for appens Oslo business-date

**Severity:** P1 (CI-blokker + falsk rød pilot-flow)
**Oppdaget:** 2026-05-15 (PR #1548 `Pilot-flow E2E` kjørte 22:44 UTC, som er 00:44 i Oslo)
**Symptom:** Første pilot-flow specs passet, men senere specs feilet med `JACKPOT_SETUP_REQUIRED` og `LOBBY_INCONSISTENT/BRIDGE_FAILED` på plan-posisjon 7. Reset-helperen skulle slette dagens `app_game_plan_run`, men runnen ble liggende og auto-advance-state lekket mellom specs.

**Root cause:** `tests/e2e/helpers/rest.ts::resetPilotPlanRunForE2e()` brukte `business_date = CURRENT_DATE` og `scheduled_day = CURRENT_DATE` i Postgres. Appens business-date følger `Europe/Oslo`; GitHub Actions/Postgres kjører UTC. Mellom 22:00 og 23:59 UTC kan Oslo-dagen allerede være neste dato, mens `CURRENT_DATE` fortsatt er forrige UTC-dato.

**Fix:** E2E-reset beregner app business-date eksplisitt med `Intl.DateTimeFormat(..., { timeZone: "Europe/Oslo" })` og sender den som SQL-parameter til både `app_game1_scheduled_games.scheduled_day` og `app_game_plan_run.business_date`.

**Prevention:**
- Test-cleanup som rydder business-date-rader må bruke samme timezone-kontrakt som applikasjonen, ikke DB-serverens `CURRENT_DATE`.
- Søk spesielt etter `CURRENT_DATE` i E2E/test-harness-kode når CI-feil bare opptrer rundt norsk midnatt.
- Pilot-flow specs er stateful selv med én worker. Hver spec må starte på deterministisk Bingo/posisjon 1 når testen handler om kjøpsflyt, ellers kan senere specs arve jackpot/plan-state fra tidligere specs.

**Related:**
- `tests/e2e/helpers/rest.ts` — `resetPilotPlanRunForE2e()`
- `.claude/skills/spill1-master-flow/SKILL.md` v1.20.2
- PR #1548 `Pilot-flow E2E` failure run `25944762867`

---

### §6.20 — Pilot-flow E2E ventet på auto-draw mens CI kjører `JOBS_ENABLED=false`

**Severity:** P1 (CI-blokker + feil mental modell for test-driver)
**Oppdaget:** 2026-05-15 (PR #1548 `Pilot-flow E2E`, run `25945194884`)
**Symptom:** `spill1-rad-vinst-flow.spec.ts` startet scheduled-game korrekt (`gameStatus=running`, `currentPhase=1`), men `drawsCompleted` ble stående på 0 og Rad 1 ble aldri vunnet innen timeout.

**Root cause:** Workflowen `.github/workflows/pilot-flow-e2e.yml` setter `JOBS_ENABLED=false` med vilje, slik at CI ikke kjører cron/scheduler jobs. Rad-vinst-testen ventet fortsatt på `game1-auto-draw-tick`, som derfor aldri kjørte. Å slå på `JOBS_ENABLED=true` ville aktivert hele scheduler-flaten og gjort testen mindre deterministisk.

**Fix:** Legg inn test-only scheduled draw-driver:
- `POST /api/admin/game1/games/:gameId/e2e-draw-next` i `apps/backend/src/routes/adminGame1Master.ts`
- kun tilgjengelig i `NODE_ENV=test` eller eksplisitt `E2E_ENABLE_MANUAL_GAME1_DRAW=1`
- krever `GAME1_MASTER_WRITE` og hall-scope mot master-hall
- kaller `Game1DrawEngineService.drawNext(gameId)`
- `tests/e2e/helpers/rad-vinst-helpers.ts::scheduledDrawNext()` brukes av Rad-vinst-testen til å trekke deterministisk til phase-advance

**Prevention:**
- Pilot-flow specs skal eie alle state transitions eksplisitt når workflowen kjører med `JOBS_ENABLED=false`.
- Ikke reparer denne typen E2E ved å slå på scheduler-jobs globalt i CI.
- Hvis en test trenger scheduled Spill 1-draws, bruk `scheduledDrawNext()` og dokumenter hvorfor endpointet er test-only.
- Legacy `/api/admin/rooms/:code/draw-next` gjelder ikke scheduled Spill 1; den gir `USE_SCHEDULED_API`.

**Related:**
- `.github/workflows/pilot-flow-e2e.yml`
- `apps/backend/src/routes/adminGame1Master.ts`
- `tests/e2e/helpers/rad-vinst-helpers.ts`
- `tests/e2e/spill1-rad-vinst-flow.spec.ts`
- `.claude/skills/spill1-master-flow/SKILL.md` v1.20.3
- PR #1548 `Pilot-flow E2E` failure run `25945194884`

### §6.21 — Full-plan runner må godta `finished` som korrekt sluttstate

**Severity:** P1 (falsk negativ i full-plan load-test)
**Oppdaget:** 2026-05-16 (første GoH full-plan-kjøring fullførte alle 13 spill, men rapporterte `failed`)
**Symptom:** Alle 13 runder har `status=completed`, men runneren avslutter med `GAME_PLAN_RUN_INVALID_TRANSITION` fordi den kaller `advance` etter at plan-run allerede er `finished`.
**Root cause:** Test-runneren forventet `PLAN_COMPLETED_FOR_TODAY` ved ekstra advance, men backend kunne allerede ha satt plan-run til `finished` etter siste runde. Da er et nytt advance-kall en invalid transition, men produktets sluttstate er korrekt.
**Fix:** `scripts/dev/goh-full-plan-run.mjs::advancePastEnd()` behandler `GAME_PLAN_RUN_INVALID_TRANSITION` med `status=finished` som forventet sluttresultat (`expectedPlanAlreadyFinished=true`).
**Prevention:**
- Full-plan tests skal verifisere final DB-state (`status=finished`, `current_position=13`) i tillegg til HTTP-response på et ekstra advance-kall.
- Ikke diagnostiser et slikt runner-fail som produktfail før per-runde-tabellen og plan-run-final-state er lest.
**Related:**
- `scripts/dev/goh-full-plan-run.mjs`
- `docs/evidence/20260516-goh-full-plan-run/goh-full-plan-run-2026-05-16T15-52-08-891Z.md`

### §6.22 — Synthetic load-spillere kan arve stale RG-loss-ledger mellom lokale full-plan-runs

**Severity:** P1 (falsk `LOSS_LIMIT_EXCEEDED` i load-test)
**Oppdaget:** 2026-05-16 (første GoH full-plan-run stoppet på Oddsen 56)
**Symptom:** Noen få syntetiske `demo-load-*`-spillere feiler kjøp med `LOSS_LIMIT_EXCEEDED` selv om saldo er høy og resten av hallene kjøper normalt. Feilen kom på runde 10 (`oddsen-56`) etter mange tidligere lokale testkjøp.
**Root cause:** `app_rg_loss_entries` og personlige RG-limit-rader fra tidligere lokale testøkter lå igjen for samme syntetiske load-brukere. Dagens tap nærmet seg default limit, og neste kjøp ble korrekt blokkert av responsible-gaming-regler. Dette var testdata-støy, ikke purchase-flow-regresjon.
**Fix:** `scripts/dev/goh-full-plan-run.mjs` resetter `app_rg_loss_entries`, `app_rg_personal_loss_limits` og `app_rg_pending_loss_limit_changes` for syntetiske `demo-load-h%@example.com`-brukere i de fire demo-hallene før full-plan-run.
**Prevention:**
- Ved load-test med gjenbrukte syntetiske brukere må RG-ledger resettes eller brukerne roteres.
- Hvis backend allerede har RG-state cachet i minne, restart backend etter reset.
- Ikke øk RG-limits for å få testen grønn uten å dokumentere hvorfor; det skjuler en ekte compliance-guard.
**Related:**
- `scripts/dev/goh-full-plan-run.mjs`
- `docs/operations/GOH_FULL_PLAN_TEST_RESULT_2026-05-16.md`
- `docs/evidence/20260516-goh-full-plan-run/`

### §6.23 — Scheduled Spill 1 `ticket:mark` kan feile selv om server-side round fullfører

**Severity:** P1 (spillerklient/live-markering kan være ute av sync med scheduled-game)
**Oppdaget:** 2026-05-16 (GoH full-plan runner, clean rerun)
**Status:** LØST 2026-05-17 (scheduled mark-validator før legacy fallback)
**Symptom:** Alle 13 runder fullfører server-side med draws, pattern-eval, tickets og purchases, men socket-klientene får `ticket.mark.failures` med kode `GAME_NOT_RUNNING` og melding `Ingen aktiv runde i rommet.` Runnerens per-runde `Marks` står 0.
**Root cause:** Generic socket-handler `ticketEvents.ts` kalte `BingoEngine.markNumber()` for alle rom. Scheduled Spill 1 har ikke autoritativ running game i legacy `BingoEngine`; state eies av `Game1DrawEngineService` + DB (`app_game1_scheduled_games`, `app_game1_draws`, `app_game1_ticket_assignments`). Derfor returnerte legacy-engine `GAME_NOT_RUNNING` selv mens scheduled-engine fullførte draw/pattern-eval korrekt.
**Fix:** `ticket:mark` prøver først `Game1ScheduledTicketMarkService.validate()`. Service bruker in-memory `RoomSnapshot.scheduledGameId` for å identifisere scheduled Spill 1 og validerer mot DB-backed scheduled state: status `running`/`paused`, tallet er trukket, spilleren finnes i rommet, og spillerens assignments inneholder tallet. Kun non-scheduled rom faller tilbake til `BingoEngine.markNumber()`.
**Prevention:**
- Full-plan-runner skal fortsette å logge mark-failures som anomalies selv når runden fullfører.
- Ikke bruk kun server-side draw completion som bevis for at live-spiller-markering er frisk.
- Aldri kall `BingoEngine.markNumber()` direkte for scheduled Spill 1.
- Aldri hydrer full `enrichScheduledGame1RoomSnapshot()` per `ticket:mark`; GoH 4x80 kan produsere hundretusener av marks og full snapshot per mark blir N+1/load-regresjon.
- Regresjonstester: `apps/backend/src/game/Game1ScheduledTicketMarkService.test.ts` og `apps/backend/src/sockets/gameEvents/ticketEvents.scheduled.test.ts`.
**Related:**
- `docs/evidence/20260516-goh-full-plan-run/goh-full-plan-run-2026-05-16T15-52-08-891Z.json`
- `docs/operations/GOH_FULL_PLAN_TEST_RESULT_2026-05-16.md`
- `scripts/dev/goh-full-plan-run.mjs`
- `apps/backend/src/game/Game1ScheduledTicketMarkService.ts`
- `apps/backend/src/sockets/gameEvents/ticketEvents.ts`

### §6.24 — Full-plan runner må ikke hardkode 4x20 ticket-forventning

**Severity:** P1 (false negative når load-skala endres)
**Oppdaget:** 2026-05-16 (Tobias ba om 4 testhaller x 80 spillere per hall)
**Symptom:** `scripts/dev/goh-full-plan-run.mjs --players-per-hall=80` kunne koble til og kjøpe med 320 spillere, men runnerens forventning for ready-state/ticket assignments var fortsatt implisitt låst til 4 haller x 50 ticket assignments = 200 per runde.
**Root cause:** 4x20-baseline hadde 5 small og 15 large per hall: `5*1 + 15*3 = 50`. Runner-koden hardkodet `HALLS.length * 50` og `digitalTicketsSold: 50` i stedet for å regne fra faktisk klientliste.
**Fix:** Runneren beregner nå forventning fra `clients[]`: per hall `client.indexInHall <= 5 ? 1 : 3`, totalen summeres per faktisk hall. For 80 spillere per hall blir korrekt forventning 230 assignments per hall og 920 per runde.
**Prevention:**
- Test-runnere som har `--players-per-hall` må aldri hardkode sideeffekter fra én baseline-skala.
- Ved ny load-skala: logg forventet assignments per runde ved startup og legg den i evidence JSON.
- Før større GoH-run: kjør `node --check scripts/dev/goh-full-plan-run.mjs` og verifiser at `expectedTicketAssignmentsPerRound` matcher `5*1 + (playersPerHall-5)*3` per hall.
**Related:**
- `scripts/dev/goh-full-plan-run.mjs`
- `docs/evidence/20260516-goh-full-plan-run-4x80/`
- `docs/operations/GOH_FULL_PLAN_4X80_TEST_RESULT_2026-05-16.md`

---

## §7 Frontend / Game-client

### §7.1 — Game1Controller default `variantConfig=STANDARD`

**Severity:** P0 (pilot-blokker, fixed PR #1128)
**Oppdaget:** 2026-05-09
**Symptom:** Spillerklient header viste "STANDARD" istedenfor "Bingo"
**Root cause:** Game1Controller brukte hardkodet default istedenfor å hente fra plan-runtime aggregator
**Fix:** Hent fra `lobby.planMeta?.catalogDisplayName` via `LobbyStateBinding`
**Prevention:**
- Aldri hardkode display-text — alltid fra catalog/plan-runtime

### §7.2 — BongCard 8 hardkodete farger

**Severity:** P0 (spec-brudd, fixed PR #1132)
**Oppdaget:** 2026-05-09
**Symptom:** Buy-popup viste 8 farger; spec sier 3 (hvit/gul/lilla)
**Fix:** Les `lobby.scheduledGameMeta.ticketColors` + `ticketPricesCents` fra plan-runtime
**Prevention:**
- Trafikklys er spesialtilfelle: 1 farge flat 15 kr
- Backend må eksponere `ticketColors[]` i lobby-state

### §7.3 — Aldri lokal countdown — vente på master-trigger

**Severity:** P1 (Tobias-direktiv 2026-05-09)
**Oppdaget:** 2026-05-09 sesjon, fixed PR #1132
**Symptom:** Spillerklient kjørte auto-countdown → degradert state ("...") når 0
**Fix:** Lytt på `lobby.scheduledGameStatus` transition → vis "Venter på master" når ikke `running`
**Prevention:**
- Spill 1 = master-trigger ONLY
- `WaitingForMasterOverlay`-komponent må mountes når status !== `running`

### §7.4 — Browser-debugging via chrome-devtools-mcp, IKKE computer-use (FIXED P2, 2026-04)

- **Symptom:** Workflow-anti-mønster — agent bruker computer-use for browser-tasks
- **Fix:** Bruk `chrome-devtools-mcp` for console logs, screenshots, JS eval, network
- **Prevention:** memory: `debug_preference.md` — aldri computer-use for browser-tasks

### §7.27 — Bong-design: §5.9-spec gjelder Spill 1 + Spill 3 (delt komponent), Spill 2 er uberørt

**Severity:** P0 (regulatorisk-tilstøtende: feil rendering blokkerer pilot)
**Oppdaget:** 2026-05-15 (§5.9 prod-implementasjon)
**Symptom:** Spec §5.9 sier "Gjelder Spill 1 og Spill 2 (begge bruker BingoTicketHtml.ts)" men det er upresist — Spill 2 bruker `BongCard.ts`, Spill 3 bruker `BingoTicketHtml` (via Game1's `PlayScreen` → `TicketGridHtml`).
**Faktisk scope:**
- **Spill 1:** Bruker `BingoTicketHtml` → får §5.9-design.
- **Spill 3:** Bruker SAMME `BingoTicketHtml` → får §5.9-design automatisk. Det er korrekt per Tobias-direktiv 2026-05-03 ("Alt av design skal være likt [Spill 1]").
- **Spill 2:** Bruker EGEN `BongCard.ts` → er uberørt og må videreutvikles separat hvis Tobias vil bringe samme design dit.
**Prevention:**
- Aldri rør `packages/game-client/src/games/game2/components/BongCard.ts` under bong-design-arbeid på Spill 1/3
- Verifiser med `grep -rn "BingoTicketHtml" packages/game-client/src/games/` før strukturelle endringer
**Files:**
- `packages/game-client/src/games/game1/components/BingoTicketHtml.ts` (delt mellom Spill 1 + Spill 3)
- `packages/game-client/src/games/game2/components/BongCard.ts` (Spill 2 — IKKE rør under §5.9-arbeid)
**Related:** §5.9 i `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`, skill `bong-design`

### §7.28 — Triple-ticket-rendering kan IKKE bygges som single-component render — backend må endres først (LØST i Bølge 2, 2026-05-15)

**Severity:** P1 (arkitektonisk constraint) — **LØST 2026-05-15**
**Oppdaget:** 2026-05-15 (§5.9 prod-implementasjon Bølge 1)
**Symptom:** Spec §5.9 viser "Trippel-design (3× 5×5 grids med dividers) i 660px bredde container" for `ticket.type="large"`. Naiv implementasjon ville prøve å rendre 3 sub-grids i én `BingoTicketHtml`-instans.
**Faktisk wire-format:** Backend sender 3 SEPARATE `Ticket`-objekter per Large-kjøp (per `TicketGridHtml.largeMultiplicity.test.ts` — REGRESSION 2026-04-30 Bug B). Hver ticket har sitt eget grid, sin egen color="Large Yellow", sin egen `type="large"`.
**Konsekvens (før Bølge 2):** Det fantes IKKE et data-model-konsept for "triple-ticket" — bare 3 separate `Ticket`-objekter som tilfeldigvis kom i samme buy-batch. Frontend kunne ikke gruppere dem uten backend-endring.
**§5.9-spec interpreted (Bølge 1, 2026-05-15):** Hver individuelle Large-ticket rendrer som single-design med header "Farge - 3 bonger" (suffiks signaliserer at den tilhører en 3-brett-bunt). Triple-design med dividers i 666px container var IKKE implementert i Bølge 1.
**Resolusjon (Bølge 2, 2026-05-15):** `Ticket`-interfacet utvidet med `purchaseId` + `sequenceInPurchase` i både `packages/shared-types/src/game.ts` og `apps/backend/src/game/types.ts`. `Game1ScheduledRoomSnapshot.enrichScheduledGame1RoomSnapshot` propagerer disse fra `app_game1_ticket_assignments`-tabellen (allerede eksisterende kolonner per migration `20260501000000`). Frontend grupperer 3 etterfølgende tickets med samme `purchaseId` til `BingoTicketTripletHtml` wrapper. Se skill `bong-design` §"Triple-bong group-rendering" for detaljer.
**Lessons learned:** Forrige PM antok at `siblingTicketIds: string[]` var nødvendig wire-format-endring. Faktisk var `purchaseId` allerede tilgjengelig som DB-felt — vi måtte bare propagere det til wire. Sjekk eksisterende DB-skjema FØR du legger til nytt felt.
**Files (post-Bølge 2):**
- `packages/game-client/src/games/game1/components/BingoTicketHtml.ts` (per-ticket single render — uberørt for single)
- `packages/game-client/src/games/game1/components/BingoTicketTripletHtml.ts` (NY wrapper-klasse for triple-rendering)
- `packages/game-client/src/games/game1/components/TicketGridHtml.ts` (purchaseId-gruppering i `rebuild` + `tryGroupTriplet`)
- `packages/game-client/src/games/game1/components/TicketGridHtml.largeMultiplicity.test.ts` (eksisterende tester forventer fortsatt single-rendering for tickets uten purchaseId — bevisst backward-compat)
- `packages/shared-types/src/game.ts` + `packages/shared-types/src/schemas/game.ts` (`purchaseId` + `sequenceInPurchase`)
- `apps/backend/src/game/types.ts` (`Ticket`-interface med `purchaseId` + `sequenceInPurchase`)
- `apps/backend/src/game/Game1ScheduledRoomSnapshot.ts` (propagering fra DB til wire)
**Related:** §5.9 i `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`, skill `bong-design`, §7.29 (Bølge 2 cache + liveCount-rom-skifte)

### §7.29 — TicketGridHtml.tickets blandet entry-rom (single OR triplet) — `liveCount` må konverteres fra ticket-rom

**Severity:** P1 (subtle bug-prone refactor)
**Oppdaget:** 2026-05-15 (Bølge 2 triple-rendering)
**Symptom:** Etter Bølge 2 inneholder `TicketGridHtml.tickets` BLANDET typer (`BingoTicketHtml | BingoTicketTripletHtml`). En triplet teller som ÉN entry men inneholder 3 underliggende `Ticket`-objekter. Hvis du naivt itererer `for (i = 0; i < liveCount; i++)` på `this.tickets` med ticket-rom-`liveCount`, vil du:
1. Gå out-of-bounds når triplets reduserer entry-count
2. Behandle pre-round-entries som live (eller omvendt) når live-pre-round-grensen krysser triplet-grupperinger
**Root cause:** Caller (`Game1Controller`) sender `liveCount` i ticket-rom (det er hva backend pusher). `rebuild()` konverterer til entry-rom ved å regne hvor mange `Ticket`-objekter som ble konsumert per entry (1 for single, 3 for triplet).
**Prevention:**
- `rebuild()` SKAL oppdatere `this.liveCount` til entry-rom etter at den har bygd opp `this.tickets`-arrayen
- `applyMarks()` SKAL bruke `this.liveCount` direkte (entry-rom), IKKE ta `liveCount` som parameter
- `markNumberOnAll()` SKAL bruke `this.liveCount` (entry-rom)
- `computeSignature` + `computeMarkStateSig` regnes på ticket-rom (uendret) så cache-hit-logikken fortsatt fungerer fordi signature inkluderer `l=${liveCount}` som ticket-rom-verdi
- IKKE overwrite `this.liveCount = liveCount` etter cache-hit — verdien er fortsatt korrekt fra forrige `rebuild()`
**Why this works:** Backend purchase-atomicitet garanterer at en triplet ALDRI splittes på live/pre-round-grensen — alle 3 sub-tickets i en purchase har samme `scheduled_game_id` og samme status. Caller's `liveCount` i ticket-rom havner alltid på en triplet-grense (multiple of 3 for triplet-segmenter, +N for små single-tickets).
**Files:**
- `packages/game-client/src/games/game1/components/TicketGridHtml.ts` (`rebuild`, `applyMarks`, `markNumberOnAll`)
**Related:** §7.28 (resolusjon), skill `bong-design` §"TicketGridHtml — entry-rom vs ticket-rom"

### §7.5 — Frontend må normalisere query-params før backend-kall

**Severity:** P0 (pilot-blokker for lokal test, fixed PR #1149)
**Oppdaget:** 2026-05-10 (Tobias-bug)
**Symptom:** `?dev-user=demo-pilot-spiller-1` (uten `@example.com`) → 403 fra backend
**Root cause:** Frontend (`auth.js` + `main.ts`) sendte raw query-param uten normalisering. Backend allowlist-regex (`/^demo-pilot-\w+@example\.com$/`) krever full email — KORREKT spec.
**Fix:** Pure-funksjon `normalizeDevUserParam()` i begge dev-user-paths som mapper kort-form → full email FØR backend-kall
**Prevention:**
- Backend-kontrakter (allowlist-regex, schemas) er sannhet — frontend MÅ matche
- Kasusvis kort-form-syntax må normaliseres på frontend, ikke løsne backend
- Lås kontrakter i tester: `devAutoLoginRoute.handler.test.ts` (16 tester) verifiserer at short-form FORBLIR avvist
- Frontend må ha matchende regression-test (`devUserAutoLoginRegression.test.ts`)
- Anti-mønster: "Backend rejecter min input → backend må fikses" — ofte er backend riktig

### §7.6 — JackpotSetupModal eksisterte død i 3 dager før wireup

**Severity:** P0 (UX-blocker for jackpot-spill)
**Oppdaget:** 2026-05-10 (Tobias-bug fra screenshot)
**Symptom:** Backend kastet `JACKPOT_CONFIRM_REQUIRED` / `JACKPOT_SETUP_REQUIRED` → frontend viste rå `Toast.error` istedenfor popup
**Root cause:** `JackpotSetupModal.ts` (245 linjer fra Fase 3, 2026-05-07) var bygd men ALDRI wired inn noe sted. Komponenten kunne kun kalles fra tester.
**Fix (PR #1150):** Wire-er begge modaler (Setup + Confirm) inn i `Spill1HallStatusBox.startGame` + `NextGamePanel.attemptSpill1Start` via `runStartWithJackpotFlow`-loop som retry'er etter modal-submit
**Prevention:**
- Når en komponent opprettes for et flowfix, må wireup-PR landes i SAMME bølge — ikke etterlate "klar-til-bruk" som dødkode
- Sjekk: kan komponenten kalles fra produksjons-flyt? Hvis nei, ikke marker leveranse som ferdig
- Backend error-codes skal ALLTID ha matchende UI-handler i frontend — `Toast.error` er IKKE handler, det er fallback
- Tester må dekke wireup-pathen, ikke bare selve komponenten isolert

### §7.7 — `Number(null) === 0`-edge-case i JSON-parsing

**Severity:** P2 (subtil bug i JackpotSetupModal-data-extraction)
**Oppdaget:** 2026-05-10 (PR #1150 test eksponerte)
**Symptom:** `extractJackpotConfirmData` filtrerte ikke ut `null`/`undefined`/`boolean` i drawThresholds-array → `Number(null) === 0` ble inkludert som gyldig threshold
**Fix:** Eksplisitt type-sjekk for `null`/`undefined`/`boolean` før `Number()`-konvertering
**Prevention:**
- `Number()` kaster ikke ved invalid input — det returnerer `0` eller `NaN`
- Bruk `typeof v === 'number' && Number.isFinite(v)` som primær guard
- Skriv tester som passerer `[null, undefined, false, 50, "55"]` for å fange edge-cases

### §7.8 — JackpotConfirmModal var feil mental modell (fjernet ADR-0017)

**Severity:** P1 (designfeil korrigert)
**Oppdaget:** 2026-05-10 (Tobias-bug-test rett etter PR #1150)
**Symptom:** Master fikk read-only popup på Bingo (pos 1) som viste daglig akkumulert pott. Tobias forventet input-felt (per-bongfarge + draw) — men kun på Jackpot-katalog-spillet (pos 7), ikke på alle spill.
**Root cause:** Backend kastet `JACKPOT_CONFIRM_REQUIRED` ved start av ALLE spill for å bekrefte daglig pott bygd opp av cron (`jackpotDailyTick` +4000/dag, max 30 000). Mental modell var "auto-akkumulering + master bekrefter på hvert spill". Tobias' faktiske mental modell: "ingen akkumulering, master setter alt manuelt KUN på Jackpot-spillet."
**Fix:** ADR-0017 (`docs/adr/0017-remove-daily-jackpot-accumulation.md`, lander via PR #1154) fjerner daglig akkumulering helt. Cron-job deaktiveres, `JACKPOT_CONFIRM_REQUIRED`-error fjernes, `JackpotConfirmModal.ts` slettes. KUN `JACKPOT_SETUP_REQUIRED`-flow på `jackpot`-katalog-spillet (pos 7) beholdes — master setter blank input via `JackpotSetupModal`.
**Prevention:**
- Test mental-modell-antakelser med Tobias FØR større features bygges (særlig "smart auto"-funksjonalitet)
- Daglig akkumulering var bygd uten eksplisitt Tobias-direktiv om at det var ønsket — anti-mønster: implementer "smart auto-funksjonalitet" når brukerne forventer manuell kontroll
- Når en feature blokkerer master-flyt for ALLE spill (ikke bare det relevante), er det signal om feil scoping
- Frontend popup-visualisering avslører ofte mental-modell-feil — Tobias så popup på Bingo og forsto umiddelbart at modellen var feil
- ADR-0017 demonstrerer korrekt response: ny ADR som fjerner feilen, ikke patch på toppen
**Related:**
- ADR-0017 — fjerner daglig jackpot-akkumulering
- PR #1150 (introduserte `JackpotConfirmModal` som denne ADR-en fjerner)
- §7.6 (JackpotSetupModal eksisterte død i 3 dager) — beholdes; KUN `JackpotSetupModal` brukes på pos 7

### §7.9 — `state.ticketTypes` overrider plan-runtime variantConfig

**Severity:** P0 (BuyPopup viste 8 farger fra DEFAULT_STANDARD_CONFIG i stedet for 3 fra plan)
**Oppdaget:** 2026-05-10 (Tobias live-test: "fortsatt ikke riktig spill som kan spilles her og det er heller ikke riktig bongtyper")
**Symptom:** Spillerklient BuyPopup viste 8 hardkodete farger (Small Yellow/White/Purple/Red/Green/Orange + Large Yellow/White) selv om plan-runtime hadde 3 farger (hvit/gul/lilla)
**Root cause:** `PlayScreen.showBuyPopup` prioriterte `state.ticketTypes` (fra room-snapshot, defaultet til `DEFAULT_STANDARD_CONFIG` med 8 farger) OVER `this.lobbyTicketConfig` (bygd fra `LobbyStateBinding` med riktige 3 farger fra katalog). Race-rekkefølge: state-snapshot kom først → ticket-typer satt → lobby-update overrode aldri.
**Fix:** PR #1190 — flippet priority i `PlayScreen.ts:587-609` så `lobbyTicketConfig` vinner over `state.ticketTypes`. Lobby er single-source-of-truth for ticket-config.
**Prevention:**
- Når to kilder for samme data eksisterer: dokumentér eksplisitt hvilken som er autoritativ
- Lobby/plan-runtime er ALLTID autoritativ for spill-konfigurasjon (game variant, ticket colors, prizes) — ikke room-snapshot
- Pre-pilot regression: spawn ny runde av Innsatsen → BuyPopup skal vise 3 farger ikke 8
- BuyPopup-spec bør være: "Hvis lobbyTicketConfig er satt, ignorer state.ticketTypes"
**Related:**
- PR #1190 (priority-flip)
- `packages/game-client/src/games/game1/screens/PlayScreen.ts:587-609`
- `packages/game-client/src/games/game1/logic/lobbyTicketTypes.ts` — `buildBuyPopupTicketConfigFromLobby`
- §7.1 (Game1Controller default `variantConfig=STANDARD`) — relatert root cause

### §7.10 — Static game-client-bundle krever eksplisitt rebuild

**Severity:** P0 (klient-endringer slo ikke gjennom i timer)
**Oppdaget:** 2026-05-10 (Tobias rapporterte "fortsatt samme bilde" etter merget PR-er)
**Symptom:** Endringer i `packages/game-client/src/` synlige i Vite HMR (`localhost:5174`) men IKKE i `localhost:4000/web/?dev-user=...` (spiller-shell)
**Root cause:** Spiller-shell laster game-client som **statisk bundle** fra `apps/backend/public/web/games/`, ikke fra Vite dev-server. Bundle bygd manuelt via `npm run build:games` — siste build var 5 dager gammel. Hot-reload dekker IKKE dette.
**Fix:** PR #1189 — la til `npm run build:games` som §5 i `scripts/dev/nuke-restart.sh` så `dev:nuke` alltid bygger fersk bundle før dev-stack starter.
**Prevention:**
- `npm run dev:nuke` er standard restart-kommando (ikke `dev:all` direkte)
- Hvis Tobias sier "fortsatt samme bilde" etter merget PR → første sjekk: er bundlen oppdatert? (`ls -la apps/backend/public/web/games/*.js`)
- Game-client-endringer krever ALLTID `build:games` for å være synlige i spiller-shell
- Admin-web (`:5174`) bruker Vite HMR direkte — der gjelder ikke denne fallgruven
**Related:**
- PR #1189 (build:games i nuke-restart)
- `scripts/dev/nuke-restart.sh`
- `apps/backend/public/web/games/` — statisk bundle-output
- §11.8 (kommer) — single-command restart

### §7.11 — Lobby-init race condition: synkron `void start()` mister state

**Severity:** P0 (lobby returnerte null nextScheduledGame periodisk)
**Oppdaget:** 2026-05-10 (test-engineer-agent fant via regression-test)
**Symptom:** Spillerklient sporadisk så "Venter på master" overlay selv om plan-runtime var aktiv. Race-rekkefølge: socket-connect → state-snapshot kom før lobby-state ble fetchet → klient hadde stale defaults.
**Root cause:** `Game1Controller:398` startet `LobbyStateBinding` med `void this.lobbyStateBinding.start()` (fire-and-forget). Initial state-snapshot kom på socket innen `LobbyStateBinding.start()` resolved → BuyPopup og overlay leste defaults før lobby var ferdig.
**Fix:** PR #1185 — endret til `await this.lobbyStateBinding.start()` så controller blokkerer initial state-flow til lobby har levert første snapshot.
**Prevention:**
- Async-init MÅ awaitges når downstream-state avhenger av resultatet
- `void promise()` er bare OK når feilen er irrelevant og rekkefølgen ikke betyr noe
- Regression-test pattern: spawn test-engineer FØRST for å finne race-vinduet, så fix
- Pre-pilot: dev:nuke + start spiller med dev-user → første lobby-snapshot må komme før noen UI-elementer rendres
**Related:**
- PR #1185 (await fix)
- `packages/game-client/src/games/game1/Game1Controller.ts:398`
- `packages/game-client/src/games/game1/lobby/LobbyStateBinding.ts`

### §7.12 — WaitingForMasterOverlay backdrop `pointer-events: auto` blokkerte BuyPopup-klikk

**Severity:** P0 (spiller kunne ikke kjøpe bonger)
**Oppdaget:** 2026-05-10 (Tobias: "fortsatt fikk samme bilde uten muloighet for å kjøpe")
**Symptom:** "Venter på master"-overlay vises over PlayScreen. BuyPopup-stepperne (Small Yellow +/- Lilla +/-) ble dekket av overlay-cardet — klikk gikk til overlay i stedet.
**Root cause:** `WaitingForMasterOverlay.mount()` satte `card.style.pointerEvents = "auto"` for fokus-styling. Card sentreres i viewport og dekket dermed BuyPopup-stepperne (som ligger lavere i z-index men er interaktive).
**Fix:** Først PR #1193 (satt card til `pointer-events: none`), deretter PR #1196 (fjernet hele overlay-komponenten — erstattet med `CenterBall.setIdleText()` per Tobias-direktiv: "kula som viser hvilket tall som blir trekt. Når det ikke er aktiv runde så fjerner vi den og skriver tekst der: Neste spill: {neste på planen}").
**Prevention:**
- Overlays med `pointer-events: none` på backdrop MÅ ha `none` på alle nested elementer som dekker interaktive UI
- "Display-only overlay" → ALDRI `pointer-events: auto` (det skal kun stå hvor brukeren skal kunne klikke)
- Alternativ design er bedre: bruk eksisterende UI-element (CenterBall) i stedet for å legge nytt overlay på toppen
- Pre-pilot: med pause-state spawn'et, spillere skal kunne klikke ALLE BuyPopup-knapper
**Related:**
- PR #1193 (pointer-events fix)
- PR #1196 (overlay slettet, erstattet med CenterBall idle-text)
- `packages/game-client/src/games/game1/components/CenterBall.ts:setIdleText`

### §7.13 — `PLAYER_ALREADY_IN_ROOM` på ALLE room-join-paths (ikke bare delta-watcher)

**Severity:** P0 (klient blokkert fra spill)
**Oppdaget:** 2026-05-11 (PR #1218 — delta-watcher-pathen), utvidet 2026-05-13 (I15 — initial-join-pathen).

**Symptom:**
- **Variant A (PR #1218):** Klient joiner hall-default-rom (canonical: `BINGO_<HALL>`), så spawner master scheduled-game i samme canonical roomCode. Delta-watcher trigger ny `game1:join-scheduled` → server returnerer `PLAYER_ALREADY_IN_ROOM` → klient mister state-sync.
- **Variant B (I15, denne 2026-05-13):** Spiller navigerer tilbake til lobby (`returnToShellLobby`) og inn igjen mid-runde. Klient kaller `game1:join-scheduled` initial → server `joinScheduledGame` → `engine.joinRoom` → `assertWalletNotAlreadyInRoom` THROW `PLAYER_ALREADY_IN_ROOM`. Klient lander på `Game1LobbyFallback`-overlay i stedet for pågående runde.

**Root cause:** `engine.detachSocket` (`BingoEngine.ts:3802-3831`) beholder player-record (kun socketId nullstilles) av regulatoriske grunner — armed-state, lucky-number-valg, forhåndskjøpte bonger må overleve disconnect/reconnect. Konsekvensen er at **ALLE handler-paths som kaller `engine.joinRoom` MÅ ha en re-attach-guard via `findPlayerInRoomByWallet` + `attachPlayerSocket`**:
- ✅ `room:create` (`roomEvents.ts:372-397`)
- ✅ `room:join` (`roomEvents.ts:771-806`)
- ✅ `room:resume` (`roomEvents.ts:863+`) — re-attach by design
- ✅ `game1:join-scheduled` (`game1ScheduledEvents.ts:288-365`) — **fikset 2026-05-13 (I15)** via re-attach-guard, etter at PR #1218 fikset klient-side-fallback for delta-watcher men IKKE backend-side-guard for initial-join

PR #1218 introduserte klient-side fallback (`PLAYER_ALREADY_IN_ROOM` → `socket.resumeRoom`) for `handleScheduledGameDelta`-pathen, men det dekket ikke `Game1Controller.start` (initial join). I15-fix legger guard på backend-side i `joinScheduledGame` så ALLE handler-paths har samme mønster.

**Fix:**
- **PR #1218 (Variant A):** Game1Controller fanger `PLAYER_ALREADY_IN_ROOM` i `handleScheduledGameDelta` og kaller `socket.resumeRoom({ roomCode })` for å sync state.
- **2026-05-13 / `fix/reentry-during-draw-2026-05-13` (Variant B / I15):** Backend `joinScheduledGame` får re-attach-guard som speiler `room:create`/`room:join` — sjekker `findPlayerInRoomByWallet` før `engine.joinRoom` og kaller `attachPlayerSocket` hvis player allerede finnes. Test: `apps/backend/src/sockets/__tests__/game1ScheduledEvents.reconnect.test.ts` + E2E `tests/e2e/spill1-reentry-during-draw.spec.ts`.

**Prevention:**
- ALDRI kall `engine.joinRoom` uten å først sjekke `findPlayerInRoomByWallet` — du vil treffe `PLAYER_ALREADY_IN_ROOM` ved enhver reconnect mid-runde
- Når du legger til ny join-handler-path: speile `room:join`-guard-mønsteret (`getRoomSnapshot` → `findPlayerInRoomByWallet` → `attachPlayerSocket` → return) FØR du går videre til `engine.joinRoom`
- `detachSocket` beholder player-record bevisst — ALDRI endre det til "full cleanup" uten å forstå armed-state-implikasjoner
- For roomCode-changes som beholder canonical: bruk `resumeRoom`, ikke ny `join`
- Hall-default-rom som upgraded til scheduled-game = samme canonical roomCode → samme membership → re-attach-pathen MÅ aktiveres

**Related:**
- PR #1218 (`fix(spillerklient): room:resume fallback ved PLAYER_ALREADY_IN_ROOM`)
- `fix/reentry-during-draw-2026-05-13` (denne 2026-05-13 — backend-side guard for `joinScheduledGame`)
- `packages/game-client/src/games/game1/Game1Controller.ts:syncScheduledGameMembership` (delta-watcher fallback)
- `apps/backend/src/sockets/game1ScheduledEvents.ts:288-365` (initial-join re-attach-guard)
- `apps/backend/src/sockets/gameEvents/roomEvents.ts:372-397, 771-806` (reference-pattern)
- `apps/backend/src/util/roomHelpers.ts:71-78` (`findPlayerInRoomByWallet`)
- `apps/backend/src/game/BingoEngine.ts:3790-3800` (`attachPlayerSocket`)
- FRAGILITY_LOG F-05 — kobler alle handler-paths til guard-mønsteret

### §7.14 — Delta-watcher race: initial-join + watcher dobbel-fyrer samtidig

**Severity:** P1 (intermittent client-state-corruption)
**Oppdaget:** 2026-05-11 (race-bug under hall-default → scheduled-game-upgrade-test)
**Symptom:** `joinRoom`-call fra `start()` og delta-watcher (effect-hook som reagerer på `scheduledGameId`-endring) fyrte parallelt → server fikk 2 join-requests → state-mismatch.
**Root cause:** Delta-watcher hadde ikke gate på `initialJoinComplete`-flag. Watcher reagerte umiddelbart på første snapshot-update fra plan-runtime selv om initial `start()` allerede var i ferd med å joine.
**Fix:** PR #1216 — `initialJoinComplete: boolean` flag i Game1Controller-state. Settes til `true` etter første vellykket join. Delta-watcher gate `if (!this.initialJoinComplete) return`.
**Prevention:**
- Effect-hooks som reagerer på state-changes MÅ gate bak "har vi fullført initial setup?"-flag
- Pattern: `if (!isReady) return` ved toppen av watcher
- Race-condition-tester: spawn klient + tving delta-update innen 100ms etter start
**Related:**
- PR #1216 (`fix(spillerklient): gate delta-watcher bak initialJoinComplete`)
- `packages/game-client/src/games/game1/Game1Controller.ts:initialJoinComplete`

### §7.15 — Klient sendte `bet:arm` før scheduled-game var spawnet (armed tickets ble foreldreløse)

**Severity:** P0 (kunde-fasilitære, regulatorisk og UX) — pilot-blokker
**Oppdaget:** 2026-05-12 (Tobias pilot-test 11:03-11:05)
**Symptom:** Spiller armet 4 bonger (4 × 5 kr = 160 kr trukket fra saldo) → master klikket Start → spillet kjørte 75 baller med `MyTickets: 0` i HUD. Bongene "forsvant". Server hadde mottatt `bet:arm` (in-memory armed-state), men ingen rad ble opprettet i `app_game1_ticket_purchases`.
**Root cause (todelt):**
1. Backend (`GamePlanEngineBridge.createScheduledGameForPlanRunPosition`) feilet med 23505 hvis stale aktiv rad allerede holdt room_code → bridge degraderte til lazy-binding (room_code=NULL). Klient kunne ikke joine fordi `io.to(NULL)` ikke broadcast-er.
2. Klient sendte `bet:arm` (in-memory armed-state) FØR scheduled-game var spawnet av bridge. Selv etter backend-fix (room_code-binding) kunne armed-tickets bli foreldreløse hvis bridge spawnet ny scheduled-game-rad uten å vite om eksisterende armed-set.
**Fix (todelt):**
- Backend: PR #1253 (Agent A) — `releaseStaleRoomCodeBindings` cancellerer stale rader FØR INSERT.
- Klient (denne fixen, Agent B): Alternativ B per Tobias-direktiv 2026-05-12. Klient venter med kjøp til scheduled-game er spawnet. Disable kjøp-knapper med "Venter på master — kjøp åpner snart"-tekst. BuyPopup auto-open blokkeres. CenterBall idle-mode `waiting-master` (ny mode) viser "Venter på at master starter neste runde" istedenfor "Kjøp bonger for å være med i trekningen".
**Prevention:**
- Klient skal ALDRI sende `bet:arm` før det finnes en joinable scheduled-game (status purchase_open/ready_to_start/running/paused + scheduledGameId !== null)
- Standardflyt: `/api/game1/purchase` med scheduledGameId (DB-persistert via `app_game1_ticket_purchases`) ER autoritær path. `bet:arm` (Redis in-memory) er kun fallback for legacy-rom uten plan-runtime — i pilot-flyt bør den aldri fyre.
- UI-disable er tydelig kommunikasjon til spilleren om at de venter på master, ikke en bug.
**Related:**
- PR #1253 (Agent A — backend room_code-fix)
- Følge-PR (Agent B — klient wait-on-master)
- §7.12 (WaitingForMasterOverlay erstattet av CenterBall idle-text)
- `packages/game-client/src/games/game1/screens/PlayScreen.ts:setWaitingForMasterPurchase`
- `packages/game-client/src/games/game1/components/CenterTopPanel.ts:setPreBuyDisabled`
- `packages/game-client/src/games/game1/components/CenterBall.ts:setIdleMode("waiting-master")`

### §7.18 — Innsats vs Forhåndskjøp dobbel-telling (BUG, PR #1419)

**Severity:** P0 (pilot-UX-bug — spiller ser feil betalt beløp)
**Oppdaget:** 2026-05-14 (Tobias-rapport screenshot 09:51, scheduled-game `330597ef`)
**Symptom:** Frontend (LeftInfoPanel) viser BÅDE `Innsats: 30 kr` OG `Forhåndskjøp: 30 kr` etter at bruker kjøpte 3 bonger PRE-game for 30 kr totalt. Korrekt: kun `Innsats: 30 kr` siden bongene ble kjøpt før runde startet (Tobias-regel: pre-game-kjøp telles som INNSATS for kommende/aktive spill, ikke FORHÅNDSKJØP).

**DB-evidens:** `app_game1_ticket_purchases.purchased_at = 09:49:08.314`, `app_game1_scheduled_games.actual_start_time = 09:49:08.354` (40 ms etter purchase → pre-game-kjøp).

**Root cause:** Pre-game `bet:arm` setter `armedPlayerIds` + `armedPlayerSelections` i `RoomStateManager`. Master starter scheduled-game → `MasterActionService.onScheduledGameSpawned` hook → `Game1ArmedToPurchaseConversionService.convertArmedToPurchases` konverterer armed-state til `app_game1_ticket_purchases`-rader. Deretter kjører `engine.startGame` som genererer `gameTickets` fra purchases. **MEN:** hooken kalte ALDRI `roomState.disarmPlayer(roomCode, playerId)` etter conversion. Lingering armed-state → `buildRoomUpdatePayload` (line 572 i `roomHelpers.ts`) regner BÅDE:

- `playerStakes[player]` = `priceForTickets(gameTickets)` = 30 kr (live i runden)
- `playerPendingStakes[player]` = `priceForSelections(armedPlayerSelections)` = 30 kr (samme kjøp talt igjen)

Generic `BingoEngine.startGame`-flyt (via `gameLifecycleEvents.ts:153`) kaller `disarmAllPlayers(roomCode)` — men Spill 1 scheduled-game-flyt (via `Game1MasterControlService.startGame` + `Game1DrawEngineService.startGame`) kaller IKKE det. Hooken `runArmedToPurchaseConversionForSpawn` i `index.ts:2932-3115` glemte å speile mønsteret.

**Fix (PR #1419):** `runArmedToPurchaseConversionForSpawn()` i `apps/backend/src/index.ts` bygger nå en `userId → playerId`-map under armed-resolve-loopen og kaller `roomState.disarmPlayer(roomCode, playerId)` for hver successful conversion etter at service-en returnerer. Speiler `gameLifecycleEvents.ts:153`-mønsteret for Spill 1 scheduled-game-flyten.

**Prevention:**
- ALDRI lat armed-state ligge igjen etter at den er konvertert til faktiske purchases — disarm må alltid speile commit-en
- Hvis ny scheduled-game-spawn-vei legges til, sørg for at den også speiler `disarmAllPlayers`/`disarmPlayer`-mønsteret
- Tester: `apps/backend/src/util/roomHelpers.armedConversionIsolation.test.ts` dekker 7 scenarioer (pre-game-only, mid-round-additive, multi-color, spectator, idempotens, round-transition)
- `buildRoomUpdatePayload` er stateless og REN — bug ligger i caller-state (`roomState`-mutering), ikke i payload-funksjonen

**Related:**
- `apps/backend/src/index.ts:runArmedToPurchaseConversionForSpawn` (fix-stedet)
- `apps/backend/src/util/roomHelpers.ts:561-598` (playerStakes/playerPendingStakes-beregning)
- `apps/backend/src/game/Game1ArmedToPurchaseConversionService.ts` (conversion-service)
- `apps/backend/src/sockets/gameEvents/gameLifecycleEvents.ts:153` (generic-flyt-mønster vi speiler)
- `apps/backend/src/util/roomState.ts:239` (`disarmPlayer`-API)
- DB-evidens: `app_game1_ticket_purchases.purchased_at` vs `app_game1_scheduled_games.actual_start_time`

### §7.19 — Etter-runde "Forbereder rommet..." henger evig (BUG)

**Severity:** P0 (pilot-UX-bug — spiller blir ikke ført tilbake til lobby)
**Oppdaget:** 2026-05-14 (Tobias-rapport 09:54 runde 330597ef ferdig)
**Symptom:** Etter runde-end vises WinScreen med vinneren ("Du vant 1 700 kr" + Fullt Hus 1 000 kr i screenshot), så "Forbereder rommet..."-spinner. Spinner henger evig — ingen auto-redirect til lobby. Bruker MÅ klikke "Tilbake til lobby" manuelt.
**Root cause:** `Game1EndOfRoundOverlay` lyttet på `markRoomReady()`-signal som triggrer normal dismiss-flyt, men hadde INGEN absolute timeout-fallback. Hvis backend ikke emit-er ny `room:update` etter round-end (master må starte neste runde, eller perpetual-loop spawner ny scheduled-game etter X sekunder), kalles `markRoomReady()` aldri og spinneren henger evig. Den eldre 30s "Venter på master"-tekst-swap (PR #1006) byttet kun tekst — utløste ikke redirect.
**Fix (PR #<this-PR>):** `MAX_PREPARING_ROOM_MS = 15_000` max-timeout i overlay-komponenten. Etter 13s byttes teksten til "Returnerer til lobby..." (preview-fase), etter 15s trigges forced auto-return via `onBackToLobby` (SAMME path som manuell knapp-klikk). Sentry-breadcrumb `endOfRoundOverlay.autoReturnFallback` skrives for observability. Idempotent — cancelles av (a) `markRoomReady` (normal dismiss-path), (b) manuell knapp-klikk, (c) `hide()`. Reconnect-resilient via `elapsedSinceEndedMs > MAX_PREPARING_ROOM_MS`-sjekk.
**Prevention:**
- ALDRI rely on backend-events alene for klient-state-transisjoner — alltid ha timeout-fallback for live-UX
- Tester for BÅDE event-driven og timeout-fallback path
- Sentry-breadcrumb ved fallback så ops ser hvor ofte dette trigges (signaliserer backend-emit-issue eller master-treghet)
**Related:**
- `packages/game-client/src/games/game1/components/Game1EndOfRoundOverlay.ts:MAX_PREPARING_ROOM_MS`
- `packages/game-client/src/games/game1/Game1Controller.ts:showEndOfRoundOverlayForState`
- §7.11 (lobby-init race — relatert klient-side-fallback-mønster)
- §4 (live-rom-robusthet — auto-return er pilot-UX-mandat)
- Tobias-direktiv 2026-05-14

---

### §7.22 — WinScreen viser bare Fullt Hus, mister Rad 1-4-vinster (BUG)

**Severity:** P0 (pilot-UX — spillere ser ikke alle premiene de vant)
**Oppdaget:** 2026-05-14 (Tobias-rapport 13:00, runde 1edd90a1)
**Symptom:** Spiller vant 6 fase-rader totalt (Rad 1 yellow 200kr, Rad 2 purple 300kr + white 100kr, Rad 3 white 100kr, Rad 4 white 100kr, Fullt Hus white 1000kr — DB-verifisert i `app_game1_phase_winners` for `scheduled_game_id LIKE '1edd90a1%' AND winner_user_id='demo-user-admin'`). WinScreen viste KUN "Fullt Hus 1000 kr Du vant" — Rad 1-4 viste feilaktig "Ikke vunnet".
**Root cause:** Scheduled Spill 1 sin `enrichScheduledGame1RoomSnapshot` (`apps/backend/src/game/Game1ScheduledRoomSnapshot.ts:268`) returnerer `patternResults: []` (synthetic snapshot uten engine-state — det er Game1DrawEngineService som driver state-machinen, ikke BingoEngine). Når game-end-snapshot ankommer via `room:update`, `GameBridge.applyGameSnapshot` (linje 856) RESETTER `state.patternResults = game.patternResults || []` til tom liste. Deretter SEEDER `handleRoomUpdate` patternResults fra `gameVariant.patterns` med `isWon: false` for alle 5 faser (linje 629-636). Den siste `pattern:won` (Fullt Hus) ankommer i mellomtiden og overskriver `isWon=true` på Fullt Hus, men Rad 1-4 forblir `isWon: false` i den seedede listen.
**Fix (PR #<this-PR>):**
1. Game1Controller akkumulerer `myRoundWinnings: MyPhaseWinRecord[]` per `pattern:won`-event der spilleren er i `winnerIds` (samme path som `roundAccumulatedWinnings`-summen, så ingen synkroniserings-glipp). Reset ved `gameStarted`.
2. `Game1EndOfRoundOverlay.show()` mottar `summary.myWinnings` (snapshot via spread). Overlay viser KUN faser spilleren har vunnet.
3. Tom liste → "Beklager, ingen gevinst" (ikke 5 "Ikke vunnet"-rader).
4. Multi-color per fase (eks. yellow + purple på Rad 2) vises som separate rader sortert etter `phase` (1 → 5).
5. Backwards-compat: hvis `myWinnings` er `undefined` faller overlay tilbake til legacy `patternResults`-tabell (for eksisterende tester og andre call-sites).
**Prevention:**
- **ALDRI** vis "Ikke vunnet"-default for ikke-vunnede faser i et SUMMARY-skjerm — kun vinnende rader skal vises. Tom liste = "Beklager, ingen gevinst".
- **ALDRI** stol på `state.patternResults` post-game-end for scheduled Spill 1 — snapshot er synthetic og reset av `applyGameSnapshot`. Bruk per-event-tracking (akkumulert i Controller) som single source of truth.
- Multi-color per fase: backend's `pattern:won`-wire har ÉN `payoutAmount` per fase (første color-gruppes per-vinner-andel). Klient kan IKKE rekonstruere alle color-vinninger fra `pattern:won` alene — kun det som ble annonsert i live-pop-ups. For full per-color-breakdown må backend utvide wire-formatet til `phaseWinners[]` (TODO post-pilot).
- **Tester:** `Game1EndOfRoundOverlay.winnerFiltering.test.ts` (22 tester) dekker 5 scenarier: alt vunnet, sparse-win (Rad 1 + Fullt Hus), ingen vinst, multi-vinst per fase, og backwards-compat.
**Related:**
- `packages/game-client/src/games/game1/components/Game1EndOfRoundOverlay.ts` (ny `myWinnings`-path + `buildMyWinningsTable`)
- `packages/game-client/src/games/game1/Game1Controller.ts` (`myRoundWinnings`-tracker)
- `apps/backend/src/game/Game1ScheduledRoomSnapshot.ts:268` (kilden til snapshot-reset-bugen)
- `packages/game-client/src/bridge/GameBridge.ts:856` (`applyGameSnapshot` reset-stedet)
- §7.18 (Innsats vs Forhåndskjøp dobbel-telling — beslektet "skip-stale-data"-pattern)

---

### §7.17 — Hall-switcher må re-fetche game-status (BUG)

**Severity:** P0 (pilot-UX-bug — spiller ser feil hall-status)
**Oppdaget:** 2026-05-14 (Tobias rapporterte at hall-bytte i dropdown ikke endrer game-tile-status)
**Symptom:** Bytte hall i `/web/`-lobby dropdown → ingenting skjer synlig. Game-tiles fortsetter å vise gammel hall sin status. Hvis aktiv runde kjører på master-hall, vises den ikke når bruker bytter til den.
**Root cause:** `switchHall()` i `apps/backend/public/web/lobby.js:199-219` oppdaterte aktiv-hall-id + balance + compliance, men ikke `lobbyState.games`/`lobbyState.spill1Lobby` med ny hall sin game-status. `/api/games/status` er GLOBAL (ignorerer hallId) — kan ikke besvare "hva er status på Bingo for hall X?". For per-hall Spill 1-state kreves separat fetch mot `/api/games/spill1/lobby?hallId=...`.
**Fix (PR #<this-PR>):** Utvidet `switchHall()` til å parallell-refetche:
- `/api/wallet/me` (balance, cache-buster)
- `/api/wallet/me/compliance?hallId=...`
- `/api/games/spill1/lobby?hallId=...` (NY — per-hall lobby-state)
- `/api/games/status` (global — for Spill 2/3 perpetual)

`buildStatusBadge('bingo')` bruker nå per-hall `spill1Lobby.overallStatus` (mapper closed/idle/purchase_open/ready_to_start/running/paused/finished til badges) når tilgjengelig, og faller tilbake til global `gameStatus['bingo']` ved feil. Confirm-modal vises før bytte hvis aktiv Pixi-runde kjører.
**Prevention:**
- ALDRI legg til hall-spesifikk state uten å sørge for at den re-fetches ved hall-switch
- Sjekk listen i `switchHall()` mot ALL hall-spesifikk state i `lobbyState`
- `/api/games/status` er GLOBAL — for per-hall Spill 1-state må klient bruke `/api/games/spill1/lobby?hallId=...`. Spill 2/3 forblir globale (ETT rom for alle haller).
- Tester for hall-switcher i `apps/admin-web/tests/lobbyHallSwitcher.test.ts` dekker initial-load, switch-flow, fail-soft, og badge-mapping.
**Related:**
- `apps/backend/public/web/lobby.js:switchHall`
- `apps/backend/public/web/lobby.js:loadSpill1Lobby`
- `apps/backend/public/web/lobby.js:buildSpill1StatusBadge`
- `apps/backend/src/routes/spill1Lobby.ts` + `Game1LobbyService.Game1LobbyState`
- §3 (hall-arkitektur)
- §7.11 (lobby-init race condition — relatert pattern)

### §7.21 — Bong-pris går til 0 kr ved game-start (BUG)

**Severity:** P0 (pilot-UX — spillere ser feil pris under aktiv runde)
**Oppdaget:** 2026-05-14 (Tobias-rapport 12:55)
**Symptom:** Pre-trekning korrekt pris (5/10/15 kr). Etter engine starter alle bonger vises "0 kr".

**Root cause:** Backend `entryFeeFromTicketConfig` i `Game1ScheduledRoomSnapshot.ts:182-196` leste KUN `priceCentsEach`, men `GamePlanEngineBridge.buildTicketConfigFromCatalog` skriver `pricePerTicket`. Når engine starter (status WAITING → RUNNING) bygger `enrichScheduledGame1RoomSnapshot` synthetic `currentGame` med `entryFee = entryFeeFromTicketConfig(row.ticket_config_json) = 0`. Det propageres via `roomHelpers.currentEntryFee` (linje 420, `??` tar ikke 0) → alle `enrichTicketList`-ticket-priser blir 0 → klient-state.entryFee overskrives til 0 → `gridEntryFee = state.entryFee ?? 10` blir 0 (samme `??`-bug på klient) → alle bonger vises "0 kr".

DB-evidens fra prod 2026-05-14:
```sql
SELECT ticket_config_json->'ticketTypesData' FROM app_game1_scheduled_games WHERE id LIKE '1edd90a1%';
-- [{"size": "small", "color": "white", "pricePerTicket": 500}, ...]
```

Felt-navn-mismatch: `priceCentsEach` (reader) vs `pricePerTicket` (writer). Dette ble lagt inn i `Game1TicketPurchaseService.extractTicketCatalog` (line 1254) som leste alle 4 historiske felter (`priceCents`, `priceCentsEach`, `pricePerTicket`, `price`) — men `entryFeeFromTicketConfig` ble glemt.

**Fix (defense-in-depth, 5 lag):**
1. Backend `entryFeeFromTicketConfig`: les alle 4 historiske felt-navn (matcher `extractTicketCatalog`)
2. Backend `roomHelpers.currentEntryFee` (line 420): `> 0`-sjekk istedenfor `??` (match line 386-388)
3. Klient `GameBridge.applyGameSnapshot` (line 854): overskriv KUN hvis `game.entryFee > 0`
4. Klient `PlayScreen.gridEntryFee`: `> 0`-sjekk istedenfor `??` på `state.entryFee`
5. Klient `TicketGridHtml.computePrice`: bruk `ticket.price > 0`-sjekk istedenfor `typeof === "number"`
6. Klient `BingoTicketHtml.priceEl + populateBack`: skjul price-rad hvis 0 (ALDRI vis "0 kr" på en kjøpt bonge)

**Prevention:**
- ALDRI tillat priceEl å vise "0 kr" på en kjøpt bonge — kjøpt bonge har alltid pris > 0
- Bevar ticket-pris ved kjøp-tidspunkt via server-side `ticket.price` (set i enrichTicketList) — klienten skal IKKE re-derive prisen mid-game
- Defense-in-depth: hvis EN lag har 0-mismatch, må neste lag fange det
- `??` på numeric fields er en fallgruve: 0 er et tall, ikke null/undefined. Bruk alltid `> 0`-sjekk for pris-felt
- Skriv tester med fix-evidens (DB-shape fra prod) for å forhindre regression

**Related:**
- `apps/backend/src/game/Game1ScheduledRoomSnapshot.ts:182-196` (entryFeeFromTicketConfig)
- `apps/backend/src/game/GamePlanEngineBridge.ts:311-588` (buildTicketConfigFromCatalog — writer)
- `apps/backend/src/util/roomHelpers.ts:420` (currentEntryFee)
- `packages/game-client/src/bridge/GameBridge.ts:854` (applyGameSnapshot)
- `packages/game-client/src/games/game1/screens/PlayScreen.ts:619-624` (gridEntryFee)
- `packages/game-client/src/games/game1/components/TicketGridHtml.ts:402-407` (computePrice)
- `packages/game-client/src/games/game1/components/BingoTicketHtml.ts:591,751` (price-rendering)
- §2 (Wallet — pris er regulatorisk-relevant)
- §7.9 (state.ticketTypes overrider lobby — relatert state-pipeline)

---

### §7.20 — Master-UI header må være state-aware, ALDRI hardkodet "Aktiv trekning"

**Severity:** P0 (pilot-UX-bug — master forvirret om spill-state, motsigelse mellom header og knapper)
**Oppdaget:** 2026-05-14 — Tobias-rapport 3 ganger (07:55, 09:51, 12:44)
**Symptom:** Master-konsoll i `/admin/#/agent/cashinout` viste "Aktiv trekning - Bingo" som header selv når engine IKKE var running. Screenshot 12:44 viser:
- Header: "Aktiv trekning - Bingo"
- Master-knapp: "▶ Start neste spill — Bingo" (grønn, klikkbar) → betyr engine IKKE running
- "Ingen pågående spill tilgjengelig..." vises samtidig → motsigelse
- Scheduled-game IKKE startet ennå

**Root cause:** Pre-fix-grenen i `Spill1HallStatusBox.ts:801-816` mappet `purchase_open | ready_to_start | running | paused` som "isActiveDraw" — som er feil. `purchase_open` og `ready_to_start` er PRE-start-tilstander hvor bonge-salg er åpent men engine IKKE kjører trekk ennå. Bare `running` skal trigge "Aktiv trekning"; `paused` skal være "Pauset".

**Fix (PR #<this-PR>):** Ekstrahert pure helper `getMasterHeaderText(state, gameName, info?)` i `Spill1HallStatusBox.ts:1456+` med state-mapping:
- `running` → "Aktiv trekning - {name}" ← ENESTE state hvor "Aktiv trekning" er gyldig
- `paused` → "Pauset: {name}"
- `scheduled | purchase_open | ready_to_start` → "Klar til å starte: {name}"
- `completed | cancelled` → "Runde ferdig: {name}"
- `idle` → "Neste spill: {name}"
- `plan_completed_for_today` → "Spilleplan ferdig for i dag" (+ neste-dag-info hvis tilgjengelig)
- `closed | outside_opening_hours` → "Stengt — åpner HH:MM"

Helper er pure (no DOM, no fetch, ingen state-mutering) — testbar isolert. `KNOWN_MASTER_HEADER_STATES`-Set defensiv-fallback til "idle" ved ukjent input. XSS-trygg via `escapeHtml(gameName)`.

**Prevention:**
- ALDRI hardkode "Aktiv trekning" som default header — det er state-driven
- Helper-function pure + 35 tester for hver state (+ regression-trip-wire som verifiserer at INGEN ikke-running state returnerer streng som starter med "Aktiv trekning")
- Hvis ny state legges til `MasterHeaderState`-enum, MÅ helper-en oppdateres samtidig + test legges til
- Visual-regression tests for hver state (hvis Playwright tilgjengelig — out of scope for denne PR-en)

**Related:**
- `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts:getMasterHeaderText`
- `apps/admin-web/tests/masterHeaderText.test.ts` (41 tester etter 2026-05-15-utvidelse, inkl. regression-trip-wire)
- `packages/shared-types/src/spill1-lobby-state.ts` (Spill1ScheduledGameStatus enum)
- PR #1422 (plan-completed-state — kommer som ny inconsistencyWarning senere)
- §4 (live-rom-robusthet — master-UX er pilot-blokker)
- §7.21 (oppfølger-fix 2026-05-15 — fjerner "Klar til å starte" og "Runde ferdig" helt)
- Tobias-direktiv 2026-05-14 (rapportert 3 ganger — derfor kritisk)

### §7.21a — Master-header må vise "Neste spill: {name}" for ALLE pre-running-states (Tobias 2026-05-15)

**Severity:** P1 (pilot-UX-konsistens — Tobias rapporterte direkte under live-test etter Trinn 3-fixene)
**Oppdaget:** 2026-05-15 (Tobias' pilot-test etter Trinn 3 i Next Game Display refactor)
**Symptom:** To distinkte UI-bugs i master-konsoll:
- **Image 1** (direkte etter `npm run dev:nuke`): Header viste `"Neste spill"` UTEN navn. Skulle vise `"Neste spill: Bingo"` (items[0] i plan).
- **Image 2** (etter master klikket "Marker Klar"): Header viste `"Klar til å starte: Bingo"`. Skulle vise `"Neste spill: Bingo"`.

**Tobias-direktiv (IMMUTABLE):**
> "Uavhengig av hvilken status agentene har skal teksten ALLTID være FØR spillet starter: 'Neste spill: {neste spill på lista}'. Når spillet er i gang: 'Aktiv trekning: {neste spill på lista}'."

**Root cause:** To uavhengige feil som overlappet:
1. **Frontend (mapping):** `getMasterHeaderText` hadde 3 separate cases for pre-running-states (`idle` → "Neste spill", `scheduled|purchase_open|ready_to_start` → "Klar til å starte", `completed|cancelled` → "Runde ferdig"). Tobias' nye spec krever ÉN tekst — "Neste spill: {name}" — for alle pre-running-states.
2. **Backend (data):** `GameLobbyAggregator.buildPlanMeta()` returnerte `null` når `planRun === null` (typisk direkte etter `dev:nuke` før master har trykket Start). Det betydde `data.catalogDisplayName = null` i frontend → header viste generisk "Neste spill" uten navn.

**Fix (PR `fix/master-header-text-and-catalog-name-2026-05-15`):**

**Frontend (`Spill1HallStatusBox.ts`):**
- `getMasterHeaderText`-switch forenklet til 3 grener:
  - `running` → `"Aktiv trekning: {name}"` (KOLON, ikke bindestrek — Tobias-direktiv)
  - `paused` → `"Pauset: {name}"` (midt i runde, beholder egen tekst)
  - ALLE andre (idle/scheduled/purchase_open/ready_to_start/completed/cancelled + default) → `"Neste spill: {name}"`
- Spesialtekster bevart: `plan_completed_for_today`, `closed`, `outside_opening_hours`
- 41 tester totalt (6 nye for Tobias 2026-05-15-spec) + 3 nye regression-trip-wires:
  - Ingen state returnerer "Klar til å starte"
  - Ingen state returnerer "Runde ferdig"
  - Running bruker KOLON (`:`), ikke bindestrek (` - `)

**Backend (`GamePlanRunService` + `GameLobbyAggregator`):**
- Ny public read-only metode `GamePlanRunService.findActivePlanForDay(hall, businessDate)` som speiler kandidat-oppslaget i `getOrCreateForToday` (samme sortering på navn, samme GoH-resolve), men returnerer `GamePlanWithItems | null` UTEN å opprette plan-run. Kaster aldri `NO_MATCHING_PLAN` (det er kun for write-paths).
- `GameLobbyAggregator.getLobbyState` kaller `findActivePlanForDay` når `planRun === null`. Aggregator's `buildPlanMeta` (uendret) peker da til `items[0]` og setter `catalogDisplayName` til items[0].displayName.
- Fail-soft: hvis `findActivePlanForDay` kaster, logges warn + fall-through til `planMeta=null` (samme som pre-fix-adferd — generisk "Neste spill" fallback).

**Prevention:**
- ALDRI vis "Klar til å starte" eller "Runde ferdig" som master-header — Tobias-direktiv 2026-05-15 IMMUTABLE
- Backend MÅ alltid kunne svare på "hva er neste spill?" — selv før master har trykket Start. `findActivePlanForDay`-helperen er en del av denne kontrakten.
- "Aktiv trekning" har KOLON, ikke bindestrek. Pre-fix-formatet `"Aktiv trekning - {name}"` er ugyldig.
- Hvis ny pre-running-state legges til `MasterHeaderState`-enum (eks. `purchase_closed`), MÅ den routes til "Neste spill: {name}"-grenen, ikke en ny tekst-variant.

**Related:**
- §7.20 (forrige iterasjon 2026-05-14 — "Aktiv trekning" ble vist for purchase_open/ready_to_start; denne entry-en supersederer mappingen men beholder regression-tripwire for "Aktiv trekning" kun ved running)
- `apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts:getMasterHeaderText`
- `apps/admin-web/tests/masterHeaderText.test.ts` (41 tester)
- `apps/backend/src/game/GamePlanRunService.ts:findActivePlanForDay` (ny public metode)
- `apps/backend/src/game/GameLobbyAggregator.ts` (fall-through til findActivePlanForDay)
- `apps/backend/src/game/__tests__/GameLobbyAggregator.test.ts` (2 nye tester for planMeta uten planRun)
- `.claude/skills/spill1-master-flow/SKILL.md` "Master-UI header-tekst per state" (oppdatert mapping)
- Tobias-rapport 2026-05-15 live-test (Image 1 + Image 2)

### §7.23 — Premietabell viste kun Hvit-bong-pris (Tobias 2026-05-14)

**Severity:** P0 (pilot-UX-bug — spillere måtte regne i hodet, høy risiko for misforståelse)
**Oppdaget:** 2026-05-14 (Tobias-direktiv: "vi må vise premie for alle ulike bongene. nå vises kun for hvit bong")
**Symptom:** `CenterTopPanel` viste én tekst-pill per pattern, eks "Rad 1 - 100 kr". Spillere som kjøpte Gul (10 kr) eller Lilla (15 kr) bong måtte selv regne ut at premien deres var hhv. 200 kr og 300 kr basert på auto-multiplikator-regelen. Spesielt nye spillere ble forvirret — flere kunderapporter (legacy Unity-klienten viste samme måten).
**Root cause:** `prizeListEl` i `CenterTopPanel.ts` bygde 5 piller med format `${displayName} - ${prize} kr` der `prize` alltid var Hvit-base (`pattern.prize1` for fixed, eller `Math.round((prizePercent / 100) * prizePool)` for percent-modus). Auto-multiplikator-regelen i SPILL_REGLER_OG_PAYOUT.md §3.2 var korrekt implementert i payout-pipeline (PR #1417), men aldri reflektert i UI-en.
**Fix (PR feat/premie-table-redesign-2026-05-14):**

1. Bygd lokal design-side `/web/games/premie-design.html` for CSS-iterasjon FØR prod-implementasjon (Tobias-direktiv: "lokalside hvor vi først designet hele dette elementet")
2. Erstattet `prize-pill`-stack med 5×3 grid (`premie-table`):
   - Rader = patterns (Rad 1-4 + Full Hus)
   - Kolonner = bong-farger (Hvit / Gul / Lilla)
   - Gul = Hvit × 2, Lilla = Hvit × 3 (deterministisk auto-mult i `applyPillState`)
3. Header med swatch-prikker (hvit/gul/lilla-fargekoder) for visuell skille
4. Active/completed/won-flash på rad-nivå (én class-toggle, ikke per celle)
5. `.prize-pill`-klasse beholdt på rad-elementet for backwards-compat med `no-backdrop-filter-regression.test.ts`
6. Ny eksportert `PREMIE_BONG_COLORS`-const dokumenterer multiplikator-regelen i kode

**Prevention:**
- ALDRI vis kun én bong-pris i UI — alle 3 farger må være synlige (Tobias-direktiv 2026-05-14, IMMUTABLE)
- Auto-mult-regelen er sentralisert i `PREMIE_BONG_COLORS`-const. Hvis du endrer den, oppdater også `Game1DrawEngineService.payoutPerColorGroups` (samme regel server-side) ELLER fix-koden ene siden vil betale ut feil
- INGEN `backdrop-filter` på `.premie-row` eller `.premie-cell` (PR #468 PIXI-blink-bug)
- Design-iterasjon ALLTID på lokal HTML/CSS-side først for å unngå tweak-i-spillet-loop (Tobias-direktiv: "ikke trenge å tweake på dette i spillet")
- Tester:
  - `packages/game-client/src/games/game1/__tests__/premieTable.test.ts` — 18 tester (grid-struktur, auto-mult begge modi, active/completed/won-flash, placeholder, minimal-diff)
  - `packages/game-client/src/games/game1/__tests__/no-backdrop-filter-regression.test.ts` — utvidet med `.premie-row` + `.premie-cell` guard
  - `packages/game-client/src/games/game1/components/CenterTopPanel.test.ts` — 40 eksisterende tester oppdatert til ny `.col-hvit`-format

**Related:**
- `packages/game-client/src/games/game1/components/CenterTopPanel.ts`
- `packages/game-client/src/premie-design/premie-design.html` (lokal design-preview)
- `packages/game-client/vite.premie-design.config.ts`
- `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` §3.2 (auto-mult-regel)
- `.claude/skills/spill1-master-flow/SKILL.md` "Premietabell-rendering (3-bong-grid)"
- §1.9 (payout auto-mult-fix PR #1417 — server-side, parallel mønster)

### §7.24 — Premie-celle-størrelse iterasjon (Tobias 2026-05-14)

**Severity:** P2 (UX-polish — pilot-blokker for layout-godkjennelse)
**Oppdaget:** 2026-05-14 (Tobias-direktiv etter PR #1442 første iterasjon: "kan også gjøre dem litt smalere i høyde og bredde så det matcher mer bilde. så det ikke tar så mye plass. vil ikke at høyden så være så mye mer en hva det er på spillet nå pga plass")
**Symptom:** Etter §7.23-redesignet (5×3 grid med solid bong-fargede celler) ble tabellen visuelt høyere enn dagens enkelt-pill-stack. På `g1-center-top` (mockup-mål 860 px bredde × ~115 px høyde) tok 5 rader × 30 px = 150 px — over halvparten av tilgjengelig top-panel-høyde. Spillet trenger plass til mini-grid + player-info + actions samtidig, så enhver vertikal vekst i premietabellen presser ut nabokomponentene.
**Root cause:** Default `padding 6px 10px` + `gap 5px` på `.premie-row` ga ≈ 26 px rad-høyde (font 11px line-height ~16 px + 12 px vertikal padding). Med 5 rader + header + gap = ~155 px. Ingen visuelle størrelser var spesifisert ved første design-godkjennelse, så defaults arvet fra `.prize-pill` ble for romslige da 5 piller skalerte til 5 rader.
**Fix (PR #1442 iterasjon V):**

1. `.premie-table` `gap` 5px → **3px** (tighter rad-stack)
2. `.premie-row` `padding` 6px 10px → **3px 8px**, `border-radius` 12px → **10px**
3. `.premie-row .premie-cell` `padding` 4px 8px → **2px 6px** (cellen er nå smal vertikalt)
4. `.premie-header` `padding` 0 10px → **0 8px** (matche rad-padding)
5. `.premie-row` + `.premie-header` `grid-template-columns` minmax(64px,1fr) → **minmax(56px,1fr)** (mindre venstre-felt-bredde)
6. Resultat: rad-høyde ≈ 16-18 px (font-line-height + 4 px vertikal padding). 5 rader + header + gap ≈ 95 px → matcher dagens enkelt-pill-fotavtrykk
7. Utvidet `premie-design.html` til å vise hele `g1-center-top`-mockupen (LeftInfoPanel + mini-grid + premietabell + action-panel) slik at Tobias kan vurdere designet i kontekst, ikke isolert
8. Endringene speilet 1:1 både i `CenterTopPanel.ts` `ensurePatternWonStyles`-CSS og i `premie-design.html` `<style>`-blokken — sync via kommentar-marker "Tobias-direktiv 2026-05-14 iterasjon V"

**Prevention:**
- Visuell størrelse-spec MÅ bo i SKILL.md "Premietabell-rendering" (§celle-størrelse tabell). Hvis fremtidig agent endrer padding/gap/font-size må skill-tabellen oppdateres samtidig.
- ALDRI øk `.premie-row` padding over `3px 8px` eller `gap` over `3px` uten Tobias-godkjennelse — det regresserer iterasjon V.
- Design-side `premie-design.html` MÅ holdes 1:1 med `ensurePatternWonStyles`-CSS. Kommentar-markører i begge filer (`Tobias-direktiv 2026-05-14 iterasjon V`) gjør at fremtidige agenter ser at de to filene er synkronisert.
- Hvis layout-mockup endres senere (ny bredde-allokering, ny font, etc.) — bygg `premie-design.html` FØRST og få Tobias-godkjennelse FØR du rør prod-CSS-en. Loop-iterasjon i live spill er forbudt (jf. Tobias-direktiv §2.12).
- Tester: ingen nye assertions på piksel-størrelse (vil bli skjør), men 1275 eksisterende game-client-tester (inkl. `premieTable.test.ts` 18 stk + `no-backdrop-filter-regression.test.ts`) ble alle kjørt grønt etter endringen som "klassene + structure-paritet"-sjekk.

**Related:**
- §7.23 (forrige iterasjon — denne entry-en bygger videre på den)
- `packages/game-client/src/games/game1/components/CenterTopPanel.ts` `ensurePatternWonStyles`
- `packages/game-client/src/premie-design/premie-design.html`
- `.claude/skills/spill1-master-flow/SKILL.md` "Premietabell-rendering" §celle-størrelse

---

### §7.23a — Bruk frontend-state-dump FØR du gjetter hvor frontend leser fra

**Severity:** Process (not bug)
**Oppdaget:** 2026-05-14 (PM brukte ~3 bug-runder på å gjette state-kilder)
**Symptom:** Når frontend viste feil verdi (eks. "20 kr istedenfor 10 kr per bong"), gjettet PM på om kilden var:
- `state.ticketTypes` (room-snapshot fra `room:update`)
- `nextGame.ticketPricesCents` (lobby-API)
- `state.entryFee ?? 10` (hardkodet fallback)
- Auto-multiplikator-bug (entryFee × wrong multiplier)

Manuelle browser-console-snippets var fragmenterte og ikke-reproduserbare. Ingen deterministisk måte å sammenligne kilder side-ved-side.

**Fix (PR #<this-PR>):** "Dump State"-knapp i SPILL1 DEBUG-HUD (øverst høyre) som dumper komplett state-tree til fire kanaler samtidig:
1. `window.__SPILL1_STATE_DUMP` — DevTools-inspeksjon
2. `localStorage["spill1.lastStateDump"]` — persist tvers reload
3. Server-POST `/api/_dev/debug/frontend-state-dump` → `/tmp/frontend-state-dumps/dump-<ts>-<id>.json`
4. `console.log("[STATE-DUMP]", ...)` — Live-monitor-agent plukker det opp

Dump-en inneholder `derivedState` med:
- `pricePerColor` (entryFee × priceMultiplier per fargen) — viser EFFEKTIV pris fra room-snapshot
- `pricingSourcesComparison` (room vs lobby vs nextGame) — `consistency: "divergent"` peker rett på feil kilde
- `innsatsVsForhandskjop` (activeStake + pendingStake + classification) — viser om bug er dobbel-telling eller separasjons-feil

**Prevention:**
- ALLTID dump state FØR du gjetter hvor frontend leser fra
- Bruk `derivedState.pricingSourcesComparison.consistency` som første sjekk — `"divergent"` betyr at room-snapshot og lobby-API ikke matcher (bug i ett av dem)
- Test-paritet for samme problem: skriv test i `StateDumpTool.test.ts` som reproducerer scenarioet med mock-state
- ALDRI fjern "Dump State"-knappen fra HUD — det er primær-debug-verktøy

**Implementasjon:**
- `packages/game-client/src/debug/StateDumpTool.ts` — pure read state-collector
- `packages/game-client/src/debug/StateDumpButton.ts` — DOM-knapp
- `apps/backend/src/routes/devFrontendStateDump.ts` — server-side persist + GET-list/single

**Related:**
- `.claude/skills/spill1-master-flow/SKILL.md` §"Frontend-state-dump (debug-tool, 2026-05-14)"
- §7.9 (state.ticketTypes overrider) — samme tema fra ulik vinkel
- §3 (Spill 1-arkitektur, ticket-pris-propagering tre-fase-binding)

### §7.25 — "Neste spill"-display beregnes lokalt i 6 frontend-paths (PRE-Trinn-3-tilstand)

**Severity:** P1 (tilbakevendende bug-klasse — "viser feil neste spill"-rapporter etter hvert §3.x-fix)
**Oppdaget:** 2026-05-14 (Agent A research — `docs/research/NEXT_GAME_DISPLAY_AGENT_A_FRONTEND_2026-05-14.md`)
**Symptom:** Tobias rapporterte 4 ganger ("Neste spill: Bingo" etter dev:nuke, "Plan fullført" etter første runde, etc.) — hver fix-runde (PR #1370, #1422, #1427, #1431) løste én path mens andre fortsatte å vise stale data.

**Root cause:** Frontend har 6 forskjellige UI-paths som hver beregner "neste spill"-tekst fra forskjellige felt-kombinasjoner:

1. `Spill1HallStatusBox.ts:692-693, 1456-1515` — `getMasterHeaderText` med `data.catalogDisplayName ?? null` (fallback til "Neste spill" UTEN navn)
2. `NextGamePanel.ts:700-712` idle-render — HARDKODET "venter på neste runde" UTEN catalogDisplayName
3. `NextGamePanel.ts:591-642` `mapLobbyToLegacyShape` translator — `subGameName = planMeta?.catalogDisplayName ?? ""` (TOM STRENG-FALLBACK)
4. `Spill1AgentStatus.ts:104` — `<h3>Spill 1 — {customGameName ?? subGameName}</h3>` (visuell bug ved tom subGameName)
5. `Spill1AgentControls.ts:120-167` — `Start neste spill — {nextGameName}` (faller til generisk uten navn)
6. `Game1Controller.ts:619+2504` (game-client) — `state?.nextScheduledGame?.catalogDisplayName ?? "Bingo"` (BESTE fallback — eneste path med "Bingo" hardkodet)

Pluss `LobbyFallback.ts:328` som renderer "Neste spill: {name}." for fallback-overlay.

Bølge 3-konsolidering (2026-05-08) løste ID-rom-konflikten (plan-run-id vs scheduled-game-id) men IKKE display-rendering. ID-fundament-audit fokuserte på master-actions; "hvilken catalog-display-name vises hvor" forble distribuert.

**Hvorfor 4 fixes ikke har løst rot-årsaken:**
- PR #1370 — dekket KUN initial-state-rendering, ikke advance-state
- PR #1422 — DB-side auto-advance ved `getOrCreateForToday`, men lobby-API leste fortsatt gamle felter
- PR #1427 — UI-tekst-fix på `Spill1HallStatusBox` header (`getMasterHeaderText`), ikke "neste spill"-tekst
- PR #1431 — Backend lobby-API returnerer `nextScheduledGame` for finished plan-run. Korrekt — men frontend har flere paths som ignorerer feltet

**Pattern:** Hver fix har truffet ÉN path mens de andre 3+ paths fortsetter å drive tilstanden videre.

**Fix-anbefaling (Forslag A i research-doc):** Utvid `Spill1AgentLobbyStateSchema` med pre-computed `nextGameDisplay: { catalogSlug, catalogDisplayName, position, planCompletedForToday, reason }`-felt. ALLE frontend-paths leser fra dette feltet. ALDRI lokal beregning.

```typescript
nextGameDisplay: {
  catalogSlug: string | null,
  catalogDisplayName: string,       // ALDRI null — backend faller alltid til "Bingo"
  position: number | null,           // 1-basert
  planCompletedForToday: boolean,
  reason: "next_in_sequence" | "plan_completed" | "no_plan_run" | "no_plan_for_today" | "closed",
}
```

Estimat: 3 dev-dager (1 backend + 1 frontend + 0.5 game-client + 0.5 slett-deprecated). 9 test-invariants F-I1 til F-I9 dokumentert i research-doc.

**Prevention:**
- ALDRI bygg egen "neste spill"-fallback i ny UI-komponent. Bruk `nextGameDisplay.catalogDisplayName` direkte fra aggregator.
- ALDRI les `planMeta.catalogDisplayName` direkte når en ny komponent legges til — bruk single source.
- Når du fikser display-bug: sjekk ALLE 6 paths listet over i `docs/research/NEXT_GAME_DISPLAY_AGENT_A_FRONTEND_2026-05-14.md` §2.1. Hvis du fikser bare ÉN path er bug-en garantert tilbakevendende.
- Tester må dekke alle 9 invariants F-I1 til F-I9 fra research-doc — særlig F-I3 (planCompletedForToday-state) og F-I9 (game-client BuyPopup-subtitle aldri tom).
- `customGameName ?? subGameName`-mønster i Spill1AgentControls + Spill1AgentStatus er legacy override (admin-direct-edit) som ikke trigges fra plan-flow — beholdes for Game1MasterConsole, men nye komponenter skal IKKE bruke det.

**Related:**
- `docs/research/NEXT_GAME_DISPLAY_AGENT_A_FRONTEND_2026-05-14.md` (full kart + recommendations)
- `docs/architecture/NEXT_GAME_DISPLAY_FUNDAMENT_AUDIT_2026-05-14.md` (PM Trinn 2 konsoliderer her)
- `docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md` (forrige fundament-audit, Bølge 1-6 ID-konsolidering)
- §3.10-§3.13 (alle fire tidligere fix-forsøk — relatert mønster: distribuert beregning kommer alltid tilbake)
- §7.20 (Master-UI header state-aware — relatert komponent men annen scope)
- PR #1370, #1422, #1427, #1431 (4 fix-forsøk uten å løse rot-årsak)

---

### §7.26 — Design-iterasjon på bong-elementer: bruk lokal preview-side, ikke live-stack

**Severity:** P3 (workflow / disiplin)
**Oppdaget:** 2026-05-15 (Tobias-direktiv)
**Symptom:** Bong-design-tweaks (farger, FREE-celle, BINGO-header, paddings)
ble historisk testet ved å starte hele dev-stacken (`npm run dev:nuke`),
logge inn som spiller, kjøpe en bong i en aktiv runde, og se den
rendres via socket-events. Det er minutter med ventetid per iterasjon —
plus støy fra runde-state, marks-events, perspective/3D-composite-layers.

**Pattern (samme som §7.24 for premietabell):** Lag en stand-alone HTML/CSS-
side under `packages/game-client/src/<feature>-design/` med dummy-tall
og statiske scenarier. Bygges via egen `vite.<feature>-design.config.ts`
(samme mal som `vite.premie-design.config.ts`) til
`apps/backend/public/web/games/<feature>-design.html`. Designer kan da
edit + cmd-R uten å starte spillet.

**Bong-design preview (2026-05-15):**
- URL: `http://localhost:4000/web/games/bong-design.html`
- Filer: `packages/game-client/src/bong-design/bong-design.{html,ts}`
- Config: `packages/game-client/vite.bong-design.config.ts`
- Build-script: `npm --prefix packages/game-client run build:bong-design`
- Wired inn i `npm run build` etter `premie-design` (samme `emptyOutDir: false`-mønster)
- Viser 3 bonger (Hvit/Gul/Lilla) × 3 scenarier (fresh / mid-spill / Rad 1 bingo)

**Regel:** Når Tobias godkjenner design-endringer i preview-siden, MÅ
endringer reflekteres 1:1 i prod-komponenten (`BingoTicketHtml.ts` for
bong-design). Hvis preview avviker fra prod uten oppdatering, blir
preview-siden en falsk sannhet. Ved hver iterasjon: oppdater BÅDE
preview-CSS OG prod-komponent (samme PR hvis mulig).

**Anti-mønster:** Bruke `dev-overview.html` eller `visual-harness.html`
for ren design-tweaking. Begge har Pixi-runtime og er tregere å rebuilde.
Stand-alone HTML/CSS er raskere og isolerer designet fra runtime-bugs.
### §7.27a — Pre-runde bong-pris viser AUTO_ROUND_ENTRY_FEE × DEFAULT-variant (BUG, FIXED 2026-05-15)

**Severity:** P0 (pilot-blokker — alle 3 bonger viste samme 20 kr pre-runde)
**Oppdaget:** 2026-05-15 (Tobias live-test: "Small White + Yellow + Purple bonger viser alle '20 kr' pre-runde, etter runde-start blir det riktig 5/10/15 kr")

**Symptom:** Etter spilleren har kjøpt bonger (Small White 5 kr / Small Yellow 10 kr / Small Purple 15 kr — én av hver) FØR master starter runden, viser ALLE 3 bonger pris "20 kr" i pre-runde-grid. Etter master trykker Start endres prisen til riktig (5/10/15 kr). Bug var INTERMITTENT — etter første master-start i samme room-kode beholdt backend `roomConfiguredEntryFeeByRoom` korrekt verdi, så neste runde viste riktige priser. `dev:nuke` eller backend-restart wipe-et state og bug-en kom tilbake.

**Root cause:** Pre-runde har ingen scheduled-game spawnet ennå (master har ikke trykket Start). Derfor er `roomState.roomConfiguredEntryFeeByRoom` tom for rom-koden, og `getRoomConfiguredEntryFee(roomCode)` faller tilbake til env-default `runtimeBingoSettings.autoRoundEntryFee` = `AUTO_ROUND_ENTRY_FEE=20` (per `apps/backend/.env:41`). Parallelt setter `bindVariantConfigForRoom(roomCode, { gameSlug: "bingo" })` (kalt fra `room:create`-handler i `apps/backend/src/sockets/gameEvents/roomEvents.ts:594-600`) DEFAULT_NORSK_BINGO_CONFIG (uten gameManagementId), som har flat `priceMultiplier=1, ticketCount=1` for ALLE small_* (`apps/backend/src/game/variantConfig.ts:514-538`). Server-side `enrichTicketList` (`apps/backend/src/util/roomHelpers.ts:458-509`) regner derfor `t.price = 20 × 1 / 1 = 20` for ALLE bonger uavhengig av farge. Klient-side `computePrice` (`packages/game-client/src/games/game1/components/TicketGridHtml.ts:413-415`) short-circuit-et tidligere på `ticket.price > 0` og returnerte server-prisen rått.

**Hvorfor intermittent:** Etter master trykker "Start neste spill" trigges `onScheduledGameCreated`-hook (`apps/backend/src/index.ts:2794-2886`) som binder `roomConfiguredEntryFeeByRoom = 5` (billigste bong) + variantConfig med korrekte per-farge ticketTypes fra `ticket_config_json`. Disse persisterer in-memory så lenge backend-prosessen lever. Neste runde i samme rom-kode treffer cache → korrekte priser. `dev:nuke` / crash / cold-start wipe-er Map-en → bug treffer FØRSTE runde igjen.

**Fix:** Klient-side `computePrice` i `TicketGridHtml.ts` prioriterer nå `lobbyTicketConfig.ticketTypes` (fra `Game1LobbyService` → catalog-data) OVER server-provided `ticket.price` når lobby kan matche `(color, type)`. Lobby-data er kanonisk pris-kilde fordi den leses direkte fra `app_game_catalog` via plan-runtime-aggregator (`GameLobbyAggregator`). Server's `ticket.price` brukes fortsatt som fallback når lobbyTypes mangler (legacy-klient eller fresh init-vindu pre-lobby-fetch).

Den nye fallback-rekkefølgen:
1. `lobbyTypes.find((color, type))` → bruk `entryFee × multiplier / count` (AUTORITATIV pre-runde)
2. `ticket.price > 0` → bruk direkte (legacy server-pris-path)
3. `state.ticketTypes.find(type)` → bruk `entryFee × multiplier / count`
4. Default → `entryFee × 1 / 1`

**Hvorfor klient-side over backend-side:**
- `lobbyTicketConfig` er allerede tilgjengelig (via `Game1Controller.setBuyPopupTicketConfig` etter `lobbyStateBinding.getBuyPopupTicketConfig()`)
- BuyPopup viser ALLEREDE korrekte priser via samme `entryFee × priceMultiplier`-formel, så dette aligner ticket-grid-prisene med BuyPopup
- DB-rader (`app_game1_ticket_purchases.ticket_spec_json[].priceCentsEach`) var alltid korrekte (500/1000/1500 øre); kun display-laget var feil
- Backend-fix krever endring i `room:create`-flyten for å lazy-binde scheduled-game-config FØR master har klikket Start (større arkitektur-endring; klient-fix er additiv defense-in-depth)
- Wallet/regulatory binding er UPÅVIRKET — kun visning av bong-pris-label

**Tester:**
- `packages/game-client/src/games/game1/components/TicketGridHtml.preRundePris20Bug.test.ts` (5 nye regression-tester):
  - Pre-runde: lobby-types VINNER over stale `ticket.price=20` fra backend default-variant
  - State-transition WAITING → RUNNING: priser forblir stabile (5/10/15) på tvers av fasen
  - Trafikklys-scenario: flat 15 kr per bong, ikke 20
  - Lobby-types mangler: server's `ticket.price` brukes (bakover-kompat)
  - Large-bong pre-runde: lobby gir korrekt per-brett-pris (5×3/3=5 kr per brett)
- Eksisterende `TicketGridHtml.priceZeroBug.test.ts` (6 tester) fortsatt grønne — `ticket.price > 0`-path bevart for legacy-clients uten lobbyTypes
- Alle 36 TicketGridHtml-tester (4 test-filer) passerer

**Prevention:**
- ALDRI stol blindt på server-provided `ticket.price` for display når lobby-data er tilgjengelig. Lobby-data fra `Game1LobbyService` er kanonisk pris-kilde for Spill 1 (leser fra `app_game_catalog` via plan-runtime). Server-side `enrichTicketList` regner pris fra `getRoomConfiguredEntryFee`, som er stale når in-memory state ikke er bound (cold-start, pre-master-start).
- Hvis du legger til ny client-side pris-display: sjekk OM lobbyTicketConfig kan matche ticket → bruk lobby-data; fallback til server-pris er kun for legacy.
- Backend-side defense-in-depth (post-pilot, ikke pilot-blokker): vurder å lazy-binde scheduled-game-config i `room:create`-handler ved å hente `Game1LobbyService.getLobbyState(hallId).nextGame.ticketPricesCents` og kalle `roomState.roomConfiguredEntryFeeByRoom.set(roomCode, smallestKr)` umiddelbart. Da blir server-pris også korrekt pre-runde.

**Related:**
- `packages/game-client/src/games/game1/components/TicketGridHtml.ts:390-486` (computePrice etter fix)
- `packages/game-client/src/games/game1/components/TicketGridHtml.preRundePris20Bug.test.ts` (regression-suite)
- `apps/backend/src/util/roomHelpers.ts:420-429` (currentEntryFee fallback til `runtimeBingoSettings.autoRoundEntryFee`)
- `apps/backend/src/util/roomState.ts:304-307` (getRoomConfiguredEntryFee — fallback til env-default)
- `apps/backend/src/index.ts:2700, 2807-2808` (roomConfiguredEntryFeeByRoom.set call-sites)
- `apps/backend/.env:41` (`AUTO_ROUND_ENTRY_FEE=20`)
- `apps/backend/src/sockets/gameEvents/roomEvents.ts:594-600` (bindVariantConfigForRoom uten gameManagementId)
- `apps/backend/src/game/variantConfig.ts:514-538` (DEFAULT_NORSK_BINGO_CONFIG — flat priceMultiplier=1 for small)
- §7.21 (relatert: Bong-pris går til 0 kr ved game-start — speil-bug under aktiv runde)
- §7.9 (relatert: state.ticketTypes overrider plan-runtime variantConfig — samme prioritets-mønster)

---

### §7.26a — Lobby-broadcast manglet etter natural round-end (BUG, FIXED 2026-05-15)

**Severity:** P0 (pilot-blokker — spiller-shell viste gammelt spill i opptil 2 minutter)
**Oppdaget:** 2026-05-15 (Tobias live-test: "Jeg kjørte runde med første spill (Bingo). Etter at runden var fullført viser fortsatt 'Neste spill: Bingo' i ca 2 min FØR det endret seg til '1000-spill'. Spiller skal ALDRI se gammelt spill.")

**Symptom:** Etter at en bingo-runde naturlig avsluttes (Fullt Hus vunnet eller maxDraws nådd) viser spiller-shellen fortsatt "Neste spill: <forrige>" i opptil ~2 min før den oppdaterer seg til riktig neste spill i plan-sekvensen.

**Root cause:** Backend hadde TRE state-flipp-paths som setter `scheduled-game.status='completed'` eller `plan-run.status='finished'`, men INGEN av dem trigget lobby-broadcast til spiller-shellen:

1. `Game1DrawEngineService.drawNext()` POST-commit when `isFinished=true` (engine setter scheduled-game til completed) → BROADCASTET IKKE
2. `GamePlanRunService.finish()` / `changeStatus(target='finished')` → BROADCASTET IKKE
3. `GamePlanRunService.advanceToNext()` past-end → BROADCASTET IKKE
4. `GamePlanRunCleanupService.reconcileNaturalEndStuckRuns()` → BROADCASTET IKKE

Broadcast var KUN wired i `MasterActionService.fireLobbyBroadcast()` (master-actions: start/pause/resume/stop/advance via UI-knapp). Når en runde naturlig sluttet uten at master gjorde noe, hadde klienten ingen socket-push-path og måtte vente på 10s-polling-tick (`LobbyFallback.ts:255` + `LobbyStateBinding.ts:96`) før det stale "Neste spill: <forrige>"-displayet oppdaterte seg.

**Fix:** Lobby-broadcaster injisert i alle fire pather som best-effort fire-and-forget:

1. `Game1DrawEngineService` fikk valgfri `lobbyBroadcaster`-option + `fireLobbyBroadcastForNaturalEnd()` POST-commit som fan-out til ALLE haller fra `master_hall_id` + `participating_halls_json`. Helper `collectHallIdsForBroadcast` (eksportert for test) dedup-er og parser JSON-string.
2. `GamePlanRunService` fikk valgfri `lobbyBroadcaster`-option + `fireLobbyBroadcastForFinish()` kalt i `changeStatus()` når target='finished' OG i `advanceToNext()` når past-end.
3. `GamePlanRunCleanupService.reconcileNaturalEndStuckRuns` itererer over `closedRuns` og fyrer broadcast per affected hall.
4. Frontend poll-interval redusert fra 10s → 3s i `LobbyFallback.ts` og `LobbyStateBinding.ts` (safety-net, ikke primær-pathen).
5. Frontend fikk "Forbereder neste spill"-loader (`CenterBall.setIdleMode('loading')`) som vises i transition-vinduet mellom natural round-end og server-spawn av neste plan-item. Timeout 10s før fall tilbake til siste kjente "Neste spill"-tekst.

**Fix-soft kontrakt:** Broadcaster-feil ruller IKKE tilbake state-mutering. Alle broadcast-call-sites bruker `try/void Promise.catch` så draw-pathen og plan-state aldri påvirkes av Socket.IO-feil. Klient faller fortsatt tilbake på 3s-poll hvis push feiler stille.

**Tester:**
- `apps/backend/src/game/__tests__/Game1DrawEngineService.lobbyBroadcastOnNaturalEnd.test.ts` (11 tester)
- `apps/backend/src/game/__tests__/GamePlanRunService.lobbyBroadcastOnFinish.test.ts` (7 tester)
- `packages/game-client/src/games/game1/screens/PlayScreen.loadingTransition.test.ts` (19 tester)

**Prevention:**
- ALLE state-overganger som flipper en runde/plan til terminal status MÅ trigge `lobbyBroadcaster.broadcastForHall(hallId)`. Hvis du legger til en ny path (eks. ny cron-job, ny admin-action) som setter `status='completed'`/`'finished'`/`'cancelled'`, MÅ du wire broadcaster samme sted.
- Best-effort kontrakt: aldri kast fra broadcast. Wrap med `try` + `void Promise.catch` så caller-flyten påvirkes ikke ved Socket.IO-feil.
- Klient-poll er KUN safety-net. Hvis Tobias rapporterer "stale state i N sek" skal første-spørsmål være "broadcaster wired for denne pathen?", ikke "kan vi redusere poll-interval mer?".
- Når du lager nye state-transitions, sjekk om de skal trigge broadcast. Se `MasterActionService.fireLobbyBroadcast()` for pattern.

**Related:**
- `apps/backend/src/game/Spill1LobbyBroadcaster.ts` — broadcaster-service (R1 / BIN-822)
- `apps/backend/src/game/MasterActionService.ts:2011` — opprinnelig fire-and-forget pattern
- `apps/backend/src/game/Game1DrawEngineService.ts:1843-1885` (POST-commit `if (capturedCleanupInfo)`-block)
- `apps/backend/src/game/GamePlanRunService.ts:1290-1294, 911-919`
- `apps/backend/src/game/GamePlanRunCleanupService.ts:445-466`
- `packages/game-client/src/games/game1/screens/PlayScreen.ts:540-580` (loader-state-maskin)
- §7.25 (relatert: distribuerte "neste spill"-display-paths)
- ADR-0017 (relatert: jackpot setup-manuell, samme master-action-pattern)

### §7.27b — PauseOverlay vist feilaktig etter natural round-end (BUG, FIXED 2026-05-15)

**Severity:** P0 (pilot-blokker — spiller-shell viste "Spillet er pauset / Venter på hall-operatør" etter at runden naturlig sluttet)
**Oppdaget:** 2026-05-15 (Tobias-direktiv IMMUTABLE — post-round-flyt §5.8 i `SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md`)

**Symptom:** Etter natural round-end (Fullt Hus vunnet eller alle 75 baller trukket) viste spiller-shellen "Spillet er pauset / Venter på hall-operatør"-overlay (semi-transparent svart fullskjerm med gule pause-ikoner). Spilleren måtte refreshe nettleseren for å komme tilbake til lobby.

**Forventet flyt (§5.8):** Engine setter `gameStatus=ENDED` → WinScreen-popup vises 3-5 sek → spilleren føres tilbake til lobby → BuyPopup auto-åpnes med neste planlagte spill. PauseOverlay skal ALDRI vises etter natural round-end.

**Root cause:** Sammensatt av to lag:

1. **Backend:** `Game1DrawEngineService.commitDraw()` (linje ~1500) bruker `CASE WHEN $6::boolean THEN true ELSE paused END` for å sette `paused=true` ved auto-pause etter phase-won. Når Fullt Hus vinnes (`bingoWon=true`), settes `status='completed'` på scheduled-game-raden, men `paused`-flagget i `app_game1_game_state` resettes IKKE i samme UPDATE. Det blir bare resettet av eksplisitt master-resume (linje 2126: `SET paused = false`).

2. **Klient:** `Game1Controller.onStateChanged` (pre-fix linje ~1848) hadde gate-condition `if (state.isPaused && !pauseOverlay?.isShowing())` UTEN å sjekke `gameStatus`. Snapshot-builderen `Game1ScheduledRoomSnapshot.ts:298` speiler `paused`-flagget direkte til `isPaused`, så klient kunne se `gameStatus="ENDED" && isPaused=true` samtidig — overlay trigget feilaktig.

Konkret scenario: Rad 4 vinnes → engine setter `paused=true` (auto-pause). Master klikker "Fortsett" → `paused=false`. Fullt Hus vinnes → `status='completed'` settes. Hvis Rad 4 ble vunnet på samme draw som Fullt Hus (eller hvis master ikke rakk å resume før noen vant Fullt Hus i et race-window), kan `paused=true` overleve inn i ENDED-state.

**Fix (klient-side gate, denne PR):**

```typescript
// Game1Controller.onStateChanged ca. linje 1848
const shouldShowPauseOverlay =
  state.isPaused && state.gameStatus === "RUNNING";

if (shouldShowPauseOverlay && !this.pauseOverlay?.isShowing()) {
  this.pauseOverlay?.show({ ... });
} else if (shouldShowPauseOverlay && this.pauseOverlay?.isShowing()) {
  this.pauseOverlay.updateContent({ ... });
} else if (!shouldShowPauseOverlay && this.pauseOverlay?.isShowing()) {
  this.pauseOverlay?.hide();
}
```

PauseOverlay reflekterer KUN aktiv pause midt i en runde (`gameStatus === "RUNNING"`). For ENDED/WAITING/NONE er pause-state ikke semantisk meningsfullt — runden er enten ikke startet eller allerede avsluttet.

**Tester:** `packages/game-client/src/games/game1/Game1Controller.pauseOverlayGating.test.ts` (11 pure-funksjons-tester):

- Natural round-end scenarios: `gameStatus=ENDED && isPaused=true` → noop; transition fra RUNNING+paused → ENDED+paused trigger hide.
- Master-explicit-pause scenarios: `gameStatus=RUNNING && isPaused=true` → show; resume trigger hide.
- Edge cases: WAITING+paused → noop; NONE → noop; transition til NONE/WAITING med visible overlay → hide.
- Idempotency: repeated update() med samme state → noop.
- §5.8 full post-round flow integration shape: RUNNING+paused → ENDED+paused → WAITING+no-paused → RUNNING (ny runde).

**Prevention:**

- **PauseOverlay-gate er kontrakten med spillerne.** Hvis du legger til ny overlay-trigger i `Game1Controller.onStateChanged`, sørg for at den respekterer fase-state. PauseOverlay = mid-round only.
- **Ikke gjenbruk PauseOverlay som lobby-banner** (eks. "alle runder for dagen er ferdig"). Bygg egen UI-flate for lobby-status; ikke gjenbruk mid-round-pause-overlay.
- **Defense-in-depth selv om backend ryddes:** En fremtidig PR kan oppdatere `Game1DrawEngineService.commitDraw` til å resette `paused=false` når `isFinished=true`. Det er IKKE pilot-blokker fordi klient-gate-en allerede gjør oppførselen korrekt, og klient-gate-en MÅ beholdes uansett som defense-in-depth mot regresjon.
- **Anti-mønster:** "Klient sjekker bare isPaused; backend må fikse paused-flagget." → Feil. Klient-gate beskytter mot ALLE bakgrunns-scenarier (stale snapshot, raceconditions, fremtidige engine-stier). Hold gate-en på begge sider.

**Related:**
- `packages/game-client/src/games/game1/Game1Controller.ts:1848` (klient-side gate)
- `packages/game-client/src/games/game1/Game1Controller.pauseOverlayGating.test.ts` (11 tester)
- `packages/game-client/src/games/game1/components/PauseOverlay.ts` (overlay-komponent — IKKE endret)
- `apps/backend/src/game/Game1DrawEngineService.ts:1500-1502` (backend paused-flagg-UPDATE — kjent oppfølger-rydding)
- `apps/backend/src/game/Game1ScheduledRoomSnapshot.ts:298` (snapshot speiler paused → isPaused)
- `apps/backend/src/game/BingoEnginePatternEval.ts:642` (auto-pause-trigger for Spill 1)
- `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` §5.8 (kanonisk spec)
- `.claude/skills/spill1-master-flow/SKILL.md` v1.18.0 (skill-seksjon "Post-round-flyt invariant")

### §7.28a — Post-round-overlay dismisset med fast timer → stale "Neste spill" i 40 sek (BUG, FIXED 2026-05-15)

**Severity:** P0 (pilot-blokker — spilleren så lobby med stale slug i opptil 40 sek etter natural round-end, før backend rakk å advancere plan-runtime)
**Oppdaget:** 2026-05-15 (Tobias-rapport): *"Nå viste man spillet som nettopp var spilt i ca 40 sekunder før det endret til riktig spill."*

**Symptom:** Etter natural round-end (Fullt Hus eller alle 75 baller trukket), dismisset `Game1EndOfRoundOverlay` typisk etter 3 sekunder (legacy `MIN_DISPLAY_MS=3_000` + første `markRoomReady` som firer på første state-update). Men `nextScheduledGame.catalogSlug` i lobby-state pekte fortsatt på runden vi nettopp spilte fordi backend ikke hadde advancert plan-runtime ennå (advance kunne ta opp til 40 sekunder ved plan-runtime-hiccups). Spilleren så lobby med stale "Neste spill: <samme som nettopp>"-tekst i hele dette vinduet.

**Root cause:** `Game1EndOfRoundOverlay` brukte timer-driven dismiss:

```typescript
// Pre-fix-flyt:
// 1. show() schedules phaseTimer = setTimeout(MIN_DISPLAY_MS = 3000)
// 2. Game1Controller.onStateChanged fyrer markRoomReady() ved første state-update (~50ms)
// 3. Når BÅDE har skjedd → tryDismiss() → fade out + onOverlayCompleted
// 4. Total: ~3 sekunder
```

Klienten kunne IKKE vite om backend var ferdig med plan-advance — bare at "noen tid har passert siden round-end" (3s). Timer-driven løsning var basert på gjetning, ikke faktisk data.

**Hvorfor faste timere ikke fungerer:** Backend-advance varierer mellom 50ms og 40s+ avhengig av:
- Plan-runtime-helse (har `GamePlanRunService.start()` overhead?)
- Master-hall-state (er master-hall klar med ny posisjon?)
- Bridge-retry (har bridge måttet retry scheduled-game-spawn?)
- DB-latens i prod (Render-spike?)

Ingen fast timer fungerer for alle scenarier. 3s er for kort (mange tilfeller); 60s er for lenge (irriterende ved rask happy path).

**Fix (C-hybrid data-driven dismiss):** Overlay venter på faktisk signal fra lobby-state:

```typescript
// Ny flyt:
// 1. show(summary) med summary.justPlayedSlug = "bingo"
//    → aktiverer data-driven modus
//    → schedule safety-cap-timer (MAX_WAIT_MS=60s)
//    → schedule poll-timer (DATA_READINESS_POLL_MS=500ms)
// 2. Game1Controller.lobbyStateBinding.onChange fyrer på hver lobby-state-tick
//    → overlay.updateLobbyState(newSlug)
//    → overlay.tryDismissIfReady() sjekker:
//       (a) elapsed >= MIN_CELEBRATION_MS (10s)
//       (b) currentNextSlug !== justPlayedSlug (begge non-null)
//    → dismiss når begge møtt
// 3. Hvis 60s passerer uten ny slug → safety-cap-fire → Sentry-breadcrumb + forced dismiss
```

`Game1EndOfRoundOverlay`-API:

```typescript
// summary.justPlayedSlug eller setJustPlayedSlug aktiverer modus:
overlay.show({ ...summary, justPlayedSlug: "bingo" });
// eller etter mount:
overlay.setJustPlayedSlug("bingo");

// Game1Controller pusher ved hver lobby-state-tick:
overlay.updateLobbyState(state?.nextScheduledGame?.catalogSlug ?? null);
```

**Konstanter:**
- `MIN_CELEBRATION_MS = 10_000` — Tobias-direktiv 2026-05-15: opprinnelig "minimum 6 sek celebrasjon", oppdatert samme dag til "nei, kjør minimum 10 sekunder"
- `MAX_WAIT_MS = 60_000` — safety-cap, signalerer backend-anomali
- `DATA_READINESS_POLL_MS = 500` — sekundær defense (primær er event-driven via updateLobbyState)

**Backward-compat:** Hvis `justPlayedSlug === null` (legacy call-sites uten lobby-state-tilgang, eller eksisterende test-fixtures), forblir legacy `markRoomReady + MIN_DISPLAY_MS=3s`-pathen aktiv. Dette holder 56 eksisterende `Game1EndOfRoundOverlay.test.ts`-tester grønne og gir partial-rollback-vei.

**Tester:** 78 eksisterende tester pass (`Game1EndOfRoundOverlay`, `Game1Controller.endOfRoundFlow`, `Game1Controller.pauseOverlayGating`). Per Tobias-direktiv 2026-05-15: ingen nye tester nå — eksisterende suite verifiserer at backward-compat ikke brutt.

**Prevention / anti-mønstre:**

- ❌ **ALDRI dismiss UI-overlay basert på fast timer når dismiss avhenger av backend-data.** Det er nettopp dette som ga 40s-bugen. Bruk data-driven (poll + event-listening) med floor-tid + safety-cap.
- ❌ **ALDRI senk `MIN_CELEBRATION_MS` under 10s** uten Tobias-godkjennelse. Tobias bumpet opprinnelig 6s → 10s samme dag (2026-05-15) etter pilot-testing.
- ❌ **ALDRI senk `MAX_WAIT_MS` under 60s.** 40s-rapporten viste at backend KAN bruke så lang tid. Hardere cap risikerer å klippe spillere som ville fått korrekt overgang.
- ❌ **ALDRI fjern legacy markRoomReady-modus** ennå — eksisterende tester avhenger av den, og den er partial-rollback-vei hvis data-driven feiler.
- ✅ **Sentry-monitor `endOfRoundOverlay.safetyCapDismiss`** for å fange repeterte cap-fires (signal om plan-runtime-hiccups i backend).

**Related:**
- `packages/game-client/src/games/game1/components/Game1EndOfRoundOverlay.ts` (overlay-impl med data-driven modus, `MIN_CELEBRATION_MS`, `MAX_WAIT_MS`, `setJustPlayedSlug`, `updateLobbyState`)
- `packages/game-client/src/games/game1/Game1Controller.ts:2095-2110` (setter `summary.justPlayedSlug` ved show)
- `packages/game-client/src/games/game1/Game1Controller.ts:630-636` (forward av slug via `updateLobbyState`)
- `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` §5.8 (kanonisk post-round-flyt-spec)
- `.claude/skills/spill1-master-flow/SKILL.md` v1.19.0 (skill-seksjon "Post-round-overlay data-driven dismiss")
### §7.28b — CenterTopPanel mockup `premie-design.html` er kanonisk — IKKE prod-CSS

**Severity:** P1 (design-iterasjons-disiplin)
**Oppdaget:** 2026-05-15 (sesjon: center-top design prod-implementasjon)
**Symptom:** Pre-fix var pixel-spec spredt mellom mockup-en `packages/game-client/src/premie-design/premie-design.html` og prod-komponent `CenterTopPanel.ts`. Combo-panel-bredde var 376 px i prod men 496 px i mockup (Tobias-iterasjon V), padding var 26 px i prod men 22 px i mockup, gap var 20 px i prod men 18 px i mockup, og action-panel manglet `marginLeft: auto` (Tobias-fix for å pushe panelet til høyre kant). Spillere fikk feil layout der premie-tabellens Lilla-kolonne klemte action-panel.

**Rotårsak:** Tobias itererer designet live på mockup-siden `/web/games/premie-design.html` for å unngå deploy-loop. Mockup er **kanonisk** — prod-CSS skal alltid være en speiling av mockup-en. Når prod-CSS-en blir stale relativt til mockup, ser spillerne en eldre design enn det Tobias har godkjent.

**Eksempel:** Tobias-direktiv 2026-05-14 (iterasjon V):
> "Smalere premie-celler — tabellen skal ikke ta merkbart mer plass vertikalt enn dagens enkelt-pill-design"
> "Vise HELE center-top samlet (ikke bare premietabellen) — mini-grid + premietabell + player-info + action-knapper side-om-side"
> "Combo-panel-bredde 376 → 496 px (etter screenshot — 376 px var for trang, premie-tabellens Lilla-kolonne klemte action-panel)"

**Fix:** Anvend mockup-spec 1:1 til `CenterTopPanel.ts`:
- `combo` width 376 → **496 px**
- `combo` padding `15px 26px` → **`15px 22px`**
- `combo` `flexShrink: 0` (ny)
- `comboBody` gap `20px` → **`18px`**
- `actions` padding `14px 25px 5px 25px` → **`14px 22px 8px 22px`**
- `actions` `marginLeft: auto` (ny — pusher til høyre kant)

**Prevention:**

1. **Mockup er sannheten** — hvis du finner avvik mellom `premie-design.html` og `CenterTopPanel.ts`, prod-CSS-en er stale. Speil mockup, ikke omvendt.
2. **Tobias itererer på mockup, ikke på prod-CSS** — han kjører `/web/games/premie-design.html` lokalt og endrer pixel-spec der. Vi anvender til prod i egen PR.
3. **Skill `.claude/skills/spill1-center-top-design/SKILL.md`** — har komplett pixel-spec-tabell for iterasjon V. Sjekk skill FØR du gjør CSS-endringer på CenterTopPanel.
4. **Test-strategi:** Eksisterende tester (`CenterTopPanel.test.ts`, `no-backdrop-filter-regression.test.ts`) sjekker IKKE eksakte CSS-verdier (px-widths/paddings). Det er bevisst slik at design-iterasjon ikke krever test-update — men du må derfor sjekke mockup manuelt etter endringer.
5. **Tre forbudte feil:**
   - Sett `backdrop-filter: blur(...)` på `.premie-row` / action-button → trigger Pixi-blink-bug (`no-backdrop-filter-regression.test.ts` fanger det)
   - Endre uten å oppdatere prod og mockup samtidig → fremtidige iterasjoner finner inkonsistent baseline
   - Anta Spill 3 påvirkes — Spill 3 bruker `customPatternListView`-injection og bryr seg ikke om combo/actions-layout

**Spill 3-kontrakt:** `CenterTopPanel.customPatternListView` brukes av Spill 3 (`Game3PatternRow`) til å erstatte gridHostEl + prizeListEl. Endringer i combo-layout (width, padding, gap) påvirker IKKE Spill 3 fordi `customPatternListView.root` mountes direkte i `comboBody` istedet. Verifiser med `npm test -- --run game3` (27 tester).

**Runtime-API uendret:** Mockup-iterasjon krever IKKE endringer i offentlige API (`setBuyMoreDisabled`, `setPreBuyDisabled`, `updatePatterns`, `updateJackpot`, `setGameRunning`, `setCanStartNow`, `setBadge`, `showButtonFeedback`, `destroy`). Hvis du må endre disse, koordiner PlayScreen.ts-update i samme PR.

**Related:**
- `packages/game-client/src/premie-design/premie-design.html` (mockup-iterasjon V, IMMUTABLE)
- `packages/game-client/src/games/game1/components/CenterTopPanel.ts` (prod-komponent, ~980 linjer)
- `packages/game-client/src/games/game1/components/CenterTopPanel.test.ts` (40 tester)
- `packages/game-client/src/games/game1/__tests__/no-backdrop-filter-regression.test.ts` (6 tester — Pixi-blink-guard)
- `packages/game-client/src/games/game3/components/Game3PatternRow.ts` (customPatternListView consumer)
- `.claude/skills/spill1-center-top-design/SKILL.md` (pixel-spec + anti-patterns + Spill 3-kontrakt)
- §7.24 (relatert: premie-celle-størrelse iterasjon I-IV 2026-05-14)
### §7.28c — Game1BuyPopup: card.children-indices + subtitle letter-spacing-marker er IMMUTABLE test-kontrakt

**Severity:** P1 (test-regresjon)
**Oppdaget:** 2026-05-15 (kjopsmodal-design.html prod-implementasjon)
**Symptom:** Etter restrukturering av `Game1BuyPopup.ts` for å matche `kjopsmodal-design.html` mockup feilet 8 av 32 tester:
- `Game1BuyPopup.lossState.test.ts` (3 tester) — `getCancelBtn`/`getStatusMsg` returnerte feil element
- `Game1BuyPopup.displayName.test.ts` (5 tester) — `getSubtitleText()` fant "Premietabell" istedenfor catalog-display-navn

**Root cause (2 separate problemer):**

1. **`card.children`-indices er hardkodet i 4 test-filer** (`Game1BuyPopup.test.ts`, `lossState`, `displayName`, `ticketCount`):
   - `card.children[1]` = typesContainer
   - `card.children[3]` = statusMsg
   - `card.children[5]` = buyBtn
   - `card.children[6]` = cancelBtn

   Hvis du legger til ny top-level child (eks. prizeMatrixEl) UTEN å hoist totalRow inn i et eksisterende element, blir indices forskjøvet og alle tests feiler.

2. **Subtitle uniqueness-marker er letter-spacing 0.14em på `<div>`-element**. `getSubtitleText()` i `displayName.test.ts` søker `overlay.querySelectorAll("div")` etter første div med `letterSpacing === "0.14em"`. Hvis ANNET element i komponenten har samme letter-spacing (eks. premietabell "PREMIETABELL"-label), returnerer testen feil element.

**Fix:**

1. **Hoist totalRow inn i `sep`-elementet** (gjør sep til wrapper) for å holde `card.children`-tellet på 7 (header, typesContainer, prizeMatrixEl, statusMsg, sep-wrapper, buyBtn, cancelBtn). Indices [1], [3], [5], [6] forblir korrekte.
2. **Endre PrizeMatrix-header letter-spacing** fra 0.14em → 0.12em. Subtitle er ENESTE element med 0.14em.
3. **Subtitle MÅ være `<div>`**, ikke `<span>` — testen søker kun `<div>`.

**Prevention:**

- ALDRI legg til nytt top-level `card.children`-element uten å oppdatere alle 4 test-helper-funksjoner samtidig
- ALDRI bruk letter-spacing 0.14em på andre elementer enn subtitle
- ALDRI endre subtitle-elementet fra `<div>` til `<span>`
- Hvis du må re-strukturere card-layout: oppdater test-helper-funksjoner i SAMME PR

**Files:**
- `packages/game-client/src/games/game1/components/Game1BuyPopup.ts` (linjer ~270-450: header + DOM-bygging)
- `packages/game-client/src/games/game1/components/Game1BuyPopup.test.ts` (test-helper-funksjoner)
- `packages/game-client/src/games/game1/components/Game1BuyPopup.lossState.test.ts` (`getCard().children[3,5,6]`)
- `packages/game-client/src/games/game1/components/Game1BuyPopup.displayName.test.ts` (`getSubtitleText()` søker letter-spacing 0.14em)
- `packages/game-client/src/games/game1/components/Game1BuyPopup.ticketCount.test.ts`

**Related:** kjopsmodal-design.html mockup (Tobias 2026-05-15), skill `buy-popup-design`

---

### §7.29a — Debug-HUD + event-log skjult som default — kun `?debug=full` aktiverer (Tobias 2026-05-15)

**Severity:** P1 (UX-fix — debug-felter lekte til prod-spillere)
**Oppdaget:** 2026-05-15 (Tobias screenshot — SPILL1 DEBUG-HUD + EVENT-LOG synlig)
**Symptom:** Spillerklient viste fast `🐛 SPILL1 DEBUG-HUD` (top-right) og
`📋 EVENT-LOG` (top-left) selv uten eksplisitt opt-in. Det brøt "full
spillopplevelse" og distraherte fra spillet.
**Root cause:** `isDebugHudEnabled()` (Game1Controller.ts:1136) godtok både
`?debug=1`, `?debug=true` OG `localStorage.DEBUG_SPILL1_DRAWS=true`.
LocalStorage-flagg overlever sesjoner — QA-testere som satte flagget på
delte test-maskiner forplantet det til alle senere brukere.

**Fix:** Stram gating til **kun `?debug=full`** via URL. LocalStorage-flagg
fjernet som trigger. Auto-cleanup av legacy `DEBUG_SPILL1_DRAWS`-flagg ved
hver `Game1Controller.start()`.

**Why URL-only:**
1. Eksplisitt — `?debug=full` er for spesifikt til at uvitende brukere
   skriver det
2. URL-bound — forsvinner ved neste page-load (i motsetning til
   localStorage som overlever)
3. Stringent — `?debug=1` (kort form) vil IKKE aktivere (default-spillere
   er trygge)

**Prevention:**
- ALDRI legg til localStorage-trigger for HUD — bryter "default off"
- Hold gate URL-bound (sesjons-flyktig)
- ALDRI gjør HUD on-by-default i dev (samme spillopplevelse i alle modus)
- ConsoleBridge/FetchInstrument/ErrorHandler/FetchBridge har defense-in-
  depth-gates som også sjekker `?debug=full`

**EventTracker (singleton) er fortsatt alltid aktiv** — den emitter
breadcrumbs til Sentry uavhengig av om HUD er mounted. Kun den visuelle
overlay-en og instrumentation-modulene gates.

**Filer:**
- `packages/game-client/src/games/game1/Game1Controller.ts` (`isDebugHudEnabled`, `cleanupLegacyDebugFlag`)
- `packages/game-client/src/games/game1/debug/DebugEventLogPanel.ts` (header-doc)
- `packages/game-client/src/games/game1/debug/ConsoleBridge.ts` (gate)
- `packages/game-client/src/games/game1/debug/FetchInstrument.ts` (gate)
- `packages/game-client/src/games/game1/debug/FetchBridge.ts` (gate)
- `packages/game-client/src/games/game1/debug/ErrorHandler.ts` (gate)

**Tester oppdatert:**
- `debug/__tests__/ErrorHandler.test.ts` (URL byttet til `?debug=full`)
- `debug/__tests__/FetchInstrument.test.ts` (URL byttet til `?debug=full`)

**Related:** skill `debug-hud-gating`, Tobias-direktiv 2026-05-15 ("fjern
alle de debug feltnee ... full spillopplevelse")

### §7.30 — Test-locked DOM-indices ≠ visuell layout — bruk CSS `order:` på flex-container (Game1BuyPopup pixel-iter2)

**Severity:** P1 (design-fidelity, fixed 2026-05-15 iter2)
**Oppdaget:** 2026-05-15 (Tobias rapporterte PR #1502 ikke matchet mockup pixel-perfect)
**Symptom:** Game1BuyPopup hadde premietabell som `card.children[2]` (etter `typesContainer` ved index 1). Mockup viser premietabell ØVERST (mellom header og ticket-rows). Men fire test-filer (`Game1BuyPopup.test.ts`, `.lossState.test.ts`, `.displayName.test.ts`, `.ticketCount.test.ts`) er lockt på `card.children[1] = typesContainer`, `[2] = prizeMatrixEl`, `[3] = statusMsg`, `[5] = buyBtn`, `[6] = cancelBtn`. Å bytte DOM-rekkefølge ville bryte 32 tester.

**Root cause:** Block-layout følger DOM-rekkefølge slavisk — det er ingen måte å rendre child[2] FØR child[1] visuelt uten å enten:
1. Endre DOM-rekkefølge (bryter tests)
2. Bruke flexbox/grid med `order:` (test-trygt)

**Fix:** Endre `card` til `display: flex; flexDirection: column` og sett eksplisitt `order:` på hver child slik at visuell rekkefølge avviker fra DOM-rekkefølge:

```
DOM-index   →  Visuell order
[0] header        →  order: 0
[1] typesContainer →  order: 2
[2] prizeMatrixEl  →  order: 1   ← visuelt FØR typesContainer
[3] statusMsg     →  order: 3
[4] sep           →  order: 4
[5] buyBtn        →  order: 5
[6] cancelBtn     →  order: 6
```

**Prevention:**
- ALDRI bytt DOM-rekkefølge i Game1BuyPopup-card.children uten å oppdatere alle 4 test-filer samtidig
- Hvis mockup krever ny visuell rekkefølge, bruk CSS `order:` på allerede-flex-container
- Pass på at hver child har eksplisitt `order` — implicit default 0 kan gi rare stack-orderings hvis blandet med eksplisitte

**Hvorfor flex-column er trygt for tests:**
- `Element.children` returnerer alltid i DOM-rekkefølge (ikke visuell)
- `card.children[1]` er fortsatt `typesContainer` uavhengig av CSS
- Vitest + happy-dom respekterer DOM-rekkefølge for `.children`

**Files:**
- `packages/game-client/src/games/game1/components/Game1BuyPopup.ts` (constructor — card.style.display + order per child)
- `.claude/skills/buy-popup-design/SKILL.md` (Iterasjon 2-seksjon)

**Related:** skill `buy-popup-design`, PR #1502 (initial), iter2-PR (denne)

---

### §7.31 — Triple-bong-rendering cross-color grouping bug (BUG, FIXED 2026-05-15 iter 2)

**Severity:** P0 (pilot-blokker — visuell regresjon på master-flyt)
**Oppdaget:** 2026-05-15 (Tobias-rapport — screenshot av "1 Stor hvit + 1 Stor gul + 1 Stor lilla" som rendret feilaktig)
**PR-status:** PR #1500 (Bølge 2) introduserte purchaseId + sequenceInPurchase men hadde 3 lag med bugs som hindret triple-rendering i prod.

**Symptom:**
Når Tobias kjøpte 3 forskjellige farger Stor (1 hvit + 1 gul + 1 lilla, alle 3-brett-bunder), forventet ÅN visuell triple-container per farge (3× 5×5 grids + dividers, 660px bredde). Faktisk:
- 3 separate single-cards merket "Hvit - 3 bonger" (proxy-header på single-design)
- 6+ single-cards merket "Gul - 3 bonger" (dobbelt antall, ikke gruppert)
- 0 Stor lilla (forsvant helt — siste assignment ble skrevet over)

**Root cause — 3 lag av bugs:**

**Bug A — Pre-runde mangler purchaseId** (`apps/backend/src/util/roomState.ts`):
`getOrCreateDisplayTickets` genererte display-tickets med `id: tkt-${i}` og ingen `purchaseId`. Frontend-`tryGroupTriplet` så `purchaseId === undefined && undefined && undefined` (alle 3 var undefined) og grupperte tre tilfeldige large-bonger uavhengig av farge.

**Bug B — Backend opprettet kun 1 row per spec** (`apps/backend/src/game/Game1ScheduledRoomSnapshot.ts`):
`ensureAssignmentsForPurchases.for (let i = 0; i < spec.count; i += 1)` iterated `count` × ganger uavhengig av `spec.size`. For `{size: "large", count: 1}` ble det laget 1 assignment-row — selv om 1 Stor = 3 brett. Resultat: backend hadde 1 farge-assignment for 3 ticket-IDer, fyllte resten med fallback.

**Bug C — Cross-color cart deler purchaseId** (samme service):
Cart `[1 Stor hvit, 1 Stor gul, 1 Stor lilla]` ble committed som ÉN `app_game1_ticket_purchases`-row med 3 specs. Alle 9 brett (3 × 3) fikk samme `purchaseId`. Frontend så 9 brett med samme purchaseId og prøvde å group(0,1,2), (3,4,5), (6,7,8) — som blandet farger på tvers av triplets.

**Fix — 3 lag løst sammen:**

**Frontend (Lag 1):** `TicketGridHtml.tryGroupTriplet` (`packages/game-client/src/games/game1/components/TicketGridHtml.ts`):
Lagt til `extractColorFamily(color)` helper som normaliserer fargenavn til familie (yellow/white/purple/etc). Modifisert grouping-heuristikken til å kreve ALLE 3 tickets:
1. `type === "large"`
2. samme `purchaseId`
3. **samme color-family** (ny sjekk)

Hvis fargen ikke matcher → returner null → rendrer 3 separate single-cards (ikke et trippel-design med blandet innhold).

**Backend display-tickets (Lag 2):** `roomState.ts` `getOrCreateDisplayTickets`:
Lagt til `assignBundleIds(colorAssignments)` helper som grupperer assignments etter `(color, type)` og emit syntetisk `purchaseId: "${roomCode}:${playerId}:bundle:${bundleIdx}"` + `sequenceInPurchase: brettIdx`. Pre-runde display-tickets får nå korrekt grouping-info og frontend kan gruppere dem korrekt.

**Backend ticket-purchase (Lag 3):** `Game1ScheduledRoomSnapshot.ts` `ensureAssignmentsForPurchases`:
Lagt til `const LARGE_TICKET_BRETT_COUNT = 3` og `const brettPerUnit = spec.size === "large" ? LARGE_TICKET_BRETT_COUNT : 1`. Loop'er nå `totalBrett = count × brettPerUnit` ganger så hver Stor får 3 assignment-rows med distinkte ticket-IDer.

**Hvorfor klient-side color-validation var nødvendig som defense-in-depth:**
Selv om backend nå skriver korrekte assignment-rows og bundle-IDs, kan future-bug eller race-condition gjøre at to forskjellige farger får samme purchaseId. Frontend MÅ derfor sjekke color-family eksplisitt for å unngå visuell regresjon (blandede triplets).

**Tests skrevet:**
- `TicketGridHtml.tripleGrouping.test.ts` (NY, 6 tester) — Tobias' eksakte scenario (1H + 1G + 1L = 3 triplets), color-validation, purchaseId-validation, type-validation
- `Game1ScheduledRoomSnapshot.test.ts` (+2 tester) — Stor X multipliserer til 3 brett, small holder seg 1 row
- `roomState.displayTicketColors.test.ts` (+5 tester) — synthetic purchaseId-generering for pre-runde bundles

**Prevention:**
- ALDRI anta at `purchaseId` alene er nok for triple-grouping — fargen MÅ valideres
- ALDRI iterer `for (let i = 0; i < spec.count; i++)` på Stor-bunder uten å multiplisere med `brettPerUnit`
- Hvis du ser `id: tkt-${i}` i pre-runde-state UTEN purchaseId → bug (bridge-pre-runde mangler bundle-info)
- Skriv test som matcher Tobias' eksakte rapport-scenario FØR fix shippes

**Filer endret:**
- `packages/game-client/src/games/game1/components/TicketGridHtml.ts` (extractColorFamily + tryGroupTriplet)
- `apps/backend/src/game/Game1ScheduledRoomSnapshot.ts` (LARGE_TICKET_BRETT_COUNT + brettPerUnit-loop)
- `apps/backend/src/util/roomState.ts` (assignBundleIds + synthetic purchaseId)
- 3 nye/utvidede test-filer

**Related:** Skill `bong-design` v1.2.0, Iter 1 i §7.27 (pre-runde-pris-bug), Bølge 2 PR #1500

---

### §7.32 — Top-HUD-kontroller må være i samme bordered wrapper

**Severity:** P2 (visuell UX / PM-kontekst-presisjon)
**Oppdaget:** 2026-05-16 (Tobias-screenshot — firkløver + "Velg lykketall" og status-tekst lå visuelt utenfor felles top-HUD-ramme)
**Status:** LØST 2026-05-16

**Symptom:**
Firkløver + "Velg lykketall" lå som separat DOM-kolonne til venstre for
`top-group-wrapper`, mens "Neste spill"-teksten lå i Pixi CenterBall-området.
Resten av top-HUD-en hadde felles border, bakgrunn og kolonnedeling, så
layouten fremstod asymmetrisk selv om elementene visuelt hørte til samme
kontrollrad.

**Root cause:**
`PlayScreen.ts` bygget `call-group-wrapper` som `ringSpacer + cloverColumn`,
mens status-tekst ble rendret som CenterBall idle-text og `top-group-wrapper`
kun inneholdt `LeftInfoPanel` + `CenterTopPanel`. Dermed kunne ikke status eller
clover få samme border/overflow/kolonnekontrakt som premie/mønster-panelet.

**Fix:**
- `call-group-wrapper` eier nå kun ring-spacer for Pixi-ball.
- `next-game-status-column` er første child i `top-group-wrapper`.
- `LeftInfoPanel` kommer før `lucky-number-column`, etter Tobias' iter 2 om å
  bytte plass på firkløverfeltet og spillerinfo-feltet.
- `lucky-number-column` ligger etter spillerinfo og før `CenterTopPanel`.
- Status-, player-info- og lykketall-kolonnene har fast bredde,
  `border-right` og samme inset-shadow som resten av top-HUD-en.
- `LeftInfoPanel` er `align-self: stretch` + `justify-content: center`, så
  personikon/`02` ikke blir et lite top-aligned kort inne i fullhøyde wrapper.
- `premie-design.html` er synket med `next-game-status-panel` og
  `lucky-number-panel` slik at mockup viser samme kolonneinndeling.

**Prevention:**
- Når Tobias ber om "samme element", sjekk DOM-parent, ikke bare visuell x/y.
- Top-HUD-kontroller som skal dele border må være children av
  `#top-group-wrapper`.
- `call-group-wrapper` skal ikke eie status eller clover/lykketall fremover;
  den er kun spacer for Pixi-ringen.
- Hvis HTML-statuskolonnen brukes, må CenterBall idle-text skjules i
  ikke-running-state slik at spiller ikke ser dobbelt "Neste spill".

**Filer endret:**
- `packages/game-client/src/games/game1/screens/PlayScreen.ts`
- `packages/game-client/src/premie-design/premie-design.html`
- `.claude/skills/spill1-center-top-design/SKILL.md`

**Related:** Skill `spill1-center-top-design` v1.2.0, `premie-design.html`

---

### §7.33 — Bong-grid spacing må eies av parent-grid, ikke card-padding

**Severity:** P2 (visuell UX / sorteringsdebug)
**Oppdaget:** 2026-05-16 (Tobias-screenshot med DevTools grid-overlay — hvit/gul/lilla triplets hadde ujevn visuell spacing)
**Status:** LØST 2026-05-16

**Symptom:**
Tripple-bonger så ut som de hadde ulik avstand mellom seg. DevTools viste grid-gap,
men de visuelle kortene fulgte ikke gapet fordi triple-kortet var bredere enn én
grid-kolonne og sub-grids hadde ekstra høyre/venstre-padding.

**Root cause:**
`TicketGridHtml` brukte `repeat(5, minmax(0px, 1fr))` + `gap: 10px`, mens
`BingoTicketTripletHtml` var `max-width: 660px`. Triplet ble lagt inn som ett
vanlig grid-child uten `grid-column: span 3`, så kortet overfløt sin grid-celle.
I tillegg hadde `.bong-triplet-sub` posisjons-spesifikk padding (`0 10px` og
13px på midt-sub), som gjorde hvit/gul/lilla visuelt asymmetriske.

**Fix:**
- Parent-grid er 6 kolonner: `grid-template-columns: repeat(6, minmax(0px, 1fr))`.
- Parent-grid har `gap: 16px` og `max-width: 1348px` (= 2 × 666px + 16px).
- Triplets får `grid-column: span 3`; singles får `grid-column: span 1`.
- `.bong-triplet-card` er `max-width: 666px`, `gap: 0px`,
  `padding: 9px 1px 3px 1px`.
- `.bong-triplet-header` eier header-inset med `margin: 0px 18px` og har
  `justify-content: flex-start` + `gap: 14px`; ikke bruk
  `justify-content: space-between`, fordi det skyver prisen bort fra navnet.
  Kun ×-knappen skal pushes til høyre med `margin-left:auto`.
- `.bong-triplet-sub` har `padding: 0`; ingen farge-/posisjons-padding påvirker
  spacing mellom bonger.
- `.triple-sub-root` beholder `aspect-ratio: 240 / 300`; `auto` kollapser
  body fordi `BingoTicketHtml` bruker absolutte front/back-face-lag.

**Prevention:**
- Mellomrom mellom bonger skal kun eies av `TicketGridHtml` parent-gridens
  `gap: 16px`.
- Ikke legg inn margin/padding på hvit/gul/lilla cards for å justere spacing.
- Når et card visuelt skal telle som 3 bonger, må det også spenne 3 grid-kolonner.
- Ikke fjern sub-bongens aspect-ratio når header/cancel skjules; rooten har
  ellers ingen normal-flow-høyde.
- Lås CSS-kontrakten med happy-dom-test før visuell iterasjon merges.

**Filer endret:**
- `packages/game-client/src/games/game1/components/TicketGridHtml.ts`
- `packages/game-client/src/games/game1/components/BingoTicketTripletHtml.ts`
- `packages/game-client/src/games/game1/components/TicketGridHtml.test.ts`
- `packages/game-client/src/games/game1/components/TicketGridHtml.tripleGrouping.test.ts`
- `.claude/skills/bong-design/SKILL.md`

**Related:** Skill `bong-design` v1.3.0

---

### §7.34 — Triple-bong × må sende ticketId, ikke purchaseId

**Severity:** P1 (pre-round UX / avbestilling virker ikke)
**Oppdaget:** 2026-05-16 (Playwright-verifisering av triplet-spacing — lokal test-purchase ble ikke fjernet via ×)
**Status:** LØST 2026-05-16

**Symptom:**
Triplet-wrapperen viste én ×-knapp, men klikk fjernet ikke bongen fra pre-round
state. Visuelt ble triplet liggende selv etter klikk.

**Root cause:**
`BingoTicketTripletHtml` sendte `purchaseId` til `onCancel`. Eksisterende
klient-/socket-kontrakt er derimot `cancelTicket(ticketId)` →
`ticket:cancel({ ticketId })`. Backend bruker én sub-ticket-id til å finne og
fjerne hele Large-bundlen atomisk. Synthetic pre-round `purchaseId` som
`roomCode:playerId:bundle:n` er ikke en gyldig ticket-id.

**Fix:**
- Triplet-wrapperens × bruker `primaryTicketId` (første sub-ticket) som cancel-id.
- Knappen vises bare når `cancelable` og første ticket-id finnes.
- `TicketGridHtml.tripleGrouping.test.ts` låser at triplet-× sender `"tkt-1"`
  og ikke synthetic/handlekurv-`purchaseId`.

**Prevention:**
- Ikke innfør nytt purchase-cancel-flow uten å endre `Game1SocketActions` og
  backend socket-kontrakt eksplisitt.
- For Large/Elvis/Traffic-bundles: cancel-flow starter med én ticket-id;
  backend eier bundle-oppløsning.

**Filer endret:**
- `packages/game-client/src/games/game1/components/BingoTicketTripletHtml.ts`
- `packages/game-client/src/games/game1/components/TicketGridHtml.tripleGrouping.test.ts`
- `.claude/skills/bong-design/SKILL.md`

**Related:** Skill `bong-design` v1.3.0, `SocketActions.cancelTicket()`

---

### §7.35 — Action-panel-plassering er top-wrapper-kontrakt, ikke CenterTop-margin

**Severity:** P2 (visuell UX / fremtidig layout-regresjon)
**Oppdaget:** 2026-05-16 (Tobias-screenshot — `HOVEDSPILL 1` lå helt til høyre, men skulle stå rett etter `Neste spill`)
**Status:** LØST 2026-05-16

**Symptom:**
Top-HUD-en hadde riktig felles ramme, men `HOVEDSPILL 1`/kjøpsknapp-kolonnen
lå som siste child helt til høyre. Tobias ønsket den rett etter `Neste spill`,
slik at status og tilhørende hovedspill-action er semantisk samlet.
`Innsats: 90 kr` brøt samtidig til to linjer i player-info-kolonnen.

**Root cause:**
Action-panelet var hardkoblet som andre child inne i `CenterTopPanel.root`
(`combo + actions`) og brukte `margin-left: auto` for å skyves ut til høyre.
Da kunne ikke `PlayScreen.ts` kontrollere felles top-HUD-rekkefølge uten enten
å duplisere knappene eller flytte state/callbacks ut av CenterTopPanel.

**Fix:**
- `CenterTopPanel` eksponerer `actionRootEl`, men beholder all knappestate og
  callbacks.
- `PlayScreen.ts` re-parenter `actionRootEl` direkte etter
  `next-game-status-column`, før `LeftInfoPanel`.
- Re-parentet action-panel får `margin-left: 0`, ingen venstre-border, og
  høyre-border mot player-info.
- `top-group-wrapper` bruker `margin-left:auto; margin-right:0` for å dele
  ledig inline-rom med chat-panelets eksisterende `margin-left:auto`; dette gir
  lik luft før top-HUD og mellom top-HUD/chat når viewporten har plass.
  `align-self` må forbli `flex-start` fordi overlay-root er en flex-row og
  `align-self:center` sentrerer på vertikal akse.
- `LeftInfoPanel` bet-info er `font-size: 14px`, `line-height: 1.35` og
  `white-space: nowrap`, så `Innsats: X kr` holder én rad.

**Prevention:**
- Ikke bruk `margin-left:auto` som semantisk layout-kontrakt for top-HUD.
- Når Tobias ber om ny rekkefølge mellom kolonner, flytt DOM-parent/order i
  `PlayScreen.ts`; ikke flytt business-state ut av komponenten som eier den.
- Ved re-parenting: destroy må fjerne både opprinnelig root og re-parentet
  action-root, ellers kan detached DOM bli liggende i overlayet.
- Player-info-beløp skal ikke wrappe; ved smal skjerm overflyter hele top-HUD
  horisontalt fremfor å bryte kolonner.
- Ikke bruk `align-self:center` for horisontal sentrering i `overlayRoot`
  (`flex-direction: row`); det flytter top-HUD-en ned mot bongene.
- Ikke sett både `margin-left:auto` og `margin-right:auto` på top-HUD når
  chat-panelet også har auto-margin; da blir høyre luft dobbelt så stor.

**Filer endret:**
- `packages/game-client/src/games/game1/components/CenterTopPanel.ts`
- `packages/game-client/src/games/game1/components/LeftInfoPanel.ts`
- `packages/game-client/src/games/game1/screens/PlayScreen.ts`
- `packages/game-client/src/premie-design/premie-design.html`
- `.claude/skills/spill1-center-top-design/SKILL.md`

**Related:** Skill `spill1-center-top-design` v1.3.0

---

### §7.36 — Triple sub-bong header-border må skjules som hel header, ikke bare tekst

**Severity:** P2 (visuell UX / fremtidig bong-regresjon)
**Oppdaget:** 2026-05-16 (Tobias-screenshot — midterste sub-bong hadde ekstra topprom og grå linje over BINGO-bokstavene)
**Status:** LØST 2026-05-16

**Symptom:**
Triple-bong før runde-start brukte riktig 3-sub-grid-struktur, men sub-bongene
arvet fortsatt deler av single-bongens interne kortlayout. Resultatet var ekstra
padding rundt hver sub-bong og en grå header-border over BINGO-bokstavene,
spesielt synlig på midterste bong.

**Root cause:**
`BingoTicketTripletHtml` skjulte bare `.ticket-header-name` og
`.ticket-header-price`. Selve header-diven i `BingoTicketHtml.populateFront()`
hadde fortsatt `padding-bottom: 5px` og `border-bottom`, og `buildFace()` hadde
inline `padding: 12px 18px 10px 18px`, `gap: 10px`, border-radius og shadow.
Siden dette var inline-styles, var det ikke nok å justere wrapper-padding.

**Fix:**
- `BingoTicketHtml` eksponerer stabile override-hooks:
  `.ticket-face`, `.ticket-face-front`, `.ticket-face-back` og `.ticket-header`.
- Triple-wrapperen skjuler hele `.ticket-header` i sub-bongene, ikke bare
  name/price.
- Triple-wrapperen setter sub-front `padding: 0 !important`,
  `gap: 4px !important`, `box-shadow: none !important` og
  `border-radius: 0 !important`.
- `.bong-triplet-card` har `gap: 0px` og eier all ytre padding. Etter
  Tobias-direktiv 2026-05-16 er triplet-spesifikasjonen:
  `padding: 9px 17px 8px 17px`, header `margin: 0px 2px`, og
  `.bong-triplet-grids` med `gap: 11px` + `margin-top: 10px`.

**Prevention:**
- Ikke fjern `.ticket-header` / `.ticket-face-front` fra `BingoTicketHtml`;
  de er kontrakten som gjør triplet-overrides presise.
- Ikke target bare tekstnoder når et helt single-card-underområde skal skjules.
  Hvis parent-diven har border/padding, blir den fortsatt synlig.
- For triple-bong skal wrapperen eie outer padding/skygge/radius; sub-bongene
  skal kun bidra med BINGO-header, grid og footer.

**Filer endret:**
- `packages/game-client/src/games/game1/components/BingoTicketHtml.ts`
- `packages/game-client/src/games/game1/components/BingoTicketTripletHtml.ts`
- `packages/game-client/src/games/game1/components/BingoTicketHtml.test.ts`
- `packages/game-client/src/games/game1/components/TicketGridHtml.tripleGrouping.test.ts`
- `.claude/skills/bong-design/SKILL.md`

**Related:** Skill `bong-design` v1.4.4

---

### §7.37 — Elvis-banner insertion må targete `.ticket-body`, ikke nested `.ticket-grid`

**Severity:** P2 (frontend-regresjon / ticket:replace)
**Oppdaget:** 2026-05-16 (nærliggende testkjøring etter triplet-layout-fix)
**Status:** LØST 2026-05-16

**Symptom:**
`BingoTicketHtml.loadTicket(non-Elvis → Elvis)` kastet DOMException:
`insertBefore` fikk en reference-node som ikke var direkte child av front-face.

**Root cause:**
Etter §5.9-refaktoren ligger `.ticket-grid` inne i `.ticket-body`. Elvis-banneret
skal visuelt ligge mellom header og body, men `syncElvisBanner()` forsøkte
fortsatt `front.insertBefore(banner, gridWrap)`. `gridWrap` er ikke lenger child
av `front`, så DOM-operasjonen feilet. Samme testfil hadde også legacy
header-forventninger (`small_yellow`, `Large Yellow`) selv om §5.9 nå viser
norske labels.

**Fix:**
- `syncElvisBanner()` finner `.ticket-body` og inserter Elvis-banneret før den.
- Elvis-testene forventer norske non-Elvis labels: `Gul` og `Gul - 3 bonger`.

**Prevention:**
- Når `.ticket-body` eksisterer, er dette grensen mellom kort-header/banner og
  grid/letters/footer. Ikke bruk `.ticket-grid` som front-face insert anchor.
- Når tester rører bong-header, bruk §5.9-labels. Legacy backend-color strings
  er input-format, ikke display-kontrakt.

**Filer endret:**
- `packages/game-client/src/games/game1/components/BingoTicketHtml.ts`
- `packages/game-client/src/games/game1/components/BingoTicketHtml.elvis.test.ts`
- `.claude/skills/bong-design/SKILL.md`

**Related:** Skill `bong-design` v1.4.1

---

### §7.38 — BuyPopup-design må løse DOM-test-kontrakt og visuell mockup separat

**Severity:** P2 (frontend-regresjon / kjøpsflyt-UX)
**Oppdaget:** 2026-05-16 (Tobias-screenshot: prod-popup til venstre, `kjopsmodal-design.html` til høyre)
**Status:** LØST 2026-05-16

**Symptom:**
Prod-`Game1BuyPopup` hadde samme funksjonelle innhold som mockupen, men avvek
visuelt: headeren sto på to linjer, `Du kjøper` lå øverst i headeren,
ticket-radene manglet felles bordered wrapper, og popupen ble høy nok til at
spilleren måtte scrolle i live-spill.

**Root cause:**
`Game1BuyPopup` har test-låste DOM-indekser fra tidligere iterasjoner:
`card.children[1] = typesContainer`, `[2] = prizeMatrixEl`, `[3] = statusMsg`,
`[5] = buyBtn`, `[6] = cancelBtn`; i tillegg forventer lossState-testen
`header.children[3] = lossStateEl`, og displayName-testen finner subtitle via
`letter-spacing: 0.14em`. Tidligere implementasjon prøvde å beholde disse
indeksene ved å legge `summaryEl` i headeren, men det ga feil visuell layout og
for høy popup.

**Fix:**
- Synlig header er nå én linje: `Neste spill: {displayName}`.
- Subtitle-diven med `letter-spacing: 0.14em` beholdes kun som skjult test-
  kompatibilitetsanker.
- `header.children[2]` er en skjult compat-placeholder, slik at `lossStateEl`
  fortsatt er `header.children[3]`.
- Den faktiske `Du kjøper`-summaryen rendres nederst i `typesContainer`, med
  full bredde (`grid-column: 1 / -1`) og divider-linje som i mockupen.
- `typesContainer` eier nå den felles bordered ticket-wrapperen.
- `statusMsg` skjules når tom, og kort-padding/spacing er strammet slik at
  popupen passer uten intern scroll på desktop/tablet.
- Visual-harness `buy-popup` bruker nå 6-raders hvit/gul/lilla-fixture med
  forhåndsvalgt `1x Liten hvit`, `1x Stor hvit`, `1x Liten gul`.

**Prevention:**
- Ikke flytt top-level card-children for å matche design. Bruk CSS `order`,
  skjulte compat-ankere eller wrapper-styling når test-kontrakten må beholdes.
- Ikke legg `Du kjøper` i headeren. Summary hører visuelt til nederst i
  ticket-wrapperen under type-radene.
- BuyPopup-endringer skal alltid sjekkes mot både `kjopsmodal-design.html` og
  visual-harness `?scenario=buy-popup`, med eksplisitt no-scroll-måling av
  `card.scrollHeight <= card.clientHeight`.

**Filer endret:**
- `packages/game-client/src/games/game1/components/Game1BuyPopup.ts`
- `packages/game-client/src/visual-harness/visual-harness.ts`
- `.claude/skills/buy-popup-design/SKILL.md`

**Related:** Skill `buy-popup-design` v1.1.0

---

### §7.39 — Ticket-grid top-gap må måles fra faktisk top-HUD, ikke hardkodes

**Severity:** P2 (frontend layout / bong-synlighet)
**Oppdaget:** 2026-05-16 (Tobias-feedback etter top-HUD + triplet-layout iterasjoner)
**Status:** LØST 2026-05-16

**Symptom:**
Etter at top-HUD ble flyttet inn i ett felles bordered element, lå første
bongrad fortsatt for langt under HUD-en. Det var lik funksjonalitet, men
unødvendig tomrom mellom top-elementene og bongene gjorde at færre bonger fikk
plass i viewporten før scroll.

**Root cause:**
`PlayScreen` brukte en statisk `TICKET_TOP = 239` fra eldre layout. Etter flere
top-HUD-iterasjoner endret faktisk HUD-høyde og plassering seg, men
ticket-grid fulgte ikke etter. Dermed ble gapet en historisk rest, ikke en
bevisst spacing-regel.

**Fix:**
`PlayScreen.positionTicketGrid()` måler nå faktisk
`top-group-wrapper.getBoundingClientRect().bottom` relativt til overlay-root og
legger på `16px` spacing før ticket-grid plasseres. Når top-HUD status/body
eller CenterTopPanel/LeftInfoPanel-innhold endrer layout, repositioneres gridet.

**Prevention:**
- Ikke gjeninnfør hardkodet `TICKET_TOP` for Spill 1 når top-HUD endres.
- Ticket-grid skal starte `16px` under faktisk top-HUD-bunn, samme
  spacing-familie som bong-gridens `gap: 16px`.
- Ved layoutendringer i `top-group-wrapper`: mål både HUD-bunn og første
  bongrad i browser, ikke vurder gapet kun visuelt.

**Filer endret:**
- `packages/game-client/src/games/game1/screens/PlayScreen.ts`
- `.claude/skills/spill1-center-top-design/SKILL.md`

**Related:** Skill `spill1-center-top-design` v1.3.1, §7.32, §7.33, §7.35

---

## §8 Doc-disiplin

### §8.1 — BACKLOG.md går stale uten review

**Severity:** P1 (informasjons-divergens)
**Oppdaget:** 2026-05-10 sesjon
**Symptom:** K4 (BIN-823) markert ÅPEN selv om FIKSET 2026-05-08
**Fix:** Kvartalsvis sweep + agent-rutine for å oppdatere BACKLOG ved hver PR-merge
**Prevention:**
- PR-template krever "Oppdatert BACKLOG.md? Y/N"
- Hver agent-leveranse må sjekke om BACKLOG-entry påvirkes

### §8.2 — PM-handoff-historikk er kumulativ — les ALLE

**Severity:** P0 (kunnskapstap mellom sesjoner)
**Oppdaget:** Tobias-direktiv 2026-05-10 (PR #1134)
**Symptom:** Ny PM leser kun siste handoff → går i samme feller som tidligere PM-er har dokumentert
**Fix:** Les ALLE handoffs siden 2026-04-23 (~12-15 stk, 3-5 min hver)
**Prevention:**
- PM_ONBOARDING_PLAYBOOK §3 trinn 3 håndhever dette
- Anti-mønster: "Jeg leser bare den siste — den er state-of-the-art"

### §8.3 — ADR-er er IMMUTABLE etter merge

**Severity:** P1 (audit-integritet)
**Prevention:**
- Hvis beslutning overstyres: lag ny ADR med `Superseded by ADR-MMMM`
- Aldri redigér eksisterende ADR-tekst
- Hver kanonisk doc skal ha "Endringslogg"-seksjon for sporbarhet

### §8.4 — Konflikt: kode vs doc → DOC-EN VINNER

**Severity:** P0 (regel)
**Oppdaget:** Tobias-direktiv 2026-05-08
**Prevention:**
- Hvis kode motsier doc: fix koden, oppdater doc samme PR
- Hvis du oppdager doc er feil: fix doc + entry her i fallgruve-loggen

### §8.5 — Tema-spesifikke audits leses basert på scope

**Severity:** P1 (kontekst-tap)
**Oppdaget:** PR #1134 (lese-disiplin-oppdatering)
**Prevention:**
- Wallet-scope → les `docs/compliance/` + wallet-audits
- Spill 1/2/3-scope → les `SPILL[1-3]_IMPLEMENTATION_STATUS_*` + `SPILL_REGLER_OG_PAYOUT.md` + `SPILLKATALOG.md`
- Pilot-go-live-scope → les `LIVE_ROOM_ROBUSTNESS_MANDATE_*` + `PILOT_*`-runbooks + `R[2-12]_*_TEST_RESULT*`
**Related:** [`PM_ONBOARDING_PLAYBOOK.md`](./PM_ONBOARDING_PLAYBOOK.md) §3.1

### §8.6 — Cascade-merges fragmenterer delte template/config-filer

**Severity:** P2 (lesbarhet + maintenance-byrde)
**Oppdaget:** 2026-05-13 (audit av `.github/pull_request_template.md` etter PR #1335 + #1338 + #1333)
**Symptom:** Tre påfølgende PR-er la hver til en ny seksjon i samme PR-template uten å rydde i eksisterende struktur. Resultat: 117 linjer, 5 overlappende blokker (PM-onboarding + Knowledge protocol + Bug-resurrection + Tobias-smoke-test orphan blockquote + Done-policy/ADR midt mellom). Summary-seksjonen sto under den lange PM-onboarding-blokken istedet for først.
**Fix:** Restrukturer atomisk i én PR (`fix/pr-template-audit-2026-05-13`): Summary først, konsoliderte alle 4 disiplin-seksjoner under én `## Knowledge protocol`-paraply, beholdt alle 9 workflow-regex-markers. 117 → 108 linjer.
**Prevention:**
- Når en PR rør delte template/config-filer (`.github/pull_request_template.md`, `.github/workflows/*`, `CLAUDE.md`, top-level `docs/`-rotsiden): sjekk om eksisterende seksjon kan utvides, ikke legg til ny parallell seksjon
- For workflow-markers: dokumentér i kommentar hvilken regex som parser markøren, slik at senere refaktor ikke bryter parsing
- Hvis cascade-merges skjer pga uavhengige agent-bølger: PM eier konsolideringspass etter siste merge
**Related:** PR #1335, #1338, #1333 (cascade-kilder)

### §8.7 — Skill-frontmatter-hook er ikke nok; scope-header CI må kjøres ved skill-endringer

**Severity:** P2 (CI-fail etter PR-åpning, selv om pre-commit passerer)
**Oppdaget:** 2026-05-15 i PR #1527.
**Symptom:** Lokal pre-commit kjørte `validate-skill-frontmatter.mjs` og `check-markdown-links.mjs` grønt, men GitHub Actions `Validate scope-headers` feilet fordi `.claude/skills/debug-hud-gating/SKILL.md` manglet `<!-- scope: ... -->` rett etter YAML-frontmatter. Etterpå feilet samme workflow fordi `docs/auto-generated/SKILL_FILE_MAP.md` var stale.
**Root cause:** Scope-header-gaten kjøres i CI, men ikke som samme lokale hook som skill-frontmatter-valideringen. En skill kan derfor ha gyldig YAML-frontmatter og likevel mangle auto-loading-scope. Når scope endres, må skill-file-map regenereres. Hvis lokal `.claude/skills/` har ignored/untracked skills, lokal generator kan produsere en map som CI aldri kan reprodusere.
**Fix:** Legg til scope-header i `debug-hud-gating`, versjonsbump skillen til v1.0.1 og regenerer `SKILL_FILE_MAP.md` fra en ren tracked worktree.
**Prevention:**
- Når en PR rører `.claude/skills/*/SKILL.md`, kjør lokal variant av scope-sjekken og regenerer `SKILL_FILE_MAP.md` fra tracked files. Hvis lokal `.claude/skills/` har ekstra ignored skills, bruk ren worktree:
  `git worktree add --detach /tmp/spillorama-skillmap-clean HEAD && cd /tmp/spillorama-skillmap-clean && node scripts/build-skill-file-map.mjs`
- Scope-header skal stå rett etter lukkende `---`, før første Markdown-heading.
- Hvis skillen bevisst er for bred, bruk eksplisitt tom header: `<!-- scope: -->`.
**Related:**
- `.claude/skills/debug-hud-gating/SKILL.md`
- `.github/workflows/skill-mapping-validate.yml`
- `docs/auto-generated/SKILL_FILE_MAP.md`

### §8.8 — Dokumentasjon finnes, men operativ PM-forståelse er ikke bevist

**Severity:** P0 (kunnskapstap mellom PM-er)
**Oppdaget:** 2026-05-15 etter Tobias-direktiv om null spørsmål ved PM-overgang.
**Symptom:** Ny PM kan peke til handoffs, skills og PITFALLS_LOG, men mangler konkret svar på hva forrige PM leverte, hvilke PR-er/workflows som er åpne, hvilke invariants som gjelder, og hva første handling må være. Resultatet blir pivot, gjentatte spørsmål til Tobias eller at agenter spawnes med for lite kontekst.
**Root cause:** Dokumenttilstedeværelse ble forvekslet med absorbert operativ kunnskap. `pm-checkpoint.sh` og `pm-doc-absorption-gate.sh` beviser lesing, men ikke at PM kan videreføre arbeidet i samme spor.
**Fix:** Innfør PM Knowledge Continuity v2: `scripts/pm-knowledge-continuity.mjs` genererer evidence pack fra live repo/GitHub-state, lager self-test-template, validerer fritekstsvar og skriver `.pm-knowledge-continuity-confirmed.txt`.
**Prevention:**
- Ny PM skal kjøre `node scripts/pm-knowledge-continuity.mjs --validate` før første kodehandling.
- Hvis validering feiler, generer evidence pack + self-test og bekreft med `--confirm-self-test`.
- PM skal kreve Agent Delivery Report fra alle implementer-/fix-agenter før PR, slik at neste PM arver både kodeendring og mentalmodell.
**Related:**
- `docs/operations/PM_KNOWLEDGE_CONTINUITY_V2.md`
- `docs/engineering/AGENT_DELIVERY_REPORT_TEMPLATE.md`
- `scripts/pm-knowledge-continuity.mjs`

---

## §9 Konfigurasjon / Environment

### §9.1 — Tobias' `.env` pekte på ikke-eksisterende DB

**Severity:** P0 (login feilet med 500 INTERNAL_ERROR i timer)
**Oppdaget:** 2026-05-09 sesjon
**Symptom:** `tobiashaugen@localhost:5432/spillorama_local` finnes ikke på Tobias' Mac
**Fix:** Korrigert til Docker-Postgres `spillorama:spillorama@localhost:5432/spillorama`
**Prevention:**
- `.env.example` matcher Docker-Compose
- Backup `.env.backup-YYYY-MM-DD` ved endringer

### §9.2 — Migration timestamp-rekkefølge bug (MED-2)

**Severity:** P1 (migrations-blokker)
**Oppdaget:** 2026-05 fixet
**Symptom:** ALTER TABLE migration kjørt før CREATE TABLE-migration → feiler
**Fix:** ADR-0014 idempotent migrasjoner — `CREATE TABLE IF NOT EXISTS` før ALTER
**Prevention:**
- Forward-only-policy
- Test: kjør migration på fersk DB → må passere

### §9.3 — Renderdeploy auto-migrate via buildCommand

**Severity:** P1 (zero-downtime krav)
**Oppdaget:** Designet 2026-04
**Symptom:** Migrate kjørt etter app-start → mismatch i schema-state
**Fix:** `render.yaml.buildCommand` kjører `npm run migrate` FØR app-start
**Prevention:**
- Aldri legg `migrate` i `startCommand`
- Hvis migrate feiler → build aborts → forrige versjon kjører videre (no downtime)

### §9.4 — Master-hall-pin: kolonne + extra_json

**Severity:** P1 (per §3.6)
**Oppdaget:** 2026-05-09
**Prevention:** Set BÅDE kolonne OG extra_json ved seed/migration

### §9.5 — Demo-plan åpningstid blokkerte natt-testing

**Severity:** P1 (utviklings-blokker)
**Oppdaget:** 2026-05-10 (Tobias testet klokken 00:23 — plan kun aktiv 11:00-21:00)
**Symptom:** Spillerklient så "Stengt — åpner kl 11:00" om natten. Lobby returnerte `null nextScheduledGame` selv om demo-plan eksisterte.
**Root cause:** `seed-demo-pilot-day.ts` brukte `DEMO_PLAN_START_TIME = "11:00"`, `DEMO_PLAN_END_TIME = "21:00"`. Korrekt for prod-hall-åpningstid, men blokkerer dev/staging-testing utenfor norsk åpningstid.
**Fix:** PR #1192 — endret demo-plan til 00:00-23:59 (24t opening). Plan er fortsatt regulatorisk-korrekt fordi den ER en demo-plan, ikke prod-plan.
**Prevention:**
- Dev/staging-seed bør være tilgjengelig 24/7 så testing ikke blokkerer ved tidssoner
- Prod-plan har egne åpningstider — disse seedes via egne migrations/admin-UI, ikke dev-seed
- PM-bekreftelse før seed-time-endring: dev/staging vs prod
**Related:**
- PR #1192
- `apps/backend/scripts/seed-demo-pilot-day.ts:1323-1327`

### §9.6 — `reset-state.mjs` ON CONFLICT på `operation_id` uten UNIQUE-constraint

**Severity:** P1 (reset-state-script feilet ved gjentatt kjøring)
**Oppdaget:** 2026-05-10 (forsøkte `npm run dev:all -- --reset-state` i ren staging)
**Symptom:** `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification`
**Root cause:** `app_wallet_entries.operation_id` har bare INDEX (for performance lookup), ikke UNIQUE-constraint. ON CONFLICT krever UNIQUE.
**Fix:** PR #1184 — endret til SELECT-then-INSERT pattern. Script sjekker først om operation_id finnes, skipper INSERT hvis duplikat. Idempotent uten å kreve schema-endring.
**Prevention:**
- ALDRI bruk `ON CONFLICT` uten å verifisere at target-kolonne har UNIQUE/EXCLUSION constraint
- Migrate-policy (ADR-0014): forward-only, kan ikke legge til UNIQUE-constraint i en kolonne med eksisterende duplikater uten cleanup-migration
- SELECT-then-INSERT er alltid trygt fallback for idempotente scripts
**Related:**
- PR #1184
- `scripts/dev/reset-state.mjs`
- ADR-0014 (idempotent migrations)

### §9.8 — Per-IP rate-limiting er industri-anti-pattern for autenticerte routes (NAT-pool-problemet)

**Severity:** P0 (pilot-blokker — ville låst hele bingolokale ute samtidig)
**Oppdaget:** 2026-05-11 (Tobias: "Vi er nødt til å angripe dette på en annen måte nå. ingenting av det som blir gjort har noen effekt. bør det gjøres mer research i hvordan andre håndterer dette?")
**Symptom:** Patches på rate-limit (§9.7 + PR #1226 localhost-bypass) løste IKKE rotårsaken. Tobias fortsatt blokkert. Research-agent avdekket at vi rate-limitet på feil dimensjon.
**Root cause:** Per-IP-keying er trygt KUN for anonymous routes (login-brute-force-vern). For autenticerte routes vil 250 spillere i ett bingolokale **dele én NAT-IP** — hele lokalet treffer rate-limit samtidig. Industry-standard (Stripe/GitHub/Cloudflare/Discord) nøkler autenticerte routes på `userId` fra JWT-claim eller token-hash, ikke IP.
**Fix:** Tre PR-er som etterlikner Stripe-pattern:
- PR #1229 — per-user keying via SHA-256-hash av Bearer-token (Spillorama bruker opaque sessions, ikke JWT, men hash gir samme funksjonelle isolering). Per-IP fallback for anonymous routes.
- PR #1230 — Redis response-cache 15-30s på stille read-endpoints (`/api/games/status`, `/api/halls`). Polling-trafikk faller fra ~3000 → ~50 handler-kjøringer per minutt ved pilot-skala.
- PR #1231 — klient quick-wins (respekter Retry-After, dedupe duplicate-fetches, halver spillvett-poll-frekvens).
**Prevention:**
- ALDRI rate-limit på per-IP for autenticerte routes som spillere bruker fra delt nettverk
- Bruk JWT-claim (eller token-hash for opaque-sessions) som primær nøkkel
- Per-IP er kun for anonymous routes (login/register/csp-report) som brute-force-vern
- Cache + push istedenfor poll for live state — sliding-window-rate-limit kan ALDRI rate-allowe poll-trafikk fra mange klienter pålitelig
**Related:**
- PR #1229 (per-user keying)
- PR #1230 (Redis response-cache)
- PR #1231 (klient polling-quick-wins)
- `docs/research/RATE_LIMITING_INDUSTRY_RESEARCH_2026-05-11.md` (full industry-research)
- §9.7 (akutt-fix før dette) + §8.4 (doc-vinner-prinsipp — research-rapport ble doc)

### §9.7 — HTTP rate-limit kastet spillere ut etter 4 refresh

**Severity:** P0 (spillere mistet tilgang)
**Oppdaget:** 2026-05-11 (Tobias: "kan ikke være sånn at hele spillet shuttes ned hvis en kunde oppdaterer siden 4 ganger")
**Symptom:** 11 endpoints returnerte 429 Too Many Requests samtidig etter ~4 page-refreshes. Spilleren ble logget ut og lobbyen krasjet med "For mange forespørsler. Prøv igjen om X sekunder".
**Root cause:** `/api/auth/*` catch-all tier hadde `maxRequests: 20` per 60s. Hver page-load fyrer 4-5 auth-reads (`/me`, `/pin/status`, `/2fa/status`, `/sessions`). 4 refresh × 5 calls = 20 → traff limit → 429 på ALT under `/api/auth/`. Også `/api/`-default 300/min var marginalt for spillere som poller balance/lobby/games-status hvert 30s + spillvett-poll.
**Fix:** PR #1220 — separate tiers for auth-READ-endpoints (`/me`, `/sessions`, `/pin/status`, `/2fa/status` à 200/min hver), auth catch-all 20 → 100/min, `/api/` 300 → 1000/min, payments 10 → 30/min. Auth-WRITE-endpoints (login/register/password) beholder strict-cap for brute-force-vern.
**Prevention:**
- Skill auth-READ fra auth-WRITE i tiers — read-paths trenger høyere limit
- Estimer realistisk klient-aktivitet: page-load × N endpoints × M refresh per minutt
- Auth-guarded endpoints kan ha HØYERE limit enn anonymous (DoS er forhindret av JWT)
- Spillere må kunne refreshe 5-10 ganger per minutt uten kunsekvens
**Related:**
- PR #1220 (`fix(rate-limit): spillere kastes ikke ut etter 4 refresh`)
- `apps/backend/src/middleware/httpRateLimit.ts:DEFAULT_HTTP_RATE_LIMITS`
- `apps/backend/src/middleware/httpRateLimit.test.ts` — regresjons-test ensures admin tier ≥ 600 og /api/wallet/me = 1000

### §9.9 — Seed-script FK-ordering: `app_halls` MÅ INSERT før `app_hall_groups.master_hall_id`

**Severity:** P0 (seed-feil → pilot-flyt-test feiler)
**Oppdaget:** 2026-05-13 (PR #1344 fix)
**Symptom:** `npm run dev:nuke` med fresh DB → `seed-demo-pilot-day.ts` feiler med FK-violation: `app_hall_groups.master_hall_id` references `app_halls(id)` der `hall-default` ikke finnes.
**Root cause:** Seed-scriptet INSERT'er først `app_hall_groups` (med `master_hall_id='hall-default'`), deretter `app_halls` for demo-halls. `hall-default` blir aldri eksplisitt INSERT'et — den ble antatt å eksistere fra migration-seed.
**Fix:** PR #1344 — la til `INSERT INTO app_halls (id, name) VALUES ('hall-default', 'Spillorama Default Hall') ON CONFLICT (id) DO NOTHING` FØR `app_hall_groups`-INSERT i `seed-demo-pilot-day.ts`. Defensive column-detection for tv_token + hall_number replikert fra upsertHall.
**Prevention:**
- FK-referanser i seed-scripts: alltid INSERT referert tabell først
- Bruk `ON CONFLICT DO NOTHING` for idempotent re-seeding
- Pre-commit hook (kunne implementeres): grep INSERT INTO ordering vs FK-dependencies i seed-scripts
**Related:**
- PR #1344 (seed FK fix)
- `apps/backend/scripts/seed-demo-pilot-day.ts:1586`
- `app_hall_groups.master_hall_id` FK constraint

### §9.10 — Render External Database URL er full-access, ikke audit-safe read-only

**Severity:** P1 (prod-risk ved observability/audit fra agentmiljø)
**Oppdaget:** 2026-05-16 (Codex testet Render `External Database URL`)
**Symptom:** Rollen fra Render-panelets standard `External Database URL` (`bingo_db_64tj_user`) hadde `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `CREATEROLE` og `CREATEDB`. Den fungerte for audit, men var ikke safe som PM/agent observability-secret.
**Root cause:** Render viser default database credential, ikke en principle-of-least-privilege read-only credential. "External" betyr nettverks-ruting fra utsiden av Render, ikke read-only.
**Fix:**
- Opprettet egen rolle `spillorama_pm_readonly`.
- Satt `ALTER ROLE ... SET default_transaction_read_only = on`.
- Gitt kun `CONNECT`, `USAGE ON SCHEMA public`, `SELECT ON ALL TABLES`, `SELECT ON ALL SEQUENCES` + default privileges for fremtidige tabeller/sequences.
- Lagret lokal read-only URL i `~/.spillorama-secrets/postgres-readonly.env`; `observability-snapshot.mjs` bruker denne før admin/full-access URL.
**Prevention:**
- PM/agent skal bruke `postgres-readonly.env` for observability, ikke Render default URL.
- Hvis full-access URL må finnes lokalt, hold den separat i `postgres.env` og ikke bruk den i scripts uten eksplisitt write-behov.
- Verifiser read-only med `transaction_read_only=on`, `has_any_insert/update/delete=false`, og en write-probe som forventes å feile.
**Related:**
- `scripts/dev/observability-snapshot.mjs`
- `docs/evidence/README.md`
- `.claude/skills/pm-orchestration-pattern/SKILL.md` v1.4.1

---

## §10 Routing & Permissions

### §10.1 — Spillerklient bruker public lobby-endpoint

**Severity:** P1 (auth-confusion)
**Oppdaget:** 2026-05-09 sesjon
**Symptom:** Game1Controller forsøkte hente fra `/api/agent/game1/lobby` (auth'd) → 401 fra spillerklient
**Fix:** Bruk `/api/games/spill1/lobby` (public, hallId-param)
**Prevention:**
- Public endpoints prefix `/api/games/...`
- Auth'd agent endpoints prefix `/api/agent/...`
- Sjekk OpenAPI for security-section

### §10.2 — Master-action-routes krever `GAME1_MASTER_WRITE`

**Severity:** P0 (RBAC-fail)
**Oppdaget:** Designet
**Prevention:**
- ADMIN, HALL_OPERATOR, AGENT har permission
- SUPPORT-rolle eksplisitt utelatt
- Hall-scope: HALL_OPERATOR/AGENT låst til egen hall via `resolveHallScopeFilter`

### §10.3 — Cron-jobs MÅ ha lock-mekanisme

**Severity:** P1 (race-conditions ved horizontal scaling)
**Oppdaget:** 2026-04
**Fix:** Redis-distributed lock på cron-jobs (`SCHEDULER_LOCK_PROVIDER=redis`)
**Prevention:**
- Aldri legg til cron uten lock — multi-instance vil duplikere

---

## §11 Agent-orkestrering

### §11.1 — PM-sentralisert git-flyt (ADR-0009)

**Severity:** P1 (workflow)
**Oppdaget:** 2026-04-21 etter accidental cross-agent-merge
**Prevention:**
- Agenter committer + pusher feature-branch — ALDRI åpne PR eller merge
- PM eier `gh pr create` + `gh pr merge --squash --auto --delete-branch`
- Agent-rapport-format: `Agent N — [scope]:` med branch, commits, test-status

### §11.2 — Skill-loading lazy per-task

**Severity:** P2 (performance)
**Oppdaget:** 2026-04-25 (memory: feedback_skill_loading.md)
**Prevention:**
- Last KUN skills når du selv skal redigere kode i det domenet
- Skip for ren PM/orkestrering eller delegert agent-arbeid
- Hver user-prompt får protokoll — alltid output decision FØR kode

### §11.3 — Parallelle agenter må eie ulike filer

**Severity:** P1 (merge-conflict)
**Oppdaget:** 2026-05-10 sesjon
**Prevention:**
- Eksempel trygg parallellisering:
  - Agent A: `apps/backend/scripts/`
  - Agent B: `BACKLOG.md`
  - Agent C: `docs/engineering/`
- Aldri spawne ≥2 agenter på samme fil eller samme branch

### §11.4 — Agent-prompt MÅ inkludere kjente fallgruver

**Severity:** P1 (kunnskapstap → repeterte feil)
**Oppdaget:** 2026-05-10 (Tobias-direktiv om dokumentasjon)
**Prevention:**
- Hver agent-prompt skal ha "Kjente fallgruver"-seksjon med pekere til relevante §-er i denne loggen
- Agent skal lese pekerne FØR start
- Etter levering: agent legger til nye fallgruver i samme PR

### §11.5 — Agent-leveranse må dokumenteres i AGENT_EXECUTION_LOG

**Severity:** P1 (kunnskapsbevaring)
**Oppdaget:** 2026-05-10 (denne sesjonen)
**Prevention:**
- Etter hver agent-leveranse: legg til entry i [AGENT_EXECUTION_LOG.md](./AGENT_EXECUTION_LOG.md)
- Format: dato, agent-type, scope, fallgruver oppdaget, learnings

### §11.6 — Test-engineer + implementer-pattern for fix-PR

**Severity:** P1 (workflow)
**Oppdaget:** 2026-05-10 (spillerklient normalize-fix vellykket)
**Prevention:**
- For bug-fix der ROOT-CAUSE ikke er åpenbar: spawn først `test-engineer`-agent
- Test-engineer leverer:
  - Regression-tester som låser kontrakten
  - Spec for pure-funksjon (signature + mapping-tabell)
  - Slut-rapport med "Anbefaling til implementer-agent"
- Implementer-agent (eller PM) porter spec til produksjons-kode
- Pattern brukt vellykket i PR #1149 (devUserAutoLoginRegression spec → 38 linjers fix)

### §11.7 — Komponent-uten-wireup er IKKE leveranse

**Severity:** P0 (illusjons-leveranse)
**Oppdaget:** 2026-05-10 (JackpotSetupModal lå død i 3 dager)
**Symptom:** Komponent commit'et + tester grønne, men aldri kalt fra produksjons-flyt → bug forblir
**Fix:** Wireup-PR må landes i SAMME bølge som komponent-PR — ellers er ikke leveransen ferdig
**Prevention:**
- DoD for komponent: "Kan jeg trigge denne fra UI uten devtools?"
- Hvis nei: leveranse er IKKE ferdig — wireup må inn i samme PR eller raskt-følge-PR
- PM-checklist: "Hver ny komponent → finn `import`-statement i prod-path"

### §11.8 — Single-command restart (`npm run dev:nuke`) eliminerer port-konflikter

**Severity:** P1 (developer-experience + tap av tid)
**Oppdaget:** 2026-05-10 (Tobias: "Gi meg kun 1 kommondo som alltid vil funke. klarer vi det?")
**Symptom:** Stale node-prosesser, EADDRINUSE-feil på porter, foreldreløse Docker-containers fra worktree-isolasjon, manglende rebuild av game-client → "fortsatt samme bilde"
**Fix:** `scripts/dev/nuke-restart.sh` dreper ALT (node, porter 4000-4002/4173/5173-5175, Docker spillorama+chaos+agent-containers), pull main, `npm run build:games` (KRITISK: §7.10), så `npm run dev:all -- --reset-state`. Eksponert som `npm run dev:nuke`.
**Prevention:**
- Standard restart-kommando er ALLTID `npm run dev:nuke` — IKKE `dev:all` direkte
- Etter PR-merge, gi Tobias denne kommandoen (ikke individuelle kill/restart-kommandoer)
- PM_ONBOARDING_PLAYBOOK §2.2 oppdatert (PR #1183) til å bruke `dev:nuke`
- Hvis Tobias kjøre `dev:all` direkte og det feiler: peg på `dev:nuke` som standard, ikke debug individuelle porter
**Related:**
- `scripts/dev/nuke-restart.sh`
- PR #1183 (PLAYBOOK-oppdatering)
- PR #1189 (la til build:games-steget)
- §7.10 (static bundle krever rebuild)

### §11.9 — Worktree-branch-leakage: agenter må eie egne branches

**Severity:** P1 (merge-conflict mellom parallelle agenter)
**Oppdaget:** 2026-05-10 (cherry-pick WaitingForMasterOverlay slett-fil-konflikt)
**Symptom:** Agent A starter på branch X, agent B starter på branch Y. Begge endrer overlappende filer (`WaitingForMasterOverlay.ts`). Når B prøver å cherry-picke commits fra A's branch → konflikt på fil som A slettet men B endret.
**Root cause:** Parallelle agenter må ikke bare eie ulike filer (§11.3), men også ulike worktrees så de kjører på uavhengig git-state. Cherry-pick mellom branches er anti-mønster når begge branchene er aktive.
**Fix:** Hver agent får isolert worktree via `.claude/worktrees/<slug>/`. Pre-commit hooks i én worktree leser ikke `COMMIT_EDITMSG` fra en annen.
**Prevention:**
- Parallelle agent-spawn: bruk `isolation: "worktree"`-parameter
- Pre-flight check ved spawn: skip om annen agent allerede har branch som rør samme fil
- Hvis cherry-pick må til mellom branches: rebase i stedet — eller (bedre) kombinér PR-er til én commit-chain fra main
**Related:**
- §11.3 (Parallelle agenter må eie ulike filer)
- §5.x (kjedede PR-er må rebases mot main mellom hvert squash)
- PR #1196 (overlay-slett ble blokkert av denne fallgruven)

### §11.11 — ESM-modul som er BÅDE importerbar og kjørbar må gate dispatcher

**Severity:** P2 (developer-friction, blokkerer testing)
**Oppdaget:** 2026-05-13 (PM Push-Control Phase 2-bygg)
**Symptom:** node:test for en ESM-fil rapporterer kun 1 test fullført, selv om filen har 30+ describe-blokker. Tester ble aldri kjørt fordi importeren printer help-tekst og kaller `process.exit()` på import.
**Root cause:** ESM-moduler kjører top-level kode ved hver import. Hvis modulen har en CLI-dispatcher med `process.exit(cmd ? 1 : 0)` på bunnen, vil import.meta.url-utløst kjøring eksitere før test-rammeverket får kalt testene.
**Fix:**
```javascript
// Pakk dispatcher i isDirectInvocation-guard:
const isDirectInvocation =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("my-module.mjs");

if (isDirectInvocation) {
  const cmd = process.argv[2];
  // ... dispatcher logic
}
```
**Prevention:**
- ENHVER ESM-fil som skal være BÅDE CLI-script og importerbart bibliotek MÅ ha denne guarden
- Test umiddelbart med `import { someExport } from "../my-module.mjs"` i en test-fil
- Eksplisitt `export` på funksjoner som testes (ikke bare implicit på top-level)
**Related:**
- `scripts/pm-push-control.mjs` — fixed 2026-05-13
- `scripts/__tests__/pm-push-control.test.mjs` — importerer `globMatch`, `filesOverlap`, `fileInScope`, `macNotify`

---

### §11.12 — JSDoc `**` inne i ESM kommentarer kan tolkes som comment-close

**Severity:** P3 (compile-time-friction)
**Oppdaget:** 2026-05-13 (PM Push-Control Phase 2-bygg)
**Symptom:** Node ESM-parser kaster `SyntaxError: Unexpected token '*'` ved oppstart fordi JSDoc-kommentar inneholder triple-star som tolkes som `*/` etterfulgt av `*`.
**Root cause:** JSDoc-style kommentarer åpnes med `/**` og avsluttes med `*/`. Hvis innholdet inneholder `**` (markdown-bold eller doubled-star glob), kan parser i visse situasjoner forveksle.
**Fix:** I JSDoc-kommentarer som dokumenterer glob-syntaks eller markdown-formattering, bruk plain-text-erstatninger som `[[double-star]]` eller `(double-asterisk)` i stedet for litterært `**`.
**Prevention:**
- Eksempler i JSDoc bør være kjørbare kodestumper, ikke glob-/markdown-syntaks
- Hvis du MÅ dokumentere `**`, skap eksempler som dataobjekter (`{ glob: "scripts/**/*.mjs" }`) — strings escapes-håndteres
**Related:**
- `scripts/pm-push-control.mjs` — fixed 2026-05-13 (JSDoc for `globMatch`)

---

### §11.13 — GitHub Actions YAML heredoc i bash-blokk MÅ indenteres

**Severity:** P2 (CI-fail på workflow-load)
**Oppdaget:** 2026-05-13 (PM Push-Control Phase 2 auto-rebase-workflow)
**Symptom:** YAML-parser kaster `could not find expected ':'` på linjer inne i en `run: |`-blokk fordi heredoc-content begynner på column 1 (ikke YAML-indentert).
**Root cause:** YAML pipe-block (`|`) krever konsistent indentation for hele blokken. Bash heredoc (`<<EOF`) skriver content uten innrykk, men YAML krever ALT innenfor blokken matche indentasjonen.
**Fix:** Erstatt heredocs i Actions-YAML med `printf` eller `cat` med eksplisitt innrykk:
```yaml
run: |
  printf '%s\n' "line 1" > /tmp/out
  printf '%s\n' "line 2" >> /tmp/out
```
**Prevention:**
- Aldri bruk `<<EOF` i Actions-YAML; bruk `printf` eller `tee`
- Test workflow-YAML lokalt: `python3 -c "import yaml; yaml.safe_load(open('path.yml'))"`
- For komplekse comment-bodies, bruk `gh pr comment --body-file <tmp>` med innholdet bygd via `printf`
**Related:**
- `.github/workflows/auto-rebase-on-merge.yml` — fixed 2026-05-13

---

### §11.10 — Pre-commit hook leser stale `COMMIT_EDITMSG`

**Severity:** P2 (developer-friction)
**Oppdaget:** 2026-05-10 (forsøk på å committe overlay-fix)
**Symptom:** `check-tier-a-intent.mjs` blokkerer commit med "Tier A intent missing" selv om commit-meldingen er korrekt
**Root cause:** Hook leser `.git/COMMIT_EDITMSG` som kan inneholde en TIDLIGERE commit-melding fra forrige `git commit -m` som ble avbrutt. Stale data fra forrige sesjon.
**Fix:** Bruk `PM_GATE_BYPASS=1 PM_INTENT_BYPASS=1 git commit ... --no-verify` for sjelden forekommende hook-bug. Eller tøm `.git/COMMIT_EDITMSG` manuelt mellom forsøk.
**Prevention:**
- Hook bør lese fra `git rev-parse --verify HEAD^{commit}` eller commit-meldingen via stdin, ikke COMMIT_EDITMSG
- Hvis hook blokkerer feilaktig: dokumentér bypass-grunn i commit-meldingen så reviewer ser hvorfor
- Aldri rutinmessig bypass alle hooks — kun denne spesifikke hook med kjent bug
**Related:**
- `.husky/pre-commit`
- `scripts/check-tier-a-intent.mjs` (TODO: refactor til stdin-basert input)

### §11.14 — ≥ 10 parallelle agenter trigger API stream-idle-timeout

**Severity:** P1 (PM-friction, mister agent-arbeid)
**Oppdaget:** 2026-05-13 (Wave 2 over-parallelization)
**Symptom:** Spawnet 12 parallelle Explore-agenter. 3 (E3, E4, E5, E6) returnerte `stream_idle_timed_out` etter ~5-10 min uten output. Andre 8 leverte normalt.
**Root cause:** Anthropic API har en stream-idle-timeout (estimert ~60-120 sek uten output). Når PM-AI holder mange parallelle agent-streams åpne samtidig, hver ny streaming-burst rate-limites og kan timeout før agent har fått output ut. Symptomer flytter seg fra agent-til-agent uten reproduksjon.
**Fix:** Begrens parallelt-antall til ≤ 6-8 agenter samtidig. Ved over-spawn: prioriter agenter med raskest forventet output først.
**Prevention:**
- Max 6-8 parallelle Agent-kall samtidig per sesjon (empirisk grense 2026-05-13)
- Bruk `isolation: "worktree"` for å unngå file-revert-konflikter (parallel-friendly)
- Når stalled agent oppstår: re-spawn etter at andre er ferdige, IKKE under
- Hvis 3+ stalls i samme sesjon: pause spawn-ing, vent på pipeline-drainage
**Related:**
- Wave 2 sesjon 2026-05-13 (E3-E6 stalled)
- AGENT_EXECUTION_LOG entries for "stream_idle_timed_out"

### §11.15 — Python additive-merge-resolver for AGENT_EXECUTION_LOG / PITFALLS

**Severity:** P2 (utility-pattern, ikke fallgruve i seg selv)
**Oppdaget:** 2026-05-13 (cascade-rebase × 14)
**Symptom:** Cascade-rebase trenger automatisk resolvering av additive append-only conflicts
**Resolver-script:** `/tmp/resolve-additive.py` (kan committes til `scripts/resolve-additive-conflicts.py` for permanent bruk):
```python
CONFLICT_PATTERN = re.compile(
    r"<<<<<<< HEAD\n(.*?)\n=======\n(.*?)\n>>>>>>> [^\n]+",
    re.DOTALL,
)
# Keep both HEAD and branch, separated by \n\n---\n\n
```
**Bruksmønster:**
```bash
# I worktree med conflict:
/tmp/resolve-additive.py docs/engineering/AGENT_EXECUTION_LOG.md docs/engineering/PITFALLS_LOG.md .github/pull_request_template.md
git add <resolved-files>
git rebase --continue
```
**Prevention/forbedring:**
- Permanent-script i `scripts/` så det er gjenfinnbart neste sesjon
- Wire inn i cascade-rebase-utility (`scripts/cascade-rebase.sh`) som ikke eksisterer enda — TODO
- Verifiser at resolveren IKKE brukes for ikke-additive filer (code) — den ville miste endringer
**Related:**
- §5.9 Cascade-rebase pattern
- PM Push Control auto-rebase workflow

### §11.16 — Worktree fork-from-wrong-branch trigger cascade rebases

**Severity:** P1 (cascade-multiplier-effekt)
**Oppdaget:** 2026-05-13 (Tobias' main repo var på fix-branch, ikke main, da PM startet)
**Symptom:** PM spawnet 11 agenter med `isolation: "worktree"`. Hver worktree-fork tok branch fra Tobias' lokale main repo som var på `fix/reentry-during-draw-2026-05-13`, IKKE origin/main. Alle 11 agenter committet på en branch som var foran origin/main — cascade-rebase ble trigget for HVERT agent-merge.
**Root cause:** Claude Agent SDK worktree-isolation forker fra parent's HEAD, ikke origin/main. Tobias' main repo state styres av Tobias.
**Fix:** Verifiser at parent repo er på `origin/main` FØR multi-agent-spawn:
```bash
cd $REPO_ROOT
git fetch origin
git status  # skal vise "On branch main, up-to-date with origin/main"
```
Hvis avvik: enten `git checkout main && git pull --rebase` (med Tobias' godkjennelse hvis dirty), eller spawn agenter med eksplisitt `base_branch=origin/main`.
**Prevention:**
- PM sesjons-start sjekkliste: verifiser `git status` viser main + up-to-date FØR parallel-spawn
- Hvis Tobias er på feature-branch: spawn 1 agent for å rebase, vent på merge, deretter spawn resten
- Eller: bruk dedikert worktree-base for agenter (eksternt fra Tobias' repo)
**Related:**
- §11.9 Worktree-branch-leakage (parent-side)
- Wave 2 sesjon 2026-05-13 cascade × 14

### §11.17 — Preview-design-sider er IMMUTABLE — agenter skal ALDRI overskrive med prod-state

**Severity:** P1 (regresjons-risiko — mockup-er er kanonisk sannhet for UI-design)
**Oppdaget:** 2026-05-15 (Tobias rapporterte 2 ganger at "triple-bong-design ble byttet ut")
**Symptom:** Tobias rapporterer at en av preview-sidene under `packages/game-client/src/{bong-design,kjopsmodal-design,premie-design,dev-overview,preview}/` ikke matcher det som ble godkjent tidligere. Førsteinntrykk er at en agent overskrev mockup-en med en mellomstilstand fra prod.

**Root cause (2026-05-15-hendelsen):** Source viste seg å være intakt — det reelle problemet var **stale build-artifact** under `apps/backend/public/web/games/{bong-design,...}/`. Disse er gitignored (`.gitignore`: `apps/backend/public/web/games/`) og må regenereres lokalt via `npm run build:games`. Tobias så stale HTML fra forrige build.

**Likevel:** Hendelsen avslørte at det ikke fantes hard-block mot at agenter overskriver preview-source. Tidligere har agenter "reddet" designet (anti-mønster: rette mockup til å matche prod) som ville skapt ekte regresjon.

**Fix (permanent forsvar):**
1. **CI-gate:** `.github/workflows/preview-pages-immutable.yml` (2026-05-15) blokkerer PR-er som rører `packages/game-client/src/{bong-design,kjopsmodal-design,premie-design,dev-overview,preview}/**` uten `[design-locked: YYYY-MM-DD]`-marker i PR-body. Marker er gyldig 30 dager.
2. **Skill:** `.claude/skills/preview-pages-protection/SKILL.md` dokumenterer regel + flyt + anti-mønstre.
3. **Implementer-prefix:** `docs/engineering/IMPLEMENTER_AGENT_PROMPT_PREFIX.md` mal-tekst PM kopier-paster inn i UI-agent-prompts.

**Prevention:**
- Agenter LESER FRA source (`packages/game-client/src/{folder}/{folder}.html`), ALDRI skriver til source uten Tobias-godkjenning
- Hvis Tobias rapporterer "designet er feil": sjekk artifact-stale FØRST (`npm run build:games` + hard-refresh). Source er kun feil hvis HTML-en faktisk har endret seg i git history
- Fix-agent-prompts som rører UI-komponenter (`Game1BuyPopup.ts`, `BingoTicketHtml.ts`, `CenterTopPanel.ts`, `BongCard.ts`, bonus-mini-spill) MÅ ha "Preview-design er IMMUTABLE"-prefix (mal i `IMPLEMENTER_AGENT_PROMPT_PREFIX.md`)
- Hvis designet faktisk skal endres: Tobias muntlig godkjennelse → PM oppdaterer preview-source → PR-body får `[design-locked: YYYY-MM-DD]`-marker → CI-gate aksepterer
- ALDRI "rette" mockup uten godkjennelse — selv om prod ser ut til å være riktig

**Related:**
- `.github/workflows/preview-pages-immutable.yml` (CI-gate)
- `.claude/skills/preview-pages-protection/SKILL.md` (skill)
- `docs/engineering/IMPLEMENTER_AGENT_PROMPT_PREFIX.md` (agent-prompt-mal)
- `.claude/skills/bong-design/SKILL.md` (relatert — bong-rendering-mockup)
- `.claude/skills/buy-popup-design/SKILL.md` (relatert — BuyPopup-mockup)

### §11.18 — Implementation-agent uten forensic evidence etter live-test-stang

**Severity:** P1 (tap av tid + feil rotårsak)
**Oppdaget:** 2026-05-15 etter to dager med live-test-stang rundt `purchase_open`/master-flyt.
**Symptom:** Tobias opplever at "vi ikke helt skjønner hvorfor ting går galt". PM og agenter diskuterer mulige årsaker (cron, seed, master-start, frontend bundle-id, localStorage, plan-run advance), men evidence ligger spredt i DB-snippets, monitor-logg, browser-observasjoner, Sentry/PostHog-baseline og chat.
**Root cause:** Ny implementation-agent får for bred eller antakelsesbasert prompt uten én korrelert before/after evidence pack. Agenten kan da fikse et symptom i feil lag og samtidig øke kompleksiteten.
**Fix:** Før implementation-agent spawnes etter gjentatt live-test-feil, kjør en smal forensic-runner som produserer ett markdown-bevis:
```bash
npm run forensics:purchase-open -- --phase before-master
# trigger test, vent 30 sek
npm run forensics:purchase-open -- --phase after-master-30s --scheduled-game-id <id>
```
Rapporten må legges ved agent-prompten, og agenten må sitere konkrete DB-rader/logglinjer når root cause forklares.
**Prevention:**
- Hvis en bug sees 2+ ganger i live-test: forensic evidence pack først, implementation etterpå.
- PM må velge én primær hypotese før kode-scope gis: B.1 seed, B.2 cron/tick, B.3 master-bypass, separat plan-run P0 eller client-localStorage.
- Sentry/PostHog skal være baseline + korrelasjon, ikke ettertanke.
**Related:**
- `scripts/purchase-open-forensics.sh`
- `docs/operations/PM_HANDOFF_2026-05-15.md` §1 forensic debug-protokoll
- `.claude/skills/pm-orchestration-pattern/SKILL.md` v1.3.3

### §11.19 — High-risk agent-prompt som fritekst gir misforstått scope

**Severity:** P1 (tap av tid + risiko for feil endring i live-room pengespill)
**Oppdaget:** 2026-05-15 etter Tobias-feedback om at agenter i forrige sesjon misforstod hva som ble sagt.
**Symptom:** PM gir agenten en muntlig/fritekstlig oppgave som blander fakta, hypoteser, ønsker og historikk. Agenten implementerer noe som virker plausibelt, men som ikke er bundet til evidence, riktig fil-scope eller oppdatert skill-kunnskap.
**Root cause:** Prompten mangler kontraktstruktur: baseline-SHA, write-boundary, evidence, non-goals, relevante skills, PITFALLS, doc-protokoll og delivery-report krav. Agenten fyller hullene med antakelser.
**Fix:** PM skal generere fact-bound agent-kontrakt før high-risk implementation-agent:
```bash
npm run agent:contract -- \
  --agent "Agent A — <scope>" \
  --objective "<konkret mål>" \
  --files <path> \
  --evidence <forensic-report.md> \
  --risk P0 \
  --output /tmp/agent-contract-<scope>.md
```
Lim hele kontrakten inn i agent-prompten.
**Prevention:**
- Ikke spawn high-risk implementation-agent fra chat-hukommelse eller fri prosa.
- Agenten må skille fakta fra hypoteser og sitere concrete evidence i root-cause.
- Hvis evidence motsier objective, skal agenten stoppe og melde konflikt før kodeendring.
- PM skal avvise leveranser uten Agent Delivery Report og kunnskapsoppdatering.
**Related:**
- `scripts/generate-agent-contract.sh`
- `docs/engineering/AGENT_TASK_CONTRACT.md`
- `docs/engineering/AGENT_DELIVERY_REPORT_TEMPLATE.md`
- `.claude/skills/pm-orchestration-pattern/SKILL.md` v1.3.4

### §11.20 — Agent-contract uten skill-SHA-lockfile mister reproduserbarhet

**Severity:** P2 (audit-trail-svekkelse, ikke akutt prod-risiko)
**Oppdaget:** 2026-05-16 (konsulent-review Fase 2 etter ADR-0024)
**Symptom:** En PM kan ikke etterpå svare på "hvilken skill-versjon jobbet agenten faktisk mot?". Skills oppdateres ukentlig (`skill-freshness-weekly.yml` beviser det), så en kontrakt generert mandag og brukt fredag kan referere skills som har endret seg under hånden.
**Root cause:** Tidligere `generate-agent-contract.sh` skrev kun `skill`-navn — ingen versjon, ingen commit-SHA. Reproducerbarhet av en gammel agent-leveranse var umulig.
**Fix:** Scriptet capture-er nå `skill@version@SHA` (12-tegns short-SHA) ved generering. Ny `scripts/verify-contract-freshness.mjs` validerer drift før agent-spawn.
**Prevention:**
- PM kjører `node scripts/verify-contract-freshness.mjs <contract.md>` før kontrakten limes inn i prompt.
- Drift = vurder reroll. Hvis ikke reroll: les diff og dokumenter beslutning i delivery-report.
- Skill-versjoner skal bumpes (semver) når innhold endres meningsfullt, ikke bare ved typo-fix.
**Related:**
- `scripts/generate-agent-contract.sh` (Fase 2-modifikasjon)
- `scripts/verify-contract-freshness.mjs` (ny)
- `docs/engineering/AGENT_TASK_CONTRACT.md` Regel 8 (Fase 2)
- `docs/adr/0024-pm-knowledge-enforcement-architecture.md`
- `.claude/skills/pm-orchestration-pattern/SKILL.md` v1.4.0

### §11.21 — Evidence-pack i /tmp overlever ikke reboot eller audit

**Severity:** P2 (audit-trail-svekkelse)
**Oppdaget:** 2026-05-16 (konsulent-review Fase 2 etter ADR-0024)
**Symptom:** Forensic-rapporter brukt som agent-contract-evidence (eks. `/tmp/purchase-open-forensics-2026-05-15T20-23-37Z.md`) er borte ved restart eller etter dager. Når Tobias eller ny PM 3 måneder senere prøver å forstå hvorfor en beslutning ble tatt, finnes ikke grunnlaget lenger. For et system med ekte penger + compliance er det ikke akseptabelt.
**Root cause:** Konvensjon for evidence-storage var ad-hoc `/tmp/`-bruk. Ingen mappe-struktur, ingen commit-policy, ingen retensjons-plan.
**Fix:**
- Ny konvensjon `docs/evidence/<contract-id>/` der `<contract-id>` er `YYYYMMDD-<short-agent-slug>` generert av `generate-agent-contract.sh`.
- Scriptet advarer ved ephemeral evidence (`/tmp/*`, `/var/folders/*`) og foreslår eksakte `cp`-kommandoer.
- `docs/evidence/README.md` definerer commit-policy: ja for forensics/snapshots/sentry-eksporter, nei for PII/credentials før skrubbing.
**Prevention:**
- For high-risk kontrakter (P0/P1, compliance, wallet, live-room) skal evidence kopieres til `docs/evidence/<contract-id>/` FØR agent-spawn.
- PR-template peker til `docs/evidence/<contract-id>/` ved high-risk arbeid.
- Lotteritilsynet-relevant evidence holdes uavkortet i 5 år per regulatoriske krav.
**Related:**
- `docs/evidence/README.md` (ny)
- `scripts/generate-agent-contract.sh` (Fase 2-modifikasjon)
- `docs/engineering/AGENT_TASK_CONTRACT.md` Regel 9 (Fase 2)
- `docs/adr/0024-pm-knowledge-enforcement-architecture.md`

### §11.22 — Agent Delivery Report fritekst aksepteres uten teknisk validering

**Severity:** P2 (PM-tid + risiko for at agent-leveranse merges uten oppdaterte kunnskapsartefakter)
**Oppdaget:** 2026-05-16 (konsulent-review Fase 3 etter ADR-0024)
**Symptom:** PM må manuelt eyeballe 8 H3-seksjoner i hver agent-leveranse-PR. Når 6 agenter leverer parallelt blir det 48 sjekkbokser. Stor sjanse for at PR merges der §5 "Knowledge updates" hevder skill/PITFALLS/AGENT_EXECUTION_LOG ble oppdatert men diff'en ikke inneholder filene.
**Root cause:** AGENT_DELIVERY_REPORT_TEMPLATE definerer formatet, men ingen workflow eller hook validerer at PR-body følger malen eller at §5-claims matcher diff. Honor-system under PM-press.
**Fix:**
- Ny `scripts/validate-delivery-report.mjs` (32 tester) som validerer:
  - Alle 8 H3-headere finnes med eksakt norsk tittel
  - §4 "Tests" har backtick-kommando ELLER eksplisitt "ikke kjørt" + begrunnelse
  - §5 "Knowledge updates"-paths cross-checkes mot diff (skill / PITFALLS / AGENT_EXECUTION_LOG)
  - §8 "Ready for PR" har "ja"/"nei" + "Reason:"-linje
- Ny `delivery-report-gate.yml` workflow som fyrer på high-risk paths (samme liste som delta-report-gate)
- Bypass via `[delivery-report-not-applicable: <begrunnelse min 10 tegn>]` + label `approved-delivery-report-bypass` eller `approved-emergency-merge`
**Prevention:**
- PR-er som rører pilot/wallet/compliance/live-room kan ikke merges uten gyldig delivery-report (eller dokumentert bypass)
- Lokal pre-push-validering anbefalt: `node scripts/validate-delivery-report.mjs --body-stdin --base origin/main`
- Per ADR-0024 konsolideringskriterier: hvis bypass brukes > 20% av PR-er i 30 dager, vurder gate-justering
**Related:**
- `scripts/validate-delivery-report.mjs` (ny)
- `scripts/__tests__/validate-delivery-report.test.mjs` (ny, 32 tester)
- `.github/workflows/delivery-report-gate.yml` (ny)
- `docs/engineering/AGENT_DELIVERY_REPORT_TEMPLATE.md` (utvidet med "Teknisk håndhevelse"-seksjon)
- `docs/adr/0024-pm-knowledge-enforcement-architecture.md`
- `.claude/skills/pm-orchestration-pattern/SKILL.md` v1.5.0

### §11.23 — Live-test uten frozen Sentry/PostHog snapshot gir muntlig feilsøking

**Severity:** P1 (PM/agent misdiagnosis-risiko under live-room testing)
**Oppdaget:** 2026-05-16 (etter GoH full-plan-run; Sentry/PostHog tokens kom på plass etter første rapport)
**Symptom:** PM kan si "Sentry var ren" eller "PostHog viste X", men neste PM/agent kan ikke revidere nøyaktig hvilke issues/events som fantes før og etter testvinduet. Dette fører til at agent-prompts baseres på minne, ikke audit-fakta.
**Root cause:** Sentry/PostHog ble sjekket manuelt i dashboard/API uten standardisert before/after export og diff. GoH-rapporten 2026-05-16 måtte eksplisitt merke Sentry/PostHog som ikke verifisert fordi tokens manglet.
**Fix:**
- Ny runner `scripts/dev/observability-snapshot.mjs` eksponert som `npm run observability:snapshot`.
- Runneren skriver JSON + Markdown under `docs/evidence/YYYYMMDD-observability-.../` og inkluderer Sentry unresolved, PostHog event-counts, `/tmp/pilot-monitor.log` severity counts og Postgres status.
- `--compare <before.json>` genererer nye/increased Sentry issues og PostHog event-deltas.
**Prevention:**
- Kjør snapshot før og etter GoH/live-test: `npm run observability:snapshot -- --label before-<scope>` og etterpå med `--compare`.
- Agent-contract for P0/P1 live-room bugs skal referere snapshot-filene, ikke bare PM-oppsummering.
- Tokens skal ligge i `~/.spillorama-secrets/` og aldri commit-es.
**Related:**
- `scripts/dev/observability-snapshot.mjs`
- `docs/evidence/README.md`
- `.claude/skills/pm-orchestration-pattern/SKILL.md` v1.5.1

### §11.24 — PM self-test fritekst-svar uten konkret pack-anker

**Severity:** P2 (PM-onboarding-svekkelse, ikke akutt prod-risiko)
**Oppdaget:** 2026-05-16 (Fase 3 P3 etter ADR-0024)
**Symptom:** En PM kunne passere `pm-knowledge-continuity --validate-self-test` ved å skrive 80+ chars generisk gibberish som "Jeg har lest alt og forstår alle aspekter ved systemet, inkludert pilot og wallet og compliance og live-room". Validatoren sjekket bare lengde + placeholder-token, ikke om svaret refererte konkret pack-evidens.
**Root cause:** `validateSelfTest()` hadde kun lengde-check (80 chars) + placeholder-token-regex. Ingen per-spørsmål-validering av at svaret refererer faktisk pack-innhold (handoff-filnavn, PR-numre, ADR-IDer, §X.Y-format, skill-navn, etc.).
**Fix:**
- Ny `PER_QUESTION_ANCHORS`-tabell i `scripts/pm-knowledge-continuity.mjs` med konkret regex-anker per spørsmål
- Ny `isGenericSelfTestAnswer()` fluff-reject for "OK", "lest gjennom", "tatt en titt", "have read"
- Ny `[self-test-bypass: <begrunnelse min 20 tegn>]`-marker for pack-spesifikke unntak
- 55 tester i `scripts/__tests__/pm-knowledge-continuity.test.mjs`
- Full dokumentasjon i `docs/engineering/PM_SELF_TEST_HEURISTICS.md`
**Prevention:**
- PM-svar skal være forankret i konkret pack-evidens (filnavn, PR-numre, ADR-IDer, §X.Y, skill-navn, file:line, etc.)
- Bypass kun ved pack-spesifikke unntak (eks. ingen åpne PR-er → Q2-anker ikke applicable)
- Per ADR-0024 konsolideringskriterier: hvis bypass brukes > 20% av sesjoner, kalibrer ankere
**Related:**
- `scripts/pm-knowledge-continuity.mjs` (Fase 3 P3-utvidet)
- `scripts/__tests__/pm-knowledge-continuity.test.mjs` (ny, 55 tester)
- `docs/engineering/PM_SELF_TEST_HEURISTICS.md` (ny — per-spørsmål-anker-tabell)
- `docs/operations/PM_KNOWLEDGE_CONTINUITY_V2.md` (utvidet med Fase 3 P3-eksempler)
- `docs/adr/0024-pm-knowledge-enforcement-architecture.md`
- `.claude/skills/pm-orchestration-pattern/SKILL.md` v1.6.0
- Meta-pattern (paraphrase-validation med per-felt-anker) brukt også i Tier-3 (`verify-context-comprehension.mjs`) og delivery-report-gate (`validate-delivery-report.mjs`)

### §11.25 — Agent-contract bygd men ikke adoptert i daglig flyt (0/35 high-risk spawns)

**Severity:** P2 (PM-workflow-svekkelse, ikke akutt prod-risiko, men hele §11.19-fix forblir aspirasjonell uten denne)
**Oppdaget:** 2026-05-16 (audit etter Fase 3 P3 merget)
**Symptom:** Audit 2026-05-16 viste at `scripts/generate-agent-contract.sh` ble committet 2026-05-15 (b772ccfd7), men siste 4 dagers AGENT_EXECUTION_LOG har **0 entries** som eksplisitt brukte `npm run agent:contract`. Estimat: ~35 high-risk agent-spawns burde brukt kontrakt. Faktisk bruk: 0. PM (selv inkludert) leverer fortsatt fri-tekst-prompts — nøyaktig §11.19-mønsteret som scriptet skulle løse.
**Root cause:** `AGENT_TASK_CONTRACT.md` Regel 1 ("PM skal ikke spawne implementation-agent på high-risk kode uten kontrakt") er æresnorm uten teknisk håndhevelse. Skill-doc-protokoll §2.19 sier "lim inn template", men ingen gate verifiserer at det skjedde. PM under tidspress skipper steget; PR-side gates fanger ikke pre-spawn-fritekst.
**Fix (Fase A av ADR-0024):**
- Ny `.github/workflows/agent-contract-gate.yml` — PR-side gate som krever `Contract-ID:` + `Contract-path:` i PR-body for high-risk paths, eller `[agent-contract-not-applicable: <begrunnelse min 20 tegn>]` bypass. Shadow-mode 2026-05-16 → 2026-05-23, hard-fail tidligst 2026-05-24.
- Ny `scripts/validate-pr-agent-contract.mjs` (29 tester) — validator-script som workflow-en kaller.
- Ny `scripts/pm-spawn-agent.sh` — lokal wrapper som genererer kontrakt + persisterer til `docs/evidence/<contract-id>/` og printer PR-body-linjer.
- PR-template utvidet med Agent Contract-seksjon.
- Ny label `approved-agent-contract-bypass`.
- Eksplisitt layered defense over knowledge-protocol/delivery-report/delta-report (POST-delivery) — agent-contract-gate er PRE-spawn.
**Prevention:**
- Bruk `bash scripts/pm-spawn-agent.sh ...` før agent-spawn — wrapperen genererer + persisterer kontrakt + printer PR-body-linjer
- PR-template minner PM på `Contract-ID:`-feltet
- Etter 2026-05-24: PR-en kan ikke merges uten enten gyldig contract-reference eller approved bypass-label
- Per ADR-0024 konsolideringskriterier: hvis agent-contract bypass-frekvens > 20% etter shadow-mode, kalibrer gate
**Related:**
- `.github/workflows/agent-contract-gate.yml` (ny)
- `scripts/validate-pr-agent-contract.mjs` (ny, 29 tester)
- `scripts/__tests__/validate-pr-agent-contract.test.mjs` (ny)
- `scripts/pm-spawn-agent.sh` (ny)
- `scripts/bypass-telemetry.mjs` (ny, 26 tester) + `bypass-telemetry-weekly.yml` (ny cron)
- `.github/pull_request_template.md` (utvidet)
- `docs/adr/0024-pm-knowledge-enforcement-architecture.md` (utvidet med Fase A endrings-log)
- `.claude/skills/pm-orchestration-pattern/SKILL.md` v1.7.0
- §11.19 (high-risk fritekst-prompt) — Fase A er den tekniske håndhevelsen som §11.19 manglet

### §11.26 — Worktree+stash baggage akkumulerer (400 worktrees / 178 stashes)

**Severity:** P3 (operasjonell hygiene, ikke prod-risiko, men disk-bruk + kognitiv last)
**Oppdaget:** 2026-05-16 (audit) — 2026-05-17 (Fase B-cleanup-scripts levert)
**Symptom:** Etter ~6 uker prosjekt har repo akkumulert:
- 401 git-worktrees (varav 240 ORPHANED — path slettet, men git-entry beholdt; 152 LOCKED-UNSAFE med uncommittet/upushet arbeid; kun 2 SAFE + 5 LOCKED-S)
- 178 git-stashes (52 klart safe via mønster-deteksjon: 1 AUTO-BACKUP + 17 AGENT-LEFTOVER + 34 MERGED-BRANCH; 91 UNCLEAR — typisk squash-merget branch som ser "unmerged" lokalt; 32 FRESH)

Hver fix-PR auto-deleter sin branch på origin men ikke lokal worktree. Hver gang PM bytter scope midt i agent-arbeid skapes ny "agent-leftover"-stash. Ingen mekanisme rydder dette.

**Root cause:** PR-merge med `--delete-branch` sletter remote branch + lokal branch, men IKKE worktree-mappe. `git stash` lager backup men har ingen TTL/cleanup-rutine.

**Fix:**
- Ny `scripts/cleanup-merged-worktrees.sh` med safety-verdict per worktree (SAFE/LOCKED-S/ORPHANED/UNSAFE_*/CURRENT/MAIN). DRY-RUN BY DEFAULT. `--apply` for interaktiv per-item Y/N. `--include-locked` for å inkludere LOCKED-S.
- Ny `scripts/cleanup-stale-stashes.sh` med kategorisering (AUTO-BACKUP/AGENT-LEFTOVER/MERGED-BRANCH/FRESH/EXPLICIT-KEEP/UNCLEAR). DRY-RUN BY DEFAULT. `--apply` for interaktiv. `--min-age N` for terskel (default 7d).
- Begge støtter `--json` for maskinlesbar output.
- Sikkerhet: UNSAFE-verdikter slettes ALDRI. UNCLEAR-stashes (squash-merge-edge-case) krever manuell vurdering. EXPLICIT-KEEP-mønstre (pre-rebase, recovery, rescue) beholdes alltid.
- `PM_SESSION_END_CHECKLIST.md` Trinn 10 (valgfri) peker til scriptene.

**Prevention:**
- Kjør cleanup-script ved sesjons-slutt (Trinn 10 i PM_SESSION_END_CHECKLIST)
- Bash 3.2-kompatibel (macOS default) — bruk simple counters, ikke `declare -A`
- For squash-merge-edge-case: bruk `gh pr list --state merged --search "head:<branch>"` for å avgjøre om en UNCLEAR-stash er trygg

**Related:**
- `scripts/cleanup-merged-worktrees.sh` (ny)
- `scripts/cleanup-stale-stashes.sh` (ny)
- `docs/operations/PM_SESSION_END_CHECKLIST.md` Trinn 10
- `.claude/skills/pm-orchestration-pattern/SKILL.md` v1.8.0

---

## §12 DB-resilience

### §12.1 — pg-pool uten error-handler → 57P01 krasjer backend (Sentry SPILLORAMA-BACKEND-5)

**Severity:** P0 (pilot-blokker — produsents-krasj ved Postgres-vedlikehold / failover)
**Oppdaget:** 2026-05-14 (Sentry-issue SPILLORAMA-BACKEND-5 11:23:30 UTC)
**Symptom:**
- Backend krasjer med `uncaughtException` på request mot `/api/agent/game1/master/heartbeat`
- Stack: `pg-protocol/src/parser.ts:394 parseErrorMessage` → `terminating connection due to administrator command`
- pg-error-kode `57P01` (admin_shutdown)
- Trigger var lokal `docker-compose up -d --force-recreate postgres`, men samme scenario kan skje i prod ved Render-vedlikehold / failover / OS-restart av postgres-container

**Root cause:**
- `node-postgres` pg.Pool emit-er `error`-event når en idle client dør
- Hvis det IKKE finnes en `pool.on("error", handler)`-listener, propagerer feilen som `uncaughtException`
- 42 `new Pool({...})`-instanser i backend hadde ingen error-handler (kun shared-pool og 4 andre hadde basic handler)
- Even basic handler logget alle errors som ERROR — som triggerer Sentry-alerts på forventet Postgres-vedlikehold

**Fix:**
1. Ny modul `apps/backend/src/util/pgPoolErrorHandler.ts`:
   - `attachPoolErrorHandler(pool, { poolName })` — installerer error-handler som logger 57P01/57P02/57P03 som WARN (forventet), 08001/08006/ECONNxxx som WARN (transient), uventede som ERROR
   - `isTransientConnectionError(err)` — predikat for retry-decisions
   - `withDbRetry(op, { operationName })` — `withRetry`-wrapper med transient-error-predikat og 3-forsøk-backoff [100/250/500ms]
2. `sharedPool.ts` — strukturert handler via `attachPoolErrorHandler`
3. Alle 41 standalone-pool-fallback-paths i services oppdatert med `attachPoolErrorHandler` (PostgresWalletAdapter, PostgresBingoSystemAdapter, PostgresResponsibleGamingStore + 38 service-fallbacks)
4. Heartbeat-route (`/api/agent/game1/master/heartbeat`) wrappet i `withDbRetry`

**Prevention:**
- ALLE nye `new Pool({...})` MÅ kalle `attachPoolErrorHandler` direkte etter (eller bruke `createServicePool` factory i `pgPool.ts`)
- Bruk `withDbRetry` for kritiske LESE-paths (heartbeat, room-state-fetch, lobby-aggregator)
- IKKE bruk `withDbRetry` på write-paths uten outbox-mønster (wallet/compliance har egne outbox-mekanismer — BIN-761→764)
- Manuell chaos-test (kjørt 2026-05-14):
  ```bash
  # Start backend, terminer connections, verifiser at backend overlever:
  psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
            WHERE application_name LIKE 'spillorama%';"
  curl http://localhost:4000/health  # skal returnere 200
  ```

**Related:**
- Sentry-issue SPILLORAMA-BACKEND-5 (2026-05-14)
- PR `fix/backend-pg-pool-resilience-2026-05-14`
- `apps/backend/src/util/pgPoolErrorHandler.ts` (ny modul)
- `apps/backend/src/util/__tests__/pgPoolErrorHandler.test.ts` (27 tester)
- Tests dekker: handler-idempotens, 57P01/57P02/57P03 = WARN, 08006/ECONNxxx = WARN, uventede = ERROR, ingen kaster, retry-flow med backoff
- Skill `wallet-outbox-pattern` (informert om at pool-failure ikke compromitterer wallet-mutasjoner)

---

## Hvordan legge til ny entry

```markdown
### §X.Y — Kort tittel som beskriver fallgruven

**Severity:** P0 / P1 / P2 / P3
**Oppdaget:** YYYY-MM-DD (kontekst, eks "PR #1234 review")
**Symptom:** Hva ser man når feilen treffer
**Root cause:** Hvorfor det skjer (teknisk, ikke "noe gikk galt")
**Fix:** Konkret hva som ble gjort (eller bør gjøres)
**Prevention:** Hvordan unngå at det skjer igjen
**Related:**
- Lenker til relevante PR-er, ADR-er, docs, file:line
```

**Plassering:** Velg riktig kategori-§. Hvis du ikke finner passende kategori, lag ny seksjon nederst og oppdater Indeks.

---

## Relaterte dokumenter

- [`PM_ONBOARDING_PLAYBOOK.md`](./PM_ONBOARDING_PLAYBOOK.md) — full PM-rutine, §3.2 peker hit
- [`AGENT_EXECUTION_LOG.md`](./AGENT_EXECUTION_LOG.md) — kronologisk agent-arbeid
- `AGENT_PROMPT_GUIDELINES.md` — mal for agent-prompts (TODO — fil ikke opprettet enda)
- [`ENGINEERING_WORKFLOW.md`](./ENGINEERING_WORKFLOW.md) — branch + PR + Done-policy
- [`docs/adr/`](../adr/) — Architecture Decision Records
- [`CLAUDE.md`](../../CLAUDE.md) — repo-root project conventions

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-10 | Initial — 63 entries fra 12 PM-handoffs + audits + sesjons-erfaringer | PM-AI (Claude Opus 4.7) |
| 2026-05-10 | Lagt til §7.8 (JackpotConfirmModal var feil mental modell — fjernet ADR-0017). Indeks-counts korrigert mot faktiske tall (§7=8, §11=7, total=71). | docs-agent (ADR-0017 PR-C) |
| 2026-05-11 | Lagt til §7.9 (state.ticketTypes override), §7.10 (static bundle rebuild), §7.11 (lobby-init race), §7.12 (overlay pointer-events). §9.5 (demo-plan opening hours), §9.6 (ON CONFLICT uten UNIQUE). §11.8 (dev:nuke single-command), §11.9 (worktree-branch-leakage), §11.10 (pre-commit COMMIT_EDITMSG-bug). Total 71→79 entries. | PM-AI (sesjon 2026-05-10→2026-05-11) | docs-agent (ADR-0017 PR-C) |
| 2026-05-12 | Lagt til §7.15 — klient sendte `bet:arm` før scheduled-game var spawnet (armed tickets foreldreløse). Pilot-blokker fra Tobias-test 11:03-11:05, fikset via Alternativ B (klient venter med kjøp). | Agent B (Klient wait-on-master) |
| 2026-05-14 | Lagt til §12 (DB-resilience) + §12.1 (pg-pool uten error-handler krasjer backend på 57P01). Root cause for Sentry SPILLORAMA-BACKEND-5. Pilot-blokker. 94 entries totalt. | Agent T (pg-pool resilience) |
| 2026-05-13 | Lagt til §11.11 (ESM dispatcher må gates med isDirectInvocation), §11.12 (JSDoc `**` parse-feil), §11.13 (GitHub Actions YAML heredoc indentation). Funn under PM Push-Control Phase 2-bygg. Total 83→86 entries. | Phase 2-agent (PM-AI orkestrert) |
| 2026-05-13 | Lagt til §5.9 (cascade-rebase pattern), §5.10 (add/add `-X ours`-strategi), §6.15 (SIGPIPE + pipefail i awk-pipe), §6.16 (npm workspace lock isolation), §9.9 (seed-FK ordering), §11.14 (≥10 parallelle agenter stream-timeout), §11.15 (additive-merge Python-resolver), §11.16 (worktree fork-from-wrong-branch cascade). Funn under Wave 2/3-sesjon 2026-05-13. Total 86→92 entries. | PM-AI (E6 redo) |
| 2026-05-14 | Utvidet §3.11 (PR #1411 sub-bug PR #1408): la til Fase 2-prevention-bullet for `buildVariantConfigFromSpill1Config` som mapper `priceNok / minPriceNok` til per-farge multipliers i `gameVariant.ticketTypes`. PR #1408's hook setter entryFee men IKKE multipliers — derfor komplementær fix. 7 nye tester i `spill1VariantMapper.test.ts`. | Fix-agent F3 |
| 2026-05-14 | Lagt til §7.19 — "Forbereder rommet..."-spinner henger evig etter runde-end. Tobias-rapport 2026-05-14 09:54 (runde 330597ef). Fix: `MAX_PREPARING_ROOM_MS = 15s`-max-timeout i `Game1EndOfRoundOverlay` med forced auto-return via `onBackToLobby`. Erstatter eldre 30s "Venter på master"-tekst-swap som ikke utløste redirect. | Fix-agent (auto-return) |
| 2026-05-14 | Lagt til §7.24 — premie-celle-størrelse iterasjon V (Tobias-direktiv etter første PR #1442-runde: "smalere, så det matcher mer bilde, ikke tar så mye plass"). Reduserte `.premie-row` padding 6px 10px→3px 8px, `gap` 5px→3px, `.premie-cell` padding 4px 8px→2px 6px. Resultat: rad-høyde ≈ 16-18 px (samme footprint som dagens enkelt-pill). Utvidet `premie-design.html` til å vise hele center-top-mockupen (LeftInfoPanel + mini-grid + premietabell + action-panel) for layout-vurdering i kontekst. | Agent V (CSS-iterasjon) |
| 2026-05-14 | Lagt til §6.18 — Synthetic bingo-test må kjøres FØR pilot. Tobias-direktiv 2026-05-14: "Vi trenger ALLEREDE NÅ et synthetic end-to-end-test". Bot driver én komplett bingo-runde, verifiserer 6 invarianter (I1-I6). R4-precursor (BIN-817). | synthetic-test-agent |
| 2026-05-15 | Lagt til §7.21 — Master-header "Neste spill: {name}" for ALLE pre-running-states (Tobias-direktiv IMMUTABLE). To uavhengige bugs: (1) frontend mapping hadde "Klar til å starte" / "Runde ferdig" som mellom-tekster, fjernet — alle pre-running-states gir "Neste spill: {name}". (2) Backend aggregator returnerte `planMeta=null` når plan-run manglet → `catalogDisplayName=null` → header uten navn. Fix: ny `GamePlanRunService.findActivePlanForDay`-helper kalles av aggregator i idle-state. Frontend 41 tester (3 nye trip-wires); backend 26 tester (2 nye for catalogDisplayName uten plan-run). PR `fix/master-header-text-and-catalog-name-2026-05-15`. §7.20 oppdatert med peker. | Fix-agent (Tobias 2026-05-15 live-test) |
| 2026-05-15 | Lagt til §7.26 — Lobby-broadcast manglet etter natural round-end (P0 pilot-blokker). 4 state-flipp-paths (Game1DrawEngineService.drawNext POST-commit, GamePlanRunService.finish/advanceToNext-past-end, GamePlanRunCleanupService.reconcileNaturalEnd) trigget IKKE socket-push til spiller-shell — klient måtte vente på 10s-poll. Fix: best-effort fire-and-forget broadcaster wired på alle 4 paths + frontend "Forbereder neste spill"-loader + 10s→3s poll reduction. 37 nye tester. | Fix-agent (lobby-broadcast on natural round-end) |
| 2026-05-15 | Lagt til §7.27 — PauseOverlay vist feilaktig etter natural round-end (P0 pilot-blokker). Spill 1 auto-pauser etter hver phase-won (Tobias-direktiv 2026-04-27), og `paused`-flagget i `app_game1_game_state` resettes ikke alltid før status flippes til 'completed'. Snapshot speiler `paused` til klient-`isPaused`, så klient så `gameStatus=ENDED && isPaused=true` → PauseOverlay viste seg feilaktig. Fix: klient-side gate `state.isPaused && state.gameStatus === "RUNNING"` i `Game1Controller.onStateChanged`. Defense-in-depth selv om backend en gang i fremtiden rydder paused-flagget — gate-en er kontrakten med spillerne. Kanonisk spec: SPILL1_IMPLEMENTATION_STATUS §5.8. 11 pure-funksjons-tester i `Game1Controller.pauseOverlayGating.test.ts`. | Fix-agent (post-round-flyt §5.8) |
| 2026-05-15 | Lagt til §7.30 — Triple-bong-rendering cross-color grouping bug (P0 pilot-blokker — visuell regresjon på master-flyt). PR #1500 (Bølge 2) introduserte purchaseId + sequenceInPurchase men hadde 3 lag med bugs: (A) pre-runde display-tickets manglet purchaseId helt → frontend grupperte tilfeldige tickets, (B) backend `ensureAssignmentsForPurchases` iterated `count` ganger uavhengig av `spec.size` så 1 Stor (= 3 brett) ble bare 1 row, (C) cross-color cart delte samme purchaseId så `tryGroupTriplet` grupperte forskjellige farger sammen. Fix: 3 lag løst — frontend color-family-validation, backend `LARGE_TICKET_BRETT_COUNT=3`-multiplier, og syntetisk bundle-id-generering i `getOrCreateDisplayTickets`. Tobias' eksakte scenario (1H+1G+1L Stor = 3 triplets) nå dekket av test. | Fix-agent (Tobias 2026-05-15 triple-rendering screenshot) |
| 2026-05-16 | Lagt til §7.32 — Top-HUD-kontroller må være i samme bordered wrapper. Firkløver/lykketall flyttet inn i `top-group-wrapper` som første kolonne med border-right og mockup-sync i `premie-design.html`. Total 111→112 entries. | PM-AI (Spill 1 top-HUD lykketall-kolonne) |
| 2026-05-16 | Oppdatert §7.32 — Iter 2: "Neste spill"-status flyttet inn som `next-game-status-column`, CenterBall idle-text skjules i ikke-running-state, og rekkefølgen er nå status → player-info → lykketall → CenterTopPanel. | PM-AI (Spill 1 top-HUD status-kolonne) |
| 2026-05-16 | Lagt til §7.33 — Bong-grid spacing skal eies av 6-kolonne parent-grid med `gap: 16px`; triplets spenner 3 kolonner og `.bong-triplet-sub` har ingen ekstra side-padding. Total 112→113 entries. | PM-AI (Spill 1 bong-grid spacing) |
| 2026-05-16 | Lagt til §7.34 — Triple-bong × må sende første sub-ticket-id til `ticket:cancel`, ikke synthetic `purchaseId`. Total 113→114 entries. | PM-AI (Spill 1 triplet cancel-kontrakt) |
| 2026-05-16 | Lagt til §7.35 — Action-panel-plassering er top-wrapper-kontrakt: `CenterTopPanel.actionRootEl` re-parentes etter `next-game-status-column`, `Innsats` er nowrap, og top-HUD sentreres som ett element. Total 114→115 entries. | PM-AI (Spill 1 top-HUD action-kolonne) |
| 2026-05-16 | Lagt til §7.36 — Triple sub-bong header-border må skjules som hel `.ticket-header`, og sub-front må override `padding/shadow/radius` via stabile `.ticket-face-front` hooks. Total 115→116 entries. | PM-AI (Spill 1 triplet sub-layout) |
| 2026-05-16 | Oppdatert §7.36 — Triple-wrapper sidepadding justert til `9px 1px 3px 1px`; wrapper-header eier nå inset med `margin: 0px 18px` og `gap: 14px`. | PM-AI (Spill 1 triplet header-inset) |
| 2026-05-16 | Oppdatert §7.36 — Triple-header bruker `justify-content:flex-start`; pris ligger nær navn, mens × pushes helt til høyre med `margin-left:auto`. `bong-design.html` synket med prod. | PM-AI (Spill 1 triplet header left-group) |
| 2026-05-16 | Lagt til §7.37 — Elvis-banner insertion må targete `.ticket-body`, ikke nested `.ticket-grid`, etter §5.9 body-wrapper-refaktor. Total 116→117 entries. | PM-AI (Spill 1 Elvis loadTicket hardening) |
| 2026-05-16 | Oppdatert §7.36 — Triple-wrapper spacing justert til `padding: 9px 17px 8px 17px`, header `margin: 0px 2px`, `.bong-triplet-grids gap: 11px` og `margin-top: 10px`. | PM-AI (Spill 1 triplet spacing) |
| 2026-05-16 | Lagt til §2.11, §3.18, §6.21, §6.22, §6.23 fra GoH full-plan 4 haller x 20 spillere: wallet-topup ledger-risk, natural-end mid-plan finish, final `finished` runner-state, stale RG-ledger og scheduled `ticket:mark` `GAME_NOT_RUNNING`. | PM-AI (GoH full-plan test) |
| 2026-05-15 | Lagt til §8.8 — PM Knowledge Continuity v2: evidence pack + self-test-gate for å bevise operativ kunnskapsparitet, ikke bare at dokumenter finnes. Total 103→104 entries. | PM-AI (knowledge-continuity-hardening) |
| 2026-05-15 | Lagt til §5.15 — required checks må ikke ha PR path-filter som gjør check-context missing. Funnet da auto-doc PR #1532 ble blokkert av forventet `pitfalls-id-validation`. Total 104→105 entries. | PM-AI (post-merge CI watcher) |
| 2026-05-15 | Lagt til §11.18 — implementation-agent uten forensic evidence etter gjentatt live-test-feil. Standardisert `scripts/purchase-open-forensics.sh` før B.1/B.2/B.3 velges. Total 106→107 entries. | PM-AI (purchase_open handoff-hardening) |
| 2026-05-15 | Lagt til §11.19 — high-risk agent-prompt som fritekst gir misforstått scope. Standardisert `npm run agent:contract` før implementation-agent. Total 107→108 entries. | PM-AI (agent-contract-hardening) |
| 2026-05-16 | Lagt til §11.20 (agent-contract uten skill-SHA-lockfile mister reproduserbarhet) + §11.21 (evidence-pack i /tmp overlever ikke audit). Fase 2-follow-up av ADR-0024: skill-SHA-lockfile + persistent evidence i `docs/evidence/<contract-id>/`. Total 108→110 entries. | PM-AI (Fase 2 — skill-lockfile + evidence-persistence) |
| 2026-05-16 | Lagt til §11.22 (Agent Delivery Report fritekst aksepteres uten teknisk validering). Fase 3 Punkt 1-follow-up av ADR-0024: ny `scripts/validate-delivery-report.mjs` (32 tester) + `delivery-report-gate.yml` workflow som blokkerer high-risk PR-er uten gyldig 8-seksjon-rapport med §5 cross-check mot diff. Total 110→111 entries. | PM-AI (Fase 3 P1 — delivery-report-gate) |
| 2026-05-15 | Lagt til §3.17 — purchase_open-vinduet ble hoppet over fordi plan-runtime opprettet `ready_to_start` og master-start kalte engine i samme request. Total 108→109 entries. | PM-AI (purchase_open P0 fix) |
| 2026-05-15 | Lagt til §6.19 — E2E plan-run-reset må bruke appens Oslo business-date, ikke Postgres `CURRENT_DATE`, ellers lekker plan-posisjon 7/jackpot-state i CI rundt norsk midnatt. Total 109→110 entries. | PM-AI (purchase_open CI follow-up) |
| 2026-05-15 | Lagt til §6.20 — Pilot-flow Rad-vinst-test må drive scheduled draws eksplisitt fordi CI kjører med `JOBS_ENABLED=false`; ikke slå på scheduler-jobs for å få testen grønn. Total 110→111 entries. | PM-AI (purchase_open CI follow-up 2) |
| 2026-05-16 | Lagt til §11.23 — live-test må ha frozen Sentry/PostHog snapshot før/etter, ellers blir agent-evidence muntlig og ureviderbar. Ny `npm run observability:snapshot`. | PM-AI (observability snapshot runner) |
| 2026-05-16 | Lagt til §11.24 — PM self-test fritekst-svar uten konkret pack-anker. Fase 3 P3-follow-up av ADR-0024: per-spørsmål-heuristikk i `scripts/pm-knowledge-continuity.mjs` med 12 konkrete anker-regex + fluff-reject + `[self-test-bypass:]`-marker. 55 tester. Etablerer meta-pattern (paraphrase-validation med per-felt-anker) — nå brukt i 3 gates. Ny doc: `docs/engineering/PM_SELF_TEST_HEURISTICS.md`. | PM-AI (Fase 3 P3 — self-test heuristikk) |
| 2026-05-16 | Lagt til §11.25 — Agent-contract bygd men ikke adoptert i daglig flyt (0/35 high-risk spawns). Fase A av ADR-0024 layered defense: pre-spawn agent-contract-gate (shadow-mode 2026-05-16 → 2026-05-23, hard-fail tidligst 2026-05-24) + bypass-telemetri-script + ukentlig cron. Validerer `Contract-ID:` + `Contract-path:` for high-risk PR-er, eller `[agent-contract-not-applicable:]` bypass. 29 + 26 tester. | PM-AI (Fase A — pre-spawn evidence gate) |
| 2026-05-17 | Lagt til §11.26 — Worktree+stash baggage akkumulerer (400 worktrees / 178 stashes). Fase B av ADR-0024 follow-up: cleanup-scripts med safety-verdict per item, DRY-RUN BY DEFAULT, `--apply` for interaktiv sletting. Worktree-script identifiserer SAFE/LOCKED-S/ORPHANED/UNSAFE_*/CURRENT/MAIN. Stash-script kategoriserer AUTO-BACKUP/AGENT-LEFTOVER/MERGED-BRANCH/FRESH/EXPLICIT-KEEP/UNCLEAR. Bash 3.2-kompatibel. | PM-AI (Fase B — lokal cleanup-scripts) |
| 2026-05-16 | Lagt til §4.8 og §6.24 fra GoH 4x80 full-plan test: Sentry N+1 på master advance/resume ble fikset med catalog batch-load, og full-plan runner ble gjort skala-dynamisk for 80 spillere per hall. | PM-AI (GoH 4x80 load-test + observability) |
| 2026-05-17 | Oppdatert §6.23 fra ÅPEN til LØST: scheduled Spill 1 `ticket:mark` bruker nå DB-backed scheduled validator med cache før legacy `BingoEngine` fallback. Dokumenterer anti-mønsteret "server-side completion ≠ frisk live player socket-flow". | PM-AI (scheduled ticket:mark P1 fix) |
| 2026-05-16 | Lagt til §9.10 — Render External Database URL er full-access, ikke read-only. Opprettet `spillorama_pm_readonly` og koblet observability-runner til `postgres-readonly.env`. | PM-AI (DB observability read-only role) |
| 2026-05-16 | Lagt til §7.38 — BuyPopup-design må separere test-låst DOM-kontrakt fra visuell mockup. Header én linje, `Du kjøper` nederst i ticket-wrapper, no-scroll-verifisering i visual-harness. Total 117→118 entries. | PM-AI (BuyPopup design parity) |
| 2026-05-16 | Lagt til §7.39 — Ticket-grid top-gap må måles fra faktisk top-HUD, ikke hardkodes. `PlayScreen` plasserer nå bongene `16px` under målt `top-group-wrapper`-bunn og reposerer etter status/endring. Total 118→119 entries. | PM-AI (Spill 1 bong vertical spacing) |
