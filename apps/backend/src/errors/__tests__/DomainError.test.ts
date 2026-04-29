/**
 * DomainError unit-tester.
 *
 * Verifiserer at klassen oppfører seg eksakt slik den gjorde da den lå inne i
 * `BingoEngine.ts` — `instanceof`-sjekker, `code`/`details`/`message`-felter,
 * og at den arver fra `Error` slik at server-feil-handlere som matcher på
 * `Error` fortsatt fanger den.
 *
 * Stage 1 quick-win refactor (Backend Pain-Points Audit 2026-04-29).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../DomainError.js";
import { DomainError as DomainErrorViaBingoEngine } from "../../game/BingoEngine.js";

test("DomainError: kan instansieres med code + message", () => {
  const err = new DomainError("INVALID_INPUT", "Feil input.");
  assert.equal(err.code, "INVALID_INPUT");
  assert.equal(err.message, "Feil input.");
  assert.equal(err.details, undefined);
});

test("DomainError: instanceof DomainError fungerer", () => {
  const err = new DomainError("X", "y");
  assert.ok(err instanceof DomainError);
});

test("DomainError: arver fra Error (instanceof Error fungerer)", () => {
  const err = new DomainError("X", "y");
  assert.ok(err instanceof Error);
});

test("DomainError: details-feltet bevares når satt", () => {
  const err = new DomainError("HALLS_NOT_READY", "Haller ikke klare.", {
    unreadyHalls: ["A", "B"],
  });
  assert.deepEqual(err.details, { unreadyHalls: ["A", "B"] });
});

test("DomainError: details er undefined når ikke satt (eksplisitt)", () => {
  const err = new DomainError("X", "y");
  assert.equal(err.details, undefined);
});

test("DomainError: code er readonly på instans-nivå (TypeScript-kontrakt)", () => {
  // Vi kan ikke direkte teste `readonly` (det er compile-time), men vi kan
  // verifisere at code er en string-property som ble satt i constructor.
  const err = new DomainError("E1", "m1");
  assert.equal(typeof err.code, "string");
  assert.equal(err.code, "E1");
});

test("DomainError: stack-trace er populert (arvet fra Error)", () => {
  const err = new DomainError("X", "y");
  assert.equal(typeof err.stack, "string");
  assert.ok((err.stack ?? "").includes("DomainError"));
});

test("DomainError: re-eksport fra BingoEngine.js peker på samme klasse (back-compat)", () => {
  // Stage 1 refactor: `BingoEngine.ts` re-eksporterer `DomainError` for
  // back-compat. Eldre kode som fortsatt importerer fra `BingoEngine.js`
  // skal få nøyaktig samme klasse — ikke en duplikat. Hvis dette assertet
  // brytes vil `instanceof DomainError`-sjekker over import-grenser feile.
  assert.equal(DomainError, DomainErrorViaBingoEngine);

  const err = new DomainErrorViaBingoEngine("X", "y");
  assert.ok(err instanceof DomainError);
});
