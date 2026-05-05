/**
 * Game2AutoDrawTickService — global tick som driver automatisk kule-trekk
 * for alle running Spill 2 (rocket / tallspill / game_2)-rom.
 *
 * Bakgrunn (Tobias-direktiv 2026-05-03):
 *   Spill 2 har ETT globalt rom og perpetual auto-restart via
 *   {@link PerpetualRoundService}. Når en runde starter trenger vi noe som
 *   trekker baller automatisk i fast tempo. Spill 1 har sin egen
 *   {@link Game1AutoDrawTickService} (driven av scheduled_games-DB-rader),
 *   men Spill 2 går via in-memory BingoEngine-rom og hadde INGEN
 *   tilsvarende auto-draw-loop. Resultat: rundene startet, men ingen
 *   baller ble trukket.
 *
 * Algoritme per tick:
 *   1) Enumerer alle rom via `engine.listRoomSummaries()` og filtrer
 *      på Spill 2-slug (`rocket`, `game_2`, `tallspill`).
 *   2) For hvert rom, hent fullt snapshot via `engine.getRoomSnapshot`.
 *   3) Skip om `currentGame?.status !== "RUNNING"` eller
 *      `drawnNumbers.length >= 21` (Spill 2 har maks 21 baller).
 *   4) Throttle: skip om `now - lastDrawAt[roomCode] < drawIntervalMs`.
 *   5) Kall `engine.drawNextNumber({ roomCode, actorPlayerId: hostPlayerId })`.
 *   6) Oppdater `lastDrawAt[roomCode]` til `now`.
 *   7) Tobias-bug-fix 2026-05-04: kall `broadcaster.onDrawCompleted` om
 *      injected — emitterer `draw:new` + engine-effekter + `room:update`
 *      ut til klientene. Uten dette så kun server-state oppdatert tall,
 *      mens spiller-UI sto fast på "Trekk: 00/21" (Playwright bekreftet).
 *      Tidligere kommentar hevdet engine-laget eide emit-en — det stemte
 *      kun for admin-trigget `draw:next`-handler, ikke for cron-stien.
 *
 * Feil-isolasjon:
 *   - `DRAW_TOO_SOON`, `NO_MORE_NUMBERS`, `GAME_PAUSED`, `GAME_NOT_RUNNING`
 *     skal IKKE krasje tick-en. Disse logges på debug-nivå og hoppes over.
 *     Tick fortsetter til neste rom.
 *
 * Slug-filter:
 *   Spill 2 har historisk tre slugs i kodebasen: `rocket` (canonical),
 *   `game_2` (legacy), `tallspill` (markedsføring). Alle tre matches
 *   case-insensitivt for robusthet mot inkonsistent slug-bruk.
 *
 * Referanser:
 *   - apps/backend/src/game/Game1AutoDrawTickService.ts (forelder-mønster)
 *   - apps/backend/src/util/schedulerSetup.ts:onAutoDraw (parallell sti
 *     via DrawScheduler, gated på `runtimeBingoSettings.autoDrawEnabled`)
 *   - apps/backend/src/game/PerpetualRoundService.ts (perpetual restart)
 */

import { DomainError } from "../errors/DomainError.js";
import { logger as rootLogger } from "../util/logger.js";
// Fase 2A (2026-05-05): structured-logger for error-code-tagging. PoC-
// migrasjon — kun error/warn-paths som korresponderer til BIN-RKT-{001..008}.
// Eksisterende info/debug-calls beholdes på rootLogger for å minimere diff.
import { logError, logInfo, logWarn } from "../observability/structuredLogger.js";
import { incrementErrorCounter } from "../observability/errorMetrics.js";
import {
  resolveBallIntervalMs,
  type GameVariantConfig,
} from "./variantConfig.js";
import { SYSTEM_ACTOR_ID } from "./SystemActor.js";

const log = rootLogger.child({ module: "game2-auto-draw-tick" });
const MODULE_NAME = "Game2AutoDrawTickService";

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Slugs som regnes som Spill 2. Match case-insensitivt mot
 * `room.gameSlug`. Holdt eksportert slik at tester og andre moduler kan
 * bruke samme sannhetskilde.
 */
export const GAME2_SLUGS: ReadonlySet<string> = new Set([
  "rocket",
  "game_2",
  "tallspill",
]);

