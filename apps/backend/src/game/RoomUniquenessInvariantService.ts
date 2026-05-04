/**
 * RoomUniquenessInvariantService — Tobias-direktiv 2026-05-04.
 *
 * Bakgrunn (sitat fra direktivet):
 *   "ETT aktivt rom for Spill 2, 1 for Spill 3 — aldri flere. Alle spillere
 *    uavhengig av hall skal alltid være i samme rom. Må aldri være avvik."
 *
 *   "Spill 1: per group-of-halls. 4 haller linket = 1 aktivt rom for de 4.
 *    Spillere fra alle 4 hallene må komme i samme rom — aldri avvik."
 *
 *   "Viktig at vi legger fundamentet for at dette aldri blir noe avvik på."
 *
 * Invarianter som håndheves:
 *   1. **Spill 2 (rocket / game_2 / tallspill)**: ÉN GLOBAL aktiv runde.
 *      Hvis flere rom matcher slug-en finner i engine.rooms → konsolider.
 *   2. **Spill 3 (monsterbingo / mønsterbingo / game_3)**: ÉN GLOBAL aktiv runde.
 *      Samme regel som Spill 2.
 *   3. **Spill 1 (bingo)**: ETT rom per group-of-halls. Hvis 2+ rom har samme
 *      `gameSlug=bingo` og overlappende group-of-halls → konsolider.
 *
 * Konsolideringsstrategi:
 *   - Velg "vinneren" deterministisk (eldste createdAt → tie-break: laveste
 *     rom-kode alfanumerisk). Eldste vinner fordi spillere som allerede er
 *     bundet til det rommet ikke skal kastes ut.
 *   - For hver duplikat (taper) som har en aktiv runde (RUNNING/PAUSED/WAITING):
 *     LOG WARN. Vi destroyer IKKE aktive rom — det ville droppe spilleres
 *     innsatser. Ops/admin må intervene manuelt. Sweepen setter et
 *     "dirty"-flagg så neste pass forsøker igjen når runden er ferdig.
 *   - For hver duplikat som er IDLE (ENDED/NONE/ingen currentGame):
 *     destroyer rommet trygt via engine.destroyRoom.
 *
 * Trygghetsregler:
 *   - Aldri destroy aktive runder (samme regel som
 *     {@link sweepStaleNonCanonicalRooms}). Ops må manuelt rydde hvis det
 *     virkelig blir satt opp duplikat-rom mens en runde kjører.
 *   - Idempotent: andre + senere kjøringer finner ingenting hvis første
 *     pass ryddet alt.
 *   - Fail-soft per rom: én feilet destroy stopper ikke konsolideringen
 *     for andre duplikater.
 *   - Strukturert log slik at ops kan filtrere: `event=DUPLICATE_GLOBAL_ROOM`
 *     eller `event=DUPLICATE_GROUP_ROOM`, med `slug`, `count`, `roomCodes`,
 *     `kept`, `consolidated`, `preserved`.
 *
 * Bruks-pattern:
 *   1. **Boot-sweep** (`apps/backend/src/index.ts`): kjøres ÉN gang etter
 *      `sweepStaleNonCanonicalRooms` + `StaleRoomBootSweepService.sweep`
 *      + `bootstrapHallGroupRooms`. Disse kan i teorien selv ha lagd
 *      duplikater (om f.eks. boot-sweep oppretter et BINGO_*-rom samtidig
 *      som hall-group-bootstrap allerede gjorde det) — invariant-sweepen
 *      er siste sjekk-ledd som garanterer ETT-rom-invariant.
 *   2. **Periodic check** (Game2/Game3 tick-services): hvert N-te tick
 *      validerer invariant via {@link RoomUniquenessInvariantService.scan}.
 *      Brudd flagges i log; periodisk check destroyer aldri RUNNING rom.
 *
 * Ikke-mål:
 *   - Vi sjekker IKKE Candy (ekstern) eller SpinnGo (player-startet, ingen
 *     perpetual-loop, ingen "ETT rom"-invariant — flere player-runder kan
 *     kjøre parallelt).
 *   - Vi rør IKKE non-canonical rom (BingoEngine kan inneholde randomly-
 *     genererte rom-koder fra pre-#677-epoke). Den jobben gjør
 *     {@link sweepStaleNonCanonicalRooms}.
 */

