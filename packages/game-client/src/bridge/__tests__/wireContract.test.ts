/**
 * BIN-527: wire-contract tests — game-client edition.
 *
 * For every fixture in the shared-types fixture bank, feed it through the
 * real GameBridge (via a mock socket) and assert:
 *   - Schema parse succeeds (guards against fixture drift).
 *   - The bridge's handler does not throw (guards against the bridge making
 *     assumptions about fields not declared in the schema).
 *
 * This is the client side of the three-leg wire-contract guarantee
 * (schema ↔ backend-generated ↔ client-consumed).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GameBridge } from "../GameBridge.js";
import type { SpilloramaSocketListeners } from "../../net/SpilloramaSocket.js";
import type { RoomSnapshot } from "@spillorama/shared-types/game";
import {
  RoomUpdatePayloadSchema,
  DrawNewPayloadSchema,
  PatternWonPayloadSchema,
  ChatMessageSchema,
  type RoomUpdatePayload,
  type DrawNewPayload,
  type PatternWonPayload,
  type ChatMessage,
} from "@spillorama/shared-types/socket-events";

const __dirname = dirname(fileURLToPath(import.meta.url));
// fixtures live at repo-root/packages/shared-types/fixtures
const fixturesDir = join(__dirname, "..", "..", "..", "..", "shared-types", "fixtures");

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as T;
}

// ── Mock socket (copied from GameBridge.test.ts so this file is standalone). ─

class MockSocket {
  private listeners: Record<string, Set<(...args: unknown[]) => void>> = {};
  public getRoomStateResponse = { ok: false as boolean, error: "not-stubbed" } as {
    ok: boolean;
    data?: { snapshot: RoomSnapshot };
    error?: string;
  };

  on<K extends keyof SpilloramaSocketListeners>(event: K, listener: SpilloramaSocketListeners[K]): () => void {
    if (!this.listeners[event]) this.listeners[event] = new Set();
    this.listeners[event].add(listener as unknown as (...args: unknown[]) => void);
    return () => this.listeners[event]?.delete(listener as unknown as (...args: unknown[]) => void);
  }

  fire<K extends keyof SpilloramaSocketListeners>(event: K, ...args: Parameters<SpilloramaSocketListeners[K]>): void {
    for (const fn of this.listeners[event] ?? []) {
      (fn as (...a: unknown[]) => void)(...args);
    }
  }

  async getRoomState() {
    return this.getRoomStateResponse;
  }
}

describe("BIN-527: client consumes wire-contract fixtures without throwing", () => {
  function setupBridge(playerId: string | null = "player-1") {
    const socket = new MockSocket();
    // MockSocket implements the same listener-registration surface GameBridge
    // needs — cast through unknown instead of pulling in the full concrete
    // SpilloramaSocket (which would pull in socket.io-client at test time).
    const bridge = new GameBridge(socket as unknown as ConstructorParameters<typeof GameBridge>[0]);
    bridge.start(playerId);
    return { socket, bridge };
  }

  // roomUpdate: feed every fixture; assert no throw + schema valid.
  const roomUpdateFiles = readdirSync(fixturesDir).filter((f) => f.startsWith("roomUpdate.") && f.endsWith(".json"));
  for (const file of roomUpdateFiles) {
    it(`handleRoomUpdate accepts ${file} without throwing`, () => {
      const fixture = loadFixture<RoomUpdatePayload>(file);
      const parse = RoomUpdatePayloadSchema.safeParse(fixture);
      expect(parse.success, `schema rejected ${file}: ${JSON.stringify(parse.error?.issues)}`).toBe(true);
      const { socket } = setupBridge();
      expect(() => socket.fire("roomUpdate", fixture)).not.toThrow();
    });
  }

  const drawNewFiles = readdirSync(fixturesDir).filter((f) => f.startsWith("drawNew.") && f.endsWith(".json"));
  for (const file of drawNewFiles) {
    it(`handleDrawNew accepts ${file} without throwing`, () => {
      const fixture = loadFixture<DrawNewPayload>(file);
      const parse = DrawNewPayloadSchema.safeParse(fixture);
      expect(parse.success).toBe(true);
      const { socket, bridge } = setupBridge();
      // BIN-502: drawNew is gated on a fresh baseline. Apply one room-update
      // first so the bridge has a currentGame to attach the draw to.
      const baseline = loadFixture<RoomUpdatePayload>("roomUpdate.edge.json");
      socket.fire("roomUpdate", baseline);
      expect(() => socket.fire("drawNew", fixture)).not.toThrow();
      // Sanity: bridge reflects the new draw in its gap metrics (or at least
      // doesn't mis-track it as a duplicate against the baseline).
      const metrics = bridge.getGapMetrics();
      expect(typeof metrics.gaps).toBe("number");
    });
  }

  const patternWonFiles = readdirSync(fixturesDir).filter((f) => f.startsWith("patternWon.") && f.endsWith(".json"));
  for (const file of patternWonFiles) {
    it(`patternWon broadcast relays ${file} through bridge`, () => {
      const fixture = loadFixture<PatternWonPayload>(file);
      const parse = PatternWonPayloadSchema.safeParse(fixture);
      expect(parse.success).toBe(true);
      const { socket, bridge } = setupBridge();
      let received: PatternWonPayload | null = null;
      bridge.on("patternWon", (p) => { received = p; });
      expect(() => socket.fire("patternWon", fixture)).not.toThrow();
      expect(received).toEqual(fixture);
    });
  }

  const chatFiles = readdirSync(fixturesDir).filter((f) => f.startsWith("chatMessage.") && f.endsWith(".json"));
  for (const file of chatFiles) {
    it(`chatMessage broadcast relays ${file} through bridge`, () => {
      const fixture = loadFixture<ChatMessage>(file);
      const parse = ChatMessageSchema.safeParse(fixture);
      expect(parse.success).toBe(true);
      const { socket, bridge } = setupBridge();
      let received: ChatMessage | null = null;
      bridge.on("chatMessage", (m) => { received = m; });
      expect(() => socket.fire("chatMessage", fixture)).not.toThrow();
      expect(received).toEqual(fixture);
    });
  }
});
