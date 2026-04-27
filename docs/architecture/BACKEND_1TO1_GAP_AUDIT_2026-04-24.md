# Backend 1:1 gap-audit
_2026-04-24_

## Sammendrag

Denne auditen sammenligner **legacy Node.js/Mongo-backend** (`legacy/unity-backend/` per commit `5fda0f78` — 10 715 filer) mot **ny TypeScript/Postgres-backend** (`apps/backend/src/` med 74 HTTP-route-filer og 90 migrations).

- **Totalt antall gaps identifisert:** 38
  - **P0 (pilot-blokker):** 11
  - **P1 (pre-GA):** 14
  - **P2 (post-pilot):** 13
- **Estimert total effort:** ~45-60 dev-dager (~10-12 uker for 1 dev, ~5-6 uker for 2 dev)

Sammenligningsgrunnlag:
- Legacy: 515 unike HTTP-routes (`backend.js` 776 L + `integration.js` 533 L + `frontend.js` 12 L), 5 game-namespaces + 1 admin-namespace socket, 54 Mongo-modeller, 26 Services, 4 aktive cron/interval-kilder i `Boot/Server.js`.
- Ny: 430 unike routes, 1 default-namespace + 3 admin-namespaces socket, 90 SQL migrations, 10 jobs, 60+ services fordelt på `admin/`, `agent/`, `auth/`, `compliance/`, `game/`, `integration/`, `notifications/`, `payments/`, `platform/`, `spillevett/`.

Allerede dekket / i merge-kø per 2026-04-24 (ekskludert fra gap-listen under): #442-#448, #450, #451, #452, #453, #454, #455, #456, #460-#468.

---

## 1. HTTP-endepunkter

Legacy-routes gruppert etter domene, med status mot ny stack. **🟢** = fullt ekvivalent, **🟡** = delvis dekket / shape-forskjell, **🔴** = mangler helt, **⚪** = bevisst droppet (ikke-mål).

### 1.1 Auth + profile

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `GET /admin` + `POST /admin` (login) | `POST /api/admin/auth/login` | 🟢 | — |
| `GET /forgot-password` + `POST /forgot-password` | `POST /api/auth/forgot-password` | 🟢 | — |
| `GET /reset-password/:token` + `POST /reset-password/:token` | `GET /api/auth/reset-password/:token` + `POST /api/auth/reset-password/:token` | 🟢 | — |
| `POST /profile/update` + `/profile/changePwd` + `/profile/changeAvatar` + `/profile/updateLanguage` | `PUT /api/auth/me`, `POST /api/auth/change-password`, `POST /api/agent/auth/change-avatar`, `POST /api/agent/auth/update-language` | 🟢 | Admin-side av change-avatar finnes kun for agent — ikke for admin |
| `POST /profile/changeSmsUsrPwd` | — | 🔴 | Egen SMS-provider-bruker/passord settes av admin (sveve credentials mgmt) |
| `GET /register` (opprett admin) | `POST /api/admin/users` | 🟢 | — |

### 1.2 Dashboard

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `GET /dashboard` | `GET /api/admin/dashboard/live` | 🟢 | — |
| `GET /dashboardChart/getMonthlyPlayedGameChart` | `GET /api/admin/dashboard/time-series` | 🟡 | Month-vs-game-split kanskje ikke 1:1 — må verifisere payload-shape |
| `GET /dashboardChart/getGameUsageChart` | `GET /api/admin/dashboard/time-series` (samme?) | 🟡 | Samme bekymring |
| `GET /dashboard/gameHistory` | `GET /api/admin/dashboard/game-history` | 🟢 | — |
| `GET /dashboard/getTopPlayers/:id` | `GET /api/admin/dashboard/top-players` | 🟢 | — |
| `GET /dashboard/ongoingGames/:gameType` | `GET /api/admin/dashboard/live` | 🟡 | `gameType`-param-filter må verifiseres |

### 1.3 Players (admin)

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `GET /player` + `/player/getPlayer` | `GET /api/admin/players/search` | 🟢 | — |
| `GET /viewPlayer/:id` | `GET /api/admin/players/:id` | 🟢 | — |
| `POST /playerEdit/:id` | `PUT /api/admin/players/:id` | 🟢 | — |
| `POST /changePwd/:id` | `POST /api/admin/users/:id/reset-password` | 🟡 | Reset-password finnes men ikke "change direct" |
| `POST /player/hallStatus` | `PUT /api/admin/players/:id/hall-status` | 🟢 | — |
| `POST /player/getPlayerDelete` + `/player/playerSoftDelete` + `/player/active` | `POST /api/admin/players/:id/soft-delete` + `POST /api/admin/players/:id/restore` | 🟢 | — |
| `GET /pendingRequests` + `/pendingRequests/getPendingPlayer` + `/pendingRequests/viewPendingPlayer/:id` | `GET /api/admin/players/pending` | 🟢 | — |
| `POST /pendingRequests/approvePendingPlayer` | `POST /api/admin/players/:id/approve` | 🟢 | E-post sendes via `emailService.sendTemplate('kyc-approved', …)` |
| `POST /pendingRequests/rejectPendingPlayer` | `POST /api/admin/players/:id/reject` | 🟢 | E-post `kyc-rejected` sendes |
| `POST /pendingRequests/forwardRequest` | — | 🔴 | **GAP #1**: agent kan ikke forward-eskalere pending-request til admin-desken |
| `GET /rejectedRequests` + `/player/getRejected` | `GET /api/admin/players/rejected` | 🟢 | — |
| `POST /player/deleteRejected` | — | 🔴 | **GAP #2**: admin kan ikke permanent-slette avviste spillere (kun soft-delete på approved) |
| `POST /player/approveRejected` | `POST /api/admin/players/:id/resubmit` | 🟡 | Flow-navn ulikt — kan være ok, må verifiseres |
| `POST /player/reverify-bankid` | `POST /api/admin/players/:id/bankid-reverify` | 🟢 | — |
| `POST /player/verify/update` | `PUT /api/admin/players/:id/kyc-status` | 🟢 | — |
| `POST /player/block-rules/delete` | — | 🔴 | **GAP #3**: admin-side block-rules-delete (cron rydder automatisk, men ingen manuell override) |
| `POST /player/import` + `/player/import/confirm` | `POST /api/admin/players/bulk-import` | 🟡 | Én endpoint uten to-steg-preview/confirm — legacy har validering + dupe-handling med separat confirm |
| `GET /player/getGroupHalls` + `/player/getHalls` + `/player/getAgents` | `GET /api/admin/hall-groups`, `GET /api/admin/halls`, `GET /api/admin/agents` | 🟢 | — |
| `GET /players/track-spending*` (4 routes) | `GET /api/admin/track-spending*` (2 routes) | 🟢 | Detalj-view + drill-down er verifisert |
| `GET /viewRejectedPlayer/:id` | `GET /api/admin/players/:id` | 🟢 | Samme record, bare annen URL |
| `GET /playerTransactions/:id` + `/getPlayerTransactions` | `GET /api/admin/players/:id/transactions` | 🟢 | — |
| `GET /playerGameHistory/:id` + `/getPlayerGameHistory` | `GET /api/admin/players/:id/game-history` | 🟢 | — |
| `GET /playerGameManagementDetailList/:id` + `/playerGetGameManagementDetailList` | — | 🔴 | **GAP #4**: per-spiller-game-management-detaljer (ticket + win-history aggregert) |

### 1.4 Player app (player-facing APIer + payment webhooks)

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `POST /player/register` (socket fallback) | `POST /api/auth/register` | 🟢 | — |
| `GET /player/transactions/:id` + `/player/depositMoney` | `GET /api/wallet/me/transactions` | 🟢 | — |
| `POST /player/profile/image/update` | — | 🔴 | **GAP #5**: player-profile-image-upload mangler i ny stack (bankID + selfie-docs) |
| `POST /player/approved/update-flag` | — | 🔴 | **GAP #6**: re-flag "isAlreadyApproved" for pre-BankID players (kun relevant om vi migrerer data) |
| `POST /updatePlayerLanguageIfnotexist` | `POST /api/agent/auth/update-language` (agent) | 🟡 | For agent, ikke player — players-only-endpoint mangler |
| `GET /payment/iframe/:checkoutId` | — | 🔴 | **GAP #7**: Swedbank iframe-launch-endpoint — ny har `/api/payments/swedbank/topup-intent` som gir redirectUrl men ingen `iframe`-wrap |
| `GET /payment/deposit/response` | — | 🔴 | **GAP #8**: Return-URL etter SwedbankPay-redirect (thank-you + auto-close iframe) |
| `POST /payment/webhook` | `POST /api/payments/swedbank/callback` | 🟢 | — |
| `POST /payment/goback` | — | 🔴 | **GAP #9**: Nativ-app "back to app" deeplink-endpoint etter payment |
| `GET /player/bankid/redirect` + `/player/bankId/iframe/:id` + `/player/bankid/goback` | `POST /api/auth/bankid/init` + `GET /api/auth/bankid/status/:sessionId` + `GET /api/auth/bankid/callback` | 🟡 | Semantisk ekvivalent men forskjellig flow (status-polling vs. redirect). Må verifisere at player-appen kan bruke begge former |

