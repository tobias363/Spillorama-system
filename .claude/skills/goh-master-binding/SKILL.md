---
name: goh-master-binding
description: When the user/agent works with Group of Halls (GoH) and the master-hall role for Spill 1 in the Spillorama bingo platform. Also use when they mention app_hall_groups, app_hall_group_members, master_hall_id, group_hall_id, transferHallAccess, Game1TransferHallService, Game1HallReadyService, resolveParticipatingHallIds, hall-membership filter, ON DELETE CASCADE, hall-cascade-strategy, GoH master pin, BIN-1034, BIN-1038, BIN-453, master-rolle-modellen, master-hall-velger, participating_halls_json, agent-portal master-actions, hall-deactivation, master fallback to run.hall_id, pilot 4-hall (Teknobingo Årnes + Bodø + Brumunddal + Fauske). The master-rolle-modellen says master is a bingovert with extra responsibility, NOT a separate role — the route-guard checks hall-id, not user.role. Make sure to use this skill whenever someone touches hall-group SQL, master_hall_id resolution, transferHallAccess, scheduled-game spawn, or per-hall ready-state — even if they don't mention GoH directly — because mis-binding the master_hall_id silently corrupts every Spill 1 run for that GoH.
metadata:
  version: 1.0.0
  project: spillorama
---

<!-- scope: apps/backend/src/admin/HallGroupService.ts, apps/backend/src/admin/HallGroupService.test.ts, apps/backend/src/routes/adminHallGroups.ts, apps/backend/src/routes/__tests__/adminHallGroups.test.ts, apps/backend/src/platform/HallGroupMembershipQuery.ts, apps/backend/src/platform/__tests__/HallGroupMembershipQuery.test.ts, apps/backend/src/game/Game1TransferHallService.ts, apps/backend/src/game/Game1TransferExpiryTickService.ts, apps/backend/src/game/Game1HallReadyService.ts, apps/backend/src/boot/bootstrapHallGroupRooms.ts -->

# Group of Halls + Master Binding

A **Group of Halls (GoH)** is a set of halls that play the same Spill 1 round simultaneously. Inside a GoH there is exactly **one master-hall** at any moment — that hall's bingovert holds the master-actions (start, pause, resume, advance to next plan-position, set jackpot popup). The other halls are participants.

Master is **not a user-role**. It's a property of the hall, computed at runtime. The route-guard checks `hallId === effectiveMasterHallId`, not `user.role === 'MASTER'`.

## Kontekst (read first)

- `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` §1.2 (master-rolle-modellen) — authoritative behaviour spec
- `docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md` — explains the plan-run-id ↔ scheduled-game-id schism that has been the source of master-action bugs
- Memory `project_master_role_model.md` — Tobias-direktiv: master is bingovert with extra responsibility, not a role
- Memory `project_pilot_scope_2026_05_05.md` — pilot is 4 haller (Teknobingo Årnes master + Bodø + Brumunddal + Fauske)
- Source files:
  - `apps/backend/src/game/HallGroupService.ts` (GoH CRUD)
  - `apps/backend/src/game/Game1HallReadyService.ts` (`resolveParticipatingHallIds`)
  - `apps/backend/src/game/Game1TransferHallService.ts` (60s handshake)
  - `apps/backend/src/game/GamePlanEngineBridge.ts` (`createScheduledGameForPlanRunPosition`)
