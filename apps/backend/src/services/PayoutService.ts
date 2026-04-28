/**
 * Unified pipeline refactor — Fase 1 (UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md §3.5).
 *
 * Sentral atomisk payout-service som kombinerer:
 *   1. Wallet-credit (ÉN per vinner)
 *   2. Compliance-ledger PRIZE-event (ÉN per vinner)
 *   3. Compliance-ledger HOUSE_RETAINED-event (hvis split-rounding gir rest)
 *   4. Audit-log-event (én per phase, summarisert)
 *
 * Erstatter inline 3-step-mønsteret som ble duplisert i 12+ kall-sites
 * (Game1PayoutService, BingoEngine.payoutPhaseWinner, BingoEngineMiniGames,
 * Game2Engine, Game3Engine, MiniGameOddsenEngine, PotEvaluator,
 * Game1MiniGameOrchestrator, Game1DrawEngineService, AgentMiniGameWinningService).
 *
 * **Atomicity-kontrakt** (per design §3.5):
 *
 *   Hvis caller wrapper hele `payoutPhase`-kallet i en DB-transaksjon
 *   (typisk via `wallet.withTransaction(...)` eller `pool.transaction(...)`),
 *   så vil ALLE writes (wallet credits + ledger entries + audit) commit
 *   eller rollback sammen. PayoutService selv lager ingen ny transaksjon —
 *   den respekterer caller-tx eller kjører best-effort hvis ingen er åpen.
 *
 *   For feil-håndtering:
 *   - Wallet-credit-feil → kaster `PayoutWalletCreditError` (hard fail).
 *     Caller forventes å rolle tilbake hele tx.
 *   - Compliance-ledger-feil → soft-fail (logger pino-warn, fortsetter).
 *     Matcher eksisterende policy: regulatorisk audit må ALDRI blokkere
 *     payout. Re-kjør manuelt hvis nødvendig.
 *   - Audit-log-feil → soft-fail (fire-and-forget).
 *
 * **Idempotency-kontrakt** (per design §3.6):
 *
 *   Wallet- og compliance-skriving er idempotent på `idempotencyKey`.
 *   Re-kall med samme key skriver IKKE duplikater (UNIQUE-constraint på
 *   DB-nivå håndhever dette i prod; in-memory porten replikerer via Set).
 *   Audit-log er fire-and-forget — re-kall skriver flere rader (akseptert
 *   for audit-strøm).
 *
 * **Multi-winner split** (per design §3.5 + HIGH-6):
 *
 *   `splitPrize(totalCents, winnerCount)` → `{ perWinnerCents, houseRetained }`
 *   - perWinnerCents = floor(totalCents / winnerCount)
 *   - houseRetained = totalCents - winnerCount * perWinnerCents ∈ [0, winnerCount)
 *   - Sum av (winnerCount * perWinnerCents) + houseRetained = totalCents
 *
 *   Når `houseRetained > 0` skrives en HOUSE_RETAINED-entry til
 *   compliance-ledger med metadata (winnerHallIds, totalPrize, perWinner,
 *   houseRetained) for §71-rapport.
 *
 * **Multi-hall §71-binding** (per Code Review #3 og K1-fix):
 *
 *   Hver winner får en `hallId`-binding for compliance-entry — bindes til
 *   VINNERENS kjøpe-hall, IKKE master-hall. `actorHallId` er master-hall-id
 *   som inkluderes i metadata for sporbarhet, men selve PRIZE-entryens
 *   `hallId` er ALLTID `winner.hallId`.
 *
 *   HOUSE_RETAINED-bucket-binding: bindes pragmatisk til `winners[0].hallId`
 *   (matcher Game1PayoutService HIGH-6-policy). Metadata inkluderer alle
 *   vinner-hallene slik at auditor kan reverse-engineer ved behov.
 */

import type {
  AuditPort,
  CompliancePort,
  IdempotencyKeyPort,
  WalletPort,
} from "../ports/index.js";
import type { ComplianceEvent } from "../ports/CompliancePort.js";
import type {
  LedgerChannel,
  LedgerGameType,
} from "../game/ComplianceLedgerTypes.js";
import type { WalletAccountSide, WalletTransaction } from "../ports/WalletPort.js";
import { WalletError } from "../adapters/WalletAdapter.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "payout-service" });

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Én logisk vinner i en payout. Beløp regnes ut av PayoutService selv via
 * `splitPrize(totalCents, winners.length)` — caller passerer ikke prize
 * per vinner, kun totalpotten.
 */
