// PR-B2: BankID admin API.
//
// Backend-støtte: POST /api/admin/players/:id/bankid-reverify returnerer
// `{ user, bankIdSession, bankIdConfigured }`. Hvis `bankIdConfigured === false`
// er BankID-adapter null i miljøet — UI-et viser mock-mode-banner.
//
// Legacy-paritet: iframe-embed for sesjonen (verify.html:245) + egen
// response-landing etter BankID-provider callback (reponse.html).
//
// NB: Selve "start ny sesjon"-triggeren ligger i admin-players.ts som
// `bankIdReverify(id)`. Denne filen kapsler hjelper-typer og URL-builder.

export interface BankIdSession {
  sessionId: string;
  authUrl: string;
}

export interface BankIdStatus {
  bankIdConfigured: boolean;
  session: BankIdSession | null;
}

/**
 * Bygger hash-link til admin-UI BankID-verify-side m/ query-param.
 * Brukes når admin skal åpne sesjon i ny fane (legacy-paritet).
 */
export function buildVerifyHash(sessionId: string, authUrl: string): string {
  const qs = new URLSearchParams({ sessionId, authUrl });
  return `#/bankid/verify?${qs}`;
}

/** Bygger hash-link til BankID-response-side etter provider callback. */
export function buildResponseHash(status: "success" | "error" | "pending", message?: string): string {
  const qs = new URLSearchParams({ status });
  if (message) qs.set("message", message);
  return `#/bankid/response?${qs}`;
}