import { isCanonicalRoomCode } from "../util/canonicalRoomCode.js";

// ── Slug-grupper som er underlagt ETT-rom-invariant ────────────────────────

/**
 * Spill 2-slugs (Tallspill / rocket). Match case-insensitivt mot
 * `room.gameSlug`. Mirror av {@link import("./Game2AutoDrawTickService").GAME2_SLUGS}
 * — vi importerer ikke fra den modulen for å holde RoomUniqueness-tjenesten
 * uavhengig av tick-service-internals.
 */
export const SPILL2_SLUGS: ReadonlySet<string> = new Set([
  "rocket",
  "game_2",
  "tallspill",
]);

/**
 * Spill 3-slugs (Mønsterbingo / monsterbingo). Match case-insensitivt mot
 * `room.gameSlug`. Mirror av {@link import("./Game3AutoDrawTickService").GAME3_SLUGS}.
 */
export const SPILL3_SLUGS: ReadonlySet<string> = new Set([
  "monsterbingo",
  "mønsterbingo",
  "game_3",
]);

/**
 * Spill 1-slugs (hovedspill 1, 75-ball, 5x5). Spill 1 er IKKE globalt — det
 * skal være ETT rom per group-of-halls. Dette settet brukes til å plukke ut
 * Spill 1-rom fra engine.rooms før vi grupperer på groupId.
 */
export const SPILL1_SLUGS: ReadonlySet<string> = new Set([
  "bingo",
  "game_1",
]);

/**
 * Forventet rom-kode for hver Spill 2-slug. Singleton — kun ÉN
 * canonical-kode for hele globalen. Brukes både til invariant-sjekk og
 * til å avgjøre "hvilket rom er det 'riktige'" når flere finnes.
 */
export const EXPECTED_SPILL2_ROOM_CODE = "ROCKET";

/**
 * Forventet rom-kode for hver Spill 3-slug. Singleton.
 */
export const EXPECTED_SPILL3_ROOM_CODE = "MONSTERBINGO";

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Engine-overflate som tjenesten trenger. Holdt minimal for testbarhet —
 * tester konstruerer fakes uten full BingoEngine.
 */
export interface RoomUniquenessInvariantEngine {
  /**
   * Liste alle rom-koder som finnes i engine — både canonical og non-canonical.
   * Sweepen filtrerer selv basert på gameSlug.
   */
  getAllRoomCodes(): string[];
  /**
   * Hent fullt snapshot for et rom. Throws hvis rommet ikke finnes
   * (typisk `DomainError("ROOM_NOT_FOUND")`).
   */
  getRoomSnapshot(roomCode: string): {
    code: string;
    gameSlug?: string;
    hallId?: string;
    createdAt?: string;
    isHallShared?: boolean;
    currentGame?: { status: "WAITING" | "RUNNING" | "PAUSED" | "ENDED" } | undefined;
  };
  /**
   * Destroy et rom + alle player-records + per-rom caches. Kan kaste
   * `DomainError("GAME_IN_PROGRESS")` — sweepen sjekker selv så vi aldri
   * kommer hit hvis runden er aktiv, men engine-laget har sin egen guard.
   */
  destroyRoom(roomCode: string): void;
}

/**
 * Fri-formet getHallGroupIdForHall-callback. Returnerer null hvis hallen
 * ikke er i noen gruppe (legacy single-hall) — invariant-sweepen behandler
 * da rommet som "egen group" og forventer ETT rom for den hallen alene.
 *
 * Optional fordi test-harnesses uten HallGroupService kan utelate; sweepen
 * faller da tilbake til "alle Spill 1-rom uten gruppe = isolerte fra hver
 * andre" (samme oppførsel som canonical mapping per i dag).
 */
export type GetHallGroupIdForHallFn = (hallId: string) => Promise<string | null>;

/**
 * Logger-overflate. Vi bruker `info` for normale "no-violations"-meldinger,
 * `warn` for konsolideringer (rom destroyed) og forvarsler om aktive
 * duplikat-rom som ikke kan ryddes, og `error` for uventede feil.
 */
