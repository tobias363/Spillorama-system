import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_ACCESS_POLICY,
  assertAdminPermission,
  assertUserHallScope,
  canAccessAdminPermission,
  resolveHallScopeFilter
} from "./AdminAccessPolicy.js";
import type { AdminPermission } from "./AdminAccessPolicy.js";
import type { UserRole } from "./PlatformService.js";

const NON_ADMIN_ROLES: UserRole[] = ["HALL_OPERATOR", "SUPPORT", "PLAYER"];

test("admin panel er tilgjengelig for driftsroller", () => {
  assert.equal(canAccessAdminPermission("ADMIN", "ADMIN_PANEL_ACCESS"), true);
  assert.equal(canAccessAdminPermission("HALL_OPERATOR", "ADMIN_PANEL_ACCESS"), true);
  assert.equal(canAccessAdminPermission("SUPPORT", "ADMIN_PANEL_ACCESS"), true);
  assert.equal(canAccessAdminPermission("PLAYER", "ADMIN_PANEL_ACCESS"), false);
});

test("ADMIN har full tilgang i policy", () => {
  for (const permission of Object.keys(ADMIN_ACCESS_POLICY) as AdminPermission[]) {
    assert.equal(canAccessAdminPermission("ADMIN", permission), true, `ADMIN mangler ${permission}`);
  }
});

test("sensitive write permissions are restricted to admin", () => {
  const adminOnlyPermissions: AdminPermission[] = [
    "GAME_CATALOG_WRITE",
    "HALL_WRITE",
    "PRIZE_POLICY_WRITE",
    "EXTRA_PRIZE_AWARD",
    "LEDGER_WRITE",
    "OVERSKUDD_READ",
    "OVERSKUDD_WRITE",
    "USER_ROLE_WRITE"
  ];
  for (const permission of adminOnlyPermissions) {
    assert.equal(canAccessAdminPermission("ADMIN", permission), true);
    for (const role of NON_ADMIN_ROLES) {
      assert.equal(
        canAccessAdminPermission(role, permission),
        false,
        `${role} should not access ${permission}`
      );
    }
  }
});

test("hall operator can run operational admin tasks but not financial policy writes", () => {
  assert.equal(canAccessAdminPermission("HALL_OPERATOR", "TERMINAL_WRITE"), true);
  assert.equal(canAccessAdminPermission("HALL_OPERATOR", "HALL_GAME_CONFIG_WRITE"), true);
  assert.equal(canAccessAdminPermission("HALL_OPERATOR", "DAILY_REPORT_RUN"), true);
  assert.equal(canAccessAdminPermission("HALL_OPERATOR", "ROOM_CONTROL_READ"), true);
  assert.equal(canAccessAdminPermission("HALL_OPERATOR", "ROOM_CONTROL_WRITE"), true);
  assert.equal(canAccessAdminPermission("HALL_OPERATOR", "GAME_SETTINGS_CHANGELOG_READ"), true);
  assert.equal(canAccessAdminPermission("HALL_OPERATOR", "PRIZE_POLICY_WRITE"), false);
  assert.equal(canAccessAdminPermission("HALL_OPERATOR", "EXTRA_PRIZE_AWARD"), false);
  assert.equal(canAccessAdminPermission("HALL_OPERATOR", "USER_ROLE_WRITE"), false);
});

test("support can handle player compliance operations but not game/economic mutation", () => {
  assert.equal(canAccessAdminPermission("SUPPORT", "WALLET_COMPLIANCE_READ"), true);
  assert.equal(canAccessAdminPermission("SUPPORT", "WALLET_COMPLIANCE_WRITE"), true);
  assert.equal(canAccessAdminPermission("SUPPORT", "EXTRA_DRAW_DENIALS_READ"), true);
  assert.equal(canAccessAdminPermission("SUPPORT", "GAME_SETTINGS_CHANGELOG_READ"), true);
  assert.equal(canAccessAdminPermission("SUPPORT", "HALL_GAME_CONFIG_WRITE"), false);
  assert.equal(canAccessAdminPermission("SUPPORT", "LEDGER_WRITE"), false);
  assert.equal(canAccessAdminPermission("SUPPORT", "ROOM_CONTROL_WRITE"), false);
  assert.equal(canAccessAdminPermission("SUPPORT", "GAME_CATALOG_WRITE"), false);
});

test("policy entries only include known roles", () => {
  const knownRoles: UserRole[] = ["ADMIN", "HALL_OPERATOR", "SUPPORT", "PLAYER"];
  for (const permission of Object.keys(ADMIN_ACCESS_POLICY) as AdminPermission[]) {
    for (const role of ADMIN_ACCESS_POLICY[permission]) {
      assert.equal(knownRoles.includes(role), true, `${permission} has unknown role ${role}`);
    }
  }
});

