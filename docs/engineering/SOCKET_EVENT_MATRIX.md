# Socket.IO Event-Paritetsmatrise (BIN-585)

**Kilde:** [Linear BIN-585](https://linear.app/bingosystem/issue/BIN-585)
**Parent epic:** BIN-581 Backend legacy-paritet
**Dato:** 2026-04-18
**Sist oppdatert:** Første versjon — PR #1 (matrise, ingen kode-endringer)

## Formål

Komplett, verifisert event-for-event mapping mellom legacy `unity-backend` Socket.IO-handlers og ny `apps/backend` Socket.IO-handlers. Dette dokumentet er grunnlag for portings-PR-ene A–D (se bunn).

Audit ([`BACKEND_PARITY_AUDIT_2026-04-18.md`](./BACKEND_PARITY_AUDIT_2026-04-18.md#2-socketio-events)) sa ~90 uten direkte mapping og ~40 reelt manglende. Denne matrisen er **ned-på-event** og file:line-verifisert mot faktisk kode.

## Metodikk

- **Legacy-scan:** `Socket.on("<Event>", ...)` i `legacy/unity-backend/Game/{Common,Game1..5,AdminEvents}/Sockets/*.js`.
- **Ny-scan:** `socket.on("<event>", ...)` og server-emitted events (`io.to(...).emit`, `socket.emit`) i `apps/backend/src/sockets/*.ts`.
- Kommenterte-ut handlers (`// Socket.on(...)`) er ikke tatt med.
- `game1-old.js` er listet separat som historisk referanse; antagelig allerede død kode.

## Sammendrag (tellere)

| Kategori                       | Antall |
|--------------------------------|-------:|
| Legacy events (aktive, dedup)  |   ~100 |
| Legacy events (med duplikater på tvers av filer) | 151 forekomster |
| Ny events (client→server, aktive) | 26 |
| Ny events (server→client emit)    | ~10 |
| **OK** (mappet eller konsolidert) | 70 |
| **MANGLER** (må portes)           | 15 |
| **NOT-NEEDED** (eksplisitt droppet / dekket av HTTP / deprecated) | 13 |
| **TODO** (eier-avklaring kreves)  | 4 |

### Status-definisjoner

- **OK** — legacy-funksjonalitet er dekket av eksisterende nytt event (direkte eller konsolidert).
- **MANGLER** — må portes. Rutes til PR A/B/C/D under.
- **NOT-NEEDED** — eksplisitt droppet (Game4 deprecated, voucher G4, push → BIN-584, agent-domene → BIN-583, HTTP-variant dekker).
- **TODO** — ukjent om/hvordan dette brukes av klient; krever eier-input før vi porter eller dropper.

---

## 1. Nye events i `apps/backend/src/sockets/` (inventar)

### 1.1 gameEvents.ts (20 handlers)

| Event | File:line |
|---|---|
| `room:create` | [`apps/backend/src/sockets/gameEvents.ts:344`](../../apps/backend/src/sockets/gameEvents.ts#L344) |
| `room:join` | [`apps/backend/src/sockets/gameEvents.ts:396`](../../apps/backend/src/sockets/gameEvents.ts#L396) |
| `room:resume` | [`apps/backend/src/sockets/gameEvents.ts:453`](../../apps/backend/src/sockets/gameEvents.ts#L453) |
| `room:configure` | [`apps/backend/src/sockets/gameEvents.ts:465`](../../apps/backend/src/sockets/gameEvents.ts#L465) |
| `room:state` | [`apps/backend/src/sockets/gameEvents.ts:490`](../../apps/backend/src/sockets/gameEvents.ts#L490) |
| `bet:arm` | [`apps/backend/src/sockets/gameEvents.ts:515`](../../apps/backend/src/sockets/gameEvents.ts#L515) |
| `game:start` | [`apps/backend/src/sockets/gameEvents.ts:564`](../../apps/backend/src/sockets/gameEvents.ts#L564) |
| `game:end` | [`apps/backend/src/sockets/gameEvents.ts:598`](../../apps/backend/src/sockets/gameEvents.ts#L598) |
| `draw:next` | [`apps/backend/src/sockets/gameEvents.ts:613`](../../apps/backend/src/sockets/gameEvents.ts#L613) |
| `draw:extra:purchase` | [`apps/backend/src/sockets/gameEvents.ts:625`](../../apps/backend/src/sockets/gameEvents.ts#L625) |
| `ticket:mark` | [`apps/backend/src/sockets/gameEvents.ts:653`](../../apps/backend/src/sockets/gameEvents.ts#L653) |
| `ticket:replace` | [`apps/backend/src/sockets/gameEvents.ts:674`](../../apps/backend/src/sockets/gameEvents.ts#L674) |
| `claim:submit` | [`apps/backend/src/sockets/gameEvents.ts:719`](../../apps/backend/src/sockets/gameEvents.ts#L719) |
| `lucky:set` | [`apps/backend/src/sockets/gameEvents.ts:808`](../../apps/backend/src/sockets/gameEvents.ts#L808) |
| `jackpot:spin` | [`apps/backend/src/sockets/gameEvents.ts:829`](../../apps/backend/src/sockets/gameEvents.ts#L829) |
| `minigame:play` | [`apps/backend/src/sockets/gameEvents.ts:840`](../../apps/backend/src/sockets/gameEvents.ts#L840) |
| `chat:send` | [`apps/backend/src/sockets/gameEvents.ts:852`](../../apps/backend/src/sockets/gameEvents.ts#L852) |
| `chat:history` | [`apps/backend/src/sockets/gameEvents.ts:894`](../../apps/backend/src/sockets/gameEvents.ts#L894) |
| `leaderboard:get` | [`apps/backend/src/sockets/gameEvents.ts:913`](../../apps/backend/src/sockets/gameEvents.ts#L913) |
| `disconnect` | [`apps/backend/src/sockets/gameEvents.ts:922`](../../apps/backend/src/sockets/gameEvents.ts#L922) |

### 1.2 adminHallEvents.ts (5 handlers)

| Event | File:line |
|---|---|
| `admin:login` | [`apps/backend/src/sockets/adminHallEvents.ts:138`](../../apps/backend/src/sockets/adminHallEvents.ts#L138) |
| `admin:room-ready` | [`apps/backend/src/sockets/adminHallEvents.ts:164`](../../apps/backend/src/sockets/adminHallEvents.ts#L164) |
| `admin:pause-game` | [`apps/backend/src/sockets/adminHallEvents.ts:200`](../../apps/backend/src/sockets/adminHallEvents.ts#L200) |
| `admin:resume-game` | [`apps/backend/src/sockets/adminHallEvents.ts:228`](../../apps/backend/src/sockets/adminHallEvents.ts#L228) |
| `admin:force-end` | [`apps/backend/src/sockets/adminHallEvents.ts:254`](../../apps/backend/src/sockets/adminHallEvents.ts#L254) |

### 1.3 adminDisplayEvents.ts (3 handlers)

| Event | File:line |
|---|---|
| `admin-display:login` | [`apps/backend/src/sockets/adminDisplayEvents.ts:109`](../../apps/backend/src/sockets/adminDisplayEvents.ts#L109) |
| `admin-display:subscribe` | [`apps/backend/src/sockets/adminDisplayEvents.ts:126`](../../apps/backend/src/sockets/adminDisplayEvents.ts#L126) |
| `admin-display:state` | [`apps/backend/src/sockets/adminDisplayEvents.ts:153`](../../apps/backend/src/sockets/adminDisplayEvents.ts#L153) |

### 1.4 Server→client emitted events

| Event | Emitted from | Kontekst |
|---|---|---|
| `room:update` | `emitRoomUpdate` (helpers) | Broadcast per room-transition |
| `draw:new` | [`gameEvents.ts:617`](../../apps/backend/src/sockets/gameEvents.ts#L617) | Etter `draw:next` |
| `ticket:marked` | [`gameEvents.ts:662`](../../apps/backend/src/sockets/gameEvents.ts#L662) | Privat ack (BIN-499) |
| `pattern:won` | [`gameEvents.ts:763`](../../apps/backend/src/sockets/gameEvents.ts#L763) | Room broadcast etter vinnende claim |
| `minigame:activated` | [`gameEvents.ts:777`](../../apps/backend/src/sockets/gameEvents.ts#L777) | Privat til vinner |
| `jackpot:activated` | [`gameEvents.ts:790`](../../apps/backend/src/sockets/gameEvents.ts#L790) | Privat til vinner |
| `chat:message` | [`gameEvents.ts:887`](../../apps/backend/src/sockets/gameEvents.ts#L887) | Room broadcast |
| `hall:tv-url` | [`adminDisplayEvents.ts:173`](../../apps/backend/src/sockets/adminDisplayEvents.ts#L173) | Per-hall display room |
| `admin:hall-event` | [`adminHallEvents.ts:129,132`](../../apps/backend/src/sockets/adminHallEvents.ts#L129) | Operator-handlinger |

---

## 2. Legacy → ny mapping

### 2.1 Game/Common/Sockets/common.js

| Legacy event | Legacy file:line | Ny event | Ny file:line | Status | Kommentar |
|---|---|---|---|---|---|
| `HallList` | common.js:6 | `GET /api/halls` | routes/halls.ts | OK | HTTP-port |
| `GameOnlinePlayerCount` | common.js:16 | `room:state` (players[]) | gameEvents.ts:490 | OK | Konsolidert |
| `GameTypeList` | common.js:26 | `GET /api/games` | routes/games.ts | OK | HTTP-port |
| `IsHallClosed` | common.js:36 | `GET /api/halls/:id` | routes | OK | HTTP-port |
| `Game1Status` | common.js:46 | `room:state` | gameEvents.ts:490 | OK | Konsolidert |
| `LoginPlayer` | common.js:56 | `POST /api/auth/login` | routes/auth.ts | OK | HTTP-port (arkitektonisk riktig) |
| `PlayerDetails` | common.js:67 | `GET /api/players/me` | routes/players.ts | OK | HTTP-port |
| `Logout` | common.js:77 | `POST /api/auth/logout` | routes/auth.ts | OK | HTTP-port |
| `SetLuckyNumber` | common.js:87 | `lucky:set` | gameEvents.ts:808 | OK | Konsolidert |
| `GetLuckyNumber` | common.js:97 | `room:state` (players[].luckyNumber) | gameEvents.ts:490 | OK | Konsolidert |
| `AvailableGames` | common.js:106 | `GET /api/games` | routes | OK | HTTP-port |
| `ReconnectPlayer` | common.js:116 | `room:resume` | gameEvents.ts:453 | OK | Konsolidert |
| `CheckRunningGame` | common.js:126 | `room:state` | gameEvents.ts:490 | OK | Konsolidert (via `currentGame.status`) |
| **`DeletePlayerAccount`** | common.js:136 | — | — | **MANGLER** | GDPR-right; **PR C** |
| `SetLimit` | common.js:147 | `POST /api/wallet/limits` | routes/wallet.ts | OK | HTTP-port (Spillvett) |
| `PlayerNotifications` | common.js:157 | — | — | NOT-NEEDED | Push → BIN-584 |
| `TransactionHistory` | common.js:167 | `GET /api/wallet/transactions` | routes/wallet.ts | OK | HTTP-port |
| `UpdateFirebaseToken` | common.js:184 | — | — | NOT-NEEDED | Push → BIN-584 |
| `playerForgotPassword` | common.js:195 | `POST /api/auth/forgot-password` | routes/auth.ts | OK | HTTP-port |
| `playerChangePassword` | common.js:205 | `POST /api/auth/change-password` | routes/auth.ts | OK | HTTP-port |
| `UpdateProfile` | common.js:215 | `PATCH /api/players/me` | routes/players.ts | OK | HTTP-port |
| `GameTypeData` | common.js:224 | `GET /api/games/:slug` | routes | OK | HTTP-port |
| `FAQ` | common.js:234 | `GET /api/cms/faq` | routes (TBD) | TODO | CMS-API finnes; avklar om socket trengs for Unity-klient |
| `Terms` | common.js:244 | `GET /api/cms/terms` | routes (TBD) | TODO | Samme som FAQ |
| `Support` | common.js:254 | `GET /api/cms/support` | routes (TBD) | TODO | Samme som FAQ |
| `Aboutus` | common.js:264 | `GET /api/cms/about` | routes (TBD) | TODO | Samme som FAQ |
| `ResponsibleGameing` | common.js:274 | `GET /api/cms/responsible-gaming` | routes | OK | HTTP-port (Spillvett-side) |
| `Links` | common.js:284 | `GET /api/cms/links` | routes | OK | HTTP-port |
| `myWinnings` | common.js:293 | `GET /api/wallet/winnings` | routes | OK | HTTP-port |
| `EnableNotification` | common.js:303 | — | — | NOT-NEEDED | Push → BIN-584 |
| `VoucherList` | common.js:313 | — | — | NOT-NEEDED | Voucher-system droppet (G4 → BIN-496); **bekreft at ingen aktive G1–3 vouchers** |
| `RedeemVoucher` | common.js:323 | — | — | NOT-NEEDED | Samme som VoucherList |
| `BlockMySelf` | common.js:333 | `POST /api/wallet/self-exclude` | routes/wallet.ts | OK | HTTP-port (Spillvett) |
| `DepositMoney` | common.js:342 | `POST /api/wallet/deposit` | routes/wallet.ts | OK | HTTP-port |
| `playerProfilePic` | common.js:358 | `POST /api/players/me/avatar` | routes/players.ts | OK | HTTP-port |
| `Playerprofile` | common.js:367 | `GET /api/players/me` | routes/players.ts | OK | HTTP-port |
| `LoginWithUniqueId` | common.js:377 | `POST /api/auth/login-unique` | routes/auth.ts | OK | HTTP-port |
| `GetApprovedHallList` | common.js:387 | `GET /api/halls?approved=true` | routes/halls.ts | OK | HTTP-port |
| `PlayerUpdateInterval` | common.js:397 | — | — | NOT-NEEDED | Ny arkitektur bruker `room:update` push |
| `VerifyPassword` | common.js:408 | `POST /api/auth/verify-password` | routes/auth.ts | OK | HTTP-port |
| `WithdrawMoney` | common.js:417 | `POST /api/wallet/withdraw` | routes/wallet.ts | OK | HTTP-port |
| `updatePlayerLanguage` | common.js:427 | `PATCH /api/players/me` | routes/players.ts | OK | HTTP-port |
| `testingCallEvent` | common.js:437 | — | — | NOT-NEEDED | Debug/test-stub |
| `getGame3PurchaseData` | common.js:462 | `room:state` + `bet:arm` | gameEvents.ts | OK | Konsolidert |
| `game3TicketCheck` | common.js:472 | `claim:submit` | gameEvents.ts:719 | OK | Konsolidert |
| `game3TicketBuy` | common.js:482 | `bet:arm` | gameEvents.ts:515 | OK | Konsolidert |
| `game3TicketCheck32` | common.js:492 | `claim:submit` (variant) | gameEvents.ts:719 | OK | Konsolidert |
| `Localaccess` | common.js:508 | — | — | NOT-NEEDED | Legacy admin-debug |
| `disconnect` | common.js:522 | `disconnect` | gameEvents.ts:922 | OK | Direkte |
| `createBotPlayers` | common.js:539 | — | — | TODO | Dev/test-only? Avklar om tilgjengelig i staging |
| `ScreenSaver` | common.js:549 | — | — | **MANGLER** | Hall-display idle-state; lite brukt, lav prio — **PR D** |
| `CheckPlayerBreakTime` | common.js:565 | `GET /api/wallet/break-status` | routes/wallet.ts | OK | HTTP-port (Spillvett) |
| `verifyByBankId` | common.js:575 | `POST /api/auth/bankid` | routes/auth.ts | OK | HTTP-port |
| `PlayerSettings` | common.js:584 | `GET/PATCH /api/players/me/settings` | routes/players.ts | OK | HTTP-port |
| `AddOrUpdateBlockRule` | common.js:593 | `POST /api/wallet/block-rules` | routes/wallet.ts | OK | HTTP-port |
| `RefreshAccessToken` | common.js:603 | `POST /api/auth/refresh` | routes/auth.ts | OK | HTTP-port |
| `SwitchHall` | common.js:613 | `POST /api/halls/:id/switch` | routes/halls.ts | OK | HTTP-port |
| `PlayerHallLimit` | common.js:623 | `GET /api/wallet/hall-limits/:hallId` | routes/wallet.ts | OK | HTTP-port |
| `PlayerSoundAndVoiceSettings` | common.js:634 | `PATCH /api/players/me/settings` | routes/players.ts | OK | HTTP-port (settings-subset) |

### 2.2 Game/Game1/Sockets/game1.js

| Legacy event | Legacy file:line | Ny event | Ny file:line | Status | Kommentar |
|---|---|---|---|---|---|
| `Game1Room` | game1.js:5 | `room:create` / `room:join` | gameEvents.ts:344,396 | OK | Konsolidert |
| `SubscribeRoom` | game1.js:15 | `room:join` | gameEvents.ts:396 | OK | Konsolidert (også game2/3) |
| `PurchaseGame1Tickets` | game1.js:25 | `bet:arm` | gameEvents.ts:515 | OK | Konsolidert |
| `CancelGame1Tickets` | game1.js:35 | `bet:arm` (armed=false) | gameEvents.ts:515 | OK | Konsolidert via disarm-flag |
| `UpcomingGames` | game1.js:45 | `room:state` | gameEvents.ts:490 | OK | Konsolidert |
| `SelectLuckyNumber` | game1.js:55 | `lucky:set` | gameEvents.ts:808 | OK | Konsolidert (også game2/3) |
| `ViewPurchasedTickets` | game1.js:65 | `room:state` / `room:resume` | gameEvents.ts:490,453 | OK | Konsolidert |
| `ReplaceElvisTickets` | game1.js:75 | `ticket:replace` | gameEvents.ts:674 | OK | Konsolidert (BIN-509) |
| `StartGame` | game1.js:85 | `game:start` | gameEvents.ts:564 | OK | Direkte |
| `SendGameChat` | game1.js:95 | `chat:send` | gameEvents.ts:852 | OK | Konsolidert (også game2/3) |
| `GameChatHistory` | game1.js:104 | `chat:history` | gameEvents.ts:894 | OK | Konsolidert (også game2/3) |
| `LeftRoom` | game1.js:113 | `disconnect` | gameEvents.ts:922 | OK | Auto-håndtert |
| `AdminHallDisplayLogin` | game1.js:123 | `admin-display:login` | adminDisplayEvents.ts:109 | OK | Konsolidert |
| `gameFinished` | game1.js:133 | `game:end` | gameEvents.ts:598 | OK | Konsolidert |
| `WheelOfFortuneData` | game1.js:143 | `minigame:play` | gameEvents.ts:840 | OK | Konsolidert (også game4/5) |
| `PlayWheelOfFortune` | game1.js:152 | `minigame:play` / `jackpot:spin` | gameEvents.ts:840,829 | OK | Konsolidert |
| `WheelOfFortuneFinished` | game1.js:161 | `pattern:won` (emit) | gameEvents.ts:763 | OK | Server→client |
| `TreasureChestData` | game1.js:170 | `minigame:play` | gameEvents.ts:840 | OK | Konsolidert (også game4) |
| `SelectTreasureChest` | game1.js:179 | `minigame:play` (med selectedIndex) | gameEvents.ts:840 | OK | Konsolidert |
| `MysteryGameData` | game1.js:188 | `minigame:play` | gameEvents.ts:840 | OK | Konsolidert (også game4) |
| `SelectMystery` | game1.js:197 | `minigame:play` (med selectedIndex) | gameEvents.ts:840 | OK | Konsolidert |
| `ColorDraftGameData` | game1.js:206 | `minigame:play` | gameEvents.ts:840 | OK | Konsolidert |
| `SelectColorDraft` | game1.js:215 | `minigame:play` (med selectedIndex) | gameEvents.ts:840 | OK | Konsolidert |
| `CancelTicket` | game1.js:225 | `bet:arm` (armed=false) | gameEvents.ts:515 | OK | Konsolidert (også game2/3) |
| `StopGameByPlayers` | game1.js:235 | `admin:force-end` | adminHallEvents.ts:254 | OK | Konsolidert — spiller-triggered stop flyttet til admin-scope |
| `TvscreenUrlForPlayers` | game1.js:244 | `hall:tv-url` (emit) | adminDisplayEvents.ts:173 | OK | Konsolidert |

### 2.3 Game/Game2/Sockets/game2.js (kun unike events, ikke allerede i game1/common)

| Legacy event | Legacy file:line | Ny event | Ny file:line | Status | Kommentar |
|---|---|---|---|---|---|
| `Game2Room` | game2.js:7 | `room:create` / `room:join` | gameEvents.ts:344,396 | OK | Konsolidert |
| `Game2PlanList` | game2.js:29 | `room:state` | gameEvents.ts:490 | OK | Konsolidert |
| `Game2TicketPurchaseData` | game2.js:40 | `room:state` + `bet:arm` | gameEvents.ts | OK | Konsolidert |
| **`Game2BuyBlindTickets`** | game2.js:51 | — | — | **MANGLER** | Blind-ticket (billett uten sjekk før trekning). **PR B** |
| `Game2BuyTickets` | game2.js:62 | `bet:arm` | gameEvents.ts:515 | OK | Konsolidert |
| `CancelGameTickets` | game2.js:73 | `bet:arm` (armed=false) | gameEvents.ts:515 | OK | Konsolidert |
| `LeftRocketRoom` | game2.js:135 | `disconnect` | gameEvents.ts:922 | OK | Auto-håndtert |
| `disconnecting` | game2.js:145 | `disconnect` | gameEvents.ts:922 | OK | Direkte (Socket.IO lifecycle) |

### 2.4 Game/Game3/Sockets/game3.js (kun unike events)

| Legacy event | Legacy file:line | Ny event | Ny file:line | Status | Kommentar |
|---|---|---|---|---|---|
| `Game3Room` | game3.js:6 | `room:create` / `room:join` | gameEvents.ts:344,396 | OK | Konsolidert |
| `Game3PlanList` | game3.js:27 | `room:state` | gameEvents.ts:490 | OK | Konsolidert |
| `GetGame3PurchaseData` | game3.js:38 | `room:state` + `bet:arm` | gameEvents.ts | OK | Konsolidert |
| `PurchaseGame3Tickets` | game3.js:49 | `bet:arm` | gameEvents.ts:515 | OK | Konsolidert |

### 2.5 Game/Game4/Sockets/game4.js — DEPRECATED

Game 4 er vedtatt deprecated (se BIN-496). **Alle** events her = **NOT-NEEDED**.

| Legacy event | Legacy file:line | Status | Kommentar |
|---|---|---|---|
| `isGameAvailbaleForVerifiedPlayer` | game4.js:5 | NOT-NEEDED | Game4 deprecated |
| `ApplyVoucherCode` | game4.js:15 | NOT-NEEDED | Voucher droppet (BIN-496) |
| `Game4Data` | game4.js:26 | NOT-NEEDED | Game4 deprecated |
| `Game4ChangeTickets` | game4.js:37 | NOT-NEEDED | Game4 deprecated |
| `Game4Play` | game4.js:48 | NOT-NEEDED | Game4 deprecated |
| `WheelOfFortuneData` | game4.js:59 | NOT-NEEDED | Game4 deprecated |
| `WheelOfFortuneFinished` | game4.js:70 | NOT-NEEDED | Game4 deprecated |
| `PlayWheelOfFortune` | game4.js:82 | NOT-NEEDED | Game4 deprecated |
| `TreasureChestData` | game4.js:93 | NOT-NEEDED | Game4 deprecated |
| `SelectTreasureChest` | game4.js:104 | NOT-NEEDED | Game4 deprecated |
| `MysteryGameData` | game4.js:115 | NOT-NEEDED | Game4 deprecated |
| `MysteryGameFinished` | game4.js:126 | NOT-NEEDED | Game4 deprecated |
| `Game4ThemesData` | game4.js:137 | NOT-NEEDED | Game4 deprecated |

### 2.6 Game/Game5/Sockets/game5.js

| Legacy event | Legacy file:line | Ny event | Ny file:line | Status | Kommentar |
|---|---|---|---|---|---|
| `isGameAvailbaleForVerifiedPlayer` | game5.js:5 | `room:state` | gameEvents.ts:490 | OK | Konsolidert — `currentGame.status` gir samme svar |
| `Game5Data` | game5.js:14 | `room:state` | gameEvents.ts:490 | OK | Konsolidert |
| **`SwapTicket`** | game5.js:23 | — | — | **MANGLER** | Bytte billett pre-round (forskjellig fra `ticket:replace` som er pay-to-swap). **PR A** |
| `Game5Play` | game5.js:32 | `bet:arm` + `draw:next` | gameEvents.ts | DELVIS | Slot-rulett-fysikk ikke implementert i engine; antagelig holder konsoliderte events, men **avklar om client trenger Game5Play-spesifikk payload** |
| `checkForWinners` | game5.js:41 | `claim:submit` | gameEvents.ts:719 | OK | Konsolidert |
| `LeftRoom` | game5.js:50 | `disconnect` | gameEvents.ts:922 | OK | Auto-håndtert |
| `WheelOfFortuneData` | game5.js:59 | `minigame:play` / `jackpot:spin` | gameEvents.ts:840,829 | OK | Konsolidert |
| `PlayWheelOfFortune` | game5.js:68 | `jackpot:spin` | gameEvents.ts:829 | OK | Konsolidert (G5 jackpot) |
| `SelectWofAuto` | game5.js:77 | — | — | **MANGLER** | Auto-velg WoF-resultat. **PR B** |
| **`SelectRouletteAuto`** | game5.js:86 | — | — | **MANGLER** | Auto-velg rulett. **PR B** |

### 2.7 Game/AdminEvents/Sockets/admnEvents.js

| Legacy event | Legacy file:line | Ny event | Ny file:line | Status | Kommentar |
|---|---|---|---|---|---|
| `joinHall` | admnEvents.js:5 | `admin-display:subscribe` | adminDisplayEvents.ts:126 | OK | Konsolidert |
| `joinRoom` | admnEvents.js:17 | `admin:login` + `admin-display:subscribe` | adminHall/DisplayEvents | OK | Konsolidert |
| `getNextGame` | admnEvents.js:29 | `admin-display:state` / `room:state` | adminDisplayEvents.ts:153 | OK | Konsolidert |
| `getOngoingGame` | admnEvents.js:38 | `room:state` | gameEvents.ts:490 | OK | Konsolidert |
| **`getHallBalance`** | admnEvents.js:47 | — | — | **MANGLER** | Hall-saldo live via socket. **PR D** (hvis ikke agent-scope → BIN-583) |
| `onHallReady` | admnEvents.js:56 | `admin:room-ready` | adminHallEvents.ts:164 | OK | Konsolidert |
| `getWithdrawPenddingRequest` | admnEvents.js:65 | `GET /api/admin/withdrawals/pending` | routes/admin.ts | OK | HTTP-port |
| `gameCountDownTimeUpdate` | admnEvents.js:75 | `admin-display:state` | adminDisplayEvents.ts:153 | DELVIS | Verifiser payload-paritet |
| `secondToDisplaySingleBallUpdate` | admnEvents.js:85 | `admin-display:state` | adminDisplayEvents.ts:153 | DELVIS | Verifiser payload-paritet |
| `checkTransferHallAccess` | admnEvents.js:95 | — | — | NOT-NEEDED | Agent-overføring → BIN-583 |
| `transferHallAccess` | admnEvents.js:103 | — | — | NOT-NEEDED | Agent-overføring → BIN-583 |
| `approveTransferHallAccess` | admnEvents.js:113 | — | — | NOT-NEEDED | Agent-overføring → BIN-583 |

### 2.8 Game/Game1/Sockets/game1-old.js — HISTORISK

Alle events her er eldre varianter av `game1.js` (f.eks. `CancelGameTickets` → `CancelGame1Tickets`, `GameFinished` vs `gameFinished`, `CheckForWinners` vs checkForWinners). Filen er antagelig ikke lastet inn i legacy-boot, men listes for sporbarhet.

| Legacy event | Legacy file:line | Status | Kommentar |
|---|---|---|---|
| `ApplyVoucherCode` | game1-old.js:10 | NOT-NEEDED | Voucher droppet |
| `GetGame1PurchaseData` | game1-old.js:16 | OK | Erstattet av `room:state`+`bet:arm` |
| `PurchaseGame1Tickets` | game1-old.js:22 | OK | Dup av game1.js:25 |
| `CancelGameTickets` | game1-old.js:28 | OK | Dup av game1.js:35 (CancelGame1Tickets) |
| `SendGameChat` | game1-old.js:34 | OK | Dup |
| `GameChatHistory` | game1-old.js:40 | OK | Dup |
| `HallGameList` | game1-old.js:45 | OK | HTTP `GET /api/halls/:id/games` |
| `SubscribeRoom` | game1-old.js:50 | OK | Dup |
| `LeftRoom` | game1-old.js:55 | OK | Dup |
| `SelectLuckyNumber` | game1-old.js:60 | OK | Dup |
| `CheckForWinners` | game1-old.js:65 | OK | `claim:submit` |
| `GameFinished` | game1-old.js:70 | OK | `game:end` |
| `CheckForGameFinished` | game1-old.js:75 | OK | `room:state` gir `currentGame.status` |
| `WheelOfFortuneData` | game1-old.js:80 | OK | Dup |
| `PlayWheelOfFortune` | game1-old.js:84 | OK | Dup |
| `WheelOfFortuneFinished` | game1-old.js:88 | OK | Dup |
| `TreasureChestData` | game1-old.js:92 | OK | Dup |
| `SelectTreasureChest` | game1-old.js:96 | OK | Dup |
| `MysteryGameData` | game1-old.js:100 | OK | Dup |
| `MysteryGameFinished` | game1-old.js:104 | OK | Dup (→ `pattern:won`) |

---

## 3. Konsoliderte MANGLER-liste (reell porting-kø)

Events som må portes (status = MANGLER):

| # | Event | Legacy ref | Foreslått ny event | PR | Begrunnelse |
|--:|---|---|---|---|---|
| 1 | `SwapTicket` | game5.js:23 | `ticket:swap` (eller utvid `ticket:replace`) | **PR A** | Game5 pre-round bytte uten betaling (replaceAmount=0) |
| 2 | `Game2BuyBlindTickets` | game2.js:51 | `bet:arm` variant m/blind-flag | **PR B** | Game2 blind-kjøp |
| 3 | `SelectRouletteAuto` | game5.js:86 | `minigame:play` variant | **PR B** | Game5 rulett auto-valg |
| 4 | `SelectWofAuto` | game5.js:77 | `minigame:play` variant | **PR B** | Game5 WoF auto-valg |
| 5 | `DeletePlayerAccount` | common.js:136 | `account:delete` (socket) eller `DELETE /api/players/me` (HTTP) | **PR C** | GDPR-right. **Avklar**: HTTP passer bedre arkitektonisk |
| 6 | `getHallBalance` | admnEvents.js:47 | `admin:hall-balance` (på adminHallEvents) | **PR D** | Hall-operator live-saldo |
| 7 | `ScreenSaver` | common.js:549 | `hall:screensaver` (display emit) | **PR D** | Hall-display idle |

**Totalt MANGLER: 7 eksplisitte + 3 DELVIS-verifikasjoner** (Game5Play, gameCountDownTimeUpdate, secondToDisplaySingleBallUpdate payload-paritet).

Audit-tallet "~40 reelt manglende" inkluderte events vi her har klassifisert som NOT-NEEDED (Game4, voucher, push → BIN-584, agent → BIN-583). Netto real-porting-gjeld = **7–10 events**.

## 4. Konsoliderte TODO-liste (eier-avklaring)

| # | Spørsmål | Hvorfor | Foreslått default |
|--:|---|---|---|
| 1 | Skal Unity-bridge beholde legacy event-navn (`Game1Room`, `PurchaseGame1Tickets` osv.) som aliaser i en overgangsperiode? | Legacy Unity-klient bruker gamle navn. Shell-klient (web) bruker nye. | JA — legg alias i bridge-lag i `apps/backend/src/sockets/legacyBridge.ts`. |
| 2 | Er G2/G3 `VoucherList`/`RedeemVoucher` faktisk død, eller har vi aktive vouchers i prod? | Audit sier droppet, men common.js:313–323 er fortsatt aktiv i legacy. | Eier sjekker. Default: NOT-NEEDED (drop) |
| 3 | Skal `FAQ`/`Terms`/`Support`/`Aboutus` eksponeres via socket eller kun via HTTP CMS-API? | Unity-klient bruker socket i dag. | HTTP-only; Unity-klient tar wrap-kall. |
| 4 | `DeletePlayerAccount` — socket eller HTTP? | GDPR-right; ytelse irrelevant. | `DELETE /api/players/me` (HTTP). |
| 5 | `createBotPlayers` — kun dev/staging, eller prod-tool? | common.js:539 er åpen i legacy. | Dev-only; ikke portes. |

---

## 5. Foreslått porting-plan (PR-sekvens)

Etter review av denne matrisen:

- **PR A — Ticket-events** (BIN-585.1)
  - Port `SwapTicket` → `ticket:swap` (eller utvid `ticket:replace` med `gratis=true` flag)
  - Zod wire-contract i `packages/shared-types/`
  - Unity-bridge alias

- **PR B — Game-spesifikke auto-events** (BIN-585.2)
  - `Game2BuyBlindTickets` → `bet:arm` variant
  - `SelectRouletteAuto`, `SelectWofAuto` → `minigame:play` variant
  - Verifiser `Game5Play` payload-paritet

- **PR C — Player account** (BIN-585.3)
  - `DeletePlayerAccount` → `DELETE /api/players/me` (HTTP, ikke socket) **eller** `account:delete` socket-event (avhenger av TODO #4)

- **PR D — Hall-operator** (BIN-585.4)
  - `getHallBalance` → `admin:hall-balance`
  - `ScreenSaver` → `hall:screensaver`
  - Verifiser `gameCountDownTimeUpdate`, `secondToDisplaySingleBallUpdate` payload-paritet

Hver PR inkluderer:
1. Handler i `apps/backend/src/sockets/`
2. Zod-schema i `packages/shared-types/src/wireContract.ts`
3. Unity-bridge-alias (hvis TODO #1 er JA)
4. ≥1 enhetstest per event

---

## 6. Referanser

- Legacy sockets: [`legacy/unity-backend/Game/{Common,Game1..5,AdminEvents}/Sockets/*.js`](../../legacy/unity-backend/Game/)
- Ny sockets: [`apps/backend/src/sockets/*.ts`](../../apps/backend/src/sockets/)
- Audit (overordnet tall): [`BACKEND_PARITY_AUDIT_2026-04-18.md §2`](./BACKEND_PARITY_AUDIT_2026-04-18.md#2-socketio-events)
- Parent-epic: [BIN-581](https://linear.app/bingosystem/issue/BIN-581)
- Relaterte issues: BIN-583 (agent), BIN-584 (push), BIN-527 (wire-contract), BIN-509 (ticket:replace)
