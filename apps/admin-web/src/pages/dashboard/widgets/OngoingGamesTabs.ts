// Ongoing games tabs (Game 1-3 + Game 5) — legacy dashboard.html:600-830
// (box-info). Bootstrap 3 nav-tabs; Game 2 is active by default (matches
// legacy). Game 4 / themebingo deprecated BIN-496.

import { t } from "../../../i18n/I18n.js";
import { GAME_TABS, type GameTab } from "../DashboardState.js";
import type { AdminRoomSummary } from "../../../api/dashboard.js";
import { escapeHtml } from "../../../utils/escapeHtml.js";

export interface OngoingGamesOptions {
  games: Record<GameTab, AdminRoomSummary[]>;
}

const COLUMNS: Record<GameTab, Array<{ key: string; titleKey: string; render?: (r: AdminRoomSummary) => string }>> = {
  game1: [
    { key: "code", titleKey: "daily_schedule_id" },
    { key: "dates", titleKey: "start_date_end_date", render: (r) => formatStartEnd(r) },
    { key: "hall", titleKey: "group_of_halls", render: (r) => r.hallName ?? r.hallId },
    { key: "master", titleKey: "master_halls", render: (r) => r.hallName ?? "—" },
  ],
  game2: [
    { key: "id", titleKey: "main_game_id", render: (r) => shortId(r.currentGame?.id) },
    { key: "name", titleKey: "game_name", render: (r) => r.currentGame?.gameSlug ?? "—" },
    { key: "start", titleKey: "start_date", render: (r) => formatDate(r.currentGame?.startedAt) },
    { key: "end", titleKey: "end_date", render: (r) => formatDate(r.currentGame?.endsAt) },
    { key: "prize", titleKey: "prize_of_lucky_number", render: (r) => formatNumber(r.currentGame?.luckyNumberPrize) },
    { key: "hall", titleKey: "group_of_halls", render: (r) => r.hallName ?? r.hallId },
    { key: "seconds", titleKey: "total_seconds_to_display_ball", render: () => "—" },
    { key: "minTickets", titleKey: "number_of_minimum_tickets_to_start_the_game", render: (r) => formatNumber(r.currentGame?.minTicketCount) },
    { key: "status", titleKey: "status", render: (r) => r.currentGame?.status ?? "—" },
  ],
  game3: [
    { key: "id", titleKey: "main_game_id", render: (r) => shortId(r.currentGame?.id) },
    { key: "name", titleKey: "game_name", render: (r) => r.currentGame?.gameSlug ?? "—" },
    { key: "dates", titleKey: "start_date_end_date", render: (r) => formatStartEnd(r) },
    { key: "hall", titleKey: "group_of_halls", render: (r) => r.hallName ?? r.hallId },
    { key: "status", titleKey: "status", render: (r) => r.currentGame?.status ?? "—" },
  ],
  game5: [
    { key: "number", titleKey: "game_number", render: (r) => shortId(r.currentGame?.id) },
    { key: "start", titleKey: "start_date", render: (r) => formatDate(r.currentGame?.startedAt) },
    { key: "hall", titleKey: "hall_name", render: (r) => r.hallName ?? r.hallId },
    { key: "status", titleKey: "status", render: (r) => r.currentGame?.status ?? "—" },
  ],
};

export function renderOngoingGamesTabs(opts: OngoingGamesOptions): HTMLElement {
  const box = document.createElement("div");
  box.className = "box box-info";
  box.innerHTML = `
    <div class="box-header with-border text-center">
      <h3 class="box-title text-bold">${escapeHtml(t("ongoing_game"))}</h3>
    </div>`;

  const body = document.createElement("div");
  body.className = "box-body";

  const nav = document.createElement("ul");
  nav.className = "nav nav-tabs";
  nav.setAttribute("style", "display: flex; justify-content: center;");

  const tabContent = document.createElement("div");
  tabContent.className = "tab-content";

  for (const tab of GAME_TABS) {
    const li = document.createElement("li");
    if (tab === "game2") li.className = "active";
    const a = document.createElement("a");
    a.href = `#tab-${tab}`;
    a.setAttribute("data-game-tab", tab);
    a.textContent = t(tab);
    a.addEventListener("click", (e) => {
      e.preventDefault();
      activateTab(nav, tabContent, tab);
    });
    li.append(a);
    nav.append(li);

    const pane = document.createElement("div");
    pane.id = `tab-${tab}`;
    pane.className = `tab-pane table-responsive${tab === "game2" ? " active" : ""}`;
    pane.append(buildGameTable(tab, opts.games[tab]));
    tabContent.append(pane);
  }

  body.append(nav, tabContent);
  box.append(body);

  const footer = document.createElement("div");
  footer.className = "box-footer text-center";
  footer.innerHTML = `<a href="#/gameManagement" class="uppercase">${escapeHtml(t("view_all_game"))}</a>`;
  box.append(footer);

  return box;
}

function activateTab(nav: HTMLElement, paneRoot: HTMLElement, tab: GameTab): void {
  nav.querySelectorAll("li").forEach((li) => li.classList.remove("active"));
  nav.querySelectorAll("a").forEach((a) => {
    if (a.getAttribute("data-game-tab") === tab) a.closest("li")?.classList.add("active");
  });
  paneRoot.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active", "in"));
  const target = paneRoot.querySelector(`#tab-${tab}`);
  target?.classList.add("active", "in");
}

function buildGameTable(tab: GameTab, rooms: AdminRoomSummary[]): HTMLElement {
  const table = document.createElement("table");
  table.className = "table no-margin";
  const cols = COLUMNS[tab];
  const thead = document.createElement("thead");
  thead.innerHTML = `<tr>${cols.map((c) => `<th>${escapeHtml(t(c.titleKey))}</th>`).join("")}</tr>`;
  table.append(thead);
  const tbody = document.createElement("tbody");
  if (rooms.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${cols.length}" style="text-align:center;">${escapeHtml(t("no_data_available_in_table"))}</td></tr>`;
  } else {
    for (const r of rooms) {
      const tr = document.createElement("tr");
      tr.innerHTML = cols
        .map((c) => {
          const v = c.render ? c.render(r) : (r as unknown as Record<string, unknown>)[c.key];
          return `<td>${escapeHtml(String(v ?? "—"))}</td>`;
        })
        .join("");
      tbody.append(tr);
    }
  }
  table.append(tbody);
  return table;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}
function formatStartEnd(r: AdminRoomSummary): string {
  return `${formatDate(r.currentGame?.startedAt)} → ${formatDate(r.currentGame?.endsAt)}`;
}
function formatNumber(v: number | undefined): string {
  return v == null ? "—" : String(v);
}
function shortId(id: string | undefined): string {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}
