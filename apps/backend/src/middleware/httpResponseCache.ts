/**
 * Server-side Redis response-cache for stille (idempotente) read-endpoints.
 *
 * Speiler industry-standard pattern (Stripe idempotency-cache + GitHub
 * conditional GET): når klient poller `/api/games/status` hvert 30. sek og
 * cache er 30s, treffer kun ~1 request per 30s tier-en — resten serveres
 * fra Redis uten å konsumere rate-limit-budget.
 *
 * Designvalg:
 *  - Bare cache GET-requests (idempotente).
 *  - Bare cache `status === 200` responser (ikke 401/403/4xx/5xx).
 *  - Anonymous/shared cache er default; sett `perUser: true` for å
 *    inkludere brukerens auth-token-hash i nøkkelen.
 *  - Krever Authorization-header for å SERVERE cached data fra auth-
 *    guarded endpoints (defense-in-depth — hindrer at cache-en serverer
 *    200 til en bruker uten gyldig token). Endpoints uten auth-krav
 *    bør sette `allowAnonymous: true`.
 *  - Fail-soft: hvis Redis er nede eller kaster, bypass cache og kjør
 *    handler normalt — vi tar HELLER en ekstra DB-hit enn et 5xx.
 *
 * Sikkerhet: VI MÅ ALDRI cache user-specific data med shared key. Bruk
 * `perUser: true` for endpoints der responsen avhenger av caller.
 */

import type { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";

/**
 * Minimal Redis-interface som middleware-en trenger. ioredis sin `Redis`-
 * klasse implementerer dette out-of-the-box; vi typer mot en mindre
 * overflate så testene kan mocke uten å spinne opp en ekte Redis.
 *
 * Signaturen for `set` matcher ioredis' SET-overload med EX-duration:
 *   `set(key, value, "EX", seconds)` → `Promise<"OK" | null>`
 * Vi bruker `unknown[]` for argumentene fordi ioredis bruker literal-
 * string-types (`"EX"`, `"NX"`) som ikke trivielt lar seg overload-matche
 * uten å duplisere alle de 8+ overloadene. Det er trygt — funksjonen
 * brukes kun fra dette modulet med velkjente arg-shapes.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
}

export interface HttpResponseCacheOptions {
  redis: RedisLike;
  /** Cache TTL i sekunder. Anbefalt 15-60 for stille polling-endpoints. */
  ttlSeconds: number;
  /**
   * Hvis `true`, inkluder auth-token-hash i cache-nøkkelen så hver bruker
   * får sin egen cached versjon. Default `false` (shared/anonymous cache).
   *
   * Sett `true` for endpoints som returnerer user-specific data
   * (`/api/wallet/me/*`, `/api/spillevett/report` osv.).
   */
  perUser?: boolean;
  /**
   * Hvis `true`, server cache også uten Authorization-header. Sett kun
   * for endpoints som faktisk er offentlige (`/api/halls/:hallReference/
   * client-variant` o.l.). Default `false` — krever auth-header for å
   * hindre at en uautentisert klient klipper auth-sjekken ved cache-hit.
   */
  allowAnonymous?: boolean;
  /**
   * Override nøkkel-derivasjon for spesielle behov. Returner stabilt
   * uttrykk basert kun på `req`. Default er `${method}:${path}?${
   * sortedQuery}` (+ `:user:<userIdHash>` hvis `perUser`).
   */
  keyDeriver?: (req: Request) => string;
  /**
   * Versjons-tag for cache-nøkkelen. Bump for å invalidere alle keys
   * etter et breaking response-format-bytte. Default `v1`.
   */
  version?: string;
}

const KEY_PREFIX = "httpcache";

/**
 * Bygg deterministisk cache-key fra request.
 *
 * Stable ordering på query-keys og verdier — `?a=1&b=2` og `?b=2&a=1`
 * gir samme key.
 */
function defaultKeyDeriver(req: Request, perUser: boolean): string {
  // Sorter query-parametere stabilt så `?a=1&b=2` og `?b=2&a=1` gir samme
  // cache-key.
  const queryKeys = Object.keys(req.query).sort();
  const queryParts: string[] = [];
  for (const k of queryKeys) {
    const v = req.query[k];
    if (Array.isArray(v)) {
      for (const item of v) queryParts.push(`${k}=${String(item)}`);
    } else if (v !== undefined && v !== null) {
      queryParts.push(`${k}=${String(v)}`);
    }
  }
  const queryString = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";

  // Foretrekk `baseUrl + path` så vi får full route-prefix selv når
  // middleware er mountet under `app.use('/api/games/status', mw)`.
  // Fallback til `req.path` for tester / direkte `app.use(mw)`.
  // `req.originalUrl` ville inneholdt query — vi bygger queryString
  // selv fra `req.query` for å sikre stabil rekkefølge.
  const baseUrl = (req as { baseUrl?: string }).baseUrl ?? "";
  const fullPath = `${baseUrl}${req.path}`.replace(/\/+/g, "/");
  let key = `${req.method}:${fullPath}${queryString}`;

  if (perUser) {
    const authHeader = req.headers.authorization ?? "";
    // Hash hele Authorization-headeren (Bearer + token) så vi ikke
    // lekker tokens i Redis-logger. SHA-256 → første 16 bytes (32 hex)
    // er rikelig for unik per-user keying.
    const userKey =
      authHeader.length > 0
        ? createHash("sha256").update(authHeader).digest("hex").slice(0, 32)
        : "anon";
    key += `:user:${userKey}`;
  }

  return key;
}

