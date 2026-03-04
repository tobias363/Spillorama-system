# Sprint 1 Taskboard (Week 1-2)

Date: 2026-03-04
Sprint goal: compliance foundation (`P0`) ready for integration.

## Board Rules

1. WIP limit per owner: 2 tasks
2. No new scope before Sprint 1 exit criteria are met
3. A task is `Done` only if code, tests, and acceptance checks are complete

## To Do

1. `S1-001` (`BE-1`) - `BG-001` enforce authenticated token on gameplay socket events
2. `S1-002` (`BE-2`) - `BG-002` create `halls`, `terminals`, `hall_game_config` schema + migrations
3. `S1-003` (`BE-2`) - `BG-002` add admin APIs for hall/terminal config
4. `S1-004` (`BE-2`) - `BG-004` bind user session to selected hall
5. `S1-005` (`CL-1`) - `BG-010` disable Unity autoplay in production profile
6. `S1-006` (`CL-1`) - `BG-001` token-only client gameplay flow
7. `S1-007` (`BE-1`) - `BG-010` disable backend auto-start/auto-draw in production profile
8. `S1-008` (`BE-1`) - `BG-011` enforce 30s minimum databingo sequence interval
9. `S1-009` (`BE-1`) - `BG-012` ticket cap hard validation and compliance error responses
10. `S1-010` (`QA-1`) - test matrix for `BG-001`, `BG-002`, `BG-004`, `BG-010`, `BG-011`, `BG-012`
11. `S1-011` (`QA-1`) - auth expiry/reconnect/timer edge-case regression scripts
12. `S1-012` (`ALL`) - integration and bugfix pass for Sprint 1 scope

## In Progress

1. None at sprint start

## Done

1. None at sprint start

## Day-by-Day Plan

1. Day 1
- `S1-001` start
- `S1-002` start
- `S1-010` start

2. Day 2
- continue `S1-001`, `S1-002`, `S1-010`
- start `S1-005`

3. Day 3
- start `S1-003`
- start `S1-004`
- start `S1-006`

4. Day 4
- complete `S1-003` and `S1-004`
- continue `S1-006`
- start `S1-007`

5. Day 5
- complete `S1-005`, `S1-006`, `S1-007`
- start `S1-008`

6. Day 6
- continue `S1-008`
- start `S1-009`
- start `S1-011`

7. Day 7
- complete `S1-008` and `S1-009`
- continue `S1-011`

8. Day 8
- merge stabilization and integration test run
- start `S1-012`

9. Day 9
- continue `S1-012`
- fix defects from QA regression

10. Day 10
- Sprint 1 exit validation
- release candidate build for Sprint 2 kickoff

## Sprint 1 Exit Criteria

1. Anonymous gameplay is blocked on all gameplay socket events
2. Hall context is mandatory for gameplay start/join
3. Production autoplay paths are blocked in backend and Unity
4. Databingo 30-second interval is enforced and tested
5. Ticket cap 1-5 validation is enforced and tested
6. Compliance test matrix for Sprint 1 scope is green
