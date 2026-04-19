// PR-B4 (BIN-646) — felles accept/reject-modal for payment-requests.
// Gjenbrukes av:
//   - Amountwithdraw/bankRequests + hallRequests (withdraw-accept/reject)
//   - TransactionManagement/depositRequests (deposit-accept m/Cash-Card, reject)
//
// Regulatorisk hard-krav (PR-B4-PLAN §3):
//   - Alle accept/reject sender request → backend logger AuditLog-event
//     (payments.request.accept/reject). Modal viser actor-rolle + timestamp i
//     footer for synlig sporbarhet.
//   - reject krever non-empty reason (client-side validering før POST).
//   - deposit-accept ber om paymentType Cash/Card (BIN-653-forward-compat).
//   - fail-closed: backend-error → Toast + modal blir åpen (ingen silent
//     success).
//
// Ingen 4-eyes/terskel-blokkering — legacy har det ikke, flagget som
// BIN-646-G7 for separat policy-avklaring.

import { t } from "../../../i18n/I18n.js";
import { Modal } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import { getSession } from "../../../auth/Session.js";
import {
  acceptPaymentRequest,
  rejectPaymentRequest,
  type PaymentRequest,
  type PaymentRequestKind,
} from "../../../api/admin-payments.js";
import { escapeHtml, formatAmountCents } from "../shared.js";

export type PaymentActionKind =
  | "deposit-accept"
  | "deposit-reject"
  | "withdraw-accept"
  | "withdraw-reject";

export interface PaymentActionModalOptions {
  kind: PaymentActionKind;
  request: PaymentRequest;
  /** Optional player-name/customerNumber — shown in modal-body if provided. */
  playerLabel?: string;
  onSuccess?: () => void;
}

/**
 * Open the modal. The modal owns its lifecycle — will self-close on success
 * and call onSuccess. On error, stays open and surfaces Toast.error.
 */
export function openPaymentActionModal(opts: PaymentActionModalOptions): void {
  const { kind, request, playerLabel, onSuccess } = opts;
  const isAccept = kind.endsWith("accept");
  const isDeposit = kind.startsWith("deposit");
  const requestKind: PaymentRequestKind = isDeposit ? "deposit" : "withdraw";

  const session = getSession();
  const actorLabel = session
    ? `${escapeHtml(session.name)} (${escapeHtml(session.role)})`
    : escapeHtml(t("system"));
  const now = new Date().toISOString().slice(0, 16).replace("T", " ");

  const body = document.createElement("div");
  body.innerHTML = renderBody({ kind, request, playerLabel, actorLabel, now });

  const title = isAccept
    ? t(isDeposit ? "accept_deposit_request" : "accept_withdraw_request")
    : t(isDeposit ? "reject_deposit_request" : "reject_withdraw_request");

  Modal.open({
    title,
    content: body,
    backdrop: "static",
    keyboard: false,
    buttons: [
      { label: t("cancel_button"), variant: "default", action: "cancel", dismiss: true },
      {
        label: isAccept ? t("acceptbtn") : t("rejectbtn"),
        variant: isAccept ? "success" : "danger",
        action: "confirm",
        dismiss: false,
        onClick: async (instance) => {
          try {
            if (isAccept) {
              const paymentType = readPaymentType(body);
              if (isDeposit && !paymentType) {
                Toast.error(t("payment_type") + " " + t("reason_required"));
                return;
              }
              await acceptPaymentRequest(request.id, {
                type: requestKind,
                ...(paymentType ? { paymentType } : {}),
              });
              Toast.success(
                t(
                  isDeposit
                    ? "deposit_request_accepted_successfully"
                    : "withdraw_request_accepted_successfully"
                )
              );
            } else {
              const reason = readReason(body);
              if (!reason) {
                Toast.error(t("reason_required"));
                return;
              }
              await rejectPaymentRequest(request.id, {
                type: requestKind,
                reason,
              });
              Toast.success(
                t(
                  isDeposit
                    ? "deposit_requset_is_rejct_successfully"
                    : "withdraw_request_is_rejected_successfully"
                )
              );
            }
            instance.close("button");
            onSuccess?.();
          } catch (err) {
            // Regulatorisk: fail-closed. Modal forblir åpen så operatør ser
            // at handlingen IKKE ble utført — ingen silent success.
            const msg =
              err instanceof ApiError ? err.message : t("something_went_wrong");
            Toast.error(msg);
          }
        },
      },
    ],
  });
}

