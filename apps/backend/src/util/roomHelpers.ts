/**
 * Room-level helper functions for building payloads and resolving room state.
 * Extracted from index.ts. Stateless — all mutable data is passed as arguments.
 */
import type { RoomSnapshot, RoomSummary, Ticket } from "../game/types.js";
import type { DrawScheduler } from "../draw-engine/DrawScheduler.js";
import type { BingoSchedulerSettings } from "./bingoSettings.js";
import type { GameVariantConfig, TicketTypeConfig } from "../game/variantConfig.js";
import { expandSelectionsToTicketColors, getDefaultVariantConfig } from "../game/variantConfig.js";
import { roundCurrency } from "./currency.js";

// ── Room priority ──────────────────────────────────────────────────────────────

export function compareRoomPriority(a: RoomSummary, b: RoomSummary): number {
  const runA = a.gameStatus === "RUNNING" ? 1 : 0;
  const runB = b.gameStatus === "RUNNING" ? 1 : 0;
  if (runA !== runB) return runB - runA;
  if (a.playerCount !== b.playerCount) return b.playerCount - a.playerCount;
  const createdA = Date.parse(a.createdAt);
  const createdB = Date.parse(b.createdAt);
  const normA = Number.isFinite(createdA) ? createdA : Number.MAX_SAFE_INTEGER;
  const normB = Number.isFinite(createdB) ? createdB : Number.MAX_SAFE_INTEGER;
  if (normA !== normB) return normA - normB;
  return a.code.localeCompare(b.code);
}

export function getPrimaryRoomForHall(hallId: string, summaries: RoomSummary[]): RoomSummary | null {
  const hallSummaries = summaries.filter((summary) => summary.hallId === hallId);
  if (hallSummaries.length === 0) return null;
  hallSummaries.sort(compareRoomPriority);
  return hallSummaries[0];
}

export function findPlayerInRoomByWallet(
  snapshot: RoomSnapshot,
  walletId: string
): RoomSnapshot["players"][number] | null {
  const normalizedWalletId = walletId.trim();
  if (!normalizedWalletId) return null;
  return snapshot.players.find((player) => player.walletId === normalizedWalletId) ?? null;
}

// ── Scheduler state ────────────────────────────────────────────────────────────

export function buildRoomSchedulerState(
  snapshot: RoomSnapshot,
  nowMs: number,
  opts: {
    runtimeBingoSettings: BingoSchedulerSettings;
    drawScheduler: DrawScheduler;
    bingoMaxDrawsPerRound: number;
    schedulerTickMs: number;
    getArmedPlayerIds: (roomCode: string) => string[];
    getRoomConfiguredEntryFee: (roomCode: string) => number;
  }
): Record<string, unknown> {
  const { runtimeBingoSettings, drawScheduler, bingoMaxDrawsPerRound, schedulerTickMs, getArmedPlayerIds, getRoomConfiguredEntryFee } = opts;

  const nextStartAtMs = runtimeBingoSettings.autoRoundStartEnabled
    ? drawScheduler.normalizeNextAutoStartAt(snapshot.code, nowMs)
    : null;
  const millisUntilNextStart = nextStartAtMs === null ? null : Math.max(0, nextStartAtMs - nowMs);
  const canStartNow =
    runtimeBingoSettings.autoRoundStartEnabled &&
    snapshot.currentGame?.status !== "RUNNING" &&
    snapshot.players.length >= runtimeBingoSettings.autoRoundMinPlayers &&
    millisUntilNextStart !== null &&
    millisUntilNextStart <= Math.max(1000, schedulerTickMs * 2);

  const currentDrawCount = snapshot.currentGame?.drawnNumbers?.length ?? 0;

  return {
    enabled: runtimeBingoSettings.autoRoundStartEnabled,
    liveRoundsIndependentOfBet: true,
    intervalMs: runtimeBingoSettings.autoRoundStartIntervalMs,
    minPlayers: runtimeBingoSettings.autoRoundMinPlayers,
    playerCount: snapshot.players.length,
    armedPlayerCount: getArmedPlayerIds(snapshot.code).length,
    armedPlayerIds: getArmedPlayerIds(snapshot.code),
    entryFee: getRoomConfiguredEntryFee(snapshot.code),
    payoutPercent: runtimeBingoSettings.payoutPercent,
    drawCapacity: bingoMaxDrawsPerRound,
    currentDrawCount,
    remainingDrawCapacity: Math.max(0, bingoMaxDrawsPerRound - currentDrawCount),
    nextStartAt: nextStartAtMs === null ? null : new Date(nextStartAtMs).toISOString(),
    millisUntilNextStart,
    canStartNow,
    serverTime: new Date(nowMs).toISOString(),
    /** BIN-451: Draw count after which the client must disable buy-more. */
    disableBuyAfterBalls: Math.floor(bingoMaxDrawsPerRound * 0.8),
  };
}

