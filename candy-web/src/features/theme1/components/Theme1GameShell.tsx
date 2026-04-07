import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTheme1Store } from "@/features/theme1/hooks/useTheme1Store";
import { isLocalTheme1RuntimeHost } from "@/features/theme1/hooks/useTheme1Store";
import { Theme1ConnectionPanel } from "@/features/theme1/components/Theme1ConnectionPanel";
import { Theme1TopperStrip } from "@/features/theme1/components/Theme1TopperStrip";
import { Theme1Playfield } from "@/features/theme1/components/Theme1Playfield";
import { theme1Assets } from "@/features/theme1/data/theme1Assets";
import {
  resolveSchedulerCountdownLabel,
  resolveVisibleCountdownPanelLabel,
} from "@/domain/theme1/schedulerCountdown";
import type { Theme1ConnectionPhase, Theme1DataSource } from "@/domain/theme1/renderModel";
import integratedSceneUrl from "../../../../bilder/ny bakgrunn.jpg";

export type Theme1BonusTestMode = "random" | "win";

const THEME1_LIVE_STAGE_WIDTH = 1365;
const THEME1_LIVE_STAGE_HEIGHT = 768;
const THEME1_POST_ROUND_COUNTDOWN_DELAY_MS = 5000;
// Settle delay removed — show game immediately when roomSnapshot is ready.
// Previously waited 6000ms after connection, hiding the game behind a spinner.

function resolveTheme1StageScale() {
  if (typeof window === "undefined") {
    return 1;
  }

  return Math.min(
    window.innerWidth / THEME1_LIVE_STAGE_WIDTH,
    window.innerHeight / THEME1_LIVE_STAGE_HEIGHT,
  );
}

export function resolveBonusTestMode(search: string): Theme1BonusTestMode | null {
  const params = new URLSearchParams(search);
  const value = params.get("bonusTest")?.trim().toLowerCase();

  if (value === "random" || value === "win") {
    return value;
  }

  return null;
}

export function shouldDeferTheme1LiveChrome({
  hostname,
  mode,
  connectionPhase,
  hasRoomSnapshot,
}: {
  hostname: string;
  mode: Theme1DataSource;
  connectionPhase: Theme1ConnectionPhase;
  hasRoomSnapshot: boolean;
}) {
  if (isLocalTheme1RuntimeHost(hostname)) {
    return false;
  }

  if (mode === "live" && connectionPhase === "connected" && hasRoomSnapshot) {
    return false;
  }

  if (connectionPhase === "error" || connectionPhase === "disconnected") {
    return false;
  }

  return true;
}

export function shouldHoldTheme1LiveChromeDuringSettle({
  hostname,
  mode,
  connectionPhase,
  hasRoomSnapshot,
  settleDelayComplete,
}: {
  hostname: string;
  mode: Theme1DataSource;
  connectionPhase: Theme1ConnectionPhase;
  hasRoomSnapshot: boolean;
  settleDelayComplete: boolean;
}) {
  if (isLocalTheme1RuntimeHost(hostname)) {
    return false;
  }

  if (settleDelayComplete) {
    return false;
  }

  return mode === "live" && connectionPhase === "connected" && hasRoomSnapshot;
}

