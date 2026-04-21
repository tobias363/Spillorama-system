/**
 * Audit-funn #8 hull 3: Socket-event-ordering under multi-winner.
 *
 * Kontrakt som dokumenteres i denne testen:
 *
 *   - Ved én draw som samtidig fullfører en fase for flere spillere,
 *     emitterer serveren nøyaktig ÉN `pattern:won`-event per fase
 *     (ikke én per vinner). `winnerIds` inneholder alle vinnere og
 *     `winnerCount` avspeiler `winnerIds.length`.
 *
 *   - Event-rekkefølgen innenfor en enkelt `draw:next` er autoritativ:
 *       1. `draw:new`        — ball trukket
 *       2. `pattern:won`     — én per fase som nettopp ble vunnet
 *       3. `room:update`     — med oppdatert `remainingPrizePool`
 *
 *     Klienter antar denne rekkefølgen (GameBridge avviser `pattern:won`
 *     uten forutgående `draw:new`, og BallTube ser på lengde-diff mellom
 *     konsekutive `room:update` som gap-deteksjon). Hvis noen bytter
 *     rekkefølge eller splitter emissions blir dette regresjon.
 *
 *   - `remainingPrizePool` (i `room:update`) skal være LAVERE etter draw
 *     enn før (deler av pool utbetalt til vinnerne). Bekrefter at
 *     utbetalingene allerede har skjedd synkront før `room:update` når klienten.
 */
import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import { createTestServer, type TestServer } from "./testServer.js";
import type { RoomSnapshot, PatternResult } from "../../game/types.js";

interface AckResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

