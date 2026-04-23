/**
 * PR-R4: fasade for socket-event-handlerne.
 *
 * Denne filen er nå kun wire-up: alle event-handlere er flyttet til
 * `sockets/gameEvents/`-cluster-filer. Offentlige eksporter
 * (`createGameEventHandlers`, `GameEventsDeps`, `BingoSchedulerSettings`,
 * `emitG3DrawEvents`) bevares for bakoverkompatibilitet — eksisterende
 * importer i `apps/backend/src/index.ts` og `__tests__/` er urørt.
 *
 * Kluster-oversikt (se `gameEvents/README` eller de enkelte filene for
 * detaljer):
 *   - roomEvents.ts          — room:create/join/resume/configure/state + bet:arm + lucky:set
 *   - gameLifecycleEvents.ts — game:start / game:end
 *   - drawEvents.ts          — draw:next / draw:extra:purchase (G2/G3-emits)
 *   - ticketEvents.ts        — ticket:mark/replace/swap/cancel
 *   - claimEvents.ts         — claim:submit (+ mini-game/jackpot aktivering)
 *   - miniGameEvents.ts      — jackpot:spin / minigame:play
 *   - chatEvents.ts          — chat:send / chat:history
 *   - lifecycleEvents.ts     — leaderboard:get / disconnect
 *   - voucherEvents.ts       — voucher:redeem (+ voucher:redeemed / voucher:rejected emits)
 */
import type { Socket } from "socket.io";
import { buildRegistryContext, buildSocketContext } from "./gameEvents/context.js";
import { registerRoomEvents } from "./gameEvents/roomEvents.js";
import { registerGameLifecycleEvents } from "./gameEvents/gameLifecycleEvents.js";
import { registerDrawEvents } from "./gameEvents/drawEvents.js";
import { registerTicketEvents } from "./gameEvents/ticketEvents.js";
import { registerClaimEvents } from "./gameEvents/claimEvents.js";
import { registerMiniGameEvents } from "./gameEvents/miniGameEvents.js";
import { registerChatEvents } from "./gameEvents/chatEvents.js";
import { registerLifecycleEvents } from "./gameEvents/lifecycleEvents.js";
import { registerVoucherEvents } from "./gameEvents/voucherEvents.js";
import type { GameEventsDeps } from "./gameEvents/deps.js";

export { emitG3DrawEvents } from "./gameEvents/drawEmits.js";
export type { BingoSchedulerSettings, GameEventsDeps } from "./gameEvents/deps.js";

export function createGameEventHandlers(deps: GameEventsDeps) {
  const ctx = buildRegistryContext(deps);

  return function registerGameEvents(socket: Socket): void {
    const sctx = buildSocketContext(socket, ctx);

    registerRoomEvents(sctx);
    registerGameLifecycleEvents(sctx);
    registerDrawEvents(sctx);
    registerTicketEvents(sctx);
    registerClaimEvents(sctx);
    registerMiniGameEvents(sctx);
    registerChatEvents(sctx);
    registerLifecycleEvents(sctx);
    registerVoucherEvents(sctx);
  };
}
