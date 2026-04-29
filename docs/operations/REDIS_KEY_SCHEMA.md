# Redis Key Schema (Room Lifecycle State)

**Owner:** Backend ops
**Last updated:** 2026-04-29 (Bølge K4)
**Status:** Active for `ROOM_STATE_PROVIDER=redis` deployments. Default
production config since K4.

This document describes the Redis key layout used by
`RedisRoomLifecycleStore` (the K4 Redis-backed atomic state owner). It
exists so operators can:

- Inspect a stuck room's state with `redis-cli` without reading the impl.
- Write monitoring queries (key counts, TTL distribution).
- Recover a corrupted room with surgical DEL commands.
- Plan key-budget for memory sizing.

For the in-memory variant (`ROOM_STATE_PROVIDER=memory`), no Redis keys
are used — all state is process-local.

## 1. Key prefix

All keys are prefixed with `bingo:room:` by default. Override via the
factory's `redisKeyPrefix` option (used in tests with a per-suite UUID
prefix to isolate concurrent runs).

## 2. Per-room keys

Each room owns five keys, all prefixed by the room code. For room code
`B-0001` the keys are:

| Key | Type | Purpose |
|-----|------|---------|
| `bingo:room:B-0001:armedTickets` | Hash | playerId → ticketCount (decimal-encoded number). Membership = "player has armed". |
| `bingo:room:B-0001:selections` | Hash | playerId → JSON-encoded `TicketSelection[]`. Per-type selections (e.g. `[{type:"small",qty:3,name:"Small Yellow"}]`). |
| `bingo:room:B-0001:reservations` | Hash | playerId → wallet-reservation-id (UUID). Tracks the active wallet reservation row. |
| `bingo:room:B-0001:armCycle` | String | Arm-cycle UUID. Bumped on `disarmAllPlayers`; used as `bet:arm` idempotency-key salt. |
| `bingo:room:B-0001:lock` | String | Per-room mutex token (random UUID). SET NX EX with 30s TTL. Held by `cancelPreRoundTicket` and `evictWhere`. |

## 3. TTL

- Per-room hashes (`armedTickets`, `selections`, `reservations`,
  `armCycle`) get a 24-hour TTL refresh on every write. Abandoned rooms
  auto-clean within 24 h of the last activity.
- The lock key (`lock`) has a 30-second TTL — short enough that a
  crashed lock-holder can never permanently block the room. The release
  step verifies the token before DEL, so a stale release after natural
  TTL-expiry doesn't kill a fresh holder's lock.

## 4. Atomicity

- Multi-step pure-Redis ops (`evictPlayer`, `disarmAllPlayers`,
  `armPlayer`, `disarmPlayer`, `setReservationId`, both
  `cancelPreRoundTicket` paths) run as Lua scripts — Redis executes Lua
  atomically against the keyspace, so no caller can observe a half-
  applied state.