export interface PayoutWinner {
  /** Wallet som skal krediteres. */
  walletId: string;
  /** Spiller-id (audit + compliance.playerId). */
  playerId: string;
  /**
   * Vinnerens kjøpe-hall (NB: IKKE master-hall for multi-hall-runder).
   * §71 krever per-hall PRIZE-binding.
   */
  hallId: string;
  /**
   * Stable per-(winner, phase)-discriminator brukt i idempotency-keys og
   * compliance.claimId. Typisk en rad-id fra phase_winners eller en stabil
   * hash av (gameId, phase, walletId).
   */
  claimId: string;
  /**
   * Valgfri ekstra prize på toppen av split-pottens andel (e.g. jackpot
   * Fullt Hus). Skrives som EXTRA_PRIZE-event hvis > 0. Regnes IKKE inn
   * i split-rounding — passes inn i kroner i compliance, øre i wallet.
   */
  extraPrizeCents?: number;
}

export interface PayoutPhaseInput {
  /** game-id (audit + ledger.gameId). */
  gameId: string;
  /** Stabil id for fasen — typisk `phase-${n}` eller `pattern-${id}`. */
  phaseId: string;
  /** Human-readable navn for audit ("1 Rad", "Fullt Hus", …). */
  phaseName: string;
  /** Vinnerne på denne fasen (kan være 1..N). */
  winners: PayoutWinner[];
  /** Totalpott i øre for hele fasen (før split). */
  totalPrizeCents: number;
  /**
   * Master-hall-id for runden. Brukes som `actorHallId` i metadata for
   * traceability. PRIZE-bindingen er ALLTID per winner.hallId, ikke denne.
   */
  actorHallId: string;
  /** room-code for audit/ledger. */
  roomCode?: string;
  /**
   * Er totalPrizeCents en `fixed` prize (regulatorisk truth — utbetales
   * uavhengig av pool-fyllingsgrad) eller `percent` (avhengig av pool)?
   * Settes som metadata i compliance-entry, brukes ikke for split-aritmetikk.
   */
  isFixedPrize: boolean;
  /** game-slug → ledger.gameType ("MAIN_GAME"|"DATABINGO"). */
  gameType: LedgerGameType;
  /** Ledger-channel ("HALL"|"INTERNET") — typisk basert på purchase-channel. */
  channel: LedgerChannel;
  /**
   * Targetside for wallet-credit. ALLTID "winnings" for game-engine-payout
   * (regulatorisk: §11 — payout fra game-engine MÅ til winnings-side).
   * Default = "winnings".
   */
  targetSide?: WalletAccountSide;
  /**
   * Reason-streng for wallet-tx + audit (e.g. "Spill 1 1 Rad — game abc123").
   * Default = `${phaseName} — game ${gameId}`.
   */
  reason?: string;
}

export interface PayoutWinnerRecord {
  walletId: string;
  playerId: string;
  hallId: string;
  claimId: string;
  prizeCents: number;
  extraPrizeCents: number;
  walletTxId: string | null;
}

export interface PayoutPhaseResult {
  gameId: string;
  phaseId: string;
  totalWinners: number;
  /** Per-vinner andel av split-pott (floor). */
  prizePerWinnerCents: number;
  /** Rest-øre retained for huset etter split. */
  houseRetainedCents: number;
  winnerRecords: PayoutWinnerRecord[];
}

/**
 * Hard fail: wallet-credit feilet for én eller flere vinnere. Caller
 * forventes å rolle tilbake DB-tx (hvis åpen) for at hele payout-en skal
 * være atomisk.
 */
export class PayoutWalletCreditError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly walletId?: string,
    public readonly claimId?: string,
  ) {
    super(message);
    this.name = "PayoutWalletCreditError";
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Floor-division med rest til hus. Eksportert separat for at
 * `multiWinnerSplitInvariant.test.ts` kan importere pure-funksjonen og
 * teste aritmetikken uten en full PayoutService-instans.
 *
 * Properties (verifisert i invariant-test):
 *   - perWinnerCents = floor(totalCents / winnerCount)
 *   - winnerCount * perWinnerCents ≤ totalCents
 *   - houseRetained ∈ [0, winnerCount)
 *   - winnerCount * perWinnerCents + houseRetained = totalCents (eksakt)
 */
export function splitPrize(
  totalCents: number,
  winnerCount: number,
): { perWinnerCents: number; houseRetainedCents: number } {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error(
      `totalCents må være ikke-negativt heltall, fikk ${totalCents}`,
    );
  }
  if (!Number.isInteger(winnerCount) || winnerCount < 1) {
    throw new Error(`winnerCount må være ≥ 1, fikk ${winnerCount}`);
  }
  const perWinnerCents = Math.floor(totalCents / winnerCount);
  const houseRetainedCents = totalCents - winnerCount * perWinnerCents;
  return { perWinnerCents, houseRetainedCents };
}

