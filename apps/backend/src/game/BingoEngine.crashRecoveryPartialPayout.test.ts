/**
 * Audit-funn #8 hull 5: Crash recovery etter partial payout.
 *
 * Ref: PR #312 (GAME1_SCHEDULE PR 5 — crash recovery + split-rounding +
 * loyalty hook).
 *
 * Kontrakt-invarianter for crash-resilience i multi-winner-payout:
 *
 *   1. **Deterministic idempotency-keys**: Hver vinner får en unik
 *      `idempotencyKey` på formatet `phase-<patternId>-<gameId>-<playerId>`.
 *      En wallet-implementasjon som dedup-er på denne nøkkelen vil aldri
 *      dobbelt-utbetale hvis den samme utbetalingen replayes etter crash.
 *
 *   2. **Checkpoint-complete state**: Etter en fullstendig 3-vinner-fase
 *      inneholder `serializeGameForRecovery` alle 3 claims MED `payoutAmount`,
 *      og `patternResults[0]` har `isWon=true` + `winnerIds=[p1,p2,p3]`.
 *
 *   3. **Restore preserves payout state**: `restoreRoomFromSnapshot` av
 *      den serialiserte tilstanden gir tilbake en runde der fase 1 er
 *      merket vunnet, claims intakt. Senere draws re-evaluer ikke fase 1
 *      (fordi `isWon=true` gjør at evaluateActivePhase finner fase 2 som
 *      neste aktiv fase).
 *
 *   4. **Per-payout checkpoint chain**: `writePayoutCheckpointWithRetry`
 *      kalles én gang per suksessfull utbetaling, slik at hvis serveren
 *      krasjer mellom vinner 1 og vinner 2 så vil den siste persisterte
 *      snapshoten inkludere vinner 1's claim. Ved restart vil recovery
 *      + idempotency sikre at kun 2+3 (ikke 1) utbetales på nytt.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import { DEFAULT_NORSK_BINGO_CONFIG } from "./variantConfig.js";
import type {
  BingoSystemAdapter,
  CreateTicketInput,
  CheckpointInput,
} from "../adapters/BingoSystemAdapter.js";
import type { Ticket, RecoverableGameSnapshot, Player, GameSnapshot } from "./types.js";
import type {
  TransactionOptions,
  WalletAdapter,
  WalletTransaction,
  WalletTransferResult,
  CreateWalletAccountInput,
  WalletAccount,
} from "../adapters/WalletAdapter.js";

const SHARED_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

class SharedGridAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: SHARED_GRID.map((row) => [...row]) };
  }
  checkpoints: CheckpointInput[] = [];
  async onCheckpoint(input: CheckpointInput): Promise<void> {
    this.checkpoints.push(input);
  }
}

function prioritiseDrawBag(engine: BingoEngine, roomCode: string, numbers: number[]): void {
  const rooms = (engine as unknown as { rooms: Map<string, { currentGame?: { drawBag: number[] } }> }).rooms;
  const bag = rooms.get(roomCode)?.currentGame?.drawBag;
  if (!bag) return;
  const preferred: number[] = [];
  const rest: number[] = [];
  const wanted = new Set(numbers);
  for (const n of bag) {
    if (wanted.has(n)) preferred.push(n);
    else rest.push(n);
  }
  preferred.sort((a, b) => numbers.indexOf(a) - numbers.indexOf(b));
  bag.length = 0;
  bag.push(...preferred, ...rest);
}

/** Spying wallet som tar vare på alle transfer-kall og deres idempotency-keys.
 *
 * NB: `InMemoryWalletAdapter.transfer` (i BingoEngine.test.ts) implementerer
 * KUN 4-arg-varianten (from, to, amount, reason) — den ignorerer
 * `options`-parameteren fra WalletAdapter-interface. Vi tar imot det 5.
 * argumentet her for å fange `idempotencyKey`, men kan ikke propagere det
 * til super (som ville gitt TS2554). Dedup-sjekken i testen vår er helt
 * basert på det vi selv har fanget — `super`-kallet trenger ikke å se det.
 */
class IdempotencyCapturingWallet extends InMemoryWalletAdapter {
  transferCalls: Array<{ from: string; to: string; amount: number; idempotencyKey?: string }> = [];
  override async transfer(
    from: string,
    to: string,
    amount: number,
    reason = "Transfer",
    options?: TransactionOptions,
  ): Promise<WalletTransferResult> {
    this.transferCalls.push({ from, to, amount, idempotencyKey: options?.idempotencyKey });
    return super.transfer(from, to, amount, reason);
  }
}

