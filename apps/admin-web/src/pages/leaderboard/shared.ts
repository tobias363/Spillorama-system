// PR-B6 (BIN-664) — shared helpers for leaderboard tier admin pages.
// Placeholder-state: backend CRUD mangler per 2026-04-19. Se BIN-668.

import { t } from "../../i18n/I18n.js";

export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

export function contentHeader(titleKey: string, moduleKey = "leaderboard_management"): string {
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

/**
 * Fail-closed "backend pending" banner for the Leaderboard tier pages.
 * Uses `callout-warning` semantic class so SUPPORT users understand this
 * is planned CRUD (not a broken page) and links to BIN-668.
 */
export function backendPendingBanner(): string {
  return `
    <div class="callout callout-warning" data-testid="leaderboard-backend-pending-banner">
      <h4>
        <i class="fa fa-exclamation-triangle"></i>
        ${escapeHtml(t("placeholder_coming_soon"))}
      </h4>
      <p>${escapeHtml(t("leaderboard_backend_pending"))}</p>
      <p>
        <small>
          <a href="https://linear.app/bingosystem/issue/BIN-668" target="_blank" rel="noopener">
            BIN-668 — Leaderboard tier CRUD backend
          </a>
        </small>
      </p>
    </div>`;
}
