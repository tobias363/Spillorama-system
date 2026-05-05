/**
 * Game3AutoDrawTickService — global tick som driver automatisk kule-trekk
 * for alle running Spill 3 (monsterbingo / mønsterbingo / game_3)-rom.
 *
 * Bakgrunn (Tobias-direktiv 2026-05-03 + revert PR #860):
 *   Spill 3 (monsterbingo) er 5×5 mønsterbingo med 75 baller, ÉN ticket-
 *   type ("Standard"), patterns Row 1-4 (10% hver, ball-thresholds
 *   15/25/40/55) + Coverall (60%). Perpetual-loop via
 *   {@link PerpetualRoundService} — runden starter automatisk etter
 *   utbetaling, men ingen baller ble trukket fordi ingen cron driver
 *   `drawNextNumber` for monsterbingo.
 *
 * Algoritme: identisk med {@link Game2AutoDrawTickService}, men med
 *   - Slug-filter `monsterbingo` / `mønsterbingo` / `game_3`.
 *   - Maks-baller 75 (Spill 3 har 75 baller, vs Spill 2 sine 21).
 *
 * Engine-laget: Spill 3 bruker `Game3Engine` som er subklasse av
 * `BingoEngine` med samme `drawNextNumber`-signatur. Vi går via samme
 * engine-port her uten å bryte oppstrøms-API.
 *
 * Referanser:
 *   - apps/backend/src/game/Game3Engine.ts (subklasse av BingoEngine)
 *   - apps/backend/src/game/Game2AutoDrawTickService.ts (søsken-mønster)
 *   - docs/architecture/SPILLKATALOG.md §1 (Spill 3-spec etter revert
 *     2026-05-03: 5×5, 75 baller, 1 ticket-type, Row 1-4 + Coverall)
 */

import { DomainError } from "../errors/DomainError.js";
import { logger as rootLogger } from "../util/logger.js";
import type {
  AutoDrawEngine,
  Game2DrawTickBroadcaster,
  VariantConfigLookup,
} from "./Game2AutoDrawTickService.js";
import { resolveBallIntervalMs } from "./variantConfig.js";
import { SYSTEM_ACTOR_ID } from "./SystemActor.js";

/**
 * Re-eksport av broadcaster-flaten under Game3-spesifikt navn for
 * lese-vennlighet i index.ts. Strukturelt identisk med
 * {@link Game2DrawTickBroadcaster} — samme `onDrawCompleted`-signatur,
 * og samme adapter ({@link createGame23DrawBroadcaster}) brukes for
 * begge. Egen alias gjør call-site-koden symmetrisk:
 *   `new Game3AutoDrawTickService({ broadcaster, ... })`.
 */
export type Game3DrawTickBroadcaster = Game2DrawTickBroadcaster;

const log = rootLogger.child({ module: "game3-auto-draw-tick" });

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Slugs som regnes som Spill 3. Match case-insensitivt mot
 * `room.gameSlug`. `mønsterbingo` (norsk ø) inkludert eksplisitt fordi
 * markedsføring/admin-UI har brukt begge skrivemåter.
 */
export const GAME3_SLUGS: ReadonlySet<string> = new Set([
  "monsterbingo",
  "mønsterbingo",
  "game_3",
]);

/**
 * Spill 3 har 75 baller maks (1..75). Når `drawnNumbers.length >= 75` skal
 * vi ikke forsøke nye draws.
 */
export const GAME3_MAX_BALLS = 75;

export interface Game3AutoDrawTickServiceOptions {
  engine: AutoDrawEngine;
  /**
   * Minimum millisekunder mellom draws per rom. Default 30000 (30 s).
   * Engine-laget håndhever sin egen `minDrawIntervalMs`; verdien her
   * skal være ≥ engine sin throttle.
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
   * Tobias-bug-fix 2026-05-04: broadcaster som emitterer `draw:new` +
   * G3 engine-effekter + `room:update` etter hvert vellykket draw. Når
   * null forblir tick-en helt server-side (legacy-oppførsel for tester).
   * Når injected — som i prod via `index.ts` — får klientene full
   * wire-kontrakt og UI rendrer de nye ballene som forventet.
   */
  broadcaster?: Game3DrawTickBroadcaster;
  /**
   * 2026-05-06 (audit §5.1): callback som fyres etter at tick-en har
   * force-endet et stuck-rom (drawnNumbers >= 75 men status fortsatt
   * RUNNING + endedReason null). Caller kan bruke dette til å trigge
   * `PerpetualRoundService.spawnFirstRoundIfNeeded(roomCode)` så ny runde
   * spawnes umiddelbart i stedet for å vente på neste player-join.
   *
   * Speiler {@link Game2AutoDrawTickServiceOptions.onStaleRoomEnded}.
   * MONSTERBINGO henger permanent uten denne hvis hook-en feiler på
   * siste ball (75) — Spill 3-versjonen av samme bug Game2 fikset i
   * PR #876.
   *
   * Optional + fail-soft — feil i callbacken logges men avbryter ikke
   * tick-en for andre rom.
   */
  onStaleRoomEnded?: (roomCode: string) => Promise<void> | void;
  /**
   * Tobias-direktiv 2026-05-04 (room-uniqueness invariant): valgfri callback
   * som kjøres hver N-te tick (default 10) for å validere at det fortsatt
   * kun finnes ÉTT monsterbingo-rom globalt. Brukes av
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

export interface Game3AutoDrawTickResult {
  checked: number;
  drawsTriggered: number;
  skipped: number;
  errors: number;
  errorMessages?: string[];
  /**
   * 2026-05-06 (audit §5.1): rom som ble force-endet i denne ticken etter
   * at de havnet i stuck-state (drawn=75, status=RUNNING, endedReason=null).
   * Tom array når ingen rom var stuck. Speiler
   * {@link Game2AutoDrawTickResult.staleRoomsEnded}.
   */
  staleRoomsEnded?: string[];
}

