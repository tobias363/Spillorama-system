// K1 Settlement-modal med full 15-rad maskin-breakdown — wireframe-paritet.
// Spec: WIREFRAME_CATALOG.md §1267-1322 (PDF 13 §13.5) + §1608-1657 (PDF 15 §15.8).
//
// Dette er den NYE modalen; den eksisterende SettlementModal.ts beholdes for
// backward-compat men skal over tid erstattes. Vi eksporterer en separat
// `openSettlementBreakdownModal(...)` så caller kan velge.
//
// Støtter to moduser:
//   - mode: "create" (default) — agent close-day via POST /api/agent/shift/close-day
//   - mode: "edit"              — admin edit-settlement via PUT /api/admin/shifts/:shiftId/settlement
//                                 Pre-fyller med eksisterende settlement-data og krever `reason`.
//   - mode: "view"              — read-only visning (ingen submit-knapp).
//
// Flyt:
//   1. Lokalstate: { breakdown: MachineBreakdown, receipt: BilagReceipt | null }
//   2. Hver rad har IN/OUT-input (NOK med 2 desimaler) → øre ved lagring
//   3. Auto-compute Sum-kolonne og Total-rad
//   4. Upload-knapp: FileReader → base64 data-URL
//   5. Submit → POST /api/agent/shift/close-day (create) eller PUT-edit (edit)
//
// Backend-kontrakt: apps/backend/src/agent/MachineBreakdownTypes.ts

import { t } from "../../../i18n/I18n.js";
import { Modal, type ModalButton } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError, apiRequest } from "../../../api/client.js";
import {
  MACHINE_ROW_KEYS,
  MAX_BILAG_BYTES,
  editSettlement,
  type AdminSettlement,
  type BilagReceipt,
  type MachineBreakdown,
  type MachineRow,
  type MachineRowKey,
} from "../../../api/admin-settlement.js";

// ── Labels for hver rad (norske / wireframe-korrekte) ──────────────────────

const ROW_LABELS: Record<MachineRowKey, string> = {
  metronia: "Metronia",
  ok_bingo: "OK Bingo",
  franco: "Franco",
  otium: "Otium", // legacy-stavefeil "Olsun" i wireframe
  norsk_tipping_dag: "Norsk Tipping Dag",
  norsk_tipping_totall: "Norsk Tipping Totall",
  rikstoto_dag: "Norsk Rikstoto Dag",
  rikstoto_totall: "Norsk Rikstoto Totall",
  rekvisita: "Rekvisita",
  servering: "Servering/kaffe",
  bilag: "Bilag",
  bank: "Bank",
  gevinst_overfoering_bank: "Gevinst overføring bank",
  annet: "Annet",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function nokToOre(nok: number): number {
  return Math.round(nok * 100);
}

function oreToNokString(ore: number): string {
  return (ore / 100).toFixed(2);
}

function formatNOK(ore: number): string {
  return `${oreToNokString(ore)} kr`;
}

/** Les File som data:{mime};base64,... URL. */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ""));
    fr.onerror = () => reject(new Error(fr.error?.message ?? "read-failed"));
    fr.readAsDataURL(file);
  });
}

function detectMime(file: File): BilagReceipt["mime"] | null {
  const m = file.type.toLowerCase();
  if (m === "application/pdf") return "application/pdf";
  if (m === "image/jpeg" || m === "image/jpg") return "image/jpeg";
  if (m === "image/png") return "image/png";
  return null;
}

// ── State model ─────────────────────────────────────────────────────────────

export type SettlementModalMode = "create" | "edit" | "view";

interface State {
  rows: Map<MachineRowKey, MachineRow>;
  endingOpptallKassieOre: number;
  innskuddDropSafeOre: number;
  differenceInShiftsOre: number;
  notes: string;
  receipt: BilagReceipt | null;
  agentUserId: string;
  reportedCashCountNok: number;
  hallName: string;
  agentName: string;
  businessDate: string; // YYYY-MM-DD
  /** Shift-delta-felt: "Tra start til slut skill" (total IN fra start → slutt). */
  shiftStartToEndOre: number;
  /** Editor-reason (admin edit-modus krever begrunnelse). */
  editReason: string;
  /** Modus-flag brukt til conditional render og submit-rute. */
  mode: SettlementModalMode;
}

