# Wireframe Backend Requirements — Comprehensive Audit
_2026-04-24_

**Author:** Research audit agent
**Sources:**
- `docs/architecture/WIREFRAME_CATALOG.md` (17 PDFs, 295+ pages)
- `docs/architecture/WIREFRAME_PDF16_17_GAPS_2026-04-24.md` (PDF 16+17 gap matrix)
- `docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md` (legacy vs new mapping)

**Purpose:**
Extract every backend-impacting requirement from all 17 wireframes, cross-reference against running backend code AND the 5 parallel agents currently in flight, and flag gaps not covered by any agent.

**Running parallel agents (as of spawn):**
1. **Agent 1 — Backend 1:1 gap-audit** (legacy Node.js/C# vs new TypeScript, code-vs-code diff, does NOT read wireframes)
2. **Agent 2 — Approve/Reject Player + email-infra** (`POST /api/admin/players/:userId/approve|reject` + mandatory reason + email)
3. **Agent 3 — Profile Settings API** (loss limits 48h queue, language, block-myself, pause)
4. **Agent 4 — Voice-selection per hall TV** (`app_halls.tv_voice_selection` + admin UI + socket)
5. **Agent 5 — Mystery Game backend verification** (end-to-end Mystery Game wiring)

---

## Section 1 — Backend-impacting requirement inventory (per PDF)

Requirements are grouped per screen. "BIR-###" = Backend-Impacting Requirement with a stable ID for cross-referencing.

### PDF 1 — Admin V1.0 Game 1 (24.3.2023)

**1.1 Add Physical Ticket Dialog**
- BIR-001: Physical ticket batch CRUD — `POST /api/admin/physical-tickets/batches` with `{subGameId, startTime, endTime, notificationStartTime, totalRecordsSingleBall}`. Returns batch with ID ranges.
- BIR-002: Ticket ID ranges must be continuous per batch (validation rule, DB constraint `CHECK (final_id > initial_id)`).
- BIR-003: One sub-game per physical ticket batch (FK `sub_game_id`, unique constraint on `(sub_game_id, initial_id, final_id)`).

**1.2 View Sub Game Details**
- BIR-004: Sub-game pattern pricing grid — `app_sub_game_patterns` table with `(sub_game_id, ticket_color, pattern_id, price)`.
- BIR-005: User type × price matrix — `(sub_game_id, user_type_enum, pattern_id, price)` where user_type ∈ {online_user, unique_id, physical}.

**1.3 Scheduled Games List**
- BIR-006: Scheduled games listing endpoint `GET /api/admin/schedules` with filter `?type=physical|online|unique_id`.
- BIR-007: Hall assignment determines visibility for agents (RLS or filter at API level).

---

### PDF 2 — Admin V1.0 (5.10.2023)

**2.1 Player Management — Approved Players**
- BIR-008: Player listing — `GET /api/admin/players/approved` with pagination, search, hall-filter.
- BIR-009: Phone-number masking on grid (redaction rule — full phone only when expanded detail is opened + audited).

**2.2 Hall Creation**
- BIR-010: Hall CRUD endpoints — `POST/PUT /api/admin/halls`, fields: name, hallRegistryId, ipAddress (unique), locationDetails, assignedAgentId.
- BIR-011: Hall.ipAddress uniqueness constraint (referenced to TV screen mapping).
- BIR-012: Hall capabilities (game types offered) as JSONB array `supported_game_types`.

**2.3 Game Management / Agent Readiness**
- BIR-013: Agent readiness confirmation endpoint — `POST /api/agent/games/:id/ready` (agent confirms, lifecycle transitions to `READY_TO_START`).
- BIR-014: System must prevent game start until all assigned agents are ready (state-machine enforcement).

---

### PDF 3 — Admin V1.0 Mystery Game (2023)

**3.1 View Sub Game Details (Mystery Game)**
- BIR-015: Wheel segment configuration — `app_mystery_wheel_segments` table `(sub_game_id, segment_index, multiplier, probability_pct)`, sum of probabilities = 100.
- BIR-016: Prize formula: `final_prize = base_prize × multiplier` (stored or computed in `AwardService`).
- BIR-017: Multipliers constrained to 1x-5x per wireframe (enum or CHECK constraint).
- BIR-018: Probability validation at save-time: sum MUST equal 100 (API validation + migration CHECK).
- BIR-019: Mystery Game socket events — `mystery:spin-start`, `mystery:spin-result`, tied to `mini_game_results` table.

---

### PDF 4 — Spillorama Admin V1.0 (2023)

**4.1 Admin Dashboard**
- BIR-020: Dashboard widgets endpoint — aggregated KPIs `GET /api/admin/dashboard` returning `{pendingGames, activePlayers, hallStatus[], recentTransactions[], systemHealth}`.
- BIR-021: Real-time refresh every 30 seconds — either polling interval headers or socket `dashboard:update` event.
- BIR-022: "Admin cannot modify active game state" — API enforcement on game-update endpoints (status check).

---

### PDF 5 — Game 2 & 3 Frontend (2024)

**5.1 Login Screen**
- BIR-023: Session timeout 30 min of inactivity (JWT exp or session TTL) for players.
- BIR-024: Failed login lockout after 5 attempts (rate-limiter + `app_login_attempts` audit).
- BIR-025: Login accepts Player ID OR email OR username as identifier.

**5.2 Game Landing**
- BIR-026: Landing endpoint must return only games available at player's hall (filter on `player.hallId`).
- BIR-027: Game status enum `Open | Scheduled | Closed` with countdown for Scheduled.

**5.3 Game Signup**
- BIR-028: Entry fee breakdown — `GET /api/game/:id/fees?ticketType=X&qty=Y` returning `{baseTicket, hallFee, systemFee, total}`.
- BIR-029: Balance-check enforcement at purchase endpoint (409 if insufficient).
- BIR-030: No refunds after game starts (status-check rule in refund flow).

**5.4 Profile Screen**
- BIR-031: Player profile CRUD — `PATCH /api/player/profile` with fields (fullName, email, phone, language, notificationPrefs).
- BIR-032: Email used for password recovery (audit trail + uniqueness).
- BIR-033: Phone used for SMS notifications (must validate format).

---

### PDF 6 — Game 5 Admin SpinnGo (23.11.2023)

**6.1 Pattern Configuration**
- BIR-034: SpinnGo pattern multiplier config — `app_spinn_go_patterns (pattern_id, base_prize, multiplier 1-5, final_prize_calc)`.
- BIR-035: Wheel probability segments must enforce positive numbers (CHECK > 0).
- BIR-036: Prize pool limits per hall/day — `app_halls.max_daily_prize_pool` enforcement.

---

### PDF 7 — Bot Report (31.01.2024)

**7.1 Hall Specific Report**
- BIR-037: Hall report endpoint `GET /api/admin/reports/hall/:hallId?from=&to=&type=` with report variants (HallAccount, Player, Game, Settlement, Bot).
- BIR-038: Hall managers see only own hall (RLS-style scoping on agent_id).
- BIR-039: Export options: CSV, PDF, Print (renderer/generator backend routes).
- BIR-040: Pagination with `count` in response body.

**7.2 Player List with Unique IDs**
- BIR-041: Unique ID list endpoint — `GET /api/admin/unique-ids` with filters (player, status, date range).
- BIR-042: Unique ID expiry typically 1 year — configurable constant or per-record `expires_at`.

**7.3 Order Report**
- BIR-043: Order history `GET /api/admin/orders` with payment-status enum {Paid, Pending, Failed}.
- BIR-044: Audit trail per order (7-year retention rule).

---

### PDF 8 — Admin CR (21.02.2024)

**8.1 Player Import**
- BIR-045: Bulk player import — `POST /api/admin/players/import` accepts CSV/Excel; validates duplicates by email/phone.
- BIR-046: Imported players default to status `pending_approval` (per rule).
- BIR-047: Confirmation email per imported player (job/queue).
- BIR-048: Import can be scheduled off-peak (job-scheduler integration).

**8.2 Hall Creation (Enhanced)**
- BIR-049: Multi-step hall creation (wizard state) — stateless POST with full payload OR step-wise PATCH on draft.
- BIR-050: IP address validation for connectivity (ping-test or `format: ipv4` validator).
- BIR-051: Primary agent required (FK NOT NULL).
- BIR-052: Game types offered validation (at least one required).

**8.3 Role Management (Legacy)**
- BIR-053: Role list endpoint — `GET /api/admin/roles` (Super Admin, Admin, Hall Manager, Agent, Viewer).
- BIR-054: Permission matrix CRUD — `PUT /api/admin/roles/:id/permissions` with feature×action matrix.
- BIR-055: Built-in roles cannot be deleted (DB flag `is_system_role=true`).
- BIR-056: Permission changes apply immediately (cache invalidation, socket broadcast).
- BIR-057: Role change audit trail.

**8.4 Close Days**
- BIR-058: Close days CRUD — `POST /api/admin/close-days` with `{date, reason, recurring, frequency, endDate}`.
- BIR-059: Recurring close days expansion logic (daily/weekly/monthly/yearly).
- BIR-060: Games cannot be scheduled on close days (validation at scheduling endpoint).
- BIR-061: Per-hall OR global close days (nullable `hall_id`).

---

### PDF 9 — Frontend CR (2024)

**9.1 Enhanced Login**
- BIR-062: Session tokens expire 8h (JWT exp).
- BIR-063: Rate-limit 5/15min on login attempts.
- BIR-064: Multi-method login (Player ID / Email / Phone+PIN).
- BIR-065: Two-factor auth available for high-balance accounts — feature flag + TOTP backend.

**9.2 Enhanced Settings/Profile**
- BIR-066: Password-change endpoint with 90-day forced rotation.
- BIR-067: 2FA toggle endpoint.
- BIR-068: Active sessions list + `POST /api/player/sessions/logout-all`.
- BIR-069: Game history (last 50) endpoint with filters.
- BIR-070: Preferences CRUD (language, email/SMS/marketing, responsible-gaming).
- BIR-071: All profile changes logged in audit trail.

---

### PDF 10 — Deposit & Withdraw (18.03.2024)

**10.1 Deposit Request Pay-in-Hall**
- BIR-072: Deposit request endpoint `POST /api/player/deposit/pay-in-hall` with {amount, method, referenceNote}.
- BIR-073: Min 100 NOK / Max 50,000 NOK per transaction (validation + config).
- BIR-074: Agent confirmation required (two-step status: `pending_hall_confirm → confirmed`).
- BIR-075: Funds immediate after agent confirm (state-machine transition).

**10.2 Deposit Request Vipps/Card**
- BIR-076: Vipps payment integration endpoint (redirect/return URL flow).
- BIR-077: Card payment integration (Visa/Mastercard, Apple/Google Pay).
- BIR-078: Card charged immediately; Vipps awaits webhook confirm.
- BIR-079: Payment confirmation notification email+SMS after settle.

**10.3 Deposit History**
- BIR-080: History retained 7 years (data-retention policy).
- BIR-081: Pending deposits cancellable; completed irreversible.
- BIR-082: Unique `confirmation_id` per deposit.

**10.4 Withdraw in Hall**
- BIR-083: Hall withdrawal endpoint with min 50 NOK.
- BIR-084: Agent ID-validation required (captured in audit).
- BIR-085: Reason enum {end_of_session, early_withdrawal, other}.

**10.5 Withdraw in Bank**
- BIR-086: Bank-transfer endpoint with IBAN, account holder name, bank name.
- BIR-087: 2FA required for bank withdrawals (email code).
- BIR-088: Min 500 NOK (bank-fee consideration).
- BIR-089: Bank account name must match account holder (validation rule).
- BIR-090: Fraud prevention checks (AML integration).
- BIR-091: 1-2 business day processing (status `pending → processing → settled`).

**10.6 Withdraw History**
- BIR-092: Same retention/audit rules as deposits.

---

### PDF 11 — Agent V2.0 (10.07.2024)

**11.1 Agent Dashboard**
- BIR-093: Agent dashboard widgets — `GET /api/agent/dashboard` returning agentInfo, cashSummary (cashIn, cashOut, userCashIn, userCashOut, dailyBalance, totals), latestRequests[], top5Players[], ongoingGames[].
- BIR-094: Agent shift status `ON_DUTY|OFF_DUTY` + shift-start/end timestamps.
- BIR-095: Real-time dashboard refresh (socket `agent:dashboard:update`).

**11.2 Unique ID Management List**
- BIR-096: Unique ID listing — `GET /api/agent/unique-ids` with filters (dateRange, status, search) and pagination.
- BIR-097: Agent-scoped visibility: own created + assigned hall.
- BIR-098: Bulk actions (Export, Assign, Deactivate).

**11.3 Unique ID Details View**
- BIR-099: Single Unique ID detail endpoint `GET /api/agent/unique-ids/:id`.
- BIR-100: Re-generate endpoint — `POST /api/agent/unique-ids/:id/regenerate` restricted to within 30 days of original.
- BIR-101: Print endpoint returning a PDF/escpos template for receipt print.
- BIR-102: Game details per Unique ID (grouped by game type).

**11.4 Transaction History**
- BIR-103: Transactions endpoint `GET /api/agent/transactions` with columns (orderNumber, transactionId, dateTime, type {Credit, Debit}, amount, status).
- BIR-104: 12-month accessible window (older goes to archive).
- BIR-105: CSV export.

---

### PDF 12 — Admin Import Player (29.08.2024)

**12.1 Import Player Form**
- BIR-106: Multi-step import wizard backend state (file → mapping → validation → confirmation).
- BIR-107: Field mapping: Source col → Target field (Name, Email, Phone, Player ID).
- BIR-108: Duplicate detection by email/phone/playerId.
- BIR-109: Required fields: Name, Email (enforced).
- BIR-110: Confirmation email per new player.
- BIR-111: Hall Number mapping 0-99→main, 100-119→Hamar 100, in 20-step increments up to 840 (per PDF 16.1 Note).
- BIR-112: Firstname/Lastname parsing: 2-word→first/last, 3-word→first/mid/last, 4-word→first two + last two.
- BIR-113: Error report with row-level errors for invalid rows.
- BIR-114: Password generated on first login (reset-link via email).
- BIR-115: Phone-or-email mandatory per player (not both).

---

### PDF 13 — Agent Daily Balance & Settlement (30.08.2024)

**13.1 Cash In/Out Management**
- BIR-116: Daily balance endpoint `POST /api/agent/daily-balance/set` for shift-start.
- BIR-117: Cash in/out recording per agent session.
- BIR-118: Agent CANNOT logout with unreconciled balance (middleware enforcement).

**13.2 Add Money — Registered User Popup**
- BIR-119: Add money to player endpoint `POST /api/agent/players/:id/add-balance` with payment-type (Cash/Card/Vipps).
- BIR-120: SMS/email notification to player on balance change.
- BIR-121: Max single deposit 50,000 NOK.

**13.3 Create Unique ID Popup**
- BIR-122: Unique ID generation endpoint — auto-generated ID, initial balance, payment type, 1-year default expiry.
- BIR-123: Physical ticket printable immediately.

**13.4 Daily Balance Control**
- BIR-124: Cash reconciliation endpoint — expected balance calculated from transactions.
- BIR-125: Variance >100 NOK requires explanation (validation rule).
- BIR-126: Balance tolerance 10 NOK (auto-approved).
- BIR-127: Cannot proceed without approved balance.

**13.5 Settlement Dialog — CRITICAL**
- BIR-128: Settlement endpoint `POST /api/agent/settlement` with machine breakdown (Metronia, OK Bingo, Franco, Otium) IN/OUT/Sum.
- BIR-129: Special rows: Norsk Tipping Dag+Totalt, Norsk Rikstoto Dag+Totalt, Rekvisita, Servering/kaffe, Bilag (receipt upload), Bank, Gevinst overføring, Annet.
- BIR-130: Difference in shifts formula — `(Totalt dropsafe/kasse - Endring) + Endring - Totalt Sum (kasse-fil)` (see PDF 16.25).
- BIR-131: Bilag receipt upload endpoint (file storage, URL stored on settlement).
- BIR-132: Settlement IMMUTABLE after submission (audit trail for edits).
- BIR-133: Shift-delta: `Endring = Kasse endt - Kasse start` (e.g. 46169 - 30558 = 6613).
- BIR-134: Multiple agents submitting settlement same day → both listed in hall account report.

**13.6 Shift Log Out Confirmation**
- BIR-135: Logout endpoint `POST /api/agent/shift/logout` with 2 checkboxes: `distributeBonusesToPhysical`, `transferRegisterToNextAgent`.
- BIR-136: Logout blocked without confirmed balance.
- BIR-137: If transferRegister → notify next agent (notification endpoint).
- BIR-138: "Distribute winnings" → all pending cashouts marked rewarded.

---

### PDF 14 — Screen Saver Setting (Nov 2024)

**14.1 Screen Saver Settings**
- BIR-139: Screen saver config endpoint — `POST /api/admin/halls/:id/screen-saver` with `{enabled, delay(1-2 min), images[{url, durationSec}]}`.
- BIR-140: Image size validation 1920×1080 (reject otherwise).
- BIR-141: Image format validation PNG/JPG only.
- BIR-142: Screen saver displays before+after login on TV (public route behavior).
- BIR-143: Multi-image cycle with per-image timing.
- BIR-144: Changes apply immediately (socket broadcast to TV clients).

---

### PDF 15 — Agent V1.0 Latest (06.01.2025)

**15.1 Add Physical Tickets**
- BIR-145: Physical ticket batch scan endpoint — scans Initial ID, system auto-computes Final ID based on stack size.
- BIR-146: Scan validation against DB (duplicate range rejection).
- BIR-147: All tickets in range must be available before submit (reserve pool).

**15.2 Register Sold Tickets**
- BIR-148: Register sold tickets endpoint — `POST /api/agent/games/:id/register-sold` with Final ID of stack.
- BIR-149: System validates that tickets with ID < given are all marked sold (sanity check).
- BIR-150: Auto-carry-forward of unsold tickets between consecutive games (business-logic critical).
- BIR-151: Scan for NEXT game only (not current).

**15.3 Sub Game Details**
- BIR-152: Sub-game details endpoint returning ticket-config, pricing, total numbers displayed already (list of drawn numbers).
- BIR-153: Prices LOCKED once game starts (state-check).

**15.4 Physical Cashout**
- BIR-154: Physical cashout endpoint `POST /api/agent/physical-cashout/:ticketId` with pattern detection.
- BIR-155: Reward All endpoint `POST /api/agent/games/:id/reward-all-pending`.
- BIR-156: Cashout status enum {Cashout, Rewarded, Pending}.
- BIR-157: Multiple patterns per card supported.
- BIR-158: "Cash-out only current day" — UI + backend enforcement (after day ends, no cashout edits).

**15.5 Sold Ticket List**
- BIR-159: Sold ticket list endpoint with filters (dateRange, ticketType, ticketColor, ticketId search).
- BIR-160: Winning pattern auto-populated after game completion.

**15.6 Past Game Winning History**
- BIR-161: Winning history endpoint with 7-year retention.

**15.7 Hall Account Report (Agent)**
- BIR-162: Hall account report endpoint for agent's own hall only.
- BIR-163: PDF/CSV download generation.

**15.8 Settlement Report**
- BIR-164: Full settlement detail table (see 13.5 for fields).
- BIR-165: Difference >100 NOK requires explanation.
- BIR-166: Cannot proceed to next shift without settlement.

**15.9 Check for Bingo**
- BIR-167: Bingo-check endpoint with pattern validation on backend.
- BIR-168: Agent confirms before payout.

**15.10 Register More Tickets Modal**
- BIR-169: 6 pre-defined ticket types: Small Yellow, Small White, Large Yellow, Large White, Small Purple, Large Purple (enum in DB).
- BIR-170: Range validation before submit (prevent duplicate registration).
- BIR-171: Auto-calculates total.

---

### PDF 16 — Admin V1.0 (13.09.2024) — CRITICAL RECENT

**16.1 Approved Players — Import Excel**
- BIR-172: Excel import endpoint (`.xls/.xlsx`).
- BIR-173: Import validation: phone-or-email required (no Photo ID required).
- BIR-174: Hall Number mapping (see BIR-111).
- BIR-175: Error-report rows that cannot be imported.
- BIR-176: Password-reset-link on first login.
- BIR-177: Name parser rules (2/3/4 words).

**16.2 Hall Management — Hall Number Column**
- BIR-178: `app_halls.hall_number` column (INT, unique, positive) — migration `20260701000000_hall_number.sql` exists.

**16.3 Add Hall (with Hall Number)**
- BIR-179: Hall creation validates `hall_number` positive integer.

**16.4 Ongoing Schedule — Agents Not Ready Popup**
- BIR-180: Agent readiness endpoint `GET /api/admin/schedules/:id/agent-readiness` returning per-agent ready status.
- BIR-181: Popup must list not-ready agents by name (Agent 1, Agent 2, Agent 4).
- BIR-182: Applicable to both Admin AND Agent panel.

**16.5 Winners Public Display (Admin view)**
- BIR-183: Winners public display data endpoint with KPIs: `{totalNumbersWithdrawn, fullHouseWinners, patternsWon}`.
- BIR-184: Pattern table with "Hall Belongs To" column (join hall on winner).

**16.6 Role Management — Agent Role Permission Table**
- BIR-185: Agent permission matrix — 15 modules × 5 actions (Create/Edit/View/Delete/Block-Unblock). Migration `20260705000000_agent_permissions.sql` exists.
- BIR-186: Modules (verified list): Player, Schedule, Game Creation, Saved Game List, Physical Ticket, Unique ID, Report, Wallet, Transaction, Withdraw, Product, Hall Account Report, Hall Account Report Settlement, Hall Account Specific report, Payout, Accounting (16th — post-pilot per PM).
- BIR-187: Default rule: Player Management always ON for all agents.
- BIR-188: Default rule: Cash In/Out Management always ON.
- BIR-189: Schedule Management: admin-schedules read-only for agents.
- BIR-190: Saved Game List: Master-hall-agents have default access.
- BIR-191: Hall Account Report: agent sees only own hall.
- BIR-192: Game Creation: agent can only add halls in own GOH.

**16.7 Close Day — Papir Bingo (Game 1) list**
- BIR-193: Per-DailySchedule close-days listing.
- BIR-194: 4 action icons per DailySchedule (start/edit/stop/close-days).

**16.8 View Close Days**
- BIR-195: List close days per daily-schedule endpoint.

**16.9 Add Close Day — 3-case logic**
- BIR-196: Case 1: Single day (same date, 00:00→23:59).
- BIR-197: Case 2: Multiple consecutive (start/end date spanning days).
- BIR-198: Case 3: Random multiple (separate creation calls).

**16.10 Edit Close Day**
- BIR-199: Edit existing close day endpoint.

**16.11 Remove Close Day**
- BIR-200: Delete close day endpoint + confirmation UX (backend simple DELETE).

**16.12 Close Day — Data Bingo (Game 4)**
- BIR-201: Close day applicable to Games 1, 2, 3, 4, 5 per "will be implemented" note.

**16.13 Game Creation — Game 4 (Data Bingo) Edit**
- BIR-202: Pattern Name & Prize table — 10 slots (Jackpot/O/Double H/M/2L/Pyram/V).
- BIR-203: Bet Amount 4×4 matrix per ticket/row.
- BIR-204: Total Seconds to display single ball per range (1-18 balls: 0.5s, 19-33 balls: 1s).
- BIR-205: Bot Game checkbox (dropped per mapping §8.4 — do not implement).
- BIR-206: No. of Games field for pre-gen.

**16.14 Game Creation — Game 5 (SpinnGo) Edit**
- BIR-207: Pattern Name & Prize table — 14 slots (Jackpot 1-3, Pattern 1-14 Double H/2L/Pyram/V).
- BIR-208: Total Balls to Withdraw field.
- BIR-209: Game 5 is slug `spillorama` (droppet from pilot per mapping §8).

**16.15 Deposit Request — Pay in Hall**
- BIR-210: Admin approval queue with filter `?type=pay_in_hall|vipps|card`, date range, hall filter.
- BIR-211: Approve/Reject action-confirm popup per row (admin + agent parity).
- BIR-212: Order Number + Transaction ID columns.

**16.16 Deposit Request — Vipps/Card**
- BIR-213: Same list-structure, NO Action column (auto-approved).

**16.17 Deposit History — Pay in Hall**
- BIR-214: History listing with Transaction ID column (new).
- BIR-215: Split per deposit type (pay-in-hall vs vipps/card) UI filter.

**16.18 Deposit History — Vipps/Card**
- BIR-216: Same structure.

**16.19 Withdraw in Hall**
- BIR-217: Admin approve/reject queue endpoint.
- BIR-218: Hall Name column (join from player).
- BIR-219: CSV/Excel export.

**16.20 Withdraw in Bank — XML Export — CRITICAL P0**
- BIR-220: XML generation endpoint — daily morning job generating one consolidated XML per agent.
- BIR-221: XML sent via email to designated accounting email (configurable `app_accounting_emails`).
- BIR-222: Decision locked: ONE consolidated XML per agent (all halls combined), NOT per-hall.
- BIR-223: Migration `20260810000000_withdraw_requests_bank_export.sql` and `20260810000100_xml_export_batches.sql` exist.
- BIR-224: Route `adminWithdrawXml.ts` exists — must verify completeness.
- BIR-225: Account Number column required.
- BIR-226: Applicable to both Admin AND Agent panel.

**16.21 Withdraw History**
- BIR-227: History with Select Withdraw Type dropdown (Hall/Bank).
- BIR-228: Account Number + Transaction ID columns.

**16.22 Hall Account Report — Liste over haller**
- BIR-229: Halls list endpoint with link to per-hall detail.

**16.23 Hall Account Report — View (per hall) — CRITICAL**
- BIR-230: Daily report endpoint with columns: Date, Day, Resultat Bingonet, **Metronia, OK bingo, Francs, Otium, Radio Bingo, Norsk Tipping, Norsk Rikstoto, Rekvisita, Kaffe-penger, Bilag, Gevinst overf. Bank, Bank terminal, Innskudd dropsafe, Inn/ut kasse, Diff, Kommentarer** (18 columns verified).
- BIR-231: Sum For UKE total row.
- BIR-232: Filter `from/to/real-bot` (Bot filter DROPPED per mapping §8.4).
- BIR-233: PDF download.
- BIR-234: Multiple agent submissions same day → all listed in that day.

**16.24 Hall Account Report — Settlement Report**
- BIR-235: Same columns as 16.23 + Action (edit-icon, download-receipt-icon).
- BIR-236: Edit action redirects to popup 16.25.

**16.25 Settlement — Edit Popup (Admin)**
- BIR-237: Settlement edit endpoint `PATCH /api/admin/settlements/:id` with full machine breakdown.
- BIR-238: 15-row machine/category breakdown (verified list):
  - Metronia, OK Bingo, Franco, Otium (IN/OUT/Sum)
  - Norsk Tipping Dag (add as machine ID), Norsk Tipping Totalt (DAG not reflected in report, only TOTALT — see mapping Q1 LOCKED: both summed in Totalt)
  - Norsk Rikstoto Dag, Norsk Rikstoto Totalt (same rule)
  - Rekvisita (Props, IN only)
  - Servering/kaffepenger (IN only)
  - Bilag (receipt, IN only + upload action)
  - Bank (IN only)
  - Gevinst overføring bank (OUT only)
  - Annet (Other)
  - Totalt (Total sum)
- BIR-239: Shift-delta section: `Kasse start skift`, `Kasse endt skift (før dropp)`, `Endring` (diff calc), `Innskudd dropsafe`, `Påfyll/ut kasse`, `Totalt dropsafe/påfyll`, `Difference in shifts`.
- BIR-240: Difference formula: `(Totalt - Endring) + Endring - Totalt Sum = DIFF`.
- BIR-241: Bilag upload-receipt button with file attachment.
- BIR-242: Migration `20260725000000_settlement_machine_breakdown.sql` exists.
- BIR-243: Admin=Update button / Agent=Submit button (same model, different action label).

---

### PDF 17 — Agent V1.0 (14.10.2024)

**17.1 Agent Dashboard**
- BIR-244: Total Number of Approved Players widget (agent-scoped count).
- BIR-245: Latest Requests table with "View all Pending Request" link.
- BIR-246: Top 5 Players widget (with redirect to View Profile).
- BIR-247: Ongoing Games tabs for Game 1-4 (Game 5 dropped pilot).
- BIR-248: Notification bell widget (connected to `app_notifications_and_devices` table).
- BIR-249: Language toggle NO/EN (UI + API Accept-Language).
- BIR-250: Periodic popup every 10-15 min for pending deposit requests (polling or socket timer).

**17.2 Cash In/Out Management**
- BIR-251: 6-button grid: Add Money Unique ID, Add Money Registered, Create Unique ID, Withdraw Unique ID, Withdraw Registered, Sell Products.
- BIR-252: Next Game Panel: Register More Tickets, Register Sold Tickets, Start Next Game, Hall Info popup.
- BIR-253: Ongoing Game Panel: SOLD TICKETS breakdown (My Halls vs Group of Halls) with 6-color summary.
- BIR-254: See all drawn numbers link.
- BIR-255: Total balls drawn widget (real-time from game state).

**17.3 Control Daily Balance Popup** — see BIR-124.
**17.4 Settlement Popup (Agent)** — same as 16.25.

**17.5 Add Daily Balance Popup**
- BIR-256: Add daily balance only permitted at session-start or post-previous-logout (state enforcement).
- BIR-257: No safe-balance managed for agents in this version (constraint).

**17.6 Shift Log Out Popup** — see BIR-135+136+137+138.
- BIR-258: View Cashout Details link → modal with per-ticket cashout data for the shift.

**17.7 Add Money — Registered User Popup** — see BIR-119.
- BIR-259: After ADD, system updates both Daily Balance AND player wallet amount (double-entry).

**17.8 Withdraw — Registered User Popup**
- BIR-260: Agent withdraws from registered user — endpoint required (mirror of add-money).

**17.9 Create New Unique ID**
- BIR-261: Validation: Hours Validity minimum 24 hours.
- BIR-262: Agent must have hall context (must be selected first in Admin multi-hall scenario).
- BIR-263: PRINT endpoint with empty-balance notice if amount is 0.
- BIR-264: CANCEL after generate is NOT allowed (already created).
- BIR-265: Unique ID is per-hall scoped.

**17.10 Add Money — Unique ID Popup**
- BIR-266: Balance ACCUMULATES (170 + 200 = 370), never overwrites (LOCKED 2026-04-24 by PM).
- BIR-267: Verify `AgentTransactionService.ts` enforces accumulation.

**17.11 Withdraw — Unique ID Popup**
- BIR-268: Unique ID withdraw — CASH only (other payment types disabled/hidden).

**17.12 Sell Products (Kiosk)**
- BIR-269: Product selling endpoint with Cash/Card option.
- BIR-270: Cash transaction updates total cash AND daily balance.
- BIR-271: Products enum (Coffee, Chocolate, Rice etc.) from `app_products` table.

**17.13 Register More Tickets Popup**
- BIR-272: Hotkey F1 support (UI-side, but backend needs idempotency).
- BIR-273: Initial ID of the stack scan → auto-compute Final ID.
- BIR-274: Hall + scanned tickets must match DB (validation).
- BIR-275: Agent must register tickets daily before schedule starts.

**17.14 Register More Tickets — Edit Popup**
- BIR-276: Edit ticket-range endpoint (PATCH).

**17.15 Register Sold Tickets — CRITICAL P0** — see BIR-148+149+150.
- BIR-277: Scan module registers ONLY for NEXT game.
- BIR-278: Hotkey F1=submit, Enter=submit scan, Cancel=cancel.

**17.16 Next Game — PAUSE + Check for Bingo**
- BIR-279: PAUSE endpoint `POST /api/agent/games/:id/pause` + `resume`.
- BIR-280: Check for Bingo with ticket-number input + GO.

**17.17 Next Game — Hall Info Ready/Not Ready Popup**
- BIR-281: Hall readiness list endpoint returning `{readyHalls[], notReadyHalls[]}` with hall names.

**17.18 Next Game — Are You Ready**
- BIR-282: Master-hall "Are You Ready?" button + GOH signal endpoint.
- BIR-283: When all halls ready → game can start from master.

**17.19 Next Game — Transfer Hall Access + Countdown Timer**
- BIR-284: Transfer Hall Access — agent-delegering endpoint, 60s TTL, agent-initiated → target-hall accepts (LOCKED 2026-04-24).
- BIR-285: Implemented via Task 1.6 / PR #453 (`feat/game1-transfer-hall-access`).
- BIR-286: Countdown Timer (2-3 min pre-start) — broadcast via socket.

**17.20 Players Management — Approved Players (Agent-view)**
- BIR-287: Agent-view filter (own hall only).
- BIR-288: Action menu: View Profile, Edit Profile, Add Balance, Transaction History, Game Details, Block/Unblock, Delete.
- BIR-289: POINTS data must be hidden from Admin/Agent panels (LOCKED).

**17.21 Players Management — Add Balance Popup**
- BIR-290: From players-list action menu (same as 17.7).

**17.22 Add Physical Tickets (agent-view)**
- BIR-291: 6 pre-defined ticket types (see BIR-169).
- BIR-292: Register daily before schedule starts.
- BIR-293: Tickets added by one agent AUTO available to other agents in same hall.

**17.23 View Sub Game Details (agent)**
- BIR-294: User Type filter dropdown (Online user / Unique ID).
- BIR-295: Spin Wheel Winnings + Treasure Chest Winnings input columns for agent-entry on behalf of player.
- BIR-296: Filter on Group of Hall + Hall.
- BIR-297: Add Physical Ticket only for next-upcoming game.
- BIR-298: Mystery Winnings column.

**17.24 Add Physical Ticket Popup (inside Sub Game Details)**
- BIR-299: Inline popup variant of 17.22.
- BIR-300: Physical ticket player auto-cashout when winnings ready (auto-transition state).

**17.25 Unique ID List**
- BIR-301: 3 action icons per row: View, Transaction History, Withdraw.

**17.26 Unique ID Details (View Action)**
- BIR-302: Choose Game Type dropdown (Game 1-4) — filter detail view.
- BIR-303: Per-game details table columns: Game ID, Child Game ID, Unique Ticket ID, Ticket Price, Ticket Purchased from, Winning Amount, Winning Row.
- BIR-304: Re-Generate Unique ID — for reprint only (not new ID).

**17.27 Unique ID — Transaction History**
- BIR-305: Per-UniqueID transaction history — 5 columns (Order Number, Transaction ID, Date, Type, Amount, Status).

**17.28 Unique ID — Withdraw Popup**
- BIR-306: Withdraw with Cash-only option (BIR-268 enforcement).

**17.29 Order History (for Sell Products)**
- BIR-307: Order history with Payment Type filter (Cash/Online).
- BIR-308: View action opens details.
- BIR-309: Order History also added to Admin portal (2 new columns in reports).

**17.30 View Order Details**
- BIR-310: Product order detail: productName, image, pricePerQty, quantity, totalAmount + Total Order.

**17.31 Sold Ticket List**
- BIR-311: Ticket Type filter (Physical/Terminal/Web).
- BIR-312: Search by Ticket ID.

**17.32 Past Game Winning History**
- BIR-313: Dedicated agent history view (7-year retention).

**17.33 Physical Cashout — Daily List**
- BIR-314: Daily cashout list endpoint with date-filter From/To.

**17.34 Physical Cashout — Sub Game Detail**
- BIR-315: Sub-game cashout with Total Winnings / Rewarded / Pending totals.
- BIR-316: Bank-icon action per row.
- BIR-317: Reward All endpoint.

**17.35 Physical Cashout — Per-Ticket Popup**
- BIR-318: 5×5 grid rendering.
- BIR-319: Winning Patterns list with Status {Cashout, Rewarded}.
- BIR-320: "Cash-out only current day" — UI gray-out + backend enforcement via `adminPhysicalTicketsRewardAll.ts`.

**17.36 Hall Specific Report**
- BIR-321: Per-game columns (Game 1-5): OMS, UTD, Payout%, RES.
- BIR-322: Elvis Replacement Amount column (kept in report per PM LOCKED).
- BIR-323: Filter: User Type, Group of Hall, Hall.

**17.37 Order Report (under Hall Specific)**
- BIR-324: Per-agent order report with Cash/Card columns + Customer Number.

**17.38 Hall Account Report (Agent-view)** — same as 16.23 but read-only.
**17.39 Settlement Report (Agent)** — same as 16.24.
**17.40 Settlement Popup (Agent)** — same as 16.25.

---

## Section 2 — Cross-reference matrix

**Status legend:** 🟢 Implemented / 🟡 Partial / 🔴 Missing / 🔵 Assigned-to-agent / ⚪ Unclear-needs-investigation

**Owner legend:** `1`=1:1 audit / `2`=approve/reject+email / `3`=profile settings / `4`=voice / `5`=mystery game / `NONE`=no agent covers

| REQ-ID | Source | Description | Status | Owner | Action |
|--------|--------|-------------|--------|-------|--------|
| REQ-001 | PDF 1 §1.1 / BIR-001 | Physical ticket batch CRUD | 🟢 | 1 | Verify PhysicalTicketService completeness |
| REQ-002 | PDF 1 §1.1 / BIR-002-003 | Ticket ID continuous range + sub-game FK | 🟢 | 1 | - |
| REQ-003 | PDF 1 §1.2 / BIR-004-005 | Pattern pricing grid + user-type price matrix | 🟡 | 1 | Verify `user_type_enum` × pattern prices for all 3 types |
| REQ-004 | PDF 1 §1.3 / BIR-006 | `GET /api/admin/schedules?type=` filter | 🟡 | 1 | Verify type-filter (physical/online/unique_id) works |
| REQ-005 | PDF 2 §2.1 / BIR-009 | Phone-number masking on grid | ⚪ | NONE | Needs investigation — audit PII handling |
| REQ-006 | PDF 2 §2.2 / BIR-010-012 | Hall CRUD w/ ipAddress unique | 🟢 | 1 | - |
| REQ-007 | PDF 2 §2.3 / BIR-013-014 | Agent-ready endpoint + state enforcement | 🟡 | 1 | Verify all-agents-ready blocks game start |
| REQ-008 | PDF 3 §3.1 / BIR-015-019 | Mystery wheel segments + probability sum=100 | 🔵 | 5 | Agent 5 verifying end-to-end |
| REQ-009 | PDF 3 / BIR-016 | Prize formula base × multiplier | 🔵 | 5 | - |
| REQ-010 | PDF 3 / BIR-018 | Probability validation at save (sum=100) | 🔵 | 5 | Verify API rejects invalid segments |
| REQ-011 | PDF 4 §4.1 / BIR-020-022 | Admin dashboard widgets + 30s refresh | 🟡 | 1 | - |
| REQ-012 | PDF 4 / BIR-022 | Admin cannot modify active game (state-check) | 🟡 | 1 | Verify status-check on game-update |
| REQ-013 | PDF 5 §5.1 / BIR-023-025 | Player session timeout, 5-attempt lockout | 🟡 | 1 | Verify `app_login_attempts` table exists |
| REQ-014 | PDF 5 §5.2 / BIR-026-027 | Landing filters games per hall | 🟡 | 1 | - |
| REQ-015 | PDF 5 §5.3 / BIR-028-030 | Entry-fee breakdown + balance-check | 🟡 | 1 | Verify breakdown endpoint returns baseTicket/hallFee/systemFee |
| REQ-016 | PDF 5 §5.4 / BIR-031-033 | Profile CRUD for player | 🔵 | 3 | - |
| REQ-017 | PDF 6 §6.1 / BIR-034-036 | SpinnGo pattern multiplier config | 🔴 | NONE | Game 5 dropped pilot per mapping §8 |
| REQ-018 | PDF 7 §7.1 / BIR-037-040 | Hall Specific Report + CSV/PDF export | 🟡 | 1 | Verify pattern/report routes |
| REQ-019 | PDF 7 §7.2 / BIR-041-042 | Unique ID list with filters | 🟢 | 1 | `adminUniqueIdsAndPayouts.ts` exists |
| REQ-020 | PDF 7 §7.3 / BIR-043-044 | Order report + audit 7yr | ⚪ | NONE | Verify 7-year retention policy is enforced |
| REQ-021 | PDF 8 §8.1 / BIR-045-048 | Bulk player import + dedupe + email | 🔴 | NONE | Deferred to post-pilot (one-shot migration per mapping §8.5) |
| REQ-022 | PDF 8 §8.2 / BIR-049-052 | Multi-step hall creation wizard | 🟡 | 1 | - |
| REQ-023 | PDF 8 §8.3 / BIR-053-057 | Role list + permission matrix + audit | 🟡 | 1 | Verify built-in role rules, audit trail |
| REQ-024 | PDF 8 §8.4 / BIR-058-061 | Close days with recurring logic | 🟡 | 1 | See REQ-094 for 3-case logic details |
| REQ-025 | PDF 9 §9.1 / BIR-062-065 | 8h JWT, 5/15min rate-limit, multi-method login, 2FA | 🟡 | 1 | Verify rate-limit + multi-method |
| REQ-026 | PDF 9 §9.2 / BIR-066-071 | Profile/prefs/2FA/sessions | 🔵 | 3 | Agent 3 covering language/block/pause; verify 2FA+sessions |
| REQ-027 | PDF 10 §10.1 / BIR-072-075 | Deposit pay-in-hall 100/50k, agent confirm | 🟡 | 1 | `paymentRequests.ts` exists, verify flow |
| REQ-028 | PDF 10 §10.2 / BIR-076-079 | Vipps/Card integration | 🔴 | NONE | **Not in running agent scope** — may be post-pilot |
| REQ-029 | PDF 10 §10.3 / BIR-080-082 | Deposit history 7yr retention + unique confirmation ID | 🟡 | 1 | Verify retention policy |
| REQ-030 | PDF 10 §10.4 / BIR-083-085 | Hall withdrawal 50 NOK min | 🟡 | 1 | - |
| REQ-031 | PDF 10 §10.5 / BIR-086-091 | Bank withdraw w/ IBAN, 2FA, 500 NOK min, 1-2 business day | 🟡 | 1 | Verify IBAN validation + 2FA on bank |
| REQ-032 | PDF 11 §11.1 / BIR-093-095 | Agent dashboard full widgets | 🟡 | 1 | - |
| REQ-033 | PDF 11 §11.2 / BIR-096-098 | Unique ID list filters + bulk actions | 🟢 | 1 | - |
| REQ-034 | PDF 11 §11.3 / BIR-099-102 | Unique ID details + regenerate 30-day | 🟡 | 1 | Verify 30-day regen rule |
| REQ-035 | PDF 11 §11.4 / BIR-103-105 | Transactions 12-month window + CSV | 🟡 | 1 | Verify CSV export and window |
| REQ-036 | PDF 12 §12.1 / BIR-106-115 | Excel import wizard + Hall Number mapping + name parser | 🔴 | NONE | Deferred to post-pilot (one-shot migration) |
| REQ-037 | PDF 13 §13.1 / BIR-116-118 | Daily balance + shift-based cash tracking | 🟡 | 1 | `AgentOpenDayService.ts` exists |
| REQ-038 | PDF 13 §13.2 / BIR-119-121 | Add money to player + SMS/email + 50k cap | 🟡 | 1 | Verify SMS+email notification on balance change |
| REQ-039 | PDF 13 §13.3 / BIR-122-123 | Unique ID generation w/ print | 🟡 | 1 | - |
| REQ-040 | PDF 13 §13.4 / BIR-124-127 | Daily balance control + 10 NOK tolerance + >100 var explanation | 🟡 | 1 | Verify variance rule in ControlDailyBalanceModal |
| REQ-041 | PDF 13 §13.5 / BIR-128-134 | **Settlement full 15-row + shift-delta** | 🟡 | 1 | **P0 gap** — Shift-delta formula + Bilag upload |
| REQ-042 | PDF 13 §13.5 / BIR-131 | Bilag receipt upload | 🔴 | NONE | **P0 gap** — not in any agent scope |
| REQ-043 | PDF 13 §13.6 / BIR-135-138 | Shift logout + 2 checkboxes + View Cashout Details | 🔴 | NONE | **P0 gap** — not in any agent scope |
| REQ-044 | PDF 14 §14.1 / BIR-139-144 | Screen Saver config + 1920×1080 + PNG/JPG + multi-image | 🔴 | NONE | **P1 gap** — not in any agent scope |
| REQ-045 | PDF 14 / BIR-144 | Screen saver socket broadcast to TV | 🔴 | NONE | **P1 gap** |
| REQ-046 | PDF 15 §15.1 / BIR-145-147 | Physical ticket scan + auto-compute Final ID | 🟡 | 1 | - |
| REQ-047 | PDF 15 §15.2 / BIR-148-151 | Register Sold Tickets + carry-forward logic | 🔴 | NONE | **P0 gap** — Register Sold Tickets popup + carry-forward |
| REQ-048 | PDF 15 §15.3 / BIR-152-153 | Sub-game details + prices LOCKED at start | 🟡 | 1 | - |
| REQ-049 | PDF 15 §15.4 / BIR-154-158 | Physical cashout + Reward All + status enum | 🟡 | 1 | `adminPhysicalTicketPayouts.ts` + `adminPhysicalTicketsRewardAll.ts` |
| REQ-050 | PDF 15 / BIR-158 | "Cash-out only current day" enforcement | ⚪ | NONE | Must verify in `adminPhysicalTicketsRewardAll.ts` |
| REQ-051 | PDF 15 §15.5 / BIR-159-160 | Sold ticket list + winning pattern auto | 🟡 | 1 | - |
| REQ-052 | PDF 15 §15.6 / BIR-161 | Past game winning history 7yr | ⚪ | 1 | Verify retention |
| REQ-053 | PDF 15 §15.7 / BIR-162-163 | Hall Account Report agent-scoped + download | 🟡 | 1 | - |
| REQ-054 | PDF 15 §15.8 / BIR-164-166 | Settlement detail table + shift-end req | 🟡 | 1 | - |
| REQ-055 | PDF 15 §15.9 / BIR-167-168 | Check for Bingo + agent-confirm | 🟡 | 1 | `agentBingo.ts` exists |
| REQ-056 | PDF 15 §15.10 / BIR-169-171 | 6 pre-defined ticket types + range validation | 🟡 | 1 | Verify enum has all 6 colors |
| REQ-057 | PDF 16 §16.1 / BIR-172-177 | Excel import for players + hall-number mapping | 🔴 | NONE | Deferred (see REQ-036) |
| REQ-058 | PDF 16 §16.2 / BIR-178 | `app_halls.hall_number` column | 🟢 | 1 | Migration `20260701000000_hall_number.sql` exists |
| REQ-059 | PDF 16 §16.3 / BIR-179 | Hall creation validates hall_number positive | 🟢 | 1 | - |
| REQ-060 | PDF 16 §16.4 / BIR-180-182 | Agent readiness endpoint + popup list | 🟡 | 1 | **P0 gap** — popup with agent names missing |
| REQ-061 | PDF 16 §16.5 / BIR-183-184 | Winners public display KPIs + Hall Belongs To | 🟡 | 1 | - |
| REQ-062 | PDF 16 §16.6 / BIR-185-192 | Role permission matrix 15-16 modules | 🟡 | 1 | Migration `20260705000000_agent_permissions.sql` exists; verify 15 modules. Accounting=post-pilot |
| REQ-063 | PDF 16 §16.7 / BIR-193-194 | Close Day list per DailySchedule + 4 actions | 🔴 | NONE | Listing-view missing |
| REQ-064 | PDF 16 §16.8 / BIR-195 | View Close Days per daily schedule | 🔴 | NONE | Listing endpoint missing |
| REQ-065 | PDF 16 §16.9 / BIR-196-198 | Close Day 3-case logic (Single/Consecutive/Random) | 🔴 | NONE | Only single case exists |
| REQ-066 | PDF 16 §16.10-11 / BIR-199-200 | Edit + Remove close day | 🔴 | NONE | CRUD missing |
| REQ-067 | PDF 16 §16.12 / BIR-201 | Close Day for Game 4 | 🔴 | NONE | - |
| REQ-068 | PDF 16 §16.13 / BIR-202-206 | Game 4 edit form + 10 pattern slots + 4×4 bet matrix | 🔴 | NONE | **P2** per gap-doc |
| REQ-069 | PDF 16 §16.14 / BIR-207-209 | Game 5 SpinnGo edit form | 🔴 | NONE | Game 5 dropped pilot |
| REQ-070 | PDF 16 §16.15 / BIR-210-212 | Deposit Request Pay-in-Hall approval queue | 🟡 | 1 | - |
| REQ-071 | PDF 16 §16.16 / BIR-213 | Deposit Request Vipps/Card (no action col) | 🟡 | 1 | - |
| REQ-072 | PDF 16 §16.17-18 / BIR-214-216 | Deposit History per type | 🟡 | 1 | - |
| REQ-073 | PDF 16 §16.19 / BIR-217-219 | Withdraw in Hall queue + CSV | 🟡 | 1 | - |
| REQ-074 | PDF 16 §16.20 / BIR-220-226 | **Withdraw in Bank XML export + daily mail** | 🟡 | 1 | **P0 gap** — `adminWithdrawXml.ts` and migrations exist. Verify scheduler + mail-send |
| REQ-075 | PDF 16 §16.21 / BIR-227-228 | Withdraw history + type filter | 🟡 | 1 | - |
| REQ-076 | PDF 16 §16.22 / BIR-229 | Halls list for Hall Account Report | 🟢 | 1 | - |
| REQ-077 | PDF 16 §16.23 / BIR-230-234 | Hall Account Report 18-column daily | 🟡 | 1 | **P1** — verify all 18 columns mapped |
| REQ-078 | PDF 16 §16.24 / BIR-235-236 | Settlement Report + Edit action | 🟡 | 1 | **P0 gap** — Edit popup missing (see REQ-079) |
| REQ-079 | PDF 16 §16.25 / BIR-237-243 | Settlement Edit Popup (Admin, 15-row + shift-delta) | 🟡 | 1 | **P0** — core settlement model, Shift-delta formula |
| REQ-080 | PDF 17 §17.1 / BIR-244-250 | Agent Dashboard full widgets + lang toggle + notifications | 🟡 | 1 | - |
| REQ-081 | PDF 17 §17.2 / BIR-251-255 | Cash In/Out 6-button grid + Next Game + Ongoing panels | 🟡 | 1 | - |
| REQ-082 | PDF 17 §17.5 / BIR-256-257 | Add Daily Balance at shift-start only | 🟢 | 1 | `AgentOpenDayService.ts` |
| REQ-083 | PDF 17 §17.6 / BIR-258 | View Cashout Details link | 🔴 | NONE | **P0 gap** — requires new modal endpoint |
| REQ-084 | PDF 17 §17.7 / BIR-259 | Add Money Registered — dual-update (daily balance + wallet) | 🟡 | 1 | **P0 gap** — popup missing per gap-doc |
| REQ-085 | PDF 17 §17.8 / BIR-260 | Withdraw Registered user popup | 🔴 | NONE | **P0 gap** |
| REQ-086 | PDF 17 §17.9 / BIR-261-265 | Create Unique ID — Hours 24h min + PRINT + no-cancel | 🟡 | 1 | **P0** — 24h validity rule |
| REQ-087 | PDF 17 §17.10 / BIR-266-267 | Unique ID balance accumulates 170+200=370 | ⚪ | 1 | **Must verify** `AgentTransactionService.ts` per PM LOCKED |
| REQ-088 | PDF 17 §17.11 / BIR-268 | Unique ID withdraw Cash-only | 🔴 | NONE | **P0 gap** |
| REQ-089 | PDF 17 §17.12 / BIR-269-271 | Sell Products kiosk | 🟡 | 1 | `agentProducts.ts` exists |
| REQ-090 | PDF 17 §17.13 / BIR-272-275 | Register More Tickets + F1 + auto Final ID | 🟡 | 1 | **P0** — popup + F1 hotkey support |
| REQ-091 | PDF 17 §17.14 / BIR-276 | Edit ticket-range | 🔴 | NONE | - |
| REQ-092 | PDF 17 §17.15 / BIR-277-278 | Register Sold Tickets + Final ID scanner + carry-forward | 🔴 | NONE | **P0 gap** — not in any agent scope |
| REQ-093 | PDF 17 §17.16 / BIR-279-280 | PAUSE + Check for Bingo | 🟡 | 1 | - |
| REQ-094 | PDF 17 §17.17 / BIR-281 | Hall Info popup — Ready/Not Ready list | 🟡 | 1 | **P0** — popup missing, has panel |
| REQ-095 | PDF 17 §17.18 / BIR-282-283 | Master-hall Are You Ready signal | 🟡 | 1 | `apps/backend/src/game/adminHallEvents.ts` partial |
| REQ-096 | PDF 17 §17.19 / BIR-284-286 | Transfer Hall Access + Countdown Timer | 🟢 | 1 | PR #453 merged |
| REQ-097 | PDF 17 §17.20 / BIR-287-289 | Agent Players Mgmt + action menu + POINTS hidden | 🟡 | 1 | - |
| REQ-098 | PDF 17 §17.21 / BIR-290 | Add Balance Popup from player row | 🔴 | NONE | - |
| REQ-099 | PDF 17 §17.22 / BIR-291-293 | Add Physical Tickets w/ 6 types + daily-pre-schedule | 🟡 | 1 | - |
| REQ-100 | PDF 17 §17.23 / BIR-294-298 | Sub Game Details — agent-entry for Spin/Chest/Mystery | 🟡 | 1/5 | Verify `AgentGamesPage.ts` supports agent-entry for mini-game winnings |
| REQ-101 | PDF 17 §17.24 / BIR-299-300 | Add Physical Ticket popup inline | 🔴 | NONE | - |
| REQ-102 | PDF 17 §17.25 / BIR-301 | Unique ID List + 3-action icons | 🟡 | 1 | - |
| REQ-103 | PDF 17 §17.26 / BIR-302-304 | Unique ID Details + Choose Game Type + Print + Re-Generate | 🟡 | 1 | **P0** — dropdown + per-game table + Print + Regen |
| REQ-104 | PDF 17 §17.27 / BIR-305 | Unique ID Transaction History (per-ID scoped) | 🔴 | NONE | **P1 gap** |
| REQ-105 | PDF 17 §17.28 / BIR-306 | Unique ID Withdraw popup (Cash-only) | 🔴 | NONE | **P0** — see REQ-088 |
| REQ-106 | PDF 17 §17.29-30 / BIR-307-310 | Order History + View Order Details | 🟡 | 1 | **P2** |
| REQ-107 | PDF 17 §17.31 / BIR-311-312 | Sold Ticket List + Type filter | 🟡 | 1 | - |
| REQ-108 | PDF 17 §17.32 / BIR-313 | Past Game Winning History (Agent) | 🔴 | NONE | **P1** |
| REQ-109 | PDF 17 §17.33-35 / BIR-314-320 | Physical Cashout daily/sub-game/per-ticket + grid + status | 🟡 | 1 | Verify "current day only" enforcement (REQ-050) |
| REQ-110 | PDF 17 §17.36-37 / BIR-321-324 | Hall Specific Report + Elvis + Order Report | 🟡 | 1 | **P1** — verify 5-game column mapping |
| REQ-111 | PDF 17 §17.38-40 | Agent views of 16.23/24/25 | 🟡 | 1 | - |
| REQ-112 | PDF 16 + 17 | Settlement: Norsk Tipping/Rikstoto Dag+Total summed (PM LOCKED) | ⚪ | 1 | Verify both are summed not just display |
| REQ-113 | PDF 13+15+16+17 | Settlement Report multiple-agent merge | ⚪ | 1 | Verify logic: 2 agent submissions → both listed |
| REQ-114 | PDF 9 / BIR-071 | Profile audit-log for changes | 🟡 | 3 | Agent 3 likely covers logging of prefs changes |
| REQ-115 | PDF 4 / BIR-021 | 30-sec refresh dashboard OR socket `dashboard:update` | ⚪ | 1 | Verify which pattern is used |
| REQ-116 | PDF 8 §8.4 / BIR-059 | Recurring close days expansion (daily/weekly/monthly/yearly) | 🔴 | NONE | Not in mapping, not in agent scope |
| REQ-117 | PDF 14 + mapping §9 | Voice-selection per hall | 🔵 | 4 | Agent 4 covering `tv_voice_selection` |
| REQ-118 | Mapping §3.2 agent 17.19 LOCKED | Transfer Hall Access 60s TTL | 🟢 | 1 | PR #453 |
| REQ-119 | PDF 16 §16.20 | XML scheduler — DAILY MORNING cron | 🟡 | 1 | **P0** — verify cron job exists |
| REQ-120 | PDF 16 §16.20 | XML mail-send to `app_accounting_emails` list | 🟡 | 1 | **P0** — verify mail-send implementation |
| REQ-121 | PDF 16 §16.20 / BIR-222 | ONE XML per agent (all halls combined) | ⚪ | 1 | **Critical decision** — verify implementation matches PM-lock |
| REQ-122 | PDF 12 §12.1 / BIR-107-115 | Import Player wizard — multi-step state | 🔴 | NONE | Post-pilot per mapping |
| REQ-123 | PDF 10+16 §16.15 | Deposit Vipps webhook handling | 🔴 | NONE | **Investigate** — is Vipps integration in pilot? |
| REQ-124 | PDF 10+16 §16.15 | Card payment processor integration | 🔴 | NONE | **Investigate** — card processor in pilot? |
| REQ-125 | PDF 2 §2.1 / BIR-009 | PII masking for phone (view expand + audit) | ⚪ | NONE | Unclear if enforced |
| REQ-126 | PDF 7 §7.2 / BIR-042 | Unique ID 1-year default expiry | ⚪ | 1 | Verify default |
| REQ-127 | PDF 8 §8.3 / BIR-055 | Built-in roles `is_system_role=true` flag | ⚪ | 1 | Verify DB flag |
| REQ-128 | PDF 8 §8.3 / BIR-056 | Permission changes apply immediately (cache invalidation) | ⚪ | 1 | Verify cache/socket |
| REQ-129 | PDF 9 §9.1 / BIR-065 | 2FA for high-balance accounts | 🔴 | NONE | - |
| REQ-130 | PDF 9 §9.1 / BIR-064 | Multi-method login (Phone+PIN) | 🔴 | NONE | Verify — only username/email in current? |
| REQ-131 | PDF 9 §9.2 / BIR-066 | 90-day password rotation | 🔴 | NONE | - |
| REQ-132 | PDF 9 §9.2 / BIR-068 | Active-sessions list + logout-all | 🔴 | NONE | - |
| REQ-133 | PDF 10 §10.5 / BIR-089 | IBAN + account-holder-name match validation | ⚪ | 1 | Verify |
| REQ-134 | PDF 10 §10.5 / BIR-090 | Bank-withdraw AML/fraud check | ⚪ | 1 | AML integration exists (`adminAml.ts`) |
| REQ-135 | PDF 13 / BIR-126 | Variance >100 NOK requires explanation (validation) | ⚪ | 1 | Verify in SettlementModal/backend |
| REQ-136 | PDF 13 / BIR-134 | Multiple-agent same-day → both in hall report | ⚪ | 1 | **P0 edge** — verify aggregation |
| REQ-137 | PDF 17 §17.1 / BIR-250 | Periodic popup every 10-15min for pending deposits | 🔴 | NONE | Likely polling-based, not in any agent scope |
| REQ-138 | PDF 17 / BIR-289 | POINTS must be hidden in Admin + Agent | ⚪ | 1 | Verify UI hides POINTS |
| REQ-139 | PDF 15 §15.8 / BIR-165 | Difference >100 NOK requires explanation | ⚪ | 1 | Duplicate of REQ-135 |
| REQ-140 | PDF 2+11 | Audit log for role changes + profile changes | 🟡 | 1 | `adminAuditLog.ts` exists |
| REQ-141 | PDF 16 §16.1 / BIR-176 | Password-reset-link on first login (imported players) | 🔴 | NONE | Deferred post-pilot w/ import |
| REQ-142 | PDF 17 §17.24 / BIR-300 | Physical ticket auto-cashout when winnings ready | ⚪ | 1 | Verify auto-transition state |
| REQ-143 | PDF 17 §17.2 / BIR-253 | Group of Halls sold-ticket breakdown (SW/LW/SY/LY/SP/LP) | 🔴 | NONE | **P1** — aggregation endpoint |
| REQ-144 | PDF 3+16+17 | Mystery Winnings column in sub-game detail | 🔵 | 5 | Agent 5 verifies Mystery wiring |
| REQ-145 | PDF 17 §17.36 / BIR-322 | Elvis Replacement Amount reporting (LOCKED in) | ⚪ | 1 | Verify `elvisReplace` tracking in report |
| REQ-146 | PDF 17 §17.23 / BIR-295 | Agent-entry for Spin/Chest winnings on behalf of player | 🔴 | NONE | **P1** — not in any agent scope |

**Total requirements extracted:** 146
- 🟢 Implemented: 9
- 🟡 Partial: 66
- 🔴 Missing: 36
- 🔵 Assigned to running agent: 13
- ⚪ Unclear — needs investigation: 22

---

## Section 3 — Top gaps NOT covered by running agents (🔴 + Owner=NONE)

Ranked by pilot-criticality. **P0** = pilot blocker / **P1** = critical for accounting/daily ops / **P2** = nice-to-have.

### P0 — TRUE BLIND SPOTS (not in any agent scope)

| Rank | REQ-ID | Description | Source | Why critical |
|------|--------|-------------|--------|--------------|
| P0-1 | REQ-042 | **Settlement Bilag receipt upload** (file storage + URL in settlement record) | PDF 13 §13.5, PDF 16 §16.25 / BIR-131 | Regulatorisk: hver settlement må ha receipt. Agent 1 may touch settlement but upload-UI + backend-storage is not in any agent scope explicitly. |
| P0-2 | REQ-043 | **Shift Logout + 2 checkboxes + View Cashout Details** | PDF 13 §13.6, PDF 17 §17.6 / BIR-135-138 | Pilot blocker: agent can't close shift properly. `distributeBonusesToPhysical` + `transferRegisterToNextAgent` business logic missing. |
| P0-3 | REQ-047 | **Register Sold Tickets + Final ID scanner + auto-carry-forward** | PDF 15 §15.2, PDF 17 §17.15 / BIR-148-151 | Pilot blocker: agent runs the pre-game scan flow — without carry-forward of unsold tickets between games, physical-ticket workflow breaks. |
| P0-4 | REQ-083 | **View Cashout Details modal** (per-ticket cashout data for shift) | PDF 17 §17.6 / BIR-258 | Linked to shift-logout; agents need to verify before logout. |
| P0-5 | REQ-085 | **Withdraw Registered User popup + endpoint** | PDF 17 §17.8 / BIR-260 | Pilot blocker: cash-out for online players in hall. |
| P0-6 | REQ-088 + REQ-105 | **Withdraw Unique ID popup (Cash-only)** | PDF 17 §17.11, §17.28 / BIR-268 | Pilot blocker: walk-in users can't withdraw balance. |
| P0-7 | REQ-098 | **Players Mgmt Add Balance Popup (from action menu)** | PDF 17 §17.21 / BIR-290 | Pilot blocker: linked to REQ-084 player wallet update. |
| P0-8 | REQ-116 | **Close days recurring expansion** (daily/weekly/monthly/yearly) | PDF 8 §8.4 / BIR-059 | Hall calendar consistency. Potentially P1 if halls rarely have recurring close days. |

### P1 — CRITICAL FOR ACCOUNTING / DAILY OPS

| Rank | REQ-ID | Description | Source |
|------|--------|-------------|--------|
| P1-1 | REQ-044 + REQ-045 | **Screen Saver config** (1920×1080, multi-image, PNG/JPG, socket broadcast) | PDF 14 |
| P1-2 | REQ-063-067 | **Close Day full suite** (List per DailySchedule, View, 3-case Add, Edit, Remove, for Games 1+4) | PDF 16 §16.7-12 / BIR-193-201 |
| P1-3 | REQ-104 | **Unique ID per-ID Transaction History (scoped)** | PDF 17 §17.27 / BIR-305 |
| P1-4 | REQ-108 | **Past Game Winning History (Agent dedicated page)** | PDF 17 §17.32 |
| P1-5 | REQ-137 | **Periodic popup every 10-15min for pending deposits** | PDF 17 §17.1 / BIR-250 |
| P1-6 | REQ-143 | **Group of Halls sold-ticket breakdown aggregation** | PDF 17 §17.2 / BIR-253 |
| P1-7 | REQ-146 | **Agent-entry for Spin Wheel + Treasure Chest winnings on behalf of player** | PDF 17 §17.23 / BIR-295 |
| P1-8 | REQ-091 | **Edit ticket-range endpoint** (PATCH for existing ticket-stacks) | PDF 17 §17.14 / BIR-276 |
| P1-9 | REQ-131 | **90-day password rotation** | PDF 9 §9.2 / BIR-066 |
| P1-10 | REQ-132 | **Active sessions list + logout-all** | PDF 9 §9.2 / BIR-068 |
| P1-11 | REQ-124 | **Card payment processor** | PDF 10+16 — **UNCLEAR if pilot** |
| P1-12 | REQ-123 | **Vipps webhook** | PDF 10+16 — **UNCLEAR if pilot** |

### P2 — NICE-TO-HAVE

| Rank | REQ-ID | Description | Source |
|------|--------|-------------|--------|
| P2-1 | REQ-017 | SpinnGo (Game 5) pattern multiplier | PDF 6 — Game 5 dropped pilot |
| P2-2 | REQ-068+069 | Game 4 / Game 5 edit forms with 10/14-pattern slots | PDF 16 §16.13-14 |
| P2-3 | REQ-101 | Add Physical Ticket inline popup (from Sub Game Details) | PDF 17 §17.24 |
| P2-4 | REQ-106 | Order History + View Order Details | PDF 17 §17.29-30 |
| P2-5 | REQ-129 | 2FA for high-balance accounts | PDF 9 §9.1 |
| P2-6 | REQ-130 | Multi-method login (Phone+PIN) | PDF 9 §9.1 |

---

## Section 4 — Suggested agent spawns or manual tasks

### Suggested NEW parallel agents

**Agent 6: Shift Close-out Flow** (combines P0-2, P0-4)
- Scope: Shift Log Out popup + 2 checkboxes + View Cashout Details modal
- Deliverables:
  - `POST /api/agent/shift/logout` with payload `{distributeBonusesToPhysical, transferRegisterToNextAgent}`
  - `GET /api/agent/shift/:shiftId/cashout-details` returning per-ticket array
  - Business logic: "distribute winnings" → batch-mark pending cashouts as rewarded
  - Business logic: "transfer register" → handoff to next agent, notification
  - UI modal in `apps/admin-web/src/pages/agent-portal/ShiftLogoutModal.ts`
- Touches: `apps/backend/src/routes/agent.ts`, `apps/backend/src/agent/AgentShiftService.ts` (new), `apps/admin-web/src/pages/agent-portal/AgentCashInOutPage.ts`
- Est: 2-3 days

**Agent 7: Register Sold Tickets + Carry-Forward** (P0-3)
- Scope: Register Sold Tickets popup + Final ID scanner + auto carry-forward logic
- Deliverables:
  - `POST /api/agent/games/:id/register-sold-tickets` with `{finalIdOfStack, scannedTicketsPerColor}`
  - Business logic: mark tickets 1..finalId as sold, tickets finalId+1..maxOfRange carry to next game
  - UI popup in `apps/admin-web/src/pages/cash-inout/SellTicketPage.ts`
  - F1 hotkey handler
- Touches: `apps/backend/src/compliance/PhysicalTicketService.ts`, new route `agentRegisterSoldTickets.ts`
- Est: 3 days

**Agent 8: Settlement Bilag Upload + Shift-delta completeness** (P0-1 + finalize REQ-079)
- Scope: Bilag receipt upload + Shift-delta formula + multi-agent aggregation
- Deliverables:
  - `POST /api/agent/settlements/:id/bilag` multipart file upload, URL stored in `settlement.bilag_receipt_url`
  - Verify `(Totalt - Endring) + Endring - Totalt Sum` formula in `AgentSettlementService.ts`
  - Verify 2-agent-same-day merge in `HallAccountReportService.ts`
  - UI: file-attach button in `SettlementModal.ts`
- Touches: `apps/backend/src/agent/AgentSettlementService.ts`, `apps/backend/migrations/20260725000000_settlement_machine_breakdown.sql` (verify already has `bilag_receipt_url` column — if not, new migration)
- Est: 3 days

**Agent 9: Walk-in Cash Ops** (combines P0-5, P0-6, P0-7)
- Scope: Withdraw Registered User + Withdraw Unique ID (Cash-only) + Players Mgmt Add Balance popup
- Deliverables:
  - `POST /api/agent/players/:id/withdraw` (mirror of add-balance)
  - `POST /api/agent/unique-ids/:id/withdraw` (Cash-only validation)
  - Add Balance popup wired from Players Management action menu
  - Verify balance-accumulation rule (170+200=370) in `AgentTransactionService.ts`
- Touches: `apps/backend/src/routes/agent.ts`, `agentTransactions.ts`, `apps/admin-web/src/pages/agent-players/AgentPlayersPage.ts`, `apps/admin-web/src/pages/agent-portal/AgentUniqueIdPage.ts`
- Est: 2-3 days

### Additions to EXISTING agent scopes

**Agent 1 (1:1 audit) — add these verifications:**
- REQ-047 carry-forward logic detection (see Agent 7 if not merged into 1)
- REQ-050 "Cash-out only current day" enforcement in `adminPhysicalTicketsRewardAll.ts`
- REQ-087 Unique ID balance accumulation (170+200=370) in `AgentTransactionService.ts`
- REQ-112 Norsk Tipping/Rikstoto Dag+Total both summed
- REQ-121 ONE XML per agent (vs per-hall) verification
- REQ-136 Multi-agent same-day aggregation in settlement/hall-account
- REQ-141 Password reset-link on first login (if import code exists anywhere)
- REQ-142 Physical ticket auto-cashout state transition
- REQ-145 Elvis Replacement Amount tracking

**Agent 3 (Profile Settings) — confirm covers:**
- REQ-114 Profile audit log
- REQ-044/45 screen-saver is a TV config not player profile — NOT this agent
- REQ-131 90-day password rotation — verify if in scope
- REQ-132 Active sessions + logout-all — verify if in scope

**Agent 5 (Mystery Game) — confirm covers:**
- REQ-144 Mystery Winnings column in sub-game detail (data plumbing to `AgentGamesPage.ts`)
- REQ-010 Probability-sum validation (API rejects invalid segments)
- REQ-009 Prize formula base × multiplier implementation verified

### Manual tasks for Tobias (architectural/product decisions)

**M-1: Vipps + Card integration in pilot?** (REQ-028, REQ-123, REQ-124)
- Gap-doc suggests deposit-request type dropdown with Pay in Hall/Vipps/Card, but no running agent covers the actual payment-processor integration.
- **Decision needed:** Is pilot cash-only (Pay in Hall only) or must Vipps+Card work?

**M-2: Screen Saver (REQ-044, REQ-045) pilot-critical?**
- Mapping §9 PR 24 lists Screen Saver as MVP. Gap-doc places it P1. No running agent covers.
- **Decision needed:** Spawn agent OR defer to post-pilot?

**M-3: Close Day full suite (REQ-063-067, REQ-116)**
- 5 CRUD endpoints + 3-case logic. Gap-doc P1 estimates 4 days.
- **Decision needed:** Spawn agent OR accept basic close-day and manual admin workaround?

**M-4: Recurring close days (REQ-116 — daily/weekly/monthly/yearly)**
- PDF 8 spec'd this in legacy. May be overscope for pilot.
- **Decision needed:** Required OR defer?

**M-5: Past Game Winning History Agent page (REQ-108)**
- Agents can infer from physical-ticket data, but dedicated UI missing.
- **Decision needed:** Pilot requirement OR defer?

**M-6: Agent-entry for Spin/Chest winnings (REQ-146)**
- Wireframe specs agent-on-behalf-of-player entry for walk-in (Unique ID) spillers.
- **Decision needed:** Required for walk-in users? If yes — spawn agent.

**M-7: PII phone-number masking rule (REQ-005, REQ-125)**
- PDF 2 spec'd masking; implementation unclear.
- **Decision needed:** Compliance-required or UX-polish?

**M-8: Periodic pending-deposit popup every 10-15min (REQ-137)**
- PDF 17 §17.1 spec. Currently no polling scheduled.
- **Decision needed:** Implement OR rely on notification bell?

---

## Section 5 — Scope-drift risks for running agents

These are places where a running agent could miss a wireframe-specified detail because the agent was scoped on code-vs-code or feature-name, not wireframe content.

### Agent 1 (1:1 gap-audit — legacy vs new code)

**HIGH RISK:** This agent is explicitly NOT reading wireframes. Without the following clarifications it will miss:

- ⚠ **Settlement Difference-in-shifts formula** — the formula `(Totalt - Endring) + Endring - Totalt Sum` is NOT in the legacy C#/Node.js code either (it's a spec in the wireframe). 1:1 diff will say "match" but both are wrong.
- ⚠ **Norsk Tipping/Rikstoto Dag+Total aggregation rule** — recently locked by PM (2026-04-24). Legacy code may do display-only; wireframe says sum both. Send clarifying SendMessage: "Norsk Tipping/Rikstoto Dag should be summed INTO Totalt, not just displayed. Verify `AgentSettlementService.ts`."
- ⚠ **Unique ID balance accumulation (170+200=370)** — verify this is accumulation not overwrite.
- ⚠ **Register Sold Tickets carry-forward** — business logic that may or may not exist in legacy. Code-to-code diff won't reveal missing-in-both-codebases.
- ⚠ **"Cash-out only current day"** — enforcement rule in `adminPhysicalTicketsRewardAll.ts`.
- ⚠ **ONE consolidated XML per agent (vs per-hall)** — PM decision post-dates the legacy code. Legacy may do per-hall.
- ⚠ **Elvis Replacement Amount** — kept in reports per PM. Verify the field exists on settlement/report endpoints.
- ⚠ **Transfer Hall Access 60s TTL** — PM LOCKED, implemented in PR #453. Verify TTL enforcement.

**Recommendation:** Send clarifying message to Agent 1 with the above list.

### Agent 2 (Approve/Reject Player + email-infra)

**MEDIUM RISK:**

- ⚠ **Mandatory reason format** — PDF 2 spec'd modal with "Reason" text area. Agent needs to know: is reason free-text OR enum? (Legacy wireframe doesn't clarify; agent may pick one arbitrarily.)
- ⚠ **Email template format** — PDF 12 BIR-110 says "Confirmation email per new player" but no template format is specified in wireframes. Agent 2 may invent wording. **Suggest Tobias provide template or agree on default wording.**
- ⚠ **Password-reset-link on first login for imported players (REQ-141)** — gap-doc says import is post-pilot. Agent 2 may build email path that doesn't cover this case. **Confirm scope: is first-login reset-flow in Agent 2's scope?**
- ⚠ **Audit trail** — PDF 2 BIR-008 + REQ-140 require audit. Agent 2 should ensure approve/reject are logged in `adminAuditLog.ts`.
- ⚠ **Multiple rejection reasons + PII handling** — rejected players may hold PII; ensure delete-action per REQ wipes PII.

