/**
 * Unified pipeline refactor — Fase 0 (UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md §3.4).
 *
 * Narrow port for audit-logging fra game-pipelinen.
 *
 * Erstatter direkte avhengigheter på `AuditLogService` (apps/backend/src/
 * compliance/AuditLogService.ts) i game-pipelinen. PayoutService /
 * LifecycleService / MasterCoordinationService skal kun kunne logge
 * audit-events; de skal aldri kunne lese eller filtrere dem.
 *
 * Implementasjoner:
 * - `InMemoryAuditPort` (Fase 0) — appender til array. Tester kan
 *   inspisere arrayen for assertions.
 * - `AuditAdapterPort` (Fase 1) — wrapper rundt `AuditLogService`.
 *
 * Fire-and-forget kontrakt:
 *   `log()` skal ikke kaste — implementasjonen logger pino-warning på
 *   skrive-feil og fortsetter. Game-flyten skal aldri rulles tilbake
 *   av en audit-feil (samme policy som adapter-laget).
 */

import type { AuditActorType } from "../compliance/AuditLogService.js";

export type { AuditActorType };

/**
 * Ny audit-event for unified pipeline.
 *
 * Field-set er identisk med `AuditLogInput` i `AuditLogService`, men
 * type-defineres her for at port-konsumenter skal slippe en ekstra
 * import-linje. PII-redaction håndteres av implementasjonen — caller
 * trenger ikke pre-redacte `details`.
 */
export interface AuditEvent {
  actorId: string | null;
  actorType: AuditActorType;
  /** Stabil dotted verb, e.g. `"game.payout.phase"`, `"room.lifecycle.start"`. */
  action: string;
  /** Entity-kind, e.g. `"game"`, `"room"`, `"wallet"`. */
  resource: string;
  resourceId: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditPort {
  /**
   * Append en audit-event. Fire-and-forget — kaster ikke ved skrive-feil.
   * Implementasjonen er ansvarlig for PII-redaction av `details`.
   */
  log(event: AuditEvent): Promise<void>;
}
