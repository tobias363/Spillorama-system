// Profile tab — port of common fields from
// legacy/.../player/ApprovedPlayers/profile.html + viewPlayer.html.
// Read-only summary; editing forms are out of scope for PR-B2 (no existing
// PUT /players/:id endpoint in new stack).
//
// Approve-Reject-flyt: when kycStatus === "REJECTED" we also surface the
// moderator-supplied reason, the moderator id, and the rejection timestamp
// (all stored by PlatformService.rejectKycAsAdmin in compliance_data).

import { t } from "../../../i18n/I18n.js";
import type { PlayerSummary } from "../../../api/admin-players.js";
import { escapeHtml, formatDate, formatDateTime, kycBadgeHtml } from "../shared.js";

/** Returns string field from compliance_data, or null if not a non-empty string. */
function str(
  complianceData: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  if (!complianceData) return null;
  const v = complianceData[key];
  return typeof v === "string" && v.trim() ? v : null;
}

export function mountProfileTab(host: HTMLElement, player: PlayerSummary): void {
  const row = (label: string, value: string | null | undefined): string => `
    <tr>
      <th style="width:30%;">${escapeHtml(label)}</th>
      <td>${value ? escapeHtml(value) : "—"}</td>
    </tr>`;

  const rejectionReason = str(player.complianceData, "kycRejectionReason");
  const rejectedBy = str(player.complianceData, "kycRejectedBy");
  const rejectedAtRaw = str(player.complianceData, "kycRejectedAt");
  const rejectedAt = rejectedAtRaw ? formatDateTime(rejectedAtRaw) : null;

  const rejectionRows =
    player.kycStatus === "REJECTED"
      ? `
        ${row(t("rejected_on"), rejectedAt)}
        ${row(t("rejected_by"), rejectedBy)}
        ${row(t("rejection_reason"), rejectionReason)}
      `
      : "";

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
        ${rejectionRows}
        ${row(t("bank_id"), player.kycProviderRef)}
        ${row(t("hall_name"), player.hallId)}
        ${row(t("verified_at"), formatDateTime(player.kycVerifiedAt))}
        ${row(t("created_at"), formatDateTime(player.createdAt))}
        ${row(t("updated_at"), formatDateTime(player.updatedAt))}
      </tbody>
    </table>`;
}
