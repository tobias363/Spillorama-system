/**
 * RoomStateManager — encapsulates the shared mutable Maps for room-level state.
 * Extracted from index.ts. Owns: armed players, lucky numbers, display ticket cache,
 * per-room configured entry fees. All helpers are method wrappers around these Maps.
 */
import { generateTicketForGame } from "../game/ticket.js";
import type { Ticket } from "../game/types.js";
import type { GameVariantConfig } from "../game/variantConfig.js";

/** Per-type ticket selection stored for an armed player. */
export interface TicketSelection {
  /** Ticket type code, e.g. "small", "large", "elvis". */
  type: string;
  /** How many of this ticket type to purchase. */
  qty: number;
  /**
   * BIN-688: human-readable ticket-type name (e.g. "Small Yellow"),
   * matching `TicketTypeConfig.name` in variantConfig.ts. Optional for
   * backward compat — clients that only send `type` still arm successfully,
   * but pre-round tickets then fall back to sequential colour cycling.
   */
  name?: string;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  emojiId: number;
  createdAt: string;
}

export interface RoomVariantInfo {
  gameType: string;
  config: GameVariantConfig;
}

export class RoomStateManager {
  readonly chatHistoryByRoom = new Map<string, ChatMessage[]>();
  readonly luckyNumbersByRoom = new Map<string, Map<string, number>>();
  readonly roomConfiguredEntryFeeByRoom = new Map<string, number>();
  readonly armedPlayerIdsByRoom = new Map<string, Map<string, number>>();
  /** Per-player ticket type selections (parallel to armedPlayerIdsByRoom). */
  readonly armedPlayerSelectionsByRoom = new Map<string, Map<string, TicketSelection[]>>();
  readonly displayTicketCache = new Map<string, Ticket[]>();
  readonly variantByRoom = new Map<string, RoomVariantInfo>();

  // ── Armed players ──────────────────────────────────────────────────────────

  getArmedPlayerIds(roomCode: string): string[] {
    const map = this.armedPlayerIdsByRoom.get(roomCode);
    return map ? [...map.keys()] : [];
  }

  /** Returns per-player ticket counts (total weighted) for all armed players. */
  getArmedPlayerTicketCounts(roomCode: string): Record<string, number> {
    const map = this.armedPlayerIdsByRoom.get(roomCode);
    if (!map) return {};
    return Object.fromEntries(map);
  }

  /** Returns per-player ticket type selections for all armed players. */
  getArmedPlayerSelections(roomCode: string): Record<string, TicketSelection[]> {
    const selMap = this.armedPlayerSelectionsByRoom.get(roomCode);
    if (!selMap) return {};
    const result: Record<string, TicketSelection[]> = {};
    for (const [pid, sels] of selMap) {
      result[pid] = sels;
    }
    return result;
  }

  armPlayer(roomCode: string, playerId: string, ticketCount: number = 1, selections?: TicketSelection[]): void {
    let map = this.armedPlayerIdsByRoom.get(roomCode);
    if (!map) { map = new Map(); this.armedPlayerIdsByRoom.set(roomCode, map); }
    map.set(playerId, ticketCount);

    // Store selections if provided
    if (selections && selections.length > 0) {
      let selMap = this.armedPlayerSelectionsByRoom.get(roomCode);
      if (!selMap) { selMap = new Map(); this.armedPlayerSelectionsByRoom.set(roomCode, selMap); }
      selMap.set(playerId, selections);
    } else {
      // Clear any stale selections for backward compat (ticketCount-only arm)
      this.armedPlayerSelectionsByRoom.get(roomCode)?.delete(playerId);
    }
  }

  disarmPlayer(roomCode: string, playerId: string): void {
    this.armedPlayerIdsByRoom.get(roomCode)?.delete(playerId);
    this.armedPlayerSelectionsByRoom.get(roomCode)?.delete(playerId);
  }

  disarmAllPlayers(roomCode: string): void {
    this.armedPlayerIdsByRoom.get(roomCode)?.clear();
    this.armedPlayerSelectionsByRoom.get(roomCode)?.clear();
  }

  // ── Lucky numbers ──────────────────────────────────────────────────────────

  getLuckyNumbers(roomCode: string): Record<string, number> {
    const roomMap = this.luckyNumbersByRoom.get(roomCode);
    if (!roomMap) return {};
    return Object.fromEntries(roomMap);
  }

  // ── Entry fee ──────────────────────────────────────────────────────────────

  getRoomConfiguredEntryFee(roomCode: string, fallbackEntryFee: number): number {
    const configured = this.roomConfiguredEntryFeeByRoom.get(roomCode);
    return configured === undefined || !Number.isFinite(configured) ? fallbackEntryFee : configured;
  }

  // ── Display tickets ────────────────────────────────────────────────────────

