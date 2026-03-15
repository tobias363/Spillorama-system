import type { Theme1TopperState } from "@/domain/theme1/renderModel";
import { convertColumnMajorIndexesToUi } from "@/domain/theme1/patternCatalog";
import { getTheme1PatternDefinition } from "@/domain/theme1/patternDefinitions";
import { theme1Assets } from "@/features/theme1/data/theme1Assets";
import { theme1TopperCatalog } from "@/features/theme1/data/theme1TopperCatalog";

interface Theme1TopperStripProps {
  toppers: Theme1TopperState[];
  topperPulses?: Record<number, "near" | "win">;
}

export function Theme1TopperStrip({ toppers, topperPulses = {} }: Theme1TopperStripProps) {
  const toppersById = new Map(toppers.map((topper) => [topper.id, topper]));
  const leftLane = theme1TopperCatalog.slice(0, 6);
  const rightLane = theme1TopperCatalog.slice(6, 12);

  return (
    <section className="topper-strip">
      <div className="topper-strip__lane topper-strip__lane--left">
        {leftLane.map((design) => (
          <Theme1TopperCard
            key={design.id}
            design={design}
            topper={toppersById.get(design.id)}
            pulseKind={topperPulses[design.id] ?? null}
          />
        ))}
      </div>

      <div className="topper-strip__brand" aria-hidden="true">
        <img src={theme1Assets.candyManiaLogoUrl} alt="" />
      </div>

      <div className="topper-strip__lane topper-strip__lane--right">
        {rightLane.map((design) => (
          <Theme1TopperCard
            key={design.id}
            design={design}
            topper={toppersById.get(design.id)}
            pulseKind={topperPulses[design.id] ?? null}
          />
        ))}
      </div>
    </section>
  );
}

function Theme1TopperCard({
  design,
  topper,
  pulseKind,
}: {
  design: (typeof theme1TopperCatalog)[number];
  topper: Theme1TopperState | undefined;
  pulseKind: "near" | "win" | null;
}) {
  const prize = topper?.prize?.trim() || "0 kr";
  const highlighted = Boolean(topper?.highlighted);
  const highlightKind = topper?.highlightKind ?? "normal";
  const matchedCellIndexes = resolveMatchedTopperCellIndexes(topper);
  const missingCellIndexes = new Set(topper?.missingCellIndexes ?? []);
  const hasDynamicPatternState =
    matchedCellIndexes.size > 0 || missingCellIndexes.size > 0;
  const cardClassName = [
    "topper-strip__card",
    highlighted ? "topper-strip__card--active" : "",
    highlightKind === "near" ? "topper-strip__card--near" : "",
    highlightKind === "win" ? "topper-strip__card--win" : "",
    pulseKind === "near" ? "topper-strip__card--pulse-near" : "",
    pulseKind === "win" ? "topper-strip__card--pulse-win" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cardClassName} aria-label={`Mønster ${design.displayNumber} ${prize}`}>
      <div
        className={`generated-topper generated-topper--${design.theme}${design.blankBoard ? " generated-topper--blank-board" : ""}`.trim()}
      >
        <div className="generated-topper__body">
          <div className="generated-topper__grid">
            {design.uiCells.map((cellState, index) => {
              const cellClassName = [
                "generated-topper__grid-cell",
                missingCellIndexes.has(index)
                  ? "generated-topper__grid-cell--missing"
                  : matchedCellIndexes.has(index)
                    ? "generated-topper__grid-cell--matched"
                    : !design.blankBoard && cellState === 1
                      ? "generated-topper__grid-cell--active"
                      : "",
              ]
                .filter(Boolean)
                .join(" ");

              return <div key={`${design.id}-${index}`} className={cellClassName} />;
            })}
          </div>
          {design.heroBadgeUrl && !hasDynamicPatternState ? (
            <img
              className="generated-topper__hero-badge"
              src={design.heroBadgeUrl}
              alt={design.heroBadgeAlt || "Pattern badge"}
            />
          ) : null}
        </div>
      </div>
      <div className="topper-strip__prize-field">
        <span className="topper-strip__prize-label">{prize}</span>
      </div>
    </article>
  );
}

function resolveMatchedTopperCellIndexes(
  topper: Theme1TopperState | undefined,
): Set<number> {
  const matchedCellIndexes = new Set<number>();
  const missingCellIndexes = new Set(topper?.missingCellIndexes ?? []);

  for (const rawPatternIndex of topper?.activePatternIndexes ?? []) {
    const definition = getTheme1PatternDefinition(rawPatternIndex);
    if (!definition) {
      continue;
    }

    const columnMajorIndexes = extractPatternCellIndexes(definition.mask);
    const uiIndexes = convertColumnMajorIndexesToUi(columnMajorIndexes);
    for (const uiIndex of uiIndexes) {
      if (!missingCellIndexes.has(uiIndex)) {
        matchedCellIndexes.add(uiIndex);
      }
    }
  }

  return matchedCellIndexes;
}

function extractPatternCellIndexes(mask: readonly number[]): number[] {
  const cellIndexes: number[] = [];

  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 1) {
      cellIndexes.push(index);
    }
  }

  return cellIndexes;
}
