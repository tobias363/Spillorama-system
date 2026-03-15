import { getTheme1BallSpriteUrl } from "@/features/theme1/data/theme1BallSprites";

interface Theme1BallRailProps {
  featuredBall: number | null;
  featuredBallIsPending: boolean;
  balls: number[];
  compact?: boolean;
  hiddenCompactBallNumber?: number | null;
  onCompactBallRef?: (ball: number, element: HTMLDivElement | null) => void;
}

export function Theme1BallRail({
  featuredBall,
  featuredBallIsPending,
  balls,
  compact = false,
  hiddenCompactBallNumber = null,
  onCompactBallRef,
}: Theme1BallRailProps) {
  const railBalls = compact
    ? balls.slice(-30)
    : featuredBall
      ? balls.filter((ball) => ball !== featuredBall).slice(-10)
      : balls.slice(-10);

  if (compact) {
    if (railBalls.length === 0) {
      return null;
    }

    return (
      <section className="ball-rail ball-rail--compact" aria-label="Siste baller">
        <div className="ball-rail__list ball-rail__list--compact">
          {railBalls.map((ball, index) => {
            const spriteUrl = getTheme1BallSpriteUrl(ball);

            return (
              <div
                key={`${ball}-${index}`}
                ref={(element) => onCompactBallRef?.(ball, element)}
                className={`ball-rail__compact-ball${hiddenCompactBallNumber === ball ? " ball-rail__compact-ball--hidden-slot" : ""}`.trim()}
              >
                {spriteUrl ? (
                  <img src={spriteUrl} alt={`Ball ${ball}`} loading="lazy" />
                ) : (
                  <span>{ball}</span>
                )}
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
