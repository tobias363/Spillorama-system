// BIN-650/651 wiring — /redFlagCategory (red-flag categories + per-category
// players drill-down).
//
// Legacy: report/redFlagCategories.html (460 linjer).
// Backend:
//   BIN-650: GET /api/admin/reports/red-flag/categories?from=&to=
//   BIN-651: GET /api/admin/reports/red-flag/players?category=&from=&to=&cursor=&limit=
//
// REGULATORY BIN-651: backend automatically writes AuditLog on GET of
// /api/admin/reports/red-flag/players (`admin.report.red_flag_players.viewed`).
// Front-end no longer issues an explicit audit POST.

import { DataTable } from "../../../components/DataTable.js";
import { t } from "../../../i18n/I18n.js";
import {
  fetchRedFlagCategories,
  fetchRedFlagPlayers,
} from "../../../api/admin-reports-redflag.js";
import {
  defaultDateRange,
  formatCurrency,
  formatDateTime,
  renderReportShell,
  toIsoDate,
} from "../shared/reportShell.js";
import { escapeHtml } from "../../games/common/escape.js";
import type {
  RedFlagCategoryRow,
  RedFlagPlayerEntry,
} from "../../../../../../packages/shared-types/src/reports.js";

const PAGE_SIZE = 50;

export async function renderRedFlagCategoryPage(
  container: HTMLElement,
  category?: string
): Promise<void> {
  if (category) {
    await renderPlayersForCategory(container, category);
    return;
  }
  await renderCategoryList(container);
}

async function renderCategoryList(container: HTMLElement): Promise<void> {
  const tableHostId = "redflag-categories-table";
  const { from, to } = defaultDateRange();
  let currentFrom = toIsoDate(from);
  let currentTo = toIsoDate(to);

  container.innerHTML = renderReportShell({
    title: t("red_flag_category"),
    tableHostId,
  });

  const hostEl = container.querySelector<HTMLElement>(`#${tableHostId}`);
  if (!hostEl) return;
  const host: HTMLElement = hostEl;

  const handle = DataTable.mount<RedFlagCategoryRow>(host, {
    rows: [],
    emptyMessage: t("no_data_available_in_table"),
    className: "redflag-categories",
    dateRange: {
      initialFrom: from,
      initialTo: to,
      onChange: (f, tD) => {
        if (f) currentFrom = toIsoDate(f);
        if (tD) currentTo = toIsoDate(tD);
        void reload();
      },
    },
    csvExport: { filename: "redflag-categories" },
    columns: [
      { key: "label", title: t("name") },
      {
        key: "description",
        title: t("description"),
        render: (r) => escapeHtml(r.description ?? ""),
      },
      {
        key: "severity",
        title: t("severity"),
        align: "center",
        render: (r) => {
          const cls =
            r.severity === "CRITICAL" || r.severity === "HIGH"
              ? "label-danger"
              : r.severity === "MEDIUM"
                ? "label-warning"
                : "label-info";
          return `<span class="label ${cls}">${escapeHtml(r.severity)}</span>`;
        },
      },
      { key: "count", title: t("total_flags"), align: "right" },
      { key: "openCount", title: t("open_flags"), align: "right" },
      {
        key: "category",
        title: t("actions"),
        align: "center",
        render: (r) =>
          `<a class="btn btn-info btn-xs btn-rounded" href="#/redFlagCategory/${encodeURIComponent(r.category)}/players" title="${escapeHtml(t("view"))}"><i class="fa fa-eye"></i></a>`,
      },
    ],
  });

  async function reload(): Promise<void> {
    try {
      clearInlineAlert(host);
      const res = await fetchRedFlagCategories({ from: currentFrom, to: currentTo });
      if (res.isPlaceholder || !res.response) {
        handle.setRows([]);
        host.insertAdjacentHTML(
          "afterbegin",
          `<div class="alert alert-warning">${escapeHtml(t("gap_red_flag_categories"))}</div>`
        );
        return;
      }
      handle.setRows(res.response.categories);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      host.insertAdjacentHTML(
        "afterbegin",
        `<div class="alert alert-danger">${escapeHtml(msg)}</div>`
      );
    }
  }

  await reload();
}

