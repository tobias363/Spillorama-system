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

/**
 * G5 — per-mini-ticket 1-to-go background blink in grouped mode.
 *
 * Unity reference: PrefabBingoGame1LargeTicket5x5.cs:18 assigns
 *   Mini_Tickets[i].imgTicket.color = color.BG_Color
 * for every mini, so each mini keeps its own tinted BG. The 1-to-go blink
 * (BingoTicket.cs:1020-1033) tweens that per-mini `imgTicket.color`, which
 * means our web-side mini-cards MUST keep their cardBg visible when inside
 * a TicketGroup — previously `setMiniMode()` hid it and the blink was
 * invisible.
 */
describe("TicketGroup — G5 per-mini-ticket 1-to-go blink", () => {
  function makeAlmostDoneTicket(): Ticket {
    // Grid with 14 numbers marked leaves exactly one unmarked → 1-to-go.
    // We use a 3x5 grid (15 cells total).
    return {
      grid: [
        [1, 2, 3, 4, 5],
        [6, 7, 8, 9, 10],
        [11, 12, 13, 14, 15],
      ],
    };
  }

  it("mini-ticket 1-to-go → bgBlinkTween active AND cardBg stays visible", () => {
    const theme = TICKET_THEMES.find((t) => t.name === "large_yellow")!;
    const group = new TicketGroup({
      variant: "large",
      tickets: [makeAlmostDoneTicket(), makeAlmostDoneTicket(), makeAlmostDoneTicket()],
      groupName: "Large Yellow",
      price: 60,
      sharedTheme: theme,
      miniThemes: [theme, theme, theme],
      gridSize: "3x5",
    });

    const mini = group.miniTickets[0];
    // Drive the first mini to a 1-to-go state by marking 14 of its 15 cells.
    // Numbers 1..14 are marked; 15 remains unmarked.
    for (let n = 1; n <= 14; n++) mini.markNumber(n);

    expect(mini.getRemainingCount()).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = mini as any;
    expect(m.bgBlinkTween).not.toBeNull();
    expect(m.cardBg.visible).toBe(true);

    // Tear down tweens before destroy so GSAP's timeline doesn't try to
    // render a null Graphics after the container is gone.
    group.stopAllAnimations();
    group.destroy({ children: true });
  });

  it("stopBgBlink restores per-mini cardBg color without hiding it", () => {
    const theme = TICKET_THEMES.find((t) => t.name === "large_yellow")!;
    const group = new TicketGroup({
      variant: "large",
      tickets: [makeAlmostDoneTicket(), makeAlmostDoneTicket(), makeAlmostDoneTicket()],
      groupName: "Large Yellow",
      price: 60,
      sharedTheme: theme,
      miniThemes: [theme, theme, theme],
      gridSize: "3x5",
    });

    const mini = group.miniTickets[0];
    // Enter 1-to-go (blink on), then mark the last number to go "done" —
    // updateToGo() calls stopBgBlink() as part of the remaining=0 branch.
    for (let n = 1; n <= 14; n++) mini.markNumber(n);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = mini as any;
    expect(m.bgBlinkTween).not.toBeNull();

    mini.markNumber(15);
    expect(mini.getRemainingCount()).toBe(0);
    expect(m.bgBlinkTween).toBeNull();
    // cardBg must remain visible after blink stops (per-mini BG never hides
    // in mini-mode — matches Unity Set_Ticket_Color always-on imgTicket).
    expect(m.cardBg.visible).toBe(true);

    // remaining=0 fires BINGO pulse — cancel it along with any other tweens.
    group.stopAllAnimations();
    group.destroy({ children: true });
  });

  it("multiple mini-tickets in a group can hold independent blink states", () => {
    const theme = TICKET_THEMES.find((t) => t.name === "large_yellow")!;
    const group = new TicketGroup({
      variant: "large",
      tickets: [makeAlmostDoneTicket(), makeAlmostDoneTicket(), makeAlmostDoneTicket()],
      groupName: "Large Yellow",
      price: 60,
      sharedTheme: theme,
      miniThemes: [theme, theme, theme],
      gridSize: "3x5",
    });

    const [m0, m1, m2] = group.miniTickets;

    // Mini 0 → 1-to-go (blink ON); mini 1 → 2-to-go (blink OFF);
    // mini 2 → untouched (blink OFF).
    for (let n = 1; n <= 14; n++) m0.markNumber(n);
    for (let n = 1; n <= 13; n++) m1.markNumber(n);

    expect(m0.getRemainingCount()).toBe(1);
    expect(m1.getRemainingCount()).toBe(2);
    expect(m2.getRemainingCount()).toBe(15);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = m0 as any, b = m1 as any, c = m2 as any;
    expect(a.bgBlinkTween).not.toBeNull();
    expect(b.bgBlinkTween).toBeNull();
    expect(c.bgBlinkTween).toBeNull();
    // All three cardBgs remain visible regardless of blink state.
    expect(a.cardBg.visible).toBe(true);
    expect(b.cardBg.visible).toBe(true);
    expect(c.cardBg.visible).toBe(true);

    group.stopAllAnimations();
    group.destroy({ children: true });
  });
});
