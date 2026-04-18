/**
 * BIN-588: tests for the mini Handlebars-subset template engine.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { renderTemplate } from "./template.js";

test("BIN-588 template: substitutes simple {{var}}", () => {
  const out = renderTemplate("Hei {{name}}!", { name: "Kari" });
  assert.equal(out, "Hei Kari!");
});

test("BIN-588 template: nested path with dots", () => {
  const out = renderTemplate("{{t.title}}", { t: { title: "Bingo" } });
  assert.equal(out, "Bingo");
});

test("BIN-588 template: missing variable renders as empty", () => {
  const out = renderTemplate("Hei {{missing}}.", {});
  assert.equal(out, "Hei .");
});

test("BIN-588 template: HTML-escapes values by default", () => {
  const out = renderTemplate("{{raw}}", { raw: "<script>alert(1)</script>" });
  assert.equal(out, "&lt;script&gt;alert(1)&lt;/script&gt;");
});

test("BIN-588 template: escapes & \" ' characters", () => {
  const out = renderTemplate("{{s}}", { s: `Tom & Jerry's "friends"` });
  assert.equal(out, "Tom &amp; Jerry&#39;s &quot;friends&quot;");
});

test("BIN-588 template: {{&raw}} bypasses escape", () => {
  const out = renderTemplate("{{&html}}", { html: "<b>bold</b>" });
  assert.equal(out, "<b>bold</b>");
});

test("BIN-588 template: {{#if var}} renders block when truthy", () => {
  const out = renderTemplate("{{#if show}}hei{{/if}}", { show: true });
  assert.equal(out, "hei");
});

test("BIN-588 template: {{#if var}} skips block when falsy", () => {
  for (const falsy of [false, 0, "", null, undefined, []] as const) {
    const out = renderTemplate("A{{#if x}}B{{/if}}C", { x: falsy });
    assert.equal(out, "AC", `falsy=${JSON.stringify(falsy)} should skip block`);
  }
});

test("BIN-588 template: nested #if blocks", () => {
  const tmpl = "{{#if a}}A{{#if b}}B{{/if}}A{{/if}}";
  assert.equal(renderTemplate(tmpl, { a: true, b: true }), "ABA");
  assert.equal(renderTemplate(tmpl, { a: true, b: false }), "AA");
  assert.equal(renderTemplate(tmpl, { a: false, b: true }), "");
});

test("BIN-588 template: numeric values stringify", () => {
  const out = renderTemplate("Du har {{n}} kr", { n: 1234 });
  assert.equal(out, "Du har 1234 kr");
});

test("BIN-588 template: unclosed {{#if}} throws", () => {
  assert.throws(() => renderTemplate("{{#if x}}forever", { x: true }), /unclosed/);
});

test("BIN-588 template: stray {{/if}} throws", () => {
  assert.throws(() => renderTemplate("before {{/if}} after", {}), /unexpected/);
});

test("BIN-588 template: real bankid reminder subset renders end-to-end", () => {
  const tmpl = `Hei {{username}}, din {{verificationType}} utløper om {{daysRemaining}} dag(er) ({{expiryDate}}).`;
  const out = renderTemplate(tmpl, {
    username: "Kari",
    verificationType: "BankID",
    daysRemaining: 7,
    expiryDate: "25.04.2026",
  });
  assert.equal(out, "Hei Kari, din BankID utløper om 7 dag(er) (25.04.2026).");
});
