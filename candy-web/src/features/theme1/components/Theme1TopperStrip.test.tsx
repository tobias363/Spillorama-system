import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Theme1TopperState } from "@/domain/theme1/renderModel";
import { Theme1TopperStrip } from "@/features/theme1/components/Theme1TopperStrip";

describe("Theme1TopperStrip", () => {
  it("renders persistent near/win highlights and transient topper pulses", () => {
    const toppers: Theme1TopperState[] = [
      { id: 1, title: "Mønster 12", prize: "1500 kr", highlighted: true, highlightKind: "win" },
      { id: 2, title: "Mønster 11", prize: "500 kr", highlighted: true, highlightKind: "near" },
    ];

    const markup = renderToStaticMarkup(
      <Theme1TopperStrip toppers={toppers} topperPulses={{ 1: "win", 2: "near" }} />,
    );

    expect(markup).toContain("topper-strip__card topper-strip__card--active topper-strip__card--win topper-strip__card--pulse-win");
    expect(markup).toContain("topper-strip__card topper-strip__card--active topper-strip__card--near topper-strip__card--pulse-near");
  });

  it("renders a blinking missing topper cell for near wins", () => {
    const toppers: Theme1TopperState[] = [
      {
        id: 1,
        title: "Mønster 12",
        prize: "1500 kr",
        highlighted: true,
        highlightKind: "near",
        activePatternIndexes: [0],
        missingCellIndexes: [7],
      },
    ];

    const markup = renderToStaticMarkup(<Theme1TopperStrip toppers={toppers} />);

    expect(markup).toContain("generated-topper__grid-cell generated-topper__grid-cell--missing");
  });

  it("reveals actual row progress on blank-board toppers when active", () => {
    const toppers: Theme1TopperState[] = [
      {
        id: 12,
        title: "Mønster 1",
        prize: "3 kr",
        highlighted: true,
        highlightKind: "near",
        activePatternIndexes: [13],
        missingCellIndexes: [2],
      },
    ];

    const markup = renderToStaticMarkup(<Theme1TopperStrip toppers={toppers} />);

    expect(markup.match(/generated-topper__grid-cell--matched/g)?.length ?? 0).toBe(4);
    expect(markup.match(/generated-topper__grid-cell--missing/g)?.length ?? 0).toBe(1);
    expect(markup.match(/generated-topper__hero-badge/g)?.length ?? 0).toBe(1);
  });
});
