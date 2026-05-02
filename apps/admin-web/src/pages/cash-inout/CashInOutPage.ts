// Main cash-in/out page — 1:1 port of the legacy "Kontantinn-/uttaksstyring"
// (Cash In/Out Management) screen used by Norwegian bingo halls.
//
// Legacy layout reference (screenshot 2026-04-27 — Oslo bingo / Michael):
//   - Page-title øverst-venstre, "Tilbake" + "Logg ut skift"-knapper
//     øverst-høyre.
//   - 3 sentrerte tabs under tittelen:
//       Standard (active) | Agentmodul | Spillmodul
//   - Box 1 — Daglig saldo:
//       Tabell venstre (Agentnavn + 4 rader Total kontantsaldo i hall /
//       Total kontantinnskudd / Total kontantuttak / Daglig saldo).
//       Knappe-rader høyre:
//         Rad 1: Legg til daglig saldo | Oppdater tabell | Dagens salgsrapport (F8)
//         Rad 2: Kontroller daglig saldo | Oppgjør
//   - Box 2 — Kontant inn/ut: 7-knapps grid (4 grønne + 3 røde + 1 grønn):
//       Rad 1 (4): Spillemaskiner | Legg til penger Unik ID |
//                  Legg til penger Registrert bruker (F5) |
//                  Opprett Ny unik ID
//       Rad 2 (3 + 1): Ta ut Unik ID | Ta ut Registrert bruker (F6) |
//                      Selg Produkter
//   - Box 3: "Ingen kommende spill tilgjengelig…"-placeholder
//   - Box 4: "Ingen pågående spill tilgjengelig…"-placeholder
//
// Header (admin-shell) håndterer "Daglig saldo [0.00]" + "Kontant inn/ut"-
// knappen + bell + bruker-dropdown — det er ikke duplisert her. Se
// src/shell/Header.ts for den koden.

import { t } from "../../i18n/I18n.js";
import { getSession } from "../../auth/Session.js";
import { Toast } from "../../components/Toast.js";
import { getCurrentShift, getDailyBalance, type DailyBalance } from "../../api/agent-shift.js";
import { ApiError } from "../../api/client.js";
import { requireSlotProvider } from "../../components/SlotProviderSwitch.js";
import { listAgentRooms } from "../../api/agent-next-game.js";
import { listHalls } from "../../api/admin-halls.js";
import { openSlotMachineModal } from "./modals/SlotMachineModal.js";
import { openSettlementBreakdownModal } from "./modals/SettlementBreakdownModal.js";
import { openControlDailyBalanceModal } from "./modals/ControlDailyBalanceModal.js";
import { openAddDailyBalanceModal } from "./modals/AddDailyBalanceModal.js";
import { openAddMoneyRegisteredUserModal } from "./modals/AddMoneyRegisteredUserModal.js";
import { openWithdrawRegisteredUserModal } from "./modals/WithdrawRegisteredUserModal.js";
import { openCheckForBingoModal } from "./modals/CheckForBingoModal.js";
import { openAddMoneyUniqueIdModal } from "../agent-portal/unique-id/AddMoneyUniqueIdModal.js";
import { openWithdrawUniqueIdModal } from "../agent-portal/unique-id/WithdrawUniqueIdModal.js";
import { contentHeader, escapeHtml, formatNOK } from "./shared.js";
import { mountSpill1HallStatusBox } from "./Spill1HallStatusBox.js";

const F5_F6_F8 = new Set(["F5", "F6", "F8"]);

// FE-P0-003 (Bølge 2B pilot-blocker): module-level AbortController owned by
// the most-recently-mounted CashInOutPage. Re-rendered or unmounted? We
// abort the prior controller — any in-flight `refreshBalance()` /
// `getCurrentShift()` fetch resolves into a no-op instead of overwriting
// the new page's DOM with stale numbers (= money-data UI race).
//
// Critical because `refreshBalance()` mutates the visible kontant-balance
// display directly via container.querySelector — and a slow stale fetch
// landing 6 s after a successful settlement-submit was the exact race the
// audit flagged on flaky hall-WiFi.
let activePageAbort: AbortController | null = null;

