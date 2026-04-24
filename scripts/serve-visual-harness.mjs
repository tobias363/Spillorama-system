#!/usr/bin/env node
// @ts-check
/**
 * Minimal static file server for Playwright visual-regression tests.
 *
 * Serves `apps/backend/public` on port 4173 with the same URL layout production
 * uses — i.e. the game-client bundle at `/web/games/main.js`, the visual-
 * harness at `/web/games/visual-harness.html`, and ball assets at
 * `/web/games/assets/game1/design/balls/*.png`.
 *
 * No caching; short-circuits to `visual-harness.html` for any 404 under
 * `/web/games/*` that Playwright may query during navigation. Binds to 127.0.0.1
 * only so it never leaks onto the network.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = path.resolve(__dirname, "..", "apps", "backend", "public");
const PORT = Number(process.env.VISUAL_HARNESS_PORT ?? 4173);
const HOST = "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

function contentType(p) {
  return MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream";
}

function safeJoin(root, reqPath) {
  // Strip query string + fragment before resolving.
  const clean = reqPath.split("?")[0].split("#")[0];
  const decoded = decodeURIComponent(clean);
  const resolved = path.resolve(root, "." + decoded);
  // Path-traversal guard: resolved path must stay inside root.
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.writeHead(400).end("bad request");
    return;
  }
  const target = safeJoin(PUBLIC_ROOT, req.url);
  if (!target) {
    res.writeHead(403).end("forbidden");
    return;
  }

  let finalPath = target;
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      finalPath = path.join(target, "index.html");
    }
  } catch {
    // Missing; fall through and serve 404.
  }

  fs.readFile(finalPath, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(`404 Not Found: ${req.url}\n`);
      return;
    }
    res.writeHead(200, {
      "content-type": contentType(finalPath),
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  // One line, stable format — Playwright's webServer option watches stdout.
  process.stdout.write(
    `[visual-harness] serving ${PUBLIC_ROOT} at http://${HOST}:${PORT}/\n`,
  );
});

// Clean shutdown for CI.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
