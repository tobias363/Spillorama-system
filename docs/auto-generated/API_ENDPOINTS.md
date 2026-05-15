# API-endpoints-katalog

> **AUTO-GENERERT — IKKE REDIGER MANUELT.** Denne filen overskrives av
> `.github/workflows/auto-generate-docs.yml` på hver push til main.
>
> Generator: `scripts/generate-architecture-docs.sh`
> Sist oppdatert: 2026-05-15T19:15:47Z
> Commit: `8ad1a4ef` (branch: `main`)

Liste over alle endpoints definert i `apps/backend/openapi.yaml`. Dette er
**kontrakten** — implementasjonen i `apps/backend/src/routes/` skal matche.
Hvis du finner ruter i kode som ikke står her, åpne sak: enten skal de
dokumenteres eller fjernes.

> **Auth-konvensjon:** Default er Bearer JWT. Endepunkter som er offentlige
> (login, public CMS, status, public game-health, csp-report, webhook) har
> `security: []` i specen.

## Endpoints gruppert på tag

### Admin — Agents

| Metode | Path | Sammendrag |
|---|---|---|
| `DELETE` | `/api/admin/agents/{id}` | Soft-delete agent (AGENT_DELETE — ADMIN only) |
| `GET` | `/api/admin/agents` | List agents (AGENT_READ — ADMIN/HALL_OPERATOR/SUPPORT) |
| `GET` | `/api/admin/agents/{id}` | Get a single agent |
| `POST` | `/api/admin/agents` | Create an agent (AGENT_WRITE — ADMIN/HALL_OPERATOR) |
| `PUT` | `/api/admin/agents/{id}` | Update agent (AGENT_WRITE) |

