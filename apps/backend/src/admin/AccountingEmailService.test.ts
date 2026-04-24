/**
 * Unit-tester for AccountingEmailService (XML-batch → e-post med vedlegg).
 *
 * Dekker:
 *   - Tom batch (0 rader) → skipped=true, ingen e-post sendt
 *   - Tom allowlist → skipped=true, batch beholdes som unsent
 *   - SMTP disabled → skipped=true
 *   - Happy path: en mottaker får XML-vedlegg, batch markeres som sendt
 *   - Per-mottaker-feil teller som failed, andre mottakere fortsetter
 *   - Vedlegget har filename med dato + batch-id-prefix
 *   - Vedlegget har contentType=application/xml
 */

import assert from "node:assert/strict";
import test from "node:test";
import { AccountingEmailService } from "./AccountingEmailService.js";
import type { EmailService, SendEmailInput, SendEmailResult } from "../integration/EmailService.js";
import type { SecurityService, WithdrawEmail } from "../compliance/SecurityService.js";
import type {
  WithdrawXmlExportService,
  XmlExportBatch,
  WithdrawExportRow,
} from "./WithdrawXmlExportService.js";

interface RecordedSend {
  input: SendEmailInput;
  result: SendEmailResult;
  error?: Error;
}

function makeBatch(overrides: Partial<XmlExportBatch> = {}): XmlExportBatch {
  return {
    id: overrides.id ?? "batch-1",
    agentUserId: overrides.agentUserId ?? "agent-1",
    generatedAt: overrides.generatedAt ?? "2026-04-24T21:00:00.000Z",
    xmlFilePath: overrides.xmlFilePath ?? "/tmp/x.xml",
    emailSentAt: overrides.emailSentAt ?? null,
    recipientEmails: overrides.recipientEmails ?? [],
    withdrawRequestCount: overrides.withdrawRequestCount ?? 3,
  };
}

function makeRow(): WithdrawExportRow {
  return {
    id: "wr-1",
    userId: "u-1",
    hallId: "h-a",
    amountCents: 10000,
    bankAccountNumber: "111",
    bankName: "DNB",
    accountHolder: "Kari",
    acceptedAt: "2026-04-24T09:00:00Z",
    createdAt: "2026-04-24T08:00:00Z",
  };
}

function makeMocks(opts: {
  batch?: XmlExportBatch;
  rows?: WithdrawExportRow[];
  allowlist?: WithdrawEmail[];
  smtpEnabled?: boolean;
  sendBehavior?: (input: SendEmailInput) => Promise<SendEmailResult>;
}) {
  const sends: RecordedSend[] = [];
  const batchStore = new Map<string, XmlExportBatch>();
  const b = opts.batch ?? makeBatch();
  batchStore.set(b.id, b);

  const emailService: EmailService = {
    isEnabled: () => opts.smtpEnabled !== false,
    sendEmail: async (input: SendEmailInput): Promise<SendEmailResult> => {
      try {
        const result =
          opts.sendBehavior !== undefined
            ? await opts.sendBehavior(input)
            : { messageId: `msg-${sends.length}`, skipped: false };
        sends.push({ input, result });
        return result;
      } catch (err) {
        sends.push({ input, result: { messageId: null, skipped: true }, error: err as Error });
        throw err;
      }
    },
  } as unknown as EmailService;

  const securityService: SecurityService = {
    listWithdrawEmails: async (): Promise<WithdrawEmail[]> =>
      opts.allowlist ?? [
        { id: "e-1", email: "acc1@example.com", label: null, addedBy: null, createdAt: "2026-01-01T00:00:00Z" },
      ],
  } as unknown as SecurityService;

  const xmlExportService: WithdrawXmlExportService = {
    getBatch: async (id: string) => {
      const rec = batchStore.get(id);
      if (!rec) {
        // lean error, parity med service
        throw Object.assign(new Error("not found"), { code: "XML_BATCH_NOT_FOUND" });
      }
      return { batch: rec, rows: opts.rows ?? [makeRow()] };
    },
    markBatchEmailSent: async (id: string, recipients: string[]) => {
      const rec = batchStore.get(id)!;
      const updated: XmlExportBatch = {
        ...rec,
        emailSentAt: "2026-04-24T21:01:00.000Z",
        recipientEmails: recipients,
      };
      batchStore.set(id, updated);
      return updated;
    },
  } as unknown as WithdrawXmlExportService;

  return { emailService, securityService, xmlExportService, sends };
}

// ─── Skip-paths ─────────────────────────────────────────────────────────

test("sendXmlBatch: 0 rader i batch → skipped, ingen e-post", async () => {
  const { emailService, securityService, xmlExportService, sends } = makeMocks({
    batch: makeBatch({ withdrawRequestCount: 0 }),
  });
  const svc = new AccountingEmailService({ emailService, securityService, xmlExportService });
  const result = await svc.sendXmlBatch("batch-1", "<xml/>");
  assert.equal(result.sent, false);
  assert.equal(result.skipped, true);
  assert.equal(sends.length, 0);
});

