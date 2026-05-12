/**
 * 2026-05-12 (Tobias-direktiv) — Debug event-log collector.
 *
 * Bakgrunn:
 *   PR #1263 lar Tobias dumpe en JSON-fil via "Dump diagnose"-knapp.
 *   Det funker, men krever manuell handling og kommer i etterkant.
 *
 *   Per Tobias 2026-05-12: events skal auto-streames til backend slik at
 *   en live-monitoring-agent kan lese dem mens Tobias tester. Ingen
 *   manuell "Dump diagnose"-knapp i happy-path — knappen er nå fallback.
 *
 * Endepunkter:
 *   - POST /api/_dev/debug/events?token=<TOKEN> — append batch til JSONL
 *   - GET  /api/_dev/debug/events/tail?token=<TOKEN>&since=<ms> — agent-polling
 *
 * Format på fil:
 *   /tmp/spillorama-debug-events.jsonl
 *   Én linje per event, JSON-encoded. Hver linje:
 *     {...trackedEvent, sessionContext: {...}, receivedAt: <ms>}
 *
 * Rotering:
 *   Hvis fila > 50 MB → roter til `.1.jsonl` og start frisk.
 *   Vi sjekker størrelsen før HVERT skriv (billig fs.stat, ikke et issue
 *   selv ved 100 req/sek på single instans).
 *
 * Sikkerhet:
 *   - Token-gating samme som /api/_dev/game2-state
 *   - Mountes BAK rate-limit-middleware, men /api/_dev/ matcher /api/ tier
 *     (1000/min/IP) som er rikelig for debug-stream (30 req/min per spiller
 *     ved 2s flush-interval).
 *   - Localhost-bypass i httpRateLimit.ts gjør at dev-instanser aldri kan
 *     rate-limite seg selv.
 *
 * Personvern:
 *   - Events er allerede sanitized klient-side (EventTracker.sanitizePayload).
 *   - Vi skriver IKKE rå tokens, passord eller PII.
 *   - Fil er på /tmp og overlever ikke server-restart — det er bevisst,
 *     debug-events skal ikke lagres permanent.
 *
 * Performance:
 *   - Append-only fs.appendFile (ikke fs.writeFile som overwriter).
 *   - Synchronous fs.statSync for size-sjekk er OK fordi vi alle har en
 *     SSD og <1ms latency per stat. Ved 30 req/min per spiller × 100
 *     spillere = 50 req/sek totalt, det er fortsatt < 100ms IO på SSD.
 */

import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";

/** Default lokasjon for event-log-fila. Tester kan overstyre via `opts.logPath`. */
const DEFAULT_LOG_PATH = "/tmp/spillorama-debug-events.jsonl";

/** Max størrelse i bytes før vi roterer til `.1.jsonl`. Default 50 MB. */
const DEFAULT_MAX_LOG_BYTES = 50 * 1024 * 1024;

/** Max antall events per POST. Beskytter mot oversize payloads. */
const MAX_EVENTS_PER_BATCH = 500;

/** Max antall linjer GET-tail returnerer. Beskytter mot OOM ved store filer. */
const MAX_TAIL_LINES = 1000;

export interface DevDebugEventLogRouterOptions {
  /** Path til log-fila. Default `/tmp/spillorama-debug-events.jsonl`. */
  logPath?: string;
  /** Max bytes før rotering. Default 50 MB. */
  maxLogBytes?: number;
  /**
   * Override clock for tester (millisekunder). Default: `Date.now`.
   */
  now?: () => number;
}

interface PostBody {
  events?: unknown;
  sessionContext?: unknown;
}

/**
 * Hent token fra query-string (`?token=...`) ELLER body (`{token: "..."}`).
 * Klienten sender via query for konsistens med eksisterende /api/_dev/-ruter.
 */
function extractToken(req: express.Request): string {
  const q = typeof req.query.token === "string" ? req.query.token.trim() : "";
  if (q) return q;
  const b =
    typeof (req.body as PostBody | undefined)?.events === "object" &&
    typeof (req.body as { token?: unknown })?.token === "string"
      ? ((req.body as { token: string }).token as string).trim()
      : "";
  return b;
}

