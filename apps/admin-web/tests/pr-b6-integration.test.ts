// PR-B6 (BIN-664) — integration + i18n-keys coverage for the 5 new pages.
//
// Covers:
//   - All new i18n keys exist in both no.json and en.json
//   - All 3 new routes resolve via findRoute()
//   - All 3 dispatchers (security, riskCountry, leaderboard) are mutually
//     exclusive and match only their declared routes.
//   - Sidebar spec contains the /blockedIp leaf (without breaking the
//     existing /riskCountry + /leaderboard entries).

import { describe, it, expect } from "vitest";
import noTranslations from "../src/i18n/no.json";
import enTranslations from "../src/i18n/en.json";
import { findRoute } from "../src/router/routes.js";
import { isSecurityRoute } from "../src/pages/security/index.js";
import { isRiskCountryRoute } from "../src/pages/riskCountry/index.js";
import { isLeaderboardRoute } from "../src/pages/leaderboard/index.js";
import { adminSidebar } from "../src/shell/sidebarSpec.js";

const PR_B6_NEW_KEYS = [
  "security_management",
  "blocked_ip",
  "blocked_ip_table",
  "add_blocked_ip",
  "edit_blocked_ip",
  "expires_at",
  "please_select_place",
  "add_leaderboard_tier",
  "edit_leaderboard_tier",
  "leaderboard_backend_pending",
  "select_country_placeholder",
];

describe("PR-B6 i18n keys", () => {
  it("all new keys exist in no.json", () => {
    const no = noTranslations as Record<string, string>;
    for (const key of PR_B6_NEW_KEYS) {
      expect(no[key], `missing no.json key: ${key}`).toBeTruthy();
    }
  });

  it("all new keys exist in en.json", () => {
    const en = enTranslations as Record<string, string>;
    for (const key of PR_B6_NEW_KEYS) {
      expect(en[key], `missing en.json key: ${key}`).toBeTruthy();
    }
  });
});

describe("PR-B6 routes", () => {
  it("findRoute resolves /blockedIp with module=Security Management", () => {
    const route = findRoute("/blockedIp");
    expect(route).toBeTruthy();
    expect(route!.titleKey).toBe("blocked_ip_table");
    expect(route!.module).toBe("Security Management");
    expect(route!.roles).toEqual(["admin", "super-admin"]);
  });

  it("findRoute resolves /riskCountry (unchanged from baseline)", () => {
    const route = findRoute("/riskCountry");
    expect(route).toBeTruthy();
    expect(route!.titleKey).toBe("risk_country");
    expect(route!.roles).toEqual(["admin", "super-admin"]);
  });

  it("findRoute resolves /leaderboard (BIN-668 wired title)", () => {
    const route = findRoute("/leaderboard");
    expect(route).toBeTruthy();
    expect(route!.titleKey).toBe("leaderboard_tier_list_title");
  });

  it("findRoute resolves /addLeaderboard (BIN-668 wired title)", () => {
    const route = findRoute("/addLeaderboard");
    expect(route).toBeTruthy();
    expect(route!.titleKey).toBe("leaderboard_tier_create");
  });
});

describe("PR-B6 dispatcher isolation", () => {
  it("each isXxxRoute() matches only its own paths", () => {
    const declared = ["/blockedIp", "/riskCountry", "/leaderboard", "/addLeaderboard"];
    for (const path of declared) {
      const hits = [
        isSecurityRoute(path),
        isRiskCountryRoute(path),
        isLeaderboardRoute(path),
      ].filter(Boolean).length;
      expect(hits, `overlapping dispatcher for ${path}`).toBe(1);
    }
  });

  it("non-PR-B6 routes are rejected by all 3 dispatchers", () => {
    const foreign = ["/", "/admin", "/wallet", "/productList", "/payoutPlayer"];
    for (const path of foreign) {
      expect(isSecurityRoute(path)).toBe(false);
      expect(isRiskCountryRoute(path)).toBe(false);
      expect(isLeaderboardRoute(path)).toBe(false);
    }
  });
});

describe("PR-B6 sidebar", () => {
  it("sidebar includes /blockedIp leaf with admin-only role gate", () => {
    const flat: Array<{ path?: string; roles?: string[] }> = [];
    for (const item of adminSidebar) {
      if (item.kind === "leaf") flat.push(item);
      else if (item.kind === "group") for (const child of item.children) flat.push(child);
    }
    const blocked = flat.find((l) => l.path === "/blockedIp");
    expect(blocked, "sidebar is missing /blockedIp leaf").toBeTruthy();
    expect(blocked!.roles).toEqual(["admin", "super-admin"]);
  });

  it("sidebar still includes /riskCountry + /leaderboard (regression guard)", () => {
    const flat: Array<{ path?: string }> = [];
    for (const item of adminSidebar) {
      if (item.kind === "leaf") flat.push(item);
      else if (item.kind === "group") for (const child of item.children) flat.push(child);
    }
    expect(flat.find((l) => l.path === "/riskCountry")).toBeTruthy();
    expect(flat.find((l) => l.path === "/leaderboard")).toBeTruthy();
  });
});
