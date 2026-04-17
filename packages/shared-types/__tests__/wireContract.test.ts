/**
 * BIN-545: wire-contract tests.
 *
 * Each fixture file represents a JSON payload that a real client/server could
 * send or receive. Each one MUST validate against its paired Zod schema. If a
 * schema change breaks a payload format, one of these tests fails — which is
 * the whole point: the fixture is frozen to a known-good shape, the schema
 * evolves beside it.
 *
 * Naming: `<payload>.<variant>.json`
 *   - baseline: minimal valid instance (only required fields)
 *   - edge: realistic but near the boundary (currentGame present, empty marks)
 *   - stress: full complexity (multiple players, patterns, claims, history)
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  RoomUpdatePayloadSchema,
  DrawNewPayloadSchema,
  ClaimSubmitPayloadSchema,
} from "../src/schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");

function loadFixture(name: string): unknown {
  const path = join(fixturesDir, name);
  return JSON.parse(readFileSync(path, "utf8"));
}

const cases = [
  { schema: RoomUpdatePayloadSchema, name: "RoomUpdatePayload", files: ["roomUpdate.baseline.json", "roomUpdate.edge.json", "roomUpdate.stress.json"] },
  { schema: DrawNewPayloadSchema, name: "DrawNewPayload", files: ["drawNew.baseline.json", "drawNew.edge.json", "drawNew.stress.json"] },
  { schema: ClaimSubmitPayloadSchema, name: "ClaimSubmitPayload", files: ["claimSubmit.baseline.json", "claimSubmit.edge.json", "claimSubmit.stress.json"] },
];

for (const { schema, name, files } of cases) {
  for (const file of files) {
    test(`BIN-545 wire-contract: ${name} parses ${file}`, () => {
      const fixture = loadFixture(file);
      const result = schema.safeParse(fixture);
      if (!result.success) {
        const issues = result.error.issues.map((i) => `  • ${i.path.join(".") || "<root>"}: ${i.message}`).join("\n");
        assert.fail(`${file} failed schema validation:\n${issues}`);
      }
    });
  }
}

// ── Negative tests: the schema must REJECT known-bad payloads ───────────────
// These guard against the schema accidentally becoming too permissive.

test("BIN-545 negative: ClaimSubmitPayload rejects unknown type", () => {
  const bad = { roomCode: "X", type: "HOUSE" };
  const result = ClaimSubmitPayloadSchema.safeParse(bad);
  assert.equal(result.success, false, "type=HOUSE must be rejected — enum is LINE | BINGO");
});

test("BIN-545 negative: ClaimSubmitPayload rejects missing roomCode", () => {
  const bad = { type: "LINE" };
  const result = ClaimSubmitPayloadSchema.safeParse(bad);
  assert.equal(result.success, false, "missing roomCode must be rejected");
});

test("BIN-545 negative: DrawNewPayload rejects non-integer number", () => {
  const bad = { number: 7.5, drawIndex: 0, gameId: "g" };
  const result = DrawNewPayloadSchema.safeParse(bad);
  assert.equal(result.success, false, "non-integer number must be rejected");
});

test("BIN-545 negative: RoomUpdatePayload rejects missing serverTimestamp", () => {
  const bad = {
    code: "AB", hallId: "h", hostPlayerId: "p", createdAt: "2026-04-17T00:00:00Z",
    players: [], gameHistory: [], scheduler: {}, preRoundTickets: {},
    armedPlayerIds: [], luckyNumbers: {}, playerStakes: {},
    // serverTimestamp intentionally missing
  };
  const result = RoomUpdatePayloadSchema.safeParse(bad);
  assert.equal(result.success, false, "missing serverTimestamp must be rejected");
});
