# Schema-as-Code Runbook (Atlas + squawk)

**Owner:** Technical lead (Tobias Haugen)
**Status:** Active (OBS-9, etablert 2026-05-14)
**Last updated:** 2026-05-14
**Linked:**
- `.github/workflows/schema-as-code.yml`
- `atlas.hcl`
- `scripts/squawk-check.sh`
- `scripts/atlas-snapshot.sh`
- `docs/operations/MIGRATION_LINT_RULES.md` — squawk rule catalog
- `docs/operations/SCHEMA_CI_RUNBOOK.md` — sister gate (shadow-replay)
- `docs/operations/MIGRATION_DEPLOY_RUNBOOK.md` — render deploy flow

This runbook covers the **Atlas + squawk** schema-as-code gate that runs in addition to `schema-ci.yml` (the shadow-replay gate). Read this if a Schema-as-Code build fails, or if you need to inspect / snapshot a live DB's schema.

---

## 1. Why this exists

The shadow-replay gate (`schema-ci.yml`) catches two failure modes:
- "I added SQL to prod by hand" (ghost migration)
- "I forgot to commit the migration file" (drift)

But it cannot catch a third category: **migrations that are syntactically valid and deployable, but semantically dangerous against a live DB.** Examples:

| Pattern | Why it's dangerous |
|---|---|
| `ALTER TABLE … RENAME COLUMN x TO y` | Breaks every running client that selects `x` — instant outage. |
| `ALTER TABLE … ADD COLUMN x INT NOT NULL` (no default) | Full-table rewrite under exclusive lock. On a multi-million-row table this is minutes of downtime. |
| `CREATE INDEX idx_foo ON huge_table (col)` (no `CONCURRENTLY`) | Blocks all writes to the table for the duration of index build. |
| `ALTER TABLE … ALTER COLUMN x TYPE varchar(120)` | Narrowing a TEXT column rewrites every row + can truncate data. |
| `ALTER TABLE … ADD CONSTRAINT fk_x FOREIGN KEY (y) REFERENCES z(id)` (no `NOT VALID`) | Full-table scan + lock to validate every existing row. |

These patterns all pass the shadow-replay gate because the migration *runs successfully* on an empty database. The OBS-9 gate inspects each migration with **squawk** (a Postgres-aware linter) and **Atlas** (a schema-evolution analyzer) to flag them before merge.

The pilot launch (Q3 2026) targets 99.95% uptime per `docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md`. A single multi-minute migration outage burns the entire uptime budget for a year. We cannot afford to learn this lesson at the customer's expense.

---

## 2. How the gate works

On every PR that touches `apps/backend/migrations/**`, `atlas.hcl`, `atlas/**`, or the gate scripts themselves, two jobs run in parallel:

```
            on PR (paths-filtered):
            ┌────────────────────────────────────┐
            │ squawk-cli (Postgres lint)         │
            │   scripts/squawk-check.sh          │
            │   - diff vs origin/main            │
            │   - lint each NEW/MODIFIED .sql    │
            │   - 12 blocking rules → exit 1     │
            │   - everything else → informational│
            └─────────────┬──────────────────────┘
                          │ parallel ▲
            ┌─────────────┴──────────────────────┐
            │ atlas migrate lint                 │
            │   - boots postgres:18-alpine       │
            │   - replays last 5 migrations      │
            │   - column-aware analysis          │
            │   - destructive + data_depend +    │
            │     incompatible diagnostics       │
            └─────────────┬──────────────────────┘
                          │
                          ▼
                summary job: both must pass
```

Both jobs have a **5-minute timeout** to keep developer feedback fast.

---

## 3. Local development workflow

### 3.1 Before pushing a migration

```bash
# 1. Create the migration file (existing flow, unchanged):
npm --prefix apps/backend run migrate:create describe_what_you_add

# 2. Edit migrations/<timestamp>_describe_what_you_add.sql

# 3. Run squawk locally to catch issues before CI does:
npm run schema:lint

# 4. (Optional but recommended) refresh baseline.sql:
npm run schema:snapshot
git diff apps/backend/schema/baseline.sql

# 5. Commit:
git add apps/backend/migrations/*.sql apps/backend/schema/baseline.sql
git commit -m "feat(backend): add <thing>"
git push
```

