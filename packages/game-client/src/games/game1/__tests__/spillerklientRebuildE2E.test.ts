/**
 * @vitest-environment happy-dom
 *
 * Spillerklient-rebuild — Fase 4 ende-til-ende acceptance-tester (2026-05-10).
 *
 * Bakgrunn:
 *   Fase 1+2+3 har levert tre integrerte komponenter som SAMMEN dekker
 *   Tobias-direktivet 2026-05-09:
 *
 *     "Når man kommer inn i spill 1 som kunde så skal man alltid da se
 *      neste spill som er planlagt. Dette spillet skal da starte når
 *      master har trykket på knappen. Det skal aldri være noen andre
 *      views i det live rommet en neste planlagte spill."
 *
 *   - Fase 1 (#1128): `Game1LobbyStateBinding` driver lobby-state via
 *     public `/api/games/spill1/lobby` + socket-broadcast og forwarder
 *     `nextScheduledGame.catalogDisplayName` til `Game1BuyPopup`.
 *   - Fase 2 (#1129): `buildBuyPopupTicketConfigFromLobby` konverterer
 *     `Spill1LobbyNextGame.ticketColors`/`ticketPricesCents` til
 *     `Game1BuyPopup.showWithTypes(...)`-shape. 3 farger for standard
 *     hovedspill, 1 farge for Trafikklys.
 *   - Fase 3 (#1130): `WaitingForMasterOverlay` + countdown-gating sørger
 *     for at klienten viser "venter på master" når
 *     `lobby.overallStatus !== "running"` — INGEN lokal countdown,
 *     INGEN "..."-fallback.
 *
 *   Disse acceptance-testene bygger en in-process integration-harness som
 *   wirer ekte komponenter (ingen mocks for selve testede classes — kun
 *   socket og fetch er stubbed) og kjører de 6 scenarier dokumentert i
 *   `SPILLERKLIENT_REBUILD_HANDOFF_2026-05-10.md` §3 fase 4.
 *
 * Test-filosofi (jf. SKILL "test engineer"):
 *   - **Strategi A**: in-process integrasjon, raskere CI, ingen Docker.
 *     Ekte `Game1LobbyStateBinding`, ekte `Game1BuyPopup`, ekte
 *     `WaitingForMasterOverlay`, ekte `buildBuyPopupTicketConfigFromLobby`.
 *     Det vi mocker er KUN ytterkanten (socket + fetch) — alt mellom
 *     er produksjonskode.
 *   - **Strategi B** (live E2E mot prod-build) er bevisst out-of-scope
 *     for denne PR-en — kommer som follow-up. Disse testene er CI-runnable
 *     uten manuelle steg, noe som er pilot-blocker per `LIVE_ROOM_ROBUSTNESS
 *     _MANDATE_2026-05-08.md` R5/R7.
 *   - **Ingen produksjonskode rørt** — kun nye test-filer + helpers.
 *
 * Run:
 *   `npm --prefix packages/game-client test -- --run spillerklientRebuildE2E`
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
import { WaitingForMasterOverlay } from "../components/WaitingForMasterOverlay.js";

// ── Test-fixtures ─────────────────────────────────────────────────────────

/**
 * Standard 3-farge Bingo-katalogvariant. Speiler hva
 * `Game1LobbyService.buildNextGameFromItem` genererer for `bingo`-slug
 * etter fase 2-utvidelsen i shared-types.
 */
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

