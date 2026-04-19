import { describe, it, expect, beforeEach, vi } from "vitest";
import { Router } from "../src/router/Router.js";
import { findRoute } from "../src/router/routes.js";

describe("Router", () => {
  beforeEach(() => {
    window.location.hash = "";
    document.body.innerHTML = "<div id='c'></div>";
  });

  it("renders initial route from hash on start()", async () => {
    const container = document.getElementById("c")!;
    window.location.hash = "#/player";
    const renderer = vi.fn();
    const router = new Router({ container, renderer });
    router.start();
    await Promise.resolve();
    expect(renderer).toHaveBeenCalledWith(container, expect.objectContaining({ path: "/player" }));
    router.stop();
  });

  it("calls onUnknown for unknown paths", async () => {
    const container = document.getElementById("c")!;
    window.location.hash = "#/does-not-exist";
    const renderer = vi.fn();
    const onUnknown = vi.fn();
    const router = new Router({ container, renderer, onUnknown });
    router.start();
    await Promise.resolve();
    expect(onUnknown).toHaveBeenCalledWith("/does-not-exist", container);
    expect(renderer).not.toHaveBeenCalled();
    router.stop();
  });

  it("responds to hashchange", async () => {
    const container = document.getElementById("c")!;
    window.location.hash = "#/admin";
    const renderer = vi.fn();
    const router = new Router({ container, renderer });
    router.start();
    await Promise.resolve();
    renderer.mockClear();
    window.location.hash = "#/wallet";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await Promise.resolve();
    expect(renderer).toHaveBeenCalledWith(container, expect.objectContaining({ path: "/wallet" }));
    router.stop();
  });
});

describe("findRoute", () => {
  it("resolves known paths", () => {
    expect(findRoute("/admin")?.titleKey).toBe("dashboard");
    expect(findRoute("/player")?.titleKey).toBe("approved_players");
    expect(findRoute("/live/dashboard")?.titleKey).toBe("spillorama_live_dashboard");
  });

  it("returns undefined for unknown", () => {
    expect(findRoute("/nope")).toBeUndefined();
  });
});
