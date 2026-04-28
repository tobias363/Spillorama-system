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
import { DomainError, toPublicError } from "../../game/BingoEngine.js";
import {
  mustBeNonEmptyString,
  parseOptionalNonNegativeNumber,
} from "../../util/httpHelpers.js";
import type { SocketContext } from "./context.js";
import type {
  AckResponse,
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
import { getCanonicalRoomCode } from "../../util/canonicalRoomCode.js";

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
      if (enforceSingleRoomPerHall) {
        const canonicalRoom = getPrimaryRoomForHall(identity.hallId);
        if (canonicalRoom) {
          const canonicalSnapshot = engine.getRoomSnapshot(canonicalRoom.code);
          const existingPlayer = findPlayerInRoomByWallet(canonicalSnapshot, identity.walletId);

          let playerId = existingPlayer?.id ?? "";
          if (existingPlayer) {
            engine.attachPlayerSocket(canonicalRoom.code, existingPlayer.id, socket.id);
          } else {
            // Bug 2 fix: rydd opp stale walletId-binding i andre IDLE-rom
            // før vi joiner canonical. Hindrer at gamle ad-hoc-rom (uten
            // socket og uten aktiv runde) blokkerer ny join via
            // `assertWalletNotAlreadyInRoom`/`assertWalletNotInRunningGame`.
            engine.cleanupStaleWalletInIdleRooms(identity.walletId, canonicalRoom.code);
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
          // BIN-760: join per-wallet socket-rom så `wallet:state`-pusher
          // når denne klienten ved hver wallet-mutasjon. Idempotent —
          // socket.join no-op-er hvis allerede medlem.
          socket.join(walletRoomKey(identity.walletId));
          const snapshot = await emitRoomUpdate(canonicalRoom.code);
          logger.debug({ roomCode: canonicalRoom.code }, "BIN-134: room:create → existing canonical");
          ackSuccess(callback, { roomCode: canonicalRoom.code, playerId, snapshot });
          return;
        }
      }

      // Bug 2 fix: før vi oppretter et nytt rom, rydd opp stale
      // walletId-binding i andre IDLE-rom (ingen aktiv runde, ingen
      // socket). Forhindrer "Spiller deltar allerede"-feil på reconnect
      // når gammelt rom ikke ble ryddet ved disconnect.
      engine.cleanupStaleWalletInIdleRooms(identity.walletId);
      const requestedGameSlug = typeof payload?.gameSlug === "string" ? payload.gameSlug : undefined;
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
      const { roomCode, playerId } = await engine.createRoom({
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
        // BIN-134: resolve BINGO1 alias
        if (roomCode === "BINGO1") {
          const canonicalRoom = getPrimaryRoomForHall(identity.hallId);
          if (canonicalRoom) {
            roomCode = canonicalRoom.code;
          } else {
            // Auto-create room for this hall if none exists
            logger.debug({ hallId: identity.hallId }, "room:join auto-creating room for hall");
            // Bug 2 fix: rydd stale walletId-binding i andre IDLE-rom før
            // ny rom-opprettelse, så reconnect ikke blokkeres.
            engine.cleanupStaleWalletInIdleRooms(identity.walletId);
            // Demo Hall bypass (Tobias 2026-04-27): propager `isTestHall` —
            // se kommentar over første createRoom-kall i room:create.
            const isTestHallForAutoCreate = await lookupIsTestHall(
              deps, identity.hallId, logger,
            );
            const newRoom = await engine.createRoom({
              hallId: identity.hallId,
              playerName: identity.playerName,
              walletId: identity.walletId,
              socketId: socket.id,
              ...(isTestHallForAutoCreate ? { isTestHall: true } : {}),
            });
            roomCode = newRoom.roomCode;
            // BIN-694 + PR C: wire variantConfig for the auto-created room.
            // Uses new async binder if available (forbereder admin-config
            // wire-up), falls back til default-binder ellers.
            if (deps.bindVariantConfigForRoom) {
              await deps.bindVariantConfigForRoom(roomCode, { gameSlug: "bingo" });
            } else {
              deps.bindDefaultVariantConfig?.(roomCode, "bingo");
            }
          }
        }
        const canonicalRoom = getPrimaryRoomForHall(identity.hallId);
        if (canonicalRoom && canonicalRoom.code !== roomCode) {
          throw new DomainError(
            "SINGLE_ROOM_ONLY",
            `Kun ett bingo-rom er aktivt per hall. Bruk rom ${canonicalRoom.code}.`
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
        const snapshot = await emitRoomUpdate(roomCode);
        ackSuccess(callback, { roomCode, playerId: existingPlayer.id, snapshot });
        return;
      }

      // Bug 2 fix: rydd stale walletId-binding i andre IDLE-rom før vi
      // joiner det aktuelle rommet. Beskytter mot
      // PLAYER_ALREADY_IN_RUNNING_GAME / PLAYER_ALREADY_IN_ROOM-feil
      // når klienten reconnecter etter disconnect.
      engine.cleanupStaleWalletInIdleRooms(identity.walletId, roomCode);
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
    callback: (response: AckResponse<{ snapshot: RoomSnapshot; armed: boolean }>) => void
  ) => {
    try {
      const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
      const wantArmed = payload.armed !== false;
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
          let totalWeighted = 0;
          for (const sel of merged) {
            // BIN-693 lesson: prefer name-match for weight resolution too —
            // two small-typed entries with different names share a weight of
            // 1, but for Large/Elvis (same type, distinct names) the weight
            // lives on the matching row, not the first one.
            const tt =
              (sel.name ? ticketTypes.find((t) => t.name === sel.name) : undefined) ??
              ticketTypes.find((t) => t.type === sel.type);
            const weight = tt?.ticketCount ?? 1;
            totalWeighted += sel.qty * weight;
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
          const existingTotal = existing.reduce((acc, s) => acc + s.qty, 0); // weighted-approx
          const existingWeighted = deps.getArmedPlayerIds(roomCode).includes(playerId)
            ? (deps.getArmedPlayerTicketCounts(roomCode)[playerId] ?? 0)
            : 0;
          await reservePreRoundDelta(
            deps,
            roomCode,
            playerId,
            existingWeighted,
            totalWeighted,
          );
          armPlayer(roomCode, playerId, totalWeighted, merged);
        } else {
          // Backward compat: flat ticketCount
          const ticketCount = Math.min(30, Math.max(1, Math.round(payload.ticketCount ?? 1)));
          const existingWeighted = deps.getArmedPlayerIds(roomCode).includes(playerId)
            ? (deps.getArmedPlayerTicketCounts(roomCode)[playerId] ?? 0)
            : 0;
          await reservePreRoundDelta(deps, roomCode, playerId, existingWeighted, ticketCount);
          armPlayer(roomCode, playerId, ticketCount);
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
      const snapshot = await emitRoomUpdate(roomCode);
      ackSuccess(callback, { snapshot, armed: wantArmed });
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
