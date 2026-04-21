// PR-A4b (BIN-659) — /payoutPlayer/view/:userId detail page.
//
// (126 lines). Read-only detail form for one payout summary: totalBetPlaced,
// totalWinning, profit/loss.

import { t } from "../../i18n/I18n.js";
import { getPayoutsByPlayerDetail } from "../../api/admin-payouts.js";
import type { PayoutsByPlayerResponseDto } from "../../api/admin-payouts.js";
import {
  defaultDateRange,
  formatCurrency,
  renderReportShell,
  toIsoDate,
} from "../reports/shared/reportShell.js";
import { escapeHtml } from "../games/common/escape.js";

export async function renderViewPayoutPlayerPage(
  container: HTMLElement,
  userId: string
): Promise<void> {
  const hostId = "view-payout-player-body";
  container.innerHTML = renderReportShell({
    title: t("payout_player_details"),
    moduleTitleKey: "payout_management",
    subtitle: userId,
    tableHostId: hostId,
    extraBelow: `
      <div style="margin-top:12px">
        <a href="#/payoutPlayer" class="btn btn-default btn-sm">${escapeHtml(t("cancel"))}</a>
      </div>`,
  });

  const hostEl = container.querySelector<HTMLElement>(`#${hostId}`);
  if (!hostEl) return;
  const host: HTMLElement = hostEl;

  const { from, to } = defaultDateRange();
  const startDate = toIsoDate(from);
  const endDate = toIsoDate(to);

  try {
    const res: PayoutsByPlayerResponseDto = await getPayoutsByPlayerDetail({
      userId,
      startDate,
      endDate,
    });
    host.innerHTML = `
      <form class="form-horizontal">
        <div class="form-group">
          <label class="control-label col-sm-3">${escapeHtml(t("username"))}:</label>
          <div class="col-sm-9">
            <input type="text" class="form-control" readonly disabled value="${escapeHtml(res.summary.playerId)}">
          </div>
        </div>
        <div class="form-group">
          <label class="control-label col-sm-3">${escapeHtml(t("total_bet_placed"))}:</label>
          <div class="col-sm-9">
            <input type="text" class="form-control" readonly disabled value="${formatCurrency(res.summary.totalStakes)}">
          </div>
        </div>
        <div class="form-group">
          <label class="control-label col-sm-3">${escapeHtml(t("total_winning"))}:</label>
          <div class="col-sm-9">
            <input type="text" class="form-control" readonly disabled value="${formatCurrency(res.summary.totalPrizes)}">
          </div>
        </div>
        <div class="form-group">
          <label class="control-label col-sm-3">${escapeHtml(t("total_net"))}:</label>
          <div class="col-sm-9">
            <input type="text" class="form-control" readonly disabled value="${formatCurrency(res.summary.net)}">
          </div>
        </div>
        <div class="form-group">
          <label class="control-label col-sm-3">${escapeHtml(t("game_count"))}:</label>
          <div class="col-sm-9">
            <input type="text" class="form-control" readonly disabled value="${res.summary.gameCount}">
          </div>
        </div>
      </form>`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    host.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
  }
}
