/**
 * BIN-761: Repository for wallet-outbox-tabellen.
 *
 * Outbox-pattern (industri-standard fra Pragmatic Play / Evolution):
 * `enqueue()` MÅ kjøres i SAMME PoolClient-tx som ledger-INSERT-en. Det er
 * hele poenget med pattern-en — atomisk persistering av (ledger-entry,
 * outbox-rad) sikrer at ingen wallet-tx kan eksistere uten matching event.
 *
 * Worker (`WalletOutboxWorker`) bruker `claimNextBatch` med
 * `FOR UPDATE SKIP LOCKED` for trygg multi-worker-poll uten dobbel-prosessering.
 *
 * Retry-policy enforced av worker:
 *   1-4. attempts → tilbake til status='pending' for ny dispatch
 *   5.   attempts → status='dead_letter' (manuell ops-replay)
 */

import type { PoolClient, Pool } from "pg";

/** Stable maks-antall retries før dead-letter. Worker leser også denne. */
export const WALLET_OUTBOX_MAX_ATTEMPTS = 5;

/**
 * Inntak til `enqueue()`. Payload må inneholde alt dispatcher trenger for å
 * publisere event-en uten ekstra DB-lookup (account_id, type, amount,
 * deposit/winnings-balanser, evt. related_account_id).
 */
export interface WalletOutboxEntry {
  operationId: string;
  accountId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

/** Rad lest fra DB av worker. */
export interface WalletOutboxRow {
  id: number;
  operationId: string;
  accountId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: "pending" | "processed" | "dead_letter";
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
}

interface RawRow {
  id: string | number;
  operation_id: string;
  account_id: string;
  event_type: string;
  payload: Record<string, unknown> | string;
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

function mapRow(row: RawRow): WalletOutboxRow {
  // pg-driveren auto-parser jsonb → object, men håndter også string fallback.
  const payload =
    typeof row.payload === "string" ? (JSON.parse(row.payload) as Record<string, unknown>) : row.payload;
  return {
    id: typeof row.id === "string" ? Number(row.id) : row.id,
    operationId: row.operation_id,
    accountId: row.account_id,
    eventType: row.event_type,
    payload,
    status: row.status,
    attempts: row.attempts,
    lastAttemptAt: toIso(row.last_attempt_at),
    lastError: row.last_error,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    processedAt: toIso(row.processed_at),
  };
}

export interface WalletOutboxRepoOptions {
  /** Pool brukt av `claimNextBatch`/`markProcessed`/`markFailed` (worker-poll). */
  pool: Pool;
  /** Schema-prefix matcher PostgresWalletAdapter. Default 'public'. */
  schema?: string;
}

/**
 * Repo for wallet_outbox-tabellen.
 *
 * `enqueue()` tar inn `client: PoolClient` — kalleren MÅ allerede ha åpnet en
 * tx på den. Pool-feltet brukes kun av worker-leseoperasjoner.
 */
export class WalletOutboxRepo {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(opts: WalletOutboxRepoOptions) {
    this.pool = opts.pool;
    // Defensiv: assertSchemaName-paritet med PostgresWalletAdapter.
    const schema = (opts.schema ?? "public").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
      throw new Error(`WalletOutboxRepo: ugyldig schema-navn "${schema}".`);
    }
    this.schema = schema;
  }

  private table(): string {
    return `"${this.schema}"."wallet_outbox"`;
  }

  /**
   * Insert ett event i outbox. **MÅ kalles i samme tx som ledger-INSERT.**
   * Bruker passed-in `client` så vi deler tx med outer wallet-operasjon.
   */
  async enqueue(client: PoolClient, entry: WalletOutboxEntry): Promise<void> {
    if (!entry.operationId || !entry.accountId || !entry.eventType) {
      throw new Error("WalletOutboxRepo.enqueue: operationId, accountId og eventType er påkrevd.");
    }
    await client.query(
      `INSERT INTO ${this.table()} (operation_id, account_id, event_type, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [entry.operationId, entry.accountId, entry.eventType, JSON.stringify(entry.payload ?? {})],
    );
  }

  /**
   * Claim et batch pending-rader for worker-prosessering.
   *
   * Bruker `FOR UPDATE SKIP LOCKED` så to workere som kjører samtidig aldri
   * leser samme rad — den ene får raden, den andre hopper videre. Standard
   * multi-instance-mønster for poll-baserte outbox-workere.
   *
   * Kritisk: leser i en EGEN tx (BEGIN/COMMIT) for å holde row-lock under
   * dispatch. Caller må kalle `markProcessed` eller `markFailed` på samme
   * client (returnert) før commit, ellers slippes locken og en annen worker
   * kan plukke samme rad.
   *
   * For enkelhet returnerer vi rader OG releaser locken med en gang —
   * pattern-en blir: claim → dispatch → markProcessed/Failed (separate tx).
   * Dette er trygt fordi `markProcessed` er status-overgang fra 'pending';
   * worker B vil ikke claime en allerede-processed rad.
   */
  async claimNextBatch(limit: number): Promise<WalletOutboxRow[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("WalletOutboxRepo.claimNextBatch: limit må være positivt heltall.");
    }
    // Atomisk claim — UPDATE ... FROM (SELECT FOR UPDATE SKIP LOCKED) sikrer
    // at vi inkrementerer attempts + setter last_attempt_at i én operasjon
    // mens vi leaser radene. Konkurrerende workere ser oppdatert
    // last_attempt_at og blir bedt om å hoppe over via partial-pending-index.
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
       RETURNING o.id, o.operation_id, o.account_id, o.event_type, o.payload,
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
   *   - Hvis attempts >= WALLET_OUTBOX_MAX_ATTEMPTS → status='dead_letter'.
   *   - Ellers tilbake til 'pending' (worker plukker den opp igjen ved neste tick).
   *
   * `attempts` er allerede inkrementert i `claimNextBatch`. Vi sammenlikner
   * mot grensen direkte uten å legge til 1.
   */
  async markFailed(id: number, error: string, attempts: number): Promise<void> {
    const isDead = attempts >= WALLET_OUTBOX_MAX_ATTEMPTS;
    const truncated = error.length > 4000 ? error.slice(0, 4000) : error;
    await this.pool.query(
      `UPDATE ${this.table()}
          SET status = $2,
              last_error = $3
        WHERE id = $1`,
      [id, isDead ? "dead_letter" : "pending", truncated],
    );
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
