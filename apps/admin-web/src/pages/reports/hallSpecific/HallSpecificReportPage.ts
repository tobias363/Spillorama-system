// BIN-17.36 — Hall Specific Report (per-hall aggregate).
//
// Wireframe: docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf §17.36
// PM-låst (Appendix B): Elvis Replacement Amount-kolonne må beholdes.
//
// Tidligere (BIN-645 PR-A4a) var dette et skelett basert på daily-report
// endepunktet. Nå treffer den dedikert /api/admin/reports/hall-specific som
// leverer per-hall aggregat med Group Of Hall Name, Hall Name, Agent,
// Elvis Replacement Amount + per-Game (Game 1-5) OMS/UTD/Payout%/RES.
//
// Eksport: CSV via DataTable.csvExport (transform flater per-game ut til
// separate kolonner for CSV-vennlighet).

import { DataTable } from "../../../components/DataTable.js";
import { t } from "../../../i18n/I18n.js";
import {
  getHallSpecificReport,
  type HallSpecificReportRow,
  type HallSpecificGame,
} from "../../../api/admin-reports.js";
import {
  defaultDateRange,
  renderReportShell,
  toIsoDate,
} from "../shared/reportShell.js";
import { escapeHtml } from "../../games/common/escape.js";

const GAMES: HallSpecificGame[] = ["game1", "game2", "game3", "game4", "game5"];

function formatKr(value: number): string {
  return value.toLocaleString("no-NO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPct(value: number): string {
  return `${value.toLocaleString("no-NO", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} %`;
}

export async function renderHallSpecificReportPage(
  container: HTMLElement
): Promise<void> {
  const tableHostId = "hall-specific-report-table";
  container.innerHTML = renderReportShell({
    title: t("hall_specific_reports"),
    tableHostId,
  });
  const hostEl = container.querySelector<HTMLElement>(`#${tableHostId}`);
  if (!hostEl) return;
  const host: HTMLElement = hostEl;

  const { from, to } = defaultDateRange();
  let currentFrom = toIsoDate(from);
  let currentTo = toIsoDate(to);

  const handle = DataTable.mount<HallSpecificReportRow>(host, {
    rows: [],
    emptyMessage: t("no_data_available_in_table"),
    className: "hall-specific-report",
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
      filename: `hall-specific-${currentFrom}_${currentTo}`,
      transform: (r) => {
        const base: Record<string, string | number | null> = {
          [t("group_of_hall_name")]: r.groupOfHallName ?? "",
          [t("hall_name")]: r.hallName,
          [t("agent")]: r.agentDisplayName ?? "",
          [t("elvis_replace_amount")]: r.elvisReplacementAmount,
        };
        for (const g of GAMES) {
          base[t(`${g}_oms`)] = r.games[g].oms;
          base[t(`${g}_utd`)] = r.games[g].utd;
          base[t(`${g}_payout_pct`)] = r.games[g].payoutPct;
          base[t(`${g}_res`)] = r.games[g].res;
        }
        return base;
      },
    },
    columns: [
      {
        key: "groupOfHallName",
        title: t("group_of_hall_name"),
        render: (r) => escapeHtml(r.groupOfHallName ?? "—"),
      },
      {
        key: "hallName",
        title: t("hall_name"),
        render: (r) => escapeHtml(r.hallName),
      },
      {
        key: "agentDisplayName",
        title: t("agent"),
        render: (r) => escapeHtml(r.agentDisplayName ?? "—"),
      },
      {
        key: "elvisReplacementAmount",
        title: t("elvis_replace_amount"),
        align: "right",
        render: (r) => escapeHtml(formatKr(r.elvisReplacementAmount)),
      },
      // Per-game-kolonner. Vi viser kun OMS/UTD/Payout%/RES per spill som en
      // kompakt gruppe (4 kolonner per spill = 20 game-kolonner + 4 meta =
      // 24 totalt). Wireframe har samme bredde.
      ...GAMES.flatMap((g) => [
        {
          key: `${g}Oms` as keyof HallSpecificReportRow & string,
          title: t(`${g}_oms`),
          align: "right" as const,
          render: (r: HallSpecificReportRow) =>
            escapeHtml(formatKr(r.games[g].oms)),
        },
        {
          key: `${g}Utd` as keyof HallSpecificReportRow & string,
          title: t(`${g}_utd`),
          align: "right" as const,
          render: (r: HallSpecificReportRow) =>
            escapeHtml(formatKr(r.games[g].utd)),
        },
        {
          key: `${g}PayoutPct` as keyof HallSpecificReportRow & string,
          title: t(`${g}_payout_pct`),
          align: "right" as const,
          render: (r: HallSpecificReportRow) =>
            escapeHtml(formatPct(r.games[g].payoutPct)),
        },
        {
          key: `${g}Res` as keyof HallSpecificReportRow & string,
          title: t(`${g}_res`),
          align: "right" as const,
          render: (r: HallSpecificReportRow) =>
            escapeHtml(formatKr(r.games[g].res)),
        },
      ]),
    ],
  });

  async function reload(): Promise<void> {
    try {
      const res = await getHallSpecificReport({
        from: currentFrom,
        to: currentTo,
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
