# Compliance Incident Procedure (BIN-790 C4)

**Owner:** Compliance-eier (TBD pre-pilot)
**Co-owner:** Technical lead (Tobias Haugen)
**Related Linear:** BIN-790 (M2 — Multi-hall-launch, Spor C — Operasjon & infrastruktur)
**Last updated:** 2026-05-08
**Audience:** Compliance-eier, Tobias, L3 incident commander, jurist (ved behov).

> Denne runbooken beskriver hvordan vi håndterer hendelser som
> involverer pengespillforskriften, audit-trail eller Lotteritilsynet-
> melding. Det inkluderer:
>
> - Compliance-ledger out-of-balance
> - Audit hash-chain-brudd
> - KYC-omgåelse (faktisk eller mistanke)
> - Spillegrenser ikke håndhevet
> - Datatap > 5 min RPO
> - Sikkerhetsbrudd (GDPR / personvern)
> - Pengetap pga. logikk-feil
>
> For tekniske mitigation-prosedyrer for hver kategori, se referansene i
> §10. Denne runbooken er **regulatorisk-spesifikk** — hva, hvem, når
> mot myndigheter.

---

## 0. TL;DR

Tre lover som binder oss:

| Lov | SLA-krav | Myndighet |
|---|---|---|
| **Pengespillforskriften §11/§71** | Datatap som påvirker spiller-utbetalinger: meldepliktig innen 24 timer (skriftlig) | Lotteritilsynet |
| **GDPR Art. 33** | Personopplysning-sikkerhetsbrudd: meldepliktig innen 72 timer | Datatilsynet |
| **Større utfall** (>1 t, >50 % av haller) | Muntlig varsel umiddelbart, skriftlig oppfølger innen 24 t | Lotteritilsynet |

Compliance-eier eier alle disse SLA-ene. Backend-team leverer data-
eksport på forespørsel innen 1 time.

---

## 1. Trigger — når er dette en compliance-hendelse?

### 1.1 Automatiske triggers (P1)

- `wallet_reconciliation_alerts`-rad med `divergence > 1.00 NOK`
- Hash-chain-validering feiler (`audit_log.chain_valid = false`)
- Compliance-ledger duplicate-rader (selv om UNIQUE-constraint skal
  forhindre dette)
- KYC-gate omgått (rad i `app_compliance_audit` med `kyc_status='UNVERIFIED'` etter spill-start)
- Loss-limit overskredet uten håndhevelse
- Pause-flow feilet (spilleren kunne spille videre tross obligatorisk pause)

### 1.2 Datatap-triggers (P1)

- Postgres restore som mistet > 5 min data
- Migration som droppet ledger-rader
- Operatør-feil som modifiserte compliance-data

### 1.3 Sikkerhetstriggers (P1)

- SQL-injection oppdaget i prod-logger
- Unauthorized access til admin-konsoll
- Personopplysninger eksponert (også via lekket API-nøkkel)
- DoS-attack som tok ned compliance-tjeneste

### 1.4 Eksterne triggers

- Lotteritilsynet ber om data eller hendelses-rapport
- Datatilsynet ber om GDPR-rapport
- Hall-eier rapporterer mistenkelig spiller-aktivitet
- Spiller-klage som peker på regulatorisk-problem

---

## 2. Detection

| Signal | Kilde | Når trigger |
|---|---|---|
| Nightly recon-job alarm | `WalletReconciliationService` cron | Divergens > 0.01 NOK |
| Audit hash-chain-brudd | `auditChainValidator`-cron | `chain_valid=false` på en rad |
| KYC-gate-bypass | App-logg `[BIN-540] complianceAllowsPlay` | Spillere som ikke skulle spille |
| Pause-håndhevelse-feil | `[BIN-X] mandatory_pause` event | Spiller passerte pause-vindu |
| Manuell rapport-avvik | Compliance-eier sammenligner mot Swedbank | Daglig kontroll |
| Sentry — noen exception-class | Sentry filter på `tag:compliance` | Compliance-relatert kode kaster |

### 2.1 Daglig kontroll

> Ansvarlig: compliance-eier.
>
> Frekvens: hver morgen (08:00–10:00 lokal).

