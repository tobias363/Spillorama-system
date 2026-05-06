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
 *     en `setTimeout` som etter en konfigurerbar delay starter en ny runde
 *     via `engine.startGame`. Delay-en styres av `PERPETUAL_LOOP_DELAY_MS`
 *     env-var (default 5 sek; prod-Render satt til 30 sek per Tobias-
 *     direktiv 2026-05-04 så spillerne får tid til å se vinner-overlay
 *     og forhåndskjøpe brett før neste runde starter — speiler Spill 1's
 *     30-sek-mellomrom).
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
import { resolveRoundPauseMs } from "./variantConfig.js";
// Fase 2A (2026-05-05): structured-logger for error-code-tagging på BIN-RKT-
// {006,007,008}. PoC — eksisterende info/debug-calls beholdes.
import { logWarn } from "../observability/structuredLogger.js";
import { GAME2_SLUGS } from "./Game2AutoDrawTickService.js";
import { GAME3_SLUGS } from "./Game3AutoDrawTickService.js";
import { SYSTEM_ACTOR_ID } from "./SystemActor.js";

const logger = rootLogger.child({ module: "perpetual-round" });
const MODULE_NAME = "PerpetualRoundService";

/**
 * Slugs som er perpetual (Spill 2 + Spill 3). Match (case-insensitive) mot
 * `room.gameSlug` — IKKE mot canonical roomCode, fordi en slug-til-roomCode-
 * mapping kunne endre seg uten at vi merker.
 *
 * Kilden er `GAME2_SLUGS` og `GAME3_SLUGS` fra de respektive auto-draw-
 * tjenestene, slik at vi har én sannhets-kilde. Tidligere hardkodet vi kun
 * `["rocket", "monsterbingo"]` — det dekket ikke aliaser som
 * `tallspill`/`game_2` (Spill 2) og `mønsterbingo`/`game_3` (Spill 3),
 * som brukes i markedsføring og legacy-rom. Audit §2.7 (2026-05-05).
 */
export const PERPETUAL_SLUGS: ReadonlySet<string> = new Set<string>([
  ...GAME2_SLUGS,
  ...GAME3_SLUGS,
]);

/**
 * Returnerer true hvis `slug` er en perpetual-slug (Spill 2/3, alle aliaser).
 *
 * Brukes som single-source-of-truth for slug-conditional logikk i
 * `BingoEngine.assertHost`, socket-handlers (slug-gates), og
 * `DrawOrchestrationService`. Tidligere hadde vi spredt `slug === "rocket"
 * || slug === "monsterbingo"`-checks som kun dekket de to canonical-formene
 * og IKKE aliasene `tallspill`/`game_2`/`mønsterbingo`/`game_3`. Audit §2.7.
 *
 * Match-en er case-insensitive og whitespace-tolerant — slug fra DB/seed
 * kan være lagret med trailing-space eller upper-case casing.
 */
export function isPerpetualSlug(slug: string | undefined | null): boolean {
  if (slug == null) return false;
  return PERPETUAL_SLUGS.has(slug.toLowerCase().trim());
}

/**
 * 2026-05-04 (Tobias bug-fix): per-slug default entry fee for perpetual-
 * loop-starts. Spill 2 (`rocket`) og Spill 3 (`monsterbingo`) er
 * ekte-pengespill med 10 kr per brett som baseline.
 *
 * Tidligere brukte vi `runtimeBingoSettings.autoRoundEntryFee` for alle
 * perpetual-runder; den default-en er 0 (free-play) og laget for Spill 1's
 * dev-flow. Resultat: prod-Spill 2/3 startet med entryFee=0, prizePool=0
 * og ingen utbetaling — bekreftet via `/api/_dev/game2-state`.
 *
 * Faller tilbake til `defaultEntryFee` (env-driven) for ukjente slugs slik
 * at fremtidige perpetual-spill kan styres via env uten kode-endring.
 */
