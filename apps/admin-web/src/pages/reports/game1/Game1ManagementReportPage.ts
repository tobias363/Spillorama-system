// BIN-BOT-01 — /report/management/game1.
//
// Legacy spec:
//   WF_B_Spillorama Admin V1.0.pdf p.29 (Report Management → Game 1)
//   WF_B_SpilloramaBotReport_V1.0_31.01.2024.pdf p.5-8 (By Player / By Bot)
//
// Columns: SubGame ID / Child Game ID / GoH Name / Hall Name / Started At /
//          OMS / UTD / Payout% / RES.
// Filters: from-date, to-date, group-of-hall, hall-name, by player/bot,
//          free-text search + reset.
// Toolbar: Print (window.print + print-CSS), Export CSV, Export Excel
//          (tab-separated .xls — no new dependency).
// Footer:  totals (OMS / UTD / Payout% / RES) over the whole filtered set.

import { t } from "../../../i18n/I18n.js";
import { escapeHtml } from "../../games/common/escape.js";
import {
  getGame1ManagementReport,
  type Game1ManagementReportRow,
  type Game1ManagementReportResponse,
} from "../../../api/admin-reports.js";
import { listHalls, type AdminHall } from "../../../api/admin-halls.js";
import { listHallGroups, type HallGroupRow } from "../../../api/admin-hall-groups.js";

interface FilterState {
  from: string;
  to: string;
  hallId: string;
  groupOfHallId: string;
  type: "player" | "bot";
  q: string;
}

const PAGE_SIZE = 10;

