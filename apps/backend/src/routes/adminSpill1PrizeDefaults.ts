/**
 * HV2-B3 (Tobias 2026-04-30): Admin-router for per-hall Spill 1 default
 * gevinst-floors.
 *
 * Bygger oven på HV2-B1+B2 (PR #759) som leverte
 * `Spill1PrizeDefaultsService` + DB-tabell `app_spill1_prize_defaults` +
 * engine-integrasjon via `applySpill1HallFloors`. Denne fila eksponerer
 * service-CRUD som admin-HTTP-endpoints så hall-operatører/admin kan
 * justere baseline gevinster fra UI uten å skrive SQL.
 *
 * Endpoints:
 *   GET  /api/admin/halls/:hallId/spill1-prize-defaults
 *     Henter komplett floor-snapshot (alle 5 faser, kr) for en hall.
 *     Wildcard-fallback brukes for faser uten hall-spesifikk override.
 *   PUT  /api/admin/halls/:hallId/spill1-prize-defaults
 *     Partial update av phase1-phase5. Hver phase som er undefined
 *     beholdes uendret. UPSERT-er kun de feltene som faktisk er sendt.
 *
 * RBAC:
 *   - Read:  HALL_GAME_CONFIG_READ  (ADMIN, HALL_OPERATOR, SUPPORT)
 *   - Write: HALL_GAME_CONFIG_WRITE (ADMIN, HALL_OPERATOR)
 *   - HALL_OPERATOR auto-scope (BIN-591): kan kun lese/skrive egen hall
 *     via `assertUserHallScope`. ADMIN/SUPPORT har globalt scope.
 *
 * Validering:
 *   - phase1-phase5: number, ≥ 0 og ≤ MAX_SINGLE_PRIZE_NOK (2500 kr per
 *     pengespillforskriften enkelt-premie-cap). Floor-overstyring kan
 *     ALDRI sette gevinst over cap-en.
 *   - PUT med tom body / ingen kjente felter → INVALID_INPUT.
 *
 * Audit:
 *   - `spill1.prize_defaults.update`-event skrives per fase som faktisk
 *     ble endret (én rad per phase). `before`/`after` i details slik at
 *     audit-rapport viser nøyaktig hva som ble overstyrt.
 *
 * IKKE i scope (B4-follow-up):
 *   - Sub-variant-preset.minPrize ≥ hall-default-validering (admin-UI
 *     skal advare når et per-spill-preset prøver å sette floor under
 *     hall-baseline; håndheves separat i ScheduleService).
 */

import express from "express";
import { DomainError } from "../errors/DomainError.js";
import {
  apiSuccess,
  apiFailure,
  mustBeNonEmptyString,
} from "../util/httpHelpers.js";
import { assertUserHallScope } from "../platform/AdminAccessPolicy.js";
import {
  SPILL1_PHASE_INDICES,
  type Spill1PhaseIndex,
  type Spill1PrizeDefaults,
} from "../game/Spill1PrizeDefaultsService.js";
import type { AdminSubRouterDeps } from "./adminShared.js";

/**
 * §11 enkelt-premie-cap: hall-floor-overstyring kan ikke sette en garantert
 * baseline høyere enn 2500 kr per fase. Engine håndhever dette uavhengig på
 * payout-siden (compliance-ledger reject), men vi håndhever på input-siden
 * også for å gi rask feedback til admin og unngå å persistere ugyldige
 * verdier.
 */
const MAX_SINGLE_PRIZE_NOK = 2500;

/**
 * Map phase-index → camelCase JSON-key brukt i request/response.
 * Dette er den eneste mapping-kilden for routen — service-laget bruker
 * `phase1`-`phase5`-shape direkte (matcher `Spill1PrizeDefaults`).
 */
const PHASE_KEY: Record<Spill1PhaseIndex, keyof Spill1PrizeDefaults> = {
  1: "phase1",
  2: "phase2",
  3: "phase3",
  4: "phase4",
  5: "phase5",
};

/**
 * Validerer en enkelt phase-verdi fra request-body. Returnerer parsed number
 * eller kaster DomainError("INVALID_INPUT") med klar melding.
 */
function parsePhaseValue(
  raw: unknown,
  phaseLabel: string,
): number {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      throw new DomainError("INVALID_INPUT", `${phaseLabel} må være et tall.`);
    }
    if (raw < 0) {
      throw new DomainError("INVALID_INPUT", `${phaseLabel} må være 0 eller større.`);
    }
    if (raw > MAX_SINGLE_PRIZE_NOK) {
      throw new DomainError(
        "INVALID_INPUT",
        `${phaseLabel} må være ≤ ${MAX_SINGLE_PRIZE_NOK} kr (pengespillforskriften enkelt-premie-cap).`,
      );
    }
    return raw;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") {
      throw new DomainError("INVALID_INPUT", `${phaseLabel} må være et tall.`);
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      throw new DomainError("INVALID_INPUT", `${phaseLabel} må være et tall.`);
    }
    return parsePhaseValue(parsed, phaseLabel);
  }
  throw new DomainError("INVALID_INPUT", `${phaseLabel} må være et tall.`);
}

