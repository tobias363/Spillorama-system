# BIN-587 Endpoint Parity Matrix — Fase A

**Dato:** 2026-04-18
**Eier:** Tech Lead (Tobias)
**Status:** Fase A levert — matrise klar for review, Fase B porting kan starte

Dette dokumentet er leverende fra **Fase A** av BIN-587 (HTTP endpoints-paritet mellom `unity-bingo-backend/` (legacy Node/Express) og `backend/` (ny TS backend)). Målet er én samlet oversikt som driver prioritering og PR-oppdeling i Fase B.

- Full matrise som CSV: [docs/bin587/endpoint_matrix.csv](bin587/endpoint_matrix.csv) — 556 rader (1 rad per legacy-endpoint), med kolonnene `category,method,path,controller,action,status,note`.
- Ny backend-inventar (referanse): 115 endpoints i `backend/src/routes/{auth,game,payments,wallet,admin}.ts` + integration (`/api/ext-wallet/*`, `/api/games/candy/launch`) + health/metrics. Socket.io-events i `backend/src/sockets/gameEvents.ts` dekker kjerneflyten (`room:create`, `room:join`, `game:start`, `draw:next`, `ticket:mark`, `claim:submit`, osv.) og er ikke HTTP-endpoints, derfor utenfor matrisen.

## 1. Metode

- Legacy-ruter ekstrahert automatisk fra `unity-bingo-backend/App/Routes/{backend,integration,frontend}.js` via AST-lignende regex (handterer multi-linje `router.post(\n'path', ...)`).
- Ny backend-ruter ekstrahert fra `backend/src/routes/*.ts` (+ `index.ts` for health/metrics/ext-wallet).
- Hver legacy-endpoint klassifisert per `controller.action` med heuristikker:
  - HTML-render (GET-index, `/add`, `/edit/:id`, `/view/:id`, `/profile`, `/register`): **NOT-NEEDED** — legacy admin-UI erstattet av React-admin.
  - Agent/dealer/terminal-logikk: **AGENT-DOMENE** — BIN-583 scope, ikke i BIN-587.
  - Business-action med tilsvarende ny endpoint: **EXISTS**.
  - Business-action uten tilsvarende: **MANGLER**.
  - Resterende uavklarte tilfeller: **TODO** (krever case-by-case triage i Fase B).

## 2. Tellinger

### Totalt

| Status | Antall | Andel |
|---|---:|---:|
| Total legacy endpoints | **556** | 100% |
| NOT-NEEDED (legacy admin-UI) | 127 | 23% |
| AGENT-DOMENE (BIN-583) | 74 | 13% |
| EXISTS (portert) | 44 | 8% |
| MANGLER (må portes) | **183** | 33% |
| TODO (triage i Fase B) | 128 | 23% |

**Konklusjon:** Opprinnelig estimat «~90 endpoints i 6 kategorier» var for lavt. Reelt scope for BIN-587 Fase B er **~180 MANGLER + opptil ~120 TODO som må trige pr. case** — sannsynlig endelig ~180–220 endpoints å porte, ca. 150 av dem etter at TODO faller ut i NOT-NEEDED eller EXISTS under triage.

### Per kategori

| # | Kategori | EXISTS | MANGLER | NOT-NEEDED | AGENT-DOMENE | TODO |
|---|---|---:|---:|---:|---:|---:|
| 1 | AUTH & identity | 8 | 14 | 17 | 0 | 17 |
| 2 | PLAYER & KYC & responsible gaming | 1 | 40 | 12 | 0 | 16 |
| 3 | GAMEPLAY & content | 3 | 32 | 47 | 0 | 34 |
| 4 | HALL, schedule & terminal | 23 | 22 | 17 | 0 | 12 |
| 5 | WALLET, payments & cashier | 5 | 49 | 14 | 2 | 22 |
| 6 | ADMIN ops & reports | 4 | 26 | 20 | 0 | 27 |
| 7 | AGENT domain (BIN-583) | 0 | 0 | 0 | 72 | 0 |

Se [bin587/endpoint_matrix.csv](bin587/endpoint_matrix.csv) for rad-for-rad detaljer.

