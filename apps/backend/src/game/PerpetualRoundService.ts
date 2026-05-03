/**
 * PerpetualRoundService — auto-restart for Spill 2 (`rocket`) og Spill 3
 * (`monsterbingo`) etter at en runde har endt.
 *
 * Tobias-direktiv (2026-05-03):
 *   "Spill 2 og 3 har ETT globalt rom. Ingen group-of-halls, ingen master/
 *    start/stop. Aldri stopper — utbetal gevinst → fortsetter automatisk."
 *
 * Tilnærming:
 *   - Wires inn på `bingoAdapter.onGameEnded` (samme hook som Spill 2 ticket-
 *     pool-cleanup bruker). For runder i ROCKET / MONSTERBINGO scheduler vi
 *     en `setTimeout` som etter en kort delay (default 5 sek) starter en ny
 *     runde via `engine.startGame`.
 *   - Spill 1 (`bingo`-slug) er IKKE perpetual — Spill 1 har egen schedule-
 *     drevet master-start-flyt (`Game1MasterControlService`). Vi ignorerer
 *     alle non-Spill-2/3-rom uten side-effekter.
 *
 * Edge cases:
 *   1. **Tomt rom** (ingen spillere igjen) — vi skipper auto-spawn. Spillere
 *      som joiner senere starter ny runde via vanlig `game:start`-flyt eller
 *      når neste spiller arming + auto-round-tick.
 *   2. **Admin manual end** — hvis `endedReason` indikerer manuell end
 *      (`MANUAL_END`, `SYSTEM_ERROR`, eller annen reason vi ikke kjenner
 *      igjen), skipper vi auto-restart. Auto-restart trigges KUN på
 *      naturlig runde-end (G2_WINNER, G3_FULL_HOUSE, MAX_DRAWS_REACHED,
 *      DRAW_BAG_EMPTY).
 *   3. **Idempotens** — hvis vi allerede har en pending restart for rommet,
 *      skipper vi nye triggers. Hver runde-end kan bare føre til ÉN
 *      auto-restart; gjentatte trigger-kall (samme gameId) er no-op.
 *   4. **Service disabled / per-slug disable** — env-flagg lar ops skru av
 *      hele tjenesten eller én slug.
 *
 * Wallet-state: ingen direkte wallet-mutasjon her. Den nye runden starter
 * uten armed players — eksisterende spillere må selv re-velge tickets
 * (Spill 2: via Choose Tickets-side; Spill 3: via socket bet:arm) for å delta.
 * Lucky-number resettes ved ny runde (engine.startGame nullstiller).
 *
 * Spill 2 Choose Tickets-pool: pool blir slettet av eksisterende
 * `onGameEnded`-cleanup (apps/backend/src/index.ts:2334). Spillere må
 * besøke Choose Tickets på nytt for å kjøpe brett til neste runde.
 */

import { logger as rootLogger } from "../util/logger.js";
import type { GameEndedInput } from "../adapters/BingoSystemAdapter.js";

const logger = rootLogger.child({ module: "perpetual-round" });

/**
 * Slugs som er perpetual. Match (case-insensitive) mot `room.gameSlug` —
 * IKKE mot canonical roomCode, fordi en slug-til-roomCode-mapping kunne
 * endre seg uten at vi merker.
 */
export const PERPETUAL_SLUGS: ReadonlySet<string> = new Set(["rocket", "monsterbingo"]);

/**
 * Engine-overflate som tjenesten trenger. Kun lese-snapshot + startGame.
 * Holdt minimal slik at tjenesten lett kan testes uten full BingoEngine.
 */
export interface PerpetualEngine {
  getRoomSnapshot(roomCode: string): {
    code: string;
    hostPlayerId: string;
    hallId: string;
    gameSlug: string;
    players: ReadonlyArray<{ id: string }>;
    currentGame?: { status: string; id: string } | undefined;
  };
  startGame(input: {
    roomCode: string;
    actorPlayerId: string;
    entryFee?: number;
    ticketsPerPlayer?: number;
    payoutPercent: number;
    armedPlayerIds?: string[];
    armedPlayerTicketCounts?: Record<string, number>;
    armedPlayerSelections?: Record<string, Array<{ type: string; qty: number; name?: string }>>;
    gameType?: string;
    variantConfig?: import("./variantConfig.js").GameVariantConfig;
  }): Promise<void>;
}

