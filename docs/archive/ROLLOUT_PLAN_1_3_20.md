# Rollout Plan 1 -> 3 -> 20 Halls (BG-028)

Dato: 2026-03-04

Formaal: kontrollert utrulling med eksplisitte go/no-go gates per wave.

Avhengigheter:

- `BG-026` compliance-suite maa vaere gronn.
- `BG-027` hall pilot runbook maa vaere tatt i bruk.

## 1. Utrullingsmodell

- `Wave 1`: 1 pilot-hall
- `Wave 2`: utvid til totalt 3 haller
- `Wave 3`: utvid til totalt 20 haller

Hovedregel:

- Ingen wave starter foer forrige wave har passert go/no-go.
- Ved no-go stoppes videre utrulling, og team gaar tilbake til stabilisering.

## 2. Felles Exit-Krav Per Wave

Maa vaere oppfylt foer go:

- Compliance suite (`npm --prefix backend run test:compliance`) er gronn paa release-branch.
- Ingen aapne `SEV-1`.
- Alle `SEV-2` fra wave er lukket eller har godkjent workaround.
- Dagsrapporter (JSON + CSV) genereres uten avvik for alle aktive haller i wave.
- Payout-audit events finnes og hash-kjede er intakt.
- Rollback-prosedyre er testet i ikke-produksjon med samme release.

## 3. Wave 1 (1 Hall)

Varighet: 5-7 dager stabil drift.

Scope:

- 1 valgt pilot-hall med lav/moderat trafikk.
- Begrenset supportvindu med full on-call dekning.

Go/No-Go etter Wave 1:

- `GO` hvis alle punkter under er sanne:
  - 0 compliance-brudd (KYC/limits/pause/exclusion/ticket/interval/prize-cap).
  - 0 feilutbetalinger.
  - Mindre enn 3 `SEV-2` totalt og alle lukket.
  - Dagsrapport stemmer mot ledger for alle pilotdager.
  - Hallleder + Incident Commander + Compliance Owner signerer.
- `NO-GO` hvis ett punkt under inntreffer:
  - Minst ett dokumentert compliance-brudd.
  - Uforklart mismatch mellom payout-audit og ledger.
  - Ustabil drift med gjentagende driftsstans > 10 min.

No-Go handling:

1. Stopp videre utrulling.
2. Behold drift kun i pilot-hall eller rollback iht. runbook.
3. Aarsaksanalyse + korrigering + ny 48t stabilitetsperiode foer ny vurdering.

## 4. Wave 2 (3 Haller)

Varighet: 7-10 dager stabil drift.

Scope:

- Legg til 2 nye haller (totalt 3).
- Minst 1 hall med hoyere trafikk enn pilot-hall.

Go/No-Go etter Wave 2:

- `GO` hvis alle punkter under er sanne:
  - Samme compliance-krav som Wave 1 er oppfylt i alle 3 haller.
  - Ingen tverr-hall blending i rapporter (`hall/game/channel` separasjon verifisert).
  - Overskudd-distribusjonsbatch er kjorbar og reproduserbar paa data fra wave.
  - Driftsteam viser at incident-respons fungerer innenfor runbook-responstider.
- `NO-GO` hvis ett punkt under inntreffer:
  - Kritisk driftssvikt i mer enn 1 hall samtidig.
  - Gjentagende rapport-/ledger-avvik over 2 dager.
  - Manglende kontroll paa payout-audit i en av hallene.

No-Go handling:

1. Frys onboarding av nye haller.
2. Fortsett kun i stabile haller etter beslutning fra Incident Commander.
3. Prioriter feilretting + ny wave-vurdering etter 72t stabilitet.

## 5. Wave 3 (20 Haller)

Varighet: trinnvis onboarding i batcher (anbefalt 3-5 haller per batch).

Scope:

- Onboard resterende 17 haller etter batchplan.
- Ingen batch startes uten grønn verifisering fra forrige batch.

Go/No-Go per batch i Wave 3:

- `GO` hvis:
  - Ingen nye compliance-feil i batchvinduet.
  - Daily report og payout-audit er komplette for alle batch-haller.
  - Supportbelastning er innenfor avtalt kapasitet.
- `NO-GO` hvis:
  - Samme feiltype oppstaar i >=2 nye haller.
  - Kritisk feil ikke lar seg mitigere med workaround innen 30 min.

No-Go handling:

1. Stopp neste batch umiddelbart.
2. Fortsett drift i allerede stabile haller.
3. Utfør hotfix-plan + verifiser i en kontrollhall foer batch gjenopptas.

## 6. Operasjonell Kjorerytme

Per wave/batch:

1. `T-24h`: preflight fra `HALL_PILOT_RUNBOOK.md`
2. `T-2h`: release-ready sjekk (CI, config, contact chain)
3. `T0`: aktiver hall(er)
4. `T+1h`: status checkpoint
5. `T+24h`: første go/no-go status
6. `T+slutt wave`: formell go/no-go sign-off

## 7. Beslutningsmatrise

Hvem kan beslutte:

- `GO`: Incident Commander + Compliance Owner + Produktansvarlig
- `NO-GO`: Incident Commander alene ved `SEV-1`, ellers samme trio
- `Rollback`: Incident Commander (med umiddelbar varsling til Compliance Owner)

## 8. Evidenspakke Per Wave

Skal arkiveres foer neste wave:

- CI-resultat (`check`, `build`, `test:compliance`)
- Utdrag fra payout-audit
- Utdrag fra ledger (`hall/game/channel`)
- Daily report JSON + CSV
- Incident-logg med tidslinje og tiltak
- Sign-off dokument med go/no-go-beslutning

