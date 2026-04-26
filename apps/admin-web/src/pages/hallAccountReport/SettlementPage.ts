// PR-A4b (BIN-659) + K1 wire-up + Wireframe Gap #2 — /report/settlement/:hallId page.
//
// Scope: LIST of settlements for a hall (date-range filterable), with per-row
// View + Edit + PDF + Receipt-download actions. View/Edit opens the full 15-row
// wireframe-paritet SettlementBreakdownModal (PDF 16.25 / 17.40). Admin edits
// flow through PUT /api/admin/shifts/:shiftId/settlement (with `reason` audit-
// field) inside the modal. Download-receipt er 4-action iht wireframe 16.24.
//
// Backend:
//   - GET /api/admin/shifts/settlements?hallId=X&fromDate&toDate&limit
//   - GET /api/admin/shifts/:shiftId/settlement.pdf (window.open)
//   - GET /api/admin/shifts/:shiftId/settlement/receipt (window.open — bilag-binær)
//   - GET /api/admin/shifts/:shiftId/settlement (prefill modal)
//   - PUT /api/admin/shifts/:shiftId/settlement (edit — 15-row breakdown)

import { DataTable } from "../../components/DataTable.js";
import { t } from "../../i18n/I18n.js";
import {
  buildSettlementPdfUrl,
  buildSettlementReceiptUrl,
  getSettlement,
  listSettlements,
  type AdminSettlement,
} from "../../api/admin-settlement.js";
import {
  defaultDateRange,
  formatCurrency,
  formatDateTime,
  renderReportShell,
  toIsoDate,
} from "../reports/shared/reportShell.js";
import { escapeHtml } from "../games/common/escape.js";
import { openSettlementBreakdownModal } from "../cash-inout/modals/SettlementBreakdownModal.js";

export async function renderSettlementPage(
  container: HTMLElement,
  hallId: string
): Promise<void> {
  const tableHostId = "settlement-table";
  container.innerHTML = renderReportShell({
    title: t("settlement_report"),
    moduleTitleKey: "hall_account_report",
    subtitle: hallId,
    tableHostId,
    extraBelow: `
      <div style="margin-top:12px">
        <a href="#/hallAccountReport" class="btn btn-default btn-sm">${escapeHtml(t("back"))}</a>
      </div>`,
  });

  const hostEl = container.querySelector<HTMLElement>(`#${tableHostId}`);
  if (!hostEl) return;
  const host: HTMLElement = hostEl;

  const { from, to } = defaultDateRange();
  let currentFrom = toIsoDate(from);
  let currentTo = toIsoDate(to);

  const handle = DataTable.mount<AdminSettlement>(host, {
    rows: [],
    emptyMessage: t("no_data_available_in_table"),
    className: "settlement-list",
    dateRange: {
      initialFrom: from,
      initialTo: to,
      onChange: (f, tD) => {
        if (f) currentFrom = toIsoDate(f);
        if (tD) currentTo = toIsoDate(tD);
        void reload();
      },
    },
    csvExport: {
      filename: `settlement-${hallId}-${currentFrom}_${currentTo}`,
    },
    columns: [
      { key: "businessDate", title: t("date") },
      { key: "shiftId", title: t("shift") },
      { key: "agentUserId", title: t("agent") },
      {
        key: "dailyBalanceAtEnd",
        title: t("balance"),
        align: "right",
        render: (r) => formatCurrency(r.dailyBalanceAtEnd),
      },
      {
        key: "reportedCashCount",
        title: t("reported_cash"),
        align: "right",
        render: (r) => formatCurrency(r.reportedCashCount),
      },
      {
        key: "dailyBalanceDifference",
        title: "Diff",
        align: "right",
        render: (r) => formatCurrency(r.dailyBalanceDifference),
      },
      {
        key: "totalDropSafe",
        title: t("deposit_to_dropsafe"),
        align: "right",
        render: (r) => formatCurrency(r.totalDropSafe),
      },
      {
        key: "editedAt",
        title: t("last_modified"),
        render: (r) => (r.editedAt ? formatDateTime(r.editedAt) : "—"),
      },
      {
        key: "id",
        title: t("actions"),
        align: "center",
        render: (r) => {
          const hasReceipt = Boolean(r.bilagReceipt);
          const receiptTitle = hasReceipt
            ? escapeHtml(t("download_receipt") || "Download receipt")
            : escapeHtml(t("no_receipt_uploaded") || "Ingen bilag lastet opp");
          const receiptDisabled = hasReceipt ? "" : "disabled";
          return (
            `<button type="button" class="btn btn-info btn-xs btn-rounded" data-act="view" data-shift="${escapeHtml(r.shiftId)}" title="${escapeHtml(t("view"))}"><i class="fa fa-eye" aria-hidden="true"></i></button> ` +
            `<button type="button" class="btn btn-warning btn-xs btn-rounded" data-act="edit" data-shift="${escapeHtml(r.shiftId)}" title="${escapeHtml(t("edit_settlement"))}"><i class="fa fa-pencil" aria-hidden="true"></i></button> ` +
            `<button type="button" class="btn btn-default btn-xs btn-rounded" data-act="pdf" data-shift="${escapeHtml(r.shiftId)}" title="PDF"><i class="fa fa-file-pdf-o" aria-hidden="true"></i></button> ` +
            `<button type="button" class="btn btn-success btn-xs btn-rounded" data-act="receipt" data-shift="${escapeHtml(r.shiftId)}" title="${receiptTitle}" ${receiptDisabled}><i class="fa fa-download" aria-hidden="true"></i></button>`
          );
        },
      },
    ],
  });

  host.addEventListener("click", (ev: Event) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-act]"
    );
    if (!btn) return;
    // Disabled-knapper (f.eks. receipt uten bilag) skal ikke utføre aksjon.
    if (btn.disabled) return;
    const shiftId = btn.dataset.shift ?? "";
    if (!shiftId) return;
    const act = btn.dataset.act;
    if (act === "pdf") {
      window.open(buildSettlementPdfUrl(shiftId), "_blank");
    } else if (act === "receipt") {
      // Wireframe Gap #2: download-receipt-action (16.24). Browser håndterer
      // download-dialog basert på Content-Disposition attachment-header.
      window.open(buildSettlementReceiptUrl(shiftId), "_blank");
    } else if (act === "view" || act === "edit") {
      void openFullBreakdownModal(shiftId, act === "edit", () => reload());
    }
  });

  async function reload(): Promise<void> {
    try {
      const res = await listSettlements({
        hallId,
        fromDate: currentFrom,
        toDate: currentTo,
        limit: 200,
      });
      handle.setRows(res.settlements);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      host.insertAdjacentHTML(
        "afterbegin",
        `<div class="alert alert-danger">${escapeHtml(msg)}</div>`
      );
    }
  }

  await reload();
}

// ── Modal launcher: fetch settlement + open full 15-row breakdown modal ──

async function openFullBreakdownModal(
  shiftId: string,
  editMode: boolean,
  onSaved: () => Promise<void>
): Promise<void> {
  let settlement: AdminSettlement;
  try {
    settlement = await getSettlement(shiftId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    alert(msg);
    return;
  }
  openSettlementBreakdownModal({
    mode: editMode ? "edit" : "view",
    existingSettlement: settlement,
    shiftId: settlement.shiftId,
    agentUserId: settlement.agentUserId,
    agentName: settlement.agentUserId,
    hallName: settlement.hallId,
    businessDate: settlement.businessDate,
    onSubmitted: () => {
      void onSaved();
    },
  });
}
