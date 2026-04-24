/**
 * BIN-588: EmailService tests.
 *
 * Uses a fake in-memory transporter so tests never hit a real SMTP
 * server. Covers: rendering templates, no-op mode when SMTP_HOST is
 * unset, per-call `from` override, and `previewTemplate` helper.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  EmailService,
  previewTemplate,
  type EmailTransporter,
  type EmailAttachment,
} from "./EmailService.js";

interface CapturedMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

function createFakeTransporter(): { transporter: EmailTransporter; messages: CapturedMessage[] } {
  const messages: CapturedMessage[] = [];
  const transporter: EmailTransporter = {
    async sendMail(msg) {
      messages.push(msg);
      return { messageId: `fake-${messages.length}` };
    },
  };
  return { transporter, messages };
}

test("BIN-588 EmailService: is disabled when SMTP_HOST unset", async () => {
  const svc = new EmailService({ config: null });
  assert.equal(svc.isEnabled(), false);
  const result = await svc.sendEmail({
    to: "a@b.no",
    subject: "s",
    html: "<p>x</p>",
    text: "x",
  });
  assert.equal(result.skipped, true);
  assert.equal(result.messageId, null);
});

test("BIN-588 EmailService: sendEmail forwards to transporter", async () => {
  const { transporter, messages } = createFakeTransporter();
  const svc = new EmailService({
    transporter,
    config: {
      host: "smtp.test",
      port: 587,
      secure: false,
      user: undefined,
      pass: undefined,
      from: "Spillorama <no-reply@spillorama.no>",
      url: undefined,
    },
  });
  const result = await svc.sendEmail({
    to: "kari@example.no",
    subject: "Hei",
    html: "<p>Hei</p>",
    text: "Hei",
  });
  assert.equal(result.skipped, false);
  assert.equal(result.messageId, "fake-1");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].from, "Spillorama <no-reply@spillorama.no>");
  assert.equal(messages[0].to, "kari@example.no");
  assert.equal(messages[0].subject, "Hei");
});

test("BIN-588 EmailService: per-call `from` override wins over config.from", async () => {
  const { transporter, messages } = createFakeTransporter();
  const svc = new EmailService({
    transporter,
    config: {
      host: "smtp.test", port: 587, secure: false, user: undefined, pass: undefined,
      from: "default@spillorama.no", url: undefined,
    },
  });
  await svc.sendEmail({
    to: "a@b.no", subject: "x", html: "x", text: "x",
    from: "support@spillorama.no",
  });
  assert.equal(messages[0].from, "support@spillorama.no");
});

test("BIN-588 EmailService: sendTemplate renders reset-password", async () => {
  const { transporter, messages } = createFakeTransporter();
  const svc = new EmailService({
    transporter,
    config: {
      host: "smtp.test", port: 587, secure: false, user: undefined, pass: undefined,
      from: "no-reply@spillorama.no", url: undefined,
    },
  });
  await svc.sendTemplate({
    to: "kari@example.no",
    template: "reset-password",
    context: {
      username: "Kari",
      resetLink: "https://spillorama.no/reset?token=abc",
      expiresInHours: 1,
      supportEmail: "support@spillorama.no",
    },
  });
  assert.equal(messages.length, 1);
  const msg = messages[0];
  assert.match(msg.subject, /Tilbakestill passordet/);
  assert.match(msg.html, /Hei <strong>Kari<\/strong>/);
  assert.match(msg.html, /href="https:\/\/spillorama\.no\/reset\?token=abc"/);
  assert.match(msg.html, /Lenken utløper om 1 time/);
  assert.match(msg.html, /Kontakt oss på support@spillorama\.no/);
  assert.match(msg.text, /https:\/\/spillorama\.no\/reset\?token=abc/);
});

test("BIN-588 EmailService: sendTemplate renders verify-email without supportEmail block", async () => {
  const { transporter, messages } = createFakeTransporter();
  const svc = new EmailService({
    transporter,
    config: {
      host: "smtp.test", port: 587, secure: false, user: undefined, pass: undefined,
      from: "no-reply@spillorama.no", url: undefined,
    },
  });
  await svc.sendTemplate({
    to: "ny@spiller.no",
    template: "verify-email",
    context: { username: "Ny", verifyLink: "https://spillorama.no/verify?t=xyz" },
  });
  assert.equal(messages.length, 1);
  assert.doesNotMatch(messages[0].html, /Kontakt oss/);
  assert.match(messages[0].html, /Bekreft e-post/);
});

test("BIN-588 EmailService: sendTemplate renders bankid-expiry-reminder", async () => {
  const { transporter, messages } = createFakeTransporter();
  const svc = new EmailService({
    transporter,
    config: {
      host: "smtp.test", port: 587, secure: false, user: undefined, pass: undefined,
      from: "no-reply@spillorama.no", url: undefined,
    },
  });
  await svc.sendTemplate({
    to: "bruker@spillorama.no",
    template: "bankid-expiry-reminder",
    context: {
      username: "Bruker",
      verificationType: "BankID",
      daysRemaining: 7,
      expiryDate: "25.04.2026",
      expiryDateISO: "2026-04-25",
    },
  });
  assert.equal(messages.length, 1);
  assert.match(messages[0].subject, /BankID-verifisering utløper snart/);
  assert.match(messages[0].html, /7 dag\(er\)/);
  assert.match(messages[0].html, /datetime="2026-04-25"/);
  assert.match(messages[0].text, /BankID-verifisering utløper om 7 dag/);
});

test("BIN-588 EmailService: sendTemplate allows subject override", async () => {
  const { transporter, messages } = createFakeTransporter();
  const svc = new EmailService({
    transporter,
    config: {
      host: "smtp.test", port: 587, secure: false, user: undefined, pass: undefined,
      from: "no-reply@spillorama.no", url: undefined,
    },
  });
  await svc.sendTemplate({
    to: "a@b.no",
    template: "verify-email",
    context: { username: "x", verifyLink: "https://x" },
    subject: "Overstyrt tittel",
  });
  assert.equal(messages[0].subject, "Overstyrt tittel");
});

test("BIN-588 previewTemplate: returns subject/html/text triple without sending", () => {
  const out = previewTemplate("reset-password", {
    username: "A",
    resetLink: "https://x",
    expiresInHours: 2,
  });
  assert.ok(out.subject.length > 0);
  assert.match(out.html, /Hei <strong>A<\/strong>/);
  assert.match(out.text, /https:\/\/x/);
  assert.match(out.html, /Lenken utløper om 2 time/);
});

test("EmailService: attachments videresendes til transporter", async () => {
  const { transporter, messages } = createFakeTransporter();
  const svc = new EmailService({
    transporter,
    config: {
      host: "smtp.test", port: 587, secure: false, user: undefined, pass: undefined,
      from: "from@x.no", url: undefined,
    },
  });
  const attachment: EmailAttachment = {
    filename: "test.xml",
    content: "<xml/>",
    contentType: "application/xml",
  };
  await svc.sendEmail({
    to: "a@b.no",
    subject: "Med vedlegg",
    html: "<p>x</p>",
    text: "x",
    attachments: [attachment],
  });
  assert.equal(messages.length, 1);
  assert.ok(messages[0].attachments);
  assert.equal(messages[0].attachments!.length, 1);
  assert.equal(messages[0].attachments![0].filename, "test.xml");
  assert.equal(messages[0].attachments![0].content, "<xml/>");
  assert.equal(messages[0].attachments![0].contentType, "application/xml");
});