## 3. Topp 10 pilot-kritiske gaps

Rangert etter blocker-grad for **pilothall-go-live** (ikke volum).

| # | Gap | Legacy-endpoint(s) | Pilot-impakt | Foreslått ny endpoint |
|---|---|---|---|---|
| 1 | **Deposit-kø for hall-kasse** (godkjenn/avslå innskudd) | `POST /deposit/requests/accept`, `POST /deposit/requests/reject`, `GET /deposit/requests/get`, `GET /deposit/history/get` | Blocker — kasserer må kunne godkjenne kontant-innskudd i kassa før spill | `POST /api/admin/payments/deposits/:id/{accept,reject}`, `GET /api/admin/payments/deposits?status=` |
| 2 | **Withdraw-kø (hall + bank-kanal)** (godkjenn/avslå utbetalinger) | `POST /withdraw/requests/accept`, `POST /withdraw/requests/reject`, `GET /withdraw/requests/hall/get`, `GET /withdraw/history/{hall,bank}/get` | Blocker — pilothallen må utbetale cash uten fallback til legacy | `POST /api/admin/payments/withdrawals/:id/{accept,reject}`, `GET /api/admin/payments/withdrawals?channel=` |
| 3 | **Player pending/rejected-registrering** (KYC-moderasjon) | `GET /pendingRequests/getPendingPlayer`, `POST /pendingRequests/{approve,reject}PendingPlayer`, `POST /pendingRequests/forwardRequest`, `POST /player/{approveRejected,deleteRejected}` | Blocker — nye spillere må godkjennes manuelt første periode (KYC-review-kø) | `GET /api/admin/players/pending`, `POST /api/admin/players/:id/{approve,reject,escalate}` |
| 4 | **Bulk-import av eksisterende spillere** (pilotmigrasjon) | `POST /player/import`, `POST /player/import/confirm` | Blocker — hall kommer med CSV-liste av eksisterende medlemmer (pengebalanse + KYC-status) | `POST /api/admin/players/import` (dry-run + commit) |
| 5 | **Hall-settlement / dagsregnskap** (økonomisk avstemming) | `GET /hallAccountReport`, `GET /getHallAccountReport`, `POST /hall/report/saveData`, `POST /hall/set-cash-amount`, `GET /report/settlement/:id`, `GET /report/settlement` | Blocker — hallen må lukke dagen og sende tall til Spillorama. Regnskapskrav. | `POST /api/admin/halls/:id/settlement/close`, `GET /api/admin/halls/:id/settlement?date=` |
| 6 | **BankID-reverifisering** (session-utløp etter X mnd) | `POST /player/reverify-bankid`, `POST /player/verify/update` | Blocker for langtidsspillere — KYC-token utløper. | `POST /api/admin/players/:id/reverify-bankid` + player-initiert `POST /api/auth/bankid/reverify` |
| 7 | **Player per-hall-status** (blokker spiller i én hall uten self-excl) | `POST /player/hallStatus`, `POST /player/block-rules/delete`, `POST /player/{active,playerSoftDelete}` | Høy — hall må kunne suspendere problemspillere lokalt uten national self-exclusion | `PUT /api/admin/players/:id/halls/:hallId/status`, `POST /api/admin/players/:id/{soft-delete,reactivate}` |
| 8 | **Physical-ticket inventory + salg** (papir-bingoblokker) | `POST /purchasePhysicalTickets`, `POST /addGamePhysicalTickets`, `GET /getSellPhysicalTickets/:gameId`, `POST /agent/physical/sell`, + 9 andre | Høy — blandet-modus pilot (digital + papir) er normaltilstanden. Ikke noe i ny backend. | Ny route: `/api/admin/physical-tickets/*` (CRUD + salg + uttrekk-binding) |
| 9 | **Red-flag / AML transaksjonsgjennomgang** | `GET /getRedFlagCategory/:id`, `GET /getPlayersRedFlagList`, `GET /getUserTransactionList` | Høy — pålagt AML-prosess; finanstilsyn krever evidens av at mistenkelige transaksjoner flagges og reviewes | `GET /api/admin/aml/red-flags`, `POST /api/admin/aml/red-flags/:id/review` |
| 10 | **Withdraw e-post-allowlist** (bank-utbetalinger) | `POST /withdraw/add/emails`, `GET /withdraw/get/emails`, `POST /withdraw/edit/emails/:id`, `POST /withdraw/delete/emails/`, `POST /withdraw/email/checkUnique/:emailId?` | Medium — bank-withdraw-notifikasjoner må kunne ekspedere til revisor/økonomi. Dagens ext-wallet-løsning dekker ikke dette. | `GET|POST|PUT|DELETE /api/admin/payments/withdraw-emails` |