export function renderCashInOutPage(container: HTMLElement): void {
  const session = getSession();
  // `Agentnavn` skal vise innloggets navn — fall tilbake til hallnavn for
  // legacy-paritet hvis det ikke er noen visningsnavn (eks. ved super-admin).
  const agentName = session?.name ?? session?.hall?.[0]?.name ?? "—";

  container.innerHTML = `
    ${contentHeader("cash_in_out_management")}
    <section class="content cashinout-1to1">
      <div class="cashinout-page-actions clearfix" data-marker="cashinout-page-actions">
        <a class="btn btn-primary" href="javascript:history.back()" data-action="back">
          <i class="fa fa-arrow-left" aria-hidden="true"></i> ${escapeHtml(t("back"))}
        </a>
        <button type="button" class="btn btn-info" data-action="open-tv-screen"
                title="${escapeHtml(t("open_tv_screen_hint") || "Åpner TV-skjermen i nytt vindu — drag til hall-storskjerm")}">
          <i class="fa fa-tv" aria-hidden="true"></i> ${escapeHtml(t("open_tv_screen") || "Åpne TV-skjerm")}
        </button>
        <button type="button" class="btn btn-danger" data-action="shift-log-out">
          <i class="fa fa-sign-out" aria-hidden="true"></i> ${escapeHtml(t("agent_cash_in_out_shift_log_out"))}
        </button>
      </div>

      <ul class="nav nav-tabs nav-justified cashinout-tabs" id="cashinout-tabs"
          data-marker="cashinout-tabs" role="tablist">
        <li class="active" role="presentation">
          <a href="javascript:void(0)" data-tab="standard" role="tab">${escapeHtml(t("cash_inout_standard_tab"))}</a>
        </li>
        <li role="presentation">
          <a href="javascript:void(0)" data-tab="agent" role="tab">${escapeHtml(t("cash_inout_agent_tab"))}</a>
        </li>
        <li role="presentation">
          <a href="javascript:void(0)" data-tab="game" role="tab">${escapeHtml(t("cash_inout_game_tab"))}</a>
        </li>
      </ul>

      <div class="tab-content cashinout-tab-content">
        <!-- Tab 1: Standard — viser legacy hovedlayouten (Box 1-4) -->
        <div class="tab-pane active" id="tab-standard" role="tabpanel">
          <!-- Box 1: Daglig saldo -->
          <div class="box box-default cashinout-box-daily-balance"
               data-marker="box-daily-balance">
            <div class="box-header with-border">
              <h3 class="box-title">${escapeHtml(t("daily_balance"))}</h3>
            </div>
            <div class="box-body">
              <div class="row cashinout-daily-row">
                <div class="col-md-6">
                  <p class="cashinout-agent-name">
                    <strong>${escapeHtml(t("agent_name"))}:</strong>
                    <span data-marker="agent-name-value">${escapeHtml(agentName)}</span>
                  </p>
                  <table class="table table-bordered table-striped" id="daily-balance-table">
                    <thead>
                      <tr>
                        <th>${escapeHtml(t("title_cashin"))}</th>
                        <th style="text-align:right;">${escapeHtml(t("amount"))}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>${escapeHtml(t("total_hall_cash_balance"))}</td>
                        <td style="text-align:right;" id="v-totalHallCashBalance">—</td>
                      </tr>
                      <tr>
                        <td>${escapeHtml(t("total_cash_in"))}</td>
                        <td style="text-align:right;" id="v-totalCashIn">—</td>
                      </tr>
                      <tr>
                        <td>${escapeHtml(t("total_cash_out"))}</td>
                        <td style="text-align:right;" id="v-totalCashOut">—</td>
                      </tr>
                      <tr>
                        <td><strong>${escapeHtml(t("daily_balance"))}</strong></td>
                        <td style="text-align:right;" id="v-dailyBalance"><strong>—</strong></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div class="col-md-6 cashinout-daily-actions" data-marker="daily-actions">
                  <div class="cashinout-action-row" data-marker="daily-actions-row-1">
                    <button class="btn btn-success" data-action="add-daily-balance">
                      <i class="fa fa-plus" aria-hidden="true"></i>
                      ${escapeHtml(t("add_daily_balance"))}
                    </button>
                    <button class="btn btn-primary" data-action="refresh-balance">
                      <i class="fa fa-refresh" aria-hidden="true"></i>
                      ${escapeHtml(t("refresh_table"))}
                    </button>
                    <a class="btn btn-primary" href="#/hallSpecificReport" data-action="todays-sales-report">
                      ${escapeHtml(t("todays_sales_report"))} (F8)
                    </a>
                  </div>
                  <div class="cashinout-action-row" data-marker="daily-actions-row-2">
                    <button class="btn btn-success" data-action="control-daily-balance">
                      ${escapeHtml(t("control_daily_balance"))}
                    </button>
                    <button class="btn btn-primary" data-action="settlement">
                      <i class="fa fa-lock" aria-hidden="true"></i>
                      ${escapeHtml(t("settlement"))}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Box 2: Kontant inn/ut — 7-knapps grid -->
          <div class="box box-primary cashinout-box-cashinout"
               data-marker="box-cashinout">
            <div class="box-header with-border">
              <h3 class="box-title">${escapeHtml(t("cash_in_out"))}</h3>
            </div>
            <div class="box-body">
              <div class="cashinout-grid" data-marker="cashinout-grid">
                <button type="button" class="btn btn-success cashinout-grid-btn"
                        data-action="slot-machine">
                  ${escapeHtml(t("slot_machine"))}
                </button>
                <button type="button" class="btn btn-success cashinout-grid-btn"
                        data-action="add-money-unique-id">
                  ${escapeHtml(t("add_money"))} ${escapeHtml(t("unique_id"))}
                </button>
                <button type="button" class="btn btn-success cashinout-grid-btn"
                        data-action="add-money-registered-user">
                  ${escapeHtml(t("add_money_registered_user"))} (F5)
                </button>
                <a class="btn btn-success cashinout-grid-btn"
                   href="#/uniqueId" data-action="create-new-unique-id">
                  ${escapeHtml(t("create_new_unique_id"))}
                </a>
                <button type="button" class="btn btn-danger cashinout-grid-btn"
                        data-action="withdraw-unique-id">
                  ${escapeHtml(t("withdraw_unique_id"))}
                </button>
                <button type="button" class="btn btn-danger cashinout-grid-btn"
                        data-action="withdraw-registered-user">
                  ${escapeHtml(t("withdraw_registered_user"))} (F6)
                </button>
                <a class="btn btn-success cashinout-grid-btn"
                   href="#/agent/sellProduct" data-action="sell-products">
                  ${escapeHtml(t("sell_products"))}
                </a>
              </div>
            </div>
          </div>

          <!-- Box 3: Spill 1 hall-status + handlinger (Tobias UX 2026-05-02).
               Mountet inn av mountSpill1HallStatusBox() — viser status-pillen
               for alle haller i runden, Klar/Ingen kunder-knapper for egen
               hall, og Start/Stop-knapper for master. Fall-back til legacy
               "Ingen kommende spill"-tekst når ingen runde er aktiv. -->
          <div class="box box-default cashinout-box-upcoming"
               data-marker="box-upcoming-games"
               id="spill1-hall-status-box">
            <div class="box-body cashinout-empty-placeholder">
              <p class="text-muted text-center">
                ${escapeHtml(t("no_upcoming_games_available"))}
              </p>
            </div>
          </div>

          <!-- Box 4: Pågående spill (med "Sjekk for Bingo"-knapp per
               wireframe §17.16). Knappen kjører listAgentRooms() ved klikk
               for å finne agentens RUNNING/PAUSED rom og åpner deretter
               CheckForBingoModal med riktig roomCode. PAUSE-engine-flyten
               (auto-pause før modal) kommer i en oppfølgings-PR — den
               minimale modalen henter cached evaluering uten å fryse
               trekkingen. -->
          <div class="box box-default cashinout-box-ongoing"
               data-marker="box-ongoing-games">
            <div class="box-body cashinout-empty-placeholder">
              <p class="text-muted text-center">
                ${escapeHtml(t("no_ongoing_games_available"))}
              </p>
              <div class="text-center" style="margin-top:12px;">
                <button type="button" class="btn btn-primary"
                        data-action="check-for-bingo"
                        data-marker="check-for-bingo-btn">
                  <i class="fa fa-search" aria-hidden="true"></i>
                  ${escapeHtml(t("check_for_bingo"))}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Tab 2: Agentmodul (placeholder for fremtidig agent-spesifikk UI) -->
        <div class="tab-pane" id="tab-agent" role="tabpanel" style="display:none;">
          <div class="box box-default">
            <div class="box-body cashinout-empty-placeholder">
              <p class="text-muted text-center">
                ${escapeHtml(t("agent_module"))}
              </p>
            </div>
          </div>
        </div>

        <!-- Tab 3: Spillmodul (placeholder for fremtidig spillmodul-UI) -->
        <div class="tab-pane" id="tab-game" role="tabpanel" style="display:none;">
          <div class="box box-default">
            <div class="box-body cashinout-empty-placeholder">
              <p class="text-muted text-center">
                ${escapeHtml(t("game_module"))}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>`;

  ensureLegacyStyles();
  // FE-P0-003: abort any prior page's in-flight requests, then start a
  // fresh controller for this mount. The wireFunctionKeys observer also
  // aborts on container-detach (see wireFunctionKeys below).
  //
  // 2026-05-01 (Tobias): event-listener-leak-fix. Router gjenbruker samme
  // `container` på tvers av navigasjoner (apps/admin-web/src/router/Router.ts:49
  // — `renderer(container, route)`). Tidligere la `wireActions` og
  // `wireTabs` til en ny event-listener på containeren ved hver
  // mount-syklus uten cleanup, så listeners stables opp. Etter 3
  // navigasjoner til /agent/cashinout og tilbake måtte agenten klikke
  // "Avbryt" 3 ganger på Kontroller-daglig-saldo-modalen fordi 3 listeners
  // reagerte på samme klikk → 3 modaler stablet seg.
  // Fix: sender `signal: activePageAbort.signal` med alle addEventListener-
  // kall så de auto-fjernes når neste mount aborter signalet.
  if (activePageAbort) activePageAbort.abort();
  activePageAbort = new AbortController();
  const signal = activePageAbort.signal;
  wireTabs(container, signal);
  wireActions(container, signal);
  wireFunctionKeys(container);
  void refreshBalance(container);

  // Spill 1 hall-status-box (Tobias UX 2026-05-02). Polling stoppes ved
  // signal.abort() — samme livstid som resten av siden.
  const hallStatusBox = container.querySelector<HTMLElement>(
    "#spill1-hall-status-box"
  );
  if (hallStatusBox) {
    mountSpill1HallStatusBox(hallStatusBox, signal);
  }
}

