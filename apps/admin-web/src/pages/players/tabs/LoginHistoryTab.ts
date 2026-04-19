// Login-history tab — placeholder (BIN-629).
// Backend-endpoint GET /api/admin/players/:id/login-history does not exist
// yet (PR-B2-PLAN §2.2). We render the legacy table structure so reviewers
// see the intended UX, but data rows show an information banner.

import { t } from "../../../i18n/I18n.js";
import { escapeHtml } from "../shared.js";

export function mountLoginHistoryTab(host: HTMLElement, _userId: string): void {
  host.innerHTML = `
    <div class="alert alert-info" role="alert">
      <i class="fa fa-info-circle"></i>
      ${escapeHtml(t("login_history_pending_banner"))}
      <a href="https://linear.app/bingosystem/issue/BIN-629" target="_blank" rel="noopener">BIN-629</a>
    </div>
    <table class="table table-bordered table-striped">
      <thead>
        <tr>
          <th>${escapeHtml(t("date_time"))}</th>
          <th>${escapeHtml(t("state"))}</th>
          <th>${escapeHtml(t("description"))}</th>
        </tr>
      </thead>
      <tbody>
        <tr><td colspan="3" class="text-center text-muted">
          ${escapeHtml(t("pending_backend_endpoint"))}
        </td></tr>
      </tbody>
    </table>`;
}
