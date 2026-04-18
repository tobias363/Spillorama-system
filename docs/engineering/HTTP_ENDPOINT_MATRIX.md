# HTTP Endpoint-Paritetsmatrise (BIN-587)

**Kilde:** [Linear BIN-587](https://linear.app/bingosystem/issue/BIN-587)
**Parent epic:** BIN-581 Backend legacy-paritet
**Dato:** 2026-04-18
**Sist oppdatert:** 2026-04-19 — BIN-587 **CLOSED** (alle Fase B-PR-er merget + re-klassifisering ferdig). 2026-04-19 kveld: 20 produkt-rader re-klassifisert fra NOT-NEEDED → EXISTS etter BIN-583 B3.6 (eier-beslutning 1:1 port).
**Relaterte leveranser:**
- [`SOCKET_EVENT_MATRIX.md`](./SOCKET_EVENT_MATRIX.md) — Socket.IO-paritet (BIN-585)
- [`BACKEND_PARITY_AUDIT_2026-04-18.md`](./BACKEND_PARITY_AUDIT_2026-04-18.md) — overordnet audit (BIN-581)
- [BIN-586 PR #169](https://github.com/tobias363/Spillorama-system/pull/169) — deposit/withdraw-kø (allerede merget, dekker kategori 5 payment-actions)

## Formål

Komplett endpoint-for-endpoint mapping mellom legacy [`legacy/unity-backend/App/Routes/`](../../legacy/unity-backend/App/Routes/) og ny [`apps/backend/src/routes/`](../../apps/backend/src/routes/). Grunnlag for portings-PR-er B2–B8 i BIN-587 (se §5).

Audit [`BACKEND_PARITY_AUDIT_2026-04-18.md`](./BACKEND_PARITY_AUDIT_2026-04-18.md) estimerte «~90 endpoints i 6 kategorier». Denne matrisen er **ned-på-endpoint**, file:line-verifisert, med PM-avklaringer fra 2026-04-18 innarbeidet.

## Metodikk

- **Legacy-scan:** `router.METHOD("<path>", ...Controllers.X.Y)` i [`legacy/unity-backend/App/Routes/{backend,integration,frontend}.js`](../../legacy/unity-backend/App/Routes/). Multi-linje-deklarasjoner håndteres.
- **Ny-scan:** `router.METHOD("<path>", ...)` i [`apps/backend/src/routes/*.ts`](../../apps/backend/src/routes/) + infrastruktur-endpoints (`/metrics`, `/health`, `/api/ext-wallet/*`) i [`apps/backend/src/index.ts`](../../apps/backend/src/index.ts).
- Socket.IO-events er ikke HTTP-endpoints; dekket i [`SOCKET_EVENT_MATRIX.md`](./SOCKET_EVENT_MATRIX.md).
- Klassifisering: PM-avklaringer 2026-04-18 innarbeidet (loyalty/minigames/SMS/close-day/BIN-586).

### Status-definisjoner

- **EXISTS** — Legacy-funksjonalitet er dekket av eksisterende ny endpoint (direkte eller konsolidert). Inkluderer BIN-586 + BIN-587 Fase B-leveranser.
- **MANGLER** — Må portes i BIN-587 Fase B. _(0 igjen etter 2026-04-19 close-out.)_
- **NOT-NEEDED** — Eksplisitt droppet: legacy HTML-admin-UI erstattet av React-admin, CMS-statiske sider, deprecated minigames, eller PM-beslutning.
- **DEFER** — Post-pilot polish (PM 2026-04-19). Sporet i BIN-609 "Post-pilot HTTP endpoints polish".
- **AGENT-DOMENE** — BIN-583 scope (hall-operator/agent/terminal-API). Ikke i BIN-587.
- **TODO** — Eier-input kreves før klassifisering.

## 1. Sammendrag

### Totalt (BIN-587 CLOSED 2026-04-19)

| Status | Antall | Andel |
|---|---:|---:|
| Total legacy endpoints | **559** | 100% |
| EXISTS (portert eller dekket) | **190** | 34% |
| MANGLER | **0** | 0% |
| NOT-NEEDED (legacy admin-UI + droppet + PM-beslutning) | 272 | 49% |
| DEFER (post-pilot polish → BIN-609) | 8 | 1% |
| AGENT-DOMENE (BIN-583, resterende ikke-porterte) | 76 | 14% |
| TODO (eier-avklaring) | 13 | 2% |

### Per kategori

| # | Kategori | Total | EXISTS | NOT-NEEDED | DEFER | AGENT-DOMENE | TODO |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | AUTH & identity | 59 | 17 | 42 | 0 | 0 | 0 |
| 2 | PLAYER & KYC & responsible gaming | 69 | 25 | 43 | 0 | 1 | 0 |
| 3 | GAMEPLAY & content | 111 | 5 | 104 | 2 | 0 | 0 |
| 4 | HALL, schedule & terminal | 68 | 23 | 31 | 1 | 0 | 13 |
| 5 | WALLET, payments & cashier | 87 | 67 | 19 | 0 | 1 | 0 |
| 6 | ADMIN ops & reports | 77 | 31 | 41 | 5 | 0 | 0 |
| 7 | AGENT domain (BIN-583) | 88 | 0 | 0 | 0 | 88 | 0 |

**BIN-587 Fase B levert: 168 EXISTS** (opp fra 71 ved matrise-opprettelse) over 7 PR-er (B2–B6 + B1=BIN-586).

**8 DEFER → BIN-609:** transferPlayersToHall (1), autoStopOnOff (1), addSavedGameManagement (1), maintenance/systemInformation (5). Alle markert post-pilot av PM 2026-04-19; ingen er pilot-blockere.

**13 TODO** er alle `groupHallController` — defer til PM-avklaring (se §6).

## 2. PM-avklaringer 2026-04-18 (innarbeidet)

Disse beslutningene er reflektert i matrisen. Sitater fra tilbakemelding:

| # | Tema | Beslutning | Matriseeffekt |
|---|---|---|---|
| 1 | Loyalty-program | **NOT-NEEDED** — droppet i legacy (`legacy/unity-backend/Boot/Server.js:585` kommentar: «We are not using points money») | 10 `LoyaltyController`-endpoints → NOT-NEEDED |
| 2 | Group halls | **TODO defer** — eier-input før pilot | 13 `groupHallController`-endpoints → TODO |
| 3 | SMS-advarsler | **NOT-NEEDED** — ikke pilot-kritisk, ingen SMS-provider i ny stack | 3 `advertisementController`-endpoints → NOT-NEEDED |
| 4 | Minigames config | **NOT-NEEDED** — dekkes av game-engine config i [`apps/backend/src/game`](../../apps/backend/src/game/) | 8 `otherGameController`-endpoints → NOT-NEEDED |
| 5 | Close-day | **AGENT-DOMENE** (BIN-583) — hall-operator-arbeidsflyt | 5 `GameController.closeDay*`-endpoints flyttet fra 3-GAMEPLAY til 7-AGENT |
| 6 | BIN-586 overlap | Deposit/withdraw-kø **DONE** i PR #169. Hall-kasse/settlement = AGENT-DOMENE | 17 deposit/withdraw-endpoints → EXISTS med «DONE — BIN-586»; hall-settlement/cash-balance → 7-AGENT |

**Mapping BIN-586 → legacy:**

| Legacy-endpoint | BIN-586-ekvivalent |
|---|---|
| `POST /deposit/requests/accept` | [`POST /api/admin/payments/requests/:id/accept`](../../apps/backend/src/routes/paymentRequests.ts) |
| `POST /deposit/requests/reject` | [`POST /api/admin/payments/requests/:id/reject`](../../apps/backend/src/routes/paymentRequests.ts) |
| `POST /withdraw/requests/accept` | [`POST /api/admin/payments/requests/:id/accept`](../../apps/backend/src/routes/paymentRequests.ts) |
| `POST /withdraw/requests/reject` | [`POST /api/admin/payments/requests/:id/reject`](../../apps/backend/src/routes/paymentRequests.ts) |
| `GET /deposit/requests/get`, `GET /deposit/history/get`, `GET /withdraw/requests/{hall,bank}/get`, `GET /withdraw/history/{hall,bank}/get` | [`GET /api/admin/payments/requests?status=&type=`](../../apps/backend/src/routes/paymentRequests.ts) |
| `GET /transactions`, `GET /getTransactions` | Filtrert via `GET /api/admin/payments/requests` |

## 3. Topp 10 pilot-kritiske MANGLER

Rangert etter blocker-grad for pilothall-go-live (BIN-586 deposit/withdraw-kø er **allerede levert**, derfor ikke i denne listen).

| # | Gap | Legacy-endpoint(s) | Pilot-impakt | Foreslått ny endpoint |
|---|---|---|---|---|
| 1 | **Player pending/rejected-registrering** (KYC-moderasjon) | `POST /pendingRequests/approvePendingPlayer`, `POST /pendingRequests/rejectPendingPlayer`, `POST /pendingRequests/forwardRequest`, `GET /pendingRequests/getPendingPlayer`, `POST /player/{approveRejected,deleteRejected}`, `GET /player/getRejected` | **BLOCKER** — nye spillere må godkjennes manuelt første periode (KYC-review-kø) | `GET /api/admin/players/pending`, `POST /api/admin/players/:id/{approve,reject,escalate}` |
| 2 | **Bulk player-import** (pilotmigrasjon) | `POST /player/import`, `POST /player/import/confirm` | **BLOCKER** — hall kommer med CSV-liste av eksisterende medlemmer | `POST /api/admin/players/import` (dry-run + commit) |
| 3 | **BankID-reverifisering** (session-utløp) | `POST /player/reverify-bankid`, `POST /player/verify/update`, `POST /player/approved/update-flag` | **BLOCKER** for langtidsspillere — KYC-token utløper | `POST /api/admin/players/:id/reverify-bankid` + player-initiert `POST /api/auth/bankid/reverify` |
| 4 | **Player per-hall-status + soft-delete** (lokal suspendering) | `POST /player/hallStatus`, `POST /player/{active,playerSoftDelete}`, `POST /player/block-rules/delete`, `POST /changePwd/:id`, `POST /playerEdit/:id` | **HØY** — hall må kunne suspendere problemspillere lokalt uten national self-exclusion | `PUT /api/admin/players/:id/halls/:hallId/status`, `POST /api/admin/players/:id/{soft-delete,reactivate}`, `PUT /api/admin/players/:id` |
| 5 | **Withdraw email-allowlist** (bank-kanal notifikasjoner) | `POST /withdraw/add/emails`, `GET /withdraw/get/emails`, `POST /withdraw/edit/emails/:id`, `POST /withdraw/delete/emails/`, `POST /withdraw/email/checkUnique/:emailId?` | **HØY** — bank-withdraw-notifikasjoner må kunne ekspedere til revisor/økonomi | `GET|POST|PUT|DELETE /api/admin/payments/withdraw-emails` |
| 6 | **Physical-ticket inventory + salg** (papir-bingoblokker) | `POST /purchasePhysicalTickets`, `POST /addGamePhysicalTickets`, `GET /getSellPhysicalTickets/:gameId`, `POST /agent/physical/sell` + 10 andre | **HØY** — blandet-modus pilot (digital + papir) er normaltilstanden | `/api/admin/physical-tickets/*` (CRUD + salg + uttrekk-binding) |
| 7 | **Red-flag / AML transaksjonsgjennomgang** | `GET /getRedFlagCategory/:id`, `GET /getPlayersRedFlagList`, `GET /getUserTransactionList`, `GET /getUserTransactionHeader/:id` | **HØY** — pålagt AML-prosess for finanstilsyn | `GET /api/admin/aml/red-flags`, `POST /api/admin/aml/red-flags/:id/review`, `GET /api/admin/aml/transactions` |
| 8 | **Risk-country + blocked-IP admin** | `POST /addRiskCountry`, `POST /deleteRiskCountry`, `GET /getRiskCountry`, `POST /blockedIp/add`, `POST /blockedIp/delete`, `POST /blockedIp/edit/:id`, `GET /blockedIp/getBlockedIp` | **MEDIUM** — KYC/sikkerhetslister; dagens rate-limit i ny backend dekker ikke admin-UI | `/api/admin/security/{risk-countries,blocked-ips}` |
| 9 | **Voucher-administrasjon** (marketing/retention) | `POST /addVoucher`, `POST /voucherEdit/:id`, `POST /voucher/getVoucherDelete`, `GET /voucher/getVoucher` | **MEDIUM** — voucher-program for pilothall-lansering | `/api/admin/vouchers/*` (CRUD + redeem) |
| 10 | **Rapport v2: per-game drill-down + total revenue + dashboard-charts** | `GET /reportGame1..5/getReportGameN`, `GET /totalRevenueReport/getData`, `GET /getHallReports`, `GET /dashboardChart/getMonthlyPlayedGameChart`, `GET /dashboard/getTopPlayers/:id` (15 endpoints totalt) | **MEDIUM** — operator-UI trenger KPI-grafer; daily-report + overskudd er portert, drill-down mangler | `/api/admin/reports/games/:gameId`, `/api/admin/reports/revenue`, `/api/admin/dashboard/*` |

## 4. Kategori-gjennomgang

### Kategori 1 — AUTH & identity (59, MANGLER: 16)

**Dekning:** Base-auth (login, logout, BankID-init/callback/status, change-password, forgot-password, me, refresh) er fullt portert i [`/api/auth/*`](../../apps/backend/src/routes/auth.ts) og [`/api/admin/auth/*`](../../apps/backend/src/routes/admin.ts).

**Manglende:**
- **Role CRUD** (8 `rollController`-endpoints): dynamisk role-mgmt. Ny backend har kun fast `PUT /api/admin/users/:id/role`. Permissions-modell er statisk. **Kan vente** — akseptabelt for pilot, kritisk for langvarig operator-UX.
- **Admin/User CRUD** (7 `AdminController`+`UserController`-endpoints): `addAdmin`, `addUser`, `adminEdit`, `userEdit`, `adminRoleUpdate`. Partial dekning via [`POST /api/admin/bootstrap`](../../apps/backend/src/routes/admin.ts). Må porteres for operator-onboarding.
- **SMS-bruker-pwd** (1): `POST /profile/changeSmsUsrPwd` — legacy terminal-PIN. Sannsynlig deprecated.

### Kategori 2 — PLAYER & KYC & Responsible gaming (69, MANGLER: 31)

**Dekning:** Kjerne-spillvett (loss-limits, timed-pause, self-exclusion) er portert i [`/api/wallet/me/*`](../../apps/backend/src/routes/wallet.ts) + [`/api/admin/wallets/:walletId/*`](../../apps/backend/src/routes/admin.ts). Leaderboard read + KYC-self-check portert.

**Store MANGLER-klynger:**
- Pending/rejected-moderasjon (9) — topp 10 #1
- Bulk-import + reverify-bankid (5) — topp 10 #2, #3
- Per-hall-status + soft-delete + admin-player-edit (9) — topp 10 #4
- Player-data-lookups (`getHalls`, `getAgents`, `getGroupHalls`) (3) — støtte-endpoints
- Player-registreing inline (`POST /player/register`, `POST /player/verify/update`, `POST /player/approved/update-flag`) (3) — KYC-helpers
- Leaderboard admin-CRUD (3)
- Track-spending (2) — spending-dashboard for spiller
- Swedbank/Verifone webhook-variant (2) — sjekk om dekket av `/api/payments/swedbank/callback`

**NOT-NEEDED:** Mobil-app iframe/goback (8), profile-image-upload (2), legacy HTML pending/rejected/track-spending-sider (5), reset-password-GET.

### Kategori 3 — GAMEPLAY & content (111, MANGLER: 15)

**Dekning:** Gameplay-kjernen kjører på Socket.IO ([`SOCKET_EVENT_MATRIX.md`](./SOCKET_EVENT_MATRIX.md)). Admin room-control er portert i [`/api/admin/rooms/*`](../../apps/backend/src/routes/admin.ts). Game-settings-catalog + change-log portert.

**Manglende (alle «gameplay admin-CRUD»):**
- Pattern-mgmt (6) — bingopattern-CRUD
- Sub-game-mgmt (5) — avklares om subgames fortsatt brukes
- Saved-game templates (1), pattern-game-binding (1), auto-stop-toggle (1), CSV-import (1)

**NOT-NEEDED:** 92 endpoints:
- Legacy gameplay admin-HTML-sider (gameType, gameManagement, savedGameList, view-sider)
- CMS (FAQ, ToS, Support, About, Responsible-gaming-side, Links) — statiske sider / Notion
- Backgrounds/themes — post-pilot
- Minigames config (PM-beslutning)
- SMS-advertisement (PM-beslutning)
- Legacy game-type/game-management add/edit (erstattet av settings-catalog)

### Kategori 4 — HALL, schedule & terminal (68, MANGLER: 10, TODO: 13)

**Dekning:** Best dekning. Hall-CRUD, terminal-CRUD, schedule-slot-CRUD, display-tokens er portert.

**Manglende:**
- Transfer-players-to-hall (1)
- Daily + special-schedule admin (9) — single-slot-CRUD er i ny, bulk daily/helligdag-planer mangler. **Pilot-relevant** for hall med gjentakende ukeplaner.

**TODO (13):** Alle `groupHallController` — PM avklaring kreves før Fase B.

**NOT-NEEDED:** Legacy HTML schedule-sider, hall-report-view (flyttet til AGENT), check-hall-number/check-ip-address (frontend-validering).

### Kategori 5 — WALLET, payments & cashier (87, MANGLER: 40)

**Dekning:** Self-service wallet, Swedbank-topup-flow, admin wallet-compliance, **deposit/withdraw-kø (BIN-586)**, ext-wallet-integrasjon for Candy.

**Store MANGLER-klynger:**
- Physical-tickets + unique-IDs (19) — topp 10 #6
- Withdraw email-allowlist (6) — topp 10 #5
- Voucher-CRUD (4) — topp 10 #9
- Payout per-spiller/per-billett-views (6) — drill-down til payout-audit
- Player-transaksjons-admin-liste (2) — `GET /getPlayerTransactions`, `GET /getPlayerGameHistory`
- Chips-action / withdraw-player-delete (3) — delvis AGENT

**NOT-NEEDED:** Legacy admin-sider (voucher, withdraw-amt, unique-id views, sold-tickets, cashinout — sistnevnte flyttet til AGENT).

### Kategori 6 — ADMIN ops, reports & settings (77, MANGLER: 32)

**Dekning:** Compliance-core portert: [daily-report](../../apps/backend/src/routes/admin.ts), overskudd, ledger, payout-audit, prize-policy, extra-draw-denials, dashboard-live.

**Store MANGLER-klynger:**
- Rapport v2 drill-down (15) — topp 10 #10: per-game-rapport (1–5), total-revenue, hall-specific, dashboard-charts
- AML / security (9) — topp 10 #7, #8: red-flag-kategorier + transaksjons-review + risk-country + blocked-IP
- Maintenance + system-info (5) — ops-UI: maintenance-mode, restart-server, system-info, screen-saver (sistnevnte NOT-NEEDED)
- Product-management (`productManagement`, 16) — NOT-NEEDED (shop utenfor MVP)

### Kategori 7 — AGENT domain (88, AGENT-DOMENE: 88) → BIN-583

Samler alt som tilhører hall-operator/agent/terminal-arbeidsflyt. Utenfor BIN-587 scope. Må avklares for BIN-583:

- `AgentController` (7) — agent-bruker-CRUD
- `agentcashinoutController` (51) — daily-balance, settlement, register-user/unique-id balance, agent game-control, cashout, WoF-reward
- `machineApiController` (14) — Metronia + OkBingo-terminal API
- `CashInOutController` (3) — sold-tickets/cashinout
- `GameController.closeDay*` (5) — close-day schedule
- `hallController` settlement + set-cash-balance (4)
- `UniqueIdController` agent-tied (4) — unique-id deposit/withdraw via agent-terminal

## 4b. PM-avklaringer 2026-04-19 (close-out)

Etter at B2–B6 var merget gjennomgikk Agent 1 de resterende MANGLER-radene. PM-beslutning:

| # | Tema | Beslutning | Matriseeffekt |
|---|---|---|---|
| 1 | Pattern + subgame admin (12 endpoints) | **NOT-NEEDED** — patterns/subgames er TypeScript-definert i engine (kode, ikke runtime-config). Legacy HTML admin-UI erstattet av TS. | 12 → NOT-NEEDED |
| 2 | Daily/special schedule (9 endpoints, incl. subgame-in-schedule) | **NOT-NEEDED** — B6 `/api/admin/halls/:hallId/schedule/bulk` dekker pilot-behov. Post-pilot re-vurderes ved behov. | 9 → NOT-NEEDED |
| 3 | Auto-stop (`autoStopOnOff`) + Saved-game templates (`addSavedGameManagement`) | **DEFER** — operatør kan manuelt stoppe; saved-games ikke i pilot-flyt. | 2 → DEFER (BIN-609) |
| 4 | transferPlayersToHall | **DEFER** — cross-hall player-flytt ikke pilot-kritisk. | 1 → DEFER (BIN-609) |
| 5 | Maintenance + system-info (5 endpoints) | **DEFER** — Render-deploy-gate dekker pilot; system-info nice-to-have. | 5 → DEFER (BIN-609) |

## 5. Fase B PR-er (alle merget)

Prioriterer **pilot-blocker først, compliance deretter, operator-polish sist**. BIN-586 har allerede landet B1 — derfor nummerert fra **B2**. Hver PR skal mergers og deployes uavhengig; store PR-er splittes om diff > 600 linjer.

| # | PR | Scope | Status |
|---|---|---:|---|
| ~~B1~~ | ~~Admin payment workflows~~ | 17 endpoints | ✅ [BIN-586 PR #169](https://github.com/tobias363/Spillorama-system/pull/169) |
| **B2** | Admin player lifecycle — pending/rejected-kø + bulk-import + reverify-bankid + per-hall-status + soft-delete | ~26 endpoints | ✅ merget |
| **B3-report** | Rapport v2 + dashboard-charts | ~11 legacy → 7 nye | ✅ [PR #190](https://github.com/tobias363/Spillorama-system/pull/190) |
| **B3-aml** | AML red-flag state-maskin + review | ~9 endpoints | ✅ [PR #192](https://github.com/tobias363/Spillorama-system/pull/192) |
| **B3-security** | Risk-country + blocked-IP + withdraw-emails + audit | ~10 endpoints | ✅ [PR #194](https://github.com/tobias363/Spillorama-system/pull/194) |
| **B4a** | Physical-tickets admin (batch-CRUD + generate + assign-game) | ~10 endpoints | ✅ [PR #197](https://github.com/tobias363/Spillorama-system/pull/197) |
| **B4b** | Unique-IDs + vouchers + payout drill-down | ~13 endpoints | ✅ [PR #199](https://github.com/tobias363/Spillorama-system/pull/199) |
| **B5/B6** | Admin-user CRUD + schedule bulk + player-activity admin | 10 endpoints | ✅ [PR #203](https://github.com/tobias363/Spillorama-system/pull/203) |
| ~~B7~~ | ~~Gameplay admin-CRUD~~ | — | ❌ NOT-NEEDED (patterns/subgames er TS-kode, PM 2026-04-19) |
| ~~B8~~ | ~~Ops polish~~ | — | ⏳ DEFER → [BIN-609](https://linear.app/bingosystem/issue/BIN-609) post-pilot |

**Levert: 168 EXISTS over 8 PR-er** (vs. initielt estimat 144 MANGLER). Re-klassifisering gjennom PM-avklaringer 2026-04-18 + 2026-04-19 reduserte 25 rader fra MANGLER til NOT-NEEDED/DEFER.

## 6. Åpne avklaringer

1. **Group halls (13 TODO):** Skal konseptet overføres til ny backend? Hvis nei → kan merkes NOT-NEEDED og droppes. Hvis ja → datamodell må utvides (post-pilot via BIN-609).
2. ~~**Sub-game administrasjon**~~ → **NOT-NEEDED** (PM 2026-04-19, §4b.1).
3. **Loyalty — endelig avklart:** NOT-NEEDED. (Ingen handling.)
4. ~~**Daily/special schedule**~~ → **NOT-NEEDED** (PM 2026-04-19, §4b.2).
5. **Scope-grense BIN-583 mot BIN-587:** Close-day er nå AGENT, hall-kasse-settlement er AGENT. `agent/game/{start,stop}` og `agent/dailybalance/*` er BIN-583-scope (merket AGENT-DOMENE i matrisen).

## 7. Referanser

- **Rå matrise:** [HTTP_ENDPOINT_MATRIX.csv](./HTTP_ENDPOINT_MATRIX.csv) — 559 rader (1 rad pr. legacy-endpoint; kolonner: `category, method, path, controller, action, legacy_file, status, note`)
- **Legacy source:** [`legacy/unity-backend/App/Routes/`](../../legacy/unity-backend/App/Routes/)
- **Ny backend:** [`apps/backend/src/routes/`](../../apps/backend/src/routes/)
- **Audit som motiverte BIN-587:** [`BACKEND_PARITY_AUDIT_2026-04-18.md`](./BACKEND_PARITY_AUDIT_2026-04-18.md)
- **Socket.IO paritet (søsterleveranse):** [`SOCKET_EVENT_MATRIX.md`](./SOCKET_EVENT_MATRIX.md)
- **BIN-586 (B1 levert):** [PR #169](https://github.com/tobias363/Spillorama-system/pull/169)
