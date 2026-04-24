/**
 * BIN-527: wire-contract tests — backend edition.
 *
 * Two complementary checks:
 *   1. Every shared fixture (packages/shared-types/fixtures/*.json) parses
 *      against its paired schema. This is the same bank the shared-types
 *      test suite runs, re-exercised here so backend CI fails if a fixture
 *      is dropped or the schema path breaks inside the backend's ts-node
 *      resolution.
 *   2. Payloads that the backend actually *produces* at runtime — via
 *      `buildRoomUpdatePayload`, the ack shape of `claim:submit`, and the
 *      `pattern:won` broadcast — pass the shared Zod schemas. This catches
 *      drift between server-side generation and the wire contract before
 *      any client sees a malformed payload.
 */
import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RoomUpdatePayloadSchema,
  DrawNewPayloadSchema,
  ClaimSubmitPayloadSchema,
  BetArmPayloadSchema,
  TicketMarkPayloadSchema,
  PatternWonPayloadSchema,
  ChatMessageSchema,
} from "@spillorama/shared-types/socket-events";
import { createTestServer, type TestServer } from "./testServer.js";

interface AckResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
// Fixtures live next to the shared-types package, outside apps/backend.
const fixturesDir = join(__dirname, "..", "..", "..", "..", "..", "packages", "shared-types", "fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

// ── Fixture-bank tests ─────────────────────────────────────────────────────

const fixtureCases = [
  { schema: RoomUpdatePayloadSchema, prefix: "roomUpdate" },
  { schema: DrawNewPayloadSchema, prefix: "drawNew" },
  { schema: ClaimSubmitPayloadSchema, prefix: "claimSubmit" },
  { schema: BetArmPayloadSchema, prefix: "betArm" },
  { schema: TicketMarkPayloadSchema, prefix: "ticketMark" },
  { schema: PatternWonPayloadSchema, prefix: "patternWon" },
  { schema: ChatMessageSchema, prefix: "chatMessage" },
] as const;

for (const { schema, prefix } of fixtureCases) {
  // Dynamically enumerate so a new variant (e.g. baseline2) fails fast if the
  // fixture file is dropped but the test list isn't updated.
  const files = readdirSync(fixturesDir).filter((f) => f.startsWith(`${prefix}.`) && f.endsWith(".json"));
  for (const file of files) {
    test(`BIN-527 backend fixture: ${prefix} parses ${file}`, () => {
      const fixture = loadFixture(file);
      const result = schema.safeParse(fixture);
      if (!result.success) {
        const issues = result.error.issues.map((i) => `  • ${i.path.join(".") || "<root>"}: ${i.message}`).join("\n");
        assert.fail(`${file} failed schema validation:\n${issues}`);
      }
    });
  }
}

// ── Backend-generated payloads ─────────────────────────────────────────────
// We run a full room:create → bet:arm → game:start → draw:next flow and
// validate each broadcast/ack against the shared schemas.

describe("BIN-527 outgoing payloads conform to shared-types schemas", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  test("room:update + draw:new + pattern:won conform on a single round", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    // room:create — first room:update flows through this ack; validate it.
    const roomAck = await alice.emit<AckResponse<{ roomCode: string; playerId: string; snapshot: unknown }>>(
      "room:create",
      { hallId: "hall-test" },
    );
    assert.ok(roomAck.ok, `room:create failed: ${roomAck.error?.message}`);
    const roomCode = roomAck.data!.roomCode;
    // The ack snapshot is a RoomSnapshot, not the fully-hydrated RoomUpdate
    // payload. The real RoomUpdate comes from emitRoomUpdate and reaches
    // the socket via the "room:update" broadcast — exercise that path.

    const roomUpdatePromise = alice.waitFor<unknown>("room:update");
    await bob.emit("room:create", { hallId: "hall-test" });
    const roomUpdate = await roomUpdatePromise;
    const ruResult = RoomUpdatePayloadSchema.safeParse(roomUpdate);
    assert.ok(ruResult.success, `room:update payload invalid: ${JSON.stringify(ruResult.error?.issues, null, 2)}`);

    await alice.emit("bet:arm", { roomCode, armed: true });
    await bob.emit("bet:arm", { roomCode, armed: true });
    const startAck = await alice.emit<AckResponse>("game:start", { roomCode, entryFee: 10, ticketsPerPlayer: 1 });
    assert.ok(startAck.ok, `game:start failed: ${startAck.error?.message}`);

    // draw:new — wait for the broadcast, validate shape.
    const drawPromise = bob.waitFor<unknown>("draw:new");
    await alice.emit("draw:next", { roomCode });
    const drawEvent = await drawPromise;
    const drawResult = DrawNewPayloadSchema.safeParse(drawEvent);
    assert.ok(drawResult.success, `draw:new invalid: ${JSON.stringify(drawResult.error?.issues, null, 2)}`);
  });

  test("pattern:won payload conforms to PatternWonPayloadSchema", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>("room:create", { hallId: "hall-test" });
    const roomCode = r1.data!.roomCode;
    await bob.emit("room:create", { hallId: "hall-test" });
    // BIN-694: override to legacy "standard" manual-claim variant — new default
    // (Norsk 5-phase auto-claim) would consume the LINE phase before
    // claim:submit lands, so the pattern:won broadcast this test verifies
    // would never fire from the explicit claim path.
    server.roomState.setVariantConfig(roomCode, {
      gameType: "standard",
      config: {
        ticketTypes: [{ name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 }],
        patterns: [
          { name: "Row 1", claimType: "LINE" as const, prizePercent: 10, design: 1 },
          { name: "Full House", claimType: "BINGO" as const, prizePercent: 90, design: 0 },
        ],
      },
    });
    await alice.emit("bet:arm", { roomCode, armed: true });
    await bob.emit("bet:arm", { roomCode, armed: true });
    await alice.emit("game:start", { roomCode, entryFee: 10, ticketsPerPlayer: 1 });

    // Fixed ticket grid first row: [1,2,3,4,5]. Draw numbers until alice
    // has all five, then claim LINE and assert the broadcast payload.
    const gridNumbers = new Set([1, 2, 3, 4, 5, 13, 14, 15, 16, 17, 25, 26, 27, 28, 37, 38, 39, 40, 41, 49, 50, 51, 52, 53]);
    const needed = [1, 2, 3, 4, 5];
    const drawn: number[] = [];
    for (let i = 0; i < 60 && !needed.every((n) => drawn.includes(n)); i += 1) {
      const dr = await alice.emit<AckResponse<{ number: number }>>("draw:next", { roomCode });
      if (!dr.ok) break;
      drawn.push(dr.data!.number);
      if (gridNumbers.has(dr.data!.number)) {
        await alice.emit("ticket:mark", { roomCode, number: dr.data!.number });
      }
    }
    assert.ok(needed.every((n) => drawn.includes(n)), "could not complete row 1");

    const wonPromise = bob.waitFor<unknown>("pattern:won");
    const claimAck = await alice.emit<AckResponse>("claim:submit", { roomCode, type: "LINE" });
    assert.ok(claimAck.ok, `claim:submit failed: ${claimAck.error?.message}`);
    const wonEvent = await wonPromise;
    const wonResult = PatternWonPayloadSchema.safeParse(wonEvent);
    assert.ok(wonResult.success, `pattern:won invalid: ${JSON.stringify(wonResult.error?.issues, null, 2)}`);
  });

  test("chat:message broadcast conforms to ChatMessageSchema", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>("room:create", { hallId: "hall-test" });
    const roomCode = r1.data!.roomCode;
    await bob.emit("room:create", { hallId: "hall-test" });

    const msgPromise = bob.waitFor<unknown>("chat:message");
    await alice.emit("chat:send", { roomCode, message: "Hei bob!" });
    const broadcast = await msgPromise;
    const result = ChatMessageSchema.safeParse(broadcast);
    assert.ok(result.success, `chat:message invalid: ${JSON.stringify(result.error?.issues, null, 2)}`);
  });

  // Regresjon for "playerId mangler" (2026-04-24): en ADMIN-bruker som selv
  // står i rommet (via room:create → engine.createRoom legger admin inn som
  // player) skal kunne utføre spiller-handlinger uten å måtte sende
  // `playerId` i payload — klient-flyten gjør det aldri. Før fiksen feilet
  // bet:arm med INVALID_INPUT "playerId mangler." på admin-sti i context.ts.
  test("admin self-play: bet:arm lykkes uten playerId i payload", async () => {
    const admin = await server.connectClient("token-admin");

    const createAck = await admin.emit<AckResponse<{ roomCode: string; playerId: string }>>(
      "room:create",
      { hallId: "hall-test" },
    );
    assert.ok(createAck.ok, `room:create failed: ${createAck.error?.message}`);
    const roomCode = createAck.data!.roomCode;
    assert.ok(createAck.data!.playerId, "admin should be assigned a playerId on room:create");

    // Ingen playerId i payload — skal likevel gå gjennom fordi admin selv
    // er player (walletId-match) i rommet.
    const armAck = await admin.emit<AckResponse>("bet:arm", { roomCode, armed: true });
    assert.ok(armAck.ok, `bet:arm failed for admin self-play: ${armAck.error?.message}`);
  });
});
