// PR 4e.1 (2026-04-22) — /groupHall list-side.
//
// Data:
//   GET /api/admin/hall-groups (fetchHallGroupList)
//   DELETE /api/admin/hall-groups/:id (deleteGroupHall, soft-delete default)
//
// Legacy hadde ingen GroupHall-UI i admin-web (kun placeholder fra
// BIN-663). Denne siden er wire-up #1 av 3 nye sider (list + add-modal
// + edit-modal) for pilot-blokker 4e.1.
//
// Mønster: apps/admin-web/src/pages/hall/HallListPage.ts + DataTable +
// GameManagementPage add-knapp.
//
// Search: klient-side name-search over allerede hentet liste (backend
// eksponerer kun `status` + `hallId` som server-side filter).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { ApiError } from "../../api/client.js";
import {
  fetchHallGroupList,
  deleteGroupHall,
  type HallGroupRow,
  type HallGroupStatus,
} from "./GroupHallState.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
  activeBadge,
} from "../adminUsers/shared.js";
import { openGroupHallEditorModal } from "./GroupHallEditorModal.js";

type StatusFilter = HallGroupStatus | "all";

interface ViewState {
  rows: HallGroupRow[];
  search: string;
  statusFilter: StatusFilter;
}

export function renderGroupHallListPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("hall_groups_list", "group_of_halls_management")}
    <section class="content">
      ${boxOpen("hall_groups_list", "primary")}
        <div class="row" style="margin-bottom:12px;">
          <div class="col-sm-6">
            <input
              type="text"
              id="gh-search"
              class="form-control"
              placeholder="${escapeHtml(t("search"))}"
              data-testid="gh-search"
              autocomplete="off" />
          </div>
          <div class="col-sm-3">
            <select id="gh-status-filter" class="form-control" data-testid="gh-status-filter">
              <option value="all">${escapeHtml(t("all"))}</option>
              <option value="active">${escapeHtml(t("active"))}</option>
              <option value="inactive">${escapeHtml(t("inactive"))}</option>
            </select>
          </div>
          <div class="col-sm-3 text-right">
            <button
              type="button"
              class="btn btn-primary"
              data-action="gh-add"
              data-testid="gh-add-btn">
              <i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("add_group_of_halls"))}
            </button>
          </div>
        </div>
        <div id="gh-table" data-testid="gh-list-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#gh-table")!;
  const searchEl = container.querySelector<HTMLInputElement>("#gh-search")!;
  const statusEl = container.querySelector<HTMLSelectElement>("#gh-status-filter")!;
  const addBtn = container.querySelector<HTMLButtonElement>("button[data-action='gh-add']")!;

  const view: ViewState = {
    rows: [],
    search: "",
    statusFilter: "all",
  };

  const refresh = async (): Promise<void> => {
    tableHost.textContent = t("loading_ellipsis");
    try {
      const rows = await fetchHallGroupList();
      view.rows = rows;
      render();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = `<div class="callout callout-danger" data-testid="gh-list-error">${escapeHtml(msg)}</div>`;
    }
  };

  const render = (): void => {
    const search = view.search.trim().toLowerCase();
    const filtered = view.rows.filter((r) => {
      if (view.statusFilter !== "all" && r.status !== view.statusFilter) return false;
      if (!search) return true;
      if (r.name.toLowerCase().includes(search)) return true;
      if (r.id.toLowerCase().includes(search)) return true;
      if (r.members.some((m) => m.hallName.toLowerCase().includes(search))) return true;
      return false;
    });

    DataTable.mount<HallGroupRow>(tableHost, {
      id: "gh-datatable",
      rows: filtered,
      emptyMessage: t("no_data_available_in_table"),
      columns: [
        { key: "name", title: t("name"), render: (r) => escapeHtml(r.name) },
        {
          key: "members",
          title: t("halls"),
          render: (r) => {
            if (r.members.length === 0) return `<em class="text-muted">${escapeHtml(t("no_data"))}</em>`;
            const names = r.members.map((m) => escapeHtml(m.hallName)).join(", ");
            return `<span title="${escapeHtml(String(r.members.length))}">${names}</span>`;
          },
        },
        {
          key: "tvId",
          title: t("tv_screen"),
          align: "center",
          render: (r) =>
            r.tvId !== null && r.tvId !== undefined
              ? `<code>${escapeHtml(String(r.tvId))}</code>`
              : `<em class="text-muted">—</em>`,
        },
        {
          key: "status",
          title: t("status"),
          align: "center",
          render: (r) => activeBadge(r.status === "active"),
        },
        {
          key: "id",
          title: t("action"),
          align: "center",
          render: (r) => rowActions(r, () => void refresh()),
        },
      ],
    });
  };

  // Wire input handlers
  searchEl.addEventListener("input", () => {
    view.search = searchEl.value;
    render();
  });
  statusEl.addEventListener("change", () => {
    view.statusFilter = (statusEl.value as StatusFilter) || "all";
    render();
  });
  addBtn.addEventListener("click", () => {
    openGroupHallEditorModal({
      mode: "create",
      onSaved: () => void refresh(),
    });
  });

  void refresh();
}

function rowActions(row: HallGroupRow, onChange: () => void): Node {
  const wrap = document.createElement("div");
  wrap.style.whiteSpace = "nowrap";

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "btn btn-warning btn-xs";
  edit.setAttribute("data-action", "gh-edit");
  edit.setAttribute("data-id", row.id);
  edit.setAttribute("title", t("edit"));
  edit.innerHTML = `<i class="fa fa-edit" aria-hidden="true"></i>`;
  edit.addEventListener("click", () => {
    openGroupHallEditorModal({
      mode: "edit",
      existing: row,
      onSaved: onChange,
    });
  });
  wrap.append(edit);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn btn-danger btn-xs";
  del.setAttribute("data-action", "gh-delete");
  del.setAttribute("data-id", row.id);
  del.setAttribute("title", t("delete"));
  del.style.marginLeft = "4px";
  del.innerHTML = `<i class="fa fa-trash" aria-hidden="true"></i>`;
  del.addEventListener("click", () => {
    const msg = `${t("confirm_delete")}\n\n${row.name}`;
    if (!window.confirm(msg)) return;
    del.disabled = true;
    void (async () => {
      const result = await deleteGroupHall(row.id);
      if (result.ok) {
        Toast.success(t("success"));
        onChange();
      } else {
        const reasonMsg =
          result.reason === "PERMISSION_DENIED"
            ? t("permission_denied")
            : result.reason === "NOT_FOUND"
              ? t("not_found")
              : result.message;
        Toast.error(reasonMsg);
        del.disabled = false;
      }
    })();
  });
  wrap.append(del);

  return wrap;
}