function checkToken(req: express.Request, res: express.Response): boolean {
  const expected = (process.env.RESET_TEST_PLAYERS_TOKEN ?? "").trim();
  if (!expected) {
    res.status(503).json({
      ok: false,
      error: {
        code: "DEV_TOKEN_NOT_CONFIGURED",
        message:
          "RESET_TEST_PLAYERS_TOKEN er ikke satt i env — debug-event-log disabled.",
      },
    });
    return false;
  }
  const provided = extractToken(req);
  if (!provided) {
    res.status(401).json({
      ok: false,
      error: {
        code: "TOKEN_REQUIRED",
        message: "Mangler ?token-query eller body.token.",
      },
    });
    return false;
  }
  if (provided !== expected) {
    res.status(403).json({
      ok: false,
      error: { code: "FORBIDDEN", message: "Invalid token" },
    });
    return false;
  }
  return true;
}

/**
 * Roter log-fila hvis den er over `maxBytes`. Synchronous av samme grunner
 * som over (SSD + < 1ms). `.1.jsonl` overwrites om den finnes — vi beholder
 * kun forrige generasjon, ikke en full sliding-window-historikk. Debug-events
 * er forgjengelige.
 */
function rotateIfNeeded(logPath: string, maxBytes: number): void {
  let size = 0;
  try {
    size = fs.statSync(logPath).size;
  } catch (err) {
    // ENOENT er forventet (første skriv). Ikke logg.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn("[devDebugEventLog] stat feilet:", err);
    }
    return;
  }
  if (size < maxBytes) return;
  const rotated = `${logPath}.1`;
  try {
    fs.renameSync(logPath, rotated);
  } catch (err) {
    console.warn("[devDebugEventLog] rotate feilet:", err);
  }
}

/**
 * Lag mappe for log-fila hvis den ikke finnes. /tmp er alltid mountet, men
 * tester bruker tmp-paths som krever mkdir.
 */
function ensureLogDir(logPath: string): void {
  const dir = path.dirname(logPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") {
      console.warn("[devDebugEventLog] mkdir feilet:", err);
    }
  }
}

/**
 * Skriv event-batch til fil. Hver event blir én JSON-linje med `sessionContext`
 * og `receivedAt` merget inn. Tom batch er no-op.
 */
function appendBatchToLog(
  logPath: string,
  events: unknown[],
  sessionContext: unknown,
  receivedAt: number,
): void {
  if (events.length === 0) return;
  ensureLogDir(logPath);
  const lines: string[] = [];
  for (const event of events) {
    if (typeof event !== "object" || event === null) {
      // Hopp over ikke-objekt-events stille (klienten skal aldri sende
      // dette, men vi vil ikke krasje på defekt input).
      continue;
    }
    try {
      const merged = {
        ...(event as Record<string, unknown>),
        sessionContext,
        receivedAt,
      };
      lines.push(JSON.stringify(merged));
    } catch (err) {
      // Sirkulær referanse eller utypisk verdi — log og fortsett.
      console.warn("[devDebugEventLog] JSON.stringify feilet:", err);
    }
  }
  if (lines.length === 0) return;
  // appendFileSync er forsvarlig her — payload er < 1 MB og SSD-IO < 5 ms.
  // Hvis vi ser performance-issues, bytt til async fs.promises.appendFile.
  try {
    fs.appendFileSync(logPath, lines.join("\n") + "\n", { encoding: "utf8" });
  } catch (err) {
    console.warn("[devDebugEventLog] append feilet:", err);
  }
}

/**
 * Tail-funksjon for agent-polling. Returnerer events fra fila med
 * `receivedAt > since`. Maks `MAX_TAIL_LINES` per call.
 *
 * Implementasjon:
 *   - Les hele fila inn i memory (typisk < 10 MB, OK på server med 2 GB RAM).
 *   - Filter på `receivedAt > since`.
 *   - Slice til siste N hvis filtrert-listen er for stor.
 *
 * NB: Hvis filan er stor og since er lavt, kan vi lese mye. For pilot
 * (1500 spillere × 30 events/min × 2s × 8t = ~ihverdens-store filer)
 * akseptabelt. Optimaliser med byte-offset-cursor hvis det blir et problem.
 */
