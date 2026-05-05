/**
 * apps/backend/src/dev/devAutoLoginRoute.ts
 *
 * Dev-only auto-login route: GET /api/dev/auto-login?email=X
 *
 * Tar en email, slår opp brukeren i app_users (uten å verifisere passord),
 * oppretter en sesjon og returnerer accessToken + en redirect-URL. Dette lar
 * frontend bruke `?dev-user=email@example.com` i URL-en og bli auto-innlogget
 * uten å manuelt skrive credentials.
 *
 * SIKKERHETSSPERRER (defense-in-depth):
 *   1. routeren mountes KUN hvis `NODE_ENV !== "production"` — sjekkes
 *      både ved opprettelse OG ved hver request (i tilfelle env endres).
 *   2. Tillater kun localhost-IP-er (127.0.0.1, ::1, ::ffff:127.0.0.1).
 *   3. Tillater kun "demo-*" / "tobias@*" / "@example.com"-emailer slik at
 *      en utvikler ikke ved et uhell auto-logger inn som en ekte bruker.
 *   4. Logger hver auto-login som en audit-event slik at det er sporbart.
 *
 * Bruk fra frontend:
 *   const url = new URL(window.location.href);
 *   const devUser = url.searchParams.get("dev-user");
 *   if (devUser) {
 *     const res = await fetch(`/api/dev/auto-login?email=${encodeURIComponent(devUser)}`);
 *     const body = await res.json();
 *     // body.data.accessToken kan lagres i sessionStorage / cookie
 *   }
 */

import express from "express";
import type { PlatformService } from "../platform/PlatformService.js";

const ALLOWED_EMAIL_PATTERNS = [
  /^demo-[a-zA-Z0-9_.-]+@spillorama\.no$/i,
  /^demo-[a-zA-Z0-9_.-]+@example\.com$/i,
  /^demo-pilot-[a-zA-Z0-9_.-]+@example\.com$/i,
  /^tobias@nordicprofil\.no$/i,
];

function isLocalhostIp(ip: string | undefined): boolean {
  if (!ip) return false;
  // Express kan returnere "::ffff:127.0.0.1" (IPv4-mapped IPv6) eller "::1"
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.startsWith("127.")
  );
}

function isAllowedEmail(email: string): boolean {
  return ALLOWED_EMAIL_PATTERNS.some((re) => re.test(email));
}

export interface DevAutoLoginDeps {
  platformService: PlatformService;
}

/**
 * Returnerer en Express-router HVIS NODE_ENV ikke er production. Returnerer
 * `null` ellers — kalleren skal da hoppe over `app.use(...)` på resultatet.
 *
 * Vi returnerer null i stedet for å mounte en blokkerende router så ingenting
 * dukker opp i runtime-route-listen i prod (defense-in-depth #1).
 */
export function createDevAutoLoginRouter(
  deps: DevAutoLoginDeps,
): express.Router | null {
  const isProduction =
    (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
  if (isProduction) {
    return null;
  }

  const router = express.Router();

  router.get("/api/dev/auto-login", async (req, res) => {
    // Re-sjekk NODE_ENV per request. Hvis env endres etter boot (f.eks. via
    // hot-reload av process-env i en Docker-container) skal vi straks slutte
    // å eksponere ruten.
    const stillDev =
      (process.env.NODE_ENV ?? "").trim().toLowerCase() !== "production";
    if (!stillDev) {
      res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
      return;
    }

    // Localhost-only
    const remoteIp = req.ip ?? req.socket.remoteAddress ?? "";
    if (!isLocalhostIp(remoteIp)) {
      res.status(403).json({
        ok: false,
        error: { code: "FORBIDDEN", message: "dev auto-login krever localhost" },
      });
      return;
    }

    const email = String(req.query.email ?? "").trim().toLowerCase();
    if (!email) {
      res.status(400).json({
        ok: false,
        error: { code: "INVALID_INPUT", message: "email er påkrevd" },
      });
      return;
    }

    if (!isAllowedEmail(email)) {
      res.status(403).json({
        ok: false,
        error: {
          code: "FORBIDDEN",
          message:
            "dev auto-login er kun tilgjengelig for demo-* eller tobias@nordicprofil.no",
        },
      });
      return;
    }

    try {
      const user = await deps.platformService.findUserByEmail(email);
      if (!user) {
        res.status(404).json({
          ok: false,
          error: { code: "USER_NOT_FOUND", message: "Bruker finnes ikke" },
        });
        return;
      }

      const session = await deps.platformService.issueSessionForUser(user.id);

      // eslint-disable-next-line no-console
      console.log(
        `[dev:auto-login] ${email} (${user.id}) — session issued. THIS ROUTE IS DEV-ONLY.`,
      );

      res.json({
        ok: true,
        data: {
          accessToken: session.accessToken,
          expiresAt: session.expiresAt,
          user: session.user,
          warning:
            "DEV-ONLY route. Aldri eksponer mot prod. NODE_ENV-gated + localhost-only + email-allowlist.",
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        ok: false,
        error: { code: "INTERNAL", message },
      });
    }
  });

  return router;
}