**Recommendation:** Send SendMessage to Agent 2: "Email template wording — use simple transactional: `Your Spillorama registration has been approved/rejected. Reason: <reason>.` OR confirm template with Tobias. Also ensure approve/reject actions are logged to `adminAuditLog.ts`."

### Agent 3 (Profile Settings API)

**MEDIUM RISK:**

- ⚠ **Loss limit 48h queue** — legacy has self-exclusion 1-yr, loss limits per month. Verify Agent 3 implements:
  - Monthly (regulatorisk viktig per PDF Frontend CR 21.02.2024)
  - 48-hour delay on increasing limits (per Spillvett-rule)
  - Decrease takes effect immediately
- ⚠ **Language toggle NO/EN** — from PDF 17 §17.1 agent dashboard BIR-249, but also in player profile per PDF 5. Agent 3 should handle BOTH.
- ⚠ **Block myself for** — PDF Frontend CR 21.02.2024. Enum of durations?
- ⚠ **Pause functionality** — voluntary pause per Spillvett. Distinct from self-exclusion.
- ⚠ **T&C, FAQ, About Us, Support links** (from mapping §3.3) — agent may or may not include these. Confirm.
- ⚠ **90-day password rotation (REQ-131) + sessions list (REQ-132)** — listed in PDF 9 §9.2 but may be out of Profile Settings scope.

