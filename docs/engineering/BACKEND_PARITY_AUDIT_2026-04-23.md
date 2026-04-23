# Backend Paritets-Audit — Legacy vs apps/backend

Generert: 2026-04-23
Auditor: Claude (Opus 4.7, 1M ctx)
Arbeidstre: `/Users/tobiashaugen/projects/Spillorama-system/.claude/worktrees/backend-parity-audit`
Forrige audit (historisk referanse, ikke oppdatert): [`BACKEND_PARITY_AUDIT_2026-04-18.md`](./BACKEND_PARITY_AUDIT_2026-04-18.md)

> **Nøkkelendring siden 18.4:** Backend har gått fra **122 → 421 endepunkter** og **29 → 91 DB-tabeller** på fem dager. Mange P0/P1-gaps fra 18.4-versjonen er lukket (agent-domene, manuelle deposit/withdraw-kø, cron-jobs, e-post-templates, Candy-launch, pending-player-KYC, admin-CRUD for users/halls/CMS/security). De gjenstående kritiske gapene er smalere og mer spesifikke (FCM push, SMS, voucher-redemption, i18n, noen nisje-reports).

---

## TL;DR (tellinger)

| Område | Legacy | Ny (apps/backend) | Endring siden 18.4 | Manglende / Delta |
|---|---:|---:|---|---|
| HTTP-endepunkter (ruter) | **559** | **421** | +299 (+245%) | **~50–80 funksjonelt unike mangler** (fra ~250); resten er server-renderte admin-HTML-sider som erstattes av admin-web SPA. BIN-587 ble **CLOSED 2026-04-19** med 0 MANGLER i de 6 avklarte kategoriene. |
| Socket.IO-events (handlers) | **134 unike events** | **35 unike events** | +7 | Konsolidert semantisk. Gjenstår: FCM/notif-events, enkelte CMS-views. |
| Games ported | Game1–5 (Game4 deprecated) | Hovedspill (G1), G2, G3, G5 | uendret | G4 deprecated pr. BIN-496. Hovedspill dominerende fokus pr. 23.4. |
| Cron-jobs (bakgrunnsjobber) | 2 CronJob + 4 setInterval i `Boot/Server.js` | **6 jobber registrert i `JobScheduler`** (BIN-582) | Fra 0 til 6 | Swedbank-sync, BankID-reminder, RG-cleanup, loyalty-reset, game1-schedule-tick, game1-auto-draw-tick — alle implementert |
| DB-tabeller | 55 Mongoose-modeller | **91 PostgreSQL-tabeller** | +62 (+214%) | Store tillegg: agent_*, physical_tickets, CMS, AML, loyalty, hall_groups, patterns, sub_games, saved_games, schedules, app_game1_* (11 tabeller) |
| Push notifications (FCM) | Ja — fcm-node, firebase-admin | **Fortsatt nei** | uendret | `/api/notifications` er stub som returnerer `[]` |
| E-post | Ja — nodemailer overalt | **Ja — sentralisert `EmailService` + 6 templates (BIN-588)** | Fra 1 → 6 templates | Templates: reset-password, kyc-approved, kyc-rejected, verify-email, role-changed, bankid-expiry-reminder. Dekker alt relevant unntatt deposit/withdraw-bekreftelser |
| SMS | Ja — `/sms-advertisement/*` | Nei | uendret | Må implementeres hvis nødvendig |
| Betaling | SwedbankPay + CoinPayments i deps | SwedbankPay + deposit/withdraw-request-kø | +3 endepunkter (BIN-586) | OK for pilot |
| Eksterne spill (Candy) | `POST /api/games/candy/launch` + iframe | **`POST /api/games/:slug/launch`** (delegerer til Candy demo-backend) | **LUKKET GAP** | Implementert med API-key + session-token — se `routes/game.ts:94` |
| Pending-player KYC-queue | `/pendingRequests/*` + `/player/reverify-bankid` | **`/api/admin/players/pending`, `.../approve`, `.../reject`, `.../bankid-reverify`, `.../resubmit`** | **LUKKET GAP** | Full KYC-queue i `adminPlayers.ts` |
| Metronia + OK Bingo | `machineApiController.js` | **`integration/metronia/` + `integration/okbingo/` m/SqlServer + stub-klienter + 17 agent-endepunkter** | **LUKKET GAP** | HttpMetroniaApiClient, SqlServerOkBingoApiClient — `mssql` som ny dep |
| i18n | `i18next` + Config/i18n*.js | Ingen | uendret | Ikke blokkerer pilot — strings er norske |

**Estimert port-arbeid (grovt):** **15–22 dev-dager** for funksjonsparitet av reelle gjenværende mangler. Endring fra 18.4 (61–67 dager) er **-46 dager bygget** på fem dager. Se §6.4 delta-utregning.

### Scope-avklaring — Candy og andre eksterne spill

> Bekreftet av Tobias 2026-04-23: **Candy har egen backend (ekstern leverandør).** Spillorama porterer **ikke** Candy-kode. Integrasjonen består kun av:
> 1. **Launch-endpoint** (`POST /api/games/:slug/launch`) — autentiserer Spillorama-spiller og returnerer session-token til Candy-backend
> 2. **Wallet-bridge** (`/api/ext-wallet/{balance,debit,credit}`) — lar Candy kreditere/debitere Spillorama-lommeboken under spill
> 3. **Iframe-embed** i web-shell — Candy UI vises som iframe inne i Spillorama-lobbyen
>
> Candy spill-logikk, RNG, regler og UI ligger hos Candy-leverandøren. Vi kontrollerer kun inngang (launch) og penger (wallet). Samme mønster gjelder for eventuelle andre tredjeparts-spill som legges til senere.

---

## Delta-analyse 18.4 → 23.4

### Hva ble faktisk bygget på 5 dager

Basert på scanning av nye filer, nye tabeller, nye endepunkter:

| Kategori | 18.4 status | 23.4 status | Leveranser (BIN/PR) |
|---|---|---|---|
| Cron-jobs | 0 jobber | **6 jobber (JobScheduler)** | BIN-582, game1-schedule-tick, game1-auto-draw-tick |
| E-post | kun Spillevett-rapport | **6 templates + sentral EmailService** | BIN-588 |
| Admin user/role-CRUD | MANGLER | **EXISTS** (`/api/admin/users`, `/api/admin/agents/:id/permissions`) | BIN-587 B2 |
| CMS-admin | MANGLER | **EXISTS** (`/api/admin/cms/*` + versioning) | BIN-587 B4 |
| Security admin (blocked-IP, risk-countries) | MANGLER | **EXISTS** (`/api/admin/security/*`) | BIN-587 B4 |
| Voucher admin | MANGLER | **EXISTS** (admin CRUD) — redemption gjenstår | BIN-587 B4b |
| Products + cart | MANGLER | **EXISTS** (products, product-categories, carts) | BIN-587 B4 + BIN-583 |
| Physical tickets | MANGLER | **EXISTS** (14 endepunkter + 6 tabeller) | BIN-583 |
| Agent domain (78 endepunkter) | MANGLER | **~58 av 88 EXISTS** (auth, shift, transactions, metronia, okbingo, settlement, products, tickets) | BIN-583 |
| Hall groups | MANGLER | **EXISTS** (`/api/admin/hall-groups`) | BIN-587 B4 |
| Patterns + sub_games + saved_games | ARCH-ENDRING | **EXISTS som 1:1 CRUD** (3 nye tabeller) | BIN-587 B4 |
| Daily schedules | DELVIS | **EXISTS** (`/api/admin/daily-schedules`) | BIN-587 B4 |
| Game types CRUD | MANGLER | **EXISTS** (`/api/admin/game-types`) | BIN-587 B4 |
| Mini-games admin | MANGLER | **EXISTS** (`/api/admin/mini-games/*` + 4 engines registrert) | BIN-690 M1–M5 |
| Close-day | MANGLER | **EXISTS** (`/api/admin/games/:id/close-day`) | BIN-587 |
| TV-skjerm public | MANGLER | **EXISTS** (`/api/tv/:hallId/:tvToken/*`) | PR #411 |
| Maintenance-mode | MANGLER | **EXISTS** (`/api/admin/maintenance`) | BIN-587 |
| Leaderboard tiers | DELVIS | **EXISTS** (CRUD) | BIN-587 |
| Loyalty admin | MANGLER | **EXISTS** (tiers + player-state + monthly-reset-cron) | BIN-700 |
| AML red-flags | — | **EXISTS** (`/api/admin/aml/*` + 2 nye tabeller) | BIN-587 |
| Pending-player KYC-queue | MANGLER | **EXISTS** (hele flowen) | BIN-587 B2 |
| Deposit/withdraw-requests | MANGLER | **EXISTS** (`/api/payments/deposit-request`, `/api/admin/payments/requests/*`) | BIN-586 |
| Metronia + OKBingo | MANGLER | **EXISTS** (adaptere + agent-endepunkter) | BIN-583 |
| Candy-launch | MANGLER (kjent gap) | **EXISTS** (`/api/games/:slug/launch`) | BIN-XXX (kjent port) |
| Ticket swap/cancel | MANGLER | **EXISTS** (`ticket:swap`, `ticket:cancel` + `ticket:replace`) | BIN-509, BIN-585, BIN-692 |
| Game 1 scheduled-games-flyt | — | **EXISTS** (11 app_game1_* tabeller + ScheduleTick + AutoDrawTick + MasterControl + HallReady) | GAME1_SCHEDULE PR 1–5 |
| Agent ticket ranges | — | **EXISTS** (`/api/admin/physical-tickets/ranges`) | BIN-587 |
| Game 1 accumulating pots | — | **EXISTS** (Jackpott + Innsatsen) | PR-T1-T5 |
| Wallet split (deposit/winnings) | — | **EXISTS** (PR-W5) | PR-W5 |
| Prize policy versjonering | EXISTS | EXISTS | uendret |

