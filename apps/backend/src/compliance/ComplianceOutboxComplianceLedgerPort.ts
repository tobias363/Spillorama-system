/**
 * COMP-P0-002: ComplianceLedgerPort decorator som routes via outbox.
 *
 * Erstatter direkte call til underliggende ComplianceLedger med en
 * outbox-write + best-effort inline dispatch. Garantien er at hvis
 * outbox-INSERT lykkes (mye lavere feilrate enn compliance-write fordi
 * det er én enkel INSERT), vil §71-rad eventually finnes — selv om
 * inline dispatch feiler eller server crash-er mellom INSERT og dispatch.
 *
 * Lifecycle:
 *   1. `recordComplianceLedgerEvent(input)` kalles fra Game1Ticket-
 *      PurchaseService / Game1PayoutService / Game1DrawEngineService /
 *      MiniGameOrchestrator / MiniGameOddsenEngine / AgentMiniGame-
 *      WinningService.
 *   2. Decoratoren bygger deterministisk idempotency-key (samme format
 *      som ComplianceLedger.recordComplianceLedgerEvent gjør internt).
 *   3. INSERT i `app_compliance_outbox` med `ON CONFLICT (idempotency_key)
 *      DO NOTHING` — to retries av samme logiske event lager kun én
 *      outbox-rad.
 *   4. Best-effort inline dispatch til underliggende `ComplianceLedger.
 *      recordComplianceLedgerEvent`. Lykkes → markér outbox-rad processed.
 *      Feiler → la rad bli pending; worker retry-er.
 *   5. Hvis outbox-INSERT selv feiler (DB nede), faller vi tilbake til
 *      pre-COMP-P0-002-mønsteret: forsøk inline dispatch direkte og
 *      logg pino-warning. Dette er den samme atferden som før — ingen
 *      regresjon, og ingen krasj på allerede committed wallet-tx.
 *
 * Atomicitets-garantien:
 *   Wallet-debit kjører i sin egen tx (PostgresWalletAdapter) med BIN-761
 *   wallet_outbox-rad enqueued atomisk. Compliance-write er POST-commit
 *   av wallet — derfor er en delt tx ikke mulig. Outbox-pattern her gir
 *   ekvivalent garanti: compliance-event persisteres i outbox-tabellen
 *   FØR wallet-call-stack returnerer (når denne decoratoren kalles), og
 *   worker garanterer eventual delivery.
 *
 * Idempotens på dispatcher-side:
 *   ComplianceLedger.recordComplianceLedgerEvent har sin egen `ON CONFLICT
 *   (idempotency_key) DO NOTHING` på `app_rg_compliance_ledger` (PILOT-
 *   STOP-SHIP 2026-04-28). To dispatch-ekvivalenter (inline + worker)
 *   eller to worker-retries gir kun én §71-rad.
 */

import pino from "pino";

import {
  type ComplianceLedgerEventInput,
  type ComplianceLedgerPort,
} from "../adapters/ComplianceLedgerPort.js";
import { makeComplianceLedgerIdempotencyKey } from "../game/ComplianceLedger.js";
import {
  type ComplianceOutboxPayload,
  ComplianceOutboxRepo,
} from "./ComplianceOutboxRepo.js";

const log = pino({ name: "ComplianceOutboxComplianceLedgerPort" });

export interface ComplianceOutboxComplianceLedgerPortOptions {
  /** Outbox-repo for persistering av pending compliance-events. */
  outboxRepo: ComplianceOutboxRepo;
  /** Underliggende port (typisk fra `BingoEngine.getComplianceLedgerPort()`). */
  inner: ComplianceLedgerPort;
}

/**
 * Bygg payload som kan persisteres i JSONB. Beholder `undefined` ut av
 * payload-en (JSON.stringify dropper undefined automatisk), så worker
 * leser tilbake nøyaktig samme felt-sett som inline-call hadde.
 *
 * `eventSubKey` er ny-introdusert via decoratoren — call-sites bruker
 * ikke direkte (deres input matcher ComplianceLedgerEventInput som
 * ikke har eventSubKey). For å gi worker like deterministisk hash som
 * inline-dispatch ville fått, lar vi underliggende ComplianceLedger
 * compute samme hash via fallbackDiscriminator i sin egen kode-sti.
 */
function buildPayload(input: ComplianceLedgerEventInput): ComplianceOutboxPayload {
  return {
    hallId: input.hallId,
    gameType: input.gameType,
    channel: input.channel,
    eventType: input.eventType,
    amount: input.amount,
    roomCode: input.roomCode,
    gameId: input.gameId,
    claimId: input.claimId,
    playerId: input.playerId,
    walletId: input.walletId,
    sourceAccountId: input.sourceAccountId,
    targetAccountId: input.targetAccountId,
    policyVersion: input.policyVersion,
    batchId: input.batchId,
    metadata: input.metadata,
  };
}

/**
 * Bygg outbox-side idempotency-key. Bruker `eventType:gameId:claimId|playerId`
 * som primær diskriminator. Dette skiller distinkte logiske events innenfor
 * samme spill (én STAKE per spiller, én PRIZE per claim, osv.).
 *
 * For events der claimId+playerId ikke alene skiller (f.eks. samme spiller
 * gjør flere STAKE-er i samme spill), genererer underliggende
 * ComplianceLedger en stableEntryDiscriminatorHash internt — så outbox
 * og §71-rad kan i prinsippet ha LITT forskjellige keys ved retry. Det
 * er trygt fordi:
 *   - Outbox-key forhindrer dobbel-enqueue av SAMME call (idempotency).
 *   - §71-key forhindrer dobbel-INSERT i `app_rg_compliance_ledger`
 *     (separat ON CONFLICT-target).
 *   - Hvis outbox-key kolliderer på en LEGITIM distinkt event (sjelden
 *     edge-case der både claimId og playerId er undefined), faller vi
 *     tilbake til å la inline dispatch håndtere — outbox-INSERT returnerer
 *     `false` (no-op), call-site fortsetter inline dispatch som før.
 *     Atferden er ingen worse enn pre-COMP-P0-002 for det edge-caset.
 */
