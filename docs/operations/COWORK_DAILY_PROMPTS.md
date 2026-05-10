# Cowork Daily Prompts — slik bruker PM Cowork dag-til-dag

**Sist oppdatert:** 2026-05-10
**Eier:** Tobias Haugen
**Formål:** Konkrete prompt-mønstre PM kan bruke i Cowork for at info-flyten skal være vanntett.

> **Til ny PM:** Disse prompt-ene er ikke obligatoriske, men hvis du
> bruker dem konsekvent vil neste PM ha en helt annen kontekst enn det
> tidligere har vært tilfellet. Mønsteret tar 30 sekunder per beslutning
> og sparer timer over uker.

---

## Prompt-bibliotek

### 1. Logge en Tobias-beslutning (decisions-log)

Når Tobias svarer på et "skal vi X eller Y?"-spørsmål, eller endrer en
tilnærming midt i en sesjon:

> **Prompt:**
> "Logg denne beslutningen i decisions-log: Tobias bestemte at vi <X>
> fordi <Y>. Kontekst: <BIN-NNN/PR-#NNNN/sesjon-tema>. Handling: <hva
> som skal skje videre>."

Claude vil åpne `docs/decisions-log/YYYY-MM.md` og legge til oppføringen
øverst i månedens fil. Dette er én av de enkleste tingene du kan gjøre
for å unngå "vi har jo bestemt det"-spørsmål senere.

### 2. Logge ekstern kommunikasjon (EXTERNAL_COMMS_LOG)

Når Tobias forteller at han har snakket med Lotteritilsynet, en vendor,
eller en pilot-hall:

> **Prompt:**
> "Logg denne eksterne kommunikasjonen i EXTERNAL_COMMS_LOG: <kanal>
> med <person/org>. Tema: <kort>. Hva ble snakket: <2-3 setn>.
> Beslutning: <om noe>. Oppfølging: <action-items>."

Claude åpner `docs/operations/EXTERNAL_COMMS_LOG.md` og legger til
oppføringen øverst.

### 3. Intent-restate før kode-arbeid

Når Tobias gir deg eller en agent en ikke-triviell oppgave:

> **Prompt (PM til seg selv eller agenten):**
> "Bruk intent-verification-skill. Skriv en restate-blokk for denne
> oppgaven: '<oppgave-tekst>'. Vent på OK før du starter."

Claude/agenten produserer 3-setninger restate. Du leser, gir OK eller
korrigerer. Mønsteret er dokumentert i
[`.claude/skills/intent-verification/SKILL.md`](../../.claude/skills/intent-verification/SKILL.md).

### 4. Sjekke om noe er besluttet før

Når du er usikker på om Tobias har sagt noe om temaet før:

> **Prompt:**
> "Søk decisions-log + ADR + handoffs etter '<søkeord>' og rapporter
> hva som er besluttet om dette."

Claude grep-er gjennom `docs/decisions-log/`, `docs/adr/`,
`docs/operations/PM_HANDOFF_*.md` og oppsummerer.

### 5. Sjekke ekstern komm-historikk

Før du sender e-post til en vendor/regulator:

> **Prompt:**
> "Sjekk EXTERNAL_COMMS_LOG for tidligere kontakt med <vendor/regulator>
> om <tema>. Gi meg sammendrag av siste 3 oppføringer."

### 6. Generere PR-beskrivelse med gate-marker

Når du skal åpne en PR og trenger å huske gate-marker:

> **Prompt:**
> "Generer PR-beskrivelse for denne branchen. Inkluder gate-confirmed-linje
> ved å hente nyeste hash fra `docs/.pm-confirmations.log`."

Claude leser logfila og inkluderer riktig hash.

### 7. Verifisere CI etter merge

Etter at en PR er merget:

> **Prompt:**
> "Sjekk om alle workflows er grønne på siste commit til main.
> Hvis noen feiler, åpne pm-merge-verification-issuen og rapporter
> hvilke + foreslå om rollback er nødvendig."

Claude bruker GitHub-MCP til å sjekke workflow-runs og rapporterer.

### 8. Skrive postmortem

Når noe har gått skeis:

> **Prompt:**
> "Bruk docs/postmortems/_TEMPLATE.md og skriv et utkast for incident:
> <kort beskrivelse>. Inkluder kronologi: <tidsstempler>. Be meg fylle
> inn 5-Whys og action-items."