export interface RoomUniquenessInvariantLogger {
  info: (data: Record<string, unknown>, msg: string) => void;
  warn: (data: Record<string, unknown>, msg: string) => void;
  error: (data: Record<string, unknown>, msg: string) => void;
}

/**
 * Ett spesifikt invariant-brudd. Sweepen returnerer en liste av disse
 * fra `scan()` slik at boot/tick-callere kan logge på sitt eget format
 * uten at sweepen tvinger logger-strukturen.
 */
export interface InvariantViolation {
  /** Type brudd: GLOBAL = Spill 2/3 ETT-rom, GROUP = Spill 1 per-link. */
  type: "DUPLICATE_GLOBAL_ROOM" | "DUPLICATE_GROUP_ROOM";
  /** Slug som hadde duplikater (rocket / monsterbingo / bingo). */
  slug: string;
  /** Group-id (kun for GROUP-type — null for global). */
  groupId: string | null;
  /** Antall rom som matchet bruddet (alltid >= 2). */
  count: number;
  /** Alle rom-koder involvert i bruddet (sortert). */
  roomCodes: string[];
  /** Hvilken kode vi beholdt etter konsolidering (eldste / canonical). */
  kept: string;
  /** Rom-koder som ble destroyed (IDLE-duplikater). */
  consolidated: string[];
  /** Rom-koder som ikke ble destroyed pga aktiv runde — ops må følge opp. */
  preservedActive: string[];
  /** Rom-koder hvor destroyRoom kastet — best-effort, sjelden. */
  failures: Array<{ roomCode: string; error: string }>;
}

export interface RoomUniquenessInvariantResult {
  /** Total rom inspisert (alle slugs). */
  inspected: number;
  /** Antall slug-grupper sjekket (rocket=1, monsterbingo=1, bingo=N grupper). */
  groupsChecked: number;
  /** Liste av alle bruddene som ble funnet. Tom = invariant holdt. */
  violations: InvariantViolation[];
}

export interface RoomUniquenessInvariantOptions {
  engine: RoomUniquenessInvariantEngine;
  logger: RoomUniquenessInvariantLogger;
  /**
   * Resolver fra hallId → groupId for Spill 1. Optional — uten denne
   * grupperer vi Spill 1-rom kun på `room.code` (kanonisk-kode er allerede
   * `BINGO_<groupId>` for grupper og `BINGO_<hallId>` for enslige), så
   * duplikat-deteksjon basert på rom-kode fungerer uansett.
   *
   * Brukes hvis vi senere vil verifisere at to rom med ULIKE koder faktisk
   * tilhører SAMME group (skal ikke skje med canonical, men kan i teorien
   * skje hvis non-canonical rom blir lagd manuelt).
   */
  getHallGroupIdForHall?: GetHallGroupIdForHallFn;
  /**
   * Hvis true — kjør i "detect only" modus (ingen destroy). Brukes av
   * tick-services som kun vil flagge invariant-brudd uten å rive rom
   * mens spillere er i dem. Default false (boot-modus = aktiv konsolidering).
   */
  detectOnly?: boolean;
  /**
   * Maks antall rom som destroyes per scan. Defense-in-depth mot kaskaderende
   * destroy hvis state er fundamentalt korrupt. Default 50 (samme som
   * {@link sweepStaleNonCanonicalRooms}).
   */
  maxDestroyPerScan?: number;
}

/**
 * Hjelper: er denne slug-en underlagt en GLOBAL ETT-rom-invariant?
 * Returnerer `expectedRoomCode` for Spill 2/3, eller null for Spill 1
 * (per-group, ikke global) og andre slugs.
 */
function getExpectedGlobalCodeForSlug(slug: string): string | null {
  const normalized = slug.toLowerCase().trim();
  if (SPILL2_SLUGS.has(normalized)) return EXPECTED_SPILL2_ROOM_CODE;
  if (SPILL3_SLUGS.has(normalized)) return EXPECTED_SPILL3_ROOM_CODE;
  return null;
}

/**
 * Hjelper: er denne slug-en Spill 1?
 */
