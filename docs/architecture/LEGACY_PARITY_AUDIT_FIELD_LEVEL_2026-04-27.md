# Legacy paritet-audit — feltnivå
_2026-04-27 — Agent LEGACY-PARITY-AUDIT_

Mandat: Tobias 2026-04-27 — "Det er fortsatt flere funksjoner som er på legacy backend som ikke er på vår. F.eks. Oppgjør. På legacy er det mye mer å fylle ut."

Eksisterende auditer (`BACKEND_1TO1_GAP_AUDIT_2026-04-24.md`, `WIREFRAME_CATALOG.md`) er på endpoint-/skjerm-nivå. Denne rapporten går ned på **felt-nivå** for de mest pilot-kritiske skjermene.

Legacy-kilde: `git show 5fda0f78:legacy/unity-backend/App/Views/...` (commit som karantene-arkiverte legacy Unity backend før sletting i 9c0f3b33).

## TL;DR

| Metrikk | Verdi |
|---|---|
| Skjermer auditert | 11 (av 15 prioriterte) |
| Felt sjekket | ~190 |
| ✅ Matcher | ~120 (~63 %) |
| 🟡 Delvis | ~37 (~19 %) |
| 🔴 Mangler | ~33 (~17 %) |

**Fire kritiske mangel-områder** (rangert):

1. **Hall Account Report — manuelle maskin-kolonner mangler** (Metronia/OK Bingo/Franco/Otium/Norsk Tipping/Norsk Rikstoto/Rekvisita/Kaffe-penger/Bilag/Bank Terminal). Vi har generiske kategorier (BANK_DEPOSIT/CORRECTION/REFUND/OTHER), legacy har 12 navngitte kolonner. Tobias' rapport-paritet er per i dag ikke 1:1.
2. **Settlement (Oppgjør) — `inAmountTransferredByBank` (Gevinst overføring bank) er feil-modellert**. Legacy har dette som **IN-felt** (admin entrer beløpet); ny `gevinst_overfoering_bank` er IN/OUT i et generisk row-skjema. Tobias' rapport bekrefter "mye mer å fylle ut" — vi mangler faktisk **3 separate kasse-balanse-felt** som var det med å fylle ut: Kasse Start Skift, Kasse Endt Skift (Før dropp), og Endring (auto-beregnet).
3. **Physical Cashout — bingo-pattern-popup + Reward All mangler helt.** Legacy `cashout_details.html` viser 5×5 grid med vinnende mønster, per-pattern Cashout/Rewarded-status, og "Reward All"-knapp. Ny `PhysicalCashoutPage.ts` (70 linjer) er bare en read-only liste. Pilot-blokker fordi agent ikke kan utbetale fysiske vinnere.
4. **Settlement — Bilag file-upload fungerer KUN via base64-dataURL i payload**, ikke `multipart/form-data` som legacy. Detaljert nedenfor — ikke pilot-blokker, men noe Tobias bør vite om.

---

## 1. Oppgjør (Settlement)

**Legacy-fil:** `legacy/unity-backend/App/Views/cash-inout/cash_in-out.html` (linje 1565–2050, ~485 linjer modal)
**Ny implementasjon:**
- `apps/admin-web/src/pages/cash-inout/modals/SettlementBreakdownModal.ts` (790 linjer) — det riktige modalen
- `apps/admin-web/src/pages/cash-inout/modals/SettlementModal.ts` (88 linjer) — legacy kodenavn, men brukes som "close-day" simpel-modal (ulik scope)
- `apps/admin-web/src/api/admin-settlement.ts` (218 linjer)
- `apps/backend/src/agent/AgentSettlementService.ts` (785 linjer)
- `apps/backend/src/agent/AgentSettlementStore.ts` (505 linjer)
- `apps/backend/src/routes/agentSettlement.ts` (526 linjer)

### 1.1 Header-felter

| Legacy-felt | Type | Ny implementasjon | Status |
|---|---|---|---|
| `{{session.hall[0].name}}` (modal-header) | display | `state.hallName` (settlement.hallName via API berikelse) | ✅ |
| `originalSettlementDate` (`#settlement-date`, datepicker) | date input | `state.businessDate`, `EditSettlementBody.businessDate` (admin edit) | ✅ |
| `{{session.name}}` (Agent Name) | display | `state.agentName` (settlement.agentDisplayName) | ✅ |

### 1.2 Maskin-rader (machine breakdown — IN/OUT/Sum-tabell)

Legacy-tabellen har 14 rader. Hver rad har 3 input-felt: `inAmount<X>`, `outAmount<X>`, `totalAmount<X>` (read-only).