function tailLog(
  logPath: string,
  since: number,
): { events: Array<Record<string, unknown>>; lastReceivedAt: number | null } {
  let content: string;
  try {
    content = fs.readFileSync(logPath, { encoding: "utf8" });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { events: [], lastReceivedAt: null };
    }
    throw err;
  }
  const lines = content.split("\n").filter((l) => l.length > 0);
  const out: Array<Record<string, unknown>> = [];
  let lastReceivedAt: number | null = null;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const ra = typeof parsed.receivedAt === "number" ? parsed.receivedAt : 0;
      if (ra > since) {
        out.push(parsed);
        if (lastReceivedAt === null || ra > lastReceivedAt) {
          lastReceivedAt = ra;
        }
      }
    } catch {
      // Hopp over ødelagte linjer stille — kan skje hvis vi blir SIGKILL-et
      // midt i en skrivning.
    }
  }
  // Hvis filtrerte > MAX_TAIL_LINES: returner siste N (nyeste).
  if (out.length > MAX_TAIL_LINES) {
    return { events: out.slice(-MAX_TAIL_LINES), lastReceivedAt };
  }
  return { events: out, lastReceivedAt };
}

/**
 * Lag Express-router for debug-event-log. Mounter:
 *   POST /api/_dev/debug/events
 *   GET  /api/_dev/debug/events/tail
 */
export function createDevDebugEventLogRouter(
  opts: DevDebugEventLogRouterOptions = {},
): express.Router {
  const router = express.Router();
  const logPath = opts.logPath ?? DEFAULT_LOG_PATH;
  const maxBytes = opts.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES;
  const now = opts.now ?? Date.now;

  // ── POST /api/_dev/debug/events ─────────────────────────────────────────

  router.post("/api/_dev/debug/events", (req, res) => {
    if (!checkToken(req, res)) return;
    const body = req.body as PostBody | undefined;
    const events = Array.isArray(body?.events) ? body!.events : [];
    if (events.length > MAX_EVENTS_PER_BATCH) {
      res.status(413).json({
        ok: false,
        error: {
          code: "BATCH_TOO_LARGE",
          message: `Max ${MAX_EVENTS_PER_BATCH} events per batch (mottok ${events.length}).`,
        },
      });
      return;
    }
    const sessionContext = body?.sessionContext ?? null;
    const receivedAt = now();
    try {
      rotateIfNeeded(logPath, maxBytes);
      appendBatchToLog(logPath, events, sessionContext, receivedAt);
      res.status(200).json({
        ok: true,
        data: { received: events.length, receivedAt },
      });
    } catch (err) {
      console.warn("[devDebugEventLog] POST feilet:", err);
      res.status(500).json({
        ok: false,
        error: {
          code: "INTERNAL",
          message: String((err as Error).message ?? err),
        },
      });
    }
  });

  // ── GET /api/_dev/debug/events/tail ────────────────────────────────────

  router.get("/api/_dev/debug/events/tail", (req, res) => {
    if (!checkToken(req, res)) return;
    const sinceRaw =
      typeof req.query.since === "string" ? req.query.since.trim() : "";
    const since = sinceRaw ? Number(sinceRaw) : 0;
    if (!Number.isFinite(since) || since < 0) {
      res.status(400).json({
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "?since må være et ikke-negativt heltall (ms epoch).",
        },
      });
      return;
    }
    try {
      const { events, lastReceivedAt } = tailLog(logPath, since);
      res.status(200).json({
        ok: true,
        data: {
          events,
          lastReceivedAt,
          truncatedToMax: events.length === MAX_TAIL_LINES,
        },
      });
    } catch (err) {
      console.warn("[devDebugEventLog] GET tail feilet:", err);
      res.status(500).json({
        ok: false,
        error: {
          code: "INTERNAL",
          message: String((err as Error).message ?? err),
        },
      });
    }
  });

  return router;
}

// Eksport for tester (vi vil teste rotering uten å kjøre hele router).
export const __TEST_ONLY__ = {
  rotateIfNeeded,
  appendBatchToLog,
  tailLog,
  ensureLogDir,
  MAX_EVENTS_PER_BATCH,
  MAX_TAIL_LINES,
};
