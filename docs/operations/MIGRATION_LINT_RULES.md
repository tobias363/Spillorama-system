# Migration Lint Rules

**Owner:** Technical lead (Tobias Haugen)
**Status:** Active (OBS-9, etablert 2026-05-14)
**Last updated:** 2026-05-14
**Linked:**
- `scripts/squawk-check.sh` — implementation
- `.github/workflows/schema-as-code.yml` — CI integration
- `docs/operations/SCHEMA_AS_CODE_RUNBOOK.md` — runbook

This document is the rule catalog for the squawk-based migration linter. Each rule below has three states:

- **Blocking** — CI fails if it fires on a new/modified migration
- **Informational** — Findings shown in logs; no CI failure
- **Excluded** — Rule turned off entirely (with rationale)

The lists below mirror `scripts/squawk-check.sh` `SQUAWK_BLOCKING_RULES` and `SQUAWK_EXCLUDED_RULES`. **Always update both at once** — if they drift, CI behavior diverges from documentation, and the next on-call gets confused at 02:00.

---

## 1. Blocking rules (CI fails)

These rules represent failure modes that have caused (or would have caused) actual outages in pilot-scale databases. Squawk-cli 2.52.x emits everything at `Warning` level; we promote these to blocking via `SQUAWK_BLOCKING_RULES` in `squawk-check.sh`.

### 1.1 Schema-evolution killers

These break running clients the moment the migration commits.

| Rule | What it catches | Safe alternative |
|---|---|---|
| `renaming-column` | `ALTER TABLE foo RENAME COLUMN x TO y` | Add column `y`, dual-write in application code, backfill `y` from `x`, switch reads to `y`, drop `x`. 4-5 migrations + 1-2 app deploys. |
| `renaming-table` | `ALTER TABLE foo RENAME TO bar` | Create view `bar AS SELECT * FROM foo` first, switch reads to view, drop view + rename in a coordinated cutover. |
| `disallowed-unique-constraint` | `ALTER TABLE foo ADD CONSTRAINT foo_x_unique UNIQUE (x)` (inline, blocks writes) | Build a unique index `CONCURRENTLY` first, then `ALTER TABLE foo ADD CONSTRAINT foo_x_unique UNIQUE USING INDEX idx_foo_x_unique` (no lock). |
| `changing-column-type` | `ALTER TABLE foo ALTER COLUMN x TYPE varchar(120)` | Add new column `x_new`, backfill, swap, drop old. Type-changing in place rewrites the table under exclusive lock and can truncate data on narrowing changes. |
| `constraint-missing-not-valid` | `ALTER TABLE foo ADD CONSTRAINT … FOREIGN KEY (x) REFERENCES bar(id)` (no `NOT VALID`) | Use `ADD CONSTRAINT … NOT VALID` first (skips full-table scan), then `VALIDATE CONSTRAINT …` in a separate migration that's allowed to be slow. |

**Why blocking, not informational:** Each of these is a "deploy and instantly break customers" footgun. They have no safe single-migration form for tables with existing data + live readers.

### 1.2 Lock-amplifying patterns

These succeed eventually but hold heavy locks for the duration. On a multi-million-row table that's minutes-to-hours of downtime.

| Rule | What it catches | Safe alternative |
|---|---|---|
| `adding-required-field` | `ALTER TABLE foo ADD COLUMN x INT NOT NULL` (no default) | Add nullable (`ALTER TABLE foo ADD COLUMN x INT;`), backfill in batches, then `ALTER COLUMN SET NOT NULL` once data is clean. 3 migrations. |
| `adding-not-nullable-field` | Same as above — squawk separates by phrasing | Same fix. |
| `adding-field-with-default` | `ALTER TABLE foo ADD COLUMN x INT DEFAULT 0` on Postgres < 11. On Postgres 11+ this is metadata-only and instant, but squawk doesn't always know the target version. | If targeting PG 11+: tag the migration with `-- squawk: ignore adding-field-with-default` and a note. Otherwise: split into add-nullable / set-default / set-not-null. |
| `ban-create-index-non-concurrently` | `CREATE INDEX idx_foo ON huge_table (x)` | Use `CREATE INDEX CONCURRENTLY` and remove the surrounding transaction (CONCURRENTLY cannot run inside a transaction block). node-pg-migrate's `--no-transaction` flag in the migration file is the standard way. |
| `ban-char-field` | `CREATE TABLE foo (x CHAR(10))` or `ALTER … TYPE CHAR(n)` | Use `TEXT` (or `VARCHAR(n)` for legacy compat). `CHAR` pads with spaces and almost always surprises developers. |

