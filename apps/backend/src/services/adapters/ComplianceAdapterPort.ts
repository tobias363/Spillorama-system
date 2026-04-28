/**
 * Unified pipeline refactor — Fase 1 adapter (UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md §3.4).
 *
 * Wrapper som lar eksisterende `ComplianceLedgerPort` (legacy port fra K1-fix
 * + ResponsibleGamingPersistenceAdapter) brukes gjennom Fase 0
 * `CompliancePort`-kontrakten.
 *
 * Hva denne adapteren gjør:
 *   - `recordEvent`: videresender til underliggende
 *     `ComplianceLedgerPort.recordComplianceLedgerEvent`. Idempotency-key er
 *     ikke en del av legacy-portens kontrakt — den ligger i metadata på
 *     prod-DB-nivå (UNIQUE-constraint på `idempotency_key`-kolonnen). Vi
 *     legger keyen til i metadata-feltet for sporbarhet.
 *   - `isWalletAllowedForGameplay` + `wouldExceedLossLimit`: stub-er som
 *     returnerer "tillatt" i denne Fase 1-adapteren. Reell implementasjon
 *     leverer i en separat call-flow (`Game1TicketPurchaseService`-pre-check)
 *     som ikke går via PayoutService. Når GameOrchestrator bygger Fase 4 vil
 *     vi wire i `ComplianceManager.canPlay()` og `wouldExceedLossLimit()`
 *     direkte. For PayoutService er disse to metodene ikke i bruk siden
 *     payout aldri sjekker compliance-blokk (gevinster utbetales uansett).
 */

import type { ComplianceLedgerPort } from "../../adapters/ComplianceLedgerPort.js";
import type {
  ComplianceAllowResult,
  ComplianceEvent,
  CompliancePort,
  LossLimitCheckResult,
} from "../../ports/CompliancePort.js";
import { logger as rootLogger } from "../../util/logger.js";

const log = rootLogger.child({ module: "compliance-adapter-port" });

/**
 * Bridge fra Fase 0 `CompliancePort` til legacy `ComplianceLedgerPort`.
 *
 * Brukes når PayoutService skal kjøre mot prod-ComplianceLedger (via
 * `engine.getComplianceLedgerPort()` eller test-stubs som implementerer
 * legacy-porten).
 *
 * `idempotencyKey`-håndtering:
 *   Legacy `ComplianceLedgerPort.recordComplianceLedgerEvent` tar IKKE en
 *   eksplisitt key-parameter. Idempotensen håndheves på DB-nivå via
 *   `app_rg_compliance_ledger.idempotency_key` UNIQUE-constraint. Vi
 *   inkluderer keyen i metadata for traceability — DB-rad som allerede har
 *   samme key blir avvist av `ON CONFLICT DO NOTHING`.
 *
 *   Hvis call-stedet faktisk trenger key-deduplisering UTENOM DB
 *   (in-memory-test e.l.), bruker man `InMemoryCompliancePort` direkte —
 *   denne adapteren forutsetter at underliggende store har sin egen
 *   idempotency-mekanisme.
 */
export class ComplianceAdapterPort implements CompliancePort {
  constructor(private readonly legacyPort: ComplianceLedgerPort) {}

  async recordEvent(event: ComplianceEvent, idempotencyKey: string): Promise<void> {
    try {
      await this.legacyPort.recordComplianceLedgerEvent({
        hallId: event.hallId,
        gameType: event.gameType,
        channel: event.channel,
        eventType: event.eventType,
        amount: event.amount,
        roomCode: event.roomCode,
        gameId: event.gameId,
        claimId: event.claimId,
        playerId: event.playerId,
        walletId: event.walletId,
        sourceAccountId: event.sourceAccountId,
        targetAccountId: event.targetAccountId,
        policyVersion: event.policyVersion,
        batchId: event.batchId,
        metadata: {
          ...(event.metadata ?? {}),
          // Inkluder keyen i metadata slik at audit-leseren kan se den
          // selv om underliggende DB-rad er avvist via UNIQUE-constraint.
          unifiedPipelineIdempotencyKey: idempotencyKey,
        },
      });
    } catch (err) {
      // Soft-fail (matcher legacy-policy) — vi logger og lar PayoutService
      // selv velge om feilen skal kastes videre. PayoutService har egen
      // try/catch-soft-fail rundt denne adapteren.
      log.warn(
        { err, eventType: event.eventType, idempotencyKey },
        "[COMPLIANCE-ADAPTER-PORT] recordComplianceLedgerEvent feilet",
      );
      throw err;
    }
  }

  /**
   * Stub. PayoutService bruker IKKE denne metoden — payout er en credit-
   * operasjon som alltid skal kunne gjennomføres uavhengig av compliance-
   * blokk (regulatorisk: gevinster utbetales selv ved selvutestengelse).
   *
   * GameOrchestrator + ticketPurchase-flyten vil i Fase 4 wire en mer
   * komplett implementasjon mot `ComplianceManager.canPlay()`.
   */
  async isWalletAllowedForGameplay(
    _walletId: string,
    _hallId: string,
  ): Promise<ComplianceAllowResult> {
    return { allowed: true };
  }

  /**
   * Stub. Samme begrunnelse som `isWalletAllowedForGameplay`.
   */
  async wouldExceedLossLimit(
    _walletId: string,
    _hallId: string,
    _amountCents: number,
  ): Promise<LossLimitCheckResult> {
    return { wouldExceed: false };
  }
}
