---
name: pengespillforskriften-compliance
description: When the user/agent works with pengespillforskriften compliance, prize caps, organisation distribution (§11), mandatory pause (§66), or daily reporting (§71) in the Spillorama bingo platform. Also use when they mention compliance-ledger, ComplianceLedger, AuditLogService, PrizePolicyPort, applySinglePrizeCap, ResponsibleGamingStore, ResponsibleGamingPersistence, ledgerGameTypeForSlug, gameType, MAIN_GAME, DATABINGO, §11, §66, §71, pengespillforskriften, Lotteritilsynet, 15%, 30%, organisasjon, distribusjon, single-prize-cap, payout cap, Hovedspill, Databingo, SpinnGo, hall main game, internet main game, actor_hall_id, app_regulatory_ledger, daily-anchor, verifyAuditChain, ADR-0015. Spillorama is regulated under Norwegian pengespillforskriften and any change touching prize calculation, ledger writes, gameType decisions, or ResponsibleGaming state must respect §11/§66/§71. Make sure to use this skill whenever someone touches compliance-ledger, prize-calculation, single-prize-cap logic, or ResponsibleGaming state — even if they don't explicitly mention regulations, because regulatory bugs are pilot-blockers and Lotteritilsynet-revisjon-risk.
metadata:
  version: 1.1.0
  project: spillorama
---

