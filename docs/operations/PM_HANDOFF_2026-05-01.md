# PM Handoff — Spillorama-system 2026-05-01

**Til:** Ny PM
**Fra:** Tobias Haugen (teknisk lead)
**Dato:** 2026-05-01
**Status:** Pilot teknisk-bevist, klar for første hall-launch når forretnings-arbeid er ferdig

---

## 1. Executive summary

Spillorama er en **regulert norsk live-bingo-plattform** for fysiske bingohaller med spill-grensesnitt for spillere på web. Systemet er bygget i TypeScript over Node 22, PostgreSQL 16, Redis 7, og deployet på Render.com (Frankfurt-region).

**Hvor vi står i dag (2026-05-01):**

- ✅ **Teknisk pilot-funksjonell**: backend + agent-portal + TV-skjerm + spiller-klient kjører i prod og er bevist via 13/13 grønn end-to-end smoke-test
- ✅ **Compliance-grunnlag**: pengespillforskriften §11 (15% hovedspill / 30% databingo), spillvett, hash-chain audit, casino-grade wallet
- ⚠️ **Mangler for å åpne for ekte spillere**: Lotteritilsynet-lisens, hardware (terminaler/TV/scannere), pilot-hall-kontrakter, support-team, forsikring

**Hovedrisiko:** Systemet er klart til å kjøre, men kan ikke åpne uten 5-6 ukers parallelt forretnings-arbeid. Kritisk sti = hardware-leadtime + Lotteritilsynet-saksbehandling.

**Topp 5 prioriteringer for ny PM (start denne uka):**

1. **Pilot-hall-kontrakt med Notodden** (BIN-799/793) — leadtime 2-4 uker
2. **Hardware-anskaffelse** (BIN-787) — leadtime 3-5 uker, 150-300k NOK CapEx
3. **Lotteritilsynet søknadspakke** (BIN-780) — saksbehandling 3-6 uker
4. **Support-team rekruttering** (BIN-789) — 2-4 uker
5. **Swedbank Pay live-credentials** (BIN-802) — 1-2 uker

Disse blokkerer ikke hverandre — start alle 5 i parallell.

---

## 2. Hva systemet er

### 2.1 Spillkatalog (offisiell)

Per `docs/architecture/SPILLKATALOG.md` (autoritativ kilde):

| Markedsføring | Kode | Slug | Kategori | §11-prosent |
|---|---|---|---|---|
| Spill 1 (Hovedspill 1) | game1 | `bingo` | Hovedspill 75-ball 5×5 | 15% |
| Spill 2 (Hovedspill 2) | game2 | `rocket` | Hovedspill 60-ball 3×5 | 15% |
| Spill 3 (Hovedspill 3) | game3 | `monsterbingo` | Hovedspill 60-ball 5×5 | 15% |
| SpinnGo (Spill 4) | game5 | `spillorama` | **Databingo** | **30%** |
| Candy | — | `candy` | Ekstern iframe (tredjeparts) | N/A |

**Game 4 / `themebingo` er deprecated** (BIN-496). Ikke bruk.

### 2.2 Tre-tier arkitektur

```
[Spiller-klient (PixiJS)] [Admin/Agent-portal (Vite)] [TV-skjerm (HTML)]
              │                        │                        │
              └────── Socket.IO ───────┴────── HTTP/REST ────────┘
                                       │
                          [Backend (Express + Socket.IO)]
                                       │
                       ┌───────────────┼───────────────┐
                  [PostgreSQL 16]  [Redis 7]  [Render.com]
                   (source of truth) (cache)   (Frankfurt)
```

- **Backend** (`apps/backend/`) er source of truth — alle spillregler, wallet, compliance
- **Admin-web** (`apps/admin-web/`) — admin + agent-portal (rute-basert: `/admin/*` for ADMIN, `/agent/*` for AGENT)
- **Game-client** (`packages/game-client/`) — PixiJS WebGL for Spill 1-3 (web-native), Candy via iframe
- **Shared-types** (`packages/shared-types/`) — Zod-validerte typer

### 2.3 Regulatorisk kontekst

