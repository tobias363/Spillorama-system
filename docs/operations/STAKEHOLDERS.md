# Stakeholders — Spillorama-system

**Sist oppdatert:** 2026-05-10
**Eier:** Tobias Haugen
**Status:** Aktiv (levende dokument)
**Review-kadens:** Kvartalsvis + ved hver pilot-milestone

> **Til ny PM:** Dette er sentral oversikt over hvem som er involvert i
> Spillorama, deres rolle, og hvordan de eskaleres til når noe trenger
> beslutning eller informasjon. Hold kontakt-info oppdatert.

---

## Interne

### Tobias Haugen — Teknisk lead, prosjekt-eier

- **Selskap:** Nordicprofil
- **E-post (offisiell):** tobias@nordicprofil.no
- **E-post (privat):** post@lappeland.no
- **Telefon:** _<fyll inn>_
- **Tilgjengelighet:** _<arbeidstid + akseptert kontakt-vindu>_
- **Rolle:**
  - Eneste CODEOWNER (alle filer)
  - Eneste Render-admin
  - Eneste Lotteritilsynet-kontaktperson
  - Eneste vendor-kontaktperson (Swedbank Pay, BankID, etc.)
  - Final beslutning på arkitektur, compliance, retning
  - Setter immutable direktiver (se [`PM_ONBOARDING_PLAYBOOK.md §2`](../engineering/PM_ONBOARDING_PLAYBOOK.md))
- **Bus-faktor:** 1 (R-001 i [`RISKS.md`](../RISKS.md)) — KRITISK risiko å mitigere

### PM (du)

- **Rolle:**
  - Koordinerer agenter (commit + push) → opprett PR + merge
  - Verifiserer CI etter PR-åpning
  - Skriver handoffs ved sesjons-slutt
  - Kommuniserer mellom Tobias og agenter
  - Oppdaterer BACKLOG, RISKS, INVENTORY ved endringer
- **Tilgang:**
  - Render API key (via `secrets/render-api.local.md`)
  - Linear API (via MCP)
  - GitHub PAT
  - Lokal repo-clone

### AI-agenter (Claude / Cowork)

- **Rolle:**
  - Implementerer kode-endringer på feature-branches
  - Skriver tester
  - Genererer docs ved arkitektur-endringer
  - **Aldri:** opprett PR eller merge selv (ADR-0009)
- **Onboarding:** `./scripts/agent-onboarding.sh` + lese relevante skills

---

## Eksterne — Regulatoriske

### Lotteritilsynet (Norwegian Gaming Authority)

- **Hva:** Tilsyn for pengespillforskriften
- **Vår status:** Pengespill-operatør (ikke white-label)
- **Saksbehandler:** _<fyll inn — navn + tittel hvis kjent>_
- **E-post:** _<fyll inn>_
- **Telefon:** _<fyll inn>_
- **Postadresse:** Lotteritilsynet, Førde
- **Web:** https://lottstift.no/
- **Eskaleres når:**
  - Compliance-incident (følg [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md))
  - §11-distribusjons-rapportering
  - RNG-sertifiserings-spørsmål
  - Tilsyns-henvendelser
- **Eier av relasjonen:** Tobias

### Datatilsynet (Norwegian DPA)

- **Hva:** Tilsyn for personvern (GDPR / personopplysningsloven)
- **Saksbehandler:** _<fyll inn>_
- **Eskaleres ved:** Personvernbrudd, data-lekkasje med PII
- **Eier av relasjonen:** Tobias

---

## Eksterne — Kunder (Hall-operatører)

### Pilot-haller (Q3 2026)

| Hall | Status | Kontaktperson | Telefon | E-post | Notater |
|---|---|---|---|---|---|
| **Teknobingo Årnes** (Master) | Pilot-aktiv | _<fyll inn>_ | _<>_ | _<>_ | Master-hall for Spill 1 (per pilot-design) |
| **Bodø** | Pilot-aktiv | _<>_ | _<>_ | _<>_ | |
| **Brumunddal** | Pilot-aktiv | _<>_ | _<>_ | _<>_ | |
| **Fauske** | Pilot-aktiv | _<>_ | _<>_ | _<>_ | |

### Skalerings-mål (24 haller)

Når 4-hall-piloten er stabil i 2-4 uker (jf. Tobias-direktiv 2.10), utvides
piloten. Hall-liste fyltes inn etter hvert.

### Per-hall ansvar

