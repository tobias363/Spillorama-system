import { describe, expect, it } from "vitest";
import { theme1TopperCatalog } from "@/features/theme1/data/theme1TopperCatalog";

describe("theme1TopperCatalog", () => {
  it("matches the preview ordering from Mønster 12 down to Mønster 1", () => {
    expect(theme1TopperCatalog.map((entry) => entry.displayNumber)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    ]);
  });

  it("keeps the 1L and 2L cards as blank-board badge variants", () => {
    const oneLine = theme1TopperCatalog.find((entry) => entry.displayNumber === 1);
    const twoLine = theme1TopperCatalog.find((entry) => entry.displayNumber === 7);

    expect(oneLine).toMatchObject({
      theme: "blue",
      blankBoard: true,
      heroBadgeAlt: "1L",
    });
    expect(twoLine).toMatchObject({
      theme: "purple",
      blankBoard: true,
      heroBadgeAlt: "2L",
    });
  });

  it("uses the same forced preview themes for the lower-numbered topper cards", () => {
    const themeByDisplayNumber = new Map(
      theme1TopperCatalog.map((entry) => [entry.displayNumber, entry.theme] as const),
    );

    expect(themeByDisplayNumber.get(9)).toBe("purple");
    expect(themeByDisplayNumber.get(8)).toBe("orange");
    expect(themeByDisplayNumber.get(6)).toBe("teal");
    expect(themeByDisplayNumber.get(5)).toBe("green");
    expect(themeByDisplayNumber.get(4)).toBe("yellow");
    expect(themeByDisplayNumber.get(3)).toBe("orange");
    expect(themeByDisplayNumber.get(2)).toBe("orange");
  });
});