/**
 * Variant-info-leser. Caller henter typisk via `roomState.getVariantConfig`.
 */
export interface VariantConfigLookup {
  getVariantConfig(roomCode: string): {
    gameType?: string;
    config?: import("./variantConfig.js").GameVariantConfig;
  } | null;
}

/**
 * Konfig som kontrollerer perpetual-loopens oppførsel.
 *
 * Defaults speiler Tobias-direktivet "kort delay etter winner-celebration".
 * 5 sekunder er nok for at klient kan vise vinner-overlay før neste runde
 * starter, men kort nok til at "Aldri stopper"-følelsen bevares.
 */
export interface PerpetualRoundServiceConfig {
  enabled: boolean;
  /** Delay før auto-restart trigges. Default 5 000 ms. */
  delayMs: number;
  /** Slugs som er disabled (subset av PERPETUAL_SLUGS). For test/staged rollout. */
  disabledSlugs: ReadonlySet<string>;
  engine: PerpetualEngine;
  variantLookup: VariantConfigLookup;
  /** Default ticketsPerPlayer for ny runde (auto-rundens default). */
  defaultTicketsPerPlayer: number;
  /** Default payoutPercent for ny runde. */
  defaultPayoutPercent: number;
  /** Default entryFee — typisk 0 for Spill 2/3 (digitale-bonger-kjøp er separat). */
  defaultEntryFee: number;
  /** Etter at startGame har returnert, broadcast room-state. Optional fail-soft. */
  emitRoomUpdate?: (roomCode: string) => Promise<void>;
  /**
   * Test-injection: bruk en custom timer-impl. Brukes av Vitest-tester slik
   * at vi ikke trenger fake-timers + setTimeout race conditions.
   *
   * Default i prod: `globalThis.setTimeout`/`clearTimeout`.
   */
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

/**
 * Reasons som anses som "naturlig runde-end" og dermed trigger auto-restart.
 *
 * Spill 2: `G2_WINNER` (auto-claim på 9/9 fullt 3×3).
 * Spill 3: `G3_FULL_HOUSE` (auto-claim på 9/9 fullt 3×3 etter PR #860).
 * Felles fallbacks: `MAX_DRAWS_REACHED`, `DRAW_BAG_EMPTY` — runden gikk tom
 *   for trekk uten vinner. Loop fortsetter for at "aldri stopper"-prinsippet
 *   skal holde.
 *
 * Eksplisitt EXCLUDED:
 *   - `MANUAL_END` (admin/host stopped runden)
 *   - `SYSTEM_ERROR` (fra DrawScheduler watchdog ved stuck-room)
 *   - Ukjente reasons → fail-closed, ingen auto-restart
 */
export const NATURAL_END_REASONS: ReadonlySet<string> = new Set([
  "G2_WINNER",
  "G3_FULL_HOUSE",
  "MAX_DRAWS_REACHED",
  "DRAW_BAG_EMPTY",
]);

/**
 * PerpetualRoundService.
 *
 * Wires `handleGameEnded` inn i `bingoAdapter.onGameEnded`-callbacks (via
 * monkey-patch i `index.ts`). Per game-end:
 *   - Filtrerer på slug (kun `rocket` / `monsterbingo`)
 *   - Filtrerer på endedReason (kun "naturlig" runde-end)
 *   - Idempotens-sjekk (samme gameId → no-op)
 *   - Schedulerer en auto-restart-callback etter `delayMs`
 *
 * Tjenesten er prosess-lokal og lever sammen med engine-instansen. Ingen
 * persistens — hvis prosessen restarter mens en pending restart venter,
 * blir runden ikke startet automatisk (men vil starte ved neste spiller-
 * trigget bet:arm + game:start).
 */
export class PerpetualRoundService {
  private readonly config: Required<Omit<PerpetualRoundServiceConfig, "emitRoomUpdate" | "setTimeoutFn" | "clearTimeoutFn">> & {
    emitRoomUpdate?: PerpetualRoundServiceConfig["emitRoomUpdate"];
    setTimeoutFn: NonNullable<PerpetualRoundServiceConfig["setTimeoutFn"]>;
    clearTimeoutFn: NonNullable<PerpetualRoundServiceConfig["clearTimeoutFn"]>;
  };

