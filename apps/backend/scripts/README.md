# Backend scripts

Operativ-CLIer som ikke er en del av runtime-stacken. Alle kjøres med `tsx`
(TypeScript direkte uten build) eller `bash`.

## Konvensjon

- **Read-only**-scripts mot prod skal være tydelig markert i header-kommentaren
  (eks. `verify-wallet-audit-chain.ts`).
- **DB-mutating**-scripts skal bruke `--dry-run`-flag der det gir mening
  (eks. `migrate-game-plan-2026-05-07.ts`).
- Alle scripts som leser DB tar `APP_PG_CONNECTION_STRING` (eller lignende)
  fra env — aldri hardkodet credentials.
- Norsk doc-tekst, engelsk kode-kommentarer (matcher repo-konvensjon).

## Tilgjengelige scripts

### Audit & compliance

| Script | npm-script | Formål |
|---|---|---|
| `verify-wallet-audit-chain.ts` | `npm run verify:audit-chain` | BIN-764 — verifiser hash-chain på `wallet_entries` per konto. Read-only. Se §1 nedenfor. |

### Seed & demo

| Script | npm-script | Formål |
|---|---|---|
| `seed-test-users-hall.ts` | `npm run seed:test-users` | Seede test-spillere til en hall (dev/test). |
| `seed-demo-tv-and-bonus.ts` | `npm run seed:demo-tv-bonus` | Seede demo-data for TV-skjerm + bonus-spill. |
| `seed-demo-tv-minimal.ts` | `npm run seed:demo-tv-minimal` | Minimal demo-seed for TV-skjerm-test. |
| `seed-demo-pilot-day.ts` | `npm run seed:demo-pilot-day` | Full pilot-dag-seed (4 haller, 13 katalog-spill, plan + GoH). |
| `seed-halls.ts` | — | Seede haller (kjøres direkte med tsx). |
| `seed-legacy-game-config.ts` | `npm run seed:legacy-config` | Seede legacy game-config for testing. |
| `seed-teknobingo-test-players.ts` | — | Seede Teknobingo Årnes test-spillere. |

### Migration helpers

| Script | npm-script | Formål |
|---|---|---|
| `migrate-game-plan-2026-05-07.ts` | — | One-shot migrasjon av eksisterende plan-data til ny redesign. |
| `migrate-game-plan-helpers.ts` | — | Helpers for plan-migrasjon (importert av andre scripts). |
| `verify-game-plan-migration.ts` | — | Verifiser at plan-migrasjon er konsistent. |
| `migrate-ais-users.ts` | — | One-shot import av AIS legacy-brukere til Spillorama Postgres. |
| `import-legacy-subgame-templates.ts` | `npm run import:legacy-templates` | Import legacy sub-game-templates. |

### Eksport & rapport

| Script | npm-script | Formål |
|---|---|---|
| `export-game-catalog.ts` | `npm run export:game-config` | Eksporter spillkatalog til JSON i `docs/state/`. Se [EXPORT_GAME_CATALOG.md](./EXPORT_GAME_CATALOG.md). |

### Utility

| Script | npm-script | Formål |
|---|---|---|
| `dev-single.sh` | `npm run dev:single` | Start én backend-instans i dev-modus (uten parallel-instans). |
| `e2e-smoke-test.ts` | `npm run smoke-test` | E2E-smoke-test mot kjørende backend. |
| `pilot-smoke-test.sh` | — | Pilot-spesifikk smoke-test (manuell). |
| `generate-module-map.ts` | — | Generer modul-graf for arkitektur-doc. |

---

## §1 — `npm run verify:audit-chain`

**BIN-764-verifikasjon** av tamper-evident hash-chain på `wallet_entries`-
tabellen. Read-only — scriptet skriver ALDRI til DB.

### Bakgrunn

`wallet_entries` har siden migrasjon `20260902000000_wallet_entries_hash_chain.sql`
hatt to felter:

- `previous_entry_hash TEXT` — `entry_hash` fra forrige rad (samme `account_id`).
  Genesis-rad bruker 64x `'0'`.
- `entry_hash TEXT` — `SHA256(previous_entry_hash + canonical_json(entry_data))`.

Kjeden er **per konto** (ikke global). Dette tillater parallelle inserts uten
sekvens-kontensjon, men er fortsatt tamper-evident: enhver in-place-endring
av en historisk rad vil bryte kjeden fra det punktet og frem.

