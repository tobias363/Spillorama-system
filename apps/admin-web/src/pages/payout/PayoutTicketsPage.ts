// PR-A4b (BIN-659) — /payoutTickets list page.
//
// (412 lines). Per-game ticket-level payout breakdown.
//
// Backend: `/api/admin/payouts/by-game/:gameId/tickets` — returns
// physical-tickets + aggregate session-summary for one gameId. The cross-
// game aggregation is out of scope for the pilot (legacy
// `/payoutTicketsGetGameManagementDetailList`) and flagged via gap-banner.

import { DataTable } from "../../components/DataTable.js";
import { t } from "../../i18n/I18n.js";
import { apiRequest } from "../../api/client.js";
import { getPayoutsByGameTicketsDetail } from "../../api/admin-payouts.js";
import type { PhysicalTicketSoldDto } from "../../api/admin-payouts.js";
import {
  defaultDateRange,
  formatCurrency,
  renderReportShell,
  toIsoDate,
} from "../reports/shared/reportShell.js";
import { escapeHtml } from "../games/common/escape.js";

interface GameRow {
  slug: string;
  title: string;
}

export async function renderPayoutTicketsPage(container: HTMLElement): Promise<void> {
  const tableHostId = "payout-tickets-table";
  container.innerHTML = renderReportShell({
    title: t("payout_for_ticket"),
    moduleTitleKey: "payout_management",
    tableHostId,
    gapBanner: {
      issueId: "BIN-659",
      message: t("payout_cross_game_aggregate_pending"),
    },
    extraBelow: `<div id="payout-tickets-summary" class="well well-sm" style="margin-top:12px"></div>`,
  });

  const hostEl = container.querySelector<HTMLElement>(`#${tableHostId}`);
  const summaryHost = container.querySelector<HTMLElement>("#payout-tickets-summary");
  if (!hostEl) return;
  const host: HTMLElement = hostEl;

  const { from, to } = defaultDateRange();
  let currentFrom = toIsoDate(from);
  let currentTo = toIsoDate(to);
  let currentGameId = "";

  let games: GameRow[] = [];
  try {
    const raw = await apiRequest<GameRow[]>("/api/admin/games", { auth: true });
    games = Array.isArray(raw) ? raw : [];
  } catch {
    games = [];
  }

  const handle = DataTable.mount<PhysicalTicketSoldDto>(host, {
    rows: [],
    emptyMessage: t("no_data_available_in_table"),
    className: "payout-tickets-list",
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
        label.style.cssText = "display:flex;flex-direction:column;font-size:12px;";
        label.textContent = t("game_id");
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "form-control input-sm";
        inp.placeholder = t("game_id");
        inp.addEventListener("change", () => {
          currentGameId = inp.value.trim();
          void reload();
        });
        label.append(inp);
        slot.append(label);

        if (games.length > 0) {
          const gLabel = document.createElement("label");
          gLabel.style.cssText = "display:flex;flex-direction:column;font-size:12px;";
          gLabel.textContent = t("game_type");
          const gSel = document.createElement("select");
          gSel.className = "form-control input-sm";
          gSel.innerHTML =
            `<option value="">${escapeHtml(t("all"))}</option>` +
            games
              .map(
                (g) =>
                  `<option value="${escapeHtml(g.slug)}">${escapeHtml(g.title)}</option>`
              )
              .join("");
          gLabel.append(gSel);
          slot.append(gLabel);
        }
      },
    },
    csvExport: {
      filename: `payout-tickets-${currentFrom}_${currentTo}`,
    },
    columns: [
      { key: "ticketId", title: t("ticket_id") },
      { key: "uniqueId", title: t("unique_id") },
      { key: "hallId", title: t("hall_id") },
      {
        key: "amountCents",
        title: t("total_stakes"),
        align: "right",
        render: (r) => (r.amountCents == null ? "—" : formatCurrency(r.amountCents)),
      },
      { key: "soldAt", title: t("created_at") },
      {
        key: "ticketId",
        title: t("actions"),
        align: "center",
        render: (r) =>
          `<a class="btn btn-info btn-xs btn-rounded" href="#/payoutTickets/view/${encodeURIComponent(
            r.ticketId
          )}" title="${escapeHtml(t("view"))}"><i class="fa fa-eye"></i></a>`,
      },
    ],
  });

  async function reload(): Promise<void> {
    if (!currentGameId) {
      handle.setRows([]);
      if (summaryHost) summaryHost.innerHTML = "";
      return;
    }
    try {
      const res = await getPayoutsByGameTicketsDetail({
        gameId: currentGameId,
        startDate: currentFrom,
        endDate: currentTo,
      });
      handle.setRows(res.physicalTickets);
      if (summaryHost) {
        const s = res.sessionSummary;
        summaryHost.innerHTML = s
          ? `<strong>${escapeHtml(t("total_stakes"))}:</strong> ${formatCurrency(s.totalStakes)} NOK &nbsp;·&nbsp;
             <strong>${escapeHtml(t("total_prizes"))}:</strong> ${formatCurrency(s.totalPrizes)} NOK &nbsp;·&nbsp;
             <strong>${escapeHtml(t("net"))}:</strong> ${formatCurrency(s.net)} NOK &nbsp;·&nbsp;
             <strong>${escapeHtml(t("physical_tickets_sold"))}:</strong> ${res.physicalTicketCount}`
          : `<strong>${escapeHtml(t("physical_tickets_sold"))}:</strong> ${res.physicalTicketCount}`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      host.insertAdjacentHTML(
        "afterbegin",
        `<div class="alert alert-danger">${escapeHtml(msg)}</div>`
      );
    }
  }
}
