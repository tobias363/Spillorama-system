// PR-B2: BankID routes dispatcher.

import { renderBankIdVerifyPage } from "./VerifyPage.js";
import { renderBankIdResponsePage } from "./ResponsePage.js";
import { renderUnknownRoute } from "../../utils/escapeHtml.js";

const BANKID_ROUTES = new Set<string>(["/bankid/verify", "/bankid/response"]);

export function isBankIdRoute(path: string): boolean {
  return BANKID_ROUTES.has(path);
}

export function mountBankIdRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  switch (path) {
    case "/bankid/verify":
      renderBankIdVerifyPage(container);
      return;
    case "/bankid/response":
      renderBankIdResponsePage(container);
      return;
    default:
      container.innerHTML = renderUnknownRoute("bankid", path);
  }
}
