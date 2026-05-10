# Postmortem — <kort beskrivende tittel>

**Dato (incident):** YYYY-MM-DD
**Dato (postmortem skrevet):** YYYY-MM-DD
**Forfatter:** <navn / agent>
**Status:** Open | In progress | Resolved
**Severity:** Critical | High | Medium | Low
**Varighet (incident):** <X timer / Y minutter>
**Kunde-impact:** <antall haller / spillere berørt / penger på linja / "ingen">

---

## TL;DR (3 setninger)

Hva skjedde, hva var rotårsaken, og hva endrer vi for å unngå gjentakelse.
Skriv dette SIST, men plasser det FØRST. Hvis noen bare leser tre setninger,
skal disse tre fortelle hele historien.

---

## 1. Hva skjedde

Kronologi i klartekst, ikke teknisk:

| Tidspunkt (UTC) | Hendelse |
|---|---|
| YYYY-MM-DD HH:MM | Trigger / start (f.eks. deploy, trafikk-spike, vendor-outage) |
| YYYY-MM-DD HH:MM | Første symptom oppdaget (av hvem? alarm? kundeklage?) |
| YYYY-MM-DD HH:MM | Eskalering / hands-on-debugging starter |
| YYYY-MM-DD HH:MM | Rotårsak identifisert |
| YYYY-MM-DD HH:MM | Mitigasjon iverksatt |
| YYYY-MM-DD HH:MM | Verifisert løst |

**Kunde-impact:**
- Hvor mange haller / spillere?
- Hvilke spill / funksjoner var nede?
- Var det datatap, finansiell impact, eller compliance-implikasjon?

---

## 2. Rotårsak (5-Whys)

Stopp ikke ved første "fordi". Grav til du finner system-årsaken.

1. **Hvorfor skjedde X?**
   Fordi …
2. **Hvorfor det?**
   Fordi …
3. **Hvorfor det?**
   Fordi …
4. **Hvorfor det?**
   Fordi …
5. **Hvorfor det? (system-årsak)**
   Fordi …

**Rotårsak (1 setning):**
<klar formulering av system-årsaken>

---

## 3. Hva fungerte godt

Hva hjalp oss å oppdage, eskalere, eller løse raskt? Disse skal vi bevare.

- …

---

## 4. Hva fungerte dårlig

Hvor traff vi friksjon? Manglende monitoring, uklare runbooks, manglende
tilganger, kontekst som måtte bygges fra scratch under tidspress.

- …

---

## 5. Heldige uhell

Var det ting som *kunne* gått galt men ikke gjorde det fordi vi var heldige?
List dem — disse er "near-misses" som krever forebygging selv om de ikke
faktisk traff oss denne gangen.

- …

---

## 6. Action-items (konkrete, med eier og deadline)

| # | Action | Eier | Deadline | Linear-issue | Status |
|---|---|---|---|---|---|
| 1 | <konkret endring i kode/prosess/verktøy> | <navn> | YYYY-MM-DD | BIN-NNN | Open / Done |
| 2 | … | | | | |

**Regel:** Hver action-item må være konkret. "Vi bør være mer forsiktige" er
IKKE en action-item. "Legg til pre-deploy-sjekk for X i ci.yml" ER en
action-item.

---

## 7. Endringer i risiko-bildet

- Materialiserer denne incidenten en risiko fra [`RISKS.md`](../RISKS.md)?
  Hvis ja: hvilken? Oppdater status der.
- Avdekker den en NY risiko vi ikke hadde i RISKS? Legg den til.
- Endrer den vurderingen av en eksisterende risiko (sannsynlighet/konsekvens)?

---

## 8. Endringer i ADR / kanoniske docs

- Krever denne læringen en ny ADR? Hvis ja, lenk til den her.
- Skal en eksisterende ADR `Superseded by`? Hvilken og hvorfor?
- Skal en kanonisk doc oppdateres? List dem.

---

## 9. Compliance-implikasjon (hvis relevant)

(Kun for incidenter som berører pengespillforskriften)

- **§-referanse:** Hvilken paragraf ble (potensielt) berørt
- **Lotteritilsynet-rapportering:** Ja / Nei
  - Hvis Ja: Dato sendt + saksnummer
- **Audit-trail-evidens:** Hash-chain-SHAs som bekrefter / utelukker brudd
- **Følger prosedyre:** [`COMPLIANCE_INCIDENT_PROCEDURE.md`](../operations/COMPLIANCE_INCIDENT_PROCEDURE.md)

---

## 10. Referanser

- **Linear-issue:** BIN-NNN
- **Relaterte PR-er:** #NNN, #NNN
- **Logs / dashboard-screenshots:** <lagre i `docs/postmortems/assets/<dato>/`>
- **Sentry-event-IDs:** …
- **Trace-IDs:** …
- **Relaterte postmortems (samme klasse av feil):** …

---

## 11. Lukket-loop verifisering

Før denne postmortem-en markeres `Resolved`:

- [ ] Alle action-items i §6 er fullført
- [ ] [`RISKS.md`](../RISKS.md) er oppdatert
- [ ] Eventuelle nye ADR-er er skrevet og merget
- [ ] Eventuelle endringer i kanoniske docs er gjennomført
- [ ] Hvis compliance: prosedyre er fulgt, dokumentert
- [ ] Index i [`docs/postmortems/README.md`](./README.md) er oppdatert
- [ ] Eventuell ny skill / oppdatering av eksisterende skill er reflektert

**Resolved-dato:** YYYY-MM-DD
**Verifisert av:** <navn>
