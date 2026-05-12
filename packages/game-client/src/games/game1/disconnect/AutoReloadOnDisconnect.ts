/**
 * Tobias-bug 2026-05-12: når spillerklient-socket disconnect-er må siden
 * automatisk reloade for å gjenoppta state. Hvis manuell reload trengs,
 * blir spilleren sittende fast på "Rommet finnes ikke"-feilmelding fra
 * REST-purchase-pathen.
 *
 * Brukeren beskrev: "Funket når jeg gikk inn og ut" — manuell page-reload
 * er den pragmatiske recovery-metoden. Vi automatiserer det:
 *
 *   1. Når socket-state = "disconnected" → armér 5-sekunder-timer
 *   2. Hvis socket fortsatt disconnected ved timeout → window.location.reload()
 *   3. Hvis socket re-connecter før timeout → cancel timer (ingen reload)
 *   4. Track reload-attempts i sessionStorage:
 *      - ≤ MAX_ATTEMPTS (3) reloads i WINDOW_MS (2 min) → fortsett å reload
 *      - > MAX_ATTEMPTS → vis "Tekniske problemer"-melding i stedet
 *        (manuell reload-knapp; reload-loop forhindret)
 *
 * Idempotent: kall start() flere ganger overrider eksisterende timer.
 * Tester injecter `reloadFn` + `now`-clock + `storage` for å kunne verifisere
 * uten faktisk DOM-reload.
 */

const STORAGE_KEY = "spillorama:reload-attempts";
const DEFAULT_DELAY_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_WINDOW_MS = 2 * 60 * 1_000; // 2 min

export interface AutoReloadOptions {
  /** Hvor lenge å vente i disconnect-state før reload trigges. Default 5s. */
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
    this.setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;
  }

  /**
   * Armér en reload-timer. Hvis allerede armert er kallet no-op (idempotent).
   * Når socket re-connecter, ring `cancelReload()` for å avbryte.
   */
  armReload(): void {
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
