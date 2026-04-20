/**
 * BIN-676: unit-tester for CmsService validering.
 *
 * Integrasjonstestene (routes/__tests__/adminCms.test.ts) stubber ut service.
 * Denne filen verifiserer at service-laget avviser ugyldig input før det når
 * Postgres. Object.create-pattern (samme som SettingsService-test).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  CmsService,
  CMS_SLUGS,
  CMS_VERSION_HISTORY_REQUIRED,
} from "./CmsService.js";
import { DomainError } from "../game/BingoEngine.js";

function makeValidatingService(): CmsService {
  const svc = Object.create(CmsService.prototype) as CmsService;
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

// ── Slug-whitelist ──────────────────────────────────────────────────────────

test("BIN-676 CMS_SLUGS whitelist: eksakt fem slugs", () => {
  assert.deepEqual([...CMS_SLUGS], [
    "aboutus",
    "terms",
    "support",
    "links",
    "responsible-gaming",
  ]);
});

test("BIN-676 version-history-required inkluderer responsible-gaming", () => {
  assert.ok(
    CMS_VERSION_HISTORY_REQUIRED.includes("responsible-gaming"),
    "responsible-gaming skal være i version-history-required-listen"
  );
});

// ── getContent — slug-validering ────────────────────────────────────────────

test("BIN-676 getContent avviser ukjent slug", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "ukjent slug",
    () => svc.getContent("not-a-slug"),
    "CMS_SLUG_UNKNOWN"
  );
});

test("BIN-676 getContent avviser tom slug", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "tom slug",
    () => svc.getContent(""),
    "INVALID_INPUT"
  );
});

// ── updateContent — FEATURE_DISABLED-gate ───────────────────────────────────

test("BIN-676 updateContent(responsible-gaming) kaster FEATURE_DISABLED", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "responsible-gaming gated",
    () => svc.updateContent("responsible-gaming", "<p>noe</p>", "admin-1"),
    "FEATURE_DISABLED"
  );
});

test("BIN-676 updateContent avviser ikke-string content for gyldig slug", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "number content",
    () => svc.updateContent("aboutus", 42 as unknown, "admin-1"),
    "INVALID_INPUT"
  );
});

test("BIN-676 updateContent avviser content over 200k tegn", async () => {
  const svc = makeValidatingService();
  const huge = "x".repeat(200_001);
  await expectDomainError(
    "200k+ content",
    () => svc.updateContent("aboutus", huge, "admin-1"),
    "INVALID_INPUT"
  );
});

test("BIN-676 updateContent avviser ukjent slug før FEATURE_DISABLED", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "ukjent slug ved update",
    () => svc.updateContent("not-a-slug", "hi", "admin-1"),
    "CMS_SLUG_UNKNOWN"
  );
});

// ── FAQ-validering ──────────────────────────────────────────────────────────

test("BIN-676 createFaq krever question", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "tom question",
    () =>
      svc.createFaq({
        question: "",
        answer: "svar",
        createdBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-676 createFaq krever answer", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "tom answer",
    () =>
      svc.createFaq({
        question: "spm?",
        answer: "   ",
        createdBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-676 createFaq krever createdBy", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "mangler createdBy",
    () =>
      svc.createFaq({
        question: "q?",
        answer: "s",
        createdBy: "",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-676 createFaq avviser sortOrder < 0", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negativ sortOrder",
    () =>
      svc.createFaq({
        question: "q?",
        answer: "s",
        sortOrder: -1,
        createdBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-676 createFaq avviser question over 1000 tegn", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "question 1001 tegn",
    () =>
      svc.createFaq({
        question: "q".repeat(1001),
        answer: "s",
        createdBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-676 createFaq avviser answer over 10k tegn", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "answer 10001 tegn",
    () =>
      svc.createFaq({
        question: "q",
        answer: "s".repeat(10_001),
        createdBy: "admin-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-676 updateFaq krever id", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "tom id",
    () => svc.updateFaq("", { question: "ny?" }, "admin-1"),
    "INVALID_INPUT"
  );
});

test("BIN-676 updateFaq avviser sortOrder som ikke er tall", async () => {
  // Stub getFaq slik at vi når inn til validering av patch-feltene.
  const svc = makeValidatingService();
  (svc as unknown as { getFaq: (id: string) => Promise<unknown> }).getFaq =
    async () => ({
      id: "faq-1",
      question: "q",
      answer: "s",
      sortOrder: 0,
      createdByUserId: null,
      updatedByUserId: null,
      createdAt: "2026-04-20T10:00:00Z",
      updatedAt: "2026-04-20T10:00:00Z",
    });
  await expectDomainError(
    "string sortOrder",
    () =>
      svc.updateFaq(
        "faq-1",
        { sortOrder: "high" as unknown as number },
        "admin-1"
      ),
    "INVALID_INPUT"
  );
});

test("BIN-676 updateFaq avviser tom patch", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { getFaq: (id: string) => Promise<unknown> }).getFaq =
    async () => ({
      id: "faq-1",
      question: "q",
      answer: "s",
      sortOrder: 0,
      createdByUserId: null,
      updatedByUserId: null,
      createdAt: "2026-04-20T10:00:00Z",
      updatedAt: "2026-04-20T10:00:00Z",
    });
  await expectDomainError(
    "tom patch",
    () => svc.updateFaq("faq-1", {}, "admin-1"),
    "INVALID_INPUT"
  );
});

test("BIN-676 deleteFaq krever id (indirekte via getFaq)", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "tom id",
    () => svc.deleteFaq(""),
    "INVALID_INPUT"
  );
});