`npm run schema:lint` runs `scripts/squawk-check.sh`, which:
1. Diffs `origin/main`..`HEAD` for changed `.sql` files in `apps/backend/migrations/`.
2. Runs squawk on each with the rule set in §5.
3. Exits 0 if no blocking rules trip, 1 if any do.

### 3.2 Snapshotting the live schema

When debugging "what's actually deployed?" use:

```bash
# Snapshot dev:
bash scripts/atlas-snapshot.sh \
  --env local \
  --url postgresql://spillorama:spillorama@localhost:5432/spillorama

# Snapshot staging (requires APP_PG_CONNECTION_STRING set):
bash scripts/atlas-snapshot.sh --env prod

# Snapshot prod (BE CAREFUL — read-only operation but uses real creds):
APP_PG_CONNECTION_STRING="postgresql://prod-host..." \
  bash scripts/atlas-snapshot.sh --env prod
```

Output goes to `atlas/snapshots/<YYYY-MM-DD>.sql`. The file is **.gitignored** — it's a personal capture, not source of truth.

Compare against the checked-in baseline:

```bash
diff -U 3 apps/backend/schema/baseline.sql atlas/snapshots/2026-05-14.sql | less
```

If there's drift, the most likely causes (in order):
1. **A new migration was deployed but the local checkout is stale.** `git pull` and re-snapshot.
2. **Someone hand-applied SQL to the DB.** See §6 "Drift detected".
3. **The baseline is out of date** because a previous PR forgot `npm run schema:snapshot`. Rerun snapshot locally and open a fix-up PR.

### 3.3 Linting every migration (audit mode)

```bash
npm run schema:lint:all
```

This bypasses the `origin/main` diff and runs squawk on every `.sql` file in `apps/backend/migrations/`. Useful for:
- One-time audits when adopting a new squawk version
- Reproducing historical violations in commit `X`
- Verifying that excluded rules in §5 actually apply

Expect findings on legacy migrations (`prefer-bigint-over-int`, `prefer-identity` etc.). The CI gate only blocks NEW changes; legacy patterns are tolerated unless they're in the blocking list (§5).

---

## 4. Atlas lint failed

Symptom: the **atlas migrate lint** job is red on your PR.

### 4.1 Read the artifact

The job uploads `atlas-lint-output` as a workflow artifact (retained 7 days). It contains:
- `atlas-lint.json` — structured findings per migration file
- `atlas-lint.stderr` — Atlas's own log output (often more readable)

### 4.2 Common failures

| Atlas finding | What it means | Fix |
|---|---|---|
| `MF101: Adding non-nullable column …` | A NOT NULL column was added without a default. Locks the table for full rewrite. | Add a `DEFAULT` clause, OR split into 2 migrations (add nullable → backfill → set NOT NULL). |
| `MF102: Renaming column …` | RENAME COLUMN breaks running clients. | Add new column → dual-write in code → backfill → switch reads → drop old column. 4 separate migrations. |
| `CD101: Creating index non-concurrently …` | `CREATE INDEX` without `CONCURRENTLY` blocks writes. | Add `CONCURRENTLY` (and remove the surrounding transaction — `CREATE INDEX CONCURRENTLY` cannot run in a transaction block). |
| `DS101: Dropping column …` | `DROP COLUMN` is destructive. | Verify no application code references it. If safe, document the audit in the migration's `-- comment` and proceed. |
| `CD102: Adding foreign key without NOT VALID` | Full-table scan + lock. | Use `ALTER TABLE … ADD CONSTRAINT … NOT VALID;` followed by `ALTER TABLE … VALIDATE CONSTRAINT …;` in a separate migration. |

### 4.3 Atlas vs squawk overlap

The two tools have ~70% overlap on findings. We run both because:
- **Squawk** has better-organized rules and clearer error messages.
- **Atlas** has stronger column-dependency analysis (it knows whether your DROP COLUMN breaks a FOREIGN KEY elsewhere).

If only one tool fires, that's still a real finding — investigate it.

---

## 5. Squawk lint failed

Symptom: the **squawk** job is red on your PR.

### 5.1 Blocking vs informational

