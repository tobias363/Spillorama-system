import { theme1Assets } from "@/features/theme1/data/theme1Assets";
import type {
  Theme1BoardPatternOverlayState,
  Theme1BoardPrizeStackState,
  Theme1BoardState,
  Theme1CellState,
} from "@/domain/theme1/renderModel";

interface Theme1BoardGridProps {
  boards: Theme1BoardState[];
}

function toneClass(cell: Theme1CellState) {
  if (cell.tone === "target") {
    return "board__cell--target";
  }

  if (cell.tone === "won") {
    return "board__cell--prize";
  }

  if (cell.tone === "matched") {
    return "board__cell--matched";
  }

  return "";
}

export function Theme1BoardGrid({ boards }: Theme1BoardGridProps) {
  return (
    <section className="board-grid">
      {boards.map((board) => (
        <Theme1BoardCard key={board.id} board={board} />
      ))}
    </section>
  );
}

function Theme1BoardCard({ board }: { board: Theme1BoardState }) {
  const prizeStacksByCell = new Map<number, Theme1BoardPrizeStackState>(
    board.prizeStacks.map((stack) => [stack.cellIndex, stack]),
  );

  return (
    <article className="board-card">
      <header className="board-card__header">
        <div>
          <span>{board.label}</span>
          <strong>{board.win}</strong>
        </div>
        <small>Innsats {board.stake}</small>
      </header>

      <div className="board-card__frame">
        <div className="board-card__tab" />
        <div className="board">
          <div className="board__pattern-layers" aria-hidden="true">
            {board.completedPatterns.map((pattern) => (
              <div key={pattern.key} className="board__pattern-layer">
                <PatternOverlay pattern={pattern} />
              </div>
            ))}
          </div>

          {board.cells.map((cell) => {
            const stack = prizeStacksByCell.get(cell.index);

            return (
              <div key={cell.index} className={`board__cell ${toneClass(cell)}`.trim()}>
                <span className="board__cell-glow" />
                <span className="board__cell-number">{cell.value > 0 ? cell.value : ""}</span>
                {stack ? <PrizeStack stack={stack} /> : null}
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}

function PatternOverlay({
  pattern,
}: {
  pattern: Theme1BoardPatternOverlayState;
}) {
  if (pattern.symbolId) {
    return (
      <svg viewBox="0 0 500 300" role="presentation">
        <use href={`${theme1Assets.patternOverlayUrl}#${pattern.symbolId}`} />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 500 300" role="presentation">
      {pattern.cellIndices.map((cellIndex) => {
        const column = cellIndex % 5;
        const row = Math.trunc(cellIndex / 5);
        const x = column * 100 + 12;
        const y = row * 100 + 12;

        return (
          <rect
            key={`${pattern.key}-${cellIndex}`}
            x={x}
            y={y}
            width={76}
            height={76}
            rx={18}
            fill="rgba(116, 21, 149, 0.16)"
            stroke="rgba(116, 21, 149, 0.82)"
            strokeWidth={10}
          />
        );
      })}
    </svg>
  );
}

function PrizeStack({ stack }: { stack: Theme1BoardPrizeStackState }) {
  return (
    <div className={`board__prize-stack board__prize-stack--${stack.anchor}`}>
      {stack.labels.map((label) => (
        <span
          key={`${label.rawPatternIndex}-${label.text}`}
          className="board__prize-chip"
        >
          {label.text}
        </span>
      ))}
    </div>
  );
}