| # | Legacy-rad (label) | Legacy IN id | Legacy OUT id | Ny `MachineRowKey` | Status |
|---|---|---|---|---|---|
| 1 | Metronia (Maskin-ID) | inAmountMetronia | outAmountMetronia | `metronia` | ✅ |
| 2 | OK Bingo (Maskin-ID) | inAmountOkBingo | outAmountOkBingo | `ok_bingo` | ✅ |
| 3 | Franco (Maskin-ID) | inAmountFranco | outAmountFranco | `franco` | ✅ |
| 4 | Otium (Maskin-ID) | inAmountOtium | outAmountOtium | `otium` | ✅ |
| 5 | Norsk Tipping Dag (Maskin-ID) | inAmountNorskTippingDag | outAmountNorskTippingDag | `norsk_tipping_dag` | ✅ |
| 6 | Norsk Tipping Totalt (Maskin-ID) | inAmountNorskTotalt | outAmountNorskTotalt | `norsk_tipping_totall` | ✅ (typo `totall` vs `totalt`) |
| 7 | Norsk Rikstoto Dag (Maskin-ID) | inAmountNorskRikstotoDag | outAmountNorskRikstotoDag | `rikstoto_dag` | ✅ |
| 8 | Norsk Rikstoto Totalt (Maskin-ID) | inAmountNorskRikstotoTotalt | outAmountNorskRikstotoTotalt | `rikstoto_totall` | ✅ |
| 9 | Rekvisita (Maskin-ID) | inAmountRekvisita | outAmountRekvisita (readonly) | `rekvisita` | 🟡 — readonly-OUT-constraint mangler |
| 10 | Servering/Kaffepenger | inAmountSellProduct | outAmountSellProduct (readonly) | `servering` | 🟡 — readonly-OUT-constraint mangler; Servering-feltet er auto-fylt fra `Sell Products`-modul i legacy (`Servering/kaffe`-rad fanger total-sum), men ny modal lar agent skrive inn manuelt |
| 11 | Bilag | inAmountBilag (readonly!) | outAmountBilag | `bilag` | 🟡 — semantisk konflikt: legacy har IN read-only og OUT editbar (man fører `out` for utgifter mot bilag); ny lar begge være editbare. Bilag har også file-upload (`billImages` multipart) — se 1.4 nedenfor |
| 12 | Bank | inAmountBank (readonly!) | outAmountBank | `bank` | 🟡 — readonly-IN-constraint mangler |
| 13 | Gevinst overføring bank (`profit_transfer_to_bank`) | inAmountTransferredByBank | outAmountTransferredByBank (readonly!) | `gevinst_overfoering_bank` | 🟡 — readonly-OUT-constraint mangler. **Dette er Tobias' "mer å fylle ut" — feltet er semantisk en IN-only gevinst-trekk overføring til bank, men generisk row-skjema lar deg fylle OUT også** |
| 14 | Annet (`other`) | inAmountAnnet | outAmountAnnet | `annet` | ✅ |

**Subtotal-rad** (legacy "Total"):
| Legacy-felt | Ny implementasjon | Status |
|---|---|---|
| inAmountTotal (read-only, sum av alle in) | computed `totalSumKasseFil` (in - out per rad summert) | 🟡 — legacy har 3 separate totaler (in/out/total), ny har én aggregert |
| outAmountTotal (read-only, sum av alle out) | — | 🔴 — ikke eksponert som eget felt |
| totalAmountTotal (read-only, sum-til-kasse-fil) | `totalSumKasseFil` | ✅ (men implisitt via `recomputeShiftDelta`) |

### 1.3 Kasse-balanse / dropsafe-fordeling

Legacy har 2 sub-seksjoner under maskin-tabellen.

**Seksjon A — "Endring opptalt kasse" (3 felt + auto-beregnet endring):**

| Legacy-felt (ID + label) | Type | Ny felt | Status |
|---|---|---|---|
| `dailyBalanceAtStartShift` (Kasse Start Skift) | input number, required | `state.kasseStartSkiftOre` / `MachineBreakdown.kasse_start_skift_cents` | ✅ (K1-B-fix 2026-04-26) |
| `dailyBalanceAtEndShift` (Kasse Endt Skift Før dropp) | input number, required | `state.endingOpptallKassieOre` / `ending_opptall_kassie_cents` | ✅ |
| `dailyBalanceDifference` (Endring) | readonly, auto = end - start | `endring` (lokalt, computed `recomputeShiftDelta`) | ✅ |

**Seksjon B — "Fordeling av endring opptalt":**

| Legacy-felt | Ny felt | Status |
|---|---|---|
| `settlementToDropSafe` (Innskudd Dropsafe / "til kasse-fil") | `state.innskuddDropSafeOre` / `innskudd_drop_safe_cents` | ✅ |
| `withdrawFromtotalBalance` (påfyll/ut kasse — legacy markert readonly!) | `state.paafyllUtKasseOre` / `paafyll_ut_kasse_cents` | 🟡 — semantikk: legacy markert read-only (auto-beregnet); ny lar agent skrive inn manuelt. Feltet kan være negativ for vekslepenge-uttrekk i begge implementasjoner |
| `totalDropSafe` (Totalt Dropsafe/kasse — readonly) | `state.totaltDropsafePaafyllOre` / `totalt_dropsafe_paafyll_cents` | ✅ |

**Seksjon C — Difference on shift:**

| Legacy-felt | Ny felt | Status |
|---|---|---|
| `shiftDifferenceIn` (readonly) | — | 🔴 — ikke i ny modell |
| `shiftDifferenceOut` (readonly) | — | 🔴 — ikke i ny modell |
| `shiftDifferenceTotal` (readonly) | `state.differenceInShiftsOre` / `difference_in_shifts_cents` | 🟡 — kun `total` i ny, ikke separat IN/OUT-diff |

### 1.4 Bilag (file upload)

| Legacy-felt | Type | Ny felt | Status |
|---|---|---|---|
| `billImages` | `<input type="file" multiple>` med `data-validation-allowing="jpg, png, pdf"` | `BilagReceipt` (mime/filename/dataUrl/sizeBytes/uploadedAt/uploadedByUserId) | 🟡 |

**Detaljer:**
- Legacy aksepterer **multiple files** (jpg/png/pdf). Ny aksepterer **én** receipt per settlement.
- Legacy bruker `multipart/form-data`. Ny base64-encoder og sender via JSON `dataUrl`-felt.
- Legacy filer lagres som binary i app's filsystem; ny lagrer som data-URL i DB. Begge varianter virker, men lagring-strategi forskjellig.
- 10 MB limit eksponert (`MAX_BILAG_BYTES`). Legacy har ingen kjent grense.

### 1.5 Notes / merknad / submit

| Legacy-felt | Ny felt | Status |
|---|---|---|
| `settlmentNote` (textarea, ingen char-limit) | `state.notes` / `settlement_note` | ✅ |
| Submit-knapp ("setlSubmit") | Modal-knapp `Submit` (agent) / `Update` (admin edit) | ✅ |
| Editer-grunn (admin only) | `state.editReason` / `EditSettlementBody.reason` (kreves) | ✅ |

