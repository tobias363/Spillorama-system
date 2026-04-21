// PR-B3 (BIN-613) — Add / manage physical-ticket batches.
//
// Modern mapping differs from legacy: legacy issued a single "initialId" and
// incremented — modern backend (BIN-587 B4a) uses explicit batches with
// range_start / range_end / default_price / optional game-assignment. The UI
// therefore exposes the batch fields directly instead of hiding them behind
// a scanner-only flow. The scanner is still available for initial-ID capture.
//
// Two-step create: POST /batches (row placeholder) → POST /batches/:id/generate
// (materialises tickets in app_physical_tickets).

import { t } from "../../i18n/I18n.js";
import { getSession } from "../../auth/Session.js";
import { Modal } from "../../components/Modal.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import {
  listBatches,
  createBatch,
  updateBatch,
  deleteBatch,
  generateTickets,
  lastRegisteredId,
  type PhysicalTicketBatch,
} from "../../api/admin-physical-tickets.js";
import { listHalls, type AdminHall } from "../../api/dashboard.js";
import { boxClose, boxOpen, contentHeader, escapeHtml } from "./shared.js";

interface PageState {
  hallId: string | null;
  halls: AdminHall[];
  batches: PhysicalTicketBatch[];
}

export function renderAddPage(container: HTMLElement): void {
  const session = getSession();
  const isAdmin = session?.role === "admin" || session?.role === "super-admin";
  // HALL_OPERATOR / agent is bound to a single hall.
  const operatorHallId = !isAdmin ? session?.hall?.[0]?.id ?? null : null;

  const state: PageState = {
    hallId: operatorHallId,
    halls: [],
    batches: [],
  };

  container.innerHTML = `
    ${contentHeader("add_physical_tickets")}
    <section class="content">
      ${boxOpen("add_physical_tickets", "primary")}
        <form id="batch-form" class="form-horizontal" novalidate>
          <div class="row" id="hall-row" style="display:${isAdmin ? "block" : "none"};margin-bottom:12px;">
            <div class="col-sm-6">
              <label class="control-label" for="hallId">${escapeHtml(t("select_hall"))}</label>
              <select id="hallId" class="form-control">
                <option value="">${escapeHtml(t("select_hall_name"))}</option>
              </select>
            </div>
            <div class="col-sm-6">
              <label class="control-label">${escapeHtml(t("last_registered_id"))}</label>
              <div id="last-id" class="form-control" style="background:#f5f5f5;">—</div>
            </div>
          </div>
          <div class="row">
            <div class="col-sm-6">
              <label for="batchName">${escapeHtml(t("batch_name"))}</label>
              <input type="text" class="form-control" id="batchName" name="batchName"
                placeholder="${escapeHtml(t("batch_name_placeholder"))}" required>
            </div>
            <div class="col-sm-3">
              <label for="rangeStart">${escapeHtml(t("range_start"))}</label>
              <input type="number" class="form-control" id="rangeStart" name="rangeStart" min="1" required>
            </div>
            <div class="col-sm-3">
              <label for="rangeEnd">${escapeHtml(t("range_end"))}</label>
              <input type="number" class="form-control" id="rangeEnd" name="rangeEnd" min="1" required>
            </div>
          </div>
          <div class="row" style="margin-top:10px;">
            <div class="col-sm-6">
              <label for="defaultPrice">${escapeHtml(t("default_price"))}</label>
              <input type="number" class="form-control" id="defaultPrice" name="defaultPrice"
                min="0" step="0.01" required>
            </div>
            <div class="col-sm-6 text-right" style="padding-top:24px;">
              <button type="submit" class="btn btn-success" data-action="submit-batch">
                <i class="fa fa-plus"></i> ${escapeHtml(t("add_batch"))}
              </button>
            </div>
          </div>
        </form>
        <hr>
        <h4>${escapeHtml(t("physical_ticket_batches"))}</h4>
        <div id="batches-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const hallSelect = container.querySelector<HTMLSelectElement>("#hallId");
  const tableHost = container.querySelector<HTMLElement>("#batches-table")!;
  const lastIdCell = container.querySelector<HTMLElement>("#last-id");
  const form = container.querySelector<HTMLFormElement>("#batch-form")!;

  // Initial data load: halls (admin only) + batches (scoped).
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
    await refreshBatches();
    await refreshLastId();
  })();

  if (hallSelect) {
    hallSelect.addEventListener("change", () => {
      state.hallId = hallSelect.value || null;
      void refreshBatches();
      void refreshLastId();
    });
  }

  async function refreshLastId(): Promise<void> {
    if (!lastIdCell) return;
    if (!state.hallId) {
      lastIdCell.textContent = "—";
      return;
    }
    try {
      const res = await lastRegisteredId(state.hallId);
      lastIdCell.textContent = res.lastUniqueId ?? "—";
    } catch {
      lastIdCell.textContent = "—";
    }
  }

  async function refreshBatches(): Promise<void> {
    if (!state.hallId && isAdmin) {
      tableHost.innerHTML = `<div class="callout callout-info" style="margin:0;">${escapeHtml(t("hall_scope_required"))}</div>`;
      state.batches = [];
      return;
    }
    tableHost.textContent = t("loading_ellipsis");
    try {
      const res = await listBatches({ hallId: state.hallId ?? undefined, limit: 200 });
      state.batches = res.batches;
      renderTable();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = "";
    }
  }

  function renderTable(): void {
    DataTable.mount<PhysicalTicketBatch>(tableHost, {
      columns: [
        { key: "batchName", title: t("batch_name") },
        { key: "rangeStart", title: t("range_start"), align: "right" },
        { key: "rangeEnd", title: t("range_end"), align: "right" },
        {
          key: "defaultPriceCents",
          title: t("default_price"),
          align: "right",
          render: (b) => (b.defaultPriceCents / 100).toFixed(2),
        },
        {
          key: "status",
          title: t("batch_status"),
          render: (b) => escapeHtml(t(`batch_status_${b.status.toLowerCase()}`)),
        },
        {
          key: "id",
          title: t("action"),
          align: "center",
          render: (b) => renderActionCell(b),
        },
      ],
      rows: state.batches,
      emptyMessage: t("no_batches"),
    });
  }

  function renderActionCell(b: PhysicalTicketBatch): Node {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:inline-flex;gap:4px;";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn btn-warning btn-xs";
    edit.title = t("edit");
    edit.innerHTML = `<i class="fa fa-edit"></i>`;
    edit.setAttribute("data-action", "edit");
    edit.setAttribute("data-id", b.id);
    const gen = document.createElement("button");
    gen.type = "button";
    gen.className = "btn btn-info btn-xs";
    gen.title = t("generate_tickets");
    gen.innerHTML = `<i class="fa fa-cogs"></i>`;
    gen.setAttribute("data-action", "generate");
    gen.setAttribute("data-id", b.id);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-danger btn-xs";
    del.title = t("delete_button");
    del.innerHTML = `<i class="fa fa-trash"></i>`;
    del.setAttribute("data-action", "delete");
    del.setAttribute("data-id", b.id);
    wrap.append(edit, gen, del);
    return wrap;
  }

  // Create-batch submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const hallId = state.hallId;
    if (!hallId) {
      Toast.error(t("hall_scope_required"));
      return;
    }
    const batchName = (container.querySelector<HTMLInputElement>("#batchName")!.value || "").trim();
    const rangeStart = Number(container.querySelector<HTMLInputElement>("#rangeStart")!.value);
    const rangeEnd = Number(container.querySelector<HTMLInputElement>("#rangeEnd")!.value);
    const priceInput = Number(container.querySelector<HTMLInputElement>("#defaultPrice")!.value);

    if (!batchName) {
      Toast.error(t("batch_name"));
      return;
    }
    if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd < rangeStart) {
      Toast.error(t("final_id_should_be_greater_than_initial_Id"));
      return;
    }
    if (!Number.isFinite(priceInput) || priceInput < 0) {
      Toast.error(t("default_price"));
      return;
    }
    const defaultPriceCents = Math.round(priceInput * 100);

    // Non-sequential warning: if last-registered-id is set and rangeStart !== lastId+1
    let proceed = true;
    try {
      const res = await lastRegisteredId(hallId);
      if (res.lastUniqueId && Number.isFinite(Number(res.lastUniqueId))) {
        const expected = Number(res.lastUniqueId) + 1;
        if (expected !== rangeStart) {
          proceed = await confirmNonSequential();
        }
      }
    } catch {
      // soft-fail: still allow create
    }
    if (!proceed) return;

    try {
      await createBatch({
        hallId,
        batchName,
        rangeStart,
        rangeEnd,
        defaultPriceCents,
      });
      Toast.success(t("batch_created"));
      form.reset();
      await refreshBatches();
      await refreshLastId();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
    }
  });

  // Row-action dispatcher
  tableHost.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    if (!id) return;
    const action = btn.getAttribute("data-action");
    const batch = state.batches.find((b) => b.id === id);
    if (!batch) return;
    if (action === "edit") openEditModal(batch);
    else if (action === "delete") openDeleteModal(batch);
    else if (action === "generate") openGenerateModal(batch);
  });

  function openEditModal(batch: PhysicalTicketBatch): void {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="form-group">
        <label for="edit-batchName">${escapeHtml(t("batch_name"))}</label>
        <input type="text" class="form-control" id="edit-batchName" value="${escapeHtml(batch.batchName)}">
      </div>
      <div class="form-group">
        <label for="edit-defaultPrice">${escapeHtml(t("default_price"))}</label>
        <input type="number" class="form-control" id="edit-defaultPrice" step="0.01"
          value="${(batch.defaultPriceCents / 100).toFixed(2)}">
      </div>
      <div class="form-group">
        <label for="edit-status">${escapeHtml(t("batch_status"))}</label>
        <select class="form-control" id="edit-status">
          <option value="DRAFT"${batch.status === "DRAFT" ? " selected" : ""}>${escapeHtml(t("batch_status_draft"))}</option>
          <option value="ACTIVE"${batch.status === "ACTIVE" ? " selected" : ""}>${escapeHtml(t("batch_status_active"))}</option>
          <option value="CLOSED"${batch.status === "CLOSED" ? " selected" : ""}>${escapeHtml(t("batch_status_closed"))}</option>
        </select>
      </div>`;
    Modal.open({
      title: t("edit_batch"),
      content: wrap,
      buttons: [
        { label: t("cancel"), variant: "default", action: "cancel" },
        {
          label: t("submit"),
          variant: "primary",
          action: "confirm",
          onClick: async () => {
            const name = wrap.querySelector<HTMLInputElement>("#edit-batchName")!.value.trim();
            const priceVal = Number(wrap.querySelector<HTMLInputElement>("#edit-defaultPrice")!.value);
            const status = wrap.querySelector<HTMLSelectElement>("#edit-status")!.value as PhysicalTicketBatch["status"];
            try {
              await updateBatch(batch.id, {
                batchName: name,
                defaultPriceCents: Math.round(priceVal * 100),
                status,
              });
              Toast.success(t("batch_updated"));
              await refreshBatches();
            } catch (err) {
              const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
              Toast.error(msg);
            }
          },
        },
      ],
    });
  }

  function openDeleteModal(batch: PhysicalTicketBatch): void {
    Modal.open({
      title: t("confirm_delete_batch_title"),
      content: `<p>${escapeHtml(t("confirm_delete_batch_body"))}</p>
        <p><strong>${escapeHtml(batch.batchName)}</strong> (${batch.rangeStart}–${batch.rangeEnd})</p>`,
      buttons: [
        { label: t("cancel_button"), variant: "default", action: "cancel" },
        {
          label: t("delete_button"),
          variant: "danger",
          action: "confirm",
          onClick: async () => {
            try {
              await deleteBatch(batch.id);
              Toast.success(t("batch_deleted"));
              await refreshBatches();
              await refreshLastId();
            } catch (err) {
              const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
              Toast.error(msg);
            }
          },
        },
      ],
    });
  }

  function openGenerateModal(batch: PhysicalTicketBatch): void {
    Modal.open({
      title: t("generate_confirm_title"),
      content: `<p>${escapeHtml(t("generate_confirm_body"))}</p>
        <p><strong>${escapeHtml(batch.batchName)}</strong> (${batch.rangeStart}–${batch.rangeEnd})</p>`,
      buttons: [
        { label: t("cancel_button"), variant: "default", action: "cancel" },
        {
          label: t("generate_tickets"),
          variant: "primary",
          action: "confirm",
          onClick: async () => {
            try {
              const res = await generateTickets(batch.id);
              Toast.success(`${t("generate_success")}: ${res.generated}`);
              await refreshBatches();
              await refreshLastId();
            } catch (err) {
              const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
              Toast.error(msg);
            }
          },
        },
      ],
    });
  }

  function confirmNonSequential(): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const instance = Modal.open({
        title: t("non_sequential_warning_title"),
        content: `<p>${escapeHtml(t("non_sequential_warning_body"))}</p>`,
        buttons: [
          {
            label: t("cancel_button"),
            variant: "default",
            action: "cancel",
            onClick: () => {
              settled = true;
              resolve(false);
            },
          },
          {
            label: t("submit"),
            variant: "warning",
            action: "confirm",
            onClick: () => {
              settled = true;
              resolve(true);
            },
          },
        ],
        onClose: () => {
          if (!settled) resolve(false);
        },
      });
      void instance;
    });
  }
}
