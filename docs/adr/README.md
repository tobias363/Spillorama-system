# Architecture Decision Records

ADR-er dokumenterer **"why"** bak design-beslutninger som påvirker ≥ 2 agenter eller services.
Alle ADR-er som er merget til `main` regnes som aktive (med mindre status sier annet).

**Sist oppdatert:** 2026-05-08
**Eier:** Tobias Haugen

> **Migrering 2026-05-08:** ADR-er flyttet fra `docs/decisions/` (3-siffer-format `ADR-NNN`) til
> `docs/adr/` (4-siffer-format `NNNN-tittel.md`) for å støtte ≥ 1000 ADR-er uten omnummerering og for
> å matche industri-standard (ThoughtWorks/MADR). Eldre referanser til `docs/decisions/` redirectes
> derfra.

## Status-katalog

| # | Tittel | Status | Dato |
|---|---|---|---|
| [0001](./0001-adr-format-og-prosess.md) | ADR-format og prosess | Accepted | 2026-05-08 |
| [0002](./0002-perpetual-room-model-spill2-3.md) | Perpetual rom-modell for Spill 2/3 | Accepted | 2026-05-04 |
| [0003](./0003-system-actor.md) | System-actor for engine-mutasjoner | Accepted | 2026-05-04 |
| [0004](./0004-hash-chain-audit.md) | Hash-chain audit-trail (BIN-764) | Accepted | 2026-04-26 |
| [0005](./0005-outbox-pattern.md) | Outbox-pattern for events (BIN-761) | Accepted | 2026-04-26 |
| [0006](./0006-structured-error-codes.md) | Strukturerte error-codes | Accepted | 2026-05-05 |
| [0007](./0007-client-debug-suite.md) | Klient-debug-suite | Accepted | 2026-05-05 |
| [0008](./0008-spillkatalog-classification.md) | Spillkatalog-paritet (Spill 1-3 = MAIN_GAME, SpinnGo = DATABINGO) | Accepted | 2026-04-25 |
| [0009](./0009-pm-centralized-git-flow.md) | PM-sentralisert git-flyt | Accepted | 2026-04-21 |
| [0010](./0010-done-policy-legacy-avkobling.md) | Done-policy for legacy-avkobling | Accepted | 2026-04-17 |
| [0011](./0011-casino-grade-observability.md) | Casino-grade observability | Accepted | 2026-04-28 |
| [0012](./0012-batched-mass-payout.md) | Batched parallel mass-payout for Spill 2/3 (Wave 3a) | Accepted | 2026-05-06 |
| [0013](./0013-per-recipient-broadcast-perpetual-rooms.md) | Per-spiller broadcast-strippet payload for perpetual rooms (Wave 3b) | Accepted | 2026-05-06 |
| [0014](./0014-idempotent-migrations.md) | Idempotente migrasjoner — CREATE TABLE IF NOT EXISTS før ALTER (MED-2) | Accepted | 2026-05-06 |
| [0015](./0015-spill71-regulatory-ledger.md) | §71 regulatory-ledger (separate audit-tabell) | Accepted | 2026-05-09 |
| [0016](./0016-master-action-bridge-retry-rollback.md) | Master-action bridge-retry + rollback | Accepted | 2026-05-09 |
| [0017](./0017-remove-daily-jackpot-accumulation.md) | Fjerne daglig jackpot-akkumulering — bingovert setter manuelt | Accepted | 2026-05-10 |
| [0021](./0021-allow-master-start-without-players.md) | Master kan starte spillet uten solgte bonger (fjerner `MASTER_HALL_RED`) | Accepted | 2026-05-10 |
| [0022](./0022-stuck-game-recovery-multilayer.md) | Multi-lag stuck-game-recovery for Spill 1 scheduled-runder | Accepted | 2026-05-12 |
| [0023](./0023-mcp-write-access-policy.md) | MCP write-access policy (lokal vs prod) | Accepted | 2026-05-14 |
| [0024](./0024-pm-knowledge-enforcement-architecture.md) | PM Knowledge Enforcement Architecture | Accepted | 2026-05-16 |

## Når lage ADR

Lag ADR når en beslutning er minst ett av disse:

- **Påvirker ≥ 2 agenter / services** — f.eks. wallet-pattern som engine + payment-flow må følge.
- **Reverserbart men kostbart å reversere** — f.eks. valg av Postgres vs MongoDB. Endring senere
  betyr migrering av prod-data.
- **Har trade-offs mot reelle alternativer** — hvis det fantes "bare én måte", er det bare en notat.
- **Tobias har gitt direktiv som ikke står andre steder** — f.eks. "vi bygger ikke white-label" eller
  "Done-policy krever merget til main".

Lag IKKE ADR for:

- Implementasjons-detaljer (`for-loop` vs `forEach`)
- Småbeslutninger som kan endres uten teamets samtykke
- Ting som hører hjemme i kode-kommentarer
- Beslutninger som dekkes av eksisterende ADR uten meningsfulle endringer

Tommelfingerregel: Hvis fremtidige PM-er må vite **"hvorfor er det slik?"**, trenger det ADR.

## Lifecycle

| Status | Betydning |
|---|---|
| **Proposed** | Utkast, åpent for diskusjon. Ikke implementert enda. |
| **Accepted** | Vedtatt og implementert (eller under aktiv implementasjon). |
| **Deprecated** | Ikke lenger aktivt, men beholdes for historisk kontekst. Ingen erstatning. |
| **Superseded by ADR-MMMM** | Erstattet av nyere ADR. Inneholder lenke til etterfølger. |

ADR-er er **immutable** etter merge — de endres ikke. Hvis en beslutning blir overstyrt, lag en ny ADR
som refererer til den gamle og forklarer hvorfor vi snur. Den gamle markeres da `Superseded by ADR-NNNN`.

## Hvordan lage en ADR

```bash
# Finn neste ledige nummer
NEXT=$(printf "%04d" $(($(ls docs/adr/[0-9]*.md 2>/dev/null | wc -l | tr -d ' ') + 1)))

# Kopier template til ny fil
cp docs/adr/_template.md "docs/adr/${NEXT}-kort-tittel.md"

# Rediger fil, legg til i README-katalogen, og åpne PR med:
#   feat(adr): ADR-NNNN <kort tittel>
```

Husk å oppdatere katalog-tabellen øverst i denne filen.

## Skill-integrasjon

Hver skill i `.claude/skills/` bør referere relevante ADR-er i seksjonen "Relaterte ADR-er".
Eksempel: `wallet-outbox-pattern` skill peker på ADR-0005 (Outbox-pattern).

Når en ADR endrer status (særlig Superseded), oppdater også referanser i skills.

## Format

Bruk [`_template.md`](./_template.md) som utgangspunkt. ADR-en bør være kort (1-2 sider) og fokusere på:

- **Kontekst:** hva drev beslutningen?
- **Beslutning:** hva valgte vi?
- **Konsekvenser:** hva blir bedre / verre / nøytralt?
- **Alternativer vurdert:** hva avviste vi, og hvorfor?

Implementasjons-detaljer hører hjemme i kode-kommentarer eller modul-README, ikke i ADR-en.
