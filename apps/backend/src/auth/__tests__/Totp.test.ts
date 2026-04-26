/**
 * REQ-129: Tester for TOTP-implementeringen.
 *
 * Bekrefter:
 *   - Base32 round-trip
 *   - generateTotpCode mot kjente RFC 6238 test-vektorer
 *   - verifyTotpCode med ±1 step skew
 *   - buildOtpauthUri har riktige parametere
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  base32ToBuffer,
  bufferToBase32,
  buildOtpauthUri,
  generateTotpCode,
  generateTotpSecret,
  verifyTotpCode,
} from "../Totp.js";

test("Base32 round-trip", () => {
  const original = Buffer.from("Hello, world!");
  const encoded = bufferToBase32(original);
  const decoded = base32ToBuffer(encoded);
  assert.deepEqual(decoded, original);
});

test("Base32 decode er case-insensitive og ignorerer padding", () => {
  const a = base32ToBuffer("JBSWY3DPEHPK3PXP");
  const b = base32ToBuffer("jbswy3dpehpk3pxp====");
  const c = base32ToBuffer("JBSWY3DP EHPK3PXP");
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
});

test("Base32 avviser ikke-Base32-tegn", () => {
  assert.throws(() => base32ToBuffer("!!!"));
});

test("generateTotpSecret produserer 32-tegn Base32-streng (160 bit)", () => {
  const secret = generateTotpSecret();
  // 20 bytes -> ceil(20*8/5) = 32 base32-tegn (uten padding).
  assert.equal(secret.length, 32);
  assert.match(secret, /^[A-Z2-7]+$/);
});

test("generateTotpCode er stabil for samme tidsvindu", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const t1 = 1700000000000;
  const code1 = generateTotpCode(secret, t1);
  // Samme step (innenfor 30s).
  const code2 = generateTotpCode(secret, t1 + 1000);
  assert.equal(code1, code2);
});

test("generateTotpCode endrer seg når step går videre", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const t1 = 1700000000000;
  const code1 = generateTotpCode(secret, t1, 0);
  const code2 = generateTotpCode(secret, t1, 1);
  assert.notEqual(code1, code2);
});

test("RFC 6238 test-vektor for SHA1 (T=59)", () => {
  // Fra https://datatracker.ietf.org/doc/html/rfc6238#appendix-B
  // Secret = "12345678901234567890" ASCII -> Base32:
  // "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
  const secret = bufferToBase32(Buffer.from("12345678901234567890"));
  const code = generateTotpCode(secret, 59 * 1000, 0, 30, 8);
  // RFC sier 94287082 for T=59 og digits=8.
  assert.equal(code, "94287082");
});

test("verifyTotpCode aksepterer current step", () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  const code = generateTotpCode(secret, now);
  assert.equal(verifyTotpCode(secret, code, { timestampMs: now }), true);
});

test("verifyTotpCode aksepterer ±1 step skew (default)", () => {
  const secret = generateTotpSecret();
  const t = 1700000000000;
  const codeNext = generateTotpCode(secret, t, 1);
  const codePrev = generateTotpCode(secret, t, -1);
  assert.equal(verifyTotpCode(secret, codeNext, { timestampMs: t }), true);
  assert.equal(verifyTotpCode(secret, codePrev, { timestampMs: t }), true);
});

test("verifyTotpCode avviser kode utenfor skew-vindu", () => {
  const secret = generateTotpSecret();
  const t = 1700000000000;
  // 5 step unna ~ 150s.
  const codeFar = generateTotpCode(secret, t, 5);
  assert.equal(verifyTotpCode(secret, codeFar, { timestampMs: t }), false);
});

test("verifyTotpCode avviser feil format", () => {
  const secret = generateTotpSecret();
  assert.equal(verifyTotpCode(secret, "abcdef"), false);
  assert.equal(verifyTotpCode(secret, "12345"), false); // for kort
  assert.equal(verifyTotpCode(secret, "1234567"), false); // for lang
});

test("buildOtpauthUri inkluderer issuer + secret + period", () => {
  const uri = buildOtpauthUri({
    secret: "JBSWY3DPEHPK3PXP",
    accountLabel: "alice@example.com",
    issuer: "Spillorama",
  });
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.ok(uri.includes("secret=JBSWY3DPEHPK3PXP"));
  assert.ok(uri.includes("issuer=Spillorama"));
  assert.ok(uri.includes("period=30"));
  assert.ok(uri.includes("digits=6"));
  assert.ok(uri.includes("Spillorama%3Aalice%40example.com"));
});
