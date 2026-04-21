/**
 * Audit-funn #8 hull 1: Reconnect under aktiv fase.
 *
 * Scenario: Spiller kobler fra ETTER fase 1 er vunnet, kobler til igjen
 * midt i fase 2 (før den lukker). Reconnect-snapshot skal:
 *
 *   1. Inneholde `patternResults[0].isWon=true` — slik at klienten kan
 *      rendre "fase 1 vunnet"-UI uten å trigge ny popup-animasjon.
 *   2. Inneholde spiller-spesifikk `winnerIds` hvis spilleren var en
 *      av vinnerne på fase 1, så premie-historikk er konsistent.
 *   3. Inneholde alle `drawnNumbers` som har blitt trukket så langt
 *      (både de før og etter spilleren koblet fra).
 *   4. Bevare spillerens egne `marks` satt FØR frakobling.
 *   5. Ha `currentGame.status === "RUNNING"` — spillet fortsetter.
 *
 * Kontrakten er viktig for at reconnecting-spillere ikke ser animert
 * fase-1-popup som et "nytt" event midt i fase 2 — det er regulatorisk
 * uønsket siden pengespill-loggingen må være konsistent.
 */
import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import { createTestServer, type TestServer } from "./testServer.js";
import type { RoomSnapshot } from "../../game/types.js";

interface AckResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

