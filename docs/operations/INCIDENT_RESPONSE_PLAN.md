# Incident Response Plan (BIN-790 C4)

**Owner:** Technical lead (Tobias Haugen)
**Related Linear:** BIN-790 (M2 — Multi-hall-launch, Spor C — Operasjon & infrastruktur)
**Last updated:** 2026-05-08
**Pilot-gating:** Ja — denne planen må være gjennomgått og signert av on-call-rotasjonen før første hall flippes til prod.

> Denne planen beskriver **hvordan vi reagerer** når noe går galt — uavhengig
> av hvilken komponent som svikter. Konkrete prosedyrer for spesifikke
> hendelser ligger i søster-runbooks (se §10 Referanser).
>
> For rom-spesifikke recovery-prosedyrer se
> [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md). For hall-pilot-
> spesifikk severity og rollback-trigger se
> [`HALL_PILOT_RUNBOOK.md`](./HALL_PILOT_RUNBOOK.md).

---

## 0. TL;DR

Tre ting denne planen eksisterer for:

1. **Felles severity-språk** — P1/P2/P3 betyr det samme uansett om feilen
   ligger i wallet, engine, hall-internett eller TV-skjerm. Ingen
   misforståelser om "hvor alvorlig er dette egentlig".
2. **Eskalerings-tre med klare mål** — fra første alarm til riktig
   beslutningstaker innen tidsbudsjett. Spar minutter ved å unngå
   "hvem skulle jeg ringt".
3. **Kommunikasjons-templates** — hall-eier, spiller, Lotteritilsynet,
   intern Slack. Ingen fritekst-melding under press.

---

## 1. Severity-matrise

| Nivå | Definisjon | Eksempler | Responstid (først alarm → first response) | Eskalering |
|---|---|---|---|---|
| **P1** | Kritisk: pengetap, compliance-brudd, datatap, full nedetid > 5 min, eller ≥ 50 % av haller berørt | Wallet-balanse-mismatch (alarm fra `wallet_reconciliation_alerts`); duplikate ledger-rader; compliance-ledger out-of-balance; full plattform-nedetid; KYC-omgåelse mulig | 5 min | Umiddelbart L3 + Tobias |
| **P2** | Stor funksjonsfeil uten direkte compliance-brudd | Master-hall handshake virker ikke i én gruppe; Spill 2 perpetual-loop frosset; én hall mister internett; Swedbank Pay nede | 15 min | L2 → L3 hvis ikke løst på 30 min |
| **P3** | Mindre avvik med workaround | TV-skjerm i én hall henger (F5 fikser); enkelt-terminal feiler (replacement-pool tar over); CMS-rendering-glitch | 60 min | Egen agent fikser i normal rytme |
| **Sev-Info** | Planlagt vedlikehold, varsling | Deploy-vindu, Render-region-vedlikehold | Ikke-tidskritisk | Bare informasjon i `#ops-cutover` |

### 1.1 P1-trigger — eksplisitt regler

Følgende **automatisk** klassifiseres som P1 uten skjønn:

- `wallet_reconciliation_alerts`-rad med `divergence > 1.00 NOK` eller åpne alerts > 5 (audit-skjema-brudd)
- Hash-chain-brudd i compliance-audit (`audit_log` chain-validation feiler)
- Postgres write-failure > 60 sek
- `/health` 5xx > 90 sek
- Ledger duplicate-key-conflict (idempotency-key UNIQUE-constraint utfordret)
- Sentry exception-burst > 10/min i `spillorama-backend`
- Hall-omfattende rapport-mismatch > 100 NOK/dag mellom Swedbank og DB
- Lotteritilsynet-meldepliktig hendelse (datatap > 5 min, sikkerhetsbrudd)

### 1.2 P2-trigger

- Live-rom (Spill 1/2/3) ikke produserer `auto.round.tick`-events i 5+ min for én hall
- Master-hall-handshake (`transferHallAccess`) i flight > 60 sek uten resolve
- Redis utilgjengelig > 2 min
- Spill 2/3 perpetual-loop ikke spawner ny runde innen 60 sek etter forrige avslutning
- Mer enn 3 forskjellige Sentry-exception-typer på 30 min
- Wallet-reconciliation-alerts åpen > 24 timer uten admin-response

### 1.3 Klassifiserings-tvil