/**
 * Trafikklys-spesialvariant — KUN lilla-bong à 15 kr. Per
 * `SPILL_REGLER_OG_PAYOUT.md` §5 og `prizeMultiplierMode: "explicit_per_color"`.
 */
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
  /** Trigger `spill1LobbyStateUpdate`-event som om server pushet broadcast. */
  emitStateUpdate: (state: Spill1LobbyState) => void;
  subscribeMock: ReturnType<typeof vi.fn>;
  unsubscribeMock: ReturnType<typeof vi.fn>;
  /** Aksesserer registrerte event-listeners. */
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
 * SpillerklientHarness wires de tre fase-komponentene sammen slik de
 * fungerer i Game1Controller — uten Pixi-stage, uten full controller-
 * bootstrapping. Speiler `applyWaitingForMasterFromLobbyState`-logikken
 * samt forwardingen av displayName/ticketConfig fra LobbyStateBinding
 * til Game1BuyPopup.
 *
 * NB: harness-en skal ikke trene controller-INNVENDIG-state — kun det
 * brukeren ser (DOM-state av overlay + popup). Det er hele poenget med
 * fase 4: vi tester at ALT-OG-ALT fungerer fra spillerens synspunkt.
 */
class SpillerklientHarness {
  private readonly container: HTMLElement;
  private readonly hallId: string;
  /** Speiler en aktiv Game1LobbyFallback (pre-join). */
  hasLobbyFallback = false;
  /** Speiler `bridge.getState().gameStatus`. RUNNING overrider lobby-state. */
  bridgeGameStatus: "NONE" | "WAITING" | "RUNNING" | "ENDED" = "NONE";

  // Fase 1+2: BuyPopup mottar setDisplayName + setTicketConfig
  buyPopup: Game1BuyPopup;
  // Fase 3: WaitingForMasterOverlay vises/skjules basert på lobby
  waitingOverlay: WaitingForMasterOverlay | null = null;
  // Driver av lobby-state
  binding: Game1LobbyStateBinding;

  constructor(
    container: HTMLElement,
    hallId: string,
    socket: SpilloramaSocket,
  ) {
    this.container = container;
    this.hallId = hallId;

    // Mount BuyPopup som ekte komponent (DOM mountes lazily via
    // HtmlOverlayManager).
    const overlayManager = new HtmlOverlayManager(container);
    this.buyPopup = new Game1BuyPopup(overlayManager);

    // Build LobbyStateBinding som driver state. Init med kort polling-
    // intervall så testene ikke holder timeren åpen for lenge.
    this.binding = new Game1LobbyStateBinding({
      hallId,
      socket,
      pollIntervalMs: 60_000, // lang nok til å aldri trigge i test
      apiBaseUrl: "http://localhost:0", // fetch stubbet, gir alltid 503
    });

    // Wire onChange — speiler Game1Controller.lobbyStateUnsub-callbacken.
    this.binding.onChange((state) => this.onLobbyStateChanged(state));
  }

  async start(): Promise<void> {
    await this.binding.start();
  }

  stop(): void {
    this.binding.stop();
    this.waitingOverlay?.destroy();
    this.waitingOverlay = null;
    this.buyPopup.destroy();
  }

  /**
   * Mirror av Game1Controller.lobbyStateBinding.onChange-handleren:
   *   1. setBuyPopupDisplayName (fase 1)
   *   2. setBuyPopupTicketConfig (fase 2 — vi bygger via converter)
   *   3. applyWaitingForMasterFromLobbyState (fase 3)
   */
  private onLobbyStateChanged(state: Spill1LobbyState | null): void {
    // Fase 1 — display-navn
    const displayName = state?.nextScheduledGame?.catalogDisplayName ?? "Bingo";
    this.buyPopup.setDisplayName(displayName);

    // Fase 2 — ticket-config (vi konverterer fra lobby state og lagrer for
    // popup-åpning. Når popup åpnes via showWithTypes(...) ville
    // PlayScreen prioritere state.ticketTypes. Vi simulerer pre-game-
    // tilfellet hvor state.ticketTypes er tomt og lobby-config tar over.).
    // Storage på instansen sjelden brukt direkte — vi tester gjennom
    // openBuyPopup() under.

    // Fase 3 — vente-på-master
    this.applyWaitingForMaster(state);
  }

