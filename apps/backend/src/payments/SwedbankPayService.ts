import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { getPoolTuning } from "../util/pgPool.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import { DomainError } from "../game/BingoEngine.js";

/**
 * Scenario A (2026-04-26): supported payment methods.
 *
 * REGULATORY: Norwegian pengespillforskrift forbids credit cards as
 * payment for gambling. We therefore expose only DEBIT-variants for
 * card-based payments. Vipps (mobile-pay) is routed via Swedbank Pay's
 * MobilePay/Vipps integration, and Apple Pay / Google Pay are handled
 * by Swedbank's checkout widget itself (we just forward the choice).
 */
export type PaymentMethod =
  | "VIPPS"
  | "VISA_DEBIT"
  | "MASTERCARD_DEBIT"
  | "APPLE_PAY"
  | "GOOGLE_PAY";

export const SUPPORTED_PAYMENT_METHODS: ReadonlyArray<PaymentMethod> = [
  "VIPPS",
  "VISA_DEBIT",
  "MASTERCARD_DEBIT",
  "APPLE_PAY",
  "GOOGLE_PAY",
];

export type CardFundingType = "DEBIT" | "CREDIT" | "PREPAID" | "DEFERRED_DEBIT" | "UNKNOWN";

export interface CreateSwedbankTopupIntentInput {
  userId: string;
  walletId: string;
  amountMajor: number;
  userAgent?: string;
  /** Scenario A: required for new flow; legacy callers may omit. */
  paymentMethod?: PaymentMethod;
  /** For VIPPS: optional pre-fill of phone-number (E.164 / Norwegian mobile). */
  vippsPhoneNumber?: string;
}

export interface SwedbankTopupIntent {
  id: string;
  provider: "swedbankpay";
  userId: string;
  walletId: string;
  orderReference: string;
  payeeReference: string;
  paymentOrderId: string;
  amountMajor: number;
  amountMinor: number;
  currency: string;
  status: string;
  redirectUrl?: string;
  viewUrl?: string;
  creditedTransactionId?: string;
  creditedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  /** Scenario A. */
  paymentMethod?: PaymentMethod;
  cardFundingType?: CardFundingType;
  cardBrand?: string;
  rejectedAt?: string;
  rejectionReason?: string;
}

export interface SwedbankReconcileResult {
  intent: SwedbankTopupIntent;
  walletCreditedNow: boolean;
}

export interface AuditLogger {
  record(input: {
    actorId: string | null;
    actorType: "USER" | "SYSTEM";
    action: string;
    resource: string;
    resourceId: string | null;
    details?: Record<string, unknown>;
  }): Promise<void>;
}

export interface SwedbankPayServiceOptions {
  /**
   * DB-P0-002: shared pool injection (preferred). When set, the service
   * does not create its own pool. `connectionString` is ignored.
   */
  pool?: Pool;
  connectionString?: string;
  schema: string;
  apiBaseUrl?: string;
  accessToken?: string;
  payeeId?: string;
  payeeName?: string;
  productName?: string;
  currency?: string;
  language?: string;
  merchantBaseUrl?: string;
  callbackUrl?: string;
  completeUrl?: string;
  cancelUrl?: string;
  termsOfServiceUrl?: string;
  requestTimeoutMs?: number;
}

interface OperationLink {
  rel: string;
  href: string;
}

interface SwedbankIntentRow {
  id: string;
  provider: string;
  user_id: string;
  wallet_id: string;
  order_reference: string;
  payee_reference: string;
  swedbank_payment_order_id: string;
  amount_minor: string;
  amount_major: string;
  currency: string;
  status: string;
  checkout_redirect_url: string | null;
  checkout_view_url: string | null;
  credited_transaction_id: string | null;
  credited_at: Date | string | null;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  /** Scenario A. */
  payment_method?: string | null;
  card_funding_type?: string | null;
  card_brand?: string | null;
  rejected_at?: Date | string | null;
  rejection_reason?: string | null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value !== "number") {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function extractProblemsSummary(root: Record<string, unknown> | null): string | undefined {
  if (!root) {
    return undefined;
  }
  const rawProblems = root.problems;
  if (!Array.isArray(rawProblems) || rawProblems.length === 0) {
    return undefined;
  }

  const summaries = rawProblems
    .map((problem) => {
      const parsed = asObject(problem);
      if (!parsed) {
        return undefined;
      }
      const name = asString(parsed.name);
      const description = asString(parsed.description);
      if (name && description) {
        return `${name}: ${description}`;
      }
      return name || description || undefined;
    })
    .filter((entry): entry is string => Boolean(entry));

  if (!summaries.length) {
    return undefined;
  }

  return summaries.slice(0, 3).join(" | ");
}

function asDateIso(value: Date | string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function assertSchemaName(schema: string): string {
  const trimmed = schema.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new DomainError("INVALID_CONFIG", "SWEDBANK_PAY schema er ugyldig.");
  }
  return trimmed;
}

function normalizeBaseUrl(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (!isHttpUrl(trimmed)) {
    throw new DomainError("INVALID_CONFIG", `${fieldName} må være en full http/https URL.`);
  }
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function toMinorUnits(amountMajor: number): number {
  if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
    throw new DomainError("INVALID_INPUT", "amount må være større enn 0.");
  }
  const minor = Math.round(amountMajor * 100);
  if (!Number.isFinite(minor) || minor <= 0) {
    throw new DomainError("INVALID_INPUT", "amount er ugyldig.");
  }
  return minor;
}

function fromMinorUnits(amountMinor: number): number {
  return amountMinor / 100;
}

function randomReference(prefix: string, length: number): string {
  const base = `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e9)
    .toString(36)
    .toUpperCase()}`;
  return base
    .replace(/[^A-Za-z0-9-]/g, "")
    .toUpperCase()
    .slice(0, length);
}

function normalizePaymentOrderId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new DomainError("SWEDBANK_INVALID_RESPONSE", "Mangler payment order id fra Swedbank.");
  }

  if (isHttpUrl(trimmed)) {
    const url = new URL(trimmed);
    return `${url.pathname}${url.search}`;
  }

  if (!trimmed.startsWith("/")) {
    return `/${trimmed}`;
  }
  return trimmed;
}

