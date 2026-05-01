#!/usr/bin/env npx tsx
/**
 * BIN-768: End-to-end smoke-test framework.
 *
 * Scripted smoke-test that walks through the core day-flow against a running
 * backend (typically staging) before each prod-deploy. Manual to invoke; the
 * automated assertions catch regressions in auth, hall-listing, schedule,
 * agent shift, cash-in/out, and settlement.
 *
 * Two phases:
 *   Phase 1 (steg 1-13): Single-hall demo flow (BIN-768).
 *     Single-hall demo (`demo-hall-999`) — admin login, schedule, agent shift,
 *     cash-in/out, settlement. Fully tested without socket.io.
 *
 *   Phase 2 (steg 14-N): Multi-hall pilot flow (Bølge 2 — pilot-readiness).
 *     4-hall demo (`demo-hall-001..004` + `demo-pilot-goh`) — verifies that
 *     all 4 agents can ready their hall, master triggers /start, hall-status
 *     reflects RUNNING, TV voice URLs serve audio, master /stop ends the
 *     round. Auto-skipped if 4-hall seed is not present (no FAIL).
 *
 *   Phase 3 (post-Bølge 2): Socket.IO live-broadcast verification — separate
 *     task. Phase 2 is HTTP-only by design to keep scope manageable.
 *
 * Usage:
 *   npm --prefix apps/backend run smoke-test -- \
 *     --api-base-url=https://staging.spillorama-system.onrender.com \
 *     --admin-email=admin@example.no \
 *     --admin-password='REDACTED' \
 *     --agent-email=agent@example.no \
 *     --agent-password='REDACTED'
 *
 *   # With Phase 2 multi-hall flow (defaults match seed-demo-pilot-day Profile B):
 *   npm --prefix apps/backend run smoke-test -- \
 *     --api-base-url=http://localhost:4000 \
 *     --admin-email=demo-admin@spillorama.no --admin-password='Spillorama123!' \
 *     --agent-email=demo-agent@spillorama.no --agent-password='Spillorama123!'
 *
 *   # Skip Phase 2 explicitly (legacy single-hall behaviour):
 *   npm --prefix apps/backend run smoke-test -- ... --skip-multi-hall
 *
 * Required prerequisites:
 *   1. Demo-seed run on the target environment (`feat/seed-demo-pilot-day`
 *      branch covers schedule + halls + demo-players). Phase 2 additionally
 *      requires the 4-hall variant (`feat/seed-demo-pilot-day-4halls`,
 *      commit fb180ec5) which seeds `demo-hall-001..004` + `demo-pilot-goh`
 *      + `demo-agent-1..4@spillorama.no`.
 *   2. Admin and agent accounts exist with the supplied credentials.
 *   3. Agent must be assigned to at least one hall (so /shift/start succeeds)
 *      AND that hall must have demo-players for /players/lookup.
 *
 * Exit codes:
 *   0 — all steps passed (Phase 2 may have been skipped — that's OK)
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
  // Phase 2 — multi-hall pilot flow.
  skipMultiHall: boolean;
  pilotAgents: PilotAgentArg[];
}

interface PilotAgentArg {
  index: number; // 1..4
  email: string;
  password: string;
}

interface StepResult {
  index: number;
  name: string;
  status: "pass" | "fail" | "skip";
  error?: string;
  durationMs: number;
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

const STEP_RESULTS: StepResult[] = [];

// Phase 2 demo identifiers — must match seed-demo-pilot-day.ts Profile B.
const PILOT_HALL_IDS = [
  "demo-hall-001",
  "demo-hall-002",
  "demo-hall-003",
  "demo-hall-004",
] as const;
const PILOT_MASTER_HALL_ID = "demo-hall-001";
const DEFAULT_PILOT_AGENT_PASSWORD = "Spillorama123!";

const PILOT_AGENT_DEFAULT_EMAILS: Record<number, string> = {
  1: "demo-agent-1@spillorama.no",
  2: "demo-agent-2@spillorama.no",
  3: "demo-agent-3@spillorama.no",
  4: "demo-agent-4@spillorama.no",
};

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
    console.error("");
    console.error("Optional Phase 2 (multi-hall pilot flow) flags:");
    console.error(
      "  --skip-multi-hall                          (skip Phase 2 entirely)\n" +
        "  --pilot-agent-1-email=<e>                  (default: demo-agent-1@spillorama.no)\n" +
        "  --pilot-agent-1-password=<pw>              (default: Spillorama123!)\n" +
        "  --pilot-agent-2-email / -password          (default: demo-agent-2@…)\n" +
        "  --pilot-agent-3-email / -password          (default: demo-agent-3@…)\n" +
        "  --pilot-agent-4-email / -password          (default: demo-agent-4@…)",
    );
    process.exit(1);
  }
  // `--skip-multi-hall` may arrive as `=true|=false` or just bare; treat any
  // presence (incl. `=true`) as truthy and `=false` as explicit opt-in.
  const skipRaw = map.get("skip-multi-hall");
  const skipMultiHall =
    skipRaw !== undefined && skipRaw !== "false" && skipRaw !== "0";
  const pilotAgents: PilotAgentArg[] = [];
  for (let i = 1; i <= 4; i += 1) {
    pilotAgents.push({
      index: i,
      email: map.get(`pilot-agent-${i}-email`) ?? PILOT_AGENT_DEFAULT_EMAILS[i]!,
      password:
        map.get(`pilot-agent-${i}-password`) ?? DEFAULT_PILOT_AGENT_PASSWORD,
    });
  }
  return {
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
    adminEmail,
    adminPassword,
    agentEmail,
    agentPassword,
    skipMultiHall,
    pilotAgents,
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

/**
 * Mark a step as skipped (Phase 2: when 4-hall seed isn't present, or when
 * the user passed `--skip-multi-hall`). Skipped steps don't count toward
 * exit-code 1 — we want the smoke-test to remain green for environments
 * that haven't yet run the 4-hall seed.
 */