// ── Room update payload ────────────────────────────────────────────────────────

export type RoomUpdatePayload = RoomSnapshot & {
  scheduler: Record<string, unknown>;
  preRoundTickets: Record<string, Ticket[]>;
  /** Player IDs who have explicitly armed (bet:arm) for the next round. */
  armedPlayerIds: string[];
  luckyNumbers: Record<string, number>;
  serverTimestamp: number;
  /**
   * Server-authoritative ACTIVE-ROUND stake per player (in kroner).
   * Clients display this directly — no client-side calculation needed.
   *
   * Strict semantics (round-state-isolation, Tobias 2026-04-25):
   *   - RUNNING game with gameTickets → stake = entryFee × tickets
   *   - RUNNING game without gameTickets (spectator) → 0 (omitted)
   *   - WAITING / ENDED + armed → projected cost for next round
   *   - Otherwise → 0 (omitted)
   *
   * Pre-round arms made WHILE a game is RUNNING are NOT included here —
   * they belong to the NEXT round and live in `playerPendingStakes` so
   * Innsats reflects only what's at risk in the active round.
   */
  playerStakes: Record<string, number>;
  /**
   * Server-authoritative NEXT-ROUND (pre-round) stake per player.
   * Populated when a player has armed tickets that will start in the
   * next round — both during a running round (mid-round additive arm,
   * money already reserved) and between rounds before round-start.
   *
   * Distinct from `playerStakes` so the client can render two separate
   * indicators: Innsats = active-round risk, Forhåndskjøp = next-round
   * commitment. Players with no pending arm are omitted.
   */
  playerPendingStakes: Record<string, number>;
  /** BIN-443: Game variant info for the client's purchase UI. */
  gameVariant?: {
    gameType: string;
    ticketTypes: TicketTypeConfig[];
    replaceAmount?: number;
    /**
     * F3 (BIN-431): Jackpot header info. Propagated from variant config;
     * client shows `{drawThreshold} Jackpot : {prize} kr` when isDisplay=true.
     */
    jackpot?: {
      drawThreshold: number;
      prize: number;
      isDisplay: boolean;
    };
  };
};

