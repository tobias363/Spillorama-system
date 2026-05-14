---
name: audit-hash-chain
description: When the user/agent works with the hash-chain audit-trail used for Lotteritilsynet-traceability in the Spillorama bingo platform. Also use when they mention AuditLogService, app_compliance_audit_log, app_audit_anchors, prev_hash, curr_hash, entry_hash, audit-anchor, hash-chain, BIN-764, ADR-003, daily-anchor, audit-trail integrity, verify:audit-chain, verifyAuditChain, WalletAuditVerifier, PostgresWalletAdapter.hashChain, WALLET_HASH_CHAIN_GENESIS, casino-grade audit, immutable ledger. Hash-chain integrity is what lets Lotteritilsynet prove our records weren't tampered with. Make sure to use this skill whenever someone touches AuditLogService, app_compliance_audit_log, the wallet audit verifier, daily anchor cron, or anything that reads/writes audit rows directly — even if they don't mention hash-chain — because a single bypass breaks the chain forever.
metadata:
  version: 1.0.0
  project: spillorama
---

<!-- scope: apps/backend/src/compliance/AuditLogService.ts, apps/backend/src/compliance/AuditLogService.test.ts, apps/backend/src/wallet/WalletAuditVerifier.ts, apps/backend/src/wallet/WalletAuditVerifier.test.ts, apps/backend/src/adapters/PostgresWalletAdapter.ts, apps/backend/src/scripts/verifyAuditChain.ts, apps/backend/src/jobs/walletAuditVerify.ts -->

# Audit Hash-Chain (BIN-764 / ADR-003)

Hash-chain audit-trail is what makes our compliance records **tamper-evident**. Every audit row links to the previous via SHA-256(prev_hash || row_data). A single mutation downstream breaks the chain from that row to the present, and a daily anchor lets us prove what the chain looked like at any point in history.

This is casino-grade industry-norm (Evolution Live Casino, Playtech) and it is **non-negotiable** under our Lotteritilsynet-readiness posture.

## Kontekst (read first)

- `docs/decisions/ADR-003-hash-chain-audit.md` — the decision-record. Read first, do not duplicate its content.
- `apps/backend/src/wallet/README.md` — section 4 "Hash-chain audit"
- `apps/backend/src/wallet/WalletAuditVerifier.ts` — the wallet-side verifier (has the canonical algorithm)
- `apps/backend/src/adapters/PostgresWalletAdapter.ts` — `WALLET_HASH_CHAIN_GENESIS`, `canonicalJsonForEntry`, `computeEntryHash`
- `apps/backend/src/compliance/AuditLogService.ts` — the compliance-side AuditLogService
- `apps/backend/src/scripts/verifyAuditChain.ts` — the standalone verify-script (run in CI or on revisor demand)

## Kjerne-arkitektur

### Two parallel chains

There are two independent hash-chains, each protecting a different audit surface. They share the same algorithm but live in different tables:

| Chain | Table | Service | What it protects |
|---|---|---|---|
| Compliance audit | `app_compliance_audit_log` | `AuditLogService` | KYC, RBAC, prize-policy changes, hall-config writes, agent settlements |
| Wallet entries | `app_wallet_entries` | `PostgresWalletAdapter` | Every wallet credit/debit/refund |

Don't bridge them. Each chain stands alone — verifier scripts walk one table at a time.

### The algorithm

For both chains:

```
genesis_hash = "0000...0000" (64 zeros, or WALLET_HASH_CHAIN_GENESIS for wallet)
prev_hash = (previous row's curr_hash) || genesis_hash for first row
curr_hash = SHA-256(prev_hash || canonical_json(row_data))
```

`canonical_json` is JSON with sorted keys + UTF-8 + no whitespace. Get this wrong and verification fails on rows you didn't even touch.

### Insert-flow

For both chains the write-path is:

1. `BEGIN`
2. `SELECT curr_hash FROM <table> ORDER BY id DESC LIMIT 1 FOR UPDATE` — take the row-lock so two writers can't grab the same prev_hash
3. Compute `curr_hash` from `prev_hash` + canonical-row-data
4. `INSERT` with both prev_hash and curr_hash
5. `COMMIT`

If two backends race: `(prev_hash, curr_hash)` has a unique constraint and the second writer fails — retry with the new tail.

### Daily anchor (Lotteritilsynet evidence)

`apps/backend/src/jobs/auditAnchorCron.ts` runs at midnight Europe/Oslo:
1. Read latest `curr_hash` from each chain
2. Sign with `JWT_SECRET`
3. Insert into `app_audit_anchors` (date, table_name, hash, signature)

At revisjon time we can prove: *"on date X, the audit-chain ended at hash Y, and here is the signed anchor."* If anyone tampers with row N from yesterday, the chain from N forward will not re-derive to Y — caught.

### Verification

Run `npm run verify:audit-chain` to walk every row in order, recompute `curr_hash`, compare to stored. Mismatches surface as a list of `(row_id, expected_hash, stored_hash)` tuples. CI runs this nightly; revisorer can run it on demand.

The wallet-side equivalent is `WalletAuditVerifier.verifyAccount(accountId)` (per-account walk) and `verifyAll()` (parallel sweep with concurrency-cap).

## Immutable beslutninger

