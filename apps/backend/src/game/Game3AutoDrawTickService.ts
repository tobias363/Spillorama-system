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
import type { AutoDrawEngine } from "./Game2AutoDrawTickService.js";

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
   */
  drawIntervalMs?: number;
}

export interface Game3AutoDrawTickResult {
  checked: number;
  drawsTriggered: number;
  skipped: number;
  errors: number;
  errorMessages?: string[];
}

// ── Service ─────────────────────────────────────────────────────────────────

export class Game3AutoDrawTickService {
  private readonly engine: AutoDrawEngine;
  private readonly drawIntervalMs: number;

  private readonly lastDrawAtByRoom = new Map<string, number>();
  private readonly currentlyProcessing = new Set<string>();

  constructor(options: Game3AutoDrawTickServiceOptions) {
    this.engine = options.engine;
    const interval = options.drawIntervalMs;
    // 0 er gyldig (= "ingen throttle" — engine-laget håndhever sin egen
    // minDrawIntervalMs). Negativ/NaN/undefined → default 30 000 ms.
    this.drawIntervalMs =
      typeof interval === "number" && Number.isFinite(interval) && interval >= 0
        ? Math.floor(interval)
        : 30_000;
  }

  async tick(): Promise<Game3AutoDrawTickResult> {
    const summaries = this.engine.listRoomSummaries();
    const now = Date.now();
    let checked = 0;
    let drawsTriggered = 0;
    let skipped = 0;
    let errors = 0;
    const errorMessages: string[] = [];

    for (const summary of summaries) {
      const slug = (summary.gameSlug ?? "").toLowerCase();
      if (!GAME3_SLUGS.has(slug)) continue;
      if (summary.gameStatus !== "RUNNING") continue;

      checked++;

      if (this.currentlyProcessing.has(summary.code)) {
        skipped++;
        continue;
      }

      const lastDrawAt = this.lastDrawAtByRoom.get(summary.code) ?? 0;
      if (now - lastDrawAt < this.drawIntervalMs) {
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
        skipped++;
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
      { checked, drawsTriggered, skipped, errors },
      "[game3-auto-draw] tick completed"
    );

    return {
      checked,
      drawsTriggered,
      skipped,
      errors,
      errorMessages: errorMessages.length > 0 ? errorMessages : undefined,
    };
  }
}
