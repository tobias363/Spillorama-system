/**
 * OBS-10 (2026-05-14) — PostHog REST API fetcher for bug-bundler.
 *
 * Bakgrunn:
 *   Bug-bundleren (`devBugReport.ts`) leser allerede klient-events fra
 *   EventTracker-JSONL-en. OBS-10 utvider med PostHog-events siste 10
 *   min for spillerens `distinct_id` så vi får server-side-verifisering
 *   av at klient-events faktisk landet i analytics-pipelinen.
 *
 * Hva denne modulen gjør:
 *   Kalle PostHog's REST API
 *   `GET https://eu.posthog.com/api/projects/{projectId}/events/`
 *   med Bearer-token (Personal API Key) og parse svaret til en
 *   liten, stabil shape (`PostHogEvent[]`).
 *
 * Hva den IKKE gjør:
 *   - Initialiserer ikke `posthog-node` (det er `posthogBootstrap.ts`)
 *   - Sender events INN til PostHog
 *   - Cacher response
 *
 * Fail-soft kontrakt: alle feil → `[]` + warn-log. Bug-rapporten skal
 * aldri brytes av en PostHog-lookup som feiler.
 *
 * Sikkerhet: `POSTHOG_PERSONAL_API_KEY` skal kun ligge i
 * `apps/backend/.env.local` (gitignored). Personal-scope token leses
 * kun server-side.
 */

/**
 * Stabil shape PM-agenten kan stole på. PostHog returnerer mye mer enn
 * dette, men vi tar bare det bug-bundleren faktisk trenger.
 */
export interface PostHogEvent {
  /** PostHog event-id (UUID). */
  id: string;
  /** Event-navn (eks "client.buy.confirm.attempt"). */
  event: string;
  /** ISO-timestamp for når event ble emittert klient-side. */
  timestamp: string;
  /** Spillerens distinct_id (typisk userId). */
  distinct_id: string;
  /** Custom properties — vi videresender hele objektet. */
  properties: Record<string, unknown>;
  /** Person-snapshot hvis tilgjengelig. Null hvis PostHog ikke har det. */
  person: {
    distinct_ids: string[];
    properties: Record<string, unknown>;
  } | null;
}

/** Konfigurasjon — leses fra env av caller. */
export interface PostHogFetcherConfig {
  /** Personal API key (`phx_...`). */
  apiKey: string;
  /** PostHog instance-base (eks `https://eu.posthog.com`). */
  host: string;
  /** Numerisk project-id. */
  projectId: number;
}

