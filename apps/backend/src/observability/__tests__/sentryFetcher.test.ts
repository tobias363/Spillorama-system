/**
 * Tester for `sentryFetcher.ts` (OBS-10, 2026-05-14).
 *
 * Strategi:
 *   - Mock `FetchFn` så vi slipper å nå Sentry-API.
 *   - Verifiser fail-soft kontrakt: alle feil → [] + warn-log.
 *   - Sjekk URL-bygging og query-encoding.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fetchSentryIssues,
  buildSentryFetcherConfigFromEnv,
  __TEST_ONLY__,
  type FetchFn,
  type Logger,
  type SentryFetcherConfig,
} from "../sentryFetcher.js";

function makeLogger(): { logger: Logger; warns: string[] } {
  const warns: string[] = [];
  return {
    logger: {
      warn: (m: string) => {
        warns.push(m);
      },
    },
    warns,
  };
}

const baseConfig: SentryFetcherConfig = {
  authToken: "sntryu_test123",
  org: "spillorama",
  projectBackend: "spillorama-backend",
  projectFrontend: "spillorama-frontend",
  baseUrl: "https://sentry.test",
};

function mockOkResponse(rows: unknown[]): ReturnType<FetchFn> {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => rows,
    text: async () => JSON.stringify(rows),
  });
}

describe("sentryFetcher.fetchSentryIssues", () => {
  it("returnerer parsed shape ved happy path", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    const fetchFn: FetchFn = (input, init) => {
      capturedUrl = input;
      capturedHeaders = init.headers;
      return mockOkResponse([
        {
          id: "42",
          shortId: "SPILLORAMA-BACKEND-42",
          title: "TypeError: undefined.foo",
          culprit: "GameLobbyAggregator.getLobbyState",
          permalink: "https://spillorama.sentry.io/issues/42/",
          count: 3,
          lastSeen: "2026-05-14T22:00:00Z",
          level: "error",
          tags: [
            { key: "hall_id", value: "demo-hall-001" },
            { key: "route", value: "/api/agent/game1/lobby" },
          ],
        },
      ]);
    };

    const { logger, warns } = makeLogger();
    const issues = await fetchSentryIssues(
      baseConfig,
      { statsPeriod: "10m", limit: 25, hallId: "demo-hall-001" },
      { fetchFn, logger },
    );

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.id, "42");
    assert.equal(issues[0]?.shortId, "SPILLORAMA-BACKEND-42");
    assert.equal(issues[0]?.culprit, "GameLobbyAggregator.getLobbyState");
    assert.equal(issues[0]?.count, 3);
    assert.equal(issues[0]?.tags.length, 2);
    assert.equal(warns.length, 0);

    // URL-bygging
    assert.ok(
      capturedUrl.startsWith(
        "https://sentry.test/api/0/projects/spillorama/spillorama-backend/issues/",
      ),
      `URL prefix mismatch: ${capturedUrl}`,
    );
    assert.ok(capturedUrl.includes("statsPeriod=10m"));
    assert.ok(capturedUrl.includes("limit=25"));
    assert.ok(capturedUrl.includes("hall_id"));

    // Authorization-header
    assert.equal(capturedHeaders["Authorization"], "Bearer sntryu_test123");
    assert.equal(capturedHeaders["Accept"], "application/json");
  });

  it("returnerer tom array ved 401 + logger warn", async () => {
    const fetchFn: FetchFn = () =>
      Promise.resolve({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({}),
        text: async () => '{"detail":"Invalid token"}',
      });

    const { logger, warns } = makeLogger();
    const issues = await fetchSentryIssues(baseConfig, {}, { fetchFn, logger });

    assert.deepEqual(issues, []);
    assert.equal(warns.length, 1);
    assert.ok(warns[0]?.includes("401"), `expected 401 in warn: ${warns[0]}`);
  });

  it("returnerer tom array ved network-feil + logger warn", async () => {
    const fetchFn: FetchFn = () => Promise.reject(new Error("ECONNRESET"));

    const { logger, warns } = makeLogger();
    const issues = await fetchSentryIssues(baseConfig, {}, { fetchFn, logger });

    assert.deepEqual(issues, []);
    assert.equal(warns.length, 1);
    assert.ok(warns[0]?.includes("ECONNRESET"));
  });

  it("returnerer tom array ved timeout (AbortError) + logger warn", async () => {
    // Lag en fetch som aldri resolver, så AbortController kan kicke inn.
    const fetchFn: FetchFn = (_input, init) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    };

    const { logger, warns } = makeLogger();
    const issues = await fetchSentryIssues(
      baseConfig,
      { timeoutMs: 50 },
      { fetchFn, logger },
    );

    assert.deepEqual(issues, []);
    assert.equal(warns.length, 1);
    assert.ok(warns[0]?.includes("timeout"));
  });

  it("returnerer tom array når authToken mangler + logger warn", async () => {
    const fetchFn: FetchFn = () => {
      throw new Error("skal aldri kalles");
    };
    const { logger, warns } = makeLogger();
    const issues = await fetchSentryIssues(
      { ...baseConfig, authToken: "" },
      {},
      { fetchFn, logger },
    );

    assert.deepEqual(issues, []);
    assert.equal(warns.length, 1);
    assert.ok(warns[0]?.includes("SENTRY_AUTH_TOKEN"));
  });

  it("returnerer tom array når response ikke er array (parse-feil)", async () => {
    const fetchFn: FetchFn = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ message: "unexpected" }),
        text: async () => '{"message":"unexpected"}',
      });

    const { logger, warns } = makeLogger();
    const issues = await fetchSentryIssues(baseConfig, {}, { fetchFn, logger });

    assert.deepEqual(issues, []);
    assert.equal(warns.length, 1);
    assert.ok(warns[0]?.includes("array"));
  });

  it("limit blir clamped til hard-cap (100)", async () => {
    let capturedUrl = "";
    const fetchFn: FetchFn = (input) => {
      capturedUrl = input;
      return mockOkResponse([]);
    };
    const { logger } = makeLogger();
    await fetchSentryIssues(
      baseConfig,
      { limit: 9999 },
      { fetchFn, logger },
    );
    assert.ok(capturedUrl.includes("limit=100"));
  });

  it("project=frontend bytter prosjekt-slug i URL", async () => {
    let capturedUrl = "";
    const fetchFn: FetchFn = (input) => {
      capturedUrl = input;
      return mockOkResponse([]);
    };
    const { logger } = makeLogger();
    await fetchSentryIssues(
      baseConfig,
      { project: "frontend" },
      { fetchFn, logger },
    );
    assert.ok(capturedUrl.includes("spillorama-frontend"), `URL: ${capturedUrl}`);
    assert.ok(!capturedUrl.includes("spillorama-backend/issues"), `URL: ${capturedUrl}`);
  });

  it("URL-encoder org og project (defense mot path injection)", async () => {
    let capturedUrl = "";
    const fetchFn: FetchFn = (input) => {
      capturedUrl = input;
      return mockOkResponse([]);
    };
    const { logger } = makeLogger();
    await fetchSentryIssues(
      { ...baseConfig, org: "weird org/", projectBackend: "proj with space" },
      {},
      { fetchFn, logger },
    );
    assert.ok(
      capturedUrl.includes("weird%20org") || capturedUrl.includes("weird+org"),
      `expected encoded org slug: ${capturedUrl}`,
    );
    assert.ok(
      capturedUrl.includes("proj%20with%20space") ||
        capturedUrl.includes("proj+with+space"),
      `expected encoded project slug: ${capturedUrl}`,
    );
  });

  it("hopper over issues uten id i parse", () => {
    const out = __TEST_ONLY__.parseSentryIssues(
      [
        { id: "1", title: "A" },
        { /* no id */ title: "B" },
        null,
        "stringy",
      ],
      { warn: () => {} },
    );
    assert.equal(out.length, 1);
    assert.equal(out[0]?.id, "1");
  });

  it("default title fallback ved manglende title-felt", () => {
    const out = __TEST_ONLY__.parseSentryIssues(
      [{ id: "1" }],
      { warn: () => {} },
    );
    assert.equal(out[0]?.title, "(uten tittel)");
  });
});

