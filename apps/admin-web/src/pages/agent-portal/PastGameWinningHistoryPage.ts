// BIN-17.32 — Past Game Winning History (agent-view).
//
// Wireframe: docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf §17.32
//
// Filter-rad: Date Range (From/To) + Search by Ticket ID.
// Kolonner: Date/Time, Ticket ID, Ticket Type, Ticket Color, Ticket Price,
// Winning Pattern. Export CSV via DataTable.csvExport.
//
// RBAC: AGENT ser egen hall (via shift), HALL_OPERATOR/ADMIN kan se annen
// hall via hallId-parameter. Dette håndteres i backend — UI bare sender request.

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
  getPastWinningHistory,
  type PastWinningHistoryRow,
} from "../../api/agent-reports.js";

export async function renderPastGameWinningHistoryPage(
  container: HTMLElement
): Promise<void> {
  const tableHostId = "past-winning-history-table";
  container.innerHTML = renderReportShell({
    title: t("past_game_winning_history"),
    tableHostId,
    moduleTitleKey: "agent_dashboard",
  });
  const hostEl = container.querySelector<HTMLElement>(`#${tableHostId}`);
  if (!hostEl) return;
  const host: HTMLElement = hostEl;

  const { from, to } = defaultDateRange();
  let currentFrom = toIsoDate(from);
  let currentTo = toIsoDate(to);
  let currentTicketId = "";

  const handle = DataTable.mount<PastWinningHistoryRow>(host, {
    rows: [],
    emptyMessage: t("no_winning_history_found"),
    className: "past-winning-history",
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
        const label = document.createElement("label");
        label.style.cssText =
          "display:flex;flex-direction:column;font-size:12px;";
        label.textContent = t("search_by_ticket_id");
        const input = document.createElement("input");
        input.type = "text";
        input.className = "form-control input-sm";
        input.style.width = "200px";
        input.placeholder = t("search_by_ticket_id");
        input.addEventListener("input", () => {
          currentTicketId = input.value.trim();
        });
        // Trigger reload on Enter or blur to avoid a request per keystroke.
        input.addEventListener("change", () => {
          void reload();
        });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void reload();
          }
        });
        label.append(input);
        slot.append(label);
      },
    },
    csvExport: {
      filename: `past-winning-history-${currentFrom}_${currentTo}`,
    },
    columns: [
      {
        key: "dateTime",
        title: t("date"),
        render: (r) => escapeHtml(formatDateTime(r.dateTime)),
      },
      {
        key: "ticketId",
        title: t("ticket_id"),
        render: (r) => escapeHtml(r.ticketId),
      },
      {
        key: "ticketType",
        title: t("ticket_type"),
        render: (r) => escapeHtml(r.ticketType),
      },
      {
        key: "ticketColor",
        title: t("ticket_color"),
        render: (r) => escapeHtml(r.ticketColor),
      },
      {
        key: "priceCents",
        title: t("ticket_price"),
        align: "right",
        render: (r) =>
          r.priceCents !== null
            ? escapeHtml(formatCurrency(r.priceCents))
            : "—",
      },
      {
        key: "winningPattern",
        title: t("winning_pattern"),
        render: (r) => escapeHtml(r.winningPattern ?? "—"),
      },
    ],
  });

  async function reload(): Promise<void> {
    try {
      const res = await getPastWinningHistory({
        from: currentFrom,
        to: currentTo,
        ticketId: currentTicketId || undefined,
        limit: 500,
        offset: 0,
      });
      handle.setRows(res.rows);
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