### 1.5 Transactions + deposit/withdraw

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `GET /deposit/requests` + `/deposit/requests/get` | `GET /api/admin/payments/requests` | 🟢 | — |
| `POST /deposit/requests/accept` + `/deposit/requests/reject` | `POST /api/admin/payments/requests/:id/accept` + `reject` | 🟢 | — |
| `GET /deposit/history` + `/deposit/history/get` | `GET /api/admin/deposits/history` (CSV via `?format=csv`) | 🟢 | **GAP #10 LUKKET** (Agent K3-B 2026-04-25): cursor-pagination + filter (fromDate/toDate/hallId/status/type/playerId) + CSV-eksport. Hall-scope auto-tvunget for HALL_OPERATOR. |
| `GET /withdrawAmt` + `/withdrawAmount/getAllTXN` | — | 🔴 | **GAP #11**: Admin "Withdraw Amount"-side for manual chips-action/withdrawal |
| `POST /withdrawAmount/chipsAction` + `/withdrawAmount/getPlayerDelete` | `POST /api/admin/wallets/:walletId/credit` | 🟡 | Credit finnes, men ikke debit/chipsAction med samme shape |
| `GET /withdraw/requests/hall` + `/withdraw/requests/hall/get` | `GET /api/admin/payments/requests` (filter=withdraw+hall) | 🟡 | Shape må verifiseres — filter-param ukjent |
| `GET /withdraw/requests/bank` | `GET /api/admin/payments/requests` (filter=withdraw+bank) | 🟡 | Samme |
| `POST /withdraw/requests/accept` + `/withdraw/requests/reject` | `POST /api/admin/payments/requests/:id/accept/reject` | 🟢 | — |
| `GET /withdraw/history/hall` + `/withdraw/history/bank` + `*/get` | `GET /api/admin/withdrawals/history?type=hall\|bank\|all` (CSV via `?format=csv`) | 🟢 | **GAP #12 LUKKET** (Agent K3-B 2026-04-25): konsolidert til ett endepunkt med `?type` for å skille bank/hall. Cursor-pagination + filter (fromDate/toDate/hallId/status/playerId) + CSV-eksport. Hall-scope auto-tvunget. |
| `GET /withdraw/list/emails` + `/withdraw/add/emails` + `/withdraw/edit/emails/:id` + `/withdraw/delete/emails/` + `/withdraw/email/checkUnique` | `GET /api/admin/security/withdraw-emails` + `POST` + `DELETE` | 🟡 | Edit-endpoint mangler, og check-unique-validering må verifiseres |
| `GET /totalRevenueReport` + `/getData` | `GET /api/admin/reports/revenue` | 🟢 | — |
| `GET /transactionsPaymet` | — | 🔴 | **GAP #13**: Admin-legacy "transactions payment"-view (uspesifisert — sjekker om det bare er en route-alias) |

### 1.6 Game Management (rooms, schedules, sub-games, patterns, saved games)

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `GET /gameType` + `/getGameType` + `POST /addGameType` + `/editGameType/:id` + `DELETE /deleteGameType` + `/viewGameType/:id` | `GET/POST/PUT/DELETE /api/admin/game-types[/:id]` | 🟢 | — |
| `GET /subGame` + `/addSubGame` + `/subGameEdit/:id` + `DELETE /getSubGameDelete` + `POST /checkForGameName` | `GET/POST/PATCH/DELETE /api/admin/sub-games[/:id]` | 🟢 | — |
| `GET /gameManagement*` + `/addGameManagement*` + `/gameManagementEdit*` + `/getGameManagementDelete` + `/repeatGame/:typeId` + `/stopGame/:typeId` | `GET/POST/PATCH/DELETE /api/admin/game-management[/:id]` + `POST /api/admin/game-management/:id/repeat` | 🟢 | — |
| `POST /patternGame` | — | 🔴 | **GAP #14**: "Pattern game" — attach pattern til gameManagement-instance (kanskje dekket av sub-game + pattern koblinger) |
| `GET /patternGameDetailList/:id` + `/getPatternDetailList` + `POST /addPattern/*` + `/patternEdit/*` + `DELETE /getPatternDelete` + `/viewPattern/*` + `POST /checkForPatternName` | `GET/POST/PATCH/DELETE /api/admin/patterns[/:id]` + `/dynamic-menu` | 🟢 | — |
| `GET /savedGameList` + `/savedGameDetailList/:id` + `POST /addSavedGameManagement/*` + `/savedGameManagementEdit/*` + `/viewSaveGameManagement/:id` + `DELETE /getSaveGameDelete` | `GET/POST/PATCH/DELETE /api/admin/saved-games[/:id]` + `POST /:id/load-to-game` | 🟢 | — |
| `GET /closeDayGameManagement/:typeId/:id/:gameType` + `POST /closeDayAdd` + `GET /getCloseDayData` + `POST /deleteCloseDay` + `/updateCloseDay` | `GET /api/admin/games/:id/close-day-summary` + `POST /api/admin/games/:id/close-day` | 🟡 | **GAP #15**: close-day støtter kun én "closeDate" om gangen. Legacy støtter date-range (Single/Consecutive) og **Random** (wireframes). Per-date delete + update mangler også |
| `POST /game/auto-stop` (On/Off toggle) | `GET /api/admin/settings/games/:slug` + `PUT /api/admin/settings/games/:slug` | 🟡 | Auto-stop-toggle er likely i settings-katalog — må verifisere slug-navn |
| `POST /startGame` | `POST /api/admin/rooms/:roomCode/start` + `POST /api/admin/game1/games/:gameId/start` | 🟢 | — |
| `POST /stopGame1` + `/startManualGame` + `POST /agentReady` + `POST /addManualWinning` | `POST /api/admin/game1/games/:gameId/stop`, `/resume`, `/api/admin/game1/halls/:hallId/ready`, — | 🟡 | `addManualWinning` — admin manuelt legge til vinner — **GAP #16** |
| `GET /viewGameHistory/:id/:gameName` + `/viewPhysicalGameHistory/:id/:gameName` + `/viewTicket/:id/:ticketId` | `GET /api/admin/reports/games/:gameSlug/sessions` + `/drill-down` | 🟡 | Per-ticket-view (viewTicket) mangler konkret endpoint |

### 1.7 Schedules (weekly + daily)

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `GET /schedules` + `/getSchedules` + `POST /createSchedule` + `/editSchedule/:id` + `DELETE /deleteSchedule` + `/viewSchedule/:id` | `GET/POST/PATCH/DELETE /api/admin/schedules[/:id]` | 🟢 | — |
| `POST /api/saveSubGame` + `/api/saveSubGames` | `POST /api/admin/sub-games` | 🟢 | — |
| `GET /schedules/getStoredSubGame` + `/getStoredSubGameData` + `/getStoredSubGames` + `/checkStoreSubGameName` | `GET /api/admin/sub-games[?…]` | 🟡 | Separate endpoints konsoliderte — må verifisere at UI kan konstruere samme queries |
| `POST /createDailySchedule` + `/editDailySchedule/:id` + `DELETE /deleteDailySchedule` + `/viewDailySchedule/:id` + `POST /saveDailySchedule` + `GET /viewSavedDailySchedule/:id` + `/editSavedDailySchedule/:id` + `POST /deleteSavedDailySchedule` | `GET/POST/PATCH/DELETE /api/admin/daily-schedules[/:id]` + `POST /special` | 🟢 | — |
| `POST /createDailySpecialSchedule` | `POST /api/admin/daily-schedules/special` | 🟢 | — |
| `GET /schedule/getAvailableGroupHalls/:type` + `/getAvailableGroupHallsBasedSlots/:type` + `/getSchedulesBySlot` + `/getHalls` + `POST /getMasterHallData` | spredt over `/api/admin/hall-groups`, `/api/admin/halls`, `/api/admin/schedules` | 🟡 | Slots-per-type + master-hall-data-concept må verifiseres |
| `GET /viewDailySchduleDetails/:id` + `/getCurrentSubgames/:id` | `GET /api/admin/daily-schedules/:id/details` | 🟢 | — |
| `GET /edit-subgame/:id` + `POST /edit-subgame/:id` + `/view-subgame/:id` + `/getGameAgents` | `GET/PATCH /api/admin/sub-games/:id`, `GET /api/admin/agents` (for gameAgents) | 🟡 | Delvis dekket — `/getGameAgents` per sub-game er ikke eksplisitt |

