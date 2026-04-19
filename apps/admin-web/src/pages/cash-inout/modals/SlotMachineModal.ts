// Slot-machine modal — port of
// legacy/unity-backend/App/Views/cash-inout/slotmachine-popups.html.
// The provider is determined upstream by SlotProviderSwitch; this modal issues
// calls only to the resolved provider's endpoints (Metronia or OK Bingo).

import { t } from "../../../i18n/I18n.js";
import { Modal } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import {
  registerSlotTicket,
  slotTopup,
  slotPayout,
  slotVoid,
  getSlotTicketStatus,
  type SlotProvider,
} from "../../../api/agent-slot.js";
import { lookupPlayer } from "../../../api/agent-cash.js";
import { slotProviderLabel as label } from "../../../components/SlotProviderSwitch.js";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function openSlotMachineModal(provider: SlotProvider): void {
  const form = document.createElement("form");
  form.innerHTML = `
    <div class="form-group">
      <label>${escapeHtml(t("enter"))} ${escapeHtml(t("username"))} / ${escapeHtml(t("customer_number"))} / ${escapeHtml(t("phone_number"))}</label>
      <input type="text" class="form-control" id="sm-username" autocomplete="off">
      <small class="help-block" id="sm-user-balance" style="color:#28a745;"></small>
    </div>
    <div class="form-group">
      <label>${escapeHtml(t("enter"))} Ticket Id</label>
      <input type="text" class="form-control" id="sm-ticketId" autocomplete="off">
    </div>
    <div class="form-group">
      <label>${escapeHtml(t("enter"))} ${escapeHtml(t("amount"))} (kr)</label>
      <input type="number" min="1" max="1000" step="1" class="form-control" id="sm-amount" autocomplete="off">
      <small class="help-block text-danger" id="sm-amount-error"></small>
    </div>

    <div class="btn-group-vertical" style="width:100%;">
      <div class="row">
        <div class="col-xs-6"><button type="button" class="btn btn-block btn-default" data-action="make-ticket">${escapeHtml(t("make_ticket"))}</button></div>
        <div class="col-xs-6"><button type="button" class="btn btn-block btn-default" data-action="add-to-ticket">${escapeHtml(t("add_to_ticket"))}</button></div>
      </div>
      <div class="row" style="margin-top:4px;">
        <div class="col-xs-6"><button type="button" class="btn btn-block btn-default" data-action="balance-on-ticket">${escapeHtml(t("balance_on_ticket"))}</button></div>
        <div class="col-xs-6"><button type="button" class="btn btn-block btn-default" data-action="close-ticket">${escapeHtml(t("close_ticket"))}</button></div>
      </div>
    </div>

    <div class="form-group" style="margin-top:16px;">
      <label>${escapeHtml(t("select_payment_type"))}</label>
      <div class="btn-group" role="group">
        <button type="button" class="btn btn-default pay-method active" data-payment="Cash">${escapeHtml(t("cash"))}</button>
        <button type="button" class="btn btn-default pay-method" data-payment="Card">${escapeHtml(t("card"))}</button>
        <button type="button" class="btn btn-default pay-method" data-payment="customerNumber">${escapeHtml(t("player_account"))}</button>
      </div>
    </div>`;

  let paymentType: "Cash" | "Card" | "customerNumber" = "Cash";

  form.querySelectorAll<HTMLButtonElement>(".pay-method").forEach((b) => {
    b.addEventListener("click", () => {
      form.querySelectorAll(".pay-method").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      paymentType = b.dataset.payment as typeof paymentType;
    });
  });

  const getField = (id: string): string => (form.querySelector<HTMLInputElement>(`#${id}`)?.value ?? "").trim();

  async function lookupPlayerByUsername(): Promise<{ id: string } | null> {
    const username = getField("sm-username");
    if (!username) return null;
    try {
      const p = await lookupPlayer({ username });
      const balEl = form.querySelector<HTMLElement>("#sm-user-balance");
      if (balEl) balEl.textContent = `${t("current_balance")}: ${p.balance.toFixed(2)} kr`;
      return p;
    } catch {
      const balEl = form.querySelector<HTMLElement>("#sm-user-balance");
      if (balEl) balEl.textContent = t("player_not_found");
      return null;
    }
  }

  form.querySelector<HTMLInputElement>("#sm-username")!.addEventListener("blur", () => {
    void lookupPlayerByUsername();
  });

  form.addEventListener("click", async (e) => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!target) return;
    const action = target.dataset.action!;
    const ticketNumber = getField("sm-ticketId");
    const amountStr = getField("sm-amount");
    const amount = Number(amountStr);

    try {
      switch (action) {
        case "make-ticket": {
          if (!Number.isFinite(amount) || amount < 1 || amount > 1000) {
            Toast.error(t("amount_should_be_between_1_1000"));
            return;
          }
          const player = await lookupPlayerByUsername();
          await registerSlotTicket(provider, {
            ticketNumber: ticketNumber || `auto-${Date.now()}`,
            balance: amount,
            amount,
            playerId: player?.id,
            username: getField("sm-username") || undefined,
            paymentType,
          });
          Toast.success(`${label(provider)}: ${t("make_ticket")} — OK`);
          break;
        }
        case "add-to-ticket": {
          if (!ticketNumber) return Toast.error(t("please_enter_ticket_id") || "Ticket Id required");
          if (!Number.isFinite(amount) || amount < 1) return Toast.error(t("amount_should_be_between_1_1000"));
          await slotTopup(provider, { ticketNumber, amount, paymentType });
          Toast.success(t("add_to_ticket"));
          break;
        }
        case "balance-on-ticket": {
          if (!ticketNumber) return Toast.error(t("please_enter_ticket_id") || "Ticket Id required");
          const status = await getSlotTicketStatus(provider, ticketNumber);
          Toast.info(`${t("balance_on_ticket")}: ${status.balance.toFixed(2)} kr`);
          break;
        }
        case "close-ticket": {
          if (!ticketNumber) return Toast.error(t("please_enter_ticket_id") || "Ticket Id required");
          // Legacy "close ticket" = pay out the remaining balance and void
          const status = await getSlotTicketStatus(provider, ticketNumber);
          if (status.balance > 0) {
            await slotPayout(provider, { ticketNumber, amount: status.balance });
          }
          await slotVoid(provider, { ticketNumber });
          Toast.success(t("close_ticket"));
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
    }
  });

  Modal.open({
    title: label(provider),
    content: form,
    size: "lg",
    buttons: [{ label: t("cancel"), variant: "default", action: "cancel" }],
  });
}

