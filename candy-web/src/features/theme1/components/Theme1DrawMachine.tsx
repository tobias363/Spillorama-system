import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import {
  THEME1_MACHINE_ANCHORS,
  THEME1_MACHINE_TIMINGS,
  deriveTheme1MachinePresentationState,
  type Theme1MachineAnchors,
  type Theme1MachineBallState,
  type Theme1MachinePhase,
} from "@/domain/theme1/theme1MachineAnimation";
import { getTheme1BallSpriteUrl } from "@/features/theme1/data/theme1BallSprites";
import glassMachineUrl from "../../../../bilder/sisteglass 1.png";
import integratedSceneUrl from "../../../../bilder/ny bakgrunn.jpg";
import "./theme1DrawMachine.css";

type Theme1DrawMachineVariant = "standalone" | "integrated-scene" | "integrated-live";

interface Theme1DrawMachineProps {
  drawCount: number;
  featuredBallNumber: number | null;
  featuredBallIsPending: boolean;
  recentBalls: readonly number[];
  variant?: Theme1DrawMachineVariant;
  outputBallRef?: RefObject<HTMLDivElement | null>;
  flightOriginRef?: RefObject<HTMLDivElement | null>;
  suppressedOutputBallNumber?: number | null;
}

interface Theme1MachineLayout {
  sceneWidth: number;
  sceneHeight: number;
  clusterWidth: number;
  clusterHeight: number;
  clusterLeft: number;
  clusterTop: number;
  cupX: number;
  cupY: number;
  holeX: number;
  holeY: number;
  outputX: number;
  outputY: number;
  floorEdgePct: number;
  floorCenterPct: number;
  topInsetPx: number;
}

interface Theme1MachineSequenceState {
  drawNumber: number;
  startTimeMs: number;
  ejectStartX: number;
  ejectStartY: number;
  completed: boolean;
}

interface Theme1MachineVisualPreset {
  anchors: Theme1MachineAnchors;
  frameImageUrl: string;
  ballRadiusScale: number;
  sceneMaxWidth: string;
  sceneAspectRatio: string;
  sceneShadow: string;
  baseOpacity: string;
  glassOpacity: string;
  globeAuraOpacity: string;
  glassClipPath: string;
  chuteClipPath: string;
  chuteOpacity: string;
  floatingBallSize: string;
  outputBallSize: string;
  suctionColumnTop: string;
  suctionColumnWidth: string;
  suctionColumnHeight: string;
  suctionGlowTop: string;
  suctionGlowWidth: string;
  emergeTrailTop: string;
  emergeTrailWidth: string;
  emergeTrailHeight: string;
  emergeRingTop: string;
  emergeRingWidth: string;
  emergeBurstTop: string;
  emergeBurstWidth: string;
  floorEdgePct: number;
  floorCenterPct: number;
  topInsetPx: number;
}

const ALL_MACHINE_BALL_NUMBERS = Array.from({ length: 60 }, (_, index) => index + 1);
const MOTION_SEED = 31;
const BALL_MOTION_SPEED_MULTIPLIER = 1.9;
const BALL_AREA_EXPANSION_PX = 5;
const INTEGRATED_SCENE_ANCHORS: Theme1MachineAnchors = Object.freeze({
  clusterLeftPct: 41.35,
  clusterTopPct: 24.05,
  clusterWidthPct: 17.35,
  clusterHeightPct: 25.95,
  cupXPct: 50,
  cupYPct: 50.45,
  holeXPct: 50,
  holeYPct: 56.9,
  outputXPct: 50,
  outputYPct: 62.7,
});
const INTEGRATED_LIVE_ANCHORS: Theme1MachineAnchors = Object.freeze({
  ...THEME1_MACHINE_ANCHORS,
  outputXPct: 50,
  outputYPct: 84.8,
});
const THEME1_DRAW_MACHINE_PRESETS: Record<Theme1DrawMachineVariant, Theme1MachineVisualPreset> = {
  standalone: {
    anchors: THEME1_MACHINE_ANCHORS,
    frameImageUrl: glassMachineUrl,
    ballRadiusScale: 1,
    sceneMaxWidth: "320px",
    sceneAspectRatio: "909 / 1109",
    sceneShadow: "drop-shadow(0 22px 34px rgba(91, 7, 60, 0.18))",
    baseOpacity: "0.96",
    glassOpacity: "0.36",
    globeAuraOpacity: "1",
    glassClipPath: "ellipse(42.8% 35.1% at 50% 36.4%)",
    chuteClipPath: "inset(69% 30% 2% 30%)",
    chuteOpacity: "1",
    floatingBallSize: "60.564%",
    outputBallSize: "60.564%",
    suctionColumnTop: "34%",
    suctionColumnWidth: "18%",
    suctionColumnHeight: "30%",
    suctionGlowTop: "62.8%",
    suctionGlowWidth: "16%",
    emergeTrailTop: "55.8%",
    emergeTrailWidth: "17%",
    emergeTrailHeight: "14%",
    emergeRingTop: "63.9%",
    emergeRingWidth: "18.8%",
    emergeBurstTop: "71.8%",
    emergeBurstWidth: "24%",
    floorEdgePct: 0.72,
    floorCenterPct: 0.895,
    topInsetPx: 0,
  },
  "integrated-scene": {
    anchors: INTEGRATED_SCENE_ANCHORS,
    frameImageUrl: integratedSceneUrl,
    ballRadiusScale: 0.9,
    sceneMaxWidth: "100%",
    sceneAspectRatio: "1536 / 1024",
    sceneShadow: "drop-shadow(0 30px 48px rgba(91, 7, 60, 0.16))",
    baseOpacity: "1",
    glassOpacity: "0",
    globeAuraOpacity: "0.02",
    glassClipPath: "ellipse(10.15% 15.35% at 50% 36.9%)",
    chuteClipPath: "inset(46.6% 41.6% 34.1% 41.6%)",
    chuteOpacity: "0",
    floatingBallSize: "18.4%",
    outputBallSize: "18.4%",
    suctionColumnTop: "37.2%",
    suctionColumnWidth: "8.6%",
    suctionColumnHeight: "19.2%",
    suctionGlowTop: "54.2%",
    suctionGlowWidth: "8.1%",
    emergeTrailTop: "49.8%",
    emergeTrailWidth: "8.8%",
    emergeTrailHeight: "13.2%",
    emergeRingTop: "57.25%",
    emergeRingWidth: "9.6%",
    emergeBurstTop: "62.15%",
    emergeBurstWidth: "12.1%",
    floorEdgePct: 0.775,
    floorCenterPct: 0.982,
    topInsetPx: 10,
  },
  "integrated-live": {
    anchors: INTEGRATED_LIVE_ANCHORS,
    frameImageUrl: glassMachineUrl,
    ballRadiusScale: 1,
    sceneMaxWidth: "267px",
    sceneAspectRatio: "820 / 1024",
    sceneShadow: "drop-shadow(0 18px 28px rgba(91, 7, 60, 0.18))",
    baseOpacity: "0.97",
    glassOpacity: "0.34",
    globeAuraOpacity: "0.88",
    glassClipPath: "ellipse(42.8% 35.1% at 50% 36.4%)",
    chuteClipPath: "inset(69% 30% 2% 30%)",
    chuteOpacity: "1",
    floatingBallSize: "22%",
    outputBallSize: "60.564%",
    suctionColumnTop: "34%",
    suctionColumnWidth: "18%",
    suctionColumnHeight: "30%",
    suctionGlowTop: "62.8%",
    suctionGlowWidth: "16%",
    emergeTrailTop: "55.8%",
    emergeTrailWidth: "17%",
    emergeTrailHeight: "14%",
    emergeRingTop: "63.9%",
    emergeRingWidth: "18.8%",
    emergeBurstTop: "71.8%",
    emergeBurstWidth: "24%",
    floorEdgePct: 0.72,
    floorCenterPct: 0.895,
    topInsetPx: 30,
  },
};