Hvis i tvil mellom P1 og P2: **default P1**. Bedre å eskalere unødig
enn å la et compliance-brudd ligge uoppdaget. P1-eskalering er ikke
straffende — det er bare riktig signal at "to humans må se på dette".

---

## 2. Eskalerings-tre

```
   ┌─────────────────────────────┐
   │ Hendelse oppdaget            │
   │ (alert / hall-vert / spiller)│
   └──────────────┬──────────────┘
                  │
                  ▼
   ┌─────────────────────────────┐
   │ L1 hall-operatør / on-call  │   <- 0–5 min
   │ Triage + klassifisering      │
   └──────────────┬──────────────┘
                  │
        ┌─────────┼──────────────┐
        │         │              │
        ▼         ▼              ▼
       P3        P2             P1
        │         │              │
        ▼         ▼              ▼
   ┌────────┐ ┌────────┐    ┌───────────────┐
   │ Egen    │ │ L2 vakt │    │ L3 + L4       │
   │ agent   │ │ 5–10 min│    │ Tobias 0-5 min│
   │ fix     │ │         │    │               │
   └────────┘ └────┬────┘    └───────┬───────┘
                   │                 │
              30 min ute             ▼
                   │          Lotteritilsynet?
                   ▼            (compliance-eier)
              L3 inn
```

### 2.1 Roller

| Nivå | Rolle | Ansvar | Vakt-vindu |
|---|---|---|---|
| L1 | Hall-operatør / pilot-vakt | Lokal observasjon, terminal-hjelp, klassifisering, eskalering | I åpningstid |
| L2 backend | Backend on-call | Sentry/Render/Postgres-triage, runbook-execution | 24/7 (best-effort utenom 09–22) |
| L2 payment | Wallet/Swedbank on-call | Wallet-reconcile, betalings-mismatch | 24/7 (best-effort) |
| L3 incident commander | Beslutningstaker | Bestemmer rollback / SEV-eskalering / Lotteritilsynet-trigger | 24/7 |
| L4 technical lead | Tobias Haugen | Endelig myndighet, Lotteritilsynet-kontakt | Etter behov |
| Compliance-eier | TBD | Lotteritilsynet-rapport, regulatorisk vurdering | Innen 1 time |

> **Status 2026-05-08:** Bemanningen i hver rolle settes av Tobias før
> pilot-go-live. Tabell-mal i [`HALL_PILOT_RUNBOOK.md`](./HALL_PILOT_RUNBOOK.md) §2.

### 2.2 Eskaleringsregler

1. **L1 → L2 innen 5 min** ved P1/P2.
2. **L2 → L3 innen 15 min** for P1, eller når L2-vakt har prøvd standard-runbook uten å løse.
3. **L3 → L4 (Tobias) umiddelbart** for:
   - SEV-eskalering til P1
   - Beslutning om global rollback ([`ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md) §5)
   - Hot-fix utenfor normal review-prosess ([`HOTFIX_PROCESS.md`](./HOTFIX_PROCESS.md))
   - Lotteritilsynet-melding ([`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md))
4. **Compliance-eier varsles** ved alle hendelser med:
   - Ledger-rader påvirket (rapport, korrigering eller mistanke om duplikat)
   - KYC- eller pause-håndhevelse omgått
   - Datatap > 5 min RPO

### 2.3 "Stopp the bleeding" — autoritet uten godkjenning

Følgende handlinger kan L2-vakt gjøre uten å vente på L3:

- Restart backend ([`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) §3).
- Roll én hall tilbake til Unity ([`ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md) §2).
- Sett en hall i maintenance-mode (`UPDATE app_halls SET is_active = false WHERE id = '<hall>'`).
- Kjøre wallet-reconcile-job manuelt ([`WALLET_RECONCILIATION_RUNBOOK.md`](./WALLET_RECONCILIATION_RUNBOOK.md) §4).

Følgende krever L3-godkjenning:

- Global rollback (alle haller).
- Force-end aktive runder (`admin:force-end` for runder med ≥ 5 deltakere).
- Manuell DB-edit av compliance-data.
- Communication til Lotteritilsynet.

---

## 3. Detection — hvor signaler kommer fra

### 3.1 Automatiske kanaler

