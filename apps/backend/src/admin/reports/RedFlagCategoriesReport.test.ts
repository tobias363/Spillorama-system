/**
 * BIN-650: enhetstester for pure red-flag-categories aggregat-builder.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildRedFlagCategories } from "./RedFlagCategoriesReport.js";
import type { AmlCategoryCountRow } from "../../compliance/AmlService.js";

const FROM = "2026-03-20T00:00:00.000Z";
const TO = "2026-04-20T00:00:00.000Z";

function row(overrides: Partial<AmlCategoryCountRow> = {}): AmlCategoryCountRow {
  return {
    slug: "high-velocity",
    label: "High velocity",
    severity: "MEDIUM",
    description: "Mange transaksjoner på kort tid",
    count: 3,
    openCount: 2,
    ...overrides,
  };
}

test("BIN-650 builder: mapper slug → category og bevarer metadata", () => {
  const out = buildRedFlagCategories({
    rows: [
      row({ slug: "high-velocity", label: "High velocity", count: 5, openCount: 3 }),
      row({ slug: "high-amount", label: "High amount", severity: "HIGH", count: 2, openCount: 2 }),
    ],
    from: FROM,
    to: TO,
    generatedAt: "2026-04-20T12:00:00.000Z",
  });
  assert.equal(out.from, FROM);
  assert.equal(out.to, TO);
  assert.equal(out.generatedAt, "2026-04-20T12:00:00.000Z");
  assert.equal(out.categories.length, 2);
  assert.deepEqual(out.categories[0], {
    category: "high-velocity",
    label: "High velocity",
    description: "Mange transaksjoner på kort tid",
    severity: "MEDIUM",
    count: 5,
    openCount: 3,
  });
  assert.equal(out.categories[1]!.severity, "HIGH");
});

test("BIN-650 builder: totals summerer count + openCount", () => {
  const out = buildRedFlagCategories({
    rows: [
      row({ slug: "a", count: 5, openCount: 2 }),
      row({ slug: "b", count: 3, openCount: 3 }),
      row({ slug: "c", count: 1, openCount: 0 }),
    ],
    from: FROM,
    to: TO,
  });
  assert.equal(out.totals.totalFlags, 9);
  assert.equal(out.totals.totalOpenFlags, 5);
  assert.equal(out.totals.categoryCount, 3);
});

test("BIN-650 builder: tom input → tom kategori-liste + nullstilte totals", () => {
  const out = buildRedFlagCategories({ rows: [], from: FROM, to: TO });
  assert.deepEqual(out.categories, []);
  assert.deepEqual(out.totals, { totalFlags: 0, totalOpenFlags: 0, categoryCount: 0 });
});

test("BIN-650 builder: null description passes through", () => {
  const out = buildRedFlagCategories({
    rows: [row({ slug: "manual", label: "manual", description: null, count: 1, openCount: 0 })],
    from: FROM,
    to: TO,
  });
  assert.equal(out.categories[0]!.description, null);
});

test("BIN-650 builder: generatedAt auto-satt hvis ikke oppgitt", () => {
  const out = buildRedFlagCategories({ rows: [], from: FROM, to: TO });
  const ms = Date.parse(out.generatedAt);
  assert.ok(Number.isFinite(ms), "generatedAt skal være ISO-8601");
  // Rimelig nærtids-toleranse (±5s) for CI-jitter.
  assert.ok(Math.abs(Date.now() - ms) < 5000, "generatedAt skal være ~now");
});

test("BIN-650 builder: ugyldig from → throws", () => {
  assert.throws(
    () => buildRedFlagCategories({ rows: [], from: "ikke-iso", to: TO }),
    /Ugyldig 'from'/,
  );
});

test("BIN-650 builder: ugyldig to → throws", () => {
  assert.throws(
    () => buildRedFlagCategories({ rows: [], from: FROM, to: "ikke-iso" }),
    /Ugyldig 'to'/,
  );
});

test("BIN-650 builder: from > to → throws", () => {
  assert.throws(
    () => buildRedFlagCategories({ rows: [], from: TO, to: FROM }),
    /'from' må være <= 'to'/,
  );
});

test("BIN-650 builder: bevarer service-sortering (slug ASC)", () => {
  // Service returnerer allerede ASC; builder må ikke re-sortere.
  const out = buildRedFlagCategories({
    rows: [
      row({ slug: "alpha", count: 1, openCount: 0 }),
      row({ slug: "beta", count: 2, openCount: 1 }),
      row({ slug: "gamma", count: 3, openCount: 2 }),
    ],
    from: FROM,
    to: TO,
  });
  assert.deepEqual(
    out.categories.map((c) => c.category),
    ["alpha", "beta", "gamma"],
  );
});
