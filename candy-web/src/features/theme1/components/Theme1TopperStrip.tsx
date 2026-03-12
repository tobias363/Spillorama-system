import type { Theme1TopperState } from "@/domain/theme1/renderModel";

interface Theme1TopperStripProps {
  toppers: Theme1TopperState[];
}

export function Theme1TopperStrip({ toppers }: Theme1TopperStripProps) {
  return (
    <section className="topper-strip">
      {toppers.map((topper) => (
        <article key={topper.id} className={`topper-strip__card${topper.highlighted ? " topper-strip__card--active" : ""}`}>
          <span className="topper-strip__index">{String(topper.id).padStart(2, "0")}</span>
          <strong>{topper.title}</strong>
          <span>{topper.prize}</span>
        </article>
      ))}
    </section>
  );
}
