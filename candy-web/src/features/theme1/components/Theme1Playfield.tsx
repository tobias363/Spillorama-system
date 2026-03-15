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
}

interface Theme1FlyingRailBallState {
  number: number;
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
  startSize: number;
  endScale: number;
}

const THEME1_RAIL_FLIGHT_HOLD_MS = 1000;
const THEME1_RAIL_FLIGHT_SPEED_PX_PER_MS = 0.07;
const THEME1_RAIL_FLIGHT_MIN_DURATION_MS = 1800;
const THEME1_RAIL_FLIGHT_MAX_DURATION_MS = 4600;

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
}: Theme1PlayfieldProps) {
  const topBoards = boards.slice(0, 2);
  const bottomBoards = boards.slice(2, 4);
  const usesIntegratedMachineScene = !bonusActive;
  const machineVariant = usesIntegratedMachineScene ? "integrated-live" : "standalone";
  const playfieldRef = useRef<HTMLElement | null>(null);
  const machineOutputBallRef = useRef<HTMLDivElement | null>(null);
  const flyingBallRef = useRef<HTMLDivElement | null>(null);
  const compactBallRefsRef = useRef(new Map<number, HTMLDivElement>());
  const previousDisplayedRecentBallsRef = useRef(displayedRecentBalls);
  const measureFlightFrameRef = useRef<number | null>(null);
  const flightAnimationFrameRef = useRef<number | null>(null);
  const [hiddenRailBallNumber, setHiddenRailBallNumber] = useState<number | null>(null);
  const [queuedFlightBallNumber, setQueuedFlightBallNumber] = useState<number | null>(null);
  const [suppressedOutputBallNumber, setSuppressedOutputBallNumber] = useState<number | null>(null);
  const [flyingRailBall, setFlyingRailBall] = useState<Theme1FlyingRailBallState | null>(null);

  useEffect(() => {
    return () => {
      if (measureFlightFrameRef.current !== null) {
        window.cancelAnimationFrame(measureFlightFrameRef.current);
      }
      if (flightAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(flightAnimationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const previousBalls = previousDisplayedRecentBallsRef.current;
    const currentBalls = displayedRecentBalls;
    const appendedBall = resolveSingleAppendedBall(previousBalls, currentBalls);

    if (currentBalls.length === 0 || currentBalls.length < previousBalls.length || !sharesBallPrefix(previousBalls, currentBalls)) {
      setHiddenRailBallNumber(null);
      setQueuedFlightBallNumber(null);
      setSuppressedOutputBallNumber(null);
      setFlyingRailBall(null);
    } else if (appendedBall !== null) {
      setHiddenRailBallNumber(appendedBall);
      setQueuedFlightBallNumber(appendedBall);
      setSuppressedOutputBallNumber(null);
      setFlyingRailBall(null);
    }

    previousDisplayedRecentBallsRef.current = currentBalls;
  }, [displayedRecentBalls]);

  useLayoutEffect(() => {
    if (bonusActive || queuedFlightBallNumber === null || flyingRailBall !== null) {
      return;
    }

    const measureFlight = (remainingAttempts = 16) => {
      const playfieldElement = playfieldRef.current;
      const outputBallElement = machineOutputBallRef.current;
      const targetBallElement = compactBallRefsRef.current.get(queuedFlightBallNumber);

      if (!playfieldElement || !outputBallElement || !targetBallElement) {
        if (remainingAttempts > 0) {
          measureFlightFrameRef.current = window.requestAnimationFrame(() => {
            measureFlightFrameRef.current = null;
            measureFlight(remainingAttempts - 1);
          });
          return;
        }

        setHiddenRailBallNumber(null);
        setQueuedFlightBallNumber(null);
        setSuppressedOutputBallNumber(null);
        return;
      }

      const playfieldRect = playfieldElement.getBoundingClientRect();
      const outputBallRect = outputBallElement.getBoundingClientRect();
      const targetBallRect = targetBallElement.getBoundingClientRect();

      if (outputBallRect.width === 0 || targetBallRect.width === 0) {
        if (remainingAttempts > 0) {
          measureFlightFrameRef.current = window.requestAnimationFrame(() => {
            measureFlightFrameRef.current = null;
            measureFlight(remainingAttempts - 1);
          });
          return;
        }

        setHiddenRailBallNumber(null);
        setQueuedFlightBallNumber(null);
        setSuppressedOutputBallNumber(null);
        return;
      }

      setFlyingRailBall({
        number: queuedFlightBallNumber,
        startX: (outputBallRect.left - playfieldRect.left) + (outputBallRect.width * 0.5),
        startY: (outputBallRect.top - playfieldRect.top) + (outputBallRect.height * 0.5),
        deltaX: (targetBallRect.left - outputBallRect.left) + ((targetBallRect.width - outputBallRect.width) * 0.5),
        deltaY: (targetBallRect.top - outputBallRect.top) + ((targetBallRect.height - outputBallRect.height) * 0.5),
        startSize: outputBallRect.width,
        endScale: targetBallRect.width / outputBallRect.width,
      });
      setSuppressedOutputBallNumber(queuedFlightBallNumber);
    };

    measureFlightFrameRef.current = window.requestAnimationFrame(() => {
      measureFlightFrameRef.current = null;
      measureFlight();
    });

    return () => {
      if (measureFlightFrameRef.current !== null) {
        window.cancelAnimationFrame(measureFlightFrameRef.current);
        measureFlightFrameRef.current = null;
      }
    };
  }, [bonusActive, flyingRailBall, queuedFlightBallNumber]);

  useEffect(() => {
    if (!flyingRailBall || !flyingBallRef.current) {
      return;
    }

    const flyingElement = flyingBallRef.current;
    const travelDistance = Math.hypot(flyingRailBall.deltaX, flyingRailBall.deltaY);
    const flightDurationMs = resolveRailFlightDurationMs(travelDistance);
    const totalDurationMs = THEME1_RAIL_FLIGHT_HOLD_MS + flightDurationMs;
    let startTimeMs: number | null = null;

    flyingElement.style.opacity = "1";
    flyingElement.style.transform = "translate(-50%, -50%) translate3d(0px, 0px, 0) scale(1)";

    const animate = (nowMs: number) => {
      if (startTimeMs === null) {
        startTimeMs = nowMs;
      }

      const elapsedMs = nowMs - startTimeMs;
      const travelElapsedMs = Math.max(0, elapsedMs - THEME1_RAIL_FLIGHT_HOLD_MS);
      const travelProgress = clamp01(travelElapsedMs / flightDurationMs);
      const scale = resolveRailFlightVisibleScale(travelProgress, flyingRailBall.endScale);
      const x = flyingRailBall.deltaX * travelProgress;
      const y = flyingRailBall.deltaY * travelProgress;

      flyingElement.style.transform = `translate(-50%, -50%) translate3d(${x}px, ${y}px, 0) scale(${scale})`;

      if (elapsedMs < totalDurationMs) {
        flightAnimationFrameRef.current = window.requestAnimationFrame(animate);
        return;
      }

      setFlyingRailBall(null);
      setHiddenRailBallNumber(null);
      setQueuedFlightBallNumber(null);
    };

    flightAnimationFrameRef.current = window.requestAnimationFrame(animate);

    return () => {
      if (flightAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(flightAnimationFrameRef.current);
        flightAnimationFrameRef.current = null;
      }
    };
  }, [flyingRailBall]);

  function registerCompactBallRef(ball: number, element: HTMLDivElement | null) {
    if (element) {
      compactBallRefsRef.current.set(ball, element);
      return;
    }

    compactBallRefsRef.current.delete(ball);
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

      {!bonusActive && hud.nesteTrekkOm.trim().length > 0 ? (
        <div className="playfield__countdown-anchor">
          <Theme1CountdownPanel countdown={hud.nesteTrekkOm} />
        </div>
      ) : null}

      {!bonusActive && displayedRecentBalls.length > 0 ? (
        <div className="playfield__ball-rail-anchor">
          <Theme1BallRail
            featuredBall={featuredBall}
            featuredBallIsPending={featuredBallIsPending}
            balls={displayedRecentBalls}
            compact
            hiddenCompactBallNumber={hiddenRailBallNumber}
            onCompactBallRef={registerCompactBallRef}
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
  outputBallRef,
  suppressedOutputBallNumber,
}: {
  machineVariant: "standalone" | "integrated-live";
  meta: Theme1RoundMeta;
  recentBalls: number[];
  featuredBall: number | null;
  featuredBallIsPending: boolean;
  celebration: Theme1CelebrationState | null;
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
  return clamp(
    travelDistance / THEME1_RAIL_FLIGHT_SPEED_PX_PER_MS,
    THEME1_RAIL_FLIGHT_MIN_DURATION_MS,
    THEME1_RAIL_FLIGHT_MAX_DURATION_MS,
  );
}

export function resolveRailFlightVisibleScale(
  travelProgress: number,
  endScale: number,
) {
  return lerp(1, endScale, clamp01(travelProgress));
}

function lerp(start: number, end: number, progress: number) {
  return start + ((end - start) * progress);
}
