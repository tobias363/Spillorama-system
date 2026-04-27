/**
 * REQ-131: 90-day password rotation tracking.
 *
 * Per Wireframe Catalog (Frontend CR PDF 9 §8.2.2): "Password must be
 * changed every 90 days". Migrasjonen
 * `20260928000000_password_changed_at.sql` legger til kolonnen
 * `app_users.password_changed_at`. Denne tjenesten leser feltet og
 * regner ut hvor mange dager som er igjen til neste rotasjon.
 *
 * Konfigurasjon:
 *   `PASSWORD_ROTATION_DAYS` (default 90) — antall dager mellom
 *   rotasjoner. 0 eller negativ deaktiverer policyen (returnerer alltid
 *   `needsRotation=false`).
 *
 * Bruk:
 *   const status = await passwordRotation.checkStatus(userId);
 *   if (status.needsRotation) { /* tving change-password / *\/ }
 *
 * Klienten ringer `GET /api/auth/me/password-needs-rotation` for å få
 * status — typisk etter login og periodisk under sesjonen.
 */

import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "password-rotation-service" });

export interface PasswordRotationStatus {
  /** Sant hvis spilleren MÅ bytte passord nå (utover terskelen). */
  needsRotation: boolean;
  /** Sant hvis spilleren bør varsles om snart-utløp (innenfor warningDays). */
  warningDue: boolean;
  /** Antall dager siden siste passord-bytte. Null hvis ukjent. */
  daysSinceChange: number | null;
  /** Antall dager til neste tvunget rotasjon. Negativ = utløpt. */
  daysUntilRotation: number | null;
  /** Konfigurert rotasjonsperiode i dager. */
  rotationPeriodDays: number;
  /** Konfigurert warning-vindu i dager før utløp. */
  warningDays: number;
  /** ISO-tidsstempel for siste passord-bytte. Null = ukjent (legacy-bruker). */
  passwordChangedAt: string | null;
}

export interface PasswordRotationServiceOptions {
  pool: Pool;
  schema?: string;
  /** Default 90. Sett 0 for å deaktivere policyen. */
  rotationPeriodDays?: number;
  /** Default 7. Hvor mange dager før utløp warningDue settes. */
  warningDays?: number;
  /** Test-hook. */
  nowMs?: () => number;
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class PasswordRotationService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly rotationPeriodDays: number;
  private readonly warningDays: number;
  private readonly nowMs: () => number;

  constructor(options: PasswordRotationServiceOptions) {
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
    this.rotationPeriodDays = Math.max(0, Math.floor(options.rotationPeriodDays ?? 90));
    this.warningDays = Math.max(0, Math.floor(options.warningDays ?? 7));
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  /** @internal — for test/admin-bruk. */
  getRotationPeriodDays(): number {
    return this.rotationPeriodDays;
  }

  /** Sjekker rotasjons-status for en gitt bruker. */
  async checkStatus(userId: string): Promise<PasswordRotationStatus> {
    if (!userId || typeof userId !== "string") {
      throw new DomainError("INVALID_INPUT", "userId er påkrevd.");
    }
    const baseStatus: Omit<
      PasswordRotationStatus,
      "needsRotation" | "warningDue" | "daysSinceChange" | "daysUntilRotation" | "passwordChangedAt"
    > = {
      rotationPeriodDays: this.rotationPeriodDays,
      warningDays: this.warningDays,
    };

    // Policy disabled → alltid OK.
    if (this.rotationPeriodDays === 0) {
      return {
        ...baseStatus,
        needsRotation: false,
        warningDue: false,
        daysSinceChange: null,
        daysUntilRotation: null,
        passwordChangedAt: null,
      };
    }

    let row: { password_changed_at: Date | string | null } | undefined;
    try {
      const { rows } = await this.pool.query<{ password_changed_at: Date | string | null }>(
        `SELECT password_changed_at FROM "${this.schema}"."app_users" WHERE id = $1`,
        [userId]
      );
      row = rows[0];
    } catch (err) {
      logger.warn({ err, userId }, "[REQ-131] kunne ikke lese password_changed_at");
      // Fail-open: ikke blokker login pga lese-feil. Klient kan eventuelt
      // re-spørre senere.
      return {
        ...baseStatus,
        needsRotation: false,
        warningDue: false,
        daysSinceChange: null,
        daysUntilRotation: null,
        passwordChangedAt: null,
      };
    }
    if (!row) {
      throw new DomainError("USER_NOT_FOUND", "Bruker finnes ikke.");
    }

    const changedAt = row.password_changed_at;
    if (!changedAt) {
      // Legacy-bruker uten data — ikke tving ennå (backfill kjører i migrasjon).
      return {
        ...baseStatus,
        needsRotation: false,
        warningDue: false,
        daysSinceChange: null,
        daysUntilRotation: null,
        passwordChangedAt: null,
      };
    }

    const changedAtMs =
      typeof changedAt === "string" ? Date.parse(changedAt) : changedAt.getTime();
    const ageMs = this.nowMs() - changedAtMs;
    const daysSinceChange = Math.floor(ageMs / MS_PER_DAY);
    const daysUntilRotation = this.rotationPeriodDays - daysSinceChange;
    const needsRotation = daysUntilRotation <= 0;
    const warningDue = !needsRotation && daysUntilRotation <= this.warningDays;

    return {
      ...baseStatus,
      needsRotation,
      warningDue,
      daysSinceChange,
      daysUntilRotation,
      passwordChangedAt:
        typeof changedAt === "string" ? changedAt : changedAt.toISOString(),
    };
  }
}