### 9. Daglig PM-rapport

På slutten av en sesjon:

> **Prompt:**
> "Generer en kort sesjons-rapport: hva ble levert (kommittet/merget),
> hvilke beslutninger ble tatt (lagt i decisions-log), hvilke
> eksterne komm ble logget, hvilke åpne saker gjenstår.
> Format: 5-7 punkter."

Bruk dette som utgangspunkt for `PM_HANDOFF_<dato>.md` hvis sesjonen
var meningsfull.

### 10. Sett opp prosjekt-status (live)

Hvis du vil ha rask oversikt på morgen:

> **Prompt:**
> "Vis pilot-status: BACKLOG topp 5, åpne pilot-blokkere, RISKS som
> trenger oppmerksomhet, siste 3 dagers commits, Linear åpne BIN-issues
> sortert på prioritet."

Claude bruker MEMORY.md + filer + Linear MCP og oppsummerer.

---

## Mønstre PM bør UNNGÅ

❌ **"Bare kjør det jeg ba om uten å spørre"** — fjerner intent-verification-loopen som har vist seg å spare 4+ timer per misforståelse.

❌ **"Skriv kode, så ordner vi handoff etterpå"** — etterpå skjer aldri. Logg fortløpende.

❌ **"Tobias vet jo dette"** — du vet ikke om Tobias husker det om 3 uker. Logg.

❌ **"Det er for lite til å logge"** — lavterskel-format eksisterer nettopp for små ting. Logg uansett.

---

## Daglig sjekkliste (anbefalt)

Ved sesjons-start:

- [ ] Kjør `bash scripts/pm-onboarding.sh > /tmp/pm-onboarding.md` og les
- [ ] Sjekk `docs/decisions-log/<inneværende-mnd>.md` for nylige beslutninger
- [ ] Sjekk `docs/operations/EXTERNAL_COMMS_LOG.md` for siste eksterne komm
- [ ] Sjekk åpne pm-action-required-issues: `gh issue list --label pm-action-required`

Underveis:

- [ ] Logg hver Tobias-beslutning (prompt 1)
- [ ] Logg hver ekstern komm Tobias rapporterer (prompt 2)
- [ ] Bruk intent-verification før kode-arbeid (prompt 3)

Ved sesjons-slutt:

- [ ] Generer sesjons-rapport (prompt 9)
- [ ] Skriv `PM_HANDOFF_<dato>.md` hvis sesjon var meningsfull
- [ ] Verifiser CI grønt på alle merger (prompt 7)
- [ ] Lukk eventuelle pm-action-required-issues med kommentar

---

## Hvorfor disse mønstrene fungerer

Tre konkrete problemer de adresserer (alle dokumentert i historiske
PM-handoffs):

1. **"Tobias har jo besluttet det"** → decisions-log gjør det søkbart
2. **"Hva sa Lotteritilsynet egentlig?"** → EXTERNAL_COMMS_LOG flytter info-asymmetri
3. **"Agenten misforsto oppgaven"** → intent-verification fanger feilen før timer er brukt

Hver av disse koster 1-4 timer per gang de inntreffer. Mønsterene over
koster 30 sekunder per oppføring. ROI er 10-100×.

---

## Vedlikehold

Hvis du finner et nytt prompt-mønster som er nyttig:

1. Test det i 1-2 uker
2. Hvis det fortsatt brukes daglig: legg det til her som ny seksjon
3. Hvis det erstatter et eksisterende mønster: marker den gamle som DEPRECATED

---

**Se også:**
- [`docs/decisions-log/README.md`](../decisions-log/README.md)
- [`docs/operations/EXTERNAL_COMMS_LOG.md`](./EXTERNAL_COMMS_LOG.md)
- [`.claude/skills/intent-verification/SKILL.md`](../../.claude/skills/intent-verification/SKILL.md)
- [`docs/operations/PM_PR_VERIFICATION_DUTY.md`](./PM_PR_VERIFICATION_DUTY.md)
- [`docs/engineering/PM_ONBOARDING_PLAYBOOK.md`](../engineering/PM_ONBOARDING_PLAYBOOK.md)
- [`docs/operations/PM_DASHBOARD.md`](./PM_DASHBOARD.md)
