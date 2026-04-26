// Agent-portal Cash In/Out Management (legacy V1.0 skjerm 17.x).
//
// I V1.0-wireframe har denne siden 6 knapper (Unique ID, Registered User,
// Sell Products, Shift Log Out, Today's Sales Report). Implementasjonen
// vokser inn i de seks knappene gradvis:
//   - Wireframe Gap #4 (Register Sold Tickets, PDF 15.2 / 17.15)
//   - Wireframe Gap #9 (Shift Log Out-popup med checkboxer +
//     "View Cashout Details"-modal per PDF 17.6).
//
// De øvrige knappene fylles inn i etterfølgende PR-er.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { Modal } from "../../components/Modal.js";
import { ApiError } from "../../api/client.js";
import {
  agentShiftLogout,
  type AgentShiftLogoutFlags,
} from "../../api/agent-shift.js";
import { openPendingCashoutsModal } from "./PendingCashoutsModal.js";
import { openRegisterSoldTicketsModal } from "./modals/RegisterSoldTicketsModal.js";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function mountAgentCashInOut(container: HTMLElement): void {
  container.innerHTML = `
    <section class="content-header">
      <h1>${escapeHtml(t("agent_cash_in_out_management"))}</h1>
      <ol class="breadcrumb">
        <li><a href="#/agent/dashboard"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
        <li class="active">${escapeHtml(t("agent_cash_in_out_management"))}</li>
      </ol>
    </section>
    <section class="content">
      <div class="box box-primary">
        <div class="box-header with-border">
          <h3 class="box-title">${escapeHtml(t("agent_cash_in_out_management"))}</h3>
        </div>
        <div class="box-body">
          <p>${escapeHtml(t("agent_cash_in_out_description"))}</p>
          <div class="btn-group-vertical" role="group" aria-label="cash-in-out-actions"
            data-marker="agent-cash-actions"
            style="display:flex; flex-direction:column; gap:8px; max-width:360px;">
            <button type="button" class="btn btn-primary"
                    data-marker="btn-register-sold-tickets"
                    data-action="register-sold-tickets">
              <i class="fa fa-ticket" aria-hidden="true"></i> ${escapeHtml(t("register_sold_tickets_button"))}
            </button>
            <button type="button" class="btn btn-danger" data-action="shift-log-out">
              <i class="fa fa-sign-out" aria-hidden="true"></i> ${escapeHtml(t("agent_cash_in_out_shift_log_out"))}
            </button>
          </div>
        </div>
      </div>
    </section>`;

  const registerBtn = container.querySelector<HTMLButtonElement>(
    '[data-marker="btn-register-sold-tickets"]',
  );
  registerBtn?.addEventListener("click", () => {
    // Hent gameId fra url-param eller prompt. Pilot: prompt.
    // (I senere PR hentes gameId fra NextGamePanel-staten eller fra en
    // dropdown over pågående spill.)
    const gameId = window.prompt(t("enter_game_id"));
    if (!gameId || !gameId.trim()) return;
    openRegisterSoldTicketsModal({
      gameId: gameId.trim(),
    });
  });

  const logoutBtn = container.querySelector<HTMLButtonElement>('[data-action="shift-log-out"]');
  logoutBtn?.addEventListener("click", () => {
    openShiftLogoutModal();
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
