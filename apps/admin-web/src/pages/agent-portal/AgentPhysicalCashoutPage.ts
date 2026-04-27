// Agent-portal Physical Cashout (FOLLOWUP-12 — pilot-blokker).
//
// Per wireframe §17.33 → §17.34 → §17.35:
//   1. View 1 — Daily List: dato-velger (default i dag) viser tabell med
//      games i agentens hall + Pending Cashout-teller. Klikk på rad åpner
//      View 2 for det spesifikke spillet.
//   2. View 2 — Sub Game Detail: 8-kolonne tabell (Physical Ticket No,
//      Ticket Type, Ticket Price, Winning Pattern, Total Winning, Rewarded
//      Amount, Pending Amount, Action). Totals nederst + Reward All-knapp.
//      Action-knappen åpner per-ticket pattern-popup.
//   3. View 3 — Per-Ticket Pattern Popup: 5×5 grid med matched cells +
//      Cashout/Rewarded-status per pattern.
//
// Same-day-restriction: "Cash-out kun available for current day. After day
// ends kan ikke cashout." Hvis selected date != today (Oslo-tz) skjules
// Reward All og per-ticket Action-knapper i View 2.
//
// Hall-scope og auth: backend håndhever via agentBingo.ts. AGENT må ha
// aktiv shift, HALL_OPERATOR må ha tildelt hall.
//
// Bygger videre på eksisterende endpoints:
//   - GET  /api/agent/shift/current             — finne hallId
//   - GET  /api/admin/physical-tickets/games/in-hall?hallId=&from=&to=
//                                                 — daily list (BIN-638)
//   - GET  /api/agent/physical/pending?gameId=  — sub-game pending+rewarded
//   - POST /api/agent/physical/reward-all       — Reward All
//   - POST /api/agent/physical/:uniqueId/reward — Per-ticket reward

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { Modal } from "../../components/Modal.js";
import { ApiError } from "../../api/client.js";
import { getCurrentShift } from "../../api/agent-shift.js";
import {
  agentListPending,
  agentRewardAll,
  agentRewardTicket,
  type AgentPendingResponse,
} from "../../api/agent-bingo.js";
import {
  listGamesInHall,
  type PhysicalTicket,
  type PhysicalTicketPattern,
  type PhysicalTicketGameInHallRow,
} from "../../api/admin-physical-tickets.js";

// ── Types & helpers ─────────────────────────────────────────────────────────

type ViewMode = "daily-list" | "sub-game-detail";

