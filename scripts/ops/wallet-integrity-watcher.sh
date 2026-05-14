#!/usr/bin/env bash
# wallet-integrity-watcher.sh — cron-driven invariant-check for wallet-tables.
#
# Tobias-direktiv 2026-05-14:
#   "Vi må fange wallet-mismatch og hash-chain-brudd så raskt at vi har
#    sjanse til å forensicse hva som skjedde. Det er forskjell på sekunder."
#
# Dette scriptet håndhever to invariants ved hver kjøring:
#
#   I1 — Balance-sum-invariant (regulatorisk, BIN-761 outbox):
#        wallet_accounts.balance (generated stored = deposit + winnings)
#        MÅ være lik sum av wallet_entries:
#          SUM(CASE side WHEN 'CREDIT' THEN amount ELSE -amount END)
#        Skjevhet → indikerer enten direct-INSERT (forbudt per §2.6), eller
#        wallet-credit uten ledger-entry (bryter outbox-pattern, ADR-0005).
#
#   I2 — Hash-chain-link-invariant (BIN-764, ADR-0004):
#        For hver wallet-konto, sortert på id ASC, må row[N].previous_entry_hash
#        være eksakt lik row[N-1].entry_hash. Brudd → en rad er enten slettet
#        eller mutert post-hoc. Genesis-rad (første per konto) skal ha
#        previous_entry_hash = 64x '0'.
#
# NB: Dette scriptet gjør IKKE full SHA-256 re-compute av entry_hash —
# det krever canonical-JSON-logikk som lever i TypeScript-adapteren
# (`PostgresWalletAdapter.canonicalJsonForEntry`). Den jobben gjøres av
# `WalletAuditVerifier` (nightly cron, on-demand admin route).
# Watcher-en her er den raske strukturelle sjekken som kjører hver time.
#
# Hva scriptet gjør:
#   1. Pinger Postgres (default lokal dev: spillorama/spillorama@localhost).
#   2. Kjører Q1 (balance-sum) og Q2 (hash-chain-link) via psql -X -A -t -F'|'.
#   3. Bygger markdown-rapport med tre seksjoner:
#        - Mismatches (I1) — wallet_id, stored balance, computed sum, delta
#        - Hash-chain-brudd (I2) — wallet_id, entry_id, expected prev, actual prev
#        - "Recommended actions" med forensics-pekere
#   4. Skriver rapport til /tmp/wallet-integrity-YYYY-MM-DDTHH:MM:SSZ.md
#   5. Hvis brudd → kaller scripts/ops/wallet-mismatch-create-linear-issue.sh
#      (med dedup 24h per wallet_id via STATE_FILE).
#
# Sikkerhet:
#   * READ-ONLY. Kun SELECT. Aldri INSERT/UPDATE/DELETE.
#   * Idempotent — kan kjøres så ofte du vil uten side-effekt på DB.
#   * Linear-issue-call er DEDUP'et 24t per wallet_id så vi ikke spammer.
#   * Skriver IKKE prod-Postgres — kun localhost via WALLET_INTEGRITY_DB_URL.
#
# Bruk:
#   bash scripts/ops/wallet-integrity-watcher.sh                # default kjøring
#   DRY_RUN=1 bash scripts/ops/wallet-integrity-watcher.sh      # ikke opprett Linear
#   WALLET_INTEGRITY_DB_URL=postgresql://user:pass@host/db \
#     bash scripts/ops/wallet-integrity-watcher.sh
#   REPORT_DIR=/tmp/wi-reports bash scripts/ops/wallet-integrity-watcher.sh
#
# Env-overrides:
#   WALLET_INTEGRITY_DB_URL      — default postgresql://spillorama:spillorama@localhost:5432/spillorama
#   REPORT_DIR                   — default /tmp
#   REPORT_RETENTION_HOURS       — default 168 (7 dager)
#   HASH_CHAIN_WINDOW_HOURS      — default 24 (hash-chain-sjekk siste N timer)
#   STATE_FILE                   — default /tmp/wallet-integrity-watcher-state.json
#   LINEAR_ISSUE_DEDUP_HOURS     — default 24 (samme wallet_id flagges max én gang/døgn)
#   PSQL_CONNECT_TIMEOUT         — default 5 (sek)
#   DRY_RUN                      — 1 = ikke opprett Linear-issue
#
# Exit-codes:
#   0 — Kjøring OK, ingen brudd
#   1 — Brudd funnet (mismatch ELLER hash-chain-brudd)
#   2 — Postgres ikke tilgjengelig
#   3 — Konfig-feil (manglende verktøy, ugyldig env)

