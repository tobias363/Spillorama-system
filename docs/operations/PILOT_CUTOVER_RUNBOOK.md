# Pilot cutover runbook — Unity → web hall-for-hall

**Linear:** [BIN-525 (Legacy-avkobling)](https://linear.app/bingosystem/project/legacy-avkobling-game-1-5-backend-paritet-a973e623234a) · [BIN-540 (feature-flag)](https://linear.app/bingosystem/issue/BIN-540) · [BIN-532 (Unity rollback)](https://linear.app/bingosystem/issue/BIN-532)
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
- [`UNITY_BUILD_RUNBOOK.md`](./UNITY_BUILD_RUNBOOK.md) — BIN-532 how to cut a rollback bundle on demand.
- [`OBSERVABILITY_RUNBOOK.md`](./OBSERVABILITY_RUNBOOK.md) — BIN-539 what signal to watch, what the thresholds mean.
- [`../compliance/RELEASE_GATE.md`](../compliance/RELEASE_GATE.md) §7 — pre-pilot acceptance checklist; this runbook satisfies parts of it.

---

## §1 Forutsetninger (pre-flight checklist)

**Do not flip a hall unless every box is ticked.** Copy the checklist into the cutover issue comment with ticked boxes as evidence — leaves a trail for compliance.

### Code + CI
- [ ] All PRs in the [Legacy-avkobling project](https://linear.app/bingosystem/project/legacy-avkobling-game-1-5-backend-paritet-a973e623234a) that this pilot depends on are merged to `main`.
- [ ] `PARITY_MATRIX.md` §2.3 shows **Observability ✅**, **Feature-flag rollback-runbook ✅**, **Unity rollback-bundle CI 🟡 or ✅** (bundle exists — see §1.Unity below), **E2E pengeflyt-test ✅**, **Wire-kontrakt-test ✅**.
- [ ] Latest nightly CI green: `compliance-gate.yml` + the Artillery load-test job for BIN-508.
- [ ] Branch-protection on `main` shows `compliance` as a required status check (one-time toggle — see `RELEASE_GATE.md` §3).

### Unity rollback
- [ ] `UNITY_LICENSE` (and `UNITY_EMAIL`/`UNITY_PASSWORD` or `UNITY_SERIAL`) set in GitHub Actions repo secrets.
- [ ] At least one successful run of `.github/workflows/unity-build.yml` via `workflow_dispatch` in the last 14 days — the artefact must exist and be downloadable. Record the run URL in §7.
- [ ] That artefact pre-staged on the CDN (or Render static host) at the Unity client path per `UNITY_BUILD_RUNBOOK.md` §4. This is the rollback-insurance — the flag flip is useless if no bundle is serving.

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

**Trigger:** any "roll back" row in §2 step 6, OR any single request from the hall-admin that sounds like "this isn't working". The flag exists precisely so rollback is cheap — err on the side of flipping it back.

**Target duration:** < 5 min end-to-end. After the second successful drill, target < 2 min.

### Step-by-step

1. **Announce in `#ops-cutover`:** `Rolling back hall <slug>. Trigger: <one-line reason>. Starting now.` Start a wall-clock timer.

2. **Flip the flag** via admin-web → Halls → *Client variant* → `unity-fallback` → Save. (Use `unity-fallback` not `unity` for the first rollback so the rollback is attributable in logs; we can set it to plain `unity` after the post-mortem.)

3. **Invalidate CDN cache** — same command as §2 step 3, plus: if the Unity bundle lives on a different path (`/web/games/unity/`), also purge that. See `UNITY_BUILD_RUNBOOK.md` §4 for the exact paths.

4. **Tell the hall-admin** to refresh the TV and ask players to reopen the app. Their next session lands on the Unity client.

5. **Watch the dashboards for 5 min.** Expect: reconnect-rate spike (clients are reconnecting across the swap — harmless), then drop back to baseline; claim rate resumes at pre-cutover level.

6. **Log the rollback** — post the timer result + a one-paragraph cause in §7 and in the associated Linear issue. Create a sub-issue under BIN-525 if the root cause isn't already tracked.

7. **Post-incident debrief** within 24 h. The pilot cannot move to the next hall until the root cause of this rollback is understood and either fixed or consciously accepted.

### What if the rollback itself fails?

The flag is bi-directional by design. If flipping back to `unity-fallback` doesn't help (e.g. the Unity bundle is stale or the flag system itself is wedged):

1. **Page technical lead (Tobias)** immediately — don't try more fixes alone.
2. If the admin-web is unreachable, update the DB directly: `UPDATE app_halls SET client_variant = 'unity-fallback' WHERE slug = '<slug>';`. Known safe because BIN-540's fail-closed default is `unity`.
3. If the Unity bundle is missing at the CDN path, re-trigger `unity-build.yml` via `workflow_dispatch` and re-upload per `UNITY_BUILD_RUNBOOK.md` §4. This is the second-order rollback; target < 30 min.
4. Worst case: disable the hall entirely by setting `is_active = false` via admin-web. Players see a "hall lukket" screen. Use this only if both clients are broken for the hall.

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
| _(første rehearsal fylles inn av operatør)_ | staging | STAGING_HALL_1 | Rehearsal §4 + §5 + dry-run av §2 | | | | | |

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
