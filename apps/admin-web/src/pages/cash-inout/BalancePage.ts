// BalancePage — shared port of the four add/withdraw flows:
//   legacy cash-inout/unique-id-balance.html   (mode: "unique-id")
//   legacy cash-inout/register-user-balance.html (mode: "register-user")
//
// Each page has two actions (add/withdraw) via query string.
// URLs:
//   #/agent/unique-id/add
//   #/agent/unique-id/withdraw
//   #/agent/register-user/add
//   #/agent/register-user/withdraw

import { t } from "../../i18n/I18n.js";
import { Modal } from "../../components/Modal.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import { cashIn, cashOut, lookupPlayer, type PaymentType } from "../../api/agent-cash.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, formatNOK } from "./shared.js";

export type BalanceMode = "unique-id" | "register-user";
export type BalanceAction = "add" | "withdraw";

export function renderBalancePage(container: HTMLElement, mode: BalanceMode, action: BalanceAction): void {
  const titleKey =
    mode === "unique-id"
      ? action === "add" ? "add_money_unique_id" : "withdraw_money_unique_id"
      : action === "add" ? "add_money_register_user" : "withdraw_money_register_user";

  const usernameLabel = mode === "unique-id"
    ? t("enter_unique_id")
    : t("enter_username_customer_number_phone_number");

  container.innerHTML = `
    ${contentHeader(titleKey)}
    <section class="content">
      ${boxOpen(action === "add" ? "add_money" : "withdraw_money", "primary")}
        <form id="balance-form" class="form-horizontal" novalidate>
          <div class="form-group">
            <label class="col-sm-3 control-label" for="identity">${escapeHtml(usernameLabel)}</label>
            <div class="col-sm-6">
              <input type="text" class="form-control" id="identity" autocomplete="off" required>
              <small class="help-block" id="balance-result" style="color:#28a745;"></small>
            </div>
          </div>
          <div class="form-group">
            <label class="col-sm-3 control-label" for="amount">${escapeHtml(t("amount"))} (kr)</label>
            <div class="col-sm-3">
              <input type="number" min="1" step="1" class="form-control" id="amount" autocomplete="off" required>
            </div>
          </div>
          <div class="form-group">
            <label class="col-sm-3 control-label" for="paymentType">${escapeHtml(t("select_payment_type"))}</label>
            <div class="col-sm-3">
              <select class="form-control" id="paymentType" required>
                <option value="Cash">${escapeHtml(t("cash"))}</option>
                ${action === "add" ? `<option value="Card">${escapeHtml(t("card"))}</option>` : ""}
              </select>
            </div>
          </div>
          <div class="form-group">
            <div class="col-sm-offset-3 col-sm-9">
              <button type="submit" class="btn btn-success">${escapeHtml(t(action))}</button>
              <a href="#/agent/cashinout" class="btn btn-danger">${escapeHtml(t("cancel"))}</a>
            </div>
          </div>
        </form>
      ${boxClose()}
    </section>`;

  const form = container.querySelector<HTMLFormElement>("#balance-form")!;
  const identity = form.querySelector<HTMLInputElement>("#identity")!;
  const balanceResult = form.querySelector<HTMLElement>("#balance-result")!;

  let resolvedPlayerId: string | null = null;
  let lastBalance: number | null = null;

  const doLookup = async (): Promise<void> => {
    const q = identity.value.trim();
    if (!q) {
      balanceResult.textContent = "";
      resolvedPlayerId = null;
      return;
    }
    try {
      const p = mode === "unique-id"
        ? await lookupPlayer({ uniqueId: q })
        : await lookupPlayer({ username: q });
      resolvedPlayerId = p.id;
      lastBalance = p.balance;
      balanceResult.textContent = `${t("current_balance")}: ${formatNOK(p.balance)} kr`;
      balanceResult.style.color = "#00a65a";
    } catch (err) {
      resolvedPlayerId = null;
      const msg = err instanceof ApiError ? err.message : t("player_not_found");
      balanceResult.textContent = msg;
      balanceResult.style.color = "#dd4b39";
    }
  };

  let typingTimer: number | null = null;
  identity.addEventListener("input", () => {
    if (typingTimer !== null) window.clearTimeout(typingTimer);
    typingTimer = window.setTimeout(() => void doLookup(), 500);
  });
  identity.addEventListener("blur", () => {
    if (typingTimer !== null) window.clearTimeout(typingTimer);
    void doLookup();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const amount = Number((form.querySelector<HTMLInputElement>("#amount")!).value);
    const paymentType = (form.querySelector<HTMLSelectElement>("#paymentType")!).value as PaymentType;

    if (!resolvedPlayerId) {
      Toast.error(t("player_not_found"));
      return;
    }
    if (!Number.isFinite(amount) || amount < 1) {
      Toast.error(t("amount_should_be_between_1_1000"));
      return;
    }
    if (action === "withdraw" && lastBalance != null && amount > lastBalance) {
      Toast.error(t("insufficient_balance"));
      return;
    }

    const confirmText = action === "add"
      ? t("do_you_want_to_add_money_to_unique_id")
      : t("do_you_want_to_withdraw_money_from_unique_id");

    Modal.open({
      title: t("are_you_sure"),
      content: `<p>${escapeHtml(confirmText)} "${escapeHtml(identity.value)}" ?</p>`,
      buttons: [
        { label: t("cancel_button"), variant: "default", action: "cancel" },
        {
          label: action === "add" ? t("yes_add_money") : t("yes_withdraw_money"),
          variant: "success",
          action: "confirm",
          onClick: async () => {
            try {
              const op = action === "add" ? cashIn : cashOut;
              const body = mode === "unique-id"
                ? { amount, paymentType, uniqueId: identity.value.trim() }
                : { amount, paymentType };
              await op(resolvedPlayerId!, body);
              Toast.success(action === "add" ? t("cash_in_success") : t("cash_out_success"));
              window.location.hash = "#/agent/cashinout";
            } catch (err) {
              const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
              Toast.error(msg);
              throw err;
            }
          },
        },
      ],
    });
  });
}
