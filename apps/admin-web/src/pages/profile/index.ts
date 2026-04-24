// BIN-720: Profile-route dispatcher.
//
// Routes:
//   /profile/settings  → SettingsPage (selv-service: loss-limits, block-myself,
//                        language, pause).

import { renderProfileSettingsPage } from "./SettingsPage.js";

export function isProfileRoute(path: string): boolean {
  return path === "/profile/settings";
}

export function mountProfileRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  if (path === "/profile/settings") return renderProfileSettingsPage(container);
  container.innerHTML = `<div class="box box-danger"><div class="box-body">Unknown profile route: ${path}</div></div>`;
}