  // BIN-672: gameSlug is REQUIRED. Passing undefined used to silently
  // generate 3×5 Databingo60 tickets instead of Bingo75 5×5 — root cause
  // of BIN-619/BIN-671 bug. Now the callers must pass it explicitly;
  // generateTicketForGame throws on unknown slugs (see commit 5).
  //
  // BIN-688: `colorAssignments` lets callers colour each generated ticket
  // according to the player's armed selections (Small Yellow vs Small
  // Purple — both have type="small", colour is the distinguisher). If the
  // signature of the colour assignments changes between calls, we
  // invalidate the cache even when `count` matches — otherwise changing
  // armed selections (same total, different mix) would keep showing the
  // old colours. Omitting `colorAssignments` preserves the pre-BIN-688
  // behaviour of sequential cycling client-side.
  getOrCreateDisplayTickets(
    roomCode: string,
    playerId: string,
    count: number,
    gameSlug: string,
    colorAssignments?: Array<{ color: string; type: string }>,
  ): Ticket[] {
    const key = `${roomCode}:${playerId}`;
    const cached = this.displayTicketCache.get(key);
    if (cached && cached.length === count && this.colorsMatch(cached, colorAssignments)) {
      return cached;
    }
    // Format is decided by `generateTicketForGame` in ticket.ts — single source
    // of truth for all game slugs (Game 1 75-ball, Game 2 3×3, others 60-ball).
    const tickets: Ticket[] = [];
    for (let i = 0; i < count; i++) {
      const base = { ...generateTicketForGame(gameSlug), id: `tkt-${i}` };
      const assignment = colorAssignments?.[i];
      if (assignment) {
        base.color = assignment.color;
        base.type = assignment.type;
      }
      tickets.push(base);
    }
    this.displayTicketCache.set(key, tickets);
    return tickets;
  }

  /**
   * BIN-688: compare cached tickets' `color`/`type` with a fresh
   * `colorAssignments` array. Mismatch → cache must regenerate so UI
   * reflects the new armed selections.
   *
   * If `colorAssignments` is undefined, a match means the cache also has
   * no colours (backward-compat path).
   */
  private colorsMatch(cached: Ticket[], colorAssignments?: Array<{ color: string; type: string }>): boolean {
    if (!colorAssignments) {
      // Cache hit only if cached tickets likewise have no colours.
      return cached.every((t) => t.color === undefined);
    }
    if (cached.length !== colorAssignments.length) return false;
    for (let i = 0; i < cached.length; i++) {
      if (cached[i].color !== colorAssignments[i].color) return false;
      if (cached[i].type !== colorAssignments[i].type) return false;
    }
    return true;
  }

  /**
   * BIN-509: replace a single pre-round ticket in place, preserving other
   * tickets' ids and order. Returns the new ticket, or null if no such
   * ticketId exists in the cache.
   *
   * The caller is responsible for verifying game-state and debiting the
   * player's wallet — this method only mutates the display cache.
   */
  // BIN-672: gameSlug required — same reasoning as getOrCreateDisplayTickets.
  replaceDisplayTicket(roomCode: string, playerId: string, ticketId: string, gameSlug: string): Ticket | null {
    const key = `${roomCode}:${playerId}`;
    const cached = this.displayTicketCache.get(key);
    if (!cached) return null;
    const idx = cached.findIndex((t) => t.id === ticketId);
    if (idx < 0) return null;
    const replacement: Ticket = { ...generateTicketForGame(gameSlug), id: ticketId };
    cached[idx] = replacement;
    return replacement;
  }

  clearDisplayTicketCache(roomCode: string): void {
    for (const key of this.displayTicketCache.keys()) {
      if (key.startsWith(`${roomCode}:`)) this.displayTicketCache.delete(key);
    }
  }

  /**
   * BIN-690: Snapshot the per-player display-ticket cache for a room.
   *
   * Returns a `{ playerId: Ticket[] }` map covering every player in this
   * room that has display-tickets cached. Each ticket array is a **shallow
   * copy** so callers (engine.startGame) cannot mutate the cache by
   * accident during adoption.
   *
   * Used at `game:start` to adopt the exact grids the player saw while
   * arming — so the pre-round brett visuals equal the live-round brett.
   */
  getPreRoundTicketsByPlayerId(roomCode: string): Record<string, Ticket[]> {
    const result: Record<string, Ticket[]> = {};
    const prefix = `${roomCode}:`;
    for (const [key, tickets] of this.displayTicketCache.entries()) {
      if (!key.startsWith(prefix)) continue;
      const playerId = key.slice(prefix.length);
      result[playerId] = tickets.map((t) => ({ ...t }));
    }
    return result;
  }

  // ── Game variant config ───────────────────────────────────────────────────

  setVariantConfig(roomCode: string, info: RoomVariantInfo): void {
    this.variantByRoom.set(roomCode, info);
  }

