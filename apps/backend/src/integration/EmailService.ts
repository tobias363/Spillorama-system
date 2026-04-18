/**
 * BIN-588: centralised transactional e-mail sender.
 *
 * Wraps nodemailer with a small template registry so callers don't have
 * to assemble HTML bodies themselves. The legacy code base assembled
 * mails inline in controllers; the new backend routes everything through
 * this service so the SMTP config lives in one place and compliance can
 * audit which transactional mails can be sent.
 *
 * Environment variables:
 *   SMTP_HOST      required (e.g. smtp.sendgrid.net)
 *   SMTP_PORT      required (e.g. 587)
 *   SMTP_SECURE    optional (default false; set true for port 465)
 *   SMTP_USER      optional (username for auth)
 *   SMTP_PASS      optional (password for auth)
 *   SMTP_FROM      required ("Spillorama <no-reply@spillorama.no>")
 *   SMTP_URL       optional (takes precedence; full SMTP URL)
 *
 * If SMTP_HOST is unset the service runs in "no-op" mode: sendEmail /
 * sendTemplate log a warning and return a stub result so startup never
 * fails in dev environments that lack SMTP credentials. Production
 * must set the env vars (see render.yaml).
 */

import nodemailer, { type Transporter } from "nodemailer";
import { logger as rootLogger } from "../util/logger.js";
import {
  EMAIL_TEMPLATES,
  renderTemplate,
  type EmailTemplate,
  type TemplateContext,
  type TemplateKey,
} from "./templates/index.js";

const logger = rootLogger.child({ module: "email-service" });

export interface EmailServiceConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | undefined;
  pass: string | undefined;
  from: string;
  url: string | undefined;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
}

export interface SendTemplateInput {
  to: string;
  template: TemplateKey;
  context: TemplateContext;
  /** Override the template's default subject. */
  subject?: string;
  /** Override SMTP_FROM for this single message (admin/support fromAddress). */
  from?: string;
}

export interface SendEmailResult {
  messageId: string | null;
  skipped: boolean;
}

function parseConfigFromEnv(env: NodeJS.ProcessEnv): EmailServiceConfig | null {
  const url = (env.SMTP_URL ?? "").trim();
  const host = (env.SMTP_HOST ?? "").trim();
  const from = (env.SMTP_FROM ?? "").trim();

  if (!url && !host) {
    return null;
  }
  if (!from) {
    logger.warn("[BIN-588] SMTP_HOST/SMTP_URL set but SMTP_FROM missing — e-mail service disabled.");
    return null;
  }

  const portRaw = (env.SMTP_PORT ?? "").trim();
  const port = portRaw ? Number.parseInt(portRaw, 10) : 587;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    logger.warn({ portRaw }, "[BIN-588] SMTP_PORT is invalid — e-mail service disabled.");
    return null;
  }

  const secureRaw = (env.SMTP_SECURE ?? "").trim().toLowerCase();
  const secure = ["1", "true", "yes", "on"].includes(secureRaw) || port === 465;

  const user = (env.SMTP_USER ?? "").trim() || undefined;
  const pass = (env.SMTP_PASS ?? "").trim() || undefined;

  return { host, port, secure, user, pass, from, url: url || undefined };
}

/**
 * The minimal transporter surface we depend on. Kept narrow so tests can
 * swap in a fake without mocking the full nodemailer API.
 */
export interface EmailTransporter {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<{ messageId?: string }>;
}

function createTransporterFromConfig(config: EmailServiceConfig): Transporter {
  if (config.url) {
    return nodemailer.createTransport(config.url);
  }
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass ?? "" } : undefined,
  });
}

export class EmailService {
  private readonly config: EmailServiceConfig | null;
  private readonly transporter: EmailTransporter | null;

  constructor(options?: {
    config?: EmailServiceConfig | null;
    transporter?: EmailTransporter;
    env?: NodeJS.ProcessEnv;
  }) {
    if (options?.transporter) {
      // Explicit transporter → explicit config required (or a stub one).
      this.transporter = options.transporter;
      this.config = options.config ?? {
        host: "test",
        port: 587,
        secure: false,
        user: undefined,
        pass: undefined,
        from: "test@example.com",
        url: undefined,
      };
      return;
    }
    const config = options?.config === undefined
      ? parseConfigFromEnv(options?.env ?? process.env)
      : options.config;
    this.config = config;
    this.transporter = config ? createTransporterFromConfig(config) : null;
  }

  /** True if a real SMTP transporter is wired up. */
  isEnabled(): boolean {
    return this.transporter !== null && this.config !== null;
  }

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    if (!this.transporter || !this.config) {
      logger.warn({ to: input.to, subject: input.subject }, "[BIN-588] e-mail service disabled — message dropped.");
      return { messageId: null, skipped: true };
    }
    const info = await this.transporter.sendMail({
      from: input.from ?? this.config.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return { messageId: info.messageId ?? null, skipped: false };
  }

  async sendTemplate(input: SendTemplateInput): Promise<SendEmailResult> {
    const template = EMAIL_TEMPLATES[input.template];
    const rendered = renderEmailTemplate(template, input.context);
    return this.sendEmail({
      to: input.to,
      subject: input.subject ?? rendered.subject,
      html: rendered.html,
      text: rendered.text,
      from: input.from,
    });
  }
}

/**
 * Render a template into `{ subject, html, text }` without sending. Exposed
 * so tests and jobs can build a preview (e.g. for ops dashboards) without
 * going through the transporter.
 */
export function renderEmailTemplate(
  template: EmailTemplate,
  context: TemplateContext,
): { subject: string; html: string; text: string } {
  return {
    subject: renderTemplate(template.subject, context),
    html: renderTemplate(template.html, context),
    text: renderTemplate(template.text, context),
  };
}

/** Convenience: preview a registered template by key. */
export function previewTemplate(
  key: TemplateKey,
  context: TemplateContext,
): { subject: string; html: string; text: string } {
  return renderEmailTemplate(EMAIL_TEMPLATES[key], context);
}
