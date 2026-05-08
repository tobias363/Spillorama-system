# Architecture Decision Records (ADR) — DEPRECATED

> **Migrert 2026-05-08:** ADR-er er flyttet til [`docs/adr/`](../adr/) med 4-siffer-nummerering og
> oppdatert format. Se [`docs/adr/README.md`](../adr/README.md) for ny katalog. Filene i denne
> mappen er beholdt for git-historikk og kan refereres som arkiv, men ny kontekst legges i
> `docs/adr/`.
>
> **Migrasjons-mapping:**
>
> | Gammel | Ny |
> |---|---|
> | `ADR-001-perpetual-room-model-spill2-3.md` | `0002-perpetual-room-model-spill2-3.md` |
> | `ADR-002-system-actor.md` | `0003-system-actor.md` |
> | `ADR-003-hash-chain-audit.md` | `0004-hash-chain-audit.md` |
> | `ADR-004-outbox-pattern.md` | `0005-outbox-pattern.md` |
> | `ADR-005-structured-error-codes.md` | `0006-structured-error-codes.md` |
> | `ADR-006-client-debug-suite.md` | `0007-client-debug-suite.md` |
> | `ADR-007-spillkatalog-classification.md` | `0008-spillkatalog-classification.md` |
> | `ADR-008-pm-centralized-git-flow.md` | `0009-pm-centralized-git-flow.md` |
> | `ADR-009-done-policy-legacy-avkobling.md` | `0010-done-policy-legacy-avkobling.md` |
> | `ADR-010-casino-grade-observability.md` | `0011-casino-grade-observability.md` |
> | `ADR-011-batched-mass-payout.md` | `0012-batched-mass-payout.md` |
> | `ADR-011-per-recipient-broadcast-perpetual-rooms.md` | `0013-per-recipient-broadcast-perpetual-rooms.md` |
> | `ADR-012-idempotent-migrations.md` | `0014-idempotent-migrations.md` |
>
> Ny ADR-0001 (selvrefererende, om ADR-format og prosess) finnes kun på ny lokasjon.

---

# Architecture Decision Records (ADR)

**Sist oppdatert:** 2026-05-06
**Eier:** Tobias Haugen

Dette er Spillorama sin decision-log. Hver større arkitektonisk beslutning har én ADR som forklarer
**kontekst**, **beslutning**, **konsekvenser** og **alternativer vurdert**.

---

## Hva er en ADR?

Et kort dokument (maks 1-2 sider) som svarer på:
- Hva var problemet?
- Hvilken løsning valgte vi?
- Hva blir konsekvensene?
- Hva alternative løsninger så vi på, og hvorfor avviste vi dem?

ADR-er er **immutable** — de endres ikke etter merge. Hvis en beslutning blir overstyrt, lag en ny ADR
som refererer til den gamle og forklarer hvorfor vi snur.

---

## Format

```markdown
# ADR-NNNN: <Tittel>

**Status:** Accepted | Superseded | Deprecated
**Dato:** YYYY-MM-DD
**Forfatter:** <Navn>
**Superseded by:** ADR-NNNN (kun hvis Superseded)

## Kontekst
1-3 avsnitt om hvorfor vi måtte ta denne beslutningen.

## Beslutning
1-2 avsnitt om hva vi valgte.

## Konsekvenser
+ Positive konsekvenser
- Negative konsekvenser
~ Nøytrale (ting vi må håndtere)

## Alternativer vurdert
1. Alternativ A — avvist fordi ...
2. Alternativ B — avvist fordi ...
```

---

## ADR-katalog

| Nr | Tittel | Status | Dato |
|---|---|---|---|
| [001](./ADR-001-perpetual-room-model-spill2-3.md) | Perpetual rom-modell for Spill 2/3 | Accepted | 2026-05-04 |
| [002](./ADR-002-system-actor.md) | System-actor for engine-mutasjoner | Accepted | 2026-05-04 |
| [003](./ADR-003-hash-chain-audit.md) | Hash-chain audit-trail (BIN-764) | Accepted | 2026-04-26 |
| [004](./ADR-004-outbox-pattern.md) | Outbox-pattern for events (BIN-761) | Accepted | 2026-04-26 |
| [005](./ADR-005-structured-error-codes.md) | Strukturerte error-codes | Accepted | 2026-05-05 |
| [006](./ADR-006-client-debug-suite.md) | Klient-debug-suite | Accepted | 2026-05-05 |
| [007](./ADR-007-spillkatalog-classification.md) | Spillkatalog-paritet (Spill 1-3 = MAIN_GAME, SpinnGo = DATABINGO) | Accepted | 2026-04-25 |
| [008](./ADR-008-pm-centralized-git-flow.md) | PM-sentralisert git-flyt | Accepted | 2026-04-21 |
| [009](./ADR-009-done-policy-legacy-avkobling.md) | Done-policy for legacy-avkobling | Accepted | 2026-04-17 |
| [010](./ADR-010-casino-grade-observability.md) | Casino-grade observability | Accepted | 2026-04-28 |
| [011](./ADR-011-batched-mass-payout.md) | Batched parallel mass-payout for Spill 2/3 (Wave 3a) | Accepted | 2026-05-06 |
| [011b](./ADR-011-per-recipient-broadcast-perpetual-rooms.md) | Per-spiller broadcast-strippet payload for perpetual rooms (Wave 3b) | Accepted | 2026-05-06 |
| [012](./ADR-012-idempotent-migrations.md) | Idempotente migrasjoner — CREATE TABLE IF NOT EXISTS før ALTER (MED-2) | Accepted | 2026-05-06 |

---

## Når skal man skrive en ADR?

**Skriv ADR for:**
- Valg av arkitektur-modell (per-hall vs global rom, monolith vs microservice, etc.)
- Valg av kjerne-teknologi (Postgres vs MongoDB, REST vs GraphQL, etc.)
- Endring i compliance/regulatorisk modell
- Innføring av nye sikkerhets-mekanismer
- Endring i workflow eller prosess som påvirker hele teamet

**Skriv IKKE ADR for:**
- Implementasjons-detaljer ("jeg valgte for-loop over forEach")
- Småbeslutninger som kan endres uten teamets samtykke
- Ting som hører hjemme i kode-kommentarer

Tommelfingerregel: hvis fremtidige PM-er må vite "hvorfor er det slik?", trenger det ADR.
