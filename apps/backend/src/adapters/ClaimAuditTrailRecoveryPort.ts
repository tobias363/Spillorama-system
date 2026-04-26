/**
 * CRIT-6 (SPILL1_CASINO_GRADE_REVIEW_2026-04-26): port for å registrere
 * audit-trail-steg som feilet ETTER at en wallet-transfer er committet.
 *
 * **Bakgrunn:** `BingoEngine.submitClaim` koordinerer fem separate
 * I/O-paths etter premie-transferen:
 *   1. `compliance.recordLossEntry` — netto-tap-tracker
 *   2. `ledger.recordComplianceLedgerEvent` — regulatorisk §11-rapport
 *   3. `payoutAudit.appendPayoutAuditEvent` — internt audit-trail med hash-chain
 *   4. `bingoAdapter.onCheckpoint` — crash-recovery checkpoint
 *   5. `rooms.persist` — in-memory ↔ store sync
 *
 * Reell atomicity (én outer DB-tx på tvers av wallet + alle 5 stegene)
 * krever at BingoEngine får direkte pool-tilgang og at alle services
 * eksponerer client-aware varianter. Det er en større refactor som er
 * utenfor scope for K2-B.
 *
 * **Kompromiss-pattern (denne porten):** etter wallet-transfer
 * kjører hvert steg sekvensielt. Hvis et steg feiler:
 *   - Beløpet er allerede betalt (transfer er committed) — ikke reversibel.
 *   - Engine logger feilen prominent (eksisterende oppførsel).
 *   - **Nytt:** engine kaller `onAuditTrailStepFailed` med komplett
 *     payload slik at ops kan re-spille steget asynkront (DB-job,
 *     manuell SQL osv).
 *
 * **Hvorfor dette gir reell atomicity-gevinst:**
 *   - Tidligere: feil-loggen var den eneste sporet av et hopp i
 *     audit-trailen. Det krevde at noen leste loggene FØR de ble
 *     rotert ut, og så manuelt lagde tilsvarende DB-rader basert på
 *     log-tekst.
 *   - Nå: feilen blir en strukturert event med alle felt nødvendig
 *     for replay. Produksjon kan wire en port-implementasjon som
 *     skriver til en `app_claim_audit_recovery_queue`-tabell og en
 *     bakgrunns-job som retry-er.
 *
 * **Regulatorisk:** ved et regulatorisk-kritisk steg (compliance ledger,
 * compliance loss-entry) skal `severity` være `REGULATORY` slik at
 * recovery-systemet kan eskalere raskere. Andre steg (payout-audit,
 * checkpoint, persist) er `INTERNAL`.
 *
 * **Fire-and-forget:** denne porten må aldri kaste — feiler den, går
 * vi tilbake til log-only-pathen (som var oppførselen før porten ble
 * lagt til).
 */

export type ClaimAuditTrailStep =
  | "complianceLossEntry"
  | "complianceLedgerEvent"
  | "payoutAuditEvent"
  | "checkpoint"
  | "roomPersist";

export type ClaimAuditTrailSeverity = "REGULATORY" | "INTERNAL";

export interface ClaimAuditTrailFailedEvent {
  /** Hvilket steg som feilet. */
  step: ClaimAuditTrailStep;
  /** Severity-flagg for raskere eskalering (REGULATORY = §11-relatert). */
  severity: ClaimAuditTrailSeverity;
  /** Premie-fase for sporbarhet. */
  phase: "LINE" | "BINGO";

  // ── Kontekst (alltid satt) ───────────────────────────────────────
  claimId: string;
  gameId: string;
  roomCode: string;
  hallId: string;
  walletId: string;
  playerId: string;
  /** Premiebeløp i kroner (allerede utbetalt). */
  payoutAmount: number;

  // ── Payload-spesifikk for replay ─────────────────────────────────
  /**
   * Stegets fulle payload som JSON-serialiserbart objekt. Inneholder
   * eksakt det engine ville ha sendt til den feilende metoden — slik at
   * en recovery-job kan re-kalle metoden med samme argumenter.
   */
  payload: Record<string, unknown>;

  // ── Feil-info ─────────────────────────────────────────────────────
  /** Feil-meldingen for diagnostikk. */
  errorMessage: string;
  /** Feil-koden hvis tilgjengelig (DomainError.code etc). */
  errorCode?: string;

  /** ISO-timestamp da feilen ble fanget. */
  failedAt: string;
}

export interface ClaimAuditTrailRecoveryPort {
  /**
   * Registrer at et audit-trail-steg feilet etter wallet-transfer.
   *
   * Denne kalles fire-and-forget — implementasjonen MÅ ikke kaste.
   * Hvis implementasjonen selv feiler, faller engine tilbake til
   * log-only (eksisterende oppførsel).
   */
  onAuditTrailStepFailed(event: ClaimAuditTrailFailedEvent): Promise<void>;
}

/**
 * Default no-op implementasjon. Brukes av tester og deploye uten
 * recovery-queue. Kjent kostnad: feilende audit-steg blir kun synlige
 * i strukturerte logger (samme som før porten ble innført).
 */
export class NoopClaimAuditTrailRecoveryPort
  implements ClaimAuditTrailRecoveryPort
{
  async onAuditTrailStepFailed(
    _event: ClaimAuditTrailFailedEvent
  ): Promise<void> {
    /* no-op */
  }
}
