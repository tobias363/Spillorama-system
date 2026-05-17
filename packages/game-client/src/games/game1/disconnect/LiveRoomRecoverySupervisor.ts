/**
 * Ekstern-konsulent-plan P0-2 (2026-05-17): klient-side supervisor som dekker
 * "frozen live-state med koblet socket"-scenarier som `AutoReloadOnDisconnect`
 * ikke fanger.
 *
 * ## Hvorfor en ny supervisor?
 *
 * Spill 1 har tre eksisterende recovery-lag, men ingen koordinerer dem:
 *
 * 1. `AutoReloadOnDisconnect` (30 s) — fyrer KUN ved socket-disconnected.
 * 2. `LoadingOverlay` soft-fallback (8 s) — viser "Last på nytt"-knapp men
 *    forutsetter aktiv overlay og brukerklikk.
 * 3. `Game1ReconnectFlow` — kalles fra `connectionStateChanged === "connected"`
 *    etter et faktisk reconnect. Ved evig RESYNCING logger den
 *    `console.error("user must reload")` uten å gjøre noe.
 *
 * Server-side er det `Game1StuckGameDetectionService` (ADR-0022 Lag 2) som
 * auto-kansellerer scheduled-games etter 5 min uten draws. 5 min er failure
 * escalation — spilleren har for lengst forlatt sesjonen før det skjer.
 *
 * Spillerne har dermed en gap-zone: socket er "connected", men ingen
 * `room:update` eller `draw:new`-events kommer inn. Lobby-fetch henger,
 * scheduled-game-state er stale, master har advancert til neste posisjon
 * uten at klienten følger med. Brukeren ser en "låst" skjerm uten feedback.
 *
 * ## Tre eskalerings-tier
 *
 * Watchdog-tikken kjører hvert `watchdogIntervalMs` (default 5 s). Hvis
 * rommet er aktivt og socket er koblet til, men ingen frisk update er
 * mottatt på `markUpdateReceived()` i `tier1ThresholdMs`:
 *
 * - **Tier 1 (default 10 s):** `tryResumeFlow` — be socket om `resumeRoom`
 *   + `getRoomState`-snapshot. Lett-vekt operasjon.
 * - **Tier 2 (default 30 s):** `tryRejoinFlow` — hent fersk lobby-state +
 *   nytt `game1:join-scheduled`. Behandler scenarier hvor master har
 *   advancert plan og klient har feil scheduled-game-id.
 * - **Tier 3 (default 60 s):** `triggerHardReload` — kontrollert
 *   `window.location.reload()`. Skal gjenbruke `AutoReloadOnDisconnect`
 *   sin sessionStorage-attempts-counter for å unngå reload-loop.
 *
 * Når en handling lykkes blir tier-en frosset til neste fresh update
 * kommer inn. `markUpdateReceived()` resetter `firedTier` til 0 — det er
 * signalet om at recovery faktisk virket.
 *
 * ## Hvorfor IKKE bare hard reload med en gang?
 *
 * - Manuell reload betyr at brukeren mister context. Tier 1/2 prøver
 *   stillere recovery først.
 * - Reload-loop er en realfølge hvis kjernen er nede. `AutoReloadOnDisconnect`
 *   eier reload-loop-beskyttelsen; supervisor delegerer Tier 3-trigger til
 *   `triggerHardReload`-callback slik at samme attempts-counter brukes.
 * - Sentry/PostHog skiller mellom Tier 1 (silent), Tier 2 (visible) og
 *   Tier 3 (hard) for å måle hvor ofte vi når hver eskalering — den dataen
 *   forteller oss om backend er stabil nok for pilot.
 *
 * ## Conditions for escalation (alle MÅ være sanne)
 *
 * 1. Socket er `connected` (ikke `reconnecting` eller `disconnected` —
 *    de håndteres av `AutoReloadOnDisconnect`).
 * 2. Rommet er i en "aktiv" tilstand (`RUNNING` eller `WAITING`) — vi
 *    fyrer ikke recovery for `LOADING`, `ENDED` eller pre-join.
 * 3. `lastUpdateAtMs` er eldre enn `tierNThresholdMs`.
 * 4. `firedTier < N` — vi har ikke allerede fyrt samme eller høyere tier.
 *
 * Hvis condition 1 eller 2 svikter, resettes ikke `firedTier` automatisk;
 * supervisor venter på `markUpdateReceived()`. Dette unngår at en kort
 * pause (eks. mid-runde end-of-round-overlay) trigger fri-tilbake til
 * tier 0 og deretter ny tier 1.
 *
 * ## Test-pattern
 *
 * Constructor tar `now`/`setIntervalFn`/`clearIntervalFn` for testability.
 * Tester kontrollerer klokka, kaller `tick()` manuelt, og verifiserer at
 * riktig tier kall'es. `inFlightAction` hindrer overlappende tier-kjøringer.
 */