function normalizeSwedbankStatus(value: string | undefined): string {
  if (!value) {
    return "UNKNOWN";
  }
  return value.trim().toUpperCase();
}

function isPaidStatus(value: string | undefined): boolean {
  const status = normalizeSwedbankStatus(value);
  return status === "PAID" || status === "FULLYPAID";
}

// ── Scenario A helpers ─────────────────────────────────────────────────────

export function normalisePaymentMethod(value: unknown): PaymentMethod {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_PAYMENT_METHOD", "paymentMethod mangler.");
  }
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  const matches = SUPPORTED_PAYMENT_METHODS.find((m) => m === normalized);
  if (!matches) {
    throw new DomainError(
      "INVALID_PAYMENT_METHOD",
      `paymentMethod må være en av: ${SUPPORTED_PAYMENT_METHODS.join(", ")}.`
    );
  }
  return matches;
}

/**
 * Convert our public PaymentMethod enum into the `instrument` array
 * that Swedbank Pay's paymentorder API expects to constrain which
 * payment instruments the checkout widget will display.
 *
 * REGULATORY: Visa/Mastercard always restricted to the DEBIT-only
 * brand-codes — never plain "VISA" or "MASTERCARD" which would also
 * accept credit. The exact codes follow Swedbank Pay's brand-list
 * (https://developer.swedbankpay.com/checkout-v3/payments-only/...).
 */
export function paymentMethodToSwedbankInstruments(method: PaymentMethod): string[] {
  switch (method) {
    case "VIPPS":
      return ["Vipps"];
    case "VISA_DEBIT":
      return ["VisaDebit"];
    case "MASTERCARD_DEBIT":
      return ["MastercardDebit"];
    case "APPLE_PAY":
      return ["ApplePay"];
    case "GOOGLE_PAY":
      return ["GooglePay"];
    /* c8 ignore next 2 */
    default:
      throw new DomainError("INVALID_PAYMENT_METHOD", "Ukjent paymentMethod.");
  }
}

/**
 * Normalise funding-type from Swedbank's paid-resource. Swedbank uses
 * lower-case "debit" / "credit" / "prepaid"; we store upper-case for
 * consistency with our other enums.
 */
export function normaliseCardFundingType(value: unknown): CardFundingType | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "DEBIT" ||
    normalized === "CREDIT" ||
    normalized === "PREPAID" ||
    normalized === "DEFERRED_DEBIT"
  ) {
    return normalized;
  }
  return "UNKNOWN";
}

/**
 * Validates that a card-payment was authorised on a debit-card.
 * Returns true if the funding-type is acceptable; false means we MUST
 * reject + refund because pengespillforskriften forbids credit cards.
 *
 * Mobile-wallet methods (Vipps / Apple Pay / Google Pay) are tied to
 * the user's underlying funding source, which Swedbank validates on
 * its side; we treat funding-type as advisory for those.
 */
export function isAcceptableFundingType(
  method: PaymentMethod,
  fundingType: CardFundingType | undefined
): boolean {
  if (method === "VIPPS" || method === "APPLE_PAY" || method === "GOOGLE_PAY") {
    // Mobile wallets — funding-type is informational only.
    return true;
  }
  // Card methods (Visa Debit / Mastercard Debit) — STRICT debit-only.
  return fundingType === "DEBIT";
}

export class SwedbankPayService {
  private readonly pool: Pool;

  private readonly schema: string;

  private readonly apiBaseUrl: string;

  private readonly accessToken: string;

  private readonly payeeId: string;

  private readonly payeeName: string;

  private readonly productName: string;

  private readonly currency: string;

  private readonly language: string;

  private readonly merchantBaseUrl: string;

  private readonly callbackUrl: string;

  private readonly completeUrl: string;

  private readonly cancelUrl: string;

  private readonly termsOfServiceUrl: string;

  private readonly requestTimeoutMs: number;

  private initPromise: Promise<void> | null = null;

  /**
   * Scenario A: optional audit-logger. When set, every successful
   * top-up emits `payment.online.completed` with paymentMethod /
   * cardFundingType / amountCents — required by pengespillforskriften
   * audit-trail. Optional so tests / legacy boot-paths can omit it.
   */
  private auditLogger: AuditLogger | null = null;

  setAuditLogger(logger: AuditLogger | null): void {
    this.auditLogger = logger;
  }

