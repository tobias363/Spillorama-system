/**
 * BIN-GAP#4 — Register Sold Tickets modal.
 *
 * Spec: docs/architecture/WIREFRAME_CATALOG.md § "15.2 Register Sold Tickets"
 *       docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf skjerm 17.15
 *
 * UI-flyt:
 *   1. Agent åpner modalen med et pre-valgt gameId (eller dropdown hvis flere
 *      pågående spill).
 *   2. Tabell med 6 rader — én per ticket-type (Small Yellow, Small White,
 *      Large Yellow, Large White, Small Purple, Large Purple).
 *   3. Per rad:
 *       - Initial ID (auto-fylt fra backend via carry-forward, read-only)
 *       - Final ID (input — agent scanner barcoden eller taster inn)
 *       - Tickets Sold (auto-beregnet = final - initial + 1)
 *       - Scan-knapp (optional barcode-scanner-integrasjon)
 *   4. Submit: POST final-ids, trigger markReady. Cancel: lukker modalen.
 *
 * Validering:
 *   - Final >= Initial
 *   - Final må være tall
 *   - Minst én rad må ha Final ID satt før submit tillates.
 */

import { Modal, type ModalInstance } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import { t } from "../../../i18n/I18n.js";
import {
  agentGetInitialIds,
  agentRecordFinalIds,
  TICKET_TYPES,
  TICKET_TYPE_LABELS,
  type InitialIdEntry,
  type TicketType,
} from "../../../api/agent-ticket-registration.js";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export interface RegisterSoldTicketsModalOptions {
  /** Forhåndsvalgt spill-ID. */
  gameId: string;
  /** Visnings-navn på spillet (vises i modalens header). */
  gameName?: string;
  /** ADMIN må oppgi hallId eksplisitt. */
  hallId?: string;
  /** Kalles etter vellykket submit. */
  onSuccess?: (result: {
    totalSoldCount: number;
    hallReadyStatus: { isReady: boolean; error?: string } | null;
  }) => void;
}

interface RowState {
  ticketType: TicketType;
  initialId: number;
  roundNumber: number;
  carriedFromGameId: string | null;
  /** Finaler som brukeren har tastet inn. null = ikke satt. */
  finalId: number | null;
  /** Eksisterende registrering hvis modalen åpnes igjen. */
  existingFinalId: number | null;
}

/**
 * Åpner modalen. Henter initial-IDs asynkront og rendrer tabellen når data
 * kommer inn. Brukes med await i tester.
 */
