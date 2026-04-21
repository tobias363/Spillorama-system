// PR-B2: BankID response — port of
// (note: legacy typo kept in filename; we use "ResponsePage").
//
// Shows success/error/pending state after provider redirect.
// URL: #/bankid/response?status=success|error|pending&message=...

import { t } from "../../i18n/I18n.js";
import { contentHeader, escapeHtml, hashParam } from "../players/shared.js";

type ResponseStatus = "success" | "error" | "pending";

export function renderBankIdResponsePage(container: HTMLElement): void {
  const raw = hashParam("status");
  const status: ResponseStatus = raw === "success" || raw === "error" ? raw : "pending";
  const message = hashParam("message") ?? "";

  const iconMap: Record<ResponseStatus, string> = {
    success: "check",
    error: "exclamation",
    pending: "clock-o",
  };
  const variantMap: Record<ResponseStatus, string> = {
    success: "success",
    error: "danger",
    pending: "warning",
  };
  const titleMap: Record<ResponseStatus, string> = {
    success: t("bankid_response_success_title"),
    error: t("bankid_response_error_title"),
    pending: t("bankid_response_pending_title"),
  };
  const textMap: Record<ResponseStatus, string> = {
    success: t("bankid_response_success_text"),
    error: t("bankid_response_error_text"),
    pending: t("bankid_response_pending_text"),
  };

  container.innerHTML = `
    ${contentHeader("bankid_response_page_title")}
    <section class="content">
      <div class="box box-${variantMap[status]}">
        <div class="box-body text-center" style="padding:48px 16px;">
          <div style="font-size:64px; color:var(--panel-${variantMap[status]}-color, #555); margin-bottom:16px;">
            <i class="fa fa-${iconMap[status]}"></i>
          </div>
          <h2>${escapeHtml(titleMap[status])}</h2>
          <p>${escapeHtml(textMap[status])}</p>
          ${message ? `<p class="text-muted">${escapeHtml(message)}</p>` : ""}
          <a href="#/player" class="btn btn-primary" style="margin-top:16px;">
            <i class="fa fa-arrow-left"></i> ${escapeHtml(t("go_back"))}
          </a>
        </div>
      </div>
    </section>`;
}