/**
 * Plukk ut phase-overrides fra et PUT-body. Returnerer Map<phaseIndex,
 * value> med kun de feltene som klienten faktisk har sendt. Tomt body
 * eller body uten phase1-phase5 → tom Map (caller validerer at minst én
 * fase er sendt).
 */
function extractPatch(body: unknown): Map<Spill1PhaseIndex, number> {
  const patch = new Map<Spill1PhaseIndex, number>();
  if (!body || typeof body !== "object") return patch;
  const obj = body as Record<string, unknown>;
  for (const phaseIndex of SPILL1_PHASE_INDICES) {
    const key = PHASE_KEY[phaseIndex];
    if (!(key in obj)) continue;
    const raw = obj[key];
    if (raw === undefined) continue;
    patch.set(phaseIndex, parsePhaseValue(raw, key));
  }
  return patch;
}

export function createAdminSpill1PrizeDefaultsRouter(
  deps: AdminSubRouterDeps,
): express.Router {
  const { platformService, spill1PrizeDefaultsService, helpers } = deps;
  const { auditAdmin, requireAdminPermissionUser } = helpers;
  const router = express.Router();

  if (!spill1PrizeDefaultsService) {
    // Fail-fast under wire-up. Tester som ikke trenger HV-2 kan unngå
    // å registrere routeren ved å skippe denne fila — i prod-runtime
    // skal index.ts alltid injisere servicen.
    throw new Error(
      "[admin-spill1-prize-defaults] spill1PrizeDefaultsService er påkrevd",
    );
  }

  // ── GET ───────────────────────────────────────────────────────────────────
  router.get(
    "/api/admin/halls/:hallId/spill1-prize-defaults",
    async (req, res) => {
      try {
        const adminUser = await requireAdminPermissionUser(req, "HALL_GAME_CONFIG_READ");
        const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
        // Resolve slug→id slik at HALL_OPERATOR-scope-sjekken treffer korrekt
        // hall-id (og frontend kan bruke begge).
        const hall = await platformService.getHall(hallId);
        assertUserHallScope(adminUser, hall.id); // BIN-591
        const defaults = await spill1PrizeDefaultsService.getDefaults(hall.id);
        apiSuccess(res, {
          hallId: hall.id,
          ...defaults,
        });
      } catch (error) {
        apiFailure(res, error);
      }
    },
  );

  // ── PUT ───────────────────────────────────────────────────────────────────
  router.put(
    "/api/admin/halls/:hallId/spill1-prize-defaults",
    async (req, res) => {
      try {
        const adminUser = await requireAdminPermissionUser(req, "HALL_GAME_CONFIG_WRITE");
        const hallId = mustBeNonEmptyString(req.params.hallId, "hallId");
        const hall = await platformService.getHall(hallId);
        assertUserHallScope(adminUser, hall.id); // BIN-591

        const patch = extractPatch(req.body);
        if (patch.size === 0) {
          throw new DomainError(
            "INVALID_INPUT",
            "Minst én av phase1-phase5 må oppgis.",
          );
        }

        // Hent before-state for audit-diff. Kostnaden er én DB-roundtrip
        // som er negligible for admin-flyt; gevinsten er rikere
        // audit-trail (Lotteritilsynet kan se nøyaktig hva som ble endret).
        const before = await spill1PrizeDefaultsService.getDefaults(hall.id);

        // Skriv én rad per fase. Service-laget UPSERT-er atomisk; om en
        // fase feiler underveis kan vi ende med partial write — det er
        // akseptabelt fordi hver fase er en uavhengig enhet (CHECK-
        // constraint på DB-siden hindrer korrupte verdier). Audit
        // skrives kun for de fasene som faktisk endret seg.
        for (const [phaseIndex, value] of patch) {
          await spill1PrizeDefaultsService.setDefault(
            hall.id,
            phaseIndex,
            value,
            adminUser.id,
          );
          const phaseKey = PHASE_KEY[phaseIndex];
          const beforeValue = before[phaseKey];
          if (beforeValue !== value) {
            auditAdmin(
              req,
              adminUser,
              "spill1.prize_defaults.update",
              "hall",
              hall.id,
              {
                phaseIndex,
                phaseKey,
                before: beforeValue,
                after: value,
              },
            );
          }
        }

        const after = await spill1PrizeDefaultsService.getDefaults(hall.id);
        apiSuccess(res, {
          hallId: hall.id,
          ...after,
        });
      } catch (error) {
        apiFailure(res, error);
      }
    },
  );

  return router;
}
