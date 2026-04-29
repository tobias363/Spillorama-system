// PR-B5 (BIN-660) — Products route dispatcher.
//
// Routes:
//   /productList      → ProductListPage (CRUD + DataTable csvExport)
//   /categoryList     → CategoryListPage (CRUD)
//   /hallProductList  → HallProductsPage (assignment)
//
// /orderHistory is intentionally NOT owned here — it belongs to a later PR
// (BIN-650 order-history placeholder in Placeholder.ts remains untouched).

import { renderProductListPage } from "./ProductListPage.js";
import { renderCategoryListPage } from "./CategoryListPage.js";
import { renderHallProductsPage } from "./HallProductsPage.js";
import { renderUnknownRoute } from "../../utils/escapeHtml.js";

const PRODUCTS_ROUTES = new Set<string>([
  "/productList",
  "/categoryList",
  "/hallProductList",
]);

export function isProductsRoute(path: string): boolean {
  return PRODUCTS_ROUTES.has(path);
}

export function mountProductsRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  switch (path) {
    case "/productList":
      renderProductListPage(container);
      return;
    case "/categoryList":
      renderCategoryListPage(container);
      return;
    case "/hallProductList":
      renderHallProductsPage(container);
      return;
    default:
      container.innerHTML = renderUnknownRoute("products", path);
  }
}