/**
 * Spill 2 har 21 baller maks (1..21). Når `drawnNumbers.length >= 21` skal
 * vi ikke forsøke nye draws — engine ville uansett kastet `NO_MORE_NUMBERS`.
 */
export const GAME2_MAX_BALLS = 21;

/**
 * Minimal engine-flate. Holdt liten for testbarhet — vi trenger ikke full
 * BingoEngine-instans i unit-tester.
 */
export interface AutoDrawEngine {
  listRoomSummaries(): Array<{
    code: string;
    gameSlug?: string;
    gameStatus: string;
  }>;
  getRoomSnapshot(roomCode: string): {
    code: string;
    hostPlayerId: string;
    gameSlug?: string;
    /**
     * Tobias 2026-05-04 (host-fallback fix): tilstede-spillere brukes til å
     * sjekke om `hostPlayerId` fortsatt er i rommet. Hvis original-host har
     * disconnected, faller `tickOnce` tilbake til første tilgjengelige
     * spiller som actor for `drawNextNumber`. Skipper hvis ingen er igjen.
     */
    players?: Array<{ id: string }>;
    currentGame?: {
      status: string;
      drawnNumbers: number[];
    };
  };
  drawNextNumber(input: {
    roomCode: string;
    actorPlayerId: string;
  }): Promise<{ number: number; drawIndex: number; gameId: string }>;
  /**
   * Tobias 2026-05-04: opt-in stuck-room recovery. Når tick-en finner et
   * Spill 2-rom som er status=RUNNING med drawnNumbers.length >= 21 OG
   * `endedReason==null`, betyr det at runden står fast (typisk kjent
   * boot-recovery-pattern eller hook-feil i `onDrawCompleted` på siste
   * draw). Hvis denne metoden er wired, kaller tick-en den i stedet for å
   * bare skippe — samme contract som
   * {@link import("./BingoEngine").BingoEngine.forceEndStaleRound}.
   *
   * Optional for bakoverkompatibilitet: tester og legacy-kallere som ikke
   * har metoden får dagens skip-oppførsel.
   */
  forceEndStaleRound?(roomCode: string, endedReason: string): Promise<boolean>;
}

/**
 * Tobias-bug-fix 2026-05-04: minimal broadcaster-flate som tick-en kaller
 * etter en vellykket `engine.drawNextNumber(...)`. Definert her så testene
 * kan injecte fakes uten å mounte Socket.IO eller `emitRoomUpdate`. Prod-
 * implementasjonen ligger i
 * `apps/backend/src/sockets/game23DrawBroadcasterAdapter.ts` og emitter
 * `draw:new` + engine-effekter + `room:update` ut til klientene.
 *
 * Optional på service-laget: testene som kun verifiserer engine-call-flow
 * trenger ikke broadcaster, og legacy-kallere uten broadcaster fortsetter
 * å fungere uten emits (dvs. dagens default — bug forblir, men endring
 * av eksisterende kode-stier er minimert).
 */
export interface Game2DrawTickBroadcaster {
  onDrawCompleted(input: {
    roomCode: string;
    number: number;
    drawIndex: number;
    gameId: string;
  }): void;
}

/**
 * Tobias 2026-05-04: per-room variant-config-lookup for admin-config-
 * round-pace. Når injected leser tick-en `variantConfig.ballIntervalMs`
 * per rom; ellers brukes service-level `drawIntervalMs` (env-fallback).
 *
 * Optional på service-laget for bakoverkompat med eksisterende tester
 * som ikke wirer roomState.
 */
export interface VariantConfigLookup {
  getVariantConfig(
    roomCode: string,
  ): { gameType?: string; config?: GameVariantConfig } | null;
}