export type SocketConnectionState = "connected" | "reconnecting" | "disconnected";

export interface RecoveryContext {
  /** Current socket-connection-state, observed from `SpilloramaSocket`. */
  socketState: SocketConnectionState;
  /**
   * Active scheduled-game-id (`app_game1_scheduled_games.id`), eller null
   * hvis klient er i ad-hoc flyt (ikke scheduled Spill 1).
   */
  scheduledGameId: string | null;
  /** Faktisk room-code etter `socket.createRoom`/`joinScheduledGame`. */
  roomCode: string;
  /**
   * Er rommet i en aktiv tilstand som forventer events? `true` for
   * `RUNNING` og `WAITING`; `false` for `LOADING`, `ENDED`, eller før
   * join har lyktes.
   */
  isRoomActive: boolean;
}

export interface LiveRoomRecoverySupervisorOptions {
  /** Read-only observer av nåværende klient-state. Kalles fra watchdog. */
  getContext: () => RecoveryContext;
  /**
   * Tier 1 (default 10 s): be socket om `resumeRoom` + `getRoomState`.
   * Returner `true` hvis state ble oppfrisket (klient mottok snapshot).
   */
  tryResumeFlow: () => Promise<boolean>;
  /**
   * Tier 2 (default 30 s): re-fetch lobby-state + nytt `game1:join-scheduled`.
   * Returner `true` hvis klient er bound mot riktig scheduled-game-id.
   */
  tryRejoinFlow: () => Promise<boolean>;
  /**
   * Tier 3 (default 60 s): kontrollert hard reload. Skal delegere til
   * `AutoReloadOnDisconnect`-style attempts-counter for å unngå reload-loop.
   */
  triggerHardReload: () => void;
  /** Default 10_000 (10 s). */
  tier1ThresholdMs?: number;
  /** Default 30_000 (30 s). */
  tier2ThresholdMs?: number;
  /** Default 60_000 (60 s). */
  tier3ThresholdMs?: number;
  /** Default 5_000 (5 s). Hvor ofte watchdog evaluerer. */
  watchdogIntervalMs?: number;
  /** Test-injection: override `Date.now`. */
  now?: () => number;
  /** Test-injection: override `setInterval`. */
  setIntervalFn?: typeof setInterval;
  /** Test-injection: override `clearInterval`. */
  clearIntervalFn?: typeof clearInterval;
  /**
   * Telemetri-callback fyrt når en tier trigger. Brukes til PostHog/Sentry
   * for å måle hvor ofte recovery er nødvendig under pilot.
   */
  onTierTriggered?: (tier: 1 | 2 | 3, reason: string, stalenessMs: number) => void;
  /**
   * Telemetri-callback fyrt når en tier-handling lykkes (state ble friskt
   * etter call). Brukes for å skille effektiv recovery fra reload-loop.
   */
  onRecoverySucceeded?: (tier: 1 | 2 | 3, durationMs: number) => void;
}

const DEFAULT_TIER1_MS = 10_000;
const DEFAULT_TIER2_MS = 30_000;
const DEFAULT_TIER3_MS = 60_000;
const DEFAULT_WATCHDOG_INTERVAL_MS = 5_000;

export class LiveRoomRecoverySupervisor {
  private readonly getContext: () => RecoveryContext;
  private readonly tryResumeFlow: () => Promise<boolean>;
  private readonly tryRejoinFlow: () => Promise<boolean>;
  private readonly triggerHardReload: () => void;
  private readonly tier1ThresholdMs: number;
  private readonly tier2ThresholdMs: number;
  private readonly tier3ThresholdMs: number;
  private readonly watchdogIntervalMs: number;
  private readonly now: () => number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private readonly onTierTriggered: (
    tier: 1 | 2 | 3,
    reason: string,
    stalenessMs: number,
  ) => void;
  private readonly onRecoverySucceeded: (tier: 1 | 2 | 3, durationMs: number) => void;

