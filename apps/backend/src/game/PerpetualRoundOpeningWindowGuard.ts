/**
 * Opening-window-guard for `PerpetualRoundService.canSpawnRound`-callback.
 *
 * BIN-823 (regulatorisk pilot-go-live-blokker, Tobias-direktiv 2026-05-08):
 *   "Veldig viktig at det ikke er mulig å kunne spille spillene etter
 *    stengetid. Er strenge regler på det fra Lotteritilsynet."
 *
 * Dette modulet eksporterer en factory `createPerpetualRoundOpeningWindowGuard`
 * som bygger callback-en fra de to config-tjenestene. Logikken er flyttet ut
 * av `index.ts` slik at den kan unit-testes uten å boote hele appen.
 *
 * Beslutnings-tabell:
 *
 *   gameSlug                              | guard-respons
 *   --------------------------------------+--------------------------------
 *   monsterbingo / mønsterbingo / game_3  | Spill 3 — sjekk Spill3Config
 *   rocket / game_2 / tallspill           | Spill 2 — sjekk Spill2Config
 *   alt annet                             | null  (ingen guard, fail-open)
 *
 * Returverdien tolkes av `PerpetualRoundService`:
 *   - `true`  — innenfor åpningstid, spawn tillatt
 *   - `false` — utenfor åpningstid, ikke spawn (regulatorisk korrekt)
 *   - `null`  — vet ikke; PerpetualRoundService default-er til spawn allowed
 *
 * Fail-open-policy: hvis config ikke kan leses (DB nede, etc.) returnerer
 * vi `null`. Begrunnelse: bedre å la rommet spawne enn å fryse alle pilot-
 * haller hvis Postgres glipper kortvarig. Eventuelle feil logges separat
 * i service-laget.
 */

import type { Spill2ConfigService } from "./Spill2ConfigService.js";
import type { Spill3ConfigService } from "./Spill3ConfigService.js";
import { isWithinOpeningHours } from "./Spill2ConfigService.js";
import { isWithinOpeningWindow } from "./Spill3ConfigService.js";

/** Slugs som regnes som Spill 2 (ROCKET-rom). */
const SPILL2_SLUGS: ReadonlySet<string> = new Set([
  "rocket",
  "game_2",
  "tallspill",
]);

/** Slugs som regnes som Spill 3 (MONSTERBINGO-rom). */
const SPILL3_SLUGS: ReadonlySet<string> = new Set([
  "monsterbingo",
  "mønsterbingo",
  "game_3",
]);

export interface OpeningWindowGuardDeps {
  spill2ConfigService: Pick<Spill2ConfigService, "getActive">;
  spill3ConfigService: Pick<Spill3ConfigService, "getActive">;
  /**
   * Optional clock-injection for tester. Default: `() => new Date()`.
   * Brukes til å frosse tid i unit-tester uten å mocke globalThis.Date.
   */
  now?: () => Date;
}

export type CanSpawnRoundCallback = (input: {
  roomCode: string;
  gameSlug: string;
}) => Promise<boolean | null>;

/**
 * Bygger callback-en som `PerpetualRoundService` skal motta som
 * `canSpawnRound`. Returnerer en async-funksjon som matcher service-ens
 * forventede signatur.
 */
export function createPerpetualRoundOpeningWindowGuard(
  deps: OpeningWindowGuardDeps,
): CanSpawnRoundCallback {
  const now = deps.now ?? (() => new Date());

  return async ({ gameSlug }) => {
    // Spill 3 — monsterbingo. Åpningstider er ALLTID satt (default
    // 11:00/23:00 fra migration). isWithinOpeningWindow returnerer
    // true ∈ [start, end) Oslo-tid.
    if (SPILL3_SLUGS.has(gameSlug)) {
      try {
        const config = await deps.spill3ConfigService.getActive();
        return isWithinOpeningWindow(config, now());
      } catch {
        return null; // fail-open
      }
    }

    // Spill 2 — rocket. Åpningstider er optional. Hvis begge er null
    // → alltid åpent (returnerer true). Hvis begge er satt → sjekk
    // current HH:MM mot vinduet.
    if (SPILL2_SLUGS.has(gameSlug)) {
      try {
        const config = await deps.spill2ConfigService.getActive();
        return isWithinOpeningHours(config, now());
      } catch {
        return null; // fail-open
      }
    }

    // Andre slugs — ingen guard.
    return null;
  };
}

/**
 * Test-only export. Brukes av integrasjonstester for å verifisere at
 * slug-set-ene matcher kanonisk slug-mapping i Game2/3-tjenestene.
 *
 * Dersom `Game2AutoDrawTickService.GAME2_SLUGS` eller
 * `Game3AutoDrawTickService.GAME3_SLUGS` endres må disse også oppdateres.
 */
export const _SPILL2_SLUGS_FOR_GUARD = SPILL2_SLUGS;
export const _SPILL3_SLUGS_FOR_GUARD = SPILL3_SLUGS;
