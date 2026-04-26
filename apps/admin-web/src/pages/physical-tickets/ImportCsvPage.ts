// PR-PT6 — Import CSV-side for fysisk-bong-inventar (app_static_tickets).
//
// Wraps `POST /api/admin/physical-tickets/static/import` (PT1) i et fokusert
// admin-skjema: hall-velger + CSV-filopplaster. Støtter både ADMIN (kan velge
// hvilken som helst hall) og HALL_OPERATOR (bundet til egen hall, UI skjuler
// hall-velgeren).
//
// Merk: API-et tar ikke multipart — CSV-innhold leses som tekst via FileReader
// og sendes som JSON-streng (matcher resten av admin-API-et). Server har
// 15MB body-limit. Eksisterende rader (hall_id, ticket_serial, ticket_color)
// hoppes over idempotent.

import { t } from "../../i18n/I18n.js";
import { getSession } from "../../auth/Session.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  importStaticTicketsCsv,
  type StaticTicketImportResult,
} from "../../api/admin-physical-tickets.js";
import { listHalls, type AdminHall } from "../../api/dashboard.js";
import { mapPhysicalTicketErrorMessage } from "./errorMap.js";
import { boxClose, boxOpen, contentHeader, escapeHtml } from "./shared.js";

interface PageState {
  hallId: string | null;
  halls: AdminHall[];
}

export function renderImportCsvPage(container: HTMLElement): void {
  const session = getSession();
  const isAdmin = session?.role === "admin" || session?.role === "super-admin";
  const operatorHallId = !isAdmin ? session?.hall?.[0]?.id ?? null : null;

  const state: PageState = {
    hallId: operatorHallId,
    halls: [],
  };

  container.innerHTML = `
    ${contentHeader("pt_import_csv_title")}
    <section class="content">
      ${boxOpen("pt_import_csv_title", "primary")}
        <form id="pt-import-form" novalidate>
          <div class="row" id="pt-hall-row" style="display:${isAdmin ? "block" : "none"};margin-bottom:12px;">
            <div class="col-sm-6">
              <label class="control-label" for="pt-hallId">${escapeHtml(t("select_hall"))}</label>
              <select id="pt-hallId" class="form-control" data-field="hallId">
                <option value="">${escapeHtml(t("select_hall_name"))}</option>
              </select>
            </div>
          </div>
          <div class="row">
            <div class="col-sm-8">
              <label for="pt-csvFile">${escapeHtml(t("pt_csv_import_file_label"))}</label>
              <input type="file" id="pt-csvFile" name="csvFile"
                accept=".csv,text/csv,text/plain" data-field="csvFile">
              <p class="help-block" style="margin-top:6px;">
                <code>${escapeHtml(t("pt_csv_import_file_hint"))}</code>
              </p>
            </div>
            <div class="col-sm-4 text-right" style="padding-top:24px;">
              <button type="submit" class="btn btn-primary" id="pt-submit" data-action="submit">
                <i class="fa fa-upload" aria-hidden="true"></i> ${escapeHtml(t("pt_csv_import_upload_button"))}
              </button>
            </div>
          </div>
          <div id="pt-status" style="margin-top:12px;" aria-live="polite"></div>
        </form>
      ${boxClose()}
    </section>`;

  const hallSelect = container.querySelector<HTMLSelectElement>("#pt-hallId");
  const csvInput = container.querySelector<HTMLInputElement>("#pt-csvFile")!;
  const submitBtn = container.querySelector<HTMLButtonElement>("#pt-submit")!;
  const statusEl = container.querySelector<HTMLElement>("#pt-status")!;
  const form = container.querySelector<HTMLFormElement>("#pt-import-form")!;

  if (isAdmin && hallSelect) {
    void (async () => {
      try {
        state.halls = await listHalls();
        for (const h of state.halls) {
          const opt = document.createElement("option");
          opt.value = h.id;
          opt.textContent = h.name;
          hallSelect.append(opt);
        }
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
        Toast.error(msg);
      }
    })();
    hallSelect.addEventListener("change", () => {
      state.hallId = hallSelect.value || null;
    });
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const hallId = state.hallId;
    if (!hallId) {
      Toast.error(t("pt_csv_import_select_hall_first"));
      return;
    }
    const file = csvInput.files?.[0];
    if (!file) {
      Toast.error(t("pt_csv_import_select_file_first"));
      return;
    }

    statusEl.innerHTML = `<div class="callout callout-info" style="margin:0;">${escapeHtml(t("pt_csv_import_uploading"))}</div>`;
    submitBtn.disabled = true;

    try {
      const csvContent = await readFileAsText(file);
      const result: StaticTicketImportResult = await importStaticTicketsCsv({
        hallId,
        csvContent,
      });
      const msg = t("pt_csv_import_success", {
        inserted: result.inserted,
        skipped: result.skipped,
      });
      statusEl.innerHTML = `<div class="callout callout-success" style="margin:0;">
        <strong>${escapeHtml(msg)}</strong>
        <div style="margin-top:6px;font-size:13px;">
          ${escapeHtml(t("pt_import_total_rows"))}: ${result.totalRows}
        </div>
      </div>`;
      Toast.success(msg);
      csvInput.value = "";
    } catch (err) {
      const msg = mapPhysicalTicketErrorMessage(err);
      statusEl.innerHTML = `<div class="callout callout-danger" style="margin:0;">
        ${escapeHtml(`${t("pt_csv_import_failed")}: ${msg}`)}
      </div>`;
      Toast.error(msg);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const v = reader.result;
      if (typeof v === "string") resolve(v);
      else reject(new Error("FileReader returnerte ikke en streng."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader feilet."));
    reader.readAsText(file, "utf-8");
  });
}
