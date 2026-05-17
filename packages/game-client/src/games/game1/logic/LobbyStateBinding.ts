/**
 * Spillerklient-rebuild Fase 1 (BIN/SPILL1, 2026-05-10) — Game1Controller-
 * kobling til plan-runtime aggregator.
 *
 * Bakgrunn (handoff `SPILLERKLIENT_REBUILD_HANDOFF_2026-05-10.md` §6.2):
 *   Game1Controller viste "Neste spill: STANDARD" istedenfor det faktiske
 *   katalog-navnet ("Bingo", "Innsatsen", "Oddsen 55", etc.) fordi klient
 *   leste `variantConfig.gameType` (default "STANDARD") istedenfor plan-
 *   runtime-aggregatorens `nextScheduledGame.catalogDisplayName`.
 *
 *   Tobias-direktiv 2026-05-09:
 *   "Når man kommer inn i spill 1 som kunde så skal man alltid da se neste
 *    spill som er planlagt. Dette spillet skal da starte når master har
 *    trykket på knappen. Det skal aldri være noen andre views i det live
 *    rommet en neste planlagte spill."
 *
 * Bevisst designvalg:
 *   - **Public lobby-endpoint** (`/api/games/spill1/lobby?hallId=X`) brukes
 *     i stedet for det auth'd agent-aggregator-endpointet
 *     (`/api/agent/game1/lobby`). Spillerklienten har ikke en agent-token —
 *     den public endpoint-en eksponerer akkurat den lobby-state-en
 *     spilleren skal se og er allerede dekket av eksisterende
 *     `Spill1LobbyState`-shape med `nextScheduledGame.catalogDisplayName`.
 *   - **Single-source-of-truth**: én klasse eier både HTTP-fetch og socket-
 *     subscribe slik at Game1Controller bare skal lytte på `onChange`-callback.
 *   - **Best-effort socket**: hvis subscribe feiler (eksempelvis pre-auth
 *     race) faller vi tilbake på 10s-poll. Samme pattern som `LobbyFallback.ts`.
 *
 * Forholdet til `LobbyFallback`:
 *   `LobbyFallback` er en *overlay* som tar over hele skjermen når
 *   `socket.createRoom` feiler — den eier sin egen lobby-fetch-loop.
 *   Denne `LobbyStateBinding`-en er en *passiv data-kilde* for Game1Controller
 *   som kjører gjennom hele kontrollerens levetid (også etter join-success).
 *   De to har overlappende ansvar (begge fetcher Spill1LobbyState) men
 *   forskjellig livssyklus.
 *
 * Bakover-kompatibilitet:
 *   Eksisterende clients som ikke instansierer `LobbyStateBinding`
 *   påvirkes ikke — `Game1BuyPopup.setDisplayName` har default-verdi.
 */

import type { Spill1LobbyState } from "@spillorama/shared-types/api";
import type {
  SpilloramaSocket,
  Spill1LobbyStateUpdatePayload,
} from "../../../net/SpilloramaSocket.js";
import {
  buildBuyPopupTicketConfigFromLobby,
  type BuyPopupTicketConfig,
} from "./lobbyTicketTypes.js";