| Signal | Kilde | Når trigger |
|---|---|---|
| `/health` 5xx eller timeout | Render uptime probe (30 s) | Backend nede |
| Sentry exception-burst | Sentry `spillorama-backend` | Engine kaster |
| `wallet_reconciliation_alerts` rad | Nightly job (03:00 lokal) | Wallet-divergens |
| Compliance hash-chain-brudd | `auditChainValidator`-cron | Audit-trail tampered |
| `bingo_socket_connections` drop > 50 % på 60 s | Grafana `connection-health` | Massiv disconnect |
| Render-deploy "Build failed" | Render-dashboard | Migrate-feil |
| Postgres write-error rate > 5 %/min | Render-metrikk | DB-helse |
| Redis connection-failures | Render-metrikk | Redis-utfall |
| Lotteritilsynet-meldepliktig event | Compliance-cron | Datatap > 5 min |

### 3.2 Manuelle kanaler

- Hall-bingovert ringer L1-vakt (kontaktkjede i [`HALL_PILOT_RUNBOOK.md`](./HALL_PILOT_RUNBOOK.md) §2).
- Spillere klager via support@spillorama.no.
- Daglig admin-rapport-avvik (compliance-eier sammenligner manuelt mot Swedbank).
- Hall-eier i kunde-Slack (om aktivert).
- Sosiale medier / forums (sjelden, men sjekkes ved pilot-uvanlig stillhet).

### 3.3 60-sekunders triage

Før du klassifiserer hendelsen, gjør standard triage:

```bash
# 1. Backend lever?
curl -fsS https://api.spillorama.no/health | jq .

# 2. Antall aktive runder
psql "$APP_PG_CONNECTION_STRING" -c "
  SELECT COUNT(*) FROM app_game1_scheduled_games
   WHERE status IN ('ready_to_start','running','paused');
"

# 3. Antall åpne wallet-reconciliation-alerts
psql "$APP_PG_CONNECTION_STRING" -c "
  SELECT COUNT(*) FROM wallet_reconciliation_alerts WHERE resolved_at IS NULL;
"

# 4. Sentry siste 30 min
# https://sentry.io/organizations/spillorama/issues/?statsPeriod=30m

# 5. Berørte haller (hvis relevant)
psql "$APP_PG_CONNECTION_STRING" -c "
  SELECT id, slug, is_active FROM app_halls WHERE id IN (...);
"
```

---

## 4. Mitigation-flow (felles for alle hendelser)

1. **Triage (5 min)** — klassifiser per §1, identifiser komponent.
2. **Velg runbook** — pek på riktig fil i §10. Hver runbook har egne mitigation-steg.
3. **Stop the bleeding** — gjør alt som ikke kan reverseres senere (set `is_active=false`, kill request-er, restart instans). Bedre å holde for mange ut for et minutt enn å fortsette skade.
4. **Diagnose** — kjør verifikasjons-queries (i hver runbook §X.5). Skriv funn i incident-tråden.
5. **Mitigate** — følg runbook step-for-step.
6. **Verify** — kjør verifikasjons-tabellen i runbook.
7. **Communicate** — bruk templates §6 og oppdater intern Slack hver 15 min.
8. **Resolve** — sett incident til `resolved` i incident-log + status-side.
9. **Post-mortem** — innen 7 dager (§7).

### 4.1 Dokumentasjon under hendelsen

- **Slack `#bingo-pilot-war-room`**: live-koordinasjon + alle kommandoer kjørt, med output. Skjermbilder OK, men ren tekst foretrekkes for søkbarhet.
- **Incident-log**: skrives etter at hendelsen er løst, basert på Slack-tråden. Eier: L3 incident commander.
- **Compliance-vedlegg**: hvis hendelsen rører ledger eller wallet — eksporter SQL-snapshots før og etter mitigation.

---

## 5. Communication-plan

### 5.1 Når kommuniserer vi hva?

| Hendelses-fase | Hva sendes | Til hvem | Eier |
|---|---|---|---|
| Hendelse bekreftet, P1/P2 | Initial-varsel | Hall-eiere via SMS, intern Slack | L3 |
| Underveis, hvert 15 min | Status-oppdatering | Slack `#ops-cutover` | L2 |
| Spillere ser feil | Klient-melding (`/api/status` incident) | Alle spillere som ser banner | L3 |
| Hendelse løst | Resolved-melding | Hall-eiere + Slack | L3 |
| Lotteritilsynet-meldepliktig | Skriftlig melding innen 24 t | Lotteritilsynet | Compliance-eier |
| Alle hendelser | Post-mortem | Intern + relevante interessenter | L3 |

