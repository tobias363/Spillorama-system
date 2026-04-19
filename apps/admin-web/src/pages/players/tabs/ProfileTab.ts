// Profile tab — port of common fields from
// legacy/.../player/ApprovedPlayers/profile.html + viewPlayer.html.
// Read-only summary; editing forms are out of scope for PR-B2 (no existing
// PUT /players/:id endpoint in new stack).

import { t } from "../../../i18n/I18n.js";
import type { PlayerSummary } from "../../../api/admin-players.js";
import { escapeHtml, formatDate, formatDateTime, kycBadgeHtml } from "../shared.js";

export function mountProfileTab(host: HTMLElement, player: PlayerSummary): void {
  const row = (label: string, value: string | null | undefined): string => `
    <tr>
      <th style="width:30%;">${escapeHtml(label)}</th>
      <td>${value ? escapeHtml(value) : "—"}</td>
    </tr>`;

  host.innerHTML = `
    <table class="table table-bordered table-striped">
      <tbody>
        ${row(t("username"), player.displayName)}
        ${row(t("surname"), player.surname)}
        ${row(t("email_address"), player.email)}
        ${row(t("mobile_number"), player.phone)}
        ${row(t("date_of_birth"), formatDate(player.birthDate))}
        <tr>
          <th>${escapeHtml(t("kyc_status"))}</th>
          <td>${kycBadgeHtml(player.kycStatus)}</td>
        </tr>
        ${row(t("bank_id"), player.kycProviderRef)}
        ${row(t("hall_name"), player.hallId)}
        ${row(t("verified_at"), formatDateTime(player.kycVerifiedAt))}
        ${row(t("created_at"), formatDateTime(player.createdAt))}
        ${row(t("updated_at"), formatDateTime(player.updatedAt))}
      </tbody>
    </table>`;
}
