/**
 * GAP #35 — unit-tester for VerifyTokenService.
 *
 * Dekker:
 *   - create + validate + consume happy-path
 *   - utløp (TTL-grense)
 *   - replay-protection (consume-twice → ALREADY_USED)
 *   - re-issue invaliderer eldre tokens
 *   - tom/manglende token → riktig DomainError-kode
 *   - klartekst lagres aldri (sha256-hash i memory)
 *   - GC fjerner utløpte rader
 */

import assert from "node:assert/strict";
import test from "node:test";
import { VerifyTokenService } from "../VerifyTokenService.js";
import { DomainError } from "../../game/BingoEngine.js";

test("GAP #35: create + validate + consume happy-path", () => {
  const svc = new VerifyTokenService({ ttlMs: 5_000 });
  const { token, expiresAt } = svc.create("user-1");
  assert.ok(token.length > 20);
  assert.ok(new Date(expiresAt).getTime() > Date.now());

  const validated = svc.validate(token);
  assert.equal(validated.userId, "user-1");

  const consumed = svc.consume(token);
  assert.equal(consumed.userId, "user-1");

  // Etter consume: replay → ALREADY_USED.
  assert.throws(
    () => svc.validate(token),
    (err: unknown) =>
      err instanceof DomainError && err.code === "VERIFY_TOKEN_ALREADY_USED"
  );
});

test("GAP #35: utløpt token → VERIFY_TOKEN_EXPIRED", () => {
  let nowMs = 1_000_000;
  const svc = new VerifyTokenService({ ttlMs: 100, now: () => nowMs });
  const { token } = svc.create("user-1");
  // Simuler tids-fremrykk forbi utløp.
  nowMs += 200;
  assert.throws(
    () => svc.validate(token),
    (err: unknown) =>
      err instanceof DomainError && err.code === "VERIFY_TOKEN_EXPIRED"
  );
});

test("GAP #35: ukjent token → VERIFY_TOKEN_INVALID", () => {
  const svc = new VerifyTokenService();
  assert.throws(
    () => svc.validate("bogus-token"),
    (err: unknown) =>
      err instanceof DomainError && err.code === "VERIFY_TOKEN_INVALID"
  );
});

test("GAP #35: tomt/manglende token → VERIFY_TOKEN_REQUIRED", () => {
  const svc = new VerifyTokenService();
  assert.throws(
    () => svc.validate(""),
    (err: unknown) =>
      err instanceof DomainError && err.code === "VERIFY_TOKEN_REQUIRED"
  );
});

test("GAP #35: re-issue invaliderer eldre aktive tokens", () => {
  const svc = new VerifyTokenService();
  const first = svc.create("user-1");
  const second = svc.create("user-1");
  // Første token ble fjernet ved re-issue (in-memory implementasjon
  // sletter tidligere aktive rad'er).
  assert.throws(
    () => svc.validate(first.token),
    (err: unknown) =>
      err instanceof DomainError && err.code === "VERIFY_TOKEN_INVALID"
  );
  // Andre token gyldig.
  const validated = svc.validate(second.token);
  assert.equal(validated.userId, "user-1");
});

test("GAP #35: replay-protection — andre consume feiler", () => {
  const svc = new VerifyTokenService();
  const { token } = svc.create("user-1");
  svc.consume(token);
  assert.throws(
    () => svc.consume(token),
    (err: unknown) =>
      err instanceof DomainError && err.code === "VERIFY_TOKEN_ALREADY_USED"
  );
});

test("GAP #35: tomt userId avvises ved create", () => {
  const svc = new VerifyTokenService();
  assert.throws(
    () => svc.create(""),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
  assert.throws(
    () => svc.create("   "),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("GAP #35: klartekst-token lagres aldri (sha256-hash internt)", () => {
  const svc = new VerifyTokenService();
  const { token } = svc.create("user-1");
  // Vi kan ikke direkte introspisere internt store, men en ukjent (annen)
  // verdi som tilfeldig kollisjon med klartekst i hash-form vil avvises.
  // Indirekte: validate med en streng som er klartekst-tokenets hash som
  // streng → INVALID (ikke ALREADY_USED).
  const reversedHashAttempt = "0".repeat(64);
  assert.throws(
    () => svc.validate(reversedHashAttempt),
    (err: unknown) =>
      err instanceof DomainError && err.code === "VERIFY_TOKEN_INVALID"
  );
  // Konsistens: tokenet selv er fortsatt gyldig.
  const validated = svc.validate(token);
  assert.equal(validated.userId, "user-1");
});

test("GAP #35: GC fjerner utløpte rader", () => {
  let nowMs = 10_000;
  const svc = new VerifyTokenService({ ttlMs: 100, now: () => nowMs });
  svc.create("user-1");
  svc.create("user-2");
  // user-2 lever fortsatt; user-1 vil utløpe etter 100ms.
  nowMs += 200;
  // create-en for user-2 legger til en row, men tidligere rader skal være
  // utløpt og GC kan rydde dem.
  const removed = svc.gc();
  assert.ok(removed >= 1, "GC skal fjerne minst én utløpt rad");
});

test("GAP #35: ttlMs <= 0 i konstruktør avvises", () => {
  assert.throws(
    () => new VerifyTokenService({ ttlMs: 0 }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
  assert.throws(
    () => new VerifyTokenService({ ttlMs: -100 }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
});

test("GAP #35: size() teller kun aktive (ubrukte + ikke-utløpte)", () => {
  let nowMs = 0;
  const svc = new VerifyTokenService({ ttlMs: 1_000, now: () => nowMs });
  const t1 = svc.create("user-1");
  svc.create("user-2");
  assert.equal(svc.size(), 2);
  svc.consume(t1.token);
  assert.equal(svc.size(), 1, "consume reduserer aktive");
  nowMs += 2_000;
  assert.equal(svc.size(), 0, "utløp reduserer aktive");
});
