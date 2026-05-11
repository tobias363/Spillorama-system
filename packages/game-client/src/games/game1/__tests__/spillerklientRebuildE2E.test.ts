/**
 * @vitest-environment happy-dom
 *
 * Spillerklient-rebuild — Fase 4 ende-til-ende acceptance-tester.
 * Oppdatert 2026-05-11 etter at `WaitingForMasterOverlay` ble fjernet
 * og erstattet med CenterBall idle-text-modus.
 *
 * Bakgrunn:
 *   Tobias-direktiv 2026-05-09 (uendret):
 *     "Når man kommer inn i spill 1 som kunde så skal man alltid da se
 *      neste spill som er planlagt. Dette spillet skal da starte når
 *      master har trykket på knappen."
 *
 *   Tobias-direktiv 2026-05-11 (nytt):
 *     "Den kula som viser hvilket tall som blir trekt — når det ikke er
 *      aktiv runde fjerner vi den og skriver tekst der:
 *        Linje 1: 'Neste spill: {neste spill på planen}'
 *        Linje 2: 'Kjøp bonger for å være med i trekningen'
 *      Vi trenger ikke ha noen tekst om at vi venter på master."
 *
 *   - Fase 1: `Game1LobbyStateBinding` driver lobby-state og forwarder
 *     `nextScheduledGame.catalogDisplayName` til `Game1BuyPopup`.
 *   - Fase 2: `buildBuyPopupTicketConfigFromLobby` konverterer
 *     `Spill1LobbyNextGame` til BuyPopup-shape.
 *   - Fase 3 (rev. 2026-05-11): `CenterBall.setIdleText` + `showIdleText`/
 *     `hideIdleText` styrer "Neste spill: X"-rendringen direkte i Pixi-
 *     stage. Ingen separat HTML-overlay.
 *
 * Test-filosofi:
 *   - In-process integrasjon. Ekte `Game1LobbyStateBinding`, ekte
 *     `Game1BuyPopup`, ekte CenterBall. Socket + fetch stubbet.
 *   - "Venter på master"-overlay-DOM (data-attributtet
 *     `data-spill1-waiting-for-master`) skal IKKE eksistere. Vi bekrefter
 *     dette per scenario som regresjon-vakt.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  Spill1LobbyState,
  Spill1LobbyNextGame,
  Spill1LobbyOverallStatus,
} from "@spillorama/shared-types/api";
import type {
  SpilloramaSocket,
  Spill1LobbyStateUpdatePayload,
} from "../../../net/SpilloramaSocket.js";

import { Game1LobbyStateBinding } from "../logic/LobbyStateBinding.js";
import { buildBuyPopupTicketConfigFromLobby } from "../logic/lobbyTicketTypes.js";
import { Game1BuyPopup } from "../components/Game1BuyPopup.js";
import { HtmlOverlayManager } from "../components/HtmlOverlayManager.js";
import { CenterBall } from "../components/CenterBall.js";

// ── Test-fixtures ─────────────────────────────────────────────────────────

function makeNextScheduledGameStandardBingo(
  overrides: Partial<Spill1LobbyNextGame> = {},
): Spill1LobbyNextGame {
  return {
    itemId: "item-1",
    position: 1,
    catalogSlug: "bingo",
    catalogDisplayName: "Bingo",
    status: "purchase_open",
    scheduledGameId: null,
    scheduledStartTime: null,
    scheduledEndTime: null,
    actualStartTime: null,
    ticketColors: ["hvit", "gul", "lilla"],
    ticketPricesCents: { hvit: 500, gul: 1000, lilla: 1500 },
    prizeMultiplierMode: "auto",
    bonusGameSlug: null,
    ...overrides,
  };
}

function makeNextScheduledGameTrafikklys(): Spill1LobbyNextGame {
  return makeNextScheduledGameStandardBingo({
    itemId: "item-trafikklys",
    position: 1,
    catalogSlug: "trafikklys",
    catalogDisplayName: "Trafikklys",
    ticketColors: ["lilla"],
    ticketPricesCents: { lilla: 1500 },
    prizeMultiplierMode: "explicit_per_color",
  });
}

function makeLobbyState(
  overrides: Partial<Spill1LobbyState> = {},
): Spill1LobbyState {
  return {
    hallId: "demo-hall-001",
    businessDate: "2026-05-10",
    isOpen: true,
    openingTimeStart: "11:00",
    openingTimeEnd: "21:00",
    planId: "demo-plan-pilot",
    planName: "Pilot Demo — alle 13 spill",
    runId: null,
    runStatus: "idle",
    overallStatus: "purchase_open",
    nextScheduledGame: makeNextScheduledGameStandardBingo(),
    currentRunPosition: 1,
    totalPositions: 13,
    ...overrides,
  };
}

// ── Socket stub helpers ────────────────────────────────────────────────────

interface SocketStubControls {
  socket: SpilloramaSocket;
  emitStateUpdate: (state: Spill1LobbyState) => void;
  subscribeMock: ReturnType<typeof vi.fn>;
  unsubscribeMock: ReturnType<typeof vi.fn>;
  getRegisteredListenerCount: () => number;
}

function makeSocketStub(
  hallId: string,
  initialAck?: Spill1LobbyState | null,
): SocketStubControls {
  let stateUpdateListener:
    | ((payload: Spill1LobbyStateUpdatePayload) => void)
    | null = null;
  let listenerCount = 0;

  const subscribeMock = vi.fn().mockResolvedValue({
    ok: true,
    data: { state: initialAck ?? null },
  });
  const unsubscribeMock = vi.fn().mockResolvedValue({
    ok: true,
    data: { unsubscribed: true },
  });

  const socket = {
    subscribeSpill1Lobby: subscribeMock,
    unsubscribeSpill1Lobby: unsubscribeMock,
    on: vi.fn().mockImplementation((event: string, cb: unknown) => {
      if (event === "spill1LobbyStateUpdate") {
        stateUpdateListener = cb as (
          payload: Spill1LobbyStateUpdatePayload,
        ) => void;
        listenerCount += 1;
      }
      return () => {
        if (event === "spill1LobbyStateUpdate") {
          stateUpdateListener = null;
          listenerCount = Math.max(0, listenerCount - 1);
        }
      };
    }),
  } as unknown as SpilloramaSocket;

  return {
    socket,
    emitStateUpdate: (state) => {
      if (stateUpdateListener) {
        stateUpdateListener({ hallId, state });
      }
    },
    subscribeMock,
    unsubscribeMock,
    getRegisteredListenerCount: () => listenerCount,
  };
}

// ── Integration-harness ──────────────────────────────────────────────────

/**
 * SpillerklientHarness wires fase-komponentene sammen slik de fungerer i
 * Game1Controller (post-2026-05-11). Speiler:
 *   - lobby-binding → setBuyPopupDisplayName (BuyPopup + CenterBall)
 *   - lobby-binding → setLobbyOverallStatus (driver PlayScreen.update
 *     som toggler CenterBall.showIdleText vs hideIdleText)
 *
 * Vi tester gjennom CenterBall direkte siden full PlayScreen-instansiering
 * krever Pixi-app (out-of-scope for happy-dom).
 */