Spillorama opererer under **pengespillforskriften** (Norge). Lotteritilsynet er regulator. Vi har:
- Hash-chain audit-ledger (BIN-764)
- Spillvett: per-hall tapsgrense, voluntær pause, 1-års selvutestengelse, fail-closed
- §71-rapportering (komplett ledger-struktur, første eksempel-rapport gjenstår)
- §11-distribuering (kode ferdig — 15% / 30% per spill-kategori)
- AML-cap (50k kontant per hall/dag, BIR-036)

**Lisens** er ikke utstedt ennå (BIN-780).

---

## 3. Hva som er gjort (kronologi)

### Fase 1: Pre-pilot (før 2026-04)
- Grunnplattform bygget (auth, wallet, spill-engines, compliance-ledger)
- Game 1 PixiJS-runtime ferdig
- Game 2/3 web-native portering
- Admin-panel ~70% ferdig

### Fase 2: Bølge K1+P0 — pilot-kritiske blokkere (april 2026)

Per `docs/architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md` §10. Alle merget til main:

**K1 Kritiske:**
- Compliance multi-hall-binding (BIN-443) — `actor_hall_id` i ledger
- Settlement maskin-breakdown (BIN-441/547/573) — JSONB med 14 rader, wireframe-paritet
- Customer Unique ID (BIN-464/599) — 8 endpoints + 41 tester
- transferHallAccess 60s handshake (BIN-453)
- Manuell Bingo-check UI (BIN-433) — Check-for-Bingo + Physical Cashout med Reward-All
- Mystery Game client-overlay (BIN-430)

**P0 Operativ kvalitet:**
- Lucky Number Bonus ved Fullt Hus
- Jackpott daglig akkumulering (Game1JackpotStateService med Oslo-tz)
- Per-agent ready-state (Game1HallReadyService + ready-state-machine)
- Per-hall payout-cap (HallCashLedger)
- Auto-escalation når master ikke starter
- Shift-end checkboxer (distributeWinnings + transferRegisterTickets)
- Ticket-farger 11-palette
- XML-Withdraw pipeline + e-post-utsending

**Casino-grade infrastructure (BIN-761→764):**
- Outbox-pattern for wallet-events
- REPEATABLE READ isolation
- Nightly reconciliation
- Hash-chain audit (alle wallet-tx)

**Sikkerhet:**
- TOTP 2FA + active sessions (REQ-129/132)
- Phone+PIN-login (REQ-130)
- Trace-ID propagation (MED-1)

### Fase 3: Pilot-fokus (2026-04-30)

Vi gikk fra "alt mulig parallelt" til streng pilot-fokus etter token-budget-bekymring. 9 PR-er merget på én dag:

| PR | Hva |
|---|---|
| #770 | Fix duplicate Spill1PrizeDefaults import |
| #771 | feat(backend): seed-demo-pilot-day script |
| #772 | feat(admin-web): Agent Dashboard frontend wiring (PDF 17 §17.1) |
| #773 | feat(admin-web,backend): TV Screen wireframe-paritet (PDF 16 §16.5) |
| #774 | feat(cms): Public CMS endpoints + about alias |
| #775 | feat(backend): BIN-768 13-stegs E2E smoke-test framework |
| #776 | fix(backend): BIN-778 schema-gate migrasjons-rekkefølge |
| #777 | feat(backend): BIN-804 F1 — alle 4 sub-game-typer i seed |
| #779 | feat(admin-web): BIN-805 F2 Register More Tickets F1-hotkey |

**Live valideringen** kjørt mot `https://spillorama-system.onrender.com`:
- Seed-script kjørt mot prod-DB
- 13/13 smoke-test grønn
- Demo-brukere bekreftet inn-loggbare

### Fase 4: Post-pilot kvalitets-baseline (2026-04-30 sent kveld)

3 PR-er merget for å heve sikkerhets-/operasjons-baseline:

| PR | Hva | Linear |
|---|---|---|
| #780 | fix(backend): seed også app_hall_registrations (post-mortem) | (oppfølging) |
| #781 | feat(backend): BIN-776 CSP/CORS strict + 7 security headers + /api/csp-report | BIN-776 → Done |
| #782 | feat(backend): BIN-791 Status-page (10 komponenter + uptime + incidents) | BIN-791 → Done |

