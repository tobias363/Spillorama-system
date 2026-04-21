// PR-A4b (BIN-659) — /report/settlement/:hallId page.
//
// (1645 lines — daily settlement edit view for Metronia/OKBingo/OpenDay
// agent integrations).
//
// Scope for PR-A4b: LIST of settlements for a hall (date-range filterable),
// with per-row "View" + "Edit" + "PDF" actions. The inline-edit of every row
// with 3-agent panels is deferred to a later milestone (settlement detail-
// view). BIN-588 infra already provides the PDF via GET
// `/api/admin/shifts/:shiftId/settlement.pdf` — we open in a new tab.
//
// Backend:
//   - GET /api/admin/shifts/settlements?hallId=X&fromDate&toDate&limit
//   - GET /api/admin/shifts/:shiftId/settlement.pdf (window.open)
//   - PUT /api/admin/shifts/:shiftId/settlement (edit flow, modal)

import { DataTable } from "../../components/DataTable.js";
import { t } from "../../i18n/I18n.js";
import {
  buildSettlementPdfUrl,
  editSettlement,
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
      <div id="settlement-edit-modal" class="modal fade" tabindex="-1" role="dialog" aria-hidden="true">
        <div class="modal-dialog" role="document">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">${escapeHtml(t("edit_settlement"))}</h5>
            </div>
            <div class="modal-body" id="settlement-edit-body"></div>
            <div class="modal-footer">
              <button type="button" class="btn btn-default" data-action="cancel">
                ${escapeHtml(t("cancel"))}
              </button>
              <button type="button" class="btn btn-primary" data-action="save">
                ${escapeHtml(t("save"))}
              </button>
            </div>
          </div>
        </div>
      </div>
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
        render: (r) =>
          `<button type="button" class="btn btn-info btn-xs btn-rounded" data-act="view" data-shift="${escapeHtml(r.shiftId)}" title="${escapeHtml(t("view"))}"><i class="fa fa-eye"></i></button> ` +
          `<button type="button" class="btn btn-warning btn-xs btn-rounded" data-act="edit" data-shift="${escapeHtml(r.shiftId)}" title="${escapeHtml(t("edit_settlement"))}"><i class="fa fa-pencil"></i></button> ` +
          `<button type="button" class="btn btn-default btn-xs btn-rounded" data-act="pdf" data-shift="${escapeHtml(r.shiftId)}" title="PDF"><i class="fa fa-file-pdf-o"></i></button>`,
      },
    ],
  });

  host.addEventListener("click", (ev: Event) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-act]"
    );
    if (!btn) return;
    const shiftId = btn.dataset.shift ?? "";
    if (!shiftId) return;
    const act = btn.dataset.act;
    if (act === "pdf") {
      window.open(buildSettlementPdfUrl(shiftId), "_blank");
    } else if (act === "view" || act === "edit") {
      void openSettlementModal(container, shiftId, act === "edit", () => reload());
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

// ── Modal: view + edit single settlement ────────────────────────────────────

async function openSettlementModal(
  root: HTMLElement,
  shiftId: string,
  editMode: boolean,
  onSaved: () => Promise<void>
): Promise<void> {
  const modal = root.querySelector<HTMLElement>("#settlement-edit-modal");
  const body = root.querySelector<HTMLElement>("#settlement-edit-body");
  const cancelBtn = root.querySelector<HTMLButtonElement>(
    '[data-action="cancel"]'
  );
  const saveBtn = root.querySelector<HTMLButtonElement>('[data-action="save"]');
  if (!modal || !body || !cancelBtn || !saveBtn) return;

  body.innerHTML = `<p>${escapeHtml(t("loading"))}...</p>`;
  modal.style.display = "block";
  modal.classList.add("in");

  let data: AdminSettlement | null = null;
  try {
    data = await getSettlement(shiftId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    body.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
    return;
  }

  const ro = editMode ? "" : "readonly disabled";
  body.innerHTML = `
    <form id="settlement-form">
      <div class="form-group">
        <label>${escapeHtml(t("date"))}:</label>
        <input type="text" class="form-control" value="${escapeHtml(data.businessDate)}" readonly disabled>
      </div>
      <div class="form-group">
        <label>${escapeHtml(t("reported_cash"))}:</label>
        <input type="number" class="form-control" name="reportedCashCount" value="${data.reportedCashCount}" ${ro}>
      </div>
      <div class="form-group">
        <label>${escapeHtml(t("settlement_to_drop_safe"))}:</label>
        <input type="number" class="form-control" name="settlementToDropSafe" value="${data.settlementToDropSafe}" ${ro}>
      </div>
      <div class="form-group">
        <label>${escapeHtml(t("withdraw_from_total_balance"))}:</label>
        <input type="number" class="form-control" name="withdrawFromTotalBalance" value="${data.withdrawFromTotalBalance}" ${ro}>
      </div>
      <div class="form-group">
        <label>${escapeHtml(t("deposit_to_dropsafe"))}:</label>
        <input type="number" class="form-control" name="totalDropSafe" value="${data.totalDropSafe}" ${ro}>
      </div>
      <div class="form-group">
        <label>${escapeHtml(t("comments"))}:</label>
        <textarea class="form-control" name="settlementNote" ${ro}>${escapeHtml(data.settlementNote ?? "")}</textarea>
      </div>
      ${editMode ? `
      <div class="form-group">
        <label>${escapeHtml(t("reason"))} *:</label>
        <input type="text" class="form-control" name="reason" required>
      </div>` : ""}
    </form>
  `;
  saveBtn.disabled = !editMode;

  const close = (): void => {
    modal.style.display = "none";
    modal.classList.remove("in");
  };

  const cancelHandler = (): void => close();
  cancelBtn.addEventListener("click", cancelHandler, { once: true });

  const saveHandler = async (): Promise<void> => {
    const form = body.querySelector<HTMLFormElement>("#settlement-form");
    if (!form || !data) return;
    const fd = new FormData(form);
    const reason = String(fd.get("reason") ?? "").trim();
    if (!reason) {
      alert(t("reason_required"));
      return;
    }
    try {
      await editSettlement(shiftId, {
        reason,
        reportedCashCount: numOrUndef(fd.get("reportedCashCount")),
        settlementToDropSafe: numOrUndef(fd.get("settlementToDropSafe")),
        withdrawFromTotalBalance: numOrUndef(fd.get("withdrawFromTotalBalance")),
        totalDropSafe: numOrUndef(fd.get("totalDropSafe")),
        settlementNote: (fd.get("settlementNote") as string | null) ?? null,
      });
      close();
      await onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      body.insertAdjacentHTML(
        "afterbegin",
        `<div class="alert alert-danger">${escapeHtml(msg)}</div>`
      );
    }
  };
  if (editMode) {
    saveBtn.addEventListener("click", saveHandler, { once: true });
  }
}

function numOrUndef(v: FormDataEntryValue | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
