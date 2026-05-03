// PR-A5 (BIN-663) — shared helpers for admin/user/agent-management pages.
//
// Intentionally minimal: breadcrumb + box chrome + status badge. We avoid
// cross-feature imports (products/shared has a different breadcrumb root).

import { t } from "../../i18n/I18n.js";

import { escapeHtml } from "../../utils/escapeHtml.js";
export { escapeHtml };
/** Content-header with breadcrumb; moduleKey picks Admin/Agent/User/Hall root. */
export function contentHeader(_titleKey: string, _moduleKey: string): string {
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

/** Label label-* styled ACTIVE / INACTIVE chip. */
export function activeBadge(isActive: boolean): string {
  const cls = isActive ? "label-success" : "label-default";
  const label = isActive ? t("active") : t("inactive");
  return `<span class="label ${cls}">${escapeHtml(label)}</span>`;
}

/** Human-readable role label (falls back to enum string). */
export function roleLabel(role: string): string {
  const key = `role_enum_${role.toLowerCase()}`;
  const translated = t(key);
  // If i18n has no mapping (returns the key back), fall back to the enum value.
  return translated === key ? role : translated;
}