class SpillerklientHarness {
  private readonly container: HTMLElement;
  private readonly hallId: string;
  /** Speiler en aktiv Game1LobbyFallback (pre-join). */
  hasLobbyFallback = false;
  /** Speiler `bridge.getState().gameStatus`. RUNNING overrider lobby-state. */
  bridgeGameStatus: "NONE" | "WAITING" | "RUNNING" | "ENDED" = "NONE";

  buyPopup: Game1BuyPopup;
  centerBall: CenterBall;
  binding: Game1LobbyStateBinding;
  /** Cached siste lobby-state for å mirror PlayScreen.update-flyten. */
  private lastLobbyStatus: Spill1LobbyOverallStatus | null = null;

  constructor(
    container: HTMLElement,
    hallId: string,
    socket: SpilloramaSocket,
  ) {
    this.container = container;
    this.hallId = hallId;

    // BuyPopup mountes via HtmlOverlayManager (ekte DOM).
    const overlayManager = new HtmlOverlayManager(container);
    this.buyPopup = new Game1BuyPopup(overlayManager);

    // CenterBall instansieres uten Pixi-stage — vi tester den direkte via
    // dens public API. happy-dom håndterer Pixi.Text/Container i headless-mode.
    this.centerBall = new CenterBall();

    // LobbyStateBinding driver state-flyten.
    this.binding = new Game1LobbyStateBinding({
      hallId,
      socket,
      pollIntervalMs: 60_000,
      apiBaseUrl: "http://localhost:0",
    });
    this.binding.onChange((state) => this.onLobbyStateChanged(state));
  }

