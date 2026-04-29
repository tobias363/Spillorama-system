/**
 * COMP-P0-002: Repository for compliance-outbox-tabellen.
 *
 * Outbox-pattern for §71-pengespillforskriften compliance-ledger-write.
 * Speiler `WalletOutboxRepo` (BIN-761) men med viktige forskjeller:
 *   - `enqueue()` tar ikke en `client: PoolClient` — compliance-event
 *     skrives POST-commit av wallet-tx (kan ikke være i samme tx).
 *     Garantien er at outbox-INSERT lykkes med høy sannsynlighet (én
 *     enkel INSERT uten validering/aggregering); hvis den lykkes
 *     garanterer worker eventual delivery til ComplianceLedger.
 *   - UNIQUE-constraint på `idempotency_key` med `ON CONFLICT DO NOTHING`
 *     — to retries av samme logiske event lager kun én outbox-rad,
 *     og dermed kun én §71-rad eventually.
 *
 * Worker (`ComplianceOutboxWorker`) bruker `claimNextBatch` med
 * `FOR UPDATE SKIP LOCKED` for trygg multi-worker-poll uten dobbel-
 * prosessering. Dispatcher er `ComplianceLedger.recordComplianceLedger-
 * Event` som selv har `ON CONFLICT (idempotency_key) DO NOTHING` på
 * `app_rg_compliance_ledger` — to dispatch-ekvivalenter er trygge.
 *
 * Retry-policy enforced av worker:
 *   1-4. attempts → tilbake til status='pending' for ny dispatch
 *   5.   attempts → status='dead_letter' (manuell ops-replay)
 */

import type { Pool } from "pg";

import type {
  LedgerChannel,
  LedgerEventType,
  LedgerGameType,
} from "../game/ComplianceLedgerTypes.js";

/** Stable maks-antall retries før dead-letter. Worker leser også denne. */
export const COMPLIANCE_OUTBOX_MAX_ATTEMPTS = 5;

/**
 * Payload-format for outbox-rad. Speiler `recordComplianceLedgerEvent`-
 * input-en så worker kan dispatch-e uten ekstra DB-lookup. Alt som er
 * undefined på TS-nivå blir utelatt fra JSONB-en (og leses tilbake som
 * undefined av worker — paritet med inline-call-sites).
 */
export interface ComplianceOutboxPayload {
  hallId: string;
  gameType: LedgerGameType;
  channel: LedgerChannel;
  eventType: LedgerEventType;
  /** Beløp i kroner (ikke øre) — matcher ComplianceLedgerEventInput. */
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
  /**
   * Eksplisitt sub-key fra call-site (f.eks. purchaseId for STAKE,
   * phase for HOUSE_RETAINED). Brukes av makeComplianceLedgerIdempotencyKey
   * og persisteres her så worker kan reprodusere call-en eksakt.
   */
  eventSubKey?: string;
}

/** Inntak til `enqueue()`. */
export interface ComplianceOutboxEntry {
  /** Deterministisk idempotency-key — UNIQUE-constraint på outbox-tabellen. */
  idempotencyKey: string;
  payload: ComplianceOutboxPayload;
}

/** Rad lest fra DB av worker. */
export interface ComplianceOutboxRow {
  id: number;
  idempotencyKey: string;
  payload: ComplianceOutboxPayload;
  status: "pending" | "processed" | "dead_letter";
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
}

interface RawRow {
  id: string | number;
  idempotency_key: string;
  payload: ComplianceOutboxPayload | string;
  status: "pending" | "processed" | "dead_letter";
  attempts: number;
  last_attempt_at: Date | string | null;
  last_error: string | null;
  created_at: Date | string;
  processed_at: Date | string | null;
}

function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

function mapRow(row: RawRow): ComplianceOutboxRow {
  // pg-driveren auto-parser jsonb → object, men håndter også string fallback.
  const payload =
    typeof row.payload === "string"
      ? (JSON.parse(row.payload) as ComplianceOutboxPayload)
      : row.payload;
  return {
    id: typeof row.id === "string" ? Number(row.id) : row.id,
    idempotencyKey: row.idempotency_key,
    payload,
    status: row.status,
    attempts: row.attempts,
    lastAttemptAt: toIso(row.last_attempt_at),
    lastError: row.last_error,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    processedAt: toIso(row.processed_at),
  };
}

export interface ComplianceOutboxRepoOptions {
  /** Pool brukt av alle queries — outbox er ikke koblet til wallet-tx. */
  pool: Pool;
  /** Schema-prefix matcher PostgresWalletAdapter. Default 'public'. */
  schema?: string;
}

/**
 * Repo for app_compliance_outbox-tabellen.
 *
 * Til forskjell fra `WalletOutboxRepo.enqueue` tar `enqueue()` her
 * ikke en `client: PoolClient` — compliance-event skrives etter at
 * wallet-tx er committed (det er hele poenget med outbox-pattern her).
 */
