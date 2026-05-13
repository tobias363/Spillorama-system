// atlas.hcl
//
// Atlas (https://atlasgo.io) schema-as-code config for Spillorama.
//
// What this gives us (OBS-9):
//   1. Lint-friendly view over the existing node-pg-migrate migration
//      directory at apps/backend/migrations/.
//   2. A way to inspect the live (dev / staging / prod) schema and
//      snapshot it into atlas/snapshots/<date>.sql for drift analysis.
//   3. A `migrate lint` pass that runs in CI alongside squawk so we
//      catch breaking schema changes (renames, narrowing types, missing
//      CONCURRENTLY etc.) at PR-time.
//
// What this does NOT do:
//   - Replace node-pg-migrate. Render's buildCommand still runs
//     `npm run migrate` (see render.yaml). Atlas is for *analysis* on
//     top of the migrations we already have.
//   - Apply migrations to prod. Atlas can do that, but we keep the
//     existing forward-only node-pg-migrate flow (ADR-0014) untouched.
//   - Maintain a separate "declarative schema" in HCL. The schema
//     directive points back at apps/backend/migrations so Atlas reads
//     the same SQL files our app uses.
//
// Migration directory format:
//   node-pg-migrate writes plain timestamped .sql files (no Atlas
//   atlas.sum / golang-migrate down-blocks). The closest Atlas format
//   that round-trips these without rewrites is `golang-migrate` when
//   used with the `migrate lint --dir-format` override. CI invokes
//   Atlas with `--dir-format=golang-migrate` and skips checksum
//   verification (see .github/workflows/schema-as-code.yml).

variable "url" {
  type    = string
  default = getenv("APP_PG_CONNECTION_STRING")
}

variable "dev_url" {
  type    = string
  default = "docker://postgres/18-alpine/dev?search_path=public"
}

env "local" {
  // Local developer environment. Reads connection string from env so
  // the file itself does not embed credentials.
  url = var.url

  // Atlas needs a "dev database" to compute diffs / lint plans.
  // postgres:18-alpine matches what schema-CI uses (see
  // scripts/schema-ci/run-shadow-migrations.sh) so the linter's
  // semantic checks match the shadow-replay gate.
  dev = var.dev_url

  migration {
    dir    = "file://apps/backend/migrations"
    format = golang-migrate
  }

  // We do not use Atlas's HCL schema-as-code mode. The source-of-truth
  // for schema is the migration set + apps/backend/schema/baseline.sql
  // produced by `npm run schema:snapshot`.
}

env "ci" {
  // GitHub Actions environment. The workflow boots a postgres:18
  // service and sets ATLAS_DEV_URL to point at it.
  url = getenv("ATLAS_URL")
  dev = getenv("ATLAS_DEV_URL")

  migration {
    dir    = "file://apps/backend/migrations"
    format = golang-migrate
  }
}

env "prod" {
  // Optional. Only used by `scripts/atlas-snapshot.sh` to inspect the
  // live prod schema. Connection string comes from caller env, never
  // committed.
  url = getenv("APP_PG_CONNECTION_STRING")
  dev = var.dev_url

  migration {
    dir    = "file://apps/backend/migrations"
    format = golang-migrate
  }
}

// Lint rule overrides.
//
// Atlas exposes individual "diagnostics" through its lint engine. We
// disable a small set that conflict with our existing migration style
// (idempotent CREATE TABLE IF NOT EXISTS, ALTER TABLE ... ADD COLUMN
// IF NOT EXISTS — see ADR-0014). Everything else stays on so we get
// signal on actually-risky patterns.
lint {
  destructive {
    // Drop-column / drop-table warnings stay ON. Squawk also catches
    // these but Atlas's analysis is column-aware and catches some
    // cases squawk misses (e.g. removing a column referenced by a
    // foreign key).
    error = true
  }

  // Concurrent-index lint: we want to be warned when CREATE INDEX is
  // emitted without CONCURRENTLY against a table that already has data
  // in prod. Atlas's data_depend analyzer flags this.
  data_depend {
    error = true
  }

  // Incompatible: catches type-narrowing (text → varchar(n)) and
  // similar app-breaking changes.
  incompatible {
    error = true
  }
}