function wireTabs(container: HTMLElement, signal: AbortSignal): void {
  container.querySelectorAll<HTMLAnchorElement>("#cashinout-tabs [data-tab]").forEach((a) => {
    a.addEventListener("click", () => {
      const target = a.dataset.tab!;
      container.querySelectorAll("#cashinout-tabs li").forEach((li) => li.classList.remove("active"));
      a.closest("li")?.classList.add("active");
      container.querySelectorAll<HTMLElement>(".tab-pane").forEach((p) => {
        p.style.display = "none";
        p.classList.remove("active");
      });
      const pane = container.querySelector<HTMLElement>(`#tab-${target}`);
      if (pane) {
        pane.style.display = "";
        pane.classList.add("active");
      }
    }, { signal });
  });
}

function wireActions(container: HTMLElement, signal: AbortSignal): void {
  container.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const button = target.closest<HTMLElement>("[data-action]");
    if (!button) return;
    // Guard: ignorer events fra utenfor denne containeren — defensive mot
    // event-bubbling fra modaler eller portal-rendered popovers.
    if (!container.contains(button)) return;
    const action = button.dataset.action;
    switch (action) {
      case "back":
        // `href="javascript:history.back()"` håndterer det — ingen JS-trigger.
        break;
      case "add-daily-balance":
        openAddDailyBalanceModal({ onSuccess: () => void refreshBalance(container) });
        break;
      case "refresh-balance":
        void refreshBalance(container);
        break;
      case "control-daily-balance":
        openControlDailyBalanceModal();
        break;
      case "settlement":
        openSettlementFromCashInOut(container);
        break;
      case "slot-machine": {
        const session = getSession();
        const hall = session?.hall?.[0];
        const provider = requireSlotProvider(hall ?? null);
        if (provider) openSlotMachineModal(provider);
        break;
      }
      case "add-money-registered-user":
        openAddMoneyRegisteredUserModal({ onSuccess: () => void refreshBalance(container) });
        break;
      case "withdraw-registered-user":
        openWithdrawRegisteredUserModal({ onSuccess: () => void refreshBalance(container) });
        break;
      case "add-money-unique-id":
        // Wireframe §17.10 — popup-modal direkte fra Cash In/Out-dashboardet
        // (ikke en separat side). Yes/No-confirm med akkumulert balance per
        // PM-rule Q4 (170 + 200 = 370). Cash/Card payment-type tillates.
        openAddMoneyUniqueIdModal({ onSuccess: () => void refreshBalance(container) });
        break;
      case "withdraw-unique-id":
        // Wireframe §17.11/17.28 — popup-modal direkte fra Cash In/Out.
        // Cash-only (PM rule). Brukerens Unique ID etterspørres først via
        // prompt — ID-tasking matcher legacy-flow der agenten skanner /
        // skriver inn et eksisterende kort før withdraw-skjemaet vises.
        {
          const id = window.prompt(t("please_enter_unique_id"));
          if (id && id.trim()) {
            openWithdrawUniqueIdModal({
              uniqueId: id.trim(),
              onSuccess: () => void refreshBalance(container),
            });
          }
        }
        break;
      case "check-for-bingo":
        // Wireframe §17.16 — agent klikker "Sjekk for Bingo", systemet
        // finner agentens aktive rom (RUNNING først, PAUSED hvis ingen),
        // og åpner CheckForBingoModal. Hvis ingen aktiv runde finnes
        // åpner vi modalen likevel med roomCode=null — modalen viser da
        // en informativ "ingen aktivt rom"-toast og lukker seg selv.
        void onClickCheckForBingo();
        break;
      case "open-tv-screen":
        // Tobias 2026-04-27: Agent klikker "Åpne TV-skjerm" → popup-vindu
        // åpnes med /admin/#/tv/<hallId>/<tvToken>. Agenten drar vinduet til
        // hall-storskjerm. URL er public (kun tvToken-gated).
        void onClickOpenTvScreen();
        break;
      // shift-log-out, todays-sales-report, create-new-unique-id, sell-products
      // håndteres via href eller av AgentCashInOutPage (Shift Log Out).
    }
  }, { signal });
}

