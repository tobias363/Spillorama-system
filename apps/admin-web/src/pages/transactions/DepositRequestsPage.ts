// PR-B4 (BIN-646) — Deposit-requests queue.
//
// Data: GET /api/admin/payments/requests?type=deposit&status=PENDING
// Accept: POST /api/admin/payments/requests/:id/accept (med paymentType Cash/Card
//         for BIN-653 forward-compat, backend-persist kommer senere)
// Reject: POST /api/admin/payments/requests/:id/reject (reason required)
//
// Regulatorisk:
//   - Accept/reject via PaymentActionModal → backend logger AuditLog.
//   - Fail-closed: ved backend-500 forblir modal åpen + Toast.error.
//   - Permission-gate: PAYMENT_REQUEST_WRITE (Wallet/Transaction Management).
//
// TODO(BIN-645): Rebase mot main etter PR-A4a merges, switch til ny DataTable-API.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import { hasPermission } from "../../auth/permissions.js";
import {
  listPaymentRequests,
  type PaymentRequest,
} from "../../api/admin-payments.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
  formatAmountCents,
  statusBadge,
} from "../amountwithdraw/shared.js";
import { openPaymentActionModal } from "../amountwithdraw/modals/PaymentActionModal.js";

interface PageState {
  rows: PaymentRequest[];
}

export function renderDepositRequestsPage(container: HTMLElement): void {
  const state: PageState = { rows: [] };
  const canWrite = hasPermission("Transactions Management", "edit");

  container.innerHTML = `
    ${contentHeader("deposit_request", "transactions_management")}
    <section class="content">
      ${boxOpen("deposit_requests", "primary")}
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
  container
    .querySelector<HTMLButtonElement>("[data-action='refresh']")
    ?.addEventListener("click", () => void refresh());

  function buildColumns(): Parameters<typeof DataTable.mount<PaymentRequest>>[1]["columns"] {
    const cols: Parameters<typeof DataTable.mount<PaymentRequest>>[1]["columns"] = [
      {
        key: "createdAt",
        title: t("date"),
        render: (r) => new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " "),
      },
      { key: "id", title: t("order_number") },
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
    ];
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
        type: "deposit",
        status: "PENDING",
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
    const kind = action === "accept" ? "deposit-accept" : "deposit-reject";
    openPaymentActionModal({
      kind,
      request: row,
      onSuccess: () => void refresh(),
    });
  });

  void refresh();
}
