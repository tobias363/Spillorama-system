// Shared helpers for players/pending/rejected/bankid/track-spending pages.
// Mirrors the pattern in pages/cash-inout/shared.ts so all ported sections
// share the same header/box scaffolding.

import { t } from "../../i18n/I18n.js";
import type { KycStatus, PlayerSummary } from "../../api/admin-players.js";

export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));
}

export function formatNOK(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "00.00";
  return n.toFixed(2);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("nb-NO");
}

export function contentHeader(titleKey: string, extraCrumb?: string): string {
  const title = escapeHtml(t(titleKey));
  const extra = extraCrumb
    ? `<li class="active">${escapeHtml(extraCrumb)}</li>`
    : `<li class="active">${title}</li>`;
  return `
    <section class="content-header">
      <h1>${title}</h1>
      <ol class="breadcrumb">
        <li><a href="#/admin"><i class="fa fa-dashboard"></i> ${escapeHtml(t("dashboard"))}</a></li>
        ${extra}
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

/** Read a `?key=value` param from the current hash (after the `?`). */
export function hashParam(key: string): string | null {
  const hash = window.location.hash;
  const qIdx = hash.indexOf("?");
  if (qIdx < 0) return null;
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  return params.get(key);
}

/** KYC-status label (i18n + fallback til engelsk). */
export function kycStatusLabel(status: KycStatus): string {
  switch (status) {
    case "VERIFIED":
      return t("kyc_status_verified");
    case "PENDING":
      return t("kyc_status_pending");
    case "REJECTED":
      return t("kyc_status_rejected");
    case "UNVERIFIED":
    default:
      return t("kyc_status_unverified");
  }
}

/** KYC-badge HTML for tabeller. Legacy-farger: grønn/gul/rød/grå. */
export function kycBadgeHtml(status: KycStatus): string {
  const label = escapeHtml(kycStatusLabel(status));
  const map: Record<KycStatus, string> = {
    VERIFIED: "label-success",
    PENDING: "label-warning",
    REJECTED: "label-danger",
    UNVERIFIED: "label-default",
  };
  return `<span class="label ${map[status]}">${label}</span>`;
}

/** Display name med e-post-fallback. */
export function playerLabel(p: PlayerSummary): string {
  return p.displayName || p.email || p.id;
}

/** `#/players/view/{id}` — detail-link. */
export function viewPlayerHash(id: string): string {
  return `#/players/view?id=${encodeURIComponent(id)}`;
}

/** `#/players/approved/view/{id}`. */
export function viewApprovedHash(id: string): string {
  return `#/players/approved/view?id=${encodeURIComponent(id)}`;
}

/** `#/pending/view?id=...`. */
export function viewPendingHash(id: string): string {
  return `#/pending/view?id=${encodeURIComponent(id)}`;
}

/** `#/rejected/view?id=...`. */
export function viewRejectedHash(id: string): string {
  return `#/rejected/view?id=${encodeURIComponent(id)}`;
}