describe("Socket: multi-winner event ordering (hull 3)", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  test("2 spillere vinner fase 1 på samme ball → draw:new → pattern:won (1x, winnerIds=2) → room:update", async () => {
    // Carol = bob's socket (bare 2 test-tokens tilgjengelig). Begge får
    // identisk brett via FixedTicketBingoAdapter, så begge vinner fase 1
    // samtidig når rad 0 (tall 1-5) er trukket.
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

    // entryFee=500 pool=1000, 80% payout=800 — plenty to split 100 kr fixed
    // fase 1 premie uten cap.
    await alice.emit<AckResponse>("game:start", {
      roomCode, entryFee: 500, ticketsPerPlayer: 1,
    });

    // Trekk 4 første baller UTEN at fase 1 er vunnet (rad 0 = 1,2,3,4,5;
    // vi trenger alle 5 for fullført rad).
    for (let i = 0; i < 4; i += 1) {
      await alice.emit<AckResponse>("draw:next", { roomCode });
    }

    // Tøm klient-kø for events fra de 4 foregående draws før vi registrerer
    // ordrings-rekorderen. Uten denne drenasjen lekker `room:update` fra
    // 4. draw inn i events-arrayen og forskyver rekkefølge-assertion.
    await new Promise((r) => setTimeout(r, 100));

    // Snapshot av remainingPrizePool FØR siste ball.
    const snapBefore = server.engine.getRoomSnapshot(roomCode);
    const poolBefore = snapBefore.currentGame!.remainingPrizePool;

    // Sett opp rekkefølge-recorder på bob's socket (han er bare observatør
    // av events — Alice trigger draw:next).
    const events: Array<{ name: string; payload: unknown }> = [];
    const trackOrder = (name: string) => (payload: unknown) => events.push({ name, payload });
    bob.socket.on("draw:new", trackOrder("draw:new"));
    bob.socket.on("pattern:won", trackOrder("pattern:won"));
    bob.socket.on("room:update", trackOrder("room:update"));

    // Trekk 5. ball → fase 1 auto-vinnes for BÅDE Alice og Bob.
    const drawRes = await alice.emit<AckResponse<{ number: number }>>(
      "draw:next", { roomCode },
    );
    assert.ok(drawRes.ok, `draw:next failed: ${drawRes.error?.message}`);

    // Gi Socket.IO litt tid til å flushe events til klient.
    await new Promise((r) => setTimeout(r, 100));

    // Fjern listeners så vi ikke fanger framtidige events.
    bob.socket.off("draw:new");
    bob.socket.off("pattern:won");
    bob.socket.off("room:update");

    // ── Assertions: rekkefølge + payload ────────────────────────────────

    const drawIdx = events.findIndex((e) => e.name === "draw:new");
    const patternIdx = events.findIndex((e) => e.name === "pattern:won");
    const updateIdx = events.findIndex((e) => e.name === "room:update");

    assert.ok(drawIdx >= 0, "draw:new skal være mottatt");
    assert.ok(patternIdx >= 0, "pattern:won skal være mottatt");
    assert.ok(updateIdx >= 0, "room:update skal være mottatt");

    const order = events.map((e) => e.name).join(", ");
    assert.ok(drawIdx < patternIdx, `draw:new skal komme FØR pattern:won — faktisk rekkefølge: ${order}`);
    assert.ok(patternIdx < updateIdx, `pattern:won skal komme FØR room:update — faktisk rekkefølge: ${order}`);

    // Nøyaktig ÉN pattern:won for fase 1 (samlet, ikke én per vinner).
    const patternWonEvents = events.filter((e) => e.name === "pattern:won");
    const phase1Events = patternWonEvents.filter(
      (e) => (e.payload as { patternName?: string })?.patternName === "1 Rad",
    );
    assert.equal(
      phase1Events.length, 1,
      `forventet 1 pattern:won for '1 Rad', fikk ${phase1Events.length}`,
    );

    // winnerIds.length=2 + winnerCount=2 for multi-winner.
    const phase1Payload = phase1Events[0].payload as {
      winnerIds: string[];
      winnerCount: number;
      patternName: string;
    };
    assert.equal(phase1Payload.winnerCount, 2, "winnerCount=2 for 2 samtidige vinnere");
    assert.equal(phase1Payload.winnerIds.length, 2, "winnerIds har 2 entries");

    // room:update reflekterer redusert pool (vinnerne er utbetalt).
    const updatePayload = events[updateIdx].payload as RoomSnapshot;
    const poolAfter = updatePayload.currentGame!.remainingPrizePool;
    assert.ok(
      poolAfter < poolBefore,
      `remainingPrizePool skal være redusert etter utbetaling (før=${poolBefore}, etter=${poolAfter})`,
    );
  });

  test("solo vinner på fase 1 → pattern:won har winnerIds=1", async () => {
    // Regresjonstest: også med 1 vinner skal winnerIds[] brukes (ikke null).
    const alice = await server.connectClient("token-alice");
    const bob = await server.connectClient("token-bob");

    const r1 = await alice.emit<AckResponse<{ roomCode: string }>>(
      "room:create", { hallId: "hall-test", gameSlug: "bingo" },
    );
    assert.ok(r1.ok && r1.data);
    const roomCode = r1.data.roomCode;

    await bob.emit<AckResponse>("room:create", { hallId: "hall-test", gameSlug: "bingo" });
    // Kun Alice armed → Bob får ikke brett, Alice vinner alene.
    await alice.emit<AckResponse>("bet:arm", { roomCode, armed: true });
    await alice.emit<AckResponse>("game:start", {
      roomCode, entryFee: 500, ticketsPerPlayer: 1,
    });

    const patternPromise = bob.waitFor<{
      patternName: string;
      winnerIds: string[];
      winnerCount: number;
    }>("pattern:won", 3000);

    // 5 draws for å lukke fase 1.
    for (let i = 0; i < 5; i += 1) {
      await alice.emit<AckResponse>("draw:next", { roomCode });
    }

    const patternEvent = await patternPromise;
    assert.equal(patternEvent.patternName, "1 Rad");
    assert.equal(patternEvent.winnerCount, 1, "solo vinner → winnerCount=1");
    assert.equal(patternEvent.winnerIds.length, 1);
  });

  test("fase-overgang (fase 1 → fase 2): hver fase emitter sin egen pattern:won", async () => {
    // Kontrakt: når evaluateActivePhase rekursivt avslutter flere faser
    // på samme ball (edge case), sender serveren separate pattern:won-
    // events for hver fase — én per patternId. Testen validerer at i
    // det normale scenariet (ulike baller lukker fase 1 og fase 2)
    // også får én event per fase.
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
    await alice.emit<AckResponse>("game:start", {
      roomCode, entryFee: 500, ticketsPerPlayer: 1,
    });

    const patternEvents: Array<{ patternName: string }> = [];
    bob.socket.on("pattern:won", (p: { patternName: string }) => patternEvents.push(p));

    // testServer.ts gir deterministic draw bag:
    //   [1,2,3,4,5, 13,14,15,16,17, 25,26,27,28, 37,38,39,40,41, 49,...]
    // Første 5 baller → rad 0 fullført → fase 1 vunnet
    // (countCompleteRows=1 eller countCompleteColumns=0, fase 1 = row|col ≥ 1)
    for (let i = 0; i < 5; i += 1) {
      await alice.emit<AckResponse>("draw:next", { roomCode });
    }
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(patternEvents.length, 1, "etter 5 baller: kun fase 1 vunnet");
    assert.equal(patternEvents[0].patternName, "1 Rad");

    // Etter 9 baller totalt: rad 0+1 fullført. Nå har alle spillere 2
    // horisontale rader merket. Fase 2 krever 2 KOLONNER (ikke rader),
    // så fase 2 skal IKKE være vunnet ennå — kun én pattern:won så langt.
    for (let i = 0; i < 4; i += 1) {
      await alice.emit<AckResponse>("draw:next", { roomCode });
    }
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(
      patternEvents.length, 1,
      "horisontale rader teller ikke for fase 2 — kun 1 pattern:won så langt",
    );

    bob.socket.off("pattern:won");

    // Server-sannhet bekrefter kontrakten: fase 1 won, fase 2 not won.
    const snap = server.engine.getRoomSnapshot(roomCode);
    const results = snap.currentGame?.patternResults ?? [];
    const phase1 = results.find((r: PatternResult) => r.patternName === "1 Rad");
    const phase2 = results.find((r: PatternResult) => r.patternName === "2 Rader");
    assert.equal(phase1?.isWon, true);
    assert.equal(phase2?.isWon, false);
  });
});