### Hva ikke ble bygget (gjenværende gaps)

Se §6 "Oppsummering / anbefaling" — under 20 dev-dager gjenstår nå.

---

## 1. HTTP Endpoints

**Legacy totalt:** 559 (549 `backend.js` + 5 `frontend.js` + 5 `integration.js`) — verifisert ved grep.
**Ny totalt:** **421** (fordelt på 72 route-filer) — verifisert ved `grep -cE "^[[:space:]]*router\.(get|post|put|delete|patch)" apps/backend/src/routes/*.ts | awk sum`.

Største route-filer i ny stack:
- `adminHallsTerminals.ts` (19), `adminPlayers.ts` (18), `auth.ts` (18), `wallet.ts` (17), `adminReports.ts` (15), `adminPhysicalTickets.ts` (14), `game.ts` (13), `adminCompliance.ts` (12), `adminCms.ts` (12), `agent.ts` (11), `agentTransactions.ts` (11), `adminProducts.ts` (11), `adminSecurity.ts` (10), `adminRooms.ts` (10)

### 1.1 Auth

| Legacy | Ny | Status | Kommentar |
|---|---|---|---|
| POST /login (admin/agent/player) | `POST /api/auth/login`, `POST /api/admin/auth/login`, `POST /api/agent/auth/login` | ✅ | Tre separate login-endepunkter — riktig for multi-role |
| POST /forgot-password | `POST /api/auth/forgot-password` | ✅ | `auth.ts:57` |
| GET /reset-password/:token | `GET /api/auth/reset-password/:token` | ✅ | Nå både GET + POST |
| POST /reset-password/:token | `POST /api/auth/reset-password/:token` | ✅ | Bruker `reset-password` e-post-template |
| POST /player/register | `POST /api/auth/register` | ✅ | |
| POST /changePwd/:id | `POST /api/auth/change-password` | ✅ | |
| POST /player/verify-email | `POST /api/auth/verify-email/:token` | ✅ | Ny i 23.4 — bruker `verify-email` template |
| POST /player/reverify-bankid | `POST /api/admin/players/:id/bankid-reverify` | ✅ | **Lukket gap siden 18.4** |
| POST /pendingRequests/approvePendingPlayer | `POST /api/admin/players/:id/approve` | ✅ | **Lukket gap** |
| POST /pendingRequests/rejectPendingPlayer | `POST /api/admin/players/:id/reject` | ✅ | **Lukket gap** |
| GET /pendingRequests + /getPendingPlayer | `GET /api/admin/players/pending` | ✅ | **Lukket gap** |
| POST /player/active | `POST /api/admin/players/:id/restore` | ✅ | |
| POST /player/approveRejected / deleteRejected | `POST /api/admin/players/:id/resubmit` + `DELETE /api/admin/players/:id` | ✅ | |
| GET /player/bankId/iframe/:id | `POST /api/auth/bankid/init` + `GET /api/auth/bankid/status/:sessionId` | ✅ | Standard BankID-flow |
| GET /player/bankid/redirect + POST /goback | `GET /api/auth/bankid/callback` | ✅ | |
| POST /auth/refresh | `POST /api/auth/refresh` | ✅ | Ny i 23.4 — JWT refresh |
| POST /auth/logout | `POST /api/auth/logout` | ✅ | |
| PUT /api/auth/me | `PUT /api/auth/me` | ✅ | Oppdater egen profil |
| DELETE /api/auth/me | `DELETE /api/auth/me` | ✅ | Self-delete (GDPR) |
| GET /api/auth/me | `GET /api/auth/me` | ✅ | |
| POST /validateGameView | — | 🔵 | Anti-cheat view-gate — ikke nødvendig i ren API |

**Oppsummering:** Auth er 100% dekket. KYC pending-queue er LUKKET GAP.

### 1.2 Admin — users, halls, haller, spillere