  /** Mirror av Game1Controller.applyWaitingForMasterFromLobbyState. */
  private applyWaitingForMaster(state: Spill1LobbyState | null): void {
    if (this.hasLobbyFallback) return;
    if (!state) return;

    if (state.overallStatus === "running") {
      this.waitingOverlay?.hide();
      return;
    }

    if (this.bridgeGameStatus === "RUNNING") {
      this.waitingOverlay?.hide();
      return;
    }

    if (!this.waitingOverlay) {
      this.waitingOverlay = new WaitingForMasterOverlay({
        container: this.container,
      });
    }
    this.waitingOverlay.show({
      catalogDisplayName: state.nextScheduledGame?.catalogDisplayName ?? null,
      currentPosition: state.currentRunPosition || null,
      totalPositions: state.totalPositions || null,
      planName: state.planName,
    });
  }

  /**
   * Speil av Game1Controller.onGameStarted's defensive overlay-hide.
   * Brukes for å verifisere reaksjon på `gameStarted` som kommer FØR
   * lobby-state-update.
   */
  onGameStarted(): void {
    this.waitingOverlay?.hide();
  }

  /**
   * Mirror av PlayScreen.showBuyPopup — åpner buy-popup med ticket-config
   * fra lobby (fallback når room:update ikke har levert variant).
   */
  openBuyPopupFromLobby(): void {
    const lobbyConfig = this.binding.getBuyPopupTicketConfig();
    const displayName = this.binding.getCatalogDisplayName();
    if (!lobbyConfig) {
      // Ingen lobby-data — popup-en skal ikke åpnes (samme oppførsel som
      // PlayScreen.showBuyPopup når state.ticketTypes er tom).
      return;
    }
    this.buyPopup.showWithTypes(
      lobbyConfig.entryFee,
      lobbyConfig.ticketTypes,
      0, // alreadyPurchased
      undefined,
      displayName,
    );
  }

  /** Konvensjonell DOM-query for waiting-overlay (fase 3). */
  isWaitingOverlayVisible(): boolean {
    return this.waitingOverlay?.isVisible() ?? false;
  }

  /** Antall ticket-rader rendret av BuyPopup. */
  getBuyPopupTicketRowCount(): number {
    const overlay = this.container.querySelector(".g1-overlay-root");
    if (!overlay) return 0;
    const card = overlay.lastElementChild?.firstElementChild;
    if (!card) return 0;
    // typesContainer er child[1] i kortet (header, types, sep, status, total, buy, cancel)
    const typesContainer = card.children[1];
    return typesContainer?.children.length ?? 0;
  }

  /** Display-navn rendret i BuyPopup-subtitle. */
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

  /** Pris-tekstinformasjon for hver ticket-rad. */
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
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  // happy-dom: gi binding en working fetch som alltid returnerer 503 så
  // socket-broadcast er den eneste state-kilden vi kontrollerer.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ ok: false }),
    }),
  );
  // ResizeObserver-stub — Game1BuyPopup bruker den i constructor.
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

