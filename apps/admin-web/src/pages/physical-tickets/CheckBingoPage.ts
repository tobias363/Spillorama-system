// BIN-641 wiring — admin check-bingo stamp flow.
//
// Flow:
//   1. Operator skanner unique-ID, taster gameId og 25 tall fra bongen.
//   2. POST /api/admin/physical-tickets/:uniqueId/check-bingo stempler
//      billetten første gang (persisterer numbers + patternWon).
//   3. Respons viser vinn-status + matchede tall. Idempotens: ny kall med
//      samme numbers returnerer stemplet data; divergens → NUMBERS_MISMATCH.
//
// Permisjon: PHYSICAL_TICKET_WRITE (ADMIN + HALL_OPERATOR). Kun 5×5 = 25 tall.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  checkBingo,
  type CheckBingoResponse,
} from "../../api/admin-physical-tickets.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, formatNOK } from "./shared.js";

const GRID_SIZE = 5;
const TICKET_SIZE = GRID_SIZE * GRID_SIZE;

export function renderCheckBingoPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("check_bingo_stamp")}
    <section class="content">
      ${boxOpen("check_bingo_intro", "primary")}
        <form id="check-bingo-form" class="form-horizontal" novalidate>
          <div class="form-group">
            <label class="col-sm-3 control-label" for="cb-uniqueId">${escapeHtml(t("unique_id"))}</label>
            <div class="col-sm-4">
              <input type="text" class="form-control" id="cb-uniqueId"
                placeholder="${escapeHtml(t("scan_or_type_unique_id"))}" required autofocus autocomplete="off">
            </div>
          </div>
          <div class="form-group">
            <label class="col-sm-3 control-label" for="cb-gameId">${escapeHtml(t("game_id"))}</label>
            <div class="col-sm-4">
              <input type="text" class="form-control" id="cb-gameId"
                placeholder="${escapeHtml(t("enter_game_id"))}" required autocomplete="off">
            </div>
          </div>
          <div class="form-group">
            <label class="col-sm-3 control-label">${escapeHtml(t("ticket_numbers"))} (5×5)</label>
            <div class="col-sm-9">
              <div id="cb-grid" style="display:grid;grid-template-columns:repeat(5,minmax(60px,1fr));gap:4px;max-width:400px;"></div>
              <p class="help-block">${escapeHtml(t("ticket_numbers_help"))}</p>
            </div>
          </div>
          <div class="form-group">
            <div class="col-sm-offset-3 col-sm-9">
              <button type="submit" class="btn btn-primary" data-action="check">
                <i class="fa fa-check" aria-hidden="true"></i> ${escapeHtml(t("check_bingo"))}
              </button>
            </div>
          </div>
        </form>
        <div id="cb-result" style="margin-top:16px;"></div>
      ${boxClose()}
    </section>`;

  const form = container.querySelector<HTMLFormElement>("#check-bingo-form")!;
  const uniqueIdInput = container.querySelector<HTMLInputElement>("#cb-uniqueId")!;
  const gameIdInput = container.querySelector<HTMLInputElement>("#cb-gameId")!;
  const grid = container.querySelector<HTMLElement>("#cb-grid")!;
  const resultHost = container.querySelector<HTMLElement>("#cb-result")!;

  for (let i = 0; i < TICKET_SIZE; i += 1) {
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "75";
    input.className = "form-control input-sm";
    input.dataset.idx = String(i);
    if (i === 12) {
      input.value = "0";
      input.placeholder = "0";
      input.readOnly = true;
      input.style.background = "#f0f0f0";
    } else {
      input.placeholder = String(i + 1);
    }
    grid.append(input);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const uniqueId = uniqueIdInput.value.trim();
    if (!uniqueId) {
      Toast.error(t("scan_or_type_unique_id"));
      return;
    }
    const gameId = gameIdInput.value.trim();
    if (!gameId) {
      Toast.error(t("enter_game_id"));
      return;
    }
    const numbers: number[] = [];
    const cells = grid.querySelectorAll<HTMLInputElement>("input[data-idx]");
    let valid = true;
    cells.forEach((cell) => {
      const n = Number(cell.value);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 75) {
        valid = false;
        cell.classList.add("has-error");
      } else {
        cell.classList.remove("has-error");
      }
      numbers.push(n);
    });
    if (!valid || numbers.length !== TICKET_SIZE) {
      Toast.error(t("ticket_numbers_invalid"));
      return;
    }
    resultHost.innerHTML = `<p>${escapeHtml(t("loading_ellipsis"))}</p>`;
    try {
      const res = await checkBingo(uniqueId, { gameId, numbers });
      renderResult(res);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      resultHost.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
    }
  });

  function renderResult(res: CheckBingoResponse): void {
    const statusClass = res.hasWon ? "alert-success" : "alert-info";
    const statusText = res.hasWon
      ? `${t("bingo_won")}: ${res.winningPattern ?? ""}`
      : t("bingo_not_won");
    const matchedHtml = res.matchedNumbers.length
      ? res.matchedNumbers.map((n) => `<span class="label label-success" style="margin-right:4px;">${n}</span>`).join("")
      : `<em>${escapeHtml(t("no_matched_numbers"))}</em>`;
    resultHost.innerHTML = `
      <div class="alert ${statusClass}">
        <strong>${escapeHtml(statusText)}</strong>
        ${res.alreadyEvaluated ? `<div><em>${escapeHtml(t("already_evaluated"))}</em></div>` : ""}
      </div>
      <table class="table table-condensed">
        <tbody>
          <tr><th>${escapeHtml(t("game_status"))}</th><td>${escapeHtml(res.gameStatus)}</td></tr>
          <tr><th>${escapeHtml(t("drawn_numbers_count"))}</th><td>${res.drawnNumbersCount}</td></tr>
          <tr><th>${escapeHtml(t("matched_numbers"))}</th><td>${matchedHtml}</td></tr>
          ${
            res.wonAmountCents !== null
              ? `<tr><th>${escapeHtml(t("payout_amount"))}</th><td>${formatNOK(res.wonAmountCents / 100)} kr</td></tr>`
              : ""
          }
          ${
            res.isWinningDistributed
              ? `<tr><th>${escapeHtml(t("already_cashed_out"))}</th><td>${escapeHtml(t("yes"))}</td></tr>`
              : ""
          }
        </tbody>
      </table>`;
  }
}
