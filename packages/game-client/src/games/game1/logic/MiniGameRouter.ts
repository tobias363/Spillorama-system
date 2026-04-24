import { Container } from "pixi.js";
import type { GameBridge } from "../../../bridge/GameBridge.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";
import type { GameApp } from "../../../core/GameApp.js";
import type {
  MiniGameTriggerPayload,
  MiniGameResultPayload,
} from "@spillorama/shared-types/socket-events";
import { telemetry } from "../../../telemetry/Telemetry.js";
import { WheelOverlay } from "../components/WheelOverlay.js";
import { TreasureChestOverlay } from "../components/TreasureChestOverlay.js";
import { ColorDraftOverlay } from "../components/ColorDraftOverlay.js";
import { OddsenOverlay } from "../components/OddsenOverlay.js";
import { MysteryGameOverlay } from "../components/MysteryGameOverlay.js";

/**
 * BIN-690 PR-M6: MiniGameRouter for the scheduled-games framework.
 *
 * Replaces the legacy `minigame:activated`/`minigame:play` path. The new
 * protocol is a 3-step server-authoritative flow:
 *
 *   1. Server → Client: `mini_game:trigger { resultId, miniGameType, payload }`
 *      - Router picks the overlay for `miniGameType` and calls `show(payload)`.
 *   2. Client → Server: `mini_game:choice { resultId, choiceJson }`
 *      - Overlays fire via `setOnChoice` when the player picks. Router wraps
 *        the dispatch, adds `resultId`, and emits via SpilloramaSocket.
 *   3. Server → Client: `mini_game:result { resultId, miniGameType, payoutCents, resultJson }`
 *      - Router dispatches to the overlay's `animateResult(resultJson, payoutCents)`
 *        method. Overlay handles visuals + auto-dismiss timing.
 *
 * Per-type semantics:
 *   - wheel: no choice UI. Auto-sends `{}` when player clicks "Snurr".
 *     payoutCents > 0 for win, 0 if all buckets are 0-amount.
 *   - chest: player picks `chosenIndex`. Server reveals all values in result.
 *   - colordraft: player matches `targetColor` (shown in trigger).
 *   - oddsen: player picks `chosenNumber`. payoutCents is ALWAYS 0 at choice-
 *     phase — Oddsen resolves in the NEXT game's terskel-draw via a second
 *     `mini_game:result` event. Overlay shows "Valg registrert" state after
 *     choice; final outcome arrives later.
 *
 * Single-overlay policy: only ONE active overlay at a time. A new trigger
 * while an overlay is showing is treated as a server-authoritative override —
 * the old one is dismissed (no animation) and the new one replaces it.
 *
 * Fail-closed on choice: if socket emit returns an error ack, the overlay is
 * informed via `showChoiceError(message)` and does NOT dismiss. The player
 * can retry; the server ignores dupes via `completed_at` lock (orchestrator).
 *
 * Never shows hidden data: overlays render only what arrives in trigger's
 * payload. Chest values stay hidden until result-event arrives.
 */

type MiniGameOverlay =
  | WheelOverlay
  | TreasureChestOverlay
  | ColorDraftOverlay
  | OddsenOverlay
  | MysteryGameOverlay;

/**
 * Error shape passed to overlays when a socket emit fails. Keeps the overlay
 * contract minimal: they need a message to display and a signal not to
 * dismiss.
 */
export interface ChoiceError {
  readonly code: string;
  readonly message: string;
}

interface MiniGameRouterDeps {
  /** Root container to attach the active overlay to. */
  readonly root: Container;
  /** Host app — used for current screen dimensions. */
  readonly app: GameApp;
  /** Socket wrapper — used for `sendMiniGameChoice` emits. */
  readonly socket: SpilloramaSocket;
  /**
   * Bridge — passed to pause-aware overlays (Wheel / TreasureChest) so their
   * countdowns respect `state.isPaused`.
   */
  readonly bridge: GameBridge;
}

export class MiniGameRouter {
  private overlay: MiniGameOverlay | null = null;
  /**
   * ResultId from the most recent trigger. Used to validate that incoming
   * `mini_game:result` events match the active overlay; stale results
   * (from a prior game) are silently ignored so we don't mis-animate.
   */
  private activeResultId: string | null = null;

