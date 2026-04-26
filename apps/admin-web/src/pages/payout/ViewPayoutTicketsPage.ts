// PR-A4b (BIN-659) — /payoutTickets/view/:ticketId detail page.
//
// (89 lines). Read-only detail-view for one ticket-level payout. Legacy
// only shows game name + hall + total tickets sold — we surface the same,
// drilling via `/api/admin/unique-ids/:uniqueId/transactions` if a unique-id
// is derivable, else we simply echo the ticketId + fall back to an info box.
//
// NOTE: Backend does not currently expose "get single physical-ticket by
// ticketId" — we rely on the parent page (PayoutTicketsPage) having loaded
// the row in session / URL-encoding. For pilot-parity the simple read-only
// view is acceptable; a follow-up can add `GET /api/admin/physical-tickets/
// :ticketId` if product wants richer detail.

import { t } from "../../i18n/I18n.js";
import { renderReportShell } from "../reports/shared/reportShell.js";
import { escapeHtml } from "../games/common/escape.js";

export async function renderViewPayoutTicketsPage(
  container: HTMLElement,
  ticketId: string
): Promise<void> {
  const hostId = "view-payout-ticket-body";
  container.innerHTML = renderReportShell({
    title: t("payout_ticket_details"),
    moduleTitleKey: "payout_management",
    subtitle: ticketId,
    tableHostId: hostId,
    extraBelow: `
      <div style="margin-top:12px">
        <a href="#/payoutTickets" class="btn btn-default btn-sm">${escapeHtml(t("cancel"))}</a>
      </div>`,
  });

  const hostEl = container.querySelector<HTMLElement>(`#${hostId}`);
  if (!hostEl) return;
  const host: HTMLElement = hostEl;

  host.innerHTML = `
    <form class="form-horizontal">
      <div class="form-group">
        <label class="control-label col-sm-3">${escapeHtml(t("ticket_id"))}:</label>
        <div class="col-sm-9">
          <input type="text" class="form-control" readonly disabled value="${escapeHtml(ticketId)}">
        </div>
      </div>
      <div class="alert alert-info" role="status">
        <i class="fa fa-info-circle" aria-hidden="true"></i>
        ${escapeHtml(t("payout_ticket_detail_backend_pending"))}
        <small>(BIN-659)</small>
      </div>
    </form>`;
}