### Admin — Auth

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/admin/auth/me` | Get the current admin user profile |
| `GET` | `/api/admin/permissions` | Get the RBAC permission list for the current admin role |
| `POST` | `/api/admin/auth/login` | Admin login |
| `POST` | `/api/admin/auth/logout` | Revoke admin session |
| `POST` | `/api/admin/bootstrap` | Bootstrap first admin account (only works when no admins exist) |
| `PUT` | `/api/admin/users/{userId}/role` | Assign a role to a user |

### Admin — Compliance

| Metode | Path | Sammendrag |
|---|---|---|
| `DELETE` | `/api/admin/wallets/{walletId}/self-exclusion` | Lift self-exclusion (admin) |
| `DELETE` | `/api/admin/wallets/{walletId}/timed-pause` | Cancel timed pause (admin) |
| `GET` | `/api/admin/compliance/extra-draw-denials` | List extra-draw purchase denials (compliance audit) |
| `GET` | `/api/admin/payout-audit` | List payout audit trail entries |
| `GET` | `/api/admin/prize-policy/active` | Get the active prize policy |
| `GET` | `/api/admin/wallets/{walletId}/compliance` | Get compliance state for a player wallet |
| `POST` | `/api/admin/wallets/{walletId}/extra-prize` | Award a manual extra prize to a player wallet |
| `POST` | `/api/admin/wallets/{walletId}/self-exclusion` | Set self-exclusion for a player wallet (admin) |
| `POST` | `/api/admin/wallets/{walletId}/timed-pause` | Set timed pause for a player wallet (admin) |
| `PUT` | `/api/admin/prize-policy` | Update the prize policy |
| `PUT` | `/api/admin/wallets/{walletId}/loss-limits` | Set loss limits for a player wallet (admin override) |

### Admin — Game Catalog

| Metode | Path | Sammendrag |
|---|---|---|
| `DELETE` | `/api/admin/game-catalog/{id}` | Soft-deactivate katalog-spill (sets isActive=false) |
| `GET` | `/api/admin/game-catalog` | List katalog-spill (filter på isActive) |
| `GET` | `/api/admin/game-catalog/{id}` | Hent ett katalog-spill |
| `POST` | `/api/admin/game-catalog` | Opprett nytt katalog-spill (krever GAME_CATALOG_WRITE) |
| `PUT` | `/api/admin/game-catalog/{id}` | Oppdater katalog-spill (partial patch, krever GAME_CATALOG_WRITE) |

### Admin — Game Plans

| Metode | Path | Sammendrag |
|---|---|---|
| `DELETE` | `/api/admin/game-plans/{id}` | Soft-deactivate spilleplan |
| `GET` | `/api/admin/game-plans` | List spilleplaner (filter hallId/groupOfHallsId/isActive) |
| `GET` | `/api/admin/game-plans/{id}` | Hent én spilleplan inkl. items + catalog-entry inline |
| `POST` | `/api/admin/game-plans` | Opprett ny spilleplan-template (uten items) |
| `PUT` | `/api/admin/game-plans/{id}` | Oppdater plan-meta (partial patch, krever GAME_CATALOG_WRITE) |
| `PUT` | `/api/admin/game-plans/{id}/items` | Atomic save av items-listen (drag-and-drop replace) |

### Admin — Games

| Metode | Path | Sammendrag |
|---|---|---|
| `DELETE` | `/api/admin/rooms/{roomCode}` | Destroy a room |
| `GET` | `/api/admin/game-settings/change-log` | Audit log of game settings changes |
| `GET` | `/api/admin/games` | List all games (including disabled) |
| `GET` | `/api/admin/games/{gameId}/replay` | Replay a completed game session event-by-event (audit) |
| `GET` | `/api/admin/rooms` | List all active rooms |
| `GET` | `/api/admin/rooms/{roomCode}` | Get full room snapshot |
| `GET` | `/api/admin/settings/catalog` | Get the settings schema catalog (all configurable keys with types and defaults) |
| `GET` | `/api/admin/settings/games/{slug}` | Get effective settings for a game |
| `POST` | `/api/admin/game1/games/{gameId}/reschedule` | Reschedule a Spill 1 scheduled-game (move start/end time) |
| `POST` | `/api/admin/rooms` | Create a new room |
| `POST` | `/api/admin/rooms/{roomCode}/draw-next` | Advance the draw by one number |
| `POST` | `/api/admin/rooms/{roomCode}/end` | End a game round |
| `POST` | `/api/admin/rooms/{roomCode}/start` | Start a game round in a room |
| `PUT` | `/api/admin/games/{slug}` | Update game metadata (enable/disable, name) |
| `PUT` | `/api/admin/settings/games/{slug}` | Update settings for a game (partial patch) |

### Admin — Halls

| Metode | Path | Sammendrag |
|---|---|---|
| `DELETE` | `/api/admin/halls/{hallId}/schedule/{slotId}` | Delete a schedule slot |
| `GET` | `/api/admin/halls` | List all halls (including inactive) |
| `GET` | `/api/admin/halls/{hallId}/game-config` | Get hall-level game configuration overrides |
| `GET` | `/api/admin/halls/{hallId}/schedule` | Get all schedule slots for a hall |
| `GET` | `/api/admin/halls/{hallId}/schedule-log` | Get schedule audit log for a hall |
| `GET` | `/api/admin/halls/{hallId}/spill1-prize-defaults` | Get per-hall Spill 1 default gevinst-floors (HV2-B3) |
| `GET` | `/api/admin/terminals` | List all terminals |
| `POST` | `/api/admin/halls` | Create a hall |
| `POST` | `/api/admin/halls/{hallId}/schedule` | Add a schedule slot to a hall |
| `POST` | `/api/admin/halls/{hallId}/schedule/{slotId}/log` | Add an operator log entry to a schedule slot (§ 64 audit) |
| `POST` | `/api/admin/terminals` | Create a terminal |
| `PUT` | `/api/admin/halls/{hallId}` | Update a hall |
| `PUT` | `/api/admin/halls/{hallId}/game-config/{gameSlug}` | Update a hall's game config override for a specific game |
| `PUT` | `/api/admin/halls/{hallId}/schedule/{slotId}` | Update a schedule slot |
| `PUT` | `/api/admin/halls/{hallId}/spill1-prize-defaults` | Update per-hall Spill 1 default gevinst-floors (HV2-B3) |
| `PUT` | `/api/admin/terminals/{terminalId}` | Update a terminal |

### Admin — Ledger

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/admin/ledger/entries` | Query compliance ledger entries |
| `GET` | `/api/admin/reports/daily` | List generated daily reports |
| `GET` | `/api/admin/reports/daily/archive/{date}` | Get a specific archived daily report |
| `POST` | `/api/admin/ledger/entries` | Manually insert a ledger entry (correction / manual prize) |
| `POST` | `/api/admin/reports/daily/run` | Generate and persist the daily activity report for a given date |

### Admin — Overskudd