function centsToKroner(cents: number): number {
  return cents / 100;
}

// ── Service ─────────────────────────────────────────────────────────────────

/**
 * Sentral atomisk payout-service.
 *
 * Konstruktør tar 4 ports — alle er Fase 0-portene fra
 * `apps/backend/src/ports/`. Tester bruker InMemory-implementasjonene;
 * produksjon vil i Fase 2+ wire ekte adapter-wrappers (`WalletAdapterPort`
 * mfl.) som speilkopierer mot eksisterende `WalletAdapter`,
 * `ComplianceLedger`, `AuditLogService`.
 *
 * Bruk:
 * ```ts
 * const service = new PayoutService({
 *   wallet, compliance, audit, keys,
 * });
 * const result = await service.payoutPhase({
 *   gameId: "g1",
 *   phaseId: "phase-1",
 *   phaseName: "1 Rad",
 *   winners: [{ walletId: "w1", playerId: "p1", hallId: "hall-1", claimId: "c1" }],
 *   totalPrizeCents: 10_000,
 *   actorHallId: "hall-1",
 *   isFixedPrize: true,
 *   gameType: "MAIN_GAME",
 *   channel: "INTERNET",
 * });
 * ```
 */
export class PayoutService {
  constructor(
    private readonly deps: {
      wallet: WalletPort;
      compliance: CompliancePort;
      audit: AuditPort;
      keys: IdempotencyKeyPort;
    },
  ) {}

