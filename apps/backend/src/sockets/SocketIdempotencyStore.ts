/**
 * BIN-813 R5: Socket-event-deduplisering basert på `clientRequestId`.
 *
 * **Bakgrunn:** klient som mister nett og sender samme socket-event flere
 * ganger ved reconnect-replay må IKKE forårsake duplikate effekter:
 *   - dupliserte marks
 *   - doble payouts
 *   - wallet-double-spend
 *
 * Wallet-laget har allerede idempotency-key (BIN-761→764), men socket-laget
 * mangler en generisk dedupe-mekanisme. Denne porten lukker det gapet ved å
 * cache (userId, eventName, clientRequestId) → respons med 5-min TTL. Andre
 * kall med samme key returnerer cached respons uten å trigge sideeffekter.
 *
 * **Kontrakt:**
 *   - `claim(key)` reserverer et "in-flight slot" atomisk. Returnerer `null`
 *     hvis nøkkelen er ny (dvs. handleren skal kjøre), eller et tidligere
 *     lagret resultat hvis nøkkelen er sett før.
 *   - `store(key, result)` lagrer endelig resultat etter at handler kjørte.
 *     TTL settes på lagring (default 5 min — speiler wallet-laget).
 *   - `release(key)` brukes for å frigi reservasjonen ved feil. Lar neste
 *     forsøk gjennom for klient-retry; cached respons settes kun ved
 *     suksessfull `store()`.
 *
 * **Implementasjoner:**
 *   - `RedisSocketIdempotencyStore`: prod-bruk. Bruker `SET NX EX` for
 *     atomic reservasjon, `GET` for cache-lookup. Multi-instance-safe.
 *   - `InMemorySocketIdempotencyStore`: test/dev. Map-basert, expirerer
 *     entries lazily via timestamp-sjekk.
 *
 * **Latency:** redis-pathen er én round-trip per `claim()`/`store()`. Mot
 * managed Redis i Frankfurt (samme region som Render-backend) ligger dette
 * på <2 ms. Utenfor budsjett <5 ms per operasjon.
 *
 * **Fail-soft:** hvis Redis er nede mens `claim()` kjøres, kastes feilen
 * opp til middleware som logger og fortsetter UTEN dedupe (heller en
 * potensiell duplikat enn å blokkere alle requests). Dedupe er en defense-
 * in-depth-lag — wallet-idempotency er fortsatt siste linje for wallet.
 */
import type { Redis } from "ioredis";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "socket-idempotency" });

/** Standard TTL for lagrede idempotency-resultater (5 min). */
export const SOCKET_IDEMPOTENCY_TTL_SECONDS = 300;

/**
 * Hva som blir lagret i cachen — den ferdige ack-responsen klienten
 * fikk forrige gang. Vi serialiserer som JSON så Redis kan lagre det
 * som streng. `result` er typisk `{ ok: true, data: {...} }` eller
 * `{ ok: false, error: { code, message } }`.
 */
export interface SocketIdempotencyResult {
  result: unknown;
}

/**
 * Smal port for socket-dedupe. Begge implementasjoner returnerer cached
 * resultat på `claim()` hvis keyen finnes, eller `null` hvis det er
 * første gang og handleren skal kjøre.
 */
export interface SocketIdempotencyStore {
  /**
   * Reserver nøkkelen atomisk eller returner tidligere resultat.
   *
   * - `null` → keyen er ny, handler skal kjøre. Caller MÅ enten kalle
   *   `store(key, result)` ved suksess, eller `release(key)` ved feil.
   * - `SocketIdempotencyResult` → keyen er sett før, returner cached
   *   respons til klienten uten å kjøre handleren.
   *
   * Implementasjoner skal være atomiske mot samtidige `claim()`-kall
   * for samme key (Redis `SET NX EX`). I in-memory bruker vi en `Map`
   * og setter "in-flight"-marker først.
   */
  claim(key: string): Promise<SocketIdempotencyResult | null>;

  /**
   * Lagre endelig resultat etter at handler kjørte. TTL er
   * `SOCKET_IDEMPOTENCY_TTL_SECONDS` med mindre annet er spesifisert.
   *
   * Idempotent — gjentatte `store()`-kall med samme key er trygt
   * (siste vinner, men i praksis er resultatet det samme siden
   * keyen unik per sideeffekt).
   */
  store(key: string, result: SocketIdempotencyResult, ttlSeconds?: number): Promise<void>;

  /**
   * Frigi reservasjonen så klient-retry kan slippe gjennom. Brukes
   * når handler kaster en transient feil (nettverk, timeout) der
   * vi vil tillate retry uten å returnere den feilede responsen.
   *
   * Idempotent.
   */
  release(key: string): Promise<void>;
}

// ── Redis-backed implementation ────────────────────────────────────────

/**
 * Marker-streng vi skriver ved `claim()` for å reservere keyen før
 * `store()` blir kalt. Hvis en annen request prøver `claim()` mens
 * handler-en kjører, treffer den dette markeret og må vente eller
 * returnere "in-flight"-feil. I praksis er handler-tiden < 1 sek, og
 * klient-retry skjer gjerne sekunder senere — vi unngår det ved å
 * kun returnere lagret result, ikke marker.
 */
const IN_FLIGHT_MARKER = '"__in_flight__"';

export interface RedisSocketIdempotencyStoreOptions {
  /** ioredis-instans. Forventes connected før første kall. */
  redis: Redis;
  /** Key-prefix i Redis. Default `"socket-idem:"`. */
  keyPrefix?: string;
  /**
   * TTL ved `claim()` for in-flight-markeret. Skal være lengre enn
   * forventet handler-tid men kort nok til at en krasjet handler
   * frigir keyen automatisk. Default 30 sek.
   */
  inFlightTtlSeconds?: number;
}

