// PR-B6 (BIN-664) — shared helpers for security-management pages.
// Intentionally small: each security page shares the same breadcrumb trail
// ("Security Management") and box-chrome pattern. Copies product-management
// pattern 1:1 for consistency across admin-web.

import { t } from "../../i18n/I18n.js";

export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

/** Content-header with breadcrumb rooted at "Security Management". */
export function contentHeader(titleKey: string, moduleKey = "security_management"): string {
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
 * Loose IPv4/IPv6 format validator. Backend is authoritative — this is UX.
 * Accepts:
 *   - IPv4: 4 octets 0-255, separated by dots
 *   - IPv6: 2-8 groups of up to 4 hex digits, separated by colons
 *   - CIDR suffix (e.g. /24) optional
 */
export function isValidIpLike(raw: string): boolean {
  const input = raw.trim();
  if (!input) return false;
  const [addr, mask] = input.split("/");
  if (mask !== undefined && !/^\d{1,3}$/.test(mask)) return false;
  if (!addr) return false;
  // IPv4
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m = ipv4.exec(addr);
  if (m) {
    return m.slice(1, 5).every((oct) => {
      const n = Number(oct);
      return n >= 0 && n <= 255;
    });
  }
  // IPv6 (loose)
  if (addr.includes(":")) {
    return /^[0-9a-fA-F:]+$/.test(addr) && addr.split(":").length >= 2 && addr.split(":").length <= 8;
  }
  return false;
}
