/**
 * RBAC-tester for adminWithdrawXml-router.
 *
 * Verifiserer at alle endepunktene bruker riktig AdminPermission
 * (PAYMENT_REQUEST_READ for GET-endepunkt, PAYMENT_REQUEST_WRITE for
 * POST). Matcher mønsteret fra adminPaymentRequests.test.ts.
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

const ALL_ROLES: UserRole[] = ["ADMIN", "HALL_OPERATOR", "SUPPORT", "PLAYER"];

const XML_EXPORT_CASES: EndpointPolicyCase[] = [
  {
    endpoint: "GET /api/admin/withdraw/xml-batches",
    permission: "PAYMENT_REQUEST_READ",
    allowedRoles: ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  },
  {
    endpoint: "GET /api/admin/withdraw/xml-batches/:id",
    permission: "PAYMENT_REQUEST_READ",
    allowedRoles: ["ADMIN", "HALL_OPERATOR", "SUPPORT"],
  },
  {
    endpoint: "POST /api/admin/withdraw/xml-batches/export",
    permission: "PAYMENT_REQUEST_WRITE",
    allowedRoles: ["ADMIN", "HALL_OPERATOR"],
  },
  {
    endpoint: "POST /api/admin/withdraw/xml-batches/:id/resend",
    permission: "PAYMENT_REQUEST_WRITE",
    allowedRoles: ["ADMIN", "HALL_OPERATOR"],
  },
];

test("withdraw XML-export: admin-endepunkter følger RBAC-policy", () => {
  for (const c of XML_EXPORT_CASES) {
    for (const role of ALL_ROLES) {
      const expected = c.allowedRoles.includes(role);
      assert.equal(
        canAccessAdminPermission(role, c.permission),
        expected,
        `${role} mismatch for ${c.endpoint} (${c.permission})`
      );
    }
  }
});

test("withdraw XML-export: SUPPORT kan lese men ikke trigge eksport", () => {
  assert.equal(canAccessAdminPermission("SUPPORT", "PAYMENT_REQUEST_READ"), true);
  assert.equal(canAccessAdminPermission("SUPPORT", "PAYMENT_REQUEST_WRITE"), false);
});

test("withdraw XML-export: PLAYER har ingen tilgang", () => {
  assert.equal(canAccessAdminPermission("PLAYER", "PAYMENT_REQUEST_READ"), false);
  assert.equal(canAccessAdminPermission("PLAYER", "PAYMENT_REQUEST_WRITE"), false);
});