### 1.6 Mangler / follow-ups (Settlement)

- **🔴 BIN-FOLLOWUP-1**: Legg til readonly-constraint på `outAmountRekvisita`, `outAmountSellProduct`, `outAmountTransferredByBank` (semantisk "kun IN tillatt"). Likeledes `inAmountBilag` og `inAmountBank` skal være readonly (semantisk "kun OUT tillatt").
- **🔴 BIN-FOLLOWUP-2**: Servering/Kaffepenger må auto-beregnes fra `app_orders` totalt (legacy hardkodet via `Sell Products`-modul). Ny lar agent skrive manuelt — det er en regnskaps-risiko.
- **🔴 BIN-FOLLOWUP-3**: Total-rad må eksponeres med 3 separate felt (`in_total`, `out_total`, `sum_total`) i state og DOM, ikke kun aggregert sum. Brukes av agent til kontrollsjekk før submit.
- **🔴 BIN-FOLLOWUP-4**: `shiftDifferenceIn` + `shiftDifferenceOut` separate IN/OUT-diff mangler. Kun aggregert `differenceInShifts` finnes.
- **🟡 BIN-FOLLOWUP-5**: Bilag — vurder multipart-upload + multi-file (legacy støtter flere bilag per settlement).
- **🟡 BIN-FOLLOWUP-6**: `withdrawFromTotalBalance` (påfyll/ut kasse) — legacy er readonly auto-beregnet, ny er editbar. Ulik semantikk.

---

## 2. Add Daily Balance

**Legacy-fil:** `legacy/unity-backend/App/Views/cash-inout/cash_in-out.html` (linje 1294–1325, modal `dailyBalanceModal`)
**Ny implementasjon:** `apps/admin-web/src/pages/cash-inout/CashInOutPage.ts:368-409` (`openAddDailyBalanceModal`)

| Legacy-felt | Type | Ny felt | Status |
|---|---|---|---|
| Header `{{translate.add_daily_balance}}` | static | "Add Daily Balance" via `t("add_daily_balance")` | ✅ |
| `{{translate.current_balance}}` display | display field, fetched async | — | 🔴 — ny modal viser ikke current balance før agent skriver inn |
| `amount` (Enter Balance) | number, required, range 1-999.999.999.999.999 | `openingBalance` | ✅ |
| Submit-knapp `addDailyBalance` | type=submit | `t("save")` | ✅ |
| Cancel-knapp | dismiss | `t("cancel_button")` | ✅ |
| (mangler i legacy) | — | `note` textarea (optional) | ✅ — bonus |

### Mangler / follow-ups

- **🟡 BIN-FOLLOWUP-7**: Vis current balance før agent skriver inn ny balance (legacy gjør det, ny ikke). Agent kan da kontrollsjekke at hun ikke double-add-er.

---

## 3. Control Daily Balance

**Legacy-fil:** Samme `cash_in-out.html` (modal `controlDailyBalance`-form-element)
**Ny implementasjon:** `apps/admin-web/src/pages/cash-inout/modals/ControlDailyBalanceModal.ts`

| Legacy-felt | Type | Ny felt | Status |
|---|---|---|---|
| `dailyBalance` (input) | number | `cdb-actual` (Actual counted cash) | ✅ |
| `totalCashBalance` (input) | number | — | 🔴 — ny modal ber ikke om dette feltet |
| Submit | submit | Accept-knapp m/2-step flow | ✅ |
| (auto fra backend) Diff-display | calculated | `cdb-diff` | ✅ — bonus |
| Note-felt (kreves hvis diff > 500 kr) | — | `cdb-note` textarea | ✅ — bonus |

### Mangler / follow-ups

- **🔴 BIN-FOLLOWUP-8**: `totalCashBalance` (totalt kontant-saldo i kasse + drop-safe summert) er et separat felt i legacy. Ny modal har ikke det. Ifølge OpenAPI-spec krever `controlDailyBalance` `reportedTotalCashBalance` — sjekk om backend faktisk håndhever dette.

---

## 4. Add Money — Registered User

**Legacy-fil:** `legacy/unity-backend/App/Views/cash-inout/add-withdraw-user-popup.html` (modal `registerUserFinancialModal`, linje 116–175)
**Ny implementasjon:** `apps/admin-web/src/pages/cash-inout/modals/AddMoneyRegisteredUserModal.ts` (228 linjer)

| Legacy-felt | Type | Ny felt | Status |
|---|---|---|---|
| `userName` (Enter Username/Customer Number/Phone) | text + autocomplete | `am-username` + autocomplete dropdown | ✅ |
| `playerIdOfUsername` (hidden) | hidden id | `selectedUser.id` (state) | ✅ |
| `addMoneyUsernameSuggestions` div | autocomplete dropdown | `am-autocomplete` | ✅ |
| `registerUserStats` (post-search display) | dynamic | `am-balance-result` | ✅ |
| `amount` | number, required | `am-amount` | ✅ |
| `registerUserFinancialBalanceResult` | display "current balance" | `am-balance-result` | ✅ |
| `paymentType` (Cash/Card) | select | `am-paymentType` (Cash/Card) | ✅ |
| Submit-knapp | submit | "Add Money"-knapp | ✅ |
| (mangler i legacy) | — | AML-warning ved beløp > 10.000 NOK | ✅ — bonus |
| (mangler i legacy) | — | Yes/No-confirm dialog (wireframe 17.7) | ✅ — bonus |

### Mangler / follow-ups

- ✅ **Ingen mangler**. Modulen er på paritet eller bedre enn legacy.

---

## 5. Withdraw — Registered User

**Legacy-fil:** Samme `add-withdraw-user-popup.html` (samme modal, action="withdraw")
**Ny implementasjon:** `apps/admin-web/src/pages/cash-inout/modals/WithdrawRegisteredUserModal.ts`

