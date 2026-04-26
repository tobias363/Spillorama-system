// BIN-640 wiring — admin single-ticket cashout.
//
// Flow:
//   1. Operator skanner / taster inn unique-ID.
//   2. UI kaller POST /api/admin/unique-ids/check for status-preview.
//   3. Hvis SOLD og ikke allerede cashed-out → skjema for payoutCents + notes.
//   4. POST /api/admin/physical-tickets/:uniqueId/cashout registrerer payout.
//
// Idempotens: hvis cashout allerede eksisterer viser vi GET-resultatet uten
// å tillate ny submit. Hall-scope håndheves av backend (HALL_OPERATOR ser
// kun egen hall).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  checkUniqueId,
  getCashout,
  cashoutTicket,
  type PhysicalTicket,
  type GetCashoutResponse,
} from "../../api/admin-physical-tickets.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, formatNOK } from "./shared.js";

interface State {
  ticket: PhysicalTicket | null;
  cashoutInfo: GetCashoutResponse | null;
  busy: boolean;
}

export function renderCashOutPage(container: HTMLElement): void {
  const state: State = { ticket: null, cashoutInfo: null, busy: false };

  container.innerHTML = `
    ${contentHeader("physical_cash_out")}
    <section class="content">
      ${boxOpen("physical_cash_out_scan", "primary")}
        <form id="scan-form" class="form-inline" novalidate>
          <div class="form-group" style="margin-right:8px;">
            <label for="scan-uniqueId">${escapeHtml(t("unique_id"))}</label>
            <input type="text" class="form-control" id="scan-uniqueId" name="uniqueId"
              autocomplete="off" autofocus placeholder="${escapeHtml(t("scan_or_type_unique_id"))}" required>
          </div>
          <button type="submit" class="btn btn-primary" data-action="scan">
            <i class="fa fa-search" aria-hidden="true"></i> ${escapeHtml(t("lookup_ticket"))}
          </button>
        </form>
        <div id="ticket-details" style="margin-top:16px;"></div>
      ${boxClose()}
    </section>`;

  const form = container.querySelector<HTMLFormElement>("#scan-form")!;
  const uniqueIdInput = container.querySelector<HTMLInputElement>("#scan-uniqueId")!;
  const detailsHost = container.querySelector<HTMLElement>("#ticket-details")!;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const uniqueId = uniqueIdInput.value.trim();
    if (!uniqueId) {
      Toast.error(t("scan_or_type_unique_id"));
      return;
    }
    await lookupTicket(uniqueId);
  });

  async function lookupTicket(uniqueId: string): Promise<void> {
    state.busy = true;
    detailsHost.innerHTML = `<p>${escapeHtml(t("loading_ellipsis"))}</p>`;
    try {
      const res = await checkUniqueId(uniqueId);
      if (!res.exists || !res.ticket) {
        state.ticket = null;
        state.cashoutInfo = null;
        detailsHost.innerHTML = `<div class="alert alert-warning">${escapeHtml(t("ticket_not_found"))}</div>`;
        return;
      }
      state.ticket = res.ticket;
      if (res.ticket.status === "SOLD") {
        state.cashoutInfo = await getCashout(uniqueId);
      } else {
        state.cashoutInfo = null;
      }
      renderTicketDetails();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      detailsHost.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
    } finally {
      state.busy = false;
    }
  }

  function renderTicketDetails(): void {
    const ticket = state.ticket;
    if (!ticket) {
      detailsHost.innerHTML = "";
      return;
    }
    const info = state.cashoutInfo;
    const rows: string[] = [
      `<tr><th>${escapeHtml(t("unique_id"))}</th><td>${escapeHtml(ticket.uniqueId)}</td></tr>`,
      `<tr><th>${escapeHtml(t("batch_status"))}</th><td>${escapeHtml(t("ticket_status_" + ticket.status.toLowerCase()))}</td></tr>`,
      `<tr><th>${escapeHtml(t("hall"))}</th><td>${escapeHtml(ticket.hallId)}</td></tr>`,
    ];
    if (ticket.assignedGameId) {
      rows.push(`<tr><th>${escapeHtml(t("game_name"))}</th><td>${escapeHtml(ticket.assignedGameId)}</td></tr>`);
    }
    if (ticket.priceCents !== null) {
      rows.push(`<tr><th>${escapeHtml(t("default_price"))}</th><td>${formatNOK(ticket.priceCents / 100)}</td></tr>`);
    }
    if (ticket.soldAt) {
      rows.push(`<tr><th>${escapeHtml(t("sold_at"))}</th><td>${escapeHtml(new Date(ticket.soldAt).toLocaleString("nb-NO"))}</td></tr>`);
    }

    // Compose action area based on status + cashout state.
    let actionHtml = "";
    if (ticket.status !== "SOLD") {
      actionHtml = `<div class="alert alert-warning">${escapeHtml(t("ticket_not_cashable"))}</div>`;
    } else if (info && info.cashedOut && info.cashout) {
      actionHtml = `
        <div class="alert alert-info">
          <strong>${escapeHtml(t("already_cashed_out"))}</strong>
          <div>${escapeHtml(t("paid_amount"))}: ${formatNOK(info.cashout.payoutCents / 100)} kr</div>
          <div>${escapeHtml(t("paid_at"))}: ${escapeHtml(new Date(info.cashout.paidAt).toLocaleString("nb-NO"))}</div>
          ${info.cashout.notes ? `<div>${escapeHtml(t("notes"))}: ${escapeHtml(info.cashout.notes)}</div>` : ""}
        </div>`;
    } else {
      actionHtml = `
        <form id="cashout-form" class="form-horizontal" novalidate style="margin-top:10px;">
          <div class="form-group">
            <label class="col-sm-3 control-label" for="cashout-amount">${escapeHtml(t("payout_amount"))} (kr)</label>
            <div class="col-sm-4">
              <input type="number" class="form-control" id="cashout-amount" name="payoutAmount"
                min="0.01" step="0.01" required>
            </div>
          </div>
          <div class="form-group">
            <label class="col-sm-3 control-label" for="cashout-notes">${escapeHtml(t("notes"))}</label>
            <div class="col-sm-6">
              <input type="text" class="form-control" id="cashout-notes" name="notes" maxlength="255">
            </div>
          </div>
          <div class="form-group">
            <div class="col-sm-offset-3 col-sm-6">
              <button type="submit" class="btn btn-success" data-action="cashout">
                <i class="fa fa-money" aria-hidden="true"></i> ${escapeHtml(t("register_cashout"))}
              </button>
            </div>
          </div>
        </form>`;
    }

    detailsHost.innerHTML = `
      <div class="box box-default" style="margin-top:0;">
        <div class="box-header with-border">
          <h3 class="box-title">${escapeHtml(t("ticket_details"))}</h3>
        </div>
        <div class="box-body">
          <table class="table table-condensed" style="margin-bottom:12px;">
            <tbody>${rows.join("")}</tbody>
          </table>
          ${actionHtml}
        </div>
      </div>`;

    const cashoutForm = detailsHost.querySelector<HTMLFormElement>("#cashout-form");
    if (cashoutForm) {
      cashoutForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (state.busy) return;
        const amountInput = detailsHost.querySelector<HTMLInputElement>("#cashout-amount")!;
        const notesInput = detailsHost.querySelector<HTMLInputElement>("#cashout-notes")!;
        const amountVal = Number(amountInput.value);
        if (!Number.isFinite(amountVal) || amountVal <= 0) {
          Toast.error(t("payout_amount_must_be_positive"));
          return;
        }
        const payoutCents = Math.round(amountVal * 100);
        state.busy = true;
        try {
          await cashoutTicket(ticket.uniqueId, {
            payoutCents,
            notes: notesInput.value.trim() || null,
          });
          Toast.success(t("cashout_success"));
          await lookupTicket(ticket.uniqueId);
        } catch (err) {
          const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
          Toast.error(msg);
        } finally {
          state.busy = false;
        }
      });
    }
  }
}
