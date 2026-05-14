/**
 * OBS-10 (2026-05-14) — Sentry REST API fetcher for bug-bundler.
 *
 * Bakgrunn:
 *   Bug-bundleren (`devBugReport.ts`) bundler klient-state, EventTracker,
 *   pilot-monitor, backend stdout, DB-state og DB-audit. OBS-10 utvider
 *   dette med Sentry-issues siste 10 min så PM-agenten ser hele bevis-
 *   pakken i én markdown.
 *
 * Hva denne modulen gjør:
 *   Kalle Sentry's REST API
 *   `GET https://sentry.io/api/0/projects/{org}/{project}/issues/`
 *   med Bearer-token (Personal API Token) og parse svaret til en
 *   liten, stabil shape (`SentryIssue[]`).
 *
 * Hva den IKKE gjør:
 *   - Initialiserer ikke @sentry/node (det er `sentry.ts` sitt ansvar)
 *   - Sender ikke events INN til Sentry (dette er kun lese-back)
 *   - Lagrer ikke cache — hver bug-rapport får ferske data
 *
 * Fail-soft kontrakt:
 *   Alle feil (network, auth, 5xx, parse-feil, timeout) returnerer en
 *   tom array og logger en warn. Bug-rapporten skal aldri brytes av
 *   en Sentry-lookup som feiler — vi vil bare droppe seksjonen.
 *
 * Sikkerhet:
 *   `SENTRY_AUTH_TOKEN` skal kun ligge i `apps/backend/.env.local`
 *   (gitignored). Tokenet er Personal-scope og leses kun server-side.
 *   Vi sender det aldri til klienten.
 */

/**
 * Stabil shape PM-agenten kan stole på. Holdes med vilje liten — vi
 * trenger ikke alle 30+ felter Sentry returnerer, og en mindre shape
 * gjør oss mer robust mot Sentry-API-endringer.
 */
export interface SentryIssue {
  /** Numerisk issue-id (string for forward-compat). */
  id: string;
  /** Kort id som vises i Sentry-URLer (eks "SPILLORAMA-42"). */
  shortId: string;
  /** Issue-tittel (typisk error-melding). */
  title: string;
  /** Funksjonsnavn/url hvor issue-en oppstod. Null hvis Sentry ikke kunne utlede. */
  culprit: string | null;
  /** Permalink til issue-detalj-side i Sentry-dashboardet. */
  permalink: string;
  /** Antall events innen periode-filteret. */
  count: number;
  /** ISO-string for siste sett. */
  lastSeen: string;
  /** Sentry-level: "fatal" | "error" | "warning" | "info" | "debug". */
  level: string;
  /**
   * Tags formet som key/value-par. Vi flatter ut Sentry's tag-shape
   * `[{ key, value }, ...]` til samme array slik at PM-agenten kan
   * filtrere på `hallId` eller `route` uten å gjette format.
   */
  tags: Array<{ key: string; value: string }>;
}

/** Konfigurasjon — leses fra env av caller, sendes inn eksplisitt. */
export interface SentryFetcherConfig {
  /** Personal API token (`sntryu_...`). */
  authToken: string;
  /** Organisasjons-slug (eks "spillorama"). */
  org: string;
  /**
   * Backend-prosjekt-slug. Brukes som default `project` for issues-query
   * når caller ikke spesifiserer et annet.
   */
  projectBackend: string;
  /** Frontend-prosjekt-slug (eks "spillorama-frontend"). */
  projectFrontend: string;
  /**
   * Sentry API-base (default `https://sentry.io`). Tester kan peke til
   * en lokal mock-server.
   */
  baseUrl?: string;
}

/** Opt-in parametre per request. */
export interface FetchSentryIssuesOpts {
  /**
   * Sentry-statsPeriod-string ("10m", "1h", "24h"). Default "10m" for
   * bug-bundleren — vi vil se nylige feil rundt bug-rapport-tidspunktet.
   */
  statsPeriod?: string;
  /** Max antall issues. Default 25, hard-cap 100. */
  limit?: number;
  /**
   * Filter på user.id-tag — hvis Sentry-events har dette taget vil bare
   * issues som matcher returneres. Backend setter user.id via
   * `setSocketSentryContext` (sentry.ts).
   */
  userId?: string;
  /** Filter på hall_id-tag (samme prinsipp som userId). */
  hallId?: string;
  /** Hvilket prosjekt vi querier. Default "backend". */
  project?: "backend" | "frontend";
  /** Timeout i ms. Default 10 000. */
  timeoutMs?: number;
}

/** Logger interface for testbar warn-output. */
export interface Logger {
  warn: (message: string) => void;
}

/** Fetch-implementasjon kan injiseres for tester. */
export type FetchFn = (
  input: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> }>;

/**
 * Default-konstanter — i én pakke for å overstyre lett i tester.
 *
 * NB om `statsPeriod`: Sentry godtar IKKE minutter (vi testet "10m" og
 * fikk 400 "Invalid stats_period. Valid choices are '', '24h', and '14d'").
 * Vi bruker derfor "1h" som default — fortsatt ferskt nok rundt
 * bug-rapport-tidspunktet til å fange relevante issues.
 */
export const SENTRY_FETCHER_DEFAULTS = {
  baseUrl: "https://sentry.io",
  limit: 25,
  hardCap: 100,
  statsPeriod: "1h",
  timeoutMs: 10_000,
} as const;

/**
 * Hovedfunksjon. Returnerer parsed `SentryIssue[]` eller `[]` ved feil.
 *
 * Det er bevisst at vi aldri kaster — caller (bug-bundleren) skal kunne
 * fortsette uten å vite om Sentry-fetch lyktes eller ikke.
 */
