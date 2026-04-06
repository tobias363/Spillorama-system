import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { applyTheme1DrawPresentation } from "@/domain/theme1/applyTheme1DrawPresentation";
import type { Theme1RoundRenderModel } from "@/domain/theme1/renderModel";
import { THEME1_DRAW_PRESENTATION_MS } from "@/domain/theme1/theme1MachineAnimation";
import { resolveVisibleRecentBalls } from "@/features/theme1/components/Theme1GameShell";
import { Theme1Playfield } from "@/features/theme1/components/Theme1Playfield";
import { Theme1TopperStrip } from "@/features/theme1/components/Theme1TopperStrip";
import { theme1MockSnapshot } from "@/features/theme1/data/theme1MockSnapshot";
import integratedSceneUrl from "../../../../bilder/ny bakgrunn.jpg";
import "./theme1AnimationLab.css";

const THEME1_LAB_STAGE_WIDTH = 1365;
const THEME1_LAB_STAGE_HEIGHT = 768;

const THEME1_MACHINE_DEMO_SEQUENCE = [
  34, 47, 12, 55, 8, 41, 23, 60, 17, 28,
  3, 39, 52, 14, 57, 21, 33, 6, 45, 18,
  50, 27, 9, 43, 30, 1, 36, 24, 58, 11,
];
const IDLE_BONUS_STATE = {
  status: "idle" as const,
  slotCount: 0,
  pickLimit: 0,
  selectedSlotIds: [],
  slots: [],
  payoutTable: [],
  result: {
    matchedSymbolId: null,
    winAmount: 0,
    isWin: false,
  },
};
const INITIAL_LAB_MODEL: Theme1RoundRenderModel = {
  ...theme1MockSnapshot,
  featuredBallNumber: null,
  featuredBallIsPending: false,
  recentBalls: [],
  hud: {
    ...theme1MockSnapshot.hud,
    nesteTrekkOm: "",
  },
  meta: {
    ...theme1MockSnapshot.meta,
    source: "mock",
    connectionPhase: "mock",
    connectionLabel: "Animation lab",
    drawCount: 0,
    remainingNumbers: 60,
    gameStatus: "RUNNING",
  },
};

function resolveTheme1LabStageScale() {
  if (typeof window === "undefined") {
    return 1;
  }

  return Math.min(
    window.innerWidth / THEME1_LAB_STAGE_WIDTH,
    window.innerHeight / THEME1_LAB_STAGE_HEIGHT,
  );
}

