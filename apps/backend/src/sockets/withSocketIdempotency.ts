/**
 * BIN-813 R5: Socket-handler-wrapper for `clientRequestId`-deduplisering.
 *
 * Wrapper rundt eksisterende socket-handlere som intercepter `clientRequestId`
 * fra payload, slår opp i `SocketIdempotencyStore`, og enten:
 *
 *   1. Returnerer cached respons (samme ack klienten fikk forrige gang)
 *      uten å kjøre handleren — forhindrer dupliserte sideeffekter.
 *   2. Lar handleren kjøre, lagrer ack-respons i cachen, og returnerer
 *      respons til klienten.
 *
 * Wrapper-en plasseres MELLOM `rateLimited(...)` og selve handleren slik
 * at rate-limiting fortsatt slår inn først (ikke-rate-limited dedupe ville
 * latt en bot DDOS-e cachen). Siden handleren er async returneres en
 * Promise; wrapperen await-er den og pakker resultatet både til cache og
 * ack.
 *
 * **Når clientRequestId mangler:** wrapper-en hopper over dedupe og kaller
 * handleren direkte. Eldre klienter som ikke sender `clientRequestId` får
 * legacy-oppførsel (ingen dedupe). Nye klienter SKAL sende UUID v4.
 *
 * **Når clientRequestId er ugyldig:** wrapperen avviser kallet med
 * `INVALID_INPUT` før handleren kjører. UUID-format valideres lett her
 * (lengde + char-set) så vi ikke aksepterer søppel som key.
 *
 * **Cache-key:** `(userId, eventName, clientRequestId)`. `userId` er
 * walletId fra socket.data.user — sikrer at to ulike spillere som
 * tilfeldigvis genererer samme UUID ikke deler cache-entry.
 *
 * **Tester:** se `withSocketIdempotency.test.ts`.
 */
import type { Socket } from "socket.io";
import type { SocketIdempotencyStore } from "./SocketIdempotencyStore.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "socket-idempotency" });

/**
 * Standard ack-respons-shape for socket-events. Matcher
 * `gameEvents/types.ts` `AckResponse<T>` 1:1: `{ ok: boolean; data?: T;
 * error?: { code, message } }`. Vi reimporterer ikke fra cluster-pakken
 * for å unngå circular dependencies (cluster-filer importerer denne
 * wrapperen, som hadde gjort en runde-tur via types.ts ellers).
 */
export interface AckResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/** UUID v4-mønster (lett validering). Må matche klient-side `crypto.randomUUID()`. */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Hent og valider `clientRequestId` fra payload. Returnerer null hvis
 * fraværende (legacy-klient) eller en validert string. Kaster ingen feil
 * — caller bestemmer politikk (skip vs reject).
 */
export function extractClientRequestId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = (payload as Record<string, unknown>).clientRequestId;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed;
}

/**
 * Sjekker at clientRequestId er en UUID. Wrapperen bruker dette til å
 * avvise søppel-keys så vi ikke fyller cachen med `"foo"` eller `"1"`.
 */
export function isValidClientRequestId(id: string): boolean {
  return UUID_V4_REGEX.test(id);
}

/**
 * Bygg cache-key. `userId` er walletId fra autentisert socket; `eventName`
 * er socket-event-navnet (f.eks. `"claim:submit"`); `clientRequestId` er
 * UUID fra payload.
 *
 * Format: `{userId}:{eventName}:{clientRequestId}`. Eksempel:
 *   `wallet-abc:claim:submit:550e8400-e29b-41d4-a716-446655440000`
 */
export function buildIdempotencyKey(
  userId: string,
  eventName: string,
  clientRequestId: string,
): string {
  return `${userId}:${eventName}:${clientRequestId}`;
}

export interface WithIdempotencyOptions {
  /** Idempotency-store (Redis i prod, in-memory i tester/dev). */
  store: SocketIdempotencyStore;
  /** Socket-event-navn (brukes i cache-key). */
  eventName: string;
  /** Socket-instans (for å hente userId fra socket.data.user). */
  socket: Socket;
  /**
   * Hvis true, krever wrapperen at clientRequestId er satt (avviser
   * payload uten det med INVALID_INPUT). Default false (skip dedupe
   * når mangler) — gir backward-compat med eldre klienter.
   *
   * Settes til `true` når alle klienter er oppdatert.
   */
  requireClientRequestId?: boolean;
}

