/**
 * Tobias-bug 2026-05-12: når spillerklient-socket disconnect-er må siden
 * automatisk reloade for å gjenoppta state. Hvis manuell reload trengs,
 * blir spilleren sittende fast på "Rommet finnes ikke"-feilmelding fra
 * REST-purchase-pathen.
 *
 * Brukeren beskrev: "Funket når jeg gikk inn og ut" — manuell page-reload
 * er den pragmatiske recovery-metoden. Vi automatiserer det:
 *
 *   1. Når socket-state = "disconnected" → armér 30-sekunder-timer
 *   2. Hvis socket fortsatt disconnected ved timeout → window.location.reload()
 *   3. Hvis socket re-connecter før timeout → cancel timer (ingen reload)
 *   4. Track reload-attempts i sessionStorage:
 *      - ≤ MAX_ATTEMPTS (3) reloads i WINDOW_MS (2 min) → fortsett å reload
 *      - > MAX_ATTEMPTS → vis "Tekniske problemer"-melding i stedet
 *        (manuell reload-knapp; reload-loop forhindret)
 *
 * PR #1247-regresjon (Tobias 2026-05-12): brukeren ble kastet ut av spillet
 * ved kortvarige nett-glipper. To endringer:
 *
 *   - DEFAULT_DELAY_MS økt fra 5s til 30s. Socket.io reconnect-backoff kan
 *     gå opp til reconnectionDelayMax=30s. 5s ga ikke nok tid — reload fyrte
 *     mens socket.io fortsatt prøvde å rekoble.
 *   - markConnected()-gate. armReload() er no-op før markConnected() er
 *     kalt minst én gang. Hindrer reload-loop hvis initial-connect feiler
 *     permanent (eks. server nede ved første sidelast, auth-token utløpt).
 *
 * Idempotent: kall start() flere ganger overrider eksisterende timer.
 * Tester injecter `reloadFn` + `now`-clock + `storage` for å kunne verifisere
 * uten faktisk DOM-reload.
 */

const STORAGE_KEY = "spillorama:reload-attempts";
const DEFAULT_DELAY_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_WINDOW_MS = 2 * 60 * 1_000; // 2 min

export interface AutoReloadOptions {
  /** Hvor lenge å vente i disconnect-state før reload trigges. Default 30s. */
  delayMs?: number;
  /** Maks antall reloads i samme window før vi gir opp. Default 3. */
  maxAttempts?: number;
  /** Vindu for å telle attempts. Default 2 min. */
  windowMs?: number;
  /** Override reload-funksjon (testing). Default `window.location.reload()`. */
  reloadFn?: () => void;
  /** Override clock (testing). Default `Date.now`. */
  now?: () => number;
  /** Override sessionStorage (testing). Default `globalThis.sessionStorage`. */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** Callback når reload-grensen er nådd. UI bør vise "tekniske problemer". */
  onMaxAttemptsReached?: () => void;
  /** setTimeout-injection. Default global `setTimeout`. */
  setTimeoutFn?: typeof setTimeout;
  /** clearTimeout-injection. Default global `clearTimeout`. */
  clearTimeoutFn?: typeof clearTimeout;
}

/**
 * Stateful controller for auto-reload-on-disconnect.
 *
 * Bruk:
 * ```ts
 * const reloader = new AutoReloadOnDisconnect();
 * socket.on("connectionStateChanged", (state) => {
 *   if (state === "disconnected") reloader.armReload();
 *   if (state === "connected") reloader.cancelReload();
 * });
 * ```
 */
export class AutoReloadOnDisconnect {
  private readonly delayMs: number;
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly reloadFn: () => void;
  private readonly now: () => number;
  private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  private readonly onMaxAttemptsReached: () => void;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;

  private timerHandle: ReturnType<typeof setTimeout> | null = null;

  /**
   * PR #1247-regresjon (Tobias 2026-05-12): defensive gate mot reload-loop
   * hvis initial-connect feiler permanent. armReload() er no-op før
   * markConnected() er kalt minst én gang. Caller skal kalle markConnected()
   * fra socket "connected"-event-handler.
   */
  private hasBeenConnected = false;