// ── Service ─────────────────────────────────────────────────────────────────

export class Game3AutoDrawTickService {
  private readonly engine: AutoDrawEngine;
  private readonly drawIntervalMs: number;
  private readonly broadcaster?: Game3DrawTickBroadcaster;
  private readonly variantLookup?: VariantConfigLookup;
  private readonly onStaleRoomEnded?: (roomCode: string) => Promise<void> | void;
  private readonly onPeriodicValidation?: () => Promise<void> | void;
  private readonly periodicValidationEvery: number;
  private tickCounter = 0;

  private readonly lastDrawAtByRoom = new Map<string, number>();
  private readonly currentlyProcessing = new Set<string>();

  constructor(options: Game3AutoDrawTickServiceOptions) {
    this.engine = options.engine;
    this.broadcaster = options.broadcaster;
    this.variantLookup = options.variantLookup;
    this.onStaleRoomEnded = options.onStaleRoomEnded;
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
   * Tobias 2026-05-04: resolve effektivt draw-interval per rom. Identisk
   * semantikk som {@link Game2AutoDrawTickService.resolveDrawIntervalMs}.
   */
  private resolveDrawIntervalMs(roomCode: string): number {
    if (!this.variantLookup) return this.drawIntervalMs;
    const variantInfo = this.variantLookup.getVariantConfig(roomCode);
    return resolveBallIntervalMs(variantInfo?.config, this.drawIntervalMs);
  }

  async tick(): Promise<Game3AutoDrawTickResult> {
    const summaries = this.engine.listRoomSummaries();
    const now = Date.now();
    let checked = 0;
    let drawsTriggered = 0;
    let skipped = 0;
    let errors = 0;
    const errorMessages: string[] = [];
    const staleRoomsEnded: string[] = [];

    for (const summary of summaries) {
      const slug = (summary.gameSlug ?? "").toLowerCase();
      if (!GAME3_SLUGS.has(slug)) continue;
      if (summary.gameStatus !== "RUNNING") continue;

      checked++;

      if (this.currentlyProcessing.has(summary.code)) {
        skipped++;
        continue;
      }

      // Tobias 2026-05-04: per-game-konfigurerbar via
      // `variantConfig.ballIntervalMs` (admin-konfig). Faller tilbake
      // til service-level `drawIntervalMs` (env-default) når ikke satt.
      const effectiveIntervalMs = this.resolveDrawIntervalMs(summary.code);
      const lastDrawAt = this.lastDrawAtByRoom.get(summary.code) ?? 0;
      if (now - lastDrawAt < effectiveIntervalMs) {
        skipped++;
        continue;
      }

      let snapshot: ReturnType<AutoDrawEngine["getRoomSnapshot"]>;
      try {
        snapshot = this.engine.getRoomSnapshot(summary.code);
      } catch (err) {
        errors++;
        const msg = `${summary.code}: getRoomSnapshot failed: ${(err as Error).message ?? "unknown"}`;
        if (errorMessages.length < 10) errorMessages.push(msg);
        log.warn(
          { err, roomCode: summary.code },
          "[game3-auto-draw] getRoomSnapshot failed"
        );
        continue;
      }

      const game = snapshot.currentGame;
      if (!game || game.status !== "RUNNING") {
        skipped++;
        continue;
      }
      if (game.drawnNumbers.length >= GAME3_MAX_BALLS) {
        // 2026-05-06 (audit §5.1): rom som er status=RUNNING men har
        // trukket alle 75 baller er STUCK. Dette skjer når
        // `Game3Engine.onDrawCompleted` ikke fikk satt status=ENDED på
        // siste draw — typisk av to grunner:
        //   1) Hook-feil i `onDrawCompleted` (f.eks. wallet-shortage på
        //      sist-draw payout) ble fanget av `handleHookError` etter at
        //      draw-bagen var tom, slik at status aldri ble mutert.
        //   2) Process-restart etter at draw-bagen ble tømt men før
        //      checkpoint-en ble persistert.
        //
        // Pre-fix (Spill 2 fikset i PR #876, men Spill 3 fikk det aldri)
        // skippet bare slike rom — det blokkerte perpetual-loopen for
        // alltid (PerpetualRoundService.handleGameEnded fyres kun når
        // `endedReason` settes). Nå force-ender vi runden via engine-
        // callback og lar `onStaleRoomEnded` trigge en ny runde.
        //
        // Bevarer dagens `skipped++` for konsistens med tidligere
        // observability — men i tillegg flagges rommet i staleRoomsEnded
        // og logges på warn så ops ser at recovery skjedde.
        skipped++;

        if (typeof this.engine.forceEndStaleRound === "function") {
          try {
            const ended = await this.engine.forceEndStaleRound(
              summary.code,
              "STUCK_AT_MAX_BALLS_AUTO_RECOVERY",
            );
            if (ended) {
              staleRoomsEnded.push(summary.code);
              log.warn(
                {
                  roomCode: summary.code,
                  drawnCount: game.drawnNumbers.length,
                },
                "[game3-auto-draw] auto-recovered stuck room (drawn=75, status=RUNNING, endedReason=null)",
              );

              if (this.onStaleRoomEnded) {
                try {
                  await this.onStaleRoomEnded(summary.code);
                } catch (cbErr) {
                  log.warn(
                    { err: cbErr, roomCode: summary.code },
                    "[game3-auto-draw] onStaleRoomEnded callback failed",
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
              "[game3-auto-draw] forceEndStaleRound failed",
            );
          }
        }
        // Engine støtter ikke recovery (typisk i tester med fake-engine):
        // skip stille — same som tidligere oppførsel.
        continue;
      }

      // Audit-fix 2026-05-06 (SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05 §2.6):
      // Bruker SYSTEM_ACTOR_ID istedenfor hostPlayerId-fallback til player[0].
      // Auto-draw-tick er server-driven — det er IKKE en spiller-handling.
      // Identisk pattern som Game2AutoDrawTickService.
      //
      // Tidligere (PR #911 host-fallback): `snapshot.hostPlayerId` reassignes
      // ALDRI når original-host disconnecter. Auto-draw-cron feilet 100%
      // med "Spiller finnes ikke i rommet." Vi løste det først med
      // players[0]?.id-fallback, men system-actor er semantisk mer korrekt.
      const players = snapshot.players ?? [];
      if (players.length === 0) {
        log.info(
          {
            event: "auto_draw_skip_empty_room",
            roomCode: summary.code,
            slug: snapshot.gameSlug,
          },
          "[game3-auto-draw] skip — empty room (no players to receive draw)",
        );
        skipped++;
        continue;
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
        // G3 engine-effekter (`g3:pattern:changed`, `g3:pattern:auto-won`)
        // + `room:update` slik at klientene rendrer den nye ballen og
        // pattern-tilstand. Identisk wiring som Game2-tick-en. Fail-soft:
        // adapter-en sluker egne feil; lokal try/catch beskytter mot
        // bugs i en evt. fremtidig broadcaster-impl.
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
            "[game3-auto-draw] broadcaster.onDrawCompleted threw — fortsetter likevel"
          );
        }

        log.info(
          {
            roomCode: summary.code,
            gameId: result.gameId,
            drawIndex: result.drawIndex,
            number: result.number,
          },
          "[game3-auto-draw] drew ball"
        );
      } catch (err) {
        const code = err instanceof DomainError ? err.code : null;
        if (
          code === "DRAW_TOO_SOON" ||
          code === "NO_MORE_NUMBERS" ||
          code === "GAME_PAUSED" ||
          code === "GAME_NOT_RUNNING" ||
          code === "GAME_ENDED"
        ) {
          skipped++;
          if (code === "DRAW_TOO_SOON") {
            this.lastDrawAtByRoom.set(summary.code, Date.now());
          }
          log.debug(
            { roomCode: summary.code, code },
            "[game3-auto-draw] expected race — skipping"
          );
        } else {
          errors++;
          const msg = `${summary.code}: ${(err as Error).message ?? "unknown"}`;
          if (errorMessages.length < 10) errorMessages.push(msg);
          log.warn(
            { err, roomCode: summary.code },
            "[game3-auto-draw] drawNextNumber failed"
          );
        }
      } finally {
        this.currentlyProcessing.delete(summary.code);
      }
    }

    log.debug(
      { checked, drawsTriggered, skipped, errors, staleRoomsEnded: staleRoomsEnded.length },
      "[game3-auto-draw] tick completed"
    );

    // Tobias-direktiv 2026-05-04 (room-uniqueness invariant): periodisk
    // sanity-check at det fortsatt er ETT globalt monsterbingo-rom. Trigges
    // hver `periodicValidationEvery`-te tick (default 10) for å holde
    // overhead lav. Fail-soft: feil i validering må ALDRI ta ned draw-loopen.
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
          "[game3-auto-draw] periodic invariant validation threw — swallowed"
        );
      }
    }

    return {
      checked,
      drawsTriggered,
      skipped,
      errors,
      errorMessages: errorMessages.length > 0 ? errorMessages : undefined,
      staleRoomsEnded: staleRoomsEnded.length > 0 ? staleRoomsEnded : undefined,
    };
  }
}
