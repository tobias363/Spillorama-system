// REQ-097: Admin block-player modal.
//
// Lar admin/SUPPORT blokkere en spillerkonto med påkrevd reason +
// duration (radio: 1d, 7d, 30d, custom days, permanent).
// Backdrop static + keyboard:false. Reason min 1 tegn, max 500.
// Norsk-tekst gjennom i18n.

import { Modal, type ModalInstance } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { blockPlayer, type PlayerSummary } from "../../../api/admin-players.js";
import { ApiError } from "../../../api/client.js";
import { t } from "../../../i18n/I18n.js";
import { escapeHtml } from "../shared.js";

export interface BlockPlayerOptions {
  player: Pick<PlayerSummary, "id" | "email" | "displayName">;
  onBlocked?: () => void;
}

export function openBlockPlayerModal(opts: BlockPlayerOptions): void {
  const label = opts.player.displayName || opts.player.email || opts.player.id;

  const body = document.createElement("div");
  body.innerHTML = `
    <p>${escapeHtml(t("are_you_sure_block_player") || "Er du sikker på at du vil blokkere denne spilleren?")}</p>
    <p><strong>${escapeHtml(t("player"))}:</strong> ${escapeHtml(label)}</p>
    <form id="block-form" novalidate>
      <div class="form-group">
        <label>${escapeHtml(t("duration") || "Varighet")} *</label>
        <div>
          <label style="font-weight:normal;display:block;margin-bottom:4px;">
            <input type="radio" name="block-duration" value="1" /> 1 dag
          </label>
          <label style="font-weight:normal;display:block;margin-bottom:4px;">
            <input type="radio" name="block-duration" value="7" /> 7 dager
          </label>
          <label style="font-weight:normal;display:block;margin-bottom:4px;">
            <input type="radio" name="block-duration" value="30" /> 30 dager
          </label>
          <label style="font-weight:normal;display:block;margin-bottom:4px;">
            <input type="radio" name="block-duration" value="custom" />
            <span>${escapeHtml(t("custom") || "Egendefinert")}: </span>
            <input type="number" id="block-custom-days" name="customDays"
                   min="1" max="3650" step="1" placeholder="dager"
                   style="width:100px;" />
          </label>
          <label style="font-weight:normal;display:block;">
            <input type="radio" name="block-duration" value="permanent" checked /> ${escapeHtml(t("permanent") || "Permanent (til admin opphever)")}
          </label>
        </div>
      </div>
      <div class="form-group">
        <label for="block-reason">${escapeHtml(t("provide_reason") || "Begrunnelse")} *</label>
        <textarea id="block-reason" name="reason" class="form-control" rows="3"
                  maxlength="500" required
                  placeholder="${escapeHtml(t("enter_reason"))}"></textarea>
      </div>
      <p class="help-block" id="block-error" style="color:#a94442;display:none;margin-top:4px;"></p>
    </form>
  `;

  const submit = async (instance: ModalInstance): Promise<void> => {
    const form = body.querySelector<HTMLFormElement>("#block-form")!;
    const errEl = body.querySelector<HTMLElement>("#block-error")!;
    const reasonEl = form.elements.namedItem("reason") as HTMLTextAreaElement;
    const durationInputs = form.querySelectorAll<HTMLInputElement>(
      "input[name='block-duration']"
    );
    const customEl = body.querySelector<HTMLInputElement>("#block-custom-days")!;

    let selectedDuration: string | null = null;
    durationInputs.forEach((r) => {
      if (r.checked) selectedDuration = r.value;
    });

    if (!selectedDuration) {
      errEl.textContent = t("duration_required") || "Velg varighet.";
      errEl.style.display = "block";
      return;
    }

    let durationDays: number | "permanent" = "permanent";
    if (selectedDuration === "permanent") {
      durationDays = "permanent";
    } else if (selectedDuration === "custom") {
      const n = Number(customEl.value);
      if (!Number.isFinite(n) || n <= 0) {
        errEl.textContent = t("invalid_custom_days") || "Skriv inn et gyldig antall dager.";
        errEl.style.display = "block";
        customEl.focus();
        return;
      }
      durationDays = Math.floor(n);
    } else {
      durationDays = Number(selectedDuration);
    }

    const reason = reasonEl.value.trim();
    if (!reason) {
      errEl.textContent = t("reason_required") || "Begrunnelse er påkrevd.";
      errEl.style.display = "block";
      reasonEl.focus();
      return;
    }
    errEl.style.display = "none";

    try {
      await blockPlayer(opts.player.id, { reason, durationDays });
      Toast.success(t("player_blocked_success") || "Spilleren ble blokkert.");
      opts.onBlocked?.();
      instance.close("button");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      // Hold modal åpen så admin kan korrigere og prøve igjen.
    }
  };

  Modal.open({
    title: t("block_player_title") || "Blokkér spiller",
    content: body,
    backdrop: "static",
    keyboard: false,
    buttons: [
      { label: t("no_cancle"), variant: "default", action: "cancel" },
      {
        label: t("yes_block_it") || "Ja, blokker",
        variant: "danger",
        action: "confirm",
        dismiss: false,
        onClick: submit,
      },
    ],
  });
}