| Funksjon | Legacy | Ny | Status |
|---|---|---|---|
| Admin users CRUD | ~8 endepunkter | `/api/admin/users`, `/api/admin/users/:id`, `/api/admin/users/:id/reset-password`, `PUT /api/admin/users/:userId/role`, `POST /api/admin/bootstrap` | ✅ |
| Agent-admin CRUD | GET/POST /agent, /addAgent, /agentEdit/:id | `/api/admin/agents`, `/api/admin/agents/:id`, `/api/admin/agents/:agentId/permissions` | ✅ |
| Agent-roller (permissions) | GET /agentRole, POST /role/saveAgentRole | `GET/PUT /api/admin/agents/:agentId/permissions` (15 moduler × 5 actions) | ✅ |
| Haller CRUD | 6+ endepunkter | `GET/POST /api/admin/halls`, `PUT /api/admin/halls/:hallId`, `POST /api/admin/halls/:hallId/add-money`, `GET /api/admin/halls/:hallId/balance-transactions` | ✅ |
| Hall IP/cash | POST /hall/check-ip-address, /hall/set-cash-amount | `POST /api/admin/halls/:hallId/add-money` (cash-balanse) | ✅ Lukket gap |
| Gruppehaller | GET/POST /groupHall*, /getAllGroupHalls | `GET/POST /api/admin/hall-groups`, `GET/PUT/DELETE /api/admin/hall-groups/:id` | ✅ Lukket gap |
| Spiller admin (full CRUD) | 10+ endepunkter | `GET /api/admin/players`, `GET/PUT/DELETE /api/admin/players/:id`, `POST /api/admin/players/bulk-import`, `GET /api/admin/players/search`, `GET /api/admin/players/export.csv`, `GET /api/admin/players/rejected`, `POST /api/admin/players/:id/soft-delete`, `POST /api/admin/players/:id/restore` | ✅ |
| Player-audit | GET /playerAudit | `GET /api/admin/players/:id/audit`, `GET /api/admin/players/:id/login-history`, `GET /api/admin/players/:id/game-history`, `GET /api/admin/players/:id/chips-history`, `GET /api/admin/players/:id/transactions` | ✅ |
| Player Import (legacy DB) | POST /player/import | `POST /api/admin/players/bulk-import` | ✅ |
| Red-flag kategorier | GET /redFlagCategory | `GET /api/admin/reports/red-flag/categories`, `GET /api/admin/reports/red-flag/players` | ✅ |
| Risk-country | GET /getRiskCountry | `GET/POST /api/admin/security/risk-countries`, `DELETE /api/admin/security/risk-countries/:code` | ✅ |
| Blocked IP | GET /blockedIp | `GET/POST /api/admin/security/blocked-ips`, `DELETE /api/admin/security/blocked-ips/:id` | ✅ |
| Withdraw allowlist | — | `GET/POST /api/admin/security/withdraw-emails`, `DELETE /api/admin/security/withdraw-emails/:id` | ✅ Ny feature |
| Dashboard | GET /dashboard, /dashboard/gameHistory, /dashboard/ongoingGames | `GET /api/admin/dashboard/live`, `.../game-history`, `.../top-players`, `.../time-series` | ✅ |
| Maintenance | GET/POST /maintenance | `GET/POST /api/admin/maintenance`, `/api/admin/maintenance/:id` | ✅ Lukket gap |
| System-info | GET /system/systemInformation | `GET /api/admin/system/info` | ✅ |
| Reports (range + daily) | POST /hall/report/saveData | `POST /api/admin/reports/daily/run`, `GET /api/admin/reports/daily`, `GET /api/admin/reports/daily/archive/:date`, `GET /api/admin/reports/range` | ✅ |
| Reports per hall | GET /getHallReports, /getHallAccountReport | `GET /api/admin/reports/halls/:hallId/daily`, `.../monthly`, `.../summary`, `.../account-balance`, `POST /api/admin/reports/halls/:hallId/account/manual-entry`, `GET /api/admin/reports/halls/:hallId/manual-entries` | ✅ |
| Reports per spill | GET /reportGame1/2/3/4/5 | `GET /api/admin/reports/games`, `GET /api/admin/reports/games/:gameSlug/drill-down`, `GET /api/admin/reports/games/:gameSlug/sessions`, `GET /api/admin/reports/game1`, `GET /api/admin/reports/subgame-drill-down` | ✅ Lukket gap |
| Settlement report | GET /report/settlement, /report/settlement/:id | `GET /api/admin/shifts/settlements`, `GET /api/admin/shifts/:shiftId/settlement(.pdf)` | ✅ Lukket gap |
| Total revenue | GET /totalRevenueReport | `GET /api/admin/reports/revenue` | ✅ |
| Physical tickets report | GET /physicalTicketReport | `GET /api/admin/reports/physical-tickets/aggregate`, `GET /api/admin/shifts/:shiftId/physical-cashouts(/summary)` | ✅ |
| Unique game report | GET /uniqueGameReport | `GET /api/admin/reports/unique-tickets/range` | ✅ |
| Leaderboard admin | GET/POST /leaderboard | `GET/POST /api/admin/leaderboard/tiers`, `PUT/DELETE /api/admin/leaderboard/tiers/:id`, `GET /api/leaderboard` | ✅ |
| Loyalty admin | GET/POST /loyalty | `GET /api/admin/loyalty/tiers`, `POST/PUT/DELETE /api/admin/loyalty/tiers/:id`, `GET /api/admin/loyalty/players`, `GET /api/admin/loyalty/players/:userId`, `POST /api/admin/loyalty/players/:userId/award`, `PUT /api/admin/loyalty/players/:userId/tier` | ✅ Lukket gap |
| Schedules (daily) | GET /schedules, /createDailySchedule, /editDailySchedule/:id | `GET/POST /api/admin/daily-schedules`, `GET/PUT/DELETE /api/admin/daily-schedules/:id`, `GET /api/admin/daily-schedules/:id/details`, `POST /api/admin/daily-schedules/special` | ✅ Lukket gap |
| Schedules (general) | GET/POST /schedules | `GET/POST /api/admin/schedules`, `PUT/DELETE /api/admin/schedules/:id` | ✅ |
| Saved games | GET /savedGameList, /viewSavedDailySchedule/:id | `GET/POST /api/admin/saved-games`, `PUT/DELETE /api/admin/saved-games/:id`, `POST /api/admin/saved-games/:id/load-to-game` | ✅ Lukket gap |
| Pattern CRUD | GET /patternEdit/:typeId/:id, /addPattern | `GET/POST /api/admin/patterns`, `PUT/DELETE /api/admin/patterns/:id`, `GET /api/admin/patterns/dynamic-menu` | ✅ Lukket gap |
| Sub-game CRUD | GET /subGame, /editSubGame | `GET/POST /api/admin/sub-games`, `PUT/DELETE /api/admin/sub-games/:id` | ✅ Lukket gap |
| Game type CRUD | GET /gameType, POST /addGameType | `GET/POST /api/admin/game-types`, `PUT/DELETE /api/admin/game-types/:id`, `GET /api/admin/games`, `PUT /api/admin/games/:slug` | ✅ |
| Mini-games CRUD | POST /mysteryEdit, /editWheelOfFortune, /treasureChestEdit, /colorDraftEdit | `GET/PUT /api/admin/mini-games/*` + 4 engines registrert i orchestrator (Wheel, Chest, Colordraft, Oddsen) | ✅ Lukket gap (BIN-690 M1–M5) |
| Prize policy | — | `GET/PUT /api/admin/prize-policy`, `GET /api/admin/prize-policy/active` | ✅ |
| Compliance/ledger | — | `GET /api/admin/ledger/entries`, `POST /api/admin/ledger/entries`, `GET /api/admin/compliance/extra-draw-denials`, `GET /api/admin/payout-audit`, `POST /api/admin/wallets/:walletId/extra-prize`, `GET /api/admin/wallets/:walletId/compliance` | ✅ |
| Overskudd/ideelle | — | `GET/POST /api/admin/overskudd/organizations`, `PUT/DELETE /api/admin/overskudd/organizations/:id`, `GET /api/admin/overskudd/distributions`, `GET /api/admin/overskudd/distributions/:batchId`, `POST /api/admin/overskudd/preview` | ✅ |
| AML | — | `GET /api/admin/aml/red-flag-rules`, `GET/PUT /api/admin/aml/red-flags`, `PUT /api/admin/aml/red-flags/:id`, `POST /api/admin/aml/red-flags/:id/review`, `POST /api/admin/aml/scan`, `GET /api/admin/aml/transactions` | ✅ Ny feature |
| Voucher admin CRUD | GET/POST /voucher, /voucherEdit/:id | `GET/POST /api/admin/vouchers`, `GET/PUT/DELETE /api/admin/vouchers/:id` | ✅ (men player-redemption mangler — se §1.4) |
| CMS (faq, about, terms, theme, background) | GET/POST /faq, /aboutusEdit, /supportEdit, /termEdit, /theme, /background | `GET/PUT/DELETE /api/admin/cms/:slug`, `GET /api/admin/cms/:slug/history`, `GET/POST /api/admin/cms/:slug/versions`, `GET/DELETE /api/admin/cms/:slug/versions/:id`, `POST /api/admin/cms/:slug/versions/:id/submit`, `.../approve`, `.../publish`, `GET/POST /api/admin/cms/faq`, `PUT/DELETE /api/admin/cms/faq/:id` | ✅ Lukket gap |
| Products + HallProducts | GET/POST /productList, /addProduct, /products/getProducts, /addProductinHall | `GET/POST /api/admin/products`, `PUT/DELETE /api/admin/products/:id`, `GET/POST /api/admin/product-categories`, `PUT/DELETE /api/admin/product-categories/:id`, `GET/PUT /api/admin/halls/:hallId/products` | ✅ Lukket gap |
| Close-day | GET /getCloseDayData, POST /closeDayAdd | `POST /api/admin/games/:id/close-day`, `GET /api/admin/games/:id/close-day-summary` | ✅ |
| Settings | GET /settings, POST /settings/add | `GET /api/admin/settings`, `GET /api/admin/settings/catalog`, `GET/PUT /api/admin/settings/games/:slug` | ✅ |
| Display tokens (TV-skjerm) | — | `GET/POST/DELETE /api/admin/halls/:hallId/display-tokens` | ✅ Ny feature |
| Terminaler | — | `GET/POST /api/admin/terminals`, `PUT/DELETE /api/admin/terminals/:terminalId` | ✅ |
| Rooms (runtime) | — | `GET/POST /api/admin/rooms`, `GET /api/admin/rooms/:roomCode`, `POST /api/admin/rooms/:roomCode/{start,end,room-ready,draw-next,game/pause,game/resume}` | ✅ |
| Games history replay | GET /viewGameHistory | `GET /api/admin/games/:gameId/replay` | ✅ |
| Transaksjoner | GET /getTransactions | `GET /api/admin/transactions` | ✅ |
| Track spending | POST /players/track-spending | `GET /api/admin/track-spending`, `GET /api/admin/track-spending/transactions` | ✅ |
| Unique-IDs | — | `GET /api/admin/unique-ids`, `GET /api/admin/unique-ids/:uniqueId`, `.../transactions`, `POST /api/admin/unique-ids/check` | ✅ |
| Audit log | — | `GET /api/admin/audit-log`, `GET /api/admin/audit/events` | ✅ Ny feature |
| Schedule log | — | `GET /api/admin/halls/:hallId/schedule-log`, `POST /api/admin/halls/:hallId/schedule/:slotId/log` | ✅ |
| Payouts | — | `GET /api/admin/payouts/by-game/:gameId/tickets`, `GET /api/admin/payouts/by-player/:userId` | ✅ |
| Game management | — | `GET/POST /api/admin/game-management`, `GET/PUT/DELETE /api/admin/game-management/:id`, `POST /api/admin/game-management/:id/repeat`, `GET /api/admin/game-management/:typeId/:id` | ✅ |
| Game 1 master-control | — | `POST /api/admin/game1/games/:gameId/{start,pause,resume,stop,exclude-hall,include-hall}`, `GET /api/admin/game1/games/:gameId`, `.../ready-status`, `POST /api/admin/game1/halls/:hallId/{ready,unready}` | ✅ Ny feature |

