// Wireframe gap #11 (2026-04-24): Withdraw from Unique ID modal (17.11/17.28).
//
// Fields: Unique ID (read-only), Current Balance (read-only), Enter Amount,
// Cancel/Withdraw. Withdraw is cash-only (PM rule) — no payment-type picker.

import { t } from "../../../i18n/I18n.js";
import { Modal } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import {
  getUniqueIdCard,
  withdrawFromUniqueId,
  type BalanceMutationResponse,
  type UniqueIdCard,
} from "../../../api/agent-unique-ids.js";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function formatKr(cents: number): string {
  return (cents / 100).toFixed(2);
}

export interface WithdrawUniqueIdModalOpts {
  uniqueId: string;
  /** Current card if already loaded (avoids an extra fetch). */
  card?: UniqueIdCard;
  onSuccess?: (result: BalanceMutationResponse) => void;
}

export function buildWithdrawForm(card: UniqueIdCard): HTMLElement {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <form class="form-horizontal" data-testid="withdraw-form" novalidate>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="w-uid">${escapeHtml(t("agent_unique_id_card_id"))}</label>
        <div class="col-sm-8">
          <input type="text" class="form-control" id="w-uid"
            value="${escapeHtml(card.id)}" readonly data-testid="unique-id-input">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="w-balance">${escapeHtml(t("agent_unique_id_current_balance"))}</label>
        <div class="col-sm-8">
          <input type="text" class="form-control" id="w-balance"
            value="${formatKr(card.balanceCents)}" readonly data-testid="current-balance">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="w-amount">${escapeHtml(t("agent_unique_id_enter_amount"))}</label>
        <div class="col-sm-8">
          <input type="number" class="form-control" id="w-amount"
            min="1" step="0.01" required autofocus data-testid="amount">
        </div>
      </div>
      <p class="muted" data-testid="cash-only-hint">
        <i class="fa fa-info-circle"></i>
        ${escapeHtml(t("agent_unique_id_cash_only_hint"))}
      </p>
    </form>`;
  return wrap;
}

export function openWithdrawUniqueIdModal(opts: WithdrawUniqueIdModalOpts): void {
  const ensureCard = opts.card ? Promise.resolve(opts.card) : getUniqueIdCard(opts.uniqueId);
  void ensureCard
    .then((card) => {
      const form = buildWithdrawForm(card);
      Modal.open({
        title: t("agent_unique_id_withdraw"),
        content: form,
        buttons: [
          { label: t("cancel_button"), variant: "default", action: "cancel" },
          {
            label: t("agent_unique_id_withdraw"),
            variant: "danger",
            action: "withdraw",
            onClick: async (instance) => {
              const amountEl = form.querySelector<HTMLInputElement>("#w-amount")!;
              const amount = Number(amountEl.value);
              if (!Number.isFinite(amount) || amount <= 0) {
                Toast.error(t("amount_must_be_greater_than_zero"));
                return;
              }
              if (amount * 100 > card.balanceCents) {
                Toast.error(t("amount_more_than_hall_balance"));
                return;
              }
              try {
                const res = await withdrawFromUniqueId(opts.uniqueId, {
                  amount,
                  paymentType: "CASH",
                });
                Toast.success(
                  t("agent_unique_id_withdraw_success", {
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
    })
    .catch((err) => {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
    });
}

/** Test hook. */
export const __withdrawUniqueIdModalInternals = { buildWithdrawForm };
