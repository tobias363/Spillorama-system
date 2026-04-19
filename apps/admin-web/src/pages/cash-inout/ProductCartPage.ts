// Product cart + checkout — port of
// legacy cash-inout/product_cart.html + product_checkout.html.
// Unified into one page with a two-step flow (cart → checkout modal).

import { t } from "../../i18n/I18n.js";
import { Modal } from "../../components/Modal.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import { getSession } from "../../auth/Session.js";
import {
  listProducts,
  createCart,
  finalizeCart,
  type ProductSummary,
  type PaymentType,
} from "../../api/agent-cash.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, formatNOK } from "./shared.js";

interface CartLineState {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

export function renderProductCartPage(container: HTMLElement): void {
  const session = getSession();
  const hallId = session?.hall?.[0]?.id ?? "";

  container.innerHTML = `
    ${contentHeader("sell_products")}
    <section class="content">
      <div class="row">
        <div class="col-md-8">
          ${boxOpen("products", "default")}
            <div id="product-grid" class="row">${escapeHtml(t("loading_ellipsis"))}</div>
          ${boxClose()}
        </div>
        <div class="col-md-4">
          ${boxOpen("cart_details", "primary")}
            <ul id="cart-lines" class="list-group" style="margin-bottom:12px;"></ul>
            <div class="text-right" style="font-weight:bold;">
              ${escapeHtml(t("total_order_amount"))}: <span id="cart-total">0.00</span> kr
            </div>
            <hr>
            <button class="btn btn-success btn-block" id="btn-checkout" disabled>${escapeHtml(t("submit"))}</button>
          ${boxClose()}
        </div>
      </div>
    </section>`;

  const productGrid = container.querySelector<HTMLElement>("#product-grid")!;
  const cartLinesEl = container.querySelector<HTMLElement>("#cart-lines")!;
  const cartTotalEl = container.querySelector<HTMLElement>("#cart-total")!;
  const checkoutBtn = container.querySelector<HTMLButtonElement>("#btn-checkout")!;

  const cart = new Map<string, CartLineState>();

  function renderCart(): void {
    cartLinesEl.innerHTML = "";
    let total = 0;
    cart.forEach((line) => {
      const lineTotal = line.quantity * line.unitPrice;
      total += lineTotal;
      const li = document.createElement("li");
      li.className = "list-group-item";
      li.innerHTML = `
        <div>
          <strong>${escapeHtml(line.name)}</strong>
          <span class="pull-right">${formatNOK(lineTotal)} kr</span>
        </div>
        <div style="margin-top:4px;">
          <button type="button" class="btn btn-xs btn-default" data-action="dec" data-pid="${escapeHtml(line.productId)}">−</button>
          <span style="margin:0 8px;">${line.quantity}</span>
          <button type="button" class="btn btn-xs btn-default" data-action="inc" data-pid="${escapeHtml(line.productId)}">+</button>
          <button type="button" class="btn btn-xs btn-danger pull-right" data-action="rm" data-pid="${escapeHtml(line.productId)}">×</button>
        </div>`;
      cartLinesEl.append(li);
    });
    cartTotalEl.textContent = formatNOK(total);
    checkoutBtn.disabled = cart.size === 0;
  }

  cartLinesEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action][data-pid]");
    if (!btn) return;
    const pid = btn.dataset.pid!;
    const line = cart.get(pid);
    if (!line) return;
    switch (btn.dataset.action) {
      case "inc":
        line.quantity += 1;
        break;
      case "dec":
        line.quantity = Math.max(0, line.quantity - 1);
        if (line.quantity === 0) cart.delete(pid);
        break;
      case "rm":
        cart.delete(pid);
        break;
    }
    renderCart();
  });

  checkoutBtn.addEventListener("click", () => openCheckoutModal(hallId, cart, () => {
    cart.clear();
    renderCart();
  }));

  void (async () => {
    try {
      const products = await listProducts(hallId);
      renderProducts(productGrid, products, (p) => {
        const line = cart.get(p.id);
        if (line) line.quantity += 1;
        else cart.set(p.id, { productId: p.id, name: p.name, unitPrice: p.price, quantity: 1 });
        renderCart();
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      productGrid.innerHTML = `<p class="text-muted">${escapeHtml(t("no_products_available"))}</p>`;
    }
  })();
}

function renderProducts(host: HTMLElement, products: ProductSummary[], onAdd: (p: ProductSummary) => void): void {
  host.innerHTML = "";
  if (products.length === 0) {
    host.innerHTML = `<p class="text-muted">${escapeHtml(t("no_products_available"))}</p>`;
    return;
  }
  for (const p of products) {
    const col = document.createElement("div");
    col.className = "col-sm-6 col-md-4";
    col.style.marginBottom = "8px";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-success btn-block";
    btn.disabled = !p.available;
    btn.innerHTML = `<strong>${escapeHtml(p.name)}</strong><br><small>${formatNOK(p.price)} kr</small>`;
    btn.addEventListener("click", () => onAdd(p));
    col.append(btn);
    host.append(col);
  }
}

function openCheckoutModal(hallId: string, cart: Map<string, CartLineState>, onDone: () => void): void {
  const body = document.createElement("div");
  const lines = Array.from(cart.values());
  const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

  body.innerHTML = `
    <h4>${escapeHtml(t("cart_details"))}</h4>
    <ul class="list-group" style="margin-bottom:12px;">
      ${lines
        .map(
          (l) => `<li class="list-group-item">
            <span>${escapeHtml(l.name)} × ${l.quantity}</span>
            <span class="pull-right">${formatNOK(l.quantity * l.unitPrice)} kr</span>
          </li>`
        )
        .join("")}
    </ul>
    <div class="text-right" style="font-weight:bold; margin-bottom:16px;">
      ${escapeHtml(t("total_order_amount"))}: ${formatNOK(total)} kr
    </div>
    <div class="form-group">
      <label for="co-payment">${escapeHtml(t("select_payment_type"))}</label>
      <select class="form-control" id="co-payment">
        <option value="Cash">${escapeHtml(t("cash"))}</option>
        <option value="Card">${escapeHtml(t("card"))}</option>
      </select>
    </div>`;

  Modal.open({
    title: t("sell_products"),
    content: body,
    size: "lg",
    buttons: [
      { label: t("cancel"), variant: "default", action: "cancel" },
      {
        label: t("submit"),
        variant: "success",
        action: "confirm",
        onClick: async () => {
          const paymentType = (body.querySelector<HTMLSelectElement>("#co-payment")!).value as PaymentType;
          try {
            const created = await createCart({
              hallId,
              userType: "anonymous",
              lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
            });
            await finalizeCart(created.id, { paymentType });
            Toast.success(t("product_sale_success"));
            onDone();
          } catch (err) {
            const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
            Toast.error(msg);
            throw err;
          }
        },
      },
    ],
  });
}
