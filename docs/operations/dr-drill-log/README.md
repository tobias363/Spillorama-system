# DR Drill Log

**Owner:** Backend on-call (kvartalets vakthavende)
**Approver:** Technical lead (Tobias Haugen)
**Compliance-observer:** Compliance-eier
**Linked:** [`docs/operations/DR_RUNBOOK.md`](../DR_RUNBOOK.md), [BIN-772](https://linear.app/bingosystem/issue/BIN-772)

Denne mappen inneholder logger fra kvartalsvise Disaster Recovery-drills. Hver
drill produserer én loggfil etter konvensjonen:

```
<yyyy>-Q<N>.md
```

Eksempler:

- `2026-Q2.md` — drill kjørt i Q2 2026
- `2026-Q3.md` — drill kjørt i Q3 2026

---

## Når kjøres et drill

| Kvartal | Måned | Fokus |
| --- | --- | --- |
| **Q1** (pre-pilot) | uke 0-2 før første hall | **Bevis at restore fungerer.** Pilot-gating-krav. |
| **Q2** | pilot uke 8-9 | Verifisering etter første pilot-måned. |
| **Q3** | pilot uke 20-22 | Skala-test mot full pilot-data-volum. |
| **Q4** | annual review | End-to-end inkl. region-failover-vurdering. |

---

## Hvordan kjøres et drill

```bash
# Default: lokal Docker Postgres + manuelt nedlastet snapshot
SNAPSHOT_FILE=/path/to/spillorama-snapshot.dump \
  bash infra/dr-drills/quarterly-restore-drill.sh

# Eller mot dedikert staging
DR_DRILL_TARGET=staging \
  STAGING_DB_URL='postgres://...' \
  SNAPSHOT_FILE=/path/to/spillorama-snapshot.dump \
  bash infra/dr-drills/quarterly-restore-drill.sh
```

Se [`docs/operations/DR_RUNBOOK.md`](../DR_RUNBOOK.md) §3 for full drill-prosedyre.

---

## Loggfil-template

Kopier følgende til `<yyyy>-Q<N>.md` for hver drill. Fyll inn faktiske verdier
før sign-off.

```markdown
# DR Drill — <yyyy>-Q<N>

**Drill-id:** <yyyy>-Q<N>-<YYYYMMDD>-<HHMMSS>
**Dato kjørt (UTC):** <YYYY-MM-DD HH:MM>
**Drill-eier:** <navn>
**Approver:** Tobias Haugen
**Compliance-observer:** <navn>
**Miljø:** <docker | staging>
**Snapshot-fil:** <path | sha256>
**Snapshot-timestamp:** <YYYY-MM-DD HH:MM UTC>

---

## 1. Forutsetninger

- [ ] `pro`-plan aktivert på Postgres-tjenesten? <ja | nei>
- [ ] Siste snapshot lastet ned? <ja>
- [ ] Verktøy: psql, pg_restore, docker tilgjengelig? <ja>

## 2. Drill-script-output

Lim inn full stdout fra `quarterly-restore-drill.sh`:

```
[HH:MM:SS] Drill-id: 2026-Q2-20260615-143000
[HH:MM:SS] Mode: restore | Target: docker
...
[HH:MM:SS] Drill 2026-Q2-20260615-143000: PASS
```

## 3. Tids-måling

| Fase | Start (UTC) | Slutt (UTC) | Varighet |
| --- | --- | --- | --- |
| Snapshot-nedlasting | | | |
| Docker spin-up | | | |
| Restore | | | |
| Integritets-sjekker | | | |
| **Total** | | | < 4 timer (RTO-krav) |

## 4. Integritets-sjekker

| Sjekk | Resultat | Verdi/avvik |
| --- | --- | --- |
| pgmigrations-tabell finnes | PASS / FAIL | |
| Hovedtabeller eksisterer | PASS / FAIL | |
| Hovedtabeller har data | PASS / FAIL | |
| Ingen orphan wallets | PASS / FAIL | |
| Audit-trail monotonisk | PASS / FAIL | |
| Compliance-ledger unike keys | PASS / FAIL | |
| Migration-konsistens | PASS / FAIL | applied=N, files=N |
| RTO innenfor budsjett (< 4t) | PASS / FAIL | total=Ns |

## 5. Avvik

<Beskrivelse av eventuelle FAIL-eller observasjoner som krever oppfølging.
Hvis ingen, skriv "Ingen avvik observert.">

## 6. Pilot-impact

- [ ] PASS — pilot-gating OK, første hall kan flippes (Q1) eller pilot fortsetter (Q2-Q4)
- [ ] FAIL — pilot pauses til avvik er løst. Linear-issue: <BIN-...>

## 7. Tiltak / oppfølging

- <Liste over PR-er/issues som må lukkes før neste drill>

## 8. Sign-off

| Rolle | Navn | Dato | Signatur (Linear-kommentar-link) |
| --- | --- | --- | --- |
| Drill-eier | | | |
| Technical lead (Tobias) | | | |
| Compliance-observer | | | |

## 9. Vedlegg

- Full drill-script-stdout: <commit-SHA / Linear-link>
- Render snapshot-id: <id>
- Eventuelle screenshots fra Render-dashboard: <link>
```

---

## Pass-kriterier (oppsummering)

Et drill er **PASS** hvis:

- ✅ Snapshot kunne lastes ned/aksesseres
- ✅ Restore kunne kjøres mot tom Postgres
- ✅ Alle integritets-sjekker passerte (script returnerer exit 0)
- ✅ Total tid fra trigger til smoke passerer er < 4 timer
- ✅ Restore-timestamp er maks 5 min bak disaster-timestamp (RPO)

Et drill er **FAIL** hvis ett eller flere av kravene over ikke er oppfylt.

**Konsekvens av FAIL:** Pilot-pause. Første hall kan ikke flippes (Q1) eller pilot må pause (Q2-Q4) før FAIL er løst.

---

## Indeks

| Drill | Status | Eier | Linear |
| --- | --- | --- | --- |
| 2026-Q1 (pre-pilot) | _ikke kjørt_ | TBD | _pending_ |
| 2026-Q2 | _ikke kjørt_ | TBD | _pending_ |
| 2026-Q3 | _ikke kjørt_ | TBD | _pending_ |
| 2026-Q4 | _ikke kjørt_ | TBD | _pending_ |

Oppdater denne tabellen etter hver drill.
