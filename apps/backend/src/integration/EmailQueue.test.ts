/**
 * BIN-702: EmailQueue tests.
 *
 * Deterministisk kontroll via `now`-seam og `nextId`-seam. Vi skifter ut
 * EmailService-transporter med en fake som kan kaste feil på kommando,
 * slik at vi kan teste retry-path.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { EmailService, type EmailTransporter } from "./EmailService.js";
import {
  EmailQueue,
  InMemoryEmailQueueStore,
  type EmailQueueEntry,
} from "./EmailQueue.js";

function makeEmailService(opts?: {
  failNext?: () => boolean;
}): { emailService: EmailService; messages: Array<{ to: string; template: string }> } {
  const messages: Array<{ to: string; template: string }> = [];
  const shouldFail = opts?.failNext ?? (() => false);
  const transporter: EmailTransporter = {
    async sendMail(msg) {
      if (shouldFail()) {
        throw new Error("SMTP ECONNREFUSED");
      }
      messages.push({ to: msg.to, template: msg.subject });
      return { messageId: `ok-${messages.length}` };
    },
  };
  const emailService = new EmailService({
    transporter,
    config: {
      host: "smtp.test",
      port: 587,
      secure: false,
      user: undefined,
      pass: undefined,
      from: "no-reply@spillorama.no",
      url: undefined,
    },
  });
  // Overstyr sendTemplate for å ikke bruke templates — enklere sender-stub.
  emailService.sendTemplate = async (input) => {
    const res = await (emailService as unknown as {
      sendEmail: (x: {
        to: string;
        subject: string;
        html: string;
        text: string;
      }) => Promise<{ messageId: string | null; skipped: boolean }>;
    }).sendEmail({
      to: input.to,
      subject: input.template,
      html: "x",
      text: "x",
    });
    return res;
  };
  return { emailService, messages };
}

test("BIN-702 EmailQueue: enqueue + processNext sender og markerer sent", async () => {
  const { emailService, messages } = makeEmailService();
  const store = new InMemoryEmailQueueStore();
  const queue = new EmailQueue({ emailService, store, nextId: () => "id-1" });

  const id = await queue.enqueue({
    to: "a@b.no",
    template: "kyc-approved",
    context: { username: "Alice", supportEmail: "s@x.no" },
  });
  assert.equal(id, "id-1");

  const res = await queue.processNext();
  assert.equal(res.result, "sent");
  assert.equal(messages.length, 1);

  const entries = await queue.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.status, "sent");
  assert.equal(entries[0]!.attemptCount, 1);
  assert.equal(entries[0]!.lastError, null);
});

test("BIN-702 EmailQueue: idle når ingen pending", async () => {
  const { emailService } = makeEmailService();
  const queue = new EmailQueue({ emailService });
  const res = await queue.processNext();
  assert.equal(res.result, "idle");
});

test("BIN-702 EmailQueue: retry på feil med exponential backoff", async () => {
  let failuresLeft = 2;
  const { emailService, messages } = makeEmailService({
    failNext: () => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        return true;
      }
      return false;
    },
  });
  let fakeNow = new Date("2026-04-24T10:00:00.000Z").getTime();
  const queue = new EmailQueue({
    emailService,
    now: () => new Date(fakeNow),
    backoffBaseMs: 1000,
    maxAttempts: 5,
  });

  await queue.enqueue({
    to: "b@x.no",
    template: "kyc-rejected",
    context: { username: "B", reason: "kort", resubmitLink: "x", supportEmail: "s" },
  });

  // 1. forsøk — feiler
  const a1 = await queue.processNext();
  assert.equal(a1.result, "failed");
  if (a1.result === "failed") {
    assert.equal(a1.attempt, 1);
  }

  // Tidspunktet er fortsatt før neste forsøk → idle
  const idle1 = await queue.processNext();
  assert.equal(idle1.result, "idle");

  // Hopper klokken 1.5s fram
  fakeNow += 1500;
  const a2 = await queue.processNext();
  assert.equal(a2.result, "failed");
  if (a2.result === "failed") {
    assert.equal(a2.attempt, 2);
  }

  // Hopper klokken 5s fram (backoff 2^1 = 2000ms, gir rom)
  fakeNow += 5000;
  const a3 = await queue.processNext();
  assert.equal(a3.result, "sent");
  assert.equal(messages.length, 1);

  const all = await queue.list();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.status, "sent");
  assert.equal(all[0]!.attemptCount, 3);
});

test("BIN-702 EmailQueue: markerer dead etter maxAttempts", async () => {
  const { emailService } = makeEmailService({ failNext: () => true });
  let fakeNow = new Date("2026-04-24T10:00:00.000Z").getTime();
  const queue = new EmailQueue({
    emailService,
    maxAttempts: 3,
    backoffBaseMs: 10,
    now: () => new Date(fakeNow),
  });

  await queue.enqueue({
    to: "c@x.no",
    template: "kyc-approved",
    context: { username: "C", supportEmail: "s" },
  });

  for (let i = 0; i < 3; i += 1) {
    const res = await queue.processNext();
    if (i < 2) {
      assert.equal(res.result, "failed");
    } else {
      assert.equal(res.result, "dead");
    }
    // flytt klokken fram forbi backoff
    fakeNow += 100_000;
  }

  const dead = await queue.list({ status: "dead" });
  assert.equal(dead.length, 1);
  assert.equal(dead[0]!.attemptCount, 3);
  assert.match(dead[0]!.lastError!, /ECONNREFUSED/);
});

test("BIN-702 EmailQueue: SMTP disabled (skipped) → markeres som sent", async () => {
  // EmailService uten transporter → skipped path
  const emailService = new EmailService({ config: null });
  const queue = new EmailQueue({ emailService });

  await queue.enqueue({
    to: "d@x.no",
    template: "kyc-approved",
    context: { username: "D", supportEmail: "s" },
  });
  const res = await queue.processNext();
  assert.equal(res.result, "sent");
  if (res.result === "sent") {
    assert.equal(res.messageId, null);
  }

  const sent = await queue.list({ status: "sent" });
  assert.equal(sent.length, 1);
});

test("BIN-702 EmailQueue: respekterer nextAttemptAt — idle før klokka modnes", async () => {
  const { emailService } = makeEmailService({ failNext: () => true });
  let fakeNow = new Date("2026-04-24T10:00:00.000Z").getTime();
  const queue = new EmailQueue({
    emailService,
    backoffBaseMs: 60_000, // 1 min
    maxAttempts: 5,
    now: () => new Date(fakeNow),
  });

  await queue.enqueue({
    to: "e@x.no",
    template: "kyc-approved",
    context: { username: "E", supportEmail: "s" },
  });
  const a1 = await queue.processNext();
  assert.equal(a1.result, "failed");

  // Uten tidshopp skal neste prosess være idle (nextAttemptAt 1 min i framtiden)
  const idle = await queue.processNext();
  assert.equal(idle.result, "idle");
});

test("BIN-702 EmailQueue: list(filter) filtrerer etter status", async () => {
  const { emailService } = makeEmailService();
  const queue = new EmailQueue({ emailService });

  await queue.enqueue({ to: "1@x.no", template: "kyc-approved", context: {} });
  await queue.enqueue({ to: "2@x.no", template: "kyc-approved", context: {} });
  await queue.processNext();

  const pending = await queue.list({ status: "pending" });
  const sent = await queue.list({ status: "sent" });
  assert.equal(pending.length, 1);
  assert.equal(sent.length, 1);
});

test("BIN-702 EmailQueue: entry snapshot er isolert (enqueue endrer ikke input)", async () => {
  const { emailService } = makeEmailService();
  const queue = new EmailQueue({ emailService });

  const ctx = { username: "F", supportEmail: "s" };
  await queue.enqueue({ to: "f@x.no", template: "kyc-approved", context: ctx });
  ctx.username = "mutert";

  const entries = await queue.list();
  const entry = entries[0] as EmailQueueEntry;
  assert.equal(entry.context.username, "F");
});