### 5.2 Slack-mal — initial-varsel

```
:rotating_light: SEV-[1|2] | [komponent] | [yyyy-mm-dd hh:mm]

Hva: [én setning, ikke teknisk]
Berørt: [hall(er) / komponent / antall spillere]
Status: investigating
Eier: @[L2-vakt] / @[L3]
Runbook: [link til relevant runbook]

Live-tråd: :thread:
```

### 5.3 Slack-mal — status-oppdatering (hvert 15 min)

```
[hh:mm] :clock: Status-update

Hva er gjort siste 15 min:
- [punkt 1]
- [punkt 2]

Hva er neste:
- [punkt 1]

Forventet løsning: [tid eller "ukjent — etter X-undersøkelse"]
```

### 5.4 Slack-mal — resolved

```
:white_check_mark: SEV-[1|2] | [komponent] | LØST

Tidslinje: [oppstart hh:mm] – [løst hh:mm]
Total-impact: [X spillere / Y haller / Z min]
Rotårsak: [én setning]

Post-mortem: [Linear-issue / dato]
```

---

## 6. Communication-templates (eksterne)

### 6.1 Hall-eier — SMS / e-post (P1/P2)

```
Tittel: Spillorama: [hendelses-type] påvirker [hall(er)]

Hei [hall-eier-navn],

Vi opplever for tiden [kort beskrivelse, 1 setning].

Hva er påvirket:
- [Konkret liste — eks. "Spill 1 startet ikke kl. 10:00 i hallen din"]
- [Eks. "Spillerne ser 'Mistet kontakt' på terminalene"]

Hva vi gjør:
- [Eks. "Backend restartes nå, forventet løsning innen 5 min"]
- [Eks. "Vi recover pågående runder fra siste sikkerhetspunkt"]

Hva du som hall-eier bør gjøre i mellomtiden:
- Ingenting — vi håndterer alt fra serversiden.
- Spillerne kan vente; pengene deres er trygge.
- Hvis spillere spør: si "Vi har et midlertidig teknisk problem,
  Spillorama er på saken og forventer at det er løst innen [tid]."

Vi sender ny oppdatering om [tid] eller når problemet er løst.

Kontakt:
- Akut: [L1-on-call-telefon]
- Generell: support@spillorama.no

Hilsen,
Spillorama Operations
```

### 6.2 Hall-eier — engelsk versjon (for utenlandske eiere)

```
Subject: Spillorama: [incident type] affecting [hall(s)]

Hi [hall-owner-name],

We are currently experiencing [brief description, 1 sentence].

What is affected:
- [Concrete list — e.g. "Game 1 did not start at 10:00 in your hall"]
- [E.g. "Players see 'Lost connection' on terminals"]

What we are doing:
- [E.g. "Restarting backend, expected resolution within 5 min"]
- [E.g. "Recovering ongoing rounds from last checkpoint"]

What you as hall owner should do:
- Nothing — we handle everything from the server side.
- Players can wait; their money is safe.
- If players ask: say "We have a temporary technical issue,
  Spillorama is on it and expects resolution within [time]."

We will send next update in [time] or when resolved.

Contact:
- Urgent: [L1-on-call phone]
- General: support@spillorama.no

Regards,
Spillorama Operations
```

### 6.3 Spiller — i klient eller via push

```
Tittel: Midlertidig teknisk forsinkelse

Vi opplever for tiden noe forsinkelse i [Spill 1 / hele plattformen].
Pengene dine er trygge, og pågående brett vil bli telt med når vi er
tilbake.

Forventet løsning: innen [X] minutter.

Du trenger ikke gjøre noe — siden vil oppdatere seg automatisk.
```

### 6.4 Status-side — incident-publish

Bruk `INSERT INTO app_status_incidents` per [`STATUS_PAGE.md`](./STATUS_PAGE.md) §"Publisere en incident manuelt". Sett `impact`:

- `none` (informasjon, planlagt vedlikehold) → grønn
- `minor` (P3) → gul
- `major` (P2) → oransje
- `critical` (P1) → rød

