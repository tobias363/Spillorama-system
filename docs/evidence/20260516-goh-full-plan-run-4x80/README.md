# GoH Full Plan Run 4x80 Evidence — 2026-05-16

- Runner markdown: `goh-full-plan-run-4x80-20260516T2208.md`
- Runner JSON: `goh-full-plan-run-4x80-20260516T2208.json`
- Preflight runtime snapshot: `../20260516-observability-goh-80-preflight-runtime-2026-05-16T22-06-45-624Z/`
- Midrun snapshot: `../20260516-observability-goh-80-midrun-2026-05-16T22-28-30-479Z/`
- Postrun snapshot: `../20260516-observability-goh-80-postrun-2026-05-16T22-48-56-853Z/`

Summary: 4 halls x 80 players, all 13 plan games completed, 4160 purchases, 11960 ticket assignments, 0 join/purchase/ready hard failures.

Key findings:
- Pilot-monitor recorded 0 P0/P1 during the filtered run window.
- Sentry/PostHog API snapshots were active outside the runner process; postrun comparison found new/increased backend N+1 Query issues on master advance/resume.
- `ticket:mark` still failed with `GAME_NOT_RUNNING` during scheduled Spill 1 despite server-side round completion: 164495 mark failures, 0 mark acks.
- Runner now uses dynamic expected ticket assignments, so `--players-per-hall=80` expects 230 assignments per hall and 920 per round.

Human report: `../../operations/GOH_FULL_PLAN_4X80_TEST_RESULT_2026-05-16.md`
