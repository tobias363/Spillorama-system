// Wireframe gap #10 (2026-04-24): Add Money to Unique ID modal (17.10).
//
// Yes/No-confirm-flow per wireframe — user scans/types the Unique ID,
// picks Amount + Payment Type, then a confirmation step before submit.
// PM-locked rule (Q4): balance AKKUMULERES — 170 + 200 = 370, never 200.

import { t } from "../../../i18n/I18n.js";
import { Modal } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import {
  addMoneyToUniqueId,
  getUniqueIdCard,
  type BalanceMutationResponse,
  type UniqueIdPaymentType,
} from "../../../api/agent-unique-ids.js";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function formatKr(cents: number): string {
  return (cents / 100).toFixed(2);
}

export interface AddMoneyUniqueIdModalOpts {
  /** Pre-filled Unique ID if the caller already has it. */
  initialId?: string;
  onSuccess?: (result: BalanceMutationResponse) => void;
}

export function buildAddMoneyForm(initialId = ""): HTMLElement {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <form class="form-horizontal" data-testid="add-money-form" novalidate>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="am-uid">${escapeHtml(t("agent_unique_id_card_id"))}</label>
        <div class="col-sm-8">
          <input type="text" class="form-control" id="am-uid"
            value="${escapeHtml(initialId)}" required
            placeholder="${escapeHtml(t("scan_placeholder"))}" data-testid="unique-id-input">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="am-amount">${escapeHtml(t("agent_unique_id_enter_amount"))}</label>
        <div class="col-sm-8">
          <input type="number" class="form-control" id="am-amount" min="1" step="0.01"
            required data-testid="amount">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="am-payment">${escapeHtml(t("agent_unique_id_payment_type"))}</label>
        <div class="col-sm-8">
          <select class="form-control" id="am-payment" data-testid="payment-type">
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
          </select>
        </div>
      </div>
      <p class="muted" data-testid="current-balance-hint" style="display:none;"></p>
    </form>`;
  // On uniqueId-blur — fetch current balance as hint (best-effort).
  const uidEl = wrap.querySelector<HTMLInputElement>("#am-uid")!;
  const hintEl = wrap.querySelector<HTMLElement>('[data-testid="current-balance-hint"]')!;
  uidEl.addEventListener("blur", () => {
    const id = uidEl.value.trim();
    if (!id) { hintEl.style.display = "none"; return; }
    getUniqueIdCard(id)
      .then((card) => {
        hintEl.style.display = "";
        hintEl.textContent = `${t("agent_unique_id_current_balance")}: ${formatKr(card.balanceCents)} kr`;
      })
      .catch(() => {
        hintEl.style.display = "";
        hintEl.textContent = t("unique_id_not_found");
      });
  });
  return wrap;
}

export function openAddMoneyUniqueIdModal(opts: AddMoneyUniqueIdModalOpts = {}): void {
  const form = buildAddMoneyForm(opts.initialId);
  Modal.open({
    title: t("agent_unique_id_add_money"),
    content: form,
    size: "lg",
    buttons: [
      { label: t("cancel_button"), variant: "default", action: "cancel" },
      {
        label: t("confirm"),
        variant: "primary",
        action: "confirm",
        onClick: async (instance) => {
          const uidEl = form.querySelector<HTMLInputElement>("#am-uid")!;
          const amountEl = form.querySelector<HTMLInputElement>("#am-amount")!;
          const paymentEl = form.querySelector<HTMLSelectElement>("#am-payment")!;
          const uniqueId = uidEl.value.trim();
          const amount = Number(amountEl.value);
          const paymentType = paymentEl.value as UniqueIdPaymentType;
          if (!uniqueId) {
            Toast.error(t("please_enter_unique_id"));
            return;
          }
          if (!Number.isFinite(amount) || amount <= 0) {
            Toast.error(t("amount_must_be_greater_than_zero"));
            return;
          }
          // Yes/No-confirm gate per wireframe.
          const confirmed = window.confirm(
            t("agent_unique_id_confirm_add_money_body", {
              amount: amount.toFixed(2),
              id: uniqueId,
            })
          );
          if (!confirmed) return;
          try {
            const res = await addMoneyToUniqueId(uniqueId, { amount, paymentType });
            Toast.success(
              t("agent_unique_id_add_money_success", {
                amount: (res.transaction.amountCents / 100).toFixed(2),
                balance: formatKr(res.card.balanceCents),
              })
            );
            instance.close("programmatic");
            opts.onSuccess?.(res);
          } catch (err) {
            const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
            Toast.error(msg);
          }
        },
      },
    ],
  });
}

/** Test hook. */
export const __addMoneyUniqueIdModalInternals = { buildAddMoneyForm };