### 6.5 Lotteritilsynet

Se egen runbook [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md) §5 for full template + SLA-er.

---

## 7. Post-mortem-prosess

### 7.1 Når kreves post-mortem?

- **Alle P1**: obligatorisk, innen 7 dager.
- **P2 > 30 min**: obligatorisk, innen 14 dager.
- **P2 < 30 min**: anbefalt, ikke påkrevd.
- **P3**: ikke påkrevd, men kan skrives hvis det gjentar seg eller signalerer mønster.

### 7.2 Format

Filnavn: `docs/operations/incident-log/<yyyy-mm-dd>-<short-id>.md`

Eier: L3 incident commander (eller den L3 delegerer til).

```markdown
# Incident <ID> — <kort tittel>

**Dato:** YYYY-MM-DD
**Severity:** P1 / P2 / P3
**Varighet:** X timer Y min
**Eier:** [L3-navn]
**Status:** Resolved

## Sammendrag
[1-2 setninger som forklarer hva som skjedde og hvorfor]

## Tidslinje
| Tid (UTC) | Hendelse |
|---|---|
| HH:MM | Hendelse oppdaget av [kilde] |
| HH:MM | L1 eskalerer til L2 |
| HH:MM | L2 starter mitigation per [runbook §X.Y] |
| HH:MM | L3 tar SEV-vurdering |
| HH:MM | Hendelse løst, klienter normaliserer |
| HH:MM | Slack-resolved-melding sendt |

## Impact
- Antall spillere berørt: X
- Antall haller berørt: Y av 23
- Penger involvert: Z NOK
- Compliance-rader påvirket: W

## Rotårsak
[Konkret teknisk forklaring — ikke "noe gikk galt", men "X-tjenesten satt
ConnectionPool-størrelsen for lavt og skapte timeout-er på Y-flyt"]

## Hva fungerte
[Hva i prosessen som gikk bra — viktig å beholde]

## Hva fungerte ikke
[Spesifikt — runbook manglet steg, alert var sen, eskalering tok for
lang tid]

## Action items
| # | Tiltak | Eier | Linear | Frist |
|---|---|---|---|---|
| 1 | [Fix rot-årsak] | [navn] | BIN-XXX | yyyy-mm-dd |
| 2 | [Oppdater runbook §X.Y] | [navn] | BIN-XXX | yyyy-mm-dd |
| 3 | [Legg til alert for Y] | [navn] | BIN-XXX | yyyy-mm-dd |

## Vedlegg
- Sentry incident-id
- Render deploy-log
- DB-snapshots (før/etter)
- Slack-tråd-eksport
```

### 7.3 Blameless-policy

Post-mortem **skal ikke** identifisere en enkeltperson som "den som tok
feil". Vi navngir tiltak (commits, deployer, kommandoer), ikke
mennesker. Mål: lære, ikke straffe.

Hvis et tiltak peker på "X-personen hadde mer kontekst enn alle andre"
— det er en runbook-mangel, ikke en personalfeil.

### 7.4 Review

- L3 leder en 30-min review-sesjon med relevante involverte innen 14 dager.
- Action items spawn-es som Linear-issues før møtet er over.
- Tobias signerer post-mortem som "lest og forstått".

---

## 8. Drill-anbefaling

### 8.1 Pre-pilot — obligatorisk