export function buildRoomUpdatePayload(
  snapshot: RoomSnapshot,
  nowMs: number,
  opts: {
    runtimeBingoSettings: BingoSchedulerSettings;
    drawScheduler: DrawScheduler;
    bingoMaxDrawsPerRound: number;
    schedulerTickMs: number;
    getArmedPlayerIds: (roomCode: string) => string[];
    getArmedPlayerTicketCounts: (roomCode: string) => Record<string, number>;
    getArmedPlayerSelections?: (roomCode: string) => Record<string, Array<{ type: string; qty: number; name?: string }>>;
    getRoomConfiguredEntryFee: (roomCode: string) => number;
    /**
     * BIN-672: gameSlug is REQUIRED — see roomState.getOrCreateDisplayTickets doc.
     * BIN-688: pass `colorAssignments` so pre-round brett render in the
     * colour the player actually armed (Small Yellow vs Small Purple).
     */
    getOrCreateDisplayTickets: (
      roomCode: string,
      playerId: string,
      count: number,
      gameSlug: string,
      colorAssignments?: Array<{ color: string; type: string }>,
    ) => Ticket[];
    getLuckyNumbers: (roomCode: string) => Record<string, number>;
    /** BIN-443: Variant config for client purchase UI. */
    getVariantConfig?: (roomCode: string) => { gameType: string; config: GameVariantConfig } | null;
    /**
     * G15 (BIN-431): sync hall-name lookup for ticket-detail enrichment.
     * Backed by an in-memory cache populated at room-create/join. Falls back
     * to hallId when the cache misses.
     */
    getHallName?: (hallId: string) => string | null;
    /**
     * G15 (BIN-431): supplier/operator brand name stamped onto tickets.
     * Optional — defaults to "Spillorama" when not provided.
     */
    supplierName?: string;
  }
): RoomUpdatePayload {
  const { getOrCreateDisplayTickets, getLuckyNumbers, runtimeBingoSettings } = opts;

  // BIN-686: Generate pre-round display tickets ONLY for armed players.
  //
  // Previously this loop fell back to `ticketsPerPlayer` for unarmed
  // players — so every player in the room got 4 auto-generated "preview"
  // tickets whether they'd bought anything or not. Users saw "Kjøpt: 4"
  // + an "Avbestill bonger" button on first login, before any purchase.
  //
  // New behavior: unarmed players get an empty preRoundTickets entry (or
  // none at all). The scroll area is empty until they explicitly arm
  // pre-round tickets via Forhåndskjøp → +/- → Kjøp. Armed players still
  // get their chosen ticket count rendered for UX continuity (they see
  // the brett they paid for).
  //
  // Also skips the entry entirely (not even an empty array) for unarmed
  // players — keeps the wire-payload lean.
  const preRoundTickets: Record<string, Ticket[]> = {};
  const gameTickets = snapshot.currentGame?.tickets ?? {};
  const armedTicketCounts = opts.getArmedPlayerTicketCounts(snapshot.code);
  // BIN-688: resolve armed selections once so the loop can colour each
  // player's pre-round brett according to their specific pick.
  const armedSelections = opts.getArmedPlayerSelections?.(snapshot.code) ?? {};
  const variantInfoForColor = opts.getVariantConfig?.(snapshot.code);
  for (const player of snapshot.players) {
    // Mid-round additive-arm (2026-04-21): A player who is currently playing
    // can also arm brett for the NEXT round. The client shows both — live
    // myTickets (markable) and preRoundTickets (preview for next round). So
    // we generate preRoundTickets for EVERY armed player, not just those
    // without live tickets. Previously the `continue` here meant mid-round
    // buys vanished from the wire until the next round started.
    const armedCount = armedTicketCounts[player.id];
    if (armedCount === undefined || armedCount <= 0) {
      // Not armed — no preview tickets. Scroll area stays empty.
      continue;
    }
    // BIN-688: expand selections → per-ticket colour list when variant
    // config + selections are available. Missing either → undefined, so
    // the cache preserves backward-compatible "no colour" behaviour.
    const selections = armedSelections[player.id];
    let colorAssignments: Array<{ color: string; type: string }> | undefined;
    if (selections && selections.length > 0 && variantInfoForColor) {
      const assignments = expandSelectionsToTicketColors(
        selections,
        variantInfoForColor.config,
        variantInfoForColor.gameType,
      );
      // Trim/pad to armedCount so the cache contract (length === count)
      // never breaks — expand should already return exactly armedCount
      // entries, but this guards against off-by-one drift between the
      // armedCount stored in armedPlayerIdsByRoom and the bundle-
      // multiplied count derived from selections.
      if (assignments.length >= armedCount) {
        colorAssignments = assignments.slice(0, armedCount);
      } else if (assignments.length > 0) {
        // Pad by repeating the last known colour — avoids undefined-
        // colour slots when the client armed fewer selection slots than
        // the server-calculated ticket count. Rare; logged separately.
        colorAssignments = assignments.slice();
        while (colorAssignments.length < armedCount) {
          colorAssignments.push(assignments[assignments.length - 1]);
        }
      }
    }
    preRoundTickets[player.id] = getOrCreateDisplayTickets(
      snapshot.code,
      player.id,
      armedCount,
      snapshot.gameSlug,
      colorAssignments,
    );
  }

  // BIN-443: Include variant info so client can show correct purchase UI.
  // Fall back to default standard config so client always receives ticket types.
  const variantInfo = opts.getVariantConfig?.(snapshot.code);
  const effectiveGameType = variantInfo?.gameType ?? "standard";
  const effectiveConfig = variantInfo?.config ?? getDefaultVariantConfig(effectiveGameType);
  // Resolve a single authoritative entry fee for the room, regardless of
  // whether a game is currently running. The buy popup needs this BEFORE
  // the first round starts — earlier code fell back to a hard-coded "10 kr"
  // placeholder while the player was actually charged the configured price.
  const variantEntryFee = snapshot.currentGame?.entryFee && snapshot.currentGame.entryFee > 0
    ? snapshot.currentGame.entryFee
    : opts.getRoomConfiguredEntryFee(snapshot.code);
  const gameVariant = {
    gameType: effectiveGameType,
    ticketTypes: effectiveConfig.ticketTypes,
    replaceAmount: effectiveConfig.replaceAmount,
    // F3 (BIN-431): Propagate jackpot info from variant config → client HeaderBar.
    jackpot: effectiveConfig.jackpot,
    /** Per-ticket entry fee — populated even when no game is RUNNING so the
     *  buy popup can show real prices on first render. */
    entryFee: variantEntryFee,
  };

  // ── G15 (BIN-431): Enrich tickets with detail fields for flip-to-details ───
  // Web-klienten viser ticketNumber, hallName, supplierName og price når
  // spilleren tapper / snur et brett. Fields are all optional/non-breaking
  // — we populate them here (display-only; not persisted to the adapter) so
  // every emitted tickets payload carries them without touching BingoEngine's
  // ticket-creation flow.
  const hallName = opts.getHallName?.(snapshot.hallId) ?? snapshot.hallId;
  const supplierName = opts.supplierName ?? "Spillorama";
  const boughtAtIso = new Date(nowMs).toISOString();
  const currentEntryFee = snapshot.currentGame?.entryFee ?? opts.getRoomConfiguredEntryFee(snapshot.code);

  function enrichTicketList(list: Ticket[], fee: number): Ticket[] {
    return list.map((t, idx) => {
      const tt = effectiveConfig.ticketTypes.find((x: TicketTypeConfig) => x.type === t.type);
      const price = roundCurrency(fee * (tt?.priceMultiplier ?? 1));
      return {
        ...t,
        ticketNumber: t.ticketNumber ?? t.id ?? String(idx + 1),
        hallName: t.hallName ?? hallName,
        supplierName: t.supplierName ?? supplierName,
        price: t.price ?? price,
        boughtAt: t.boughtAt ?? boughtAtIso,
      };
    });
  }

  // Enrich in-game tickets (per player)
  const enrichedGameTickets: Record<string, Ticket[]> = {};
  for (const [pid, list] of Object.entries(gameTickets)) {
    enrichedGameTickets[pid] = enrichTicketList(list, currentEntryFee);
  }
  // Enrich pre-round tickets (per player)
  const enrichedPreRound: Record<string, Ticket[]> = {};
  for (const [pid, list] of Object.entries(preRoundTickets)) {
    enrichedPreRound[pid] = enrichTicketList(list, opts.getRoomConfiguredEntryFee(snapshot.code));
  }

  // ── Server-authoritative stake per player ──────────────────────────────────
  // Calculated here so the client never has to derive monetary amounts itself.
  //
  // Round-state-isolation (Tobias 2026-04-25, BIN-CRITICAL):
  //   playerStakes        = ACTIVE-ROUND risk only. RUNNING + gameTickets →
  //                         actual ticket cost. Otherwise: between-round
  //                         armed → projected next-round cost. Spectator
  //                         in a running round → 0 (no entry).
  //   playerPendingStakes = NEXT-ROUND commitment when a player has armed
  //                         pre-round tickets DURING a running round (the
  //                         money is already reserved but the tickets won't
  //                         play until the next round starts). Empty when
  //                         no game is running because the pre-round arm
  //                         IS the active stake at that point.
  const armedPlayerIds = opts.getArmedPlayerIds(snapshot.code);
  const armedPlayerSelections = opts.getArmedPlayerSelections?.(snapshot.code) ?? {};
  const isGameRunning = snapshot.currentGame?.status === "RUNNING";
  const playerStakes: Record<string, number> = {};
  const playerPendingStakes: Record<string, number> = {};
  const roomEntryFee = opts.getRoomConfiguredEntryFee(snapshot.code);
  const ticketTypes = effectiveConfig.ticketTypes;

  function priceForSelections(
    selections: Array<{ type: string; qty: number; name?: string }>,
    fee: number,
  ): number {
    return roundCurrency(
      selections.reduce((sum, sel) => {
        // Match by name first (Small Yellow vs Small Purple share type), fall
        // back to type for legacy single-name variants.
        const tt =
          (sel.name ? ticketTypes.find((x: TicketTypeConfig) => x.name === sel.name) : undefined) ??
          ticketTypes.find((x: TicketTypeConfig) => x.type === sel.type);
        return sum + fee * (tt?.priceMultiplier ?? 1) * sel.qty;
      }, 0),
    );
  }

  function priceForTickets(tickets: Ticket[], fee: number): number {
    return roundCurrency(
      tickets.reduce((sum, t) => {
        const tt = ticketTypes.find((x: TicketTypeConfig) => x.type === t.type);
        return sum + fee * (tt?.priceMultiplier ?? 1);
      }, 0),
    );
  }

  for (const player of snapshot.players) {
    if (isGameRunning) {
      // RUNNING — Innsats reflects ONLY what's at risk in the active round.
      // gameTickets[player.id] is empty for spectators → no stake entry.
      // Pre-round arms (armedPlayerIds) belong to NEXT round → playerPendingStakes.
      const liveTickets = gameTickets[player.id];
      if (liveTickets && liveTickets.length > 0 && snapshot.currentGame!.entryFee > 0) {
        playerStakes[player.id] = priceForTickets(liveTickets, snapshot.currentGame!.entryFee);
      }

      if (armedPlayerIds.includes(player.id) && roomEntryFee > 0) {
        const selections = armedPlayerSelections[player.id];
        if (selections && selections.length > 0) {
          playerPendingStakes[player.id] = priceForSelections(selections, roomEntryFee);
        } else {
          const pending = preRoundTickets[player.id] ?? [];
          if (pending.length > 0) {
            playerPendingStakes[player.id] = priceForTickets(pending, roomEntryFee);
          }
        }
      }
    } else {
      // WAITING / ENDED / no game — pre-round arm IS the active stake.
      // No separate pending bucket: the arm goes into Innsats so the player
      // sees what they'll pay when the next round starts.
      if (armedPlayerIds.includes(player.id) && roomEntryFee > 0) {
        const selections = armedPlayerSelections[player.id];
        if (selections && selections.length > 0) {
          playerStakes[player.id] = priceForSelections(selections, roomEntryFee);
        } else {
          const pending = preRoundTickets[player.id] ?? [];
          if (pending.length > 0) {
            playerStakes[player.id] = priceForTickets(pending, roomEntryFee);
          }
        }
      }
    }
  }

  // G15 (BIN-431): swap in the enriched ticket maps so both the live game
  // snapshot and the pre-round display list carry detail fields on the wire.
  const outSnapshot = snapshot.currentGame
    ? { ...snapshot, currentGame: { ...snapshot.currentGame, tickets: enrichedGameTickets } }
    : snapshot;

  return {
    ...outSnapshot,
    preRoundTickets: enrichedPreRound,
    armedPlayerIds,
    playerStakes,
    playerPendingStakes,
    luckyNumbers: getLuckyNumbers(snapshot.code),
    scheduler: buildRoomSchedulerState(snapshot, nowMs, opts),
    serverTimestamp: nowMs,
    gameVariant,
  };
}