| Metode | Path | Sammendrag |
|---|---|---|
| `DELETE` | `/api/admin/overskudd/organizations/{id}` | Remove a recipient organisation |
| `GET` | `/api/admin/overskudd/distributions` | List surplus distribution batches |
| `GET` | `/api/admin/overskudd/distributions/{batchId}` | Get a specific distribution batch with line items |
| `GET` | `/api/admin/overskudd/organizations` | List recipient organisations |
| `GET` | `/api/admin/overskudd/preview` | Preview surplus (overskudd) distribution amounts before committing |
| `POST` | `/api/admin/overskudd/distributions` | Create and commit a surplus distribution batch |
| `POST` | `/api/admin/overskudd/organizations` | Register a new recipient organisation |

### Admin — Payment Requests

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/admin/deposits/history` | Deposit history listing (GAP #10 — legacy /deposit/history) |
| `GET` | `/api/admin/payments/requests` | List deposit/withdraw requests (filterable) |
| `GET` | `/api/admin/withdrawals/history` | Withdraw history listing (GAP #12 — legacy /withdraw/history/{hall,bank}) |
| `POST` | `/api/admin/payments/requests/{id}/accept` | Accept a PENDING request and perform the wallet operation |
| `POST` | `/api/admin/payments/requests/{id}/reject` | Reject a PENDING request with a reason |

### Admin — Players

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/admin/players/pending` | List players whose KYC is awaiting moderator review |
| `GET` | `/api/admin/players/rejected` | List players whose KYC was rejected |
| `GET` | `/api/admin/players/{id}` | Get full detail (incl. complianceData) for a single player |
| `GET` | `/api/admin/players/{id}/audit` | List audit-log events for a single player |
| `POST` | `/api/admin/players/{id}/approve` | Approve a player's KYC (transitions status to VERIFIED) |
| `POST` | `/api/admin/players/{id}/reject` | Reject a player's KYC with a required reason |
| `POST` | `/api/admin/players/{id}/resubmit` | Reopen KYC so a rejected/verified player can submit fresh documents |
| `PUT` | `/api/admin/players/{id}/kyc-status` | Admin-only override of a player's KYC status (bypasses normal moderator flow) |

### Admin — Spill 2 Config

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/admin/spill2/config` | Hent aktiv Spill 2 global config |
| `PUT` | `/api/admin/spill2/config` | Oppdater Spill 2 global config (krever GAME_CATALOG_WRITE) |

### Admin — Spill 3 Config

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/admin/spill3/config` | Hent aktiv Spill 3 global config |
| `PUT` | `/api/admin/spill3/config` | Oppdater Spill 3 global config (krever GAME_CATALOG_WRITE) |

### Admin — Users

| Metode | Path | Sammendrag |
|---|---|---|
| `PUT` | `/api/admin/users/{userId}/hall` | Assign or clear the primary hall for a user (HALL_OPERATOR scoping) |

### Agent — Auth

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/agent/auth/me` | Get own agent profile |
| `POST` | `/api/agent/auth/change-avatar` | Set avatar filename reference |
| `POST` | `/api/agent/auth/change-password` | Change own password (requires old password) |
| `POST` | `/api/agent/auth/login` | Agent login |
| `POST` | `/api/agent/auth/logout` | Logout — revoke access token |
| `POST` | `/api/agent/auth/update-language` | Set UI language (whitelisted — nb/nn/en/sv/da) |
| `PUT` | `/api/agent/auth/me` | Update own profile (self-service — displayName/email/phone only) |

### Agent — Game Plan

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/agent/game-plan/current` | Hent gjeldende plan + currentItem + jackpotSetupRequired |
| `POST` | `/api/agent/game-plan/advance` | Flytt til neste posisjon (master-only) |
| `POST` | `/api/agent/game-plan/jackpot-setup` | Submit jackpot-popup (draw + prizesCents per bongfarge) |
| `POST` | `/api/agent/game-plan/pause` | Pause aktiv plan (running → paused, master-only) |
| `POST` | `/api/agent/game-plan/resume` | Resume pauset plan (paused → running, master-only) |
| `POST` | `/api/agent/game-plan/start` | Start neste posisjon (master-only, idle → running) |

