/**
 * REQ-130: tester for normaliseringa av norske telefonnummer.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeNorwegianPhone,
  isValidNorwegianPhone,
} from "../phoneValidation.js";
import { DomainError } from "../../game/BingoEngine.js";

test("REQ-130: normalizeNorwegianPhone aksepterer +47 + 8 siffer", () => {
  assert.equal(normalizeNorwegianPhone("+4791234567"), "+4791234567");
});

test("REQ-130: normalizeNorwegianPhone aksepterer 0047 prefix", () => {
  assert.equal(normalizeNorwegianPhone("004791234567"), "+4791234567");
});

test("REQ-130: normalizeNorwegianPhone aksepterer 8-sifret nasjonalt format", () => {
  assert.equal(normalizeNorwegianPhone("91234567"), "+4791234567");
});

test("REQ-130: normalizeNorwegianPhone tåler mellomrom og bindestrek", () => {
  assert.equal(normalizeNorwegianPhone("+47 912 34 567"), "+4791234567");
  assert.equal(normalizeNorwegianPhone("+47-912-34-567"), "+4791234567");
  assert.equal(normalizeNorwegianPhone("(+47) 91234567"), "+4791234567");
});

test("REQ-130: avviser for kort/lang nummer", () => {
  assert.throws(
    () => normalizeNorwegianPhone("1234567"),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_PHONE"
  );
  assert.throws(
    () => normalizeNorwegianPhone("+47123456789"),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_PHONE"
  );
});

test("REQ-130: avviser ikke-norsk landkode", () => {
  assert.throws(
    () => normalizeNorwegianPhone("+4612345678"),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_PHONE"
  );
});

test("REQ-130: avviser ikke-tall i input", () => {
  assert.throws(
    () => normalizeNorwegianPhone("+47912abc67"),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_PHONE"
  );
});

test("REQ-130: avviser tomt input", () => {
  assert.throws(
    () => normalizeNorwegianPhone(""),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_PHONE"
  );
  assert.throws(
    () => normalizeNorwegianPhone("   "),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_PHONE"
  );
});

test("REQ-130: avviser ikke-streng input", () => {
  assert.throws(
    () => normalizeNorwegianPhone(91234567 as unknown as string),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_PHONE"
  );
});

test("REQ-130: isValidNorwegianPhone returnerer true/false uten å kaste", () => {
  assert.equal(isValidNorwegianPhone("+4791234567"), true);
  assert.equal(isValidNorwegianPhone("91234567"), true);
  assert.equal(isValidNorwegianPhone("invalid"), false);
  assert.equal(isValidNorwegianPhone(""), false);
});
