# Hall Pilot Runbook (BG-027)

Formaal: standardisere pilotdrift i hall med tydelig preflight, rollback og support-eskalering.

## 1. Scope

Gjelder kontrollert pilot for ny Bingo-plattform i fysisk hall.

Inkludert:

- Preflight-checkliste for teknisk/compliance/go-live.
- Kjoring av pilotvakt under live drift.
- Rollback-kriterier og steg tilbake til gammel losning.
- Support contact chain med tydelig eskalering.

Ekskludert:

- Full utrulling til flere haller (dekkes i `BG-028`).

## 2. Roller Og Kontaktkjede

Fyll inn med faktiske navn/telefonnummer i forkant av pilot.

| Rolle | Ansvar | Primar | Sekundar | Responstid |
| --- | --- | --- | --- | --- |
| `L1 Hall Operator` | Lokal drift, terminal, brukerhjelp | `<navn/telefon>` | `<navn/telefon>` | 0-5 min |
| `L2 Backend On-Call` | API/socket/wallet/payout | `<navn/telefon>` | `<navn/telefon>` | 5-10 min |
| `L2 Payment On-Call` | Swedbank/topup-avvik | `<navn/telefon>` | `<navn/telefon>` | 5-10 min |
| `L3 Incident Commander` | Beslutning om rollback/go-no-go | `<navn/telefon>` | `<navn/telefon>` | 0-5 min |
| `Compliance Owner` | Regelverksavklaring og myndighetslogg | `<navn/telefon>` | `<navn/telefon>` | 15 min |

Eskalering:

1. Hall melder avvik til `L1`.
2. `L1` eskalerer til riktig `L2` innen 5 min ved tjenestefeil.
3. `L2` eskalerer til `L3 Incident Commander` ved kritisk feil.
4. `L3` tar rollback-beslutning etter kriteriene i seksjon 6.

## 3. Preflight Checklist (Maa Vaere Gronn)

Kjores siste 24 timer og paa nytt 60 min foer pilotstart.

### 3.1 Release Og Endringskontroll

- [ ] Scope er frosset til `P0` (ingen nye features).
- [ ] Branch/tag for pilot-release er opprettet og dokumentert.
- [ ] Endringslogg med commit hash er publisert internt.
- [ ] `BG-026` compliance suite er gronn i CI.

### 3.2 Infrastruktur Og Konfig

- [ ] Produksjonsnoder er oppe og health-check er gronn (`GET /health`).
- [ ] Postgres-tilkobling verifisert for wallet + plattform.
- [ ] Korrekte env for compliance er satt:
  - `BINGO_MIN_ROUND_INTERVAL_MS>=30000`
  - `BINGO_DAILY_LOSS_LIMIT=900`
  - `BINGO_MONTHLY_LOSS_LIMIT=4400`
  - `BINGO_PLAY_SESSION_LIMIT_MS=3600000`
  - `BINGO_PAUSE_DURATION_MS=300000`
  - `BINGO_SELF_EXCLUSION_MIN_MS>=31536000000`
  - `BINGO_PAYOUT_PERCENT` verifisert mot godkjent RTP (0-100)
- [ ] `NODE_ENV=production` bekreftet, og policy for produksjon er eksplisitt satt:
  - `BINGO_ALLOW_AUTOPLAY_IN_PRODUCTION` (true/false iht. tillatelse)

### 3.3 Data Og Halloppsett

- [ ] Pilot-hall finnes og er `active`.
- [ ] Nodvendige terminaler er opprettet og `active`.
- [ ] Hall game config for `bingo` er satt korrekt (enabled/ticket cap/interval).
- [ ] Pilot-testbrukere/wallets er opprettet for dry-run.
- [ ] House-kontoer har finansiering for premier og overskuddsflyt.

### 3.4 Compliance Og Regler (Smoke)

