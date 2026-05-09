# ADR-0015 — Hash-chain audit-trail: faktisk implementasjon (BIN-764)

**Status:** Accepted
**Dato:** 2026-05-09
**Deciders:** Tobias Haugen
**Konsulterer:** Compliance / Lotteritilsynet-side
**Supersedes:** [ADR-0004](./0004-hash-chain-audit.md)

## Kontekst

[ADR-0004](./0004-hash-chain-audit.md) (skrevet 2026-04-26) beskrev en designhypotese
for tamper-evident audit-trail som ikke matcher faktisk implementert kode.

§71 / audit-verifikasjons-passet 2026-05-08 (PR #1095 + PR #1098) avdekket at:

1. **Tabellen `app_compliance_audit_log` finnes ikke.**
   - Faktisk audit-tabell heter `app_audit_log` (BIN-588, migrasjon
     `20260418160000_app_audit_log.sql`) og har ingen hash-felter.
   - Hash-chain er faktisk implementert på **`wallet_entries`** (BIN-764, migrasjon
     `20260902000000_wallet_entries_hash_chain.sql`) som **per-konto-kjede** — ikke
     en global kjede over én audit-tabell.
2. **CLI-en `npm run verify:audit-chain` eksisterte ikke** før G5
   (denne ADR-en + tilhørende PR). Verifiserings-logikken bor i
   `WalletAuditVerifier`, og CLI-wrapperen er nå på plass i
   `apps/backend/scripts/verify-wallet-audit-chain.ts`.
3. **Daglig anchor (`app_audit_anchors`) er ikke implementert** og ble bevisst
   utsatt til post-pilot per ADR-0004 §"Daglig anchor — IKKE IMPLEMENTERT" i
   `docs/compliance/AUDIT_HASH_CHAIN_VERIFICATION_2026-Q3.md`.

I tillegg er en helt ny **global** hash-chain under utvikling for §71 daglig
rapport: `app_regulatory_ledger` (PR #1102, G2-G4) med `prev_hash` + `event_hash`.
Dette er en kompletterende mekanisme som beskriver pengeflyt på ledger-nivå —
ikke samme tabell som per-konto wallet-chain.

ADR-er er **immutable etter merge** ([_template.md](./_template.md) og
[README.md](./README.md) §Lifecycle). ADR-0004 har status `Accepted` og kan ikke
endres destruktivt — derfor denne nye ADR-en som markerer den som superseded og
dokumenterer faktisk state.

## Beslutning

Hash-chain audit-trail i Spillorama er **per-konto-kjede på `wallet_entries`**, med
en **kompletterende global kjede på `app_regulatory_ledger`** (under utvikling).

### Per-konto wallet-chain (BIN-764, deployet)

```sql
-- Migrasjon: apps/backend/migrations/20260902000000_wallet_entries_hash_chain.sql
ALTER TABLE wallet_entries
  ADD COLUMN IF NOT EXISTS entry_hash TEXT,
  ADD COLUMN IF NOT EXISTS previous_entry_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_wallet_entries_hash_chain
  ON wallet_entries (account_id, id);
```

Algoritme (`apps/backend/src/adapters/PostgresWalletAdapter.ts:1393`):

1. INSERT `wallet_entries`-raden uten hash.
2. Les forrige rads `entry_hash` for samme `account_id`. Genesis-rad bruker 64x `'0'`
   (`WALLET_HASH_CHAIN_GENESIS`).
3. Beregn `entry_hash = SHA256(previous_entry_hash + canonical_json(entry_data))`
   med stabil nøkkel-rekkefølge (id, operation_id, account_id, side, amount,
   transaction_id, account_side, created_at — alle som strings for å unngå
   JS-float-flak).
4. UPDATE raden med `entry_hash` + `previous_entry_hash`.

Steg 1+4 kjører i samme `BEGIN…COMMIT` (BIN-761 outbox-pattern). Backend-crash
mellom INSERT og UPDATE → hele transaksjonen rulles tilbake — ingen rader uten
hash skrives fra denne pathen.

**Per-konto** valgt fremfor global kjede:
- Tillater parallelle inserts på forskjellige kontoer uten lock-kontensjon.
- Fortsatt tamper-evident — enhver in-place-endring av en historisk rad bryter
  den spesifikke kontoens kjede fra det punktet.
- Per-konto-walk er O(N) per konto; for `verifyAll` parallelliseres med
  concurrency 4.

### Global §71 chain (PR #1102, under utvikling)

`app_regulatory_ledger` (Blokk 1.12, migrasjon `20260417000005_regulatory_ledger.sql`)
har **én global kjede** for §71 daglig rapport:

```sql
CREATE TABLE app_regulatory_ledger (
  id                TEXT PRIMARY KEY,
  sequence          BIGSERIAL NOT NULL UNIQUE,
  -- ... event-felter ...
  prev_hash         TEXT NULL,
  event_hash        TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Hash-formel: `event_hash = sha256(id || event_date || channel || hall_id ||
transaction_type || amount_nok || ticket_ref || created_at || prev_hash)`.

Denne kjeden er per-tabell (én kjede globalt) — enklere tamper-deteksjon for
§71-bruk fordi sekvens-id-ordning er deterministisk via `BIGSERIAL`. Verifiserings-CLI
for denne kommer i G2-G4 (PR #1102).

### Verifiserings-CLI

`npm --prefix apps/backend run verify:audit-chain` (G5, denne PR-en):

- Wrapper rundt `WalletAuditVerifier` som walker hver konto og re-beregner
  SHA-256-kjeden.
- Read-only — bruker SELECT-statements og kan kjøres mot prod uten risiko.
- Exit-code 0 = intakt, 1 = mismatch (TAMPER eller silent corruption),
  2 = runtime-feil.
- Default scheduler: `wallet-audit-verify`-cron 02:00 lokal tid (logger til Render +
  Sentry).

Egen CLI for `app_regulatory_ledger`-chain kommer separat (G2-G4).

### `app_audit_log` (BIN-588) er IKKE hash-chained

`app_audit_log` (admin-handlinger, KYC-overrides, login-historikk osv.) er
fortsatt en append-only-tabell uten hash-chain. Mitigasjon i dag: separat
backup + Sentry-trace + PostgreSQL append-only-constraint (UPDATE/DELETE blokkert).

Utvidelse av hash-chain til `app_audit_log` er en post-pilot-vurdering hvis
Lotteritilsynet ber om det.

### Daily anchor (`app_audit_anchors`) er IKKE implementert

Designet i ADR-0004 (daglig signert snapshot publisert til immutable storage)
er ikke deployet. Mitigasjon:

- `wallet-audit-verify`-cron logger aggregert resultat med tidsstempel til Render
  og Sentry — gir soft-anchor på når sist verifisering kjørte.
- PITR-backup (35 dager) gir soft point-in-time-recovery.

Anchor-implementasjon utsatt til post-pilot. Hvis Lotteritilsynet ber om sterkere
tids-bevis, kan anchor-cron implementeres separat i en oppfølgings-PR.

## Konsekvenser

### Positive
- **Faktisk implementasjon dokumentert** — fremtidige PM-er / agenter kan slå opp
  korrekt tabell-navn, felt-navn, og CLI-kommando.
- **Casino-grade audit-integritet på wallet-bevegelser** — per-konto chain
  detekterer ondsinnet redigering av historikk.
- **Verifiserbar** — `npm run verify:audit-chain` kjørt 2026-05-08: 6/6 hashed
  entries intakt, tamper-injection detekterte mismatch (exit 1).
- **§71-side får egen global chain** — separat tamper-evidens for daglig rapport.

### Negative
- **`app_audit_log` har ingen hash-chain** — admin-handlinger, KYC-overrides,
  login-historikk er kun beskyttet av append-only-constraint + backup.
  Dette er bevisst trade-off; mitigasjon dokumentert.
- **Daily anchor mangler** — vi har ingen ekstern tids-bevis for audit-state.
- **To kjeder å vedlikeholde** — wallet-chain (per-konto) + regulatory-chain
  (global). Krever to verifiserings-CLIer og to mental-models.

### Nøytrale
- **Backward-compat:** legacy wallet-entries fra før migrasjon `20260902000000`
  har `entry_hash IS NULL` og hoppes over av verifier-en (rapportert som
  `legacyUnhashed`). Backfill kan implementeres som one-shot job hvis
  Lotteritilsynet ber om det.
- **Per-konto-kjede vs global:** valgt for wallet, men ikke for regulatory-ledger.
  Kostnaden er mental-overhead; gevinsten er parallelism + enklere §71-aggregat.

## Alternativer vurdert

### Alternativ A: Endre ADR-0004 direkte
Avvist:
- ADR-er er **immutable etter merge** per [_template.md](./_template.md) og
  [README.md](./README.md) §Lifecycle.
- Audit-trail på beslutninger må overleve senere PM-handovers — direkte edit
  ville miste konteksten om at ADR-0004 var feil og hvorfor.

### Alternativ B: Implementere hash-chain på `app_audit_log` slik ADR-0004 beskriver
Avvist (for nå):
- Wallet-bevegelser er den finansielt mest sensitive dimensjonen — Lotteritilsynet-
  revisjon er knyttet til pengeflyt, ikke til admin-handlinger.
- BIN-588 (`app_audit_log`) ble bygget som generic audit FØR BIN-764 ble
  prioritert.
- Utvidelse til `app_audit_log` er post-pilot.

### Alternativ C: Konsolidere all audit i én global hash-chain
Avvist:
- Lock-kontensjon på en global insert-pointer ville være signifikant under
  pilot-belastning (~1500 spillere × multiple wallet-events per minutt).
- Skiller heterogene events (admin-action vs wallet-tx vs §71-event) i samme
  kjede gir tap av query-effektivitet.
- Nåværende design (per-konto wallet + global §71) er Pareto-optimum.

## Implementasjon

### Faktisk state per 2026-05-09

- ✅ `wallet_entries.entry_hash` + `wallet_entries.previous_entry_hash` (BIN-764,
  migrasjon `20260902000000`)
- ✅ `app_regulatory_ledger.prev_hash` + `app_regulatory_ledger.event_hash`
  (Blokk 1.12, migrasjon `20260417000005`)
- ✅ `PostgresWalletAdapter.ts:1393` skriver wallet hash-chain
- ✅ `WalletAuditVerifier` verifiserer wallet-chain
- ✅ `npm --prefix apps/backend run verify:audit-chain` CLI (denne PR-en)
- ✅ `wallet-audit-verify`-cron (02:00 lokal tid, logger til Render + Sentry)
- 🚧 `app_regulatory_ledger`-write-path og verifiserings-CLI (G2-G4, PR #1102)
- ❌ `app_compliance_audit_log` (referanse i ADR-0004 — tabellen finnes ikke)
- ❌ `app_audit_anchors` daglig anchor (utsatt til post-pilot)
- ❌ Hash-chain på `app_audit_log` (BIN-588 er kun append-only)

### Skills som bør oppdateres

- `audit-hash-chain` — peker fortsatt på `app_compliance_audit_log` og
  `app_audit_anchors`. Burde peke på:
  - `wallet_entries` + `WalletAuditVerifier` for wallet-chain
  - `app_regulatory_ledger` + kommende §71-CLI for global chain
- `pengespillforskriften-compliance` — burde nevne at §71-chain er separat fra
  wallet-chain.
- `wallet-outbox-pattern` — peker korrekt allerede.

### Filer som er feil per 2026-05-09

| Fil | Feil-referanse | Plan |
|---|---|---|
| `apps/backend/src/compliance/README.md` | Refererer `app_compliance_audit_log` 4 steder | Korrigeres i denne PR-en |
| `docs/diagrams/03-draw-flow-spill1.md` | Mermaid-diagram nevner `INSERT app_compliance_audit_log` | Korrigeres i denne PR-en |
| `docs/decisions/ADR-003-hash-chain-audit.md` | Forrige plassering av ADR-0004 (pre-migrasjon) | Beholdes som-er; markeres med peker til ADR-0015 |
| `docs/auto-generated/SKILLS_CATALOG.md` | Auto-generert fra skill-trigger-text | Oppdateres ved neste auto-gen |

## Referanser

- [ADR-0004](./0004-hash-chain-audit.md) — opprinnelig design (superseded)
- [ADR-0003](./0003-system-actor.md) — driver actor-felt i hash-chain
- [ADR-0005](./0005-outbox-pattern.md) — outbox-pattern brukt for hash-write-atomicity
- BIN-764 (Linear) — wallet hash-chain
- BIN-588 (Linear) — `app_audit_log` (uten hash)
- `apps/backend/migrations/20260902000000_wallet_entries_hash_chain.sql`
- `apps/backend/migrations/20260417000005_regulatory_ledger.sql`
- `apps/backend/migrations/20260418160000_app_audit_log.sql`
- `apps/backend/src/adapters/PostgresWalletAdapter.ts:1393` — write-path
- `apps/backend/src/wallet/WalletAuditVerifier.ts` — verifier-class
- `apps/backend/scripts/verify-wallet-audit-chain.ts` — CLI (G5, denne PR-en)
- `apps/backend/scripts/README.md` §1 — CLI-bruk
- `docs/compliance/AUDIT_HASH_CHAIN_VERIFICATION_2026-Q3.md` — full
  verifikasjons-prosedyre + pilot-go/no-go-vurdering
