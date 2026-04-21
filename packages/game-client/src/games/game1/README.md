# Game 1 — Norsk 75-ball Bingo

**Status:** 3-fase implementasjon (BIN-694, 2026-04-20) — 5×5 grids, chat, auto-claim
**Dato:** 2026-04-20 (utvidet fra MVP 2026-04-14)

> **Autoritativ spesifikasjon:** [`docs/engineering/game1-canonical-spec.md`](../../../../../docs/engineering/game1-canonical-spec.md) (BIN-528).
> Denne README-filen er en teknisk oversikt over koden her; ved motsigelser vinner canonical spec.
>
> Statusrapport per 2026-04-16 er arkivert til [`docs/archive/GAME1_STATUSRAPPORT-2026-04-16.md`](../../../../../docs/archive/GAME1_STATUSRAPPORT-2026-04-16.md).

## Komplette spilleregler (norsk 75-ball bingo)

*Kilde: prosjektleder-spec 2026-04-20. Ved uklarhet i koden, legg regelverket under til grunn.*

### 1. Brett-struktur

Hvert brett er et 5×5-rutenett (25 felt totalt) med 5 kolonner markert **B-I-N-G-O**:

| Kolonne | B | I | N | G | O |
|---------|---|---|---|---|---|
| Tall    | 1–15 | 16–30 | 31–45 | 46–60 | 61–75 |

- Midterste feltet (rad 3, kolonne 3) er et **gratis felt** — alltid merket fra start. Representert som `grid[2][2] === 0`.
- Tall i hver kolonne er **unike og sortert stigende**.
- Hele nummerserien består av **75 unike tall (1–75)**. Ingen tall gjentas.

### 2. Trekning

- Alle 75 tall blandes i tilfeldig rekkefølge ved rundestart (server-autoritativ `drawBag`).
- Ett tall trekkes om gangen. Trukne tall legges i `drawnNumbers`-listen og kan aldri trekkes på nytt.
- Trekningen fortsetter **til Fullt Hus er vunnet** — ingen pauser mellom fasene.
- Trekningen kan stoppes manuelt av hall-admin (f.eks. for fysisk bong-verifisering — `engine.pauseGame`).

### 3. Merking

- Server evaluerer vinner-status basert på `game.drawnNumbers` (autoritativ).
- Klient auto-merker på sin UI når `draw:new`-event mottas.
- Gratis-feltet (`grid[2][2] === 0`) teller alltid som merket.

### 4. Linjer (10 mulige per brett)

En "linje" = 5 merket felt på rad. Det finnes **nøyaktig 10 mulige linjer**:

- 5 horisontale rader (row 0, 1, 2, 3, 4)
- 5 vertikale kolonner (col 0, 1, 2, 3, 4)

**Ingen diagonaler teller** i noen fase. Implementasjon: `countCompleteRows` + `countCompleteColumns` i `apps/backend/src/game/ticket.ts`.

### 5. Faser (5 sekvensielle, én runde)

| Fase | Pattern-navn | Krav | Premie (default) |
|------|--------------|------|------------------|
| 1 | "1 Rad" | **≥ 1 hel horisontal rad ELLER ≥ 1 hel vertikal kolonne** | 15 % |
| 2 | "2 Rader" | ≥ 2 hele **vertikale** kolonner (kun loddrett) | 15 % |
| 3 | "3 Rader" | ≥ 3 hele **vertikale** kolonner | 15 % |
| 4 | "4 Rader" | ≥ 4 hele **vertikale** kolonner | 15 % |
| 5 | "Fullt Hus" | Alle 25 felt merket | 40 % |

**Viktig terminologi:** "Rad N" i fase-navnene betyr **N hele vertikale kolonner**, ikke N horisontale rader. Fase 1 er den eneste fasen som godtar en horisontal rad. Premie-prosenter er overstyrbare per hall via `hall_game_schedules.variant_config` JSONB.

### 6. Gevinst-evaluering (auto-claim on draw)

Etter hver trukket ball kjører serveren `evaluateActivePhase(room, game)`:

