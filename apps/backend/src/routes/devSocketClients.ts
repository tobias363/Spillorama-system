/**
 * 2026-05-12 (Tobias-direktiv) — Socket.IO connected-clients diagnose-route.
 *
 * Bakgrunn:
 *   PM-AI har gjentatte ganger trengt å sjekke "hvor mange sockets er
 *   faktisk connected akkurat nå?" når Tobias rapporterer "klient mistet
 *   forbindelsen". Manuell sjekk krever SSH inn på Render-instansen og
 *   inspisere `io.sockets.sockets` — denne ruten eksponerer det samme
 *   over HTTP slik at PM-AI kan korrelere med ?debug=1-stream-en uten å
 *   gjette på state.
 *
 *   Returnerer for hver connected socket:
 *     - socketId
 *     - rooms (array, filtrert til ikke-default-rom)
 *     - userAgent (handshake.headers["user-agent"], typisk klient-browser)
 *     - transport (websocket / polling / unknown)
 *     - duration-since-connect (ms siden handshake.issued)
 *     - walletId + playerId hvis bound (socket.data.user)
 *     - ipAddress (handshake.address eller X-Forwarded-For, hashed for PII)
 *
 *   Total-count + transport-breakdown (hvor mange websocket vs polling)
 *   gir oss et health-snapshot for socket-laget.
 *
 * Sikkerhet:
 *   Token-gated via `RESET_TEST_PLAYERS_TOKEN`-env-var. Hvis env-varet ikke
 *   er satt → 503 (fail-closed). Samme konvensjon som andre _dev-routes.
 *
 *   IP-adresser blir hash-et med crypto.createHash("sha256").slice(0, 8)
 *   så vi kan korrelere samme klient på tvers av reconnects uten å lekke
 *   PII. Hashing er en-veg.
 *
 * Endepunkt:
 *   - GET /api/_dev/socket-clients?token=<token>
 *
 * Performance:
 *   Iterating io.sockets.sockets-mappen er O(N) hvor N = connected sockets.
 *   For pilot-skala (4 haller × 100 spillere = 400 sockets) er det <10ms.
 *   For prod-skala (1500 spillere) er det <50ms. Begge OK for manuel
 *   polling — caller bør IKKE høyfrekvens-polle (≥ 1/sek).
 */

import express from "express";
import crypto from "node:crypto";
import type { Server as SocketIOServer } from "socket.io";

export interface DevSocketClientsRouterDeps {
  io: SocketIOServer;
}

function extractToken(req: express.Request): string {
  const queryToken =
    typeof req.query.token === "string" ? req.query.token.trim() : "";
  return queryToken;
}

function checkToken(req: express.Request, res: express.Response): boolean {
  const expected = (process.env["RESET_TEST_PLAYERS_TOKEN"] ?? "").trim();
  if (!expected) {
    res.status(503).json({
      ok: false,
      error: {
        code: "DEV_TOKEN_NOT_CONFIGURED",
        message:
          "RESET_TEST_PLAYERS_TOKEN er ikke satt i env — diagnose-route disabled.",
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

/**
 * Hash IP-adresse til 8-tegns kort hex så vi ikke leaker PII i logger.
 * Stable per IP — samme klient som reconnecter får samme hash, så ops
 * kan korrelere on tvers av sockets.
 */
function hashIp(ip: string | null | undefined): string | null {
  if (!ip || ip.trim().length === 0) return null;
  return crypto
    .createHash("sha256")
    .update(ip.trim())
    .digest("hex")
    .slice(0, 8);
}

interface SocketRecord {
  socketId: string;
  rooms: string[];
  userAgent: string | null;
  transport: string;
  durationMs: number | null;
  walletId: string | null;
  playerId: string | null;
  ipHashed: string | null;
  authenticated: boolean;
}

export function createDevSocketClientsRouter(
  deps: DevSocketClientsRouterDeps,
): express.Router {
  const router = express.Router();

  router.get("/api/_dev/socket-clients", (req, res) => {
    if (!checkToken(req, res)) return;

    const checkedAtMs = Date.now();
    const sockets: SocketRecord[] = [];
    const transportCounts: Record<string, number> = {};
    let authenticatedCount = 0;

    try {
      // io.sockets.sockets er en Map<socketId, Socket> for default-namespacet.
      // Vi itererer en gang og bygger record + per-transport-teller.
      for (const [, socket] of deps.io.sockets.sockets) {
        const data = socket.data as
          | { user?: { walletId?: string; id?: string }; authenticated?: boolean }
          | undefined;
        const walletId = data?.user?.walletId ?? null;
        const playerId = data?.user?.id ?? null;
        const authenticated = !!data?.authenticated;

        const rooms = Array.from(socket.rooms).filter((r) => r !== socket.id);

        const headers =
          (socket.handshake?.headers as
            | Record<string, string | undefined>
            | undefined) ?? undefined;
        const userAgent = headers?.["user-agent"] ?? null;
        const xForwardedFor = headers?.["x-forwarded-for"] ?? null;
        const ip = xForwardedFor ?? socket.handshake?.address ?? null;
        const ipHashed = hashIp(ip);

        const transport =
          typeof (
            socket.conn as { transport?: { name?: string } } | undefined
          )?.transport?.name === "string"
            ? (socket.conn as { transport: { name: string } }).transport.name
            : "unknown";

        const handshakeIssuedMs = socket.handshake?.issued;
        const durationMs =
          typeof handshakeIssuedMs === "number" && handshakeIssuedMs > 0
            ? checkedAtMs - handshakeIssuedMs
            : null;

        sockets.push({
          socketId: socket.id,
          rooms,
          userAgent,
          transport,
          durationMs,
          walletId,
          playerId,
          ipHashed,
          authenticated,
        });

        transportCounts[transport] = (transportCounts[transport] ?? 0) + 1;
        if (authenticated) authenticatedCount += 1;
      }

      res.json({
        ok: true,
        data: {
          checkedAt: new Date(checkedAtMs).toISOString(),
          checkedAtMs,
          totalConnected: sockets.length,
          authenticatedCount,
          unauthenticatedCount: sockets.length - authenticatedCount,
          transportCounts,
          sockets,
        },
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: {
          code: "SOCKET_ENUM_FAILED",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });

  return router;
}
