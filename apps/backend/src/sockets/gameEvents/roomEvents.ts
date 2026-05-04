/**
 * PR-R4: Room-lifecycle + pre-round arming/lucky-number socket handlers.
 *
 * Cluster inneholder:
 *   - room:create   (oppretter rom eller attacher til kanonisk hall-rom)
 *   - room:join     (joine eksisterende rom, med BINGO1-alias)
 *   - room:resume   (reconnect — attach player-socket)
 *   - room:configure (oppdater entryFee)
 *   - room:state    (snapshot-query — tillater ROOM_NOT_FOUND for SPA auto-create)
 *   - bet:arm       (pre-round ticket-valg, additiv merge)
 *   - lucky:set     (pre-round lykketall 1..60)
 *
 * Hvorfor sammen: alle mutterer / leser "room state før game running". `bet:arm`
 * og `lucky:set` er pre-round-operasjoner som logisk hører til rommet, ikke
 * tickets (de endrer ikke Ticket-objektet selv).
 *
 * Uendret fra opprinnelig `gameEvents.ts`:
 *   - Event-navn og payload-typer
 *   - try/catch-strukturen rundt hvert handler-kall
 *   - Rate-limit + auth via `ctx.rateLimited` / `ctx.requireAuthenticatedPlayerAction`
 */
import { toPublicError } from "../../game/BingoEngine.js";
import { DomainError } from "../../errors/DomainError.js";
import {
  mustBeNonEmptyString,
  parseOptionalNonNegativeNumber,
} from "../../util/httpHelpers.js";
import type { SocketContext } from "./context.js";
import type {
  AckResponse,
  BetArmLossLimitInfo,
  ConfigureRoomPayload,
  CreateRoomPayload,
  JoinRoomPayload,
  LuckyNumberPayload,
  ResumeRoomPayload,
  RoomActionPayload,
  RoomStatePayload,
} from "./types.js";
import type { RoomSnapshot } from "../../game/types.js";
import type { GameEventsDeps } from "./deps.js";
import { walletRoomKey } from "../walletStatePusher.js";
import { getCanonicalRoomCode, isCanonicalRoomCode } from "../../util/canonicalRoomCode.js";
import { logger as rootLogger } from "../../util/logger.js";
import { logRoomEvent } from "../../util/roomLogVerbose.js";

const roomEventsLogger = rootLogger.child({ module: "socket.room" });

/**
 * Demo Hall bypass (Tobias 2026-04-27): hent `isTestHall` fra
 * `app_halls.is_test_hall` så `RoomState.isTestHall` propageres riktig
 * til `BingoEnginePatternEval.evaluateActivePhase`. Uten dette slår
 * Spill 1 auto-pause (PR #643) inn etter Phase 1 og /web/-spillet henger.
 *
 * Fail-soft: hvis lookup feiler (DB-feil, ukjent hall, manglende
 * `platformService` i test-harness) returnerer vi `false` slik at
 * eksisterende prod-haller forblir uendret. Lookup-feil logges men
 * blokkerer ikke createRoom.
 */
async function lookupIsTestHall(
  deps: Pick<GameEventsDeps, "platformService">,
  hallId: string,
  log: { warn: (data: unknown, msg: string) => void },
): Promise<boolean> {
  if (!deps.platformService?.getHall) return false;
  try {
    const hall = await deps.platformService.getHall(hallId);
    return hall.isTestHall === true;
  } catch (err) {
    log.warn({ err, hallId }, "lookupIsTestHall failed — defaulting to false");
    return false;
  }
}

/**
 * BIN-693 Option B: reserver delta-beløp for pre-round bong-kjøp.
 *
 * `previousWeighted` er antall brett (vektet) allerede armed for denne spilleren
 * i rommet. `newTotalWeighted` er det ønskede totalen etter denne bet:arm-call.
 * Delta = (newTotalWeighted - previousWeighted) × entryFee.
 *
 * Ved delta > 0: enten increase eksisterende reservation eller opprette ny.
 * Ved delta ≤ 0: no-op (ticket:cancel håndterer reduksjon).
 *
 * Kaster INSUFFICIENT_FUNDS (via adapter) hvis tilgjengelig saldo ikke dekker.
 * Rullback er idempotent — in-memory armed-state oppdateres først etter
 * wallet-reserve er committed.
 *
 * BIN-CRITICAL fix (2026-04-25, Tobias): tidligere versjon hadde fem silent
 * early-returns som skjulte regulatorisk-relevante feil. Konkret scenario:
 *   - dev-miljøet kjører med `AUTO_ROUND_ENTRY_FEE=0`
 *   - klient-popup falbacker til `entryFee || 10` og viser "30 kr per Large"
 *   - server beregner `deltaKr = 30 × 0 = 0` og returnerer uten å reservere
 *   - `armPlayer(...)` kjøres uansett → 30 brett står armed uten reservasjon
 *   - bruker mener han har kjøpt 1800 kr på 1000 kr saldo
 * Fix: hvis entryFee er 0 logges advarsel; hvis entryFee > 0 og noen prereq
 * mangler kastes INSUFFICIENT_FUNDS slik at `bet:arm` faktisk feiler og
 * `armPlayer` aldri kjøres for ureservert betting.
 */
