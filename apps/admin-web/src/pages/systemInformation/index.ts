// PR-A6 (BIN-674) + BIN-678 — systemInformation dispatcher.
//
// Routes:
//   /system/systemInformation     → SystemInformationPage (CMS-style textarea)
//   /system/info                  → SystemDiagnosticsPage (BIN-678 runtime-diag)
//
// Design-avvik (§2.3): Summernote rich-text-editor erstattet med ren
// textarea + markdown-preview (vanilla DOM-only policy).

import { renderSystemInformationPage } from "./SystemInformationPage.js";
import { renderSystemDiagnosticsPage } from "./SystemDiagnosticsPage.js";

export function isSystemInformationRoute(path: string): boolean {
  return path === "/system/systemInformation" || path === "/system/info";
}

export function mountSystemInformationRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  if (path === "/system/systemInformation") return renderSystemInformationPage(container);
  if (path === "/system/info") return renderSystemDiagnosticsPage(container);
  container.innerHTML = `<div class="box box-danger"><div class="box-body">Unknown system route: ${path}</div></div>`;
}
