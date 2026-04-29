/**
 * Tobias prod-incident 2026-04-29: LegacyMiniGameAdapter.
 *
 * Bridges the LEGACY `minigame:activated` server event (still used by
 * BingoEngine's auto-claim path — see PR #727) to the existing M6 mini-game
 * overlays (Mystery / Wheel / Chest / ColorDraft).
 *
 * Why this exists
 * ────────────────
 * BIN-690 PR-M6 removed the legacy listener in favor of the scheduled-games
 * 3-step protocol (`mini_game:trigger` → `mini_game:choice` → `mini_game:result`).
 * But Spill 1's auto-round flow (the dominant production code-path) uses the
 * LEGACY auto-claim emit chain:
 *
 *   1. `evaluateActivePhase` auto-records Fullt Hus claim (no claim:submit
 *      from client).
 *   2. `BingoEngine.activateMiniGame()` builds a `MiniGameState`.
 *   3. `drawEvents.ts` (PR #727) emits `minigame:activated` with the
 *      legacy payload `{ gameId, playerId, type, prizeList }`.
 *
 * Without re-wiring, the popup never renders for auto-round games on Demo
 * Hall. This adapter re-wires it without re-introducing the M6 protocol on
 * the auto-round path (out-of-scope architectural change).
 *
 * Shape mismatch handled here
 * ───────────────────────────
 * The legacy payload only has `prizeList: number[]`. The new overlays expect
 * type-specific trigger fields (e.g. Wheel needs `{totalBuckets, prizes}`,
 * Chest needs `{chestCount, prizeRange}`, Mystery needs `middleNumber`/
 * `resultNumber`/`maxRounds` etc). This adapter synthesizes a sensible M6-
 * shaped trigger payload from the legacy `prizeList` so the existing
 * overlays render correctly.
 *
 * Choice path
 * ───────────
 * Choice is sent via `socket.playMiniGame()` (legacy `minigame:play` event),
 * NOT via `socket.sendMiniGameChoice()`. The legacy server is authoritative
 * — it picks `segmentIndex` server-side and returns the result via ack.
 * The adapter then synthesizes an M6-shaped result payload and calls
 * `overlay.animateResult(...)` to drive the existing animation code.
 *
 * Per-type semantics
 * ──────────────────
 * - `wheelOfFortune` (legacy) → `WheelOverlay` with synthesized
 *   `{totalBuckets: 50, prizes: [{amount, buckets: 50/N}]}` from the prize
 *   list. Choice payload `{}` (no decision). Server picks.
 * - `treasureChest` (legacy) → `TreasureChestOverlay` with
 *   `{chestCount: prizeList.length, prizeRange: {min, max}}`. Choice payload
 *   `{chosenIndex}` — passed as `selectedIndex` to legacy `minigame:play`
 *   (cosmetic-only).
 * - `colorDraft` (legacy) → `ColorDraftOverlay` with default 12 slots.
 * - `mysteryGame` (legacy) → `MysteryGameOverlay` with synthesized
 *   `middleNumber`/`resultNumber` (random) and `prizeListNok` from the
 *   legacy prize list, padded/sliced to 6 entries (overlay default). The
 *   choice (directions array) is ignored by the legacy server — server
 *   only returns a single `prizeAmount`. The adapter synthesizes a result
 *   payload that drives the visual animation: if prizeAmount > 0 we present
 *   it as a positive outcome (joker if at max position).
 *
 * Single-overlay invariant
 * ────────────────────────
 * Mirrors `MiniGameRouter`: only one overlay active at a time. A new trigger
 * dismisses the previous one. `destroy()` is idempotent.
 */

import { Container } from "pixi.js";
import type { GameBridge } from "../../../bridge/GameBridge.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";
import type { GameApp } from "../../../core/GameApp.js";
import type {
  MiniGameActivatedPayload,
  MiniGamePlayResult,
} from "@spillorama/shared-types/socket-events";
import { telemetry } from "../../../telemetry/Telemetry.js";
import { WheelOverlay } from "../components/WheelOverlay.js";
import { TreasureChestOverlay } from "../components/TreasureChestOverlay.js";
import { ColorDraftOverlay } from "../components/ColorDraftOverlay.js";
import { MysteryGameOverlay } from "../components/MysteryGameOverlay.js";