export async function reservePreRoundDelta(
  deps: GameEventsDeps,
  roomCode: string,
  playerId: string,
  previousWeighted: number,
  newTotalWeighted: number,
): Promise<void> {
  const adapter = deps.walletAdapter;

  // Test-harness: hvis ingen wallet-adapter er konfigurert i det hele tatt,
  // er dette ikke prod-kode. Gjelder kun integrationsTester som mocker ut
  // hele wallet-laget.
  if (!adapter?.reserve || !adapter.increaseReservation) return;

  // Prod-prereq: deps må være wired up. Hvis ikke, har en deploy gått galt
  // og fail-closed er den eneste forsvarlige responsen.
  if (!deps.getWalletIdForPlayer || !deps.getReservationId || !deps.setReservationId) {
    throw new DomainError(
      "INSUFFICIENT_FUNDS",
      "Wallet-tjenesten er ikke tilgjengelig. Prøv igjen senere.",
    );
  }

  const deltaWeighted = newTotalWeighted - previousWeighted;
  if (deltaWeighted <= 0) return; // Ingen nye brett å betale for.

  const entryFee = deps.getRoomConfiguredEntryFee(roomCode);
  const deltaKr = deltaWeighted * entryFee;

  // Free play: entryFee=0 (eks. dev `AUTO_ROUND_ENTRY_FEE=0`). Logg slik at
  // det er åpenbart i logger at ingen reservasjon ble laget — auditor kan
  // grep-e "entryFee=0" og se at det ikke er stilthet å gjemme seg bak.
  if (deltaKr <= 0) {
    if (entryFee !== 0) {
      // entryFee > 0 men deltaKr <= 0 — kan kun skje med floating-point bug.
      throw new DomainError(
        "INVALID_INPUT",
        `Beregnet innsats ${deltaKr} kr er ugyldig (entryFee=${entryFee}, deltaWeighted=${deltaWeighted}).`,
      );
    }
    console.warn(
      `[wallet-reservation] entryFee=0 for room ${roomCode} — bet:arm uten ` +
        `reservasjon. Sett AUTO_ROUND_ENTRY_FEE eller room:configure for ekte ` +
        `pengespill.`,
    );
    return;
  }

  const walletId = deps.getWalletIdForPlayer(roomCode, playerId);
  if (!walletId) {
    // Spiller har ingen wallet i room snapshot — kan skje hvis player
    // dropped/rejoined under en pågående arm. Fail-closed: ikke arm uten
    // wallet-binding. Klient får en klar feil i stedet for stille suksess.
    throw new DomainError(
      "INSUFFICIENT_FUNDS",
      "Fant ikke lommebok for spilleren. Last siden på nytt.",
    );
  }

  const existingResId = deps.getReservationId(roomCode, playerId);
  if (existingResId) {
    await adapter.increaseReservation(existingResId, deltaKr);
    return;
  }

  // PR #513 §1.3 (idempotency-fix): tidligere brukte vi
  // `${Date.now()}-${Math.random()...}` her — som per definisjon var nye
  // verdier ved hver retry, så `reserve()`-idempotency aldri kunne matche.
  // Hvis socket-laget re-emit-et samme `bet:arm` (typisk under
  // reconnect/disconnect-flapping) endte vi opp med flere DB-reservasjoner
  // som hver låste penger til 30-minutters TTL utløp.
  //
  // Deterministisk key: `arm-${roomCode}-${playerId}-${newTotalWeighted}`.
  // Logikk: `newTotalWeighted` endres ved hver legitim ny bet:arm-call
  // (mer eller færre brett), så et legitimt nytt kjøp får ny key og blir
  // en ny reservasjon. Men en duplikat-emit av samme `bet:arm` (samme
  // total) får samme key → adapter.reserve returnerer eksisterende
  // reservasjon i stedet for å lage en ny.
  //
  // NB: dette dekker reservation-creation. Increase-pathen (over) bruker
  // reservation-id direkte, så increaseReservation må selv være idempotent
  // hvis vi vil dekke det case-et — pr i dag har vi ikke retry-deduplisering
  // der, men socket.io ack/nack gir én-gangs-levering for de fleste retry-
  // scenarioene.
  // Pilot-bug fix 2026-04-27 (Tobias-rapport): inkluder armCycleId i keyen så
  // pre-purchase i runde N+1 ikke kolliderer med committed reservation fra
  // runde N. Backward-compat: faller tilbake til pre-fix-format hvis dep mangler.
  const armCycleId = deps.getArmCycleId?.(roomCode);
  const idempotencyKey = armCycleId
    ? `arm-${roomCode}-${playerId}-${armCycleId}-${newTotalWeighted}`
    : `arm-${roomCode}-${playerId}-${newTotalWeighted}`;
  const reservation = await adapter.reserve(walletId, deltaKr, {
    idempotencyKey,
    roomCode,
  });
  deps.setReservationId(roomCode, playerId, reservation.id);
}

/** Frigi hele reservasjonen (disarm / cancel-all). */
async function releasePreRoundReservation(
  deps: GameEventsDeps,
  roomCode: string,
  playerId: string,
): Promise<void> {
  const adapter = deps.walletAdapter;
  if (!adapter?.releaseReservation) return;
  if (!deps.getReservationId || !deps.clearReservationId) return;

  const resId = deps.getReservationId(roomCode, playerId);
  if (!resId) return;
  try {
    await adapter.releaseReservation(resId);
  } catch {
    // Allerede released/committed — trygt å ignorere (ticket:cancel kan
    // race med disarm). Neste bet:arm lager ny reservation.
  }
  deps.clearReservationId(roomCode, playerId);
}

