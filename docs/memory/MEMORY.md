# Project Memory — Spillorama-system

**Sist oppdatert:** 2026-05-10
**Eier:** Tobias Haugen
**Formål:** Fakta og kontekst som AI-agenter (Claude/Cowork) skal ha tilgang
til på tvers av sesjoner. Auto-loaded via `@docs/memory/MEMORY.md` i CLAUDE.md.

> **Til AI-agent:** Dette dokumentet er kortform-kontekst. Det erstatter ikke
> `MASTER_README.md` eller `PM_ONBOARDING_PLAYBOOK.md` — det gir deg de fakta
> du trenger uten å lete. Sjekk dette FØR du bruker tid på Grep/Read.
>
> **Til ny PM:** Oppdater dette når du oppdager fakta som overlever sesjon
> (en ny vendor, en ny rolle, en ny terskelverdi som har vært diskutert).
> Hold den **kort og faktisk** — ikke gjenta innhold fra andre kanoniske docs;
> lenk dit istedenfor.

---

## 1. Bruker-profil

**Tobias Haugen** — teknisk lead, prosjekt-eier, eneste CODEOWNER.

**Kontakt:**
- E-post: tobias@nordicprofil.no (offisiell), post@lappeland.no (privat)
- Selskap: Nordicprofil

**Foretrukne arbeidsmåter:**
- Quality > speed (direktiv 2026-05-05)
- Tobias rør ALDRI git lokalt — PM eier `git pull` etter hver merge
- Hot-reload tar resten — Tobias refresher nettleseren
- Foretrekker norsk i docs og kommunikasjon
- Ingen emojier i docs/handoffs med mindre han eksplisitt ber om det

---

## 2. Pilot-status (2026-05-10)

| Fase | Status |
|---|---|
| 4-hall pilot Q3 2026 | Pilot-prep — Spill 1, 2, 3 LIVE på prod, R-tiltak pågår |
| Pilot-haller | Teknobingo Årnes (master), Bodø, Brumunddal, Fauske |
| Pilot-skala (mål) | 24 haller × 1500 spillere = 36 000 samtidige |
| Prod-URL | https://spillorama-system.onrender.com/web/ |
| Region | Render Frankfurt (single-region) |

**Aktive pilot-blokkere:** Se [`BACKLOG.md`](../../BACKLOG.md) — top: engine-
refactor for system-actor (Wave 1), strukturerte error-codes (Fase 2A),
trace-ID propagation (MED-1).

---

## 3. Spill-katalog (kort)

| Marketing | Slug | Kategori | §11 | Arkitektur |
|---|---|---|---|---|
| Spill 1 | `bingo` (game1) | Hovedspill | 15 % | Per-hall + GoH-master + plan-runtime |
| Spill 2 | `rocket` (game2) | Hovedspill | 15 % | ETT globalt rom, perpetual loop |
| Spill 3 | `monsterbingo` (game3) | Hovedspill | 15 % | ETT globalt rom, phase-state-machine |
| Spill 4 / SpinnGo | `spillorama` (game5) | Databingo | 30 % + 2500 kr cap | Player-startet |
| Candy | `candy` | Tredjeparts | (eksternt) | Iframe + wallet-bro |

**`game4` / `themebingo` er deprecated (BIN-496).** Ikke bruk.

Autoritativ: [`docs/architecture/SPILLKATALOG.md`](../architecture/SPILLKATALOG.md).

---

## 4. Tobias' immutable direktiver (sammendrag)

Full tekst i [`PM_ONBOARDING_PLAYBOOK.md §2`](../engineering/PM_ONBOARDING_PLAYBOOK.md).
Disse overstyrer alt:

1. Quality > speed. Død kode slettes, ikke kommenteres ut.
2. Tobias rør ikke git lokalt — PM eier git-flyt.
3. PM verifiserer CI etter PR-åpning.
4. Doc-en vinner over kode.
5. Spill 1, 2, 3 har FUNDAMENTALT forskjellige arkitekturer.
6. Spillkatalog er kanonisk (vedtatt 2026-04-25).
7. PM-sentralisert git-flyt (ADR-0009).
8. Done-policy: kun når merget til main + file:line + grønn CI (ADR-0010).
9. Live-rom 99.95 % oppetid mandat (LIVE_ROOM_ROBUSTNESS_MANDATE).
10. 4-hall pilot først, 24-hall betinger 2-4 ukers stabilitet.
11. Skill-loading lazy per-task.

---

## 5. Tech-stack (kort)

Node 22 + Express 4.21 + Socket.IO 4.8 + Postgres 16 + Redis 7 + Vite 6.3 +
Pixi.js 8.6 + TypeScript 5.8-5.9 strict + vitest + tsx --test.
Render Frankfurt, Blue-Green deploys, auto fra `main`.

---

## 6. Sesjons-protokoll (raskt)

**Ved start av sesjon:**
```bash
./scripts/pm-onboarding.sh > /tmp/pm-onboarding.md
# Les den. Sjekk forrige PM_HANDOFF i docs/operations/.
```

**Ved sesjons-slutt:**
- Skriv handoff i `docs/operations/PM_HANDOFF_YYYY-MM-DD[_sessionN].md`
- Oppdater BACKLOG hvis pilot-blokker-status endret seg
- Hvis arkitekturbeslutning: skriv ADR i `docs/adr/`
- Hvis ny risiko: oppdater `docs/RISKS.md`
- Hvis incident: skriv postmortem i `docs/postmortems/`

