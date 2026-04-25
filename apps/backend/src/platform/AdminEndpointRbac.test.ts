import assert from "node:assert/strict";
import test from "node:test";
import { canAccessAdminPermission } from "./AdminAccessPolicy.js";
import type { AdminPermission } from "./AdminAccessPolicy.js";
import type { UserRole } from "./PlatformService.js";

interface EndpointPolicyCase {
  endpoint: string;
  permission: AdminPermission;
  allowedRoles: UserRole[];
}

// Viktige admin-endepunkter med forventet permission-guard.
const ENDPOINT_POLICY_CASES: EndpointPolicyCase[] = [
  {
    endpoint: "GET /api/admin/settings/catalog",
    permission: "GAME_CATALOG_READ",
    allowedRoles: ["ADMIN", "HALL_OPERATOR", "SUPPORT"]
  },
  {
    endpoint: "GET /api/admin/settings/games/:slug",
    permission: "GAME_CATALOG_READ",
    allowedRoles: ["ADMIN", "HALL_OPERATOR", "SUPPORT"]
  },
  {
    endpoint: "PUT /api/admin/settings/games/:slug",
    permission: "GAME_CATALOG_WRITE",
    allowedRoles: ["ADMIN"]
  },
  {
    endpoint: "PUT /api/admin/games/:slug",
    permission: "GAME_CATALOG_WRITE",
    allowedRoles: ["ADMIN"]
  },
  {
    endpoint: "POST /api/admin/halls",
    permission: "HALL_WRITE",
    allowedRoles: ["ADMIN"]
  },
  {
    endpoint: "PUT /api/admin/halls/:hallId",
    permission: "HALL_WRITE",
    allowedRoles: ["ADMIN"]
  },
  {
    endpoint: "POST /api/admin/terminals",
    permission: "TERMINAL_WRITE",
    allowedRoles: ["ADMIN", "HALL_OPERATOR"]
  },
  {
    endpoint: "PUT /api/admin/halls/:hallId/game-config/:gameSlug",
    permission: "HALL_GAME_CONFIG_WRITE",
    allowedRoles: ["ADMIN", "HALL_OPERATOR"]
  },
  {
    endpoint: "POST /api/admin/rooms",
    permission: "ROOM_CONTROL_WRITE",
    allowedRoles: ["ADMIN", "HALL_OPERATOR"]
  },
  {
    endpoint: "PUT /api/admin/wallets/:walletId/loss-limits",
    permission: "WALLET_COMPLIANCE_WRITE",
    allowedRoles: ["ADMIN", "SUPPORT"]
  },
  {
    endpoint: "PUT /api/admin/prize-policy",
    permission: "PRIZE_POLICY_WRITE",
    allowedRoles: ["ADMIN"]
  },
  {
    endpoint: "POST /api/admin/wallets/:walletId/extra-prize",
    permission: "EXTRA_PRIZE_AWARD",
    allowedRoles: ["ADMIN"]
  },
  {
    endpoint: "GET /api/admin/game-settings/change-log",
    permission: "GAME_SETTINGS_CHANGELOG_READ",
    allowedRoles: ["ADMIN", "HALL_OPERATOR", "SUPPORT"]
  },
  // BIN-587 B3.1: reports v2 + dashboard historical
  {
    endpoint: "GET /api/admin/reports/revenue",
    permission: "DAILY_REPORT_READ",
    allowedRoles: ["ADMIN", "HALL_OPERATOR", "SUPPORT"]
  },
  {
    endpoint: "GET /api/admin/reports/halls/:hallId/summary",
    permission: "DAILY_REPORT_READ",
    allowedRoles: ["ADMIN", "HALL_OPERATOR", "SUPPORT"]
  },
  {
    endpoint: "GET /api/admin/reports/games/:gameSlug/drill-down",
    permission: "DAILY_REPORT_READ",
    allowedRoles: ["ADMIN", "HALL_OPERATOR", "SUPPORT"]
  },
  {
    endpoint: "GET /api/admin/reports/games/:gameSlug/sessions",
    permission: "DAILY_REPORT_READ",
    allowedRoles: ["ADMIN", "HALL_OPERATOR", "SUPPORT"]
  },
  {
    endpoint: "GET /api/admin/dashboard/time-series",
    permission: "DAILY_REPORT_READ",
    allowedRoles: ["ADMIN", "HALL_OPERATOR", "SUPPORT"]
  },
  {
    endpoint: "GET /api/admin/dashboard/top-players",
    permission: "DAILY_REPORT_READ",
    allowedRoles: ["ADMIN", "HALL_OPERATOR", "SUPPORT"]
  },
  {
    endpoint: "GET /api/admin/dashboard/game-history",
    permission: "DAILY_REPORT_READ",
    allowedRoles: ["ADMIN", "HALL_OPERATOR", "SUPPORT"]
  },
  {
    // BIN-618: top-5 by current wallet-balance (legacy Dashboard.js widget).
    // Separate from /api/admin/dashboard/top-players which ranks by stake
    // over a date-range.
    endpoint: "GET /api/admin/players/top",
    permission: "DAILY_REPORT_READ",
    allowedRoles: ["ADMIN", "HALL_OPERATOR", "SUPPORT"]
  },
  {
    // GAP #4: per-spiller game-management-detail aggregat. Sentralisert
    // spillerprofil-domain (samme PLAYER_KYC_READ-gate som game-history /
    // chips-history). HALL_OPERATOR er bevisst utelatt.
    endpoint: "GET /api/admin/players/:userId/game-management-detail",
    permission: "PLAYER_KYC_READ",
    allowedRoles: ["ADMIN", "SUPPORT"]
  },
  {
    // GAP #16: manual winning admin override. Strict ADMIN-only via
    // EXTRA_PRIZE_AWARD — same gate som /api/admin/wallets/:walletId/extra-prize
    // siden manual-winning routes through engine.awardExtraPrize (legitim
    // payout-flow med EXTRA_PRIZE compliance-entry, IKKE direkte
    // admin-credit til winnings — ADMIN_WINNINGS_CREDIT_FORBIDDEN).
    endpoint: "POST /api/admin/games/:gameId/manual-winning",
    permission: "EXTRA_PRIZE_AWARD",
    allowedRoles: ["ADMIN"]
  }
];

const ALL_ROLES: UserRole[] = ["ADMIN", "HALL_OPERATOR", "SUPPORT", "PLAYER"];

test("admin-endepunkter følger RBAC-policy", () => {
  for (const policyCase of ENDPOINT_POLICY_CASES) {
    for (const role of ALL_ROLES) {
      const expected = policyCase.allowedRoles.includes(role);
      assert.equal(
        canAccessAdminPermission(role, policyCase.permission),
        expected,
        `${role} mismatch for ${policyCase.endpoint} (${policyCase.permission})`
      );
    }
  }
});

test("support/operator kan ikke utføre admin-only writes", () => {
  const adminOnlyWrites: AdminPermission[] = [
    "GAME_CATALOG_WRITE",
    "HALL_WRITE",
    "PRIZE_POLICY_WRITE",
    "EXTRA_PRIZE_AWARD",
    "LEDGER_WRITE",
    "USER_ROLE_WRITE",
    "OVERSKUDD_WRITE"
  ];
  for (const permission of adminOnlyWrites) {
    assert.equal(canAccessAdminPermission("HALL_OPERATOR", permission), false, `operator must not ${permission}`);
    assert.equal(canAccessAdminPermission("SUPPORT", permission), false, `support must not ${permission}`);
  }
});
