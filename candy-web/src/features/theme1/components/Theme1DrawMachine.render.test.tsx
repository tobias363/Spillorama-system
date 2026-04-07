import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Theme1DrawMachine } from "@/features/theme1/components/Theme1DrawMachine";

describe("Theme1DrawMachine integrated-live rendering", () => {
  it("does not render the legacy machine ball layers in live mode", () => {
    const html = renderToStaticMarkup(
      <Theme1DrawMachine
        drawCount={12}
        featuredBallNumber={34}
        featuredBallIsPending={true}
        recentBalls={[1, 7, 14, 22, 34]}
        variant="integrated-live"
      />,
    );

    expect(html).not.toContain("theme1-draw-machine__floating-ball");
    expect(html).not.toContain("theme1-draw-machine__output-ball");
    expect(html).toContain("theme1-draw-machine__flight-origin");
  });

  it("still renders the standalone machine ball layers outside live mode", () => {
    const html = renderToStaticMarkup(
      <Theme1DrawMachine
        drawCount={12}
        featuredBallNumber={34}
        featuredBallIsPending={true}
        recentBalls={[1, 7, 14, 22, 34]}
        variant="standalone"
      />,
    );

    expect(html).toContain("theme1-draw-machine__floating-ball");
    expect(html).toContain("theme1-draw-machine__output-ball");
  });
});