### Agent — Metronia

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/admin/metronia/daily-report` | Global daglig Metronia-rapport — totals + per-hall (ADMIN/HALL_OPERATOR/SUPPORT) |
| `GET` | `/api/admin/metronia/hall-summary/{hallId}` | Per-hall Metronia-aggregat (ADMIN/HALL_OPERATOR/SUPPORT) |
| `GET` | `/api/agent/metronia/daily-sales` | Aggregat for AGENTs current shift |
| `GET` | `/api/agent/metronia/ticket/{ticketNumber}` | Hent enkelt Metronia-ticket (AGENT begrenset til egen) |
| `POST` | `/api/agent/metronia/payout` | Close ticket via Metronia + credit player wallet med final balance |
| `POST` | `/api/agent/metronia/register-ticket` | Opprett ny Metronia-ticket — debit player wallet + Metronia API + DB-rad |
| `POST` | `/api/agent/metronia/topup` | Topup eksisterende ticket |
| `POST` | `/api/agent/metronia/void` | Void ticket innen 5 min — counter-tx, refunderer initial+topup |

### Agent — OK Bingo

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/admin/okbingo/daily-report` | Global daglig OK Bingo-rapport — totals + per-hall |
| `GET` | `/api/admin/okbingo/hall-summary/{hallId}` | Per-hall OK Bingo-aggregat (ADMIN/HALL_OPERATOR/SUPPORT) |
| `GET` | `/api/agent/okbingo/daily-sales` | Aggregat for AGENTs current shift (kun OK_BINGO-tx) |
| `GET` | `/api/agent/okbingo/ticket/{ticketNumber}` | Hent enkelt OK Bingo-ticket (AGENT begrenset til egen) |
| `POST` | `/api/agent/okbingo/open-day` | OK-Bingo-spesifikk dagsstart-signal til hardware |
| `POST` | `/api/agent/okbingo/payout` | Close ticket via SQL Server RPC + credit player wallet |
| `POST` | `/api/agent/okbingo/register-ticket` | Opprett ny OK Bingo-ticket — debit player wallet + SQL Server RPC + DB |
| `POST` | `/api/agent/okbingo/topup` | Topup eksisterende ticket |
| `POST` | `/api/agent/okbingo/void` | Void ticket innen 5 min — counter-tx, refunderer initial+topup |

### Agent — Settlement

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/admin/shifts/settlements` | Paginert liste av settlements (ADMIN/HALL_OPERATOR/SUPPORT) |
| `GET` | `/api/admin/shifts/{shiftId}/settlement` | Admin-detail av settlement for shift |
| `GET` | `/api/admin/shifts/{shiftId}/settlement.pdf` | Admin-PDF-eksport av settlement |
| `GET` | `/api/agent/shift/settlement-date` | Forventet business-date + pending-previous-day-sjekk |
| `GET` | `/api/agent/shift/{shiftId}/settlement` | Hent settlement for en shift (AGENT begrenset til egne) |
| `GET` | `/api/agent/shift/{shiftId}/settlement.pdf` | Last ned settlement-PDF |
| `POST` | `/api/agent/shift/close-day` | Fullfør oppgjør — opprett settlement, mark shift settled, transferer daily-balance til hall.cash |
| `POST` | `/api/agent/shift/control-daily-balance` | Pre-close kontrollsjekk av kontant-saldo (kan kalles flere ganger) |
| `PUT` | `/api/admin/shifts/{shiftId}/settlement` | ADMIN editer settlement (kun ADMIN — krever reason) |

### Agent — Shift

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/agent/shift/current` | Get active shift (null if none) |
| `GET` | `/api/agent/shift/history` | Paginated shift history for the caller |
| `POST` | `/api/agent/shift/end` | Close the agent's active shift |
| `POST` | `/api/agent/shift/start` | Open a new shift in the given hall |

