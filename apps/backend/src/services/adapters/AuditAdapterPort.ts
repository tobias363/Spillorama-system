/**
 * Unified pipeline refactor — Fase 1 adapter (UNIFIED_PIPELINE_REFACTOR_DESIGN_2026-04-28.md §3.4).
 *
 * Wrapper som lar eksisterende `AuditLogService` brukes gjennom Fase 0
 * `AuditPort`-kontrakten.
 *
 * Begge har samme `AuditEvent`/`AuditLogInput`-shape, så denne adapteren
 * er nesten identitets-mapping. Vi beholder den separate som forberedelse
 * for Fase 2 hvor `AuditLogService` kan splittes per domain (game-audit,
 * compliance-audit, security-audit) — da blir wrapper-en ikke-trivielt.
 *
 * Fire-and-forget kontrakt:
 *   `AuditLogService.append` er allerede fire-and-forget på prod-DB-feil
 *   (logger pino-warning, kaster aldri). Vi videresender uendret.
 */

import type { AuditEvent, AuditPort } from "../../ports/AuditPort.js";
import type { AuditLogService } from "../../compliance/AuditLogService.js";

export class AuditAdapterPort implements AuditPort {
  constructor(private readonly service: AuditLogService) {}

  async log(event: AuditEvent): Promise<void> {
    await this.service.record({
      actorId: event.actorId,
      actorType: event.actorType,
      action: event.action,
      resource: event.resource,
      resourceId: event.resourceId,
      details: event.details,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
    });
  }
}
