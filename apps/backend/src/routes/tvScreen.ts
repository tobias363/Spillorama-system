/**
 * TV Screen + Winners public display router.
 *
 * Public endpoints — ingen auth-middleware, kun tvToken-sjekk mot
 * app_halls.tv_token. Ved ugyldig token returnerer vi 404 (uniform med
 * ukjent hall) slik at enumeration-angrep ikke kan kartlegge gyldige
 * hall-IDer.
 *
 * Endpoints:
 *   GET /api/tv/:hallId/:tvToken/state    → current game state
 *   GET /api/tv/:hallId/:tvToken/winners  → last completed game winners
 *   GET /api/tv/:hallId/voice             → voice-pack for denne hallen
 *
 * Voice-endepunktet brukes av TV-klienten ved mount for å vite hvilken
 * stemme som skal lastes. Tokenfri så TV-klienten kan kalle det før
 * eventuell socket-login; verdien er ikke sensitiv (bare voice1/2/3).
 *
 * Klient-frontend: apps/admin-web/src/pages/tv/*.ts (public routes,
 * utenfor normal auth-gate).
 */

import express from "express";
import type { PlatformService } from "../platform/PlatformService.js";
import type { TvScreenService } from "../game/TvScreenService.js";
import type { ScreenSaverService } from "../admin/ScreenSaverService.js";
import type { SettingsService } from "../admin/SettingsService.js";
import { DomainError } from "../errors/DomainError.js";

export interface TvRouterDeps {
  platformService: PlatformService;
  tvScreenService: TvScreenService;
  /**
   * Fase 1 MVP §24: TV henter aktivt screensaver-konfig (enabled +
   * timeout + bilde-carousel) for sin hall. Optional dependency så
   * eldre dep-injection ikke breaker.
   */
  screenSaverService?: ScreenSaverService;
  settingsService?: SettingsService;
}

export function createTvScreenRouter(deps: TvRouterDeps): express.Router {
  const { platformService, tvScreenService, screenSaverService, settingsService } =
    deps;
  const router = express.Router();

  router.get("/api/tv/:hallId/:tvToken/state", async (req, res) => {
    try {
      const hall = await platformService.verifyHallTvToken(
        req.params.hallId ?? "",
        req.params.tvToken ?? ""
      );
      const state = await tvScreenService.getState({ id: hall.id, name: hall.name });
      res.json({ ok: true, data: state });
    } catch (error) {
      handleError(res, error);
    }
  });

  router.get("/api/tv/:hallId/:tvToken/winners", async (req, res) => {
    try {
      const hall = await platformService.verifyHallTvToken(
        req.params.hallId ?? "",
        req.params.tvToken ?? ""
      );
      const summary = await tvScreenService.getWinners({ id: hall.id, name: hall.name });
      res.json({ ok: true, data: summary });
    } catch (error) {
      handleError(res, error);
    }
  });

  // Fase 1 MVP §24 — Screen Saver-konfig + bilde-carousel for TV-klient.
  // Krever gyldig tvToken siden vi viser hall-spesifikk config (selv om
  // verdiene i seg selv ikke er sensitive). Fail-soft: hvis services
  // mangler, returner enabled=false slik at TV alltid kan rendre.
  router.get("/api/tv/:hallId/:tvToken/screen-saver", async (req, res) => {
    try {
      const hall = await platformService.verifyHallTvToken(
        req.params.hallId ?? "",
        req.params.tvToken ?? ""
      );
      let enabled = false;
      let timeoutMinutes = 2;
      if (settingsService) {
        const settings = await settingsService.list();
        const enabledRow = settings.find(
          (s) => s.key === "branding.screen_saver_enabled"
        );
        const timeoutRow = settings.find(
          (s) => s.key === "branding.screen_saver_timeout_minutes"
        );
        enabled = enabledRow?.value === true;
        if (typeof timeoutRow?.value === "number" && Number.isFinite(timeoutRow.value)) {
          timeoutMinutes = Math.max(1, Math.round(timeoutRow.value));
        }
      }
      let images: Array<{
        id: string;
        imageUrl: string;
        displaySeconds: number;
        displayOrder: number;
        isGlobal: boolean;
      }> = [];
      if (screenSaverService) {
        const carousel = await screenSaverService.getCarouselForHall(hall.id);
        images = carousel.map((img) => ({
          id: img.id,
          imageUrl: img.imageUrl,
          displaySeconds: img.displaySeconds,
          displayOrder: img.displayOrder,
          isGlobal: img.hallId === null,
        }));
      }
      // Hvis ingen aktive bilder, marker som disabled mot klienten — TV
      // skal ikke prøve å rendre en tom carousel.
      const effectiveEnabled = enabled && images.length > 0;
      res.json({
        ok: true,
        data: {
          enabled: effectiveEnabled,
          timeoutMinutes,
          images,
        },
      });
    } catch (error) {
      handleError(res, error);
    }
  });

  // Voice-config for TV-klient. Ingen token-krav fordi verdien ikke er
  // sensitiv, men vi returnerer 404 for ukjent hall (samme uniform-404-
  // policy som de andre TV-endepunktene for å unngå hall-enumeration).
  router.get("/api/tv/:hallId/voice", async (req, res) => {
    try {
      const hallRef = (req.params.hallId ?? "").trim();
      if (!hallRef) {
        res.status(404).json({ ok: false, error: { code: "NOT_FOUND" } });
        return;
      }
      const voice = await platformService.getTvVoice(hallRef);
      res.json({ ok: true, data: { voice } });
    } catch (error) {
      if (error instanceof DomainError && error.code === "HALL_NOT_FOUND") {
        res.status(404).json({ ok: false, error: { code: "NOT_FOUND" } });
        return;
      }
      handleError(res, error);
    }
  });

  return router;
}

/**
 * Token-fail ⇒ 404 uniform: aldri avslør om hallen finnes. Øvrige feil
 * logges som 500 men uten stack til klient (public endpoint).
 */
function handleError(res: express.Response, error: unknown): void {
  if (error instanceof DomainError && error.code === "TV_TOKEN_INVALID") {
    res.status(404).json({ ok: false, error: { code: "NOT_FOUND" } });
    return;
  }
  console.error("[tv-screen] internal error", error);
  res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR" } });
}