set -u
set -o pipefail

# ── Default env-config ──────────────────────────────────────────────────────

: "${WALLET_INTEGRITY_DB_URL:=postgresql://spillorama:spillorama@localhost:5432/spillorama}"
: "${REPORT_DIR:=/tmp}"
: "${REPORT_RETENTION_HOURS:=168}"
: "${HASH_CHAIN_WINDOW_HOURS:=24}"
: "${STATE_FILE:=/tmp/wallet-integrity-watcher-state.json}"
: "${LINEAR_ISSUE_DEDUP_HOURS:=24}"
: "${PSQL_CONNECT_TIMEOUT:=5}"
: "${DRY_RUN:=0}"

export PGCONNECT_TIMEOUT="$PSQL_CONNECT_TIMEOUT"

# ── Helpers ─────────────────────────────────────────────────────────────────

ISO_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SAFE_TS=$(date -u +"%Y%m%dT%H%M%SZ")

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
LINEAR_SCRIPT="${SCRIPT_DIR}/wallet-mismatch-create-linear-issue.sh"

log() {
  echo "[wallet-integrity-watcher] $*" >&2
}

err() {
  echo "[wallet-integrity-watcher] ERROR: $*" >&2
}

ensure_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "Required command not found: $cmd"
    exit 3
  fi
}

# ── Pre-flight ──────────────────────────────────────────────────────────────

ensure_cmd psql
ensure_cmd jq

if [ -z "$WALLET_INTEGRITY_DB_URL" ]; then
  err "WALLET_INTEGRITY_DB_URL not set"
  exit 3
fi

mkdir -p "$REPORT_DIR"

REPORT_FILE="${REPORT_DIR}/wallet-integrity-${SAFE_TS}.md"

# Ping Postgres. Use -X to ignore .psqlrc, -A unaligned, -t tuples-only.
if ! psql -X -A -t -c 'SELECT 1' "$WALLET_INTEGRITY_DB_URL" >/dev/null 2>&1; then
  err "Cannot connect to Postgres via WALLET_INTEGRITY_DB_URL"
  exit 2
fi

# Verify required tables exist before running heavy queries.
TABLES_OK=$(psql -X -A -t -c \
  "SELECT count(*) FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name IN ('wallet_accounts', 'wallet_entries')" \
  "$WALLET_INTEGRITY_DB_URL" 2>/dev/null || echo "0")

if [ "$TABLES_OK" != "2" ]; then
  err "Required tables wallet_accounts + wallet_entries not found in current schema"
  exit 2
fi

# ── Cleanup old reports ────────────────────────────────────────────────────

cleanup_old_reports() {
  find "$REPORT_DIR" -maxdepth 1 -name 'wallet-integrity-*.md' -type f \
       -mmin +$((REPORT_RETENTION_HOURS * 60)) -delete 2>/dev/null || true
}
cleanup_old_reports

# ── Q1: Balance-sum invariant ──────────────────────────────────────────────
#
# For every wallet_accounts row, compute the signed sum of wallet_entries:
#   CREDIT  → +amount
#   DEBIT   → -amount
# and compare against the stored balance. System accounts (__house__,
# __external_cash__) are excluded — they intentionally hold a deficit because
# debits represent payouts.

fetch_balance_mismatches() {
  psql -X -A -t -F'|' \
    -c "WITH computed AS (
          SELECT account_id,
                 SUM(CASE side WHEN 'CREDIT' THEN amount ELSE -amount END) AS computed_balance
            FROM wallet_entries
           GROUP BY account_id
        )
        SELECT w.id,
               w.balance::text,
               COALESCE(c.computed_balance, 0)::text,
               (w.balance - COALESCE(c.computed_balance, 0))::text
          FROM wallet_accounts w
          LEFT JOIN computed c ON c.account_id = w.id
         WHERE w.is_system = false
           AND w.balance IS DISTINCT FROM COALESCE(c.computed_balance, 0)
         ORDER BY (w.balance - COALESCE(c.computed_balance, 0)) DESC" \
    "$WALLET_INTEGRITY_DB_URL"
}

BALANCE_MISMATCH_RAW=$(fetch_balance_mismatches 2>&1) || {
  err "Failed Q1 (balance-sum): $BALANCE_MISMATCH_RAW"
  exit 2
}

