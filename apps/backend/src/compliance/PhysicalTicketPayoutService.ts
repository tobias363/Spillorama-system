/**
 * PT4 — Fysisk-bong vinn-flyt + verifisering + utbetaling.
 *
 * Spec: docs/architecture/PHYSICAL_TICKETS_FINAL_SPEC_2026-04-22.md
 *       (§ "Fase 6: Vinn-varsel + verifisering + utbetaling", linje 127-156)
 *
 * Eier `app_physical_ticket_pending_payouts`-tabellen (migrasjon
 * 20260608000000). Én rad per fysisk-bong-pattern-match. Livssyklus:
 *
 *   detected_at (draw-engine detect)
 *     → verified_at / verified_by_user_id (bingovert scanner bongen)
 *       → admin_approved_at (hvis admin_approval_required, fire-øyne)
 *         → paid_out_at / paid_out_by_user_id (kontant-utbetaling bekreftet)
 *
 *   Alternativt: rejected_at / rejected_by_user_id / rejected_reason
 *     (f.eks. bong ikke frembrakt når bingovert går rundt).
 *
 * Forskjell fra digital bong:
 *   - Digital vinn utbetales AUTO til wallet i `Game1PayoutService.payoutPhase`.
 *   - Fysisk vinn ruter gjennom denne tjenesten: detect → varsel → manuell
 *     scan-verifikasjon → (optional) ADMIN fire-øyne → kontant-payout.
 *   - **Ingen wallet-credit** — utbetaling skjer som kontanter utenfor systemet.
 *     Sporingen er den regulatoriske verdien (fysisk bong vinner teller IKKE
 *     mot digital netto-tap-beregning).
 *
 * Fail-closed:
 *   - Scan-mismatch ved verifisering → TICKET_SCAN_MISMATCH, ingen state-endring.
 *   - Confirm uten verify → NOT_VERIFIED.
 *   - Confirm med admin-required men uten admin-approval → ADMIN_APPROVAL_REQUIRED.
 *   - Dobbel confirm → ALREADY_PAID_OUT.
 *   - Rejected → cannot be confirmed.
 *
 * Audit:
 *   - `physical_ticket.pending_detected` (skrives av draw-engine, ikke her)
 *   - `physical_ticket.verified` (verifyWin)
 *   - `physical_ticket.admin_approved` (adminApprove)
 *   - `physical_ticket.payout` (confirmPayout)
 *   - `physical_ticket.rejected` (rejectWin)
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "physical-ticket-payout-service" });

/**
 * Terskel for fire-øyne-krav: utbetalinger ≥ 5000 NOK krever ADMIN-approval
 * før bingovert kan confirm-payout. Matcher spec linje 152.
 */
export const ADMIN_APPROVAL_THRESHOLD_CENTS = 500_000;

export interface PhysicalTicketPendingPayout {
  id: string;
  ticketId: string;
  hallId: string;
  scheduledGameId: string;
  patternPhase: string;
  expectedPayoutCents: number;
  responsibleUserId: string;
  color: string;
  detectedAt: string;
  verifiedAt: string | null;
  verifiedByUserId: string | null;
  paidOutAt: string | null;
  paidOutByUserId: string | null;
  adminApprovalRequired: boolean;
  adminApprovedAt: string | null;
  adminApprovedByUserId: string | null;
  rejectedAt: string | null;
  rejectedByUserId: string | null;
  rejectedReason: string | null;
}

export interface CreatePendingPayoutInput {
  ticketId: string;
  hallId: string;
  scheduledGameId: string;
  patternPhase: string;
  expectedPayoutCents: number;
  responsibleUserId: string;
  color: string;
}

export interface VerifyWinInput {
  pendingPayoutId: string;
  /** Scannet bong-ID (barcode) — må matche pending.ticket_id. */
  scannedTicketId: string;
  /** Bingovert som utfører verifikasjon. */
  userId: string;
}

export interface VerifyWinResult {
  pendingPayoutId: string;
  ticketId: string;
  pattern: string;
  color: string;
  expectedPayoutCents: number;
  needsAdminApproval: boolean;
}

