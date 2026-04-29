// PR-A4b (BIN-659) — hallAccountReport dispatcher.
// REQ-143 — utvidet med /hallAccountReport/group/:groupId (aggregert).
//
// Handles the 4 hallAccountReport routes:
//   - /hallAccountReport                  (list of halls + group-dropdown)
//   - /hallAccountReport/:hallId          (per-hall daily history)
//   - /hallAccountReport/group/:groupId   (group-of-hall aggregert rapport)
//   - /report/settlement/:hallId          (per-hall settlement list + edit)
//
// Mirrors pages/reports/index.ts dispatcher pattern.

import { renderHallAccountListPage } from "./HallAccountListPage.js";
import { renderHallAccountReportPage } from "./HallAccountReportPage.js";
import { renderGroupHallAccountReportPage } from "./GroupHallAccountReportPage.js";
import { renderSettlementPage } from "./SettlementPage.js";
import { escapeHtml } from "../../utils/escapeHtml.js";

const STATIC_ROUTES = new Set<string>(["/hallAccountReport"]);

/** True if `path` is any hallAccount route handled here. */
export function isHallAccountRoute(path: string): boolean {
  const bare = path.split("?")[0] ?? path;
  if (STATIC_ROUTES.has(bare)) return true;
  return (
    /^\/hallAccountReport\/group\/[^/]+$/.test(bare) ||
    /^\/hallAccountReport\/[^/]+$/.test(bare) ||
    /^\/report\/settlement\/[^/]+$/.test(bare)
  );
}

export function mountHallAccountRoute(container: HTMLElement, path: string): void {
  const bare = path.split("?")[0] ?? path;

  if (bare === "/hallAccountReport") {
    void renderHallAccountListPage(container);
    return;
  }
  // REQ-143: group-aggregert variant — sjekk FØR per-hall regex slik at
  // path-segmentet "group" ikke matches som hallId.
  const groupDetail = /^\/hallAccountReport\/group\/([^/]+)$/.exec(bare);
  if (groupDetail && groupDetail[1]) {
    void renderGroupHallAccountReportPage(container, decodeURIComponent(groupDetail[1]));
    return;
  }
  const detail = /^\/hallAccountReport\/([^/]+)$/.exec(bare);
  if (detail && detail[1]) {
    void renderHallAccountReportPage(container, decodeURIComponent(detail[1]));
    return;
  }
  const settlement = /^\/report\/settlement\/([^/]+)$/.exec(bare);
  if (settlement && settlement[1]) {
    void renderSettlementPage(container, decodeURIComponent(settlement[1]));
    return;
  }

  container.innerHTML = `
    <div class="box box-danger">
      <div class="box-header with-border"><h3 class="box-title">404</h3></div>
      <div class="box-body">
        <p>Ukjent rute: <code>${escapeHtml(path)}</code></p>
        <a href="#/admin" class="btn btn-primary btn-sm">← Dashbord</a>
      </div>
    </div>`;
}