**Resultat 2026-05-01:**
- 7 issues markert Done i Linear (BIN-768, BIN-776, BIN-778, BIN-791, BIN-804, BIN-805, +baseline-fixes)
- Backend deployet med alle Bølge 1+2 endringer
- `https://spillorama-system.onrender.com/status` live
- `https://spillorama-system.onrender.com/health` returnerer OK

---

## 4. Hva som gjenstår — prioritert per Linear-spor

### Spor A — Tekniske (16 issues, 6 done, 10 igjen)

#### Done (6)
- ✅ BIN-768 A1 E2E smoke-test
- ✅ BIN-776 A9 CSP/CORS strict
- ✅ BIN-778 A11 Schema-gate fix
- ✅ BIN-791 C5 Status-page
- ✅ BIN-804 F1 Demo-seed 4 sub-games
- ✅ BIN-805 F2 Agent F1-hotkey

#### Backlog (10) — sortert etter pri
| Issue | Pri | Hva | Estimat |
|---|---|---|---|
| BIN-769 | High | A2 Auto-reload-resilience | 3-5 dager |
| BIN-771 | High | A4 Performance load-tests (1000 spillere, P95<100ms) | 3-4 dager |
| BIN-775 | High | A8 Pen-test fra ekstern leverandør | 2 uker leadtime + 2 uker fix |
| BIN-806 | High | A13 Anti-fraud / velocity-checks (NY) | 1-2 uker |
| BIN-807 | High | A14 WCAG 2.2 AA accessibility (NY, EU EAA-direktiv) | 2-3 uker |
| BIN-770 | Medium | A3 i18n EN/SE/DK/DE | 5-7 dager |
| BIN-772 | Medium | A5 Disaster recovery + backup-drills | 2-3 dager |
| BIN-774 | Medium | A7 Observability dashboards (Grafana/Datadog) | 3-5 dager |
| BIN-779 | Medium | A12 GAP-polish (KYC-cron, online-count, m.fl.) | 8-12 dager |
| BIN-777 | Medium | A10 Public CMS player-shell wiring | 2-3 dager |
| BIN-808 | Medium | A15 Kvartalsvis pen-test + bug-bounty (NY) | 1 uke setup |
| BIN-809 | Medium | A16 SOC 2 Type II compliance (NY) | 6-12 mnd |
| BIN-773 | Low | A6 Multi-region failover (Frankfurt + Stockholm) | 2-3 uker |

### Spor B — Compliance & dokumentasjon (7 issues, 0 done)

| Issue | Pri | Hva | Estimat |
|---|---|---|---|
| BIN-780 | Urgent | B1 Lotteritilsynet søknadspakke | 3-6 uker saksbehandling |
| BIN-781 | High | B2 §71-rapport eksempel-eksport for revisjon | 2-3 dager + 1 uke revisor |
| BIN-782 | High | B3 DPIA / GDPR-vurdering + ROPA (jurist) | 1-2 uker |
| BIN-783 | High | B4 AML-rutiner formalisert | 1-2 uker |
| BIN-784 | Medium | B5 Spilleansvar / RG-policy + kontaktperson | 1 uke |
| BIN-785 | Medium | B6 §11-utdeling første kvartal til organisasjoner | Etter pilot-start |
| BIN-786 | Low | B7 Norsk Tipping/Skatt format-validering | 1-2 uker venting |

### Spor C — Operasjon & infrastruktur (7 issues, 1 done)

| Issue | Pri | Hva | Estimat |
|---|---|---|---|
| ✅ BIN-791 | Medium | C5 Status-page (DONE) | — |
| BIN-787 | Urgent | C1 Hardware (terminaler/TV/scannere/printere) | 3-5 uker leadtime, 150-300k NOK |
| BIN-789 | Urgent | C3 Support-team (1 fast + 1 backup) | 2-4 uker rekruttering |
| BIN-793 | Urgent | C7 Pilot-hall-kontrakter signert | 2-4 uker forhandling |
| BIN-788 | High | C2 Agent-training-program (manual + video + 1-dags hands-on) | 1 uke å lage |
| BIN-792 | Medium | C6 On-call rotation (utviklere første 90 dager) | 1 dag å definere |
| BIN-790 | Medium | C4 Drift-runbooks finpusset | 1-2 uker |

