# Observability Evidence — goh-80-rerun-postfix-preflight

**Generated:** 2026-05-17T10:32:52.097Z
**Event window:** last 90 minutes
**Purpose:** Frozen Sentry/PostHog/pilot-monitor/DB snapshot for PM/live-test evidence.

## Files

- `2026-05-17T10-32-52-097Z-goh-80-rerun-postfix-preflight.md` — human-readable report
- `2026-05-17T10-32-52-097Z-goh-80-rerun-postfix-preflight.json` — machine-readable report

## PM Notes

- Secrets were read locally from `~/.spillorama-secrets/`; credentials are not stored here.
- Use the JSON file with `npm run observability:snapshot -- --compare <json>` for after-test diffs.
- Attach this directory to agent-contracts when the test result drives P0/P1 implementation work.
