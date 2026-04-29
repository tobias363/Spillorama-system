/**
 * Bølge K3 (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §2.1):
 *
 * Feature-coverage-test for `Game1DrawEngineService` (scheduled-engine).
 *
 * Når `assertSpill1NotAdHoc` quarantiner BingoEngine for Spill 2/3 +
 * test-haller, må scheduled-engine dekke ALLE feature-områder retail
 * Spill 1 trenger. Denne testen verifiserer at Game1DrawEngineService:
 *
 *   1. Eksponerer alle public-methods som retail-flyten trenger
 *      (startGame, drawNext, pauseGame, resumeGame, stopGame,
 *      assignRoomCode, getRoomCodeForScheduledGame).
 *   2. Aksepterer/wirer integration-portene som retail trenger:
 *      - Mini-game-trigger (setMiniGameOrchestrator)
 *      - Oddsen-engine (setOddsenEngine)
 *      - Daily jackpot state (setJackpotStateService)
 *      - Pot-service + wallet-adapter (setPotService + setWalletAdapter)
 *      - Physical ticket payout (setPhysicalTicketPayoutService)
 *      - Lucky-bonus (luckyBonusService + luckyNumberLookup)
 *      - Compliance ledger + prize-policy (constructor)
 *      - Admin/player broadcasters (setAdminBroadcaster + setPlayerBroadcaster)
 *   3. Aksepterer transferHall-relaterte queries (test-hall flag refresh
 *      via BingoEngine setRoomTestHall — verifisert ved at scheduled-engine
 *      kan late-bind BingoEngine via setBingoEngine).
 *
 * Hvordan testen sjekker:
 *   - typeof-sjekk på public-method-properties (struktur-stabilitet).
 *   - constructor med minimal stub-konfigurasjon — verifiserer at servicen
 *     kan konstrueres uten å kreve tilgang til alle features (de er port-
 *     baserte og opt-in).
 *
 * NB: dette er IKKE en integrasjonstest (det dekker
 * Game1DrawEngineService.test.ts + Game1DrawEngineService.luckyBonus.test.ts +
 * 8+ andre `.test.ts` i samme directory). Denne testens formål er å sikre
 * at K3 quarantine-vedtaket ikke etterlater retail Spill 1 uten en
 * scheduled-vei for kritiske features.
 *
 * Dekning til retail features dokumentert i audit §2.1 og §6 K3:
 *   ✓ Mini-game (trigger på Fullt Hus auto-claim) — setMiniGameOrchestrator
 *   ✓ Daily jackpot (akkumulering + utbetaling) — setJackpotStateService
 *   ✓ Lucky number bonus (Fullt Hus på lucky-ball) — luckyBonusService
 *   ✓ TransferHall (master-overføring 60s handshake) — Game1TransferHallService
 *     (separat service, IKKE inne i Game1DrawEngineService — testet i
 *     Game1TransferHallService.test.ts)
 *   ✓ Compliance ledger (per-hall STAKE/PRIZE binding) — complianceLedgerPort
 *   ✓ Per-hall payout-cap — prizePolicyPort
 *   ✓ Physical-ticket payout — setPhysicalTicketPayoutService
 *   ✓ Per-color/per-pattern config — gjennom Game1PayoutService (egen test)
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1DrawEngineService,
  type Game1DrawEngineServiceOptions,
} from "./Game1DrawEngineService.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";

// Minimal stub pool — ingen DB-kall i denne testen, bare konstruksjon.
// Hvis en test trigger noe SQL er det riktig — vi har full integrasjon i
// Game1DrawEngineService.test.ts og 8+ andre filer.
function createMinimalPool(): { query: () => Promise<{ rows: unknown[]; rowCount: number }> } {
  return {
    query: async () => ({ rows: [], rowCount: 0 }),
  };
}

function createMinimalAuditLogService(): AuditLogService {
  return new AuditLogService(new InMemoryAuditLogStore());
}

function createMinimalTicketPurchaseStub(): unknown {
  // Game1TicketPurchaseService krever pool/schema/audit-wiring; for denne
  // strukturtesten gir vi en minimal stub som bare har den public-formen
  // som constructor-en sjekker — ingen kall faktisk gjøres.
  return {};
}

// ── 1: konstruksjon med minimal config — ingen feature-port wired ──────────

test("K3: Game1DrawEngineService kan konstrueres med minimal config (alle features opt-in)", () => {
  const opts: Game1DrawEngineServiceOptions = {
    pool: createMinimalPool() as unknown as Game1DrawEngineServiceOptions["pool"],
    schema: "public",
    ticketPurchaseService:
      createMinimalTicketPurchaseStub() as unknown as Game1DrawEngineServiceOptions["ticketPurchaseService"],
    auditLogService: createMinimalAuditLogService(),
  };
  const svc = new Game1DrawEngineService(opts);
  assert.ok(svc instanceof Game1DrawEngineService);
});

// ── 2: alle public-methods retail Spill 1 trenger er eksponert ─────────────

test("K3: Game1DrawEngineService eksponerer alle retail public-methods", () => {
  const opts: Game1DrawEngineServiceOptions = {
    pool: createMinimalPool() as unknown as Game1DrawEngineServiceOptions["pool"],
    schema: "public",
    ticketPurchaseService:
      createMinimalTicketPurchaseStub() as unknown as Game1DrawEngineServiceOptions["ticketPurchaseService"],
    auditLogService: createMinimalAuditLogService(),
  };
  const svc = new Game1DrawEngineService(opts);

  // Hovedflyt-metoder
  assert.equal(typeof svc.startGame, "function", "startGame må eksistere");
  assert.equal(typeof svc.drawNext, "function", "drawNext må eksistere");
  assert.equal(typeof svc.pauseGame, "function", "pauseGame må eksistere");
  assert.equal(typeof svc.resumeGame, "function", "resumeGame må eksistere");
  assert.equal(typeof svc.stopGame, "function", "stopGame må eksistere");

  // Room-mapping
  assert.equal(
    typeof svc.assignRoomCode,
    "function",
    "assignRoomCode må eksistere (race-safe room-mapping)"
  );
  assert.equal(
    typeof svc.getRoomCodeForScheduledGame,
    "function",
    "getRoomCodeForScheduledGame må eksistere"
  );

  // Audit/historikk
  assert.equal(
    typeof svc.listDraws,
    "function",
    "listDraws må eksistere for replay/audit"
  );
});

// ── 3: late-binding setters for alle integration-porter ─────────────────────

test("K3: Game1DrawEngineService eksponerer late-binding setters for retail features", () => {
  const opts: Game1DrawEngineServiceOptions = {
    pool: createMinimalPool() as unknown as Game1DrawEngineServiceOptions["pool"],
    schema: "public",
    ticketPurchaseService:
      createMinimalTicketPurchaseStub() as unknown as Game1DrawEngineServiceOptions["ticketPurchaseService"],
    auditLogService: createMinimalAuditLogService(),
  };
  const svc = new Game1DrawEngineService(opts);

  // Mini-game (BIN-690 M1) — trigger ved Fullt Hus auto-claim.
  assert.equal(
    typeof svc.setMiniGameOrchestrator,
    "function",
    "setMiniGameOrchestrator må eksistere — uten denne har retail ingen mini-game-trigger"
  );

  // Oddsen (BIN-690 M5) — ATOMISK med draw inne i transaksjon.
  assert.equal(
    typeof svc.setOddsenEngine,
    "function",
    "setOddsenEngine må eksistere — Oddsen-resolve er atomic med draw"
  );

  // Daily jackpot (MASTER_PLAN §2.3) — akkumulering + utbetaling.
  assert.equal(
    typeof svc.setJackpotStateService,
    "function",
    "setJackpotStateService må eksistere — daglig jackpot-state"
  );

  // Pot-service + wallet (PR-T2/T3) — pot-credit-flyten krever begge.
  assert.equal(
    typeof svc.setPotService,
    "function",
    "setPotService må eksistere"
  );
  assert.equal(
    typeof svc.setPotDailyTickService,
    "function",
    "setPotDailyTickService må eksistere"
  );
  assert.equal(
    typeof svc.setWalletAdapter,
    "function",
    "setWalletAdapter må eksistere — pot-credit krever wallet"
  );

  // Physical ticket payout (PT4) — fysisk-bong-vinnere.
  assert.equal(
    typeof svc.setPhysicalTicketPayoutService,
    "function",
    "setPhysicalTicketPayoutService må eksistere — fysisk-bong krever egen service"
  );

  // BingoEngine ref (PR-C1b) — sirkulær wiring + room-cleanup.
  assert.equal(
    typeof svc.setBingoEngine,
    "function",
    "setBingoEngine må eksistere — uten denne ingen room-cleanup ved game-completion"
  );

  // Broadcasters (BIN-690) — admin-namespace + player-namespace.
  assert.equal(
    typeof svc.setAdminBroadcaster,
    "function",
    "setAdminBroadcaster må eksistere"
  );
  assert.equal(
    typeof svc.setPlayerBroadcaster,
    "function",
    "setPlayerBroadcaster må eksistere"
  );
});

// ── 4: opt-in lucky-bonus + compliance + prize-policy via constructor ──────

test("K3: Game1DrawEngineService aksepterer lucky-bonus + compliance ledger + prize-policy via constructor", () => {
  const opts: Game1DrawEngineServiceOptions = {
    pool: createMinimalPool() as unknown as Game1DrawEngineServiceOptions["pool"],
    schema: "public",
    ticketPurchaseService:
      createMinimalTicketPurchaseStub() as unknown as Game1DrawEngineServiceOptions["ticketPurchaseService"],
    auditLogService: createMinimalAuditLogService(),
    // Disse er port-baserte — vi trenger ikke faktiske implementasjoner
    // for strukturtesten, men constructor må akseptere dem.
    luckyBonusService: undefined,
    luckyNumberLookup: undefined,
    complianceLedgerPort: undefined,
    prizePolicyPort: undefined,
  };
  const svc = new Game1DrawEngineService(opts);
  assert.ok(svc instanceof Game1DrawEngineService);
});

// ── 5: fail-closed — potService krever walletAdapter ───────────────────────
//
// PR-T3 Spor 4: hvis potService er wired ved konstruksjon men walletAdapter
// ikke er, så kaster constructor INVALID_CONFIG. Dette er retail-relevant
// fordi pot-credit må ha wallet for å fungere — fail-closed forhindrer at
// vi havner i en delvis-konfigurert state.

test("K3: Game1DrawEngineService fail-closed når potService konstrueres uten walletAdapter", () => {
  const opts: Game1DrawEngineServiceOptions = {
    pool: createMinimalPool() as unknown as Game1DrawEngineServiceOptions["pool"],
    schema: "public",
    ticketPurchaseService:
      createMinimalTicketPurchaseStub() as unknown as Game1DrawEngineServiceOptions["ticketPurchaseService"],
    auditLogService: createMinimalAuditLogService(),
    potService: {} as unknown as Game1DrawEngineServiceOptions["potService"], // satt
    // walletAdapter UTELATT
  };
  assert.throws(
    () => new Game1DrawEngineService(opts),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      // DomainError extends Error
      assert.match(
        (err as Error).message,
        /walletAdapter|INVALID_CONFIG/i,
        "Skal kaste fordi pot-credit krever wallet"
      );
      return true;
    }
  );
});

// ── 6: schema-input valideres ──────────────────────────────────────────────

test("K3: Game1DrawEngineService rejekter ugyldig schema-input", () => {
  const opts: Game1DrawEngineServiceOptions = {
    pool: createMinimalPool() as unknown as Game1DrawEngineServiceOptions["pool"],
    schema: "drop table; --", // SQL-injection
    ticketPurchaseService:
      createMinimalTicketPurchaseStub() as unknown as Game1DrawEngineServiceOptions["ticketPurchaseService"],
    auditLogService: createMinimalAuditLogService(),
  };
  assert.throws(() => new Game1DrawEngineService(opts), {
    message: /schema/i,
  });
});
