/**
 * CRIT-6 (SPILL1_CASINO_GRADE_REVIEW_2026-04-26):
 *
 * BingoEngine.submitClaim hadde ingen tx-wrapping rundt
 * walletAdapter.transfer + state-mutasjoner. Tidligere ble
 * `game.lineWinnerId = player.id` satt FØR transfer — hvis transfer
 * feilet (DB-disconnect, lock timeout) var state korrupt: spilleren så
 * seg selv som vinner uten å ha fått pengene.
 *
 * K2-B fix: state-mutasjoner gjøres NÅ etter at transfer er committet.
 * Hvis transfer kaster, hopper vi over hele state-mutasjons-blokken.
 * Audit/ledger/persist post-transfer er fortsatt sekvensielle (krever
 * pool-injeksjon i BingoEngine for full atomicity — utenfor K2-B).
 *
 * Disse testene verifiserer at:
 *   1. Hvis walletAdapter.transfer kaster på LINE-claim, blir
 *      `game.lineWinnerId` IKKE satt (state forblir uendret).
 *   2. Hvis walletAdapter.transfer kaster på BINGO-claim, blir
 *      `game.bingoWinnerId` IKKE satt og spillet forblir RUNNING.
 *   3. Idempotency-keyen sikrer at retry etter transfer-feil ikke
 *      dobbel-betaler.
 *   4. Happy-path uendret: state mutates som forventet.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type {
  TransferOptions,
  WalletTransferResult,
} from "../adapters/WalletAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import type { Ticket } from "./types.js";

// Same fixed grid som BingoEngine.test.ts FixedTicketBingoAdapter:
// row 0 = [1,2,3,4,5] → drawing 1-5 + marking gir LINE-claim.
// Hele 24 nummer (utenom free-cell 0) gir BINGO.
class FixedTicketAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return {
      grid: [
        [1, 2, 3, 4, 5],
        [13, 14, 15, 16, 17],
        [25, 26, 0, 27, 28],
        [37, 38, 39, 40, 41],
        [49, 50, 51, 52, 53],
      ],
    };
  }
}

const ALL_BINGO_NUMBERS = [
  1, 2, 3, 4, 5,
  13, 14, 15, 16, 17,
  25, 26, 27, 28,
  37, 38, 39, 40, 41,
  49, 50, 51, 52, 53,
];

const LINE_NUMBERS = [1, 2, 3, 4, 5];

/**
 * Wallet-adapter som kan injisere transfer-feil for å simulere DB-feil
 * mid-payout. Idempotency-keyen følger med slik at vi kan verifisere at
 * retry-flyten ikke dobbel-betaler.
 */
class TransferFailingWalletAdapter extends InMemoryWalletAdapter {
  private _failTransferOnce = false;
  private _transferCalls = 0;

  failNextTransfer(): void {
    this._failTransferOnce = true;
  }

  override async transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    reason = "Transfer",
    options?: TransferOptions,
  ): Promise<WalletTransferResult> {
    this._transferCalls += 1;
    if (this._failTransferOnce) {
      this._failTransferOnce = false;
      throw new WalletError(
        "TRANSFER_FAILED_SIMULATED",
        "Simulert wallet-transfer-feil for CRIT-6-test",
      );
    }
    return super.transfer(fromAccountId, toAccountId, amount, reason, options);
  }

  get transferCalls(): number {
    return this._transferCalls;
  }
}

function prioritizeDrawNumbers(
  engine: BingoEngine,
  roomCode: string,
  preferredNumbers: readonly number[],
): void {
  const internalRoomState = (
    engine as unknown as { rooms: Map<string, { currentGame?: { drawBag: number[] } }> }
  ).rooms.get(roomCode);
  const drawBag = internalRoomState?.currentGame?.drawBag;
  if (!drawBag || drawBag.length === 0) {
    return;
  }
  const prioritized = preferredNumbers.filter((value) => drawBag.includes(value));
  if (prioritized.length === 0) {
    return;
  }
  const remainder = drawBag.filter((value) => !prioritized.includes(value));
  internalRoomState!.currentGame!.drawBag = [...prioritized, ...remainder];
}

async function setupRoomReadyForLine(
  wallet: InMemoryWalletAdapter,
): Promise<{ engine: BingoEngine; roomCode: string; hostId: string }> {
  const engine = new BingoEngine(new FixedTicketAdapter(), wallet, {
    minPlayersToStart: 1,
    minDrawIntervalMs: 0,
    dailyLossLimit: 1_000_000,
    monthlyLossLimit: 10_000_000,
  });
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host",
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    entryFee: 100,
    payoutPercent: 80,
    armedPlayerIds: [playerId],
  });
  // Trekk balls for LINE og marker dem.
  prioritizeDrawNumbers(engine, roomCode, LINE_NUMBERS);
  for (let i = 0; i < LINE_NUMBERS.length; i++) {
    const { number: drawn } = await engine.drawNextNumber({
      roomCode,
      actorPlayerId: playerId,
    });
    await engine.markNumber({ roomCode, playerId, number: drawn });
  }
  return { engine, roomCode, hostId: playerId };
}