export interface AdminApproveInput {
  pendingPayoutId: string;
  /** ADMIN-bruker — route-laget har verifisert rollen. */
  adminUserId: string;
}

export interface ConfirmPayoutInput {
  pendingPayoutId: string;
  /** Bingovert som utfører kontant-payout. */
  userId: string;
}

export interface ConfirmPayoutResult {
  pendingPayoutId: string;
  ticketId: string;
  paidOutAmountCents: number;
  paidOutAt: string;
}

export interface RejectWinInput {
  pendingPayoutId: string;
  /** Bruker som rejecter (bingovert eller ADMIN). */
  userId: string;
  reason: string;
}

export interface RejectWinResult {
  pendingPayoutId: string;
  rejectedAt: string;
}

export interface PhysicalTicketPayoutServiceOptions {
  connectionString: string;
  schema?: string;
  /**
   * Optional override for fire-øyne-terskel. Default
   * {@link ADMIN_APPROVAL_THRESHOLD_CENTS} = 500_000 cents (5000 NOK).
   */
  adminApprovalThresholdCents?: number;
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function asIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : asIso(value);
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  return value.trim();
}

export class PhysicalTicketPayoutService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly approvalThresholdCents: number;

  constructor(options: PhysicalTicketPayoutServiceOptions) {
    if (!options.connectionString?.trim()) {
      throw new DomainError(
        "INVALID_CONFIG",
        "Mangler connection string for PhysicalTicketPayoutService.",
      );
    }
    this.schema = assertSchemaName(options.schema ?? "public");
    this.pool = new Pool({
      connectionString: options.connectionString,
      ...getPoolTuning(),
    });
    this.approvalThresholdCents =
      typeof options.adminApprovalThresholdCents === "number"
      && Number.isFinite(options.adminApprovalThresholdCents)
      && options.adminApprovalThresholdCents > 0
        ? Math.floor(options.adminApprovalThresholdCents)
        : ADMIN_APPROVAL_THRESHOLD_CENTS;
  }

  /** @internal — test-hook. */
  static forTesting(
    pool: Pool,
    schema = "public",
    approvalThresholdCents = ADMIN_APPROVAL_THRESHOLD_CENTS,
  ): PhysicalTicketPayoutService {
    const svc = Object.create(
      PhysicalTicketPayoutService.prototype,
    ) as PhysicalTicketPayoutService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { approvalThresholdCents: number }).approvalThresholdCents =
      approvalThresholdCents;
    return svc;
  }

  /** Eksponert for tester — skal ikke brukes i produksjon. */
  getApprovalThresholdCents(): number {
    return this.approvalThresholdCents;
  }

  private pendingTable(): string {
    return `"${this.schema}"."app_physical_ticket_pending_payouts"`;
  }

  private staticTicketsTable(): string {
    return `"${this.schema}"."app_static_tickets"`;
  }

  /**
   * Opprett en pending-row. Kalles av `Game1DrawEngineService` når en fysisk
   * bong treffer pattern. Bruker `ON CONFLICT DO NOTHING` på
   * (hall_id, ticket_id, pattern_phase) — idempotent selv om draw-engine
   * skulle kjøre phase-evaluering flere ganger for samme (ticket, phase).
   *
   * Returnerer den vedvarte raden (enten nyopprettet eller eksisterende).
   */
  async createPendingPayout(
    input: CreatePendingPayoutInput,
  ): Promise<PhysicalTicketPendingPayout> {
    const ticketId = assertNonEmpty(input.ticketId, "ticketId");
    const hallId = assertNonEmpty(input.hallId, "hallId");
    const scheduledGameId = assertNonEmpty(
      input.scheduledGameId,
      "scheduledGameId",
    );
    const patternPhase = assertNonEmpty(input.patternPhase, "patternPhase");
    const responsibleUserId = assertNonEmpty(
      input.responsibleUserId,
      "responsibleUserId",
    );
    const color = assertNonEmpty(input.color, "color");
    if (
      typeof input.expectedPayoutCents !== "number"
      || !Number.isFinite(input.expectedPayoutCents)
      || !Number.isInteger(input.expectedPayoutCents)
      || input.expectedPayoutCents < 0
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        "expectedPayoutCents må være et ikke-negativt heltall.",
      );
    }

    const newId = `pp-${randomUUID()}`;
    const adminApprovalRequired =
      input.expectedPayoutCents >= this.approvalThresholdCents;

    // INSERT ... ON CONFLICT DO NOTHING → hvis idempotens kicker inn (rad
    // finnes allerede), hent eksisterende rad i etterkant.
    const { rows: inserted } = await this.pool.query<PendingPayoutRow>(
      `INSERT INTO ${this.pendingTable()}
         (id, ticket_id, hall_id, scheduled_game_id, pattern_phase,
          expected_payout_cents, responsible_user_id, color,
          admin_approval_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT ON CONSTRAINT pt4_unique_hall_ticket_phase
         DO NOTHING
       RETURNING id, ticket_id, hall_id, scheduled_game_id, pattern_phase,
                 expected_payout_cents, responsible_user_id, color,
                 detected_at, verified_at, verified_by_user_id,
                 paid_out_at, paid_out_by_user_id,
                 admin_approval_required, admin_approved_at, admin_approved_by_user_id,
                 rejected_at, rejected_by_user_id, rejected_reason`,
      [
        newId,
        ticketId,
        hallId,
        scheduledGameId,
        patternPhase,
        input.expectedPayoutCents,
        responsibleUserId,
        color,
        adminApprovalRequired,
      ],
    );

    if (inserted.length > 0) {
      return this.map(inserted[0]!);
    }

    // Konflikt: rad finnes allerede. Hent eksisterende.
    const existing = await this.findByUniqueKey(hallId, ticketId, patternPhase);
    if (!existing) {
      throw new DomainError(
        "INTERNAL_ERROR",
        "ON CONFLICT DO NOTHING traff, men ingen eksisterende rad funnet.",
      );
    }
    return existing;
  }

  /**
   * List pending-rows for et planlagt spill. Kun åpne (ikke paid_out, ikke
   * rejected). For admin-skjerm ved aktivt spill.
   */
  async listPendingForGame(
    scheduledGameId: string,
  ): Promise<PhysicalTicketPendingPayout[]> {
    const gameId = assertNonEmpty(scheduledGameId, "scheduledGameId");
    const { rows } = await this.pool.query<PendingPayoutRow>(
      `SELECT id, ticket_id, hall_id, scheduled_game_id, pattern_phase,
              expected_payout_cents, responsible_user_id, color,
              detected_at, verified_at, verified_by_user_id,
              paid_out_at, paid_out_by_user_id,
              admin_approval_required, admin_approved_at, admin_approved_by_user_id,
              rejected_at, rejected_by_user_id, rejected_reason
       FROM ${this.pendingTable()}
       WHERE scheduled_game_id = $1
         AND paid_out_at IS NULL
         AND rejected_at IS NULL
       ORDER BY detected_at ASC`,
      [gameId],
    );
    return rows.map((r) => this.map(r));
  }

  /**
   * List pending-rows for en bingovert (responsible_user_id). Kun åpne. For
   * bingovert-vakt-skjerm.
   */
  async listPendingForUser(
    userId: string,
  ): Promise<PhysicalTicketPendingPayout[]> {
    const u = assertNonEmpty(userId, "userId");
    const { rows } = await this.pool.query<PendingPayoutRow>(
      `SELECT id, ticket_id, hall_id, scheduled_game_id, pattern_phase,
              expected_payout_cents, responsible_user_id, color,
              detected_at, verified_at, verified_by_user_id,
              paid_out_at, paid_out_by_user_id,
              admin_approval_required, admin_approved_at, admin_approved_by_user_id,
              rejected_at, rejected_by_user_id, rejected_reason
       FROM ${this.pendingTable()}
       WHERE responsible_user_id = $1
         AND paid_out_at IS NULL
         AND rejected_at IS NULL
       ORDER BY detected_at ASC`,
      [u],
    );
    return rows.map((r) => this.map(r));
  }

  /** Detail-oppslag. Returnerer null hvis ikke finnes. */
  async getById(
    pendingPayoutId: string,
  ): Promise<PhysicalTicketPendingPayout | null> {
    const id = assertNonEmpty(pendingPayoutId, "pendingPayoutId");
    const { rows } = await this.pool.query<PendingPayoutRow>(
      `SELECT id, ticket_id, hall_id, scheduled_game_id, pattern_phase,
              expected_payout_cents, responsible_user_id, color,
              detected_at, verified_at, verified_by_user_id,
              paid_out_at, paid_out_by_user_id,
              admin_approval_required, admin_approved_at, admin_approved_by_user_id,
              rejected_at, rejected_by_user_id, rejected_reason
       FROM ${this.pendingTable()}
       WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? this.map(row) : null;
  }

  /**
   * Verifisering: bingovert scanner bongen for å bekrefte at den faktisk
   * finnes fysisk i hallen. Scan-mismatch → TICKET_SCAN_MISMATCH (fail-
   * closed). Ved match settes verified_at + verified_by_user_id.
   *
   * Sjekker:
   *   - pending finnes (PENDING_PAYOUT_NOT_FOUND)
   *   - rejected → ALREADY_REJECTED
   *   - paid_out → ALREADY_PAID_OUT
   *   - verified → returnerer eksisterende (idempotent re-verifisering)
   *   - scannedTicketId === pending.ticket_id (TICKET_SCAN_MISMATCH ellers)
   *
   * Returnerer flagg for om ADMIN-approval kreves før confirm-payout.
   */
  async verifyWin(input: VerifyWinInput): Promise<VerifyWinResult> {
    const pendingId = assertNonEmpty(input.pendingPayoutId, "pendingPayoutId");
    const scanned = assertNonEmpty(input.scannedTicketId, "scannedTicketId");
    const userId = assertNonEmpty(input.userId, "userId");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query<PendingPayoutRow>(
        `SELECT id, ticket_id, hall_id, scheduled_game_id, pattern_phase,
                expected_payout_cents, responsible_user_id, color,
                detected_at, verified_at, verified_by_user_id,
                paid_out_at, paid_out_by_user_id,
                admin_approval_required, admin_approved_at, admin_approved_by_user_id,
                rejected_at, rejected_by_user_id, rejected_reason
         FROM ${this.pendingTable()}
         WHERE id = $1
         FOR UPDATE`,
        [pendingId],
      );
      if (rows.length === 0) {
        throw new DomainError(
          "PENDING_PAYOUT_NOT_FOUND",
          `Pending payout '${pendingId}' finnes ikke.`,
        );
      }
      const row = rows[0]!;

      if (row.rejected_at !== null) {
        throw new DomainError(
          "ALREADY_REJECTED",
          `Pending payout '${pendingId}' er avvist — kan ikke verifiseres.`,
        );
      }
      if (row.paid_out_at !== null) {
        throw new DomainError(
          "ALREADY_PAID_OUT",
          `Pending payout '${pendingId}' er allerede utbetalt.`,
        );
      }

      // Anti-svindel: scan-ID må matche lagret ticket_id.
      if (scanned !== row.ticket_id) {
        throw new DomainError(
          "TICKET_SCAN_MISMATCH",
          `Scannet bong '${scanned}' matcher ikke forventet '${row.ticket_id}'.`,
        );
      }

      // Idempotent re-verifisering: returnér eksisterende data uten
      // å overskrive verified_by_user_id.
      if (row.verified_at === null) {
        await client.query(
          `UPDATE ${this.pendingTable()}
              SET verified_at          = now(),
                  verified_by_user_id  = $2
           WHERE id = $1`,
          [pendingId, userId],
        );
      }

      await client.query("COMMIT");

      return {
        pendingPayoutId: row.id,
        ticketId: row.ticket_id,
        pattern: row.pattern_phase,
        color: row.color,
        expectedPayoutCents: Number(row.expected_payout_cents),
        needsAdminApproval: row.admin_approval_required,
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
        // ignorer rollback-feil
      });
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * ADMIN fire-øyne-godkjenning. Rolle-sjekk gjøres i route-laget. Krever:
   *   - pending finnes
   *   - admin_approval_required = true (ellers ADMIN_APPROVAL_NOT_REQUIRED)
   *   - ikke rejected, ikke paid_out, ikke allerede admin_approved
   *   - verifisert først (service krever IKKE dette — ADMIN kan approve FØR
   *     scan hvis spillet er over og bingovert ikke er tilstede; confirm-
   *     payout blokkeres uansett til verified er satt)
   *
   * Returnerer oppdatert rad.
   */
  async adminApprove(
    input: AdminApproveInput,
  ): Promise<PhysicalTicketPendingPayout> {
    const pendingId = assertNonEmpty(input.pendingPayoutId, "pendingPayoutId");
    const adminUserId = assertNonEmpty(input.adminUserId, "adminUserId");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<PendingPayoutRow>(
        `SELECT id, ticket_id, hall_id, scheduled_game_id, pattern_phase,
                expected_payout_cents, responsible_user_id, color,
                detected_at, verified_at, verified_by_user_id,
                paid_out_at, paid_out_by_user_id,
                admin_approval_required, admin_approved_at, admin_approved_by_user_id,
                rejected_at, rejected_by_user_id, rejected_reason
         FROM ${this.pendingTable()}
         WHERE id = $1
         FOR UPDATE`,
        [pendingId],
      );
      if (rows.length === 0) {
        throw new DomainError(
          "PENDING_PAYOUT_NOT_FOUND",
          `Pending payout '${pendingId}' finnes ikke.`,
        );
      }
      const row = rows[0]!;

      if (row.rejected_at !== null) {
        throw new DomainError(
          "ALREADY_REJECTED",
          `Pending payout '${pendingId}' er avvist — kan ikke godkjennes.`,
        );
      }
      if (row.paid_out_at !== null) {
        throw new DomainError(
          "ALREADY_PAID_OUT",
          `Pending payout '${pendingId}' er allerede utbetalt.`,
        );
      }
      if (!row.admin_approval_required) {
        throw new DomainError(
          "ADMIN_APPROVAL_NOT_REQUIRED",
          `Pending payout '${pendingId}' krever ikke ADMIN-godkjenning (beløp < terskel).`,
        );
      }

      // Idempotent: allerede approved → returnér eksisterende.
      if (row.admin_approved_at === null) {
        await client.query(
          `UPDATE ${this.pendingTable()}
              SET admin_approved_at         = now(),
                  admin_approved_by_user_id = $2
           WHERE id = $1`,
          [pendingId, adminUserId],
        );
      }

      const { rows: reloaded } = await client.query<PendingPayoutRow>(
        `SELECT id, ticket_id, hall_id, scheduled_game_id, pattern_phase,
                expected_payout_cents, responsible_user_id, color,
                detected_at, verified_at, verified_by_user_id,
                paid_out_at, paid_out_by_user_id,
                admin_approval_required, admin_approved_at, admin_approved_by_user_id,
                rejected_at, rejected_by_user_id, rejected_reason
         FROM ${this.pendingTable()}
         WHERE id = $1`,
        [pendingId],
      );
      await client.query("COMMIT");
      return this.map(reloaded[0]!);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
        // ignorer rollback-feil
      });
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Bekreft kontant-utbetaling. Krever:
   *   - pending finnes (PENDING_PAYOUT_NOT_FOUND)
   *   - ikke rejected, ikke allerede paid_out
   *   - verified_at IS NOT NULL (NOT_VERIFIED ellers)
   *   - hvis admin_approval_required: admin_approved_at IS NOT NULL
   *     (ADMIN_APPROVAL_REQUIRED ellers)
   *
   * Oppdaterer:
   *   - `app_static_tickets`: paid_out_at, paid_out_amount_cents, paid_out_by_user_id
   *   - `app_physical_ticket_pending_payouts`: paid_out_at, paid_out_by_user_id
   *
   * Ingen wallet-credit (kontant utenfor systemet).
   */
  async confirmPayout(
    input: ConfirmPayoutInput,
  ): Promise<ConfirmPayoutResult> {
    const pendingId = assertNonEmpty(input.pendingPayoutId, "pendingPayoutId");
    const userId = assertNonEmpty(input.userId, "userId");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query<PendingPayoutRow>(
        `SELECT id, ticket_id, hall_id, scheduled_game_id, pattern_phase,
                expected_payout_cents, responsible_user_id, color,
                detected_at, verified_at, verified_by_user_id,
                paid_out_at, paid_out_by_user_id,
                admin_approval_required, admin_approved_at, admin_approved_by_user_id,
                rejected_at, rejected_by_user_id, rejected_reason
         FROM ${this.pendingTable()}
         WHERE id = $1
         FOR UPDATE`,
        [pendingId],
      );
      if (rows.length === 0) {
        throw new DomainError(
          "PENDING_PAYOUT_NOT_FOUND",
          `Pending payout '${pendingId}' finnes ikke.`,
        );
      }
      const row = rows[0]!;

      if (row.rejected_at !== null) {
        throw new DomainError(
          "ALREADY_REJECTED",
          `Pending payout '${pendingId}' er avvist.`,
        );
      }
      if (row.paid_out_at !== null) {
        throw new DomainError(
          "ALREADY_PAID_OUT",
          `Pending payout '${pendingId}' er allerede utbetalt.`,
        );
      }
      if (row.verified_at === null) {
        throw new DomainError(
          "NOT_VERIFIED",
          `Pending payout '${pendingId}' må verifiseres (scan) før utbetaling.`,
        );
      }
      if (row.admin_approval_required && row.admin_approved_at === null) {
        throw new DomainError(
          "ADMIN_APPROVAL_REQUIRED",
          `Pending payout '${pendingId}' krever ADMIN-godkjenning (beløp ≥ terskel).`,
        );
      }

      const payoutCents = Number(row.expected_payout_cents);
      const now = new Date();

      // Oppdater pending-row.
      await client.query(
        `UPDATE ${this.pendingTable()}
            SET paid_out_at          = $2,
                paid_out_by_user_id  = $3
         WHERE id = $1
           AND paid_out_at IS NULL`,
        [pendingId, now, userId],
      );

      // Speil til app_static_tickets (idempotent — bruker WHERE
      // paid_out_at IS NULL for å unngå at to ulike phase-payouts overskriver
      // hverandre hvis samme ticket har både row_1 og full_house).
      //
      // Merk: samme fysisk bong kan ha flere pending-rows (én per fase). Vi
      // oppdaterer static-ticket-raden kun ved FØRSTE confirm. Senere confirm
      // for samme ticket bygger på akkumulert utbetaling.
      await client.query(
        `UPDATE ${this.staticTicketsTable()}
            SET paid_out_at            = COALESCE(paid_out_at, $2),
                paid_out_amount_cents  = COALESCE(paid_out_amount_cents, 0) + $3,
                paid_out_by_user_id    = COALESCE(paid_out_by_user_id, $4)
         WHERE hall_id = $5
           AND ticket_serial = $1`,
        [
          row.ticket_id,
          now,
          payoutCents,
          userId,
          row.hall_id,
        ],
      );

      await client.query("COMMIT");

      logger.info(
        {
          pendingPayoutId: pendingId,
          ticketId: row.ticket_id,
          hallId: row.hall_id,
          scheduledGameId: row.scheduled_game_id,
          pattern: row.pattern_phase,
          paidOutCents: payoutCents,
          userId,
        },
        "[PT4] physical ticket payout confirmed",
      );

      return {
        pendingPayoutId: pendingId,
        ticketId: row.ticket_id,
        paidOutAmountCents: payoutCents,
        paidOutAt: now.toISOString(),
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
        // ignorer rollback-feil
      });
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Avvis en pending-vinn. Bruker f.eks. når bongen ikke frembringes
   * (fantom-vinn). Krever:
   *   - pending finnes
   *   - ikke allerede rejected, ikke paid_out
   *
   * Setter rejected_at / rejected_by_user_id / rejected_reason.
   */
  async rejectWin(input: RejectWinInput): Promise<RejectWinResult> {
    const pendingId = assertNonEmpty(input.pendingPayoutId, "pendingPayoutId");
    const userId = assertNonEmpty(input.userId, "userId");
    const reason = assertNonEmpty(input.reason, "reason");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<PendingPayoutRow>(
        `SELECT id, paid_out_at, rejected_at
         FROM ${this.pendingTable()}
         WHERE id = $1
         FOR UPDATE`,
        [pendingId],
      );
      if (rows.length === 0) {
        throw new DomainError(
          "PENDING_PAYOUT_NOT_FOUND",
          `Pending payout '${pendingId}' finnes ikke.`,
        );
      }
      const row = rows[0]!;

      if (row.paid_out_at !== null) {
        throw new DomainError(
          "ALREADY_PAID_OUT",
          `Pending payout '${pendingId}' er allerede utbetalt — kan ikke avvises.`,
        );
      }
      if (row.rejected_at !== null) {
        throw new DomainError(
          "ALREADY_REJECTED",
          `Pending payout '${pendingId}' er allerede avvist.`,
        );
      }

      const now = new Date();
      await client.query(
        `UPDATE ${this.pendingTable()}
            SET rejected_at          = $2,
                rejected_by_user_id  = $3,
                rejected_reason      = $4
         WHERE id = $1`,
        [pendingId, now, userId, reason],
      );
      await client.query("COMMIT");

      return {
        pendingPayoutId: pendingId,
        rejectedAt: now.toISOString(),
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
        // ignorer rollback-feil
      });
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async findByUniqueKey(
    hallId: string,
    ticketId: string,
    patternPhase: string,
  ): Promise<PhysicalTicketPendingPayout | null> {
    const { rows } = await this.pool.query<PendingPayoutRow>(
      `SELECT id, ticket_id, hall_id, scheduled_game_id, pattern_phase,
              expected_payout_cents, responsible_user_id, color,
              detected_at, verified_at, verified_by_user_id,
              paid_out_at, paid_out_by_user_id,
              admin_approval_required, admin_approved_at, admin_approved_by_user_id,
              rejected_at, rejected_by_user_id, rejected_reason
       FROM ${this.pendingTable()}
       WHERE hall_id = $1 AND ticket_id = $2 AND pattern_phase = $3
       LIMIT 1`,
      [hallId, ticketId, patternPhase],
    );
    const row = rows[0];
    return row ? this.map(row) : null;
  }

  private map(r: PendingPayoutRow): PhysicalTicketPendingPayout {
    return {
      id: r.id,
      ticketId: r.ticket_id,
      hallId: r.hall_id,
      scheduledGameId: r.scheduled_game_id,
      patternPhase: r.pattern_phase,
      expectedPayoutCents: Number(r.expected_payout_cents),
      responsibleUserId: r.responsible_user_id,
      color: r.color,
      detectedAt: asIso(r.detected_at),
      verifiedAt: asIsoOrNull(r.verified_at),
      verifiedByUserId: r.verified_by_user_id,
      paidOutAt: asIsoOrNull(r.paid_out_at),
      paidOutByUserId: r.paid_out_by_user_id,
      adminApprovalRequired: r.admin_approval_required,
      adminApprovedAt: asIsoOrNull(r.admin_approved_at),
      adminApprovedByUserId: r.admin_approved_by_user_id,
      rejectedAt: asIsoOrNull(r.rejected_at),
      rejectedByUserId: r.rejected_by_user_id,
      rejectedReason: r.rejected_reason,
    };
  }
}

interface PendingPayoutRow {
  id: string;
  ticket_id: string;
  hall_id: string;
  scheduled_game_id: string;
  pattern_phase: string;
  expected_payout_cents: number | string;
  responsible_user_id: string;
  color: string;
  detected_at: Date | string;
  verified_at: Date | string | null;
  verified_by_user_id: string | null;
  paid_out_at: Date | string | null;
  paid_out_by_user_id: string | null;
  admin_approval_required: boolean;
  admin_approved_at: Date | string | null;
  admin_approved_by_user_id: string | null;
  rejected_at: Date | string | null;
  rejected_by_user_id: string | null;
  rejected_reason: string | null;
}
