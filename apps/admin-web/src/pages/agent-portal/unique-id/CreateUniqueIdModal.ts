// Wireframe gap #8/#10/#11 (2026-04-24): Create New Unique ID modal (17.9).
//
// Fields: Purchase Date+Time (read-only now), Expiry Date+Time (computed),
// Balance Amount, Hours Validity (min 24), Payment Type (Cash/Card), PRINT.

import { t } from "../../../i18n/I18n.js";
import { Modal } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import {
  createUniqueId,
  type CreateUniqueIdResponse,
  type UniqueIdPaymentType,
} from "../../../api/agent-unique-ids.js";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatKr(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export interface CreateUniqueIdModalOpts {
  hallId: string;
  onSuccess?: (result: CreateUniqueIdResponse) => void;
}

/** Build the form DOM so tests can mount and inspect it in isolation. */
export function buildCreateUniqueIdForm(): HTMLElement {
  const wrap = document.createElement("div");
  const now = new Date();
  wrap.innerHTML = `
    <form class="form-horizontal" data-testid="create-unique-id-form" novalidate>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="cuid-purchase">${escapeHtml(t("agent_unique_id_purchase_date"))}</label>
        <div class="col-sm-8">
          <input type="text" class="form-control" id="cuid-purchase"
            value="${escapeHtml(now.toLocaleString())}" readonly data-testid="purchase-date">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="cuid-hours">${escapeHtml(t("agent_unique_id_hours_validity"))}</label>
        <div class="col-sm-8">
          <input type="number" class="form-control" id="cuid-hours" min="24" step="1"
            value="24" required data-testid="hours-validity">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="cuid-expiry">${escapeHtml(t("agent_unique_id_expiry_date"))}</label>
        <div class="col-sm-8">
          <input type="text" class="form-control" id="cuid-expiry"
            readonly data-testid="expiry-date">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="cuid-amount">${escapeHtml(t("agent_unique_id_balance_amount"))}</label>
        <div class="col-sm-8">
          <input type="number" class="form-control" id="cuid-amount" min="1" step="0.01"
            required autofocus data-testid="amount">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="cuid-payment">${escapeHtml(t("agent_unique_id_payment_type"))}</label>
        <div class="col-sm-8">
          <select class="form-control" id="cuid-payment" data-testid="payment-type">
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
          </select>
        </div>
      </div>
    </form>`;
  // Auto-compute expiry from hours.
  const hoursEl = wrap.querySelector<HTMLInputElement>("#cuid-hours")!;
  const expiryEl = wrap.querySelector<HTMLInputElement>("#cuid-expiry")!;
  function recomputeExpiry(): void {
    const h = Number(hoursEl.value);
    if (!Number.isFinite(h) || h <= 0) {
      expiryEl.value = "";
      return;
    }
    const exp = new Date(Date.now() + h * 3600_000);
    expiryEl.value = exp.toLocaleString();
  }
  hoursEl.addEventListener("input", recomputeExpiry);
  recomputeExpiry();
  return wrap;
}

export function openCreateUniqueIdModal(opts: CreateUniqueIdModalOpts): void {
  const form = buildCreateUniqueIdForm();
  Modal.open({
    title: t("agent_unique_id_create"),
    content: form,
    size: "lg",
    buttons: [
      { label: t("cancel_button"), variant: "default", action: "cancel" },
      {
        label: t("agent_unique_id_print"),
        variant: "primary",
        action: "print",
        onClick: async (instance) => {
          const hoursEl = form.querySelector<HTMLInputElement>("#cuid-hours")!;
          const amountEl = form.querySelector<HTMLInputElement>("#cuid-amount")!;
          const paymentEl = form.querySelector<HTMLSelectElement>("#cuid-payment")!;
          const hours = Number(hoursEl.value);
          const amount = Number(amountEl.value);
          if (!Number.isInteger(hours) || hours < 24) {
            Toast.error(t("agent_unique_id_hours_must_be_24"));
            return;
          }
          if (!Number.isFinite(amount) || amount <= 0) {
            Toast.error(t("amount_must_be_greater_than_zero"));
            return;
          }
          const paymentType = paymentEl.value as UniqueIdPaymentType;
          try {
            const res = await createUniqueId({
              hallId: opts.hallId,
              amount,
              hoursValidity: hours,
              paymentType,
            });
            Toast.success(
              t("agent_unique_id_create_success", {
                id: res.card.id,
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

/** Test hook — expose internals for unit tests. */
export const __createUniqueIdModalInternals = { buildCreateUniqueIdForm, formatKr, formatDate };