```sql
-- 1. Åpne wallet-reconciliation-alerts
SELECT COUNT(*) FROM wallet_reconciliation_alerts WHERE resolved_at IS NULL;
-- Forventet: 0–1 (1 = nylig oppdaget, må undersøkes)

-- 2. Audit hash-chain
SELECT COUNT(*) FROM audit_log WHERE chain_valid = false;
-- Forventet: 0

-- 3. Ledger-rader siste 24 t
SELECT COUNT(*), SUM(amount_cents)
  FROM compliance_ledger
 WHERE created_at > NOW() - INTERVAL '24 hours';
-- Sammenlign med Swedbank Merchant Portal manuelt

-- 4. KYC-status-fordeling
SELECT kyc_status, COUNT(*) FROM app_users GROUP BY 1;
-- Pre-pilot: forvent 100 % VERIFIED for aktive spillere

-- 5. Pause-håndhevelse — sjekk at obligatoriske pauser er respektert
SELECT user_id, COUNT(*) AS games_during_pause
  FROM app_player_game_actions
 WHERE created_at BETWEEN paused_until - INTERVAL '5 min' AND paused_until
 GROUP BY 1
HAVING COUNT(*) > 0;
-- Forventet: 0 rader
```

---

## 3. Severity — compliance-kontekst

### 3.1 Severity-matrise (compliance-spesifikk)

| Nivå | Definisjon | Lotteritilsynet-melding? |
|---|---|---|
| **C-P1** | Pengetap, ledger-out-of-balance, KYC-omgåelse, datatap > 5 min, sikkerhetsbrudd | Ja, innen 24 t |
| **C-P2** | Audit-trail-anomali uten kjent pengetap, Stress-test-feil, mistanke | Avvent forensikk; rapporter hvis bekreftet |
| **C-P3** | Cosmetic UI-feil i compliance-rapporter, ikke-kritisk metadata-mangler | Nei, intern dokumentasjon |

### 3.2 Eskalering

```
Compliance-trigger
   │
   ▼
L2 backend ser tekniske symptomer
   │
   ▼
Compliance-eier varsles innen 1 t (eller umiddelbart for C-P1)
   │
   ▼
Compliance-eier + Tobias → vurder Lotteritilsynet-melding
   │
   ├─ C-P1 bekreftet → Skriftlig melding innen 24 t
   │
   ├─ C-P2 → Forensikk pågår, intern dokumentasjon
   │
   └─ C-P3 → Intern dokumentasjon
```

---

## 4. Mitigation

### 4.1 Steg 1: Stabiliser teknisk

Før compliance-eier kan vurdere riktig respons, må de tekniske
symptomene være under kontroll.

| Symptom | Bruk runbook |
|---|---|
| Wallet-out-of-balance | [`WALLET_RECONCILIATION_RUNBOOK.md`](./WALLET_RECONCILIATION_RUNBOOK.md) |
| DB-data tapt | [`DATABASE_RESTORE_PROCEDURE.md`](./DATABASE_RESTORE_PROCEDURE.md) |
| Backend-krasj | [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) §3 |
| KYC-bypass | Sett `app_users.kyc_status='SUSPENDED'` for berørte spillere |
| Pause-håndhevelse-feil | Force-end pågående runder + skriv `correction`-ledger |
| Sikkerhetsbrudd | Roter alle secrets, sett alle haller `is_active=false` |

### 4.2 Steg 2: Forensikk

> Eier: compliance-eier + L2 backend.

```bash
# 1. Eksporter Render-logg fra hendelses-vinduet
# Render-dashboard → Logs → tidsfilter
# Lagre som CSV/JSON for vedlegg

# 2. Eksporter berørte ledger-rader
psql "$APP_PG_CONNECTION_STRING" \
  -c "COPY (SELECT * FROM compliance_ledger
            WHERE created_at BETWEEN '<start>' AND '<end>')
      TO '/tmp/compliance_window.csv' CSV HEADER;"

# 3. Eksporter audit-log
psql "$APP_PG_CONNECTION_STRING" \
  -c "COPY (SELECT * FROM audit_log
            WHERE created_at BETWEEN '<start>' AND '<end>')
      TO '/tmp/audit_window.csv' CSV HEADER;"

# 4. Eksporter wallet-history for berørte spillere
psql "$APP_PG_CONNECTION_STRING" \
  -c "COPY (SELECT * FROM wallet_entries
            WHERE wallet_id IN (...)
              AND created_at BETWEEN '<start>' AND '<end>')
      TO '/tmp/wallet_window.csv' CSV HEADER;"

# 5. Sentry incident-id
# https://sentry.io/organizations/spillorama/issues/?statsPeriod=...
```

