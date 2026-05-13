/**
 * 2026-05-13 (Tobias-direktiv) — Rrweb DOM session-replay collector.
 *
 * Bakgrunn:
 *   PR #1263 (EventTracker) og oppfølgeren (EventStreamer) gir oss
 *   strukturerte data-events ("hva klienten sa på socket/REST"). Det
 *   funker for å forstå state-overganger, men når Tobias eller en
 *   pilot-spiller ser en bug, ønsker vi å avspille NØYAKTIG hva de så
 *   som video — DOM-mutations, mouse-bevegelser, scroll, input.
 *
 *   Tobias-direktiv 2026-05-13:
 *   > "vi må nå bygge slik at test agenten får alt av mulig tilgjengelig
 *   >  informasjon ... så vi finner ut av årsaken"
 *
 *   Klient-side bruker `rrweb` (MIT-licensed) til å serialize DOM +
 *   inkrementelle mutations. Vi mottar batchene her og skriver én
 *   JSONL-fil per session, slik at debug-replay-UI kan reconstrue
 *   sesjonen ende-til-ende.
 *
 * Endepunkter:
 *   POST /api/_dev/debug/rrweb-events?token=<TOKEN>
 *     Body: { sessionId, startedAt, events[] }
 *     Append events til /tmp/rrweb-session-<sessionId>.jsonl
 *
 *   GET /api/_dev/debug/rrweb-sessions?token=<TOKEN>
 *     List alle session-filer på disk med metadata
 *
 *   GET /api/_dev/debug/rrweb-events?session=<id>&token=<TOKEN>
 *     Returner events for en gitt session (for replayer-UI)
 *
 * Format på fil:
 *   /tmp/rrweb-session-<sessionId>.jsonl
 *   Én rrweb-event per linje (med wrapper {receivedAt, event}).
 *
 * Sikkerhet:
 *   - Token-gating samme som /api/_dev/debug/events (RESET_TEST_PLAYERS_TOKEN)
 *   - Path-traversal-beskyttelse: sessionId må matche [a-z0-9-]{1,64}
 *   - Max 50 MB per session-fil — vi truncerer eldste events ved
 *     overskridelse for å unngå disk-fyll
 *
 * Personvern:
 *   - Klient masker passord-felter før send (RrwebRecorder + rrweb
 *     `maskInputOptions.password: true`).
 *   - Sessions på /tmp — overlever ikke server-restart.
 *   - Ikke logget i prod logs.
 *
 * Performance:
 *   - appendFileSync (samme rasjonale som devDebugEventLog — SSD < 5ms).
 *   - max 200 events per batch — beskytter mot oversize payload.
 *   - max 50 MB per fil — beskytter mot disk-fyll. Truncate strategy:
 *     hvis size > max, rotere `.bak` (overwrite eldre rotation hvis finnes)
 *     og start frisk.
 */

import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";

/** Default lokasjon for session-filer. Tester kan overstyre. */
const DEFAULT_SESSIONS_DIR = "/tmp";

/** Filnavn-prefix for session-filer. */
const SESSION_FILE_PREFIX = "rrweb-session-";

/** Max størrelse per session-fil før vi rotere til `.bak`. Default 50 MB. */
const DEFAULT_MAX_SESSION_BYTES = 50 * 1024 * 1024;

/** Max antall events per POST. */
const MAX_EVENTS_PER_BATCH = 200;

/** Max antall events GET-events returnerer på én call. */
const MAX_EVENTS_PER_RESPONSE = 50_000;

/**
 * SessionId validation. Klienten genererer sessionId som
 * `<timestamp-ms>-<random-6-chars>`. Vi tillater [a-z0-9-]{1,64} for å
 * fange den formen men også custom IDs i tester.
 */
const SESSION_ID_REGEX = /^[a-z0-9-]{1,64}$/;

export interface DevRrwebRouterOptions {
  /** Mappe hvor session-filer lagres. Default `/tmp`. */
  sessionsDir?: string;
  /** Max bytes per session-fil før rotering. Default 50 MB. */
  maxSessionBytes?: number;
  /** Override clock (millisekunder). Default: `Date.now`. */
  now?: () => number;
}

interface PostBody {
  sessionId?: unknown;
  startedAt?: unknown;
  events?: unknown;
  token?: unknown;
}

/**
 * Hent token fra query-string eller body.
 */
function extractToken(req: express.Request): string {
  const q = typeof req.query.token === "string" ? req.query.token.trim() : "";
  if (q) return q;
  const bodyToken =
    typeof (req.body as PostBody | undefined)?.token === "string"
      ? ((req.body as PostBody).token as string).trim()
      : "";
  return bodyToken;
}

