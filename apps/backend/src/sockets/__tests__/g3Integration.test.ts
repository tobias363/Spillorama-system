/**
 * 2026-05-03 (Tobias-direktiv): Game 3 end-to-end integration test for det
 * nye 3×3 / 1..21-formatet (samme runtime som Spill 2 + Spill 1's stil).
 *
 * Tidligere (BIN-615 / PR-C3b, 2026-04-23) testet denne filen 5×5 / 1..75
 * pattern-cycler-flyten med Row 1-4 og Coverall-thresholds. Den varianten
 * er erstattet — Spill 3 har nå KUN Coverall (full 3×3-bong).
 *
 * Validerer hele runtime-pathen:
 *   Socket connect → room:create (G3 slug) → variant-config seed →
 *   game:start → draw:next-syklus → auto-claim på Coverall →
 *   `g3:pattern:auto-won` events på wire → runde ENDED med G3_FULL_HOUSE.
 *
 * Tester socket-laget korrekt drainer Game3Engine.getG3LastDrawEffects og
 * emitter `g3:pattern:changed` + `g3:pattern:auto-won` til subscribed klienter.
 */
import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import type { BingoSystemAdapter, CreateTicketInput } from "../../adapters/BingoSystemAdapter.js";
import type { Ticket } from "../../game/types.js";
import { DEFAULT_GAME3_CONFIG } from "../../game/variantConfig.js";
import { createTestServer, type TestServer } from "./testServer.js";

interface AckResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// ── Test fixtures ───────────────────────────────────────────────────────────

/**
 * 3×3-bong som vinner Coverall straks alle 9 cellene 1..9 er trukket.
 * Med drawbag [1, 2, ..., 21] lander Coverall på trekning 9.
 */
function buildEarlyWinTicket(): Ticket {
  return {
    grid: [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ],
  };
}

/** Adapter som returnerer en tidlig-vinner-bong for hvert kall. */
class EarlyWinTicketAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: buildEarlyWinTicket().grid.map((r) => [...r]) };
  }
}

/**
 * Drawbag som gir [1, 2, 3, ..., size]. Med size=21 og en early-win-bong
 * (1..9) lander Coverall på trekning 9.
 */
function sequentialDrawBag(size: number): number[] {
  return Array.from({ length: size }, (_, i) => i + 1);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Game3 integration — Coverall + g3:pattern:* wire-events (3×3 / 1..21)", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await createTestServer({
      useGame3Engine: true,
      bingoAdapter: new EarlyWinTicketAdapter(),
      drawBagFactory: sequentialDrawBag,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  test("Coverall vinnes på trekning 9 → g3:pattern:auto-won emittes til alle subscribed klienter", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    // Begge joiner samme G3-rom. gameSlug=monsterbingo aktiverer
    // isGame3Round-guarden i engine.
    const r1 = await alice.emit<AckResponse<{ roomCode: string; playerId: string }>>(
      "room:create", { hallId: "hall-test", gameSlug: "monsterbingo" },
    );
    assert.ok(r1.ok && r1.data, `room:create failed: ${r1.error?.message}`);
    const roomCode = r1.data.roomCode;

    const r2 = await bob.emit<AckResponse<{ playerId: string }>>(
      "room:create", { hallId: "hall-test", gameSlug: "monsterbingo" },
    );
    assert.ok(r2.ok && r2.data);

    // Seed G3 variant-config så game:start resolver `patternEvalMode=auto-claim-on-draw`.
    server.roomState.setVariantConfig(roomCode, {
      gameType: "monsterbingo",
      config: DEFAULT_GAME3_CONFIG,
    });

    // Arm begge spillere så game:start enrols dem.
    await alice.emit<AckResponse>("bet:arm", { roomCode, armed: true });
    await bob.emit<AckResponse>("bet:arm", { roomCode, armed: true });

    // Subscribe FØR game:start så vi ikke mister tidlige events.
    const g3Wins: unknown[] = [];
    const g3Changes: unknown[] = [];
    alice.socket.on("g3:pattern:auto-won", (p) => g3Wins.push(p));
    alice.socket.on("g3:pattern:changed", (p) => g3Changes.push(p));

    const startR = await alice.emit<AckResponse<{ snapshot: unknown }>>(
      "game:start", { roomCode, entryFee: 100, ticketsPerPlayer: 1 },
    );
    assert.ok(startR.ok, `game:start failed: ${startR.error?.message}`);

    // Trekk 1..9 → Coverall lander på trekning 9 (siste celle 9).
    for (let i = 0; i < 9; i += 1) {
      const dR = await alice.emit<AckResponse<{ number: number }>>("draw:next", { roomCode });
      assert.ok(dR.ok, `draw ${i} failed: ${dR.error?.message}`);
    }

    // Liten ventetid for at event-loopen flusher broadcast-emits.
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.ok(g3Wins.length >= 1, "forventer g3:pattern:auto-won etter Coverall");
    const winPayload = g3Wins[0] as {
      roomCode: string;
      patternName: string;
      winnerPlayerIds: string[];
      prizePerWinner: number;
      drawIndex: number;
    };
    assert.equal(winPayload.roomCode, roomCode);
    assert.equal(winPayload.patternName, "Coverall");
    assert.equal(winPayload.drawIndex, 9, "Coverall lander på trekning 9");
    // pool = 2 × 100 entryFee = 200. Coverall default = 80% of pool = 160 kr.
    // To vinnere deler → round(160 / 2) = 80 kr hver.
    assert.equal(winPayload.winnerPlayerIds.length, 2, "to vinnere deler Coverall");
    assert.equal(winPayload.prizePerWinner, 80);

    // `g3:pattern:changed` fyrer minst én gang gjennom runden.
    assert.ok(g3Changes.length >= 1, "forventer g3:pattern:changed underveis");
  });

  test("non-G3-rom (gameSlug=bingo) emitter IKKE g3:pattern:* events", async () => {
    // For dette testet trenger vi en separat server med G1-slug + adapter.
    await server.close();
    server = await createTestServer({ useGame3Engine: true });

    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test", gameSlug: "bingo" },
    );
    assert.ok(r1.ok && r1.data);
    const roomCode = r1.data.roomCode;
    await bob.emit<AckResponse>("room:create", { hallId: "hall-test", gameSlug: "bingo" });

    await alice.emit<AckResponse>("bet:arm", { roomCode, armed: true });
    await bob.emit<AckResponse>("bet:arm", { roomCode, armed: true });

    const g3Emits: unknown[] = [];
    alice.socket.on("g3:pattern:auto-won", (p) => g3Emits.push(p));
    alice.socket.on("g3:pattern:changed", (p) => g3Emits.push(p));

    await alice.emit<AckResponse>("game:start", { roomCode, entryFee: 10, ticketsPerPlayer: 1 });
    for (let i = 0; i < 5; i += 1) {
      await alice.emit<AckResponse>("draw:next", { roomCode });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(g3Emits.length, 0, "G1-runde må ikke lekke g3:* events");
  });
});