### 4.3 Steg 3: Korrigering

> Korrigeringer skrives som **nye rader**, ALDRI som DELETE/UPDATE av
> originaler. Idempotency-key UNIQUE-constraint stopper dobbelt-skriv.

#### Wallet-balanse korrigering

```sql
-- Skriv negativ correction-ledger-rad for å nullstille feil
INSERT INTO compliance_ledger (
  idempotency_key, user_id, wallet_id, amount_cents, type,
  reason, created_at, created_by
) VALUES (
  'correction-<incident-id>-<wallet-id>',
  '<user-id>', '<wallet-id>', -<amount-cents>, 'CORRECTION',
  'Hendelse <incident-id>: <kort beskrivelse>',
  NOW(), 'compliance-owner-uuid'
);

-- Korresponderende wallet-entry
INSERT INTO wallet_entries (
  wallet_id, account_side, amount, type, idempotency_key, created_at
) VALUES (
  '<wallet-id>', 'deposit', -<amount-cents>, 'CORRECTION',
  'correction-<incident-id>-<wallet-id>', NOW()
);
```

#### KYC-status-rollback

```sql
-- Hvis spiller skulle ha vært verifisert men ble feilaktig clearet
UPDATE app_users
   SET kyc_status = '<correct-status>',
       kyc_status_reason = 'Hendelse <incident-id>: korrigert <dato>'
 WHERE id = '<user-id>'
   AND kyc_status = '<incorrect-status>';
```

> Alle korrigeringer **må signeres av compliance-eier** før de
> committes. Logg signaturen som kommentar i Linear-issue + i SQL-
> commenten.

### 4.4 Steg 4: Lotteritilsynet-melding (C-P1)

Bruk template i §5 nedenfor. Send fra compliance-eier-konto til
saksbehandler hos Lotteritilsynet (kontaktinfo eier compliance-eier).

---

## 5. Lotteritilsynet — meldings-template

### 5.1 Skriftlig melding (innen 24 t for C-P1)

