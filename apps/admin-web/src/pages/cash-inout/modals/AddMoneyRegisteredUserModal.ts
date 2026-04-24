// Wireframe 17.7 — Add Money (Registered User) modal.
//
// 1:1 port av legacy add-money-dialogen, men med autocomplete-søk mot
// `/api/agent/transactions/search-users` slik at agenten kan finne spilleren
// ved prefix av email / brukernavn / telefon, i stedet for å skrive inn
// kundenummer manuelt. Bruker `AgentUserCashResponse.amlFlagged` til å vise
// en passiv info-melding til agenten når beløpet > 10 000 NOK.
//
// Flyt:
//   1. Agent taster prefix → debounce 300 ms → searchUsersForAgent → dropdown.
//   2. Agent velger bruker → username-felt låses, balance vises i help-block.
//   3. Agent skriver beløp + velger Cash/Card → trykker Add Money.
//   4. Yes/No-confirm-dialog → på Yes: addMoneyToRegisteredUser.
//   5. Ved suksess: Toast, modal lukkes, optional onSuccess-callback.

import { t } from "../../../i18n/I18n.js";
import { Modal } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import {
  addMoneyToRegisteredUser,
  searchUsersForAgent,
  type AgentUserSearchRow,
} from "../../../api/agent-cash.js";
import { escapeHtml, formatNOK } from "../shared.js";

export interface AddMoneyRegisteredUserModalOptions {
  onSuccess?: () => void;
}

const AML_THRESHOLD = 10_000;

export function openAddMoneyRegisteredUserModal(
  options: AddMoneyRegisteredUserModalOptions = {},
): void {
  const form = document.createElement("form");
  form.setAttribute("novalidate", "novalidate");
  form.innerHTML = `
    <div class="form-group" style="position:relative;">
      <label for="am-username">${escapeHtml(t("enter_username_customer_number_phone_number"))}</label>
      <input type="text" id="am-username" class="form-control" autocomplete="off" required autofocus>
      <div id="am-autocomplete" class="list-group" style="position:absolute; left:0; right:0; z-index:1050; max-height:220px; overflow-y:auto; display:none; margin-top:2px;"></div>
      <small class="help-block" id="am-balance-result" style="color:#00a65a;"></small>
    </div>
    <div class="form-group">
      <label for="am-amount">${escapeHtml(t("amount"))} (kr)</label>
      <input type="number" id="am-amount" class="form-control" min="1" step="1" required>
      <small class="help-block" id="am-aml-warn" style="color:#f39c12; display:none;"></small>
    </div>
    <div class="form-group">
      <label for="am-paymentType">${escapeHtml(t("select_payment_type"))}</label>
      <select id="am-paymentType" class="form-control">
        <option value="Cash">${escapeHtml(t("cash"))}</option>
        <option value="Card">${escapeHtml(t("card"))}</option>
      </select>
    </div>
  `;

  const usernameInput = form.querySelector<HTMLInputElement>("#am-username")!;
  const amountInput = form.querySelector<HTMLInputElement>("#am-amount")!;
  const paymentSelect = form.querySelector<HTMLSelectElement>("#am-paymentType")!;
  const dropdown = form.querySelector<HTMLDivElement>("#am-autocomplete")!;
  const balanceResult = form.querySelector<HTMLElement>("#am-balance-result")!;
  const amlWarn = form.querySelector<HTMLElement>("#am-aml-warn")!;

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
    balanceResult.textContent = `${t("current_balance")}: ${formatNOK(u.walletBalance)} kr`;
    balanceResult.style.color = "#00a65a";
    closeDropdown();
  }

  async function doSearch(): Promise<void> {
    const q = usernameInput.value.trim();
    if (q.length === 0) {
      closeDropdown();
      balanceResult.textContent = "";
      selectedUser = null;
      return;
    }
    try {
      const res = await searchUsersForAgent(q);
      renderDropdown(res.users);
      if (res.users.length === 0) {
        balanceResult.textContent = t("player_not_found");
        balanceResult.style.color = "#dd4b39";
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      balanceResult.textContent = msg;
      balanceResult.style.color = "#dd4b39";
      closeDropdown();
    }
  }

  usernameInput.addEventListener("input", () => {
    // Innskriving etter valg → ugyldiggjør det valget til agenten har
    // bekreftet ny match via dropdown-klikk.
    selectedUser = null;
    balanceResult.textContent = "";
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => void doSearch(), 300);
  });

  amountInput.addEventListener("input", () => {
    const n = Number(amountInput.value);
    if (Number.isFinite(n) && n > AML_THRESHOLD) {
      amlWarn.textContent = t("high_value_transaction_aml_note");
      amlWarn.style.display = "block";
    } else {
      amlWarn.style.display = "none";
    }
  });

  // Modal-instansen — åpner først her slik at vi kan lukke den fra submit.
  const modal = Modal.open({
    title: t("add_money_register_user"),
    content: form,
    size: "sm",
    buttons: [
      { label: t("cancel_button"), variant: "default", action: "cancel" },
      {
        label: t("add_money"),
        variant: "success",
        action: "confirm",
        dismiss: false,
        onClick: async () => {
          const amount = Number(amountInput.value);
          const paymentType = paymentSelect.value as "Cash" | "Card";
          if (!selectedUser) {
            Toast.error(t("player_not_found"));
            throw new Error("no-user-selected");
          }
          if (!Number.isFinite(amount) || amount < 1) {
            Toast.error(t("amount_should_be_between_1_1000"));
            throw new Error("invalid-amount");
          }
          // Yes/No-confirm (wireframe 17.7).
          await new Promise<void>((resolve, reject) => {
            const confirmText = t("do_you_want_to_add_money_to_username");
            Modal.open({
              title: t("are_you_sure"),
              content: `<p>${escapeHtml(confirmText)}<br><strong>${escapeHtml(selectedUser!.displayName)}</strong> (${formatNOK(amount)} kr, ${escapeHtml(paymentType)})</p>`,
              size: "sm",
              buttons: [
                {
                  label: t("cancel_button"),
                  variant: "default",
                  action: "cancel",
                  onClick: () => reject(new Error("cancelled")),
                },
                {
                  label: t("yes_add_money"),
                  variant: "success",
                  action: "confirm",
                  onClick: () => resolve(),
                },
              ],
            });
          }).catch(() => {
            throw new Error("cancelled");
          });

          try {
            const result = await addMoneyToRegisteredUser({
              targetUserId: selectedUser.id,
              amount,
              paymentType,
              clientRequestId: generateClientRequestId(),
            });
            Toast.success(t("cash_in_success"));
            if (result.amlFlagged) {
              Toast.info(t("high_value_transaction_logged"));
            }
            modal.close("button");
            options.onSuccess?.();
          } catch (err) {
            if (err instanceof ApiError) {
              Toast.error(err.message);
            } else {
              Toast.error(t("something_went_wrong"));
            }
            throw err;
          }
        },
      },
    ],
  });
}

function generateClientRequestId(): string {
  return `am-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
