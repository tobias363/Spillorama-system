// PR-B4 (BIN-646) — Deposit-history (accepted + rejected).
//
// Data: GET /api/admin/payments/requests?type=deposit&statuses=ACCEPTED,REJECTED
// Dato-default: siste 7 dager (regulatorisk krav).
// Client-side dato-filter inntil PR-A4a DataTable-utvidelse merges.
//
// TODO(BIN-645): Rebase mot main etter PR-A4a merges.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import {
  listPaymentRequests,
  type PaymentRequest,
} from "../../api/admin-payments.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  dateDefaultRange,
  escapeHtml,
  formatAmountCents,
  statusBadge,
} from "../amountwithdraw/shared.js";

export function renderDepositHistoryPage(container: HTMLElement): void {
  const { start, end } = dateDefaultRange();

  container.innerHTML = `
    ${contentHeader("deposit_history", "transactions_management")}
    <section class="content">
      ${boxOpen("deposit_history", "info")}
        <div class="row" style="margin-bottom:12px;">
          <div class="col-sm-3">
            <label>${escapeHtml(t("start_date"))}</label>
            <input type="date" id="start-date" class="form-control" value="${start}">
          </div>
          <div class="col-sm-3">
            <label>${escapeHtml(t("end_date"))}</label>
            <input type="date" id="end-date" class="form-control" value="${end}">
          </div>
          <div class="col-sm-3">
            <label style="display:block;">&nbsp;</label>
            <button type="button" class="btn btn-info" data-action="search">
              <i class="fa fa-search"></i> ${escapeHtml(t("search"))}
            </button>
          </div>
        </div>
        <div id="history-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#history-table")!;
  const startInput = container.querySelector<HTMLInputElement>("#start-date")!;
  const endInput = container.querySelector<HTMLInputElement>("#end-date")!;
  container
    .querySelector<HTMLButtonElement>("[data-action='search']")
    ?.addEventListener("click", () => void refresh());

  function filterByDate(rows: PaymentRequest[]): PaymentRequest[] {
    const s = startInput.value;
    const e = endInput.value;
    if (!s && !e) return rows;
    return rows.filter((r) => {
      const d = r.updatedAt.slice(0, 10);
      if (s && d < s) return false;
      if (e && d > e) return false;
      return true;
    });
  }

  async function refresh(): Promise<void> {
    tableHost.textContent = t("loading_ellipsis");
    try {
      const res = await listPaymentRequests({
        type: "deposit",
        statuses: ["ACCEPTED", "REJECTED"],
        limit: 500,
      });
      const rows = filterByDate(res.requests);
      DataTable.mount<PaymentRequest>(tableHost, {
        columns: [
          {
            key: "updatedAt",
            title: t("date"),
            render: (r) => new Date(r.updatedAt).toISOString().slice(0, 16).replace("T", " "),
          },
          { key: "id", title: t("order_number") },
          { key: "id", title: t("transaction_id"), render: (r) => escapeHtml(r.walletTransactionId ?? r.id) },
          { key: "userId", title: t("customer_number") },
          { key: "userId", title: t("player_name"), render: (r) => escapeHtml(r.userId) },
          {
            key: "amountCents",
            title: t("amount"),
            align: "right",
            render: (r) => formatAmountCents(r.amountCents),
          },
          {
            key: "hallId",
            title: t("hall_name"),
            render: (r) => escapeHtml(r.hallId ?? "—"),
          },
          {
            key: "status",
            title: t("status"),
            render: (r) => statusBadge(r.status),
          },
        ],
        rows,
        emptyMessage: t("no_data_available_in_table"),
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
    }
  }

  void refresh();
}