# Convert pipe-rows to JSON array
if [ -z "$BALANCE_MISMATCH_RAW" ]; then
  BALANCE_MISMATCH_JSON='[]'
else
  BALANCE_MISMATCH_JSON=$(echo "$BALANCE_MISMATCH_RAW" \
    | jq -R -s -c '
        split("\n")
        | map(select(length > 0))
        | map(split("|"))
        | map({
            wallet_id: .[0],
            stored_balance: .[1],
            computed_balance: .[2],
            delta: .[3]
          })
      ')
fi

BALANCE_MISMATCH_COUNT=$(echo "$BALANCE_MISMATCH_JSON" | jq 'length')
log "Q1 balance-mismatches: ${BALANCE_MISMATCH_COUNT}"

# ── Q2: Hash-chain link-integrity (siste N timer) ──────────────────────────
#
# For each row in wallet_entries created within HASH_CHAIN_WINDOW_HOURS,
# compute the expected previous_entry_hash by joining to the row immediately
# before it (per account_id, sorted by id ASC). Flag any row where:
#   - previous_entry_hash IS NULL but a previous row exists with non-null hash
#   - previous_entry_hash ≠ previous row's entry_hash
#   - entry_hash IS NULL (post-hash-chain-rollout row should never be NULL)
#
# Legacy rows (pre-BIN-764) with NULL entry_hash on BOTH the row AND its
# predecessor are ignored — they're a known backfill-state, not tampering.

fetch_hash_chain_breaks() {
  psql -X -A -t -F'|' \
    -c "WITH ordered AS (
          SELECT id,
                 account_id,
                 entry_hash,
                 previous_entry_hash,
                 created_at,
                 LAG(entry_hash)   OVER (PARTITION BY account_id ORDER BY id ASC) AS prev_row_entry_hash,
                 LAG(id)            OVER (PARTITION BY account_id ORDER BY id ASC) AS prev_row_id
            FROM wallet_entries
        )
        SELECT id::text,
               account_id,
               COALESCE(entry_hash, '')         AS entry_hash,
               COALESCE(previous_entry_hash, '') AS previous_entry_hash,
               COALESCE(prev_row_entry_hash, '') AS expected_previous,
               COALESCE(prev_row_id::text, '')   AS predecessor_id,
               created_at::text
          FROM ordered
         WHERE created_at >= now() - (interval '1 hour' * ${HASH_CHAIN_WINDOW_HOURS})
           AND (
             -- Case A: this row has entry_hash but previous_entry_hash mismatches predecessor
             (entry_hash IS NOT NULL
                AND prev_row_entry_hash IS NOT NULL
                AND previous_entry_hash IS DISTINCT FROM prev_row_entry_hash)
             OR
             -- Case B: this row is missing entry_hash entirely (post-BIN-764 should never happen)
             (entry_hash IS NULL AND prev_row_entry_hash IS NOT NULL)
             OR
             -- Case C: this row has hash but previous_entry_hash IS NULL (broken genesis chain)
             (entry_hash IS NOT NULL
                AND previous_entry_hash IS NULL
                AND prev_row_entry_hash IS NOT NULL)
           )
         ORDER BY account_id, id" \
    "$WALLET_INTEGRITY_DB_URL"
}

HASH_CHAIN_RAW=$(fetch_hash_chain_breaks 2>&1) || {
  err "Failed Q2 (hash-chain): $HASH_CHAIN_RAW"
  exit 2
}

if [ -z "$HASH_CHAIN_RAW" ]; then
  HASH_CHAIN_JSON='[]'
