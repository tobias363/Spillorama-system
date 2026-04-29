// PR-A1 (refactor) — otherGames dispatcher.
//
// Konsoliderer 4 tidligere per-type-sider til én generisk
// `renderMiniGameConfigPage(container, type)`. URL-strukturen og
// test-ID-ene er uendret; dette er ren strukturell refactor.
//
// Routes:
//   /wheelOfFortune    → renderMiniGameConfigPage(host, "wheel")       24 prizes
//   /treasureChest     → renderMiniGameConfigPage(host, "chest")       10 prizes
//   /mystery           → renderMiniGameConfigPage(host, "mystery")      6 prizes
//   /colorDraft        → renderMiniGameConfigPage(host, "colordraft")   3×4 prizes

import { renderMiniGameConfigPage } from "./MiniGameConfigPage.js";
import type { MiniGameType } from "../../api/admin-other-games.js";
import { renderUnknownRoute } from "../../utils/escapeHtml.js";

const ROUTE_TO_TYPE: Record<string, MiniGameType> = {
  "/wheelOfFortune": "wheel",
  "/treasureChest": "chest",
  "/mystery": "mystery",
  "/colorDraft": "colordraft",
};

const OTHER_GAMES_ROUTES = new Set<string>(Object.keys(ROUTE_TO_TYPE));

export function isOtherGamesRoute(path: string): boolean {
  return OTHER_GAMES_ROUTES.has(path);
}

export function mountOtherGamesRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  const type = ROUTE_TO_TYPE[path];
  if (!type) {
    container.innerHTML = renderUnknownRoute("otherGames", path);
    return;
  }
  renderMiniGameConfigPage(container, type);
}
