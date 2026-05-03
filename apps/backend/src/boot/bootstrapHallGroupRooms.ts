/**
 * 2026-05-02 (Tobias): boot-bootstrap som sikrer at hver aktive
 * group-of-halls har sitt kanoniske `BINGO_<groupId>`-rom i BingoEngine
 * når serveren starter.
 *
 * Bakgrunn: BingoEngine holder rom i in-memory state (ikke persistert til
 * DB). Ved hver Render-deploy / restart resettes denne staten — agentene
 * mister "Pågående spill"-vissning og må vente på at admin manuelt
 * oppretter rom på nytt. For pilot-haller med faste link-grupper er
 * dette uakseptabelt UX.
 *
 * Løsningen er deterministisk: vi henter alle aktive `app_hall_groups`
 * via `HallGroupService.list({ status: "active" })`, og for hver
 * gruppe sjekker vi om kanonisk rom-kode `BINGO_<groupId>` allerede
 * finnes i BingoEngine. Hvis ikke, oppretter vi det med
 * `effectiveHallId: null` (shared room) — samme oppførsel som
 * `POST /api/admin/rooms` etter PR #845.
 *
 * Idempotent: trygt å kjøre flere ganger, eksisterende rom rør vi ikke.
 *
 * Soft-fail: én feilet gruppe skal ikke ta ned hele boot. Vi logger og
 * fortsetter med neste.
 */

import type { BingoEngine } from "../game/BingoEngine.js";
import type { HallGroupService } from "../admin/HallGroupService.js";
import { getCanonicalRoomCode } from "../util/canonicalRoomCode.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "boot:hall-group-rooms" });

export interface BootstrapHallGroupRoomsDeps {
  engine: BingoEngine;
  hallGroupService: HallGroupService;
  /**
   * Optional: bind variant-config etter rom-create slik at engine kan
   * evaluere mønstre korrekt. Matcher `bindVariantConfigForRoom` i
   * AdminRouterDeps. Soft-fail hvis ikke satt.
   */
  bindVariantConfigForRoom?: (
    roomCode: string,
    opts: { gameSlug: string; gameManagementId?: string | null },
  ) => Promise<void>;
  /**
   * Optional: default-variant-binder. Brukes som fallback hvis
   * `bindVariantConfigForRoom` ikke er satt.
   */
  bindDefaultVariantConfig?: (roomCode: string, gameSlug: string) => void;
}

export interface BootstrapResult {
  /** Antall grupper vi inspiserte (inkl. de som hadde rom fra før). */
  inspected: number;
  /** Rom som ble nyopprettet (kanonisk-kode for hver). */
  created: string[];
  /** Rom som allerede fantes (idempotent skip). */
  skipped: string[];
  /** Grupper som feilet — typisk DB-feil eller missing master-hall. */
  errors: Array<{ groupId: string; reason: string }>;
}

export async function bootstrapHallGroupRooms(
  deps: BootstrapHallGroupRoomsDeps,
): Promise<BootstrapResult> {
  const result: BootstrapResult = {
    inspected: 0,
    created: [],
    skipped: [],
    errors: [],
  };

  let groups;
  try {
    groups = await deps.hallGroupService.list({ status: "active" });
  } catch (err) {
    log.error({ err }, "[boot] HallGroupService.list failed — skipping bootstrap");
    return result;
  }

  for (const group of groups) {
    result.inspected += 1;
    try {
      // Vi trenger en hall-id for å kalle getCanonicalRoomCode (selv om
      // koden bestemmes av group-id). Bruk første medlem som "creator".
      // Hvis gruppen ikke har medlemmer hopper vi over — ingenting å bootstrap.
      const firstMember = group.members[0];
      if (!firstMember) {
        log.debug(
          { groupId: group.id, name: group.name },
          "[boot] group has no members — skip",
        );
        continue;
      }

      const canonical = getCanonicalRoomCode(
        "bingo",
        firstMember.hallId,
        group.id,
      );

      // Idempotent: sjekk om rom allerede eksisterer.
      try {
        const existing = deps.engine.getRoomSnapshot(canonical.roomCode);
        if (existing) {
          result.skipped.push(canonical.roomCode);
          continue;
        }
      } catch (err) {
        const code = (err as { code?: string } | null)?.code ?? "";
        if (code !== "ROOM_NOT_FOUND") {
          throw err;
        }
        // Forventet — rom finnes ikke, fortsett til create.
      }

      // Opprett rom med system-host (ikke en faktisk bruker — host er en
      // teknisk plassholder som kreves av BingoEngine for å holde rommet
      // i live).
      const created = await deps.engine.createRoom({
        hallId: firstMember.hallId,
        playerName: `Boot Host ${group.name.slice(0, 16)}`,
        walletId: `boot-host-${group.id}`,
        roomCode: canonical.roomCode,
        ...(canonical.effectiveHallId === null
          ? { effectiveHallId: null }
          : {}),
      });

      // Bind variant-config så engine kan evaluere mønstre. Foretrekker
      // async binder med game-management-lookup; faller til default.
      if (deps.bindVariantConfigForRoom) {
        try {
          await deps.bindVariantConfigForRoom(created.roomCode, {
            gameSlug: "bingo",
          });
        } catch (err) {
          log.warn(
            { err, roomCode: created.roomCode },
            "[boot] bindVariantConfigForRoom failed — fallback to default",
          );
          deps.bindDefaultVariantConfig?.(created.roomCode, "bingo");
        }
      } else {
        deps.bindDefaultVariantConfig?.(created.roomCode, "bingo");
      }

      result.created.push(created.roomCode);
      log.info(
        {
          groupId: group.id,
          groupName: group.name,
          roomCode: created.roomCode,
          memberCount: group.members.length,
        },
        "[boot] bootstrapped shared room for hall-group",
      );
    } catch (err) {
      const reason =
        err instanceof Error ? err.message : String(err);
      result.errors.push({ groupId: group.id, reason });
      log.warn(
        { err, groupId: group.id, groupName: group.name },
        "[boot] bootstrap failed for hall-group — continuing with next",
      );
    }
  }

  log.info(
    {
      inspected: result.inspected,
      created: result.created.length,
      skipped: result.skipped.length,
      errors: result.errors.length,
    },
    "[boot] hall-group room bootstrap complete",
  );
  return result;
}