1. **Append-only.** Never `UPDATE` or `DELETE` from `app_compliance_audit_log` or `app_wallet_entries`. Corrections are new rows referencing the original.
2. **Every audit-event goes via `AuditLogService`.** Direct `INSERT INTO app_compliance_audit_log` from another module breaks the chain.
3. **Every wallet mutation goes via `PostgresWalletAdapter`.** No raw-SQL credit/debit shortcuts — they bypass hash-chain.
4. **Daily anchor is sealed.** Once `auditAnchorCron` writes an anchor for date D, that anchor is the public commitment for everything ≤ D. You cannot retroactively "fix" a row before D without making the chain inconsistent with the anchor.
5. **Genesis hash is fixed.** `WALLET_HASH_CHAIN_GENESIS` (and the compliance-equivalent) is part of the protocol. Don't change it.
6. **canonical_json is part of the protocol.** If you reorder fields, change formatting, or add fields without backwards-compat — verification breaks for all rows ever written.

## Vanlige feil og hvordan unngå dem

1. **Bypassing AuditLogService for "performance".** Don't. Every event must hash-link. The cost is one indexed `SELECT ... ORDER BY id DESC LIMIT 1` per write — measured at <1ms.
2. **Using `Object.keys()` instead of canonical sort in JSON.** JS-engine key-order is implementation-dependent. Use a sorted-key serializer (the existing helper does this).
3. **Trying to "rebuild" the chain after a manual data-fix.** You can't — anchors are sealed. The only correct response to "we wrote a wrong row" is a new corrective row that references the original.
4. **Forgetting to take the row-lock (`FOR UPDATE`).** Two concurrent writers will both compute curr_hash from the same prev_hash, and the unique-constraint will reject the second. The retry must re-read prev_hash.
5. **Mixing wallet entries and compliance entries in one chain.** They are separate chains for separate surfaces. Each verifier walks its own table.
6. **Treating legacy unhashed rows as failures.** Pre-BIN-764 rows have `entry_hash IS NULL`. The verifier reports them as `legacyUnhashed` (counted, not alarmed). Backfill happens via a one-shot job, not the verifier.
7. **Letting a backend crash mid-INSERT corrupt the chain.** Transactions handle this — either both prev_hash-read and INSERT commit, or neither does. Don't add retry-logic that bypasses the transaction.

## How to demonstrate integrity to a revisor

1. Show them `app_audit_anchors` — pick any historical date.
2. Run `npm run verify:audit-chain -- --until=<date>` — re-derives chain up to that anchor.
3. Compare derived final hash to the signed anchor — must match.
4. Pick any row in the range, present it. The revisor can independently SHA-256 the canonical_json + prev_hash and confirm.

If step 3 fails: a row was tampered with. The verifier output tells you which row, and you can answer the revisor's "what changed and when".

## Kanonisk referanse

- ADR: `docs/decisions/ADR-003-hash-chain-audit.md`
- Wallet README: `apps/backend/src/wallet/README.md`
- Compliance: `apps/backend/src/compliance/AuditLogService.ts`
- Wallet adapter: `apps/backend/src/adapters/PostgresWalletAdapter.ts` (helpers + genesis)
- Verifier (wallet): `apps/backend/src/wallet/WalletAuditVerifier.ts`
- Verifier (compliance script): `apps/backend/src/scripts/verifyAuditChain.ts`
- Daily anchor cron: `apps/backend/src/jobs/auditAnchorCron.ts`

## Når denne skill-en er aktiv

LOAD when:
- Modifying or adding writes to `AuditLogService` or `app_compliance_audit_log`
- Modifying or adding writes to `PostgresWalletAdapter` / `app_wallet_entries`
- Touching the daily anchor cron, verify scripts, or canonical JSON helper
- Investigating a "verification failed" report from CI or a revisor
- Designing a backfill/migration that touches audit or wallet rows
- Reviewing PRs that add direct SQL against the audit or wallet tables

SKIP when:
- UI work that only reads from a query-API (not the raw table)
- Test fixtures that don't assert hash-chain integrity
- Pure documentation updates that don't change algorithm or canonical-form

## Komplementære integrity-watchers

- **Strukturell sjekk hver time** — `scripts/ops/wallet-integrity-watcher.sh`
  (OBS-10, 2026-05-14) håndhever hash-chain-link-invariant: for hver rad
  i `wallet_entries` (siste 24t) må `previous_entry_hash` matche forrige
  rads `entry_hash` per `account_id`. Denne sjekken gjør IKKE full
  SHA-256 re-compute (den krever canonical-JSON-logikk i TypeScript),
  men den fanger 90 % av tamper-mønstre raskt. Hash-chain-brudd =
  Linear-issue Urgent + Slack/disk fallback.
- **Full SHA-256-verify nightly** — `WalletAuditVerifier` (denne skill-en)
  re-beregner `entry_hash` for hver rad og er den endelige
  Lotteritilsynet-grade-verifikasjonen. Watcher-en og verifier-en
  utfyller hverandre: watcher gir < 1t MTTD, verifier garanterer full
  korrekthet.

Se `docs/operations/WALLET_INTEGRITY_WATCHER_RUNBOOK.md` for eskaleringsflyt
+ relasjon mellom de to kontrollene.

## Relaterte ADR-er

- [ADR-0003 — System-actor for engine-mutasjoner](../../../docs/adr/0003-system-actor.md) — actor-felt i hash-chain
- [ADR-0004 — Hash-chain audit-trail (BIN-764)](../../../docs/adr/0004-hash-chain-audit.md) — bindende design-beslutning
- [ADR-0005 — Outbox-pattern for events (BIN-761)](../../../docs/adr/0005-outbox-pattern.md) — outbox + audit-trail samspill
- [ADR-0011 — Casino-grade observability](../../../docs/adr/0011-casino-grade-observability.md) — daglig anchor-snapshot
