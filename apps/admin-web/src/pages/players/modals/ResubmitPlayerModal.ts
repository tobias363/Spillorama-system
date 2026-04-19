// PR-B2: KYC Resubmit-modal.
// Port av legacy/unity-backend/App/Views/player/RejectedRequests/viewRejectedPlayer.html
// (SweetAlert-confirm → POST /rejectedRequests/resubmit).

import { Modal } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { resubmitPlayer, type PlayerSummary } from "../../../api/admin-players.js";
import { ApiError } from "../../../api/client.js";
import { t } from "../../../i18n/I18n.js";
import { escapeHtml } from "../shared.js";

export interface ResubmitPlayerOptions {
  player: Pick<PlayerSummary, "id" | "email" | "displayName">;
  onResubmitted?: (updated: PlayerSummary) => void;
}

export function openResubmitPlayerModal(opts: ResubmitPlayerOptions): void {
  const label = opts.player.displayName || opts.player.email || opts.player.id;

  Modal.open({
    title: t("resubmit_kyc_title"),
    content: `
      <p>${escapeHtml(t("resubmit_kyc_confirm_text"))}</p>
      <p><strong>${escapeHtml(t("player"))}:</strong> ${escapeHtml(label)}</p>
    `,
    backdrop: "static",
    keyboard: false,
    buttons: [
      { label: t("no_cancle"), variant: "default", action: "cancel" },
      {
        label: t("yes_resubmit_it"),
        variant: "primary",
        action: "confirm",
        onClick: async () => {
          try {
            const updated = await resubmitPlayer(opts.player.id);
            Toast.success(t("player_resubmitted_success"));
            opts.onResubmitted?.(updated);
          } catch (err) {
            const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
            Toast.error(msg);
            throw err;
          }
        },
      },
    ],
  });
}
