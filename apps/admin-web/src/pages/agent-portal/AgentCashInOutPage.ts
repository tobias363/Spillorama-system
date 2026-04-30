// Agent-portal Cash In/Out Management — full V1.0 implementation per
// MASTER_PLAN_SPILL1_PILOT_2026-04-24.md K2 (wave 2): wires the legacy-ported
// CashInOutPage (under apps/admin-web/src/pages/cash-inout/) to
// /agent/cash-in-out — replaces the earlier minimal placeholder.
//
// What this mount does:
//   1. Renders the full `renderCashInOutPage` UI: 7-button cash-in/out grid,
//      daily-balance widget, Settlement / Control Daily Balance / Add Daily
//      Balance / slot-machine modals, F5/F6/F8 hotkeys.
//   2. Rewrites the shared cash-inout breadcrumb (which links back to the
//      admin-dashboard `#/admin`) so it points at the agent-portal landing
//      `#/agent/dashboard` instead. Tests assert this — see
//      agentPortalSkeleton.test.ts.
//   3. Appends agent-specific actions that are NOT in the admin-side
//      CashInOutPage:
//        - Register Sold Tickets (Wireframe Gap #4, PDF 15.2 / 17.15)
//        - Shift Log Out modal with checkboxer + "View Cashout Details"
//          (Wireframe Gap #9, PDF 17.6)
//
// The minimal placeholder version is REMOVED — `mountAgentCashInOut` now
// always renders the full page. The legacy alias `/agent/cashinout` is
// dispatched via `pages/cash-inout/index.ts` and keeps the admin-style
// breadcrumb (no agent extras) so admins/operators who land there see the
// canonical port.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { Modal } from "../../components/Modal.js";
import { ApiError } from "../../api/client.js";
import {
  agentShiftLogout,
  type AgentShiftLogoutFlags,
} from "../../api/agent-shift.js";
import { renderCashInOutPage } from "../cash-inout/CashInOutPage.js";
import { openPendingCashoutsModal } from "./PendingCashoutsModal.js";
import { openRegisterSoldTicketsModal } from "./modals/RegisterSoldTicketsModal.js";
import { openRegisterMoreTicketsModal } from "./modals/RegisterMoreTicketsModal.js";
import { escapeHtml } from "../../utils/escapeHtml.js";

// Module-level F1 hotkey handler — registered once per mount, removed when
// the container detaches from the DOM. We attach to `document` because the
// cash-inout page does not own focus directly (children like inputs do).
let f1HotkeyHandler: ((e: KeyboardEvent) => void) | null = null;

export function mountAgentCashInOut(container: HTMLElement): void {
  // 1. Render the canonical, legacy-ported cash-inout page (daily balance,
  //    settlement, slot machine, add/withdraw modals, F5/F6/F8 hotkeys).
  //    The 1:1 legacy layout already includes a "Logg ut skift"-knapp i
  //    page-actions-baren — vi wirer den her i agent-mountet, og legger
  //    Register Sold Tickets-knappen i en separat seksjon under siden.
  renderCashInOutPage(container);

  // 2. Rewrite the breadcrumb link from `#/admin` to `#/agent/dashboard`.
  //    The shared `contentHeader` helper hard-codes the admin path; we patch
  //    the DOM after render to keep agent-portal navigation consistent.
  const breadcrumbLink = container.querySelector<HTMLAnchorElement>(
    ".content-header .breadcrumb a[href='#/admin']",
  );
  if (breadcrumbLink) {
    breadcrumbLink.href = "#/agent/dashboard";
  }

  // 3. Wire Shift Log Out-knappen som ligger i 1:1 page-actions-baren.
  const shiftLogoutBtn = container.querySelector<HTMLButtonElement>(
    '[data-action="shift-log-out"]',
  );
  shiftLogoutBtn?.addEventListener("click", () => {
    openShiftLogoutModal();
  });

  // 4. Append agent-specific actions section (Register More + Register Sold
  //    Tickets) below siden. Shift Log Out er allerede plassert i
  //    page-actions-baren.
  appendAgentActionsSection(container);

  // 5. Wireframe PDF 17 §17.13: F1-hotkey åpner Register More Tickets-modal
  //    direkte uten å gå via Sold-modalen først. F2 inni Sold-modalen åpner
  //    også Register More — F1 her er den raske page-level-snarveien.
  installF1Hotkey(container);
}

