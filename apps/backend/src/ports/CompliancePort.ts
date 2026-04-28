/**
 * Unified pipeline refactor — Fase 0 (UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md §3.4).
 *
 * Narrow port for compliance-ledger + spillvett-sjekker som game-pipelinen
 * trenger. Erstatter direkte avhengigheter på `ComplianceLedger`-klassen
 * og `ComplianceLedgerPort` (eldre adapter) med ÉN samlet kontrakt som
 * også eksponerer `isWalletAllowedForGameplay` og `wouldExceedLossLimit`.
 *
 * Bug-bakgrunn (PILOT-STOP-SHIP 2026-04-28):
 *   `recordComplianceLedgerEvent` ble kalt fra 12+ steder med samme
 *   idempotency-bug-mønster. UNIQUE-constraint på
 *   `app_rg_compliance_ledger.idempotency_key` (migrations/
 *   20260428080000_compliance_ledger_idempotency.sql) håndhever nå
 *   idempotensen på DB-nivå — porten kontraktuerer caller på å sende inn
 *   en deterministisk key og forventer `recordEvent` å være idempotent
 *   ved retry.
 *
 * Regulatorisk (pengespillforskriften):
 *   - §71-rapport: `recordEvent` MÅ skrive STAKE/PRIZE/EXTRA_PRIZE-events
 *     med `hallId` lik kjøpe-hallens id (ikke master-hall) for multi-hall.
 *   - §22 / §23: `isWalletAllowedForGameplay` må returnere `allowed: false`
 *     for self-excluded eller pause-aktive spillere.
 *   - §25: `wouldExceedLossLimit` brukes som pre-check før wallet-debit.
 */

import type {
  LedgerChannel,
  LedgerEventType,
  LedgerGameType,
} from "../game/ComplianceLedgerTypes.js";

/**
 * Subset av `ComplianceLedgerEntry` som callerne i game-pipelinen
 * faktisk fyller ut. Identisk med `ComplianceLedgerEventInput` i
 * adapter-laget — dupliseres her så Fase 0-koden ikke får bakoverlinje
 * mot adapter-typen (som kan endres i Fase 1+).
 */
export interface ComplianceEvent {
  hallId: string;
  gameType: LedgerGameType;
  channel: LedgerChannel;
  eventType: LedgerEventType;
  /** Beløp i kroner (ikke øre) — matcher adapter-konvensjon. */
  amount: number;
  roomCode?: string;
  gameId?: string;
  claimId?: string;
  playerId?: string;
  walletId?: string;
  sourceAccountId?: string;
  targetAccountId?: string;
  policyVersion?: string;
  batchId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Resultat fra `isWalletAllowedForGameplay`. Hvis `allowed: false` skal
 * `code` settes til en stabil dotted verb (e.g. `"compliance.self_excluded"`)
 * og `message` til norsk tekst som kan vises til spilleren.
 */
export interface ComplianceAllowResult {
  allowed: boolean;
  /** Stable dotted code, kun satt når allowed=false. */
  code?: string;
  /** Human-readable melding (norsk), kun satt når allowed=false. */
  message?: string;
}

/**
 * Resultat fra `wouldExceedLossLimit`. Returnerer `wouldExceed: true`
 * hvis `amountCents` debet ville bringe spillerens netto-tap for
 * (wallet, hall)-kombinasjonen forbi enten daglig eller månedlig grense
 * (avhengig av hva som settes lavest).
 */
export interface LossLimitCheckResult {
  wouldExceed: boolean;
}

/**
 * Smal compliance-kontrakt for unified pipeline.
 *
 * Implementasjoner:
 * - `InMemoryCompliancePort` (Fase 0) — for invariant-tester. Idempotency-
 *   guard er en `Set<string>` over keys.
 * - `ComplianceAdapterPort` (Fase 1) — wrapper rundt eksisterende
 *   `ComplianceLedger` + `ResponsibleGamingPersistenceAdapter`.
 */
export interface CompliancePort {
  /**
   * Skriv en ledger-event idempotent. `idempotencyKey` MÅ være
   * deterministisk per logiske event — bruk
   * `IdempotencyKeyPort.forCompliance(...)` eller
   * `makeComplianceLedgerIdempotencyKey()` (legacy helper i
   * `ComplianceLedger.ts`).
   *
   * Re-kall med samme key er en no-op (UNIQUE-constraint på DB håndhever
   * dette i prod; in-memory porten replikerer oppførselen via Set).
   *
   * Fire-and-forget kontrakt: implementasjonen skal ikke kaste på
   * skrive-feil — caller logger, men payout-flyten skal aldri rulles
   * tilbake av en compliance-feil (samme policy som adapter-laget).
   */
  recordEvent(event: ComplianceEvent, idempotencyKey: string): Promise<void>;

  /**
   * Sjekk om en spiller får spille i en hall akkurat nå.
   *
   * Returnerer `allowed: false` for:
   * - Self-exclusion (§23, 1-års-pause)
   * - Frivillig timed pause (§25)
   * - Obligatorisk 60-min pause (§66)
   * - Hall-spesifikk blokkering
   */
  isWalletAllowedForGameplay(
    walletId: string,
    hallId: string,
  ): Promise<ComplianceAllowResult>;

  /**
   * Sjekk om en debet av `amountCents` ville bringe spillerens netto-tap
   * forbi tapsgrensen for hall. Brukes som pre-check FØR wallet-debit i
   * `Game1TicketPurchaseService` o.l.
   *
   * NB: Beløp i ØRE her (matcher WalletPort), selv om `recordEvent`
   * bruker kroner — fordi loss-limit-grenser ofte sjekkes i samme
   * call-chain som wallet-debit (begge i øre).
   */
  wouldExceedLossLimit(
    walletId: string,
    hallId: string,
    amountCents: number,
  ): Promise<LossLimitCheckResult>;
}
