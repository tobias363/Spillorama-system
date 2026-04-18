# Backend Paritets-Audit — Legacy vs apps/backend

Generert: 2026-04-18
Auditor: Claude (Opus 4.7, 1M ctx)
Arbeidstre: `/Users/tobiashaugen/Projects/Spillorama-system/.claude/worktrees/slot-1`

---

## TL;DR (tellinger)

| Område | Legacy | Ny (apps/backend) | Manglende / Delta |
|---|---:|---:|---:|
| HTTP-endepunkter (ruter) | **559** | **122** | **~250 funksjonelt unike mangler**, ~190 er server-renderte admin-HTML-sider (ikke 1:1 port nødvendig — egen admin-web SPA) |
| Socket.IO-events (handlers) | **129 unike events** | **28** | **~90 events ikke dekket** direkte; noen er konsolidert til `room:*`/`draw:*` semantikk |
| Games ported | Game1–5 (Game4 deprecated) | Game1, 2, 3, 5 (engine-generisk) | Game4=deprecated OK; Game5 er delvis (slot-spinn, SwapTicket, Free Spin Jackpot) — kun referanser i client controller |
| Cron-jobs | 2 CronJob + 4 setInterval i `Boot/Server.js` | 0 cron, 1 `DrawScheduler` tick + 1 daily-report scheduler | Mangler daglig cron-sett (BankId-reminder, Metronia/OKBingo auto-close, Swedbank txn sync, loyalty reset, expired block rules, send-notification, startGameCron) |
| DB-tabeller / Mongo-collections | 55 Mongoose-modeller (se `App/Models/*.js`) | 29 PostgreSQL-tabeller (se `migrations/`) | ~35 funksjonelt unike tabeller mangler — hovedsakelig drift/admin-side |
| Push notifications (FCM) | Ja — fcm-node, firebase-admin | Nei | Mangler helt |
| E-post | Ja — nodemailer overalt | Kun Spillevett-rapport | Mangler epost for reset-pwd, deposit/withdraw bekreftelser, BankId-reminder |
| Betaling | SwedbankPay + (CoinPayments i deps) | SwedbankPay | OK |
| Eksterne spill (Candy) | `POST /api/games/candy/launch` + iframe | Mangler launch-endpoint | P0-hull per kjent arkitektur-gap |

**Estimert port-arbeid (grovt):** **40–55 dev-dager** for 100% funksjonsparitet, fordelt:
- Cron-jobs + bakgrunnsjobber: 3–5 dager
- Push-varsler (FCM) + notifikasjoner: 4–6 dager
- E-post-maler + transport: 2–3 dager
- Admin-API-endepunkter (omregnet til JSON uten views): 15–20 dager
- Agent-domain (fysiske billetter, daglig-balanse, unique-id, produktsalg): 8–10 dager
- Rapportering & eksport (dashboard, game-reports, daglig balanse): 5–7 dager
- Chat-historikk + notifikasjoner-persistens: 2 dager
- Spiller-selfservice (import-flow, reverify BankId, språk-bryter): 2–3 dager
- DB-migrasjoner for nye tabeller: 2–3 dager

---

## 1. HTTP Endpoints

**Legacy totalt:** 559 (524 `backend.js` + 12 `frontend.js` + 23 `integration.js`)
**Ny totalt:** 122 (admin.ts 76, auth.ts 12, game.ts 11, wallet.ts 14, payments.ts 4, index.ts 5)

Legacy er delvis server-rendered (nunjucks views) — for alle `GET /admin/*`, `GET /agent/*`, `GET /player/*` som returnerer HTML, regnes "manglende" som **kan trenge JSON-variant** i ny stack hvis admin-web SPA skal bygges.

### 1.1 Auth

| Legacy | Ny | Status | Kommentar |
|---|---|---|---|
| GET /login | — | **MANGLER** | Hvis admin-web skal være SPA: ikke nødvendig (login er POST) |
| POST /login (admin/agent) | `POST /api/admin/auth/login` | DELVIS | Ny har kun admin-login; legacy skiller admin vs agent vs player |
| GET /logout | `POST /api/admin/auth/logout` | OK | |
| GET /forgot-password | — | MANGLER | View-side — ikke nødvendig i ren API |
| POST /forgot-password | `POST /api/auth/forgot-password` | OK | |
| GET /reset-password/:token | — | MANGLER | View-side |
| POST /reset-password/:token | — | **MANGLER** | Backend-støtte trengs |
| GET /resetPassword/:token (frontend.js) | — | MANGLER | Spiller-reset, view |
| POST /resetPassword/:token (frontend.js) | — | **MANGLER** | Spiller-reset POST |
| GET /player/reset-password/:token | — | MANGLER | Importert spiller — view |
| POST /player/reset-password/:token | — | **MANGLER** | Importert spiller — POST |
| POST /changePwd/:id | `POST /api/auth/change-password` | OK | Ny er self-service (me), legacy tar :id |
| POST /player/register | `POST /api/auth/register` | OK | |
| POST /pendingRequests/approvePendingPlayer | — | **MANGLER** | Manuell KYC-godkjenning |
| POST /pendingRequests/rejectPendingPlayer | — | **MANGLER** | |
| POST /pendingRequests/forwardRequest | — | MANGLER | |
| GET /pendingRequests + /getPendingPlayer | — | **MANGLER** | Pending-queue admin |
| POST /player/active | — | **MANGLER** | Aktiver spiller |
| POST /player/approveRejected / deleteRejected | — | MANGLER | Avvis-flow |
| POST /player/reverify-bankid | — | **MANGLER** | Re-verifiser BankId |
| GET /player/bankId/iframe/:id | `POST /api/auth/bankid/init` | DELVIS | Legacy åpner iframe i view, ny er API-init |
| GET /player/bankid/redirect + POST /goback | `GET /api/auth/bankid/callback` | OK | |
| POST /validateGameView | — | MANGLER | Anti-cheat view-gate |

**Oppsummering:** BankId-init finnes. KYC pending-queue (approve/reject) og "imported player reset" mangler helt.

