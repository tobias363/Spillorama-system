#!/usr/bin/env npx tsx
/**
 * BIN-768: End-to-end smoke-test framework.
 *
 * Scripted smoke-test that walks through the core day-flow against a running
 * backend (typically staging) before each prod-deploy. Manual to invoke; the
 * automated assertions catch regressions in auth, hall-listing, schedule,
 * agent shift, cash-in/out, and settlement.
 *
 * Usage:
 *   npm --prefix apps/backend run smoke-test -- \
 *     --api-base-url=https://staging.spillorama-system.onrender.com \
 *     --admin-email=admin@example.no \
 *     --admin-password='REDACTED' \
 *     --agent-email=agent@example.no \
 *     --agent-password='REDACTED'
 *
 * Required prerequisites:
 *   1. Demo-seed run on the target environment (`feat/seed-demo-pilot-day`
 *      branch covers schedule + halls + demo-players).
 *   2. Admin and agent accounts exist with the supplied credentials.
 *   3. Agent must be assigned to at least one hall (so /shift/start succeeds)
 *      AND that hall must have demo-players for /players/lookup.
 *
 * Exit codes:
 *   0 — all 13 steps passed
 *   1 — at least one step failed (or invalid CLI args)
 *
 * NOTE: This script intentionally has NO compile-step dependency on the
 * backend `src/` (lives outside `tsconfig.rootDir`). It runs via tsx and
 * uses only Node 22 built-ins (`fetch`, `crypto.randomUUID`).
 *
 * Run-book: docs/operations/E2E_SMOKE_TEST.md
 */

import { randomUUID } from "node:crypto";

interface CliArgs {
  apiBaseUrl: string;
  adminEmail: string;
  adminPassword: string;
  agentEmail: string;
  agentPassword: string;
}

interface ApiOk<T> {
  ok: true;
  data: T;
}

interface ApiErr {
  ok: false;
  error: { code: string; message: string };
}

type ApiResponse<T> = ApiOk<T> | ApiErr;

interface StepResult {
  index: number;
  name: string;
  status: "pass" | "fail";
  error?: string;
  durationMs: number;
}

const STEP_RESULTS: StepResult[] = [];

function parseArgs(argv: string[]): CliArgs {
  const map = new Map<string, string>();
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq === -1) {
      map.set(arg.slice(2), "true");
    } else {
      map.set(arg.slice(2, eq), arg.slice(eq + 1));
    }
  }
  const apiBaseUrl = map.get("api-base-url");
  const adminEmail = map.get("admin-email");
  const adminPassword = map.get("admin-password");
  const agentEmail = map.get("agent-email");
  const agentPassword = map.get("agent-password");
  if (!apiBaseUrl || !adminEmail || !adminPassword || !agentEmail || !agentPassword) {
    console.error("Missing required CLI args. Usage:");
    console.error(
      "  npm --prefix apps/backend run smoke-test -- \\\n" +
        "    --api-base-url=<url> \\\n" +
        "    --admin-email=<email> --admin-password=<pw> \\\n" +
        "    --agent-email=<email> --agent-password=<pw>",
    );
    process.exit(1);
  }
  return {
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
    adminEmail,
    adminPassword,
    agentEmail,
    agentPassword,
  };
}

async function callApi<T = unknown>(
  baseUrl: string,
  method: "GET" | "POST",
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  // The backend returns 400 with `{ ok: false, error }` for domain errors;
  // we still want to parse JSON in that case rather than throwing on res.ok.
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new Error(
      `Non-JSON response from ${method} ${path} (HTTP ${res.status}): ` +
        `${res.statusText || "no status text"}`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("ok" in parsed) ||
    typeof (parsed as { ok: unknown }).ok !== "boolean"
  ) {
    throw new Error(
      `Unexpected response shape from ${method} ${path} (HTTP ${res.status}): ` +
        JSON.stringify(parsed).slice(0, 200),
    );
  }
  return parsed as ApiResponse<T>;
}

function expectOk<T>(
  response: ApiResponse<T>,
  context: string,
): asserts response is ApiOk<T> {
  if (!response.ok) {
    throw new Error(
      `${context} returned error: ${response.error.code} — ${response.error.message}`,
    );
  }
}

