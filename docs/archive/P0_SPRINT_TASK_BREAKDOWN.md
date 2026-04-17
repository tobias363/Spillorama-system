# P0 Execution and Sprint Task Breakdown (BG-001 to BG-028)

Date: 2026-03-04
Scope decision: Run `P0` first. `P1` is deferred until after pilot unless explicitly pulled in.

## 1. Scope Lock

## In scope now (`P0`)

- `BG-001` `BG-002` `BG-003` `BG-004`
- `BG-005` `BG-006` `BG-007` `BG-008` `BG-009`
- `BG-010` `BG-011` `BG-012` `BG-013` `BG-014`
- `BG-015` `BG-017`
- `BG-018` `BG-019` `BG-021`
- `BG-026` `BG-027` `BG-028`

## Deferred (`P1`, after pilot unless needed)

- `BG-016` `BG-020` `BG-022` `BG-023` `BG-024` `BG-025`

## 2. Team Roles for Planning

- `BE-1`: backend/game rules/auth
- `BE-2`: data model/reporting/ledger
- `CL-1`: Unity client integration
- `QA-1`: compliance test design + regression

## 3. Story-by-Story Technical Breakdown

Each story has: technical tasks, owner, target sprint.

1. `BG-001` (`P0`, Sprint 1, Owner `BE-1`)
- Add auth guard middleware for all gameplay socket events.
- Remove trust in client-provided `playerName`/`walletId` for gameplay identity.
- Bind socket session to authenticated user id + hall context.
- Add negative tests for anonymous/expired token flows.

2. `BG-002` (`P0`, Sprint 1, Owner `BE-2`)
- Add DB tables: `halls`, `terminals`, `hall_game_config`.
- Add seed/migration scripts and environment defaults.
- Add backend domain types and repository layer.
- Add admin endpoints to list/create/update hall and terminal metadata.

3. `BG-003` (`P0`, Sprint 2, Owner `BE-1`)
- Add KYC provider interface (`verifyIdentity`, `verifyAge`).
- Add identity verification status on user profile.
- Enforce age >= 18 before gameplay access.
- Add audit event for verification pass/fail.

4. `BG-004` (`P0`, Sprint 1, Owner `BE-2`)
- Add hall selection and session binding in auth/session service.
- Require `hall_id` for room creation/join.
- Enforce one active electronic game per player according to hall/game type.
- Add reconnect logic preserving hall binding.

5. `BG-005` (`P0`, Sprint 2, Owner `BE-2`)
- Build loss calculation ledger per player/hall/day/month.
- Add transaction classifier for stake/payout/loss events.
- Add query helpers for remaining daily/monthly allowance.
- Add test fixtures for day/month boundary behavior.

6. `BG-006` (`P0`, Sprint 2, Owner `BE-1`)
- Enforce hard cap checks before any new stake.
- Return explicit error codes with remaining limits.
- Add guard rails on both API and socket gameplay paths.
- Add tests for exact-edge and over-limit attempts.

7. `BG-007` (`P0`, Sprint 2, Owner `BE-1`)
- Add player-set daily/monthly personal limits.
- Ensure personal limits cannot exceed hard limits.
- Add effective-dating for limit increase policy.
- Add client payload contracts and validation.

8. `BG-008` (`P0`, Sprint 2, Owner `BE-1`)
- Track continuous session play duration across rounds.
- Trigger mandatory 5-minute cooldown after 60 minutes.
- Block gameplay start while cooldown active.
- Emit user activity/loss summary payload at break trigger.

9. `BG-009` (`P0`, Sprint 2, Owner `BE-2`)
- Add self-exclusion + timed pause tables and APIs.
- Enforce non-cancellable timed pause.
- Enforce minimum 1-year self-exclusion period.
- Check exclusion status in all gameplay gates.

10. `BG-010` (`P0`, Sprint 1, Owners `BE-1` + `CL-1`)
- Backend: disable auto-start/auto-draw by production profile.
- Unity: disable auto-spin in production build flags.
- Add startup checks to fail if unsafe config is enabled in prod.
- Add smoke tests for manual-only flow.

11. `BG-011` (`P0`, Sprint 1, Owner `BE-1`)
- Add per hall/game sequence timer state.
- Enforce >= 30s from sequence start to next start for databingo.
- Emit audit event for blocked early start.
- Add timing tests with deterministic clock.

12. `BG-012` (`P0`, Sprint 1, Owner `BE-1`)
- Keep existing 1-5 enforcement and add policy tests.
- Add hall config validation to avoid >5 in runtime settings.
- Add explicit compliance error message in API/socket responses.

13. `BG-013` (`P0`, Sprint 2, Owner `BE-1`)
- Enforce one active databingo session per player.
- Cover multi-device/reconnect race conditions.
- Add idempotent start/join semantics for transient retries.

14. `BG-014` (`P0`, Sprint 2, Owner `CL-1`)
- Remove/disable any extra-draw purchase UI/actions in client.
- Add server-side validation to reject extra draw attempts always.
- Add telemetry for attempted forbidden action.