export class RedisSocketIdempotencyStore implements SocketIdempotencyStore {
  private readonly redis: Redis;
  private readonly keyPrefix: string;
  private readonly inFlightTtl: number;

  constructor(opts: RedisSocketIdempotencyStoreOptions) {
    this.redis = opts.redis;
    this.keyPrefix = opts.keyPrefix ?? "socket-idem:";
    this.inFlightTtl = opts.inFlightTtlSeconds ?? 30;
  }

  private redisKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async claim(key: string): Promise<SocketIdempotencyResult | null> {
    const rkey = this.redisKey(key);
    // SET NX EX: atomisk reservasjon. Hvis keyen finnes, return null fra Redis
    // og vi henter cachet verdi. Hvis ikke finnes, vi har reservert.
    const ok = await this.redis.set(rkey, IN_FLIGHT_MARKER, "EX", this.inFlightTtl, "NX");
    if (ok === "OK") {
      // Vi reserverte — handler skal kjøre.
      return null;
    }
    // Keyen fantes — hent verdien.
    const existing = await this.redis.get(rkey);
    if (!existing) {
      // Keyen utløp mellom SET NX og GET — sjelden, men mulig. Behandle som ny
      // og slipp request gjennom (heller dobbel-effekt enn å hang req-en).
      log.warn({ key }, "claim race: key existed in NX-check but was gone on GET — letting request through");
      return null;
    }
    if (existing === IN_FLIGHT_MARKER) {
      // En annen request er midt i handleren. Returner dedupe-feil — klienten
      // skal IKKE få sideeffekter mens den første requesten fortsatt kjører.
      // Vi pakker dette som et "ok: false" idempotency-result så caller får
      // riktig oppførsel uten å throwe.
      return {
        result: {
          ok: false,
          error: {
            code: "IDEMPOTENCY_IN_FLIGHT",
            message: "Tidligere identisk forespørsel er fortsatt under behandling.",
          },
        },
      };
    }
    try {
      const parsed = JSON.parse(existing) as SocketIdempotencyResult;
      return parsed;
    } catch (err) {
      log.warn({ key, err }, "claim: failed to parse cached result — letting request through");
      return null;
    }
  }

  async store(
    key: string,
    result: SocketIdempotencyResult,
    ttlSeconds: number = SOCKET_IDEMPOTENCY_TTL_SECONDS,
  ): Promise<void> {
    const rkey = this.redisKey(key);
    // Overskriv in-flight-marker med ferdig resultat + utvidet TTL.
    await this.redis.set(rkey, JSON.stringify(result), "EX", ttlSeconds);
  }

  async release(key: string): Promise<void> {
    const rkey = this.redisKey(key);
    // Bare slett hvis det fortsatt er in-flight-marker; aldri slett ferdig
    // resultat (ville ødelagt dedupe for retry etter at vi suksessfullt
    // svarte). Bruker Lua for atomic check-and-delete.
    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await this.redis.eval(luaScript, 1, rkey, IN_FLIGHT_MARKER);
  }
}

// ── In-memory implementation ───────────────────────────────────────────

interface InMemoryEntry {
  /** "in-flight" markør eller endelig resultat. */
  result: SocketIdempotencyResult | "in-flight";
  /** Unix-ms når entry expirerer. */
  expiresAtMs: number;
}

/**
 * In-memory dedupe — eksisterer for tester og dev-instans uten Redis.
 * Lazy expiry: vi sjekker `expiresAtMs` ved hver lookup. For prod-skala
 * med tusenvis av aktive entries hadde dette grodd minne, men i praksis
 * brukes denne kun i tests og lite-trafic dev.
 */
export class InMemorySocketIdempotencyStore implements SocketIdempotencyStore {
  private readonly entries = new Map<string, InMemoryEntry>();
  private readonly inFlightTtlMs: number;

  constructor(opts: { inFlightTtlSeconds?: number } = {}) {
    this.inFlightTtlMs = (opts.inFlightTtlSeconds ?? 30) * 1000;
  }

  private now(): number {
    return Date.now();
  }

  private gc(key: string): InMemoryEntry | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAtMs <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return e;
  }

  async claim(key: string): Promise<SocketIdempotencyResult | null> {
    const e = this.gc(key);
    if (!e) {
      this.entries.set(key, {
        result: "in-flight",
        expiresAtMs: this.now() + this.inFlightTtlMs,
      });
      return null;
    }
    if (e.result === "in-flight") {
      return {
        result: {
          ok: false,
          error: {
            code: "IDEMPOTENCY_IN_FLIGHT",
            message: "Tidligere identisk forespørsel er fortsatt under behandling.",
          },
        },
      };
    }
    return e.result;
  }

  async store(
    key: string,
    result: SocketIdempotencyResult,
    ttlSeconds: number = SOCKET_IDEMPOTENCY_TTL_SECONDS,
  ): Promise<void> {
    this.entries.set(key, {
      result,
      expiresAtMs: this.now() + ttlSeconds * 1000,
    });
  }

  async release(key: string): Promise<void> {
    const e = this.entries.get(key);
    if (e && e.result === "in-flight") {
      this.entries.delete(key);
    }
  }

  /** Test-helper: hent en entry uten gc. */
  _peek(key: string): InMemoryEntry | undefined {
    return this.entries.get(key);
  }

  /** Test-helper: tving expiry. */
  _expire(key: string): void {
    const e = this.entries.get(key);
    if (e) {
      this.entries.delete(key);
    }
  }

  /** Test-helper: clear alt. */
  _clear(): void {
    this.entries.clear();
  }
}
