// PR-B6 (BIN-664) — Leaderboard tier add/edit (PLACEHOLDER).
// Port of legacy/unity-backend/App/Views/LeaderboardManagement/leaderboardAdd.html
// as a read-only placeholder. Backend CRUD is tracked as BIN-668 (P3).
//
// Shows the backend-pending banner and a disabled form so the URL
// (/addLeaderboard) remains reachable from the sidebar / legacy deep-links
// without a broken page.

import { t } from "../../i18n/I18n.js";
import {
  backendPendingBanner,
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "./shared.js";

export function renderAddLeaderboardPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("add_leaderboard_tier")}
    <section class="content">
      ${boxOpen("add_leaderboard_tier", "primary")}
        ${backendPendingBanner()}
        <form class="form-horizontal" data-testid="add-leaderboard-placeholder-form"
          onsubmit="return false">
          <div class="form-group">
            <label class="col-sm-4 control-label" for="lb-place">${escapeHtml(t("place"))}</label>
            <div class="col-sm-8">
              <input type="number" id="lb-place" name="place" class="form-control" disabled
                min="1" placeholder="${escapeHtml(t("please_select_place"))}">
            </div>
          </div>
          <div class="form-group">
            <label class="col-sm-4 control-label" for="lb-points">${escapeHtml(t("points"))}</label>
            <div class="col-sm-8">
              <input type="number" id="lb-points" name="points" class="form-control" disabled
                min="0">
            </div>
          </div>
          <div class="form-group">
            <div class="col-sm-8 col-sm-offset-4">
              <button type="submit" class="btn btn-success disabled" disabled aria-disabled="true">
                ${escapeHtml(t("submit"))}
              </button>
              <a href="#/leaderboard" class="btn btn-default">${escapeHtml(t("cancel_button"))}</a>
            </div>
          </div>
        </form>
      ${boxClose()}
    </section>`;
}
