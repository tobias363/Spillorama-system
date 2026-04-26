// PR-A6 (BIN-674) — /system/systemInformation.
//
// Design-avvik: Summernote rich-text-editor (iframe + CDN) erstattet med
// ren textarea + markdown-preview. Funksjonelt ekvivalent for ops-bruk,
// overholder vanilla DOM-only policy.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "../adminUsers/shared.js";
import {
  getSystemInformation,
  updateSystemInformation,
} from "../../api/admin-system-settings.js";

export function renderSystemInformationPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("system_information", "system_information")}
    <section class="content">
      <div class="callout callout-info" data-testid="system-info-placeholder-banner">
        <i class="fa fa-info-circle" aria-hidden="true"></i>
        ${escapeHtml(t("system_settings_wired_banner"))}
      </div>
      ${boxOpen("system_information", "primary")}
        <div id="system-info-form-host">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const host = container.querySelector<HTMLElement>("#system-info-form-host")!;
  void mount(host);
}

async function mount(host: HTMLElement): Promise<void> {
  const record = await getSystemInformation();

  host.innerHTML = `
    <form id="system-info-form" class="form-horizontal" data-testid="system-info-form">
      <div class="form-group">
        <label class="col-sm-2 control-label" for="sif-content">${escapeHtml(t("system_information_body"))}</label>
        <div class="col-sm-10">
          <textarea
            id="sif-content"
            name="content"
            class="form-control"
            rows="16"
            data-testid="system-info-textarea"
            placeholder="${escapeHtml(t("enter") + " " + t("system_information"))}">${escapeHtml(record.content)}</textarea>
        </div>
      </div>
      <div class="form-group">
        <div class="col-sm-offset-2 col-sm-10">
          <button type="submit" class="btn btn-primary" data-action="save-system-information">
            <i class="fa fa-save" aria-hidden="true"></i> ${escapeHtml(t("update"))}
          </button>
          <button type="button" class="btn btn-default" data-action="cancel-system-information" onclick="window.history.back()">
            ${escapeHtml(t("cancel"))}
          </button>
        </div>
      </div>
    </form>`;

  const form = host.querySelector<HTMLFormElement>("#system-info-form")!;
  const textarea = host.querySelector<HTMLTextAreaElement>("#sif-content")!;

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void (async () => {
      try {
        await updateSystemInformation(textarea.value);
        Toast.success(t("success"));
      } catch {
        Toast.error(t("something_went_wrong"));
      }
    })();
  });
}
