/**
 * TicketGroup BIN-608 tests — outer container BG maps to Unity's
 * Large_BG_Color, not cardBg, and honors `largeBgAlpha`.
 *
 * Unity refs:
 *   - Large_BG:            Game1ViewPurchaseElvisTicket.cs:23
 *   - TicketColorManager:  TicketColorManager.cs:9
 */
import { describe, it, expect } from "vitest";
import type { Ticket } from "@spillorama/shared-types/game";
import { TicketGroup } from "./TicketGroup.js";
import { TICKET_THEMES } from "../colors/TicketColorThemes.js";

function makeTicket(): Ticket {
  return {
    grid: [
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
      [11, 12, 13, 14, 15],
    ],
  };
}

/** Pull the single outer-cardBg fill instruction (if any). */
function outerBgFill(group: TicketGroup): { color: number; alpha: number } | null {
  // TicketGroup stores cardBg as the first child graphics — grab it by
  // reflecting via the instance, since it's private. We read from the
  // shared children order: cardBg is the first Graphics added.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cardBg = (group as any).cardBg as { context: { instructions: Array<{ action: string; data: { style?: { color?: number; alpha?: number } | number } }> } };
  const fills = cardBg.context.instructions.filter((i) => i.action === "fill");
  if (fills.length === 0) return null;
  const style = fills[0].data.style;
  if (typeof style === "number") return { color: style, alpha: 1 };
  if (style && typeof style === "object") {
    return { color: style.color ?? 0, alpha: style.alpha ?? 1 };
  }
  return null;
}

describe("TicketGroup — BIN-608 outer BG uses largeBg (not cardBg)", () => {
  it("large_yellow theme fills outer BG with 0xffffaf (Unity Large_BG)", () => {
    const theme = TICKET_THEMES.find((t) => t.name === "large_yellow")!;
    expect(theme.largeBg).toBe(0xffffaf);
    expect(theme.largeBgAlpha).toBe(1);

    const group = new TicketGroup({
      variant: "large",
      tickets: [makeTicket(), makeTicket(), makeTicket()],
      groupName: "Large Yellow",
      price: 60,
      sharedTheme: theme,
      miniThemes: [theme, theme, theme],
      gridSize: "3x5",
    });

    const fill = outerBgFill(group);
    expect(fill).not.toBeNull();
    expect(fill!.color).toBe(0xffffaf);
    expect(fill!.alpha).toBe(1);

    group.destroy({ children: true });
  });

  it("themes with largeBgAlpha === 0 render NO outer container fill", () => {
    // Small Yellow / Small White / Large White all use alpha=0 (transparent,
    // no container). Pick yellow.
    const theme = TICKET_THEMES.find((t) => t.name === "yellow")!;
    expect(theme.largeBgAlpha).toBe(0);

    const group = new TicketGroup({
      variant: "large",
      tickets: [makeTicket(), makeTicket(), makeTicket()],
      groupName: "Yellow",
      price: 60,
      sharedTheme: theme,
      miniThemes: [theme, theme, theme],
      gridSize: "3x5",
    });

    const fill = outerBgFill(group);
    expect(fill).toBeNull();

    group.destroy({ children: true });
  });
});

describe("TicketGroup — stopAllAnimations delegates to every mini-ticket", () => {
  it("exists and is callable", () => {
    const theme = TICKET_THEMES[0];
    const group = new TicketGroup({
      variant: "large",
      tickets: [makeTicket(), makeTicket(), makeTicket()],
      groupName: "Default",
      price: 60,
      sharedTheme: theme,
      miniThemes: [theme, theme, theme],
      gridSize: "3x5",
    });

    // Should not throw on an idle group.
    expect(() => group.stopAllAnimations()).not.toThrow();

    group.destroy({ children: true });
  });
});