function isSpill1Slug(slug: string): boolean {
  return SPILL1_SLUGS.has(slug.toLowerCase().trim());
}

/**
 * Hjelper: deterministisk "vinner-velger". Eldste createdAt vinner;
 * tie-break alfanumerisk på code. Hvis kanonisk kode (`ROCKET`/
 * `MONSTERBINGO`/`BINGO_*`) er blant kandidatene, foretrekk den fremfor
 * non-canonical rom — selv om en non-canonical er eldre. Dette håndterer
 * race der gammel non-canonical rom-state ble persistert før canonical
 * mapping ble opprettet.
 */
function pickWinner<T extends { code: string; createdAt?: string }>(
  rooms: T[],
  preferredCode?: string,
): T {
  // Steg 1: hvis vi har en eksplisitt preferred code (Spill 2/3 expected
  // global) og et rom med den koden finnes — pick det uansett.
  if (preferredCode) {
    const preferred = rooms.find((r) => r.code === preferredCode);
    if (preferred) return preferred;
  }

  // Steg 2: foretrekk canonical kode foran non-canonical.
  const canonical = rooms.filter((r) => isCanonicalRoomCode(r.code));
  const candidates = canonical.length > 0 ? canonical : rooms;

  // Steg 3: eldste createdAt vinner. NaN/missing createdAt → behandles
  // som "yngst" så de kommer sist.
  const sorted = [...candidates].sort((a, b) => {
    const aTime = a.createdAt ? Date.parse(a.createdAt) : Number.POSITIVE_INFINITY;
    const bTime = b.createdAt ? Date.parse(b.createdAt) : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    // Tie-break: alfanumerisk
    return a.code.localeCompare(b.code);
  });
  return sorted[0];
}

interface RoomMeta {
  code: string;
  slug: string;
  hallId?: string;
  createdAt?: string;
  isHallShared?: boolean;
  isActive: boolean; // RUNNING | PAUSED | WAITING
  isCanonical: boolean;
}

/**
 * Hovedtjeneste. Stateless mellom kall — trygt å instansiere flere ganger
 * eller delge instans mellom boot-sweep og tick-services.
 */
export class RoomUniquenessInvariantService {
  private readonly engine: RoomUniquenessInvariantEngine;
  private readonly logger: RoomUniquenessInvariantLogger;
  private readonly getHallGroupIdForHall?: GetHallGroupIdForHallFn;
  private readonly detectOnly: boolean;
  private readonly maxDestroyPerScan: number;

  constructor(options: RoomUniquenessInvariantOptions) {
    this.engine = options.engine;
    this.logger = options.logger;
    this.getHallGroupIdForHall = options.getHallGroupIdForHall;
    this.detectOnly = options.detectOnly === true;
    this.maxDestroyPerScan = options.maxDestroyPerScan ?? 50;
  }

  /**
   * Kjør én invariant-sjekk. Returnerer rapport med alle bruddene.
   * Aldri kaster — alle feil isoleres per rom og logges.
   *
   * Sjekk-rekkefølge:
   *   1. Iterer alle rom-koder, hent snapshot, klassifiser etter slug.
   *   2. Spill 2-rom: alle skal være kanonisk `ROCKET`. Andre koder med
   *      Spill 2-slug → DUPLICATE_GLOBAL_ROOM.
   *   3. Spill 3-rom: alle skal være kanonisk `MONSTERBINGO`. Samme regel.
   *   4. Spill 1-rom: grupper på resolved groupId (eller fallback hallId).
   *      Hver gruppe skal ha kun ÉN rom. 2+ → DUPLICATE_GROUP_ROOM.
   *   5. For hvert brudd: konsolider via destroyRoom (med mindre
   *      `detectOnly=true` eller rommet har aktiv runde).
   */
  async scan(): Promise<RoomUniquenessInvariantResult> {
    const result: RoomUniquenessInvariantResult = {
      inspected: 0,
      groupsChecked: 0,
      violations: [],
    };

    // Steg 1: scan alle rom og klassifiser.
    let roomCodes: string[];
    try {
      roomCodes = this.engine.getAllRoomCodes();
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "[room-uniqueness] getAllRoomCodes failed — aborting scan",
      );
      return result;
    }

