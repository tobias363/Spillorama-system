// PR-PT6 — Range-register-side (PT2).
//
// Bingovert registrerer en ny range: scanner topp-bong + spesifiserer farge
// og antall. Server matcher mot app_static_tickets og reserverer bonger
// atomisk (app_agent_ticket_ranges + reserved_by_range_id).
//
// Scanner leverer strengen via keyboard-wedge (samme input-felt), men for
// range-registrering trenger vi en *lesbar* serial (ikke full 22-tegns
// barcode). Derfor lar vi input være ren tekst — bingovert scanner, og vi
// sender det som firstScannedSerial. PT1/PT2-testene i backend forventer
// lesbar serial (f.eks. "100042"), ikke full barcode.

import { t } from "../../i18n/I18n.js";
import { getSession } from "../../auth/Session.js";
import { Toast } from "../../components/Toast.js";
import {
  registerAgentTicketRange,
  type StaticTicketColor,
  type RegisterRangeResult,
} from "../../api/admin-physical-tickets.js";
import { mapPhysicalTicketErrorMessage } from "./errorMap.js";
import { boxClose, boxOpen, contentHeader, escapeHtml } from "./shared.js";

const COLORS: Array<{ value: StaticTicketColor; labelKey: string }> = [
  { value: "small", labelKey: "pt_color_small" },
  { value: "large", labelKey: "pt_color_large" },
  { value: "traffic-light", labelKey: "pt_color_traffic_light" },
];

interface PageState {
  hallId: string | null;
}

export function renderRangeRegisterPage(container: HTMLElement): void {
  const session = getSession();
  const isAdmin = session?.role === "admin" || session?.role === "super-admin";
  const operatorHallId = !isAdmin ? session?.hall?.[0]?.id ?? null : null;
  const hallName = session?.hall?.[0]?.name ?? null;

  const state: PageState = {
    hallId: operatorHallId,
  };

  const colorOptions = COLORS
    .map((c) => `<option value="${escapeHtml(c.value)}">${escapeHtml(t(c.labelKey))}</option>`)
    .join("");

  container.innerHTML = `
    ${contentHeader("pt_range_register_title")}
    <section class="content">
      ${boxOpen("pt_range_register_title", "primary")}
        <form id="rr-form" novalidate>
          ${state.hallId
            ? `<div style="margin-bottom:10px;">
                 <strong>${escapeHtml(t("select_hall"))}:</strong>
                 ${escapeHtml(hallName ?? state.hallId)}
               </div>`
            : `<div class="callout callout-warning" style="margin-bottom:12px;">
                 ${escapeHtml(t("hall_scope_required"))}
               </div>`}
          <div class="row">
            <div class="col-sm-4">
              <label for="rr-color">${escapeHtml(t("pt_ticket_color"))}</label>
              <select id="rr-color" class="form-control" data-field="color" required>
                ${colorOptions}
              </select>
            </div>
            <div class="col-sm-5">
              <label for="rr-barcode">${escapeHtml(t("pt_first_scanned_serial"))}</label>
              <input id="rr-barcode" class="form-control" type="text" autocomplete="off"
                inputmode="numeric" data-field="firstScannedSerial" required
                placeholder="${escapeHtml(t("pt_first_scanned_serial_placeholder"))}">
              <p class="help-block" style="margin-top:4px;font-size:12px;">
                ${escapeHtml(t("pt_scanner_enter_hint"))}
              </p>
            </div>
            <div class="col-sm-3">
              <label for="rr-count">${escapeHtml(t("pt_range_count"))}</label>
              <input id="rr-count" class="form-control" type="number" min="1" max="5000"
                data-field="count" required value="50">
            </div>
          </div>
          <div class="row" style="margin-top:14px;">
            <div class="col-sm-12 text-right">
              <button type="submit" class="btn btn-success" id="rr-submit" data-action="submit">
                <i class="fa fa-check" aria-hidden="true"></i> ${escapeHtml(t("pt_range_register_submit"))}
              </button>
            </div>
          </div>
          <div id="rr-result" style="margin-top:12px;" aria-live="polite"></div>
        </form>
      ${boxClose()}
    </section>`;

  const form = container.querySelector<HTMLFormElement>("#rr-form")!;
  const submitBtn = container.querySelector<HTMLButtonElement>("#rr-submit")!;
  const resultEl = container.querySelector<HTMLElement>("#rr-result")!;

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const hallId = state.hallId;
    if (!hallId) {
      Toast.error(t("hall_scope_required"));
      return;
    }
    const color = (container.querySelector<HTMLSelectElement>("#rr-color")!.value || "")
      .trim() as StaticTicketColor;
    const firstScannedSerial = (container
      .querySelector<HTMLInputElement>("#rr-barcode")!.value || "").trim();
    const countRaw = Number(container.querySelector<HTMLInputElement>("#rr-count")!.value);
    const count = Number.isFinite(countRaw) ? Math.trunc(countRaw) : NaN;

    if (!firstScannedSerial) {
      Toast.error(t("pt_err_serial_required"));
      return;
    }
    if (!Number.isFinite(count) || count <= 0) {
      Toast.error(t("pt_err_count_positive"));
      return;
    }

    const session2 = getSession();
    if (!session2) {
      Toast.error(t("something_went_wrong"));
      return;
    }

    resultEl.innerHTML = `<div class="callout callout-info" style="margin:0;">${escapeHtml(t("pt_range_registering"))}</div>`;
    submitBtn.disabled = true;
    try {
      const result: RegisterRangeResult = await registerAgentTicketRange({
        agentId: session2.id,
        hallId,
        ticketColor: color,
        firstScannedSerial,
        count,
      });
      const successMsg = t("pt_range_registered_success", {
        count: result.reservedCount,
      });
      Toast.success(successMsg);
      resultEl.innerHTML = `
        <div class="callout callout-success" style="margin:0;">
          <strong>${escapeHtml(successMsg)}</strong>
          <div style="margin-top:6px;font-size:13px;">
            ${escapeHtml(t("pt_range_id"))}: <code>${escapeHtml(result.rangeId)}</code><br>
            ${escapeHtml(t("pt_range_top_serial"))}: <strong>${escapeHtml(result.initialTopSerial)}</strong><br>
            ${escapeHtml(t("pt_range_final_serial"))}: <strong>${escapeHtml(result.finalSerial)}</strong>
          </div>
        </div>`;
      form.reset();
      (container.querySelector<HTMLInputElement>("#rr-count")!).value = "50";
    } catch (err) {
      const msg = mapPhysicalTicketErrorMessage(err);
      resultEl.innerHTML = `<div class="callout callout-danger" style="margin:0;">${escapeHtml(msg)}</div>`;
      Toast.error(msg);
    } finally {
      submitBtn.disabled = false;
    }
  });
}
