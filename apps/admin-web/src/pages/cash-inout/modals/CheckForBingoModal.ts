// Wireframe §17.16 — "Check for Bingo" PAUSE-modal i CashInOutPage.
//
// Pilot-blokker (BIN-FOLLOWUP-12): bingoverten må kunne validere
// papir-bonger ved bingo-rop UTEN å gå via /agent/bingo-check-siden.
// Wireframe-flyt:
//
//   1. Agent klikker "PAUSE Game and check for Bingo" i Cash In/Out Box 4.
//   2. Spillet pauses via POST /api/admin/rooms/:roomCode/game/pause
//      (best-effort — modal åpnes uansett).
//   3. Modal viser ticket-input + GO-knapp.
//   4. Agent skriver/scanner ticket-nummer → GO →
//      POST /api/admin/rooms/:roomCode/check-bingo med `{ ticketId }`.
//   5. Resultatet rendres i modalen:
//        - Billett finnes ikke           → rød alert
//        - Må evalueres med 25-tall-flyt → gul alert med link til full-flyt
//        - Vinner (cached evaluering)    → grønn alert + 5×5 grid med
//          pattern-highlight + Reward-knapp (hvis ikke allerede utbetalt)
//        - Tapte                          → blå alert
//   6. Agent kan sjekke flere billetter — input clearses ved ny GO.
//   7. Modal-close → POST /api/admin/rooms/:roomCode/game/resume
//      (best-effort, fire-and-forget) så trekningen fortsetter.
//
// Reward-knappen kaller POST /api/agent/physical/:uniqueId/reward (samme
// endpoint som AgentPhysicalCashoutPage bruker). Etter vellykket reward
// re-runner vi check-spørringen så agenten ser oppdatert status før hun
// går videre til neste billett.
//
// 5×5-grid-renderingen er én-til-én med AgentPhysicalCashoutPage.openPatternPopup
// (samme cell-styling, samme `patternToCellIndices`-funksjon). Vi bruker
// `numbersJson` fra response (lagt til i FOLLOWUP-12).
//
// Refs:
//   - Backend: apps/backend/src/routes/adminRoomsCheckBingo.ts
//   - Backend pause: POST /api/admin/rooms/:roomCode/game/pause (adminRooms.ts:328)
//   - Backend resume: POST /api/admin/rooms/:roomCode/game/resume (adminRooms.ts:341)
//   - Backend reward: POST /api/agent/physical/:uniqueId/reward (agentBingo.ts:566)
//   - Master-plan §1.5 — pilot-blokker.

import { t } from "../../../i18n/I18n.js";
import { Modal } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError, apiRequest } from "../../../api/client.js";
import { escapeHtml } from "../shared.js";

/** Match server's CheckBingoQuickPattern (`adminRoomsCheckBingo.ts`). */
export type CheckBingoQuickPattern =
  | "row_1"
  | "row_2"
  | "row_3"
  | "row_4"
  | "full_house";

/** Speiler `CheckBingoQuickResponse` på backend. */
export interface CheckBingoQuickResponse {
  found: boolean;
  hallId?: string;
  gameId?: string | null;
  requiresFullCheck?: boolean;
  hasWon?: boolean | null;
  winningPattern?: CheckBingoQuickPattern | null;
  wonAmountCents?: number | null;
  isWinningDistributed?: boolean;
  evaluatedAt?: string | null;
  gameStatus?: string | null;
  /**
   * 25 tall fra papir-bongen. Vi rendrer 5×5-grid med disse når billetten
   * er stemplet. Hvis backend ikke har feltet (eldre versjon) eller billetten
   * ikke er stemplet vises en pattern-only grid (uten faktiske tall).
   */
  numbersJson?: number[] | null;
}

export interface CheckForBingoModalOptions {
  /**
   * Rom-koden som agenten sjekker mot. Når UI-en ennå ikke har et aktivt rom
   * (Box 4 placeholder-state), beholdes den som null — modalen viser da en
   * info-toast og avstår fra å åpne.
   */
  roomCode: string | null;
  /**
   * Test-hook: når denne er satt skipper vi pause/resume-kallene mot backend.
   * Brukes i unit-tests for å unngå fetch-mock-støy uten å påvirke prod-flyten.
   * Default: false (pause + resume kjøres normalt).
   */
  skipPauseResume?: boolean;
}