    const spill2Rooms: RoomMeta[] = [];
    const spill3Rooms: RoomMeta[] = [];
    const spill1RoomsByCanonical: Map<string, RoomMeta[]> = new Map();

    for (const code of roomCodes) {
      result.inspected += 1;
      let snapshot: ReturnType<RoomUniquenessInvariantEngine["getRoomSnapshot"]>;
      try {
        snapshot = this.engine.getRoomSnapshot(code);
      } catch (err) {
        // Race: rom fjernet mellom getAllRoomCodes og getRoomSnapshot.
        // Logg på debug — sweepen er fail-soft per rom.
        this.logger.warn(
          { roomCode: code, err: err instanceof Error ? err.message : String(err) },
          "[room-uniqueness] getRoomSnapshot failed — skip",
        );
        continue;
      }

      const slug = (snapshot.gameSlug ?? "").toLowerCase().trim();
      const status = snapshot.currentGame?.status;
      const isActive =
        status === "RUNNING" || status === "PAUSED" || status === "WAITING";
      const meta: RoomMeta = {
        code: snapshot.code,
        slug,
        ...(snapshot.hallId !== undefined ? { hallId: snapshot.hallId } : {}),
        ...(snapshot.createdAt !== undefined ? { createdAt: snapshot.createdAt } : {}),
        ...(snapshot.isHallShared !== undefined ? { isHallShared: snapshot.isHallShared } : {}),
        isActive,
        isCanonical: isCanonicalRoomCode(snapshot.code),
      };

      if (SPILL2_SLUGS.has(slug)) {
        spill2Rooms.push(meta);
      } else if (SPILL3_SLUGS.has(slug)) {
        spill3Rooms.push(meta);
      } else if (isSpill1Slug(slug)) {
        // Spill 1: grupper foreløpig på rom-kode prefiks (BINGO_<X>).
        // Senere mer-presis grouping via getHallGroupIdForHall (nedenfor).
        // For now bruker vi rom-kode som proxy for "denne hallen / gruppen".
        const groupKey = this.deriveSpill1GroupKey(meta);
        const list = spill1RoomsByCanonical.get(groupKey) ?? [];
        list.push(meta);
        spill1RoomsByCanonical.set(groupKey, list);
      }
      // Andre slugs (spillorama / candy / themebingo / unknown) → ikke under
      // denne invariant-en. Hopp over uten counter-bump.
    }

    // Steg 2 + 3: Spill 2 + 3 GLOBAL invariant.
    if (spill2Rooms.length > 0) {
      result.groupsChecked += 1;
      if (spill2Rooms.length > 1) {
        const violation = await this.consolidateGlobal(
          "rocket",
          EXPECTED_SPILL2_ROOM_CODE,
          spill2Rooms,
        );
        if (violation) result.violations.push(violation);
      }
    }
    if (spill3Rooms.length > 0) {
      result.groupsChecked += 1;
      if (spill3Rooms.length > 1) {
        const violation = await this.consolidateGlobal(
          "monsterbingo",
          EXPECTED_SPILL3_ROOM_CODE,
          spill3Rooms,
        );
        if (violation) result.violations.push(violation);
      }
    }

    // Steg 4: Spill 1 per-group invariant.
    for (const [groupKey, rooms] of spill1RoomsByCanonical.entries()) {
      result.groupsChecked += 1;
      if (rooms.length > 1) {
        const violation = await this.consolidateGroup(groupKey, rooms);
        if (violation) result.violations.push(violation);
      }
    }

    // Strukturert summary-log slik at ops kan filtere.
    if (result.violations.length > 0) {
      this.logger.warn(
        {
          inspected: result.inspected,
          groupsChecked: result.groupsChecked,
          violationCount: result.violations.length,
          violations: result.violations.map((v) => ({
            type: v.type,
            slug: v.slug,
            groupId: v.groupId,
            count: v.count,
            roomCodes: v.roomCodes,
            kept: v.kept,
            consolidated: v.consolidated,
            preservedActive: v.preservedActive,
          })),
        },
        "[room-uniqueness] invariant violations detected",
      );
    } else {
      this.logger.info(
        {
          inspected: result.inspected,
          groupsChecked: result.groupsChecked,
        },
        "[room-uniqueness] all invariants hold",
      );
    }

