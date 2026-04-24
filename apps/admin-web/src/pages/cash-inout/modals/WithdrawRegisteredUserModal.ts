// Wireframe 17.8 — Withdraw (Registered User) modal.
//
// 1:1 port av legacy withdraw-dialogen. Tre utvidelser fra add-money:
//   - Balance-feltet er readonly og vises etter brukervalg (PDF 17.8 spec).
//   - Payment-Type er låst til Cash — bank-uttak går via amountwithdraw-flyt.
//   - Uttak > 10 000 NOK utløser CONFIRMATION_REQUIRED fra backend; vi fanger
//     det opp, viser en second-opinion-dialog, og retryer med requireConfirm=true.

import { t } from "../../../i18n/I18n.js";
import { Modal } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import {
  searchUsersForAgent,
  withdrawFromRegisteredUser,
  type AgentUserSearchRow,
  type WithdrawRegisteredUserRequest,
} from "../../../api/agent-cash.js";
import { escapeHtml, formatNOK } from "../shared.js";

export interface WithdrawRegisteredUserModalOptions {
  onSuccess?: () => void;
}

export function openWithdrawRegisteredUserModal(
  options: WithdrawRegisteredUserModalOptions = {},
): void {
  const form = document.createElement("form");
  form.setAttribute("novalidate", "novalidate");
  form.innerHTML = `
    <div class="form-group" style="position:relative;">
      <label for="wd-username">${escapeHtml(t("enter_username_customer_number_phone_number"))}</label>
      <input type="text" id="wd-username" class="form-control" autocomplete="off" required autofocus>
      <div id="wd-autocomplete" class="list-group" style="position:absolute; left:0; right:0; z-index:1050; max-height:220px; overflow-y:auto; display:none; margin-top:2px;"></div>
    </div>
    <div class="form-group">
      <label for="wd-balance">${escapeHtml(t("current_balance"))} (kr)</label>
      <input type="text" id="wd-balance" class="form-control" readonly value="">
    </div>
    <div class="form-group">
      <label for="wd-amount">${escapeHtml(t("amount"))} (kr)</label>
      <input type="number" id="wd-amount" class="form-control" min="1" step="1" required>
      <small class="help-block" id="wd-amount-warn" style="color:#dd4b39; display:none;"></small>
    </div>
    <div class="form-group">
      <label for="wd-paymentType">${escapeHtml(t("select_payment_type"))}</label>
      <select id="wd-paymentType" class="form-control" disabled>
        <option value="Cash" selected>${escapeHtml(t("cash"))}</option>
      </select>
    </div>
  `;

  const usernameInput = form.querySelector<HTMLInputElement>("#wd-username")!;
  const balanceInput = form.querySelector<HTMLInputElement>("#wd-balance")!;
  const amountInput = form.querySelector<HTMLInputElement>("#wd-amount")!;
  const dropdown = form.querySelector<HTMLDivElement>("#wd-autocomplete")!;
  const amountWarn = form.querySelector<HTMLElement>("#wd-amount-warn")!;

  let selectedUser: AgentUserSearchRow | null = null;
  let debounceTimer: number | null = null;

  function closeDropdown(): void {
    dropdown.style.display = "none";
    dropdown.innerHTML = "";
  }

  function renderDropdown(users: AgentUserSearchRow[]): void {
    if (users.length === 0) {
      closeDropdown();
      return;
    }
    dropdown.innerHTML = users
      .map(
        (u) => `
      <a href="javascript:void(0)" class="list-group-item" data-user-id="${escapeHtml(u.id)}">
        <strong>${escapeHtml(u.displayName)}</strong>
        <small style="color:#888;"> — ${escapeHtml(u.email)}${u.phone ? ` · ${escapeHtml(u.phone)}` : ""}</small>
        <span class="pull-right" style="color:#00a65a;">${formatNOK(u.walletBalance)} kr</span>
      </a>`,
      )
      .join("");
    dropdown.style.display = "block";
    dropdown.querySelectorAll<HTMLAnchorElement>("[data-user-id]").forEach((a) => {
      a.addEventListener("click", () => {
        const uid = a.dataset.userId!;
        const match = users.find((x) => x.id === uid);
        if (!match) return;
        selectUser(match);
      });
    });
  }

  function selectUser(u: AgentUserSearchRow): void {
    selectedUser = u;
    usernameInput.value = u.displayName;
    balanceInput.value = `${formatNOK(u.walletBalance)} kr`;
    closeDropdown();
    // Re-validate the amount against the new balance immediately so the
    // operator gets instant feedback when switching between users.
    validateAmountAgainstBalance();
  }

  function validateAmountAgainstBalance(): void {
    if (!selectedUser) {
      amountWarn.style.display = "none";
      return;
    }
    const n = Number(amountInput.value);
    if (!Number.isFinite(n) || n <= 0) {
      amountWarn.style.display = "none";
      return;
    }
    if (n > selectedUser.walletBalance) {
      amountWarn.textContent = t("insufficient_balance");
      amountWarn.style.display = "block";
    } else {
      amountWarn.style.display = "none";
    }
  }

  async function doSearch(): Promise<void> {
    const q = usernameInput.value.trim();
    if (q.length === 0) {
      closeDropdown();
      balanceInput.value = "";
      selectedUser = null;
      return;
    }
    try {
      const res = await searchUsersForAgent(q);
      renderDropdown(res.users);
      if (res.users.length === 0) {
        balanceInput.value = "";
      }
    } catch {
      closeDropdown();
      balanceInput.value = "";
    }
  }

  usernameInput.addEventListener("input", () => {
    selectedUser = null;
    balanceInput.value = "";
    amountWarn.style.display = "none";
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => void doSearch(), 300);
  });

  amountInput.addEventListener("input", validateAmountAgainstBalance);

  const modal = Modal.open({
    title: t("withdraw_money_register_user"),
    content: form,
    size: "sm",
    buttons: [
      { label: t("cancel_button"), variant: "default", action: "cancel" },
      {
        label: t("withdraw"),
        variant: "danger",
        action: "confirm",
        dismiss: false,
        onClick: async () => {
          const amount = Number(amountInput.value);
          if (!selectedUser) {
            Toast.error(t("player_not_found"));
            throw new Error("no-user-selected");
          }
          if (!Number.isFinite(amount) || amount < 1) {
            Toast.error(t("amount_should_be_between_1_1000"));
            throw new Error("invalid-amount");
          }
          if (amount > selectedUser.walletBalance) {
            Toast.error(t("insufficient_balance"));
            throw new Error("overdraw");
          }

          // Yes/No-bekreftelse (wireframe 17.8).
          await new Promise<void>((resolve, reject) => {
            Modal.open({
              title: t("are_you_sure"),
              content: `<p>${escapeHtml(t("do_you_want_to_withdraw_money_from_username"))}<br><strong>${escapeHtml(selectedUser!.displayName)}</strong> (${formatNOK(amount)} kr)</p>`,
              size: "sm",
              buttons: [
                {
                  label: t("cancel_button"),
                  variant: "default",
                  action: "cancel",
                  onClick: () => reject(new Error("cancelled")),
                },
                {
                  label: t("yes_withdraw_money"),
                  variant: "danger",
                  action: "confirm",
                  onClick: () => resolve(),
                },
              ],
            });
          }).catch(() => {
            throw new Error("cancelled");
          });

          await performWithdraw({
            targetUserId: selectedUser.id,
            amount,
            paymentType: "Cash",
            clientRequestId: generateClientRequestId(),
          });
          modal.close("button");
          options.onSuccess?.();
        },
      },
    ],
  });

  /**
   * Utfører uttak; ved CONFIRMATION_REQUIRED-svar åpnes en ekstra second-
   * opinion-dialog og kallet retryes med requireConfirm=true.
   */
  async function performWithdraw(body: WithdrawRegisteredUserRequest): Promise<void> {
    try {
      const result = await withdrawFromRegisteredUser(body);
      Toast.success(t("cash_out_success"));
      if (result.amlFlagged) {
        Toast.info(t("high_value_transaction_logged"));
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "CONFIRMATION_REQUIRED") {
        const confirmed = await askHighValueConfirm(body.amount);
        if (!confirmed) {
          throw new Error("cancelled-aml");
        }
        const retried = await withdrawFromRegisteredUser({ ...body, requireConfirm: true });
        Toast.success(t("cash_out_success"));
        if (retried.amlFlagged) {
          Toast.info(t("high_value_transaction_logged"));
        }
        return;
      }
      if (err instanceof ApiError) {
        Toast.error(err.message);
      } else {
        Toast.error(t("something_went_wrong"));
      }
      throw err;
    }
  }

  function askHighValueConfirm(amount: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      Modal.open({
        title: t("are_you_sure"),
        content: `<p><strong>${formatNOK(amount)} kr</strong> ${escapeHtml(t("high_value_transaction_aml_note"))}</p>`,
        size: "sm",
        backdrop: "static",
        keyboard: false,
        buttons: [
          {
            label: t("cancel_button"),
            variant: "default",
            action: "cancel",
            onClick: () => resolve(false),
          },
          {
            label: t("yes_withdraw_money"),
            variant: "danger",
            action: "confirm",
            onClick: () => resolve(true),
          },
        ],
      });
    });
  }
}

function generateClientRequestId(): string {
  return `wd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