  constructor(private readonly deps: MiniGameRouterDeps) {}

  /**
   * Server → Client: handle `mini_game:trigger`. Instantiates the overlay for
   * `miniGameType`, wires callbacks, and displays it. If an overlay is
   * already active it's destroyed (no animation) before the new one shows —
   * this matches the server-authoritative invariant that only one mini-game
   * exists per player at a time.
   */
  onTrigger(payload: MiniGameTriggerPayload): void {
    const w = this.deps.app.app.screen.width;
    const h = this.deps.app.app.screen.height;

    // Dismiss any active overlay first — server-authoritative override.
    if (this.overlay) {
      this.dismiss();
    }

    const overlay: MiniGameOverlay = (() => {
      switch (payload.miniGameType) {
        case "wheel":
          return new WheelOverlay(w, h, this.deps.bridge);
        case "chest":
          return new TreasureChestOverlay(w, h, this.deps.bridge);
        case "colordraft":
          return new ColorDraftOverlay(w, h);
        case "oddsen":
          return new OddsenOverlay(w, h);
        case "mystery":
          return new MysteryGameOverlay(w, h);
        default: {
          // Exhaustive-check: if a new type is added to the union the compiler
          // will flag this default. At runtime, unknown types are a protocol
          // violation — log and skip.
          const _exhaustive: never = payload.miniGameType;
          void _exhaustive;
          console.warn(
            "[MiniGameRouter] Unknown miniGameType, ignoring trigger:",
            payload.miniGameType,
          );
          return null as unknown as MiniGameOverlay;
        }
      }
    })();

    if (!overlay) return;

    overlay.setOnChoice((choiceJson) => this.sendChoice(choiceJson));
    overlay.setOnDismiss(() => this.dismiss());
    this.overlay = overlay;
    this.activeResultId = payload.resultId;
    this.deps.root.addChild(overlay);
    overlay.show(payload.payload);

    telemetry.trackEvent("minigame_triggered", {
      type: payload.miniGameType,
      resultId: payload.resultId,
    });
  }

  /**
   * Server → Client: handle `mini_game:result`. Dispatches to the active
   * overlay's `animateResult` hook. Mismatching `resultId` is treated as a
   * stale event (e.g. from a previous game left over in the socket buffer)
   * and dropped silently.
   */
  onResult(payload: MiniGameResultPayload): void {
    if (!this.overlay || this.activeResultId !== payload.resultId) {
      console.debug(
        "[MiniGameRouter] result ignored — no active overlay or resultId mismatch",
        { activeResultId: this.activeResultId, incoming: payload.resultId },
      );
      return;
    }
    this.overlay.animateResult(payload.resultJson, payload.payoutCents);
    telemetry.trackEvent("minigame_resolved", {
      type: payload.miniGameType,
      payoutCents: payload.payoutCents,
      resultId: payload.resultId,
    });
  }

  /**
   * Client → Server: send the player's choice. Wraps it in the full
   * `mini_game:choice` payload with the active `resultId`. On error, informs
   * the overlay so it can show feedback WITHOUT dismissing (fail-closed).
   */
  private async sendChoice(
    choiceJson: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    if (!this.activeResultId) {
      console.warn("[MiniGameRouter] sendChoice called with no active resultId");
      return;
    }
    const resultId = this.activeResultId;
    const ack = await this.deps.socket.sendMiniGameChoice({
      resultId,
      choiceJson,
    });
    if (!ack.ok) {
      const err: ChoiceError = {
        code: ack.error?.code ?? "UNKNOWN",
        message: ack.error?.message ?? "Ukjent feil ved innsending av valg.",
      };
      console.error("[MiniGameRouter] mini_game:choice failed:", err);
      this.overlay?.showChoiceError?.(err);
      telemetry.trackEvent("minigame_choice_failed", {
        code: err.code,
        resultId,
      });
      return;
    }
    telemetry.trackEvent("minigame_choice_sent", { resultId });
  }

  /**
   * Destroy the active overlay and clear router state. Called by overlays
   * after their dismiss-animation and by Game1Controller on game-ended to
   * ensure overlays don't block the EndScreen.
   */
  dismiss(): void {
    this.overlay?.destroy({ children: true });
    this.overlay = null;
    this.activeResultId = null;
  }

  destroy(): void {
    this.dismiss();
  }
}