async function renderPlayersForCategory(
  container: HTMLElement,
  category: string
): Promise<void> {
  const tableHostId = "redflag-players-table";
  const { from, to } = defaultDateRange();
  let currentFrom = toIsoDate(from);
  let currentTo = toIsoDate(to);

  container.innerHTML = renderReportShell({
    title: `${t("red_flag_category")} — ${t("players")}`,
    subtitle: category,
    tableHostId,
  });

  const hostEl = container.querySelector<HTMLElement>(`#${tableHostId}`);
  if (!hostEl) return;
  const host: HTMLElement = hostEl;

  DataTable.mount<RedFlagPlayerEntry>(host, {
    rows: [],
    emptyMessage: t("no_data_available_in_table"),
    className: "redflag-players",
    dateRange: {
      initialFrom: from,
      initialTo: to,
      onChange: (f, tD) => {
        if (f) currentFrom = toIsoDate(f);
        if (tD) currentTo = toIsoDate(tD);
        // Cursor-paged DataTable handles re-load via `refresh()` which the
        // component invokes internally through dateRange.onChange → caller is
        // expected to trigger refresh. We re-mount via the wrapper below.
        void reloadHandle();
      },
    },
    cursorPaging: {
      pageSize: PAGE_SIZE,
      load: async ({ cursor, limit }) => {
        const res = await fetchRedFlagPlayers({
          category,
          from: currentFrom,
          to: currentTo,
          cursor: cursor ?? undefined,
          limit,
        });
        if (res.isPlaceholder || !res.response) {
          return { rows: [], nextCursor: null };
        }
        return {
          rows: res.response.items,
          nextCursor: res.response.nextCursor,
        };
      },
    },
    csvExport: { filename: `redflag-players-${category}` },
    columns: [
      { key: "displayName", title: t("name") },
      { key: "email", title: t("email") },
      {
        key: "flaggedAt",
        title: t("flagged_at"),
        render: (r) => formatDateTime(r.flaggedAt),
      },
      {
        key: "totalStakes",
        title: t("total_stakes"),
        align: "right",
        render: (r) => formatCurrency(r.totalStakes),
      },
      {
        key: "lastActivity",
        title: t("last_activity"),
        render: (r) => formatDateTime(r.lastActivity),
      },
      {
        key: "userId",
        title: t("actions"),
        align: "center",
        render: (r) =>
          `<a class="btn btn-info btn-xs btn-rounded" href="#/redFlagCategory/userTransaction/${encodeURIComponent(r.userId)}" title="${escapeHtml(t("view"))}"><i class="fa fa-eye"></i></a>`,
      },
    ],
  });

  async function reloadHandle(): Promise<void> {
    // DataTable has its own refresh logic via cursorPaging; simplest reliable
    // way to re-run with new filter values is to re-render the player list.
    await renderPlayersForCategory(container, category);
  }

  // Attempt initial fetch to detect gap and render warning (cursorPaging
  // fires its own load internally — this is an extra explicit check so we
  // can surface the gap-banner if backend is still missing).
  try {
    const sanity = await fetchRedFlagPlayers({
      category,
      from: currentFrom,
      to: currentTo,
      limit: 1,
    });
    if (sanity.isPlaceholder) {
      host.insertAdjacentHTML(
        "afterbegin",
        `<div class="alert alert-warning">${escapeHtml(t("gap_red_flag_players"))}</div>`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    host.insertAdjacentHTML(
      "afterbegin",
      `<div class="alert alert-danger">${escapeHtml(msg)}</div>`
    );
  }
}

function clearInlineAlert(host: HTMLElement): void {
  host.querySelectorAll(":scope > .alert").forEach((n) => n.remove());
}
