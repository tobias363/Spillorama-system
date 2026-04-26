// PR-A4a (BIN-645) — generic per-game range-report page.
//
// Used by:
//   - Game 1 report (ReportGameSlug: "bingo")
//   - Game 2 report (ReportGameSlug: "rocket")
//   - Game 3 report (ReportGameSlug: "mystery")
//   - Game 4 report (ReportGameSlug: "wheel")
//   - Game 5 report (ReportGameSlug: "color-draft")
//
// Layout mirrors legacy report/gameNreports.html: date-range filter bar +
// DataTable with hall/rounds/players/stakes/prizes/net columns + CSV export.
//
// LEGACY: App/Views/report/game{1..5}reports.html — server-side DataTable.
// NEW:    DataTable.cursorPaging wraps the single-page drill-down response.

import { DataTable } from "../../../components/DataTable.js";
import { t } from "../../../i18n/I18n.js";
import { getGameDrillDown } from "../../../api/admin-reports.js";
import {
  defaultDateRange,
  formatCurrency,
  renderReportShell,
  toIsoDate,
} from "./reportShell.js";
import { escapeHtml } from "../../games/common/escape.js";
import type { ReportGameSlug, GameReportRow } from "../../../../../../packages/shared-types/src/reports.js";

export interface GameRangeReportOptions {
  /** Backend gameSlug param. */
  gameSlug: ReportGameSlug;
  /** Display title (usually t("game1") etc). */
  title: string;
  /** Optional link template to drill-down (e.g. `/reportGame1/subgames/:id`). */
  drillLinkTemplate?: string;
}

export async function renderGameRangeReportPage(
  container: HTMLElement,
  opts: GameRangeReportOptions
): Promise<void> {
  const tableHostId = `report-${opts.gameSlug}-table`;
  container.innerHTML = renderReportShell({
    title: opts.title,
    tableHostId,
  });
  const hostEl = container.querySelector<HTMLElement>(`#${tableHostId}`);
  if (!hostEl) return;
  const host: HTMLElement = hostEl;

  const { from, to } = defaultDateRange();
  let currentFrom = toIsoDate(from);
  let currentTo = toIsoDate(to);
  let currentRows: GameReportRow[] = [];

  const handle = DataTable.mount<GameReportRow>(host, {
    rows: [],
    emptyMessage: t("no_data_available_in_table"),
    className: `report-${opts.gameSlug}-list`,
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
      filename: `${opts.gameSlug}-range-${currentFrom}_${currentTo}`,
    },
    columns: buildColumns(opts),
  });

  async function reload(): Promise<void> {
    try {
      const res = await getGameDrillDown({
        gameSlug: opts.gameSlug,
        startDate: currentFrom,
        endDate: currentTo,
      });
      currentRows = res.rows;
      handle.setRows(currentRows);
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

function buildColumns(opts: GameRangeReportOptions) {
  return [
    { key: "hallId" as const, title: t("hall") },
    {
      key: "roundCount" as const,
      title: t("rounds"),
      align: "right" as const,
    },
    {
      key: "distinctPlayerCount" as const,
      title: t("unique_players"),
      align: "right" as const,
    },
    {
      key: "totalStakes" as const,
      title: t("total_stakes"),
      align: "right" as const,
      render: (row: GameReportRow) => formatCurrency(row.totalStakes),
    },
    {
      key: "totalPrizes" as const,
      title: t("total_prizes"),
      align: "right" as const,
      render: (row: GameReportRow) => formatCurrency(row.totalPrizes),
    },
    {
      key: "net" as const,
      title: t("net"),
      align: "right" as const,
      render: (row: GameReportRow) => formatCurrency(row.net),
    },
    ...(opts.drillLinkTemplate
      ? [
          {
            key: "gameType" as const,
            title: t("actions"),
            align: "center" as const,
            render: (row: GameReportRow) => {
              const href = opts.drillLinkTemplate!.replace(
                ":id",
                encodeURIComponent(row.hallId)
              );
              return `<a class="btn btn-info btn-xs btn-rounded" href="#${href}" title="${escapeHtml(t("view"))}"><i class="fa fa-eye" aria-hidden="true"></i></a>`;
            },
          },
        ]
      : []),
  ];
}
