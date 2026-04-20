/**
 * BIN-676: integrasjonstester for admin-cms-router.
 *
 * Dekker alle seks endepunkter:
 *   GET  /api/admin/cms/faq
 *   POST /api/admin/cms/faq
 *   PATCH /api/admin/cms/faq/:id
 *   DELETE /api/admin/cms/faq/:id
 *   GET /api/admin/cms/:slug
 *   PUT /api/admin/cms/:slug       (+ FEATURE_DISABLED-gate for responsible-gaming)
 *
 * Testene bygger en stub-CmsService rundt in-memory Maps — samme mønster
 * som adminSettings.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminCmsRouter } from "../adminCms.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import {
  CMS_SLUGS,
  CMS_VERSION_HISTORY_REQUIRED,
  type CmsService,
  type CmsContent,
  type CmsSlug,
  type CreateFaqInput,
  type FaqEntry,
  type UpdateFaqInput,
} from "../../admin/CmsService.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";
import { randomUUID } from "node:crypto";

const adminUser: PublicAppUser = {
  id: "admin-1",
  email: "a@test.no",
  displayName: "Admin",
  walletId: "w-a",
  role: "ADMIN",
  hallId: null,
  kycStatus: "VERIFIED",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  balance: 0,
};
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const operatorUser: PublicAppUser = {
  ...adminUser,
  id: "op-1",
  role: "HALL_OPERATOR",
  hallId: "hall-a",
};
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
  };
  content: Map<CmsSlug, string>;
  faqs: Map<string, FaqEntry>;
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  seed: { content?: Partial<Record<CmsSlug, string>>; faqs?: FaqEntry[] } = {}
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const content = new Map<CmsSlug, string>(
    Object.entries(seed.content ?? {}) as [CmsSlug, string][]
  );
  const faqs = new Map<string, FaqEntry>(
    (seed.faqs ?? []).map((f) => [f.id, f])
  );

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  function buildContent(slug: CmsSlug): CmsContent {
    const nowIso = "2026-04-20T12:00:00Z";
    return {
      slug,
      content: content.get(slug) ?? "",
      updatedByUserId: content.has(slug) ? "admin-1" : null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  function assertValidSlug(raw: string): CmsSlug {
    if (!raw) throw new DomainError("INVALID_INPUT", "slug er påkrevd.");
    if (!(CMS_SLUGS as readonly string[]).includes(raw)) {
      throw new DomainError("CMS_SLUG_UNKNOWN", `ukjent slug: ${raw}`);
    }
    return raw as CmsSlug;
  }

  const cmsService = {
    async getContent(slug: string): Promise<CmsContent> {
      return buildContent(assertValidSlug(slug));
    },
    async updateContent(
      slug: string,
      contentValue: unknown,
      _actorUserId: string | null
    ): Promise<CmsContent> {
      const validSlug = assertValidSlug(slug);
      if (CMS_VERSION_HISTORY_REQUIRED.includes(validSlug)) {
        throw new DomainError(
          "FEATURE_DISABLED",
          `Blokkert av BIN-680: ${validSlug} krever versjons-historikk.`
        );
      }
      if (typeof contentValue !== "string") {
        throw new DomainError("INVALID_INPUT", "content må være en streng.");
      }
      content.set(validSlug, contentValue);
      return buildContent(validSlug);
    },
    async listFaq(): Promise<FaqEntry[]> {
      return [...faqs.values()].sort((a, b) =>
        a.sortOrder === b.sortOrder
          ? a.createdAt.localeCompare(b.createdAt)
          : a.sortOrder - b.sortOrder
      );
    },
    async getFaq(id: string): Promise<FaqEntry> {
      if (!id?.trim()) throw new DomainError("INVALID_INPUT", "id");
      const faq = faqs.get(id.trim());
      if (!faq) throw new DomainError("FAQ_NOT_FOUND", "not found");
      return faq;
    },
    async createFaq(input: CreateFaqInput): Promise<FaqEntry> {
      if (!input.question?.trim()) {
        throw new DomainError("INVALID_INPUT", "question");
      }
      if (!input.answer?.trim()) {
        throw new DomainError("INVALID_INPUT", "answer");
      }
      const id = randomUUID();
      const nowIso = "2026-04-20T12:00:00Z";
      const faq: FaqEntry = {
        id,
        question: input.question.trim(),
        answer: input.answer.trim(),
        sortOrder: input.sortOrder ?? 0,
        createdByUserId: input.createdBy,
        updatedByUserId: input.createdBy,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      faqs.set(id, faq);
      return faq;
    },
    async updateFaq(
      id: string,
      update: UpdateFaqInput,
      actorUserId: string | null
    ): Promise<FaqEntry> {
      const existing = faqs.get(id);
      if (!existing) throw new DomainError("FAQ_NOT_FOUND", "not found");
      if (Object.keys(update).length === 0) {
        throw new DomainError("INVALID_INPUT", "empty");
      }
      const next: FaqEntry = {
        ...existing,
        ...(update.question !== undefined ? { question: update.question } : {}),
        ...(update.answer !== undefined ? { answer: update.answer } : {}),
        ...(update.sortOrder !== undefined
          ? { sortOrder: update.sortOrder }
          : {}),
        updatedByUserId: actorUserId,
        updatedAt: "2026-04-20T13:00:00Z",
      };
      faqs.set(id, next);
      return next;
    },
    async deleteFaq(id: string): Promise<void> {
      if (!faqs.has(id)) throw new DomainError("FAQ_NOT_FOUND", "not found");
      faqs.delete(id);
    },
  } as unknown as CmsService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminCmsRouter({
      platformService,
      auditLogService,
      cmsService,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve())
  );
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore },
    content,
    faqs,
    close: () =>
      new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function waitForAudit(
  store: InMemoryAuditLogStore,
  action: string
): Promise<PersistedAuditEvent | null> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const events = await store.list();
    const hit = events.find((e) => e.action === action);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 10));
  }
  return null;
}

// ── RBAC ─────────────────────────────────────────────────────────────────────

test("BIN-676 cms route: PLAYER blokkert fra alle endepunkter", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const get = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/cms/aboutus",
      "pl-tok"
    );
    assert.equal(get.status, 400);
    assert.equal(get.json.error.code, "FORBIDDEN");

    const put = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/cms/aboutus",
      "pl-tok",
      { content: "<p>hi</p>" }
    );
    assert.equal(put.status, 400);
    assert.equal(put.json.error.code, "FORBIDDEN");

    const faqList = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/cms/faq",
      "pl-tok"
    );
    assert.equal(faqList.status, 400);
    assert.equal(faqList.json.error.code, "FORBIDDEN");

    const faqCreate = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/cms/faq",
      "pl-tok",
      { question: "q", answer: "a" }
    );
    assert.equal(faqCreate.status, 400);
    assert.equal(faqCreate.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-676 cms route: SUPPORT kan READ men ikke WRITE", async () => {
  const ctx = await startServer({ "sup-tok": supportUser });
  try {
    const get = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/cms/aboutus",
      "sup-tok"
    );
    assert.equal(get.status, 200);

    const put = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/cms/aboutus",
      "sup-tok",
      { content: "<p>hi</p>" }
    );
    assert.equal(put.status, 400);
    assert.equal(put.json.error.code, "FORBIDDEN");

    const faqList = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/cms/faq",
      "sup-tok"
    );
    assert.equal(faqList.status, 200);

    const faqCreate = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/cms/faq",
      "sup-tok",
      { question: "q?", answer: "a" }
    );
    assert.equal(faqCreate.status, 400);
    assert.equal(faqCreate.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-676 cms route: HALL_OPERATOR kan READ men ikke WRITE (ADMIN-only)", async () => {
  const ctx = await startServer({ "op-tok": operatorUser });
  try {
    const get = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/cms/terms",
      "op-tok"
    );
    assert.equal(get.status, 200);

    const put = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/cms/terms",
      "op-tok",
      { content: "<p>hi</p>" }
    );
    assert.equal(put.status, 400);
    assert.equal(put.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-676 cms route: uten token gir UNAUTHORIZED", async () => {
  const ctx = await startServer({});
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/admin/cms/aboutus");
    assert.equal(res.status, 400);
    assert.ok(res.json?.error);
  } finally {
    await ctx.close();
  }
});

// ── GET content ─────────────────────────────────────────────────────────────

test("BIN-676 cms route: GET /:slug returnerer tom default for uskrevet slug", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/cms/aboutus",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.slug, "aboutus");
    assert.equal(res.json.data.content, "");
    assert.equal(res.json.data.updatedByUserId, null);
  } finally {
    await ctx.close();
  }
});

test("BIN-676 cms route: GET /:slug returnerer lagret innhold", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    { content: { terms: "<p>Vilkår</p>" } }
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/cms/terms",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.slug, "terms");
    assert.equal(res.json.data.content, "<p>Vilkår</p>");
    assert.equal(res.json.data.updatedByUserId, "admin-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-676 cms route: GET /:slug med ukjent slug gir CMS_SLUG_UNKNOWN", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/cms/not-a-slug",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "CMS_SLUG_UNKNOWN");
  } finally {
    await ctx.close();
  }
});

test("BIN-676 cms route: GET /responsible-gaming fungerer normalt (kun PUT er gated)", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    { content: { "responsible-gaming": "<p>Spill ansvarlig</p>" } }
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/cms/responsible-gaming",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.slug, "responsible-gaming");
    assert.equal(res.json.data.content, "<p>Spill ansvarlig</p>");
  } finally {
    await ctx.close();
  }
});

// ── PUT content ─────────────────────────────────────────────────────────────

test("BIN-676 cms route: PUT /aboutus lagrer innhold og skriver audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/cms/aboutus",
      "admin-tok",
      { content: "<p>Om oss</p>" }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.slug, "aboutus");
    assert.equal(res.json.data.content, "<p>Om oss</p>");
    assert.equal(ctx.content.get("aboutus"), "<p>Om oss</p>");

    const audit = await waitForAudit(ctx.spies.auditStore, "admin.cms.update");
    assert.ok(audit, "audit event skrevet");
    assert.equal(audit?.resource, "cms_content");
    assert.equal(audit?.resourceId, "aboutus");
  } finally {
    await ctx.close();
  }
});

test("BIN-676 cms route: PUT /responsible-gaming returnerer FEATURE_DISABLED (BIN-680)", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/cms/responsible-gaming",
      "admin-tok",
      { content: "<p>Ansvarlig spill</p>" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FEATURE_DISABLED");
    assert.match(
      res.json.error.message,
      /BIN-680/,
      "feilmelding refererer BIN-680"
    );
    // Ingen audit-event skal ha blitt skrevet.
    const events = await ctx.spies.auditStore.list();
    assert.equal(
      events.filter((e) => e.action === "admin.cms.update").length,
      0
    );
  } finally {
    await ctx.close();
  }
});

test("BIN-676 cms route: PUT /:slug avviser payload uten content", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/cms/support",
      "admin-tok",
      {}
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-676 cms route: PUT /:slug avviser ukjent slug", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PUT",
      "/api/admin/cms/not-a-slug",
      "admin-tok",
      { content: "hi" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "CMS_SLUG_UNKNOWN");
  } finally {
    await ctx.close();
  }
});

// ── FAQ: list ───────────────────────────────────────────────────────────────

test("BIN-676 cms route: GET /faq returnerer tom liste initielt", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/cms/faq",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.data.faqs, []);
    assert.equal(res.json.data.count, 0);
  } finally {
    await ctx.close();
  }
});

test("BIN-676 cms route: GET /faq returnerer liste sortert etter sort_order", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    {
      faqs: [
        {
          id: "faq-2",
          question: "Q2?",
          answer: "A2",
          sortOrder: 20,
          createdByUserId: "admin-1",
          updatedByUserId: "admin-1",
          createdAt: "2026-04-01T00:00:00Z",
          updatedAt: "2026-04-01T00:00:00Z",
        },
        {
          id: "faq-1",
          question: "Q1?",
          answer: "A1",
          sortOrder: 10,
          createdByUserId: "admin-1",
          updatedByUserId: "admin-1",
          createdAt: "2026-04-02T00:00:00Z",
          updatedAt: "2026-04-02T00:00:00Z",
        },
      ],
    }
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/cms/faq",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.faqs[0].id, "faq-1");
    assert.equal(res.json.data.faqs[1].id, "faq-2");
    assert.equal(res.json.data.count, 2);
  } finally {
    await ctx.close();
  }
});

// ── FAQ: create ─────────────────────────────────────────────────────────────

test("BIN-676 cms route: POST /faq oppretter FAQ og skriver audit", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/cms/faq",
      "admin-tok",
      { question: "Hva er bingo?", answer: "Et spill.", sortOrder: 5 }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.question, "Hva er bingo?");
    assert.equal(res.json.data.answer, "Et spill.");
    assert.equal(res.json.data.sortOrder, 5);
    assert.equal(res.json.data.createdByUserId, "admin-1");
    assert.equal(ctx.faqs.size, 1);

    const audit = await waitForAudit(
      ctx.spies.auditStore,
      "admin.cms.faq.create"
    );
    assert.ok(audit, "audit event skrevet");
    assert.equal(audit?.resource, "cms_faq");
  } finally {
    await ctx.close();
  }
});

test("BIN-676 cms route: POST /faq avviser tom question", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/admin/cms/faq",
      "admin-tok",
      { question: "", answer: "a" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── FAQ: update ─────────────────────────────────────────────────────────────

test("BIN-676 cms route: PATCH /faq/:id oppdaterer og skriver audit", async () => {
  const seedFaq: FaqEntry = {
    id: "faq-1",
    question: "Q?",
    answer: "A",
    sortOrder: 0,
    createdByUserId: "admin-1",
    updatedByUserId: "admin-1",
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
  };
  const ctx = await startServer(
    { "admin-tok": adminUser },
    { faqs: [seedFaq] }
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/cms/faq/faq-1",
      "admin-tok",
      { answer: "A-ny", sortOrder: 15 }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.answer, "A-ny");
    assert.equal(res.json.data.sortOrder, 15);

    const audit = await waitForAudit(
      ctx.spies.auditStore,
      "admin.cms.faq.update"
    );
    assert.ok(audit, "audit event skrevet");
    assert.equal(audit?.resourceId, "faq-1");
  } finally {
    await ctx.close();
  }
});

test("BIN-676 cms route: PATCH /faq/:id med ukjent id gir FAQ_NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "PATCH",
      "/api/admin/cms/faq/missing",
      "admin-tok",
      { question: "nytt?" }
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FAQ_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── FAQ: delete ─────────────────────────────────────────────────────────────

test("BIN-676 cms route: DELETE /faq/:id sletter og skriver audit", async () => {
  const seedFaq: FaqEntry = {
    id: "faq-del",
    question: "Slett?",
    answer: "Ja.",
    sortOrder: 0,
    createdByUserId: "admin-1",
    updatedByUserId: "admin-1",
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
  };
  const ctx = await startServer(
    { "admin-tok": adminUser },
    { faqs: [seedFaq] }
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/cms/faq/faq-del",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.deleted, true);
    assert.equal(res.json.data.id, "faq-del");
    assert.equal(ctx.faqs.has("faq-del"), false);

    const audit = await waitForAudit(
      ctx.spies.auditStore,
      "admin.cms.faq.delete"
    );
    assert.ok(audit, "audit event skrevet");
  } finally {
    await ctx.close();
  }
});

test("BIN-676 cms route: DELETE /faq/:id med ukjent id gir FAQ_NOT_FOUND", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "DELETE",
      "/api/admin/cms/faq/missing",
      "admin-tok"
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FAQ_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── Route-ordering ──────────────────────────────────────────────────────────

test("BIN-676 cms route: 'faq' som slug går til faq-handler, ikke content-handler", async () => {
  // Regresjonstest — hvis /api/admin/cms/faq blir tolket som slug="faq" vil
  // vi få CMS_SLUG_UNKNOWN-feil i stedet for en tom FAQ-liste.
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/admin/cms/faq",
      "admin-tok"
    );
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.data.faqs), "faqs-liste returnert");
  } finally {
    await ctx.close();
  }
});
