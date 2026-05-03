# Game 3 — Mønsterbingo / Monster Bingo (Web-implementasjon)

**Status:** Spill 1-paritet. Bruker Game 1 frontend 1:1 — kun ÉN ticket-type ("Standard").
**Dato:** 2026-05-03 (siste revisjon: clone-game1-frontend per Tobias-direktiv)

> **Autoritativ spesifikasjon:** [`docs/engineering/game3-canonical-spec.md`](../../../../../docs/engineering/game3-canonical-spec.md) (BIN-530).
> Ved motsigelser vinner canonical spec.

## Tobias-direktiv 2026-05-03

> "75 baller og 5x5 bonger uten free i midten. Så det du kan gjøre her er å duplisere
> spill 1 så kan vi endre når det er gjort. Alt av design skal være likt bare at her
> er det kun 1 type bonger og man spiller om mønstre. Logikken med å trekke baller
> og markere bonger er fortsatt helt lik."

## Hva er implementert

`Game3Controller` orkestrerer samme PlayScreen-stack som Spill 1. All visuell
design, layout, ball-tube, ring, lykketall, chat, bong-grid, win-popup,
fullt-hus-scene og end-of-round-overlay er identisk.

### Filer

```
packages/game-client/src/games/game3/
├── Game3Controller.ts   # Tynn controller — gjenbruker game1/* via direkte import
├── README.md            # ← denne filen
```

Ingen egne `screens/` eller `components/` lenger — alt kommer fra
`packages/game-client/src/games/game1/`.

### Game 1-komponenter brukt direkte

Importert i `Game3Controller.ts`:

- `screens/PlayScreen.ts` — fullskjerm spill-UI (ball-tube + ring + grid + chat)
- `components/LuckyNumberPicker.ts`
- `components/ToastNotification.ts`
- `components/PauseOverlay.ts`
- `components/WinPopup.ts` — Fase 1-4 vinn-popup
- `components/WinScreenV2.ts` — Fullt Hus fullskjerm-scene
- `components/Game1EndOfRoundOverlay.ts`
- `components/SettingsPanel.ts`
- `components/MarkerBackgroundPanel.ts`
- `components/GamePlanPanel.ts`
- `logic/SocketActions.ts` (`Game1SocketActions`)
- `logic/ReconnectFlow.ts` (`Game1ReconnectFlow`)
- `logic/Phase.ts` (Phase-type)

### Forskjeller fra Spill 1 (Game1Controller)

| Aspekt | Game 1 | Game 3 |
|--------|--------|--------|
| Backend slug | `bingo` | `monsterbingo` |
| Ticket-typer | 8 farger (yellow / white / purple / red / green / orange / blue / etc.) | 1 type (`Standard`, type `monsterbingo-5x5`) |
| Free center | Ja | Nei (5×5 uten fri sentercelle) |
| Patterns | "1 Rad" / "2 Rader" / ... / "Fullt Hus" | "Row 1"-"Row 4" + "Full House" |
| Pattern-eval | `auto-claim-on-draw` (Spill 1 phase-modell) | `auto-claim-on-draw` (Game3Engine cycler) |
| Mini-games | Wheel / Chest / Mystery / ColorDraft / Oddsen | **Ingen** |
| Lucky number | Ja | Ja (samme bonus-mekanikk via Game3Engine.payG3PatternShare) |

### Hva som IKKE er koblet inn

Per Tobias-direktiv 2026-05-03 omhandler Spill 3 kun "trekke baller og markere
bonger" — derfor er følgende **bevisst utelatt**:

- `MiniGameRouter` og `LegacyMiniGameAdapter`
- Subscriptions på `miniGameTrigger` / `miniGameResult` / `legacyMinigameActivated`
  (DEFAULT_GAME3_CONFIG har ingen mini-games — backend fyrer aldri disse for
  Spill 3-rom uansett, men vi sparer overlay-konstruksjon)

### Pattern-navn UI

CenterTopPanel mapper "Row N" → "Rad N" automatisk via `displayNameFor`,
og `classifyPhaseFromPatternName` (i shared-types/spill1-patterns) godtar
både norske og engelske pattern-navn. Ingen ekstra mapping kreves i
Game3Controller for win-popup-rad-tall.

### Backend-integrasjon

Identisk grensesnitt med Spill 1 — `room:update` snapshot driver
`state.patternResults` og `state.patterns`. Server-side `g3:pattern:*`-events
(emittert av `apps/backend/src/sockets/gameEvents/drawEmits.ts`) brukes ikke
av denne klienten — visuell paritet med Spill 1 er prioritert via det
generiske `pattern:won`-eventet som Game3Engine fortsatt fyrer fra
`super.onDrawCompleted` → `evaluateActivePhase`-pathen.

### Asset-paths

Game 3 gjenbruker `/web/games/assets/game1/*` via Game1-komponentene.
Ingen egne `/games/assets/game3/...`-filer kreves for visuell paritet.
Hvis Tobias senere vil ha egen palett, kan en game3-spesifikk
preloadGameAssets-entry legges til.

### Testing

```
http://localhost:4000/web/?webClient=game_3
```
