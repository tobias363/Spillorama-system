# Porteringsguide: Unity → Web-native (Game 1)

**Sist oppdatert:** 2026-04-16
**Formal:** Dokumentere migrasjonsbeslutninger, feilrettinger og monstre for Game 1 (Databingo/Classic Bingo) — og gi veiledning for Game 2 og Game 3.

---

## Sammendrag: hva ble gjort

| Endring | Beskrivelse |
|---------|-------------|
| `armedPlayerIds` i room:update | Backend sender liste over armede spillere — klient vet hvem som har kjopt |
| `isArmed` pa GameState | GameBridge parser `armedPlayerIds` og setter `isArmed` per spiller |
| 600kr spectator-bug fikset | preRoundTickets brukes ikke lenger som kjopssignal (se bug-seksjon) |
| `StakeCalculator.ts` ekstrahert | Ren, testbar modul med 4 klare regler for innsatsvisning |
| Dobbel armBet fikset | Controller forhindrer duplikat-kall ved rask dobbeltklikk |
| Server-autoritativ `playerStakes` | Backend beregner innsats — klient viser `myStake` direkte |
| Redesignet kjopspopup | `Game1BuyPopup.ts` med 3-kolonne grid (type, antall, pris) |
| Registry race condition fikset | `registryReady` promise i registry.ts — `GameApp.init()` avventer at alle controllere er lastet for `createGame()` |

---

## Arkitekturbeslutninger

### 1. Server-autoritativ innsats

**Beslutning:** Backend beregner `playerStakes` i `buildRoomUpdatePayload()` (roomHelpers.ts). Klienten bruker `myStake` direkte.

**Begrunnelse:** Klienten hadde beregnet innsats basert pa `preRoundTickets.length * entryFee`, men dette er feil fordi backend genererer preRoundTickets for ALLE spillere (ogsa spectators). Serverberegning eliminerer hele denne feilklassen.

**Fallback:** `StakeCalculator.ts` har klient-side beregning som brukes hvis `myStake` er `undefined` (eldre backend). Kan fjernes etter fullstendig utrulling.

### 2. Enveis dataflyt for kjop

```
UI (BuyPopup) → Controller.handleBuy() → socket.armBet() → backend → room:update → GameBridge → UI
```

Ingen lokal state oppdateres for backend bekrefter. Popup skjules forst nar `armBet()` returnerer `ok`.

### 3. Ingen klient-fallback for ticketTypes

Klienten stoler pa at `gameVariant.ticketTypes` alltid kommer i room:update. Hvis arrayen er tom (forste snapshot for backend har konfigurert rom), viser popup **ingenting** — den venter pa at neste `room:update` leverer typene. `showWithTypes()` returnerer tidlig ved tom array. Ingen hardkodede "Standard bingo-brett"-rader genereres pa klienten.

### 4. Isolerte logikkmoduler

All ren logikk er separert fra UI-kode:

| Modul | Fil | Testfil |
|-------|-----|---------|
| StakeCalculator | `logic/StakeCalculator.ts` | `logic/StakeCalculator.test.ts` |
| ClaimDetector | `game2/logic/ClaimDetector.ts` | `game2/logic/ClaimDetector.test.ts` |
| TicketSorter | `game2/logic/TicketSorter.ts` | `game2/logic/TicketSorter.test.ts` |

---

## Bugs funnet og fikset

### 1. 600kr spectator-bug

**Symptom:** Spectators (som ikke hadde kjopt) viste "600 kr" som innsats i LeftInfoPanel.

**Arsak:** Koden brukte `preRoundTickets.length > 0` som indikator pa at spilleren hadde kjopt. Men backend genererer `preRoundTickets` for ALLE spillere i rommet — ogsa de som bare ser pa. En spectator med 30 auto-genererte tickets viste `30 * 20 = 600 kr`.

**Fix:**
- Introdusert `isArmed` (fra `armedPlayerIds` i room:update)
- StakeCalculator regel 4: mellom runder + ikke armet → vis ingenting
- `preRoundTickets` brukes kun for a tegne brett pa skjermen, aldri for pengeberegning

**Laerepunkt:** `preRoundTickets` er "display-tickets" — de er IKKE et kjopssignal.

### 2. Stale preRoundTickets

