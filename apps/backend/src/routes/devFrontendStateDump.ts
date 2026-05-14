/**
 * 2026-05-14 (Tobias-direktiv) — Frontend-state-dump collector.
 *
 * Bakgrunn:
 *   `packages/game-client/src/debug/StateDumpTool.ts` lar PM/agent klikke
 *   "Dump State" i debug-HUD-en og samler et deterministisk state-tree
 *   fra alle kjente kilder. Klient-siden POST'er dump'en hit; vi skriver
 *   den til disk så Live-monitor-agent (eller manuell tail) kan plukke
 *   den opp uten å måtte be om browser-console-snippets.
 *
 *   Tobias-direktiv 2026-05-14:
 *   > "Vi mangler en deterministisk dump av frontend-state i runtime."
 *
 * Endepunkter:
 *   POST /api/_dev/debug/frontend-state-dump?token=<TOKEN>
 *     Body: FrontendStateDump-JSON (se StateDumpTool.ts)
 *     Skriver én fil til /tmp/frontend-state-dumps/dump-<timestamp>-<id>.json
 *
 *   GET /api/_dev/debug/frontend-state-dumps?token=<TOKEN>
 *     Lister alle dumps (nyeste først, max 100)
 *
 *   GET /api/_dev/debug/frontend-state-dumps/<dumpId>?token=<TOKEN>
 *     Returner én spesifikk dump
 *
 * Sikkerhet:
 *   - Token-gated samme som rrweb + bug-report (RESET_TEST_PLAYERS_TOKEN)
 *   - Path-traversal-beskyttelse: dumpId må matche [a-z0-9-]{1,64}
 *   - Max 5 MB per dump-payload — vi avviser større med 413
 *
 * Personvern:
 *   - Dumps inneholder spillerprofil (userId, walletId, balance) — KUN
 *     for staging/dev der token er konfigurert. Aldri i prod uten
 *     eksplisitt env-flag.
 *   - Dumps på /tmp — overlever ikke server-restart.
 *
 * Performance:
 *   - appendFileSync (samme rasjonale som devDebugEventLog + devRrweb).
 *   - max 5 MB per dump — beskytter mot client-side memory-leak som
 *     POST-er enormous trees.
 *   - max 1000 dumps på disk — vi roterer eldste ut ved overskridelse
 *     for å unngå disk-fyll. Vanlig dump er ~5-50 KB.
 */

import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";

/** Default-lokasjon for dump-filer. Tester kan overstyre. */
const DEFAULT_DUMPS_DIR = "/tmp/frontend-state-dumps";

/** Filnavn-prefix. */
const DUMP_FILE_PREFIX = "dump-";

/** Max bytes per POST-body. 5 MB skal være rikelig — typisk dump er 5-50 KB. */
const MAX_DUMP_BYTES = 5 * 1024 * 1024;

/** Max antall dumps å beholde — eldste rotateres ut. */
const MAX_DUMPS_RETAINED = 1000;

/**
 * dumpId validation. Klienten genererer crypto.randomUUID() (har bindestreker),
 * men vi tillater [a-z0-9-]{1,64} for å støtte custom IDer i tester.
 */
const DUMP_ID_REGEX = /^[a-z0-9-]{1,64}$/i;

export interface DevFrontendStateDumpRouterOptions {
  /** Mappe hvor dump-filer lagres. Default /tmp/frontend-state-dumps. */
  dumpsDir?: string;
  /** Max bytes per dump. Default 5 MB. */
  maxDumpBytes?: number;
  /** Max antall dumps å beholde. Default 1000. */
  maxDumpsRetained?: number;
  /** Override clock — tester. */
  now?: () => number;
  /** Override fs — tester. */
  fsImpl?: typeof fs;
}

