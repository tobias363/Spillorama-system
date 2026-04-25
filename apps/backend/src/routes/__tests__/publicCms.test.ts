/**
 * Integrasjonstester for public CMS-router (un-authenticated).
 *
 * Dekker:
 *   - GET /api/cms/terms-of-service (alias → terms)
 *   - GET /api/cms/responsible-gaming (regulatorisk slug, live-versjon)
 *   - GET /api/cms/faq (FAQ-liste)
 *   - GET /api/cms/:slug (generisk)
 *   - 404 for ukjente slugs
 *   - 404 for slug uten publisert innhold (tom streng / ingen live-versjon)
 *   - Cache-Control-headers
 *   - Ingen auth-header kreves
 *
 * Bygger samme stub-CmsService-pattern som adminCms.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createPublicCmsRouter } from "../publicCms.js";
import {
  CMS_SLUGS,
  CMS_VERSION_HISTORY_REQUIRED,
  CmsService,
  type CmsContent,
  type CmsContentVersion,
  type CmsSlug,
  type FaqEntry,
} from "../../admin/CmsService.js";
import { DomainError } from "../../game/BingoEngine.js";
import { randomUUID } from "node:crypto";

interface Ctx {
  baseUrl: string;
  content: Map<CmsSlug, string>;
  faqs: Map<string, FaqEntry>;
  versions: Map<string, CmsContentVersion>;
  close: () => Promise<void>;
}

function buildLiveVersion(
  slug: CmsSlug,
  content: string,
  publishedAt: string = "2026-04-20T14:00:00Z"
): CmsContentVersion {
  return {
    id: randomUUID(),
    slug,
    versionNumber: 1,
    content,
    status: "live",
    createdByUserId: "admin-1",
    createdAt: "2026-04-20T12:00:00Z",
    approvedByUserId: "admin-2",
    approvedAt: "2026-04-20T13:00:00Z",
    publishedByUserId: "admin-2",
    publishedAt,
    retiredAt: null,
  };
}

async function startServer(seed: {
  content?: Partial<Record<CmsSlug, string>>;
  faqs?: FaqEntry[];
  versions?: CmsContentVersion[];
} = {}): Promise<Ctx> {
  const content = new Map<CmsSlug, string>(
    Object.entries(seed.content ?? {}) as [CmsSlug, string][]
  );
  const faqs = new Map<string, FaqEntry>(
    (seed.faqs ?? []).map((f) => [f.id, f])
  );
  const versions = new Map<string, CmsContentVersion>(
    (seed.versions ?? []).map((v) => [v.id, v])
  );

  function assertValidSlug(raw: string): CmsSlug {
    if (!raw) throw new DomainError("INVALID_INPUT", "slug er påkrevd.");
    if (!(CMS_SLUGS as readonly string[]).includes(raw)) {
      throw new DomainError("CMS_SLUG_UNKNOWN", `ukjent slug: ${raw}`);
    }
    return raw as CmsSlug;
  }

  const cmsService = {
    async getContent(slug: string): Promise<CmsContent> {
      const validSlug = assertValidSlug(slug);
      const nowIso = "2026-04-20T12:00:00Z";
      // Regulatorisk slug → live-versjon eller tom streng.
      if (CMS_VERSION_HISTORY_REQUIRED.includes(validSlug)) {
        const live = [...versions.values()].find(
          (v) => v.slug === validSlug && v.status === "live"
        );
        if (live) {
          return {
            slug: validSlug,
            content: live.content,
            updatedByUserId: live.publishedByUserId ?? live.createdByUserId,
            createdAt: live.createdAt,
            updatedAt: live.publishedAt ?? live.createdAt,
          };
        }
        return {
          slug: validSlug,
          content: "",
          updatedByUserId: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
      }
      // Ikke-regulatorisk: returner det som ligger i map (eller tom).
      return {
        slug: validSlug,
        content: content.get(validSlug) ?? "",
        updatedByUserId: content.has(validSlug) ? "admin-1" : null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    },
    async listFaq(): Promise<FaqEntry[]> {
      return [...faqs.values()].sort((a, b) =>
        a.sortOrder === b.sortOrder
          ? a.createdAt.localeCompare(b.createdAt)
          : a.sortOrder - b.sortOrder
      );
    },
  } as unknown as CmsService;

  const app = express();
  app.use(express.json());
  app.use(createPublicCmsRouter({ cmsService }));

  const server = app.listen(0);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve())
  );
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    content,
    faqs,
    versions,
    close: () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function getJson<T>(
  url: string,
  opts: { headers?: Record<string, string> } = {}
): Promise<{ status: number; body: ApiResponse<T>; headers: Headers }> {
  const res = await fetch(url, { headers: opts.headers ?? {} });
  const body = (await res.json()) as ApiResponse<T>;
  return { status: res.status, body, headers: res.headers };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("public-cms: GET /api/cms/terms-of-service (alias) returnerer publisert terms", async () => {
  const ctx = await startServer({
    content: { terms: "<h1>Vilkår</h1>" },
  });
  try {
    const { status, body, headers } = await getJson<{
      slug: string;
      content: string;
      publishedAt: string;
    }>(`${ctx.baseUrl}/api/cms/terms-of-service`);

    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data?.slug, "terms");
    assert.equal(body.data?.content, "<h1>Vilkår</h1>");
    assert.match(
      headers.get("cache-control") ?? "",
      /public.*max-age=300/
    );
  } finally {
    await ctx.close();
  }
});

test("public-cms: GET /api/cms/terms direkte fungerer også (canonical slug)", async () => {
  const ctx = await startServer({
    content: { terms: "Test-vilkår" },
  });
  try {
    const { status, body } = await getJson<{ content: string }>(
      `${ctx.baseUrl}/api/cms/terms`
    );
    assert.equal(status, 200);
    assert.equal(body.data?.content, "Test-vilkår");
  } finally {
    await ctx.close();
  }
});

test("public-cms: GET /api/cms/responsible-gaming returnerer kun live-versjon", async () => {
  const live = buildLiveVersion(
    "responsible-gaming",
    "Spill ansvarlig — sett tap-grenser.",
    "2026-04-20T14:00:00Z"
  );
  const ctx = await startServer({ versions: [live] });
  try {
    const { status, body } = await getJson<{
      slug: string;
      content: string;
      publishedAt: string;
    }>(`${ctx.baseUrl}/api/cms/responsible-gaming`);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data?.slug, "responsible-gaming");
    assert.equal(body.data?.content, "Spill ansvarlig — sett tap-grenser.");
    assert.equal(body.data?.publishedAt, "2026-04-20T14:00:00Z");
  } finally {
    await ctx.close();
  }
});

test("public-cms: GET /api/cms/responsible-gaming uten live-versjon → 404", async () => {
  // Bare en draft eksisterer — IKKE live.
  const draft: CmsContentVersion = {
    id: randomUUID(),
    slug: "responsible-gaming",
    versionNumber: 1,
    content: "Kun-draft (ikke publisert)",
    status: "draft",
    createdByUserId: "admin-1",
    createdAt: "2026-04-20T12:00:00Z",
    approvedByUserId: null,
    approvedAt: null,
    publishedByUserId: null,
    publishedAt: null,
    retiredAt: null,
  };
  const ctx = await startServer({ versions: [draft] });
  try {
    const { status, body, headers } = await getJson<unknown>(
      `${ctx.baseUrl}/api/cms/responsible-gaming`
    );
    assert.equal(status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, "CMS_NOT_PUBLISHED");
    // 404 skal IKKE caches — så en publisering blir umiddelbart synlig.
    assert.match(headers.get("cache-control") ?? "", /no-store/);
  } finally {
    await ctx.close();
  }
});

test("public-cms: GET /api/cms/faq returnerer publisert FAQ-liste", async () => {
  const faq1: FaqEntry = {
    id: randomUUID(),
    question: "Hvor gammel må jeg være?",
    answer: "18 år.",
    sortOrder: 0,
    createdByUserId: "admin-1",
    updatedByUserId: "admin-1",
    createdAt: "2026-04-20T12:00:00Z",
    updatedAt: "2026-04-20T12:00:00Z",
  };
  const faq2: FaqEntry = {
    id: randomUUID(),
    question: "Hvordan setter jeg inn penger?",
    answer: "Via Vipps.",
    sortOrder: 1,
    createdByUserId: "admin-1",
    updatedByUserId: "admin-1",
    createdAt: "2026-04-20T12:00:00Z",
    updatedAt: "2026-04-20T12:00:00Z",
  };
  const ctx = await startServer({ faqs: [faq2, faq1] });
  try {
    const { status, body, headers } = await getJson<{
      faqs: Array<{ question: string; answer: string; sortOrder: number }>;
      count: number;
    }>(`${ctx.baseUrl}/api/cms/faq`);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data?.count, 2);
    // Sortert på sortOrder ASC — faq1 (0) først.
    assert.equal(body.data?.faqs[0]?.question, "Hvor gammel må jeg være?");
    assert.equal(body.data?.faqs[1]?.question, "Hvordan setter jeg inn penger?");
    // FAQ-svar SKAL IKKE inkludere admin-felter som createdByUserId.
    const faqRecord = body.data?.faqs[0] as Record<string, unknown>;
    assert.equal(faqRecord["createdByUserId"], undefined);
    assert.equal(faqRecord["updatedByUserId"], undefined);
    assert.match(
      headers.get("cache-control") ?? "",
      /public.*max-age=300/
    );
  } finally {
    await ctx.close();
  }
});

test("public-cms: GET /api/cms/aboutus med publisert innhold", async () => {
  const ctx = await startServer({
    content: { aboutus: "Om Spillorama" },
  });
  try {
    const { status, body } = await getJson<{ content: string }>(
      `${ctx.baseUrl}/api/cms/aboutus`
    );
    assert.equal(status, 200);
    assert.equal(body.data?.content, "Om Spillorama");
  } finally {
    await ctx.close();
  }
});

test("public-cms: GET /api/cms/support uten publisert innhold → 404 CMS_NOT_PUBLISHED", async () => {
  const ctx = await startServer(); // ingen seed → tom innhold-map
  try {
    const { status, body } = await getJson<unknown>(
      `${ctx.baseUrl}/api/cms/support`
    );
    assert.equal(status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, "CMS_NOT_PUBLISHED");
  } finally {
    await ctx.close();
  }
});

test("public-cms: GET /api/cms/whitespace-content → 404 (whitespace = ikke publisert)", async () => {
  const ctx = await startServer({
    content: { aboutus: "   \n  \t  " },
  });
  try {
    const { status, body } = await getJson<unknown>(
      `${ctx.baseUrl}/api/cms/aboutus`
    );
    assert.equal(status, 404);
    assert.equal(body.error?.code, "CMS_NOT_PUBLISHED");
  } finally {
    await ctx.close();
  }
});

test("public-cms: GET /api/cms/unknown-slug → 404 CMS_SLUG_NOT_FOUND", async () => {
  const ctx = await startServer();
  try {
    const { status, body, headers } = await getJson<unknown>(
      `${ctx.baseUrl}/api/cms/this-slug-doesnt-exist`
    );
    assert.equal(status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, "CMS_SLUG_NOT_FOUND");
    assert.match(headers.get("cache-control") ?? "", /no-store/);
  } finally {
    await ctx.close();
  }
});

test("public-cms: ingen Authorization-header kreves (offentlig endepunkt)", async () => {
  const ctx = await startServer({
    content: { terms: "Public-content" },
  });
  try {
    const res = await fetch(`${ctx.baseUrl}/api/cms/terms`);
    assert.equal(res.status, 200);
    // Ekstra-eksplisitt: ingen Authorization-header.
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
  } finally {
    await ctx.close();
  }
});

test("public-cms: aliaser case-insensitive — /api/cms/TERMS-OF-SERVICE → terms", async () => {
  const ctx = await startServer({
    content: { terms: "Vilkår" },
  });
  try {
    const { status, body } = await getJson<{ slug: string }>(
      `${ctx.baseUrl}/api/cms/TERMS-OF-SERVICE`
    );
    assert.equal(status, 200);
    assert.equal(body.data?.slug, "terms");
  } finally {
    await ctx.close();
  }
});

test("public-cms: tom FAQ-tabell returnerer { faqs: [], count: 0 }", async () => {
  const ctx = await startServer();
  try {
    const { status, body } = await getJson<{
      faqs: unknown[];
      count: number;
    }>(`${ctx.baseUrl}/api/cms/faq`);
    assert.equal(status, 200);
    assert.equal(body.data?.count, 0);
    assert.deepEqual(body.data?.faqs, []);
  } finally {
    await ctx.close();
  }
});
