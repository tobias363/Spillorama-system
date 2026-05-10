# Vendors — Spillorama-system

**Sist oppdatert:** 2026-05-10
**Eier:** Tobias Haugen
**Status:** Aktiv (levende dokument)
**Review-kadens:** Hver 6. måned + ved hver ny kontrakt/fornyelse

> **Til ny PM:** Dette er sentral oversikt over hver tredjeparts-leverandør
> Spillorama er avhengig av. Kontrakts-detaljer, fornyelsesdatoer,
> kontaktpersoner, SLA, og hva som skjer hvis leverandøren forsvinner.
>
> **Sikkerhet:** Lim ALDRI inn API-nøkler her. Selve credentials ligger i
> [`secrets/`](../../secrets/) (gitignored). Denne filen er committet og
> synlig i git-historikk.

---

## Oversikt

| # | Leverandør | Kategori | Kritikalitet | Kontrakt utløper | SLA |
|---|---|---|---|---|---|
| 1 | Render.com | PaaS / hosting | KRITISK (eneste hosting) | _<fyll inn>_ | 99.95 % |
| 2 | Swedbank Pay | Payment gateway | KRITISK (eneste betalings-vei) | _<fyll inn>_ | _<fra avtale>_ |
| 3 | BankID | KYC / autentisering | HØY (alternativ: lokal verifikasjon i dev) | _<fyll inn>_ | _<fra avtale>_ |
| 4 | Sentry | Observability / error-tracking | MIDDELS | _<fyll inn>_ | 99.9 % |
| 5 | SMTP-leverandør (TBD) | E-post-utsendelse | MIDDELS | _<fyll inn>_ | _<fra avtale>_ |
| 6 | Domene-registrar | DNS | HØY | _<fyll inn>_ | — |
| 7 | GitHub | Source control + CI | HØY | _<plan-utløp>_ | 99.9 % |
| 8 | Linear | Issue-tracking | LAV (kan migreres) | _<fyll inn>_ | — |
| 9 | Anthropic (Claude) | AI-utviklings-verktøy | LAV (vekt-redskap) | _<plan-utløp>_ | — |

---

## Per leverandør

### 1. Render.com

**Hva vi bruker:** Hele prod-stack — backend (Node.js), Postgres 16, Redis 7,
admin-web (static), game-client (static). Region: Frankfurt. Auto-deploy fra
`main`-branch via Blueprint (`render.yaml`).

**Kritikalitet:** **KRITISK.** Hvis Render er nede, er Spillorama nede. Ingen
multi-region failover (R-003 i [`RISKS.md`](../RISKS.md)).

**Kontaktinfo:**
- Konto-eier: Tobias Haugen (tobias@nordicprofil.no)
- Login: https://dashboard.render.com/
- Support: https://render.com/contact
- API-docs: https://api-docs.render.com/

**Kontrakt:**
- Plan: _<fyll inn — Pro / Team / Enterprise>_
- Månedlig kost: _<fyll inn>_
- Fornyelse: _<fyll inn dato>_
- Auto-renew: _<ja/nei>_

**Credentials:** Se [`secrets/render-api.template.md`](../../secrets/render-api.template.md)
og [`docs/operations/CREDENTIALS_AND_ACCESS.md`](./CREDENTIALS_AND_ACCESS.md).

**Operative docs:**
- [`RENDER_ENV_VAR_RUNBOOK.md`](./RENDER_ENV_VAR_RUNBOOK.md) — env-var-håndtering
- [`RENDER_GITHUB_SETUP.md`](./RENDER_GITHUB_SETUP.md) — GitHub-integrasjon
- [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) — DR ved Render-utfall

**SLA:** 99.95 % per Render — tilsvarer ~22 min/måned tillatt nedetid.

**Hva skjer hvis Render forsvinner:** Migrering til alternativ (Fly.io, Railway,
egen Kubernetes) tar 2–4 uker. Adapter-pattern i backend abstraherer noe
(`apps/backend/src/adapters/`), men Render-spesifikke env-var-mønster og
auto-deploy må re-implementeres.

---

### 2. Swedbank Pay

**Hva vi bruker:** Betalingsgateway for innskudd. Player initierer top-up via
admin-web → backend kaller Swedbank Pay API → Swedbank håndterer 3D-Secure → 
callback til vår `/api/payments/callback`.

**Kritikalitet:** **KRITISK.** Eneste payment-vei i prod. Ingen alternativ
implementert (ingen Vipps, Stripe, Adyen).

**Kontaktinfo:**
- Konto-eier: _<fyll inn>_
- Account manager: _<navn + e-post>_
- Tech-support: _<e-post / portal>_
- Docs: https://developer.swedbankpay.com/

**Kontrakt:**
- Avtale-ID: _<fyll inn>_
- Inngått: _<dato>_
- Fornyelse: _<dato>_
- Transaksjons-fee: _<fyll inn — % + faste beløp>_
- Mock vs prod-credentials: _<dokumenter hvor mock kjøres>_

**Env-vars (prod på Render):**
- `SWEDBANK_PAY_ACCESS_TOKEN`
- `SWEDBANK_PAY_PAYEE_ID`
- `SWEDBANK_PAY_PAYEE_NAME`
- `SWEDBANK_PAY_API_BASE_URL`
- `SWEDBANK_PAY_CALLBACK_URL`
- `SWEDBANK_PAY_COMPLETE_URL`
- `SWEDBANK_PAY_CANCEL_URL`
- `SWEDBANK_PAY_REQUEST_TIMEOUT_MS`

**SLA:** _<fra avtale — typisk 99.9 % for payment-providers>_.