export interface Game2AutoDrawTickServiceOptions {
  engine: AutoDrawEngine;
  /**
   * Minimum millisekunder mellom draws per rom. Default 30000 (30 s),
   * matcher `AUTO_DRAW_INTERVAL_MS=30000` i prod-konfigurasjonen.
   *
   * Engine-laget håndhever sin egen `minDrawIntervalMs` (MEDIUM-1/BIN-253);
   * verdien her skal være ≥ engine sin throttle for å unngå støy fra
   * `DRAW_TOO_SOON`.
   *
   * Tobias 2026-05-04: brukes som env-fallback når
   * `variantConfig.ballIntervalMs` ikke er satt for et rom (admin-konfig
   * fra DB tar presedens — se {@link VariantConfigLookup}).
   */
  drawIntervalMs?: number;
  /**
   * Tobias 2026-05-04: per-room variant-config-lookup. Brukes til å
   * resolve admin-konfigurert `ballIntervalMs` per rom. Når null faller
   * tick-en tilbake til `drawIntervalMs` for alle rom (legacy-oppførsel).
   */
  variantLookup?: VariantConfigLookup;
  /**
   * Tobias 2026-05-04: callback som fyres etter at tick-en har force-endet
   * et stuck-rom (drawnNumbers >= 21 men status fortsatt RUNNING +
   * endedReason null). Caller kan bruke dette til å trigge
   * `PerpetualRoundService.spawnFirstRoundIfNeeded(roomCode)` så ny runde
   * spawnes umiddelbart i stedet for å vente på neste player-join.
   *
   * Optional + fail-soft — feil i callbacken logges men avbryter ikke
   * tick-en for andre rom.
   */
  onStaleRoomEnded?: (roomCode: string) => Promise<void> | void;
  /**
   * Tobias-bug-fix 2026-05-04: broadcaster som emitterer `draw:new` +
   * engine-effekter + `room:update` etter hvert vellykket draw. Når null
   * forblir tick-en helt server-side (legacy-oppførsel, kun for tester
   * uten socket-binding). Når injected — som i prod via
   * `index.ts` — får klientene full wire-kontrakt.
   */
  broadcaster?: Game2DrawTickBroadcaster;
  /**
   * Tobias-direktiv 2026-05-04 (room-uniqueness invariant): valgfri callback
   * som kjøres hver N-te tick (default 10) for å validere at det fortsatt
   * kun finnes ÉTT rocket-rom globalt. Brukes av
   * {@link RoomUniquenessInvariantService} til å oppdage duplikater som
   * eventuelt har sneket seg inn etter boot.
   *
   * Tick-en ignorerer return-verdi og swallow-er feil — invariant-sjekken
   * må aldri stoppe draw-loopen.
   *
   * Optional + fail-soft.
   */
  onPeriodicValidation?: () => Promise<void> | void;
  /**
   * Hvor ofte (antall ticks) `onPeriodicValidation` skal trigges. Default 10.
   */
  periodicValidationEvery?: number;
}

export interface Game2AutoDrawTickResult {
  /** Antall Spill 2-rom undersøkt. */
  checked: number;
  /** Antall rom hvor `drawNextNumber` ble trigget. */
  drawsTriggered: number;
  /** Antall rom hoppet over (ikke RUNNING, max baller, eller throttled). */
  skipped: number;
  /** Antall rom hvor drawNextNumber kastet en feil (logget, ikke fatal). */
  errors: number;
  /** Per-rom feilmelding for debug (opptil 10 første). */
  errorMessages?: string[];
  /**
   * Tobias 2026-05-04: rom som ble force-endet i denne ticken etter at de
   * havnet i stuck-state (drawn=21, status=RUNNING, endedReason=null).
   * Tom array når ingen rom var stuck.
   */
  staleRoomsEnded?: string[];
  /** Wall-clock når ticken kjørte ferdig (ms epoch). For diagnose-route. */
  completedAtMs?: number;
}

// ── Service ─────────────────────────────────────────────────────────────────

export class Game2AutoDrawTickService {
  private readonly engine: AutoDrawEngine;
  private readonly drawIntervalMs: number;
  private readonly onStaleRoomEnded?: (roomCode: string) => Promise<void> | void;
  private readonly broadcaster?: Game2DrawTickBroadcaster;
  private readonly variantLookup?: VariantConfigLookup;
  private readonly onPeriodicValidation?: () => Promise<void> | void;
  private readonly periodicValidationEvery: number;
  private tickCounter = 0;

  /**
   * In-memory throttle per rom. Setter siste-draw-timestamp etter hver
   * vellykket `drawNextNumber`. Brukes for å unngå at vi kaller engine
   * oftere enn `drawIntervalMs` — engine kaster `DRAW_TOO_SOON` ellers,
   * og det vil spamme ops-logger ved kort tick-intervall.
   */
  private readonly lastDrawAtByRoom = new Map<string, number>();

  /**
   * In-process mutex per roomCode. Hindrer at to overlappende tick-promises
   * begge plukker opp samme rom og kaller `drawNextNumber` parallelt.
   * Engine-laget har sin egen mutex per rom, men vi vil unngå at den
   * andre ticken havner i `DRAW_TOO_SOON`-feil.
   */
  private readonly currentlyProcessing = new Set<string>();