  /**
   * Atomisk phase-payout: split, wallet-credit, ledger PRIZE/EXTRA_PRIZE,
   * HOUSE_RETAINED, audit. Se klasse-doc for atomicity- og idempotency-
   * kontrakter.
   *
   * Throws:
   *   - `PayoutWalletCreditError` ved wallet-feil (hard fail).
   *   - Andre feil (compliance/audit) er soft-fail og logges som warning.
   */
  async payoutPhase(input: PayoutPhaseInput): Promise<PayoutPhaseResult> {
    validateInput(input);

    const { winners, totalPrizeCents } = input;
    const { perWinnerCents, houseRetainedCents } = splitPrize(
      totalPrizeCents,
      winners.length,
    );
    const targetSide: WalletAccountSide = input.targetSide ?? "winnings";
    const reason =
      input.reason ?? `${input.phaseName} — game ${input.gameId}`;

    // ── Step 1: wallet-credit per vinner (HARD FAIL) ─────────────────────
    //
    // Wallet-credit er den eneste write-en der vi MÅ kaste videre. Hvis
    // én credit feiler kan vi ikke fortsette med compliance/audit fordi
    // tilstanden ville blitt inkonsistent (compliance-entry uten matchende
    // wallet-tx). Caller forventes å wrappe payoutPhase i en outer tx slik
    // at feil ruller tilbake alle writes.
    const winnerRecords: PayoutWinnerRecord[] = [];

    for (const winner of winners) {
      const extra = Math.max(0, winner.extraPrizeCents ?? 0);
      const totalCreditCents = perWinnerCents + extra;
      let walletTxId: string | null = null;

      if (totalCreditCents > 0) {
        try {
          const tx = await this.deps.wallet.credit({
            walletId: winner.walletId,
            amountCents: totalCreditCents,
            reason,
            idempotencyKey: this.deps.keys.forPayout(
              input.gameId,
              input.phaseId,
              winner.claimId,
            ),
            targetSide,
          });
          walletTxId = tx.id;
        } catch (err) {
          log.error(
            {
              err,
              gameId: input.gameId,
              phaseId: input.phaseId,
              walletId: winner.walletId,
              claimId: winner.claimId,
              amountCents: totalCreditCents,
            },
            "[PAYOUT-SERVICE] wallet.credit feil — caller forventes å rolle tilbake tx",
          );
          if (err instanceof WalletError) {
            throw new PayoutWalletCreditError(
              `Wallet-credit feilet for vinner ${winner.claimId}: ${err.message} (code=${err.code})`,
              err,
              winner.walletId,
              winner.claimId,
            );
          }
          throw new PayoutWalletCreditError(
            `Wallet-credit feilet for vinner ${winner.claimId}: ${(err as Error).message ?? "ukjent"}`,
            err,
            winner.walletId,
            winner.claimId,
          );
        }
      }

      winnerRecords.push({
        walletId: winner.walletId,
        playerId: winner.playerId,
        hallId: winner.hallId,
        claimId: winner.claimId,
        prizeCents: perWinnerCents,
        extraPrizeCents: extra,
        walletTxId,
      });
    }

    // ── Step 2: compliance-ledger PRIZE per vinner (SOFT FAIL) ───────────
    //
    // Idempotency-key bindes til (PRIZE, gameId, claimId). UNIQUE-constraint
    // på `app_rg_compliance_ledger.idempotency_key` håndhever
    // dobbel-skriving-vakt på DB-nivå.
    for (const record of winnerRecords) {
      if (record.prizeCents > 0) {
        const event: ComplianceEvent = {
          hallId: record.hallId,
          gameType: input.gameType,
          channel: input.channel,
          eventType: "PRIZE",
          amount: centsToKroner(record.prizeCents),
          gameId: input.gameId,
          roomCode: input.roomCode,
          claimId: record.claimId,
          playerId: record.playerId,
          walletId: record.walletId,
          metadata: {
            reason: "PAYOUT_PHASE_PRIZE",
            phaseId: input.phaseId,
            phaseName: input.phaseName,
            winnerCount: winners.length,
            isFixedPrize: input.isFixedPrize,
            actorHallId: input.actorHallId,
          },
        };
        const key = this.deps.keys.forCompliance(
          "PRIZE",
          input.gameId,
          record.claimId,
          record.playerId,
        );
        try {
          await this.deps.compliance.recordEvent(event, key);
        } catch (err) {
          log.warn(
            {
              err,
              gameId: input.gameId,
              phaseId: input.phaseId,
              claimId: record.claimId,
              hallId: record.hallId,
              amountCents: record.prizeCents,
            },
            "[PAYOUT-SERVICE] compliance.recordEvent PRIZE feilet — soft-fail, payout fortsetter",
          );
        }
      }

      // EXTRA_PRIZE (jackpot, lucky bonus o.l.).
      if (record.extraPrizeCents > 0) {
        const event: ComplianceEvent = {
          hallId: record.hallId,
          gameType: input.gameType,
          channel: input.channel,
          eventType: "EXTRA_PRIZE",
          amount: centsToKroner(record.extraPrizeCents),
          gameId: input.gameId,
          roomCode: input.roomCode,
          claimId: record.claimId,
          playerId: record.playerId,
          walletId: record.walletId,
          metadata: {
            reason: "PAYOUT_PHASE_EXTRA_PRIZE",
            phaseId: input.phaseId,
            phaseName: input.phaseName,
            actorHallId: input.actorHallId,
          },
        };
        // Distinkt key for EXTRA_PRIZE så STAKE/PRIZE/EXTRA_PRIZE per (game,
        // claim) kan eksistere parallelt uten å kollidere.
        const key = this.deps.keys.forCompliance(
          "EXTRA_PRIZE",
          input.gameId,
          record.claimId,
          record.playerId,
        );
        try {
          await this.deps.compliance.recordEvent(event, key);
        } catch (err) {
          log.warn(
            {
              err,
              gameId: input.gameId,
              phaseId: input.phaseId,
              claimId: record.claimId,
              hallId: record.hallId,
              amountCents: record.extraPrizeCents,
            },
            "[PAYOUT-SERVICE] compliance.recordEvent EXTRA_PRIZE feilet — soft-fail",
          );
        }
      }
    }

    // ── Step 3: HOUSE_RETAINED hvis split gir rest (SOFT FAIL) ───────────
    //
    // Bucket-binding til winners[0].hallId per HIGH-6-policy. Metadata
    // inkluderer alle vinner-hallene for §71-traceability.
    if (houseRetainedCents > 0) {
      const restHallId = winners[0]!.hallId;
      const winnerHallIds = Array.from(new Set(winners.map((w) => w.hallId)));
      const event: ComplianceEvent = {
        hallId: restHallId,
        gameType: input.gameType,
        channel: input.channel,
        eventType: "HOUSE_RETAINED",
        amount: centsToKroner(houseRetainedCents),
        gameId: input.gameId,
        roomCode: input.roomCode,
        metadata: {
          reason: "PAYOUT_SPLIT_ROUNDING_REST",
          phaseId: input.phaseId,
          phaseName: input.phaseName,
          winnerCount: winners.length,
          totalPrizeCents,
          perWinnerCents,
          houseRetainedCents,
          winnerHallIds,
          actorHallId: input.actorHallId,
        },
      };
      // Key inkluderer phaseId så ulike faser med samme gameId ikke kolliderer.
      const key = this.deps.keys.forCompliance(
        "HOUSE_RETAINED",
        input.gameId,
        input.phaseId,
        null,
      );
      try {
        await this.deps.compliance.recordEvent(event, key);
      } catch (err) {
        log.warn(
          {
            err,
            gameId: input.gameId,
            phaseId: input.phaseId,
            hallId: restHallId,
            amountCents: houseRetainedCents,
            winnerHallIds,
          },
          "[PAYOUT-SERVICE] compliance.recordEvent HOUSE_RETAINED feilet — soft-fail",
        );
      }
    }

    // ── Step 4: audit-log (FIRE-AND-FORGET) ──────────────────────────────
    //
    // Én summary-event per phase med winners + totaler. Ikke per vinner —
    // det ville generert volum uten verdi. Caller kan logge sine egne audit-
    // events for domain-spesifikke ting (e.g. assignmentId-mapping).
    try {
      await this.deps.audit.log({
        actorId: null,
        actorType: "SYSTEM",
        action: "game.payout.phase",
        resource: "game",
        resourceId: input.gameId,
        details: {
          phaseId: input.phaseId,
          phaseName: input.phaseName,
          winnerCount: winners.length,
          totalPrizeCents,
          perWinnerCents,
          houseRetainedCents,
          isFixedPrize: input.isFixedPrize,
          actorHallId: input.actorHallId,
          gameType: input.gameType,
          channel: input.channel,
          claimIds: winners.map((w) => w.claimId),
        },
      });
    } catch (err) {
      // AuditPort-kontrakten sier `log()` skal aldri kaste — defensive
      // catch for sikkerhets skyld.
      log.warn(
        { err, gameId: input.gameId, phaseId: input.phaseId },
        "[PAYOUT-SERVICE] audit.log feilet — fire-and-forget",
      );
    }

    return {
      gameId: input.gameId,
      phaseId: input.phaseId,
      totalWinners: winners.length,
      prizePerWinnerCents: perWinnerCents,
      houseRetainedCents,
      winnerRecords,
    };
  }
}

