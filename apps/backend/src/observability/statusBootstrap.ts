/**
 * BIN-791: Bootstrap-helper for public status-page-tjenestene.
 *
 * Bygger en fullt konfigurert `StatusService` + `StatusIncidentService` som
 * `index.ts` kan koble inn i én linje. Holder index.ts ryddig og lar oss
 * teste komponent-sjekkene isolert (de er DI'd inn).
 *
 * Per `MASTER_PLAN_SPILL1_PILOT_2026-04-24` §10 har vi fire spill-engines i
 * prod (`bingo`, `rocket`, `monsterbingo`, `spillorama`) som alle deler én
 * `BingoEngine`-instans. Vi sjekker en gang via `engine.getAllRoomCodes()`
 * og lar alle spill-radene speile det samme engine-helse-treet — hvis
 * engine-en faller, faller alle spill samtidig.
 */

import type { Pool } from "pg";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { PlatformService } from "../platform/PlatformService.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import {
  StatusService,
  buildApiCheck,
  buildDatabaseCheck,
  operational,
  outage,
  type ComponentCheck,
} from "./StatusService.js";
import { StatusIncidentService } from "../admin/StatusIncidentService.js";

export interface StatusBootstrapDeps {
  pool: Pool;
  schema?: string;
  platformService: PlatformService;
  walletAdapter: WalletAdapter;
  engine: BingoEngine;
  /** Test-injisere overrides; produksjonsbruk lar dette stå. */
  cacheTtlMs?: number;
}

export interface StatusBootstrapResult {
  statusService: StatusService;
  statusIncidentService: StatusIncidentService;
}

/**
 * Bygger en engine-baseert komponent-sjekk som kun verifiserer at engine-
 * objektet svarer (ikke at en runde kjører). Brukes av alle fire spill-
 * komponentene siden de deler samme engine-instans.
 */
function buildEngineCheck(engine: BingoEngine): ComponentCheck {
  return async () => {
    try {
      engine.getAllRoomCodes();
      return operational();
    } catch (err) {
      return outage(err instanceof Error ? err.message : "Engine utilgjengelig");
    }
  };
}

function buildWalletCheck(walletAdapter: WalletAdapter): ComponentCheck {
  return async () => {
    try {
      // listAccounts er den letteste read-veien gjennom adapteren — fungerer
      // for både PostgresWalletAdapter og InMemoryWalletAdapter.
      await walletAdapter.listAccounts();
      return operational();
    } catch (err) {
      return outage(err instanceof Error ? err.message : "Wallet utilgjengelig");
    }
  };
}

function buildAuthCheck(pool: Pool): ComponentCheck {
  return async () => {
    try {
      // Auth-tjenesten avhenger av at sesjons-tabellen er lesbar. Vi gjør
      // en lightweight LIMIT 1-spørring (ikke COUNT — det blir tregt på
      // store tabeller).
      //
      // BIN-PILOT-DAY P0-1 (2026-05-01): tabellen heter `app_sessions`, ikke
      // `app_user_sessions`. Tidligere stavemåte førte til at `/api/status`
      // rapporterte `auth: outage` i prod fordi tabellen ikke fantes
      // (relation does not exist). Skjemaet er definert i
      // `migrations/20260413000001_initial_schema.sql:78` og utvides av
      // `20260910000000_user_2fa_and_session_metadata.sql` for REQ-132.
      await pool.query("SELECT 1 FROM app_sessions LIMIT 1");
      return operational();
    } catch (err) {
      return outage(err instanceof Error ? err.message : "Auth utilgjengelig");
    }
  };
}

function buildAdminCheck(platformService: PlatformService): ComponentCheck {
  return async () => {
    try {
      await platformService.listHalls({ includeInactive: true });
      return operational();
    } catch (err) {
      return outage(err instanceof Error ? err.message : "Admin utilgjengelig");
    }
  };
}

/**
 * Hovedinngang. Returnerer det `createPublicStatusRouter` trenger.
 */
export function bootstrapStatusPage(deps: StatusBootstrapDeps): StatusBootstrapResult {
  const { pool, schema, platformService, walletAdapter, engine, cacheTtlMs } = deps;

  const engineCheck = buildEngineCheck(engine);

  const statusService = new StatusService({
    pool,
    cacheTtlMs: cacheTtlMs ?? 30_000,
    checks: [
      { component: "api", displayName: "API", check: buildApiCheck() },
      { component: "database", displayName: "Database", check: buildDatabaseCheck(pool) },
      { component: "bingo", displayName: "Spill 1 (Bingo)", check: engineCheck },
      { component: "rocket", displayName: "Spill 2 (Rocket)", check: engineCheck },
      { component: "monsterbingo", displayName: "Spill 3 (Monsterbingo)", check: engineCheck },
      { component: "spillorama", displayName: "SpinnGo (Spill 4)", check: engineCheck },
      { component: "wallet", displayName: "Lommebok", check: buildWalletCheck(walletAdapter) },
      { component: "auth", displayName: "Innlogging", check: buildAuthCheck(pool) },
      { component: "admin", displayName: "Admin-panel", check: buildAdminCheck(platformService) },
      {
        component: "tv",
        displayName: "TV-skjerm",
        // TV-skjerm er en static route — den er oppe så lenge backend svarer.
        check: async () => operational(),
      },
    ],
  });

  const statusIncidentService = new StatusIncidentService({
    pool,
    schema,
  });

  return { statusService, statusIncidentService };
}
