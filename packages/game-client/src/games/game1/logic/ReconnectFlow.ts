import type { GameBridge, GameState } from "../../../bridge/GameBridge.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";
import type { LoadingOverlay } from "../../../components/LoadingOverlay.js";
import { telemetry } from "../../../telemetry/Telemetry.js";
import type { Phase } from "./Phase.js";

export interface ReconnectFlowDeps {
  readonly socket: SpilloramaSocket;
  readonly bridge: GameBridge;
  readonly loader: LoadingOverlay | null;
}

/**
 * Ett ansvar: håndtere sen-sync og reconnect-gjenoppretting. Begge flyter
 * venter på at klienten har konsistent state før loader-en slippes —
 * regulatorisk viktig i pengespill slik at spillere ikke ser stale UI mens
 * tallene kommer inn ut av rekkefølge.
 */
export class Game1ReconnectFlow {
  /** Maks ventetid for at en runde i RUNNING-state leverer første live event. */
  private static readonly SYNC_TIMEOUT_MS = 5000;

  constructor(private readonly deps: ReconnectFlowDeps) {}

  /**
   * BIN-500: hold loader til klient er synkronisert med resten av rommet.
   *
   * Late-joinere i aktive runder venter på minst én live event (draw:new
   * eller room:update som øker drawnNumbers-lengden). For WAITING/ENDED er
   * snapshot autoritativt og vi slipper loader umiddelbart.
   *
   * Timeout: 5 sek — hvis backend er tregt, vis heller tom state enn evig
   * loader. Spillere får live events inn fortløpende.
   */
  async waitForSyncReady(): Promise<void> {
    const syncStartedAt = Date.now();
    const state = this.deps.bridge.getState();
    const isRunningAtEntry = state.gameStatus === "RUNNING";

    if (!isRunningAtEntry) {
      // Snapshot er tilstrekkelig baseline for WAITING/ENDED.
      telemetry.trackEvent("late_join_sync", {
        syncGapMs: Date.now() - syncStartedAt,
        gotLiveEvent: false,
        skipped: "not-running",
      });
      return;
    }

    this.deps.loader?.setState("SYNCING");

    const gotLiveEvent = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), Game1ReconnectFlow.SYNC_TIMEOUT_MS);
      const unsubDraw = this.deps.bridge.on("numberDrawn", () => {
        clearTimeout(timer);
        unsubDraw();
        unsubState();
        resolve(true);
      });
      const unsubState = this.deps.bridge.on("stateChanged", (s) => {
        if (s.drawnNumbers.length > state.drawnNumbers.length) {
          clearTimeout(timer);
          unsubDraw();
          unsubState();
          resolve(true);
        }
      });
    });

    const syncGap = Date.now() - syncStartedAt;
    telemetry.trackEvent("late_join_sync", { syncGapMs: syncGap, gotLiveEvent });
    if (!gotLiveEvent) {
      console.warn(
        `[Game1] sync-timeout etter ${syncGap}ms — slipper loader med snapshot-state`,
      );
    } else {
      console.debug(`[Game1] late-join sync OK etter ${syncGap}ms`);
    }
  }

  /**
   * Etter socket-reconnect: hent fersk snapshot fra server, apply til bridge,
   * og velg riktig fase. Fallback til `getRoomState` hvis `resumeRoom`
   * ikke leverer snapshot (recovery-edge-case).
   *
   * `onTransition` kalles med beregnet fase så Game1Controller kan gjøre
   * screen-switch uten at denne klassen må kjenne til Phase-maskineri.
   */
  async handleReconnect(
    roomCode: string,
    onTransition: (phase: Phase, state: GameState) => void,
  ): Promise<void> {
    if (!roomCode) {
      this.deps.loader?.setState("READY");
      return;
    }

    // BIN-673 + BIN-682: vis RESYNCING mens vi henter + applyer snapshot.
    // Uten dette ble loader-en avvist så fort socket var tilbake, men
    // applySnapshot kjører ETTER dismiss — klienten viste stale state et
    // øyeblikk. Med RESYNCING holdes overlay oppe gjennom hele
    // fetch → apply → re-render-syklusen.
    this.deps.loader?.setState("RESYNCING");

    try {
      const result = await this.deps.socket.resumeRoom({ roomCode });
      let snapshot = result.ok ? result.data?.snapshot : null;

      // Fallback: hvis resumeRoom ikke returnerer snapshot, prøv
      // getRoomState. Dekker tilfeller hvor rommet er restored fra
      // checkpoint men bruker-session er out-of-sync.
      if (!snapshot) {
        if (!result.ok) {
          console.warn("[Game1] Room resume failed, trying getRoomState:", result.error?.message);
        }
        const fallback = await this.deps.socket.getRoomState({ roomCode });
        snapshot = fallback.ok ? (fallback.data?.snapshot ?? null) : null;
      }

      if (snapshot) {
        this.deps.bridge.applySnapshot(snapshot);
        const state = this.deps.bridge.getState();
        const phase: Phase =
          state.gameStatus === "RUNNING"
            ? (state.myTickets.length > 0 ? "PLAYING" : "SPECTATING")
            : "WAITING";
        onTransition(phase, state);
        this.deps.loader?.setState("READY");
      } else {
        // Begge pather feilet — la overlay stå i RESYNCING. Stuck-timer
        // (5s) viser "Last siden på nytt"-knapp så bruker ikke er fastlåst.
        console.error("[Game1] Both resumeRoom and getRoomState failed — user must reload");
      }
    } catch (err) {
      console.error("[Game1] Reconnect error:", err);
      // Overlay blir stående i RESYNCING; stuck-timer håndterer UX.
    }
  }
}
