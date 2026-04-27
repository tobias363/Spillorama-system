// Sell Products kiosk-page — port av legacy cash-inout/product_cart.html +
// product_checkout.html. 1:1 med wireframe §17.12: produktknapper med
// inline +/- decrement, cart-summary med totalsum, og direkte Cash/Card-
// knapper som submitter ordren.
//
// Wireframe-detaljer (PDF 17 §17.12):
//   • Horisontal rad med produkter: Coffee, Chocolate (2), Rice, …
//   • Hver knapp har `-`-ikon for decrement
//   • Cart-ikon (handlekurv) viser kvantum
//   • "Total Order Amount: 80" til høyre
//   • Cash / Card-knapper (markørt D) submitter ordren direkte
//   • Cash-transaksjon oppdaterer total cash + total daily balance
//
// Backend-flyt:
//   1. listProducts → katalog for agentens shift-hall
//   2. createCart(lines, userType=PHYSICAL) → draft cart med totalCents
//   3. finalizeCart(id, paymentMethod, expectedTotalCents, clientRequestId)
//      → commit sale + agent-tx + shift cash-delta
//
// userType=PHYSICAL er kiosk-default (anonym kontant-kunde i hall).
// CUSTOMER_NUMBER (wallet-trekk) er kun aktuelt hvis vi senere kobler
// kiosk-salg til en spiller — ikke implementert i §17.12.
//
// Cash → backend øker dailyBalance + totalCashIn.
// Card → backend øker kun totalCardIn (ikke dailyBalance).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  listProducts,
  createCart,
  finalizeCart,
  type ProductSummary,
  type ProductPaymentMethod,
} from "../../api/agent-cash.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, formatNOK } from "./shared.js";