interface PostBody {
  dumpId?: unknown;
  timestamp?: unknown;
  // Resten er fri-form; vi serializer ikke type-strict.
  [k: string]: unknown;
}

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
          "RESET_TEST_PLAYERS_TOKEN er ikke satt i env — frontend-state-dump disabled.",
      },
    });
    return false;
  }
  const provided = extractToken(req);
  if (!provided) {
    res.status(401).json({
      ok: false,
      error: { code: "TOKEN_REQUIRED", message: "Mangler ?token-query." },
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

function validateDumpId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!DUMP_ID_REGEX.test(trimmed)) return null;
  return trimmed;
}

/**
 * Lag filsti for en dump. Path-traversal-beskyttet via DUMP_ID_REGEX.
 *
 * Filnavn-format: dump-<timestamp-ms>-<dumpId>.json
 *   - timestamp først så filnavn sorteres kronologisk
 *   - dumpId etter for stabil match mot klient-side id
 */
function dumpFilePath(
  dumpsDir: string,
  timestamp: number,
  dumpId: string,
): string {
  return path.join(
    dumpsDir,
    `${DUMP_FILE_PREFIX}${timestamp}-${dumpId}.json`,
  );
}

function ensureDir(dir: string, fsImpl: typeof fs): void {
  try {
    fsImpl.mkdirSync(dir, { recursive: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") {
      // eslint-disable-next-line no-console
      console.warn("[devFrontendStateDump] mkdir feilet:", err);
    }
  }
}

interface DumpFileInfo {
  dumpId: string;
  timestamp: number;
  fileSize: number;
  modifiedAt: string;
  filename: string;
}

/**
 * List alle dump-filer i dumpsDir. Sorteret nyeste-først.
 */
function listDumpFiles(
  dumpsDir: string,
  fsImpl: typeof fs,
): DumpFileInfo[] {
  let entries: string[];
  try {
    entries = fsImpl.readdirSync(dumpsDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
  const dumps: DumpFileInfo[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(DUMP_FILE_PREFIX)) continue;
    if (!entry.endsWith(".json")) continue;
    // Filnavn: dump-<timestamp>-<dumpId>.json
    const inner = entry.slice(
      DUMP_FILE_PREFIX.length,
      entry.length - ".json".length,
    );
    // Splitt på første "-" så vi får [timestamp, dumpId]
    const firstDash = inner.indexOf("-");
    if (firstDash <= 0) continue;
    const timestampStr = inner.slice(0, firstDash);
    const dumpId = inner.slice(firstDash + 1);
    const timestamp = Number(timestampStr);
    if (!Number.isFinite(timestamp)) continue;
    if (!DUMP_ID_REGEX.test(dumpId)) continue;
    try {
      const stat = fsImpl.statSync(path.join(dumpsDir, entry));
      dumps.push({
        dumpId,
        timestamp,
        fileSize: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        filename: entry,
      });
    } catch {
      /* ignorer */
    }
  }
  // Nyeste først
  dumps.sort((a, b) => b.timestamp - a.timestamp);
  return dumps;
}

/**
 * Rotere ut eldste dumps hvis vi har > maxRetained filer på disk.
 */
function rotateDumps(
  dumpsDir: string,
  maxRetained: number,
  fsImpl: typeof fs,
): void {
  try {
    const dumps = listDumpFiles(dumpsDir, fsImpl);
    if (dumps.length <= maxRetained) return;
    // Slett eldste
    const toDelete = dumps.slice(maxRetained);
    for (const d of toDelete) {
      try {
        fsImpl.unlinkSync(path.join(dumpsDir, d.filename));
      } catch {
        /* best-effort */
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[devFrontendStateDump] rotate feilet:", err);
  }
}

/**
 * Finn dump-fil basert på dumpId. Returnerer full path eller null hvis
 * ikke funnet.
 */
function findDumpFileById(
  dumpsDir: string,
  dumpId: string,
  fsImpl: typeof fs,
): string | null {
  const dumps = listDumpFiles(dumpsDir, fsImpl);
  for (const d of dumps) {
    if (d.dumpId === dumpId) {
      return path.join(dumpsDir, d.filename);
    }
  }
  return null;
}

/**
 * Lag Express-router for frontend-state-dump-endpoints.
 */
export function createDevFrontendStateDumpRouter(
  opts: DevFrontendStateDumpRouterOptions = {},
): express.Router {
  // Bruk dedikert router så vi kan sette body-limit-middleware uten å
  // påvirke andre routes.
  const router = express.Router();
  const dumpsDir = opts.dumpsDir ?? DEFAULT_DUMPS_DIR;
  const maxBytes = opts.maxDumpBytes ?? MAX_DUMP_BYTES;
  const maxRetained = opts.maxDumpsRetained ?? MAX_DUMPS_RETAINED;
  const now = opts.now ?? Date.now;
  const fsImpl = opts.fsImpl ?? fs;

  // Body-parser med eksplisitt limit. Default-globalt body-parser i index.ts
  // har sin egen limit, men vi setter en eksplisitt her for sikkerhets skyld.
  // Bruker bytes-string-form ("5mb") — express.json forventer dette format.
  const bodyParser = express.json({ limit: `${Math.floor(maxBytes / 1024)}kb` });

  // ── POST /api/_dev/debug/frontend-state-dump ───────────────────────────

  router.post(
    "/api/_dev/debug/frontend-state-dump",
    bodyParser,
    (req, res) => {
      if (!checkToken(req, res)) return;
      const body = req.body as PostBody | undefined;
      const dumpId = validateDumpId(body?.dumpId);
      if (!dumpId) {
        res.status(400).json({
          ok: false,
          error: {
            code: "INVALID_DUMP_ID",
            message:
              "dumpId må være string [a-z0-9-]{1,64} (klient genererer crypto.randomUUID()).",
          },
        });
        return;
      }

      // Sanity-check size — express.json har allerede limit, men dobbel-sjekk
      const payloadStr = JSON.stringify(body ?? {});
      if (payloadStr.length > maxBytes) {
        res.status(413).json({
          ok: false,
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: `Dump max ${maxBytes} bytes (mottok ${payloadStr.length}).`,
          },
        });
        return;
      }

      const tsMs = now();
      const filePath = dumpFilePath(dumpsDir, tsMs, dumpId);
      try {
        ensureDir(dumpsDir, fsImpl);
        fsImpl.writeFileSync(filePath, payloadStr, { encoding: "utf8" });
        // Best-effort: rotere eldste hvis vi er over taket.
        rotateDumps(dumpsDir, maxRetained, fsImpl);
        res.status(200).json({
          ok: true,
          data: {
            dumpId,
            timestamp: tsMs,
            filePath,
            sizeBytes: payloadStr.length,
          },
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[devFrontendStateDump] POST feilet:", err);
        res.status(500).json({
          ok: false,
          error: {
            code: "INTERNAL",
            message: String((err as Error).message ?? err),
          },
        });
      }
    },
  );

  // ── GET /api/_dev/debug/frontend-state-dumps ───────────────────────────

  router.get("/api/_dev/debug/frontend-state-dumps", (req, res) => {
    if (!checkToken(req, res)) return;
    try {
      const dumps = listDumpFiles(dumpsDir, fsImpl).slice(0, 100);
      res.status(200).json({
        ok: true,
        data: { dumps, total: dumps.length },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[devFrontendStateDump] GET list feilet:", err);
      res.status(500).json({
        ok: false,
        error: {
          code: "INTERNAL",
          message: String((err as Error).message ?? err),
        },
      });
    }
  });

  // ── GET /api/_dev/debug/frontend-state-dumps/:dumpId ───────────────────

  router.get(
    "/api/_dev/debug/frontend-state-dumps/:dumpId",
    (req, res) => {
      if (!checkToken(req, res)) return;
      const dumpId = validateDumpId(req.params.dumpId);
      if (!dumpId) {
        res.status(400).json({
          ok: false,
          error: {
            code: "INVALID_DUMP_ID",
            message: "dumpId må være [a-z0-9-]{1,64}.",
          },
        });
        return;
      }
      try {
        const filePath = findDumpFileById(dumpsDir, dumpId, fsImpl);
        if (!filePath) {
          res.status(404).json({
            ok: false,
            error: { code: "DUMP_NOT_FOUND", message: `Ingen dump med id ${dumpId}.` },
          });
          return;
        }
        const content = fsImpl.readFileSync(filePath, { encoding: "utf8" });
        try {
          const parsed = JSON.parse(content);
          res.status(200).json({ ok: true, data: parsed });
        } catch {
          // Hvis filen er korrupt: returnér raw-content som string
          res.status(200).json({
            ok: true,
            data: { __raw: content, __corrupt: true },
          });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[devFrontendStateDump] GET single feilet:", err);
        res.status(500).json({
          ok: false,
          error: {
            code: "INTERNAL",
            message: String((err as Error).message ?? err),
          },
        });
      }
    },
  );

  return router;
}

// Test-exports
export const __TEST_ONLY__ = {
  validateDumpId,
  dumpFilePath,
  listDumpFiles,
  rotateDumps,
  findDumpFileById,
  DUMP_FILE_PREFIX,
  DUMP_ID_REGEX,
  MAX_DUMP_BYTES,
  MAX_DUMPS_RETAINED,
};