**Symptom:** Etter at en spiller forlot og kom tilbake, kunne `preRoundTickets` vaere `undefined` og krasje `.length`-kall.

**Fix:** Alltid bruk nullish coalescing:

```typescript
// Riktig:
const tickets = state.preRoundTickets ?? [];

// Feil:
const tickets = state.preRoundTickets; // kan vaere undefined!
```

### 3. Dobbel armBet

**Symptom:** Hvert kjop sendte to `bet:arm` kall til backend.

**Arsak:** PlayScreen sin `buyPopup.setOnBuy()` kalte `socket.armBet()` direkte, OG Controller sin `handleBuy()` kalte ogsa `socket.armBet()`. Begge ble utfort per kjop.

**Fix:** Fjernet `socket.armBet()` fra PlayScreen. Popup signalerer kun `onBuy()` til Controller. Controller eier nettverkskallet og rapporterer resultatet tilbake via `playScreen.showBuyPopupResult(ok, error)`.

### 4. Fallback-popup med "Standard bingo-brett"

**Symptom:** Popupen viste en hardkodet "Standard bingo-brett — 20 kr/brett" rad nar ticketTypes ikke var lastet ennå.

**Arsak:** `showWithTypes(fee, [])` hadde en fallback som genererte en klient-side type. `show(fee)` var en wrapper som passerte tom array → triggret fallback.

**Fix:** Fjernet `show()` metoden helt. `showWithTypes()` returnerer tidlig hvis `ticketTypes.length === 0`. `updateWaitingState()` viser popup automatisk nar types ankommer i neste `room:update`. Ingen klient-genererte bongtyper vises noensinne.

---

## Monstre som fungerer

### GameBridge som state-kilde

```typescript
// Riktig: les alltid fra bridge
const state = bridge.getState();
this.playScreen.updateInfo(state);

// Feil: lagre kopi av state og bruk stale data
this.cachedState = state; // Ikke gjor dette
```

`GameBridge` er den eneste kilden til sannhet pa klientsiden. Alle komponenter mottar state som parameter — de lagrer aldri sin egen kopi.

### Controller eier nettverk

```typescript
// Riktig: Controller kaller socket og rapporterer til popup
class Game1Controller {
  async handleBuy() {
    const result = await this.deps.socket.armBet({ ... });
    this.playScreen?.showBuyPopupResult(result.ok, result.error?.message);
  }
}

// Feil: UI-komponent kaller socket direkte
class BuyPopup {
  onBuyClick() { socket.armBet({ ... }); } // Nei!
}
```

Kun `Game1Controller` har tilgang til `socket`. UI-komponenter melder tilbake via callbacks (`setOnBuy`, `setOnClaim`, etc.).

### Isolerte pure functions

```typescript
// StakeCalculator er testbar uten PixiJS/DOM
import { calculateStake } from "./StakeCalculator.js";
const result = calculateStake({ myStake: 42, ... });
expect(result).toBe(42);
```

### Nullish coalescing pa payload-felter

```typescript
// Alltid bruk ?? for payload-felter som kan mangle
const tickets = payload.preRoundTickets?.[myId] ?? [];
const isArmed = payload.armedPlayerIds?.includes(myId) ?? false;
const myStake = payload.playerStakes?.[myId] ?? 0;
```

### Vent pa backend-data

```typescript
// Riktig: vent pa room:update for du viser data
bridge.on("stateChanged", (state) => {
  this.playScreen.updateInfo(state);
});

// Feil: vis data umiddelbart etter armBet
const result = await socket.armBet({ ... });
this.showStake(estimatedAmount); // State er ikke oppdatert enna!
```

---

## Fallgruver

### 1. preRoundTickets betyr ikke "kjopt"

Backend genererer `preRoundTickets` for ALLE spillere uten game-tickets. Dette er for visning av brett pa skjermen. Sjekk `isArmed` for a vite om spilleren har kjopt.

### 2. `window` er undefined i tester

`Game1BuyPopup`, `HtmlOverlayManager` og andre DOM-komponenter krasjer i unit-tester fordi `window` og `document` ikke finnes i Node.

**Losning:** Bruk `vitest` med `jsdom` environment, eller mock overlay-laget:

```typescript
// vitest.config.ts
export default {
  test: {
    environment: "jsdom", // For DOM-avhengige tester
  },
};
```