export interface LobbyStateBindingOptions {
  hallId: string;
  socket: SpilloramaSocket;
  /**
   * Optional override av API base-URL. Default: `window.location.origin`
   * (samme origin som game-client serves fra).
   */
  apiBaseUrl?: string;
  /**
   * Polling-intervall (ms) som safety-net hvis socket-broadcast feiler.
   *
   * Pilot Q3 2026 (2026-05-15): default redusert fra 10000 → 3000 per
   * Tobias-direktiv. Backend-side broadcast (Spill1LobbyBroadcaster) er
   * primær-pathen (~50ms etter natural round-end + plan-run-finish).
   * 3s er ren safety-net hvis socket-push feiler stille.
   *
   * Default: 3000 (matcher `LobbyFallback`-pattern).
   */
  pollIntervalMs?: number;
  /**
   * Ekstern-konsulent-plan P0-5 (2026-05-17): timeout-grense for hver
   * HTTP-fetch (ms). Etter timeout abortes fetchen via AbortController
   * og polling-loopen fortsetter ved neste intervall.
   *
   * Pre-P0-5 hadde `fetchOnce()` ingen timeout. Under nett-degradering
   * (DNS-hang, server-suspend, sjelden men reell) kunne fetches henge
   * i ubestemt tid. Med pollIntervalMs=3000 og uten timeout kunne
   * pending fetches stable seg opp i bakgrunnen, lekke sockets og
   * forsinke faktisk-aktuelle state-updates.
   *
   * Default: 5000 (5 sek). Lengre enn pollIntervalMs (3s) så normale
   * fetches alltid får tid til å fullføre. Test-injection via
   * `setTimeoutFn`/`AbortControllerCtor` gjør timeout-en deterministisk
   * testbar.
   */
  fetchTimeoutMs?: number;
  /**
   * Test-injection (P0-5 2026-05-17): override `setTimeout`. Default
   * bruker arrow-wrap-pattern mot "Illegal invocation" (samme som
   * AutoReloadOnDisconnect/LiveRoomRecoverySupervisor).
   */
  setTimeoutFn?: typeof setTimeout;
  /** Test-injection: override `clearTimeout`. */
  clearTimeoutFn?: typeof clearTimeout;
  /**
   * Test-injection: override `AbortController`-constructor. Default
   * `globalThis.AbortController`. Tester kan injecte en custom impl
   * for å verifisere abort-signal-propagering.
   */
  AbortControllerCtor?: typeof AbortController;
}

/**
 * Callback som fyrer hver gang lobby-state oppdateres (initial fetch +
 * socket-broadcast + polled refresh). Mottakeren skal IKKE muteres state.
 */
export type LobbyStateChangeListener = (state: Spill1LobbyState | null) => void;

/**
 * Tynn binding-klasse som holder current `Spill1LobbyState` og signalerer
 * endringer. Kobler seg til public `/api/games/spill1/lobby` + socket-
 * broadcast-rom for å gi Game1Controller live plan-runtime-data.
 */
export class Game1LobbyStateBinding {
  private readonly hallId: string;
  private readonly socket: SpilloramaSocket;
  private readonly apiBaseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly fetchTimeoutMs: number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly AbortControllerCtor: typeof AbortController;

  private currentState: Spill1LobbyState | null = null;
  private listeners: Set<LobbyStateChangeListener> = new Set();
  private socketUnsub: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * P0-5 (2026-05-17): track in-flight fetch slik at vi kan abort den
   * ved destroy() eller hvis en ny fetchOnce-call starter mens
   * forrige fortsatt henger (race-safety mot stacking).
   */
  private inFlightAbortController: AbortController | null = null;
  private destroyed = false;

