/**
 * Withdraw in Bank — XML-eksport-tjeneste (wireframe 16.20).
 *
 * Ansvar:
 *   1) Finne alle `ACCEPTED` bank-uttak siden forrige batch for en gitt
 *      agent (via hall-tilknytning) — eller for alle agenter når
 *      `agentUserId` er null (manuell "export all"-batch).
 *   2) Bygge XML-dokumentet i vårt eget kompakte format (se buildXml).
 *      PM-valg 2026-04-24: egen enkelt XML-struktur fremfor ISO 20022
 *      pain.001 — regnskap får alle nødvendige felter men uten bankens
 *      SEPA-overhead. Hvis regnskap senere ønsker pain.001 gjør vi
 *      konvertering som et eget steg.
 *   3) Skrive XML-filen til disk (WITHDRAW_XML_EXPORT_DIR, default
 *      /tmp/spill-xml-exports) og registrere batchen i DB.
 *   4) Flytte alle inkluderte requests fra 'ACCEPTED' → 'EXPORTED' med
 *      `exported_xml_batch_id` pekende til den nye batch-raden.
 *
 * Alt kjøres i én transaksjon så vi enten får fil + batch-rad +
 * request-oppdateringer samlet, eller ingenting. Fil-skriving gjøres
 * i synkron fs-kall etter COMMIT for å minimere vinduet der fil
 * ligger på disk uten DB-referanse.
 *
 * PM-låste krav (2026-04-24):
 *   - ÉN samlet XML per agent per dag (alle haller kombinert).
 *   - Kun bank-uttak havner i XML-en (hall-utbetaling = kontant i hall).
 *   - Accept/decline per request skjer i `PaymentRequestService`
 *     (BIN-586/BIN-646). Denne tjenesten håndterer KUN eksport-fasen.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Pool, type PoolClient } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "withdraw-xml-export-service" });

/** En utbetalingsrad inkludert i en XML-batch. */
export interface WithdrawExportRow {
  id: string;
  userId: string;
  hallId: string | null;
  amountCents: number;
  bankAccountNumber: string | null;
  bankName: string | null;
  accountHolder: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

/** Persistert XML-batch. */
export interface XmlExportBatch {
  id: string;
  agentUserId: string | null;
  generatedAt: string;
  xmlFilePath: string;
  emailSentAt: string | null;
  recipientEmails: string[];
  withdrawRequestCount: number;
}

/** Resultat av `generateDailyXmlForAgent`. */
export interface GenerateBatchResult {
  batch: XmlExportBatch;
  rows: WithdrawExportRow[];
  xmlContent: string;
}

export interface WithdrawXmlExportServiceOptions {
  connectionString: string;
  schema?: string;
  /** Rotkatalog for genererte XML-filer. Default: /tmp/spill-xml-exports. */
  exportDir?: string;
  /** Overstyres i tester. */
  nowMs?: () => number;
  /** For tester: opprett ikke fil på disk. */
  skipFileWrite?: boolean;
}

interface BatchRow {
  id: string;
  agent_user_id: string | null;
  generated_at: Date | string;
  xml_file_path: string;
  email_sent_at: Date | string | null;
  recipient_emails: string[];
  withdraw_request_count: number | string;
}

interface WithdrawRow {
  id: string;
  user_id: string;
  hall_id: string | null;
  amount_cents: number | string;
  bank_account_number: string | null;
  bank_name: string | null;
  account_holder: string | null;
  accepted_at: Date | string | null;
  created_at: Date | string;
}

function assertSchemaName(schema: string): string {
  const trimmed = schema.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new DomainError("INVALID_CONFIG", "APP_PG_SCHEMA er ugyldig.");
  }
  return trimmed;
}

function asIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function asIsoRequired(value: Date | string): string {
  return asIso(value) ?? new Date().toISOString();
}

function toInt(value: number | string): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n);
}

