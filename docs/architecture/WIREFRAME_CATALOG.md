# Spillorama Wireframe Catalog

**Version**: 2026-04-24  
**Purpose**: Complete reference documentation of all 17 legacy Spillorama bingo system wireframes  
**Scope**: Admin panel and Agent/Bingovert portal  
**Total PDFs**: 17 (295+ pages)  
**Date Range**: 2023-03 to 2025-01  

---

## Table of Contents

1. [PDF 1: Admin V1.0 - Game 1 (24.3.2023)](#pdf-1-admin-v10---game-1)
2. [PDF 2: Admin V1.0 (5.10.2023)](#pdf-2-admin-v10)
3. [PDF 3: Admin V1.0 - Mystery Game](#pdf-3-admin-v10---mystery-game)
4. [PDF 4: Spillorama Admin V1.0](#pdf-4-spillorama-admin-v10)
5. [PDF 5: Game 2 & 3 Frontend](#pdf-5-game-2--3-frontend)
6. [PDF 6: Game 5 Admin](#pdf-6-game-5-admin)
7. [PDF 7: Bot Report](#pdf-7-bot-report)
8. [PDF 8: Admin CR](#pdf-8-admin-cr)
9. [PDF 9: Frontend CR](#pdf-9-frontend-cr)
10. [PDF 10: Deposit & Withdraw](#pdf-10-deposit--withdraw)
11. [PDF 11: Agent V2.0](#pdf-11-agent-v20)
12. [PDF 12: Admin Import Player](#pdf-12-admin-import-player)
13. [PDF 13: Agent Daily Balance & Settlement](#pdf-13-agent-daily-balance--settlement)
14. [PDF 14: Screen Saver Setting](#pdf-14-screen-saver-setting)
15. [PDF 15: Agent V1.0 Latest](#pdf-15-agent-v10-latest)
16. [PDF 16: Admin V1.0 (13.09.2024)](#pdf-16-admin-v10-13092024)
17. [PDF 17: Agent V1.0 (14.10.2024)](#pdf-17-agent-v10-14102024)

---

## PDF 1: Admin V1.0 - Game 1

**Date**: 24.3.2023  
**Pages**: 90+  
**Scope**: Admin panel for Game 1 (75-ball bingo) management  

### Purpose
Initial admin interface for configuring and managing Game 1 bingo games with ticket types, patterns, and settlement workflows.

### Key Screens

#### 1.1 Add Physical Ticket Dialog
**Purpose**: Register physical paper tickets into the system with ID ranges and game association

**Layout**: Modal dialog overlay

**Fields**:
- Sub Game Name (dropdown) - selects which game to add tickets for
- Start Time (time input)
- End Time (time input)
- Notification Start Time (text input)
- Total Records to display Single Ball (numeric)

**Tables**:
- Scanned Tickets table (hidden initially, appears after submission)
  - Columns: Ticket Type, Initial ID, Final ID, Action (delete icon)
  - Contains scan results with calculated ID ranges

**Buttons**:
- Submit (primary action)
- Cancel

**Business Rules**:
- Physical tickets must have start/end time boundaries
- Ticket IDs must be continuous ranges
- One sub-game per physical ticket batch
- Scanned ticket records displayable in below table

#### 1.2 View Sub Game Details
**Purpose**: Display configured game details for verification before scheduling

**Layout**: Form display with nested tables

**Fields**:
- Sub Game Name
- Start Time / End Time (time displays)
- Notification Start Time
- Total Records to display Single Ball
- Ticket Color / Type / Price table with rows for Small Yellow, Large Yellow, etc.
- Game Name: Bud-Pattern Price table showing game-specific pricing per pattern

**Tables**:
- Pattern pricing grid showing ticket colors, row patterns (Row 1-4, Full House), and price per pattern
- User Type / Price matrix by player type and pattern

**Navigation**:
- Back button to previous screen
- Cancel button

**Business Rules**:
- All prices displayed per ticket color
- Patterns available per game type (5 patterns minimum)
- User types may have different prices

#### 1.3 Scheduled Games List
**Purpose**: Display all scheduled games for admin review and management

**Layout**: Main grid view with filter/search

**Fields**:
- Game list table with columns:
  - Game Name
  - Start Date & Time
  - End Date & Time
  - Hall Name
  - Status (Active/Inactive)
  - Type selector (dropdown: Physical Ticket, Online, Unique ID)
  - Actions (edit, delete icons)

**Pagination**: Previous/Next navigation

**Buttons**:
- Add Game button
- Schedule Game button
- Cancel Scheduled Games button

**Business Rules**:
- Games can be filtered by type
- Multiple games per day supported
- Status indicates if game is currently active
- Hall assignment determines location/agent visibility

---

## PDF 2: Admin V1.0

**Date**: 5.10.2023  
**Pages**: 50+  
**Scope**: Admin V1.0 core features - Game 1, 2, 3, 4 management

### Purpose
Comprehensive admin interface for multi-game management with player approval workflow, hall creation, and role-based access.

### Key Screens

#### 2.1 Player Management - Approved Players
**Purpose**: View and manage approved players in the system

**Layout**: Grid view with side navigation and detail panel

**Fields**:
- Side navigation: Player Management, Hall Creation, Game Management, Reports, Settings
- Main grid columns:
  - Player Name
  - Personal Info (expandable)
  - Phone Number
  - Status (Active/Inactive)
  - Action buttons (edit, delete, view details)

**Detail Panel**:
- Full player information display
- Phone contact handling options
- Approval status indicator

**Pagination**: Multiple pages with Previous/Next controls

**Business Rules**:
- Only approved players visible in this view
- Phone numbers protected/masked in grid
- Personal info hidden until expanded
- Admin can modify player status

#### 2.2 Hall Creation
**Purpose**: Register new bingo hall locations with configuration

**Layout**: Form with nested details section

**Fields**:
- Hall Name (text input)
- Hall Registry / ID (text input)
- IP Address (text input)
- Location Details (text area)
- Agent Assignment (dropdown selector)
- Status (Active/Inactive toggle)

**Sub-Section - Hall Details**:
- Hall capabilities (Game types offered)
- Opening hours
- Capacity
- Available ticket types

**Buttons**:
- Create Hall
- Cancel

**Business Rules**:
- Each hall must have unique IP address
- IP address links to TV screen display for game results
- Agent assignment determines access scope
- Hall capabilities restrict which games can be played there

#### 2.3 Game Management
**Purpose**: Configure game schedules and handle agent readiness

**Layout**: Calendar view with game list and popup dialogs

**Components**:
- Monthly calendar showing scheduled games
- Game name and time display on dates
- Agent readiness notification system

**Popup - Agent Readiness Confirmation**:
- Displays when agent needs to confirm game start
- Shows game details (name, start time, players registered)
- Agent must confirm before game begins
- System auto-marks game as started after confirmation

**Business Rules**:
- Manual schedule handling by admin
- Agent must confirm readiness before game start
- System prevents premature game start
- Games can have multiple scheduled times per day

---

## PDF 3: Admin V1.0 - Mystery Game

**Date**: 2023  
**Pages**: 100+  
**Scope**: Mystery game type admin configuration with spinning wheel mechanics

### Purpose
Admin interface for configuring and managing Mystery Game (spinning wheel bingo variant) with multiplier patterns and prize pools.

### Key Screens

#### 3.1 View Sub Game Details (Mystery Game)
**Purpose**: Configure Mystery Game sub-game with wheel mechanics

**Layout**: Form with pattern grid and wheel visualization

**Fields**:
- Sub Game Name
- Start/End Time
- Game Type selector (dropdown for different game variants)
- Pattern configuration section

**Wheel Configuration**:
- Spinning wheel preview (visual representation)
- Prize multiplier indicators
- Pattern segments (highlighted in different colors)

**Pattern Grid**:
- Columns: Pattern Name, Prize Base Amount, Winning Pattern Overlay
- Rows: Mystery Game patterns with different multiplier values
- Formula: Prize = Base × Multiplier (e.g., 100kr × 2 = 200kr)

**Buttons**:
- Save Configuration
- Test Wheel
- Cancel

**Business Rules**:
- Wheel segments must sum to 100% probability
- Multipliers can range from 1x to 5x base prize
- Each pattern has independent base prize
- Real-time wheel simulation possible

---

## PDF 4: Spillorama Admin V1.0

**Date**: 2023  
**Pages**: 80+  
**Scope**: General admin features covering multiple game types

### Purpose
Comprehensive admin dashboard with game scheduling, player management, and settlement views.

### Key Screens

#### 4.1 Admin Dashboard
**Purpose**: Central hub for admin activities and system status

**Layout**: Dashboard with multiple widget sections

**Widgets**:
1. **Pending Games** - Shows upcoming scheduled games
2. **Active Players** - Count of currently logged-in players
3. **Hall Status** - Status of all configured halls
4. **Recent Transactions** - Last N transactions for audit
5. **System Health** - Uptime and error status

**Navigation Menu**:
- Players Management
- Hall Creation
- Game Management
- Reports
- Settlement
- User Management

**Business Rules**:
- Real-time data refresh every 30 seconds
- Critical alerts highlighted
- Admin cannot modify active game state

---

## PDF 5: Game 2 & 3 Frontend

**Date**: 2024  
**Pages**: 60+  
**Scope**: Player-facing UI for Game 2 (72-ball) and Game 3 (pick-any) games

### Purpose
Frontend interfaces for player signup, game selection, and profile management for Game 2 and Game 3 variants.

### Key Screens

#### 5.1 Login Screen
**Purpose**: Player authentication

**Layout**: Centered form

**Fields**:
- Username / Player ID (text input)
- Password (password input)
- Remember Me (checkbox)

**Links**:
- Forgot Password
- Sign Up for New Account

**Buttons**:
- Login (primary)
- Cancel

**Business Rules**:
- Session timeout after 30 minutes of inactivity
- Failed login locked after 5 attempts
- Player ID can be email or username

#### 5.2 Game Landing
**Purpose**: Player dashboard showing available games and participation options

**Layout**: Dashboard with game cards

**Cards**:
- Game 2 (72-ball) - Shows next game time, entry fee, player count
- Game 3 (pick-any) - Shows current game status, rules explanation
- Mystery Game (if available) - Wheel preview

**Action Buttons**:
- Join Game 2
- Join Game 3
- View Game History
- View Account Settings

**Business Rules**:
- Only shows games available at player's hall
- Games in progress marked as "Playing Now"
- Future games show countdown timer

#### 5.3 Game Signup
**Purpose**: Player selects ticket and confirms entry fee

**Layout**: Ticket selection grid

**Components**:
- Ticket Type selector (Small Yellow, Large Yellow, etc.)
- Quantity selector
- Total cost calculation
- Entry fee breakdown

**Fee Display**:
- Base ticket price
- Hall fee
- System fee
- Total amount due

**Buttons**:
- Confirm Entry
- Cancel

**Business Rules**:
- Multiple tickets per game allowed
- Cost calculated immediately
- No refunds after game starts
- Player balance must cover entry fee

#### 5.4 Profile Screen
**Purpose**: Player account settings and personal information

**Layout**: Form with expandable sections

**Sections**:
- Personal Information (name, DOB, email)
- Contact Details (phone, address)
- Account Settings (language, notifications)
- Account Balance Display
- Transaction History (recent)

**Fields**:
- Full Name
- Email Address
- Phone Number
- Preferred Language
- Notification Preferences

**Buttons**:
- Save Changes
- Change Password
- Logout

**Business Rules**:
- Players can only edit own profile
- Email used for password recovery
- Phone used for SMS notifications

---

## PDF 6: Game 5 Admin

**Date**: 23.11.2023  
**Pages**: 40+  
**Scope**: Admin configuration for Game 5 (SpinnGo with multipliers)

### Purpose
Admin interface for configuring SpinnGo game variant with spinning multiplier mechanics and pattern-based winnings.

### Key Screens

#### 6.1 Pattern Configuration
**Purpose**: Set up pattern multipliers and prize pools for SpinnGo

**Layout**: Grid-based configuration table

**Fields**:
- Pattern Name (e.g., "Row 1", "Row 2", "Full House")
- Base Prize Amount (numeric input)
- Multiplier Selector (dropdown: 1x, 2x, 3x, 4x, 5x)
- Final Prize Calculation (read-only: Base × Multiplier)

**Wheel Visualization**:
- Spinning wheel graphic showing multiplier segments
- Color-coded by multiplier value
- Probability display for each segment

**Tables**:
- Pattern Summary table showing all configured patterns with current settings
- Historical pattern data (optional)

**Buttons**:
- Save Configuration
- Test Spin (launches wheel simulator)
- Reset to Defaults
- Cancel

**Business Rules**:
- All multipliers must be positive numbers
- Base prizes set per pattern
- Final prize can exceed base (due to multiplier)
- Prize pool limits apply per hall/day

---

## PDF 7: Bot Report

**Date**: 31.01.2024  
**Pages**: 30+  
**Scope**: Reports module for bot activity tracking, player history, and hall analytics

### Purpose
Reporting interface for admins to monitor bot players, hall performance, and game-specific statistics.

### Key Screens

#### 7.1 Hall Specific Report
**Purpose**: Generate detailed report for a specific bingo hall

**Layout**: Filter bar + results table + export

**Filters**:
- Hall Name (dropdown selector)
- Date Range (From/To date pickers)
- Game Type (checkbox filter)
- Report Type (dropdown selector)

**Report Options**:
- Hall Account Report
- Player Report
- Game Report
- Settlement Report
- Bot Activity Report

**Results Table**:
- Columns depend on report type
- Example (Hall Account Report):
  - Date
  - Revenue (gross)
  - Winnings Paid Out
  - Net Revenue
  - Player Count
  - Game Count
  - Average Player Balance

**Pagination**: Previous/Next controls showing "Showing 1 to 10 of 100 entries"

**Export Options**:
- Download as PDF
- Download as CSV
- Print Report

**Business Rules**:
- Reports only show completed games
- Pending settlements excluded
- Hall managers can only see own hall
- System admins see all halls

#### 7.2 Player List with Unique IDs
**Purpose**: Display all players and their Unique ID assignments

**Layout**: Searchable grid

**Columns**:
- Player Name
- Player ID
- Unique ID (if assigned)
- Purchase Date
- Expiry Date
- Balance Amount
- Games Played
- Total Winnings
- Status (Active/Inactive)

**Search/Filter**:
- Search by Player Name
- Filter by Status
- Filter by Date Range

**Business Rules**:
- Unique IDs track physical ticket ownership
- Purchase date shows ticket activation
- Expiry dates limit ticket validity (typically 1 year)
- Balance shown in currency (NOK)

#### 7.3 Order Report
**Purpose**: Track all ticket orders placed through system

**Layout**: Filterable data table

**Columns**:
- Order ID
- Player Name
- Order Date & Time
- Ticket Type
- Quantity
- Total Amount
- Payment Status (Paid/Pending/Failed)
- Payment Type (Cash/Card/Online)

**Filters**:
- Date Range selector
- Status filter
- Payment Type filter

**Business Rules**:
- Orders track all ticket purchases
- Can include physical and online sales
- Payment status affects order completion
- Audit trail for all transactions

---

## PDF 8: Admin CR (Change Request 21.02.2024)

**Date**: 21.02.2024  
**Pages**: 40+  
**Scope**: Updated admin features including player import, hall creation updates, role management

### Purpose
Admin Change Request updates addressing player bulk import, enhanced hall configuration, and role-based permission system.

### Key Screens

#### 8.1 Player Import
**Purpose**: Bulk import players from external data source

**Layout**: Form with file upload and preview

**Fields**:
- Import File (file upload input)
- Import Type selector (dropdown: CSV, Excel, Database)
- Field Mapping (column matching interface)

**Preview Table**:
- Shows first 10 rows of imported data
- Columns from source file with preview values
- Validation status indicators (checkmark/error)

**Buttons**:
- Choose File
- Preview Import
- Import Players
- Cancel

**Business Rules**:
- CSV/Excel format supported
- Duplicate player detection (prevent re-import)
- Players marked as "pending approval" initially
- Import can be scheduled for off-peak hours

#### 8.2 Hall Creation (Enhanced)
**Purpose**: Create and configure new bingo hall with advanced options

**Layout**: Multi-step form

**Step 1 - Basic Information**:
- Hall Name (required)
- Location / City
- Address
- Contact Email
- Contact Phone

**Step 2 - System Configuration**:
- IP Address (for TV screen)
- Server Assignment (dropdown)
- Game Types Offered (checkboxes: Game 1, 2, 3, 4, 5, Mystery)
- Opening Hours (time ranges)

**Step 3 - Agent Assignment**:
- Primary Agent (dropdown selector)
- Backup Agents (multi-select)
- Role Permissions (checkboxes)

**Step 4 - Confirmation**:
- Review all settings
- Confirm button to create

**Business Rules**:
- Hall name must be unique
- At least one game type required
- At least one primary agent required
- IP address validates for connectivity

#### 8.3 Role Management
**Purpose**: Define and assign user roles with granular permissions

**Layout**: Role list + permission matrix

**Role List**:
- Built-in roles: Super Admin, Admin, Hall Manager, Agent, Viewer
- Custom role creation option

**Permission Matrix**:
- Rows: Feature areas (Player Management, Game Management, Reports, Settlement, etc.)
- Columns: Permission types (View, Create, Edit, Delete, Export)
- Checkboxes to grant/revoke permissions

**Role Details**:
- Role Name
- Description
- Member Count
- Last Modified Date
- Actions: Edit, Delete (if custom role)

**Business Rules**:
- Built-in roles cannot be deleted
- Custom roles can be created/modified/deleted
- Permission changes apply immediately to all users with role
- Audit trail of role changes maintained

#### 8.4 Close Days
**Purpose**: Define dates when games are not scheduled (holidays, maintenance)

**Layout**: Calendar view with date picker

**Components**:
- Calendar display
- Close dates highlighted
- Add Close Day dialog

**Add Close Day Fields**:
- Date selector (date picker)
- Reason (text input)
- Recurring (checkbox)
- If recurring:
  - Frequency (dropdown: Daily, Weekly, Monthly, Yearly)
  - End Date (date picker)

**Buttons**:
- Add Close Day
- Delete Close Day
- Save Changes

**Business Rules**:
- Games cannot be scheduled on close days
- Recurring close days repeat automatically
- Can be set per hall or globally
- Admin notification when conflicting games exist

---

## PDF 9: Frontend CR (2024)

**Date**: 2024  
**Pages**: 40+  
**Scope**: Player frontend updates with enhanced authentication and account management

### Purpose
Frontend Change Request updates for improved login experience and account settings interface.

### Key Screens

#### 9.1 Enhanced Login
**Purpose**: Improved authentication with support for multiple login methods

**Layout**: Centered form with method selector

**Methods**:
- Player ID + Password
- Email + Password
- Phone Number + PIN

**Fields**:
- Username/Email/Phone (dynamic label)
- Password/PIN (dynamic label)
- Remember Me (checkbox)
- Two-Factor Authentication option (if enabled)

**Links**:
- Forgot Password (email recovery)
- Sign Up
- Help

**Business Rules**:
- Session tokens expire after 8 hours
- Two-factor auth available for high-balance accounts
- Login attempts rate-limited (5 attempts / 15 minutes)

#### 9.2 Enhanced Settings/Profile
**Purpose**: Comprehensive account management interface

**Layout**: Tabbed interface

**Tabs**:

**Tab 1 - Personal Information**:
- Full Name
- Date of Birth
- Email Address
- Phone Number
- Address
- Edit button

**Tab 2 - Account Security**:
- Password Change button
- Two-Factor Authentication toggle
- Active Sessions list (device, login time, last activity)
- Logout All Sessions button

**Tab 3 - Game History**:
- Recent games table (last 50)
- Filter by game type
- Filter by date range
- View detailed game results

**Tab 4 - Preferences**:
- Language preference
- Email notifications toggle
- SMS notifications toggle
- Marketing communications toggle
- Responsible gaming settings

**Business Rules**:
- Players can only edit own profile
- Password must be changed every 90 days
- Email notifications require confirmation
- Profile changes logged in audit trail

---

## PDF 10: Deposit & Withdraw

**Date**: 18.03.2024  
**Pages**: 19  
**Scope**: Cash management flows for player deposits and withdrawals

### Purpose
Payment handling interfaces for players to add/remove funds via multiple payment methods.

### Key Screens

#### 10.1 Deposit Request - Pay in Hall
**Purpose**: Player requests to add funds at physical hall location

**Layout**: Form dialog

**Fields**:
- Amount to Deposit (numeric input)
- Payment Method selector (dropdown: Vipps, Card, Cash)
- Reference Note (optional text field)
- Confirmation checkbox (acknowledge terms)

**Display**:
- Current Balance (read-only)
- New Balance Preview (calculated display)

**Buttons**:
- Confirm Deposit
- Cancel

**Business Rules**:
- Minimum deposit: 100 NOK
- Maximum deposit per transaction: 50,000 NOK
- Hall agent must confirm receipt
- Funds available immediately after confirmation

#### 10.2 Deposit Request - Vipps/Card
**Purpose**: Player deposits via Vipps or credit card

**Layout**: Multi-step form

**Step 1 - Amount**:
- Amount selector (common amounts: 100, 250, 500, 1000, 2500)
- Custom amount option
- Promo code field (optional)

**Step 2 - Payment Method**:
- Vipps (phone number required)
- Credit Card (Visa/Mastercard)
- Apple Pay / Google Pay

**Step 3 - Confirmation**:
- Amount display
- Fee display (if applicable)
- Total due display
- Payment processing note

**Business Rules**:
- Card payments charged immediately
- Vipps payment waits for confirmation
- Processing fee: 0% (free)
- Payment confirmation via email/SMS

#### 10.3 Deposit History
**Purpose**: Track all deposit transactions for account

**Layout**: Data table with filters

**Columns**:
- Date & Time
- Amount
- Payment Method (Cash/Card/Vipps)
- Status (Completed/Pending/Failed)
- Balance After
- Confirmation ID

**Filters**:
- Date Range picker
- Status filter
- Method filter

**Pagination**: Previous/Next controls

**Business Rules**:
- History retained for 7 years
- Pending deposits can be cancelled
- Failed deposits can be retried
- Each deposit has unique confirmation ID

#### 10.4 Withdraw in Hall
**Purpose**: Player withdraws cash at hall location

**Layout**: Request form + confirmation popup

**Fields**:
- Withdraw Amount (numeric input)
- Current Balance (display)
- Available Balance (display, excluding locked funds)
- Reason (optional dropdown: "End of session", "Early withdrawal", "Other")

**Popup Confirmation**:
- Amount to withdraw
- Time estimate (instant)
- Hall location confirmation
- Agent confirmation required

**Buttons**:
- Request Withdrawal
- Cancel

**Business Rules**:
- Minimum withdrawal: 50 NOK
- Maximum: current balance
- Hall agent must validate ID
- Funds transferred to cash immediately

#### 10.5 Withdraw in Bank
**Purpose**: Player requests bank transfer withdrawal

**Layout**: Form with verification steps

**Fields**:
- Withdrawal Amount
- Account Holder Name
- Bank Account Number (IBAN or local format)
- Bank Name (validated against entered account)

**Verification Section**:
- 2-factor authentication (email code)
- Phone confirmation (if enabled)

**Business Rules**:
- Bank transfers process within 1-2 business days
- Minimum withdrawal: 500 NOK (bank fee consideration)
- Bank account must match account holder name
- Fraud prevention checks applied

#### 10.6 Withdraw History
**Purpose**: Track withdrawal transactions

**Layout**: Data table with filters

**Columns**:
- Date & Time
- Amount
- Method (Hall/Bank)
- Status (Completed/Pending/Failed)
- Confirmation ID

**Filters**:
- Date Range
- Status filter
- Method filter

**Business Rules**:
- Pending withdrawals can be cancelled
- Completed withdrawals cannot be reversed
- All transfers require verification
- History retained for 7 years

---

## PDF 11: Agent V2.0

**Date**: 10.07.2024  
**Pages**: 30  
**Scope**: Agent portal V2.0 with cash management, game scheduling, and player requests

### Purpose
Portal for agents to manage hall operations, handle player requests, and perform cash reconciliation.

### Key Screens

#### 11.1 Agent Dashboard
**Purpose**: Agent overview of current operations

**Layout**: Dashboard with widget sections and side navigation

**Side Navigation**:
- Dashboard
- Add Physical Ticket
- Players Management
- Game Management
- Unique ID Management
- Cash In/Out
- Daily Balance & Settlement
- Order History
- Physical Cashout
- Sold Ticket
- Past Game Winning History
- Hall Specific Report

**Dashboard Widgets**:

**Widget 1 - Agent Info**:
- Agent Name
- Current Hall Assignment
- Shift Status (On Duty / Off Duty)
- Shift Start/End Times

**Widget 2 - Cash Summary**:
- Cash In/Out (amount fields)
- User Cash In
- User Cash Out
- Daily Balance (calculated)
- Total Cash In/Out totals

**Widget 3 - Latest Requests**:
- Table of recent player requests
- Name, Email, Type, Date
- Status indicator
- View All Pending Requests link

**Widget 4 - Top 5 Players**:
- Leaderboard showing top earning players
- Name, username, balance
- View All Players link

**Widget 5 - Ongoing Games**:
- Current game status for each game type
- Game name, hall name, start time
- Player count
- View all Games link

**Buttons**:
- Various action buttons throughout (Add Money, Create Unique ID, Register Tickets, etc.)

**Business Rules**:
- Agent can only see own hall's data
- Shift management controls system access
- Real-time data refresh
- Cash tracking per agent session

#### 11.2 Unique ID Management List
**Purpose**: View and manage all Unique IDs created by agent

**Layout**: Searchable data table

**Columns**:
- Unique ID
- Created by (Agent Name)
- Purchase Date and Time
- Expiry Date and Time
- Balance Amount
- Status of Unique ID (Active/Inactive)
- Actions (View, Edit, Delete, Assign)

**Filters**:
- Date Range selector (From/To)
- Status filter
- Search by Unique ID
- Search by Player Name

**Pagination**: Previous/Next with entry count

**Buttons**:
- Create New Unique ID
- Bulk Actions (Export, Assign, Deactivate)

**Business Rules**:
- Agents can view only own created Unique IDs (or assigned hall IDs)
- Purchase date and expiry date define validity window (typically 1 year)
- Active IDs can be used for games
- Inactive IDs cannot be used
- Balance tracked per Unique ID

#### 11.3 Unique ID Details View
**Purpose**: View complete information for a specific Unique ID

**Layout**: Details panel with action buttons

**Fields**:
- Unique ID (display)
- Unique ID Purchase Date (display)
- Unique ID Expiry Date (display)
- Hours Validity (e.g., "24 hours")
- Status (Active/Inactive indicator)
- Total Balance (display in currency)
- Overall Winnings (display in currency)
- Choose Game Type (dropdown for viewing specific game history)

**Game Details Table** (when game type selected):
- Game ID
- Game Date ID
- Unique Ticket ID
- Ticket Price
- Result (Paid/Lost)
- Winning Amount (if applicable)
- Winning Row (pattern information)

**Buttons**:
- Print (print ticket details)
- Re-Generate Unique ID (for reissue if lost)
- Back to List

**Business Rules**:
- View-only screen for normal agents
- Re-generate only available within 30 days of original
- Print generates physical ticket receipt
- Game history shows all games played with this Unique ID

#### 11.4 Transaction History
**Purpose**: Track all monetary transactions for audit

**Layout**: Data table with filters

**Columns**:
- Order Number
- Transaction ID
- Date and Time
- Transaction Type (Credit/Debit)
- Amount
- Status (Success/Failed)

**Filters**:
- Date Range (From/To picker)
- Transaction Type filter
- Search by ID

**Business Rules**:
- Shows all transactions for the agent's hall
- Pending transactions marked clearly
- Can access previous 12 months
- Export to CSV available

---

## PDF 12: Admin Import Player

**Date**: 29.08.2024  
**Pages**: 18  
**Scope**: Bulk player import functionality for admin

### Purpose
Admin tool for importing large batches of players from external sources with validation and conflict resolution.

### Key Screens

#### 12.1 Import Player Form
**Purpose**: Configure and execute player import

**Layout**: Multi-step wizard

**Step 1 - File Selection**:
- File upload field (accepts CSV, Excel)
- File format guide (shows required columns)
- Sample file download link

**Step 2 - Field Mapping**:
- Source column selector (left side)
- Target field selector (right side)
- Mapping pairs for each required field:
  - Player ID → External Player ID
  - Name → Full Name
  - Email → Email Address
  - Phone → Phone Number
  - etc.

**Step 3 - Validation**:
- Preview first 10 rows
- Error report (if any)
- Warning report (potential issues)
- Duplicate detection summary

**Step 4 - Confirmation**:
- Import count display
- Start date (for new player activation)
- Approval status selector (Approved/Pending)
- Estimated processing time

**Buttons**:
- Browse for File
- Map Fields
- Preview Import
- Execute Import
- Cancel

**Business Rules**:
- Duplicate detection by email/phone/player ID
- Required fields: Name, Email
- Optional fields: Phone, Address, DOB
- Import can be scheduled
- Confirmation email sent to each new player

---

## PDF 13: Agent Daily Balance & Settlement

**Date**: 30.08.2024  
**Pages**: 20  
**Scope**: Daily cash reconciliation and game settlement for agents

### Purpose
Daily balance management interface for agents to reconcile cash and settle games.

### Key Screens

#### 13.1 Cash In/Out Management
**Purpose**: Daily cash tracking and balance control

**Layout**: Main dashboard with popup dialogs

**Header Section**:
- Agent Name
- Current Date
- Shift Start/End Times
- Back button / Shift Log Out button

**Cash Summary Display**:
- Cash In/Out label (amount fields showing today's totals)
- User Cash In
- User Cash Out
- Daily Balance
- Total Cash In/Out (calculated)

**Control Daily Balance Dialog**:
- Daily Balance (numeric input field)
- Total Cash Balance (read-only display)
- Submit button
- Cancel button

**Business Rules**:
- Daily balance resets each shift
- All cash in/out must be recorded
- Balance verified before shift end
- Agent cannot logout with unreconciled balance

#### 13.2 Add Money - Registered User Popup
**Purpose**: Manually add funds to player account

**Layout**: Modal dialog

**Fields**:
- Enter Username (text input for player lookup)
- Current Balance (read-only display)
- Add Amount (numeric input)
- Select Payment Type (dropdown: Cash/Card/Vipps)

**Buttons**:
- Add Money
- Cancel

**Business Rules**:
- Player must be registered in system
- Transaction recorded immediately
- Player receives SMS/email notification
- Maximum single deposit: 50,000 NOK

#### 13.3 Create Unique ID Popup
**Purpose**: Generate new Unique ID with initial balance

**Layout**: Modal form

**Fields**:
- Unique ID (auto-generated, display only)
- Enter Balance (numeric input for initial balance)
- Select Payment Type (Cash/Card/Vipps)

**Business Rules**:
- System generates unique ID automatically
- Initial balance sets starting funds
- Unique ID valid for 1 year from creation
- Physical ticket can be printed immediately

#### 13.4 Daily Balance Control
**Purpose**: Reconcile end-of-shift cash

**Layout**: Form with line-item details

**Sections**:

**Cash Reconciliation**:
- Total Cash in Register (numeric input)
- Expected Balance (calculated from transactions)
- Difference (highlighted if non-zero)
- Variance explanation (text field if variance > 100 NOK)

**Settlement Report**:
- Date (display)
- Games played today (count)
- Total revenue (display)
- Total payouts (display)
- Net settlement (display)

**Buttons**:
- Confirm Daily Balance
- Settlement button (triggers settlement)

**Business Rules**:
- Balance must match within 10 NOK tolerance
- Variances > 100 NOK require explanation
- Cannot proceed without approved balance
- Settlement happens automatically after confirmation

#### 13.5 Settlement Dialog
**Purpose**: Final daily settlement reconciliation

**Layout**: Large popup with complex table

**Header**:
- Hall Name and Agent Name
- Date
- Settlement button

**Settlement Table Structure**:
- Rows for each game/machine:
  - Machine ID (e.g., "Metronida (Machine ID)")
  - IN (amount paid in)
  - OUT (amount paid out)
  - Sum Bill Kasseis:TH

**Subtotal Rows**:
- Individual machine totals
- Grand totals (sum all IN, sum all OUT)

**Machine Breakdown** (for each machine):
- In amount
- Out amount
- Difference calculation

**Special Rows** (if applicable):
- OK Bingo (Machine ID)
- Franco (Machine ID)
- Olsun (Machine ID)
- Norsk Tipping Dag (add as machine ID)
- Norsk Tipping Totall
- Norsk Riksslato Dag (add as machine ID)
- Norsk Rikssloto Totall
- Rakislatta (Propa)
- Serving/kaffe/prenger (Servings + coffee)
- Sdag (receipt)
- Bank (Bank)
- Gevind overflering bank (prices transferred via bank)
- Annet (Other)

**Balance Calculations**:
- Total IN (sum of all in amounts)
- Total OUT (sum of all out amounts)
- Difference in shifts (calculated field)

**Buttons**:
- Upload receipt button
- Submit button (marks settlement complete)

**Business Rules**:
- All machines must be reconciled
- IN and OUT amounts must match bank records
- Differences require explanation
- Settlement cannot be modified after submission

#### 13.6 Shift Log Out Confirmation
**Purpose**: Final logout with settlement confirmation

**Layout**: Popup dialog with options

**Content**:
- "Are you sure you want to logout?" (confirmation message)
- Checkboxes:
  - "Distribute bonuses to all physical players"
  - "Do you want to transfer the register ticket to next agent"
- View Cashout Details link (blue hyperlink)

**Buttons**:
- Yes (confirms logout)
- Cancel (stays in system)

**Business Rules**:
- Cannot logout without confirmed balance
- Paper tickets distribution optional
- Register transfer required if next agent assigned
- Confirmation sent to next agent if transferred

---

## PDF 14: Screen Saver Setting

**Date**: November 2024  
**Pages**: 2  
**Scope**: Admin configuration for display screen saver

### Purpose
Simple admin interface for configuring screen saver images and timing on hall TV screens.

### Key Screens

#### 14.1 Screen Saver Settings
**Purpose**: Configure images and display duration for hall screens

**Layout**: Single form with image upload section

**Fields**:

**Screen Saver Toggle**:
- Checkbox to enable/disable screen saver
- Label: "Screen Saver"

**Screen Saver Time Dropdown**:
- Options: 1 Minutes, 2 Minutes (default)
- Sets delay before saver activates

**Image and Time Section**:
- Label: "Image and Time (Please upload only 1920x1080 size image)"
- File input field ("Choose File" button)
- For each image row:
  - File upload field
  - Time duration dropdown (5 Seconds, 20 Seconds, 5 Seconds options)
  - Add button (plus icon)
  - Delete button (trash icon)

**Multiple Image Support**:
- User can add multiple images
- Each image has independent duration
- Images cycle during saver period

**Buttons**:
- Submit (saves settings)
- Cancel

**Notes**:
- Image file only in PNG and JPG format
- The image will change at set time if admin uploads multiple image
- Screen saver setting visible to player before and after login
- Image dimensions must be 1920x1080 (enforced)

**Business Rules**:
- Screen saver applies to all hall screens
- Timing between 1-20 seconds per image
- Enable/disable globally or per hall
- Changes apply immediately
- Images loop continuously

---

## PDF 15: Agent V1.0 Latest

**Date**: 06.01.2025  
**Pages**: 30  
**Scope**: Latest Agent portal with comprehensive game and cash management

### Purpose
Complete agent portal with game scheduling, ticket registration, physical cashout, and multi-game support.

### Key Screens

#### 15.1 Add Physical Tickets
**Purpose**: Register paper ticket stacks into system

**Layout**: Form with table results

**Fields**:
- Sub Game Name (dropdown selector)
- Start Time / End Time
- Notification Start Time
- Total Records to display Single Ball

**Input Fields**:
- Final ID of the stack (numeric input field)
- Initial ID of the stack (numeric input field)
- Scan button (initiates barcode scan)

**Scanned Tickets Table**:
- Columns: Ticket Type, Initial ID, Final ID, Action (delete icon)
- Shows successfully scanned/added tickets

**Buttons**:
- Scan
- Submit
- Cancel

**Business Rules**:
- Physical tickets must have continuous ID ranges
- Scan validates against database
- Duplicate range detection
- All tickets in range must be available before submission

#### 15.2 Register Sold Tickets
**Purpose**: Record sold ticket stacks for game

**Layout**: Modal dialog within main dashboard

**Fields**:
- Game: Wheel of Fortune (dropdown selector)
- Final ID of the stack (input field)
- Scan button

**Sold Tickets Table**:
- Columns: Ticket Type, Initial ID, Final ID, Tickets Sold, Action (delete)
- Shows registered tickets

**Business Rules**:
- Only unsold tickets in system can be registered
- Marking as sold removes from available pool
- Agent can sell bulk at once or single tickets

#### 15.3 Game Management - View Sub Game Details
**Purpose**: Display game configuration and settings

**Layout**: Form with nested tables

**Fields**:
- Sub Game Name (text display)
- Start Time / End Time (time displays)
- Notification Start Time (time display)
- Total Records to display Single Ball (numeric display)

**Ticket Configuration Table**:
- Columns: Ticket Color / Type / Price
- Rows for each ticket type (Small Yellow, Large Yellow, etc.)
- Shows price per ticket type
- Agent can view total numbers displayed already (e.g., "10, 45, 78, 25, 56, 33, 56, 45, 21, 70, 63, 57, 22, 33, 30, 44, 57, 7, 21")

**Game Name: Row/Pattern Price Table**:
- Columns: Row 1, Row 2, Row 3, Row 4, Full House (pattern names)
- Rows: Price per pattern
- Shows price variations by pattern

**User Type / Price Table**:
- Shows if different prices for different player types

**Buttons**:
- Cancel (back to previous screen)

**Business Rules**:
- All prices locked once game starts
- Cannot modify game settings mid-game
- Ticket numbers track for bingo drawing validation

#### 15.4 Physical Cashout
**Purpose**: Cashout physical/paper tickets with winning calculation

**Layout**: Detailed form with pattern visualization

**Section 1 - Ticket Selection**:
- Date selector (shows current date)
- Sub Game Name (text display)
- Physical Ticket Selection (table):
  - Columns: Date, Game Name, Sub Game Name (ID), Total Winnings, Pending Cashout, Action (eye icon to view)

**Section 2 - Pattern Visualization**:
- Bingo card display (5x5 grid for 75-ball, custom for others)
- Numbers marked (highlighted in different colors/shades)
- Winning patterns overlaid (lines, diagonals, full house)
- Pattern status indicators (Cashout/Rewarded/Pending)

**Section 3 - Winning Details**:
- Display of winning pattern results:
  - Raw 1: 100kr (Status: Cashout)
  - Raw 2: 100kr (Status: Rewarded)
  - etc.

**Buttons**:
- "Reward All" button (marks all patterns as rewarded)
- Backward/Forward navigation (for multiple tickets)

**Business Rules**:
- Winning patterns auto-detected from drawn numbers
- Agent can manually verify or mark as rewarded
- Multiple patterns possible per card
- Cashout button finalizes payout

#### 15.5 Sold Ticket List
**Purpose**: View all sold tickets with filtering and search

**Layout**: Data table with filters

**Columns**:
- Date and Time
- Ticket ID
- Ticket Type
- Ticket Color
- Ticket Price
- Winning pattern (if applicable)

**Filters**:
- Date Range picker (From/To)
- Ticket Type filter (dropdown)
- Search by Ticket ID

**Pagination**: Previous/Next controls

**Business Rules**:
- Shows only tickets sold at agent's hall
- Winning patterns auto-populated after game completion
- Search by ID for quick lookup
- Audit trail of all sales

#### 15.6 Past Game Winning History
**Purpose**: Review historical winning data for audit

**Layout**: Data table with filters

**Columns**:
- Date and Time
- Ticket ID
- Ticket Type
- Ticket Color
- Ticket Price
- Winning pattern

**Filters**:
- Date Range picker
- Search by Ticket ID

**Business Rules**:
- Historical data retained for 7 years
- Shows completed games only
- Useful for settling disputes
- Exportable for reporting

#### 15.7 Hall Account Report
**Purpose**: Hall-level financial reconciliation

**Layout**: Tabular report with date selector

**Fields**:
- Date selector (From/To range)
- Download button
- Report generation options

**Report Contents**:
- Daily breakdown table:
  - Columns: Date, Game Name, Sub Game Name (ID), Total Winnings, Pending Cashout, Action (view details)
  - Multiple rows per day if multiple games

**Hall Summary**:
- Total Revenue (day)
- Total Winnings (day)
- Net Profit (day)

**Business Rules**:
- Agent sees only own hall
- Data shows completed and settled games
- Can download as PDF or CSV
- Includes timestamp of generation

#### 15.8 Hall Account Report - Settlement Report
**Purpose**: Detailed settlement reconciliation

**Layout**: Large table with multiple sections

**Header**:
- Hall: Game of Hall
- Date: [selected date]
- Name: [hall name field]

**Settlement Detail Table**:
- Rows by machine/category:
  - Metronida (Machine ID): IN: 4810, OUT: 1748, Sum Bill Kasseis-TH: 3062
  - OK Bingo (Machine ID): IN: 3620, OUT: 1625, Sum Bill Kasseis-TH: 1995
  - Franco (Machine ID): IN: 4770, OUT: 1848, Sum Bill Kasseis-TH: 2922
  - Olsun: (blank row)
  - Norsk Tipping Dag (add as machine ID): (blank)
  - Norsk Tipping Totall: (blank)
  - Norsk Rikssloto Dag (add as machine ID): (blank)
  - Norsk Rikssloto Totall: (blank)
  - Rakislatta (Propa): IN: 25, OUT: (blank), Sum Bill Kasseis-TH: 25
  - Serving/kaffe/prenger (Servings + coffee): IN: 260, OUT: (blank), Sum Bill Kasseis-TH: 260
  - Sdag (receipt): (blank)
  - Bank (Bank): IN: 814, OUT: 814, Sum Bill Kasseis-TH: (blank)
  - Gevind overflering bank (prices transferred via bank): (blank)
  - Annet (Other): (blank)
  - Total (Total): IN: 10519, OUT: 8008, Sum Bill Kasseis-TH: 8902

**Calculation Rows**:
- Ending opptall kassie (Difference daily total):
  - Tra start til slut skill (Fra start til end of s...): 15656 | (blank) | 4613
  - Fuddeling av ending opptall kassie på dispaale (settlement):
    - Innskudd droppaskile (settlement Payful kassie (withdrawal from 1...): (blank) | (blank) | (blank)
  - Total (Total dispensable): (blank) | (blank) | 6813

**Difference Section**:
- "Difference in shifts" field (calculated)

**Notes Section**:
- Large text area for agent notes

**Buttons**:
- Upload receipt button
- Submit button (finalizes settlement)

**Business Rules**:
- All machine accounts reconciled
- Bank and other payment methods tracked separately
- Difference must be explained if > 100 NOK
- Cannot proceed to next shift without settlement

#### 15.9 Check for Bingo
**Purpose**: Verify winning patterns during game

**Layout**: Popup dialog

**Content**:
- Bingo card display (5x5 grid)
- Draw numbers listed
- Pattern highlighting
- Winner confirmation

**Button**:
- Hall Info link

**Business Rules**:
- Appears when valid pattern detected
- Agent confirms before payout
- Prevents accidental false wins

#### 15.10 Register More Tickets Modal
**Purpose**: Bulk register multiple tickets with quick edit

**Layout**: Modal form with table

**Fields**:
- Total of e.g. (input field for quantity)
- Refresh button (circular icon)

**Ticket Type Table**:
- Columns: Ticket Type, Initial ID, Final ID, Tickets Sold, Action (edit/delete)
- Shows Small Yellow: 1, 10, 10
- Shows Small White: 101, 200, 20
- Shows Large Yellow: 201, 300, 10
- Shows Large White: 301, 400, 40
- Shows Small Purple: 401, 500, 0
- Shows Large purple: 501, 600, 0

**Buttons**:
- Reset
- Submit

**Business Rules**:
- Bulk entry reduces time for large sales
- Validates ranges before submission
- Prevents duplicate registrations
- Calculates total automatically

---

## PDF 16: Admin V1.0 (13.09.2024)

**Date**: 13.09.2024  
**Pages**: 21  
**Scope**: Admin-panel konsolideringspakke: Approved Players + Import Excel, Hall Management (Hall Number-kolonne), Ongoing Schedule (Agents-not-ready-popup), Winners public-display, Role Management (15 moduler), Close Day for Game 1/4/5, Deposit Request & History (Pay in Hall + Vipps/Card), Withdraw in Hall/Bank/History, Hall Account Report + Settlement (Metronia/OK Bingo/Franco/Otium + Norsk Tipping/Rikstoto + Rekvisita/Kaffe/Bilag/Bank).  
**Source**: `docs/wireframes/WF_B_Spillorama_Admin_V1.0_13-09-2024.pdf`

### Purpose
Konsolidert Admin V1.0-leveranse som dokumenterer den helhetlige administrasjons-panel-flyten i september 2024, inkludert alle sub-tabs under Players/Hall/Game/Report-menyene, samt Role Management-matrisen som styrer agent-tilganger. Denne PDF-en er den første som viser alle Settlement/Withdraw-flyter samlet.

### Key Screens

#### 16.1 Approved Players — Import Excel
**Purpose**: Bulk-import av eksisterende spillere fra legacy-ark via Excel-opplasting  
**Layout**: Tabellvisning (Username, Email, Phone Number, Hall Name, Approved by, Available Balance (kr), Status, Action) med Import Excel-knapp øverst

**Fields**:
- Import Excel-knapp (markørt A) — åpner filvelger for .xls/.xlsx
- Filter-tabs: All / Active / Inactive (status)
- Dropdown: Hall Name
- Search by username

**Tables**:
- Kolonner: Username, Email, Phone Number, Hall Name, Approved by, Available Balance (kr), Status (Active/Inactive/Blocked), Action (kebab-menu med View/Edit/Delete)

**Business Rules** (fra notes på pdf-side 1):
- Excel-ark valideres mot skjema, støtter .xls/.xlsx
- Duplikat-Photo ID ikke krevd — systemet skal akseptere oppføringer uten Photo ID
- Enten Phone Number ELLER Email Address kreves per spiller (eller begge)
- Kun kunder merket som Customer Number + Username importeres; resten går til error-rapport
- Validering: e-post-format, duplikat-sjekk, header-row sjekk
- Feedback: bekreftelses-popup med antall importert og feil-liste
- Ved manglende Hall ID mappes spilleren inn basert på **Hall Number**-kolonnen:
  - 0-99 → main hall
  - 100-119 → Hamar 100
  - 120-139 → Hønefoss 120
  - 140-159 → Ringsaker (via 140)
  - 160-179 → (brand)
  - 180-199 → Lillehammer
  - osv. i 20-trinn opp til 840
  - Eks: `47-100-01` → hall 47 (Hamar 100), spiller-nr 01 i denne hallen
- Note: Import av phone number + export skal kun være for admin, ikke agent-panel
- Passordet genereres ved første innlogging (reset-link via mail)
- Firstname/Lastname parses: 2 ord → first/last, 3 ord → first/mid/last, 4 ord → first two + last two

**Query Notes** (fra pdf):
- "Hva gjør man hvis spilleren allerede finnes med samme hall ID som ikke bør importeres?" — Svar: Spillere settes til "Inactive Hall", agent kan flytte dem.
- "Er alle importerte spillere ansett som Online Player?" — Svar: Ja, begge kan spille både i hall og online.

#### 16.2 Hall Management (med Hall Number-kolonne)
**Purpose**: CRUD-vy over alle haller med ny **Hall Number**-kolonne (markørt B)  
**Layout**: Data-tabell med Search + "+Add Hall"-knapp

**Tables**:
- Kolonner: Hall Id, Hall Name, **Hall Number** (101, 102, ...), IP Address, Address, City, Group of Hall, Status, Action (edit/delete)

**Business Rules**:
- "Hall number vil bli lagt til i kolonnen" (notat B)
- Add Hall-knapp åpner creation-page (se 16.3)

#### 16.3 Add Hall (form)
**Purpose**: Opprett ny hall med Hall Number som nytt felt  
**Layout**: Vertikalt form-layout

**Fields**:
- Hall Name (tekst)
- **Hall Number** (numerisk, nytt felt)
- IP Address
- Address
- City
- Status (dropdown: Active/Inactive)

**Buttons**:
- Submit (grønn) / Cancel (rød)

#### 16.4 Ongoing Schedule — Agents Not Ready-popup
**Purpose**: Start-game-confirmations med agent-ready-sjekk  
**Layout**: Schedule-vy (Schedule Name, Schedule Type: Manual, Date + Sub Game Details + Scheduled Game-liste) med modal popup

**Popup content**:
- "Attention! Some agents are not yet ready to play. Are you sure you want to start the game now?"
- "**Agents not ready yet**: Agent 1, Agent 2, Agent 4"
- Buttons: Start / Cancel

**Business Rules**:
- Confirmation popup skal liste agentene som ikke er klare
- Implementeres både i Agent og Admin-panel

**Tables (bakgrunn)**:
- Sub Game-tabell: Sub Game ID, (Name), Start Time, End Time, Price, Prize, Total winning in the game, Status (Ongoing/Upcoming/Completed), Action (view/start/pause/info)
- Scheduled Game-tabell: Game ID, Start Date, Day, Start Time — End Time, Schedule Name, Schedule Type (Auto/Manual)

#### 16.5 Winners — Public Display (Admin-view)
**Purpose**: Stor-skjerm-vy for vinnere med KPI-bokser og pattern-tabell  
**Layout**: Spillorama-logo header + 3 store bokser med tall + tabell til høyre

**KPI-bokser**:
- "Total Numbers Withdrawn: 74"
- "Full House Winners: 1"
- "Patterns Won: 5"

**Tables**:
- Kolonner: Patterns (Row 1-5), Total number of players won, Winning Amount on a ticket, **Hall Belongs To** (ny kolonne: Thomas Hall / Bingo Hall)

**Business Rules**:
- Admin ser: Patterns included for completed games, Total number of players won in total, Corresponding prize amounts on a ticket
- Hall Belongs To-kolonne viser opprinnelses-hallen for vinneren

#### 16.6 Role Management — Agent Role Permission Table
**Purpose**: Fine-grained tilgangsstyring per agent per modul  
**Layout**: Form med Agent Name-dropdown + matrise

**Fields**:
- Agent Name (tekst, eks: "James")

**Matrix**:
- Rader (15 moduler): Player Management, Schedule Management, Game Creation Management, Saved Game List, Physical Ticket Management, Unique ID Management, Report Management, Wallet Management, Transaction Management, Withdraw Management, Product Management, Hall Account Report, Hall Account Report — Settlement, Hall Account Specific report, Payout Management, Accounting
- Kolonner (5 actions): Create, Edit, View, Delete, Block/Unblock

**Buttons**:
- ADD / CANCEL

**Business Rules** (fra notes):
- Default: alle agenter får Player Management-tilgang
- Schedule Management: Admin-schedules er read-only for agenter. Agenter kan lage/edite egne schedules. Agents-of-same-hall deler schedules.
- Game Creation Management: Agent kan kun legge til haller i sin egen Group of Hall
- Saved Game List: Agent ser games lagret av seg selv + admin. **Master-hall-agenter har default access.**
- Hall Account Report: Agent ser kun sin egen hall. Games laget av agenter listes for admin + egen agent + intended recipients. Agenter kan lage games for alle haller i sin logged-in Group of Hall.
- Cash In/Out Management: by default (alltid på)

#### 16.7 Close Day — Papir Bingo (Game 1) list
**Purpose**: List av Close Day-schedules per daily schedule ID  
**Layout**: Dropdown (Choose a Game: Papir bingo) + tabell med "+Create Daily Schedule"-knapp

**Tables**:
- Kolonner: Daily Schedule Id, Start Date and End Date, Time Slot, Group Of Halls (dropdown: eg "Thomas GOH"), Master Hall (eg "Bingo Hall"), Status (Active), **Action** (4 ikoner: start/edit/stop/close-days)

**Business Rules**:
- Stop-ikon (markørt A) åpner confirm-popup for close days
- Note: "Currently displayed for Game 1 only; will be implemented for All Game 1, 2, 3, 4 & 5"

#### 16.8 View Close Days (per Daily Schedule)
**Purpose**: List av lukkede dager for en gitt schedule  
**Layout**: Header (Game Name: Papir Bingo, Daily Schedule ID) + tabell + ADD-knapp

**Tables**:
- Kolonner: Close Date, Start Time, End Time, Action (edit/delete)

**Buttons**:
- ADD (åpner 16.9)

#### 16.9 Add Close Day — Date Picker Popup
**Purpose**: Legg til close day(s) med start/slutt dato+tid  
**Layout**: To kolonner (Start Date & Time / End Date & Time) hver med kalender + tidvelger

**Fields**:
- Start Date (kalender)
- Start Time (tt:mm)
- End Date (kalender)
- End Time (tt:mm)

**Buttons**:
- Save

**Business Rules**:
- Admin velger start/slutt for spill-lukking; spillere ser "Closed" for valgte dager
- **Case 1: Single Close Day** — samme dato, 00:00 → 23:59
- **Case 2: Multiple consecutive days** — Start 25/01 00:00, End 28/01 23:59 → 4 sammenhengende dager lukket
- **Case 3: Random multiple days** — legg til hver dag separat (Save for 25/01, Save for 28/01)
- "Currently displayed for Game 1 only; will be implemented for All Game 1, 2, 3, 4 & 5"

#### 16.10 Edit Close Day Popup
**Purpose**: Rediger en eksisterende lukkedag  
**Layout**: Samme som 16.9, pre-fylt med eksisterende verdier

#### 16.11 Remove Close Day Confirmation Popup
**Purpose**: Bekreft fjerning av lukkedag  
**Content**:
- Header: "Alert!!"
- Melding: "Are you sure you want to remove this closed day?"
- Buttons: Yes (grønn) / No (rød)

#### 16.12 Close Day — Data Bingo (Game 4) list
**Purpose**: Samme liste-vy som 16.7 men for Game 4 (Data Bingo)  
**Layout**: Dropdown (Choose a Game: Data Bingo) + tabell

**Tables**:
- Kolonner: Game Id, Pattern Name (dropdown: Jackpot), Pattern Price (dropdown: 12000), Action (A: edit, B: close-day)

**Business Rules**:
- Edit-knapp åpner editor-side med Start Date/Time + End Date/Time-kolonner
- Close Day-knapp går til 16.8

#### 16.13 Game Creation — Game 4 (Data Bingo) Edit Form
**Purpose**: Edit Start/End Date & Time, time-periods, patterns, bet amount  
**Layout**: Form med flere seksjoner

**Fields**:
- Start Date and Time (kalender)
- End Date and Time (kalender)
- Dag-velger (Mon/Tue/Wed/Thu/Fri/Sat/Sun)
- Time Period per dag: Start Time + End Time (eks: 18:12)

**Pattern Name & It's Prize table (10 slots)**:
- Jackpot 120, O 20, Jackpot 100
- Double H 8, M 30, Jackpot 500
- 2L 200, Jackpot 20, Jackpot 100
- Pyram 20, Jackpot 4, Jackpot 10
- V 40, Jackpot 15, Jackpot 40

**Bet Amount**:
- 4 tickets × 4 rows med bet-beløp-input (1-4)

**Fields**:
- Total Seconds to display single ball (1-18 balls: 0.5s, 19-33 balls: 1s)
- Bot Game (checkbox)
- No. of Games (numerisk)

**Buttons**:
- Save / Cancel

**Business Rules**:
- Game 4 er single player → ingen ny schedule ID genereres ved edit; timings overrides kun
- Note: "Close day functionality will be implemented for All Game 1, 2, 3, 4 & 5"

#### 16.14 Game Creation — Game 5 (SpinnGo) Edit Form
**Purpose**: Tilsvarende 16.13 men for Game 5 (SpinnGo)  
**Layout**: Schedule-tabell (Game Id, Pattern Name dropdown: Jackpot 1, Pattern Price dropdown: 200) med edit/close-action

**Form fields** (ved edit):
- Start Date and Time / End Date and Time
- Dag-velger (Mon-Sun)
- Time Period per dag
- Pattern Name & It's Prize (14 slots: Jackpot 1-3, Pattern 1-14 — Double H, 2L, Pyram, V)
- Total Seconds to display single ball
- Total Balls to Withdraw
- Bot Game checkbox
- No. of Games

**Buttons**:
- Save / Cancel

#### 16.15 Deposit Request — Pay in Hall
**Purpose**: Admin approval-queue for deposit-requests av typen "Pay in Hall"  
**Layout**: Filter-bar (Start/End Date, Search, Select Type dropdown Pay in Hall/Vipps/Card) + CSV/Excel-export + Refresh Table + tabell

**Tables**:
- Kolonner: Order Number, Username, Date & Time, Hall Name, Deposit Amount, Status (Pending/Approved), Action (check/x)

**Business Rules**:
- For action: admin får confirmation-popup ved approve/reject
- Note: "This same process will be applicable for Agent users as well"

#### 16.16 Deposit Request — Vipps/Card
**Purpose**: Samme som 16.15 men for Vipps/Card-deposits  
**Tables**:
- Kolonner: Order Number, Username, Date & Time, Hall Name, Deposit Amount, Status
- Ingen Action-kolonne (Vipps/Card er auto-approved)

#### 16.17 Deposit History — Pay in Hall
**Purpose**: Historikk-liste over Pay in Hall-deposits (alle statuser)  
**Tables**:
- Kolonner: Order Number, **Transaction ID** (nytt), Username, Date & Time, Hall Name, Deposit Amount, Status

#### 16.18 Deposit History — Vipps/Card
**Purpose**: Samme som 16.17 men for Vipps/Card  
**Tables**:
- Kolonner: Order Number, Transaction ID, Username, Date & Time, Hall Name, Deposit Amount, Status

#### 16.19 Withdraw in Hall
**Purpose**: Approve/Reject-queue for withdrawals der spilleren henter kontant i hall  
**Layout**: Filter-bar (Start/End Date, Search) + CSV/Excel-export + tabell

**Tables**:
- Kolonner: Username, Withdraw Amount, Hall Name, Date & Time, Status (Pending), Action (check/x)

#### 16.20 Withdraw in Bank — XML Export
**Purpose**: Approve/Reject-queue for bank-withdrawals med XML-fil-generering for regnskap  
**Layout**: Filter-bar + CSV/Excel-export + tabell

**Tables**:
- Kolonner: Date & Time, Username, Account Number (eks 1234567890), Withdraw Amount (4000), Status, Action (check/x)

**Business Rules** (Query-boks):
- "Hver dag om morgenen må XML-fil genereres og sendes til:
  1. Hver tilgjengelig agent i event (samme e-post), eller kun designert agent
  2. Enten per-hall XML eller samlet hall-spesifikk XML"
- Note: "This same process will be applicable for Agent users as well"

#### 16.21 Withdraw History
**Purpose**: Historikk over alle withdrawals (Hall + Bank kombinert)  
**Layout**: Filter-bar (Start/End, Search, **Select Withdraw Type** dropdown: Withdraw in Hall / Withdraw in Bank)

**Tables**:
- Kolonner: Date & Time, Transaction ID, Username, Account Number, Hall Name, Amount, Status (Pending/Approved)

#### 16.22 Hall Account Report — Liste over haller
**Purpose**: Admin ser alle hall-account-rapporter (én rad per hall)  
**Layout**: Sidebar-entry "Hall Account Report" (markørt A) med sub-items (Hall Account report — View, Hall Account report — Settlement report)

**Tables**:
- Kolonner: Hall Id, Hall Name, Action (View-ikon)

**Business Rules**:
- View-ikon redirecter til 16.23 for den hallen

#### 16.23 Hall Account Report — View (per hall)
**Purpose**: Daglig Bingonett-regnskap for én hall over valgt periode  
**Layout**: Filter (From/To + Search + Real/Bot-dropdown) + Download + stor tabell

**Tables (kolonner)**:
- Date, Day, Resultat Bingonet, Metronia, OK bingo, Francs, **Otium** (ny?), Radio Bingo, Norsk Tipping, Norsk Rikstoto, **Rekvisita**, **Kaffe-penger**, **Bilag**, **Gevinst overf. Bank**, Bank terminal, Innskudd dropsafe, Inn/ut kasse, **Diff**, **Kommentarer**

**Sum-row**: Sum For UKE (total)

**Business Rules**:
- Filter: From/To date
- Filter: Real / Bot (radio)
- Download PDF iht dato
- Note: "If multiple agent submit the settlement, that settlement should be added in the list of the particular day"

#### 16.24 Hall Account Report — Settlement Report
**Purpose**: Samme som 16.23 men med Action-kolonne (edit/download) per day  
**Tables**:
- Samme kolonner som 16.23 + Action (edit-ikon + download-receipt-ikon)
- Comment-kolonne med tekst "Bilag (Upload receipt)"

**Business Rules**:
- Admin kan edit settlementen + download receipt som ble lastet opp
- Hvis multiple agents submitter settlement → alle legges i listen den dagen
- Hvis agent submitter edit → edit amount reflekteres i hall account report

#### 16.25 Settlement — Edit Popup (1:1 lik Agent Settlement)
**Purpose**: Admin kan editere en gitt dag sin settlement (popup identisk med Agent-popup 17.10)  
**Layout**: Modal med 3 seksjoner (Machine Breakdown, Shift Delta, Notice)

**Header**:
- Hall: Game of Hall
- Date: (dato-input)
- Name: (hall-navn auto-fyllt)

**Machine Breakdown Table**:
- Rader: Metronia (Machine ID), OK Bingo (Machine ID), Franco (Machine ID), Otium (Machine ID), Norsk Tipping Dag (add as machine ID), Norsk Tipping Totalt, Norsk Rikstoto Dag (add as machine ID), Norsk Rikstoto Totalt, Rekvisita (Props), Servering/kaffepenger (Servings + coffee), Bilag (recipt), Bank (Bank), Gevinst overføring bank (prices transferred via bank), Annet (Other), **Totalt (Total)**
- Kolonner: IN, OUT, **Sum (til kasse-fil)**

**Bilag-rad**: har "Upload receipt"-ikon/knapp

**Shift Delta-seksjon**:
- Endring opptall kasse (difference daily balance):
  - Kasse start skift (30558)
  - Kasse endt skift (før dropp) (46169)
  - Endring (6613 = formel-resultat)
- Fordeling av endring opptall kasse på dropsafe og kasse:
  - Innskudd dropsafe (settlement til kasse-fil) (1000)
  - Påfyll/ut kasse (withdraw from t…) (5613)
  - Totalt (Total dropsafe/payfyll) (6613)
- **Difference in shifts** (11)

**Notice**:
- Fritt tekstfelt

**Buttons**:
- Update (admin-versjon) / Submit (agent-versjon 17.10)

**Business Rules**:
- Dato kan editeres ved submit
- Navn auto-fetches
- Beløp: IN/OUT for Metronia/OK Bingo/Franco/Otium/Norsk Tipping Dag/Norsk Rikstoto Dag; kun IN for Rekvisita, Serving, **Bilag**, Bank; kun OUT for Gevinst overføring
- **Norsk Tipping Dag reflekteres IKKE i rapport**, kun Totalt
- **Norsk Rikstoto Dag reflekteres IKKE i rapport**, kun Totalt
- Bilag har upload-receipt
- Formel Endring: `Kasse endt - Kasse start = Endring` (eks: 46169-30558 = 6613)
- Difference in shifts: `(Totalt dropsafe+kasse – Endring) + Endring – Totalt Sum (kasse-fil)` (eks: (6613-6613) + 6613 - 6602 = 11)
- "If agent 1 submitter settlement og agent 2 også, differanse + sum vises i hall account report"

---

## PDF 17: Agent V1.0 (14.10.2024)

**Date**: 14.10.2024  
**Pages**: 30  
**Scope**: Agent-portal V1.0 (MELLOMVERSJON mellom PDF 11 Agent V2.0 10.07.2024 og PDF 15 Agent V1.0 Latest 06.01.2025). Dekker Dashboard, Cash In/Out Management, Add/Withdraw Unique ID, Add/Withdraw Registered User, Create New Unique ID, Sell Products, Register More/Sold Tickets, Next Game-panel (Start/PAUSE/Ready-check), Check for Bingo, Physical Cashout, Players Management, Add Physical Ticket, Unique ID List + Details + Transaction History, Order History, Past Game Winning History, Sold Ticket, Hall Specific Report, Hall Account Report + Settlement.  
**Source**: `docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf`

### Purpose
Komplett agent-portal-spec som mellomledd mellom V2.0 (10.07.2024, 30 sider) og "Latest" (06.01.2025, 30 sider). Denne versjonen inneholder endelig **Settlement**-popup-struktur og definerer **Register Sold Tickets**-flyten med `Final ID of stack`-scanner. Strukturelt lik V1.0 Latest, med mindre polish-forskjeller.

### Key Screens

#### 17.1 Agent Dashboard
**Purpose**: Landing page for agent med KPI + latest requests + top players + ongoing games  
**Layout**: Top header (Group of Hall Name - Hall Name, Cash In/Out-knapp, Language toggle, Notification-bjelle, Profile) + 4 hovedseksjoner

**Header**:
- Sidenavigation toggle (hamburger, markørt G)
- Group of Hall Name — Hall Name (linket, markørt C)
- **Cash In/Out** (knapp, markørt I)
- **Language toggle** (NO/EN, markørt J)
- Notification-bjelle
- Profile (markørt H, dropdown: Profile)

**Sidebar (markørt A)**:
- Dashboard
- Players Management (v)
- Game Management (v)

**Widget: Total Number of Approved Players** (markørt B):
- Stor tall-boks (eks: 250)

**Widget: Latest Requests** (markørt D):
- Med `-` og `x` til å minimize/close
- Header: "Total Pending Requests: 10"
- Tabell: Username, Email ID, Requested Date and Time
- 5 rader
- Link: "View all Pending Request"

**Widget: Top 5 Players** (markørt E):
- Profil-avatar + Username × 5 spillere
- Click → redirect til View Profile

**Widget: Ongoing Games** (markørt F):
- Tabs: Game 1, Game 2, Game 3, Game 4
- Tabell: Main Game ID, Game Name, Start Date & Time, End Date & Time, Price per Ticket, Price of Lucky Number, Notification Start Time, Total seconds to display ball, No of minimum tickets to start the game, Status (Active)
- "View all Games"-link

**Business Rules**:
- Language toggle: switch between English/Norwegian (statisk UI + dynamisk data som hall-navn)
- Periodic popup every 10-15 min for pending deposit requests ("Cash In/Cash Out" tab displays pending count)

#### 17.2 Cash In/Out Management — Main View
**Purpose**: Hovedvy for agent cash-operasjoner (shift, pengehandling, game-kontroll)  
**Layout**: Header + Cash-balanse-panel + 6 knapper + Next Game-panel + Ongoing Game-panel + Completed Games

**Top header**:
- Cash In/Out Management-tittel
- **Back**-knapp (markørt M)
- **Shift Log Out**-knapp (markørt F)
- **Shift End**-knapp (vises i enkelte flyter)

**Cash Balance Panel (markørt B)**:
- "Agent Name: Nsongka Thomas"
- Tabell (Title × Amount):
  - Total Cash Balance: 23000
  - Total Cash In: 20000
  - Total Cash Out: 30000
  - Daily Balance: 20000 (markørt C)
- **Add Daily Balance** (markørt D) — åpner popup 17.5
- **Control Daily Balance** — åpner popup 17.3
- **Settlement**-knapp — åpner popup 17.10
- **Today's Sales Report**-knapp (markørt E)

**Cash In/Out Buttons (markørt F, 6 stk)**:
- Add Money — Unique ID (grønn)
- Add Money — Registered user (grønn)
- Create New Unique ID (grønn)
- Withdraw — Unique ID (rød)
- Withdraw — Registered user (rød)
- Sell Products (grønn)

**Next Game Panel (markørt: "Next Game: Game No. Game Name")**:
- Register More Tickets (brun)
- Register Sold Tickets (grønn)
- **Start Next Game** (blå, stor) — "Next Game: Color Draft"
- **i**-knapp (lilla) — "Next Game: Color Draft" (info popup med Ready/Not Ready agents, markørt N)

**Ongoing Game Panel**:
- "Ongoing Game: Game No. Game Name"
- **SOLD TICKETS OF EACH TYPE** (markørt H):
  - My Halls: "SW23, LW.45, SY4; LY32, 32SP, 15LP" (Small White 23, Large White 45, etc.)
  - Group Of Halls: "SW93, LW.98, SY24; LY78, 89SP, 115LP"
- **PAUSE Game and check for Bingo** (blå)
- Resume Game (brun)
- i-knapp (lilla)
- See all drawn numbers (markørt K)
- Siste trukne ball (markørt I, rund)
- Total balls drawn (markørt J, stor tall-boks)

**Completed Games**:
- Tabell: Sub game ID, Sub Game Name (eks: Mystery), Start Time, Action (view-ikoner)

#### 17.3 Control Daily Balance Popup
**Purpose**: Submit shift-rapport med daily balance + total cash balance  
**Layout**: Modal popup

**Fields**:
- Daily balance (numerisk)
- Total cash balance (numerisk)

**Buttons**:
- Submit

#### 17.4 Settlement Popup (1:1 identisk med 16.25)
Se 16.25 for full spec. Agent-versjonen har "Submit"-knapp i stedet for "Update".

**Business Rules (unikt for agent)**:
- "If agent 1 submitter settlement og agent 2 også submitter → differansen kommer i hall account report"

#### 17.5 Add Daily Balance Popup
**Purpose**: Agent legger til start-skift-balance (kun på skift-start)  
**Layout**: Modal popup

**Fields**:
- "Current Balance: 0 kr"
- Enter Balance (numerisk)

**Buttons**:
- ADD / Cancel

**Business Rules**:
- "Vi administrerer ikke noen safe-balance for agenter i denne versjonen"
- Agent kan KUN legge til balance hvis session ikke startet eller session er logged ut fra forrige agent

#### 17.6 Shift Log Out Popup
**Purpose**: Confirm logout av skift  
**Layout**: Modal popup

**Content**:
- "Are you sure you want to logout?"
- Checkbox: **Distribute winnings to all physical players**
- Checkbox: **Do you want to transfer the register ticket to next agent.**
- Link: ">> View Cashout Details"

**Buttons**:
- Yes / Cancel

**Business Rules**:
- Distribute winnings checkbox: ved hake → alle pending cash-outs markeres som rewarded i systemet
- Transfer register ticket: register-ticket overføres til neste agent
- View Cashout Details: åpner cashout-data for hver ticket spilt under shiftet

#### 17.7 Add Money — Registered User Popup
**Purpose**: Agent legger til balance på registrert spiller  
**Fields**:
- Enter Username
- Add Amount (med "Current Balance: 2000kr" til høyre)
- Select Payment Type (dropdown: Cash/Card)

**Buttons**:
- ADD / Cancel

**Business Rules**:
- Agent klikker ADD → confirmation popup → system oppdaterer player wallet + daily balance
- Cancel uten oppdateringer
- Note: "When agent add balance in player's account, system will update Daily Balance and player wallet amount"

#### 17.8 Withdraw — Registered User Popup
**Purpose**: Agent trekker ut balance fra registrert spiller  
**Fields**:
- Enter Username
- Add Amount (med "Current Balance: 2000kr")
- Select Payment Type (dropdown)

**Buttons**:
- Withdraw / Cancel

#### 17.9 Create New Unique ID
**Purpose**: Generer unikt ticket-ID for walk-in spiller uten konto  
**Layout**: Skjema-side (ikke popup, full side)

**Fields**:
- Unique ID Purchase Date and Time (kalender+tid)
- Unique ID Expiry Date and Time (kalender+tid)
- Balance Amount (numerisk)
- Hours Validity (numerisk, **default minimum 24 hours**)
- Payment Type (dropdown: Cash/Card)

**Buttons**:
- PRINT / CANCEL

**Business Rules**:
- Start Date+Time = current date/time by default (editable)
- End Date+Time agent må velge
- Balance Amount agent skriver inn
- Hours Validity: basert på Start-End, **minimum 24 timer** for å kunne spille
- Payment Type: Cash/Card
- Note: "Unique ID vil være aktiv mellom start-slutt. Unique ID er generert per hall"
- Note: "Ettersom en agent kan ha flere haller, må agent velges først i Admin"
- PRINT: agent kan printe ID etter generering. Hvis PRINT trykkes og det er tom for balanse, vises notis — ID kan ikke brukes å spille.
- CANCEL: etter generering kan agent ikke avbryte (ID er allerede opprettet)
- Agent kan legge til mer balanse til eksisterende Unique ID via "Add Money to the Existing"

#### 17.10 Add Money — Unique ID Popup
**Purpose**: Legg til balanse på eksisterende Unique ID  
**Fields**:
- Enter Unique ID
- Add Amount
- Select Payment Type (dropdown)

**Buttons**:
- Yes / No

**Business Rules**:
- Yes → entered amount legges til i wallet. Hvis spiller spiller når pengene legges til, får player "If the player is playing the game by entering it"-notice
- No → retur til forrige side
- For Example: Agent genererer Unique ID med 200kr payment status **Online**. Ut av 200kr hadde spilleren 100kr igjen. Så hvis agenten legger til 200kr, vises **170kr** for Unique ID som Unique ID-oppretting-kostnad (?) og **200kr** er payment status **Cash**
- I slutten er remaining balance 170kr + 200kr nyatt = begge wallets

#### 17.11 Withdraw — Unique ID Popup
**Purpose**: Trekk ut balanse fra Unique ID (kun Cash)  
**Fields**:
- Enter Unique ID
- Add Amount ("Current Balance: 2000kr")
- Select Payment Type (dropdown — **kun cash-option tilgjengelig** for Unique ID)

**Buttons**:
- Withdraw / Cancel

**Business Rules**:
- Kun Cash-option for Unique ID withdraw
- Cancel redirecter til forrige side

#### 17.12 Sell Products (Kiosk)
**Purpose**: Kjop av kaffe/sjokolade/ris etc. via agent-kasse  
**Layout**: Horisontal rad med produkter + produkt-kurv + totalsum + payment

**Fields**:
- Produktknapper (Coffee, Choclate (2), Rice, Coffee) med `-` ikon for decrement
- Cart-ikon (handlekurv) til venstre
- "Total Order Amount: 80" til høyre
- Cash / Card knapper (markørt D)

**Business Rules**:
- Agent velger kvantum via `-`-ikon per produkt
- Minus deselekter produktet
- Agent ser antall selected produkter
- Payment: Cash / Card-knapp → submit order
- Cash-transaksjon oppdaterer total cash og total daily balance

#### 17.13 Register More Tickets Popup
**Purpose**: Agent skanner/registrerer nye fysiske tickets (stack-nivå)  
**Layout**: Modal popup

**Fields**:
- Initial ID of the stack (numerisk) — pilikon → Final ID of the stack
- Scan / Submit knapper

**Scanned Tickets Table**:
- Kolonner: Ticket Type, Initial ID, Final ID, Tickets Sold, Action (edit/delete)
- Eksisterende typer: Small Yellow (1-100), Small White (101-200), Large Yellow (201-300), Large White (301-400), Small Purple (401-500), Large purple (501-600)

**Business Rules**:
- Agent kan åpne popup ved F1 (hotkey) eller klikke "Register More Tickets"
- Agent kan scanne eller sette inn initial+final ID
- Scan: auto-fill Initial ID → system oppdaterer Final ID basert på stack-tellet (eks 100, 150)
- "Hall og scanned tickets må matche med info i physical ticket database, ellers error"
- Agent må registrere tickets hver dag før schedule starter
- Note: Ved Hot key "F1" kan agent registrere mer ticket til listen

#### 17.14 Register More Tickets — Edit Popup
**Purpose**: Rediger en eksisterende ticket-stack  
**Fields**:
- Initial ID of the stack (1)
- Scan / Submit

#### 17.15 Register Sold Tickets Popup
**Purpose**: Agent registrerer solgte tickets før next game starter  
**Layout**: Modal popup

**Header**:
- "Game: Wheel of Fortune" (tittel på neste spill)

**Fields**:
- Final ID of the stack (numerisk)
- Scan / Submit knapper

**Sold Tickets Table**:
- Kolonner: Ticket Type, Initial ID, Final ID, Action (delete)
- Eksempel: Small Yellow (1-10), Small White (101-20)

**Buttons**:
- Submit / Cancel

**Business Rules** (utdrag fra notes):
- Agent kan se navn på next game
- Agent ser liste av alle ticket types tilgjengelig for dette spillet
- For hver ticket type kan agent skrive inn eller scanne ticket ID
- Ved scanning: system sjekker Initial ID av scanned tickets, alle subsequent scanned settes som Final ID
- Ved entering: system evaluerer ID i range
- System validerer automatisk at alle tickets med ID < given er merket som solgt
- **Pre-game scanning eksempel**: 100 tickets (1-100) med yellow designert Small Yellow; 101-200 for Large Yellow. Ved 9:00 AM Wheel of Fortune-starting: agent scanner 10 Small Yellow (ID 1-10 som er solgt). Agent skriver "11" for å scanne → system informerer at tickets 1-10 er sold, resterende 11-100 carry-forward til next game. Neste game 10:00: 20 nye, agent scanner 31 → system vet 11-20 er sold. Osv.
- Note: "Scan module registrerer kun for NEXT game"
- Hotkeys: F1 = submit ticket + add til liste; Enter = submit scan ticket; Cancel = cancel scan ticket

#### 17.16 Next Game — Start Flow (variant 1: Bingo mid-game)
**Purpose**: Agent starter next game eller pauser nåværende for Bingo-check  
**Layout**: Main CashInOut page + **Check for Bingo**-popup

**Check for Bingo Popup**:
- "Enter Ticket Number" (input)
- GO-knapp

**Business Rules**:
- Agent trykker "PAUSE Game and check for Bingo" → popup
- Agent skriver ticket-nummer → GO → pattern-validerer → viser 17.22 (5x5 grid med patterns)

#### 17.17 Next Game — Hall Info Ready/Not Ready-popup (variant 2: Pre-start sjekk)
**Purpose**: Agent ser hvilke haller i group-of-halls som er klare før start  
**Layout**: Main + **Hall Info**-popup

**Hall Info Popup**:
- Header: "Ready to go" + hall-liste (eks: Gullerene Bingos)
- Header: "Not ready yet" + hall-liste (Centre, Notodden bingohal)

**Business Rules**:
- Popup vises ved klikk på "i"-knappen ved Start Next Game
- Agent ser hvilke haller som er klare til å spille

#### 17.18 Next Game — Are You Ready (variant 3)
**Purpose**: Master hall signaliserer "Ready" til group-of-halls  
**Layout**: Main CashInOut page med stor "Are You Ready?"-knapp

**Buttons**:
- Are You Ready? (stor knapp)
- Ready to Go (grønn) — sekundær
- Check for Bingo (stor blå)

**Business Rules**:
- Master-hall-agent trykker "Are You Ready?" for å signalisere klar
- Når alle haller i GoH er klare → spillet kan starte fra master
- Next Game-panel viser "Game ID Game Name (Non — Master Hall)"

#### 17.19 Next Game — Register Next Tickets (variant 4: Before start)
**Purpose**: Agent sees "Register More Tickets + Register Sold Tickets + Start Next Game + i" kombinert med "Completed Games"-tabell  
**Layout**: Main CashInOut page med alle Next Game-knapper + ekstra Transfer Hall Access + Countdown Timer-widgets

**Transfer Hall Access widget**:
- Velg hall fra dropdown (eks Hall 1, Hall 2, Hall 3)
- Submit-knapp

**Countdown Timer widget**:
- Count (dropdown: 2 min, 3 min, etc.)
- Launch-knapp

**Business Rules**:
- Transfer Hall Access: agent kan overføre hall-kontroll til annen agent (delegering)
- Countdown Timer: agent setter 2-min / 3-min pre-start timer for neste spill

#### 17.20 Players Management — Approved Players (Agent-view)
**Purpose**: Samme som Admin Approved Players men agent ser kun sin hall  
**Layout**: Tabell med Import Excel + Filter (All) + search

**Tables**:
- Kolonner: Username, Email ID, Phone Number, Approved by, Available Balance (in Kr), Status, Action (menu: View Profile, Edit Profile, Add Balance, Transaction History, Game Details, Block/Unblock, Delete)

**Business Rules** (fra notes):
- 3 options: approve/reject players, pending requests, rejected requests (markørt A)
- Action-menu har **"Add Balance"** (opener popup)
- Ny note: **"We need to hide the POINTS data from the Admin/Agent Panel as well"** (markørt D)

#### 17.21 Players Management — Add Balance Popup
**Purpose**: Agent legger til balance til en spiller fra players-liste  
**Layout**: Modal popup (samme som 17.7 Add Money — Registered User)

**Fields**:
- Username or User ID (readonly, fra row)
- "Current Balance: 1000 kr"
- Enter Balance (numerisk)

**Buttons**:
- ADD / Cancel

**Business Rules**:
- Samme som Add Money — Registered User
- Ved ADD: confirmation popup, player wallet + daily balance oppdateres
- "Ved add balance i player's account, system oppdaterer Daily Balance og player wallet amount"

#### 17.22 Add Physical Tickets (agent-view)
**Purpose**: Agent registrerer fysisk ticket-stack før spill starter  
**Layout**: Form med Scanned Tickets-tabell

**Fields**:
- Initial ID of the stack (numerisk)
- Final ID of the stack (numerisk)
- Pilikon → Scan / Submit

**Tables**:
- Kolonner: Ticket Type, Initial ID, Final ID, Tickets Sold, Action (delete)
- Rader: Small Yellow (1-100, 10 sold), Small White (101-200, 20 sold), Large Yellow (201-300, 10 sold), Large White (301-400, 40 sold), Small Purple (401-500, 0 sold), Large purple (501-600, 0 sold)

**Business Rules**:
- Agent kan registrere tickets ved å sette inn eller scanne Initial ID av stacks
- System evaluerer ID og gjør tickets available for sale
- Note: "Hall og scanned tickets må matche physical ticket database"
- Agent må registrere tickets hver dag **før schedule starter**
- Pre-game eksempel som i 17.13/17.15
- Note: "Tickets added by one agent er automatisk available for andre agents i samme hall"

#### 17.23 View Sub Game Details (agent)
**Purpose**: Agent ser detaljer for et spesifikt sub-game (pre-game-config + sold tickets)  
**Layout**: Form m/felles skjema + to nested tabeller

**Fields**:
- Sub Game (textbox: Wheel of Fortune)
- Start Time / End Time (markørt B)
- Notification Start Time (30s)
- Total Seconds to display Single ball (4 Seconds, Ent Time: 9:20 AM)

**Ticket Color / Type and Price**:
- Small Yellow (10), Large Yellow (20)

**Game Name: Row/Pattern Prize**:
- Small Yellow: Row 1, Row 2, Row 3, Row 4, Full House (alle med Price-input)
- Large Yellow: samme

**Total Numbers displayed already (markørt C)**:
- "10, 45, 74, 16, 25, 66, 33, 56, 45, 21, 70, 63, 67, 22, 53, 30, 44, 67, 3, 7, 21"

**User Type selector + search (markørt E-F)**:
- User Type dropdown: Online user / Unique ID

**Online User Tickets Table (markørt D)**:
- Kolonner: Player Name, User Type, Start Date & Time, Game Name, Ticket Color/Type, Ticket Number, Ticket Price, Ticket Purchased From (Wallet/Points), Winning Pattern (Row 1-Row 4 + dropdown), Total Winnings, **Spin Wheel Winnings** (input), **Treasure Chest Winnings** (input), Mystery Winnings, Action (view-ikon)

**Physical Ticket Table (markørt G-H-I)**:
- Kolonner: Ticket Number, Unique ID, **User Type (Physical Ticket User)**, Start Date & Time, Game Name, Ticket Color/Type, Ticket Price, Winning Pattern, Total Winnings, Spin Wheel Winnings, Treasure Chest Winnings, Mystery Winnings, Action (view/edit)
- "Add Physical Ticket"-knapp (markørt I) — åpner 17.22

**Business Rules**:
- Admin kan view sub-game details med fields above
- Admin kan view total numbers displayed already
- Admin kan view ticket details fra Unique ID og Online user
- Agent kan entre winnings for Spin Wheel + Treasure Chest på vegne av spilleren
- Agent kan filter liste på Group of Hall + Hall
- Agent kan add physical ticket kun for next upcoming game

#### 17.24 Add Physical Ticket Popup (inne i Sub Game Details)
**Purpose**: Legg til physical ticket til et sub-game direkte fra detail-view  
**Layout**: Modal popup

**Fields**:
- Game (textbox, pre-fylt: Wheel of Fortune)
- Final ID of the Stack (numerisk)
- Scan / Submit

**Scanned Tickets Table**:
- Kolonner: Ticket Type, Initial ID, Final ID, Action (delete)
- Rader: Small Yellow (1-10), Small White (101-20)

**Buttons**:
- Submit / Cancel

**Business Rules**:
- Note: "Physical ticket player får auto-cashout fra systemet så fort winnings er klare"

#### 17.25 Unique ID List
**Purpose**: Liste av alle Unique IDs agent har opprettet (eller alle i hallen)  
**Layout**: Filter-bar (From/To date, Search, Reset) + tabell

**Fields** (markørt):
- Date range picker (From/To, markørt C)
- Search-input (markørt E)
- Reset (markørt D)

**Tables**:
- Kolonner: Unique ID, Created by (Ag 1/Admin), Purchase Date and Time, Expiry Date and Time, Balance Amount, Status of Unique ID (Active/Inactive), Action (3 ikoner: View, Transaction History, Withdraw — markørt F)

**Business Rules**:
- Hvis agent's assigned hall+agent matcher hallen som opprettet Unique ID → view+edit access
- Agent som deler hall kan access andre agents' Unique IDs

#### 17.26 Unique ID Details (View Action)
**Purpose**: Detalj-vy av en spesifikk Unique ID  
**Layout**: Field-grid med flere seksjoner

**Fields (A-H)**:
- Unique ID (B): 13343
- Unique ID Purchase Date (C): 01-09-2020, 4:00
- Unique ID Expiry Date (D): 02-09-2020, 4:00
- Hours Validity (E): 24 hours
- Status (F): Active (grønn)
- Total Balance (G): 100 kr
- Overall Winnings (H): 700 kr
- **Choose Game Type (I)** (dropdown: Game 1/2/3/4)

**Per-game Details Table (markørt J)**:
- Kolonner: Game ID, Child Game ID, Unique Ticket ID, Ticket Price, Ticket Purchased from (Wallet/Points), Winning Amount (kr), Winning Row

**Buttons (K-L)**:
- Print (K) — print hele Unique ID-data
- Re-Generate Unique ID (L) — generer ticket igjen hvis print feilet
- Back

**Business Rules**:
- For Game 2: Game ID, Child Game ID, Unique Ticket ID, Ticket Price, Ticket Purchased from, Winning Amount (kr), Winning Row
- "Winning amount + row calculation = existing"
- Re-generate: kun for å printe ticket igjen ved print-feil

#### 17.27 Unique ID — Transaction History
**Purpose**: Vis alle transaksjoner for én Unique ID  
**Layout**: Filter (From/To + Search + Reset) + tabell

**Tables (markørt B-C)**:
- Kolonner: Order Number, Transaction ID, Date and Time, **Transaction Type** (Credit/Debit, markørt C), Amount, Status
- 5 example rows (OD1-OD5 med Credit/Debit)

**Business Rules**:
- Agent ser transaksjoner inkl purchased tickets, winnings, losses, added balance, withdrawals
- Date range filter + Reset

#### 17.28 Unique ID — Withdraw Popup
**Purpose**: Withdraw fra Unique ID-liste  
**Layout**: Modal popup

**Fields**:
- Unique ID: 21345 (readonly)
- Balance: 2000 (readonly)
- Enter Amount (numerisk)

**Buttons**:
- Withdraw / Cancel

**Business Rules**:
- Note: "Kun cash option som withdraw type"
- Ved Withdraw: blir addet til Cash Out History av Unique ID

#### 17.29 Order History (for Sell Products)
**Purpose**: List av alle product-orders fra 17.12  
**Layout**: Filter (From/To, Search, Reset, Payment Type dropdown) + tabell

**Tables**:
- Kolonner: Order ID, Date and Time, Player Name, Total Order, Payment Type (Cash/Card), Action (view)

**Business Rules**:
- Payment Type filter: Cash / Online payment
- View-action åpner 17.30
- Note: "Order History table will be added for the Admin portal as well. Just 2 new columns will be added in the reports"

#### 17.30 View Order Details
**Purpose**: Detalj-vy av en product-order  
**Layout**: Form med felt + produkt-tabell

**Fields**:
- Order ID: 123456789543
- Player Name: Player 1
- Order Date and Time: 19/7/2023 13:00
- Payment Type: Cash

**Tables**:
- Kolonner: Product Name, Image, Price per quantity, Quantity, Total Amount
- Eks: Name 1 (image + 40 + 2 + 80), Name 2 (image + 400 + 1 + 400), Name 5 (image + 40 + 1 + 40)
- Total Order: 520

#### 17.31 Sold Ticket List
**Purpose**: Liste av alle tickets solgt av agent (pre-game + during game)  
**Layout**: Filter (From/To, Search, Ticket Type dropdown) + tabell

**Filter Options (markørt D)**:
- Physical / Terminal / Web

**Tables**:
- Kolonner: Date and Time, Ticket ID, Ticket Type (Physical/Terminal/Web), Ticket Color (Red/Yellow/Blue), Ticket Price, Winning Pattern

**Business Rules**:
- Agent kan filtere på ticket-type (Physical/Terminal/Web)
- Search by Ticket ID

#### 17.32 Past Game Winning History
**Purpose**: Historikk av alle winning tickets  
**Layout**: Filter (From/To, Search) + tabell

**Tables**:
- Kolonner: Date and Time, Ticket ID, Ticket Type, Ticket Color, Ticket Price, Winning Pattern

**Business Rules**:
- Historical data per-hall
- Search by Ticket ID

#### 17.33 Physical Cashout — Daily List
**Purpose**: List over fysiske tickets som trenger cashout  
**Layout**: Filter (Select Date From/To) + tabell

**Tables**:
- Kolonner: Date, Game Name, Sub Game Name - Id, Total Winnings, Pending Cashout, Action (view)
- 7 example rows (13-17/02/2024)

#### 17.34 Physical Cashout — Sub Game Detail
**Purpose**: Cashout-vy for alle tickets i et sub-game  
**Layout**: Header (Date, Sub Game Name: Traffic Light) + search + tabell + totals + Reward All

**Tables**:
- Kolonner: Physical Ticket No, Ticket Type (Small Yellow/Large Yellow/Red etc.), Ticket Price (10/20), Winning Pattern (dropdown), Total Winning (100), Rewarded Amount (100), Pending Amount (0), Action (bank-ikon)
- 7 rader

**Totals**:
- Total Winnings: 1000 Kr
- Rewarded: 600 Kr
- Pending: 400 Kr

**Buttons**:
- Reward All (pay ut alle pending)

#### 17.35 Physical Cashout — Per-Ticket Popup
**Purpose**: Per-ticket detail med bingo-grid + pattern-status  
**Layout**: Modal med 5x5 grid + Winning Patterns-tabell

**Grid**:
- 5x5 rutenett (25 grønne celler)
- Markerte celler: 1, 23, 56
- Pil-indikator som viser pattern

**Header**:
- "153915" (ticket-ID) + X-lukkeknapp

**Winning Patterns Table**:
- Raw 1: 100kr — Status: Cashout
- Raw 2: 100kr — Status: Rewarded

**Business Rules**:
- Cashout-status: admin har betalt
- Rewarded-status: vinning allerede gitt
- Note: "Cash-out option kun available for current day only. Etter day ends kan agent ikke cashout eller endre status"

#### 17.36 Hall Specific Report
**Purpose**: Per-hall detaljert omsetnings-rapport per spill-type  
**Layout**: Filter (From/To, **User Type**, Group of Hall Name, Hall Name, Search, Reset) + stor tabell med 5 game-seksjoner

**Tables**:
- Grouped columns per game (Game 1 / Game 2 / Game 3 / Game 4 / Game 5)
- Per-game kolonner: OMS (omsetning), UTD (utdelt), Payout(%), RES (resultat)
- Kolonner først: Group Of Hall Name, Hall Name, Agent, Elvis Replacement Amount (eks: 1300)
- 5 rader (Spillorama Notodden GOH x3 haller + Thomas Agent1)

**Business Rules**:
- Filter: Game Type, Group of Hall Name, Hall Name
- Note: "Ensure ticket upgrades registreres i Elvis-ticket-kolonnen som sales + income generert blir correctly tracked"

#### 17.37 Order Report (under Hall Specific)
**Purpose**: Per-agent order-rapport  
**Tables**:
- Kolonner: Date and Time, Agent Name, Game of Hall, Hall Name, Cash, Card, Customer Number, Total

**Business Rules**:
- Filter: Game Type, Group of Hall Name, Hall Name
- Search by agent name

#### 17.38 Hall Account Report (Agent-view)
**Purpose**: Agent ser daglig regnskap for sin hall (read-only copy av 16.23)  
**Layout**: Samme som 16.23 men uten edit  
**Tables**: Samme kolonner som 16.23

**Business Rules**:
- Filter: From/To, Year / Bot (radio)
- Download PDF
- Note: "If multiple agent submit settlement, settlement should be added in list"

#### 17.39 Hall Account Report — Settlement Report (Agent)
**Purpose**: Samme som 16.24 (Admin Settlement Report) men med agent's perspective + Edit/download receipt-action  
**Layout**: Samme som 16.24

**Tables**: Samme kolonner som 16.24 + Action (edit + download receipt)

**Business Rules**:
- Agent kan se Hall Account Report + view details av settlement som er addet av agent
- Columns: Date, Day, Resultat Bingonet, Metronia, OK bingo, Francs, Otium, Radio Bingo, Norsk Tipping, Norsk Rikstoto, Rekvisita, Kaffe-penger, Bilag, Gevinst overf. Bank, Bank terminal, Innskudd dropsafe, Inn/ut kasse, Diff, Kommentarer, Bilag (Upload receipt action)
- Note: "Hvis multiple agent submitter settlement, addes i list for den dagen"
- Note: "Hvis agent edit settlement, edit amount reflekteres i hall account report"

#### 17.40 Settlement Popup (Agent - identisk 1:1 med 16.25)
Se 16.25 for full spec.

**Business Rules (unikt for agent)**:
- Submit-knapp (ikke Update som hos admin)

---

## Cross-System Patterns

### Common Navigation
- **Admin Panel**: Side navigation menu with roles-based visibility
- **Agent Portal**: Collapsible sidebar with expandable sections
- **Player Frontend**: Header navigation with account menu

### Authentication
- **Levels**: Public (login), Authenticated (player), Admin, Agent
- **Session Management**: Timeout after inactivity (30 min player, 8 hr admin)
- **MFA**: Optional for high-balance accounts

### Data Tables Standard
- **Filtering**: Date range pickers, dropdowns, search fields
- **Pagination**: Previous/Next buttons with entry count display
- **Sorting**: Click column headers to sort ascending/descending
- **Export**: CSV/PDF download options (admin/agent)

### Cash Transactions
- **Recording**: All cash movements logged with timestamp, agent, and amount
- **Reconciliation**: Daily balance verification required before shift end
- **Audit Trail**: 7-year retention for compliance

### Game Mechanics
- **Ticket Types**: Physical, Unique ID (prepaid), Online (real-time)
- **Patterns**: Row 1-4, Full House, T-Pattern, custom per game type
- **Multipliers**: Game 5 SpinnGo uses 1x-5x multipliers
- **Settlement**: Automatic after game completion, manual verification by agent

### Business Rules Across All PDFs
1. **Player Management**: Approval required before playing, balance check before entry
2. **Hall Operations**: Each hall has assigned agent(s), independent game scheduling
3. **Financial Control**: Daily balance mandatory, settlement before shift change
4. **Reporting**: Audit trails maintained for all transactions and game results
5. **Data Retention**: Transaction history 7 years, game history 1 year minimum

---

## Document Notes

**This catalog documents 17 PDFs totaling 295+ pages of wireframes. Each screen description includes:**
- Purpose (what the screen does)
- Layout (how elements are arranged)
- Fields (input elements with labels and validation)
- Tables (data grids with column descriptions)
- Buttons (actions available)
- Business Rules (system constraints and behaviors)

**Screen descriptions are detailed enough to enable 1:1 implementation without visual styling specifications. Colors, fonts, and visual design are explicitly excluded.**

**Last Updated**: 2026-04-24 (PDF 16 + PDF 17 integrated)  
**Status**: Complete extraction of all 17 PDFs

