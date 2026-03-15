import { useEffect, useState } from "react";
import type {
  Theme1BoardPatternOverlayState,
  Theme1BoardPrizeStackState,
  Theme1BoardState,
  Theme1CellState,
  Theme1TopperState,
} from "@/domain/theme1/renderModel";
import { THEME1_DRAW_PRESENTATION_MS } from "@/domain/theme1/theme1MachineAnimation";
import { Theme1DrawMachine } from "@/features/theme1/components/Theme1DrawMachine";
import { theme1Assets } from "@/features/theme1/data/theme1Assets";
import { theme1MockSnapshot } from "@/features/theme1/data/theme1MockSnapshot";
import { theme1TopperCatalog } from "@/features/theme1/data/theme1TopperCatalog";
import "./theme1AnimationLab.css";

interface Theme1MachineDemoState {
  drawCount: number;
  featuredBallNumber: number | null;
  featuredBallIsPending: boolean;
  recentBalls: readonly number[];
}

const THEME1_MACHINE_DEMO_SEQUENCE = [34, 47, 12, 55, 8, 41, 23, 60, 17, 28, 3, 39];

const INITIAL_MACHINE_DEMO_STATE: Theme1MachineDemoState = {
  drawCount: 0,
  featuredBallNumber: null,
  featuredBallIsPending: false,
  recentBalls: [],
};
const USE_INTEGRATED_MACHINE_SCENE = true;

