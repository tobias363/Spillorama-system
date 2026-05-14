/**
 * Tester for `posthogFetcher.ts` (OBS-10, 2026-05-14).
 *
 * Mocker fetch; verifiserer fail-soft og URL-bygging.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fetchPostHogEvents,
  buildPostHogFetcherConfigFromEnv,
  buildPostHogEventsLink,
  __TEST_ONLY__,
  type FetchFn,
  type Logger,
  type PostHogFetcherConfig,
} from "../posthogFetcher.js";

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

const baseConfig: PostHogFetcherConfig = {
  apiKey: "phx_test123",
  host: "https://eu.posthog.test",
  projectId: 178713,
};

function mockOkResponse(results: unknown[]): ReturnType<FetchFn> {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ results }),
    text: async () => JSON.stringify({ results }),
  });
}

describe("posthogFetcher.fetchPostHogEvents", () => {
  it("returnerer parsed shape ved happy path", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    const fetchFn: FetchFn = (input, init) => {
      capturedUrl = input;
      capturedHeaders = init.headers;
      return mockOkResponse([
        {
          id: "e1",
          event: "client.buy.confirm.attempt",
          timestamp: "2026-05-14T22:05:00Z",
          distinct_id: "u-demo-1",
          properties: { tickets: 2, totalCents: 2000 },
          person: {
            distinct_ids: ["u-demo-1"],
            properties: { name: "Demo One" },
          },
        },
        {
          id: "e2",
          event: "spill1.payout.pattern",
          timestamp: "2026-05-14T22:05:30Z",
          distinct_id: "u-demo-1",
          properties: { pattern: "row_1", amountCents: 10000 },
          person: null,
        },
      ]);
    };

    const { logger, warns } = makeLogger();
    const events = await fetchPostHogEvents(
      baseConfig,
      {
        distinctId: "u-demo-1",
        afterMinutes: 10,
        limit: 50,
        now: () => Date.parse("2026-05-14T22:10:00Z"),
      },
      { fetchFn, logger },
    );

    assert.equal(events.length, 2);
    assert.equal(events[0]?.event, "client.buy.confirm.attempt");
    assert.equal(events[0]?.properties["tickets"], 2);
    assert.equal(events[0]?.person?.distinct_ids[0], "u-demo-1");
    assert.equal(events[1]?.person, null);
    assert.equal(warns.length, 0);

    assert.ok(
      capturedUrl.startsWith(
        "https://eu.posthog.test/api/projects/178713/events/",
      ),
      `URL prefix mismatch: ${capturedUrl}`,
    );
    assert.ok(capturedUrl.includes("after="));
    assert.ok(capturedUrl.includes("limit=50"));
    assert.ok(capturedUrl.includes("distinct_id=u-demo-1"));

    assert.equal(capturedHeaders["Authorization"], "Bearer phx_test123");
    assert.equal(capturedHeaders["Accept"], "application/json");
  });

  it("bygger after-timestamp basert på afterMinutes", async () => {
    let capturedUrl = "";
    const fetchFn: FetchFn = (input) => {
      capturedUrl = input;
      return mockOkResponse([]);
    };
    const { logger } = makeLogger();
    const fixedNow = Date.parse("2026-05-14T22:00:00Z");
    await fetchPostHogEvents(
      baseConfig,
      { afterMinutes: 30, now: () => fixedNow },
      { fetchFn, logger },
    );
    const expectedAfter = new Date(fixedNow - 30 * 60_000).toISOString();
    assert.ok(
      capturedUrl.includes(`after=${encodeURIComponent(expectedAfter)}`),
      `URL: ${capturedUrl}, expected after=${expectedAfter}`,
    );
  });

  it("afterIso vinner over afterMinutes", async () => {
    let capturedUrl = "";
    const fetchFn: FetchFn = (input) => {
      capturedUrl = input;
      return mockOkResponse([]);
    };
    const { logger } = makeLogger();
    await fetchPostHogEvents(
      baseConfig,
      { afterIso: "2020-01-01T00:00:00Z", afterMinutes: 60, now: () => 0 },
      { fetchFn, logger },
    );
    assert.ok(
      capturedUrl.includes("after=2020-01-01T00%3A00%3A00Z"),
      `URL: ${capturedUrl}`,
    );
  });

  it("returnerer tom array ved 401 + logger warn", async () => {
    const fetchFn: FetchFn = () =>
      Promise.resolve({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({}),
        text: async () => '{"detail":"Auth failed"}',
      });
    const { logger, warns } = makeLogger();
    const events = await fetchPostHogEvents(
      baseConfig,
      {},
      { fetchFn, logger },
    );
    assert.deepEqual(events, []);
    assert.equal(warns.length, 1);
    assert.ok(warns[0]?.includes("401"));
  });

  it("returnerer tom array ved network-feil", async () => {
    const fetchFn: FetchFn = () => Promise.reject(new Error("ENOTFOUND"));
    const { logger, warns } = makeLogger();
    const events = await fetchPostHogEvents(
      baseConfig,
      {},
      { fetchFn, logger },
    );
    assert.deepEqual(events, []);
    assert.equal(warns.length, 1);
    assert.ok(warns[0]?.includes("ENOTFOUND"));
  });

  it("returnerer tom array ved timeout", async () => {
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
    const events = await fetchPostHogEvents(
      baseConfig,
      { timeoutMs: 50 },
      { fetchFn, logger },
    );
    assert.deepEqual(events, []);
    assert.equal(warns.length, 1);
    assert.ok(warns[0]?.includes("timeout"));
  });

  it("returnerer tom array når apiKey mangler", async () => {
    const fetchFn: FetchFn = () => {
      throw new Error("skal aldri kalles");
    };
    const { logger, warns } = makeLogger();
    const events = await fetchPostHogEvents(
      { ...baseConfig, apiKey: "" },
      {},
      { fetchFn, logger },
    );
    assert.deepEqual(events, []);
    assert.equal(warns.length, 1);
  });

  it("returnerer tom array når response ikke har results-array", async () => {
    const fetchFn: FetchFn = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ wrong: "shape" }),
        text: async () => '{"wrong":"shape"}',
      });
    const { logger, warns } = makeLogger();
    const events = await fetchPostHogEvents(
      baseConfig,
      {},
      { fetchFn, logger },
    );
    assert.deepEqual(events, []);
    assert.equal(warns.length, 1);
    assert.ok(warns[0]?.includes("results-array"));
  });

  it("limit clampes til hard-cap (200)", async () => {
    let capturedUrl = "";
    const fetchFn: FetchFn = (input) => {
      capturedUrl = input;
      return mockOkResponse([]);
    };
    const { logger } = makeLogger();
    await fetchPostHogEvents(baseConfig, { limit: 9999 }, { fetchFn, logger });
    assert.ok(capturedUrl.includes("limit=200"));
  });

  it("hopper over events uten id eller event", () => {
    const out = __TEST_ONLY__.parsePostHogEvents(
      {
        results: [
          { id: "1", event: "ok", properties: {} },
          { event: "missing-id" },
          { id: "2" }, // missing event
          { id: "3", event: "ok2", properties: { foo: "bar" } },
        ],
      },
      { warn: () => {} },
    );
    assert.equal(out.length, 2);
    assert.equal(out[0]?.id, "1");
    assert.equal(out[1]?.id, "3");
  });
});

describe("buildPostHogFetcherConfigFromEnv", () => {
  it("returnerer null når POSTHOG_PERSONAL_API_KEY mangler", () => {
    const cfg = buildPostHogFetcherConfigFromEnv({
      POSTHOG_PROJECT_ID: "1",
    });
    assert.equal(cfg, null);
  });

  it("returnerer null når POSTHOG_PROJECT_ID mangler eller er ikke-numerisk", () => {
    const cfgA = buildPostHogFetcherConfigFromEnv({
      POSTHOG_PERSONAL_API_KEY: "phx_abc",
    });
    assert.equal(cfgA, null);
    const cfgB = buildPostHogFetcherConfigFromEnv({
      POSTHOG_PERSONAL_API_KEY: "phx_abc",
      POSTHOG_PROJECT_ID: "notanumber",
    });
    assert.equal(cfgB, null);
  });

  it("default host = eu.posthog.com når env mangler", () => {
    const cfg = buildPostHogFetcherConfigFromEnv({
      POSTHOG_PERSONAL_API_KEY: "phx_abc",
      POSTHOG_PROJECT_ID: "178713",
    });
    assert.equal(cfg?.host, "https://eu.posthog.com");
    assert.equal(cfg?.projectId, 178713);
  });

  it("respekterer custom POSTHOG_HOST", () => {
    const cfg = buildPostHogFetcherConfigFromEnv({
      POSTHOG_PERSONAL_API_KEY: "phx_abc",
      POSTHOG_PROJECT_ID: "1",
      POSTHOG_HOST: "https://us.posthog.com",
    });
    assert.equal(cfg?.host, "https://us.posthog.com");
  });
});

describe("buildPostHogEventsLink", () => {
  it("bygger link uten distinctId", () => {
    const link = buildPostHogEventsLink({
      host: "https://eu.posthog.com",
      projectId: 178713,
    });
    assert.equal(link, "https://eu.posthog.com/project/178713/events");
  });

  it("bygger link med distinctId", () => {
    const link = buildPostHogEventsLink(
      { host: "https://eu.posthog.com", projectId: 178713 },
      { distinctId: "user-1" },
    );
    assert.ok(link.includes("eventFilter=distinct_id=user-1"));
  });

  it("trimmer trailing slash i host", () => {
    const link = buildPostHogEventsLink({
      host: "https://eu.posthog.com/",
      projectId: 1,
    });
    assert.equal(link, "https://eu.posthog.com/project/1/events");
  });
});