  /**
   * Pending-state per rom. Key = roomCode (e.g. "ROCKET").
   * Value: handle + gameId som trigget restart-en. gameId brukes til
   * idempotens-sjekk: hvis samme gameId trigger igjen (duplicate
   * onGameEnded-fire), no-op.
   */
  private readonly pendingByRoom = new Map<
    string,
    { handle: ReturnType<typeof setTimeout>; gameId: string }
  >();

  constructor(config: PerpetualRoundServiceConfig) {
    this.config = {
      enabled: config.enabled,
      delayMs: Math.max(0, config.delayMs),
      disabledSlugs: config.disabledSlugs,
      engine: config.engine,
      variantLookup: config.variantLookup,
      defaultTicketsPerPlayer: config.defaultTicketsPerPlayer,
      defaultPayoutPercent: config.defaultPayoutPercent,
      defaultEntryFee: config.defaultEntryFee,
      ...(config.emitRoomUpdate ? { emitRoomUpdate: config.emitRoomUpdate } : {}),
      setTimeoutFn: config.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimeoutFn: config.clearTimeoutFn ?? ((h) => clearTimeout(h)),
    };
  }

  /**
   * Hovedpunkt: kalles fra `bingoAdapter.onGameEnded`-wiring i index.ts.
   *
   * Fail-soft: alle feil fanges og logges. Auto-restart-tilnærmingen er
   * en convenience-funksjon — hvis den feiler skal IKKE eksisterende
   * cleanup-flyt brytes.
   */
  handleGameEnded(input: GameEndedInput): void {
    if (!this.config.enabled) return;

    let snapshot;
    try {
      snapshot = this.config.engine.getRoomSnapshot(input.roomCode);
    } catch (err) {
      // Rommet kan være destroyed mellom game.ended og denne callbacken.
      logger.debug({ roomCode: input.roomCode, err }, "perpetual: room not found, skip");
      return;
    }

    const slug = (snapshot.gameSlug ?? "").toLowerCase().trim();
    if (!PERPETUAL_SLUGS.has(slug)) {
      // Ikke et perpetual-spill — Spill 1 (`bingo`) faller hit.
      return;
    }
    if (this.config.disabledSlugs.has(slug)) {
      logger.info(
        { roomCode: input.roomCode, slug, reason: "slug_disabled" },
        "perpetual: skip restart",
      );
      return;
    }

    if (!NATURAL_END_REASONS.has(input.endedReason)) {
      logger.info(
        {
          roomCode: input.roomCode,
          slug,
          endedReason: input.endedReason,
          gameId: input.gameId,
          reason: "manual_or_unknown_end",
        },
        "perpetual: skip restart",
      );
      return;
    }

    // Idempotens: hvis vi allerede har pending restart for samme gameId,
    // ikke schedule på nytt. (Dual onGameEnded-fire eks. via wrapping.)
    const existing = this.pendingByRoom.get(input.roomCode);
    if (existing && existing.gameId === input.gameId) {
      logger.debug(
        { roomCode: input.roomCode, gameId: input.gameId },
        "perpetual: duplicate trigger ignored (idempotent)",
      );
      return;
    }

    // Hvis det finnes en gammel pending for rommet (annen gameId), avbryt
    // den og erstatt med nyere — det betyr at en ny runde har startet og
    // også endt før forrige restart trigget. (Skal være sjeldent, men
    // beskytter mot ophobing.)
    if (existing) {
      this.config.clearTimeoutFn(existing.handle);
      this.pendingByRoom.delete(input.roomCode);
    }

    const roomCode = input.roomCode;
    const gameId = input.gameId;
    const handle = this.config.setTimeoutFn(() => {
      // Fjern pending FØR start så en ny game-end (etter at restart er
      // kjørt) kan schedule på nytt. Hvis startRound feiler vil pending
      // også være fjernet — det er ønskelig, vi vil ikke at en hengende
      // pending blokkerer fremtidige triggers.
      this.pendingByRoom.delete(roomCode);
      void this.startNextRound(roomCode, gameId);
    }, this.config.delayMs);
    this.pendingByRoom.set(roomCode, { handle, gameId });

    logger.info(
      {
        roomCode,
        slug,
        endedGameId: gameId,
        endedReason: input.endedReason,
        delayMs: this.config.delayMs,
      },
      "perpetual: scheduled auto-restart",
    );
  }

