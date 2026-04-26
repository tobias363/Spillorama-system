// REQ-143: aggregert hall-account-rapport per Group-of-Hall.
//
// Lar multi-hall-operatorer (HALL_OPERATOR med medlemskap i en gruppe)
// + ADMIN/SUPPORT se ett aggregert datasett over alle medlemshaller i en
// gruppe — i stedet for å åpne hver hall enkeltvis.
//
// Backend: GET /api/admin/reports/groups/:groupId/{daily,monthly,account-balance}
// Wireframe: PDF 16/17 §17.36 — operator velger Group of Hall + (valgfritt)
// Hall Name som filter. Denne siden er "alle haller i gruppen samtidig".

import { DataTable } from "../../components/DataTable.js";
import { t } from "../../i18n/I18n.js";
import {
  getGroupAccountBalance,
  getGroupDailyReport,
  type DailyGroupReportRow,
  type GroupAccountBalanceResponse,
} from "../../api/admin-group-hall-reports.js";
import {
  defaultDateRange,
  formatCurrency,
  renderReportShell,
  toIsoDate,
} from "../reports/shared/reportShell.js";
import { escapeHtml } from "../games/common/escape.js";

export async function renderGroupHallAccountReportPage(
  container: HTMLElement,
  groupId: string,
): Promise<void> {
  const tableHostId = "group-hall-account-table";
  container.innerHTML = renderReportShell({
    title: t("hall_account_report"),
    moduleTitleKey: "hall_account_report",
    subtitle: `${t("group_of_hall") ?? "Group of Hall"}: ${groupId}`,
    tableHostId,
    extraBelow: `
      <div id="group-hall-account-summary" class="well well-sm" style="margin-top:12px"></div>
      <div style="margin-top:12px">
        <a href="#/hallAccountReport" class="btn btn-default btn-sm">${escapeHtml(t("back"))}</a>
      </div>`,
  });

  const hostEl = container.querySelector<HTMLElement>(`#${tableHostId}`);
  const summaryHost = container.querySelector<HTMLElement>("#group-hall-account-summary");
  if (!hostEl) return;
  const host: HTMLElement = hostEl;

  const { from, to } = defaultDateRange();
  const currentFrom = toIsoDate(from);
  const currentTo = toIsoDate(to);

  DataTable.mount<DailyGroupReportRow>(host, {
    rows: [],
    emptyMessage: t("no_data_available_in_table"),
    className: "group-hall-account",
    columns: [
      { key: "date", title: t("date") },
      {
        key: "gameType",
        title: t("game_type") ?? "Game type",
        render: (r) => escapeHtml(r.gameType ?? "ALL"),
      },
      {
        key: "ticketsSoldCents",
        title: t("revenue") ?? "Omsetning",
        align: "right",
        render: (r) => formatCurrency(r.ticketsSoldCents),
      },
      {
        key: "winningsPaidCents",
        title: t("winnings") ?? "Utbetalt",
        align: "right",
        render: (r) => formatCurrency(r.winningsPaidCents),
      },
      {
        key: "netRevenueCents",
        title: t("net") ?? "Netto",
        align: "right",
        render: (r) => formatCurrency(r.netRevenueCents),
      },
      {
        key: "cashInCents",
        title: t("cash_in") ?? "Cash inn",
        align: "right",
        render: (r) => formatCurrency(r.cashInCents),
      },
      {
        key: "cashOutCents",
        title: t("cash_out") ?? "Cash ut",
        align: "right",
        render: (r) => formatCurrency(r.cashOutCents),
      },
      {
        key: "contributingHallCount",
        title: t("hall_count") ?? "Antall haller",
        align: "right",
      },
    ],
  });

  try {
    const [daily, balance] = await Promise.all([
      getGroupDailyReport({ groupId, dateFrom: currentFrom, dateTo: currentTo }),
      getGroupAccountBalance({ groupId, dateFrom: currentFrom, dateTo: currentTo }),
    ]);
    DataTable.mount<DailyGroupReportRow>(host, {
      rows: daily.rows,
      emptyMessage: t("no_data_available_in_table"),
      className: "group-hall-account",
      columns: [
        { key: "date", title: t("date") },
        {
          key: "gameType",
          title: t("game_type") ?? "Game type",
          render: (r) => escapeHtml(r.gameType ?? "ALL"),
        },
        {
          key: "ticketsSoldCents",
          title: t("revenue") ?? "Omsetning",
          align: "right",
          render: (r) => formatCurrency(r.ticketsSoldCents),
        },
        {
          key: "winningsPaidCents",
          title: t("winnings") ?? "Utbetalt",
          align: "right",
          render: (r) => formatCurrency(r.winningsPaidCents),
        },
        {
          key: "netRevenueCents",
          title: t("net") ?? "Netto",
          align: "right",
          render: (r) => formatCurrency(r.netRevenueCents),
        },
        {
          key: "cashInCents",
          title: t("cash_in") ?? "Cash inn",
          align: "right",
          render: (r) => formatCurrency(r.cashInCents),
        },
        {
          key: "cashOutCents",
          title: t("cash_out") ?? "Cash ut",
          align: "right",
          render: (r) => formatCurrency(r.cashOutCents),
        },
        {
          key: "contributingHallCount",
          title: t("hall_count") ?? "Antall haller",
          align: "right",
        },
      ],
    });
    if (summaryHost) {
      summaryHost.innerHTML = renderBalanceSummary(balance);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    host.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
  }
}

function renderBalanceSummary(b: GroupAccountBalanceResponse): string {
  const hallList = b.hallIds.length > 0
    ? b.hallIds.map((h) => escapeHtml(h)).join(", ")
    : "—";
  return `
    <strong>${escapeHtml(b.groupName)}</strong>
    <small style="opacity:0.7;margin-left:8px;">(${b.hallIds.length} haller: ${hallList})</small>
    <div style="margin-top:6px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
      <div>${escapeHtml(t("cash_balance") ?? "Cash-balanse")}: <strong>${formatCurrency(b.hallCashBalance * 100)} kr</strong></div>
      <div>${escapeHtml(t("dropsafe") ?? "Dropsafe")}: <strong>${formatCurrency(b.dropsafeBalance * 100)} kr</strong></div>
      <div>${escapeHtml(t("net_cash_flow") ?? "Netto cash-flyt")}: <strong>${formatCurrency(b.periodNetCashFlowCents)} kr</strong></div>
      <div>${escapeHtml(t("cash_in") ?? "Cash inn")}: ${formatCurrency(b.periodTotalCashInCents)}</div>
      <div>${escapeHtml(t("cash_out") ?? "Cash ut")}: ${formatCurrency(b.periodTotalCashOutCents)}</div>
      <div>${escapeHtml(t("manual_adjustments") ?? "Manuelle justeringer")}: ${formatCurrency(b.periodManualAdjustmentCents)}</div>
    </div>`;
}
