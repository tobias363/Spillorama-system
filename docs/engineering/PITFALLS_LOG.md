# Spillorama Pitfalls Log — kumulativ fallgruve-katalog

**Status:** Autoritativ. Alle fallgruver oppdaget i prosjektet samles her.
**Sist oppdatert:** 2026-05-14
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
| [§1 Compliance & Regulatorisk](#1-compliance--regulatorisk) | 8 | 2026-05-10 |
| [§2 Wallet & Pengeflyt](#2-wallet--pengeflyt) | 9 | 2026-05-14 |
| [§3 Spill 1, 2, 3 arkitektur](#3-spill-1-2-3-arkitektur) | 9 | 2026-05-10 |
| [§4 Live-rom-state](#4-live-rom-state) | 7 | 2026-05-10 |
| [§5 Git & PR-flyt](#5-git--pr-flyt) | 10 | 2026-05-13 |
| [§6 Test-infrastruktur](#6-test-infrastruktur) | 17 | 2026-05-14 |
| [§7 Frontend / Game-client](#7-frontend--game-client) | 23 | 2026-05-14 |
| [§8 Doc-disiplin](#8-doc-disiplin) | 6 | 2026-05-13 |
| [§9 Konfigurasjon / Environment](#9-konfigurasjon--environment) | 9 | 2026-05-13 |
| [§10 Routing & Permissions](#10-routing--permissions) | 3 | 2026-05-10 |
| [§11 Agent-orkestrering](#11-agent-orkestrering) | 16 | 2026-05-13 |
| [§12 DB-resilience](#12-db-resilience) | 1 | 2026-05-14 |

**Total:** 96 entries (per 2026-05-14)

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

---

## §3 Spill 1, 2, 3 arkitektur

### §3.1 — KRITISK: Spill 1, 2, 3 har FUNDAMENTALT forskjellige arkitekturer

**Severity:** P0 (antakelser overføres feil → bryter implementasjon)
**Oppdaget:** Tobias-direktiv 2026-05-08
**Symptom:** Agent prøver å bruke perpetual-loop-pattern på Spill 1, eller master-rolle på Spill 2/3
**Root cause:** Tre forskjellige grunn-arkitekturer:
- **Spill 1** (`bingo`): per-hall lobby + GoH-master-rom + plan-runtime + scheduled-games
- **Spill 2** (`rocket`): ETT globalt rom + perpetual loop + auto-tick
- **Spill 3** (`monsterbingo`): ETT globalt rom + perpetual loop + sequential phase-state-machine
**Prevention:**
- Les FØRST `SPILL[1-3]_IMPLEMENTATION_STATUS_2026-05-08.md` for spillet du jobber med
- Aldri kopier antakelser fra ett spill til et annet
- Hvis koden krangler mot doc-en: doc-en vinner, fix koden
**Related:**
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

### §6.5 — `.crdownload`-filer i wireframe-katalog

**Severity:** P3 (data-tap)
**Oppdaget:** 2026-04-23
**Symptom:** Wireframes i `docs/wireframes/` med `.crdownload`-suffiks → ufullstendige filer
**Fix:** Re-last fra Tobias' originale kilde
**Prevention:** Sjekk filstørrelse / PDF-validity før commit

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
**Root cause:** `BingoEngine.drawNextNumber` kaster `USE_SCHEDULED_API` for scheduled Spill 1 (slug=bingo). Det finnes ingen public/admin REST-endpoint som wrapper `Game1DrawEngineService.drawNext(scheduledGameId)`. Eneste vei til scheduled draws er:
1. Auto-tick (cron, 4s interval per `Game1AutoDrawTickService.defaultSeconds`)
2. Socket-event `draw:next` (krever socket-connection)

**Konsekvens for tester:** Kan ikke akselerere draws. Må vente på auto-tick — minimum ~100s for 25 draws.

**Fix-forslag (post-pilot):** Legg til `POST /api/admin/game1/games/:gameId/draw-next` (krever GAME1_MASTER_WRITE) som wrapper `Game1DrawEngineService.drawNext`. Gir oss kontroll over draws fra tester + admin-UI for debug.

**Prevention:** Test-design: bruk tids-basert polling (`while (Date.now() - start < timeout)`), ikke antall-basert (`for (i = 0 to N)`). Test-timeout 5min er nok for full Rad 1→Rad 2-flyt.

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

### §6.17 — Manuelle SQL-queries for runde-debug er sløsete; bruk Round-replay-API

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

### §7.4 — Browser-debugging via chrome-devtools-mcp, IKKE computer-use

**Severity:** P2 (workflow)
**Oppdaget:** 2026-04 (memory: debug_preference.md)
**Prevention:** Bruk `chrome-devtools-mcp` for console logs, screenshots, JS eval, network. Aldri computer-use for browser-tasks.

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
- `apps/admin-web/tests/masterHeaderText.test.ts` (35 tester, inkl. regression-trip-wire)
- `packages/shared-types/src/spill1-lobby-state.ts` (Spill1ScheduledGameStatus enum)
- PR #1422 (plan-completed-state — kommer som ny inconsistencyWarning senere)
- §4 (live-rom-robusthet — master-UX er pilot-blokker)
- Tobias-direktiv 2026-05-14 (rapportert 3 ganger — derfor kritisk)

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

### §7.23 — Bruk frontend-state-dump FØR du gjetter hvor frontend leser fra

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
