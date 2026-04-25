/**
 * GAP #25: tester for ISO-3166-1 alpha-2 country-list-utility.
 *
 * Verifiserer:
 *   - Lengde nær 249 (offisielt antall ISO-3166-1)
 *   - Norge finnes med kode "NO" og navn "Norge"
 *   - Sortering: norsk locale (æøå håndteres riktig)
 *   - Alle koder er 2 store bokstaver
 *   - Ingen duplikater
 *   - findCountryByCode er case-insensitive
 *   - getValidCountryCodes returnerer Set med riktig størrelse
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  getCountryList,
  findCountryByCode,
  getValidCountryCodes,
  _RAW_ISO_LIST,
} from "./iso3166.js";

test("GAP-25 iso3166: lista har ~249 land (ISO-3166-1 standard)", () => {
  const list = getCountryList();
  // ISO-3166-1 har offisielt 249 oppføringer (per 2024). Vi tillater 240-260
  // som rimelig vindu — standard endres sjelden.
  assert.ok(list.length >= 240, `forventet >=240 land, fikk ${list.length}`);
  assert.ok(list.length <= 260, `forventet <=260 land, fikk ${list.length}`);
});

test("GAP-25 iso3166: Norge finnes (NO=Norge)", () => {
  const list = getCountryList();
  const no = list.find((c) => c.code === "NO");
  assert.ok(no, "NO må finnes i listen");
  assert.equal(no!.nameNo, "Norge");
  assert.equal(no!.nameEn, "Norway");
});

test("GAP-25 iso3166: shape — code, nameNo, nameEn er strenger", () => {
  const list = getCountryList();
  for (const c of list) {
    assert.equal(typeof c.code, "string", `code må være string for ${c.code}`);
    assert.equal(typeof c.nameNo, "string", `nameNo må være string for ${c.code}`);
    assert.equal(typeof c.nameEn, "string", `nameEn må være string for ${c.code}`);
    assert.ok(c.code.length === 2, `code må være 2 bokstaver: ${c.code}`);
    assert.ok(/^[A-Z]{2}$/.test(c.code), `code må være store ASCII-bokstaver: ${c.code}`);
    assert.ok(c.nameNo.length > 0, `nameNo kan ikke være tom for ${c.code}`);
    assert.ok(c.nameEn.length > 0, `nameEn kan ikke være tom for ${c.code}`);
  }
});

test("GAP-25 iso3166: sortert alfabetisk på nameNo (norsk locale)", () => {
  const list = getCountryList();
  const collator = new Intl.Collator("nb-NO", { sensitivity: "base" });
  for (let i = 1; i < list.length; i += 1) {
    const cmp = collator.compare(list[i - 1]!.nameNo, list[i]!.nameNo);
    assert.ok(
      cmp <= 0,
      `sortering brutt mellom "${list[i - 1]!.nameNo}" og "${list[i]!.nameNo}"`
    );
  }
});

test("GAP-25 iso3166: ingen duplikate koder", () => {
  const list = getCountryList();
  const seen = new Set<string>();
  for (const c of list) {
    assert.equal(seen.has(c.code), false, `duplikat code: ${c.code}`);
    seen.add(c.code);
  }
});

test("GAP-25 iso3166: råliste og sortert liste har samme lengde", () => {
  const list = getCountryList();
  assert.equal(list.length, _RAW_ISO_LIST.length);
});

test("GAP-25 iso3166: getCountryList returnerer en NY array (mutering OK)", () => {
  const a = getCountryList();
  const b = getCountryList();
  assert.notStrictEqual(a, b, "skal returnere ny array hver gang");
  // Mutere ikke originalen
  a.pop();
  const c = getCountryList();
  assert.equal(c.length, b.length, "mutering på utgang skal ikke påvirke kilde");
});

test("GAP-25 iso3166: findCountryByCode er case-insensitive", () => {
  const lower = findCountryByCode("no");
  const upper = findCountryByCode("NO");
  const mixed = findCountryByCode("nO");
  assert.ok(lower);
  assert.ok(upper);
  assert.ok(mixed);
  assert.equal(lower!.code, "NO");
  assert.equal(upper!.code, "NO");
  assert.equal(mixed!.code, "NO");
});

test("GAP-25 iso3166: findCountryByCode returnerer undefined for ukjent kode", () => {
  assert.equal(findCountryByCode("XX"), undefined);
  assert.equal(findCountryByCode(""), undefined);
  assert.equal(findCountryByCode("ZZZ"), undefined);
});

test("GAP-25 iso3166: findCountryByCode trimmer whitespace", () => {
  const padded = findCountryByCode("  no  ");
  assert.ok(padded);
  assert.equal(padded!.code, "NO");
});

test("GAP-25 iso3166: getValidCountryCodes har samme størrelse som lista", () => {
  const codes = getValidCountryCodes();
  const list = getCountryList();
  assert.equal(codes.size, list.length);
  assert.ok(codes.has("NO"));
  assert.ok(codes.has("SE"));
  assert.ok(codes.has("DK"));
  assert.ok(!codes.has("XX"));
});

test("GAP-25 iso3166: kjente naboer eksisterer (SE, DK, FI, IS)", () => {
  for (const code of ["SE", "DK", "FI", "IS"]) {
    const c = findCountryByCode(code);
    assert.ok(c, `${code} må finnes`);
  }
  assert.equal(findCountryByCode("SE")!.nameNo, "Sverige");
  assert.equal(findCountryByCode("DK")!.nameNo, "Danmark");
  assert.equal(findCountryByCode("FI")!.nameNo, "Finland");
  assert.equal(findCountryByCode("IS")!.nameNo, "Island");
});

test("GAP-25 iso3166: æøå-land sorteres etter z (norsk locale)", () => {
  const list = getCountryList();
  // I norsk sortering kommer æ/ø/å etter z. For eksempel "Åland" og "Østerrike"
  // skal komme etter "Zimbabwe".
  const aland = list.findIndex((c) => c.code === "AX");
  const osterrike = list.findIndex((c) => c.code === "AT");
  const zimbabwe = list.findIndex((c) => c.code === "ZW");
  assert.ok(aland > zimbabwe, "Åland skal sorteres etter Zimbabwe i norsk locale");
  assert.ok(osterrike > zimbabwe, "Østerrike skal sorteres etter Zimbabwe i norsk locale");
});
