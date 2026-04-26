// PR-B2: Track-spending (Spillvett regulatorisk oppfølging).
//
// REGULATORISK KONTEKST: pengespillforskriften §11 (forebyggende tiltak)
// + Spillvett-memory. Fail-closed: vises INGEN data til aggregat-endpoint
// (BIN-628) er levert. Ingen tom-liste, ingen loading-spinner — banneret
// forklarer eksplisitt hvorfor siden ikke har data.
//
// Audit: ingen klient-side audit-call (backend har ikke POST-audit-endpoint).
// Når BIN-628 lander skal GET /api/admin/track-spending bli audit-logget
// backend-side som "admin.track_spending.viewed".

import { t } from "../../i18n/I18n.js";
import { contentHeader, escapeHtml } from "../players/shared.js";

export function renderTrackSpendingPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("tracking_player_spending")}
    <section class="content">
      <div class="alert alert-warning" role="alert" style="padding:16px;">
        <h4 style="margin-top:0;">
          <i class="fa fa-exclamation-triangle" aria-hidden="true"></i>
          ${escapeHtml(t("track_spending_banner_title"))}
        </h4>
        <p>${escapeHtml(t("track_spending_banner_body"))}</p>
        <p>
          <a href="https://linear.app/bingosystem/issue/BIN-628"
             target="_blank" rel="noopener" class="btn btn-default btn-sm">
            ${escapeHtml(t("track_spending_banner_cta"))}
          </a>
        </p>
      </div>

      <!-- Layout-paritet med legacy: viser filter-rad og tabell-header slik
           at admin får visuell bekreftelse på hvilke felt som kommer når
           BIN-628 lander. Filter-inputs er disabled — ingen call fires. -->
      <div class="box box-default">
        <div class="box-header with-border">
          <h3 class="box-title">${escapeHtml(t("tracking_player_spending"))}</h3>
        </div>
        <div class="box-body">
          <form id="ts-filter" class="form-inline" style="margin-bottom:12px;">
            <div class="form-group">
              <label for="ts-from">${escapeHtml(t("from_date"))}</label>
              <input type="date" id="ts-from" class="form-control" disabled>
            </div>
            <div class="form-group" style="margin-left:8px;">
              <label for="ts-to">${escapeHtml(t("to_date"))}</label>
              <input type="date" id="ts-to" class="form-control" disabled>
            </div>
            <div class="form-group" style="margin-left:8px;">
              <label for="ts-min-deposit">${escapeHtml(t("deposit_amount"))}</label>
              <input type="number" id="ts-min-deposit" class="form-control" disabled>
            </div>
            <div class="form-group" style="margin-left:8px;">
              <label for="ts-min-pct">${escapeHtml(t("bet_percentage"))} (%)</label>
              <input type="number" id="ts-min-pct" class="form-control" disabled>
            </div>
            <button type="submit" class="btn btn-info" style="margin-left:8px;" disabled
                    title="${escapeHtml(t("track_spending_banner_body"))}">
              <i class="fa fa-search" aria-hidden="true"></i> ${escapeHtml(t("search"))}
            </button>
          </form>

          <table class="table table-bordered table-striped">
            <thead>
              <tr>
                <th>${escapeHtml(t("customer_number"))}</th>
                <th>${escapeHtml(t("username"))}</th>
                <th>${escapeHtml(t("deposit_amount"))}</th>
                <th>${escapeHtml(t("bet_amount"))}</th>
                <th>${escapeHtml(t("bet_percentage"))}</th>
                <th>${escapeHtml(t("hall_name"))}</th>
                <th>${escapeHtml(t("action"))}</th>
              </tr>
            </thead>
            <tbody>
              <!-- INGEN RADER: fail-closed, ingen data til BIN-628 lander. -->
            </tbody>
          </table>
        </div>
      </div>
    </section>`;

  // No data-fetch. No audit-call. Fail-closed is the point.
}