### 1.8 Halls, GroupHalls, Products

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `GET /hall` + `/getHall` + `POST /addHall` + `/hallEdit/:id` + `DELETE /hall/getHallDelete` | `GET/POST/PUT /api/admin/halls[/:id]` | 🟡 | DELETE mangler i ny stack — **GAP #17** |
| `POST /transferPlayersToHall` | — | 🔴 | **GAP #18**: Bulk-transfer spillere fra én hall til en annen (admin utility for hall-konsolidering) |
| `GET /getHalls` | `GET /api/admin/halls` | 🟢 | — |
| `POST /hall/report/saveData` | `POST /api/admin/reports/halls/:hallId/account/manual-entry` | 🟢 | — |
| `POST /hall/set-cash-amount` | `POST /api/admin/halls/:hallId/add-money` | 🟡 | Set vs add — legacy setter absolutt, ny legger til. Må verifiseres om begge er nødvendige |
| `POST /hall/check-hall-number` + `/hall/check-ip-address` | — | 🔴 | **GAP #19**: Pre-create validering av hallNumber (unik-sjekk) + IP-adresse (duplikat-sjekk) før form submit |
| `GET /hallAccountReport` + `/hallAccountReportTable/:id` + `/getHallAccountReport` | `GET /api/admin/reports/halls/:hallId/account-balance` + `/daily` + `/monthly` + `/summary` | 🟢 | — |
| `GET /groupHall` + `/getGroupHall` + `POST /addGroupHall` + `/groupHallEdit/:id` + `DELETE /groupHall/getGroupHallDelete` + `/groupHallView/:id` + `/removedGroup` + `/getAllGroupHalls/` | `GET/POST/PATCH/DELETE /api/admin/hall-groups[/:id]` | 🟢 | Minus `/removedGroup` (removed-state-arkiv — **GAP #20**) |
| `GET /productList` + `/products/getProducts` + `/getProduct/:id` + `POST /addProduct` + `/editProduct` + `DELETE /deleteProduct` + `/getCategories` | `GET/POST/PUT/DELETE /api/admin/products[/:id]` + `/product-categories` | 🟢 | — |
| `GET /categoryList` + `/categoryTable` + `POST /addCategory` + `/editCategory` + `DELETE /deleteCategory` | `/api/admin/product-categories` | 🟢 | — |
| `GET /hallProductList` + `/getHallsandProducts` + `/getHallWithProduct/:id` + `POST /addProductinHall` | `GET/PUT /api/admin/halls/:hallId/products` | 🟢 | — |

### 1.9 Withdraw XML-eksport + email-lister

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| (cron) `generateExcelOfWithdraw` | `xmlExportDailyTick` job + `POST /api/admin/withdraw/xml-batches/export` | 🟢 | — |
| `GET /withdraw/list/emails` + `POST /withdraw/add/emails` | `GET/POST /api/admin/security/withdraw-emails` | 🟢 | — |
| `GET /withdraw/edit/emails/:id` + `POST` | — | 🔴 | **GAP #21**: Edit eksisterende email (kun add + delete i ny) |

### 1.10 CMS (FAQ, Terms, Aboutus, ResponsibleGaming, Links)

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `GET /cms` + `/faq` + `/TermsofService` + `/Support` + `/Aboutus` + `/ResponsibleGameing` + `/LinksofOtherAgencies` | `GET /api/admin/cms/:slug` + `/api/admin/cms/:slug/history` + `/api/admin/cms/faq` | 🟢 | — |
| `GET /terms-of-service` (public) | — | 🔴 | **GAP #22**: Public-facing CMS-endpoint (ikke admin-gated) for player-app |
| `GET /getFAQ` + `POST /addFAQ` + `/faqEdit/:id` + `DELETE /getFAQDelete` | `GET/POST/PATCH/DELETE /api/admin/cms/faq[/:id]` | 🟢 | — |
| `POST /termEdit` + `/supportEdit` + `/aboutusEdit` + `/resposibleGameingEdit` + `/linksOfOtherAgenciesEdit` | `PUT /api/admin/cms/:slug` + `POST /:slug/versions` | 🟢 | — |

### 1.11 Unique ID, Physical tickets, Payouts

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `GET /uniqueId` + `POST /addUniqueId` + `/uniqueIdList` + `/unique/getUniqueId` | `POST /api/admin/unique-ids/check` + `GET /api/admin/unique-ids` + `GET /api/admin/unique-ids/:uniqueId` | 🟢 | — |
| `GET /viewUniqueDetails/:id` + `/unique/viewSpaceficTicketDetails` + `POST /checkUniqueId` + `/unique/withdrawAccess` + `/unique/depositWithdraw` | `GET /api/admin/unique-ids/:uniqueId` + `/transactions` | 🟢 | — |
| `GET /unique/transactions/:id` + `/unique/get/transactions/` | `GET /api/admin/unique-ids/:uniqueId/transactions` | 🟢 | — |
| `POST /generateTicket` + `/generateEditTicket` | `POST /api/agent/tickets/register` + `POST /api/admin/physical-tickets/batches/:id/generate` | 🟢 | — |
| `GET /addPhysicalTickets` + `POST /addPhysicalTickets` + `GET /getPhysicalTickets` + `POST /deletePhysicalTicket` + `GET /getLastRegisteredId` + `/getEditRegisteredId` + `POST /editPhysicalTickets` | `GET /api/admin/physical-tickets/batches` + `POST` + `GET /:id` + `DELETE /:id` + `GET /last-registered-id` + `PUT /:id` | 🟢 | — |
| `POST /addGamePhysicalTickets` + `GET /getSellPhysicalTickets/:gameId` + `POST /deleteSellPhysicalTicket` + `/deleteAllSellPhysicalTicket` + `/purchasePhysicalTickets` | `POST /api/admin/physical-tickets/batches/:id/assign-game` + `GET /api/admin/physical-tickets/games/:gameId/sold` + `DELETE /games/:gameId/sold` + `POST /api/agent/physical/sell` | 🟢 | — |
| `GET /hall/getAgent` | `GET /api/admin/agents?hallId=…` | 🟡 | Query-param-filter må verifiseres |
| `GET /physicalTicketManagement` + `/physical/ticketList` | `GET /api/admin/physical-tickets/batches` | 🟢 | — |
| `GET /payoutPlayer` + `/PayoutGameManagementDetailListPlayer/:id` + `/payoutPlayerGetGameManagementDetailList` + `/viewPlayerPayout/:id/:gameId/:type` | `GET /api/admin/payouts/by-player/:userId` | 🟢 | — |
| `GET /payoutTickets` + `/PayoutGameManagementDetailListTickets/:id` + `/payoutTicketsGetGameManagementDetailList` + `/viewTicketPayout/:gameId/:type` | `GET /api/admin/payouts/by-game/:gameId/tickets` | 🟢 | — |
| `GET /viewGameDetails/:typeId/:id` + `/viewGameTickets/:typeId/:id` + `/getTicketTable/:typeId/:id` + `/viewGameManagement/:typeId/:id` + `/viewsubGamesManagement/:typeId/:id` + `/viewsubGamesManagementDetails` + `/getGroupHallData` | `GET /api/admin/game-management/:typeId/…` + relaterte detalj-endpoints | 🟡 | Detalj-endpoint-shape må verifiseres mot legacy |

### 1.12 Agent/Cash-in-out/Shift/Settlement

Nær komplett 1:1 i ny stack — se #453, #454, #455, #461, #462, #465, #467 (merget).

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `POST /agent/dailybalance/add` + `GET /agent/dailybalance/get` | `POST /api/agent/shift/open-day` + `GET /api/agent/shift/daily-balance` | 🟢 | — |
| `GET /agent/register-user/add` + `/withdraw` + `POST /agent/player/check-validity` + `GET /register-user/balance/get` + `POST /register-user/balance/update` + `/check-validity-balance` | `POST /api/agent/players/lookup` + `POST /api/agent/players/:id/cash-in` + `/cash-out` + `GET /api/agent/players/:id/balance` | 🟢 | — |
| `POST /agent/control-daily-balance` | `POST /api/agent/shift/control-daily-balance` | 🟢 | — |
| `POST /agent/settlement` + `GET /agent/settlement/get-date` + `POST /agent/settlement/edit` | `POST /api/agent/shift/close-day` + `GET /api/agent/shift/settlement-date` + `PUT /api/admin/shifts/:shiftId/settlement` | 🟢 | — |
| `GET /agent/unique-id/add` + `/withdraw` + `POST /check-validity` + `GET /balance/get` + `POST /balance/update` | `POST /api/admin/unique-ids/check` + `POST /api/agent/players/lookup` (unified?) | 🟡 | Must check that agent-ui har alt som trengs — unique-id-type-of-player unified med regular player? |
| `GET /agent/game/status/pause` + `/get-my-group-halls` + `POST /agent/game/stop` + `GET /status/start` + `POST /game/start` + `/stop-option` | `POST /api/agent/bingo/check` + master-control routes | 🟡 | Agent-control vs admin-master-control separasjon må verifiseres |
| `GET /agent/cashout/view` + `/cashout/get` + `POST /agent/wof/reward` + `/agent/game/check-bingo` + `/agent/game/physical/cash-out` + `/add-to-wallet` + `POST /agent/reward-all` | `GET /api/agent/shift/physical-cashouts` + `/summary` + `POST /api/agent/physical/:uniqueId/reward` + `/physical/reward-all` + `POST /api/admin/physical-tickets/:uniqueId/check-bingo` | 🟢 | — |
| `POST /agent/sellProduct` + `/createCart` + `GET /productCheckout` + `POST /placeOrder` + `/cancelOrder` + `GET /orderHistory` + `/getOrderHistory` + `/viewOrder/:cartId` + `GET /agent/getGamesInHall` + `/agent/viewWonTickets/:id` + `/getPhysicalWinningInGame` + `GET /agent/sellProduct` (page) + `/agent/getGamesInHall` + `/agent/physical/sell/:gameId` + `/agent/game/completed` + `/agent/game/hall-status` + `POST /update-hall-status` | `POST /api/agent/products/carts` + `/carts/:id/finalize` + `/cancel` + `GET /api/agent/products/carts/:id` + `GET /api/agent/products` + `GET /api/agent/products/sales/current-shift` | 🟡 | Order-history er admin-visning — kan være OK via `/api/admin/…`-filtere |
| `GET /agent/upcoming-game/get` + `POST /stop` + `/resume` + `GET /check-resume-eligibility` | `GET /api/agent/shift/*` | 🟡 | Upcoming-game-control endpoints mangler konkrete 1:1-ekvivalenter |
| `GET /report/settlement/:id` + `/report/settlement` | `GET /api/admin/shifts/:shiftId/settlement` + `GET /api/admin/shifts/settlements` + `/:shiftId/settlement.pdf` + `/receipt` | 🟢 | — |

### 1.13 Machine API (Metronia, OK Bingo)

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `POST /agent/create-ticket` + `/add-balance` + `/get-balance` + `/close-ticket` + `/close-all-tickets` + `/get-numbers-today` + `/okbingo/open-day` | `POST /api/agent/metronia/register-ticket` + `/topup` + `/payout` + `/void` + tilsv. for okbingo + `POST /api/agent/okbingo/open-day` | 🟢 | — |
| (auskommentert i legacy: `/agent/metronia/check-connect` + `create-ticket` + `get-balance` + `add-balance` + `close-ticket` + `close-all-tickets`) | (tilsv.) | ⚪ | Kommentert ut — ikke aktivt endpoint |

### 1.14 Misc (leaderboard, voucher, loyalty, roles)

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `GET /leaderboard*` + `POST /addLeaderboard` + `/leaderboardEdit/:id` + `DELETE /getLeaderboardDelete` | `GET/POST/PATCH/DELETE /api/admin/leaderboard/tiers[/:id]` | 🟢 | — |
| `GET /voucher*` + `POST /addVoucher` + `/voucherEdit/:id` + `DELETE /getVoucherDelete` + `/viewVoucher/:id` | `GET/POST/PUT/DELETE /api/admin/vouchers[/:id]` | 🟢 | — |
| `GET /loyalty*` + `POST /addLoyalty` + `/loyaltyEdit/:id` + `DELETE /loyaltyDelete` + `GET /loyaltyManagement` + `/getPlayerLoyalty` + `/viewLoyaltyPlayer/:id` | `GET/POST/PATCH/DELETE /api/admin/loyalty/tiers[/:id]` + `/loyalty/players[/:userId]` + `/award` + `/tier` | 🟢 | — |
| `GET /role*` + `POST /add` + `/saveRole` + `/updateRole/:id` + `DELETE /delete/:id` | `GET /api/admin/permissions` + `PUT /api/admin/agents/:agentId/permissions` + `/users/:userId/role` | 🟡 | Legacy role-CRUD (generisk) vs. ny permissions-per-role-model — må verifisere at feature-parity oppnås |
| `GET /agentRole*` (auskommentert) | — | ⚪ | Droppet |

### 1.15 Settings, Maintenance, Security

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `POST /settings/add` + `GET /settings` + `POST /settings/update` + `/settings/addScreenSaverData` | `GET /api/admin/settings` + `PATCH /api/admin/settings` + `GET /settings/catalog` + `/settings/games/:slug` + `PUT /settings/games/:slug` | 🟡 | **GAP #23**: Screen Saver-settings (multi-image + per-image tid) mangler tilsvarende endpoint |
| `GET /maintenance` + `/maintenance/edit/:id` + `POST /maintenance/edit/:id` + `/maintenance/restartServer` + `/DailyReports` + `/DailyReportsWithMaintenance` | `GET /api/admin/maintenance` + `/:id` + `POST /api/admin/maintenance` + `PUT /:id` + `POST /api/admin/reports/daily/run` + `GET /api/admin/reports/daily` + `/archive/:date` | 🟡 | `/maintenance/restartServer` — **GAP #24**: programmatic restart fra admin-panel mangler |
| `GET /system/systemInformation` + `POST /editSystemInformation` | `GET /api/admin/system/info` | 🟡 | Edit-endpoint mangler — ofte bare read-only, men verifisere |
| `GET /blockedIp*` + `POST /add` + `/delete` + `/edit/:id` | `GET/POST/DELETE /api/admin/security/blocked-ips[/:id]` | 🟡 | Edit-endpoint mangler (må slette + re-adde) |
| `GET /riskCountry*` + `POST /addRiskCountry` + `/deleteRiskCountry` + `GET /getCountryList` | `GET/POST/DELETE /api/admin/security/risk-countries[/:code]` | 🟡 | `/getCountryList` mangler — **GAP #25**: List-of-all-countries-for-dropdown |
| `GET /redFlagCategory*` + `/getPlayersRedFlagList` + `/viewUserTransaction` + `/getUserTransactionHeader/:id` + `/getUserTransactionList` | `GET /api/admin/reports/red-flag/categories` + `/players` + AML endpoints | 🟢 | — |

### 1.16 Other games (legacy Game 2/3/4/5, Wheel/Chest/Mystery/ColorDraft, Auth-flows)

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `GET /wheelOfFortune` + `POST /editWheelOfFortune` | `GET /api/admin/settings/games/:slug` (slug=wheel?) | 🟡 | Må verifisere at mini-game-config-CRUD fungerer for wheel |
| `GET /treasureChest` + `POST /treasureChestEdit` | ditto, slug=chest | 🟡 | Samme |
| `GET /mystery` + `POST /mysteryEdit` | ditto, slug=mystery | 🟡 | Legacy har separat `mysteryEdit`, ny har generic CRUD |
| `GET /colorDraft` + `POST /colorDraftEdit` | ditto, slug=colordraft | 🟡 | Samme |
| `GET /background` + `POST /addBackground` + `/editBackground/:id` + `DELETE /deleteBackground` + `GET /viewBackground/:id` | — | 🔴 | **GAP #26**: Background-image-CRUD for spill-lobby/game-scener (mye UI-polish) |
| `GET /theme` + `POST /themeEdit` | — | 🔴 | **GAP #27**: Theme-config (color-palette for player-app + TV) |
| `GET /gameHistory/game1/:gameId/:grpId/:hallname` + `/game2` + `/game3` | `GET /api/admin/reports/games/:gameSlug/sessions` + `/drill-down` | 🟢 | — |
| `GET /reportGame1*` + `/reportGame2*` + `/reportGame3*` + `/reportGame4*` + `/reportGame5*` + `/uniqueGameReport` + `/reportUnique/uniqueGameTicketReport` + `/physicalTicketReport` + `/reportPhysical/physicalTicketReport` + `/hallSpecificReport` + `/getHallReports` + `/getHallOrderReports` | `GET /api/admin/reports/game1` + `/games/:gameSlug/…` + `/halls/:hallId/daily` + `/physical-tickets/aggregate` + `/unique-tickets/range` | 🟡 | **GAP #28**: Game 2/3/4/5-spesifikke report-shapes mangler (antagelig i ny via `/games/:gameSlug/…` men bekreft) |

### 1.17 TV + special integrasjoner

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `GET /tv/:id` (redirect) | `GET /api/tv/:hallId/:tvToken/state` + `/winners` | 🟡 | Redirect-based vs. state-API — bekreft at TV-app kan bruke state+winners direkte |
| `POST /validateGameView` | — | 🔴 | **GAP #29**: Game-view-validation (for player-app å sjekke før join) |
| `POST /popup_modal` | — | 🔴 | **GAP #30**: Ad-hoc modal-data-endpoint (brukt av admin-dashboard for å vise pop-ups ved hendelser) |
| `GET /csvImport` + `/physical/csvImport` (kommentert) | `POST /api/admin/physical-tickets/static/import` | 🟡 | CSV-import av legacy-spillere (én-gangs migration) — CSV-import av physical-tickets er støttet |
| `GET /webview` (test-endpoint) | — | ⚪ | Test-endpoint — kan droppes |

### 1.18 Advertisement + SMS

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `GET /sms-advertisement` + `/search-players` + `POST /send-sms-notification` | `POST /api/admin/notifications/broadcast` | 🟡 | **GAP #31**: SMS-kanalen (via Sveve) finnes ikke — kun FCM push-notification. Admin kan sende push men ikke SMS til telefonnummer |

### 1.19 Integration (Candy wallet)

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `POST /api/games/candy/launch` | `POST /api/games/:slug/launch` | 🟢 | — |
| `GET /api/ext-wallet/balance` + `POST /debit` + `/credit` + `GET /diag` | `GET /api/ext-wallet/…` (`createExternalGameWalletRouter`) | 🟢 | — |

### 1.20 Notifications

| Legacy-endpoint | Ny-stack-ekvivalent | Status | Gap-beskrivelse |
|-----------------|---------------------|--------|-----------------|
| `GET /notifications/count/hall/:hallId` | `GET /api/notifications/unread/count` | 🟡 | Hall-specific-count-filter må verifiseres |

---

## 2. Socket-events

### 2.1 Default namespace (common)

| Legacy-event | Ny-ekvivalent | Status | Gap-beskrivelse |
|--------------|---------------|--------|-----------------|
| `LoginPlayer` | HTTP `POST /api/auth/login` | 🟢 | Flyttet til HTTP — OK |
| `HallList` | HTTP `GET /api/halls` | 🟢 | — |
| `GameOnlinePlayerCount` | — | 🔴 | **GAP #32**: Online-player-count per-game for lobby-UI |
| `GameTypeList` | HTTP `GET /api/games` | 🟢 | — |
| `IsHallClosed` | `GET /api/halls/:hallReference/client-variant` | 🟡 | Hall-closed er del av hall-status — må verifisere |
| `Game1Status` + `AvailableGames` | `GET /api/games/status` | 🟢 | — |
| `PlayerDetails` | `GET /api/wallet/me` + `/api/players/me/profile` | 🟢 | — |
| `Logout` | `POST /api/auth/logout` | 🟢 | — |
| `SetLuckyNumber` + `GetLuckyNumber` | socket `lucky:set` | 🟢 | — |
| `ReconnectPlayer` | socket `room:resume` | 🟢 | — |
| `CheckRunningGame` | `GET /api/rooms` | 🟢 | — |
| `DeletePlayerAccount` | `DELETE /api/players/me` | 🟢 | — |
| `SetLimit` | `PUT /api/wallet/me/loss-limits` | 🟢 | — |
| `PlayerNotifications` | `GET /api/notifications` | 🟢 | — |
| `TransactionHistory` | `GET /api/wallet/me/transactions` | 🟢 | — |
| `UpdateFirebaseToken` | `POST /api/notifications/device` | 🟢 | — |
| `playerForgotPassword` | `POST /api/auth/forgot-password` | 🟢 | — |
| `playerChangePassword` | `POST /api/auth/change-password` | 🟢 | — |
| `UpdateProfile` + `Playerprofile` + `playerProfilePic` | `PUT /api/players/me/profile` | 🟢 | — |
| `GameTypeData` | `GET /api/games/:slug` (via settings-catalog) | 🟡 | Må verifiseres |
| `FAQ` + `Terms` + `Support` + `Aboutus` + `ResponsibleGameing` + `Links` | `GET /api/admin/cms/:slug` (public-proxy) | 🔴 | **GAP #33**: Public CMS-fetch-endpoint for player-app (ikke bare admin-gated) |
| `myWinnings` | `GET /api/wallet/me/transactions?type=credit&category=winning` | 🟡 | Separate endpoint kan trenges |
| `EnableNotification` | `POST /api/notifications/device` (med opt-in flag) | 🟢 | — |
| `VoucherList` + `RedeemVoucher` | `GET /api/voucher/my` + `POST /api/voucher/redeem` | 🟢 | — |
| `BlockMySelf` | `POST /api/wallet/me/self-exclusion` + `/api/wallet/me/timed-pause` | 🟢 | — |
| `DepositMoney` | `POST /api/payments/deposit-request` + `/api/payments/swedbank/topup-intent` | 🟢 | — |
| `LoginWithUniqueId` | HTTP `POST /api/auth/login` (med type=uniqueId) | 🟡 | Må verifisere at login-endpoint tar unique-id |
| `GetApprovedHallList` | `GET /api/halls` (med filter) | 🟢 | — |
| `PlayerUpdateInterval` | — | 🔴 | **GAP #34**: Periodic player-state-poll (wallet+session) — kan være dekket av socket-auto-push |
| `VerifyPassword` | — | 🔴 | **GAP #35**: Pre-action password-verify (for sensitive actions: self-exclusion, withdraw) |
| `WithdrawMoney` | `POST /api/payments/withdraw-request` | 🟢 | — |
| `updatePlayerLanguage` | `PUT /api/players/me/profile` (med language field) | 🟢 | — |
| `createBotPlayers` | — | 🔴 | **GAP #36**: Bot-player-creation endpoint (admin/ops tool) |
| `ScreenSaver` | socket `admin-display:screensaver` | 🟢 | — |
| `CheckPlayerBreakTime` | `GET /api/wallet/me/compliance` | 🟢 | — |
| `verifyByBankId` | `POST /api/auth/bankid/init` | 🟢 | — |
| `PlayerSettings` | `GET /api/players/me/profile` | 🟢 | — |
| `AddOrUpdateBlockRule` | `POST /api/wallet/me/self-exclusion` (m/ rule-objekt) | 🟡 | Må verifisere at block-rules-shape matches legacy |
| `RefreshAccessToken` | `POST /api/auth/refresh` | 🟢 | — |
| `SwitchHall` | `PUT /api/players/me/profile` (med hallId) | 🟡 | Shell-level hall switch må verifiseres |
| `PlayerHallLimit` | `GET /api/halls` + `/api/wallet/me/compliance` | 🟡 | Hall-specific limits endpoint — må verifiseres |
| `PlayerSoundAndVoiceSettings` | `PUT /api/players/me/profile` | 🟢 | — |
| `testingCallEvent` | — | ⚪ | Test-only |
| `getGame3PurchaseData` + `game3TicketCheck` + `game3TicketBuy` | socket `draw:extra:purchase` + `claim:submit` | 🟡 | Legacy Game 3 socket events ikke 1:1 — må verifiseres |

### 2.2 Game 1 namespace

Ny stack har kun default + admin-namespaces. **Game1-specific events er flyttet til default + HTTP.**

| Legacy-event | Ny-ekvivalent | Status | Gap-beskrivelse |
|--------------|---------------|--------|-----------------|
| `Game1Room` + `SubscribeRoom` | socket `room:join` + `room:create` | 🟢 | — |
| `PurchaseGame1Tickets` | `POST /api/game1/purchase` | 🟢 | — |
| `CancelGame1Tickets` + `CancelTicket` | socket `ticket:cancel` | 🟢 | — |
| `UpcomingGames` | `GET /api/rooms` (status=scheduled) | 🟢 | — |
| `SelectLuckyNumber` | socket `lucky:set` | 🟢 | — |
| `ViewPurchasedTickets` | `GET /api/wallet/me/transactions` (filter) | 🟡 | Per-room-tickets view må verifiseres |
| `ReplaceElvisTickets` | socket `ticket:replace` | 🟢 | — |
| `StartGame` | socket `game:start` + HTTP `POST /api/admin/rooms/:roomCode/start` | 🟢 | — |
| `SendGameChat` + `GameChatHistory` | socket `chat:send` + `chat:history` | 🟢 | — |
| `LeftRoom` | socket `disconnect` | 🟢 | — |
| `AdminHallDisplayLogin` | socket `admin-display:login` | 🟢 | — |
| `gameFinished` | socket `game:end` | 🟢 | — |
| `WheelOfFortuneData` + `PlayWheelOfFortune` + `WheelOfFortuneFinished` + `TreasureChestData` + `SelectTreasureChest` + `MysteryGameData` + `SelectMystery` + `ColorDraftGameData` + `SelectColorDraft` | socket `jackpot:spin` + `minigame:play` | 🟡 | **GAP #37**: Mini-game socket-events konsoliderte — men mystery-auto-timer + color-draft-flow må verifiseres end-to-end mot player-client |
| `StopGameByPlayers` | — | 🔴 | **GAP #38**: Player-initiated stop-game (Spillvett-vote) |
| `TvscreenUrlForPlayers` | `GET /api/tv/:hallId/:tvToken/state` | 🟢 | — |

### 2.3 Game 2/3/4/5 namespaces

**Spill 2/3/4/5-spesifikk backend-implementasjon er ikke-mål** (dekket i BIN-721..728). Auditet hopper over disse namespaces.

- Game2Engine.ts + Game3Engine.ts finnes. Game4Engine og Game5Engine er ikke implementert i ny stack.
- Legacy-events `Game2Room`, `Game2BuyBlindTickets`, `Game2BuyTickets`, `ApplyVoucherCode`, `LeftRocketRoom`, `disconnecting`, `Game3Room`, `Game3PlanList`, `GetGame3PurchaseData`, `PurchaseGame3Tickets`, `isGameAvailbaleForVerifiedPlayer`, `Game4Data`, `Game4ChangeTickets`, `Game4Play`, `MysteryGameFinished`, `Game4ThemesData`, `Game5Data`, `SwapTicket`, `Game5Play`, `checkForWinners`, `SelectWofAuto`, `SelectRouletteAuto` — alle ekskludert.

### 2.4 Admin namespace

| Legacy-event | Ny-ekvivalent | Status | Gap-beskrivelse |
|--------------|---------------|--------|-----------------|
| `joinHall` + `joinRoom` | socket `admin-display:subscribe` | 🟢 | — |
| `getNextGame` + `getOngoingGame` | `GET /api/admin/rooms` + `/rooms/:roomCode` | 🟢 | — |
| `getHallBalance` | socket `admin:hall-balance` | 🟢 | — |
| `onHallReady` | socket `admin:room-ready` | 🟢 | — |
| `getWithdrawPenddingRequest` | `GET /api/admin/payments/requests?type=withdraw&status=pending` | 🟢 | — |
| `gameCountDownTimeUpdate` + `secondToDisplaySingleBallUpdate` | `PUT /api/admin/settings/games/:slug` | 🟡 | Real-time-broadcast-effekt av settings-endring må verifiseres |
| `checkTransferHallAccess` + `transferHallAccess` + `approveTransferHallAccess` | Dekket av #453 T1.6 | 🟢 | — |

---

## 3. DB-tabeller

Legacy: 54 Mongo-modeller. Ny: ~90 Postgres-tabeller (via 90 migrations).

### 3.1 Direkte ekvivalenter

| Legacy-model | Ny-tabell | Status | Manglende kolonner |
|--------------|-----------|--------|--------------------|
| `agent` | `app_users` (role=agent) + `app_agent_halls` + `app_agent_profiles` (BIN-migration) | 🟢 | — |
| `agentShift` | `app_agent_shifts` | 🟢 | — |
| `agentTransactions` | `app_agent_transactions` | 🟢 | — |
| `agentRegisteredTickets` + `agentSellPhysicalTickets` | `app_physical_tickets` + `app_agent_ticket_ranges` + `app_physical_ticket_transfers` | 🟢 | — |
| `assignedHalls` | `app_agent_halls` | 🟢 | — |
| `blokedIp` | `app_blocked_ips` (migration 210000 security_admin) | 🟢 | — |
| `background` | — | 🔴 | **GAP #27** dekker manglende theme/background |
| `category` + `product` + `productCart` | `app_product_categories` + `app_products` + `app_agent_carts` | 🟢 | — |
| `chats` | `app_chat_messages` | 🟢 | — |
| `cms` + `faq` | `app_cms_content` + `app_cms_content_versions` | 🟢 | — |
| `dailySchedule` + `schedule` + `subGameSchedule` + `subGame1` + `subGame` + `subGame5` | `app_schedules` + `app_daily_schedules` + `app_sub_games` + `app_game1_scheduled_games` | 🟢 | — |
| `dailyTransactions` + `transactions` | `app_wallet_transactions` + `app_payment_requests` | 🟢 | — |
| `depositMoney` | `app_swedbank_payment_intents` + `app_deposit_withdraw_queue` | 🟢 | — |
| `error` | Via pino-logger + `app_audit_log` | 🟡 | Eksplisitt error-log-tabell mangler — kan være OK |
| `game` + `gameType` + `parentGame` | `app_game_sessions` + `app_game_types` + `app_game_management` | 🟢 | — |
| `groupHall` + `hall` + `hallCashTransaction` + `hallReport` | `app_hall_groups` + `app_halls` + `app_hall_cash_transactions` + `app_hall_cash_balance` + `app_hall_reports` (via report-aggregation) | 🟢 | — |
| `leaderboard` | `app_leaderboard_tiers` + `app_loyalty_player_state` | 🟢 | — |
| `loginHistory` | `app_login_history` (via LoginHistoryService) | 🟢 | — |
| `loyaty` (sic) | `app_loyalty_*` tabeller | 🟢 | — |
| `notification` | `app_notifications` + `app_notification_devices` | 🟢 | — |
| `otherGame` | Via `app_mini_games_config` | 🟡 | Mini-game-type-modell — bekreft coverage av wheel/chest/mystery/colordraft |
| `pattern` | `app_patterns` | 🟢 | — |
| `player` (296L!) | `app_users` + `app_player_hall_status` + `app_wallets` + `app_loyalty_player_state` + `app_aml_flags` + compliance-tables | 🟢 | — |
| `playerWithdraw` + `withdrawEmails` | `app_withdraw_requests_bank_export` + `app_xml_export_batches` + `app_withdraw_emails` (security_admin) | 🟢 | — |
| `riskCountry` | `app_risk_countries` | 🟢 | — |
| `role` | `app_roles` + `app_permissions` + `app_user_roles` | 🟡 | Ny har permission-pivot, legacy har role-embed — konvertering-lag må verifiseres |
| `savedGame` | `app_saved_games` | 🟢 | — |
| `security` | `app_security_events` + `app_audit_log` | 🟢 | — |
| `setting` + `settlement` | `app_settings_catalog` + `app_agent_settlements` + `app_settlement_machine_breakdown` | 🟢 | — |
| `slotmachine` | — | 🔴 | **GAP #39**: Slot machine-specific metadata-table (kanskje ikke aktivt brukt — legacy-remnant) |
| `socket` | — | ⚪ | Socket session-state — ikke persistert i ny (kun in-memory), OK |
| `staticPhysicalTickets` + `staticTickets` | `app_static_tickets` + `app_static_tickets_pt1_extensions` | 🟢 | — |
| `theme` | — | 🔴 | **GAP #27** |
| `ticket` + `ticketBallMappings` | `app_app_game1_ticket_purchases` + `app_app_game1_ticket_assignments` + `app_draw_session_tickets` + `app_ticket_draw_session_binding` | 🟢 | — |
| `user` | `app_users` | 🟢 | — |
| `voucher` | `app_vouchers` + `app_voucher_redemptions` | 🟢 | — |

### 3.2 Nye tabeller i ny stack (ikke i legacy)

Disse er nye i ny stack og utvider legacy's modell:

- `app_game1_oddsen_state` — Oddsen-jackpot-state (pilot-feature)
- `app_game1_accumulating_pots` — pot-akkumulering på tvers av økter
- `app_game1_mini_game_mystery` — persistert mystery-state
- `app_idempotency_records` — idempotent key-store for all write-operasjoner
- `app_regulatory_ledger` + `app_daily_regulatory_reports` — Lotteritilsynet-compliance
- `app_app_notifications_and_devices` — FCM-device-registry
- `app_auth_tokens` — refresh-token-rotation
- `app_hall_display_tokens` — TV-token-mgmt
- `app_hall_groups` + `app_hall_manual_adjustments` — nye hall-operasjonsfeature
- `app_close_day_log` — audit trail for close-day
- `app_machine_tickets` + `app_agent_tx_machine_actions` — Metronia/OK Bingo-ticket-lifecycle

**Dette er ikke gaps — dette er forbedringer utover legacy.**

---

## 4. Cron-jobber / Scheduled tasks

| Legacy-job (fra `Boot/Server.js`) | Ny-ekvivalent | Status | Frekvens-avvik |
|-----------------------------------|---------------|--------|----------------|
| `new CronJob('0 0 * * *', …)` Daily 00:00 — `deleteDailySchedules`, `generateExcelOfWithdraw`, `autoCloseTicket(Metronia)` + `autoCloseTicket(OK Bingo)`, `checkBankIdAndIdCardExpiryAndSendReminders`, `updatePlayerBlockRules` | Split: `machineTicketAutoClose` + `bankIdExpiryReminder` + `selfExclusionCleanup` + `xmlExportDailyTick` | 🟢 | — |
| `new CronJob('0 * * * *', …)` Hourly — `swedbankpayCronToUpdateTransaction` | `swedbankPaymentSync` | 🟢 | — |
| `setInterval(startGameCron, 15s)` | `game1ScheduleTick` (GAME1_SCHEDULE_TICK_ENABLED) + `game1AutoDrawTick` | 🟢 | Default OFF i ny — må skrus på før pilot |
| `setInterval(sendGameStartNotifications, 1 min)` | `gameStartNotifications` | 🟢 | — |
| `setInterval(game1StatusCron, 5 min)` | (dekket av game1ScheduleTick) | 🟢 | — |
| `initGame1(null)` (boot-time) | boot-time recovery i `Game1RecoveryService` | 🟢 | — |
| `handleServerRestart()` for Game 3+4 (boot-time) | (delvis dekket for Game 3; Game 4 er ikke-mål) | 🟡 | Game 4 restart-recovery mangler |
| `refundGame5()` (boot-time) | — | ⚪ | Game 5 = `spillorama` (legacy Game 5), ikke-mål per BIN-721..728 |
| `checkForBotGames(null)` + `checkForBotGame5(…)` + `game4botcheckup` | — | 🔴 | **GAP #40**: Bot-game auto-fill-in (pre-generer bot-games for hvert hall) |
| `loyaltyMonthlyReset` (ny — finnes ikke i legacy) | `loyaltyMonthlyReset` job | 🟢 | Nytt i ny — forbedring |

---

## 5. Business-logic services

### 5.1 Godt dekket

| Legacy-service | Ny-service | Status | Logic-avvik |
|----------------|------------|--------|-------------|
| `AdminServices.js` | `AdminAccessPolicy.ts` + `AdminEndpointRbac.ts` + `AgentPermissionService.ts` | 🟢 | — |
| `AgentServices.js` | `AgentService.ts` + `AgentShiftService.ts` + `AgentSettlementService.ts` + `AgentTransactionService.ts` + `AgentOpenDayService.ts` + `AgentProductSaleService.ts` | 🟢 | — |
| `GameService.js` + `gamehelper/game1.js` + `gamehelper/game1-process.js` | `BingoEngine.ts` + `Game1DrawEngineService.ts` + `Game1TicketPurchaseService.ts` + `Game1MasterControlService.ts` + `Game1PayoutService.ts` + `Game1PatternEvaluator.ts` + `Game1JackpotService.ts` + `Game1LuckyBonusService.ts` + `Game1RecoveryService.ts` + `Game1AutoDrawTickService.ts` + `Game1ScheduleTickService.ts` + `Game1HallReadyService.ts` + `Game1DrawEnginePotEvaluator.ts` | 🟢 | Modulær splitt — bedre dekning enn legacy |
| `Game2Engine` + `Game3Engine` (delvis) | `Game2Engine.ts` + `Game3Engine.ts` + `Game2JackpotTable.ts` | 🟡 | Dekker runtime, men ikke all legacy-feature (bot, specific edge cases) — ikke-mål |
| `HallServices.js` + `GroupHallServices.js` | `PlatformService.ts` + `HallAccountReportService.ts` + `HallCashLedger.ts` + `HallGroupService.ts` | 🟢 | — |
| `LeaderboardServices.js` + `LoyaltyService.js` | `LoyaltyService.ts` + `LeaderboardTierService.ts` | 🟢 | — |
| `patternServices.js` | `PatternService.ts` + `PatternMatcher.ts` + `PatternCycler.ts` + `Game1PatternEvaluator.ts` | 🟢 | — |
| `PlayerServices.js` + `Game/Common/Services/PlayerServices.js` | `PlatformService` (player-metoder) + `ChipsHistoryService.ts` | 🟢 | — |
| `PlayerWithdraw.js` + `WithdrawServices.js` | `WithdrawXmlExportService.ts` + `PaymentRequestService.ts` | 🟢 | — |
| `ProductServices.js` | `ProductService.ts` | 🟢 | — |
| `RoleServices.js` | `AgentPermissionService.ts` + `AdminAccessPolicy.ts` | 🟢 | — |
| `scheduleServices.js` | `ScheduleService.ts` + `DailyScheduleService.ts` + `SubGameService.ts` + `GameManagementService.ts` + `SubGameManager.ts` | 🟢 | — |
| `SettingsServices.js` + `MaintenanceService` | `SettingsService.ts` + `settingsCatalog.ts` + `MaintenanceService.ts` | 🟢 | — |
| `slotmachineServices.js` | `MachineTicketStore.ts` + `MetroniaTicketService.ts` + `OkBingoTicketService.ts` + `HallCashLedger.ts` | 🟢 | — |
| `subGame1Services.js` | `SubGameService.ts` + `SubGameManager.ts` + `SavedGameService.ts` | 🟢 | — |
| `transactionServices.js` | Spread over `PlatformService` + `ChipsHistoryService` + `WalletAdapter` | 🟢 | — |
| `uniqueServices.js` | `adminUniqueIdsAndPayouts`-router-handlers + `PlatformService` | 🟢 | — |
| `VoucherServices.js` | `VoucherService.ts` + `VoucherRedemptionService.ts` | 🟢 | — |
| `cmsServices.js` | `CmsService.ts` | 🟢 | — |
| `depositMoneyServices.js` | `SwedbankPayService.ts` + `PaymentRequestService.ts` | 🟢 | — |
| `otherGameServices.js` | `MiniGamesConfigService.ts` + `BingoEngineMiniGames.ts` | 🟡 | Mini-game-runtime for mystery/colordraft finnes, men bot-game-pre-gen mangler |
| `blockedIpServices.js` + `SecurityController` | `SecurityService.ts` + security-admin-router | 🟢 | — |
| `NotificationServices.js` | `FcmPushService.ts` + `notifications/templates/*` | 🟢 | — |
| `SocketServices.js` | `sockets/gameEvents/*` + `sockets/admin*` | 🟢 | — |

### 5.2 Ikke dekket

| Legacy-service | Status | Gap-beskrivelse |
|----------------|--------|-----------------|
| `OtherModules.js` | 🔴 | **GAP #41**: Catch-all for background/theme/banner/widget-CRUD |
| `AccountingEmailService` (ny) | N/A | Ny i ny stack — støtter withdraw XML-eksport-distribusjon |
| `advertisementController.js` (SMS + Firebase-RTDB) | 🟡 | **GAP #31** allerede nevnt |
| `CategoryServices.js` | 🟢 | Dekket av ProductService.ts |
| `GameServices.js` (AdminEvents) | 🟢 | Dekket av AdminGame1Broadcaster.ts |
| `Game1Services/ChatServices.js` + `Game2/Game3/Game4-ChatServices.js` | 🟢 | Dekket av chatEvents.ts + ChatMessageStore.ts |

---

## 6. Prioritert gap-liste

Rangert etter pilot-kritikalitet. Merk: P0 = blocker for 4-hall-pilot i Q2-2026; P1 = før GA; P2 = post-pilot nice-to-have.

| # | Gap | Legacy-ref | Ny-ref | Prio | Est. |
|---|-----|------------|--------|------|------|
| 1 | Forward pending-request (agent→admin) | `routes/backend.js:458` | — | P2 | 0.5d |
| 2 | Delete rejected player permanently | `routes/backend.js:464` | — | P1 | 0.5d |
| 3 | Manual delete block rules | `routes/backend.js:451` | — | P2 | 0.5d |
| 4 | Per-player game-management detail-list | `routes/backend.js:445-446` | — | P1 | 1d |
| 5 | Player profile image upload | `routes/backend.js:754` | — | P1 | 1d (S3 + validation) |
| 6 | Flag `isAlreadyApproved` migration-helper | `routes/backend.js:758` | — | ⚪ Drop | — |
| 7 | Swedbank iframe-launch wrap | `routes/backend.js:658` | `payments.ts` | P1 | 1d |
| 8 | Swedbank deposit response page | `routes/backend.js:659` | — | P1 | 0.5d |
| 9 | Swedbank goback deeplink | `routes/backend.js:661` | — | P1 | 0.5d |
| 10 | Admin deposit history view | `routes/backend.js:255-256` | — | P1 | 1d |
| 11 | Admin withdraw-amount direct-chips-action view | `routes/backend.js:395-400` | — | P2 | 1.5d |
| 12 | Admin withdraw history (hall + bank) | `routes/backend.js:410-413` | — | P1 | 1d |
| 13 | "Transactions payment"-legacy-view | `routes/backend.js:16` | — | ⚪ Drop | — |
| 14 | `POST /patternGame` (attach pattern til game) | `routes/backend.js:148` | — | P2 | 0.5d |
| 15 | Close-day 3-case (Single/Consecutive/Random) + per-date update/delete | `Controllers/GameController.js:10126-10265` | `CloseDayService.ts` | **P0** | 3d |
| 16 | Manual winning (admin override) | `routes/backend.js:625` | — | P1 | 1d |
| 17 | Delete hall | `routes/backend.js:323` | — | P1 | 0.5d |
| 18 | Bulk transfer players to hall | `routes/backend.js:324` | — | P2 | 1d |
| 19 | Pre-create hallNumber + IP-validering | `routes/backend.js:328-329` | — | P1 | 0.5d |
| 20 | Removed group-hall arkiv | `routes/backend.js:341` | — | P2 | 0.5d |
| 21 | Edit withdraw-email | `routes/backend.js:419-420` | — | P2 | 0.5d |
| 22 | Public CMS endpoint for player-app | `routes/backend.js:294` | — | **P0** | 1d |
| 23 | Screen Saver settings | `routes/backend.js:481` | — | P1 | 1.5d |
| 24 | Programmatic server restart | `routes/backend.js:479` | — | P2 | 0.5d |
| 25 | Country-list-for-dropdown | `routes/backend.js:235` | — | P1 | 0.25d |
| 26 | Background-image CRUD | `routes/backend.js:127-134` | — | P2 | 1.5d |
| 27 | Theme-config | `routes/backend.js:136-137` | — | P2 | 1d |
| 28 | Game 2/3/4/5 spesifikke report-shapes | `routes/backend.js:201-218` | `adminReports*.ts` | P1 | 2d |
| 29 | Validate-game-view endpoint | `routes/backend.js:567` | — | P1 | 0.5d |
| 30 | Popup modal-data | `routes/backend.js:540` | — | P2 | 0.5d |
| 31 | SMS-kanalen via Sveve | `Controllers/advertisementController.js` + `Controllers/PlayerController.js:3572-3600` | `FcmPushService` | **P0** | 2d (Sveve-integrasjon + admin UI-toggle) |
| 32 | Online-player-count-per-game | `Game/Common/Sockets/common.js:16` | — | P2 | 0.5d |
| 33 | Public CMS-fetch for player-app (FAQ/Terms/About/Support etc.) | `common.js:234-291` | `CmsService` (admin-gated only) | **P0** | 1d |
| 34 | Periodic PlayerUpdateInterval | `common.js:397` | — | P2 | 0.5d |
| 35 | Pre-action password-verify | `common.js:408` | — | P1 | 1d |
| 36 | Bot-player-creation (admin/ops tool) | `common.js:539` | — | P2 | 1d |
| 37 | Mini-game auto-timer + color-draft end-to-end | `game1.js:143-223` | `jackpot:spin` + `minigame:play` | **P0** | 2d (mystery timer + color-draft delivery chain) |
| 38 | Player-initiated stop-game (Spillvett-vote) | `game1.js:235` | — | P1 | 1d (lav brukerfrekvens, men reg-krav) |
| 39 | Slot machine metadata-table | `Models/slotmachine.js` | — | ⚪ Drop | — |
| 40 | Bot-game pre-gen auto-fill-in | `Boot/Server.js:539-661` | — | P2 | 3d |
| 41 | OtherModules-catch-all (banner/widget) | `Services/OtherModules.js` | — | P2 | 1d |

### 6.1 Sammendrag per prio

- **P0 (5 gaps):** #15 (close-day 3-case), #22 (public CMS), #31 (SMS Sveve), #33 (public CMS for player-app — overlapping med #22), #37 (mini-game end-to-end)
- **P1 (14 gaps):** #2, #4, #5, #7, #8, #9, #10, #12, #16, #17, #19, #23, #25, #28, #29, #35, #38 (+)
- **P2 (13 gaps):** #1, #3, #11, #14, #18, #20, #21, #24, #26, #27, #30, #32, #34, #36, #40, #41
- **Droppet (4 gaps):** #6, #13, #39 + (allerede delvis dekket eller legacy-remnant)

### 6.2 Innsatsestimater totalt

- P0: ~9 dager (3d + 1d + 2d + 2d + 1d)
- P1: ~12 dager
- P2: ~14 dager
- **Totalt: ~35-40 dev-dager** for å lukke alle gaps (ikke-P0-/P1-/P2-overlap med 4-hall-pilot-scope).

---

## 7. Anbefalt implementasjons-rekkefølge

### 7.1 Sprint 1 (uke 1-2) — P0 pilot-blokker

1. **#15 Close-day 3-case** (3d) — kritisk for at hallen kan lukke spilledager korrekt. Krever:
   - Utvidet `CloseDayService` med date-range + "Random"-dager-støtte
   - Per-date update/delete operasjoner
   - UI-pattern: Single/Consecutive/Random-valg
2. **#22 / #33 Public CMS** (1d + 1d, kan kombineres) — player-app trenger FAQ/Terms/About/Support/ResponsibleGaming/Links uten admin-auth. 
3. **#31 SMS via Sveve** (2d) — regnskap + SMS-advertisement er pilot-kritisk for kundekommunikasjon.
4. **#37 Mini-game auto-timer + color-draft** (2d) — Game 1 mystery krever 10s timer + auto-pick hvis ingen input. Color-draft kjede må verifiseres end-to-end.

**Totalt Sprint 1:** ~9 dager (kan parallelliseres på 2 devs).

### 7.2 Sprint 2 (uke 3-4) — P1 pre-GA kritisk

5. #38 Player-initiated stop-game (Spillvett) — reg-krav
6. #23 Screen Saver settings — pilot-hall vil bruke TV
7. #5 Player profile image upload — BankID-flow komplett
8. #7, #8, #9 Swedbank iframe + response + goback (2d totalt)
9. #16 Manual winning (admin override)
10. #35 Pre-action password-verify for self-exclusion/withdraw
11. #28 Game 2/3/4/5 report-shapes — selv om engine ikke er ferdig, rapport-shape må være klar for legacy-data-kompatibilitet

### 7.3 Sprint 3 (uke 5-6) — P1 resterende

12. #2 Delete rejected player
13. #4 Per-player game-management detail-list
14. #10 Admin deposit history
15. #12 Admin withdraw history (hall + bank)
16. #17 Delete hall
17. #19 Pre-create hall validering
18. #25 Country-list-for-dropdown
19. #29 Validate-game-view

### 7.4 Post-pilot (P2)

Alle gjenværende — når de dukker opp som reelle behov.

### 7.5 Bevisst droppet

- **#6**: `isAlreadyApproved` migration-helper — kun relevant hvis vi faktisk migrerer legacy-Mongo-data. Hvis vi starter clean i pilot, ikke nødvendig.
- **#13**: `/transactionsPaymet` — legacy-only-route uten klar funksjon.
- **#39**: `slotmachine` model — kun legacy-remnant, ikke aktivt.
- **#40** (kandidat): Bot-game-pre-gen — wireframes har det, men det er en performance-optimalisering for tomme haller. Kan utsettes til Fase 3.
- Game 4/5-namespace-events — ikke-mål per BIN-721..728.

---

## 8. Appendix: rasjonale for hver P0

### Rasjonale P0 #15 (close-day 3-case)

Legacy `closeDayAdd` (`Controllers/GameController.js:10126-10265`) aksepterer `startDate`, `endDate`, `startTime`, `endTime`, `gameId`, `gameType`. Genererer én entry per dato i range med tidskonstruksjon (første dag: start-23:59, mellomdager: 00:00-23:59, siste dag: 00:00-endTime).

Ny `CloseDayService.recordClose` (`src/admin/CloseDayService.ts`) aksepterer kun én `closeDate`. Dette matcher ikke wireframes (PDF 15 viser 3-knapp-kalender: Single / Consecutive / Random).

**Konsekvens hvis ikke lukket:** Hall-driver kan ikke lukke en ferie-periode på flere dager uten manuelt å klikke hver dag. Kunde-pilot feiler første juleferie.

### Rasjonale P0 #22/#33 (public CMS)

Legacy-player-app bruker `/terms-of-service` (public, frontend.js) og socket-events `FAQ/Terms/Support/Aboutus/ResponsibleGameing/Links` for å hente innhold uten auth. Ny admin-gated `/api/admin/cms/:slug` krever admin-JWT.

**Konsekvens hvis ikke lukket:** Player-app kan ikke vise forpliktende juridisk tekst (T&C, Responsible Gaming). Direct reg-krav fra Lotteritilsynet.

### Rasjonale P0 #31 (SMS Sveve)

Legacy bruker Sveve for 2 ting:
1. Forgot-password OTP til telefonnummer (`PlayerController.js:3572-3600`)
2. Admin broadcast SMS til player-segmenter (`advertisementController.js`)

Ny stack har kun FCM push (forutsetter at app er installert). Pilot-bruker-demografi = eldre med telefon, men ikke nødvendigvis app-installert.

**Konsekvens hvis ikke lukket:** Forgot-password via SMS virker ikke. Push-notifikasjoner går bare til de som har appen installert.

### Rasjonale P0 #37 (mini-game timer + color-draft)

Legacy `game1.js:143-223` har 4 mini-games: WheelOfFortune, TreasureChest, Mystery, ColorDraft. Mystery + ColorDraft krever auto-play (10s timer, fallback random) hvis spilleren ikke velger. Ny `jackpot:spin` + `minigame:play` er konsolidert, men auto-timer-delivery chain (server-side → broadcast → client render) må verifiseres end-to-end.

**Konsekvens hvis ikke lukket:** Spillere som er away-from-keyboard får ikke auto-play, mister bonus. Pilot-hall erfarer sure spillere.

---

## 9. Metodologi-noter

- Auditet leste 776 L `backend.js`, 533 L `integration.js`, 12 L `frontend.js`, 669 L `common.js`, 256 L `game1.js`, 126 L `admnEvents.js`, 163 L `socketinit.js`, 667 L `Server.js`, 296 L `player.js`-model.
- Kryssrefererte mot alle 74 TS-router-filer, 10 job-filer, og 90 migrations.
- Verifiserte mot `docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md` for å unngå dobbelt-rapportering av UI-gaps.
- Game 4/5-spesifikk kode er bevisst ekskludert per BIN-721..728-scope.
- Estimater er rå coder-dager, ikke inkludert QA, PR-review, deploy-tid.
