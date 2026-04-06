import { describe, expect, it } from "vitest";
import { resolveTheme1CelebrationLeadDelay } from "@/domain/theme1/theme1PresentationSequence";
import { THEME1_DRAW_PRESENTATION_MS } from "@/domain/theme1/theme1MachineAnimation";

describe("resolveTheme1CelebrationLeadDelay", () => {
  it("returns no delay when there is no pending draw", () => {
    expect(
      resolveTheme1CelebrationLeadDelay(null, [
        {
          claimId: "win-1",
          kind: "win",
          title: "Mønster 1",
          subtitle: "Bong nr 1",
          amount: "30 kr",
        },
      ]),
    ).toBe(0);
  });

  it("delays near callouts until after the draw presentation window", () => {
    expect(
      resolveTheme1CelebrationLeadDelay(18, [
        {
          claimId: "near-1",
          kind: "near",
          title: "One to go",
          subtitle: "Mønster 1 • Bong nr 1",
          amount: "Mangler 18",
        },
      ]),
    ).toBe(THEME1_DRAW_PRESENTATION_MS + 120);
  });

  it("gives wins a slightly later delay than near callouts", () => {
    expect(
      resolveTheme1CelebrationLeadDelay(18, [
        {
          claimId: "win-1",
          kind: "win",
          title: "Mønster 1",
          subtitle: "Bong nr 1",
          amount: "30 kr",
        },
      ]),
    ).toBe(THEME1_DRAW_PRESENTATION_MS + 260);
  });

  it("treats round summaries like primary celebrations and delays them after the draw", () => {
    expect(
      resolveTheme1CelebrationLeadDelay(18, [
        {
          claimId: "summary-1",
          kind: "summary",
          title: "Runde ferdig",
          subtitle: "1 vinnende bong",
          amount: "75 kr totalt",
        },
      ]),
    ).toBe(THEME1_DRAW_PRESENTATION_MS + 260);
  });
});