describe("buildSentryFetcherConfigFromEnv", () => {
  it("returnerer null når SENTRY_AUTH_TOKEN mangler", () => {
    const cfg = buildSentryFetcherConfigFromEnv({
      SENTRY_ORG: "x",
      SENTRY_PROJECT_BACKEND: "y",
    });
    assert.equal(cfg, null);
  });

  it("returnerer null når SENTRY_ORG mangler", () => {
    const cfg = buildSentryFetcherConfigFromEnv({
      SENTRY_AUTH_TOKEN: "t",
      SENTRY_PROJECT_BACKEND: "y",
    });
    assert.equal(cfg, null);
  });

  it("returnerer config når påkrevde felter er satt", () => {
    const cfg = buildSentryFetcherConfigFromEnv({
      SENTRY_AUTH_TOKEN: "sntryu_abc",
      SENTRY_ORG: "spillorama",
      SENTRY_PROJECT_BACKEND: "backend",
      SENTRY_PROJECT_FRONTEND: "frontend",
    });
    assert.deepEqual(cfg, {
      authToken: "sntryu_abc",
      org: "spillorama",
      projectBackend: "backend",
      projectFrontend: "frontend",
    });
  });

  it("trimmer whitespace", () => {
    const cfg = buildSentryFetcherConfigFromEnv({
      SENTRY_AUTH_TOKEN: "  sntryu_abc  ",
      SENTRY_ORG: "spillorama\n",
      SENTRY_PROJECT_BACKEND: "backend",
    });
    assert.equal(cfg?.authToken, "sntryu_abc");
    assert.equal(cfg?.org, "spillorama");
  });

  it("fallback til backend hvis frontend mangler (eller omvendt)", () => {
    const cfgA = buildSentryFetcherConfigFromEnv({
      SENTRY_AUTH_TOKEN: "t",
      SENTRY_ORG: "o",
      SENTRY_PROJECT_BACKEND: "be",
    });
    assert.equal(cfgA?.projectFrontend, "be");

    const cfgB = buildSentryFetcherConfigFromEnv({
      SENTRY_AUTH_TOKEN: "t",
      SENTRY_ORG: "o",
      SENTRY_PROJECT_FRONTEND: "fe",
    });
    assert.equal(cfgB?.projectBackend, "fe");
  });
});
