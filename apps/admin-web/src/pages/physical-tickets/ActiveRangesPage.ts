// PR-PT6 — Oversikt over aktive ranges (PT2/PT3/PT5).
//
// Tabell per åpne agent_ticket_range med fire action-knapper per rad:
//   1. "Registrer salg"  → PT3 recordBatchSale (new top-serial)
//   2. "Overfør vakt"    → PT5 handoverRange (til annen bruker)
//   3. "Utvid range"     → PT5 extendRange (add N nye bonger)
//   4. "Lukk range"      → PT2 closeRange (bekreftelsesdialog)
//
// HALL_OPERATOR ser kun ranges i egen hall (backend enforcer + UI filtrerer
// i tillegg). ADMIN ser alle.

import { t } from "../../i18n/I18n.js";
import { getSession } from "../../auth/Session.js";
import { Modal } from "../../components/Modal.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import {
  listAgentTicketRanges,
  recordBatchSale,
  handoverAgentTicketRange,
  extendAgentTicketRange,
  closeAgentTicketRange,
  type AgentTicketRangeRow,
} from "../../api/admin-physical-tickets.js";
import { listHalls, type AdminHall } from "../../api/dashboard.js";
import { ApiError } from "../../api/client.js";
import { mapPhysicalTicketErrorMessage } from "./errorMap.js";
import { boxClose, boxOpen, contentHeader, escapeHtml } from "./shared.js";

interface PageState {
  ranges: AgentTicketRangeRow[];
  hallId: string | null;
  halls: AdminHall[];
  loading: boolean;
}