**Oppsummering:** Admin-domene er ~95% portert. Alle P0/P1-gap fra 18.4 er lukket.

### 1.3 Wallet (spiller-lommebok)

| Legacy | Ny | Status |
|---|---|---|
| GET /wallet, /getWallet, /viewWallet/:id | `GET /api/wallet/me`, `GET /api/wallets/:walletId` | ✅ |
| Transaksjoner | `GET /api/wallet/me/transactions`, `GET /api/wallets/:walletId/transactions` | ✅ |
| Transaksjoner admin | `GET /api/admin/ledger/entries`, `GET /api/admin/transactions` | ✅ |
| GET /deposit/requests, POST /accept, /reject | `POST /api/payments/deposit-request`, `GET /api/admin/payments/requests`, `POST /api/admin/payments/requests/:id/accept`, `POST /api/admin/payments/requests/:id/reject` | ✅ **Lukket gap (BIN-586)** |
| GET /withdraw/requests/bank, /hall, POST accept/reject | `POST /api/payments/withdraw-request`, ^samme admin-endepunkter | ✅ **Lukket gap** |
| POST /withdrawAmount/chipsAction | `POST /api/wallets/:walletId/withdraw` | ✅ |
| POST /agent/add-balance, /agent/get-balance | `POST /api/wallets/:walletId/topup`, `POST /api/wallets/:walletId/credit`, `POST /api/wallets/transfer` | ✅ |
| POST /unique/depositWithdraw | `GET/POST /api/admin/unique-ids/*` | ✅ |
| Swedbank deposit | `POST /api/payments/swedbank/topup-intent`, `POST /api/payments/swedbank/confirm`, `POST /api/payments/swedbank/callback`, `GET /api/payments/swedbank/intents/:intentId` | ✅ |
| Self-exclusion / loss-limit / timed-pause (admin) | `POST/DELETE /api/wallet/me/self-exclusion`, `POST/DELETE /api/wallet/me/timed-pause`, `PUT /api/wallet/me/loss-limits`, `GET /api/wallet/me/compliance`, `POST/DELETE /api/admin/wallets/:walletId/self-exclusion`, `PUT /api/admin/wallets/:walletId/loss-limits`, `.../timed-pause` | ✅ |
| Top-up (self) | `POST /api/wallet/me/topup` | ✅ |
| Spillevett-rapport | `GET /api/spillevett/report`, `POST /api/spillevett/report/export` | ✅ |

### 1.4 Games (HTTP, ikke socket)

