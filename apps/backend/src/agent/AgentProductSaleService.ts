/**
 * BIN-583 B3.6: agent-siden av produkt-salg.
 *
 * Port of legacy `agentcashinoutController.{productCartPage, createCart,
 * productCheckoutPage, sellProductAgent}`. To-steg-flyt:
 *
 *   1. createCart — bygger draft-cart med `app_product_carts` +
 *      `app_product_cart_items`. Validerer hver product mot hall-binding.
 *   2. finalizeSale — commiter cart som finalized sale. Kjører wallet-
 *      debit hvis paymentMethod=CUSTOMER_NUMBER (matcher legacy's
 *      `sellProductTransactionInHall`-flyt). Oppdaterer shift cash-delta
 *      og hall-cash-balance.
 *
 * Payment-semantikk:
 *   - CASH   — øker dailyBalance + totalCashIn
 *   - CARD   — øker totalCardIn
 *   - CUSTOMER_NUMBER — wallet-debit på spiller, inkrementerer
 *     sellingByCustomerNumber
 *
 * Alle salg logger også en rad i `app_agent_transactions` (action_type=
 * PRODUCT_SALE) så rapportering kan slå sammen cash-ops og produkt-salg
 * i samme shift-aggregat.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { IdempotencyKeys } from "../game/idempotency.js";
import type { PlatformService } from "../platform/PlatformService.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import type { AgentService } from "./AgentService.js";
import type { AgentShiftService } from "./AgentShiftService.js";
import type { AgentStore, ShiftCashDelta } from "./AgentStore.js";
import type { AgentTransactionStore } from "./AgentTransactionStore.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-product-sale-service" });

export type ProductPaymentMethod = "CASH" | "CARD" | "CUSTOMER_NUMBER";
export type ProductCartStatus = "CART_CREATED" | "ORDER_PLACED" | "CANCELLED";
export type ProductCartUserType = "ONLINE" | "PHYSICAL";

export interface ProductCartLineInput {
  productId: string;
  quantity: number;
}

export interface CreateCartInput {
  agentUserId: string;
  userType: ProductCartUserType;
  username?: string | null;
  userId?: string | null;
  lines: ProductCartLineInput[];
}

export interface FinalizeCartInput {
  agentUserId: string;
  cartId: string;
  paymentMethod: ProductPaymentMethod;
  expectedTotalCents: number;
  clientRequestId: string;
}

export interface ProductCartLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface ProductCart {
  id: string;
  orderId: string;
  agentUserId: string;
  hallId: string;
  shiftId: string;
  userType: ProductCartUserType;
  userId: string | null;
  username: string | null;
  totalCents: number;
  status: ProductCartStatus;
  lines: ProductCartLine[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductSale {
  id: string;
  cartId: string;
  orderId: string;
  hallId: string;
  shiftId: string;
  agentUserId: string;
  playerUserId: string | null;
  paymentMethod: ProductPaymentMethod;
  totalCents: number;
  walletTxId: string | null;
  agentTxId: string | null;
  createdAt: string;
}

export interface AgentProductSaleServiceOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
  schema?: string;
  platformService: PlatformService;
  walletAdapter: WalletAdapter;
  agentService: AgentService;
  agentShiftService: AgentShiftService;
  agentStore: AgentStore;
  transactionStore: AgentTransactionStore;
}

interface CartRow {
  id: string;
  order_id: string;
  agent_user_id: string;
  hall_id: string;
  shift_id: string;
  user_type: ProductCartUserType;
  user_id: string | null;
  username: string | null;
  total_cents: string | number;
  status: ProductCartStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

interface LineRow {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price_cents: string | number;
  line_total_cents: string | number;
}

interface SaleRow {
  id: string;
  cart_id: string;
  order_id: string;
  hall_id: string;
  shift_id: string;
  agent_user_id: string;
  player_user_id: string | null;
  payment_method: ProductPaymentMethod;
  total_cents: string | number;
  wallet_tx_id: string | null;
  agent_tx_id: string | null;
  created_at: Date | string;
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function generateOrderId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.floor(100000 + Math.random() * 900000);
  return `ORD${ts}${rnd}`;
}

export class AgentProductSaleService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly platform: PlatformService;
  private readonly wallet: WalletAdapter;
  private readonly agents: AgentService;
  private readonly shifts: AgentShiftService;
  private readonly agentStore: AgentStore;
  private readonly txs: AgentTransactionStore;

  constructor(opts: AgentProductSaleServiceOptions) {
    this.schema = assertSchemaName(opts.schema ?? "public");
    if (opts.pool) {
      this.pool = opts.pool;
    } else if (opts.connectionString && opts.connectionString.trim()) {
      this.pool = new Pool({
        connectionString: opts.connectionString,
        ...getPoolTuning(),
      });
    } else {
      throw new DomainError(
        "INVALID_CONFIG",
        "AgentProductSaleService krever pool eller connectionString."
      );
    }
    this.platform = opts.platformService;
    this.wallet = opts.walletAdapter;
    this.agents = opts.agentService;
    this.shifts = opts.agentShiftService;
    this.agentStore = opts.agentStore;
    this.txs = opts.transactionStore;
  }

  /** @internal */
  static forTesting(
    pool: Pool,
    deps: Omit<AgentProductSaleServiceOptions, "connectionString" | "schema">,
    schema = "public"
  ): AgentProductSaleService {
    const svc = Object.create(AgentProductSaleService.prototype) as AgentProductSaleService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { platform: PlatformService }).platform = deps.platformService;
    (svc as unknown as { wallet: WalletAdapter }).wallet = deps.walletAdapter;
    (svc as unknown as { agents: AgentService }).agents = deps.agentService;
    (svc as unknown as { shifts: AgentShiftService }).shifts = deps.agentShiftService;
    (svc as unknown as { agentStore: AgentStore }).agentStore = deps.agentStore;
    (svc as unknown as { txs: AgentTransactionStore }).txs = deps.transactionStore;
    return svc;
  }

  private cartsTable(): string { return `"${this.schema}"."app_product_carts"`; }
  private itemsTable(): string { return `"${this.schema}"."app_product_cart_items"`; }
  private salesTable(): string { return `"${this.schema}"."app_product_sales"`; }
  private productsTable(): string { return `"${this.schema}"."app_products"`; }
  private hallProductsTable(): string { return `"${this.schema}"."app_hall_products"`; }

  // ── Cart creation ───────────────────────────────────────────────────────

  async createCart(input: CreateCartInput): Promise<ProductCart> {
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new DomainError("INVALID_INPUT", "lines er påkrevd og må ha minst én rad.");
    }
    if (input.lines.length > 50) {
      throw new DomainError("INVALID_INPUT", "Maks 50 linjer per cart.");
    }
    for (const line of input.lines) {
      if (!line.productId || typeof line.productId !== "string") {
        throw new DomainError("INVALID_INPUT", "productId er påkrevd per linje.");
      }
      if (!Number.isInteger(line.quantity) || line.quantity <= 0 || line.quantity > 999) {
        throw new DomainError("INVALID_INPUT", "quantity må være heltall 1-999.");
      }
    }

    const shift = await this.requireActiveShift(input.agentUserId);

    // Slå opp produkter + verifiser hall-binding i én query.
    const productIds = Array.from(new Set(input.lines.map((l) => l.productId)));
    const { rows: productRows } = await this.pool.query<{
      id: string;
      name: string;
      price_cents: string | number;
      status: "ACTIVE" | "INACTIVE";
      hall_active: boolean | null;
    }>(
      `SELECT p.id, p.name, p.price_cents, p.status,
              hp.is_active AS hall_active
       FROM ${this.productsTable()} p
       LEFT JOIN ${this.hallProductsTable()} hp
         ON hp.product_id = p.id AND hp.hall_id = $2
       WHERE p.id = ANY($1) AND p.deleted_at IS NULL`,
      [productIds, shift.hallId]
    );
    if (productRows.length !== productIds.length) {
      throw new DomainError("INVALID_INPUT", "Ett eller flere produkter finnes ikke.");
    }
    const productMap = new Map(productRows.map((r) => [r.id, r]));
    for (const pid of productIds) {
      const p = productMap.get(pid);
      if (!p) throw new DomainError("INVALID_INPUT", "Produkt ikke funnet.");
      if (p.status !== "ACTIVE") {
        throw new DomainError("PRODUCT_NOT_ACTIVE", `Produkt ${p.name} er inaktivt.`);
      }
      if (!p.hall_active) {
        throw new DomainError(
          "PRODUCT_NOT_IN_HALL",
          `Produkt ${p.name} selges ikke i denne hallen.`
        );
      }
    }

    // Validér user-lookup hvis user-type krever det.
    let userId: string | null = null;
    const username = input.username?.trim() || null;
    if (input.userType === "ONLINE") {
      if (!input.userId && !username) {
        throw new DomainError("INVALID_INPUT", "userId eller username er påkrevd for ONLINE.");
      }
      if (input.userId) {
        const user = await this.platform.getUserById(input.userId);
        if (user.role !== "PLAYER") {
          throw new DomainError("INVALID_INPUT", "user må være en PLAYER.");
        }
        userId = user.id;
      }
    }

    const totalCents = input.lines.reduce((sum, l) => {
      const p = productMap.get(l.productId)!;
      return sum + Number(p.price_cents) * l.quantity;
    }, 0);

    const cartId = `cart-${randomUUID()}`;
    const orderId = generateOrderId();

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO ${this.cartsTable()}
           (id, order_id, agent_user_id, hall_id, shift_id, user_type, user_id, username, total_cents, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'CART_CREATED')`,
        [cartId, orderId, input.agentUserId, shift.hallId, shift.id, input.userType, userId, username, totalCents]
      );
      for (const line of input.lines) {
        const p = productMap.get(line.productId)!;
        const unitPrice = Number(p.price_cents);
        const lineTotal = unitPrice * line.quantity;
        await client.query(
          `INSERT INTO ${this.itemsTable()}
             (cart_id, product_id, quantity, unit_price_cents, line_total_cents)
           VALUES ($1, $2, $3, $4, $5)`,
          [cartId, line.productId, line.quantity, unitPrice, lineTotal]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-583 B3.6] createCart failed");
      throw new DomainError("PRODUCT_CART_CREATE_FAILED", "Kunne ikke opprette cart.");
    } finally {
      client.release();
    }

    const cart = await this.getCart(cartId);
    return cart;
  }

  async getCart(cartId: string): Promise<ProductCart> {
    if (!cartId?.trim()) throw new DomainError("INVALID_INPUT", "cartId er påkrevd.");
    const { rows } = await this.pool.query<CartRow>(
      `SELECT id, order_id, agent_user_id, hall_id, shift_id, user_type, user_id, username,
              total_cents, status, created_at, updated_at
       FROM ${this.cartsTable()} WHERE id = $1`,
      [cartId]
    );
    const cart = rows[0];
    if (!cart) throw new DomainError("NOT_FOUND", "Cart finnes ikke.");
    const { rows: lineRows } = await this.pool.query<LineRow>(
      `SELECT ci.product_id, p.name AS product_name, ci.quantity, ci.unit_price_cents, ci.line_total_cents
       FROM ${this.itemsTable()} ci
       JOIN ${this.productsTable()} p ON p.id = ci.product_id
       WHERE ci.cart_id = $1`,
      [cartId]
    );
    return this.mapCart(cart, lineRows);
  }

  async cancelCart(cartId: string, agentUserId: string): Promise<ProductCart> {
    const cart = await this.getCart(cartId);
    if (cart.agentUserId !== agentUserId) {
      throw new DomainError("FORBIDDEN", "Kun agenten som opprettet cart kan kansellere.");
    }
    if (cart.status !== "CART_CREATED") {
      throw new DomainError(
        "CART_NOT_CANCELLABLE",
        `Cart har status ${cart.status} — kan ikke kanselleres.`
      );
    }
    await this.pool.query(
      `UPDATE ${this.cartsTable()} SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`,
      [cartId]
    );
    return this.getCart(cartId);
  }

  // ── Finalize sale ───────────────────────────────────────────────────────

  async finalizeSale(input: FinalizeCartInput): Promise<{ sale: ProductSale; cart: ProductCart }> {
    if (!["CASH", "CARD", "CUSTOMER_NUMBER"].includes(input.paymentMethod)) {
      throw new DomainError("INVALID_INPUT", "paymentMethod må være CASH, CARD eller CUSTOMER_NUMBER.");
    }
    if (!input.clientRequestId?.trim()) {
      throw new DomainError("INVALID_INPUT", "clientRequestId er påkrevd.");
    }

    const cart = await this.getCart(input.cartId);
    if (cart.agentUserId !== input.agentUserId) {
      throw new DomainError("FORBIDDEN", "Kun agenten som opprettet cart kan fullføre salget.");
    }
    if (cart.status !== "CART_CREATED") {
      throw new DomainError(
        "CART_NOT_FINALIZABLE",
        `Cart har status ${cart.status} — kan ikke fullføres.`
      );
    }
    if (cart.totalCents !== input.expectedTotalCents) {
      throw new DomainError(
        "CART_TOTAL_MISMATCH",
        `Forventet total ${input.expectedTotalCents} matchet ikke cart-total ${cart.totalCents}.`
      );
    }

    const shift = await this.shifts.getCurrentShift(input.agentUserId);
    if (!shift || shift.id !== cart.shiftId) {
      throw new DomainError(
        "SHIFT_MISMATCH",
        "Cart tilhører en annen shift enn agentens nåværende."
      );
    }

    const totalNok = cart.totalCents / 100;
    let walletTxId: string | null = null;
    let playerUserId: string | null = cart.userId;

    if (input.paymentMethod === "CUSTOMER_NUMBER") {
      if (!cart.userId) {
        throw new DomainError(
          "CUSTOMER_NUMBER_REQUIRES_USER",
          "Wallet-betaling krever at cart har user_id."
        );
      }
      const player = await this.platform.getUserById(cart.userId);
      if (player.role !== "PLAYER") {
        throw new DomainError("INVALID_INPUT", "user må være en PLAYER.");
      }
      const balance = await this.wallet.getBalance(player.walletId);
      if (balance < totalNok) {
        throw new DomainError(
          "INSUFFICIENT_BALANCE",
          "Spilleren har ikke nok penger i wallet."
        );
      }
      const idempotencyKey = IdempotencyKeys.agentProductSale({
        cartId: input.cartId,
      });
      const walletTx = await this.wallet.debit(
        player.walletId,
        totalNok,
        `product-sale shift=${shift.id} cart=${cart.id} clientReq=${input.clientRequestId}`,
        { idempotencyKey }
      );
      walletTxId = walletTx.id;
      playerUserId = player.id;
    }

    // Shift cash-delta.
    const delta: ShiftCashDelta = {};
    if (input.paymentMethod === "CASH") {
      delta.totalCashIn = totalNok;
      delta.dailyBalance = totalNok;
    } else if (input.paymentMethod === "CARD") {
      delta.totalCardIn = totalNok;
    } else {
      delta.sellingByCustomerNumber = totalNok;
    }
    await this.agentStore.applyShiftCashDelta(shift.id, delta);

    // Agent transaction log (PRODUCT_SALE).
    // Matcher legacy: enkelt-rad oppsummering per salg, gir rapportering
    // via AgentTransactionStore.list({ actionType: "PRODUCT_SALE" }).
    const agentTxId = `agenttx-${randomUUID()}`;
    // Koble til eksisterende PaymentMethod-enum — wallet → "WALLET",
    // card → "CARD", cash → "CASH".
    const legacyPayment =
      input.paymentMethod === "CUSTOMER_NUMBER" ? "WALLET" : input.paymentMethod;
    try {
      await this.txs.insert({
        id: agentTxId,
        shiftId: shift.id,
        agentUserId: input.agentUserId,
        playerUserId: playerUserId ?? input.agentUserId,
        hallId: shift.hallId,
        actionType: "PRODUCT_SALE",
        walletDirection: input.paymentMethod === "CUSTOMER_NUMBER" ? "DEBIT" : "CREDIT",
        paymentMethod: legacyPayment,
        amount: totalNok,
        previousBalance: 0,
        afterBalance: 0,
        walletTxId,
        notes: null,
        externalReference: cart.orderId,
        otherData: { cartId: cart.id, clientRequestId: input.clientRequestId },
      });
    } catch (err) {
      logger.warn({ err, cartId: cart.id }, "[BIN-583 B3.6] agent-tx insert failed — sale commits anyway");
    }

    // Sale-rad + mark cart som ORDER_PLACED.
    const saleId = `sale-${randomUUID()}`;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO ${this.salesTable()}
           (id, cart_id, order_id, hall_id, shift_id, agent_user_id, player_user_id,
            payment_method, total_cents, wallet_tx_id, agent_tx_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          saleId, cart.id, cart.orderId, cart.hallId, cart.shiftId, cart.agentUserId,
          playerUserId, input.paymentMethod, cart.totalCents, walletTxId, agentTxId,
        ]
      );
      await client.query(
        `UPDATE ${this.cartsTable()} SET status = 'ORDER_PLACED', updated_at = NOW() WHERE id = $1`,
        [cart.id]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof DomainError) throw err;
      logger.error({ err }, "[BIN-583 B3.6] finalizeSale commit failed");
      throw new DomainError("PRODUCT_SALE_COMMIT_FAILED", "Kunne ikke fullføre salg.");
    } finally {
      client.release();
    }

    const finalCart = await this.getCart(cart.id);
    const { rows } = await this.pool.query<SaleRow>(
      `SELECT id, cart_id, order_id, hall_id, shift_id, agent_user_id, player_user_id,
              payment_method, total_cents, wallet_tx_id, agent_tx_id, created_at
       FROM ${this.salesTable()} WHERE id = $1`,
      [saleId]
    );
    return { sale: this.mapSale(rows[0]), cart: finalCart };
  }

  async listSalesForShift(shiftId: string, opts: { limit?: number } = {}): Promise<ProductSale[]> {
    const limit = opts.limit && opts.limit > 0 ? Math.min(Math.floor(opts.limit), 500) : 200;
    const { rows } = await this.pool.query<SaleRow>(
      `SELECT id, cart_id, order_id, hall_id, shift_id, agent_user_id, player_user_id,
              payment_method, total_cents, wallet_tx_id, agent_tx_id, created_at
       FROM ${this.salesTable()} WHERE shift_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [shiftId, limit]
    );
    return rows.map((r) => this.mapSale(r));
  }

  /**
   * PDF 17 §17.29 "Order History":
   * Lister produktsalg innenfor et dato-vindu. Filtre:
   *   - hallId — påkrevd hvis ikke ADMIN.
   *   - agentUserId — kun se egne salg (AGENT). HALL_OPERATOR/ADMIN kan se
   *     alle salg i hallen.
   *   - paymentMethod — CASH, CARD, CUSTOMER_NUMBER.
   *   - ticketIdPrefix gjenbrukt for å søke i orderId.
   *
   * Sortert nyeste først. Maks 500 rader per oppslag.
   */
  async listSalesForAgent(opts: {
    hallId?: string;
    agentUserId?: string;
    from: string;
    to: string;
    paymentMethod?: ProductPaymentMethod;
    orderIdPrefix?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ sales: ProductSale[]; total: number }> {
    if (!opts.from?.trim()) throw new DomainError("INVALID_INPUT", "from er påkrevd.");
    if (!opts.to?.trim()) throw new DomainError("INVALID_INPUT", "to er påkrevd.");
    const limit = opts.limit && opts.limit > 0 ? Math.min(Math.floor(opts.limit), 500) : 100;
    const offset = opts.offset && opts.offset > 0 ? Math.floor(opts.offset) : 0;
    const conditions: string[] = ["created_at >= $1", "created_at <= $2"];
    const params: unknown[] = [opts.from, opts.to];
    if (opts.hallId?.trim()) {
      params.push(opts.hallId.trim());
      conditions.push(`hall_id = $${params.length}`);
    }
    if (opts.agentUserId?.trim()) {
      params.push(opts.agentUserId.trim());
      conditions.push(`agent_user_id = $${params.length}`);
    }
    if (opts.paymentMethod) {
      params.push(opts.paymentMethod);
      conditions.push(`payment_method = $${params.length}`);
    }
    if (opts.orderIdPrefix?.trim()) {
      params.push(`%${opts.orderIdPrefix.trim()}%`);
      conditions.push(`order_id ILIKE $${params.length}`);
    }
    const where = conditions.join(" AND ");

    const { rows: countRows } = await this.pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM ${this.salesTable()} WHERE ${where}`,
      params
    );
    const total = Number(countRows[0]?.c ?? 0);

    params.push(limit);
    params.push(offset);
    const { rows } = await this.pool.query<SaleRow>(
      `SELECT id, cart_id, order_id, hall_id, shift_id, agent_user_id, player_user_id,
              payment_method, total_cents, wallet_tx_id, agent_tx_id, created_at
       FROM ${this.salesTable()} WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { sales: rows.map((r) => this.mapSale(r)), total };
  }

  /**
   * PDF 17 §17.30 "View Order Details":
   * Henter et produktsalg sammen med tilhørende cart-linjer, så
   * agent kan vise produkt-listen på order-detail.
   */
  async getSaleWithLines(
    saleId: string
  ): Promise<{ sale: ProductSale; cart: ProductCart } | null> {
    if (!saleId?.trim()) {
      throw new DomainError("INVALID_INPUT", "saleId er påkrevd.");
    }
    const { rows } = await this.pool.query<SaleRow>(
      `SELECT id, cart_id, order_id, hall_id, shift_id, agent_user_id, player_user_id,
              payment_method, total_cents, wallet_tx_id, agent_tx_id, created_at
       FROM ${this.salesTable()} WHERE id = $1`,
      [saleId.trim()]
    );
    const sale = rows[0];
    if (!sale) return null;
    const cart = await this.getCart(sale.cart_id);
    return { sale: this.mapSale(sale), cart };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async requireActiveShift(agentUserId: string) {
    await this.agents.requireActiveAgent(agentUserId);
    const shift = await this.shifts.getCurrentShift(agentUserId);
    if (!shift) {
      throw new DomainError("NO_ACTIVE_SHIFT", "Du må åpne en shift først.");
    }
    return shift;
  }

  private mapCart(row: CartRow, lineRows: LineRow[]): ProductCart {
    return {
      id: row.id,
      orderId: row.order_id,
      agentUserId: row.agent_user_id,
      hallId: row.hall_id,
      shiftId: row.shift_id,
      userType: row.user_type,
      userId: row.user_id,
      username: row.username,
      totalCents: Number(row.total_cents),
      status: row.status,
      lines: lineRows.map((l) => ({
        productId: l.product_id,
        productName: l.product_name,
        quantity: Number(l.quantity),
        unitPriceCents: Number(l.unit_price_cents),
        lineTotalCents: Number(l.line_total_cents),
      })),
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
    };
  }

  private mapSale(row: SaleRow): ProductSale {
    return {
      id: row.id,
      cartId: row.cart_id,
      orderId: row.order_id,
      hallId: row.hall_id,
      shiftId: row.shift_id,
      agentUserId: row.agent_user_id,
      playerUserId: row.player_user_id,
      paymentMethod: row.payment_method,
      totalCents: Number(row.total_cents),
      walletTxId: row.wallet_tx_id,
      agentTxId: row.agent_tx_id,
      createdAt: asIso(row.created_at),
    };
  }
}