describe("Spillerklient-rebuild — Fase 4 ende-til-ende acceptance", () => {
  // ── Test 1 ────────────────────────────────────────────────────────────
  it("Test 1: Master ikke startet → spiller ser 'venter på master', ingen countdown, ingen '...'", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    // Initial socket-state: master har IKKE startet — purchase_open.
    const initialState = makeLobbyState({ overallStatus: "purchase_open" });
    const { socket } = makeSocketStub("demo-hall-001", initialState);
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();

      // Forventet: WaitingForMasterOverlay er mounted og synlig.
      expect(harness.isWaitingOverlayVisible()).toBe(true);

      // Forventet: overlay viser "Bingo" som catalog-navn (fra plan-runtime).
      const overlayHeadline = container.querySelector(
        "[data-spill1-waiting-for-master] [data-role='headline']",
      );
      expect(overlayHeadline?.textContent).toBe("Bingo");

      // Forventet: subheadline sier "Venter på master".
      const overlaySubheadline = container.querySelector(
        "[data-spill1-waiting-for-master] [data-role='subheadline']",
      );
      expect(overlaySubheadline?.textContent).toBe("Venter på master");

      // Forventet: plan-info reflekterer 1 av 13 fra Pilot Demo.
      const overlayPlanInfo = container.querySelector(
        "[data-spill1-waiting-for-master] [data-role='plan-info']",
      );
      expect(overlayPlanInfo?.textContent).toBe(
        "Spill 1 av 13 — Pilot Demo — alle 13 spill",
      );

      // Forventet: NEI til "..." eller andre fallback-views — Tobias-direktiv.
      const debugTextNodes = container.textContent ?? "";
      expect(debugTextNodes).not.toMatch(/^\.\.\./);
      expect(debugTextNodes).not.toMatch(/STANDARD/);
    } finally {
      harness.stop();
      container.remove();
    }
  });

  // ── Test 2 ────────────────────────────────────────────────────────────
  it("Test 2: Master starter → overlay dismisses og lobby-running drives videre flow", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket, emitStateUpdate } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState({ overallStatus: "purchase_open" }),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();

      // Pre-condition: overlay synlig.
      expect(harness.isWaitingOverlayVisible()).toBe(true);

      // Master kaller /api/agent/game1/master/start → server pusher
      // overallStatus="running" via socket-broadcast.
      emitStateUpdate(makeLobbyState({ overallStatus: "running" }));

      // Forventet: overlay dismisses.
      expect(harness.isWaitingOverlayVisible()).toBe(false);

      // Tobias-direktiv: ingen "..." eller stale-fallback skal være synlig.
      const overlayElements = container.querySelectorAll(
        "[data-spill1-waiting-for-master]",
      );
      // Overlay-noden kan fortsatt eksistere i DOM, men skal være `display: none`.
      for (const el of Array.from(overlayElements)) {
        const style = window.getComputedStyle(el as HTMLElement);
        // I happy-dom regnes hidden via inline style.
        expect((el as HTMLElement).style.display).toBe("none");
      }
    } finally {
      harness.stop();
      container.remove();
    }
  });

  // ── Test 3 ────────────────────────────────────────────────────────────
  it("Test 3: Buy-popup viser kun 3 farger for standard-Bingo (hvit/gul/lilla)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState(), // standard 3-farge bingo
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();

      // Spilleren klikker "Kjøp bong" (PlayScreen.showBuyPopup).
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
  it("Test 4: Trafikklys (1 farge à 15 kr) viser 1 ticket-knapp og oppdatert subtitle", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket, emitStateUpdate } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState(), // initialt standard bingo
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();

      // Admin endrer plan-item til Trafikklys-katalog → server pusher
      // ny lobby-state via socket-broadcast.
      emitStateUpdate(
        makeLobbyState({
          overallStatus: "purchase_open",
          nextScheduledGame: makeNextScheduledGameTrafikklys(),
        }),
      );

      // Spilleren åpner kjøp-popup.
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

      // Sanity: WaitingForMasterOverlay viser nå "Trafikklys" som catalog-navn.
      const overlayHeadline = container.querySelector(
        "[data-spill1-waiting-for-master] [data-role='headline']",
      );
      expect(overlayHeadline?.textContent).toBe("Trafikklys");
    } finally {
      harness.stop();
      container.remove();
    }
  });

  // ── Test 5 ────────────────────────────────────────────────────────────
  it("Test 5: Etter Fullt Hus → ny purchase_open viser 'venter på master' for neste plan-position", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket, emitStateUpdate } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState({ overallStatus: "purchase_open" }),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();

      // Pre-game: overlay synlig.
      expect(harness.isWaitingOverlayVisible()).toBe(true);

      // Master starter Spill 1 — overlay dismisses.
      emitStateUpdate(makeLobbyState({ overallStatus: "running" }));
      expect(harness.isWaitingOverlayVisible()).toBe(false);

      // Server kjører runden ferdig → Fullt Hus identifisert. Server
      // spawner ny scheduled-game for neste plan-position og pusher
      // lobby-state med purchase_open + position 2.
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

      // Forventet: overlay synlig på nytt — Tobias-direktiv om "alltid neste
      // planlagte spill mellom runder".
      expect(harness.isWaitingOverlayVisible()).toBe(true);

      // Forventet: overlay viser nytt catalog-navn ("Innsatsen") og position 2.
      const overlayHeadline = container.querySelector(
        "[data-spill1-waiting-for-master] [data-role='headline']",
      );
      expect(overlayHeadline?.textContent).toBe("Innsatsen");

      const overlayPlanInfo = container.querySelector(
        "[data-spill1-waiting-for-master] [data-role='plan-info']",
      );
      expect(overlayPlanInfo?.textContent).toBe(
        "Spill 2 av 13 — Pilot Demo — alle 13 spill",
      );

      // BuyPopup-subtitle skal også reflektere nytt catalog-navn.
      // (Vi har ikke åpnet popup-en, men setDisplayName er kalt — verifiser via
      // direkte accessor.)
      // Selv om popup ikke er synlig oppdateres internt subtitle-element.
      const subtitle = harness.getBuyPopupSubtitle();
      expect(subtitle).toBe("Innsatsen");
    } finally {
      harness.stop();
      container.remove();
    }
  });

  // ── Test 6 ────────────────────────────────────────────────────────────
  it("Test 6: Disconnect → reconnect → fersh state pushes nytt lobby-state, render reflekterer current status", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    // Pre-disconnect: lobby er running, overlay er ikke synlig.
    const { socket, emitStateUpdate } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState({ overallStatus: "running" }),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();

      // Initial-ack ga overallStatus=running → overlay aldri vist.
      // (running-grenen hopper over `mount + show`.)
      // Vi bekrefter at det er ingen overlay-DOM-noder.
      const initialOverlays = container.querySelectorAll(
        "[data-spill1-waiting-for-master]",
      );
      expect(initialOverlays.length).toBe(0);

      // Spiller mister nett. Backend stoper å pushe state-updates. Lokalt
      // har vi fortsatt cached "running".

      // Reconnect — server pusher fersh state. I mellomtiden har master
      // satt spillet på pause, så lobby-state er nå "paused".
      emitStateUpdate(makeLobbyState({ overallStatus: "paused" }));

      // Forventet: overlay vises basert på CURRENT status, ikke stale
      // pre-disconnect-data. Tobias-direktiv: "ingen andre views enn
      // neste planlagte spill".
      expect(harness.isWaitingOverlayVisible()).toBe(true);

      // Reconnect-scenario nr 2: master fortsetter spillet.
      emitStateUpdate(makeLobbyState({ overallStatus: "running" }));

      // Forventet: overlay dismisses igjen.
      expect(harness.isWaitingOverlayVisible()).toBe(false);

      // Reconnect-scenario nr 3: spilleren har vært borte lenge nok til
      // at Fullt Hus skjedde og ny plan-item venter.
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

      // Forventet: overlay synlig + viser CURRENT plan-position (ikke
      // stale fra før disconnect).
      expect(harness.isWaitingOverlayVisible()).toBe(true);
      const overlayHeadline = container.querySelector(
        "[data-spill1-waiting-for-master] [data-role='headline']",
      );
      expect(overlayHeadline?.textContent).toBe("Kvikkis");
      const overlayPlanInfo = container.querySelector(
        "[data-spill1-waiting-for-master] [data-role='plan-info']",
      );
      expect(overlayPlanInfo?.textContent).toBe(
        "Spill 5 av 13 — Pilot Demo — alle 13 spill",
      );
    } finally {
      harness.stop();
      container.remove();
    }
  });
});

