# External Communications Log

**Sist oppdatert:** 2026-05-10
**Eier:** Tobias Haugen
**Status:** Aktiv (levende dokument)

> **Til ny PM:** Når Tobias har snakket med eksterne (Lotteritilsynet, vendors,
> hall-operatører, Candy-team), står oppsummeringen her. **Ikke transkript** —
> bare 2-3 setninger per kommunikasjon med fokus på beslutning + oppfølging.
>
> Når neste PM trenger å forstå "hva sa <vendor/regulator> om <tema>?" —
> grep her først, deretter spør Tobias hvis ikke funnet.

---

## Hvorfor

Tidligere har eksterne kommunikasjon levd kun i Tobias' innboks/hode/telefon:

- "Hva sa Lotteritilsynet om §11-tolkningen i januar?"
- "Hva avtalte vi med Swedbank Pay om transaksjons-fee?"
- "Hva sa BankID-vendoren om GDPR-krav?"
- "Hva mente Teknobingo Årnes om master-flyten?"

Uten log må neste PM enten gjette eller spørre Tobias hver gang. Dette
dokumentet løser det.

---

## Hva logges

**Logg når Tobias har:**

- Snakket med Lotteritilsynet (uansett kanal: e-post, telefon, møte)
- Snakket med en vendor (Swedbank Pay, BankID, Render, etc.) om noe utover bestilling/fakturering
- Hatt møte med pilot-hall-operatør (master-rolle, opplæring, tilbakemelding)
- Mottatt regulatorisk varsel eller kontroll
- Avtalt noe med Candy-team som påvirker integrasjon

**IKKE logg:**

- Rutine-kontakt (faktura, automatiske vendor-meldinger)
- Internt-team-snakk (bruk PM-handoffs eller decisions-log)
- Kunde-support-saker (skal ha eget system)

---

## Format

Per oppføring:

```markdown
### YYYY-MM-DD | <Kanal> | Med: <Person/Org> | Tema: <Kort>

**Hva:** <2-3 setninger om hva som ble snakket om>
**Beslutning:** <hva ble besluttet — om noe>
**Oppfølging:** <hva må gjøres + når + hvem>
**Vedlegg:** <referanser til e-post-arkiv, møtenotater, etc. — om aktuelt>
```

**Kanal-koder:** `e-post`, `telefon`, `møte` (fysisk), `video` (Zoom/Teams), `brev`, `SMS`

---

## Sikkerhet

- ❌ ALDRI lim inn hele e-post-tråder eller PII (personnumre, kontaktdetaljer utover navn+rolle)
- ❌ ALDRI lim inn vendor-credentials eller priser som er under NDA
- ✅ Beslutninger og fakta — ja
- ✅ "E-post sendt YYYY-MM-DD, lagret i Gmail-label `spillorama-canonical`" — ja, henvis bare

For sensitive spesifikasjoner (kontrakts-vilkår, priser): henvis til
[`docs/operations/VENDORS.md`](./VENDORS.md) eller Tobias' password manager.

---

## Loggen

**Sortert nyeste først.**

<!--
  Mal — kopier ved ny oppføring:

### YYYY-MM-DD | <Kanal> | Med: <Person/Org> | Tema: <Kort>

**Hva:** <2-3 setninger>
**Beslutning:** <om noe>
**Oppfølging:** <action-item, eier, deadline>
**Vedlegg:** <e-post-ref / møtenotater>

---
-->

_(Tom log — første oppføring kommer når Tobias har første eksterne kommunikasjon å logge)_

---

## Kvartalsvis review

Hvert kvartal: gå gjennom de tre siste månedene og:
- Identifiser tilbakevendende temaer (fortjener kanskje en ADR?)
- Verifiser at alle "Oppfølging"-action-items er fullført
- Vurder om noen vendor/stakeholder bør promoteres til egen seksjon

---

**Se også:**
- [`STAKEHOLDERS.md`](./STAKEHOLDERS.md) — hvem som er involvert
- [`VENDORS.md`](./VENDORS.md) — kontrakts-detaljer per vendor
- [`COMPLIANCE_INCIDENT_PROCEDURE.md`](./COMPLIANCE_INCIDENT_PROCEDURE.md) — Lotteritilsynet-prosedyre
- [`docs/decisions-log/`](../decisions-log/) — interne Tobias-beslutninger
- [`docs/postmortems/`](../postmortems/) — incidenter