function mapWithdrawRow(r: WithdrawRow): WithdrawExportRow {
  return {
    id: r.id,
    userId: r.user_id,
    hallId: r.hall_id,
    amountCents: toInt(r.amount_cents),
    bankAccountNumber: r.bank_account_number,
    bankName: r.bank_name,
    accountHolder: r.account_holder,
    acceptedAt: asIso(r.accepted_at),
    createdAt: asIsoRequired(r.created_at),
  };
}

function mapBatchRow(r: BatchRow): XmlExportBatch {
  return {
    id: r.id,
    agentUserId: r.agent_user_id,
    generatedAt: asIsoRequired(r.generated_at),
    xmlFilePath: r.xml_file_path,
    emailSentAt: asIso(r.email_sent_at),
    recipientEmails: Array.isArray(r.recipient_emails) ? r.recipient_emails : [],
    withdrawRequestCount: toInt(r.withdraw_request_count),
  };
}

/** XML-entity-escape for tekst-innhold. */
function xmlEscape(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Bygg XML-dokumentet. Format (vårt eget):
 *
 *   <?xml version="1.0" encoding="UTF-8"?>
 *   <withdrawals
 *       batchId="..."
 *       agentUserId="..."
 *       generatedAt="2026-04-24T21:00:00.000Z"
 *       count="3">
 *     <withdrawal
 *         id="..."
 *         userId="..."
 *         hallId="..."
 *         amountCents="12500"
 *         amountMajor="125.00"
 *         acceptedAt="..."
 *         createdAt="...">
 *       <bankAccountNumber>12345678901</bankAccountNumber>
 *       <bankName>DNB</bankName>
 *       <accountHolder>Kari Nordmann</accountHolder>
 *     </withdrawal>
 *     ...
 *   </withdrawals>
 *
 * Valg av eget format vs. ISO 20022 pain.001: pain.001 krever BIC,
 * creditor-agent, structured remittance, debtor-init — overhead som
 * regnskaps-rutinen ikke trenger siden de gjør manuell matching i
 * sitt lønnssystem. Vi beholder enkel, ren struktur og dokumenterer
 * mapping i PR-body. Ved fremtidig behov legger vi til en egen
 * pain001-renderer over samme `WithdrawExportRow[]`.
 */
export function buildXml(
  batchId: string,
  agentUserId: string | null,
  generatedAt: string,
  rows: WithdrawExportRow[]
): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(
    `<withdrawals batchId="${xmlEscape(batchId)}"` +
      ` agentUserId="${xmlEscape(agentUserId ?? "")}"` +
      ` generatedAt="${xmlEscape(generatedAt)}"` +
      ` count="${rows.length}">`
  );
  for (const r of rows) {
    const amountMajor = (r.amountCents / 100).toFixed(2);
    lines.push(
      `  <withdrawal id="${xmlEscape(r.id)}"` +
        ` userId="${xmlEscape(r.userId)}"` +
        ` hallId="${xmlEscape(r.hallId ?? "")}"` +
        ` amountCents="${r.amountCents}"` +
        ` amountMajor="${amountMajor}"` +
        ` acceptedAt="${xmlEscape(r.acceptedAt ?? "")}"` +
        ` createdAt="${xmlEscape(r.createdAt)}">`
    );
    lines.push(
      `    <bankAccountNumber>${xmlEscape(r.bankAccountNumber)}</bankAccountNumber>`
    );
    lines.push(`    <bankName>${xmlEscape(r.bankName)}</bankName>`);
    lines.push(`    <accountHolder>${xmlEscape(r.accountHolder)}</accountHolder>`);
    lines.push(`  </withdrawal>`);
  }
  lines.push(`</withdrawals>`);
  return lines.join("\n");
}