  getVariantConfig(roomCode: string): RoomVariantInfo | null {
    return this.variantByRoom.get(roomCode) ?? null;
  }

  /**
   * BIN-692: Cancel a single pre-round ticket — or its whole bundle —
   * atomically. Returns a diff describing what changed so the caller
   * (socket handler) can log + emit room:update.
   *
   * Bundle semantics: ticket-types with `ticketCount > 1` (Large = 3
   * brett, Elvis = 2, Traffic-light = 3) are purchased as one unit.
   * Clicking × on ANY brett in that bundle removes ALL brett in the
   * bundle — Unity parity with `Game1ViewPurchaseElvisTicket.cs:17,49-76`
   * deleteBtn.
   *
   * Returns `null` when the ticketId isn't in the display cache (stale
   * client or double-click race) — caller should treat as a no-op.
   *
   * Side-effects:
   *   - Removes `bundleSize` consecutive tickets from displayTicketCache
   *   - Reduces matching selection.qty by 1; removes selection entry
   *     when qty hits 0
   *   - Updates the player's totalWeighted ticket count; fully disarms
   *     the player when selections are emptied
   *   - Does NOT touch wallets: pre-round arm is not yet debited
   *     (BingoEngine.startGame debits the buy-in at game-start)
   */
  cancelPreRoundTicket(
    roomCode: string,
    playerId: string,
    ticketId: string,
    variantConfig: GameVariantConfig,
  ): { removedTicketIds: string[]; remainingTicketCount: number; fullyDisarmed: boolean } | null {
    const cacheKey = `${roomCode}:${playerId}`;
    const displayTickets = this.displayTicketCache.get(cacheKey);
    if (!displayTickets || displayTickets.length === 0) return null;

    const ticketIdx = displayTickets.findIndex((t) => t.id === ticketId);
    if (ticketIdx < 0) return null;

    const selections = this.armedPlayerSelectionsByRoom.get(roomCode)?.get(playerId);
    if (!selections || selections.length === 0) return null;

    // Walk selections in order and find which one this ticket index falls
    // into. Each selection occupies `qty * ticketsPerUnit` slots in the
    // display cache, matching `expandSelectionsToTicketColors` order.
    let cumulativeSlots = 0;
    for (let selIdx = 0; selIdx < selections.length; selIdx++) {
      const sel = selections[selIdx];
      const tt = sel.name
        ? variantConfig.ticketTypes.find((t) => t.name === sel.name)
        : variantConfig.ticketTypes.find((t) => t.type === sel.type);
      const bundleSize = Math.max(1, tt?.ticketCount ?? 1);
      const slotsForSelection = sel.qty * bundleSize;

      if (ticketIdx < cumulativeSlots + slotsForSelection) {
        // Ticket belongs to this selection. Find which bundle within it.
        const offsetWithinSelection = ticketIdx - cumulativeSlots;
        const bundleIndexWithinSelection = Math.floor(offsetWithinSelection / bundleSize);
        const bundleStartIdx = cumulativeSlots + bundleIndexWithinSelection * bundleSize;

        // Splice the whole bundle out of the display cache.
        const removed = displayTickets.splice(bundleStartIdx, bundleSize);
        const removedTicketIds = removed.map((t) => t.id ?? "");

        // Reduce qty; drop the selection if it hits 0.
        sel.qty -= 1;
        if (sel.qty <= 0) {
          selections.splice(selIdx, 1);
        }

        // Recompute totalWeighted from remaining selections so
        // armedPlayerIdsByRoom stays consistent. Fully disarm when nothing
        // remains — matches the existing `disarmPlayer` contract.
        let newTotalWeighted = 0;
        for (const s of selections) {
          const tt2 = s.name
            ? variantConfig.ticketTypes.find((t) => t.name === s.name)
            : variantConfig.ticketTypes.find((t) => t.type === s.type);
          newTotalWeighted += s.qty * Math.max(1, tt2?.ticketCount ?? 1);
        }

        let fullyDisarmed = false;
        if (selections.length === 0 || newTotalWeighted <= 0) {
          this.disarmPlayer(roomCode, playerId);
          // Also clear the (now empty) cache entry so the next room:update
          // doesn't propagate a stale empty list.
          this.displayTicketCache.delete(cacheKey);
          fullyDisarmed = true;
        } else {
          this.armedPlayerIdsByRoom.get(roomCode)?.set(playerId, newTotalWeighted);
        }

        return {
          removedTicketIds,
          remainingTicketCount: fullyDisarmed ? 0 : newTotalWeighted,
          fullyDisarmed,
        };
      }
      cumulativeSlots += slotsForSelection;
    }

    // Ticket index is past all selections — inconsistent state. Treat
    // as no-op rather than throw; caller logs it.
    return null;
  }
}