### 1.2 Admin (spiller-/agent-/rolle-administrasjon)

Legacy har ~90 admin-relaterte endepunkter som er **blanding av HTML-views og data-endepunkter**. Ny backend har `/api/admin/*` (76 stk) som er ren JSON.

| Funksjon | Legacy endepunkter | Ny | Status |
|---|---|---|---|
| Admin users CRUD | GET/POST /addAdmin, POST /adminEdit/:id, /admin/getAdmin, /admin/getAdminDelete, /adminRoleUpdate | `PUT /api/admin/users/:userId/role`, `POST /api/admin/bootstrap` | **DELVIS** — mangler fullstendig admin CRUD |
| Roller (admin) | GET /role, POST /saveRole, /updateRole/:id, /editRole/:id, /role/getRole | — | **MANGLER** |
| Agent-roller | GET /agentRole, POST /role/saveAgentRole, /updateAgentRole/:id | — | **MANGLER** |
| Brukere (generelt) | GET /user, POST /addUser, /userEdit/:id, /user/getUserDelete | — | **MANGLER** (kun role-endring finnes) |
| Haller | GET /hall, /addHall, /hallEdit/:id, /getHall, /getHalls, /hall/getHallDelete | `GET/POST /api/admin/halls`, `PUT /api/admin/halls/:hallId` | OK |
| Hall IP/cash | POST /hall/check-ip-address, /hall/set-cash-amount, /hall/check-hall-number | — | **MANGLER** — hall-driftsverktøy |
| Gruppehaller | GET/POST /groupHall*, /getAllGroupHalls, /getAvailableGroupHalls/:type | — | **MANGLER** — gruppehall-konsept mangler i ny |
| Agent admin | GET /agent, POST /addAgent, /agentEdit/:id, /agent/getAgentDelete | — | **MANGLER** (hele agent-CRUD) |
| Spiller admin | GET /player, /viewPlayer/:id, /playerEdit/:id, POST /player/getPlayerDelete, /player/playerSoftDelete, /player/profile/image/update, /player/hallStatus, /player/import, /player/import/confirm | `GET /api/wallets`, `GET /api/wallets/:walletId` | **DELVIS** — wallet-view finnes, men ikke player-profile edit, import, hard/soft delete |
| Red-flag kategorier | GET /redFlagCategory, POST /addRiskCountry, /deleteRiskCountry | — | **MANGLER** |
| Risk-country | GET /getRiskCountry | — | **MANGLER** |
| Blocked IP | GET /blockedIp, /blockedIp/add/edit/delete | — | **MANGLER** |
| Dashboard | GET /dashboard, /dashboard/gameHistory, /dashboard/ongoingGames, /dashboard/getTopPlayers, /dashboardChart/* | `GET /api/admin/dashboard/live` | **DELVIS** — live-dashboard finnes, historiske charts mangler |
| Maintenance | GET/POST /maintenance, /maintenance/DailyReports, /maintenance/restartServer | — | **MANGLER** |
| System-info | GET /system/systemInformation, POST /editSystemInformation | — | MANGLER |
| Reports (daglig) | POST /hall/report/saveData | `POST /api/admin/reports/daily/run`, `GET /api/admin/reports/daily` | OK |
| Reports (hall) | GET /getHallReports, /getHallAccountReport, /hallAccountReportTable, /getHallOrderReports, /hallSpecificReport | `GET /api/admin/reports/range` | **DELVIS** — per-hall account/order reports mangler |
| Reports (spill) | GET /reportGame1/2/3/4/5, /getReportGame1 etc | `GET /api/admin/reports/games` | **DELVIS** — ny er generisk, legacy har spill-spesifikke med drill-down |
| Settlement report | GET /report/settlement, /report/settlement/:id | — | **MANGLER** |
| Total revenue | GET /totalRevenueReport, /getData | — | **MANGLER** |
| Physical tickets report | GET /physicalTicketReport, /reportPhysical | — | **MANGLER** |
| Unique game report | GET /uniqueGameReport, /reportUnique | — | **MANGLER** |
| Leaderboard admin | GET/POST /leaderboard, /addLeaderboard, /leaderboardEdit/:id | `GET /api/leaderboard` | **DELVIS** — read finnes, admin-CRUD mangler |
| Loyalty admin | GET/POST /loyalty, /addLoyalty, /loyaltyEdit/:id, /loyaltyManagement | — | **MANGLER** — men per BIN-cron-komment: ikke i bruk |
| Schedules | GET /schedules, /getSchedules, /createSchedule, /createDailySchedule, /editDailySchedule/:id, /deleteDailySchedule, /deleteSchedule, /createDailySpecialSchedule, /viewDailySchedule/:id, /saveDailySchedule, /deleteSavedDailySchedule, /repeatGame/:typeId, /schedule/getHalls, /schedule/getAvailableGroupHalls, /schedule/getMasterHallData, /schedule/getSchedulesBySlot, /schedules/checkStoreSubGameName, /schedules/getStoredSubGame, /schedules/getStoredSubGameData, /schedules/getStoredSubGames, /savedGameList, /viewSavedDailySchedule/:id, /editSavedDailySchedule/:id | `GET/POST /api/admin/halls/:hallId/schedule`, `PUT/DELETE /api/admin/halls/:hallId/schedule/:slotId`, `GET /api/admin/halls/:hallId/schedule-log`, `POST /api/admin/halls/:hallId/schedule/:slotId/log` | **DELVIS** — per-hall slot-skjema finnes; master/grouphall/daily-special/repeat/saved-games er ny konseptmodell (gruppehall og master konsept dropper) |
| Pattern CRUD | GET /patternEdit/:typeId/:id, POST /addPattern, /patternEdit/:typeId/:id, /getPatternDelete, /getPatternMenu, /getPatternDetailList, /checkForPatternName, /patternGame, /patternGameDetailList/:id, /viewPattern | Ingen egne (integrert i variantConfig JSONB) | **ARCH-ENDRING** — pattern lagres nå i `hall_game_schedules.variant_config` |
| Sub-game CRUD | GET /subGame, /editSubGame, /addSubGameData, /subGames/getSubGameList, /viewSubGame, /viewsubGamesManagement, /getCurrentSubgames, /api/saveSubGame, /api/saveSubGames | Ingen egne | **ARCH-ENDRING** — sub-game = game_variant i ny modell; OK hvis variant-config dekker dette |
| Game type CRUD | GET /gameType, POST /addGameType, /editGameType, /deleteGameType, /viewGameType, /gameType/getGameType | `GET /api/admin/games`, `PUT /api/admin/games/:slug` | DELVIS — game list/edit finnes, CRUD for nye typer mangler |
| Mystery/Wheel/TreasureChest edit | POST /mysteryEdit, /editWheelOfFortune, /treasureChestEdit, /colorDraftEdit | Ingen direkte admin-endpoints | **MANGLER** — mini-games er hardkodet i `BingoEngine.ts` |
| Prize policy | — (embedded i game config) | `GET/PUT /api/admin/prize-policy` | Ny feature |
| Compliance/ledger | — | `GET /api/admin/ledger/entries`, `POST /api/admin/ledger/entries`, `GET /api/admin/compliance/extra-draw-denials`, `GET /api/admin/payout-audit` | Ny feature |
| Overskudd/ideelle | — | `GET/POST /api/admin/overskudd/*` | Ny feature |
| Voucher CRUD | GET/POST /voucher, /addVoucher, /voucherEdit/:id, /voucher/getVoucherDelete | — | **MANGLER** (men Game4-voucher er deprecated per BIN-496) |
| Background/Theme/CMS | GET/POST /background, /addBackground, /theme, /themeEdit, /cms, /faq, /aboutusEdit, /supportEdit, /termEdit, /linksOfOtherAgenciesEdit, /resposibleGameingEdit, /popup_modal, /updatePlayerLanguageIfnotexist | — | **MANGLER** — hele CMS-laget |
| Products / HallProducts | GET/POST /productList, /addProduct, /editProduct, /deleteProduct, /products/getProducts, /addProductinHall, /hallProductList, /getHallsandProducts, /getHallWithProduct/:id, /getProduct/:id | — | **MANGLER** — helt produktsalg-modul |
| Close-day | GET /getCloseDayData, POST /closeDayAdd, /updateCloseDay, /deleteCloseDay | — | MANGLER |
| Settings | GET /settings, POST /settings/add, /settings/update, /settings/addScreenSaverData | `GET /api/admin/settings/catalog`, `GET/PUT /api/admin/settings/games/:slug` | DELVIS — ny er mer strukturert, legacy har fri-form settings |
| Display tokens | — | `GET/POST /api/admin/halls/:hallId/display-tokens`, `DELETE` | Ny feature (TV-skjerm auth) |
| Terminaler | — | `GET/POST /api/admin/terminals`, `PUT /api/admin/terminals/:id` | Ny feature |
| Rooms (runtime) | — | `GET/POST /api/admin/rooms`, draw-next, start, end, pause, resume, room-ready | Ny feature (erstatter legacy schedule-start) |
| Games history replay | GET /viewGameHistory, /viewSaveGameManagement, /viewGameDetails | `GET /api/admin/games/:gameId/replay` | DELVIS |

### 1.3 Wallet (spiller-lommebok)

| Legacy | Ny | Status |
|---|---|---|
| GET /wallet, /getWallet, /viewWallet/:id | `GET /api/wallet/me`, `GET /api/wallets/:walletId` | OK |
| GET /getUserTransactionList, /getUserTransactionHeader/:id, /viewUserTransaction | `GET /api/wallet/me/transactions`, `GET /api/wallets/:walletId/transactions` | OK |
| GET /getTransactions, /getPlayerTransactions | `GET /api/admin/ledger/entries` | OK |
| GET /player/depositMoney (view) | — | MANGLER (view) |
| GET /deposit/requests | — | **MANGLER** (manuell deposit-approval) |
| POST /deposit/requests/accept, /reject | — | **MANGLER** |
| GET /deposit/history | — | **MANGLER** (eget flow, men dekkes delvis av /api/wallet/me/transactions) |
| GET /withdraw/requests/bank, /hall | — | **MANGLER** (withdraw-approval) |
| POST /withdraw/requests/accept, /reject | — | **MANGLER** |
| GET /withdraw/history/bank, /hall | — | MANGLER |
| GET /withdrawAmount, /withdrawAmt, /withdrawAmtHistory | — | MANGLER |
| POST /withdrawAmount/chipsAction | — | MANGLER |
| POST /agent/add-balance, /agent/get-balance | `POST /api/wallets/:walletId/topup` | DELVIS (mangler hall-kontekst) |
| POST /unique/depositWithdraw, /withdrawAccess | — | MANGLER |
| POST /players/track-spending | — | MANGLER (RG-tracking view) |
| `POST /api/wallet/me/topup` | — | OK (ny feature) |
| `POST /api/payments/swedbank/*` | `POST /payment/webhook`, `/payment/goback`, `/payment/iframe/:checkoutId`, `/payment/deposit/response` | OK (ny er API, legacy var iframe-flow) |
| `GET /api/spillevett/report`, `POST /api/spillevett/report/export` | — (ikke i legacy) | Ny feature |
| Self-exclusion / loss-limit / timed-pause (admin) | POST /player/block-rules/delete, /approved/update-flag, /updatePlayerLanguageIfnotexist, /AddOrUpdateBlockRule (socket), /BlockMySelf (socket), /SetLimit (socket) | `POST/DELETE /api/wallet/me/self-exclusion`, `POST/DELETE /api/wallet/me/timed-pause`, `PUT /api/wallet/me/loss-limits`, `POST/DELETE /api/admin/wallets/:walletId/self-exclusion`, `PUT /api/admin/wallets/:walletId/loss-limits` | **OK** — ny implementasjon er bedre/mer strukturert |

### 1.4 Games (HTTP, ikke socket)

| Legacy | Ny | Status |
|---|---|---|
| POST /startGame, /startManualGame | `POST /api/admin/rooms/:roomCode/start` | OK |
| POST /stopGame/:typeId, /stopGame1 | `POST /api/admin/rooms/:roomCode/end` | OK |
| POST /game/auto-stop | `POST /api/admin/rooms/:roomCode/game/pause`, `/resume` | DELVIS |
| POST /game1/purchaseTickets | (via socket `bet:arm` / ticket claims) | OK — flyttet til socket |
| GET /gameManagement, /viewGameManagement, /getGameManagementDelete | `GET /api/admin/rooms`, `GET /api/admin/rooms/:roomCode` | DELVIS — less granular |
| GET /getGameAgents, /getCurrentSubgames, /getTicketTable | — | MANGLER (admin drill-down) |
| POST /agent/game/check-bingo, /start, /stop, /update-hall-status | `POST /api/admin/rooms/:roomCode/start`, `/end`, `/room-ready`, `/draw-next` | OK |
| POST /agent/game/physical/* | — | **MANGLER** (fysiske billetter helt utelatt) |
| POST /addManualWinning, /generateTicket, /generateEditTicket | — | MANGLER |
| POST /api/games/candy/launch | — | **MANGLER P0** — Candy-integrasjon (kjent gap per arkitektur-memo) |
| Agent game flows: /agent/cashinout, /cashout/*, /dailybalance, /game/completed, /hall-status, /status/pause, /status/start, /getGamesInHall, /getPhysicalWinningInGame, /physical/sell, /physicalCashOut, /productCheckout, /profile, /register-user/*, /sellProduct, /settlement, /unique-id/*, /upcoming-game/* | — | **MANGLER** — hele agent-workflow (se separat seksjon under) |

### 1.5 Integration / Ekstern wallet / Betaling

| Legacy | Ny | Status |
|---|---|---|
| GET /api/ext-wallet/balance | `GET /api/ext-wallet/balance` (via externalGameWallet router) | OK |
| POST /api/ext-wallet/debit | `POST /api/ext-wallet/debit` | OK |
| POST /api/ext-wallet/credit | `POST /api/ext-wallet/credit` | OK |
| GET /api/ext-wallet/diag | `GET /api/ext-wallet/diag` (antatt via router) | OK |
| POST /api/games/candy/launch | — | **MANGLER P0** |
| POST /payment/webhook (Swedbank) | `POST /api/payments/swedbank/callback`, `/confirm` | OK |
| GET /payment/iframe/:checkoutId | — | MANGLER (iframe-flow — men SPA kan åpne Swedbank direkte) |
| POST /payment/goback | — | MANGLER |

### 1.6 Agent (fysisk hall + kasse + unique-id)

**Status: 78 endepunkter — nær 0% portert.**

Dette er et helt subsystem i legacy: agenter i fysiske haller selger billetter, kasserer inn/ut, håndterer unike ID-er (medlemskort), selger produkter, kjører daglig-balanse, settlement. Dette er **ikke på plass** i ny backend. Agent-appen i `apps/android` kan fortsatt avhenge av dette.

Kritiske manglende endepunkter:
- `/agent/cashinout`, `/agent/cashout/*`, `/agent/dailybalance/*` — daglig kasse
- `/agent/unique-id/add`, `/withdraw`, `/balance/update`, `/check-validity` — unique-ID / medlemskort
- `/agent/physical/sell/:gameId`, `/agent/physical/sell`, `/agent/physicalCashOut` — fysiske billetter
- `/agent/game/physical/add-to-wallet`, `/cash-out`, `/close-ticket`, `/close-all-tickets`, `/create-ticket` — billett-ops
- `/agent/metronia/*`, `/agent/okbingo/*` — tredjeparts-bingomaskiner
- `/agent/productCheckout`, `/agent/sellProduct`, `/agent/createCart`, `/agent/placeOrder`, `/agent/cancelOrder` — produkt-salg
- `/agent/settlement`, `/agent/settlement/edit`, `/agent/settlement/get-date` — settlement
- `/agent/register-user/*` — kunde-registrering i hall
- `/agent/reward-all`, `/agent/wof/reward` — manuelle utbetalinger
- `/agent/upcoming-game/*` — oppkommende spill
- `/agent/profile`, `/agent/getAgent` — agent-selfservice

---

## 2. Socket.IO Events

**Legacy:** 129 unike events (Game1/2/3/4/5 + Common + AdminEvents)
**Ny:** 28 unike events (gameEvents + adminHallEvents + adminDisplayEvents)

Ny design har **konsolidert** spill-spesifikke events til generiske `room:*`, `draw:*`, `ticket:*`, `claim:*`, `minigame:*`, `chat:*`, `jackpot:*`, `bet:*`, `lucky:*` events. Dette er **arkitektonisk riktig** og de fleste legacy-events er erstattet semantisk.

### 2.1 Game 1 / Game 2 / Game 3 / Game 5 — spill-lifecycle

| Legacy event | Ny event | Status | Kommentar |
|---|---|---|---|
| Game1Room, Game2Room, Game3Room | `room:create` / `room:join` | OK | Konsolidert |
| SubscribeRoom | `room:join` | OK | |
| LeftRoom, LeftRocketRoom | `disconnect` | OK | Auto-handled |
| UpcomingGames | (via `room:state`) | OK | |
| Game1Status (Common) | `room:state` | OK | |
| PurchaseGame1Tickets, Game2BuyTickets, Game2BuyBlindTickets, PurchaseGame3Tickets | `bet:arm` | OK | Konsolidert |
| CancelGame1Tickets, CancelGameTickets | (ikke støttet i ny?) | **MANGLER** | Se nedenfor |
| CancelTicket | — | **MANGLER** | Avbryt enkeltbillett |
| ViewPurchasedTickets | `room:state` / `room:resume` | OK | |
| ReplaceElvisTickets | `ticket:replace` | OK | |
| SelectLuckyNumber, SetLuckyNumber, GetLuckyNumber | `lucky:set` | OK | |
| StartGame, StopGameByPlayers | `admin:force-end`, `game:start`/`game:end` | OK | |
| SwapTicket (Game5) | — | **MANGLER** | Game5-unik, ikke i ny |
| Game5Data, Game5Play | `room:state`, `bet:arm`, `draw:next` | DELVIS | Slot-rulett-fysikk ikke i `BingoEngine` |
| SelectRouletteAuto, SelectWofAuto (Game5) | — | **MANGLER** | Auto-select rulett + WoF |
| Game4Data, Game4Play, Game4ChangeTickets, Game4ThemesData | — | OK (Game4 deprecated) | |
| Game2TicketPurchaseData, Game2PlanList, Game3PlanList | `room:state` | OK | |
| GetGame3PurchaseData, game3TicketBuy, game3TicketCheck, game3TicketCheck32, getGame3PurchaseData | (integrert) | DELVIS | Game3-spesifikk purchase-data — må sjekke client |
| checkForWinners (Game5) | `claim:submit` | OK | |
| gameFinished (Game1) | `game:end` | OK | |
| ColorDraftGameData, SelectColorDraft | `minigame:play` | OK | |
| MysteryGameData, SelectMystery, MysteryGameFinished | `minigame:play` | OK | |
| TreasureChestData, SelectTreasureChest | `minigame:play` | OK | |
| WheelOfFortuneData, PlayWheelOfFortune, WheelOfFortuneFinished | `minigame:play` (og/eller `jackpot:spin`) | OK | |

### 2.2 Chat / Voucher / Extra-draw

| Legacy | Ny | Status |
|---|---|---|
| SendGameChat | `chat:send` | OK |
| GameChatHistory | `chat:history` | OK |
| ApplyVoucherCode (Game2/3/4) | — | **MANGLER** (men Game4-voucher deprecated; Game2/3-voucher må avklares) |
| RedeemVoucher | — | **MANGLER** |
| VoucherList | — | **MANGLER** |
| — | `draw:next`, `draw:extra:purchase` | Ny feature (per-round ekstra trekk) |

### 2.3 Common (spiller-sesjon, profil, innstillinger)

| Legacy event | Ny | Status | Kommentar |
|---|---|---|---|
| LoginPlayer, LoginWithUniqueId, ReconnectPlayer, RefreshAccessToken, VerifyPassword | — | **MANGLER** via socket | Ny bruker HTTP `/api/auth/*` — OK arkitektur-messig |
| Logout | — | OK (via HTTP) | |
| RegisterPlayer, playerForgotPassword, playerChangePassword, verifyByBankId | — | OK (HTTP) | |
| Playerprofile, PlayerDetails, UpdateProfile, playerProfilePic, playerStatistics | — | **MANGLER** | Profil-API på socket — ikke portert, men HTTP finnes delvis |
| PlayerSettings, PlayerSoundAndVoiceSettings, PlayerUpdateInterval, updatePlayerLanguage | — | **MANGLER** | |
| ScreenSaver | — | **MANGLER** | |
| EnableNotification, UpdateFirebaseToken, PlayerNotifications, sendMulNotifications | — | **MANGLER P1** | Hele push-notifikasjon-subsystem |
| BlockMySelf, SetLimit, AddOrUpdateBlockRule, CheckPlayerBreakTime, ResponsibleGameing, PlayerHallLimit | — (via HTTP wallet endpoints) | OK — konseptuelt | |
| DepositMoney, WithdrawMoney, TransactionHistory | (via HTTP) | OK | |
| myWinnings, lastHourLossProfit | — | **MANGLER** | |
| AvailableGames, GamePlanList, GameTypeData, GameTypeList, HallList, GetApprovedHallList, IsHallClosed, SwitchHall | `GET /api/games`, `GET /api/halls` (HTTP) | OK konseptuelt, men mangler socket-variant for runtime |
| Home, Leaderboard, Aboutus, FAQ, Support, Terms, Links | — | MANGLER (CMS + HTTP trenger view-data) |
| GameOnlinePlayerCount | `room:state` (players list) | OK |
| CheckRunningGame, createBotPlayers | — | MANGLER |
| DeletePlayerAccount | — | **MANGLER** (GDPR-right) |
| Localaccess, testingCallEvent | — | OK (debug) |
| disconnect, disconnecting | `disconnect` | OK |

### 2.4 AdminEvents (TV-skjerm + hall-display)

| Legacy event | Ny | Status |
|---|---|---|
| joinHall, joinRoom, onHallReady | `admin-display:subscribe`, `admin:room-ready`, `admin:login` | OK |
| getNextGame, getOngoingGame | `admin-display:state`, `room:state` | OK |
| getHallBalance | — | **MANGLER** |
| gameCountDownTimeUpdate, secondToDisplaySingleBallUpdate | `admin-display:state` (antatt) | DELVIS |
| transferHallAccess, checkTransferHallAccess, approveTransferHallAccess | — | **MANGLER** |
| getWithdrawPenddingRequest | — | MANGLER |
| AdminHallDisplayLogin (Game1) | `admin-display:login` | OK |
| TvscreenUrlForPlayers | — | **MANGLER** |

---

## 3. Moduler / features som mangler i apps/backend

### 3.1 Cron-jobs og bakgrunns-jobber (P0 for pilot)

Legacy `Boot/Server.js:583–618` har:
- **Daily 00:00 CronJob**: `deleteDailySchedules`, `generateExcelOfWithdraw`, `autoCloseTicket(Metronia)`, `autoCloseTicket(OK Bingo)`, `checkBankIdAndIdCardExpiryAndSendReminders`, `updatePlayerBlockRules` (remove expired)
- **Hourly CronJob**: `swedbankpayCronToUpdateTransaction`
- **Every 15s setInterval**: `startGameCron` (start scheduled games)
- **Every 1min setInterval**: `sendGameStartNotifications` (push før spill)
- **Every 5min setInterval**: `game1StatusCron`
- **On restart**: `handleServerRestart` (Game4 recovery)

**Ny backend har:** `DrawScheduler` (`apps/backend/src/draw-engine/DrawScheduler.ts`) som er runtime-trekning, og en `schedulerSetup.ts` som støtter daily-report scheduler. **Mangler alle 7 bakgrunns-jobber over.**

Det er **ingen cron-motor** i `apps/backend/package.json` (ingen `node-cron` / `cron`).

### 3.2 Push-notifikasjoner (FCM) — P1

- Legacy: `fcm-node`, `fcm-notification`, `firebase-admin`. Brukes i `App/Controllers/advertisementController.js` for SMS/push til spillere.
- Ny: **Ingen FCM-integrasjon.** `firebaseToken` finnes ikke i `app_users`-skjema.

Hvis mobil-appen (Android/iOS) skal motta push-varsler, må dette bygges.

### 3.3 E-post — P1

- Legacy: `nodemailer` brukes i Auth, PlayerController, AgentController, advertisementController til:
  - Reset-passord
  - Deposit/withdraw bekreftelser
  - BankId/ID-card expiry reminders
  - Admin daglig-rapport eksport
- Ny: `nodemailer` brukes kun i `spillevett/reportExport.ts` for Spillevett-rapport-eksport.

**Mangler:** reset-password-epost, deposit/withdraw-epost, alle admin-eposter.

### 3.4 PDF-generering

- Legacy: `pdfkit` (ikke direkte bruk i kjerne-kode — Excel via `exceljs`)
- Ny: `pdfkit` brukes i Spillevett-rapport. OK.

### 3.5 Excel-eksport

- Legacy: `exceljs`, `xlsx`, `fast-csv` brukes for admin-rapporter (`generateExcelOfWithdraw`, etc.)
- Ny: **Ikke bygget.** Rapport-endepunkt returnerer JSON/CSV i admin-routes. PDF-eksport for Spillevett finnes.

### 3.6 SMS

- Legacy: `POST /sms-advertisement/send-sms-notification`, `sms-advertisement/search-players` — sender SMS via tredjepart (trolig Swedbank/Twilio via custom).
- Ny: **Ikke bygget.**

### 3.7 Session / autentisering

- Legacy: `express-session`, `passport`, `passport-local`, `passport-google-oauth20`, `cookie-session`, `connect-flash` (tradisjonell web-session)
- Ny: JWT-basert (via `@spillorama/shared-types`), Bearer tokens. **Arkitektur-forskjell — OK.**

### 3.8 Tredjeparts-integrasjoner

| Legacy | Ny |
|---|---|
| Swedbank Pay (pagination + txn-cron) | Swedbank Pay (ny service) — OK |
| CoinPayments (crypto) | — mangler (men trolig ikke i bruk) |
| Firebase / FCM | — **mangler** |
| Metronia bingomaskin API (`App/Controllers/machineApiController.js`) | — **mangler** (P1 hvis Metronia-integrasjon skal beholdes) |
| OK Bingo maskin API | — **mangler** |
| BankId (svensk) | `BankIdKycAdapter.ts` — OK (men sjekk om Norsk BankID) |
| ID-card verify | — kombinert i KYC-adapter |

### 3.9 Diverse mangel

- **i18n** — legacy har `i18next` + egne i18n-filer (`Config/i18n.js`, `i18nAdmin.js`). Ny har **ingen oversettelser** i backend-responses.
- **File upload** — `multer`, `express-fileupload` i legacy (avatar, csv-import). Ny har ikke.
- **Bot-players** (test-hjelpere) — `createBotPlayers`, `Game4BotInjection`, `startBotGame`. Finnes kun som load-tests i `apps/backend/load-tests`.

---

## 4. Spill-spesifikk logikk — status per spill

### Game 1 (Spiloarama) — OK/DELVIS

- **Legacy:** `Game/Game1/Controllers/GameController.js` (4056 linjer) + `GameProcess.js` (6261 linjer) + `gamehelper/game1.js` + `game1-process.js` (4219 linjer totalt)
- **Ny:** `apps/backend/src/game/BingoEngine.ts` (2518 linjer) + `variantConfig.ts` + `ticket.ts`. Generisk engine som tar `variantConfig` for å håndtere Game1-spesifikke regler.
- **Ported:** Draw-logikk, pattern-matching, ticket colors, mini-games (wheelOfFortune/treasureChest/mysteryGame/colorDraft rotering), lucky number, bingo-claim, extra-draw, jackpot spin.
- **Client:** `packages/game-client/src/games/game1/` med README + audit-rapport + porterings-guide.
- **Mangler:** Bot-injeksjon, "save game" (pause og fortsett senere), re-seed spill fra krasj (partial recovery i legacy).

### Game 2 — DELVIS

- **Legacy:** 2538 linjer (GameController 1319 + GameProcess 1219)
- **Ny:** Delvis via `BingoEngine` med `gameType = "rocket"`. `variantConfig.ts` har rocket-variant. Client finnes.
- **Mangler:** `Game2BuyBlindTickets` (blind-kjøp), voucher-logikk (`ApplyVoucherCode`), rocket-jackpot-spesifikk animasjon-styring (trolig client-side).

### Game 3 — DELVIS

- **Legacy:** 1750 linjer + `gamehelper/game3.js` (1839 linjer)
- **Ny:** Via `BingoEngine`. Client finnes.
- **Mangler:** `GetGame3PurchaseData`, `game3TicketCheck32` (32-patter variant).

### Game 4 (Temabingo) — DEPRECATED OK

- Lukket per BIN-496 (2026-04-17). Ikke port.

### Game 5 (Slot-rulett-bingo) — DELVIS/GAP

- **Legacy:** `Game/Game5/Controllers/GameController.js` (756) + `GameProcess.js` (1531) + `gamehelper/game5.js` (1172)
- **Ny:** Client `packages/game-client/src/games/game5/` refererer 8 G5-unike features per README §11.
- **Mangler backend:** `SwapTicket`, `SelectRouletteAuto`, `SelectWofAuto`, rulett-fysikk (animasjons-data), Free Spin Jackpot-logikk, Game5-unike billettfarger, auto-select-preferanser, KYC-gate-logikk (delvis gjennom `isGameAvailbaleForVerifiedPlayer` — må sjekkes).

---

## 5. DB-skjema + migrasjoner

### 5.1 Legacy Mongoose-modeller (55 stk)

```
agent, agentRegisteredTickets, agentSellPhysicalTickets, agentShift, agentTransactions,
assignedHalls, background, blokedIp, category, chats, cms, dailySchedule, dailyTransactions,
depositMoney, error, faq, game, gameType, groupHall, hall, hallCashTransaction, hallReport,
leaderboard, loginHistory, loyaty, notification, otherGame, parentGame, pattern, player,
playerWithdraw, product, productCart, riskCountry, role, savedGame, schedule, security,
setting, settlement, slotmachine, socket, staticPhysicalTickets, staticTickets, subGame,
subGame1, subGame5, subGameSchedule, theme, ticket, ticketBallMappings, transactions, user, voucher
```

### 5.2 Ny PostgreSQL (29 tabeller)

```
wallet_accounts, wallet_transactions, wallet_entries,
app_users, app_sessions,
app_games, app_game_settings_change_log,
app_halls, app_terminals, app_hall_registrations, app_hall_game_config,
app_hall_display_tokens, app_chat_messages,
hall_game_schedules, hall_schedule_log,
game_sessions, game_checkpoints,
app_rg_personal_loss_limits, app_rg_pending_loss_limit_changes,
app_rg_restrictions, app_rg_play_states, app_rg_loss_entries,
app_rg_prize_policies, app_rg_extra_prize_entries,
app_rg_payout_audit, app_rg_compliance_ledger, app_rg_daily_reports,
app_rg_overskudd_batches, app_rg_hall_organizations,
swedbank_payment_intents
```

### 5.3 Manglende DB-tabeller/collections (funksjonelt)

| Legacy collection | Formål | Ny? | Status |
|---|---|---|---|
| agent, agentShift | Agent-entitet | — | **MANGLER** |
| agentRegisteredTickets, agentSellPhysicalTickets | Agent-billett-operasjoner | — | **MANGLER** |
| agentTransactions, hallCashTransaction | Agent/hall kasse | — | **MANGLER** |
| assignedHalls | Player-hall-tilhørighet | `app_hall_registrations` | OK |
| background, theme, cms, faq | CMS | — | MANGLER |
| blokedIp, riskCountry | Sikkerhet/compliance | — | **MANGLER** |
| category | Generelle kategorier | — | MANGLER |
| chats | Chat-historikk | `app_chat_messages` | OK |
| dailySchedule, schedule, parentGame, savedGame, subGameSchedule | Scheduling | `hall_game_schedules`, `hall_schedule_log` | DELVIS (master/group-konsept droppet) |
| dailyTransactions | Daglig balanse | — | **MANGLER** |
| depositMoney | Deposit-requests | (via wallet_transactions type=TOPUP) | DELVIS — legacy har egen request-queue for manuell godkjenning |
| error | Feil-logging i DB | — | MANGLER (sentry + console.log brukes) |
| groupHall | Gruppehall | — | **MANGLER** (konsept droppet?) |
| hallReport | Hall-rapport per dag | `app_rg_daily_reports` | DELVIS |
| leaderboard | Leaderboard-data | (implisitt via transactions) | OK (GET /api/leaderboard finnes) |
| loginHistory | Login-audit | `app_sessions` | DELVIS |
| loyaty | Lojalitetspoeng | — | MANGLER (men disabled i legacy cron også) |
| notification | Push-kø | — | **MANGLER** |
| otherGame | Ekstern-spill-konfig (Candy) | — | **MANGLER** P0 |
| pattern, subGame, subGame1, subGame5 | Pattern + game variant-config | `hall_game_schedules.variant_config` (JSONB) | OK — arkitektur-endring |
| player | Bruker-data (stor!) | `app_users` | DELVIS — mangler `firebaseToken`, `enableNotification`, `blockRules` (nå i `app_rg_*`), `selectedLanguage`, `avatar`, `phone`, `bankIdAuth`, `isVerifiedByHall`, `startBreakTime`, `endBreakTime`, mange flere |
| playerWithdraw | Withdraw-requests | — | **MANGLER** (request-queue for manuell godkjenning) |
| product, productCart | Produkt-salg | — | **MANGLER** |
| role | Roller/tillatelser | (i `app_users.role`) | DELVIS |
| security | Security-log | — | MANGLER |
| setting | Generelle settings | (i `app_game_settings_change_log`) | DELVIS |
| settlement | Daglig settlement | — | **MANGLER** |
| slotmachine | Metronia/OKBingo maskin-integrasjon | — | **MANGLER** (P1 hvis kreves) |
| socket | Socket-session-mapping | — | OK (i Redis nå) |
| staticPhysicalTickets, staticTickets | Pre-printede fysiske billetter | — | **MANGLER** |
| ticket | Kjøpte billetter (historisk) | (via `game_sessions`/`game_checkpoints`) | DELVIS |
| ticketBallMappings | Ball-til-billett mapping | — | (beregnes on-the-fly i `BingoEngine`) OK |
| transactions | Generell transaksjons-tabell | `wallet_transactions` + `wallet_entries` | OK |
| user | Admin-brukere | (i `app_users` med role) | OK |
| voucher | Vouchers | — | **MANGLER** (men Game4-deprecated) |

**Manglende tabeller kritisk for pilot:** `otherGame` (Candy), `playerWithdraw` (withdrawal-kø), `depositMoney` (deposit-kø), utvidelse av `app_users` med push/notif/language-felt, `notification`-kø.

---

## 6. Oppsummering / anbefaling

### Prioritet P0 — blokker pilot / Compliance

1. **Candy-integrasjon (`/api/games/candy/launch` + `otherGame` DB)** — kjent arkitektur-gap. Er nødvendig hvis Candy skal være i pilot.
2. **Cron-jobs:** minst `swedbankpayCronToUpdateTransaction` (hver time) og `checkBankIdAndIdCardExpiryAndSendReminders` (daglig) + `updatePlayerBlockRules` (rydd expired block rules) + `startGameCron` hvis `DrawScheduler` ikke dekker runtime-start av ventede spill.
3. **Manuell deposit/withdraw-godkjenning** — `/deposit/requests`, `/withdraw/requests` endpoints + queue-tabell. Uten disse kan ikke hall-ansatte håndtere ikke-automatiserte innskudd/uttak.
4. **Agent-workflow (hvis agent-app skal i pilot)** — fysisk-billett-salg, daglig-balanse, settlement, unique-id. 78 endepunkter, nær 100% utelatt.
5. **Pending-player KYC-queue** — approve/reject pending players, reverify BankId, soft delete, player import.
6. **Metronia + OKBingo maskin-API** — hvis fysiske maskiner skal støttes i pilotens haller.

### Prioritet P1 — før pilot-GA

7. **Push-notifikasjoner (FCM)** — hele notif-subsystemet mangler. Mobil-app kan ikke få game-start-varsler uten dette.
8. **E-post-transport** — reset-password + deposit/withdraw-bekreftelse + BankId-reminder. Bruk eksisterende nodemailer-oppsett fra Spillevett.
9. **Admin-CRUD for haller + brukere** — opprette halls/terminaler finnes, men mangler users CRUD, roller, blocked-ip, risk-country.
10. **Voucher / promo-kode** — hvis promo-system skal i bruk (ikke Game4-voucher som er deprecated).
11. **Maintenance-mode + restart-server** endpoints (ops-verktøy).
12. **i18n** for backend-feilmeldinger (p.t. engelske strenger).

### Prioritet P2 — etter pilot

13. **CMS-admin** (faq, about, terms, theme, background, popup_modal) — kan dekkes av ekstern CMS eller hard-kodet i admin-web.
14. **Produkt-salg** (`/productList`, `/agent/sellProduct`, cart/order) — hvis produktsalg skal støttes.
15. **Historiske rapporter** med drill-down per spill og settlement per hall.
16. **Loyalty-system** (legacy har disabled cron — trolig uten verdi).
17. **Screen saver / popup modal / TV-screen URL-konfigurasjon**.

### Arkitektur-gode endringer i ny stack

Følgende er bedre i ny backend og bør **ikke** regnes som mangel:
- JSON-API istedenfor server-rendered nunjucks views (admin-web er separat SPA).
- Konsoliderte socket-events (`room:*`, `draw:*`, `ticket:*`) istedenfor per-spill `Game1Room`, `Game2Room`.
- PostgreSQL med strukturert RG-ledger (`app_rg_*`) istedenfor ad-hoc MongoDB.
- Egne `wallet_entries` (double-entry) istedenfor `transactions`-blob.
- Prize policy som versjonert config.
- Hall display tokens (TV-skjerm-auth).
- Draw engine med watchdog + error classifier.
- Overskudd/ideelle-org-distribusjon bygget inn.
- Spillevett-rapport med PDF-eksport.

### Estimert port-tid (grovt, dev-dager)

| Område | Estimat |
|---|---:|
| P0: Candy-launch + `otherGame`-tabell | 3 |
| P0: Cron-jobs (Swedbank txn, BankId-reminder, block-rules cleanup) | 2 |
| P0: Deposit/withdraw manual queues | 4 |
| P0: Agent-workflow (78 endepunkter, delvis mulig å droppe avhengig av pilot-scope) | 12–18 |
| P0: Metronia + OKBingo adapter | 5 |
| P0: Pending-player KYC-queue | 3 |
| P1: Push-notifikasjoner (FCM) | 4 |
| P1: E-post-transport + templates | 2 |
| P1: Admin user/role CRUD | 4 |
| P1: Voucher + promo | 3 |
| P1: i18n + maintenance-mode | 2 |
| P2: CMS-admin | 4 |
| P2: Produkt-salg | 5 |
| P2: Historiske rapporter + settlement | 5 |
| DB-migrasjoner | 3 |
| Tests + e2e | 5 |
| **SUM** | **61–67 dager** |

Hvis Agent-workflow droppes fra pilot → **43–49 dager**.
Hvis Metronia + produkt-salg også droppes → **34–40 dager**.

### Topp 5 mest kritiske mangler

1. **Candy-spill launch-endpoint + `otherGame`-tabell** (P0 arkitektur-gap, ettersom Candy iframe-embed er kjent hull per memory).
2. **Hele agent-domenet** (78 endepunkter) — fysiske billetter, kasse, settlement. Blokker agent-app hvis den skal i pilot.
3. **Cron-jobs for Swedbank txn-sync og BankId-expiry-reminder** — pengespill-compliance og daglig drift.
4. **Manuell deposit/withdraw-godkjenningsflyt** — hall-ansatt kan ikke prosessere ikke-automatiserte innskudd/uttak.
5. **Push-notifikasjoner (FCM)** — mobil-app mister spill-start-varsler og alle andre varsler.

---

_Kilde-filer for audit-gjennomgang:_
- Legacy routes: `/Users/tobiashaugen/Projects/Spillorama-system/.claude/worktrees/slot-1/legacy/unity-backend/App/Routes/{backend,frontend,integration}.js`
- Legacy sockets: `/Users/tobiashaugen/Projects/Spillorama-system/.claude/worktrees/slot-1/legacy/unity-backend/Game/*/Sockets/*.js`
- Legacy cron: `/Users/tobiashaugen/Projects/Spillorama-system/.claude/worktrees/slot-1/legacy/unity-backend/Boot/Server.js:583-618`
- Legacy models: `/Users/tobiashaugen/Projects/Spillorama-system/.claude/worktrees/slot-1/legacy/unity-backend/App/Models/*.js`
- Ny routes: `/Users/tobiashaugen/Projects/Spillorama-system/.claude/worktrees/slot-1/apps/backend/src/routes/*.ts`
- Ny sockets: `/Users/tobiashaugen/Projects/Spillorama-system/.claude/worktrees/slot-1/apps/backend/src/sockets/*.ts`
- Ny migrasjoner: `/Users/tobiashaugen/Projects/Spillorama-system/.claude/worktrees/slot-1/apps/backend/migrations/*.sql`
