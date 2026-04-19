// PR-B2: Rejected KYC detail — port of
// legacy/.../player/RejectedRequests/viewRejectedPlayer.html.
// Delegates to PlayerDetailPage with mode="rejected" which renders the
// Resubmit button in the action-row.

import { renderPlayerDetailPage } from "../players/PlayerDetailPage.js";
import { hashParam, escapeHtml, contentHeader } from "../players/shared.js";
import { t } from "../../i18n/I18n.js";

export function renderRejectedDetailPage(container: HTMLElement): void {
  const id = hashParam("id");
  if (!id) {
    container.innerHTML = `
      ${contentHeader("reject_requests")}
      <section class="content">
        <div class="box box-danger"><div class="box-body">
          <p>${escapeHtml(t("player_not_found"))}</p>
          <a class="btn btn-primary" href="#/rejectedRequests">
            <i class="fa fa-arrow-left"></i> ${escapeHtml(t("back"))}
          </a>
        </div></div>
      </section>`;
    return;
  }
  renderPlayerDetailPage(container, { mode: "rejected" });
}
