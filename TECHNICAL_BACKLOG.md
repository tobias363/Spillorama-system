# Technical Backlog - Bingo Compliance and Delivery

Date: 2026-03-04
Owner: Product + Tech Lead
Scope: Replace legacy bingo system with compliant platform for 20 halls in Norway.

Detailed execution breakdown:
- See `P0_SPRINT_TASK_BREAKDOWN.md` for story-by-story tasks (`BG-001` to `BG-028`) and Sprint 1 role assignment.
- See `TEAM_ROLE_ASSIGNMENT.md` for role ownership.
- See `SPRINT1_TASKBOARD.md` for Sprint 1 day-plan and board.
- See `BG_001_028_IMPORT.csv` for Jira/Linear import.

## 1. Assumptions

- Team: 3 full-time developers (backend, client, full-stack), 1 QA (50-100%), 1 ops/devops (25-50%).
- Existing stack in use: TypeScript backend, Unity client (`Spillorama`), Postgres wallet adapter.
- Compliance target: "go-live ready for controlled pilot", then staged rollout to all halls.
- This backlog prioritizes legal/compliance-critical features before UX enhancements.

## 2. Delivery Milestones

1. M0 - Compliance foundation complete (week 2)
2. M1 - End-to-end compliant gameplay in test (week 4)
3. M2 - Pilot hall ready (week 6)
4. M3 - 3-hall rollout (week 8)
5. M4 - 20-hall rollout (week 10-12, depending on ops readiness)

## 3. Priority Scale

- `P0` = blocking compliance or legal risk
- `P1` = required for controlled production
- `P2` = important but can follow after pilot

## 4. Epic Backlog

## EPIC A - Identity, Registration, and Hall Model (`P0`)

Goal: enforce registered play per hall and remove anonymous gameplay.

### Stories

1. `BG-001` - Require authenticated token for all gameplay socket events (`P0`, 2d)
Acceptance:
- `room:create`, `room:join`, `game:start`, `ticket:mark`, `claim:submit` reject anonymous users.
- Server derives player identity from token, not client-provided wallet/name.

2. `BG-002` - Add domain model for hall and terminal (`P0`, 3d)
Acceptance:
- New entities: `hall`, `terminal`, `hall_game_config`.
- Every session and game tied to exactly one `hall_id` and optional `terminal_id`.

3. `BG-003` - Player registration/KYC integration boundary (`P0`, 3d)
Acceptance:
- Provider interface for eID verification and age check.
- Block users under 18 from gameplay.
- Persist verification timestamp and status.

4. `BG-004` - Session + hall binding (`P0`, 2d)
Acceptance:
- Player must choose/enter hall context before gameplay.
- Same player can be active in only one active electronic game per hall/game-type constraints.

Dependencies: none. Critical path starter epic.

## EPIC B - Responsible Gambling Controls (`P0`)

Goal: implement hard protections for losses, pause, and self-exclusion.

### Stories

1. `BG-005` - Loss ledger and counters per player per hall (`P0`, 3d)
Acceptance:
- Maintain net loss counters by day and month.
- Include both local hall and internet-connected play tied to hall.

2. `BG-006` - Enforce hard limits 900/day and 4400/month (`P0`, 2d)
Acceptance:
- Any stake above remaining limit is rejected.
- Clear error payload returned to client.

3. `BG-007` - Personal limit settings inside hard cap (`P0`, 2d)
Acceptance:
- Player can set stricter daily/monthly limits.
- Decrease effective immediately, increase follows policy-defined delay.

4. `BG-008` - Mandatory break: 5 minutes after 1 hour (`P0`, 3d)
Acceptance:
- Track continuous play duration across game rounds.
- Hard-block new rounds during cooldown.
- Display activity/loss summary at break trigger.

5. `BG-009` - Self-exclusion and timed pause (`P0`, 3d)
Acceptance:
- Timed pause cannot be cancelled early.
- Self-exclusion cannot be removed before 1 year.
- Exclusion status checked on every gameplay action.

Dependencies: Epic A.

## EPIC C - Core Game Rule Compliance (`P0`)

Goal: ensure gameplay flow matches databingo and electronic rules.

### Stories

1. `BG-010` - Remove autoplay and autoscheduler in production mode (`P0`, 2d)
Acceptance:
- Backend auto-start/auto-draw disabled by production config guard.
- Unity auto-spin disabled in production build profile.

2. `BG-011` - Enforce min 30 seconds between databingo sequences (`P0`, 2d)
Acceptance:
- Server gate per hall/game-type enforces interval.
- Attempted early start rejected and logged.

3. `BG-012` - Enforce max 5 databingo tickets (`P0`, 1d)
Acceptance:
- Already enforced server-side; add test coverage and hall-specific config checks.

4. `BG-013` - Enforce one active databingo per player (`P0`, 2d)
Acceptance:
- Server blocks joining/starting second active databingo session.
- Works across reconnect and multi-client scenarios.

5. `BG-014` - Block extra draw purchases (`P0`, 1d)
Acceptance:
- No API/client path for extra draws in databingo.
- Explicit validation and event audit for denied attempts.

Dependencies: Epic A.

## EPIC D - Prize, Payout, and Economic Compliance (`P0`)

Goal: enforce prize caps and provable payout correctness.

### Stories

