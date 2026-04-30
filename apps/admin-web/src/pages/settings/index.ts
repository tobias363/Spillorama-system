// BIN-677 — settings dispatcher.
//
// Routes:
//   /settings                     → SettingsPage (system-wide registry)
//   /maintenance                  → MaintenanceListPage
//   /maintenance/new              → MaintenanceFormPage (create)
//   /maintenance/edit/:id         → MaintenanceFormPage (edit)
//   /screen-saver                 → ScreenSaverPage (Fase 1 MVP §24)

import { renderSettingsPage } from "./SettingsPage.js";
import { renderMaintenanceListPage } from "./MaintenanceListPage.js";
import { renderMaintenanceFormPage } from "./MaintenanceFormPage.js";
import { renderScreenSaverPage } from "./ScreenSaverPage.js";
import { renderUnknownRoute } from "../../utils/escapeHtml.js";

const MAINTENANCE_EDIT_RE = /^\/maintenance\/edit\/[^/]+$/;

export function isSettingsRoute(path: string): boolean {
  if (
    path === "/settings" ||
    path === "/maintenance" ||
    path === "/maintenance/new" ||
    path === "/screen-saver"
  ) {
    return true;
  }
  return MAINTENANCE_EDIT_RE.test(path);
}

export function mountSettingsRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  if (path === "/settings") return renderSettingsPage(container);
  if (path === "/screen-saver") return renderScreenSaverPage(container);
  if (path === "/maintenance") return renderMaintenanceListPage(container);
  if (path === "/maintenance/new") return renderMaintenanceFormPage(container, null);
  if (MAINTENANCE_EDIT_RE.test(path)) {
    const id = decodeURIComponent(path.slice("/maintenance/edit/".length));
    return renderMaintenanceFormPage(container, id);
  }
  container.innerHTML = renderUnknownRoute("settings", path);
}
