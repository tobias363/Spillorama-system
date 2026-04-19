// PR-B4 (BIN-646) — shared helpers for amountwithdraw + transactions + wallets.
// Gjenbrukes av bank/hall-requests, history, deposit-kø, emails, wallet-listene.
//
// Eksporterer:
//   - contentHeader / boxOpen / boxClose — tynne wrappers med amountwithdraw-breadcrumb
//   - formatAmountCents — 50000 øre → "500.00"
//   - statusBadge — pending/completed/failed/rejected chip i legacy-farger
//   - dateDefaultRange — "siste 7 dager" (regulatorisk krav fra PR-B4-PLAN §3)
//   - parseCents — inn-input til øre (2 desimaler presisjon)
//   - escapeHtml — lokal gjenbruk for å unngå cross-module cycle
//
// Gjenbruker bevisst IKKE cash-inout/shared.ts siden hverken breadcrumb-trail
// eller box-variant matcher (amountwithdraw-sider er ADMIN-views, ikke
// shift-scoped agent-sider). Lite duplisering, men unngår feature-cycle.

import { t } from "../../i18n/I18n.js";
import type {
  PaymentRequestStatus,
  PaymentRequestDestinationType,
} from "../../api/admin-payments.js";

export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

/** 50000 øre → "500.00" (NOK). Negativt/NaN → "0.00". */
export function formatAmountCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "0.00";
  return (cents / 100).toFixed(2);
}

/** Input-string "500" | "500.50" → 50050 øre. NaN → null. */
export function parseCents(input: string): number | null {
  const n = Number(String(input).trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Returner [startISO, endISO] for "siste 7 dager" (YYYY-MM-DD). */
export function dateDefaultRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 7);
  const fmt = (d: Date): string => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

export function contentHeader(
  titleKey: string,
  moduleKey = "withdraw_management"
): string {
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
 * Status-chip som matcher legacy bankRequests.html:220–225.
 * Maps backend-status ACCEPTED/REJECTED til legacy completed/rejected.
 */
export function statusBadge(status: PaymentRequestStatus): string {
  const map: Record<PaymentRequestStatus, { cls: string; label: string }> = {
    PENDING: { cls: "bg-blue", label: t("pending") },
    ACCEPTED: { cls: "bg-green", label: t("accepted") },
    REJECTED: { cls: "bg-red", label: t("rejected") },
  };
  const m = map[status];
  return `<span class="badge ${m.cls}">${escapeHtml(m.label)}</span>`;
}

/** Header-label for destinationType-kolonne (bare for withdraw-kø). */
export function destinationBadge(
  destination: PaymentRequestDestinationType | null
): string {
  if (!destination) return "";
  const label = destination === "bank" ? t("bank_account_number") : t("hall_name");
  const cls = destination === "bank" ? "bg-blue" : "bg-purple";
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}