test("assertAdminPermission avviser ulovlige writes for operator/support", () => {
  assert.throws(() => assertAdminPermission("HALL_OPERATOR", "GAME_CATALOG_WRITE"));
  assert.throws(() => assertAdminPermission("SUPPORT", "GAME_CATALOG_WRITE"));
  assert.throws(() => assertAdminPermission("SUPPORT", "HALL_WRITE"));
});

// ── BIN-587 B2.2: KYC-moderasjon permissions ────────────────────────────────

test("BIN-587 B2.2: PLAYER_KYC_READ tillatt for ADMIN + SUPPORT, ikke HALL_OPERATOR/PLAYER", () => {
  assert.equal(canAccessAdminPermission("ADMIN", "PLAYER_KYC_READ"), true);
  assert.equal(canAccessAdminPermission("SUPPORT", "PLAYER_KYC_READ"), true);
  assert.equal(canAccessAdminPermission("HALL_OPERATOR", "PLAYER_KYC_READ"), false);
  assert.equal(canAccessAdminPermission("PLAYER", "PLAYER_KYC_READ"), false);
});

test("BIN-587 B2.2: PLAYER_KYC_MODERATE tillatt for ADMIN + SUPPORT, ikke HALL_OPERATOR/PLAYER", () => {
  assert.equal(canAccessAdminPermission("ADMIN", "PLAYER_KYC_MODERATE"), true);
  assert.equal(canAccessAdminPermission("SUPPORT", "PLAYER_KYC_MODERATE"), true);
  assert.equal(canAccessAdminPermission("HALL_OPERATOR", "PLAYER_KYC_MODERATE"), false);
  assert.equal(canAccessAdminPermission("PLAYER", "PLAYER_KYC_MODERATE"), false);
});

test("BIN-587 B2.2: PLAYER_KYC_OVERRIDE kun ADMIN (destructive-path)", () => {
  assert.equal(canAccessAdminPermission("ADMIN", "PLAYER_KYC_OVERRIDE"), true);
  assert.equal(canAccessAdminPermission("SUPPORT", "PLAYER_KYC_OVERRIDE"), false);
  assert.equal(canAccessAdminPermission("HALL_OPERATOR", "PLAYER_KYC_OVERRIDE"), false);
  assert.equal(canAccessAdminPermission("PLAYER", "PLAYER_KYC_OVERRIDE"), false);
});

test("BIN-587 B2.2: assertAdminPermission kaster for HALL_OPERATOR på KYC-endepunkter", () => {
  assert.throws(() => assertAdminPermission("HALL_OPERATOR", "PLAYER_KYC_READ"));
  assert.throws(() => assertAdminPermission("HALL_OPERATOR", "PLAYER_KYC_MODERATE"));
  assert.throws(() => assertAdminPermission("HALL_OPERATOR", "PLAYER_KYC_OVERRIDE"));
  assert.throws(() => assertAdminPermission("SUPPORT", "PLAYER_KYC_OVERRIDE"));
});

// ── BIN-587 B2.3: lifecycle permission ──────────────────────────────────────

test("BIN-587 B2.3: PLAYER_LIFECYCLE_WRITE tillatt for ADMIN + SUPPORT, ikke HALL_OPERATOR/PLAYER", () => {
  assert.equal(canAccessAdminPermission("ADMIN", "PLAYER_LIFECYCLE_WRITE"), true);
  assert.equal(canAccessAdminPermission("SUPPORT", "PLAYER_LIFECYCLE_WRITE"), true);
  assert.equal(canAccessAdminPermission("HALL_OPERATOR", "PLAYER_LIFECYCLE_WRITE"), false);
  assert.equal(canAccessAdminPermission("PLAYER", "PLAYER_LIFECYCLE_WRITE"), false);
});

test("BIN-587 B2.3: assertAdminPermission kaster for HALL_OPERATOR på lifecycle-write", () => {
  assert.throws(() => assertAdminPermission("HALL_OPERATOR", "PLAYER_LIFECYCLE_WRITE"));
  assert.throws(() => assertAdminPermission("PLAYER", "PLAYER_LIFECYCLE_WRITE"));
});

// ── BIN-587 B3-aml: AML permissions ──────────────────────────────────────

test("BIN-587 B3-aml: PLAYER_AML_READ tillatt for ADMIN + SUPPORT, ikke HALL_OPERATOR/PLAYER", () => {
  assert.equal(canAccessAdminPermission("ADMIN", "PLAYER_AML_READ"), true);
  assert.equal(canAccessAdminPermission("SUPPORT", "PLAYER_AML_READ"), true);
  assert.equal(canAccessAdminPermission("HALL_OPERATOR", "PLAYER_AML_READ"), false);
  assert.equal(canAccessAdminPermission("PLAYER", "PLAYER_AML_READ"), false);
});