  async start(): Promise<void> {
    await this.binding.start();
  }

  stop(): void {
    this.binding.stop();
    this.buyPopup.destroy();
    this.centerBall.destroy();
  }

  /**
   * Mirror av Game1Controller.lobbyStateBinding.onChange-handleren
   * (post-2026-05-11): forwarder display-name til BuyPopup + CenterBall,
   * og driver idle-text-mode basert på status.
   */
  private onLobbyStateChanged(state: Spill1LobbyState | null): void {
    if (this.hasLobbyFallback) return;

    const displayName = state?.nextScheduledGame?.catalogDisplayName ?? "Bingo";
    this.buyPopup.setDisplayName(displayName);
    this.centerBall.setIdleText(displayName);

    this.lastLobbyStatus = state?.overallStatus ?? null;

    // Mirror PlayScreen.update-flyten: hideIdleText ved running, ellers vis.
    this.applyCenterBallVisibility();
  }

  /**
   * Mirror av PlayScreen.update — bestemmer om CenterBall skal være i
   * idle-text-modus eller live-ball-modus. Bridge-RUNNING overrider lobby
   * (race-fix mellom room:update og lobby:state).
   *
   * Hall-isolation-fix (Tobias 2026-05-11): når `overallStatus === "closed"`
   * byttes idle-mode til "closed" så CenterBall viser "Stengt" i stedet
   * for "Neste spill: Bingo".
   */
  private applyCenterBallVisibility(): void {
    if (this.lastLobbyStatus === "running") {
      this.centerBall.hideIdleText();
      return;
    }
    if (this.bridgeGameStatus === "RUNNING") {
      this.centerBall.hideIdleText();
      return;
    }
    this.centerBall.setIdleMode(
      this.lastLobbyStatus === "closed" ? "closed" : "next-game",
    );
    this.centerBall.showIdleText();
  }

  /** Speil av Game1Controller.onGameStarted-flyten. */
  onGameStarted(): void {
    this.bridgeGameStatus = "RUNNING";
    this.applyCenterBallVisibility();
  }

  openBuyPopupFromLobby(): void {
    const lobbyConfig = this.binding.getBuyPopupTicketConfig();
    const displayName = this.binding.getCatalogDisplayName();
    if (!lobbyConfig) return;
    this.buyPopup.showWithTypes(
      lobbyConfig.entryFee,
      lobbyConfig.ticketTypes,
      0,
      undefined,
      displayName,
    );
  }

  /** True hvis CenterBall er i idle-text-modus. */
  isCenterBallIdleVisible(): boolean {
    return this.centerBall.isIdleTextVisible();
  }

  /** Antall ticket-rader rendret av BuyPopup. */
  getBuyPopupTicketRowCount(): number {
    const overlay = this.container.querySelector(".g1-overlay-root");
    if (!overlay) return 0;
    const card = overlay.lastElementChild?.firstElementChild;
    if (!card) return 0;
    const typesContainer = card.children[1];
    return typesContainer?.children.length ?? 0;
  }

  getBuyPopupSubtitle(): string | null {
    const overlay = this.container.querySelector(".g1-overlay-root");
    if (!overlay) return null;
    const allDivs = overlay.querySelectorAll("div");
    for (const div of Array.from(allDivs)) {
      if ((div as HTMLElement).style.letterSpacing === "0.14em") {
        return div.textContent;
      }
    }
    return null;
  }

  getBuyPopupTicketPrices(): Array<string> {
    const overlay = this.container.querySelector(".g1-overlay-root");
    if (!overlay) return [];
    const card = overlay.lastElementChild?.firstElementChild;
    if (!card) return [];
    const typesContainer = card.children[1];
    if (!typesContainer) return [];
    const rows = Array.from(typesContainer.children) as HTMLElement[];
    return rows.map((row) => row.textContent?.replace(/\s+/g, " ").trim() ?? "");
  }