1. Finn første uvunnede pattern i `game.patternResults` (aktiv fase)
2. Gå gjennom alle spillernes brett — identifisér de som oppfyller aktiv fase via `meetsPhaseRequirement`:
   - Fase 1 ("1 Rad"): `countCompleteRows >= 1 || countCompleteColumns >= 1`
   - Fase 2-4 ("2/3/4 Rader"): `countCompleteColumns >= N`
   - Fase 5 ("Fullt Hus"): `hasFullBingo`
3. Hvis én eller flere vinnere:
   - **Multi-winner-split**: `prizePerWinner = floor(totalPhasePrize / winnerCount)`
   - Utbetaling per vinner via `payoutPhaseWinner` (wallet + compliance + ledger + audit)
   - Marker patternResult som `isWon: true`
   - Emit `pattern:won`-event til rommet
4. Hvis Fullt Hus ble vunnet → `game.status = "ENDED"`, ellers fortsett trekning.
5. Rekursivt sjekk neste fase (sjelden edge case der samme ball vinner to faser samtidig).

### 7. Hybride haller (fysiske + digitale bonger)

- **Digitale bonger** evalueres automatisk server-side (auto-claim).
- **Fysiske bonger** roper "Bingo!" → bingovert pauser med `engine.pauseGame(roomCode, message)` → verifiserer manuelt → resumer.
- Bong-nummer-register for fysiske kjøp: **Planlagt (BIN-695)**, ikke i scope for BIN-694.

### 8. Edge cases

- **Samtidige vinnere**: 4 spillere får sin 1. linje ved ball 9 → premien for fase 1 deles likt mellom dem (evt. med rest som tilfaller neste fase via floor-div).
- **Ett brett flere linjer**: Et brett kan ha 3 linjer på fase 1 — vinner likevel kun fase 1. Tilleggs-linjene teller for fase 2.
- **Tidlig Fullt Hus**: Rare edge-case hvor fase 1 + 2 + 3 vinnes samtidig; engine håndterer rekursivt via `evaluateActivePhase`.
- **Gratis-feltet**: Aldri umerket — teller som merket i alle linje-beregninger.

### 9. Nøkkel-kodestier

| Lag | Fil | Ansvar |
|-----|-----|--------|
| Variant-config | `apps/backend/src/game/variantConfig.ts` | `DEFAULT_NORSK_BINGO_CONFIG` (3-fase) |
| Linje-telling | `apps/backend/src/game/ticket.ts:countCompleteLines` | Teller 12 linjer per brett |
| Auto-claim | `apps/backend/src/game/BingoEngine.ts:evaluateActivePhase` | Fase-evaluering etter hver ball |
| Premie-utbetaling | `apps/backend/src/game/BingoEngine.ts:payoutPhaseWinner` | Multi-winner split + ledger/audit |
| Wire-emit | `apps/backend/src/sockets/gameEvents.ts:draw:next` | `pattern:won`-broadcast |
| Klient-visning | `packages/game-client/src/games/game1/components/CenterTopPanel.ts` | Viser aktiv fase + progresjon |

## Hva er implementert

### Fullstendig gameplay-loop (gjenbruk fra Game 2)
1. **Lobby** → joiner rom, ser spillerantall og nedtelling
2. **Billett-kjøp** → per-type valg i pop-up, *ingen* auto-arm — spilleren må eksplisitt kjøpe hver runde (`Game1Controller.ts:156`)
3. **Nedtelling** → GSAP-animert countdown MM:SS
4. **Gameplay** → 5x5 billettkort med fri sentercelle, numre markeres i sanntid
5. **Claim** → LINE/BINGO deteksjon → server-validering
6. **Chat** → sanntids chat-panel (høyreside)
7. **Game end** → resultatskjerm → automatisk loop tilbake til lobby

### Forskjeller fra Game 2

| Aspekt | Game 2 (Rocket) | Game 1 (Classic) |
|--------|-----------------|------------------|
| Grid | 3x5 (15 celler) | 5x5 (25 celler, sentercelle fri) |
| Chat | Ingen | Sanntids chat-panel (høyreside) |
| Mini-spill | Ingen | ✅ Lykkehjul + Skattekiste (veksler, server-styrt) |
| Mønstervisualisering | Ingen | Utsatt (5 Unity design-typer er UI-only) |

