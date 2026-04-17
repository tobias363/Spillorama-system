# Rollback Runbook (BIN-540)

**Owner:** Technical lead (Tobias Haugen)
**On-call:** TBD — see [Linear team](https://linear.app/bingosystem/team).
**Linear:** [BIN-540](https://linear.app/bingosystem/issue/BIN-540)
**Last updated:** 2026-04-18

This runbook is the single authoritative procedure for rolling back the web-native client during the hall-for-hall cutover. It covers the happy path (one hall at a time), the emergency path (global rollback), and the staging smoke that proves the mechanism works before any production flip.

**SLA: a flip in the DB must be effective for new sessions within 2 minutes.**

---

## 1. How the flag works

Every hall has a `client_variant` column on `app_halls`:

| Value | Meaning |
| --- | --- |
| `unity` | Legacy Unity client. Default. |
| `web` | New web-native client. |
| `unity-fallback` | Emergency rollback — same behaviour as `unity` but distinguishable in audit so we know a hall was rolled back vs. never opted in. |

**Backend** reads the column via `PlatformService.getHallClientVariant(hallReference)`, cached for **60 seconds** in-process. A DB error returns `unity` (fail-closed).

**Client** (`apps/backend/public/web/lobby.js`) calls `GET /api/halls/:hallRef/client-variant` on hall-switch, caches the answer in `sessionStorage[spilloramaClientVariant:<hallId>]`. The cache is **session-scoped** — flipping the flag mid-session does not change the engine a currently-loaded player is using. New sessions see the new value after the backend's 60-s cache expires.

Effective rollback window: **< 2 min for new sessions**, **next page reload for in-session players** (typical session length is 20–60 min, so most players will pick up the flip within a normal break).

---

## 2. Happy path: roll one hall back

You're in the middle of the cutover. Hall "hall-oslo-sentrum" is on `web`, pilot feedback looks bad, roll it back to Unity.

```sql
-- On production Postgres (read-only → primary via pgBouncer)
UPDATE app_halls SET client_variant = 'unity-fallback' WHERE slug = 'hall-oslo-sentrum';
```

**Verify** the flip took (can be run from an operator workstation):

```bash
# Replace <hall-slug> with the hall you just flipped.
curl -s https://<backend>/api/halls/<hall-slug>/client-variant
# Expected: { "ok": true, "data": { "hallReference": "<hall-slug>", "clientVariant": "unity-fallback" } }
# If it still returns 'web', wait 60 seconds (the in-process cache TTL) and retry.
```

**What players see:**
- New sessions (fresh page load) — Unity.
- In-session players on the web client — they finish their current round on web, then hit the lobby, pick Spill → Unity.
- Unity-side reconnects work as normal because they never depended on the flag.

**Don't** restart the backend to speed up the flip. The cache TTL is 60 s by design — a restart invalidates sticky sessions globally and creates a small thundering-herd on Postgres.

---

## 3. Emergency path: global rollback

You're seeing a critical bug affecting multiple halls. Roll everyone back.

```sql
-- Single statement — all halls on 'web' drop to 'unity-fallback'.
UPDATE app_halls SET client_variant = 'unity-fallback' WHERE client_variant = 'web';
```

**Alternate (safer) form** — explicitly list the halls you want to roll back instead of a blanket predicate, so you can't accidentally include halls that were never on `web`:

```sql
UPDATE app_halls
SET client_variant = 'unity-fallback'
WHERE slug IN ('hall-oslo-sentrum', 'hall-bergen-vest', 'hall-trondheim');
```

Same 60-second propagation applies. If the 2-min SLA is about to be violated, escalate per §5 — don't start yanking servers.

---

## 4. Verifying the flip

Three signals to watch during the flip:

1. **The API endpoint** — as in §2, `GET /api/halls/:slug/client-variant` returns the new value within 60 s.
2. **Backend log lines** — on every new session that fetches a flag, nothing is logged at info level (this is by design, to keep the noise floor low); a DB error logs `[BIN-540] getHallClientVariant failed, defaulting to 'unity'`. If you see that line, the DB is sick — see §6.
3. **Lobby sessionStorage** — in a player's browser devtools:
   `sessionStorage.getItem('spilloramaClientVariant:<hallId>')`
   After a page reload, this must equal the new DB value.

---

## 5. Who decides to roll back

**On-call engineer** decides for one-hall rollbacks based on the [observability runbook §4](./OBSERVABILITY_RUNBOOK.md) thresholds. No approval needed.

**Global rollback** needs **two** of:
- On-call engineer
- Technical lead (Tobias)
- Product owner

This is a consensus check, not a multi-party vote — the intent is "at least two humans agreed something is seriously wrong". Log the decision in the incident channel before running the SQL.

Time budget: from first alert to `UPDATE` committed should be **< 5 min**. If consensus is taking longer than that, default to **rolling back one hall first** (§2) while consensus forms.

---

## 6. When the DB is the problem

If the flip itself can't commit (Postgres primary unavailable, long-running blocker transaction), the fail-safe behaviour kicks in: `getHallClientVariant` returns `unity` on any DB error. So at baseline, a broken DB means every new session goes to Unity regardless of the flag's value. That's usually what you want.

But: already-cached sessions (backend 60-s cache + browser sessionStorage) still reflect the pre-outage flag. To force-invalidate both:

```bash
# On every backend node, force a process restart. Graceful-shutdown runs.
# Sticky sessions end — players land on Unity on next page load.
render deploy --restart-only <service-id>
```

This is a nuclear option. Don't reach for it unless the flag-based rollback isn't stopping the bleeding.

---

## 7. Staging smoke — must pass before every production rollout

Before flipping any hall to `web` in production, run this smoke against staging. Takes ~5 min.

1. Create a test hall with `client_variant = 'web'`:
   ```sql
   INSERT INTO app_halls (id, slug, name, region, address, client_variant, is_active, created_at, updated_at)
   VALUES (gen_random_uuid()::text, 'smoke-540', 'BIN-540 Smoke', 'NO', '', 'web', true, now(), now());
   ```
2. Open staging lobby as a test user. Pick the `smoke-540` hall. Click a game that supports web. Confirm the **web** client loads (check devtools Network for `/web/games/main.js`).
3. Flip the hall back:
   ```sql
   UPDATE app_halls SET client_variant = 'unity-fallback' WHERE slug = 'smoke-540';
   ```
4. **Stay in session.** Confirm the currently-loaded web session keeps working (this is the sticky-per-session behaviour — the session doesn't get yanked out from under the player).
5. Open a second browser window / incognito. Pick the same hall. Confirm the **Unity** client loads (or the Unity bootstrap starts — confirmation depends on whether the test user has Unity preloaded).
6. Clean up:
   ```sql
   DELETE FROM app_halls WHERE slug = 'smoke-540';
   ```

Record the smoke pass in the rollout ticket. If any step fails, the rollout is blocked until the failure is fixed + re-smoked.

---

## 8. Limitations / known gaps

- **The 60-s cache is per-process.** A backend running N nodes has N independent caches. All of them converge on the new value within 60 s, but an individual node might hold onto the stale value for slightly longer if it served many in-cache hits just before the flip. This is acceptable for rollback (defaults to the safe direction on any error) but is visible in the access log if you're looking for it.
- **Mid-session stickiness is browser-side.** A malicious client could clear sessionStorage + force-reload to bypass the stickiness. That's fine — the next fetch will return the new value. But it means the stickiness is a UX affordance, not a security boundary.
- **Admin-panel UI for flipping the flag is not built yet.** Until that lands, the only way to flip is direct SQL via the admin DB tool. Tracked as a follow-up issue.