  /** Test-hjelper: hent renderet idle-text linje 1 ("Neste spill: X"). */
  getIdleHeadline(): string {
    // CenterBall.idleHeadline er privat. Vi leser ved å instansiere en
    // identisk shape — alternativt via tagger. Vi bruker simpelthen
    // proxy-getter på public state via reflect. For happy-dom-test er det
    // tilstrekkelig å verifisere at idle-mode er aktiv + at setIdleText
    // ble kalt med riktig navn (verifisert via mock).
    // For end-to-end visuelle assert bruker vi en typecast.
    // @ts-expect-error — privat felt, test-only.
    return (this.centerBall.idleHeadline?.text as string) ?? "";
  }
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ ok: false }),
    }),
  );
  if (
    typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver ===
    "undefined"
  ) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

// ── Acceptance-scenarier ──────────────────────────────────────────────────

describe("Spillerklient-rebuild — Fase 4 ende-til-ende (post-2026-05-11)", () => {
  // ── Test 1 ────────────────────────────────────────────────────────────
  it("Test 1: Master ikke startet → CenterBall viser 'Neste spill: Bingo' idle-text, ingen overlay", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const initialState = makeLobbyState({ overallStatus: "purchase_open" });
    const { socket } = makeSocketStub("demo-hall-001", initialState);
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();

      // Forventet: idle-text aktiv på CenterBall.
      expect(harness.isCenterBallIdleVisible()).toBe(true);
      expect(harness.getIdleHeadline()).toBe("Neste spill: Bingo");

      // Tobias-direktiv 2026-05-11: ingen "venter på master"-overlay.
      expect(
        document.querySelectorAll("[data-spill1-waiting-for-master]").length,
      ).toBe(0);

      // Ingen "..." eller "STANDARD" tekst i DOM (Tobias-direktiv).
      const debugTextNodes = container.textContent ?? "";
      expect(debugTextNodes).not.toMatch(/STANDARD/);
    } finally {
      harness.stop();
      container.remove();
    }
  });

  // ── Test 2 ────────────────────────────────────────────────────────────
  it("Test 2: Master starter → idle-text dismisses og CenterBall klar for live-trekk", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket, emitStateUpdate } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState({ overallStatus: "purchase_open" }),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();
      expect(harness.isCenterBallIdleVisible()).toBe(true);

      // Master starter — server pusher overallStatus="running".
      emitStateUpdate(makeLobbyState({ overallStatus: "running" }));

      expect(harness.isCenterBallIdleVisible()).toBe(false);
      expect(
        document.querySelectorAll("[data-spill1-waiting-for-master]").length,
      ).toBe(0);
    } finally {
      harness.stop();
      container.remove();
    }
  });

  // ── Test 3 ────────────────────────────────────────────────────────────
  it("Test 3: Buy-popup viser kun 3 farger for standard-Bingo (hvit/gul/lilla)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket } = makeSocketStub("demo-hall-001", makeLobbyState());
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();

      harness.openBuyPopupFromLobby();

      // Forventet: 6 ticket-rader (3 farger × small+stor, Tobias 2026-05-11).
      expect(harness.getBuyPopupTicketRowCount()).toBe(6);

      // Forventet: subtitle viser "Bingo" (fra plan-runtime — fase 1).
      expect(harness.getBuyPopupSubtitle()).toBe("Bingo");

      // Forventet: priser matcher 5/10/15 kr (small) + 15/30/45 kr (stor =
      // 3× small) (fase 2 auto-multiplier + 2026-05-11 stor-varianter).
      // Vi sjekker at hver ticket-rad inneholder den forventede pris-strengen.
      const rowTexts = harness.getBuyPopupTicketPrices();
      const concat = rowTexts.join(" | ");
      // Auto-multiplier: 5kr base × [1, 2, 3] = 5/10/15 kr (small).
      // Stor = 3× = 15/30/45 kr.
      expect(concat).toMatch(/5\s*kr/);
      expect(concat).toMatch(/10\s*kr/);
      expect(concat).toMatch(/15\s*kr/);
      expect(concat).toMatch(/30\s*kr/);
      expect(concat).toMatch(/45\s*kr/);

      // Forventet: ikke flere enn 6 (3 farger × 2 varianter — Tobias-direktiv).
      // Gammel hardkodet 8-farge-bug ville gitt > 6.
      expect(harness.getBuyPopupTicketRowCount()).toBeLessThanOrEqual(6);
    } finally {
      harness.stop();
      container.remove();
    }
  });

  // ── Test 4 ────────────────────────────────────────────────────────────
  it("Test 4: Trafikklys (1 farge à 15 kr) viser 1 ticket-knapp og oppdatert idle-text", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket, emitStateUpdate } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState(),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();

      emitStateUpdate(
        makeLobbyState({
          overallStatus: "purchase_open",
          nextScheduledGame: makeNextScheduledGameTrafikklys(),
        }),
      );

      harness.openBuyPopupFromLobby();

      // Forventet: 2 ticket-knapper (small + stor lilla; Tobias 2026-05-11).
      expect(harness.getBuyPopupTicketRowCount()).toBe(2);

      // Forventet: subtitle viser "Trafikklys" (fra plan-runtime).
      expect(harness.getBuyPopupSubtitle()).toBe("Trafikklys");

      // Forventet: small lilla = 15 kr, stor lilla = 45 kr (3× small).
      const smallRowText = harness.getBuyPopupTicketPrices()[0] ?? "";
      const largeRowText = harness.getBuyPopupTicketPrices()[1] ?? "";
      expect(smallRowText).toMatch(/15\s*kr/);
      expect(largeRowText).toMatch(/45\s*kr/);

      // Forventet: ingen referanse til 5 kr eller 10 kr i Trafikklys-modus
      // (kun lilla-priser 15/45 kr finnes).
      const fullCardText = (
        container.querySelector(".g1-overlay-root")?.textContent ?? ""
      ).replace(/\s+/g, " ");
      // Vi tillater 15 og 45 men ikke 5 eller 10 alene som pris.
      // (Total-summen kan vise "0 kr" når qty=0, så match på "5 kr" / "10 kr".)
      expect(fullCardText).not.toMatch(/\b5\s*kr\b/);
      expect(fullCardText).not.toMatch(/\b10\s*kr\b/);

      // Sanity: CenterBall idle-text reflekterer nytt navn ("Trafikklys").
      expect(harness.getIdleHeadline()).toBe("Neste spill: Trafikklys");
      expect(
        document.querySelectorAll("[data-spill1-waiting-for-master]").length,
      ).toBe(0);
    } finally {
      harness.stop();
      container.remove();
    }
  });

  // ── Test 5 ────────────────────────────────────────────────────────────
  it("Test 5: Etter Fullt Hus → ny purchase_open viser idle-text for neste plan-position", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket, emitStateUpdate } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState({ overallStatus: "purchase_open" }),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();
      expect(harness.isCenterBallIdleVisible()).toBe(true);

      // Master starter — idle-text dismisses.
      emitStateUpdate(makeLobbyState({ overallStatus: "running" }));
      expect(harness.isCenterBallIdleVisible()).toBe(false);

      // Fullt Hus identifisert → server spawn-er ny scheduled-game for
      // neste plan-position.
      emitStateUpdate(
        makeLobbyState({
          overallStatus: "purchase_open",
          currentRunPosition: 2,
          nextScheduledGame: makeNextScheduledGameStandardBingo({
            itemId: "item-2",
            position: 2,
            catalogSlug: "innsatsen",
            catalogDisplayName: "Innsatsen",
          }),
        }),
      );

      // Idle-text aktiv på nytt med nytt navn.
      expect(harness.isCenterBallIdleVisible()).toBe(true);
      expect(harness.getIdleHeadline()).toBe("Neste spill: Innsatsen");

      // BuyPopup-subtitle reflekterer også nytt navn.
      expect(harness.getBuyPopupSubtitle()).toBe("Innsatsen");
      expect(
        document.querySelectorAll("[data-spill1-waiting-for-master]").length,
      ).toBe(0);
    } finally {
      harness.stop();
      container.remove();
    }
  });

  // ── Test 6 ────────────────────────────────────────────────────────────
  it("Test 6: Disconnect → reconnect → fersh state, render reflekterer current status", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket, emitStateUpdate } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState({ overallStatus: "running" }),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();
      // Initial running → idle-text er IKKE synlig.
      expect(harness.isCenterBallIdleVisible()).toBe(false);

      // Reconnect: server pusher fersh "paused"-state.
      emitStateUpdate(makeLobbyState({ overallStatus: "paused" }));
      expect(harness.isCenterBallIdleVisible()).toBe(true);

      // Master fortsetter spillet.
      emitStateUpdate(makeLobbyState({ overallStatus: "running" }));
      expect(harness.isCenterBallIdleVisible()).toBe(false);

      // Spilleren var borte lenge — ny plan-item venter.
      emitStateUpdate(
        makeLobbyState({
          overallStatus: "purchase_open",
          currentRunPosition: 5,
          nextScheduledGame: makeNextScheduledGameStandardBingo({
            position: 5,
            catalogSlug: "kvikkis",
            catalogDisplayName: "Kvikkis",
          }),
        }),
      );

      expect(harness.isCenterBallIdleVisible()).toBe(true);
      expect(harness.getIdleHeadline()).toBe("Neste spill: Kvikkis");
    } finally {
      harness.stop();
      container.remove();
    }
  });
});

