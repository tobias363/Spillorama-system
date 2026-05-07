/**
 * Fase 3 (2026-05-07): featureFlags helper-tester.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  isFeatureEnabled,
  setFeatureFlag,
  getAllFeatureFlags,
} from "../src/utils/featureFlags.js";

describe("Fase 3 — featureFlags", () => {
  beforeEach(() => {
    // Tøm storage mellom tester.
    window.localStorage.clear();
  });

  it("default er false for ukjent flag", () => {
    expect(isFeatureEnabled("useNewGamePlan")).toBe(false);
  });

  it("setFeatureFlag(true) → isFeatureEnabled returnerer true", () => {
    expect(setFeatureFlag("useNewGamePlan", true)).toBe(true);
    expect(isFeatureEnabled("useNewGamePlan")).toBe(true);
  });

  it("setFeatureFlag(false) → isFeatureEnabled returnerer false", () => {
    setFeatureFlag("useNewGamePlan", true);
    expect(isFeatureEnabled("useNewGamePlan")).toBe(true);
    setFeatureFlag("useNewGamePlan", false);
    expect(isFeatureEnabled("useNewGamePlan")).toBe(false);
  });

  it("getAllFeatureFlags returnerer alle keys", () => {
    setFeatureFlag("useNewGamePlan", true);
    const all = getAllFeatureFlags();
    expect(all.useNewGamePlan).toBe(true);
  });

  it("verdier andre enn 'true' tolkes som false", () => {
    window.localStorage.setItem("ff:useNewGamePlan", "yes");
    expect(isFeatureEnabled("useNewGamePlan")).toBe(false);
    window.localStorage.setItem("ff:useNewGamePlan", "1");
    expect(isFeatureEnabled("useNewGamePlan")).toBe(false);
    window.localStorage.setItem("ff:useNewGamePlan", "true");
    expect(isFeatureEnabled("useNewGamePlan")).toBe(true);
  });
});