  /**
   * Tobias 2026-05-04: siste tick-resultat lagres for diagnose-routen
   * `/api/_dev/game2-state`. Null inntil første tick har kjørt.
   * Overskrives ved hver tick — vi vil bare ha siste run for debug.
   */
  private lastTickResult: Game2AutoDrawTickResult | null = null;

  constructor(options: Game2AutoDrawTickServiceOptions) {
    this.engine = options.engine;
    this.onStaleRoomEnded = options.onStaleRoomEnded;
    this.broadcaster = options.broadcaster;
    this.variantLookup = options.variantLookup;
    this.onPeriodicValidation = options.onPeriodicValidation;
    const validateEvery = options.periodicValidationEvery;
    this.periodicValidationEvery =
      typeof validateEvery === "number" &&
      Number.isFinite(validateEvery) &&
      validateEvery > 0
        ? Math.floor(validateEvery)
        : 10;
    const interval = options.drawIntervalMs;
    // 0 er gyldig (= "ingen throttle" — engine-laget håndhever sin egen
    // minDrawIntervalMs). Negativ/NaN/undefined → default 30 000 ms.
    this.drawIntervalMs =
      typeof interval === "number" && Number.isFinite(interval) && interval >= 0
        ? Math.floor(interval)
        : 30_000;
  }

  /**
   * Tobias 2026-05-04: resolve effektivt draw-interval per rom. Per-game
   * `variantConfig.ballIntervalMs` (admin-konfig) tar presedens over
   * service-level `drawIntervalMs` (env-fallback).
   *
   * Returnerer service-default når variantLookup ikke er injected — slik
   * at tester uten roomState fortsatt fungerer som før.
   */
  private resolveDrawIntervalMs(roomCode: string): number {
    if (!this.variantLookup) return this.drawIntervalMs;
    const variantInfo = this.variantLookup.getVariantConfig(roomCode);
    return resolveBallIntervalMs(variantInfo?.config, this.drawIntervalMs);
  }

  /**
   * Tobias 2026-05-04: hent siste tick-resultat for diagnose-routen
   * `/api/_dev/game2-state`. Returnerer null hvis ticken aldri har kjørt
   * (f.eks. boot uten cron-trigger ennå).
   */
  getLastTickResult(): Game2AutoDrawTickResult | null {
    return this.lastTickResult;
  }

