/**
 * BIN-702: fire-and-forget e-post-kø med automatisk retry.
 *
 * Problem: moderasjons-handlinger (KYC-approve/reject) sender e-post
 * best-effort — hvis SMTP-server er midlertidig nede forsvinner
 * meldingen. Legacy Spillorama hadde en enkel job-kø som retried med
 * exponential backoff; dette er samme mønster i ny stack.
 *
 * Design:
 * - In-memory kø (samme pattern som `InMemoryAuditLogStore`).
 * - Hver oppføring har en status: `pending | sent | failed | dead`.
 * - `enqueue()` returnerer umiddelbart, så endepunktet aldri blokkerer.
 * - `processNext()` sender neste pending-oppføring. Ved feil inkrementeres
 *   attemptCount og nextAttemptAt settes framover (exponential backoff).
 *   Etter `maxAttempts` forsøk markeres den som `dead` og logges tydelig
 *   slik at ops-teamet kan plukke den opp manuelt.
 * - `runLoop()` starter en enkel intervall-drevet worker som spiser køen.
 *
 * Tests bruker direkte `enqueue()` + `processNext()` slik at de ikke er
 * avhengige av setInterval. Produksjon bruker `runLoop()` fra `index.ts`.
 *
 * DB-persistering (BIN-703, senere): holde samme interface, men bytte
 * `InMemoryEmailQueueStore` med `PostgresEmailQueueStore`. Da overlever
 * kø-oppføringer restart. Inntil videre er det akseptabelt at kø tapes
 * ved restart — e-post er idempotent i semantikk og admin kan uansett
 * re-trigge KYC-mail manuelt via "Resend email"-knapp (BIN-704, senere).
 */

import { logger as rootLogger } from "../util/logger.js";
import type {
  EmailService,
  SendTemplateInput,
  SendEmailResult,
} from "./EmailService.js";

const logger = rootLogger.child({ module: "email-queue" });

export type EmailQueueStatus = "pending" | "sent" | "failed" | "dead";

export interface EmailQueueEntry {
  id: string;
  /** Destination address. */
  to: string;
  /** Template key (see integration/templates/index.ts). */
  template: SendTemplateInput["template"];
  context: SendTemplateInput["context"];
  subject?: string;
  from?: string;
  status: EmailQueueStatus;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  /** ISO timestamp when this entry is eligible for next send attempt. */
  nextAttemptAt: string;
  /** Set when status becomes sent/dead. */
  completedAt: string | null;
}

export interface EmailQueueStore {
  append(entry: EmailQueueEntry): Promise<void>;
  listPending(nowIso: string, limit: number): Promise<EmailQueueEntry[]>;
  update(id: string, patch: Partial<EmailQueueEntry>): Promise<void>;
  list(filter?: { status?: EmailQueueStatus }): Promise<EmailQueueEntry[]>;
}

export class InMemoryEmailQueueStore implements EmailQueueStore {
  private readonly entries: EmailQueueEntry[] = [];

  async append(entry: EmailQueueEntry): Promise<void> {
    this.entries.push({ ...entry });
  }

  async listPending(nowIso: string, limit: number): Promise<EmailQueueEntry[]> {
    return this.entries
      .filter((e) => e.status === "pending" && e.nextAttemptAt <= nowIso)
      .slice(0, limit)
      .map((e) => ({ ...e }));
  }

  async update(id: string, patch: Partial<EmailQueueEntry>): Promise<void> {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return;
    this.entries[idx] = { ...this.entries[idx]!, ...patch };
  }

  async list(filter: { status?: EmailQueueStatus } = {}): Promise<EmailQueueEntry[]> {
    return this.entries
      .filter((e) => (filter.status ? e.status === filter.status : true))
      .map((e) => ({ ...e }));
  }
}

export interface EmailQueueOptions {
  emailService: EmailService;
  store?: EmailQueueStore;
  /** Max number of send attempts before an entry is marked `dead`. Default 5. */
  maxAttempts?: number;
  /** Base backoff in ms. Default 1000 (1s). Actual delay is base * 2^(attempt-1). */
  backoffBaseMs?: number;
  /** Seam for deterministic tests. */
  now?: () => Date;
  /** Seam for deterministic test IDs. */
  nextId?: () => string;
}

export class EmailQueue {
  private readonly store: EmailQueueStore;
  private readonly emailService: EmailService;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly now: () => Date;
  private readonly nextId: () => string;
  private idCounter = 1;
  private loopHandle: ReturnType<typeof setInterval> | null = null;