export function registerRoomEvents(ctx: SocketContext): void {
  const {
    socket,
    deps,
    engine,
    logger,
    ackSuccess,
    ackFailure,
    setLuckyNumber,
    getAuthenticatedSocketUser,
    assertUserCanAccessRoom,
    rateLimited,
    requireAuthenticatedPlayerAction,
    resolveIdentityFromPayload,
  } = ctx;
  const {
    emitRoomUpdate,
    buildRoomUpdatePayload,
    enforceSingleRoomPerHall,
    getPrimaryRoomForHall,
    findPlayerInRoomByWallet,
    armPlayer,
    disarmPlayer,
  } = deps;

  socket.on("room:create", rateLimited("room:create", async (payload: CreateRoomPayload, callback: (response: AckResponse<{ roomCode: string; playerId: string; snapshot: RoomSnapshot }>) => void) => {
    logger.debug({ hallId: payload?.hallId, hasAccessToken: !!payload?.accessToken }, "BIN-134: room:create received");
    try {
      const identity = await resolveIdentityFromPayload(payload);
      logger.debug({ hallId: identity.hallId }, "BIN-134: room:create identity resolved");

      const requestedGameSlug = typeof payload?.gameSlug === "string" ? payload.gameSlug : undefined;
      // LIVE_ROOM_OBSERVABILITY 2026-04-29: structured INFO-log før we go into
      // canonical-resolution + auto-create. Inkluderer wallet-id og hall slik
      // at ops kan grep historikken når en spiller rapporterer "kunne ikke
      // joine" / "stuck on loading".
      logRoomEvent(
        roomEventsLogger,
        {
          socketId: socket.id,
          walletId: identity.walletId,
          hallId: identity.hallId,
          requestedSlug: requestedGameSlug ?? null,
        },
        "socket.room.create-request",
      );
      // Canonical mapping (Tobias 2026-04-27):
      //   Spill 1 (bingo)         → BINGO_<groupId|hallId>, per-LINK (Group of
      //                             Halls). Alle haller i samme gruppe deler
      //                             rom; haller uten gruppe får hallId-basert
      //                             fallback.
      //   Spill 2 (rocket)        → ROCKET, shared global (hallId=null)
      //   Spill 3 (monsterbingo)  → MONSTERBINGO, shared global (hallId=null)
      // groupId-oppslag er fire-and-fail-soft — feil eller manglende dep gir
      // null så vi faller tilbake til hallId-basert kode (eksisterende
      // oppførsel for haller uten gruppe).
      let canonicalGroupId: string | null = null;
      if (enforceSingleRoomPerHall && deps.getHallGroupIdForHall) {
        try {
          canonicalGroupId = await deps.getHallGroupIdForHall(identity.hallId);
        } catch (err) {
          logger.warn({ err, hallId: identity.hallId }, "getHallGroupIdForHall failed; falling back to hallId-based room code");
        }
      }
      const canonicalMapping = enforceSingleRoomPerHall
        ? getCanonicalRoomCode(requestedGameSlug, identity.hallId, canonicalGroupId)
        : null;
      // Demo Hall bypass (Tobias 2026-04-27): propager `isTestHall` slik at
      // `RoomState.isTestHall=true` for test-haller — ellers slår Spill 1
      // auto-pause inn etter Phase 1 og spillet henger i /web/-flyten.
      const isTestHall = await lookupIsTestHall(deps, identity.hallId, logger);

      // Bug B fix (Tobias 2026-04-28): canonical-aware lookup.
      // Tidligere brukte vi `getPrimaryRoomForHall(hallId)` som filtrerer
      // på `room.hallId === hallId`. For Spill 1 group-of-halls-rom og
      // Spill 2/3 shared-rooms er `room.hallId` whoever opprettet rommet
      // — ikke nødvendigvis den joinende spillerens hall. Resultat: Hall B
      // som vil joine et rom skapt av Hall A i samme gruppe fant ingen
      // canonical-match → fall through til random `4RCQSX`-kode-flyt og
      // "Spiller deltar allerede i et annet aktivt spill"-feil.
      //
      // Ny logikk: ALLTID slå opp via `engine.findRoomByCode(canonicalCode)`
      // når vi har en canonical mapping. Hvis rommet finnes (uansett hvem
      // som opprettet det) → join. `RoomState.isHallShared=true` i shared
      // rooms tillater allerede cross-hall join uten HALL_MISMATCH.
      if (enforceSingleRoomPerHall && canonicalMapping) {
        const existingCanonical = engine.findRoomByCode(canonicalMapping.roomCode);
        if (existingCanonical) {
          // Bug A fix (Tobias 2026-04-28): refresh `isTestHall` på
          // eksisterende rom så test-haller som ble opprettet før deploy
          // av PR #671 (eller hvis admin senere endrer `is_test_hall`-
          // flagget) får oppdatert state. No-op hvis verdien matcher.
          engine.setRoomTestHall(existingCanonical.code, isTestHall);

          // PILOT-EMERGENCY 2026-04-28 (Tobias): rydd stale wallet-binding
          // i non-canonical legacy-rom FØR vi joiner. Disse er pre-#677
          // 4RCQSX-leftovers som blokkerer assertWalletNotInRunningGame.
          // Trygt fordi target er canonical og isHallShared=true tillater
          // cross-hall reconnect.
          const cleanedCreate = engine.cleanupStaleWalletInNonCanonicalRooms(
            identity.walletId,
            isCanonicalRoomCode,
          );
          if (cleanedCreate > 0) {
            logger.warn(
              { walletId: identity.walletId, cleaned: cleanedCreate, target: existingCanonical.code },
              "[room:create] cleared stale wallet-bindings in non-canonical rooms",
            );
          }

          const canonicalSnapshot = engine.getRoomSnapshot(existingCanonical.code);
          const existingPlayer = findPlayerInRoomByWallet(canonicalSnapshot, identity.walletId);

          let playerId = existingPlayer?.id ?? "";
          if (existingPlayer) {
            engine.attachPlayerSocket(existingCanonical.code, existingPlayer.id, socket.id);
          } else {
            // FORHANDSKJOP-ORPHAN-FIX (PR 2): preserve players whose
            // armed-state or wallet reservation is still in-flight in
            // RoomStateManager — otherwise the cleanup pass would orphan
            // their forhåndskjøp on the next round.
            engine.cleanupStaleWalletInIdleRooms(identity.walletId, {
              exceptRoomCode: existingCanonical.code,
              isPreserve: deps.hasArmedOrReservation
                ? (code, pid) => deps.hasArmedOrReservation!(code, pid)
                : undefined,
            });
            const joined = await engine.joinRoom({
              roomCode: existingCanonical.code,
              hallId: identity.hallId,
              playerName: identity.playerName,
              walletId: identity.walletId,
              socketId: socket.id
            });
            playerId = joined.playerId;
          }

          socket.join(existingCanonical.code);
          socket.join(walletRoomKey(identity.walletId));
          // Tobias-direktiv 2026-05-03: Spill 2/3 perpetual auto-spawn.
          // room:create-paths trenger samme trigger som room:join (per
          // Agent Q diagnose) — Spill 2-klienten emitter room:create.
          if (deps.spawnFirstRoundIfNeeded) {
            try {
              await deps.spawnFirstRoundIfNeeded(existingCanonical.code);
            } catch (err) {
              logger.warn({ err, roomCode: existingCanonical.code }, "spawnFirstRoundIfNeeded failed (best-effort)");
            }
          }
          const snapshot = await emitRoomUpdate(existingCanonical.code);
          logger.debug({ roomCode: existingCanonical.code }, "BIN-134: room:create → existing canonical");
          ackSuccess(callback, { roomCode: existingCanonical.code, playerId, snapshot });
          return;
        }
      } else if (enforceSingleRoomPerHall) {
        // Backward-compat: hvis vi IKKE har en canonical mapping (ukjent
        // slug eller manglende mapping), fortsett med legacy hallId-basert
        // primær-rom-lookup. Eksisterende oppførsel for ikke-Spill-1/2/3.
        const canonicalRoom = getPrimaryRoomForHall(identity.hallId);
        if (canonicalRoom) {
          engine.setRoomTestHall(canonicalRoom.code, isTestHall);

          const canonicalSnapshot = engine.getRoomSnapshot(canonicalRoom.code);
          const existingPlayer = findPlayerInRoomByWallet(canonicalSnapshot, identity.walletId);

          let playerId = existingPlayer?.id ?? "";
          if (existingPlayer) {
            engine.attachPlayerSocket(canonicalRoom.code, existingPlayer.id, socket.id);
          } else {
            // FORHANDSKJOP-ORPHAN-FIX (PR 2): see comment at the parallel
            // canonical-mapping branch above — preserve armed/reserved
            // players to avoid orphaning forhåndskjøp.
            engine.cleanupStaleWalletInIdleRooms(identity.walletId, {
              exceptRoomCode: canonicalRoom.code,
              isPreserve: deps.hasArmedOrReservation
                ? (code, pid) => deps.hasArmedOrReservation!(code, pid)
                : undefined,
            });
            const joined = await engine.joinRoom({
              roomCode: canonicalRoom.code,
              hallId: identity.hallId,
              playerName: identity.playerName,
              walletId: identity.walletId,
              socketId: socket.id
            });
            playerId = joined.playerId;
          }

          socket.join(canonicalRoom.code);
          socket.join(walletRoomKey(identity.walletId));
          // Tobias-direktiv 2026-05-03: Spill 2/3 perpetual auto-spawn på room:create.
          if (deps.spawnFirstRoundIfNeeded) {
            try {
              await deps.spawnFirstRoundIfNeeded(canonicalRoom.code);
            } catch (err) {
              logger.warn({ err, roomCode: canonicalRoom.code }, "spawnFirstRoundIfNeeded failed (best-effort)");
            }
          }
          const snapshot = await emitRoomUpdate(canonicalRoom.code);
          logger.debug({ roomCode: canonicalRoom.code }, "BIN-134: room:create → existing canonical (legacy)");
          ackSuccess(callback, { roomCode: canonicalRoom.code, playerId, snapshot });
          return;
        }
      }

      // Bug 2 fix: før vi oppretter et nytt rom, rydd opp stale
      // walletId-binding i andre IDLE-rom (ingen aktiv runde, ingen
      // socket). Forhindrer "Spiller deltar allerede"-feil på reconnect
      // når gammelt rom ikke ble ryddet ved disconnect.
      // FORHANDSKJOP-ORPHAN-FIX (PR 2): preserve armed/reserved players.
      engine.cleanupStaleWalletInIdleRooms(identity.walletId, {
        isPreserve: deps.hasArmedOrReservation
          ? (code, pid) => deps.hasArmedOrReservation!(code, pid)
          : undefined,
      });
      let roomCode: string;
      let playerId: string;
      try {
        const created = await engine.createRoom({
          playerName: identity.playerName,
          hallId: identity.hallId,
          walletId: identity.walletId,
          socketId: socket.id,
          // BIN-134: Use canonical room-code so SPA alias = real code.
          roomCode: canonicalMapping?.roomCode,
          // Tobias 2026-04-27: shared rooms (Spill 2/3) signaliserer dette via
          // `effectiveHallId=null` så `joinRoom` ikke kaster HALL_MISMATCH.
          effectiveHallId: canonicalMapping ? canonicalMapping.effectiveHallId : undefined,
          gameSlug: requestedGameSlug,
          ...(isTestHall ? { isTestHall: true } : {}),
        });
        roomCode = created.roomCode;
        playerId = created.playerId;
      } catch (err) {
        // Tobias-direktiv 2026-05-04 (room-uniqueness invariant): hvis to
        // samtidige room:create-kall race-er på samme canonical kode, vil
        // taperen få ROOM_ALREADY_EXISTS i stedet for en fallback random
        // kode (som ville skapt duplikat-rom). Vi recover ved å re-loope
        // til "join existing canonical"-pathen ovenfor — vinneren av racet
        // har allerede satt opp rommet.
        const errCode = (err as { code?: string } | null)?.code;
        if (errCode === "ROOM_ALREADY_EXISTS" && canonicalMapping) {
          const existingCanonical = engine.findRoomByCode(canonicalMapping.roomCode);
          if (existingCanonical) {
            logger.warn(
              { walletId: identity.walletId, target: canonicalMapping.roomCode },
              "[room:create] ROOM_ALREADY_EXISTS race — recovering by joining existing canonical",
            );
            // Refresh isTestHall same som happy-path ovenfor.
            engine.setRoomTestHall(existingCanonical.code, isTestHall);
            const canonicalSnapshot = engine.getRoomSnapshot(existingCanonical.code);
            const existingPlayer = findPlayerInRoomByWallet(canonicalSnapshot, identity.walletId);
            if (existingPlayer) {
              engine.attachPlayerSocket(existingCanonical.code, existingPlayer.id, socket.id);
              roomCode = existingCanonical.code;
              playerId = existingPlayer.id;
            } else {
              const joined = await engine.joinRoom({
                roomCode: existingCanonical.code,
                hallId: identity.hallId,
                playerName: identity.playerName,
                walletId: identity.walletId,
                socketId: socket.id,
              });
              roomCode = existingCanonical.code;
              playerId = joined.playerId;
            }
            socket.join(roomCode);
            socket.join(walletRoomKey(identity.walletId));
            if (deps.spawnFirstRoundIfNeeded) {
              try {
                await deps.spawnFirstRoundIfNeeded(roomCode);
              } catch (spawnErr) {
                logger.warn({ err: spawnErr, roomCode }, "spawnFirstRoundIfNeeded failed (best-effort)");
              }
            }
            const recoverSnapshot = await emitRoomUpdate(roomCode);
            ackSuccess(callback, { roomCode, playerId, snapshot: recoverSnapshot });
            return;
          }
        }
        throw err;
      }
      // BIN-694: wire DEFAULT variantConfig (5-fase Norsk bingo for Game 1)
      // immediately after room-creation. Before this, `setVariantConfig`
      // was only called in tests — production rooms had no variant bound,
      // so `meetsPhaseRequirement` fell back to the legacy 1-line rule and
      // triggered every LINE phase on the first completed row. Defaulting
      // the gameSlug to "bingo" matches `BingoEngine.createRoom` which
      // does the same fallback on RoomState.gameSlug.
      // PR C: foretrekk den nye async-binderen som kan lese admin-config
      // fra GameManagement når `gameManagementId` er tilgjengelig. I dag
      // sender ingen caller ID-en — faller gjennom til default-path.
      if (deps.bindVariantConfigForRoom) {
        await deps.bindVariantConfigForRoom(roomCode, {
          gameSlug: requestedGameSlug?.trim() || "bingo",
        });
      } else {
        deps.bindDefaultVariantConfig?.(roomCode, requestedGameSlug?.trim() || "bingo");
      }
      socket.join(roomCode);
      // BIN-760: join per-wallet socket-rom så `wallet:state`-pusher når
      // denne klienten. Se kommentaren i den parallelle grenen ovenfor.
      socket.join(walletRoomKey(identity.walletId));
      // Tobias-direktiv 2026-05-03: Spill 2/3 perpetual auto-spawn på room:create.
      // Brand-new ROCKET/MONSTERBINGO-rom trenger første runde umiddelbart.
      if (deps.spawnFirstRoundIfNeeded) {
        try {
          await deps.spawnFirstRoundIfNeeded(roomCode);
        } catch (err) {
          logger.warn({ err, roomCode }, "spawnFirstRoundIfNeeded failed (best-effort)");
        }
      }
      const snapshot = await emitRoomUpdate(roomCode);
      logger.debug({ roomCode }, "BIN-134: room:create SUCCESS");
      ackSuccess(callback, { roomCode, playerId, snapshot });
    } catch (error) {
      logger.error({ err: error, code: (error as Record<string, unknown>).code }, "BIN-134: room:create FAILED");
      ackFailure(callback, error);
    }
  }));

  socket.on("room:join", rateLimited("room:join", async (payload: JoinRoomPayload, callback: (response: AckResponse<{ roomCode: string; playerId: string; snapshot: RoomSnapshot }>) => void) => {
    try {
      let roomCode = mustBeNonEmptyString(payload?.roomCode, "roomCode").toUpperCase();
      const identity = await resolveIdentityFromPayload(payload);
      if (enforceSingleRoomPerHall) {
        // BIN-134: resolve BINGO1 alias.
        // Bug B fix (Tobias 2026-04-28): canonical-aware lookup.
        // Tidligere `getPrimaryRoomForHall(hallId)` filtrerte på
        // `room.hallId === hallId` og misset shared canonical rooms
        // (Spill 1 group-of-halls). For Hall B i samme gruppe som
        // Hall A endte vi i auto-create-flyten med tilfeldig kode i
        // stedet for canonical → ulike haller fikk separate rom.
        if (roomCode === "BINGO1") {
          let canonicalGroupId: string | null = null;
          if (deps.getHallGroupIdForHall) {
            try {
              canonicalGroupId = await deps.getHallGroupIdForHall(identity.hallId);
            } catch (err) {
              logger.warn({ err, hallId: identity.hallId }, "getHallGroupIdForHall failed; falling back to hallId-based room code");
            }
          }
          const canonicalMapping = getCanonicalRoomCode("bingo", identity.hallId, canonicalGroupId);
          // Demo Hall bypass — hentet uansett (refresh + initial set).
          const isTestHallForJoin = await lookupIsTestHall(
            deps, identity.hallId, logger,
          );
          const existingCanonical = engine.findRoomByCode(canonicalMapping.roomCode);
          if (existingCanonical) {
            // Bug A fix (Tobias 2026-04-28): refresh isTestHall.
            engine.setRoomTestHall(existingCanonical.code, isTestHallForJoin);
            roomCode = existingCanonical.code;
          } else {
            // Auto-create canonical room for this hall + group.
            logger.debug({ hallId: identity.hallId, canonical: canonicalMapping.roomCode }, "room:join auto-creating canonical room");
            // PILOT-EMERGENCY 2026-04-28 (Tobias): rydd legacy non-canonical
            // rom-bindinger før vi auto-creater canonical (samme grunn som
            // i room:create — pre-#677 4RCQSX-rester må vekk).
            const cleanedNonCanonical = engine.cleanupStaleWalletInNonCanonicalRooms(
              identity.walletId,
              isCanonicalRoomCode,
            );
            if (cleanedNonCanonical > 0) {
              logger.warn(
                { walletId: identity.walletId, cleaned: cleanedNonCanonical, target: canonicalMapping.roomCode },
                "[room:join auto-create] cleared stale wallet-bindings in non-canonical rooms",
              );
            }
            // FORHANDSKJOP-ORPHAN-FIX (PR 2): preserve armed/reserved players.
            engine.cleanupStaleWalletInIdleRooms(identity.walletId, {
              isPreserve: deps.hasArmedOrReservation
                ? (code, pid) => deps.hasArmedOrReservation!(code, pid)
                : undefined,
            });
            const newRoom = await engine.createRoom({
              hallId: identity.hallId,
              playerName: identity.playerName,
              walletId: identity.walletId,
              socketId: socket.id,
              gameSlug: "bingo",
              roomCode: canonicalMapping.roomCode,
              effectiveHallId: canonicalMapping.effectiveHallId,
              ...(isTestHallForJoin ? { isTestHall: true } : {}),
            });
            roomCode = newRoom.roomCode;
            if (deps.bindVariantConfigForRoom) {
              await deps.bindVariantConfigForRoom(roomCode, { gameSlug: "bingo" });
            } else {
              deps.bindDefaultVariantConfig?.(roomCode, "bingo");
            }
            // Auto-create succeeded — return ack direkte. playerId fra
            // createRoom er hostPlayerId i det nye rommet.
            socket.join(roomCode);
            socket.join(walletRoomKey(identity.walletId));
            const newSnapshot = await emitRoomUpdate(roomCode);
            ackSuccess(callback, { roomCode, playerId: newRoom.playerId, snapshot: newSnapshot });
            return;
          }
        }
        // Bug B fix (Tobias 2026-04-28): SINGLE_ROOM_ONLY-sjekken må også
        // være canonical-aware. Hvis spilleren prøver en kode som ikke
        // matcher canonical (og canonical eksisterer) → throw.
        let canonicalGroupIdForCheck: string | null = null;
        if (deps.getHallGroupIdForHall) {
          try {
            canonicalGroupIdForCheck = await deps.getHallGroupIdForHall(identity.hallId);
          } catch {
            // fail-soft
          }
        }
        const canonicalForCheck = getCanonicalRoomCode("bingo", identity.hallId, canonicalGroupIdForCheck);
        if (
          roomCode !== canonicalForCheck.roomCode &&
          engine.findRoomByCode(canonicalForCheck.roomCode)
        ) {
          throw new DomainError(
            "SINGLE_ROOM_ONLY",
            `Kun ett bingo-rom er aktivt per hall. Bruk rom ${canonicalForCheck.roomCode}.`
          );
        }
      }

      // PILOT-EMERGENCY 2026-04-28 (Tobias): hvis target-rommet er
      // canonical, fjern aggressivt stale walletId-binding fra alle
      // non-canonical (legacy) rom — uansett runde-status. Disse er
      // 4RCQSX-typen leftovers fra pre-#677-epoke som blokkerer reconnect
      // selv etter logg-ut/inn. Boot-sweep destroyer kun IDLE/ENDED
      // legacy-rom, så RUNNING-leftovers må ryddes opp ad-hoc her.
      // No-op for non-canonical target-rom (admin-tooling kan fortsatt
      // teste legacy-flyt manuelt).
      if (isCanonicalRoomCode(roomCode)) {
        const cleanedJoin = engine.cleanupStaleWalletInNonCanonicalRooms(
          identity.walletId,
          isCanonicalRoomCode,
        );
        if (cleanedJoin > 0) {
          logger.warn(
            { walletId: identity.walletId, cleaned: cleanedJoin, target: roomCode },
            "[room:join] cleared stale wallet-bindings in non-canonical rooms",
          );
        }
      }

      const roomSnapshot = engine.getRoomSnapshot(roomCode);
      const existingPlayer = findPlayerInRoomByWallet(roomSnapshot, identity.walletId);
      if (existingPlayer) {
        engine.attachPlayerSocket(roomCode, existingPlayer.id, socket.id);
        socket.join(roomCode);
        // BIN-760: per-wallet socket-rom for `wallet:state`-push.
        socket.join(walletRoomKey(identity.walletId));
        // Tobias-direktiv 2026-05-03: Spill 2/3 perpetual auto-spawn.
        // Selv på re-join må vi sjekke — hvis en spiller var alene i ROCKET
        // og forrige runde naturlig endte (men auto-restart ble ikke
        // schedulet fordi rommet stod tomt et øyeblikk), skal join trigge
        // spawn. No-op for Spill 1 / SpinnGo / aktive runder. Fail-soft —
        // ack sendes uavhengig av utfallet.
        if (deps.spawnFirstRoundIfNeeded) {
          try {
            await deps.spawnFirstRoundIfNeeded(roomCode);
          } catch (err) {
            logger.warn({ err, roomCode }, "spawnFirstRoundIfNeeded failed (best-effort)");
          }
        }
        const snapshot = await emitRoomUpdate(roomCode);
        ackSuccess(callback, { roomCode, playerId: existingPlayer.id, snapshot });
        return;
      }

      // Bug 2 fix: rydd stale walletId-binding i andre IDLE-rom før vi
      // joiner det aktuelle rommet. Beskytter mot
      // PLAYER_ALREADY_IN_RUNNING_GAME / PLAYER_ALREADY_IN_ROOM-feil
      // når klienten reconnecter etter disconnect.
      // FORHANDSKJOP-ORPHAN-FIX (PR 2): preserve armed/reserved players.
      engine.cleanupStaleWalletInIdleRooms(identity.walletId, {
        exceptRoomCode: roomCode,
        isPreserve: deps.hasArmedOrReservation
          ? (code, pid) => deps.hasArmedOrReservation!(code, pid)
          : undefined,
      });
      const { playerId } = await engine.joinRoom({
        roomCode,
        hallId: identity.hallId,
        playerName: identity.playerName,
        walletId: identity.walletId,
        socketId: socket.id
      });
      socket.join(roomCode);
      // BIN-760: per-wallet socket-rom for `wallet:state`-push.
      socket.join(walletRoomKey(identity.walletId));
      // Tobias-direktiv 2026-05-03: Spill 2/3 perpetual auto-spawn første
      // runde ved spiller-join. Hooken sjekker selv om slug er rocket /
      // monsterbingo — Spill 1 og SpinnGo gir false-return uten effekt.
      // Fail-soft: hvis spawn feiler (f.eks. INSUFFICIENT_BALANCE i tom
      // konfig) får spilleren fortsatt ack og kan vente på neste runde.
      if (deps.spawnFirstRoundIfNeeded) {
        try {
          await deps.spawnFirstRoundIfNeeded(roomCode);
        } catch (err) {
          logger.warn({ err, roomCode }, "spawnFirstRoundIfNeeded failed (best-effort)");
        }
      }
      const snapshot = await emitRoomUpdate(roomCode);
      ackSuccess(callback, { roomCode, playerId, snapshot });
    } catch (error) {
      console.error("[room:join] FAILED:", toPublicError(error));
      ackFailure(callback, error);
    }
  }));

  socket.on("room:resume", rateLimited("room:resume", async (payload: ResumeRoomPayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      engine.attachPlayerSocket(roomCode, playerId, socket.id);
      socket.join(roomCode);
      // BIN-760: per-wallet socket-rom for `wallet:state`-push. Hent
      // walletId fra room-snapshot — playerId er allerede validert mot
      // token-eier i requireAuthenticatedPlayerAction.
      const resumePlayer = engine.getRoomSnapshot(roomCode).players.find((p) => p.id === playerId);
      if (resumePlayer?.walletId) {
        socket.join(walletRoomKey(resumePlayer.walletId));
      }
      const snapshot = await emitRoomUpdate(roomCode);
      ackSuccess(callback, { snapshot });
    } catch (error) {
      ackFailure(callback, error);
    }
  }));

  socket.on("room:configure", rateLimited("room:configure", async (
    payload: ConfigureRoomPayload,
    callback: (response: AckResponse<{ snapshot: RoomSnapshot; entryFee: number }>) => void
  ) => {
    try {
      const { roomCode } = await requireAuthenticatedPlayerAction(payload);
      engine.getRoomSnapshot(roomCode);

      const requestedEntryFee = parseOptionalNonNegativeNumber(payload?.entryFee, "entryFee");
      if (requestedEntryFee === undefined) {
        throw new DomainError("INVALID_INPUT", "entryFee må oppgis.");
      }

      // setRoomConfiguredEntryFee
      const normalized = Math.max(0, Math.round(requestedEntryFee * 100) / 100);
      deps.roomConfiguredEntryFeeByRoom.set(roomCode, normalized);
      const entryFee = normalized;

      const updatedSnapshot = await emitRoomUpdate(roomCode);
      ackSuccess(callback, { snapshot: updatedSnapshot, entryFee });
    } catch (error) {
      ackFailure(callback, error);
    }
  }));

  socket.on("room:state", rateLimited("room:state", async (payload: RoomStatePayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
    try {
      const user = await getAuthenticatedSocketUser(payload);
      let roomCode = mustBeNonEmptyString(payload?.roomCode, "roomCode").toUpperCase();

      // BIN-134: SPA sends "BINGO1" as canonical room code.
      // Map it to the actual canonical room for the hall.
      if (roomCode === "BINGO1" && enforceSingleRoomPerHall) {
        const hallId = (payload as unknown as Record<string, unknown>)?.hallId || "default-hall";
        const canonicalRoom = getPrimaryRoomForHall(hallId as string);
        if (canonicalRoom) {
          roomCode = canonicalRoom.code;
          logger.debug({ roomCode }, "BIN-134: room:state BINGO1 → canonical room");
        }
        // If no canonical room exists, fall through — ROOM_NOT_FOUND triggers SPA auto-create
      }

      assertUserCanAccessRoom(user, roomCode);
      const snapshot = buildRoomUpdatePayload(engine.getRoomSnapshot(roomCode));
      ackSuccess(callback, { snapshot });
    } catch (error) {
      ackFailure(callback, error);
    }
  }));

  socket.on("bet:arm", rateLimited("bet:arm", async (
    payload: RoomActionPayload & { armed?: boolean; ticketCount?: number; ticketSelections?: Array<{ type: string; qty: number; name?: string }> },
    callback: (response: AckResponse<{ snapshot: RoomSnapshot; armed: boolean; lossLimit?: BetArmLossLimitInfo }>) => void
  ) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      const wantArmed = payload.armed !== false;
      // LIVE_ROOM_OBSERVABILITY 2026-04-29: structured INFO-log per
      // bet:arm/disarm. Inkluderer totalQty fra payload for å se hvor mye
      // spilleren prøvde å låse — kombinert med rejected-event nedenfor
      // gir det full picture i prod-loggen.
      const incomingTotalQty = Array.isArray(payload.ticketSelections)
        ? payload.ticketSelections.reduce(
            (sum, s) => sum + (typeof s?.qty === "number" ? Math.max(0, Math.round(s.qty)) : 0),
            0,
          )
        : (typeof payload.ticketCount === "number" ? Math.max(0, Math.round(payload.ticketCount)) : 0);
      logRoomEvent(
        roomEventsLogger,
        {
          socketId: socket.id,
          playerId,
          roomCode,
          wantArmed,
          ticketSelectionCount: Array.isArray(payload.ticketSelections)
            ? payload.ticketSelections.length
            : null,
          totalQty: incomingTotalQty,
        },
        "socket.bet:arm",
      );
      // Tobias 2026-04-29: lossLimit-info bygges underveis og legges på
      // ack — alltid på success-path slik at klient kan vise
      // "Brukt i dag: X / Y kr" i Kjøp Bonger-popup-en.
      let lossLimitInfo: BetArmLossLimitInfo | undefined;
      // Track om selections ble truncert (partial-buy). Brukes til å
      // velge mellom error-ack (LOSS_LIMIT_REACHED) og success-ack med
      // delvis-armed.
      let partialBuyHappened = false;

      if (wantArmed) {
        // New path: per-type selections
        if (Array.isArray(payload.ticketSelections) && payload.ticketSelections.length > 0) {
          // BIN-688: preserve `name` so pre-round tickets can be coloured
          // per the player's specific pick (Small Yellow vs Small Purple
          // both have type="small").
          const selections = payload.ticketSelections
            .filter((s) => s && typeof s.type === "string" && typeof s.qty === "number" && s.qty > 0)
            .map((s) => ({
              type: s.type,
              qty: Math.max(1, Math.round(s.qty)),
              ...(typeof s.name === "string" && s.name.length > 0 ? { name: s.name } : {}),
            }));

          if (selections.length === 0) {
            throw new DomainError("INVALID_INPUT", "Ingen gyldige billettvalg.");
          }

          // Additive arm: each bet:arm call MERGES the new selections into
          // the player's existing armed set. Reductions happen via `ticket:cancel`
          // (× on individual brett). Product decision 2026-04-20 — the buy
          // popup opens at qty=0 on every re-open, so replace-semantics would
          // mean re-armed brett vanish every time the player clicks Kjøp.
          const existing = deps.getArmedPlayerSelections(roomCode)?.[playerId] ?? [];
          const merged: Array<{ type: string; qty: number; name?: string }> = existing.map((s) => ({
            type: s.type,
            qty: s.qty,
            ...(s.name ? { name: s.name } : {}),
          }));
          for (const incoming of selections) {
            const matchIdx = merged.findIndex((m) =>
              m.type === incoming.type && (m.name ?? null) === (incoming.name ?? null),
            );
            if (matchIdx >= 0) {
              merged[matchIdx] = { ...merged[matchIdx], qty: merged[matchIdx].qty + incoming.qty };
            } else {
              merged.push(incoming);
            }
          }

          // Validate combined total weighted count <= 30.
          const variantInfo = deps.getVariantConfig?.(roomCode);
          const ticketTypes = variantInfo?.config?.ticketTypes ?? [];
          // Resolve weight + price-multiplier per merged-entry so partial-
          // buy iteration kan jobbe på brett-vekt-nivå (ikke "qty"-nivå —
          // ett "Large" = 3 brett a 1× kostnad er semantisk forskjellig fra
          // 3 stk "Small" a 1× kostnad).
          //
          // weightFor / priceMultFor speiler `Game1TicketPurchaseService`
          // og `BingoEngine.startGame`-loopen så kostnaden vi limit-sjekker
          // her matcher kostnaden som faktisk debiteres ved game-start.
          const weightFor = (sel: { type: string; name?: string }): number => {
            const tt =
              (sel.name ? ticketTypes.find((t) => t.name === sel.name) : undefined) ??
              ticketTypes.find((t) => t.type === sel.type);
            return tt?.ticketCount ?? 1;
          };
          const priceMultFor = (sel: { type: string; name?: string }): number => {
            const tt =
              (sel.name ? ticketTypes.find((t) => t.name === sel.name) : undefined) ??
              ticketTypes.find((t) => t.type === sel.type);
            // Default 1× hvis variant-config ikke spesifiserer (matcher
            // BingoEngine-fallback).
            return typeof tt?.priceMultiplier === "number" ? tt.priceMultiplier : 1;
          };

          let totalWeighted = 0;
          for (const sel of merged) {
            totalWeighted += sel.qty * weightFor(sel);
          }
          if (totalWeighted > 30) {
            throw new DomainError(
              "INVALID_INPUT",
              `Totalt antall brett (${totalWeighted}) overstiger maks 30.`,
            );
          }
          if (totalWeighted < 1) {
            throw new DomainError("INVALID_INPUT", "Du må velge minst 1 brett.");
          }
          // BIN-693 Option B: reserver delta-beløpet i wallet FØR vi armer
          // in-memory. Hvis reserve feiler (INSUFFICIENT_FUNDS), rulles alt
          // tilbake og spiller får feilmelding uten at armed-state endres.
          const existingWeighted = deps.getArmedPlayerIds(roomCode).includes(playerId)
            ? (deps.getArmedPlayerTicketCounts(roomCode)[playerId] ?? 0)
            : 0;

          // Tobias 2026-04-29 (UX-fix): server-side partial-buy + clear
          // ack. Tidligere lot vi alle 3 brett bli armed uansett, og
          // BingoEngine.startGame's filterEligiblePlayers droppet
          // spilleren stille hvis loss-limit ble truffet. Nå avviser vi
          // umiddelbart — enten alt eller delvis — så bonger ALDRI
          // vises på klienten uten at server har confirmet kjøp.
          const entryFee = deps.getRoomConfiguredEntryFee(roomCode);
          const wId = deps.getWalletIdForPlayer?.(roomCode, playerId);
          const hallId = engine.getRoomSnapshot(roomCode).hallId;
          // Only consult compliance when we have a real wallet binding
          // and a positive entryFee — free-play (entryFee=0) bypasses
          // limit-check, matching ComplianceManager.wouldExceedLossLimit.
          let acceptedSelections = merged;
          let acceptedWeighted = totalWeighted;
          let rejectionReason: "DAILY_LIMIT" | "MONTHLY_LIMIT" | null = null;

          if (wId && entryFee > 0 && typeof engine.calculateMaxAffordableTickets === "function") {
            // Bygg per-brett-pris-array. Iterasjons-rekkefølge:
            // selection-by-selection (merged-rekkefølge), brett-by-brett
            // innenfor selection. Hver brett-vekt-unit koster
            // `entryFee × priceMultiplier / ticketCount` for selection-en
            // (pengen per fysisk brett). Eksempel: Large kostr `entryFee × 3`
            // og gir 3 brett → hvert brett blir `entryFee` kr — samme som
            // små brett, hvilket matcher legacy paritet.
            const ticketUnitPrices: number[] = [];
            // Tracking per merged-index: hvor mange units vi har akseptert
            // hittil. Brukes til å re-konstruere truncated selections etterpå.
            const acceptedCountPerSel: number[] = merged.map(() => 0);
            for (let selIdx = 0; selIdx < merged.length; selIdx++) {
              const sel = merged[selIdx];
              const weight = weightFor(sel);
              const pricePerUnit = entryFee * priceMultFor(sel);
              const pricePerWeightedBrett = weight > 0 ? pricePerUnit / weight : pricePerUnit;
              for (let unitIdx = 0; unitIdx < sel.qty; unitIdx++) {
                for (let brettIdx = 0; brettIdx < weight; brettIdx++) {
                  ticketUnitPrices.push(pricePerWeightedBrett);
                }
              }
            }

            // Pre-subtract existing reserved (aldri negativt). På et
            // INCREASE-bet:arm har spilleren allerede X brett armed med
            // reservasjon; budsjettet for de NYE brett må være `remaining
            // - X`. `existingReservedAmount` håndterer dette i
            // calculateMaxAffordableTickets.
            const existingReservedAmount = existingWeighted * entryFee; // approx — assumes 1× multiplier on existing
            const nowMs = Date.now();

            const result = engine.calculateMaxAffordableTickets(
              wId,
              hallId,
              ticketUnitPrices,
              nowMs,
              existingReservedAmount,
            );

            if (result.accepted < ticketUnitPrices.length) {
              partialBuyHappened = true;
              rejectionReason = result.rejectionReason;
              if (result.accepted === 0) {
                // Total avvisning — release ANY existing reservation før
                // vi kaster, så saldo-state forblir konsistent.
                if (existingWeighted > 0) {
                  // Behold eksisterende armed (det var allerede committed
                  // før denne arm-kallet). Bare avvis denne bestillingen.
                }
                const code: "LOSS_LIMIT_REACHED" | "MONTHLY_LIMIT_REACHED" =
                  result.rejectionReason === "MONTHLY_LIMIT"
                    ? "MONTHLY_LIMIT_REACHED"
                    : "LOSS_LIMIT_REACHED";
                const message =
                  result.rejectionReason === "MONTHLY_LIMIT"
                    ? `Du har nådd månedens tapsgrense (${result.state.monthlyUsed} / ${result.state.monthlyLimit} kr).`
                    : `Du har nådd dagens tapsgrense (${result.state.dailyUsed} / ${result.state.dailyLimit} kr). Prøv igjen i morgen.`;
                throw new DomainError(code, message);
              }

              // Partial: re-konstruer truncated selections. Pop brett
              // unit-for-unit fra slutten av merged-listen til vi har
              // ticketUnitPrices.length - result.accepted "for mange".
              // Det betyr siste merged-entry blir potentielt redusert,
              // og hvis dens qty går til 0, fjernet helt.
              let toRemove = ticketUnitPrices.length - result.accepted;
              const truncated: Array<{ type: string; qty: number; name?: string }> = [];
              for (const sel of merged) {
                truncated.push({ ...sel });
              }
              // Iterér baklengs gjennom truncated, decrementer qty per
              // selection's brett-vekt så vi rammer hele units.
              for (let i = truncated.length - 1; i >= 0 && toRemove > 0; i--) {
                const sel = truncated[i];
                const weight = weightFor(sel);
                while (sel.qty > 0 && toRemove >= weight) {
                  sel.qty -= 1;
                  toRemove -= weight;
                }
              }
              acceptedSelections = truncated.filter((s) => s.qty > 0);
              acceptedWeighted = 0;
              for (const sel of acceptedSelections) {
                acceptedWeighted += sel.qty * weightFor(sel);
              }
            }

            lossLimitInfo = {
              requested: totalWeighted,
              accepted: acceptedWeighted,
              rejected: Math.max(0, totalWeighted - acceptedWeighted),
              rejectionReason,
              dailyUsed: result.state.dailyUsed,
              dailyLimit: result.state.dailyLimit,
              monthlyUsed: result.state.monthlyUsed,
              monthlyLimit: result.state.monthlyLimit,
              walletBalance: null, // populated below post-reservation
            };
          }

          // Reserve only the accepted weighted count (delta from existing).
          await reservePreRoundDelta(
            deps,
            roomCode,
            playerId,
            existingWeighted,
            acceptedWeighted,
          );
          armPlayer(roomCode, playerId, acceptedWeighted, acceptedSelections);
        } else {
          // Backward compat: flat ticketCount
          const ticketCount = Math.min(30, Math.max(1, Math.round(payload.ticketCount ?? 1)));
          const existingWeighted = deps.getArmedPlayerIds(roomCode).includes(playerId)
            ? (deps.getArmedPlayerTicketCounts(roomCode)[playerId] ?? 0)
            : 0;

          // Tobias 2026-04-29 (UX-fix): same partial-buy path for flat
          // ticketCount — though clients sending flat are deprecated, vi
          // dekker den så ingen oppførsels-asymmetri eksisterer.
          const entryFee = deps.getRoomConfiguredEntryFee(roomCode);
          const wId = deps.getWalletIdForPlayer?.(roomCode, playerId);
          const hallId = engine.getRoomSnapshot(roomCode).hallId;
          let acceptedTickets = ticketCount;
          let rejectionReason: "DAILY_LIMIT" | "MONTHLY_LIMIT" | null = null;

          if (wId && entryFee > 0 && typeof engine.calculateMaxAffordableTickets === "function") {
            const ticketUnitPrices: number[] = [];
            for (let i = 0; i < ticketCount; i++) ticketUnitPrices.push(entryFee);
            const existingReservedAmount = existingWeighted * entryFee;
            const result = engine.calculateMaxAffordableTickets(
              wId,
              hallId,
              ticketUnitPrices,
              Date.now(),
              existingReservedAmount,
            );
            if (result.accepted < ticketCount) {
              partialBuyHappened = true;
              rejectionReason = result.rejectionReason;
              if (result.accepted === 0) {
                const code: "LOSS_LIMIT_REACHED" | "MONTHLY_LIMIT_REACHED" =
                  result.rejectionReason === "MONTHLY_LIMIT"
                    ? "MONTHLY_LIMIT_REACHED"
                    : "LOSS_LIMIT_REACHED";
                const message =
                  result.rejectionReason === "MONTHLY_LIMIT"
                    ? `Du har nådd månedens tapsgrense (${result.state.monthlyUsed} / ${result.state.monthlyLimit} kr).`
                    : `Du har nådd dagens tapsgrense (${result.state.dailyUsed} / ${result.state.dailyLimit} kr). Prøv igjen i morgen.`;
                throw new DomainError(code, message);
              }
              acceptedTickets = result.accepted;
            }
            lossLimitInfo = {
              requested: ticketCount,
              accepted: acceptedTickets,
              rejected: Math.max(0, ticketCount - acceptedTickets),
              rejectionReason,
              dailyUsed: result.state.dailyUsed,
              dailyLimit: result.state.dailyLimit,
              monthlyUsed: result.state.monthlyUsed,
              monthlyLimit: result.state.monthlyLimit,
              walletBalance: null,
            };
          }

          await reservePreRoundDelta(deps, roomCode, playerId, existingWeighted, acceptedTickets);
          armPlayer(roomCode, playerId, acceptedTickets);
        }
      } else {
        // disarm: frigi reservasjon før vi nullstiller in-memory state
        await releasePreRoundReservation(deps, roomCode, playerId);
        disarmPlayer(roomCode, playerId);
      }
      // BIN-693: refresh player.balance til available_balance etter reserve/release,
      // så room:update-snapshot reflekterer ny saldo-visning umiddelbart.
      const walletId = deps.getWalletIdForPlayer?.(roomCode, playerId);
      if (walletId) {
        await engine.refreshPlayerBalancesForWallet(walletId);
      }

      // Tobias 2026-04-29 (UX-fix): hvis vi ikke fikk lossLimit-info via
      // partial-buy-path (entryFee=0 eller adapter mangler), forsøk likevel
      // å hente tap-state for ack-en så klient kan vise headeren. Fail-soft
      // — null state betyr "ingen lossLimit-info i ack".
      if (!lossLimitInfo && wantArmed && walletId && deps.getLossStateSnapshot) {
        try {
          const snap = await deps.getLossStateSnapshot(
            walletId,
            engine.getRoomSnapshot(roomCode).hallId,
            Date.now(),
          );
          if (snap) {
            const armedNow = deps.getArmedPlayerTicketCounts(roomCode)[playerId] ?? 0;
            lossLimitInfo = {
              requested: armedNow,
              accepted: armedNow,
              rejected: 0,
              rejectionReason: null,
              dailyUsed: snap.dailyUsed,
              dailyLimit: snap.dailyLimit,
              monthlyUsed: snap.monthlyUsed,
              monthlyLimit: snap.monthlyLimit,
              walletBalance: snap.walletBalance,
            };
          }
        } catch (snapErr) {
          // Fail-soft: tap-state-info er nice-to-have, ikke critical-path.
          logger.warn({ err: snapErr, roomCode, playerId }, "getLossStateSnapshot failed in bet:arm — ack uten lossLimit-info");
        }
      } else if (lossLimitInfo && walletId && deps.getLossStateSnapshot) {
        // Partial-buy path: oppdater walletBalance fra ferskt snapshot etter
        // reservasjonen er gjort.
        try {
          const snap = await deps.getLossStateSnapshot(
            walletId,
            engine.getRoomSnapshot(roomCode).hallId,
            Date.now(),
          );
          if (snap) {
            lossLimitInfo.walletBalance = snap.walletBalance;
          }
        } catch (snapErr) {
          logger.warn({ err: snapErr, roomCode, playerId }, "getLossStateSnapshot post-reserve failed");
        }
      }

      const snapshot = await emitRoomUpdate(roomCode);
      ackSuccess(callback, {
        snapshot,
        armed: wantArmed,
        ...(lossLimitInfo ? { lossLimit: lossLimitInfo } : {}),
      });

      // Tobias 2026-04-29 (UX-fix): partial-buy → push wallet:loss-state
      // umiddelbart så Kjøp Bonger-popup-en oppdaterer headeren selv
      // om brukeren beholder popup-en åpen for et nytt forsøk.
      if (partialBuyHappened && lossLimitInfo && walletId && deps.emitWalletLossState) {
        deps.emitWalletLossState(walletId, {
          walletId,
          state: {
            hallId: engine.getRoomSnapshot(roomCode).hallId,
            dailyUsed: lossLimitInfo.dailyUsed,
            dailyLimit: lossLimitInfo.dailyLimit,
            monthlyUsed: lossLimitInfo.monthlyUsed,
            monthlyLimit: lossLimitInfo.monthlyLimit,
            walletBalance: lossLimitInfo.walletBalance ?? 0,
          },
          // Reservation isn't yet committed, but klient bruker reason for
          // å vise riktig kontekst. Bruk BUYIN siden det er nærmest selv
          // om commitement kommer senere.
          reason: "BUYIN",
          serverTimestamp: Date.now(),
        });
      }
    } catch (error) {
      ackFailure(callback, error);
    }
  }));

  // ── Lucky number ──────────────────────────────────────────────────────────
  socket.on("lucky:set", rateLimited("lucky:set", async (payload: LuckyNumberPayload, callback: (response: AckResponse<{ luckyNumber: number }>) => void) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      const num = payload?.luckyNumber;
      if (!Number.isInteger(num) || num < 1 || num > 60) {
        throw new DomainError("INVALID_INPUT", "luckyNumber må være mellom 1 og 60.");
      }
      // Only allow setting before game starts or during waiting
      const snapshot = engine.getRoomSnapshot(roomCode);
      if (snapshot.currentGame?.status === "RUNNING") {
        throw new DomainError("GAME_IN_PROGRESS", "Kan ikke endre lykketall mens spillet pågår.");
      }
      setLuckyNumber(roomCode, playerId, num);
      await emitRoomUpdate(roomCode);
      ackSuccess(callback, { luckyNumber: num });
    } catch (error) {
      ackFailure(callback, error);
    }
  }));
}
