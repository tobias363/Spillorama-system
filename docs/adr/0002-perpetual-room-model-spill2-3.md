# ADR-0002 — Perpetual rom-modell for Spill 2/3

**Status:** Accepted
**Dato:** 2026-05-04
**Deciders:** Tobias Haugen
**Konsulterer:** —

> **Migrering 2026-05-08:** Migrert fra `docs/decisions/ADR-001-perpetual-room-model-spill2-3.md` til ny struktur. Innhold uendret.

## Kontekst

Spillorama har tre hovedspill (Spill 1, 2, 3) som alle bygger på BingoEngine-grunnlaget. Spill 1 ble
designet først, basert på legacy-modellen "live bingo i fysisk hall":

- Per-hall-rom (én RoomState per hall)
- Master-styrt schedule (hall-master starter spillet, andre haller signalerer "Ready")
- Agent-koordinering (bingovert i hallen styrer flyt)
- §64 spilleplan (statisk timetable) og §71 hall-rapport (per-hall regnskap)

For Spill 2 (Rocket, 3×3, 1-21 baller) og Spill 3 (Monsterbingo, 5×5 uten free) var spørsmålet:
**bygger vi disse også som per-hall-rom, eller én global rom?**

Pilot-skala er 24 haller × 1500 spillere = 36 000 samtidige. Hvis Spill 2/3 hadde per-hall-rom:

- 24 master-haller-å-koordinere per spill
- Master-disconnect ville henge én hall sin runde
- Trekninger ville være ute-av-sync mellom haller
- Spillere ville se forskjellige jackpotter avhengig av hall

Ser vi på industri-paritet (Playtech Bingo, Evolution Live Casino), er modellen for online-bingo og
live-casino-spill **én global rom per spill**.

## Beslutning

Spill 2 og Spill 3 implementeres som **ETT globalt rom per spill**:

- `ROCKET` (én RoomState for hele Spill 2)
- `MONSTERBINGO` (én RoomState for hele Spill 3)

System-actor (ikke menneskelig agent) driver perpetual loop:
- 30 sekunder mellom runder (`PERPETUAL_LOOP_DELAY_MS`)
- Auto-draw 2 sek mellom baller (`AUTO_DRAW_INTERVAL_MS`)
- Ingen master-hall, ingen agent-handshake

Kjøp av billett bindes fortsatt til kjøpe-hall i ComplianceLedger (jf. ADR-0008 §11-paritet) — men selve
trekningen er global.

Spill 1 forblir per-hall master-styrt (uendret).

## Konsekvenser

### Positive
- **Skalerer til 36 000+:** ingen master-hall som SPOF, alle spillere ser samme trekning samtidig
- **Industri-paritet:** matcher Playtech Bingo, Evolution Gaming
- **Enklere drift:** ingen agent-trening, ingen master-handover-handshake
- **Bedre jackpot-pooling:** ETT globalt jackpot for Spill 2 i stedet for 24 separate

### Negative
- **Code-deling med Spill 1 må gjøres varsomt:** noen abstraksjoner (assertHost, masterReady) gjelder kun
  Spill 1. Pre-pilot-bug #942 var Spill 2/3 som arvet `assertHost` fra Spill 1. Fix: skip for perpetual.
- **Audit-modell må håndtere "no-actor"-events:** ADR-0003 dekker system-actor.

### Nøytrale
- **Spill 1 + Spill 2/3 har fundamentalt forskjellige livsmønstre:** dette må læres av nye utviklere.
  Dokumentert i `docs/SYSTEM_DESIGN_PRINCIPLES.md` §3.2.

## Alternativer vurdert

### Alternativ A: Per-hall-rom for Spill 2/3 (samme som Spill 1)
Avvist:
- 24 master-haller per spill = 48 totalt SPOF-er
- Master-disconnect = hele hall hangs
- Jackpot-pool ville være per-hall = mindre attraktive prises
- Brudd med industri-norm (online bingo = global)

### Alternativ B: Per-region-rom (Norge ett, andre land hvis vi ekspanderer)
Avvist:
- Vi har konsesjon kun for Norge — alle spillere er allerede én region
- Premature abstraction (jf. design-prinsipp §4.1: vi bygger ikke white-label)

### Alternativ C: Per-50-spillere-rom (sharding etter capacity)
Avvist:
- Ville fragmentere jackpot-pool
- Ville gjøre social-feel verre (færre samtidige spillere per rom)
- Pilot-skala (1500 per hall × 24 = 36 000) tåles av single Postgres + Redis hvis modellen er ren

## Implementasjon

- ✅ Spill 2 (`ROCKET`) live på prod (sesjon 2026-05-05)
- ✅ Spill 3 (`MONSTERBINGO`) live på prod (sesjon 2026-05-05)
- ⚠️ Engine-refactor for system-actor (Wave 1) i fremdrift — se [`BACKLOG.md`](../../BACKLOG.md)

Skills som bør oppdateres: `spill2-perpetual-loop`, `spill3-phase-state-machine`, `spill1-master-flow`,
`live-room-robusthet-mandate`.

## Referanser

- `apps/backend/src/game/Game1RoomFactory.ts` — Spill 1 factory (master-modell)
- `apps/backend/src/game/Game2RoomFactory.ts` — Spill 2 factory (perpetual)
- `apps/backend/src/game/Game3Engine.ts` — Spill 3 engine
- PR [#942](https://github.com/tobias363/Spillorama-system/pull/942) — fix assertHost for perpetual
- `docs/architecture/CASINO_GRADE_ARCHITECTURE_RESEARCH_2026-04-28.md`
- `docs/architecture/LIVE_CASINO_ROOM_ARCHITECTURE_RESEARCH_2026-04-27.md`