### Filer

```
packages/game-client/src/games/game1/
├── Game1Controller.ts          # State machine, mini-game routing, gjenbruker Game 2-arkitektur
├── README.md                   # ← denne filen
├── screens/
│   ├── PlayScreen.ts           # 5x5 grids + chat-panel + claim-knapper
│   ├── LobbyScreen.ts          # → gjenbruker Game 2 LobbyScreen direkte
│   └── EndScreen.ts            # → gjenbruker Game 2 EndScreen direkte
└── components/
    ├── ChatPanel.ts            # Sanntids chat med meldingshistorikk
    ├── WheelOverlay.ts         # Lykkehjul mini-game (8 segmenter, GSAP spin)
    └── TreasureChestOverlay.ts # Skattekiste mini-game (N kister, server-styrt)
```

### Gjenbruk fra Game 2

Følgende filer importeres direkte fra `games/game2/`:
- `screens/LobbyScreen.ts` — identisk lobby-flow
- `screens/EndScreen.ts` — identisk resultatvisning
- `components/TicketCard.ts` — nå konfigurerbar gridSize (3x5 eller 5x5)
- `components/TicketScroller.ts`, `DrawnBallsPanel.ts`, `ClaimButton.ts`, `PlayerInfoBar.ts`
- `components/BuyPopup.ts`, `LuckyNumberPicker.ts`, `CountdownTimer.ts`
- `logic/ClaimDetector.ts` — LINE/BINGO fungerer på 5x5 (rader=5 celler, kolonner=5 celler)
- `logic/TicketSorter.ts`

### Backend-integrasjon

Identisk med Game 2, pluss chat:

| Socket event | Retning | Brukt til |
|---|---|---|
| `room:create` | client→server | Joine rom med `gameSlug: "bingo"` |
| `bet:arm` | client→server | Kjøpe billetter |
| `chat:send` | client→server | Sende chat-melding |
| `chat:history` | client→server | Hente meldingshistorikk |
| `room:update` | server→client | Full spillstatus |
| `draw:new` | server→client | Nytt trukket tall |
| `pattern:won` | server→client | Mønster vunnet |
| `chat:message` | server→client | Ny chat-melding |
| `minigame:activated` | server→client | Mini-spill aktivert etter BINGO (lykkehjul/skattekiste) |
| `minigame:play` | client→server | Spill mini-game (selectedIndex for skattekiste) |

### Kjente begrensninger (MVP)

- ~~**Mini-spill utsatt**~~ — ✅ Lykkehjul og skattekiste er fullstendig implementert (backend + frontend)
- **Mønstervisualisering utsatt** — De 5 Unity design-typene (rad, 2-rader, 3-rader, etc.) er UI-only, ikke claim-logikk
- **3 billettyper utsatt** — Farge/trafikklys/elvis-varianter er visuell styling
- **Chat bruker HTML overlay input** — Fungerer, men posisjonering kan forbedres ved resize
- **Visuell polish mangler** — Placeholder-grafikk
- **Per-farge-gevinster (PR A landet)** — Admin kan nå konfigurere percent eller fast-kr gevinst per (farge, fase) i admin-UI Spill 1-form.
  Runtime-koblingen til engine er _ennå ikke aktiv_ — alle rom kjører på
  `DEFAULT_NORSK_BINGO_CONFIG` (100/200/200/200/1000 kr fast) inntil
  PR B lander med `buildVariantConfigFromSpill1Config`-mapper + per-farge
  `BingoEngine.evaluateActivePhase`-oppslag. Se `docs/architecture/spill1-variantconfig-admin-coupling.md`.

### Testing

```
http://localhost:4000/web/?webClient=game_1
```
Klikk Bingo. Feature flag matcher via `gameNumber: 1`.

For å teste begge spill samtidig:
```
http://localhost:4000/web/?webClient=all
```

### Teknisk stack

Identisk med Game 2: PixiJS 8 + GSAP 3 + socket.io-client 4 + TypeScript
