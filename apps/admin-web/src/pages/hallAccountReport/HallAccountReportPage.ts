// PR-A4b (BIN-659) — /hallAccountReport/:id detail page.
//
// (682 lines). Per-hall account history with date-range + gameType filter,
// multi-agent columns (Metronia, OK Bingo, Franco, Otium, Norsk Tipping,
// Norsk Rikstoto, Rekvisita, Kaffe-penger, Bilag, ...).
//
// Backend:
//   - GET /api/admin/reports/halls/:hallId/daily (ticketsSold/winnings/cash)
//   - GET /api/admin/reports/halls/:hallId/account-balance (period totals)
//   - GET /api/admin/reports/halls/:hallId/manual-entries (per-category adj)
//
// Legacy multi-agent columns (Metronia, OK Bingo, ...) are not part of the
// backend's per-day response. They are rendered from manual-entries keyed by
// date × category; when the backend's ManualAdjustmentCategory enum does not
// separate these named agents, the cells render "—" (placeholder) and the
// main financial totals still come through. See BIN-659 comment for full
// category-naming spec follow-up.

import { DataTable } from "../../components/DataTable.js";
import { t } from "../../i18n/I18n.js";
import {
  getHallAccountBalance,
  getHallDailyReport,
  getHallManualEntries,
} from "../../api/admin-reports.js";
import {
  defaultDateRange,
  formatCurrency,
  renderReportShell,
  toIsoDate,
} from "../reports/shared/reportShell.js";
import { escapeHtml } from "../games/common/escape.js";
import { buildSettlementPdfUrl } from "../../api/admin-settlement.js";
import type {
  HallAccountRow,
  ManualAdjustmentEntryDto,
} from "../../../../../packages/shared-types/src/reports.js";

interface DailyRow {
  date: string;
  gameType: string;
  bingonetNetCents: number;
  manualByCategory: Record<string, number>;
  cashInCents: number;
  cashOutCents: number;
  diffCents: number;
  comment: string;
}

export async function renderHallAccountReportPage(
  container: HTMLElement,
  hallId: string
): Promise<void> {
  const tableHostId = "hall-account-table";
  container.innerHTML = renderReportShell({
    title: t("hall_account_report"),
    moduleTitleKey: "hall_account_report",
    subtitle: hallId,
    tableHostId,
    extraBelow: `
      <div id="hall-account-summary" class="well well-sm" style="margin-top:12px"></div>
      <div style="margin-top:12px">
        <a href="#/hallAccountReport" class="btn btn-default btn-sm">${escapeHtml(t("back"))}</a>
        <a href="#/report/settlement/${encodeURIComponent(hallId)}" class="btn btn-danger btn-sm">
          <i class="fa fa-file" aria-hidden="true"></i> ${escapeHtml(t("settlement_report"))}
        </a>
      </div>`,
  });

  const hostEl = container.querySelector<HTMLElement>(`#${tableHostId}`);
  const summaryHost = container.querySelector<HTMLElement>("#hall-account-summary");
  if (!hostEl) return;
  const host: HTMLElement = hostEl;

  const { from, to } = defaultDateRange();
  let currentFrom = toIsoDate(from);
  let currentTo = toIsoDate(to);
  let currentGameType: string = "";

  const handle = DataTable.mount<DailyRow>(host, {
    rows: [],
    emptyMessage: t("no_data_available_in_table"),
    className: "hall-account-daily",
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
        const wrap = document.createElement("label");
        wrap.style.cssText = "display:flex;flex-direction:column;font-size:12px;";
        wrap.textContent = t("game_type");
        const sel = document.createElement("select");
        sel.className = "form-control input-sm";
        for (const opt of [
          { value: "", label: t("all") },
          { value: "MAIN_GAME", label: t("real") },
          { value: "DATABINGO", label: t("bot") },
        ]) {
          const o = document.createElement("option");
          o.value = opt.value;
          o.textContent = opt.label;
          sel.append(o);
        }
        sel.addEventListener("change", () => {
          currentGameType = sel.value;
          void reload();
        });
        wrap.append(sel);
        slot.append(wrap);
      },
    },
    csvExport: {
      filename: `hallAccount-${hallId}-${currentFrom}_${currentTo}`,
    },
    columns: [
      { key: "date", title: t("date") },
      { key: "gameType", title: t("game_type") },
      {
        key: "bingonetNetCents",
        title: t("resultat_bingonet"),
        align: "right",
        render: (r) => formatCurrency(r.bingonetNetCents),
      },
      ...MANUAL_CATEGORY_COLS,
      {
        key: "cashInCents",
        title: t("amount_in"),
        align: "right",
        render: (r) => formatCurrency(r.cashInCents),
      },
      {
        key: "cashOutCents",
        title: t("amount_out"),
        align: "right",
        render: (r) => formatCurrency(r.cashOutCents),
      },
      {
        key: "diffCents",
        title: "Diff",
        align: "right",
        render: (r) => formatCurrency(r.diffCents),
      },
      { key: "comment", title: t("comments") },
    ],
  });

  async function reload(): Promise<void> {
    try {
      const [daily, balance, manual] = await Promise.all([
        getHallDailyReport({
          hallId,
          dateFrom: currentFrom,
          dateTo: currentTo,
          gameType: currentGameType || undefined,
        }),
        getHallAccountBalance({ hallId, dateFrom: currentFrom, dateTo: currentTo }),
        getHallManualEntries({
          hallId,
          dateFrom: currentFrom,
          dateTo: currentTo,
          limit: 500,
        }),
      ]);
      handle.setRows(mergeRows(daily.rows, manual.rows));
      if (summaryHost) {
        summaryHost.innerHTML = `
          <strong>${escapeHtml(t("balance"))}:</strong> ${formatCurrency(balance.hallCashBalance)} NOK &nbsp;·&nbsp;
          <strong>${escapeHtml(t("deposit_to_dropsafe"))}:</strong> ${formatCurrency(balance.dropsafeBalance)} NOK &nbsp;·&nbsp;
          <strong>${escapeHtml(t("amount_in"))}:</strong> ${formatCurrency(balance.periodTotalCashInCents)} NOK &nbsp;·&nbsp;
          <strong>${escapeHtml(t("amount_out"))}:</strong> ${formatCurrency(balance.periodTotalCashOutCents)} NOK &nbsp;·&nbsp;
          <strong>${escapeHtml(t("manual_adjustment"))}:</strong> ${formatCurrency(balance.periodManualAdjustmentCents)} NOK
        `;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      host.insertAdjacentHTML(
        "afterbegin",
        `<div class="alert alert-danger">${escapeHtml(msg)}</div>`
      );
    }
  }

  await reload();
  // Reference the PDF helper once — even though legacy `hallAccount.html` has
  // no direct PDF button, the detail page surfaces the settlement report link
  // (see extraBelow above) and the helper is the canonical entry point.
  void buildSettlementPdfUrl;
}