function wireFunctionKeys(container: HTMLElement): void {
  // F5 / F6 / F8 gated on this route only (see PR-B1-PLAN.md §7 Q3).
  const handler = (e: KeyboardEvent): void => {
    if (!F5_F6_F8.has(e.key)) return;
    // Route-gate: only active when cash-inout is mounted
    if (!container.isConnected) return;
    e.preventDefault();
    switch (e.key) {
      case "F5":
        openAddMoneyRegisteredUserModal({ onSuccess: () => void refreshBalance(container) });
        break;
      case "F6":
        openWithdrawRegisteredUserModal({ onSuccess: () => void refreshBalance(container) });
        break;
      case "F8":
        window.location.hash = "#/hallSpecificReport";
        break;
    }
  };
  document.addEventListener("keydown", handler);
  // Cleanup når container fjernes fra DOM. Bruker MutationObserver med en
  // defensive sjekk for at `document` er tilgjengelig — hvis JSDOM-miljøet
  // er revet ned (mellom tester) skal observeren bare disconnecte stille.
  // FE-P0-003: when the container detaches we also abort any in-flight
  // fetch so it can't write into a stale DOM (or stale module-level page
  // state if the user has navigated to a different page).
  const observer = new MutationObserver(() => {
    if (typeof document === "undefined") return;
    if (!container.isConnected) {
      document.removeEventListener("keydown", handler);
      if (activePageAbort) {
        activePageAbort.abort();
        activePageAbort = null;
      }
      observer.disconnect();
    }
  });
  if (typeof document !== "undefined" && document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

/**
 * Åpne full Settlement-modal (1:1 legacy — 14 maskin-rader + 3 sub-seksjoner +
 * bilag-upload + auto-calc) fra Cash In/Out-siden.
 *
 * Henter session-context (agent-navn, hall) + dagens dato + valgfri shift-info,
 * og delegerer til `openSettlementBreakdownModal({ mode: "create", ... })`.
 *
 * Erstatter den enklere `openSettlementModal()` som kun støttet
 * `actualCountedCash` + `note` (fjernet 2026-04-27 for full legacy-paritet).
 *
 * Etter vellykket innsending refresh-er vi daily-balance så agenten ser
 * oppdatert state umiddelbart.
 */
function openSettlementFromCashInOut(container: HTMLElement): void {
  const session = getSession();
  const agentUserId = session?.id ?? "";
  const agentName = session?.name ?? "—";
  const hall = session?.hall?.[0];
  const hallName = hall?.name ?? "—";

  // Default business-date = i dag (YYYY-MM-DD). Modal-en er i view/edit-modus
  // mottar dato fra eksisterende settlement; for create bruker vi dagens dato.
  const today = new Date().toISOString().slice(0, 10);

  // Fire-and-forget: fetch shift for å få korrekt businessDate hvis tilgjengelig.
  // Hvis fetch feiler bruker vi today som fallback (modal-en åpnes uansett).
  void (async () => {
    let businessDate = today;
    try {
      const shift = await getCurrentShift();
      if (shift?.startedAt) {
        businessDate = shift.startedAt.slice(0, 10);
      }
    } catch {
      // Fallback: today. Modal har egen feil-håndtering ved submit.
    }
    openSettlementBreakdownModal({
      mode: "create",
      agentUserId,
      agentName,
      hallName,
      businessDate,
      onSubmitted: () => {
        void refreshBalance(container);
      },
    });
  })();
}

async function refreshBalance(container: HTMLElement): Promise<void> {
  // FE-P0-003: thread the per-mount AbortSignal so a slow GET can't land
  // after the page has been unmounted (or after the user has switched
  // hall via admin super-user mode and the page is being re-rendered
  // with a fresh hall-context).
  const signal = activePageAbort?.signal;
  try {
    const balance = await getDailyBalance(signal ? { signal } : {});
    if (!container.isConnected) return;
    renderBalance(container, balance);
  } catch (err) {
    // Aborts are silent — a fresh render will issue its own fetch.
    if (err instanceof DOMException && err.name === "AbortError") return;
    if (err instanceof Error && err.name === "AbortError") return;
    if (!container.isConnected) return;
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    // Silent on 404 (no open day) — show zeros
    if (err instanceof ApiError && err.status === 404) {
      renderBalance(container, {
        openingBalance: 0,
        totalCashIn: 0,
        totalCashOut: 0,
        dailyBalance: 0,
        totalHallCashBalance: 0,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    Toast.error(msg);
  }
}

function renderBalance(container: HTMLElement, b: DailyBalance): void {
  const set = (id: string, v: string): void => {
    const el = container.querySelector<HTMLElement>(`#${id}`);
    if (el) el.textContent = v;
  };
  set("v-totalHallCashBalance", formatNOK(b.totalHallCashBalance));
  set("v-totalCashIn", formatNOK(b.totalCashIn));
  set("v-totalCashOut", formatNOK(b.totalCashOut));
  const dbEl = container.querySelector<HTMLElement>("#v-dailyBalance");
  if (dbEl) dbEl.innerHTML = `<strong>${escapeHtml(formatNOK(b.dailyBalance))}</strong>`;
}

/**
 * "Sjekk for Bingo"-knappens click-handler (FOLLOWUP-13 / wireframe §17.16).
 *
 * Henter agentens aktive rom via /api/admin/rooms (hall-scope håndhevet av
 * backend) og prioriterer RUNNING > PAUSED. Hvis ingen aktiv runde finnes
 * sender vi roomCode=null inn i modalen — den viser da en advarsel-toast
 * og lukker seg selv (modalen håndterer dette internt — se
 * `CheckForBingoModal.ts:88-94`).
 *
 * Fail-soft: nettverksfeil ved listAgentRooms() resulterer i null-roomCode
 * — agenten ser samme advarsel som ved "ingen aktiv runde", istedenfor at
 * Cash In/Out-siden får en feilmelding-popup midt i hovedflyten.
 */
async function onClickCheckForBingo(): Promise<void> {
  let roomCode: string | null = null;
  try {
    const rooms = await listAgentRooms();
    // Prioriter RUNNING (live trekking) over PAUSED (operatør har allerede
    // pauset av andre grunner). Wireframe-flyten har én aktiv runde per hall.
    const running = rooms.find((r) => r.currentGame?.status === "RUNNING");
    const paused = rooms.find((r) => r.currentGame?.status === "PAUSED");
    roomCode = running?.code ?? paused?.code ?? null;
  } catch {
    // Behold roomCode=null og la modalen vise advarsel — bedre UX enn
    // generisk "Noe gikk galt"-toast som krever manuell retry.
  }
  openCheckForBingoModal({ roomCode });
}

/**
 * "Åpne TV-skjerm"-knapp — wireframe §16.5 + Tobias 2026-04-27.
 *
 * Bingoverten klikker for å åpne hall-TV-skjermen i nytt vindu (popup).
 * Vinduet kan dras over til hall-storskjerm og viser live trekninger,
 * pattern-status og vinnere mellom spill.
 *
 * Flyt:
 *   1. Hent agentens hallId fra session.
 *   2. Hent tvToken for denne hallen (listHalls + filter).
 *   3. window.open med URL `/admin/#/tv/<hallId>/<tvToken>`.
 *   4. Hvis hall mangler tvToken (ikke konfigurert): toast med admin-oppfordring.
 *   5. Hvis popup blokkert av browser: toast med URL så bingoverten kan kopiere.
 *
 * URL-en er public (kun tvToken-gated) — TV-side trenger ikke admin-login,
 * så popup-en kan dras til hall-PC uten å logge inn på admin der.
 */
async function onClickOpenTvScreen(): Promise<void> {
  const session = getSession();
  const hallId = session?.hall?.[0]?.id;
  if (!hallId) {
    Toast.error(
      t("open_tv_screen_no_hall") || "Ingen hall valgt — sjekk skift-status",
    );
    return;
  }
  let tvToken: string | undefined;
  try {
    const halls = await listHalls();
    const hall = halls.find((h) => h.id === hallId);
    tvToken = hall?.tvToken;
  } catch (err) {
    Toast.error(
      err instanceof ApiError
        ? err.message
        : t("open_tv_screen_load_error") || "Kunne ikke hente hall-data",
    );
    return;
  }
  if (!tvToken) {
    Toast.error(
      t("open_tv_screen_no_token") ||
        "Hallen mangler TV-token. Be admin generere én på Hall-management.",
    );
    return;
  }
  // Bygg URL og åpne popup. window.open returnerer null hvis blokkert.
  const tvUrl = `/admin/#/tv/${encodeURIComponent(hallId)}/${encodeURIComponent(tvToken)}`;
  const features = "popup=yes,width=1920,height=1080,resizable=yes,scrollbars=no,status=no,location=no,toolbar=no,menubar=no";
  const popup = window.open(tvUrl, "spillorama-tv-screen", features);
  if (!popup) {
    Toast.warning(
      `${t("open_tv_screen_popup_blocked") || "Popup blokkert. Åpne manuelt:"} ${window.location.origin}${tvUrl}`,
    );
  }
}

/**
 * Injiserer 1:1-legacy-styling for Cash In/Out-siden (action-bar, tabs,
 * 7-button-grid, knappe-rader, empty-placeholders). Idempotent — klikker
 * <style>-blokken kun én gang per dokument.
 */
function ensureLegacyStyles(): void {
  if (typeof document === "undefined") return;
  const ID = "cashinout-1to1-style";
  if (document.getElementById(ID)) return;
  const style = document.createElement("style");
  style.id = ID;
  style.textContent = `
    .cashinout-1to1 .cashinout-page-actions {
      margin-bottom: 12px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }
    .cashinout-1to1 .cashinout-tabs {
      margin-bottom: 16px;
    }
    .cashinout-1to1 .cashinout-tab-content > .tab-pane {
      padding-top: 8px;
    }
    .cashinout-1to1 .cashinout-daily-row {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
    }
    .cashinout-1to1 .cashinout-agent-name {
      margin-bottom: 8px;
    }
    .cashinout-1to1 .cashinout-daily-actions {
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: flex-end;
    }
    .cashinout-1to1 .cashinout-action-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .cashinout-1to1 .cashinout-action-row .btn {
      min-width: 200px;
    }
    .cashinout-1to1 .cashinout-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }
    .cashinout-1to1 .cashinout-grid-btn {
      padding: 14px 12px;
      font-weight: 600;
      white-space: normal;
      min-height: 56px;
    }
    .cashinout-1to1 .cashinout-empty-placeholder {
      padding: 32px 16px;
    }
    .cashinout-1to1 .spill1-hall-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 8px;
    }
    .cashinout-1to1 .spill1-hall-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background-color: #f9f9f9;
      border-radius: 4px;
    }
    .cashinout-1to1 .spill1-hall-row-own {
      background-color: #f0f8ff;
      border: 1px solid #c8e0f4;
    }
    .cashinout-1to1 .spill1-hall-name {
      font-weight: 600;
    }
    .cashinout-1to1 .spill1-hall-name small {
      margin-left: 6px;
      font-weight: normal;
    }
    .cashinout-1to1 .spill1-self-actions h4,
    .cashinout-1to1 .spill1-master-actions h4 {
      font-size: 14px;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    @media (max-width: 991px) {
      .cashinout-1to1 .cashinout-daily-actions { align-items: stretch; }
      .cashinout-1to1 .cashinout-action-row { justify-content: stretch; }
      .cashinout-1to1 .cashinout-action-row .btn { flex: 1 1 auto; min-width: 0; }
      .cashinout-1to1 .cashinout-grid { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 575px) {
      .cashinout-1to1 .cashinout-grid { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(style);
}