1. `BG-015` - Prize policy engine by game type (`P0`, 3d)
Acceptance:
- Databingo max single prize 2500.
- Databingo extra prize max 12000/day/link.
- Rules configurable per hall/link with effective date.

2. `BG-016` - Correct simultaneous winner handling (`P1`, 2d)
Acceptance:
- Split/full payout behavior configurable for game mode.
- Deterministic payout idempotency keys prevent duplicate credits.

3. `BG-017` - Payout audit trail (`P0`, 2d)
Acceptance:
- Every payout has immutable audit event with claim, game, hall, policy version.

Dependencies: Epic A, C.

## EPIC E - Reporting, Accounting, and Overskudd (`P0`)

Goal: satisfy daily reporting and separation of accounting lines.

### Stories

1. `BG-018` - Separate ledgers for main hall game, internet main game, databingo (`P0`, 4d)
Acceptance:
- Report dimensions include `hall_id`, `game_type`, `channel`.
- No blended totals in compliance outputs.

2. `BG-019` - Daily report generation (`P0`, 3d)
Acceptance:
- Daily gross turnover, prizes, net, counts by hall and game type.
- Export in CSV + JSON.

3. `BG-020` - Quarterly/half-year compliance export (`P1`, 3d)
Acceptance:
- Scheduled report artifacts ready for regulator submissions.

4. `BG-021` - Overskudd distribution engine (`P0`, 3d)
Acceptance:
- Main game min 15% to organizations.
- Databingo min 30% to organizations.
- Transfer records linked to accounting batch and organization account.

Dependencies: Epic A, D.

## EPIC F - Security, Internal Control, and Operations (`P1`)

Goal: make the platform auditable and operable in production.

### Stories

1. `BG-022` - RBAC and admin boundaries (`P1`, 2d)
Acceptance:
- Roles: admin, hall-operator, support, player.
- Sensitive endpoints restricted and tested.

2. `BG-023` - Immutable audit event stream (`P1`, 3d)
Acceptance:
- Append-only audit log for auth, gameplay, limits, payouts, config changes.
- Query by player, hall, time range, event type.

3. `BG-024` - Monitoring and alerting (`P1`, 2d)
Acceptance:
- Alerts on failed limit checks, payout errors, reconnect spikes, scheduler misuse.

4. `BG-025` - Backup and restore drill (`P1`, 2d)
Acceptance:
- Documented restore test with RPO/RTO targets.

Dependencies: all production epics.

## EPIC G - Testing and Release (`P0`)

Goal: prove behavior and reduce rollout risk.

### Stories

1. `BG-026` - Compliance test suite (`P0`, 4d)
Acceptance:
- Automated tests for limits, pause, exclusion, ticket count, interval, prize caps.

2. `BG-027` - Hall pilot runbook (`P0`, 2d)
Acceptance:
- Preflight checklist, rollback steps, support contact chain.

3. `BG-028` - Rollout plan 1 -> 3 -> 20 halls (`P0`, 2d)
Acceptance:
- Explicit go/no-go criteria per rollout wave.

Dependencies: all P0 stories above.

## 5. Sprint Plan (Aggressive but Realistic)

## Sprint 1 (Week 1-2)

- `BG-001` `BG-002` `BG-004` `BG-010` `BG-011` `BG-012`
- Outcome: no anonymous gameplay, hall-bound model live, autoplay removed, 30s and ticket controls in place.

## Sprint 2 (Week 3-4)

- `BG-005` `BG-006` `BG-007` `BG-008` `BG-009` `BG-013` `BG-014`
- Outcome: responsible gambling engine complete for enforcement.

## Sprint 3 (Week 5-6)

- `BG-015` `BG-017` `BG-018` `BG-019` `BG-021` `BG-026` `BG-027`
- Outcome: payout + reporting + compliance tests ready for pilot.

## Sprint 4 (Week 7-8)

- `BG-016` `BG-020` `BG-022` `BG-023` `BG-024` `BG-028`
- Outcome: hardening, controls, rollout to first 3 halls.

## Sprint 5-6 (Week 9-12)

- Stabilization, performance tuning, hall onboarding, audit documentation, 20-hall rollout.

## 6. Critical Path

1. Auth/token-only gameplay (`BG-001`)
2. Hall/terminal model (`BG-002`)
3. Loss + pause + exclusion enforcement (`BG-005..BG-009`)
4. Remove autoplay and enforce timing (`BG-010..BG-011`)
5. Prize caps and payout policy (`BG-015`)
6. Daily and separated reporting (`BG-018..BG-019`)

If any critical path item slips, pilot date slips.

## 7. Effort Summary

- P0 stories: ~43 dev-days
- P1 stories: ~14 dev-days
- Total: ~57 dev-days + QA + rollout overhead

Practical timeline:
- 3 devs full focus: 6-8 weeks to pilot, 10-12 weeks to all 20 halls.
- 2 devs or split focus: 10-14 weeks.

## 8. Scope Cuts if Deadline is Tight

Can postpone (after pilot):
- advanced operator dashboards
- non-critical UX polish
- multi-link optimization features

Cannot postpone:
- auth enforcement
- hall-bound loss limits/pause/exclusion
- autoplay removal
- timing/ticket constraints
- prize cap enforcement
- separated daily reporting

## 9. Definition of Done (Compliance Stories)

- requirement mapped to exact law paragraph in ticket description
- automated test added and passing
- audit event emitted
- negative-path test included (blocked behavior)
- feature flag and rollout plan documented
