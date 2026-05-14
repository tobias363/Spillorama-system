#!/usr/bin/env npx tsx
/**
 * Synthetic Spill 1 bingo-round-test — the bot.
 *
 * Drives an end-to-end bingo round against a running Spillorama backend
 * and evaluates the six pilot-go-live invariants (I1-I6, defined in
 * `./invariants.ts` and `docs/operations/SYNTHETIC_BINGO_TEST_RUNBOOK.md`).
 *
 * High-level flow (default --mode=local):
 *
 *   1. Reset demo-players + verify backend health (pre-flight).
 *   2. Master-bot logs in (`demo-agent-1@spillorama.no`) and calls
 *      `POST /api/agent/game1/master/start` to spawn a new scheduled-
 *      game. Captures `scheduledGameId`.
 *   3. Player-bots (--players=N parallelt) log in as
 *      `demo-pilot-spiller-1..12@example.com` (rotated if N > 12) and
 *      record `balanceBeforeCents` from `/api/wallet/me`.
 *   4. Each player-bot connects via socket.io to `/`, joins the room,
 *      and buys M tickets via REST `POST /api/game1/purchase` with a
 *      generated `clientRequestId` (UUID v4). Idempotency-probe sends
 *      each purchase twice — the second response should have
 *      `alreadyExisted: true`.
 *   5. Engine runs naturally (auto-draw-tick fires draws). Bots record
 *      each `draw:new` and `room:update` event.
 *   6. When `room:update` arrives with `currentGame.status === ENDED`,
 *      or after `--timeout` (default 60s), bots stop listening, capture
 *      `balanceAfterCents`, and run invariant evaluators.
 *   7. Bot fetches `/api/_dev/debug/round-replay/:scheduledGameId` for
 *      authoritative compliance + payout snapshots.
 *   8. Generate a markdown report and exit 0 on PASS, 1 on FAIL.
 *
 * CLI flags:
 *   --players=N             Number of player-bots (default 10, max 12)
 *   --tickets-per-player=M  Tickets each player buys (default 3)
 *   --hall-id=HALL          Hall-id (default demo-hall-001 = master)
 *   --backend-url=URL       Default http://localhost:4000
 *   --master-email=EMAIL    Default demo-agent-1@spillorama.no
 *   --master-password=PASS  Default reads $DEMO_SEED_PASSWORD or Spillorama123!
 *   --reset-token=TOKEN     RESET_TEST_PLAYERS_TOKEN value (optional)
 *   --replay-token=TOKEN    Token for `/api/_dev/debug/round-replay`
 *                            (same value as RESET_TEST_PLAYERS_TOKEN in
 *                            our setup; fallbacks to --reset-token)
 *   --timeout=SECONDS       Round-end wait-timeout (default 60)
 *   --mode=local|ci|dry-run See module doc
 *   --output=FILE           Write markdown report here (default stdout)
 *   --no-socket             Skip socket-connect (purchases only, dev-test)
 *
 * Run mode `--dry-run` does NOT trigger any wallet-mutating call. It
 * pre-flights health-endpoints, logs in as master, but does NOT call
 * `/master/start` or `/game1/purchase`. Used by CI to verify endpoints
 * are reachable without consuming database side-effects.
 *
 * Exit codes:
 *   0  — all invariants PASS (or all PASS + WARN)
 *   1  — at least one invariant FAIL
 *   2  — pre-flight failure (login / backend down / config error)
 *
 * For complete docs: `docs/operations/SYNTHETIC_BINGO_TEST_RUNBOOK.md`.
 */

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { ApiClient, ApiError } from "./api-client.js";
import type { AuthorizedSession, TicketSpecEntry } from "./api-client.js";
import {
  defaultSocketFactory,
  attachObserver,
  joinRoom,
} from "./socket-client.js";
import type {
  SyntheticSocketLike,
  SocketObserver,
  SocketFactory,
} from "./socket-client.js";
import {
  evaluateWalletConservation,
  evaluateComplianceLedger,
  evaluateHashChain,
  evaluateDrawSequence,
  evaluateIdempotency,
  evaluateRoundEndState,
  summarizeInvariants,
} from "./invariants.js";
import type {
  PlayerWalletSnapshot,
  PurchaseRecord,
  PayoutRecord,
  AuditLedgerSnapshot,
  HashChainSnapshot,
  DrawSequenceSnapshot,
  ScheduledGameFinalState,
  InvariantResult,
} from "./invariants.js";

