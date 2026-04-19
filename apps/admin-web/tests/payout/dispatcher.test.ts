// PR-A4b (BIN-659) — payout dispatcher tests.

import { describe, it, expect, beforeEach } from "vitest";
import { isPayoutRoute, mountPayoutRoute } from "../../src/pages/payout/index.js";
import { initI18n } from "../../src/i18n/I18n.js";

describe("payout dispatcher", () => {
  beforeEach(() => {
    initI18n();
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            summary: { playerId: "p1", totalStakes: 0, totalPrizes: 0, net: 0, gameCount: 0 },
            physicalTickets: [],
            physicalTicketCount: 0,
            sessionSummary: null,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;
  });

  it("matches list routes", () => {
    expect(isPayoutRoute("/payoutPlayer")).toBe(true);
    expect(isPayoutRoute("/payoutTickets")).toBe(true);
  });

  it("matches dynamic detail routes", () => {
    expect(isPayoutRoute("/payoutPlayer/view/p1")).toBe(true);
    expect(isPayoutRoute("/payoutTickets/view/t1")).toBe(true);
  });

  it("rejects unrelated routes", () => {
    expect(isPayoutRoute("/payoutPlayer/xx/yy")).toBe(false);
    expect(isPayoutRoute("/admin")).toBe(false);
    expect(isPayoutRoute("/reportGame1")).toBe(false);
  });

  it("mount() renders 404 box for unknown subpath", () => {
    const c = document.createElement("div");
    mountPayoutRoute(c, "/payoutPlayer/unknown/subpath");
    expect(c.querySelector(".box-danger")).not.toBeNull();
  });
});
