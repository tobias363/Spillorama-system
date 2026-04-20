// BIN-648 wiring — /physicalTicketReport.
//
// Legacy: report/physicalTicketReport.html (226 linjer).
// Backend: GET /api/admin/reports/physical-tickets/aggregate (canonical shape
// `PhysicalTicketsAggregateResponse`, per-(gameId, hallId) aggregate row).

import { DataTable } from "../../../components/DataTable.js";
import { t } from "../../../i18n/I18n.js";
import { fetchPhysicalTicketsAggregate } from "../../../api/admin-reports-physical.js";
import { listHalls, type AdminHall } from "../../../api/admin-halls.js";
import {
  defaultDateRange,
  formatCurrency,
  renderReportShell,
  toIsoDate,
} from "../shared/reportShell.js";
import { escapeHtml } from "../../games/common/escape.js";
import type {
  PhysicalTicketsAggregateRow,
  PhysicalTicketsAggregateResponse,
} from "../../../../../../packages/shared-types/src/reports.js";

export async function renderPhysicalTicketReportPage(container: HTMLElement): Promise<void> {
  const tableHostId = "physical-ticket-report-table";
  const { from, to } = defaultDateRange();
  let currentFrom = toIsoDate(from);
  let currentTo = toIsoDate(to);
  let currentHallId: string | undefined;
  const hallNameCache = new Map<string, string>();

  container.innerHTML = renderReportShell({
    title: t("physical_ticket"),
    tableHostId,
    extraBelow: `<div id="physical-ticket-summary" class="well well-sm" style="margin-top:12px"></div>`,
  });

  const hostEl = container.querySelector<HTMLElement>(`#${tableHostId}`);
  const summaryHost = container.querySelector<HTMLElement>("#physical-ticket-summary");
  if (!hostEl) return;
  const host: HTMLElement = hostEl;

  const handle = DataTable.mount<PhysicalTicketsAggregateRow>(host, {
    rows: [],
    emptyMessage: t("no_data_available_in_table"),
    className: "physical-ticket-report",
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
        const wrapper = document.createElement("label");
        wrapper.style.cssText = "display:flex;flex-direction:column;font-size:12px;";
        wrapper.textContent = t("hall");
        const select = document.createElement("select");
        select.className = "form-control input-sm";
        select.setAttribute("data-testid", "hall-filter");
        const optAll = document.createElement("option");
        optAll.value = "";
        optAll.textContent = t("all_halls");
        select.append(optAll);
        select.addEventListener("change", () => {
          currentHallId = select.value || undefined;
          void reload();
        });
        wrapper.append(select);
        slot.append(wrapper);

        // Populate halls async; non-fatal if it fails.
        void (async () => {
          try {
            const halls = await listHalls({ includeInactive: true });
            for (const h of halls) {
              hallNameCache.set(h.id, h.name);
              const o = document.createElement("option");
              o.value = h.id;
              o.textContent = h.name;
              select.append(o);
            }
          } catch {
            // Silent — selector stays with "all halls" option only.
          }
        })();
      },
    },
    csvExport: { filename: `physical-ticket-${currentFrom}_${currentTo}` },
    columns: [
      { key: "gameId", title: t("game_id"), render: (r) => r.gameId ?? "—" },
      {
        key: "hallId",
        title: t("hall"),
        render: (r) => escapeHtml(hallNameCache.get(r.hallId) ?? r.hallId),
      },
      { key: "sold", title: t("tickets_sold"), align: "right" },
      { key: "pending", title: t("pending"), align: "right" },
      { key: "cashedOut", title: t("cashed_out"), align: "right" },
      {
        key: "totalRevenueCents",
        title: t("total_revenue"),
        align: "right",
        render: (r) => formatCurrency(r.totalRevenueCents),
      },
    ],
  });

  async function reload(): Promise<void> {
    try {
      clearInlineAlert(host);
      const res = await fetchPhysicalTicketsAggregate({
        hallId: currentHallId,
        from: currentFrom,
        to: currentTo,
      });
      if (res.isPlaceholder || !res.response) {
        handle.setRows([]);
        if (summaryHost) summaryHost.innerHTML = "";
        host.insertAdjacentHTML(
          "afterbegin",
          `<div class="alert alert-warning">${escapeHtml(t("gap_physical_ticket_aggregate"))}</div>`
        );
        return;
      }
      handle.setRows(res.response.rows);
      renderSummary(summaryHost, res.response);
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

function renderSummary(
  el: HTMLElement | null,
  res: PhysicalTicketsAggregateResponse
): void {
  if (!el) return;
  const { totals } = res;
  el.innerHTML = `
    <strong>${escapeHtml(t("tickets_sold"))}:</strong> ${totals.sold} &nbsp;·&nbsp;
    <strong>${escapeHtml(t("pending"))}:</strong> ${totals.pending} &nbsp;·&nbsp;
    <strong>${escapeHtml(t("cashed_out"))}:</strong> ${totals.cashedOut} &nbsp;·&nbsp;
    <strong>${escapeHtml(t("total_revenue"))}:</strong> ${formatCurrency(totals.totalRevenueCents)} NOK
  `;
}

function clearInlineAlert(host: HTMLElement): void {
  host.querySelectorAll(":scope > .alert").forEach((n) => n.remove());
}

// Unused but retained for any caller importing AdminHall from this module.
export type { AdminHall };
