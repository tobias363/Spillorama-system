/**
 * Game 1 lobby-fallback (R1, BIN-822) — 2026-05-08.
 *
 * Bakgrunn:
 *   Tidligere oppførsel: hvis `socket.createRoom({ hallId })` feilet (typisk
 *   fordi det ikke finnes en `app_game1_scheduled_games`-rad i `purchase_open`/
 *   `running`-state), viste klient den infame "FÅR IKKE KOBLET TIL ROM. TRYKK
 *   HER"-feilen. Tobias-direktiv 2026-05-08: "Så lenge rommet er åpent skal
 *   man ha mulighet til å gå inn i rommet og kjøpe bonger" — selv før
 *   master har trykket Start.
 *
 *   Denne fallbacken kobles inn på Game1Controller når createRoom feiler.
 *   Den henter `Spill1LobbyState` via HTTP, abonnerer på lobby-rom-broadcasts,
 *   og venter på state-overgang før den lar Game1Controller retry-e
 *   createRoom. Mens den venter rendres en HTML-overlay med:
 *     - "Stengt — åpner kl HH:MM" (overallStatus = closed)
 *     - "Neste spill: {navn} — venter på master" (idle)
 *     - "Spillet er ferdig for dagen" (finished)
 *
 *   Når lobby-state-update viser `purchase_open`/`ready_to_start`/`running`
 *   skjuler vi overlayet og ber Game1Controller om å retry-e createRoom.
 *
 * Bevisst design-valg:
 *   - **HTML-overlay, ikke Pixi-skjerm**: vi vil at fallback skal kunne vises
 *     UTEN at Pixi-stagen er klar. Det er også enklere å designe og skjule.
 *   - **HTTP-poll-fallback**: hvis socket-subscribe feiler eller
 *     state-update aldri kommer, poller vi `/api/games/spill1/lobby` hvert
 *     10s som safety-net. Backendendepunkt setter Cache-Control: no-store
 *     så hvert poll-kall går mot autoritativ kilde.
 *   - **Best-effort socket-subscribe**: feil i subscribe → vi faller
 *     automatisk på poll. Logger warning men kaster ikke.
 *
 * Bruk:
 *   ```ts
 *   const fallback = new Game1LobbyFallback({
 *     hallId, socket, onShouldRetryJoin: () => game1Controller.retryJoin()
 *   });
 *   await fallback.start();
 *   // ...
 *   fallback.stop();  // ved Game1Controller.destroy()
 *   ```
 */

import type { Spill1LobbyState } from "@spillorama/shared-types/api";
import type { SpilloramaSocket, Spill1LobbyStateUpdatePayload } from "../../../net/SpilloramaSocket.js";

/** State-mapping fra `Spill1LobbyOverallStatus` til UI-melding. */
const STATUS_HEADLINES: Readonly<Record<Spill1LobbyState["overallStatus"], string>> = {
  closed: "Stengt",
  finished: "Ferdig for dagen",
  idle: "Spillet starter snart",
  paused: "Pauset",
  purchase_open: "Bong-kjøp åpent",
  ready_to_start: "Spillet starter snart",
  running: "Spillet pågår",
};

/** Fra `overallStatus` til om Game1Controller bør retry-e createRoom. */
function shouldAttemptJoin(state: Spill1LobbyState): boolean {
  return (
    state.overallStatus === "purchase_open" ||
    state.overallStatus === "ready_to_start" ||
    state.overallStatus === "running" ||
    state.overallStatus === "paused"
  );
}

export interface Game1LobbyFallbackOptions {
  hallId: string;
  socket: SpilloramaSocket;
  /**
   * Callback når lobby-state indikerer at en runde er klar for join.
   * Game1Controller bruker dette til å re-prøve createRoom.
   */
  onShouldRetryJoin: () => void;
  /**
   * Optional container element for overlay-en. Default: document.body.
   */
  container?: HTMLElement;
  /**
   * Optional overrideable HTTP base-URL. Default: window.location.origin.
   */
  apiBaseUrl?: string;
}

export class Game1LobbyFallback {
  private readonly hallId: string;
  private readonly socket: SpilloramaSocket;
  private readonly onShouldRetryJoin: () => void;
  private readonly container: HTMLElement;
  private readonly apiBaseUrl: string;