function recordSkip(index: number, name: string, reason: string): void {
  console.log(`[SKIP] Step ${index}: ${name} — ${reason}`);
  STEP_RESULTS.push({
    index,
    name,
    status: "skip",
    error: reason,
    durationMs: 0,
  });
}

function logCategory(label: string): void {
  console.log("");
  console.log(`──────── ${label} ────────`);
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

  logCategory("Phase 1: Single-hall demo (steg 1-13)");

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

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 2: Multi-hall pilot flow (Bølge 2 — pilot-readiness).
  //
  // Validates the multi-hall master/follower flow that powers the pilot day:
  //   - 4 agents log in + start shift (one per hall)
  //   - Each agent signals markReady against the active scheduled-game
  //   - Master agent (demo-hall-001) verifies all 4 halls report "ready"
  //   - Master triggers /start; verifies status flips
  //   - TV voice URL serves audio for ball 1 / 30 / 75 (no auth)
  //   - Master /stop ends the round (with refund reason)
  //   - All 4 agents end their shift
  //
  // Auto-detects the 4-hall seed via /api/admin/halls — if `demo-hall-001`
  // is missing, every Phase 2 step is recorded as `skip` and the overall
  // smoke-test stays green. This keeps Phase 1 unchanged for environments
  // that haven't yet run `feat/seed-demo-pilot-day-4halls`.
  //
  // HTTP-only by design: socket-broadcast verification (Phase 3) is a
  // separate task and will live in a sibling script with `socket.io-client`.
  // ─────────────────────────────────────────────────────────────────────────

  logCategory("Phase 2: Multi-hall pilot flow (steg 14-22)");

  if (args.skipMultiHall) {
    recordSkip(
      14,
      "Multi-hall pilot flow",
      "--skip-multi-hall flag set; Phase 2 skipped",
    );
    finalizeAndExit();
    return;
  }

  // ── Step 14: Detect 4-hall seed ────────────────────────────────────────
  // Lookup `demo-hall-001` via the admin halls listing. If absent, all
  // subsequent Phase 2 steps are recorded as `skip` (NOT fail) so a single-
  // hall seed environment stays green.
  let pilotSeedPresent = false;
  await runStep(14, "Detect 4-hall pilot seed", async () => {
    if (!adminToken) {
      throw new Error("skipped (admin login failed)");
    }
    const res = await callApi<
      Array<{ id: string; name: string; isActive?: boolean }>
    >(args.apiBaseUrl, "GET", "/api/admin/halls", { token: adminToken });
    expectOk(res, "GET /api/admin/halls (Phase 2 detection)");
    const have = new Set(res.data.map((h) => h.id));
    const missing = PILOT_HALL_IDS.filter((id) => !have.has(id));
    if (missing.length > 0) {
      // Distinguishable error message — runStep marks this as fail, but the
      // outer code reads STEP_RESULTS to convert into skips for steg 15+.
      throw new Error(
        `4-hall pilot seed not present (missing: ${missing.join(", ")}) — ` +
          `run \`tsx apps/backend/scripts/seed-demo-pilot-day.ts\` from the ` +
          `feat/seed-demo-pilot-day-4halls branch first to enable Phase 2.`,
      );
    }
    pilotSeedPresent = true;
  });

  if (!pilotSeedPresent) {
    // Convert the failed detect-step into a skip for visibility, and skip
    // the rest of Phase 2 with the same message.
    const detectFailure = STEP_RESULTS[STEP_RESULTS.length - 1];
    if (detectFailure && detectFailure.status === "fail") {
      detectFailure.status = "skip";
      console.log(
        `       (downgrading Step 14 from FAIL→SKIP: 4-hall seed absent ` +
          `is the expected single-hall environment shape)`,
      );
    }
    const reason =
      detectFailure?.error ?? "4-hall pilot seed not detected";
    for (let i = 15; i <= 22; i += 1) {
      recordSkip(i, `Phase 2 step ${i}`, reason);
    }
    finalizeAndExit();
    return;
  }

  // Phase 2 shared state.
  const pilotAgentTokens = new Map<number, string>(); // agent index → token
  const pilotShiftActive = new Set<number>(); // agent indices with open shift
  let pilotGameId: string | undefined;
  let pilotMasterAgentToken: string | undefined;

  // ── Step 15: 4 pilot agents — login + shift start ──────────────────────
  await runStep(15, "Pilot agents login + shift start (4 parallel)", async () => {
    const results = await Promise.all(
      args.pilotAgents.map(async (agent) => {
        // Login
        const loginRes = await callApi<{
          accessToken: string;
          agent?: {
            halls?: Array<{ hallId: string; isPrimary?: boolean }>;
          };
        }>(args.apiBaseUrl, "POST", "/api/agent/auth/login", {
          body: { email: agent.email, password: agent.password },
        });
        if (!loginRes.ok) {
          return {
            agent,
            ok: false as const,
            error: `login: ${loginRes.error.code} — ${loginRes.error.message}`,
          };
        }
        const token = loginRes.data.accessToken;
        if (!token) {
          return {
            agent,
            ok: false as const,
            error: "login response missing accessToken",
          };
        }
        // Resolve primary hall — must be `demo-hall-00<index>`.
        const halls = loginRes.data.agent?.halls ?? [];
        const primary = halls.find((h) => h.isPrimary) ?? halls[0];
        const expectedHallId = `demo-hall-${String(agent.index).padStart(3, "0")}`;
        if (!primary?.hallId) {
          return {
            agent,
            ok: false as const,
            error: `agent ${agent.index} has no hall assignment`,
          };
        }
        if (primary.hallId !== expectedHallId) {
          return {
            agent,
            ok: false as const,
            error: `agent ${agent.index} primary hall ${primary.hallId} != expected ${expectedHallId}`,
          };
        }
        // Start shift — tolerate SHIFT_ALREADY_ACTIVE (idempotent).
        const shiftRes = await callApi<{ id: string; isActive: boolean }>(
          args.apiBaseUrl,
          "POST",
          "/api/agent/shift/start",
          { token, body: { hallId: expectedHallId } },
        );
        if (!shiftRes.ok && shiftRes.error.code !== "SHIFT_ALREADY_ACTIVE") {
          return {
            agent,
            ok: false as const,
            error: `shift/start: ${shiftRes.error.code} — ${shiftRes.error.message}`,
          };
        }
        return {
          agent,
          ok: true as const,
          token,
          hallId: expectedHallId,
        };
      }),
    );
    const failures = results.filter((r) => !r.ok);
    if (failures.length > 0) {
      throw new Error(
        `${failures.length} agent(s) failed: ` +
          failures
            .map((f) => `[${f.agent.index}:${f.agent.email}] ${"error" in f ? f.error : "?"}`)
            .join("; "),
      );
    }
    for (const r of results) {
      if (r.ok) {
        pilotAgentTokens.set(r.agent.index, r.token);
        pilotShiftActive.add(r.agent.index);
      }
    }
    pilotMasterAgentToken = pilotAgentTokens.get(1);
    if (!pilotMasterAgentToken) {
      throw new Error("Master agent (index 1) token missing after login");
    }
  });

  // ── Step 16: Resolve active scheduled-game for the pilot group ─────────
  // Uses the agent route /api/agent/game1/current-game from the master's
  // perspective. Returns null if no active game — in that case Phase 2
  // skips the start/stop dance with a clear message.
  await runStep(16, "Resolve active pilot scheduled-game", async () => {
    if (!pilotMasterAgentToken) {
      throw new Error("skipped (pilot agents login failed)");
    }
    const res = await callApi<{
      hallId: string;
      isMasterAgent: boolean;
      currentGame: {
        id: string;
        status: string;
        masterHallId: string;
        participatingHallIds: string[];
      } | null;
    }>(args.apiBaseUrl, "GET", "/api/agent/game1/current-game", {
      token: pilotMasterAgentToken,
    });
    expectOk(res, "GET /api/agent/game1/current-game");
    if (!res.data.currentGame) {
      throw new Error(
        "No active scheduled-game for demo-pilot-goh — verify the seed " +
          "created today's `app_game1_scheduled_games` row in status " +
          "`purchase_open` or `ready_to_start`.",
      );
    }
    if (res.data.currentGame.masterHallId !== PILOT_MASTER_HALL_ID) {
      throw new Error(
        `Active game master_hall_id=${res.data.currentGame.masterHallId} ` +
          `!= expected ${PILOT_MASTER_HALL_ID}`,
      );
    }
    if (!res.data.isMasterAgent) {
      throw new Error(
        "Agent 1 (demo-agent-1) is not flagged as master — check agent's hallId",
      );
    }
    pilotGameId = res.data.currentGame.id;
    console.log(
      `       (active game ${pilotGameId}, status=${res.data.currentGame.status}, ` +
        `participants=${res.data.currentGame.participatingHallIds.length})`,
    );
  });

  // ── Step 17: All 4 agents markReady their hall ─────────────────────────
  // Idempotent: backend already returns success when a hall is already
  // ready, so re-runs are safe.
  await runStep(17, "All 4 halls markReady (parallel)", async () => {
    if (!pilotGameId) throw new Error("skipped (no active game)");
    const results = await Promise.all(
      args.pilotAgents.map(async (agent) => {
        const token = pilotAgentTokens.get(agent.index);
        if (!token) {
          return { agent, ok: false as const, error: "no token" };
        }
        const hallId = `demo-hall-${String(agent.index).padStart(3, "0")}`;
        const res = await callApi<{
          gameId: string;
          hallId: string;
          isReady: boolean;
          allReady: boolean;
        }>(
          args.apiBaseUrl,
          "POST",
          `/api/admin/game1/halls/${encodeURIComponent(hallId)}/ready`,
          { token, body: { gameId: pilotGameId } },
        );
        if (!res.ok) {
          // Tolerate "already ready" race-style errors for idempotency.
          // The current backend doesn't return a specific code, so accept
          // anything that mentions ALREADY/READY in the code.
          if (/ALREADY|READY/i.test(res.error.code)) {
            return { agent, ok: true as const, isReady: true };
          }
          return {
            agent,
            ok: false as const,
            error: `${res.error.code} — ${res.error.message}`,
          };
        }
        return { agent, ok: true as const, isReady: res.data.isReady };
      }),
    );
    const failures = results.filter((r) => !r.ok);
    if (failures.length > 0) {
      throw new Error(
        `${failures.length} hall(s) failed markReady: ` +
          failures
            .map((f) => `[hall-${f.agent.index}] ${"error" in f ? f.error : "?"}`)
            .join("; "),
      );
    }
  });

  // ── Step 18: Master verifies allReady=true ─────────────────────────────
  await runStep(18, "Master sees all 4 halls ready", async () => {
    if (!pilotMasterAgentToken || !pilotGameId) {
      throw new Error("skipped (prereqs missing)");
    }
    const res = await callApi<{
      halls: Array<{
        hallId: string;
        isReady: boolean;
        excludedFromGame: boolean;
      }>;
      allReady: boolean;
    }>(
      args.apiBaseUrl,
      "GET",
      `/api/admin/game1/games/${encodeURIComponent(pilotGameId)}/ready-status`,
      { token: pilotMasterAgentToken },
    );
    expectOk(res, "GET /ready-status");
    const participating = res.data.halls.filter((h) => !h.excludedFromGame);
    const notReady = participating.filter((h) => !h.isReady);
    if (notReady.length > 0) {
      throw new Error(
        `Halls still not ready: ${notReady.map((h) => h.hallId).join(", ")}`,
      );
    }
    if (!res.data.allReady) {
      throw new Error("allReady=false despite no per-hall not-ready row");
    }
  });

  // ── Step 19: Master triggers /start ────────────────────────────────────
  // Uses the agent-scoped route so we exercise the same path the bingovert
  // UI uses. Tolerate ALREADY_RUNNING for idempotency.
  let startedAt: string | undefined;
  await runStep(19, "Master /start triggers RUNNING", async () => {
    if (!pilotMasterAgentToken || !pilotGameId) {
      throw new Error("skipped (prereqs missing)");
    }
    const res = await callApi<{
      gameId: string;
      status: string;
      actualStartTime: string | null;
    }>(args.apiBaseUrl, "POST", "/api/agent/game1/start", {
      token: pilotMasterAgentToken,
      body: {},
    });
    if (!res.ok) {
      // Idempotency: a previous run may have left status=running. Detect by
      // re-fetching current-game.
      if (
        res.error.code === "INVALID_STATE" ||
        res.error.code === "ALREADY_RUNNING" ||
        /already|running/i.test(res.error.message)
      ) {
        const fresh = await callApi<{
          currentGame: { id: string; status: string } | null;
        }>(args.apiBaseUrl, "GET", "/api/agent/game1/current-game", {
          token: pilotMasterAgentToken,
        });
        if (
          fresh.ok &&
          fresh.data.currentGame &&
          (fresh.data.currentGame.status === "running" ||
            fresh.data.currentGame.status === "paused")
        ) {
          console.log(
            `       (idempotent: game already ${fresh.data.currentGame.status})`,
          );
          startedAt = "(unchanged)";
          return;
        }
      }
      throw new Error(`/start: ${res.error.code} — ${res.error.message}`);
    }
    if (res.data.status !== "running" && res.data.status !== "paused") {
      throw new Error(
        `Expected status=running after /start, got ${res.data.status}`,
      );
    }
    startedAt = res.data.actualStartTime ?? "(no time)";
  });

  // ── Step 20: TV voice URLs serve audio (no auth) ───────────────────────
  // Validates that the public TV-voice asset endpoint serves bytes for the
  // boundary cases (1, 30, 75). Norwegian male voice (voice1) is the
  // default; the URL accepts `.mp3` even though backend stores `.ogg` —
  // the route serves ogg-bytes under `audio/ogg` content-type either way.
  await runStep(20, "TV voice URLs serve ball 1/30/75", async () => {
    const balls = [1, 30, 75];
    const results = await Promise.all(
      balls.map(async (ball) => {
        const url = `${args.apiBaseUrl}/tv-voices/voice1/${ball}.mp3`;
        try {
          const res = await fetch(url, { method: "GET" });
          if (res.status !== 200) {
            return { ball, ok: false, status: res.status };
          }
          const ctype = res.headers.get("content-type") ?? "";
          if (!ctype.includes("audio/")) {
            return { ball, ok: false, status: res.status, ctype };
          }
          // Drain body so the connection is closed cleanly.
          await res.arrayBuffer();
          return { ball, ok: true, status: res.status, ctype };
        } catch (err) {
          return {
            ball,
            ok: false,
            status: -1,
            err: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    const failures = results.filter((r) => !r.ok);
    if (failures.length > 0) {
      throw new Error(
        `TV voice URLs failed: ` +
          failures
            .map(
              (f) =>
                `ball=${f.ball} status=${f.status}` +
                ("ctype" in f && f.ctype ? ` ctype=${f.ctype}` : "") +
                ("err" in f && f.err ? ` err=${f.err}` : ""),
            )
            .join("; "),
      );
    }
  });

  // ── Step 21: Master /stop with refund reason ───────────────────────────
  // Uses the admin route (the agent-route doesn't expose /stop yet — only
  // /start and /resume). ADMIN-token is acceptable per route spec.
  await runStep(21, "Master /stop ends the round", async () => {
    if (!adminToken || !pilotGameId) {
      throw new Error("skipped (prereqs missing)");
    }
    const res = await callApi<{ gameId: string; status: string }>(
      args.apiBaseUrl,
      "POST",
      `/api/admin/game1/games/${encodeURIComponent(pilotGameId)}/stop`,
      {
        token: adminToken,
        body: { reason: "BIN-768 Phase 2 smoke-test stop with refund" },
      },
    );
    if (!res.ok) {
      // Idempotency: completed/cancelled games can't be stopped again.
      if (
        res.error.code === "INVALID_STATE" ||
        /already|cancel|complet/i.test(res.error.message)
      ) {
        console.log(`       (idempotent: ${res.error.code} — already stopped)`);
        return;
      }
      throw new Error(`/stop: ${res.error.code} — ${res.error.message}`);
    }
    if (
      res.data.status !== "cancelled" &&
      res.data.status !== "completed" &&
      res.data.status !== "stopped"
    ) {
      throw new Error(
        `Expected status to indicate ended round, got ${res.data.status}`,
      );
    }
  });

  // ── Step 22: All 4 pilot agents end shift ──────────────────────────────
  await runStep(22, "Pilot agents shift end (4 parallel)", async () => {
    const results = await Promise.all(
      args.pilotAgents.map(async (agent) => {
        const token = pilotAgentTokens.get(agent.index);
        if (!token) {
          return { agent, ok: true, note: "no token" };
        }
        const res = await callApi<{ isActive: boolean }>(
          args.apiBaseUrl,
          "POST",
          "/api/agent/shift/end",
          { token },
        );
        if (!res.ok && res.error.code !== "NO_ACTIVE_SHIFT") {
          return {
            agent,
            ok: false,
            error: `${res.error.code} — ${res.error.message}`,
          };
        }
        return { agent, ok: true };
      }),
    );
    const failures = results.filter((r) => !r.ok);
    if (failures.length > 0) {
      throw new Error(
        `${failures.length} agent(s) failed shift/end: ` +
          failures
            .map((f) => `[${f.agent.index}] ${"error" in f ? f.error : "?"}`)
            .join("; "),
      );
    }
  });

  finalizeAndExit();
}

/**
 * Print the summary block, set the exit code, and exit. Extracted from
 * `main()` so Phase 2 can short-circuit with the same summary handling
 * regardless of whether it ran or skipped.
 */
function finalizeAndExit(): never {
  console.log("");
  const passed = STEP_RESULTS.filter((s) => s.status === "pass").length;
  const skipped = STEP_RESULTS.filter((s) => s.status === "skip").length;
  const failed = STEP_RESULTS.filter((s) => s.status === "fail").length;
  console.log(
    `[smoke-test] ${passed} passed, ${failed} failed, ${skipped} skipped ` +
      `(of ${STEP_RESULTS.length} total)`,
  );
  if (failed > 0) {
    console.log("");
    console.log("Failed steps:");
    for (const s of STEP_RESULTS.filter((s) => s.status === "fail")) {
      console.log(`  - Step ${s.index}: ${s.name} — ${s.error ?? "(no detail)"}`);
    }
    process.exit(1);
  }
  if (skipped > 0) {
    console.log("");
    console.log("Skipped steps (these don't fail the run):");
    for (const s of STEP_RESULTS.filter((s) => s.status === "skip")) {
      console.log(`  - Step ${s.index}: ${s.name} — ${s.error ?? "(no detail)"}`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  // Defensive: any uncaught error (network outage, malformed env, etc.) ends
  // the run with exit code 1 so CI notices.
  console.error("[smoke-test] uncaught error:", err);
  process.exit(1);
});
