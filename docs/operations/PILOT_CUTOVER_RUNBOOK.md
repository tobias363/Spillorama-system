# Pilot cutover runbook — Unity → web hall-for-hall

**Linear:** [BIN-525 (Legacy-avkobling)](https://linear.app/bingosystem/project/legacy-avkobling-game-1-5-backend-paritet-a973e623234a) · [BIN-540 (feature-flag)](https://linear.app/bingosystem/issue/BIN-540) · [BIN-532 (Unity rollback — dropped 2026-04-17)](https://linear.app/bingosystem/issue/BIN-532)
**Owner:** Technical lead (Tobias Haugen)
**Status:** **Draft** — must be signed off by technical lead + compliance + ops before the first hall is cut over. See §9.
**Last updated:** 2026-04-17

---

## Why this document exists

The Unity → web migration cuts over per hall, not everything at once. That means an ad-hoc "flip the flag and see what happens" is the wrong posture — one regression in an early hall poisons the reputation of the whole rollout. This runbook is the single source of truth for:

- What must be true before the first hall flips (§1 forutsetninger).
- Exactly what steps an operator runs when they flip a hall (§2 cutover).
- Exactly what steps they run if something goes wrong (§3 rollback).
- Pre-pilot smoke tests that prove the gates still catch (§4 Spillvett, §5 chat persistens).
- Which halls go when (§6 rollout plan) and what we write down per hall (§7 log).

Complements but does not replace:

- [`ROLLBACK_RUNBOOK.md`](./ROLLBACK_RUNBOOK.md) — BIN-540 per-hall `client_variant` flag mechanics.
- [`OBSERVABILITY_RUNBOOK.md`](./OBSERVABILITY_RUNBOOK.md) — BIN-539 what signal to watch, what the thresholds mean.
- [`../compliance/RELEASE_GATE.md`](../compliance/RELEASE_GATE.md) §7 — pre-pilot acceptance checklist; this runbook satisfies parts of it.

---

## §1 Forutsetninger (pre-flight checklist)

**Do not flip a hall unless every box is ticked.** Copy the checklist into the cutover issue comment with ticked boxes as evidence — leaves a trail for compliance.

### Code + CI
- [ ] All PRs in the [Legacy-avkobling project](https://linear.app/bingosystem/project/legacy-avkobling-game-1-5-backend-paritet-a973e623234a) that this pilot depends on are merged to `main`.
- [ ] `PARITY_MATRIX.md` §2.3 shows **Observability ✅**, **Feature-flag rollback-runbook ✅**, **E2E pengeflyt-test ✅**, **Wire-kontrakt-test ✅**.
- [ ] Latest nightly CI green: `compliance-gate.yml` + the Artillery load-test job for BIN-508.
- [ ] Branch-protection on `main` shows `compliance` as a required status check (one-time toggle — see `RELEASE_GATE.md` §3).

### Unity rollback (dropped — BIN-532 canceled 2026-04-17)

**No Unity archive exists or will be built.** Unity permanent decommissioned;
`legacy/unity-client/` is retained as read-only code reference only.
Rollback strategy is web-only git-revert of the current deploy — see §3.
No pre-flight Unity checks needed.

### Observability
- [ ] Grafana dashboards `spillorama-draws-claims`, `spillorama-connection-health`, `spillorama-finance-gates` are reachable on the target Grafana (run `./infra/deploy/grafana-provision.sh` if not — see `infra/README.md`).
- [ ] All four SLO panels show **green** for the last 1 h: reconnect ratio ≤ 2 %, scheduler p99 ≤ 500 ms, stuck rooms = 0, wallet-op p99 ≤ 2000 ms.
- [ ] Sentry projects `spillorama-backend` and `spillorama-client` received at least one event in the last 24 h (a heartbeat or a real capture). A silent Sentry is almost always a misconfig, not a healthy service.
- [ ] PagerDuty / Slack alert wiring confirmed by on-call engineer for the three pilot SLOs (see `OBSERVABILITY_RUNBOOK.md` §2).

### Platform state
- [ ] Postgres migrations are up to the latest `apps/backend/migrations/` timestamp in `main`. Confirm via `npm --prefix apps/backend run migrate`.
- [ ] Redis (session/room state) is reachable — `/health` on the backend returns `status: "ok"`.
- [ ] `HALL_DISPLAY_TOKEN_<SLUG>` env var set in Render **or** (preferred) a DB-backed display token generated via the admin UI per BIN-503 (`/admin/#section-hall-display`).
- [ ] Spillvett limits for the pilot hall are provisioned and a test-bruker can be used to verify fail-closed (see §4).

### Hall readiness
- [ ] Pilot hall identified in writing (hall-admin name + contact). Cutover-vindu koordinert utenfor ordinære spillsesjoner — helst midt-på-dagen, aldri rett før storspill.
- [ ] Hall-admin briefed on the one-click rollback process. They don't need to run it themselves, but they need to know to Slack/ring on-call the second anything feels off.
- [ ] Printed copy of §2 cutover and §3 rollback at the hall during the first run.

---

## §2 Cutover-prosedyre per hall

**Owner:** on-call engineer for the cutover window.
**Target duration:** < 15 min end-to-end, including the 10-minute stabilization watch. If any step takes > 2× its expected time, pause and diagnose before proceeding.

> **Rule of thumb:** a cutover is one hall at a time. Never cut two halls in the same session — you lose the ability to correlate a spike to a single change.

### Step-by-step

1. **Announce in `#ops-cutover`:** `Starting web cutover for hall <slug> at <ISO timestamp>. On-call: <name>. Revert path: §3 of PILOT_CUTOVER_RUNBOOK.md.`

2. **Flip the flag** via admin-web → Halls → select hall → *Client variant* → `web` → Save. This calls `PUT /api/admin/halls/:id` with `clientVariant = "web"`. Confirm the response contains `clientVariant: "web"`. (Per BIN-540, this goes into `app_halls.client_variant` and is read-through cached with a 60 s TTL — new sessions within 60 s may still see `unity`.)

3. **Invalidate CDN cache** for the web-client assets. Exact commands depend on the CDN:
   - Cloudflare: `cf purge -u https://<domain>/web/games/main.js -u https://<domain>/web/games/main.css`
   - Render static sites: trigger a redeploy of the static site (CDN cache tied to deploy).
   - No CDN (direct Render origin): skip — the backend sends `Cache-Control: no-cache` on the variant-lookup endpoint already.

4. **Notify the hall-admin:** "Hall is now on the web client. Please refresh the TV-skjerm (Ctrl/Cmd+Shift+R) and ask players to close-and-reopen the app." Wait for confirmation from hall-admin before moving to step 5.

5. **Start the stabilization watch.** Open the three Grafana dashboards in three tabs, set all three to `now-15m → now` with 30-second refresh:
   - `spillorama-connection-health` (primary — first signal of any trouble)
   - `spillorama-draws-claims` (use the `$hall` filter set to the pilot hall's slug)
   - `spillorama-finance-gates` (sanity)

6. **Watch for 10 minutes.** During this window the on-call engineer does nothing else. Key signals:

   | Signal | Healthy | Investigate | Roll back |
   | --- | --- | --- | --- |
   | Reconnect ratio (5m) | ≤ 2 % | 2–5 % | > 5 % sustained for 2 min |
   | Active sockets for the hall | stable or climbing | sudden drop > 20 % | sudden drop > 50 % |
   | Claim submit rate | matches pre-cutover baseline ± 30 % | > 50 % deviation | claims stop entirely |
   | Draw-engine errors (any category) | 0 | < 5 / 5 min, transient | > 5 / 5 min sustained |
   | Stuck rooms | 0 | 1 (manual investigate) | > 1 |
   | Wallet-op latency p99 | ≤ 500 ms | 500–2000 ms | > 2000 ms sustained |
   | New Sentry issues | 0 or known | unfamiliar `DomainError` codes | any `TypeError` / `ReferenceError` from the client bundle |

7. **Decision point at 10 min.** If all green, post `Cutover approved for this session. Watching for rest of hall-økt.` in `#ops-cutover`. If any row is red, execute §3 rollback.

8. **Finish the hall-økt** by keeping the dashboards open in the background. Sanity-glance every 10–15 min until the hall closes for the evening. Log the hall-økt-observations in §7.

### Operator-only shortcuts

From the admin-web during the window, the operator has (per BIN-515):

- **"Signaliser klar"** — broadcasts `room-ready` to players' clients with an optional countdown. Use this to prep the room if hall-admin is running behind.
- **"Pause spill"** / **"Fortsett spill"** — regulatorisk emergency-stop between draws. NEVER during a mini-game (draws don't happen there anyway).
- **"Force-end (teknisk feil)"** — destructive, Lotteritilsynet-logged. Require-reason prompt. Only when the round is unrecoverable. Write the reason as something a regulator can parse ("Backend restart after wallet-adapter timeout" — not "ble rar").

---

## §3 Rollback-prosedyre

**Trigger:** any "roll back" row in §2 step 6, OR any single request from the hall-admin that sounds like "this isn't working". Err on the side of rolling back — fixes happen offline.

**Target duration:** < 10 min end-to-end (longer than original plan because we revert the deploy, not flip a flag).

### Context

Since BIN-532 (Unity archive) was canceled 2026-04-17, the rollback path is **git-revert of the current web-client deploy**, not "fall back to Unity". Tradeoff:

- **Benefit:** no stale Unity archive to maintain, no CDN-dep, no ~60 MB bundle retention cost, no Unity-specific code paths to keep compiling
- **Cost:** rollback is deploy-sized (minutes, not seconds) — which is acceptable because we also have §3b (disable hall entirely) for immediate-cut scenarios

### Step-by-step (web-client-regression scenario)

1. **Announce in `#ops-cutover`:** `Rolling back hall <slug>. Trigger: <one-line reason>. Starting now.` Start a wall-clock timer.

2. **Identify the bad web-client deploy.** Check Render deploy log (`render.com/dashboard`) for the deploy that shipped the regression. Typically the most recent one.

3. **Trigger redeploy of the previous known-good commit.** In Render dashboard → Backend service → Deploys → find last green deploy → click "Redeploy". Takes ~3-5 min.

   Alternative (faster if the fix is already identified): git-revert the problem commit on main and push — Render auto-deploys.

4. **During the 3-5 min wait:** if the bad behavior is active-game-breaking (e.g. claims not registering), immediately execute §3b below to cut the hall. If the bad behavior is cosmetic or tolerable, let players finish the current round.

5. **After redeploy:** invalidate CDN cache for `/web/games/main.js` (CDN dashboard → Purge by path). Tell hall-admin to refresh TV and ask players to reopen the app.

6. **Watch the dashboards for 5 min.** Expect: reconnect-rate spike (harmless, clients reconnecting across the deploy), then drop to baseline; claim rate resumes.

7. **Log the rollback** — post the timer result + one-paragraph cause in §7 + associated Linear issue. Create sub-issue under BIN-525 if root cause isn't already tracked.

8. **Post-incident debrief** within 24 h. Pilot doesn't move to next hall until root cause is understood + either fixed or consciously accepted.

### §3b Emergency hall-shutdown (if rollback is too slow)

Used when the regression is active-game-breaking (e.g. wallet debits without ticket issued, claims lost, chat exposes other players' data). Seconds-level response needed.

1. **Admin-web → Halls → select hall → `is_active = false` → Save.** Players see "hall lukket" screen. Active rounds are force-ended per BIN-515 `admin:force-end` handler with `reason: "emergency-shutdown"` — Lotteritilsynet audit-log captured automatically.

2. **Notify hall-admin immediately** that the hall is cut for <estimated duration until fix>.

3. **Fix the issue** via normal PR + deploy flow. Then re-enable hall via `is_active = true`.

4. **Compliance log:** record the emergency-shutdown in §7 + in Lotteritilsynet-reporting log. This is a regulatory event even if no money was lost.

### What if rollback itself fails?

If Render is unreachable or the revert doesn't help:

1. **Page technical lead (Tobias) immediately** — don't try more fixes alone.
2. If admin-web is unreachable, update DB directly: `UPDATE app_halls SET is_active = false WHERE slug = '<slug>';` to execute emergency shutdown.
3. Worst case: disable all halls by `UPDATE app_halls SET is_active = false;`. Players see "vedlikehold" screen. Revert immediately after fix is deployed.

---

## §4 Spillvett fail-closed smoke-test

Run **before** §1 is ticked; re-run in staging 24 h before every hall cutover. This is the test that proves regulatory compliance still holds after any recent change.

Pre-reqs: three test-brukere in staging with known account state. If the staging DB was recently reset, seed them first.

| Test | Setup | Expected | What to do if it fails |
| --- | --- | --- | --- |
| **4.1 Hall loss limit** | Test-user 1: already at their daily hall loss limit for the pilot hall | Attempting `bet:arm` returns `hall_limit_exceeded` with the correct limit string for the hall | Do NOT proceed. Check [BIN-541](https://linear.app/bingosystem/issue/BIN-541) Spillvett cross-game-test; may be a regression. |
| **4.2 Voluntary pause** | Test-user 2: voluntary pause active (set via admin compliance panel) | `join:room` returns `voluntary_pause_active`. Player sees the pause-banner on the lobby. | Do NOT proceed. Verify `PostgresResponsibleGamingStore` health. |
| **4.3 DB fail-closed** | Test-user 3 + mock the responsibleGamingStore to throw on `checkAllowed` | `bet:arm` returns a Spillvett-denied error (**never** a success). Reason: fail-closed invariant. | Do NOT proceed — this is the regulator's kill-switch. |
| **4.4 Self-exclusion minimum** | Test-user with `self_exclusion_until` set 6 months in the future (below the 1-year regulatory minimum) | If the test happens to trip over a boundary, admin-compliance save should reject `< 1 year` in the UI | Do NOT proceed. |

Capture a screenshot / response-body paste for each row and attach to the cutover issue. Compliance-eier signs §9 only if §4 has evidence.

---

## §5 2-klient chat-persistens smoke

Run against staging right before the first hall cutover. Proves that BIN-516 chat history replay still works under a realistic disconnect.

1. Two operators open the web client on the staging pilot hall. Call them A and B. Both join the same room.
2. A sends 3 chat messages, spaced ~10 s apart. B sends 3 chat messages.
3. While A has the window focused, B's browser tab is hard-refreshed (`Ctrl/Cmd + Shift + R`).
4. After reconnect, B should see all 6 messages in order (oldest first), within 2 s of reconnect. The replay comes from `chat:history` (see BIN-516). Order is determined server-side by `created_at`.
5. **Negative:** send a 7th message from A *after* B has reconnected. B sees it live via the regular `chat:new` path — not through history replay.

If the history is out of order, missing messages, or duplicated, **abort cutover** and investigate. A broken chat replay in a real hall turns into "denne app-en er ødelagt" in the first 5 minutes.

---

## §6 Hall-for-hall rollout-plan

Phased rollout with stabilization gates. Each phase only unlocks the next if the previous one stays green for the committed period.

| Fase | Uke | Haller | Kriterier for neste fase |
| --- | --- | --- | --- |
| **F0 — Dry-run** | Pre-pilot | Staging-hall only | §4 + §5 grønne; §2 gjennomgått skritt-for-skritt minst én gang |
| **F1 — Pilot** | Uke 8 | 1 hall (utvalgt av teknisk leder + hall-admin) | 1 uke uten rollback; 0 wallet-debit-failures; 0 regulator-related Sentry issues |
| **F2 — Early expansion** | Uke 9–10 | +2 haller (én av gangen, minst 48 h mellomrom) | Som F1 per hall |
| **F3 — Broad rollout** | Uke 11+ | Batches av 3 haller per uke | 2 uker uten rollback på tvers av alle F1+F2 haller |
| **F4 — Unity-avkobling** | Etter alle haller | N/A | Alle `client_variant = 'web'` i minst 4 uker; vedtak fra teknisk leder om å slette legacy-stack |

**Rule for moving between phases:** the only person who approves is the technical lead, in writing (Linear comment on BIN-525). Compliance and ops can veto. Hall-admin can veto their own hall.

**Red-flag rule:** if any hall rolls back twice in the same week, the whole rollout pauses until root-cause analysis is complete. No new halls cut over during a pause.

---

## §7 Rehearsal-log

Append one row per event — **both** staging rehearsals and prod hall cutovers. A full row on a rollback is critical for the post-mortem.

| Dato (ISO) | Miljø | Hall | Event | Operatør | Start | Slutt | Utfall | Issues / refs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-04-17T19:51:47Z | local (in-mem test-suite) | — | rehearsal — step 2 (E2E pengeflyt, `pengeflyt-e2e.test.ts`) | agent-2 | 19:51:47Z | 19:51:48Z | pass | 5/5 tests grønne (bingo/rocket/monsterbingo/spillorama + BIN-245 checkpoint recovery); varighet 231 ms. [BIN-526](https://linear.app/bingosystem/issue/BIN-526). |
| 2026-04-17T19:52:01Z | local (in-mem test-suite) | — | rehearsal — step 8 (Spillvett fail-closed, `cross-game.test.ts`) | agent-2 | 19:52:01Z | 19:52:01Z | pass | 20/20 tests grønne (4 spill × 4 regler + 4 fail-closed), inkludert DB-mock-throw-fail-closed-invarianten; varighet 201 ms. [BIN-541](https://linear.app/bingosystem/issue/BIN-541). |
| 2026-04-17T19:52:23Z | local (in-mem test-suite) | — | rehearsal — step 6 (chat-persistens, `ChatMessageStore.test.ts` + `socketIntegration.test.ts`) | agent-2 | 19:52:23Z | 19:52:25Z | pass | 35/35 tests grønne (ChatMessageStore × 9 + socket-integrasjon × 26), inkl. `chat:history`-replay etter reconnect; varighet 1.65 s. [BIN-516](https://linear.app/bingosystem/issue/BIN-516). |
| 2026-04-17T21:xx | — | — | rehearsal — step 1 (arkiv-verifisering) | — | — | — | **dropped** | BIN-532 canceled 2026-04-17. No Unity archive will be created. Rollback strategy is git-revert of web-client deploy per §3. Step 1 removed from rehearsal scope. |
| 2026-04-18T07:32:41Z | staging (Render free, `spillorama-system.onrender.com`) | staging-hall-1 | rehearsal — step 4 (feature-flag switch — read-path end-to-end; gaps surfaced) | agent-2 | 07:32:41Z | 07:32:41Z | partial | admin-view unreachable (`GET /api/admin/halls` → 400 `INTERNAL_ERROR`); public-view `/api/halls/staging-hall-1/client-variant` → `unity`. **Gap 1:** BIN-540 did not ship an admin REST endpoint for mutating `client_variant`; flip requires direct `UPDATE app_halls …` per rollback-runbook. **Gap 2:** on this staging deploy, every admin endpoint touching `app_halls` (`/api/admin/halls`, `/api/admin/dashboard/live`, `/api/admin/halls/:id/display-tokens`, `/api/admin/halls/:id/game-config`) returns `INTERNAL_ERROR`; public fail-closed reader works (defaults to `"unity"`). Root cause hypothesis: one of the `app_halls`-column-adding migrations (`20260418090000_add_hall_client_variant.sql`, `20260418140000_halls_tv_url.sql`) did not run on staging. See **Findings** block below. [BIN-525](https://linear.app/bingosystem/issue/BIN-525) / [BIN-540](https://linear.app/bingosystem/issue/BIN-540). |
| 2026-04-18T07:32:50Z | staging (Render free) | staging-hall-1 | rehearsal — step 7 (admin hall-events: pause + resume via socket) | agent-2 | 07:32:50Z | 07:32:50Z | **blocked** | Admin socket connected OK. `room:create` socket ack returned `{code:"INTERNAL_ERROR",message:"Uventet feil i server."}`. Same root cause as step 4 — `createRoom` path traverses `platformService.requireActiveHall` → `app_halls` SELECT, which fails with the missing-column error. Re-run this step once staging DB is fixed (see Findings §S1). [BIN-515](https://linear.app/bingosystem/issue/BIN-515). |
| 2026-04-18T07:32:50Z | staging (Render free) | staging-hall-1 | rehearsal — step 3 (TV-display subscribe + draw mirror) | agent-2 | 07:32:50Z | 07:32:50Z | **blocked** | `POST /api/admin/halls/hall-default/display-tokens` returned 400 `INTERNAL_ERROR`. Same root cause as step 4 — the `listHallDisplayTokens` / `createHallDisplayToken` CRUD calls `platformService.getHall(...)` under the hood, which runs the same broken hall-SELECT. Re-run once staging DB is fixed. [BIN-498](https://linear.app/bingosystem/issue/BIN-498) / [BIN-503](https://linear.app/bingosystem/issue/BIN-503). |
| 2026-04-18T07:32:51Z | staging (Render free) | staging-hall-1 | rehearsal — step 5 (late-join spectator, 2 clients) | agent-2 | 07:32:51Z | 07:32:51Z | **blocked** | Client A + B both logged in and socket-connected OK. Client A `room:create` ack returned `{code:"INTERNAL_ERROR"}`. Same root cause as step 4. Re-run once staging DB is fixed. [BIN-500](https://linear.app/bingosystem/issue/BIN-500) / [BIN-507](https://linear.app/bingosystem/issue/BIN-507). |
| _(neste rad: re-run step 3/5/7 post-fix via `apps/backend/scripts/staging-rehearsal.mjs STEPS=3,5,7`)_ | staging | staging-hall-1 | rehearsal — hands-on step 3/5/7 re-run | | | | | |

### Findings — S1: staging `app_halls` queries return `INTERNAL_ERROR` (2026-04-18 rehearsal)

**Symptom.** Every admin or engine code-path that runs a full `SELECT ... FROM app_halls` against the current staging deploy (`spillorama-system.onrender.com`, Postgres 18) returns `INTERNAL_ERROR`. The public `GET /api/halls/:slug/client-variant` endpoint appears healthy only because it wraps errors with a fail-closed `"unity"` default (see [`BingoEngine` → `getHallClientVariant`](../../apps/backend/src/platform/PlatformService.ts)).

**Endpoints confirmed green (baseline):**
- `POST /api/auth/login` — admin + test-brukere
- `GET /api/admin/games`
- `GET /api/admin/terminals`
- `GET /api/admin/rooms`
- `GET /api/halls/:slug/client-variant` (fail-closed default, not actual lookup)

**Endpoints confirmed red (all touch `app_halls` SELECT):**
- `GET /api/admin/halls`
- `GET /api/admin/dashboard/live` (BIN-517)
- `GET /api/admin/halls/:id/game-config`
- `GET /api/admin/halls/:id/display-tokens` + `POST` + `DELETE` (BIN-503)
- `room:create` socket (reaches `requireActiveHall`)

**Most likely root cause.** One of the two column-adding migrations did not run on the staging DB:

- `apps/backend/migrations/20260418090000_add_hall_client_variant.sql` — adds `app_halls.client_variant` column
- `apps/backend/migrations/20260418140000_halls_tv_url.sql` — adds `app_halls.tv_url` column

`PlatformService.listHalls` and friends SELECT both columns, so a missing column produces the observed `42703 (undefined_column)` which the backend surfaces as `INTERNAL_ERROR` via the generic error middleware.

**Triage for Tobias (ordered, ~30 min):**

1. Render shell into the backend service: `render shell srv-d7bvpel8nd3s73fi7r4g`.
2. `psql $APP_PG_CONNECTION_STRING -c "\d app_halls"` — confirm the column list includes both `client_variant` and `tv_url`. If missing:
3. `npm --prefix apps/backend run migrate` from the shell (this invokes `node-pg-migrate` and is idempotent for already-applied migrations).
4. Re-run the rehearsal harness:
   ```bash
   STAGING_URL=https://spillorama-system.onrender.com \
   ADMIN_EMAIL=admin@spillorama.staging ADMIN_PASSWORD='StagingAdmin2026!' \
   TEST_USER_A_EMAIL=cutover-test1@spillorama.staging TEST_USER_A_PASSWORD='Staging2026Test!' \
   TEST_USER_B_EMAIL=cutover-test2@spillorama.staging TEST_USER_B_PASSWORD='Staging2026Test!' \
   HALL_SLUG=staging-hall-1 HALL_ID=hall-default \
   STEPS=3,5,7 \
   node apps/backend/scripts/staging-rehearsal.mjs
   ```
5. Paste the resulting log rows back into this table.

**Alternative cause to check if step 2 shows the columns present:** a type-coercion regression in `mapHall` (`apps/backend/src/platform/PlatformService.ts:1765` currently reads `client_variant ?? "unity"` which handles null, so columns-present + NULL should NOT crash; this is a lower-probability branch).

**Scope.** These blockers affect rehearsal steps 3, 5, 7 — all blocked on the same root cause. Re-running after fix should flip all three to pass without further code changes. **This is a pre-pilot blocker** — pilot F1 cannot start while admin-halls endpoints are 500 in prod/staging.

### Findings — S2: BIN-540 missing admin-setter endpoint

`/api/admin/halls/:id/client-variant` (PUT/POST) does **not** exist. BIN-540 shipped only the read path + DB column + the feature-flag reader cache. The intended admin flip mechanism from the rollback-runbook is a direct `UPDATE app_halls SET client_variant = 'web' WHERE slug = '<slug>'` via psql, which is operationally ugly and makes the admin-web UI's cutover claim misleading.

**Recommendation:** add a small `router.put("/api/admin/halls/:hallId/client-variant", ...)` in `apps/backend/src/routes/admin.ts` that accepts `{ clientVariant: "unity" | "web" | "unity-fallback" }`, writes via `PlatformService.updateHall` (needs to be extended to accept `clientVariant`), clears the read-through cache, and audit-logs the flip. Small PR, ~30 min. File as BIN-540 follow-up; blocks pilot F1 cutover via admin-web.

### Findings — S3: BIN-540 update-hall does not support `clientVariant` field

`PlatformService.updateHall` (line 871) whitelists `slug / name / region / address / organization_number / settlement_account / invoice_method / is_active` — `clientVariant` is not in the update path. The admin-web Halls-editor therefore cannot flip the flag even if an endpoint existed. Needs to go in with S2.

### Rehearsal-script

The autonomous harness used for rows above is committed at [`apps/backend/scripts/staging-rehearsal.mjs`](../../apps/backend/scripts/staging-rehearsal.mjs). Re-runnable against any deploy via env-vars (see script header for the full list). Designed to survive future runs — no hard-coded staging URLs or tokens.

Column semantics:

- **Event:** one of `rehearsal`, `cutover`, `rollback`, `post-mortem`.
- **Utfall:** `pass` / `fail` / `partial`. `partial` means completed but with a non-blocking anomaly worth recording.
- **Issues / refs:** Linear issue IDs, Sentry incident URLs, PR numbers. Never a bare "en feil oppstod".

Keep this log even after the pilot is done — F4 Unity-avkobling needs to point to the empty rollback column as evidence the rollout stayed clean.

---

## §8 Known gaps / follow-ups tracked outside this doc

These are accepted as non-blockers for the first pilot but must be resolved before F3 broad rollout:

- **Staging Grafana vs prod Grafana:** today the same dashboards are uploaded to both. Acceptable for F1; before F3 we need separate folders + access controls so a test on staging can't page prod on-call.
- **Alerting rules are provisioned manually** in Grafana UI, not as code. Track rule changes in the cutover issue-comment until the rule-DSL is stable enough to land in `infra/grafana/alerts/`.
- **Per-hall observability:** dashboards surface claim rate per hall via `$hall`, but connection-health + finance-gates are system-wide. If a specific hall has a sporadic issue we can't isolate it from dashboards alone — we fall back to log filtering by `hallId`.
- **No dropped-event counter** (`bingo_connection_dropped_total` suggested in the BIN-539 brief). The reconnect + rate-limit + stuck-room triplet is sufficient for F1 but add the counter before F3 to tighten detection.

---

## §9 Approval

Runbook is in effect when **all three signatures** are recorded here (date + name + Linear comment link):

- **Technical lead (Tobias Haugen)** — _pending_
- **Compliance** (Spillvett fail-closed tests verified per §4) — _pending_
- **Ops** (Grafana alert-routing confirmed per §1.Observability, on-call rotation posted) — _pending_

Unsigned sections don't invalidate the rest of the runbook, but an unsigned runbook means no hall can be cut over. If the runbook is amended in-place, bump "Last updated" at the top and note the change in the `#ops-cutover` channel.
