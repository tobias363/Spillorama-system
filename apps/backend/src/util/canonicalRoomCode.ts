/**
 * Single-room-per-link-enforcement (Tobias 2026-04-27).
 *
 * Mapper game-slug + hall-id til EN deterministisk room-code:
 *   - bingo (Spill 1):       per-hall (BINGO1)
 *   - rocket (Spill 2):      GLOBAL (alle haller deler ÉN rom)
 *   - monsterbingo (Spill 3): GLOBAL
 *   - ukjent slug:           per-hall, slug uppercased
 *
 * `effectiveHallId` returnerer `null` for shared rooms — caller bruker dette
 * til å markere rommet som hall-shared så `joinRoom` kan godta hvilken som
 * helst hall (HALL_MISMATCH-relaksering).
 */

export interface CanonicalRoomMapping {
  /** Deterministisk rom-kode brukt som primær-key i `BingoEngine.rooms`. */
  roomCode: string;
  /**
   * Den effektive hall-id-en som skal lagres på rommet. `null` betyr at rommet
   * er hall-shared (Spill 2/3) — alle haller kan joine.
   */
  effectiveHallId: string | null;
  /** True hvis dette er et shared room som ALLE haller deler. */
  isHallShared: boolean;
}

/**
 * Mapper (gameSlug, hallId) til kanonisk rom-kode + effektiv hall-binding.
 *
 * For Spill 2/3 returnerer ÉN global rom-kode uavhengig av hall-input —
 * hallId-parameteren brukes ikke for shared rooms.
 *
 * For Spill 1 og ukjente slugs er rommet per-hall (eksisterende oppførsel).
 *
 * Default-slug ved `undefined` er "bingo" (Spill 1) — matcher
 * `BingoEngine.createRoom` sin egen default.
 */
export function getCanonicalRoomCode(
  gameSlug: string | undefined,
  hallId: string,
): CanonicalRoomMapping {
  const slug = (gameSlug ?? "bingo").toLowerCase().trim();

  if (slug === "rocket") {
    return { roomCode: "ROCKET", effectiveHallId: null, isHallShared: true };
  }

  if (slug === "monsterbingo") {
    return { roomCode: "MONSTERBINGO", effectiveHallId: null, isHallShared: true };
  }

  if (slug === "bingo" || slug === "") {
    return { roomCode: "BINGO1", effectiveHallId: hallId, isHallShared: false };
  }

  // Ukjent slug: per-hall, kode = slug uppercased.
  return {
    roomCode: slug.toUpperCase(),
    effectiveHallId: hallId,
    isHallShared: false,
  };
}
