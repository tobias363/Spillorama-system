/**
 * BIN-GAP#4 — Register Sold Tickets modal.
 *
 * Spec: docs/architecture/WIREFRAME_CATALOG.md § "15.2 Register Sold Tickets"
 *       docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf skjerm 17.15
 *
 * UI-flyt:
 *   1. Agent åpner modalen med et pre-valgt gameId (eller dropdown hvis flere
 *      pågående spill).
 *   2. Tabell med 11 rader — én per ticket-type (11-color-palette etter PR #639).
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
 *
 * Hotkeys (legacy paritet — wireframe §17.13/17.15):
 *   - F1   : Submit modal
 *   - F2   : Åpne Register More Tickets-popup
 *   - Enter: I final-input → flytt fokus til neste rad (eller submit)
 *   - Esc  : Avbryt/lukk modal
 */

import { Modal, type ModalInstance } from "../../../components/Modal.js";
import { Toast } from "../../../components/Toast.js";
import { ApiError } from "../../../api/client.js";
import { t } from "../../../i18n/I18n.js";
import {
  agentGetInitialIds,
  agentRecordFinalIds,
  agentEditTicketRange,
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
  /**
   * REQ-091 — ID på eksisterende rad. Når satt, kan agenten redigere
   * `initialId` (og `finalId`) på en allerede registrert range mellom
   * runder via PUT /api/agent/ticket-ranges/:rangeId. Når null, bruker
   * modalen den vanlige recordFinalIds-flyten (carry-forward initial,
   * final må scannes/tastes).
   */
  existingRangeId: string | null;
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
    onClose: () => {
      // Avregistrer hotkey-handler så vi ikke lekker listeners.
      document.removeEventListener("keydown", hotkeyHandler);
    },
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

  // Hotkeys: F1 (submit), F2 (åpne Register More), Esc (cancel). Enter er
  // per-input (se renderTable). Modal-en kjører `keyboard: false`, så Esc må
  // håndteres eksplisitt her.
  const hotkeyHandler = (e: KeyboardEvent): void => {
    if (!body.isConnected) return;
    if (e.key === "F1") {
      e.preventDefault();
      void submitRows();
      return;
    }
    if (e.key === "F2") {
      e.preventDefault();
      // Lazy import for å unngå sirkulær avhengighet ved test-load.
      void import("./RegisterMoreTicketsModal.js").then((mod) => {
        mod.openRegisterMoreTicketsModal({
          gameId: opts.gameId,
          gameName: opts.gameName,
          hallId: opts.hallId,
          // Etter Register More — refresh så modalen viser nye ranges.
          onSuccess: () => void loadInitialIds(),
        });
      });
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      instance.close("keyboard");
      return;
    }
  };
  document.addEventListener("keydown", hotkeyHandler);

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
        existingRangeId: e?.existingRange?.id ?? null,
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
      initialCell.setAttribute("data-marker", `initial-${row.ticketType}`);
      if (row.existingRangeId !== null) {
        // REQ-091: eksisterende rad → tillat inline-edit av initialId.
        initialCell.classList.add("ticket-range-editable");
        const initialInput = document.createElement("input");
        initialInput.type = "number";
        initialInput.className = "form-control input-sm";
        initialInput.min = "0";
        initialInput.value = String(row.initialId);
        initialInput.setAttribute("data-marker", `initial-input-${row.ticketType}`);
        initialInput.addEventListener("input", () => {
          const v = initialInput.value.trim();
          if (!v) return;
          const n = Number(v);
          if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) {
            row.initialId = n;
            // Min-attribute på final-input må følge med
            const finalInput = rowInputs.get(row.ticketType);
            if (finalInput) finalInput.min = String(n);
            updateSoldCell(row);
          }
        });
        initialCell.append(initialInput);
        if (row.carriedFromGameId) {
          initialCell.title = `Carry-forward fra ${row.carriedFromGameId}`;
        }
      } else {
        // Ny rad → initialId er read-only fra carry-forward.
        initialCell.classList.add("text-muted");
        initialCell.textContent = String(row.initialId);
        if (row.carriedFromGameId) {
          initialCell.title = `Carry-forward fra ${row.carriedFromGameId}`;
        }
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
      finalInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          // Hopp til neste rads final-input, eller submit ved siste rad.
          const idx = rowStates.findIndex((r) => r.ticketType === row.ticketType);
          const next = rowStates
            .slice(idx + 1)
            .map((r) => rowInputs.get(r.ticketType))
            .find((inp): inp is HTMLInputElement => Boolean(inp));
          if (next) {
            next.focus();
            next.select();
          } else {
            // Siste rad → submit-knappen.
            const submitBtn = instance.root.querySelector<HTMLButtonElement>(
              '[data-action="submit"]',
            );
            submitBtn?.focus();
          }
        }
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

    // REQ-091: rader som har eksisterende range-ID må gå via PUT
    // /api/agent/ticket-ranges/:rangeId fordi `recordFinalIds` ikke
    // tillater å endre `initialId`. Vi splitter listen i to.
    const editableRows = filled.filter((r) => r.existingRangeId !== null);
    const newRows = filled.filter((r) => r.existingRangeId === null);

    try {
      // 1. PUT for hver eksisterende rad (sekvensielt — backend audit-log
      //    sporer hver endring separat).
      for (const row of editableRows) {
        await agentEditTicketRange(row.existingRangeId!, {
          gameId: opts.gameId,
          initialId: row.initialId,
          finalId: row.finalId!,
          hallId: opts.hallId,
        });
      }

      // 2. POST recordFinalIds for nye rader (carry-forward initial er
      //    backend-bestemt; klienten sender kun final).
      let totalSoldCount = editableRows.reduce(
        (s, r) => s + (r.finalId! - r.initialId + 1),
        0,
      );
      let hallReadyStatus: { isReady: boolean; error?: string } | null = null;
      if (newRows.length > 0) {
        const perTypeFinalIds: Partial<Record<TicketType, number>> = {};
        for (const row of newRows) {
          perTypeFinalIds[row.ticketType] = row.finalId!;
        }
        const res = await agentRecordFinalIds(opts.gameId, {
          perTypeFinalIds,
          hallId: opts.hallId,
        });
        totalSoldCount += res.totalSoldCount;
        hallReadyStatus = res.hallReadyStatus;
      }

      // Success feedback
      const readyMsg = hallReadyStatus?.isReady
        ? ` — ${t("register_sold_tickets_hall_ready")}`
        : hallReadyStatus?.error
          ? ` — ${t("register_sold_tickets_hall_ready_error")}: ${hallReadyStatus.error}`
          : "";
      Toast.success(
        `${t("register_sold_tickets_success")} ${totalSoldCount}${readyMsg}`,
      );

      opts.onSuccess?.({
        totalSoldCount,
        hallReadyStatus,
      });
      instance.close("programmatic");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
    }
  }

  return instance;
}
