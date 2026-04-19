// PR-B7 (BIN-675) — pre-auth route dispatcher.
//
// LoginPage, RegisterPage, ForgotPasswordPage and ResetPasswordPage render
// WITHOUT a session (before bootstrapAuth returns "authenticated"). This
// dispatcher lets main.ts branch on hash alone, keeping bootstrap.ts free of
// per-page plumbing.

import { renderLoginPage } from "./LoginPage.js";
import { renderForgotPasswordPage } from "./ForgotPasswordPage.js";
import { renderRegisterPage } from "./RegisterPage.js";
import { renderResetPasswordPage } from "./ResetPasswordPage.js";

export type PreAuthRoute =
  | { kind: "login" }
  | { kind: "register" }
  | { kind: "forgot-password" }
  | { kind: "reset-password"; token: string };

/**
 * Parse the current hash-path into a pre-auth route descriptor. Returns
 * `null` if the hash does not correspond to a pre-auth page (caller should
 * fall back to LoginPage, which is the default for unauthenticated state).
 */
export function parsePreAuthRoute(hash: string): PreAuthRoute | null {
  const stripped = (hash.replace(/^#\/?/, "").replace(/^\/+/, "").split("?")[0] ?? "");
  if (stripped === "" || stripped === "login") return { kind: "login" };
  if (stripped === "register") return { kind: "register" };
  if (stripped === "forgot-password") return { kind: "forgot-password" };
  const resetMatch = stripped.match(/^reset-password\/(.+)$/);
  if (resetMatch) {
    return { kind: "reset-password", token: decodeURIComponent(resetMatch[1]!) };
  }
  return null;
}

export interface PreAuthMountOptions {
  /** Invoked after successful login/register — main.ts should mount the shell. */
  onAuthenticated: () => void;
}

/**
 * Mount the correct pre-auth page based on the current hash. Returns the
 * kind that was mounted so callers can log/telemetry if needed.
 */
export function mountPreAuthRoute(
  root: HTMLElement,
  hash: string,
  options: PreAuthMountOptions
): PreAuthRoute["kind"] {
  const route = parsePreAuthRoute(hash) ?? { kind: "login" as const };
  switch (route.kind) {
    case "login":
      renderLoginPage(root, options.onAuthenticated);
      return "login";
    case "register":
      renderRegisterPage(root, options.onAuthenticated);
      return "register";
    case "forgot-password":
      renderForgotPasswordPage(root);
      return "forgot-password";
    case "reset-password":
      renderResetPasswordPage(root, route.token);
      return "reset-password";
  }
}

export { renderLoginPage, renderForgotPasswordPage, renderRegisterPage, renderResetPasswordPage };
