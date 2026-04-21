import { Container } from "pixi.js";
import type { GameBridge } from "../../../bridge/GameBridge.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";
import type { GameApp } from "../../../core/GameApp.js";
import type { MiniGameActivatedPayload } from "@spillorama/shared-types/socket-events";
import { telemetry } from "../../../telemetry/Telemetry.js";
import { WheelOverlay } from "../components/WheelOverlay.js";
import { TreasureChestOverlay } from "../components/TreasureChestOverlay.js";
import { MysteryGameOverlay } from "../components/MysteryGameOverlay.js";
import { ColorDraftOverlay } from "../components/ColorDraftOverlay.js";

type MiniGameOverlay =
  | WheelOverlay
  | TreasureChestOverlay
  | MysteryGameOverlay
  | ColorDraftOverlay;

interface MiniGameRouterDeps {
  /** Root container to attach overlay to. */
  readonly root: Container;
  /** Host app — used for screen dimensions. */
  readonly app: GameApp;
  /** Socket for the play-action round-trip. */
  readonly socket: SpilloramaSocket;
  /** Bridge — passed to pause-aware overlays (Wheel + TreasureChest). */
  readonly bridge: GameBridge;
  /** Active room code (resolved post-join). */
  readonly getRoomCode: () => string;
}

/**
 * Ett ansvar: ta imot `minigame:activated`-event og koordinere riktig overlay
 * (Wheel/TreasureChest/MysteryGame/ColorDraft) fra start til dismiss.
 */
export class MiniGameRouter {
  private overlay: MiniGameOverlay | null = null;

  constructor(private readonly deps: MiniGameRouterDeps) {}

  /**
   * Aktivér riktig overlay basert på payload-type. Wire opp play + dismiss
   * tilbake til router-en; overlay er plassert i root for å blokkere
   * interaksjon bak seg.
   */
  onActivated(data: MiniGameActivatedPayload): void {
    const w = this.deps.app.app.screen.width;
    const h = this.deps.app.app.screen.height;

    // Pause-aware overlays (Wheel + TreasureChest) får bridge så de kan fryse
    // auto-timer-ne under `state.isPaused`. De andre trenger ikke.
    const overlay: MiniGameOverlay = (() => {
      switch (data.type) {
        case "wheelOfFortune":
          return new WheelOverlay(w, h, this.deps.bridge);
        case "mysteryGame":
          return new MysteryGameOverlay(w, h);
        case "colorDraft":
          return new ColorDraftOverlay(w, h);
        default:
          return new TreasureChestOverlay(w, h, this.deps.bridge);
      }
    })();

    overlay.setOnPlay((idx?: number) => this.play(idx));
    overlay.setOnDismiss(() => this.dismiss());
    this.overlay = overlay;
    this.deps.root.addChild(overlay);
    overlay.show(data);

    telemetry.trackEvent("minigame_activated", { type: data.type });
  }

  /** Spiller-klikk på en wheel-segment / chest / ball / card. */
  private async play(selectedIndex?: number): Promise<void> {
    const result = await this.deps.socket.playMiniGame({
      roomCode: this.deps.getRoomCode(),
      selectedIndex,
    });
    if (result.ok && result.data) {
      this.overlay?.animateResult(result.data);
      telemetry.trackEvent("minigame_played", {
        type: result.data.type,
        prizeAmount: result.data.prizeAmount,
      });
    } else {
      console.error("[Game1] Mini-game play failed:", result.error);
    }
  }

  /**
   * Lukk aktiv overlay. Kalles fra onGameEnded for å unngå at overlay blokkerer
   * EndScreen, og fra overlay.onDismiss når brukeren selv lukker den.
   */
  dismiss(): void {
    this.overlay?.destroy({ children: true });
    this.overlay = null;
  }

  destroy(): void {
    this.dismiss();
  }
}