```
Til: Lotteritilsynet
Att.: [saksbehandler-navn, hvis kjent]
Fra: Spillorama Compliance — [navn], [stilling]
Dato: [yyyy-mm-dd]

EMNE: Hendelsesrapport — pengespillforskriften §[relevant § — typisk
§71 om rapportering, §11 om utdeling, §66 om obligatorisk pause]

—

1. SAMMENDRAG

[1-2 setninger, faktabasert. Eksempel: "Vi oppdaget 2026-05-08 kl
14:00 UTC en avvikelse mellom forventet og faktisk wallet-balanse
for én spiller, som følge av en logikk-feil i payout-kode."]

2. TIDSPUNKT

Hendelse oppstod: [iso-8601 utc]
Hendelse oppdaget: [iso-8601 utc]
Hendelse løst: [iso-8601 utc]
Total varighet: [X timer Y minutter]

3. OMFANG

Antall spillere berørt: [X]
Antall haller berørt: [Y av 23]
Total transaksjons-volum involvert: [Z NOK]
Kanal(er) berørt: [hall-main-game / internet-main-game / databingo]

4. BESKRIVELSE

[3-5 setninger som forklarer:
- Hva som faktisk skjedde teknisk
- Hvilke spilleropplevelser som ble berørt
- Om spillere fikk for mye eller for lite utbetalt
- Om data ble tapt eller modifisert]

5. PÅVIRKNING PÅ SPILLERE

[Spesifikt:
- Hvor mange spillere fikk feilaktig saldo? Med hvor mye?
- Ble noen utbetalinger forsinket?
- Måtte vi korrigere transaksjoner manuelt?]

6. PÅVIRKNING PÅ AUDIT-DATA

[Hvilke ledger-rader er involvert. Hvis Lotteritilsynet ber om
auditerbar data, kan vi levere dette innen 1 time.]

7. UMIDDELBARE TILTAK

[Hva vi gjorde for å stoppe skaden:
1. [Steg 1, eks. "Satt alle haller i maintenance kl HH:MM"]
2. [Steg 2, eks. "Eskalerte til technical lead innen 5 min"]
3. [Steg 3, eks. "Korrigerte saldo for berørte spillere innen 30 min"]]

8. ROTÅRSAK

[Konkret forklaring av hvorfor det skjedde. Hvis kjent: kode-feil,
operatør-feil, infrastruktur-svikt.]

9. KORRIGERENDE TILTAK

[Hva vi har gjort eller skal gjøre for å hindre gjentak:
1. [Eks. "Lagt til validering i kode (PR XXX, merget YYYY-MM-DD)"]
2. [Eks. "Lagt til automatisk alert for tilsvarende symptom"]
3. [Eks. "Oppdatert runbook med ny prosedyre"]]

10. VEDLEGG

A. Render-logg-utdrag for hendelses-vinduet
B. Compliance-ledger SQL-eksport (før og etter korrigering)
C. Audit-log SQL-eksport
D. Wallet-history for berørte spillere
E. Sentry-incident-id og stack-trace
F. Linear-issue-link

—

Med vennlig hilsen,

[navn]
[stilling]
Spillorama AS
[telefon]
[e-post]
```

### 5.2 Muntlig varsel (umiddelbart, > 1 t / > 50 % haller)

> Bruk hvis hele plattformen er nede > 1 time eller mer enn 50 % av
> hallene berørt. Compliance-eier ringer direkte; skriftlig
> oppfølging innen 24 t.

Skript:

> "Hei, dette er [navn] fra Spillorama. Vi har en pågående
> hendelses-situasjon vi vil melde inn. Tidspunkt: [hh:mm utc].
> Symptom: [én setning, ikke teknisk]. Antall haller berørt: [X].
> Forventet løsning: [tid].
>
> Vi følger opp skriftlig innen 24 timer. Kan jeg få bekreftet
> riktig saksbehandler å sende skriftlig rapport til?"

---

## 6. GDPR Art. 33 — Datatilsynet

### 6.1 Når kreves melding?

Personopplysnings-sikkerhetsbrudd som er *sannsynlig å føre til*:

- Betydelig økonomisk tap for berørte personer
- Identitetstyveri eller bedrageri
- Personlig integritet, fysisk skade eller diskriminering
- Tap av kontroll over egne personopplysninger

### 6.2 SLA: 72 timer fra oppdagelse

Hvis ikke meldepliktig, dokumenter eksplisitt **hvorfor** i intern
incident-rapport. Vurderingen lagres for fremtidig ettersyn.

### 6.3 Innhold

Datatilsynets melde-portal: https://www.datatilsynet.no/avvik

Krever:

- Type avvik (eks. uautorisert tilgang, lekkasje, tap)
- Tidspunkt
- Antall berørte personer
- Type personopplysninger involvert
- Forventet konsekvens
- Tiltak iverksatt
- Kontaktperson

### 6.4 Når skal berørte personer informeres?

Hvis avviket er *sannsynlig å føre til høy risiko* for personene
(skadelig konsekvens), må berørte spillere varsles direkte.

Eksempel: hvis e-post + telefon + KYC-data har lekket → spilleren skal
informeres innen rimelig tid (typisk 7 dager).

---

## 7. Verifisering — etter hendelse

| Sjekk | Forventet |
|---|---|
| Wallet-recon-job grønn neste natt | 0 nye divergenser |
| Audit-chain validert | `chain_valid = true` på alle rader |
| Korrigeringer signerte i Linear | Compliance-eier-signatur synlig |
| Lotteritilsynet-rapport sendt og kvittering mottatt | Kvittering arkivert |
| Datatilsynet-melding (om relevant) sendt | Bekreftelses-e-post arkivert |
| Berørte spillere informert (om relevant) | E-post sendt |
| Hendelse lukket i Linear | Status `Done` |
| Post-mortem skrevet og signert | `incident-log/<dato>.md` finnes |