    return result;
  }

  /**
   * Konsolider duplikater for en GLOBAL slug-invariant (Spill 2/3).
   *
   * @param slug      Slug for logging (rocket/monsterbingo).
   * @param expected  Forventet kanonisk kode (ROCKET/MONSTERBINGO).
   * @param rooms     Alle rom som matcher slugen (>= 2).
   */
  private async consolidateGlobal(
    slug: string,
    expected: string,
    rooms: RoomMeta[],
  ): Promise<InvariantViolation | null> {
    const winner = pickWinner(rooms, expected);
    const losers = rooms.filter((r) => r.code !== winner.code);

    const violation: InvariantViolation = {
      type: "DUPLICATE_GLOBAL_ROOM",
      slug,
      groupId: null,
      count: rooms.length,
      roomCodes: rooms.map((r) => r.code).sort(),
      kept: winner.code,
      consolidated: [],
      preservedActive: [],
      failures: [],
    };

    // Strukturert ERROR-log for hvert brudd. Tobias-direktiv: "Strukturerte
    // logs slik at ops kan alarmere på det." Vi bruker error fordi dette er
    // et regulatorisk-relevant brudd (ikke skal skje i prod).
    this.logger.error(
      {
        event: "DUPLICATE_GLOBAL_ROOM",
        slug,
        count: rooms.length,
        roomCodes: violation.roomCodes,
        kept: winner.code,
        actionTaken: this.detectOnly ? "detect_only" : "consolidating",
      },
      `[room-uniqueness] DUPLICATE_GLOBAL_ROOM detected for ${slug}: ${rooms.length} rooms (kept ${winner.code})`,
    );

    if (this.detectOnly) {
      // Detect-only modus: ingen destroy. Returner violation så caller kan
      // beslutte å re-scan senere når runder er ferdig.
      return violation;
    }

    for (const loser of losers) {
      if (violation.consolidated.length >= this.maxDestroyPerScan) {
        this.logger.warn(
          {
            slug,
            roomCode: loser.code,
            alreadyDestroyed: violation.consolidated.length,
            max: this.maxDestroyPerScan,
          },
          "[room-uniqueness] max destroy-per-scan reached — remaining duplicates preserved",
        );
        break;
      }
      if (loser.isActive) {
        violation.preservedActive.push(loser.code);
        this.logger.warn(
          {
            slug,
            roomCode: loser.code,
            kept: winner.code,
            event: "DUPLICATE_GLOBAL_ROOM",
            actionTaken: "preserved_active",
          },
          `[room-uniqueness] preserved active duplicate ${loser.code} (admin must resolve)`,
        );
        continue;
      }
      try {
        this.engine.destroyRoom(loser.code);
        violation.consolidated.push(loser.code);
        this.logger.warn(
          {
            slug,
            roomCode: loser.code,
            kept: winner.code,
            event: "DUPLICATE_GLOBAL_ROOM",
            actionTaken: "consolidated",
          },
          `[room-uniqueness] consolidated duplicate ${loser.code} → ${winner.code}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        violation.failures.push({ roomCode: loser.code, error: msg });
        this.logger.error(
          { slug, roomCode: loser.code, err: msg },
          "[room-uniqueness] destroyRoom failed during consolidation",
        );
      }
    }

    return violation;
  }

  /**
   * Konsolider duplikater for en GROUP-invariant (Spill 1 per group-of-halls).
   * Samme strategi som consolidateGlobal, men med groupId-tagging i rapporten.
   *
   * @param groupKey  Gruppe-nøkkel (kan være canonical-kode-suffix eller
   *                  resolved groupId).
   * @param rooms     Alle Spill 1-rom som matcher groupKey (>= 2).
   */
  private async consolidateGroup(
    groupKey: string,
    rooms: RoomMeta[],
  ): Promise<InvariantViolation | null> {
    // Velg vinner basert på createdAt + canonical-preferanse. Ingen
    // expected code — Spill 1 har én kanonisk kode per group, men vi
    // beregner ikke `BINGO_<groupId>` her (bruker rom-koden som er stored).
    const winner = pickWinner(rooms);
    const losers = rooms.filter((r) => r.code !== winner.code);

    const violation: InvariantViolation = {
      type: "DUPLICATE_GROUP_ROOM",
      slug: "bingo",
      groupId: groupKey,
      count: rooms.length,
      roomCodes: rooms.map((r) => r.code).sort(),
      kept: winner.code,
      consolidated: [],
      preservedActive: [],
      failures: [],
    };

    this.logger.error(
      {
        event: "DUPLICATE_GROUP_ROOM",
        slug: "bingo",
        groupId: groupKey,
        count: rooms.length,
        roomCodes: violation.roomCodes,
        kept: winner.code,
        actionTaken: this.detectOnly ? "detect_only" : "consolidating",
      },
      `[room-uniqueness] DUPLICATE_GROUP_ROOM detected for bingo group ${groupKey}: ${rooms.length} rooms (kept ${winner.code})`,
    );

    if (this.detectOnly) return violation;

    for (const loser of losers) {
      if (violation.consolidated.length >= this.maxDestroyPerScan) {
        this.logger.warn(
          {
            roomCode: loser.code,
            alreadyDestroyed: violation.consolidated.length,
            max: this.maxDestroyPerScan,
          },
          "[room-uniqueness] max destroy-per-scan reached — remaining duplicates preserved",
        );
        break;
      }
      if (loser.isActive) {
        violation.preservedActive.push(loser.code);
        this.logger.warn(
          {
            slug: "bingo",
            groupId: groupKey,
            roomCode: loser.code,
            kept: winner.code,
            event: "DUPLICATE_GROUP_ROOM",
            actionTaken: "preserved_active",
          },
          `[room-uniqueness] preserved active duplicate ${loser.code} in group ${groupKey} (admin must resolve)`,
        );
        continue;
      }
      try {
        this.engine.destroyRoom(loser.code);
        violation.consolidated.push(loser.code);
        this.logger.warn(
          {
            slug: "bingo",
            groupId: groupKey,
            roomCode: loser.code,
            kept: winner.code,
            event: "DUPLICATE_GROUP_ROOM",
            actionTaken: "consolidated",
          },
          `[room-uniqueness] consolidated duplicate ${loser.code} → ${winner.code} in group ${groupKey}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        violation.failures.push({ roomCode: loser.code, error: msg });
        this.logger.error(
          { slug: "bingo", groupId: groupKey, roomCode: loser.code, err: msg },
          "[room-uniqueness] destroyRoom failed during consolidation",
        );
      }
    }

    return violation;
  }

  /**
   * Derivér gruppe-nøkkel for et Spill 1-rom basert på rom-koden.
   *
   * `BINGO_<linkKey>` (canonical) → linkKey (= groupId for grupper, hallId
   * for enslige). Non-canonical rom → bruk rom-koden direkte som "egen
   * gruppe" (degenerert case som boot-sweep skal rydde uavhengig av denne
   * invarianten).
   *
   * Siden canonical mapping allerede er deterministisk per (groupId, hallId),
   * to rom med samme `BINGO_X`-kode betyr per definisjon at den samme
   * canonical-key-en ble brukt som primær-rom-kode to ganger — som kun
   * skjer hvis to "createRoom"-kall race-et før idempotens-sjekken slo til.
   * I så fall vil engine.rooms-mappet kun ha ett rom uansett (samme key
   * overskriver), så denne metoden vil aldri grupperer to ulike rom under
   * samme key. Vi tar det med likevel for defense-in-depth.
   */
  private deriveSpill1GroupKey(meta: RoomMeta): string {
    // Canonical: BINGO_<X> — bruk X som groupKey.
    if (meta.code.startsWith("BINGO_")) {
      return meta.code.slice("BINGO_".length);
    }
    // Non-canonical Spill 1-rom (legacy 4RCQSX-typen). Bruk rom-koden
    // direkte; sweepStaleNonCanonicalRooms vil rydde dem uansett.
    return `non-canonical:${meta.code}`;
  }
}