  constructor(opts: LobbyStateBindingOptions) {
    this.hallId = opts.hallId;
    this.socket = opts.socket;
    this.apiBaseUrl =
      opts.apiBaseUrl ??
      (typeof window !== "undefined" ? window.location.origin : "");
    this.pollIntervalMs = opts.pollIntervalMs ?? 3_000;
    this.fetchTimeoutMs = opts.fetchTimeoutMs ?? 5_000;
    // Arrow-wrap for å unngå "Illegal invocation" ved native bind
    // (samme mønster som AutoReloadOnDisconnect/LiveRoomRecoverySupervisor).
    this.setTimeoutFn =
      opts.setTimeoutFn ??
      (((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
        setTimeout(handler, timeout, ...args)) as unknown as typeof setTimeout);
    this.clearTimeoutFn =
      opts.clearTimeoutFn ??
      (((handle?: number) =>
        clearTimeout(handle)) as unknown as typeof clearTimeout);
    this.AbortControllerCtor = opts.AbortControllerCtor ?? AbortController;
  }

  /**
   * Start binding. Idempotent — caller kan trygt kalle flere ganger,
   * subsequent calls er no-op. Returnerer initial fetch-state slik at
   * caller kan vente på første verdi før neste init-steg.
   *
   * Best-effort: feil i fetch / subscribe logges men kaster ikke. Caller
   * får null state inntil enten poll eller socket-broadcast oppdaterer.
   */
  async start(): Promise<Spill1LobbyState | null> {
    if (this.destroyed) return this.currentState;
    if (this.socketUnsub || this.pollTimer) return this.currentState;

    // 1) Subscribe to socket-rom for live updates. Best-effort — hvis
    //    subscribe feiler faller vi på poll. Server kan returnere initial
    //    state i ack hvis den allerede har en cached snapshot.
    this.subscribeSocket();

    // 2) Initial HTTP fetch — gir oss state før socket-ack ankommer.
    await this.fetchOnce();

    // 3) Start safety-net polling. Hvis socket-broadcast aldri kommer
    //    fanger vi opp endringer her.
    this.startPolling();

    return this.currentState;
  }

  /**
   * Cleanup. Idempotent. Kalles av Game1Controller.destroy().
   */
  stop(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    // P0-5 (2026-05-17): abort any in-flight fetch slik at vi ikke
    // får callbacks (success eller error) etter destroy.
    if (this.inFlightAbortController) {
      try {
        this.inFlightAbortController.abort();
      } catch {
        /* safe to ignore */
      }
      this.inFlightAbortController = null;
    }
    if (this.socketUnsub) {
      this.socketUnsub();
      this.socketUnsub = null;
    }
    void this.socket.unsubscribeSpill1Lobby(this.hallId).catch(() => {
      // Server-side cleanup logger sin egen warning. Aldri kast fra
      // destroy/cleanup.
    });
    this.listeners.clear();
  }

  /**
   * Subscribe til state-changes. Returnerer en unsubscribe-funksjon som
   * caller MÅ kalle for å unngå memory leak. Hvis state allerede er
   * tilgjengelig fyrer callbacken synkront med initial verdi.
   */
  onChange(listener: LobbyStateChangeListener): () => void {
    this.listeners.add(listener);
    // Synchronous initial-emit hvis vi allerede har state. Bidrar til
    // race-fri integrasjon med Game1Controller.
    if (this.currentState !== null) {
      try {
        listener(this.currentState);
      } catch (err) {
        console.warn("[LobbyStateBinding] listener kastet i onChange-init", err);
      }
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Returnerer siste kjente state, eller null hvis ingen fetch har lyktes. */
  getState(): Spill1LobbyState | null {
    return this.currentState;
  }

  /**
   * Helper for Game1Controller: returner display-navn på neste spill, eller
   * "Bingo" som fallback hvis ingen plan dekker (vi vil ikke at brukeren
   * skal se "STANDARD" eller en tom-streng-stat).
   *
   * Tobias-direktiv: "Det skal aldri være noen andre views i det live
   * rommet en neste planlagte spill." → fallback til generelt "Bingo"-navn,
   * IKKE en degradert variant-string.
   */
  getCatalogDisplayName(): string {
    const next = this.currentState?.nextScheduledGame;
    if (next?.catalogDisplayName) return next.catalogDisplayName;
    return "Bingo";
  }

  /**
   * Spillerklient-rebuild Fase 2 (2026-05-10): returner BuyPopup-konsumert
   * ticket-config (entryFee + ticketTypes[]) bygget fra plan-runtime
   * catalog. Brukes når spilleren er i lobby/pre-game-state og
   * `room:update.gameVariant.ticketTypes` ikke har ankommet enda.
   *
   * Returnerer null hvis ingen plan dekker eller hvis ticket-config er
   * tom/ugyldig — caller skal da falle tilbake på `state.ticketTypes`
   * (fra room:update) eller hardkodet default.
   *
   * Tobias-direktiv 2026-05-09: serveren er Source-of-Truth for ticket-
   * types. Klient må aldri hardkode bongfarger eller priser.
   */
  getBuyPopupTicketConfig(): BuyPopupTicketConfig | null {
    return buildBuyPopupTicketConfigFromLobby(
      this.currentState?.nextScheduledGame ?? null,
    );
  }

  // ── interne hjelpere ────────────────────────────────────────────────────

  private subscribeSocket(): void {
    void this.socket
      .subscribeSpill1Lobby(this.hallId)
      .then((ack) => {
        if (this.destroyed) return;
        if (ack.ok && ack.data?.state) {
          this.applyState(ack.data.state);
        }
      })
      .catch((err) => {
        console.warn(
          "[LobbyStateBinding] socket-subscribe feilet, faller på HTTP-poll",
          err,
        );
      });

    this.socketUnsub = this.socket.on(
      "spill1LobbyStateUpdate",
      (payload: Spill1LobbyStateUpdatePayload) => {
        if (this.destroyed) return;
        if (payload.hallId !== this.hallId) return;
        this.applyState(payload.state);
      },
    );
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.fetchOnce();
    }, this.pollIntervalMs);
  }

  private async fetchOnce(): Promise<void> {
    if (this.destroyed) return;

    // P0-5 (2026-05-17): abort eventuell forrige in-flight fetch FØR vi
    // starter ny. Hindrer at hengende fetches stacker seg opp under
    // nett-degradering. Hvis forrige er ferdig, er abort() no-op.
    if (this.inFlightAbortController) {
      try {
        this.inFlightAbortController.abort();
      } catch {
        /* abort() kan kaste i edge-cases; safe to ignore */
      }
    }

    const controller = new this.AbortControllerCtor();
    this.inFlightAbortController = controller;

    // P0-5: hard timeout via setTimeout som abort-er fetchen hvis den
    // henger lenger enn fetchTimeoutMs. Uten dette kunne fetch henge i
    // ubestemt tid under DNS-feil / server-suspend.
    const timeoutHandle = this.setTimeoutFn(() => {
      try {
        controller.abort();
      } catch {
        /* abort kan kaste hvis allerede aborted */
      }
    }, this.fetchTimeoutMs);

    try {
      const url = `${this.apiBaseUrl}/api/games/spill1/lobby?hallId=${encodeURIComponent(this.hallId)}`;
      const res = await fetch(url, {
        credentials: "omit",
        signal: controller.signal,
      });
      if (!res.ok) return;
      const body = (await res.json()) as
        | { ok: true; data: Spill1LobbyState }
        | { ok: false; error?: { code: string; message: string } };
      if (body.ok && body.data) {
        this.applyState(body.data);
      }
    } catch (err) {
      // AbortError er ikke en ekte feil — den er enten timeout-trigger
      // eller superseded-by-next-fetch. Logg på debug-nivå så vi ikke
      // forsøpler konsollen ved normal polling-rytme.
      const isAbort =
        err instanceof Error && err.name === "AbortError";
      if (isAbort) {
        // Stillere logg — abort er forventet i to scenarier:
        // 1. Timeout etter fetchTimeoutMs
        // 2. Ny fetchOnce startet før denne ble ferdig
        // Begge er trygge tilstander; ingen state corruption.
      } else {
        console.warn("[LobbyStateBinding] HTTP-fetch feilet", err);
      }
    } finally {
      this.clearTimeoutFn(timeoutHandle);
      // Bare null ut hvis det fortsatt er VÅR controller — en ny
      // fetchOnce kan ha startet og overskrevet feltet.
      if (this.inFlightAbortController === controller) {
        this.inFlightAbortController = null;
      }
    }
  }

  private applyState(state: Spill1LobbyState): void {
    this.currentState = state;
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        console.warn(
          "[LobbyStateBinding] listener kastet i applyState-fan-out",
          err,
        );
      }
    }
  }
}
