// PR-B5 (BIN-660) — Hall product assignment.
//
// Flow (legacy uses a multi-select modal; we fold that into the page itself
// for a lower-friction UX — still fail-closed on API errors):
//
//   1. User picks a hall in the top selector.
//   2. Page fetches the hall's current assignment + full product catalog.
//   3. Checkboxes reflect current state; user toggles + clicks Save.
//   4. PUT /api/admin/halls/:hallId/products { productIds } replaces set.
//
// Data:
//   GET  /api/admin/halls                             → Hall[]
//   GET  /api/admin/halls/:hallId/products?activeOnly=0 → HallProduct[]
//   GET  /api/admin/products?status=ACTIVE            → Product[] (assignable pool)
//   PUT  /api/admin/halls/:hallId/products            → { added, removed, total }

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  listHalls,
  listHallProducts,
  listProducts,
  setHallProducts,
  type Hall,
  type Product,
} from "../../api/admin-products.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
  formatPriceCents,
} from "./shared.js";

export function renderHallProductsPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("hall_product_management", "product_management")}
    <section class="content">
      ${boxOpen("hall_product_management", "primary")}
        <div class="form-inline" style="margin-bottom:16px;">
          <label for="hp-hall" style="margin-right:8px;">${escapeHtml(t("select_hall_name"))}</label>
          <select id="hp-hall" class="form-control input-sm" data-testid="hall-selector" style="min-width:240px;">
            <option value="">${escapeHtml(t("loading_ellipsis"))}</option>
          </select>
        </div>
        <div id="hp-products" data-testid="hall-products-list">
          <div class="callout callout-info">${escapeHtml(t("select_hall_name"))}</div>
        </div>
        <div style="margin-top:16px;text-align:right;">
          <button type="button" id="hp-save" class="btn btn-success" data-action="save-hall-products" disabled>
            <i class="fa fa-save"></i> ${escapeHtml(t("save"))}
          </button>
        </div>
      ${boxClose()}
    </section>`;

  const hallSelect = container.querySelector<HTMLSelectElement>("#hp-hall")!;
  const productsHost = container.querySelector<HTMLElement>("#hp-products")!;
  const saveBtn = container.querySelector<HTMLButtonElement>("#hp-save")!;

  let allProducts: Product[] = [];
  let currentAssignment = new Set<string>();

  async function init(): Promise<void> {
    try {
      const [halls, products] = await Promise.all([listHalls(), listProducts({ status: "ACTIVE" })]);
      allProducts = products;
      renderHallOptions(halls);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      productsHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
    }
  }

  function renderHallOptions(halls: Hall[]): void {
    hallSelect.innerHTML =
      `<option value="">${escapeHtml(t("select_hall_name"))}</option>` +
      halls
        .filter((h) => h.isActive)
        .map((h) => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name)}</option>`)
        .join("");
  }

  hallSelect.addEventListener("change", () => {
    const hallId = hallSelect.value;
    if (!hallId) {
      productsHost.innerHTML = `<div class="callout callout-info">${escapeHtml(t("select_hall_name"))}</div>`;
      saveBtn.disabled = true;
      return;
    }
    void loadForHall(hallId);
  });

  async function loadForHall(hallId: string): Promise<void> {
    productsHost.innerHTML = `<div>${escapeHtml(t("loading_ellipsis"))}</div>`;
    saveBtn.disabled = true;
    try {
      // activeOnly=0 so we see BOTH active and historical-inactive rows;
      // the assignment set is the active subset.
      const rows = await listHallProducts(hallId, { activeOnly: false });
      currentAssignment = new Set(
        rows.filter((r) => r.isActive).map((r) => r.productId)
      );
      renderProductCheckboxes();
      saveBtn.disabled = false;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      productsHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
    }
  }

  function renderProductCheckboxes(): void {
    if (allProducts.length === 0) {
      productsHost.innerHTML = `<div class="callout callout-warning">${escapeHtml(t("no_data_available_in_table"))}</div>`;
      return;
    }
    const table = document.createElement("table");
    table.className = "table table-bordered table-hover";
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width:48px;text-align:center;">
            <input type="checkbox" id="hp-check-all" data-testid="hp-check-all"
              aria-label="${escapeHtml(t("select_all"))}">
          </th>
          <th>${escapeHtml(t("product_name"))}</th>
          <th style="text-align:right;">${escapeHtml(t("price"))}</th>
        </tr>
      </thead>
      <tbody></tbody>`;
    const tbody = table.querySelector<HTMLTableSectionElement>("tbody")!;
    for (const p of allProducts) {
      const tr = document.createElement("tr");
      const checked = currentAssignment.has(p.id) ? "checked" : "";
      tr.innerHTML = `
        <td style="text-align:center;">
          <input type="checkbox" class="hp-product-check" data-product-id="${escapeHtml(p.id)}" ${checked}>
        </td>
        <td>${escapeHtml(p.name)}</td>
        <td style="text-align:right;">${escapeHtml(formatPriceCents(p.priceCents))}</td>`;
      tbody.append(tr);
    }
    productsHost.innerHTML = "";
    productsHost.append(table);

    // Check-all toggle
    const checkAll = table.querySelector<HTMLInputElement>("#hp-check-all")!;
    const boxes = table.querySelectorAll<HTMLInputElement>(".hp-product-check");
    const syncCheckAll = (): void => {
      const total = boxes.length;
      const on = Array.from(boxes).filter((b) => b.checked).length;
      checkAll.checked = total > 0 && on === total;
      checkAll.indeterminate = on > 0 && on < total;
    };
    syncCheckAll();
    checkAll.addEventListener("change", () => {
      boxes.forEach((b) => (b.checked = checkAll.checked));
    });
    boxes.forEach((b) => b.addEventListener("change", syncCheckAll));
  }

  saveBtn.addEventListener("click", () => {
    const hallId = hallSelect.value;
    if (!hallId) return;
    const checked = Array.from(
      productsHost.querySelectorAll<HTMLInputElement>(".hp-product-check:checked")
    ).map((el) => el.getAttribute("data-product-id") ?? "");
    const productIds = checked.filter((x) => x.length > 0);
    saveBtn.disabled = true;
    void (async () => {
      try {
        const result = await setHallProducts(hallId, productIds);
        Toast.success(
          `${t("saved")}: +${result.added} / -${result.removed} (${result.total})`
        );
        await loadForHall(hallId);
      } catch (err) {
        Toast.error(err instanceof ApiError ? err.message : t("something_went_wrong"));
      } finally {
        saveBtn.disabled = false;
      }
    })();
  });

  void init();
}