- **Bingovert / agenter:** Operativ daglig kjøring (cash inn/ut, settlement, Spill-master)
- **Hall-eier:** Kontrakts-relasjon, betaling, juridisk

---

## Eksterne — Forretnings-partnere

### Candy (tredjeparts spill via iframe)

- **Hva:** Tredjeparts spill integrert som iframe i Spillorama
- **Repo:** `tobias363/candy-web` (separat)
- **Kontaktperson:** _<fyll inn — Candy-team-lead>_
- **Wallet-bro:** `/api/ext-wallet/*` endpoints
- **Boundary:** Se [`docs/architecture/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md`](../architecture/LIVE_BINGO_CANDY_BOUNDARY_2026-04-09.md)
- **Eier av relasjonen:** Tobias

---

## Eksterne — Leverandører (vendors)

Se [`VENDORS.md`](./VENDORS.md) for full vendor-liste med kontrakts-detaljer.

Kort:
- Render.com (PaaS) — Tobias konto-eier
- Swedbank Pay (payment) — Tobias konto-eier
- BankID (KYC) — Tobias konto-eier
- Sentry (observability)
- SMTP-leverandør (TBD)
- Domene-registrar
- GitHub
- Linear
- Anthropic

---

## Eskalerings-kart

```
Compliance-spørsmål           → Tobias → Lotteritilsynet
Personvern-spørsmål            → Tobias → Datatilsynet
Vendor-tech-issue              → PM → Tobias → Vendor support
Kunde-incident (hall ringer)   → PM → Tobias → Hall-kontakt
Sikkerhets-sårbarhet           → SECURITY.md prosedyre → Tobias
Pilot-blokker                  → PM oppdaterer BACKLOG → Tobias prioriterer
Arkitekturbeslutning           → PM/Agent skriver ADR-utkast → Tobias godkjenner
Production-incident (P1)       → EMERGENCY_RUNBOOK + INCIDENT_RESPONSE_PLAN
```

---

## Kommunikasjons-mønstre med Tobias

(Sammendrag fra [`PM_ONBOARDING_PLAYBOOK.md §5`](../engineering/PM_ONBOARDING_PLAYBOOK.md))

**Foretrukket form:**
- Korte meldinger med klar struktur
- Konkrete spørsmål med 2-3 alternativer
- Status-rapporter med PR-numre + commit-SHA-er
- Norsk språk
- Ingen emojier (med mindre Tobias selv ber om det)
- Ikke gjenta info Tobias allerede vet

**Når i tvil — alltid spørre:**
- Compliance-tolkning (pengespillforskriften)
- Arkitektur-skifte med >2 modul-impact
- Vendor-bytte
- Kontrakts-spørsmål
- Pilot-skalering eller hall-onboarding

**Når du ikke trenger spørre (autonomi):**
- Bug-fix på commit-nivå med tester
- Doc-oppdateringer som ikke endrer policy
- Routine-PR med grønn CI
- Skill-oppdateringer

---

## Onboarding-prosess for ny stakeholder

Når en ny part involveres (ny hall, ny vendor, ny team-medlem):

- [ ] Legg til seksjon i denne filen
- [ ] Fyll inn kontakt-info, rolle, eskalerings-vei
- [ ] Hvis vendor: legg også til i [`VENDORS.md`](./VENDORS.md)
- [ ] Hvis ny team-medlem: vurder CODEOWNERS-oppdatering ([`.github/CODEOWNERS`](../../.github/CODEOWNERS))
- [ ] Hvis ny hall: oppdater pilot-status i [`BACKLOG.md`](../../BACKLOG.md)

---

## Ved endringer

- **Person bytter rolle:** oppdater her + CODEOWNERS hvis aktuelt
- **Vendor bytter kontaktperson:** oppdater her + VENDORS.md
- **Hall slutter / forlater pilot:** marker som "Avsluttet YYYY-MM-DD" (ikke slett — kontekst-spor)
- **Tobias' kontakt-info endres:** oppdater her + skill `pm-orchestration-pattern`

---

**Se også:**
- [`VENDORS.md`](./VENDORS.md) — kontrakts-detaljer per leverandør
- [`CREDENTIALS_AND_ACCESS.md`](./CREDENTIALS_AND_ACCESS.md) — hvem har tilgang til hva
- [`EMERGENCY_RUNBOOK.md`](./EMERGENCY_RUNBOOK.md) — hva PM gjør hvis Tobias er utilgjengelig
- [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md) — Lotteritilsynet-kommunikasjon
- [`docs/RISKS.md`](../RISKS.md) — R-001 bus-faktor
