// Chips-history tab — placeholder (BIN-630).
// Backend-endpoint GET /api/admin/players/:id/chips-history does not exist
// yet (PR-B2-PLAN §2.2).

import { t } from "../../../i18n/I18n.js";
import { escapeHtml } from "../shared.js";

export function mountChipsHistoryTab(host: HTMLElement, _userId: string): void {
  host.innerHTML = `
    <div class="alert alert-info" role="alert">
      <i class="fa fa-info-circle"></i>
      ${escapeHtml(t("chips_history_pending_banner"))}
      <a href="https://linear.app/bingosystem/issue/BIN-630" target="_blank" rel="noopener">BIN-630</a>
    </div>
    <table class="table table-bordered table-striped">
      <thead>
        <tr>
          <th>${escapeHtml(t("date_time"))}</th>
          <th>${escapeHtml(t("transaction_type"))}</th>
          <th>${escapeHtml(t("amount"))}</th>
        </tr>
      </thead>
      <tbody>
        <tr><td colspan="3" class="text-center text-muted">
          ${escapeHtml(t("pending_backend_endpoint"))}
        </td></tr>
      </tbody>
    </table>`;
}
