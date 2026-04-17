# Spill 1 — Komplett Unity-portering til web-native

> **Status:** ~55 av ~100 issues implementert og committed (2026-04-15)
> **Linear:** [Spill 1 — Komplett Unity-portering](https://linear.app/bingosystem/project/spill-1-komplett-unity-portering-889ee436aba1)
> **Scope:** 17 epics, ~100 issues — 55 Done, ~15 gjenstår (lyd-assets, admin-UI, E2E-verifisering)
> **Team:** Bingosystem (BIN)
> **Lead:** Tobias Haugen
> **Commits:** 15 commits på feat/seed-halls branch

---

## 1. Bakgrunn

Vi migrerer Game 1 (Spill 1) fra Unity WebGL til web-native (PixiJS + GSAP + TypeScript). Backend (Spillorama) forblir uendret for spillogikk, men må utvides med spillvariant- og bongfarge-system som eksisterer i det gamle AIS-backend men aldri ble portet.

### Tre kodelag

| Lag | Teknologi | Rolle |
|-----|-----------|-------|
| **Backend (Spillorama)** | Node.js, TypeScript, PostgreSQL, Socket.IO | Spillmotor, wallet, compliance |
| **Unity-klient** | C#, Unity WebGL | Nåværende spillklient (source-of-truth for UX) |
| **Web shell (ny)** | PixiJS, GSAP, TypeScript | Ny spillklient som skal erstatte Unity |

### Hva finnes i web shell i dag

- Game1Controller med state machine (LOADING → WAITING → PLAYING → ENDED)
- PlayScreen med ticket rendering (PixiJS BingoGrid + BingoCell)
- 7 fargetemaer i `TicketColorThemes.ts` (index-basert cycling — **feil**)
- WheelOverlay + TreasureChestOverlay (2 av 4 mini-spill)
- BallTube, CenterBall, LeftInfoPanel, ChatPanelV2
- Socket-integrasjon via GameBridge
- Claim-knapper (LINE + BINGO)
- Ticket overlay (fullskjerm-visning)
- Auto-arm ved room join

---

## 2. Kritiske gap

### Urgent (må fikses først)

| Gap | Beskrivelse | Impact |
|-----|-------------|--------|
| **Farge-mapping feil** | Web shell bruker index-cycling, Unity bruker navnbaserte farger fra backend | Bonger viser feil farge |
| **Spillvariant-system mangler** | Backend har ingen gameType, ticketTypes, eller farge-tilordning | Alle varianter (Elvis, Traffic Light) er umulige |
| **Bongfarge fra backend mangler** | `Ticket`-typen har kun `grid: number[][]`, ingen `color` | Klient kan ikke vite hvilken farge en bong skal ha |
| **Kjøp-flyter mangler** | Forhåndskjøp, kjøp flere brett, ticket types med priser | Spillere kan ikke kjøpe bonger korrekt |
| **Gevinstfordeling hardkodet** | Kun 2 patterns (LINE 30% + BINGO 70%), skal være konfigurerbart per variant | Feil gevinster |

### High (kjerneopplevelse)

| Gap | Beskrivelse |
|-----|-------------|
| One-to-go blink-animasjon | Manglende celle blinker ikke, best-card-first sortering mangler |
| Pattern-animasjoner | Ingen 5x5 mini-grid med cycling row-highlights |
| Lucky number picker UI | Highlighting fungerer, men ingen velger-popup |
| Slett bong-knapp | Kan ikke slette/avbestille bonger før spill |
| Game pause/resume | Ingen håndtering av admin-pause |
| Spillovergang | Ufullstendig reset-sekvens mellom runder |

---

## 3. Arkitektur — Spillvariant-flyt (port fra AIS)

Hele denne flyten mangler i Spillorama og må bygges fra scratch.

### Steg-for-steg (slik det fungerer i det gamle Unity-systemet)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   1. Admin   │────▶│  2. Backend  │────▶│  3. Klient   │
│  konfigurerer│     │    sender    │     │   viser      │
│  spillvariant│     │  gameType +  │     │   kjøp-UI    │
│  + bongtyper │     │  ticketTypes │     │   basert på  │
│  + priser    │     │  til klient  │     │   variant    │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                     ┌──────────────┐     ┌───────▼───────┐
                     │  5. Klient   │◀────│  4. Backend   │
                     │   rendrer    │     │   tilordner   │
                     │   bonger med │     │   farge +     │
                     │   korrekt    │     │   genererer   │
                     │   farge +    │     │   bonger ved  │
                     │   gruppering │     │   kjøp        │
                     └──────────────┘     └───────────────┘
```

### Spillvarianter

| Variant | gameType | Bongtyper | Multiplikator | Pris |
|---------|----------|-----------|---------------|------|
| **Standard** | `"color"` | Small White/Yellow/Purple/Blue | 1x | entryFee |
| **Standard Large** | `"color"` | Large White/Yellow/Purple/Blue | **3x** | entryFee × 3 |
| **Traffic Light** | `"traffic-light"` | Red + Yellow + Green (3-gruppe) | **3x** | entryFee × 3 |
| **Elvis** | `"elvis"` | Elvis 1-5 (2-gruppe) | **2x** | entryFee × 2 |

### Weight-system

Maks 30 bonger per spiller (etter multiplikator):

```
Spiller kjøper 5 stk "Large Yellow" (weight=3):
  → 5 × 3 = 15 bonger generert
  → 30 - 15 = 15 slots igjen
  → Kan kjøpe maks 5 Large til (5×3=15) eller 15 Small (15×1=15)
```

---

## 4. Gevinstfordeling (patterns)

### Nåværende Spillorama (hardkodet)

```typescript
// BingoEngine.ts — KUN 2 patterns
{ id: "1-rad", claimType: "LINE", prizePercent: 30 }
{ id: "full-plate", claimType: "BINGO", prizePercent: 70 }
```

### Gammel AIS (konfigurerbart per variant)

Admin konfigurerer aktive mønster og gevinst per mønster:

| Mønster | patternDesign | Eksempel gevinst |
|---------|--------------|------------------|
| Row 1 | 1 (cycling rows) | 100 kr |
| Row 2 | 2 (cycling 2-rows) | 100 kr |
| Row 3 | 3 (cycling 3-rows) | 100 kr |
| Row 4 | 4 (cycling 4-rows) | 100 kr |
| Picture | 0 (3×3 inner grid mask) | 200 kr |
| Frame | 0 (outer border mask) | 300 kr |
| Full House | 0 (alle celler) | 500 kr |

### Gevinstberegning varierer per spillvariant

| Variant | Beregning |
|---------|-----------|
| Standard | Fast beløp fra admin-config |
| Spillerness Spill | % av totalinnsats med minimumbeløp |
| Innsatsen | Akkumulerer over spill, maks 2000 kr |
| Jackpot/Oddsen | Jackpot ved spesifikt trekknummer |

---

## 5. Fargesystem

### Unity — 6 navnbaserte farger + Elvis

```csharp
// SpilloramaGameBridge.cs — hardkodet cycling
string[] gridColors = { 
  "Small Yellow", "Small White", "Small Purple", 
  "Small Red", "Small Green", "Small Orange" 
};
```

Farger slås opp i `TicketColorManager.Get_Ticket_Color(string)`:
- `Tickets_Color` struct: `{ name, BG_Color, Block_Color, Large_BG_Color }`
- `One_to_go_Color` — spesialfarge for "nesten vunnet"

### Web shell — 7 temaer (estimerte verdier)

```typescript
// TicketColorThemes.ts — MÅ verifiseres mot Unity inspector
TICKET_THEMES = [default, yellow, white, purple, blue, red, green]
```

### Hva må gjøres

1. Ekstraher faktiske RGBA-verdier fra Unity prefab via CoPlay
2. Map navnbaserte farger til web shell-temaer
3. Endre fra index-cycling til navnbasert lookup
4. Legge til Elvis-fargetema

---

## 6. Bong-markering og One-to-go

### Markering ved trekk

```
Ball trukket → MarkWithdrawNumbers(ball)
  → For hver bong: ticket.MarkNewWithdrawNumber(number)
    → Finn matching celle
    → HighlightNormalNumber() med markør-sprite + farge
    → Start blink: GSAP scale(1.5x, 1s, punch, loop)
  → Set_Togo_Txt_Game1() per bong
    → Beregn Pattern_Remaining_Cell_Count
    → Hvis count == 1: aktiver one-to-go blink + farge
    → Hvis count == 0: Stop_Blink() på alle bonger
  → RunBestCardFirstAction() — sorter best card first
```

### Markør-tilpasning

- 6 markør-stiler (`TicketMarkerCellData`: sprite + bakgrunnsfarge + tekstfarge)
- Lagres i PlayerPrefs/LocalStorage
- Byttes via `ChangeMarkerBackgroundPanel`
- Alle markerte celler oppdateres umiddelbart ved bytte

---

## 7. Kjøp-flyter

### Flyt 1: Forhåndskjøp (før spill starter)

```
Ingen spill kjører + 0 bonger → Vis Upcoming_Game_Purchase_UI
  → Viser bongtyper med priser fra backend
  → Spiller velger antall per type med +/- knapper
  → Check_Max_Tickets() validerer (weight × antall ≤ 30)
  → Kjøp → bet:arm(true) → spiller armed for neste runde
  → Game start → armede spillere får bonger automatisk
```

### Flyt 2: Kjøp flere brett (under spill)

```
Spill kjører → "Kjøp flere brett" knapp synlig
  → Ved klikk: åpne kjøp-panel med gjenstående kvote
  → Velg antall → bet:arm(true)
  → Disable knapp etter BuyMoreDisableFlagVal baller trukket
  → Re-enable etter game finish
```

### Flyt 3: Spillovergang (game end → game start)

```
Game End (10 steg):
  1. onGameStart = false
  2. Stop alle blink-animasjoner
  3. Reset lydannonsering
  4. Reset ball-panel
  5. Lukk trekkhistorikk
  6. Enable "kjøp flere"-knapp
  7. Vis countdown-timer
  8. Oppdater saldo

Countdown:
  → scheduler.millisUntilNextStart → nedtelling per sekund
  → Skjul 2s etter den når 0

Game Start (10 steg):
  1. Reset lydannonsering
  2. Lukk lucky number panel
  3. Skjul kjøp-UI
  4. Skjul timer
  5. Skjul delete-knapper
  6. BuildGame1History(snapshot) → nye bonger, nye mønster
  7. GenerateTicketList() → DESTROY old, CREATE new
  8. GeneratePatternList() → ferske mønster med beløp
  9. Oppdater "Spill N: Jackpot" display
  10. Første ball-trekk begynner
```

### Flyt 4: Claim (LINE/BINGO)

```
Ball trukket → Pattern_Remaining_Cell_Count beregnes
  → Hvis count == 0 → mønster fullført
  → Auto-claim eller manuell knapp
  → claim:submit {type: "LINE" | "BINGO"}
  → Backend validerer alle celler markert
  → Beregn gevinst: remainingPrizePool × prizePercent / 100
  → Påfør single prize cap (2500 kr default)
  → Wallet transfer (idempotent)
  → pattern:won broadcast til alle
  → Oppdater pattern-display (aktiv/inaktiv farge)
  → Vinnerlyd spilles
  → BINGO → aktiver mini-game (WoF / Treasure Chest)
```

---

## 8. Mini-spill

### Implementert i web shell

| Mini-spill | Status | Fil |
|------------|--------|-----|
| Wheel of Fortune | Eksisterer | `WheelOverlay.ts` |
| Treasure Chest | Eksisterer | `TreasureChestOverlay.ts` |
| Mystery Game | **MANGLER** | Må bygges |
| Color Draft | **MANGLER** | Må bygges |

### Backend (allerede implementert)

```typescript
// BingoEngine.ts — mini-game aktivering etter BINGO
const MINIGAME_PRIZES = [5, 10, 15, 20, 25, 50, 10, 15]; // 8 segmenter
// Alternerende: miniGameCounter % 2 === 0 → wheel, odd → chest
// Socket: minigame:activated → minigame:play → prize credited
```

**VIKTIG:** Unity mini-game stubs er alle TODO — backend har fungerende endpoints, men Unity har aldri koblet dem til Spillorama. Web shell blir det første laget som kobler dette ordentlig.

---

## 9. UI-funksjoner

### Bytt bakgrunn (5 alternativer)

Panel med 5 bakgrunnsbilder. Lagres i PlayerPrefs/LocalStorage. Oppdateres umiddelbart.

### Bytt markør (6 stiler)

Samme panel, annen fane. 6 markør-stiler med ulik form og farge. Alle markerte celler oppdateres ved bytte.

### Se oppleste tall (trekkhistorikk)

Panel med fargekodet kuler (B=blå, I=rød, N=lilla, G=grønn, O=gul). Kronologisk. Reset ved game finish. Bulk-add ved reconnect.

### Lydannonsering (4 stemmesett)

- Norsk mann (Game 1 spesifikk variant)
- Norsk mann (standard)
- Norsk kvinne
- Engelsk (spilles 2 ganger per tall)
- Dedup: hvert tall kun én gang per runde
- 75 audio clips × 4 = 300 filer

### Lucky number

- Velger tall 1-75 via popup
- Matching celler highlightes med spesialfarge
- Auto-select toggle i innstillinger
- `lucky:set` socket event
- Bonus-premie ved match (konfigurerbart)

### Chat med emoji

- Slide-in panel (høyre side)
- 100 tegn maks
- Emoji-picker (mangler i web shell)
- Spillerprofil + online-indikator

### Game pause

- Admin kan pause mid-game
- Overlay med pausemelding
- Ball-trekking fryses
- Resume-event fjerner overlay

### Notifications

- `NotificationBroadcast` events
- Toast-popups for gevinst, systemmeldinger
- `UtilityMessagePanel` for feilmeldinger

### Loading spinner

- Vis under: tilkobling, kjøp, data-henting
- `UtilityLoaderPanel.ShowLoader()`/`HideLoader()`

---

## 10. Implementasjonsrekkefølge

### Fase 1: Backend-fundament (Urgent)

> Uten dette fungerer ingenting korrekt.

1. **BIN-435** — Utvid `Ticket`-typen med `color` og `type` felt
2. **BIN-437** — gameType-bestemmelse og bongfarge-tilordning
3. **BIN-439** — Send bongfarge i room:update payload
4. **BIN-443** — Backend sender gameType og ticketTypes til klient
5. **BIN-448** — Gevinstfordeling styrt av spillvariant
6. **BIN-436** — Spillvariant-konfigurasjon i database

### Fase 2: Fargesystem (Urgent)

7. **BIN-421** — Ekstraher hex-verdier fra Unity prefab
8. **BIN-423** — Map Unity-fargenavn → web shell-tema
9. **BIN-373** — Navnbasert farge-mapping i web shell

### Fase 3: Kjøp-flyter (Urgent)

10. **BIN-450** — Forhåndskjøp med bongtyper og priser
11. **BIN-451** — Kjøp flere brett med disable-logikk
12. **BIN-468** — Slett/avbestill bong-knapp
13. **BIN-452** — Spillovergang (reset + oppstart)

### Fase 4: Kjerneopplevelse (High)

14. **BIN-378** — Mark-animasjon ved trekk (blink)
15. **BIN-382** — Pattern_Remaining_Cell_Count beregning
16. **BIN-383** — One-to-go farge-highlight
17. **BIN-388** — Best-card-first sortering
18. **BIN-453** — Claim (pattern-deteksjon + auto-claim)
19. **BIN-459** — Lucky number picker UI

### Fase 5: Pattern og visning (Medium)

20. **BIN-394** — Pattern design types (5 typer)
21. **BIN-398** — Pattern cycling-animasjoner
22. **BIN-456** — Trekkhistorikk-panel
23. **BIN-460** — Game pause/resume
24. **BIN-467** — Notification toast system

### Fase 6: Spillvarianter (Medium)

25. **BIN-413** — Elvis-variant komplett
26. **BIN-415** — Traffic Light-variant
27. **BIN-438** — Multiplikator-logikk
28. **BIN-447** — Weight-system validering

### Fase 7: Mini-spill (Medium)

29. **BIN-428** — Mini-game aktivering og alternering
30. **BIN-429** — Backend endpoint-kobling
31. **BIN-424** — Mystery Game (ny)
32. **BIN-425** — Color Draft (ny)

### Fase 8: Polish (Low)

33. **BIN-454** — Bytt bakgrunn
34. **BIN-455** — Bytt markør
35. **BIN-457** — Lydannonsering (4 stemmesett)
36. **BIN-470** — Spiller-preferanser panel
37. **BIN-469** — Loading spinner
38. **BIN-466** — Reconnect visuell feedback

---

## 11. Kritiske kildefiler

### Backend (Spillorama — må endres)

| Fil | Formål |
|-----|--------|
| `backend/src/game/types.ts` | Ticket interface — legg til color/type |
| `backend/src/game/BingoEngine.ts` | Spillmotor — startGame, submitClaim, miniGame |
| `backend/src/game/ticket.ts` | Bonggenerering — generateBingo75Ticket |
| `backend/src/sockets/gameEvents.ts` | Socket handlers — alle events |
| `backend/src/util/roomHelpers.ts` | buildRoomUpdatePayload — serialisering |
| `backend/src/game/PrizePolicyManager.ts` | Gevinsttak og compliance |

### Backend (Gammel AIS — referanse)

| Fil | Formål |
|-----|--------|
| `unity-bingo-backend/Game/Game1/Controllers/GameController-old.js` | gameType, ticketTypes, kjøp-logikk |
| `unity-bingo-backend/Game/Game1/Controllers/GameProcess-old.js` | patternListing, checkForWinners, mini-games |
| `unity-bingo-backend/App/Controllers/subGameController.js` | Admin spillvariant-config |
| `unity-bingo-backend/App/Models/subGame1.js` | Schema med ticketColor array |
| `unity-bingo-backend/gamehelper/game1.js` | formatRunningGame, formatUpcomingGame |

### Unity (source-of-truth for UX)

| Fil | Formål |
|-----|--------|
| `Game1GamePlayPanel.cs` + 5 partials | Hovedkontroller (rendering, socket, mini-games, chat, interactions, upcoming) |
| `TicketColorManager.cs` | Fargesystem — navnbaserte farger + one-to-go |
| `BingoTicket.cs` | Base class — markering, blink, pattern count, togo |
| `BingoTicketSingleCellData.cs` | Celle — highlight, blink, lucky number, one-to-go |
| `PrefabBingoGame1Pattern.cs` | Pattern-visning med 5 animasjonstyper |
| `SpilloramaGameBridge.cs` | Backend-bridge — event-oversettelse, ticket generation |
| `Game1Panel.cs` | Forhåndskjøp, blind tickets, bakgrunn |
| `Game1TicketPurchasePanel.cs` | Kjøp flere brett UI |
| `ChangeMarkerBackgroundPanel.cs` | Bytt markør/bakgrunn |
| `SoundManager.cs` | 4 stemmesett, dedup, to-gangs avspilling |
| `WithdrawNumberHistoryPanel.cs` | Trekkhistorikk med fargekodet kuler |
| `SelectLuckyNumberPanel.cs` | Lucky number velger (1-75) |
| `SettingPanel.cs` | Spillerpreferanser (lyd, språk, lucky number) |

### Web Shell (må utvides)

| Fil | Formål |
|-----|--------|
| `packages/game-client/src/games/game1/Game1Controller.ts` | State machine, mini-game routing |
| `packages/game-client/src/games/game1/screens/PlayScreen.ts` | Hovedskjerm — tickets, info, claims |
| `packages/game-client/src/games/game1/colors/TicketColorThemes.ts` | Fargetemaer — MÅ fikses |
| `packages/game-client/src/components/BingoGrid.ts` + `BingoCell.ts` | Grid-rendering |
| `packages/game-client/src/games/game1/components/WheelOverlay.ts` | Wheel of Fortune |
| `packages/game-client/src/games/game1/components/TreasureChestOverlay.ts` | Treasure Chest |
| `packages/game-client/src/games/game1/components/Game1BuyPopup.ts` | Kjøp-popup |
| `packages/game-client/src/games/game1/components/ChatPanelV2.ts` | Chat |
| `packages/game-client/src/games/game1/components/CenterTopPanel.ts` | Game info + actions |
| `packages/game-client/src/games/game1/components/LeftInfoPanel.ts` | Player info + countdown |
| `packages/shared-types/src/socket-events.ts` | Socket event types |
| `packages/shared-types/src/game.ts` | Game types — Ticket, GameSnapshot |

---

## 12. Socket Events — komplett oversikt

### Client → Server

| Event | Payload | Formål |
|-------|---------|--------|
| `room:create` | `{hallId, gameSlug}` | Opprett/join rom |
| `bet:arm` | `{roomCode, armed}` | Arm/disarm for kjøp |
| `draw:next` | `{roomCode}` | Trekk neste ball (admin) |
| `ticket:mark` | `{roomCode, playerId, number}` | Marker tall på bong |
| `claim:submit` | `{roomCode, playerId, type}` | LINE/BINGO claim |
| `minigame:play` | `{roomCode, selectedIndex?}` | Spill mini-game |
| `lucky:set` | `{roomCode, playerId, luckyNumber}` | Sett lucky number |
| `chat:send` | `{roomCode, message, emojiId?}` | Send chatmelding |
| `game:end` | `{roomCode, reason?}` | Avslutt spill (admin) |

### Server → Client

| Event | Payload | Formål |
|-------|---------|--------|
| `room:update` | `RoomSnapshot` | Full state broadcast |
| `draw:new` | `{number, drawIndex}` | Ny ball trukket |
| `pattern:won` | `{patternName, winnerId, payoutAmount}` | Mønster vunnet |
| `minigame:activated` | `{type, prizeList, playerId}` | Mini-game startet |
| `game:finished` | `{gameId}` | Spill avsluttet |

---

## 13. Verifikasjon

### Visuell sammenligning

1. Kjør Unity-spill via CoPlay `play_game` + ta screenshot
2. Kjør web shell i nettleser
3. Sammenlign element-for-element:
   - Bongfarger matcher?
   - Markør-stil identisk?
   - Pattern-animasjoner identiske?
   - Ball-farger korrekte?
   - One-to-go blink fungerer?

### Funksjonell test

Spill gjennom komplett runde:
1. Forhåndskjøp bonger (velg type + antall)
2. Spill starter → nye bonger vises
3. Tall trekkes → markering + blink
4. One-to-go → farge-highlight + blink
5. LINE claim → gevinst vises
6. Flere trekk → BINGO claim → mini-game
7. Spill avsluttes → reset → countdown → ny runde

### E2E-tester

Utvid eksisterende test suite med Game 1-spesifikke scenarier:
- Spillvariant-endring (standard → elvis → traffic light)
- Weight-validering (maks 30 med multiplikator)
- Claim-sekvens (LINE før BINGO)
- Mini-game aktivering og alternering
- Reconnect med state restoration
- Game pause/resume
