/**
 * BIN-677: unit-tester for SettingsService validering.
 *
 * Integrasjonstestene (routes/__tests__/adminSettings.test.ts) stubber ut
 * service. Denne filen verifiserer at service-laget avviser ugyldig input
 * før det når Postgres. Object.create-pattern (samme som
 * LeaderboardTierService-test).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SettingsService, SYSTEM_SETTING_REGISTRY } from "./SettingsService.js";
import { DomainError } from "../errors/DomainError.js";

function makeValidatingService(): SettingsService {
  const svc = Object.create(SettingsService.prototype) as SettingsService;
  const stubPool = {
    query: async () => {
      throw new Error(
        "UNEXPECTED_POOL_CALL — validering skulle ha stoppet her"
      );
    },
    connect: async () => {
      throw new Error(
        "UNEXPECTED_POOL_CALL — validering skulle ha stoppet her"
      );
    },
  };
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { initPromise: Promise<void> }).initPromise =
    Promise.resolve();
  return svc;
}

async function expectDomainError(
  label: string,
  fn: () => Promise<unknown>,
  expectedCode?: string
): Promise<void> {
  try {
    await fn();
    assert.fail(`${label}: forventet DomainError men fikk success`);
  } catch (err) {
    if (!(err instanceof DomainError)) {
      throw err;
    }
    if (expectedCode) {
      assert.equal(err.code, expectedCode, `${label}: feil DomainError-kode`);
    }
  }
}

// ── Registry sanity ─────────────────────────────────────────────────────────

test("BIN-677 registry: alle nøkler følger <category>.<name>-mønster", () => {
  for (const def of SYSTEM_SETTING_REGISTRY) {
    assert.match(
      def.key,
      /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)+$/,
      `ugyldig key-format: ${def.key}`
    );
  }
});

test("BIN-677 registry: defaultValue matcher type for alle nøkler", () => {
  for (const def of SYSTEM_SETTING_REGISTRY) {
    switch (def.type) {
      case "string":
        assert.equal(
          typeof def.defaultValue,
          "string",
          `${def.key}: defaultValue ikke string`
        );
        break;
      case "number":
        assert.equal(
          typeof def.defaultValue,
          "number",
          `${def.key}: defaultValue ikke number`
        );
        break;
      case "boolean":
        assert.equal(
          typeof def.defaultValue,
          "boolean",
          `${def.key}: defaultValue ikke boolean`
        );
        break;
      case "object":
        assert.equal(
          def.defaultValue !== null &&
            typeof def.defaultValue === "object" &&
            !Array.isArray(def.defaultValue),
          true,
          `${def.key}: defaultValue ikke objekt`
        );
        break;
    }
  }
});

test("BIN-677 registry: key er unik", () => {
  const seen = new Set<string>();
  for (const def of SYSTEM_SETTING_REGISTRY) {
    assert.equal(seen.has(def.key), false, `duplicate key: ${def.key}`);
    seen.add(def.key);
  }
});

// ── patch-validering ────────────────────────────────────────────────────────

test("BIN-677 service: patch() avviser tom liste", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty patches",
    () => svc.patch([], "u-1"),
    "INVALID_INPUT"
  );
});

test("BIN-677 service: patch() avviser ukjent key", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "unknown key",
    () =>
      svc.patch([{ key: "totally.made.up.key", value: "x" }], "u-1"),
    "SETTING_UNKNOWN"
  );
});

test("BIN-677 service: patch() avviser duplikat-key i samme batch", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "duplicate keys",
    () =>
      svc.patch(
        [
          { key: "system.timezone", value: "Europe/Oslo" },
          { key: "system.timezone", value: "UTC" },
        ],
        "u-1"
      ),
    "INVALID_INPUT"
  );
});

test("BIN-677 service: patch() avviser string-value på number-key", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "wrong type (string for number)",
    () =>
      svc.patch(
        [{ key: "compliance.daily_spending_default", value: "5000" }],
        "u-1"
      ),
    "INVALID_INPUT"
  );
});

test("BIN-677 service: patch() avviser number-value på string-key", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "wrong type (number for string)",
    () =>
      svc.patch([{ key: "system.timezone", value: 42 }], "u-1"),
    "INVALID_INPUT"
  );
});

test("BIN-677 service: patch() avviser null som object-value", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "null for object",
    () => svc.patch([{ key: "features.flags", value: null }], "u-1"),
    "INVALID_INPUT"
  );
});

test("BIN-677 service: patch() avviser array som object-value", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "array for object",
    () =>
      svc.patch([{ key: "features.flags", value: [true, false] }], "u-1"),
    "INVALID_INPUT"
  );
});

test("BIN-677 service: patch() avviser features.flags med non-boolean inni", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "non-boolean flag value",
    () =>
      svc.patch(
        [{ key: "features.flags", value: { featureA: "yes" } }],
        "u-1"
      ),
    "INVALID_INPUT"
  );
});

test("BIN-677 service: patch() tillater gyldig features.flags-objekt", async () => {
  const svc = makeValidatingService();
  // Validering skal ikke kaste — forventer at vi når pool (som stubs Error).
  try {
    await svc.patch(
      [{ key: "features.flags", value: { featureA: true, featureB: false } }],
      "u-1"
    );
    assert.fail("forventet feil fra stubbet pool");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(!(err instanceof DomainError));
    assert.match((err as Error).message, /UNEXPECTED_POOL_CALL/);
  }
});

test("BIN-677 service: patch() tillater NaN-sjekk (ikke-endelig number avvises)", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "NaN as number",
    () =>
      svc.patch(
        [{ key: "compliance.daily_spending_default", value: Number.NaN }],
        "u-1"
      ),
    "INVALID_INPUT"
  );
});

test("BIN-677 service: patch() avviser patch uten key", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "missing key",
    () =>
      svc.patch(
        [{ key: "", value: "x" } as { key: string; value: unknown }],
        "u-1"
      ),
    "INVALID_INPUT"
  );
});

// ── get-validering ──────────────────────────────────────────────────────────

test("BIN-677 service: get() avviser tom key", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty key",
    () => svc.get(""),
    "INVALID_INPUT"
  );
});

test("BIN-677 service: get() avviser ukjent key", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "unknown key",
    () => svc.get("no.such.key"),
    "SETTING_UNKNOWN"
  );
});
