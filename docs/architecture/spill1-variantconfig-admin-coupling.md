# Spill 1 — admin-UI ↔ variantConfig-kobling

**Status:** PR A landet (data-modell + shared-types + admin-UI form).
PR B (backend mapper + engine per-farge-støtte) og PR C (integrasjonstester)
gjenstår. Scheduler-fiks utsatt til post-pilot.

**Sist oppdatert:** 2026-04-21

## Problemet

Admin-UI Spill 1-formen lar prosjektleder velge billettfarger, pris per
farge og gevinst-matrise per pattern (Row 1-4 + Fullt Hus). Verdiene
lagres i `GameManagement.config_json.spill1`. Men inntil denne kjeden
(PR A/B/C + scheduler-fiks post-pilot) lander, brukes aldri
admin-konfigen ved kjøretid — alle Spill 1-rom faller tilbake på
hardkodede defaults (100/200/200/200/1000 kr) via
`bindDefaultVariantConfig` → `DEFAULT_NORSK_BINGO_CONFIG`.

Målet med denne koblingen:

- Per-farge gevinst-matriser: Small Yellow "1 Rad" = 50 kr, Small White
  "1 Rad" = 100 kr i samme spill.
- Valgbar modus per (farge, fase): prosent av pot eller fast kr.
- Elvis-varianter (Elvis 1-5) behandles som separate farger med egne
  matriser — ingen spesialregel.
- Ulike premie-matriser per spill i samme plan (morgen vs kveld) via
  at hver `GameManagement`-rad er ett spill.

## PM-vedtatte beslutninger (2026-04-21)

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
   beløp ved for liten pool. UI-varsling under admin-konfig er nice-to-have,
   ikke blokker.

## Data-modell

### Admin-UI (PR A, landet)

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
  for den fasen (PR B).

### Shared-types (PR A, landet)

`packages/shared-types/src/game.ts` — `PatternDefinition` utvidet med:

```ts
winningType?: "percent" | "fixed";
prize1?: number;
```

Begge felt er optional + additive. Zod-schema i `schemas.ts` følger
samme utvidelse. Backend-local `PatternDefinition`
(`apps/backend/src/game/types.ts`) har fortsatt disse felter + G3-
spesifikke (`patternDataList`, `ballNumberThreshold`) — de to definisjoner
er parallelle inntil Agent 6 sin pattern-mask-canonicalization lander.

## PR B — Backend mapper + engine per-farge-støtte (gjenstår)

### `apps/backend/src/game/spill1VariantMapper.ts` (ny)

```ts
export function buildVariantConfigFromSpill1Config(
  spill1: Spill1Config,
  fallback: GameVariantConfig = DEFAULT_NORSK_BINGO_CONFIG,
): GameVariantConfig
```

Mappingregler:
- `ticketTypes[]` fra `spill1.ticketColors[].color` — priceMultiplier +
  ticketCount fra fargeprefiks (`small_` = 1/1, `large_` = 3/3, `elvis*`
  = 2/2).
- `patternsByColor: Record<string, PatternConfig[]>` (ny struktur, se
  under) — per farge, per fase.
- `jackpot`, `replaceAmount`, `luckyNumberPrize`, `autoClaimPhaseMode:true`,
  `maxBallValue:75` speiles fra `spill1`.
- Manglende `prizePerPattern[phase]` → fall back til `fallback.patterns[phase]`
  (dagens hardkodede 100/200/200/200/1000).
- Legacy-number (tall i stedet for `PatternPrize`) tolkes som
  `{ mode: "percent", amount: n }` for backward-compat med eventuell
  pre-PR-A data.

### `GameVariantConfig` utvidelse

Legg til `patternsByColor?: Record<string, PatternConfig[]>`. Når satt
tar den presedens over `patterns[]`. Når udefinert beholdes dagens flat-
liste-semantikk.

### `BingoEngine.evaluateActivePhase`

Hver tickets farge (fra `tickets[playerId][ticketIdx].color`) slås opp
i `variantConfig.patternsByColor[color]` for å finne riktig aktivt
pattern. Hvis `patternsByColor` er udefinert, falles det tilbake til
dagens `patterns[]`-path.

Kritisk for multi-farge runder: to spillere med forskjellige farger kan
fullføre samme fase på samme draw, men med forskjellige premier. Engine
må payoute hver vinner fra sin egen farge-matrise.

### `bindVariantConfigForRoom` (ny async i `roomState.ts`)

```ts
async bindVariantConfigForRoom(
  roomCode: string,
  opts: { gameSlug: string; gameManagementId?: string }
): Promise<void>
```

Henter `GameManagement.config.spill1` via `GameManagementService.get(id)`
hvis `gameManagementId` gitt, kjører mapperen, fallback til default
hvis `config.spill1` mangler eller er invalid. Kallsteder (`gameEvents.ts`
+ `admin.ts`) må videresende `gameManagementId` og støtte `await`.

Behold `bindDefaultVariantConfig` som tynn wrapper for tester.

## PR C — Integrasjon + regresjonstester (gjenstår)

- Oppdater `BingoEngine.fivePhase.test.ts` +
  `BingoEngine.splitRoundingLoyalty.test.ts` for eksplisitt per-farge-config
  hvor relevant.
- Nye mapper-tester: per-farge, blandet percent/fixed, legacy-number-fallback,
  default-fallback.
- E2E: `GameManagement`-rad-oppretting → scheduler-spawn (med fallback-
  path) → engine-runtime-evaluation matcher konfigurerte matriser.

## Migrasjonsplan for eksisterende spill

- Eksisterende `GameManagement`-rader uten `config.spill1` → mapperen
  returnerer `DEFAULT_NORSK_BINGO_CONFIG` uendret.
- Rader med legacy-number i `prizePerPattern[phase]` → tolkes som
  `{ mode: "percent", amount: n }`.
- Ingen DB-migrasjon nødvendig (JSONB + additive).
- Admin-UI kan ikke laste eksisterende spill for redigering ennå; når
  edit-path bygges må den også håndtere legacy-form (PR utenfor dette
  scopet).

## Scope utsatt

- **Scheduler-gap** (`Game1ScheduleTickService` leser
  `sg.ticketTypesData`-legacy-format, ikke `config.spill1`) — post-pilot.
- **Popup "fremtidige spill i hall"** — separat feature.
- **Pattern-mask shared-types-canonicalization** — Agent 6 sitt scope,
  rør ikke.

## Åpne spørsmål til PR B

1. Skal `patternsByColor` være strukturert som `Record<colorKey,
   PatternConfig[]>` eller `{ color, patterns }[]` for lettere serialisering?
2. Må klient-visningen (CenterTopPanel prize display) lese per-farge-
   beløp, eller holder det å vise spillerens egen tickets farge-matrise?
3. Hvordan skal multi-ticket-spillere med forskjellige farger se aktivt
   premiebeløp? Ett tall per fase eller en liste?