interface PageState {
  hallId: string | null;
  view: ViewMode;
  /** Selected date in ISO yyyy-mm-dd format (Oslo-tz). */
  selectedDate: string;
  /** True if selected date == today (Oslo-tz). Same-day-restriction. */
  isCurrentDay: boolean;
  // View 1 state
  dailyRows: PhysicalTicketGameInHallRow[];
  // View 2 state
  selectedGameId: string | null;
  selectedGameName: string | null;
  pendingTickets: PhysicalTicket[];
  rewardedTickets: PhysicalTicket[];
  loading: boolean;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatNOK(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return "—";
  return (cents / 100).toFixed(2);
}

function patternLabel(p: PhysicalTicketPattern | null): string {
  if (!p) return "—";
  switch (p) {
    case "row_1": return t("pattern_label_row_1");
    case "row_2": return t("pattern_label_row_2");
    case "row_3": return t("pattern_label_row_3");
    case "row_4": return t("pattern_label_row_4");
    case "full_house": return t("pattern_label_full_house");
    default: return p;
  }
}

/**
 * Returnerer dagens dato i Oslo-tz som yyyy-mm-dd. Brukes som default i
 * date-pickeren og for same-day-sjekk.
 */
function todayOsloIso(): string {
  // Oslo bruker Europe/Oslo (CET/CEST). Bruk Intl for korrekt DST-håndtering.
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

/**
 * Gitt en yyyy-mm-dd dato, returnerer ISO-8601-strengene for start (00:00)
 * og slutt (23:59:59.999) av den dagen i Oslo-tz, som UTC-instants. Brukes
 * som from/to mot listGamesInHall.
 */
function dayBoundsOslo(dateIso: string): { from: string; to: string } {
  // Vi setter sammen dato med Oslo-tidssone-offset. Enklere strategi: behandle
  // som naive lokal tid og konverter via Date — siden klienten selv kjøres i
  // Norge (eller backend-side konverterer ved behov), gir dette korrekt
  // omtrentlig dag-vindu. For server-tilstand er BIN-638 inklusiv på timestamp,
  // så +/- DST-grenser er ikke kritisk for daglig liste.
  const [y, m, d] = dateIso.split("-").map((s) => Number(s));
  if (!y || !m || !d) {
    // Fallback til hele dagen UTC.
    return { from: `${dateIso}T00:00:00.000Z`, to: `${dateIso}T23:59:59.999Z` };
  }
  // Lag start/slutt i lokal tid og let JS regne offset.
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d, 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

// ── Public mount ────────────────────────────────────────────────────────────

export function mountAgentPhysicalCashout(container: HTMLElement): void {
  const today = todayOsloIso();
  const state: PageState = {
    hallId: null,
    view: "daily-list",
    selectedDate: today,
    isCurrentDay: true,
    dailyRows: [],
    selectedGameId: null,
    selectedGameName: null,
    pendingTickets: [],
    rewardedTickets: [],
    loading: false,
  };

  container.innerHTML = `
    <section class="content-header">
      <h1>${escapeHtml(t("agent_physical_cashout_title"))}</h1>
      <ol class="breadcrumb">
        <li><a href="#/agent/dashboard"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
        <li class="active">${escapeHtml(t("agent_physical_cashout_title"))}</li>
      </ol>
    </section>
    <section class="content">
      <div class="box box-primary">
        <div class="box-header with-border">
          <h3 class="box-title" id="cashout-title">${escapeHtml(t("agent_physical_cashout_title"))}</h3>
          <div class="box-tools pull-right" id="cashout-tools"></div>
        </div>
        <div class="box-body">
          <div id="cashout-banner"></div>
          <div id="cashout-body"><p>${escapeHtml(t("loading_ellipsis"))}</p></div>
        </div>
      </div>
    </section>`;

  const titleEl = container.querySelector<HTMLElement>("#cashout-title")!;
  const toolsEl = container.querySelector<HTMLElement>("#cashout-tools")!;
  const bannerEl = container.querySelector<HTMLElement>("#cashout-banner")!;
  const bodyEl = container.querySelector<HTMLElement>("#cashout-body")!;

  // Bootstrap: hent agentens hallId fra current shift
  void (async () => {
    try {
      const shift = await getCurrentShift();
      if (!shift || !shift.hallId) {
        bannerEl.innerHTML = `<div class="alert alert-warning">${escapeHtml(t("shift_not_active"))}</div>`;
        bodyEl.innerHTML = "";
        return;
      }
      state.hallId = shift.hallId;
      await loadDailyList();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      bannerEl.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
      bodyEl.innerHTML = "";
    }
  })();

  // ── View 1: Daily List ────────────────────────────────────────────────────

  async function loadDailyList(): Promise<void> {
    if (!state.hallId) return;
    state.view = "daily-list";
    state.isCurrentDay = state.selectedDate === todayOsloIso();
    state.loading = true;
    titleEl.textContent = t("agent_physical_cashout_title");
    toolsEl.innerHTML = "";
    renderDailyListShell();
    try {
      const { from, to } = dayBoundsOslo(state.selectedDate);
      const res = await listGamesInHall({ hallId: state.hallId, from, to, limit: 500 });
      state.dailyRows = res.rows;
      renderDailyListBody();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      bodyEl.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
    } finally {
      state.loading = false;
    }
  }

  function renderDailyListShell(): void {
    bannerEl.innerHTML = state.isCurrentDay
      ? ""
      : `<div class="alert alert-warning" style="margin-bottom:10px;">
           <i class="fa fa-lock" aria-hidden="true"></i>
           ${escapeHtml(t("agent_physical_cashout_same_day_locked"))}
         </div>`;
    bodyEl.innerHTML = `
      <p>${escapeHtml(t("agent_physical_cashout_daily_intro"))}</p>
      <form id="cashout-date-form" class="form-inline" style="margin-bottom:12px;" novalidate>
        <div class="form-group" style="margin-right:8px;">
          <label for="cashout-date" style="margin-right:6px;">${escapeHtml(t("date"))}</label>
          <input type="date" class="form-control" id="cashout-date"
            value="${escapeHtml(state.selectedDate)}" max="${escapeHtml(todayOsloIso())}">
        </div>
        <button type="submit" class="btn btn-primary">
          <i class="fa fa-search" aria-hidden="true"></i> ${escapeHtml(t("agent_physical_cashout_load"))}
        </button>
      </form>
      <div id="cashout-daily-table"></div>`;

    const dateForm = bodyEl.querySelector<HTMLFormElement>("#cashout-date-form")!;
    const dateInput = bodyEl.querySelector<HTMLInputElement>("#cashout-date")!;
    dateForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = dateInput.value.trim();
      if (!v) return;
      state.selectedDate = v;
      void loadDailyList();
    });
  }

  function renderDailyListBody(): void {
    const tableHost = bodyEl.querySelector<HTMLElement>("#cashout-daily-table");
    if (!tableHost) return;

    if (state.dailyRows.length === 0) {
      tableHost.innerHTML = `<div class="callout callout-info">
        ${escapeHtml(t("agent_physical_cashout_daily_empty"))}
      </div>`;
      return;
    }

    const rowsHtml = state.dailyRows.map((r) => {
      const gameId = r.gameId ?? "";
      const name = r.name ?? (gameId || t("agent_physical_cashout_unknown_game"));
      const pendingBadge = r.pendingCashoutCount > 0
        ? `<span class="label label-warning">${r.pendingCashoutCount}</span>`
        : `<span class="label label-default">0</span>`;
      const cashedOutBadge = r.cashedOut > 0
        ? `<span class="label label-success">${r.cashedOut}</span>`
        : `<span class="label label-default">0</span>`;
      const actionBtn = gameId
        ? `<button type="button" class="btn btn-info btn-xs" data-action="view-game"
             data-game-id="${escapeHtml(gameId)}" data-game-name="${escapeHtml(name)}">
             <i class="fa fa-eye" aria-hidden="true"></i> ${escapeHtml(t("view"))}
           </button>`
        : "—";
      return `<tr>
        <td>${escapeHtml(name)}</td>
        <td><code>${escapeHtml(gameId)}</code></td>
        <td class="text-right">${r.sold}</td>
        <td class="text-right">${pendingBadge}</td>
        <td class="text-right">${cashedOutBadge}</td>
        <td class="text-right">${formatNOK(r.totalRevenueCents)}</td>
        <td>${actionBtn}</td>
      </tr>`;
    }).join("");

    tableHost.innerHTML = `
      <table class="table table-bordered table-condensed table-hover" style="margin-bottom:0;">
        <thead>
          <tr>
            <th>${escapeHtml(t("game_name"))}</th>
            <th>${escapeHtml(t("game_id"))}</th>
            <th class="text-right">${escapeHtml(t("sold"))}</th>
            <th class="text-right">${escapeHtml(t("pending_cashout"))}</th>
            <th class="text-right">${escapeHtml(t("agent_physical_cashout_status_rewarded"))}</th>
            <th class="text-right">${escapeHtml(t("total_revenue"))} (kr)</th>
            <th>${escapeHtml(t("action"))}</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;

    tableHost.querySelectorAll<HTMLButtonElement>('[data-action="view-game"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const gameId = btn.getAttribute("data-game-id");
        const name = btn.getAttribute("data-game-name");
        if (!gameId) return;
        state.selectedGameId = gameId;
        state.selectedGameName = name;
        void loadSubGameDetail();
      });
    });
  }

  // ── View 2: Sub Game Detail ───────────────────────────────────────────────

  async function loadSubGameDetail(): Promise<void> {
    if (!state.selectedGameId) return;
    state.view = "sub-game-detail";
    state.loading = true;
    titleEl.textContent = state.selectedGameName ?? t("agent_physical_cashout_title");
    bannerEl.innerHTML = "";
    bodyEl.innerHTML = `<p>${escapeHtml(t("loading_ellipsis"))}</p>`;
    toolsEl.innerHTML = `
      <button type="button" class="btn btn-default btn-sm" data-action="back-to-list">
        <i class="fa fa-arrow-left" aria-hidden="true"></i> ${escapeHtml(t("back"))}
      </button>`;
    toolsEl.querySelector<HTMLButtonElement>('[data-action="back-to-list"]')!
      .addEventListener("click", () => {
        state.selectedGameId = null;
        state.selectedGameName = null;
        void loadDailyList();
      });

    try {
      const data: AgentPendingResponse = await agentListPending(state.selectedGameId);
      state.pendingTickets = data.pending;
      state.rewardedTickets = data.rewarded;
      renderSubGameDetail();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      bodyEl.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
    } finally {
      state.loading = false;
    }
  }

  function renderSubGameDetail(): void {
    const allTickets: Array<{ ticket: PhysicalTicket; isRewarded: boolean }> = [
      ...state.pendingTickets.map((tk) => ({ ticket: tk, isRewarded: false })),
      ...state.rewardedTickets.map((tk) => ({ ticket: tk, isRewarded: true })),
    ];

    // Totals
    let totalWinning = 0;
    let totalRewarded = 0;
    let totalPending = 0;
    for (const { ticket, isRewarded } of allTickets) {
      const won = ticket.wonAmountCents ?? 0;
      totalWinning += won;
      if (isRewarded) {
        totalRewarded += won;
      } else {
        totalPending += won;
      }
    }

    const sameDayBanner = state.isCurrentDay
      ? ""
      : `<div class="alert alert-warning" style="margin-bottom:10px;">
           <i class="fa fa-lock" aria-hidden="true"></i>
           ${escapeHtml(t("agent_physical_cashout_same_day_locked"))}
         </div>`;

    const rewardAllBtn = state.isCurrentDay && state.pendingTickets.length > 0
      ? `<button type="button" class="btn btn-warning" data-action="reward-all">
           <i class="fa fa-trophy" aria-hidden="true"></i>
           ${escapeHtml(t("agent_physical_cashout_reward_all"))} (${state.pendingTickets.length})
         </button>`
      : "";

    if (allTickets.length === 0) {
      bodyEl.innerHTML = `
        ${sameDayBanner}
        <h4>${escapeHtml(state.selectedGameName ?? "")}</h4>
        <div class="callout callout-info">
          ${escapeHtml(t("agent_physical_cashout_subgame_empty"))}
        </div>`;
      return;
    }

    const rowsHtml = allTickets.map(({ ticket, isRewarded }) => {
      const ticketType = describeTicketType(ticket);
      const price = formatNOK(ticket.priceCents);
      const won = ticket.wonAmountCents ?? 0;
      const rewardedAmount = isRewarded ? won : 0;
      const pendingAmount = isRewarded ? 0 : won;
      const statusBadge = isRewarded
        ? `<span class="label label-success">${escapeHtml(t("agent_physical_cashout_status_rewarded"))}</span>`
        : `<span class="label label-warning">${escapeHtml(t("agent_physical_cashout_status_pending"))}</span>`;
      const actionBtn = state.isCurrentDay && !isRewarded
        ? `<button type="button" class="btn btn-success btn-xs" data-action="reward-ticket"
             data-unique-id="${escapeHtml(ticket.uniqueId)}"
             data-default-cents="${ticket.wonAmountCents ?? ""}">
             <i class="fa fa-money" aria-hidden="true"></i> ${escapeHtml(t("agent_physical_cashout_reward"))}
           </button>`
        : "";
      const viewBtn = `<button type="button" class="btn btn-info btn-xs" data-action="view-pattern"
        data-unique-id="${escapeHtml(ticket.uniqueId)}" title="${escapeHtml(t("agent_physical_cashout_view_pattern"))}">
        <i class="fa fa-eye" aria-hidden="true"></i>
      </button>`;
      return `<tr>
        <td><code>${escapeHtml(ticket.uniqueId)}</code></td>
        <td>${escapeHtml(ticketType)}</td>
        <td class="text-right">${price}</td>
        <td>${escapeHtml(patternLabel(ticket.patternWon))} ${statusBadge}</td>
        <td class="text-right">${formatNOK(won)}</td>
        <td class="text-right">${formatNOK(rewardedAmount)}</td>
        <td class="text-right">${formatNOK(pendingAmount)}</td>
        <td class="text-center">${viewBtn} ${actionBtn}</td>
      </tr>`;
    }).join("");

    bodyEl.innerHTML = `
      ${sameDayBanner}
      <div style="margin-bottom:10px;">
        ${rewardAllBtn}
      </div>
      <table class="table table-bordered table-condensed" style="margin-bottom:8px;">
        <thead>
          <tr>
            <th>${escapeHtml(t("ticket_id"))}</th>
            <th>${escapeHtml(t("ticket_type"))}</th>
            <th class="text-right">${escapeHtml(t("ticket_price"))} (kr)</th>
            <th>${escapeHtml(t("winning_pattern"))}</th>
            <th class="text-right">${escapeHtml(t("total_winning"))} (kr)</th>
            <th class="text-right">${escapeHtml(t("rewarded_amount"))} (kr)</th>
            <th class="text-right">${escapeHtml(t("pending_amount"))} (kr)</th>
            <th class="text-center">${escapeHtml(t("action"))}</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
          <tr class="info">
            <th colspan="4" class="text-right">${escapeHtml(t("totals"))}</th>
            <th class="text-right">${formatNOK(totalWinning)} kr</th>
            <th class="text-right">${formatNOK(totalRewarded)} kr</th>
            <th class="text-right">${formatNOK(totalPending)} kr</th>
            <th></th>
          </tr>
        </tfoot>
      </table>`;

    const rewardAllButton = bodyEl.querySelector<HTMLButtonElement>('[data-action="reward-all"]');
    if (rewardAllButton) {
      rewardAllButton.addEventListener("click", () => {
        void onRewardAll();
      });
    }
    bodyEl.querySelectorAll<HTMLButtonElement>('[data-action="reward-ticket"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const uniqueId = btn.getAttribute("data-unique-id");
        const amountCentsAttr = btn.getAttribute("data-default-cents");
        const defaultCents = amountCentsAttr ? Number(amountCentsAttr) : null;
        if (!uniqueId) return;
        void onRewardTicket(uniqueId, defaultCents);
      });
    });
    bodyEl.querySelectorAll<HTMLButtonElement>('[data-action="view-pattern"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const uniqueId = btn.getAttribute("data-unique-id");
        if (!uniqueId) return;
        const ticket = allTickets.find((x) => x.ticket.uniqueId === uniqueId);
        if (!ticket) return;
        openPatternPopup(ticket.ticket, ticket.isRewarded);
      });
    });
  }

  /**
   * Beskriver ticket-type som best mulig fra tilgjengelige felter. Per dato
   * har `PhysicalTicket` ikke et eksplisitt `ticketColor`-felt — det ligger
   * på batch-nivå. Vi bruker priceCents + batchId for å gi operatøren noe
   * konkret. Når batch-info utvides kan denne refaktoreres til å vise
   * faktisk farge.
   */
  function describeTicketType(ticket: PhysicalTicket): string {
    const price = ticket.priceCents !== null ? formatNOK(ticket.priceCents) : "?";
    const batchSuffix = ticket.batchId ? ticket.batchId.slice(0, 8) : "—";
    return `${price} kr · ${batchSuffix}`;
  }

  // ── View 3: Per-Ticket Pattern Popup ──────────────────────────────────────

  function openPatternPopup(ticket: PhysicalTicket, isRewarded: boolean): void {
    const numbers = Array.isArray(ticket.numbersJson) ? ticket.numbersJson : [];
    // 5×5 grid: numbersJson har 25 tall, men frittsentre-celle (index 12) kan
    // være 0/null. Vi rendrer alltid 25 celler.
    const cells: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      const v = numbers[i];
      cells.push(typeof v === "number" ? v : 0);
    }

    // Vi har ikke matched-cells fra agentListPending — winning_pattern er
    // det som er stemplet. Vi viser pattern-cellene (basert på pattern_won)
    // som highlight, og lar all kjente tall stå med bakgrunn. For en
    // mer presis match kan UI senere kalle /api/agent/bingo/check med
    // dragene-tall fra spillet.
    const patternCells = patternToCellIndices(ticket.patternWon);

    const gridHtml = cells.map((n, idx) => {
      const isCenter = idx === 12;
      const isPatternCell = patternCells.has(idx);
      const cellClasses = ["cashout-cell"];
      if (isPatternCell) cellClasses.push("cashout-cell-pattern");
      if (isCenter) cellClasses.push("cashout-cell-center");
      const display = isCenter ? "★" : (n > 0 ? String(n) : "—");
      return `<div class="${cellClasses.join(" ")}">${display}</div>`;
    }).join("");

    const wonCents = ticket.wonAmountCents ?? 0;
    const statusLabel = isRewarded
      ? `<span class="label label-success">${escapeHtml(t("agent_physical_cashout_status_rewarded"))}</span>`
      : `<span class="label label-warning">${escapeHtml(t("agent_physical_cashout_status_cashout"))}</span>`;

    const evaluatedAt = ticket.evaluatedAt
      ? `<div><strong>${escapeHtml(t("agent_physical_cashout_evaluated_at"))}:</strong>
          ${escapeHtml(new Date(ticket.evaluatedAt).toLocaleString("nb-NO"))}</div>`
      : "";

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <style>
        .cashout-grid {
          display: grid;
          grid-template-columns: repeat(5, 56px);
          gap: 4px;
          justify-content: center;
          margin: 12px 0;
        }
        .cashout-cell {
          background: #f5f5f5;
          border: 2px solid #ddd;
          border-radius: 4px;
          height: 56px;
          width: 56px;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          font-weight: 600;
          color: #333;
        }
        .cashout-cell-pattern {
          background: #5cb85c;
          border-color: #449d44;
          color: #fff;
        }
        .cashout-cell-center {
          background: #f0ad4e;
          border-color: #eea236;
          color: #fff;
        }
        .cashout-pattern-list {
          margin-top: 8px;
        }
        .cashout-pattern-list .label {
          margin-right: 6px;
          font-size: 12px;
        }
      </style>
      <p>
        <strong>${escapeHtml(t("ticket_id"))}:</strong> <code>${escapeHtml(ticket.uniqueId)}</code><br>
        <strong>${escapeHtml(t("winning_pattern"))}:</strong>
        ${escapeHtml(patternLabel(ticket.patternWon))} ${statusLabel}<br>
        <strong>${escapeHtml(t("total_winning"))}:</strong> ${formatNOK(wonCents)} kr
        ${evaluatedAt}
      </p>
      <div class="cashout-grid">${gridHtml}</div>
      <div class="cashout-pattern-list">
        <strong>${escapeHtml(t("agent_physical_cashout_pattern_status_header"))}:</strong>
        ${renderPatternStatuses(ticket, isRewarded)}
      </div>`;

    Modal.open({
      title: t("agent_physical_cashout_pattern_modal_title"),
      content: wrap,
      size: "lg",
      buttons: [
        { label: t("close"), variant: "default", action: "close" },
      ],
    });
  }

  /**
   * Renderer en liste over alle 5 mønstre med Cashout/Rewarded-status.
   * Ticket har et enkelt `patternWon`-felt som er det høyeste mønsteret det
   * dekker. Vi viser den som rewarded eller pending; resten markeres som
   * "ikke vinner" på denne billetten.
   */
  function renderPatternStatuses(ticket: PhysicalTicket, isRewarded: boolean): string {
    const allPatterns: PhysicalTicketPattern[] = ["row_1", "row_2", "row_3", "row_4", "full_house"];
    return allPatterns.map((p) => {
      if (ticket.patternWon === p) {
        const wonCents = ticket.wonAmountCents ?? 0;
        const status = isRewarded ? t("agent_physical_cashout_status_rewarded") : t("agent_physical_cashout_status_cashout");
        const labelClass = isRewarded ? "label-success" : "label-warning";
        return `<div>${escapeHtml(patternLabel(p))}: <strong>${formatNOK(wonCents)} kr</strong>
          <span class="label ${labelClass}">${escapeHtml(status)}</span></div>`;
      }
      return `<div class="text-muted" style="opacity:0.6">${escapeHtml(patternLabel(p))}: —</div>`;
    }).join("");
  }

  /**
   * Returnerer cell-indices (0..24) for et 5×5 grid som tilsvarer en
   * winning pattern. Brukes til å highlight celler i pattern-popup.
   */
  function patternToCellIndices(p: PhysicalTicketPattern | null): Set<number> {
    const s = new Set<number>();
    if (!p) return s;
    if (p === "row_1") {
      for (let i = 0; i < 5; i += 1) s.add(i);
    } else if (p === "row_2") {
      for (let i = 5; i < 10; i += 1) s.add(i);
    } else if (p === "row_3") {
      for (let i = 10; i < 15; i += 1) s.add(i);
    } else if (p === "row_4") {
      for (let i = 15; i < 20; i += 1) s.add(i);
    } else if (p === "full_house") {
      for (let i = 0; i < 25; i += 1) s.add(i);
    }
    return s;
  }

  // ── Reward All / Per-Ticket Reward (delt mellom views) ────────────────────

  async function onRewardAll(): Promise<void> {
    if (!state.selectedGameId) return;
    const pending = state.pendingTickets;
    if (pending.length === 0) {
      Toast.info(t("no_pending_winners"));
      return;
    }
    const wrap = document.createElement("div");
    const rowsHtml = pending.map((tk, i) => `
      <tr>
        <td><code>${escapeHtml(tk.uniqueId)}</code></td>
        <td>${escapeHtml(patternLabel(tk.patternWon))}</td>
        <td>
          <input type="number" class="form-control input-sm" data-row="${i}"
            name="amt-${escapeHtml(tk.uniqueId)}" min="0.01" step="0.01"
            value="${tk.wonAmountCents !== null && tk.wonAmountCents > 0 ? (tk.wonAmountCents / 100).toFixed(2) : ""}"
            required>
        </td>
      </tr>`).join("");
    wrap.innerHTML = `
      <p>${escapeHtml(t("reward_all_intro"))}</p>
      <table class="table table-condensed">
        <thead><tr>
          <th>${escapeHtml(t("unique_id"))}</th>
          <th>${escapeHtml(t("pattern_won"))}</th>
          <th>${escapeHtml(t("payout_amount"))} (kr)</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
    Modal.open({
      title: t("agent_physical_cashout_reward_all"),
      content: wrap,
      size: "lg",
      buttons: [
        { label: t("cancel_button"), variant: "default", action: "cancel" },
        {
          label: t("confirm_reward_all"),
          variant: "success",
          action: "confirm",
          onClick: async (instance) => {
            const inputs = wrap.querySelectorAll<HTMLInputElement>("input[data-row]");
            const rewards: Array<{ uniqueId: string; amountCents: number }> = [];
            let valid = true;
            inputs.forEach((inp, i) => {
              const val = Number(inp.value);
              if (!Number.isFinite(val) || val <= 0) {
                valid = false;
                inp.classList.add("has-error");
              }
              const ticket = pending[i];
              if (ticket) {
                rewards.push({
                  uniqueId: ticket.uniqueId,
                  amountCents: Math.round(val * 100),
                });
              }
            });
            if (!valid) {
              Toast.error(t("payout_amount_must_be_positive"));
              return;
            }
            try {
              const res = await agentRewardAll({ gameId: state.selectedGameId!, rewards });
              Toast.success(
                `${t("reward_all_complete")}: ${res.rewardedCount}/${rewards.length} (${(res.totalPayoutCents / 100).toFixed(2)} kr)`,
              );
              instance.close("programmatic");
              await loadSubGameDetail();
            } catch (err) {
              const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
              Toast.error(msg);
            }
          },
        },
      ],
    });
  }

  async function onRewardTicket(uniqueId: string, defaultCents: number | null): Promise<void> {
    if (!state.selectedGameId) return;
    const defaultVal = defaultCents !== null && defaultCents > 0
      ? (defaultCents / 100).toFixed(2)
      : "";
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <p>${escapeHtml(t("agent_physical_cashout_reward_ticket_body"))}: <code>${escapeHtml(uniqueId)}</code></p>
      <div class="form-group">
        <label for="rt-amount">${escapeHtml(t("payout_amount"))} (kr)</label>
        <input type="number" class="form-control" id="rt-amount"
          min="0.01" step="0.01" value="${escapeHtml(defaultVal)}" required autofocus>
      </div>`;
    Modal.open({
      title: t("agent_physical_cashout_reward_ticket_title"),
      content: wrap,
      buttons: [
        { label: t("cancel_button"), variant: "default", action: "cancel" },
        {
          label: t("confirm"),
          variant: "success",
          action: "confirm",
          onClick: async (instance) => {
            const input = wrap.querySelector<HTMLInputElement>("#rt-amount");
            const val = input ? Number(input.value) : NaN;
            if (!Number.isFinite(val) || val <= 0) {
              Toast.error(t("payout_amount_must_be_positive"));
              return;
            }
            try {
              const res = await agentRewardTicket(uniqueId, {
                gameId: state.selectedGameId!,
                amountCents: Math.round(val * 100),
              });
              if (res.status === "rewarded") {
                Toast.success(t("agent_physical_cashout_reward_success"));
              } else {
                const key = `reward_status_${res.status}`;
                Toast.warning(t(key));
              }
              instance.close("programmatic");
              await loadSubGameDetail();
            } catch (err) {
              const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
              Toast.error(msg);
            }
          },
        },
      ],
    });
  }
}
