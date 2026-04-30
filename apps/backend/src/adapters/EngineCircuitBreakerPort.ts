/**
 * Bølge K5 (REFACTOR_AUDIT_PRE_PILOT_2026-04-29 §2.4 / CRIT-4):
 * Fire-and-forget port for å varsle ops/admin-clients når engine
 * circuit-breaker har enten:
 *   - registrert en degradert hook (counter steg over terskel, eller
 *     wallet-shortage trigget umiddelbar halt), ELLER
 *   - automatisk pauset rommet for å hindre videre identiske feil.
 *
 * **Hvorfor port (ikke direkte Sentry-kall):**
 *   - Sentry-emit håndteres allerede i `observability/sentry.ts` med
 *     egen tag-strategi.
 *   - Admin-broadcast må gå via `/admin-game1`-namespace eller
 *     `hall:<hallId>:display`-rommet — det er IO-detaljer som engine
 *     ikke skal kjenne til.
 *   - Test-doubles trenger en stabil, narrow surface å implementere.
 *
 * **Fire-and-forget-kontrakt:** implementasjon MÅ aldri kaste. Hvis den
 * feiler internt skal den logge og returnere — engine-flyten må aldri
 * blokkeres på circuit-breaker-bokføringen.
 */

import type { WalletError } from "./WalletAdapter.js";

export type EngineHookName =
  | "onDrawCompleted"
  | "evaluateActivePhase"
  | "evaluateActivePhase.preDrawMaxDraws"
  | "evaluateActivePhase.drawBagEmpty"
  | "evaluateActivePhase.lastChanceMaxDraws"
  | "evaluateActivePhase.endGame";

/**
 * Hvorfor circuit-breakeren reagerte. Brukes av admin-UI for å vise
 * riktig melding ("operatør pauset" vs "automatisk pauset på grunn av
 * gjentatt feil" vs "wallet-konto mangler saldo — kontakt regnskap").
 */
export type EngineDegradationReason =
  /** N+1 same-cause errors innen vindu — repeated-failure terskel passert. */
  | "REPEATED_HOOK_FAILURE"
  /** Wallet-shortage error fanget — halt umiddelbart, uavhengig av counter. */
  | "WALLET_SHORTAGE";

export interface EngineDegradedEvent {
  /** Rom som degraderte. */
  roomCode: string;
  /** Hvilken hook fyrte gjentatt feil. */
  hook: EngineHookName;
  /** Hvorfor circuit-breakeren reagerte. */
  reason: EngineDegradationReason;
  /** Antall fortløpende same-cause errors (1 ved WALLET_SHORTAGE-halt). */
  errorCount: number;
  /** Stabilt cause-fingerprint (`code::message[..200]`) for korrelering. */
  cause: string;
  /** Underliggende feilmelding for ops-diagnose. */
  errorMessage: string;
  /** Underliggende feil-kode (DomainError/WalletError) hvis tilgjengelig. */
  errorCode?: string;
  /** Game-id rommet kjørte da feilen skjedde — tomt hvis cleanup. */
  gameId?: string;
  /** Hall som rommet hører til (for admin-broadcast-fan-out). */
  hallId?: string;
  /** ISO-timestamp da circuit-breakeren reagerte. */
  at: string;
  /** True hvis circuit-breakeren også pauset rommet (halt-the-room). */
  pauseInitiated: boolean;
}

/**
 * Adapter-port. Produksjon wirer en implementasjon som:
 *   1. Emitter Sentry-tag (`engine.circuit-breaker`) med roomCode + hook
 *      slik at Sentry-alert-rule "engine.evaluator.repeated-error" kan
 *      filtrere på det.
 *   2. Broadcaster `room.engine.degraded` til `/admin-game1`-namespace
 *      (game-rom + hall-display-rom) så admin-UI kan vise badge.
 */
export interface EngineCircuitBreakerPort {
  /**
   * Kalles fire-and-forget. MÅ aldri kaste — implementasjonen er ansvarlig
   * for å fange egne feil internt.
   */
  onEngineDegraded(event: EngineDegradedEvent): void;
}

/** Default no-op — brukes i tester og i engine-konstruktør hvis ikke wired. */
export class NoopEngineCircuitBreakerPort implements EngineCircuitBreakerPort {
  onEngineDegraded(_event: EngineDegradedEvent): void {
    /* no-op */
  }
}

/**
 * Wallet-shortage-detektor. WalletError-koden alene er nok — adapteren
 * kaster den med konsistent kode på tvers av implementasjoner
 * (Postgres / InMemory / File / Http).
 *
 * Vi behandler både "kontoen finnes ikke" og "kontoen mangler saldo" som
 * shortage — begge betyr at house-ledger er mis-konfigurert eller tom og
 * at videre draws bare kommer til å gjenta samme feil.
 *
 * `WalletError.code` er en ren streng-felt; vi sjekker den direkte for å
 * unngå runtime-instanceof-issues hvis WalletError er importert fra to
 * forskjellige steder (ESM duplicate-class-bug).
 */
export function isWalletShortageError(err: unknown): err is WalletError {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { code?: unknown }).code;
  if (typeof code !== "string") return false;
  return code === "INSUFFICIENT_FUNDS" || code === "ACCOUNT_NOT_FOUND";
}
