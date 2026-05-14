/**
 * 2026-05-14 (Tobias-direktiv) — Round-replay-API for compliance + debug.
 *
 * Bakgrunn:
 *   For hver runde må PM ofte verifisere: "Ble auto-multiplikator anvendt
 *   riktig på utbetalinger?" Eller: "Hvorfor finishet plan-run uten å
 *   advance?" Dette krever queries over flere tabeller for å reprodusere
 *   tidsserien (5-10 SQL-queries per runde).
 *
 *   Endepunktet leverer komplett event-tidsserie + sammendrag + automatisk
 *   anomaly-deteksjon med ett kall:
 *
 *     GET /api/_dev/debug/round-replay/:scheduledGameId?token=<TOKEN>
 *
 * Respons inneholder:
 *   - metadata: scheduled-game-rad + catalog + plan-run-status
 *   - timeline: kronologisk sortert event-strøm (purchases, master-actions,
 *               draws, phase_winners, ledger-events, start/end)
 *   - summary: aggregert per type — totals, by-color, winners med expected
 *              vs actual prize-sammenligning
 *   - anomalies: detekterte bug-mønstre (payout-mismatch, stuck plan-run, ...)
 *   - errors: per-kilde feilmeldinger (fail-soft)
 *
 * Sikkerhet:
 *   Token-gated via `RESET_TEST_PLAYERS_TOKEN`-env-var (samme konvensjon
 *   som andre /api/_dev/*-endpoints). 503 hvis env mangler (fail-closed).
 *
 * Compliance-grade audit-trail:
 *   Endpointet er ALDRI ment for å mutere state. Det er pure read av
 *   compliance-grade audit-tabeller for å reprodusere én runde event-for-
 *   event for Lotteritilsynet-revisjon (§71 pengespillforskriften) eller
 *   intern audit. Skal ALDRI fjernes uten ADR-prosess.
 *
 * Performance:
 *   Bygger replay via 8 parallelle SELECTs. Total ~20-100ms for en
 *   normal runde mot lokal Postgres. Ikke ment for high-frequency polling.
 */

import express from "express";
import type { Pool } from "pg";
import { RoundReplayBuilder } from "../observability/roundReplayBuilder.js";

export interface DevRoundReplayRouterDeps {
  pool: Pool;
  schema?: string;
  /**
   * Override clock for tester. Default `() => new Date()`.
   */
  now?: () => Date;
}

function extractToken(req: express.Request): string {
  const queryToken =
    typeof req.query.token === "string" ? req.query.token.trim() : "";
  if (queryToken) return queryToken;
  return "";
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

const SCHEDULED_GAME_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function createDevRoundReplayRouter(
  deps: DevRoundReplayRouterDeps,
): express.Router {
  const router = express.Router();
  const builder = new RoundReplayBuilder(deps.pool, {
    schema: deps.schema,
    now: deps.now,
  });

  router.get(
    "/api/_dev/debug/round-replay/:scheduledGameId",
    async (req, res) => {
      if (!checkToken(req, res)) return;

      const scheduledGameIdRaw = req.params.scheduledGameId;
      if (
        typeof scheduledGameIdRaw !== "string" ||
        !SCHEDULED_GAME_ID_PATTERN.test(scheduledGameIdRaw)
      ) {
        res.status(400).json({
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message:
              "scheduledGameId må være en alfanumerisk streng (1-128 tegn).",
          },
        });
        return;
      }

      try {
        const replay = await builder.build(scheduledGameIdRaw);
        res.json({ ok: true, data: replay });
      } catch (err) {
        const code =
          err instanceof Error
            ? ((err as Error & { code?: string }).code ?? "")
            : "";
        if (code === "SCHEDULED_GAME_NOT_FOUND") {
          res.status(404).json({
            ok: false,
            error: {
              code: "SCHEDULED_GAME_NOT_FOUND",
              message: `Ingen scheduled-game funnet med id ${scheduledGameIdRaw}.`,
            },
          });
          return;
        }
        // Andre feil bør ikke skje — builder fail-soft alle interne kilder.
        // Hvis vi havner her er det DB-tilkobling eller programmerings-feil.
        // eslint-disable-next-line no-console
        console.error("[devRoundReplay] uventet feil:", err);
        res.status(500).json({
          ok: false,
          error: {
            code: "INTERNAL",
            message:
              err instanceof Error ? err.message : "Uventet feil i replay-builder.",
          },
        });
      }
    },
  );

  return router;
}