// ── Leaderboard ────────────────────────────────────────────────────────────────

export function buildLeaderboard(
  roomCodes: string[],
  getRoomSnapshot: (code: string) => RoomSnapshot
): Array<{ nickname: string; points: number }> {
  const pointsByPlayer = new Map<string, { name: string; points: number }>();

  for (const code of roomCodes) {
    let snapshot: RoomSnapshot;
    try { snapshot = getRoomSnapshot(code); } catch { continue; }

    const nameById = new Map<string, string>();
    for (const p of snapshot.players) nameById.set(p.id, p.name);

    for (const game of snapshot.gameHistory) {
      for (const claim of game.claims) {
        if (!claim.valid) continue;
        const pts = claim.type === "BINGO" ? 2 : 1;
        const existing = pointsByPlayer.get(claim.playerId);
        const name = nameById.get(claim.playerId) ?? claim.playerId;
        if (existing) {
          existing.points += pts;
          if (!existing.name || existing.name === claim.playerId) existing.name = name;
        } else {
          pointsByPlayer.set(claim.playerId, { name, points: pts });
        }
      }
    }
  }

  return [...pointsByPlayer.values()]
    .sort((a, b) => b.points - a.points)
    .slice(0, 50)
    .map(({ name, points }) => ({ nickname: name, points }));
}