export const PERPETUAL_DEFAULT_ENTRY_FEE_BY_SLUG: ReadonlyMap<string, number> = new Map([
  // Spill 2 — alle aliaser har samme baseline (10 kr/brett).
  ["rocket", 10],
  ["game_2", 10],
  ["tallspill", 10],
  // Spill 3 — alle aliaser har samme baseline (10 kr/brett).
  ["monsterbingo", 10],
  ["mønsterbingo", 10],
  ["game_3", 10],
]);

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
 * 2026-05-04 (Tobias-direktiv): lookup for armed-state per rom. Spillere
 * som "armer" via BuyPopup mellom runder må carry over til neste spawn —
 * ellers får de aldri tickets og bonger vises ikke. Denne lookup leser
 * fra roomState.armedPlayerIdsByRoom + armedPlayerSelectionsByRoom.
 *
 * Returnerer tom liste hvis ingen er armed eller rommet ikke finnes.
 */
export interface ArmedPlayerLookup {
  getArmedPlayerIds(roomCode: string): string[];
  getArmedPlayerTicketCounts(roomCode: string): Record<string, number>;
  getArmedPlayerSelections(roomCode: string): Record<
    string,
    Array<{ type: string; qty: number; name?: string }>
  >;
}

/**
 * Konfig som kontrollerer perpetual-loopens oppførsel.
 *
 * Defaults speiler Tobias-direktivet "kort delay etter winner-celebration".
 * 5 sekunder er nok for at klient kan vise vinner-overlay før neste runde
 * starter; prod overrider til 30 sekunder via `PERPETUAL_LOOP_DELAY_MS=30000`
 * for Spill 1-paritet (gir spillerne tid til å forhåndskjøpe brett).
 */
export interface PerpetualRoundServiceConfig {
  enabled: boolean;
  /**
   * Delay før auto-restart trigges. Default 5 000 ms (overrides via
   * `PERPETUAL_LOOP_DELAY_MS` env-var; prod-Render satt til 30 000 ms
   * for Spill 1-paritet).
   */
  delayMs: number;
  /** Slugs som er disabled (subset av PERPETUAL_SLUGS). For test/staged rollout. */
  disabledSlugs: ReadonlySet<string>;
  engine: PerpetualEngine;
  variantLookup: VariantConfigLookup;
  /**
   * 2026-05-04 (Tobias): hvis satt, leser armed-state fra roomState og
   * carry-over til ny runde. Default-fallback (undefined): tom armed-liste
   * (legacy oppførsel). Spill 2/3 SKAL bruke denne så spillere som armer
   * via BuyPopup mellom runder faktisk får tickets ved neste spawn.
   */
  armedLookup?: ArmedPlayerLookup;
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
 * Spill 2: `G2_NO_WINNER` (alle 21 baller trukket uten 9/9-completion —
 *   Game2Engine.onDrawCompleted, linje 183. Pilot-bug 2026-05-04: før
 *   denne ble lagt til hang ROCKET-rom på `endedReason=G2_NO_WINNER`
 *   uten å spawne ny runde, fordi handleGameEnded-filteret nedenfor
 *   slapp G2_NO_WINNER til "manual_or_unknown_end"-pathen.)
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
  "G2_NO_WINNER",
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
  private readonly config: Required<Omit<PerpetualRoundServiceConfig, "emitRoomUpdate" | "setTimeoutFn" | "clearTimeoutFn" | "armedLookup">> & {
    emitRoomUpdate?: PerpetualRoundServiceConfig["emitRoomUpdate"];
    setTimeoutFn: NonNullable<PerpetualRoundServiceConfig["setTimeoutFn"]>;
    clearTimeoutFn: NonNullable<PerpetualRoundServiceConfig["clearTimeoutFn"]>;
    armedLookup?: ArmedPlayerLookup;
  };

  /**
   * Pending-state per rom. Key = roomCode (e.g. "ROCKET").
   * Value: handle + gameId som trigget restart-en + planlagt fyringspunkt
   * (epoch ms). gameId brukes til idempotens-sjekk: hvis samme gameId
   * trigger igjen (duplicate onGameEnded-fire), no-op.
   *
   * 2026-05-04 (Tobias bug-fix Bug 1): `nextRoundAtMs` lagres så
   * `buildRoomSchedulerState` kan surface `millisUntilNextStart` for
   * perpetual-rom mellom runder. Tidligere var dette null fordi
   * `runtimeBingoSettings.autoRoundStartEnabled` er false for Spill 2/3
   * (de bruker perpetual-loop, ikke DrawScheduler), og UI viste "—:—".
   */
  private readonly pendingByRoom = new Map<
    string,
    { handle: ReturnType<typeof setTimeout>; gameId: string; nextRoundAtMs: number }
  >();