type LegacyMiniGameOverlay =
  | WheelOverlay
  | TreasureChestOverlay
  | ColorDraftOverlay
  | MysteryGameOverlay;

interface LegacyMiniGameAdapterDeps {
  /** Root container to attach the active overlay to. */
  readonly root: Container;
  /** Host app — used for current screen dimensions. */
  readonly app: GameApp;
  /** Socket wrapper — used for `playMiniGame` emits. */
  readonly socket: SpilloramaSocket;
  /**
   * Bridge — passed to pause-aware overlays (Wheel / TreasureChest) so their
   * countdowns respect `state.isPaused`. Also lets the adapter look up
   * `roomCode` via `bridge.getState().roomCode` for the `minigame:play` emit.
   */
  readonly bridge: GameBridge;
}

const DEFAULT_WHEEL_BUCKETS = 50;
const DEFAULT_MYSTERY_PRIZES: readonly number[] = [50, 100, 200, 400, 800, 1500];

/** Synthesized M6 trigger-payload helpers. Exported for test reuse. */
export function synthesizeTriggerPayload(
  type: MiniGameActivatedPayload["type"],
  prizeList: readonly number[],
): Readonly<Record<string, unknown>> {
  switch (type) {
    case "wheelOfFortune":
      return synthesizeWheelTrigger(prizeList);
    case "treasureChest":
      return synthesizeChestTrigger(prizeList);
    case "colorDraft":
      return synthesizeColorDraftTrigger(prizeList);
    case "mysteryGame":
      return synthesizeMysteryTrigger(prizeList);
    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      return {};
    }
  }
}

function synthesizeWheelTrigger(
  prizeList: readonly number[],
): Readonly<Record<string, unknown>> {
  const total = DEFAULT_WHEEL_BUCKETS;
  const distinct = prizeList.length > 0 ? prizeList : [0];
  // Distribute 50 buckets evenly across distinct prize amounts. Last prize
  // absorbs the remainder so the sum exactly equals total.
  const baseShare = Math.floor(total / distinct.length);
  const remainder = total - baseShare * distinct.length;
  const prizes = distinct.map((amount, i) => ({
    amount,
    buckets: baseShare + (i === distinct.length - 1 ? remainder : 0),
  }));
  return { totalBuckets: total, prizes, spinCount: 1 };
}

function synthesizeChestTrigger(
  prizeList: readonly number[],
): Readonly<Record<string, unknown>> {
  const count = Math.max(2, prizeList.length || 6);
  const min = prizeList.length > 0 ? Math.min(...prizeList) : 0;
  const max = prizeList.length > 0 ? Math.max(...prizeList) : 0;
  return {
    chestCount: count,
    prizeRange: { minNok: min, maxNok: max },
    hasDiscreteTiers: true,
  };
}

function synthesizeColorDraftTrigger(
  prizeList: readonly number[],
): Readonly<Record<string, unknown>> {
  // Legacy colorDraft has no per-slot color info; ColorDraftOverlay falls
  // back to its default 12 slots if `slotColors` is empty. We pick a target
  // and the win/consolation prizes from the list.
  const win = prizeList[0] ?? 0;
  const consolation = 0;
  return {
    numberOfSlots: 12,
    targetColor: "yellow",
    slotColors: [] as string[],
    winPrizeNok: win,
    consolationPrizeNok: consolation,
  };
}

