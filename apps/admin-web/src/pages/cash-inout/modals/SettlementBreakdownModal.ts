// K1 Settlement-modal med full 15-rad maskin-breakdown — wireframe-paritet.
// Spec: WIREFRAME_CATALOG.md §1267-1322 (PDF 13 §13.5) + §1608-1657 (PDF 15 §15.8).
//
// Dette er den NYE modalen; den eksisterende SettlementModal.ts beholdes for
// backward-compat men skal over tid erstattes. Vi eksporterer en separat
// `openSettlementBreakdownModal(...)` så caller kan velge.
//
// Flyt:
//   1. Lokalstate: { breakdown: MachineBreakdown, receipt: BilagReceipt | null }
//   2. Hver rad har IN/OUT-input (NOK med 2 desimaler) → øre ved lagring
//   3. Auto-compute Sum-kolonne og Total-rad
//   4. Upload-knapp: FileReader → base64 data-URL
//   5. Submit → POST /api/agent/shift/close-day med full payload
//
// Backend-kontrakt: apps/backend/src/agent/MachineBreakdownTypes.ts

import { t } from "../../../i18n/I18n.js";
import { Modal } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError, apiRequest } from "../../../api/client.js";
import {
  MACHINE_ROW_KEYS,
  MAX_BILAG_BYTES,
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
}

function emptyState(params: {
  agentUserId: string;
  agentName: string;
  hallName: string;
  businessDate: string;
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
  const rowsHtml = MACHINE_ROW_KEYS.map((key) => {
    const r = state.rows.get(key)!;
    const sum = r.in_cents - r.out_cents;
    return `
      <tr data-row-key="${key}">
        <td>${escapeHtml(ROW_LABELS[key])}</td>
        <td>
          <input type="number" step="0.01" min="0" class="form-control input-sm"
                 data-field="in" data-key="${key}"
                 value="${oreToNokString(r.in_cents)}" style="width:120px;text-align:right;">
        </td>
        <td>
          <input type="number" step="0.01" min="0" class="form-control input-sm"
                 data-field="out" data-key="${key}"
                 value="${oreToNokString(r.out_cents)}" style="width:120px;text-align:right;">
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

      <div class="row" style="margin-top:12px;">
        <div class="col-sm-4">
          <label>${escapeHtml(t("ending_opptall_kassie") || "Ending opptall kassie")} (kr)</label>
          <input type="number" step="0.01" min="0" class="form-control" id="sb-ending"
                 value="${oreToNokString(state.endingOpptallKassieOre)}">
        </div>
        <div class="col-sm-4">
          <label>${escapeHtml(t("innskudd_drop_safe") || "Innskudd drop-safe")} (kr)</label>
          <input type="number" step="0.01" min="0" class="form-control" id="sb-drop"
                 value="${oreToNokString(state.innskuddDropSafeOre)}">
        </div>
        <div class="col-sm-4">
          <label>${escapeHtml(t("difference_in_shifts") || "Difference in shifts")} (kr)</label>
          <input type="number" step="0.01" class="form-control" id="sb-diff"
                 value="${oreToNokString(state.differenceInShiftsOre)}">
        </div>
      </div>
      ${diffWarn}

      <div class="row" style="margin-top:12px;">
        <div class="col-sm-12">
          <label>${escapeHtml(t("reported_cash_count") || "Kontanttelling")} (kr)</label>
          <input type="number" step="0.01" min="0" class="form-control" id="sb-reported-cash"
                 value="${state.reportedCashCountNok.toFixed(2)}">
        </div>
      </div>

      <div class="form-group" style="margin-top:12px;">
        <label>${escapeHtml(t("notes") || "Notater")}</label>
        <textarea class="form-control" id="sb-notes" rows="3">${escapeHtml(state.notes)}</textarea>
      </div>

      <div class="form-group">
        <label>${escapeHtml(t("upload_receipt") || "Last opp bilag")} (PDF/JPG/PNG, max 10 MB)</label>
        <input type="file" id="sb-bilag-file" accept="application/pdf,image/jpeg,image/png" class="form-control">
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
  agentUserId: string;
  agentName: string;
  hallName: string;
  businessDate: string;
  /** Kalles etter vellykket close-day med resultatet. */
  onSubmitted?: (payload: { settlementId: string }) => void;
}

export function openSettlementBreakdownModal(opts: SettlementBreakdownModalOptions): void {
  const state = emptyState({
    agentUserId: opts.agentUserId,
    agentName: opts.agentName,
    hallName: opts.hallName,
    businessDate: opts.businessDate,
  });

  const container = document.createElement("div");
  container.innerHTML = renderModalBody(state);

  const instance = Modal.open({
    title: t("settlement") || "Oppgjør",
    content: container,
    backdrop: "static",
    keyboard: false,
    size: "xl",
    className: "modal-settlement-breakdown",
    buttons: [
      {
        label: t("cancel") || "Avbryt",
        variant: "default",
        action: "cancel",
      },
      {
        label: t("submit") || "Submit",
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
      },
    ],
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

    // Calculation-felter
    if (target.id === "sb-ending") {
      const n = Number(target.value);
      if (Number.isFinite(n) && n >= 0) state.endingOpptallKassieOre = nokToOre(n);
      return;
    }
    if (target.id === "sb-drop") {
      const n = Number(target.value);
      if (Number.isFinite(n) && n >= 0) state.innskuddDropSafeOre = nokToOre(n);
      return;
    }
    if (target.id === "sb-diff") {
      const n = Number(target.value);
      if (Number.isFinite(n)) state.differenceInShiftsOre = nokToOre(n);
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
      state.receipt = {
        mime,
        filename: file.name,
        dataUrl,
        sizeBytes: file.size,
        uploadedAt: new Date().toISOString(),
        uploadedByUserId: state.agentUserId,
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