<!-- scope: apps/backend/src/compliance/**, apps/backend/src/spillevett/**, apps/backend/src/game/ComplianceLedger*, apps/backend/src/game/PrizePolicyManager.ts, apps/backend/src/game/ledgerGameTypeForSlug.ts, apps/backend/src/game/ResponsibleGamingPersistence.ts, apps/backend/src/game/PostgresResponsibleGamingStore.ts, apps/backend/src/adapters/PrizePolicyPort.ts, apps/backend/src/adapters/ComplianceLedgerPort.ts, apps/backend/src/adapters/ComplianceLossPort.ts -->

# Pengespillforskriften Compliance

Spillorama is a regulated Norwegian bingo platform under **pengespillforskriften** (the Norwegian Gambling Act). Three sections directly govern code we write:

- **§11** — minimum surplus distribution to organisations: 15% Hovedspill, 30% Databingo
- **§66** — mandatory 5-minute pause after 60 minutes of continuous play
- **§71** — daily reporting to Lotteritilsynet (per-hall + per-channel aggregates)

A regulatory bug is a **pilot-blocker** and an audit risk. Treat compliance code with the same care as wallet code.

## Kontekst (read first)

These docs are the single source of truth — never duplicate their content into code comments or other docs. Always link back:

- `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` — kanonisk regel-spec (§4 cap, §9 multi-vinner pot-split, §11 ledger-felter)
- `docs/architecture/SPILLKATALOG.md` — gameType-mapping (Hovedspill vs Databingo) per slug
- `docs/architecture/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md` — Spillorama owns Spill 1-3 + SpinnGo; Candy is third-party with shared wallet only
- `docs/compliance/RNG_OG_BALLTREKNING_GJENNOMGANG_2026-04-09.md` — RNG-justification (no external cert needed for in-house draws)
- `docs/compliance/SPILLVETT_HANDOVER_CHECKLIST_2026-04-11.md` — Spillvett (responsible gaming) UI/backend split
- `docs/compliance/SPILL1_GAMETYPE_INVESTIGATION_2026-04-25.md` — historical bug-hunt that established the Spill 1-3 = MAIN_GAME / SpinnGo = DATABINGO mapping

## Kjerne-arkitektur

### gameType-decision is single-sourced

`apps/backend/src/game/ledgerGameTypeForSlug.ts` is the **only** place that maps a game-slug to its regulatory `gameType`. Always call it; never hardcode `"MAIN_GAME"` or `"DATABINGO"` at a callsite.

```
bingo, rocket, monsterbingo                    → MAIN_GAME    (15% min to orgs)
spillorama (= SpinnGo / "Spill 4" marketing)   → DATABINGO    (30% min to orgs)
candy                                          → external (no Spillorama ledger entry)
```

The 13 catalog-variants of `bingo` (oddsen-55, trafikklys, jackpot, etc.) ALL map to `MAIN_GAME` — variant ≠ gameType.

### Single-prize-cap (2500 kr) applies ONLY to databingo

`apps/backend/src/adapters/PrizePolicyPort.ts` — `applySinglePrizeCap` enforces the 2500 kr cap **only when `gameType === "DATABINGO"`**. Hovedspill (Spill 1-3) has NO cap — a lilla-bong on Innsatsen Fullt Hus legitimately pays 3000 kr+, an Oddsen HIGH-bucket pays 4500 kr.

If you find cap-code firing on a `MAIN_GAME` slug, that is a regulatory bug — `SPILL_REGLER_OG_PAYOUT.md` §3.4 is explicit.

### §11 distribution is ledger-driven

`ComplianceLedger` writes one row per stake/prize/refund. The §11-percentage is computed downstream from `app_rg_compliance_ledger.game_type`:
- `MAIN_GAME` → 15% to organisations
- `DATABINGO` → 30% to organisations

Quarterly distribution (`docs/architecture/QUARTERLY_ORG_DISTRIBUTION_DESIGN_2026-04-25.md`) aggregates the ledger and produces Lotteritilsynet-formatted reports.

### actor_hall_id binding (BIN-PR #443 multi-hall fix)

For multi-hall games (GoH-runs), the ledger MUST bind the entry to **the buying hall**, not the master hall. Earlier code bound everything to `run.hall_id` (master), which broke per-hall §71 reports when Notodden bought tickets in a Årnes-mastered round.

Always pass `actor_hall_id` (the hall where the ticket was sold) into `Game1TicketPurchaseService`, `Game1PayoutService`, mini-game payout, and pot-evaluator — they all forward it to the ledger entry.

### §66 mandatory pause

`apps/backend/src/game/ResponsibleGamingPersistence.ts` tracks `play_session_started_at` and triggers a forced 5-min pause after 60 min of continuous play. Configurable via `BINGO_PLAY_SESSION_LIMIT_MS` and `BINGO_PAUSE_DURATION_MS` envs (defaults: 60min/5min). The web shell in `backend/public/web/spillvett.js` reads this state via `GET /api/wallet/me/compliance` and `complianceAllowsPlay()` blocks game-launch when paused.

### §71 daily reports — separate regulatory-ledger (ADR-0015, 2026-05-09)

**Update 2026-05-09 (ADR-0015):** §71-rapportering har fått sin egen **separate tabell** `app_regulatory_ledger` med dedikert hash-chain (`prev_hash → curr_hash`) og daily-anchor cron som "freezer" gårsdagens rapport.

**Hvorfor egen tabell:** Lotteritilsynet krever immutable per-dag rapport som kan re-deriveres fra raw events. `app_compliance_audit_log` er for generelle audit-events (eks. RBAC, login). §71 trenger en dedikert kanal for å sikre at hash-chain ikke kompromiseres av andre event-typer.

**Implementasjon:**
- Skriving via `AuditLogService.recordRegulatoryEvent()` — separat metode
- Daglig "anchor"-cron som beregner dagens `daily_hash` og signerer
- `verifyAuditChain()` i `apps/backend/src/compliance/verifyAuditChain.ts` — verifiserer hash-chain integritet

**Status 2026-05-13:** Implementasjon i flight per ADR-0015. Verifisering pending.

## Immutable beslutninger

These are NOT up for re-discussion in normal feature work. Changing them requires a Tobias decision documented in the relevant architecture-doc:

1. **Spill 1, 2, 3 are Hovedspill (15% to orgs).** Variant doesn't matter — Trafikklys, Oddsen, Jackpot are still Hovedspill.
2. **SpinnGo (slug `spillorama`, marketing "Spill 4") is Databingo (30% to orgs).** Marketing-name "Spill 4" maps to code-name `game5` historically.
3. **2500 kr single-prize cap applies ONLY to Databingo.** Hovedspill has no cap.
4. **In-house RNG, no external cert.** `docs/compliance/RNG_OG_BALLTREKNING_GJENNOMGANG_2026-04-09.md` documents why we don't need third-party RNG-cert under Norwegian rules.
5. **Fail-closed on Spillvett.** If `GET /api/wallet/me/compliance` errors or returns `restrictions.isBlocked=true`, the shell MUST disable game-launch buttons.
6. **Hash-chain audit-trail is append-only.** Never mutate `app_audit_log` or `app_rg_compliance_ledger` rows after insert. Corrections are new rows referencing the original.
7. **Game 4 (`themebingo`/`game4`) is deprecated** (BIN-496, 2026-04-17). Don't use the slug for new code.

## Vanlige feil og hvordan unngå dem

1. **"All bingo has a 2500 kr cap."** Wrong — only databingo. Verify by reading `PrizePolicyPort.applySinglePrizeCap` and the gameType branch.
2. **Hardcoding `gameType: "DATABINGO"` in all ComplianceLedger calls.** This was the bug audited in `SPILL1_GAMETYPE_INVESTIGATION_2026-04-25.md`. Always go through `ledgerGameTypeForSlug(slug)`.
3. **Binding ledger entries to master_hall_id for multi-hall games.** Use `actor_hall_id` (= the hall that sold the ticket). Test with PR #443's multi-hall fixture.
4. **Treating Spill 4 / `game5` / SpinnGo as Hovedspill.** It's Databingo. The 30%-rule applies, plus the 2500 kr cap.
5. **Skipping ResponsibleGaming check on a "convenience" route.** Every route that lets a player stake or commit to a game MUST pass through `complianceAllowsPlay()` (frontend) AND the backend Spillvett guard. No exceptions for "test" or "admin override" without a `PLAYER_KYC_OVERRIDE`-style audit-event.
6. **Mutating audit/ledger rows in-place to "fix" a bug.** Always insert a correction row. Hash-chain integrity depends on immutability.
7. **Trafikklys/Oddsen multipliers wrong.** Trafikklys has `prize_multiplier_mode = "explicit_per_color"` (no auto-mult). Oddsen overrides ONLY the Fullt Hus path (low/high split based on `targetDraw`). Rad 1-4 in Oddsen still use auto-mult. See `SPILL_REGLER_OG_PAYOUT.md` §5-6.

## Kanonisk referanse

- Regel-spec: `docs/architecture/SPILL_REGLER_OG_PAYOUT.md` (read §3 auto-mult, §4 cap, §9 multi-winner, §11 ledger-fields)
- Per-spill detalj: `docs/architecture/SPILL_DETALJER_PER_SPILL.md`
- gameType-mapping: `apps/backend/src/game/ledgerGameTypeForSlug.ts` (and tests)
- Cap enforcement: `apps/backend/src/adapters/PrizePolicyPort.ts` (`applySinglePrizeCap`)
- Audit trail: `apps/backend/src/compliance/AuditLogService.ts`
- Spillvett: `apps/backend/src/game/ResponsibleGamingPersistence.ts` + frontend `backend/public/web/spillvett.js`
- Quarterly reports: `docs/architecture/QUARTERLY_ORG_DISTRIBUTION_DESIGN_2026-04-25.md`

## Når denne skill-en er aktiv

LOAD when:
- Editing prize calculation, payout, single-prize-cap, or auto-multiplier code
- Writing/modifying ComplianceLedger or AuditLogService entries
- Touching ResponsibleGamingStore, ResponsibleGamingPersistence, mandatory pause, self-exclusion
- Implementing or updating §71 reporting / quarterly distribution
- Adding a new game slug or new variant (need to decide gameType)
- Reviewing PRs that touch wallet → ledger flow
- Investigating a "wrong amount paid" or "wrong distribution" bug

SKIP when:
- Pure UI/CSS work that doesn't touch payout amounts or compliance state
- Game catalog admin CRUD (no payout side-effects)
- Test infrastructure that doesn't assert compliance invariants

## Relaterte ADR-er

- [ADR-0003 — System-actor for engine-mutasjoner](../../../docs/adr/0003-system-actor.md) — `actor_hall_id` binder til kjøpe-hall, ikke master-hall (BIN-661 fix)
- [ADR-0004 — Hash-chain audit-trail (BIN-764)](../../../docs/adr/0004-hash-chain-audit.md) — Lotteritilsynet-paritet: ondsinnet redigering oppdages
- [ADR-0008 — Spillkatalog-paritet (MAIN_GAME vs DATABINGO)](../../../docs/adr/0008-spillkatalog-classification.md) — bindende: §11-distribusjon 15% vs 30%
- [ADR-0010 — Done-policy for legacy-avkobling](../../../docs/adr/0010-done-policy-legacy-avkobling.md) — regulatorisk forsvar: Lotteritilsynet kan kreve commit-bevis
- [ADR-0015 — §71 regulatory-ledger (separate audit-tabell)](../../../docs/adr/0015-spill71-regulatory-ledger.md) — vedtatt 2026-05-09: §71-rapportering har egen tabell `app_regulatory_ledger` med daily-anchor
- [ADR-0017 — Fjerne daglig jackpot-akkumulering](../../../docs/adr/0017-remove-daily-jackpot-accumulation.md) — bingovert setter manuelt (lovgivnings-implikasjon: krever ADR-doc)
- [ADR-0023 — MCP write-access policy (lokal vs prod)](../../../docs/adr/0023-mcp-write-access-policy.md) — bindende: audit-tabeller (`app_audit_log`, `wallet_entries`, `app_rg_payout_audit`, `app_regulatory_ledger`) og `app_rg_restrictions` skal ALDRI muteres via MCP-write mot prod. §66 (5-min pause), §23 (self-exclusion 1 år) og §71 (audit-trail) håndheves via append-only korreksjons-rad i migration-PR — ikke direct UPDATE.

## MCP write-restriksjon for audit-tabeller (ADR-0023)

**Prod-DB skal aldri muteres direkte via MCP-write.** Audit-tabeller er
hash-chain-bevarende og append-only. Direct UPDATE bryter:

- §71 audit-trail (hash-chain blir irreversibelt korrupt)
- §66 obligatorisk 5-min-pause (kan ikke overstyres ved å UPDATE `app_rg_restrictions`)
- §23 self-exclusion 1 år (kan ikke heves før 1 år; UPDATE er regulatorisk-brudd → dagsbøter 5k-50k NOK/hendelse)

**Korreksjons-prosedyre ved feil i audit-data (eksempel `app_audit_log`):**

1. Identifiser original-rad (`id`, `created_at`, payload)
2. Opprett migration-PR i `apps/backend/migrations/<timestamp>_<topic>.sql`
3. Append ny `audit_correction`-rad som peker på original via JSONB-payload:

```sql
INSERT INTO app_audit_log
  (id, actor_type, actor_id, action, resource, resource_id, payload, created_at)
VALUES
  (gen_random_uuid(), 'SYSTEM', NULL, 'audit_correction', 'app_audit_log', '<original-id>',
   jsonb_build_object(
     'original_id', '<original-id>',
     'correction_reason', 'Tobias godkjent fix YYYY-MM-DD — <kontekst>',
     'corrected_fields', jsonb_build_object('payload', '<ny-verdi>')
   ),
   now());
```

For `wallet_entries`-korreksjon: append motpost-rad med `side=CREDIT` eller `side=DEBIT`, `amount > 0`. `wallet_accounts.balance` re-genereres automatisk (GENERATED ALWAYS).

4. PR krever Tobias-godkjenning + ADR (hvis arkitektur-endring) + grønn CI
5. Render auto-deploy kjører migrasjonen

**Aldri** UPDATE eller DELETE fra:

- `app_audit_log` (generelle audit-events, BIN-764 hash-chain via `payload` JSONB)
- `wallet_entries` (outbox-pattern, ADR-0005, hash-chain via `entry_hash` + `previous_entry_hash`)
- `wallet_accounts` (`balance` er GENERATED ALWAYS — DB avviser direct UPDATE uansett)
- `app_rg_payout_audit` (Lotteritilsynet-trail)
- `app_regulatory_ledger` (ADR-0015 daily-anchor)
- `app_rg_restrictions` (§66/§23-beskyttelse)

## Endringslogg

| Dato | Endring |
|---|---|
| 2026-05-08 | Initial — §11/§66/§71 + gameType-mapping |
| 2026-05-13 | v1.1.0 — la til ADR-0015 (separat §71 regulatory-ledger med daily-anchor + verifyAuditChain), ADR-0017 (manuell jackpot) |
| 2026-05-14 | v1.2.0 — la til ADR-0023 MCP write-access policy. Audit-tabeller og `app_rg_restrictions` er beskyttet mot direct MCP-mutasjon i prod; korreksjoner kun via append-only migration-PR. |
| 2026-05-14 | v1.2.1 — korrigerte tabellnavn til faktisk schema: `app_audit_log` (ikke `app_compliance_audit_log`), `wallet_entries` + `wallet_accounts` (ikke `app_wallet_entries`/`app_wallets`), `app_rg_payout_audit` (ikke `app_payout_audit`). Eksempel-INSERT bruker faktisk schema med JSONB-payload. |
