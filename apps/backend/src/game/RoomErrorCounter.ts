/**
 * Bølge K5 (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §2.4 / CRIT-4):
 * Per-room circuit-breaker counter for engine error-handling hooks.
 *
 * **Bakgrunn:** `BingoEngine.drawNextNumber` har flere `try { … } catch (err)
 * { logger.error(…) }`-blokker rundt hooks som `onDrawCompleted` og
 * `evaluateActivePhase`. Mønsteret er bevisst (wallet-mutating errors halt;
 * non-wallet errors continue), men det har ingen rate-limiting.
 *
 * Prod-incident 2026-04-29 14:18-14:19: engine logget 29 identiske
 * "Wallet house-... mangler saldo"-errors i 1 minutt før operatør pauset
 * rommet manuelt. Hver ny ball trigget samme feil; spillerne så bare at
 * runden fortsatte uten utbetaling.
 *
 * **Denne porten:** håndterer bokføringen for circuit-breakeren — selve
 * pause-handlingen + Sentry-emit gjøres av `BingoEngine.handleHookError`.
 *
 * **API i grove trekk:**
 *   - `track(roomCode, hook, err)` — registrer ny feil; returnerer
 *     `{ count, sameCause }` slik at caller kan bestemme handling.
 *   - `reset(roomCode)` — kalles når rommet pauses, resumer eller
 *     destroys, eller når en hook lykkes etter tidligere feil.
 *   - `getState(roomCode, hook)` — debugging/inspect.
 *
 * **Same-cause-detektor:** to feil regnes som samme cause hvis både
 * `error.message` og `error.code` (DomainError/WalletError-felt) er like.
 * Forskjellige feil resetter counteren — hensikten er å fange "samme feil
 * gjentar seg", ikke "noen feiler tilfeldig".
 *
 * **Tids-vindu:** counter resetter også hvis siste feil var > 60 sekunder
 * siden — hindrer at gamle, urelaterte feil trekker terskelen ned.
 */

export interface RoomErrorCounterOptions {
  /**
   * Hvor lenge en feil-kjede teller før counter automatisk resettes
   * uten en suksess-resume. Default 60 000 ms (1 min).
   */
  windowMs?: number;
}

export interface RoomErrorState {
  /** Antall fortløpende feil med samme cause innenfor `windowMs`. */
  count: number;
  /** Tidspunkt for første feil i serien (Unix-ms). */
  firstAt: number;
  /** Tidspunkt for siste feil i serien (Unix-ms). */
  lastAt: number;
  /** Cause-fingeravtrykk: `${code}::${message}`. Stabilt for samme feil. */
  cause: string;
}

export interface TrackResult {
  /** Sum etter at denne feilen er registrert. */
  count: number;
  /** True hvis denne feilen hadde samme cause som forrige. */
  sameCause: boolean;
  /** Stabilt fingerprint vi sammenligner på (for debugging/log). */
  cause: string;
}

const DEFAULT_WINDOW_MS = 60_000;

/**
 * Stabilt cause-fingerprint for en feil. Plukker `code` (DomainError /
 * WalletError) hvis tilgjengelig, ellers `name`, og kombinerer med
 * `message`. Holdes tøy fordi vi sammenligner per (room, hook) — kort
 * fingerprint er nok til å skille distinct årsaker.
 */
export function fingerprintError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code;
    const codePart =
      typeof code === "string" && code.length > 0 ? code : err.name || "Error";
    const msgPart = (err.message || "").slice(0, 200);
    return `${codePart}::${msgPart}`;
  }
  if (typeof err === "string") return `string::${err.slice(0, 200)}`;
  return "unknown::";
}

/**
 * Per-room/per-hook circuit-breaker counter.
 *
 * Ikke trygd for tverr-prosess-bruk (in-memory) — for multi-instance
 * deploy må counter-state flyttes til Redis. For pilot (single instance)
 * holder denne. Caller eier wiring + handling.
 */
export class RoomErrorCounter {
  private readonly state = new Map<string, RoomErrorState>();
  private readonly windowMs: number;

  constructor(options: RoomErrorCounterOptions = {}) {
    this.windowMs = Math.max(1, Math.floor(options.windowMs ?? DEFAULT_WINDOW_MS));
  }

  /**
   * Register a new error. Returns the running count (after this error)
   * and whether this matched the previous fingerprint.
   *
   * - Different cause → counter resets to 1.
   * - Last error > windowMs ago → counter resets to 1.
   * - Same cause within windowMs → counter increments.
   */
  track(
    roomCode: string,
    hook: string,
    err: unknown,
    nowMs: number = Date.now(),
  ): TrackResult {
    const key = makeKey(roomCode, hook);
    const cause = fingerprintError(err);
    const existing = this.state.get(key);
    const withinWindow =
      existing !== undefined && nowMs - existing.lastAt <= this.windowMs;
    const sameCause = withinWindow && existing.cause === cause;

    if (sameCause) {
      const updated: RoomErrorState = {
        count: existing.count + 1,
        firstAt: existing.firstAt,
        lastAt: nowMs,
        cause,
      };
      this.state.set(key, updated);
      return { count: updated.count, sameCause: true, cause };
    }

    const fresh: RoomErrorState = {
      count: 1,
      firstAt: nowMs,
      lastAt: nowMs,
      cause,
    };
    this.state.set(key, fresh);
    return { count: 1, sameCause: false, cause };
  }

  /**
   * Reset all counters for a room. Call on:
   *  - Manual resume (operator handled the cause)
   *  - Successful evaluation (auto-recovery, hook ran clean)
   *  - Room destroy
   */
  reset(roomCode: string): void {
    for (const key of this.state.keys()) {
      if (key.startsWith(`${roomCode}::`)) {
        this.state.delete(key);
      }
    }
  }

  /**
   * Reset a specific (room, hook) counter. Use when only one hook
   * recovered (e.g. evaluateActivePhase succeeded but onDrawCompleted
   * is still failing).
   */
  resetHook(roomCode: string, hook: string): void {
    this.state.delete(makeKey(roomCode, hook));
  }

  /** Read current state — useful for tests + debug logging. */
  getState(roomCode: string, hook: string): RoomErrorState | undefined {
    const s = this.state.get(makeKey(roomCode, hook));
    if (!s) return undefined;
    return { ...s };
  }

  /**
   * Bulk-introspect — used by tests. Returns a snapshot copy.
   */
  snapshot(): Map<string, RoomErrorState> {
    return new Map(
      [...this.state.entries()].map(([k, v]) => [k, { ...v }]),
    );
  }
}

function makeKey(roomCode: string, hook: string): string {
  return `${roomCode}::${hook}`;
}
