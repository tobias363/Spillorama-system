# Spill 1 — admin-UI ↔ variantConfig-kobling

**Status:** PR A + PR B landet. PR C (wire-up + klient + docs) pågår.
Scheduler-fiks + Bug 2-routing er utsatt til post-pilot (se "Known
limitations").

**Sist oppdatert:** 2026-04-21

## Problemet

Admin-UI Spill 1-formen lar prosjektleder velge billettfarger, pris per
farge og gevinst-matrise per pattern (Row 1-4 + Fullt Hus). Verdiene
lagres i `GameManagement.config_json.spill1`. Før denne kjeden landet
brukte engine aldri admin-konfigen — alle Spill 1-rom falt tilbake på
hardkodede defaults (100/200/200/200/1000 kr) via
`bindDefaultVariantConfig` → `DEFAULT_NORSK_BINGO_CONFIG`.

Målet med koblingen:

- Per-farge gevinst-matriser: Small Yellow "1 Rad" = 50 kr, Small White
  "1 Rad" = 100 kr i samme spill.
- Valgbar modus per (farge, fase): prosent av pot eller fast kr.
- Elvis-varianter (Elvis 1-5) behandles som separate farger med egne
  matriser — ingen spesialregel.
- Ulike premie-matriser per spill i samme plan (morgen vs kveld) via
  at hver `GameManagement`-rad er ett spill.

## PM-vedtak (2026-04-21)

1. **Per-farge matrise** — alle ticket-colors (inkl. alle Elvis-varianter)
   har egen 5-fase premie-matrise.
2. **Elvis inkludert i per-farge-regelen** — ingen separat Elvis-matrise.
3. **Én `GameManagement`-rad = ett spill** — morgenbingo og kveldsbingo
   er separate rader. Flere halls i samme link får instanser via scheduler.
4. **Scheduler-fiks utsatt til post-pilot** — pilot kjører med default-
   gevinster. Admin-konfig får full effekt på `scheduled_games` spawnet
   etter scheduler-PR-en lander post-pilot.
5. **RTP-cap-policy** — fast-premier kappes av eksisterende
   `applySinglePrizeCap` + `remainingPrizePool` + `remainingPayoutBudget`
   i `payoutPhaseWinner`. Akseptert at vinner kan få mindre enn lovet
   beløp ved for liten pool. UI-varsling er nice-to-have, ikke blokker.
6. **Option X** — hver farge kjører uavhengig premie-matrise. Multi-
   winner-split skjer innen én farges vinnere. En spiller med brett i to
   farger vinner i begge og får én claim per farge.
7. **Klient-visning** — kun spillerens egen farges matrise vises.
   Multi-ticket med ulike farger viser høyeste premie per fase på tvers
   av spillerens egne bonger (enkleste UX).

## Data-modell

### Admin-UI (PR A, landet som #323)

`apps/admin-web/src/pages/games/gameManagement/Spill1Config.ts`:

```ts
export type PatternPrizeMode = "percent" | "fixed";

export interface PatternPrize {
  mode: PatternPrizeMode;
  /** Prosent (0-100) eller kr-beløp ≥ 0 — avhengig av `mode`. */
  amount: number;
}

export interface TicketColorConfig {
  color: Spill1TicketColor;
  priceNok: number;
  prizePerPattern: Partial<Record<Spill1Pattern, PatternPrize>>;
  minimumPrizeNok?: number;
}
```

Valideringsregler:
- `percent`-mode-verdier summert per farge ≤ 100.
- `fixed`-mode-verdier teller ikke mot 100%-taket.
- Hver amount må være endelig + ≥ 0.
- Manglende `PatternPrize` for en fase → backend-mapper bruker default
  for den fasen.

### Shared-types (PR A, landet)

`packages/shared-types/src/game.ts` — `PatternDefinition` utvidet med:

```ts
winningType?: "percent" | "fixed";
prize1?: number;
```

Begge felt er optional + additive. Zod-schema i `schemas.ts` følger samme
utvidelse. Backend-local `PatternDefinition`
(`apps/backend/src/game/types.ts`) har fortsatt disse + G3-spesifikke
(`patternDataList`, `ballNumberThreshold`) — de to er parallelle.

## Backend — PR B (landet som #329)

### `GameVariantConfig.patternsByColor` (variantConfig.ts)

```ts
patternsByColor?: Record<string, PatternConfig[]>;
```

Nøkkel = `TicketTypeConfig.name` (f.eks. `"Small Yellow"`, `"Elvis 1"`)
— matcher `Ticket.color` i engine. Spesialnøkkelen
`PATTERNS_BY_COLOR_DEFAULT_KEY = "__default__"` er fallback for ukjent
farge og settes alltid av mapperen.

### `spill1VariantMapper.ts`

```ts
buildVariantConfigFromSpill1Config(
  spill1: Spill1ConfigInput | null | undefined,
  fallback?: GameVariantConfig,
): GameVariantConfig

resolvePatternsForColor(
  variantConfig: GameVariantConfig,
  color: string | undefined,
  onDefaultFallback?: (color: string) => void,
): ReadonlyArray<PatternConfig>
```

Mapping-regler:
- Admin-UI farge-slug → `TicketTypeConfig.name` (tabell i mapperen).
  `small_*` = 1/1, `large_*` = 3/3, `elvis*` = 2/2.
- Per pattern: `PatternPrize` `{mode, amount}` → `{winningType: "fixed",
  prize1: amount}` eller `{prizePercent: amount}`.
- Plain number (legacy) tolkes som `{mode: "percent", amount: n}`.
- Manglende fase-entry → kopi av fallback-fase.
- Ukjent slug → hoppes over defensivt.
- Dedupliserer duplikat-farger.

`resolvePatternsForColor` kalles fra engine ved hver draw; warning-hook
logger når `__default__` treffer en farge som finnes i
`ticketTypes[]` (konfig-gap).

### `BingoEngine.evaluateActivePhase` — per-farge branch

- Flat-path (`patternsByColor` undefined): uendret semantikk — én unik
  vinner per spiller, én pott delt likt.
- Per-farge-path (`patternsByColor` satt): vinnere grupperes per
  ticket-color. Hver farge-gruppe har egen prize-kalkulasjon (fixed
  eller percent), egen multi-winner-split, egen split-rounding audit.
  `patternResult.winnerIds[]` aggregerer og dedupliserer spillere på
  tvers av farge-grupper.

Per-farge-oppslag flytter seg gjennom ny `detectPhaseWinners(...)`-
helper som produserer `Map<color, Set<playerId>>` + per-farge
`PatternConfig`. Engine bygger en per-farge `PatternDefinition` med
riktig `name + claimType + winningType + prize1` og videresender til
`payoutPhaseWinner`.

### `bindVariantConfigForRoom` (async, DB-aware)

```ts
async bindVariantConfigForRoom(
  roomCode: string,
  opts: {
    gameSlug: string;
    gameManagementId?: string | null;
    fetchGameManagementConfig?: (id: string) =>
      Promise<Record<string, unknown> | null | undefined>;
  },
): Promise<void>
```

Flow:
1. Idempotent — no-op hvis rommet allerede har variantConfig.
2. Kun Spill 1 (`gameSlug ∈ {bingo, game_1, norsk-bingo}`) forsøker
   DB-lookup.
3. Fetcher returnerer `GameManagement.config_json` → `extractSpill1Config`
   plukker ut spill1-sub-objektet (kanonisk form: `{spill1: {...}}`) →
   mapperen bygger variantConfig → bindes.
4. Fetcher null/feil/kast → log + fallback til `bindDefaultVariantConfig`.

RoomStateManager holdes fri for service-avhengigheter via injisert
fetcher-hook.

**Kanonisk shape**: `extractSpill1Config` godtar både nested
`{spill1: {...}}` og direkte-shape (`{ticketColors: [...]}`) for
bakoverkompat, men alle produksjons-callsites skriver og leser
**nested-formen** via admin-UI `buildSpill1Payload` → `config.spill1`.

## PR C — wire-up + klient + docs

### Backend wire-up (index.ts + sockets + admin-route)

- Injisér ny dep `bindVariantConfigForRoom(roomCode, opts)` i
  `createGameEventHandlers`-deps + admin-router-deps alongside eksisterende
  `bindDefaultVariantConfig`.
- Implementasjon i `index.ts` wrapper `roomState.bindVariantConfigForRoom`
  med `fetchGameManagementConfig: async (id) => (await gameManagementService.get(id))?.config ?? null`.
- Alle kjente `bindDefaultVariantConfig`-kallsteder flyttes til
  `bindVariantConfigForRoom`-call med `gameManagementId: undefined` —
  plumbing-en er da på plass for fremtidige caller som har
  `gameManagementId` tilgjengelig (fremtidig scope: admin-UI "spill ID"
  på `room:create`-event, scheduler-driven room-spawn).

### Klient-visning (CenterTopPanel)

Premie-visning i `packages/game-client/src/games/game1/components/CenterTopPanel.ts`:

```ts
// PR C: Honor winningType — for "fixed"-mode bruk prize1 direkte
// i stedet for prizePercent × pool.
const prize = result?.payoutAmount
  ?? (pattern.winningType === "fixed"
       ? (pattern.prize1 ?? 0)
       : Math.round((pattern.prizePercent / 100) * prizePool));
```

Dette er minimal client-change som honorerer PR A+B sin fixed-mode
semantikk. Per-farge-differensiering per spillerens egen ticket-color er
bevisst ikke implementert i PR C — krever per-player snapshot-scoping
eller `patternsByColor`-eksponering i wire-protokollen. Post-pilot
oppgave (flagges i "Post-pilot follow-up").

### Known limitations — post-pilot follow-up

#### Bug 2: Scheduler-path routing bruker første vinners farge

**Lokasjon:** `apps/backend/src/game/Game1DrawEngineService.ts:903`
(`evaluateAndPayoutPhase`).

**Symptom:** Scheduled-games (DB-driven scheduler-path) bruker
`winners[0].ticketColor` til å slå opp jackpot-config. Med per-farge-
matriser kan vinnere av samme fase ha ulike farger → kun første vinner
får jackpot-logikk matchet mot sin farge. Resten får "feil" farge-routing.

**Manifesterer seg ikke i pilot** fordi scheduler ennå ikke kopierer
per-farge-config inn i `scheduled_games.ticket_config_json`. Admin-UI-
config blir ikke lest av schedulerens spawn-path
(`Game1ScheduleTickService` leser `sg.ticketTypesData`-legacy).

**Avhengighet:** Bug 2 + scheduler-fiks hører logisk sammen og leveres
samlet post-pilot. Når scheduler-PR-en startes må fikseren:
1. Endre `Game1ScheduleTickService` til å lese
   `GameManagement.config_json.spill1` som primærkilde.
2. Endre `Game1DrawEngineService.evaluateAndPayoutPhase` til å iterere
   per-farge-grupper (samme pattern som `BingoEngine.evaluateActivePhase`
   etter PR B).
3. Endre `Game1PayoutService.payoutPhase` til å akseptere per-farge
   premier i stedet for én global `totalPhasePrizeCents`.

**Dagens atferd** er dokumentert av
`apps/backend/src/game/BingoEngine.perColorPatterns.test.ts` (socket-
room-path, PR B) — scheduled-games-path har enda ikke tilsvarende
per-farge-test fordi admin-config ikke flyter dit.

#### Per-farge jackpot-routing

Jackpot-prisen varierer per farge i admin-UI (`jackpot.prizeByColor`).
Mapperen tar i dag **maks** av alle per-farge-priser som single-prize i
`GameVariantConfig.jackpot.prize` for bakover-kompat med engine-shape.
Korrekt routing (hver vinner får sin farges jackpot-pris) krever at
`GameVariantConfig.jackpot` utvides til per-farge-map eller at payout-
pathen slår opp direkte i admin-config.

Leveres samme PR som scheduler-fiks post-pilot.

#### Klient per-farge-visning

PR C gir fixed-mode-visning, men ikke per-farge-differensiering. Full
per-farge-display krever:
1. Wire-protokoll: `game.patternsByColor` i `room:update` eller
   per-player scoped snapshots.
2. Klient-logikk: velg matrise basert på spillerens egne ticket-farger
   (høyeste pris per fase).

Post-pilot oppgave.

## Migrasjonsplan for eksisterende spill

- Eksisterende `GameManagement`-rader uten `config.spill1` → mapperen
  returnerer `DEFAULT_NORSK_BINGO_CONFIG` uendret.
- Rader med legacy-number i `prizePerPattern[phase]` → tolkes som
  `{ mode: "percent", amount: n }`.
- Ingen DB-migrasjon nødvendig (JSONB + additive).
- Admin-UI kan ikke laste eksisterende spill for redigering ennå; når
  edit-path bygges må den også håndtere legacy-form.

## Scope utsatt (helhetlig oversikt)

- **Scheduler-fiks** — legge admin-config inn i `scheduled_games`,
  endre `Game1ScheduleTickService` + `Game1DrawEngineService` +
  `Game1PayoutService`. Koblet med Bug 2-fix. Post-pilot.
- **Per-farge jackpot-routing** — Post-pilot, samme PR som over.
- **Klient per-farge-visning** — Post-pilot.
- **Admin-UI edit-path for eksisterende spill** — egen PR.
- **Popup "fremtidige spill i hall"** — separat feature.

## PR-referanser

- PR A (admin-UI + shared-types): merget som **#323** (commit c38223c4)
- PR B (backend engine + mapper): merget som **#329** (commit 09f31018)
- PR C (wire-up + klient + docs): pågår
