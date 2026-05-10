# Postmortems — Spillorama-system

**Sist oppdatert:** 2026-05-10
**Eier:** Tobias Haugen
**Formål:** Sentral katalog over incidenter som har skjedd, hva vi lærte, og
hvilke konkrete tiltak som ble gjennomført.

> **Til ny PM:** Dette er det viktigste dokumentet for å unngå å gå i samme
> fellen igjen. Når noe går skeis — selv smått — skriv et postmortem her.
> Ingen finger-pekng; fokus på system og prosess. Et postmortem som er
> "fordi Tobias glemte å sjekke X" er feil; korrekt er "fordi vi ikke hadde
> et automatisk varsel for X".

---

## Når skal du skrive et postmortem

**ALLTID** ved:
- Prod-incident med kunde-impact (uansett varighet)
- Compliance-brudd (selv om det ikke ble rapportert utad)
- Wallet-/payout-feil (uansett størrelse)
- Sikkerhets-incident eller -mistanke
- Data-tap eller -korrupsjon
- Pilot-blokker som tok >2 dager å løse uten at årsaken var åpenbar fra start
- Risiko fra [`RISKS.md`](../RISKS.md) som materialiserer seg

**KAN HOPPE OVER** kun ved:
- Kjente bug-fikser uten kunde-impact (BIN-issue + commit er nok)
- Routine-ops uten overraskelser

Når du er i tvil — skriv. Bedre å ha for mange enn for få.

---

## Hvordan skrive et postmortem

1. **Innen 48 timer** etter incidenten er løst, opprett ny fil:
   ```
   docs/postmortems/YYYY-MM-DD-<kort-kebab-navn>.md
   ```
   Eksempel: `docs/postmortems/2026-05-15-wallet-double-payout.md`

2. **Kopier malen** fra [`_TEMPLATE.md`](./_TEMPLATE.md) og fyll inn alle seksjoner.

3. **Bruk 5-Whys** i root-cause-analysen. Stopp ikke ved første "fordi" — grav
   til du finner system-årsaken.

4. **Definer konkrete action-items** med eier og deadline. Vagt
   "vi bør være mer forsiktige" gir null verdi. Bra: "PR-template skal
   ha checkbox for X" + eier + dato.

5. **Oppdater denne katalogen** (seksjonen "Index" under) ved å legge til ny
   rad.

6. **Oppdater [`RISKS.md`](../RISKS.md)** hvis postmortemet avdekker en
   ny risiko, eller hvis det materialiserer en eksisterende risiko.

7. **Lukk loopen:** når alle action-items er gjennomført, marker postmortemet
   som "Resolved" øverst.

---

## Anti-mønstre

❌ "Det skjedde fordi <person> gjorde <feil>" — feil ramme. Hva sviktet i
prosessen som lot dette skje?

❌ "Vi må være mer oppmerksomme" — ikke en action-item. Hva *konkret* endrer
vi i koden, prosessen, eller verktøyene?

❌ Postmortem skrevet uten å snakke med de involverte — gir feil bilde.

❌ Postmortem skrevet 3 uker etter incidenten — minne har forfalt, fakta er
feil. Innen 48 timer.

❌ Postmortem som lukkes uten at action-items er gjennomført — fjerner
verdien av hele øvelsen.

---

## Index — alle postmortems kronologisk

| Dato | Tittel | Severity | Status | Tema |
|---|---|---|---|---|
| _(ingen postmortems registrert ennå)_ | | | | |

<!--
Når du legger til en ny rad:

| 2026-05-15 | [Wallet double-payout race](./2026-05-15-wallet-double-payout.md) | High | Resolved | Wallet, race-condition |
| 2026-06-01 | [Spill 2 24t-leak](./2026-06-01-spill2-24t-leak.md) | Critical | In progress | Memory leak, perpetual loop |

Severity:
- Critical: kunde-impact, compliance-brudd, eller penger på linja
- High: prod-feil uten umiddelbart kunde-impact
- Medium: staging/dev-incident med læring
- Low: nær-feil, "kunne gått galt"

Status: Open / In progress / Resolved (alle action-items gjennomført)
-->

---

## Kategori-statistikk (for kvartalsvis review)

Når du har 5+ postmortems, gjør en kvartalsvis statistikk:

- Hvor mange per kategori (wallet / draw / auth / deploy / compliance / vendor)?
- Snitt tid fra deteksjon til løsning?
- Hvilke kategorier dominerer? Det er der prosess-investering har høyest ROI.

Logg statistikk øverst i [`RISKS.md`](../RISKS.md) som kommentar.

---

## Compliance-incidenter — spesielt

Postmortems for compliance-brudd følger spesialprosedyre i
[`docs/operations/COMPLIANCE_INCIDENT_PROCEDURE.md`](../operations/COMPLIANCE_INCIDENT_PROCEDURE.md)
inkludert eventuell Lotteritilsynet-rapportering.

Compliance-postmortems lagres her med samme mal, men med tillegg av:
- Lotteritilsynet-rapportering: ja/nei + dato hvis ja
- §-referanse: hvilken paragraf av pengespillforskriften ble berørt
- Audit-trail-evidens: SHA av relevante hash-chain-events

---

**Se også:**
- [`_TEMPLATE.md`](./_TEMPLATE.md) — bruk denne malen
- [`docs/RISKS.md`](../RISKS.md) — risikoer som ennå ikke har materialisert seg
- [`docs/operations/INCIDENT_RESPONSE_PLAN.md`](../operations/INCIDENT_RESPONSE_PLAN.md) — hva du gjør UNDER en incident
- [`docs/operations/COMPLIANCE_INCIDENT_PROCEDURE.md`](../operations/COMPLIANCE_INCIDENT_PROCEDURE.md) — compliance-spesifikk prosedyre
- [`docs/SESSION_HANDOFF_PROTOCOL.md`](../SESSION_HANDOFF_PROTOCOL.md) — hvordan handoff håndteres ellers