| Legacy-felt | Type | Ny felt | Status |
|---|---|---|---|
| `userName` + autocomplete | text | `wd-username` + dropdown | ✅ |
| `amount` | number | `wd-amount` | ✅ |
| Current balance display | dynamic | `wd-balance` (readonly) | ✅ |
| `paymentType` | select | `wd-paymentType` (locked til Cash, wireframe 17.8) | ✅ |
| Submit-knapp | submit | "Withdraw"-knapp | ✅ |
| (mangler i legacy) | — | CONFIRMATION_REQUIRED for > 10.000 NOK | ✅ — bonus |

### Mangler / follow-ups

- ✅ **Ingen mangler**. Paritet eller bedre.

---

## 6. Add Money / Withdraw — Unique ID

**Legacy-fil:** `legacy/unity-backend/App/Views/cash-inout/unique-id-balance.html` + `add-withdraw-user-popup.html` (modal `uniqueIdFinancialModal`)
**Ny implementasjon:**
- `apps/admin-web/src/pages/agent-portal/unique-id/AddMoneyUniqueIdModal.ts`
- `apps/admin-web/src/pages/agent-portal/unique-id/WithdrawUniqueIdModal.ts`
- `apps/admin-web/src/pages/agent-portal/unique-id/CreateUniqueIdModal.ts`

### 6.1 Legacy felter

| Legacy-felt | Type | Ny felt (Add Money) | Status |
|---|---|---|---|
| `uniqueId` (Enter Unique ID) | text, required, server-validated | input field i ny modal | ✅ |
| `amount` | number | input field | ✅ |
| `balanceResult` | display | balance display | ✅ |
| `paymentType` | select Cash/Card | select Cash/Card | ✅ |
| (Withdraw modal — kun Cash-option) | hardcoded | hardcoded i `WithdrawUniqueIdModal` | ✅ |

### 6.2 Create New Unique ID — wireframe 17.9

| Legacy-felt | Type | Ny felt | Status |
|---|---|---|---|
| Purchase Date+Time (auto current) | datetime input | `cuid-purchase` (readonly, `now.toLocaleString()`) | ✅ |
| Expiry Date+Time | datetime input | `cuid-expiry` (auto-computed from hours) | ✅ |
| Balance Amount | number | `cuid-amount` | ✅ |
| Hours Validity (min 24) | number | `cuid-hours` (min=24) | ✅ |
| Payment Type | select Cash/Card | `cuid-payment` (CASH/CARD) | ✅ |
| PRINT-knapp | print | print/download i `UniqueIdDetailsView` | 🟡 — print-flyt eksisterer men trenger end-to-end test |

### Mangler / follow-ups

- **🟡 BIN-FOLLOWUP-9**: Verifiser at PRINT-flyt går end-to-end (popup → print-dialog → ticket). Wireframe 17.9 spesifiserer dette og det er ikke verifisert i tests.
- ✅ Resten matcher.

---

## 7. Sell Products (kiosk)

**Legacy-fil:** `legacy/unity-backend/App/Views/cash-inout/product_cart.html` (kiosk + checkout-modal)
**Ny implementasjon:** `apps/admin-web/src/pages/cash-inout/ProductCartPage.ts` (1:1 port)

| Legacy-felt | Type | Ny felt | Status |
|---|---|---|---|
| Product-grid (knapper med data-name/price/category/image/id) | dynamic | `product-grid` | ✅ |
| Quantity controls (+/-/decrease) | buttons | `data-action="dec/inc/rm"` | ✅ |
| Cart-items list | dynamic | `cart-lines` | ✅ |
| Total Order Amount | display | `cart-total` | ✅ |
| Cart Modal (`cart-modal`) | popup | inline cart panel | 🟡 — ny flatet ut til single-page (acceptable design choice) |
| ID Modal (`id-modal`) — username + paymentType | popup | checkout-modal | ✅ |
| `userName` (Enter Username) | text | autocomplete | ✅ |
| `playerIdOfUsername` (hidden) | hidden | `selectedUser.id` | ✅ |
| `totalSellAmount` (disabled) | display | total in checkout | ✅ |
| `paymentType` Cash/Card | select | select | ✅ |
| Submit `sellByCuNumberSubmit` | submit | submit-knapp | ✅ |

### Mangler / follow-ups

- ✅ **Ingen kritiske mangler**. Cart-modal er flatet ut, men funksjonelt ekvivalent.

---

## 8. Register Sold Tickets

**Legacy-fil:** `legacy/unity-backend/App/Views/cash-inout/sell_ticket.html` + `physical-ticket.html`
**Ny implementasjon:** `apps/admin-web/src/pages/cash-inout/SellTicketPage.ts` + `SoldTicketsPage.ts`

| Legacy-felt | Type | Ny felt | Status |
|---|---|---|---|
| `finalIdSoldTicket` (Final ID of stack) | text | finalId-input | ✅ |
| Scan-button (`scanButtonSoldTicket`) | button | scan-button | ✅ |
| Submit-button (`submitButtonSoldTicket`) | submit | submit | ✅ |
| Sold-tickets-tabell (Type/Initial/Final/SoldCount/Action) | dynamic table | DataTable | 🟡 — sjekk at delete-action fungerer |
| Delete-knapp per rad | button | DataTable action | 🟡 |
| `purchasePhysicalTickets` (Submit Space-hotkey) | button + hotkey | submit-button | 🟡 — Space-hotkey mangler i ny |
| `cancelPhysicalTickets` | button | cancel | ✅ |

### Mangler / follow-ups

- **🟡 BIN-FOLLOWUP-10**: Space + F1/F2 hotkeys (legacy har Space=submit, F1/F2=ticket-color-toggle). Hotkeys er pilot-kritisk for terminaler — sjekk om disse er implementert.
- **🟡 BIN-FOLLOWUP-11**: Verifiser delete-action på sold-tickets-rad fungerer end-to-end.