export class ComplianceOutboxRepo {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(opts: ComplianceOutboxRepoOptions) {
    this.pool = opts.pool;
    // Defensiv: assertSchemaName-paritet med PostgresWalletAdapter.
    const schema = (opts.schema ?? "public").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
      throw new Error(`ComplianceOutboxRepo: ugyldig schema-navn "${schema}".`);
    }
    this.schema = schema;
  }

  private table(): string {
    return `"${this.schema}"."app_compliance_outbox"`;
  }

  /**
   * Insert ett event i outbox. Idempotent på `idempotency_key` —
   * `ON CONFLICT DO NOTHING` sikrer at to retries av samme logiske
   * event lager kun én outbox-rad (og dermed kun én §71-rad eventually).
   *
   * Returnerer `true` hvis raden ble inserted, `false` hvis den allerede
   * fantes (DO NOTHING). Caller bruker dette for å logge metric eller
   * skippe inline-dispatch (siden den allerede ble forsøkt før).
   */
  async enqueue(entry: ComplianceOutboxEntry): Promise<boolean> {
    if (!entry.idempotencyKey || !entry.idempotencyKey.trim()) {
      throw new Error("ComplianceOutboxRepo.enqueue: idempotencyKey er påkrevd.");
    }
    if (!entry.payload) {
      throw new Error("ComplianceOutboxRepo.enqueue: payload er påkrevd.");
    }
    const result = await this.pool.query(
      `INSERT INTO ${this.table()} (idempotency_key, payload)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [entry.idempotencyKey, JSON.stringify(entry.payload)],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Claim et batch pending-rader for worker-prosessering.
   *
   * Bruker `FOR UPDATE SKIP LOCKED` så to workere som kjører samtidig aldri
   * leser samme rad. Atomisk inkrementering av attempts + last_attempt_at
   * matcher mønsteret fra WalletOutboxRepo.
   */
  async claimNextBatch(limit: number): Promise<ComplianceOutboxRow[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("ComplianceOutboxRepo.claimNextBatch: limit må være positivt heltall.");
    }
    const { rows } = await this.pool.query<RawRow>(
      `WITH claimed AS (
         SELECT id FROM ${this.table()}
         WHERE status = 'pending'
         ORDER BY created_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE ${this.table()} o
          SET attempts = o.attempts + 1,
              last_attempt_at = now()
         FROM claimed
        WHERE o.id = claimed.id
       RETURNING o.id, o.idempotency_key, o.payload,
                 o.status, o.attempts, o.last_attempt_at, o.last_error,
                 o.created_at, o.processed_at`,
      [limit],
    );
    return rows.map(mapRow);
  }

  /** Markér rader processed efter vellykket dispatch. */
  async markProcessed(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.pool.query(
      `UPDATE ${this.table()}
          SET status = 'processed', processed_at = now(), last_error = NULL
        WHERE id = ANY($1::bigint[])`,
      [ids],
    );
  }

  /**
   * Markér én rad failed:
   *   - Hvis attempts >= COMPLIANCE_OUTBOX_MAX_ATTEMPTS → status='dead_letter'.
   *   - Ellers tilbake til 'pending' (worker plukker den opp igjen ved neste tick).
   *
   * `attempts` er allerede inkrementert i `claimNextBatch`. Vi sammenlikner
   * mot grensen direkte uten å legge til 1.
   */
  async markFailed(id: number, error: string, attempts: number): Promise<void> {
    const isDead = attempts >= COMPLIANCE_OUTBOX_MAX_ATTEMPTS;
    const truncated = error.length > 4000 ? error.slice(0, 4000) : error;
    await this.pool.query(
      `UPDATE ${this.table()}
          SET status = $2,
              last_error = $3
        WHERE id = $1`,
      [id, isDead ? "dead_letter" : "pending", truncated],
    );
  }

  /**
   * Markér én pending-rad som processed når caller har dispatched inline
   * (call-site lyktes med inline-dispatch og vil ikke at worker re-dispatch-er).
   *
   * Returnerer `false` hvis raden ikke fantes (idempotency-conflict skipped
   * inline-dispatch-en) eller allerede var processed/dead-letter.
   */
  async markProcessedByKey(idempotencyKey: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ${this.table()}
          SET status = 'processed', processed_at = now(), last_error = NULL
        WHERE idempotency_key = $1
          AND status = 'pending'`,
      [idempotencyKey],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Hjelper for tests / observability — count rader per status. */
  async countByStatus(): Promise<Record<string, number>> {
    const { rows } = await this.pool.query<{ status: string; n: string }>(
      `SELECT status, COUNT(*)::text AS n FROM ${this.table()} GROUP BY status`,
    );
    const out: Record<string, number> = { pending: 0, processed: 0, dead_letter: 0 };
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  }
}