## 4. Kategori-gjennomgang

### Kategori 1 — AUTH & Identity (56 rader)

**Dekning:** Base-auth (login, logout, BankID-init/callback/status, change-password, forgot-password, me) er fullt portert i `/api/auth/*` og `/api/admin/auth/*`.

**Store gaps:**
- Role CRUD: legacy har `rollController` (14) med admin-role og agent-role. Ny backend har kun fast `/api/admin/users/:id/role` (seed role). Dynamisk role mgmt mangler, men **kan vente** — RBAC-matrix er statisk og det er akseptabelt.
- Admin/User CRUD: `addAdmin`, `addUser`, `adminEdit`, `userEdit`, `getAdminDelete`. Partial dekning via `/api/admin/bootstrap` + `/api/admin/users/:id/role`. **Må porteres** for operator-UI.

**NOT-NEEDED:** HTML-render-ruter (`/admin`, `/register`, `/forgot-password`, `/reset-password/:token` som GET) erstattet av React-admin.

### Kategori 2 — Player & KYC & Responsible gaming (69 rader)

**Dekning:** Kjerne-spillvett (loss-limits, timed-pause, self-exclusion) er portert i `/api/wallet/me/*` + `/api/admin/wallets/:walletId/*`. Leaderboard view + KYC self-check er portert.

**Store gaps** (30+ MANGLER):
- Pending/rejected-registrering (KYC-moderasjon) — se topp-10 #3
- Bulk-import + reverify-bankid — se topp-10 #4, #6
- Per-hall-status + soft-delete — se topp-10 #7
- Loyalty (`LoyaltyController`, 10 ruter) — ikke implementert i ny backend. **Vurdering: kan droppes** hvis prosjektet ikke skal ha loyalty-program. Avklares med PM.
- Leaderboard admin-CRUD: legacy har admin som lager leaderboards; ny backend serverer dem via `/api/leaderboard` men admin-mgmt mangler.
- Red-flag-kategorier (under ADMIN-OPS) henger sammen med denne.

### Kategori 3 — Gameplay & Content (116 rader)

**Dekning:** Gameplay-kjernen kjører på socket.io (room:create, draw:next, ticket:mark, claim:submit) — ikke HTTP. Admin room control (`/api/admin/rooms/*/{start,end,draw-next,pause,resume}`) er portert. Game settings katalog + change-log portert.

**Store gaps:**
- Pattern management (`patternController`, 10) — CRUD for bingopattern mangler helt.
- Sub-game management (`subGameController`, 9) — avklares om subgames fortsatt er i bruk.
- Game-type CRUD (`addGameType`, `editGameType`) — delvis dekket av settings-catalog, men full gamtype-CRUD mangler.
- Close-day schedule (`closeDayAdd`, `deleteCloseDay`, `updateCloseDay`) — hall kan stenge dager unntatt faste planer. **Pilot-relevant.**
- Minigames (`otherGameController`, 8): WoF, Treasure, Mystery, ColorDraft — config-endpoints mangler. Socket-events finnes for `minigame:play`.
- SMS advertisement (`advertisementController`, 3) — dropshipped.

**NOT-NEEDED:** CMS (FAQ, ToS, Support, About, Responsible-gaming-side) håndteres trolig via static pages eller Notion, ikke dynamisk admin.

### Kategori 4 — Hall, Schedule & Terminal (86 rader)

