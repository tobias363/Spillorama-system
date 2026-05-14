# PM Session Knowledge Export — TEMPLATE

**Status:** Autoritativ mal for hvert PM-sesjons-slutt.
**Etablert:** 2026-05-14 (Tobias-direktiv IMMUTABLE).
**Eier:** Hver PM skriver én av disse ved sesjons-slutt.

---

## Hvorfor denne malen eksisterer

Tobias-direktiv 2026-05-14:

> "Tenk på hvordan vi kan forsikre oss om at neste PM tilegner seg alt av informasjon du har tilegnet deg. Hver ny PM tar over med samme kunnskapsnivå som den som avslutter."

PM_HANDOFF-filer fanger BESLUTNINGER. Skills fanger FAGKUNNSKAP. PITFALLS fanger FALLGRUVER. Denne malen fanger den **TACIT KNOWLEDGE** PM bygger opp under sesjonen: mental models, Tobias-kommunikasjons-mønstre, agent-orkestrerings-erfaringer, live-data-funn, anti-mønstre du selv oppdaget.

---

## Hvordan bruke malen

### Ved sesjons-SLUTT (mandatory)
Hver PM SKAL kopiere denne malen til `docs/operations/PM_SESSION_KNOWLEDGE_EXPORT_<YYYY-MM-DD>.md` og fylle inn alle 7 seksjoner. Skriv mens konteksten er fersk — IKKE vent til neste dag.

### Ved sesjons-START (ny PM)
Som del av vanntett doc-absorpsjon-gate (under-impl per Tobias-direktiv 2026-05-14), MÅ ny PM lese ALLE `PM_SESSION_KNOWLEDGE_EXPORT_*.md`-filer siden 2026-04-23 (eldste først), med per-fil-bekreftelse + 2-3 setning takeaway.

---

## Template — kopier alt under denne linjen

```markdown
# PM Session Knowledge Export — YYYY-MM-DD

**PM:** [navn + AI-model + tids-vindu, eks "Claude Opus 4.7 (Cowork 2026-05-14 14:00-18:00)"]
**Forrige PM:** [hvem leverte handoff til deg]
**Sesjons-varighet:** [~X timer aktiv]
**Tobias-direktiv som rammet sesjonen:**
1. [Direktiv 1 fra handoff]
2. [Direktiv 2 hvis kommet underveis]
...

---

## 1. Sesjons-mandat (hva ble jeg bedt om å gjøre)

[Konkret beskrivelse av oppdraget. Bruk Tobias' egne ord der mulig.]

[Nye direktiver underveis hvis Tobias utvidet scope — chronologisk.]

---

## 2. Kunnskap jeg tilegnet meg (utover bare lesing)

### 2.1 Mental models om Spillorama
[A, B, C, ... — hver med 1-3 setn. — modeller du bygget om systemet]

### 2.2 Tobias' kommunikasjons-signaler (live observerte)
[Tabell med signal + tolkning + riktig respons]

### 2.3 Praktiske agent-orkestrerings-lærdommer
[Hva fungerte / feilet i agent-spawn denne sesjonen]

### 2.4 Arkitektur/Spill-spesifikk innsikt
[Hvis sesjonen jobbet med spesifikt spill eller arkitektur — hvilke ikke-åpenbare ting lærte du]

### 2.5 Live data jeg samlet inn under sesjonen

**Sentry-funn:**
- [Issue-ID + events + tid + culprit + relevans for ditt arbeid]

**PostHog observations:**
- [Funnel/event-mønstre eller session-recording-funn]

**Postgres-snapshots av interesse:**
- [Spesifikke DB-state-eksempler du oppdaget — verdifulle for reproducer av bugs]

**Backend-log-mønstre:**
- [Mønstre i logger som indikerer noe spesielt]

---

## 3. Konkrete handlinger jeg gjorde

### Filer LEST direkte denne sesjonen
- [Komplett liste — slik at neste PM ser hva du faktisk har dypt-lest vs skummet]

### Filer SKREVET
- [Doc-er, scripts, skills, ADRs du laget eller endret]

### PR-er åpnet + merget
- [PR # + tittel + merget når]

### Agenter spawnet
| Agent | Type | Scope | Leveranse |
|---|---|---|---|

---

## 4. Anti-mønstre jeg oppdaget under sesjonen (slik at neste PM ikke gjentar)

### 4.X "Kort tittel på anti-mønsteret"
**Hva jeg gjorde feil:** [...]
**Fix:** [...]

[Gjenta for hver]

---

## 5. Open questions ved sesjons-slutt

1. [Spørsmål 1 — har det fullført leveranse? Hvilken handling trengs?]
2. ...

---

## 6. Mental hand-off — "hvis jeg var ny PM nå, hva må jeg vite?"

1-10 bullets med konsentrert kunnskap. **Dette er kjernen.** Ny PM leser disse 10 først og kan starte effektivt.

1. [Viktigste umiddelbare fakta]
2. [Hvem har levert hva]
3. [Hvor stack-er]
4. [Hvor monitorerer er]
5. [Hvilke Sentry-issues som er pågående]
6. ...

---

## 7. Endringslogg

| Tid (UTC) | Hendelse |
|---|---|
| ~HH:MM | Sesjons-start. |
| ~HH:MM | [Viktig milestone] |
| ... | |
| ~HH:MM | Denne KNOWLEDGE_EXPORT skrevet. |

---

**Til nestemann:** [1-2 setn. avslutnings-melding. Hva er stemningen, hva trenger neste PM å være forberedt på.]
```

---

## Sjekkliste FØR du commiter session-export

- [ ] §1 mandate er presis (Tobias' egne ord der mulig)
- [ ] §2 inkluderer minst 3 mental models og 5 Tobias-signaler
- [ ] §2.5 har faktiske data-snapshots (ikke vague "vi sjekket")
- [ ] §3 lister ALLE filer du leste direkte (ikke bare hoved-skummet)
- [ ] §4 har minst 1 anti-mønster du selv oppdaget
- [ ] §6 har 10 bullets — "neste PM må vite"
- [ ] Lagre som `PM_SESSION_KNOWLEDGE_EXPORT_<YYYY-MM-DD>.md` (eller `_<dato>_session<N>.md` hvis flere på samme dato)

---

## Eksempler

Første session-export laget 2026-05-14 — se `PM_SESSION_KNOWLEDGE_EXPORT_2026-05-14.md` for konkret eksempel.

---

## Når absorption-gate blir levert

`scripts/pm-doc-absorption-gate.sh` (under-impl) vil automatisk:
1. Liste ALLE `PM_SESSION_KNOWLEDGE_EXPORT_*.md`-filer siden 2026-04-23
2. Kreve per-fil ja/nei + 2-3 setning takeaway
3. Hash takeaways i confirmation-fil

Det er den HARDE håndhevelsen av at sesjons-kunnskap leses.