export function Theme1AnimationLab() {
  const [snapshot, setSnapshot] = useState<Theme1RoundRenderModel>(INITIAL_LAB_MODEL);
  const [displayedRecentBalls, setDisplayedRecentBalls] = useState<number[]>([]);
  const [stageScale, setStageScale] = useState(() => resolveTheme1LabStageScale());
  const activeDrawNumberRef = useRef<number | null>(null);
  const drawIndexRef = useRef(0);
  const scheduleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playfieldBoards = useMemo(
    () =>
      snapshot.boards.map((board) => ({
        ...board,
        progressLabel: "",
        progressState: "hidden" as const,
        activeNearPatterns: [],
        completedPatterns: [],
        prizeStacks: [],
      })),
    [snapshot.boards],
  );

  const clearPendingTimeouts = useCallback(() => {
    if (scheduleTimeoutRef.current) {
      window.clearTimeout(scheduleTimeoutRef.current);
      scheduleTimeoutRef.current = null;
    }

    if (settleTimeoutRef.current) {
      window.clearTimeout(settleTimeoutRef.current);
      settleTimeoutRef.current = null;
    }
  }, []);

  const scheduleNextDraw = useCallback((delayMs: number) => {
    clearPendingTimeouts();

    scheduleTimeoutRef.current = window.setTimeout(() => {
      const nextNumber = THEME1_MACHINE_DEMO_SEQUENCE[drawIndexRef.current] ?? null;
      if (nextNumber === null || activeDrawNumberRef.current !== null) {
        return;
      }

      activeDrawNumberRef.current = nextNumber;

      setSnapshot((currentState) => {
        const presented = applyTheme1DrawPresentation(currentState, nextNumber, {
          markBoards: true,
        });

        return {
          ...presented,
          meta: {
            ...presented.meta,
            gameStatus: "RUNNING",
            drawCount: drawIndexRef.current + 1,
            remainingNumbers: Math.max(0, 60 - (drawIndexRef.current + 1)),
          },
        };
      });

      settleTimeoutRef.current = window.setTimeout(() => {
        setSnapshot((currentState) => {
          if (currentState.featuredBallNumber !== nextNumber || !currentState.featuredBallIsPending) {
            return currentState;
          }

          return {
            ...currentState,
            featuredBallNumber: null,
            featuredBallIsPending: false,
          };
        });
      }, THEME1_DRAW_PRESENTATION_MS);
    }, delayMs);
  }, [clearPendingTimeouts]);

  useEffect(() => {
    drawIndexRef.current = 0;
    activeDrawNumberRef.current = null;
    scheduleNextDraw(2000);
    return () => {
      clearPendingTimeouts();
    };
  }, [clearPendingTimeouts, scheduleNextDraw]);

  const handleRailFlightSettled = useCallback((ballNumber: number) => {
    if (activeDrawNumberRef.current !== ballNumber) {
      return;
    }

    activeDrawNumberRef.current = null;
    drawIndexRef.current += 1;

    if (drawIndexRef.current >= THEME1_MACHINE_DEMO_SEQUENCE.length) {
      clearPendingTimeouts();
      scheduleTimeoutRef.current = window.setTimeout(() => {
        drawIndexRef.current = 0;
        activeDrawNumberRef.current = null;
        setSnapshot(INITIAL_LAB_MODEL);
        setDisplayedRecentBalls([]);
        scheduleNextDraw(1400);
      }, 2200);
      return;
    }

    scheduleNextDraw(2000);
  }, [clearPendingTimeouts, scheduleNextDraw]);

  useEffect(() => {
    setDisplayedRecentBalls(
      resolveVisibleRecentBalls(
        snapshot.recentBalls,
        snapshot.featuredBallNumber,
        snapshot.featuredBallIsPending,
      ),
    );
  }, [
    snapshot.recentBalls,
    snapshot.featuredBallNumber,
    snapshot.featuredBallIsPending,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const syncStageScale = () => {
      setStageScale(resolveTheme1LabStageScale());
    };

    syncStageScale();
    window.addEventListener("resize", syncStageScale);
    return () => {
      window.removeEventListener("resize", syncStageScale);
    };
  }, []);

  return (
    <main
      className="theme1-app theme1-animation-lab"
      style={
        {
          backgroundImage: `linear-gradient(180deg, rgba(102, 35, 129, 0.08), rgba(48, 7, 58, 0.18)), url(${integratedSceneUrl})`,
          "--theme1-live-backdrop-image": `url(${integratedSceneUrl})`,
          "--theme1-stage-scale": String(stageScale),
        } as CSSProperties
      }
    >
      <div className="theme1-app__backdrop" />

      <aside className="theme1-animation-lab__badge">
        <div className="theme1-animation-lab__badge-copy">
          <span>Theme1 animation lab</span>
          <strong>Lokal kopi av dagens spillscene</strong>
        </div>
        <a className="theme1-animation-lab__badge-link" href="/">
          Til spillshell
        </a>
      </aside>

      <div className="theme1-app__viewport">
        <div className="theme1-app__chrome theme1-animation-lab__chrome">
          <Theme1TopperStrip toppers={snapshot.toppers} />
          <Theme1Playfield
            bonusActive={false}
            bonus={IDLE_BONUS_STATE}
            boards={playfieldBoards}
            hud={snapshot.hud}
            meta={snapshot.meta}
            recentBalls={snapshot.recentBalls}
            displayedRecentBalls={displayedRecentBalls}
            featuredBall={snapshot.featuredBallNumber}
            featuredBallIsPending={snapshot.featuredBallIsPending}
            celebration={null}
            stakeBusy={false}
            rerollBusy={false}
            betBusy={false}
            isBetArmed={false}
            onDecreaseStake={() => {}}
            onIncreaseStake={() => {}}
            onShuffle={() => {}}
            onPlaceBet={() => {}}
            onOpenBonusTest={() => {}}
            onResetBonusTest={() => {}}
            onSelectBonusSlot={() => {}}
            onCloseBonusTest={() => {}}
            onRailFlightSettled={handleRailFlightSettled}
            showHudControls={false}
            showCountdownPanel={false}
            showBallRail
          />
        </div>
      </div>
    </main>
  );
}
