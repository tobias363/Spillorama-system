/**
 * BIN-587 B4b follow-up: spiller-side voucher-innløsning.
 *
 * Admin-CRUD ligger i `VoucherService`. Denne tjenesten legger til
 * redemption-flyt:
 *
 *   - `validateCode(code, userId, gameSlug)` → beregner applikasjonsrabatt
 *     uten å endre state. Brukes av klient (f.eks. for "Sjekk koden")
 *     og av socket-handleren før den faktisk innløser.
 *   - `redeem({ code, user, gameSlug, ticketPriceCents, ... })` →
 *     atomisk: verifiser (gjenvalidering i transaksjonen), forsøk INSERT
 *     i `app_voucher_redemptions` (UNIQUE på `(voucher_id, user_id)`),
 *     bump `uses_count` i `app_vouchers`. Returnerer anvendt rabatt eller
 *     en `DomainError` med en av kodene nedenfor.
 *
 * ## Feilmodus (deterministisk, alle er DomainError-kodede)
 *
 *   - `VOUCHER_NOT_FOUND`          — koden finnes ikke
 *   - `VOUCHER_INACTIVE`           — `is_active = false`
 *   - `VOUCHER_NOT_YET_VALID`      — `valid_from > now()`
 *   - `VOUCHER_EXPIRED`            — `valid_to < now()`
 *   - `VOUCHER_EXHAUSTED`          — `uses_count >= max_uses`
 *   - `VOUCHER_ALREADY_REDEEMED`   — spilleren har brukt den før
 *   - `INVALID_INPUT`              — pris/kode/spillslug-validering
 *
 * ## Idempotens
 *
 * `UNIQUE(voucher_id, user_id)`-constrainten i
 * `app_voucher_redemptions` gir oss atomisk idempotens: en retry av
 * samme redeem-kall fra samme spiller returnerer den tidligere
 * redemption-raden (pluss en `VOUCHER_ALREADY_REDEEMED`-feil). Dette
 * matcher legacy-semantikk for `ApplyVoucherCode`.
 *
 * Call-site forventes å handle "allerede innløst" som en passiv
 * "bruk eksisterende rabatt"-path hvis de vil (se
 * `listRedemptionsForUser`).
 */

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";
import type { Voucher, VoucherType } from "./VoucherService.js";

const logger = rootLogger.child({ module: "voucher-redemption-service" });

export interface VoucherRedemptionInput {
  /** Rå-kode fra klient; normaliseres til uppercase/trim internt. */
  code: string;
  /** app_users.id — FK-mål i `app_voucher_redemptions.user_id`. */
  userId: string;
  /** Wallet-id for audit-trail. */
  walletId: string;
  /** Hvilket spill brukeren forsøker å bruke koden i. */
  gameSlug: string;
  /** Ticket-pris før rabatt (cents). Må være > 0. */
  ticketPriceCents: number;
  /** Optional: scheduled-games-ID (G1). NULL for ad-hoc G2/G3. */
  scheduledGameId?: string | null;
  /** Optional: ad-hoc room-code (G2/G3). NULL for scheduled-games. */
  roomCode?: string | null;
}

export interface AppliedDiscount {
  voucherId: string;
  code: string;
  type: VoucherType;
  /**
   * Rabatt-value fra voucher-config: prosent (0-100) eller flat cents.
   * Eksponeres så klient kan vise "25% avslag" eller "-50 kr".
   */
  value: number;
  /** Faktisk rabatt i cents, anvendt på `ticketPriceCents`. */
  discountAppliedCents: number;
  /** Pris etter rabatt (alltid ≥ 0). */
  finalPriceCents: number;
}

export interface RedemptionResult {
  redemptionId: string;
  discount: AppliedDiscount;
  redeemedAt: string;
}

export interface VoucherRedemptionRow {
  id: string;
  voucherId: string;
  userId: string;
  walletId: string;
  gameSlug: string;
  scheduledGameId: string | null;
  roomCode: string | null;
  discountAppliedCents: number;
  redeemedAt: string;
}

export interface VoucherRedemptionServiceOptions {
  connectionString?: string;
  schema?: string;
  /**
   * Hvilke game-slugs aksepteres som gyldig `gameSlug`-input. Brukes
   * bare for input-validering — om voucheren selv begrenser hvilke spill
   * den gjelder i kommer i et senere scope (kolonnen finnes ikke i
   * `app_vouchers` ennå). I dag: én voucher fungerer for alle spill.
   */
  allowedGameSlugs?: readonly string[];
}

