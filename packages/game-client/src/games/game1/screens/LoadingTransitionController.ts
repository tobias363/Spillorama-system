/**
 * Ekstern-konsulent-plan P0-3 (2026-05-17): tiny controller som eier
 * loader-transition-deadline + faktisk setTimeout for cleanup.
 *
 * ## Hvorfor en egen klasse?
 *
 * Pre-P0-3 satt `PlayScreen` deadline kun som wall-clock-timestamp og
 * sjekket det inni `update()`. Hvis server sluttet å sende `room:update`
 * (frozen-state), kjørte `update()` aldri — og loader sto evig i UI selv
 * om deadline-en hadde passert.
 *
 * Fix: arm en faktisk `setTimeout` ved siden av deadline. Når timeren
 * fyrer kaller den `onTimeout`-callbacken som PlayScreen wirer til
 * `update(lastState)` — det re-evaluerer idle-mode med ryddet deadline.
 *
 * Vi ekstraherte til egen klasse fordi:
 *
 * 1. PlayScreen extends Pixi Container ⇒ kan ikke instansieres i unit-
 *    test uten mocking av hele Pixi-stacken. En egen liten klasse er
 *    direkte testbar.
 * 2. Timer-håndtering (idempotent arm/clear, test-injection av
 *    setTimeout/clearTimeout) er nok ansvar til å rettferdiggjøre sin
 *    egen klasse.
 * 3. Mønsteret matcher `AutoReloadOnDisconnect` og
 *    `LiveRoomRecoverySupervisor` som også er egne testbare controllers.
 *
 * ## Lifecycle
 *
 * - `arm()`: starter timer. Idempotent — eksisterende timer kanselleres
 *   først så vi ikke får dobbel-fyring.
 * - `clear()`: cancel uten å fyre callback. Idempotent.
 * - `isActive(now)`: sjekk om deadline fortsatt aktiv (mirror av
 *   `update()`-logikken inni PlayScreen for forrang-evaluering).
 * - `destroy()`: cancel + frigjør state. Brukes ved PlayScreen.destroy().
 *
 * Når timer fyrer:
 *   - `loadingTransitionDeadline` og `loadingTransitionTimer` ryddes
 *   - `onTimeout()`-callback kalles
 *   - Caller (PlayScreen) skal re-rendere idle-mode med ryddet deadline
 */

export interface LoadingTransitionControllerOptions {
  /**
   * Threshold i ms. Standard 10000. Kan overskrives av tester for å
   * unngå lange ventetider.
   */
  timeoutMs: number;
  /**
   * Callback som fyres når timer-en utløper UTEN at `clear()` ble
   * kalt først. PlayScreen wirer denne til `update(lastState)` slik at
   * idle-mode re-evaluerer med ryddet deadline.
   */
  onTimeout: () => void;
  /** Test-injection: override `setTimeout`. */
  setTimeoutFn?: typeof setTimeout;
  /** Test-injection: override `clearTimeout`. */
  clearTimeoutFn?: typeof clearTimeout;
  /** Test-injection: override `Date.now`. */
  now?: () => number;
}

export class LoadingTransitionController {
  private readonly timeoutMs: number;
  private readonly onTimeout: () => void;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly now: () => number;

  private deadline: number | null = null;
  private timerHandle: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(opts: LoadingTransitionControllerOptions) {
    this.timeoutMs = opts.timeoutMs;
    this.onTimeout = opts.onTimeout;
    // Wrap i arrow-funksjon for å unngå `Illegal invocation` ved native
    // setTimeout bound til klasse-instans (samme mønster som
    // AutoReloadOnDisconnect.ts:114-120 og LiveRoomRecoverySupervisor.ts).
    this.setTimeoutFn =
      opts.setTimeoutFn ??
      (((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
        setTimeout(handler, timeout, ...args)) as unknown as typeof setTimeout);
    this.clearTimeoutFn =
      opts.clearTimeoutFn ??
      (((handle?: number) =>
        clearTimeout(handle)) as unknown as typeof clearTimeout);
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Arm timer + sett wall-clock-deadline. Idempotent — tidligere armert
   * timer kanselleres først så `onTimeout` ikke fyrer to ganger.
   *
   * No-op hvis controlleren er destroyed.
   */
  arm(): void {
    if (this.destroyed) return;
    if (this.timerHandle !== null) {
      this.clearTimeoutFn(this.timerHandle);
      this.timerHandle = null;
    }
    this.deadline = this.now() + this.timeoutMs;
    this.timerHandle = this.setTimeoutFn(() => {
      // Timer fyrte UTEN at noen kalt `clear()` først → cleanup +
      // onTimeout-callback. Caller (PlayScreen) re-rendererer idle-
      // mode med ryddet deadline.
      this.timerHandle = null;
      this.deadline = null;
      if (!this.destroyed) {
        try {
          this.onTimeout();
        } catch (err) {
          // Fail-soft: hvis onTimeout-callback kaster (eks. update()
          // throw-er), ikke krasj controlleren. Logg og fortsett —
          // neste arm() vil fungere normalt.
          console.warn(
            "[LoadingTransitionController] onTimeout-callback kastet — controller fortsetter normalt",
            err,
          );
        }
      }
    }, this.timeoutMs);
  }

  /**
   * Cancel timer uten å fyre `onTimeout`. Idempotent.
   * Brukes når en ny runde starter eller når `update()` oppdager at
   * server-advance har levert ny catalogSlug.
   */
  clear(): void {
    this.deadline = null;
    if (this.timerHandle !== null) {
      this.clearTimeoutFn(this.timerHandle);
      this.timerHandle = null;
    }
  }

  /**
   * Sjekk om loader-state fortsatt er aktiv (deadline ikke passert).
   * Brukes inni `update()` for å avgjøre idle-mode (`loading` vs
   * `next-game`/`waiting-master`/`closed`).
   */
  isActive(): boolean {
    if (this.deadline === null) return false;
    return this.now() < this.deadline;
  }

  /**
   * Test/inspeksjon: hent deadline-timestamp eller null.
   */
  getDeadline(): number | null {
    return this.deadline;
  }

  /**
   * Test/inspeksjon: er timer armert?
   */
  hasActiveTimer(): boolean {
    return this.timerHandle !== null;
  }

  /**
   * Cleanup ved PlayScreen.destroy(). Cancel timer + sett destroyed-
   * flag slik at videre `arm()`-kall blir no-op.
   */
  destroy(): void {
    this.clear();
    this.destroyed = true;
  }
}