  /**
   * Tobias-direktiv 2026-05-06 (Phase 4): min-tickets-gate.
   *
   * Når `variantConfig.minTicketsBeforeCountdown > 0` venter vi på at
   * `sum(armedPlayerTicketCounts)` >= threshold før vi schedulerer
   * countdown for ny runde. Polling skjer hver 2 sekund via setInterval.
   *
   * Sikkerhets-timeout: 30 min max. Hvis threshold ikke nås innen det,
   * starter vi runden uansett (forhindrer evig hengende rom).
   *
   * In-memory state: tap ved restart håndteres av `spawnFirstRoundIfNeeded`
   * som re-evaluerer threshold når neste spiller joiner et tomt perpetual-rom.
   */
  private readonly waitingForTicketsByRoom = new Map<
    string,
    {
      pollHandle: ReturnType<typeof setInterval>;
      timeoutHandle: ReturnType<typeof setTimeout>;
      prevGameId: string;
      slug: string;
      minTickets: number;
      waitingSince: number;
    }
  >();

  /** Polling-intervall (ms) for ticket-count-sjekk under WAITING_FOR_TICKETS. */
  private static readonly THRESHOLD_POLL_INTERVAL_MS = 2_000;

  /** Max ventetid før vi starter runden uansett (sikkerhet mot stuck rooms). */
  private static readonly THRESHOLD_MAX_WAIT_MS = 30 * 60 * 1_000;

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
      ...(config.armedLookup ? { armedLookup: config.armedLookup } : {}),
      setTimeoutFn: config.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimeoutFn: config.clearTimeoutFn ?? ((h) => clearTimeout(h)),
    };
    // Debug-bug 2026-05-03: bekreft at perpetual-service er instansiert med
    // riktig konfig på boot. Tidligere var det ingen måte å verifisere
    // service-state utenom kode-inspeksjon — særlig om enabled-flagget var
    // satt feil i Render-env, eller om defaultEntryFee/payoutPercent ble
    // tatt fra runtime-defaults i stedet for env.
    logger.info(
      {
        enabled: this.config.enabled,
        delayMs: this.config.delayMs,
        disabledSlugs: [...this.config.disabledSlugs],
        defaultTicketsPerPlayer: this.config.defaultTicketsPerPlayer,
        defaultPayoutPercent: this.config.defaultPayoutPercent,
        defaultEntryFee: this.config.defaultEntryFee,
        perpetualSlugs: [...PERPETUAL_SLUGS],
      },
      "perpetual: service initialized",
    );
  }

  /**
   * 2026-05-04 (Tobias bug-fix): resolve default entry fee for the round
   * about to be started. Per-slug overrides (Spill 2 / Spill 3 = 10 kr)
   * win over `defaultEntryFee`-config so perpetual rounds start with a
   * non-zero prizePool — the env-driven default (typically 0 for dev)
   * is only used as a last-resort fallback for unknown slugs.
   *
   * Slug match is case-insensitive + trim for robustness against legacy
   * casing inconsistencies (matches `PERPETUAL_SLUGS` membership check).
   */
  private resolveEntryFeeForSlug(gameSlug: string): number {
    const normalized = (gameSlug ?? "").toLowerCase().trim();
    const slugDefault = PERPETUAL_DEFAULT_ENTRY_FEE_BY_SLUG.get(normalized);
    return slugDefault !== undefined ? slugDefault : this.config.defaultEntryFee;
  }

  /**
   * Hovedpunkt: kalles fra `bingoAdapter.onGameEnded`-wiring i index.ts.
   *
   * Fail-soft: alle feil fanges og logges. Auto-restart-tilnærmingen er
   * en convenience-funksjon — hvis den feiler skal IKKE eksisterende
   * cleanup-flyt brytes.
   */
  handleGameEnded(input: GameEndedInput): void {
    if (!this.config.enabled) {
      logger.info(
        { roomCode: input.roomCode, gameId: input.gameId, reason: "service_disabled" },
        "perpetual: skip restart",
      );
      return;
    }

    let snapshot;
    try {
      snapshot = this.config.engine.getRoomSnapshot(input.roomCode);
    } catch (err) {
      // Rommet kan være destroyed mellom game.ended og denne callbacken.
      // Debug-bug 2026-05-03: bumpet til info for prod-synlighet.
      logger.info(
        {
          roomCode: input.roomCode,
          gameId: input.gameId,
          err: err instanceof Error ? { message: err.message, code: (err as Error & { code?: string }).code } : String(err),
        },
        "perpetual: skip restart (room not found)",
      );
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
      // Debug-bug 2026-05-03: bumpet til info så vi ser duplicate-fire
      // pattern i prod (kan signalisere bug i adapter-wrapping).
      logger.info(
        { roomCode: input.roomCode, gameId: input.gameId, reason: "duplicate_trigger" },
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

    // Tobias 2026-05-04: per-game-konfigurerbar runde-pause. Resolusjons-
    // rekkefølge: variantConfig.roundPauseMs (admin-konfig fra DB) → env-
    // var-fallback (this.config.delayMs). Slik kan admin sette ulik tempo
    // per spill uten å berøre Render-env-vars. Ugyldig per-game-verdi
    // faller stille til env-fallback (resolveRoundPauseMs validerer).
    const variantInfo = this.config.variantLookup.getVariantConfig(input.roomCode);
    const delayMs = resolveRoundPauseMs(
      variantInfo?.config,
      this.config.delayMs,
    );

    // Tobias-direktiv 2026-05-06 (Phase 4): min-tickets-gate.
    // Hvis admin har satt `minTicketsBeforeCountdown > 0` i config.spill2/3,
    // vent på at totalt ticket-count i rommet når threshold før vi
    // schedulerer countdown. Default 0 = ingen gating (fortsett som før).
    const minTicketsRaw = variantInfo?.config?.minTicketsBeforeCountdown;
    const minTickets =
      typeof minTicketsRaw === "number" && Number.isFinite(minTicketsRaw) && minTicketsRaw > 0
        ? Math.floor(minTicketsRaw)
        : 0;

    if (minTickets > 0) {
      // Aktiver waiting-for-tickets-gate. Først rydd eventuell pending fra
      // forrige runde (idempotens), så start polling.
      this.clearWaitingForTickets(input.roomCode);
      this.startWaitingForTickets({
        roomCode: input.roomCode,
        prevGameId: input.gameId,
        slug,
        minTickets,
      });
      return;
    }

    const roomCode = input.roomCode;
    const gameId = input.gameId;
    // 2026-05-04 (Bug 1 fix): record the scheduled-fire-at timestamp so
    // `buildRoomSchedulerState` kan surface countdown via room:update.
    // Beregnes FØR setTimeoutFn slik at clock-skew mellom Date.now() og
    // setTimeout-arming er minimal (én tick, samme prosess). Bruker
    // `delayMs` (per-game-resolved fra #907) ikke `this.config.delayMs`
    // (env-default) — slik at countdown matcher faktisk pause.
    const nextRoundAtMs = Date.now() + delayMs;
    const handle = this.config.setTimeoutFn(() => {
      // Fjern pending FØR start så en ny game-end (etter at restart er
      // kjørt) kan schedule på nytt. Hvis startRound feiler vil pending
      // også være fjernet — det er ønskelig, vi vil ikke at en hengende
      // pending blokkerer fremtidige triggers.
      this.pendingByRoom.delete(roomCode);
      void this.startNextRound(roomCode, gameId);
    }, delayMs);
    this.pendingByRoom.set(roomCode, { handle, gameId, nextRoundAtMs });

    // Logger kilden så vi kan diagnose admin-config vs env-default i prod.
    // `variantConfig` betyr at admin-konfigurert roundPauseMs ble brukt;
    // `envFallback` betyr at variantConfig manglet feltet eller var
    // ugyldig (resolveRoundPauseMs falt tilbake til env-default).
    const delayMsSource =
      delayMs === Math.floor(variantInfo?.config?.roundPauseMs ?? -1)
        ? "variantConfig"
        : "envFallback";
    logger.info(
      {
        roomCode,
        slug,
        endedGameId: gameId,
        endedReason: input.endedReason,
        delayMs,
        delayMsSource,
      },
      "perpetual: scheduled auto-restart",
    );
  }

  // ── Phase 4: Min-tickets-gate ─────────────────────────────────────────────

  /**
   * Tobias-direktiv 2026-05-06: start polling for ticket-count-threshold.
   * Når threshold nådd → schedule normal countdown via startScheduledCountdown.
   */
  private startWaitingForTickets(input: {
    roomCode: string;
    prevGameId: string;
    slug: string;
    minTickets: number;
  }): void {
    const { roomCode, prevGameId, slug, minTickets } = input;
    const waitingSince = Date.now();

    // Polling-tick: sjekk ticket-count hvert 2. sekund.
    const pollHandle = setInterval(() => {
      this.checkThresholdAndProceed(roomCode);
    }, PerpetualRoundService.THRESHOLD_POLL_INTERVAL_MS);

    // Sikkerhets-timeout: max 30 min ventetid. Etter det starter vi
    // runden uansett — bedre enn evig hengende rom.
    const timeoutHandle = setTimeout(() => {
      logger.warn(
        {
          roomCode,
          slug,
          minTickets,
          waitedMs: Date.now() - waitingSince,
        },
        "perpetual: threshold-wait timeout — starting round anyway",
      );
      void this.proceedToCountdown(roomCode, "TIMEOUT");
    }, PerpetualRoundService.THRESHOLD_MAX_WAIT_MS);

    this.waitingForTicketsByRoom.set(roomCode, {
      pollHandle,
      timeoutHandle,
      prevGameId,
      slug,
      minTickets,
      waitingSince,
    });

    logger.info(
      {
        roomCode,
        slug,
        prevGameId,
        minTickets,
        pollIntervalMs: PerpetualRoundService.THRESHOLD_POLL_INTERVAL_MS,
        maxWaitMs: PerpetualRoundService.THRESHOLD_MAX_WAIT_MS,
      },
      "perpetual: waiting for tickets threshold",
    );
  }

  /**
   * Sjekk om current ticket-count >= threshold. Hvis ja, fortsett til
   * countdown-scheduling. Hvis rommet er tomt (ingen spillere), avbryt
   * waiting (ingen vits å vente i tomt rom).
   */
  private checkThresholdAndProceed(roomCode: string): void {
    const waiting = this.waitingForTicketsByRoom.get(roomCode);
    if (!waiting) return;

    // Hvis ingen armed-lookup, kan vi ikke telle — bare fortsett (0 = pass).
    if (!this.config.armedLookup) {
      void this.proceedToCountdown(roomCode, "NO_LOOKUP");
      return;
    }

    // Sjekk om rommet fortsatt har spillere. Tom rom = avbryt.
    let snapshot;
    try {
      snapshot = this.config.engine.getRoomSnapshot(roomCode);
    } catch {
      // Rommet er borte. Rydd waiting-state.
      this.clearWaitingForTickets(roomCode);
      logger.info(
        { roomCode },
        "perpetual: threshold-wait aborted — room destroyed",
      );
      return;
    }
    if (snapshot.players.length === 0) {
      this.clearWaitingForTickets(roomCode);
      logger.info(
        { roomCode, reason: "empty_room" },
        "perpetual: threshold-wait aborted — no players",
      );
      return;
    }

    // Tell totale armed-tickets i rommet.
    const counts = this.config.armedLookup.getArmedPlayerTicketCounts(roomCode);
    const totalTickets = Object.values(counts).reduce((sum, n) => sum + n, 0);

    if (totalTickets >= waiting.minTickets) {
      logger.info(
        {
          roomCode,
          slug: waiting.slug,
          totalTickets,
          minTickets: waiting.minTickets,
          waitedMs: Date.now() - waiting.waitingSince,
        },
        "perpetual: threshold reached — proceeding to countdown",
      );
      void this.proceedToCountdown(roomCode, "THRESHOLD_REACHED");
    }
  }

  /**
   * Threshold er nådd (eller bypass via NO_LOOKUP/TIMEOUT) — rydd
   * waiting-state og schedule normal countdown via samme delayMs som
   * `handleGameEnded` ville brukt.
   */
  private async proceedToCountdown(
    roomCode: string,
    triggerReason: "THRESHOLD_REACHED" | "TIMEOUT" | "NO_LOOKUP",
  ): Promise<void> {
    const waiting = this.waitingForTicketsByRoom.get(roomCode);
    if (!waiting) return;
    const { prevGameId, slug } = waiting;
    this.clearWaitingForTickets(roomCode);

    // Hent variantConfig for å resolve riktig delayMs.
    const variantInfo = this.config.variantLookup.getVariantConfig(roomCode);
    const delayMs = resolveRoundPauseMs(
      variantInfo?.config,
      this.config.delayMs,
    );
    const nextRoundAtMs = Date.now() + delayMs;

    const handle = this.config.setTimeoutFn(() => {
      this.pendingByRoom.delete(roomCode);
      void this.startNextRound(roomCode, prevGameId);
    }, delayMs);
    this.pendingByRoom.set(roomCode, {
      handle,
      gameId: prevGameId,
      nextRoundAtMs,
    });

    logger.info(
      {
        roomCode,
        slug,
        prevGameId,
        delayMs,
        triggerReason,
      },
      "perpetual: scheduled countdown after threshold",
    );

    // Send room:update så klient ser at countdown nå begynner. Best-effort.
    if (this.config.emitRoomUpdate) {
      try {
        await this.config.emitRoomUpdate(roomCode);
      } catch (err) {
        logger.warn(
          { roomCode, err },
          "perpetual: emitRoomUpdate after threshold-met failed (best-effort)",
        );
      }
    }
  }

  /** Rydd waiting-for-tickets-state for et rom (idempotent). */
  private clearWaitingForTickets(roomCode: string): void {
    const waiting = this.waitingForTicketsByRoom.get(roomCode);
    if (!waiting) return;
    clearInterval(waiting.pollHandle);
    clearTimeout(waiting.timeoutHandle);
    this.waitingForTicketsByRoom.delete(roomCode);
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
    // 2026-05-04 (Tobias bug-fix): bruk slug-aware default entry fee.
    // For Spill 2 (rocket) og Spill 3 (monsterbingo) → 10 kr/brett. For
    // andre slugs → eksisterende `defaultEntryFee` (env-driven). Sikrer
    // at prizePool > 0 selv når env-default er 0 (free-play-konfig laget
    // for Spill 1 dev-flow).
    const entryFee = this.resolveEntryFeeForSlug(snapshot.gameSlug);
    // Audit-fix 2026-05-06 (SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05 §2.6):
    // Tidligere brukte vi `snapshot.hostPlayerId` direkte. For perpetual-rom
    // settes hostPlayerId KUN ved `RoomLifecycleService.createRoom` og
    // reassignes ALDRI ved disconnect. Hvis original-host fane-refresher
    // eller drar, ville `snapshot.hostPlayerId` peke på en spiller som
    // ikke lenger er i rommet — og selv om assertHost passerte (slug-bypass
    // / system-actor), ville framtidige call-sites som faktisk bruker
    // host-id (f.eks. wallet-checks i andre flows) feilet med stale id.
    // SYSTEM_ACTOR_ID er semantisk korrekt: perpetual-loop er server-driven,
    // ikke en spiller-handling. assertHost tillater sentinel-en for
    // perpetual-rom (BingoEngine.assertHost). Spill 1 (`bingo`) er ikke
    // berørt — Spill 1 bruker Game1MasterControlService, ikke denne tjenesten.
    const startInput: Parameters<PerpetualEngine["startGame"]>[0] = {
      roomCode,
      actorPlayerId: SYSTEM_ACTOR_ID,
      entryFee,
      ticketsPerPlayer: this.config.defaultTicketsPerPlayer,
      payoutPercent: this.config.defaultPayoutPercent,
      // 2026-05-04 (Tobias-direktiv): carry over armed players fra forrige
      // runde via armedLookup. Spillere som armer via BuyPopup mellom
      // runder skal få tickets ved neste spawn — uten dette ble bonger
      // aldri vist fordi armed-state ble cleared. Fallback til [] hvis
      // armedLookup ikke er satt (legacy / tests).
      armedPlayerIds: this.config.armedLookup?.getArmedPlayerIds(roomCode) ?? [],
      armedPlayerTicketCounts: this.config.armedLookup?.getArmedPlayerTicketCounts(roomCode) ?? {},
      armedPlayerSelections: this.config.armedLookup?.getArmedPlayerSelections(roomCode) ?? {},
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
          actorPlayerId: SYSTEM_ACTOR_ID,
          entryFee,
        },
        "perpetual: auto-restart succeeded",
      );

      if (this.config.emitRoomUpdate) {
        try {
          await this.config.emitRoomUpdate(roomCode);
        } catch (err) {
          // Fase 2A: BIN-RKT-006 — emitRoomUpdate fail. MEDIUM, best-effort.
          // Klient ser ikke ny runde umiddelbart men neste tick eller
          // socket-event vil rette opp i UI; ingen game-state-tap.
          logWarn(
            {
              module: MODULE_NAME,
              errorCode: "BIN-RKT-006",
              roomCode,
              gameId: prevGameId,
            },
            "emitRoomUpdate failed efter auto-restart (best-effort, continuing)",
            err,
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
      // Fase 2A: BIN-RKT-007 — auto-restart fail. HIGH severity for at vi
      // skal måle rate (ofte race-conditions); ikke til Sentry siden de
      // forventede kodene over er normale.
      const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
      logWarn(
        {
          module: MODULE_NAME,
          errorCode: "BIN-RKT-007",
          roomCode,
          gameId: prevGameId,
          domainErrorCode: code,
        },
        "auto-restart failed (best-effort) — perpetual loop pauset til neste join eller manual restart",
        err,
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
    if (!this.config.enabled) {
      // Debug-bug 2026-05-03: tidligere skipset vi stille. Ops kunne ikke
      // se om service var disabled vs. snapshot-fail uten kode-inspeksjon.
      // Bumpet til info så hver join logger faktisk hvorfor spawn skipset.
      logger.info(
        { roomCode, reason: "service_disabled" },
        "perpetual: skip first-round spawn",
      );
      return false;
    }

    let snapshot;
    try {
      snapshot = this.config.engine.getRoomSnapshot(roomCode);
    } catch (err) {
      // Debug-bug 2026-05-03: tidligere debug-only — usynlig i prod der
      // LOG_LEVEL=info er default. Bumpet til info så vi ser at rommet
      // ikke fantes i engine ved spawn-tidspunkt (timing race vs. join).
      logger.info(
        { roomCode, err: err instanceof Error ? { message: err.message, code: (err as Error & { code?: string }).code } : String(err) },
        "perpetual: skip first-round spawn (room not found in engine)",
      );
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
      // Debug-bug 2026-05-03: tidligere debug-only. Bumpet til info så
      // ops kan se at perpetual-restart fra forrige runde fortsatt venter
      // (dette er en gyldig skip-grunn, ikke et problem — men det skal
      // være synlig i logs).
      logger.info(
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
      // Debug-bug 2026-05-03: tidligere debug-only. Bumpet til info så
      // ops ser når noen joiner et rom som allerede har en aktiv runde
      // (forventet ofte, men nyttig for å diagnostisere "henger på status
      // NONE i /api/rooms"-typen feil).
      logger.info(
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

    // Debug-bug 2026-05-03: signal at vi har bestått alle skip-checks og
    // skal kjøre engine.startGame. Hvis denne logges men "spawn succeeded"
    // ikke gjør det, vet ops at startGame kastet (warn-log under).
    logger.info(
      {
        roomCode,
        slug,
        currentStatus: currentStatus ?? "NONE",
        playerCount: snapshot.players.length,
        actorPlayerId: SYSTEM_ACTOR_ID,
      },
      "perpetual: attempting first-round spawn",
    );

    const variantInfo = this.config.variantLookup.getVariantConfig(roomCode);
    // 2026-05-04 (Tobias bug-fix): symmetrisk med startNextRound —
    // slug-aware default entry fee. Spill 2/3 = 10 kr; ukjente slugs
    // bruker env-default.
    const entryFee = this.resolveEntryFeeForSlug(snapshot.gameSlug);
    // Audit-fix 2026-05-06 (audit §2.6): symmetrisk med startNextRound —
    // bruk SYSTEM_ACTOR_ID istedenfor potensielt-stale `hostPlayerId`.
    // First-round-spawn er server-driven (kalles fra room:join-handler
    // etter at en spiller har joined et tomt perpetual-rom).
    const startInput: Parameters<PerpetualEngine["startGame"]>[0] = {
      roomCode,
      actorPlayerId: SYSTEM_ACTOR_ID,
      entryFee,
      ticketsPerPlayer: this.config.defaultTicketsPerPlayer,
      payoutPercent: this.config.defaultPayoutPercent,
      // 2026-05-04 (Tobias-direktiv): symmetrisk med auto-restart —
      // carry over armed players via armedLookup.
      armedPlayerIds: this.config.armedLookup?.getArmedPlayerIds(roomCode) ?? [],
      armedPlayerTicketCounts: this.config.armedLookup?.getArmedPlayerTicketCounts(roomCode) ?? {},
      armedPlayerSelections: this.config.armedLookup?.getArmedPlayerSelections(roomCode) ?? {},
      ...(variantInfo?.gameType ? { gameType: variantInfo.gameType } : {}),
      ...(variantInfo?.config ? { variantConfig: variantInfo.config } : {}),
    };

    try {
      await this.config.engine.startGame(startInput);
      logger.info(
        {
          roomCode,
          slug,
          actorPlayerId: SYSTEM_ACTOR_ID,
          playerCount: snapshot.players.length,
          entryFee,
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
      // / NOT_HOST (host left mens spawn ble forberedt) er forventede
      // skip-conditions. Logger på warn med strukturert err-kode så ops
      // kan filtrere på spesifikke failure-modes uten å parse melding.
      logger.warn(
        {
          roomCode,
          slug,
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
   * Diagnostic-helper (Tobias 2026-05-04): er det en pending auto-restart
   * for et gitt rom? Brukes av `/api/_dev/game2-state` for å la oss se om
   * `handleGameEnded` har planlagt en `engine.startGame`-kall som ikke har
   * fyrt ennå (typisk innen `delayMs`-vinduet).
   *
   * Returnerer false hvis rommet ikke finnes i pending-mapen.
   */
  hasPendingRestart(roomCode: string): boolean {
    return this.pendingByRoom.has(roomCode);
  }

  /**
   * Diagnostic-helper (Tobias 2026-05-04): hent gameId-en som trigget den
   * pending auto-restart-en for et rom (for å verifisere at det er forrige
   * runde sin end som har planlagt restart, ikke en stale entry).
   */
  pendingRestartGameId(roomCode: string): string | null {
    return this.pendingByRoom.get(roomCode)?.gameId ?? null;
  }

  /**
   * 2026-05-04 (Bug 1 fix): hent planlagt fyringspunkt (epoch ms) for
   * pending auto-restart i et rom. Brukes av `buildRoomSchedulerState`
   * (apps/backend/src/util/roomHelpers.ts) til å surface
   * `millisUntilNextStart` i room:update for Spill 2/3, slik at klientens
   * countdown ("Neste trekning: MM:SS") faktisk tikker mellom runder.
   *
   * Returnerer null hvis rommet ikke har en pending restart, eller hvis
   * tidspunktet allerede har passert (fyring skjer i neste tick — UI bør
   * vise "—:—" da, ikke et negativt tall).
   */
  getNextRoundAtMs(roomCode: string): number | null {
    const entry = this.pendingByRoom.get(roomCode);
    if (!entry) return null;
    if (entry.nextRoundAtMs <= Date.now()) return null;
    return entry.nextRoundAtMs;
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
    // Phase 4: rydd også waiting-for-tickets-state.
    for (const { pollHandle, timeoutHandle } of this.waitingForTicketsByRoom.values()) {
      clearInterval(pollHandle);
      clearTimeout(timeoutHandle);
    }
    this.waitingForTicketsByRoom.clear();
  }
}
