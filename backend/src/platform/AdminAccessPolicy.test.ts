import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_ACCESS_POLICY,
  assertAdminPermission,
  canAccessAdminPermission
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