function defaultFilters(): FilterState {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return {
    from: toIsoDate(from),
    to: toIsoDate(to),
    hallId: "",
    groupOfHallId: "",
    type: "player",
    q: "",
  };
}

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("no-NO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number): string {
  return `${value.toLocaleString("no-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("no-NO");
}

export async function renderGame1ManagementReportPage(container: HTMLElement): Promise<void> {
  container.innerHTML = renderShell();

  const state: FilterState = defaultFilters();
  let halls: AdminHall[] = [];
  let groups: HallGroupRow[] = [];

  // Fire-and-forget — the filter dropdowns populate as data arrives.
  try {
    [halls, groups] = await Promise.all([
      listHalls({ includeInactive: true }).catch(() => [] as AdminHall[]),
      listHallGroups({ status: "active" })
        .then((r) => r.groups)
        .catch(() => [] as HallGroupRow[]),
    ]);
    populateHallDropdown(container, halls);
    populateGroupDropdown(container, groups);
  } catch {
    // Non-fatal — dropdowns simply stay empty.
  }

  bindFilters(container, state, async () => {
    await loadAndRender(container, state);
  });
  bindToolbar(container, state, () => getCurrentResponse());

  let lastResponse: Game1ManagementReportResponse | null = null;
  function getCurrentResponse(): Game1ManagementReportResponse | null {
    return lastResponse;
  }

  async function loadAndRender(c: HTMLElement, s: FilterState): Promise<void> {
    const tableHost = c.querySelector<HTMLElement>("#rmgame1-table-host");
    const totalsHost = c.querySelector<HTMLElement>("#rmgame1-totals");
    const noteHost = c.querySelector<HTMLElement>("#rmgame1-note");
    if (!tableHost || !totalsHost || !noteHost) return;

    tableHost.innerHTML = `<div class="text-muted" style="padding:16px;">${escapeHtml(
      t("loading"),
    )}</div>`;
    totalsHost.innerHTML = "";

    try {
      const response = await getGame1ManagementReport({
        from: s.from,
        to: s.to,
        hallId: s.hallId || undefined,
        groupOfHallId: s.groupOfHallId || undefined,
        type: s.type,
        q: s.q || undefined,
      });
      lastResponse = response;

      noteHost.innerHTML =
        s.type === "bot"
          ? `<div class="alert alert-info" style="margin-bottom:8px;"><i class="fa fa-info-circle" aria-hidden="true"></i> ${escapeHtml(
              t("bot_filter_not_supported_note"),
            )}</div>`
          : "";

      renderTable(tableHost, response.rows, 1);
      renderTotals(totalsHost, response.totals);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      tableHost.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
    }
  }

  await loadAndRender(container, state);
}

// ── Shell ───────────────────────────────────────────────────────────────────

function renderShell(): string {
  const title = t("report_management_game1");
  return `
<div class="page-wrapper"><div class="container-fluid">
  <style>
    @media print {
      body * { visibility: hidden !important; }
      #rmgame1-printable, #rmgame1-printable * { visibility: visible !important; }
      #rmgame1-printable { position: absolute !important; left: 0; top: 0; width: 100%; }
      .rmgame1-no-print { display: none !important; }
    }
    .rmgame1-filters { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; margin-bottom:12px; }
    .rmgame1-filters label { display:flex; flex-direction:column; font-size:12px; font-weight:500; }
    .rmgame1-filters input, .rmgame1-filters select { min-width:150px; padding:4px 8px; }
    .rmgame1-toolbar { display:flex; gap:8px; margin-bottom:12px; }
    .rmgame1-totals { margin-top:12px; padding:10px 12px; background:#f6f8fa; border:1px solid #e1e4e8; border-radius:4px; font-weight:600; }
    .rmgame1-totals span { margin-right:18px; }
    .rmgame1-pager { display:flex; gap:8px; align-items:center; justify-content:flex-end; margin-top:8px; }
    .rmgame1-pager button { padding:4px 10px; }
  </style>
  <section class="content-header rmgame1-no-print">
    <h1>${escapeHtml(title)}</h1>
    <ol class="breadcrumb">
      <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
      <li>${escapeHtml(t("report_management"))}</li>
      <li class="active">${escapeHtml(title)}</li>
    </ol>
  </section>
  <section class="content">
    <div class="row"><div class="col-sm-12">
      <div class="panel panel-default card-view">
        <div class="panel-heading rmgame1-no-print">
          <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(title)}</h6></div>
          <div class="clearfix"></div>
        </div>
        <div class="panel-wrapper collapse in">
          <div class="panel-body">
            <div class="rmgame1-toolbar rmgame1-no-print">
              <button type="button" class="btn btn-default btn-sm" id="rmgame1-print-btn">
                <i class="fa fa-print" aria-hidden="true"></i> ${escapeHtml(t("print_report"))}
              </button>
              <button type="button" class="btn btn-default btn-sm" id="rmgame1-csv-btn">
                <i class="fa fa-download" aria-hidden="true"></i> ${escapeHtml(t("export_csv"))}
              </button>
              <button type="button" class="btn btn-default btn-sm" id="rmgame1-xlsx-btn">
                <i class="fa fa-file-excel-o" aria-hidden="true"></i> ${escapeHtml(t("export_excel"))}
              </button>
            </div>
            <div class="rmgame1-filters rmgame1-no-print">
              <label>${escapeHtml(t("from_date"))}
                <input type="date" id="rmgame1-from" />
              </label>
              <label>${escapeHtml(t("to_date"))}
                <input type="date" id="rmgame1-to" />
              </label>
              <label>${escapeHtml(t("group_of_halls"))}
                <select id="rmgame1-group">
                  <option value="">${escapeHtml(t("all_groups"))}</option>
                </select>
              </label>
              <label>${escapeHtml(t("hall_name"))}
                <select id="rmgame1-hall">
                  <option value="">${escapeHtml(t("all_halls"))}</option>
                </select>
              </label>
              <label>${escapeHtml(t("type"))}
                <select id="rmgame1-type">
                  <option value="player">${escapeHtml(t("by_player"))}</option>
                  <option value="bot">${escapeHtml(t("by_bot"))}</option>
                </select>
              </label>
              <label>${escapeHtml(t("search"))}
                <input type="text" id="rmgame1-q" placeholder="${escapeHtml(t("search_subgame_id"))}" />
              </label>
              <button type="button" class="btn btn-default btn-sm" id="rmgame1-reset-btn">
                ${escapeHtml(t("reset"))}
              </button>
            </div>
            <div id="rmgame1-note"></div>
            <div id="rmgame1-printable">
              <h2 class="hidden-print" style="display:none;">${escapeHtml(title)}</h2>
              <div class="table-wrap"><div class="table-responsive">
                <div id="rmgame1-table-host"></div>
              </div></div>
              <div class="rmgame1-totals" id="rmgame1-totals"></div>
            </div>
          </div>
        </div>
      </div>
    </div></div>
  </section>
</div></div>`;
}

// ── Populate dropdowns ──────────────────────────────────────────────────────

function populateHallDropdown(container: HTMLElement, halls: AdminHall[]): void {
  const select = container.querySelector<HTMLSelectElement>("#rmgame1-hall");
  if (!select) return;
  for (const hall of halls) {
    const opt = document.createElement("option");
    opt.value = hall.id;
    opt.textContent = hall.name;
    select.append(opt);
  }
}

function populateGroupDropdown(container: HTMLElement, groups: HallGroupRow[]): void {
  const select = container.querySelector<HTMLSelectElement>("#rmgame1-group");
  if (!select) return;
  for (const group of groups) {
    const opt = document.createElement("option");
    opt.value = group.id;
    opt.textContent = group.name;
    select.append(opt);
  }
}

// ── Bind filter/toolbar events ──────────────────────────────────────────────

function bindFilters(
  container: HTMLElement,
  state: FilterState,
  onChange: () => Promise<void>,
): void {
  const fromInput = container.querySelector<HTMLInputElement>("#rmgame1-from");
  const toInput = container.querySelector<HTMLInputElement>("#rmgame1-to");
  const hallSelect = container.querySelector<HTMLSelectElement>("#rmgame1-hall");
  const groupSelect = container.querySelector<HTMLSelectElement>("#rmgame1-group");
  const typeSelect = container.querySelector<HTMLSelectElement>("#rmgame1-type");
  const qInput = container.querySelector<HTMLInputElement>("#rmgame1-q");
  const resetBtn = container.querySelector<HTMLButtonElement>("#rmgame1-reset-btn");

  if (fromInput) fromInput.value = state.from;
  if (toInput) toInput.value = state.to;

  fromInput?.addEventListener("change", () => {
    state.from = fromInput.value;
    void onChange();
  });
  toInput?.addEventListener("change", () => {
    state.to = toInput.value;
    void onChange();
  });
  hallSelect?.addEventListener("change", () => {
    state.hallId = hallSelect.value;
    void onChange();
  });
  groupSelect?.addEventListener("change", () => {
    state.groupOfHallId = groupSelect.value;
    void onChange();
  });
  typeSelect?.addEventListener("change", () => {
    state.type = typeSelect.value === "bot" ? "bot" : "player";
    void onChange();
  });

  // Debounce search typing so we don't hammer the backend per keystroke.
  let searchTimer: number | null = null;
  qInput?.addEventListener("input", () => {
    state.q = qInput.value;
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      void onChange();
    }, 300);
  });

  resetBtn?.addEventListener("click", () => {
    const d = defaultFilters();
    state.from = d.from;
    state.to = d.to;
    state.hallId = "";
    state.groupOfHallId = "";
    state.type = "player";
    state.q = "";
    if (fromInput) fromInput.value = d.from;
    if (toInput) toInput.value = d.to;
    if (hallSelect) hallSelect.value = "";
    if (groupSelect) groupSelect.value = "";
    if (typeSelect) typeSelect.value = "player";
    if (qInput) qInput.value = "";
    void onChange();
  });
}

function bindToolbar(
  container: HTMLElement,
  _state: FilterState,
  getResponse: () => Game1ManagementReportResponse | null,
): void {
  const printBtn = container.querySelector<HTMLButtonElement>("#rmgame1-print-btn");
  const csvBtn = container.querySelector<HTMLButtonElement>("#rmgame1-csv-btn");
  const xlsxBtn = container.querySelector<HTMLButtonElement>("#rmgame1-xlsx-btn");

  printBtn?.addEventListener("click", () => {
    window.print();
  });

  csvBtn?.addEventListener("click", () => {
    const res = getResponse();
    if (!res) return;
    downloadCsv(buildCsv(res), `report-management-game1-${res.from.slice(0, 10)}_${res.to.slice(0, 10)}.csv`);
  });

  xlsxBtn?.addEventListener("click", () => {
    const res = getResponse();
    if (!res) return;
    // "Excel" via tab-separated values with an .xls extension — Excel opens
    // this natively, and we avoid pulling in an xlsx library. Matches the
    // pattern used by legacy `reportList.js`'s export.
    downloadXls(
      buildTsv(res),
      `report-management-game1-${res.from.slice(0, 10)}_${res.to.slice(0, 10)}.xls`,
    );
  });
}

// ── Render table + totals ───────────────────────────────────────────────────

function renderTable(
  host: HTMLElement,
  rows: Game1ManagementReportRow[],
  page: number,
): void {
  host.innerHTML = "";
  if (rows.length === 0) {
    host.innerHTML = `<div class="text-muted" style="padding:16px;">${escapeHtml(
      t("no_subgames_found"),
    )}</div>`;
    return;
  }

  const pageSize = PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const start = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  const table = document.createElement("table");
  table.className = "table table-bordered table-hover";
  table.innerHTML = `
    <thead>
      <tr>
        <th>${escapeHtml(t("sub_game_id"))}</th>
        <th>${escapeHtml(t("child_game_id"))}</th>
        <th>${escapeHtml(t("group_of_halls"))}</th>
        <th>${escapeHtml(t("hall_name"))}</th>
        <th>${escapeHtml(t("started_at"))}</th>
        <th style="text-align:right;">${escapeHtml(t("oms"))}</th>
        <th style="text-align:right;">${escapeHtml(t("utd"))}</th>
        <th style="text-align:right;">${escapeHtml(t("payout_percent"))}</th>
        <th style="text-align:right;">${escapeHtml(t("res"))}</th>
      </tr>
    </thead>
    <tbody>
      ${pageRows
        .map(
          (r) => `
        <tr>
          <td><a href="#/reportGame1/subgames/${encodeURIComponent(
            r.parentScheduleId || r.subGameId,
          )}">${escapeHtml(r.subGameNumber ?? r.subGameId)}</a></td>
          <td>${escapeHtml(r.childGameId)}</td>
          <td>${escapeHtml(r.groupOfHallName ?? "—")}</td>
          <td>${escapeHtml(r.hallName)}</td>
          <td>${escapeHtml(formatDateTime(r.startedAt))}</td>
          <td style="text-align:right;">${escapeHtml(formatCurrency(r.oms))}</td>
          <td style="text-align:right;">${escapeHtml(formatCurrency(r.utd))}</td>
          <td style="text-align:right;">${escapeHtml(formatPercent(r.payoutPct))}</td>
          <td style="text-align:right;">${escapeHtml(formatCurrency(r.res))}</td>
        </tr>`,
        )
        .join("")}
    </tbody>`;
  host.append(table);

  if (totalPages > 1) {
    const pager = document.createElement("div");
    pager.className = "rmgame1-pager rmgame1-no-print";
    pager.innerHTML = `
      <button type="button" class="btn btn-default btn-sm" data-action="prev" ${
        currentPage <= 1 ? "disabled" : ""
      }>&laquo; ${escapeHtml(t("previous"))}</button>
      <span>${currentPage} / ${totalPages}</span>
      <button type="button" class="btn btn-default btn-sm" data-action="next" ${
        currentPage >= totalPages ? "disabled" : ""
      }>${escapeHtml(t("next"))} &raquo;</button>`;
    host.append(pager);

    pager.querySelector<HTMLButtonElement>("[data-action=prev]")?.addEventListener("click", () => {
      renderTable(host, rows, currentPage - 1);
    });
    pager.querySelector<HTMLButtonElement>("[data-action=next]")?.addEventListener("click", () => {
      renderTable(host, rows, currentPage + 1);
    });
  }
}

function renderTotals(
  host: HTMLElement,
  totals: Game1ManagementReportResponse["totals"],
): void {
  host.innerHTML = `
    <span>${escapeHtml(t("total_oms"))}: ${escapeHtml(formatCurrency(totals.oms))}</span>
    <span>${escapeHtml(t("total_utd"))}: ${escapeHtml(formatCurrency(totals.utd))}</span>
    <span>${escapeHtml(t("total_payout_percent"))}: ${escapeHtml(formatPercent(totals.payoutPct))}</span>
    <span>${escapeHtml(t("total_res"))}: ${escapeHtml(formatCurrency(totals.res))}</span>`;
}

// ── CSV / XLS export ────────────────────────────────────────────────────────

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(res: Game1ManagementReportResponse): string {
  const headers = [
    "subGameId",
    "childGameId",
    "groupOfHallName",
    "hallName",
    "startedAt",
    "OMS",
    "UTD",
    "PayoutPercent",
    "RES",
  ];
  const lines = [headers.join(",")];
  for (const r of res.rows) {
    lines.push(
      [
        r.subGameNumber ?? r.subGameId,
        r.childGameId,
        r.groupOfHallName ?? "",
        r.hallName,
        r.startedAt ?? "",
        r.oms.toFixed(2),
        r.utd.toFixed(2),
        r.payoutPct.toFixed(2),
        r.res.toFixed(2),
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  // Totals row.
  lines.push(
    [
      "TOTALS",
      "",
      "",
      "",
      "",
      res.totals.oms.toFixed(2),
      res.totals.utd.toFixed(2),
      res.totals.payoutPct.toFixed(2),
      res.totals.res.toFixed(2),
    ]
      .map(csvEscape)
      .join(","),
  );
  return lines.join("\r\n");
}

function buildTsv(res: Game1ManagementReportResponse): string {
  const headers = [
    "subGameId",
    "childGameId",
    "groupOfHallName",
    "hallName",
    "startedAt",
    "OMS",
    "UTD",
    "PayoutPercent",
    "RES",
  ];
  const lines = [headers.join("\t")];
  for (const r of res.rows) {
    lines.push(
      [
        r.subGameNumber ?? r.subGameId,
        r.childGameId,
        r.groupOfHallName ?? "",
        r.hallName,
        r.startedAt ?? "",
        r.oms.toFixed(2),
        r.utd.toFixed(2),
        r.payoutPct.toFixed(2),
        r.res.toFixed(2),
      ]
        .map((v) => String(v).replace(/\t/g, " "))
        .join("\t"),
    );
  }
  lines.push(
    [
      "TOTALS",
      "",
      "",
      "",
      "",
      res.totals.oms.toFixed(2),
      res.totals.utd.toFixed(2),
      res.totals.payoutPct.toFixed(2),
      res.totals.res.toFixed(2),
    ]
      .map((v) => String(v).replace(/\t/g, " "))
      .join("\t"),
  );
  return lines.join("\r\n");
}

function downloadCsv(content: string, filename: string): void {
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, filename);
}

function downloadXls(content: string, filename: string): void {
  const blob = new Blob(["\uFEFF" + content], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Test exports ────────────────────────────────────────────────────────────
// Exposed for unit-tests (avoid re-implementing CSV/TSV serialisation).

export const __testOnly = {
  buildCsv,
  buildTsv,
  formatCurrency,
  formatPercent,
  formatDateTime,
  defaultFilters,
  toIsoDate,
};
