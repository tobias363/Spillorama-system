/**
 * Tester for featureFlags-helperen.
 *
 * Status 2026-05-08: ingen aktive feature-flags. Helperen beholdes som
 * infrastruktur for fremtidig bruk; testene verifiserer at default-
 * adferd og localStorage-håndtering fortsatt er korrekt for når et nytt
 * flag legges til. Bruker en lokal `TEST_FLAG`-konstant siden
 * `FeatureFlag`-typen er `never` mens listen er tom.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getAllFeatureFlags,
  isFeatureEnabled,
  setFeatureFlag,
} from "../src/utils/featureFlags.js";

// `FeatureFlag` er for tiden `never` siden ingen flagger er registrert.
// Cast'er en placeholder-streng for å verifisere at runtime-helpers
// fortsatt fungerer for vilkårlige strenge keys (default = false).
const TEST_FLAG = "useNewGamePlan" as never;

describe("featureFlags helper", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("default er false når ingen verdi er lagret", () => {
    expect(isFeatureEnabled(TEST_FLAG)).toBe(false);
  });

  it("setFeatureFlag(true) → isFeatureEnabled returnerer true", () => {
    expect(setFeatureFlag(TEST_FLAG, true)).toBe(true);
    expect(isFeatureEnabled(TEST_FLAG)).toBe(true);
  });

  it("setFeatureFlag(false) → isFeatureEnabled returnerer false", () => {
    setFeatureFlag(TEST_FLAG, true);
    expect(isFeatureEnabled(TEST_FLAG)).toBe(true);
    setFeatureFlag(TEST_FLAG, false);
    expect(isFeatureEnabled(TEST_FLAG)).toBe(false);
  });

  it("getAllFeatureFlags er tomt objekt når ingen flagger er registrert", () => {
    setFeatureFlag(TEST_FLAG, true);
    const all = getAllFeatureFlags();
    expect(Object.keys(all)).toEqual([]);
  });

  it("verdier andre enn 'true' tolkes som false", () => {
    window.localStorage.setItem("ff:useNewGamePlan", "yes");
    expect(isFeatureEnabled(TEST_FLAG)).toBe(false);
    window.localStorage.setItem("ff:useNewGamePlan", "1");
    expect(isFeatureEnabled(TEST_FLAG)).toBe(false);
    window.localStorage.setItem("ff:useNewGamePlan", "true");
    expect(isFeatureEnabled(TEST_FLAG)).toBe(true);
  });
});
