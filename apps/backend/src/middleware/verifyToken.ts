/**
 * GAP #35 — Express-middleware som krever et gyldig verify-token (utstedt
 * av `POST /api/auth/verify-password`) før sensitive handlinger kjører.
 *
 * Bruks:
 *   router.post(
 *     "/api/wallet/me/self-exclusion",
 *     requireVerifyToken({ verifyTokenService, getAuthenticatedUserId }),
 *     async (req, res) => { … }
 *   );
 *
 * Header-konvensjon: `X-Verify-Token: <token>` (kort-levd, single-use).
 *
 * Atferd:
 *   - Mangler header → 403 `VERIFY_TOKEN_REQUIRED`.
 *   - Token er utløpt/brukt/ukjent → 403 med tilsvarende error-code
 *     (`VERIFY_TOKEN_EXPIRED`, `VERIFY_TOKEN_ALREADY_USED`, `VERIFY_TOKEN_INVALID`).
 *   - Token bundet til en annen user enn current session → 403
 *     `VERIFY_TOKEN_USER_MISMATCH`. Defense-in-depth: forhindrer at en
 *     token-lekkasje på tvers av brukere kan brukes.
 *   - Suksess → token konsumeres atomisk (single-use) og handler kalles.
 *
 * Error-shape matcher resten av API-et: `{ ok: false, error: { code, message } }`.
 */

import type { Request, Response, NextFunction } from "express";
import { DomainError, toPublicError } from "../game/BingoEngine.js";
import type { VerifyTokenService } from "../auth/VerifyTokenService.js";

export const VERIFY_TOKEN_HEADER = "x-verify-token";

export interface RequireVerifyTokenOptions {
  verifyTokenService: VerifyTokenService;
  /**
   * Returnerer userId for innlogget bruker. Skal hente Authorization-header
   * og resolve via PlatformService — kallesteder som allerede har gjort det
   * andre steder (auth-middleware) kan injisere en wrapper som trekker fra
   * `req.user` istedenfor å re-validere accessToken.
   */
  getAuthenticatedUserId: (req: Request) => Promise<string>;
}

function readVerifyToken(req: Request): string | null {
  const raw = req.headers[VERIFY_TOKEN_HEADER];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function send403(res: Response, error: unknown): void {
  const publicError = toPublicError(error);
  res.status(403).json({ ok: false, error: publicError });
}

export function requireVerifyToken(opts: RequireVerifyTokenOptions) {
  const { verifyTokenService, getAuthenticatedUserId } = opts;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = readVerifyToken(req);
      if (!token) {
        send403(
          res,
          new DomainError(
            "VERIFY_TOKEN_REQUIRED",
            "Denne handlingen krever passord-bekreftelse. Hent et verify-token via /api/auth/verify-password og send det i X-Verify-Token-headeren."
          )
        );
        return;
      }
      // Hent autentisert bruker FØR token konsumeres — hvis access-token er
      // ugyldig vil verify-tokenet stå ubrukt og kan re-brukes.
      const userId = await getAuthenticatedUserId(req);
      // Validér først (peek), så user-mismatch kan fanges uten at vi brenner
      // tokenet på en feil-bruker.
      const validation = verifyTokenService.validate(token);
      if (validation.userId !== userId) {
        send403(
          res,
          new DomainError(
            "VERIFY_TOKEN_USER_MISMATCH",
            "Verify-token tilhører ikke innlogget bruker."
          )
        );
        return;
      }
      // Konsumér atomisk — replay-protected.
      verifyTokenService.consume(token);
      next();
    } catch (err) {
      // VerifyTokenService kaster DomainError med riktig kode (REQUIRED/
      // INVALID/EXPIRED/ALREADY_USED). PlatformService kan kaste UNAUTHORIZED.
      // Andre feil → 500 via apiFailure-stil.
      if (err instanceof DomainError) {
        const status = err.code === "UNAUTHORIZED" ? 401 : 403;
        res.status(status).json({ ok: false, error: toPublicError(err) });
        return;
      }
      send403(res, new DomainError("INTERNAL_ERROR", "Kunne ikke validere verify-token."));
    }
  };
}
