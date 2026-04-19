-- Blokk 1.1 — Multi-hall linked draws (schema only, no logic).
--
-- Adds the core tables for multi-hall linked draw sessions as described in
-- docs/MULTI_HALL_REBUILD_PLAN_2026-04-16.md § Blokk 1.1:
--
--   app_hall_groups           — named group of halls that share a draw session
--                               (legacy "link" / Mongo groupHall equivalent)
--   app_halls.hall_group_id   — at most one active group membership per hall
--   app_draw_sessions         — one shared round per group, lifecycle states
--   app_draw_session_halls    — per-hall participation + ticket counters
--   app_draw_session_events   — append-only event ledger with SHA-256 hash chain
--
-- Naming / typing conventions follow the existing schema
-- (20260413000001_initial_schema.sql): TEXT PRIMARY KEY, app_* prefix,
-- TIMESTAMPTZ NOT NULL DEFAULT now(), CREATE TABLE IF NOT EXISTS, CHECK
-- constraints for enums. The plan document uses UUID examples; we translate
-- to TEXT to match the rest of the system (app_halls, app_users, etc.).

-- Up Migration

-- ── Hall groups ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_hall_groups (
  id               TEXT PRIMARY KEY,
  name             TEXT UNIQUE NOT NULL,
  public_code      TEXT UNIQUE NOT NULL,
  tv_broadcast_id  INTEGER UNIQUE,
  status           TEXT NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at      TIMESTAMPTZ NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  app_hall_groups              IS 'Linked-draw group. ~4–6 halls share one draw session at a time.';
COMMENT ON COLUMN app_hall_groups.public_code  IS 'Stable operator-facing code (e.g. "HG_20260416_001"); shown on TV + admin UI.';
COMMENT ON COLUMN app_hall_groups.tv_broadcast_id IS 'Sequential integer for TV-broadcast identification (legacy-compatible).';

-- A hall belongs to at most one active group. NULL means unassigned.
-- Uniqueness is automatic: hall_group_id is a single scalar column on a row
-- that is already uniquely keyed by app_halls.id, so a hall can only reference
-- one group at a time. Partial index is for FK-join performance.
ALTER TABLE app_halls
  ADD COLUMN IF NOT EXISTS hall_group_id TEXT NULL REFERENCES app_hall_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_app_halls_hall_group_id
  ON app_halls (hall_group_id)
  WHERE hall_group_id IS NOT NULL;

-- ── Draw sessions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_draw_sessions (
  id                    TEXT PRIMARY KEY,
  hall_group_id         TEXT NOT NULL REFERENCES app_hall_groups(id) ON DELETE RESTRICT,
  coordinator_hall_id   TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  status                TEXT NOT NULL DEFAULT 'OPEN_FOR_TICKETS'
                          CHECK (status IN (
                            'OPEN_FOR_TICKETS',
                            'WAITING_READY',
                            'READY_TO_START',
                            'DRAWING',
                            'COMPLETE',
                            'CANCELLED'
                          )),
  ruleset_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  rng_seed              TEXT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at            TIMESTAMPTZ NULL,
  completed_at          TIMESTAMPTZ NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  app_draw_sessions                 IS 'One shared draw round across all halls in a hall_group. Lifecycle: OPEN_FOR_TICKETS → WAITING_READY → READY_TO_START → DRAWING → COMPLETE/CANCELLED.';
COMMENT ON COLUMN app_draw_sessions.coordinator_hall_id IS 'The single hall authorised to call "start draw" on behalf of the group (master hall).';
COMMENT ON COLUMN app_draw_sessions.ruleset_json    IS 'Snapshot of pricing, payout %, and pattern rules used for this session (immutable after CREATED).';
COMMENT ON COLUMN app_draw_sessions.rng_seed        IS 'Audit seed used to generate the 75-ball draw order — allows deterministic replay.';

-- Exactly one non-terminal session per hall group at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_draw_sessions_one_active_per_group
  ON app_draw_sessions (hall_group_id)
  WHERE status NOT IN ('COMPLETE', 'CANCELLED');

CREATE INDEX IF NOT EXISTS idx_app_draw_sessions_hall_group_created
  ON app_draw_sessions (hall_group_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_draw_sessions_coordinator_hall
  ON app_draw_sessions (coordinator_hall_id, created_at DESC);

-- ── Per-hall participation ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_draw_session_halls (
  draw_session_id         TEXT NOT NULL REFERENCES app_draw_sessions(id) ON DELETE CASCADE,
  hall_id                 TEXT NOT NULL REFERENCES app_halls(id) ON DELETE RESTRICT,
  ready_at                TIMESTAMPTZ NULL,
  ready_confirmed_by      TEXT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  digital_tickets_sold    INTEGER NOT NULL DEFAULT 0 CHECK (digital_tickets_sold >= 0),
  physical_tickets_sold   INTEGER NOT NULL DEFAULT 0 CHECK (physical_tickets_sold >= 0),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (draw_session_id, hall_id)
);

COMMENT ON TABLE  app_draw_session_halls                        IS 'Per-hall participation state in a shared draw session.';
COMMENT ON COLUMN app_draw_session_halls.ready_at               IS 'Set when the hall admin marks the hall ready to start. NULL = not ready.';
COMMENT ON COLUMN app_draw_session_halls.digital_tickets_sold   IS 'Web/app tickets sold in this hall for this session. Drives § 71 INTERNET channel ledger.';
COMMENT ON COLUMN app_draw_session_halls.physical_tickets_sold  IS 'Paper tickets sold in this hall for this session. Drives § 71 HALL channel ledger.';

CREATE INDEX IF NOT EXISTS idx_app_draw_session_halls_hall_id
  ON app_draw_session_halls (hall_id, draw_session_id);

-- ── Event ledger (append-only, SHA-256 hash chain) ────────────────────────

CREATE TABLE IF NOT EXISTS app_draw_session_events (
  id                BIGSERIAL PRIMARY KEY,
  draw_session_id   TEXT NOT NULL REFERENCES app_draw_sessions(id) ON DELETE RESTRICT,
  event_type        TEXT NOT NULL
                      CHECK (event_type IN (
                        'CREATED',
                        'HALL_READY',
                        'HALL_UNREADY',
                        'COORDINATOR_START',
                        'DRAW',
                        'CLAIM',
                        'COMPLETED',
                        'CANCELLED'
                      )),
  chain_index       BIGINT NOT NULL,
  previous_hash     TEXT NOT NULL,
  event_hash        TEXT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  app_draw_session_events               IS 'Append-only audit ledger for a draw session. Hash chain (sha256 of event_type || payload || previous_hash) guarantees tamper evidence.';
COMMENT ON COLUMN app_draw_session_events.chain_index   IS 'Monotonic index within a draw_session (starts at 0 for the CREATED event).';
COMMENT ON COLUMN app_draw_session_events.previous_hash IS 'event_hash of the preceding event in this draw_session. The CREATED event uses the 64-char zero string as its previous_hash.';
COMMENT ON COLUMN app_draw_session_events.event_hash    IS 'sha256_hex(event_type || canonical_json(payload) || previous_hash). Must be unique within (draw_session_id, chain_index).';

-- Chain integrity + primary tail-read path: (session, chain_index) must be
-- unique — this prevents forks/gaps AND serves as the index for tail reads.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_draw_session_events_session_chain
  ON app_draw_session_events (draw_session_id, chain_index);
