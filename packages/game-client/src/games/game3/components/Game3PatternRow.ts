/**
 * Game3PatternRow — pattern-listevisning for Spill 3.
 *
 * Implementerer `PatternListView`-kontrakten fra `CenterTopPanel` og
 * erstatter Spill 1's `prizeListEl` (tekst-pills "Rad 1 - 100 kr") med
 * fire visuelle 5×5 mini-grids — én per pattern fra
 * `DEFAULT_GAME3_CONFIG.patterns`.
 *
 * Hver mini-grid:
 *   - Highlights cellene som er DEL AV mønsteret (fra
 *     `PatternDefinition.patternDataList`).
 *   - Har en kort label over (T / X / 7 / Pyramide) om mønstret matcher
 *     en kjent backendnavn-shape, ellers viser den hele backendnavnet.
 *   - Viser premiebeløp under (e.g. "1700 kr").
 *   - Dimmes når pattern er vunnet (`isWon = true`).
 *   - Får ekstra glow når pattern er det aktivt-spilte (første ikke-vunnet).
 *
 * Per Tobias-direktiv 2026-05-04: backend (PR #895) har 4 pattern-design:
 * Topp + midt (T-form), Kryss (X), Topp + diagonal (7-form), Pyramide.
 * Alle 25% av pot. Visualisering speiler eksakt
 * `patternDataList`-bitmasken serveren sender.
 */

import type { PatternDefinition, PatternResult } from "@spillorama/shared-types/game";
import type { PatternListView } from "../../game1/components/PatternListView.js";
import { Game3PatternMiniGrid } from "./Game3PatternMiniGrid.js";

/** Kort label per kjent backend-pattern-navn. */
const SHORT_LABEL_BY_NAME: Readonly<Record<string, string>> = {
  "Topp + midt": "T",
  "Kryss": "X",
  "Topp + diagonal": "7",
  "Pyramide": "Pyramide",
};

function shortLabelFor(name: string): string {
  return SHORT_LABEL_BY_NAME[name] ?? name;
}

/** CSS-injection for row + tile-styling. Singleton per dokument. */
function ensureGame3PatternRowStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("g3-pattern-row-styles")) return;
  const s = document.createElement("style");
  s.id = "g3-pattern-row-styles";
  s.textContent = `
.g3-pattern-row {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  justify-content: space-between;
  gap: 10px;
  flex: 1;
}
.g3-pattern-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
.g3-pattern-tile-label {
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.7);
  letter-spacing: 0.3px;
  text-align: center;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  max-width: 100%;
  line-height: 1.1;
}
.g3-pattern-tile-prize {
  font-size: 10px;
  font-weight: 600;
  color: #ffcc00;
  text-shadow: 0 1px 2px rgba(0,0,0,0.7);
  white-space: nowrap;
  line-height: 1.1;
}
.g3-pattern-tile.won .g3-pattern-tile-label,
.g3-pattern-tile.won .g3-pattern-tile-prize {
  text-decoration: line-through;
  text-decoration-thickness: 1px;
  opacity: 0.55;
}
`;
  document.head.appendChild(s);
}

interface TileEntry {
  patternId: string;
  tile: HTMLDivElement;
  labelEl: HTMLDivElement;
  prizeEl: HTMLDivElement;
  grid: Game3PatternMiniGrid;
  /** Cache for å unngå unødvendige DOM-writes. */
  cache: { label: string; prize: string; won: boolean; active: boolean; maskKey: string };
}

export class Game3PatternRow implements PatternListView {
  readonly root: HTMLDivElement;
  private tilesById = new Map<string, TileEntry>();
  /** Struktur-signatur (id + design + maske) — full rebuild kun ved endring. */
  private lastStructureSignature: string | null = null;

  constructor() {
    ensureGame3PatternRowStyles();
    this.root = document.createElement("div");
    this.root.className = "g3-pattern-row";
  }

  update(
    patterns: PatternDefinition[],
    patternResults: PatternResult[],
    prizePool: number,
    gameRunning: boolean,
  ): void {
    // Pre-game / tom snapshot — vis 4 placeholder-tiles fra default-config
    // så panelet aldri er tomt mens spilleren venter på start.
    const effectivePatterns =
      patterns.length === 0 ? Game3PatternRow.placeholderPatterns() : patterns;

    // Struktur-signatur baseres på id-rekkefølge + maskerene; alt annet
    // (prize, won-state) håndteres via diff-oppdatering uten DOM-rebuild.
    const structureSignature = effectivePatterns
      .map((p) => `${p.id}:${p.design}:${(p.patternDataList ?? []).join("")}`)
      .join("|");

    if (structureSignature !== this.lastStructureSignature) {
      this.lastStructureSignature = structureSignature;
      this.rebuild(effectivePatterns);
    }

    // Finn første ikke-vunne pattern (= aktivt). Speiler CenterTopPanel-
    // currentPatternIdx-logikken slik at "active"-glow oppfører seg likt.
    let currentIdx = 0;
    for (let i = 0; i < patternResults.length; i++) {
      if (patternResults[i]?.isWon) currentIdx = i + 1;
    }

    for (let i = 0; i < effectivePatterns.length; i++) {
      const pattern = effectivePatterns[i];
      const result = patternResults.find((r) => r.patternId === pattern.id);
      const computedPrize =
        pattern.winningType === "fixed"
          ? (pattern.prize1 ?? 0)
          : Math.round(((pattern.prizePercent ?? 0) / 100) * prizePool);
      const prize = result?.payoutAmount ?? computedPrize;
      const wonRaw = result?.isWon === true;
      const won = gameRunning && wonRaw;
      const active = gameRunning && !won && i === currentIdx;
      this.applyTileState(pattern, prize, won, active);
    }
  }

