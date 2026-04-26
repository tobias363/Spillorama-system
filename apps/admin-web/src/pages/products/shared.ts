// PR-B5 (BIN-660) — shared helpers for product-management pages.
// Intentionally small: each of the 3 product pages shares the same breadcrumb
// trail and status-badge styling. The shared module avoids cross-feature
// imports (e.g. amountwithdraw/shared.ts) because the breadcrumb module-key
// differs ("product_management" vs "withdraw_management").

import { t } from "../../i18n/I18n.js";
import type { ProductStatus } from "../../api/admin-products.js";

export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

/** 50050 øre → "500.50" (NOK). */
export function formatPriceCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "0.00";
  return (cents / 100).toFixed(2);
}

/** Input-string "500" | "500.50" → 50050 øre. Rejects NaN/negative. */
export function parseCents(input: string): number | null {
  const n = Number(String(input).trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Content-header with breadcrumb rooted at "Product Management". */
export function contentHeader(titleKey: string, moduleKey = "product_management"): string {
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
  variant: "default" | "primary" | "info" | "danger" | "success" = "default"
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

/**
 * ACTIVE/INACTIVE chip matching legacy product-list.html:330:
 * `<span style="color:green;font-weight:bold;">Active</span>` — ported to
 * AdminLTE `label label-*` so colour inherits from theme instead of inline.
 */
export function statusBadge(status: ProductStatus): string {
  const isActive = status === "ACTIVE";
  const cls = isActive ? "label-success" : "label-default";
  const label = isActive ? t("active") : t("inactive");
  return `<span class="label ${cls}">${escapeHtml(label)}</span>`;
}
