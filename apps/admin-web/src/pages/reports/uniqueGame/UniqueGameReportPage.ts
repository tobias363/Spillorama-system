// BIN-649 wiring — /uniqueGameReport.
//
// Legacy: report/unique1reports.html (281 linjer). Unique-ticket lookup over
// `[uniqueIdStart..uniqueIdEnd]` range + optional hall/status/date filters.
// Backend: GET /api/admin/reports/unique-tickets/range (offset paginated,
// returns `rows: PhysicalTicket[]`).

import { DataTable } from "../../../components/DataTable.js";
import { t } from "../../../i18n/I18n.js";
import {
  fetchUniqueTicketsRange,
  type UniqueTicketsRangeRow,
  type UniqueTicketStatus,
} from "../../../api/admin-reports-physical.js";
import { listHalls } from "../../../api/admin-halls.js";
import {
  defaultDateRange,
  formatCurrency,
  formatDateTime,
  renderReportShell,
  toIsoDate,
} from "../shared/reportShell.js";
import { escapeHtml } from "../../games/common/escape.js";

const PAGE_SIZE = 50;

export async function renderUniqueGameReportPage(container: HTMLElement): Promise<void> {
  const tableHostId = "unique-game-report-table";
  const { from, to } = defaultDateRange();
  let currentFrom = toIsoDate(from);
  let currentTo = toIsoDate(to);
  let currentHallId: string | undefined;
  let currentStatus: UniqueTicketStatus | undefined;
  let currentStart: number | undefined;
  let currentEnd: number | undefined;
  const hallNameCache = new Map<string, string>();

  container.innerHTML = renderReportShell({
    title: t("unique_ticket"),
    tableHostId,
  });

  const hostEl = container.querySelector<HTMLElement>(`#${tableHostId}`);
  if (!hostEl) return;
  const host: HTMLElement = hostEl;

  const handle = DataTable.mount<UniqueTicketsRangeRow>(host, {
    rows: [],
    emptyMessage: t("no_data_available_in_table"),
    className: "unique-ticket-report",
    dateRange: {
      initialFrom: from,
      initialTo: to,
      onChange: (f, tD) => {
        if (f) currentFrom = toIsoDate(f);
        if (tD) currentTo = toIsoDate(tD);
        void reload();
      },
    },
    toolbar: {
      extra: (slot) => {
        slot.style.cssText = "display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;";
        slot.append(buildHallSelect((v) => {
          currentHallId = v || undefined;
          void reload();
        }, hallNameCache));
        slot.append(buildStatusSelect((v) => {
          currentStatus = v;
          void reload();
        }));
        slot.append(buildNumberInput(t("unique_id") + " " + t("from_label"), "unique-id-start", (v) => {
          currentStart = v;
          void reload();
        }));
        slot.append(buildNumberInput(t("unique_id") + " " + t("to_label"), "unique-id-end", (v) => {
          currentEnd = v;
          void reload();
        }));
      },
    },
    cursorPaging: {
      pageSize: PAGE_SIZE,
      load: async ({ cursor, limit }) => {
        const offset = cursor ? parseOffsetCursor(cursor) : 0;
        const res = await fetchUniqueTicketsRange({
          hallId: currentHallId,
          status: currentStatus,
          uniqueIdStart: currentStart,
          uniqueIdEnd: currentEnd,
          from: currentFrom,
          to: currentTo,
          limit,
          offset,
        });
        if (res.isPlaceholder || !res.response) {
          return { rows: [], nextCursor: null };
        }
        const rows = res.response.rows;
        // When full page returned, assume more may exist; backend is offset-paged.
        const nextCursor = rows.length === limit ? encodeOffsetCursor(offset + limit) : null;
        return { rows, nextCursor };
      },
    },
    csvExport: { filename: `unique-ticket-${currentFrom}_${currentTo}` },
    columns: [
      { key: "uniqueId", title: t("unique_id") },
      {
        key: "hallId",
        title: t("hall"),
        render: (r) => escapeHtml(hallNameCache.get(r.hallId) ?? r.hallId),
      },
      {
        key: "assignedGameId",
        title: t("game_id"),
        render: (r) => r.assignedGameId ?? "—",
      },
      {
        key: "status",
        title: t("status"),
        align: "center",
        render: (r) => {
          const cls =
            r.status === "SOLD"
              ? "label-success"
              : r.status === "VOIDED"
                ? "label-danger"
                : "label-default";
          return `<span class="label ${cls}">${escapeHtml(r.status)}</span>`;
        },
      },
      {
        key: "priceCents",
        title: t("total_stakes"),
        align: "right",
        render: (r) => (r.priceCents == null ? "—" : formatCurrency(r.priceCents)),
      },
      {
        key: "createdAt",
        title: t("created_at"),
        render: (r) => formatDateTime(r.createdAt),
      },
    ],
  });

  // Pre-populate hall cache so dropdown has names ready (non-fatal on failure).
  void (async () => {
    try {
      const halls = await listHalls({ includeInactive: true });
      for (const h of halls) hallNameCache.set(h.id, h.name);
      // Trigger a refresh so already-rendered rows pick up names.
      await handle.refresh();
    } catch {
      // Silent.
    }
  })();

  async function reload(): Promise<void> {
    try {
      clearInlineAlert(host);
      await handle.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      host.insertAdjacentHTML(
        "afterbegin",
        `<div class="alert alert-danger">${escapeHtml(msg)}</div>`
      );
    }
  }
}