- Ops with a JS callback (`cancelPreRoundTicket`'s display-cache
  mutation, `evictWhere`'s predicate) run inside a `:lock` key
  acquired via SET NX EX. The token is verified on release via Lua to
  prevent stale-release races.

## 5. Inspection commands

Look at one room:

```bash
redis-cli -u "$REDIS_URL" KEYS "bingo:room:B-0001:*"
redis-cli -u "$REDIS_URL" HGETALL "bingo:room:B-0001:armedTickets"
redis-cli -u "$REDIS_URL" HGETALL "bingo:room:B-0001:selections"
redis-cli -u "$REDIS_URL" HGETALL "bingo:room:B-0001:reservations"
redis-cli -u "$REDIS_URL" GET "bingo:room:B-0001:armCycle"
redis-cli -u "$REDIS_URL" TTL "bingo:room:B-0001:armedTickets"
```

Count active rooms (those with armed players):

```bash
redis-cli -u "$REDIS_URL" --scan --pattern "bingo:room:*:armedTickets" | wc -l
```

Find rooms holding mutex locks (>0 = something is mid-eviction):

```bash
redis-cli -u "$REDIS_URL" --scan --pattern "bingo:room:*:lock"
```

## 6. Surgical recovery

If a room is stuck (e.g. an orphan reservation from a wallet/Redis
desync), nuke its lifecycle state:

```bash
redis-cli -u "$REDIS_URL" DEL \
  "bingo:room:B-0001:armedTickets" \
  "bingo:room:B-0001:selections" \
  "bingo:room:B-0001:reservations" \
  "bingo:room:B-0001:armCycle" \
  "bingo:room:B-0001:lock"
```

This is equivalent to calling `disarmAllPlayers` from the application
side. Wallet reservations on the DB side are NOT released by this — the
30-min wallet reservation TTL or `WalletReservationExpiryService` will
clean them up. For an immediate release, run `releaseReservation` via
the admin tools.

## 7. Capacity planning

Per active room (5 players × 1 selection each):

- `armedTickets` hash: 5 fields × ~30 bytes = ~150 B
- `selections` hash: 5 fields × ~80 bytes (JSON) = ~400 B
- `reservations` hash: 5 fields × 60 bytes = ~300 B
- `armCycle` string: ~50 B
- `lock` string (transient, 0–30 s TTL): ~50 B

Total per room: ~1 KB while active. 1000 concurrent active rooms
≈ 1 MB Redis memory. Pilot capacity (4 halls × 1 active room each) is
in the kilobytes — well within Render Redis Starter (256 MB).

## 8. Migration notes

When migrating a deployment from `ROOM_STATE_PROVIDER=memory` to
`redis`:

1. Schedule the cutover at a quiet hour (no active rooms).
2. Set `ROOM_STATE_PROVIDER=redis` and `REDIS_URL`.
3. Deploy. Boot fails fast if Redis is unreachable (factory's eager
   connect).
4. Verify with `redis-cli --scan --pattern "bingo:room:*"` returns
   nothing initially — the empty Redis IS the empty in-memory state.
5. As traffic resumes, keys appear and TTLs tick.

When migrating BACK to `memory` (rollback):

- Set `ROOM_STATE_PROVIDER=memory` and redeploy.
- Existing Redis keys become orphaned (TTL out within 24 h). Optionally
  flush manually:

```bash
redis-cli -u "$REDIS_URL" --scan --pattern "bingo:room:*" | xargs redis-cli -u "$REDIS_URL" DEL
```

(Use `xargs -n 100` for large keyspaces to avoid CLI argv limits.)

Note that downgrading `redis` → `memory` mid-shift loses the active
arm-state. Schedule rollbacks during a quiet window.

## 9. Related stores

The `RoomLifecycleStore` is **not** the only Redis-backed state in this
repo. For completeness:

- `RedisRoomStateStore` (`bingo:room:{code}` JSON) — full game-state
  serialization (players, currentGame, drawBag). Older, BIN-170 era.
- `RedisSchedulerLock` (`bingo:lock:{code}`) — distributed scheduler
  lock for draws. BIN-171.
- Socket.IO Redis adapter (`bingo-io#…` channels) — Socket.IO pub/sub
  for cross-instance event fanout. BIN-494.

Each owns its own key prefix and has separate ops surface area; they do
not share keys. The `bingo:room:` prefix is used by both
`RedisRoomStateStore` (full JSON values, key shape `bingo:room:{code}`)
and the K4 `RedisRoomLifecycleStore` (key shape
`bingo:room:{code}:{state-space}`) — the suffix-based separation
prevents collisions.

## 10. References

- `apps/backend/src/util/RedisRoomLifecycleStore.ts` — implementation.
- `apps/backend/src/util/RoomLifecycleStore.ts` — interface (K2).
- `docs/audit/REFACTOR_AUDIT_PRE_PILOT_2026-04-29.md` §2.3 + §6 K4 —
  rationale.
- `docs/operations/BOOT_RESTORE_AFTER_K4.md` — boot recovery flow.