  /**
   * Internal: gjør selve `engine.startGame`-kallet med room-snapshot-state.
   *
   * Vi henter snapshot fersk her (ikke fra closure) fordi:
   *   - Spillere kan ha blitt med eller forlatt mellom schedule og restart.
   *   - room.hostPlayerId kan ha endret seg (host disconnected-flyt).
   */
  private async startNextRound(roomCode: string, prevGameId: string): Promise<void> {
    let snapshot;
    try {
      snapshot = this.config.engine.getRoomSnapshot(roomCode);
    } catch (err) {
      logger.warn(
        { roomCode, prevGameId, err },
        "perpetual: room destroyed before restart fired, skip",
      );
      return;
    }

    // Tomt rom: ingen spillere igjen, ikke spawn ny runde. Ny runde vil
    // spawnes når neste spiller joiner og trigger bet:arm + game:start.
    if (snapshot.players.length === 0) {
      logger.info(
        { roomCode, prevGameId, reason: "empty_room" },
        "perpetual: skip restart (no players)",
      );
      return;
    }

    // Sanity: hvis rommet allerede har en RUNNING game (fordi noen
    // manuelt startet i mellomtiden), no-op.
    if (snapshot.currentGame?.status === "RUNNING") {
      logger.info(
        {
          roomCode,
          prevGameId,
          currentGameId: snapshot.currentGame.id,
          reason: "already_running",
        },
        "perpetual: skip restart (round already in progress)",
      );
      return;
    }

    const variantInfo = this.config.variantLookup.getVariantConfig(roomCode);
    const startInput: Parameters<PerpetualEngine["startGame"]>[0] = {
      roomCode,
      actorPlayerId: snapshot.hostPlayerId,
      entryFee: this.config.defaultEntryFee,
      ticketsPerPlayer: this.config.defaultTicketsPerPlayer,
      payoutPercent: this.config.defaultPayoutPercent,
      // Spill 2/3 perpetual: ingen carry-over av armed players. Spillere
      // må re-velge tickets (Spill 2: Choose Tickets-side; Spill 3: bet:arm)
      // for å delta i neste runde. Auto-runde starter likevel — det er
      // selve spinningen som er "perpetual", ikke individuelle bonger.
      armedPlayerIds: [],
      armedPlayerTicketCounts: {},
      armedPlayerSelections: {},
      ...(variantInfo?.gameType ? { gameType: variantInfo.gameType } : {}),
      ...(variantInfo?.config ? { variantConfig: variantInfo.config } : {}),
    };

    try {
      await this.config.engine.startGame(startInput);
      logger.info(
        {
          roomCode,
          prevGameId,
          slug: snapshot.gameSlug,
          actorPlayerId: snapshot.hostPlayerId,
        },
        "perpetual: auto-restart succeeded",
      );

      if (this.config.emitRoomUpdate) {
        try {
          await this.config.emitRoomUpdate(roomCode);
        } catch (err) {
          logger.warn(
            { roomCode, prevGameId, err },
            "perpetual: emitRoomUpdate failed (best-effort, continuing)",
          );
        }
      }
    } catch (err) {
      // Failure paths vi forventer + tolererer:
      //   - NOT_ENOUGH_PLAYERS: rommet har < minPlayersToStart spillere
      //   - ROUND_START_TOO_SOON: forrige runde for nylig (rate-limit)
      //   - PLAYER_ALREADY_IN_RUNNING_GAME: en spiller har raket inn i
      //     annet rom mellom snapshot og start
      //   - INVALID_ENTRY_FEE: konfig-feil — synlig i logs
      // I ALLE tilfeller logger vi og lar være å re-throwe — perpetual
      // er en convenience, ikke source of truth.
      logger.warn(
        {
          roomCode,
          prevGameId,
          err: err instanceof Error ? { message: err.message, code: (err as Error & { code?: string }).code } : String(err),
        },
        "perpetual: auto-restart failed (best-effort)",
      );
    }
  }