  constructor(
    private readonly walletAdapter: WalletAdapter,
    options: SwedbankPayServiceOptions
  ) {

    this.schema = assertSchemaName(options.schema || "public");

    this.apiBaseUrl = normalizeBaseUrl(
      options.apiBaseUrl || "https://api.externalintegration.payex.com",
      "SWEDBANK_PAY_API_BASE_URL"
    );
    this.accessToken = (options.accessToken || "").trim();
    this.payeeId = (options.payeeId || "").trim();
    this.payeeName = (options.payeeName || "Bingo").trim();
    this.productName = (options.productName || "Checkout3").trim();
    this.currency = (options.currency || "NOK").trim().toUpperCase();
    this.language = (options.language || "nb-NO").trim();
    this.merchantBaseUrl = normalizeBaseUrl(options.merchantBaseUrl || "", "SWEDBANK_PAY_MERCHANT_BASE_URL");
    this.callbackUrl = (options.callbackUrl || "").trim();
    this.completeUrl = (options.completeUrl || "").trim();
    this.cancelUrl = (options.cancelUrl || "").trim();
    this.termsOfServiceUrl = (options.termsOfServiceUrl || "").trim();
    this.requestTimeoutMs = Math.max(1000, Math.floor(options.requestTimeoutMs ?? 10000));

    if (options.pool) {
      this.pool = options.pool;
    } else if (options.connectionString && options.connectionString.trim()) {
      this.pool = new Pool({
        connectionString: options.connectionString,
        ...getPoolTuning(),
      });
    } else {
      throw new DomainError(
        "INVALID_CONFIG",
        "SwedbankPayService krever pool eller connectionString."
      );
    }
  }

  isConfigured(): boolean {
    const hasUrls =
      (this.callbackUrl.length > 0 && this.completeUrl.length > 0 && this.cancelUrl.length > 0) ||
      this.merchantBaseUrl.length > 0;
    return this.accessToken.length > 0 && this.payeeId.length > 0 && hasUrls;
  }

  async createTopupIntent(input: CreateSwedbankTopupIntentInput): Promise<SwedbankTopupIntent> {
    await this.ensureInitialized();
    this.assertConfigured();

    const userId = input.userId.trim();
    const walletId = input.walletId.trim();
    if (!userId || !walletId) {
      throw new DomainError("INVALID_INPUT", "Mangler userId eller walletId for top-up intent.");
    }

    // Scenario A: paymentMethod is required for new flow. Default to
    // VISA_DEBIT for legacy callers (preserves backwards-compat for
    // existing /api/payments/swedbank/topup-intent without breaking
    // schema). New `/api/payments/topup-online` REQUIRES it.
    const paymentMethod: PaymentMethod = input.paymentMethod
      ? normalisePaymentMethod(input.paymentMethod)
      : "VISA_DEBIT";

    const vippsPhoneNumber =
      paymentMethod === "VIPPS" && input.vippsPhoneNumber
        ? input.vippsPhoneNumber.replace(/\s+/g, "")
        : undefined;

    const amountMinor = toMinorUnits(input.amountMajor);
    const amountMajor = fromMinorUnits(amountMinor);
    const intentId = randomUUID();
    const orderReference = randomReference("TOPUP", 40);
    const payeeReference = randomReference("TP", 30);

    const completeUrl = this.withQuery(this.resolveCompleteUrl(), {
      swedbank_intent: intentId,
      swedbank_result: "complete"
    });
    const cancelUrl = this.withQuery(this.resolveCancelUrl(), {
      swedbank_intent: intentId,
      swedbank_result: "cancel"
    });
    const callbackUrl = this.resolveCallbackUrl();
    const hostUrls = this.resolveHostUrls(completeUrl, cancelUrl, callbackUrl);

    // REGULATORY (pengespillforskriften): force Swedbank to only display
    // the explicitly chosen instrument. For VISA_DEBIT / MASTERCARD_DEBIT
    // we constrain the brand-list to debit-only variants so the user
    // CANNOT pick a credit card in the widget. Final defence-in-depth is
    // in reconcileRow which double-checks cardFundingType.
    const instruments = paymentMethodToSwedbankInstruments(paymentMethod);

    const payload: Record<string, unknown> = {
      paymentorder: {
        operation: "Purchase",
        intent: "Authorization",
        currency: this.currency,
        amount: amountMinor,
        vatAmount: 0,
        description: `Wallet top-up ${walletId}`.slice(0, 40),
        userAgent: input.userAgent?.trim() || "BingoBackend/0.1",
        language: this.language,
        productName: this.productName,
        instrument: instruments[0],
        restrictedToInstruments: instruments,
        urls: {
          hostUrls,
          completeUrl,
          cancelUrl,
          callbackUrl,
          ...(this.termsOfServiceUrl ? { termsOfServiceUrl: this.termsOfServiceUrl } : {})
        },
        payeeInfo: {
          payeeId: this.payeeId,
          payeeReference,
          orderReference,
          ...(this.payeeName ? { payeeName: this.payeeName } : {})
        },
        orderItems: [
          {
            reference: `wallet-${walletId}`.slice(0, 50),
            name: "Wallet Top-up",
            type: "PRODUCT",
            class: "TopUp",
            quantity: 1,
            quantityUnit: "pcs",
            unitPrice: amountMinor,
            amount: amountMinor,
            vatAmount: 0,
            vatPercent: 0
          }
        ],
        metadata: {
          intentId,
          userId,
          walletId,
          paymentMethod
        },
        ...(vippsPhoneNumber
          ? { vipps: { msisdn: vippsPhoneNumber } }
          : {})
      }
    };

    const created = await this.request("POST", "/psp/paymentorders", payload);
    const paymentOrderId = this.extractPaymentOrderId(created);
    const status = this.extractPaymentOrderStatus(created);
    const operations = this.extractOperations(created);
    const redirectUrl = this.findOperationUrl(operations, "redirect-checkout");
    const viewUrl = this.findOperationUrl(operations, "view-checkout");

    const { rows } = await this.pool.query<SwedbankIntentRow>(
      `INSERT INTO ${this.intentsTable()} (
        id,
        provider,
        user_id,
        wallet_id,
        order_reference,
        payee_reference,
        swedbank_payment_order_id,
        amount_minor,
        amount_major,
        currency,
        status,
        checkout_redirect_url,
        checkout_view_url,
        raw_create_response,
        payment_method
      )
      VALUES ($1, 'swedbankpay', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
      RETURNING ${this.intentRowColumns}`,
      [
        intentId,
        userId,
        walletId,
        orderReference,
        payeeReference,
        paymentOrderId,
        amountMinor,
        amountMajor.toFixed(2),
        this.currency,
        status,
        redirectUrl ?? null,
        viewUrl ?? null,
        JSON.stringify(created),
        paymentMethod
      ]
    );

    return this.mapRow(rows[0]);
  }

