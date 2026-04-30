# Schema-conflict verification — 2026-04-29

**Owner:** Schema-archaeology agent (read-only verification)
**Status:** READY FOR PM-EXECUTION. Run BEFORE the fix-script.
**Linked:**
- `docs/operations/SCHEMA_ARCHAEOLOGY_2026-04-29.md` §6.1–6.4 — original conflict descriptions.
- `docs/operations/schema-archaeology-fix.sql` — the fix script that the §6 conflicts gate.

---

## Why this doc exists

`SCHEMA_ARCHAEOLOGY_2026-04-29.md` §6 lists four "kjente konflikter / advarsler" but only describes them in prose. Before flipping the fix-script from ROLLBACK to COMMIT we need to know which historical migration "won" on prod for each conflict — the answer determines whether it is safe to register both rows in `pgmigrations`, or whether one of them implies a missing schema effect we must repair separately.

Each conflict below has:

1. **What's in conflict** — the specific divergence between two migrations
2. **Why it matters** — what could be wrong if we register the migration without checking
3. **Verification query** — copy-paste, READ-ONLY SELECT
4. **Decision tree** — how to interpret each possible output

All queries are pure SELECTs. Run via:

```bash
psql "$PROD_PG_URL" -X -v ON_ERROR_STOP=1 -c "<query>"
```

(`-X` skips `~/.psqlrc`; `-v ON_ERROR_STOP=1` stops on first error.)

---

## §6.1 — `app_users.hall_id` FK-policy

### What's in conflict

Both migrations create the column `app_users.hall_id`:

- **`20260417000007_user_hall_binding.sql`**: adds `REFERENCES app_halls(id) ON DELETE RESTRICT` plus a CHECK-constraint `chk_app_users_hall_operator_has_hall` requiring `(role = 'HALL_OPERATOR' AND hall_id IS NOT NULL) OR role <> 'HALL_OPERATOR'`.
- **`20260418170000_user_hall_scope.sql`**: adds `REFERENCES app_halls(id) ON DELETE SET NULL` (no CHECK). Has `IF NOT EXISTS` and an in-file comment explicitly noting it was partially applied during earlier failed migrate attempts.

The fix-script's TABLE/COLUMN fingerprint (`information_schema.columns`) cannot tell which one ran — it only sees that the column exists.

### Why it matters

- **Regulatorisk:** HALL_OPERATOR's binding to a hall is a security-critical invariant for `AdminAccessPolicy.assertHallScope`. If the CHECK-constraint is missing, an operator row with `hall_id = NULL` can pass the API auth and still bypass hall-scope validation when writing to ledger-critical endpoints.
- **Operasjonelt:** Different ON DELETE policies (`RESTRICT` vs `SET NULL`) materially change what happens when a hall is removed. RESTRICT blocks deletion if any operators reference the hall; SET NULL silently de-binds operators.

If we register `20260417000007` as "applied" but the CHECK constraint is actually missing on prod, future migrations that depend on that invariant could inherit silent corruption.

### Verification query

```sql
-- Read FK-policy and CHECK-constraints on app_users.hall_id
\set QUIET on
SELECT
  'FK on app_users.hall_id'                              AS check_kind,
  tc.constraint_name,
  rc.delete_rule                                         AS on_delete,
  rc.update_rule                                         AS on_update,
  ccu.table_name || '.' || ccu.column_name               AS references
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.table_name = 'app_users'
  AND tc.constraint_type = 'FOREIGN KEY'
  AND kcu.column_name = 'hall_id'

UNION ALL

SELECT
  'CHECK on app_users.role/hall_id'                      AS check_kind,
  conname                                                AS constraint_name,
  pg_get_constraintdef(oid)                              AS on_delete,
  NULL                                                   AS on_update,
  NULL                                                   AS references
FROM pg_constraint
WHERE conrelid = 'public.app_users'::regclass
  AND contype  = 'c'
  AND (
    conname  LIKE '%hall%'
    OR pg_get_constraintdef(oid) LIKE '%hall_id%'
  );
```

### Decision tree