function synthesizeMysteryTrigger(
  prizeList: readonly number[],
): Readonly<Record<string, unknown>> {
  // MysteryGameOverlay needs a 6-element prize ladder. Pad/slice the legacy
  // list to fit. Server doesn't supply middleNumber/resultNumber, so we
  // synthesize random 5-digit numbers — the legacy server has no concept of
  // mystery rounds, so the visual rounds are purely client-side eye-candy
  // until the choice ack arrives. The resulting prize from the ack drives
  // the final state in `synthesizeResultPayload`.
  const ladder = prizeList.length > 0 ? prizeList : DEFAULT_MYSTERY_PRIZES;
  const padded: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    padded.push(ladder[i % ladder.length] ?? 0);
  }
  // Random 5-digit numbers in [10000, 99999]. The overlay uses these to
  // generate the per-round "middle" digits the user picks against; the
  // outcome is purely client-rendered since the legacy server returns only
  // a single prizeAmount.
  const middleNumber = 10000 + Math.floor(Math.random() * 90000);
  const resultNumber = 10000 + Math.floor(Math.random() * 90000);
  return {
    middleNumber,
    resultNumber,
    prizeListNok: padded,
    maxRounds: 5,
    autoTurnFirstMoveSec: 20,
    autoTurnOtherMoveSec: 10,
  };
}

/**
 * Synthesize an M6-shaped result payload from a legacy `MiniGamePlayResult`
 * ack. Each overlay's `animateResult` reads the type-specific fields it
 * cares about. Exported for test reuse.
 */
export function synthesizeResultPayload(
  type: MiniGameActivatedPayload["type"],
  ack: MiniGamePlayResult,
  triggerPayload: Readonly<Record<string, unknown>>,
  chosenIndex?: number,
): Readonly<Record<string, unknown>> {
  switch (type) {
    case "wheelOfFortune": {
      const totalBuckets =
        (triggerPayload as { totalBuckets?: number }).totalBuckets ??
        DEFAULT_WHEEL_BUCKETS;
      // Map prizeList-index → bucket-index. Server returned `segmentIndex`
      // which is an index INTO the prize-list (legacy semantics). We pick
      // a bucket inside that prize's range so the wheel lands on it.
      const prizes = (triggerPayload as {
        prizes?: Array<{ amount: number; buckets: number }>;
      }).prizes ?? [];
      let bucketStart = 0;
      for (let i = 0; i < ack.segmentIndex && i < prizes.length; i += 1) {
        bucketStart += prizes[i]?.buckets ?? 0;
      }
      const bucketSpan = prizes[ack.segmentIndex]?.buckets ?? 1;
      const bucketIndex =
        bucketStart + Math.floor(Math.random() * Math.max(1, bucketSpan));
      return {
        winningBucketIndex: bucketIndex,
        prizeGroupIndex: ack.segmentIndex,
        amountKroner: ack.prizeAmount,
        totalBuckets,
        animationSeed: 0,
      };
    }
    case "treasureChest": {
      const chestCount =
        (triggerPayload as { chestCount?: number }).chestCount ??
        ack.prizeList.length;
      // Chest UX: chosenIndex is the player's pick (cosmetic — server picks
      // the prize). The overlay reveals every chest with `allValuesKroner`.
      // Legacy `prizeList` is a list of distinct amounts, not per-chest
      // values; we shuffle/pad to fit `chestCount` for visual purposes,
      // ensuring chosen index gets the actual prize.
      const all: number[] = [];
      for (let i = 0; i < chestCount; i += 1) {
        all.push(ack.prizeList[i % ack.prizeList.length] ?? 0);
      }
      // Force chosen index to show actual prize-amount.
      if (typeof chosenIndex === "number" && chosenIndex >= 0 && chosenIndex < all.length) {
        all[chosenIndex] = ack.prizeAmount;
      }
      return {
        chosenIndex: chosenIndex ?? ack.segmentIndex,
        prizeAmountKroner: ack.prizeAmount,
        allValuesKroner: all,
        chestCount,
      };
    }
    case "colorDraft": {
      const numberOfSlots =
        (triggerPayload as { numberOfSlots?: number }).numberOfSlots ?? 12;
      const targetColor =
        (triggerPayload as { targetColor?: string }).targetColor ?? "yellow";
      const matched = ack.prizeAmount > 0;
      // Build a slot-color list — chosen slot matches target if matched.
      const colors = ["yellow", "blue", "red", "green", "purple", "orange"];
      const allSlotColors: string[] = [];
      for (let i = 0; i < numberOfSlots; i += 1) {
        allSlotColors.push(colors[i % colors.length] ?? "yellow");
      }
      if (typeof chosenIndex === "number" && chosenIndex >= 0 && chosenIndex < allSlotColors.length) {
        allSlotColors[chosenIndex] = matched ? targetColor : "red";
      }
      return {
        chosenIndex: chosenIndex ?? 0,
        chosenColor: allSlotColors[chosenIndex ?? 0] ?? "yellow",
        targetColor,
        matched,
        prizeAmountKroner: ack.prizeAmount,
        allSlotColors,
        numberOfSlots,
      };
    }
    case "mysteryGame": {
      // Mystery: legacy server has no concept of rounds. The user picked a
      // sequence of opp/ned directions which the overlay rendered locally.
      // We use the server's prize amount to set finalPriceIndex (top of
      // ladder if jackpot, else map by amount).
      const prizeListNok =
        (triggerPayload as { prizeListNok?: number[] }).prizeListNok ?? [];
      // finalPriceIndex: index in prizeListNok matching the prize, or top
      // if it's >= max prize, or 0 if no win.
      let finalPriceIndex = 0;
      const maxIdx = prizeListNok.length > 0 ? prizeListNok.length - 1 : 0;
      if (ack.prizeAmount > 0 && prizeListNok.length > 0) {
        const matchIdx = prizeListNok.indexOf(ack.prizeAmount);
        finalPriceIndex = matchIdx >= 0 ? matchIdx : maxIdx;
      }
      const jokerTriggered =
        ack.prizeAmount > 0 && finalPriceIndex === maxIdx;
      return {
        middleNumber: (triggerPayload as { middleNumber?: number }).middleNumber ?? 0,
        resultNumber: (triggerPayload as { resultNumber?: number }).resultNumber ?? 0,
        rounds: [],
        finalPriceIndex,
        prizeAmountKroner: ack.prizeAmount,
        jokerTriggered,
      };
    }
    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      return {};
    }
  }
}

