# Session Handoff Protocol

**Sist oppdatert:** 2026-05-06
**Eier:** Tobias Haugen
**Formål:** Sikre at hver utviklings-/PM-sesjon ender med oppdatert dokumentasjon, slik at neste sesjon
starter med full kontekst.

---

## Hvorfor

Spillorama drives med AI-agenter (Claude Code) som ikke har kontekst mellom sesjoner. Hver ny sesjon
må re-bygge forståelse av:
- Hva ble levert sist?
- Hva er åpne pilot-blokkere?
- Hvilke arkitektoniske beslutninger ble tatt?
- Hvilke filer ble endret og hvorfor?

Uten formell handoff-prosess taper vi 30-60 minutter per sesjon på re-orientering. Med formell prosess
kommer vi i gang innen 5 minutter.

---

## Når skal man skrive handoff?

**ALLTID** ved sesjons-slutt hvis:
- Du har merget eller pushet kode
- Du har fattet en arkitektonisk beslutning (skriv ADR i tillegg)
- Du har oppdaget en bug som krever ny arbeid
- Du har endret status på en pilot-blokker
- Sesjonen varte >2 timer

**KAN HOPPE OVER** kun hvis:
- Sesjonen var <30 minutter og ingenting konkret ble levert
- Du gjorde kun research uten kode-endringer (legg notater i ADR i stedet)

---

## Handoff-mal

Lagre som `docs/operations/PM_HANDOFF_YYYY-MM-DD[_sessionN].md` (sessionN hvis flere samme dag).

```markdown
# PM-handoff YYYY-MM-DD — <Tema>

**Forrige PM:** Claude (Opus X.Y, kontekst-størrelse)
**Sesjon-fokus:** 1-2 setninger om hva sesjonen jobbet med
**Status ved overlevering:** Hovedkonklusjon (ferdig / delvis / blokkert)

---

## 1. TL;DR — status nå

- Bullet-liste av key facts
- Hva fungerer på prod?
- Hva er åpent?

## 2. Alle PR-er fra denne sesjonen (kronologisk)

| PR | Tema | Effekt | Status |
|---|---|---|---|
| [#NNN](https://...) | ... | ... | Merget / Open / Closed |

## 3. Endringer i arkitektur eller design

- Eventuelle ADR-er som ble skrevet
- Endringer i `docs/SYSTEM_DESIGN_PRINCIPLES.md`
- Nye eller endrete invariants

## 4. Pilot-readiness sjekkliste

(Hvis pilot-relevant)
- [ ] Hva er testet på prod
- [ ] Hva mangler for full pilot

## 5. Åpne funn for neste sesjon

Liste av konkrete neste steg, prioritert.

## 6. Hvor er vi i pilot?

Status mot 24-hall-pilot 2026-05.

## 7. Tekniske notater

Eventuelle subtile detaljer som neste PM må vite (oppdagelser om legacy-kode,
gotchas, etc.)

## 8. Referanser

- Lenker til ADR-er, audit-rapporter, PR-er
```

---

## Hva må inkluderes (sjekkliste)

Hver handoff MÅ ha:

- [ ] **Sesjons-fokus** (1-2 setninger)
- [ ] **Status-konklusjon** (ferdig / delvis / blokkert)
- [ ] **PR-liste** med commit-SHA eller PR-nummer
- [ ] **Åpne funn for neste sesjon** (prioritert)
- [ ] **Pilot-status** (hvis pilot-relevant)
- [ ] **Filendringer-summary** (hvilke moduler ble berørt)

Hver handoff BØR ha:

- [ ] Test-status (hva ble verifisert, hva er ikke testet)
- [ ] Linker til ADR-er hvis arkitekturbeslutninger ble tatt
- [ ] Referanser til relaterte handoffs

---

## Hvordan oppdatere ADR-er

Når en arkitektonisk beslutning fattes i sesjonen:

1. Skriv ADR i `docs/decisions/ADR-NNNN-<title>.md`
2. Legg til linje i `docs/decisions/README.md` ADR-katalog
3. Refererer ADR fra handoff-doc
4. Hvis beslutningen overstyrer en tidligere ADR, marker gammel som `Superseded by: ADR-NNNN`

ADR-numrene allokeres sekvensielt. Sjekk siste nummer i `docs/decisions/README.md` før du skriver ny.

---

## Hvordan oppdatere BACKLOG.md

Når en pilot-blokker endrer status:

1. Åpne `BACKLOG.md`
2. Flytt item mellom seksjoner (åpen / pågående / ferdig)
3. Oppdater "Sist oppdatert"-dato
4. Hvis ny pilot-blokker oppdaget, legg til i "Åpne pilot-blokkere"

---

## Hvordan validere at docs er à jour ved hver PR

PR-template (`.github/pull_request_template.md`) har sjekkliste for docs:

- [ ] Hvis arkitektonisk beslutning: ADR skrevet
- [ ] Hvis ny modul: README.md i modul-mappe
- [ ] Hvis endrer eksisterende invariant: oppdatert relevant doc
- [ ] Hvis endrer API-shape: oppdatert `apps/backend/openapi.yaml`

PM verifiserer dette ved review.

---

## Eksempel: god handoff

[`docs/operations/PM_HANDOFF_2026-05-05_spill2-3-pilot-ready.md`](./operations/PM_HANDOFF_2026-05-05_spill2-3-pilot-ready.md)
er en eksemplarisk handoff:
- Klar TL;DR
- 15 PR-er listet med effekt og status
- Spec-paritet-tabell
- Pilot-readiness sjekkliste
- Åpne funn for neste sesjon
- Tekniske notater om subtile detaljer

Bruk denne som mal.

---

## Anti-mønstre å unngå

❌ "Jeg gjorde noen fixes i dag" — uten konkretisering
❌ Push uten commit-SHA i handoff
❌ Lukke pilot-blokkere uten oppdatering i BACKLOG.md
❌ Ny ADR uten å legge inn i README-katalog
❌ "Se Linear for detaljer" — hvis Linear er nede mister neste PM kontekst

✅ Konkrete commit-SHAs eller PR-numre
✅ Eksplisitt åpen-til-neste-sesjon-liste
✅ Linker til endrede filer med file:line hvor relevant
✅ Status-emojier kun hvis Tobias eksplisitt ber om det (vi unngår emoji)

---

## Referanser

- ADR-008 (PM-sentralisert git-flyt)
- ADR-009 (Done-policy for legacy-avkobling)
- `docs/operations/PM_HANDOFF_*.md` (historiske eksempler)