// ── Validation ──────────────────────────────────────────────────────────────

function validateInput(input: PayoutPhaseInput): void {
  if (!input.gameId?.trim()) {
    throw new Error("gameId er påkrevd.");
  }
  if (!input.phaseId?.trim()) {
    throw new Error("phaseId er påkrevd.");
  }
  if (!input.phaseName?.trim()) {
    throw new Error("phaseName er påkrevd.");
  }
  if (!input.actorHallId?.trim()) {
    throw new Error("actorHallId er påkrevd.");
  }
  if (!Array.isArray(input.winners) || input.winners.length === 0) {
    throw new Error("winners må være ikke-tom array.");
  }
  if (!Number.isInteger(input.totalPrizeCents) || input.totalPrizeCents < 0) {
    throw new Error(
      `totalPrizeCents må være ikke-negativt heltall, fikk ${input.totalPrizeCents}.`,
    );
  }
  for (const winner of input.winners) {
    if (!winner.walletId?.trim()) {
      throw new Error("Hver winner.walletId er påkrevd.");
    }
    if (!winner.playerId?.trim()) {
      throw new Error("Hver winner.playerId er påkrevd.");
    }
    if (!winner.hallId?.trim()) {
      throw new Error("Hver winner.hallId er påkrevd (§71 per-hall-binding).");
    }
    if (!winner.claimId?.trim()) {
      throw new Error("Hver winner.claimId er påkrevd (idempotency-discriminator).");
    }
    if (
      winner.extraPrizeCents !== undefined &&
      (!Number.isInteger(winner.extraPrizeCents) || winner.extraPrizeCents < 0)
    ) {
      throw new Error(
        `winner.extraPrizeCents må være ikke-negativt heltall, fikk ${winner.extraPrizeCents}.`,
      );
    }
  }
}

// Re-eksport av WalletTransaction-typen som tester ofte trenger.
export type { WalletTransaction };
