# Spillorama-system — Master README

**Sist oppdatert:** 2026-05-06
**Eier:** Tobias Haugen
**Formål:** Én sannhets-kilde for hva Spillorama er, hvor du finner svar, og hvilken retning vi vil.

> **Til ny prosjektleder eller utvikler:** Les dette dokumentet (10 minutter), deretter
> [`docs/SYSTEM_DESIGN_PRINCIPLES.md`](./docs/SYSTEM_DESIGN_PRINCIPLES.md) (10 minutter), så
> [`BACKLOG.md`](./BACKLOG.md) (10 minutter). Etter 30 minutter forstår du systemet, retningen,
> og hva som er åpent. Alt annet er detalj.

---

## 30-sekund-pitch

Spillorama er en norsk live-bingo-plattform med mål om **casino-grade kvalitet på linje med
Evolution Gaming og Playtech Bingo**. Vi driver tre hovedspill (Spill 1, 2, 3) live, én databingo
(SpinnGo / Spill 4) og integrerer Candy som tredjeparts iframe. Pilot-skala 2026: **24 haller ×
1500 spillere = 36 000 samtidige**.

**Regulert:** pengespillforskriften (Lotteritilsynet). Vi er pengespill-operatør, ikke
white-label-platform.

---

## 5-min-oversikt

### Tre-tier-arkitektur