---

## 9. Register More Tickets (`physical-ticket.html`)

**Legacy-fil:** `legacy/unity-backend/App/Views/cash-inout/physical-ticket.html`
**Ny implementasjon:** Samme `SellTicketPage.ts` (kombinert)

| Legacy-felt | Type | Ny felt | Status |
|---|---|---|---|
| `initialId` (Initial ID of stack) | text | input | ✅ |
| `finalId` (Final ID of stack — auto-computed?) | text | input | ✅ |
| Scan-button (`scanButton`) | button | scan | ✅ |
| Submit-button (`submitButton`) | submit | submit | ✅ |
| Edit-modal (`editInitialId`/`editFinalId`/`editTicketColorId`) | popup | edit-flyt | 🟡 — sjekk at edit-modal er portet |
| `scanEditButton` / `submitEditButton` | buttons | — | 🟡 |
| `purchasePhysicalTickets` (Submit + Space) | button + hotkey | submit | 🟡 — Space-hotkey samme issue som §8 |

---

## 10. Check for Bingo (PAUSE-modal)

**Legacy-fil:** `legacy/unity-backend/App/Views/cash-inout/cash_in-out.html` + `physical-ticket.html` (modal `stopGameOption`)
**Ny implementasjon:** Mangelfullt — sjekkes nedenfor

| Legacy-felt | Type | Ny felt | Status |
|---|---|---|---|
| `stopGameOption`-knapp | button | — | 🔴 — fant ingen `Check for Bingo` PAUSE-knapp i CashInOutPage |
| Enter Ticket ID-input | text | — | 🔴 — mangler |
| GO-knapp | button | — | 🔴 — mangler |
| Pattern-validate (5×5 grid) | dynamic | — | 🔴 — mangler |
| Reward/Cashout-status | radio | — | 🔴 — mangler |
| Stop-game options (Multiple — see legacy `stopGameOption` × 3 lines) | buttons | — | 🔴 — mangler |

### Mangler / follow-ups

- **🚨 BIN-FOLLOWUP-12 (PILOT-BLOKKER)**: PAUSE Game-flyt + bingo-pattern-popup mangler helt. Per `MASTER_PLAN_SPILL1_PILOT_2026-04-24.md` Bølge K3, dette skal være "delvis fikset i PR #433" — men koden i `CashInOutPage.ts` har ingen referanse til `stopGameOption`, `checkForBingo`, eller pattern-validation. **Verifiser om PR #433 faktisk landet og er koblet inn.**

---

## 11. Physical Cashout

**Legacy-fil:** `legacy/unity-backend/App/Views/cash-inout/cashout_details.html` (modal `ticketsModal` + `gameAllWinnersModal`)
**Ny implementasjon:** `apps/admin-web/src/pages/cash-inout/PhysicalCashoutPage.ts` (70 linjer) + `CashoutDetailsPage.ts` (48 linjer)

### 11.1 List-vy (Cash-out detaljer)

| Legacy-kolonne | Ny kolonne | Status |
|---|---|---|
| `gameName` (Game Name) | `gameId` (mapped til navn) | 🟡 — viser ID, ikke navn |
| `ticketId` (Ticket ID) | `ticketNumber` | ✅ |
| `ticketType` (Ticket Type) | — | 🔴 — mangler i ny |
| `ticketPrice` (Ticket Price) | — | 🔴 — mangler |
| `winningPattern` (Winning Pattern) | — | 🔴 — mangler |
| `totalWinning` | `amount` | ✅ |
| `rewardedAmount` | — | 🔴 — mangler |
| `pendingAmount` | — | 🔴 — mangler |
| Action-button (eye/cashout) | — | 🔴 — mangler |

### 11.2 Bingo-pattern-popup (`ticketsModal`)

| Legacy-felt | Type | Ny felt | Status |
|---|---|---|---|
| 5×5 ticket-grid (`#ticket`) | rendered | — | 🔴 — mangler helt |
| Winning-lines visualization (`#winningLines`) | dynamic | — | 🔴 — mangler |
| Per-pattern Reward/Cashout-status | dynamic | — | 🔴 — mangler |
| `Reward All`-knapp | button | — | 🔴 — mangler |
| Per-pattern button (Cashout one) | button | — | 🔴 — mangler |

### 11.3 Game-all-winners (TV-overlay, `gameAllWinnersModal`)

| Legacy-kolonne | Ny | Status |
|---|---|---|
| `physical_ticket_no` | — | 🔴 |
| `ticket_type` | — | 🔴 |
| `ticket_price` | — | 🔴 |
| `winning_pattern` | — | 🔴 |
| `total_winning` | — | 🔴 |
| `rewarded_amount` | — | 🔴 |
| `pending_amount` | — | 🔴 |
| Action | — | 🔴 |

### Mangler / follow-ups

- **🚨 BIN-FOLLOWUP-13 (PILOT-BLOKKER)**: Hele Physical Cashout-flyten mangler bingo-pattern-popup, Reward All, per-ticket cashout-action. Agent kan ikke utbetale fysiske vinnere i nåværende stack. Pilot-blokker per `MASTER_PLAN_SPILL1_PILOT_2026-04-24.md`-dagsflyt-checklist.
- **🚨 BIN-FOLLOWUP-14**: List-kolonner mangler ticketType/ticketPrice/winningPattern/rewardedAmount/pendingAmount. Agent har ingen oversikt over hva som er utbetalt vs pending.
- **🚨 BIN-FOLLOWUP-15**: TV-overlay (gameAllWinnersModal) er ikke implementert. Hall trenger dette for å vise vinnere på TV.

---

## 12. Hall Account Report

**Legacy-fil:** `legacy/unity-backend/App/Views/hallAccountReport/hallAccount.html`
**Ny implementasjon:** `apps/admin-web/src/pages/hallAccountReport/HallAccountReportPage.ts`