interface CartLineState {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

export function renderProductCartPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("sell_products")}
    <section class="content">
      <div class="row">
        <div class="col-md-8">
          ${boxOpen("sell_products", "default")}
            <div id="product-grid" class="row">${escapeHtml(t("loading_ellipsis"))}</div>
          ${boxClose()}
        </div>
        <div class="col-md-4">
          ${boxOpen("cart_details", "primary")}
            <ul id="cart-lines" class="list-group" style="margin-bottom:12px;"></ul>
            <div class="text-right" style="font-weight:bold; font-size:16px; margin-bottom:12px;">
              ${escapeHtml(t("total_order_amount"))}: <span id="cart-total">0.00</span> kr
            </div>
            <div class="row">
              <div class="col-xs-6">
                <button type="button" class="btn btn-success btn-block" id="btn-pay-cash" disabled>
                  <i class="fa fa-money"></i> ${escapeHtml(t("cash"))}
                </button>
              </div>
              <div class="col-xs-6">
                <button type="button" class="btn btn-primary btn-block" id="btn-pay-card" disabled>
                  <i class="fa fa-credit-card"></i> ${escapeHtml(t("card"))}
                </button>
              </div>
            </div>
          ${boxClose()}
        </div>
      </div>
    </section>`;

  const productGrid = container.querySelector<HTMLElement>("#product-grid")!;
  const cartLinesEl = container.querySelector<HTMLElement>("#cart-lines")!;
  const cartTotalEl = container.querySelector<HTMLElement>("#cart-total")!;
  const cashBtn = container.querySelector<HTMLButtonElement>("#btn-pay-cash")!;
  const cardBtn = container.querySelector<HTMLButtonElement>("#btn-pay-card")!;

  const cart = new Map<string, CartLineState>();
  let isSubmitting = false;

  function totalNok(): number {
    let total = 0;
    cart.forEach((line) => {
      total += line.quantity * line.unitPrice;
    });
    return total;
  }

  function renderCart(): void {
    cartLinesEl.innerHTML = "";
    if (cart.size === 0) {
      const li = document.createElement("li");
      li.className = "list-group-item text-muted text-center";
      li.textContent = t("no_data_available_in_table");
      cartLinesEl.append(li);
    } else {
      cart.forEach((line) => {
        const lineTotal = line.quantity * line.unitPrice;
        const li = document.createElement("li");
        li.className = "list-group-item";
        li.innerHTML = `
          <div>
            <strong>${escapeHtml(line.name)}</strong>
            <span class="pull-right">${formatNOK(lineTotal)} kr</span>
          </div>
          <div style="margin-top:4px;">
            <button type="button" class="btn btn-xs btn-default" data-cart-action="dec" data-pid="${escapeHtml(line.productId)}" aria-label="Reduce">−</button>
            <span style="margin:0 8px; display:inline-block; min-width:24px; text-align:center;">${line.quantity}</span>
            <button type="button" class="btn btn-xs btn-default" data-cart-action="inc" data-pid="${escapeHtml(line.productId)}" aria-label="Increase">+</button>
            <button type="button" class="btn btn-xs btn-danger pull-right" data-cart-action="rm" data-pid="${escapeHtml(line.productId)}" aria-label="Remove">×</button>
          </div>`;
        cartLinesEl.append(li);
      });
    }
    cartTotalEl.textContent = formatNOK(totalNok());
    const empty = cart.size === 0;
    cashBtn.disabled = empty || isSubmitting;
    cardBtn.disabled = empty || isSubmitting;
  }

  function bumpProduct(p: ProductSummary): void {
    const existing = cart.get(p.id);
    if (existing) {
      existing.quantity += 1;
    } else {
      cart.set(p.id, { productId: p.id, name: p.name, unitPrice: p.price, quantity: 1 });
    }
    renderCart();
  }

  cartLinesEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-cart-action][data-pid]",
    );
    if (!btn) return;
    const pid = btn.dataset.pid!;
    const line = cart.get(pid);
    if (!line) return;
    switch (btn.dataset.cartAction) {
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

  // Wireframe §17.12: Cash / Card-knapper submitter ordren direkte uten
  // mellomliggende dropdown-modal.
  cashBtn.addEventListener("click", () => void submitOrder("CASH"));
  cardBtn.addEventListener("click", () => void submitOrder("CARD"));

  async function submitOrder(paymentMethod: ProductPaymentMethod): Promise<void> {
    if (isSubmitting || cart.size === 0) return;
    isSubmitting = true;
    cashBtn.disabled = true;
    cardBtn.disabled = true;
    try {
      const lines = Array.from(cart.values()).map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
      }));
      // Wireframe §17.12: kiosk-salg er anonym kontant-kunde i hall.
      const created = await createCart({ userType: "PHYSICAL", lines });
      // Backend krever expectedTotalCents som matcher cart-total — bruk
      // den autoritative verdien fra cart-create-respons.
      await finalizeCart(created.id, {
        paymentMethod,
        expectedTotalCents: created.totalCents,
        clientRequestId: makeClientRequestId(),
      });
      Toast.success(t("product_sale_success"));
      // Reset cart for next sale.
      cart.clear();
      isSubmitting = false;
      renderCart();
    } catch (err) {
      isSubmitting = false;
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      renderCart();
    }
  }

  void (async () => {
    try {
      const products = await listProducts();
      renderProducts(productGrid, products, bumpProduct);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      productGrid.innerHTML = `<p class="text-muted">${escapeHtml(t("no_products_available"))}</p>`;
    }
  })();

  // Initial empty-state render.
  renderCart();
}

function renderProducts(
  host: HTMLElement,
  products: ProductSummary[],
  onAdd: (p: ProductSummary) => void,
): void {
  host.innerHTML = "";
  if (products.length === 0) {
    host.innerHTML = `<p class="text-muted">${escapeHtml(t("no_products_available"))}</p>`;
    return;
  }
  for (const p of products) {
    const col = document.createElement("div");
    col.className = "col-sm-6 col-md-4";
    col.style.marginBottom = "12px";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-success btn-block";
    btn.style.minHeight = "72px";
    btn.disabled = !p.available;
    btn.innerHTML = `
      <strong>${escapeHtml(p.name)}</strong>
      <br>
      <small>${formatNOK(p.price)} kr</small>`;
    btn.addEventListener("click", () => onAdd(p));
    col.append(btn);
    host.append(col);
  }
}

/**
 * Generer en `clientRequestId` for idempotency. Backend kombinerer dette
 * med cartId for IdempotencyKeys, men `clientRequestId` kreves uansett
 * av rute-validering.
 */
function makeClientRequestId(): string {
  const w = window as unknown as { crypto?: { randomUUID?: () => string } };
  if (w.crypto?.randomUUID) return `kiosk-${w.crypto.randomUUID()}`;
  return `kiosk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
