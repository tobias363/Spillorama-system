/**
 * Tests for PlayerExcelImport parser logic. Pure functions only — no DB.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  COLUMN_ALIASES,
  detectHeaders,
  isValidEmail,
  parseBirthDate,
  parseRow,
  parseSheet,
  serializeErrorsCsv,
  serializeImportedCsv,
  splitLegacyName,
  type ParserContext,
  type RawRow,
} from "./PlayerExcelImport.js";

const ctx: ParserContext = {
  hallNumberToId: new Map([
    [100, "hall-hamar"],
    [120, "hall-honefoss"],
    [47, "hall-test-47"],
  ]),
  mainHallId: "hall-main",
};

describe("isValidEmail", () => {
  it("accepts well-formed email", () => {
    assert.equal(isValidEmail("ola@nordmann.no"), true);
    assert.equal(isValidEmail("a.b+tag@sub.example.com"), true);
  });
  it("rejects malformed", () => {
    assert.equal(isValidEmail("nope"), false);
    assert.equal(isValidEmail("a@b"), false); // no TLD
    assert.equal(isValidEmail("a@@b.com"), false);
    assert.equal(isValidEmail("a b@c.com"), false); // whitespace
  });
});

describe("parseBirthDate", () => {
  it("accepts ISO YYYY-MM-DD", () => {
    assert.equal(parseBirthDate("1990-05-15"), "1990-05-15");
  });
  it("accepts Norwegian DD.MM.YYYY", () => {
    assert.equal(parseBirthDate("15.05.1990"), "1990-05-15");
  });
  it("accepts Norwegian DD/MM/YYYY", () => {
    assert.equal(parseBirthDate("01/12/1985"), "1985-12-01");
  });
  it("accepts Norwegian DD-MM-YYYY", () => {
    assert.equal(parseBirthDate("31-01-2000"), "2000-01-31");
  });
  it("rejects invalid month", () => {
    assert.equal(parseBirthDate("31.13.1990"), null);
  });
  it("rejects invalid day", () => {
    assert.equal(parseBirthDate("32.01.1990"), null);
  });
  it("returns null for empty", () => {
    assert.equal(parseBirthDate(""), null);
    assert.equal(parseBirthDate(null), null);
    assert.equal(parseBirthDate(undefined), null);
  });
  it("accepts Date objects (xlsx cellDates)", () => {
    const date = new Date(Date.UTC(1990, 4, 15));
    assert.equal(parseBirthDate(date), "1990-05-15");
  });
});

describe("splitLegacyName", () => {
  it("single token", () => {
    assert.deepEqual(splitLegacyName("Ola"), { displayName: "Ola", surname: null });
  });
  it("two tokens — first/last", () => {
    assert.deepEqual(splitLegacyName("Ola Nordmann"), {
      displayName: "Ola",
      surname: "Nordmann",
    });
  });
  it("three tokens — first+mid as display, last as surname", () => {
    assert.deepEqual(splitLegacyName("Ola Mellomnavn Nordmann"), {
      displayName: "Ola Mellomnavn",
      surname: "Nordmann",
    });
  });
  it("four tokens — first two display, last two surname", () => {
    assert.deepEqual(splitLegacyName("Ola Per Nordmann Hansen"), {
      displayName: "Ola Per",
      surname: "Nordmann Hansen",
    });
  });
  it("five tokens — first three display, last two surname", () => {
    assert.deepEqual(splitLegacyName("Ola Per Mellom Nordmann Hansen"), {
      displayName: "Ola Per Mellom",
      surname: "Nordmann Hansen",
    });
  });
  it("normalizes multiple spaces", () => {
    assert.deepEqual(splitLegacyName("  Ola   Nordmann  "), {
      displayName: "Ola",
      surname: "Nordmann",
    });
  });
});

describe("detectHeaders", () => {
  it("matches case-insensitively", () => {
    const headers = detectHeaders([
      "USERNAME",
      "Email",
      "phone NUMBER",
      "Hall Number",
    ]);
    assert.equal(headers.size, 4);
    assert.equal(headers.get(0), "username");
    assert.equal(headers.get(1), "email");
    assert.equal(headers.get(2), "phone");
    assert.equal(headers.get(3), "hallNumber");
  });
  it("accepts Norwegian aliases", () => {
    const headers = detectHeaders([
      "Brukernavn",
      "Telefonnummer",
      "Hallnummer",
      "Etternavn",
    ]);
    assert.equal(headers.get(0), "username");
    assert.equal(headers.get(1), "phone");
    assert.equal(headers.get(2), "hallNumber");
    assert.equal(headers.get(3), "surname");
  });
  it("ignores unknown columns", () => {
    const headers = detectHeaders([
      "Username",
      "Internal Code",
      "Email",
      "Hall Number",
    ]);
    assert.equal(headers.size, 3);
    assert.equal(headers.get(0), "username");
    assert.equal(headers.get(2), "email");
    assert.equal(headers.get(3), "hallNumber");
  });
  it("throws if Username missing", () => {
    assert.throws(
      () => detectHeaders(["Email", "Phone Number", "Hall Number"]),
      /Username/
    );
  });
  it("throws if Hall Number missing", () => {
    assert.throws(
      () => detectHeaders(["Username", "Email", "Phone Number"]),
      /Hall Number/
    );
  });
  it("throws if neither Email nor Phone present", () => {
    assert.throws(
      () => detectHeaders(["Username", "Hall Number"]),
      /Email.*Phone Number/
    );
  });
  it("accepts Email-only (phone absent)", () => {
    const headers = detectHeaders(["Username", "Email", "Hall Number"]);
    assert.equal(headers.size, 3);
  });
  it("accepts Phone-only (email absent)", () => {
    const headers = detectHeaders(["Username", "Phone Number", "Hall Number"]);
    assert.equal(headers.size, 3);
  });
});

describe("parseRow — success cases", () => {
  const headers = detectHeaders([
    "Username",
    "Email",
    "Phone Number",
    "Hall Number",
    "Birth Date",
  ]);

  it("parses well-formed row with exact hall_number match", () => {
    const row: RawRow = [
      "Ola Nordmann",
      "ola@nordmann.no",
      "+4798765432",
      100,
      "15.05.1990",
    ];
    const result = parseRow(row, 2, headers, ctx);
    assert.ok(!("reason" in result), "should not be a RowError");
    assert.equal(result.displayName, "Ola");
    assert.equal(result.surname, "Nordmann");
    assert.equal(result.email, "ola@nordmann.no");
    assert.equal(result.phone, "+4798765432");
    assert.equal(result.hallId, "hall-hamar");
    assert.equal(result.birthDate, "1990-05-15");
  });

  it("uses mainHallId when Hall Number is 0", () => {
    const row: RawRow = [
      "Kari Pedersen",
      "kari@example.com",
      "",
      0,
      "",
    ];
    const result = parseRow(row, 3, headers, ctx);
    assert.ok(!("reason" in result));
    assert.equal(result.hallId, "hall-main");
  });

  it("uses mainHallId when Hall Number is blank", () => {
    const row: RawRow = ["Kari Pedersen", "kari@example.com", "", "", ""];
    const result = parseRow(row, 3, headers, ctx);
    assert.ok(!("reason" in result));
    assert.equal(result.hallId, "hall-main");
  });

  it("normalizes Norwegian phone variants", () => {
    const row: RawRow = ["Test Person", "", "98 76 54 32", 100, ""];
    const result = parseRow(row, 4, headers, ctx);
    assert.ok(!("reason" in result));
    assert.equal(result.phone, "+4798765432");
  });

  it("lowercases email", () => {
    const row: RawRow = ["A B", "OLA@EXAMPLE.NO", "", 100, ""];
    const result = parseRow(row, 2, headers, ctx);
    assert.ok(!("reason" in result));
    assert.equal(result.email, "ola@example.no");
  });

  it("accepts row with email only (no phone)", () => {
    const row: RawRow = ["Solo Email", "solo@x.no", "", 100, ""];
    const result = parseRow(row, 2, headers, ctx);
    assert.ok(!("reason" in result));
    assert.equal(result.phone, null);
    assert.equal(result.email, "solo@x.no");
  });

  it("accepts row with phone only (no email)", () => {
    const row: RawRow = ["Solo Phone", "", "+4791234567", 100, ""];
    const result = parseRow(row, 2, headers, ctx);
    assert.ok(!("reason" in result));
    assert.equal(result.email, null);
    assert.equal(result.phone, "+4791234567");
  });

  it("treats invalid birthDate as soft-skip (lenient)", () => {
    const row: RawRow = ["Bad Date", "x@y.no", "", 100, "garbage"];
    const result = parseRow(row, 2, headers, ctx);
    assert.ok(!("reason" in result));
    assert.equal(result.birthDate, null);
  });
});

describe("parseRow — rejection cases", () => {
  const headers = detectHeaders([
    "Username",
    "Email",
    "Phone Number",
    "Hall Number",
  ]);

  it("rejects missing username", () => {
    const row: RawRow = ["", "x@y.no", "", 100];
    const result = parseRow(row, 2, headers, ctx);
    assert.ok("reason" in result);
    assert.match(result.reason, /MISSING_USERNAME/);
  });

  it("rejects malformed email", () => {
    const row: RawRow = ["Test", "not-an-email", "", 100];
    const result = parseRow(row, 2, headers, ctx);
    assert.ok("reason" in result);
    assert.match(result.reason, /INVALID_EMAIL/);
  });

  it("rejects when both email and phone are missing", () => {
    const row: RawRow = ["Test Person", "", "", 100];
    const result = parseRow(row, 2, headers, ctx);
    assert.ok("reason" in result);
    assert.match(result.reason, /MISSING_CONTACT/);
  });

  it("rejects unknown hall number", () => {
    const row: RawRow = ["Test", "x@y.no", "", 999];
    const result = parseRow(row, 2, headers, ctx);
    assert.ok("reason" in result);
    assert.match(result.reason, /UNKNOWN_HALL_NUMBER/);
  });

  it("rejects non-numeric hall number", () => {
    const row: RawRow = ["Test", "x@y.no", "", "abc"];
    const result = parseRow(row, 2, headers, ctx);
    assert.ok("reason" in result);
    assert.match(result.reason, /INVALID_HALL_NUMBER/);
  });

  it("rejects bad phone format", () => {
    const row: RawRow = ["Test", "x@y.no", "12345", 100];
    const result = parseRow(row, 2, headers, ctx);
    assert.ok("reason" in result);
    assert.match(result.reason, /INVALID_PHONE/);
  });

  it("with mainHallId=null, rejects blank hall number", () => {
    const ctxStrict: ParserContext = {
      hallNumberToId: ctx.hallNumberToId,
      mainHallId: null,
    };
    const row: RawRow = ["Test", "x@y.no", "", ""];
    const result = parseRow(row, 2, headers, ctxStrict);
    assert.ok("reason" in result);
    assert.match(result.reason, /MISSING_HALL_NUMBER/);
  });
});

describe("parseSheet — full sheet flow", () => {
  it("parses 10-row mixed sheet (valid + invalid)", () => {
    const rows: RawRow[] = [
      // Header
      ["Username", "Email", "Phone Number", "Hall Number"],
      // 10 data rows
      ["Player One", "p1@example.no", "+4791111111", 100],          // OK → hall-hamar
      ["Player Two", "p2@example.no", "+4792222222", 120],          // OK → hall-honefoss
      ["", "p3@example.no", "+4793333333", 100],                    // ERR: missing username
      ["Player Four", "bad-email", "+4794444444", 100],             // ERR: invalid email
      ["Player Five", "", "", 100],                                 // ERR: missing contact
      ["Player Six", "p6@example.no", "+4796666666", 999],          // ERR: unknown hall
      ["Player Seven", "p7@example.no", "+4797777777", ""],         // OK → mainHallId
      ["Player Eight", "p8@example.no", "+4798888888", 47],         // OK → hall-test-47
      ["Player Nine", "p1@example.no", "+4799999999", 100],         // ERR: dup email
      ["Player Ten", "p10@example.no", "+4791111111", 100],         // ERR: dup phone
    ];
    const result = parseSheet(rows, ctx);
    assert.equal(result.totalRowsRead, 10);
    assert.equal(result.rows.length, 4, "should have 4 valid imports");
    assert.equal(result.errors.length, 6, "should have 6 errors");

    // Verify error reasons
    const reasons = result.errors.map((e) => e.reason);
    assert.ok(reasons.some((r) => r.includes("MISSING_USERNAME")));
    assert.ok(reasons.some((r) => r.includes("INVALID_EMAIL")));
    assert.ok(reasons.some((r) => r.includes("MISSING_CONTACT")));
    assert.ok(reasons.some((r) => r.includes("UNKNOWN_HALL_NUMBER")));
    assert.ok(reasons.some((r) => r.includes("DUPLICATE_IN_BATCH_EMAIL")));
    assert.ok(reasons.some((r) => r.includes("DUPLICATE_IN_BATCH_PHONE")));

    // Verify successful row hall mappings
    const valid = result.rows;
    assert.equal(valid[0]!.hallId, "hall-hamar");
    assert.equal(valid[1]!.hallId, "hall-honefoss");
    assert.equal(valid[2]!.hallId, "hall-main"); // P7 with blank
    assert.equal(valid[3]!.hallId, "hall-test-47");
  });

  it("skips entirely-blank rows silently", () => {
    const rows: RawRow[] = [
      ["Username", "Email", "Phone Number", "Hall Number"],
      ["", "", "", ""], // all blank — skipped, not an error
      ["Real", "real@x.no", "", 100],
    ];
    const result = parseSheet(rows, ctx);
    assert.equal(result.errors.length, 0);
    assert.equal(result.rows.length, 1);
  });

  it("returns empty for header-only sheet", () => {
    const rows: RawRow[] = [
      ["Username", "Email", "Phone Number", "Hall Number"],
    ];
    const result = parseSheet(rows, ctx);
    assert.equal(result.rows.length, 0);
    assert.equal(result.errors.length, 0);
    assert.equal(result.totalRowsRead, 0);
  });

  it("returns empty for empty input", () => {
    const result = parseSheet([], ctx);
    assert.equal(result.rows.length, 0);
    assert.equal(result.totalRowsRead, 0);
  });

  it("throws on missing required header", () => {
    const rows: RawRow[] = [
      ["Email", "Phone Number", "Hall Number"], // no Username
      ["x@y.no", "+4791111111", 100],
    ];
    assert.throws(() => parseSheet(rows, ctx), /Username/);
  });
});

describe("CSV serializers", () => {
  it("imported CSV has BOM, CRLF, semicolons", () => {
    const csv = serializeImportedCsv([
      {
        rowNumber: 2,
        email: "ola@example.no",
        phone: "+4791234567",
        displayName: "Ola",
        surname: "Nordmann",
        birthDate: "1990-05-15",
        hallId: "hall-100",
        customerNumber: "C-1",
      },
    ]);
    // Check BOM (0xFEFF)
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.match(csv, /;displayName;/);
    assert.match(csv, /\r\n/);
    assert.match(csv, /Ola;Nordmann;ola@example\.no/);
  });

  it("error CSV escapes quotes and embeds rawValues JSON", () => {
    const csv = serializeErrorsCsv([
      {
        rowNumber: 5,
        reason: 'INVALID_EMAIL: "bad@"',
        rawValues: { email: "bad@", phone: null },
      },
    ]);
    assert.match(csv, /5;/);
    // Quote-containing field should be wrapped + escaped
    assert.match(csv, /"INVALID_EMAIL: ""bad@"""/);
    // JSON rawValues column
    assert.match(csv, /\{""email"":""bad@""/);
  });

  it("imported CSV produces empty body for empty input", () => {
    const csv = serializeImportedCsv([]);
    // Just header row
    assert.match(csv, /rowNumber;displayName;.*\r\n$/);
    // No data rows
    const lines = csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);
    assert.equal(lines.length, 1);
  });
});

describe("idempotency-readiness", () => {
  // The parser doesn't perform DB-level dup check (driver does), but it
  // detects in-batch duplicates. This is a subset of the script's
  // idempotency guarantee, exercised here.
  it("flags second occurrence of same email as DUPLICATE_IN_BATCH", () => {
    const rows: RawRow[] = [
      ["Username", "Email", "Phone Number", "Hall Number"],
      ["A", "same@x.no", "+4791111111", 100],
      ["B", "same@x.no", "+4792222222", 100],
    ];
    const result = parseSheet(rows, ctx);
    assert.equal(result.rows.length, 1);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0]!.reason, /DUPLICATE_IN_BATCH_EMAIL/);
  });
});

describe("COLUMN_ALIASES sanity", () => {
  it("all keys have at least one alias", () => {
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
      assert.ok(aliases.length > 0, `${key} has no aliases`);
    }
  });
});
