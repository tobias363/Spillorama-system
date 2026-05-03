// PDF 17 §17.29 — Order History (agent-view).
//
// Wireframe: docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf §17.29
//
// Filter-rad: Date Range (From/To) + Search by Order ID + Payment Type
// dropdown (Cash/Card/Customer Number).
// Kolonner: Order ID, Date/Time, Payment Type, Total, Action (View).
// Export CSV via DataTable.csvExport.
//
// RBAC: AGENT ser egne salg (auto-scope via shift). HALL_OPERATOR/ADMIN
// ser alle agenters salg i hallen. Backend håndhever scope.

import { DataTable } from "../../components/DataTable.js";
import { t } from "../../i18n/I18n.js";
import { escapeHtml } from "../games/common/escape.js";
import {
  defaultDateRange,
  formatCurrency,
  formatDateTime,
  renderReportShell,
  toIsoDate,
} from "../reports/shared/reportShell.js";
import {
  getOrderHistory,
  getOrderDetail,
  type OrderSale,
  type OrderDetailResponse,
  type OrderPaymentMethod,
} from "../../api/agent-history.js";
import { Toast } from "../../components/Toast.js";
import {
  isNoShiftError,
  renderNoShiftBanner,
} from "./noShiftFallback.js";

const PAYMENT_METHOD_LABELS: Record<OrderPaymentMethod, string> = {
  CASH: "Kontant",
  CARD: "Kort",
  CUSTOMER_NUMBER: "Bingokonto",
};

function paymentLabel(method: OrderPaymentMethod): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

export async function renderOrderHistoryPage(
  container: HTMLElement,
): Promise<void> {
  const tableHostId = "order-history-table";
  container.innerHTML = renderReportShell({
    title: t("order_history"),
    tableHostId,
    moduleTitleKey: "agent_dashboard",
  });

  const hostEl = container.querySelector<HTMLElement>(`#${tableHostId}`);
  if (!hostEl) return;
  const host: HTMLElement = hostEl;

  const { from, to } = defaultDateRange();
  let currentFrom = toIsoDate(from);
  let currentTo = toIsoDate(to);
  let currentSearch = "";
  let currentPaymentMethod: OrderPaymentMethod | "" = "";

  const handle = DataTable.mount<OrderSale>(host, {
    rows: [],
    emptyMessage: t("no_data_available_in_table"),
    className: "agent-order-history",
    dateRange: {
      initialFrom: from,
      initialTo: to,
      onChange: (f, tD) => {
        if (f) currentFrom = toIsoDate(f);
        if (tD) currentTo = toIsoDate(tD);
        void reload();
      },
    },
    toolbar: {
      extra: (slot) => {
        // Search-by-Order-ID input.
        const searchLabel = document.createElement("label");
        searchLabel.style.cssText =
          "display:flex;flex-direction:column;font-size:12px;";
        searchLabel.textContent = t("search");
        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.className = "form-control input-sm";
        searchInput.style.width = "200px";
        searchInput.placeholder = t("search");
        searchInput.addEventListener("input", () => {
          currentSearch = searchInput.value.trim();
        });
        searchInput.addEventListener("change", () => void reload());
        searchInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void reload();
          }
        });
        searchLabel.append(searchInput);
        slot.append(searchLabel);

        // Payment-method dropdown.
        const paymentLabelEl = document.createElement("label");
        paymentLabelEl.style.cssText =
          "display:flex;flex-direction:column;font-size:12px;margin-left:8px;";
        paymentLabelEl.textContent = t("payment_type");
        const select = document.createElement("select");
        select.className = "form-control input-sm";
        select.style.width = "180px";
        for (const [value, label] of [
          ["", t("all")],
          ["CASH", PAYMENT_METHOD_LABELS.CASH],
          ["CARD", PAYMENT_METHOD_LABELS.CARD],
          ["CUSTOMER_NUMBER", PAYMENT_METHOD_LABELS.CUSTOMER_NUMBER],
        ] as Array<[string, string]>) {
          const opt = document.createElement("option");
          opt.value = value;
          opt.textContent = label;
          select.append(opt);
        }
        select.addEventListener("change", () => {
          currentPaymentMethod =
            select.value as OrderPaymentMethod | "";
          void reload();
        });
        paymentLabelEl.append(select);
        slot.append(paymentLabelEl);
      },
    },
    csvExport: {
      filename: `order-history-${currentFrom}_${currentTo}`,
    },
    columns: [
      {
        key: "orderId",
        title: t("order_id"),
        render: (r) => escapeHtml(r.orderId),
      },
      {
        key: "createdAt",
        title: t("date_time"),
        render: (r) => escapeHtml(formatDateTime(r.createdAt)),
      },
      {
        key: "paymentMethod",
        title: t("payment_type"),
        render: (r) => escapeHtml(paymentLabel(r.paymentMethod)),
      },
      {
        key: "totalCents",
        title: t("total"),
        align: "right",
        render: (r) => `${escapeHtml(formatCurrency(r.totalCents))} kr`,
      },
      {
        key: "id",
        title: t("action"),
        render: (r) =>
          `<button type="button" class="btn btn-xs btn-default" data-view-order="${escapeHtml(
            r.id,
          )}">${escapeHtml(t("view"))}</button>`,
      },
    ],
  });

  // Action-button delegation: open detail-modal when row "View" clicked.
  host.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    const btn = target.closest<HTMLButtonElement>("[data-view-order]");
    if (!btn) return;
    ev.preventDefault();
    const saleId = btn.getAttribute("data-view-order");
    if (!saleId) return;
    void openOrderDetailModal(saleId);
  });

  async function reload(): Promise<void> {
    try {
      const res = await getOrderHistory({
        from: currentFrom,
        to: currentTo,
        search: currentSearch || undefined,
        paymentMethod: currentPaymentMethod || undefined,
        limit: 500,
        offset: 0,
      });
      handle.setRows(res.sales);
    } catch (err) {
      // Bug #5: 400 SHIFT_NOT_ACTIVE → swap container med no-shift-banner.
      if (isNoShiftError(err)) {
        renderNoShiftBanner(container, () => {
          void renderOrderHistoryPage(container);
        });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      host.insertAdjacentHTML(
        "afterbegin",
        `<div class="alert alert-danger">${escapeHtml(msg)}</div>`,
      );
    }
  }

  await reload();
}

