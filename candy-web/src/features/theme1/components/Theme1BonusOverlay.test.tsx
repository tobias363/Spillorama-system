import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTheme1BonusRound, selectTheme1BonusSlot } from "@/domain/theme1/theme1Bonus";
import { Theme1BonusOverlay } from "@/features/theme1/components/Theme1BonusOverlay";

describe("Theme1BonusOverlay", () => {
  it("renders 9 bonus fields for an open round", () => {
    const bonus = createTheme1BonusRound({
      shuffledSymbolIds: [
        "asset-19",
        "asset-19",
        "asset-19",
        "asset-8",
        "asset-8",
        "asset-8",
        "asset-4",
        "asset-4",
        "asset-4",
      ],
    });

    const markup = renderToStaticMarkup(
      <Theme1BonusOverlay
        bonus={bonus}
        onSelectSlot={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(markup.match(/bonus-overlay__slot-index/g)).toHaveLength(9);
    expect(markup).toContain("bonus-overlay__brand-image");
    expect(markup).toContain("Premieoversikt for bonusspill");
  });

  it("shows 3 revealed cards after the third matching pick", () => {
    const openBonus = createTheme1BonusRound({
      shuffledSymbolIds: [
        "asset-6",
        "asset-19",
        "asset-19",
        "asset-6",
        "asset-8",
        "asset-19",
        "asset-6",
        "asset-8",
        "asset-8",
      ],
    });

    const resolvedBonus = selectTheme1BonusSlot(
      selectTheme1BonusSlot(selectTheme1BonusSlot(openBonus, "bonus-slot-2"), "bonus-slot-3"),
      "bonus-slot-6",
    );
    const markup = renderToStaticMarkup(
      <Theme1BonusOverlay
        bonus={resolvedBonus}
        onSelectSlot={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(markup.match(/bonus-overlay__slot--revealed/g)).toHaveLength(3);
    expect(markup.match(/bonus-overlay__slot-symbol-image/g)).toHaveLength(3);
    expect(markup).toContain("bonus-overlay__result-modal");
    expect(markup).toContain("bonus-overlay__result-amount-image");
    expect(markup).toContain("bonus-overlay__result-triplet-image");
    expect(markup).toContain("Tilbake til spillet");
  });

  it("shows the loss popup when the selected symbols do not match", () => {
    const openBonus = createTheme1BonusRound({
      shuffledSymbolIds: [
        "asset-19",
        "asset-8",
        "asset-7",
        "asset-6",
        "asset-10",
        "asset-9",
        "asset-19",
        "asset-8",
        "asset-7",
      ],
    });

    const resolvedBonus = selectTheme1BonusSlot(
      selectTheme1BonusSlot(selectTheme1BonusSlot(openBonus, "bonus-slot-1"), "bonus-slot-2"),
      "bonus-slot-3",
    );
    const markup = renderToStaticMarkup(
      <Theme1BonusOverlay
        bonus={resolvedBonus}
        onSelectSlot={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("Beklager, Ingen gevinst denne gangen");
    expect(markup).toContain("bonus-overlay__result-button-image");
  });
});