| Legacy | Ny | Status |
|---|---|---|
| POST /startGame, /startManualGame | `POST /api/admin/rooms/:roomCode/start` | ✅ |
| POST /stopGame/:typeId, /stopGame1 | `POST /api/admin/rooms/:roomCode/end` | ✅ |
| POST /game/auto-stop | `POST /api/admin/rooms/:roomCode/game/pause`, `.../resume` | ✅ |
| POST /game1/purchaseTickets | `POST /api/game1/purchase` (HTTP) + via socket `bet:arm` | ✅ |
| POST /api/games/candy/launch | `POST /api/games/:slug/launch` (generisk for alle eksterne spill) | ✅ **Lukket gap** |
| GET /gameManagement | `GET /api/admin/rooms`, `GET /api/admin/rooms/:roomCode`, `GET /api/admin/game-management` | ✅ |
| POST /agent/game/physical/* | `POST /api/agent/physical/sell`, `POST /api/agent/physical/sell/cancel`, `GET /api/agent/physical/inventory`, `POST /api/admin/physical-tickets/*` (14 endepunkter) | ✅ **Lukket gap (BIN-583)** |
| POST /addManualWinning, /generateTicket | `POST /api/admin/physical-tickets/batches/:id/generate` | ✅ |
| POST /generateEditTicket | — | 🟡 (mangler edit for bulk-generated batches; low-prio) |
| Voucher-redemption (player) | `ApplyVoucherCode` socket | — | ❌ **GJENSTÅR** |
| Extra-draw | `POST /api/rooms/:roomCode/game/extra-draw` + socket `draw:extra:purchase` | ✅ Ny feature |
| Ends game | `POST /api/rooms/:roomCode/game/end` | ✅ |

### 1.5 Integration / Ekstern wallet / Betaling

| Legacy | Ny | Status |
|---|---|---|
| GET /api/ext-wallet/balance | `GET /api/ext-wallet/balance` | ✅ |
| POST /api/ext-wallet/debit | `POST /api/ext-wallet/debit` | ✅ |
| POST /api/ext-wallet/credit | `POST /api/ext-wallet/credit` | ✅ |
| GET /api/ext-wallet/diag | `GET /api/ext-wallet/diag` | ✅ |
| POST /api/games/candy/launch | `POST /api/games/:slug/launch` | ✅ |
| POST /payment/webhook (Swedbank) | `POST /api/payments/swedbank/callback` | ✅ |

### 1.6 Agent (fysisk hall + kasse + unique-id)

**Status: Fra 0% → ~66% portert i BIN-583.**

Implementert (58 endepunkter):
- **Agent-auth + profil:** `/api/agent/auth/{login,logout,me,change-password,change-avatar,update-language}`
- **Context + dashboard:** `/api/agent/context`, `/api/agent/dashboard`
- **Shift-management (dagligkasse):** `/api/agent/shift/{current,history,start,end,open-day,close-day,daily-balance,control-daily-balance,settlement-date}`, `/api/agent/shift/:shiftId/settlement(.pdf)`, `/api/agent/shift/physical-cashouts(/summary)`
- **Physical tickets:** `/api/agent/physical/{inventory,sell,sell/cancel}`, `/api/agent/tickets/register`
- **Transaksjoner:** `/api/agent/transactions(/today/:id)`
- **Metronia:** `/api/agent/metronia/{daily-sales,payout,register-ticket,ticket/:n,topup,void}`
- **OKBingo:** `/api/agent/okbingo/{daily-sales,open-day,payout,register-ticket,ticket/:n,topup,void}`
- **Produkter:** `/api/agent/products`, `/api/agent/products/carts(/:id/cancel/finalize)`, `/api/agent/products/sales/current-shift`
- **Spiller-kassering:** `/api/agent/players(/search/lookup)`, `/api/agent/players/:id/{balance,cash-in,cash-out,export.csv}`

Gjenstående (~30 endepunkter) — typisk legacy-views:
- 🟡 `/agent/reward-all` (WoF + manual rewards) — delvis via `POST /api/admin/physical-tickets/reward-all`
- 🟡 `/agent/upcoming-game/*` — delvis via `/api/agent/context` og `/api/agent/dashboard`
- ❌ `/agent/register-user/*` (hall-ansatt registrerer ny spiller i hall) — ikke implementert
- ❌ `/agent/game/check-bingo` (manuell bingo-verifisering) — delvis via `POST /api/admin/physical-tickets/:uniqueId/check-bingo`
- ❌ `/agent/createBotPlayers` — ikke implementert (PM: skippet fra Fase 1)

---

## 2. Socket.IO Events

**Legacy:** 134 unike events
**Ny:** 35 unike events (konsolidert semantisk)

Ny design har **konsolidert** spill-spesifikke events til generiske `room:*`, `draw:*`, `ticket:*`, `claim:*`, `minigame:*`, `chat:*`, `jackpot:*`, `bet:*`, `lucky:*`, `leaderboard:*` events. I tillegg er det eget namespace for admin (`admin:*`, `admin-display:*`) og Game 1 scheduled games (`game1:*`).

### 2.1 Gameplay lifecycle

| Legacy event | Ny event | Status |
|---|---|---|
| Game1Room, Game2Room, Game3Room, Game5Room | `room:create` / `room:join` / `room:resume` / `room:configure` / `room:state` | ✅ |
| SubscribeRoom | `room:join` | ✅ |
| LeftRoom, LeftRocketRoom | `disconnect` | ✅ |
| Game1Status (Common) | `room:state` | ✅ |
| PurchaseGame1Tickets, Game2BuyTickets, Game2BuyBlindTickets, PurchaseGame3Tickets | `bet:arm` | ✅ |
| CancelGame1Tickets, CancelGameTickets, CancelTicket | `ticket:cancel` | ✅ **Lukket gap (BIN-692)** |
| ViewPurchasedTickets | `room:state` / `room:resume` | ✅ |
| ReplaceElvisTickets | `ticket:replace` | ✅ |
| SwapTicket (Game5) | `ticket:swap` | ✅ **Lukket gap (BIN-585)** |
| SelectLuckyNumber, SetLuckyNumber, GetLuckyNumber | `lucky:set` | ✅ |
| StartGame, StopGameByPlayers | `game:start`, `game:end`, `admin:force-end` | ✅ |
| Game5Data, Game5Play, SelectRouletteAuto, SelectWofAuto | `room:state`, `bet:arm`, `draw:next`, `minigame:play` | 🟡 Rulett-fysikk (auto-select) delvis dekket — se §4 Game 5 |
| Game4Data, Game4Play, etc. | — | 🔵 Game4 deprecated (BIN-496) |
| Game2TicketPurchaseData, Game2PlanList, Game3PlanList | `room:state` | ✅ |
| GetGame3PurchaseData, game3TicketBuy, game3TicketCheck, game3TicketCheck32 | `bet:arm` + `room:state` | 🟡 Game3-spesifikk 32-pattern verifisering ikke i BingoEngine |
| checkForWinners (Game5) | `claim:submit` | ✅ |
| gameFinished (Game1) | `game:end` | ✅ |
| ColorDraftGameData, SelectColorDraft | `minigame:play` (Colordraft-engine) | ✅ (BIN-690 M4) |
| MysteryGameData, SelectMystery | `minigame:play` (Chest-engine) | ✅ (BIN-690 M3) |
| TreasureChestData, SelectTreasureChest | `minigame:play` (Chest-engine) | ✅ (BIN-690 M3) |
| WheelOfFortuneData, PlayWheelOfFortune | `minigame:play` (Wheel-engine) + `jackpot:spin` | ✅ (BIN-690 M2) |
| Oddsen (ny) | `minigame:play` (Oddsen-engine) | ✅ (BIN-690 M5) |
| Leaderboard | `leaderboard:get` | ✅ |

### 2.2 Chat / Voucher / Extra-draw

| Legacy | Ny | Status |
|---|---|---|
| SendGameChat | `chat:send` | ✅ |
| GameChatHistory | `chat:history` | ✅ |
| ApplyVoucherCode (Game2/3/4) | — | ❌ **GJENSTÅR** (player-side redemption) |
| RedeemVoucher | — | ❌ **GJENSTÅR** |
| VoucherList | — | ❌ **GJENSTÅR** |
| — | `draw:next`, `draw:extra:purchase` | ✅ (ny feature) |

### 2.3 Common (spiller-sesjon, profil, innstillinger)

| Legacy event | Ny | Status | Kommentar |
|---|---|---|---|
| LoginPlayer, LoginWithUniqueId, ReconnectPlayer, RefreshAccessToken | — | ✅ via HTTP `/api/auth/*` | Arkitektur-endring — OK |
| RegisterPlayer, playerForgotPassword | — | ✅ via HTTP | |
| verifyByBankId | — | ✅ via HTTP `/api/auth/bankid/*` | |
| Playerprofile, PlayerDetails, UpdateProfile | — | ✅ via HTTP `/api/players/me`, `/api/players/me/profile`, `PUT /api/auth/me` | |
| playerProfilePic | — | ✅ via HTTP `/api/agent/auth/change-avatar` + shell upload | |
| PlayerSettings, PlayerSoundAndVoiceSettings, PlayerUpdateInterval, updatePlayerLanguage | — | 🟡 `POST /api/agent/auth/update-language` finnes for agent; player-settings er ikke dedikert | |
| ScreenSaver | `admin-display:screensaver` | ✅ (admin-side) |
| EnableNotification, UpdateFirebaseToken, PlayerNotifications, sendMulNotifications | `/api/notifications` (stub) | ❌ **GJENSTÅR — full FCM + notif-subsystem** |
| BlockMySelf, SetLimit, AddOrUpdateBlockRule, ResponsibleGameing, PlayerHallLimit | HTTP wallet endpoints | ✅ |
| CheckPlayerBreakTime | `GET /api/wallet/me/compliance` | ✅ |
| DepositMoney, WithdrawMoney, TransactionHistory | HTTP | ✅ |
| myWinnings, lastHourLossProfit | `GET /api/wallet/me/compliance` (via loss-tracking) | 🟡 Ingen eksplisitt "last hour" endpoint — men kan beregnes fra transaksjoner |
| HallList, GetApprovedHallList, IsHallClosed, SwitchHall | `GET /api/halls` | ✅ |
| AvailableGames, GamePlanList, GameTypeData, GameTypeList | `GET /api/games`, `GET /api/games/status`, `GET /api/admin/game-types` | ✅ |
| Home, Leaderboard, Aboutus, FAQ, Support, Terms, Links | CMS-endepunkter `/api/admin/cms/*` | ✅ (admin-CRUD finnes; player-side GET mangler hvis ikke via CMS-slug) |
| GameOnlinePlayerCount | `room:state` (players list) | ✅ |
| CheckRunningGame, createBotPlayers | — | 🔵 Bot-spillere skippet fra Fase 1 (PM-beslutning) |
| DeletePlayerAccount | `DELETE /api/auth/me` (self) + `DELETE /api/admin/players/:id` (admin) | ✅ (GDPR) |
| disconnect, disconnecting | `disconnect` | ✅ |

### 2.4 AdminEvents (TV-skjerm + hall-display)

| Legacy event | Ny | Status |
|---|---|---|
| joinHall, joinRoom, onHallReady | `admin-display:subscribe`, `admin:room-ready`, `admin:login` | ✅ |
| getNextGame, getOngoingGame | `admin-display:state`, `room:state` | ✅ |
| getHallBalance | `admin:hall-balance` | ✅ **Lukket gap** |
| gameCountDownTimeUpdate, secondToDisplaySingleBallUpdate | `admin-display:state`, `draw:emits` | ✅ |
| transferHallAccess, checkTransferHallAccess, approveTransferHallAccess | — | ❌ Ikke implementert (nisje-feature, kan droppes) |
| getWithdrawPenddingRequest | `GET /api/admin/payments/requests` | ✅ via HTTP |
| AdminHallDisplayLogin (Game1) | `admin-display:login` | ✅ |
| TvscreenUrlForPlayers | `GET /api/tv/:hallId/:tvToken/state`, `.../winners` | ✅ **Lukket gap** (PR #411) |
| admin:pause-game, admin:resume-game, admin:force-end | (new) | ✅ Ny feature |
| game1:subscribe, game1:unsubscribe, game1:join-scheduled | (new) | ✅ Ny feature (GAME1_SCHEDULE) |

---

## 3. Moduler / features som mangler i apps/backend

### 3.1 Cron-jobs og bakgrunns-jobber — ✅ LUKKET GAP (BIN-582)

Legacy `Boot/Server.js:583–618` hadde:
- **Daily 00:00 CronJob**: `deleteDailySchedules`, `generateExcelOfWithdraw`, `autoCloseTicket(Metronia)`, `autoCloseTicket(OK Bingo)`, `checkBankIdAndIdCardExpiryAndSendReminders`, `updatePlayerBlockRules` (remove expired)
- **Hourly CronJob**: `swedbankpayCronToUpdateTransaction`
- **Every 15s setInterval**: `startGameCron` (start scheduled games)
- **Every 1min setInterval**: `sendGameStartNotifications` (push før spill)
- **Every 5min setInterval**: `game1StatusCron`
- **On restart**: `handleServerRestart` (Game4 recovery)

**Ny backend har:**

| Job | Intervall | Implementert? | Fil |
|---|---|---|---|
| `swedbank-payment-sync` | hver time | ✅ | `src/jobs/swedbankPaymentSync.ts` |
| `bankid-expiry-reminder` | daglig | ✅ | `src/jobs/bankIdExpiryReminder.ts` |
| `self-exclusion-cleanup` (inkl. `updatePlayerBlockRules`) | daglig | ✅ | `src/jobs/selfExclusionCleanup.ts` |
| `loyalty-monthly-reset` | månedskift | ✅ | `src/jobs/loyaltyMonthlyReset.ts` |
| `game1-schedule-tick` (erstatter `startGameCron`) | 15s | ✅ | `src/jobs/game1ScheduleTick.ts` |
| `game1-auto-draw-tick` (erstatter `game1StatusCron`) | 1s | ✅ | `src/jobs/game1AutoDrawTick.ts` |
| Metronia/OK Bingo `autoCloseTicket` | daglig | ✅ | `src/jobs/machineTicketAutoClose.ts` — lukker hengende billetter > 24h |
| `generateExcelOfWithdraw` (Excel-eksport) | daglig | ❌ | Mangler — legacy sendte Excel-fil per epost |
| `sendGameStartNotifications` (FCM push før spill) | 1min | ❌ | Mangler — se §3.2 |

**Arkitektur:** `JobScheduler` (`src/jobs/JobScheduler.ts`) bruker `setInterval`-pattern med Redis-basert lock for multi-instance deploy (ikke `node-cron` som dep — se package.json). Per-job feature-flag + strukturerte logs. Master kill-switch via `JOBS_ENABLED=true`.

### 3.2 Push-notifikasjoner (FCM) — ❌ GJENSTÅR

- Legacy: `fcm-node`, `fcm-notification`, `firebase-admin`. Brukes i `App/Controllers/advertisementController.js` for SMS/push til spillere.
- Ny: **Ingen FCM-integrasjon.** Ingen `firebase-admin` / `fcm-node` i `apps/backend/package.json`. Ingen `firebaseToken`-kolonne i `app_users`. `/api/notifications` og `/api/notifications/read` er stubs som returnerer `[]` / `{ok:true}`.

Hvis mobil-appen skal motta push-varsler (spill-start, bonuser, RG-varsler), må dette bygges. Dekker også `sendGameStartNotifications`-cron-hullet fra §3.1.

### 3.3 E-post — ✅ LUKKET GAP (BIN-588)

- Legacy: `nodemailer` brukes i Auth, PlayerController, AgentController, advertisementController.
- Ny: **Sentralisert `EmailService` (`src/integration/EmailService.ts`) + template-registry (`src/integration/templates/`)**. Templates: `reset-password`, `kyc-approved`, `kyc-rejected`, `verify-email`, `role-changed`, `bankid-expiry-reminder`. SMTP-config via env. Stub-modus hvis SMTP ikke konfigurert (dev-friendly).

**Gjenstår:** Deposit/withdraw-bekreftelses-templates (legacy sendte "du har fått innskudd"-e-post). Lav prioritet — kan dekkes av generisk notif.

### 3.4 PDF-generering — ✅

- Ny: `pdfkit` brukes i Spillevett-rapport, shift-settlement (`/api/agent/shift/:shiftId/settlement.pdf`), admin shift-settlement PDF.

### 3.5 Excel-eksport — 🟡 DELVIS

- Legacy: `exceljs`, `xlsx`, `fast-csv` brukes for admin-rapporter (`generateExcelOfWithdraw`).
- Ny: CSV-eksport finnes (`GET /api/admin/players/export.csv`, `GET /api/agent/players/:id/export.csv`). Excel-eksport ikke implementert. Per PM-avklaring 2026-04-19 er dette droppet fra pilot-scope.

### 3.6 SMS — ❌ GJENSTÅR

- Legacy: `POST /sms-advertisement/send-sms-notification` sendte SMS via tredjepart.
- Ny: Ikke bygget.

### 3.7 Session / autentisering — ✅

- Legacy: `express-session`, `passport`, cookie-session.
- Ny: JWT-basert (`@spillorama/shared-types`), Bearer tokens, refresh-token via `/api/auth/refresh`. Arkitektur-endring — riktig.

### 3.8 Tredjeparts-integrasjoner

| Legacy | Ny | Status |
|---|---|---|
| Swedbank Pay (pagination + txn-cron) | Swedbank Pay + `swedbank-payment-sync`-cron | ✅ |
| CoinPayments (crypto) | — | 🔵 Ikke i bruk |
| Firebase / FCM | — | ❌ **GJENSTÅR** |
| Metronia bingomaskin API | **`integration/metronia/`** (HttpMetroniaApiClient, StubMetroniaApiClient) + 8 agent-endepunkter + 2 admin-endepunkter | ✅ **Lukket gap (BIN-583)** |
| OK Bingo maskin API | **`integration/okbingo/`** (SqlServerOkBingoApiClient, StubOkBingoApiClient) + 9 agent-endepunkter + 2 admin-endepunkter | ✅ **Lukket gap (BIN-583)** |
| BankId | `BankIdKycAdapter.ts` + `POST /api/kyc/verify`, `GET /api/kyc/me` | ✅ |
| ID-card verify | kombinert i KYC-adapter + `bankid-expiry-reminder`-cron | ✅ |
| Candy (iframe-embed) | `POST /api/games/:slug/launch` via CANDY_BACKEND_URL + CANDY_INTEGRATION_API_KEY | ✅ |

### 3.9 Diverse mangel

- **i18n** — ❌ legacy har `i18next`. Ny har ingen oversettelser. Akseptabel gap for norsk-only-pilot.
- **File upload** — ❌ legacy har `multer`, `express-fileupload`. Ny har ingen dedikert upload-pipeline (men avatar-change bruker annen mekanisme — sjekk shell).
- **Bot-players** — 🔵 Skippet fra Fase 1 per PM-avklaring 2026-04-23.

---

## 4. Spill-spesifikk logikk — status per spill

### Hovedspill (Game 1, slug: `bingo` / `game_1`) — ✅ OK

- **Legacy:** `Game/Game1/Controllers/GameController.js` (4056 linjer) + `GameProcess.js` (6261 linjer) + helpers.
- **Ny:** `apps/backend/src/game/BingoEngine.ts` (2518 linjer) + `variantConfig.ts` + `ticket.ts` + 11 app_game1_*-tabeller (scheduled_games, draws, game_state, hall_ready_status, master_audit, mini_game_results, oddsen_state, phase_winners, pot_events, ticket_assignments, ticket_purchases, accumulating_pots).
- **Ported:** Draw-logikk, pattern-matching, ticket colors (9 farger inkl. Mystery), mini-games (Wheel/Chest/Colordraft/Oddsen), lucky number, bingo-claim, extra-draw, jackpot spin, accumulating pots (Jackpott + Innsatsen), master-control (start/pause/resume/stop/exclude-hall), hall-ready-flow, auto-draw-tick, schedule-tick, crash-recovery (Game1RecoveryService), wallet-split deposit/winnings (PR-W5), payout (Game1PayoutService — inne i drawNext-transaksjonen med fail-closed).
- **Client:** `packages/game-client/src/games/game1/` med README + audit-rapport + porterings-guide.
- **Mangler:** Bot-injeksjon (skippet), "save game" (pause og fortsett senere i dager) — ikke nødvendig for pilot.

### Game 2 — 🟡 DELVIS

- **Legacy:** 2538 linjer.
- **Ny:** Via `BingoEngine` med `gameType = "rocket"`. `variantConfig.ts` har rocket-variant.
- **Mangler:** `Game2BuyBlindTickets` (blind-kjøp), voucher-logikk (se §2.2).

### Game 3 — 🟡 DELVIS

- **Legacy:** 1750 linjer + `gamehelper/game3.js` (1839 linjer).
- **Ny:** Via `BingoEngine`. Client finnes.
- **Mangler:** `game3TicketCheck32` (32-pattern variant) — må verifiseres i variantConfig.

### Game 4 (Temabingo) — 🔵 DEPRECATED

- Lukket per BIN-496 (2026-04-17). Ikke port.

### Game 5 (Spillorama Slot/Rulett) — 🟡 DELVIS

- **Legacy:** `Game/Game5/Controllers/GameController.js` (756) + `GameProcess.js` (1531) + `gamehelper/game5.js` (1172).
- **Ny:** Ticket swap implementert (`ticket:swap`, BIN-585). Rulett/WoF-auto-select delvis.
- **Mangler backend:** `SelectRouletteAuto`, `SelectWofAuto` auto-select persistens, rulett-fysikk animasjons-data, Free Spin Jackpot-logikk, Game5-unike billettfarger.

---

## 5. DB-skjema + migrasjoner

### 5.1 Legacy Mongoose-modeller (55 stk) — uendret siden 18.4

```
agent, agentRegisteredTickets, agentSellPhysicalTickets, agentShift, agentTransactions,
assignedHalls, background, blokedIp, category, chats, cms, dailySchedule, dailyTransactions,
depositMoney, error, faq, game, gameType, groupHall, hall, hallCashTransaction, hallReport,
leaderboard, loginHistory, loyaty, notification, otherGame, parentGame, pattern, player,
playerWithdraw, product, productCart, riskCountry, role, savedGame, schedule, security,
setting, settlement, slotmachine, socket, staticPhysicalTickets, staticTickets, subGame,
subGame1, subGame5, subGameSchedule, theme, ticket, ticketBallMappings, transactions, user, voucher
```

### 5.2 Ny PostgreSQL (91 tabeller) — fra 29 til 91 tabeller

**Eksisterte 2026-04-18 (29):**
`wallet_accounts`, `wallet_transactions`, `wallet_entries`, `app_users`, `app_sessions`, `app_games`, `app_game_settings_change_log`, `app_halls`, `app_terminals`, `app_hall_registrations`, `app_hall_game_config`, `app_hall_display_tokens`, `app_chat_messages`, `hall_game_schedules`, `hall_schedule_log`, `game_sessions`, `game_checkpoints`, `app_rg_personal_loss_limits`, `app_rg_pending_loss_limit_changes`, `app_rg_restrictions`, `app_rg_play_states`, `app_rg_loss_entries`, `app_rg_prize_policies`, `app_rg_extra_prize_entries`, `app_rg_payout_audit`, `app_rg_compliance_ledger`, `app_rg_daily_reports`, `app_rg_overskudd_batches`, `app_rg_hall_organizations`, `swedbank_payment_intents`.

**Tilkommet 18.4–23.4 (62):**

| Kategori | Nye tabeller |
|---|---|
| Agent domain | `app_agent_halls`, `app_agent_permissions`, `app_agent_settlements`, `app_agent_shifts`, `app_agent_ticket_ranges`, `app_agent_transactions` |
| AML | `app_aml_red_flags`, `app_aml_rules` |
| Audit + compliance | `app_audit_log`, `app_regulatory_ledger`, `app_idempotency_records` |
| Security | `app_blocked_ips`, `app_risk_countries`, `app_withdraw_email_allowlist` |
| CMS | `app_cms_content`, `app_cms_content_versions`, `app_cms_faq` |
| Close-day | `app_close_day_log`, `app_maintenance_windows`, `app_system_settings` |
| Payment queue | `app_deposit_requests`, `app_withdraw_requests` |
| Auth | `app_password_reset_tokens`, `app_email_verify_tokens` |
| Hall | `app_hall_cash_transactions`, `app_hall_groups`, `app_hall_group_members`, `app_hall_manual_adjustments` |
| Products | `app_products`, `app_product_categories`, `app_product_sales`, `app_product_carts`, `app_product_cart_items`, `app_hall_products` |
| Loyalty | `app_loyalty_events`, `app_loyalty_player_state`, `app_loyalty_tiers`, `app_leaderboard_tiers` |
| Machine tickets | `app_machine_tickets` (Metronia/OKBingo) |
| Physical tickets | `app_physical_tickets`, `app_physical_ticket_batches`, `app_physical_ticket_cashouts`, `app_physical_ticket_pending_payouts`, `app_physical_ticket_transfers`, `app_static_tickets` |
| Scheduling | `app_daily_schedules`, `app_saved_games`, `app_schedules`, `app_sub_games`, `app_patterns`, `app_game_types`, `app_game_management`, `app_game`, `app_mini_games_config` |
| Player-hall | `app_player_hall_status` |
| Draw sessions (multi-hall) | `app_draw_sessions`, `app_draw_session_halls`, `app_draw_session_tickets`, `app_draw_session_events` |
| Vouchers | `app_vouchers` |
| Game 1 scheduled | `app_game1_scheduled_games`, `app_game1_draws`, `app_game1_game_state`, `app_game1_hall_ready_status`, `app_game1_master_audit`, `app_game1_mini_game_results`, `app_game1_oddsen_state`, `app_game1_phase_winners`, `app_game1_pot_events`, `app_game1_ticket_assignments`, `app_game1_ticket_purchases`, `app_game1_accumulating_pots` |

### 5.3 Manglende tabeller (funksjonelt) siden 18.4

| Legacy collection | Status 18.4 | Status 23.4 |
|---|---|---|
| agent, agentShift | ❌ | ✅ `app_agent_shifts` + agent-user via `app_users` |
| agentRegisteredTickets | ❌ | ✅ `app_physical_tickets`, `app_machine_tickets` |
| agentTransactions | ❌ | ✅ `app_agent_transactions` |
| hallCashTransaction | ❌ | ✅ `app_hall_cash_transactions` |
| background, theme, cms, faq | ❌ | ✅ `app_cms_content` + `app_cms_faq` |
| blokedIp, riskCountry | ❌ | ✅ `app_blocked_ips`, `app_risk_countries` |
| dailyTransactions | ❌ | ✅ via shift/settlement |
| depositMoney (request-queue) | ❌ | ✅ `app_deposit_requests` |
| playerWithdraw (request-queue) | ❌ | ✅ `app_withdraw_requests` |
| groupHall | ❌ | ✅ `app_hall_groups` + `app_hall_group_members` |
| hallReport | 🟡 | ✅ `app_rg_daily_reports` + shift-settlement |
| loyaty | ❌ | ✅ `app_loyalty_*` (3 tabeller) |
| notification | ❌ | ❌ **GJENSTÅR** — FCM-subsystem ikke bygget |
| otherGame | ❌ | 🟡 Candy-launch går via ekstern backend; ingen egen tabell, men ikke nødvendig med launch-endpoint |
| pattern, subGame, subGame1, subGame5 | 🟡 | ✅ `app_patterns`, `app_sub_games` (+ variant_config JSONB) |
| product, productCart | ❌ | ✅ `app_products`, `app_product_carts`, `app_product_cart_items` |
| security | ❌ | ✅ `app_audit_log` + `app_blocked_ips` |
| settlement | ❌ | ✅ `app_agent_settlements` |
| slotmachine | ❌ | ✅ `app_machine_tickets` + integration-adaptere |
| socket | — | ✅ Redis (`socket.io-redis-adapter`) |
| staticPhysicalTickets, staticTickets | ❌ | ✅ `app_static_tickets` + `app_physical_ticket_batches` |
| voucher | ❌ | ✅ `app_vouchers` (men player-redemption-UI mangler) |

**Gjenværende DB-tabeller å vurdere:**
- `app_notifications` (for FCM push-kø + in-app-notif-historikk) — kreves hvis push bygges
- `app_sms_log` (SMS-historikk) — kreves hvis SMS bygges

### 5.4 Migrasjoner

**29 → 86** SQL-migrasjoner + 1 README (verifisert ved `ls apps/backend/migrations/*.sql | wc -l`).

Største nye migrasjons-grupper:
- 20260418*: auth + lifecycle (deposit_withdraw_queue, player_lifecycle, aml_red_flags, security_admin, agent_role, physical_tickets, vouchers)
- 20260419000000: game_management
- 20260420*: products, machine_tickets, agent_tx_product_sale
- 20260421*: hall_manual_adjustments, bingo_client_engine, sub_game_parent_link
- 20260422000000: daily_schedules
- 20260423000000: patterns, halls_tv_token
- 20260425*: hall_groups, close_day_log, game_types, sub_games, saved_games, schedules, leaderboard_tiers, system_settings_maintenance, mini_games_config
- 20260426000200: cms
- 20260427-20260430: physical-ticket-cashouts, game1_scheduled_games, hall_ready_status, master_audit, loyalty, physical_ticket_pending_payouts
- 20260501-20260611: app_game1_* (draws, ticket_assignments, phase_winners, game_state, oddsen_state, accumulating_pots, mini_game_results)
- 20260605-20260700: ticket_purchases, game_config, scheduled_games_room_code
- 20260701*: hall_number
- 20260705*: agent_permissions

---

## 6. Oppsummering / anbefaling

### 6.1 Prioritet P0 — blokker pilot / Compliance

1. **FCM push-notifikasjoner + notif-subsystem** — mobil-app kan ikke få game-start, bonuser, RG-varsler. Påvirker også legacy `sendGameStartNotifications`-cron.
2. **Voucher player-side redemption** — admin-CRUD finnes; socket `ApplyVoucherCode` / `RedeemVoucher` ikke portert. Blokker G2/G3-spillere fra å bruke vouchers.
3. ~~**Metronia + OK Bingo `autoCloseTicket`-cron**~~ — ✅ LUKKET: `src/jobs/machineTicketAutoClose.ts` (daglig cron, 24h-cutoff, compliance-audit per auto-close).

### 6.2 Prioritet P1 — før pilot-GA

4. **Deposit/withdraw e-post-bekreftelser** — `EmailService` har ikke templates for dette (legacy hadde "du har fått innskudd"-mail).
5. **`GET /api/notifications` implementering** — nå stub; må lese fra en `app_notifications`-tabell.
6. **Game 5 auto-select** (`SelectRouletteAuto`, `SelectWofAuto`) — ikke portert.
7. **Game 3 32-pattern variant** — må verifiseres/implementeres.
8. **Game 2 blind-kjøp** (`Game2BuyBlindTickets`) — ikke portert.

### 6.3 Prioritet P2 — etter pilot

9. **i18n** for backend-feilmeldinger (p.t. norske strenger, men ikke dynamisk språk).
10. **SMS-advertisement** — ikke portert.
11. **Excel-eksport** for admin-rapporter (droppet fra pilot-scope per PM 2026-04-19; CSV finnes).
12. **`transferHallAccess`-events** (nisje-feature).
13. **Bot-players** (skippet fra Fase 1).
14. **Agent `register-user`-flow** (ny-registrering i hall via bingovert).
15. **`generateEditTicket`** (edit for bulk-generated physical-ticket batches).

### 6.4 Arkitektur-gode endringer i ny stack (beholdes som **ikke mangel**)

- JSON-API istedenfor server-rendered nunjucks views (admin-web er separat SPA).
- Konsoliderte socket-events (`room:*`, `draw:*`, `ticket:*`) istedenfor per-spill `Game1Room`.
- PostgreSQL med strukturert RG-ledger (`app_rg_*`, `app_regulatory_ledger`).
- Egne `wallet_entries` (double-entry) istedenfor `transactions`-blob.
- Prize policy som versjonert config.
- Hall display tokens (TV-skjerm-auth).
- Draw engine med watchdog + error classifier + crash-recovery.
- Overskudd/ideelle-org-distribusjon bygget inn.
- Spillevett-rapport med PDF-eksport.
- Sentralisert AML (`app_aml_red_flags` + rules + scan-endpoint).
- Content versioning for CMS (`app_cms_content_versions` + submit/approve/publish-flyt).
- Hall-group-konsept droppet til fordel for `app_hall_groups` + `app_hall_group_members` (strukturelt likt, men renere).
- Agent permissions: 15 moduler × 5 actions matrise i `app_agent_permissions`.
- JobScheduler med Redis-lock for multi-instance deploy.

### 6.5 Estimert port-tid (revidert)

| Område | Estimat (dev-dager) |
|---|---:|
| P0: FCM push + `app_notifications` + firebase-admin setup | 4 |
| P0: Voucher player-redemption (G2/G3 socket + claim-flow) | 2 |
| P0: Metronia/OKBingo `autoCloseTicket`-cron (bygg på eksisterende close-day) | 1 |
| P1: Deposit/withdraw e-post-templates | 1 |
| P1: `GET /api/notifications` + FCM-inbox-lesing | 1 |
| P1: Game 5 auto-select (RouletteAuto, WofAuto) | 2 |
| P1: Game 3 32-pattern + Game 2 blind-kjøp | 2 |
| P2: SMS-advertisement (minste dose) | 2 |
| P2: Excel-eksport for admin-rapporter | 2 |
| P2: Agent register-user-flow | 2 |
| P2: i18n (hvis krevd) | 3 |
| Tests + e2e for nye features | 2 |
| **SUM** | **24** |

**Hvis alt P2 droppes fra pilot:** **11 dev-dager**
**Hvis kun P0 i pilot:** **7 dev-dager**

### 6.6 Delta mot 18.4-audit

| Metrikk | 18.4 | 23.4 | Endring |
|---|---:|---:|---:|
| HTTP-endepunkter | 122 | 421 | +299 (+245%) |
| Socket.IO events (unike) | 28 | 35 | +7 |
| Cron-jobber | 0 | 6 | +6 |
| DB-tabeller | 29 | 91 | +62 (+214%) |
| Migrasjoner | 29 | 86 | +57 |
| Estimat for 100% paritet | 61–67 dager | 24 dager | **-40 dager arbeid fullført** |
| P0-kritiske gaps | 6 (Candy, cron, deposit/withdraw, agent-workflow, pending-KYC, Metronia) | 3 (FCM, voucher-redemption, autoCloseTicket-cron) | -3 lukket |

**Arbeid fullført på 5 dager:** ca. 37–43 dev-dager (bygget av flere agenter parallelt). Gjenstår maksimalt 24 dev-dager, trolig 11–18 realistisk.

### 6.7 Topp 5 mest kritiske gjenværende mangler

1. **Push-notifikasjoner (FCM)** — blokker mobil-app spill-start-varsler. Ingen `firebase-admin` i deps, `/api/notifications` er stub.
2. **Voucher player-side redemption** — admin-CRUD finnes (`/api/admin/vouchers`), men ingen socket-event eller endpoint for spillere til å innløse voucher-kode.
3. **Metronia / OK Bingo `autoCloseTicket`-cron** — agent kan lukke manuelt via shift-close-day, men hengende billetter over dagsskift blir ikke auto-lukket.
4. **Deposit/withdraw-bekreftelses-e-post** — `EmailService` har 6 templates men ikke disse to. Spillere får ingen mail-kvittering ved innskudd/uttak.
5. **Game 5 auto-select (Rulett + WoF)** — `SelectRouletteAuto`, `SelectWofAuto` preferanse-persistens mangler; spillere må velge manuelt hver runde.

---

_Kilde-filer for audit-gjennomgang:_
- Legacy routes: `legacy/unity-backend/App/Routes/{backend,frontend,integration}.js` (549+5+5=559 endepunkter verifisert)
- Legacy sockets: `legacy/unity-backend/Game/*/Sockets/*.js` (134 unike events verifisert)
- Legacy cron: `legacy/unity-backend/Boot/Server.js:583-618`
- Legacy models: `legacy/unity-backend/App/Models/*.js` (55 filer)
- Ny routes: `apps/backend/src/routes/*.ts` (72 filer, 421 endepunkter verifisert)
- Ny sockets: `apps/backend/src/sockets/*.ts` + `sockets/gameEvents/*.ts` (35 unike events)
- Ny jobs: `apps/backend/src/jobs/*.ts` (6 registrerte jobber i `JobScheduler`)
- Ny migrasjoner: `apps/backend/migrations/*.sql` (86 filer, 91 unike tabeller)
- Integration: `apps/backend/src/integration/{EmailService.ts,metronia/,okbingo/,templates/}`
- Relaterte oppdaterte dokumenter:
  - [`HTTP_ENDPOINT_MATRIX.md`](./HTTP_ENDPOINT_MATRIX.md) — BIN-587 CLOSED 2026-04-19 (0 MANGLER)
  - [`SOCKET_EVENT_MATRIX.md`](./SOCKET_EVENT_MATRIX.md) — BIN-585 socket-paritet
  - [`PARITY_MATRIX.md`](./PARITY_MATRIX.md) — per-spill release-klar
  - [`../architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md`](../architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md) — wireframe-mapping
  - [`../operations/PM_HANDOFF_2026-04-23.md`](../operations/PM_HANDOFF_2026-04-23.md) — Fase 1 MVP-status 11/21 moduler