// ── Args / config ──────────────────────────────────────────────────────

export interface BotConfig {
  players: number;
  ticketsPerPlayer: number;
  hallId: string;
  backendUrl: string;
  masterEmail: string;
  masterPassword: string;
  resetToken: string | null;
  replayToken: string | null;
  timeoutMs: number;
  mode: "local" | "ci" | "dry-run";
  noSocket: boolean;
  output: string | null;
}

const DEFAULT_PLAYER_PASSWORD =
  process.env.DEMO_SEED_PASSWORD ?? "Spillorama123!";

const DEFAULT_REPLAY_TOKEN =
  process.env.RESET_TEST_PLAYERS_TOKEN ?? "spillorama-2026-test";

export const DEFAULT_CONFIG: BotConfig = {
  players: 10,
  ticketsPerPlayer: 3,
  hallId: "demo-hall-001",
  backendUrl: "http://localhost:4000",
  masterEmail: "demo-agent-1@spillorama.no",
  masterPassword: DEFAULT_PLAYER_PASSWORD,
  resetToken: null,
  replayToken: null,
  timeoutMs: 60_000,
  mode: "local",
  noSocket: false,
  output: null,
};

export function parseArgs(argv: string[]): BotConfig {
  const cfg: BotConfig = { ...DEFAULT_CONFIG };
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=");
    switch (k) {
      case "players":
        cfg.players = Math.max(1, Math.min(12, Number(v)));
        break;
      case "tickets-per-player":
        cfg.ticketsPerPlayer = Math.max(1, Number(v));
        break;
      case "hall-id":
        cfg.hallId = String(v);
        break;
      case "backend-url":
        cfg.backendUrl = String(v).replace(/\/+$/, "");
        break;
      case "master-email":
        cfg.masterEmail = String(v);
        break;
      case "master-password":
        cfg.masterPassword = String(v);
        break;
      case "reset-token":
        cfg.resetToken = String(v);
        break;
      case "replay-token":
        cfg.replayToken = String(v);
        break;
      case "timeout":
        cfg.timeoutMs = Number(v) * 1000;
        break;
      case "mode":
        if (v === "local" || v === "ci" || v === "dry-run") {
          cfg.mode = v;
        }
        break;
      case "output":
        cfg.output = String(v);
        break;
      case "no-socket":
        cfg.noSocket = true;
        break;
      default:
        // ignore unknown flag
        break;
    }
  }
  // CI mode: shorter timeouts (defaults overridden via flags otherwise)
  if (cfg.mode === "ci" && !argv.some((a) => a.startsWith("--timeout="))) {
    cfg.timeoutMs = 30_000;
  }
  // Replay-token defaults to reset-token, then env var.
  if (cfg.replayToken === null) {
    cfg.replayToken = cfg.resetToken ?? DEFAULT_REPLAY_TOKEN;
  }
  return cfg;
}

// ── Pre-flight ─────────────────────────────────────────────────────────

export interface PreflightResult {
  ok: boolean;
  reason?: string;
}

