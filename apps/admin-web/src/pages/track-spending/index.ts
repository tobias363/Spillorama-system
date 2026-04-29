// PR-B2: Track-spending routes dispatcher.

import { renderTrackSpendingPage } from "./TrackSpendingPage.js";
import { renderUnknownRoute } from "../../utils/escapeHtml.js";

const TRACK_SPENDING_ROUTES = new Set<string>([
  "/players/track-spending",
]);

export function isTrackSpendingRoute(path: string): boolean {
  return TRACK_SPENDING_ROUTES.has(path);
}

export function mountTrackSpendingRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  if (path === "/players/track-spending") {
    renderTrackSpendingPage(container);
    return;
  }
  container.innerHTML = renderUnknownRoute("track-spending", path);
}
