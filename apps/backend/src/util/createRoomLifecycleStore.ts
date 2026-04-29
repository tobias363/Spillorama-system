/**
 * createRoomLifecycleStore — factory that selects the impl by env-flag.
 *
 * `ROOM_STATE_PROVIDER=memory` (default for dev) returns an
 * {@link InMemoryRoomLifecycleStore} backed by process-local Maps.
 *
 * `ROOM_STATE_PROVIDER=redis` returns a {@link RedisRoomLifecycleStore}
 * backed by the Redis at `REDIS_URL` (default `redis://localhost:6379`).
 * The connection is established eagerly so a misconfigured Redis fails the
 * boot rather than running with broken room-state. This is the K4 fail-
 * closed surface — see docs/audit/REFACTOR_AUDIT_PRE_PILOT_2026-04-29.md
 * §2.3 for why partial-failure tolerance was rejected.
 *
 * The factory is the only place that should `import` the concrete impls
 * directly. Everything else takes `RoomLifecycleStore` (the interface) as
 * an injected dependency, so tests can swap in either impl.
 *
 * History: K2 (#732) shipped a thin factory inside `RoomLifecycleStore.ts`
 * that always returned the in-memory impl. K4 extracts the factory to its
 * own file so the env-flag branching has a clean home and the in-memory
 * file stays free of Redis imports.
 *
 * Reference: docs/audit/REFACTOR_AUDIT_PRE_PILOT_2026-04-29.md §2.3 + §6 K4.
 */
import { logger as rootLogger } from "./logger.js";
import {
  InMemoryRoomLifecycleStore,
  type RoomLifecycleMaps,
  type RoomLifecycleStore,
} from "./RoomLifecycleStore.js";
import { RedisRoomLifecycleStore } from "./RedisRoomLifecycleStore.js";
import type { Redis } from "ioredis";

const factoryLog = rootLogger.child({ module: "roomLifecycleStoreFactory" });

export type RoomLifecycleStoreProvider = "memory" | "redis";

export interface CreateRoomLifecycleStoreOptions {
  /**
   * Selected impl. Defaults to whatever `process.env.ROOM_STATE_PROVIDER`
   * specifies (case-insensitive). Pass explicitly in tests where you want
   * to bypass env.
   */
  provider?: RoomLifecycleStoreProvider;
  /**
   * For `memory` provider: pre-allocated Maps to share with
   * `RoomStateManager` so its deprecated direct-Map fields read the same
   * data the store mutates. Ignored for `redis` (Redis owns state — there
   * are no Maps to share).
   */
  maps?: RoomLifecycleMaps;
  /** Redis URL (default: `redis://localhost:6379`). */
  redisUrl?: string;
  /**
   * Optional pre-built `ioredis` client to share across multiple Redis-
   * backed surfaces (RedisRoomStateStore, RedisSchedulerLock, etc.). When
   * supplied, the lifecycle store reuses it AND will not call `quit()` on
   * shutdown — the shared client's owner is responsible for that.
   */
  redisClient?: Redis;
  /** Redis key prefix (default: `bingo:room:`). */
  redisKeyPrefix?: string;
  /** Redis key TTL in seconds (default: 24h). */
  redisTtlSeconds?: number;
}

/**
 * Resolves the provider from env when not set explicitly. Unknown values
 * fall back to `memory` with a warning — better than crashing boot, since
 * the typo is operational not regulatory.
 */
export function resolveProviderFromEnv(): RoomLifecycleStoreProvider {
  const raw = process.env.ROOM_STATE_PROVIDER?.trim().toLowerCase();
  if (raw === "redis") return "redis";
  if (raw === undefined || raw === "" || raw === "memory") return "memory";
  factoryLog.warn(
    { rawValue: raw },
    "ROOM_STATE_PROVIDER has unknown value; falling back to memory",
  );
  return "memory";
}

/**
 * Construct + (for Redis) eagerly connect the room-lifecycle store. Async
 * because the Redis impl needs a connection-establish step before traffic
 * — calling this from boot guarantees `ROOM_STATE_PROVIDER=redis` fails
 * fast on unreachable Redis.
 *
 * For tests that want a synchronous in-memory store, prefer
 * `new InMemoryRoomLifecycleStore()` directly. For wiring inside
 * `index.ts` (which constructs many singletons synchronously before the
 * async boot block), use {@link buildRoomLifecycleStoreSync} +
 * {@link connectRoomLifecycleStore} instead — same end state, but split
 * across a sync constructor and an async connect step.
 */
export async function createRoomLifecycleStore(
  options: CreateRoomLifecycleStoreOptions = {},
): Promise<RoomLifecycleStore> {
  const store = buildRoomLifecycleStoreSync(options);
  await connectRoomLifecycleStore(store);
  return store;
}

/**
 * Synchronous companion to {@link createRoomLifecycleStore}. Returns the
 * impl WITHOUT establishing the Redis connection — the caller MUST
 * subsequently `await connectRoomLifecycleStore(store)` (typically inside
 * the boot async-block) before traffic. The split exists so `index.ts`
 * can wire dependencies synchronously and still fail fast at boot if
 * Redis is unreachable.
 *
 * Returns the abstract `RoomLifecycleStore` so the caller's static type
 * doesn't depend on the chosen impl.
 */
export function buildRoomLifecycleStoreSync(
  options: CreateRoomLifecycleStoreOptions = {},
): RoomLifecycleStore {
  const provider = options.provider ?? resolveProviderFromEnv();

  if (provider === "memory") {
    factoryLog.info({ provider }, "creating in-memory RoomLifecycleStore");
    return new InMemoryRoomLifecycleStore(options.maps);
  }

  // provider === "redis" — construct with lazyConnect so the synchronous
  // path here doesn't block on TCP. `connectRoomLifecycleStore` is the
  // boot-side fail-fast surface.
  const url = options.redisUrl ?? process.env.REDIS_URL?.trim() ?? "redis://localhost:6379";
  factoryLog.info({ provider, url }, "creating Redis-backed RoomLifecycleStore (deferred connect)");
  return new RedisRoomLifecycleStore({
    redis: options.redisClient,
    url,
    keyPrefix: options.redisKeyPrefix,
    ttlSeconds: options.redisTtlSeconds,
    // Always lazy in the sync builder — caller decides when to connect.
    lazyConnect: true,
    externallyManaged: !!options.redisClient,
  });
}

/**
 * Establish the Redis connection for a store built via
 * {@link buildRoomLifecycleStoreSync}. No-op for the in-memory impl.
 * Throws if Redis is unreachable — boot caller should propagate the
 * error so the process aborts rather than serving traffic with broken
 * room-state.
 */
export async function connectRoomLifecycleStore(store: RoomLifecycleStore): Promise<void> {
  if (store instanceof RedisRoomLifecycleStore) {
    await store.connect();
    factoryLog.info("Redis-backed RoomLifecycleStore connected");
  }
}

/**
 * Optional shutdown hook for the Redis impl (no-op for in-memory). Wire
 * into the process SIGTERM handler so an in-flight `quit()` settles
 * before the worker exits.
 */
export async function shutdownRoomLifecycleStore(store: RoomLifecycleStore): Promise<void> {
  if (store instanceof RedisRoomLifecycleStore) {
    await store.shutdown();
  }
}