describe("Game3 integration — Coverall avslutter runden", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await createTestServer({
      useGame3Engine: true,
      bingoAdapter: new EarlyWinTicketAdapter(),
      drawBagFactory: sequentialDrawBag,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  test("Coverall lander → runde ENDED med G3_FULL_HOUSE", async () => {
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test", gameSlug: "monsterbingo" },
    );
    assert.ok(r1.ok && r1.data);
    const roomCode = r1.data.roomCode;
    await bob.emit<AckResponse>("room:create", { hallId: "hall-test", gameSlug: "monsterbingo" });

    server.roomState.setVariantConfig(roomCode, {
      gameType: "monsterbingo",
      config: DEFAULT_GAME3_CONFIG,
    });

    await alice.emit<AckResponse>("bet:arm", { roomCode, armed: true });
    await bob.emit<AckResponse>("bet:arm", { roomCode, armed: true });

    const allWins: Array<{ patternName: string; drawIndex: number }> = [];
    alice.socket.on("g3:pattern:auto-won", (p) => allWins.push(p as { patternName: string; drawIndex: number }));

    await alice.emit<AckResponse>("game:start", { roomCode, entryFee: 100, ticketsPerPlayer: 1 });
    // Trekk opp til 21 — Coverall lander på trekning 9 og engine ender runden.
    for (let i = 0; i < 21; i += 1) {
      const r = await alice.emit<AckResponse<{ number: number }>>("draw:next", { roomCode });
      if (!r.ok) break;  // Engine kan auto-ende runden før draw 21 fullfører.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    const coverallWin = allWins.find((w) => w.patternName === "Coverall");
    assert.ok(coverallWin, `Coverall auto-won ikke mottatt. Got: ${JSON.stringify(allWins.map((w) => w.patternName))}`);
    assert.equal(coverallWin.drawIndex, 9);

    const stateR = await alice.emit<AckResponse<{ snapshot: { currentGame: { status: string; endedReason?: string } } }>>(
      "room:state", { roomCode },
    );
    assert.ok(stateR.ok && stateR.data);
    assert.equal(stateR.data.snapshot.currentGame.status, "ENDED");
    assert.equal(stateR.data.snapshot.currentGame.endedReason, "G3_FULL_HOUSE");
  });
});
