// Wireframe §17.16 — minimal "Check for Bingo"-modal.
//
// Flyt:
//   1. Agent åpner modalen via "Sjekk for Bingo"-knappen i Cash In/Out Box 4.
//   2. Skriver/scanner ticket-nummer (uniqueId) → trykker GO.
//   3. Modalen kaller POST /api/admin/rooms/:roomCode/check-bingo med
//      `{ ticketId }`. Kontrakt: `apps/backend/src/routes/adminRoomsCheckBingo.ts`.
//   4. Resultat vises som inline-alert i samme modal:
//        - billetten finnes ikke → rød alert
//        - billetten må evalueres med 25-tall-flyten → gul alert med link
//        - billetten har vunnet → grønn alert med pattern + win-amount
//        - billetten tapte → blå alert
//
// Bevisst MINIMALT scope (singleton-PR per agent-instruks 2026-04-27):
//   - Ingen 5×5-grid pattern-popup — det blir egen oppfølging (FOLLOWUP-13).
//   - Ingen Reward-All — egen PR.
//   - Pause-engine kobles ikke — kun check-flyten her.
//
// Per pilot-blokker i `MASTER_PLAN_SPILL1_PILOT_2026-04-24.md` §1.5.

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
}

export interface CheckForBingoModalOptions {
  /**
   * Rom-koden som agenten sjekker mot. Når UI-en ennå ikke har et aktivt rom
   * (Box 4 placeholder-state), beholdes den som null — modalen viser da en
   * info-toast og lukkes umiddelbart i stedet for å åpne.
   */
  roomCode: string | null;
}

const PATTERN_LABEL: Record<CheckBingoQuickPattern, string> = {
  row_1: "Rad 1",
  row_2: "Rad 2",
  row_3: "Rad 3",
  row_4: "Rad 4",
  full_house: "Fullt Hus",
};

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
 * Åpne Check-for-Bingo-modal.
 *
 * Modal-en åpnes uavhengig av rommets state — backend håndterer feilhåndtering
 * (room-not-found, billett-not-found, hall-scope-violation osv).
 */
export function openCheckForBingoModal(options: CheckForBingoModalOptions): void {
  const { roomCode } = options;

  if (!roomCode) {
    // Wireframe §17.16-flyt forutsetter et aktivt rom. Hvis Cash In/Out-siden
    // ikke har et room-context (placeholder-state med "Ingen pågående spill"),
    // kan vi ikke gjøre lookup'et — vis informativ toast og avstå fra å åpne
    // tom modal.
    Toast.warning(
      t("check_for_bingo_no_active_room")
        || "Ingen aktivt rom — sjekk for bingo krever et pågående spill."
    );
    return;
  }

  const form = document.createElement("form");
  form.setAttribute("novalidate", "novalidate");
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
      >
      <small class="help-block" style="color:#888;">
        ${escapeHtml(
          t("check_for_bingo_minimal_help")
            || "Rask oppslag mot rom " + roomCode + ". Returnerer cached resultat hvis billetten allerede er sjekket."
        )}
      </small>
    </div>
    <div id="cfb-result" style="margin-top:8px;"></div>
  `;

  const ticketInput = form.querySelector<HTMLInputElement>("#cfb-ticket-id")!;
  const resultEl = form.querySelector<HTMLElement>("#cfb-result")!;

  function setResult(html: string): void {
    resultEl.innerHTML = html;
  }

  function renderResultHtml(res: CheckBingoQuickResponse, ticketId: string): string {
    const safeTicket = escapeHtml(ticketId);
    if (!res.found) {
      return `
        <div class="alert alert-danger" style="margin:0;">
          <strong>${escapeHtml(
            t("check_for_bingo_not_found") || "Billetten finnes ikke"
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
        <div class="alert alert-warning" style="margin:0;">
          <strong>${escapeHtml(
            t("check_for_bingo_requires_full") || "Billetten må sjekkes med fullstendig flyt"
          )}</strong>
          <div>${escapeHtml(
            t("check_for_bingo_requires_full_intro")
              || "Denne billetten er ikke evaluert ennå. Bruk «Sjekk for Bingo (full-flyt)» for å taste inn de 25 tallene fra papir-bongen."
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
        : (t("agent_check_bingo_winning_patterns") || "Vinnende mønster");
      const amountStr = res.wonAmountCents !== null && res.wonAmountCents !== undefined
        ? `${formatNok(res.wonAmountCents)} kr`
        : (t("amount_not_set") || "(beløp ikke satt)");
      const distributedBadge = res.isWinningDistributed
        ? `<span class="badge" style="background:#5cb85c;margin-left:6px;">
            ${escapeHtml(t("agent_physical_cashout_status_rewarded") || "Utbetalt")}
          </span>`
        : `<span class="badge" style="background:#f0ad4e;margin-left:6px;">
            ${escapeHtml(t("agent_physical_cashout_status_pending") || "Venter")}
          </span>`;
      return `
        <div class="alert alert-success" style="margin:0;">
          <strong>
            <i class="fa fa-trophy" aria-hidden="true"></i>
            ${escapeHtml(t("bingo_won") || "Bingo!")}
          </strong>
          ${distributedBadge}
          <div style="margin-top:4px;">
            <strong>${escapeHtml(patternStr)}</strong> — ${escapeHtml(amountStr)}
          </div>
          ${gameLine}
        </div>`;
    }

    return `
      <div class="alert alert-info" style="margin:0;">
        <strong>${escapeHtml(t("bingo_not_won") || "Ikke en vinner")}</strong>
        <div><small>${safeTicket}</small></div>
        ${gameLine}
      </div>`;
  }

  Modal.open({
    title: t("check_for_bingo") || "Sjekk for Bingo",
    content: form,
    size: "sm",
    backdrop: "static",
    keyboard: true,
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
          const ticketId = ticketInput.value.trim();
          if (!ticketId) {
            Toast.error(
              t("scan_or_type_unique_id") || "Skann eller tast inn billett-ID"
            );
            return;
          }
          setResult(
            `<div class="text-muted"><i class="fa fa-spinner fa-spin"></i> ${escapeHtml(
              t("checking") || "Sjekker..."
            )}</div>`
          );
          try {
            const res = await apiRequest<CheckBingoQuickResponse>(
              `/api/admin/rooms/${encodeURIComponent(roomCode)}/check-bingo`,
              {
                method: "POST",
                body: { ticketId },
                auth: true,
              }
            );
            setResult(renderResultHtml(res, ticketId));
            // Hold modalen åpen så agenten kan se resultatet og evt. sjekke
            // en ny billett. Caller (CashInOutPage) trenger ikke onSubmitted-
            // callback — sjekken er read-only og endrer ingen UI-state.
            void instance;
          } catch (err) {
            const msg = err instanceof ApiError
              ? err.message
              : (t("something_went_wrong") || "Noe gikk galt.");
            setResult(
              `<div class="alert alert-danger" style="margin:0;">
                ${escapeHtml(msg)}
              </div>`
            );
          }
        },
      },
    ],
  });
}
