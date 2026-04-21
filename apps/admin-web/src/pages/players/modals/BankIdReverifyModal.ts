// PR-B2: BankID-reverify-modal.
// (BankID-reverify-knapp → POST /bankid-reverify).
//
// Flow:
//   1. Admin klikker "Reverify BankID" på approved/profile.
//   2. Confirm (modal).
//   3. POST /api/admin/players/:id/bankid-reverify.
//   4. Hvis bankIdConfigured === false → mock-mode-banner i modal + resultat.
//   5. Hvis session returneres → vis "Open BankID session"-knapp som åpner
//      /bankid/verify?sessionId=X i ny fane (legacy-paritet — iframe-embed).

import { Modal } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { bankIdReverify, type PlayerSummary } from "../../../api/admin-players.js";
import { buildVerifyHash } from "../../../api/admin-bankid.js";
import { ApiError } from "../../../api/client.js";
import { t } from "../../../i18n/I18n.js";
import { escapeHtml } from "../shared.js";

export interface BankIdReverifyOptions {
  player: Pick<PlayerSummary, "id" | "email" | "displayName">;
  onReverified?: (updated: PlayerSummary) => void;
}

export function openBankIdReverifyModal(opts: BankIdReverifyOptions): void {
  const label = opts.player.displayName || opts.player.email || opts.player.id;

  Modal.open({
    title: t("bankid_reverify_title"),
    content: `
      <p>${escapeHtml(t("bankid_reverify_confirm_text"))}</p>
      <p><strong>${escapeHtml(t("player"))}:</strong> ${escapeHtml(label)}</p>
    `,
    backdrop: "static",
    keyboard: false,
    buttons: [
      { label: t("no_cancle"), variant: "default", action: "cancel" },
      {
        label: t("bankid_reverify_start"),
        variant: "primary",
        action: "confirm",
        onClick: async () => {
          try {
            const result = await bankIdReverify(opts.player.id);
            opts.onReverified?.(result.user);
            if (!result.bankIdConfigured) {
              Toast.warning(t("bankid_not_configured_mock_mode"));
              return;
            }
            if (result.bankIdSession) {
              const url = buildVerifyHash(
                result.bankIdSession.sessionId,
                result.bankIdSession.authUrl
              );
              window.open(url, "_blank");
              Toast.success(t("bankid_session_opened"));
              return;
            }
            Toast.warning(t("bankid_session_not_issued"));
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