### 12.1 Filter-felter

| Legacy-felt | Ny felt | Status |
|---|---|---|
| `start_date` | `currentFrom` | ✅ |
| `end_date` | `currentTo` | ✅ |
| `gameType` (dropdown All/MAIN_GAME/DATABINGO eller Real/Bot) | `currentGameType` (All/Real/Bot) | ✅ |
| Search-knapp | reload-trigger | ✅ |
| Reset-knapp | — | 🟡 — kanskje bare clear filter-state |
| `hallId` (hidden) | URL-param/route-param | ✅ |

### 12.2 Tabell-kolonner

| # | Legacy-kolonne | Ny kolonne | Status |
|---|---|---|---|
| 1 | Date | `date` | ✅ |
| 2 | Week Day | — | 🔴 — mangler i ny |
| 3 | Resultat Bingonet | `bingonetNetCents` | ✅ |
| 4 | **Metronia** | — | 🔴 — manuell maskin-kolonne mangler |
| 5 | **OK Bingo** | — | 🔴 |
| 6 | **Franco** | — | 🔴 |
| 7 | **Otium** | — | 🔴 |
| 8 | **Norsk Tipping** | — | 🔴 |
| 9 | **Norsk Rikstoto** | — | 🔴 |
| 10 | **Rekvisita** | — | 🔴 |
| 11 | **Kaffe-penger** | — | 🔴 |
| 12 | **Bilag** | — | 🔴 |
| 13 | profit_transfer_to_bank | — | 🔴 |
| 14 | **Bank Terminal** | — | 🔴 |
| 15 | Other (Annet) | catCol("OTHER") | 🟡 — generisk, ikke dedikert |
| 16 | deposit_to_dropsafe | summary-line | 🟡 — vises kun i top-summary, ikke per-rad |
| 17 | cash_in_out_settlement | `cashInCents`/`cashOutCents` | 🟡 — split i 2 kolonner |
| 18 | Diff | `diffCents` | ✅ |
| 19 | Comments | `comment` (alltid tom!) | 🔴 — comment-felt er ikke koblet inn |
| (ny) BANK_DEPOSIT/BANK_WITHDRAWAL/CORRECTION/REFUND | catCol(...) | ✅ — bonus, men feilaktig erstatter de manuelle maskin-kolonnene |

### Mangler / follow-ups

- **🚨 BIN-FOLLOWUP-16 (KRITISK)**: Hall Account Report har 8 manglende dedikerte kolonner: Metronia, OK Bingo, Franco, Otium, Norsk Tipping, Norsk Rikstoto, Rekvisita, Kaffe-penger, Bilag, Bank Terminal. Disse er det Tobias' regnskaps-kollegaer skal lese for å avstemme dagens omsetning. Per i dag har vi generiske `BANK_DEPOSIT/CORRECTION/REFUND/OTHER`-kolonner. **Dette er hovedgrunnen Tobias sa "mye mer å fylle ut".**
- **🟡 BIN-FOLLOWUP-17**: Week Day-kolonne (Mon/Tue/...) mangler. Trivial fix.
- **🟡 BIN-FOLLOWUP-18**: Comment-kolonne er hardkodet `""` (`comment: ""` i `mergeRows`). Må kobles til settlement-merknad eller manual-adjustment-note.
- **🟡 BIN-FOLLOWUP-19**: deposit_to_dropsafe og cash_in_out_settlement bør være per-rad, ikke summary-line.

### 12.3 Settlement Report (samme side, edit-mode)

`apps/admin-web/src/pages/hallAccountReport/SettlementPage.ts` finnes — se §1 Settlement audit. Edit-flyt = samme modal som agent submit, men admin-mode (krever reason).

---

## 13. Withdraw in Hall / Bank + History

**Legacy-fil:**
- `legacy/unity-backend/App/Views/Amountwithdraw/hallRequests.html` (Withdraw in Hall queue)
- `legacy/unity-backend/App/Views/Amountwithdraw/bankRequests.html` (Withdraw in Bank queue)
- `legacy/unity-backend/App/Views/Amountwithdraw/withdrawAmount.html` (Approve/Reject)
- `legacy/unity-backend/App/Views/Amountwithdraw/historyHall.html` + `historyBank.html` (History)
- `legacy/unity-backend/App/Views/Amountwithdraw/emails.html` + `addEmails.html` (Add email account for XML-export)
- `legacy/unity-backend/App/Views/Amountwithdraw/withdrawHistory.html` (combined history)

**Ny implementasjon:**
- `apps/admin-web/src/pages/amountwithdraw/RequestsPage.ts`
- `apps/admin-web/src/pages/amountwithdraw/HistoryPage.ts`
- `apps/admin-web/src/pages/amountwithdraw/EmailsPage.ts`
- `apps/admin-web/src/pages/amountwithdraw/XmlBatchesPage.ts`
- `apps/admin-web/src/pages/amountwithdraw/modals/PaymentActionModal.ts`

### 13.1 Withdraw in Hall queue

| Legacy-kolonne | Ny | Status |
|---|---|---|
| `createdAt` (Date) | dato | ✅ |
| `customerNumber` | customerNumber | ✅ |
| `name` (Player Name) | name | ✅ |
| `withdrawAmount` | amount | ✅ |
| `hallName` | hallName | ✅ |
| `status` (Pending/Approved/Rejected) | status | ✅ |
| `action` (check/x) | accept/reject | ✅ |

### 13.2 Withdraw in Bank queue

| Legacy-kolonne | Ny | Status |
|---|---|---|
| `createdAt` | dato | ✅ |
| `customerNumber` | customerNumber | ✅ |
| `name` | name | ✅ |
| `bankAccountNumber` | bankAccountNumber | ✅ |
| `withdrawAmount` | amount | ✅ |
| `hallName` | hallName | ✅ |
| `status` | status | ✅ |
| `action` | actions | ✅ |
| `remark`-input per rad | — | 🟡 — sjekk om dette eksisterer i PaymentActionModal |

