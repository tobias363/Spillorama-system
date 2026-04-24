/**
 * Minimal static file server used by the performance-budget collector.
 *
 * Serves `apps/backend/public/web/` on localhost so Puppeteer can
 * navigate to `http://localhost:<port>/games/preview.html` without
 * booting the full backend (which requires postgres, Redis, and a
 * running socket.io loop — none of which the perf-gate needs).
 *
 * Implemented on Node's stdlib `http` + `fs` so the perf-budget
 * package doesn't pull in Express (which would duplicate the
 * dependency already vendored in apps/backend).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, promises as fsPromises } from "node:fs";
import { resolve, join, extname, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
// Mirrors apps/backend/src/index.ts → `app.use(express.static(publicDir))`,
// where publicDir = "apps/backend/public". That makes
// public/web/games/preview.html available at /web/games/preview.html,
// matching the `base: "/web/games/"` baked into preview.js by Vite.
const DEFAULT_ROOT = resolve(REPO_ROOT, "apps/backend/public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
};

export interface ServeHandle {
  port: number;
  url: string;
  close(): Promise<void>;
}

export async function startServer(opts: { root?: string; port?: number } = {}): Promise<ServeHandle> {
  const rootDir = resolve(opts.root ?? DEFAULT_ROOT);
  await fsPromises.access(rootDir);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // Strip leading "/games/" prefix: the preview build expects to be
      // served at `/games/preview.html` (matching backend's route), but
      // the assets live directly under the `public/web/` root. We mirror
      // backend's express.static which serves `public/web/` at `/`.
      const url = new URL(req.url ?? "/", "http://localhost");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === "/") pathname = "/index.html";

      // Prevent directory-traversal: resolve, then require the result to
      // stay inside `rootDir`. `normalize` collapses `../` segments.
      const candidate = normalize(join(rootDir, pathname));
      const rel = relative(rootDir, candidate);
      if (rel.startsWith("..") || rel.startsWith(sep) || rel === "") {
        // Fall through to 404 rather than leaking 403 details.
        res.statusCode = 404;
        res.end("not found");
        return;
      }

      const stat = await fsPromises.stat(candidate).catch(() => null);
      if (!stat || !stat.isFile()) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }

      const mime = MIME[extname(candidate).toLowerCase()] ?? "application/octet-stream";
      res.setHeader("content-type", mime);
      res.setHeader("cache-control", "no-store");
      res.setHeader("content-length", String(stat.size));
      createReadStream(candidate).pipe(res);
    } catch (err) {
      res.statusCode = 500;
      res.end(err instanceof Error ? err.message : "server error");
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("failed to bind http server");
  }
  const port = addr.port;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      }),
  };
}

// CLI entry — run `tsx serve.ts [port]` to serve the directory for manual inspection.
const invokedAsScript =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedAsScript) {
  const port = Number(process.argv[2] ?? 4321);
  startServer({ port })
    .then((handle) => {
      process.stdout.write(`serving ${DEFAULT_ROOT} at ${handle.url}\n`);
      process.on("SIGINT", () => {
        void handle.close().then(() => process.exit(0));
      });
    })
    .catch((err) => {
      process.stderr.write(`serve failed: ${err}\n`);
      process.exit(1);
    });
}
