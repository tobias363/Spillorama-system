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

const log = rootLogger.child({ module: "game2-auto-draw-tick" });

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

export interface Game2AutoDrawTickServiceOptions {
  engine: AutoDrawEngine;
  /**
   * Minimum millisekunder mellom draws per rom. Default 30000 (30 s),
   * matcher `AUTO_DRAW_INTERVAL_MS=30000` i prod-konfigurasjonen.
   *
   * Engine-laget håndhever sin egen `minDrawIntervalMs` (MEDIUM-1/BIN-253);
   * verdien her skal være ≥ engine sin throttle for å unngå støy fra
   * `DRAW_TOO_SOON`.
   */
  drawIntervalMs?: number;
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
    const interval = options.drawIntervalMs;
    // 0 er gyldig (= "ingen throttle" — engine-laget håndhever sin egen
    // minDrawIntervalMs). Negativ/NaN/undefined → default 30 000 ms.
    this.drawIntervalMs =
      typeof interval === "number" && Number.isFinite(interval) && interval >= 0
        ? Math.floor(interval)
        : 30_000;
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

      // Throttle.
      const lastDrawAt = this.lastDrawAtByRoom.get(summary.code) ?? 0;
      if (now - lastDrawAt < this.drawIntervalMs) {
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
        log.warn(
          { err, roomCode: summary.code },
          "[game2-auto-draw] getRoomSnapshot failed"
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
              log.warn(
                {
                  roomCode: summary.code,
                  drawnCount: game.drawnNumbers.length,
                },
                "[game2-auto-draw] auto-recovered stuck room (drawn=21, status=RUNNING, endedReason=null)"
              );

              if (this.onStaleRoomEnded) {
                try {
                  await this.onStaleRoomEnded(summary.code);
                } catch (cbErr) {
                  log.warn(
                    { err: cbErr, roomCode: summary.code },
                    "[game2-auto-draw] onStaleRoomEnded callback failed"
                  );
                }
              }
            }
          } catch (err) {
            errors++;
            const msg = `${summary.code}: forceEndStaleRound failed: ${(err as Error).message ?? "unknown"}`;
            if (errorMessages.length < 10) errorMessages.push(msg);
            log.warn(
              { err, roomCode: summary.code },
              "[game2-auto-draw] forceEndStaleRound failed"
            );
          }
        } else {
          // Engine støtter ikke recovery (typisk i tester med fake-engine).
          // Skip stille — same som tidligere oppførsel.
        }
        continue;
      }

      this.currentlyProcessing.add(summary.code);
      try {
        const result = await this.engine.drawNextNumber({
          roomCode: summary.code,
          actorPlayerId: snapshot.hostPlayerId,
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
          log.warn(
            { err: broadcastErr, roomCode: summary.code },
            "[game2-auto-draw] broadcaster.onDrawCompleted threw — fortsetter likevel"
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
          log.debug(
            { roomCode: summary.code, code },
            "[game2-auto-draw] expected race — skipping"
          );
        } else {
          errors++;
          const msg = `${summary.code}: ${(err as Error).message ?? "unknown"}`;
          if (errorMessages.length < 10) errorMessages.push(msg);
          log.warn(
            { err, roomCode: summary.code },
            "[game2-auto-draw] drawNextNumber failed"
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