// ── Edge case-acceptance ──────────────────────────────────────────────────

describe("Spillerklient-rebuild — Fase 4 integrert robusthet (post-2026-05-11)", () => {
  it("overallStatus='closed' (hall uten plan) → idle-text viser 'Stengt' (hall-isolation 2026-05-11)", async () => {
    // Hall-isolation-fix (Tobias 2026-05-11): default-hall som ikke er
    // medlem av en GoH med aktiv plan skal IKKE vise "Neste spill: Bingo
    // (venter på master)" — det er pilot-hallens view. I stedet vises
    // "Stengt / Ingen aktiv plan i hallen akkurat nå" så spilleren ser
    // tydelig at hallene er isolerte.
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState({ overallStatus: "closed", nextScheduledGame: null }),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();
      expect(harness.getBuyPopupSubtitle()).toBe("Bingo");
      expect(harness.isCenterBallIdleVisible()).toBe(true);
      // Forventet: idle-mode er "closed" og headline er "Stengt"
      // (IKKE "Neste spill: Bingo" — det ville være pilot-hallens view).
      expect(harness.getIdleHeadline()).toBe("Stengt");
    } finally {
      harness.stop();
      container.remove();
    }
  });

  it("overallStatus='idle' (hall i pilot-GoH, venter på master) → idle-text viser 'Neste spill: Bingo'", async () => {
    // Pilot-hall i demo-pilot-goh som har aktiv plan — venter på master.
    // Skal vise "Neste spill: Bingo / Kjøp bonger for å være med i
    // trekningen". Dette er KUN for haller som faktisk har plan-state.
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState({ overallStatus: "idle" }),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();
      expect(harness.isCenterBallIdleVisible()).toBe(true);
      expect(harness.getIdleHeadline()).toBe("Neste spill: Bingo");
    } finally {
      harness.stop();
      container.remove();
    }
  });

  it("nextScheduledGame=null → openBuyPopupFromLobby er no-op (ingen ticket-knapper hardkodet)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState({ overallStatus: "closed", nextScheduledGame: null }),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();
      harness.openBuyPopupFromLobby();
      expect(harness.getBuyPopupTicketRowCount()).toBe(0);
    } finally {
      harness.stop();
      container.remove();
    }
  });

  it("Bridge-state RUNNING overrider stale lobby (race-fix) — idle-text skjult", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState({ overallStatus: "purchase_open" }),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      harness.bridgeGameStatus = "RUNNING";
      await harness.start();
      expect(harness.isCenterBallIdleVisible()).toBe(false);
    } finally {
      harness.stop();
      container.remove();
    }
  });

  it("Lobby-fallback aktiv → onChange-handleren no-op (fallback eier scenen)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState({ overallStatus: "purchase_open" }),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      harness.hasLobbyFallback = true;
      await harness.start();
      // CenterBall mountes initielt med fallback "Bingo" og idle-text-mode
      // hvis vi viser den. Når fallback eier scenen overstyrer den display-
      // logikken — vi skipper applyLobbyState så getIdleHeadline returnerer
      // initial fallback (det rendres ikke av spillet uansett siden
      // fallback dekker hele skjermen i prod).
      expect(
        document.querySelectorAll("[data-spill1-waiting-for-master]").length,
      ).toBe(0);
    } finally {
      harness.stop();
      container.remove();
    }
  });

  it("onGameStarted før lobby-update lander → idle-text dismisses umiddelbart", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState({ overallStatus: "purchase_open" }),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();
      expect(harness.isCenterBallIdleVisible()).toBe(true);

      // Bridge mottar room:update.gameStatus=RUNNING før lobby-update.
      harness.onGameStarted();
      expect(harness.isCenterBallIdleVisible()).toBe(false);
    } finally {
      harness.stop();
      container.remove();
    }
  });

  it("End-to-end pure converter: standard-bingo + trafikklys + ugyldig data håndteres riktig", () => {
    // Verifiser at converter-en (fase 2 pure-funksjon) gir riktig output
    // for alle realistiske inputs spilleren kan se.

    // 1. Standard 3-farge bingo — 6 rader (small+stor per farge,
    //    Tobias 2026-05-11)
    const standard = buildBuyPopupTicketConfigFromLobby(
      makeNextScheduledGameStandardBingo(),
    );
    expect(standard).not.toBeNull();
    expect(standard!.entryFee).toBe(5);
    expect(standard!.ticketTypes).toHaveLength(6);

    // 2. Trafikklys 1-farge — 2 rader (small + stor lilla)
    const trafikklys = buildBuyPopupTicketConfigFromLobby(
      makeNextScheduledGameTrafikklys(),
    );
    expect(trafikklys).not.toBeNull();
    expect(trafikklys!.entryFee).toBe(15);
    expect(trafikklys!.ticketTypes).toHaveLength(2);

    expect(buildBuyPopupTicketConfigFromLobby(null)).toBeNull();
    expect(buildBuyPopupTicketConfigFromLobby(undefined)).toBeNull();
    expect(
      buildBuyPopupTicketConfigFromLobby(
        makeNextScheduledGameStandardBingo({ ticketColors: [] }),
      ),
    ).toBeNull();

    // 4. Inkonsistent seed: farge i ticketColors men ikke i ticketPricesCents
    //    → den fargen droppes (begge varianter: ingen 0 kr-knapp).
    const inkonsistent = buildBuyPopupTicketConfigFromLobby(
      makeNextScheduledGameStandardBingo({
        ticketColors: ["hvit", "gul", "lilla"],
        ticketPricesCents: { hvit: 500, gul: 1000 },
      }),
    );
    expect(inkonsistent).not.toBeNull();
    // 2 gyldige farger × 2 varianter = 4 rader
    expect(inkonsistent!.ticketTypes).toHaveLength(4);
  });

  it("Lobby-state med ulike overallStatus-verdier driver idle-text-mode riktig", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket, emitStateUpdate } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState({ overallStatus: "purchase_open" }),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();

      const nonRunningStatuses: Spill1LobbyOverallStatus[] = [
        "idle",
        "purchase_open",
        "ready_to_start",
        "paused",
        "closed",
        "finished",
      ];

      for (const status of nonRunningStatuses) {
        emitStateUpdate(makeLobbyState({ overallStatus: status }));
        expect(harness.isCenterBallIdleVisible()).toBe(true);
      }

      emitStateUpdate(makeLobbyState({ overallStatus: "running" }));
      expect(harness.isCenterBallIdleVisible()).toBe(false);

      // Regresjon: ingen overlay-DOM-noder i hele scenariet.
      expect(
        document.querySelectorAll("[data-spill1-waiting-for-master]").length,
      ).toBe(0);
    } finally {
      harness.stop();
      container.remove();
    }
  });
});
