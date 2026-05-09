# `reconcile-wallet-vs-ledger.ts` — G9 wallet vs compliance ledger reconciliation

**G9-reconciliation** mellom wallet-ledger og compliance-ledger.
Read-only — scriptet skriver ALDRI til DB.

> **Note:** Når `apps/backend/scripts/README.md` lander (PR #1099 audit-chain)
> bør innholdet her flyttes inn som §2 av den README. Per 2026-Q3 lever det
> som standalone-fil for å unngå merge-konflikt mellom åpne PRer.

## Bakgrunn

Spillorama har **to uavhengige ledger-baser** som potensielt kan divergere:

- **Wallet-laget** (`wallet_transactions` + `wallet_entries`) er kilden for
  spiller-saldo. Hver mutasjon på en spiller-konto er en DEBIT (innsats /
  withdraw) eller CREDIT (premie / topup). Hash-chain (BIN-764) verifiserer
  at wallet ikke er tampered.
- **Compliance-ledger** (`app_rg_compliance_ledger`) er kilden for §71-rapport
  til Lotteritilsynet. Hver event har `event_type` ∈ `STAKE / PRIZE /
  EXTRA_PRIZE / ORG_DISTRIBUTION / HOUSE_RETAINED / HOUSE_DEFICIT`.

For at vi skal kunne stå inne for at "alt som ble debit-et fra wallet ble
korrekt rapportert til Lotteritilsynet", trenger vi en periodisk
sammenligning. Dette scriptet er den sammenligningen.

§71-verifikasjons-rapport (PR #1098) flagget dette som G9 — out-of-scope
for selve §71-implementasjonen, men kritisk for compliance-trygghet.

Komplementerer `verify-wallet-audit-chain.ts` (BIN-764, hash-chain):

- Hash-chain verifiserer at wallet IKKE er tampered.
- Reconciliation verifiserer at wallet ↔ §71-rapport stemmer.

## Matching-strategi

Per `(walletId, businessDate, side)` aggregerer vi sum + count fra begge
kilder, deretter sammenligner vi:

- Wallet-DEBIT (game-relatert) ↔ Ledger STAKE
- Wallet-CREDIT (game-relatert) ↔ Ledger PRIZE + EXTRA_PRIZE

`businessDate` er Europe/Oslo-dato (matcher §71-bucket-grensen).

Vi rapporterer:

| Kategori | Betydning | Severity |
|---|---|---|
| `walletOnlyBuckets` | Wallet-mutasjon uten §71-rapport | **Compliance-brudd** |
| `ledgerOnlyBuckets` | §71-event uten wallet-bevegelse | **Phantom-rapport** |
| `amountMismatches` | Beløp avviker mellom kildene | **Høy risiko** |
| `countMismatches` | Antall events ulikt (sum stemmer) | Advarsel |

`amountMismatches`, `walletOnlyBuckets` og `ledgerOnlyBuckets` flagger som
divergens (`isReconciled=false` → exit-code 1). `countMismatches` alene er
KUN advarsel — kan skyldes lovlig multi-event-aggregering.

## Bruk — lokal/dev

```bash
APP_PG_CONNECTION_STRING="postgres://spillorama:spillorama@localhost:5432/spillorama" \
  npm --prefix apps/backend run reconcile:wallet-ledger -- \
  --from 2026-08-01 --to 2026-08-31
```

Eller direkte med tsx:

```bash
APP_PG_CONNECTION_STRING="postgres://spillorama:spillorama@localhost:5432/spillorama" \
  npm --prefix apps/backend exec -- tsx \
  apps/backend/scripts/reconcile-wallet-vs-ledger.ts \
  --from 2026-08-01 --to 2026-08-31
```

## Bruk — staging/prod

Bruk read-only DB-bruker. Setter `APP_PG_CONNECTION_STRING` mot staging/
prod-DB og pipe output til loggfil:

```bash
APP_PG_CONNECTION_STRING="$STAGING_PG_READ_ONLY_URL" \
  npm --prefix apps/backend run reconcile:wallet-ledger -- \
  --from 2026-08-01 --to 2026-08-31 \
  --format markdown \
  > /var/log/wallet-ledger-recon.md \
  2>> /var/log/wallet-ledger-recon.err
```

## CLI-flagg

| Flagg | Påkrevd | Default | Formål |
|---|---|---|---|
| `--from <YYYY-MM-DD>` | Ja | — | Start-dato (Europe/Oslo, inklusiv). |
| `--to <YYYY-MM-DD>` | Nei | i dag | End-dato (Europe/Oslo, inklusiv). |
| `--hall <hallId>` | Nei | alle | Filtrer ledger-side til én hall. |
| `--format <markdown\|json\|csv>` | Nei | `markdown` | Output-format. |
| `--db-url <conn>` | Nei | env | Override `APP_PG_CONNECTION_STRING`. |
| `--output <file>` | Nei | stdout | Skriv rapport til fil. |

## Valgfri env-vars

| Var | Default | Formål |
|---|---|---|
| `APP_PG_CONNECTION_STRING` | — | Primær connection string. |
| `WALLET_PG_CONNECTION_STRING` | — | Alias. |
| `WALLET_PG_TEST_CONNECTION_STRING` | — | Alias (matcher test-env). |
| `APP_PG_SCHEMA` | `public` | Schema-navn (sanitized til `[a-zA-Z0-9_]`). |

## Exit-codes

| Code | Betydning |
|---|---|
| `0` | `isReconciled=true` — alt stemmer. |
| `1` | Divergens detektert (walletOnly / ledgerOnly / amountMismatch). |
| `2` | Runtime-feil (DB ikke tilgjengelig, schema mangler, ugyldig CLI-arg, etc.). |

## Forventet output (markdown)

```
=== G9: Wallet vs Compliance Ledger reconciliation ===
Period           : 2026-08-01 → 2026-08-31 (Europe/Oslo)
Hall filter      : (alle)
Format           : markdown
...

# Wallet-vs-Ledger Reconciliation

Period: 2026-08-01 → 2026-08-31

## Summary

| Metric | Wallet (NOK) | Ledger (NOK) | Diff |
|---|---:|---:|---:|
| Total stakes (NOK) | 1 234 567,50 | 1 234 567,50 | 0 OK |
| Total prizes (NOK) | 987 654,30 | 987 654,30 | 0 OK |
| Stake event count | 8523 | 8523 | 0 OK |
| Prize event count | 1247 | 1247 | 0 OK |

## Per-hall breakdown (ledger-side)

| Hall | Game type | Side | Amount (NOK) | Count |
|---|---|---|---:|---:|
| demo-hall-001 | MAIN_GAME | STAKE | 500 000,00 | 3500 |
| demo-hall-001 | MAIN_GAME | PRIZE | 400 000,00 | 500 |
| demo-hall-002 | MAIN_GAME | STAKE | 734 567,50 | 5023 |
...

## Divergens-deteksjon

_(ingen divergens detektert — wallet og ledger er konsistente)_

## Status

**RECONCILED** — wallet og ledger stemmer overens. Eksisterer 0 divergens.
```

## CI/cron-integrasjon

**Anbefalt:** kjør én gang i døgnet (off-peak) som GitHub Action eller
intern cron-job. Etter pilot bør dette være daglig. Ved exit-code `1` bør
PagerDuty/Slack-alert fyres umiddelbart — divergens er high-severity.

Eksempel cron-snippet:

```bash
0 5 * * *  cd /opt/spillorama && \
  YESTERDAY=$(date -d 'yesterday' +%Y-%m-%d) && \
  APP_PG_CONNECTION_STRING="$WALLET_RO_URL" \
  npm --prefix apps/backend run reconcile:wallet-ledger -- \
  --from "$YESTERDAY" --to "$YESTERDAY" --format markdown \
  > /var/log/wallet-ledger-recon-$(date +\%Y-\%m-\%d).log 2>&1 || \
  /opt/spillorama/bin/page-ops.sh "wallet-ledger divergens detektert"
```

## Recovery ved divergens

Hvis CLI returnerer exit-code `1`, følg denne eskaleringsstien:

1. **Identifiser scope** — les rapporten. Sjekk om divergens er konsentrert
   til én hall, én dato eller én event-type. CSV-output (`--format csv`)
   kan importeres til Excel for grupperings-analyse.
2. **Klassifisér severity:**
   - `walletOnlyBuckets` (wallet uten §71-rapport): **Lotteritilsynet 24t
     reporting-vindu** — dette er regulatorisk-tung. Eskaler umiddelbart
     til compliance-eier.
   - `ledgerOnlyBuckets` (§71 uten wallet): **Mistenkelig — undersøk om
     phantom-rapport eller tapt wallet-rad**. Eskaler til wallet-eier.
   - `amountMismatches`: **Høy risiko**. Sjekk audit-events for vedkommende
     wallet/dato. Vanligste årsak: bug i payout-flyten.
3. **Korrelér med audit-log** — kjør:
   ```sql
   SELECT * FROM app_compliance_audit_log
   WHERE created_at BETWEEN '<from>' AND '<to>'
   ORDER BY created_at DESC LIMIT 100;
   ```
   Mismatched events bør ha tilhørende audit-entries — manglende
   audit-trail er ekstra alvorlig.
4. **Verifiser hash-chain også** — kjør `npm run verify:audit-chain`. Hvis
   hash-chain er broken samtidig som reconciliation feiler → tampering-
   mistanke. Følg `docs/compliance/AUDIT_HASH_CHAIN_VERIFICATION_2026-Q3.md`.
5. **Compliance-rapport** — hvis bekreftet brudd må Lotteritilsynet
   informeres innen 24t per pengespillforskriften §71.

## Sikkerhet

- **Read-only** — alle queries er `SELECT`. Aldri INSERT/UPDATE/DELETE.
- **Idempotent** — kan kjøres flere ganger med samme input uten side-effekt.
- **Anbefalt:** bruk dedikert read-only DB-bruker mot prod.

## Tester

- Unit: `apps/backend/scripts/__tests__/walletLedgerReconciliation.test.ts`
  — 56 tester for klassifisering, aggregering, diff og output-formattering.
  Kjøres som del av `npm test`.
- Integration: `apps/backend/src/__tests__/walletLedgerReconciliation.integration.test.ts`
  — 7 tester mot ekte Postgres. Skip-graceful: krever
  `WALLET_PG_TEST_CONNECTION_STRING`.

## Begrensninger (per 2026-Q3)

- **Hall-mismatch detekteres ikke direkte** — matching-nøkkel er
  `(walletId, businessDate, side)`, ikke `(walletId, hallId, ...)`. Dette
  fordi wallet-laget ikke alltid kjenner hallId for en transaksjon. Per-hall
  ledger-breakdown vises separat så ops kan inspisere.
- **Refunds excluderes** — Wallet-credit-tilbake (refund-flyt) skriver
  ingen negativ STAKE i ledger; vi excluderer derfor refund-events fra
  matching for å unngå falsk-positiv.
- **Bare game-relaterte transaksjoner matches** — TOPUP, WITHDRAWAL og
  generiske TRANSFER excluderes. Heuristikk basert på
  `idempotency_key`-prefix og `reason`-substring (se
  `classifyWalletTransaction` i `lib/walletLedgerReconciliation.ts`).
- **Trinn 1 av 2 — `app_regulatory_ledger`** (Blokk 1.12 / G2-G4 PR #1102)
  ikke inkludert ennå. Når den lander, må reconciliation utvides til å
  også sammenligne mot den nye ledger-implementasjonen.

## Arkitektur

Scriptet er bygget med separasjon mellom:

- **Pure logic** (`scripts/lib/walletLedgerReconciliation.ts`) — klassifisering,
  aggregering, diff, output-formattering. Testbar uten DB.
- **CLI entry point** (`scripts/reconcile-wallet-vs-ledger.ts`) — CLI-arg-parsing,
  DB-queries, schema-probe, output-routing.

Dette gjør det enkelt å:

- Unit-teste matching-logikken med syntetiske fixtures (56 tester).
- Integration-teste mot ekte Postgres (7 tester).
- Senere wrappe pure-logic i en HTTP-endpoint hvis admin-UI trenger live-rapport.