### Spor D — Marked & onboarding (5 issues, 0 done)

| Issue | Pri | Hva | Estimat |
|---|---|---|---|
| BIN-795 | High | D2 Spiller-onboarding-flyt polering (KYC + BankID + 1. innskudd) | 1 uke |
| BIN-794 | Medium | D1 Marketing-side (separat fra player-shell) | 1-2 uker |
| BIN-796 | Medium | D3 Velkomst-flyt (e-post + push-onboarding) | 3-5 dager + tekstforfatter |
| BIN-797 | Low | D4 Henvisningsprogram | 1 uke |
| BIN-798 | Low | D5 Partner-portal for hall-operatører (M3) | 2-3 uker |

### Spor E — Forretning & avtaler (5 issues, 0 done)

| Issue | Pri | Hva | Eier |
|---|---|---|---|
| BIN-799 | Urgent | E1 Kontrakter med pilothaller signert | Tobias / ny PM |
| BIN-802 | High | E4 Bank-integrasjon Swedbank Pay live-credentials | Tobias / ny PM |
| BIN-800 | High | E2 Org-mottaker-avtaler (§11-utdeling) | Tobias / ny PM |
| BIN-801 | Medium | E3 Maskin-leverandør-avtaler (Metronia/OK Bingo/Franco/Otium) | Tobias / ny PM |
| BIN-803 | Medium | E5 Forsikring (cyber + ansvar) | Tobias / ny PM + megler |

---

## 5. Tre milepæler for veien videre

### M1 — Pilot-stage (mål: 4-6 uker fra i dag)

1-2 haller kjører kontrollert pilot med 50-100 spillere. Fokus: bevise end-to-end-flyt i ekte miljø.

**Kritisk sti:**
- Pilot-hall-kontrakt signert (BIN-799)
- Hardware levert (BIN-787)
- Support-team operasjonelt (BIN-789)
- Lotteritilsynet-pakke i prosess (BIN-780)
- Swedbank Pay live (BIN-802)
- Agent-training gjennomført (BIN-788)

**Tekniske polish som kan gjøres parallelt:**
- BIN-769 Auto-reload-resilience
- BIN-771 Load-test
- BIN-781 §71-rapport eksempel
- BIN-777 Public CMS frontend

### M2 — Multi-hall-launch (mål: 8-12 uker fra i dag)

Alle 4-5 piloth aller live. Lotteritilsynet-godkjent. 500-1000 daglige spillere.

**Krever:**
- Alt M1
- BIN-775 Pen-test gjennomført + funn fikset
- BIN-806 Anti-fraud-engine deployed
- BIN-807 WCAG 2.2 AA audit + fixes
- BIN-770 i18n EN minimum
- BIN-774 Observability dashboards
- B-spor (compliance-dokumentasjon) komplett
- D-spor (marketing) i drift

### M3 — Evolution Gaming-grade (mål: 6-12 mnd)

Skalerbar til 50+ haller, internasjonal-ready, Lotteritilsynet-revisjon består uten avvik.

**Krever:**
- Alt M2
- BIN-773 Multi-region failover (Frankfurt + Stockholm)
- BIN-808 Kvartalsvis pen-test + bug-bounty
- BIN-809 SOC 2 Type II
- BIN-798 Partner-portal

---

## 6. Tekniske ressurser

### Repository
- **GitHub:** `tobias363/Spillorama-system`
- **Hovedbranch:** `main`
- **Workflow:** PR-first, squash & merge, --admin-merge for baseline-fixes

### Dokumentasjon (les disse først)
- `CLAUDE.md` — repo-rot — overordnet instruks for utvikler-team
- `docs/architecture/SPILLKATALOG.md` — autoritativ spill-katalog
- `docs/architecture/ARKITEKTUR.md` — system-design
- `docs/architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md` — pilot-fokus
- `docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md` — wireframe-mapping
- `docs/architecture/WIREFRAME_CATALOG.md` — 17 wireframe-PDF-er katalogisert
- `docs/engineering/ENGINEERING_WORKFLOW.md` — git/PR/deploy
- `docs/operations/E2E_SMOKE_TEST.md` — runbook for å verifisere live
- `docs/operations/SECURITY_HEADERS.md` — CSP rollout-plan
- `docs/operations/STATUS_PAGE.md` — admin incident-håndtering
- `docs/compliance/` — pengespillforskriften-dokumenter
- `apps/backend/openapi.yaml` — komplett API-spec