export async function preflight(
  api: ApiClient,
  cfg: BotConfig
): Promise<PreflightResult> {
  // /health is a public endpoint we expect to return 200.
  try {
    await api.get<unknown>("/health");
  } catch (err) {
    return {
      ok: false,
      reason: `backend health failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Master login
  if (cfg.mode !== "dry-run") {
    try {
      await api.login(cfg.masterEmail, cfg.masterPassword);
    } catch (err) {
      return {
        ok: false,
        reason: `master login failed: ${err instanceof Error ? err.message : String(err)} (try setting DEMO_SEED_PASSWORD or --master-password)`,
      };
    }
  }

  return { ok: true };
}

// ── Per-player session ─────────────────────────────────────────────────

export interface PlayerBotSession {
  index: number;
  email: string;
  session: AuthorizedSession;
  observer: SocketObserver | null;
  balanceBeforeCents: number;
  balanceAfterCents: number;
  purchases: PurchaseRecord[];
}

/**
 * Build the demo-player email for index 0..N-1. Rotates after 12 players
 * since the seed only creates 12 demo-pilot-spillere.
 */
export function playerEmailForIndex(idx: number): string {
  const num = (idx % 12) + 1;
  return `demo-pilot-spiller-${num}@example.com`;
}

/**
 * Login each player in parallel and capture starting balance.
 *
 * Returns an array of `PlayerBotSession` with `balanceBeforeCents` set,
 * `observer = null`, and `purchases = []`. The bot calls
 * `connectPlayerSocket(...)` separately to attach socket listeners.
 */
export async function loginAllPlayers(
  api: ApiClient,
  cfg: BotConfig
): Promise<PlayerBotSession[]> {
  const promises: Promise<PlayerBotSession>[] = [];
  for (let i = 0; i < cfg.players; i++) {
    promises.push(loginOnePlayer(api, i));
  }
  return Promise.all(promises);
}

async function loginOnePlayer(
  api: ApiClient,
  idx: number
): Promise<PlayerBotSession> {
  const email = playerEmailForIndex(idx);
  const session = await api.login(email, DEFAULT_PLAYER_PASSWORD);
  const balance = await api.getWalletMe(session.accessToken);
  return {
    index: idx,
    email,
    session,
    observer: null,
    balanceBeforeCents: balance.balanceCents,
    balanceAfterCents: 0,
    purchases: [],
  };
}

/**
 * Connect a player's socket and attach the observer. Returns the
 * observer so the bot can wait for `gameEnded`.
 */
export async function connectPlayerSocket(
  player: PlayerBotSession,
  cfg: BotConfig,
  factory: SocketFactory = defaultSocketFactory
): Promise<SocketObserver> {
  const socket = factory({
    url: cfg.backendUrl,
    token: player.session.accessToken,
  });
  const observer = attachObserver(socket);
  player.observer = observer;
  // Wait for connect-event before join, then send room:join with timeout.
  await waitForConnect(socket, 5_000);
  const ack = await joinRoom(
    socket,
    {
      // accessToken er PÅKREVD i socket-payload — backend
      // `getAccessTokenFromSocketPayload` krever det selv om handshake-auth
      // også sendes via Authorization-header.
      accessToken: player.session.accessToken,
      roomCode: roomCodeForHall(cfg.hallId),
      gameSlug: "bingo",
      hallId: cfg.hallId,
    },
    5_000
  );
  if (!ack.ok) {
    // Non-fatal: bot continues but logs warning. The purchase-path uses
    // REST not socket, so the round can still complete even if join
    // fails. Players who didn't join won't see draws → I4 will catch.
    process.stderr.write(
      `[player-${player.index + 1}] room:join failed: ${ack.error}\n`
    );
  }
  return observer;
}

function waitForConnect(
  socket: SyntheticSocketLike,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error("connect timeout")), timeoutMs);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on("connect_error", (err: unknown) => {
      clearTimeout(timer);
      reject(
        new Error(
          `connect_error: ${err instanceof Error ? err.message : String(err)}`
        )
      );
    });
  });
}

/**
 * Map hallId → canonical room-code. For Spill 1 (bingo) the room-code
 * is `BINGO1` shared across the hall-group.
 *
 * The canonicalRoomCode helper on the backend (`apps/backend/src/util/
 * canonicalRoomCode.ts`) is the authoritative mapping but is not
 * exposed via the public API; we hard-code the Spill 1 prefix here.
 *
 * NOTE: Spill 1 lobby-room is per-hall in some flows (BIN-822) — the
 * bot should not need to know which form; it sends `hallId` along with
 * `roomCode` and the backend resolves. We use `BINGO1` as the canonical
 * default.
 */
export function roomCodeForHall(_hallId: string): string {
  return "BINGO1";
}

// ── Master-start + purchase flow ───────────────────────────────────────

/**
 * Default ticket-spec used by the bot. 1 white-small at 5 kr each. The
 * backend validates the spec against the scheduled-game's
 * `ticket_config_json`; if the seed varies, the bot will get
 * `INVALID_TICKET_SPEC` and the test will fail with a clear error.
 */
export function defaultTicketSpec(
  ticketCount: number
): TicketSpecEntry[] {
  return [
    {
      color: "white",
      size: "small",
      count: ticketCount,
      priceCentsEach: 500, // 5 kr — billigste bong
    },
  ];
}

/**
 * Buy tickets for all players in parallel. Returns the recorded
 * `PurchaseRecord`-array for invariant evaluation.
 *
 * The bot generates a fresh `clientRequestId` for each (player, batch).
 * If `idempotencyProbe` is true, each purchase is submitted TWICE with
 * the same `clientRequestId`/`idempotencyKey` — the second response
 * should have `alreadyExisted: true`.
 */
export async function buyTicketsAllPlayers(
  api: ApiClient,
  players: PlayerBotSession[],
  cfg: BotConfig,
  scheduledGameId: string,
  options: { idempotencyProbe: boolean }
): Promise<PurchaseRecord[]> {
  const allPurchases: PurchaseRecord[] = [];
  const promises = players.map(async (p) => {
    const ticketSpec = defaultTicketSpec(cfg.ticketsPerPlayer);
    const idempotencyKey = randomUUID();
    const clientRequestId = idempotencyKey;
    const body = {
      scheduledGameId,
      buyerUserId: p.session.userId,
      hallId: cfg.hallId,
      ticketSpec,
      paymentMethod: "digital_wallet" as const,
      idempotencyKey,
    };
    try {
      const first = await api.purchaseTickets(p.session.accessToken, body);
      p.purchases.push({
        userId: p.session.userId,
        walletId: p.session.walletId,
        purchaseId: first.purchaseId,
        totalAmountCents: first.totalAmountCents,
        ticketCount: cfg.ticketsPerPlayer,
        clientRequestId,
        alreadyExisted: first.alreadyExisted,
      });
      if (options.idempotencyProbe) {
        const second = await api.purchaseTickets(p.session.accessToken, body);
        p.purchases.push({
          userId: p.session.userId,
          walletId: p.session.walletId,
          purchaseId: second.purchaseId,
          totalAmountCents: second.totalAmountCents,
          ticketCount: cfg.ticketsPerPlayer,
          clientRequestId,
          alreadyExisted: second.alreadyExisted,
        });
      }
    } catch (err) {
      // Log but don't crash — the bot prefers to continue and let
      // invariant evaluators catch the underlying failure (e.g. INVALID
      // _TICKET_SPEC → I1 wallet-conservation will show no spend).
      process.stderr.write(
        `[player-${p.index + 1}] purchase failed: ${
          err instanceof ApiError ? `${err.code}: ${err.message}` : String(err)
        }\n`
      );
    }
  });
  await Promise.all(promises);
  for (const p of players) allPurchases.push(...p.purchases);
  return allPurchases;
}

// ── Round-end wait + final snapshot ────────────────────────────────────

/**
 * Wait until either:
 *   1. All observers report `gameEnded === true`, or
 *   2. The timeout `cfg.timeoutMs` expires.
 *
 * Returns `{ ended: true, durationMs }` on natural end, or
 * `{ ended: false, durationMs }` on timeout.
 */
export async function waitForRoundEnd(
  observers: SocketObserver[],
  cfg: BotConfig
): Promise<{ ended: boolean; durationMs: number }> {
  const start = Date.now();
  const deadline = start + cfg.timeoutMs;
  while (Date.now() < deadline) {
    const ended = observers.every((o) => o.gameEnded);
    if (ended && observers.length > 0) {
      return { ended: true, durationMs: Date.now() - start };
    }
    await sleep(500);
  }
  return { ended: false, durationMs: Date.now() - start };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Replay-API snapshot fetcher ────────────────────────────────────────

interface ReplaySummaryShape {
  data: {
    summary: {
      purchases: { totalCount: number; totalCents: number };
      draws: { total: number };
      winners: Array<{
        prizeCents: number;
        phase: number;
        ticketColor: string;
        winnerUserId: string;
      }>;
      compliance: {
        ledgerEntries: number;
        outboxPending: number;
        outboxProcessed: number;
        auditEvents: number;
      };
    };
    metadata: {
      finalStatus: string;
      drawsTotal: number;
    };
  };
}

/**
 * Fetch the round-replay-summary via the dev-endpoint. This is the
 * authoritative source for compliance-ledger counts + payouts +
 * final scheduled-game-state.
 *
 * If the token is invalid or the endpoint returns 503 (not configured),
 * return null and the bot will mark I2/I6 as WARN.
 */
export async function fetchReplaySummary(
  api: ApiClient,
  scheduledGameId: string,
  token: string | null
): Promise<{
  ledger: AuditLedgerSnapshot;
  payouts: PayoutRecord[];
  scheduledGame: ScheduledGameFinalState;
} | null> {
  if (!token) return null;
  try {
    const data = await api.get<ReplaySummaryShape["data"]>(
      `/api/_dev/debug/round-replay/${encodeURIComponent(scheduledGameId)}?token=${encodeURIComponent(token)}`
    );
    return {
      ledger: {
        stakeEntries: data.summary.purchases.totalCount,
        prizeEntries: data.summary.winners.length,
        houseRetainedEntries: 0,
      },
      payouts: data.summary.winners.map((w) => ({
        userId: w.winnerUserId,
        walletId: "", // not exposed by replay-API; not needed for I1
        amountCents: w.prizeCents,
        phase: String(w.phase),
        patternName: w.ticketColor,
      })),
      scheduledGame: {
        scheduledGameId,
        status: data.metadata.finalStatus,
        drawsTotal: data.metadata.drawsTotal ?? data.summary.draws.total,
      },
    };
  } catch (err) {
    process.stderr.write(
      `[replay-api] fetch failed (continuing without): ${
        err instanceof Error ? err.message : String(err)
      }\n`
    );
    return null;
  }
}

// ── End-to-end runner ──────────────────────────────────────────────────

export interface RunResult {
  invariants: InvariantResult[];
  report: string;
  exitCode: 0 | 1 | 2;
}

/**
 * Top-level run-function. Composable so unit tests can call sub-steps.
 *
 * In `--mode=dry-run`, the function:
 *   1. Pre-flights `/health`, login (read-only).
 *   2. Skips master-start, purchases, socket-connect.
 *   3. Emits a WARN-heavy report and exits 0.
 *
 * In `--mode=local|ci`, the function executes the full flow.
 */
export async function run(
  cfg: BotConfig,
  api: ApiClient = new ApiClient({ baseUrl: cfg.backendUrl }),
  socketFactory: SocketFactory = defaultSocketFactory
): Promise<RunResult> {
  const start = Date.now();

  // ── 1. Pre-flight ──
  const pre = await preflight(api, cfg);
  if (!pre.ok) {
    const report = renderReport({
      cfg,
      invariants: [],
      preflightReason: pre.reason,
      startedAt: start,
      durationMs: Date.now() - start,
      mode: cfg.mode,
    });
    return { invariants: [], report, exitCode: 2 };
  }

  // ── Dry-run early-exit ──
  if (cfg.mode === "dry-run") {
    const dryInvariants: InvariantResult[] = [
      {
        id: "I1",
        title: "Wallet-konservering",
        verdict: "WARN",
        details: "dry-run: ingen wallet-mutering",
      },
      {
        id: "I2",
        title: "Compliance-ledger entries skrevet",
        verdict: "WARN",
        details: "dry-run: ingen ledger-events",
      },
      {
        id: "I3",
        title: "Hash-chain intakt",
        verdict: "WARN",
        details: "dry-run: ingen hash-chain verifisert",
      },
      {
        id: "I4",
        title: "Draw-sequence consistency",
        verdict: "WARN",
        details: "dry-run: ingen draws observert",
      },
      {
        id: "I5",
        title: "Idempotency",
        verdict: "WARN",
        details: "dry-run: ingen purchases sendt",
      },
      {
        id: "I6",
        title: "Round-end-state",
        verdict: "WARN",
        details: "dry-run: ingen scheduled-game spawnet",
      },
    ];
    const report = renderReport({
      cfg,
      invariants: dryInvariants,
      preflightReason: undefined,
      startedAt: start,
      durationMs: Date.now() - start,
      mode: cfg.mode,
    });
    return { invariants: dryInvariants, report, exitCode: 0 };
  }

  // ── 2. Master logs in + starts round ──
  //
  // KJENT BEGRENSNING (2026-05-14): `master/start` (Bølge 2
  // MasterActionService) går RETT fra `idle` → `ready_to_start` →
  // `running` uten å passere `purchase_open`. Dette er bevisst design —
  // pilot-flyten forventer at spillere har forhåndskjøpt bonger via
  // `bet:arm`-socket-event FØR master kaller start. `Game1ArmedToPurchase-
  // ConversionService.convertArmedToPurchases` konverterer armed-state
  // til faktiske `app_game1_ticket_purchases`-rader i hooket mellom
  // bridge-spawn og engine.startGame.
  //
  // Konsekvens: Synthetic-bot's nåværende HTTP `/api/game1/purchase`-vei
  // (i steg 5) feiler med `PURCHASE_CLOSED_FOR_GAME` fordi status er
  // `running` på tidspunkt purchase forsøkes. For å fikse dette må bot:
  //   1. Bruke socket `bet:arm`-event istedenfor HTTP-purchase
  //   2. Sende bet:arm FØR master/start (mens scheduled-game ikke
  //      eksisterer enda — RoomStateManager holder armed-state per rom)
  //   3. master/start vil da auto-konvertere armed → purchases
  //
  // TODO: refactor synthetic-bot til å matche pilot-flyten via bet:arm.
  // Inntil da rapporterer testen invariants som teknisk korrekte men
  // semantisk tomme (0 purchases, 0 payouts → I1-I5 PASS trivielt, I6
  // FAIL pga timeout). Fix #1 (accessToken i socket-payload) gjelder
  // fortsatt — den lar `room:join` lykkes så observers kan plukke opp
  // draws fra ROM-eventer.
  const master = await api.login(cfg.masterEmail, cfg.masterPassword);
  const startResp = await api.masterStart(master.accessToken, cfg.hallId);
  const scheduledGameId = startResp.scheduledGameId;
  if (!scheduledGameId) {
    const fail: InvariantResult[] = [
      {
        id: "I6",
        title: "Round-end-state",
        verdict: "FAIL",
        details: `master/start returned scheduledGameId=null (warnings=${startResp.inconsistencyWarnings.join(",")})`,
      },
    ];
    return {
      invariants: fail,
      report: renderReport({
        cfg,
        invariants: fail,
        preflightReason: "master/start returned scheduledGameId=null",
        startedAt: start,
        durationMs: Date.now() - start,
        mode: cfg.mode,
      }),
      exitCode: 1,
    };
  }

  // ── 3. Players log in + capture balanceBefore ──
  const players = await loginAllPlayers(api, cfg);

  // ── 4. Connect sockets (unless --no-socket) + join room ──
  const observers: SocketObserver[] = [];
  if (!cfg.noSocket) {
    for (const p of players) {
      try {
        const obs = await connectPlayerSocket(p, cfg, socketFactory);
        observers.push(obs);
      } catch (err) {
        process.stderr.write(
          `[player-${p.index + 1}] socket connect failed: ${
            err instanceof Error ? err.message : String(err)
          }\n`
        );
      }
    }
  }

  // ── 5. Buy tickets + idempotency-probe ──
  const purchases = await buyTicketsAllPlayers(
    api,
    players,
    cfg,
    scheduledGameId,
    { idempotencyProbe: true }
  );

  // ── 6. Wait for round-end ──
  const endResult = cfg.noSocket
    ? { ended: false, durationMs: 0 }
    : await waitForRoundEnd(observers, cfg);

  // ── 7. Capture balanceAfter for each player ──
  for (const p of players) {
    try {
      const after = await api.getWalletMe(p.session.accessToken);
      p.balanceAfterCents = after.balanceCents;
    } catch (err) {
      process.stderr.write(
        `[player-${p.index + 1}] balanceAfter fetch failed: ${
          err instanceof Error ? err.message : String(err)
        }\n`
      );
    }
  }

  // ── 8. Fetch authoritative ledger via replay-API ──
  const replay = await fetchReplaySummary(
    api,
    scheduledGameId,
    cfg.replayToken
  );

  // ── 9. Build invariant inputs + evaluate ──
  const wallets: PlayerWalletSnapshot[] = players.map((p) => ({
    userId: p.session.userId,
    walletId: p.session.walletId,
    email: p.email,
    balanceBeforeCents: p.balanceBeforeCents,
    balanceAfterCents: p.balanceAfterCents,
  }));

  const drawSnapshots: DrawSequenceSnapshot[] = players
    .filter((p) => p.observer !== null)
    .map((p) => ({
      userId: p.session.userId,
      drawnNumbers: p.observer!.drawnNumbers.slice(),
    }));

  const payouts = replay?.payouts ?? [];
  const ledger: AuditLedgerSnapshot = replay?.ledger ?? {
    stakeEntries: 0,
    prizeEntries: 0,
  };
  const scheduledGameFinal: ScheduledGameFinalState | null =
    replay?.scheduledGame ?? null;

  // Hash-chain check: not part of the replay-API surface. We mark as
  // WARN (skipped) — proper verification requires direct DB access via
  // WalletAuditVerifier. Future work.
  const hashChain: HashChainSnapshot = {
    entriesChecked: 0,
    entriesValid: 0,
    mismatches: 0,
    chainOk: null,
  };

  const intentionalDuplicates = purchases.filter(
    (p) => p.alreadyExisted
  ).length;

  const invariants: InvariantResult[] = [
    evaluateWalletConservation({ wallets, purchases, payouts }),
    evaluateComplianceLedger({ purchases, payouts, ledger }),
    evaluateHashChain(hashChain),
    evaluateDrawSequence(drawSnapshots),
    evaluateIdempotency({ purchases, intentionalDuplicates }),
    evaluateRoundEndState(scheduledGameFinal),
  ];

  // ── 10. Cleanup sockets ──
  for (const obs of observers) obs.close();

  // ── 11. Build report + decide exit-code ──
  const summary = summarizeInvariants(invariants);
  const exitCode: 0 | 1 | 2 = summary.fail > 0 ? 1 : 0;
  const report = renderReport({
    cfg,
    invariants,
    preflightReason: endResult.ended
      ? undefined
      : `round-end timeout: ${cfg.timeoutMs}ms elapsed without natural end`,
    startedAt: start,
    durationMs: Date.now() - start,
    mode: cfg.mode,
    extras: {
      scheduledGameId,
      players: players.length,
      observers: observers.length,
      purchases: purchases.length,
      payouts: payouts.length,
      endedNaturally: endResult.ended,
    },
  });

  return { invariants, report, exitCode };
}

// ── Reporting ──────────────────────────────────────────────────────────

export interface RenderReportInput {
  cfg: BotConfig;
  invariants: InvariantResult[];
  preflightReason: string | undefined;
  startedAt: number;
  durationMs: number;
  mode: BotConfig["mode"];
  extras?: Record<string, unknown>;
}

export function renderReport(input: RenderReportInput): string {
  const timestamp = new Date(input.startedAt).toISOString();
  const summary = summarizeInvariants(input.invariants);
  const overall = summary.fail > 0 ? "FAIL" : "PASS";

  const lines: string[] = [];
  lines.push("# Synthetic Spill 1 bingo-round-test — rapport");
  lines.push("");
  lines.push(`**Tidspunkt:** ${timestamp}`);
  lines.push(`**Modus:** ${input.mode}`);
  lines.push(`**Backend:** ${input.cfg.backendUrl}`);
  lines.push(`**Hall:** ${input.cfg.hallId}`);
  lines.push(`**Spillere:** ${input.cfg.players}`);
  lines.push(`**Bonger per spiller:** ${input.cfg.ticketsPerPlayer}`);
  lines.push(`**Varighet:** ${(input.durationMs / 1000).toFixed(1)}s`);
  lines.push(`**Resultat:** ${overall}`);
  lines.push("");
  if (input.preflightReason) {
    lines.push(`**Notat:** ${input.preflightReason}`);
    lines.push("");
  }
  if (input.extras) {
    lines.push("## Sammendrag");
    for (const [k, v] of Object.entries(input.extras)) {
      lines.push(`- ${k}: ${String(v)}`);
    }
    lines.push("");
  }

  lines.push("## Invarianter (I1-I6)");
  lines.push("");
  for (const r of input.invariants) {
    lines.push(`### ${r.id} — ${r.title}: **${r.verdict}**`);
    lines.push(`\`\`\`\n${r.details}\n\`\`\``);
    lines.push("");
  }

  lines.push("## Aggregert");
  lines.push("");
  lines.push(`- PASS: ${summary.pass}`);
  lines.push(`- FAIL: ${summary.fail}`);
  lines.push(`- WARN: ${summary.warn}`);
  lines.push("");
  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(argv: string[]): Promise<number> {
  const cfg = parseArgs(argv);
  const result = await run(cfg);

  if (cfg.output) {
    await writeFile(cfg.output, result.report, "utf-8");
    process.stderr.write(`[synthetic-spill1] report written to ${cfg.output}\n`);
  } else {
    process.stdout.write(result.report);
  }

  return result.exitCode;
}

// Run main when invoked directly (not when imported as module).
// The `import.meta.url`-check matches `tsx scripts/synthetic/...` and
// `node dist/scripts/synthetic/...` invocations.
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("spill1-round-bot.ts") ||
  process.argv[1]?.endsWith("spill1-round-bot.js");

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(
        `[synthetic-spill1] FATAL: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`
      );
      process.exit(2);
    });
}