/**
 * Payload vi lagrer i Redis. JSON-serialiserbar so vi kan SET/GET som
 * streng. `contentType` settes alltid `application/json` av middleware
 * — men feltet gjør vi det enkelt å utvide til andre typer senere.
 */
interface CachedResponse {
  body: unknown;
  contentType: string;
  statusCode: number;
  cachedAtMs: number;
}

/**
 * Express middleware som cacher response i Redis i `ttlSeconds` sekunder.
 *
 * Pipeline ved request:
 *  1. Skip hvis ikke GET.
 *  2. Hvis auth-krav men ingen Authorization-header → skip cache (la
 *     handler returnere 401 normalt).
 *  3. Bygg key. Slå opp Redis.
 *  4. Hit → send cached 200 + `X-Cache: HIT`.
 *  5. Miss → wrap `res.json()` og `res.status()` så vi fanger body +
 *     status. Etter handler kjører: hvis 200, skriv til Redis. Sett
 *     `X-Cache: MISS`.
 *
 * Alle Redis-feil fanges og logges via console.error — vi blokkerer
 * aldri request på cache-issues. Det er bedre å serve fra DB enn å
 * returnere 5xx.
 */
export function createResponseCacheMiddleware(
  opts: HttpResponseCacheOptions,
): (req: Request, res: Response, next: NextFunction) => void | Promise<void> {
  const {
    redis,
    ttlSeconds,
    perUser = false,
    allowAnonymous = false,
    keyDeriver,
    version = "v1",
  } = opts;

  if (ttlSeconds <= 0) {
    throw new Error("[httpResponseCache] ttlSeconds must be > 0");
  }

  const derive = keyDeriver ?? ((req: Request) => defaultKeyDeriver(req, perUser));

  return async function responseCacheMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    // Kun GET er trygt å cache. PUT/POST/DELETE muterer state.
    if (req.method !== "GET") {
      return next();
    }

    // Forsvar-i-dybden: hvis routen er auth-guarded (default) og klienten
    // ikke har Authorization-header, la handleren kjøre og returnere 401.
    // Hvis vi serverte fra cache her, kunne en anonymous request fått
    // 200 fra cache-hit selv om handler ville returnert 401.
    const hasAuthHeader =
      typeof req.headers.authorization === "string" &&
      req.headers.authorization.length > 0;
    if (!allowAnonymous && !hasAuthHeader) {
      return next();
    }

    const cacheKey = `${KEY_PREFIX}:${version}:${derive(req)}`;

    // Forsøk cache-lookup. Hvis Redis kaster, fortsett som om cache var miss.
    let cached: string | null = null;
    try {
      cached = await redis.get(cacheKey);
    } catch (err) {
      console.error("[httpResponseCache] redis GET error", {
        path: req.path,
        error: err instanceof Error ? err.message : String(err),
      });
      cached = null;
    }

    if (cached !== null) {
      try {
        const parsed = JSON.parse(cached) as CachedResponse;
        res.setHeader("X-Cache", "HIT");
        res.setHeader(
          "Cache-Control",
          perUser
            ? `private, max-age=${ttlSeconds}`
            : `public, max-age=${ttlSeconds}, must-revalidate`,
        );
        res.setHeader("Content-Type", parsed.contentType);
        res.status(parsed.statusCode).send(JSON.stringify(parsed.body));
        return;
      } catch (err) {
        console.error("[httpResponseCache] failed to parse cached body — falling through", {
          path: req.path,
          error: err instanceof Error ? err.message : String(err),
        });
        // Falle gjennom til miss-path
      }
    }

    // Cache miss — wrap res.json() så vi fanger body, ev. cache etter
    // handler-kjøring.
    res.setHeader("X-Cache", "MISS");

    const originalJson = res.json.bind(res);
    let capturedBody: unknown = undefined;
    let bodyCaptured = false;
    res.json = function patchedJson(body: unknown): Response {
      capturedBody = body;
      bodyCaptured = true;
      return originalJson(body);
    };

    // Hook etter response er sendt. `finish`-eventet fyrer etter at
    // headers + body er flushet til socketen — så res.statusCode er
    // korrekt sluttverdi. Vi cacher kun 200 OK.
    res.on("finish", () => {
      if (!bodyCaptured) {
        return; // ingen json-body å cache (kanskje res.send med streng)
      }
      if (res.statusCode !== 200) {
        return; // ikke cache feil-responser
      }

      const payload: CachedResponse = {
        body: capturedBody,
        contentType: "application/json; charset=utf-8",
        statusCode: 200,
        cachedAtMs: Date.now(),
      };

      const serialized = JSON.stringify(payload);
      redis
        .set(cacheKey, serialized, "EX", ttlSeconds)
        .catch((err: unknown) => {
          console.error("[httpResponseCache] redis SET error", {
            path: req.path,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    });

    // Sett Cache-Control header også for miss — klient kan respektere
    // og hoppe over polling i `max-age` sekunder.
    res.setHeader(
      "Cache-Control",
      perUser
        ? `private, max-age=${ttlSeconds}`
        : `public, max-age=${ttlSeconds}, must-revalidate`,
    );

    next();
  };
}
