// PR-B4 (BIN-646) — Withdraw-requests queue page.
// Port av legacy/unity-backend/App/Views/Amountwithdraw/bankRequests.html
// (destinationType=bank) og hallRequests.html (destinationType=hall).
//
// Én renderer dekker begge variantene — forskjellen er destinationType-filter
// og om `bankAccountNumber`-kolonne vises. Matching av legacy-kolonner:
//
//   bank: date, customerNumber, name, bankAccountNumber, withdrawAmount, hallName, status, action
//   hall: date, customerNumber, name, withdrawAmount, hallName, status, action
//
// Data: GET /api/admin/payments/requests?type=withdraw&destinationType=<x>&status=PENDING
// Accept/reject: POST /api/admin/payments/requests/:id/{accept,reject}
//
// Regulatorisk (PR-B4-PLAN §3):
//   - Accept/reject går gjennom PaymentActionModal → backend AuditLog.
//   - Permission-gate: PAYMENT_REQUEST_WRITE. HALL_OPERATOR backend-scopet via
//     BIN-591 hall-enforcement.
//   - Fail-closed: backend-500 → modal forblir åpen, Toast.error.
//
// TODO(BIN-645): Rebase mot main etter PR-A4a merges, switch til ny DataTable-API
//                (dateRange + cursorPaging + csvExport).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import { hasPermission } from "../../auth/permissions.js";
import {
  listPaymentRequests,
  type PaymentRequest,
  type PaymentRequestDestinationType,
} from "../../api/admin-payments.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
  formatAmountCents,
  statusBadge,
} from "./shared.js";
import { openPaymentActionModal } from "./modals/PaymentActionModal.js";

export interface RequestsPageOptions {
  /** "bank" | "hall" — matches destinationType-filter i backend. */
  destinationType: PaymentRequestDestinationType;
  /** "withdraw_request_in_bank" / "withdraw_request_in_hall". */
  titleKey: string;
}

interface PageState {
  rows: PaymentRequest[];
}

export function renderRequestsPage(
  container: HTMLElement,
  opts: RequestsPageOptions
): void {
  const state: PageState = { rows: [] };
  const canWrite = hasPermission("Withdraw Management", "edit");

  container.innerHTML = `
    ${contentHeader(opts.titleKey)}
    <section class="content">
      ${boxOpen(opts.titleKey, "primary")}
        <div class="row" style="margin-bottom:8px;">
          <div class="col-sm-12 text-right">
            <button type="button" class="btn btn-xs btn-success" data-action="refresh">
              <i class="fa fa-refresh"></i> ${escapeHtml(t("refresh_table"))}
            </button>
          </div>
        </div>
        <div id="requests-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#requests-table")!;
  const refreshBtn = container.querySelector<HTMLButtonElement>("[data-action='refresh']");
  refreshBtn?.addEventListener("click", () => void refresh());

  function buildColumns(): Parameters<typeof DataTable.mount<PaymentRequest>>[1]["columns"] {
    const cols: Parameters<typeof DataTable.mount<PaymentRequest>>[1]["columns"] = [
      {
        key: "createdAt",
        title: t("date"),
        render: (r) => new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " "),
      },
      { key: "userId", title: t("customer_number") },
      { key: "userId", title: t("fullname"), render: (r) => escapeHtml(r.userId) },
    ];
    if (opts.destinationType === "bank") {
      cols.push({
        key: "walletId",
        title: t("bank_account_number"),
        render: (r) => escapeHtml(r.walletId),
      });
    }
    cols.push(
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
      {
        key: "status",
        title: t("status"),
        render: (r) => statusBadge(r.status),
      }
    );
    if (canWrite) {
      cols.push({
        key: "id",
        title: t("action"),
        align: "center",
        render: (r) => renderActionCell(r),
      });
    }
    return cols;
  }

  function renderActionCell(r: PaymentRequest): Node {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:inline-flex;gap:4px;";
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "btn btn-success btn-xs";
    accept.setAttribute("data-id", r.id);
    accept.setAttribute("data-action", "accept");
    accept.innerHTML = `<i class="fa fa-check"></i> ${escapeHtml(t("acceptbtn"))}`;
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "btn btn-danger btn-xs";
    reject.setAttribute("data-id", r.id);
    reject.setAttribute("data-action", "reject");
    reject.innerHTML = `<i class="fa fa-times"></i> ${escapeHtml(t("rejectbtn"))}`;
    wrap.append(accept, reject);
    return wrap;
  }

  async function refresh(): Promise<void> {
    tableHost.textContent = t("loading_ellipsis");
    try {
      const res = await listPaymentRequests({
        type: "withdraw",
        status: "PENDING",
        destinationType: opts.destinationType,
        limit: 200,
      });
      state.rows = res.requests;
      DataTable.mount<PaymentRequest>(tableHost, {
        columns: buildColumns(),
        rows: state.rows,
        emptyMessage: t("no_data_available_in_table"),
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
    }
  }

  tableHost.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action][data-id]");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const action = btn.getAttribute("data-action");
    const row = state.rows.find((r) => r.id === id);
    if (!row) return;
    const kind = action === "accept" ? "withdraw-accept" : "withdraw-reject";
    openPaymentActionModal({
      kind,
      request: row,
      onSuccess: () => void refresh(),
    });
  });

  void refresh();
}
