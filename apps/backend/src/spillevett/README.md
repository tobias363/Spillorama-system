# Module: `apps/backend/src/spillevett`

**Sist oppdatert:** 2026-05-06
**Eier:** Tobias Haugen
**LOC:** ~3 251

## Ansvar

Spillvett (responsible gaming) - spiller-vendt:
- Aktivitetsrapport per periode (today, last7, last30, last365, custom)
- PDF-eksport (download eller email)
- Per-hall netto-tap-data
- Mandatory pause-tracking (60 min spilt → 5 min pause)
- Karenstid for limit-økning

## Ikke-ansvar

- Limits enforcement (delegert til `compliance/`)
- Wallet-mutering (delegert til `wallet/`)
- Spillvett-frontend (live i `web/spillvett.js`)

## Public API

| Service | Funksjon |
|---|---|
| `SpillevettReportService` | Genererer aktivitetsrapport |
| `SpillevettExportService` | PDF-eksport + email |
| `MandatoryPauseService` | 60-min pause-tracking |

HTTP-endepunkter:
- `GET /api/spillevett/report?period=...&hallId=...`
- `POST /api/spillevett/report/export` (PDF download/email)

## Invariants

1. **Fail-closed:** hvis report-service nede, blokker spill
2. **Per-hall netto-tap:** ikke aggregert på tvers (regulatorisk)
3. **PDF inkluderer alle relevante perioder** (BIN-XXX)

## Referanser

- `docs/compliance/SPILLVETT_HANDOVER_CHECKLIST_2026-04-11.md`
- ADR-007 (spillkatalog)
- pengespillforskriften §66 (mandatory pause)
