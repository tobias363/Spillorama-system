# Decisions Log — daglige Tobias-beslutninger

**Sist oppdatert:** 2026-05-10
**Eier:** Tobias Haugen
**Format:** Én markdown-fil per måned (`YYYY-MM.md`), én oppføring per beslutning.

> **Til ny PM:** Når Tobias sier "vi har jo bestemt det" og du ikke husker
> hvor — det er sannsynligvis HER. Søk med `grep -ri "<søkeord>" docs/decisions-log/`.
> Når en beslutning du loggede her viser seg å være varig viktig: promoter
> den til en ADR (`docs/adr/NNNN-tittel.md`).

---

## Hvorfor

Mellom **chat-meldinger** (forsvinner) og **ADR-er** (formelle, immutable, krever
seremoni) er det et hav av små Tobias-beslutninger som påvirker hvordan PM
jobber: "vi gjør X heller enn Y", "ikke bruk Z her", "default til det andre".

Disse er for små for ADR (det blir spam) men for viktige for chat (de
forsvinner). Resultatet historisk: neste PM stiller samme spørsmål til Tobias
fordi forrige PM ikke logget svaret. Begge mister tid.

Decisions-log fanger dette på lavterskel-format.

---

## Når logger du

**Logg når Tobias:**

- Svarer på et "skal vi X eller Y?"-spørsmål med konkret valg
- Sier "ikke gjør Z" eller "vi har bestemt at Z er feil"
- Endrer en pågående tilnærming midt i sesjonen
- Setter en terskelverdi eller default
- Avgrenser scope ("denne PR-en skal IKKE ta med Y")
- Konfirmerer en antakelse PM hadde

**IKKE logg her hvis:**

- Det er en formell arkitekturbeslutning som påvirker ≥2 services → bruk ADR
- Det er en bug-fix som dokumenterer seg selv via PR-tittel
- Det er en regulatorisk beslutning → tilhører `docs/compliance/`

**Når i tvil — logg her.** Bedre å ha for mange enn for få. ADR-er kan promoteres senere.

---

## Format

**Filnavn:** `YYYY-MM.md` (én fil per måned)

**Per oppføring:**

```markdown
### 2026-05-10 — <kort tittel>

**Tobias bestemte:** <hva — én setning>
**Fordi:** <begrunnelse — én setning hvis tilgjengelig>
**Kontekst:** <BIN-NNN / PR #NNNN / Cowork-sesjon "tittel">
**Handling:** <hva PM eller agent skal gjøre videre — om aktuelt>
```

Ingen seremoni. Ingen formalia. Skriv det du faktisk hørte.

---

## Eksempler

### Bra

```markdown
### 2026-05-10 — Spill 2 jackpot-mapping per draw-count

**Tobias bestemte:** Jackpot mappes per draw-count, ikke per spill-runde.
**Fordi:** Player-perception av "snart jackpot" må knyttes til synlig progresjon.
**Kontekst:** BIN-823 + Cowork-sesjon 2026-05-10 morgen
**Handling:** Game2JackpotTable refactores før neste pilot-test (assigned to Wave 1)
```

```markdown
### 2026-05-10 — Ikke flytt Spill 1 til perpetual-modell

**Tobias bestemte:** Spill 1 forblir per-hall + GoH-master + plan-runtime — ikke perpetual.
**Fordi:** Pilot-haller forventer master-kontroll for live-spillet. Endring nå er for risikabel.
**Kontekst:** Diskusjon i Cowork 2026-05-10 etter Spill2-3 pilot-readiness-PR
**Handling:** Ingen — bekrefter eksisterende SYSTEM_DESIGN_PRINCIPLES
```

### Dårlig

```markdown
### 2026-05-10 — Mer arbeid

**Tobias bestemte:** Vi må jobbe mer.
```

(For vag, ingen handlings-info, ingen kontekst.)

---

## Søk i loggen

Som PM, når noe føles kjent men du ikke husker hvor:

```bash
# Søk i hele logg-katalogen:
grep -rni "jackpot\|perpetual\|cap\|terskelverdi" docs/decisions-log/

# Eller bare denne måneden:
grep -ni "<søkeord>" docs/decisions-log/2026-05.md

# Eller alle siste 3 måneder:
grep -rni "<søkeord>" docs/decisions-log/2026-{03,04,05}.md
```

Inkluder relevante treff i `pm-checkpoint.sh`-takeaway hvis de er nyttige
for neste PM.

---

## Promotering til ADR

Hvis en decisions-log-oppføring viser seg å være varig viktig:

1. Skriv ADR i `docs/adr/NNNN-<tittel>.md` følgende mal i `_template.md`
2. I decisions-log-oppføringen, legg til linje: `**Promotert til:** ADR-NNNN (YYYY-MM-DD)`
3. Behold opprinnelig oppføring (ikke slett — kontekst-spor)

ADR vinner over decisions-log ved konflikt.

---

## Vedlikehold

- **Per måned:** Ny fil `YYYY-MM.md` opprettes første gang du logger den måneden
- **Per kvartal:** Tobias eller PM gjør pass for å se etter potensielle ADR-promoteringer
- **Per år:** Eldre filer kan flyttes til `docs/decisions-log/archive/YYYY/` hvis kataloger blir for store

---

## Format-vedlikehold

Hvis vi finner ut at lavterskel-formatet er for vagt og noen oppføringer
er ubrukelige, oppdater format-mal-en over og noter dato. Tidligere
oppføringer beholdes i sin opprinnelige form (de gjenspeiler hvordan
prosessen var på det tidspunktet).

---

**Se også:**
- [`docs/adr/README.md`](../adr/README.md) — formelle arkitektur-beslutninger
- [`docs/operations/EXTERNAL_COMMS_LOG.md`](../operations/EXTERNAL_COMMS_LOG.md) — eksterne kommunikasjon
- [`docs/operations/PM_HANDOFF_*.md`](../operations/) — sesjon-spesifikke handoffs
- [`docs/RISKS.md`](../RISKS.md) — risikoer
- [`docs/postmortems/`](../postmortems/) — incidenter