| Case | Output | What it means | Action |
|------|--------|---------------|--------|
| **A** | FK shows `on_delete = RESTRICT`, AND a CHECK with `chk_app_users_hall_operator_has_hall` (or matching pattern) IS present | `20260417000007` was the last migration to touch this column. CHECK is enforced. | Safe to register both `20260417000007` and `20260418170000`. Document in PR-body: "FK-policy is RESTRICT (from 20260417000007); 20260418170000 is a no-op idempotent re-application." |
| **B** | FK shows `on_delete = SET NULL`, AND no `chk_app_users_hall_operator_has_hall` CHECK | `20260418170000` was the last migration. CHECK is **MISSING** — this is a security gap. | **STOP** — do NOT register either migration via fix-script. File a high-priority Linear issue: "Restore CHECK constraint chk_app_users_hall_operator_has_hall on app_users (regulatory-critical invariant)." Create a forward migration to add the CHECK back. Then resume fix-script work. |
| **C** | FK shows `on_delete = SET NULL`, AND CHECK IS present | Mixed state — the column was first created by 20260417000007 (CHECK got added) then 20260418170000 dropped+re-added the FK with weaker policy (CHECK persisted because it's a separate constraint). | Safe to register both. Document the FK-policy weakening in PR-body. Optionally schedule a follow-up to restore RESTRICT if pengespillforskriften §-compliance demands it. |
| **D** | No FK on hall_id, OR no `app_users.hall_id` column at all | Neither migration applied schema. | **STOP** — do not register. Re-run inspect-script Section 4 for `20260417000007_user_hall_binding` and `20260418170000_user_hall_scope` — both should report `schema_live=NO`. Eskaler til Tobias. |
| **E** | Multiple FKs on hall_id (count > 1) | A bug — both migrations added separate FKs. | **STOP** — manual cleanup needed. File issue + manually drop the duplicate FK before proceeding. |

### What "passing" looks like (Case A or C)

```
       check_kind         |        constraint_name         |  on_delete   | …
--------------------------+--------------------------------+--------------+
 FK on app_users.hall_id  | app_users_hall_id_fkey         | RESTRICT     | (or SET NULL)
 CHECK on app_users…      | chk_app_users_hall_operator_   | CHECK …      |
```

---

## §6.2 — `app_hall_groups` schema (created by 2 migrations)

### What's in conflict

Both migrations create `app_hall_groups`:

- **`20260416000001_multi_hall_linked_draws.sql`** (BIN-515): `(id, name, public_code, tv_broadcast_id, status, created_at, archived_at, updated_at)`. Status CHECK = `('ACTIVE', 'ARCHIVED')`.
- **`20260424000000_hall_groups.sql`** (BIN-665): `(id, legacy_group_hall_id, name, status, tv_id, deleted_at, ...)`. Status CHECK = `('active', 'inactive')`. Has explicit comment that BIN-515's smaller schema must be extended with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` to be idempotent across both creation orders.

The two migrations are intended to be **complementary** (BIN-665 extends BIN-515's table), not conflicting. But because of the partial-commit history we don't know if BIN-665's ALTER-COLUMN-IF-NOT-EXISTS chain actually ran on prod.

### Why it matters

- **Code dependency:** Service-layer code (BIN-665) reads `deleted_at` (soft-delete marker) and `legacy_group_hall_id`. If BIN-665's ALTER-statements didn't run, those columns are missing — runtime queries will fail with `column does not exist` errors when admin opens HallGroup CRUD.
- **Data integrity:** BIN-665's `status = 'active'/'inactive'` (lowercase) vs BIN-515's `status = 'ACTIVE'/'ARCHIVED'` — if both CHECK-constraints are present, ANY insert fails because no value satisfies both. If only BIN-515's is present, BIN-665's service-layer-default value (`'active'`) won't pass.

### Verification query

```sql
-- Read columns + CHECK-constraints on app_hall_groups
SELECT
  'COLUMN' AS check_kind,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'app_hall_groups'
ORDER BY ordinal_position;

SELECT
  'CHECK' AS check_kind,
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.app_hall_groups'::regclass
  AND contype = 'c'
ORDER BY conname;
```

### Decision tree

| Case | Output | What it means | Action |
|------|--------|---------------|--------|
| **A** | Columns include all of: `id, legacy_group_hall_id, name, status, tv_id, deleted_at` AND only one CHECK on `status` (either BIN-515's `ACTIVE/ARCHIVED` or BIN-665's `active/inactive`) | One of the two ran; the other is a no-op idempotent re-application thanks to `IF NOT EXISTS`. The schema is in usable state for whichever variant won. | Safe to register both migrations. Document in PR-body: "app_hall_groups final schema matches [BIN-515 / BIN-665] — verified via columns + CHECK." |
| **B** | Columns missing `deleted_at` and/or `legacy_group_hall_id` | BIN-665's ALTER statements did NOT run. Service code that uses these columns will break. | **STOP** — do NOT register `20260424000000_hall_groups`. Let Render-deploy run the migration body normally on next deploy. Manually verify that `npm run migrate up` re-applies the ALTER statements idempotently. |
| **C** | Two CHECK-constraints on `status` with conflicting allowed-values (e.g. one accepts `'ACTIVE'` and another accepts `'active'`) | Both migrations wrote their CHECK and neither dropped the other. Inserts will fail. | **STOP** — file urgent Linear issue. Manual fix: `ALTER TABLE app_hall_groups DROP CONSTRAINT <legacy-check>;` for whichever one is the older variant. Then resume fix-script work. |
| **D** | Status CHECK uses lowercase `'active'/'inactive'` but BIN-515 has not been registered AND its other columns missing | BIN-665 ran without BIN-515 ever applying. | Acceptable — register `20260424000000_hall_groups` only. Mark `20260416000001` as still-pending in PR-body for next deploy to apply it idempotently (its `IF NOT EXISTS` guards make this safe). |
| **E** | `app_hall_groups` table doesn't exist at all | Neither migration applied. | **STOP** — re-verify inspect-script and check Render-deploy logs. Likely Render never successfully deployed BIN-515. Let next deploy apply normally. |

### What "passing" looks like (Case A — BIN-665 final state)

```
 check_kind |     column_name     | data_type | …
------------+---------------------+-----------+
 COLUMN     | id                  | text      |
 COLUMN     | legacy_group_hall_id| text      |
 COLUMN     | name                | text      |
 COLUMN     | status              | text      |
 COLUMN     | tv_id               | integer   |
 COLUMN     | deleted_at          | timestamp |
 …

 check_kind |    constraint_name    | definition
------------+-----------------------+----------------------------------
 CHECK      | app_hall_groups_status| CHECK ((status IN ('active', 'inactive')))
```

---

## §6.3 — `app_regulatory_ledger` immutability triggers

### What's in conflict

Migration `20260417000005_regulatory_ledger.sql` creates the `app_regulatory_ledger` table AND 3 triggers that block UPDATE/DELETE/TRUNCATE:

```
trg_app_regulatory_ledger_no_update    (BEFORE UPDATE)
trg_app_regulatory_ledger_no_delete    (BEFORE DELETE)
trg_app_regulatory_ledger_no_truncate  (BEFORE TRUNCATE)
```

If the migration was applied via boot-time `initializeSchema()` (i.e. `PostgresBingoSystemAdapter.initializeSchema()`) instead of via `npm run migrate`, the boot-DDL **only creates the table + indexes**. The triggers are NOT in the boot-DDL — they exist only in the migration file.

The fix-script's TABLE fingerprint `app_regulatory_ledger` cannot tell whether the triggers were created or not — it only checks that the table exists.

### Why it matters

- **Regulatorisk:** The triggers are the in-database enforcement of "append-only ledger" — a core compliance invariant under pengespillforskriften. Without them, a SQL admin could quietly mutate or delete regulatory entries. The hash-chain in app-code provides defense-in-depth, but the triggers are the database-side guarantee.
- **Critical:** If the fix-script registers `20260417000005_regulatory_ledger` as "applied" while the triggers are missing, future `migrate up` runs will skip the migration body and the triggers will remain missing forever. This is a silent, persistent regulatory gap.

### Verification query

> **NOTE:** We use `pg_trigger` rather than `information_schema.triggers`
> because the latter omits statement-level triggers (TRUNCATE). All 3
> triggers MUST be present — including the TRUNCATE trigger — to
> guarantee §-71 append-only invariance.

```sql
-- Read all triggers on app_regulatory_ledger (including TRUNCATE).
SELECT
  tgname AS trigger_name,
  CASE
    WHEN tgtype &  4 != 0 THEN 'INSERT'
    WHEN tgtype &  8 != 0 THEN 'DELETE'
    WHEN tgtype & 16 != 0 THEN 'UPDATE'
    WHEN tgtype & 32 != 0 THEN 'TRUNCATE'
    ELSE 'OTHER'
  END                                AS event,
  CASE
    WHEN tgtype &  2 != 0 THEN 'BEFORE'
    WHEN tgtype & 64 != 0 THEN 'INSTEAD OF'
    ELSE 'AFTER'
  END                                AS timing,
  CASE WHEN tgtype & 1 != 0 THEN 'ROW' ELSE 'STATEMENT' END AS orientation,
  CASE tgenabled
    WHEN 'O' THEN 'ENABLED'
    WHEN 'D' THEN 'DISABLED'
    WHEN 'R' THEN 'REPLICA-ONLY'
    WHEN 'A' THEN 'ALWAYS'
  END                                AS enabled_state
FROM pg_trigger
WHERE tgrelid = 'public.app_regulatory_ledger'::regclass
  AND NOT tgisinternal
ORDER BY tgname;

-- Cross-check: function exists?
SELECT
  proname AS function_name,
  pg_get_functiondef(oid) AS body
FROM pg_proc
WHERE proname = 'app_regulatory_ledger_block_mutation';
```

### Decision tree

| Case | Output | What it means | Action |
|------|--------|---------------|--------|
| **A** | 3 triggers (`trg_app_regulatory_ledger_no_update`, `_no_delete`, `_no_truncate`) AND function `app_regulatory_ledger_block_mutation` exists | Migration ran in full (either via Render-deploy or fully via `tools/schema-sync-2026-04-26.sql` partial commit). | Safe to register `20260417000005_regulatory_ledger`. Compliance integrity intact. |
| **B** | 0 triggers, but the table `app_regulatory_ledger` exists | Migration ran via boot-DDL (or partial commit) — table created but triggers were skipped. **Regulatorisk gap.** | **STOP — DO NOT register the migration via fix-script.** Allow next Render-deploy to re-apply the migration; the trigger creation is idempotent (`DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`). Add a verification step to MIGRATION_DEPLOY_RUNBOOK: post-deploy run this query to confirm 3 triggers exist. |
| **C** | Some but not all 3 triggers (e.g. only `_no_update` and `_no_delete`, missing `_no_truncate`) | Partial application of the trigger block. | **STOP** — same action as Case B. |
| **D** | Function `app_regulatory_ledger_block_mutation` MISSING but triggers exist | Highly unusual. The triggers reference the function — if function is gone, any mutation attempt would fail with "function does not exist" instead of the intended RAISE EXCEPTION message. | Investigate — possibly the function was dropped manually. Recreate via the migration body (re-apply on next deploy). |
| **E** | `app_regulatory_ledger` table doesn't exist | Migration didn't run at all (this contradicts Section 7 of the inspect output, which confirmed it exists). | Re-verify inspect-output. |

### What "passing" looks like (Case A)

```
             trigger_name              |  event   | timing | orientation | enabled_state
---------------------------------------+----------+--------+-------------+---------------
 trg_app_regulatory_ledger_no_delete   | DELETE   | BEFORE | ROW         | ENABLED
 trg_app_regulatory_ledger_no_truncate | TRUNCATE | BEFORE | STATEMENT   | ENABLED
 trg_app_regulatory_ledger_no_update   | UPDATE   | BEFORE | ROW         | ENABLED
```

(All three rows present, all `enabled_state = ENABLED`.)

---

## §6.4 — `wallet_*` CHECK-constraints (currency = 'NOK' guard)

### What's in conflict

Migration `20260926000000_wallet_currency_readiness.sql` (BIN-766) adds:

- Column `currency TEXT NOT NULL DEFAULT 'NOK'` to `wallet_accounts`, `wallet_transactions`, `wallet_entries`.
- CHECK-constraints named `wallet_accounts_currency_nok_only`, `wallet_transactions_currency_nok_only`, `wallet_entries_currency_nok_only`, each enforcing `currency = 'NOK'`.

Per `SCHEMA_ARCHAEOLOGY_2026-04-29.md` §6.4: PR #715 fixed `PostgresWalletAdapter.initializeSchema()` which previously had a `DROP CONSTRAINT + ADD CONSTRAINT` pattern that ran at every cold-boot. Before PR #715 the constraint could "flicker" out and back in — and during a brief window, the CHECK was not enforced.

The fix-script's COLUMN fingerprint (`wallet_accounts.currency`) cannot tell whether the CHECK is present.

### Why it matters

- **Regulatorisk:** The `currency = 'NOK'` CHECK is the in-database guarantee that no transaction can be written in a foreign currency before multi-currency support is implemented. Spillorama is NOK-only by design (pengespillforskriften licensing); a non-NOK row would be a regulatory violation.
- **Risk profile:** Lower than §6.3 because (a) app-code only writes NOK and (b) the CHECK is on three tables — at least one usually catches a mismatch even if another is missing. But for completeness we verify all three.

### Verification query

```sql
-- Read CHECK-constraints on wallet_accounts, wallet_transactions, wallet_entries
SELECT
  conrelid::regclass::text AS table_name,
  conname                  AS constraint_name,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN (
  'public.wallet_accounts'::regclass,
  'public.wallet_transactions'::regclass,
  'public.wallet_entries'::regclass
)
  AND contype = 'c'
  AND conname LIKE '%currency%'
ORDER BY table_name, constraint_name;

-- Side-check: confirm currency column exists with default 'NOK'
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('wallet_accounts', 'wallet_transactions', 'wallet_entries')
  AND column_name = 'currency'
ORDER BY table_name;
```

### Decision tree

| Case | Output | What it means | Action |
|------|--------|---------------|--------|
| **A** | All 3 CHECK-constraints present (`wallet_accounts_currency_nok_only`, `wallet_transactions_currency_nok_only`, `wallet_entries_currency_nok_only`) with definition `CHECK ((currency = 'NOK'::text))` AND the `currency` column exists on all 3 tables with default `'NOK'` | Migration ran fully. | Safe to register `20260926000000_wallet_currency_readiness`. |
| **B** | Currency columns exist but 1 or more CHECK-constraints are missing | Boot-DDL created the columns; the CHECK might have been dropped during the pre-PR-#715 flicker window. | **STOP** — do NOT register the migration. Let Render-deploy run it normally; the migration body is idempotent (`ADD COLUMN IF NOT EXISTS`, `ADD CONSTRAINT IF NOT EXISTS`). |
| **C** | All 3 CHECK-constraints present BUT the constraint definition is `CHECK ((currency IN ('NOK', 'EUR', ...)))` (multi-currency enabled) | Some future migration has lifted the NOK-only restriction. | **CRITICAL** — investigate. There is no migration in `apps/backend/migrations/` that lifts this CHECK as of this audit. If found, eskaler til Tobias for regulatorisk review. |
| **D** | Currency column missing on one or more wallet tables | Migration body did not run on prod. | Skip registering. Let Render-deploy apply. |
| **E** | Currency column exists with default that is NOT `'NOK'` (e.g. NULL, or `''`) | Schema-drift; some migration has changed the default. | **STOP** — investigate. |

### What "passing" looks like (Case A)

```
     table_name      |          constraint_name           |             definition
---------------------+------------------------------------+--------------------------------------
 wallet_accounts     | wallet_accounts_currency_nok_only  | CHECK ((currency = 'NOK'::text))
 wallet_entries      | wallet_entries_currency_nok_only   | CHECK ((currency = 'NOK'::text))
 wallet_transactions | wallet_transactions_currency_nok_… | CHECK ((currency = 'NOK'::text))
```

---

## Summary table — when each conflict gates the fix-script

| § | Trigger to register fix-script row | If gated, what to do instead |
|---|---|---|
| 6.1 | Case A or C: register both `20260417000007` + `20260418170000` | Case B (CHECK missing): file Linear issue, write forward migration to restore CHECK |
| 6.2 | Case A: register both `20260416000001` + `20260424000000` | Case B (BIN-665 columns missing): skip `20260424000000`, let next deploy apply |
| 6.3 | Case A only: register `20260417000005` | Case B/C (triggers missing): SKIP `20260417000005`, let next deploy apply |
| 6.4 | Case A only: register `20260926000000` | Case B (CHECK missing): SKIP `20260926000000`, let next deploy apply |

If any of §6.1–§6.4 lands in a "STOP" case, **edit the fix-script's STEP 2 candidates list** to remove the affected migration BEFORE running. Otherwise the fix-script will register the migration as "applied" and prevent Render-deploy from re-running the body to repair the missing constraint/trigger.

---

## How to consume this document

1. Read inspect-output (`/tmp/schema-inspect.out`) and confirm each of `20260417000005_regulatory_ledger`, `20260417000007_user_hall_binding`, `20260418170000_user_hall_scope`, `20260424000000_hall_groups`, `20260926000000_wallet_currency_readiness` shows `schema_live=YES`. (If they are `NO`, they're not gated by this doc — fix-script wouldn't register them anyway.)
2. Run §6.1, §6.2, §6.3, §6.4 verification queries — read-only, no side effects, ~5 minutes total.
3. For each, walk the Decision tree to choose Case A/B/C/etc. Record the case in the PR body.
4. If any case is **STOP**, edit `schema-archaeology-fix.sql` STEP 2's candidate list to comment out the problematic row, OR abort fix-script entirely.
5. Re-run dry-run of fix-script (now with potentially fewer rows). Verify `rows_out_of_order = 0` after STEP 5.
6. Flip ROLLBACK → COMMIT and run for real.
7. After commit, re-run §6.1-§6.4 verification queries one more time as a post-commit smoke check — they should produce identical output to step 2 (no schema mutated).
