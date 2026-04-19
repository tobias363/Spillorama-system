import { describe, it, expect, beforeEach } from "vitest";
import { initI18n, setLang, getLang, t } from "../src/i18n/I18n.js";

describe("I18n", () => {
  beforeEach(() => {
    window.localStorage.clear();
    initI18n();
  });

  it("defaults to Norwegian", () => {
    expect(getLang()).toBe("no");
  });

  it("translates navigation keys (NO)", () => {
    expect(t("dashboard")).toBe("Dashbord");
    expect(t("player_management")).toBe("Spilleradministrasjon");
    expect(t("wallet_management")).toBe("Lommebokadministrasjon");
  });

  it("switches to English when requested", () => {
    setLang("en");
    expect(getLang()).toBe("en");
    expect(t("dashboard")).toBe("Dashboard");
  });

  it("falls back to English then to key when key is missing", () => {
    setLang("en");
    expect(t("__this_key_does_not_exist__")).toBe("__this_key_does_not_exist__");
  });

  it("substitutes {{params}} templates", () => {
    setLang("en");
    // purchase_limited_ticket has {{number}} in both languages
    const result = t("purchase_limited_ticket", { number: 5 });
    expect(result).toContain("5");
    expect(result).not.toContain("{{number}}");
  });
});