const DEFAULT_ALLOWED_GAME_SLUGS = ["game1", "game2", "game3", "spillorama"] as const;

function assertCode(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", "code er påkrevd.");
  }
  return value.trim().toUpperCase();
}

function assertTicketPrice(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new DomainError("INVALID_INPUT", "ticketPriceCents må være et positivt heltall (cents).");
  }
  return n;
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

interface VoucherRow {
  id: string;
  code: string;
  type: VoucherType;
  value: string | number;
  max_uses: number | null;
  uses_count: number;
  valid_from: Date | string | null;
  valid_to: Date | string | null;
  is_active: boolean;
}

interface RedemptionDbRow {
  id: string;
  voucher_id: string;
  user_id: string;
  wallet_id: string;
  game_slug: string;
  scheduled_game_id: string | null;
  room_code: string | null;
  discount_applied_cents: string | number;
  redeemed_at: Date | string;
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

/**
 * Beregn anvendt rabatt (cents) ut fra voucher-type + pris.
 *
 *   - PERCENTAGE: floor(price * value / 100). Floor for å unngå at vi gir
 *     bort 0.5 cent og ledger-entryen ikke stemmer på integer-sum.
 *   - FLAT_AMOUNT: min(value, price) — rabatten kan aldri gjøre prisen
 *     negativ. Overskytende verdi går tapt (dokumentert i retur-objektet
 *     via finalPriceCents: 0).
 */
export function computeDiscountCents(
  type: VoucherType,
  value: number,
  ticketPriceCents: number,
): number {
  if (ticketPriceCents <= 0) return 0;
  if (type === "PERCENTAGE") {
    const pct = Math.max(0, Math.min(100, value));
    return Math.floor((ticketPriceCents * pct) / 100);
  }
  // FLAT_AMOUNT
  return Math.max(0, Math.min(value, ticketPriceCents));
}

export class VoucherRedemptionService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly allowedGameSlugs: readonly string[];

  constructor(opts: { pool: Pool; schema?: string; allowedGameSlugs?: readonly string[] }) {
    this.pool = opts.pool;
    this.schema = assertSchemaName(opts.schema ?? "public");
    this.allowedGameSlugs = opts.allowedGameSlugs ?? DEFAULT_ALLOWED_GAME_SLUGS;
  }

  /** @internal — test-hook. */
  static forTesting(
    pool: Pool,
    schema = "public",
    allowedGameSlugs: readonly string[] = DEFAULT_ALLOWED_GAME_SLUGS,
  ): VoucherRedemptionService {
    return new VoucherRedemptionService({ pool, schema, allowedGameSlugs });
  }

  private vouchersTable(): string { return `"${this.schema}"."app_vouchers"`; }
  private redemptionsTable(): string { return `"${this.schema}"."app_voucher_redemptions"`; }

  /**
   * Beregn anvendt rabatt uten state-endring. Rene lesninger; egner seg
   * til en "Sjekk koden"-UI-kall før innløsning. Kaster samme
   * DomainError-koder som `redeem()` (unntatt `VOUCHER_ALREADY_REDEEMED`
   * — kastes bare når en tidligere redemption-rad finnes for
   * `(voucher_id, user_id)`).
   */
  async validateCode(input: {
    code: string;
    userId: string;
    gameSlug: string;
    ticketPriceCents: number;
  }): Promise<AppliedDiscount> {
    const code = assertCode(input.code);
    const userId = input.userId?.trim();
    if (!userId) throw new DomainError("INVALID_INPUT", "userId er påkrevd.");
    const ticketPriceCents = assertTicketPrice(input.ticketPriceCents);
    this.assertAllowedGameSlug(input.gameSlug);

    const voucher = await this.loadVoucherByCode(code);
    this.assertVoucherRedeemable(voucher);

    // Sjekk om spilleren allerede har innløst
    const existing = await this.loadExistingRedemption(voucher.id, userId);
    if (existing) {
      throw new DomainError(
        "VOUCHER_ALREADY_REDEEMED",
        "Du har allerede brukt denne koden.",
      );
    }

    const discountAppliedCents = computeDiscountCents(
      voucher.type,
      voucher.value,
      ticketPriceCents,
    );
    return {
      voucherId: voucher.id,
      code: voucher.code,
      type: voucher.type,
      value: voucher.value,
      discountAppliedCents,
      finalPriceCents: Math.max(0, ticketPriceCents - discountAppliedCents),
    };
  }

