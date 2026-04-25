/**
 * Public (un-authenticated) CMS read-endpoints.
 *
 * Regulatorisk grunnlag (pengespillforskriften):
 *   Spillere skal kunne lese vilkår, FAQ og ansvarlig-spill-info FØR de
 *   oppretter en konto / logger inn. Eksisterende `/api/admin/cms/*` er
 *   admin-gated (CMS_READ-permission), så et nytt offentlig grensesnitt er
 *   nødvendig.
 *
 * Endepunkter:
 *   GET /api/cms/terms-of-service     → samme som GET /api/cms/terms
 *   GET /api/cms/responsible-gaming   → live-versjon for regulatorisk slug
 *   GET /api/cms/faq                  → liste av publiserte FAQ-oppføringer
 *   GET /api/cms/:slug                → generisk slug-basert henting
 *
 * Sikkerhetsmodell:
 *   - INGEN auth-header kreves (offentlig regulatorisk informasjon).
 *   - Whitelist av slugs (samme som CMS_SLUGS i CmsService) — ukjente slugs
 *     får 404.
 *   - "Publisert"-semantikk:
 *       - Regulatoriske slugs (`responsible-gaming`): live-versjon må finnes.
 *         Ingen live → 404 (vi viser ikke draft/review/approved utad).
 *       - Ikke-regulatoriske slugs (`terms`, `support`, `aboutus`, `links`):
 *         Innhold må være ikke-tom streng. Tom streng = ikke publisert → 404.
 *       - FAQ er en separat tabell — alltid synlig (admin-CRUD avgjør hva
 *         som ligger der).
 *
 * Cache:
 *   - `Cache-Control: public, max-age=300` (5 min) på alle suksess-svar.
 *     Etter publisering tar det opptil 5 min før klient ser endringen — det
 *     er innenfor regulatorisk akseptanse for ikke-tids-kritiske tekster.
 *   - Feil-svar (404) cache-es ikke (`Cache-Control: no-store`) slik at en
 *     publisering umiddelbart "låser opp" innholdet.
 *
 * Slug-aliaser:
 *   - `terms-of-service` → `terms` (player-app bruker den fulle formen i
 *     URL-er; admin-side bruker den kortere lagrings-slug-en).
 */

import express from "express";
import { DomainError } from "../game/BingoEngine.js";
import {
  CMS_SLUGS,
  CmsService,
  type CmsContent,
  type CmsSlug,
  type FaqEntry,
} from "../admin/CmsService.js";
import { apiSuccess, apiFailure } from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "public-cms" });

/**
 * Player-app-vennlige aliaser for slugs som har ulik form i URL og DB.
 * Holdes eksplisitt slik at det er trivielt å legge til nye aliaser uten
 * å trenge en migrering.
 */
const SLUG_ALIASES: Record<string, CmsSlug> = {
  "terms-of-service": "terms",
  "tos": "terms",
  "responsible-gaming": "responsible-gaming",
  "support": "support",
  "aboutus": "aboutus",
  "links": "links",
  "terms": "terms",
};

const PUBLIC_CACHE_HEADER = "public, max-age=300";

export interface PublicCmsRouterDeps {
  cmsService: CmsService;
}

interface PublicCmsContentResponse {
  slug: CmsSlug;
  content: string;
  publishedAt: string;
}

interface PublicCmsFaqResponse {
  question: string;
  answer: string;
  sortOrder: number;
}

function resolveAliasedSlug(raw: string): CmsSlug | null {
  const trimmed = (raw || "").trim().toLowerCase();
  if (!trimmed) return null;
  // Direct match in canonical CMS_SLUGS first (case-sensitive set).
  if ((CMS_SLUGS as readonly string[]).includes(trimmed)) {
    return trimmed as CmsSlug;
  }
  // Then alias map (slug-form variants).
  const aliased = SLUG_ALIASES[trimmed];
  return aliased ?? null;
}