interface BodyCtx {
  kind: PaymentActionKind;
  request: PaymentRequest;
  playerLabel: string | undefined;
  actorLabel: string;
  now: string;
}

function renderBody(ctx: BodyCtx): string {
  const { kind, request, playerLabel, actorLabel, now } = ctx;
  const amount = formatAmountCents(request.amountCents);
  const dest =
    request.destinationType === "bank"
      ? t("bank_account_number")
      : request.destinationType === "hall"
        ? t("hall_name")
        : "";
  const destRow = dest
    ? `<div class="row"><div class="col-sm-5"><strong>${escapeHtml(t("type"))}:</strong></div><div class="col-sm-7">${escapeHtml(dest)}</div></div>`
    : "";
  const playerRow = playerLabel
    ? `<div class="row"><div class="col-sm-5"><strong>${escapeHtml(t("player_name"))}:</strong></div><div class="col-sm-7">${escapeHtml(playerLabel)}</div></div>`
    : "";

  const summary = `
    <div class="well" style="background:#f9f9f9;padding:10px;margin-bottom:12px;">
      ${playerRow}
      <div class="row"><div class="col-sm-5"><strong>${escapeHtml(t("withdraw_amount"))}:</strong></div><div class="col-sm-7">${escapeHtml(amount)} NOK</div></div>
      ${destRow}
      <div class="row"><div class="col-sm-5"><strong>${escapeHtml(t("customer_number"))}:</strong></div><div class="col-sm-7">${escapeHtml(request.userId)}</div></div>
    </div>`;

  let actionFields = "";
  if (kind === "deposit-accept") {
    actionFields = `
      <div class="form-group">
        <label>${escapeHtml(t("payment_type"))}</label>
        <div>
          <label class="radio-inline">
            <input type="radio" name="paymentType" value="cash" checked>
            ${escapeHtml(t("cash"))}
          </label>
          <label class="radio-inline">
            <input type="radio" name="paymentType" value="card">
            ${escapeHtml(t("card"))}
          </label>
        </div>
      </div>`;
  } else if (kind === "withdraw-accept") {
    actionFields = `
      <div class="callout callout-warning" style="margin:0 0 12px 0;">
        ${escapeHtml(t("do_you_want_to_accept_this_request"))}
      </div>`;
  } else {
    // reject
    actionFields = `
      <div class="form-group">
        <label for="reject-reason">${escapeHtml(t("rejection_reason"))} *</label>
        <textarea id="reject-reason" class="form-control" rows="3" required
          placeholder="${escapeHtml(t("reason_required"))}"></textarea>
      </div>`;
  }

  const audit = `
    <hr style="margin:8px 0;">
    <div style="font-size:11px;color:#888;">
      ${escapeHtml(t("actor"))}: ${actorLabel} · ${escapeHtml(now)} UTC
    </div>`;

  return summary + actionFields + audit;
}

function readPaymentType(root: HTMLElement): "cash" | "card" | null {
  const selected = root.querySelector<HTMLInputElement>(
    "input[name='paymentType']:checked"
  );
  if (!selected) return null;
  const v = selected.value;
  return v === "cash" || v === "card" ? v : null;
}

function readReason(root: HTMLElement): string {
  const ta = root.querySelector<HTMLTextAreaElement>("#reject-reason");
  return ta ? ta.value.trim() : "";
}