### Agent — Transactions

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/agent/physical/inventory` | List unsold physical tickets in the agent's hall |
| `GET` | `/api/agent/players/{id}/balance` | Read a player's wallet balance (requires PLAYER_NOT_AT_HALL-check) |
| `GET` | `/api/agent/transactions` | Paginated transaction history (AGENT sees only own; admin roles see all with filters) |
| `GET` | `/api/agent/transactions/today` | List agent's transactions for current shift (shift-based, not wall-clock) |
| `GET` | `/api/agent/transactions/{id}` | Get a single transaction (AGENT only sees own transactions) |
| `POST` | `/api/agent/physical/sell` | Sell a physical ticket at the POS (marks ticket SOLD via PhysicalTicketService) |
| `POST` | `/api/agent/physical/sell/cancel` | Cancel a physical ticket sale within 10 minutes (counter-transaction, ticket status stays SOLD) |
| `POST` | `/api/agent/players/lookup` | Search players in the agent's active-shift hall (prefix-match) |
| `POST` | `/api/agent/players/{id}/cash-in` | Credit player wallet (CASH increments shift.daily_balance, CARD doesn't) |
| `POST` | `/api/agent/players/{id}/cash-out` | Debit player wallet (CASH requires sufficient shift.daily_balance) |
| `POST` | `/api/agent/tickets/register` | Register digital ticket for player (STUB — NOT_IMPLEMENTED until G2/G3 web-native) |

### Auth

| Metode | Path | Sammendrag |
|---|---|---|
| `DELETE` | `/api/auth/me` | Delete the authenticated player's account |
| `GET` | `/api/auth/2fa/status` | Få nåværende 2FA-status for innlogget bruker |
| `GET` | `/api/auth/me` | Get the authenticated user's profile |
| `GET` | `/api/auth/pin/status` | Hent PIN-status for innlogget bruker (REQ-130) |
| `GET` | `/api/auth/reset-password/{token}` | Validate a password-reset token (used by the UI before showing the new-password form) |
| `GET` | `/api/auth/sessions` | List aktive sesjoner for innlogget bruker |
| `POST` | `/api/auth/2fa/backup-codes/regenerate` | Regenerer backup-codes (krever passord). Gamle koder blir ugyldige. |
| `POST` | `/api/auth/2fa/disable` | Deaktiver 2FA — krever passord OG TOTP-kode |
| `POST` | `/api/auth/2fa/login` | Fullfør 2FA-login med challengeId + TOTP-kode (eller backup-kode) |
| `POST` | `/api/auth/2fa/setup` | Initier TOTP-setup — returner secret + otpauth-URI for QR-rendring |
| `POST` | `/api/auth/2fa/verify` | Aktiver 2FA ved å verifisere første TOTP-kode + få 10 backup-codes |
| `POST` | `/api/auth/change-password` | Change password (requires current password) |
| `POST` | `/api/auth/forgot-password` | Request password reset email (always returns success to prevent user enumeration) |
| `POST` | `/api/auth/login` | Log in with email and password |
| `POST` | `/api/auth/login-phone` | Log in with Norwegian phone number + PIN (REQ-130 / PDF 9 Frontend CR) |
| `POST` | `/api/auth/logout` | Revoke the current session token |
| `POST` | `/api/auth/pin/disable` | Deaktiver PIN — krever passord-bekreftelse (REQ-130) |
| `POST` | `/api/auth/pin/setup` | Aktiver eller oppdater 4-6-sifret PIN for innlogging (REQ-130) |
| `POST` | `/api/auth/refresh` | Issue a new token, invalidate the current one |
| `POST` | `/api/auth/register` | Register a new player account |
| `POST` | `/api/auth/reset-password/{token}` | Consume a password-reset token and set a new password |
| `POST` | `/api/auth/sessions/logout-all` | "Logg ut alle sesjoner (default: behold gjeldende)" |
| `POST` | `/api/auth/sessions/{id}/logout` | Logg ut en spesifikk sesjon (må eies av innlogget bruker) |
| `POST` | `/api/auth/verify-email/{token}` | Confirm a user's email address via the one-shot token from the sign-up email |
| `PUT` | `/api/auth/me` | Update display name, email, or phone |

### CMS — Public

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/cms/about` | Get published About Us text (public, no auth) |
| `GET` | `/api/cms/faq` | List published FAQ entries (public, no auth) |
| `GET` | `/api/cms/responsible-gaming` | Get published Responsible Gaming text (public, no auth) |
| `GET` | `/api/cms/terms` | Get published Terms & Conditions (public, no auth) |

### Game Health — Public

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/games/spill1/health` | Helsestatus for Spill 1 (bingo) — per hall (BIN-814 / R7) |
| `GET` | `/api/games/spill2/health` | Helsestatus for Spill 2 (rocket) — perpetual loop (BIN-814 / R7) |
| `GET` | `/api/games/spill3/health` | Helsestatus for Spill 3 (monsterbingo) — singleton rom (BIN-814 / R7) |

### Games

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/games` | List all enabled games |
| `GET` | `/api/games/status` | Live status per game slug — used by lobby for Open/Starting/Closed badges |
| `GET` | `/api/halls` | List active bingo halls |
| `GET` | `/api/halls/{hallId}/schedule` | Today's game schedule for a hall (§ 64 spilleplan) |
| `GET` | `/api/leaderboard` | Prize leaderboard (top 50) |
| `GET` | `/api/notifications` | List player notifications (stub — returns empty array in V1) |
| `GET` | `/api/rooms` | List active rooms (optionally filtered by hallId) |
| `GET` | `/api/rooms/{roomCode}` | Get full room snapshot |
| `POST` | `/api/games/{slug}/launch` | Launch an external game (e.g. Candy) — returns an embed URL |
| `POST` | `/api/notifications/read` | Mark notifications as read |
| `POST` | `/api/rooms/{roomCode}/game/end` | End the current game round in a room |
| `POST` | `/api/rooms/{roomCode}/game/extra-draw` | Reject an extra-draw purchase request for a player |