---

## 8. Communication

### 8.1 Intern Slack — under hendelse

```
:rotating_light: COMPLIANCE-INCIDENT C-P1 | [hh:mm]

Trigger: [eks. "Wallet-reconciliation alarm — divergens 1234 NOK"]
Berørt: [antall spillere / haller]
Eier: @[compliance-eier]
Tobias: notified @yes
Tilsyn-melding: [vurderes / planlagt for hh:mm dag-1]

Live-tråd: :thread:
```

### 8.2 Spiller-melding (ved direkte berørt)

For spillere som hadde feilaktig saldo (over- eller underbetalt):

```
Tittel: Viktig: korreksjon av spillesaldoen din

Hei [navn],

Spillorama oppdaget [dato] en feilaktig registrering i [tjeneste/runde].
Dette har påvirket din saldo med [+/- X NOK].

Hva vi har gjort:
- Vi har korrigert din saldo per [dato].
- Korrigeringen er audit-loggført.

Hva du som spiller bør gjøre:
- Ingenting — alt er allerede korrigert.
- Hvis du ser noe uventet i transaksjonshistorikken din, ta kontakt
  med support@spillorama.no.

Vi har også meldt hendelsen til Lotteritilsynet i samsvar med
pengespillforskriften.

Hilsen,
Spillorama Compliance
```

### 8.3 Hall-eier (om hall-data er involvert)

Bruk [`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) §6.1
template, men inkluder eksplisitt at "Lotteritilsynet er informert".

### 8.4 Status-side

For brede compliance-hendelser som påvirker spilleropplevelse:

```sql
INSERT INTO app_status_incidents (...) VALUES (
  'Vedlikeholdsoperasjon pågår',
  'Vi gjør en planlagt korreksjon på en del av tjenesten. Ingen handling
nødvendig fra deg. Spillet fortsetter normalt.',
  'investigating', 'minor',
  ...
);
```

> **Ikke** publiser detaljer om compliance-hendelse på status-side. Det
> er for hall-eier-/spiller-kommunikasjon, ikke offentlig PR.

---

## 9. Post-mortem

Alle C-P1 og C-P2 krever post-mortem per
[`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) §7. I tillegg:

### 9.1 Spesifikke compliance-spørsmål

1. **Hvilken pengespillforskrift-paragraf er involvert?**
2. **Var Lotteritilsynet-melding sendt innen 24 t?**
3. **Var Datatilsynet-melding (om relevant) sendt innen 72 t?**
4. **Hvilken automatisk kontroll mangler som ville fanget dette?**
5. **Burde audit-trail vært strengere?** (Eks. hash-chain validation,
   periodisk recon-job)
6. **Hvor mange spillere ble berørt? Hvor mye penger?**
7. **Burde vi ha hatt en rolle-tilgangskontroll som forhindret
   operatør-feil?**

### 9.2 Action items — typiske

- Legge til ny automatisk alert
- Stramme inn DB-tilgang for ikke-Tobias
- Audit-cron-job for ny invariant
- Compliance-suite-utvidelse i CI
- Runbook-oppdatering med ny prosedyre

### 9.3 Eierskap

- L3 incident commander leder review-sesjon
- Compliance-eier leverer regulatorisk-vinkel
- Tobias signerer som "lest"

---

## 10. Drill-anbefaling

### 10.1 Pre-pilot — obligatorisk

- D-COMP-1: Wallet-reconciliation-mismatch-drill (matcher
  [`WALLET_RECONCILIATION_RUNBOOK.md`](./WALLET_RECONCILIATION_RUNBOOK.md) §10).
- D-COMP-2: Lotteritilsynet-rapport-mal-drill (table-top, 60 min).

### 10.2 Kvartalsvis

- D-COMP-3: KYC-bypass-simulering — staging, sett en bruker som
  `UNVERIFIED` og forsøk å starte spill. Verifiser at gate fanger.
