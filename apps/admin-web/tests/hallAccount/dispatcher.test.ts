// PR-A4b (BIN-659) — hallAccountReport dispatcher tests.

import { describe, it, expect, beforeEach } from "vitest";
import {
  isHallAccountRoute,
  mountHallAccountRoute,
} from "../../src/pages/hallAccountReport/index.js";
import { initI18n } from "../../src/i18n/I18n.js";

describe("hallAccountReport dispatcher", () => {
  beforeEach(() => {
    initI18n();
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            halls: [],
            rows: [],
            settlements: [],
            settlement: {},
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;
  });

  it("matches list route", () => {
    expect(isHallAccountRoute("/hallAccountReport")).toBe(true);
  });

  it("matches dynamic detail route", () => {
    expect(isHallAccountRoute("/hallAccountReport/hall-abc-123")).toBe(true);
  });

  it("matches dynamic settlement route", () => {
    expect(isHallAccountRoute("/report/settlement/hall-abc-123")).toBe(true);
  });

  it("rejects unrelated routes", () => {
    expect(isHallAccountRoute("/admin")).toBe(false);
    expect(isHallAccountRoute("/reportGame1")).toBe(false);
    expect(isHallAccountRoute("/hallAccountReport/x/y/z")).toBe(false);
  });

  it("mount() renders 404 box for unknown subpath", () => {
    const c = document.createElement("div");
    mountHallAccountRoute(c, "/hallAccountReport/some/weird/path");
    expect(c.querySelector(".box-danger")).not.toBeNull();
  });
});