function buildHallSelect(
  onChange: (hallId: string) => void,
  cache: Map<string, string>
): HTMLLabelElement {
  const wrapper = document.createElement("label");
  wrapper.style.cssText = "display:flex;flex-direction:column;font-size:12px;";
  wrapper.textContent = t("hall");
  const select = document.createElement("select");
  select.className = "form-control input-sm";
  select.setAttribute("data-testid", "hall-filter");
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = t("all_halls");
  select.append(optAll);
  select.addEventListener("change", () => onChange(select.value));
  wrapper.append(select);
  void (async () => {
    try {
      const halls = await listHalls({ includeInactive: true });
      for (const h of halls) {
        cache.set(h.id, h.name);
        const o = document.createElement("option");
        o.value = h.id;
        o.textContent = h.name;
        select.append(o);
      }
    } catch {
      // Silent.
    }
  })();
  return wrapper;
}

function buildStatusSelect(
  onChange: (status: UniqueTicketStatus | undefined) => void
): HTMLLabelElement {
  const wrapper = document.createElement("label");
  wrapper.style.cssText = "display:flex;flex-direction:column;font-size:12px;";
  wrapper.textContent = t("status");
  const select = document.createElement("select");
  select.className = "form-control input-sm";
  select.setAttribute("data-testid", "status-filter");
  const options: Array<[string, string]> = [
    ["", t("all")],
    ["SOLD", "SOLD"],
    ["UNSOLD", "UNSOLD"],
    ["VOIDED", "VOIDED"],
  ];
  for (const [value, label] of options) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    select.append(o);
  }
  select.addEventListener("change", () => {
    onChange((select.value || undefined) as UniqueTicketStatus | undefined);
  });
  wrapper.append(select);
  return wrapper;
}

function buildNumberInput(
  label: string,
  testId: string,
  onChange: (v: number | undefined) => void
): HTMLLabelElement {
  const wrapper = document.createElement("label");
  wrapper.style.cssText = "display:flex;flex-direction:column;font-size:12px;";
  wrapper.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.className = "form-control input-sm";
  input.style.width = "120px";
  input.setAttribute("data-testid", testId);
  input.addEventListener("change", () => {
    const n = input.value ? Number(input.value) : NaN;
    onChange(Number.isFinite(n) ? n : undefined);
  });
  wrapper.append(input);
  return wrapper;
}

function encodeOffsetCursor(offset: number): string {
  return btoa(String(offset)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function parseOffsetCursor(cursor: string): number {
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? padded : padded + "=".repeat(4 - (padded.length % 4));
    const n = Number(atob(pad));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function clearInlineAlert(host: HTMLElement): void {
  host.querySelectorAll(":scope > .alert").forEach((n) => n.remove());
}