**Why blocking, not informational:** These don't break clients immediately, but they convert "ship a feature" into "schedule a maintenance window" with no warning.

### 1.3 Idempotency / rerun-safety

| Rule | What it catches | Safe alternative |
|---|---|---|
| `prefer-robust-stmts` | `CREATE TABLE …`, `DROP TABLE …`, `CREATE INDEX …` without `IF EXISTS` / `IF NOT EXISTS` | Always include the `IF [NOT] EXISTS` clause. Required by ADR-0014 (idempotent migrations). |

**Why blocking, not informational:** ADR-0014 mandates idempotency for safe re-runs after a partial failure. node-pg-migrate doesn't add `IF EXISTS` automatically; the migration author must.

### 1.4 Time/clock footguns

| Rule | What it catches | Safe alternative |
|---|---|---|
| `disallowed-current-time` | `now()` in `DEFAULT` clause when the intent is per-row evaluation | Use `clock_timestamp()` if you want per-row. Stick with `now()` (or `CURRENT_TIMESTAMP`) only if you understand it evaluates once per statement and that's what you want. |

**Why blocking, not informational:** The subtle bug where every row in a batch gets the same `now()` value has corrupted compliance ledger entries before. Worth catching at lint-time.

---

## 2. Informational rules (logged but not blocking)

These appear in CI logs but don't fail the build. The intent is to surface them for code review without forcing a fix.

Common informational findings on Spillorama migrations:

| Rule | What it catches | Why not blocking |
|---|---|---|
| `prefer-bigint-over-int` | `INT` / `INTEGER` column types | Legacy migrations use `INT`. New migrations should prefer `BIGINT` for IDs, but `INT` is fine for low-cardinality fields. Reviewer decides. |
| `prefer-bigint-over-smallint` | `SMALLINT` column types | Same logic. |
| `prefer-identity` | `BIGSERIAL` vs `BIGINT GENERATED ALWAYS AS IDENTITY` | We use `BIGSERIAL` across the codebase for consistency. Switching to IDENTITY would require migrating all existing tables. Out of scope. |
| `adding-foreign-key-constraint` | Variant of `constraint-missing-not-valid` that fires even when NOT VALID is present | Squawk's heuristic isn't perfect; we suppress this in favor of the more-specific `constraint-missing-not-valid`. |
| `ban-drop-column` | `DROP COLUMN` | Sometimes correct (truly unused column). Reviewer decides + author should include an audit note in the migration comment. |
| `ban-drop-not-null` | `ALTER COLUMN x DROP NOT NULL` | Loosening constraints rarely breaks clients. Informational only. |
| `require-concurrent-index-deletion` | `DROP INDEX` without `CONCURRENTLY` | Less critical than create — drop is fast even on huge indexes. |

If a rule in this list bites you on a real outage, promote it to blocking (§5.3 below).

---

## 3. Excluded rules (turned off)

| Rule | Why excluded |
|---|---|
| `transaction-nesting` | node-pg-migrate wraps every migration in a transaction by default; nested `BEGIN`/`COMMIT` are sometimes legitimate (e.g. when migration uses `--no-transaction` for `CREATE INDEX CONCURRENTLY`). The rule fires on every such case. |
| `prefer-text-field` | We have legacy `VARCHAR(n)` columns we can't migrate today (would require coordinated app + DB change). New code should prefer `TEXT`, but the rule would noise on every follow-up patch to an existing legacy column. |
| `ban-drop-database` | node-pg-migrate cannot drop databases; rule is irrelevant. Noise reduction. |
| `require-timeout-settings` | node-pg-migrate handles `statement_timeout` and `lock_timeout` via the connection URL (`?options=`) or the `before_migrate` hook. Every single migration would fire this rule without it, and squawk's suggested fix (`SET lock_timeout = '1s';`) clashes with node-pg-migrate's transaction wrapper. |

If you need to re-enable an excluded rule for a specific migration, use an in-file annotation:

```sql
-- squawk: include transaction-nesting
-- rationale: this migration intentionally controls its own transaction
BEGIN;
…
COMMIT;
```

---

## 4. Why we don't lint deletions

`scripts/squawk-check.sh` filters `git diff --diff-filter=AM` — only **Added** or **Modified** files. Deleted migrations are skipped. Reasons:

