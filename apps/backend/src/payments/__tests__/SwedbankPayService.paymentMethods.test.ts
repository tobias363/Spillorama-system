/**
 * Scenario A — Tobias 2026-04-26.
 *
 * Unit-test av method-routing-helpers i SwedbankPayService:
 *   - normalisePaymentMethod: aksepterer kun whitelist + normaliserer
 *     case + variant-skrivemåter (mellomrom, bindestrek)
 *   - paymentMethodToSwedbankInstruments: returnerer riktige
 *     Swedbank-brand-koder (Visa Debit + MC Debit + Vipps + Apple Pay
 *     + Google Pay)
 *   - normaliseCardFundingType: normaliserer Swedbank's lower-case
 *     funding-strenger til vår enum
 *   - isAcceptableFundingType: REGULATORISK kjernen — kun DEBIT for kort
 *
 * Disse er rene funksjoner uten DB / fetch-avhengigheter, så vi kan
 * teste dem i isolasjon uten å booth-strappe hele service-en.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  SUPPORTED_PAYMENT_METHODS,
  isAcceptableFundingType,
  normaliseCardFundingType,
  normalisePaymentMethod,
  paymentMethodToSwedbankInstruments,
} from "../SwedbankPayService.js";
import { DomainError } from "../../game/BingoEngine.js";

// ── normalisePaymentMethod ─────────────────────────────────────────────────

test("normalisePaymentMethod accepts canonical values", () => {
  for (const m of SUPPORTED_PAYMENT_METHODS) {
    assert.equal(normalisePaymentMethod(m), m);
  }
});

test("normalisePaymentMethod normalises case and separators", () => {
  assert.equal(normalisePaymentMethod("vipps"), "VIPPS");
  assert.equal(normalisePaymentMethod("Visa Debit"), "VISA_DEBIT");
  assert.equal(normalisePaymentMethod("visa-debit"), "VISA_DEBIT");
  assert.equal(normalisePaymentMethod("MASTERCARD_DEBIT"), "MASTERCARD_DEBIT");
  assert.equal(normalisePaymentMethod("apple pay"), "APPLE_PAY");
  assert.equal(normalisePaymentMethod("google-pay"), "GOOGLE_PAY");
});

test("normalisePaymentMethod rejects unknown methods", () => {
  // Generic Visa (uten Debit) er IKKE tillatt — kunde kan ikke
  // velge "Visa" og smugle kreditt-kort gjennom.
  function expectInvalid(value: unknown): void {
    assert.throws(
      () => normalisePaymentMethod(value as string),
      (err: unknown) => err instanceof DomainError && err.code === "INVALID_PAYMENT_METHOD"
    );
  }
  expectInvalid("VISA");
  expectInvalid("MASTERCARD");
  expectInvalid("paypal");
  expectInvalid("");
  expectInvalid(null);
  expectInvalid(123);
});

// ── paymentMethodToSwedbankInstruments ─────────────────────────────────────

test("paymentMethodToSwedbankInstruments uses DEBIT-only brand codes for cards", () => {
  // REGULATORISK: Visa-brand-koden er "VisaDebit" (ikke generic "Visa").
  // Hvis vi sendte "Visa" til Swedbank, ville widget akseptere både
  // debet- OG kredittkort. "VisaDebit" begrenser til debet-only.
  assert.deepEqual(paymentMethodToSwedbankInstruments("VISA_DEBIT"), ["VisaDebit"]);
  assert.deepEqual(paymentMethodToSwedbankInstruments("MASTERCARD_DEBIT"), ["MastercardDebit"]);
});

test("paymentMethodToSwedbankInstruments routes mobile-wallets correctly", () => {
  assert.deepEqual(paymentMethodToSwedbankInstruments("VIPPS"), ["Vipps"]);
  assert.deepEqual(paymentMethodToSwedbankInstruments("APPLE_PAY"), ["ApplePay"]);
  assert.deepEqual(paymentMethodToSwedbankInstruments("GOOGLE_PAY"), ["GooglePay"]);
});

// ── normaliseCardFundingType ───────────────────────────────────────────────

test("normaliseCardFundingType normalises lower-case Swedbank values", () => {
  assert.equal(normaliseCardFundingType("debit"), "DEBIT");
  assert.equal(normaliseCardFundingType("Debit"), "DEBIT");
  assert.equal(normaliseCardFundingType("DEBIT"), "DEBIT");
  assert.equal(normaliseCardFundingType("credit"), "CREDIT");
  assert.equal(normaliseCardFundingType("prepaid"), "PREPAID");
  assert.equal(normaliseCardFundingType("deferred_debit"), "DEFERRED_DEBIT");
});

test("normaliseCardFundingType returns UNKNOWN for unrecognised strings", () => {
  assert.equal(normaliseCardFundingType("rewards"), "UNKNOWN");
  assert.equal(normaliseCardFundingType("something else"), "UNKNOWN");
});

test("normaliseCardFundingType returns undefined for non-strings", () => {
  assert.equal(normaliseCardFundingType(undefined), undefined);
  assert.equal(normaliseCardFundingType(null), undefined);
  assert.equal(normaliseCardFundingType(42), undefined);
});

// ── isAcceptableFundingType (REGULATORISK kjerne) ──────────────────────────

test("isAcceptableFundingType: card payments require DEBIT", () => {
  // Pengespillforskriften: kredittkort er forbudt for innskudd.
  assert.equal(isAcceptableFundingType("VISA_DEBIT", "DEBIT"), true);
  assert.equal(isAcceptableFundingType("MASTERCARD_DEBIT", "DEBIT"), true);

  // Avvis alt annet for kort-flyter — også PREPAID + DEFERRED_DEBIT
  // (DEFERRED_DEBIT er teknisk debet, men Swedbanks kategorisering er
  // ikke 100 % konsistent på tvers av land → safe-default reject).
  assert.equal(isAcceptableFundingType("VISA_DEBIT", "CREDIT"), false);
  assert.equal(isAcceptableFundingType("VISA_DEBIT", "PREPAID"), false);
  assert.equal(isAcceptableFundingType("VISA_DEBIT", "DEFERRED_DEBIT"), false);
  assert.equal(isAcceptableFundingType("VISA_DEBIT", "UNKNOWN"), false);
  assert.equal(isAcceptableFundingType("VISA_DEBIT", undefined), false);

  assert.equal(isAcceptableFundingType("MASTERCARD_DEBIT", "CREDIT"), false);
  assert.equal(isAcceptableFundingType("MASTERCARD_DEBIT", undefined), false);
});

test("isAcceptableFundingType: mobile wallets pass funding-type advisory", () => {
  // Vipps, Apple Pay og Google Pay: Swedbank returnerer som regel ikke
  // cardFundingType for disse — wallet-en selv håndhever underlying
  // funding-source restriksjoner. Vi aksepterer derfor uavhengig.
  for (const method of ["VIPPS", "APPLE_PAY", "GOOGLE_PAY"] as const) {
    assert.equal(isAcceptableFundingType(method, "DEBIT"), true);
    assert.equal(isAcceptableFundingType(method, "CREDIT"), true);
    assert.equal(isAcceptableFundingType(method, undefined), true);
    assert.equal(isAcceptableFundingType(method, "UNKNOWN"), true);
  }
});

// ── SUPPORTED_PAYMENT_METHODS (whitelist sanity) ───────────────────────────

test("SUPPORTED_PAYMENT_METHODS contains exactly Scenario A methods", () => {
  // Hvis denne testen feiler er det fordi noen har lagt til en metode
  // som ikke er regulatorisk klarert. Krever PM-godkjenning.
  assert.deepEqual([...SUPPORTED_PAYMENT_METHODS].sort(), [
    "APPLE_PAY",
    "GOOGLE_PAY",
    "MASTERCARD_DEBIT",
    "VIPPS",
    "VISA_DEBIT",
  ]);
});