15. `BG-015` (`P0`, Sprint 3, Owner `BE-2`)
- Add prize policy engine by `game_type`, `hall`, `link`, effective date.
- Enforce databingo caps: 2500 single prize, 12000 extra prize/day/link.
- Reject payout calculations violating policy.
- Add policy version to payout event.

16. `BG-016` (`P1`, Deferred, Owner `BE-2`)
- Add simultaneous-winner payout mode config.
- Implement split/full payout mode with idempotent payout keys.
- Add concurrency tests for same-claim timestamp scenarios.

17. `BG-017` (`P0`, Sprint 3, Owner `BE-1`)
- Add immutable payout audit log entries.
- Include claim id, game id, hall id, policy version, tx ids.
- Add tamper detection checksum/hash chain field.

18. `BG-018` (`P0`, Sprint 3, Owner `BE-2`)
- Separate ledger dimensions: hall main game, internet main game, databingo.
- Add accounting view tables/materialized views for compliance reports.
- Validate no blending between channels in queries.

19. `BG-019` (`P0`, Sprint 3, Owner `BE-2`)
- Build daily report job and manual trigger endpoint.
- Export CSV + JSON bundles per hall/game/channel.
- Add checks for completeness and reconciliation totals.

20. `BG-020` (`P1`, Deferred, Owner `BE-2`)
- Add quarter/half-year export templates and scheduler.
- Add regulator submission package structure.

21. `BG-021` (`P0`, Sprint 3, Owner `BE-2`)
- Add overskudd distribution calculator.
- Enforce min distribution: 15% main game, 30% databingo.
- Post payout transfers with accounting batch id.
- Add reconciliation report per organization.

22. `BG-022` (`P1`, Deferred, Owner `BE-1`)
- Add role matrix and endpoint policy map.
- Enforce admin/operator/support permissions.

23. `BG-023` (`P1`, Deferred, Owner `BE-1`)
- Add append-only audit stream for critical events.
- Add query API with filters and retention policy.

24. `BG-024` (`P1`, Deferred, Owner `BE-1`)
- Add metrics and alerts for limit and payout failures.
- Add dashboard and on-call alert routing.

25. `BG-025` (`P1`, Deferred, Owner `BE-2`)
- Add backup restore script and runbook.
- Run at least one verified restore drill.

26. `BG-026` (`P0`, Sprint 3, Owner `QA-1` + `BE-1`)
- Implement compliance E2E + integration suite.
- Cover: limits, pause, exclusion, 30s rule, ticket cap, prize caps.
- Add CI gate requiring all compliance tests green.

27. `BG-027` (`P0`, Sprint 3, Owner `QA-1`)
- Create hall pilot runbook and rollback checklist.
- Add support procedures and incident escalation flow.

28. `BG-028` (`P0`, Sprint 4, Owner `QA-1` + `BE-1`)
- Build rollout playbook for 1 -> 3 -> 20 halls.
- Define go/no-go gates and rollback criteria per wave.

## 4. Sprint 1 Assignment (Week 1-2)

Goal: Compliance foundation ready.

## `BE-1` (10 days)

- `BG-001`: socket auth enforcement and token-only identity.
- `BG-010` (backend part): disable unsafe auto modes in prod.
- `BG-011`: 30s databingo sequence guard.
- `BG-012`: tests and hard validation for 5-ticket max.

## `BE-2` (10 days)

- `BG-002`: hall/terminal schema + repos + admin APIs.
- `BG-004`: session hall binding and join/start constraints.
- Support `BE-1` with migration and compatibility patching.

## `CL-1` (10 days)

- `BG-010` (client part): remove/disable auto-spin for prod.
- Update Unity auth/session flow to rely on access token.
- Add hall selection input/wiring in realtime flow.
- Remove any fallback that can start gameplay anonymously.

## `QA-1` (6-8 days)

- Build Sprint 1 test matrix for `BG-001/002/004/010/011/012`.
- Add test scripts for token expiry, reconnect, and 30s timing edge cases.
- Define compliance evidence artifacts needed per story.

## 5. Sprint 1 Day-by-Day Execution (Suggested)

1. Day 1-2: `BG-001` skeleton + `BG-002` schema draft + QA matrix baseline
2. Day 3-4: `BG-004` session hall binding + Unity token flow update
3. Day 5-6: `BG-010` backend/client production guardrails
4. Day 7-8: `BG-011` timer enforcement + `BG-012` validation tests
5. Day 9-10: integration hardening, bugfix pass, Sprint 1 sign-off

## 6. Sprint 1 Exit Criteria

- Anonymous gameplay is impossible.
- All gameplay actions are hall-bound.
- Auto-play paths are blocked in production mode.
- Databingo 30s guard is enforced server-side.
- Ticket cap 1-5 is validated with automated tests.

## 7. Fast Track to Shorter Timeline

If you want minimum calendar time:

1. Freeze non-compliance features until pilot.
2. Run daily integration test pass from Day 3 in each sprint.
3. Keep DB migrations forward-only and small per story.
4. Use feature flags per hall for staged rollout.
5. Lock scope to `P0` until pilot sign-off is done.