**Dekning:** Best dekning. Hall CRUD, terminal CRUD, schedule CRUD (single slot) er portert.

**Store gaps:**
- Group halls (`groupHallController`, 12) — konsept av kjedehaller/gruppe-administrasjon ikke i ny backend. Tverrsjekkes med PM: er dette fortsatt nødvendig?
- Daily + special-schedule (bulk daglig plan, helligdags-spesial) — kun single-slot-CRUD i ny backend. Legacy har en hel daily/special-plan-arbeidsflyt.
- Hall-settlement/report — se topp-10 #5.
- `transferPlayersToHall` — re-tildel spillere mellom haller ved sammenslåing.
- `check-hall-number` / `check-ip-address` — valideringshelpere; kan gjøres i frontend.

### Kategori 5 — Wallet, Payments & Cashier (94 rader)

**Dekning:** Svakest dekning. Self-service wallet + Swedbank-flow for topup er portert. Ext-wallet-integrasjon (for Candy) er på plass. Admin-wallet kompliance-view portert.

**Store gaps:** Alle kasserer-arbeidsflyter mangler (deposit-kø, withdraw-kø, withdraw-historikk, voucher-CRUD, payout-visning per spiller/billett, physical-ticket-inventory, unique-ID-mgmt, player-transaksjonshistorikk fra admin). Se topp-10 #1, #2, #8, #10.

**NOT-NEEDED:** Legacy-index/view-sider.

**AGENT-DOMENE (2):** `unique/depositWithdraw`, `unique/withdrawAccess` — agent-terminal flyt, BIN-583.

### Kategori 6 — Admin ops, reports & settings (77 rader)

**Dekning:** Core compliance reports (daily-report, overskudd, ledger, payout-audit, prize-policy) portert.

**Store gaps:**
- Game-history-rapporter per gametype (`reportGame1..5`, 10 ruter) — ad-hoc rapporter som operator kjører mot rådata. Sannsynlig å dekke med én felles rapport-endpoint.
- Total revenue report + hall-specific report — supplement til daily-report.
- Dashboard chart-endpoints (3) — operator-UI trenger KPI-grafer.
- Red-flag / AML — se topp-10 #9.
- Risk-country CRUD (`addRiskCountry`, `deleteRiskCountry`) — KYC-lister.
- Blocked-IP CRUD (`SecurityController`) — rate-limit mgmt i ny backend gjør noe; admin-UI mangler.
- Maintenance mode + restart-server (`SettingsController`) — ops-UI.
- Product management (`productManagement`, 16) — shop/items for in-game bruk. **NOT-NEEDED** — utenfor MVP.

### Kategori 7 — Agent domain (72 rader) → BIN-583

`AgentController` (7), `agentcashinoutController` (51), `machineApiController` (14) flagges samlet som BIN-583 scope. Dette er agent-/operatør-kasserer-flyten (daily balance, settlement, unique-id cash-in/out, Metronia/OkBingo-terminal API, wheel-of-fortune reward). Avklares med PM før Fase B starter BIN-583.

## 5. Foreslått rekkefølge for Fase B PR-er

Prioriterer **pilot-blocker først, compliance deretter, operator-polish sist**. Hver PR skal kunne mergers og deployes uavhengig. Samler relaterte endpoints i én PR; store PR-er splittes om de vokser > 600 linjer diff.