- Migrations:
  - `apps/backend/migrations/20260424000000_hall_groups.sql`
  - `apps/backend/migrations/20261214000000_app_hall_groups_master_hall_id.sql`
  - `apps/backend/migrations/20261216000000_app_hall_groups_cascade_fk.sql` (PR #1038 defense-in-depth)

## Kjerne-arkitektur

### Datamodell

```
app_hall_groups
  ├─ id (text, eks: "pilot-goh")
  ├─ name (unique)
  ├─ master_hall_id (FK → app_halls, ON DELETE SET NULL)  ← BIN-1034
  ├─ status, deleted_at, ...

app_hall_group_members
  ├─ group_id (FK → app_hall_groups, ON DELETE CASCADE)   ← BIN-1038
  ├─ hall_id  (FK → app_halls, ON DELETE CASCADE)
  └─ added_at

app_game1_scheduled_games
  ├─ id (UUID, gameId)
  ├─ master_hall_id        ← snapshot at spawn-time
  ├─ group_hall_id (FK → app_hall_groups, ON DELETE SET NULL)
  └─ participating_halls_json   ← snapshot at spawn-time
```

### `effectiveMasterHallId` resolution at spawn

`GamePlanEngineBridge.createScheduledGameForPlanRunPosition` resolves the master-hall:

```
effectiveMasterHallId =
  GoH.master_hall_id (if pinned + hall is active)
  ELSE run.hall_id   (fallback)
```

If `master_hall_id` is pinned but the hall is deactivated, we fall back to `run.hall_id` and emit an audit-log warning (`[GoH-master-pin] bruker GoH master_hall_id istedenfor run.hall_id`-style log). The pinned value is honoured; the fallback only fires for the deactivated edge case.

`participating_halls_json` is snapshotted at spawn from `resolveParticipatingHallIds(group_hall_id)` — current GoH-members minus deactivated halls. The snapshot is immutable for the lifetime of that scheduled-game; subsequent membership changes do not retroactively affect the running round.

### Master-actions are gated by `master_hall_id`, not by role

Every master-action route does this check:

```typescript
if (game.master_hall_id !== caller.hallId && caller.role !== 'ADMIN') {
  throw FORBIDDEN;
}
```

ADMIN can always perform master-actions (operational override). HALL_OPERATOR/AGENT can only do them if their `hallId` matches the scheduled-game's `master_hall_id`.

There is no `MASTER` role and there will never be one. The model is intentional: a bingovert who happens to be at the master-hall today is a master today; tomorrow the master-hall might be transferred and the same bingovert is no longer master. Roles don't change — hall-membership and `master_hall_id` do.

### transferHallAccess (60s handshake, BIN-453)

Runtime master-transfer is provided by `Game1TransferHallService`:

1. Source-master proposes transfer to target-hall (`POST /api/admin/game1/transfer-hall/propose`)
2. Target-hall has 60s to accept (`POST /api/admin/game1/transfer-hall/accept`)
3. On accept: `app_game1_scheduled_games.master_hall_id` is updated atomically + audit-log
4. If target doesn't accept in 60s, proposal expires (cron tick)

Transfer is the only sanctioned mid-round master-change. Never `UPDATE master_hall_id` directly via SQL.

### ON DELETE CASCADE strategy (BIN-1038, defense-in-depth)

When a GoH is deleted, defense-in-depth cascades fire on the DB level so we don't end up with orphan `app_hall_group_members`, `app_game_plan.group_of_halls_id`, `app_game_plan_run.plan_id` (transitive), `app_game_plan_item.plan_id`, `app_game1_scheduled_games.group_hall_id`. This complements the application-level cascade in `HallGroupService.delete()`.

The two layers are intentional: HallGroupService does the "expected" cascade with audit-logging; the FK-CASCADE catches any code-path that bypassed the service (or future code that forgets).

## Immutable beslutninger

1. **Master is not a user-role.** It's a hall-property checked at runtime via `hallId === scheduled_game.master_hall_id`.
2. **Master starts independent of ready-state** (Tobias-direktiv 2026-05-08). Ready-pills are *informational* — master can press Start whenever.
3. **`master_hall_id` is set at GoH-creation.** Default master-hall is configured on the GoH and pinned. Bridge uses it; fallback to `run.hall_id` only for deactivated edge case.
4. **Snapshots at spawn are immutable.** `participating_halls_json` and `master_hall_id` on the scheduled-game don't change after the game starts (except via `transferHallAccess`).
5. **transferHallAccess is the only sanctioned mid-round master-change.** Never raw-SQL `UPDATE master_hall_id`.
6. **ON DELETE CASCADE is defense-in-depth, not the primary cascade.** Always go through HallGroupService for delete operations so audit-logging fires.
7. **Pilot GoH composition is fixed:** Teknobingo Årnes (master) + Bodø + Brumunddal + Fauske. Don't ship code that requires deviation from this without Tobias decision.

## Vanlige feil og hvordan unngå dem

1. **Adding a `MASTER` role.** Wrong — the model says master is a hall-property, not a role. New routes must check `hallId === master_hall_id || role === 'ADMIN'`.
2. **Reading `master_hall_id` from `app_hall_groups` at action-time instead of from the scheduled_game.** The snapshot on `app_game1_scheduled_games` is the source of truth during a run. Reading the GoH live can give the wrong answer if a transfer just happened.
3. **Bypassing `Game1TransferHallService` for "convenience" master-change.** No — direct UPDATE skips the 60s handshake, audit-logging, and socket-broadcasts.
4. **Forgetting that `master_hall_id` can be NULL after a hall-delete.** `ON DELETE SET NULL` is intentional. Code reading it must handle NULL gracefully (fall back to `run.hall_id`).
5. **Re-deriving `participating_halls_json` at action-time instead of using the spawn-time snapshot.** Membership might have changed mid-round; the snapshot is the contract.
6. **Hall-scoped queries that join GoH but not group-membership.** E.g. "show me ready-state for all halls in this game" — must filter via `participating_halls_json`, not via current `app_hall_group_members`.
7. **Trying to cascade-delete from the FK-side instead of HallGroupService.** Skips audit-log emission. The CASCADE is a safety net; the service is the door.
8. **Allowing master to skip a plan-position.** Master cannot skip — always advances to next position in plan-sequence (Tobias-direktiv 2026-05-08).
9. **Showing master-actions to non-master agents.** UI must hide/disable master-buttons when caller's hallId doesn't match. Backend must enforce too — never trust UI gating.

## Kanonisk referanse

- Master-rolle-modellen: `docs/architecture/SPILL1_IMPLEMENTATION_STATUS_2026-05-08.md` §1.2
- Plan-Spill-kobling fundament: `docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md`
- HallGroupService: `apps/backend/src/game/HallGroupService.ts`
- Hall-ready-service: `apps/backend/src/game/Game1HallReadyService.ts`
- Transfer-service: `apps/backend/src/game/Game1TransferHallService.ts`
- Bridge: `apps/backend/src/game/GamePlanEngineBridge.ts` (search `master_hall_id` and `resolveParticipatingHallIds`)
- Migrations: `apps/backend/migrations/2026{0424,1214,1216}*.sql`

## Når denne skill-en er aktiv

LOAD when:
- Touching `app_hall_groups` / `app_hall_group_members` schema or queries
- Modifying `master_hall_id` resolution in the bridge or any service
- Implementing or modifying `transferHallAccess` / `Game1TransferHallService`
- Adding a new master-action route (need to add the master/admin guard)
- Building hall-ready-state UI or backend
- Implementing GoH CRUD (especially delete with cascade)
- Investigating "master button greyed out" or "wrong master hall"-style bugs

SKIP when:
- Solo-hall plans (where `hall_id` is set instead of `group_of_halls_id`) — those don't have GoH semantics
- Non-Spill-1 features (Spill 2 + 3 are global singleton rooms, no GoH)
- Pure UI work that doesn't touch master-action logic
