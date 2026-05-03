// Shared helpers for cash-inout pages: breadcrumb, box scaffolding, number formatting.
// Centralised here so all 12 ported pages share the same chrome.

import { t } from "../../i18n/I18n.js";

import { escapeHtml } from "../../utils/escapeHtml.js";
export { escapeHtml };
export function formatNOK(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "00.00";
  return n.toFixed(2);
}

// 2026-05-02 (Tobias UX): no-op. Shell rendrer header+breadcrumb i
// `Breadcrumb.ts`; per-page contentHeader var duplikat. Beholder
// signaturen for bakoverkompatibilitet med eksisterende callers.
export function contentHeader(_titleKey: string, _extraCrumb?: string): string {
  return "";
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
