// BIN-647 wiring — /reportGame1/subgames/:id (sub-game drill-down).
//
// Legacy: legacy/unity-backend/App/Views/report/subgame1reports.html (226 linjer).
// Backend: GET /api/admin/reports/subgame-drill-down?parentId=&from=&to=&cursor=&limit=
// The `:id` URL-param is the `hall_game_schedules.id` of the parent bingo-match.

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { fetchSubgameDrillDown } from "../../../api/admin-reports-drill.js";
import {
  defaultDateRange,
  formatCurrency,
  renderReportShell,
  toIsoDate,
} from "../shared/reportShell.js";
import { escapeHtml } from "../../games/common/escape.js";
import type { SubgameDrillDownItem } from "../../../../../../packages/shared-types/src/reports.js";

const PAGE_SIZE = 50;

export async function renderGame1SubgamesPage(
  container: HTMLElement,
  parentId: string
): Promise<void> {
  const tableHostId = "subgame-drilldown-table";
  const { from, to } = defaultDateRange();
  let currentFrom = toIsoDate(from);
  let currentTo = toIsoDate(to);

  container.innerHTML = renderReportShell({
    title: t("subgame_report"),
    subtitle: `${t("match")} #${parentId}`,
    tableHostId,
  });

  const hostEl = container.querySelector<HTMLElement>(`#${tableHostId}`);
  if (!hostEl) return;
  const host: HTMLElement = hostEl;

  DataTable.mount<SubgameDrillDownItem>(host, {
    rows: [],
    emptyMessage: t("no_data_available_in_table"),
    className: "subgame-drilldown",
    dateRange: {
      initialFrom: from,
      initialTo: to,
      onChange: (f, tD) => {
        if (f) currentFrom = toIsoDate(f);
        if (tD) currentTo = toIsoDate(tD);
        void renderGame1SubgamesPage(container, parentId);
      },
    },
    cursorPaging: {
      pageSize: PAGE_SIZE,
      load: async ({ cursor, limit }) => {
        const res = await fetchSubgameDrillDown({
          parentId,
          from: currentFrom,
          to: currentTo,
          cursor: cursor ?? undefined,
          limit,
        });
        if (res.isPlaceholder || !res.response) {
          return { rows: [], nextCursor: null };
        }
        return {
          rows: res.response.items,
          nextCursor: res.response.nextCursor,
        };
      },
    },
    csvExport: { filename: `subgame-${parentId}` },
    columns: [
      { key: "subGameNumber", title: t("sub_game"), render: (r) => r.subGameNumber ?? "—" },
      { key: "name", title: t("pattern_name") },
      { key: "hallName", title: t("hall") },
      { key: "ticketCount", title: t("rounds"), align: "right" },
      { key: "players", title: t("unique_players"), align: "right" },
      {
        key: "revenue",
        title: t("total_stakes"),
        align: "right",
        render: (r) => formatCurrency(r.revenue),
      },
      {
        key: "totalWinnings",
        title: t("total_prizes"),
        align: "right",
        render: (r) => formatCurrency(r.totalWinnings),
      },
      {
        key: "netProfit",
        title: t("net"),
        align: "right",
        render: (r) => formatCurrency(r.netProfit),
      },
    ],
  });

  // Detect gap + surface warning above table if backend is missing.
  try {
    const first = await fetchSubgameDrillDown({
      parentId,
      from: currentFrom,
      to: currentTo,
      limit: 1,
    });
    if (first.isPlaceholder) {
      host.insertAdjacentHTML(
        "afterbegin",
        `<div class="alert alert-warning">${escapeHtml(t("gap_subgame_drilldown"))}</div>`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    host.insertAdjacentHTML(
      "afterbegin",
      `<div class="alert alert-danger">${escapeHtml(msg)}</div>`
    );
  }

  // Breadcrumb back-link to /reportGame1.
  const breadcrumb = container.querySelector(".breadcrumb");
  if (breadcrumb) {
    const back = document.createElement("li");
    back.innerHTML = `<a href="#/reportGame1">${escapeHtml(t("game1"))}</a>`;
    breadcrumb.insertBefore(back, breadcrumb.lastElementChild);
  }
}