For rene logikk-tester (StakeCalculator, ClaimDetector) er dette unodvendig — de har ingen DOM-avhengigheter.

### 3. ticketTypes tom i forste snapshot

Forste `room:update` etter connect kan ha tom `ticketTypes` hvis backend-konfigurasjonen ikke er lastet. **Ikke generer fallback-typer pa klienten.** Vis ingenting og vent pa neste `room:update`:

```typescript
// Riktig: showWithTypes returnerer tidlig ved tom array
this.buyPopup?.showWithTypes(state.entryFee, state.ticketTypes ?? []);

// Feil: generer klient-side fallback
const types = state.ticketTypes.length > 0
  ? state.ticketTypes
  : [{ name: "Standard", ... }]; // NEI — dette kan vise feil pris/type
```

### 4. gameStatus "NONE" vs "WAITING" vs "ENDED"

Alle tre betyr "ingen aktiv runde". StakeCalculator behandler alt som ikke er `"RUNNING"` likt. Ikke anta at en spesifikk status brukes mellom runder.

---

## Steg-for-steg: koble et spill til backend

### Steg 1: Opprett Controller

Lag `GameXController.ts` som implementerer `GameController` interfacet:

```typescript
import type { GameDeps, GameController } from "../registry.js";
import { registerGame } from "../registry.js";

class GameXController implements GameController {
  constructor(private deps: GameDeps) {}
  async start(): Promise<void> { /* ... */ }
  resize(w: number, h: number): void { /* ... */ }
  destroy(): void { /* ... */ }
}

registerGame("game_x", (deps) => new GameXController(deps));
```

### Steg 2: Koble socket og bridge

```typescript
async start() {
  const { socket, bridge } = this.deps;
  socket.connect();
  // Vent pa tilkobling...
  const joinResult = await socket.createRoom({ hallId, gameSlug: "game_x" });
  bridge.start(joinResult.data.playerId);
  bridge.applySnapshot(joinResult.data.snapshot);
}
```

### Steg 3: Lytt pa bridge-events

```typescript
bridge.on("stateChanged", (state) => this.onStateChanged(state));
bridge.on("gameStarted", (state) => this.onGameStarted(state));
bridge.on("gameEnded", (state) => this.onGameEnded(state));
bridge.on("numberDrawn", (num, idx, state) => this.onNumberDrawn(num, idx, state));
bridge.on("patternWon", (result, state) => this.onPatternWon(result, state));
```

### Steg 4: Implementer kjopsflyt

```typescript
async handleBuy() {
  const result = await this.deps.socket.armBet({ roomCode, armed: true });
  if (result.ok) { /* skjul popup, vent pa room:update */ }
}
```

### Steg 5: Implementer claim

```typescript
async handleClaim(type: "LINE" | "BINGO") {
  await this.deps.socket.submitClaim({ roomCode, type });
}
```

### Steg 6: Bruk StakeCalculator for innsatsvisning

```typescript
import { stakeFromState } from "../game1/logic/StakeCalculator.js";
const stake = stakeFromState(state);
// stake = 0 betyr "vis ingenting"
```

---

## Sjekkliste: Game 2 og Game 3

### Game 2 (Rocket Bingo)

| Oppgave | Status | Merknad |
|---------|--------|---------|
| Controller med state machine | Ferdig | `Game2Controller.ts` |
| Socket-integrasjon (join, arm, claim) | Ferdig | Bruker samme socket-lag |
| GameBridge-parsing | Ferdig | Delt med Game 1 |
| StakeCalculator-integrering | Mangler | Bruk `stakeFromState()` |
| Server-autoritativ `myStake` visning | Mangler | Les fra `state.myStake`, ikke beregn selv |
| 3x5 ticket grids | Ferdig | `TicketCard.ts` med gridSize-config |
| LINE/BINGO claim-deteksjon | Ferdig | `ClaimDetector.ts` |
| LobbyScreen | Ferdig | Gjenbrukes av Game 1 |
| EndScreen | Ferdig | Gjenbrukes av Game 1 |
| HTML BuyPopup (erstatt PixiJS) | Mangler | Port fra `Game1BuyPopup.ts` med 3x5-visning |
| Nullish coalescing audit | Mangler | Sjekk alle payload-felter |

### Game 3 (Animated Bingo)