  private lastUpdateAtMs: number;
  private watchdogHandle: ReturnType<typeof setInterval> | null = null;
  /** Høyeste tier som har fyrt siden siste fresh update. 0 = ingen. */
  private firedTier: 0 | 1 | 2 | 3 = 0;
  /** Pågående tier-handling. Hindrer overlappende kall. */
  private inFlightAction: Promise<boolean> | null = null;
  private started = false;

  constructor(opts: LiveRoomRecoverySupervisorOptions) {
    this.getContext = opts.getContext;
    this.tryResumeFlow = opts.tryResumeFlow;
    this.tryRejoinFlow = opts.tryRejoinFlow;
    this.triggerHardReload = opts.triggerHardReload;
    this.tier1ThresholdMs = opts.tier1ThresholdMs ?? DEFAULT_TIER1_MS;
    this.tier2ThresholdMs = opts.tier2ThresholdMs ?? DEFAULT_TIER2_MS;
    this.tier3ThresholdMs = opts.tier3ThresholdMs ?? DEFAULT_TIER3_MS;
    this.watchdogIntervalMs = opts.watchdogIntervalMs ?? DEFAULT_WATCHDOG_INTERVAL_MS;
    this.now = opts.now ?? (() => Date.now());
    // Wrap-i-arrow-funksjon for å unngå `Illegal invocation` ved native
    // setTimeout/setInterval-bind. Se AutoReloadOnDisconnect.ts:110-120
    // for samme mønster (Tobias-bug 2026-05-12).
    this.setIntervalFn =
      opts.setIntervalFn ??
      (((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
        setInterval(handler, timeout, ...args)) as unknown as typeof setInterval);
    this.clearIntervalFn =
      opts.clearIntervalFn ??
      (((handle?: number) =>
        clearInterval(handle)) as unknown as typeof clearInterval);
    this.onTierTriggered = opts.onTierTriggered ?? (() => {});
    this.onRecoverySucceeded = opts.onRecoverySucceeded ?? (() => {});
    this.lastUpdateAtMs = this.now();

    // Sanity check på threshold-ordning. Et utilsiktet
    // `tier2 < tier1` ville hoppe over tier 1 helt — fail-fast i tester.
    if (
      this.tier1ThresholdMs >= this.tier2ThresholdMs ||
      this.tier2ThresholdMs >= this.tier3ThresholdMs
    ) {
      throw new Error(
        `LiveRoomRecoverySupervisor: thresholds må være tier1 < tier2 < tier3, ` +
        `fikk ${this.tier1ThresholdMs} / ${this.tier2ThresholdMs} / ${this.tier3ThresholdMs}`,
      );
    }
  }

  /**
   * Start periodisk watchdog. Idempotent — gjentatte kall er trygt.
   * Caller skal kalle `stop()` ved cleanup (eks. Game1Controller.destroy()).
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.lastUpdateAtMs = this.now();
    this.watchdogHandle = this.setIntervalFn(() => {
      void this.tick();
    }, this.watchdogIntervalMs);
  }

  /**
   * Stopp watchdog. Idempotent. Cancel-er IKKE in-flight tier-handlinger —
   * de runner ferdig men `firedTier` blir liggende slik at recovery
   * fortsatt rapporteres til telemetri.
   */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.watchdogHandle !== null) {
      this.clearIntervalFn(this.watchdogHandle);
      this.watchdogHandle = null;
    }
  }

  /**
   * Game1Controller kaller dette fra `bridge.on("stateChanged" | "numberDrawn"
   * | "patternWon" | ...)`. Signalet er at fresh data har nådd klient → reset
   * eskalering.
   */
  markUpdateReceived(): void {
    this.lastUpdateAtMs = this.now();
    if (this.firedTier > 0) {
      // Fresh data etter tier-trigger = recovery lyktes. Telemetri.
      // Vi har ikke duration-tracking per tier her; recovery-time måles
      // av in-flight-promise-en når den resolver til true.
      this.firedTier = 0;
    }
  }

  /**
   * Test-seam: kjør én watchdog-tick på etterspørsel. Brukes av tester
   * og som internt callback fra setInterval.
   *
   * Idempotent — hvis en tier-handling allerede er in-flight, no-op.
   */
  async tick(): Promise<void> {
    if (this.inFlightAction !== null) {
      // Tier-handling pågår allerede; skip denne ticken. Vi vil få
      // resultatet i `inFlightAction.then` og kan re-evaluere ved
      // neste tick.
      return;
    }

    const decision = this.shouldEscalate();
    if (decision.tier === null) {
      return;
    }

    const startMs = this.now();
    this.firedTier = decision.tier;
    this.onTierTriggered(decision.tier, decision.reason, decision.stalenessMs);

    if (decision.tier === 1) {
      this.inFlightAction = this.tryResumeFlow();
    } else if (decision.tier === 2) {
      this.inFlightAction = this.tryRejoinFlow();
    } else {
      // Tier 3: hard reload. Vi venter ikke på resultat — reload bytter
      // hele page-context. Trigger og clear.
      this.triggerHardReload();
      // Tier 3 har ingen success-callback fordi page er borte etter
      // reload. Skip onRecoverySucceeded.
      this.inFlightAction = null;
      return;
    }

    // Tier 1/2 — vent på resultat. (Tier 3 returnerte allerede.)
    const tier12 = decision.tier; // narrow til 1 | 2
    try {
      const ok = await this.inFlightAction;
      if (ok) {
        const durationMs = this.now() - startMs;
        this.onRecoverySucceeded(tier12, durationMs);
        // `markUpdateReceived()` resetter `firedTier`. Vi gjør det
        // IKKE her — vi venter på ekte fresh data fra bridge-event-en
        // som indirekte trigger update. Hvis tier-en sa "ok" men
        // markUpdateReceived ikke kalles innen neste threshold, vil
        // vi eskalere til neste tier (correctly).
      }
    } catch {
      // Fail-soft: tier-handling kastet. Beholdes som firedTier slik
      // at supervisor ikke spammer samme tier hvert tick. Neste tier
      // vil prøves når threshold passeres.
    } finally {
      this.inFlightAction = null;
    }
  }

  /**
   * Test-eksponering: hvilken tier som sist har fyrt. Brukes av tester
   * for å verifisere eskalering uten tilgang til private state.
   */
  getCurrentFiredTier(): 0 | 1 | 2 | 3 {
    return this.firedTier;
  }

  /** Test-eksponering: tidspunkt for siste markUpdateReceived. */
  getLastUpdateAtMs(): number {
    return this.lastUpdateAtMs;
  }

  // ── internal ───────────────────────────────────────────────────────────

  private shouldEscalate(): {
    tier: 1 | 2 | 3 | null;
    reason: string;
    stalenessMs: number;
  } {
    const ctx = this.getContext();
    const stalenessMs = this.now() - this.lastUpdateAtMs;

    // Eskaler aldri når socket ikke er "connected" — det er
    // AutoReloadOnDisconnect-territorium.
    if (ctx.socketState !== "connected") {
      return { tier: null, reason: `socket-state-${ctx.socketState}`, stalenessMs };
    }
    // Eskaler aldri når rommet ikke er aktivt — end-of-round-overlay,
    // pre-join, eller LOADING-state er ikke "frozen"-scenarier.
    if (!ctx.isRoomActive) {
      return { tier: null, reason: "room-not-active", stalenessMs };
    }

    if (stalenessMs >= this.tier3ThresholdMs && this.firedTier < 3) {
      return { tier: 3, reason: `stale-${stalenessMs}ms-tier3`, stalenessMs };
    }
    if (stalenessMs >= this.tier2ThresholdMs && this.firedTier < 2) {
      return { tier: 2, reason: `stale-${stalenessMs}ms-tier2`, stalenessMs };
    }
    if (stalenessMs >= this.tier1ThresholdMs && this.firedTier < 1) {
      return { tier: 1, reason: `stale-${stalenessMs}ms-tier1`, stalenessMs };
    }
    return { tier: null, reason: "fresh", stalenessMs };
  }
}
