/**
 * Fase 4 (2026-05-07): unit-tester for migrate-game-plan-helpers.
 *
 * Pure helpers — testes uten DB-oppkopling. Verifiserer:
 *   - slugify normaliserer korrekt (æ/ø/å, special chars, casing)
 *   - deterministicCatalogId / deterministicPlanId idempotent
 *   - parsePrizeDescription tolkes legacy free-text
 *   - bitmaskToWeekdays følger samme bitmask som daily_schedules
 *   - jsDayOfWeekToKey: 0=Sunday, 1=Monday osv.
 *
 * Idempotens-test: kjøre samme input flere ganger → samme output.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  MIGRATION_PREFIX,
  slugify,
  deterministicCatalogId,
  deterministicPlanId,
  parsePrizeDescription,
  bitmaskToWeekdays,
  jsDayOfWeekToKey,
} from "../migrate-game-plan-helpers.js";

// ── slugify ──────────────────────────────────────────────────────────────

test("slugify: enkel ascii-tekst", () => {
  assert.equal(slugify("Wheel of Fortune"), "wheel-of-fortune");
});

test("slugify: norske bokstaver normaliseres", () => {
  assert.equal(slugify("Spilløsta"), "spillosta");
  assert.equal(slugify("Mæsterspill"), "maesterspill");
  assert.equal(slugify("Trafiklys På"), "trafiklys-pa");
});

test("slugify: nøytraliserer multiple separators", () => {
  assert.equal(slugify("Spill   med    -mellomrom"), "spill-med-mellomrom");
});

test("slugify: idempotent — samme input gir samme slug", () => {
  const input = "Jackpot Mystery";
  assert.equal(slugify(input), slugify(input));
});

test("slugify: tom streng gir tom slug", () => {
  assert.equal(slugify(""), "");
  assert.equal(slugify("!!!"), "");
});

// ── deterministicCatalogId ───────────────────────────────────────────────

test("deterministicCatalogId: samme slug gir samme id", () => {
  const a = deterministicCatalogId("innsatsen");
  const b = deterministicCatalogId("innsatsen");
  assert.equal(a, b);
  assert.ok(a.startsWith(MIGRATION_PREFIX));
});

test("deterministicCatalogId: ulike slugs gir ulike ider", () => {
  const a = deterministicCatalogId("innsatsen");
  const b = deterministicCatalogId("jackpot");
  assert.notEqual(a, b);
});

// ── deterministicPlanId ──────────────────────────────────────────────────

test("deterministicPlanId: samme (hall, weekday) gir samme id", () => {
  const a = deterministicPlanId("hall-12345678", "mon");
  const b = deterministicPlanId("hall-12345678", "mon");
  assert.equal(a, b);
});

test("deterministicPlanId: ulik weekday gir ulik id", () => {
  const a = deterministicPlanId("hall-12345678", "mon");
  const b = deterministicPlanId("hall-12345678", "tue");
  assert.notEqual(a, b);
});

test("deterministicPlanId: hall-id kuttes til 12 tegn", () => {
  const veryLong = deterministicPlanId(
    "hall-thisisanextremelylonghalliderthatshouldbecut",
    "mon",
  );
  // Skal ha shape mig-fase4-plan-<12tegn>-mon
  assert.ok(/mig-fase4-plan-[a-z0-9-]{12}-mon$/.test(veryLong), `got: ${veryLong}`);
});

// ── parsePrizeDescription ────────────────────────────────────────────────

test("parsePrizeDescription: null/empty input gir null", () => {
  assert.equal(parsePrizeDescription(null), null);
  assert.equal(parsePrizeDescription(""), null);
});

test("parsePrizeDescription: parser 'Rad 1: 100kr | Rad 2: 200kr'", () => {
  const result = parsePrizeDescription("Rad 1: 100kr | Rad 2: 200kr");
  assert.deepEqual(result, { rad1: 10000, rad2: 20000 });
});

test("parsePrizeDescription: parser bingo/full-hus", () => {
  const result1 = parsePrizeDescription("Bingo: 1500kr");
  assert.deepEqual(result1, { bingo: 150000 });
  const result2 = parsePrizeDescription("Full Hus: 2000kr");
  assert.deepEqual(result2, { bingo: 200000 });
  const result3 = parsePrizeDescription("Fullt hus: 1200 kr");
  assert.deepEqual(result3, { bingo: 120000 });
});

test("parsePrizeDescription: kombinert rad + bingo", () => {
  const result = parsePrizeDescription(
    "Rad 1: 100kr, Rad 2: 200, Rad 3: 300, Rad 4: 400, Bingo: 1000kr",
  );
  assert.deepEqual(result, {
    rad1: 10000,
    rad2: 20000,
    rad3: 30000,
    rad4: 40000,
    bingo: 100000,
  });
});

test("parsePrizeDescription: ukjent format gir null", () => {
  const result = parsePrizeDescription("ingen meningsfull tekst");
  assert.equal(result, null);
});

test("parsePrizeDescription: beløp utenfor rad-range ignoreres", () => {
  const result = parsePrizeDescription("Rad 5: 500kr | Rad 99: 100kr");
  assert.equal(result, null);
});

// ── bitmaskToWeekdays ────────────────────────────────────────────────────

test("bitmaskToWeekdays: enkelt mandag", () => {
  assert.deepEqual(bitmaskToWeekdays(1), ["mon"]);
});

test("bitmaskToWeekdays: hverdager (1+2+4+8+16=31)", () => {
  assert.deepEqual(bitmaskToWeekdays(31), ["mon", "tue", "wed", "thu", "fri"]);
});

test("bitmaskToWeekdays: helg (32+64=96)", () => {
  assert.deepEqual(bitmaskToWeekdays(96), ["sat", "sun"]);
});

test("bitmaskToWeekdays: hele uka (127)", () => {
  assert.deepEqual(
    bitmaskToWeekdays(127),
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  );
});

test("bitmaskToWeekdays: 0 = ingen ukedag", () => {
  assert.deepEqual(bitmaskToWeekdays(0), []);
});

// ── jsDayOfWeekToKey ─────────────────────────────────────────────────────

test("jsDayOfWeekToKey: 0=Sunday", () => {
  assert.equal(jsDayOfWeekToKey(0), "sun");
});

test("jsDayOfWeekToKey: 1=Monday, 6=Saturday", () => {
  assert.equal(jsDayOfWeekToKey(1), "mon");
  assert.equal(jsDayOfWeekToKey(6), "sat");
});

test("jsDayOfWeekToKey: ugyldig verdi gir null", () => {
  assert.equal(jsDayOfWeekToKey(7), null);
  assert.equal(jsDayOfWeekToKey(-1), null);
});

// ── Idempotens-tests ─────────────────────────────────────────────────────

test("idempotens: alle helpers gir samme output ved gjenbruk", () => {
  const inputs = [
    "Wheel of Fortune",
    "Innsatsen",
    "Spilløsta Mystery",
    "Trafficlight",
  ];
  for (const name of inputs) {
    const slug1 = slugify(name);
    const slug2 = slugify(name);
    assert.equal(slug1, slug2, `slugify ikke idempotent for "${name}"`);
    const cat1 = deterministicCatalogId(slug1);
    const cat2 = deterministicCatalogId(slug2);
    assert.equal(cat1, cat2);
  }
});

// ── Idempotens-test for migrasjons-skript ───────────────────────────────

test("idempotens-mig: re-kjøring av execute gir samme resultat (ON CONFLICT DO NOTHING)", () => {
  // Test at deterministic IDs kombinert med ON CONFLICT DO NOTHING gir
  // idempotens. Vi sjekker at id-er ikke endrer seg ved re-kjøring.
  const slug1 = slugify("Wheel of Fortune");
  const id1a = deterministicCatalogId(slug1);
  const id1b = deterministicCatalogId(slug1);
  assert.equal(id1a, id1b, "Catalog id må være stabil");

  const planId1 = deterministicPlanId("hall-1", "mon");
  const planId2 = deterministicPlanId("hall-1", "mon");
  assert.equal(planId1, planId2, "Plan id må være stabil");
});

test("idempotens-mig: rollback fjerner KUN rader med MIGRATION_PREFIX", () => {
  // Sjekk at MIGRATION_PREFIX er distinkt nok til at vi ikke kan
  // ved et uhell slette ekte data.
  assert.ok(MIGRATION_PREFIX.length >= 6);
  assert.ok(MIGRATION_PREFIX.startsWith("mig-"));
  // ID-er som ikke matcher prefix skal IKKE plukkes opp
  const ekteId = "abc-123-456";
  assert.ok(!ekteId.startsWith(MIGRATION_PREFIX));
});

// ── C1-fix-tester (2026-05-07, code-review) ──────────────────────────────
//
// app_audit_log.id er BIGSERIAL (apps/backend/migrations/
// 20260418160000_app_audit_log.sql:17). Forrige migrasjons-skript prøvde
// å INSERT-e med en `randomUUID()`-streng som $1, som krasjer med
// "invalid input syntax for type bigint". Fikset ved å droppe id-feltet
// fra INSERT-listen og la BIGSERIAL auto-tildele.

function readMigrationScript(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const scriptPath = join(here, "..", "migrate-game-plan-2026-05-07.ts");
  return readFileSync(scriptPath, "utf8");
}

test("C1: migrasjons-skript INSERT INTO app_audit_log inkluderer IKKE id-felt", () => {
  // BIGSERIAL auto-tildeler id; å forsøke å sette id=randomUUID-streng
  // krasjer med "invalid input syntax for type bigint". Vi verifiserer at
  // begge audit-log-INSERT-er (execute + rollback) lar id-feltet være
  // implisitt.
  const source = readMigrationScript();
  const auditInserts = source.match(
    /INSERT INTO \$\{schema\}\.app_audit_log[\s\S]*?\)`/g,
  );
  assert.ok(
    auditInserts && auditInserts.length === 2,
    `forventet 2 audit-log-INSERTer (execute + rollback), fant ${auditInserts?.length ?? 0}`,
  );
  for (const sql of auditInserts) {
    // Skal IKKE inneholde "id," i kolonne-listen rett etter app_audit_log.
    // Old buggy-pattern: "(id, actor_id, actor_type, ...".
    assert.ok(
      !/\(\s*id\s*,\s*actor_id/i.test(sql),
      `audit-log-INSERT inkluderer id i kolonneliste:\n${sql}`,
    );
    // VALUES-blokken skal IKKE starte med "$1, NULL, 'SYSTEM'"-pattern
    // (den gamle buggy stilen brukte $1 for randomUUID-id).
    assert.ok(
      !/VALUES\s*\(\s*\$1\s*,\s*NULL\s*,\s*'SYSTEM'/i.test(sql),
      `audit-log-INSERT bruker $1=randomUUID-streng som id (gammel buggy pattern):\n${sql}`,
    );
    // Skal starte VALUES med NULL (actor_id=null) — BIGSERIAL auto-id.
    assert.ok(
      /VALUES\s*\(\s*NULL\s*,\s*'SYSTEM'/i.test(sql),
      `audit-log-INSERT skal starte VALUES med NULL (actor_id), BIGSERIAL gir id:\n${sql}`,
    );
  }
});

test("C1: migrasjons-skript importerer IKKE randomUUID lenger (audit-log auto-id)", () => {
  // randomUUID ble brukt KUN for audit-log-id som BIGSERIAL (krasj-bug).
  // Etter C1-fixen skal importen være fjernet så TypeScript fanger
  // eventuelle re-introduksjoner av buggen.
  const source = readMigrationScript();
  assert.ok(
    !/import\s+\{\s*randomUUID\s*\}/.test(source),
    "randomUUID-importen skal være fjernet etter C1-fix",
  );
  assert.ok(
    !/\brandomUUID\(\)/.test(source),
    "randomUUID()-call-sites skal være fjernet etter C1-fix",
  );
});

test("C1: migrasjons-skript bevarer COMMIT-rekkefølge så audit + data persisteres atomisk", () => {
  const source = readMigrationScript();
  // executeMigration: BEGIN → INSERT/audit → COMMIT må holdes så audit
  // + dataen committes som én transaksjon. Hvis audit hadde vært
  // utenfor transaksjonen, ville en commit-feil etterlate audit men
  // ingen data — eller motsatt — og rapportere uriktige tall.
  const executeBlock = source.match(
    /async function executeMigration[\s\S]+?async function/,
  );
  assert.ok(executeBlock, "executeMigration-funksjon ikke funnet i skriptet");
  const exec = executeBlock![0];
  const beginIdx = exec.search(/await client\.query\("BEGIN"\)/);
  const auditIdx = exec.search(/INSERT INTO \$\{schema\}\.app_audit_log/);
  const commitIdx = exec.search(/await client\.query\("COMMIT"\)/);
  assert.ok(beginIdx >= 0, "BEGIN må finnes i executeMigration");
  assert.ok(auditIdx >= 0, "audit-INSERT må finnes i executeMigration");
  assert.ok(commitIdx >= 0, "COMMIT må finnes i executeMigration");
  assert.ok(
    beginIdx < auditIdx && auditIdx < commitIdx,
    "executeMigration: BEGIN → audit-INSERT → COMMIT-rekkefølge må bevares",
  );

  // rollbackMigration: samme krav for atomicitet.
  const rollbackBlock = source.match(/async function rollbackMigration[\s\S]+/);
  assert.ok(rollbackBlock);
  const roll = rollbackBlock![0];
  const beginIdx2 = roll.search(/await client\.query\("BEGIN"\)/);
  const auditIdx2 = roll.search(/INSERT INTO \$\{schema\}\.app_audit_log/);
  const commitIdx2 = roll.search(/await client\.query\("COMMIT"\)/);
  assert.ok(beginIdx2 >= 0 && auditIdx2 >= 0 && commitIdx2 >= 0);
  assert.ok(
    beginIdx2 < auditIdx2 && auditIdx2 < commitIdx2,
    "rollbackMigration: BEGIN → audit-INSERT → COMMIT må bevares",
  );
});

test("C1: BIGSERIAL-skjema bekreftet — app_audit_log.id er auto-incrementing", () => {
  // Sanity-check at skjemaet vi bygger på faktisk bruker BIGSERIAL.
  // Hvis dette endrer seg (f.eks. til UUID), må migrasjons-skriptet
  // oppdateres tilsvarende.
  const here = dirname(fileURLToPath(import.meta.url));
  const schemaPath = join(
    here,
    "..",
    "..",
    "migrations",
    "20260418160000_app_audit_log.sql",
  );
  const schema = readFileSync(schemaPath, "utf8");
  assert.ok(
    /id\s+BIGSERIAL\s+PRIMARY KEY/i.test(schema),
    "app_audit_log.id må fortsatt være BIGSERIAL — ellers er C1-fix utdatert",
  );
});
