/**
 * BIN-791: Integration tests for public status routes.
 *
 * Dekker:
 *   - GET /api/status (komponent-snapshot, cache-header)
 *   - GET /api/status/uptime (24t bøtter, alle komponenter)
 *   - GET /api/status/incidents (active + recent, fail-open uten DB)
 *   - Ingen auth-header kreves
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createPublicStatusRouter } from "../publicStatus.js";
import {
  StatusService,
  operational,
  degraded,
} from "../../observability/StatusService.js";
import type {
  StatusIncidentService,
  StatusIncident,
} from "../../admin/StatusIncidentService.js";

interface Ctx {
  baseUrl: string;
  close: () => Promise<void>;
}

function makeMockIncidentService(opts: {
  active?: StatusIncident[];
  recent?: StatusIncident[];
}): StatusIncidentService {
  return {
    listActive: async () => opts.active ?? [],
    listRecent: async () => opts.recent ?? [],
    getById: async () => null,
    create: async () => {
      throw new Error("not impl in test");
    },
    update: async () => {
      throw new Error("not impl in test");
    },
    resolve: async () => {
      throw new Error("not impl in test");
    },
  } as unknown as StatusIncidentService;
}

async function startServer(opts: {
  statusService: StatusService;
  incidentService?: StatusIncidentService;
}): Promise<Ctx> {
  const app = express();
  app.use(express.json());
  app.use(
    createPublicStatusRouter({
      statusService: opts.statusService,
      statusIncidentService: opts.incidentService,
    }),
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

test("GET /api/status returns operational snapshot with cache header", async () => {
  const status = new StatusService({
    checks: [
      { component: "api", displayName: "API", check: async () => operational() },
      { component: "db", displayName: "Database", check: async () => operational() },
    ],
  });
  const ctx = await startServer({ statusService: status });
  try {
    const res = await fetch(`${ctx.baseUrl}/api/status`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "public, max-age=30");
    const body = (await res.json()) as { ok: boolean; data: any; error?: any };
    assert.equal(body.ok, true);
    assert.equal(body.data.overall, "operational");
    assert.equal(body.data.components.length, 2);
    assert.equal(body.data.components[0].component, "api");
    assert.equal(body.data.components[0].status, "operational");
  } finally {
    await ctx.close();
  }
});

test("GET /api/status reflects degraded overall when one check is degraded", async () => {
  const status = new StatusService({
    checks: [
      { component: "api", displayName: "API", check: async () => operational() },
      { component: "redis", displayName: "Redis", check: async () => degraded("Latency") },
    ],
  });
  const ctx = await startServer({ statusService: status });
  try {
    const res = await fetch(`${ctx.baseUrl}/api/status`);
    const body = (await res.json()) as { ok: boolean; data: any; error?: any };
    assert.equal(body.data.overall, "degraded");
    const redis = body.data.components.find(
      (c: { component: string }) => c.component === "redis",
    );
    assert.equal(redis.status, "degraded");
    assert.equal(redis.message, "Latency");
  } finally {
    await ctx.close();
  }
});

test("GET /api/status/uptime returns 24 buckets per component", async () => {
  const status = new StatusService({
    checks: [
      { component: "api", displayName: "API", check: async () => operational() },
    ],
  });
  const ctx = await startServer({ statusService: status });
  try {
    const res = await fetch(`${ctx.baseUrl}/api/status/uptime`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; data: any; error?: any };
    assert.equal(body.ok, true);
    assert.equal(body.data.uptime.length, 1);
    assert.equal(body.data.uptime[0].component, "api");
    assert.equal(body.data.uptime[0].buckets.length, 24);
  } finally {
    await ctx.close();
  }
});

test("GET /api/status/incidents returns empty arrays when service is missing", async () => {
  const status = new StatusService({
    checks: [
      { component: "api", displayName: "API", check: async () => operational() },
    ],
  });
  const ctx = await startServer({ statusService: status });
  try {
    const res = await fetch(`${ctx.baseUrl}/api/status/incidents`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; data: any; error?: any };
    assert.equal(body.ok, true);
    assert.deepEqual(body.data.active, []);
    assert.deepEqual(body.data.recent, []);
  } finally {
    await ctx.close();
  }
});

test("GET /api/status/incidents returns active + recent incidents", async () => {
  const incident: StatusIncident = {
    id: "incident-1",
    title: "Spill 1 nede",
    description: "Vi undersøker",
    status: "investigating",
    impact: "major",
    affectedComponents: ["bingo"],
    createdByUserId: "admin-1",
    updatedByUserId: "admin-1",
    createdAt: "2026-04-30T10:00:00Z",
    updatedAt: "2026-04-30T10:00:00Z",
    resolvedAt: null,
  };
  const status = new StatusService({
    checks: [
      { component: "api", displayName: "API", check: async () => operational() },
    ],
  });
  const incidentSvc = makeMockIncidentService({
    active: [incident],
    recent: [incident],
  });
  const ctx = await startServer({ statusService: status, incidentService: incidentSvc });
  try {
    const res = await fetch(`${ctx.baseUrl}/api/status/incidents`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; data: any; error?: any };
    assert.equal(body.data.active.length, 1);
    assert.equal(body.data.active[0].title, "Spill 1 nede");
    assert.equal(body.data.active[0].impact, "major");
    // Internal moderator-fields stripped from public response.
    assert.equal(body.data.active[0].createdByUserId, undefined);
    assert.equal(body.data.recent.length, 1);
  } finally {
    await ctx.close();
  }
});

test("GET /api/status does not require auth", async () => {
  const status = new StatusService({
    checks: [
      { component: "api", displayName: "API", check: async () => operational() },
    ],
  });
  const ctx = await startServer({ statusService: status });
  try {
    // No Authorization header
    const res = await fetch(`${ctx.baseUrl}/api/status`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; data: any; error?: any };
    assert.equal(body.ok, true);
  } finally {
    await ctx.close();
  }
});
