import { theme1Assets } from "@/features/theme1/data/theme1Assets";
import type {
  Theme1BoardPatternOverlayState,
  Theme1BoardPrizeStackState,
  Theme1BoardState,
  Theme1CellState,
} from "@/domain/theme1/renderModel";

interface Theme1BoardGridProps {
  boards: Theme1BoardState[];
  cellAnimationSequences?: Record<string, number>;
  spotlightByBoardId?: Record<string, "near" | "win">;
}

interface Theme1BoardCardProps {
  board: Theme1BoardState;
  cellAnimationSequences?: Record<string, number>;
  compact?: boolean;
  spotlightKind?: "near" | "win" | null;
}

function toneClass(cell: Theme1CellState) {
  if (cell.tone === "target") {
    return "board__cell--target";
  }

  if (cell.tone === "won") {
    return "board__cell--matched";
  }

  if (cell.tone === "matched") {
    return "board__cell--matched";
  }

  return "";
}

export function Theme1BoardGrid({
  boards,
  cellAnimationSequences = {},
  spotlightByBoardId = {},
}: Theme1BoardGridProps) {
  return (
    <section className="board-grid">
      <Theme1BoardPatternSprite />
      {boards.map((board) => (
        <Theme1BoardCard
          key={board.id}
          board={board}
          cellAnimationSequences={cellAnimationSequences}
          spotlightKind={spotlightByBoardId[board.id] ?? null}
        />
      ))}
    </section>
  );
}

function Theme1BoardCard({
  board,
  cellAnimationSequences = {},
  compact = false,
  spotlightKind = null,
}: Theme1BoardCardProps) {
  const prizeStacksByCell = new Map<number, Theme1BoardPrizeStackState>(
    board.prizeStacks.map((stack) => [stack.cellIndex, stack]),
  );
  const stakeVisible = hasVisibleKrValue(board.stake);
  const winVisible = hasVisibleKrValue(board.win);
  const topLabels = [
    stakeVisible ? { key: "stake", label: "Innsats", value: board.stake } : null,
    winVisible ? { key: "win", label: "Gevinst", value: board.win } : null,
  ].filter((entry): entry is { key: string; label: string; value: string } => entry !== null);
  const footerLabel = normalizeBoardLabel(board.label);

  return (
    <article
      className={`board-card${compact ? " board-card--compact" : ""}${spotlightKind === "near" ? " board-card--spotlight-near" : ""}${spotlightKind === "win" ? " board-card--spotlight-win" : ""}`.trim()}
    >
      <div className="board-card__shell">
        <img
          className="board-card__shell-image"
          src={theme1Assets.bongShellUrl}
          alt=""
          aria-hidden="true"
        />

        {topLabels.length > 0 ? (
          <div
            className={`board-card__topline${topLabels.length > 1 ? " board-card__topline--split" : " board-card__topline--single"}`.trim()}
          >
            {topLabels.map((entry) => (
              <span
                key={entry.key}
                className={`board-card__topline-label board-card__topline-label--${entry.key}${spotlightKind === "win" && entry.key === "win" ? " board-card__topline-label--celebrate" : ""}`.trim()}
              >
                {entry.label}: {entry.value}
              </span>
            ))}
          </div>
        ) : null}

        <div className="board-card__grid-stage">
          <div className="board__pattern-layers" aria-hidden="true">
            {board.completedPatterns.map((pattern) => (
              <div
                key={pattern.key}
                className={`board__pattern-layer${spotlightKind === "win" ? " board__pattern-layer--celebrate" : ""}`.trim()}
              >
                <PatternOverlay pattern={pattern} />
              </div>
            ))}
          </div>

          <div className="board">
            {board.cells.map((cell) => {
              const stack =
                cell.tone === "target" ? undefined : prizeStacksByCell.get(cell.index);
              const animationSequence =
                cellAnimationSequences[`${board.id}:${cell.index}`] ?? 0;
              const shouldAnimate = animationSequence > 0 && cell.tone !== "idle";
              const hasPrizeStack = Boolean(stack);

              return (
                <div
                  key={`${cell.index}-${animationSequence}`}
                  className={`board__cell ${toneClass(cell)}${shouldAnimate ? " board__cell--animate" : ""}${hasPrizeStack ? " board__cell--with-prize" : ""}`.trim()}
                >
                  {cell.tone === "target" ? (
                    <img
                      className="board__cell-target-glow"
                      src={theme1Assets.oneToGoGlowUrl}
                      alt=""
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="board__cell-surface" />
                  <span className="board__cell-number">{cell.value > 0 ? cell.value : ""}</span>
                  {stack ? <PrizeStack stack={stack} celebrate={spotlightKind === "win"} /> : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="board-card__footer-label">{footerLabel}</div>
      </div>
    </article>
  );
}

export function Theme1BoardPatternSprite() {
  return (
    <div
      className="board-grid__pattern-sprite"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: theme1Assets.patternOverlaySpriteMarkup }}
    />
  );
}

export { Theme1BoardCard };

function PatternOverlay({
  pattern,
}: {
  pattern: Theme1BoardPatternOverlayState;
}) {
  if (pattern.symbolId) {
    return (
      <svg viewBox="0 0 500 300" role="presentation" preserveAspectRatio="none">
        <use href={`#${pattern.symbolId}`} />
      </svg>
    );
  }

  if (pattern.pathDefinition) {
    return (
      <svg viewBox="0 0 500 300" role="presentation" preserveAspectRatio="none">
        <path
          d={pattern.pathDefinition}
          fill="none"
          stroke="currentColor"
          strokeWidth={18}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return null;
}

function PrizeStack({
  stack,
  celebrate = false,
}: {
  stack: Theme1BoardPrizeStackState;
  celebrate?: boolean;
}) {
  return (
    <div className={`board__prize-stack board__prize-stack--${stack.anchor}`}>
      {stack.labels.map((label) => (
        <span
          key={`${label.rawPatternIndex}-${label.text}`}
          className={`board__prize-chip${celebrate ? " board__prize-chip--celebrate" : ""}`.trim()}
        >
          {label.text}
        </span>
      ))}
    </div>
  );
}

function hasVisibleKrValue(value: string) {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return false;
  }

  const parsed = Number.parseInt(normalized.replace(/[^\d-]/g, ""), 10);
  if (Number.isFinite(parsed)) {
    return parsed > 0;
  }

  return normalized !== "0 kr";
}

function normalizeBoardLabel(label: string) {
  const normalized = label.trim();
  const match = normalized.match(/^Bong\s*(?:nr)?\s*[-–]?\s*(\d+)$/i);
  if (match) {
    return `Bong nr ${match[1]}`;
  }

  return normalized.replace(/^Bong\s+/i, "Bong nr ");
}
