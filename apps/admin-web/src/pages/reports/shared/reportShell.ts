// PR-A4a (BIN-645) — shared shell + helpers for report pages.
//
// Every report page has the same outer structure (content-header +
// breadcrumb + panel + table host). Extracting it avoids ~30 LOC per page.

import { t } from "../../../i18n/I18n.js";
import { escapeHtml } from "../../games/common/escape.js";

export interface ReportShellOpts {
  /** Page title shown in h1 + last breadcrumb crumb. */
  title: string;
  /** Second-to-last crumb; defaults to "report_management" i18n-key. */
  moduleTitleKey?: string;
  /** Optional subtitle rendered under the h1 (<small>). */
  subtitle?: string;
  /** Id of the empty <div> that host will mount DataTable into. */
  tableHostId: string;
  /** Optional gap banner shown above the table (BIN-647/648/650/651). */
  gapBanner?: {
    issueId: string;
    message: string;
  };
  /** Optional extra content rendered below table (drill-down helpers etc). */
  extraBelow?: string;
}

export function renderReportShell(opts: ReportShellOpts): string {
  const moduleTitle = t(opts.moduleTitleKey ?? "report_management");
  const gap = opts.gapBanner
    ? `
    <div class="alert alert-warning" role="status" data-gap-banner="${escapeHtml(opts.gapBanner.issueId)}">
      <strong><i class="fa fa-info-circle" aria-hidden="true"></i> ${escapeHtml(t("pending_backend_endpoint"))}</strong>
      — ${escapeHtml(opts.gapBanner.message)}
      <small>(${escapeHtml(opts.gapBanner.issueId)})</small>
    </div>`
    : "";
  const subtitle = opts.subtitle
    ? `<small style="opacity:0.75;margin-left:8px;">${escapeHtml(opts.subtitle)}</small>`
    : "";
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(opts.title)}${subtitle}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li>${escapeHtml(moduleTitle)}</li>
          <li class="active">${escapeHtml(opts.title)}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(opts.title)}</h6></div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                ${gap}
                <div class="table-wrap"><div class="table-responsive">
                  <div id="${escapeHtml(opts.tableHostId)}"></div>
                </div></div>
                ${opts.extraBelow ?? ""}
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

/** Default date range: last 7 days ending today. */
export function defaultDateRange(): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return { from, to };
}

export function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatCurrency(oere: number): string {
  // Øre → kr with space-separator.
  const kr = oere / 100;
  return kr.toLocaleString("no-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("no-NO");
}