- D-COMP-4: Audit-chain-brudd-drill — modifiser audit-rad i staging,
  verifiser at recon-cron fanger og alarmerer.

### 10.3 Halvårlig

- D-COMP-5: Full Lotteritilsynet-rapport-drill (skriv komplett rapport
  for hypotetisk hendelse, send som test til intern arkiv).
- D-COMP-6: GDPR-melding-drill (table-top med Datatilsynet-portal-flow).

### 10.4 D-COMP-2 prosedyre (table-top, ~60 min)

**Pre-requisites:**
- Compliance-eier + Tobias + L3
- Hypotetisk scenario forberedt: "Wallet-balanse-mismatch på 1500 NOK
  oppdaget i nightly recon-job for én spiller"

**Steg:**

1. **Klassifiser severity** (15 min)
   - Er det C-P1?
   - Hvilken § i pengespillforskriften?
   - Datatilsynet-melding nødvendig?

2. **Skriv eskalering-tråd** (15 min)
   - Slack-melding
   - Hall-eier-melding (om relevant)
   - Spiller-melding

3. **Skriv Lotteritilsynet-rapport** med template §5.1 (20 min)
   - Fyll inn alle felter med plausibel hypotetisk data
   - Vedlegg-liste

4. **Sjekk SLA-er** (10 min)
   - 24-timers vindu for skriftlig melding
   - 72-timers vindu for Datatilsynet (om GDPR-relevant)

5. **Logg drill** i `docs/operations/dr-drill-log/<yyyy-mm>-COMP-2.md`.

**Suksesskriterier:**
- ✅ Alle deltakere er enige om severity-klassifisering
- ✅ Lotteritilsynet-rapport er fullstendig (alle 10 seksjoner)
- ✅ SLA-vurdering korrekt

---

## 11. Pilot-gating

Før første hall flippes til prod:

- [ ] Compliance-eier identifisert og kontaktinfo dokumentert
- [ ] Lotteritilsynet-saksbehandler-kontaktinfo bekreftet
- [ ] Datatilsynet-portal-tilgang verifisert
- [ ] D-COMP-1 + D-COMP-2 utført med pass-status
- [ ] On-call-rotasjonen kjenner C-P1/C-P2/C-P3-klassifiseringen
- [ ] Audit-cron-jobs (recon, hash-chain, KYC-status) verifisert grønne
- [ ] Post-mortem-template signert
- [ ] Compliance-eier har lest hele runbooken og signert

---

## 12. Eierskap

| Rolle | Ansvar |
|---|---|
| Compliance-eier (TBD) | Eier hele Lotteritilsynet- og Datatilsynet-flyt; klassifiserer C-P1/2/3 |
| Tobias (technical lead) | Signerer endelig melding; eier korrigerings-SQL |
| L3 incident commander | Eskalerer tekniske symptomer til compliance-eier |
| L2 backend on-call | Stabiliserer teknisk side; leverer forensikk-data innen 1 t |
| Jurist (ad-hoc) | Konsulteres ved tvil om GDPR-grenser |

---

## 13. Referanser

- [`INCIDENT_RESPONSE_PLAN.md`](./INCIDENT_RESPONSE_PLAN.md) — overordnet
- [`WALLET_RECONCILIATION_RUNBOOK.md`](./WALLET_RECONCILIATION_RUNBOOK.md) — daglig recon
- [`DATABASE_RESTORE_PROCEDURE.md`](./DATABASE_RESTORE_PROCEDURE.md) — datatap-restore
- [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) — rom-recovery (compliance-felter)
- [`docs/architecture/SPILL_REGLER_OG_PAYOUT.md`](../architecture/SPILL_REGLER_OG_PAYOUT.md) §9.6 — compliance-felter
- [`docs/compliance/`](../compliance/) — pengespillforskriften-spec
- Pengespillforskriften: https://lovdata.no/forskrift/2014-12-19-1855
- GDPR Art. 33: https://gdpr-info.eu/art-33-gdpr/
- Datatilsynet: https://www.datatilsynet.no/avvik
- Lotteritilsynet: https://lottstift.no/