  private overlay: HTMLDivElement | null = null;
  private headlineEl: HTMLDivElement | null = null;
  private bodyEl: HTMLDivElement | null = null;

  private socketUnsub: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private currentState: Spill1LobbyState | null = null;
  private hasTriggeredJoin = false;
  private destroyed = false;

  constructor(opts: Game1LobbyFallbackOptions) {
    this.hallId = opts.hallId;
    this.socket = opts.socket;
    this.onShouldRetryJoin = opts.onShouldRetryJoin;
    this.container = opts.container ?? document.body;
    this.apiBaseUrl =
      opts.apiBaseUrl ??
      (typeof window !== "undefined" ? window.location.origin : "");
  }

  /**
   * Vis overlay + abonnere på lobby-state. Returnerer umiddelbart — overlay
   * oppdateres etterhvert som state-update-events kommer. Caller bør IKKE
   * await-e dette over noen tid; Game1Controller fortsetter sin destroy/
   * cleanup uavhengig.
   */
  async start(): Promise<void> {
    if (this.destroyed) return;
    this.mountOverlay();
    this.subscribeSocket();
    // Initial fetch + start polling som safety-net (hvis socket-broadcast
    // aldri kommer, eller hvis flere klient-instanser har konkurrerende
    // subscribes).
    await this.fetchOnce();
    this.startPolling();
  }

  /**
   * Skjul overlay + cleanup. Kalles av Game1Controller.destroy() og
   * automatisk når overall-status indikerer at runden er join-klar.
   */
  stop(): void {
    this.destroyed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.socketUnsub) {
      this.socketUnsub();
      this.socketUnsub = null;
    }
    // Best-effort unsubscribe fra socket-rom; ikke await-er.
    void this.socket.unsubscribeSpill1Lobby(this.hallId).catch(() => {
      // Logging skjer i SpilloramaSocket. Aldri kast fra cleanup.
    });
    this.unmountOverlay();
  }

  /** Test-hook: hent siste kjente state. */
  getCurrentState(): Spill1LobbyState | null {
    return this.currentState;
  }

  // ── interne hjelpere ───────────────────────────────────────────────────

  private mountOverlay(): void {
    if (this.overlay) return;

    // Observability fix-PR 2026-05-13: track lobby-fallback-mount så monitor /
    // dump-rapport ser at klient er stuck på "Kobler til hall…"-flow vs
    // PlayScreen-aktiv-flyt. Fail-soft.
    try {
      void import("../debug/EventTracker.js")
        .then((mod) => {
          try {
            mod.getEventTracker().track("screen.mount", {
              screen: "Game1LobbyFallback",
              hallId: this.hallId,
            });
          } catch {
            /* best-effort */
          }
        })
        .catch(() => {
          /* best-effort */
        });
    } catch {
      /* best-effort */
    }

    const overlay = document.createElement("div");
    overlay.setAttribute("data-spill1-lobby-fallback", "true");
    overlay.style.cssText = [
      "position: fixed",
      "inset: 0",
      "display: flex",
      "flex-direction: column",
      "align-items: center",
      "justify-content: center",
      "background: rgba(8, 16, 32, 0.92)",
      "color: #fff",
      "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      "z-index: 9999",
      "padding: 24px",
      "text-align: center",
    ].join(";");

    const headline = document.createElement("div");
    headline.style.cssText = "font-size: 28px; font-weight: 600; margin-bottom: 12px;";
    headline.textContent = "Kobler til hall…";

    const body = document.createElement("div");
    body.style.cssText = "font-size: 16px; opacity: 0.85; max-width: 480px; line-height: 1.5;";
    body.textContent = "Henter status fra serveren.";

    overlay.appendChild(headline);
    overlay.appendChild(body);
    this.container.appendChild(overlay);

    this.overlay = overlay;
    this.headlineEl = headline;
    this.bodyEl = body;
  }

  private unmountOverlay(): void {
    if (this.overlay && this.overlay.parentElement) {
      this.overlay.parentElement.removeChild(this.overlay);
    }
    this.overlay = null;
    this.headlineEl = null;
    this.bodyEl = null;
  }

  private subscribeSocket(): void {
    // Subscribe til server-side rom slik at `lobby:state-update` mottas.
    // Hvis subscribe-ack returnerer state, bruk det som initial-snapshot.
    void this.socket
      .subscribeSpill1Lobby(this.hallId)
      .then((ack) => {
        if (ack.ok && ack.data?.state) {
          this.applyState(ack.data.state);
        }
      })
      .catch((err) => {
        console.warn("[Game1LobbyFallback] subscribe feilet, faller på HTTP-poll", err);
      });

    // Lytt på pushede state-updates.
    this.socketUnsub = this.socket.on(
      "spill1LobbyStateUpdate",
      (payload: Spill1LobbyStateUpdatePayload) => {
        if (payload.hallId !== this.hallId) return;
        this.applyState(payload.state);
      },
    );
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    // 10s som matcher backend-Cache-Control: no-store policy + SLA i
    // Game1LobbyService-doc. Gir oss safety-net hvis socket-subscribe
    // eller broadcast feiler stille.
    this.pollTimer = setInterval(() => {
      void this.fetchOnce();
    }, 10_000);
  }

  private async fetchOnce(): Promise<void> {
    if (this.destroyed) return;
    try {
      const url = `${this.apiBaseUrl}/api/games/spill1/lobby?hallId=${encodeURIComponent(this.hallId)}`;
      const res = await fetch(url, { credentials: "omit" });
      // 2026-05-11 Tobias-direktiv: 429-rate-limit må aldri lekke
      // sekund-countdown til kunden. Polling-loopen vår er allerede 10s,
      // så bare logg og hold overlay-en (sist kjente headline står). Backend
      // alerting fanger persistent 429-mønster — vi forsøker bare igjen ved
      // neste tick.
      if (res.status === 429) {
        console.warn("[Game1LobbyFallback] poll throttled (429) — behold sist kjente state");
        return;
      }
      if (!res.ok) return;
      const body = (await res.json()) as
        | { ok: true; data: Spill1LobbyState }
        | { ok: false; error?: { code: string; message: string } };
      if (body.ok && body.data) {
        this.applyState(body.data);
      }
    } catch (err) {
      console.warn("[Game1LobbyFallback] fetch feilet", err);
    }
  }

  /**
   * Oppdater overlay-innhold og trigger join-retry hvis state indikerer
   * at en runde er klar.
   */
  private applyState(state: Spill1LobbyState): void {
    this.currentState = state;
    if (this.headlineEl && this.bodyEl) {
      this.headlineEl.textContent = STATUS_HEADLINES[state.overallStatus];
      this.bodyEl.textContent = describeStateBody(state);
    }
    if (!this.hasTriggeredJoin && shouldAttemptJoin(state)) {
      this.hasTriggeredJoin = true;
      // Avbryt polling — Game1Controller tar over fra her.
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      // Skjul overlay før retry slik at Game1Controller kan rendre.
      this.unmountOverlay();
      this.onShouldRetryJoin();
    }
  }
}