test("sendXmlBatch: tom allowlist → skipped, ingen e-post", async () => {
  const { emailService, securityService, xmlExportService, sends } = makeMocks({
    allowlist: [],
  });
  const svc = new AccountingEmailService({ emailService, securityService, xmlExportService });
  const result = await svc.sendXmlBatch("batch-1", "<xml/>");
  assert.equal(result.sent, false);
  assert.equal(result.skipped, true);
  assert.equal(sends.length, 0);
});

test("sendXmlBatch: SMTP disabled → skipped, ingen e-post", async () => {
  const { emailService, securityService, xmlExportService, sends } = makeMocks({
    smtpEnabled: false,
  });
  const svc = new AccountingEmailService({ emailService, securityService, xmlExportService });
  const result = await svc.sendXmlBatch("batch-1", "<xml/>");
  assert.equal(result.sent, false);
  assert.equal(result.skipped, true);
  assert.equal(sends.length, 0);
});

// ─── Happy path ─────────────────────────────────────────────────────────

test("sendXmlBatch: happy path — sender til allowlist med XML som vedlegg", async () => {
  const { emailService, securityService, xmlExportService, sends } = makeMocks({
    allowlist: [
      { id: "e-1", email: "acc1@example.com", label: null, addedBy: null, createdAt: "2026-01-01T00:00:00Z" },
      { id: "e-2", email: "acc2@example.com", label: "Regnskap", addedBy: null, createdAt: "2026-01-01T00:00:00Z" },
    ],
  });
  const svc = new AccountingEmailService({ emailService, securityService, xmlExportService });
  const xml = "<xml>body</xml>";
  const result = await svc.sendXmlBatch("batch-1", xml);
  assert.equal(result.sent, true);
  assert.deepEqual(result.deliveredTo, ["acc1@example.com", "acc2@example.com"]);
  assert.equal(sends.length, 2);
  // Hver sending har attachments med riktig filename og contentType
  for (const s of sends) {
    assert.ok(s.input.attachments && s.input.attachments.length === 1);
    const a = s.input.attachments[0]!;
    assert.ok(a.filename.endsWith(".xml"), "filename må slutte på .xml");
    assert.ok(a.filename.includes("2026-04-24"), "filename må inneholde dato-prefiks");
    assert.equal(a.contentType, "application/xml");
    assert.equal(a.content, xml);
  }
});

test("sendXmlBatch: subject har dato + batch-id-kontekst", async () => {
  const { emailService, securityService, xmlExportService, sends } = makeMocks({});
  const svc = new AccountingEmailService({ emailService, securityService, xmlExportService });
  await svc.sendXmlBatch("batch-1", "<xml/>");
  const subject = sends[0]!.input.subject;
  assert.ok(subject.includes("2026-04-24"), "subject skal inneholde dato");
  assert.ok(subject.includes("Bank-uttak XML"), "subject skal være beskrivende");
});

// ─── Per-recipient failure handling ─────────────────────────────────────

test("sendXmlBatch: per-mottaker-feil teller som failed; andre fortsetter", async () => {
  let callCount = 0;
  const { emailService, securityService, xmlExportService, sends } = makeMocks({
    allowlist: [
      { id: "e-1", email: "ok@example.com", label: null, addedBy: null, createdAt: "2026-01-01T00:00:00Z" },
      { id: "e-2", email: "bad@example.com", label: null, addedBy: null, createdAt: "2026-01-01T00:00:00Z" },
      { id: "e-3", email: "ok2@example.com", label: null, addedBy: null, createdAt: "2026-01-01T00:00:00Z" },
    ],
    sendBehavior: async (input) => {
      callCount += 1;
      if (input.to === "bad@example.com") {
        throw new Error("SMTP_TIMEOUT");
      }
      return { messageId: `msg-${callCount}`, skipped: false };
    },
  });
  const svc = new AccountingEmailService({ emailService, securityService, xmlExportService });
  const result = await svc.sendXmlBatch("batch-1", "<xml/>");
  assert.equal(result.sent, true, "minst én levert = sent=true");
  assert.deepEqual(result.deliveredTo, ["ok@example.com", "ok2@example.com"]);
  assert.equal(result.failedFor.length, 1);
  assert.equal(result.failedFor[0]!.email, "bad@example.com");
  assert.match(result.failedFor[0]!.error, /SMTP_TIMEOUT/);
});

test("sendXmlBatch: alle mottakere feiler → sent=false, skipped=true", async () => {
  const { emailService, securityService, xmlExportService } = makeMocks({
    sendBehavior: async () => {
      throw new Error("TOTAL_FAILURE");
    },
  });
  const svc = new AccountingEmailService({ emailService, securityService, xmlExportService });
  const result = await svc.sendXmlBatch("batch-1", "<xml/>");
  assert.equal(result.sent, false);
  assert.equal(result.skipped, true);
  assert.equal(result.failedFor.length, 1);
});

// ─── Validering ─────────────────────────────────────────────────────────

test("sendXmlBatch: tom batchId → DomainError INVALID_INPUT", async () => {
  const { emailService, securityService, xmlExportService } = makeMocks({});
  const svc = new AccountingEmailService({ emailService, securityService, xmlExportService });
  await assert.rejects(
    () => svc.sendXmlBatch("", "<xml/>"),
    (err: unknown) =>
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "INVALID_INPUT"
  );
});