### KYC

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/auth/bankid/status/{sessionId}` | Poll BankID verification status |
| `GET` | `/api/kyc/me` | Get the authenticated player's KYC status |
| `POST` | `/api/auth/bankid/init` | Start a BankID verification session |
| `POST` | `/api/kyc/verify` | Submit manual KYC verification |

### Payment Requests

| Metode | Path | Sammendrag |
|---|---|---|
| `POST` | `/api/payments/deposit-request` | Create a PENDING manual cash/bank deposit request |
| `POST` | `/api/payments/withdraw-request` | Create a PENDING manual withdraw request |

### Payments

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/payments/swedbank/intents/{intentId}` | Get a payment intent by ID |
| `POST` | `/api/payments/swedbank/callback` | Swedbank Pay server-side callback (webhook — HMAC-verified) |
| `POST` | `/api/payments/swedbank/confirm` | Confirm / reconcile a Swedbank Pay intent after redirect |
| `POST` | `/api/payments/swedbank/topup-intent` | Create a Swedbank Pay top-up payment intent |

### Players

| Metode | Path | Sammendrag |
|---|---|---|
| `DELETE` | `/api/players/me` | GDPR self-service account deletion (soft-anonymize) |
| `GET` | `/api/players/me/profile` | Get the authenticated player's profile-view fields |
| `PUT` | `/api/players/me/profile` | Update the authenticated player's display name, email, or phone |

### Security

| Metode | Path | Sammendrag |
|---|---|---|
| `POST` | `/api/csp-report` | Receive CSP-violation reports from browsers (BIN-776) |

### Spillevett

| Metode | Path | Sammendrag |
|---|---|---|
| `DELETE` | `/api/wallet/me/self-exclusion` | Lift self-exclusion (only after exclusion period ends) |
| `DELETE` | `/api/wallet/me/timed-pause` | Cancel an active timed pause |
| `GET` | `/api/spillevett/report` | Get the authenticated player's gambling activity report |
| `POST` | `/api/spillevett/report/export` | Export activity report as PDF (download or email) |
| `POST` | `/api/wallet/me/self-exclusion` | Activate 1-year self-exclusion (pengespillforskriften § 23) |
| `POST` | `/api/wallet/me/timed-pause` | Activate a timed play pause |
| `PUT` | `/api/wallet/me/loss-limits` | Set daily and/or monthly loss limits for a hall |

### Status — Public

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/status` | Hent komponentstatus-snapshot for hele systemet (offentlig, no auth) |
| `GET` | `/api/status/incidents` | Hent aktive + nylige hendelser publisert av admin |
| `GET` | `/api/status/uptime` | Hent 24-timers uptime-historikk per komponent |

### Wallet

| Metode | Path | Sammendrag |
|---|---|---|
| `GET` | `/api/wallet/me` | Get authenticated player's wallet account and last 20 transactions |
| `GET` | `/api/wallet/me/compliance` | Get player compliance status (can play, limits, exclusions) |
| `GET` | `/api/wallet/me/transactions` | Get player transaction history |
| `GET` | `/api/wallets` | List all wallet accounts (admin use) |
| `GET` | `/api/wallets/{walletId}` | Get a wallet account and last 20 transactions |
| `GET` | `/api/wallets/{walletId}/transactions` | List transactions for a wallet |
| `POST` | `/api/wallet/me/topup` | Top up the authenticated player's wallet (manual or simulated) |
| `POST` | `/api/wallets` | Create a wallet account |
| `POST` | `/api/wallets/transfer` | Transfer between two wallets |
| `POST` | `/api/wallets/{walletId}/topup` | Top up a specific wallet |
| `POST` | `/api/wallets/{walletId}/withdraw` | Withdraw from a wallet |

## Statistikk

- Antall paths: **194**
- Antall endpoints (verb+path-kombinasjoner): **227**