export function Theme1DrawMachine({
  drawCount,
  featuredBallNumber,
  featuredBallIsPending,
  recentBalls,
  variant = "standalone",
  outputBallRef,
  flightOriginRef,
  suppressedOutputBallNumber = null,
}: Theme1DrawMachineProps) {
  const preset = THEME1_DRAW_MACHINE_PRESETS[variant];
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const globeRigRef = useRef<HTMLDivElement | null>(null);
  const clusterRef = useRef<HTMLDivElement | null>(null);
  const clusterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const holeMaskRef = useRef<HTMLDivElement | null>(null);
  const ejectBallRef = useRef<HTMLDivElement | null>(null);
  const ballImageCacheRef = useRef(new Map<number, HTMLImageElement>());
  const layoutRef = useRef<Theme1MachineLayout | null>(null);
  const modelsRef = useRef(new Map<number, Theme1MachineBallState>());
  const hiddenBallNumbersRef = useRef(new Set<number>());
  const activeSequenceRef = useRef<Theme1MachineSequenceState | null>(null);
  const phaseRef = useRef<Theme1MachinePhase>("idle");
  const previousPendingNumberRef = useRef<number | null>(null);
  const previousDrawCountRef = useRef(drawCount);
  const previousRecentSignatureRef = useRef(recentBalls.join(","));
  const outputBallNumberRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const [ejectBallNumber, setEjectBallNumber] = useState<number | null>(null);
  const [outputBallNumber, setOutputBallNumber] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!sceneRef.current || !clusterRef.current) {
      return;
    }

    const sceneElement = sceneRef.current;
    const clusterElement = clusterRef.current;

    const syncLayout = () => {
      layoutRef.current = measureMachineLayout(
        sceneElement,
        clusterElement,
        preset.anchors,
        preset.floorEdgePct,
        preset.floorCenterPct,
        preset.topInsetPx,
      );
      syncClusterCanvasResolution(clusterCanvasRef.current, layoutRef.current);
      initializeMachineModels(modelsRef.current, layoutRef.current, preset.ballRadiusScale);
      applyStableMachineState({
        featuredBallNumber,
        featuredBallIsPending,
        recentBalls,
      });
    };

    syncLayout();

    const resizeObserver = new ResizeObserver(() => {
      syncLayout();
    });

    resizeObserver.observe(sceneElement);
    resizeObserver.observe(clusterElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [preset.anchors, featuredBallIsPending, featuredBallNumber, recentBalls]);

  useEffect(() => {
    const imageCache = new Map<number, HTMLImageElement>();

    for (const number of ALL_MACHINE_BALL_NUMBERS) {
      const url = getTheme1BallSpriteUrl(number);
      if (!url) {
        continue;
      }

      const image = new Image();
      image.decoding = "async";
      image.src = url;
      imageCache.set(number, image);
    }

    ballImageCacheRef.current = imageCache;

    return () => {
      ballImageCacheRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const tick = (nowMs: number) => {
      const lastTimeMs = lastFrameTimeRef.current ?? nowMs;
      const deltaSeconds = Math.min((nowMs - lastTimeMs) / 1000, 1 / 24);
      lastFrameTimeRef.current = nowMs;

      animateMachineFrame(nowMs, deltaSeconds);
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!layoutRef.current) {
      return;
    }

    const pendingNumber = normalizeBallNumber(featuredBallNumber);
    const pendingNumberChanged = pendingNumber !== previousPendingNumberRef.current;
    const isRoundReset =
      drawCount < previousDrawCountRef.current ||
      recentBalls.length < recentBallsFromSignature(previousRecentSignatureRef.current).length;

    if (isRoundReset) {
      applyStableMachineState({
        featuredBallNumber,
        featuredBallIsPending,
        recentBalls,
      });
      previousPendingNumberRef.current = pendingNumber;
      previousDrawCountRef.current = drawCount;
      previousRecentSignatureRef.current = recentBalls.join(",");
      return;
    }

    if (
      featuredBallIsPending &&
      pendingNumber !== null &&
      pendingNumberChanged &&
      previousPendingNumberRef.current === null
    ) {
      beginPendingSequence(pendingNumber);
    } else if (!featuredBallIsPending && pendingNumberChanged) {
      applyStableMachineState({
        featuredBallNumber,
        featuredBallIsPending,
        recentBalls,
      });
    }

    previousPendingNumberRef.current = pendingNumber;
    previousDrawCountRef.current = drawCount;
    previousRecentSignatureRef.current = recentBalls.join(",");
  }, [drawCount, featuredBallIsPending, featuredBallNumber, recentBalls]);

  function beginPendingSequence(drawNumber: number) {
    const layout = layoutRef.current;
    const ball = modelsRef.current.get(drawNumber);
    if (!layout || !ball) {
      return;
    }

    activeSequenceRef.current = {
      drawNumber,
      startTimeMs: performance.now(),
      ejectStartX: layout.clusterLeft + ball.x,
      ejectStartY: layout.clusterTop + ball.y,
      completed: false,
    };
    phaseRef.current = "mix";
    outputBallNumberRef.current = null;
    setOutputBallNumber(null);
    setEjectBallNumber(drawNumber);
  }

  function applyStableMachineState(input: {
    featuredBallNumber: number | null;
    featuredBallIsPending: boolean;
    recentBalls: readonly number[];
  }) {
    const presentation = deriveTheme1MachinePresentationState(input);
    hiddenBallNumbersRef.current = new Set(
      ALL_MACHINE_BALL_NUMBERS.filter(
        (number) => !presentation.availableBallNumbers.includes(number),
      ),
    );
    activeSequenceRef.current = null;
    phaseRef.current = input.featuredBallIsPending ? "hold" : "idle";
    outputBallNumberRef.current = presentation.outputBallNumber;
    setEjectBallNumber(null);
    setOutputBallNumber(presentation.outputBallNumber);
  }

  function animateMachineFrame(nowMs: number, deltaSeconds: number) {
    const layout = layoutRef.current;
    if (!layout) {
      return;
    }

    const sequence = activeSequenceRef.current;
    let mixBoost = 0;
    let phase: Theme1MachinePhase = "idle";

    if (sequence) {
      const elapsedMs = Math.max(0, nowMs - sequence.startTimeMs);
      phase = resolvePhaseForElapsedMs(elapsedMs);
      phaseRef.current = phase;
      mixBoost = resolveMixBoostForPhase(phase, elapsedMs);
      updateEjectBall(nowMs, phase, sequence, layout);

      const drawBall = modelsRef.current.get(sequence.drawNumber);
      if (drawBall && phase !== "mix") {
        hiddenBallNumbersRef.current.add(sequence.drawNumber);
      }

      if (elapsedMs >= THEME1_MACHINE_TIMINGS.totalMs && !sequence.completed) {
        sequence.completed = true;
        activeSequenceRef.current = null;
        phaseRef.current = "hold";
        outputBallNumberRef.current = sequence.drawNumber;
        setEjectBallNumber(null);
        setOutputBallNumber(sequence.drawNumber);
      }
    } else if (outputBallNumberRef.current !== null) {
      phase = "hold";
    }

    updateGlobeRig(nowMs, mixBoost);
    updateClusterBalls(nowMs, deltaSeconds, layout, mixBoost, sequence ?? null, phase);
    updateOutputBall();
  }

  function updateClusterBalls(
    nowMs: number,
    deltaSeconds: number,
    layout: Theme1MachineLayout,
    mixBoost: number,
    sequence: Theme1MachineSequenceState | null,
    phase: Theme1MachinePhase,
  ) {
    const motionTime = nowMs / 1000;
    const activeDrawNumber = sequence?.drawNumber ?? null;
    const visibleBalls: Theme1MachineBallState[] = [];
    for (const ball of ALL_MACHINE_BALL_NUMBERS) {
      const model = modelsRef.current.get(ball);
      if (!model) {
        continue;
      }

      if (hiddenBallNumbersRef.current.has(ball) || (activeDrawNumber === ball && phase !== "mix")) {
        continue;
      }

      visibleBalls.push(model);
    }

    const tremorStrength = phase === "mix" ? 1 : 0.2;
    const clusterShake = {
      x:
        (Math.sin((motionTime * 5.18) + 0.31) + Math.sin((motionTime * 7.42) + 1.62) * 0.34) *
        3.8 *
        tremorStrength *
        (0.18 + mixBoost * 0.48),
      y:
        (Math.cos((motionTime * 4.84) + 0.92) + Math.sin((motionTime * 6.18) + 2.24) * 0.28) *
        4.4 *
        tremorStrength *
        (0.18 + mixBoost * 0.5),
    };

    const solverSteps = phase === "mix" ? 4 : 3;
    const stepSeconds = deltaSeconds / solverSteps;
    const mixProgress =
      sequence && phase === "mix"
        ? clamp01((nowMs - sequence.startTimeMs) / Math.max(1, THEME1_MACHINE_TIMINGS.mixBoostMs))
        : 0;

    for (let solverIndex = 0; solverIndex < solverSteps; solverIndex += 1) {
      const solverTime = motionTime + stepSeconds * solverIndex;

      for (const model of visibleBalls) {
        const trajectory = resolvePerBallTrajectoryState(model, layout, solverTime, mixBoost);
        const emitterForce = resolveEmitterForce(model, layout, solverTime, mixBoost);
        const distributionForce = resolveDistributionForce(model, layout);
        const edgeOrbitBreakForce = resolveEdgeOrbitBreakForce(model, layout);
        const positionCatchup = (2.48 + mixBoost * 0.94) * model.response;
        const velocityCatchup = (6.28 + mixBoost * 2.36) * model.response;
        const speedFactor = model.speedMultiplier * BALL_MOTION_SPEED_MULTIPLIER;
        const turbulenceForce = resolveBallTurbulence(model, layout, solverTime, mixBoost);
        const selectedDrawForce =
          sequence && model.number === sequence.drawNumber && phase === "mix"
            ? resolveSelectedDrawForce(model, layout, solverTime, mixProgress)
            : { x: 0, y: 0 };

        model.vx += (trajectory.vx * speedFactor - model.vx) * velocityCatchup * stepSeconds;
        model.vy += (trajectory.vy * speedFactor - model.vy) * velocityCatchup * stepSeconds;
        model.vx += (trajectory.x - model.x) * positionCatchup * stepSeconds;
        model.vy += (trajectory.y - model.y) * positionCatchup * stepSeconds;
        model.vx +=
          ((emitterForce.x * speedFactor * 0.54) +
            (distributionForce.x * speedFactor) +
            (edgeOrbitBreakForce.x * speedFactor) +
            selectedDrawForce.x +
            (turbulenceForce.x * speedFactor * 1.24) +
            clusterShake.x * model.response * 0.03) *
          stepSeconds;
        model.vy +=
          ((emitterForce.y * speedFactor * 0.54) +
            (distributionForce.y * speedFactor) +
            (edgeOrbitBreakForce.y * speedFactor) +
            selectedDrawForce.y +
            (turbulenceForce.y * speedFactor * 1.24) +
            clusterShake.y * model.response * 0.03) *
          stepSeconds;
      }

      for (const model of visibleBalls) {
        if (sequence && model.number === sequence.drawNumber && phase === "mix") {
          const drawLock = easeInOutCubic(mixProgress);
          const parkingLock = easeInOutCubic(clamp01((mixProgress - 0.68) / 0.32));
          model.vx *= lerp(0.9, 0.34, drawLock * 0.58 + parkingLock * 0.42);
          model.vy *= lerp(0.92, 0.5, drawLock * 0.54 + parkingLock * 0.46);
        }

        model.vx *= 0.979;
        model.vy *= 0.979;

        let minimumCruise = 132 * model.speedMultiplier * BALL_MOTION_SPEED_MULTIPLIER;
        if (sequence && model.number === sequence.drawNumber && phase === "mix") {
          const parkingLock = easeInOutCubic(clamp01((mixProgress - 0.68) / 0.32));
          minimumCruise *= lerp(1, 0.08, parkingLock);
        }
        const currentSpeed = Math.hypot(model.vx, model.vy);
        if (currentSpeed < minimumCruise) {
          const angle = Math.atan2(model.vy || Math.sin(model.phaseA), model.vx || Math.cos(model.phaseB));
          model.vx += Math.cos(angle) * (minimumCruise - currentSpeed) * 0.18;
          model.vy += Math.sin(angle) * (minimumCruise - currentSpeed) * 0.18;
        }

        const speed = Math.hypot(model.vx, model.vy);
        const speedCap = 776 * model.speedMultiplier * BALL_MOTION_SPEED_MULTIPLIER;
        if (speed > speedCap) {
          const speedScale = speedCap / speed;
          model.vx *= speedScale;
          model.vy *= speedScale;
        }

        model.x += model.vx * stepSeconds;
        model.y += model.vy * stepSeconds;
        if (sequence && model.number === sequence.drawNumber && phase === "mix") {
          const pocketState = resolveSelectedDrawPocketState(model, layout, solverTime, mixProgress);
          const hardLock = easeInOutCubic(clamp01((mixProgress - 0.72) / 0.28));
          model.x = lerp(model.x, pocketState.targetX, 0.08 + hardLock * 0.52);
          model.y = lerp(model.y, pocketState.targetY, 0.12 + hardLock * 0.6);
          model.vx *= lerp(0.86, 0.08, hardLock);
          model.vy *= lerp(0.9, 0.14, hardLock);
        }
        constrainBallToEllipse(model, layout, solverTime);
      }
    }

    if (sequence && phase === "mix") {
      const drawModel = modelsRef.current.get(sequence.drawNumber);
      if (drawModel) {
        sequence.ejectStartX = layout.clusterLeft + drawModel.x;
        sequence.ejectStartY = layout.clusterTop + drawModel.y;
      }
    }

    for (const model of visibleBalls) {
      model.spin += (model.spinSpeed + model.vx * 0.016) * deltaSeconds;
    }

    renderClusterCanvas(visibleBalls, motionTime, layout, activeDrawNumber, phase, mixProgress);
  }

  function updateGlobeRig(nowMs: number, mixBoost: number) {
    if (!globeRigRef.current) {
      return;
    }

    const motionTime = nowMs / 1000;
    const translateX =
      (Math.sin((motionTime * 2.18) + 0.22) * 3.8 +
        Math.sin((motionTime * 5.04) + 1.24) * 2.2) *
      (0.68 + mixBoost * 1.34);
    const translateY =
      (Math.cos((motionTime * 1.62) + 0.84) * 4.8 +
        Math.sin((motionTime * 4.1) + 2.17) * 2.6) *
      (0.76 + mixBoost * 1.44);
    const rotation =
      (Math.sin((motionTime * 2.84) + 0.18) * 1.7 +
        Math.cos((motionTime * 3.91) + 1.44) * 1.1) *
      (0.5 + mixBoost * 1.08);

    globeRigRef.current.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) rotate(${rotation}deg)`;
  }

  function updateEjectBall(
    nowMs: number,
    phase: Theme1MachinePhase,
    sequence: Theme1MachineSequenceState,
    layout: Theme1MachineLayout,
  ) {
    if (!ejectBallRef.current) {
      return;
    }

    const elapsedMs = Math.max(0, nowMs - sequence.startTimeMs);
    const mixEnd = THEME1_MACHINE_TIMINGS.mixBoostMs;
    const suctionEnd = mixEnd + THEME1_MACHINE_TIMINGS.suctionMs;
    const dropEnd = suctionEnd + THEME1_MACHINE_TIMINGS.dropMs;
    const exitEnd = dropEnd + THEME1_MACHINE_TIMINGS.exitMs;
    const settleEnd = exitEnd + THEME1_MACHINE_TIMINGS.settleMs;
    const usesIntegratedBackdropScene = variant === "integrated-scene";
    const usesIntegratedLiveScene = variant === "integrated-live";
    const outputScale = usesIntegratedBackdropScene ? 1 : usesIntegratedLiveScene ? 2.34 : 1.18;
    const holeScale = usesIntegratedBackdropScene ? 0.122 : usesIntegratedLiveScene ? 0.58 : 0.168;
    const suctionScale = usesIntegratedBackdropScene ? holeScale * 0.72 : usesIntegratedLiveScene ? 0.46 : holeScale * 0.72;

    let x = sequence.ejectStartX;
    let y = sequence.ejectStartY;
    let scale = 1;
    let rotation = 0;
    let opacity = phase === "mix" ? 0 : 1;
    let emergeStrength = 0;
    let emergeBurst = 0;
    let holeMaskOpacity = 0;
    let holeMaskScale = 0.92;
    let holeMaskShiftY = 0;
    let clipTopPct = 0;

    if (phase === "suction") {
      const progress = clamp01((elapsedMs - mixEnd) / THEME1_MACHINE_TIMINGS.suctionMs);
      const arcLift = Math.sin(progress * Math.PI) * (usesIntegratedBackdropScene ? -16 : -15);
      x = lerp(sequence.ejectStartX, layout.cupX, easeInOutCubic(progress));
      y = lerp(sequence.ejectStartY, layout.cupY, easeInCubic(progress)) + arcLift;
      scale = lerp(suctionScale, holeScale, easeInOutCubic(progress));
      rotation = lerp(0, usesIntegratedBackdropScene ? -24 : -26, progress);
      holeMaskOpacity = 0.14 + progress * 0.12;
      holeMaskScale = lerp(0.92, 0.98, progress);
      clipTopPct = usesIntegratedLiveScene ? lerp(12, 22, progress) : 0;
    } else if (phase === "drop") {
      const progress = clamp01((elapsedMs - suctionEnd) / THEME1_MACHINE_TIMINGS.dropMs);
      x = lerp(layout.cupX, layout.holeX, easeInOutCubic(progress));
      y = lerp(layout.cupY, layout.holeY + (usesIntegratedLiveScene ? 10 : 0), easeInQuad(progress));
      scale = holeScale;
      rotation = lerp(usesIntegratedBackdropScene ? -24 : -26, usesIntegratedBackdropScene ? -34 : -36, progress);
      emergeStrength = easeInOutCubic(clamp01((progress - 0.12) / 0.88));
      emergeBurst = Math.sin(clamp01((progress - 0.22) / 0.78) * Math.PI) * 0.44;
      holeMaskOpacity = lerp(0.32, 0.92, easeInOutCubic(progress));
      holeMaskScale = lerp(0.98, 1.06, easeInOutCubic(progress));
      holeMaskShiftY = progress * 1.4;
      clipTopPct = usesIntegratedLiveScene ? lerp(24, 42, easeInOutCubic(progress)) : 0;
    } else if (phase === "exit") {
      const progress = clamp01((elapsedMs - dropEnd) / THEME1_MACHINE_TIMINGS.exitMs);
      const holdInHoleUntil = usesIntegratedBackdropScene ? 0.26 : 0.56;
      const releaseProgress = clamp01((progress - holdInHoleUntil) / (1 - holdInHoleUntil));
      const growthProgress = clamp01((progress - (usesIntegratedBackdropScene ? 0.38 : 0.58)) / (usesIntegratedBackdropScene ? 0.62 : 0.42));
      const easedRelease = easeOutBack(releaseProgress);
      const popLift = Math.sin(releaseProgress * Math.PI) * (usesIntegratedBackdropScene ? -24 : -16);
      const holeSeatDrop = Math.sin(clamp01(progress / Math.max(holdInHoleUntil, 0.01)) * Math.PI) * (usesIntegratedBackdropScene ? 2 : 4.8);
      x = lerp(layout.holeX, layout.outputX, easeOutCubic(releaseProgress));
      y = lerp(layout.holeY + (usesIntegratedLiveScene ? 6 : 0) + holeSeatDrop, layout.outputY, easeOutCubic(releaseProgress)) + popLift;
      scale =
        progress < holdInHoleUntil
          ? holeScale
          : lerp(holeScale, outputScale, easeOutBack(growthProgress));
      rotation = lerp(usesIntegratedBackdropScene ? -34 : -38, -6, easedRelease);
      emergeStrength = lerp(0.92, 0, easeOutCubic(progress));
      emergeBurst =
        Math.sin(clamp01(progress / (usesIntegratedBackdropScene ? 0.78 : 0.66)) * Math.PI) *
        (usesIntegratedBackdropScene ? 1.08 : 0.84);
      const occlusionProgress = 1 - clamp01((progress - (usesIntegratedBackdropScene ? 0.28 : 0.62)) / (usesIntegratedBackdropScene ? 0.42 : 0.26));
      holeMaskOpacity = occlusionProgress * (usesIntegratedLiveScene ? 0.56 : 0.96);
      holeMaskScale = 1 + occlusionProgress * 0.12;
      holeMaskShiftY = occlusionProgress * 3.4;
      clipTopPct = usesIntegratedLiveScene
        ? progress < holdInHoleUntil
          ? 42
          : lerp(42, 0, easeOutCubic(releaseProgress))
        : 0;
    } else if (phase === "settle" || phase === "hold") {
      const progress = clamp01((elapsedMs - exitEnd) / THEME1_MACHINE_TIMINGS.settleMs);
      x = layout.outputX;
      y = layout.outputY + Math.sin(progress * Math.PI) * -6;
      scale = outputScale;
      rotation = lerp(-4, 0, easeOutCubic(progress));
    } else if (elapsedMs > settleEnd) {
      opacity = 0;
    }

    ejectBallRef.current.style.opacity = String(opacity);
    ejectBallRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${scale}) rotate(${rotation}deg)`;
    ejectBallRef.current.style.clipPath =
      clipTopPct > 0 ? `inset(${clipTopPct}% 0 0 0 round 999px)` : "none";
    if (sceneRef.current) {
      sceneRef.current.style.setProperty("--theme1-emerge-strength", String(emergeStrength));
      sceneRef.current.style.setProperty("--theme1-emerge-burst", String(emergeBurst));
      sceneRef.current.style.setProperty("--theme1-hole-mask-opacity", String(holeMaskOpacity));
      sceneRef.current.style.setProperty("--theme1-hole-mask-scale", String(holeMaskScale));
      sceneRef.current.style.setProperty("--theme1-hole-mask-shift-y", `${holeMaskShiftY}px`);
    }

    if (holeMaskRef.current) {
      holeMaskRef.current.dataset.phase = phase;
    }
  }

  function updateOutputBall() {
    if (!sceneRef.current) {
      return;
    }

    sceneRef.current.dataset.phase = phaseRef.current;
    if (!activeSequenceRef.current) {
      sceneRef.current.style.setProperty("--theme1-emerge-strength", "0");
      sceneRef.current.style.setProperty("--theme1-emerge-burst", "0");
      sceneRef.current.style.setProperty("--theme1-hole-mask-opacity", "0");
      sceneRef.current.style.setProperty("--theme1-hole-mask-scale", "0.92");
      sceneRef.current.style.setProperty("--theme1-hole-mask-shift-y", "0px");
    }

    if (ejectBallRef.current) {
      ejectBallRef.current.style.clipPath = "none";
    }
  }

  function renderClusterCanvas(
    visibleBalls: readonly Theme1MachineBallState[],
    motionTime: number,
    layout: Theme1MachineLayout,
    activeDrawNumber: number | null,
    phase: Theme1MachinePhase,
    mixProgress: number,
  ) {
    const canvas = clusterCanvasRef.current;
    if (!canvas) {
      return;
    }

    syncClusterCanvasResolution(canvas, layout);

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const devicePixelRatioValue = window.devicePixelRatio || 1;
    context.setTransform(devicePixelRatioValue, 0, 0, devicePixelRatioValue, 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "medium";
    context.clearRect(0, 0, layout.clusterWidth, layout.clusterHeight);

    context.save();
    context.beginPath();
    context.ellipse(
      layout.clusterWidth * 0.5,
      layout.clusterHeight * 0.5,
      layout.clusterWidth * 0.5,
      layout.clusterHeight * 0.5,
      0,
      0,
      Math.PI * 2,
    );
    context.clip();
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(layout.clusterWidth, 0);
    context.lineTo(layout.clusterWidth, resolveClusterFloorY(layout, layout.clusterWidth));
    for (let sampleIndex = 24; sampleIndex >= 0; sampleIndex -= 1) {
      const sampleX = layout.clusterWidth * (sampleIndex / 24);
      context.lineTo(sampleX, resolveClusterFloorY(layout, sampleX));
    }
    context.closePath();
    context.clip();

    const sortedBalls = (visibleBalls as Theme1MachineBallState[]).slice().sort((first, second) => {
      const firstLayer = resolveBallLayerDepth(first, layout, activeDrawNumber, phase, mixProgress);
      const secondLayer = resolveBallLayerDepth(second, layout, activeDrawNumber, phase, mixProgress);
      return firstLayer !== secondLayer ? firstLayer - secondLayer : first.number - second.number;
    });

    for (const model of sortedBalls) {
      const image = ballImageCacheRef.current.get(model.number);
      if (!image || !image.complete || image.naturalWidth === 0) {
        continue;
      }

      const scale = resolveBallScale(model, motionTime, layout);
      const drawRadius = model.radius * scale;
      const drawSize = drawRadius * 2;
      const rotation = clamp(model.vx * 0.032 + model.vy * 0.024, -4, 4) * (Math.PI / 180);
      const usesIntegratedBackdropScene = variant === "integrated-scene";
      const alpha = usesIntegratedBackdropScene ? 0.99 : 0.94 + (model.depth * 0.04);

      context.globalAlpha = alpha;
      if (rotation !== 0) {
        context.save();
        context.translate(model.x, model.y);
        context.rotate(rotation);
        context.drawImage(image, -drawRadius, -drawRadius, drawSize, drawSize);
        context.restore();
      } else {
        context.drawImage(image, model.x - drawRadius, model.y - drawRadius, drawSize, drawSize);
      }
    }

    context.restore();
  }

  return (
    <section className={`theme1-draw-machine theme1-draw-machine--${variant}`.trim()}>
      {variant === "integrated-live" ? null : (
        <div className="theme1-draw-machine__history">
          <span className="theme1-draw-machine__history-label">Trekk</span>
          <strong>{drawCount} / 30</strong>
        </div>
      )}

      <div
        ref={sceneRef}
        className="theme1-draw-machine__scene"
        data-phase={phaseRef.current}
        data-variant={variant}
        style={
          {
            "--theme1-scene-max-width": preset.sceneMaxWidth,
            "--theme1-scene-aspect-ratio": preset.sceneAspectRatio,
            "--theme1-scene-shadow": preset.sceneShadow,
            "--theme1-cluster-left": `${preset.anchors.clusterLeftPct}%`,
            "--theme1-cluster-top": `${preset.anchors.clusterTopPct}%`,
            "--theme1-cluster-width": `${preset.anchors.clusterWidthPct}%`,
            "--theme1-cluster-height": `${preset.anchors.clusterHeightPct}%`,
            "--theme1-output-left": `${preset.anchors.outputXPct}%`,
            "--theme1-output-top": `${preset.anchors.outputYPct}%`,
            "--theme1-base-opacity": preset.baseOpacity,
            "--theme1-glass-opacity": preset.glassOpacity,
            "--theme1-globe-aura-opacity": preset.globeAuraOpacity,
            "--theme1-glass-clip-path": preset.glassClipPath,
            "--theme1-chute-clip-path": preset.chuteClipPath,
            "--theme1-chute-opacity": preset.chuteOpacity,
            "--theme1-floating-ball-size": preset.floatingBallSize,
            "--theme1-output-ball-size": preset.outputBallSize,
            "--theme1-suction-column-top": preset.suctionColumnTop,
            "--theme1-suction-column-width": preset.suctionColumnWidth,
            "--theme1-suction-column-height": preset.suctionColumnHeight,
            "--theme1-suction-glow-top": preset.suctionGlowTop,
            "--theme1-suction-glow-width": preset.suctionGlowWidth,
            "--theme1-emerge-trail-top": preset.emergeTrailTop,
            "--theme1-emerge-trail-width": preset.emergeTrailWidth,
            "--theme1-emerge-trail-height": preset.emergeTrailHeight,
            "--theme1-emerge-ring-top": preset.emergeRingTop,
            "--theme1-emerge-ring-width": preset.emergeRingWidth,
            "--theme1-emerge-burst-top": preset.emergeBurstTop,
            "--theme1-emerge-burst-width": preset.emergeBurstWidth,
          } as CSSProperties
        }
      >
        <div className="theme1-draw-machine__figure">
          <img
            className="theme1-draw-machine__machine-image theme1-draw-machine__machine-image--base"
            src={preset.frameImageUrl}
            alt=""
            aria-hidden="true"
          />

          <div ref={globeRigRef} className="theme1-draw-machine__globe-rig">
            <div ref={clusterRef} className="theme1-draw-machine__cluster">
              <canvas ref={clusterCanvasRef} className="theme1-draw-machine__cluster-canvas" />
            </div>
          </div>
          <div className="theme1-draw-machine__suction-column" aria-hidden="true" />
          <div className="theme1-draw-machine__suction-glow" aria-hidden="true" />
          <div className="theme1-draw-machine__emerge-trail" aria-hidden="true" />
          <div className="theme1-draw-machine__emerge-ring" aria-hidden="true" />
          <div className="theme1-draw-machine__emerge-burst" aria-hidden="true" />

          <div
            ref={ejectBallRef}
            className={`theme1-draw-machine__floating-ball${ejectBallNumber === null ? " theme1-draw-machine__floating-ball--hidden" : ""}`.trim()}
          >
            {ejectBallNumber !== null ? (
              <img src={getTheme1BallSpriteUrl(ejectBallNumber) ?? ""} alt="" aria-hidden="true" />
            ) : null}
          </div>

          <img
            className="theme1-draw-machine__machine-image theme1-draw-machine__machine-image--glass"
            src={preset.frameImageUrl}
            alt=""
            aria-hidden="true"
          />
          <img
            className="theme1-draw-machine__machine-image theme1-draw-machine__machine-image--chute"
            src={preset.frameImageUrl}
            alt=""
            aria-hidden="true"
          />
          <div
            ref={flightOriginRef}
            className="theme1-draw-machine__flight-origin"
            aria-hidden="true"
            style={{
              "--theme1-flight-origin-left": `${preset.anchors.holeXPct}%`,
              "--theme1-flight-origin-top": `${preset.anchors.holeYPct}%`,
            } as CSSProperties}
          />
          <div ref={holeMaskRef} className="theme1-draw-machine__hole-mask" />
        </div>

        <div
          ref={outputBallRef}
          className={`theme1-draw-machine__output-ball${outputBallNumber === null || outputBallNumber === suppressedOutputBallNumber ? " theme1-draw-machine__output-ball--hidden" : ""}`.trim()}
        >
          {outputBallNumber !== null ? (
            <img src={getTheme1BallSpriteUrl(outputBallNumber) ?? ""} alt="" aria-hidden="true" />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function initializeMachineModels(
  modelMap: Map<number, Theme1MachineBallState>,
  layout: Theme1MachineLayout | null,
  ballRadiusScale: number,
) {
  if (!layout) {
    return;
  }

  modelMap.clear();
  const random = createMulberry32(MOTION_SEED);
  const centerX = layout.clusterWidth * 0.5;
  const centerY = layout.clusterHeight * 0.5;
  const radiusX = layout.clusterWidth * 0.33;
  const radiusY = layout.clusterHeight * 0.345;

  for (let index = 0; index < ALL_MACHINE_BALL_NUMBERS.length; index += 1) {
    const number = ALL_MACHINE_BALL_NUMBERS[index];
    const point = createSunflowerPoint(index, ALL_MACHINE_BALL_NUMBERS.length, radiusX, radiusY);
    const restX = clamp(centerX + point.x, layout.clusterWidth * 0.19, layout.clusterWidth * 0.81);
    const restY = clamp(
      centerY + point.y + lerp(-8, 12, random()),
      layout.clusterHeight * 0.18,
      layout.clusterHeight * 0.82,
    );

    modelMap.set(number, {
      number,
      restX,
      restY,
      x: restX + lerp(-24, 24, random()),
      y: restY + lerp(-24, 24, random()),
      vx: lerp(-72, 72, random()),
      vy: lerp(-80, 80, random()),
      radius: 16.2432 * ballRadiusScale,
      baseScale: 0.92,
      response: lerp(0.88, 1.18, random()),
      depth: random(),
      renderDepth: random(),
      wanderAmplitudeX: lerp(36, 84, random()),
      wanderAmplitudeY: lerp(38, 88, random()),
      wanderFrequencyA: lerp(0.42, 1.68, random()),
      wanderFrequencyB: lerp(0.46, 1.78, random()),
      orbitRadiusX: lerp(24, 44, random()),
      orbitRadiusY: lerp(26, 46, random()),
      orbitFrequency: lerp(0.48, 1.74, random()),
      phaseA: lerp(0, Math.PI * 2, random()),
      phaseB: lerp(0, Math.PI * 2, random()),
      phaseC: lerp(0, Math.PI * 2, random()),
      noiseOffsetX: lerp(8, 96, random()),
      noiseOffsetY: lerp(104, 188, random()),
      noiseSpeed: lerp(0.38, 1.28, random()),
      speedMultiplier: lerp(1.18, 2.12, random()),
      bounce: lerp(1.04, 1.28, random()),
      wallDrift: lerp(-1, 1, random()),
      spin: lerp(0, 360, random()),
      spinSpeed: lerp(-16, 16, random()),
    });
  }
}

function measureMachineLayout(
  sceneElement: HTMLDivElement,
  clusterElement: HTMLDivElement,
  anchors: Theme1MachineAnchors,
  floorEdgePct: number,
  floorCenterPct: number,
  topInsetPx: number,
): Theme1MachineLayout {
  const sceneWidth = sceneElement.clientWidth;
  const sceneHeight = sceneElement.clientHeight;
  const clusterWidth = clusterElement.clientWidth;
  const clusterHeight = clusterElement.clientHeight;

  return {
    sceneWidth,
    sceneHeight,
    clusterWidth,
    clusterHeight,
    clusterLeft: sceneWidth * (anchors.clusterLeftPct / 100),
      clusterTop: sceneHeight * (anchors.clusterTopPct / 100),
      cupX: sceneWidth * (anchors.cupXPct / 100),
      cupY: sceneHeight * (anchors.cupYPct / 100),
      holeX: sceneWidth * (anchors.holeXPct / 100),
      holeY: sceneHeight * (anchors.holeYPct / 100),
      outputX: sceneWidth * (anchors.outputXPct / 100),
    outputY: sceneHeight * (anchors.outputYPct / 100),
    floorEdgePct,
    floorCenterPct,
    topInsetPx,
  };
}

function syncClusterCanvasResolution(
  canvas: HTMLCanvasElement | null,
  layout: Theme1MachineLayout | null,
) {
  if (!canvas || !layout) {
    return;
  }

  const devicePixelRatioValue = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(layout.clusterWidth * devicePixelRatioValue));
  const height = Math.max(1, Math.round(layout.clusterHeight * devicePixelRatioValue));

  if (canvas.width !== width) {
    canvas.width = width;
  }

  if (canvas.height !== height) {
    canvas.height = height;
  }
}

function constrainBallToEllipse(
  model: Theme1MachineBallState,
  layout: Theme1MachineLayout,
  motionTime: number,
) {
  const centerX = layout.clusterWidth * 0.5;
  const centerY = layout.clusterHeight * 0.5;
  const visualScale = resolveBallScale(model, motionTime, layout);
  const visualRadius = Math.max(0, model.radius * visualScale - BALL_AREA_EXPANSION_PX + 0.8);
  const radiusX = layout.clusterWidth * 0.5 - visualRadius;
  const radiusY = layout.clusterHeight * 0.5 - visualRadius;
  const normalizedX = radiusX > 0 ? (model.x - centerX) / radiusX : 0;
  const normalizedY = radiusY > 0 ? (model.y - centerY) / radiusY : 0;
  const ellipse = normalizedX * normalizedX + normalizedY * normalizedY;
  const topLimit = visualRadius + layout.topInsetPx;

  if (model.y < topLimit) {
    model.y = topLimit;
    if (model.vy < 0) {
      model.vy = -model.vy * Math.min(1.04, model.bounce);
    }
    model.vx *= 0.992;
  }

  if (ellipse <= 1) {
    constrainBallToFloor(model, layout, visualRadius);
    return;
  }

  const scale = 1 / Math.sqrt(ellipse);
  const nextX = centerX + (model.x - centerX) * scale * 0.995;
  const nextY = centerY + (model.y - centerY) * scale * 0.995;
  const normalX = radiusX > 0 ? (nextX - centerX) / radiusX : 0;
  const normalY = radiusY > 0 ? (nextY - centerY) / radiusY : 0;
  const normalLength = Math.max(0.001, Math.hypot(normalX, normalY));
  const unitNormalX = normalX / normalLength;
  const unitNormalY = normalY / normalLength;
  const velocityAlongNormal = model.vx * unitNormalX + model.vy * unitNormalY;

  model.x = nextX;
  model.y = nextY;

  if (velocityAlongNormal > 0) {
    model.vx -= velocityAlongNormal * unitNormalX * model.bounce;
    model.vy -= velocityAlongNormal * unitNormalY * model.bounce;
  }

  const tangentX = -unitNormalY;
  const tangentY = unitNormalX;
  const tangentialSpeed = model.vx * tangentX + model.vy * tangentY;
  const wallRedirect =
    (0.12 + Math.abs(model.wallDrift) * 0.06) *
    (10 + Math.abs(velocityAlongNormal) * 0.08);
  const wallPulse =
    Math.sin((motionTime * (1.42 + model.noiseSpeed * 0.22)) + model.phaseB) * 1.5;
  const driftDirection = Math.sign(model.wallDrift || Math.sin(model.phaseC));

  model.vx += -unitNormalX * 19.5;
  model.vy += -unitNormalY * 19.5;
  model.vx += tangentX * (wallRedirect * driftDirection - tangentialSpeed * 0.82 + wallPulse * 0.02);
  model.vy += tangentY * (wallRedirect * driftDirection - tangentialSpeed * 0.82 + wallPulse * 0.02);

  constrainBallToFloor(model, layout, visualRadius);
}

function constrainBallToFloor(
  model: Theme1MachineBallState,
  layout: Theme1MachineLayout,
  visualRadius: number,
) {
  const floorY = resolveClusterFloorY(layout, model.x) - visualRadius;
  if (model.y <= floorY) {
    return;
  }

  model.y = floorY;
  if (model.vy > 0) {
    model.vy = -model.vy * Math.min(1.04, model.bounce);
  }
  model.vx *= 0.985;
}

function resolveClusterFloorY(layout: Theme1MachineLayout, x: number) {
  const centerX = layout.clusterWidth * 0.5;
  const radiusX = layout.clusterWidth * 0.5;
  const normalizedX = clamp(Math.abs(x - centerX) / Math.max(1, radiusX), 0, 1);
  const arc = Math.sqrt(Math.max(0, 1 - normalizedX * normalizedX));
  return lerp(layout.clusterHeight * layout.floorEdgePct, layout.clusterHeight * layout.floorCenterPct, arc);
}

function resolveSelectedDrawPocketState(
  model: Theme1MachineBallState,
  layout: Theme1MachineLayout,
  motionTime: number,
  mixProgress: number,
) {
  const localCupX = layout.cupX - layout.clusterLeft;
  const localCupY = layout.cupY - layout.clusterTop;
  const centerX = layout.clusterWidth * 0.5;
  const bottomPocketY = layout.clusterHeight * 0.944;
  const pullProgress = easeInOutCubic(clamp01((mixProgress - 0.02) / 0.98));
  const parkingLock = easeInOutCubic(clamp01((mixProgress - 0.56) / 0.44));
  const pocketX =
    lerp(centerX, localCupX, 0.86) +
    Math.sin((motionTime * 4.4) + model.phaseA) * layout.clusterWidth * lerp(0.0042, 0.0008, parkingLock);
  const pocketY =
    clamp(
      lerp(localCupY, bottomPocketY, 0.92),
      layout.clusterHeight * 0.9,
      layout.clusterHeight * 0.956,
    ) +
    Math.cos((motionTime * 4.1) + model.phaseB) * layout.clusterHeight * lerp(0.0022, 0.0005, parkingLock);
  const targetX = lerp(model.restX, pocketX, 0.48 + pullProgress * 0.42 + parkingLock * 0.1);
  const targetY = lerp(model.restY, pocketY, 0.42 + pullProgress * 0.44 + parkingLock * 0.14);
  return {
    targetX,
    targetY,
    pullProgress,
    parkingLock,
  };
}

function resolveSelectedDrawForce(
  model: Theme1MachineBallState,
  layout: Theme1MachineLayout,
  motionTime: number,
  mixProgress: number,
) {
  const pocketState = resolveSelectedDrawPocketState(model, layout, motionTime, mixProgress);
  const offsetX = clamp(
    pocketState.targetX - model.x,
    -layout.clusterWidth * 0.18,
    layout.clusterWidth * 0.18,
  );
  const offsetY = clamp(
    pocketState.targetY - model.y,
    -layout.clusterHeight * 0.16,
    layout.clusterHeight * 0.34,
  );
  const pullStrength = 10 + pocketState.pullProgress * 18 + pocketState.parkingLock * 14;
  const suctionBias = 36 + pocketState.pullProgress * 76 + pocketState.parkingLock * 52;

  return {
    x: offsetX * (pullStrength * (1 + pocketState.parkingLock * 0.18)),
    y: offsetY * (pullStrength + 4.8 + pocketState.parkingLock * 3.2) + suctionBias,
  };
}

function resolvePhaseForElapsedMs(elapsedMs: number): Theme1MachinePhase {
  const mixEnd = THEME1_MACHINE_TIMINGS.mixBoostMs;
  const suctionEnd = mixEnd + THEME1_MACHINE_TIMINGS.suctionMs;
  const dropEnd = suctionEnd + THEME1_MACHINE_TIMINGS.dropMs;
  const exitEnd = dropEnd + THEME1_MACHINE_TIMINGS.exitMs;
  const settleEnd = exitEnd + THEME1_MACHINE_TIMINGS.settleMs;

  if (elapsedMs < mixEnd) {
    return "mix";
  }

  if (elapsedMs < suctionEnd) {
    return "suction";
  }

  if (elapsedMs < dropEnd) {
    return "drop";
  }

  if (elapsedMs < exitEnd) {
    return "exit";
  }

  if (elapsedMs < settleEnd) {
    return "settle";
  }

  return "hold";
}

function resolveMixBoostForPhase(phase: Theme1MachinePhase, elapsedMs: number) {
  if (phase === "mix") {
    return lerp(
      0.42,
      1,
      clamp01(elapsedMs / Math.max(1, THEME1_MACHINE_TIMINGS.mixBoostMs)),
    );
  }

  if (phase === "suction") {
    return 0.82;
  }

  if (phase === "drop") {
    return 0.52;
  }

  return phase === "exit" ? 0.32 : 0.14;
}

function createSunflowerPoint(
  index: number,
  total: number,
  radiusX: number,
  radiusY: number,
) {
  const ratio = (index + 0.5) / total;
  const distance = Math.pow(ratio, 1.02);
  const angle = index * 2.39996323;
  return {
    x: Math.cos(angle) * radiusX * distance,
    y: Math.sin(angle) * radiusY * distance,
  };
}

function resolveBallScale(
  model: Theme1MachineBallState,
  motionTime: number,
  layout: Theme1MachineLayout | null,
) {
  void motionTime;
  void layout;
  return model.baseScale;
}

function resolveBallLayerDepth(
  model: Theme1MachineBallState,
  layout: Theme1MachineLayout,
  activeDrawNumber: number | null,
  phase: Theme1MachinePhase,
  mixProgress: number,
) {
  const verticalDepth = clamp01(model.y / Math.max(1, layout.clusterHeight));
  const selectedBoost =
    phase === "mix" && activeDrawNumber === model.number
      ? lerp(0, 1.4, easeInOutCubic(clamp01((mixProgress - 0.38) / 0.62)))
      : 0;
  return model.renderDepth * 0.88 + verticalDepth * 0.12 + selectedBoost;
}

function resolvePerBallTrajectoryPoint(
  model: Theme1MachineBallState,
  layout: Theme1MachineLayout,
  motionTime: number,
  mixBoost: number,
) {
  const centerX = layout.clusterWidth * 0.5;
  const centerY = layout.clusterHeight * 0.5;
  const restBiasX = normalizeSymmetric(model.restX / layout.clusterWidth);
  const restBiasY = normalizeSymmetric(model.restY / layout.clusterHeight);
  const baseCenterX =
    lerp(centerX, model.restX, 0.74) +
    Math.sin((motionTime * (0.24 + model.response * 0.08)) + model.phaseC) *
      layout.clusterWidth *
      (0.072 + Math.abs(restBiasX) * 0.038);
  const baseCenterY =
    lerp(centerY, model.restY, 0.74) +
    Math.cos((motionTime * (0.26 + model.depth * 0.08)) + model.phaseA) *
      layout.clusterHeight *
      (0.074 + Math.abs(restBiasY) * 0.04);
  const spanX = layout.clusterWidth * (0.36 + model.depth * 0.08 + mixBoost * 0.08);
  const spanY = layout.clusterHeight * (0.34 + model.response * 0.08 + mixBoost * 0.08);
  const routeFamily = model.number % 6;
  const sweepA = swingWave((motionTime * (0.56 + model.wanderFrequencyA * 0.34)) + model.phaseA);
  const sweepB = swingWave((motionTime * (0.6 + model.wanderFrequencyB * 0.32)) + model.phaseB);
  const sweepC = swingWave((motionTime * (0.66 + model.orbitFrequency * 0.3)) + model.phaseC);
  const crossA = Math.sin((motionTime * (1.34 + model.wanderFrequencyB * 0.28)) + model.phaseB);
  const crossB = Math.cos((motionTime * (1.48 + model.orbitFrequency * 0.24)) + model.phaseC);
  const crossC = Math.sin((motionTime * (1.7 + model.wanderFrequencyA * 0.22)) + model.phaseA);

  let majorX = 0;
  let majorY = 0;

  if (routeFamily === 0) {
    majorX =
      (sweepA * 0.9 + crossB * 0.16 + sweepC * 0.12) * spanX;
    majorY =
      (sweepB * 0.74 + sweepA * 0.18 + crossC * 0.16) * spanY;
  } else if (routeFamily === 1) {
    majorX =
      (sweepB * 0.88 + crossA * 0.14 - sweepC * 0.1) * spanX;
    majorY =
      (sweepC * 0.72 - sweepB * 0.2 + crossB * 0.18) * spanY;
  } else if (routeFamily === 2) {
    majorX =
      (sweepC * 0.82 + crossA * 0.2 + sweepA * 0.14) * spanX;
    majorY =
      (sweepA * 0.78 + sweepC * 0.16 - crossB * 0.14) * spanY;
  } else if (routeFamily === 3) {
    majorX =
      (sweepA * 0.86 - sweepB * 0.18 + crossC * 0.14) * spanX;
    majorY =
      (sweepB * 0.68 + crossA * 0.22 + sweepA * 0.16) * spanY;
  } else if (routeFamily === 4) {
    majorX =
      (sweepB * 0.9 + sweepC * 0.12 - crossB * 0.12) * spanX;
    majorY =
      (sweepA * 0.7 - sweepB * 0.16 + crossC * 0.2) * spanY;
  } else {
    majorX =
      (sweepC * 0.92 + crossA * 0.14 - sweepA * 0.1) * spanX;
    majorY =
      (sweepB * 0.74 + sweepC * 0.14 - crossB * 0.18) * spanY;
  }

  const laneDriftX =
    Math.sin((motionTime * (1.92 + model.wanderFrequencyB * 0.46)) + model.phaseB) *
    layout.clusterWidth *
    (0.058 + model.depth * 0.028);
  const laneDriftY =
    Math.cos((motionTime * (2.02 + model.wanderFrequencyA * 0.48)) + model.phaseC) *
    layout.clusterHeight *
    (0.062 + model.depth * 0.03);
  const turbulenceX =
    ((noise(model.noiseOffsetX, motionTime * (0.96 + model.noiseSpeed * 0.72)) - 0.5) * 2) *
    layout.clusterWidth *
    (0.044 + model.response * 0.016 + mixBoost * 0.014);
  const turbulenceY =
    ((noise(model.noiseOffsetY, motionTime * (1.04 + model.noiseSpeed * 0.68)) - 0.5) * 2) *
    layout.clusterHeight *
    (0.05 + model.response * 0.016 + mixBoost * 0.014);

  let targetX = baseCenterX + majorX + laneDriftX + turbulenceX;
  let targetY = baseCenterY + majorY + laneDriftY + turbulenceY;
  const normalizedTargetX = normalizeSymmetric(targetX / layout.clusterWidth);
  const normalizedTargetY = normalizeSymmetric(targetY / layout.clusterHeight);
  const targetDistance = Math.hypot(normalizedTargetX, normalizedTargetY);

  if (targetDistance > 0.72) {
    const inwardScale = lerp(1, 0.72 / targetDistance, clamp01((targetDistance - 0.72) / 0.18));
    targetX = centerX + (targetX - centerX) * inwardScale;
    targetY = centerY + (targetY - centerY) * inwardScale;
  }

  return {
    x: clamp(targetX, layout.clusterWidth * 0.145, layout.clusterWidth * 0.855),
    y: clamp(targetY, layout.clusterHeight * 0.145, layout.clusterHeight * 0.855),
  };
}

function resolvePerBallTrajectoryState(
  model: Theme1MachineBallState,
  layout: Theme1MachineLayout,
  motionTime: number,
  mixBoost: number,
) {
  const sampleWindow = 1 / 60;
  const current = resolvePerBallTrajectoryPoint(model, layout, motionTime, mixBoost);
  const next = resolvePerBallTrajectoryPoint(model, layout, motionTime + sampleWindow, mixBoost);

  return {
    x: current.x,
    y: current.y,
    vx: (next.x - current.x) / sampleWindow,
    vy: (next.y - current.y) / sampleWindow,
  };
}

function resolveEmitterForce(
  model: Theme1MachineBallState,
  layout: Theme1MachineLayout,
  motionTime: number,
  mixBoost: number,
) {
  const positionBiasX = normalizeSymmetric(model.x / layout.clusterWidth);
  const positionBiasY = normalizeSymmetric(model.y / layout.clusterHeight);
  const emitterWidth = layout.clusterWidth * 0.24;
  const emitterHeight = layout.clusterHeight * 0.32;
  const emitterPower = 38 + mixBoost * 28;
  const emitterCenters = [
    layout.clusterWidth * 0.26 + Math.sin((motionTime * 0.82) + model.phaseA) * layout.clusterWidth * 0.03,
    layout.clusterWidth * 0.5 + Math.sin((motionTime * 1.04) + model.phaseB) * layout.clusterWidth * 0.04,
    layout.clusterWidth * 0.74 + Math.cos((motionTime * 0.9) + model.phaseC) * layout.clusterWidth * 0.03,
  ];
  let forceX = 0;
  let forceY = 0;

  for (let index = 0; index < emitterCenters.length; index += 1) {
    const emitterX = emitterCenters[index];
    const normalizedX = (model.x - emitterX) / emitterWidth;
    const normalizedY = (layout.clusterHeight * 0.96 - model.y) / emitterHeight;
    const horizontalFalloff = Math.exp(-(normalizedX * normalizedX) * 2.2);
    const verticalInfluence = clamp01(normalizedY);
    const pulse =
      0.62 +
      Math.sin((motionTime * (1.16 + index * 0.22)) + model.phaseA + index) * 0.24 +
      mixBoost * 0.18;
    const lift = horizontalFalloff * verticalInfluence * pulse;

    forceX += -normalizedX * emitterPower * 0.42 * lift;
    forceY -= emitterPower * (0.72 + model.depth * 0.14) * lift;
  }

  const sideReturn = -positionBiasX * Math.max(0, Math.abs(positionBiasX) - 0.66) * 42;
  const topReturn = Math.max(0, -positionBiasY - 0.56) * 26;
  const verticalRecirculation = -positionBiasY * 34;
  const bottomScatter =
    Math.max(0, positionBiasY + 0.14) *
    Math.sin((motionTime * (1.44 + model.noiseSpeed * 0.26)) + model.phaseB + model.phaseA * 0.4) *
    84;
  const crossCurrent =
    Math.sin((motionTime * (0.92 + model.orbitFrequency * 0.26)) + model.phaseC + model.phaseA * 0.58) *
    (24 + Math.abs(positionBiasY) * 22);
  const ambientSwirlX =
    Math.sin((motionTime * (1.24 + model.orbitFrequency * 0.18)) + model.phaseC + model.phaseB * 0.22) * 8;
  const ambientSwirlY =
    Math.cos((motionTime * (1.32 + model.wanderFrequencyA * 0.16)) + model.phaseA + model.phaseC * 0.18) * 10;

  forceX += sideReturn + bottomScatter + crossCurrent + ambientSwirlX;
  forceY += topReturn + verticalRecirculation + ambientSwirlY;

  return {
    x: forceX,
    y: forceY,
  };
}

function resolveBallTurbulence(
  model: Theme1MachineBallState,
  layout: Theme1MachineLayout,
  motionTime: number,
  mixBoost: number,
) {
  const positionBiasX = normalizeSymmetric(model.x / layout.clusterWidth);
  const positionBiasY = normalizeSymmetric(model.y / layout.clusterHeight);
  const sweepX =
    Math.sin((motionTime * (2.74 + model.wanderFrequencyA * 1.02)) + model.phaseA) *
      (62 + mixBoost * 46) +
    Math.cos((motionTime * (4.18 + model.wanderFrequencyB * 0.62)) + model.phaseB) *
      (42 + model.response * 22);
  const sweepY =
    Math.cos((motionTime * (2.48 + model.wanderFrequencyB * 0.9)) + model.phaseC) *
      (58 + mixBoost * 44) +
    Math.sin((motionTime * (3.88 + model.orbitFrequency * 0.56)) + model.phaseA) *
      (38 + model.depth * 24);
  const curlX =
    Math.sin((positionBiasY * 5.4) + (motionTime * (1.56 + model.noiseSpeed * 0.44)) + model.phaseC) *
    (32 + Math.abs(positionBiasX) * 36);
  const curlY =
    Math.cos((positionBiasX * 5.9) + (motionTime * (1.48 + model.noiseSpeed * 0.4)) + model.phaseB) *
    (30 + Math.abs(positionBiasY) * 38);
  const localNoiseX =
    ((noise(model.noiseOffsetX + 31, motionTime * (1.86 + model.noiseSpeed * 0.74)) - 0.5) * 2) *
    layout.clusterWidth *
    0.102;
  const localNoiseY =
    ((noise(model.noiseOffsetY + 71, motionTime * (1.94 + model.noiseSpeed * 0.68)) - 0.5) * 2) *
    layout.clusterHeight *
    0.11;

  return {
    x: sweepX + curlX + localNoiseX,
    y: sweepY + curlY + localNoiseY,
  };
}

function resolveDistributionForce(model: Theme1MachineBallState, layout: Theme1MachineLayout) {
  const centerX = layout.clusterWidth * 0.5;
  const centerY = layout.clusterHeight * 0.5;
  const radiusX = layout.clusterWidth * 0.5;
  const radiusY = layout.clusterHeight * 0.5;
  const normalizedX = radiusX > 0 ? (model.x - centerX) / radiusX : 0;
  const normalizedY = radiusY > 0 ? (model.y - centerY) / radiusY : 0;
  const radialDistance = Math.hypot(normalizedX, normalizedY);

  if (radialDistance <= 0.0001) {
    return { x: 0, y: 0 };
  }

  const unitX = normalizedX / radialDistance;
  const unitY = normalizedY / radialDistance;
  const outerPull = Math.max(0, radialDistance - 0.4) * 220;
  const innerPush = Math.max(0, 0.16 - radialDistance) * 10;

  return {
    x: (-unitX * outerPull) + (unitX * innerPush),
    y: (-unitY * outerPull) + (unitY * innerPush),
  };
}

function resolveEdgeOrbitBreakForce(model: Theme1MachineBallState, layout: Theme1MachineLayout) {
  const centerX = layout.clusterWidth * 0.5;
  const centerY = layout.clusterHeight * 0.5;
  const radiusX = layout.clusterWidth * 0.5;
  const radiusY = layout.clusterHeight * 0.5;
  const normalizedX = radiusX > 0 ? (model.x - centerX) / radiusX : 0;
  const normalizedY = radiusY > 0 ? (model.y - centerY) / radiusY : 0;
  const radialDistance = Math.hypot(normalizedX, normalizedY);

  if (radialDistance <= 0.0001) {
    return { x: 0, y: 0 };
  }

  const edgeStrength = clamp01((radialDistance - 0.28) / 0.2);
  if (edgeStrength <= 0) {
    return { x: 0, y: 0 };
  }

  const unitX = normalizedX / radialDistance;
  const unitY = normalizedY / radialDistance;
  const tangentX = -unitY;
  const tangentY = unitX;
  const tangentialVelocity = model.vx * tangentX + model.vy * tangentY;
  const inwardPull = 108 * edgeStrength;
  const tangentBrake = tangentialVelocity * 1.42 * edgeStrength;

  return {
    x: (-unitX * inwardPull) - (tangentX * tangentBrake),
    y: (-unitY * inwardPull) - (tangentY * tangentBrake),
  };
}

function createMulberry32(seed: number) {
  let value = seed >>> 0;

  return () => {
    value += 0x6d2b79f5;
    let output = Math.imul(value ^ (value >>> 15), 1 | value);
    output ^= output + Math.imul(output ^ (output >>> 7), 61 | output);
    return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
  };
}

function recentBallsFromSignature(signature: string) {
  if (signature.trim().length === 0) {
    return [];
  }

  return signature
    .split(",")
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));
}

function normalizeBallNumber(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function normalizeSymmetric(value: number) {
  return (clamp01(value) - 0.5) * 2;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function swingWave(value: number) {
  return (Math.asin(Math.sin(value)) * 2) / Math.PI;
}

function easeInQuad(value: number) {
  return value * value;
}

function easeInCubic(value: number) {
  return value * value * value;
}

function easeOutCubic(value: number) {
  const inverted = 1 - value;
  return 1 - inverted * inverted * inverted;
}

function easeInOutCubic(value: number) {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function easeOutBack(value: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2);
}

function noise(seed: number, time: number) {
  return 0.5 + Math.sin(seed + time) * 0.25 + Math.cos((seed * 0.73) + time * 1.7) * 0.25;
}
