/**
 * ADR-0019 Wave 1, P0-3 + P0-4 (Agent B, 2026-05-10): canonical room-key
 * helpers for admin-targeted Socket.IO broadcasts.
 *
 * Why these exist:
 *   - Before this module, transfer-events and per-spiller-strip-bypass used
 *     bare `io.emit(...)` which leaked admin payloads to every connected
 *     socket on the default namespace (~36k at pilot peak). That's a
 *     Wave-3b/ADR-0013 violation.
 *   - Master-konsoll already joins `game1:<gameId>` on the `/admin-game1`
 *     namespace, so namespace-scoped emits stay tight. The leak is purely
 *     on the default namespace (agent-portal lives there).
 *
 * Two rooms:
 *
 *   - `admin:masters:<gameId>` — for master/agent consoles that need
 *     transfer-request/approved/rejected/expired, master-action +
 *     master-changed + ready-status events. Joined by admin-web's
 *     master-konsoll + agent-portal after authentication.
 *
 *   - `<roomCode>:admin` — for admin/TV-display sockets that need the FULL
 *     `room:update` payload (admin-display, master-konsoll's room-view).
 *     Counterpart to the per-player strip in index.ts:1683. Without this
 *     room, perpetual `room:update` emits send only stripped payloads to
 *     player-bound sockets, leaving admin/TV with `players=[]`,
 *     `tickets={}`, `marks={}`. That breaks "alle ser samme state".
 *
 * Both are stable strings — admin-web pins exact names, so DO NOT rename
 * without a coordinated frontend update.
 */

/** Default-namespace room for admin/agent master-event consumers. */
export function adminMastersRoomKey(gameId: string): string {
  return `admin:masters:${gameId}`;
}

/** Default-namespace room for admin/TV consumers of FULL room snapshots. */
export function adminRoomSnapshotKey(roomCode: string): string {
  return `${roomCode}:admin`;
}