/**
 * Returnerer publisert innhold (eller null hvis ikke publisert / tom).
 *
 * Regulatorisk slug krever live-versjon (CmsService.getContent håndterer
 * dette internt — returnerer tom streng hvis ingen live). Tom streng for
 * begge typer = "ikke publisert" → null.
 */
function asPublishedOrNull(content: CmsContent): PublicCmsContentResponse | null {
  if (!content.content || !content.content.trim()) {
    return null;
  }
  return {
    slug: content.slug,
    content: content.content,
    publishedAt: content.updatedAt,
  };
}

function asPublicFaq(faq: FaqEntry): PublicCmsFaqResponse {
  return {
    question: faq.question,
    answer: faq.answer,
    sortOrder: faq.sortOrder,
  };
}

export function createPublicCmsRouter(
  deps: PublicCmsRouterDeps
): express.Router {
  const { cmsService } = deps;
  const router = express.Router();

  // ── FAQ list ─────────────────────────────────────────────────────────────
  // Registreres FØR /:slug for å unngå Express-param-kollisjon (hvor "faq"
  // ellers ville matchet som slug-parameter).
  router.get("/api/cms/faq", async (_req, res) => {
    try {
      const faqs = await cmsService.listFaq();
      res.setHeader("Cache-Control", PUBLIC_CACHE_HEADER);
      apiSuccess(res, {
        faqs: faqs.map(asPublicFaq),
        count: faqs.length,
      });
    } catch (error) {
      apiFailure(res, error);
    }
  });

  // ── Generic published-content lookup ─────────────────────────────────────
  router.get("/api/cms/:slug", async (req, res) => {
    try {
      const rawSlug = (req.params.slug ?? "").toString();
      const resolved = resolveAliasedSlug(rawSlug);
      if (!resolved) {
        // Ukjent slug → 404 + no-store (ingen cache som kan låse den).
        res.setHeader("Cache-Control", "no-store");
        throw new DomainError(
          "CMS_SLUG_NOT_FOUND",
          `Innholdet du ba om ('${rawSlug}') finnes ikke.`
        );
      }
      const content = await cmsService.getContent(resolved);
      const published = asPublishedOrNull(content);
      if (!published) {
        // Slug er gyldig men ikke publisert (tom streng / ingen live-versjon).
        res.setHeader("Cache-Control", "no-store");
        throw new DomainError(
          "CMS_NOT_PUBLISHED",
          `Innholdet for '${resolved}' er ikke publisert ennå.`
        );
      }
      res.setHeader("Cache-Control", PUBLIC_CACHE_HEADER);
      apiSuccess(res, published);
    } catch (error) {
      // 404 mapping: våre koder må gi 404 i stedet for 500.
      if (error instanceof DomainError && isNotFoundCode(error.code)) {
        apiFailureWithStatus(res, error, 404);
      } else {
        apiFailure(res, error);
      }
      logger.debug(
        { err: error, slug: req.params.slug },
        "[public-cms] slug-lookup ferdig"
      );
    }
  });

  return router;
}

/**
 * DomainError-koder som skal mappes til HTTP 404 i public-routeren.
 * Holder listen lokal slik at admin-routeren ikke arver semantikk-en.
 */
function isNotFoundCode(code: string): boolean {
  return (
    code === "CMS_SLUG_NOT_FOUND" ||
    code === "CMS_NOT_PUBLISHED" ||
    code === "CMS_SLUG_UNKNOWN"
  );
}

/**
 * Variant av apiFailure som tvinger eksplisitt status-kode. Brukes for å
 * gi 404 i stedet for default-400 for slug-not-found-koder.
 */
function apiFailureWithStatus(
  res: express.Response,
  error: unknown,
  status: number
): void {
  const code =
    error instanceof DomainError
      ? error.code
      : "UNKNOWN_ERROR";
  const message =
    error instanceof Error ? error.message : "Ukjent feil";
  res.status(status).json({ ok: false, error: { code, message } });
}
