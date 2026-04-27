// ADMIN Super-User Operations Console — route dispatcher.
//
// Path: /admin/ops → AdminOpsConsolePage.
//
// Active handle is kept in module-scope so navigating away unmounts the
// socket cleanly. main.ts re-mounts on every navigation, so we dispose
// the previous handle before creating a new one.

import {
  renderAdminOpsConsolePage,
  type AdminOpsConsoleHandle,
} from "./AdminOpsConsolePage.js";

let activeHandle: AdminOpsConsoleHandle | null = null;

export function isAdminOpsRoute(path: string): boolean {
  return path === "/admin/ops";
}

export function mountAdminOpsRoute(container: HTMLElement, path: string): void {
  unmountAdminOps();
  container.innerHTML = "";
  if (path === "/admin/ops") {
    activeHandle = renderAdminOpsConsolePage(container);
    return;
  }
  container.innerHTML = `<div class="box box-danger"><div class="box-body">Unknown admin-ops route: ${path}</div></div>`;
}

export function unmountAdminOps(): void {
  if (activeHandle) {
    activeHandle.dispose();
    activeHandle = null;
  }
}
