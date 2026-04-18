/**
 * BIN-588: template registry.
 *
 * Central lookup for all transactional e-mail templates. Each template
 * is identified by a stable key (e.g. "verify-email") and ships with
 * HTML and plain-text bodies plus a Norwegian default subject.
 */

import {
  VERIFY_EMAIL_HTML,
  VERIFY_EMAIL_SUBJECT,
  VERIFY_EMAIL_TEXT,
} from "./verify-email.js";
import {
  RESET_PASSWORD_HTML,
  RESET_PASSWORD_SUBJECT,
  RESET_PASSWORD_TEXT,
} from "./reset-password.js";
import {
  BANKID_EXPIRY_HTML,
  BANKID_EXPIRY_SUBJECT,
  BANKID_EXPIRY_TEXT,
} from "./bankid-expiry-reminder.js";

export type TemplateKey =
  | "verify-email"
  | "reset-password"
  | "bankid-expiry-reminder";

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export const EMAIL_TEMPLATES: Record<TemplateKey, EmailTemplate> = {
  "verify-email": {
    subject: VERIFY_EMAIL_SUBJECT,
    html: VERIFY_EMAIL_HTML,
    text: VERIFY_EMAIL_TEXT,
  },
  "reset-password": {
    subject: RESET_PASSWORD_SUBJECT,
    html: RESET_PASSWORD_HTML,
    text: RESET_PASSWORD_TEXT,
  },
  "bankid-expiry-reminder": {
    subject: BANKID_EXPIRY_SUBJECT,
    html: BANKID_EXPIRY_HTML,
    text: BANKID_EXPIRY_TEXT,
  },
};

export { renderTemplate } from "./template.js";
export type { TemplateContext } from "./template.js";
