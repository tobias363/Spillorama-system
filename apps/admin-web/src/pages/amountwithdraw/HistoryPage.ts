// PR-B4 (BIN-646) — Withdraw-history (bank / hall).
// Port av legacy historyBank.html + historyHall.html. Viser completed+rejected
// withdraw-requests for regnskap/revisjon.
//
// Data: GET /api/admin/payments/requests?type=withdraw&statuses=ACCEPTED,REJECTED
//       &destinationType=<x>
// PR-B4-PLAN §3.1: Dato-default = siste 7 dager (regulatorisk krav — lesbar
// standardvisning for regnskap). dateRange-filter er client-side inntil
// PR-A4a DataTable-utvidelsen er merget.
//
// TODO(BIN-645): Rebase mot main etter PR-A4a merges, switch til ny DataTable-API
//                (dateRange server-side + CSV-eksport).
//
// Regulatorisk:
//   - Read-only view → ingen AuditLog-krav på frontend-side (backend logger
//     READ implisitt via access-log).
//   - Fail-closed: backend-500 → banner med feilmelding, ingen tom tabell.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import {
  listPaymentRequests,
  type PaymentRequest,
  type PaymentRequestDestinationType,
} from "../../api/admin-payments.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  dateDefaultRange,
  escapeHtml,
  formatAmountCents,
  statusBadge,
} from "./shared.js";

export interface HistoryPageOptions {
  destinationType: PaymentRequestDestinationType;
  titleKey: string;
}

export function renderHistoryPage(
  container: HTMLElement,
  opts: HistoryPageOptions
): void {
  const { start, end } = dateDefaultRange();

  container.innerHTML = `
    ${contentHeader(opts.titleKey)}
    <section class="content">
      ${boxOpen(opts.titleKey, "info")}
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

  function buildColumns(): Parameters<typeof DataTable.mount<PaymentRequest>>[1]["columns"] {
    const cols: Parameters<typeof DataTable.mount<PaymentRequest>>[1]["columns"] = [
      {
        key: "updatedAt",
        title: t("date"),
        render: (r) => new Date(r.updatedAt).toISOString().slice(0, 16).replace("T", " "),
      },
      { key: "id", title: t("transaction_id") },
      { key: "userId", title: t("customer_number") },
      {
        key: "amountCents",
        title: t("withdraw_amount"),
        align: "right",
        render: (r) => formatAmountCents(r.amountCents),
      },
      {
        key: "hallId",
        title: t("hall_name"),
        render: (r) => escapeHtml(r.hallId ?? "—"),
      },
    ];
    if (opts.destinationType === "bank") {
      cols.push({
        key: "walletId",
        title: t("bank_account_number"),
        render: (r) => escapeHtml(r.walletId),
      });
    }
    cols.push({
      key: "status",
      title: t("status"),
      render: (r) => statusBadge(r.status),
    });
    return cols;
  }

  async function refresh(): Promise<void> {
    tableHost.textContent = t("loading_ellipsis");
    try {
      const res = await listPaymentRequests({
        type: "withdraw",
        statuses: ["ACCEPTED", "REJECTED"],
        destinationType: opts.destinationType,
        limit: 500,
      });
      const rows = filterByDate(res.requests);
      DataTable.mount<PaymentRequest>(tableHost, {
        columns: buildColumns(),
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
