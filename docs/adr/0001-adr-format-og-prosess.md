# ADR-0001 — ADR-format og prosess

**Status:** Accepted
**Dato:** 2026-05-08
**Deciders:** Tobias Haugen
**Konsulterer:** —

## Kontekst

Spillorama-systemet vokser raskt med 5+ samtidige agenter, 1100+ commits siden 2026-04, og
arkitektur-beslutninger fattes daglig. Beslutninger som "hvorfor er Spill 2/3 ett globalt rom?"
eller "hvorfor binder vi compliance-ledger til kjøpe-hall, ikke master-hall?" påvirker flere
agenter og services, og må overleve PM-handovers uten kontekst-tap.

Tidligere praksis spredte beslutnings-rasjonale over flere kanaler:

- `docs/decisions/ADR-NNN-*.md` — eksisterende ADR-katalog (13 stk i 2026-05-08)
- `CLAUDE.md`-blokker — kort-form, men uten konsekvens-analyse
- PM-handoff-rapporter — éngangs, ikke gjenfinnbart
- Commit-meldinger — for kort-form, ikke struktur
- Linear-issues — lukket etter ferdig, ingen langvarig referanse

Resultatet: når en ny agent skal jobbe på et område, mangler den kontekst om hvorfor det er bygget
slik. Den må enten gjette eller spørre Tobias — som er PM-bottleneck.

Tobias 2026-05-08: "ADR-er bevarer 'why' som er det som glir mest."

## Beslutning

Spillorama bruker **ADR-format** for alle design-beslutninger som er minst ett av:

1. Påvirker ≥ 2 agenter / services
2. Reverserbart men kostbart å reversere
3. Har reelle trade-offs mot alternativer
4. Tobias-direktiv som ikke står i CLAUDE.md eller skill

ADR-er lagres i `docs/adr/` med 4-siffer-nummerering (`NNNN-kort-tittel.md`). Format følger
[`docs/adr/_template.md`](./_template.md) og dokumentert i [`README.md`](./README.md).

ADR-er er **immutable etter merge**. Hvis beslutningen overstyres, lag ny ADR som markerer den gamle
`Superseded by ADR-MMMM`.

Lifecycle: `Proposed → Accepted → Deprecated | Superseded by ADR-MMMM`.

## Konsekvenser

### Positive
- **Kontekst overlever PM-handovers:** Nye agenter kan lese ADR i stedet for å tråkke i samme
  diskusjon på nytt.
- **Audit-trail for regulatorisk:** Pengespillforskriften krever sporbarhet på arkitektur-
  beslutninger som påvirker compliance (jf. ADR-0008 om hovedspill-vs-databingo). ADR-er er bevis.
- **Skill-integrasjon:** ADR-er kan refereres fra skills i `.claude/skills/`, så agenter får riktig
  kontekst når en skill aktiveres.
- **Industri-standard:** Format matcher ThoughtWorks-MADR og Heroku/AWS-praksis. Nye agenter
  gjenkjenner formatet.

### Negative
- **Disiplin kreves:** Hvis vi ikke lager ADR ved nye beslutninger, glipper "why" igjen. Mitigasjon:
  PR-template har checkbox-pkt for å huske ADR-vurdering.
- **Migrering av eksisterende beslutninger:** 13 ADR-er i `docs/decisions/` må migreres til ny
  struktur. Dekkes av samme PR som etablerer formatet.

### Nøytrale
- ADR-er er ikke bindende for implementasjon — de dokumenterer beslutning, men kode er sannhet.
  Hvis kode avviker, må enten kode eller ADR oppdateres (ny ADR for sistnevnte).
- Korte beslutninger uten alternativer ("vi valgte React over Vue") fortjener ikke ADR — det er bare
  notat. Tommelfingerregel i [`README.md`](./README.md).

## Alternativer vurdert

### Alternativ A: Behold `docs/decisions/` med 3-siffer-format
Beholde eksisterende `ADR-NNN-tittel.md`-format. Avvist:
- 3-siffer-format støtter kun 999 ADR-er; 4-siffer (`NNNN`) er industri-standard og future-proof.
- Mappe-navn `decisions` er mindre gjenfinnbart enn `adr` (folk søker etter "ADR" eller
  "decisions"; sistnevnte er mer ambiguøs).
- Anledning til å gjøre full opprydning og ensretting nå.

### Alternativ B: Bruk Confluence/Notion for ADR-er
Avvist:
- ADR-er må reises via PR slik at alle agenter ser dem (PR-review = decision-review).
- Eksterne verktøy får ikke `git blame`-historikk eller PR-binding.
- Vi har allerede mono-repo for alt annet — ADR-er hører hjemme der.

### Alternativ C: Skriv beslutninger som inline kode-kommentarer
Avvist:
- Kommentarer er for korte for kontekst + alternativer + konsekvenser.
- Kommentarer overlever ikke refactoring uten manuell vedlikehold.
- Beslutninger som påvirker ≥ 2 services trenger sentralisert sted.

## Implementasjon

- [`docs/adr/_template.md`](./_template.md) etablert med standard-struktur
- [`docs/adr/README.md`](./README.md) etablert med katalog, lifecycle, og hvordan-lage-ADR-guide
- 13 eksisterende ADR-er fra `docs/decisions/` migrert til ny struktur (samme PR)
- `CLAUDE.md` oppdatert med pekere til ADR-prosessen
- `.github/pull_request_template.md` utvidet med ADR-checklist-item
- Sentrale skills i `.claude/skills/` får "Relaterte ADR-er"-seksjon

## Referanser

- [`docs/adr/README.md`](./README.md) — full guide
- [`docs/decisions/`](../decisions/) — gammel lokasjon (beholdes med redirect)
- [Michael Nygard 2011 — "Documenting Architecture Decisions"](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) — opprinnelig ADR-format
- [MADR (Markdown Architectural Decision Records)](https://adr.github.io/madr/) — moderne template
- Tobias-direktiv 2026-05-08: ADR-er bevarer "why" som glir mest
