import { describe, it, expect } from "vitest";
import { TICKET_THEMES, ONE_TO_GO_COLOR, getTicketTheme, getTicketThemeByName } from "./TicketColorThemes.js";

/**
 * Unity color paritet — snapshot-test for BIN-374.
 *
 * Temaene er extrahert 1:1 fra Unity inspector i
 * legacy/unity-client/Assets/_Project/_Scenes/Game.unity:418142-418203
 * og strukturen matcher Tickets_Color struct i
 * legacy/unity-client/Assets/_Project/_Scripts/Panels/Game/TicketColorManager.cs:6-11
 *
 * Endrer du en farge må du også oppdatere Unity (eller bekrefte med PM at
 * det er en bevisst differanse). Unity-kilden er source-of-truth fram til
 * Unity-clienten er pensjonert.
 */
describe("TicketColorThemes — Unity parity", () => {
  it("ONE_TO_GO_COLOR matches Unity One_to_go_Color", () => {
    // Unity: RGBA(0.6901961, 0.83137256, 0.6313726, 1) = #b0d4a1
    expect(ONE_TO_GO_COLOR).toBe(0xb0d4a1);
  });

  it("snapshot of all 11 themes (8 Small + 3 Large) — Unity 1:1", () => {
    const hexed = TICKET_THEMES.map((t) => ({
      name: t.name,
      cardBg: toHex(t.cardBg),
      headerBg: toHex(t.headerBg),
      headerText: toHex(t.headerText),
      toGoColor: toHex(t.toGoColor),
      toGoCloseColor: toHex(t.toGoCloseColor),
      largeBg: toHex(t.largeBg),
      largeBgAlpha: t.largeBgAlpha,
      cellColors: {
        bgDefault: toHex(t.cellColors.bgDefault),
        bgFree: toHex(t.cellColors.bgFree),
        bgHighlight: toHex(t.cellColors.bgHighlight),
        markerColor: toHex(t.cellColors.markerColor),
        textDefault: toHex(t.cellColors.textDefault),
        textMarked: toHex(t.cellColors.textMarked),
        textFree: toHex(t.cellColors.textFree),
        borderColor: toHex(t.cellColors.borderColor),
      },
    }));
    expect(hexed).toMatchSnapshot();
  });

  it("has exactly 11 themes (default, yellow, white, purple, red, green, orange, elvis, large_yellow, large_purple, large_white)", () => {
    expect(TICKET_THEMES).toHaveLength(11);
    expect(TICKET_THEMES.map((t) => t.name)).toEqual([
      "default",
      "yellow",
      "white",
      "purple",
      "red",
      "green",
      "orange",
      "elvis",
      "large_yellow",
      "large_purple",
      "large_white",
    ]);
  });

  it("Large Yellow has distinct cardBg from Small Yellow (ffc800 vs f5c103)", () => {
    expect(getTicketThemeByName("Large Yellow", 0).cardBg).toBe(0xffc800);
    expect(getTicketThemeByName("Small Yellow", 0).cardBg).toBe(0xf5c103);
  });

  it("Large Purple has distinct cardBg from Small Purple (694bff vs af91ff)", () => {
    expect(getTicketThemeByName("Large Purple", 0).cardBg).toBe(0x694bff);
    expect(getTicketThemeByName("Small Purple", 0).cardBg).toBe(0xaf91ff);
  });

  it("Large White has distinct cardBg from Small White (d2d2d2 vs ffffff)", () => {
    expect(getTicketThemeByName("Large White", 0).cardBg).toBe(0xd2d2d2);
    expect(getTicketThemeByName("Small White", 0).cardBg).toBe(0xffffff);
  });

  it("Elvis largeBg alpha matches Unity (0.7058824)", () => {
    const elvis = getTicketThemeByName("Elvis1", 0);
    expect(elvis.largeBg).toBe(0x4b0000);
    expect(elvis.largeBgAlpha).toBeCloseTo(0.7058824, 6);
  });

  it("Orange largeBg alpha matches Unity (0.7058824 white overlay)", () => {
    const orange = getTicketThemeByName("Small Orange", 0);
    expect(orange.largeBg).toBe(0xffffff);
    expect(orange.largeBgAlpha).toBeCloseTo(0.7058824, 6);
  });

  it("Large Red/Green/Orange fall back to Small variants (Unity mangler distinkte entries)", () => {
    expect(getTicketThemeByName("Large Red", 0).name).toBe("red");
    expect(getTicketThemeByName("Large Green", 0).name).toBe("green");
    expect(getTicketThemeByName("Large Orange", 0).name).toBe("orange");
  });

  it("getTicketTheme cycles through Small 0-6 only, skipping elvis and large-varianter", () => {
    // index 0..6 skal treffe default..orange
    expect(getTicketTheme(0).name).toBe("default");
    expect(getTicketTheme(6).name).toBe("orange");
    // index 7 skal wrappe tilbake til default (ikke elvis/large)
    expect(getTicketTheme(7).name).toBe("default");
    expect(getTicketTheme(14).name).toBe("default");
    // Verifiser at ingen cycling-index treffer large_* eller elvis
    for (let i = 0; i < 50; i++) {
      const name = getTicketTheme(i).name;
      expect(name).not.toMatch(/^large_/);
      expect(name).not.toBe("elvis");
    }
  });

  it("getTicketThemeByName faller tilbake til cycling ved ukjent navn", () => {
    expect(getTicketThemeByName(undefined, 0).name).toBe("default");
    expect(getTicketThemeByName("FooBar", 2).name).toBe("white");
  });
});

function toHex(n: number): string {
  return "#" + n.toString(16).padStart(6, "0");
}
