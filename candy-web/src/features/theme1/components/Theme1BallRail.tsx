interface Theme1BallRailProps {
  balls: number[];
}

export function Theme1BallRail({ balls }: Theme1BallRailProps) {
  return (
    <section className="ball-rail">
      <div className="ball-rail__meta">
        <span>Siste baller</span>
        <strong>Renderes forelopig i DOM. Neste steg er dedikert canvas/WebGL-lag.</strong>
      </div>

      <div className="ball-rail__list">
        {balls.length > 0 ? balls.map((ball) => (
          <div key={ball} className="ball-rail__ball">
            {ball}
          </div>
        )) : <p className="ball-rail__empty">Ingen trekk ennå.</p>}
      </div>
    </section>
  );
}