export function Theme1AnimationLab() {
  const [machineDemo, setMachineDemo] = useState(INITIAL_MACHINE_DEMO_STATE);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let drawIndex = 0;

    const queueNextDraw = (delayMs: number) => {
      timeoutId = window.setTimeout(() => {
        if (cancelled) {
          return;
        }

        const nextNumber = THEME1_MACHINE_DEMO_SEQUENCE[drawIndex];
        if (typeof nextNumber !== "number") {
          return;
        }

        setMachineDemo((currentState) => ({
          drawCount: currentState.drawCount + 1,
          featuredBallNumber: nextNumber,
          featuredBallIsPending: true,
          recentBalls: [...currentState.recentBalls, nextNumber],
        }));

        timeoutId = window.setTimeout(() => {
          if (cancelled) {
            return;
          }

          setMachineDemo((currentState) => ({
            ...currentState,
            featuredBallNumber: nextNumber,
            featuredBallIsPending: false,
          }));

          drawIndex += 1;

          if (drawIndex >= THEME1_MACHINE_DEMO_SEQUENCE.length) {
            timeoutId = window.setTimeout(() => {
              if (cancelled) {
                return;
              }

              drawIndex = 0;
              setMachineDemo(INITIAL_MACHINE_DEMO_STATE);
              queueNextDraw(1400);
            }, 2200);
            return;
          }

          queueNextDraw(1600);
        }, THEME1_DRAW_PRESENTATION_MS);
      }, delayMs);
    };

    queueNextDraw(1200);

    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  return (
    <main
      className={`theme1-animation-lab${USE_INTEGRATED_MACHINE_SCENE ? " theme1-animation-lab--integrated-scene" : ""}`.trim()}
      style={
        USE_INTEGRATED_MACHINE_SCENE
          ? undefined
          : {
              backgroundImage: `linear-gradient(180deg, rgba(255, 245, 251, 0.02), rgba(255, 245, 251, 0.12)), url(${theme1Assets.backgroundUrl})`,
            }
      }
    >
      <div className="theme1-animation-lab__backdrop" />

      <aside className="theme1-animation-lab__badge">
        <div className="theme1-animation-lab__badge-copy">
          <span>Theme1 animation lab</span>
          <strong>Isolert kopi av bakgrunn og bonger</strong>
        </div>
        <a className="theme1-animation-lab__badge-link" href="/">
          Til spillshell
        </a>
      </aside>

      {USE_INTEGRATED_MACHINE_SCENE ? (
        <section className="theme1-animation-lab__integrated-stage">
          <Theme1DrawMachine
            drawCount={machineDemo.drawCount}
            featuredBallNumber={machineDemo.featuredBallNumber}
            featuredBallIsPending={machineDemo.featuredBallIsPending}
            recentBalls={machineDemo.recentBalls}
            variant="integrated-scene"
          />
        </section>
      ) : (
        <div className="theme1-animation-lab__chrome">
          <Theme1AnimationLabTopperStrip toppers={theme1MockSnapshot.toppers} />

          <section className="lab-playfield">
            <Theme1AnimationLabPatternSprite />

            <div className="lab-playfield__board-anchor lab-playfield__board-anchor--top-left">
              <Theme1AnimationLabBoardCard board={theme1MockSnapshot.boards[0]} compact />
            </div>

            <div className="lab-playfield__board-anchor lab-playfield__board-anchor--top-right">
              <Theme1AnimationLabBoardCard board={theme1MockSnapshot.boards[1]} compact />
            </div>

            <div className="lab-playfield__board-anchor lab-playfield__board-anchor--bottom-left">
              <Theme1AnimationLabBoardCard board={theme1MockSnapshot.boards[2]} compact />
            </div>

            <div className="lab-playfield__board-anchor lab-playfield__board-anchor--bottom-right">
              <Theme1AnimationLabBoardCard board={theme1MockSnapshot.boards[3]} compact />
            </div>

            <div className="lab-playfield__draw-anchor">
              <Theme1DrawMachine
                drawCount={machineDemo.drawCount}
                featuredBallNumber={machineDemo.featuredBallNumber}
                featuredBallIsPending={machineDemo.featuredBallIsPending}
                recentBalls={machineDemo.recentBalls}
              />
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function Theme1AnimationLabTopperStrip({
  toppers,
}: {
  toppers: readonly Theme1TopperState[];
}) {
  const toppersById = new Map(toppers.map((topper) => [topper.id, topper]));
  const leftLane = theme1TopperCatalog.slice(0, 6);
  const rightLane = theme1TopperCatalog.slice(6, 12);

  return (
    <section className="lab-topper-strip">
      <div className="lab-topper-strip__lane lab-topper-strip__lane--left">
        {leftLane.map((design) => (
          <Theme1AnimationLabTopperCard
            key={design.id}
            design={design}
            topper={toppersById.get(design.id)}
          />
        ))}
      </div>

      <div className="lab-topper-strip__brand" aria-hidden="true">
        <img src={theme1Assets.candyManiaLogoUrl} alt="" />
      </div>

      <div className="lab-topper-strip__lane lab-topper-strip__lane--right">
        {rightLane.map((design) => (
          <Theme1AnimationLabTopperCard
            key={design.id}
            design={design}
            topper={toppersById.get(design.id)}
          />
        ))}
      </div>
    </section>
  );
}

function Theme1AnimationLabTopperCard({
  design,
  topper,
}: {
  design: (typeof theme1TopperCatalog)[number];
  topper: Theme1TopperState | undefined;
}) {
  const prize = topper?.prize?.trim() || "0 kr";
  const highlighted = Boolean(topper?.highlighted);

  return (
    <article
      className={`lab-topper-strip__card${highlighted ? " lab-topper-strip__card--active" : ""}`.trim()}
      aria-label={`Mønster ${design.displayNumber} ${prize}`}
    >
      <div
        className={`lab-generated-topper lab-generated-topper--${design.theme}${design.blankBoard ? " lab-generated-topper--blank-board" : ""}`.trim()}
      >
        <div className="lab-generated-topper__body">
          <div className="lab-generated-topper__grid">
            {design.uiCells.map((cellState, index) => (
              <div
                key={`${design.id}-${index}`}
                className={`lab-generated-topper__grid-cell${!design.blankBoard && cellState === 1 ? " lab-generated-topper__grid-cell--active" : ""}`.trim()}
              />
            ))}
          </div>

          {design.heroBadgeUrl ? (
            <img
              className="lab-generated-topper__hero-badge"
              src={design.heroBadgeUrl}
              alt={design.heroBadgeAlt || "Pattern badge"}
            />
          ) : null}
        </div>
      </div>

      <div className="lab-topper-strip__prize-field">
        <span className="lab-topper-strip__prize-label">{prize}</span>
      </div>
    </article>
  );
}

function Theme1AnimationLabBoardCard({
  board,
  compact = false,
}: {
  board: Theme1BoardState | undefined;
  compact?: boolean;
}) {
  if (!board) {
    return null;
  }

  const prizeStacksByCell = new Map<number, Theme1BoardPrizeStackState>(
    board.prizeStacks.map((stack) => [stack.cellIndex, stack]),
  );

  return (
    <article className={`lab-board-card${compact ? " lab-board-card--compact" : ""}`.trim()}>
      <header className="lab-board-card__header">
        <div>
          <span>{board.label}</span>
          <strong>{board.win}</strong>
        </div>
        <small>Innsats {board.stake}</small>
      </header>

      <div className="lab-board-card__shell">
        <img
          className="lab-board-card__shell-image"
          src={theme1Assets.bongShellUrl}
          alt=""
          aria-hidden="true"
        />

        <div className="lab-board-card__grid-stage">
          <div className="lab-board__pattern-layers" aria-hidden="true">
            {board.completedPatterns.map((pattern) => (
              <div key={pattern.key} className="lab-board__pattern-layer">
                <Theme1AnimationLabPatternOverlay pattern={pattern} />
              </div>
            ))}

            {board.activeNearPatterns.map((pattern) => (
              <div
                key={pattern.key}
                className="lab-board__pattern-layer lab-board__pattern-layer--near"
              >
                <Theme1AnimationLabPatternOverlay pattern={pattern} />
              </div>
            ))}
          </div>

          <div className="lab-board">
            {board.cells.map((cell) => {
              const stack = prizeStacksByCell.get(cell.index);

              return (
                <div
                  key={cell.index}
                  className={`lab-board__cell${resolveToneClassName(cell)}`.trim()}
                >
                  {cell.tone === "target" ? (
                    <img
                      className="lab-board__cell-target-glow"
                      src={theme1Assets.oneToGoGlowUrl}
                      alt=""
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="lab-board__cell-surface" />
                  <span className="lab-board__cell-number">{cell.value > 0 ? cell.value : ""}</span>
                  {stack ? <Theme1AnimationLabPrizeStack stack={stack} /> : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </article>
  );
}

function Theme1AnimationLabPatternSprite() {
  return (
    <div
      className="lab-board-grid__pattern-sprite"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: theme1Assets.patternOverlaySpriteMarkup }}
    />
  );
}

function Theme1AnimationLabPatternOverlay({
  pattern,
}: {
  pattern: Theme1BoardPatternOverlayState;
}) {
  if (pattern.symbolId) {
    return (
      <svg viewBox="0 0 500 300" role="presentation">
        <use href={`#${pattern.symbolId}`} />
      </svg>
    );
  }

  if (pattern.pathDefinition) {
    return (
      <svg viewBox="0 0 500 300" role="presentation">
        <path
          d={pattern.pathDefinition}
          fill="none"
          stroke="rgba(116, 21, 149, 0.92)"
          strokeWidth={18}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return null;
}

function Theme1AnimationLabPrizeStack({
  stack,
}: {
  stack: Theme1BoardPrizeStackState;
}) {
  return (
    <div className={`lab-board__prize-stack lab-board__prize-stack--${stack.anchor}`}>
      {stack.labels.map((label) => (
        <span
          key={`${label.rawPatternIndex}-${label.text}`}
          className="lab-board__prize-chip"
        >
          {label.text}
        </span>
      ))}
    </div>
  );
}

function resolveToneClassName(cell: Theme1CellState) {
  if (cell.tone === "target") {
    return " lab-board__cell--target";
  }

  if (cell.tone === "won") {
    return " lab-board__cell--matched";
  }

  if (cell.tone === "matched") {
    return " lab-board__cell--matched";
  }

  return "";
}