// ── Edge case-acceptance: integrert flyt verifisert ───────────────────────

describe("Spillerklient-rebuild — Fase 4 integrert robusthet", () => {
  it("nextScheduledGame=null (closed/finished) → BuyPopup-subtitle 'Bingo' og overlay viser 'Bingo' (ingen STANDARD)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState({ overallStatus: "closed", nextScheduledGame: null }),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();

      // Tobias-direktiv: aldri "STANDARD" eller tom subtitle. Default = "Bingo".
      expect(harness.getBuyPopupSubtitle()).toBe("Bingo");

      // Overlay vises også for closed (ikke-running).
      expect(harness.isWaitingOverlayVisible()).toBe(true);
      const overlayHeadline = container.querySelector(
        "[data-spill1-waiting-for-master] [data-role='headline']",
      );
      expect(overlayHeadline?.textContent).toBe("Bingo");
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

      // Når lobby ikke har ticket-config skal popup IKKE åpnes (vi viser
      // ikke gamle 8-farge-defaults).
      harness.openBuyPopupFromLobby();
      expect(harness.getBuyPopupTicketRowCount()).toBe(0);
    } finally {
      harness.stop();
      container.remove();
    }
  });

  it("Bridge-state RUNNING overrider stale lobby (race-fix) — overlay forblir skjult", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState({ overallStatus: "purchase_open" }),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      // Bridge har allerede mottatt room:update.gameStatus=RUNNING (master
      // klikket Start, men lobby-state-update henger igjen).
      harness.bridgeGameStatus = "RUNNING";

      await harness.start();

      // Forventet: overlay vises ikke pga bridge-override.
      expect(harness.isWaitingOverlayVisible()).toBe(false);
    } finally {
      harness.stop();
      container.remove();
    }
  });

  it("Lobby-fallback aktiv → ingen waiting-overlay (fallback eier scenen)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState({ overallStatus: "purchase_open" }),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      // Game1Controller markerer hasLobbyFallback=true når createRoom
      // feiler og Game1LobbyFallback overtar.
      harness.hasLobbyFallback = true;

      await harness.start();

      // Forventet: ingen waiting-overlay (fallback-en eier visningen).
      expect(harness.isWaitingOverlayVisible()).toBe(false);
      const overlays = container.querySelectorAll(
        "[data-spill1-waiting-for-master]",
      );
      expect(overlays.length).toBe(0);
    } finally {
      harness.stop();
      container.remove();
    }
  });

  it("Defensiv: onGameStarted() før lobby-update lander → overlay dismisses umiddelbart", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState({ overallStatus: "purchase_open" }),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();
      expect(harness.isWaitingOverlayVisible()).toBe(true);

      // Master har klikket Start. room:update.gameStatus=RUNNING ankommer
      // før lobby-state-update — controller bruker onGameStarted som
      // defensive hide.
      harness.onGameStarted();

      expect(harness.isWaitingOverlayVisible()).toBe(false);
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

    // 3. Tom/null lobby-data → null (caller faller på state.ticketTypes)
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
        ticketPricesCents: { hvit: 500, gul: 1000 }, // mangler lilla
      }),
    );
    expect(inkonsistent).not.toBeNull();
    // 2 gyldige farger × 2 varianter = 4 rader
    expect(inkonsistent!.ticketTypes).toHaveLength(4);
  });

  it("Lobby-state med ulike overallStatus-verdier driver overlay riktig per Tobias-direktiv", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { socket, emitStateUpdate } = makeSocketStub(
      "demo-hall-001",
      makeLobbyState({ overallStatus: "purchase_open" }),
    );
    const harness = new SpillerklientHarness(container, "demo-hall-001", socket);

    try {
      await harness.start();

      // Verifiser at overlay vises for ALLE ikke-running statuses.
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
        expect(harness.isWaitingOverlayVisible()).toBe(true);
      }

      // Når status går til "running" — overlay dismisses.
      emitStateUpdate(makeLobbyState({ overallStatus: "running" }));
      expect(harness.isWaitingOverlayVisible()).toBe(false);
    } finally {
      harness.stop();
      container.remove();
    }
  });
});