  /**
   * Spawn first-runde for et perpetual-rom når en spiller joiner og det
   * ikke finnes en aktiv runde. Kalles fra `room:join`-handler etter
   * vellykket join — symmetrisk med `handleGameEnded` som schedulerer
   * neste runde etter naturlig end.
   *
   * Forskjell fra `handleGameEnded`: ingen `setTimeout`-delay. First-
   * round-spawn skjer umiddelbart slik at spilleren får se en runde
   * starte med en gang i stedet for "Stengt" 5 sekunder etter join.
   *
   * No-op (returnerer false uten side-effekter) når:
   *   - Slugen ikke er perpetual (Spill 1 / SpinnGo / ukjent)
   *   - Slugen er disabled via env-config
   *   - Servicen er disabled
   *   - Rommet har allerede en RUNNING (eller WAITING) runde
   *   - Rommet har en pending auto-restart fra forrige runde (hindrer
   *     race der join skjer ~5s etter game-end mens timer venter)
   *   - Rommet er tomt (men dette er sjeldent — handler-en kaller etter
   *     at spilleren har joined)
   *   - `getRoomSnapshot` kaster (rom destroyed mellom join og spawn)
   *
   * Idempotens: hvis to spillere joiner ROCKET nesten samtidig (samme
   * tick) vil begge kall se `currentGame` som undefined. Den første
   * kaller `engine.startGame` som setter status til RUNNING. Den andre
   * ser `RUNNING` og no-op'er. Race-vinduet er smalt fordi
   * `engine.startGame` er synkron-til-status-set i BingoEngine, og
   * Node.js single-threaded event-loop sikrer at en handler kjører ferdig
   * (modulo `await`) før neste socket-event prosesseres.
   *
   * Returnerer `true` hvis en runde faktisk ble spawnet, `false` ellers.
   * Caller bruker `false`-returnen kun til logging/observability — ingen
   * UI-konsekvens. `emitRoomUpdate` kalles internt på success så klient-
   * siden får oppdatert `currentGame` med en gang.
   */
  async spawnFirstRoundIfNeeded(roomCode: string): Promise<boolean> {
    if (!this.config.enabled) return false;

    let snapshot;
    try {
      snapshot = this.config.engine.getRoomSnapshot(roomCode);
    } catch (err) {
      logger.debug({ roomCode, err }, "perpetual: room not found in spawnFirstRoundIfNeeded");
      return false;
    }

    const slug = (snapshot.gameSlug ?? "").toLowerCase().trim();
    if (!PERPETUAL_SLUGS.has(slug)) {
      // Spill 1 (`bingo`) + SpinnGo (`spillorama`) + ukjente slugs faller
      // hit. Ingen logging — kalles på alle joins så det ville flomme.
      return false;
    }
    if (this.config.disabledSlugs.has(slug)) {
      logger.info(
        { roomCode, slug, reason: "slug_disabled" },
        "perpetual: skip first-round spawn",
      );
      return false;
    }

    // Pending auto-restart fra forrige runde: hvis perpetual-tjenesten
    // venter på å fyre `engine.startGame` etter en game-end, ikke
    // dupliser. Ny runde kommer av seg selv.
    if (this.pendingByRoom.has(roomCode)) {
      logger.debug(
        { roomCode, slug, reason: "restart_pending" },
        "perpetual: skip first-round spawn (auto-restart pending)",
      );
      return false;
    }

    // Aktiv runde: WAITING (mellom rounds, sjelden i perpetual) eller
    // RUNNING betyr at en annen handler allerede har spawnet runden.
    // ENDED er OK — det er en arkivert runde og auto-restart skal ha
    // ryddet før denne tilstanden får henge for lenge, men ENDED-state
    // betyr engine.startGame vil archive den og lage ny.
    const currentStatus = snapshot.currentGame?.status;
    if (currentStatus === "WAITING" || currentStatus === "RUNNING") {
      logger.debug(
        {
          roomCode,
          slug,
          currentGameId: snapshot.currentGame?.id,
          currentStatus,
          reason: "round_active",
        },
        "perpetual: skip first-round spawn (round already active)",
      );
      return false;
    }

    if (snapshot.players.length === 0) {
      // Defensivt: room:join-handler kaller etter at spilleren er joined,
      // så dette skal ikke skje. Logger som warn for å fange evt. timing-
      // bug.
      logger.warn(
        { roomCode, slug, reason: "empty_room" },
        "perpetual: skip first-round spawn (no players — unexpected at join-time)",
      );
      return false;
    }

    const variantInfo = this.config.variantLookup.getVariantConfig(roomCode);
    const startInput: Parameters<PerpetualEngine["startGame"]>[0] = {
      roomCode,
      actorPlayerId: snapshot.hostPlayerId,
      entryFee: this.config.defaultEntryFee,
      ticketsPerPlayer: this.config.defaultTicketsPerPlayer,
      payoutPercent: this.config.defaultPayoutPercent,
      // Symmetrisk med auto-restart: ingen carry-over av armed players.
      // Spillere må re-velge tickets for å delta i den spawned runden.
      armedPlayerIds: [],
      armedPlayerTicketCounts: {},
      armedPlayerSelections: {},
      ...(variantInfo?.gameType ? { gameType: variantInfo.gameType } : {}),
      ...(variantInfo?.config ? { variantConfig: variantInfo.config } : {}),
    };

    try {
      await this.config.engine.startGame(startInput);
      logger.info(
        {
          roomCode,
          slug,
          actorPlayerId: snapshot.hostPlayerId,
          playerCount: snapshot.players.length,
        },
        "perpetual: first-round spawn succeeded",
      );

      if (this.config.emitRoomUpdate) {
        try {
          await this.config.emitRoomUpdate(roomCode);
        } catch (err) {
          logger.warn(
            { roomCode, err },
            "perpetual: emitRoomUpdate failed after first-round spawn (best-effort)",
          );
        }
      }
      return true;
    } catch (err) {
      // Samme failure-paths som auto-restart — fail-soft.
      // PLAYER_ALREADY_IN_RUNNING_GAME / NOT_ENOUGH_PLAYERS / ROUND_START_TOO_SOON
      // er forventede skip-conditions. Logger på warn for sjelden / uventet
      // failure (INVALID_ENTRY_FEE etc.).
      logger.warn(
        {
          roomCode,
          err: err instanceof Error
            ? { message: err.message, code: (err as Error & { code?: string }).code }
            : String(err),
        },
        "perpetual: first-round spawn failed (best-effort)",
      );
      return false;
    }
  }

  /**
   * Test-helper: returner antall pending restarts. Brukes av
   * Vitest-tester for å verifisere idempotens uten å peke inn i
   * private state.
   */
  pendingCountForTesting(): number {
    return this.pendingByRoom.size;
  }

  /**
   * Test-helper: avbryt alle pending restarts. Brukes typisk i `afterEach`
   * for å hindre tester i å kjøre callbacks etter at testen er ferdig.
   */
  cancelAllForTesting(): void {
    for (const { handle } of this.pendingByRoom.values()) {
      this.config.clearTimeoutFn(handle);
    }
    this.pendingByRoom.clear();
  }
}
