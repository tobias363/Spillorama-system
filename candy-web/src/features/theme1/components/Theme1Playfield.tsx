import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type {
  Theme1BonusState,
  Theme1BoardState,
  Theme1CelebrationState,
  Theme1HudState,
  Theme1RoundMeta,
} from "@/domain/theme1/renderModel";
import { getTheme1BallSpriteUrl } from "@/features/theme1/data/theme1BallSprites";
import {
  Theme1BoardCard,
  Theme1BoardPatternSprite,
} from "@/features/theme1/components/Theme1BoardGrid";
import { Theme1BallRail } from "@/features/theme1/components/Theme1BallRail";
import {
  Theme1CountdownPanel,
  Theme1HudRack,
} from "@/features/theme1/components/Theme1HudRack";
import { Theme1BonusOverlay } from "@/features/theme1/components/Theme1BonusOverlay";
import { Theme1DrawMachine } from "@/features/theme1/components/Theme1DrawMachine";

interface Theme1PlayfieldProps {
  bonusActive: boolean;
  bonus: Theme1BonusState;
  boards: Theme1BoardState[];
  hud: Theme1HudState;
  meta: Theme1RoundMeta;
  recentBalls: number[];
  displayedRecentBalls: number[];
  featuredBall: number | null;
  featuredBallIsPending: boolean;
  celebration: Theme1CelebrationState | null;
  stakeBusy: boolean;
  rerollBusy: boolean;
  betBusy: boolean;
  isBetArmed: boolean;
  onDecreaseStake: () => void;
  onIncreaseStake: () => void;
  onShuffle: () => void;
  onPlaceBet: () => void;
  onOpenBonusTest: () => void;
  onResetBonusTest: () => void;
  onSelectBonusSlot: (slotId: string) => void;
  onCloseBonusTest: () => void;
  onRailFlightSettled?: (ballNumber: number) => void;
  showHudControls?: boolean;
  showCountdownPanel?: boolean;
  showBallRail?: boolean;
}

interface Theme1FlyingRailBallState {
  number: number;
  targetIndex: number;
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
  startSize: number;
  startScale: number;
  endScale: number;
}

interface Theme1RailPresentationState {
  renderedBalls: number[];
  queuedBallNumber: number | null;
  queuedTargetIndex: number | null;
}

interface Theme1RailFlightGeometry {
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
}

const THEME1_RAIL_FLIGHT_HOLD_MS = 300;
const THEME1_RAIL_FLIGHT_DURATION_MS = 1500;
const THEME1_RAIL_FLIGHT_START_OFFSET_X_PX = -1;
const THEME1_RAIL_FLIGHT_START_OFFSET_Y_PX = 6;
const THEME1_RAIL_FLIGHT_OUTPUT_OVERLAP_MS = 0;
const THEME1_RAIL_FLIGHT_LANDING_OVERLAP_MS = 90;
/** Safety ceiling: force-land any flight that exceeds this duration. */
const THEME1_RAIL_FLIGHT_MAX_TOTAL_MS =
  THEME1_RAIL_FLIGHT_HOLD_MS + THEME1_RAIL_FLIGHT_DURATION_MS + 500;
const THEME1_ANIMATION_QUEUE_MAX_SIZE = 5;