describe("Socket: reconnect mid-phase (hull 1)", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  test("reconnect etter fase 1 vunnet: snapshot har patternResults[0].isWon=true + winnerIds bevart", async () => {
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

    // Både Alice og Bob har identiske brett (FixedTicketBingoAdapter) →
    // begge vinner fase 1 på samme ball.
    await alice.emit<AckResponse>("game:start", {
      roomCode, entryFee: 500, ticketsPerPlayer: 1,
    });

    // Trekk 5 baller → rad 0 komplett → fase 1 vunnet av begge.
    for (let i = 0; i < 5; i += 1) {
      await alice.emit<AckResponse>("draw:next", { roomCode });
    }

    const snapBefore = server.engine.getRoomSnapshot(roomCode);
    const phase1Before = snapBefore.currentGame?.patternResults?.find(
      (r) => r.patternName === "1 Rad",
    );
    assert.equal(phase1Before?.isWon, true, "fase 1 vunnet før Bob disconnecter");
    assert.equal(phase1Before?.winnerIds?.length, 2, "2 vinnere (Alice + Bob)");
    const drawCountBefore = snapBefore.currentGame?.drawnNumbers.length ?? 0;
    assert.equal(drawCountBefore, 5);

    // Bob kobler fra mid-phase-2.
    bob.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    // Alice trekker en ball til mens Bob er borte (nå i fase 2).
    const drawWhileAway = await alice.emit<AckResponse<{ number: number }>>(
      "draw:next", { roomCode },
    );
    assert.ok(drawWhileAway.ok);

    // Bob kobler til igjen.
    const bob2 = await server.connectClient("token-bob");
    const rejoin = await bob2.emit<AckResponse<{
      roomCode: string;
      snapshot: RoomSnapshot;
    }>>("room:create", { hallId: "hall-test" });
    assert.ok(rejoin.ok, `rejoin failed: ${rejoin.error?.message}`);

    // ── Invariant 1: patternResults[0].isWon=true ─────────────────────
    const snapAfter = rejoin.data!.snapshot;
    const phase1After = snapAfter.currentGame?.patternResults?.find(
      (r) => r.patternName === "1 Rad",
    );
    assert.equal(
      phase1After?.isWon, true,
      "reconnect-snapshot skal fortsatt vise fase 1 som vunnet",
    );

    // ── Invariant 2: winnerIds bevart ─────────────────────────────────
    assert.equal(
      phase1After?.winnerIds?.length, 2,
      "begge vinnere skal fortsatt stå i winnerIds på snapshot",
    );

    // ── Invariant 3: alle drawnNumbers inkludert (5 før + 1 under borte = 6) ─
    assert.equal(
      snapAfter.currentGame?.drawnNumbers.length, 6,
      "snapshot har alle 6 trukkede baller — også de trukket mens Bob var borte",
    );

    // ── Invariant 5: spillet fortsetter, fase 2 ikke vunnet ennå ──────
    assert.equal(snapAfter.currentGame?.status, "RUNNING");
    const phase2After = snapAfter.currentGame?.patternResults?.find(
      (r) => r.patternName === "2 Rader",
    );
    assert.equal(phase2After?.isWon, false, "fase 2 er fortsatt aktiv");
  });

  test("reconnect bevarer egne marks satt før disconnect", async () => {
    // Kontrakt: ticket:mark sender marks til serveren, og disse skal
    // overleve en reconnect.
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
      roomCode, entryFee: 10, ticketsPerPlayer: 1,
    });

    // Trekk 3 baller. Alice merker de 2 første.
    const drawnByAlice: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await alice.emit<AckResponse<{ number: number }>>(
        "draw:next", { roomCode },
      );
      drawnByAlice.push(res.data!.number);
    }
    await alice.emit<AckResponse>("ticket:mark", { roomCode, number: drawnByAlice[0] });
    await alice.emit<AckResponse>("ticket:mark", { roomCode, number: drawnByAlice[1] });
    // La drawnByAlice[2] være umerket.

    // Alice kobler fra + til igjen.
    alice.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    const alice2 = await server.connectClient("token-alice");
    const rejoin = await alice2.emit<AckResponse<{
      roomCode: string;
      playerId: string;
      snapshot: RoomSnapshot;
    }>>("room:create", { hallId: "hall-test" });
    assert.ok(rejoin.ok);

    // Alice's marks bevart — for å lese marks må vi gå til engine direkte
    // (snapshot eksponerer ikke marks per spiller).
    const aliceId = rejoin.data!.playerId;
    const engineSnap = server.engine.getRoomSnapshot(roomCode);
    const aliceMarks = engineSnap.currentGame?.marks?.[aliceId];
    assert.ok(aliceMarks, "Alice skal ha marks-entries etter reconnect");
    assert.equal(aliceMarks!.length, 1, "én billett → én marks-set");
    const markedNumbers = new Set(aliceMarks![0]);

    // De 2 numrene Alice merket skal fortsatt være der.
    assert.ok(
      markedNumbers.has(drawnByAlice[0]),
      `markering av ${drawnByAlice[0]} bevart etter reconnect`,
    );
    assert.ok(
      markedNumbers.has(drawnByAlice[1]),
      `markering av ${drawnByAlice[1]} bevart etter reconnect`,
    );
    // Det tredje (umerkede) skal IKKE være der.
    assert.equal(
      markedNumbers.has(drawnByAlice[2]), false,
      `ikke-merket ball ${drawnByAlice[2]} skal ikke være i marks`,
    );
  });

  test("reconnect trigger IKKE ny pattern:won event for historisk vunnet fase", async () => {
    // Regresjonstest: når klienten henter snapshot ved reconnect, skal
    // serveren ikke emit en ny `pattern:won`-event for fase som allerede
    // er registrert vunnet. `pattern:won` emittes kun i `draw:next`-
    // handleren for NYE overganger (wonBefore → wonAfter).
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

    // Lukk fase 1.
    for (let i = 0; i < 5; i += 1) {
      await alice.emit<AckResponse>("draw:next", { roomCode });
    }

    // Bob kobler fra og til igjen.
    bob.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    const bob2 = await server.connectClient("token-bob");

    // Lytt etter pattern:won — ingen forventet under og like etter reconnect
    // (kun ved fremtidig NY fase-overgang).
    const patternEvents: Array<{ patternName: string }> = [];
    bob2.socket.on("pattern:won", (p: { patternName: string }) => patternEvents.push(p));

    await bob2.emit<AckResponse>("room:create", { hallId: "hall-test" });
    await new Promise((r) => setTimeout(r, 200)); // la rommet settle

    assert.equal(
      patternEvents.length, 0,
      `ingen historiske pattern:won events skal replay-es ved reconnect, fikk ${patternEvents.length}: ${patternEvents.map((e) => e.patternName).join(", ")}`,
    );

    bob2.socket.off("pattern:won");
  });
});
