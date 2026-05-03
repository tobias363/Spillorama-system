/**
 * BIN-776 / M2 — CSP-violation parser tests.
 *
 * The route itself is a thin Express handler — the interesting logic is
 * in `parseViolation`, which has to handle both the legacy `report-uri`
 * shape and the new Reporting API shape, plus malformed input.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CSP_REPORT_INTERNALS } from "../cspReport.js";

const { parseViolation, MAX_STRING_LEN } = CSP_REPORT_INTERNALS;

describe("parseViolation", () => {
  it("parses the legacy report-uri payload", () => {
    const body = {
      "csp-report": {
        "document-uri": "https://spillorama-system.onrender.com/admin/dashboard",
        "blocked-uri": "https://evil.example/inject.js",
        "violated-directive": "script-src 'self'",
        "effective-directive": "script-src",
        "original-policy": "default-src 'self'",
        "disposition": "report",
        "source-file": "https://spillorama-system.onrender.com/admin/main.js",
        "line-number": 42,
        "column-number": 7,
        "status-code": 200,
        "referrer": "https://spillorama-system.onrender.com/admin/",
      },
    };
    const v = parseViolation(body);
    assert.ok(v);
    assert.equal(v.documentUri, "https://spillorama-system.onrender.com/admin/dashboard");
    assert.equal(v.blockedUri, "https://evil.example/inject.js");
    assert.equal(v.violatedDirective, "script-src 'self'");
    assert.equal(v.effectiveDirective, "script-src");
    assert.equal(v.disposition, "report");
    assert.equal(v.lineNumber, 42);
    assert.equal(v.columnNumber, 7);
    assert.equal(v.statusCode, 200);
  });

  it("parses the Reporting API array payload", () => {
    const body = [
      {
        type: "csp-violation",
        age: 0,
        url: "https://spillorama-system.onrender.com/web/",
        body: {
          documentURL: "https://spillorama-system.onrender.com/web/",
          blockedURL: "data:application/octet-stream;base64,AAAA",
          violatedDirective: "img-src",
          effectiveDirective: "img-src",
          originalPolicy: "img-src 'self'",
          disposition: "enforce",
          statusCode: 0,
          sample: "",
        },
      },
    ];
    const v = parseViolation(body);
    assert.ok(v);
    assert.equal(v.documentUri, "https://spillorama-system.onrender.com/web/");
    assert.equal(v.blockedUri, "data:application/octet-stream;base64,AAAA");
    assert.equal(v.effectiveDirective, "img-src");
    assert.equal(v.disposition, "enforce");
    assert.equal(v.statusCode, 0);
  });

  it("returns undefined for malformed input", () => {
    assert.equal(parseViolation(null), undefined);
    assert.equal(parseViolation(undefined), undefined);
    assert.equal(parseViolation("not an object"), undefined);
    assert.equal(parseViolation(42), undefined);
    assert.equal(parseViolation({}), undefined);
    assert.equal(parseViolation([]), undefined);
    assert.equal(parseViolation([{ noBody: true }]), undefined);
    assert.equal(parseViolation({ "csp-report": "string-not-object" }), undefined);
  });

  it("clips string fields longer than MAX_STRING_LEN", () => {
    const huge = "x".repeat(MAX_STRING_LEN * 4);
    const v = parseViolation({
      "csp-report": {
        "document-uri": huge,
        "blocked-uri": "https://ok.example/",
      },
    });
    assert.ok(v);
    assert.ok(v.documentUri);
    // Clipped output is at most MAX_STRING_LEN + 1 (the trailing ellipsis).
    assert.ok(v.documentUri.length <= MAX_STRING_LEN + 1);
    assert.ok(v.documentUri.endsWith("…"), "long values must be marked as clipped");
    // Short fields untouched.
    assert.equal(v.blockedUri, "https://ok.example/");
  });

  it("coerces numeric fields delivered as strings", () => {
    const v = parseViolation({
      "csp-report": {
        "document-uri": "https://x.test/",
        "line-number": "10",
        "column-number": "3",
        "status-code": "200",
      },
    });
    assert.ok(v);
    assert.equal(v.lineNumber, 10);
    assert.equal(v.columnNumber, 3);
    assert.equal(v.statusCode, 200);
  });

  it("ignores non-numeric values for numeric fields", () => {
    const v = parseViolation({
      "csp-report": {
        "document-uri": "https://x.test/",
        "line-number": "not a number",
      },
    });
    assert.ok(v);
    assert.equal(v.lineNumber, undefined);
  });
});
