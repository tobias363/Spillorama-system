// PR-A5 (BIN-663) — hall dispatcher.
//
// Routes:
//   /hall              → HallListPage
//   /hall/add          → HallFormPage (create)
//   /hall/edit/:id     → HallFormPage (edit — hash-regex)
//
// Legacy hall-delete + move-players modal is out of scope (BIN-A5-HM,
// low-prio — ingen bulk-player-move endpoint backend-side). UI viser toggle
// aktiv/inaktiv + info-tekst om manuell spiller-migrering.

import { renderHallListPage } from "./HallListPage.js";
import { renderHallFormPage } from "./HallFormPage.js";
import { renderUnknownRoute } from "../../utils/escapeHtml.js";

const HALL_EDIT_RE = /^\/hall\/edit\/[^/]+$/;

export function isHallRoute(path: string): boolean {
  return path === "/hall" || path === "/hall/add" || HALL_EDIT_RE.test(path);
}

export function mountHallRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  if (path === "/hall") return renderHallListPage(container);
  if (path === "/hall/add") return renderHallFormPage(container, null);
  if (HALL_EDIT_RE.test(path)) {
    const id = decodeURIComponent(path.slice("/hall/edit/".length));
    return renderHallFormPage(container, id);
  }
  container.innerHTML = renderUnknownRoute("hall", path);
}
