/**
 * PILOT-EMERGENCY 2026-04-28 — Demo Hall payout regression-vakt.
 *
 * Tobias-rapport (2026-04-28): "Det er også bugs på testbrukeren. ingen
 * gevinster blir gitt". Test player spiller Spill 1 i Demo Hall
 * (`isTestHall=true`), runden går (Demo Hall bypass = fortsetter til alle
 * baller), men wallet.winnings krediteres ikke for vinnende patterns.
 *
 * Hypoteser undersøkt (alle ikke reproduserbare i unit-test):
 *   1. PR #677 Demo Hall bypass slipper payout — INGEN BUG: bypass-blokken i
 *      BingoEnginePatternEval.evaluateActivePhase ligger ETTER payout-loopen
 *      (linje 406-410), så payoutPhaseWinner kalles uansett. Bypass hopper
 *      kun over end-of-round / pause, ikke wallet.transfer.
 *   2. PR #674 idempotency-key collision — INGEN BUG: PR #674 endret KUN
 *      bet:arm idempotency-key, ikke payout-key. adhocPhase-keyen inneholder
 *      gameId som er unik per runde, så ingen kollisjon mellom runder.
 *   3. PR #682 boot-sweep — INGEN BUG: boot-sweep kjører kun ved server-
 *      start, ikke under spill. Destroy-er kun non-canonical IDLE/ENDED rom.
 *   4. actor_hall_id null blokkerer payout — INGEN BUG: relevant kun for
 *      compliance-ledger audit, ikke wallet.transfer.
 *   5. Wallet outbox-worker ikke kjører — IKKE relevant: outbox dispatcher
 *      er for socket-broadcasts, wallet-transfer skjer inline.
 *   6. REST vs Socket-path divergens — UNDERSØKT: begge code-paths bruker
 *      payoutPhaseWinner (auto-claim) eller submitClaim (manuell). Begge
 *      kaller wallet.transfer med korrekt targetSide:winnings.
 *
 * KONKLUSJON: ad-hoc BingoEngine + DEFAULT_NORSK_BINGO_CONFIG fungerer
 * korrekt for Demo Hall. Disse to testene fanger en eventuell fremtidig
 * regresjon i payout-flyten ved Demo Hall.
 *
 * Hvis Tobias rapporterer dette igjen i prod og testene passerer fortsatt,
 * må bug-en være i:
 *   - PostgresWalletAdapter (vi bruker InMemory her)
 *   - GameManagement-config-binding (production kan binde annen config enn
 *     DEFAULT_NORSK_BINGO_CONFIG)
 *   - Frontend-display (faktisk credit OK men UI viser stale data)
 *   - Et helt annet code-path som test-bruker faktisk treffer
 *
 * Forensisk neste-skritt:
 *   1. Sjekk wallet_transactions-tabellen i prod for test-brukerens userId
 *      etter spill — eksisterer det TRANSFER_IN-rader med targetSide=winnings?
 *   2. Sjekk app_rg_compliance_ledger for PRIZE-events i samme runde.
 *   3. Sjekk om GameManagement har overstyrt config med percent-prizes
 *      (i så fall: pool=0 → totalPhasePrize=0 → payout=0 → ingen credit).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import { DEFAULT_NORSK_BINGO_CONFIG } from "./variantConfig.js";
import type {
  BingoSystemAdapter,
  CreateTicketInput,
} from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

const ALICE_GRID = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, 0, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

class FixedGridAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: ALICE_GRID.map((r) => [...r]) };
  }
}

function prioritiseDrawBag(
  engine: BingoEngine,
  roomCode: string,
  numbers: number[],
): void {
  const rooms = (
    engine as unknown as {
      rooms: Map<string, { currentGame?: { drawBag: number[] } }>;
    }
  ).rooms;
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

test(
  "demo-hall payout-vakt — Spill 1 + isTestHall=true: Phase 1 vinner skal få 100 kr på winnings",
  async () => {
    const wallet = new InMemoryWalletAdapter();
    const engine = new BingoEngine(new FixedGridAdapter(), wallet, {
      minDrawIntervalMs: 0,
      minPlayersToStart: 1,
    });
    const { roomCode, playerId: hostId } = await engine.createRoom({
      hallId: "hall-demo",
      playerName: "Alice",
      walletId: "w-alice",
      gameSlug: "bingo",
      isTestHall: true,
    });

    // Initial winnings should be 0
    const initialWinnings = await wallet.getWinningsBalance("w-alice");
    assert.equal(initialWinnings, 0, "initial winnings should be 0");

    // RTP-cap-bug-fix 2026-04-29: entryFee=200 → pool=200, budget=160 (80%)
    // → 1 Rad face=100 ≤ budget → fullt utbetalt. (Tidligere brukte testen
    // entryFee=10 som ga budget=8; med fixed-prize-bypass passerte den, men
    // post-RTP-cap-fix måtte vi øke buy-in for å demonstrere FULL payout.)
    // Default-balance er 1000 — entryFee 200 er innenfor.
    await engine.startGame({
      roomCode,
      actorPlayerId: hostId!,
      entryFee: 200,
      ticketsPerPlayer: 1,
      payoutPercent: 80,
      gameType: "standard",
      variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
    });

    // Trekk hele rad 0 → Phase 1 ("1 Rad") vunnet på ball 5.
    prioritiseDrawBag(engine, roomCode, [1, 16, 31, 46, 61]);
    for (let i = 0; i < 5; i += 1) {
      await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });
    }

    const game = engine.getRoomSnapshot(roomCode).currentGame!;
    const phase1 = game.patternResults?.find((r) => r.patternName === "1 Rad");
    assert.equal(phase1?.isWon, true, "Phase 1 må være markert vunnet");
    assert.equal(
      phase1?.winnerId,
      hostId,
      "Phase 1 winnerId må være host",
    );
    assert.equal(
      phase1?.payoutAmount,
      100,
      `Phase 1 payoutAmount må være 100 kr (DEFAULT_NORSK_BINGO_CONFIG fixed prize); faktisk: ${phase1?.payoutAmount}`,
    );

    // KEY ASSERTION: winnings-balance må være +100 kr etter Phase 1 vinn.
    // Demo Hall bypass i BingoEnginePatternEval skipper KUN end-of-round +
    // auto-pause for test-haller. payoutPhaseWinner kalles uansett (linje
    // 406-410 i BingoEnginePatternEval.ts). Hvis denne testen feiler, har
    // bypass-en utilsiktet sluppet å kalle payoutPhaseWinner eller wallet.
    const winningsAfterPhase1 = await wallet.getWinningsBalance("w-alice");
    assert.equal(
      winningsAfterPhase1,
      100,
      `Demo Hall: Phase 1 prize (100 kr) skal være kreditert til winnings-side. Faktisk: ${winningsAfterPhase1} kr`,
    );
  },
);

test(
  "demo-hall payout-vakt — Spill 1 + isTestHall=true: alle 5 faser vunnet → winnings = 1700 kr",
  async () => {
    const wallet = new InMemoryWalletAdapter();
    // RTP-cap-bug-fix 2026-04-29: høye loss-limits så test-spilleren ikke
    // blir filtrert ut av `wouldExceedLossLimit` ved entryFee=2200.
    // (Default 900/4400 ville ekskludert henne.)
    const engine = new BingoEngine(new FixedGridAdapter(), wallet, {
      minDrawIntervalMs: 0,
      minPlayersToStart: 1,
      dailyLossLimit: 100000,
      monthlyLossLimit: 100000,
    });
    const { roomCode, playerId: hostId } = await engine.createRoom({
      hallId: "hall-demo",
      playerName: "Alice",
      walletId: "w-alice",
      gameSlug: "bingo",
      isTestHall: true,
    });

    // RTP-cap-bug-fix 2026-04-29: top opp wallet før startGame så player
    // har råd til entryFee=2200 (default-balance 1000 ville filtrert ut
    // spilleren via `filterEligiblePlayers`-low-balance-sjekken).
    await wallet.topUp("w-alice", 5000, "test-topup-for-rtp-budget");

    // entryFee=2200 → pool=2200, budget=1760 (80%) → 1700 kr total fixed
    // prizes ≤ budget → alle utbetales fullt.
    await engine.startGame({
      roomCode,
      actorPlayerId: hostId!,
      entryFee: 2200,
      ticketsPerPlayer: 1,
      payoutPercent: 80,
      gameType: "standard",
      variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
    });

    // Trekk alle 24 ikke-nullceller → Fullt Hus oppnås men runden skal
    // fortsette pga test-hall-bypass.
    const allAlice: number[] = [];
    for (const row of ALICE_GRID) for (const n of row) if (n !== 0) allAlice.push(n);
    prioritiseDrawBag(engine, roomCode, allAlice);

    for (let i = 0; i < 24; i += 1) {
      await engine.drawNextNumber({ roomCode, actorPlayerId: hostId! });
    }

    const game = engine.getRoomSnapshot(roomCode).currentGame!;
    const wonPhaseCount = game.patternResults?.filter((r) => r.isWon).length ?? 0;
    assert.equal(wonPhaseCount, 5, "Alle 5 faser skal være vunnet");

    // Sum: 100 (1 Rad) + 200 (2 Rader) + 200 (3 Rader) + 200 (4 Rader) + 1000 (Fullt Hus) = 1700 kr
    const expectedTotalWinnings = 100 + 200 + 200 + 200 + 1000;
    const totalWinnings = await wallet.getWinningsBalance("w-alice");
    assert.equal(
      totalWinnings,
      expectedTotalWinnings,
      `Demo Hall: alle 5 fixed-prize-faser skal være kreditert til winnings. Forventet ${expectedTotalWinnings} kr, faktisk: ${totalWinnings} kr`,
    );
  },
);
