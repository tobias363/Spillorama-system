/**
 * GAP #23: unit-tester for ScreenSaverService validering.
 *
 * Object.create-pattern (samme som SettingsService.test.ts):
 *   - Stub Pool — kaster hvis test når DB-laget (validering skal stoppe først).
 *   - Verifiserer at service avviser ugyldig input før Postgres.
 *
 * Integrasjon mot ekte tabell dekkes av routes/__tests__/adminScreenSaver.test.ts
 * (som stubber service-laget men kjører hele Express-stacken).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ScreenSaverService } from "./ScreenSaverService.js";
import { DomainError } from "../game/BingoEngine.js";

function makeValidatingService(): ScreenSaverService {
  const svc = Object.create(ScreenSaverService.prototype) as ScreenSaverService;
  const stubPool = {
    query: async () => {
      throw new Error("UNEXPECTED_POOL_CALL — validering skulle ha stoppet her");
    },
    connect: async () => {
      throw new Error("UNEXPECTED_POOL_CALL — validering skulle ha stoppet her");
    },
  };
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
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
      assert.equal(err.code, expectedCode, `${label}: feil DomainError-kode (fikk ${err.code})`);
    }
  }
}

// ── create-validation ──────────────────────────────────────────────────────

test("GAP-23 service: create avviser tom imageUrl", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "tom imageUrl",
    () => svc.create({ imageUrl: "", createdBy: "u-1" }),
    "INVALID_INPUT"
  );
});

test("GAP-23 service: create avviser ikke-http(s) URL", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "ftp-url",
    () => svc.create({ imageUrl: "ftp://example.com/x.png", createdBy: "u-1" }),
    "INVALID_IMAGE_URL"
  );
  await expectDomainError(
    "javascript-url",
    () => svc.create({ imageUrl: "javascript:alert(1)", createdBy: "u-1" }),
    "INVALID_IMAGE_URL"
  );
});

test("GAP-23 service: create avviser displaySeconds < 1", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "0 sek",
    () =>
      svc.create({
        imageUrl: "https://cdn.example.com/x.png",
        displaySeconds: 0,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
  await expectDomainError(
    "-5 sek",
    () =>
      svc.create({
        imageUrl: "https://cdn.example.com/x.png",
        displaySeconds: -5,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("GAP-23 service: create avviser displaySeconds > 300", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "301 sek",
    () =>
      svc.create({
        imageUrl: "https://cdn.example.com/x.png",
        displaySeconds: 301,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("GAP-23 service: create avviser displaySeconds som ikke er heltall", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "1.5 sek",
    () =>
      svc.create({
        imageUrl: "https://cdn.example.com/x.png",
        displaySeconds: 1.5,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("GAP-23 service: create avviser negativ displayOrder", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negativ order",
    () =>
      svc.create({
        imageUrl: "https://cdn.example.com/x.png",
        displayOrder: -1,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("GAP-23 service: create avviser tom createdBy", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "tom createdBy",
    () =>
      svc.create({
        imageUrl: "https://cdn.example.com/x.png",
        createdBy: "",
      }),
    "INVALID_INPUT"
  );
});

// ── update-validation ──────────────────────────────────────────────────────
//
// `update()` kaller `get()` først (les eksisterende rad), så validering
// kan ikke testes uten å stubbe `get()`. Denne stien dekkes av
// integrasjonstesten i routes/__tests__/adminScreenSaver.test.ts.

// ── reorder-validation ─────────────────────────────────────────────────────

test("GAP-23 service: reorder avviser tom liste", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "tom reorder",
    () => svc.reorder([]),
    "INVALID_INPUT"
  );
});

test("GAP-23 service: reorder avviser duplikate id-er", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "dup id",
    () =>
      svc.reorder([
        { id: "a", displayOrder: 0 },
        { id: "a", displayOrder: 1 },
      ]),
    "INVALID_INPUT"
  );
});

test("GAP-23 service: reorder avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "tom id",
    () => svc.reorder([{ id: "", displayOrder: 0 }]),
    "INVALID_INPUT"
  );
});

test("GAP-23 service: reorder avviser ugyldig displayOrder", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negativ order i reorder",
    () => svc.reorder([{ id: "a", displayOrder: -1 }]),
    "INVALID_INPUT"
  );
});

// ── getCarouselForHall validation ──────────────────────────────────────────

test("GAP-23 service: getCarouselForHall krever hallId", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "tom hallId",
    () => svc.getCarouselForHall(""),
    "INVALID_INPUT"
  );
});

test("GAP-23 service: get krever id", async () => {
  const svc = makeValidatingService();
  await expectDomainError("tom id", () => svc.get(""), "INVALID_INPUT");
});

test("GAP-23 service: remove krever id", async () => {
  const svc = makeValidatingService();
  await expectDomainError("tom id remove", () => svc.remove(""), "INVALID_INPUT");
});
