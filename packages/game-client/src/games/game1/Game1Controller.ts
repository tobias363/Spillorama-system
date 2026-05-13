import { Container, Text } from "pixi.js";
import type { GameDeps, GameController } from "../registry.js";
import { registerGame } from "../registry.js";
import type { GameState } from "../../bridge/GameBridge.js";
import type {
  MiniGameActivatedPayload,
  MiniGameTriggerPayload,
  MiniGameResultPayload,
  PatternWonPayload,
  BetRejectedEvent,
  WalletLossStateEvent,
} from "@spillorama/shared-types/socket-events";
import { telemetry } from "../../telemetry/Telemetry.js";
import { PlayScreen } from "./screens/PlayScreen.js";
import { LuckyNumberPicker } from "./components/LuckyNumberPicker.js";
import { LoadingOverlay } from "../../components/LoadingOverlay.js";
import { preloadGameAssets } from "../../core/preloadGameAssets.js";
// Tobias-bug 2026-05-12: auto-reload på prolonged socket-disconnect.
// Brukeren beskrev: "Funket når jeg gikk inn og ut" — reload er den
// pragmatiske recovery-metoden når socket dropper.
import { AutoReloadOnDisconnect } from "./disconnect/AutoReloadOnDisconnect.js";
import { ToastNotification } from "./components/ToastNotification.js";
import { PauseOverlay } from "./components/PauseOverlay.js";
import { WinPopup } from "./components/WinPopup.js";
import { WinScreenV2 } from "./components/WinScreenV2.js";
import {
  Game1EndOfRoundOverlay,
  type Game1EndOfRoundSummary,
} from "./components/Game1EndOfRoundOverlay.js";
import { classifyPhaseFromPatternName, Spill1Phase } from "@spillorama/shared-types/spill1-patterns";

/** Map Spill1Phase-enum til rad-antall (1-4 for linje-vinn). */
const PHASE_TO_ROWS: Readonly<Record<Spill1Phase, number>> = {
  [Spill1Phase.Phase1]: 1,
  [Spill1Phase.Phase2]: 2,
  [Spill1Phase.Phase3]: 3,
  [Spill1Phase.Phase4]: 4,
  [Spill1Phase.FullHouse]: 5,
};
import { SettingsPanel, type Game1Settings } from "./components/SettingsPanel.js";
import { MarkerBackgroundPanel } from "./components/MarkerBackgroundPanel.js";
import { GamePlanPanel } from "./components/GamePlanPanel.js";
import { AudioManager } from "../../audio/AudioManager.js";
import { MiniGameRouter } from "./logic/MiniGameRouter.js";
import { LegacyMiniGameAdapter } from "./logic/LegacyMiniGameAdapter.js";
import { Game1SocketActions } from "./logic/SocketActions.js";
import { Game1ReconnectFlow } from "./logic/ReconnectFlow.js";
import { Game1LobbyFallback } from "./logic/LobbyFallback.js";
import { Game1LobbyStateBinding } from "./logic/LobbyStateBinding.js";
import type { Phase } from "./logic/Phase.js";
// Debug event-tracker (Tobias-direktiv 2026-05-12) — sentralisert
// event-historikk + JSON-dump for diagnose. Aktiveres KUN bak debug-flagget.
import {
  getEventTracker,
  pickSafeFields,
} from "./debug/EventTracker.js";
import { DebugEventLogPanel } from "./debug/DebugEventLogPanel.js";
// Auto-stream-extension (Tobias-direktiv 2026-05-12) — events POST-es
// hvert 2. sek til backend slik at en live-monitoring-agent kan lese
// dem mens Tobias tester. Beholder dump-knappen som fallback.
import { EventStreamer } from "./debug/EventStreamer.js";
import { installConsoleBridge } from "./debug/ConsoleBridge.js";
// Klient-instrumentation (Tobias-direktiv 2026-05-13) — fetch + error +
// socket-emit-tracking. Wrapper-pattern så vi ikke endrer forretningslogikk.
import { installFetchInstrument } from "./debug/FetchInstrument.js";
import { installErrorHandler } from "./debug/ErrorHandler.js";
import { installSocketEmitInstrument } from "./debug/SocketEmitInstrument.js";
// OBS-5: PostHog event-analytics. No-op when VITE_POSTHOG_API_KEY is
// unset (dev/test); in prod every screen transition + buy-popup event
// is recorded for funnel + cohort analyses. Complements Sentry (errors)
// and Rrweb (DOM-replay).
import {
  initPostHog as initClientPostHog,
  trackEvent as posthogTrackEvent,
} from "../../observability/posthogBootstrap.js";
// OBS-1 (cascade-merge 2026-05-14): FetchBridge er supersedet av
// FetchInstrument over (samme wrapper-mønster, mer komplett med
// correlationId + sanitized payloads). Importen er bevisst dropped
// her — filen apps/backend/.../FetchBridge.ts er behold som dead code
// til vi sletter den i en cleanup-PR. Rrweb-imports er også droppet:
// RrwebRecorder wirer seg selv inn via installDebugSuite (#1382 merge).

/**
 * Legacy fallback timeout for stuck-ENDED-state recovery. Tobias UX-mandate
 * 2026-04-29: 3-fase fluid overlay (SUMMARY → LOADING → COUNTDOWN) auto-
 * dismisses i overlay self når ny runde starter eller countdown utløper —
 * controller har derfor ikke lenger en egen auto-dismiss-timer. Beholder
 * verdien som "panic timeout" for legacy-flyter (f.eks. hvis overlay ikke
 * blir mounted i det hele tatt og state henger i ENDED).
 */
const END_SCREEN_AUTO_DISMISS_MS = 10_000;

/**
 * Debug-logging-toggle (2026-05-11, Tobias-direktiv): når
 * `window.__DEBUG_SPILL1_DRAWS__=true` (sett i devtools-console) eller
 * `localStorage.setItem("DEBUG_SPILL1_DRAWS", "true")` emit ekstra
 * `[DRAW]`/`[ROOM]`-console-logger som dekker klient-flyten. Lar Tobias
 * åpne devtools, grep "[DRAW]" og direkte se hvilke `draw:new`-events
 * klient mottar + hvilken `roomCode` klienten faktisk havnet på etter
 * `createRoom`. Default OFF for ikke å spamme prod.
 */