export function Theme1Playfield({
  bonusActive,
  bonus,
  boards,
  hud,
  meta,
  recentBalls,
  displayedRecentBalls,
  featuredBall,
  featuredBallIsPending,
  celebration,
  stakeBusy,
  rerollBusy,
  betBusy,
  isBetArmed,
  onDecreaseStake,
  onIncreaseStake,
  onShuffle,
  onPlaceBet,
  onOpenBonusTest,
  onResetBonusTest,
  onSelectBonusSlot,
  onCloseBonusTest,
  onRailFlightSettled,
  showHudControls = true,
  showCountdownPanel = true,
  showBallRail = true,
}: Theme1PlayfieldProps) {
  const topBoards = boards.slice(0, 2);
  const bottomBoards = boards.slice(2, 4);
  const usesIntegratedMachineScene = !bonusActive;
  const machineVariant = usesIntegratedMachineScene ? "integrated-live" : "standalone";
  const playfieldRef = useRef<HTMLElement | null>(null);
  const machineFlightOriginRef = useRef<HTMLDivElement | null>(null);
  const machineOutputBallRef = useRef<HTMLDivElement | null>(null);
  const flyingBallRef = useRef<HTMLDivElement | null>(null);
  const compactSlotRefsRef = useRef(new Map<number, HTMLDivElement>());
  const previousRecentBallsRef = useRef(recentBalls);
  const queuedFlightResolvedBallsRef = useRef<number[] | null>(null);
  const pendingDisplayedRecentBallsQueueRef = useRef<number[][]>([]);
  const measureFlightFrameRef = useRef<number | null>(null);
  const flightAnimationFrameRef = useRef<number | null>(null);
  const landingSettleTimeoutRef = useRef<number | null>(null);
  const flightSafetyTimeoutRef = useRef<number | null>(null);
  const outputSuppressedForActiveFlightRef = useRef(false);
  const onRailFlightSettledRef = useRef(onRailFlightSettled);
  const [hiddenRailBallIndex, setHiddenRailBallIndex] = useState<number | null>(null);
  const [queuedFlightBallNumber, setQueuedFlightBallNumber] = useState<number | null>(null);
  const [queuedFlightTargetIndex, setQueuedFlightTargetIndex] = useState<number | null>(null);
  const [suppressedOutputBallNumber, setSuppressedOutputBallNumber] = useState<number | null>(null);
  const [flyingRailBall, setFlyingRailBall] = useState<Theme1FlyingRailBallState | null>(null);
  const [renderedRecentBalls, setRenderedRecentBalls] = useState<number[]>(displayedRecentBalls);

  // Keep the settled callback ref in sync without re-triggering effects.
  onRailFlightSettledRef.current = onRailFlightSettled;

  useEffect(() => {
    return () => {
      if (measureFlightFrameRef.current !== null) {
        window.cancelAnimationFrame(measureFlightFrameRef.current);
      }
      if (flightAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(flightAnimationFrameRef.current);
      }
      if (landingSettleTimeoutRef.current !== null) {
        window.clearTimeout(landingSettleTimeoutRef.current);
      }
      if (flightSafetyTimeoutRef.current !== null) {
        window.clearTimeout(flightSafetyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (flyingRailBall !== null || queuedFlightBallNumber !== null) {
      queueRecentBallsSnapshot(
        pendingDisplayedRecentBallsQueueRef.current,
        recentBalls,
      );
      return;
    }

    // Skip redundant processing when the array reference hasn't changed
    // (e.g. after a flight lands and the effect re-fires due to flyingRailBall → null).
    if (previousRecentBallsRef.current === recentBalls) {
      return;
    }

    // The current recentBalls prop is the authoritative latest state.
    // Clear the queue so the queue-drain effect doesn't process stale
    // snapshots that would go *backwards* (fewer balls than current).
    pendingDisplayedRecentBallsQueueRef.current.length = 0;

    applyRecentBallsSnapshot(
      previousRecentBallsRef.current,
      recentBalls,
      {
        setRenderedRecentBalls,
        setHiddenRailBallIndex,
        setQueuedFlightBallNumber,
        setQueuedFlightTargetIndex,
        setSuppressedOutputBallNumber,
        setFlyingRailBall,
        queuedFlightResolvedBallsRef,
      },
    );
    previousRecentBallsRef.current = recentBalls;
  }, [recentBalls, flyingRailBall, queuedFlightBallNumber]);

  useEffect(() => {
    if (flyingRailBall !== null || queuedFlightBallNumber !== null) {
      return;
    }

    // Skip stale queue entries that are behind the current state.
    // This prevents the rail from going "backwards" (showing fewer
    // balls) when many draws arrived during a flight animation.
    while (pendingDisplayedRecentBallsQueueRef.current.length > 0) {
      const peeked = pendingDisplayedRecentBallsQueueRef.current[0]!;
      if (peeked.length <= (previousRecentBallsRef.current?.length ?? 0)) {
        pendingDisplayedRecentBallsQueueRef.current.shift();
        continue;
      }
      if (areBallArraysEqual(peeked, previousRecentBallsRef.current)) {
        pendingDisplayedRecentBallsQueueRef.current.shift();
        continue;
      }
      break;
    }

    const nextQueuedSnapshot = pendingDisplayedRecentBallsQueueRef.current.shift();
    if (!nextQueuedSnapshot) {
      return;
    }

    applyRecentBallsSnapshot(
      previousRecentBallsRef.current,
      nextQueuedSnapshot,
      {
        setRenderedRecentBalls,
        setHiddenRailBallIndex,
        setQueuedFlightBallNumber,
        setQueuedFlightTargetIndex,
        setSuppressedOutputBallNumber,
        setFlyingRailBall,
        queuedFlightResolvedBallsRef,
      },
    );
    previousRecentBallsRef.current = nextQueuedSnapshot;
  }, [flyingRailBall, queuedFlightBallNumber]);

  /** Commit the queued flight ball directly into the rail without animating.
   *  Used as a fallback when DOM measurement fails so the ball is never lost. */
  function commitFlightBallWithoutAnimation() {
    const resolvedBalls = queuedFlightResolvedBallsRef.current ?? previousRecentBallsRef.current;
    queuedFlightResolvedBallsRef.current = null;
    outputSuppressedForActiveFlightRef.current = false;
    setRenderedRecentBalls(resolvedBalls);
    setHiddenRailBallIndex(null);
    setQueuedFlightBallNumber(null);
    setQueuedFlightTargetIndex(null);
    setSuppressedOutputBallNumber(null);
    setFlyingRailBall(null);
  }

  useLayoutEffect(() => {
    if (
      bonusActive ||
      queuedFlightBallNumber === null ||
      queuedFlightTargetIndex === null ||
      flyingRailBall !== null
    ) {
      return;
    }

    const measureFlight = (remainingAttempts = 16) => {
      const playfieldElement = playfieldRef.current;
      const flightOriginElement = machineFlightOriginRef.current;
      const targetBallElement = compactSlotRefsRef.current.get(queuedFlightTargetIndex);

      if (!playfieldElement || !flightOriginElement || !targetBallElement) {
        if (remainingAttempts > 0) {
          measureFlightFrameRef.current = window.requestAnimationFrame(() => {
            measureFlightFrameRef.current = null;
            measureFlight(remainingAttempts - 1);
          });
          return;
        }

        // Measurement failed — commit ball to rail without animation
        // so it is never lost.
        commitFlightBallWithoutAnimation();
        return;
      }

      const playfieldRect = playfieldElement.getBoundingClientRect();
      const outputBallRect = flightOriginElement.getBoundingClientRect();
      const targetBallRect = targetBallElement.getBoundingClientRect();

      if (outputBallRect.width === 0 || targetBallRect.width === 0) {
        if (remainingAttempts > 0) {
          measureFlightFrameRef.current = window.requestAnimationFrame(() => {
            measureFlightFrameRef.current = null;
            measureFlight(remainingAttempts - 1);
          });
          return;
        }

        commitFlightBallWithoutAnimation();
        return;
      }

      // The stage uses CSS transform: scale(...) to fit the viewport.
      // getBoundingClientRect() returns post-scale (viewport) coordinates,
      // but position:absolute left/top and translate3d operate in the
      // pre-scale (local) coordinate space. Dividing by the scale factor
      // converts viewport measurements to local coordinates.
      const scale = playfieldRect.width / (playfieldElement.offsetWidth || playfieldRect.width) || 1;

      const geometry = resolveRailFlightGeometry(
        playfieldRect,
        outputBallRect,
        targetBallRect,
        scale,
      );

      outputSuppressedForActiveFlightRef.current = true;
      setSuppressedOutputBallNumber(queuedFlightBallNumber);
      setFlyingRailBall({
        number: queuedFlightBallNumber,
        targetIndex: queuedFlightTargetIndex,
        startX: geometry.startX,
        startY: geometry.startY,
        deltaX: geometry.deltaX,
        deltaY: geometry.deltaY,
        startSize: outputBallRect.width / scale,
        startScale: 0.22,
        endScale: targetBallRect.width / outputBallRect.width,
      });
    };

    // Try measuring synchronously in the layout effect (before the browser
    // paints) to avoid a single visible frame where the output ball is still
    // shown.  Fall back to rAF only when the DOM elements aren't ready yet.
    measureFlight();

    return () => {
      if (measureFlightFrameRef.current !== null) {
        window.cancelAnimationFrame(measureFlightFrameRef.current);
        measureFlightFrameRef.current = null;
      }
    };
  }, [bonusActive, flyingRailBall, queuedFlightBallNumber, queuedFlightTargetIndex]);

  useEffect(() => {
    if (!flyingRailBall) {
      return;
    }

    // If the flying-ball DOM element isn't available (extremely rare),
    // force-land immediately so the animation system never gets stuck.
    if (!flyingBallRef.current) {
      commitFlightBallWithoutAnimation();
      return;
    }

    const flyingElement = flyingBallRef.current;
    const travelDistance = Math.hypot(flyingRailBall.deltaX, flyingRailBall.deltaY);
    const flightDurationMs = resolveRailFlightDurationMs(travelDistance);
    const totalDurationMs = THEME1_RAIL_FLIGHT_HOLD_MS + flightDurationMs;
    let startTimeMs: number | null = null;
    let landed = false;

    const land = () => {
      if (landed) return;
      landed = true;

      if (flightSafetyTimeoutRef.current !== null) {
        window.clearTimeout(flightSafetyTimeoutRef.current);
        flightSafetyTimeoutRef.current = null;
      }

      const resolvedBalls = queuedFlightResolvedBallsRef.current ?? previousRecentBallsRef.current;
      queuedFlightResolvedBallsRef.current = null;
      const settledBallNumber = flyingRailBall.number;
      outputSuppressedForActiveFlightRef.current = false;
      landingSettleTimeoutRef.current = window.setTimeout(() => {
        landingSettleTimeoutRef.current = null;
        setRenderedRecentBalls(resolvedBalls);
        setHiddenRailBallIndex(null);
        setFlyingRailBall(null);
        setQueuedFlightBallNumber(null);
        setQueuedFlightTargetIndex(null);
        setSuppressedOutputBallNumber(null);
        onRailFlightSettledRef.current?.(settledBallNumber);
      }, THEME1_RAIL_FLIGHT_LANDING_OVERLAP_MS);
    };

    flyingElement.style.opacity = String(resolveRailFlightOpacity(0));
    flyingElement.style.transform = `translate(-50%, -50%) translate3d(0px, 0px, 0) scale(${flyingRailBall.startScale})`;

    // Safety timeout: if the normal animation loop never completes
    // (e.g. tab backgrounded, rAF paused), force-land after a ceiling.
    flightSafetyTimeoutRef.current = window.setTimeout(() => {
      flightSafetyTimeoutRef.current = null;
      land();
    }, THEME1_RAIL_FLIGHT_MAX_TOTAL_MS);

    const animate = (nowMs: number) => {
      if (landed) return;

      if (startTimeMs === null) {
        startTimeMs = nowMs;
      }

      const elapsedMs = nowMs - startTimeMs;
      const travelElapsedMs = Math.max(0, elapsedMs - THEME1_RAIL_FLIGHT_HOLD_MS);
      const travelProgress = clamp01(travelElapsedMs / flightDurationMs);
      const easedTravelProgress = resolveRailFlightProgress(travelProgress);
      const emergenceProgress = resolveRailFlightEmergenceProgress(
        elapsedMs,
        THEME1_RAIL_FLIGHT_HOLD_MS,
      );
      const arcLift = resolveRailFlightArcLift(
        easedTravelProgress,
        Math.hypot(flyingRailBall.deltaX, flyingRailBall.deltaY),
      );
      const scale = resolveRailFlightVisibleScale(
        emergenceProgress,
        easedTravelProgress,
        flyingRailBall.startScale,
        flyingRailBall.endScale,
      );
      const emergenceDriftY = emergenceProgress * (1 - easedTravelProgress) * 40;
      const x = flyingRailBall.deltaX * easedTravelProgress;
      const y = (flyingRailBall.deltaY * easedTravelProgress) - arcLift + emergenceDriftY;

      if (
        !outputSuppressedForActiveFlightRef.current &&
        elapsedMs >= THEME1_RAIL_FLIGHT_OUTPUT_OVERLAP_MS
      ) {
        outputSuppressedForActiveFlightRef.current = true;
        setSuppressedOutputBallNumber(flyingRailBall.number);
      }

      flyingElement.style.opacity = String(resolveRailFlightOpacity(emergenceProgress));
      flyingElement.style.transform = `translate(-50%, -50%) translate3d(${x}px, ${y}px, 0) scale(${scale})`;

      if (elapsedMs < totalDurationMs) {
        flightAnimationFrameRef.current = window.requestAnimationFrame(animate);
        return;
      }

      // Re-measure target position at landing for pixel-perfect alignment.
      const playfieldElement = playfieldRef.current;
      const targetElement = compactSlotRefsRef.current.get(flyingRailBall.targetIndex);
      if (playfieldElement && targetElement) {
        const pRect = playfieldElement.getBoundingClientRect();
        const tRect = targetElement.getBoundingClientRect();
        const landingScale = pRect.width / (playfieldElement.offsetWidth || pRect.width) || 1;
        const freshDeltaX = ((tRect.left - pRect.left) + (tRect.width * 0.5)) / landingScale - flyingRailBall.startX;
        const freshDeltaY = ((tRect.top - pRect.top) + (tRect.height * 0.5)) / landingScale - flyingRailBall.startY;
        flyingElement.style.opacity = "1";
        flyingElement.style.transform = `translate(-50%, -50%) translate3d(${freshDeltaX}px, ${freshDeltaY}px, 0) scale(${flyingRailBall.endScale})`;
      } else {
        flyingElement.style.opacity = "1";
        flyingElement.style.transform = `translate(-50%, -50%) translate3d(${flyingRailBall.deltaX}px, ${flyingRailBall.deltaY}px, 0) scale(${flyingRailBall.endScale})`;
      }

      land();
    };

    flightAnimationFrameRef.current = window.requestAnimationFrame(animate);

    return () => {
      if (flightAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(flightAnimationFrameRef.current);
        flightAnimationFrameRef.current = null;
      }
      // On cleanup (effect re-fire), force-land so the ball is never lost.
      land();
    };
  }, [flyingRailBall]);

  function registerCompactSlotRef(index: number, element: HTMLDivElement | null) {
    if (element) {
      compactSlotRefsRef.current.set(index, element);
      return;
    }

    compactSlotRefsRef.current.delete(index);
  }

  const flyingBallSpriteUrl = flyingRailBall ? getTheme1BallSpriteUrl(flyingRailBall.number) : null;

  return (
    <section
      ref={playfieldRef}
      className={`playfield${bonusActive ? " playfield--bonus-active" : ""}${usesIntegratedMachineScene ? " playfield--integrated-live" : ""}`.trim()}
    >
      <Theme1BoardPatternSprite />

      <div className="playfield__board-anchor playfield__board-anchor--top-left">
        {topBoards[0] ? (
          <Theme1BoardCard
            board={topBoards[0]}
            compact
            spotlightKind={
              celebration?.boardId === topBoards[0].id &&
              (celebration.kind === "near" || celebration.kind === "win")
                ? celebration.kind
                : null
            }
          />
        ) : null}
      </div>

      <div className="playfield__draw-anchor">
        <Theme1DrawStage
          machineVariant={machineVariant}
          meta={meta}
          recentBalls={recentBalls}
          featuredBall={featuredBall}
          featuredBallIsPending={featuredBallIsPending}
          celebration={celebration}
          flightOriginRef={machineFlightOriginRef}
          outputBallRef={machineOutputBallRef}
          suppressedOutputBallNumber={suppressedOutputBallNumber}
        />
      </div>

      <div className="playfield__board-anchor playfield__board-anchor--top-right">
        {topBoards[1] ? (
          <Theme1BoardCard
            board={topBoards[1]}
            compact
            spotlightKind={
              celebration?.boardId === topBoards[1].id &&
              (celebration.kind === "near" || celebration.kind === "win")
                ? celebration.kind
                : null
            }
          />
        ) : null}
      </div>

      <div className="playfield__board-anchor playfield__board-anchor--bottom-left">
        {bottomBoards[0] ? (
          <Theme1BoardCard
            board={bottomBoards[0]}
            compact
            spotlightKind={
              celebration?.boardId === bottomBoards[0].id &&
              (celebration.kind === "near" || celebration.kind === "win")
                ? celebration.kind
                : null
            }
          />
        ) : null}
      </div>

      <div className="playfield__board-anchor playfield__board-anchor--bottom-right">
        {bottomBoards[1] ? (
          <Theme1BoardCard
            board={bottomBoards[1]}
            compact
            spotlightKind={
              celebration?.boardId === bottomBoards[1].id &&
              (celebration.kind === "near" || celebration.kind === "win")
                ? celebration.kind
                : null
            }
          />
        ) : null}
      </div>

      {showHudControls ? (
        <div className="playfield__controls-row">
          <Theme1HudRack
            hud={hud}
            drawCountLabel={`${meta.drawCount} / 30`}
            stakeBusy={stakeBusy}
            rerollBusy={rerollBusy}
            betBusy={betBusy}
            isBetArmed={isBetArmed}
            onDecreaseStake={onDecreaseStake}
            onIncreaseStake={onIncreaseStake}
            onShuffle={onShuffle}
            onPlaceBet={onPlaceBet}
            onOpenBonusTest={onOpenBonusTest}
          />
        </div>
      ) : null}

      {!bonusActive && showCountdownPanel && hud.nesteTrekkOm.trim().length > 0 ? (
        <div className="playfield__countdown-anchor">
          <Theme1CountdownPanel countdown={hud.nesteTrekkOm} />
        </div>
      ) : null}

      {!bonusActive && showBallRail ? (
        <div className="playfield__ball-rail-anchor">
          <Theme1BallRail
            featuredBall={featuredBall}
            featuredBallIsPending={featuredBallIsPending}
            balls={renderedRecentBalls}
            compact
            hiddenCompactBallIndex={hiddenRailBallIndex}
            onCompactSlotRef={registerCompactSlotRef}
          />
        </div>
      ) : null}

      {flyingRailBall ? (
        <div
          ref={flyingBallRef}
          className="playfield__flying-ball"
          style={{
            left: `${flyingRailBall.startX}px`,
            top: `${flyingRailBall.startY}px`,
            width: `${flyingRailBall.startSize}px`,
            height: `${flyingRailBall.startSize}px`,
            opacity: resolveRailFlightOpacity(0),
            transform: `translate(-50%, -50%) translate3d(0px, 0px, 0) scale(${flyingRailBall.startScale})`,
          }}
          aria-hidden="true"
        >
          {flyingBallSpriteUrl ? (
            <img src={flyingBallSpriteUrl} alt="" />
          ) : (
            <span>{flyingRailBall.number}</span>
          )}
        </div>
      ) : null}

      <Theme1BonusOverlay
        bonus={bonus}
        onSelectSlot={onSelectBonusSlot}
        onReset={onResetBonusTest}
        onClose={onCloseBonusTest}
      />
    </section>
  );
}

function Theme1DrawStage({
  machineVariant,
  meta,
  recentBalls,
  featuredBall,
  featuredBallIsPending,
  celebration,
  flightOriginRef,
  outputBallRef,
  suppressedOutputBallNumber,
}: {
  machineVariant: "standalone" | "integrated-live";
  meta: Theme1RoundMeta;
  recentBalls: number[];
  featuredBall: number | null;
  featuredBallIsPending: boolean;
  celebration: Theme1CelebrationState | null;
  flightOriginRef: RefObject<HTMLDivElement | null>;
  outputBallRef: RefObject<HTMLDivElement | null>;
  suppressedOutputBallNumber: number | null;
}) {
  return (
    <section className={`draw-stage${machineVariant === "integrated-live" ? " draw-stage--integrated-live" : ""}`.trim()}>
      <Theme1DrawMachine
        drawCount={meta.drawCount}
        featuredBallNumber={featuredBall}
        featuredBallIsPending={featuredBallIsPending}
        recentBalls={recentBalls}
        variant={machineVariant}
        flightOriginRef={flightOriginRef}
        outputBallRef={outputBallRef}
        suppressedOutputBallNumber={suppressedOutputBallNumber}
      />

      {celebration ? (
        <article
          className={`draw-stage__celebration draw-stage__celebration--${celebration.kind}`.trim()}
          aria-live="polite"
        >
          <span className="draw-stage__celebration-eyebrow">{celebration.subtitle}</span>
          <strong className="draw-stage__celebration-title">{celebration.title}</strong>
          <span className="draw-stage__celebration-amount">{celebration.amount}</span>
          {celebration.details?.length ? (
            <div className="draw-stage__celebration-details">
              {celebration.details.map((detail) => (
                <span key={detail}>{detail}</span>
              ))}
            </div>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}

function sharesBallPrefix(previousBalls: readonly number[], currentBalls: readonly number[]) {
  if (currentBalls.length < previousBalls.length) {
    return false;
  }

  return previousBalls.every((ball, index) => currentBalls[index] === ball);
}

function areBallArraysEqual(left: readonly number[], right: readonly number[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => right[index] === value);
}

function queueRecentBallsSnapshot(queue: number[][], nextSnapshot: readonly number[]) {
  const previousQueuedSnapshot = queue[queue.length - 1];
  if (previousQueuedSnapshot && areBallArraysEqual(previousQueuedSnapshot, nextSnapshot)) {
    return;
  }

  // Cap the queue so it never grows unbounded during network bursts.
  // Keep only the most recent entries — older ones are stale anyway.
  while (queue.length >= THEME1_ANIMATION_QUEUE_MAX_SIZE) {
    queue.shift();
  }

  queue.push([...nextSnapshot]);
}

function applyRecentBallsSnapshot(
  previousBalls: readonly number[],
  currentBalls: readonly number[],
  handlers: {
    setRenderedRecentBalls: (balls: number[]) => void;
    setHiddenRailBallIndex: (index: number | null) => void;
    setQueuedFlightBallNumber: (ballNumber: number | null) => void;
    setQueuedFlightTargetIndex: (index: number | null) => void;
    setSuppressedOutputBallNumber: (ballNumber: number | null) => void;
    setFlyingRailBall: (ball: Theme1FlyingRailBallState | null) => void;
    queuedFlightResolvedBallsRef: { current: number[] | null };
  },
) {
  const nextRailState = resolveRailPresentationState(previousBalls, currentBalls);

  if (currentBalls.length === 0 || currentBalls.length < previousBalls.length || !sharesBallPrefix(previousBalls, currentBalls)) {
    handlers.queuedFlightResolvedBallsRef.current = null;
    handlers.setRenderedRecentBalls(nextRailState.renderedBalls);
    handlers.setHiddenRailBallIndex(null);
    handlers.setQueuedFlightBallNumber(null);
    handlers.setQueuedFlightTargetIndex(null);
    handlers.setSuppressedOutputBallNumber(null);
    handlers.setFlyingRailBall(null);
    return;
  }

  if (nextRailState.queuedBallNumber !== null && nextRailState.queuedTargetIndex !== null) {
    handlers.queuedFlightResolvedBallsRef.current = [...currentBalls];
    handlers.setRenderedRecentBalls(nextRailState.renderedBalls);
    handlers.setHiddenRailBallIndex(nextRailState.queuedTargetIndex);
    handlers.setQueuedFlightBallNumber(nextRailState.queuedBallNumber);
    handlers.setQueuedFlightTargetIndex(nextRailState.queuedTargetIndex);
    handlers.setSuppressedOutputBallNumber(null);
    handlers.setFlyingRailBall(null);
    return;
  }

  handlers.queuedFlightResolvedBallsRef.current = null;
  handlers.setRenderedRecentBalls(nextRailState.renderedBalls);
}

function resolveSingleAppendedBall(previousBalls: readonly number[], currentBalls: readonly number[]) {
  if (!sharesBallPrefix(previousBalls, currentBalls) || currentBalls.length !== previousBalls.length + 1) {
    return null;
  }

  return currentBalls[currentBalls.length - 1] ?? null;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function resolveRailFlightDurationMs(travelDistance: number) {
  void travelDistance;
  return THEME1_RAIL_FLIGHT_DURATION_MS;
}

export function resolveRailFlightVisibleScale(
  emergenceProgress: number,
  travelProgress: number,
  startScale: number,
  endScale: number,
) {
  const emergedScale = lerp(startScale, 1, clamp01(emergenceProgress));
  return lerp(emergedScale, endScale, clamp01(travelProgress));
}

export function resolveRailFlightProgress(travelProgress: number) {
  const normalizedProgress = clamp01(travelProgress);
  if (normalizedProgress < 0.5) {
    return 4 * normalizedProgress * normalizedProgress * normalizedProgress;
  }

  const inverse = (-2 * normalizedProgress) + 2;
  return 1 - ((inverse * inverse * inverse) / 2);
}

export function resolveRailFlightArcLift(
  travelProgress: number,
  travelDistance: number,
) {
  void travelDistance;
  const normalizedProgress = clamp01(travelProgress);
  const arcPeak = 34;
  return Math.sin(normalizedProgress * Math.PI) * arcPeak;
}

export function resolveRailFlightEmergenceProgress(
  elapsedMs: number,
  holdMs: number,
) {
  const emergenceWindowMs = Math.max(220, holdMs * 0.9);
  return clamp01(elapsedMs / emergenceWindowMs);
}

export function resolveRailFlightOpacity(emergenceProgress: number) {
  // Fade in during the first 30% of emergence to avoid a visible "blink"
  // when the flying ball first appears as a tiny dot.
  if (emergenceProgress >= 0.3) return 1;
  return clamp01(emergenceProgress / 0.3);
}

export function resolveRailPresentationState(
  previousBalls: readonly number[],
  currentBalls: readonly number[],
): Theme1RailPresentationState {
  const appendedBall = resolveSingleAppendedBall(previousBalls, currentBalls);
  if (appendedBall !== null) {
    // Single ball appended — animate it, show previous balls immediately
    return {
      renderedBalls: [...previousBalls],
      queuedBallNumber: appendedBall,
      queuedTargetIndex: Math.min(currentBalls.length, 30) - 1,
    };
  }

  // Multiple balls added (resync). Animate the last new ball if there is
  // one, and render the rest immediately so we never skip animation entirely.
  if (currentBalls.length > previousBalls.length && currentBalls.length > 0) {
    const lastBall = currentBalls[currentBalls.length - 1]!;
    const renderedWithoutLast = currentBalls.slice(0, -1);
    return {
      renderedBalls: [...renderedWithoutLast],
      queuedBallNumber: lastBall,
      queuedTargetIndex: Math.min(currentBalls.length, 30) - 1,
    };
  }

  return {
    renderedBalls: [...currentBalls],
    queuedBallNumber: null,
    queuedTargetIndex: null,
  };
}

export function resolveRailFlightGeometry(
  playfieldRect: Pick<DOMRect, "left" | "top">,
  outputBallRect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  targetBallRect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  scale = 1,
): Theme1RailFlightGeometry {
  // All DOMRect values are in viewport (post-scale) space.
  // Dividing by scale converts them to local (pre-scale) coordinates
  // so that position:absolute left/top and translate3d work correctly.
  // The start offset is a design constant already in local space.
  const startX =
    ((outputBallRect.left - playfieldRect.left) +
    (outputBallRect.width * 0.5)) / scale +
    THEME1_RAIL_FLIGHT_START_OFFSET_X_PX;
  const startY =
    ((outputBallRect.top - playfieldRect.top) +
    (outputBallRect.height * 0.5)) / scale +
    THEME1_RAIL_FLIGHT_START_OFFSET_Y_PX;
  const targetCenterX =
    ((targetBallRect.left - playfieldRect.left) +
    (targetBallRect.width * 0.5)) / scale;
  const targetCenterY =
    ((targetBallRect.top - playfieldRect.top) +
    (targetBallRect.height * 0.5)) / scale;

  return {
    startX,
    startY,
    deltaX: targetCenterX - startX,
    deltaY: targetCenterY - startY,
  };
}

function lerp(start: number, end: number, progress: number) {
  return start + ((end - start) * progress);
}