/**
 * Page-level F1 hotkey: open Register More Tickets directly from the
 * cash-in-out main view (Wireframe PDF 17 §17.13). Skipped when any modal
 * is currently open so that F1 inside RegisterSoldTicketsModal (which
 * submits its own form) is not double-handled.
 *
 * The handler attaches to `document` and is removed via a MutationObserver
 * when the container detaches — same lifecycle pattern as F5/F6/F8 in
 * `cash-inout/CashInOutPage.ts`.
 */
function installF1Hotkey(container: HTMLElement): void {
  // Defensive: if a previous mount left a stale handler, remove it before
  // installing the new one. This avoids double-firing if mountAgentCashInOut
  // is called twice without an intermediate unmount (e.g. in tests).
  if (f1HotkeyHandler) {
    document.removeEventListener("keydown", f1HotkeyHandler);
    f1HotkeyHandler = null;
  }

  const handler = (e: KeyboardEvent): void => {
    if (e.key !== "F1") return;
    if (!container.isConnected) return;
    // Skip when a modal is open — RegisterSoldTicketsModal uses F1 as
    // submit-shortcut. Modal.ts adds `modal-open` to body while any
    // dialog is mounted, so this gate is reliable.
    if (typeof document !== "undefined" && document.body?.classList.contains("modal-open")) {
      return;
    }
    e.preventDefault();
    openRegisterMoreTicketsFromAgent();
  };
  f1HotkeyHandler = handler;
  document.addEventListener("keydown", handler);

  // Cleanup when the container detaches.
  const observer = new MutationObserver(() => {
    if (typeof document === "undefined") return;
    if (!container.isConnected) {
      if (f1HotkeyHandler) {
        document.removeEventListener("keydown", f1HotkeyHandler);
        f1HotkeyHandler = null;
      }
      observer.disconnect();
    }
  });
  if (typeof document !== "undefined" && document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

/**
 * Prompt for gameId (pilot pattern — same as Register Sold Tickets) and
 * open the Register More Tickets-modal. Senere PR henter gameId fra
 * NextGamePanel-staten eller en dropdown over pågående spill.
 */
function openRegisterMoreTicketsFromAgent(): void {
  const gameId = window.prompt(t("enter_game_id"));
  if (!gameId || !gameId.trim()) return;
  openRegisterMoreTicketsModal({
    gameId: gameId.trim(),
  });
}

function appendAgentActionsSection(container: HTMLElement): void {
  const section = document.createElement("section");
  section.className = "content";
  section.dataset.marker = "agent-cash-in-out-extra-actions";
  section.innerHTML = `
    <div class="box box-primary">
      <div class="box-header with-border">
        <h3 class="box-title">${escapeHtml(t("agent_cash_in_out_management"))}</h3>
      </div>
      <div class="box-body">
        <p>${escapeHtml(t("agent_cash_in_out_description"))}</p>
        <div class="btn-group-vertical" role="group" aria-label="cash-in-out-actions"
          data-marker="agent-cash-actions"
          style="display:flex; flex-direction:column; gap:8px; max-width:360px;">
          <button type="button" class="btn btn-warning"
                  data-marker="btn-register-more-tickets"
                  data-action="register-more-tickets"
                  title="${escapeHtml(t("register_more_tickets_hint"))}">
            <i class="fa fa-plus-square" aria-hidden="true"></i> ${escapeHtml(t("register_more_tickets_button"))} (F1)
          </button>
          <button type="button" class="btn btn-primary"
                  data-marker="btn-register-sold-tickets"
                  data-action="register-sold-tickets">
            <i class="fa fa-ticket" aria-hidden="true"></i> ${escapeHtml(t("register_sold_tickets_button"))}
          </button>
        </div>
      </div>
    </div>`;
  container.appendChild(section);

  const moreBtn = section.querySelector<HTMLButtonElement>(
    '[data-marker="btn-register-more-tickets"]',
  );
  moreBtn?.addEventListener("click", () => {
    openRegisterMoreTicketsFromAgent();
  });

  const registerBtn = section.querySelector<HTMLButtonElement>(
    '[data-marker="btn-register-sold-tickets"]',
  );
  registerBtn?.addEventListener("click", () => {
    // Pilot: prompt for gameId. Senere PR henter gameId fra NextGamePanel-
    // staten eller fra en dropdown over pågående spill.
    const gameId = window.prompt(t("enter_game_id"));
    if (!gameId || !gameId.trim()) return;
    openRegisterSoldTicketsModal({
      gameId: gameId.trim(),
    });
  });
}

/**
 * Åpner Shift Log Out-popupen per wireframe PDF 17.6:
 *   - 2 checkboxer (Distribute winnings / Transfer register tickets)
 *   - valgfritt notat-felt
 *   - "View Cashout Details"-lenke (åpner sekundær modal)
 *   - Submit sender flags til backend og trigger auth:unauthorized
 */
export function openShiftLogoutModal(): void {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <p>${escapeHtml(t("agent_cash_in_out_shift_log_out_intro"))}</p>
    <div class="form-group">
      <label class="checkbox-inline" style="display:block; margin-bottom:8px;">
        <input type="checkbox" data-field="distributeWinnings" id="logout-flag-distribute">
        <strong>${escapeHtml(t("agent_cash_in_out_distribute_winnings_label"))}</strong>
      </label>
      <p class="help-block" style="margin-left:20px;">
        ${escapeHtml(t("agent_cash_in_out_distribute_winnings_hint"))}
      </p>
    </div>
    <div class="form-group">
      <label class="checkbox-inline" style="display:block; margin-bottom:8px;">
        <input type="checkbox" data-field="transferRegisterTickets" id="logout-flag-transfer">
        <strong>${escapeHtml(t("agent_cash_in_out_transfer_register_tickets_label"))}</strong>
      </label>
      <p class="help-block" style="margin-left:20px;">
        ${escapeHtml(t("agent_cash_in_out_transfer_register_tickets_hint"))}
      </p>
    </div>
    <div class="form-group">
      <label for="logout-notes">${escapeHtml(t("agent_cash_in_out_logout_notes_label"))}</label>
      <textarea class="form-control" id="logout-notes" data-field="logoutNotes"
        rows="2" maxlength="1000"></textarea>
    </div>
    <div style="margin:8px 0;">
      <a href="#" data-action="view-cashout-details">
        <i class="fa fa-eye" aria-hidden="true"></i> ${escapeHtml(t("agent_cash_in_out_view_cashout_details"))}
      </a>
    </div>`;

  const modal = Modal.open({
    title: t("agent_cash_in_out_shift_log_out"),
    content: wrap,
    size: "lg",
    backdrop: "static",
    keyboard: false,
    buttons: [
      { label: t("cancel_button"), variant: "default", action: "cancel" },
      {
        label: t("agent_cash_in_out_confirm_logout"),
        variant: "danger",
        action: "confirm-logout",
        onClick: async (instance) => {
          const distributeCb = wrap.querySelector<HTMLInputElement>('[data-field="distributeWinnings"]');
          const transferCb = wrap.querySelector<HTMLInputElement>('[data-field="transferRegisterTickets"]');
          const notesEl = wrap.querySelector<HTMLTextAreaElement>('[data-field="logoutNotes"]');
          const flags: AgentShiftLogoutFlags = {
            distributeWinnings: Boolean(distributeCb?.checked),
            transferRegisterTickets: Boolean(transferCb?.checked),
          };
          const notes = (notesEl?.value ?? "").trim();
          if (notes.length > 0) flags.logoutNotes = notes;
          try {
            const result = await agentShiftLogout(flags);
            Toast.success(
              t("agent_cash_in_out_logout_success", {
                pending: result.pendingCashoutsFlagged,
                ranges: result.ticketRangesFlagged,
              })
            );
            instance.close("programmatic");
            // Etter logout: trigger auth-event. Shell'en hånderer selve
            // redirect til login-side.
            window.dispatchEvent(new CustomEvent("auth:unauthorized"));
          } catch (err) {
            const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
            Toast.error(msg);
          }
        },
      },
    ],
  });

  // "View Cashout Details"-lenke.
  const viewLink = wrap.querySelector<HTMLAnchorElement>('[data-action="view-cashout-details"]');
  viewLink?.addEventListener("click", (e) => {
    e.preventDefault();
    openPendingCashoutsModal({
      onNavigateToCashout: () => {
        // Lukk begge modaler og navigér til fysisk-cashout-siden.
        Modal.closeAll(true);
        window.location.hash = "#/agent/physical-cashout";
      },
    });
  });

  void modal; // TS-ref
}