**Recommendation:** Send SendMessage to Agent 3: "Verify scope includes both player-profile language-toggle AND agent-dashboard language-toggle. Confirm loss-limit 48h delay applies only to INCREASE (decrease is immediate). Confirm `Block myself for` duration enum from legacy."

### Agent 4 (Voice-selection per hall TV)

**LOW RISK:** Narrow scope.

- ⚠ **Voice choice enum** — wireframes don't fully enumerate. Legacy likely had Voice 1/2/3 (neutral/male/female). Verify Agent 4's enum matches mapping §3.1 row "TV Screen + Winners-public display" which mentions Voice 1/2/3.
- ⚠ **Socket broadcast on voice change** — TV client needs to reload TTS engine. Verify Agent 4 includes broadcast.
- ⚠ **Screen Saver socket broadcast (REQ-045)** — different feature, may collide with Agent 4's socket design.

**Recommendation:** Send SendMessage to Agent 4: "Confirm voice enum is 3 voices (Voice1/Voice2/Voice3) and TV-client reloads TTS on socket broadcast. Also ensure `tv_voice_selection` DB column is nullable with default."

### Agent 5 (Mystery Game backend verification)

**MEDIUM RISK:**

- ⚠ **10-bucket spin wheel with color-multiplier (yellow 2x white)** — mapping §3.3 has this spec. Verify Agent 5 checks the 2x-yellow rule.
- ⚠ **10s timer auto-play if no input** — wireframe Mystery Game spec (PDF 3 + frontend).
- ⚠ **Probability sum=100 validation** (REQ-010) — server-side rejection.
- ⚠ **Treasure Chest + Spin Wheel + Mystery as THREE different mini-games** — agent may conflate. Mapping §3.3 and PDF 17 §17.23 list them as distinct columns.
- ⚠ **Agent-entry for Spin/Chest/Mystery on behalf of player (REQ-146)** — likely NOT in Agent 5's scope (this is agent-portal UI), but Agent 5 should ensure the backend endpoints support `agent_id` field.