function emptyState(params: {
  agentUserId: string;
  agentName: string;
  hallName: string;
  businessDate: string;
  mode: SettlementModalMode;
}): State {
  const rows = new Map<MachineRowKey, MachineRow>();
  for (const key of MACHINE_ROW_KEYS) {
    rows.set(key, { in_cents: 0, out_cents: 0 });
  }
  return {
    rows,
    endingOpptallKassieOre: 0,
    innskuddDropSafeOre: 0,
    differenceInShiftsOre: 0,
    notes: "",
    receipt: null,
    agentUserId: params.agentUserId,
    reportedCashCountNok: 0,
    hallName: params.hallName,
    agentName: params.agentName,
    businessDate: params.businessDate,
    shiftStartToEndOre: 0,
    editReason: "",
    mode: params.mode,
  };
}

/** Prefill state fra eksisterende AdminSettlement (edit/view-modus). */
function stateFromSettlement(
  settlement: AdminSettlement,
  opts: { mode: SettlementModalMode; hallName: string; agentName: string }
): State {
  const state = emptyState({
    agentUserId: settlement.agentUserId,
    agentName: opts.agentName,
    hallName: opts.hallName,
    businessDate: settlement.businessDate,
    mode: opts.mode,
  });
  for (const key of MACHINE_ROW_KEYS) {
    const r = settlement.machineBreakdown?.rows?.[key];
    if (r) {
      state.rows.set(key, { in_cents: r.in_cents, out_cents: r.out_cents });
    }
  }
  state.endingOpptallKassieOre = settlement.machineBreakdown?.ending_opptall_kassie_cents ?? 0;
  state.innskuddDropSafeOre = settlement.machineBreakdown?.innskudd_drop_safe_cents ?? 0;
  state.differenceInShiftsOre = settlement.machineBreakdown?.difference_in_shifts_cents ?? 0;
  state.notes = settlement.settlementNote ?? "";
  state.receipt = settlement.bilagReceipt ?? null;
  state.reportedCashCountNok = settlement.reportedCashCount;
  // Shift-delta: "start-til-slut" = total IN beregnet fra backend shift-data
  state.shiftStartToEndOre = Math.round(settlement.shiftCashInTotal * 100);
  return state;
}

/**
 * Re-beregn shift-delta (difference_in_shifts) og oppdater DOM.
 *
 * Kalles ved initial-render (prefill i edit-modus) og hver gang bruker
 * endrer `sb-start-end`, `sb-drop` eller `sb-ending`. Diff-feltet (`sb-diff`)
 * er read-only og speiler kun state.
 */
function recomputeShiftDelta(state: State, container: HTMLElement): void {
  const { differenceInShiftsCents } = calculateShiftDelta({
    shiftStartToEndCents: state.shiftStartToEndOre,
    innskuddDropSafeCents: state.innskuddDropSafeOre,
    endingOpptallKassieCents: state.endingOpptallKassieOre,
  });
  state.differenceInShiftsOre = differenceInShiftsCents;
  const diffEl = container.querySelector<HTMLInputElement>("#sb-diff");
  if (diffEl) diffEl.value = oreToNokString(differenceInShiftsCents);
}

// ── Shift-delta beregning ───────────────────────────────────────────────────
//
// Wireframe 17.40 (Agent Settlement Popup) viser 4 kalkulerte felter under
// maskin-tabellen:
//   1. "Tra start til slut skill" (total IN akkumulert fra shift-start)
//   2. "Innskudd droppaskile (settlement Payful kassie)" (drop-safe innskudd)
//   3. "Total (Total dispensable)" (ending opptall kassie)
//   4. "Difference in shifts" = 1 - 2 - 3
//
// Alt regnes i øre for å unngå float-feil.
export function calculateShiftDelta(input: {
  shiftStartToEndCents: number;
  innskuddDropSafeCents: number;
  endingOpptallKassieCents: number;
}): { differenceInShiftsCents: number } {
  return {
    differenceInShiftsCents:
      input.shiftStartToEndCents - input.innskuddDropSafeCents - input.endingOpptallKassieCents,
  };
}

