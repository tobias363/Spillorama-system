// PR-B5 (BIN-660) — Category list (admin-only).
//
// Data:
//   GET  /api/admin/product-categories?includeInactive=1
//   POST /api/admin/product-categories                  { name, sortOrder, isActive }
//   PUT  /api/admin/product-categories/:id
//   DELETE /api/admin/product-categories/:id
//
// Simpler than product-list (no CSV export — small cardinality, no filter).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { Modal } from "../../components/Modal.js";
import { ApiError } from "../../api/client.js";
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  type ProductCategory,
} from "../../api/admin-products.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "./shared.js";

export function renderCategoryListPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("category_management", "product_management")}
    <section class="content">
      ${boxOpen("category_management", "primary")}
        <div id="category-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#category-table")!;

  async function refresh(): Promise<void> {
    tableHost.textContent = t("loading_ellipsis");
    try {
      const categories = await listCategories({ includeInactive: true });
      DataTable.mount<ProductCategory>(tableHost, {
        id: "category-datatable",
        columns: [
          { key: "name", title: t("category_name"), render: (r) => escapeHtml(r.name) },
          {
            key: "sortOrder",
            title: t("sort_order"),
            align: "right",
            render: (r) => String(r.sortOrder),
          },
          {
            key: "isActive",
            title: t("status"),
            align: "center",
            render: (r) =>
              r.isActive
                ? `<span class="label label-success">${escapeHtml(t("active"))}</span>`
                : `<span class="label label-default">${escapeHtml(t("inactive"))}</span>`,
          },
          {
            key: "id",
            title: t("action"),
            align: "center",
            render: (r) => renderRowActions(r, () => void refresh()),
          },
        ],
        rows: categories,
        emptyMessage: t("no_data_available_in_table"),
        toolbar: {
          extra: (host) => {
            const addBtn = document.createElement("button");
            addBtn.type = "button";
            addBtn.className = "btn btn-primary btn-sm";
            addBtn.setAttribute("data-action", "add-category");
            addBtn.innerHTML = `<i class="fa fa-plus"></i> ${escapeHtml(t("add_category"))}`;
            addBtn.addEventListener("click", () =>
              openAddEditModal(null, () => void refresh())
            );
            host.append(addBtn);
          },
        },
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      tableHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
    }
  }

  void refresh();

  function renderRowActions(row: ProductCategory, onChange: () => void): Node {
    const wrap = document.createElement("div");
    wrap.style.whiteSpace = "nowrap";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn btn-warning btn-xs";
    edit.setAttribute("data-action", "edit-category");
    edit.setAttribute("data-id", row.id);
    edit.innerHTML = `<i class="fa fa-edit"></i>`;
    edit.title = t("edit");
    edit.addEventListener("click", () => openAddEditModal(row, onChange));
    wrap.append(edit);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-danger btn-xs";
    del.setAttribute("data-action", "delete-category");
    del.setAttribute("data-id", row.id);
    del.innerHTML = ` <i class="fa fa-trash"></i>`;
    del.title = t("delete");
    del.style.marginLeft = "4px";
    del.addEventListener("click", () => {
      if (!window.confirm(t("delete_message"))) return;
      void (async () => {
        try {
          await deleteCategory(row.id);
          Toast.success(t("category_deleted"));
          onChange();
        } catch (err) {
          Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
        }
      })();
    });
    wrap.append(del);

    return wrap;
  }

  function openAddEditModal(
    existing: ProductCategory | null,
    onDone: () => void
  ): void {
    const isEdit = existing !== null;
    const form = document.createElement("form");
    form.className = "form-horizontal";
    form.setAttribute("data-testid", isEdit ? "edit-category-form" : "add-category-form");
    form.innerHTML = `
      <div class="form-group">
        <label class="col-sm-4 control-label" for="cf-name">${escapeHtml(t("category_name"))}</label>
        <div class="col-sm-8">
          <input type="text" id="cf-name" name="name" class="form-control" required
            value="${escapeHtml(existing?.name ?? "")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="cf-sort">${escapeHtml(t("sort_order"))}</label>
        <div class="col-sm-8">
          <input type="number" id="cf-sort" name="sortOrder" class="form-control" min="0" step="1"
            value="${escapeHtml(String(existing?.sortOrder ?? 0))}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="cf-status">${escapeHtml(t("status"))}</label>
        <div class="col-sm-8">
          <select id="cf-status" name="isActive" class="form-control">
            <option value="true"${existing?.isActive !== false ? " selected" : ""}>${escapeHtml(t("active"))}</option>
            <option value="false"${existing?.isActive === false ? " selected" : ""}>${escapeHtml(t("inactive"))}</option>
          </select>
        </div>
      </div>`;

    const instance = Modal.open({
      title: isEdit ? t("edit_text") : t("add_category"),
      content: form,
      buttons: [
        { label: t("cancel"), variant: "default", action: "cancel" },
        {
          label: t("submit"),
          variant: "success",
          action: "submit",
          dismiss: false,
          onClick: async () => {
            const nameEl = form.querySelector<HTMLInputElement>("#cf-name")!;
            const sortEl = form.querySelector<HTMLInputElement>("#cf-sort")!;
            const statusEl = form.querySelector<HTMLSelectElement>("#cf-status")!;
            const name = nameEl.value.trim();
            if (!name) {
              Toast.error(t("enter_category_name"));
              return;
            }
            const sortOrder = Number(sortEl.value) || 0;
            const isActive = statusEl.value !== "false";
            try {
              if (isEdit && existing) {
                await updateCategory(existing.id, { name, sortOrder, isActive });
                Toast.success(t("category_updated"));
              } else {
                await createCategory({ name, sortOrder, isActive });
                Toast.success(t("category_added"));
              }
              instance.close("button");
              onDone();
            } catch (err) {
              Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
            }
          },
        },
      ],
    });
  }
}