const PATTERN_LABEL: Record<CheckBingoQuickPattern, string> = {
  row_1: "Rad 1",
  row_2: "Rad 2",
  row_3: "Rad 3",
  row_4: "Rad 4",
  full_house: "Fullt Hus",
};

const ALL_PATTERNS: CheckBingoQuickPattern[] = [
  "row_1",
  "row_2",
  "row_3",
  "row_4",
  "full_house",
];

function patternLabel(p: CheckBingoQuickPattern): string {
  // Try i18n key first, fall back to Norwegian default. Same lookup pattern
  // as AgentCheckForBingoPage.ts.
  const i18nKey = `pattern_label_${p}`;
  const tr = t(i18nKey);
  if (tr && tr !== i18nKey) return tr;
  return PATTERN_LABEL[p];
}

function formatNok(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Returnerer cell-indices (0..24) for et 5×5-grid som tilsvarer en
 * winning pattern. 1:1-port av samme funksjon i
 * `AgentPhysicalCashoutPage.ts:616` for paritet i visualisering.
 */
function patternToCellIndices(p: CheckBingoQuickPattern | null): Set<number> {
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

/**
 * Rendrer 5×5-grid HTML for ticket-cellene. Hvis vi har `numbersJson` fra
 * backend bruker vi de faktiske tallene — ellers fallback til pattern-only
 * grid (cellene viser bare `—` med pattern-highlight).
 *
 * 1:1-port av styling-blokken i `AgentPhysicalCashoutPage.ts:528-568` så
 * at agenten ser samme grid uansett om hun bruker PAUSE-modal eller den
 * dedikerte cashout-siden.
 */
function renderPatternGrid(
  numbersJson: number[] | null | undefined,
  pattern: CheckBingoQuickPattern | null,
): string {
  const numbers = Array.isArray(numbersJson) ? numbersJson : [];
  const cells: number[] = [];
  for (let i = 0; i < 25; i += 1) {
    const v = numbers[i];
    cells.push(typeof v === "number" ? v : 0);
  }
  const patternCells = patternToCellIndices(pattern);

  const gridHtml = cells
    .map((n, idx) => {
      const isCenter = idx === 12;
      const isPatternCell = patternCells.has(idx);
      const cellClasses = ["cfb-cell"];
      if (isPatternCell) cellClasses.push("cfb-cell-pattern");
      if (isCenter) cellClasses.push("cfb-cell-center");
      const display = isCenter ? "★" : n > 0 ? String(n) : "—";
      return `<div class="${cellClasses.join(" ")}">${display}</div>`;
    })
    .join("");

  return `
    <style>
      .cfb-grid {
        display: grid;
        grid-template-columns: repeat(5, 48px);
        gap: 4px;
        justify-content: center;
        margin: 12px 0;
      }
      .cfb-cell {
        background: #f5f5f5;
        border: 2px solid #ddd;
        border-radius: 4px;
        height: 48px;
        width: 48px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        font-weight: 600;
        color: #333;
      }
      .cfb-cell-pattern {
        background: #5cb85c;
        border-color: #449d44;
        color: #fff;
      }
      .cfb-cell-center {
        background: #f0ad4e;
        border-color: #eea236;
        color: #fff;
      }
      .cfb-pattern-list {
        margin-top: 8px;
        font-size: 13px;
      }
      .cfb-pattern-list .label {
        margin-right: 6px;
        font-size: 12px;
      }
      .cfb-pattern-list > div { margin: 2px 0; }
    </style>
    <div class="cfb-grid" data-marker="cfb-grid">${gridHtml}</div>`;
}

/**
 * Rendrer linje-status for hver av de 5 mønstrene. Pattern billetten dekker
 * markeres som Cashout/Rewarded; andre mønstre vises som "ikke vinner".
 * 1:1 med `renderPatternStatuses` i AgentPhysicalCashoutPage.
 */
function renderPatternStatusList(
  res: CheckBingoQuickResponse,
): string {
  const wonCents = res.wonAmountCents ?? 0;
  const isRewarded = !!res.isWinningDistributed;
  const won = res.winningPattern;
  const items = ALL_PATTERNS.map((p) => {
    if (p === won) {
      const status = isRewarded
        ? t("agent_physical_cashout_status_rewarded") || "Utbetalt"
        : t("agent_physical_cashout_status_cashout") || "Til utbetaling";
      const cls = isRewarded ? "label-success" : "label-warning";
      return `<div><strong>${escapeHtml(patternLabel(p))}</strong>:
        ${formatNok(wonCents)} kr
        <span class="label ${cls}">${escapeHtml(status)}</span></div>`;
    }
    return `<div class="text-muted" style="opacity:0.6;">
      ${escapeHtml(patternLabel(p))}: —
    </div>`;
  }).join("");
  return `
    <div class="cfb-pattern-list">
      <strong>${escapeHtml(t("agent_physical_cashout_pattern_status_header") || "Mønster-status")}:</strong>
      ${items}
    </div>`;
}

/**
 * Best-effort POST mot backend. Logger feilen lokalt men kaster ikke videre —
 * pause/resume skal ALDRI blokkere agentens hovedflyt (sjekk billett +
 * utbetal premie). Hvis pause feiler kan agenten fortsatt sjekke billetter,
 * og hvis resume feiler tar den auto-resume-mekanismen i BingoEngine over
 * når agenten lukker modalen og ny ball trekkes.
 */
async function bestEffortPost(path: string): Promise<void> {
  try {
    await apiRequest(path, { method: "POST", auth: true });
  } catch (err) {
    // Fail-soft. Logger til console for diagnostikk.
    if (typeof console !== "undefined" && console.warn) {
      console.warn(`[CheckForBingoModal] best-effort POST ${path} failed:`, err);
    }
  }
}

/**
 * Åpne Check-for-Bingo-PAUSE-modal.
 *
 * Modal-en åpnes uavhengig av rommets state — backend håndterer feilhåndtering
 * (room-not-found, billett-not-found, hall-scope-violation osv).
 */
export function openCheckForBingoModal(options: CheckForBingoModalOptions): void {
  const { roomCode, skipPauseResume } = options;

  if (!roomCode) {
    // Wireframe §17.16-flyt forutsetter et aktivt rom. Hvis Cash In/Out-siden
    // ikke har et room-context (placeholder-state med "Ingen pågående spill"),
    // kan vi ikke gjøre lookup'et — vis informativ toast og avstå fra å åpne
    // tom modal.
    Toast.warning(
      t("check_for_bingo_no_active_room") ||
        "Ingen aktivt rom — sjekk for bingo krever et pågående spill.",
    );
    return;
  }

  // 1) PAUSE spillet med en gang modalen skal åpnes. Best-effort.
  if (!skipPauseResume) {
    void bestEffortPost(
      `/api/admin/rooms/${encodeURIComponent(roomCode)}/game/pause`,
    );
  }

  const form = document.createElement("form");
  form.setAttribute("novalidate", "novalidate");
  form.dataset.marker = "check-for-bingo-form";
  form.innerHTML = `
    <div class="form-group">
      <label for="cfb-ticket-id">
        ${escapeHtml(t("enter_ticket_number") || "Skriv inn billett-nummer")}
      </label>
      <input
        type="text"
        id="cfb-ticket-id"
        class="form-control input-lg"
        placeholder="${escapeHtml(t("scan_or_type_unique_id") || "Skann eller tast inn billett-ID")}"
        autocomplete="off"
        autofocus
        required
        data-marker="cfb-ticket-input"
      >
      <small class="help-block" style="color:#888;">
        ${escapeHtml(
          t("check_for_bingo_pause_help") ||
            `Spillet er satt på pause. Sjekk billetten og utbetal evt. gevinst — gjenopptas automatisk når du lukker dialogen.`,
        )}
      </small>
    </div>
    <div id="cfb-result" data-marker="cfb-result" style="margin-top:8px;"></div>
  `;

  const ticketInput = form.querySelector<HTMLInputElement>("#cfb-ticket-id")!;
  const resultEl = form.querySelector<HTMLElement>("#cfb-result")!;

  // Sist-mottatt response — brukes av Reward-knappen til å sende riktig
  // ticketId + amount uten å re-fetche.
  let lastResponse: CheckBingoQuickResponse | null = null;
  let lastTicketId: string | null = null;

  function setResult(html: string): void {
    resultEl.innerHTML = html;
  }

  function renderResultHtml(
    res: CheckBingoQuickResponse,
    ticketId: string,
  ): string {
    const safeTicket = escapeHtml(ticketId);
    if (!res.found) {
      return `
        <div class="alert alert-danger" style="margin:0;" data-marker="cfb-not-found">
          <strong>${escapeHtml(
            t("check_for_bingo_not_found") || "Billetten finnes ikke",
          )}</strong>
          <div><small>${safeTicket}</small></div>
        </div>`;
    }

    const gameLine = res.gameId
      ? `<div><small>
          ${escapeHtml(t("game_id") || "Spill-ID")}:
          <code>${escapeHtml(res.gameId)}</code>
          ${res.gameStatus ? ` (${escapeHtml(res.gameStatus)})` : ""}
        </small></div>`
      : "";

    if (res.requiresFullCheck) {
      return `
        <div class="alert alert-warning" style="margin:0;"
             data-marker="cfb-requires-full">
          <strong>${escapeHtml(
            t("check_for_bingo_requires_full") ||
              "Billetten må sjekkes med fullstendig flyt",
          )}</strong>
          <div>${escapeHtml(
            t("check_for_bingo_requires_full_intro") ||
              "Denne billetten er ikke evaluert ennå. Bruk «Sjekk for Bingo (full-flyt)» for å taste inn de 25 tallene fra papir-bongen.",
          )}</div>
          ${gameLine}
          <div style="margin-top:6px;">
            <a class="btn btn-warning btn-sm" href="#/agent/bingo-check">
              ${escapeHtml(t("agent_check_bingo_go_full") || "Gå til full-flyt")}
            </a>
          </div>
        </div>`;
    }

    if (res.hasWon) {
      const patternStr = res.winningPattern
        ? patternLabel(res.winningPattern)
        : t("agent_check_bingo_winning_patterns") || "Vinnende mønster";
      const amountStr =
        res.wonAmountCents !== null && res.wonAmountCents !== undefined
          ? `${formatNok(res.wonAmountCents)} kr`
          : t("amount_not_set") || "(beløp ikke satt)";
      const distributedBadge = res.isWinningDistributed
        ? `<span class="label label-success" style="margin-left:6px;">
            ${escapeHtml(t("agent_physical_cashout_status_rewarded") || "Utbetalt")}
          </span>`
        : `<span class="label label-warning" style="margin-left:6px;">
            ${escapeHtml(t("agent_physical_cashout_status_pending") || "Venter")}
          </span>`;

      // Reward-knapp vises kun hvis ikke allerede utbetalt OG har wonAmount.
      const canReward =
        !res.isWinningDistributed &&
        res.wonAmountCents !== null &&
        res.wonAmountCents !== undefined &&
        res.wonAmountCents > 0;
      const rewardButton = canReward
        ? `<div style="margin-top:10px;">
            <button type="button" class="btn btn-success btn-sm"
                    data-action="cfb-reward"
                    data-marker="cfb-reward-btn">
              <i class="fa fa-money" aria-hidden="true"></i>
              ${escapeHtml(t("reward_winner") || t("reward") || "Utbetal premie")}
            </button>
          </div>`
        : "";

      return `
        <div class="alert alert-success" style="margin:0;"
             data-marker="cfb-has-won">
          <strong>
            <i class="fa fa-trophy" aria-hidden="true"></i>
            ${escapeHtml(t("bingo_won") || "Bingo!")}
          </strong>
          ${distributedBadge}
          <div style="margin-top:4px;">
            <strong>${escapeHtml(patternStr)}</strong> — ${escapeHtml(amountStr)}
          </div>
          ${gameLine}
          ${renderPatternGrid(res.numbersJson, res.winningPattern ?? null)}
          ${renderPatternStatusList(res)}
          ${rewardButton}
        </div>`;
    }

    return `
      <div class="alert alert-info" style="margin:0;"
           data-marker="cfb-not-won">
        <strong>${escapeHtml(t("bingo_not_won") || "Ikke en vinner")}</strong>
        <div><small>${safeTicket}</small></div>
        ${gameLine}
      </div>`;
  }

  async function performCheck(): Promise<void> {
    const ticketId = ticketInput.value.trim();
    if (!ticketId) {
      Toast.error(
        t("scan_or_type_unique_id") || "Skann eller tast inn billett-ID",
      );
      return;
    }
    setResult(
      `<div class="text-muted" data-marker="cfb-checking">
        <i class="fa fa-spinner fa-spin"></i> ${escapeHtml(
          t("checking") || "Sjekker...",
        )}
      </div>`,
    );
    try {
      const res = await apiRequest<CheckBingoQuickResponse>(
        `/api/admin/rooms/${encodeURIComponent(roomCode!)}/check-bingo`,
        { method: "POST", body: { ticketId }, auth: true },
      );
      lastResponse = res;
      lastTicketId = ticketId;
      setResult(renderResultHtml(res, ticketId));
    } catch (err) {
      lastResponse = null;
      lastTicketId = null;
      const msg =
        err instanceof ApiError
          ? err.message
          : t("something_went_wrong") || "Noe gikk galt.";
      setResult(
        `<div class="alert alert-danger" style="margin:0;"
              data-marker="cfb-error">
          ${escapeHtml(msg)}
        </div>`,
      );
    }
  }

  /**
   * Reward-knapp-handler. Sender per-ticket reward via samme endpoint som
   * AgentPhysicalCashoutPage. Etter vellykket reward refresher vi check-
   * resultatet så agenten ser oppdatert "Utbetalt"-status før hun går
   * videre til neste billett.
   */
  async function performReward(): Promise<void> {
    if (!lastResponse || !lastTicketId) return;
    if (!lastResponse.hasWon || lastResponse.isWinningDistributed) return;
    if (
      lastResponse.wonAmountCents === null ||
      lastResponse.wonAmountCents === undefined
    ) {
      Toast.error(t("amount_not_set") || "Premiebeløp er ikke satt.");
      return;
    }
    if (!lastResponse.gameId) {
      Toast.error(
        t("game_id_missing") || "Spill-ID mangler — kan ikke utbetale.",
      );
      return;
    }

    const rewardBtn = resultEl.querySelector<HTMLButtonElement>(
      '[data-action="cfb-reward"]',
    );
    if (rewardBtn) {
      rewardBtn.disabled = true;
      rewardBtn.innerHTML = `<i class="fa fa-spinner fa-spin"></i> ${escapeHtml(
        t("paying_out") || "Utbetaler...",
      )}`;
    }

    try {
      await apiRequest(
        `/api/agent/physical/${encodeURIComponent(lastTicketId)}/reward`,
        {
          method: "POST",
          auth: true,
          body: {
            gameId: lastResponse.gameId,
            amountCents: lastResponse.wonAmountCents,
          },
        },
      );
      Toast.success(t("reward_complete") || "Utbetaling fullført");
      // Re-run check så vi oppdaterer "isWinningDistributed: true" i UI'et.
      await performCheck();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : t("something_went_wrong") || "Noe gikk galt.";
      Toast.error(msg);
      if (rewardBtn) {
        rewardBtn.disabled = false;
        rewardBtn.innerHTML = `<i class="fa fa-money" aria-hidden="true"></i> ${escapeHtml(
          t("reward_winner") || t("reward") || "Utbetal premie",
        )}`;
      }
    }
  }

  // Event-delegering for Reward-knappen — knappen rendres dynamisk i
  // setResult() så vi kan ikke binde direkte ved init.
  resultEl.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>('[data-action="cfb-reward"]');
    if (btn) {
      void performReward();
    }
  });

  Modal.open({
    title: t("check_for_bingo") || "Sjekk for Bingo",
    content: form,
    size: "sm",
    backdrop: "static",
    keyboard: true,
    className: "modal-check-for-bingo",
    onClose: () => {
      // 7) RESUME spillet når modalen lukkes — uansett hvordan (Avbryt,
      // ESC, programmatisk). Best-effort.
      if (!skipPauseResume) {
        void bestEffortPost(
          `/api/admin/rooms/${encodeURIComponent(roomCode!)}/game/resume`,
        );
      }
    },
    buttons: [
      {
        label: t("cancel_button") || "Avbryt",
        variant: "default",
        action: "cancel",
      },
      {
        label: t("agent_check_bingo_go") || "GO",
        variant: "primary",
        action: "check",
        dismiss: false,
        onClick: async (instance) => {
          await performCheck();
          // Hold modalen åpen så agenten kan utbetale eller sjekke en ny
          // billett. Caller (CashInOutPage) trenger ikke onSubmitted-callback
          // — sjekken er read-only og endrer ingen extern UI-state. Reward
          // håndteres av per-knapp-handleren i samme modal.
          void instance;
        },
      },
    ],
  });
}
