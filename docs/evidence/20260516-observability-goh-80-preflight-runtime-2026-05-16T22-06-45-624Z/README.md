# Observability Evidence — goh-80-preflight-runtime

**Generated:** 2026-05-16T22:06:45.624Z
**Event window:** last 30 minutes
**Purpose:** Frozen Sentry/PostHog/pilot-monitor/DB snapshot for PM/live-test evidence.

## Files

- `2026-05-16T22-06-45-624Z-goh-80-preflight-runtime.md` — human-readable report
- `2026-05-16T22-06-45-624Z-goh-80-preflight-runtime.json` — machine-readable report

## PM Notes

- Secrets were read locally from `~/.spillorama-secrets/`; credentials are not stored here.
- Use the JSON file with `npm run observability:snapshot -- --compare <json>` for after-test diffs.
- Attach this directory to agent-contracts when the test result drives P0/P1 implementation work.
