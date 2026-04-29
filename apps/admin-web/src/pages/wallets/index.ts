// PR-B4 (BIN-646) — walletManagement route dispatcher.
//
// Routes:
//   /wallet          → wallet list (admin-view)
//   /wallet/view     → detail (hash-query: ?id=<walletId>)

import { renderWalletListPage } from "./WalletListPage.js";
import { renderWalletViewPage } from "./WalletViewPage.js";
import { renderUnknownRoute } from "../../utils/escapeHtml.js";

const WALLET_ROUTES = new Set<string>([
  "/wallet",
  "/wallet/view",
]);

export function isWalletRoute(path: string): boolean {
  return WALLET_ROUTES.has(path);
}

export function mountWalletRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  switch (path) {
    case "/wallet":
      renderWalletListPage(container);
      return;
    case "/wallet/view":
      renderWalletViewPage(container);
      return;
    default:
      container.innerHTML = renderUnknownRoute("wallet", path);
  }
}
