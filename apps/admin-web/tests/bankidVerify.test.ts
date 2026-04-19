// PR-B2: BankID verify/response pages.

import { describe, it, expect, beforeEach } from "vitest";
import { initI18n } from "../src/i18n/I18n.js";
import { renderBankIdVerifyPage } from "../src/pages/bankid/VerifyPage.js";
import { renderBankIdResponsePage } from "../src/pages/bankid/ResponsePage.js";

describe("BankID verify page", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.location.hash = "";
  });

  it("shows missing-session banner when URL has no params", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    window.location.hash = "#/bankid/verify";
    renderBankIdVerifyPage(root);
    expect(root.textContent).toMatch(/ingen bankid-sesjon/i);
  });

  it("renders iframe when both sessionId and authUrl present", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    window.location.hash =
      "#/bankid/verify?sessionId=s-1&authUrl=https%3A%2F%2Fbankid.example%2Fauth";
    renderBankIdVerifyPage(root);
    const iframe = root.querySelector<HTMLIFrameElement>("iframe");
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute("src")).toContain("bankid.example");
  });

  it("falls back to mock-mode banner for mock: URL (no iframe)", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    window.location.hash =
      "#/bankid/verify?sessionId=s-1&authUrl=mock%3Abankid-provider";
    renderBankIdVerifyPage(root);
    expect(root.querySelector("iframe")).toBeFalsy();
    expect(root.textContent).toMatch(/mock/i);
  });
});

describe("BankID response page", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
    window.location.hash = "";
  });

  it("renders success banner for status=success", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    window.location.hash = "#/bankid/response?status=success";
    renderBankIdResponsePage(root);
    expect(root.textContent).toMatch(/fullført/i);
  });

  it("renders error banner for status=error", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    window.location.hash = "#/bankid/response?status=error";
    renderBankIdResponsePage(root);
    expect(root.textContent).toMatch(/feilet/i);
  });

  it("defaults to pending for unknown status", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    window.location.hash = "#/bankid/response?status=whatever";
    renderBankIdResponsePage(root);
    expect(root.textContent).toMatch(/pågår/i);
  });
});
