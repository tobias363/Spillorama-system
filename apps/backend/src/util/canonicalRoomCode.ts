/**
 * Single-room-per-link-enforcement (Tobias 2026-04-27).
 *
 * Mapper game-slug + hall-id (+ optional groupId for Spill 1) til EN
 * deterministisk room-code:
 *   - bingo (Spill 1):       per-LINK (Group of Halls). Alle haller med samme
 *                            hall-group deler ett rom: `BINGO_<groupId>`.
 *                            Hvis hallen ikke er i en gruppe → fallback til
 *                            `BINGO_<hallId>` så enkeltståendel-haller fortsatt
 *                            fungerer (deterministisk + isolert).
 *   - rocket (Spill 2):      GLOBAL (alle haller deler ÉN rom: `ROCKET`).
 *   - monsterbingo (Spill 3): GLOBAL (`MONSTERBINGO`).
 *   - ukjent slug:           per-hall, slug uppercased.
 *
 * `effectiveHallId` returnerer `null` for shared rooms — caller bruker dette
 * til å markere rommet som hall-shared så `joinRoom` kan godta hvilken som
 * helst hall (HALL_MISMATCH-relaksering). For Spill 1 per-link er rommet
 * også shared mellom haller i samme gruppe, så `effectiveHallId=null`.
 */

export interface CanonicalRoomMapping {
  /** Deterministisk rom-kode brukt som primær-key i `BingoEngine.rooms`. */
  roomCode: string;
  /**
   * Den effektive hall-id-en som skal lagres på rommet. `null` betyr at rommet
   * er hall-shared (Spill 1 per-link, Spill 2/3 globalt) — alle haller kan joine.
   */
  effectiveHallId: string | null;
  /** True hvis dette er et shared room som ALLE relevante haller deler. */
  isHallShared: boolean;
}

/**
 * Mapper (gameSlug, hallId, groupId?) til kanonisk rom-kode + effektiv hall-binding.
 *
 * For Spill 2/3 returnerer ÉN global rom-kode uavhengig av hall/group-input —
 * de parametrene brukes ikke for shared global rooms.
 *
 * For Spill 1 brukes `groupId` som link-key. Hvis hallen ikke er i en gruppe
 * (groupId == null), faller vi tilbake til hallId så enkeltstående haller får
 * et deterministisk rom som ikke kolliderer med andre haller.
 *
 * For ukjente slugs er rommet per-hall (eksisterende oppførsel).
 *
 * Default-slug ved `undefined` er "bingo" (Spill 1) — matcher
 * `BingoEngine.createRoom` sin egen default.
 */
export function getCanonicalRoomCode(
  gameSlug: string | undefined,
  hallId: string,
  groupId?: string | null,
): CanonicalRoomMapping {
  const slug = (gameSlug ?? "bingo").toLowerCase().trim();

  if (slug === "rocket") {
    return { roomCode: "ROCKET", effectiveHallId: null, isHallShared: true };
  }

  if (slug === "monsterbingo") {
    return { roomCode: "MONSTERBINGO", effectiveHallId: null, isHallShared: true };
  }

  if (slug === "bingo" || slug === "") {
    // Per-LINK (Group of Halls): alle haller i samme gruppe deler rom.
    // Hvis hallen ikke er i en gruppe → fallback til hallId-basert kode.
    const linkKey = groupId ?? hallId;
    return {
      roomCode: `BINGO_${linkKey}`,
      effectiveHallId: null, // null = shared mellom haller i samme link
      isHallShared: true,
    };
  }

  // Ukjent slug: per-hall, kode = slug uppercased.
  return {
    roomCode: slug.toUpperCase(),
    effectiveHallId: hallId,
    isHallShared: false,
  };
}
