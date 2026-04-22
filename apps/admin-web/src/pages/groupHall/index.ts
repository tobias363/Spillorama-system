// PR 4e.1 (2026-04-22) — GroupHall dispatcher.
//
// Erstatter placeholder-banneret fra BIN-663 med ekte sider nå som backend
// (BIN-665) har full CRUD. Ref. apps/backend/src/routes/adminHallGroups.ts.
//
// Routes:
//   /groupHall              → GroupHallListPage (list + inline add-modal)
//   /groupHall/add          → GroupHallListPage + auto-åpnet add-modal
//   /groupHall/edit/:id     → GroupHallListPage + auto-åpnet edit-modal
//
// Legacy view-route (/groupHall/view/:id) er ikke portert — edit-modalen
// har all data (read-only er overkill for en 5-felt form). Route-handler
// aksepterer dem likevel for bakoverkompat.

import { renderGroupHallListPage } from "./GroupHallListPage.js";
import { openGroupHallEditorModal } from "./GroupHallEditorModal.js";
import { fetchHallGroup } from "./GroupHallState.js";

const GROUP_HALL_STATIC = new Set<string>(["/groupHall", "/groupHall/add"]);
const GROUP_HALL_EDIT_RE = /^\/groupHall\/edit\/[^/]+$/;
const GROUP_HALL_VIEW_RE = /^\/groupHall\/view\/[^/]+$/;

export function isGroupHallRoute(path: string): boolean {
  if (GROUP_HALL_STATIC.has(path)) return true;
  return GROUP_HALL_EDIT_RE.test(path) || GROUP_HALL_VIEW_RE.test(path);
}

export function mountGroupHallRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  renderGroupHallListPage(container);

  if (path === "/groupHall/add") {
    openGroupHallEditorModal({
      mode: "create",
      onSaved: () => {
        window.location.hash = "#/groupHall";
      },
    });
    return;
  }

  const editMatch = path.match(/^\/groupHall\/edit\/([^/]+)$/);
  const viewMatch = path.match(/^\/groupHall\/view\/([^/]+)$/);
  const targetId = editMatch ? decodeURIComponent(editMatch[1]!) : viewMatch ? decodeURIComponent(viewMatch[1]!) : null;

  if (targetId) {
    void (async () => {
      const row = await fetchHallGroup(targetId);
      if (!row) {
        window.location.hash = "#/groupHall";
        return;
      }
      openGroupHallEditorModal({
        mode: "edit",
        existing: row,
        onSaved: () => {
          window.location.hash = "#/groupHall";
        },
      });
    })();
  }
}
