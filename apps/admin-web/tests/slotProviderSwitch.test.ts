import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveSlotProvider,
  requireSlotProvider,
  slotProviderLabel,
} from "../src/components/SlotProviderSwitch.js";
import { initI18n } from "../src/i18n/I18n.js";

describe("SlotProviderSwitch", () => {
  beforeEach(() => {
    initI18n();
    document.body.innerHTML = "";
  });

  it("resolves a valid metronia provider", () => {
    expect(resolveSlotProvider({ id: "h1", slotProvider: "metronia" })).toBe("metronia");
  });

  it("resolves a valid okbingo provider", () => {
    expect(resolveSlotProvider({ id: "h1", slotProvider: "okbingo" })).toBe("okbingo");
  });

  it("returns null for unknown provider string (future-proof)", () => {
    expect(resolveSlotProvider({ id: "h1", slotProvider: "franco" })).toBeNull();
  });

  it("returns null when slotProvider is undefined (current legacy state)", () => {
    expect(resolveSlotProvider({ id: "h1" })).toBeNull();
  });

  it("returns null when hall is null/undefined", () => {
    expect(resolveSlotProvider(null)).toBeNull();
    expect(resolveSlotProvider(undefined)).toBeNull();
  });

  it("require: surfaces a toast on missing provider and returns null", () => {
    const hall = { id: "h1", slotProvider: null };
    const result = requireSlotProvider(hall);
    expect(result).toBeNull();
    // Toast renders into the body
    const toast = document.querySelector(".alert-danger");
    expect(toast).toBeTruthy();
    expect(toast?.textContent).toMatch(/slot-leverandør|slot provider/i);
  });

  it("require: returns the provider without toast when configured", () => {
    const result = requireSlotProvider({ id: "h1", slotProvider: "metronia" });
    expect(result).toBe("metronia");
    expect(document.querySelector(".alert-danger")).toBeFalsy();
  });

  it("label: human-readable names", () => {
    expect(slotProviderLabel("metronia")).toBe("Metronia");
    expect(slotProviderLabel("okbingo")).toBe("OK Bingo");
  });
});