  /**
   * Atomisk redemption:
   *   1. SELECT voucher FOR UPDATE (lock-row for å unngå max_uses-race).
   *   2. Validér.
   *   3. INSERT i app_voucher_redemptions (UNIQUE-constraint = idempotens).
   *   4. UPDATE uses_count++ (bare hvis max_uses er satt).
   *
   * Ved en retry der `(voucher_id, user_id)` allerede finnes, fanges
   * 23505 unique_violation og oversettes til `VOUCHER_ALREADY_REDEEMED`.
   */
  async redeem(input: VoucherRedemptionInput): Promise<RedemptionResult> {
    const code = assertCode(input.code);
    const userId = input.userId?.trim();
    if (!userId) throw new DomainError("INVALID_INPUT", "userId er påkrevd.");
    const walletId = input.walletId?.trim();
    if (!walletId) throw new DomainError("INVALID_INPUT", "walletId er påkrevd.");
    const ticketPriceCents = assertTicketPrice(input.ticketPriceCents);
    this.assertAllowedGameSlug(input.gameSlug);

    const gameSlug = input.gameSlug.trim();
    const scheduledGameId =
      typeof input.scheduledGameId === "string" && input.scheduledGameId.trim()
        ? input.scheduledGameId.trim()
        : null;
    const roomCode =
      typeof input.roomCode === "string" && input.roomCode.trim()
        ? input.roomCode.trim().toUpperCase()
        : null;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const voucher = await this.loadVoucherByCodeForUpdate(client, code);
      this.assertVoucherRedeemable(voucher);

      const discountAppliedCents = computeDiscountCents(
        voucher.type,
        voucher.value,
        ticketPriceCents,
      );
      const finalPriceCents = Math.max(0, ticketPriceCents - discountAppliedCents);

      const redemptionId = randomUUID();
      let redeemedAtIso: string;
      try {
        const { rows } = await client.query<RedemptionDbRow>(
          `INSERT INTO ${this.redemptionsTable()}
             (id, voucher_id, user_id, wallet_id, game_slug, scheduled_game_id, room_code, discount_applied_cents)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, voucher_id, user_id, wallet_id, game_slug, scheduled_game_id,
                     room_code, discount_applied_cents, redeemed_at`,
          [
            redemptionId, voucher.id, userId, walletId, gameSlug,
            scheduledGameId, roomCode, discountAppliedCents,
          ],
        );
        const row = rows[0]!;
        redeemedAtIso = asIso(row.redeemed_at);
      } catch (err) {
        const pgErr = err as { code?: string; message?: string };
        if (pgErr?.code === "23505" || /unique|duplicate key/i.test(pgErr?.message ?? "")) {
          await client.query("ROLLBACK");
          throw new DomainError(
            "VOUCHER_ALREADY_REDEEMED",
            "Du har allerede brukt denne koden.",
          );
        }
        throw err;
      }

      await client.query(
        `UPDATE ${this.vouchersTable()}
         SET uses_count = uses_count + 1, updated_at = now()
         WHERE id = $1`,
        [voucher.id],
      );

      await client.query("COMMIT");

      logger.info(
        {
          voucherId: voucher.id, code: voucher.code, userId, gameSlug,
          discountAppliedCents, scheduledGameId, roomCode,
        },
        "voucher redeemed",
      );

      return {
        redemptionId,
        redeemedAt: redeemedAtIso,
        discount: {
          voucherId: voucher.id,
          code: voucher.code,
          type: voucher.type,
          value: voucher.value,
          discountAppliedCents,
          finalPriceCents,
        },
      };
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* already rolled back */ }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * List alle innløsninger for en spiller. Brukes av UI/admin-views for
   * "Dine tidligere rabatter"-listing og av tester for verifikasjon.
   */
  async listRedemptionsForUser(userId: string, limit = 50): Promise<VoucherRedemptionRow[]> {
    if (!userId?.trim()) throw new DomainError("INVALID_INPUT", "userId er påkrevd.");
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const { rows } = await this.pool.query<RedemptionDbRow>(
      `SELECT id, voucher_id, user_id, wallet_id, game_slug, scheduled_game_id,
              room_code, discount_applied_cents, redeemed_at
       FROM ${this.redemptionsTable()}
       WHERE user_id = $1
       ORDER BY redeemed_at DESC
       LIMIT $2`,
      [userId.trim(), safeLimit],
    );
    return rows.map((r) => this.mapRedemption(r));
  }