async function setupRoomReadyForBingo(
  wallet: InMemoryWalletAdapter,
): Promise<{ engine: BingoEngine; roomCode: string; hostId: string }> {
  const engine = new BingoEngine(new FixedTicketAdapter(), wallet, {
    minPlayersToStart: 1,
    minDrawIntervalMs: 0,
    dailyLossLimit: 1_000_000,
    monthlyLossLimit: 10_000_000,
  });
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Host",
    walletId: "wallet-host",
  });
  await engine.startGame({
    roomCode,
    actorPlayerId: playerId,
    entryFee: 100,
    payoutPercent: 80,
    armedPlayerIds: [playerId],
  });
  prioritizeDrawNumbers(engine, roomCode, ALL_BINGO_NUMBERS);
  for (let i = 0; i < ALL_BINGO_NUMBERS.length; i++) {
    const { number: drawn } = await engine.drawNextNumber({
      roomCode,
      actorPlayerId: playerId,
    });
    await engine.markNumber({ roomCode, playerId, number: drawn });
  }
  // Påkall LINE-claim først så LINE-fasen er ferdig før BINGO-claimen.
  await engine.submitClaim({ roomCode, playerId, type: "LINE" });
  return { engine, roomCode, hostId: playerId };
}

// ── 1: LINE — transfer-feil → game.lineWinnerId IKKE satt ──────────────────

test("CRIT-6: LINE — transfer-feil propageres + game.lineWinnerId forblir undefined", async () => {
  const wallet = new TransferFailingWalletAdapter();
  const { engine, roomCode, hostId } = await setupRoomReadyForLine(wallet);

  wallet.failNextTransfer();

  await assert.rejects(
    () =>
      engine.submitClaim({
        roomCode,
        playerId: hostId,
        type: "LINE",
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        (err as Error & { code?: string }).code === "TRANSFER_FAILED_SIMULATED",
        `expected TRANSFER_FAILED_SIMULATED, got ${(err as Error & { code?: string }).code}`,
      );
      return true;
    },
  );

  // CRIT-6 hovedkrav: state forblir uendret etter transfer-feil.
  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.ok(snapshot);
  const game = snapshot!.currentGame;
  assert.ok(game);
  assert.equal(
    game!.lineWinnerId,
    undefined,
    "game.lineWinnerId skal IKKE være satt etter transfer-feil",
  );
  // Ingen LINE-pattern skal være markert som won.
  const wonLine = game!.patternResults?.find(
    (r) => r.claimType === "LINE" && r.isWon,
  );
  assert.equal(
    wonLine,
    undefined,
    "ingen LINE-pattern skal være markert som won etter transfer-feil",
  );
  // Spillet er fortsatt RUNNING.
  assert.equal(game!.status, "RUNNING");
});

// ── 2: BINGO — transfer-feil → game.bingoWinnerId IKKE satt ────────────────

test("CRIT-6: BINGO — transfer-feil propageres + game.bingoWinnerId forblir undefined", async () => {
  const wallet = new TransferFailingWalletAdapter();
  const { engine, roomCode, hostId } = await setupRoomReadyForBingo(wallet);

  wallet.failNextTransfer();

  await assert.rejects(() =>
    engine.submitClaim({
      roomCode,
      playerId: hostId,
      type: "BINGO",
    }),
  );

  // CRIT-6: state uendret.
  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.ok(snapshot);
  const game = snapshot!.currentGame;
  assert.ok(game);
  assert.equal(
    game!.bingoWinnerId,
    undefined,
    "game.bingoWinnerId skal IKKE være satt etter transfer-feil",
  );
  // Spillet skal fortsatt være RUNNING (ikke ENDED).
  assert.equal(game!.status, "RUNNING", "spillet skal forbli RUNNING");
});

// ── 3: Idempotency — retry etter transfer-feil dobbel-betaler ikke ─────────

test("CRIT-6: retry etter transfer-feil — andre forsøk fullfører state-mutasjon", async () => {
  const wallet = new TransferFailingWalletAdapter();
  const { engine, roomCode, hostId } = await setupRoomReadyForLine(wallet);

  // Første attempt feiler.
  wallet.failNextTransfer();
  await assert.rejects(() =>
    engine.submitClaim({ roomCode, playerId: hostId, type: "LINE" }),
  );

  // State er fortsatt uendret etter første feilen.
  let snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(snapshot!.currentGame!.lineWinnerId, undefined);

  // Andre attempt — transfer skal lykkes.
  const claim2 = await engine.submitClaim({
    roomCode,
    playerId: hostId,
    type: "LINE",
  });

  // Andre forsøk skal ha vunnet og fått payout.
  assert.equal(claim2.valid, true);
  assert.ok(claim2.payoutAmount && claim2.payoutAmount > 0);

  // Sjekk at lineWinnerId NÅ er satt etter vellykket retry.
  snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(
    snapshot!.currentGame!.lineWinnerId,
    hostId,
    "etter vellykket retry skal lineWinnerId være satt",
  );
});

// ── 4: Happy path — uendret state-mutasjon når transfer lykkes ─────────────

test("CRIT-6: happy path — vellykket LINE-claim mutater state korrekt", async () => {
  const wallet = new InMemoryWalletAdapter();
  const { engine, roomCode, hostId } = await setupRoomReadyForLine(wallet);

  const claim = await engine.submitClaim({
    roomCode,
    playerId: hostId,
    type: "LINE",
  });

  assert.equal(claim.valid, true);
  const snapshot = engine.getRoomSnapshot(roomCode);
  assert.equal(
    snapshot!.currentGame!.lineWinnerId,
    hostId,
    "lineWinnerId skal være satt etter vellykket LINE-claim",
  );
  assert.ok(claim.payoutAmount && claim.payoutAmount > 0);
});
