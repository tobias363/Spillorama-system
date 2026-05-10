# Security Policy

**Sist oppdatert:** 2026-05-10
**Eier:** Tobias Haugen (tobias@nordicprofil.no)

---

## Rapportér en sårbarhet

Hvis du har funnet en sikkerhetssårbarhet i Spillorama-system:

1. **Ikke åpne et offentlig GitHub Issue.** Sårbarheter rapporteres privat.
2. **Send e-post til:** `tobias@nordicprofil.no` med emne `[SECURITY]` og en
   kort beskrivelse av problemet.
3. **Inkluder:**
   - Hvordan å reprodusere
   - Antatt scope (autentisering, wallet, data-eksponering, etc.)
   - Eventuell PoC-kode (krever ikke utnyttelse — beskrivelse er nok)
4. **Forventet respons:** Innen 48 timer på arbeidsdager.

For tidskritiske saker (aktiv utnyttelse, betalingsflyt-bug, data-lekkasje):
ring eller SMS Tobias direkte. Kontakt-info via e-post først.

---

## Scope

Dette repoet (`Spillorama-system`) dekker live bingo-plattformen — backend,
admin-web, game-client. Sårbarhets-rapporter for **Candy** (third-party iframe)
sendes til Candy-teamet separat — se
[`docs/architecture/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md`](./docs/architecture/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md)
for boundary.

**I scope:**
- Backend (`apps/backend/`) — auth, wallet, compliance, draw-engine, API
- Admin-web (`apps/admin-web/`) — admin-portal
- Game-client (`packages/game-client/`) — Pixi.js game-renderer
- Shared types (`packages/shared-types/`)
- Infrastructure (`render.yaml`, `docker-compose.yml`, GitHub Actions)

**Utenfor scope (rapportér til respektive team):**
- Candy (`tobias363/candy-web`)
- Demo-backend (`tobias363/demo-backend`)
- Render-plattformen selv (rapportér til Render)
- BankID, Swedbank Pay, andre tredjeparts-leverandører

---

## Spesielt høy alvorlighet

Følgende klasser av sårbarheter er **kritisk** alvorlige i Spillorama
(regulert pengespill under pengespillforskriften):

| Klasse | Hvorfor kritisk |
|---|---|
| Wallet-balanse-manipulering | Kan gi falske premieuttak, regulatorisk konsekvens |
| RNG-prediksjon eller -manipulering | Kompromitterer fairness, sertifiserings-grunnlag |
| Audit-trail-tampering | Bryter pengespillforskriften §11 audit-krav |
| KYC/auth-bypass | Underminerer ansvarlig spill (limits, self-exclusion) |
| Spilledata-lekkasje (PII) | GDPR + regulatorisk |
| Compliance-rule-bypass (limits, pause, self-exclusion) | Direkte regulatorisk brudd |

Disse blir håndtert med høyeste prioritet og kan utløse compliance-rapportering
til Lotteritilsynet hvis utnyttelse er sannsynlig.

---

## Sikkerhets-arkitektur (kort)

For dypere oversikt, se eksisterende dokumentasjon:

- **Wallet-integritet:** Outbox pattern + REPEATABLE READ + hash-chain audit
  (BIN-761→764). Se [`docs/architecture/`](./docs/architecture/) og skill
  `wallet-outbox-pattern`.
- **Audit-trail:** Hash-chain over alle wallet-events + draw-events. Skill
  `audit-hash-chain`.
- **Auth:** JWT med refresh-tokens, TOTP 2FA, active-sessions-mgmt
  (REQ-129/132).
- **Trace-ID propagation:** Cross-service request correlation. Skill
  `trace-id-observability`.
- **Anti-fraud:** Skill `anti-fraud-detection`.
- **Compliance:** [`docs/compliance/`](./docs/compliance/), spesielt
  [`KRITISK1_RNG_ALGORITMEBESKRIVELSE.md`](./docs/compliance/KRITISK1_RNG_ALGORITMEBESKRIVELSE.md)
  og [`SPILLVETT_HANDOVER_CHECKLIST_2026-04-11.md`](./docs/compliance/SPILLVETT_HANDOVER_CHECKLIST_2026-04-11.md).

---

## Sist gjennomførte audits

- **Sikkerhetsaudit:** [`docs/audit/SECURITY_AUDIT_2026-04-28.md`](./docs/audit/SECURITY_AUDIT_2026-04-28.md)
- **Agent-withdrawal-flow:** [`docs/audit/AGENT_WITHDRAWAL_FLOW_2026-05-01.md`](./docs/audit/AGENT_WITHDRAWAL_FLOW_2026-05-01.md)
- **Pilot-smoke-test:** [`docs/operations/PILOT_SMOKE_TEST_CHECKLIST_2026-04-28.md`](./docs/operations/PILOT_SMOKE_TEST_CHECKLIST_2026-04-28.md)

For komplett audit-historikk: [`docs/audit/`](./docs/audit/).

---

## Credentials og access

For hvor og hvordan credentials håndteres, se
[`docs/operations/CREDENTIALS_AND_ACCESS.md`](./docs/operations/CREDENTIALS_AND_ACCESS.md)
og [`secrets/README.md`](./secrets/README.md).

**Regel:** Credentials committes ALDRI til git, deles ALDRI i Cowork-chat,
Slack, Linear, eller GitHub Issues.

---

## Responsible disclosure

Vi krediterer security-researchers som rapporterer ansvarlig (hvis de ønsker
det). Ingen formell bug-bounty per nå, men vi diskuterer compensation
case-by-case for substantielle funn.

---

## Compliance-incidenter

Sårbarheter med direkte compliance-implikasjon (limits-bypass, audit-tampering,
RNG-manipulering) følger spesiell prosedyre i
[`docs/operations/COMPLIANCE_INCIDENT_PROCEDURE.md`](./docs/operations/COMPLIANCE_INCIDENT_PROCEDURE.md)
inkludert Lotteritilsynet-rapportering.
