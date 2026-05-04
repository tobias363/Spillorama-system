/**
 * PatternListView — kontrakt for pattern-listevisning i `CenterTopPanel`.
 *
 * Default-implementeringen er Spill 1's tekst-pill-rad (gjengitt direkte
 * i `CenterTopPanel`). Spill 3 injiserer en alternativ implementasjon
 * (`Game3PatternRow`) som rendrer 4 visuelle 5×5 mini-grids i stedet for
 * tekst-pills.
 *
 * Kontrakten er bevisst minimal — `CenterTopPanel` ber visningen oppdatere
 * seg basert på snapshotet fra `room:update`. Visningen eier all egen
 * DOM, sin egen diff-logikk og sine egne callbacks.
 *
 * Hvorfor en interface og ikke en konkret klasse? `CenterTopPanel` ligger
 * i `game1/components/` og skal IKKE importere fra `game3/components/`
 * (cross-game-import bryter monorepo-laget). Game 3-controlleren
 * konstruerer en konkret `Game3PatternRow` og sender den inn via en
 * factory.
 */

import type { PatternDefinition, PatternResult } from "@spillorama/shared-types/game";

export interface PatternListView {
  /** Rot-element som mountes inn i CenterTopPanel sin combo-body. */
  readonly root: HTMLElement;

  /**
   * Oppdater visningen basert på siste snapshot.
   *
   * Implementasjoner SKAL diffe internt — denne kalles på hver `room:update`
   * fra `PlayScreen.update`, ofte 5+ ganger per sekund.
   */
  update(
    patterns: PatternDefinition[],
    patternResults: PatternResult[],
    prizePool: number,
    gameRunning: boolean,
  ): void;

  /** Rydd opp DOM + listeners. Kalles fra `CenterTopPanel.destroy`. */
  destroy(): void;
}

/** Factory som CenterTopPanel kaller når det trenger en alternativ visning. */
export type PatternListViewFactory = () => PatternListView;
