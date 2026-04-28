/**
 * Unified pipeline refactor — Fase 0.
 *
 * In-memory implementasjon av AuditPort. Appender events til en intern
 * array som tester kan inspisere via `getAll()` eller `findByAction()`.
 *
 * Fire-and-forget kontrakt: `log()` kaster aldri. PII-redaction er
 * kraftig forenklet her (kun en hardkodet liste over kjente sensitive
 * keys) — produksjons-versjonen vil bruke `redactDetails()` fra
 * AuditLogService.
 */

import type { AuditEvent, AuditPort } from "../AuditPort.js";

const REDACT_KEYS = new Set([
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "ssn",
  "personnummer",
]);

const REDACTED = "[REDACTED]";

interface PersistedAuditEvent extends AuditEvent {
  /** Sequential id, 0-indexed insertion order. */
  id: number;
  /** ISO timestamp i UTC når eventen ble logget. */
  loggedAt: string;
}

export class InMemoryAuditPort implements AuditPort {
  private readonly events: PersistedAuditEvent[] = [];
  private nextId = 0;

  async log(event: AuditEvent): Promise<void> {
    const id = this.nextId++;
    this.events.push({
      ...event,
      details: event.details ? redact(event.details) : event.details,
      id,
      loggedAt: new Date().toISOString(),
    });
  }

  /** Hent alle events i innsettings-rekkefølge. */
  getAll(): PersistedAuditEvent[] {
    return [...this.events];
  }

  /** Filtrér events på dotted action-verb (e.g. `"game.payout.phase"`). */
  findByAction(action: string): PersistedAuditEvent[] {
    return this.events.filter((e) => e.action === action);
  }

  /** Filtrér events på resource (e.g. `"game"`, `"wallet"`). */
  findByResource(resource: string): PersistedAuditEvent[] {
    return this.events.filter((e) => e.resource === resource);
  }

  /** Antall events totalt. */
  count(): number {
    return this.events.length;
  }

  /** Fjern alle events — for tester som vil gjenbruke samme port. */
  clear(): void {
    this.events.length = 0;
    this.nextId = 0;
  }
}

function redact(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (REDACT_KEYS.has(key.toLowerCase())) {
      out[key] = REDACTED;
    } else {
      out[key] = value;
    }
  }
  return out;
}
