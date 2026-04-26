// PR-A4b (BIN-659) — /payoutPlayer list page.
//
// (586 lines). Game-select dropdown → per-player payout table filtered by
// selected game.
//
// Backend note: The legacy `/payoutPlayerGetGameManagementDetailList`
// returned an aggregate per-player list filtered by game. The pilot backend
// exposes per-player drill-down only (`/api/admin/payouts/by-player/:userId`)
// — there is no "all players who bet on game X" endpoint. This page
// provides:
//   1. Game-type selector (real data from `/api/admin/games`).
//   2. Free-text "Player ID" input — admin enters a player to drill into.
//   3. Date-range filter.
//   4. Results table with one summary row (totalStakes/totalPrizes/net/
//      gameCount) and a "View details" link to /payoutPlayer/view/:id.
//
// The cross-game aggregation is flagged as a follow-up via a gap-banner;
// the current UI still gives staff the 80% use-case: "look up one player".

import { DataTable } from "../../components/DataTable.js";
import { t } from "../../i18n/I18n.js";
import { apiRequest } from "../../api/client.js";
import { getPayoutsByPlayerDetail } from "../../api/admin-payouts.js";
import type { PayoutPlayerSummaryDto } from "../../api/admin-payouts.js";
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
  isEnabled?: boolean;
}

export async function renderPayoutPlayerPage(container: HTMLElement): Promise<void> {
  const tableHostId = "payout-player-table";
  container.innerHTML = renderReportShell({
    title: t("payout_for_players"),
    moduleTitleKey: "payout_management",
    tableHostId,
    gapBanner: {
      issueId: "BIN-659",
      message: t("payout_cross_game_aggregate_pending"),
    },
  });

  const hostEl = container.querySelector<HTMLElement>(`#${tableHostId}`);
  if (!hostEl) return;
  const host: HTMLElement = hostEl;

  const { from, to } = defaultDateRange();
  let currentFrom = toIsoDate(from);
  let currentTo = toIsoDate(to);
  let currentUserId = "";

  // Prefetch game list (used for filter-bar only — results are per-player).
  let games: GameRow[] = [];
  try {
    const raw = await apiRequest<GameRow[]>("/api/admin/games", { auth: true });
    games = Array.isArray(raw) ? raw : [];
  } catch {
    games = [];
  }

  const handle = DataTable.mount<PayoutPlayerSummaryDto>(host, {
    rows: [],
    emptyMessage: t("no_data_available_in_table"),
    className: "payout-player-list",
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
        // Game-type selector (informational — scopes the page title only;
        // backend endpoint returns aggregated-cross-game totals).
        const gameLabel = document.createElement("label");
        gameLabel.style.cssText = "display:flex;flex-direction:column;font-size:12px;";
        gameLabel.textContent = t("choose_a_game");
        const gameSel = document.createElement("select");
        gameSel.className = "form-control input-sm";
        gameSel.innerHTML =
          `<option value="">${escapeHtml(t("all"))}</option>` +
          games
            .map(
              (g) =>
                `<option value="${escapeHtml(g.slug)}">${escapeHtml(g.title)}</option>`
            )
            .join("");
        gameLabel.append(gameSel);
        slot.append(gameLabel);

        // Player-ID input (required to drill into /payouts/by-player/:userId).
        const pidLabel = document.createElement("label");
        pidLabel.style.cssText = "display:flex;flex-direction:column;font-size:12px;";
        pidLabel.textContent = t("player_id");
        const pidInput = document.createElement("input");
        pidInput.type = "text";
        pidInput.className = "form-control input-sm";
        pidInput.placeholder = t("player_id");
        pidInput.addEventListener("change", () => {
          currentUserId = pidInput.value.trim();
          void reload();
        });
        pidLabel.append(pidInput);
        slot.append(pidLabel);
      },
    },
    csvExport: {
      filename: `payout-player-${currentFrom}_${currentTo}`,
    },
    columns: [
      { key: "playerId", title: t("player_id") },
      {
        key: "totalStakes",
        title: t("total_bet_placed"),
        align: "right",
        render: (r) => formatCurrency(r.totalStakes),
      },
      {
        key: "totalPrizes",
        title: t("total_winning"),
        align: "right",
        render: (r) => formatCurrency(r.totalPrizes),
      },
      {
        key: "net",
        title: t("total_net"),
        align: "right",
        render: (r) => formatCurrency(r.net),
      },
      { key: "gameCount", title: t("game_count"), align: "right" },
      {
        key: "playerId",
        title: t("actions"),
        align: "center",
        render: (r) =>
          `<a class="btn btn-info btn-xs btn-rounded" href="#/payoutPlayer/view/${encodeURIComponent(
            r.playerId
          )}" title="${escapeHtml(t("view"))}"><i class="fa fa-eye" aria-hidden="true"></i></a>`,
      },
    ],
  });

  async function reload(): Promise<void> {
    if (!currentUserId) {
      handle.setRows([]);
      return;
    }
    try {
      const res = await getPayoutsByPlayerDetail({
        userId: currentUserId,
        startDate: currentFrom,
        endDate: currentTo,
      });
      handle.setRows([res.summary]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      host.insertAdjacentHTML(
        "afterbegin",
        `<div class="alert alert-danger">${escapeHtml(msg)}</div>`
      );
    }
  }
}
