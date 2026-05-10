# `docs/status/` — Ukentlige digester

**Sist oppdatert:** 2026-05-10
**Eier:** Tobias Haugen
**Auto-generert:** Ja, av `.github/workflows/weekly-status-digest.yml` hver fredag kl 14:00 UTC

---

## Hva er dette

Automatisk samlede ukesrapporter — én markdown-fil per ISO-uke. Hver fil
inneholder:

- Antall commits + kategorisering (feat/fix/docs/test/chore/refactor/perf)
- PM-handoffs som ble skrevet i uken
- Postmortems som ble skrevet i uken
- Nye ADR-er
- Snapshot av BACKLOG ved generering

**Filnavn-format:** `YYYY-Wnn.md` (eks: `2026-W19.md` = uke 19 av 2026,
mandag 4. mai til søndag 10. mai)

---

## Hvorfor

PM-handoffs dekker enkeltsesjoner. ADR-er dekker enkelt-beslutninger. Men
**utvikling over tid** er et eget signal — har vi flere bugs enn features?
Stiger postmortem-frekvensen? Hvilken kategori dominerer commit-volumet?

Disse digestene gir:

1. **Trend-data** — bla bakover for å se utvikling over måneder
2. **PM-overlevering** — ny PM ser hva som har skjedd uten å lese hver handoff
3. **Stakeholder-rapportering** — kan kopieres til ukesrapport for eksterne
4. **Dokumentasjon som vedlikeholder seg selv** — ingen manuell skriving

---

## Manuell generering

```bash
# Nåværende uke
node scripts/generate-weekly-status.mjs

# Spesifikk uke
node scripts/generate-weekly-status.mjs --week=2026-W19

# Print til stdout uten å lagre
node scripts/generate-weekly-status.mjs --dry-run
```

---

## Hva er IKKE her

- **Linear-issues:** Ikke automatisk integrert ennå (krever LINEAR_API_KEY i
  GitHub Secrets). Når den legges til: utvid `generate-weekly-status.mjs` med
  Linear GraphQL-kall.
- **Test-/CI-statistikk:** Vurder å legge til `npm test` summary-output ved
  ukens slutt.
- **Performance-budget-trend:** Vurder å aggregere fra
  `scripts/performance-budget/baseline.json` over tid.
- **Spillevett-/compliance-metrics:** Vurder daglig versjon hvis pilot
  trenger tettere oppfølging.

Forbedringer foreslås i [`BACKLOG.md`](../../BACKLOG.md) eller som ADR.

---

## Indeks

(Genereres ikke automatisk — bla i mappen for å se alle. Files sorteres
naturlig kronologisk på filnavn.)

Eldste fil: 2026-W19 (denne uken er bootstrap)

---

**Se også:**
- [`docs/operations/PM_HANDOFF_*.md`](../operations/) — sesjons-handoffs
- [`CHANGELOG.md`](../../CHANGELOG.md) — semver-versjoner
- [`BACKLOG.md`](../../BACKLOG.md) — åpne pilot-blokkere
- [`docs/postmortems/`](../postmortems/) — incidenter
- [`docs/RISKS.md`](../RISKS.md) — kjente risikoer
