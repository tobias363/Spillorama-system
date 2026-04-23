/**
 * TV Screen + Winners public routes — offentlige sider som bingoverten åpner
 * på hall-skjermen. Ingen auth-gate; URL-formen er:
 *
 *   /admin/#/tv/<hallId>/<tvToken>           → TV Screen (live draw display)
 *   /admin/#/tv/<hallId>/<tvToken>/winners   → Winners mellom spill
 *
 * Siden TV-sidene kjøres i samme SPA som admin-webet, men utenfor
 * AuthGuard, dispatches de i bootstrap (main.ts) før auth-sjekk.
 */

import { mountTvScreenPage, unmountTvScreenPage } from "./TVScreenPage.js";
import { mountWinnersPage, unmountWinnersPage } from "./WinnersPage.js";

export interface TvRouteMatch {
  hallId: string;
  tvToken: string;
  mode: "screen" | "winners";
}

/** Regex: /tv/<hallId>/<tvToken>[/winners] */
const TV_ROUTE = /^\/tv\/([^/?#]+)\/([^/?#]+)(\/winners)?\/?$/;

export function parseTvRoute(path: string): TvRouteMatch | null {
  const bare = path.split("?")[0] ?? path;
  const m = TV_ROUTE.exec(bare);
  if (!m) return null;
  return {
    hallId: decodeURIComponent(m[1]!),
    tvToken: decodeURIComponent(m[2]!),
    mode: m[3] ? "winners" : "screen",
  };
}

export function isTvRoute(path: string): boolean {
  return parseTvRoute(path) !== null;
}

/**
 * Montér TV-rute i root container. Forventer at root er `#app`-elementet.
 * Caller garanterer at `isTvRoute(path)` er true før denne kalles.
 */
export function mountTvRoute(root: HTMLElement, path: string): void {
  const match = parseTvRoute(path);
  if (!match) return;
  unmountTvScreenPage();
  unmountWinnersPage();
  if (match.mode === "winners") {
    mountWinnersPage(root, match.hallId, match.tvToken);
    return;
  }
  mountTvScreenPage(root, match.hallId, match.tvToken);
}

export function unmountTvRoute(): void {
  unmountTvScreenPage();
  unmountWinnersPage();
}
