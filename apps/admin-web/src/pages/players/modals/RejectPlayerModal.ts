// PR-B2: KYC Reject-modal.
// Port av legacy/unity-backend/App/Views/player/PendingRequests/viewPendingPlayer.html:627-714
// (2-stegs SweetAlert: confirm → reason-input → POST /rejectPendingPlayer).
//
// Ny stack: Modal.open som kombinerer begge steg i ett skjema
// (confirm + reason). Backdrop static + keyboard:false. Reason required.

import { Modal, type ModalInstance } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { rejectPlayer, type PlayerSummary } from "../../../api/admin-players.js";
import { ApiError } from "../../../api/client.js";
import { t } from "../../../i18n/I18n.js";
import { escapeHtml } from "../shared.js";

export interface RejectPlayerOptions {
  player: Pick<PlayerSummary, "id" | "email" | "displayName">;
  onRejected?: (updated: PlayerSummary) => void;
}

export function openRejectPlayerModal(opts: RejectPlayerOptions): void {
  const label = opts.player.displayName || opts.player.email || opts.player.id;

  const body = document.createElement("div");
  body.innerHTML = `
    <p>${escapeHtml(t("are_you_sure_want_to_reject_the_request"))}</p>
    <p><strong>${escapeHtml(t("player"))}:</strong> ${escapeHtml(label)}</p>
    <form id="reject-form" novalidate>
      <div class="form-group">
        <label for="reject-reason">${escapeHtml(t("provide_reason_to_reject"))} *</label>
        <textarea id="reject-reason" name="reason" class="form-control" rows="3"
                  maxlength="500" placeholder="${escapeHtml(t("enter_reason"))}" required></textarea>
        <p class="help-block" id="reject-error" style="color:#a94442;display:none;margin-top:4px;">
          ${escapeHtml(t("can_not_reject_without_reason"))}
        </p>
      </div>
    </form>
  `;

  const submit = async (instance: ModalInstance): Promise<void> => {
    const textarea = body.querySelector<HTMLTextAreaElement>("#reject-reason")!;
    const errEl = body.querySelector<HTMLElement>("#reject-error")!;
    const reason = textarea.value.trim();

    if (!reason) {
      errEl.style.display = "block";
      textarea.focus();
      // Swallow rather than throw — Modal's re-enable-on-reject path treats
      // rejected promise as "keep open", but jsdom/vitest surfaces the throw
      // as an unhandled rejection. Returning here keeps the modal open
      // because `dismiss: false` prevents auto-close on success, and we
      // don't call instance.close() unless the POST succeeds.
      return;
    }
    errEl.style.display = "none";

    try {
      const updated = await rejectPlayer(opts.player.id, reason);
      Toast.success(t("player_rejected_success"));
      opts.onRejected?.(updated);
      instance.close("button");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      // keep modal open so the admin can adjust reason and retry
    }
  };

  Modal.open({
    title: t("reject_player_title"),
    content: body,
    backdrop: "static",
    keyboard: false,
    buttons: [
      {
        label: t("no_cancle"),
        variant: "default",
        action: "cancel",
      },
      {
        label: t("yes_reject_it"),
        variant: "danger",
        action: "confirm",
        dismiss: false,
        onClick: submit,
      },
    ],
  });
}