- [ ] KYC gate blokkering verifisert for uverifisert bruker.
- [ ] Tapsgrense-blokkering verifisert med testwallet.
- [ ] Timed pause + self-exclusion blokkering verifisert.
- [ ] 30 sek interval gate verifisert mellom spillstarter.
- [ ] Ticket cap verifisert (global og hall-spesifikk).
- [ ] Extra draw purchase blir avvist og audit-logget.
- [ ] Prize cap verifisert med capped payout.

### 3.5 Operasjonell Beredskap

- [ ] Vaktliste for hele pilotvinduet er bekreftet.
- [ ] Incident channel er opprettet (`#bingo-pilot-war-room` e.l.).
- [ ] Rollback-ansvarlig og beslutningsmyndighet er navngitt.
- [ ] Kontaktkjede (seksjon 2) er distribuert til hall.

## 4. Pilot Kjoring (Live)

### 4.1 Tidslinje

1. `T-60 min`: preflight-kryssjekk, freeze bekreftes.
2. `T-30 min`: smoke test i hall, topup + join/start/claim.
3. `T-10 min`: final go/no-go av `Incident Commander`.
4. `T0`: pilot aapnes for brukere.
5. `T+15/T+30/T+60`: faste status-checkpoints i incident channel.

### 4.2 Overvakning Under Pilot

Minst hvert 15. minutt:

- Health endpoint
- Feilrate i logs
- Payout-audit hendelser
- Ledger entries pr hall/game/channel
- Daily report dry-run for dagens dato

Anbefalte admin-endepunkter:

- `GET /api/admin/payout-audit`
- `GET /api/admin/ledger/entries`
- `GET /api/admin/compliance/extra-draw-denials`
- `GET /api/admin/reports/daily?date=YYYY-MM-DD`

## 5. Hendelseshandtering

Severity-definisjon:

- `SEV-1`: feil i compliance/payout/tapsgater, datatap eller sikkerhetsbrudd.
- `SEV-2`: stor funksjonsfeil uten direkte compliance-brudd.
- `SEV-3`: mindre avvik med workaround.

Regel:

- `SEV-1` => umiddelbar vurdering av rollback.
- `SEV-2` > 15 min uten stabil workaround => vurder rollback.

## 6. Rollback Kriterier

Rollback trigges dersom minst ett punkt inntreffer:

- Compliance-kontroll kan omgaas eller feiler systematisk.
- Payout beregnes feil eller mangler audit-trail.
- Kritisk datainkonsistens i ledger/report.
- Platform utilgjengelig > 10 min i pilotvindu.
- Incident Commander klassifiserer som `SEV-1`.

## 7. Rollback Steg

### 7.1 Soft Rollback (stans ny aktivitet)

1. Stans ny spilleraktivitet i hall (driftsmelding).
2. Avslutt aktive runder kontrollert.
3. Deaktiver pilot-hall for bingo i hall game config.
4. Verifiser at nye join/start blir blokkert.
5. Kommuniser status til hall + supportkjede.

### 7.2 Full Rollback (til gammel losning)

1. Incident Commander beslutter full rollback.
2. Aktiver gammel losning i hall etter lokal prosedyre.
3. Verifiser gammel losning med funksjonstest i hall.
4. Sett ny plattform i readonly/maintenance for pilot-hall.
5. Ta ut bevispakke:
   - payout-audit utdrag
   - ledger utdrag
   - feillogg tidslinje
   - rapportutdrag
6. Opprett postmortem og korrigerende tiltak foer ny pilot.

## 8. Pilot Sign-Off

Ma fylles ut ved pilotslutt:

- [ ] Ingen uloste `SEV-1`/`SEV-2`.
- [ ] Compliance suite fortsatt gronn paa release-branch.
- [ ] Daily report (CSV + JSON) generert og validert.
- [ ] Payout-audit kontrollert for pilotperioden.
- [ ] Overskuddsflyt testet (dersom i scope for piloten).
- [ ] Hallleder + Incident Commander sign-off.

Signaturer:

- Hallleder: `<navn/dato>`
- Incident Commander: `<navn/dato>`
- Compliance Owner: `<navn/dato>`