| # | PR | Scope (estimat) | Pilot-impakt | Dependencies |
|---|---|---:|---|---|
| **B1** | **Admin payment workflows** — deposit-kø + withdraw-kø (hall + bank) + withdraw-email-allowlist | ~18 endpoints | **BLOCKER** — Top-10 #1, #2, #10 | Ingen (bygger på `/api/admin/wallets/*`) |
| **B2** | **Admin player lifecycle** — pending/rejected-kø + bulk-import + reverify-bankid + per-hall-status + soft-delete + admin player-edit | ~22 endpoints | **BLOCKER** — Top-10 #3, #4, #6, #7 | B1 (player + wallet linkes ved approve) |
| **B3** | **Hall settlement + reports v2** — hall-settlement, game-history-rapporter (1–5), dashboard-charts, total revenue | ~18 endpoints | **BLOCKER** — Top-10 #5. Høy compliance-prioritet. | B1 (deposit/withdraw-tall inngår i settlement) |
| **B4** | **Physical tickets + vouchers + unique-ID** (operator-skrifttlige bingoblokker, marketing-vouchers, unique-ID-mgmt) | ~28 endpoints | **HØY** — Top-10 #8. Forventet brukt i pilot. | B1 (wallet-transaksjoner) |
| **B5** | **AML + security admin** — red-flag-kategorier + transaksjons-review + risk-country + blocked-IP | ~14 endpoints | **HØY** — Top-10 #9. Compliance-blocker for tilsynsrapportering. | Ingen |
| **B6** | **Admin user + role mgmt** — admin/user-CRUD, role-CRUD (basic) | ~16 endpoints | Medium — operator-convenience; dagens fast-rolle-modell fungerer som stopgap | Ingen |
| **B7** | **Gameplay admin-CRUD** — pattern-mgmt, sub-game-mgmt, game-type-mgmt, close-day, minigame-config, saved-games | ~28 endpoints | Medium — pilot klarer seg med hardkodede spilldefinisjoner | B3 (rapport-rammeverk) |
| **B8** | **Polish & ops** — loyalty (valgfritt), leaderboard-admin-CRUD, maintenance-mode, system-info, group-halls (avklares), SMS-adv | ~20 endpoints | Lav — post-pilot | Ingen |

**Samlet Fase B:** ~164 endpoints over 8 PR-er, ~28–35 utviklingsdager (matcher initielt estimat 25–35 dager). Bufre for TODO-triage som trekker inn flere endpoints.

**Kritisk bane til pilot-go-live:** B1 → B2 → B3 → B5 (ca. 12–15 dager). B4, B6, B7, B8 kan parallelliseres eller følge etter pilot.

## 6. Åpne avklaringer (PM-input)

Disse krever eier-/PM-beslutning før Fase B kan starte på de relevante PR-ene:

1. **Loyalty-program (Kategori 2):** Skal det implementeres? Legacy har full CRUD for loyalty-tiers og player-loyalty. Hvis ja → B8 inkluderer dette. Hvis nei → droppes fra scope.
2. **Group halls (Kategori 4):** Skal konseptet overføres? Ny backend har ikke "hallgruppe"-entitet. Hvis ja → datamodell må utvides før B8.
3. **SMS-advertisement (Kategori 3):** Trenger vi å sende SMS-kampanjer? Hvis ja → B8. Hvis nei → droppes.
4. **Minigames config (Kategori 3):** WoF/Treasure/Mystery/ColorDraft — hvilke skal være aktive i pilothall? Socket-events finnes, men admin-config-endpoints mangler.
5. **Close-day schedule (Kategori 3):** Pilot-hall må kunne stenge enkeltdager — må dette være i MVP eller kan de gjøre det via schedule-slot-sletting?
6. **BIN-583 scope:** Må kjent-avklares før vi starter B1 (deposit/withdraw) — AGENT-DOMENE har overlappende wallet-operasjoner (daily-balance, settlement, register-user-balance) som kan forvirre B1-scope.

## 7. Referanser

- [docs/bin587/endpoint_matrix.csv](bin587/endpoint_matrix.csv) — rad-for-rad matrise (556 rader)
- [docs/ARKITEKTUR.md](ARKITEKTUR.md) — system-kart
- [docs/SPILLORAMA_SYSTEM_SCOPE_AND_SOURCE_OF_TRUTH_2026-04-12.md](SPILLORAMA_SYSTEM_SCOPE_AND_SOURCE_OF_TRUTH_2026-04-12.md) — shell-first lobby
- [docs/CANDY_SPILLORAMA_API_CONTRACT.md](CANDY_SPILLORAMA_API_CONTRACT.md) — ext-wallet-grensen
- [backend/src/routes/](../backend/src/routes/) — ny backend
- [unity-bingo-backend/App/Routes/](../unity-bingo-backend/App/Routes/) — legacy backend