/**
 * Wrapper som intercepter `clientRequestId`-dedupe rundt en eksisterende
 * handler. Bruksmønster i en cluster-fil:
 *
 * ```ts
 * socket.on("claim:submit", rateLimited("claim:submit", withSocketIdempotency(
 *   { store, eventName: "claim:submit", socket },
 *   async (payload, callback) => {
 *     // ... eksisterende handler-kropp
 *   },
 * )));
 * ```
 *
 * Wrapper-en gjør 3 ting:
 *
 *   1. Henter `clientRequestId` fra payload. Hvis mangler → kall handler
 *      direkte (legacy-mode).
 *   2. Hvis present, validerer UUID-format. Ugyldig → ack INVALID_INPUT.
 *   3. Forsøker `store.claim(key)`. Hvis cached → returner cached til
 *      klient og hopp over handler. Hvis fersk → kjør handler, fang ack
 *      via wrapped callback, lagre i cache.
 *
 * Feil-håndtering:
 *   - `store.claim()` kaster (Redis nede): logger warning og kjører
 *     handler uten dedupe. Wallet-laget er fortsatt idempotent som
 *     defense-in-depth.
 *   - Handler kaster: vi kaller `store.release(key)` så klient-retry
 *     ikke får cached failed-respons — handleren kan ha feilet for
 *     transient årsak.
 *   - `store.store()` kaster etter handler ferdig: logger warning men
 *     returnerer ack-en uansett (klient skal ikke se feil bare fordi
 *     dedupe-cachen feilet).
 */
export function withSocketIdempotency<P, R>(
  opts: WithIdempotencyOptions,
  handler: (payload: P, callback: (response: AckResponse<R>) => void) => Promise<void>,
): (payload: P, callback: (response: AckResponse<R>) => void) => Promise<void> {
  const { store, eventName, socket, requireClientRequestId = false } = opts;

  return async function wrapped(payload, callback) {
    const clientRequestId = extractClientRequestId(payload);

    // Legacy-klient uten clientRequestId.
    if (!clientRequestId) {
      if (requireClientRequestId) {
        callback({
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: "clientRequestId er påkrevd for denne handlingen.",
          },
        });
        return;
      }
      // Skip dedupe.
      return handler(payload, callback);
    }

    // Validér UUID-format.
    if (!isValidClientRequestId(clientRequestId)) {
      callback({
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "clientRequestId må være en UUID v4.",
        },
      });
      return;
    }

    // Trenger autentisert userId (walletId fra socket.data.user) for å
    // skope cache-en. Hvis ikke autentisert → skip dedupe (handler-en
    // vil sannsynligvis avvise med UNAUTHORIZED uansett).
    const userId = (socket.data?.user?.walletId as string | undefined)?.trim();
    if (!userId) {
      // Ingen autentisert bruker — kjør handler uten dedupe.
      // Handler-laget håndterer auth-feil selv.
      return handler(payload, callback);
    }

    const key = buildIdempotencyKey(userId, eventName, clientRequestId);

    // Forsøk å reservere keyen.
    let cached;
    try {
      cached = await store.claim(key);
    } catch (err) {
      // Redis-feil — fail-soft, kjør handler uten dedupe.
      log.warn(
        { event: eventName, key, err },
        "store.claim() failed — proceeding without dedupe",
      );
      return handler(payload, callback);
    }

    // Cache-hit — returner cached respons direkte uten å kjøre handler.
    if (cached !== null) {
      log.debug(
        { event: eventName, key },
        "cache hit — returning cached response without running handler",
      );
      callback(cached.result as AckResponse<R>);
      return;
    }

    // Cache-miss — kjør handler. Vi må fange opp ack-respons så vi kan
    // lagre den i cachen. Wrap callback-en så vi får tak i resultatet.
    let captured: AckResponse<R> | null = null;
    const wrappedCallback = (response: AckResponse<R>) => {
      captured = response;
      callback(response);
    };

    let handlerError: unknown = null;
    try {
      await handler(payload, wrappedCallback);
    } catch (err) {
      handlerError = err;
    }

    if (handlerError) {
      // Handler kastet — frigi reservasjonen så retry kan slippe gjennom.
      try {
        await store.release(key);
      } catch (releaseErr) {
        log.warn(
          { event: eventName, key, err: releaseErr },
          "store.release() failed after handler threw",
        );
      }
      // Re-throw så caller (rateLimited-wrapper) kan logge.
      throw handlerError;
    }

    if (captured === null) {
      // Handler ferdig uten å kalle callback — sjelden, men mulig hvis
      // handler-en glemmer å ack-e. Frigi keyen.
      log.warn(
        { event: eventName, key },
        "handler did not invoke callback — releasing idempotency key",
      );
      try {
        await store.release(key);
      } catch (releaseErr) {
        log.warn({ event: eventName, key, err: releaseErr }, "store.release() failed");
      }
      return;
    }

    // Lagre den endelige ack-en i cachen for fremtidige retries.
    try {
      await store.store(key, { result: captured });
    } catch (err) {
      // Cache-write feilet — klient fikk uansett ack, så vi logger og
      // fortsetter. Neste retry vil hit'e wallet-idempotency-laget.
      log.warn(
        { event: eventName, key, err },
        "store.store() failed — response sent to client but not cached",
      );
    }
  };
}