  constructor(opts: AutoReloadOptions = {}) {
    this.delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;
    this.maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
    this.reloadFn =
      opts.reloadFn ??
      (() => {
        if (typeof window !== "undefined") {
          window.location.reload();
        }
      });
    this.now = opts.now ?? (() => Date.now());
    this.storage =
      opts.storage ??
      (typeof globalThis !== "undefined" && "sessionStorage" in globalThis
        ? (globalThis as { sessionStorage: Storage }).sessionStorage
        : noopStorage());
    this.onMaxAttemptsReached = opts.onMaxAttemptsReached ?? (() => {});
    // Tobias-bug 2026-05-12: `Uncaught TypeError: Illegal invocation` ved socket-disconnect.
    // Browser-native setTimeout/clearTimeout krever `this === globalThis`. Assignet som
    // instance-property uten bind() kalles de med `this === AutoReloadOnDisconnect`
    // → Illegal invocation. Wrap i arrow-funksjon som forwarder med korrekt this.
    this.setTimeoutFn =
      opts.setTimeoutFn ??
      (((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
        setTimeout(handler, timeout, ...args)) as unknown as typeof setTimeout);
    this.clearTimeoutFn =
      opts.clearTimeoutFn ??
      (((handle?: number) => clearTimeout(handle)) as unknown as typeof clearTimeout);
  }

  /**
   * Markér at socket har koblet til server minst én gang. armReload() er
   * no-op før denne kalles. Defensive guard mot reload-loop hvis initial-
   * connect feiler permanent (eks. server nede ved første sidelast,
   * auth-token utløpt).
   *
   * Caller (Game1Controller) skal kalle dette fra `connectionStateChanged`-
   * handler ved state="connected". Flagget er one-way — én gang sann,
   * forblir sann for hele lifetime av AutoReloadOnDisconnect-instansen.
   */
  markConnected(): void {
    this.hasBeenConnected = true;
  }

  /**
   * Armér en reload-timer. Hvis allerede armert er kallet no-op (idempotent).
   * Når socket re-connecter, ring `cancelReload()` for å avbryte.
   *
   * No-op hvis `markConnected()` ikke er kalt ennå — hindrer reload-loop
   * hvis initial-connect feiler permanent.
   */
  armReload(): void {
    if (!this.hasBeenConnected) {
      // PR #1247-regresjon (Tobias 2026-05-12): no-op før første connect.
      // Hvis socket aldri har lykkes med å koble til, har vi ingen grunn
      // til å reload-e (reload vil bare føre til samme feil-tilstand).
      // Caller skal vise error-overlay via setError() i stedet.
      return;
    }
    if (this.timerHandle !== null) {
      // Allerede armert — ingen grunn til å reset-e timeren (vi vil reload
      // raskere, ikke senere).
      return;
    }
    this.timerHandle = this.setTimeoutFn(() => {
      this.timerHandle = null;
      this.executeReloadOrFallback();
    }, this.delayMs);
  }

  /**
   * Avbryt pågående reload-timer. Idempotent.
   */
  cancelReload(): void {
    if (this.timerHandle !== null) {
      this.clearTimeoutFn(this.timerHandle);
      this.timerHandle = null;
    }
  }

  /**
   * Tier 3-fra-LiveRoomRecoverySupervisor (2026-05-17): trigger
   * reload-or-fallback umiddelbart uten å vente på 30s-timer-en. Brukes
   * når supervisor har konkludert at frozen-state ikke kan recovery-es
   * via tier 1 (resume) eller tier 2 (rejoin) — vi vil hard-reload
   * MEN med samme reload-loop-beskyttelse som ved socket-disconnect.
   *
   * Idempotent: tier-1/2-cancel-er pågående armert reload først så vi
   * ikke trigger dobbel reload. Gated på `hasBeenConnected` som andre
   * reload-trigger-paths.
   */
  triggerImmediateReload(): void {
    if (!this.hasBeenConnected) {
      // Samme gate som armReload — hindrer reload-loop hvis initial-
      // connect feilet permanent.
      return;
    }
    // Cancel pending armed reload først så ikke begge fyrer.
    if (this.timerHandle !== null) {
      this.clearTimeoutFn(this.timerHandle);
      this.timerHandle = null;
    }
    this.executeReloadOrFallback();
  }

  /**
   * Sjekk om vi har truffet max-attempts uten å trigge reload. Brukt av
   * tester og evt. UI for å vise "tekniske problemer"-overlay før timer
   * ferdig.
   */
  hasExceededMaxAttempts(): boolean {
    const attempts = this.readAttempts();
    return attempts.length >= this.maxAttempts;
  }

  /**
   * Manuell reset (eks. når bruker eksplisitt sier "Prøv igjen" etter
   * tekniske-problemer-overlay). Nullstiller attempt-counter.
   */
  resetAttempts(): void {
    try {
      this.storage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  // ── internal ────────────────────────────────────────────────────────────

  private executeReloadOrFallback(): void {
    const nowMs = this.now();
    const recentAttempts = this.readAttempts().filter(
      (t) => nowMs - t < this.windowMs,
    );

    if (recentAttempts.length >= this.maxAttempts) {
      // Reload-loop oppdaget — kjernen er sannsynligvis nede. Stopp og vis
      // UI-melding. Caller (Game1Controller) viser overlay via callback.
      this.onMaxAttemptsReached();
      return;
    }

    recentAttempts.push(nowMs);
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(recentAttempts));
    } catch {
      /* ignore — vi reload-er uansett */
    }
    this.reloadFn();
  }

  private readAttempts(): number[] {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((t): t is number => typeof t === "number");
    } catch {
      return [];
    }
  }
}

function noopStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  // Brukt i SSR/test-miljø uten sessionStorage. No-op.
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}