function isSpill1DrawsDebugEnabled(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const wnd = window as unknown as { __DEBUG_SPILL1_DRAWS__?: unknown };
    if (wnd.__DEBUG_SPILL1_DRAWS__ === true) return true;
    const ls = typeof window.localStorage !== "undefined"
      ? window.localStorage.getItem("DEBUG_SPILL1_DRAWS")
      : null;
    return ls?.trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

/**
 * Game 1 (Classic Bingo) controller — orchestration only.
 *
 * Ansvar delegert til logic/-moduler:
 *   - `logic/SocketActions.ts` — alle spiller→server-kall (kjøp, claim, cancel…)
 *   - `logic/MiniGameRouter.ts` — wheel / chest / mystery / color-draft overlays
 *   - `logic/ReconnectFlow.ts` — sync-ready barrier + reconnect-state-rebuild
 *
 * Det som står igjen her: start/destroy lifecycle, Phase-maskin, bridge-event-
 * routing, og noen UI-helpers (toast, settings-panel). Unike-for-Game-1 ting
 * som ikke har en naturlig shared-modul.
 */
class Game1Controller implements GameController {
  private deps: GameDeps;
  private root: Container;
  private phase: Phase = "LOADING";
  private currentScreen: Container | null = null;
  private playScreen: PlayScreen | null = null;
  private myPlayerId: string | null = null;
  private actualRoomCode: string = "";
  private unsubs: (() => void)[] = [];
  private endScreenTimer: ReturnType<typeof setTimeout> | null = null;
  private buyMoreDisabled = false;
  private luckyPicker: LuckyNumberPicker | null = null;
  private loader: LoadingOverlay | null = null;
  private toast: ToastNotification | null = null;
  private pauseOverlay: PauseOverlay | null = null;
  /** Fase 1-4 vinn-popup (Bong-design, port av WinPopup.jsx). */
  private winPopup: WinPopup | null = null;
  /** Fullt Hus fullskjerm-scene (Bong-design, port av WinScreenV2.jsx). */
  private winScreen: WinScreenV2 | null = null;
  /**
   * Tobias 2026-04-29 prod-incident-fix: end-of-round retail-overlay som
   * erstatter den tidligere Game 2-style {@link EndScreen}-Pixi-skjermen
   * for Spill 1. Vises etter Fullt Hus-claim eller MAX_DRAWS_REACHED med
   * komplett oppsummering + to CTA-knapper. HTML-basert (i likhet med
   * WinScreenV2/WinPopup) for full kontroll over knapper + click-events.
   */
  private endOfRoundOverlay: Game1EndOfRoundOverlay | null = null;
  /**
   * Tobias 2026-04-29: Siste mottatte mini-game-resultat. Lagres her slik at
   * end-of-round-overlay kan vise mini-game-utfallet sammen med
   * pattern-summary (mini-game-result kommer som separat socket-event,
   * ofte før eller samtidig som ENDED-state).
   */
  private lastMiniGameResult: MiniGameResultPayload | null = null;
  /**
   * Tobias UX-mandate 2026-04-29 (option C, fluid 3-phase overlay):
   * timestamp (ms epoch) for når runden endte. Overlay bruker dette for
   * disconnect-resilience: ved reconnect midt i overlay regner overlay
   * ut hvilken fase brukeren skal lande i basert på elapsed time.
   * Reset i onGameStarted (ny runde).
   */
  private roundEndedAt: number | null = null;
  /**
   * @deprecated Etter Tobias UX-mandat 2026-04-29 (revised) — overlay har
   * ikke lenger COUNTDOWN-fase, så buy-popup åpnes ikke lenger fra
   * overlay. Buy-popup vises av rom-state nativt når WAITING aktiverer.
   * Beholdes som no-op for bakoverkompatibilitet.
   */
  private buyPopupOpenedFromOverlay = false;
  /**
   * Tobias UX-mandate 2026-04-29 (revised): timestamp for når
   * end-of-round-overlay ble vist. Brukes for å detektere første
   * subsequent state-update som signaliserer at rommet har fersk
   * live-state — på det tidspunktet kalles `overlay.markRoomReady()`
   * slik at overlay kan dismisse seg.
   */
  private endOfRoundOverlayShownAt: number | null = null;
  private settingsPanel: SettingsPanel | null = null;
  private markerBgPanel: MarkerBackgroundPanel | null = null;
  private gamePlanPanel: GamePlanPanel | null = null;
  private miniGame: MiniGameRouter | null = null;
  /**
   * Tobias prod-incident 2026-04-29: legacy `minigame:activated` adapter for
   * Spill 1's auto-claim path. Coexists with `miniGame` (M6 router); only
   * one of them holds an active overlay at a time because both feed into
   * the same `root` Container and both check `isWinScreenActive` via the
   * controller's pendingMiniGameTrigger queue.
   */
  private legacyMiniGame: LegacyMiniGameAdapter | null = null;
  /**
   * Tobias prod-incident 2026-04-29: pending legacy trigger held while
   * WinScreenV2 is active (mirror of `pendingMiniGameTrigger`). Released
   * via `flushPendingMiniGameTrigger` on win-screen dismiss.
   */
  private pendingLegacyMiniGame: MiniGameActivatedPayload | null = null;
  private actions: Game1SocketActions | null = null;
  private reconnectFlow: Game1ReconnectFlow | null = null;
  /**
   * R1 (BIN-822, 2026-05-08): lobby-fallback overlay. Vises når
   * `socket.createRoom` feiler — typisk når master ikke har trykket Start
   * ennå men hallen er innenfor åpningstid. Lytter på `lobby:state-update`
   * og retry-er join når runden er klar (purchase_open/running).
   */
  private lobbyFallback: Game1LobbyFallback | null = null;
  /**
   * Spillerklient-rebuild Fase 1 (2026-05-10): plan-runtime aggregator
   * binding. Henter `Spill1LobbyState` fra public lobby-endpoint og lytter
   * på socket-broadcast `spill1:lobby:state-update`. Eksponerer
   * `nextScheduledGame.catalogDisplayName` som driver subtitle-en på
   * `Game1BuyPopup` (tidligere hardkodet til "STANDARD").
   *
   * Initialiseres i `start()` FØR `socket.createRoom`-kallet slik at vi
   * har plan-state både når join lykkes (popup-subtitle) og når join
   * feiler (lobby-fallback bruker ikke samme binding men har sin egen
   * fetch-loop).
   */
  private lobbyStateBinding: Game1LobbyStateBinding | null = null;
  /** Unsubscribe-handle for `lobbyStateBinding.onChange`. */
  private lobbyStateUnsub: (() => void) | null = null;
  /**
   * Klient-auto-join-scheduled-game (Tobias 2026-05-11): siste scheduled
   * game-id som klient har joinet på. Brukes for å detektere plan-advance —
   * når `nextScheduledGame.scheduledGameId` i lobby-state endrer seg fra
   * denne lagrede verdien til en ny non-null verdi, re-emit
   * `game1:join-scheduled` mot ny id. Null = klient har ikke joinet via
   * scheduled-flyten (typisk legacy `socket.createRoom`-flyt eller
   * pre-join).
   *
   * Delta-watcher (ikke per-tick): vi sammenligner mot lagret id i
   * onChange-handleren, så re-join skjer KUN når den faktiske gameId-en
   * endrer seg — ikke ved hver lobby-state-tick (overallStatus,
   * catalogDisplayName, etc. endrer seg uten at gameId endres).
   */
  private joinedScheduledGameId: string | null = null;
  /**
   * RACE-FIX (Tobias 2026-05-11 live-test):
   *
   * Delta-watcher i `lobbyStateUnsub.onChange` trigger asynkront `void
   * handleScheduledGameDelta(...)` med en gang lobbyStateBinding leverer
   * første state (kalles av `await lobbyStateBinding.start()` ~line 466).
   * Parallelt kjører initial-join (line 484) som ALSO emit-er
   * `socket.joinScheduledGame` for SAMME scheduledGameId. Begge får
   * `socket.joinScheduledGame` mot samme rom → dobbel-join → server-state
   * blir uforutsigbar, klient kan ende i fallback eller blokkert state.
   *
   * Fix: delta-watcher trigger KUN etter at initial-join er ferdig
   * (suksess eller feil). Initial-join eier først join-call; delta-watcher
   * tar over for plan-advance-scenario etter det.
   */
  private initialJoinComplete = false;
  /**
   * Mini-game-kø (Tobias 2026-04-26): backend triggerer mini-game POST-commit
   * umiddelbart etter Fullt Hus-payout. Hvis WinScreenV2 (Fullt Hus-fontene)
   * fortsatt vises, holder vi tilbake mini-game-overlayet og spiller det av
   * etter at vinner-scenen er dismissed (Tilbake-klikk eller auto-close).
   * Kun ett pending-trigger holdes; nyere trigger overskriver eldre (server-
   * autoritativ — siste trigger vinner).
   */
  private pendingMiniGameTrigger: MiniGameTriggerPayload | null = null;
  /** True mens WinScreenV2 er synlig — hindrer mini-game-overlay i å klippe oppå. */
  private isWinScreenActive = false;
  /**
   * FIXED-PRIZE-FIX (Tobias 2026-04-26): akkumulert egen-vinning per
   * runde. Reset ved gameStarted. Brukes til å vise totalbeløp i
   * WinScreenV2 (Fullt Hus) i stedet for kun Fullt Hus-prizen.
   * Eksempel: 1 Rad 100 + 2 Rader 200 + 3 Rader 200 + 4 Rader 200 +
   * Fullt Hus 1000 = 1700 kr totalt vist i animasjonen.
   */
  private roundAccumulatedWinnings = 0;

  /**
   * Debug event-log-panel (Tobias-direktiv 2026-05-12). Mountes når
   * `?debug=1` i URL eller localStorage `DEBUG_SPILL1_DRAWS=true`. Henter
   * sin egen tracker via singleton `getEventTracker()`. Default null →
   * `mountDebugHud` lager instansen.
   */
  private debugEventPanel: DebugEventLogPanel | null = null;

  /**
   * Auto-stream av tracker-events til backend (Tobias-direktiv 2026-05-12).
   * Aktiveres når `?debug=1` i URL og `RESET_TEST_PLAYERS_TOKEN` er kjent
   * via dev-config (eller URL-param `?debugToken=...` for ad-hoc). Default
   * null → ingen streaming.
   *
   * Beholder eksisterende dump-knapp som fallback: hvis streameren feiler
   * (eks. backend nede), kan Tobias fortsatt dumpe JSON-fil manuelt.
   */
  private debugEventStreamer: EventStreamer | null = null;

  constructor(deps: GameDeps) {
    this.deps = deps;
    this.root = new Container();
  }

  async start(): Promise<void> {
    const { app, socket, bridge } = this.deps;
    app.stage.addChild(this.root);

    // UI overlays
    const overlayContainer = app.app.canvas.parentElement ?? document.body;
    this.loader = new LoadingOverlay(overlayContainer);
    // BIN-673: typed state-machine drives all loader messages. 5-sec stuck
    // threshold triggers the "Last siden på nytt" reload button.
    this.loader.setState("CONNECTING");
    this.toast = new ToastNotification(overlayContainer);
    this.pauseOverlay = new PauseOverlay(overlayContainer);
    this.winPopup = new WinPopup(overlayContainer);
    this.winScreen = new WinScreenV2(overlayContainer);
    this.endOfRoundOverlay = new Game1EndOfRoundOverlay(overlayContainer);
    this.settingsPanel = new SettingsPanel(overlayContainer);
    // Wire settings panel to AudioManager
    this.syncSettingsToAudio(this.settingsPanel.getSettings());
    this.settingsPanel.setOnChange((settings) => this.syncSettingsToAudio(settings));
    this.markerBgPanel = new MarkerBackgroundPanel(overlayContainer);
    this.gamePlanPanel = new GamePlanPanel(overlayContainer);

    // Wire logic-moduler. Getters brukes der state kan endre seg (roomCode
    // settes etter room:create, playScreen skiftes ved screen-transition).
    // BIN-690 PR-M6: router subscribes to `miniGameTrigger` + `miniGameResult`
    // via bridge, and emits `mini_game:choice` via socket.sendMiniGameChoice.
    // No room-code needed — the wire contract is resultId-based.
    //
    // PIXI-P0-002 (Bølge 2A, 2026-04-28): wire `onChoiceLost` so a forced
    // dismiss on game-end (in-flight choice didn't ack in time) shows the
    // user a toast instead of failing silently.
    this.miniGame = new MiniGameRouter({
      root: this.root,
      app,
      socket,
      bridge,
      onChoiceLost: ({ resultId }) => {
        this.toast?.error(
          "Valget ble ikke registrert i tide. Eventuell gevinst krediteres automatisk.",
          6000,
        );
        console.warn("[Game1Controller] mini-game choice lost", { resultId });
      },
    });
    // Demo-blocker-fix 2026-04-29: når mini-game-overlay dismisses (etter
    // brukerens valg + animasjon), vis end-of-round-overlay hvis runden
    // er ENDED. Dette løser at vinneren tidligere mistet mini-game-popup
    // mens MAX_DRAWS-trekningen kjørte i bakgrunnen.
    this.miniGame.setOnAfterDismiss(() => this.onMiniGameDismissed());
    // Tobias prod-incident 2026-04-29: legacy `minigame:activated` adapter
    // for the auto-claim path (PR #727 emit chain). Server still emits
    // legacy events for Spill 1 auto-rounds; this adapter wraps them onto
    // the existing M6 overlays without changing the auto-claim protocol.
    this.legacyMiniGame = new LegacyMiniGameAdapter({
      root: this.root,
      app,
      socket,
      bridge,
    });
    this.legacyMiniGame.setOnAfterDismiss(() => this.onMiniGameDismissed());
    this.actions = new Game1SocketActions({
      socket,
      bridge,
      getRoomCode: () => this.actualRoomCode,
      getPhase: () => this.phase,
      getScheduledPurchaseContext: () => {
        const state = this.lobbyStateBinding?.getState() ?? null;
        return {
          scheduledGameId: this.pickJoinableScheduledGameId(state),
          hallId: this.deps.hallId,
          overallStatus: state?.overallStatus ?? null,
          ticketConfig: this.lobbyStateBinding?.getBuyPopupTicketConfig() ?? null,
        };
      },
      getPlayScreen: () => this.playScreen,
      toast: this.toast,
      onError: (msg) => this.showError(msg),
    });
    this.reconnectFlow = new Game1ReconnectFlow({
      socket,
      bridge,
      loader: this.loader,
      getScheduledGameId: () => this.joinedScheduledGameId,
    });

    // OBS-5: PostHog event-analytics. Init alongside socket connect so the
    // first screen-transition event after game-load is captured. We use
    // the first-8 of the accessToken as distinctId — same anonymization
    // shape as Sentry's `playerId` tag. No-op when VITE_POSTHOG_API_KEY
    // is unset.
    const cfg = this.deps.app.getConfig();
    const distinctId = cfg?.accessToken
      ? `player-${cfg.accessToken.slice(0, 12)}`
      : null;
    void initClientPostHog(distinctId);

    // Connect socket
    socket.connect();

    const connected = await new Promise<boolean>((resolve) => {
      if (socket.isConnected()) { resolve(true); return; }
      const timeout = setTimeout(() => { resolve(false); }, 10000);
      const unsub = socket.on("connectionStateChanged", (state) => {
        if (state === "connected") { unsub(); clearTimeout(timeout); resolve(true); }
      });
    });

    if (!connected) {
      // Tobias-direktiv 2026-05-03: connection-error fallback — vis Loading-
      // overlayet med "Får ikke koblet til rom. Trykk her" (klikk = reload).
      this.loader.setError();
      this.showError("Kunne ikke koble til server");
      return;
    }

    // Tobias-bug 2026-05-12: auto-reload-orchestrator. Armert ved
    // disconnect, cancellet ved reconnect/reconnecting. Hvis socket
    // fortsatt er borte etter delayMs → window.location.reload().
    //
    // PR #1247-regresjon (Tobias 2026-05-12): brukeren ble kastet ut av
    // spillet ved kortvarige nett-glipper fordi 5s-default var for kort
    // og auto-reload fyrte mens socket.io fortsatt prøvde å rekoble.
    // Tre fix-er bundlet her:
    //
    //   1. delayMs default økt fra 5s til 30s i AutoReloadOnDisconnect.
    //      Socket.io reconnect-backoff kan gå opp til
    //      reconnectionDelayMax=30s, så 5s ga ikke nok tid. 30s gir
    //      socket.io 5-6 reconnect-forsøk før vi gir opp.
    //
    //   2. Cancel reload på "reconnecting" — socket.io prøver aktivt å
    //      rekoble, så vi skal IKKE fyre reload mens det skjer. Re-armes
    //      automatisk hvis "disconnected" fires igjen etter "reconnecting".
    //
    //   3. markConnected()-gate i AutoReloadOnDisconnect — defensive:
    //      armReload() er no-op før vi har sett første "connected"-event.
    //      Hindrer reload-loop hvis initial-connect feiler permanent.
    //
    // Hvis vi reload-er 3+ ganger innen 2 min → vis "tekniske problemer"-
    // melding i stedet for å gå inn i reload-loop.
    const autoReloader = new AutoReloadOnDisconnect({
      onMaxAttemptsReached: () => {
        // Reload-loop oppdaget — vis terminal-error-overlay slik at brukeren
        // ser at det er noe galt med kjernen, ikke deres egen tilkobling.
        // LoadingOverlay.setError gjør hele overlayet klikkbart (reload),
        // men teksten oppdateres slik at brukeren forstår alvoret.
        this.loader?.setError(
          "Tekniske problemer. Vennligst prøv igjen om noen minutter — eller trykk her for å laste på nytt.",
        );
      },
    });
    this.unsubs.push(() => {
      autoReloader.cancelReload();
    });

    // PR #1247-regresjon fix (2026-05-12): hvis vi allerede er connected
    // (vanlig — vi awaiter "connected" på linje 340-346 før vi når hit),
    // markér det med en gang så armReload() ikke blokkeres på første
    // disconnect senere. Dekker også race-tilfeller hvor connect-event
    // fyrte før vår listener ble registrert.
    if (socket.isConnected()) {
      autoReloader.markConnected();
    }

    this.unsubs.push(
      socket.on("connectionStateChanged", (state) => {
        if (state === "reconnecting") {
          telemetry.trackReconnect();
          this.loader?.setState("RECONNECTING");
          // Socket.io prøver aktivt å rekoble — cancel evt armet reload
          // så vi ikke unødig kaster ut brukeren mens recovery pågår.
          // Hvis reconnect feiler og state går tilbake til "disconnected"
          // re-armes timer-en.
          autoReloader.cancelReload();
        }
        if (state === "connected") {
          autoReloader.markConnected();
          // Vellykket connect/reconnect → cancel pending auto-reload, så vi
          // ikke unødig reload-er en allerede recovered klient.
          autoReloader.cancelReload();
          if (this.loader?.isShowing()) {
            // Reconnected — resume room to rebuild state from server snapshot
            void this.reconnectFlow?.handleReconnect(this.actualRoomCode, (phase, s) =>
              this.transitionTo(phase, s),
            );
          }
        }
        if (state === "disconnected") {
          telemetry.trackDisconnect("socket");
          this.loader?.setState("DISCONNECTED");
          // armReload er gated på markConnected() i AutoReloadOnDisconnect —
          // no-op hvis socket aldri har lykkes med initial-connect.
          autoReloader.armReload();
        }
      }),
    );

    // BIN-673: Pre-warm Pixi asset cache before joining the room. On slow
    // networks users get explicit "Laster spill..." feedback; on fast
    // networks this resolves near-instantly because assets are small.
    this.loader.setState("LOADING_ASSETS");
    await preloadGameAssets("bingo");

    // Spillerklient lobby-init-order-fix (2026-05-10, Tobias-direktiv):
    // PRE-BYGG `playScreen` FØR `socket.createRoom` slik at lobby-state-
    // update-events kan oppdatere UI umiddelbart — uavhengig av om eller
    // når join-flyten lykkes. Tidligere ble playScreen bygget i
    // `transitionTo("WAITING"/...)` ETTER `socket.createRoom` returnerte
    // (og etter `bridge.applySnapshot` + `waitForSyncReady`), så
    // `setBuyPopupDisplayName(name)` på playScreen?.* var et null-safe
    // no-op hvis lobby-state-update kom inn før join hadde lyktes.
    //
    // Med pre-creation lander lobby-listenerens kall (linje under) på
    // en ekte PlayScreen-instans fra første event. roomCode oppdateres
    // post-join via `playScreen.setRoomCode(actualRoomCode)`. ChatPanelV2
    // har defensiv guard mot tom-streng-roomCode (loader-history hoppes
    // over til `setRoomCode` får non-empty verdi).
    //
    // `transitionTo` for WAITING/PLAYING/SPECTATING gjenbruker den
    // eksisterende playScreen-instansen i stedet for å destroye + bygge
    // ny — det unngår både UI-flicker og listener-race med lobby-binding.
    const initialW = this.deps.app.app.screen.width;
    const initialH = this.deps.app.app.screen.height;
    this.playScreen = this.buildPlayScreen(initialW, initialH);
    this.setScreen(this.playScreen);

    // Spillerklient-rebuild Fase 1 (2026-05-10): start plan-runtime
    // aggregator-binding FØR `socket.createRoom`. Dette gir oss tilgang
    // til `nextScheduledGame.catalogDisplayName` så snart første HTTP-
    // fetch eller socket-broadcast kommer — uavhengig av om
    // join-flyten lykkes. Tobias-direktiv 2026-05-09: spilleren skal
    // ALLTID se neste planlagte spill, aldri "STANDARD".
    //
    // Best-effort: fetch + subscribe kjøres parallelt med
    // `socket.createRoom` slik at vi ikke forsinker join-tiden. Vi
    // venter ikke på initial-fetch — listeners fyrer så snart state er
    // tilgjengelig og oppdaterer subtitle live.
    this.lobbyStateBinding = new Game1LobbyStateBinding({
      hallId: this.deps.hallId,
      socket: this.deps.socket,
    });
    this.lobbyStateUnsub = this.lobbyStateBinding.onChange((state) => {
      // Forward catalog-display-navn til Game1BuyPopup. playScreen er
      // garantert satt her (pre-bygd over) — `?.` beholdes som
      // defensiv-pattern, men listenerens kontrakt er at instansen
      // eksisterer fra første event.
      const name = state?.nextScheduledGame?.catalogDisplayName ?? "Bingo";
      this.playScreen?.setBuyPopupDisplayName(name);

      // Spillerklient-rebuild Fase 2 (2026-05-10): forward ticket-config
      // fra plan-runtime catalog. Når master bytter plan-item (Bingo →
      // Trafikklys → Oddsen) får BuyPopup oppdatert bongfarger umiddelbart.
      // PlayScreen bruker dette som fallback i `showBuyPopup()` når
      // `state.ticketTypes` (fra room:update.gameVariant) er tomt — det
      // er case-en pre-game / før første room:update har levert
      // variant-data.
      const ticketConfig = this.lobbyStateBinding?.getBuyPopupTicketConfig() ?? null;
      this.playScreen?.setBuyPopupTicketConfig(ticketConfig);

      // Spillerklient-rebuild Fase 3 (2026-05-10): forward overall-status
      // til PlayScreen for å gating-e CenterBall-countdown. Når master
      // klikker Start endres overallStatus fra purchase_open/idle/... til
      // "running" — countdown kan da kjøre, og CenterBall byttes fra
      // idle-tekst til live-ball-rendering. Etter Fullt Hus går status
      // tilbake til idle/purchase_open og idle-text vises igjen.
      //
      // 2026-05-11 (Tobias-direktiv): `WaitingForMasterOverlay` er
      // fjernet. Idle-text rendres direkte i CenterBall-posisjonen via
      // `PlayScreen.setBuyPopupDisplayName` (forwarder catalog-navn til
      // både BuyPopup og CenterBall) + `PlayScreen.update()`-flyten som
      // toggles ball vs idle-text basert på state.
      this.playScreen?.setLobbyOverallStatus(state?.overallStatus ?? null);

      // Wait-on-master-fix (Agent B, 2026-05-12 — Tobias-direktiv 2026-05-12,
      // Alternativ B): gating-e kjøp-knapper til scheduled-game er
      // spawnet. Pre-fix-bug: klient kunne sende `bet:arm` (in-memory
      // armed-state) før bridge spawnet `app_game1_scheduled_games`-rad.
      // Når bridge senere spawnet runden ble armed-state IKKE konvertert
      // til DB-persistert `app_game1_ticket_purchases` → bongene
      // forsvant.
      //
      // Pickin'-logikk speiler `pickJoinableScheduledGameId` (linje 967):
      //   - scheduledGameId null      → vent på bridge
      //   - status idle/finished      → ingen runde tilgjengelig
      //   - status purchase_open/     → kjøp åpent, knapper aktive
      //     ready_to_start/running/
      //     paused
      //
      // `closed`-status (utenfor åpningstid / ingen plan) skal også
      // disable kjøp-knapper, men de vises da uansett ikke fordi
      // CenterBall idle-mode = "closed" + andre disable-paths slår inn.
      // For konsistens sender vi waiting=true også der.
      const joinableGameId = this.pickJoinableScheduledGameId(state);
      const purchaseAllowed = joinableGameId !== null;
      this.playScreen?.setWaitingForMasterPurchase(!purchaseAllowed);

      // Klient-auto-join-scheduled-game delta-watcher (Tobias 2026-05-11):
      //
      // Plan-advance scenario: master flytter posisjonen i spilleplanen,
      // backend spawner nytt scheduled-game-rad og lobby-broadcasten
      // oppdaterer `nextScheduledGame.scheduledGameId`. Klient som nettopp
      // joinet den FORRIGE runden må re-emit `game1:join-scheduled` mot
      // ny id slik at vi bytter til riktig rom.
      //
      // Upgrade-after-fallback (Tobias 2026-05-11): hvis initial join
      // gikk via `createRoom`-fallback (lobby hadde scheduledGameId=null
      // ved klient-last fordi auto-master ennå ikke hadde spawnet runden),
      // `this.joinedScheduledGameId` forblir null. Når lobby SENERE
      // oppdaterer med en joinable scheduledGameId må vi ALLIKEVEL kalle
      // `joinScheduledGame` slik at klient bytter fra ad-hoc-rommet til
      // det "ekte" scheduled-game-rommet. Pre-fix-bug krevde
      // `joinedScheduledGameId !== null` → delta-watcher trigget aldri
      // for klienter som lastet før første scheduled-game var spawnet.
      //
      // Vi re-joiner BARE når gameId-en faktisk endret seg (delta).
      // Pre-join state (joinedScheduledGameId=null) → upgrade hvis lobby
      // gir oss en gameId. Post-join state → re-join på plan-advance.
      // Andre felter (overallStatus, catalogDisplayName, ticketColors)
      // endrer seg uten at gameId endres — re-join på de ville vært
      // overflødig støy mot serveren.
      //
      // Wait-on-master-fix (Agent B, 2026-05-12): gjenbruker `joinableGameId`
      // beregnet over slik at vi ikke kaller `pickJoinableScheduledGameId`
      // to ganger per onChange-event.
      const nextScheduledGameId = joinableGameId;
      if (
        this.initialJoinComplete &&
        nextScheduledGameId !== null &&
        nextScheduledGameId !== this.joinedScheduledGameId
      ) {
        // Fire-and-forget: kjør re-join asynkront så onChange-listeneren
        // ikke blokkerer. Feil logges men kaster ikke ut — caller-state
        // forblir på forrige room til neste runde reload-er klient.
        //
        // RACE-FIX (Tobias 2026-05-11): gate på `initialJoinComplete` for
        // å unngå dobbel-join når lobbyStateBinding.start()-ack ankommer
        // FØR initial-join (linje under) har sendt sin join. Pre-fix:
        // delta-watcher og initial-join trigger samtidig på SAMME
        // scheduledGameId → server får 2 join-call → state inkonsistent
        // → klient kan ende i fallback eller bli umiddelbar tilbakeført
        // til lobby.
        void this.handleScheduledGameDelta(nextScheduledGameId);
      }
    });
    // Tobias-bug 2026-05-11: `await` istedenfor `void` — initial HTTP-fetch
    // må fullføre FØR createRoom slik at første room:update ikke overskriver
    // lobby-state-binding. Race-bug: hvis socket-ack ankommer før onChange-
    // listeren er aktiv, mistes første lobby-event og BuyPopup får aldri
    // displayName ("Bingo") eller ticketColors (3 farger fra plan-runtime).
    await this.lobbyStateBinding.start();

    // Join or create room
    this.loader.setState("JOINING_ROOM");
    // Klient-auto-join-scheduled-game (Tobias 2026-05-11):
    //
    // Bakgrunn — kritisk wiring-gap:
    //   Backend har `game1:join-scheduled`-handler (game1ScheduledEvents.ts
    //   :391-443) som binder rommet til en schedulert runde via
    //   `engine.createRoom` + `assignRoomCode`. Klient kalte tidligere
    //   utelukkende `socket.createRoom`, som returnerer per-hall ad-hoc
    //   room. Når master (eller demo-auto-master) starter den schedulerte
    //   runden, emittes `draw:new` til scheduled-game-rommet — klient
    //   lytter på ad-hoc-rommet og ser ingen baller.
    //
    // Fix:
    //   Hvis lobby-state har en joinable `nextScheduledGame.scheduledGameId`
    //   bruker vi `socket.joinScheduledGame` slik at klient lander i samme
    //   rom som engine senere broadcaster til. Hvis ingen scheduled-game
    //   er klar (ingen plan dekker, status=idle/finished, scheduledGameId
    //   er null osv.) faller vi tilbake til den eksisterende
    //   `socket.createRoom`-flyten — den feiler typisk og trigger
    //   `Game1LobbyFallback`-overlay-en (R1/BIN-822).
    //
    // Debug-logging (PR #1208, 2026-05-11): logger join-mode + ack-payload
    // bak `DEBUG_SPILL1_DRAWS`-flagget så vi kan SE hvilken roomCode klient
    // ender på uten å gjette.
    const lobbyStateAtJoinTime = this.lobbyStateBinding.getState();
    const initialScheduledGameId = this.pickJoinableScheduledGameId(
      lobbyStateAtJoinTime,
    );
    // Tracker (Tobias-direktiv 2026-05-12): bind hall + scheduled-game-id
    // som session-kontekst FØR vi tracker join-request, slik at exporten
    // alltid har basis-info selv om join feiler.
    const tracker = getEventTracker();
    tracker.setSessionContext({
      hallId: this.deps.hallId,
      scheduledGameId: initialScheduledGameId ?? null,
    });
    tracker.track("socket.emit", {
      event: initialScheduledGameId ? "joinScheduledGame" : "createRoom",
      hallId: this.deps.hallId,
      gameSlug: "bingo",
      scheduledGameId: initialScheduledGameId,
    });
    if (isSpill1DrawsDebugEnabled()) {
      console.log("[ROOM] join request", {
        mode: initialScheduledGameId ? "joinScheduledGame" : "createRoom",
        hallId: this.deps.hallId,
        gameSlug: "bingo",
        scheduledGameId: initialScheduledGameId,
      });
    }
    const joinResult = initialScheduledGameId
      ? await socket.joinScheduledGame({
          scheduledGameId: initialScheduledGameId,
          hallId: this.deps.hallId,
          playerName: this.resolvePlayerName(),
        })
      : await socket.createRoom({
          hallId: this.deps.hallId,
          gameSlug: "bingo",
        });
    // RACE-FIX (Tobias 2026-05-11): markér initial-join som ferdig FØR vi
    // sjekker resultat. Delta-watcher kan nå trygt overta for plan-advance.
    // Selv ved feil (joinResult.ok=false → fallback) settes flagget til true
    // slik at delta-watcher kan kalles når lobby-state senere oppdaterer
    // med joinable scheduledGameId.
    this.initialJoinComplete = true;
    if (initialScheduledGameId && joinResult.ok && joinResult.data) {
      this.joinedScheduledGameId = initialScheduledGameId;
      bridge.setScheduledGameId(initialScheduledGameId);
    }
    // Tracker (Tobias-direktiv 2026-05-12): join-ack. Track ok-status,
    // roomCode, playerId og evt. feil for senere diagnose.
    tracker.track("socket.recv", {
      event: "join:ack",
      ok: joinResult.ok,
      roomCode: joinResult.ok ? joinResult.data?.roomCode : null,
      playerId: joinResult.ok ? joinResult.data?.playerId : null,
      error: joinResult.ok ? null : joinResult.error,
    });
    if (joinResult.ok && joinResult.data) {
      tracker.setSessionContext({
        playerId: joinResult.data.playerId,
        roomCode: joinResult.data.roomCode,
      });
    }
    if (isSpill1DrawsDebugEnabled()) {
      console.log("[ROOM] join ack", {
        mode: initialScheduledGameId ? "joinScheduledGame" : "createRoom",
        ok: joinResult.ok,
        roomCode: joinResult.ok ? joinResult.data?.roomCode : null,
        playerId: joinResult.ok ? joinResult.data?.playerId : null,
        error: joinResult.ok ? null : joinResult.error,
      });
    }

    if (!joinResult.ok || !joinResult.data) {
      // R1 (BIN-822, 2026-05-08, Tobias-direktiv): istedenfor å vise
      // "FÅR IKKE KOBLET TIL ROM"-feilen direkte, mounter vi en lobby-
      // fallback-overlay som lytter på `spill1:lobby:{hallId}`-rommet og
      // viser "neste spill om X min" / "Stengt" mens vi venter. Når
      // master starter runden trigger lobby-state-update at vi reloader
      // siden — det re-initialiserer Game1Controller med en runde som
      // er klar til join.
      //
      // Reload er valgt over inline-retry fordi denne controlleren har
      // mye in-flight init-state (Pixi-stage, socket-listeners, bridge).
      // En full re-init er enklere og safer enn å "rewinde" tilstanden.
      console.warn(
        "[Game1] Room join feilet — mounter lobby-fallback istedenfor å vise feil:",
        joinResult.error,
      );
      this.loader.hide();
      // Spillerklient lobby-init-order-fix (2026-05-10): den pre-bygde
      // playScreen-en hører ikke hjemme bak lobby-fallback-overlay-en.
      // Riv den ned så den ikke ligger igjen og lekker ressurser eller
      // forstyrrer waitForSyncReady-pathene som aldri kjører i denne
      // failure-grenen.
      this.clearScreen();
      this.lobbyFallback = new Game1LobbyFallback({
        hallId: this.deps.hallId,
        socket: this.deps.socket,
        onShouldRetryJoin: () => {
          // Lobby-state indikerer at runden er klar — reload siden så
          // shell-en kan re-mounte spillet med fresh socket/Pixi-state.
          if (typeof window !== "undefined") {
            window.location.reload();
          }
        },
      });
      void this.lobbyFallback.start();
      return;
    }

    this.myPlayerId = joinResult.data.playerId;
    this.actualRoomCode = joinResult.data.roomCode;

    // Tobias 2026-05-11 debug-HUD: vis hvilket rom + hall klienten faktisk
    // havnet på. Aktiveres når `?debug=1` i URL eller localStorage
    // DEBUG_SPILL1_DRAWS=true. Fast-position top-right slik at vi alltid
    // ser om hall-default er isolert (rom-suffix `_HALL-DEFAULT` eller
    // `_DEMO-DEFAULT-GOH`) vs. om den deler rom med pilot-haller.
    this.mountDebugHud();

    // Spillerklient lobby-init-order-fix (2026-05-10): playScreen ble
    // pre-bygget med tom roomCode FØR `socket.createRoom`. Oppdater nå
    // så ChatPanelV2 kan laste historikk + sende meldinger med ekte
    // room-code. Idempotent — `setRoomCode` er no-op hvis verdien
    // allerede er den samme.
    this.playScreen?.setRoomCode(this.actualRoomCode);

    // Bug-fix 2026-05-04 (drawNew gap-loop, oppdaget på Spill 2):
    // applySnapshot MÅ kjøre FØR bridge.start(). SpilloramaSocket bufferer
    // broadcast-events (BIN-501) mens kanalen har 0 lyttere; første on()
    // drainer bufferen synkront. Hvis start() kjøres først setter den
    // lastAppliedDrawIndex til siste buffered drawIndex, deretter
    // overskriver applySnapshot bookkeeping bakover med snapshot.length-1
    // — som gir infinite resync-loop på etterfølgende live drawNew.
    // Spill 1 trekker saktere så buggen er sjeldnere observerbar her,
    // men race-en er like reell ved late-join til kjørende runde.
    bridge.applySnapshot(joinResult.data.snapshot);
    bridge.start(this.myPlayerId);

    this.unsubs.push(
      bridge.on("stateChanged", (state) => {
        // Tracker (Tobias-direktiv 2026-05-12): hver stateChange er en
        // mulig sannhets-source-of-truth-endring. Track kun safe-fields
        // (roomCode, gameStatus, drawn-count) — IKKE full state-payload
        // som ville lekke ticket-grids og pattern-data.
        tracker.track("state.change", {
          roomCode: state.roomCode,
          gameStatus: state.gameStatus,
          drawnNumbersLength: state.drawnNumbers.length,
        });
        if (isSpill1DrawsDebugEnabled()) {
          // 2026-05-11: stateChanged fyres på hver `room:update` (etter at
          // GameBridge.handleRoomUpdate har anvendt payloaden). Logger
          // roomCode/gameStatus/drawCount slik at klient kan verifisere
          // hvilket rom den faktisk sitter i + om rommet endrer status.
          console.log("[ROOM] room:update applied", {
            roomCode: state.roomCode,
            gameStatus: state.gameStatus,
            drawnNumbersLength: state.drawnNumbers.length,
          });
        }
        this.onStateChanged(state);
      }),
      bridge.on("gameStarted", (state) => {
        tracker.track("state.change", {
          event: "gameStarted",
          roomCode: state.roomCode,
          gameStatus: state.gameStatus,
        });
        this.onGameStarted(state);
      }),
      bridge.on("gameEnded", (state) => {
        tracker.track("state.change", {
          event: "gameEnded",
          roomCode: state.roomCode,
          gameStatus: state.gameStatus,
          drawnNumbersLength: state.drawnNumbers.length,
        });
        this.onGameEnded(state);
      }),
      bridge.on("numberDrawn", (num, idx, state) => {
        tracker.track("socket.recv", {
          event: "draw:new",
          ball: num,
          drawIndex: idx,
          roomCode: state.roomCode,
          drawnNumbersLength: state.drawnNumbers.length,
        });
        if (isSpill1DrawsDebugEnabled()) {
          // 2026-05-11: numberDrawn fyres etter at GameBridge.handleDrawNew
          // har validert drawIndex og oppdatert state.drawnNumbers. Hvis
          // dette ALDRI logges men `[ROOM] room:update applied` viser
          // running gameStatus → klient sitter i feil socket-rom og
          // mottar aldri `draw:new` direkte.
          console.log("[DRAW] received", {
            ball: num,
            drawIndex: idx,
            roomCode: state.roomCode,
            drawnNumbersLength: state.drawnNumbers.length,
          });
        }
        this.onNumberDrawn(num, idx, state);
      }),
      bridge.on("patternWon", (result, state) => {
        // Tracker: trygge felter — pattern-navn + drawIndex + claim-status.
        // IKKE full claim-payload (kan ha bong-data).
        tracker.track("socket.recv", pickSafeFields(
          result as unknown as Record<string, unknown>,
          ["patternName", "drawIndex", "claimType", "playerId"],
        ));
        this.onPatternWon(result, state);
      }),
      // BIN-690 PR-M6: scheduled-games mini-game protocol.
      bridge.on("miniGameTrigger", (data) => this.handleMiniGameTrigger(data)),
      bridge.on("miniGameResult", (data) => {
        // Tobias 2026-04-29: lagre mini-game-resultat for visning i
        // end-of-round-overlay. Reset i onGameStarted (ny runde).
        this.lastMiniGameResult = data;
        this.miniGame?.onResult(data);
      }),
      // Tobias prod-incident 2026-04-29: legacy `minigame:activated` for
      // auto-claim Spill 1 mini-games. Routes through LegacyMiniGameAdapter
      // which renders the existing overlays with synthesized M6 trigger
      // payloads, then routes the choice via legacy `minigame:play`.
      bridge.on("legacyMinigameActivated", (data) => this.handleLegacyMiniGameActivated(data)),
      // Tobias 2026-04-29 (post-orphan-fix UX): bet:rejected — server
      // varsler at forhåndskjøp ble avvist på game-start. Vis klar
      // feilmelding via toast og fjern pre-round-bonger via room:update
      // (server frigir reservasjonen så bonger forsvinner ved neste push).
      bridge.on("betRejected", (event) => this.onBetRejected(event)),
      // Tobias 2026-04-29 (post-orphan-fix UX): wallet:loss-state push.
      // Oppdater Kjøp Bonger-popup-headeren hvis åpen.
      bridge.on("walletLossStateChanged", (event) => this.onWalletLossStateChanged(event)),
    );

    // Lucky number picker (persists across screen transitions)
    const pickerContainer = this.deps.app.app.canvas.parentElement ?? document.body;
    this.luckyPicker = new LuckyNumberPicker(pickerContainer);
    this.luckyPicker.setOnSelect((n) => {
      void this.actions?.setLuckyNumber(n);
    });

    // Unlock audio
    this.root.eventMode = "static";
    this.root.on("pointerdown", () => this.deps.audio.unlock(), { once: true });

    // BIN-500: Loader-barriere.
    // En late-joiner kan komme inn mens en runde kjører. Før loader fjernes må
    // vi være sikre på at klienten rendrer samme tilstand som andre spillere:
    //   (a) socket connected  — allerede verifisert over
    //   (b) snapshot applied  — gjort via bridge.applySnapshot() like over
    //   (c) audio/SFX lastet  — preload ferdig (AudioManager.preloadSfx ble kalt i init)
    //   (d) hvis RUNNING: minst én live room:update ELLER numberDrawn mottatt
    //       (beviser at socket faktisk leverer — ikke bare er connected)
    await this.reconnectFlow.waitForSyncReady();

    // Hide loader — game is ready
    this.loader.setState("READY");

    // Transition based on state
    const state = bridge.getState();

    if (state.gameStatus === "RUNNING") {
      // BIN-507: late-joiner med billetter → PLAYING, uten → SPECTATING
      if (state.myTickets.length > 0) {
        this.transitionTo("PLAYING", state);
      } else {
        this.transitionTo("SPECTATING", state);
      }
    } else if (state.gameStatus === "ENDED") {
      // Tobias 2026-04-29 disconnect-resilience: bruker har koblet til
      // (eller re-koblet) i en ENDED-tilstand. Vis end-of-round-overlay
      // så de ser oppsummeringen i stedet for tom WAITING-skjerm uten
      // kontekst. Dette dekker også reload-mid-overlay-scenariet.
      this.transitionTo("ENDED", state);
      this.showEndOfRoundOverlayForState(state);
    } else {
      this.transitionTo("WAITING", state);
    }
  }

  resize(width: number, height: number): void {
    if (this.playScreen) {
      this.playScreen.resize(width, height);
    }
  }

  destroy(): void {
    if (this.endScreenTimer) { clearTimeout(this.endScreenTimer); this.endScreenTimer = null; }
    this.luckyPicker?.destroy();
    this.luckyPicker = null;
    this.loader?.destroy();
    this.loader = null;
    this.toast?.destroy();
    this.toast = null;
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
    this.winPopup?.destroy();
    this.winPopup = null;
    this.winScreen?.destroy();
    this.winScreen = null;
    this.endOfRoundOverlay?.destroy();
    this.endOfRoundOverlay = null;
    this.lastMiniGameResult = null;
    this.settingsPanel?.destroy();
    this.settingsPanel = null;
    this.markerBgPanel?.destroy();
    this.markerBgPanel = null;
    this.gamePlanPanel?.destroy();
    this.gamePlanPanel = null;
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.miniGame?.destroy();
    this.miniGame = null;
    this.legacyMiniGame?.destroy();
    this.legacyMiniGame = null;
    this.pendingLegacyMiniGame = null;
    this.actions = null;
    this.reconnectFlow = null;
    // R1 (BIN-822): cleanup lobby-fallback overlay + socket-subscribe.
    this.lobbyFallback?.stop();
    this.lobbyFallback = null;
    // Spillerklient-rebuild Fase 1 (2026-05-10): cleanup plan-runtime
    // aggregator-binding. Stopp polling-timer + unsubscribe socket-rom +
    // tøm listener-set.
    if (this.lobbyStateUnsub) {
      this.lobbyStateUnsub();
      this.lobbyStateUnsub = null;
    }
    this.lobbyStateBinding?.stop();
    this.lobbyStateBinding = null;
    // 2026-05-11 (Tobias-direktiv): `WaitingForMasterOverlay` er fjernet
    // helt. Idle-tekst eier nå av CenterBall som ryddes opp via
    // `root.destroy({ children: true })`.
    this.clearScreen();
    this.unmountDebugHud();
    this.root.destroy({ children: true });
  }

  // ── Debug-HUD (Tobias 2026-05-11) ───────────────────────────────────────
  //
  // Vis fast-position-banner top-right med:
  //   roomCode | hallId | playerId | scheduledGameId | drawInterval
  //
  // Aktiveres når `?debug=1` i URL eller localStorage DEBUG_SPILL1_DRAWS=true.
  // Lar Tobias verifisere fra spillerklienten at hall-default er isolert
  // (rom-suffix `_DEMO-DEFAULT-GOH` med kun seg selv som medlem) vs. om den
  // deler rom med andre haller.

  private debugHudEl: HTMLDivElement | null = null;
  private debugHudTextEl: HTMLPreElement | null = null;

  private isDebugHudEnabled(): boolean {
    try {
      if (typeof window === "undefined") return false;
      const params = new URLSearchParams(window.location.search);
      if (params.get("debug") === "1") return true;
      if (params.get("debug") === "true") return true;
      const ls = typeof window.localStorage !== "undefined"
        ? window.localStorage.getItem("DEBUG_SPILL1_DRAWS")
        : null;
      return ls?.trim().toLowerCase() === "true";
    } catch {
      return false;
    }
  }

  /**
   * Resolve debug-stream-token. Strategi (Tobias-direktiv 2026-05-12):
   *   1. URL `?debugToken=<token>` — ad-hoc-override for ny tester
   *   2. localStorage `SPILL1_DEBUG_STREAM_TOKEN` — vedvarende på samme browser
   *   3. Default `spillorama-2026-test` — matcher `RESET_TEST_PLAYERS_TOKEN`-
   *      default-en på dev-server. Streameren håndterer 401/403 fail-soft,
   *      så et feil default-token er kun mer støy i devtools, ikke en bug.
   */
  private resolveDebugStreamToken(): string {
    try {
      if (typeof window === "undefined") return "spillorama-2026-test";
      const params = new URLSearchParams(window.location.search);
      const fromQuery = params.get("debugToken")?.trim();
      if (fromQuery) return fromQuery;
      const fromLs =
        typeof window.localStorage !== "undefined"
          ? window.localStorage.getItem("SPILL1_DEBUG_STREAM_TOKEN")?.trim()
          : null;
      if (fromLs) return fromLs;
      return "spillorama-2026-test";
    } catch {
      return "spillorama-2026-test";
    }
  }

  private mountDebugHud(): void {
    if (!this.isDebugHudEnabled()) return;
    if (typeof document === "undefined") return;
    if (this.debugHudEl) {
      this.updateDebugHud();
      return;
    }
    const hud = document.createElement("div");
    hud.id = "spill1-debug-hud";
    hud.style.cssText = [
      "position: fixed",
      "top: 8px",
      "right: 8px",
      "z-index: 999999",
      "background: rgba(0, 0, 0, 0.85)",
      "color: #0f0",
      "font-family: ui-monospace, SFMono-Regular, Menlo, monospace",
      "font-size: 11px",
      "line-height: 1.4",
      "padding: 8px 10px",
      "border-radius: 6px",
      "border: 1px solid #0f0",
      "max-width: 320px",
      "white-space: pre-wrap",
      // Inner "Dump"-knapp må kunne klikkes — derfor enable pointer-events
      // og la kun text-node-en være pointer-events: none via display.
      "pointer-events: auto",
      "box-shadow: 0 2px 8px rgba(0,0,0,0.5)",
    ].join(";");
    document.body.appendChild(hud);
    this.debugHudEl = hud;
    // Status-text legges i et eget <pre>-element så `updateDebugHud` ikke
    // overskriver dump-knappen vi appender lenger ned.
    const textEl = document.createElement("pre");
    textEl.style.cssText = "margin: 0; padding: 0; white-space: pre-wrap; font: inherit; color: inherit;";
    hud.appendChild(textEl);
    this.debugHudTextEl = textEl;
    this.updateDebugHud();

    // Tobias-direktiv 2026-05-12: "Dump diagnose"-knapp i debug-HUD-en.
    // Trigger en JSON-download med hele event-log + session-kontekst.
    // Aktiveres bak samme `?debug=1`-flagg som HUD-en.
    const dumpBtn = document.createElement("button");
    dumpBtn.textContent = "⬇ Dump diagnose";
    dumpBtn.title = "Last ned JSON-rapport (event-log + session-context)";
    dumpBtn.style.cssText = [
      "display: block",
      "width: 100%",
      "margin-top: 6px",
      "background: rgba(0, 200, 0, 0.25)",
      "color: #fff",
      "border: 1px solid #0f0",
      "border-radius: 3px",
      "padding: 4px 8px",
      "font-family: inherit",
      "font-size: 11px",
      "cursor: pointer",
    ].join(";");
    dumpBtn.addEventListener("click", () => this.handleDebugDump());
    hud.appendChild(dumpBtn);

    // Tobias-direktiv 2026-05-13: "📸 Rapporter bug nå" — rød prominent
    // knapp som ber backenden bundle alt (klient-state, pilot-monitor,
    // backend-log, klient-events, DB-state) i ÉN markdown-rapport som
    // PM-agenten kan lese med ett verktøykall.
    const reportBugBtn = document.createElement("button");
    reportBugBtn.textContent = "📸 Rapporter bug";
    reportBugBtn.title =
      "Send komplett bug-rapport til PM-agenten (klient-state + events + DB + logs)";
    reportBugBtn.setAttribute("data-testid", "report-bug-now-hud");
    reportBugBtn.style.cssText = [
      "display: block",
      "width: 100%",
      "margin-top: 4px",
      "background: #b8281f",
      "color: #fff",
      "font-weight: 700",
      "border: 1px solid #ff5c5c",
      "border-radius: 3px",
      "padding: 4px 8px",
      "font-family: inherit",
      "font-size: 11px",
      "cursor: pointer",
      "box-shadow: 0 2px 4px rgba(255,92,92,0.4)",
    ].join(";");
    reportBugBtn.addEventListener("click", () => {
      // Delegér til DebugEventLogPanel sin handleReportBug — den har
      // all logikken (prompt, payload-bygging, POST, status-visning).
      // Hvis panelet ikke er montert (test-miljø), gjør lokal fallback.
      if (this.debugEventPanel) {
        // Public-API-er er knappen i panelet — vi simulerer et klikk.
        const panelBtn = document.querySelector<HTMLButtonElement>(
          '[data-testid="report-bug-now"]',
        );
        if (panelBtn) {
          panelBtn.click();
          return;
        }
      }
      // Fallback: kjør JSON-dump
      this.handleDebugDump();
    });
    hud.appendChild(reportBugBtn);

    // Mount full event-log-panel (top-left, separat fra denne HUD-en
    // top-right) — viser real-time event-strøm med filter + clear.
    if (!this.debugEventPanel) {
      this.debugEventPanel = new DebugEventLogPanel();
      try {
        this.debugEventPanel.mount();
      } catch (err) {
        // Panel-mount er best-effort; må ikke ta ned spillet.
        console.warn("[Game1] DebugEventLogPanel mount feilet:", err);
      }
    }

    // Konfigurer "Rapporter bug nå"-knappen i panelet med token og
    // collectors. PM-agent får full klient-state i én rapport-fil.
    if (this.debugEventPanel) {
      try {
        this.debugEventPanel.setBugReportOptions({
          token: this.resolveDebugStreamToken(),
          collectClientState: () => ({
            phase: this.phase,
            roomCode: this.actualRoomCode,
            joinedScheduledGameId: this.joinedScheduledGameId,
            myPlayerId: this.myPlayerId,
            hallId: this.deps.hallId,
          }),
          collectCurrentScreen: () => this.phase ?? null,
          collectLastUserAction: () => {
            // Plukk siste user.click fra event-tracker hvis tilgjengelig
            try {
              const events = getEventTracker().getEvents();
              for (let i = events.length - 1; i >= 0; i--) {
                if (events[i].type === "user.click") {
                  const label = events[i].payload?.["label"];
                  return typeof label === "string" ? label : null;
                }
              }
            } catch {
              /* ignore */
            }
            return null;
          },
        });
      } catch (err) {
        console.warn("[Game1] setBugReportOptions feilet:", err);
      }
    }

    // ConsoleBridge (Tobias-direktiv 2026-05-13): pipe relevant client-
    // console-output ([BUY-DEBUG], [ROOM], [CLI-BINGO], etc.) til
    // EventTracker så server-side monitor-agent ser samme data som Tobias
    // ser i devtools. Gated på ?debug=1, idempotent installasjon, inert
    // i prod. MUST komme FØR EventStreamer.start() så første console-
    // bridged events også når streameren.
    try {
      installConsoleBridge();
    } catch (err) {
      // Bridge er best-effort — fail-soft.
      // eslint-disable-next-line no-console
      console.warn("[Game1] installConsoleBridge feilet:", err);
    }

    // FetchInstrument (Tobias-direktiv 2026-05-13): wrapper rundt
    // globalThis.fetch — logger alle REST-kall til EventTracker.
    // Gated på debug-flagg, idempotent, fail-soft.
    // (OBS-1 FetchBridge supersedet — samme wrapper-mønster men eldre.)
    try {
      installFetchInstrument();
    } catch (err) {
      console.warn("[Game1] installFetchInstrument feilet:", err);
    }

    // ErrorHandler (Tobias-direktiv 2026-05-13): fang window.onerror +
    // unhandledrejection — viktig for live-monitor å se runtime-issues.
    try {
      installErrorHandler();
    } catch (err) {
      console.warn("[Game1] installErrorHandler feilet:", err);
    }

    // SocketEmitInstrument (Tobias-direktiv 2026-05-13): proxy public
    // emit-metoder på den live SpilloramaSocket-instansen. Wrapper-pattern
    // så vi ikke editer net/SpilloramaSocket.ts. Idempotent.
    try {
      const socket = this.deps.socket as unknown as object;
      if (socket && typeof socket === "object") {
        installSocketEmitInstrument(socket);
      }
    } catch (err) {
      console.warn("[Game1] installSocketEmitInstrument feilet:", err);
    }

    // Auto-stream tracker-events til backend (Tobias-direktiv 2026-05-12).
    // Hver 2. sek POST'es nye events til /api/_dev/debug/events slik at en
    // live-monitoring-agent kan lese dem mens Tobias tester. Fail-soft —
    // hvis backend er nede eller token mangler, faller vi tilbake til
    // "Dump diagnose"-knappen.
    if (!this.debugEventStreamer) {
      try {
        const tracker = getEventTracker();
        this.debugEventStreamer = new EventStreamer({
          token: this.resolveDebugStreamToken(),
          // Default endpoint /api/_dev/debug/events
          // Default flushIntervalMs 2000
        });
        this.debugEventStreamer.start(tracker);
      } catch (err) {
        // Streameren krever fetch — i Node-test-miljø er det fint at vi
        // bare logger warn og fortsetter uten streaming.
        console.warn("[Game1] EventStreamer start feilet:", err);
        this.debugEventStreamer = null;
      }
    }

    // Rrweb DOM session-replay (Tobias-direktiv 2026-05-13). Lar PM-agent
    // se NØYAKTIG hva Tobias så som video — DOM-mutations, mouse, scroll,
    // input — komplementerer EventStreamer (data-events) med visuell replay.
    // Lazy-loader rrweb (~80 KB) først ved start(), så prod-bundle uten
    // ?debug=1 ikke trekker det inn. Fail-soft: hvis rrweb mangler eller
    // backend er nede, logger vi warn og fortsetter uten replay.
    if (!getRrwebRecorder()) {
      try {
        const recorder = setupRrwebRecorder({
          token: this.resolveDebugStreamToken(),
          // Default endpoint /api/_dev/debug/rrweb-events
          // Default flushIntervalMs 2000
          // Default recordCanvas true (fange Pixi.js-rendering)
        });
        // start() er async; fire-and-forget — controller blokkerer ikke
        // på rrweb-init. Fail-soft inni recorder.
        void recorder.start().catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.warn("[Game1] RrwebRecorder start feilet:", err);
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[Game1] RrwebRecorder setup feilet:", err);
      }
    }
  }

  /**
   * Tobias-direktiv 2026-05-12: bygg JSON-rapport fra event-tracker og
   * trigger fil-download. Brukeren sender filen til PM/agent for diagnose.
   *
   * Fail-soft: hvis Blob/URL-API ikke er tilgjengelig (eller download
   * blokkeres av browser-sandbox), faller vi tilbake til
   * `console.log("[DEBUG-EXPORT]", report)` så Tobias kan kopiere fra
   * devtools-console.
   */
  private handleDebugDump(): void {
    try {
      const tracker = getEventTracker();
      // Sørg for at session-context er ferskest mulig før dump.
      tracker.setSessionContext({
        playerId: this.myPlayerId,
        roomCode: this.actualRoomCode || null,
        scheduledGameId: this.joinedScheduledGameId,
        currentScreen: this.phase,
      });
      const report = tracker.export();
      const json = JSON.stringify(report, null, 2);
      if (
        typeof Blob === "undefined" ||
        typeof URL === "undefined" ||
        typeof document === "undefined"
      ) {
        console.log("[DEBUG-EXPORT]", report);
        this.toast?.info("Diagnose dumpet til console (browser støtter ikke fil-download).");
        return;
      }
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `spillorama-debug-${ts}.json`;
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.toast?.info(`Diagnose lastet ned: ${filename}`);
    } catch (err) {
      console.error("[Game1] Debug dump feilet:", err);
      this.toast?.error("Kunne ikke laste ned diagnose-fil. Se devtools-console.");
    }
  }

  private updateDebugHud(): void {
    if (!this.debugHudEl) return;
    const hallId = this.deps.hallId ?? "(none)";
    const roomCode = this.actualRoomCode || "(none)";
    const playerId = this.myPlayerId ?? "(none)";
    const scheduledGameId = this.joinedScheduledGameId ?? "(none)";
    // Sniff isolation status fra roomCode-suffix.
    let isolation = "?";
    if (roomCode.includes("DEMO-DEFAULT-GOH")) {
      isolation = "ISOLERT (default-GoH, kun hall-default)";
    } else if (roomCode.includes("DEMO-PILOT-GOH")) {
      isolation = "DELT (4 demo-pilot-haller)";
    } else if (roomCode.startsWith("BINGO_")) {
      isolation = "GoH-binding " + roomCode.replace("BINGO_", "");
    }
    // Tobias-direktiv 2026-05-13: live-counter for tracker-events +
    // siste anomali (error/warn). Gir PM-agenten visuell bekreftelse
    // på at instrumenteringen kjører.
    let eventsLine = "events: (tracker n/a)";
    let lastAnomalyLine = "lastErr: —";
    try {
      const tracker = getEventTracker();
      const events = tracker.getEvents();
      eventsLine = `events: 📊 ${events.length}`;
      // Finn siste error.client / console.error / console.warn
      for (let i = events.length - 1; i >= 0; i--) {
        const t = events[i].type;
        if (
          t === "error.client" ||
          t === "console.error" ||
          t === "console.warn"
        ) {
          const ageSec = Math.floor((Date.now() - events[i].timestamp) / 1000);
          const msg = events[i].payload?.["message"] ?? events[i].payload?.["tag"] ?? t;
          lastAnomalyLine = `🔴 ${t} (${ageSec}s siden) ${String(msg).slice(0, 32)}`;
          break;
        }
      }
    } catch {
      /* tracker kanskje ikke init enda */
    }
    const text = [
      "🐛 SPILL1 DEBUG-HUD",
      `room  : ${roomCode}`,
      `hall  : ${hallId}`,
      `player: ${playerId.slice(0, 8)}…`,
      `sched : ${scheduledGameId === "(none)" ? "(none)" : scheduledGameId.slice(0, 8) + "…"}`,
      `isol  : ${isolation}`,
      eventsLine,
      lastAnomalyLine,
    ].join("\n");
    // Skriv til separat <pre>-element så dump-knappen ikke wipes ut.
    // Fallback til hele HUD-elementet hvis text-el ikke er init enda.
    const target = this.debugHudTextEl ?? this.debugHudEl;
    target.textContent = text;
  }

  private unmountDebugHud(): void {
    if (this.debugHudEl) {
      this.debugHudEl.remove();
      this.debugHudEl = null;
      this.debugHudTextEl = null;
    }
    if (this.debugEventPanel) {
      try {
        this.debugEventPanel.unmount();
      } catch {
        // Best-effort.
      }
      this.debugEventPanel = null;
    }
    if (this.debugEventStreamer) {
      try {
        this.debugEventStreamer.stop();
      } catch {
        // Best-effort.
      }
      this.debugEventStreamer = null;
    }
    // Rrweb DOM session-replay teardown (Tobias-direktiv 2026-05-13).
    // resetRrwebRecorder() kaller stop() + clearer singleton — neste mount
    // får en frisk recorder.
    try {
      resetRrwebRecorder();
    } catch {
      // Best-effort.
    }
  }

  // ── Klient-auto-join-scheduled-game (Tobias 2026-05-11) ──────────────────

  /**
   * Returner `scheduledGameId` fra lobby-state HVIS runden er joinable
   * (status ∈ {purchase_open, ready_to_start, running, paused}). Ellers null.
   *
   * Server håndhever joinable-status (game1ScheduledEvents.ts:79-80,
   * JOINABLE_STATUSES). Vi speiler den whitelisten her så vi unngår
   * unødvendige server-roundtrips for idle/finished/scheduled-runder —
   * de vil uansett kaste GAME_NOT_JOINABLE.
   *
   * Returnerer null hvis:
   *   - state er null (lobby-binding har ikke lastet enda)
   *   - ingen plan dekker (`nextScheduledGame === null`)
   *   - scheduledGameId er null (plan-runtime har ikke spawnet rom enda)
   *   - status er idle/finished/upcoming/completed/cancelled
   */
  private pickJoinableScheduledGameId(
    state: ReturnType<Game1LobbyStateBinding["getState"]>,
  ): string | null {
    const next = state?.nextScheduledGame;
    if (!next) return null;
    if (!next.scheduledGameId) return null;
    if (
      next.status !== "purchase_open" &&
      next.status !== "ready_to_start" &&
      next.status !== "running" &&
      next.status !== "paused"
    ) {
      return null;
    }
    return next.scheduledGameId;
  }

  /**
   * Hent display-navnet til den innloggede spilleren fra sessionStorage.
   *
   * Backend-schema for `game1:join-scheduled` krever
   * `playerName: z.string().min(1).max(50)`. Selv om server uansett
   * henter wallet-eier via accessToken, må feltet være satt for at
   * Zod-validering skal passere. `accessToken`-utvalg gjør oss
   * resilient — payload sendes ikke uten den uansett (se
   * SpilloramaSocket.emit).
   *
   * Sessionkey `spillorama.dev.user` settes både av dev-auto-login
   * (main.ts) og av shell-en (lobby.js → mountGame). Hvis vi ikke
   * finner navnet, default-er vi til "Spiller" så feltet validerer.
   */
  private resolvePlayerName(): string {
    if (typeof sessionStorage === "undefined") return "Spiller";
    try {
      const raw = sessionStorage.getItem("spillorama.dev.user");
      if (!raw) return "Spiller";
      const parsed = JSON.parse(raw) as { displayName?: unknown };
      const name = typeof parsed.displayName === "string"
        ? parsed.displayName.trim()
        : "";
      if (!name) return "Spiller";
      return name.length > 50 ? name.slice(0, 50) : name;
    } catch {
      return "Spiller";
    }
  }

  /**
   * Re-join når lobby-state-binding rapporterer ny `scheduledGameId`
   * (plan-advance). Hentes inn async fra delta-watcher i `onChange`.
   *
   * Pragmatisk scope: re-emit `game1:join-scheduled` med ny id, oppdater
   * `actualRoomCode`, og applieser fresh snapshot på bridge. Bridge
   * håndterer state-overgang via `applySnapshot` — ingen ekstra
   * `bridge.start`-kall siden bridge allerede er i drift.
   *
   * Hvis re-join feiler logges advarsel og state forblir uendret. Neste
   * onChange-tick vil prøve igjen hvis gameId fortsatt differer (caller
   * sjekker `joinedScheduledGameId !== nextScheduledGameId`).
   */
  private async handleScheduledGameDelta(
    nextScheduledGameId: string,
  ): Promise<void> {
    const previous = this.joinedScheduledGameId;
    console.info(
      `[Game1Controller] plan-advance: ${previous} → ${nextScheduledGameId}, re-joining scheduled game`,
    );
    try {
      const result = await this.deps.socket.joinScheduledGame({
        scheduledGameId: nextScheduledGameId,
        hallId: this.deps.hallId,
        playerName: this.resolvePlayerName(),
      });
      if (!result.ok || !result.data) {
        // Tobias-bug 2026-05-11: PLAYER_ALREADY_IN_ROOM betyr at klient
        // er allerede i samme socket-rom (initial-join via createRoom-
        // fallback landet oss på samme canonical roomCode som scheduled-
        // game's room_code). Lokal state er stale (NONE, drawn=[]) men
        // server-state har scheduled-game-engine RUNNING. Fix: bruk
        // `room:resume` for å hente fresh snapshot + applySnapshot på
        // bridge → klient sync-er til scheduled-game-state uten å
        // duplicate-joine.
        const errCode = (result.error as { code?: string } | undefined)?.code;
        if (errCode === "PLAYER_ALREADY_IN_ROOM" && this.actualRoomCode) {
          console.info(
            "[Game1Controller] PLAYER_ALREADY_IN_ROOM — bruker room:resume for å sync state",
          );
          try {
            const resume = await this.deps.socket.resumeRoom({
              roomCode: this.actualRoomCode,
              scheduledGameId: nextScheduledGameId,
            });
            if (resume.ok && resume.data?.snapshot) {
              this.joinedScheduledGameId = nextScheduledGameId;
              this.deps.bridge.setScheduledGameId(nextScheduledGameId);
              this.deps.bridge.applySnapshot(resume.data.snapshot);
              this.updateDebugHud();
              return;
            }
            console.warn(
              "[Game1Controller] room:resume etter PLAYER_ALREADY_IN_ROOM feilet:",
              resume.ok ? "no snapshot" : resume.error,
            );
          } catch (resumeErr) {
            console.warn(
              "[Game1Controller] room:resume threw etter PLAYER_ALREADY_IN_ROOM:",
              resumeErr,
            );
          }
          return;
        }
        console.warn(
          "[Game1Controller] re-join scheduled game feilet — beholder forrige room:",
          result.error,
        );
        return;
      }
      this.joinedScheduledGameId = nextScheduledGameId;
      this.deps.bridge.setScheduledGameId(nextScheduledGameId);
      this.actualRoomCode = result.data.roomCode;
      this.playScreen?.setRoomCode(this.actualRoomCode);
      // Bridge er allerede startet — applySnapshot resync-er state mot
      // den nye runden uten å rive ned listeners.
      this.deps.bridge.applySnapshot(result.data.snapshot);
      this.updateDebugHud();
    } catch (err) {
      console.warn("[Game1Controller] re-join threw — beholder forrige room:", err);
    }
  }

  // ── State transitions ─────────────────────────────────────────────────

  private transitionTo(phase: Phase, state: GameState): void {
    // OBS-5: PostHog analytics — record every screen transition. Lets us
    // build retention + drop-off funnels in PostHog (e.g. how many
    // players make it from WAITING → PLAYING → ENDED in a single
    // session). Fire-and-forget; never blocks the transition.
    posthogTrackEvent("client.screen.transition", {
      from: this.phase,
      to: phase,
      scheduledGameId: this.joinedScheduledGameId,
      gameStatus: state.gameStatus,
      myTicketCount: state.myTickets.length,
    });

    // OBS-1 (cascade-merge 2026-05-14): KOMPLEMENTERER PostHog-eventen over —
    // skriver samme transition også til lokal EventTracker (→ jsonl). Bra ved
    // off-line debugging og bug-rapport-bundle som ikke har internett til
    // PostHog. Fail-soft — tracker er best-effort.
    const previousPhase = this.phase;
    try {
      if (previousPhase !== phase) {
        getEventTracker().track("screen.transition", {
          from: previousPhase,
          to: phase,
          gameStatus: state.gameStatus,
          drawIndex:
            (state as { drawnNumbers?: unknown[] }).drawnNumbers?.length ?? 0,
        });
      }
    } catch {
      /* tracker er best-effort */
    }
    this.phase = phase;

    const w = this.deps.app.app.screen.width;
    const h = this.deps.app.app.screen.height;

    switch (phase) {
      case "WAITING":
      case "PLAYING":
      case "SPECTATING": {
        // Spillerklient lobby-init-order-fix (2026-05-10): GJENBRUK eksisterende
        // playScreen i stedet for å destroye + rebuilde. Pre-creation i `start()`
        // gjør at playScreen er bygget FØR `socket.createRoom`, og lobby-state-
        // update-listeneren har allerede oppdatert subtitle + ticket-config +
        // overall-status mot den instansen. Et rebuild her ville rive ned
        // disse oppdateringene og kreve at lobby-listeneren fyrer på nytt før
        // UI igjen var korrekt — det er nettopp den race-en vi fikser.
        //
        // Build kun hvis playScreen er null (typisk etter en transition til
        // ENDED som destroyet skjermen, eller første gang i en re-init flyt).
        if (this.playScreen === null) {
          this.playScreen = this.buildPlayScreen(w, h);
          this.setScreen(this.playScreen);
        }

        // All three "game-visible" phases share one PlayScreen setup. The new
        // `update(state)` method picks what to show based on gameStatus /
        // ticket arrays — no per-phase build/render juggling. Callbacks are
        // wired once at construction (they used to be re-wired in every
        // transition, three copies of the exact same 8-line block).
        this.playScreen.update(state);
        this.playScreen.enableBuyMore();

        // BIN-419 Elvis replace — only shown in WAITING with existing tickets.
        // Spillerklient lobby-init-order-fix (2026-05-10): siden vi nå
        // gjenbruker playScreen-instansen mellom WAITING/PLAYING/SPECTATING-
        // transisjoner, må vi eksplisitt fjerne Elvis-baren ved transisjon
        // til PLAYING/SPECTATING. Tidligere ble hele skjermen destroyet, så
        // baren forsvant via `playScreen.destroy()`.
        if (
          phase === "WAITING"
          && state.gameType === "elvis"
          && state.myTickets.length > 0
          && state.replaceAmount > 0
        ) {
          this.playScreen.showElvisReplace(state.replaceAmount, () => {
            void this.actions?.elvisReplace();
          });
        } else {
          this.playScreen.hideElvisReplace();
        }
        break;
      }

      case "ENDED":
        // Tobias 2026-04-29 prod-incident-fix: ENDED-fasen viser ikke lenger
        // en Pixi-skjerm — i stedet bruker vi `Game1EndOfRoundOverlay` (HTML)
        // som monteres i onGameEnded(). Vi destroyer PlayScreen-instansen så
        // den ikke ligger igjen og lekker mens overlay vises. Neste transition
        // til WAITING/PLAYING/SPECTATING bygger en ny playScreen via
        // `buildPlayScreen` (jf. null-sjekk over).
        this.clearScreen();
        break;
    }
  }

  // ── Bridge event handlers ─────────────────────────────────────────────

  private onStateChanged(state: GameState): void {
    // ROUND-TRANSITION-FIX (Tobias 2026-04-27): defensiv recovery hvis
    // gameStarted-event ble droppet (race med endScreenTimer eller socket-
    // reorder): hvis state viser RUNNING men vi sitter fast i ENDED, hopp
    // direkte til PLAYING (har tickets) eller SPECTATING (ingen tickets).
    // Uten denne sjekken må bruker refreshe nettleseren mellom runder.
    if (this.phase === "ENDED" && state.gameStatus === "RUNNING") {
      if (this.endScreenTimer) {
        clearTimeout(this.endScreenTimer);
        this.endScreenTimer = null;
      }
      // Tobias 2026-04-29: lukk end-of-round-overlay før transition.
      this.endOfRoundOverlay?.hide();
      if (state.myTickets.length > 0) {
        this.transitionTo("PLAYING", state);
      } else {
        this.transitionTo("SPECTATING", state);
      }
      return;
    }

    // Tobias 2026-04-29 disconnect-resilience: hvis vi er i ENDED-fase
    // (overlay var oppe) og bare nettopp re-syncede etter reconnect,
    // sørg for at overlay fortsatt vises. Game1ReconnectFlow kan ha
    // forsynt en applySnapshot som triggrer denne stateChanged uten
    // at gameEnded-eventen fyrer på nytt.
    //
    // Demo-blocker-fix 2026-04-29: hold tilbake overlay hvis mini-game
    // er aktiv eller står i kø — vinneren MÅ få spille mini-game ferdig
    // før vi viser end-of-round-summary.
    const miniGameActive =
      this.miniGame?.isActive() === true ||
      this.legacyMiniGame?.isActive() === true ||
      this.pendingMiniGameTrigger !== null ||
      this.pendingLegacyMiniGame !== null;

    if (
      this.phase === "ENDED" &&
      state.gameStatus === "ENDED" &&
      this.endOfRoundOverlay &&
      !this.endOfRoundOverlay.isVisible() &&
      !this.isWinScreenActive &&
      !miniGameActive
    ) {
      this.showEndOfRoundOverlayForState(state);
    }

    // Tobias UX-mandate 2026-04-29 (revised): overlay forblir oppe inntil
    // controller signalerer "rommet har live-state klar". Vi tolker
    // FØRSTE state-update etter at overlay ble vist som signal om at
    // server har sendt fersk room-snapshot. 50ms-grace beskytter mot at
    // den same-tick state-changen som triggret show()-kallet kvalifiserer
    // som ready-signal — det skal være _neste_ state-update.
    if (
      this.endOfRoundOverlay?.isVisible() &&
      this.endOfRoundOverlayShownAt !== null &&
      Date.now() > this.endOfRoundOverlayShownAt + 50
    ) {
      this.endOfRoundOverlay.markRoomReady();
    }

    // Single update() entry point. Replaces the old three-way split
    // (updateWaitingState / updateInfo / renderPreRoundTickets + UpcomingPurchase).
    // PlayScreen picks what to show from state.gameStatus + ticket arrays.
    if (this.playScreen && (this.phase === "WAITING" || this.phase === "PLAYING" || this.phase === "SPECTATING")) {
      this.playScreen.update(state);
    }

    // BIN-460: Show/hide pause overlay based on game state.
    // BLINK-FIX (round 3, bonus): Fjernet "Spillet er gjenopptatt"-toast.
    // Under auto-pause-flyt (phase-won → kort pause → resume) er den
    // overlappende toast-fade + pause-fade + ny ball-trekk en hovedmistenkt
    // for blink-effekten. Toasten gir ingen verdi når overlay uansett bare
    // var synlig i ~1s under en automatisk overgang.
    if (state.isPaused && !this.pauseOverlay?.isShowing()) {
      // MED-11: passere pauseUntil/pauseReason så overlay kan vise countdown
      // eller en konkret norsk fallback-tekst i stedet for "Spillet er pauset".
      this.pauseOverlay?.show({
        message: state.pauseMessage ?? undefined,
        pauseUntil: state.pauseUntil,
        pauseReason: state.pauseReason,
      });
    } else if (state.isPaused && this.pauseOverlay?.isShowing()) {
      // Allerede synlig — oppdater innholdet hvis backend har sendt nye
      // verdier (f.eks. master forlenget pausen).
      this.pauseOverlay.updateContent({
        message: state.pauseMessage ?? undefined,
        pauseUntil: state.pauseUntil,
        pauseReason: state.pauseReason,
      });
    } else if (!state.isPaused && this.pauseOverlay?.isShowing()) {
      this.pauseOverlay?.hide();
    }
  }

  private onGameStarted(state: GameState): void {
    // ROUND-TRANSITION-FIX (Tobias 2026-04-27): hvis EndScreen-timer fortsatt
    // løper fra forrige runde, cancel den og hopp DIREKTE til ny runde —
    // ellers henger klient i ENDED til timeren firer (5s vindu) og glipper
    // start-events for neste runde, slik at bruker må refreshe nettleseren.
    if (this.endScreenTimer) {
      clearTimeout(this.endScreenTimer);
      this.endScreenTimer = null;
    }

    // Tobias 2026-04-29 prod-incident-fix: lukk end-of-round-overlay hvis
    // ny runde starter mens den fortsatt er åpen (rask auto-round).
    // Spilleren vil ellers se overlay-en oppå ny runde-state.
    this.endOfRoundOverlay?.hide();
    this.shouldShowEndOfRoundOnWinScreenDismiss = false;
    // Tobias UX-mandate 2026-04-29 (fluid 3-phase): reset timestamp og
    // buy-popup-trigger-guard for ny runde.
    this.roundEndedAt = null;
    this.buyPopupOpenedFromOverlay = false;
    // Tobias UX-mandate 2026-04-29 (revised): reset overlay-shown-timestamp
    // så neste runde-end starter med ren markRoomReady-gating.
    this.endOfRoundOverlayShownAt = null;

    // FIXED-PRIZE-FIX: reset round-accumulated winnings ved ny runde.
    this.roundAccumulatedWinnings = 0;
    // Tobias 2026-04-29: reset mini-game-result for ny runde.
    this.lastMiniGameResult = null;

    this.buyMoreDisabled = false;
    // BIN-409 (D2): Ny runde — reset buy-more button til enabled state.
    // Buy popup (Game1BuyPopup) closes itself at the PLAYING transition via
    // PlayScreen.update() → gameStatus === RUNNING.
    this.playScreen?.enableBuyMore();
    this.playScreen?.hideBuyPopup();

    // 2026-05-11 (Tobias-direktiv): `WaitingForMasterOverlay` er fjernet.
    // PlayScreen.update() håndterer idle-text-mode-toggle basert på
    // state.gameStatus = RUNNING → hideIdleText automatisk. Ingen
    // defensiv overlay-hide nødvendig her.

    // Reset announced numbers for the new round
    this.deps.audio.resetAnnouncedNumbers();

    this.luckyPicker?.hide();

    if (state.myTickets.length > 0) {
      this.transitionTo("PLAYING", state);
    } else {
      // BIN-507: runde starter uten at spilleren armet billetter → SPECTATING.
      this.transitionTo("SPECTATING", state);
    }
  }

  private onGameEnded(state: GameState): void {
    // Demo-blocker-fix 2026-04-29: mini-game-overlay må PERSIST etter
    // game-end ved Fullt Hus. Tidligere ble overlay revet ned umiddelbart
    // i `onGameEnded` slik at vinneren ikke fikk se Mystery / Wheel /
    // Chest / ColorDraft (server hadde aktivert mini-game POST-Fullt-Hus
    // men runden var allerede ENDED når klient mottok pattern:won).
    //
    // Sjekk om en mini-game er aktiv eller står i kø — hvis så, hopp
    // over dismiss-en. Mini-game-overlay tar ansvar for sin egen lifecycle:
    //   - Wheel/Chest/ColorDraft/Mystery: overlay-en kaller `dismiss`
    //     etter resultat-animasjon er ferdig.
    //   - End-of-round-overlay holdes tilbake (via mini-game-router /
    //     legacy-adapter sin onDismiss-callback) til mini-game er ferdig.
    //
    // Hvis ingen mini-game er aktiv (typisk MAX_DRAWS_REACHED uten Fullt
    // Hus, eller cancellation-path), dismiss som før.
    const miniGameActive =
      this.miniGame?.isActive() === true ||
      this.legacyMiniGame?.isActive() === true ||
      this.pendingMiniGameTrigger !== null ||
      this.pendingLegacyMiniGame !== null;

    if (!miniGameActive) {
      // Ingen mini-game i bildet — trygt å dismisse evt. zombie-overlay.
      // PIXI-P0-002 (Bølge 2A, 2026-04-28): use the graceful dismiss so we
      // briefly wait for any in-flight `mini_game:choice` ack before tearing
      // the overlay down. Without this, a player who clicked just before the
      // game ended would lose their choice silently. Backend remains
      // idempotent on choice (orchestrator `completed_at` lock) so a late
      // ack after the wait doesn't double-pay; the wait just shrinks the
      // user-visible loss window. Fire-and-forget — overlay-show below
      // doesn't depend on the mini-game overlay being gone yet.
      void this.miniGame?.dismissAfterPendingChoices();
      // Tobias prod-incident 2026-04-29: legacy adapter doesn't have a
      // pending-choice drain (legacy `minigame:play` is fire-and-ack with no
      // intermediate state), so a synchronous dismiss is correct. The
      // overlay is destroyed if active.
      this.legacyMiniGame?.dismiss();
      this.pendingLegacyMiniGame = null;
    }

    this.deps.audio.resetAnnouncedNumbers();
    this.deps.audio.stopAll();

    // Saldo-flash deep-dive (Tobias 2026-04-26): Game-end er en av få
    // hendelser hvor saldo GARANTERT har endret seg (payout/buy-in commit),
    // så vi vil ha en autoritativ refetch fra lobby, men IKKE pushe et
    // optimistisk balance-tall som kommer til å være enten gross eller
    // available avhengig av hvilken backend-path som sist berørte
    // `player.balance`. Sender refresh-request i stedet — lobby gjør
    // debounced GET /api/wallet/me og rendrer korrekt available.
    if (this.myPlayerId && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("spillorama:balanceRefreshRequested"));
    }

    if (this.phase === "PLAYING") {
      this.transitionTo("ENDED", state);
      // Tobias UX-mandate 2026-04-29 (fluid 3-phase overlay): timestamp
      // round-end så overlay ved reconnect kan beregne hvilken fase
      // (SUMMARY/LOADING/COUNTDOWN) brukeren skal lande i.
      this.roundEndedAt = Date.now();
      this.buyPopupOpenedFromOverlay = false;
      // Tobias 2026-04-29 prod-incident-fix: vis end-of-round-overlay
      // i stedet for Pixi-EndScreen. Hvis WinScreenV2 (Fullt Hus-fontene)
      // er aktiv, holder vi tilbake overlay til den lukkes — slik at
      // animasjonen får ferdig-spille uten å bli klippet av summary-
      // vinduet.
      //
      // Demo-blocker-fix 2026-04-29: hvis mini-game er aktiv (eller
      // pending), holdes end-of-round tilbake også. Mini-game-overlay
      // kaller vår onResult/onDismiss-hook når den er ferdig, og da
      // viser end-of-round-overlay seg via onStateChanged-recovery-pathen.
      if (this.isWinScreenActive) {
        // WinScreenV2.onDismiss kaller flushPendingMiniGameTrigger som
        // vi her utvider til også å vise end-of-round-overlay. Vi
        // bruker en flag siden vi ikke vil endre WinScreenV2-API-en.
        this.shouldShowEndOfRoundOnWinScreenDismiss = true;
      } else if (
        this.miniGame?.isActive() === true ||
        this.legacyMiniGame?.isActive() === true ||
        this.pendingMiniGameTrigger !== null ||
        this.pendingLegacyMiniGame !== null
      ) {
        // Mini-game vises eller står i kø — utsett end-of-round-overlay
        // til mini-game-routeren/legacy-adapteren melder fra at brukeren
        // er ferdig (overlay.onDismiss → onStateChanged-recovery).
        this.shouldShowEndOfRoundOnWinScreenDismiss = true;
      } else {
        this.showEndOfRoundOverlayForState(state);
      }
    } else {
      this.transitionTo("WAITING", state);
    }
  }

  /**
   * Tobias UX-mandate 2026-04-29 (fluid 3-phase overlay): åpne end-of-
   * round-overlay som transitions naturlig gjennom SUMMARY → LOADING →
   * COUNTDOWN. Kalt fra `onGameEnded` (PLAYING-fase) eller fra
   * `flushPendingMiniGameTrigger` etter at WinScreenV2 er lukket.
   *
   * Phase 3 (COUNTDOWN) trigger:
   *   - `onCountdownNearStart` fyrer ved ≤5 sek igjen → vi åpner buy-popup
   *     ON TOP av countdown. Loss-state-header fra PR #725 forblir intakt
   *     siden vi ikke endrer Game1BuyPopup.
   *   - `onOverlayCompleted` fyrer hvis countdown utløper uten at ny
   *     runde starter (manuell modus / scheduler-glipp). Brukes som
   *     fallback for å transition til WAITING.
   *
   * Disconnect-resilience: `elapsedSinceEndedMs` lar overlay starte i
   * riktig fase. En spiller som reconnecter midt i countdown ser IKKE
   * SUMMARY igjen.
   */
  private showEndOfRoundOverlayForState(state: GameState): void {
    const overlay = this.endOfRoundOverlay;
    if (!overlay) return;

    // Compute elapsed time since round ended for disconnect-resilience.
    // If roundEndedAt is null (e.g. late-join via reconnect), fall back
    // to 0 so overlay starts at SUMMARY phase 1.
    const now = Date.now();
    const elapsedSinceEndedMs =
      this.roundEndedAt !== null ? Math.max(0, now - this.roundEndedAt) : 0;

    const summary: Game1EndOfRoundSummary = {
      endedReason:
        state.gameStatus === "ENDED"
          ? this.endedReasonFromState(state)
          : "MANUAL_END",
      patternResults: state.patternResults,
      myPlayerId: this.myPlayerId,
      myTickets: state.myTickets,
      miniGameResult: this.lastMiniGameResult,
      luckyNumber: state.myLuckyNumber,
      ownRoundWinnings: this.roundAccumulatedWinnings,
      millisUntilNextStart: state.millisUntilNextStart ?? null,
      elapsedSinceEndedMs,
      onBackToLobby: () => {
        // Lukk overlay + emit window-event som lobby/router kan lytte til.
        // Eksisterende lobby-shell håndterer `spillorama:returnToLobby`
        // som standard-navigasjon (samme channel som returnToShellLobby
        // i Unity-host).
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("spillorama:returnToLobby"));
        }
        this.dismissEndOfRoundAndReturnToWaiting();
      },
      // onCountdownNearStart fjernet 2026-04-29 (revised UX-mandat):
      // overlay har ikke lenger COUNTDOWN-fase. Buy-popup vises av selve
      // PlayScreen når room-state transitionerer til WAITING — ikke fra
      // overlay. Dette sikrer at brukeren faktisk ser live room-elementer
      // (pattern-animasjon, neste-spill-info) når overlay dismisses.
      onCountdownNearStart: undefined,
      onOverlayCompleted: () => {
        // Countdown utløp uten at ny runde startet (manuell-modus eller
        // scheduler-glipp). Transition fallback til WAITING.
        this.dismissEndOfRoundAndReturnToWaiting();
      },
    };
    overlay.show(summary);
    // Tobias UX-mandate 2026-04-29 (revised): tag tidspunktet for at
    // onStateChanged kan bruke det som "barriere" — neste state-update
    // (etter 50ms grace) kvalifiserer som room-ready-signal og kaller
    // overlay.markRoomReady().
    this.endOfRoundOverlayShownAt = Date.now();
    telemetry.trackEvent("end_of_round_overlay_shown", {
      endedReason: summary.endedReason ?? "UNKNOWN",
      ownTotal: this.roundAccumulatedWinnings,
      millisUntilNextStart: summary.millisUntilNextStart ?? 0,
      elapsedSinceEndedMs,
    });
  }

  /**
   * Tobias 2026-04-29: cleanup-path når overlay lukkes (klikk eller auto-
   * dismiss). Transitionerer til WAITING med fersk state, og hvis state
   * allerede har gått over til RUNNING (auto-round race) plukker
   * onStateChanged opp recovery-pathen.
   */
  private dismissEndOfRoundAndReturnToWaiting(): void {
    if (this.endScreenTimer) {
      clearTimeout(this.endScreenTimer);
      this.endScreenTimer = null;
    }
    const freshState = this.deps.bridge.getState();
    // Hvis ny runde allerede er i gang (rask auto-round), hopp direkte
    // til PLAYING/SPECTATING. Ellers: WAITING viser pre-round-buy-popup
    // som vanlig.
    if (freshState.gameStatus === "RUNNING") {
      if (freshState.myTickets.length > 0) {
        this.transitionTo("PLAYING", freshState);
      } else {
        this.transitionTo("SPECTATING", freshState);
      }
    } else {
      this.transitionTo("WAITING", freshState);
    }
  }

  /**
   * Tobias 2026-04-29: Hent endedReason fra current GameSnapshot. Bridge
   * eksponerer ikke endedReason direkte i sin GameState, men reason kommer
   * via roomSnapshot's currentGame. Vi bruker bridge.getState() og leter
   * etter et heuristikk: "BINGO_CLAIMED" hvis Fullt Hus er vunnet (den
   * eneste pattern med claimType=BINGO som typisk finnes i Spill 1), ellers
   * "MAX_DRAWS_REACHED" som fallback.
   *
   * NB: dette er en best-effort tolkning siden GameState ikke har
   * `endedReason`-feltet. For mer presist svar kan backend pushe det i
   * en framtidig wire-utvidelse, men for retail-UX-tekst er dette
   * tilstrekkelig.
   */
  private endedReasonFromState(state: GameState): string {
    const bingoPattern = state.patternResults.find(
      (r) => r.claimType === "BINGO" && r.isWon,
    );
    if (bingoPattern) return "BINGO_CLAIMED";
    if (
      state.drawnNumbers.length > 0 &&
      state.totalDrawCapacity > 0 &&
      state.drawnNumbers.length >= state.totalDrawCapacity
    ) {
      return "MAX_DRAWS_REACHED";
    }
    return "MANUAL_END";
  }

  /**
   * Tobias 2026-04-29: flagg som settes i onGameEnded når WinScreenV2
   * (Fullt Hus) er aktiv. Når WinScreenV2 lukkes (Tilbake-klikk eller
   * 10.8s auto-close), kaller vi `flushPendingMiniGameTrigger()` som har
   * blitt utvidet til også å vise end-of-round-overlay.
   */
  private shouldShowEndOfRoundOnWinScreenDismiss = false;

  private onNumberDrawn(number: number, drawIndex: number, state: GameState): void {
    if (this.phase === "PLAYING" && this.playScreen) {
      this.playScreen.onNumberDrawn(number, drawIndex, state);

      // BIN-451: Disable buy-more using server-authoritative threshold
      if (!this.buyMoreDisabled && state.disableBuyAfterBalls > 0 && state.drawCount >= state.disableBuyAfterBalls) {
        this.buyMoreDisabled = true;
        this.playScreen.disableBuyMore();
      }
    } else if ((this.phase === "WAITING" || this.phase === "SPECTATING") && this.playScreen) {
      // BIN-507: Both WAITING and SPECTATING viser live ball-animasjon uten ticket-marking.
      this.playScreen.onSpectatorNumberDrawn(number, state);
    }
  }

  private onPatternWon(result: PatternWonPayload, state: GameState): void {
    if (this.phase === "PLAYING" && this.playScreen) this.playScreen.onPatternWon(result);

    // BIN-696: Vis annonsering til alle spillere om at fasen er vunnet.
    // Fullt Hus har spesiell tekst ("Spillet er over") — alle andre faser
    // bruker pattern-navnet direkte ("Rad 1 er vunnet", osv.).
    const isFullHouse = result.claimType === "BINGO";
    const phaseMsg = isFullHouse
      ? "Fullt Hus er vunnet. Spillet er over."
      : `${result.patternName} er vunnet!`;
    this.toast?.info(phaseMsg, 3000);

    // BIN-696: Vinner-spesifikk annonsering med split-forklaring.
    const winnerIds = result.winnerIds ?? (result.winnerId ? [result.winnerId] : []);
    const winnerCount = result.winnerCount ?? winnerIds.length;

    // Tobias 2026-05-12 pilot-fix (Spill 1 scheduled rad-vinst — vinner ser
    // ingen popup): Server's `resolvePlayerPatternWinnerIds` mapper wallet
    // → socket-playerId via room-snapshot, men hvis snapshot er stale eller
    // wallet-mapping feiler faller den tilbake til auth-`userId`. Klient's
    // `myPlayerId` er en random socket-UUID som aldri matcher userId →
    // `isMe` ble alltid false og popupen ble ikke vist.
    //
    // Fix: prøv playerId-match FØRST (primær), deretter walletId-match
    // (safety-net) ved å derive klientens egen walletId fra room-snapshot
    // og matche mot `winnerWalletIds` som server nå sender parallelt.
    const myWalletId =
      this.myPlayerId !== null
        ? state.players.find((p) => p.id === this.myPlayerId)?.walletId ?? null
        : null;
    const matchedByPlayerId =
      this.myPlayerId !== null && winnerIds.includes(this.myPlayerId);
    const matchedByWalletId =
      myWalletId !== null &&
      Array.isArray(result.winnerWalletIds) &&
      result.winnerWalletIds.includes(myWalletId);
    const isMe = matchedByPlayerId || matchedByWalletId;

    if (isMe) {
      this.deps.audio.playBingoSound();

      // BIN-696 / Bong-design 2026-04-24:
      //   - Fullt Hus (BINGO)  → fullskjerm WinScreenV2 med fontene + count-up
      //   - Fase 1-4 (LINE)    → WinPopup med logo, gevinst, shared-info
      // Erstatter den tidligere toast-meldingen for isMe-scenariet. Toast
      // fortsetter som generell annonsering (`phaseMsg` over) for alle.
      const shared = winnerCount > 1;
      const payout = result.payoutAmount ?? 0;
      // FIXED-PRIZE-FIX: akkumuler vinningen før vi viser overlay.
      // For Fullt Hus viser WinScreenV2 hele round-totalen — annonsert
      // til spilleren som "1 Rad 100 + 2 Rader 200 + ... + Fullt Hus 1000
      // = 1700 kr". Fase 1-4-popup viser fortsatt kun fase-prisen.
      this.roundAccumulatedWinnings += payout;
      if (isFullHouse) {
        this.isWinScreenActive = true;
        this.winScreen?.show({
          amount: this.roundAccumulatedWinnings,
          shared,
          sharedCount: winnerCount,
          onDismiss: () => {
            // Tobias 2026-04-26: Fullt Hus → Mystery (eller annet konfigurert
            // mini-game) skal vises ETTER vinner-scenen lukkes (manuell
            // Tilbake-knapp eller 10.8s auto-close). Backend trigger
            // (Game1DrawEngineService.triggerMiniGamesForFullHouse) har allerede
            // fyrt og payload kan ligge i pendingMiniGameTrigger. Flush her.
            this.isWinScreenActive = false;
            this.flushPendingMiniGameTrigger();
            // EndScreen-transition er styrt av onGameEnded (uendret).
          },
        });
      } else {
        // `rows` = fase-nummer (1-4 for linje-vinn). classifyPhaseFromPatternName
        // mapper "Row 1" → Phase1, etc. PHASE_TO_ROWS mapper videre til tall.
        // Fallback til 1 for ukjent pattern-navn.
        const phase = classifyPhaseFromPatternName(result.patternName);
        const rows = phase ? PHASE_TO_ROWS[phase] : 1;
        this.winPopup?.show({
          rows: Math.min(4, rows),
          amount: payout,
          shared,
          sharedCount: winnerCount,
        });
      }
    }

    telemetry.trackEvent("pattern_won", {
      patternName: result.patternName,
      isMe,
      payoutAmount: result.payoutAmount,
      winnerCount,
    });
  }

  /**
   * Tobias 2026-04-29 (post-orphan-fix UX): server pusher `bet:rejected` når
   * forhåndskjøp avvises på game-start (loss-limit eller insufficient
   * funds). Vi viser en klar Norsk feilmelding via toast.
   *
   * Pre-round-bongene blir automatisk fjernet via det neste `room:update`
   * (server frigjør reservasjonen og fjerner display-cachen) — vi trenger
   * ikke gjøre noe ekstra med tickets på klienten utover å vise meldingen.
   */
  private onBetRejected(event: BetRejectedEvent): void {
    // Filtrer mot myPlayerId så vi ikke viser feilmeldinger for andre
    // spillere i samme rom (forsvarlig defense — server emitter til
    // wallet:<walletId>-rommet, men paranoid-sjekk koster lite).
    if (this.myPlayerId !== null && event.playerId !== this.myPlayerId) {
      return;
    }
    const norsk =
      event.message ||
      Game1Controller.BET_REJECTED_FALLBACK_MESSAGES[event.reason] ||
      "Forhåndskjøp ble avvist.";
    // Bruk error-toast (rød) for tydelig regulatorisk-varsel.
    this.toast?.error(norsk, 6000);
    // Hvis Kjøp Bonger-popup-en er åpen, lukk den så bruker ser
    // toast-en og kan ta inn beskjeden uten å klikke seg ut først.
    this.playScreen?.hideBuyPopup();
  }

  /**
   * Tobias 2026-04-29 (post-orphan-fix UX): wallet:loss-state-push fra
   * server etter committed buy-in. Hvis Kjøp Bonger-popup-en er åpen,
   * oppdater "Brukt i dag: X / Y kr"-headeren live.
   */
  private onWalletLossStateChanged(event: WalletLossStateEvent): void {
    // Game1BuyPopup updater seg selv via PlayScreen-helper.
    this.playScreen?.updateBuyPopupLossState({
      dailyUsed: event.state.dailyUsed,
      dailyLimit: event.state.dailyLimit,
      monthlyUsed: event.state.monthlyUsed,
      monthlyLimit: event.state.monthlyLimit,
      walletBalance: event.state.walletBalance,
    });
  }

  /**
   * Tobias 2026-04-29: Norsk-fallback for bet:rejected reason-koder.
   * Server pleier å sende ferdig-formaterte meldinger via `event.message`,
   * men hvis serveren mangler kontekst (eldre prod-deploy), bruker vi
   * disse som fallback.
   */
  private static readonly BET_REJECTED_FALLBACK_MESSAGES: Record<string, string> = {
    DAILY_LOSS_LIMIT_REACHED:
      "Du nådde dagens tapsgrense. Forhåndskjøpet ble derfor avvist.",
    MONTHLY_LOSS_LIMIT_REACHED:
      "Du nådde månedens tapsgrense. Forhåndskjøpet ble derfor avvist.",
    INSUFFICIENT_FUNDS:
      "Du har ikke nok saldo for å delta i denne runden. Forhåndskjøpet ble avvist.",
    PLAYER_TIMED_PAUSE: "Du er på frivillig pause. Forhåndskjøpet ble avvist.",
    PLAYER_REQUIRED_PAUSE:
      "Du har obligatorisk pause (60 min spilt). Forhåndskjøpet ble avvist.",
    PLAYER_SELF_EXCLUDED: "Du er selvutestengt. Forhåndskjøpet ble avvist.",
  };

  /**
   * Bridge-listener for `miniGameTrigger`. Hvis WinScreenV2 (Fullt Hus-scene)
   * er aktiv, holder vi tilbake triggeren slik at mini-game-overlay ikke
   * klipper over fontene-animasjonen. Frigjøres i WinScreenV2.onDismiss via
   * flushPendingMiniGameTrigger.
   */
  private handleMiniGameTrigger(payload: MiniGameTriggerPayload): void {
    if (this.isWinScreenActive) {
      // Server-autoritativ: hvis flere triggere i køen, siste vinner.
      this.pendingMiniGameTrigger = payload;
      return;
    }
    this.miniGame?.onTrigger(payload);
  }

  /**
   * Tobias prod-incident 2026-04-29: bridge-listener for legacy
   * `minigame:activated` (Spill 1 auto-claim path, PR #727 emit chain).
   * Same WinScreenV2-queueing logic as `handleMiniGameTrigger` so the
   * popup doesn't clip over the Fullt Hus fontene-animasjon. Server-
   * autoritativ: if multiple triggers arrive while WinScreenV2 is up,
   * the last one wins.
   */
  private handleLegacyMiniGameActivated(payload: MiniGameActivatedPayload): void {
    if (this.isWinScreenActive) {
      this.pendingLegacyMiniGame = payload;
      return;
    }
    this.legacyMiniGame?.onActivated(payload);
  }

  /**
   * Demo-blocker-fix 2026-04-29: callback fra MiniGameRouter /
   * LegacyMiniGameAdapter når mini-game-overlay er dismissed (etter
   * brukervalg + animasjon). Hvis runden er ENDED og end-of-round-
   * overlay var holdt tilbake (`shouldShowEndOfRoundOnWinScreenDismiss`),
   * vis det nå.
   *
   * Hvorfor denne pathen er nødvendig: MAX_DRAWS-fixen i server hindrer
   * trekninger etter Fullt Hus, men klient-side blir mini-game-overlay
   * fortsatt revet ned hvis vi blindt dismisser i `onGameEnded`. Vi
   * holder mini-game oppe inntil overlay selv signaliserer at den er
   * ferdig, og DA viser vi end-of-round-overlay som rapporten brukeren
   * skal se.
   */
  private onMiniGameDismissed(): void {
    // Bare relevant hvis vi faktisk satt flagget (Fullt Hus + game ENDED-
    // path). Ellers: ingen end-of-round å vise — dismiss var bare en
    // normal cleanup mid-round.
    if (!this.shouldShowEndOfRoundOnWinScreenDismiss) return;
    if (this.isWinScreenActive) return; // WinScreenV2 vil flushe selv

    this.shouldShowEndOfRoundOnWinScreenDismiss = false;
    const freshState = this.deps.bridge.getState();
    if (this.phase === "ENDED" || freshState.gameStatus === "ENDED") {
      this.showEndOfRoundOverlayForState(freshState);
    } else {
      // Race: ny runde startet mens mini-game var oppe — gå direkte til
      // WAITING/PLAYING (samme recovery-pathing som overlay's onClickKlar).
      this.dismissEndOfRoundAndReturnToWaiting();
    }
  }

  /**
   * Spill av evt. pending mini-game-trigger + åpne end-of-round-overlay
   * dersom det ble holdt tilbake av WinScreenV2.
   *
   * Tobias 2026-04-29 prod-incident-fix: WinScreenV2 (Fullt Hus-fontene)
   * er en stor scene som kjører ~10.8s. Hvis end-of-round-overlay viser
   * seg samtidig blir WinScreenV2 klippet av (ulik z-index, samme
   * overlay-container). Vi venter til WinScreenV2 er lukket FØR vi
   * monterer end-of-round-overlay. Det samme prinsippet gjelder for
   * pending mini-game-trigger som backend fyrer POST-Fullt Hus.
   *
   * Rekkefølge:
   *   1. WinScreenV2 lukket (klikk eller 10.8s auto-close)
   *   2. Mini-game-overlay vises hvis pending (M6 + legacy)
   *   3. Mini-game-resultat fyrer (lagres i lastMiniGameResult)
   *   4. Mini-game-overlay lukkes — eller hvis ingen mini-game var pending,
   *      kjør direkte til steg 5
   *   5. End-of-round-overlay vises (fra denne flushen, eller fra
   *      mini-game-overlay-onDismiss-pathen)
   */
  private flushPendingMiniGameTrigger(): void {
    let hasPending = false;
    const pending = this.pendingMiniGameTrigger;
    if (pending) {
      this.pendingMiniGameTrigger = null;
      this.miniGame?.onTrigger(pending);
      hasPending = true;
    }
    // Tobias prod-incident 2026-04-29: også flush pending legacy trigger.
    // Begge protokoller deler WinScreen-køen men ruter til hver sin overlay-
    // manager.
    const pendingLegacy = this.pendingLegacyMiniGame;
    if (pendingLegacy) {
      this.pendingLegacyMiniGame = null;
      this.legacyMiniGame?.onActivated(pendingLegacy);
      hasPending = true;
    }
    if (hasPending) {
      // Mini-game tar over scenen — vi viser end-of-round-overlay etter
      // at brukeren har gjort sitt valg (mini-game-router/legacy-adapter
      // emitter result-event som vi capturer i lastMiniGameResult). Show-
      // call gjøres når mini-game-overlay lukkes (eller når brukeren
      // returnerer til ENDED-state uten aktivt mini-game via
      // onStateChanged-pathen).
      return;
    }
    // Ingen pending mini-game — vis end-of-round-overlay nå hvis runden
    // faktisk er ENDED (kan ha endret seg mens vi ventet).
    if (this.shouldShowEndOfRoundOnWinScreenDismiss) {
      this.shouldShowEndOfRoundOnWinScreenDismiss = false;
      const freshState = this.deps.bridge.getState();
      if (this.phase === "ENDED" || freshState.gameStatus === "ENDED") {
        this.showEndOfRoundOverlayForState(freshState);
      } else {
        // Race: en ny runde startet mens WinScreenV2 var oppe — gå direkte.
        this.dismissEndOfRoundAndReturnToWaiting();
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /**
   * Build a fresh PlayScreen og wire all callbacks. Sentralisert fordi de tre
   * game-visible phases (WAITING / PLAYING / SPECTATING) tidligere copy-
   * pasted denne blokken tre ganger, og callback-endringer falt jevnlig ut
   * av sync.
   */
  private buildPlayScreen(w: number, h: number): PlayScreen {
    const container = this.deps.app.app.canvas.parentElement ?? document.body;
    const screen = new PlayScreen(w, h, this.deps.audio, this.deps.socket, this.actualRoomCode, container, this.deps.bridge);
    screen.setOnClaim((type) => {
      void this.actions?.claim(type);
    });
    screen.setOnBuy((selections) => {
      void this.actions?.buy(selections);
    });
    screen.setOnLuckyNumberTap(() => this.openLuckyPicker());
    screen.setOnCancelTickets(() => {
      void this.actions?.cancelAll();
    });
    screen.setOnCancelTicket((id) => {
      void this.actions?.cancelTicket(id);
    });
    screen.setOnOpenSettings(() => this.settingsPanel?.show());
    screen.setOnOpenMarkerBg(() => this.markerBgPanel?.show());
    screen.setOnStartGame(() => {
      void this.actions?.startGame();
    });
    screen.subscribeChatToBridge((listener) => this.deps.bridge.on("chatMessage", listener));

    // Spillerklient-rebuild Fase 1 (2026-05-10): seed buy-popup-subtitle
    // med catalog-display-navn fra plan-runtime aggregator. Hvis state
    // ikke har ankommet enda settes "Bingo" som default — onChange-listener
    // i `start()` oppdaterer subtitle ved første lobby-state-emit.
    const lobbyState = this.lobbyStateBinding?.getState();
    const initialDisplayName =
      lobbyState?.nextScheduledGame?.catalogDisplayName ?? "Bingo";
    screen.setBuyPopupDisplayName(initialDisplayName);

    // Spillerklient-rebuild Fase 2 (2026-05-10): seed ticket-config så
    // BuyPopup viser riktige bongfarger fra første øyeblikk. Hvis lobby-
    // binding ikke har state ennå returneres null og PlayScreen faller
    // tilbake på `state.ticketTypes` (fra senere room:update).
    const initialTicketConfig =
      this.lobbyStateBinding?.getBuyPopupTicketConfig() ?? null;
    screen.setBuyPopupTicketConfig(initialTicketConfig);

    // Spillerklient-rebuild Fase 3 (2026-05-10): seed lobby-overallStatus
    // så countdown-gating i `update()` reflekterer lobby-state fra første
    // render. Hvis ikke seedet lokalt vil pre-første-stateChanged-render
    // tro at vi er i "running" (default) og prøve å starte countdown
    // basert på `state.millisUntilNextStart` — det er nettopp buggen vi
    // ønsker å hindre.
    screen.setLobbyOverallStatus(lobbyState?.overallStatus ?? null);

    // Wait-on-master-fix (Agent B, 2026-05-12, Alternativ B): seed wait-
    // on-master-state slik at "Forhåndskjøp"-knappen ikke flash-er kort
    // i enabled-tilstand før onChange-listeneren fyrer for første gang.
    // Speiler `pickJoinableScheduledGameId(state)`-logikken — purchase
    // tillates kun når scheduled-game er joinable.
    //
    // Hvis lobbyState er null (pre-init) seedes waiting=true (defensiv —
    // vi heller bias mot å vente). Hvis lobbyState mangler
    // scheduledGameId seedes waiting=true også. onChange-listeneren
    // overstyrer dette så snart første live event ankommer.
    const initialJoinableId = this.pickJoinableScheduledGameId(lobbyState ?? null);
    screen.setWaitingForMasterPurchase(initialJoinableId === null);

    return screen;
  }

  private openLuckyPicker(): void {
    const state = this.deps.bridge.getState();
    this.luckyPicker?.show(state.myLuckyNumber);
  }

  private setScreen(screen: Container): void {
    this.currentScreen = screen;
    this.root.addChild(screen);
  }

  private clearScreen(): void {
    if (this.currentScreen) {
      this.currentScreen.destroy({ children: true });
      this.currentScreen = null;
    }
    this.playScreen = null;
    // endScreen-feltet ble fjernet i Tobias 2026-04-29 prod-incident-fix —
    // ENDED-fasen bruker nå Game1EndOfRoundOverlay (HTML) i stedet for en
    // Pixi-basert EndScreen.
  }

  /**
   * Sync SettingsPanel settings to AudioManager.
   * Called on init and whenever settings change.
   */
  private syncSettingsToAudio(settings: Game1Settings): void {
    const audio = this.deps.audio;
    audio.setSoundEnabled(settings.soundEnabled);
    audio.setVoiceEnabled(settings.voiceEnabled);
    audio.setVoiceLanguage(AudioManager.settingsToVoice(settings.voiceLanguage));
    audio.setDoubleAnnounce(settings.doubleAnnounce);
  }

  private showError(message: string): void {
    // Tracker (Tobias-direktiv 2026-05-12): klient-side feilmelding.
    // Skriv til samme event-log som socket/state-events så Tobias ser
    // hele tidslinjen ved dump.
    try {
      getEventTracker().track("error.client", { message });
    } catch {
      // Tracker er best-effort; må ikke ta ned feilvisningen.
    }
    if (this.toast) {
      this.toast.error(message, 8000);
    } else {
      const errorText = new Text({
        text: message,
        style: { fontFamily: "Arial", fontSize: 24, fill: 0xff4444, align: "center" },
      });
      errorText.anchor.set(0.5);
      errorText.x = this.deps.app.app.screen.width / 2;
      errorText.y = this.deps.app.app.screen.height / 2;
      this.root.addChild(errorText);
    }
  }
}

// Register in the game registry
registerGame("bingo", (deps) => new Game1Controller(deps));
registerGame("game_1", (deps) => new Game1Controller(deps));
