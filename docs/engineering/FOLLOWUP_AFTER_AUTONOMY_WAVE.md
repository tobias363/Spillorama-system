# Followup etter Autonomy-bølgen (2026-05-13)

**Status:** Aktiv tracker
**Etablert:** 2026-05-13 (etter Tobias-direktivet om vanntett selv-forbedrende kunnskapsbase)
**Eier:** PM-AI
**Formål:** Spor 🟡-funn fra cross-knowledge-audit + ℹ️-observasjoner som ikke kvalifiserer for separat Linear-issue, men som bør lukkes innen rimelig tid.

---

## Hvordan denne filen brukes

| Kolonne | Betydning |
|---|---|
| **Severity** | 🔴 RED / 🟡 YELLOW / ℹ️ INFO (matcher audit-rapport-konvensjonen) |
| **Owner** | PM-AI hvis ingen annen er tilordnet; ellers personen/rolle som skal fikse |
| **Cadence** | Når neste sjekk skal skje (`next-audit` / `before-pilot-launch` / `opportunistic`) |
| **Source** | Hvor funnet oppstod (audit-kjøring, PR-review, Tobias-direktiv, runtime) |

Når du lukker en TODO, flytt linjen til "Lukket"-seksjon nederst og legg på commit-SHA + dato.

---

## Åpne TODO-er

### Fra cross-knowledge-audit 2026-05-13 (initial post-deploy-kjøring)

| ID | Severity | Beskrivelse | Owner | Cadence | Source |
|---|---|---|---|---|---|
| CKA-001 | ℹ️ | **Konfigurer Linear-API-key for CI.** Check 1 kjører ikke i CI uten dette. Hvis Linear MCP-tilgang allerede dekker dette for daglig bruk, vurder å beholde CI som --no-linear og bare manuell-kjøring som benytter MCP. | Tobias / PM-AI | opportunistic | audit 2026-05-13 |
| CKA-002 | ℹ️ | **Vurder å trigge cross-knowledge-audit på `push` til main når ≥ 5 PR-er er merget siden forrige rapport.** Ukentlig (mandag) er rimelig for normal drift-deteksjon, men 20+-PR-dager (som 2026-05-13) gir drift-akkumulering som lever 7 dager før neste audit. Forslag: legg til `if: contains(github.event.head_commit.message, '#auto-audit-trigger')` eller smartere telling. | PM-AI | next-audit | audit 2026-05-13 lærdom |
| CKA-003 | ℹ️ | **PM-handoff-status-tabeller bør auto-oppdateres mot `gh pr view`.** Når 8+ PR-er merges på samme dag som handoff skrives, blir 🟡 OPEN-statusene stale innen timer. Forslag: script som matcher PR-numre i handoff mot `gh pr view --json state` og foreslår oppdateringer (kjøres post-deploy som review-step). | PM-AI | opportunistic | audit 2026-05-13 lærdom |

### Fra fragility-analyse 2026-05-13

| ID | Severity | Beskrivelse | Owner | Cadence | Source |
|---|---|---|---|---|---|
| FRG-001 | ℹ️ | **Følg `tests/e2e/spill1-pilot-flow.spec.ts` og `spill1-manual-flow.spec.ts` cluster.** Begge har 2 FRAGILITY-entries hver (F-01/F-02, F-02/F-03). Hvis disse passerer 3-tersklen, vurder å splitte testene per scenario (auth-redirect-flow vs token-inject vs reconcile). Ikke krit per 2026-05-13. | PM-AI | next-audit | fragility-summary 2026-05-13 |

---

## Lukket

(Tomt — populeres ettersom TODO-er lukkes med commit-SHA + dato)

---

## Endringslogg

| Dato | Endring | Forfatter |
|---|---|---|
| 2026-05-13 | Initial — CKA-001/002/003 og FRG-001 fra første post-deploy-audit-kjøring | Agent (C2 audit-follow-up) |
