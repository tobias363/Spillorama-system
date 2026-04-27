/**
 * Register More Tickets-modal — wireframe §17.13.
 *
 * Spec: docs/architecture/WIREFRAME_CATALOG.md § "15.10 Register More Tickets Modal"
 *       docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf skjerm 17.13
 *
 * Forskjell fra RegisterSoldTicketsModal (§17.15):
 *   - §17.15 ("Register Sold") = registrér final_id for å markere hvor mange
 *     som er solgt før neste runde starter. Initial er låst (carry-forward).
 *   - §17.13 ("Register More") = utvid eller endre billett-inventaret. Begge
 *     Initial og Final kan endres. Brukes når agenten har skannet inn flere
 *     bonge-stacker eller skal justere et eksisterende område. Tickets Sold-
 *     kolonnen vises som info — read-only.
 *
 * UI-flyt:
 *   1. Modal åpner som RegisterSold men med BÅDE Initial og Final som inputs.
 *   2. Agent justerer Initial+Final per type, eller scanner inn nye verdier.
 *   3. Submit:
 *        - For rader med eksisterende rangeId  → PUT /api/agent/ticket-ranges/:id
 *        - For NYE rader (ingen rangeId)        → POST recordFinalIds
 *   4. Carry-forward respekteres for nye rader (initialId fra getInitialIds).
 *
 * Hotkeys (legacy paritet — wireframe §17.13):
 *   - F1   : Submit modal
 *   - Enter: Flytt fokus til neste input
 *   - Esc  : Avbryt/lukk modal
 *
 * Validering:
 *   - Final >= Initial når begge er satt
 *   - Begge må være ikke-negative heltall
 *   - Minst én rad må endres (final eller initial != opprinnelig) før submit.
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

export interface RegisterMoreTicketsModalOptions {
  gameId: string;
  gameName?: string;
  hallId?: string;
  onSuccess?: (result: { totalUpdated: number }) => void;
}

interface RowState {
  ticketType: TicketType;
  originalInitialId: number;
  originalFinalId: number | null;
  initialId: number;
  finalId: number | null;
  existingRangeId: string | null;
  soldCount: number;
  carriedFromGameId: string | null;
}

export function openRegisterMoreTicketsModal(
  opts: RegisterMoreTicketsModalOptions,
): ModalInstance {
  const body = document.createElement("div");
  body.setAttribute("data-marker", "register-more-tickets-modal");
  body.innerHTML = `
    <div class="register-more-tickets-loading" data-marker="loading">
      <p><i class="fa fa-spinner fa-spin" aria-hidden="true"></i> ${escapeHtml(t("loading"))}</p>
    </div>
  `;

  const title = opts.gameName
    ? `${t("register_more_tickets")} — ${opts.gameName}`
    : t("register_more_tickets");

  const instance = Modal.open({
    title,
    content: body,
    size: "lg",
    backdrop: "static",
    keyboard: false,
    onClose: () => {
      document.removeEventListener("keydown", hotkeyHandler);
    },
    buttons: [
      { label: t("cancel_button"), variant: "default", action: "cancel" },
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
  const initialInputs = new Map<TicketType, HTMLInputElement>();
  const finalInputs = new Map<TicketType, HTMLInputElement>();

  const hotkeyHandler = (e: KeyboardEvent): void => {
    if (!body.isConnected) return;
    if (e.key === "F1") {
      e.preventDefault();
      void submitRows();
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
      const res = await agentGetInitialIds(opts.gameId, { hallId: opts.hallId });
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
    const byType = new Map<TicketType, InitialIdEntry>();
    for (const e of entries) byType.set(e.ticketType, e);
    return TICKET_TYPES.map((type) => {
      const e = byType.get(type);
      const initialId = e?.initialId ?? 1;
      const existingFinal = e?.existingRange?.finalId ?? null;
      const soldCount = e?.existingRange?.soldCount ?? 0;
      return {
        ticketType: type,
        originalInitialId: initialId,
        originalFinalId: existingFinal,
        initialId,
        finalId: existingFinal,
        existingRangeId: e?.existingRange?.id ?? null,
        soldCount,
        carriedFromGameId: e?.carriedFromGameId ?? null,
      };
    });
  }

  function renderTable(): void {
    body.innerHTML = "";
    initialInputs.clear();
    finalInputs.clear();

    const intro = document.createElement("p");
    intro.className = "text-muted";
    intro.setAttribute("data-marker", "register-more-intro");
    intro.textContent = t("register_more_tickets_intro");
    body.append(intro);

    const table = document.createElement("table");
    table.className = "table table-striped table-bordered";
    table.setAttribute("data-marker", "register-more-tickets-table");
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
      initialCell.setAttribute("data-marker", `initial-cell-${row.ticketType}`);
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
          const finalInput = finalInputs.get(row.ticketType);
          if (finalInput) finalInput.min = String(n);
        }
      });
      initialInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const finalInp = finalInputs.get(row.ticketType);
          finalInp?.focus();
          finalInp?.select();
        }
      });
      initialCell.append(initialInput);
      if (row.carriedFromGameId) {
        initialCell.title = `Carry-forward fra ${row.carriedFromGameId}`;
      }
      initialInputs.set(row.ticketType, initialInput);

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
      });
      finalInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const idx = rowStates.findIndex((r) => r.ticketType === row.ticketType);
          const next = rowStates
            .slice(idx + 1)
            .map((r) => initialInputs.get(r.ticketType))
            .find((inp): inp is HTMLInputElement => Boolean(inp));
          if (next) {
            next.focus();
            next.select();
          } else {
            const submitBtn = instance.root.querySelector<HTMLButtonElement>(
              '[data-action="submit"]',
            );
            submitBtn?.focus();
          }
        }
      });
      finalCell.append(finalInput);
      finalInputs.set(row.ticketType, finalInput);

      const soldCell = document.createElement("td");
      soldCell.setAttribute("data-marker", `sold-${row.ticketType}`);
      soldCell.textContent = String(row.soldCount);
      soldCell.classList.add("text-muted");

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
    }

    body.append(table);
  }

  function openScanForRow(row: RowState): void {
    const scanned = window.prompt(
      `${TICKET_TYPE_LABELS[row.ticketType]} — ${t("register_sold_tickets_scan_prompt")}`,
    );
    if (scanned == null) return;
    const v = scanned.trim();
    if (!v) return;
    const numericMatch = v.match(/(\d+)$/);
    if (!numericMatch) {
      Toast.error(t("register_sold_tickets_scan_not_numeric"));
      return;
    }
    const n = Number(numericMatch[1]);
    const input = finalInputs.get(row.ticketType);
    if (!input) return;
    input.value = String(n);
    row.finalId = n;
  }

  async function submitRows(): Promise<void> {
    const changed = rowStates.filter(
      (r) => r.initialId !== r.originalInitialId || r.finalId !== r.originalFinalId,
    );
    if (changed.length === 0) {
      Toast.error(t("register_more_tickets_no_changes"));
      return;
    }
    for (const row of changed) {
      if (row.finalId == null) {
        Toast.error(
          `${TICKET_TYPE_LABELS[row.ticketType]}: ${t("register_more_tickets_final_required")}`,
        );
        return;
      }
      if (row.finalId < row.initialId) {
        Toast.error(
          `${TICKET_TYPE_LABELS[row.ticketType]}: ${t("register_sold_tickets_invalid_range")}`,
        );
        return;
      }
    }
    const editableRows = changed.filter((r) => r.existingRangeId !== null);
    const newRows = changed.filter((r) => r.existingRangeId === null);
    try {
      let totalUpdated = 0;
      for (const row of editableRows) {
        await agentEditTicketRange(row.existingRangeId!, {
          gameId: opts.gameId,
          initialId: row.initialId,
          finalId: row.finalId!,
          hallId: opts.hallId,
        });
        totalUpdated += 1;
      }
      if (newRows.length > 0) {
        const perTypeFinalIds: Partial<Record<TicketType, number>> = {};
        for (const row of newRows) {
          perTypeFinalIds[row.ticketType] = row.finalId!;
        }
        await agentRecordFinalIds(opts.gameId, {
          perTypeFinalIds,
          hallId: opts.hallId,
        });
        totalUpdated += newRows.length;
      }
      Toast.success(`${t("register_more_tickets_success")} ${totalUpdated}`);
      opts.onSuccess?.({ totalUpdated });
      instance.close("programmatic");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
    }
  }

  return instance;
}
