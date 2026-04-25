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
import {
  ROLE_CHANGED_HTML,
  ROLE_CHANGED_SUBJECT,
  ROLE_CHANGED_TEXT,
} from "./role-changed.js";
import {
  KYC_APPROVED_HTML,
  KYC_APPROVED_SUBJECT,
  KYC_APPROVED_TEXT,
} from "./kyc-approved.js";
import {
  KYC_REJECTED_HTML,
  KYC_REJECTED_SUBJECT,
  KYC_REJECTED_TEXT,
} from "./kyc-rejected.js";
import {
  KYC_IMPORTED_WELCOME_HTML,
  KYC_IMPORTED_WELCOME_SUBJECT,
  KYC_IMPORTED_WELCOME_TEXT,
} from "./kyc-imported-welcome.js";

export type TemplateKey =
  | "verify-email"
  | "reset-password"
  | "bankid-expiry-reminder"
  | "role-changed"
  | "kyc-approved"
  | "kyc-rejected"
  | "kyc-imported-welcome";

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
  "role-changed": {
    subject: ROLE_CHANGED_SUBJECT,
    html: ROLE_CHANGED_HTML,
    text: ROLE_CHANGED_TEXT,
  },
  "kyc-approved": {
    subject: KYC_APPROVED_SUBJECT,
    html: KYC_APPROVED_HTML,
    text: KYC_APPROVED_TEXT,
  },
  "kyc-rejected": {
    subject: KYC_REJECTED_SUBJECT,
    html: KYC_REJECTED_HTML,
    text: KYC_REJECTED_TEXT,
  },
  "kyc-imported-welcome": {
    subject: KYC_IMPORTED_WELCOME_SUBJECT,
    html: KYC_IMPORTED_WELCOME_HTML,
    text: KYC_IMPORTED_WELCOME_TEXT,
  },
};

export { renderTemplate } from "./template.js";
export type { TemplateContext } from "./template.js";