export class LegacyMiniGameAdapter {
  private overlay: LegacyMiniGameOverlay | null = null;
  /** Active legacy payload — used to look up `type` in choice-handler. */
  private activePayload: MiniGameActivatedPayload | null = null;
  /** Trigger payload sent to overlay — needed when synthesizing result. */
  private activeTriggerPayload: Readonly<Record<string, unknown>> | null = null;
  /**
   * `chosenIndex` from the most recent overlay-choice. Stored so we can
   * pass it through to the synthesized result payload after the legacy
   * server's ack arrives. Non-applicable for Wheel/Mystery (which don't
   * send `chosenIndex` in their choiceJson).
   */
  private lastChosenIndex: number | undefined;

  constructor(private readonly deps: LegacyMiniGameAdapterDeps) {}

  /**
   * Handle legacy `minigame:activated`. Synthesizes an M6-shaped trigger
   * payload, instantiates the matching overlay, and wires the choice
   * handler to route through the legacy `minigame:play` server event.
   */
  onActivated(payload: MiniGameActivatedPayload): void {
    const w = this.deps.app.app.screen.width;
    const h = this.deps.app.app.screen.height;

    // Single-overlay invariant: dismiss any active overlay first.
    if (this.overlay) {
      this.dismiss();
    }

    const overlay = this.buildOverlay(payload.type, w, h);
    if (!overlay) return;

    const triggerPayload = synthesizeTriggerPayload(payload.type, payload.prizeList);

    overlay.setOnChoice((choiceJson) => this.sendChoice(choiceJson));
    overlay.setOnDismiss(() => this.dismiss());

    this.overlay = overlay;
    this.activePayload = payload;
    this.activeTriggerPayload = triggerPayload;
    this.lastChosenIndex = undefined;

    this.deps.root.addChild(overlay);
    overlay.show(triggerPayload);

    telemetry.trackEvent("legacy_minigame_activated", {
      type: payload.type,
      gameId: payload.gameId,
      prizeListLength: payload.prizeList.length,
    });
  }