**Hva skjer hvis Swedbank Pay er nede:**
- Innskudd ikke mulig — vis bruker-vennlig "midlertidig utilgjengelig"
- Spillere kan fortsatt spille med eksisterende balanse
- Settlement og payout fortsetter (ikke avhengig av Swedbank)
- Eskalering: Ring Swedbank Pay support direkte

---

### 3. BankID

**Hva vi bruker:** KYC og spiller-autentisering. Currently `KYC_PROVIDER=local`
i prod (alder-sjekk lokalt) men infrastruktur er klar for prod-rollout.

**Kritikalitet:** HØY ved prod-rollout. Per pilot er ikke-BankID en akseptert
midlertidig løsning.

**Kontaktinfo:**
- Konto-eier: _<fyll inn>_
- Vendor: _<BankID Norge AS / Signicat / annen integrator>_
- Account manager: _<navn>_
- Tech-support: _<>_
- Docs: _<URL>_

**Kontrakt:**
- Avtale-ID: _<>_
- Fornyelse: _<>_
- Per-verifikasjon-kost: _<>_

**Env-vars:**
- `KYC_PROVIDER` (`local` | `bankid`)
- `BANKID_CLIENT_ID`
- `BANKID_CLIENT_SECRET`
- `BANKID_AUTHORITY`
- `BANKID_REDIRECT_URI`

---

### 4. Sentry

**Hva vi bruker:** Error-tracking og performance-monitoring.

**Kritikalitet:** MIDDELS. Hvis Sentry er nede mister vi error-aggregering,
men prod fungerer.

**Kontaktinfo:**
- Konto-eier: _<>_
- Workspace: _<>_
- Plan: _<Free / Team / Business>_

**Kontrakt:**
- Plan utløper: _<>_
- Månedlig kost: _<>_

**Env-vars:**
- `SENTRY_DSN` _(verifiser at denne er aktivert i prod)_

---

### 5. SMTP-leverandør

**Hva vi bruker:** E-post-utsendelse via Nodemailer. Aktuell SMTP-leverandør:
_<TBD — sjekk Render env-vars: SMTP_HOST, SMTP_USER, SMTP_PASS>_.

**Kritikalitet:** MIDDELS. Compliance-varsler (limit-overskridelse,
self-exclusion-bekreftelse) må komme frem.

**Kandidater:** Postmark, SendGrid, Mailgun, AWS SES.

**Kontrakt:** _<fyll inn>_

---

### 6. Domene-registrar

**Hva vi bruker:** Spillorama-domene.

**Kritikalitet:** HØY. Hvis domene utløper utilsiktet, er Spillorama
utilgjengelig.

**Kontaktinfo:**
- Registrar: _<>_
- Konto: _<>_
- Domener:
  - _<liste alle aktive domener her>_
- Auto-renew: _<ja/nei per domene>_

**Anbefaling:** Sett kalenderpåminnelse 30 dager før hver utløp.

---

### 7. GitHub

**Hva vi bruker:** Source control (`tobias363/Spillorama-system`), GitHub
Actions, CODEOWNERS, PR-flow, secrets management.

**Kontaktinfo:**
- Konto: tobias363
- Plan: _<Free / Pro / Team / Enterprise>_
- Org: _<personlig konto eller org?>_
- Plan-utløp: _<>_

**Sikkerhet:**
- 2FA aktivert: _<verifiser>_
- Branch-protection på `main`: _<verifiser>_
- Code-owner-required-review: _<verifiser>_

---

### 8. Linear

**Hva vi bruker:** Issue-tracking (`BIN-NNN`-prefiks), workspace `Bingosystem`.

**Kontaktinfo:**
- Workspace: Bingosystem
- Plan: _<>_
- MCP-status: ✅ Koblet til Cowork per 2026-05-10

---

### 9. Anthropic (Claude)

**Hva vi bruker:** Claude Code, Claude API, Cowork-mode for AI-assistert
utvikling og PM-orkestrering.

**Kontaktinfo:**
- Konto: tobias@nordicprofil.no
- Plan: _<>_

---

## Vendor-onboarding-checklist (ny leverandør)

- [ ] Legg til i tabellen øverst
- [ ] Ny seksjon med samme struktur som over
- [ ] Lagre kontakt-info i Tobias' password manager
- [ ] Hvis API: lag template i `secrets/<vendor>-api.template.md`
- [ ] Oppdater `docs/operations/CREDENTIALS_AND_ACCESS.md`
- [ ] Hvis kritisk vendor: oppdater [`RISKS.md`](../RISKS.md) (R-008 vendor lock-in)
- [ ] Sett kalender-påminnelse 30 dager før første fornyelse

## Vendor-offboarding-checklist (avsluttet leverandør)

- [ ] Marker som DEPRECATED i tabellen (ikke slett — kontekst for fremtid)
- [ ] Revoke alle credentials hos vendoren
- [ ] Slett relaterte env-vars i Render
- [ ] Slett `secrets/<vendor>-api.local.md` lokalt
- [ ] Oppdater `CREDENTIALS_AND_ACCESS.md`
- [ ] Skriv ADR hvis migrasjon var ikke-trivielt

---

## Halvårlig review

- [ ] Verifiser at alle kontrakts-utløp i tabellen er korrekte
- [ ] Sjekk pris-økninger siden sist
- [ ] Vurder om noen vendor bør byttes (ROI vs migrasjons-kost)
- [ ] Oppdater "Sist oppdatert" øverst

---

**Se også:**
- [`STAKEHOLDERS.md`](./STAKEHOLDERS.md) — interne og eksterne personer
- [`CREDENTIALS_AND_ACCESS.md`](./CREDENTIALS_AND_ACCESS.md) — hvor credentials ligger
- [`docs/RISKS.md`](../RISKS.md) — R-008 vendor lock-in
- [`secrets/`](../../secrets/) — lokale API-nøkler
