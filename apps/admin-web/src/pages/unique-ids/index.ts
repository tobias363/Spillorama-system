// BIN-587 B4b — unique-ids dispatcher for /uniqueId and /uniqueIdList routes.
//
// Legacy-semantikken "Unique Player card" (anonym 9-sifret balansekort uten
// spiller-tilknytning) er eksplisitt droppet for pilot, se
// unique_id_scope_dropped_body. I det nye skjemaet gjenbruker vi disse
// rutene til **papirbillett-unique-IDs** (unique_id på app_physical_tickets):
//
//   /uniqueId     → LookupPage — skann / tast inn ID og se status
//                   (POST /api/admin/unique-ids/check + GET /api/admin/unique-ids/:id)
//   /uniqueIdList → ListPage — liste over unique-IDs med filter på hall/status
//                   (GET /api/admin/unique-ids?hallId&status)

import { renderUniqueIdLookupPage } from "./LookupPage.js";
import { renderUniqueIdListPage } from "./ListPage.js";
import { renderUnknownRoute } from "../../utils/escapeHtml.js";

const UNIQUE_ID_ROUTES = new Set<string>([
  "/uniqueId",
  "/uniqueIdList",
]);

export function isUniqueIdRoute(path: string): boolean {
  return UNIQUE_ID_ROUTES.has(path);
}

export function mountUniqueIdRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  switch (path) {
    case "/uniqueId":
      renderUniqueIdLookupPage(container);
      return;
    case "/uniqueIdList":
      renderUniqueIdListPage(container);
      return;
    default:
      container.innerHTML = renderUnknownRoute("unique-id", path);
  }
}
