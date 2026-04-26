// PR-A5 (BIN-663) — shared helpers for admin/user/agent-management pages.
//
// Intentionally minimal: breadcrumb + box chrome + status badge. We avoid
// cross-feature imports (products/shared has a different breadcrumb root).

import { t } from "../../i18n/I18n.js";

export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

/** Content-header with breadcrumb; moduleKey picks Admin/Agent/User/Hall root. */
export function contentHeader(titleKey: string, moduleKey: string): string {
  return `
    <section class="content-header">
      <h1>${escapeHtml(t(titleKey))}</h1>
      <ol class="breadcrumb">
        <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
        <li>${escapeHtml(t(moduleKey))}</li>
        <li class="active">${escapeHtml(t(titleKey))}</li>
      </ol>
    </section>`;
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