  constructor(opts: EmailQueueOptions) {
    this.store = opts.store ?? new InMemoryEmailQueueStore();
    this.emailService = opts.emailService;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.backoffBaseMs = opts.backoffBaseMs ?? 1000;
    this.now = opts.now ?? (() => new Date());
    this.nextId = opts.nextId ?? (() => `mq-${this.idCounter++}`);
  }

  /**
   * Legg en template-e-post i kø. Returnerer id'en slik at kaller kan
   * korrelere senere (f.eks. audit-log).
   */
  async enqueue(input: {
    to: string;
    template: SendTemplateInput["template"];
    context: SendTemplateInput["context"];
    subject?: string;
    from?: string;
  }): Promise<string> {
    const nowIso = this.now().toISOString();
    const id = this.nextId();
    const entry: EmailQueueEntry = {
      id,
      to: input.to,
      template: input.template,
      context: { ...input.context },
      subject: input.subject,
      from: input.from,
      status: "pending",
      attemptCount: 0,
      lastError: null,
      createdAt: nowIso,
      nextAttemptAt: nowIso,
      completedAt: null,
    };
    await this.store.append(entry);
    return id;
  }

  /**
   * Prøv å sende én pending-oppføring. Returnerer `sent` hvis noe gikk
   * ut, `failed` hvis transport feilet (og entry er reschedulert),
   * `dead` hvis maks forsøk er nådd, `idle` hvis ingen pending.
   *
   * Brukt direkte i tester (ingen setInterval-polling).
   */
  async processNext(): Promise<
    | { result: "idle" }
    | { result: "sent"; id: string; messageId: string | null }
    | { result: "failed"; id: string; attempt: number; nextAttemptAt: string; error: string }
    | { result: "dead"; id: string; error: string }
  > {
    const nowIso = this.now().toISOString();
    const pending = await this.store.listPending(nowIso, 1);
    const entry = pending[0];
    if (!entry) return { result: "idle" };

    const attempt = entry.attemptCount + 1;
    let sendResult: SendEmailResult;
    try {
      sendResult = await this.emailService.sendTemplate({
        to: entry.to,
        template: entry.template,
        context: entry.context,
        subject: entry.subject,
        from: entry.from,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (attempt >= this.maxAttempts) {
        await this.store.update(entry.id, {
          status: "dead",
          attemptCount: attempt,
          lastError: errorMessage,
          completedAt: nowIso,
        });
        logger.error(
          { id: entry.id, to: entry.to, template: entry.template, attempts: attempt, err },
          "[BIN-702] e-post-kø: dead etter maks forsøk"
        );
        return { result: "dead", id: entry.id, error: errorMessage };
      }
      const backoffMs = this.backoffBaseMs * Math.pow(2, attempt - 1);
      const nextAttemptAt = new Date(this.now().getTime() + backoffMs).toISOString();
      await this.store.update(entry.id, {
        attemptCount: attempt,
        lastError: errorMessage,
        nextAttemptAt,
      });
      logger.warn(
        { id: entry.id, to: entry.to, template: entry.template, attempt, err },
        "[BIN-702] e-post-kø: forsøk feilet, reschedulerer"
      );
      return {
        result: "failed",
        id: entry.id,
        attempt,
        nextAttemptAt,
        error: errorMessage,
      };
    }

    // sendEmail kan returnere `skipped: true` (SMTP_HOST unset). Behandles
    // som suksess — vi har levert så langt dev-miljøet tillater, og vi skal
    // IKKE retrye (det blir bare mer støy i loggen).
    await this.store.update(entry.id, {
      status: "sent",
      attemptCount: attempt,
      lastError: null,
      completedAt: nowIso,
    });
    return {
      result: "sent",
      id: entry.id,
      messageId: sendResult.messageId,
    };
  }

  /**
   * Start en enkel intervall-worker. Hvert tick prøver én pending. Stopp
   * med `stop()` før shutdown slik at tester ikke lekker timere.
   */
  runLoop(intervalMs = 1000): void {
    if (this.loopHandle) return;
    this.loopHandle = setInterval(() => {
      void this.processNext().catch((err) => {
        logger.error({ err }, "[BIN-702] e-post-kø loop: uventet feil");
      });
    }, intervalMs);
    // Unref so this doesn't keep the node process alive in tests.
    if (typeof this.loopHandle === "object" && this.loopHandle && "unref" in this.loopHandle) {
      (this.loopHandle as unknown as { unref: () => void }).unref();
    }
  }

  stop(): void {
    if (this.loopHandle) {
      clearInterval(this.loopHandle);
      this.loopHandle = null;
    }
  }

  /** Exposed for admin/ops dashboards + tests. */
  async list(filter: { status?: EmailQueueStatus } = {}): Promise<EmailQueueEntry[]> {
    return this.store.list(filter);
  }
}
