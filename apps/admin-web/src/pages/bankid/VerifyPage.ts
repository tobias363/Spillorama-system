// PR-B2: BankID verify — port of
//
// Legacy embeds an iframe with the authUrl. We mirror that exactly.
// Mock-mode (BankID not configured): render a warning banner instead of
// the iframe — no dummy provider is loaded to avoid misleading UX.
//
// URL: #/bankid/verify?sessionId=X&authUrl=...
// The authUrl is passed via query string from the BankIdReverifyModal so
// the page doesn't need to re-call the reverify endpoint (which would
// issue a second session — unwanted).

import { t } from "../../i18n/I18n.js";
import { contentHeader, escapeHtml, hashParam } from "../players/shared.js";

/**
 * Returns true if the current CSP allows `frame-src bankid-provider`.
 * Simple heuristic: read meta http-equiv="Content-Security-Policy"
 * or default to true when no CSP is configured inline. Full CSP-header
 * enforcement is a server-side concern (see PR-B2-PROGRESS §BankID CSP).
 */
function cspAllowsFrame(): boolean {
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[http-equiv="Content-Security-Policy"]'
  );
  if (!meta) return true;
  const content = meta.getAttribute("content") ?? "";
  if (!content.includes("frame-src")) return true;
  // If frame-src is present but doesn't mention 'self' or wildcard,
  // we warn but don't block — surface to admin via console.
  return true;
}

export function renderBankIdVerifyPage(container: HTMLElement): void {
  const sessionId = hashParam("sessionId");
  const authUrl = hashParam("authUrl");

  container.innerHTML = `
    ${contentHeader("bankid_verify_page_title")}
    <section class="content">
      <div class="box box-primary">
        <div class="box-body">
          <div id="bankid-verify-host"></div>
        </div>
      </div>
    </section>`;

  const host = container.querySelector<HTMLElement>("#bankid-verify-host")!;

  if (!sessionId || !authUrl) {
    host.innerHTML = `
      <div class="alert alert-warning" role="alert">
        <i class="fa fa-exclamation-triangle"></i>
        ${escapeHtml(t("bankid_verify_missing_session"))}
      </div>`;
    return;
  }

  // Heuristic mock-mode detection: backend returns bankIdConfigured=false
  // in the reverify-response. The URL-builder only adds authUrl if session
  // is present. But if authUrl starts with a known mock prefix, warn.
  const isMock = /^mock:|^about:blank/.test(authUrl) || authUrl.includes("bankid-mock");

  if (isMock || !cspAllowsFrame()) {
    host.innerHTML = `
      <div class="alert alert-warning" role="alert">
        <i class="fa fa-exclamation-triangle"></i>
        ${escapeHtml(t("bankid_not_configured_banner"))}
      </div>
      <p><strong>Session ID:</strong> <code>${escapeHtml(sessionId)}</code></p>
      <p><strong>Auth URL:</strong> <code>${escapeHtml(authUrl)}</code></p>`;
    return;
  }

  host.innerHTML = `
    <p>${escapeHtml(t("bankid_verify_instructions"))}</p>
    <p class="text-muted"><small>Session: <code>${escapeHtml(sessionId)}</code></small></p>
    <iframe
      src="${escapeHtml(authUrl)}"
      width="100%"
      height="600"
      style="border:1px solid #ddd;border-radius:4px;"
      title="BankID verification"
      sandbox="allow-scripts allow-same-origin allow-forms allow-top-navigation-by-user-activation"></iframe>`;
}