Verifiserings-logikken bor i `WalletAuditVerifier`
(`apps/backend/src/wallet/WalletAuditVerifier.ts`); CLI-en er en tynn wrapper
som setter opp pool, kjører verifier, og oversetter resultat til exit-code.

### Bruk — lokal/dev

```bash
APP_PG_CONNECTION_STRING="postgres://spillorama:spillorama@localhost:5432/spillorama" \
  npm --prefix apps/backend run verify:audit-chain
```

### Bruk — staging/prod

Bruk read-only DB-bruker. Setter `APP_PG_CONNECTION_STRING` mot staging/prod-DB:

```bash
APP_PG_CONNECTION_STRING="$STAGING_PG_READ_ONLY_URL" \
  npm --prefix apps/backend run verify:audit-chain
```

### Valgfri env-vars

| Var | Default | Formål |
|---|---|---|
| `APP_PG_SCHEMA` | `public` | Schema-navn (sanitized til `[a-zA-Z0-9_]`). |
| `WALLET_PG_CONNECTION_STRING` | — | Alias for `APP_PG_CONNECTION_STRING`. |
| `AUDIT_VERIFY_BATCH` | `1000` | Batch-størrelse per query. |
| `AUDIT_VERIFY_CONCURRENCY` | `4` | Antall parallelle kontoer i walk. |
| `AUDIT_VERIFY_ACCOUNT_ID` | — | Verifiser kun én konto (debug-modus). |

### Exit-codes

| Code | Betydning |
|---|---|
| `0` | Hash-chain intakt for alle kontoer. |
| `1` | Minst én mismatch detektert — TAMPER eller silent corruption. |
| `2` | Runtime-feil (DB ikke tilgjengelig, schema mangler, etc.). |

### Forventet output

```
=== BIN-764: Wallet hash-chain verifikasjon ===
Database schema  : public
Batch-størrelse  : 1000
Concurrency      : 4

Kontoer sjekket          : 20
Entries sjekket          : 29
Entries valide           : 14
Legacy uten hash (NULL)  : 15
Mismatches detektert     : 0
Tid                      : 10 ms

RESULTAT: hash-chain intakt for alle kontoer.
```

`Legacy uten hash (NULL)` er forventet for entries som ble innsatt før
migrasjonen — de har `entry_hash IS NULL` og hoppes over (ikke regnet som
mismatch). Backfill av legacy-entries er ikke implementert per 2026-Q3.

### CI/cron-integrasjon

Anbefalt: kjør én gang i døgnet (off-peak) som GitHub Action eller intern
cron-job. Ved exit-code `1` bør PagerDuty/Slack-alert fyres umiddelbart —
hash-chain-mismatch er high-severity.

Eksempel cron-snippet:

```bash
0 4 * * *  cd /opt/spillorama && \
  APP_PG_CONNECTION_STRING="$WALLET_RO_URL" \
  npm --prefix apps/backend run verify:audit-chain \
  >> /var/log/audit-chain.log 2>&1 || \
  /opt/spillorama/bin/page-ops.sh "audit-chain mismatch"
```

### Recovery ved mismatch

Se `docs/compliance/AUDIT_HASH_CHAIN_VERIFICATION_2026-Q3.md` for full
recovery-prosedyre. Kort versjon:

1. Stopp alle wallet-mutasjoner (sett backend i read-only).
2. Identifiser kontoer med mismatch (CLI-output viser `entry_id` + grunn).
3. Restore fra siste kjente good backup.
4. Re-kjør CLI for å bekrefte clean state.
5. Post-mortem + Lotteritilsynet-rapport (24t-vindu).

### Begrensninger (per 2026-Q3)

- **Kun wallet-side chain** — `app_regulatory_ledger` (Blokk 1.12) har egen
  global chain (`prev_hash` + `event_hash`) som verifiseres separat. Eget
  CLI for §71-rapport-verifikasjon kommer i G2-G4 (PR #1102).
- **Daily anchor (`app_audit_anchors`) IKKE implementert** — design er
  beskrevet i ADR-0015, men deployment er post-pilot.
- **Backfill av pre-migrasjon-entries** — entries fra før migrasjonen
  20260902000000 har `entry_hash IS NULL` og hoppes over (rapportert som
  "Legacy uten hash"). Backfill kan implementeres som one-shot job hvis
  det blir et regulatorisk krav.
