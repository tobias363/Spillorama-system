/**
 * BIN-587 B4b follow-up: voucher-redemption socket cluster.
 *
 * Events:
 *   - `voucher:redeem`   (client → server, with ack): spiller innløser en kode.
 *                        Hvis `validateOnly=true` returnerer den applied-discount
 *                        uten å skrive redemption-raden.
 *
 * Server emitter:
 *   - `voucher:redeemed` til den respektive klient-socket'en med resultat
 *   - `voucher:rejected` til samme socket med grunn (kastes også via ack)
 *
 * Begge emits er private (ikke room-broadcast) — vouchere er pr-spiller.
 *
 * Legacy parity:
 *   - `ApplyVoucherCode` (G2/G3/G4) hadde samme shape: kode inn, rabatt ut.
 *   - Idempotens via `UNIQUE(voucher_id, user_id)` matcher legacy one-per-player.
 */

import { DomainError } from "../../game/BingoEngine.js";
import { mustBeNonEmptyString } from "../../util/httpHelpers.js";
import type { SocketContext } from "./context.js";
import type { AckResponse, VoucherRedeemPayload } from "./types.js";

interface VoucherRedeemResult {
  redemptionId: string | null;
  voucherId: string;
  code: string;
  type: "PERCENTAGE" | "FLAT_AMOUNT";
  value: number;
  discountAppliedCents: number;
  finalPriceCents: number;
  redeemedAt: string | null;
  /** True når bare validert (validateOnly=true). False etter faktisk innløsning. */
  validateOnly: boolean;
}

export function registerVoucherEvents(ctx: SocketContext): void {
  const {
    socket, deps, ackSuccess, ackFailure, rateLimited, getAuthenticatedSocketUser,
  } = ctx;

  socket.on(
    "voucher:redeem",
    rateLimited("voucher:redeem", async (
      payload: VoucherRedeemPayload,
      callback: (response: AckResponse<VoucherRedeemResult>) => void,
    ) => {
      try {
        const svc = deps.voucherRedemptionService;
        if (!svc) {
          throw new DomainError(
            "NOT_SUPPORTED",
            "Voucher-redemption er ikke konfigurert på serveren.",
          );
        }
        const user = await getAuthenticatedSocketUser(payload);
        // Rollebasert gate: bare PLAYER-rolle bruker egne vouchers. Admin kan
        // teste via HTTP-endpointet eller et fremtidig admin-gift-flyt.
        if (user.role !== "PLAYER") {
          throw new DomainError(
            "FORBIDDEN",
            "Kun spillere kan innløse vouchere via denne kanalen.",
          );
        }

        const code = mustBeNonEmptyString(payload?.code, "code");
        const gameSlug = mustBeNonEmptyString(payload?.gameSlug, "gameSlug");
        const ticketPriceCents = Number(payload?.ticketPriceCents);
        if (!Number.isFinite(ticketPriceCents) || !Number.isInteger(ticketPriceCents) || ticketPriceCents <= 0) {
          throw new DomainError(
            "INVALID_INPUT",
            "ticketPriceCents må være et positivt heltall (cents).",
          );
        }
        const scheduledGameId =
          typeof payload?.scheduledGameId === "string" && payload.scheduledGameId.trim()
            ? payload.scheduledGameId.trim()
            : null;
        const roomCode =
          typeof payload?.roomCode === "string" && payload.roomCode.trim()
            ? payload.roomCode.trim()
            : null;
        const validateOnly = payload?.validateOnly === true;

        if (validateOnly) {
          const discount = await svc.validateCode({
            code, userId: user.id, gameSlug, ticketPriceCents,
          });
          const result: VoucherRedeemResult = {
            redemptionId: null,
            voucherId: discount.voucherId,
            code: discount.code,
            type: discount.type,
            value: discount.value,
            discountAppliedCents: discount.discountAppliedCents,
            finalPriceCents: discount.finalPriceCents,
            redeemedAt: null,
            validateOnly: true,
          };
          socket.emit("voucher:redeemed", result);
          ackSuccess(callback, result);
          return;
        }

        const redemption = await svc.redeem({
          code,
          userId: user.id,
          walletId: user.walletId,
          gameSlug,
          ticketPriceCents,
          scheduledGameId,
          roomCode,
        });
        const result: VoucherRedeemResult = {
          redemptionId: redemption.redemptionId,
          voucherId: redemption.discount.voucherId,
          code: redemption.discount.code,
          type: redemption.discount.type,
          value: redemption.discount.value,
          discountAppliedCents: redemption.discount.discountAppliedCents,
          finalPriceCents: redemption.discount.finalPriceCents,
          redeemedAt: redemption.redeemedAt,
          validateOnly: false,
        };
        socket.emit("voucher:redeemed", result);
        ackSuccess(callback, result);
      } catch (error) {
        if (error instanceof DomainError) {
          socket.emit("voucher:rejected", {
            code: error.code,
            message: error.message,
          });
        }
        ackFailure(callback, error, "voucher:redeem");
      }
    }),
  );
}