export function renderActiveRangesPage(container: HTMLElement): void {
  const session = getSession();
  const isAdmin = session?.role === "admin" || session?.role === "super-admin";
  const operatorHallId = !isAdmin ? session?.hall?.[0]?.id ?? null : null;

  const state: PageState = {
    ranges: [],
    hallId: operatorHallId,
    halls: [],
    loading: false,
  };

  container.innerHTML = `
    ${contentHeader("pt_active_ranges_title")}
    <section class="content">
      ${boxOpen("pt_active_ranges_title", "primary")}
        <div class="row" style="margin-bottom:12px;">
          <div class="col-sm-4" id="ar-hall-row" style="display:${isAdmin ? "block" : "none"};">
            <label class="control-label" for="ar-hall">${escapeHtml(t("select_hall"))}</label>
            <select id="ar-hall" class="form-control">
              <option value="">${escapeHtml(t("select_hall_name"))}</option>
            </select>
          </div>
        </div>
        <div id="ar-toolbar" style="margin-bottom:10px;">
          <button type="button" class="btn btn-default btn-sm" id="ar-refresh" data-action="refresh">
            <i class="fa fa-refresh" aria-hidden="true"></i> ${escapeHtml(t("refresh"))}
          </button>
        </div>
        <div id="ar-table" aria-live="polite">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const hallSelect = container.querySelector<HTMLSelectElement>("#ar-hall");
  const tableHost = container.querySelector<HTMLElement>("#ar-table")!;
  const refreshBtn = container.querySelector<HTMLButtonElement>("#ar-refresh")!;

  async function refresh(): Promise<void> {
    // ADMIN må velge hall — backend krever agentId ELLER hallId.
    // HALL_OPERATOR har auto-scope via session.hall[0].id (operatorHallId).
    if (!state.hallId) {
      tableHost.innerHTML = `<div class="callout callout-info" style="margin:0;">${escapeHtml(t("hall_scope_required"))}</div>`;
      state.ranges = [];
      return;
    }
    state.loading = true;
    tableHost.textContent = t("loading_ellipsis");
    try {
      const res = await listAgentTicketRanges({ hallId: state.hallId });
      state.ranges = res.ranges;
      renderTable();
    } catch (err) {
      const msg = mapPhysicalTicketErrorMessage(err);
      Toast.error(msg);
      tableHost.innerHTML = `<div class="callout callout-danger" style="margin:0;">${escapeHtml(msg)}</div>`;
    } finally {
      state.loading = false;
    }
  }

  function renderTable(): void {
    if (state.ranges.length === 0) {
      tableHost.innerHTML = `<div class="callout callout-info" style="margin:0;">${escapeHtml(t("pt_no_active_ranges"))}</div>`;
      return;
    }
    DataTable.mount<AgentTicketRangeRow>(tableHost, {
      columns: [
        {
          key: "id",
          title: t("pt_range_id"),
          render: (r) => {
            const span = document.createElement("code");
            span.textContent = r.id.slice(0, 8);
            span.title = r.id;
            return span;
          },
        },
        { key: "agentId", title: t("pt_agent") },
        {
          key: "ticketColor",
          title: t("pt_ticket_color"),
          render: (r) => escapeHtml(t(colorKey(r.ticketColor))),
        },
        { key: "initialSerial", title: t("pt_range_top_serial"), align: "right" },
        {
          key: "currentTopSerial",
          title: t("pt_range_current_top"),
          align: "right",
          render: (r) => r.currentTopSerial ?? "—",
        },
        { key: "finalSerial", title: t("pt_range_final_serial"), align: "right" },
        {
          key: "closedAt",
          title: t("pt_range_sale_status"),
          render: (r) =>
            r.closedAt
              ? escapeHtml(t("pt_range_status_closed"))
              : `<span style="color:#2e7d32;">${escapeHtml(t("pt_range_status_open"))}</span>`,
        },
        {
          key: "registeredAt",
          title: t("action"),
          align: "center",
          render: (r) => renderActionCell(r),
        },
      ],
      rows: state.ranges,
      emptyMessage: t("pt_no_active_ranges"),
    });
  }

  function renderActionCell(r: AgentTicketRangeRow): Node {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:inline-flex;gap:4px;flex-wrap:wrap;";
    const isClosed = Boolean(r.closedAt);
    const mk = (
      action: string,
      labelKey: string,
      variant: string,
      icon: string,
    ): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `btn btn-${variant} btn-xs`;
      b.innerHTML = `<i class="fa fa-${icon}" aria-hidden="true"></i> ${escapeHtml(t(labelKey))}`;
      b.setAttribute("data-action", action);
      b.setAttribute("data-id", r.id);
      if (isClosed) b.disabled = true;
      return b;
    };
    wrap.append(
      mk("sale", "pt_action_record_sale", "success", "shopping-cart"),
      mk("handover", "pt_action_handover", "info", "exchange"),
      mk("extend", "pt_action_extend", "primary", "plus"),
      mk("close", "pt_action_close", "danger", "times"),
    );
    return wrap;
  }

  tableHost.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    if (!id) return;
    const action = btn.getAttribute("data-action");
    const range = state.ranges.find((r) => r.id === id);
    if (!range) return;
    if (action === "sale") openRecordSaleModal(range, refresh);
    else if (action === "handover") openHandoverModal(range, refresh);
    else if (action === "extend") openExtendModal(range, refresh);
    else if (action === "close") openCloseModal(range, refresh);
  });

  refreshBtn.addEventListener("click", () => void refresh());

  if (hallSelect) {
    hallSelect.addEventListener("change", () => {
      state.hallId = hallSelect.value || null;
      void refresh();
    });
  }

  void (async () => {
    if (isAdmin && hallSelect) {
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
    }
    await refresh();
  })();
}

function colorKey(color: AgentTicketRangeRow["ticketColor"]): string {
  if (color === "small") return "pt_color_small";
  if (color === "large") return "pt_color_large";
  return "pt_color_traffic_light";
}

function openRecordSaleModal(
  range: AgentTicketRangeRow,
  onDone: () => Promise<void> | void,
): void {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <p>${escapeHtml(t("pt_record_sale_desc"))}</p>
    <div class="form-group">
      <label>${escapeHtml(t("pt_range_top_serial"))}</label>
      <div class="form-control" style="background:#f5f5f5;">${escapeHtml(range.currentTopSerial ?? "—")}</div>
    </div>
    <div class="form-group">
      <label for="bs-newTop">${escapeHtml(t("pt_record_sale_new_top"))}</label>
      <input id="bs-newTop" class="form-control" type="text" autocomplete="off" inputmode="numeric" required>
      <p class="help-block" style="font-size:12px;margin-top:4px;">${escapeHtml(t("pt_record_sale_new_top_hint"))}</p>
    </div>
    <div class="form-group">
      <label for="bs-gameId">${escapeHtml(t("pt_record_sale_scheduled_game"))} (${escapeHtml(t("optional"))})</label>
      <input id="bs-gameId" class="form-control" type="text" autocomplete="off" placeholder="${escapeHtml(t("pt_record_sale_scheduled_game_hint"))}">
    </div>`;

  Modal.open({
    title: t("pt_action_record_sale"),
    content: wrap,
    buttons: [
      { label: t("cancel_button"), variant: "default", action: "cancel" },
      {
        label: t("submit"),
        variant: "success",
        action: "confirm",
        onClick: async (instance) => {
          const newTopSerial = (wrap.querySelector<HTMLInputElement>("#bs-newTop")!.value || "").trim();
          const scheduledGameId = (wrap.querySelector<HTMLInputElement>("#bs-gameId")!.value || "").trim() || undefined;
          if (!newTopSerial) {
            Toast.error(t("pt_err_new_top_required"));
            return;
          }
          try {
            const res = await recordBatchSale(range.id, {
              newTopSerial,
              scheduledGameId,
            });
            Toast.success(
              t("pt_record_sale_success", {
                count: res.soldCount,
                gameId: res.scheduledGameId,
              }),
            );
            await onDone();
            instance.close("programmatic");
          } catch (err) {
            Toast.error(mapPhysicalTicketErrorMessage(err));
          }
        },
      },
    ],
  });
}