test("BIN-587 B3-aml: PLAYER_AML_WRITE tillatt for ADMIN + SUPPORT, ikke HALL_OPERATOR/PLAYER", () => {
  assert.equal(canAccessAdminPermission("ADMIN", "PLAYER_AML_WRITE"), true);
  assert.equal(canAccessAdminPermission("SUPPORT", "PLAYER_AML_WRITE"), true);
  assert.equal(canAccessAdminPermission("HALL_OPERATOR", "PLAYER_AML_WRITE"), false);
  assert.equal(canAccessAdminPermission("PLAYER", "PLAYER_AML_WRITE"), false);
});

test("BIN-587 B3-aml: assertAdminPermission kaster for HALL_OPERATOR på AML-endepunkter", () => {
  assert.throws(() => assertAdminPermission("HALL_OPERATOR", "PLAYER_AML_READ"));
  assert.throws(() => assertAdminPermission("HALL_OPERATOR", "PLAYER_AML_WRITE"));
  assert.throws(() => assertAdminPermission("PLAYER", "PLAYER_AML_READ"));
  assert.throws(() => assertAdminPermission("PLAYER", "PLAYER_AML_WRITE"));
});

// ── BIN-591: hall-scope ─────────────────────────────────────────────────────

test("BIN-591: ADMIN har alltid hall-scope (global)", () => {
  assert.doesNotThrow(() => assertUserHallScope({ role: "ADMIN", hallId: null }, "hall-a"));
  assert.doesNotThrow(() => assertUserHallScope({ role: "ADMIN", hallId: "hall-x" }, "hall-b"));
});

test("BIN-591: SUPPORT har global hall-scope (read-only)", () => {
  assert.doesNotThrow(() => assertUserHallScope({ role: "SUPPORT", hallId: null }, "hall-a"));
  assert.doesNotThrow(() => assertUserHallScope({ role: "SUPPORT", hallId: "hall-x" }, "hall-b"));
});

test("BIN-591: HALL_OPERATOR tildelt Hall A når hall-scope matcher", () => {
  assert.doesNotThrow(() =>
    assertUserHallScope({ role: "HALL_OPERATOR", hallId: "hall-a" }, "hall-a")
  );
});

test("BIN-591: HALL_OPERATOR får FORBIDDEN ved mismatch", () => {
  assert.throws(
    () => assertUserHallScope({ role: "HALL_OPERATOR", hallId: "hall-a" }, "hall-b"),
    /Du har ikke tilgang/
  );
});

test("BIN-591: HALL_OPERATOR uten tildelt hall fail-closed", () => {
  assert.throws(
    () => assertUserHallScope({ role: "HALL_OPERATOR", hallId: null }, "hall-a"),
    /ikke tildelt en hall/
  );
});

test("BIN-591: PLAYER får FORBIDDEN på hall-scope-check", () => {
  assert.throws(
    () => assertUserHallScope({ role: "PLAYER", hallId: null }, "hall-a"),
    /ikke tilgang/
  );
});

test("BIN-591: resolveHallScopeFilter returnerer undefined for ADMIN uten filter", () => {
  assert.equal(resolveHallScopeFilter({ role: "ADMIN", hallId: null }), undefined);
});

test("BIN-591: resolveHallScopeFilter respekterer ADMIN eksplisitt filter", () => {
  assert.equal(
    resolveHallScopeFilter({ role: "ADMIN", hallId: null }, "hall-c"),
    "hall-c"
  );
});

test("BIN-591: resolveHallScopeFilter tvinger HALL_OPERATOR til egen hall", () => {
  assert.equal(
    resolveHallScopeFilter({ role: "HALL_OPERATOR", hallId: "hall-a" }),
    "hall-a"
  );
  assert.equal(
    resolveHallScopeFilter({ role: "HALL_OPERATOR", hallId: "hall-a" }, "hall-a"),
    "hall-a"
  );
});

test("BIN-591: resolveHallScopeFilter avviser HALL_OPERATOR som prøver annen hall", () => {
  assert.throws(
    () =>
      resolveHallScopeFilter(
        { role: "HALL_OPERATOR", hallId: "hall-a" },
        "hall-b"
      ),
    /ikke tilgang til denne hallen/
  );
});

test("BIN-591: resolveHallScopeFilter fail-closed for HALL_OPERATOR uten tildelt hall", () => {
  assert.throws(
    () => resolveHallScopeFilter({ role: "HALL_OPERATOR", hallId: null }),
    /ikke tildelt en hall/
  );
});
