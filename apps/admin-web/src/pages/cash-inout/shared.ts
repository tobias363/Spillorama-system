// Shared helpers for cash-inout pages: breadcrumb, box scaffolding, number formatting.
// Centralised here so all 12 ported pages share the same chrome.

import { t } from "../../i18n/I18n.js";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function formatNOK(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "00.00";
  return n.toFixed(2);
}

export function contentHeader(titleKey: string, extraCrumb?: string): string {
  const title = escapeHtml(t(titleKey));
  const extra = extraCrumb ? `<li class="active">${escapeHtml(extraCrumb)}</li>` : `<li class="active">${title}</li>`;
  return `
    <section class="content-header">
      <h1>${title}</h1>
      <ol class="breadcrumb">
        <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
        ${extra}
      </ol>
    </section>`;
}

export function boxOpen(titleKey: string, variant: "default" | "primary" | "info" | "danger" | "success" = "default"): string {
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

/** Read a `?key=value` param from the current hash (after the `?`). */
export function hashParam(key: string): string | null {
  const hash = window.location.hash;
  const qIdx = hash.indexOf("?");
  if (qIdx < 0) return null;
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  return params.get(key);
}
