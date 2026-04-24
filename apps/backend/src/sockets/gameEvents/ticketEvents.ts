/**
 * PR-R4: Ticket-cluster handlers.
 *
 * Inneholder:
 *   - ticket:mark    (høy-frekvens marker; privat ack til avsender,
 *                     ingen room-fanout — BIN-499)
 *   - ticket:replace (betalt pre-round billett-bytte, Zod-validert — BIN-509/545)
 *   - ticket:swap    (gratis pre-round bytte for Game 5 Spillorama — BIN-585)
 *   - ticket:cancel  (gratis avbestill pre-round billett/bundle — BIN-692)
 *
 * Alle tre "ticket:*"-variantene (replace/swap/cancel) er pre-round-operasjoner:
 * hvis runden er RUNNING → avvises. De deler `replaceDisplayTicket` /
 * `cancelPreRoundTicket` i `deps` (display-cache er delt state mellom tickets
 * og rommet generelt, men cachen er allerede isolert via deps-injection).
 *
 * Ingen logikk endret.
 */
import {
  TicketReplacePayloadSchema,
  TicketSwapPayloadSchema,
  TicketCancelPayloadSchema,
} from "@spillorama/shared-types/socket-events";
import { DomainError } from "../../game/BingoEngine.js";
import { IdempotencyKeys } from "../../game/idempotency.js";
import type { SocketContext } from "./context.js";
import type { AckResponse, MarkPayload } from "./types.js";

