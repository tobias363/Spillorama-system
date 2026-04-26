// PR-B5 (BIN-660) — Product list (admin-only).
//
// Data:
//   GET  /api/admin/products?categoryId=&status=   → Product[]
//   GET  /api/admin/product-categories             → ProductCategory[]
//   POST/PUT/DELETE /api/admin/products...         → modal CRUD
//
// DataTable extension (PR-A4a) is used for:
//   - csvExport toolbar button (legacy "csvHtml5" parity)
//   - toolbar.extra slot for the category filter + "Add product" button
//
// Regulatorisk: read-only for SUPPORT; write actions require PRODUCT_WRITE
// which backend enforces — UI shows action buttons to all roles and lets
// the API reject if the actor is not authorised.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import { Modal } from "../../components/Modal.js";
import { ApiError } from "../../api/client.js";
import {
  listProducts,
  listCategories,
  createProduct,
  updateProduct,
  deleteProduct,
  getProduct,
  type Product,
  type ProductCategory,
  type ProductStatus,
} from "../../api/admin-products.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
  formatPriceCents,
  parseCents,
  statusBadge,
} from "./shared.js";

export function renderProductListPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("product_management", "product_management")}
    <section class="content">
      ${boxOpen("product_management", "primary")}
        <div id="product-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#product-table")!;

  let categories: ProductCategory[] = [];
  let categoryFilter: string = "";

  // Categories are fetched once on mount; list refresh re-queries products only.
  function categoryName(id: string | null): string {
    if (!id) return "";
    const c = categories.find((x) => x.id === id);
    return c ? c.name : id;
  }

  async function refresh(): Promise<void> {
    tableHost.textContent = t("loading_ellipsis");
    try {
      if (categories.length === 0) {
        categories = await listCategories({ includeInactive: true });
      }
      const filter: { categoryId?: string } = {};
      if (categoryFilter) filter.categoryId = categoryFilter;
      const products = await listProducts(filter);

      DataTable.mount<Product>(tableHost, {
        id: "product-datatable",
        columns: [
          { key: "id", title: t("product_id"), render: (r) => escapeHtml(r.id) },
          { key: "name", title: t("product_name"), render: (r) => escapeHtml(r.name) },
          {
            key: "categoryId",
            title: t("category"),
            render: (r) => escapeHtml(categoryName(r.categoryId)),
          },
          {
            key: "priceCents",
            title: t("price"),
            align: "right",
            render: (r) => formatPriceCents(r.priceCents),
          },
          {
            key: "status",
            title: t("status"),
            align: "center",
            render: (r) => statusBadge(r.status),
          },
          {
            key: "id",
            title: t("action"),
            align: "center",
            render: (r) => renderRowActions(r, () => void refresh()),
          },
        ],
        rows: products,
        emptyMessage: t("no_data_available_in_table"),
        csvExport: {
          filename: "products",
          transform: (p) => ({
            id: p.id,
            name: p.name,
            categoryId: categoryName(p.categoryId),
            priceCents: formatPriceCents(p.priceCents),
            status: p.status,
          }),
        },
        toolbar: {
          extra: (host) => {
            const catSelect = document.createElement("select");
            catSelect.className = "form-control input-sm";
            catSelect.setAttribute("aria-label", t("select_category"));
            catSelect.setAttribute("data-testid", "product-category-filter");
            catSelect.style.maxWidth = "220px";
            catSelect.innerHTML = `<option value="">${escapeHtml(t("select_category"))}</option>` +
              categories
                .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
                .join("");
            catSelect.value = categoryFilter;
            catSelect.addEventListener("change", () => {
              categoryFilter = catSelect.value;
              void refresh();
            });
            host.append(catSelect);

            const addBtn = document.createElement("button");
            addBtn.type = "button";
            addBtn.className = "btn btn-primary btn-sm";
            addBtn.setAttribute("data-action", "add-product");
            addBtn.innerHTML = `<i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("add_product"))}`;
            addBtn.addEventListener("click", () => openAddEditModal(null, () => void refresh()));
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

  // ── Row action buttons ─────────────────────────────────────────────────

  function renderRowActions(row: Product, onChange: () => void): Node {
    const wrap = document.createElement("div");
    wrap.style.whiteSpace = "nowrap";

    const view = document.createElement("button");
    view.type = "button";
    view.className = "btn btn-info btn-xs";
    view.setAttribute("data-action", "view-product");
    view.setAttribute("data-id", row.id);
    view.innerHTML = `<i class="fa fa-eye" aria-hidden="true"></i>`;
    view.title = t("view_product");
    view.setAttribute("aria-label", t("view_product"));
    view.addEventListener("click", () => openViewModal(row.id));
    wrap.append(view);

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn btn-warning btn-xs";
    edit.setAttribute("data-action", "edit-product");
    edit.setAttribute("data-id", row.id);
    edit.innerHTML = ` <i class="fa fa-edit" aria-hidden="true"></i>`;
    edit.title = t("edit_product");
    edit.setAttribute("aria-label", t("edit_product"));
    edit.style.marginLeft = "4px";
    edit.addEventListener("click", () => openAddEditModal(row, onChange));
    wrap.append(edit);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-danger btn-xs";
    del.setAttribute("data-action", "delete-product");
    del.setAttribute("data-id", row.id);
    del.innerHTML = ` <i class="fa fa-trash" aria-hidden="true"></i>`;
    del.title = t("delete");
    del.setAttribute("aria-label", t("delete"));
    del.style.marginLeft = "4px";
    del.addEventListener("click", () => {
      if (!window.confirm(t("delete_message"))) return;
      void (async () => {
        try {
          await deleteProduct(row.id);
          Toast.success(t("product_has_been_deleted"));
          onChange();
        } catch (err) {
          Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
        }
      })();
    });
    wrap.append(del);

    return wrap;
  }

  // ── Modals ─────────────────────────────────────────────────────────────

  async function openViewModal(id: string): Promise<void> {
    try {
      const product = await getProduct(id);
      const body = document.createElement("div");
      body.innerHTML = `
        <dl class="dl-horizontal">
          <dt>${escapeHtml(t("product_id"))}</dt><dd>${escapeHtml(product.id)}</dd>
          <dt>${escapeHtml(t("product_name"))}</dt><dd>${escapeHtml(product.name)}</dd>
          <dt>${escapeHtml(t("category"))}</dt><dd>${escapeHtml(categoryName(product.categoryId))}</dd>
          <dt>${escapeHtml(t("price"))}</dt><dd>${escapeHtml(formatPriceCents(product.priceCents))}</dd>
          <dt>${escapeHtml(t("status"))}</dt><dd>${statusBadge(product.status)}</dd>
        </dl>`;
      Modal.open({
        title: t("view_product"),
        content: body,
        buttons: [{ label: t("close"), variant: "default", action: "close" }],
      });
    } catch (err) {
      Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
    }
  }

  function openAddEditModal(existing: Product | null, onDone: () => void): void {
    const isEdit = existing !== null;
    const form = document.createElement("form");
    form.className = "form-horizontal";
    form.setAttribute("data-testid", isEdit ? "edit-product-form" : "add-product-form");
    form.innerHTML = `
      <div class="form-group">
        <label class="col-sm-4 control-label" for="pf-name">${escapeHtml(t("product_name"))}</label>
        <div class="col-sm-8">
          <input type="text" id="pf-name" name="name" class="form-control" required
            value="${escapeHtml(existing?.name ?? "")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="pf-price">${escapeHtml(t("price"))}</label>
        <div class="col-sm-8">
          <input type="number" id="pf-price" name="price" class="form-control" step="0.01" min="0" required
            value="${escapeHtml(existing ? formatPriceCents(existing.priceCents) : "")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="pf-category">${escapeHtml(t("select_category"))}</label>
        <div class="col-sm-8">
          <select id="pf-category" name="categoryId" class="form-control" required>
            <option value="">${escapeHtml(t("select_category"))}</option>
            ${categories
              .map(
                (c) =>
                  `<option value="${escapeHtml(c.id)}"${
                    existing?.categoryId === c.id ? " selected" : ""
                  }>${escapeHtml(c.name)}</option>`
              )
              .join("")}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="pf-status">${escapeHtml(t("status"))}</label>
        <div class="col-sm-8">
          <select id="pf-status" name="status" class="form-control">
            <option value="ACTIVE"${existing?.status === "ACTIVE" ? " selected" : ""}>${escapeHtml(t("active"))}</option>
            <option value="INACTIVE"${existing?.status === "INACTIVE" ? " selected" : ""}>${escapeHtml(t("inactive"))}</option>
          </select>
        </div>
      </div>`;

    const instance = Modal.open({
      title: isEdit ? t("edit_product") : t("add_product"),
      content: form,
      size: "lg",
      buttons: [
        { label: t("cancel"), variant: "default", action: "cancel" },
        {
          label: t("submit"),
          variant: "success",
          action: "submit",
          dismiss: false,
          onClick: async () => {
            const nameEl = form.querySelector<HTMLInputElement>("#pf-name")!;
            const priceEl = form.querySelector<HTMLInputElement>("#pf-price")!;
            const catEl = form.querySelector<HTMLSelectElement>("#pf-category")!;
            const statusEl = form.querySelector<HTMLSelectElement>("#pf-status")!;

            const name = nameEl.value.trim();
            if (!name) {
              Toast.error(t("enter_product_name"));
              return;
            }
            const priceCents = parseCents(priceEl.value);
            if (priceCents === null) {
              Toast.error(t("enter_price"));
              return;
            }
            const categoryId = catEl.value || undefined;
            const status = (statusEl.value as ProductStatus) ?? "ACTIVE";

            try {
              if (isEdit && existing) {
                await updateProduct(existing.id, { name, priceCents, categoryId, status });
                Toast.success(t("product_updated"));
              } else {
                await createProduct({ name, priceCents, categoryId, status });
                Toast.success(t("product_created"));
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