function checkToken(req: express.Request, res: express.Response): boolean {
  const expected = (process.env.RESET_TEST_PLAYERS_TOKEN ?? "").trim();
  if (!expected) {
    res.status(503).json({
      ok: false,
      error: {
        code: "DEV_TOKEN_NOT_CONFIGURED",
        message:
          "RESET_TEST_PLAYERS_TOKEN er ikke satt i env — rrweb-replay disabled.",
      },
    });
    return false;
  }
  const provided = extractToken(req);
  if (!provided) {
    res.status(401).json({
      ok: false,
      error: { code: "TOKEN_REQUIRED", message: "Mangler ?token-query eller body.token." },
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
 * Validér session-id. Returnerer trimmed id eller null hvis ugyldig.
 */
function validateSessionId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!SESSION_ID_REGEX.test(trimmed)) return null;
  return trimmed;
}

/**
 * Lag session-fil-path. Path-traversal-beskyttet via SESSION_ID_REGEX
 * (kun a-z, 0-9, hyphen tillatt — aldri "../" eller "/").
 */
function sessionFilePath(sessionsDir: string, sessionId: string): string {
  return path.join(sessionsDir, `${SESSION_FILE_PREFIX}${sessionId}.jsonl`);
}

/**
 * Sørg for at sessions-mappe finnes.
 */
function ensureDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") {
      // eslint-disable-next-line no-console
      console.warn("[devRrweb] mkdir feilet:", err);
    }
  }
}

/**
 * Rotere session-fil hvis den er over max-size. Vi flytter til `.bak`
 * (overwriter evt. eldre rotation) og starter frisk. Disse sessions er
 * forgjengelige — vi beholder ikke unbounded historikk.
 */
function rotateIfNeeded(filePath: string, maxBytes: number): void {
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      // eslint-disable-next-line no-console
      console.warn("[devRrweb] stat feilet:", err);
    }
    return;
  }
  if (size < maxBytes) return;
  const rotated = `${filePath}.bak`;
  try {
    fs.renameSync(filePath, rotated);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[devRrweb] rotate feilet:", err);
  }
}

/**
 * Append batch til session-fil. Tom batch er no-op. Hver event wrappes i
 * `{receivedAt, event}` så replayer-UI vet når serveren mottok eventet
 * (kan avvike fra event.timestamp ved nettverks-buffering).
 */
function appendBatchToSession(
  filePath: string,
  events: unknown[],
  receivedAt: number,
): { writtenLines: number } {
  if (events.length === 0) return { writtenLines: 0 };
  const lines: string[] = [];
  for (const event of events) {
    if (typeof event !== "object" || event === null) {
      continue;
    }
    try {
      const wrapped = { receivedAt, event };
      lines.push(JSON.stringify(wrapped));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[devRrweb] JSON.stringify feilet:", err);
    }
  }
  if (lines.length === 0) return { writtenLines: 0 };
  try {
    fs.appendFileSync(filePath, lines.join("\n") + "\n", { encoding: "utf8" });
    return { writtenLines: lines.length };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[devRrweb] append feilet:", err);
    return { writtenLines: 0 };
  }
}

interface SessionFileInfo {
  sessionId: string;
  fileSize: number;
  modifiedAt: string;
  filename: string;
}

/**
 * List alle session-filer i sessions-dir. Returnerer sorteret nyeste-først.
 */
function listSessionFiles(sessionsDir: string): SessionFileInfo[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(sessionsDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
  const sessions: SessionFileInfo[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(SESSION_FILE_PREFIX)) continue;
    if (!entry.endsWith(".jsonl")) continue;
    // Trekk ut sessionId (mellom prefix og ".jsonl")
    const sessionId = entry.slice(
      SESSION_FILE_PREFIX.length,
      entry.length - ".jsonl".length,
    );
    if (!SESSION_ID_REGEX.test(sessionId)) continue;
    try {
      const stat = fs.statSync(path.join(sessionsDir, entry));
      sessions.push({
        sessionId,
        fileSize: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        filename: entry,
      });
    } catch {
      // Ignorer filer vi ikke får stat-et.
    }
  }
  // Nyeste først (basert på modifiedAt)
  sessions.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return sessions;
}

/**
 * Les events fra session-fil. Returnerer array av events (unwrappet) eller
 * tom array hvis fil ikke finnes. Truncates til MAX_EVENTS_PER_RESPONSE.
 */
