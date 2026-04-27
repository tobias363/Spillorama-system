// REQ-005 / REQ-125: tests for phone PII-masking i admin-grids.

import { describe, expect, it } from "vitest";
import { maskPhoneForGrid, maskEmailForGrid } from "../pii.js";

describe("maskPhoneForGrid (REQ-005/125)", () => {
  it("returnerer em-dash for null/undefined/empty", () => {
    expect(maskPhoneForGrid(null)).toBe("—");
    expect(maskPhoneForGrid(undefined)).toBe("—");
    expect(maskPhoneForGrid("")).toBe("—");
    expect(maskPhoneForGrid("   ")).toBe("—");
  });

  it("masker norsk +47 8-sifret tlf", () => {
    expect(maskPhoneForGrid("+4798765432")).toBe("+47 98** 5432");
    expect(maskPhoneForGrid("+4790123456")).toBe("+47 90** 3456");
  });

  it("strip-er mellomrom før masking", () => {
    expect(maskPhoneForGrid("+47 987 65 432")).toBe("+47 98** 5432");
    expect(maskPhoneForGrid("987 65 432")).toBe("**** 5432");
  });

  it("masker 8-sifret uten landskode", () => {
    expect(maskPhoneForGrid("98765432")).toBe("**** 5432");
  });

  it("returnerer em-dash for ikke-string-input", () => {
    expect(maskPhoneForGrid(98765432 as unknown)).toBe("—");
    expect(maskPhoneForGrid({} as unknown)).toBe("—");
  });

  it("aldri lekker hele nummeret i output", () => {
    const cases = ["+4798765432", "98765432", "+47 987 65 432"];
    for (const c of cases) {
      const masked = maskPhoneForGrid(c);
      // Sjekk at hele 8-sifrede nummeret ikke er i output
      expect(masked).not.toContain("98765432");
      expect(masked).not.toContain("90123456");
    }
  });
});

describe("maskEmailForGrid (REQ-005/125)", () => {
  it("masker normalt domene", () => {
    expect(maskEmailForGrid("tobias@nordic.no")).toBe("t****@nordic.no");
    expect(maskEmailForGrid("admin@firma.com")).toBe("a****@firma.com");
  });

  it("returnerer em-dash for ugyldig input", () => {
    expect(maskEmailForGrid(null)).toBe("—");
    expect(maskEmailForGrid("")).toBe("—");
    expect(maskEmailForGrid("ikke-epost")).toBe("—");
    expect(maskEmailForGrid(123 as unknown)).toBe("—");
  });

  it("kort local-part — ingen masking", () => {
    expect(maskEmailForGrid("a@x.no")).toBe("a@x.no");
  });
});