### Linear-prosjekt
- **URL:** https://linear.app/bingosystem/project/lansering-2026-q3-evolution-gaming-grade-pilot-908eacd8a077
- **42 issues** (7 done, 35 backlog)
- **3 milepæler:** M1 / M2 / M3
- **5 spor:** A Tekniske / B Compliance / C Operasjon / D Marked / E Forretning

### Render.com
- **Service:** `spillorama-system` (srv-d7bvpel8nd3s73fi7r4g)
- **Region:** Frankfurt
- **Plan:** Starter (oppgrader for prod)
- **DB:** `bingo-db` (dpg-d6k3ren5r7bs73a4c0bg-a, basic_256mb — oppgrader for prod)
- **Redis:** Render-managed (kontrolleres via env)
- **Auto-deploy:** main-branch
- **Health:** `https://spillorama-system.onrender.com/health`
- **Status:** `https://spillorama-system.onrender.com/status`

### Demo-credentials (live på prod-DB)

**Logger inn på `https://spillorama-system.onrender.com/`:**

| Rolle | E-post | Passord |
|---|---|---|
| Admin | `demo-admin@spillorama.no` | `Spillorama123!` |
| Agent | `demo-agent@spillorama.no` | `Spillorama123!` |
| Spiller 1 | `demo-spiller-1@example.com` | `Spillorama123!` |
| Spiller 2 | `demo-spiller-2@example.com` | `Spillorama123!` |
| Spiller 3 | `demo-spiller-3@example.com` | `Spillorama123!` |

Demo-hall: `demo-hall-999` ("Demo Bingohall"), Hall Group `demo-goh`.

### Hvordan re-kjøre validering

```bash
# 1. Sett env (få fra Tobias eller Render dashboard)
export APP_PG_CONNECTION_STRING="<staging-eller-prod-DB-URL>?sslmode=require"

# 2. Re-seede demo-data (idempotent — trygg å kjøre flere ganger)
npm --prefix apps/backend run seed:demo-pilot-day

# 3. Kjør 13-stegs smoke-test
npm --prefix apps/backend run smoke-test -- \
  --api-base-url=https://spillorama-system.onrender.com \
  --admin-email=demo-admin@spillorama.no \
  --admin-password=Spillorama123! \
  --agent-email=demo-agent@spillorama.no \
  --agent-password=Spillorama123!
```

**13/13 grønn = piloten er teknisk-bevist.**

---

## 7. Risiko + anti-mønstre

### 7.1 Tekniske risikoer

#### Risiko: Schema-arkeologi i prod-DB
Lokal DB feiler på migrasjons-ordering pga. historiske partial-commits + boot-time `initializeSchema()`. Prod-DB kjører fordi state finnes selv om pgmigrations ikke er i lock-step.

**Adresseres i:** `docs/operations/SCHEMA_ARCHAEOLOGY_2026-04-29.md` + `schema-archaeology-fix.sql`. PM må be utvikler-team om å gjennomføre fix-script-prosedyren før første pilot-spiller.

#### Risiko: Redis er single-instance
Fortsatt single-instance Redis på Render. Ved Redis-down faller socket-state ut.

**Mitigering:** memory-fallback finnes (`ROOM_STATE_PROVIDER=memory`), men det betyr at multi-pod ikke kan koordinere rom. Multi-region løsning er BIN-773 (M3).

#### Risiko: Demo-data i prod-DB
Vi seedet demo-brukere + demo-hall i live prod-DB for å bevise pilot-flyt. Disse må ryddes før første ekte spiller går inn.

**Action:** PM må be utvikler om en `npm run seed:demo-cleanup`-script eller tilsvarende før pilot.

#### Risiko: CSP_MODE er report-only
Strict CSP er deployet i rapport-only-modus. Hvis enforce-bytte gjøres uten å se gjennom violations-loggen, kan legitime ressurser bli blokkert.

