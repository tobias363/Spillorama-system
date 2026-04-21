// Sold tickets — port of
// DataTable with date-range filter, shift-scoped.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import { listTransactions, type TransactionListItem } from "../../api/agent-cash.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, formatNOK } from "./shared.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function renderSoldTicketsPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("sold_tickets")}
    <section class="content">
      ${boxOpen("sold_ticket", "default")}
        <form id="filter-form" class="form-inline" novalidate>
          <div class="form-group">
            <label for="from_date">${escapeHtml(t("from_date"))}</label>
            <input type="date" id="from_date" class="form-control" value="${today()}">
          </div>
          <div class="form-group" style="margin-left:8px;">
            <label for="to_date">${escapeHtml(t("to_date"))}</label>
            <input type="date" id="to_date" class="form-control" value="${today()}">
          </div>
          <button type="submit" class="btn btn-primary" style="margin-left:8px;">${escapeHtml(t("search"))}</button>
        </form>
        <hr>
        <div id="sold-tickets-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#sold-tickets-table")!;
  const form = container.querySelector<HTMLFormElement>("#filter-form")!;

  function renderRows(rows: TransactionListItem[]): void {
    DataTable.mount<TransactionListItem>(tableHost, {
      columns: [
        {
          key: "createdAt",
          title: t("date_time"),
          render: (row) => escapeHtml(new Date(row.createdAt).toLocaleString("nb-NO")),
        },
        { key: "type", title: t("ticket_type") },
        { key: "playerName", title: t("player_name"), render: (r) => escapeHtml(r.playerName ?? "—") },
        {
          key: "amount",
          title: t("amount"),
          align: "right",
          render: (row) => `${formatNOK(row.amount)} kr`,
        },
        { key: "paymentType", title: t("payment_type") ?? "Payment" },
        { key: "id", title: "ID", render: (r) => escapeHtml(r.id) },
      ],
      rows,
      emptyMessage: t("no_data_available_in_table"),
    });
  }

  async function reload(): Promise<void> {
    const from = (form.querySelector<HTMLInputElement>("#from_date")!).value;
    const to = (form.querySelector<HTMLInputElement>("#to_date")!).value;
    try {
      const rows = await listTransactions({ from, to, type: "ticket-sale" });
      renderRows(rows);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = "";
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void reload();
  });

  void reload();
}
