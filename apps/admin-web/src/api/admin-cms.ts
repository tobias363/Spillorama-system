// BIN-676 — admin-cms API-wrappers.
//
// Thin wrappers around `apps/backend/src/routes/adminCms.ts`:
//   GET    /api/admin/cms/faq          → liste
//   POST   /api/admin/cms/faq          → opprett
//   PATCH  /api/admin/cms/faq/:id      → oppdater
//   DELETE /api/admin/cms/faq/:id      → slett
//   GET    /api/admin/cms/:slug        → hent tekst-side
//   PUT    /api/admin/cms/:slug        → oppdater tekst-side
//
// Regulatorisk-gate (BIN-680):
//   PUT /api/admin/cms/responsible-gaming returnerer HTTP 400 +
//   error.code='FEATURE_DISABLED' inntil versjons-historikk-tabellen +
//   diff-logging er på plass. UI renderer responsible-gaming read-only.
//
// Domeneoppdeling:
//   1. CMS text: aboutus, terms, support, links, responsible-gaming.
//      Frontend bruker legacy-aliaser (about_us, terms_of_service, ...) for
//      i18n-paritet; wrapperne mapper til backend-slugs.
//   2. FAQ: question/answer CRUD + sort_order for drag-to-reorder.

import { apiRequest } from "./client.js";

// ── CMS-tekst ─────────────────────────────────────────────────────────────

/** Frontend-kanoniske nøkler. Matcher legacy routes-navn (1:1 paritet for i18n-labels). */
export type CmsTextKey =
  | "terms_of_service"
  | "support"
  | "about_us"
  | "responsible_gaming"
  | "links_of_other_agencies";

/** Backend-slug (whitelist i CmsService.CMS_SLUGS). */
export type CmsBackendSlug =
  | "aboutus"
  | "terms"
  | "support"
  | "links"
  | "responsible-gaming";

/** Slugs som er regulatorisk-låst for PUT (BIN-680). GET er alltid tillatt. */
export const CMS_REGULATORY_LOCKED_SLUGS: readonly CmsBackendSlug[] = [
  "responsible-gaming",
] as const;

const TEXT_KEY_TO_SLUG: Record<CmsTextKey, CmsBackendSlug> = {
  terms_of_service: "terms",
  support: "support",
  about_us: "aboutus",
  responsible_gaming: "responsible-gaming",
  links_of_other_agencies: "links",
};

export function textKeyToSlug(key: CmsTextKey): CmsBackendSlug {
  return TEXT_KEY_TO_SLUG[key];
}

export function isRegulatoryLocked(key: CmsTextKey): boolean {
  return CMS_REGULATORY_LOCKED_SLUGS.includes(textKeyToSlug(key));
}

export interface CmsTextRecord {
  /** Frontend-kanonisk nøkkel (for UI-bruk). */
  key: CmsTextKey;
  /** Backend-slug som ble brukt i kallet. */
  slug: CmsBackendSlug;
  /** Tekst-innhold (maks 200 000 tegn på backend). */
  body: string;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BackendCmsContent {
  slug: CmsBackendSlug;
  content: string;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

const SLUG_TO_TEXT_KEY: Record<CmsBackendSlug, CmsTextKey> = {
  aboutus: "about_us",
  terms: "terms_of_service",
  support: "support",
  links: "links_of_other_agencies",
  "responsible-gaming": "responsible_gaming",
};

function mapContent(row: BackendCmsContent, key: CmsTextKey): CmsTextRecord {
  return {
    key,
    slug: row.slug,
    body: row.content,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getCmsText(key: CmsTextKey): Promise<CmsTextRecord> {
  const slug = textKeyToSlug(key);
  const row = await apiRequest<BackendCmsContent>(
    `/api/admin/cms/${encodeURIComponent(slug)}`,
    { auth: true }
  );
  return mapContent(row, SLUG_TO_TEXT_KEY[row.slug] ?? key);
}

/**
 * Lagre tekst-side. Kaster ApiError med code='FEATURE_DISABLED' for
 * responsible-gaming (BIN-680-gate). UI må alltid sjekke `isRegulatoryLocked`
 * før denne kalles, men defensiv catch kreves uansett.
 */
export async function setCmsText(
  key: CmsTextKey,
  body: string
): Promise<CmsTextRecord> {
  const slug = textKeyToSlug(key);
  const row = await apiRequest<BackendCmsContent>(
    `/api/admin/cms/${encodeURIComponent(slug)}`,
    { method: "PUT", body: { content: body }, auth: true }
  );
  return mapContent(row, SLUG_TO_TEXT_KEY[row.slug] ?? key);
}

// ── FAQ ───────────────────────────────────────────────────────────────────

/** UI-type som matcher legacy admin-skjerm. */
export interface FaqRecord {
  id: string;
  /** UI-only seq-visning basert på sort_order. */
  queId: number;
  question: string;
  answer: string;
  sortOrder: number;
  updatedAt: string;
}

interface BackendFaqEntry {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FaqListEnvelope {
  faqs: BackendFaqEntry[];
  count: number;
}

function mapFaq(entry: BackendFaqEntry, index: number): FaqRecord {
  return {
    id: entry.id,
    queId: index + 1,
    question: entry.question,
    answer: entry.answer,
    sortOrder: entry.sortOrder,
    updatedAt: entry.updatedAt,
  };
}

export async function listFaq(): Promise<FaqRecord[]> {
  const env = await apiRequest<FaqListEnvelope>("/api/admin/cms/faq", {
    auth: true,
  });
  return env.faqs.map((e, i) => mapFaq(e, i));
}

export async function getFaq(id: string): Promise<FaqRecord | null> {
  // Backend har ingen single-FAQ-endpoint; hent liste og filtrer.
  const list = await listFaq();
  return list.find((f) => f.id === id) ?? null;
}

export async function createFaq(input: {
  question: string;
  answer: string;
  sortOrder?: number;
}): Promise<FaqRecord> {
  const body: { question: string; answer: string; sortOrder?: number } = {
    question: input.question,
    answer: input.answer,
  };
  if (input.sortOrder !== undefined) body.sortOrder = input.sortOrder;
  const entry = await apiRequest<BackendFaqEntry>("/api/admin/cms/faq", {
    method: "POST",
    body,
    auth: true,
  });
  return mapFaq(entry, entry.sortOrder);
}

export async function updateFaq(
  id: string,
  input: { question?: string; answer?: string; sortOrder?: number }
): Promise<FaqRecord> {
  const body: { question?: string; answer?: string; sortOrder?: number } = {};
  if (input.question !== undefined) body.question = input.question;
  if (input.answer !== undefined) body.answer = input.answer;
  if (input.sortOrder !== undefined) body.sortOrder = input.sortOrder;
  const entry = await apiRequest<BackendFaqEntry>(
    `/api/admin/cms/faq/${encodeURIComponent(id)}`,
    { method: "PATCH", body, auth: true }
  );
  return mapFaq(entry, entry.sortOrder);
}

export async function deleteFaq(id: string): Promise<boolean> {
  await apiRequest<{ deleted: boolean; id: string }>(
    `/api/admin/cms/faq/${encodeURIComponent(id)}`,
    { method: "DELETE", auth: true }
  );
  return true;
}
