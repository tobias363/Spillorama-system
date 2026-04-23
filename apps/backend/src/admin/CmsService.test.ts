/**
 * BIN-676 + BIN-680: unit-tester for CmsService validering + versjons-flyt.
 *
 * Integrasjonstestene (routes/__tests__/adminCms.test.ts) stubber ut service.
 * Denne filen verifiserer at service-laget avviser ugyldig input før det når
 * Postgres og (BIN-680) at versjons-state-machine håndheves, inkludert 4-øyne-
 * regelen på approve. Object.create-pattern (samme som SettingsService-test).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  CmsService,
  CMS_SLUGS,
  CMS_VERSION_HISTORY_REQUIRED,
  type CmsContentVersion,
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

// ── BIN-680: updateContent(responsible-gaming) oppretter draft, ikke FEATURE_DISABLED ─

test("BIN-680 updateContent(responsible-gaming) uten actorUserId gir INVALID_INPUT", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "responsible-gaming uten actor",
    () => svc.updateContent("responsible-gaming", "<p>noe</p>", null),
    "INVALID_INPUT"
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

// ── BIN-680 Lag 1: versjons-flyt ────────────────────────────────────────────
//
// Stubber pool.query med et fake in-memory lager som speiler nok av Postgres-
// semantikken til å drive state-machine (SELECT MAX, UPDATE med WHERE status).
// Lettere enn å spinne opp faktisk Postgres for unit-testing. Ekte DB-testing
// gjøres separat i route-integrasjonstester + migration-test.

interface FakeVersionRow {
  id: string;
  slug: string;
  version_number: number;
  content: string;
  status: string;
  created_by_user_id: string;
  created_at: string;
  approved_by_user_id: string | null;
  approved_at: string | null;
  published_by_user_id: string | null;
  published_at: string | null;
  retired_at: string | null;
}

function makeVersionedService(): {
  svc: CmsService;
  versions: FakeVersionRow[];
  content: Map<string, { live_version_id: string | null; live_version_number: number | null }>;
} {
  const versions: FakeVersionRow[] = [];
  const content = new Map<
    string,
    { live_version_id: string | null; live_version_number: number | null }
  >();

  async function handle(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    const s = sql.trim().replace(/\s+/g, " ");

    // SELECT MAX(version_number) ...
    if (s.startsWith("SELECT MAX(version_number) AS max")) {
      const [slug] = params as [string];
      const maxForSlug = versions
        .filter((v) => v.slug === slug)
        .reduce((m, v) => Math.max(m, v.version_number), 0);
      return { rows: [{ max: maxForSlug === 0 ? null : maxForSlug }] };
    }

    // INSERT INTO ..._versions (...)
    if (s.startsWith("INSERT INTO") && s.includes("_versions")) {
      const [id, slug, versionNumber, contentValue, createdBy] = params as [
        string,
        string,
        number,
        string,
        string,
      ];
      versions.push({
        id,
        slug,
        version_number: versionNumber,
        content: contentValue,
        status: "draft",
        created_by_user_id: createdBy,
        created_at: new Date().toISOString(),
        approved_by_user_id: null,
        approved_at: null,
        published_by_user_id: null,
        published_at: null,
        retired_at: null,
      });
      return { rows: [] };
    }

    // SELECT ... FROM ..._versions WHERE id = $1
    if (s.startsWith("SELECT id, slug, version_number") && s.includes("WHERE id = $1")) {
      const [id] = params as [string];
      const row = versions.find((v) => v.id === id);
      return { rows: row ? [row] : [] };
    }

    // SELECT ... FROM ..._versions WHERE slug = $1 AND status = 'live'
    if (
      s.startsWith("SELECT id, slug, version_number") &&
      s.includes("WHERE slug = $1 AND status = 'live'")
    ) {
      const [slug] = params as [string];
      const row = versions.find((v) => v.slug === slug && v.status === "live");
      return { rows: row ? [row] : [] };
    }

    // SELECT ... FROM ..._versions WHERE slug = $1 ORDER BY version_number DESC
    if (
      s.startsWith("SELECT id, slug, version_number") &&
      s.includes("WHERE slug = $1 ORDER BY version_number DESC")
    ) {
      const [slug] = params as [string];
      const rows = versions
        .filter((v) => v.slug === slug)
        .sort((a, b) => b.version_number - a.version_number);
      return { rows };
    }

    // SELECT id FROM ..._versions WHERE slug = $1 AND status = 'live' FOR UPDATE
    if (s.startsWith("SELECT id FROM") && s.includes("status = 'live'")) {
      const [slug] = params as [string];
      const row = versions.find((v) => v.slug === slug && v.status === "live");
      return { rows: row ? [{ id: row.id }] : [] };
    }

    // UPDATE ..._versions SET status = 'review' WHERE id = $1 AND status = 'draft'
    if (s.includes("SET status = 'review'")) {
      const [id] = params as [string];
      const row = versions.find((v) => v.id === id && v.status === "draft");
      if (row) row.status = "review";
      return { rows: [] };
    }

    // UPDATE ..._versions SET status = 'approved', approved_by_user_id = $2, approved_at = now() ...
    if (s.includes("SET status = 'approved'")) {
      const [id, approvedBy] = params as [string, string];
      const row = versions.find((v) => v.id === id && v.status === "review");
      if (row) {
        // DB-check: 4-øyne håndheves her som absolutt siste forsvarslinje.
        if (approvedBy === row.created_by_user_id) {
          throw new DomainError("CHECK_VIOLATION", "DB: 4-øyne");
        }
        row.status = "approved";
        row.approved_by_user_id = approvedBy;
        row.approved_at = new Date().toISOString();
      }
      return { rows: [] };
    }

    // UPDATE ..._versions SET status = 'retired', retired_at = now() ...
    if (s.includes("SET status = 'retired'")) {
      const [id] = params as [string];
      const row = versions.find((v) => v.id === id);
      if (row) {
        row.status = "retired";
        row.retired_at = new Date().toISOString();
      }
      return { rows: [] };
    }

    // UPDATE ..._versions SET status = 'live', published_by_user_id = $2, published_at = now() ...
    if (s.includes("SET status = 'live'")) {
      const [id, publishedBy] = params as [string, string];
      const row = versions.find((v) => v.id === id && v.status === "approved");
      if (row) {
        row.status = "live";
        row.published_by_user_id = publishedBy;
        row.published_at = new Date().toISOString();
      }
      return { rows: [] };
    }

    // INSERT INTO app_cms_content ... ON CONFLICT
    if (s.startsWith("INSERT INTO") && s.includes("app_cms_content") && s.includes("ON CONFLICT")) {
      const [slug, _updatedBy, liveId, liveVer] = params as [
        string,
        string,
        string,
        number,
      ];
      content.set(slug, { live_version_id: liveId, live_version_number: liveVer });
      return { rows: [] };
    }

    if (s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK") {
      return { rows: [] };
    }

    throw new Error(`FAKE_POOL: unhandled SQL: ${s}`);
  }

  const stubClient = {
    query: async (sql: string, params?: unknown[]) => handle(sql, params ?? []),
    release: () => undefined,
  };
  const stubPool = {
    query: async (sql: string, params?: unknown[]) => handle(sql, params ?? []),
    connect: async () => stubClient,
  };

  const svc = Object.create(CmsService.prototype) as CmsService;
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { initPromise: Promise<void> }).initPromise =
    Promise.resolve();
  return { svc, versions, content };
}

test("BIN-680 createVersion: happy-path oppretter draft v1", async () => {
  const { svc, versions } = makeVersionedService();
  const draft = await svc.createVersion({
    slug: "responsible-gaming",
    content: "<p>Første draft</p>",
    createdByUserId: "admin-A",
  });
  assert.equal(draft.slug, "responsible-gaming");
  assert.equal(draft.versionNumber, 1);
  assert.equal(draft.status, "draft");
  assert.equal(draft.createdByUserId, "admin-A");
  assert.equal(versions.length, 1);
});

test("BIN-680 createVersion: tildelt versions-nummer øker monotont", async () => {
  const { svc } = makeVersionedService();
  const v1 = await svc.createVersion({
    slug: "responsible-gaming",
    content: "v1",
    createdByUserId: "admin-A",
  });
  const v2 = await svc.createVersion({
    slug: "responsible-gaming",
    content: "v2",
    createdByUserId: "admin-B",
  });
  assert.equal(v1.versionNumber, 1);
  assert.equal(v2.versionNumber, 2);
});

test("BIN-680 createVersion avviser ikke-regulatorisk slug", async () => {
  const { svc } = makeVersionedService();
  await expectDomainError(
    "aboutus kan ikke versjoneres",
    () =>
      svc.createVersion({
        slug: "aboutus",
        content: "noe",
        createdByUserId: "admin-A",
      }),
    "CMS_SLUG_NOT_VERSIONED"
  );
});

test("BIN-680 createVersion krever createdByUserId", async () => {
  const { svc } = makeVersionedService();
  await expectDomainError(
    "mangler createdByUserId",
    () =>
      svc.createVersion({
        slug: "responsible-gaming",
        content: "hi",
        createdByUserId: "",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-680 submitForReview: draft → review", async () => {
  const { svc } = makeVersionedService();
  const draft = await svc.createVersion({
    slug: "responsible-gaming",
    content: "hi",
    createdByUserId: "admin-A",
  });
  const updated = await svc.submitForReview({
    versionId: draft.id,
    userId: "admin-A",
  });
  assert.equal(updated.status, "review");
});

test("BIN-680 submitForReview krever draft-status", async () => {
  const { svc } = makeVersionedService();
  const draft = await svc.createVersion({
    slug: "responsible-gaming",
    content: "hi",
    createdByUserId: "admin-A",
  });
  await svc.submitForReview({ versionId: draft.id, userId: "admin-A" });
  await expectDomainError(
    "allerede i review",
    () => svc.submitForReview({ versionId: draft.id, userId: "admin-A" }),
    "CMS_VERSION_INVALID_TRANSITION"
  );
});

test("BIN-680 approveVersion: 4-øyne — same user kastes FOUR_EYES_VIOLATION", async () => {
  const { svc } = makeVersionedService();
  const draft = await svc.createVersion({
    slug: "responsible-gaming",
    content: "hi",
    createdByUserId: "admin-A",
  });
  await svc.submitForReview({ versionId: draft.id, userId: "admin-A" });
  await expectDomainError(
    "same user approve",
    () =>
      svc.approveVersion({
        versionId: draft.id,
        approvedByUserId: "admin-A", // SAMME bruker som created!
      }),
    "FOUR_EYES_VIOLATION"
  );
});

test("BIN-680 approveVersion: 4-øyne — annen bruker OK", async () => {
  const { svc } = makeVersionedService();
  const draft = await svc.createVersion({
    slug: "responsible-gaming",
    content: "hi",
    createdByUserId: "admin-A",
  });
  await svc.submitForReview({ versionId: draft.id, userId: "admin-A" });
  const approved = await svc.approveVersion({
    versionId: draft.id,
    approvedByUserId: "admin-B",
  });
  assert.equal(approved.status, "approved");
  assert.equal(approved.approvedByUserId, "admin-B");
  assert.ok(approved.approvedAt, "approved_at settet");
});

test("BIN-680 approveVersion krever review-status (ikke draft direkte)", async () => {
  const { svc } = makeVersionedService();
  const draft = await svc.createVersion({
    slug: "responsible-gaming",
    content: "hi",
    createdByUserId: "admin-A",
  });
  await expectDomainError(
    "draft kan ikke approves direkte",
    () =>
      svc.approveVersion({
        versionId: draft.id,
        approvedByUserId: "admin-B",
      }),
    "CMS_VERSION_INVALID_TRANSITION"
  );
});

test("BIN-680 publishVersion: approved → live, ingen forrige live", async () => {
  const { svc } = makeVersionedService();
  const draft = await svc.createVersion({
    slug: "responsible-gaming",
    content: "v1",
    createdByUserId: "admin-A",
  });
  await svc.submitForReview({ versionId: draft.id, userId: "admin-A" });
  await svc.approveVersion({
    versionId: draft.id,
    approvedByUserId: "admin-B",
  });
  const result = await svc.publishVersion({
    versionId: draft.id,
    publishedByUserId: "admin-B",
  });
  assert.equal(result.live.status, "live");
  assert.equal(result.live.publishedByUserId, "admin-B");
  assert.equal(result.previousLiveVersionId, null);
});

test("BIN-680 publishVersion: retirer forrige live-versjon", async () => {
  const { svc } = makeVersionedService();

  // Publish v1.
  const v1 = await svc.createVersion({
    slug: "responsible-gaming",
    content: "v1",
    createdByUserId: "admin-A",
  });
  await svc.submitForReview({ versionId: v1.id, userId: "admin-A" });
  await svc.approveVersion({ versionId: v1.id, approvedByUserId: "admin-B" });
  await svc.publishVersion({ versionId: v1.id, publishedByUserId: "admin-B" });

  // Publish v2 → v1 skal bli retired.
  const v2 = await svc.createVersion({
    slug: "responsible-gaming",
    content: "v2",
    createdByUserId: "admin-A",
  });
  await svc.submitForReview({ versionId: v2.id, userId: "admin-A" });
  await svc.approveVersion({ versionId: v2.id, approvedByUserId: "admin-B" });
  const result = await svc.publishVersion({
    versionId: v2.id,
    publishedByUserId: "admin-B",
  });

  assert.equal(result.live.id, v2.id);
  assert.equal(result.previousLiveVersionId, v1.id);

  const history: CmsContentVersion[] = await svc.getVersionHistory("responsible-gaming");
  assert.equal(history.length, 2);
  const v1After = history.find((v) => v.id === v1.id);
  assert.equal(v1After?.status, "retired");
  assert.ok(v1After?.retiredAt, "retired_at settet");
});

test("BIN-680 publishVersion krever approved-status", async () => {
  const { svc } = makeVersionedService();
  const draft = await svc.createVersion({
    slug: "responsible-gaming",
    content: "hi",
    createdByUserId: "admin-A",
  });
  await expectDomainError(
    "draft kan ikke publiseres",
    () =>
      svc.publishVersion({
        versionId: draft.id,
        publishedByUserId: "admin-B",
      }),
    "CMS_VERSION_INVALID_TRANSITION"
  );
});

test("BIN-680 getLiveVersion returnerer null når ingen live", async () => {
  const { svc } = makeVersionedService();
  const result = await svc.getLiveVersion("responsible-gaming");
  assert.equal(result, null);
});

test("BIN-680 getLiveVersion returnerer riktig versjon etter publish", async () => {
  const { svc } = makeVersionedService();
  const v1 = await svc.createVersion({
    slug: "responsible-gaming",
    content: "tekst-v1",
    createdByUserId: "admin-A",
  });
  await svc.submitForReview({ versionId: v1.id, userId: "admin-A" });
  await svc.approveVersion({ versionId: v1.id, approvedByUserId: "admin-B" });
  await svc.publishVersion({ versionId: v1.id, publishedByUserId: "admin-B" });

  const live = await svc.getLiveVersion("responsible-gaming");
  assert.ok(live);
  assert.equal(live?.id, v1.id);
  assert.equal(live?.content, "tekst-v1");
});

test("BIN-680 getVersionHistory returnerer alle versjoner nyeste→eldste", async () => {
  const { svc } = makeVersionedService();
  await svc.createVersion({
    slug: "responsible-gaming",
    content: "v1",
    createdByUserId: "admin-A",
  });
  await svc.createVersion({
    slug: "responsible-gaming",
    content: "v2",
    createdByUserId: "admin-A",
  });
  await svc.createVersion({
    slug: "responsible-gaming",
    content: "v3",
    createdByUserId: "admin-A",
  });
  const history = await svc.getVersionHistory("responsible-gaming");
  assert.equal(history.length, 3);
  assert.equal(history[0]?.versionNumber, 3);
  assert.equal(history[1]?.versionNumber, 2);
  assert.equal(history[2]?.versionNumber, 1);
});

test("BIN-680 updateContent(responsible-gaming): oppretter draft i stedet for upsert", async () => {
  const { svc, versions } = makeVersionedService();
  const result = await svc.updateContent(
    "responsible-gaming",
    "<p>draft via updateContent</p>",
    "admin-A"
  );
  // updateContent returnerer CmsContent-shape, men bak skjermen skal vi ha en draft.
  assert.equal(result.slug, "responsible-gaming");
  assert.equal(result.content, "<p>draft via updateContent</p>");
  assert.equal(versions.length, 1);
  assert.equal(versions[0]?.status, "draft");
  assert.equal(versions[0]?.created_by_user_id, "admin-A");
});

test("BIN-680 getContent(responsible-gaming): tom streng når ingen live", async () => {
  const { svc } = makeVersionedService();
  // Opprett en draft men ikke publiser.
  await svc.createVersion({
    slug: "responsible-gaming",
    content: "usendt draft",
    createdByUserId: "admin-A",
  });
  const result = await svc.getContent("responsible-gaming");
  assert.equal(result.content, "", "getContent skal ignorere ikke-live drafts");
});

test("BIN-680 getContent(responsible-gaming): returnerer live-versjonens innhold etter publish", async () => {
  const { svc } = makeVersionedService();
  const v1 = await svc.createVersion({
    slug: "responsible-gaming",
    content: "publisert tekst",
    createdByUserId: "admin-A",
  });
  await svc.submitForReview({ versionId: v1.id, userId: "admin-A" });
  await svc.approveVersion({ versionId: v1.id, approvedByUserId: "admin-B" });
  await svc.publishVersion({ versionId: v1.id, publishedByUserId: "admin-B" });

  const result = await svc.getContent("responsible-gaming");
  assert.equal(result.content, "publisert tekst");
});

test("BIN-680 CmsService.requiresVersionHistory helper", () => {
  assert.equal(CmsService.requiresVersionHistory("responsible-gaming"), true);
  assert.equal(CmsService.requiresVersionHistory("aboutus"), false);
  assert.equal(CmsService.requiresVersionHistory("terms"), false);
});