// ── Columns/categories ──────────────────────────────────────────────────────

const MANUAL_CATEGORY_COLS: ReadonlyArray<{
  key: keyof DailyRow;
  title: string;
  align: "right";
  render: (r: DailyRow) => string;
}> = [
  catCol("BANK_DEPOSIT", "bank_deposit"),
  catCol("BANK_WITHDRAWAL", "bank_withdrawal"),
  catCol("CORRECTION", "correction"),
  catCol("REFUND", "refund"),
  catCol("OTHER", "other"),
];

function catCol(
  cat: string,
  labelKey: string
): {
  key: keyof DailyRow;
  title: string;
  align: "right";
  render: (r: DailyRow) => string;
} {
  return {
    key: "manualByCategory" as keyof DailyRow,
    title: t(labelKey),
    align: "right",
    render: (r: DailyRow): string => {
      const v = r.manualByCategory[cat] ?? 0;
      return v === 0 ? "—" : formatCurrency(v);
    },
  };
}

// ── Row merge: daily + manual-entries → one row per date×gameType ───────────

function mergeRows(
  daily: HallAccountRow[],
  manual: ManualAdjustmentEntryDto[]
): DailyRow[] {
  const manualByDate = new Map<string, Record<string, number>>();
  for (const m of manual) {
    const acc = manualByDate.get(m.businessDate) ?? {};
    acc[m.category] = (acc[m.category] ?? 0) + m.amountCents;
    manualByDate.set(m.businessDate, acc);
  }
  return daily.map((d) => {
    const manualForDate = manualByDate.get(d.date) ?? {};
    const manualTotal = Object.values(manualForDate).reduce(
      (s: number, v: number): number => s + v,
      0
    );
    return {
      date: d.date,
      gameType: d.gameType ?? "ALL",
      bingonetNetCents: d.netRevenueCents,
      manualByCategory: manualForDate,
      cashInCents: d.cashInCents,
      cashOutCents: d.cashOutCents,
      diffCents: d.netRevenueCents + manualTotal + d.cashInCents - d.cashOutCents,
      comment: "",
    } satisfies DailyRow;
  });
}