export async function fetchSentryIssues(
  config: SentryFetcherConfig,
  opts: FetchSentryIssuesOpts = {},
  deps: { fetchFn?: FetchFn; logger?: Logger } = {},
): Promise<SentryIssue[]> {
  const fetchFn = (deps.fetchFn ?? (globalThis.fetch as unknown as FetchFn));
  const logger = deps.logger ?? console;

  if (!config.authToken) {
    logger.warn("[sentryFetcher] SENTRY_AUTH_TOKEN ikke satt — hopper over fetch");
    return [];
  }
  if (!config.org) {
    logger.warn("[sentryFetcher] SENTRY_ORG ikke satt — hopper over fetch");
    return [];
  }

  const project =
    opts.project === "frontend"
      ? config.projectFrontend
      : config.projectBackend;
  if (!project) {
    logger.warn("[sentryFetcher] Project-slug mangler for valgt project — hopper over fetch");
    return [];
  }

  const baseUrl = (config.baseUrl ?? SENTRY_FETCHER_DEFAULTS.baseUrl).replace(/\/$/, "");
  const statsPeriod = opts.statsPeriod ?? SENTRY_FETCHER_DEFAULTS.statsPeriod;
  const requestedLimit = opts.limit ?? SENTRY_FETCHER_DEFAULTS.limit;
  const limit = Math.max(1, Math.min(requestedLimit, SENTRY_FETCHER_DEFAULTS.hardCap));
  const timeoutMs = opts.timeoutMs ?? SENTRY_FETCHER_DEFAULTS.timeoutMs;

  // Bygg query — Sentry forventer `query=user.id:xxx hall_id:yyy`.
  const queryParts: string[] = [];
  if (opts.userId) {
    queryParts.push(`user.id:${opts.userId}`);
  }
  if (opts.hallId) {
    queryParts.push(`hall_id:${opts.hallId}`);
  }

  const url = new URL(
    `/api/0/projects/${encodeURIComponent(config.org)}/${encodeURIComponent(project)}/issues/`,
    baseUrl,
  );
  url.searchParams.set("statsPeriod", statsPeriod);
  url.searchParams.set("limit", String(limit));
  if (queryParts.length > 0) {
    url.searchParams.set("query", queryParts.join(" "));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(url.toString(), {
      headers: {
        Authorization: `Bearer ${config.authToken}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const status = res.status;
      let bodyPreview = "";
      try {
        bodyPreview = (await res.text()).slice(0, 200);
      } catch {
        /* ignorer */
      }
      logger.warn(
        `[sentryFetcher] HTTP ${status} ${res.statusText} fra Sentry: ${bodyPreview}`,
      );
      return [];
    }

    const raw = (await res.json()) as unknown;
    return parseSentryIssues(raw, logger);
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.name === "AbortError"
          ? `timeout etter ${timeoutMs}ms`
          : err.message
        : String(err);
    logger.warn(`[sentryFetcher] fetch feilet: ${msg.slice(0, 200)}`);
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse Sentry's response-shape til vår stabile shape. Tar høyde for at
 * Sentry kan returnere felter som null/undefined.
 */
function parseSentryIssues(raw: unknown, logger: Logger): SentryIssue[] {
  if (!Array.isArray(raw)) {
    logger.warn("[sentryFetcher] forventet array fra Sentry, fikk annet");
    return [];
  }
  const out: SentryIssue[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const id = stringOrEmpty(obj["id"]);
    if (!id) continue; // skip uten id

    const tagsRaw = obj["tags"];
    const tags: Array<{ key: string; value: string }> = [];
    if (Array.isArray(tagsRaw)) {
      for (const t of tagsRaw) {
        if (!t || typeof t !== "object") continue;
        const tObj = t as Record<string, unknown>;
        const k = stringOrEmpty(tObj["key"]);
        const v = stringOrEmpty(tObj["value"]);
        if (k && v) {
          tags.push({ key: k, value: v });
        }
      }
    }

    out.push({
      id,
      shortId: stringOrEmpty(obj["shortId"]),
      title: stringOrEmpty(obj["title"]) || "(uten tittel)",
      culprit:
        typeof obj["culprit"] === "string" && obj["culprit"].trim().length > 0
          ? (obj["culprit"] as string)
          : null,
      permalink: stringOrEmpty(obj["permalink"]),
      count: numberOrZero(obj["count"]),
      lastSeen: stringOrEmpty(obj["lastSeen"]),
      level: stringOrEmpty(obj["level"]) || "error",
      tags,
    });
  }
  return out;
}

function stringOrEmpty(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

function numberOrZero(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Bygg "live" config fra env-variablene. Returnerer null hvis kritiske
 * felter mangler — caller skal da skippe Sentry-seksjonen.
 */
export function buildSentryFetcherConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SentryFetcherConfig | null {
  const authToken = (env["SENTRY_AUTH_TOKEN"] ?? "").trim();
  const org = (env["SENTRY_ORG"] ?? "").trim();
  const projectBackend = (env["SENTRY_PROJECT_BACKEND"] ?? "").trim();
  const projectFrontend = (env["SENTRY_PROJECT_FRONTEND"] ?? "").trim();
  if (!authToken || !org || (!projectBackend && !projectFrontend)) {
    return null;
  }
  return {
    authToken,
    org,
    projectBackend: projectBackend || projectFrontend,
    projectFrontend: projectFrontend || projectBackend,
  };
}

// Test-exports
export const __TEST_ONLY__ = {
  parseSentryIssues,
  stringOrEmpty,
  numberOrZero,
};