function describeStateBody(state: Spill1LobbyState): string {
  if (state.overallStatus === "closed") {
    if (state.openingTimeStart && state.openingTimeEnd) {
      return `Åpningstid: ${state.openingTimeStart}–${state.openingTimeEnd}.`;
    }
    return "Hallen er stengt.";
  }
  if (state.overallStatus === "finished") {
    return "Spilleplanen er ferdig for dagen. Kom tilbake i morgen!";
  }
  if (state.nextScheduledGame) {
    const name = state.nextScheduledGame.catalogDisplayName;
    if (state.nextScheduledGame.scheduledStartTime) {
      const eta = formatEta(state.nextScheduledGame.scheduledStartTime);
      if (eta) {
        return `Neste spill: ${name} (${eta}).`;
      }
    }
    return `Neste spill: ${name}.`;
  }
  if (state.openingTimeEnd) {
    return `Hallen er åpen til ${state.openingTimeEnd}.`;
  }
  return "Venter på neste spill.";
}

function formatEta(isoTime: string): string | null {
  const ts = Date.parse(isoTime);
  if (!Number.isFinite(ts)) return null;
  const diffMs = ts - Date.now();
  if (diffMs <= 0) return "starter nå";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes <= 0) return "starter nå";
  if (minutes === 1) return "om 1 min";
  if (minutes < 60) return `om ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "om ca 1 time";
  return `om ca ${hours} timer`;
}