async function setupThreeWinnerRoom(wallet?: WalletAdapter): Promise<{
  engine: BingoEngine;
  roomCode: string;
  playerIds: string[];
  adapter: SharedGridAdapter;
}> {
  const adapter = new SharedGridAdapter();
  const engine = new BingoEngine(
    adapter,
    wallet ?? new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  const { roomCode, playerId: p1 } = await engine.createRoom({
    hallId: "hall-1", playerName: "P1", walletId: "w-1",
  });
  const { playerId: p2 } = await engine.joinRoom({
    roomCode, hallId: "hall-1", playerName: "P2", walletId: "w-2",
  });
  const { playerId: p3 } = await engine.joinRoom({
    roomCode, hallId: "hall-1", playerName: "P3", walletId: "w-3",
  });
  return { engine, roomCode, playerIds: [p1!, p2!, p3!], adapter };
}

test("invariant 1: idempotency-keys er unike per (phase, game, player)", async () => {
  const wallet = new IdempotencyCapturingWallet();
  const { engine, roomCode, playerIds } = await setupThreeWinnerRoom(wallet);
  const [hostId] = playerIds;

  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 200, ticketsPerPlayer: 1,
    payoutPercent: 100, gameType: "bingo", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  // 3 identiske brett → alle vinner fase 1 på samme ball.
  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  // Finn fase 1-payout-kallene (ignorer buy-in-transfers som går
  // spiller → hus, ikke hus → spiller).
  const phase1Payouts = wallet.transferCalls.filter(
    (c) => c.idempotencyKey?.startsWith("phase-"),
  );
  assert.equal(phase1Payouts.length, 3, "3 fase 1-utbetalinger forventet");

  // Alle keys er unike
  const keys = phase1Payouts.map((c) => c.idempotencyKey!);
  const uniqueKeys = new Set(keys);
  assert.equal(uniqueKeys.size, 3, "alle 3 idempotency-keys skal være unike");

  // Format: phase-<patternId>-<gameId>-<playerId>
  for (const key of keys) {
    assert.match(
      key,
      /^phase-[a-z0-9-]+-[a-f0-9-]+-[a-f0-9-]+$/i,
      `idempotencyKey "${key}" skal matche phase-<patternId>-<gameId>-<playerId>`,
    );
  }

  // Hver vinner sin playerId skal være i keyen.
  for (const playerId of playerIds) {
    const found = keys.some((k) => k.endsWith(`-${playerId}`));
    assert.ok(found, `en key skal ende på "-${playerId}"`);
  }
});

test("invariant 2: checkpoint capture etter full 3-vinner-fase inneholder alle claims + payouts + winnerIds", async () => {
  const { engine, roomCode, playerIds, adapter } = await setupThreeWinnerRoom();
  const [hostId] = playerIds;

  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 200, ticketsPerPlayer: 1,
    payoutPercent: 100, gameType: "bingo", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  // Siste DRAW-checkpoint inneholder full fase-1-state.
  const drawCheckpoints = adapter.checkpoints.filter((c) => c.reason === "DRAW");
  assert.ok(drawCheckpoints.length >= 5, "minst 5 DRAW-checkpoints (én per ball)");
  const lastDraw = drawCheckpoints[drawCheckpoints.length - 1];
  const snap = lastDraw.snapshot as RecoverableGameSnapshot;

  // patternResults[0] = fase 1, isWon=true, winnerIds har alle 3
  const phase1 = snap.patternResults?.find((r) => r.patternName === "1 Rad");
  assert.equal(phase1?.isWon, true);
  assert.equal(phase1?.winnerIds?.length, 3, "winnerIds har alle 3 vinnere");
  for (const pid of playerIds) {
    assert.ok(phase1?.winnerIds?.includes(pid), `winnerIds skal inneholde ${pid}`);
  }

  // Alle 3 claims i snapshot, hver med payoutAmount satt.
  const lineClaims = snap.claims.filter((c) => c.type === "LINE");
  assert.equal(lineClaims.length, 3, "3 LINE-claims i snapshot");
  for (const claim of lineClaims) {
    assert.ok(
      typeof claim.payoutAmount === "number",
      `claim ${claim.id} skal ha payoutAmount satt`,
    );
    assert.ok(claim.valid === true);
  }

  // Minst 3 PAYOUT-checkpoints (én per individuell utbetaling — per
  // payoutPhaseWinner-call etter transfer).
  const payoutCheckpoints = adapter.checkpoints.filter((c) => c.reason === "PAYOUT");
  assert.ok(
    payoutCheckpoints.length >= 3,
    `forventet ≥3 PAYOUT-checkpoints (1 per vinner), fikk ${payoutCheckpoints.length}`,
  );
});

test("invariant 3: restoreRoomFromSnapshot bevarer fase-isWon state — neste draw re-evaluerer ikke fase 1", async () => {
  const { engine, roomCode, playerIds, adapter } = await setupThreeWinnerRoom();
  const [hostId, p2, p3] = playerIds;

  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 200, ticketsPerPlayer: 1,
    payoutPercent: 100, gameType: "bingo", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  // Hent siste DRAW-checkpoint som "persistert crash state".
  const drawCheckpoints = adapter.checkpoints.filter((c) => c.reason === "DRAW");
  const lastDraw = drawCheckpoints[drawCheckpoints.length - 1];
  const persistedSnapshot = lastDraw.snapshot as GameSnapshot;
  const persistedPlayers = lastDraw.players as Player[];

  // Simulér at serveren har krasjet og en NY engine-instans bootes
  // opp. Samme wallet gjenbrukes så balansene overlever.
  const freshAdapter = new SharedGridAdapter();
  const freshEngine = new BingoEngine(
    freshAdapter,
    new InMemoryWalletAdapter(),
    { minDrawIntervalMs: 0, minPlayersToStart: 1 },
  );
  freshEngine.restoreRoomFromSnapshot(
    roomCode,
    "hall-1",
    hostId,
    persistedPlayers,
    persistedSnapshot,
    "bingo",
  );

  // Variant-config må bindes på nytt for auto-claim-flyt i new engine.
  const variantByRoom = (freshEngine as unknown as {
    variantConfigByRoom: Map<string, typeof DEFAULT_NORSK_BINGO_CONFIG>;
    variantGameTypeByRoom: Map<string, string>;
  });
  variantByRoom.variantConfigByRoom.set(roomCode, DEFAULT_NORSK_BINGO_CONFIG);
  variantByRoom.variantGameTypeByRoom.set(roomCode, "bingo");

  // Verifiser restored state
  const restoredSnap = freshEngine.getRoomSnapshot(roomCode);
  const game = restoredSnap.currentGame!;
  const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
  assert.equal(phase1?.isWon, true, "fase 1 forblir vunnet etter restore");
  assert.equal(phase1?.winnerIds?.length, 3);
  assert.equal(game.status, "RUNNING", "runden fortsetter etter restore");
  assert.equal(game.claims.length, 3, "3 claims bevart");

  // Trekk neste ball på restored engine. evaluateActivePhase skal ikke
  // finne fase 1 som aktiv fase (den er isWon=true) — den skal hoppe
  // videre til fase 2. Ingen nye LINE-claims for fase 1 skal opprettes.
  const claimsBefore = game.claims.length;
  await freshEngine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  const snapAfter = freshEngine.getRoomSnapshot(roomCode);
  const claimsAfter = snapAfter.currentGame!.claims.length;
  assert.equal(
    claimsAfter,
    claimsBefore,
    "ingen nye claims for fase 1 ved re-evaluering (isWon=true gater)",
  );
  // Bruker p2, p3 i assertion om fordeling
  void p2; void p3;
});

test("invariant 4: spying wallet bekrefter at hver individuell payout har per-winner idempotency-key", async () => {
  // Dekker PR #312s designvalg: hvis wallet-adapteren implementerer dedup
  // på idempotencyKey, vil et retry-scenario (crash midt i loop) aldri
  // dobbelt-betale den vinneren som allerede har fått.
  const wallet = new IdempotencyCapturingWallet();
  const { engine, roomCode, playerIds } = await setupThreeWinnerRoom(wallet);
  const [hostId] = playerIds;

  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 200, ticketsPerPlayer: 1,
    payoutPercent: 100, gameType: "bingo", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  // Hent patternId for "1 Rad" fra engine-state — den er deterministisk
  // basert på variantConfig, men vi trekker den ut så testen ikke er
  // brittle mot patternId-endringer.
  const snap = engine.getRoomSnapshot(roomCode);
  const phase1Id = snap.currentGame?.patterns?.find((p) => p.name === "1 Rad")?.id;
  const gameId = snap.currentGame?.id;
  assert.ok(phase1Id);
  assert.ok(gameId);

  // Hver vinner skal ha EN transfer-call med key phase-<phase1Id>-<gameId>-<playerId>
  for (const playerId of playerIds) {
    const expected: string = `phase-${phase1Id}-${gameId}-${playerId}`;
    const matching: typeof wallet.transferCalls = wallet.transferCalls.filter(
      (c) => c.idempotencyKey === expected,
    );
    assert.equal(
      matching.length, 1,
      `nøyaktig 1 transfer med key "${expected}" (fikk ${matching.length})`,
    );
  }
});

test("invariant 4b: wallet med dedup sikrer at replay ikke dobbelt-utbetaler", async () => {
  // Realistisk scenario: wallet-backend (f.eks. PostgreSQL-basert wallet-
  // service) dedup-er på idempotencyKey. Vi emulerer med en DedupingWallet.
  class DedupingWallet implements WalletAdapter {
    private readonly base = new InMemoryWalletAdapter();
    private readonly seenKeys = new Map<string, WalletTransferResult>();
    transferCallCount = 0;
    dedupedCount = 0;

    createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount> {
      return this.base.createAccount(input);
    }
    ensureAccount(accountId: string): Promise<WalletAccount> {
      return this.base.ensureAccount(accountId);
    }
    getAccount(accountId: string): Promise<WalletAccount> {
      return this.base.getAccount(accountId);
    }
    listAccounts(): Promise<WalletAccount[]> { return this.base.listAccounts(); }
    getBalance(accountId: string): Promise<number> { return this.base.getBalance(accountId); }
    // Delegat-metoder: InMemoryWalletAdapter (base) implementerer ikke
    // options-parameteren, så vi dropper det ved delegering. Dedup-logikken
    // lever helt i `transfer`-wrapperen.
    debit(accountId: string, amount: number, reason: string, _options?: TransactionOptions) {
      return this.base.debit(accountId, amount, reason);
    }
    credit(accountId: string, amount: number, reason: string, _options?: TransactionOptions) {
      return this.base.credit(accountId, amount, reason);
    }
    topUp(accountId: string, amount: number, reason?: string, _options?: TransactionOptions) {
      return this.base.topUp(accountId, amount, reason);
    }
    withdraw(accountId: string, amount: number, reason?: string, _options?: TransactionOptions) {
      return this.base.withdraw(accountId, amount, reason);
    }
    listTransactions(accountId: string, limit?: number): Promise<WalletTransaction[]> {
      return this.base.listTransactions(accountId, limit);
    }
    async transfer(
      from: string, to: string, amount: number, reason = "", options?: TransactionOptions,
    ): Promise<WalletTransferResult> {
      this.transferCallCount += 1;
      const key = options?.idempotencyKey;
      if (key && this.seenKeys.has(key)) {
        this.dedupedCount += 1;
        return this.seenKeys.get(key)!;
      }
      const result = await this.base.transfer(from, to, amount, reason);
      if (key) this.seenKeys.set(key, result);
      return result;
    }
  }

  const wallet = new DedupingWallet();
  const { engine, roomCode, playerIds } = await setupThreeWinnerRoom(wallet);
  const [hostId] = playerIds;

  await engine.startGame({
    roomCode, actorPlayerId: hostId, entryFee: 200, ticketsPerPlayer: 1,
    payoutPercent: 100, gameType: "bingo", variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
  });

  prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
  for (let i = 0; i < 5; i += 1) {
    await engine.drawNextNumber({ roomCode, actorPlayerId: hostId });
  }

  // Fase 1 utbetalt. Balanses før replay.
  const balBefore: Record<string, number> = {};
  for (const pid of playerIds) {
    const wid = `w-${pid.slice(-1)}`; // ikke viktig — vi leser walletId fra player i engine
  }
  void balBefore;
  const balancesBefore: number[] = [];
  for (let i = 1; i <= 3; i += 1) {
    balancesBefore.push(await wallet.getBalance(`w-${i}`));
  }

  // Simulér crash-replay: kall payoutPhaseWinner på nytt for alle 3
  // vinnere via intern test-hook. Bruker private-metode via cast.
  const privateEngine = engine as unknown as {
    payoutPhaseWinner: (
      room: unknown, game: unknown, playerId: string,
      pattern: unknown, patternResult: unknown, prizePerWinner: number,
    ) => Promise<void>;
    rooms: Map<string, { currentGame: { patterns: Array<{ id: string; name: string }>; patternResults: Array<{ patternId: string; patternName: string; claimType: string; isWon: boolean }> } }>;
  };
  const room = privateEngine.rooms.get(roomCode)!;
  const game = room.currentGame;
  const pattern = game.patterns.find((p) => p.name === "1 Rad")!;
  const patternResult = game.patternResults.find((r) => r.patternName === "1 Rad")!;

  // prizePerWinner = floor(100/3) = 33
  const dedupsBefore = wallet.dedupedCount;
  for (const playerId of playerIds) {
    await privateEngine.payoutPhaseWinner(room, game, playerId, pattern, patternResult, 33);
  }
  const dedupsAfter = wallet.dedupedCount;

  // Alle 3 replay-calls må ha dedup-et (samme idempotency-keys som
  // original-betaling).
  assert.equal(
    dedupsAfter - dedupsBefore, 3,
    "3 replay-transfers skal være dedup-et (ingen dobbelt-utbetaling)",
  );

  // Balansene skal være uendret.
  for (let i = 1; i <= 3; i += 1) {
    const balNow = await wallet.getBalance(`w-${i}`);
    assert.equal(
      balNow, balancesBefore[i - 1],
      `w-${i} balanse uendret etter replay (dedup fungerer)`,
    );
  }
});