---

## 7. Kanoniske kilder (les-rekkefølge ved usikkerhet)

| Spørsmål | Sannhets-kilde |
|---|---|
| Hva er systemet? | [`MASTER_README.md`](../../MASTER_README.md) |
| Hvilken retning vil vi? | [`docs/SYSTEM_DESIGN_PRINCIPLES.md`](../SYSTEM_DESIGN_PRINCIPLES.md) |
| Hvilke spill og hvordan klassifisert? | [`docs/architecture/SPILLKATALOG.md`](../architecture/SPILLKATALOG.md) |
| Hva er payout-reglene? | [`docs/architecture/SPILL_REGLER_OG_PAYOUT.md`](../architecture/SPILL_REGLER_OG_PAYOUT.md) |
| Hvorfor er Spill 1/2/3 forskjellige? | `SPILL[1\|2\|3]_IMPLEMENTATION_STATUS_2026-05-08.md` i `docs/architecture/` |
| Hva er åpne pilot-blokkere? | [`BACKLOG.md`](../../BACKLOG.md) |
| Hvilke risikoer er kjent? | [`docs/RISKS.md`](../RISKS.md) |
| Hva har skjedd før (incidenter)? | [`docs/postmortems/`](../postmortems/) |
| Hvor finner jeg X? | [`docs/INVENTORY.md`](../INVENTORY.md) |
| Hva betyr begrep Y? | [`docs/GLOSSARY.md`](../GLOSSARY.md) |
| Hvor er credentials? | [`docs/operations/CREDENTIALS_AND_ACCESS.md`](../operations/CREDENTIALS_AND_ACCESS.md) |
| Hvilke vendors? | [`docs/operations/VENDORS.md`](../operations/VENDORS.md) |
| Hvem snakker jeg med om hva? | [`docs/operations/STAKEHOLDERS.md`](../operations/STAKEHOLDERS.md) |
| Tobias utilgjengelig + prod brenner? | [`docs/operations/EMERGENCY_RUNBOOK.md`](../operations/EMERGENCY_RUNBOOK.md) |
| Når kan jeg delegere review? | [`docs/operations/BUS_FACTOR_PLAN.md`](../operations/BUS_FACTOR_PLAN.md) |

---

## 8. Connectors og MCP-er

| Connector | Status | Bruk |
|---|---|---|
| Linear MCP | ✅ Koblet (per 2026-05-10) | Bruk MCP-tools for issues. Eksempler i `PM_ONBOARDING_PLAYBOOK.md §4.5` |
| Render MCP | ❌ Ikke tilgjengelig per 2026-05-10 | Bruk `secrets/render-api.local.md` |
| Slack MCP | (verifiser) | — |
| GitHub MCP | (innebygd i Cowork) | PR-mgmt, issues, workflow-runs |
| Cowork artifacts | ✅ Innebygd | Lag live PM-dashboard — se `PM_DASHBOARD.md` |

Når en ny MCP kobles: oppdater denne tabellen + relevant entry i
`CREDENTIALS_AND_ACCESS.md`.

**For ny PM:** Verifiser MCP-er ved oppstart med
"List alle MCP-tools du har tilgang til (mcp__*)" i Cowork-chat.

---

## 9. Kjente fallgruver (kort — full liste i RISKS.md)

- **Bus-faktor 1:** Tobias eneste reviewer/admin (R-001)
- **Spill 2/3 er globalt rom:** En henging tar ned for alle (R-004)
- **Auto-deploy fra main:** Må verifisere CI før merge er trygt (R-007)
- **Render single-region:** Frankfurt er eneste region (R-003)

---

## 10. Antall

| Telleri | Verdi (per 2026-05-10) |
|---|---|
| Markdown-filer i `docs/` | ~421 |
| Skills i `.claude/skills/` | 35 |
| GitHub Actions workflows | 20 |
| ADR-er (i `docs/adr/`) | 16 (vurder denne ved nye ADR-er) |
| PM-handoffs i `docs/operations/` | 9+ |
| Pilot-haller (Q3 2026) | 4 |
| Pilot-skala (mål) | 36 000 samtidige |

---

## 11. Automatisering (sist lagt til 2026-05-10)

Disse genererer dokumentasjon automatisk — ikke endre manuelt:

| Generator | Trigger | Output |
|---|---|---|
| `auto-generate-docs.yml` | Push til main + cron | `docs/auto-generated/{API_ENDPOINTS,DB_SCHEMA_SNAPSHOT,...}.md` |
| `doc-freshness.yml` | Fredag 14:00 UTC + workflow_dispatch | `docs/auto-generated/DOC_FRESHNESS.md` |
| `weekly-status-digest.yml` | Fredag 14:00 UTC + workflow_dispatch | `docs/status/YYYY-Wnn.md` |
| `architecture-lint.yml` | Hver PR | Failure hvis dependency-cruiser-regel brytes |

For PM-en betyr dette: man trenger sjelden å skrive status manuelt. Sjekk
`docs/status/` for nyeste digest, og `docs/auto-generated/DOC_FRESHNESS.md`
for hvilke kanoniske docs som er stale.

---

**Når noe i dette dokumentet er utdatert: oppdater det.** Dette er en levende
referanse, ikke et historisk dokument. Se også
[`docs/INVENTORY.md`](../INVENTORY.md) for full klassifisering av docs.
