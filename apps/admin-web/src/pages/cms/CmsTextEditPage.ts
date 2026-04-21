// BIN-676 — CMS-tekst-edit (gjenbruk for 5 sider).
//
// Port of:
//   - CMS/termsofservice.html      → backend slug "terms"
//   - CMS/support.html             → backend slug "support"
//   - CMS/aboutus.html             → backend slug "aboutus"
//   - CMS/LinksofOtherAgencies.html → backend slug "links"
//   - CMS/ResponsibleGameing.html  → backend slug "responsible-gaming" (LOCKED)
//
// Regulatorisk-gate (BIN-680):
// Spillvett-tekst (responsible-gaming) kan **ikke redigeres** via UI før
// versjons-historikk er på plass. GET fungerer (admin kan se gjeldende
// tekst for feilsøking). PUT returnerer HTTP 400 + error.code=
// 'FEATURE_DISABLED'. UI disable-er form + viser låsebanner.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "../adminUsers/shared.js";
import {
  getCmsText,
  setCmsText,
  isRegulatoryLocked,
  type CmsTextKey,
} from "../../api/admin-cms.js";

export function renderCmsTextEditPage(
  container: HTMLElement,
  key: CmsTextKey
): void {
  const isLocked = isRegulatoryLocked(key);
  const labelKey = key; // i18n-nøkler matcher CmsTextKey-enum

  container.innerHTML = `
    ${contentHeader(labelKey, "cms_management")}
    <section class="content">
      ${
        isLocked
          ? `<div class="callout callout-danger" data-testid="cms-regulatory-lock-banner">
              <i class="fa fa-lock"></i>
              <strong>${escapeHtml(t("cms_regulatory_locked_title"))}</strong>
              <p>${escapeHtml(t("cms_regulatory_locked_body"))}</p>
            </div>`
          : ""
      }
      ${boxOpen(labelKey, "primary")}
        <form id="cms-text-form" class="form-horizontal" data-testid="cms-text-form">
          <div class="form-group">
            <label class="col-sm-2 control-label" for="cms-body">${escapeHtml(t(labelKey))}</label>
            <div class="col-sm-10">
              <textarea
                id="cms-body"
                name="body"
                class="form-control"
                rows="12"
                data-testid="cms-body-textarea"
                ${isLocked ? "readonly" : ""}
                placeholder="${escapeHtml(t("enter") + " " + t(labelKey))}"></textarea>
            </div>
          </div>
          <div class="form-group">
            <div class="col-sm-offset-2 col-sm-10">
              ${
                isLocked
                  ? `<button type="button"
                        class="btn btn-success"
                        data-action="save-cms-text"
                        data-testid="cms-save-btn"
                        disabled
                        title="${escapeHtml(t("cms_locked_by_bin680_hint"))}">
                        <i class="fa fa-lock"></i> ${escapeHtml(t("cms_locked_by_bin680_label"))}
                      </button>`
                  : `<button type="submit"
                        class="btn btn-success"
                        data-action="save-cms-text"
                        data-testid="cms-save-btn">
                        <i class="fa fa-save"></i> ${escapeHtml(t("submit"))}
                      </button>`
              }
              <a class="btn btn-default" href="#/cms">${escapeHtml(t("cancel"))}</a>
            </div>
          </div>
        </form>
      ${boxClose()}
    </section>`;

  const form = container.querySelector<HTMLFormElement>("#cms-text-form")!;
  const textarea = container.querySelector<HTMLTextAreaElement>("#cms-body")!;

  void (async () => {
    try {
      const record = await getCmsText(key);
      textarea.value = record.body;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
    }
  })();

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (isLocked) {
      Toast.error(t("cms_regulatory_locked_body"));
      return;
    }
    void (async () => {
      try {
        await setCmsText(key, textarea.value);
        Toast.success(t("success"));
      } catch (err) {
        if (err instanceof ApiError && err.code === "FEATURE_DISABLED") {
          Toast.error(t("cms_regulatory_locked_body"));
          return;
        }
        const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
        Toast.error(msg);
      }
    })();
  });
}
