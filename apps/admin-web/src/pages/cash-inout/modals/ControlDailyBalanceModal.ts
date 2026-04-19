// Control-daily-balance modal — midtveis-sjekk (not a close-day).
// Agent counts cash, posts to /api/agent/shift/control-daily-balance,
// backend returns the diff. If diff > 500 kr OR > 5%, a note is required.

import { t } from "../../../i18n/I18n.js";
import { Modal } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import { controlDailyBalance } from "../../../api/agent-shift.js";

const DIFF_LIMIT = 500;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function openControlDailyBalanceModal(): void {
  const form = document.createElement("form");
  form.innerHTML = `
    <div class="form-group">
      <label for="cdb-actual">${escapeHtml(t("actual_counted_cash"))} (kr)</label>
      <input type="number" step="0.01" min="0" class="form-control" id="cdb-actual" required autofocus>
    </div>
    <div id="cdb-result" style="display:none;">
      <hr>
      <dl class="dl-horizontal">
        <dt>${escapeHtml(t("expected_balance"))}</dt><dd id="cdb-expected">—</dd>
        <dt>${escapeHtml(t("actual_counted_cash"))}</dt><dd id="cdb-actualDisplay">—</dd>
        <dt>${escapeHtml(t("difference"))}</dt><dd id="cdb-diff">—</dd>
      </dl>
      <div class="form-group" id="cdb-note-group" style="display:none;">
        <label for="cdb-note">${escapeHtml(t("note_required", { limit: String(DIFF_LIMIT) }))}</label>
        <textarea class="form-control" id="cdb-note" rows="3" required></textarea>
      </div>
    </div>`;

  Modal.open({
    title: t("control_daily_balance"),
    content: form,
    buttons: [
      { label: t("cancel_button"), variant: "default", action: "cancel" },
      {
        label: t("accept"),
        variant: "success",
        action: "confirm",
        dismiss: false, // two-step flow: first verify, then submit with note
        onClick: async (instance) => {
          const actual = Number((form.querySelector<HTMLInputElement>("#cdb-actual")!).value);
          if (!Number.isFinite(actual) || actual < 0) {
            Toast.error(t("invalid_input") || t("something_went_wrong"));
            return;
          }
          const note = (form.querySelector<HTMLTextAreaElement>("#cdb-note")?.value ?? "").trim();
          try {
            const res = await controlDailyBalance({ actualCountedCash: actual, note: note || undefined });
            renderResult(form, res.expected, actual, res.difference);

            if (res.requiresNote && !note) {
              Toast.warning(t("diff_exceeds_limit", { limit: String(DIFF_LIMIT) }));
              const ng = form.querySelector<HTMLElement>("#cdb-note-group");
              if (ng) ng.style.display = "";
              return; // keep modal open
            }
            Toast.success(t("data_updated_successfully"));
            instance.close("button");
          } catch (err) {
            const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
            Toast.error(msg);
          }
        },
      },
    ],
  });
}

function renderResult(form: HTMLElement, expected: number, actual: number, diff: number): void {
  (form.querySelector<HTMLElement>("#cdb-result")!).style.display = "";
  (form.querySelector<HTMLElement>("#cdb-expected")!).textContent = `${expected.toFixed(2)} kr`;
  (form.querySelector<HTMLElement>("#cdb-actualDisplay")!).textContent = `${actual.toFixed(2)} kr`;
  const diffEl = form.querySelector<HTMLElement>("#cdb-diff")!;
  diffEl.textContent = `${diff.toFixed(2)} kr`;
  diffEl.style.color = Math.abs(diff) > DIFF_LIMIT ? "#dd4b39" : "#00a65a";
}
