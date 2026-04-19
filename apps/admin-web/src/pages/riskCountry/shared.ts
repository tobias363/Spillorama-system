// PR-B6 (BIN-664) — shared helpers for risk-country admin pages.
// AML-compliance domain: FATF high-risk jurisdictions + EU-listen.
// Breadcrumb rooted at "Security Management" (same module_key as /blockedIp)
// so the sidebar groups the two AML-relevant pages together.

import { t } from "../../i18n/I18n.js";

export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

export function contentHeader(titleKey: string, moduleKey = "security_management"): string {
  return `
    <section class="content-header">
      <h1>${escapeHtml(t(titleKey))}</h1>
      <ol class="breadcrumb">
        <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
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
 * ISO-3166 alpha-2 country list (minimal — top jurisdictions that commonly
 * appear in AML risk-country lists). Backend is authoritative for valid codes
 * and de-duplication.
 *
 * Dropdown is populated from this list but filtered to codes NOT already in
 * the active risk-country table (matches legacy /getCountryList behaviour).
 */
export const ISO_COUNTRIES: Array<{ code: string; label: string }> = [
  { code: "AF", label: "Afghanistan" },
  { code: "AL", label: "Albania" },
  { code: "DZ", label: "Algeria" },
  { code: "AO", label: "Angola" },
  { code: "BB", label: "Barbados" },
  { code: "BY", label: "Belarus" },
  { code: "BJ", label: "Benin" },
  { code: "BF", label: "Burkina Faso" },
  { code: "BI", label: "Burundi" },
  { code: "KH", label: "Cambodia" },
  { code: "CM", label: "Cameroon" },
  { code: "CF", label: "Central African Republic" },
  { code: "TD", label: "Chad" },
  { code: "CI", label: "Côte d'Ivoire" },
  { code: "CD", label: "Democratic Republic of the Congo" },
  { code: "CU", label: "Cuba" },
  { code: "ER", label: "Eritrea" },
  { code: "GQ", label: "Equatorial Guinea" },
  { code: "GM", label: "Gambia" },
  { code: "GH", label: "Ghana" },
  { code: "GN", label: "Guinea" },
  { code: "GW", label: "Guinea-Bissau" },
  { code: "HT", label: "Haiti" },
  { code: "IR", label: "Iran" },
  { code: "IQ", label: "Iraq" },
  { code: "JM", label: "Jamaica" },
  { code: "KP", label: "North Korea" },
  { code: "LB", label: "Lebanon" },
  { code: "LR", label: "Liberia" },
  { code: "LY", label: "Libya" },
  { code: "ML", label: "Mali" },
  { code: "MR", label: "Mauritania" },
  { code: "MM", label: "Myanmar" },
  { code: "NI", label: "Nicaragua" },
  { code: "NE", label: "Niger" },
  { code: "NG", label: "Nigeria" },
  { code: "PK", label: "Pakistan" },
  { code: "PA", label: "Panama" },
  { code: "PH", label: "Philippines" },
  { code: "RU", label: "Russia" },
  { code: "RW", label: "Rwanda" },
  { code: "SN", label: "Senegal" },
  { code: "SL", label: "Sierra Leone" },
  { code: "SO", label: "Somalia" },
  { code: "SS", label: "South Sudan" },
  { code: "SD", label: "Sudan" },
  { code: "SY", label: "Syria" },
  { code: "TG", label: "Togo" },
  { code: "TN", label: "Tunisia" },
  { code: "UG", label: "Uganda" },
  { code: "VE", label: "Venezuela" },
  { code: "VN", label: "Vietnam" },
  { code: "YE", label: "Yemen" },
  { code: "ZW", label: "Zimbabwe" },
];
