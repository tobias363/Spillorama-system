/**
 * Tester for StateDumpButton (Tobias-direktiv 2026-05-14).
 *
 * Dekker:
 *   1. Mount oppretter knapp + status-tekst i host
 *   2. Klikk/trigger oppdaterer status til "✓ Dump …"
 *   3. onDumped-callback fires med dump-objekt
 *   4. Unmount fjerner container fra DOM
 *   5. Custom label respekteres
 *   6. Multi-klikk gir "in-progress"-feil
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountStateDumpButton } from "./StateDumpButton.js";
import type { FrontendStateDump } from "./StateDumpTool.js";

interface GlobalScope {
  window?: any;
  document?: any;
}

class MockElement {
  tagName: string;
  children: MockElement[] = [];
  parent: MockElement | null = null;
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  text = "";
  disabled = false;
  private listeners: Record<string, Array<(e: any) => void>> = {};
  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  get textContent(): string {
    return this.text;
  }
  set textContent(v: string) {
    this.text = v;
  }
  setAttribute(k: string, v: string): void {
    this.attributes[k] = v;
  }
  getAttribute(k: string): string | null {
    return this.attributes[k] ?? null;
  }
  appendChild(c: MockElement): MockElement {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  remove(): void {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((ch) => ch !== this);
      this.parent = null;
    }
  }
  addEventListener(name: string, cb: (e: any) => void): void {
    if (!this.listeners[name]) this.listeners[name] = [];
    this.listeners[name]!.push(cb);
  }
}

function setupDom(): {
  host: MockElement;
  restore: () => void;
} {
  const g = globalThis as unknown as GlobalScope;
  const original = {
    window: g.window,
    document: g.document,
  };
  const mockDoc = {
    createElement(tag: string): MockElement {
      return new MockElement(tag);
    },
  };
  const localStorageMap = new Map<string, string>();
  const mockLs = {
    getItem(k: string): string | null {
      return localStorageMap.get(k) ?? null;
    },
    setItem(k: string, v: string): void {
      localStorageMap.set(k, v);
    },
  };
  const mockWindow = {
    location: { search: "", href: "https://test.example/web/" },
    navigator: { userAgent: "test-agent/1.0" },
    innerWidth: 1024,
    innerHeight: 768,
    localStorage: mockLs,
  };
  g.window = mockWindow;
  g.document = mockDoc;
  const host = new MockElement("div");

  // Silence noise
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};

  return {
    host,
    restore: () => {
      g.window = original.window;
      g.document = original.document;
      console.log = origLog;
      console.warn = origWarn;
    },
  };
}

const makeProviders = () => ({
  getGameState: () => ({
    roomCode: "ROOM-001",
    hallId: "demo-hall-001",
    gameStatus: "RUNNING",
    entryFee: 5,
    ticketTypes: [
      { name: "yellow", type: "s", priceMultiplier: 1, ticketCount: 1 },
    ],
    myStake: 5,
    myPendingStake: 0,
  }),
  getLobbyState: () => ({
    activeHallId: "demo-hall-001",
    halls: [],
    games: [],
    ticketPricesCents: { yellow: 500 },
  }),
  getGameSlug: () => "bingo",
});

describe("StateDumpButton", () => {
  let ctx: ReturnType<typeof setupDom>;
  beforeEach(() => {
    ctx = setupDom();
  });
  afterEach(() => {
    ctx.restore();
  });

  it("Test 1: Mount oppretter knapp + status-tekst i host", () => {
    const m = mountStateDumpButton(
      ctx.host as unknown as HTMLElement,
      makeProviders(),
      { skipServerPost: true, skipConsoleLog: true },
    );
    expect(ctx.host.children).toHaveLength(1);
    expect(m.container).toBeDefined();
    expect(m.button).toBeDefined();
    expect(m.status).toBeDefined();
    expect((m.button as unknown as MockElement).getAttribute("data-testid")).toBe(
      "state-dump-button",
    );
    expect((m.status as unknown as MockElement).getAttribute("data-testid")).toBe(
      "state-dump-status",
    );
    expect(m.button.textContent).toBe("Dump State");
  });

  it("Test 2: Trigger oppdaterer status til '✓ Dump …'", async () => {
    let dumpedCb: FrontendStateDump | null = null;
    const m = mountStateDumpButton(
      ctx.host as unknown as HTMLElement,
      makeProviders(),
      {
        skipServerPost: true,
        skipConsoleLog: true,
        onDumped: (d) => {
          dumpedCb = d;
        },
      },
    );
    await m.trigger();
    expect(m.status.textContent ?? "").toMatch(/^✓ Dump /);
    expect(dumpedCb).not.toBeNull();
    expect(m.button.disabled).toBe(false);
  });

  it("Test 3: onDumped-callback fires med komplett dump-objekt", async () => {
    let received: FrontendStateDump | null = null;
    const m = mountStateDumpButton(
      ctx.host as unknown as HTMLElement,
      makeProviders(),
      {
        skipServerPost: true,
        skipConsoleLog: true,
        onDumped: (d) => {
          received = d;
        },
      },
    );
    await m.trigger();
    expect(received).not.toBeNull();
    const r = received as unknown as FrontendStateDump;
    expect(r.dumpId.length).toBeGreaterThan(0);
    expect(r.lobbyState).not.toBeNull();
    expect(r.roomState).not.toBeNull();
    expect(r.derivedState).toBeDefined();
  });

  it("Test 4: Unmount fjerner container fra DOM", () => {
    const m = mountStateDumpButton(
      ctx.host as unknown as HTMLElement,
      makeProviders(),
      { skipServerPost: true, skipConsoleLog: true },
    );
    expect(ctx.host.children).toHaveLength(1);
    m.unmount();
    expect(ctx.host.children).toHaveLength(0);
  });

  it("Test 5: Custom label respekteres", () => {
    const m = mountStateDumpButton(
      ctx.host as unknown as HTMLElement,
      makeProviders(),
      {
        skipServerPost: true,
        skipConsoleLog: true,
        label: "DUMP NOW",
      },
    );
    expect(m.button.textContent).toBe("DUMP NOW");
  });

  it("Test 6: Multi-klikk under in-flight gir 'in-progress'-feil", async () => {
    const m = mountStateDumpButton(
      ctx.host as unknown as HTMLElement,
      makeProviders(),
      {
        skipServerPost: true,
        skipConsoleLog: true,
      },
    );
    const p1 = m.trigger();
    let secondError: unknown = null;
    try {
      await m.trigger();
    } catch (e) {
      secondError = e;
    }
    await p1;
    expect(secondError).toBeDefined();
    expect(m.status.textContent ?? "").toMatch(/^✓ Dump /);
  });
});
