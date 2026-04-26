// BIN-587 B4b — unique-ID lookup page (/uniqueId).
//
// Operatør skanner / taster inn unique-ID og ser ticket-detaljer +
// full state-transition-historikk (CREATED → SOLD → VOIDED/CASHED-OUT).
//
// Backend-kilder:
//   POST /api/admin/unique-ids/check          — idempotent sellable-check
//   GET  /api/admin/unique-ids/:uniqueId      — full ticket row
//   GET  /api/admin/unique-ids/:uniqueId/transactions — state events

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  checkUniqueId,
  getUniqueIdTransactions,
  type PhysicalTicket,
  type UniqueIdTransactionEvent,
} from "../../api/admin-physical-tickets.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, formatNOK } from "../physical-tickets/shared.js";

export function renderUniqueIdLookupPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("generate_unique_id")}
    <section class="content">
      ${boxOpen("unique_id_lookup", "primary")}
        <form id="lookup-form" class="form-inline" novalidate>
          <div class="form-group" style="margin-right:8px;">
            <label for="lookup-uniqueId">${escapeHtml(t("unique_id"))}</label>
            <input type="text" class="form-control" id="lookup-uniqueId" name="uniqueId"
              autocomplete="off" autofocus
              placeholder="${escapeHtml(t("scan_or_type_unique_id"))}" required>
          </div>
          <button type="submit" class="btn btn-primary" data-action="lookup">
            <i class="fa fa-search" aria-hidden="true"></i> ${escapeHtml(t("lookup_ticket"))}
          </button>
        </form>
        <div id="lookup-result" style="margin-top:16px;"></div>
      ${boxClose()}
    </section>`;

  const form = container.querySelector<HTMLFormElement>("#lookup-form")!;
  const uniqueIdInput = container.querySelector<HTMLInputElement>("#lookup-uniqueId")!;
  const resultHost = container.querySelector<HTMLElement>("#lookup-result")!;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const uniqueId = uniqueIdInput.value.trim();
    if (!uniqueId) {
      Toast.error(t("scan_or_type_unique_id"));
      return;
    }
    await performLookup(uniqueId);
  });

  async function performLookup(uniqueId: string): Promise<void> {
    resultHost.innerHTML = `<p>${escapeHtml(t("loading_ellipsis"))}</p>`;
    try {
      const check = await checkUniqueId(uniqueId);
      if (!check.exists || !check.ticket) {
        resultHost.innerHTML = `<div class="alert alert-warning">${escapeHtml(t("ticket_not_found"))}</div>`;
        return;
      }
      const ticket = check.ticket;
      let events: UniqueIdTransactionEvent[] = [];
      try {
        const tx = await getUniqueIdTransactions(uniqueId);
        events = tx.events;
      } catch {
        // Non-fatal: events is supplementary info.
      }
      renderResult(ticket, events);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      resultHost.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
    }
  }

  function renderResult(ticket: PhysicalTicket, events: UniqueIdTransactionEvent[]): void {
    const detailRows = [
      `<tr><th>${escapeHtml(t("unique_id"))}</th><td>${escapeHtml(ticket.uniqueId)}</td></tr>`,
      `<tr><th>${escapeHtml(t("ticket_status"))}</th><td>${escapeHtml(t("ticket_status_" + ticket.status.toLowerCase()))}</td></tr>`,
      `<tr><th>${escapeHtml(t("hall"))}</th><td>${escapeHtml(ticket.hallId)}</td></tr>`,
    ];
    if (ticket.assignedGameId) {
      detailRows.push(`<tr><th>${escapeHtml(t("game_name"))}</th><td>${escapeHtml(ticket.assignedGameId)}</td></tr>`);
    }
    if (ticket.priceCents !== null) {
      detailRows.push(`<tr><th>${escapeHtml(t("default_price"))}</th><td>${formatNOK(ticket.priceCents / 100)} kr</td></tr>`);
    }
    if (ticket.soldAt) {
      detailRows.push(`<tr><th>${escapeHtml(t("sold_at"))}</th><td>${escapeHtml(new Date(ticket.soldAt).toLocaleString("nb-NO"))}</td></tr>`);
    }
    if (ticket.patternWon) {
      detailRows.push(`<tr><th>${escapeHtml(t("pattern_won"))}</th><td>${escapeHtml(ticket.patternWon)}</td></tr>`);
    }
    if (ticket.wonAmountCents !== null) {
      detailRows.push(`<tr><th>${escapeHtml(t("payout_amount"))}</th><td>${formatNOK(ticket.wonAmountCents / 100)} kr</td></tr>`);
    }
    if (ticket.isWinningDistributed) {
      detailRows.push(`<tr><th>${escapeHtml(t("already_cashed_out"))}</th><td>${escapeHtml(t("yes"))}</td></tr>`);
    }

    const eventsHtml =
      events.length > 0
        ? events
            .map(
              (ev) => `
                <tr>
                  <td>${escapeHtml(new Date(ev.at).toLocaleString("nb-NO"))}</td>
                  <td>${escapeHtml(ev.event)}</td>
                  <td>${escapeHtml(ev.actor ?? "—")}</td>
                </tr>`
            )
            .join("")
        : `<tr><td colspan="3" class="text-center text-muted">${escapeHtml(t("no_events"))}</td></tr>`;

    resultHost.innerHTML = `
      <div class="box box-default" style="margin-top:0;">
        <div class="box-header with-border">
          <h3 class="box-title">${escapeHtml(t("ticket_details"))}</h3>
        </div>
        <div class="box-body">
          <table class="table table-condensed" style="margin-bottom:16px;">
            <tbody>${detailRows.join("")}</tbody>
          </table>
          <h4>${escapeHtml(t("event_history"))}</h4>
          <table class="table table-condensed">
            <thead>
              <tr>
                <th>${escapeHtml(t("date_time"))}</th>
                <th>${escapeHtml(t("event"))}</th>
                <th>${escapeHtml(t("actor"))}</th>
              </tr>
            </thead>
            <tbody>${eventsHtml}</tbody>
          </table>
        </div>
      </div>`;
  }
}
