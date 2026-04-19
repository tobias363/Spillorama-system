// PR-B2: Pending KYC detail — port of
// legacy/.../player/PendingRequests/viewPendingPlayer.html.
//
// Delegates to the shared PlayerDetailPage with mode="pending". The mode
// triggers Approve/Reject buttons in the action-row. Forward-to-admin is
// rendered as a disabled placeholder per PM answer Q5 (BIN-631).

import { renderPlayerDetailPage } from "../players/PlayerDetailPage.js";
import { hashParam, escapeHtml, contentHeader } from "../players/shared.js";
import { t } from "../../i18n/I18n.js";

export function renderPendingDetailPage(container: HTMLElement): void {
  const id = hashParam("id");
  if (!id) {
    container.innerHTML = `
      ${contentHeader("pending_requests")}
      <section class="content">
        <div class="box box-danger"><div class="box-body">
          <p>${escapeHtml(t("player_not_found"))}</p>
          <a class="btn btn-primary" href="#/pendingRequests">
            <i class="fa fa-arrow-left"></i> ${escapeHtml(t("back"))}
          </a>
        </div></div>
      </section>`;
    return;
  }
  renderPlayerDetailPage(container, { mode: "pending" });

  // Append disabled Forward-to-admin placeholder (BIN-631) after detail mounts.
  // Uses setTimeout 0 to wait for detail's async data-load to render the
  // action-row, then appends the disabled button.
  window.setTimeout(() => {
    const actionRow = container.querySelector<HTMLElement>("#player-action-row");
    if (!actionRow) return;
    if (actionRow.querySelector('[data-action="forward-to-admin"]')) return;
    const btn = document.createElement("button");
    btn.className = "btn btn-default btn-flat";
    btn.disabled = true;
    btn.title = t("forward_to_admin_pending_tooltip");
    btn.setAttribute("data-action", "forward-to-admin");
    btn.innerHTML = `<i class="fa fa-share"></i> ${escapeHtml(t("forward_to_admin"))}`;
    actionRow.appendChild(document.createTextNode(" "));
    actionRow.appendChild(btn);
  }, 250);
}
