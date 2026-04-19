// Settlement / close-day modal. Uses backdrop:"static" + keyboard:false —
// the operator must explicitly confirm or cancel. This matches legacy
// behaviour (data-backdrop="static" data-keyboard="false") and is the flow
// PM flagged to Agent A for Modal support (see PR-B1-PLAN.md §7 Q6).

import { t } from "../../../i18n/I18n.js";
import { Modal } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import { closeDay, getCurrentShift, getDailyBalance } from "../../../api/agent-shift.js";

const DIFF_LIMIT = 500;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function openSettlementModal(): void {
  const form = document.createElement("div");
  form.innerHTML = `
    <p>${escapeHtml(t("close_day_irreversible"))}</p>
    <dl class="dl-horizontal">
      <dt>${escapeHtml(t("expected_balance"))}</dt><dd id="sm-expected">${escapeHtml(t("loading_ellipsis"))}</dd>
      <dt>${escapeHtml(t("daily_balance"))}</dt><dd id="sm-daily">${escapeHtml(t("loading_ellipsis"))}</dd>
    </dl>
    <div class="form-group">
      <label for="sm-actual">${escapeHtml(t("actual_counted_cash"))} (kr)</label>
      <input type="number" step="0.01" min="0" class="form-control" id="sm-actual" required autofocus>
    </div>
    <div class="form-group">
      <label for="sm-note">${escapeHtml(t("note_optional"))}</label>
      <textarea class="form-control" id="sm-note" rows="3"></textarea>
    </div>`;

  const instance = Modal.open({
    title: t("confirm_close_day"),
    content: form,
    backdrop: "static",
    keyboard: false,
    className: "modal-danger",
    buttons: [
      {
        label: t("cancel_button"),
        variant: "default",
        action: "cancel",
      },
      {
        label: t("settlement"),
        variant: "danger",
        action: "confirm",
        dismiss: false,
        onClick: async (inst) => {
          const actual = Number((form.querySelector<HTMLInputElement>("#sm-actual")!).value);
          if (!Number.isFinite(actual) || actual < 0) {
            Toast.error(t("invalid_input") || t("something_went_wrong"));
            return;
          }
          const note = (form.querySelector<HTMLTextAreaElement>("#sm-note")!).value.trim() || undefined;
          try {
            await closeDay({ actualCountedCash: actual, note, confirmed: true });
            Toast.success(t("data_updated_successfully"));
            inst.close("button");
          } catch (err) {
            const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
            Toast.error(msg);
          }
        },
      },
    ],
  });

  void (async () => {
    try {
      const [shift, daily] = await Promise.all([getCurrentShift(), getDailyBalance()]);
      const expectedEl = form.querySelector<HTMLElement>("#sm-expected");
      const dailyEl = form.querySelector<HTMLElement>("#sm-daily");
      if (expectedEl) expectedEl.textContent = `${(shift?.currentBalance ?? daily.dailyBalance).toFixed(2)} kr`;
      if (dailyEl) dailyEl.textContent = `${daily.dailyBalance.toFixed(2)} kr`;
    } catch {
      const expectedEl = form.querySelector<HTMLElement>("#sm-expected");
      if (expectedEl) expectedEl.textContent = "—";
    }
  })();

  // Expose limit in warnings — no-op, just referenced for clarity
  void DIFF_LIMIT;
  void instance;
}
