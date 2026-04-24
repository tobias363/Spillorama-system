# Wireframe Gaps — Agent V1.0 PDF sider 16-17 (2026-04-24)

Kilde: `docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf` skjermbilder 16-17.

Dette dokumentet lister konkrete gaps mellom legacy V1.0-wireframes og nåværende
implementasjon i `apps/admin-web/src/pages/agent-portal/` + `apps/backend/src/agent/`.

---

## Gap #9 — Shift Log Out (PDF skjerm 17.6)

**Status:** Implementert i PR `feat/agent-shift-logout-checkboxes` (2026-04-24).

**Produktkrav (legacy wireframe):**

Når bingovert logger ut av skiftet, må popup-en støtte:

1. **Checkbox 1:** "Distribute winnings to physical players" — ved avhuking
   flagger systemet alle fysiske ventende gevinster slik at neste agent kan
   cashout.
2. **Checkbox 2:** "Transfer register ticket to next agent" — ved avhuking
   overføres usolgte bong-range til neste innlogging.
3. **"View Cashout Details"-link:** åpner modal med liste over pending
   cashouts for denne agenten.
4. **Confirm + Submit:** utfører logout med valgte flagg.

**Implementasjon:**

- Backend:
  - Migration `20260424153706_agent_shift_logout_flags.sql` legger til
    `distributed_winnings`, `transferred_register_tickets`, `logout_notes`
    på `app_agent_shifts`, `pending_for_next_agent` på
    `app_physical_ticket_pending_payouts`, og `transfer_to_next_agent` på
    `app_agent_ticket_ranges`.
  - `AgentShiftService.logout(agentUserId, flags)` + porter
    `ShiftPendingPayoutPort` / `ShiftTicketRangePort` i
    `apps/backend/src/agent/ports/ShiftLogoutPorts.ts`.
  - Routes:
    - `POST /api/agent/shift/logout` (body: `{ distributeWinnings?, transferRegisterTickets?, logoutNotes? }`)
    - `GET  /api/agent/shift/pending-cashouts` (for "View Cashout Details"-modal)
  - Audit: `agent.shift.logout`-entry med flagg + counts.

- Admin-web:
  - `AgentCashInOutPage.ts` rendrer "Shift Log Out"-knapp som åpner
    popup-modal med 2 checkboxer + notat + view-link.
  - `PendingCashoutsModal.ts` lister pending cashouts i tabell;
    CTA "Go to Physical Cashout" navigerer til
    `#/agent/physical-cashout`.

**Tester:**

- Backend: `AgentShiftService.logout.distributeWinnings.test.ts` (7),
  `AgentShiftService.logout.transferRegisterTickets.test.ts` (7),
  `AgentShiftService.logout.audit.test.ts` (3),
  `agentShiftLogout.routes.test.ts` (7) = **24 nye backend-tester**.
- Admin-web: `cashInOutShiftLogout.test.ts` (8),
  `pendingCashoutsModal.test.ts` (4) + 2 nye i
  `agentPortalSkeleton.test.ts` = **14 nye frontend-tester**.

**Backwards-compat:** `POST /api/agent/shift/end` fungerer uendret;
`POST /api/agent/shift/logout` uten body = samme effekt.

**Edge-cases:**

- Agent uten pending cashouts: "View Details"-modal viser tom-melding.
- Digital-only hall uten fysiske bonger: begge checkboxes er no-ops men
  tillates.
- Port-null (f.eks. testoppsett uten PT4-graf): shift-flagget settes
  fortsatt, men child-tabellen oppdateres ikke (log-only).