Disse drills må kjøres minst én gang før første hall flippes til prod
(samordnet med [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) §12 og
[`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) §9):

- D1 — Backend-krasj-recovery
- D2 — Redis-utfall (se [`REDIS_FAILOVER_PROCEDURE.md`](./REDIS_FAILOVER_PROCEDURE.md))
- D3 — Postgres failover (se [`DATABASE_RESTORE_PROCEDURE.md`](./DATABASE_RESTORE_PROCEDURE.md))
- IR-D1 — Severity-klassifisering-drill (table-top, 30 min — gå gjennom 5 hypotetiske scenarier og klassifiser)
- IR-D2 — Kommunikasjons-drill (15 min — skriv hall-eier-melding for et P2-scenario)

### 8.2 Kvartalsvis

- DDoS-simulering ([`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) S5)
- Hall-internett-kutt-simulering
- Compliance-incident-drill ([`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md))
- Wallet-reconciliation-mismatch-drill ([`WALLET_RECONCILIATION_RUNBOOK.md`](./WALLET_RECONCILIATION_RUNBOOK.md))

### 8.3 Per pilot-deploy

- Rolling restart (S6) — pågående praksis, ingen formell drill nødvendig.

### 8.4 Drill-logg

Alle drills loggføres i `docs/operations/dr-drill-log/<yyyy-mm>-<id>.md`
per malen i [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) §12.2.

---

## 9. Pilot-gating

Før første hall flippes til prod skal følgende være signert:

- [ ] On-call-rotasjonen bemannet og fordelt (L1, L2 backend, L2 payment, L3, compliance-eier)
- [ ] Slack `#bingo-pilot-war-room` opprettet med alle vakter med
- [ ] PagerDuty / SMS-broadcast satt opp for L2/L3
- [ ] Lotteritilsynet-kontaktinfo dokumentert hos compliance-eier
- [ ] D1 + D2 + D3 grønn (per [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) §12.3)
- [ ] IR-D1 + IR-D2 gjennomført (severity + kommunikasjon table-top)
- [ ] Alle 7 runbooks i C4-suiten lest av on-call-rotasjonen

---

## 10. Referanser

### 10.1 Søster-runbooks (samme C4-suite)

- [`DEPLOY_ROLLBACK_PROCEDURE.md`](./DEPLOY_ROLLBACK_PROCEDURE.md) — Render-deploy rollback
- [`HOTFIX_PROCESS.md`](./HOTFIX_PROCESS.md) — kritisk fix uten full review
- [`DATABASE_RESTORE_PROCEDURE.md`](./DATABASE_RESTORE_PROCEDURE.md) — PG snapshot restore
- [`REDIS_FAILOVER_PROCEDURE.md`](./REDIS_FAILOVER_PROCEDURE.md) — Redis utfall
- [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md) — Lotteritilsynet-flow
- [`WALLET_RECONCILIATION_RUNBOOK.md`](./WALLET_RECONCILIATION_RUNBOOK.md) — daglig recon-job

### 10.2 Eksisterende runbooks vi bygger på

- [`LIVE_ROOM_DR_RUNBOOK.md`](./LIVE_ROOM_DR_RUNBOOK.md) — rom-spesifikk recovery
- [`DISASTER_RECOVERY_PLAN_2026-04-25.md`](./DISASTER_RECOVERY_PLAN_2026-04-25.md) — overordnet DR-plan
- [`MIGRATION_DEPLOY_RUNBOOK.md`](./MIGRATION_DEPLOY_RUNBOOK.md) — migrasjons-feilhåndtering
- [`ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md) — hall-rollback til Unity
- [`HALL_PILOT_RUNBOOK.md`](./HALL_PILOT_RUNBOOK.md) — pilot-vakt + severity
- [`PILOT_CUTOVER_RUNBOOK.md`](./PILOT_CUTOVER_RUNBOOK.md) — hall-flip-prosedyre
- [`OBSERVABILITY_RUNBOOK.md`](./OBSERVABILITY_RUNBOOK.md) — alerts og dashboards
- [`STATUS_PAGE.md`](./STATUS_PAGE.md) — public status-side

### 10.3 Arkitektur og policy

- [`docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`](../architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md) — Evolution-grade krav
- [`docs/architecture/SPILL_REGLER_OG_PAYOUT.md`](../architecture/SPILL_REGLER_OG_PAYOUT.md) §9.6 — compliance-felter

---

## 11. Eierskap og sign-off

| Rolle | Ansvar | Sign-off |
|---|---|---|
| Technical lead (Tobias) | Endelig myndighet på severity-matrise og eskalerings-tre | _pending_ |
| L3 incident commander | Eier post-mortem-prosess og kommunikasjon-templates | _pending_ |
| Compliance-eier | Eier Lotteritilsynet-flow (§6.5 + egen runbook) | _pending_ |
| L2 backend on-call | Eier triage-prosedyre og runbook-execution | _pending_ |
| L1 hall-operatør | Eier første-respons-protokoll | _pending_ |

Planen er i kraft når **alle fem signaturer** er registrert (med dato +
Linear-kommentar-link). Pilot kan IKKE starte uten sign-off.

Ved oppdatering av planen — bump "Last updated" øverst, post endring i
`#ops-cutover`, oppdater Linear BIN-790.