else
  HASH_CHAIN_JSON=$(echo "$HASH_CHAIN_RAW" \
    | jq -R -s -c '
        split("\n")
        | map(select(length > 0))
        | map(split("|"))
        | map({
            entry_id: .[0],
            wallet_id: .[1],
            entry_hash: .[2],
            previous_entry_hash: .[3],
            expected_previous: .[4],
            predecessor_id: .[5],
            created_at: .[6],
            reason: (
              if .[2] == "" then "missing_entry_hash"
              elif .[3] == "" then "missing_previous_entry_hash"
              else "previous_hash_mismatch"
              end
            )
          })
      ')
fi

HASH_CHAIN_BREAK_COUNT=$(echo "$HASH_CHAIN_JSON" | jq 'length')
log "Q2 hash-chain-breaks (siste ${HASH_CHAIN_WINDOW_HOURS}t): ${HASH_CHAIN_BREAK_COUNT}"

# ── Combine violation count ────────────────────────────────────────────────

TOTAL_VIOLATIONS=$((BALANCE_MISMATCH_COUNT + HASH_CHAIN_BREAK_COUNT))

# ── Build markdown report ──────────────────────────────────────────────────

build_report() {
  cat <<EOF
# Wallet-Integrity Watcher Report ${ISO_TS}

## Summary

- **Database:** ${WALLET_INTEGRITY_DB_URL%%\?*}  (redacted creds)
- **Balance mismatches (I1):** ${BALANCE_MISMATCH_COUNT}
- **Hash-chain breaks (I2):** ${HASH_CHAIN_BREAK_COUNT}
- **Hash-chain window:** last ${HASH_CHAIN_WINDOW_HOURS} hours
- **Total violations:** ${TOTAL_VIOLATIONS}

EOF

  if [ "$TOTAL_VIOLATIONS" -eq 0 ]; then
    cat <<EOF
## Status

All wallet invariants intact. No action required.

EOF
  fi

  if [ "$BALANCE_MISMATCH_COUNT" -gt 0 ]; then
    cat <<EOF
## I1 — Balance-sum mismatches

For each wallet listed below, \`wallet_accounts.balance\` no longer matches
the signed sum of \`wallet_entries\` for that account. This indicates either:

1. A direct INSERT/UPDATE bypassed the WalletAdapter (forbidden per
   PITFALLS §2.6 / ADR-0005 outbox).
2. A wallet-credit completed without writing the corresponding ledger entry
   (broken outbox semantics — investigate the failing TX immediately).

| Wallet ID | Stored balance | Computed from entries | Delta |
|---|---:|---:|---:|
EOF
    echo "$BALANCE_MISMATCH_JSON" | jq -r '.[] |
      "| `\(.wallet_id)` | \(.stored_balance) | \(.computed_balance) | \(.delta) |"'
    echo
  fi

  if [ "$HASH_CHAIN_BREAK_COUNT" -gt 0 ]; then
    cat <<EOF
## I2 — Hash-chain link breaks

For each row below, the stored \`previous_entry_hash\` does not match the
\`entry_hash\` of the predecessor row in the per-account chain. This is
diagnostic of either tamper (post-hoc UPDATE) or a deleted intermediate row.

Full SHA-256 re-compute is NOT performed here — it requires canonical-JSON
logic in TypeScript. The nightly \`WalletAuditVerifier\` cron handles that.
This watcher only catches the structural break, which is the faster signal.

| Wallet ID | Entry ID | Reason | Stored prev | Expected prev | Predecessor ID |
|---|---|---|---|---|---|
EOF
    echo "$HASH_CHAIN_JSON" | jq -r '.[] |
      "| `\(.wallet_id)` | `\(.entry_id)` | \(.reason) | `\(.previous_entry_hash | .[0:12])` | `\(.expected_previous | .[0:12])` | `\(.predecessor_id)` |"'
    echo
  fi

  if [ "$TOTAL_VIOLATIONS" -gt 0 ]; then
    cat <<EOF

## Recommended actions

EOF
    if [ "$BALANCE_MISMATCH_COUNT" -gt 0 ]; then
      cat <<EOF
**For balance mismatches (I1):**

1. **Do NOT mutate \`wallet_accounts.balance\` directly.** It is a generated
   stored column (\`deposit_balance + winnings_balance\`).
2. Forensics — list affected wallet's entries:
   \`\`\`sql
   SELECT id, side, account_side, amount, created_at, operation_id
     FROM wallet_entries
    WHERE account_id = '<wallet_id>'
    ORDER BY id DESC
    LIMIT 50;
   \`\`\`
3. Compare against \`wallet_outbox\` to find any unconsumed entry.
4. Investigate process logs for failed outbox-worker runs.
5. If correction needed: append-only via WalletAdapter — never UPDATE.
   See \`apps/backend/src/wallet/README.md\` §correction-procedure.

EOF
    fi
    if [ "$HASH_CHAIN_BREAK_COUNT" -gt 0 ]; then
      cat <<EOF
**For hash-chain breaks (I2):**

1. **P0 — STOP all wallet writes for the affected account** if you suspect
   tamper. Page on-call (per \`docs/operations/COMPLIANCE_INCIDENT_PROCEDURE.md\`).
2. Run the full \`WalletAuditVerifier\` for confirmation:
   \`\`\`bash
   npm --prefix apps/backend run audit:wallet-verify -- --account-id=<wallet_id>
   \`\`\`
3. Pull all rows for the account ordered by \`id\` and compare against
   audit-log + outbox replay.
4. If confirmed tamper → Lotteritilsynet within 24h per §1.1 of
   COMPLIANCE_INCIDENT_PROCEDURE.md.
5. Append-only correction. Never \`UPDATE\` or \`DELETE\` from \`wallet_entries\`.

EOF
    fi
  fi

  cat <<EOF
## Configuration

- Report retention: ${REPORT_RETENTION_HOURS} hours
- Linear dedup window: ${LINEAR_ISSUE_DEDUP_HOURS} hours per wallet_id
- Dry-run: ${DRY_RUN}
- Hash-chain re-compute (SHA-256): handled by \`WalletAuditVerifier\` nightly

---

*Generated by \`scripts/ops/wallet-integrity-watcher.sh\`. See*
*\`docs/operations/WALLET_INTEGRITY_WATCHER_RUNBOOK.md\` for full runbook.*
EOF
}

build_report > "$REPORT_FILE"
log "Wrote report to ${REPORT_FILE}"

# ── No violations → exit 0 ─────────────────────────────────────────────────

if [ "$TOTAL_VIOLATIONS" -eq 0 ]; then
  exit 0
fi

# ── DRY_RUN → log and exit 1 ───────────────────────────────────────────────

if [ "$DRY_RUN" = "1" ]; then
  log "DRY_RUN=1 — skipping Linear-issue creation. Violations present (exit 1)."
  exit 1
fi

# ── Dedup state: filter out wallet_ids we flagged within the dedup window ──

NOW_EPOCH=$(date -u +%s)
DEDUP_WINDOW_SEC=$((LINEAR_ISSUE_DEDUP_HOURS * 3600))

if [ ! -f "$STATE_FILE" ]; then
  echo '{"seen": {}}' > "$STATE_FILE"
fi

# Build a JSON shape that's friendly for the Linear-issue script + dedup.
# Combine balance + hash-chain violations into a single list keyed on wallet_id.
COMBINED_VIOLATIONS_JSON=$(jq -c -n \
  --argjson balance "$BALANCE_MISMATCH_JSON" \
  --argjson hash "$HASH_CHAIN_JSON" \
  '
    ($balance | map({
        kind: "balance_mismatch",
        wallet_id: .wallet_id,
        details: .
      })) +
    ($hash | map({
        kind: "hash_chain_break",
        wallet_id: .wallet_id,
        details: .
      }))
  ')

VIOLATIONS_TO_REPORT=$(jq -c \
  --argjson violations "$COMBINED_VIOLATIONS_JSON" \
  --argjson now_epoch "$NOW_EPOCH" \
  --argjson dedup_window_sec "$DEDUP_WINDOW_SEC" \
  '
    (.seen // {}) as $seen
    | $violations | map(
        . as $v
        | (($seen[$v.wallet_id] // null) | if . then (. | fromdate) else null end) as $last_seen
        | if $last_seen == null or (($now_epoch - $last_seen) > $dedup_window_sec) then
            $v
          else
            empty
          end
      )
  ' "$STATE_FILE")

UNDEDUP_COUNT=$(echo "$VIOLATIONS_TO_REPORT" | jq 'length')

if [ "$UNDEDUP_COUNT" -eq 0 ]; then
  log "All ${TOTAL_VIOLATIONS} violations are within dedup-window (${LINEAR_ISSUE_DEDUP_HOURS}h). Skipping Linear-issue."
  exit 1
fi

log "${UNDEDUP_COUNT} violations new since last ${LINEAR_ISSUE_DEDUP_HOURS}h — creating Linear-issue."

# Update state file
NEW_STATE=$(jq -c \
  --arg ts "$ISO_TS" \
  --argjson violations "$VIOLATIONS_TO_REPORT" \
  '
    .seen = (
      (.seen // {}) as $seen
      | reduce $violations[] as $v ($seen; .[$v.wallet_id] = $ts)
    )
  ' "$STATE_FILE")

echo "$NEW_STATE" > "$STATE_FILE"

# ── Hand off to Linear-issue script ────────────────────────────────────────

if [ -x "$LINEAR_SCRIPT" ]; then
  if "$LINEAR_SCRIPT" "$REPORT_FILE" "$VIOLATIONS_TO_REPORT"; then
    log "Linear-issue created."
  else
    log "Linear-issue creation failed (see script output). Report still on disk."
  fi
else
  log "Linear-issue script not executable at ${LINEAR_SCRIPT} — fallback: report on disk only."
fi

exit 1