async function runStep<T>(
  index: number,
  name: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - startedAt;
    console.log(`[OK]  Step ${index}: ${name} (${durationMs} ms)`);
    STEP_RESULTS.push({ index, name, status: "pass", durationMs });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[FAIL] Step ${index}: ${name} — ${message} (${durationMs} ms)`);
    STEP_RESULTS.push({
      index,
      name,
      status: "fail",
      error: message,
      durationMs,
    });
    return undefined;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  console.log(
    `[smoke-test] target=${args.apiBaseUrl} admin=${args.adminEmail} agent=${args.agentEmail}`,
  );
  console.log("");

  // Shared state between steps. Once a prerequisite step fails, downstream
  // steps short-circuit with a clear "skipped (prerequisite failed)" failure
  // rather than crashing on undefined access.
  let adminToken: string | undefined;
  let agentToken: string | undefined;
  let activeShiftHallId: string | undefined;
  let demoPlayerId: string | undefined;
  let demoPlayerBalance: number | undefined;
  let postCashInBalance: number | undefined;

  // ── Step 1: Admin login ────────────────────────────────────────────────
  await runStep(1, "Admin login", async () => {
    const res = await callApi<{ accessToken: string; user?: { id?: string } }>(
      args.apiBaseUrl,
      "POST",
      "/api/admin/auth/login",
      { body: { email: args.adminEmail, password: args.adminPassword } },
    );
    expectOk(res, "Admin login");
    if (!res.data.accessToken) throw new Error("Response missing accessToken");
    adminToken = res.data.accessToken;
  });

  // ── Step 2: List schedules ─────────────────────────────────────────────
  await runStep(2, "List active schedules", async () => {
    if (!adminToken) throw new Error("skipped (admin login failed)");
    const res = await callApi<{
      schedules: Array<{ id: string; status?: string }>;
      count: number;
    }>(args.apiBaseUrl, "GET", "/api/admin/schedules?limit=100", {
      token: adminToken,
    });
    expectOk(res, "GET /api/admin/schedules");
    if (!Array.isArray(res.data.schedules)) {
      throw new Error("Response.data.schedules is not an array");
    }
    if (res.data.schedules.length === 0) {
      throw new Error(
        "No schedules found — run demo-seed (feat/seed-demo-pilot-day) first",
      );
    }
  });

  // ── Step 3: List halls ─────────────────────────────────────────────────
  await runStep(3, "List active halls", async () => {
    if (!adminToken) throw new Error("skipped (admin login failed)");
    const res = await callApi<
      Array<{ id: string; name: string; isActive?: boolean }>
    >(args.apiBaseUrl, "GET", "/api/admin/halls", { token: adminToken });
    expectOk(res, "GET /api/admin/halls");
    if (!Array.isArray(res.data)) {
      throw new Error("Response.data is not an array");
    }
    const active = res.data.filter((h) => h.isActive !== false);
    if (active.length === 0) {
      throw new Error("No active halls found — run seed-halls.ts first");
    }
  });

  // ── Step 4: Agent login ────────────────────────────────────────────────
  await runStep(4, "Agent login", async () => {
    const res = await callApi<{
      accessToken: string;
      agent?: {
        userId?: string;
        halls?: Array<{ hallId: string; isPrimary?: boolean }>;
      };
    }>(args.apiBaseUrl, "POST", "/api/agent/auth/login", {
      body: { email: args.agentEmail, password: args.agentPassword },
    });
    expectOk(res, "Agent login");
    if (!res.data.accessToken) throw new Error("Response missing accessToken");
    agentToken = res.data.accessToken;
    // Prefer primary hall; otherwise first assigned hall.
    const halls = res.data.agent?.halls ?? [];
    const primary = halls.find((h) => h.isPrimary) ?? halls[0];
    if (!primary?.hallId) {
      throw new Error(
        "Agent has no hall assignment — assign a hall before running smoke-test",
      );
    }
    activeShiftHallId = primary.hallId;
  });

  // ── Step 5: Agent shift start ──────────────────────────────────────────
  // Idempotency: if a shift is already active for this agent, the endpoint
  // returns SHIFT_ALREADY_ACTIVE — we tolerate that and treat the shift as
  // ready to use. This makes the smoke-test rerunnable without manual cleanup.
  await runStep(5, "Agent shift start", async () => {
    if (!agentToken) throw new Error("skipped (agent login failed)");
    if (!activeShiftHallId) throw new Error("skipped (no hallId resolved)");
    const res = await callApi<{ id: string; isActive: boolean }>(
      args.apiBaseUrl,
      "POST",
      "/api/agent/shift/start",
      { token: agentToken, body: { hallId: activeShiftHallId } },
    );
    if (res.ok) {
      if (!res.data.isActive) {
        throw new Error("Shift opened but not active");
      }
      return;
    }
    if (res.error.code === "SHIFT_ALREADY_ACTIVE") {
      console.log(
        `       (idempotent: shift already active — continuing with existing shift)`,
      );
      return;
    }
    throw new Error(
      `Shift start failed: ${res.error.code} — ${res.error.message}`,
    );
  });

  // ── Step 6: Player lookup ──────────────────────────────────────────────
  // Demo seed creates players whose displayName / email starts with "demo".
  // We try a couple of common prefixes so the test doesn't break if the
  // seed-team renames their fixtures.
  await runStep(6, "Player lookup (find demo-players)", async () => {
    if (!agentToken) throw new Error("skipped (agent login failed)");
    const candidates = ["demo", "test", "smoke", "spill"];
    let found: { id: string; displayName: string } | undefined;
    let lastError = "";
    for (const query of candidates) {
      const res = await callApi<{
        players: Array<{ id: string; displayName: string }>;
      }>(args.apiBaseUrl, "POST", "/api/agent/players/lookup", {
        token: agentToken,
        body: { query },
      });
      if (!res.ok) {
        lastError = `${res.error.code} — ${res.error.message}`;
        continue;
      }
      if (res.data.players.length > 0) {
        found = res.data.players[0];
        break;
      }
    }
    if (!found) {
      throw new Error(
        `No demo-players found at this hall (tried ${candidates.join(", ")})` +
          (lastError ? `; last API error: ${lastError}` : ""),
      );
    }
    demoPlayerId = found.id;
  });

  // ── Step 7: Read player balance ────────────────────────────────────────
  await runStep(7, "Player balance snapshot", async () => {
    if (!agentToken) throw new Error("skipped (agent login failed)");
    if (!demoPlayerId) throw new Error("skipped (player lookup failed)");
    const res = await callApi<{ walletBalance: number }>(
      args.apiBaseUrl,
      "GET",
      `/api/agent/players/${encodeURIComponent(demoPlayerId)}/balance`,
      { token: agentToken },
    );
    expectOk(res, "GET /api/agent/players/{id}/balance");
    if (typeof res.data.walletBalance !== "number") {
      throw new Error(
        `walletBalance is not a number: ${JSON.stringify(res.data.walletBalance)}`,
      );
    }
    if (res.data.walletBalance <= 0) {
      // Not strictly an error — demo-seed may create empty wallets — but
      // the cash-out step (10) needs balance, so flag it now for clarity.
      console.log(
        `       (note: demo-player has zero balance; cash-out step may fail)`,
      );
    }
    demoPlayerBalance = res.data.walletBalance;
  });

  // ── Step 8: Cash-in 50 NOK to player ───────────────────────────────────
  await runStep(8, "Cash-in 50 NOK (CASH)", async () => {
    if (!agentToken) throw new Error("skipped (agent login failed)");
    if (!demoPlayerId) throw new Error("skipped (player lookup failed)");
    const clientRequestId = `smoke-${randomUUID()}`;
    const res = await callApi<{ afterBalance: number }>(
      args.apiBaseUrl,
      "POST",
      `/api/agent/players/${encodeURIComponent(demoPlayerId)}/cash-in`,
      {
        token: agentToken,
        body: {
          amount: 50,
          paymentMethod: "CASH",
          clientRequestId,
          notes: "BIN-768 smoke-test cash-in",
        },
      },
    );
    expectOk(res, "POST /api/agent/players/{id}/cash-in");
    if (typeof res.data.afterBalance !== "number") {
      throw new Error("afterBalance not in response");
    }
    postCashInBalance = res.data.afterBalance;
  });

  // ── Step 9: Verify post-cash-in balance ────────────────────────────────
  // Two sanity checks: (a) the cash-in response itself reflects +50, and
  // (b) a fresh balance-fetch sees the same number — so we know the write
  // landed (didn't just live in the response object).
  await runStep(9, "Verify balance increased by 50", async () => {
    if (!agentToken) throw new Error("skipped (agent login failed)");
    if (!demoPlayerId) throw new Error("skipped (player lookup failed)");
    if (demoPlayerBalance === undefined || postCashInBalance === undefined) {
      throw new Error("skipped (prior balance read failed)");
    }
    const expected = demoPlayerBalance + 50;
    // The response from cash-in should already match.
    if (Math.abs(postCashInBalance - expected) > 0.01) {
      throw new Error(
        `cash-in.afterBalance=${postCashInBalance} != ${demoPlayerBalance}+50=${expected}`,
      );
    }
    // Re-read to confirm persistence.
    const res = await callApi<{ walletBalance: number }>(
      args.apiBaseUrl,
      "GET",
      `/api/agent/players/${encodeURIComponent(demoPlayerId)}/balance`,
      { token: agentToken },
    );
    expectOk(res, "GET balance after cash-in");
    if (Math.abs(res.data.walletBalance - expected) > 0.01) {
      throw new Error(
        `Re-fetched balance=${res.data.walletBalance} != expected=${expected}`,
      );
    }
  });

  // ── Step 10: Cash-out 25 NOK from player ───────────────────────────────
  await runStep(10, "Cash-out 25 NOK (CASH)", async () => {
    if (!agentToken) throw new Error("skipped (agent login failed)");
    if (!demoPlayerId) throw new Error("skipped (player lookup failed)");
    const clientRequestId = `smoke-${randomUUID()}`;
    const res = await callApi<{ afterBalance: number }>(
      args.apiBaseUrl,
      "POST",
      `/api/agent/players/${encodeURIComponent(demoPlayerId)}/cash-out`,
      {
        token: agentToken,
        body: {
          amount: 25,
          paymentMethod: "CASH",
          clientRequestId,
          notes: "BIN-768 smoke-test cash-out",
        },
      },
    );
    expectOk(res, "POST /api/agent/players/{id}/cash-out");
    if (typeof res.data.afterBalance !== "number") {
      throw new Error("afterBalance not in response");
    }
  });

  // ── Step 11: Control daily balance ─────────────────────────────────────
  // Reports a self-consistent balance (matches what we know was put in) so
  // that the diff is small / OK. We don't actually close the day in step 12.
  await runStep(11, "Control daily balance", async () => {
    if (!agentToken) throw new Error("skipped (agent login failed)");
    // Net: +50 cash-in, -25 cash-out = +25 from prior balance.
    const reported = 25;
    const res = await callApi<{
      severity: string;
      diff: number;
    }>(args.apiBaseUrl, "POST", "/api/agent/shift/control-daily-balance", {
      token: agentToken,
      body: {
        reportedDailyBalance: reported,
        reportedTotalCashBalance: reported,
        notes: "BIN-768 smoke-test control",
      },
    });
    expectOk(res, "POST /api/agent/shift/control-daily-balance");
    if (typeof res.data.severity !== "string") {
      throw new Error("severity missing from response");
    }
  });

  // ── Step 12: Settlement-date info ──────────────────────────────────────
  // We deliberately do NOT call /shift/close-day in the smoke-test — closing
  // the shift would burn the test agent for the day. Instead we hit the
  // read-only /settlement-date endpoint to confirm settlement infra is up.
  await runStep(12, "Settlement-date info (read-only)", async () => {
    if (!agentToken) throw new Error("skipped (agent login failed)");
    const res = await callApi<{
      expectedBusinessDate: string;
      hasPendingPreviousDay: boolean;
    }>(args.apiBaseUrl, "GET", "/api/agent/shift/settlement-date", {
      token: agentToken,
    });
    expectOk(res, "GET /api/agent/shift/settlement-date");
    if (!res.data.expectedBusinessDate) {
      throw new Error("expectedBusinessDate missing from response");
    }
  });

  // ── Step 13: Agent shift end ───────────────────────────────────────────
  await runStep(13, "Agent shift end", async () => {
    if (!agentToken) throw new Error("skipped (agent login failed)");
    const res = await callApi<{ isActive: boolean; isLoggedOut: boolean }>(
      args.apiBaseUrl,
      "POST",
      "/api/agent/shift/end",
      { token: agentToken },
    );
    if (res.ok) {
      if (res.data.isActive) {
        throw new Error("Shift end response says shift is still active");
      }
      return;
    }
    // Idempotency: tolerate NO_ACTIVE_SHIFT in case step 5 was a re-use of
    // an already-active shift that another run had already ended. A failed
    // step-5 leaves us with no active shift either.
    if (res.error.code === "NO_ACTIVE_SHIFT") {
      console.log("       (no active shift to end — likely already ended)");
      return;
    }
    throw new Error(`Shift end failed: ${res.error.code} — ${res.error.message}`);
  });

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log("");
  const passed = STEP_RESULTS.filter((s) => s.status === "pass").length;
  const failed = STEP_RESULTS.length - passed;
  console.log(`[smoke-test] ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("");
    console.log("Failed steps:");
    for (const s of STEP_RESULTS.filter((s) => s.status === "fail")) {
      console.log(`  - Step ${s.index}: ${s.name} — ${s.error ?? "(no detail)"}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  // Defensive: any uncaught error (network outage, malformed env, etc.) ends
  // the run with exit code 1 so CI notices.
  console.error("[smoke-test] uncaught error:", err);
  process.exit(1);
});