export class WithdrawXmlExportService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly exportDir: string;
  private readonly nowMs: () => number;
  private readonly skipFileWrite: boolean;
  private initPromise: Promise<void> | null = null;

  constructor(options: WithdrawXmlExportServiceOptions) {
    if (!options.connectionString.trim()) {
      throw new DomainError(
        "INVALID_CONFIG",
        "Mangler connection string for withdraw XML export service."
      );
    }
    this.schema = assertSchemaName(options.schema ?? "public");
    this.exportDir = options.exportDir ?? "/tmp/spill-xml-exports";
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.skipFileWrite = options.skipFileWrite ?? false;
    this.pool = new Pool({
      connectionString: options.connectionString,
      ...getPoolTuning(),
    });
  }

  /** @internal — test-hook. */
  static forTesting(
    pool: Pool,
    opts?: { schema?: string; exportDir?: string; nowMs?: () => number; skipFileWrite?: boolean }
  ): WithdrawXmlExportService {
    const svc = Object.create(WithdrawXmlExportService.prototype) as WithdrawXmlExportService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(opts?.schema ?? "public");
    (svc as unknown as { exportDir: string }).exportDir = opts?.exportDir ?? "/tmp/spill-xml-exports";
    (svc as unknown as { nowMs: () => number }).nowMs = opts?.nowMs ?? (() => Date.now());
    (svc as unknown as { skipFileWrite: boolean }).skipFileWrite = opts?.skipFileWrite ?? true;
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise = Promise.resolve();
    return svc;
  }

  private withdrawTable(): string {
    return `"${this.schema}"."app_withdraw_requests"`;
  }

  private batchTable(): string {
    return `"${this.schema}"."app_xml_export_batches"`;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = Promise.resolve();
    }
    await this.initPromise;
  }

  /**
   * Generer XML-batch for én agent (eller for ALLE når agentUserId=null).
   * Inkluderer alle ACCEPTED bank-uttak som ikke er eksportert enda.
   *
   * Transaksjonsgrenser:
   *   - SELECT ... FOR UPDATE på request-radene før status-flip.
   *   - INSERT batch-rad + UPDATE-er request-rader + COMMIT før
   *     fil skrives. Hvis fil-skriving feiler etter COMMIT, har vi
   *     orphan DB-rad med tom fil — logget som warn så ops kan rydde.
   *     Alternativ (skrive før COMMIT) gir orphan-filer uten DB-rad,
   *     som er verre for konsistens.
   */
  async generateDailyXmlForAgent(
    agentUserId: string | null
  ): Promise<GenerateBatchResult> {
    await this.ensureInitialized();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const rows = await this.lockAcceptedBankRequests(client, agentUserId);
      if (rows.length === 0) {
        await client.query("COMMIT");
        log.info(
          { agentUserId },
          "generateDailyXmlForAgent: 0 accepted bank requests, no batch created"
        );
        // Returner tom batch-stub slik at CLI/cron kan telle.
        return {
          batch: this.emptyBatchStub(agentUserId),
          rows: [],
          xmlContent: "",
        };
      }

      const batchId = randomUUID();
      const generatedAtIso = new Date(this.nowMs()).toISOString();
      const filePath = this.computeFilePath(batchId, agentUserId, generatedAtIso);

      const xmlContent = buildXml(batchId, agentUserId, generatedAtIso, rows);

      // Insert batch-rad FØRST slik at request-updates kan referere til id.
      const insertBatch = await client.query<BatchRow>(
        `INSERT INTO ${this.batchTable()}
           (id, agent_user_id, generated_at, xml_file_path, withdraw_request_count)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, agent_user_id, generated_at, xml_file_path, email_sent_at,
                   recipient_emails, withdraw_request_count`,
        [batchId, agentUserId, generatedAtIso, filePath, rows.length]
      );

      // Flip status + knytt til batch-id.
      const requestIds = rows.map((r) => r.id);
      await client.query(
        `UPDATE ${this.withdrawTable()}
            SET status = 'EXPORTED',
                exported_at = $2,
                exported_xml_batch_id = $3,
                updated_at = now()
          WHERE id = ANY($1::text[])`,
        [requestIds, generatedAtIso, batchId]
      );

      await client.query("COMMIT");

      // Fil-skriving etter COMMIT. Se transaksjonsgrense-kommentar over.
      if (!this.skipFileWrite) {
        try {
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, xmlContent, { encoding: "utf-8" });
        } catch (err) {
          log.error(
            { err, filePath, batchId },
            "XML batch committed to DB but file-write failed — manual cleanup needed"
          );
          // Ikke re-throw: batchen lever i DB, ops må rydde fil-state.
        }
      }

      const batch = mapBatchRow(insertBatch.rows[0]!);
      log.info(
        {
          batchId,
          agentUserId,
          requestCount: rows.length,
          filePath,
        },
        "generateDailyXmlForAgent: batch generated"
      );
      return { batch, rows, xmlContent };
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Marker batchen som sendt på e-post. Separert fra `generate...` slik
   * at SMTP-feil ikke ruller tilbake selve eksporten. Caller får
   * batchId tilbake fra `generate...`, sender e-posten, og kaller denne.
   */
  async markBatchEmailSent(
    batchId: string,
    recipientEmails: string[]
  ): Promise<XmlExportBatch> {
    await this.ensureInitialized();
    const sentAt = new Date(this.nowMs()).toISOString();
    const { rows } = await this.pool.query<BatchRow>(
      `UPDATE ${this.batchTable()}
          SET email_sent_at = $2,
              recipient_emails = $3,
              updated_at = now()
        WHERE id = $1
        RETURNING id, agent_user_id, generated_at, xml_file_path, email_sent_at,
                  recipient_emails, withdraw_request_count`,
      [batchId, sentAt, recipientEmails]
    );
    const r = rows[0];
    if (!r) {
      throw new DomainError("XML_BATCH_NOT_FOUND", "XML-batch finnes ikke.");
    }
    return mapBatchRow(r);
  }

  /** List batcher (admin audit/oversikt). */
  async listBatches(opts: {
    agentUserId?: string | null;
    limit?: number;
  } = {}): Promise<XmlExportBatch[]> {
    await this.ensureInitialized();
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const params: unknown[] = [];
    let where = "";
    if (opts.agentUserId !== undefined) {
      if (opts.agentUserId === null) {
        where = "WHERE agent_user_id IS NULL";
      } else {
        params.push(opts.agentUserId);
        where = `WHERE agent_user_id = $${params.length}`;
      }
    }
    params.push(limit);
    const { rows } = await this.pool.query<BatchRow>(
      `SELECT id, agent_user_id, generated_at, xml_file_path, email_sent_at,
              recipient_emails, withdraw_request_count
         FROM ${this.batchTable()}
         ${where}
         ORDER BY generated_at DESC
         LIMIT $${params.length}`,
      params
    );
    return rows.map(mapBatchRow);
  }

  /** Hent batch + tilhørende rader (detaljvisning). */
  async getBatch(batchId: string): Promise<{ batch: XmlExportBatch; rows: WithdrawExportRow[] }> {
    await this.ensureInitialized();
    const { rows: batchRows } = await this.pool.query<BatchRow>(
      `SELECT id, agent_user_id, generated_at, xml_file_path, email_sent_at,
              recipient_emails, withdraw_request_count
         FROM ${this.batchTable()}
         WHERE id = $1`,
      [batchId]
    );
    const b = batchRows[0];
    if (!b) {
      throw new DomainError("XML_BATCH_NOT_FOUND", "XML-batch finnes ikke.");
    }
    const { rows: wrRows } = await this.pool.query<WithdrawRow>(
      `SELECT id, user_id, hall_id, amount_cents, bank_account_number, bank_name,
              account_holder, accepted_at, created_at
         FROM ${this.withdrawTable()}
         WHERE exported_xml_batch_id = $1
         ORDER BY created_at ASC`,
      [batchId]
    );
    return {
      batch: mapBatchRow(b),
      rows: wrRows.map(mapWithdrawRow),
    };
  }

  /**
   * Lister alle unike agent_user_id verdier (via app_agent_halls) slik
   * at daglig cron kan iterere. Returnerer også NULL-bucketten
   * representert som explicit null-entry hvis det finnes unassigned
   * hall-requests (admin-overordnet). For MVP behandler vi alle
   * unassigned som én NULL-agent-batch.
   */
  async listDistinctAgentUserIds(): Promise<Array<string | null>> {
    await this.ensureInitialized();
    // Join via app_agent_halls så vi finner agent-eieren av uttakets hall.
    const { rows } = await this.pool.query<{ agent_user_id: string | null }>(
      `SELECT DISTINCT ah.user_id AS agent_user_id
         FROM ${this.withdrawTable()} wr
         LEFT JOIN "${this.schema}"."app_agent_halls" ah ON ah.hall_id = wr.hall_id
         WHERE wr.status = 'ACCEPTED'
           AND wr.destination_type = 'bank'`
    );
    const ids = new Set<string | null>();
    let hasNull = false;
    for (const r of rows) {
      if (r.agent_user_id) ids.add(r.agent_user_id);
      else hasNull = true;
    }
    const out: Array<string | null> = Array.from(ids);
    if (hasNull) out.push(null);
    return out;
  }

  // ── Internal helpers ─────────────────────────────────────────────────

  private emptyBatchStub(agentUserId: string | null): XmlExportBatch {
    return {
      id: "",
      agentUserId,
      generatedAt: new Date(this.nowMs()).toISOString(),
      xmlFilePath: "",
      emailSentAt: null,
      recipientEmails: [],
      withdrawRequestCount: 0,
    };
  }

  private computeFilePath(
    batchId: string,
    agentUserId: string | null,
    generatedAtIso: string
  ): string {
    const dayPart = generatedAtIso.slice(0, 10);
    const agentPart = agentUserId ? `agent-${agentUserId}` : "agent-none";
    const fileName = `${agentPart}-${batchId}.xml`;
    return path.join(this.exportDir, dayPart, fileName);
  }

  /**
   * Låser (FOR UPDATE) og returnerer alle ACCEPTED bank-uttak som ikke
   * er eksportert. Filtrerer på agent via app_agent_halls når
   * agentUserId er satt; ellers returneres kun rader uten agent-hall-
   * tilknytning (NULL-bucketten).
   */
  private async lockAcceptedBankRequests(
    client: PoolClient,
    agentUserId: string | null
  ): Promise<WithdrawExportRow[]> {
    if (agentUserId === null) {
      const { rows } = await client.query<WithdrawRow>(
        `SELECT wr.id, wr.user_id, wr.hall_id, wr.amount_cents,
                wr.bank_account_number, wr.bank_name, wr.account_holder,
                wr.accepted_at, wr.created_at
           FROM ${this.withdrawTable()} wr
           LEFT JOIN "${this.schema}"."app_agent_halls" ah ON ah.hall_id = wr.hall_id
          WHERE wr.status = 'ACCEPTED'
            AND wr.destination_type = 'bank'
            AND ah.user_id IS NULL
          ORDER BY wr.created_at ASC
          FOR UPDATE OF wr`
      );
      return rows.map(mapWithdrawRow);
    }
    const { rows } = await client.query<WithdrawRow>(
      `SELECT wr.id, wr.user_id, wr.hall_id, wr.amount_cents,
              wr.bank_account_number, wr.bank_name, wr.account_holder,
              wr.accepted_at, wr.created_at
         FROM ${this.withdrawTable()} wr
         INNER JOIN "${this.schema}"."app_agent_halls" ah ON ah.hall_id = wr.hall_id
        WHERE wr.status = 'ACCEPTED'
          AND wr.destination_type = 'bank'
          AND ah.user_id = $1
        ORDER BY wr.created_at ASC
        FOR UPDATE OF wr`,
      [agentUserId]
    );
    return rows.map(mapWithdrawRow);
  }
}
