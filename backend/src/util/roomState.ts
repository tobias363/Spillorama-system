/**
 * RoomStateManager — encapsulates the shared mutable Maps for room-level state.
 * Extracted from index.ts. Owns: armed players, lucky numbers, display ticket cache,
 * per-room configured entry fees. All helpers are method wrappers around these Maps.
 */
import { generateDatabingo60Ticket, generateBingo75Ticket } from "../game/ticket.js";
import type { Ticket } from "../game/types.js";
import type { GameVariantConfig } from "../game/variantConfig.js";

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
  readonly armedPlayerIdsByRoom = new Map<string, Set<string>>();
  readonly displayTicketCache = new Map<string, Ticket[]>();
  readonly variantByRoom = new Map<string, RoomVariantInfo>();

  // ── Armed players ──────────────────────────────────────────────────────────

  getArmedPlayerIds(roomCode: string): string[] {
    return [...(this.armedPlayerIdsByRoom.get(roomCode) ?? [])];
  }

  armPlayer(roomCode: string, playerId: string): void {
    let set = this.armedPlayerIdsByRoom.get(roomCode);
    if (!set) { set = new Set(); this.armedPlayerIdsByRoom.set(roomCode, set); }
    set.add(playerId);
  }

  disarmPlayer(roomCode: string, playerId: string): void {
    this.armedPlayerIdsByRoom.get(roomCode)?.delete(playerId);
  }

  disarmAllPlayers(roomCode: string): void {
    this.armedPlayerIdsByRoom.get(roomCode)?.clear();
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

  getOrCreateDisplayTickets(roomCode: string, playerId: string, count: number, gameSlug?: string): Ticket[] {
    const key = `${roomCode}:${playerId}`;
    const cached = this.displayTicketCache.get(key);
    if (cached && cached.length === count) return cached;
    // Game 1 (bingo) uses 75-ball 5x5 tickets; all other games use 60-ball 3x5 tickets.
    const generator = gameSlug === "bingo" ? generateBingo75Ticket : generateDatabingo60Ticket;
    const tickets: Ticket[] = [];
    for (let i = 0; i < count; i++) tickets.push(generator());
    this.displayTicketCache.set(key, tickets);
    return tickets;
  }

  clearDisplayTicketCache(roomCode: string): void {
    for (const key of this.displayTicketCache.keys()) {
      if (key.startsWith(`${roomCode}:`)) this.displayTicketCache.delete(key);
    }
  }

  // ── Game variant config ───────────────────────────────────────────────────

  setVariantConfig(roomCode: string, info: RoomVariantInfo): void {
    this.variantByRoom.set(roomCode, info);
  }

  getVariantConfig(roomCode: string): RoomVariantInfo | null {
    return this.variantByRoom.get(roomCode) ?? null;
  }
}