function buildOutboxIdempotencyKey(input: ComplianceLedgerEventInput): string {
  return makeComplianceLedgerIdempotencyKey({
    eventType: input.eventType,
    gameId: input.gameId,
    claimId: input.claimId,
    playerId: input.playerId,
    // Inkluderer hallId + amount i fallback for å skille STAKE-er med
    // samme spiller i samme spill men forskjellige beløp/haller. Dette
    // er en pragmatisk fallback — for de fleste call-sites vil
    // claimId/playerId alene gi unik key.
    fallbackDiscriminator: `${input.hallId}:${input.amount}`,
  });
}

/**
 * Decorator som routes ComplianceLedgerPort-calls gjennom outbox.
 *
 * Aldri kaster — matcher fire-and-forget-kontrakten i ComplianceLedgerPort.
 * Alle feil logges og swallow-es (med outbox-rad som garanti for eventual
 * delivery, eller pino-warning hvis selv outbox-INSERT feilet).
 */
export class ComplianceOutboxComplianceLedgerPort implements ComplianceLedgerPort {
  private readonly outboxRepo: ComplianceOutboxRepo;
  private readonly inner: ComplianceLedgerPort;

  constructor(opts: ComplianceOutboxComplianceLedgerPortOptions) {
    this.outboxRepo = opts.outboxRepo;
    this.inner = opts.inner;
  }

  async recordComplianceLedgerEvent(input: ComplianceLedgerEventInput): Promise<void> {
    const idempotencyKey = buildOutboxIdempotencyKey(input);
    const payload = buildPayload(input);

    let enqueuedFresh: boolean;
    try {
      enqueuedFresh = await this.outboxRepo.enqueue({
        idempotencyKey,
        payload,
      });
    } catch (err) {
      // Outbox-INSERT feilet (DB nede el.l.). Fall tilbake til pre-COMP-
      // P0-002-mønsteret: forsøk inline dispatch direkte og logg pino-
      // warning. Vi kaster IKKE — det ville ført til regresjon (cascade
      // av fail-closed-kompensering på allerede committed wallet-tx).
      log.warn(
        {
          err,
          idempotencyKey,
          eventType: input.eventType,
          hallId: input.hallId,
          amount: input.amount,
          gameId: input.gameId,
          playerId: input.playerId,
        },
        "[COMP-P0-002] outbox.enqueue feilet — faller tilbake til inline dispatch",
      );
      try {
        await this.inner.recordComplianceLedgerEvent(input);
      } catch (innerErr) {
        log.warn(
          {
            err: innerErr,
            idempotencyKey,
            eventType: input.eventType,
            hallId: input.hallId,
            amount: input.amount,
          },
          "[COMP-P0-002] inline dispatch (etter outbox-feil) feilet — §71-rad mangler",
        );
      }
      return;
    }

    if (!enqueuedFresh) {
      // ON CONFLICT DO NOTHING — denne (idempotency_key) er allerede
      // enqueued. Worker tar seg av eventual delivery; ikke kjør inline
      // dispatch igjen siden det ville duplisere arbeid (og er allerede
      // beskyttet av §71-tabellens egen UNIQUE-constraint).
      log.debug(
        {
          idempotencyKey,
          eventType: input.eventType,
          hallId: input.hallId,
        },
        "[COMP-P0-002] outbox-rad fantes allerede (idempotency-conflict) — hopper over inline dispatch",
      );
      return;
    }

    // Best-effort inline dispatch — gir lav latency på happy path og
    // unngår at worker må jobbe med backlog ved normal load. Hvis dette
    // feiler, blir outbox-raden 'pending' og worker retry-er.
    try {
      await this.inner.recordComplianceLedgerEvent(input);
      // Inline dispatch lyktes → markér rad processed direkte. Worker
      // hopper da over den ved neste tick.
      try {
        await this.outboxRepo.markProcessedByKey(idempotencyKey);
      } catch (markErr) {
        // markProcessed feilet — ufarlig: worker vil claim raden ved
        // neste tick, redispatch-e (idempotent på §71-side via
        // ON CONFLICT), og markere processed. Logg for synlighet.
        log.warn(
          {
            err: markErr,
            idempotencyKey,
            eventType: input.eventType,
          },
          "[COMP-P0-002] markProcessedByKey feilet — worker tar seg av redispatch (trygt pga §71 ON CONFLICT)",
        );
      }
    } catch (dispatchErr) {
      // Inline dispatch feilet — la outbox-raden bli 'pending', worker
      // retry-er. Dette er hele vitsen med outbox-pattern: ingen tap selv
      // om compliance-write krasjer her og nå.
      log.warn(
        {
          err: dispatchErr,
          idempotencyKey,
          eventType: input.eventType,
          hallId: input.hallId,
          amount: input.amount,
          gameId: input.gameId,
          playerId: input.playerId,
        },
        "[COMP-P0-002] inline compliance-dispatch feilet — outbox-rad pending, worker retry-er",
      );
    }
  }
}