  /**
   * Kjør én tick. Trigger `drawNextNumber` for hvert running Spill 2-rom
   * hvor throttle er passert.
   */
  async tick(): Promise<Game2AutoDrawTickResult> {
    const summaries = this.engine.listRoomSummaries();
    const now = Date.now();
    let checked = 0;
    let drawsTriggered = 0;
    let skipped = 0;
    let errors = 0;
    const errorMessages: string[] = [];
    const staleRoomsEnded: string[] = [];

    for (const summary of summaries) {
      // Slug-filter: kun Spill 2-rom.
      const slug = (summary.gameSlug ?? "").toLowerCase();
      if (!GAME2_SLUGS.has(slug)) continue;

      // Status-filter: kun RUNNING (engine sin gameStatus enum: "WAITING" |
      // "RUNNING" | "ENDED" | "NONE"). Vi skipper "NONE"/WAITING/ENDED.
      if (summary.gameStatus !== "RUNNING") continue;

      checked++;

      // In-process mutex.
      if (this.currentlyProcessing.has(summary.code)) {
        skipped++;
        continue;
      }

      // Throttle. Tobias 2026-05-04: per-game-konfigurerbar via
      // `variantConfig.ballIntervalMs` (admin-konfig). Faller tilbake
      // til service-level `drawIntervalMs` (env-default) når ikke satt.
      const effectiveIntervalMs = this.resolveDrawIntervalMs(summary.code);
      const lastDrawAt = this.lastDrawAtByRoom.get(summary.code) ?? 0;
      if (now - lastDrawAt < effectiveIntervalMs) {
        skipped++;
        continue;
      }

      // Hent fullt snapshot for å sjekke drawnNumbers + hostPlayerId.
      let snapshot: ReturnType<AutoDrawEngine["getRoomSnapshot"]>;
      try {
        snapshot = this.engine.getRoomSnapshot(summary.code);
      } catch (err) {
        errors++;
        const msg = `${summary.code}: getRoomSnapshot failed: ${(err as Error).message ?? "unknown"}`;
        if (errorMessages.length < 10) errorMessages.push(msg);
        // Fase 2A: BIN-RKT-003 (race-condition — room destroyed mid-tick).
        // Forventet sjelden race med room:leave-handler; logges som warn
        // med structured metadata så ops kan måle rate.
        logWarn(
          {
            module: MODULE_NAME,
            errorCode: "BIN-RKT-003",
            roomCode: summary.code,
            gameSlug: slug,
          },
          "getRoomSnapshot failed mid-tick — rom destroyed mellom listRoomSummaries og snapshot",
          err,
        );
        continue;
      }

      const game = snapshot.currentGame;
      if (!game || game.status !== "RUNNING") {
        skipped++;
        continue;
      }
      if (game.drawnNumbers.length >= GAME2_MAX_BALLS) {
        // Tobias 2026-05-04 (root-cause-fix): rom som er status=RUNNING men
        // har trukket alle 21 baller er STUCK. Dette skjer når
        // `Game2Engine.onDrawCompleted` ikke fikk satt status=ENDED på
        // siste draw — typisk av to grunner:
        //   1) Hook-feil i `onDrawCompleted` (f.eks. wallet-shortage på
        //      sist-draw payout) ble fanget av `handleHookError` etter at
        //      draw-bagen var tom, slik at status aldri ble mutert.
        //   2) Process-restart etter at draw-bagen ble tømt men før
        //      checkpoint-en ble persistert.
        //
        // Tidligere kode skippet bare slike rom — det blokkerte
        // perpetual-loopen for alltid (PerpetualRoundService.handleGameEnded
        // fyres kun når `endedReason` settes). Nå force-ender vi runden via
        // engine-callback og lar `onStaleRoomEnded` trigge en ny runde.
        //
        // Bevarer dagens `skipped++` for konsistens med tidligere
        // observability — men i tillegg flagges rommet i staleRoomsEnded
        // og logges på warn så ops ser at recovery skjedde.
        skipped++;

        if (typeof this.engine.forceEndStaleRound === "function") {
          try {
            const ended = await this.engine.forceEndStaleRound(
              summary.code,
              "STUCK_AT_MAX_BALLS_AUTO_RECOVERY"
            );
            if (ended) {
              staleRoomsEnded.push(summary.code);
              // Fase 2A: BIN-RKT-004 — stuck-room recovery. HIGH severity
              // fordi det indikerer en bug i `onDrawCompleted` eller
              // checkpoint-persistens; vi vil måle rate så vi kan fixe
              // root-cause.
              logWarn(
                {
                  module: MODULE_NAME,
                  errorCode: "BIN-RKT-004",
                  roomCode: summary.code,
                  drawnCount: game.drawnNumbers.length,
                },
                "auto-recovered stuck room (drawn=21, status=RUNNING, endedReason=null)",
              );

              if (this.onStaleRoomEnded) {
                try {
                  await this.onStaleRoomEnded(summary.code);
                } catch (cbErr) {
                  // Fase 2A: BIN-RKT-008 — onStaleRoomEnded callback feil.
                  // MEDIUM severity, ikke-fatal for tick-en. Caller-en eier
                  // fail-soft contract; vi logger og fortsetter.
                  logWarn(
                    {
                      module: MODULE_NAME,
                      errorCode: "BIN-RKT-008",
                      roomCode: summary.code,
                    },
                    "onStaleRoomEnded callback failed — recovery completed but follow-up callback threw",
                    cbErr,
                  );
                }
              }
            }
          } catch (err) {
            errors++;
            const msg = `${summary.code}: forceEndStaleRound failed: ${(err as Error).message ?? "unknown"}`;
            if (errorMessages.length < 10) errorMessages.push(msg);
            // forceEndStaleRound feil er HIGH — vi har en stuck room som
            // forblir stuck. Bruk BIN-RKT-002 (engine-error) for å løfte
            // til Sentry siden ikke-fail betyr at perpetual-loop sitter
            // fast permanent.
            logError(
              {
                module: MODULE_NAME,
                errorCode: "BIN-RKT-002",
                roomCode: summary.code,
              },
              "forceEndStaleRound threw — stuck room kan ikke recovery-es",
              err,
            );
          }
        } else {
          // Engine støtter ikke recovery (typisk i tester med fake-engine).
          // Skip stille — same som tidligere oppførsel.
        }
        continue;
      }

      // Audit-fix 2026-05-06 (SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05 §2.6):
      // Bruker SYSTEM_ACTOR_ID istedenfor hostPlayerId-fallback til player[0].
      // Auto-draw-tick er server-driven — det er IKKE en spiller-handling.
      // assertHost (BingoEngine) tillater sentinel-en for perpetual-rom, og
      // _drawNextLocked (DrawOrchestrationService) skipper requirePlayer +
      // wallet-check når actor er system og rommet er perpetual.
      //
      // Tidligere (PR #911 host-fallback): `snapshot.hostPlayerId` settes kun
      // ved `RoomLifecycleService.createRoom` og reassignes ALDRI når
      // original-host disconnecter (fane-refresh, Wi-Fi-blip). Auto-draw-cron
      // feilet 100% med "Spiller finnes ikke i rommet." og rommet ble
      // permanent stuck til manuelt force-end. Vi løste det først med
      // players[0]?.id-fallback (PR #911), men system-actor er semantisk mer
      // korrekt + dekker kanttilfellet hvor rommet var helt tomt.
      //
      // Skip-conditions hvis rommet er tomt: vi trekker fortsatt ikke baller,
      // men det blir nå håndhevet av engine-internal sjekker og vi unngår
      // null-kontroll i denne handler-en.
      const players = snapshot.players ?? [];
      if (players.length === 0) {
        // Helt tomt rom: ingen mottakere for `draw:new`-event uansett. Skip
        // synlig så ops kan se "tom rom"-pattern i logs (info, ikke debug).
        log.info(
          {
            event: "auto_draw_skip_empty_room",
            roomCode: summary.code,
            slug: snapshot.gameSlug,
          },
          "[game2-auto-draw] skip — empty room (no players to receive draw)",
        );
        skipped++;
        continue;
      }
      // Fase 2A observability: logg når original host ikke er i players-
      // listen så vi kan se host-disconnect-rate i metrics (BIN-RKT-001).
      // System-actor brukes uansett — system-actor er semantisk korrekt
      // og dekker kanttilfellet hvor rommet er helt tomt.
      const hostStillPresent =
        snapshot.hostPlayerId != null &&
        players.some((p) => p.id === snapshot.hostPlayerId);
      if (snapshot.hostPlayerId != null && !hostStillPresent) {
        logInfo(
          {
            module: MODULE_NAME,
            errorCode: "BIN-RKT-001",
            roomCode: summary.code,
            hostPlayerId: snapshot.hostPlayerId,
            event: "auto_draw_host_fallback",
            oldHostId: snapshot.hostPlayerId,
            newHostId: SYSTEM_ACTOR_ID,
            reason: "host_disconnected_using_system_actor",
          },
          "host fallback — using system-actor since original host not in players list",
        );
      }
      const actorId: string = SYSTEM_ACTOR_ID;

      this.currentlyProcessing.add(summary.code);
      try {
        const result = await this.engine.drawNextNumber({
          roomCode: summary.code,
          actorPlayerId: actorId,
        });
        this.lastDrawAtByRoom.set(summary.code, Date.now());
        drawsTriggered++;

        // Tobias-bug-fix 2026-05-04: broadcaster sender ut `draw:new` +
        // G2 engine-effekter + `room:update` slik at klientene rendrer
        // den nye ballen. Uten denne sto UI på "Trekk: 00/21" mens
        // server-state korrekt ble oppdatert (Playwright bekreftet).
        // Side-effekter i `Game2Engine.onDrawCompleted` (autoMarkPlayerCells)
        // har allerede kjørt før vi når hit, så snapshot-en
        // `emitRoomUpdate` bygger inneholder oppdaterte marks.
        //
        // Fail-soft: broadcaster-en sluker egne feil — vi trenger ikke
        // ekstra try/catch her. Kall plassert FØR `lastDrawAtByRoom`-
        // bookkeeping er allerede gjort, slik at en eventuell langsom
        // emit ikke endrer throttle-vinduet.
        try {
          this.broadcaster?.onDrawCompleted({
            roomCode: summary.code,
            number: result.number,
            drawIndex: result.drawIndex,
            gameId: result.gameId,
          });
        } catch (broadcastErr) {
          // Fase 2A: BIN-RKT-005 — broadcaster threw. HIGH severity fordi
          // klient-UI er nå out-of-sync med server-state (bekreftet via
          // Playwright). Sendes til Sentry så ops får alert.
          logError(
            {
              module: MODULE_NAME,
              errorCode: "BIN-RKT-005",
              roomCode: summary.code,
              gameId: result.gameId,
              drawIndex: result.drawIndex,
            },
            "broadcaster.onDrawCompleted threw — server-state oppdatert men klient-UI kan være stale",
            broadcastErr,
          );
        }

        log.info(
          {
            roomCode: summary.code,
            gameId: result.gameId,
            drawIndex: result.drawIndex,
            number: result.number,
          },
          "[game2-auto-draw] drew ball"
        );
      } catch (err) {
        // Forventede engine-feil ved race-conditions skal ikke spamme
        // ops-logg på warn-nivå. Vi telles dem som "skipped" snarere enn
        // "error" siden det IKKE er en faktisk feil — bare en race.
        const code = err instanceof DomainError ? err.code : null;
        if (
          code === "DRAW_TOO_SOON" ||
          code === "NO_MORE_NUMBERS" ||
          code === "GAME_PAUSED" ||
          code === "GAME_NOT_RUNNING" ||
          code === "GAME_ENDED"
        ) {
          skipped++;
          // Oppdater throttle ved DRAW_TOO_SOON så vi ikke retry-er
          // umiddelbart; engine-side throttle er sannhetskilden.
          if (code === "DRAW_TOO_SOON") {
            this.lastDrawAtByRoom.set(summary.code, Date.now());
          }
          // Fase 2A: tell forventede race-condition events i counter slik
          // at dashboards kan vise rate-trender uten å spamme log på warn.
          // BIN-DRW-001 (DRAW_TOO_SOON), BIN-DRW-002 (NO_MORE_NUMBERS),
          // BIN-DRW-003 (GAME_NOT_RUNNING/PAUSED/ENDED). Bruk increment
          // direkte (ikke logDebug) fordi vi vil at debug-level kan styres
          // separat via LOG_LEVEL uten å miste counter-tall.
          if (code === "DRAW_TOO_SOON") {
            incrementErrorCounter("BIN-DRW-001");
          } else if (code === "NO_MORE_NUMBERS") {
            incrementErrorCounter("BIN-DRW-002");
          } else {
            incrementErrorCounter("BIN-DRW-003");
          }
          log.debug(
            { roomCode: summary.code, code },
            "[game2-auto-draw] expected race — skipping"
          );
        } else {
          errors++;
          const msg = `${summary.code}: ${(err as Error).message ?? "unknown"}`;
          if (errorMessages.length < 10) errorMessages.push(msg);
          // Fase 2A: BIN-RKT-002 — uventet engine-feil. HIGH severity, sendes
          // til Sentry for å trigge alert. Inkluderer drawIndex og host-info
          // i context så ops kan reproduce.
          logError(
            {
              module: MODULE_NAME,
              errorCode: "BIN-RKT-002",
              roomCode: summary.code,
              drawIndex: snapshot.currentGame?.drawnNumbers.length,
              hostPlayerId: actorId,
            },
            "drawNextNumber failed — uventet engine-error",
            err,
          );
        }
      } finally {
        this.currentlyProcessing.delete(summary.code);
      }
    }

    log.debug(
      { checked, drawsTriggered, skipped, errors, staleRoomsEnded: staleRoomsEnded.length },
      "[game2-auto-draw] tick completed"
    );

    // Tobias-direktiv 2026-05-04 (room-uniqueness invariant): periodisk
    // sanity-check at det fortsatt er ETT globalt rocket-rom. Trigges hver
    // `periodicValidationEvery`-te tick (default 10) for å holde overhead
    // lav. Fail-soft: feil i validering må ALDRI ta ned draw-loopen.
    this.tickCounter += 1;
    if (
      this.onPeriodicValidation !== undefined &&
      this.tickCounter % this.periodicValidationEvery === 0
    ) {
      try {
        await this.onPeriodicValidation();
      } catch (err) {
        log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "[game2-auto-draw] periodic invariant validation threw — swallowed"
        );
      }
    }

    const result: Game2AutoDrawTickResult = {
      checked,
      drawsTriggered,
      skipped,
      errors,
      errorMessages: errorMessages.length > 0 ? errorMessages : undefined,
      staleRoomsEnded: staleRoomsEnded.length > 0 ? staleRoomsEnded : undefined,
      completedAtMs: Date.now(),
    };
    this.lastTickResult = result;
    return result;
  }
}