**Action:** Kjør 1-2 uker i report-only, gjennomgå violations-loggen, fiks evt. legitime kilder, så bytt til `enforce`.

### 7.2 Forretnings-risikoer

#### Risiko: Render API-key eksponert
Tobias delte Render API-key i chatten 2026-04-30 (`rnd_Avpf...`). Den må roteres umiddelbart.

**Status:** Ikke gjort ennå per 2026-05-01. PM tar ansvar.

#### Risiko: Lotteritilsynet-saksbehandling kan være lengre
3-6 uker er anslag. Hvis pakken er ufullstendig kan det dra ut.

**Mitigering:** Bruk ekstern jurist med erfaring fra Norsk Tipping/Norsk Rikstoto-søknader.

#### Risiko: Hardware-leverandør-leadtime
3-5 uker er typisk. Hvis utstyr er backordered eller spesialbestilt kan det dra ut.

**Mitigering:** Bestill i dag. Test med 1 hall først, så masse-ordre etter pilot.

### 7.3 Anti-mønstre observert i prosjektet

**1. For mange parallelle agenter brente token-budget**
2026-04-30 spawnet vi 9 agenter parallelt — 7 av dem ble drept av token-budget-cap. Læring: maks 3-4 fokuserte agenter samtidig.

**2. Pilot-fokus glir hvis ikke holdt fast**
Tidligere planer prøvde å parallellisere M1+M2-arbeid samtidig. Det fungerte ikke. Streng pilot-fokus + parkering av M2/M3-arbeid var det som faktisk leverte.

**3. "Done" uten merge til main = ikke done**
Vedtatt 2026-04-17 etter 4 falske Done-funn. Issues lukkes kun når commit er merget til main + file:line + test grønn i CI. Se `docs/engineering/ENGINEERING_WORKFLOW.md` §7.

**4. Worktree-baserte agenter inheriter parent-branch**
Hvis en agent spawnes mens kallende prosess er på en feature-branch (ikke main), inkluderer worktreen den branch-en sin innhold. F.eks. F2-agenten (BIN-805) hadde 70+ LOC fra `refactor/f2c` som ikke skulle vært med. Løsning: cherry-pick spesifikk commit.

**5. Local DB er ikke en god verifikasjon**
Lokal DB har schema-arkeologi-issues som ikke finnes i prod. Bruk staging eller prod-DB for verifikasjon.

---

## 8. Anbefalt onboarding for ny PM

### Uke 1: Forstå systemet

**Dag 1-2: Les dokumentene**
- `CLAUDE.md`
- `docs/architecture/SPILLKATALOG.md`
- `docs/architecture/ARKITEKTUR.md`
- `docs/architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md`
- Denne filen (PM_HANDOFF_2026-05-01.md)

**Dag 3: Hands-on demo**
- Logg inn som demo-admin på live: `https://spillorama-system.onrender.com/`
- Naviger Admin Dashboard
- Bytt til demo-agent, start skift, register tickets, kjør Cash-In/Out
- Åpne TV-skjerm via demo-token
- Sjekk status-side: `/status`

**Dag 4-5: Møt Tobias + utvikler-team**
- Gjennomgang av Linear-prosjektet
- Spørsmål om arkitektur
- Forstå git-workflow (PM-sentralisert merging)

### Uke 2: Start kritisk-sti-arbeid

**Mandag:** Ring Notodden Bingo + 2 andre potensielle pilot-haller
**Tirsdag:** Kontakt POS-leverandør for hardware-tilbud
**Onsdag:** Bestill juridisk konsultasjon for Lotteritilsynet-pakken
**Torsdag:** Sett opp support@spillorama.no + start support-rekruttering
**Fredag:** Kontakt Swedbank for live-credentials

Parallelt: spawn utvikler-agenter på kjapp gevinst (BIN-769 Auto-reload eller BIN-777 CMS-frontend) når token-budget tillater.

### Uke 3-4: Hardware-vente-period

Mens hardware er på vei:
- Lag agent-training-materiale (BIN-788)
- Polér spiller-onboarding (BIN-795)
- Deploy BIN-769 Auto-reload til staging
- Kjør BIN-771 load-test mot staging
- Bestill BIN-775 Pen-test (2-uker leadtime)

