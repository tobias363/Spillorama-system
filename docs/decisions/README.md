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