  async getIntentForUser(intentId: string, userId: string): Promise<SwedbankTopupIntent> {
    await this.ensureInitialized();
    const row = await this.getIntentRowForUser(intentId, userId);
    if (!row) {
      throw new DomainError("PAYMENT_INTENT_NOT_FOUND", "Fant ikke Swedbank intent for bruker.");
    }
    return this.mapRow(row);
  }

  /**
   * REQ-137: list åpne (ikke-fullførte) deposit-intents for en bruker
   * som er yngre enn `maxAgeHours` (default 24t). Brukes av
   * GET /api/payments/pending-deposit til å rendre lobby-popup-reminder.
   *
   * Status-filter speiler `swedbankPaymentSync`-cronen: vi ignorerer
   * intents som er PAID/CREDITED/FAILED/EXPIRED/CANCELLED. Resterende
   * statuser (INITIALIZED, AWAITING_CONSUMER, etc.) regnes som
   * "påbegynt men ikke fullført" og dermed reminder-kandidater.
   */
  async listPendingIntentsForUser(
    userId: string,
    maxAgeHours = 24
  ): Promise<SwedbankTopupIntent[]> {
    await this.ensureInitialized();
    const trimmedUserId = userId.trim();
    if (!trimmedUserId) {
      throw new DomainError("INVALID_INPUT", "Mangler userId for pending-deposit-oppslag.");
    }
    const safeHours = Number.isFinite(maxAgeHours) && maxAgeHours > 0 ? Math.floor(maxAgeHours) : 24;

    const { rows } = await this.pool.query<SwedbankIntentRow>(
      `SELECT
         id,
         provider,
         user_id,
         wallet_id,
         order_reference,
         payee_reference,
         swedbank_payment_order_id,
         amount_minor,
         amount_major,
         currency,
         status,
         checkout_redirect_url,
         checkout_view_url,
         credited_transaction_id,
         credited_at,
         last_error,
         created_at,
         updated_at
       FROM ${this.intentsTable()}
       WHERE user_id = $1
         AND status NOT IN ('PAID', 'CREDITED', 'FAILED', 'EXPIRED', 'CANCELLED')
         AND created_at >= now() - ($2 || ' hours')::interval
       ORDER BY created_at DESC`,
      [trimmedUserId, String(safeHours)]
    );

    return rows.map((row) => this.mapRow(row));
  }

  /**
   * REQ-137: stamp `last_reminded_at` for å markere at klient har
   * vist reminderen. Returnerer antall rader som ble oppdatert.
   * Tabell-kolonnen er lagt til i migration
   * 20260902000000_swedbank_intent_last_reminded_at.sql; hvis den
   * mangler (f.eks. dev uten migration kjørt) faller vi gracefully
   * tilbake til 0 uten å kaste.
   */
  async markIntentReminded(intentId: string, userId: string): Promise<boolean> {
    await this.ensureInitialized();
    const trimmedId = intentId.trim();
    const trimmedUser = userId.trim();
    if (!trimmedId || !trimmedUser) {
      return false;
    }
    try {
      const result = await this.pool.query(
        `UPDATE ${this.intentsTable()}
         SET last_reminded_at = now(),
             updated_at = now()
         WHERE id = $1
           AND user_id = $2`,
        [trimmedId, trimmedUser]
      );
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      // Hvis kolonnen ennå ikke er migrert (PG-feil 42703 undefined_column)
      // returnerer vi false — feature degraderer trygt til klient-styrt
      // intervall uten at endpoint feiler.
      const code = (error as { code?: string }).code;
      if (code === "42703") {
        return false;
      }
      throw error;
    }
  }

  async reconcileIntentForUser(intentId: string, userId: string): Promise<SwedbankReconcileResult> {
    await this.ensureInitialized();
    const row = await this.getIntentRowForUser(intentId, userId);
    if (!row) {
      throw new DomainError("PAYMENT_INTENT_NOT_FOUND", "Fant ikke Swedbank intent for bruker.");
    }
    return this.reconcileRow(row);
  }

  async processCallback(payload: unknown): Promise<SwedbankReconcileResult> {
    await this.ensureInitialized();
    const callback = asObject(payload);
    const paymentOrder = asObject(callback?.paymentOrder);
    const paymentOrderId = asString(paymentOrder?.id);
    const orderReference = asString(callback?.orderReference);

    let row: SwedbankIntentRow | null = null;
    if (orderReference) {
      row = await this.findIntentByOrderReference(orderReference);
    }

    if (!row && paymentOrderId) {
      row = await this.findIntentByPaymentOrderId(normalizePaymentOrderId(paymentOrderId));
    }

    if (!row) {
      throw new DomainError("PAYMENT_INTENT_NOT_FOUND", "Callback peker til ukjent Swedbank intent.");
    }

    if (paymentOrderId && normalizePaymentOrderId(paymentOrderId) !== row.swedbank_payment_order_id) {
      await this.pool.query(
        `UPDATE ${this.intentsTable()}
         SET swedbank_payment_order_id = $2,
             updated_at = now()
         WHERE id = $1`,
        [row.id, normalizePaymentOrderId(paymentOrderId)]
      );
      row.swedbank_payment_order_id = normalizePaymentOrderId(paymentOrderId);
    }

    return this.reconcileRow(row);
  }

