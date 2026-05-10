/**
 * ADR-0019 / P0-1 (2026-05-10): Monotonic per-room state-version counter.
 *
 * **Bakgrunn:** `room:update`-payloads kan ankomme klienten ut-av-rekkefølge
 * pga reconnect-replay (klient mister socket, server-bufferen sender N
 * snapshot-emits når socket kobles tilbake — den siste kommer ikke
 * nødvendigvis først), eller multi-instance-broadcast der to backend-nodes
 * begge emitter til samme Socket.IO-rom over Redis-adapteren.
 *
 * `serverTimestamp` (ms-presisjon) er ikke tilstrekkelig — to emits
 * generert i samme tick får samme tid, og klient-clock-skew gjør at en
 * eldre payload kan se "nyere" ut hvis to noder har drift.
 *
 * Løsning: server-genererer en monotonic counter per rom som inkrementeres
 * pre-emit. Klient lagrer `lastAppliedStateVersion` og skipper payloads med
 * `stateVersion < lastAppliedStateVersion`. Equal er idempotent (apply
 * normalt) for å håndtere reconnect-replay av eksakt samme snapshot.
 *
 * **Implementasjoner:**
 *   - `RedisRoomStateVersionStore` (prod): bruker Redis `INCR` for atomic
 *     monotonic counter som overlever instance-restart og er konsistent
 *     på tvers av backend-nodes som broadcaster til samme rom.
 *   - `InMemoryRoomStateVersionStore` (dev/test): Map-basert. Reset ved
 *     instance-restart — OK for dev der vi ikke har horizontal scaling.
 *
 * **Cold-start:** Første `next(code)`-kall returnerer 1 (Redis INCR
 * starter på 1 hvis keyen ikke finnes). Counter starter på 0 for
 * `current()` hvis ingen emit har skjedd ennå. Klient som joiner inn
 * midt i et levetid trenger uansett resync via `room:state` for å få
 * korrekt baseline.
 *
 * **Rom-livssyklus:** Vi sletter ALDRI counter-en (TTL aldri satt).
 * Et restart-av-rom (samme code) skal arve den eksisterende counter-en
 * slik at klienter som fortsatt har en cached `lastAppliedStateVersion`
 * fra forrige inkarnasjon ikke får problemer. Counter resetter aldri
 * — det ville bryte invarianten.
 *
 * **Latency:** Redis-pathen er én round-trip per `next()`/`current()`.
 * Mot managed Redis i Frankfurt (samme region som Render-backend) ligger
 * dette på <2 ms. emitRoomUpdate er allerede async så latency-budsjettet
 * holder.
 *
 * **Fail-soft:** hvis Redis er nede, kastes feilen opp slik at emit-en
 * feiler. Caller bør ikke fortsette uten stateVersion siden uten dedup
 * kan klient ende opp i inkonsistent state. I praksis er Redis-tilgang
 * en hard avhengighet for andre deler av systemet (socket.io adapter,
 * room-state-store), så stale Redis er allerede en SEV-1.
 */
import type { Redis } from "ioredis";
import { logger as rootLogger } from "./logger.js";

const log = rootLogger.child({ module: "room-state-version" });

/**
 * Smal port for stateVersion-counter. Begge implementasjoner returnerer
 * monotonic counter-verdier som er garantert ikke-synkende per rom-code.
 */
export interface RoomStateVersionStore {
  /**
   * Increment og returner ny stateVersion for et rom. Skal kalles én
   * gang per `room:update` emit. Første kall for et nytt rom returnerer 1.
   *
   * Atomic mot samtidige kall (Redis INCR / Map-mutex).
   */
  next(roomCode: string): Promise<number>;

  /**
   * Returner gjeldende (sist incrementede) stateVersion uten å
   * incremente. Brukes av `room:state` resync-ack-en så klienten får
   * versjonen som matcher den siste emitted state-en (ikke en framtidig
   * uutsendt versjon).
   *
   * Returnerer 0 hvis rommet aldri har emittet (cold-start).
   */
  current(roomCode: string): Promise<number>;
}

// ── Redis-backed implementation ────────────────────────────────────────

export interface RedisRoomStateVersionStoreOptions {
  /** ioredis-instans. Forventes connected før første kall. */
  redis: Redis;
  /** Key-prefix i Redis. Default `"room-state-version:"`. */
  keyPrefix?: string;
}

export class RedisRoomStateVersionStore implements RoomStateVersionStore {
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor(opts: RedisRoomStateVersionStoreOptions) {
    this.redis = opts.redis;
    this.keyPrefix = opts.keyPrefix ?? "room-state-version:";
  }

  private redisKey(roomCode: string): string {
    return `${this.keyPrefix}${roomCode}`;
  }

  async next(roomCode: string): Promise<number> {
    // INCR oppretter keyen som "0" og inkrementerer til "1" hvis den ikke
    // finnes — perfekt for cold-start. Returnerer den nye verdien som
    // integer (ioredis returnerer number for INCR-resultat).
    const result = await this.redis.incr(this.redisKey(roomCode));
    if (typeof result !== "number" || !Number.isInteger(result) || result < 1) {
      // Skal aldri skje — INCR garanterer integer >= 1 etter første kall.
      // Defense-in-depth: logg og kast så caller ikke får ugyldig version.
      log.error({ roomCode, result }, "INCR returned non-integer or value < 1");
      throw new Error(`Redis INCR returned invalid value for ${roomCode}: ${result}`);
    }
    return result;
  }

  async current(roomCode: string): Promise<number> {
    const raw = await this.redis.get(this.redisKey(roomCode));
    if (raw === null) return 0;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      log.warn({ roomCode, raw }, "stored stateVersion is not a non-negative integer — returning 0");
      return 0;
    }
    return parsed;
  }
}

// ── In-memory implementation ───────────────────────────────────────────

/**
 * In-memory counter — eksisterer for tester og dev-instans uten Redis.
 * Reset ved instance-restart (counter starter på 0 igjen) — i prod
 * løses dette av Redis-implementasjonen.
 */
export class InMemoryRoomStateVersionStore implements RoomStateVersionStore {
  private readonly counters = new Map<string, number>();

  async next(roomCode: string): Promise<number> {
    const prev = this.counters.get(roomCode) ?? 0;
    const next = prev + 1;
    this.counters.set(roomCode, next);
    return next;
  }

  async current(roomCode: string): Promise<number> {
    return this.counters.get(roomCode) ?? 0;
  }

  /** Test-helper: tving counter til en spesifikk verdi. */
  _set(roomCode: string, value: number): void {
    this.counters.set(roomCode, value);
  }

  /** Test-helper: clear alt. */
  _clear(): void {
    this.counters.clear();
  }
}
