/**
 * BIN-FCM: push-notification-templates.
 *
 * Småtte register av title/body-maler per notification-type. Bruker samme
 * lille template-motor som EmailService (`{{var}}`, `{{#if var}}...{{/if}}`).
 *
 * Push-notifikasjoner er mye enklere enn e-post — ingen HTML, ingen
 * multi-språk-støtte i pilot. Templates er her for å dele format-strenger
 * mellom cron-job (game-start), admin-broadcast, og payments-webhooks.
 */

import { renderTemplate, type TemplateContext } from "../../integration/templates/template.js";
import type { NotificationType } from "../types.js";

export interface PushTemplate {
  title: string;
  body: string;
}

/**
 * Templates keyed by `NotificationType`. Not all notification-types need a
 * template (admin-broadcast uses caller-supplied text); types without an
 * entry are expected to be sent with `FcmPushService.sendToUser` passing
 * explicit title/body.
 */
export const PUSH_TEMPLATES: Partial<Record<NotificationType, PushTemplate>> = {
  "game-start": {
    title: "Spillet starter snart",
    body: "{{gameName}} starter om {{minutesUntilStart}} minutt(er). Logg inn og kjøp bonger!",
  },
  "game-reminder": {
    title: "Spill-påminnelse",
    body: "Glem ikke {{gameName}} i dag kl {{startTime}}.",
  },
  "bonus": {
    title: "Ny bonus tilgjengelig",
    body: "{{description}}",
  },
  "rg-warning": {
    title: "Spillvett",
    body: "{{message}}",
  },
  "deposit-confirmed": {
    title: "Innskudd bekreftet",
    body: "{{amount}} kr er satt inn på kontoen din.",
  },
  "withdraw-confirmed": {
    title: "Uttak bekreftet",
    body: "{{amount}} kr er utbetalt. {{#if note}}{{note}}{{/if}}",
  },
  "kyc-status-change": {
    title: "KYC-status oppdatert",
    body: "Status: {{status}}. {{#if reason}}{{reason}}{{/if}}",
  },
};

/**
 * Render a template to `{ title, body }`. Missing template keys return the
 * raw context.fallback-fields or throw — caller is responsible for choosing
 * a known type.
 */
export function renderPushTemplate(
  type: NotificationType,
  context: TemplateContext,
): PushTemplate {
  const template = PUSH_TEMPLATES[type];
  if (!template) {
    throw new Error(`Ingen template registrert for notification-type "${type}".`);
  }
  return {
    title: renderTemplate(template.title, context),
    body: renderTemplate(template.body, context),
  };
}
