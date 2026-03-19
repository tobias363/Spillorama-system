import { getTheme1BallSpriteUrl } from "@/features/theme1/data/theme1BallSprites";

interface Theme1BallRailProps {
  featuredBall: number | null;
  featuredBallIsPending: boolean;
  balls: number[];
  compact?: boolean;
  hiddenCompactBallIndex?: number | null;
  onCompactSlotRef?: (index: number, element: HTMLDivElement | null) => void;
}

const THEME1_COMPACT_BALL_RAIL_ROW_SIZE = 15;

export function resolveCompactRailPlacement(index: number) {
  const normalizedIndex = Math.max(0, index);
  const row =
    normalizedIndex < THEME1_COMPACT_BALL_RAIL_ROW_SIZE ? 2 : 1;
  const column =
    normalizedIndex < THEME1_COMPACT_BALL_RAIL_ROW_SIZE
      ? normalizedIndex + 1
      : (normalizedIndex - THEME1_COMPACT_BALL_RAIL_ROW_SIZE) + 1;

  return { row, column };
}

export function Theme1BallRail({
  featuredBall,
  featuredBallIsPending,
  balls,
  compact = false,
  hiddenCompactBallIndex = null,
  onCompactSlotRef,
}: Theme1BallRailProps) {
  const railBalls = compact
    ? balls.slice(-30)
    : featuredBall
      ? balls.filter((ball) => ball !== featuredBall).slice(-10)
      : balls.slice(-10);

  if (compact) {
    return (
      <section className="ball-rail ball-rail--compact" aria-label="Siste baller">
        <div className="ball-rail__list ball-rail__list--compact">
          {Array.from({ length: Math.max(railBalls.length, THEME1_COMPACT_BALL_RAIL_ROW_SIZE * 2) }, (_, index) => {
            const placement = resolveCompactRailPlacement(index);
            const ball = railBalls[index] ?? null;
            const spriteUrl = ball ? getTheme1BallSpriteUrl(ball) : null;
            const hidden = hiddenCompactBallIndex === index;

            return (
              <div
                key={`slot-${index}`}
                ref={(element) => onCompactSlotRef?.(index, element)}
                className={`ball-rail__compact-ball${hidden ? " ball-rail__compact-ball--hidden-slot" : ""}`.trim()}
                style={{
                  gridColumn: placement.column,
                  gridRow: placement.row,
                }}
              >
                {ball && spriteUrl ? (
                  <img src={spriteUrl} alt={`Ball ${ball}`} />
                ) : ball ? (
                  <span>{ball}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section className="ball-rail">
      <div className="ball-rail__meta">
        <span>Siste baller</span>
        <strong>
          {featuredBall
            ? featuredBallIsPending
              ? "Nytt tall pa vei inn i brettet."
              : "Siste trekk er låst inn i snapshotet."
            : "Ingen trekk ennå."}
        </strong>
      </div>

      <div className="ball-rail__content">
        {featuredBall ? (
          <div className={`ball-rail__featured${featuredBallIsPending ? " ball-rail__featured--pending" : ""}`}>
            <span className="ball-rail__featured-label">
              {featuredBallIsPending ? "Nytt tall" : "Siste tall"}
            </span>
            <div className="ball-rail__featured-ball">{featuredBall}</div>
          </div>
        ) : null}

        <div className="ball-rail__list">
          {railBalls.length > 0 ? railBalls.map((ball) => (
            <div key={ball} className="ball-rail__ball">
              {ball}
            </div>
          )) : <p className="ball-rail__empty">Ingen trekk ennå.</p>}
        </div>
      </div>
    </section>
  );
}
