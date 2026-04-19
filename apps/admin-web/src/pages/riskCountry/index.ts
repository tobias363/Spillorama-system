// PR-B6 (BIN-664) — Risk-country route dispatcher.
//
// Routes:
//   /riskCountry   → RiskCountryPage (list + add-modal + delete-confirm)
//
// Note: legacy `riskCountry/add.html` is intentionally NOT ported — that
// file is misnamed (contains an agent-add form, not risk-country). Legacy
// add-flow uses an inline modal in riskCountry.html, which we mirror.
// See docs/archive/legacy-admin-bkp/README.md for details.

import { renderRiskCountryPage } from "./RiskCountryPage.js";

const RISK_COUNTRY_ROUTES = new Set<string>(["/riskCountry"]);

export function isRiskCountryRoute(path: string): boolean {
  return RISK_COUNTRY_ROUTES.has(path);
}

export function mountRiskCountryRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  switch (path) {
    case "/riskCountry":
      renderRiskCountryPage(container);
      return;
    default:
      container.innerHTML = `<div class="box box-danger"><div class="box-body">Unknown riskCountry route: ${path}</div></div>`;
  }
}
