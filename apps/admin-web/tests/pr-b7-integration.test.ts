import { describe, it, expect } from "vitest";
import noDict from "../src/i18n/no.json";
import enDict from "../src/i18n/en.json";
import { parsePreAuthRoute, mountPreAuthRoute } from "../src/pages/login/index.js";

// PR-B7 (BIN-675) — integration surface for the pre-auth flow.
//
// These assertions guard the wiring that can regress silently between the
// four pre-auth pages (Login / Register / ForgotPassword / ResetPassword),
// the dispatcher in src/pages/login/index.ts, and the bilingual i18n
// catalogue. Unit tests cover each page in isolation; this file verifies
// they integrate.

const PR_B7_I18N_KEYS = [
  "email_required",
  "forgot_password_heading",
  "forgot_password_subtitle",
  "forgot_password_send",
  "forgot_password_back_to_login",
  "forgot_password_sent_generic",
  "forgot_password_error",
  "register_heading",
  "register_subtitle",
  "register_first_name",
  "register_surname",
  "register_birth_date",
  "register_phone",
  "register_password_hint",
  "register_submit",
  "register_error_generic",
  "register_email_exists",
  "register_age_restricted",
  "register_password_too_weak",
  "reset_password_heading",
  "reset_password_subtitle",
  "reset_password_new",
  "reset_password_confirm",
  "reset_password_submit",
  "reset_password_mismatch",
  "reset_password_token_invalid",
  "reset_password_validating",
  "reset_password_success_heading",
  "reset_password_success_body",
  "reset_password_success_cta",
  "reset_password_error",
];

describe("PR-B7 integration — i18n coverage", () => {
  it("all PR-B7 keys exist in Norwegian catalogue", () => {
    const dict = noDict as Record<string, string>;
    for (const k of PR_B7_I18N_KEYS) {
      expect(dict[k], `missing NO key: ${k}`).toBeTruthy();
    }
  });

  it("all PR-B7 keys exist in English catalogue", () => {
    const dict = enDict as Record<string, string>;
    for (const k of PR_B7_I18N_KEYS) {
      expect(dict[k], `missing EN key: ${k}`).toBeTruthy();
    }
  });

  it("no i18n key is identical between NO and EN (catches copy-paste)", () => {
    const no = noDict as Record<string, string>;
    const en = enDict as Record<string, string>;
    // A handful of strings (short tech terms) are legitimately identical;
    // at minimum the multi-word headings should differ.
    const multiWordKeys = [
      "forgot_password_heading",
      "forgot_password_subtitle",
      "forgot_password_sent_generic",
      "register_heading",
      "register_subtitle",
      "reset_password_subtitle",
      "reset_password_success_body",
    ];
    for (const k of multiWordKeys) {
      expect(no[k], `missing ${k}`).toBeTruthy();
      expect(en[k], `missing ${k}`).toBeTruthy();
      expect(no[k]).not.toBe(en[k]);
    }
  });
});

describe("PR-B7 integration — dispatcher routing", () => {
  it("parses every supported pre-auth hash", () => {
    expect(parsePreAuthRoute("#/login")?.kind).toBe("login");
    expect(parsePreAuthRoute("#/register")?.kind).toBe("register");
    expect(parsePreAuthRoute("#/forgot-password")?.kind).toBe("forgot-password");
    expect(parsePreAuthRoute("#/reset-password/abc")?.kind).toBe("reset-password");
    // Empty hash falls through to login (fresh-bootstrap path).
    expect(parsePreAuthRoute("")?.kind).toBe("login");
  });

  it("mountPreAuthRoute('') renders login without throwing", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const kind = mountPreAuthRoute(root, "", { onAuthenticated: () => {} });
    expect(kind).toBe("login");
    expect(root.querySelector("#loginForm")).toBeTruthy();
    document.body.removeChild(root);
  });

  it("mountPreAuthRoute('#/register') renders the register form", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const kind = mountPreAuthRoute(root, "#/register", { onAuthenticated: () => {} });
    expect(kind).toBe("register");
    expect(root.querySelector("#registerForm")).toBeTruthy();
    document.body.removeChild(root);
  });

  it("mountPreAuthRoute('#/forgot-password') renders the forgot-password form", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const kind = mountPreAuthRoute(root, "#/forgot-password", { onAuthenticated: () => {} });
    expect(kind).toBe("forgot-password");
    expect(root.querySelector("#forgotForm")).toBeTruthy();
    document.body.removeChild(root);
  });

  it("mountPreAuthRoute('#/reset-password/:token') enters validating state", () => {
    // Keep fetch pending so we stay in the initial state deterministically.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
    const root = document.createElement("div");
    document.body.appendChild(root);
    const kind = mountPreAuthRoute(root, "#/reset-password/xyz", { onAuthenticated: () => {} });
    expect(kind).toBe("reset-password");
    expect(root.querySelector("[data-reset-state='validating']")).toBeTruthy();
    globalThis.fetch = originalFetch;
    document.body.removeChild(root);
  });

  it("unknown hashes fall through to login (safe default)", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const kind = mountPreAuthRoute(root, "#/admin", { onAuthenticated: () => {} });
    expect(kind).toBe("login");
    document.body.removeChild(root);
  });
});

describe("PR-B7 integration — login page still has no register link", () => {
  it("the existing login page does not link to #/register (PM directive)", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountPreAuthRoute(root, "#/login", { onAuthenticated: () => {} });
    // We explicitly DO NOT want a "Registrer her" link — reachable only
    // via direct URL. See PR-B7 plan §2 "Register-siden: player-signup".
    expect(root.querySelector("a[href='#/register']")).toBeFalsy();
    // Forgot-password link MUST still be there (it was on the legacy page).
    expect(root.querySelector("a[href='#/forgot-password']")).toBeTruthy();
    document.body.removeChild(root);
  });
});
