// PR-A5 (BIN-663) — hall dispatcher.
//
// Routes:
//   /hall                                → HallListPage
//   /hall/add                            → HallFormPage (create)
//   /hall/edit/:id                       → HallFormPage (edit — hash-regex)
//   /hall/spill1-prize-defaults/:hallId  → HV2-B3 admin-UI for default
//                                          gevinst-floors per fase (Rad 1-4
//                                          + Fullt Hus). HALL_GAME_CONFIG_*-
//                                          RBAC; HALL_OPERATOR auto-scope.
//
// Legacy hall-delete + move-players modal is out of scope (BIN-A5-HM,
// low-prio — ingen bulk-player-move endpoint backend-side). UI viser toggle
// aktiv/inaktiv + info-tekst om manuell spiller-migrering.

import { renderHallListPage } from "./HallListPage.js";
import { renderHallFormPage } from "./HallFormPage.js";
import { renderSpill1PrizeDefaultsPage } from "./Spill1PrizeDefaultsPage.js";
import { renderUnknownRoute } from "../../utils/escapeHtml.js";

const HALL_EDIT_RE = /^\/hall\/edit\/[^/]+$/;
const HALL_SPILL1_PRIZE_DEFAULTS_RE = /^\/hall\/spill1-prize-defaults\/[^/]+$/;

export function isHallRoute(path: string): boolean {
  return (
    path === "/hall" ||
    path === "/hall/add" ||
    HALL_EDIT_RE.test(path) ||
    HALL_SPILL1_PRIZE_DEFAULTS_RE.test(path)
  );
}

export function mountHallRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  if (path === "/hall") return renderHallListPage(container);
  if (path === "/hall/add") return renderHallFormPage(container, null);
  if (HALL_EDIT_RE.test(path)) {
    const id = decodeURIComponent(path.slice("/hall/edit/".length));
    return renderHallFormPage(container, id);
  }
  if (HALL_SPILL1_PRIZE_DEFAULTS_RE.test(path)) {
    const id = decodeURIComponent(
      path.slice("/hall/spill1-prize-defaults/".length),
    );
    return renderSpill1PrizeDefaultsPage(container, id);
  }
  container.innerHTML = renderUnknownRoute("hall", path);
}
