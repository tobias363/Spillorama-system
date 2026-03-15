import { describe, expect, it } from "vitest";
import { resolveAppView } from "@/app/App";
import { resolveBonusTestMode } from "@/features/theme1/components/Theme1GameShell";

describe("resolveAppView", () => {
  it("returns the game shell for the root path", () => {
    expect(resolveAppView("/")).toBe("game");
  });

  it("returns the animation lab for supported lab paths", () => {
    expect(resolveAppView("/animation-lab")).toBe("animation-lab");
    expect(resolveAppView("/animation-lab/")).toBe("animation-lab");
    expect(resolveAppView("/animasjon-lab")).toBe("animation-lab");
  });

  it("falls back to the game shell for unknown paths", () => {
    expect(resolveAppView("/ukjent-side")).toBe("game");
  });
});

describe("resolveBonusTestMode", () => {
  it("returns the requested bonus test mode from the query string", () => {
    expect(resolveBonusTestMode("?bonusTest=random")).toBe("random");
    expect(resolveBonusTestMode("?bonusTest=win")).toBe("win");
    expect(resolveBonusTestMode("?foo=bar&bonusTest=WIN")).toBe("win");
  });

  it("returns null for unsupported or missing bonus test values", () => {
    expect(resolveBonusTestMode("")).toBeNull();
    expect(resolveBonusTestMode("?bonusTest=unknown")).toBeNull();
  });
});