/** Opt-in parametre per request. */
export interface FetchPostHogEventsOpts {
  /** Distinct id (typisk userId fra Sentry/wallet). */
  distinctId?: string;
  /**
   * Hent events fra de siste N minuttene. Default 10. Hvis både
   * `afterMinutes` og `afterIso` er satt, vinner `afterIso`.
   */
  afterMinutes?: number;
  /** Eksplisitt ISO-timestamp — overstyrer afterMinutes. */
  afterIso?: string;
  /** Max antall events. Default 50, hard-cap 200. */
  limit?: number;
  /** Klokke (test-injeksjon). Default Date.now. */
  now?: () => number;
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

/** Default-konstanter. */
export const POSTHOG_FETCHER_DEFAULTS = {
  host: "https://eu.posthog.com",
  afterMinutes: 10,
  limit: 50,
  hardCap: 200,
  timeoutMs: 10_000,
} as const;

/**
 * Hovedfunksjon — returnerer parsed events eller `[]` ved feil.
 *
 * Det er bevisst at vi aldri kaster.
 */
export async function fetchPostHogEvents(
  config: PostHogFetcherConfig,
  opts: FetchPostHogEventsOpts = {},
  deps: { fetchFn?: FetchFn; logger?: Logger } = {},
): Promise<PostHogEvent[]> {
  const fetchFn = (deps.fetchFn ?? (globalThis.fetch as unknown as FetchFn));
  const logger = deps.logger ?? console;

  if (!config.apiKey) {
    logger.warn("[posthogFetcher] POSTHOG_PERSONAL_API_KEY ikke satt — hopper over fetch");
    return [];
  }
  if (!config.projectId || !Number.isFinite(config.projectId)) {
    logger.warn("[posthogFetcher] POSTHOG_PROJECT_ID ikke satt — hopper over fetch");
    return [];
  }
  if (!config.host) {
    logger.warn("[posthogFetcher] POSTHOG_HOST ikke satt — hopper over fetch");
    return [];
  }

  const host = config.host.replace(/\/$/, "");
  const requestedLimit = opts.limit ?? POSTHOG_FETCHER_DEFAULTS.limit;
  const limit = Math.max(
    1,
    Math.min(requestedLimit, POSTHOG_FETCHER_DEFAULTS.hardCap),
  );
  const timeoutMs = opts.timeoutMs ?? POSTHOG_FETCHER_DEFAULTS.timeoutMs;
  const nowFn = opts.now ?? Date.now;

  // Beregn `after` (ISO-string PostHog forventer).
  let afterIso: string;
  if (typeof opts.afterIso === "string" && opts.afterIso.length > 0) {
    afterIso = opts.afterIso;
  } else {
    const afterMinutes =
      opts.afterMinutes ?? POSTHOG_FETCHER_DEFAULTS.afterMinutes;
    afterIso = new Date(nowFn() - afterMinutes * 60_000).toISOString();
  }

  const url = new URL(`/api/projects/${config.projectId}/events/`, host);
  url.searchParams.set("after", afterIso);
  url.searchParams.set("limit", String(limit));
  if (opts.distinctId) {
    url.searchParams.set("distinct_id", opts.distinctId);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(url.toString(), {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
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
        `[posthogFetcher] HTTP ${status} ${res.statusText} fra PostHog: ${bodyPreview}`,
      );
      return [];
    }

    const raw = (await res.json()) as unknown;
    return parsePostHogEvents(raw, logger);
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.name === "AbortError"
          ? `timeout etter ${timeoutMs}ms`
          : err.message
        : String(err);
    logger.warn(`[posthogFetcher] fetch feilet: ${msg.slice(0, 200)}`);
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse PostHog's `{ results: [...] }`-shape til vår stabile shape.
 */
function parsePostHogEvents(raw: unknown, logger: Logger): PostHogEvent[] {
  if (!raw || typeof raw !== "object") {
    logger.warn("[posthogFetcher] forventet object fra PostHog, fikk annet");
    return [];
  }
  const rawObj = raw as Record<string, unknown>;
  const results = rawObj["results"];
  if (!Array.isArray(results)) {
    logger.warn("[posthogFetcher] forventet results-array fra PostHog");
    return [];
  }
  const out: PostHogEvent[] = [];
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const id = stringOrEmpty(obj["id"]);
    if (!id) continue;
    const event = stringOrEmpty(obj["event"]);
    if (!event) continue;

    const propertiesRaw = obj["properties"];
    const properties =
      propertiesRaw && typeof propertiesRaw === "object"
        ? (propertiesRaw as Record<string, unknown>)
        : {};

    let person: PostHogEvent["person"] = null;
    const personRaw = obj["person"];
    if (personRaw && typeof personRaw === "object") {
      const personObj = personRaw as Record<string, unknown>;
      const distinctIds = Array.isArray(personObj["distinct_ids"])
        ? (personObj["distinct_ids"] as unknown[])
            .filter((v): v is string => typeof v === "string")
        : [];
      const personProps =
        personObj["properties"] && typeof personObj["properties"] === "object"
          ? (personObj["properties"] as Record<string, unknown>)
          : {};
      person = { distinct_ids: distinctIds, properties: personProps };
    }

    out.push({
      id,
      event,
      timestamp: stringOrEmpty(obj["timestamp"]),
      distinct_id: stringOrEmpty(obj["distinct_id"]),
      properties,
      person,
    });
  }
  return out;
}

function stringOrEmpty(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

/**
 * Bygg "live" config fra env. Returnerer null hvis kritiske felter mangler.
 */
export function buildPostHogFetcherConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PostHogFetcherConfig | null {
  const apiKey = (env["POSTHOG_PERSONAL_API_KEY"] ?? "").trim();
  const host =
    (env["POSTHOG_HOST"] ?? POSTHOG_FETCHER_DEFAULTS.host).trim() ||
    POSTHOG_FETCHER_DEFAULTS.host;
  const projectIdRaw = (env["POSTHOG_PROJECT_ID"] ?? "").trim();
  const projectId = Number.parseInt(projectIdRaw, 10);
  if (!apiKey || !Number.isFinite(projectId) || projectId <= 0) {
    return null;
  }
  return { apiKey, host, projectId };
}

/**
 * Helper for å bygge en PostHog-link til events-dashboardet som PM kan
 * klikke direkte fra bug-rapporten.
 */
export function buildPostHogEventsLink(
  config: { host: string; projectId: number },
  opts: { distinctId?: string } = {},
): string {
  const host = config.host.replace(/\/$/, "");
  const path = `/project/${config.projectId}/events`;
  if (opts.distinctId) {
    const filter = encodeURIComponent(opts.distinctId);
    return `${host}${path}?eventFilter=distinct_id=${filter}`;
  }
  return `${host}${path}`;
}

// Test-exports
export const __TEST_ONLY__ = {
  parsePostHogEvents,
  stringOrEmpty,
};