export function openRegisterSoldTicketsModal(
  opts: RegisterSoldTicketsModalOptions,
): ModalInstance {
  const body = document.createElement("div");
  body.setAttribute("data-marker", "register-sold-tickets-modal");
  body.innerHTML = `
    <div class="register-sold-tickets-loading" data-marker="loading">
      <p><i class="fa fa-spinner fa-spin" aria-hidden="true"></i> ${escapeHtml(t("loading"))}</p>
    </div>
  `;

  const title = opts.gameName
    ? `${t("register_sold_tickets_title")} — ${opts.gameName}`
    : t("register_sold_tickets_title");

  const instance = Modal.open({
    title,
    content: body,
    size: "lg",
    backdrop: "static",
    keyboard: false,
    buttons: [
      {
        label: t("cancel_button"),
        variant: "default",
        action: "cancel",
      },
      {
        label: t("submit"),
        variant: "primary",
        action: "submit",
        dismiss: false,
        onClick: () => submitRows(),
      },
    ],
  });

  let rowStates: RowState[] = [];
  const rowInputs = new Map<TicketType, HTMLInputElement>();
  const rowSoldCells = new Map<TicketType, HTMLElement>();

  void loadInitialIds();

  async function loadInitialIds(): Promise<void> {
    try {
      const res = await agentGetInitialIds(opts.gameId, {
        hallId: opts.hallId,
      });
      rowStates = buildRowStates(res.entries);
      renderTable();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      body.innerHTML = `
        <div class="alert alert-danger" data-marker="error">
          <strong>${escapeHtml(t("error"))}</strong>: ${escapeHtml(msg)}
        </div>
      `;
    }
  }

  function buildRowStates(entries: InitialIdEntry[]): RowState[] {
    // Sikre stabil rekkefølge (TICKET_TYPES-ordrene).
    const byType = new Map<TicketType, InitialIdEntry>();
    for (const e of entries) byType.set(e.ticketType, e);
    return TICKET_TYPES.map((type) => {
      const e = byType.get(type);
      return {
        ticketType: type,
        initialId: e?.initialId ?? 1,
        roundNumber: e?.roundNumber ?? 1,
        carriedFromGameId: e?.carriedFromGameId ?? null,
        finalId: e?.existingRange?.finalId ?? null,
        existingFinalId: e?.existingRange?.finalId ?? null,
      };
    });
  }

  function renderTable(): void {
    body.innerHTML = "";
    rowInputs.clear();
    rowSoldCells.clear();

    const table = document.createElement("table");
    table.className = "table table-striped table-bordered";
    table.setAttribute("data-marker", "register-sold-tickets-table");
    table.innerHTML = `
      <thead>
        <tr>
          <th>${escapeHtml(t("ticket_type"))}</th>
          <th>${escapeHtml(t("register_sold_tickets_initial_id"))}</th>
          <th>${escapeHtml(t("register_sold_tickets_final_id"))}</th>
          <th>${escapeHtml(t("register_sold_tickets_tickets_sold"))}</th>
          <th style="width:80px;"></th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody")!;

    for (const row of rowStates) {
      const tr = document.createElement("tr");
      tr.setAttribute("data-ticket-type", row.ticketType);

      const typeCell = document.createElement("td");
      typeCell.textContent = TICKET_TYPE_LABELS[row.ticketType];
      typeCell.setAttribute("data-marker", `label-${row.ticketType}`);

      const initialCell = document.createElement("td");
      initialCell.className = "text-muted";
      initialCell.setAttribute("data-marker", `initial-${row.ticketType}`);
      initialCell.textContent = String(row.initialId);
      if (row.carriedFromGameId) {
        initialCell.title = `Carry-forward fra ${row.carriedFromGameId}`;
      }

      const finalCell = document.createElement("td");
      const finalInput = document.createElement("input");
      finalInput.type = "number";
      finalInput.className = "form-control input-sm";
      finalInput.min = String(row.initialId);
      finalInput.setAttribute("data-marker", `final-input-${row.ticketType}`);
      finalInput.value = row.finalId == null ? "" : String(row.finalId);
      finalInput.addEventListener("input", () => {
        const v = finalInput.value.trim();
        if (!v) {
          row.finalId = null;
        } else {
          const n = Number(v);
          row.finalId = Number.isFinite(n) && Number.isInteger(n) ? n : null;
        }
        updateSoldCell(row);
      });
      finalCell.append(finalInput);
      rowInputs.set(row.ticketType, finalInput);

      const soldCell = document.createElement("td");
      soldCell.setAttribute("data-marker", `sold-${row.ticketType}`);
      rowSoldCells.set(row.ticketType, soldCell);

      const scanCell = document.createElement("td");
      const scanBtn = document.createElement("button");
      scanBtn.type = "button";
      scanBtn.className = "btn btn-xs btn-default";
      scanBtn.innerHTML = `<i class="fa fa-barcode" aria-hidden="true"></i> ${escapeHtml(t("scan"))}`;
      scanBtn.setAttribute("data-marker", `scan-btn-${row.ticketType}`);
      scanBtn.addEventListener("click", () => openScanForRow(row));
      scanCell.append(scanBtn);

      tr.append(typeCell, initialCell, finalCell, soldCell, scanCell);
      tbody.append(tr);

      updateSoldCell(row);
    }

    body.append(table);

    // Legg til en total-sum-rad under
    const totalWrap = document.createElement("div");
    totalWrap.className = "text-right";
    totalWrap.setAttribute("data-marker", "total-sold");
    totalWrap.innerHTML = `<strong>${escapeHtml(t("register_sold_tickets_total_sold"))}:</strong> <span data-marker="total-sold-value">0</span>`;
    body.append(totalWrap);

    updateTotal();
  }

  function updateSoldCell(row: RowState): void {
    const cell = rowSoldCells.get(row.ticketType);
    if (!cell) return;
    if (row.finalId == null) {
      cell.textContent = "—";
      cell.classList.remove("text-danger", "text-success");
    } else if (row.finalId < row.initialId) {
      cell.textContent = t("register_sold_tickets_invalid_range");
      cell.classList.add("text-danger");
      cell.classList.remove("text-success");
    } else {
      const sold = row.finalId - row.initialId + 1;
      cell.textContent = String(sold);
      cell.classList.remove("text-danger");
      cell.classList.add("text-success");
    }
    updateTotal();
  }

  function updateTotal(): void {
    let total = 0;
    for (const row of rowStates) {
      if (row.finalId != null && row.finalId >= row.initialId) {
        total += row.finalId - row.initialId + 1;
      }
    }
    const el = body.querySelector<HTMLElement>('[data-marker="total-sold-value"]');
    if (el) el.textContent = String(total);
  }

  function openScanForRow(row: RowState): void {
    // Pilot: prompt-basert. Senere: Bluetooth HID barcode-scanner-integrasjon
    // (se apps/admin-web/src/components/BarcodeScanner.ts for bass-pattern).
    const scanned = window.prompt(
      `${TICKET_TYPE_LABELS[row.ticketType]} — ${t("register_sold_tickets_scan_prompt")}`,
    );
    if (scanned == null) return;
    const v = scanned.trim();
    if (!v) return;
    // Tolerér både rå barcode og numeriske IDs — enkleste portabelt:
    // ta siste numeriske segment fra strengen.
    const numericMatch = v.match(/(\d+)$/);
    if (!numericMatch) {
      Toast.error(t("register_sold_tickets_scan_not_numeric"));
      return;
    }
    const n = Number(numericMatch[1]);
    const input = rowInputs.get(row.ticketType);
    if (!input) return;
    input.value = String(n);
    row.finalId = n;
    updateSoldCell(row);
  }

  async function submitRows(): Promise<void> {
    // Plukk ut rows som har finalId satt.
    const filled = rowStates.filter((r) => r.finalId != null);
    if (filled.length === 0) {
      Toast.error(t("register_sold_tickets_none_filled"));
      return;
    }

    // Validering før submit: final >= initial.
    for (const row of filled) {
      if (row.finalId! < row.initialId) {
        Toast.error(
          `${TICKET_TYPE_LABELS[row.ticketType]}: ${t("register_sold_tickets_invalid_range")}`,
        );
        return;
      }
    }

    const perTypeFinalIds: Partial<Record<TicketType, number>> = {};
    for (const row of filled) {
      perTypeFinalIds[row.ticketType] = row.finalId!;
    }

    try {
      const res = await agentRecordFinalIds(opts.gameId, {
        perTypeFinalIds,
        hallId: opts.hallId,
      });

      // Success feedback
      const readyMsg = res.hallReadyStatus?.isReady
        ? ` — ${t("register_sold_tickets_hall_ready")}`
        : res.hallReadyStatus?.error
          ? ` — ${t("register_sold_tickets_hall_ready_error")}: ${res.hallReadyStatus.error}`
          : "";
      Toast.success(
        `${t("register_sold_tickets_success")} ${res.totalSoldCount}${readyMsg}`,
      );

      opts.onSuccess?.({
        totalSoldCount: res.totalSoldCount,
        hallReadyStatus: res.hallReadyStatus,
      });
      instance.close("programmatic");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
    }
  }

  return instance;
}