function openHandoverModal(
  range: AgentTicketRangeRow,
  onDone: () => Promise<void> | void,
): void {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <p><strong>${escapeHtml(t("pt_handover_warning"))}</strong></p>
    <p>${escapeHtml(t("pt_handover_desc"))}</p>
    <div class="form-group">
      <label for="ho-toUserId">${escapeHtml(t("pt_handover_to_user_id"))}</label>
      <input id="ho-toUserId" class="form-control" type="text" autocomplete="off" required
        placeholder="${escapeHtml(t("pt_handover_to_user_id_hint"))}">
    </div>`;
  Modal.open({
    title: t("pt_action_handover"),
    content: wrap,
    backdrop: "static",
    keyboard: false,
    buttons: [
      { label: t("cancel_button"), variant: "default", action: "cancel" },
      {
        label: t("pt_confirm_handover"),
        variant: "warning",
        action: "confirm",
        onClick: async (instance) => {
          const toUserId = (wrap.querySelector<HTMLInputElement>("#ho-toUserId")!.value || "").trim();
          if (!toUserId) {
            Toast.error(t("pt_err_to_user_required"));
            return;
          }
          try {
            const res = await handoverAgentTicketRange(range.id, { toUserId });
            Toast.success(
              t("pt_handover_success", {
                unsold: res.unsoldCount,
                pending: res.soldPendingCount,
              }),
            );
            await onDone();
            instance.close("programmatic");
          } catch (err) {
            Toast.error(mapPhysicalTicketErrorMessage(err));
          }
        },
      },
    ],
  });
}

function openExtendModal(
  range: AgentTicketRangeRow,
  onDone: () => Promise<void> | void,
): void {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <p>${escapeHtml(t("pt_extend_desc"))}</p>
    <div class="form-group">
      <label for="ex-count">${escapeHtml(t("pt_extend_additional_count"))}</label>
      <input id="ex-count" class="form-control" type="number" min="1" max="5000" value="10" required>
    </div>`;
  Modal.open({
    title: t("pt_action_extend"),
    content: wrap,
    buttons: [
      { label: t("cancel_button"), variant: "default", action: "cancel" },
      {
        label: t("submit"),
        variant: "primary",
        action: "confirm",
        onClick: async (instance) => {
          const raw = Number(wrap.querySelector<HTMLInputElement>("#ex-count")!.value);
          const additionalCount = Number.isFinite(raw) ? Math.trunc(raw) : NaN;
          if (!Number.isFinite(additionalCount) || additionalCount <= 0) {
            Toast.error(t("pt_err_count_positive"));
            return;
          }
          try {
            const res = await extendAgentTicketRange(range.id, { additionalCount });
            Toast.success(
              t("pt_extend_success", {
                added: res.addedCount,
                total: res.totalSerialsAfter,
              }),
            );
            await onDone();
            instance.close("programmatic");
          } catch (err) {
            Toast.error(mapPhysicalTicketErrorMessage(err));
          }
        },
      },
    ],
  });
}

function openCloseModal(
  range: AgentTicketRangeRow,
  onDone: () => Promise<void> | void,
): void {
  Modal.open({
    title: t("pt_action_close"),
    content: `<p>${escapeHtml(t("pt_close_confirm_body"))}</p>
      <p><strong>${escapeHtml(t("pt_range_id"))}:</strong> <code>${escapeHtml(range.id.slice(0, 8))}</code></p>`,
    backdrop: "static",
    keyboard: false,
    buttons: [
      { label: t("cancel_button"), variant: "default", action: "cancel" },
      {
        label: t("pt_confirm_close"),
        variant: "danger",
        action: "confirm",
        onClick: async (instance) => {
          try {
            await closeAgentTicketRange(range.id);
            Toast.success(t("pt_close_success"));
            await onDone();
            instance.close("programmatic");
          } catch (err) {
            Toast.error(mapPhysicalTicketErrorMessage(err));
          }
        },
      },
    ],
  });
}