function breakdownFromState(state: State): MachineBreakdown {
  const rows: Partial<Record<MachineRowKey, MachineRow>> = {};
  for (const [key, value] of state.rows.entries()) {
    // Kun ta med rader som har input — tomme rader droppes (default 0/0).
    if (value.in_cents !== 0 || value.out_cents !== 0) {
      rows[key] = { in_cents: value.in_cents, out_cents: value.out_cents };
    }
  }
  return {
    rows,
    ending_opptall_kassie_cents: state.endingOpptallKassieOre,
    innskudd_drop_safe_cents: state.innskuddDropSafeOre,
    difference_in_shifts_cents: state.differenceInShiftsOre,
  };
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderModalBody(state: State): string {
  const inputDisabled = state.mode === "view" ? "disabled" : "";
  const rowsHtml = MACHINE_ROW_KEYS.map((key) => {
    const r = state.rows.get(key)!;
    const sum = r.in_cents - r.out_cents;
    return `
      <tr data-row-key="${key}">
        <td>${escapeHtml(ROW_LABELS[key])}</td>
        <td>
          <input type="number" step="0.01" min="0" class="form-control input-sm"
                 data-field="in" data-key="${key}"
                 value="${oreToNokString(r.in_cents)}" style="width:120px;text-align:right;" ${inputDisabled}>
        </td>
        <td>
          <input type="number" step="0.01" min="0" class="form-control input-sm"
                 data-field="out" data-key="${key}"
                 value="${oreToNokString(r.out_cents)}" style="width:120px;text-align:right;" ${inputDisabled}>
        </td>
        <td class="text-right" data-sum="${key}">${formatNOK(sum)}</td>
      </tr>`;
  }).join("");

  // Beregn totaler
  let totalIn = 0;
  let totalOut = 0;
  for (const r of state.rows.values()) {
    totalIn += r.in_cents;
    totalOut += r.out_cents;
  }

  const diffWarn = Math.abs(state.differenceInShiftsOre) > 10000
    ? `<div class="alert alert-warning" style="margin-top:6px;">
        ${escapeHtml(t("diff_warn_over_100_nok") || "Advarsel: differanse mellom shift er over 100 kr og må forklares i notat.")}
       </div>`
    : "";

  return `
    <div class="settlement-breakdown">
      <dl class="dl-horizontal" style="margin-bottom:12px;">
        <dt>${escapeHtml(t("hall") || "Hall")}:</dt><dd>${escapeHtml(state.hallName)}</dd>
        <dt>${escapeHtml(t("agent") || "Agent")}:</dt><dd>${escapeHtml(state.agentName)}</dd>
        <dt>${escapeHtml(t("date") || "Dato")}:</dt><dd>${escapeHtml(state.businessDate)}</dd>
      </dl>

      <table class="table table-bordered table-condensed" id="sb-table">
        <thead>
          <tr>
            <th style="width:40%;">${escapeHtml(t("machine") || "Maskin")}</th>
            <th style="width:20%;">IN (kr)</th>
            <th style="width:20%;">OUT (kr)</th>
            <th style="width:20%;" class="text-right">${escapeHtml(t("sum") || "Sum")}</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr class="active" style="font-weight:bold;">
            <td>${escapeHtml(t("total") || "Total")}</td>
            <td class="text-right" id="sb-total-in">${formatNOK(totalIn)}</td>
            <td class="text-right" id="sb-total-out">${formatNOK(totalOut)}</td>
            <td class="text-right" id="sb-total-sum">${formatNOK(totalIn - totalOut)}</td>
          </tr>
        </tbody>
      </table>

      <fieldset style="margin-top:16px;border:1px solid #ddd;padding:10px;">
        <legend style="font-size:14px;width:auto;padding:0 6px;border:0;margin:0;">
          ${escapeHtml(t("shift_delta_section") || "Shift-delta (overlevering)")}
        </legend>
        <div class="row">
          <div class="col-sm-6">
            <label>${escapeHtml(t("shift_start_to_end") || "Tra start til slut skill")} (kr)</label>
            <input type="number" step="0.01" class="form-control" id="sb-start-end"
                   value="${oreToNokString(state.shiftStartToEndOre)}"
                   ${state.mode === "view" ? "disabled" : ""}>
          </div>
          <div class="col-sm-6">
            <label>${escapeHtml(t("innskudd_drop_safe") || "Innskudd drop-safe")} (kr)</label>
            <input type="number" step="0.01" min="0" class="form-control" id="sb-drop"
                   value="${oreToNokString(state.innskuddDropSafeOre)}"
                   ${state.mode === "view" ? "disabled" : ""}>
          </div>
        </div>
        <div class="row" style="margin-top:8px;">
          <div class="col-sm-6">
            <label>${escapeHtml(t("ending_opptall_kassie") || "Total dispensable")} (kr)</label>
            <input type="number" step="0.01" min="0" class="form-control" id="sb-ending"
                   value="${oreToNokString(state.endingOpptallKassieOre)}"
                   ${state.mode === "view" ? "disabled" : ""}>
          </div>
          <div class="col-sm-6">
            <label>${escapeHtml(t("difference_in_shifts") || "Difference in shifts")} (kr)</label>
            <input type="number" step="0.01" class="form-control" id="sb-diff" readonly
                   value="${oreToNokString(state.differenceInShiftsOre)}"
                   title="${escapeHtml(t("auto_calculated") || "Kalkulert automatisk")}"
                   style="background-color:#f5f5f5;">
          </div>
        </div>
      </fieldset>
      ${diffWarn}

      <div class="row" style="margin-top:12px;">
        <div class="col-sm-12">
          <label>${escapeHtml(t("reported_cash_count") || "Kontanttelling")} (kr)</label>
          <input type="number" step="0.01" min="0" class="form-control" id="sb-reported-cash"
                 value="${state.reportedCashCountNok.toFixed(2)}"
                 ${state.mode === "view" ? "disabled" : ""}>
        </div>
      </div>

      <div class="form-group" style="margin-top:12px;">
        <label>${escapeHtml(t("notes") || "Notater")}</label>
        <textarea class="form-control" id="sb-notes" rows="4"
                  ${state.mode === "view" ? "disabled" : ""}>${escapeHtml(state.notes)}</textarea>
      </div>

      ${state.mode === "edit" ? `
      <div class="form-group" style="margin-top:12px;">
        <label>${escapeHtml(t("reason") || "Grunn")} *</label>
        <input type="text" class="form-control" id="sb-edit-reason"
               value="${escapeHtml(state.editReason)}"
               placeholder="${escapeHtml(t("edit_reason_required") || "Påkrevd for admin-redigering")}">
      </div>` : ""}

      <div class="form-group">
        <label>${escapeHtml(t("upload_receipt") || "Last opp bilag")} (PDF/JPG/PNG, max 10 MB)</label>
        <input type="file" id="sb-bilag-file" accept="application/pdf,image/jpeg,image/png" class="form-control"
               ${state.mode === "view" ? "disabled" : ""}>
        <div id="sb-bilag-status" style="margin-top:6px;font-size:90%;color:#666;">
          ${state.receipt
            ? escapeHtml(`${state.receipt.filename} (${(state.receipt.sizeBytes / 1024).toFixed(1)} KB)`)
            : escapeHtml(t("no_receipt_uploaded") || "Ingen bilag lastet opp")}
        </div>
      </div>
    </div>
  `;
}

// ── Modal-orchestration ────────────────────────────────────────────────────

export interface SettlementBreakdownModalOptions {
  /** "create" (default) — agent close-day; "edit" — admin edit; "view" — read-only. */
  mode?: SettlementModalMode;
  agentUserId: string;
  agentName: string;
  hallName: string;
  businessDate: string;
  /** Pre-fill data for edit/view-modes (ignored for create). */
  existingSettlement?: AdminSettlement;
  /** Admin-edit needs shiftId for PUT URL. */
  shiftId?: string;
  /** Kalles etter vellykket close-day/edit med resultatet. */
  onSubmitted?: (payload: { settlementId: string }) => void;
}

export function openSettlementBreakdownModal(opts: SettlementBreakdownModalOptions): void {
  const mode: SettlementModalMode = opts.mode ?? "create";
  const state = opts.existingSettlement
    ? stateFromSettlement(opts.existingSettlement, {
        mode,
        hallName: opts.hallName,
        agentName: opts.agentName,
      })
    : emptyState({
        agentUserId: opts.agentUserId,
        agentName: opts.agentName,
        hallName: opts.hallName,
        businessDate: opts.businessDate,
        mode,
      });

  const container = document.createElement("div");
  container.innerHTML = renderModalBody(state);

  // Initial shift-delta-kalk (for edit-modus som har prefilled verdier).
  recomputeShiftDelta(state, container);

  const submitLabel = mode === "edit"
    ? (t("save") || "Lagre")
    : (t("submit") || "Submit");

  const modalButtons: ModalButton[] = [
    {
      label: t("cancel") || "Avbryt",
      variant: "default",
      action: "cancel",
    },
  ];

  if (mode !== "view") {
    modalButtons.push({
      label: submitLabel,
      variant: "primary",
      action: "submit",
      dismiss: false,
      onClick: async (inst) => {
        try {
          const breakdown = breakdownFromState(state);

          const notes = state.notes.trim();
          const hasDiffWarn = Math.abs(state.differenceInShiftsOre) > 10000;
          if (hasDiffWarn && !notes) {
            Toast.error(
              t("notes_required_for_large_diff") ||
              "Notat kreves når differanse mellom shift er over 100 kr."
            );
            return;
          }

          if (mode === "edit") {
            const shiftId = opts.shiftId ?? opts.existingSettlement?.shiftId;
            if (!shiftId) {
              Toast.error("Missing shiftId for edit");
              return;
            }
            const reason = state.editReason.trim();
            if (!reason) {
              Toast.error(
                t("edit_reason_required") || "Grunn påkrevd for admin-redigering."
              );
              return;
            }
            const updated = await editSettlement(shiftId, {
              reason,
              reportedCashCount: state.reportedCashCountNok,
              settlementNote: notes || null,
              machineBreakdown: breakdown,
              ...(state.receipt ? { bilagReceipt: state.receipt } : {}),
            });
            Toast.success(t("data_updated_successfully") || "Oppgjør oppdatert.");
            inst.close("button");
            opts.onSubmitted?.({ settlementId: updated.id });
            return;
          }

          // mode === "create"
          const payload: Record<string, unknown> = {
            reportedCashCount: state.reportedCashCountNok,
            settlementNote: notes || undefined,
            machineBreakdown: breakdown,
          };
          if (state.receipt) {
            payload.bilagReceipt = state.receipt;
          }

          const result = await apiRequest<{ id: string }>(
            "/api/agent/shift/close-day",
            { method: "POST", body: payload, auth: true }
          );

          Toast.success(t("settlement_submitted") || "Oppgjør innsendt.");
          inst.close("button");
          opts.onSubmitted?.({ settlementId: result.id });
        } catch (err) {
          const msg = err instanceof ApiError ? err.message : (err instanceof Error ? err.message : String(err));
          Toast.error(msg || (t("something_went_wrong") || "Noe gikk galt."));
        }
      },
    });
  }

  const modalTitle = mode === "edit"
    ? (t("edit_settlement") || "Rediger oppgjør")
    : mode === "view"
      ? (t("view_settlement") || "Vis oppgjør")
      : (t("settlement") || "Oppgjør");

  const instance = Modal.open({
    title: modalTitle,
    content: container,
    backdrop: "static",
    keyboard: false,
    size: "xl",
    className: "modal-settlement-breakdown",
    buttons: modalButtons,
  });

  // ── Wire event handlers ──────────────────────────────────────────────────

  container.addEventListener("input", (ev) => {
    const target = ev.target as HTMLElement;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return;

    // Rad-IN/OUT
    if (target instanceof HTMLInputElement && target.dataset.field && target.dataset.key) {
      const key = target.dataset.key as MachineRowKey;
      if (!MACHINE_ROW_KEYS.includes(key)) return;
      const nok = Number(target.value);
      if (!Number.isFinite(nok) || nok < 0) return;
      const ore = nokToOre(nok);
      const row = state.rows.get(key)!;
      if (target.dataset.field === "in") row.in_cents = ore;
      if (target.dataset.field === "out") row.out_cents = ore;
      // Oppdater sum-celle
      const sumCell = container.querySelector<HTMLElement>(`[data-sum="${key}"]`);
      if (sumCell) sumCell.textContent = formatNOK(row.in_cents - row.out_cents);
      // Oppdater total-rad
      let totalIn = 0;
      let totalOut = 0;
      for (const r of state.rows.values()) {
        totalIn += r.in_cents;
        totalOut += r.out_cents;
      }
      const tIn = container.querySelector<HTMLElement>("#sb-total-in");
      const tOut = container.querySelector<HTMLElement>("#sb-total-out");
      const tSum = container.querySelector<HTMLElement>("#sb-total-sum");
      if (tIn) tIn.textContent = formatNOK(totalIn);
      if (tOut) tOut.textContent = formatNOK(totalOut);
      if (tSum) tSum.textContent = formatNOK(totalIn - totalOut);
      return;
    }

    // Calculation-felter — skriv state og re-beregn difference-in-shifts
    if (target.id === "sb-ending") {
      const n = Number(target.value);
      if (Number.isFinite(n) && n >= 0) {
        state.endingOpptallKassieOre = nokToOre(n);
        recomputeShiftDelta(state, container);
      }
      return;
    }
    if (target.id === "sb-drop") {
      const n = Number(target.value);
      if (Number.isFinite(n) && n >= 0) {
        state.innskuddDropSafeOre = nokToOre(n);
        recomputeShiftDelta(state, container);
      }
      return;
    }
    if (target.id === "sb-start-end") {
      const n = Number(target.value);
      if (Number.isFinite(n)) {
        state.shiftStartToEndOre = nokToOre(n);
        recomputeShiftDelta(state, container);
      }
      return;
    }
    if (target.id === "sb-reported-cash") {
      const n = Number(target.value);
      if (Number.isFinite(n) && n >= 0) state.reportedCashCountNok = n;
      return;
    }
    if (target.id === "sb-notes" && target instanceof HTMLTextAreaElement) {
      state.notes = target.value;
      return;
    }
    if (target.id === "sb-edit-reason") {
      state.editReason = target.value;
      return;
    }
  });

  // ── File-upload handler ──────────────────────────────────────────────────

  container.addEventListener("change", async (ev) => {
    const target = ev.target as HTMLElement;
    if (!(target instanceof HTMLInputElement) || target.id !== "sb-bilag-file") return;
    const file = target.files?.[0];
    if (!file) return;

    const statusEl = container.querySelector<HTMLElement>("#sb-bilag-status");
    const setStatus = (msg: string, err = false): void => {
      if (statusEl) {
        statusEl.textContent = msg;
        statusEl.style.color = err ? "#a94442" : "#666";
      }
    };

    if (file.size > MAX_BILAG_BYTES) {
      setStatus(t("bilag_too_large") || `Filen er for stor (max ${(MAX_BILAG_BYTES / 1024 / 1024).toFixed(0)} MB).`, true);
      target.value = "";
      return;
    }
    const mime = detectMime(file);
    if (!mime) {
      setStatus(t("bilag_wrong_format") || "Ugyldig filformat. Tillatt: PDF, JPG, PNG.", true);
      target.value = "";
      return;
    }
    try {
      setStatus(t("uploading") || "Laster opp...");
      const dataUrl = await readFileAsDataUrl(file);
      if (!dataUrl.startsWith(`data:${mime};base64,`)) {
        // FileReader normaliserer av-og-til; hvis mismatch, avvis.
        setStatus(t("bilag_wrong_format") || "Ugyldig filformat.", true);
        target.value = "";
        return;
      }
      // I edit-modus har admin ingen agent-ID — backend setter uploadedByUserId
      // basert på access-token. Sender likevel som string for wire-validering.
      state.receipt = {
        mime,
        filename: file.name,
        dataUrl,
        sizeBytes: file.size,
        uploadedAt: new Date().toISOString(),
        uploadedByUserId: state.agentUserId || "admin",
      };
      setStatus(`${file.name} (${(file.size / 1024).toFixed(1)} KB) ✓`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(t("upload_failed") || `Opplasting feilet: ${msg}`, true);
      state.receipt = null;
      target.value = "";
    }
  });

  void instance;
}