export function Theme1GameShell() {
  const snapshot = useTheme1Store((state) => state.snapshot);
  const bonus = useTheme1Store((state) => state.bonus);
  const celebration = useTheme1Store((state) => state.celebration);
  const topperPulses = useTheme1Store((state) => state.topperPulses);
  const session = useTheme1Store((state) => state.session);
  const connect = useTheme1Store((state) => state.connect);
  const roomSnapshot = useTheme1Store((state) => state.roomSnapshot);
  const mode = useTheme1Store((state) => state.mode);
  const connection = useTheme1Store((state) => state.connection);
  const mockBetArmed = useTheme1Store((state) => state.mockBetArmed);
  const stakeBusy = useTheme1Store((state) => state.stakeBusy);
  const rerollBusy = useTheme1Store((state) => state.rerollBusy);
  const betBusy = useTheme1Store((state) => state.betBusy);
  const changeStake = useTheme1Store((state) => state.changeStake);
  const rerollTickets = useTheme1Store((state) => state.rerollTickets);
  const toggleBetArm = useTheme1Store((state) => state.toggleBetArm);
  const openBonusTest = useTheme1Store((state) => state.openBonusTest);
  const openWinningBonusTest = useTheme1Store((state) => state.openWinningBonusTest);
  const selectBonusSlot = useTheme1Store((state) => state.selectBonusSlot);
  const resetBonusTest = useTheme1Store((state) => state.resetBonusTest);
  const closeBonusTest = useTheme1Store((state) => state.closeBonusTest);
  const hostname =
    typeof window !== "undefined" ? window.location.hostname.trim().toLowerCase() : "";
  const [countdownNowMs, setCountdownNowMs] = useState(() => Date.now());
  const [stageScale, setStageScale] = useState(() => resolveTheme1StageScale());
  const [displayedRecentBalls, setDisplayedRecentBalls] = useState<number[]>(snapshot.recentBalls);
  const [frozenRoundBalls, setFrozenRoundBalls] = useState<number[]>([]);
  const [countdownHiddenUntilMs, setCountdownHiddenUntilMs] = useState(0);
  // Always true — no settle delay. Game visible as soon as roomSnapshot exists.
  const liveChromeSettleComplete = true;
  const handledBonusSearchRef = useRef<string>("");
  const previousGameStatusRef = useRef(snapshot.meta.gameStatus);
  const isBonusActive = bonus.status !== "idle";
  // Only block chrome while we're actively connecting and have no data yet.
  // Once roomSnapshot exists OR we're on localhost, show the game immediately.
  const shouldDeferChrome = shouldDeferTheme1LiveChrome({
    hostname,
    mode,
    connectionPhase: connection.phase,
    hasRoomSnapshot: roomSnapshot !== null,
  });
  const shouldHoldChromeDuringSettle = false; // settle delay removed
  const shouldBlockChrome = shouldDeferChrome;
  const shouldShowBootstrapError =
    shouldBlockChrome === false &&
    !isLocalTheme1RuntimeHost(hostname) &&
    connection.phase === "error" &&
    roomSnapshot === null;

  const isBetArmed =
    mode === "live"
      ? session.playerId.trim().length > 0 &&
        (roomSnapshot?.scheduler.armedPlayerIds ?? []).includes(session.playerId.trim())
      : mockBetArmed;

  const schedulerCountdownLabel = resolveSchedulerCountdownLabel(
    roomSnapshot?.scheduler,
    snapshot.hud.nesteTrekkOm,
    countdownNowMs,
    snapshot.meta.gameStatus,
  );
  const countdownLabel = resolveVisibleCountdownPanelLabel(
    schedulerCountdownLabel,
    countdownNowMs,
    countdownHiddenUntilMs,
    snapshot.meta.gameStatus,
  );
  const shouldTickCountdownClock =
    Boolean(roomSnapshot?.scheduler?.enabled) || countdownHiddenUntilMs > countdownNowMs;
  const backgroundImage = isBonusActive
    ? `linear-gradient(180deg, rgba(255, 245, 251, 0.02), rgba(255, 245, 251, 0.12)), url(${theme1Assets.bonusBackgroundUrl})`
    : `linear-gradient(180deg, rgba(102, 35, 129, 0.08), rgba(48, 7, 58, 0.18)), url(${integratedSceneUrl})`;

  useEffect(() => {
    void connect();
  }, [connect]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const search = window.location.search;
    if (search === handledBonusSearchRef.current) {
      return;
    }

    handledBonusSearchRef.current = search;

    const bonusTestMode = resolveBonusTestMode(search);
    if (bonusTestMode === "random") {
      openBonusTest();
      return;
    }

    if (bonusTestMode === "win") {
      openWinningBonusTest();
    }
  }, [openBonusTest, openWinningBonusTest]);

  useEffect(() => {
    const previousGameStatus = previousGameStatusRef.current;
    const currentGameStatus = snapshot.meta.gameStatus;

    if (previousGameStatus === "RUNNING" && currentGameStatus !== "RUNNING") {
      setCountdownHiddenUntilMs(Date.now() + THEME1_POST_ROUND_COUNTDOWN_DELAY_MS);
      // Freeze the balls from the finished round so they stay visible
      // until we actively clear the rail (4s before next round).
      setFrozenRoundBalls(snapshot.recentBalls.length > 0 ? [...snapshot.recentBalls] : frozenRoundBalls);
    } else if (currentGameStatus === "RUNNING") {
      setCountdownHiddenUntilMs(0);
      setFrozenRoundBalls([]);
    }

    previousGameStatusRef.current = currentGameStatus;
  }, [snapshot.meta.gameStatus]);

  // Settle delay useEffect removed — liveChromeSettleComplete is always true.
  // Game chrome is shown immediately when roomSnapshot is available.

  useEffect(() => {
    if (!shouldTickCountdownClock || snapshot.meta.gameStatus === "RUNNING") {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setCountdownNowMs(Date.now());
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    shouldTickCountdownClock,
    roomSnapshot?.scheduler?.nextStartAt,
    roomSnapshot?.scheduler?.millisUntilNextStart,
    roomSnapshot?.scheduler?.serverTime,
    countdownHiddenUntilMs,
    snapshot.meta.gameStatus,
  ]);

  // Clear the ball rail 5 seconds before the next round starts.
  const schedulerTargetMs = useMemo(() => {
    const scheduler = roomSnapshot?.scheduler;
    if (!scheduler?.enabled || !scheduler.nextStartAt) return null;
    const parsed = Date.parse(scheduler.nextStartAt);
    return Number.isFinite(parsed) ? parsed : null;
  }, [roomSnapshot?.scheduler?.nextStartAt, roomSnapshot?.scheduler?.enabled]);

  const shouldClearRailForNextRound =
    snapshot.meta.gameStatus !== "RUNNING" &&
    schedulerTargetMs !== null &&
    schedulerTargetMs - countdownNowMs <= 4000 &&
    countdownLabel.length > 0;

  // ── Board mark clearing logic ──────────────────────────────────
  // Armed players: fade out marks 3s before next round.
  // Unarmed players: keep marks through the next round, clear at the
  // start of the round after that (one full round of review time).
  const [boardMarksPreservedForRoundId, setBoardMarksPreservedForRoundId] = useState("");
  const currentGameId = roomSnapshot?.currentGame?.id ?? "";

  const shouldClearBoardMarks = useMemo(() => {
    if (snapshot.meta.gameStatus === "RUNNING") return false;
    if (schedulerTargetMs === null) return false;
    const msUntilNext = schedulerTargetMs - countdownNowMs;

    if (isBetArmed) {
      // Armed: clear 3s before next round
      return msUntilNext <= 3000 && countdownLabel.length > 0;
    }

    // Unarmed: marks survive one full round. If the preserved round ID
    // is set and differs from the current game (= a new round passed),
    // it's time to clear.
    if (boardMarksPreservedForRoundId && boardMarksPreservedForRoundId !== currentGameId) {
      return true;
    }
    return false;
  }, [snapshot.meta.gameStatus, schedulerTargetMs, countdownNowMs, countdownLabel, isBetArmed, boardMarksPreservedForRoundId, currentGameId]);

  // Track when a round ends while unarmed — record the game ID so marks
  // survive exactly one more round.
  useEffect(() => {
    const prevStatus = previousGameStatusRef.current;
    if (prevStatus === "RUNNING" && snapshot.meta.gameStatus !== "RUNNING" && !isBetArmed) {
      setBoardMarksPreservedForRoundId(currentGameId);
    }
    if (snapshot.meta.gameStatus === "RUNNING" && boardMarksPreservedForRoundId && boardMarksPreservedForRoundId !== currentGameId) {
      // New round started — marks from preserved round should clear
      setBoardMarksPreservedForRoundId("");
    }
  }, [snapshot.meta.gameStatus, isBetArmed, currentGameId, boardMarksPreservedForRoundId]);

  // Build boards with marks cleared when needed
  const playfieldBoards = useMemo(() => {
    if (!shouldClearBoardMarks) return snapshot.boards;
    return snapshot.boards.map((board) => ({
      ...board,
      cells: board.cells.map((cell) => ({
        ...cell,
        tone: "idle" as const,
      })),
      completedPatterns: [],
    }));
  }, [shouldClearBoardMarks, snapshot.boards]);

  // Memoize so clearing doesn't create a new [] reference on every render
  // (countdownNowMs updates every 250ms while clearing is active).
  // Between rounds snapshot.recentBalls may be empty (store resets for the
  // next game), so fall back to the frozen balls from the finished round.
  const playfieldRecentBalls = useMemo(() => {
    if (shouldClearRailForNextRound) {
      return [] as number[];
    }
    if (snapshot.recentBalls.length > 0) {
      return snapshot.recentBalls;
    }
    return frozenRoundBalls;
  }, [shouldClearRailForNextRound, snapshot.recentBalls, frozenRoundBalls]);

  useEffect(() => {
    if (shouldClearRailForNextRound) {
      setDisplayedRecentBalls([]);
      // Clear frozen balls so they never reappear when the next round starts.
      setFrozenRoundBalls([]);
      return;
    }

    if (snapshot.meta.gameStatus === "RUNNING" && snapshot.meta.drawCount === 0) {
      setDisplayedRecentBalls([]);
      return;
    }

    setDisplayedRecentBalls(
      resolveVisibleRecentBalls(snapshot.recentBalls, snapshot.featuredBallNumber, snapshot.featuredBallIsPending),
    );
  }, [
    shouldClearRailForNextRound,
    snapshot.meta.drawCount,
    snapshot.meta.gameStatus,
    snapshot.recentBalls,
    snapshot.featuredBallNumber,
    snapshot.featuredBallIsPending,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const syncStageScale = () => {
      setStageScale(resolveTheme1StageScale());
    };

    syncStageScale();
    window.addEventListener("resize", syncStageScale);

    return () => {
      window.removeEventListener("resize", syncStageScale);
    };
  }, []);

  return (
    <main
      className={`theme1-app${isBonusActive ? " theme1-app--bonus-active" : ""}`.trim()}
      style={
        {
          backgroundImage,
          "--theme1-live-backdrop-image": isBonusActive ? "none" : `url(${integratedSceneUrl})`,
          "--theme1-stage-scale": String(stageScale),
        } as CSSProperties
      }
    >
      <div className="theme1-app__backdrop" />

      <div className="theme1-app__viewport">
        {shouldBlockChrome ? (
          <section className="theme1-app__gate" aria-live="polite">
            <div className="theme1-app__gate-card">
              <img
                className="theme1-app__gate-logo"
                src={theme1Assets.candyManiaLogoUrl}
                alt="Candy"
              />
              <div className="theme1-app__gate-spinner" aria-hidden="true" />
              <strong>{connection.label || "Kobler til"}</strong>
              <p>
                {shouldHoldChromeDuringSettle
                  ? "Synkroniserer live-rom og klargjør aktiv trekning..."
                  : (connection.message || "Laster live-rom og synkroniserer aktiv trekning...")}
              </p>
            </div>
          </section>
        ) : shouldShowBootstrapError ? (
          <section className="theme1-app__gate" aria-live="polite">
            <div className="theme1-app__gate-card theme1-app__gate-card--error">
              <img
                className="theme1-app__gate-logo"
                src={theme1Assets.candyManiaLogoUrl}
                alt="Candy"
              />
              <strong>Klarte ikke laste live-rommet</strong>
              <p>{connection.message || "Prøv igjen om et øyeblikk."}</p>
              <button type="button" onClick={() => void connect()}>
                Prøv igjen
              </button>
            </div>
          </section>
        ) : (
          <div className={`theme1-app__chrome${isBonusActive ? " theme1-app__chrome--bonus-active" : ""}`.trim()}>
            <section className="theme1-app__topbar">
              <div className="theme1-app__brand">
                <p className="theme1-app__eyebrow">Candy Web</p>
                <strong>Theme1 live runtime</strong>
              </div>

              <div className="theme1-app__status-chips">
                <span>{snapshot.meta.connectionLabel}</span>
                <span>{snapshot.meta.gameStatus}</span>
                <span>{snapshot.meta.roomCode || "Ingen room valgt"}</span>
                <span>{snapshot.meta.drawCount} trekk</span>
              </div>
            </section>

            {bonus.status === "idle" ? (
              <Theme1TopperStrip toppers={snapshot.toppers} topperPulses={topperPulses} />
            ) : null}
            <Theme1Playfield
              bonusActive={isBonusActive}
              bonus={bonus}
              boards={playfieldBoards}
              hud={{
                ...snapshot.hud,
                nesteTrekkOm: countdownLabel,
              }}
              meta={snapshot.meta}
              recentBalls={playfieldRecentBalls}
              displayedRecentBalls={displayedRecentBalls}
              featuredBall={snapshot.featuredBallNumber}
              featuredBallIsPending={snapshot.featuredBallIsPending}
              celebration={celebration}
              stakeBusy={stakeBusy}
              rerollBusy={rerollBusy}
              betBusy={betBusy}
              isBetArmed={isBetArmed}
              onDecreaseStake={() => void changeStake(-4)}
              onIncreaseStake={() => void changeStake(4)}
              onShuffle={() => void rerollTickets()}
              onPlaceBet={() => void toggleBetArm()}
              onOpenBonusTest={openBonusTest}
              onResetBonusTest={resetBonusTest}
              onSelectBonusSlot={selectBonusSlot}
              onCloseBonusTest={closeBonusTest}
            />
            {isBonusActive ? null : <Theme1ConnectionPanel />}
          </div>
        )}
      </div>
    </main>
  );
}

export function resolveVisibleRecentBalls(
  recentBalls: readonly number[],
  featuredBallNumber: number | null,
  featuredBallIsPending: boolean,
) {
  if (!featuredBallIsPending || recentBalls.length === 0) {
    return [...recentBalls];
  }

  const normalizedFeatured =
    typeof featuredBallNumber === "number" && Number.isFinite(featuredBallNumber)
      ? Math.trunc(featuredBallNumber)
      : null;
  const lastRecentBall = recentBalls[recentBalls.length - 1] ?? null;

  if (normalizedFeatured === null || lastRecentBall !== normalizedFeatured) {
    return [...recentBalls];
  }

  return recentBalls.slice(0, -1);
}
