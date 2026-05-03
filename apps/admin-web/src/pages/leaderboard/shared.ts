// BIN-668 — shared helpers for leaderboard tier admin pages.

import { t } from "../../i18n/I18n.js";

import { escapeHtml } from "../../utils/escapeHtml.js";
export { escapeHtml };
export function contentHeader(_titleKey: string, _moduleKey = "leaderboard_management"): string {
  // 2026-05-02 (Tobias UX): no-op. Shell rendrer header+breadcrumb i
  // `Breadcrumb.ts`; per-page contentHeader var duplikat. Beholder
  // signaturen for bakoverkompatibilitet.
  return "";
}

export function boxOpen(
  titleKey: string,
  variant: "default" | "primary" | "info" | "danger" | "success" | "warning" = "default"
): string {
  return `
    <div class="box box-${variant}">
      <div class="box-header with-border">
        <h3 class="box-title">${escapeHtml(t(titleKey))}</h3>
      </div>
      <div class="box-body">`;
}

export function boxClose(): string {
  return `</div></div>`;
}