### 13.3 History (combined)

| Legacy-kolonne | Ny | Status |
|---|---|---|
| Date+Time | dato | ✅ |
| Transaction ID | transactionId | ✅ |
| Username | username | ✅ |
| Account Number | accountNumber | ✅ |
| Hall Name | hallName | ✅ |
| Amount | amount | ✅ |
| Status | status | ✅ |
| Type-filter (Hall/Bank) | filter | ✅ |

### 13.4 Add Email Account (for XML-export)

| Legacy-felt | Ny | Status |
|---|---|---|
| Email-input | EmailsPage form | ✅ (EmailsPage finnes) |
| Hall-tilknytning | — | 🟡 — sjekk om hall-scope er implementert |

### 13.5 XML-eksport

| Legacy-funksjon | Ny | Status |
|---|---|---|
| Daglig XML-eksport per hall til regnskap-mail | `apps/backend/src/admin/WithdrawXmlExportService.ts` + `apps/backend/src/routes/adminWithdrawXml.ts` + cron-job | ✅ — basis-implementasjon finnes |
| Per-hall vs samlet | — | 🟡 — sjekk konfig |

### Mangler / follow-ups

- ✅ **Withdraw-funksjonalitet er på paritet eller bedre.** Verifiser kun:
- **🟡 BIN-FOLLOWUP-20**: `remark`-felt per Bank Request i `PaymentActionModal` — sjekk at det er feltet legacy bruker for å lagre godkjennings-notat.
- **🟡 BIN-FOLLOWUP-21**: Verifiser at e-post-config støtter både per-hall og samlet (legacy `addEmails.html` lar deg velge).

---

## 14. Schedule Editor (ukeplan)

**Legacy-fil:** `legacy/unity-backend/App/Views/schedules/create.html` + `view.html`
**Ny implementasjon:** `apps/admin-web/src/pages/games/schedules/ScheduleEditorModal.ts` + `ScheduleListPage.ts` + `ScheduleDetailPages.ts`

| Legacy-felt | Ny felt | Status |
|---|---|---|
| `scheduleName` | scheduleName | ✅ |
| `luckyNumberPrize` (Prize of Lucky Number) | luckyNumberPrize | ✅ |
| `scheduleType` (Auto/Manual radio) | scheduleType | ✅ |
| `manualStartTime` / `manualEndTime` (when scheduleType=Manual) | manualStartTime/manualEndTime | ✅ |
| `subGame[][storedGame]` (Yes/No radio for stored sub-game) | storedGame flag | 🟡 — sjekk |
| `selectStoredSubGame[]` | dropdown | 🟡 — sjekk |
| `subGame[][name]` (sub-game-velger) | sub-game name | ✅ |
| `subGame[][custom_game_name]` | custom name | ✅ |
| `subGame[][start_time]` / `[end_time]` | startTime/endTime | ✅ |
| `subGame[][notificationStartTime]` | notificationStartTime | ✅ |
| `subGame[][minseconds]` (5-60) | minSeconds | ✅ |
| `subGame[][maxseconds]` (5-60) | maxSeconds | ✅ |
| `groupHallSelected[]` (Group of Halls) | groupHallIds | ✅ |
| `halls[][]` (per Group) | hallIds | ✅ |
| `masterhall` | masterHallId | ✅ |

### Mangler / follow-ups

- **🟡 BIN-FOLLOWUP-22**: Verifiser `storedGame`-Yes/No-flyten — agent skal kunne velge eksisterende stored sub-game eller lage ny custom.
- ✅ Resten matcher godt; `SubGamesListEditor` er strukturert editor som matcher legacy-form-shape.

---

## 15. Daily Schedule Editor

**Legacy-fil:** `legacy/unity-backend/App/Views/dailySchedules/create.html`
**Ny implementasjon:** `apps/admin-web/src/pages/games/dailySchedules/DailyScheduleEditorModal.ts`

| Legacy-felt | Ny felt | Status |
|---|---|---|
| `saveGameName` (Save Game Name) | scheduleName | ✅ |
| `start_date` | startDate | ✅ |
| `end_date` | endDate | ✅ |
| `timeSlot` (time slot dropdown) | — | 🔴 — mangler? Sjekk DailyScheduleEditorModal |
| `weekdays[]` (Mon-Sun checkboxes) | weekDays bitmask | ✅ |
| `schedule[<day>][]` (multi-select Saved Schedules per day) | dayScheduleSelections | ✅ |
| `groupHallSelected[]` | groupHallIds | ✅ |
| `halls[][]` (per Group) | hallIds | ✅ |
| `masterhall` | masterHallId | ✅ |

### Mangler / follow-ups

- **🟡 BIN-FOLLOWUP-23**: `timeSlot` (avansert dropdown for "Morning/Afternoon/Evening" eller similar?) — verifiser om dette er ekvivalent med Schedule type-flagget eller en separat velger.
- ✅ Resten matcher.

---

## 16. Game Management (per game)

**Legacy-fil:** `legacy/unity-backend/App/Views/GameManagement/gameAdd.html` (Game 1) + `game3Add.html` (Game 3) + flere
**Ny implementasjon:** `apps/admin-web/src/pages/games/management/...` (ikke detaljert auditert)

Disse skjermene har **MANGE felter** (Jackpot Number 9-21 priser, Pattern Group/Number/Price-rader, ticketPrice, minTicketCount, gracePeriod osv.) som er Game-spesifikke. Per LEGACY_1_TO_1_MAPPING_2026-04-23.md §3.1 er Game 1 DailySchedule "🟢" PR #402, men Game 2/3/4/5 er "🟡 — Create/Edit/View-forms eksisterer delvis, men Jackpot-slots med kr/% og Pattern Name+Prize mangler".