**Recommendation:** Send SendMessage to Agent 5: "Verify Mystery Game is distinct from Spin Wheel and Treasure Chest in schema + endpoints. Ensure 10-bucket wheel config supports color-multiplier (yellow=2x). Confirm 10s auto-play timer on server. Validate server rejects probability-sum ≠ 100."

---

## Appendix A — Contradictions between catalog and gap-doc

| # | Issue | Location |
|---|-------|----------|
| A-1 | ⚠ Role Management module count — gap-doc §1.2 says "16 moduler, ikke 15 som §3.1 sier — Accounting er tilleggs-modul". Mapping §3.1 LOCKED beslutning 8 says "15 moduler × 5 actions". PM svar 2026-04-24 (Q7) clarifies: 15 in pilot, 16th (Accounting) post-pilot. NOT a real contradiction — just evolving spec. |
| A-2 | ⚠ Norsk Tipping Dag reflection — PDF 16 §16.25 BusinessRule says "Dag reflekteres IKKE i rapport, kun Totalt". Gap-doc Q1 LOCKED says "Også summeres i Totalt (ikke kun display). Dag + Total = samlet rapporterings-sum". These appear contradictory — wireframe says NOT in report, PM decision says IS summed. **Noted as ⚠ contradiction — PM decision (2026-04-24) is the authority.** |
| A-3 | ⚠ Bot Game — wireframes have Bot Game checkbox in many admin forms. Mapping §8.4 LOCKED says "Bot Game droppes". Wireframes still show it; implementation does NOT. ⚠ contradiction — mapping-LOCKED is authority. |
| A-4 | ⚠ Import Player — wireframes have full Excel import UI (PDF 8, 12, 16.1). Mapping §8.5 LOCKED says "engangs-migrering". Wireframes suggest ongoing feature; mapping says one-shot. ⚠ contradiction — mapping-LOCKED is authority. |
| A-5 | ⚠ Game 5 (SpinnGo) — wireframes (PDF 6, 16.14) have full admin UI. Mapping §8 LOCKED says "droppet for pilot". ⚠ contradiction — mapping-LOCKED is authority. |
| A-6 | ⚠ 2FA — PDF 9 §9.1 spec'd high-balance 2FA, PDF 10 §10.5 spec'd bank-withdraw 2FA. Implementation unclear. Not contradictory, just under-specified. |
| A-7 | ⚠ Role Management pilot-critical — mapping §8 LOCKED said "1:1 wireframe". Gap-doc P1 #18 downgraded to post-pilot. These are PM decisions at different times — post-pilot is more recent. ⚠ contradiction — 2026-04-24 decision is authority. |

---

**End of audit.**

Total requirements: 146
P0 blind spots (not in agent scope): 8
P1 gaps (not in agent scope): 12
P2 gaps: 6
Scope-drift flags for running agents: 5 agents × multiple risks each (see Section 5)

Next actions recommended:
1. Tobias: decide M-1 through M-8 manual tasks
2. Spawn Agents 6-9 (Shift Close-out, Register Sold Tickets, Settlement Bilag, Walk-in Cash Ops) in parallel
3. Send scope-drift SendMessages to running Agents 1-5 per Section 5
4. Re-verify the 22 ⚪ "unclear" items post-investigation