function readSessionEvents(filePath: string): {
  events: unknown[];
  totalLines: number;
  truncated: boolean;
} {
  let content: string;
  try {
    content = fs.readFileSync(filePath, { encoding: "utf8" });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { events: [], totalLines: 0, truncated: false };
    }
    throw err;
  }
  const lines = content.split("\n").filter((l) => l.length > 0);
  const totalLines = lines.length;
  const limit = Math.min(lines.length, MAX_EVENTS_PER_RESPONSE);
  // Vi returner FIRST N events for sjekken av session-start, men
  // markerer truncated hvis vi droppet noen. Replayer trenger event-0
  // (FullSnapshot) for å rendre, så vi MÅ ha de første eventene.
  const out: unknown[] = [];
  for (let i = 0; i < limit; i++) {
    try {
      const parsed = JSON.parse(lines[i]);
      // Returner kun event-feltet, ikke wrapperen — replayer trenger rrweb-formatet.
      if (parsed && typeof parsed === "object" && "event" in parsed) {
        out.push((parsed as { event: unknown }).event);
      } else {
        // Bakover-kompat hvis vi en gang har lagret rå events
        out.push(parsed);
      }
    } catch {
      // Hopp over ødelagte linjer (SIGKILL midt i write etc.).
    }
  }
  return {
    events: out,
    totalLines,
    truncated: totalLines > limit,
  };
}

/**
 * Lag Express-router for rrweb-replay-endepunkter.
 */
export function createDevRrwebRouter(
  opts: DevRrwebRouterOptions = {},
): express.Router {
  const router = express.Router();
  const sessionsDir = opts.sessionsDir ?? DEFAULT_SESSIONS_DIR;
  const maxBytes = opts.maxSessionBytes ?? DEFAULT_MAX_SESSION_BYTES;
  const now = opts.now ?? Date.now;

  // ── POST /api/_dev/debug/rrweb-events ───────────────────────────────────

  router.post("/api/_dev/debug/rrweb-events", (req, res) => {
    if (!checkToken(req, res)) return;
    const body = req.body as PostBody | undefined;
    const sessionId = validateSessionId(body?.sessionId);
    if (!sessionId) {
      res.status(400).json({
        ok: false,
        error: {
          code: "INVALID_SESSION_ID",
          message:
            "sessionId må være string [a-z0-9-]{1,64}. Eksempel: '<ms>-<6chars>'.",
        },
      });
      return;
    }
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
    const receivedAt = now();
    try {
      ensureDir(sessionsDir);
      const filePath = sessionFilePath(sessionsDir, sessionId);
      rotateIfNeeded(filePath, maxBytes);
      const { writtenLines } = appendBatchToSession(filePath, events, receivedAt);
      res.status(200).json({
        ok: true,
        data: {
          sessionId,
          received: writtenLines,
          receivedAt,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[devRrweb] POST feilet:", err);
      res.status(500).json({
        ok: false,
        error: {
          code: "INTERNAL",
          message: String((err as Error).message ?? err),
        },
      });
    }
  });

  // ── GET /api/_dev/debug/rrweb-sessions ─────────────────────────────────

  router.get("/api/_dev/debug/rrweb-sessions", (req, res) => {
    if (!checkToken(req, res)) return;
    try {
      const sessions = listSessionFiles(sessionsDir);
      res.status(200).json({ ok: true, data: { sessions } });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[devRrweb] GET sessions feilet:", err);
      res.status(500).json({
        ok: false,
        error: {
          code: "INTERNAL",
          message: String((err as Error).message ?? err),
        },
      });
    }
  });

  // ── GET /api/_dev/debug/rrweb-events ───────────────────────────────────

  router.get("/api/_dev/debug/rrweb-events", (req, res) => {
    if (!checkToken(req, res)) return;
    const sessionId = validateSessionId(req.query.session);
    if (!sessionId) {
      res.status(400).json({
        ok: false,
        error: {
          code: "INVALID_SESSION_ID",
          message:
            "?session må være string [a-z0-9-]{1,64}.",
        },
      });
      return;
    }
    try {
      const filePath = sessionFilePath(sessionsDir, sessionId);
      const { events, totalLines, truncated } = readSessionEvents(filePath);
      res.status(200).json({
        ok: true,
        data: {
          sessionId,
          events,
          totalLines,
          truncated,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[devRrweb] GET events feilet:", err);
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

// Eksporter helpers for tester.
export const __TEST_ONLY__ = {
  rotateIfNeeded,
  appendBatchToSession,
  listSessionFiles,
  readSessionEvents,
  validateSessionId,
  sessionFilePath,
  SESSION_FILE_PREFIX,
  SESSION_ID_REGEX,
  MAX_EVENTS_PER_BATCH,
  MAX_EVENTS_PER_RESPONSE,
};