  private async reconcileRow(row: SwedbankIntentRow): Promise<SwedbankReconcileResult> {
    if (row.credited_at) {
      return {
        intent: this.mapRow(row),
        walletCreditedNow: false
      };
    }

    const paymentOrder = await this.fetchPaymentOrder(row.swedbank_payment_order_id);
    const remoteStatus = normalizeSwedbankStatus(this.extractPaymentOrderStatus(paymentOrder));
    const remoteAmountMinor = this.extractPaymentOrderAmountMinor(paymentOrder);
    const remoteCurrency = this.extractPaymentOrderCurrency(paymentOrder);
    const fundingType = this.extractCardFundingType(paymentOrder);
    const cardBrand = this.extractCardBrand(paymentOrder);

    if (remoteAmountMinor !== undefined && Number(row.amount_minor) !== remoteAmountMinor) {
      const message = "Swedbank amount matcher ikke opprinnelig top-up intent.";
      await this.updateIntentError(row.id, "FAILED", message, paymentOrder);
      throw new DomainError("SWEDBANK_AMOUNT_MISMATCH", message);
    }

    if (remoteCurrency && remoteCurrency.toUpperCase() !== row.currency.toUpperCase()) {
      const message = "Swedbank currency matcher ikke opprinnelig top-up intent.";
      await this.updateIntentError(row.id, "FAILED", message, paymentOrder);
      throw new DomainError("SWEDBANK_CURRENCY_MISMATCH", message);
    }

    if (!isPaidStatus(remoteStatus)) {
      const pendingRow = await this.updateIntentStatus(row.id, remoteStatus, paymentOrder);
      return {
        intent: this.mapRow(pendingRow),
        walletCreditedNow: false
      };
    }

    // REGULATORY (pengespillforskriften §): debit-only enforcement.
    // For card-based flows, fundingType MUST be DEBIT. If we see CREDIT
    // (or any other non-debit value), reject the payment authoritatively
    // BEFORE crediting the wallet — the customer's bank will be reversed
    // by Swedbank's standard cancel-flow when we never capture.
    const paymentMethod = (row.payment_method as PaymentMethod | null | undefined) ?? undefined;
    if (paymentMethod && !isAcceptableFundingType(paymentMethod, fundingType)) {
      const message = "Kun debetkort er tillatt for innskudd.";
      await this.markIntentRejected(row.id, "CREDIT_CARD_FORBIDDEN", paymentOrder, fundingType, cardBrand);
      // Best-effort cancellation request to Swedbank (no capture, no
      // settlement). If the cancel-call fails we still leave the row in
      // REJECTED state — wallet was never credited so no money moved.
      await this.attemptCancelPaymentOrder(row.swedbank_payment_order_id).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn("[swedbank] cancel after credit-card rejection failed", err);
      });
      // Audit-log (fire-and-forget — must not block the rejection path).
      void this.recordAudit({
        actorId: row.user_id,
        actorType: "USER",
        action: "payment.online.rejected",
        resource: "swedbank_payment_intent",
        resourceId: row.id,
        details: {
          reason: "CREDIT_CARD_FORBIDDEN",
          paymentMethod,
          cardFundingType: fundingType ?? null,
          cardBrand: cardBrand ?? null,
          amountCents: Number(row.amount_minor),
          currency: row.currency,
        },
      });
      throw new DomainError("CREDIT_CARD_FORBIDDEN", message);
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await this.getIntentRowForUpdate(client, row.id);
      if (!locked) {
        throw new DomainError("PAYMENT_INTENT_NOT_FOUND", "Fant ikke intent under avstemming.");
      }

      if (locked.credited_at) {
        await client.query("COMMIT");
        return {
          intent: this.mapRow(locked),
          walletCreditedNow: false
        };
      }

      const tx = await this.walletAdapter.topUp(
        locked.wallet_id,
        Number(locked.amount_major),
        `Swedbank top-up ${locked.order_reference}`
      );

      const { rows } = await client.query<SwedbankIntentRow>(
        `UPDATE ${this.intentsTable()}
         SET status = 'CREDITED',
             raw_latest_status = $2::jsonb,
             credited_transaction_id = $3,
             credited_at = now(),
             card_funding_type = COALESCE($4, card_funding_type),
             card_brand = COALESCE($5, card_brand),
             last_error = NULL,
             updated_at = now()
         WHERE id = $1
         RETURNING ${this.intentRowColumns}`,
        [locked.id, JSON.stringify(paymentOrder), tx.id, fundingType ?? null, cardBrand ?? null]
      );

      await client.query("COMMIT");

      // Audit-log (fire-and-forget). REGULATORY: every successful online
      // top-up is logged for pengespillforskriften audit-trail.
      void this.recordAudit({
        actorId: locked.user_id,
        actorType: "USER",
        action: "payment.online.completed",
        resource: "swedbank_payment_intent",
        resourceId: locked.id,
        details: {
          paymentMethod,
          cardFundingType: fundingType ?? null,
          cardBrand: cardBrand ?? null,
          amountCents: Number(locked.amount_minor),
          currency: locked.currency,
          walletTransactionId: tx.id,
        },
      });