  private buildOverlay(
    type: MiniGameActivatedPayload["type"],
    w: number,
    h: number,
  ): LegacyMiniGameOverlay | null {
    switch (type) {
      case "wheelOfFortune":
        return new WheelOverlay(w, h, this.deps.bridge);
      case "treasureChest":
        return new TreasureChestOverlay(w, h, this.deps.bridge);
      case "colorDraft":
        return new ColorDraftOverlay(w, h);
      case "mysteryGame":
        return new MysteryGameOverlay(w, h);
      default: {
        const _exhaustive: never = type;
        void _exhaustive;
        console.warn(
          "[LegacyMiniGameAdapter] Unknown legacy mini-game type, ignoring:",
          type,
        );
        return null;
      }
    }
  }

  /**
   * Forward overlay choice via legacy `minigame:play`. Synthesize an
   * M6-shaped result payload from the ack and drive the overlay's
   * `animateResult` hook so the existing animation code runs.
   *
   * Fail-closed: if the emit returns an error the overlay is informed via
   * `showChoiceError(...)` and does NOT dismiss. The player can retry; the
   * legacy server's `playMiniGame` is idempotent (`miniGame.isPlayed` guard).
   */
  private async sendChoice(
    choiceJson: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    if (!this.overlay || !this.activePayload || !this.activeTriggerPayload) {
      console.warn("[LegacyMiniGameAdapter] sendChoice called with no active overlay");
      return;
    }
    const overlay = this.overlay;
    const payload = this.activePayload;
    const triggerPayload = this.activeTriggerPayload;
    const roomCode = this.deps.bridge.getState().roomCode;
    if (!roomCode) {
      const err = { code: "NO_ROOM", message: "Ingen aktiv runde." };
      console.error("[LegacyMiniGameAdapter] no roomCode for choice");
      overlay.showChoiceError?.(err);
      return;
    }

    // Extract chosenIndex (chest / colorDraft) for the legacy `selectedIndex`
    // field and the synthesized result payload. Wheel / Mystery don't send
    // chosenIndex in their choice payload.
    const chosenIndex =
      typeof (choiceJson as { chosenIndex?: unknown }).chosenIndex === "number"
        ? (choiceJson as { chosenIndex: number }).chosenIndex
        : undefined;
    this.lastChosenIndex = chosenIndex;

    try {
      const ack = await this.deps.socket.playMiniGame({
        roomCode,
        ...(chosenIndex !== undefined ? { selectedIndex: chosenIndex } : {}),
      });
      if (!ack.ok) {
        const err = {
          code: ack.error?.code ?? "UNKNOWN",
          message: ack.error?.message ?? "Ukjent feil ved innsending av valg.",
        };
        console.error("[LegacyMiniGameAdapter] minigame:play failed:", err);
        overlay.showChoiceError?.(err);
        telemetry.trackEvent("legacy_minigame_choice_failed", {
          code: err.code,
          type: payload.type,
        });
        return;
      }
      if (!ack.data) {
        // Server returned ok but no data — should not happen, but defend.
        console.warn("[LegacyMiniGameAdapter] minigame:play returned no data");
        return;
      }

      const resultPayload = synthesizeResultPayload(
        payload.type,
        ack.data,
        triggerPayload,
        chosenIndex,
      );
      // payoutCents = prizeAmount in øre. Server emits NOK; convert.
      const payoutCents = Math.max(0, Math.round((ack.data.prizeAmount ?? 0) * 100));
      overlay.animateResult(resultPayload, payoutCents);

      telemetry.trackEvent("legacy_minigame_resolved", {
        type: payload.type,
        prizeAmount: ack.data.prizeAmount,
      });
    } catch (err) {
      console.error("[LegacyMiniGameAdapter] sendChoice threw:", err);
      const errInfo = {
        code: "UNKNOWN",
        message: "Ukjent feil ved innsending av valg.",
      };
      overlay.showChoiceError?.(errInfo);
    }
  }

  /**
   * Tear down the active overlay. Called by overlays after their dismiss
   * animation, and by `Game1Controller.onGameEnded` to ensure overlays
   * don't block the EndScreen.
   */
  dismiss(): void {
    this.overlay?.destroy({ children: true });
    this.overlay = null;
    this.activePayload = null;
    this.activeTriggerPayload = null;
    this.lastChosenIndex = undefined;
  }

  destroy(): void {
    this.dismiss();
  }
}
