// PR-B2: KYC Approve-modal.
// (SweetAlert-confirm → POST /pendingRequests/approvePendingPlayer).
//
// Ny stack: Modal.open → POST /api/admin/players/:id/approve.
// Backdrop: static + keyboard:false — matcher legacy "closeOnConfirm:false"-semantikk.

import { Modal } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { approvePlayer, type PlayerSummary } from "../../../api/admin-players.js";
import { ApiError } from "../../../api/client.js";
import { t } from "../../../i18n/I18n.js";
import { escapeHtml } from "../shared.js";

export interface ApprovePlayerOptions {
  player: Pick<PlayerSummary, "id" | "email" | "displayName">;
  /** Valgfri note som legges i audit-log. Maks 500 tegn. */
  note?: string;
  onApproved?: (updated: PlayerSummary) => void;
}

/**
 * Viser bekreftelses-modal for å godkjenne KYC.
 * Stoler på at backend fire-and-forget sender e-post + audit-logger.
 */
export function openApprovePlayerModal(opts: ApprovePlayerOptions): void {
  const label = opts.player.displayName || opts.player.email || opts.player.id;

  Modal.open({
    title: t("are_you_sure_want_to_approve_the_request"),
    content: `
      <p>${escapeHtml(t("once_performed_can_not_revert"))}</p>
      <p><strong>${escapeHtml(t("player"))}:</strong> ${escapeHtml(label)}</p>
    `,
    backdrop: "static",
    keyboard: false,
    buttons: [
      {
        label: t("no_cancle"),
        variant: "default",
        action: "cancel",
      },
      {
        label: t("yes_approve_it"),
        variant: "success",
        action: "confirm",
        onClick: async () => {
          try {
            const updated = await approvePlayer(opts.player.id, opts.note);
            Toast.success(t("player_approved_success"));
            opts.onApproved?.(updated);
          } catch (err) {
            const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
            Toast.error(msg);
            throw err; // prevent modal close on failure
          }
        },
      },
    ],
  });
}
