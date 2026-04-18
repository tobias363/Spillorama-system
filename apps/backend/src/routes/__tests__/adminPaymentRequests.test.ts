/**
 * BIN-586: RBAC-tester for admin-endepunktene i paymentRequests-router.
 *
 * Vi tester at PAYMENT_REQUEST_READ og PAYMENT_REQUEST_WRITE er riktig
 * knyttet til de forventede rollene. Dette speiler mønsteret i
 * `AdminEndpointRbac.test.ts` — en enkel, rask kontroll som fanger
 * utilsiktet rolle-drift uten å kreve en live express-server.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { canAccessAdminPermission } from "../../platform/AdminAccessPolicy.js";
import type { AdminPermission } from "../../platform/AdminAccessPolicy.js";
import type { UserRole } from "../../platform/PlatformService.js";

interface EndpointPolicyCase {
  endpoint: string;
  permission: AdminPermission;
  allowedRoles: UserRole[];
}

const PAYMENT_REQUEST_ENDPOINT_CASES: EndpointPolicyCase[] = [
  {
    endpoint: "GET /api/admin/payments/requests",
    permission: "PAYMENT_REQUEST_READ",
    allowedRoles: ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  },
  {
    endpoint: "POST /api/admin/payments/requests/:id/accept",
    permission: "PAYMENT_REQUEST_WRITE",
    allowedRoles: ["ADMIN", "HALL_OPERATOR"],
  },
  {
    endpoint: "POST /api/admin/payments/requests/:id/reject",
    permission: "PAYMENT_REQUEST_WRITE",
    allowedRoles: ["ADMIN", "HALL_OPERATOR"],
  },
];

const ALL_ROLES: UserRole[] = ["ADMIN", "HALL_OPERATOR", "SUPPORT", "PLAYER"];

test("BIN-586: payment-request admin-endepunkter følger RBAC-policy", () => {
  for (const policyCase of PAYMENT_REQUEST_ENDPOINT_CASES) {
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

test("BIN-586: SUPPORT kan lese men ikke skrive payment requests", () => {
  assert.equal(canAccessAdminPermission("SUPPORT", "PAYMENT_REQUEST_READ"), true);
  assert.equal(canAccessAdminPermission("SUPPORT", "PAYMENT_REQUEST_WRITE"), false);
});

test("BIN-586: PLAYER har ingen payment-request admin-tilgang", () => {
  assert.equal(canAccessAdminPermission("PLAYER", "PAYMENT_REQUEST_READ"), false);
  assert.equal(canAccessAdminPermission("PLAYER", "PAYMENT_REQUEST_WRITE"), false);
});

test("BIN-586: HALL_OPERATOR kan både lese og skrive (hall-kasse-flyt)", () => {
  assert.equal(canAccessAdminPermission("HALL_OPERATOR", "PAYMENT_REQUEST_READ"), true);
  assert.equal(canAccessAdminPermission("HALL_OPERATOR", "PAYMENT_REQUEST_WRITE"), true);
});
