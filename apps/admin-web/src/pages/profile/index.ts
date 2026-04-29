// BIN-720 + REQ-129/132: Profile-route dispatcher.
//
// Routes:
//   /profile/settings  → SettingsPage (selv-service: loss-limits, block-myself,
//                        language, pause).
//   /profile/security  → SecurityPage (2FA-aktivering + active sessions).

import { renderProfileSettingsPage } from "./SettingsPage.js";
import { renderSecurityPage } from "./SecurityPage.js";
import { renderUnknownRoute } from "../../utils/escapeHtml.js";

export function isProfileRoute(path: string): boolean {
  return path === "/profile/settings" || path === "/profile/security";
}

export function mountProfileRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  if (path === "/profile/settings") return renderProfileSettingsPage(container);
  if (path === "/profile/security") return renderSecurityPage(container);
  container.innerHTML = renderUnknownRoute("profile", path);
}