      return {
        intent: this.mapRow(rows[0]),
        walletCreditedNow: true
      };
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof DomainError) {
        throw error;
      }
      throw new DomainError("SWEDBANK_RECONCILE_ERROR", "Kunne ikke avstemme Swedbank-betaling.");
    } finally {
      client.release();
    }
  }

  private async markIntentRejected(
    intentId: string,
    reason: string,
    rawLatestStatus: unknown,
    fundingType: CardFundingType | undefined,
    cardBrand: string | undefined
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.intentsTable()}
       SET status = 'REJECTED',
           rejected_at = now(),
           rejection_reason = $2,
           card_funding_type = COALESCE($3, card_funding_type),
           card_brand = COALESCE($4, card_brand),
           raw_latest_status = $5::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [intentId, reason, fundingType ?? null, cardBrand ?? null, JSON.stringify(rawLatestStatus)]
    );
  }

  /**
   * Best-effort cancel of a Swedbank paymentOrder. Used when we reject
   * a payment post-authorisation (eg credit-card-attempt). Failures are
   * non-fatal — the wallet was never credited.
   */
  private async attemptCancelPaymentOrder(paymentOrderId: string): Promise<void> {
    if (!paymentOrderId) {
      return;
    }
    const cancelPath = `${paymentOrderId}/cancellations`;
    await this.request("POST", cancelPath, {
      transaction: {
        description: "Spillorama: kredittkort ikke tillatt — automatisk kansellering",
        payeeReference: randomReference("CXL", 30),
      },
    }).catch((err: unknown) => {
      // Swallow specific Swedbank shapes we can't act on.
      throw err;
    });
  }

  private async recordAudit(input: {
    actorId: string | null;
    actorType: "USER" | "SYSTEM";
    action: string;
    resource: string;
    resourceId: string | null;
    details?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.auditLogger) {
      return;
    }
    try {
      await this.auditLogger.record(input);
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.warn("[swedbank] audit-log failed (non-fatal)", err);
    }
  }

  private async fetchPaymentOrder(paymentOrderId: string): Promise<unknown> {
    const path = paymentOrderId.includes("?") ? paymentOrderId : `${paymentOrderId}?$expand=paid`;
    return this.request("GET", path);
  }

  private extractPaymentOrderId(payload: unknown): string {
    const root = asObject(payload);
    const paymentOrder = asObject(root?.paymentOrder);
    const id = asString(paymentOrder?.id) ?? asString(root?.id);
    if (!id) {
      throw new DomainError("SWEDBANK_INVALID_RESPONSE", "Swedbank svarte uten paymentOrder.id.");
    }
    return normalizePaymentOrderId(id);
  }

  private extractPaymentOrderStatus(payload: unknown): string {
    const root = asObject(payload);
    const paymentOrder = asObject(root?.paymentOrder);
    const status = asString(paymentOrder?.status);
    return normalizeSwedbankStatus(status);
  }

  private extractPaymentOrderAmountMinor(payload: unknown): number | undefined {
    const root = asObject(payload);
    const paymentOrder = asObject(root?.paymentOrder);
    const amount = asNumber(paymentOrder?.amount);
    return amount !== undefined ? Math.floor(amount) : undefined;
  }

  private extractPaymentOrderCurrency(payload: unknown): string | undefined {
    const root = asObject(payload);
    const paymentOrder = asObject(root?.paymentOrder);
    const currency = asString(paymentOrder?.currency);
    return currency ? currency.toUpperCase() : undefined;
  }

  /**
   * Pull `cardFundingType` from Swedbank's `paid` resource (expanded via
   * `?$expand=paid` in fetchPaymentOrder). The actual JSON path varies
   * slightly by instrument; we look in the most likely places and
   * fall back to UNKNOWN if Swedbank didn't surface it.
   *
   * For mobile-wallet flows (Vipps, Apple Pay, Google Pay), Swedbank
   * typically does not return cardFundingType — those rely on the
   * underlying funding source which the wallet itself validates.
   */
  private extractCardFundingType(payload: unknown): CardFundingType | undefined {
    const root = asObject(payload);
    const paymentOrder = asObject(root?.paymentOrder);
    const paid = asObject(paymentOrder?.paid) ?? asObject(root?.paid);
    if (!paid) {
      return undefined;
    }
    const details = asObject(paid.details);
    const candidate =
      asString(paid.cardFundingType) ??
      asString(details?.cardFundingType) ??
      asString(details?.fundingType) ??
      asString(paid.fundingType);
    return normaliseCardFundingType(candidate);
  }

  private extractCardBrand(payload: unknown): string | undefined {
    const root = asObject(payload);
    const paymentOrder = asObject(root?.paymentOrder);
    const paid = asObject(paymentOrder?.paid) ?? asObject(root?.paid);
    if (!paid) {
      return undefined;
    }
    const details = asObject(paid.details);
    const candidate =
      asString(paid.cardBrand) ??
      asString(details?.cardBrand) ??
      asString(paid.instrument) ??
      asString(details?.instrument);
    if (!candidate) {
      return undefined;
    }
    return candidate.toUpperCase().slice(0, 32);
  }

  private extractOperations(payload: unknown): OperationLink[] {
    const root = asObject(payload);
    const paymentOrder = asObject(root?.paymentOrder);
    const operationsRaw = root?.operations ?? paymentOrder?.operations;
    if (!Array.isArray(operationsRaw)) {
      return [];
    }

    const operations: OperationLink[] = [];
    for (const value of operationsRaw) {
      const operation = asObject(value);
      const rel = asString(operation?.rel);
      const href = asString(operation?.href);
      if (!rel || !href) {
        continue;
      }
      operations.push({ rel, href });
    }
    return operations;
  }

  private findOperationUrl(operations: OperationLink[], relName: string): string | undefined {
    const operation = operations.find((item) => item.rel === relName);
    return operation?.href;
  }

  private resolveCallbackUrl(): string {
    if (this.callbackUrl) {
      return this.callbackUrl;
    }
    if (!this.merchantBaseUrl) {
      throw new DomainError(
        "INVALID_CONFIG",
        "Mangler SWEDBANK_PAY_CALLBACK_URL eller SWEDBANK_PAY_MERCHANT_BASE_URL."
      );
    }
    return new URL("api/payments/swedbank/callback", this.merchantBaseUrl).toString();
  }

  private resolveCompleteUrl(): string {
    if (this.completeUrl) {
      return this.completeUrl;
    }
    if (!this.merchantBaseUrl) {
      throw new DomainError(
        "INVALID_CONFIG",
        "Mangler SWEDBANK_PAY_COMPLETE_URL eller SWEDBANK_PAY_MERCHANT_BASE_URL."
      );
    }
    return new URL("", this.merchantBaseUrl).toString();
  }

  private resolveCancelUrl(): string {
    if (this.cancelUrl) {
      return this.cancelUrl;
    }
    if (!this.merchantBaseUrl) {
      throw new DomainError(
        "INVALID_CONFIG",
        "Mangler SWEDBANK_PAY_CANCEL_URL eller SWEDBANK_PAY_MERCHANT_BASE_URL."
      );
    }
    return new URL("", this.merchantBaseUrl).toString();
  }

  private resolveHostUrls(...urls: string[]): string[] {
    const set = new Set<string>();
    for (const value of urls) {
      if (!value) {
        continue;
      }
      const parsed = new URL(value);
      set.add(parsed.origin);
    }
    if (this.merchantBaseUrl) {
      set.add(new URL(this.merchantBaseUrl).origin);
    }
    const hostUrls = [...set.values()];
    if (!hostUrls.length) {
      throw new DomainError("INVALID_CONFIG", "Mangler gyldig hostUrl for Swedbank checkout.");
    }
    return hostUrls;
  }

  private withQuery(url: string, query: Record<string, string>): string {
    const parsed = new URL(url);
    for (const [key, value] of Object.entries(query)) {
      parsed.searchParams.set(key, value);
    }
    return parsed.toString();
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    this.assertConfigured();
    const url = this.makeAbsoluteApiUrl(path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json;version=3.1",
          ...(body !== undefined ? { "Content-Type": "application/json;version=3.1" } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      const text = await response.text();
      let parsed: unknown = undefined;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
      }

      if (!response.ok) {
        const root = asObject(parsed);
        const errorMessage = asString(root?.detail) || asString(root?.title) || asString(root?.errorCode);
        const problemsSummary = extractProblemsSummary(root);
        const messageBase = errorMessage
          ? `Swedbank Pay API feilet (${response.status}): ${errorMessage}`
          : `Swedbank Pay API feilet (${response.status}).`;
        throw new DomainError(
          "SWEDBANK_API_ERROR",
          problemsSummary ? `${messageBase} Problems: ${problemsSummary}` : messageBase
        );
      }

      return parsed;
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      if ((error as Error).name === "AbortError") {
        throw new DomainError("SWEDBANK_API_TIMEOUT", "Timeout mot Swedbank Pay API.");
      }
      throw new DomainError("SWEDBANK_API_UNAVAILABLE", "Kunne ikke kontakte Swedbank Pay API.");
    } finally {
      clearTimeout(timeout);
    }
  }

  private makeAbsoluteApiUrl(path: string): string {
    if (isHttpUrl(path)) {
      return path;
    }
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return new URL(normalizedPath, this.apiBaseUrl).toString();
  }

  private assertConfigured(): void {
    if (this.isConfigured()) {
      return;
    }
    throw new DomainError(
      "SWEDBANK_NOT_CONFIGURED",
      "Swedbank er ikke konfigurert. Sett SWEDBANK_PAY_ACCESS_TOKEN, SWEDBANK_PAY_PAYEE_ID og URL-innstillinger."
    );
  }

  private intentsTable(): string {
    return `"${this.schema}"."swedbank_payment_intents"`;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeSchema();
    }
    await this.initPromise;
  }

  private async initializeSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.intentsTable()} (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          user_id TEXT NOT NULL,
          wallet_id TEXT NOT NULL,
          order_reference TEXT UNIQUE NOT NULL,
          payee_reference TEXT UNIQUE NOT NULL,
          swedbank_payment_order_id TEXT UNIQUE NOT NULL,
          amount_minor BIGINT NOT NULL,
          amount_major NUMERIC(18, 2) NOT NULL,
          currency TEXT NOT NULL,
          status TEXT NOT NULL,
          checkout_redirect_url TEXT NULL,
          checkout_view_url TEXT NULL,
          credited_transaction_id TEXT NULL,
          credited_at TIMESTAMPTZ NULL,
          last_error TEXT NULL,
          raw_create_response JSONB NULL,
          raw_latest_status JSONB NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          payment_method TEXT NULL,
          card_funding_type TEXT NULL,
          card_brand TEXT NULL,
          rejected_at TIMESTAMPTZ NULL,
          rejection_reason TEXT NULL
        )`
      );
      // Idempotent ALTERs for upgrade-in-place (eg test DBs that pre-date
      // Scenario A). The forward-only migration is still authoritative
      // for prod.
      await client.query(
        `ALTER TABLE ${this.intentsTable()}
           ADD COLUMN IF NOT EXISTS payment_method TEXT NULL,
           ADD COLUMN IF NOT EXISTS card_funding_type TEXT NULL,
           ADD COLUMN IF NOT EXISTS card_brand TEXT NULL,
           ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ NULL,
           ADD COLUMN IF NOT EXISTS rejection_reason TEXT NULL`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_swedbank_payment_intents_user
         ON ${this.intentsTable()} (user_id, created_at DESC)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_swedbank_payment_intents_wallet
         ON ${this.intentsTable()} (wallet_id, created_at DESC)`
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof DomainError) {
        throw error;
      }
      throw new DomainError("PLATFORM_DB_ERROR", "Kunne ikke initialisere Swedbank payment-tabell.");
    } finally {
      client.release();
    }
  }

  /**
   * Standard column list returned by every SwedbankIntentRow query.
   * Centralised so Scenario A's new payment-method columns are in
   * lockstep across SELECTs / UPDATE…RETURNING / INSERT…RETURNING.
   */
  private readonly intentRowColumns = `
         id,
         provider,
         user_id,
         wallet_id,
         order_reference,
         payee_reference,
         swedbank_payment_order_id,
         amount_minor,
         amount_major,
         currency,
         status,
         checkout_redirect_url,
         checkout_view_url,
         credited_transaction_id,
         credited_at,
         last_error,
         created_at,
         updated_at,
         payment_method,
         card_funding_type,
         card_brand,
         rejected_at,
         rejection_reason`;

  private async getIntentRowForUser(intentId: string, userId: string): Promise<SwedbankIntentRow | null> {
    const { rows } = await this.pool.query<SwedbankIntentRow>(
      `SELECT ${this.intentRowColumns}
       FROM ${this.intentsTable()}
       WHERE id = $1
         AND user_id = $2`,
      [intentId.trim(), userId.trim()]
    );
    return rows[0] ?? null;
  }

  private async findIntentByOrderReference(orderReference: string): Promise<SwedbankIntentRow | null> {
    const { rows } = await this.pool.query<SwedbankIntentRow>(
      `SELECT ${this.intentRowColumns}
       FROM ${this.intentsTable()}
       WHERE order_reference = $1`,
      [orderReference.trim()]
    );
    return rows[0] ?? null;
  }

  private async findIntentByPaymentOrderId(paymentOrderId: string): Promise<SwedbankIntentRow | null> {
    const { rows } = await this.pool.query<SwedbankIntentRow>(
      `SELECT ${this.intentRowColumns}
       FROM ${this.intentsTable()}
       WHERE swedbank_payment_order_id = $1`,
      [paymentOrderId]
    );
    return rows[0] ?? null;
  }

  private async getIntentRowForUpdate(client: PoolClient, intentId: string): Promise<SwedbankIntentRow | null> {
    const { rows } = await client.query<SwedbankIntentRow>(
      `SELECT ${this.intentRowColumns}
       FROM ${this.intentsTable()}
       WHERE id = $1
       FOR UPDATE`,
      [intentId]
    );
    return rows[0] ?? null;
  }

  private async updateIntentStatus(intentId: string, status: string, rawLatestStatus: unknown): Promise<SwedbankIntentRow> {
    const { rows } = await this.pool.query<SwedbankIntentRow>(
      `UPDATE ${this.intentsTable()}
       SET status = $2,
           raw_latest_status = $3::jsonb,
           updated_at = now(),
           last_error = NULL
       WHERE id = $1
       RETURNING ${this.intentRowColumns}`,
      [intentId, status, JSON.stringify(rawLatestStatus)]
    );

    if (!rows[0]) {
      throw new DomainError("PAYMENT_INTENT_NOT_FOUND", "Fant ikke intent under status-oppdatering.");
    }

    return rows[0];
  }

  private async updateIntentError(
    intentId: string,
    status: string,
    message: string,
    rawLatestStatus: unknown
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.intentsTable()}
       SET status = $2,
           last_error = $3,
           raw_latest_status = $4::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [intentId, status, message, JSON.stringify(rawLatestStatus)]
    );
  }

  private mapRow(row: SwedbankIntentRow): SwedbankTopupIntent {
    const amountMinor = Number(row.amount_minor);
    const amountMajor = Number(row.amount_major);
    const paymentMethod =
      typeof row.payment_method === "string" && row.payment_method.length > 0
        ? (row.payment_method as PaymentMethod)
        : undefined;
    const cardFundingType =
      typeof row.card_funding_type === "string" && row.card_funding_type.length > 0
        ? (row.card_funding_type as CardFundingType)
        : undefined;

    return {
      id: row.id,
      provider: "swedbankpay",
      userId: row.user_id,
      walletId: row.wallet_id,
      orderReference: row.order_reference,
      payeeReference: row.payee_reference,
      paymentOrderId: row.swedbank_payment_order_id,
      amountMajor: Number.isFinite(amountMajor) ? amountMajor : fromMinorUnits(amountMinor),
      amountMinor,
      currency: row.currency,
      status: row.status,
      redirectUrl: row.checkout_redirect_url ?? undefined,
      viewUrl: row.checkout_view_url ?? undefined,
      creditedTransactionId: row.credited_transaction_id ?? undefined,
      creditedAt: asDateIso(row.credited_at),
      lastError: row.last_error ?? undefined,
      createdAt: asDateIso(row.created_at) ?? new Date().toISOString(),
      updatedAt: asDateIso(row.updated_at) ?? new Date().toISOString(),
      paymentMethod,
      cardFundingType,
      cardBrand: typeof row.card_brand === "string" && row.card_brand.length > 0 ? row.card_brand : undefined,
      rejectedAt: asDateIso(row.rejected_at ?? null),
      rejectionReason: typeof row.rejection_reason === "string" && row.rejection_reason.length > 0 ? row.rejection_reason : undefined
    };
  }
}