Squawk-cli (2.52.x) emits everything at `Warning` level and always exits 0. We treat the rules listed in `scripts/squawk-check.sh` `SQUAWK_BLOCKING_RULES` as **blocking** — any one of them firing → CI fails. Everything else is informational (shown in logs but doesn't block).

Current blocking rules (see `docs/operations/MIGRATION_LINT_RULES.md` for full details):

- Schema-evolution killers: `renaming-column`, `renaming-table`, `disallowed-unique-constraint`, `changing-column-type`, `constraint-missing-not-valid`
- Lock-amplifying patterns: `adding-required-field`, `adding-not-nullable-field`, `adding-field-with-default`, `ban-create-index-non-concurrently`, `ban-char-field`
- Idempotency / rerun-safety: `prefer-robust-stmts`
- Time/clock footguns: `disallowed-current-time`

### 5.2 Common failures

| Squawk warning | Fix |
|---|---|
| `renaming-column` | Use the dual-column dance from §4.2. |
| `adding-required-field` | Make the column nullable, OR add a non-volatile DEFAULT. |
| `disallowed-unique-constraint` | Build the index first (CONCURRENTLY), then add the constraint USING the index. |
| `prefer-robust-stmts` | Add `IF NOT EXISTS` to `CREATE`, `IF EXISTS` to `DROP`. node-pg-migrate doesn't auto-add these. |
| `disallowed-current-time` | Use `clock_timestamp()` if you need per-row evaluation; `now()` is evaluated once per statement which is usually correct but subtly wrong inside loops. |
| `ban-create-index-non-concurrently` | Add `CONCURRENTLY`. Remember to also remove the surrounding transaction. |

### 5.3 Disabling a rule for a specific migration

Rarely needed — when it is, add an exclusion comment in the migration file:

```sql
-- squawk: ignore renaming-column
-- rationale: only run on staging during cutover window, see DR-2026-05-12
ALTER TABLE deprecated_v0_table RENAME COLUMN x TO _legacy_x_v0;
```

The squawk-cli `--exclude-path` / `--exclude` flags are also available, but **prefer in-file annotations** so future readers see the rationale. Update `scripts/squawk-check.sh` `SQUAWK_EXCLUDED_RULES` only for cases that apply repo-wide (e.g. `require-timeout-settings`, which our migration runner handles).

---

## 6. Drift detected (atlas-snapshot vs baseline)

Symptom: `diff -U 3 apps/backend/schema/baseline.sql atlas/snapshots/<date>.sql` shows differences.

### 6.1 Triage

```bash
# 1. Pull main; the baseline may be ahead of your checkout.
git checkout main && git pull
diff -U 3 apps/backend/schema/baseline.sql atlas/snapshots/<date>.sql

# 2. If still differs, check what migrations are registered in the DB:
psql "$APP_PG_CONNECTION_STRING" -c \
  "SELECT name, run_on FROM pgmigrations ORDER BY id DESC LIMIT 20;"

# 3. Compare to apps/backend/migrations/ filenames. Anything in DB but
#    not in the directory = ghost migration. Anything in directory but
#    not in DB = unapplied (rare; render auto-runs migrations on deploy).
```

### 6.2 If you find a ghost migration (DB has something not in repo)

This is a P1 incident. Follow `docs/operations/SCHEMA_ARCHAEOLOGY_2026-04-29.md` §"Discovered a ghost".

Short version:
1. Capture the current DB state via `atlas-snapshot.sh` BEFORE doing anything.
2. Reproduce the ghost in a shadow DB.
3. Write a regular migration file that produces the same effect, with `IF NOT EXISTS` / `IF EXISTS` so it's idempotent against the live (already-applied) state.
4. Open a PR, get it through the gate, deploy.
5. Document the original cause in `docs/audit/SCHEMA_DIVERGENCE_AUDIT_<date>.md`.

### 6.3 If you find a missing migration (repo has something not in DB)

Render deploy must have failed silently, or a migration was rolled back manually. Check render logs first; the deploy should have failed loudly. If the migration is genuinely missing in the DB, re-trigger a deploy or run `npm --prefix apps/backend run migrate` against the target DB with appropriate credentials.

---

## 7. Adding a new squawk rule to the blocking list

When you discover a rule is firing on a migration that genuinely broke prod:

1. Open `scripts/squawk-check.sh`.
2. Add the rule name to `SQUAWK_BLOCKING_RULES`.
3. Document it in `docs/operations/MIGRATION_LINT_RULES.md` (the catalog).
4. Run `npm run schema:lint:all` locally to confirm no legacy migrations trip the new rule. If they do, either:
   - Mark the existing migration with an in-file `-- squawk: ignore <rule>` comment.
   - Add the affected file to `--exclude-path` in `squawk-check.sh`.
5. Open a PR with the change. Include the historical incident or audit link as rationale.

---

## 8. Adding a new Atlas diagnostic to the blocking list

Atlas's lint config is in `atlas.hcl`'s `lint { … }` block. Each diagnostic family (`destructive`, `data_depend`, `incompatible`) can be set to `warning` or `error`. To promote a new family:

```hcl
lint {
  destructive {
    error = true
  }
  # … add new block here …
  naming {
    error = true
  }
}
```

Re-run `npm run schema:lint:all` and any sample migrations to confirm the rule fires as expected. Open a PR with the change + rationale.

---

## 9. Tooling versions

| Tool | Pinned version | Where |
|---|---|---|
| atlas | `latest` (via `ariga/setup-atlas@v0`) | `.github/workflows/schema-as-code.yml` |
| squawk | `2.52.1` | `.github/workflows/schema-as-code.yml` (download URL) |
| postgres (lint dev-db) | `18-alpine` | `.github/workflows/schema-as-code.yml` services |

Atlas is intentionally `latest` because they ship rule improvements quickly and breakage has been rare in CI runs to date. If a breaking change ever ships, pin via `version: "0.x.y"` in the workflow.

Squawk is pinned because the binary release URL is version-specific and we want bit-stable CI; bump deliberately when the team agrees.

---

## 10. Relationship to other gates

| Gate | What it catches | Catches at |
|---|---|---|
| `schema-ci.yml` (shadow-replay) | Ghost migrations, uncommitted migration files | PR + push to main |
| `schema-ghost-nightly.yml` | Hand-applied SQL on staging | Nightly |
| `schema-as-code.yml` (this) | Risky-but-valid migration patterns | PR |
| `architecture-lint.yml` | Cross-module import violations | PR |
| `compliance-gate.yml` | Pengespillforskriften test regression | PR + push to main |

All five are required-context for merge. None subsumes the others; each catches a distinct failure mode. If two fail on the same PR, fix the root cause first (usually the most-specific one) and the others typically resolve.

---

## 11. FAQ

**Q: My migration is a pure cleanup of legacy code (e.g. dropping an unused column) but squawk blocks me. How do I proceed?**

A: Use the in-file annotation:
```sql
-- squawk: ignore ban-drop-column
-- audit: column has had zero reads in last 90 days per query-log
-- audit: no application code references it (grep verified)
ALTER TABLE legacy_table DROP COLUMN IF EXISTS deprecated_field;
```

**Q: I want to test a migration locally end-to-end before pushing. What's the fastest path?**

A:
```bash
# Boot a local shadow:
docker run --rm -d --name local-shadow \
  -e POSTGRES_USER=shadow -e POSTGRES_PASSWORD=shadow -e POSTGRES_DB=shadow \
  -p 55432:5432 postgres:18-alpine

# Apply migrations:
APP_PG_CONNECTION_STRING="postgresql://shadow:shadow@localhost:55432/shadow" \
  npm --prefix apps/backend run migrate

# Lint:
npm run schema:lint

# Snapshot for diffing:
bash scripts/atlas-snapshot.sh \
  --env local \
  --url postgresql://shadow:shadow@localhost:55432/shadow

# Teardown:
docker rm -f local-shadow
```

**Q: Why two tools (squawk + Atlas)?**

A: They have complementary strengths. Squawk has clearer error messages and is easier to extend (just a rule name in `scripts/squawk-check.sh`). Atlas has better column-dependency analysis (it knows whether a DROP COLUMN breaks an FK). The overlap is ~70% — both catching it confirms the finding is real.

**Q: What about declarative HCL schemas? Atlas supports that.**

A: We deliberately don't use it. Our schema source of truth is the migration set + `apps/backend/schema/baseline.sql`. Atlas is for *analysis* on top of that, not replacement. Migrating to declarative HCL would require rewriting 156+ migrations and is out of scope for OBS-9.

**Q: Can I bypass the gate for an emergency hotfix?**

A: No. Use the in-file `-- squawk: ignore <rule>` annotation if the finding is a false positive, or split the migration into safe pieces if the finding is real. If you genuinely need to ship something the gate blocks AND you've exhausted in-file annotations, escalate to tech-lead with a written rationale — the gate exists because we cannot afford one outage from a bad migration.