export function registerTicketEvents(ctx: SocketContext): void {
  const {
    socket,
    engine,
    deps,
    ackSuccess,
    ackFailure,
    rateLimited,
    requireAuthenticatedPlayerAction,
  } = ctx;
  const { emitRoomUpdate } = deps;

  // BIN-499: ticket:mark is high-frequency. Room-fanout scaled as O(players × marks);
  // at 1000 players × 15 tickets × 20 marks/round = 300k full-snapshot broadcasts per
  // round. Since engine.markNumber does not auto-submit claims, a mark never changes
  // shared room state observable to other players — so the room-fanout is pure waste.
  //
  // New behavior:
  //   - Update the player's marks (engine.markNumber).
  //   - Send a private ticket:marked event to this socket only (optimistic UI hook).
  //   - No room-fanout. Claims (LINE/BINGO) still fanout via the claim:submit handler.
  socket.on("ticket:mark", rateLimited("ticket:mark", async (payload: MarkPayload, callback: (response: AckResponse<{ number: number; playerId: string }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      if (!Number.isFinite(payload?.number)) {
        throw new DomainError("INVALID_INPUT", "number mangler.");
      }
      const number = Number(payload.number);
      await engine.markNumber({ roomCode, playerId, number });
      // Private ack event — no room-fanout.
      socket.emit("ticket:marked", { roomCode, playerId, number });
      ackSuccess(callback, { number, playerId });
    } catch (error) {
      ackFailure(callback, error);
    }
  }));

  // BIN-509: ticket:replace — pre-round swap of a single display ticket,
  // charging gameVariant.replaceAmount. Runtime-validated via Zod (BIN-545).
  // The engine gates on GAME_RUNNING and INSUFFICIENT_FUNDS; the handler
  // looks up the replacement amount from variant config and does the cache
  // swap after the wallet debit succeeds.
  socket.on("ticket:replace", rateLimited("ticket:replace", async (payload: unknown, callback: (response: AckResponse<{ ticketId: string; debitedAmount: number }>) => void) => {
    try {
      const parsed = TicketReplacePayloadSchema.safeParse(payload);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const field = first?.path.join(".") || "payload";
        throw new DomainError("INVALID_INPUT", `ticket:replace payload invalid (${field}: ${first?.message ?? "unknown"}).`);
      }
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(parsed.data);
      const ticketId = parsed.data.ticketId;

      // Resolve replaceAmount from the room's active variant config.
      const variantInfo = deps.getVariantConfig?.(roomCode);
      const replaceAmount = variantInfo?.config.replaceAmount ?? 0;
      if (!(replaceAmount > 0)) {
        throw new DomainError("REPLACE_NOT_ALLOWED", "Denne varianten støtter ikke billettbytte.");
      }

      // Idempotency: (room, player, ticket) is the natural key. A retried
      // request with the same ticketId produces the same ledger entry.
      const idempotencyKey = IdempotencyKeys.adhocTicketReplace({
        roomCode,
        playerId,
        ticketId,
      });
      const { debitedAmount } = await engine.chargeTicketReplacement(
        roomCode,
        playerId,
        replaceAmount,
        idempotencyKey,
      );

      // Swap the display ticket in place only after the charge succeeds.
      const snapshot = engine.getRoomSnapshot(roomCode);
      const newTicket = deps.replaceDisplayTicket?.(roomCode, playerId, ticketId, snapshot.gameSlug) ?? null;
      if (!newTicket) {
        // The player's id is authenticated and the charge already went
        // through, but the cache doesn't know about this ticketId. That's a
        // client bug — report it, don't silently swallow.
        throw new DomainError("TICKET_NOT_FOUND", `Ingen pre-round billett med id=${ticketId}.`);
      }

      await emitRoomUpdate(roomCode);
      ackSuccess(callback, { ticketId, debitedAmount });
    } catch (error) {
      ackFailure(callback, error);
    }
  }));

  // BIN-585: ticket:swap — free pre-round ticket swap for Game 5 (Spillorama).
  // Legacy parity with `SwapTicket` (unity-backend Game5 GameController.swapTicket).
  // Shares the display-cache mechanic with ticket:replace but skips the wallet
  // debit — Game 5 tickets are slot-style cosmetic, so legacy gives a free
  // re-roll in the Waiting phase. Gated by gameSlug === "spillorama" so paid
  // games continue to use ticket:replace; relaxing the gate later is a
  // one-line change if product wants free swap in other variants.
  socket.on("ticket:swap", rateLimited("ticket:swap", async (payload: unknown, callback: (response: AckResponse<{ ticketId: string }>) => void) => {
    try {
      const parsed = TicketSwapPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const field = first?.path.join(".") || "payload";
        throw new DomainError("INVALID_INPUT", `ticket:swap payload invalid (${field}: ${first?.message ?? "unknown"}).`);
      }
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(parsed.data);
      const ticketId = parsed.data.ticketId;

      const snapshot = engine.getRoomSnapshot(roomCode);
      if (snapshot.currentGame?.status === "RUNNING") {
        throw new DomainError("GAME_RUNNING", "Kan ikke bytte billett mens spillet pågår.");
      }
      if (snapshot.gameSlug !== "spillorama") {
        throw new DomainError("SWAP_NOT_ALLOWED", "Gratis billettbytte er kun tilgjengelig i Spillorama.");
      }

      const newTicket = deps.replaceDisplayTicket?.(roomCode, playerId, ticketId, snapshot.gameSlug) ?? null;
      if (!newTicket) {
        throw new DomainError("TICKET_NOT_FOUND", `Ingen pre-round billett med id=${ticketId}.`);
      }

      await emitRoomUpdate(roomCode);
      ackSuccess(callback, { ticketId });
    } catch (error) {
      ackFailure(callback, error);
    }
  }));

  // BIN-692: ticket:cancel — remove a single pre-round ticket (or its
  // whole bundle, for Large/Elvis/Traffic-light types). Pre-round arm
  // is not yet debited, so cancellation is free — no wallet operation.
  //
  // gives the player an in-place × on each ticket that removes the
  // bundle and disarms when the last bundle is dropped.
  socket.on("ticket:cancel", rateLimited("ticket:cancel", async (payload: unknown, callback: (response: AckResponse<{ removedTicketIds: string[]; remainingTicketCount: number; fullyDisarmed: boolean }>) => void) => {
    try {
      const parsed = TicketCancelPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const field = first?.path.join(".") || "payload";
        throw new DomainError("INVALID_INPUT", `ticket:cancel payload invalid (${field}: ${first?.message ?? "unknown"}).`);
      }
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(parsed.data);
      const ticketId = parsed.data.ticketId;

      // Gate: never permitted while the round is RUNNING. Cancelling
      // mid-round would require refunding real money already debited
      // at game:start — product decision (Tobias, 2026-04-20) is to
      // forbid it entirely. "Avbestill bonger" cancel-all has the same
      // gate implicitly (disarm is a no-op under RUNNING).
      const snapshot = engine.getRoomSnapshot(roomCode);
      if (snapshot.currentGame?.status === "RUNNING") {
        throw new DomainError("GAME_RUNNING", "Kan ikke avbestille brett mens runden pågår.");
      }

      if (!deps.cancelPreRoundTicket) {
        throw new DomainError("NOT_SUPPORTED", "ticket:cancel ikke konfigurert på serveren.");
      }

      // In production `deps.getVariantConfig` is backed by the engine and
      // always returns a config (default-standard fallback before startGame).
      // The null-branch only fires when a test harness leaves the dep
      // unwired, or from a future regression that drops the fallback.
      // In production `deps.getVariantConfig` is backed by the engine and
      // always returns a config (default-standard fallback before startGame).
      // The null-branch only fires when a test harness leaves the dep
      // unwired, or from a future regression that drops the fallback.
      const variantInfo = deps.getVariantConfig?.(roomCode);
      if (!variantInfo) {
        throw new DomainError("NOT_SUPPORTED", "Ingen variant-config for rommet.");
      }

      const result = deps.cancelPreRoundTicket(
        roomCode,
        playerId,
        ticketId,
        variantInfo.config,
      );
      if (!result) {
        throw new DomainError("TICKET_NOT_FOUND", `Ingen pre-round billett med id=${ticketId}.`);
      }

      // BIN-693 Option B: frigi prorata fra wallet-reservasjonen. Hvis
      // fullyDisarmed → full release (klarer reservation-mapping også).
      // Ellers: delta × entryFee.
      const adapter = deps.walletAdapter;
      if (adapter?.releaseReservation && deps.getReservationId && deps.clearReservationId) {
        const resId = deps.getReservationId(roomCode, playerId);
        if (resId) {
          try {
            if (result.fullyDisarmed) {
              await adapter.releaseReservation(resId);
              deps.clearReservationId(roomCode, playerId);
            } else {
              const entryFee = deps.getRoomConfiguredEntryFee(roomCode);
              const releasedKr = result.removedTicketIds.length * entryFee;
              if (releasedKr > 0) {
                await adapter.releaseReservation(resId, releasedKr);
              }
            }
          } catch {
            // Race med expiry/commit — trygg å ignorere, UI viser oppdatert
            // saldo neste tick.
          }
        }
      }

      // BIN-693: refresh player.balance etter release så room:update viser
      // oppdatert available_balance umiddelbart.
      const walletId = deps.getWalletIdForPlayer?.(roomCode, playerId);
      if (walletId) {
        await engine.refreshPlayerBalancesForWallet(walletId);
      }

      await emitRoomUpdate(roomCode);
      ackSuccess(callback, result);
    } catch (error) {
      ackFailure(callback, error);
    }
  }));
}