### Uke 5-6: Pilot-launch-prep

- Hardware ankommer + installeres på pilot-hall
- Ryddet demo-data fra prod-DB
- Live spiller-onboarding-test med 5-10 testspillere
- Lotteritilsynet-godkjenning forventet
- Første ekte spiller går inn

---

## 9. Hvordan kontakte teknisk lead (Tobias)

- **E-post:** tobias@nordicprofil.no
- **Linear:** assignee `me` filtrert vil vise hans pågående arbeid
- **Spørsmål om arkitektur, kode, deploy:** Tobias

PM eier:
- Forretning (kontrakter, leverandører)
- Operasjon (rekruttering, hardware-bestilling, support)
- Compliance (jurist, Lotteritilsynet)
- Marketing
- Product strategy

Tobias eier:
- Teknisk arkitektur
- Kode-review
- Utvikler-team-koordinering
- Deploy-prosess

---

## 10. Glossar

| Forkortelse | Betydning |
|---|---|
| GoH | Group of Halls — hall-gruppe (master + tilkoblede haller) |
| RG | Responsible Gaming / Spillvett |
| AML | Anti-Money Laundering |
| KYC | Know Your Customer (identitets-verifisering) |
| RNG | Random Number Generator |
| §71 | Pengespillforskriften §71 — regnskaps-rapportering |
| §11 | Pengespillforskriften §11 — overskudd-distribusjon (15%/30%) |
| GDPR | General Data Protection Regulation |
| DPIA | Data Protection Impact Assessment |
| ROPA | Records of Processing Activities (GDPR) |
| EAA | European Accessibility Act (EU-direktiv) |
| WCAG | Web Content Accessibility Guidelines |
| SOC 2 | Service Organization Control 2 (security audit) |
| GLI | Gaming Laboratories International |
| MGA | Malta Gaming Authority |
| CSP | Content Security Policy |
| CORS | Cross-Origin Resource Sharing |
| HSTS | HTTP Strict Transport Security |
| CapEx | Capital Expenditure |
| OpEx | Operating Expenditure |
| RPO | Recovery Point Objective (max akseptabelt data-tap ved disaster) |
| RTO | Recovery Time Objective (max akseptabel ned-tid ved disaster) |

---

## 11. Slutt-status 2026-05-01

| Område | Status | Notater |
|---|---|---|
| Backend kode | ✅ Pilot-funksjonell | 13/13 smoke-test grønn live |
| Frontend (admin/agent/TV) | ✅ Pilot-funksjonell | Wireframe-paritet PDF 16+17 |
| Spiller-klient | ✅ Pilot-funksjonell | Spill 1 komplett, Spill 2-3 web-native |
| Wallet | ✅ Casino-grade | Hash-chain, outbox, REPEATABLE READ |
| Compliance-ledger | ✅ §71-klar | Første eksempel-rapport gjenstår |
| Sikkerhet (CSP/CORS) | ✅ Strict deployed | Report-only mode 1-2 uker |
| Status-page | ✅ Live | `/status` |
| Pilot-hall-kontrakt | ❌ Ikke signert | Kritisk sti — start denne uka |
| Hardware | ❌ Ikke bestilt | Kritisk sti — 3-5 uker leadtime |
| Lotteritilsynet-lisens | ❌ Ikke søkt | Kritisk sti — 3-6 uker saksbehandling |
| Support-team | ❌ Ikke ansatt | Kritisk sti — 2-4 uker |
| Forsikring | ❌ Ikke ordnet | 2-3 uker |
| Pen-test | ⏳ Ikke kjørt | Bestill etter pilot live |
| Anti-fraud | ⏳ Ikke implementert | Etter pilot |
| WCAG audit | ⏳ Ikke kjørt | Før kommersiell drift |
| Multi-region | ⏳ Single (Frankfurt) | M3 (3-6 mnd ut) |
| SOC 2 | ⏳ Ikke startet | M3 (6-12 mnd) |

---

**Lykke til. Systemet er teknisk klart. Nå handler det om å få forretnings-stykkene på plass.**

— Tobias, 2026-05-01
