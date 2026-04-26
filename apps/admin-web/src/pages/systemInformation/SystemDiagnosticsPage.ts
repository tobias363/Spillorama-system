// BIN-678 — System-diagnostikk (runtime-info).
//
// Path: /system/info
//
// Viser cached snapshot av version/buildSha/buildTime/nodeVersion/env/uptime
// pluss feature-flag-map. Read-only; kreves SETTINGS_READ (ADMIN + HALL_
// OPERATOR + SUPPORT) — permissions håndheves backend-side.
//
// Designvalg:
//   - Beholder separat fra /system/systemInformation (BIN-674) som er
//     CMS-style system-information-textarea. Denne er diagnostikk-view.
//   - Ingen polling: uptime beregnes ved client-side delta ved refresh-klikk.
//   - Feature-flags vises som enkel kv-liste. Tom-state hvis ingen er satt.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import { getSystemInfo, type SystemInfoSnapshot } from "../../api/admin-system-info.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "../amountwithdraw/shared.js";

export function renderSystemDiagnosticsPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("system_diagnostics_title", "system_diagnostics")}
    <section class="content">
      ${boxOpen("system_diagnostics_title", "info")}
        <p class="text-muted">${escapeHtml(t("system_diagnostics_intro"))}</p>
        <div class="row" style="margin-bottom:8px;">
          <div class="col-sm-12 text-right">
            <button type="button" class="btn btn-xs btn-success" data-action="refresh" data-testid="system-info-refresh">
              <i class="fa fa-refresh" aria-hidden="true"></i> ${escapeHtml(t("refresh_table"))}
            </button>
          </div>
        </div>
        <div id="system-info-body" data-testid="system-info-body">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const body = container.querySelector<HTMLElement>("#system-info-body")!;
  container
    .querySelector<HTMLButtonElement>("[data-action='refresh']")
    ?.addEventListener("click", () => void refresh());

  async function refresh(): Promise<void> {
    body.textContent = t("loading_ellipsis");
    try {
      const snap = await getSystemInfo();
      body.innerHTML = renderSnapshot(snap);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      body.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
    }
  }

  void refresh();
}

function renderSnapshot(snap: SystemInfoSnapshot): string {
  const rows: Array<[string, string]> = [
    [t("system_version"), snap.version],
    [t("system_build_sha"), snap.buildSha],
    [t("system_build_time"), snap.buildTime],
    [t("system_node_version"), snap.nodeVersion],
    [t("system_environment"), snap.env],
    [
      t("system_uptime"),
      `${snap.uptime} ${t("system_uptime_seconds")}`,
    ],
  ];

  const rowHtml = rows
    .map(
      ([k, v]) =>
        `<tr><th style="width:30%;">${escapeHtml(k)}</th><td data-testid="system-info-${slug(k)}">${escapeHtml(v)}</td></tr>`
    )
    .join("");

  const flagEntries = Object.entries(snap.features);
  const flagsHtml = flagEntries.length
    ? `<table class="table table-striped">
         <thead><tr><th>${escapeHtml(t("system_feature_flags"))}</th><th>${escapeHtml(t("status"))}</th></tr></thead>
         <tbody data-testid="system-info-flags">
           ${flagEntries
             .map(
               ([k, v]) =>
                 `<tr><td><code>${escapeHtml(k)}</code></td><td>${v ? '<span class="label label-success">on</span>' : '<span class="label label-default">off</span>'}</td></tr>`
             )
             .join("")}
         </tbody>
       </table>`
    : `<p class="text-muted" data-testid="system-info-flags-empty">${escapeHtml(t("system_no_feature_flags"))}</p>`;

  return `
    <table class="table table-bordered">
      <tbody>${rowHtml}</tbody>
    </table>
    ${flagsHtml}
  `;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