| Oppgave | Status | Merknad |
|---------|--------|---------|
| Controller med state machine | Delvis | `Game3Controller.ts` eksisterer |
| Socket-integrasjon | Delvis | Kobler seg til, men mangler full arm/claim |
| AnimatedBallQueue | Ferdig | `components/AnimatedBallQueue.ts` |
| PlayScreen | Delvis | `screens/PlayScreen.ts` — mangler claim-UI |
| StakeCalculator-integrering | Mangler | Bruk `stakeFromState()` |
| Server-autoritativ `myStake` | Mangler | Samme som Game 2 |
| BuyPopup | Mangler | Kan gjenbruke Game1BuyPopup |
| LobbyScreen/EndScreen | Mangler | Gjenbruk fra Game 2 |
| Nullish coalescing audit | Mangler | Sjekk alle payload-felter |

---

## Testoppsett

### Kjor StakeCalculator-tester

```bash
cd packages/game-client
npx vitest run src/games/game1/logic/StakeCalculator.test.ts
```

### Kjor alle logikk-tester

```bash
npx vitest run src/games/**/logic/*.test.ts
```

### Kjor med watch-modus

```bash
npx vitest watch src/games/game1/logic/
```

### Manuell testing i nettleser

```bash
# Start backend (port 4000)
cd backend && npm run dev

# Start game-client dev server (port 5173)
cd packages/game-client && npx vite --host
```

Apne i nettleser:

```
http://localhost:5173/?game=bingo     # Spill 1 (Classic Bingo)
http://localhost:5173/?game=rocket    # Spill 2 (Rocket Bingo)
http://localhost:5173/?game=monster   # Spill 3 (Monsterbingo)

# Velg hall (default: notodden):
http://localhost:5173/?game=bingo&hall=skien
```

---

## Filendrings-oversikt

### Nye filer (Game 1 portering)

| Fil | Formal |
|-----|--------|
| `games/game1/logic/StakeCalculator.ts` | Ren innsatsberegning med server-autoritativ + fallback |
| `games/game1/logic/StakeCalculator.test.ts` | Fulldekkende tester (27 caser) |
| `games/game1/components/Game1BuyPopup.ts` | HTML-basert kjopspopup med 3-kolonne grid |
| `games/game1/components/HtmlOverlayManager.ts` | Felles HTML overlay-lag for popups og panels |
| `games/game1/components/LeftInfoPanel.ts` | Venstre infopanel (innsats, pott, spillere) |
| `games/game1/components/CenterTopPanel.ts` | Sentrum toppanel |
| `games/game1/components/ChatPanel.ts` | Sanntids chat |
| `games/game1/components/ChatPanelV2.ts` | Forbedret chat |
| `games/game1/components/SettingsPanel.ts` | Innstillingspanel |
| `games/game1/components/PauseOverlay.ts` | Pause-overlay (BIN-460) |
| `games/game1/components/ToastNotification.ts` | Toast-meldinger |
| `games/game1/components/LoadingOverlay.ts` | Lasteskjerm |

### Endrede backend-filer

| Fil | Endring |
|-----|---------|
| `backend/src/util/roomHelpers.ts` | Lagt til `playerStakes`, `armedPlayerIds`, `gameVariant` i payload |
| `backend/src/util/roomState.ts` | Lagt til `armedPlayerIdsByRoom` Map |
| `backend/src/sockets/gameEvents.ts` | Lagt til `bet:arm` handler, sender armedPlayerIds i room:update |
| `backend/src/game/BingoEngine.ts` | `startGame()` aksepterer `armedPlayerIds` parameter |

### Endrede frontend-filer

| Fil | Endring |
|-----|---------|
| `bridge/GameBridge.ts` | Parser `armedPlayerIds`, `playerStakes` → `isArmed`, `myStake` pa GameState |
| `games/game1/Game1Controller.ts` | Auto-arm, handleBuy/handleClaim/handleCancelTickets |
| `games/registry.ts` | Registrerer "bingo" og "game_1" slugs |

---

## Referanser

- **Unity-kilde:** `Game1GamePlayPanel.SocketFlow.cs`, `Game1TicketPurchasePanel.cs`
- **Backend-motor:** `backend/src/game/BingoEngine.ts`
- **Logikk-dokumentasjon:** `games/game1/logic/README.md`
- **Game 1 README:** `games/game1/README.md`
