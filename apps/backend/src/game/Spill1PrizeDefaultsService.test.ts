/**
 * HV-2 unit tests for Spill1PrizeDefaultsService — in-memory variant.
 *
 * Postgres-implementasjon dekkes via integrasjons-testen
 * (`Spill1PrizeDefaultsService.postgres.test.ts`) som kjører mot lokal DB
 * når det er tilgjengelig — ikke i scope for denne PR-en.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  InMemorySpill1PrizeDefaultsService,
  SPILL1_DEFAULTS_WILDCARD_HALL,
} from "./Spill1PrizeDefaultsService.js";

test("getDefaults: wildcard fallback returnerer hardcoded defaults når seed ikke kalt", async () => {
  const svc = new InMemorySpill1PrizeDefaultsService();
  const result = await svc.getDefaults("hall-A");
  // Hardcoded fallback = SPILL1_SUB_VARIANT_DEFAULTS.standard.
  assert.equal(result.phase1, 100);
  assert.equal(result.phase2, 200);
  assert.equal(result.phase3, 200);
  assert.equal(result.phase4, 200);
  assert.equal(result.phase5, 1000);
});

test("getDefaults: wildcard seed brukes som fallback for hall uten override", async () => {
  const svc = new InMemorySpill1PrizeDefaultsService();
  svc.seedWildcard({ phase1: 150, phase5: 2000 });
  const result = await svc.getDefaults("hall-A");
  assert.equal(result.phase1, 150, "wildcard phase1 brukt");
  assert.equal(result.phase2, 200, "wildcard ikke seeded → hardcoded fallback");
  assert.equal(result.phase5, 2000);
});

test("getDefaults: hall-spesifikk override har presedens over wildcard", async () => {
  const svc = new InMemorySpill1PrizeDefaultsService();
  svc.seedWildcard({ phase1: 100, phase2: 200, phase3: 200, phase4: 200, phase5: 1000 });
  svc.seedHall("hall-luxus", { phase5: 5000 }); // kun phase5 override
  const result = await svc.getDefaults("hall-luxus");
  assert.equal(result.phase5, 5000, "hall-override vinner over wildcard");
  assert.equal(result.phase1, 100, "manglende felter på hall faller tilbake til wildcard");
});

test("setDefault: oppdaterer ny verdi + rejecter ugyldig input", async () => {
  const svc = new InMemorySpill1PrizeDefaultsService();
  await svc.setDefault("hall-test", 1, 250, "admin-1");
  const result = await svc.getDefaults("hall-test");
  assert.equal(result.phase1, 250);

  // Ugyldige inputs skal kaste.
  await assert.rejects(() => svc.setDefault("", 1, 100, "admin"), /hallId/);
  await assert.rejects(() => svc.setDefault("hall", 0 as 1, 100, "admin"), /phaseIndex/);
  await assert.rejects(() => svc.setDefault("hall", 6 as 5, 100, "admin"), /phaseIndex/);
  await assert.rejects(() => svc.setDefault("hall", 1, -1, "admin"), /minPrizeNok/);
  await assert.rejects(() => svc.setDefault("hall", 1, NaN, "admin"), /minPrizeNok/);
});

test("setDefault på wildcard '*' overskriver wildcard-fallback", async () => {
  const svc = new InMemorySpill1PrizeDefaultsService();
  await svc.setDefault(SPILL1_DEFAULTS_WILDCARD_HALL, 5, 1500, "admin");
  // Hall som ikke har egen override skal nå se 1500 for phase5.
  const result = await svc.getDefaults("any-hall");
  assert.equal(result.phase5, 1500);
});

test("loadAll returnerer kun hall-spesifikke rader (ikke wildcard)", async () => {
  const svc = new InMemorySpill1PrizeDefaultsService();
  svc.seedWildcard({ phase1: 100 });
  svc.seedHall("hall-A", { phase1: 200 });
  svc.seedHall("hall-B", { phase5: 5000 });
  const all = await svc.loadAll();
  assert.equal(all.size, 2);
  assert.equal(all.get("hall-A")?.phase1, 200);
  assert.equal(all.get("hall-B")?.phase5, 5000);
  // Hall-B sin phase1 skal være wildcard-fallback (100), ikke hardcoded (100 her).
  assert.equal(all.get("hall-B")?.phase1, 100);
});

test("getDefaultsSync returnerer hardcoded fallback når ingen seed kjørt", () => {
  const svc = new InMemorySpill1PrizeDefaultsService();
  const result = svc.getDefaultsSync("any-hall");
  assert.equal(result.phase1, 100);
  assert.equal(result.phase5, 1000);
});

test("clearCache: fjerner alle hall- og wildcard-rader", async () => {
  const svc = new InMemorySpill1PrizeDefaultsService();
  svc.seedWildcard({ phase1: 999 });
  svc.seedHall("hall-A", { phase5: 9999 });
  svc.clearCache();
  const result = await svc.getDefaults("hall-A");
  // Skal nå være hardcoded fallback igjen.
  assert.equal(result.phase1, 100);
  assert.equal(result.phase5, 1000);
});