/**
 * PDF 17 §17.30 — View Order Details modal.
 *
 * Lightweight implementasjon med innebygd backdrop og close-handler.
 * Ingen avhengighet av prosjekt-modal-bibliotek (mange under
 * `cash-inout/`-flyter har lokale popup-versjoner).
 */
async function openOrderDetailModal(saleId: string): Promise<void> {
  let detail: OrderDetailResponse;
  try {
    detail = await getOrderDetail(saleId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Toast.error(msg);
    return;
  }

  const { sale, cart } = detail;
  const linesHtml = cart.lines
    .map(
      (l) => `
        <tr>
          <td>${escapeHtml(l.productName)}</td>
          <td style="text-align:right;">${l.quantity}</td>
          <td style="text-align:right;">${escapeHtml(formatCurrency(l.unitPriceCents))} kr</td>
          <td style="text-align:right;">${escapeHtml(formatCurrency(l.lineTotalCents))} kr</td>
        </tr>`,
    )
    .join("");

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("data-modal", "order-detail");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1050;display:flex;align-items:center;justify-content:center;";
  overlay.innerHTML = `
    <div class="modal-content" style="background:#fff;border-radius:6px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h4 style="margin:0;">${escapeHtml(t("view_order"))}</h4>
        <button type="button" class="close" data-close-modal aria-label="Close" style="background:none;border:none;font-size:24px;cursor:pointer;">&times;</button>
      </div>
      <dl class="dl-horizontal" style="margin-bottom:16px;">
        <dt>${escapeHtml(t("order_id"))}</dt><dd>${escapeHtml(sale.orderId)}</dd>
        <dt>${escapeHtml(t("date_time"))}</dt><dd>${escapeHtml(formatDateTime(sale.createdAt))}</dd>
        <dt>${escapeHtml(t("payment_type"))}</dt><dd>${escapeHtml(paymentLabel(sale.paymentMethod))}</dd>
        ${cart.username ? `<dt>${escapeHtml(t("player_name"))}</dt><dd>${escapeHtml(cart.username)}</dd>` : ""}
      </dl>
      <table class="table table-striped" style="margin-bottom:0;">
        <thead>
          <tr>
            <th>${escapeHtml(t("product_name"))}</th>
            <th style="text-align:right;">${escapeHtml(t("quantity"))}</th>
            <th style="text-align:right;">${escapeHtml(t("price"))}</th>
            <th style="text-align:right;">${escapeHtml(t("total"))}</th>
          </tr>
        </thead>
        <tbody>${linesHtml}</tbody>
        <tfoot>
          <tr>
            <th colspan="3" style="text-align:right;">${escapeHtml(t("total"))}</th>
            <th style="text-align:right;">${escapeHtml(formatCurrency(sale.totalCents))} kr</th>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = (): void => {
    overlay.remove();
  };
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
    const closeBtn = (ev.target as HTMLElement | null)?.closest(
      "[data-close-modal]",
    );
    if (closeBtn) close();
  });
  document.addEventListener(
    "keydown",
    (ev) => {
      if (ev.key === "Escape") close();
    },
    { once: true },
  );
}