  // ── private ─────────────────────────────────────────────────────────────

  private assertAllowedGameSlug(gameSlug: unknown): void {
    if (typeof gameSlug !== "string" || !gameSlug.trim()) {
      throw new DomainError("INVALID_INPUT", "gameSlug er påkrevd.");
    }
    const s = gameSlug.trim();
    if (!this.allowedGameSlugs.includes(s)) {
      throw new DomainError(
        "INVALID_INPUT",
        `gameSlug "${s}" er ikke støttet for voucher-innløsning.`,
      );
    }
  }

  private assertVoucherRedeemable(voucher: {
    id: string; code: string; isActive: boolean;
    validFrom: string | null; validTo: string | null;
    maxUses: number | null; usesCount: number;
  }): void {
    if (!voucher.isActive) {
      throw new DomainError("VOUCHER_INACTIVE", "Koden er ikke aktiv.");
    }
    const now = Date.now();
    if (voucher.validFrom && Date.parse(voucher.validFrom) > now) {
      throw new DomainError(
        "VOUCHER_NOT_YET_VALID",
        "Koden er ikke gyldig ennå.",
      );
    }
    if (voucher.validTo && Date.parse(voucher.validTo) < now) {
      throw new DomainError("VOUCHER_EXPIRED", "Koden er utløpt.");
    }
    if (voucher.maxUses !== null && voucher.usesCount >= voucher.maxUses) {
      throw new DomainError(
        "VOUCHER_EXHAUSTED",
        "Koden har nådd maks antall innløsninger.",
      );
    }
  }

  private async loadVoucherByCode(code: string): Promise<Voucher> {
    const { rows } = await this.pool.query<VoucherRow>(
      `SELECT id, code, type, value, max_uses, uses_count, valid_from, valid_to, is_active
       FROM ${this.vouchersTable()}
       WHERE code = $1`,
      [code],
    );
    const row = rows[0];
    if (!row) throw new DomainError("VOUCHER_NOT_FOUND", "Koden finnes ikke.");
    return this.mapVoucher(row);
  }

  private async loadVoucherByCodeForUpdate(client: PoolClient, code: string): Promise<Voucher> {
    const { rows } = await client.query<VoucherRow>(
      `SELECT id, code, type, value, max_uses, uses_count, valid_from, valid_to, is_active
       FROM ${this.vouchersTable()}
       WHERE code = $1
       FOR UPDATE`,
      [code],
    );
    const row = rows[0];
    if (!row) throw new DomainError("VOUCHER_NOT_FOUND", "Koden finnes ikke.");
    return this.mapVoucher(row);
  }

  private async loadExistingRedemption(
    voucherId: string,
    userId: string,
  ): Promise<VoucherRedemptionRow | null> {
    const { rows } = await this.pool.query<RedemptionDbRow>(
      `SELECT id, voucher_id, user_id, wallet_id, game_slug, scheduled_game_id,
              room_code, discount_applied_cents, redeemed_at
       FROM ${this.redemptionsTable()}
       WHERE voucher_id = $1 AND user_id = $2
       LIMIT 1`,
      [voucherId, userId],
    );
    return rows[0] ? this.mapRedemption(rows[0]) : null;
  }

  private mapVoucher(row: VoucherRow): Voucher {
    return {
      id: row.id,
      code: row.code,
      type: row.type,
      value: Number(row.value),
      maxUses: row.max_uses,
      usesCount: row.uses_count,
      validFrom: row.valid_from === null
        ? null
        : typeof row.valid_from === "string" ? row.valid_from : row.valid_from.toISOString(),
      validTo: row.valid_to === null
        ? null
        : typeof row.valid_to === "string" ? row.valid_to : row.valid_to.toISOString(),
      isActive: row.is_active,
      // Feltene under er ikke relevante for redemption men oppfyller Voucher-typen.
      description: null,
      createdBy: null,
      createdAt: "",
      updatedAt: "",
    };
  }

  private mapRedemption(row: RedemptionDbRow): VoucherRedemptionRow {
    return {
      id: row.id,
      voucherId: row.voucher_id,
      userId: row.user_id,
      walletId: row.wallet_id,
      gameSlug: row.game_slug,
      scheduledGameId: row.scheduled_game_id,
      roomCode: row.room_code,
      discountAppliedCents: Number(row.discount_applied_cents),
      redeemedAt: asIso(row.redeemed_at),
    };
  }
}
