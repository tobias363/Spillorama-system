/**
 * Unified pipeline refactor — Fase 0.
 *
 * In-memory implementasjon av CompliancePort.
 *
 * - `recordEvent` håndhever idempotens via en `Set<string>` over keys.
 *   Dette matcher prod-oppførselen der `app_rg_compliance_ledger.
 *   idempotency_key` har UNIQUE-constraint og `ON CONFLICT DO NOTHING`
 *   i `PostgresResponsibleGamingStore.insertComplianceLedgerEntry`.
 * - `isWalletAllowedForGameplay` returnerer `allowed: true` med mindre
 *   wallet er pre-flagget via `setBlocked(walletId, hallId, code, message)`.
 * - `wouldExceedLossLimit` returnerer `wouldExceed: false` med mindre
 *   wallet er pre-flagget via `setLossLimitWouldExceed(walletId, hallId)`.
 */

import type {
  ComplianceAllowResult,
  ComplianceEvent,
  CompliancePort,
  LossLimitCheckResult,
} from "../CompliancePort.js";

interface BlockEntry {
  code: string;
  message: string;
}

export class InMemoryCompliancePort implements CompliancePort {
  /** Set av seen idempotency-keys — matcher UNIQUE-constraint på prod-DB. */
  private readonly seenKeys = new Set<string>();
  /** Persistert events (deduplisert). */
  private readonly events: Array<{ key: string; event: ComplianceEvent }> = [];
  /** Block-state pr (wallet, hall). */
  private readonly blocks = new Map<string, BlockEntry>();
  /** Loss-limit-flagg pr (wallet, hall). */
  private readonly lossLimitFlags = new Set<string>();

  async recordEvent(event: ComplianceEvent, idempotencyKey: string): Promise<void> {
    if (this.seenKeys.has(idempotencyKey)) {
      // ON CONFLICT DO NOTHING — silent.
      return;
    }
    this.seenKeys.add(idempotencyKey);
    this.events.push({ key: idempotencyKey, event });
  }

  async isWalletAllowedForGameplay(
    walletId: string,
    hallId: string,
  ): Promise<ComplianceAllowResult> {
    const block = this.blocks.get(blockKey(walletId, hallId));
    if (block) {
      return { allowed: false, code: block.code, message: block.message };
    }
    return { allowed: true };
  }

  async wouldExceedLossLimit(
    walletId: string,
    hallId: string,
    _amountCents: number,
  ): Promise<LossLimitCheckResult> {
    void _amountCents;
    return { wouldExceed: this.lossLimitFlags.has(blockKey(walletId, hallId)) };
  }

  // ── Test-helpers ─────────────────────────────────────────────────────────

  /** Pre-flag en (wallet, hall) som blokkert (e.g. self-exclusion). */
  setBlocked(walletId: string, hallId: string, code: string, message: string): void {
    this.blocks.set(blockKey(walletId, hallId), { code, message });
  }

  /** Fjern et tidligere block-flag. */
  clearBlock(walletId: string, hallId: string): void {
    this.blocks.delete(blockKey(walletId, hallId));
  }

  /** Pre-flag at neste loss-limit-sjekk skal returnere `wouldExceed: true`. */
  setLossLimitWouldExceed(walletId: string, hallId: string): void {
    this.lossLimitFlags.add(blockKey(walletId, hallId));
  }

  /** Hent alle persisterte events (i innsettings-rekkefølge). */
  getAllEvents(): Array<{ key: string; event: ComplianceEvent }> {
    return [...this.events];
  }

  /** Antall persisterte events (UNIKE keys). */
  count(): number {
    return this.events.length;
  }

  /** Antall sett av keys (samme som `count()` siden idempotens er enforced). */
  keyCount(): number {
    return this.seenKeys.size;
  }

  /** Fjern alle entries — for tester som vil gjenbruke samme port. */
  clear(): void {
    this.seenKeys.clear();
    this.events.length = 0;
    this.blocks.clear();
    this.lossLimitFlags.clear();
  }
}

function blockKey(walletId: string, hallId: string): string {
  return `${walletId}|${hallId}`;
}