1. **A deleted file in the repo is never re-applied to a live DB.** node-pg-migrate tracks already-run migrations in `pgmigrations`; deleting the file from the repo doesn't undeploy it.
2. **Deletion patterns are usually safe:** the migration was already run in prod, the file is just cleanup. Linting it again would emit findings we've already lived with.
3. **The interesting case — "a migration was deleted to hide a botched change" — is caught by `schema-ci.yml`**, which diffs the *resulting schema* not the migration files. If you delete a migration that the baseline depends on, the shadow-replay diff fires.

If you ever need to lint a deletion (e.g. to confirm what *would* have fired), use `--all` mode:

```bash
npm run schema:lint:all
```

---

## 5. Process for changing this catalog

### 5.1 Adding a new blocking rule

Trigger: a real outage caused by a pattern that squawk would have flagged.

1. Identify the squawk rule from https://squawkhq.com/docs/rules.
2. Add it to `SQUAWK_BLOCKING_RULES` in `scripts/squawk-check.sh`.
3. Add a row to §1 of this document. Include:
   - Pattern that triggers it
   - Safe alternative
   - "Why blocking" line — usually a link to the incident postmortem.
4. Run `npm run schema:lint:all` locally. Any legacy migrations that fire?
   - Yes → annotate them with `-- squawk: ignore <rule>` and an audit note.
   - No → great, no migration churn needed.
5. Open a PR. CI will validate.

### 5.2 Promoting from informational to blocking

Same process as 5.1. Make sure to scan `npm run schema:lint:all` output for legacy migrations that would suddenly fail.

### 5.3 Removing a rule from blocking

Trigger: rule produces too many false positives, or has been superseded by a more-specific rule.

1. Move it from `SQUAWK_BLOCKING_RULES` to §2 of this doc (informational).
2. Add a comment in `squawk-check.sh` explaining why.
3. Open a PR with the rationale.

### 5.4 Excluding a rule entirely

Last resort — only when the rule is fundamentally incompatible with our migration runner.

1. Add to `SQUAWK_EXCLUDED_RULES` in `squawk-check.sh`.
2. Add a row to §3 of this doc with rationale.
3. Open a PR.

---

## 6. Per-migration overrides

Sometimes a migration must fire a blocking rule. The in-file annotation lets you do that without weakening the gate globally:

```sql
-- File: apps/backend/migrations/20260601000001_cleanup_legacy_users.sql

-- squawk: ignore ban-drop-column
-- audit: column 'legacy_session_token' has had zero reads in 90 days
-- audit: 'rg user' across apps/backend, packages/* found no references
-- audit: incident report DR-2026-05-12 confirmed safe to drop
ALTER TABLE app_users DROP COLUMN IF EXISTS legacy_session_token;
```

`scripts/squawk-check.sh` reads the annotation and excludes the named rule for that specific file. The annotation must appear in the first 20 lines of the file.

Multiple rules per file:

```sql
-- squawk: ignore renaming-column
-- squawk: ignore adding-required-field
```

**The annotation is reviewable.** If you see one in a PR, scrutinize the audit rationale — and reject the PR if it's empty or hand-wavy. The gate is only as strong as the discipline around its overrides.

---

## 7. Quick reference

```bash
# Lint changed migrations vs origin/main:
npm run schema:lint

# Lint every migration (audit mode):
npm run schema:lint:all

# Lint a specific file:
bash scripts/squawk-check.sh apps/backend/migrations/<file>.sql

# Snapshot live schema for drift analysis:
bash scripts/atlas-snapshot.sh --env local \
  --url postgresql://...

# Run Atlas lint locally (requires Postgres on :5432):
atlas migrate lint \
  --dir 'file://apps/backend/migrations?format=golang-migrate' \
  --dev-url 'postgres://atlas:atlas@localhost:5432/atlas?sslmode=disable' \
  --latest 5
```

---

## 8. References

- Squawk rules catalog: https://squawkhq.com/docs/rules
- Atlas lint diagnostics: https://atlasgo.io/lint/analyzers
- ADR-0014: Idempotent migrations (in-repo)
- `docs/audit/SCHEMA_DIVERGENCE_AUDIT_2026-04-29.md` — original ghost-migration incident that motivated the schema-CI gate
- `docs/operations/SCHEMA_CI_RUNBOOK.md` — sister gate (shadow-replay)
- `docs/operations/MIGRATION_DEPLOY_RUNBOOK.md` — how migrations actually deploy via render.yaml