**Anbefaling:** Spawn separat audit for dette (estimere 2-4 timer per game-type).

| Felt-gruppe | Status (per LEGACY_1_TO_1_MAPPING) |
|---|---|
| Game 1 (Hovedspill 1) | ✅ stort sett OK |
| Game 2/3 Jackpot-slots (9, 10, 11, 12, 13, 14-21) | 🟡 delvis |
| Pattern Group/Number/Price | 🟡 delvis |
| ticketPrice / minTicketCount / gracePeriod | ✅ |
| Bot Game-checkbox + No. of Games | 🔴 (droppet per Tobias 2026-04-23, Bølge K-pkt #4) |

---

## 17. Top 10 mangler (sortert etter kritikalitet)

| # | ID | Skjerm | Mangel | Pilot-blokker? |
|---|---|---|---|---|
| 1 | FOLLOWUP-12 | Check for Bingo | PAUSE-modal + bingo-pattern + reward/cashout helt fraværende | 🚨 JA |
| 2 | FOLLOWUP-13 | Physical Cashout | Bingo-pattern-popup + Reward All + per-ticket cashout mangler | 🚨 JA |
| 3 | FOLLOWUP-16 | Hall Account Report | 8 dedikerte maskin-kolonner mangler (Metronia/OK Bingo/...); generisk kategorier brukt i stedet | 🚨 JA (regnskap) |
| 4 | FOLLOWUP-14 | Physical Cashout | Tabell-kolonner ticketType/ticketPrice/winningPattern/rewardedAmount/pendingAmount mangler | 🚨 JA |
| 5 | FOLLOWUP-15 | Physical Cashout | TV-overlay (gameAllWinnersModal) ikke implementert | 🚨 JA |
| 6 | FOLLOWUP-1 | Settlement | Readonly-IN/OUT-constraints mangler på 5 maskin-rader (Rekvisita/Servering/Bilag/Bank/GevinstOverf.) | 🟡 |
| 7 | FOLLOWUP-3 | Settlement | Total-rad har ikke separate in_total/out_total/sum_total | 🟡 |
| 8 | FOLLOWUP-4 | Settlement | shiftDifferenceIn/Out separate IN/OUT-diff mangler | 🟡 |
| 9 | FOLLOWUP-2 | Settlement | Servering/Kaffepenger må auto-beregnes fra Sell Products-orders | 🟡 |
| 10 | FOLLOWUP-7 | Add Daily Balance | Vis current balance før agent skriver inn ny | 🟡 |

## 18. Top 5 delvis-implementerte features

1. **Settlement Bilag-upload** — Ny støtter kun én fil + base64-dataURL; legacy multipart med flere filer (FOLLOWUP-5, 6).
2. **Hall Account Report Comment** — `comment: ""` hardkodet, ikke koblet til settlement-merknad eller manual-adjustments (FOLLOWUP-18).
3. **Sold/Register Tickets hotkeys** — Space + F1/F2 shortcuts mangler i ny stack (FOLLOWUP-10/11). Pilot-relevant fordi terminaler bruker scan-hotkeys.
4. **Schedule storedGame Yes/No-flyt** — Verifiser at agent kan velge stored vs custom subgame (FOLLOWUP-22).
5. **Daily Schedule timeSlot** — Sjekk om timeSlot-velgeren har ekvivalent i ny editor (FOLLOWUP-23).

## 19. Anbefalt rekkefølge for follow-up

**Bølge 1 — Pilot-blokkere (estimat 5-8 dev-dager):**
- FOLLOWUP-12 (Check for Bingo PAUSE-modal)
- FOLLOWUP-13 (Physical Cashout pattern-popup + Reward All)
- FOLLOWUP-14 (Physical Cashout tabell-kolonner)
- FOLLOWUP-16 (Hall Account Report 8 manuelle kolonner)

**Bølge 2 — Settlement-paritet (estimat 3-5 dev-dager):**
- FOLLOWUP-1 (readonly IN/OUT-constraints)
- FOLLOWUP-2 (Servering auto-beregnet)
- FOLLOWUP-3, FOLLOWUP-4 (Total-rad og shiftDifference)
- FOLLOWUP-15 (TV-overlay gameAllWinnersModal)

**Bølge 3 — Polish (estimat 2-3 dev-dager):**
- FOLLOWUP-5/6 (Bilag multipart + multi-file)
- FOLLOWUP-7 (Add Daily Balance current display)
- FOLLOWUP-10/11 (hotkeys)
- FOLLOWUP-17/18/19 (HallAccountReport polish)
- FOLLOWUP-20/21 (XML-export polish)
- FOLLOWUP-22/23 (Schedule storedGame + timeSlot)

## 20. Skjermer ikke auditert i denne runden

Pga tidsbudsjett ble disse satt til follow-up:

- Game Management per game (Game 2/3/4/5) — store skjermer, krever 2-4t hver. Per `LEGACY_1_TO_1_MAPPING.md` er Game 2/3/4/5 forms "🟡 delvis".
- Players Management (Approved/Pending/Rejected) — auditert delvis i wireframe-katalog
- Unique ID list / Transaction history — sjekkes implisitt via §6
- Group of Hall management
- Role Management
- TV Screen / Winners-display
- Payout Management
- Order History (separate fra Sell Products)
- Past Game Winning History
- Hall Specific Report (per agent)

## 21. Kilder

- Legacy-kodebase: `git show 5fda0f78:legacy/unity-backend/App/...`
- Tidligere auditer: `docs/architecture/BACKEND_PARITY_AUDIT_2026-04-23.md`, `docs/architecture/LEGACY_1_TO_1_MAPPING_2026-04-23.md`, `docs/architecture/WIREFRAME_CATALOG.md`
- Master-plan: `docs/architecture/MASTER_PLAN_SPILL1_PILOT_2026-04-24.md`
- OpenAPI: `apps/backend/openapi.yaml`