  private rebuild(patterns: PatternDefinition[]): void {
    // Riv eksisterende tiles og bygg fra bunn av. Dette skjer kun ved
    // pattern-array-shape-endring (sjelden), ikke per state-update.
    for (const entry of this.tilesById.values()) {
      entry.grid.destroy();
      entry.tile.remove();
    }
    this.tilesById.clear();
    this.root.innerHTML = "";

    for (const pattern of patterns) {
      const tile = document.createElement("div");
      tile.className = "g3-pattern-tile";

      const labelEl = document.createElement("div");
      labelEl.className = "g3-pattern-tile-label";
      tile.appendChild(labelEl);

      const grid = new Game3PatternMiniGrid({ cellSize: 12, cellGap: 1.5 });
      const mask = pattern.patternDataList ?? [];
      grid.setMask(mask);
      tile.appendChild(grid.root);

      const prizeEl = document.createElement("div");
      prizeEl.className = "g3-pattern-tile-prize";
      tile.appendChild(prizeEl);

      this.root.appendChild(tile);

      this.tilesById.set(pattern.id, {
        patternId: pattern.id,
        tile,
        labelEl,
        prizeEl,
        grid,
        cache: { label: "", prize: "", won: false, active: false, maskKey: mask.join("") },
      });
    }
  }

  private applyTileState(
    pattern: PatternDefinition,
    prize: number,
    won: boolean,
    active: boolean,
  ): void {
    const entry = this.tilesById.get(pattern.id);
    if (!entry) return;

    const nextLabel = shortLabelFor(pattern.name);
    const nextPrize = `${prize} kr`;

    // Diff-oppdatering — 0 DOM-writes ved stabil state.
    if (entry.cache.label !== nextLabel) {
      entry.labelEl.textContent = nextLabel;
      entry.cache.label = nextLabel;
    }
    if (entry.cache.prize !== nextPrize) {
      entry.prizeEl.textContent = nextPrize;
      entry.cache.prize = nextPrize;
    }
    if (entry.cache.won !== won) {
      entry.tile.classList.toggle("won", won);
      entry.grid.setWon(won);
      entry.cache.won = won;
    }
    if (entry.cache.active !== active) {
      entry.grid.setActive(active);
      entry.cache.active = active;
    }
  }

  destroy(): void {
    for (const entry of this.tilesById.values()) {
      entry.grid.destroy();
      entry.tile.remove();
    }
    this.tilesById.clear();
    this.root.remove();
  }

  /**
   * Pre-game placeholder — speiler `DEFAULT_GAME3_CONFIG.patterns` slik at
   * combo-panelet aldri er tomt mens spilleren venter på rom-snapshot.
   * Bevisst hardkodet her (i stedet for å importere fra
   * apps/backend) siden game-client ikke skal ha backend-imports.
   */
  private static placeholderPatterns(): PatternDefinition[] {
    const cellsToBitmask = (cells: number[]): number[] => {
      const mask = new Array(25).fill(0);
      for (const c of cells) mask[c] = 1;
      return mask;
    };
    const base = {
      claimType: "BINGO" as const,
      prizePercent: 25,
      design: 0,
      winningType: "percent" as const,
    };
    return [
      {
        id: "g3-placeholder-topp-midt",
        name: "Topp + midt",
        order: 0,
        ...base,
        patternDataList: cellsToBitmask([0, 1, 2, 3, 4, 7, 12, 17, 22]),
      },
      {
        id: "g3-placeholder-kryss",
        name: "Kryss",
        order: 1,
        ...base,
        patternDataList: cellsToBitmask([0, 4, 6, 8, 12, 16, 18, 20, 24]),
      },
      {
        id: "g3-placeholder-topp-diagonal",
        name: "Topp + diagonal",
        order: 2,
        ...base,
        patternDataList: cellsToBitmask([0, 1, 2, 3, 4, 8, 12, 16, 20]),
      },
      {
        id: "g3-placeholder-pyramide",
        name: "Pyramide",
        order: 3,
        ...base,
        patternDataList: cellsToBitmask([12, 16, 17, 18, 20, 21, 22, 23, 24]),
      },
    ];
  }
}