```
Spillere (web/iOS/Android)        →  Pixi.js game-client (packages/game-client)
                                     ↓ Socket.IO + HTTPS
                                  →  Backend (apps/backend)
                                     ↓ TLS
                                  →  PostgreSQL 16 + Redis 7
Hall-operatører/agenter           →  Admin-web (apps/admin-web) + Agent-portal
                                     ↓ HTTPS
                                  →  Backend
Candy (tredjeparts)               ↔  Wallet-bro (`/api/ext-wallet/*`) + iframe
```

**Server er sannhets-kilde.** Klient er view. Alt regulatorisk validerers backend-side.

### Spill-katalog (autoritativ — se [`docs/architecture/SPILLKATALOG.md`](./docs/architecture/SPILLKATALOG.md))

| Markedsføring | Kode | Slug | Kategori | Modell |
|---|---|---|---|---|
| Spill 1 | game1 | `bingo` | Hovedspill (15%) | Master-styrt per hall |
| Spill 2 | game2 | `rocket` | Hovedspill (15%) | ETT globalt rom (perpetual) |
| Spill 3 | game3 | `monsterbingo` | Hovedspill (15%) | ETT globalt rom (perpetual) |
| SpinnGo (Spill 4) | game5 | `spillorama` | Databingo (30%) | Player-startet |
| Candy | — | `candy` | Tredjeparts iframe | Eksternt |

**Game 4 / `themebingo` er deprecated (BIN-496). Ikke bruk.**

**Pilot 2026-05:** Spill 1, 2, 3 — alle skal være pilot-klare (Tobias-direktiv 2026-05-05).

### Pilot-skala

- **24 haller, 1500 spillere per hall, 36 000 samtidige**
- Frankfurt-region, Render.com Blue-Green deploys
- Postgres som System of Record + Redis som rom-state-cache

---

## Hvor finner du svar på X

### Arkitektur og design
- **Hva systemet er:** [`docs/architecture/ARKITEKTUR.md`](./docs/architecture/ARKITEKTUR.md)
- **Hvilken retning vi vil:** [`docs/SYSTEM_DESIGN_PRINCIPLES.md`](./docs/SYSTEM_DESIGN_PRINCIPLES.md)
- **Hvilke moduler finnes:** [`docs/architecture/MODULES.md`](./docs/architecture/MODULES.md) (master-index)
- **Spill-klassifisering:** [`docs/architecture/SPILLKATALOG.md`](./docs/architecture/SPILLKATALOG.md)
- **Casino-grade-mål:** [`docs/architecture/CASINO_GRADE_ARCHITECTURE_RESEARCH_2026-04-28.md`](./docs/architecture/CASINO_GRADE_ARCHITECTURE_RESEARCH_2026-04-28.md)

### Beslutninger og historikk
- **Hvorfor vi bygde det slik:** [`docs/decisions/`](./docs/decisions/) (ADR-er)
- **Hva som ble levert når:** [`docs/operations/`](./docs/operations/) (PM_HANDOFF_*.md serien)
- **Spillkatalog:** [`docs/architecture/SPILLKATALOG.md`](./docs/architecture/SPILLKATALOG.md)

### Operasjonelle oppgaver
- **Hvordan deploye:** [`docs/operations/PILOT_CUTOVER_RUNBOOK.md`](./docs/operations/PILOT_CUTOVER_RUNBOOK.md)
- **Hvordan kjøre pilot:** [`docs/operations/PILOT_RUNBOOK_SPILL2_3_2026-05-05.md`](./docs/operations/PILOT_RUNBOOK_SPILL2_3_2026-05-05.md)
- **Hvordan rolle tilbake:** [`docs/operations/ROLLBACK_RUNBOOK.md`](./docs/operations/ROLLBACK_RUNBOOK.md)
- **Migration-deploy:** [`docs/operations/MIGRATION_DEPLOY_RUNBOOK.md`](./docs/operations/MIGRATION_DEPLOY_RUNBOOK.md)
- **Disaster recovery:** [`docs/operations/DISASTER_RECOVERY_PLAN_2026-04-25.md`](./docs/operations/DISASTER_RECOVERY_PLAN_2026-04-25.md)

### Engineering-prosess
- **PR-flyt og review:** [`docs/engineering/ENGINEERING_WORKFLOW.md`](./docs/engineering/ENGINEERING_WORKFLOW.md)
- **Sesjons-overlevering:** [`docs/SESSION_HANDOFF_PROTOCOL.md`](./docs/SESSION_HANDOFF_PROTOCOL.md)
- **API-spec:** [`apps/backend/openapi.yaml`](./apps/backend/openapi.yaml)
- **Event-protokoll:** [`docs/architecture/EVENT_PROTOCOL.md`](./docs/architecture/EVENT_PROTOCOL.md)

### Compliance og regulatorisk
- **Pengespillforskriften-grunnlag:** [`docs/compliance/`](./docs/compliance/)
- **RNG-sertifisering:** [`docs/compliance/KRITISK1_RNG_ALGORITMEBESKRIVELSE.md`](./docs/compliance/KRITISK1_RNG_ALGORITMEBESKRIVELSE.md)
- **Spillvett-krav:** [`docs/compliance/SPILLVETT_HANDOVER_CHECKLIST_2026-04-11.md`](./docs/compliance/SPILLVETT_HANDOVER_CHECKLIST_2026-04-11.md)

### Modul-detaljer (per-modul README)
- **Backend-moduler:** [`docs/architecture/modules/backend/`](./docs/architecture/modules/backend/)
- **Frontend-moduler:** [`docs/architecture/modules/frontend/`](./docs/architecture/modules/frontend/)

---

## Hvor er vi nå (status 2026-05-06)

### Pilot-readiness

- **Spill 1, 2, 3 LIVE på prod** (`https://spillorama-system.onrender.com/web/`)
- 36 000-skala arkitektur klar (Postgres + Redis + Socket.IO)
- Casino-grade wallet (BIN-761→764): outbox, REPEATABLE READ, hash-chain audit
- TOTP 2FA + active sessions (REQ-129/132)
- Demo-data seedet for 4 haller

### Kritiske pilot-blokkere
Se [`BACKLOG.md`](./BACKLOG.md) for komplett liste. Topp:
- Engine-refactor for system-actor (perpetual rom — Wave 1 i fremdrift)
- Strukturerte error-codes (Fase 2A)
- Trace-ID propagation tvers HTTP/Socket.IO (MED-1)

### Nylige sesjoner
- 2026-05-05: Spill 2/3 pilot-readiness (15 PR-er merget)
- 2026-05-04: Design-overhaul Spill 2 mockup-paritet
- 2026-05-03: Engine-refactor Wave 1 i fremdrift
- 2026-05-02: Pre-pilot final verify
- 2026-05-01: 4-hall demo-seed live + wallet-recon-alerts

Komplett historikk: [`docs/operations/PM_HANDOFF_*.md`](./docs/operations/)

---

## Hva er retning

Les [`docs/SYSTEM_DESIGN_PRINCIPLES.md`](./docs/SYSTEM_DESIGN_PRINCIPLES.md) for full filosofi.

**Kort:**
- Casino-grade som Evolution Gaming
- Server er sannhets-kilde
- Strukturerte error-codes over fri-tekst
- Idempotente operasjoner overalt
- Backwards-kompatibilitet over breaking changes
- Quality > speed (Tobias-direktiv 2026-05-05)
- All død kode skal fjernes
- Vi flytter ikke Spill 1 til perpetual-modell

---

## Tech-stack

| Lag | Tech | Versjon |
|---|---|---|
| Runtime | Node.js | 22.x |
| Backend | Express + Socket.IO | 4.21 + 4.8 |
| Database | PostgreSQL | 16 |
| Cache | Redis | 7 |
| Frontend build | Vite | 6.3 |
| Game engine | Pixi.js | 8.6 |
| Språk | TypeScript | 5.8-5.9 strict |
| Test | vitest + tsx --test | 3.1 + 4.19 |
| Deploy | Docker + Render.com | Frankfurt, Blue-Green |

---

## Hvordan starte (5 minutter)

```bash
# Klone og install
git clone https://github.com/tobias363/Spillorama-system.git
cd Spillorama-system
npm install

# Lokal infra
docker-compose up -d

# Dev-server backend (port 4000)
npm run dev

# Frontends i andre terminaler
npm run dev:admin   # 5173
npm run dev:games   # 5174

# Test
npm test
npm run test:compliance
npm run check       # type-check
```

Se [`CLAUDE.md`](./CLAUDE.md) for detaljert utviklerguide.

---

## Kontakt og eierskap

- **Teknisk lead:** Tobias Haugen (tobias@nordicprofil.no)
- **Repo:** [tobias363/Spillorama-system](https://github.com/tobias363/Spillorama-system)
- **Prod:** [spillorama-system.onrender.com](https://spillorama-system.onrender.com/)
- **Linear:** Bingosystem-prosjekt (BIN-* issues)

---

**Dette dokumentet er en levende sannhets-kilde. Når arkitektur eller retning endres, oppdater dette først, deretter detalj-docs.**
