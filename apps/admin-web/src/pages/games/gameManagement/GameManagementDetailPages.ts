// Detail pages for the GameManagement stack — all render-only placeholders
// pending backend endpoints (BIN-622 CRUD + BIN-623 close-day).
//
// Legacy files covered here (8 files, ~6 930 lines collapsed into placeholders
// because the heavy legacy UIs are write-forms/modals that cannot function
// without backend endpoints):
//   - viewGameDetails.html    (383L) → list-per-type (already covered by main list)
//   - gameAdd.html            (2497L) → add (BIN-622)
//   - game3Add.html           (2158L) → add Game-3 variant (BIN-622)
//   - gameView.html           ( 650L) → read-only view (BIN-622 data)
//   - game3View.html          ( 442L) → read-only view Game-3 (BIN-622 data)
//   - viewGameTickets.html    ( 585L) → ticket-list (BIN-622)
//   - ticketView.html         ( 205L) → ticket-modal (BIN-622)
//   - mainSubGames.html       ( 410L) → nested sub-games (BIN-622)
//   - closeDay.html           ( 480L) → day-close confirm (BIN-623)
//
// Each page mounts the breadcrumb + backend-placeholder banner and a "back"
// link to the type-scoped list. Full forms/tables land once backend lists
// exist, in the BIN-622/623 follow-up PRs.

import { t } from "../../../i18n/I18n.js";
import { escapeHtml } from "../common/escape.js";
import { fetchGameTypeList } from "../gameType/GameTypeState.js";
import type { GameType } from "../common/types.js";

interface ShellOpts {
  title: string;
  breadcrumb: Array<{ label: string; href?: string }>;
  issue: "BIN-622" | "BIN-623";
  bannerText: string;
  backHref: string;
  backLabel: string;
}

function renderShell(opts: ShellOpts): string {
  const crumbs = opts.breadcrumb
    .map((c) =>
      c.href
        ? `<li><a href="${escapeHtml(c.href)}">${escapeHtml(c.label)}</a></li>`
        : `<li class="active">${escapeHtml(c.label)}</li>`
    )
    .join("");
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(opts.title)}</h1>
        <ol class="breadcrumb pull-right">${crumbs}</ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(opts.title)}</h6></div>
              <div class="pull-right">
                <a href="${escapeHtml(opts.backHref)}" class="btn btn-default btn-sm">
                  <i class="fa fa-arrow-left"></i> ${escapeHtml(opts.backLabel)}
                </a>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <div class="alert alert-warning">
                  <i class="fa fa-info-circle"></i>
                  ${escapeHtml(opts.bannerText)}
                  <strong>${escapeHtml(opts.issue)}</strong> må leveres før denne siden er funksjonell.
                </div>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

async function resolveGameType(typeId: string): Promise<GameType | null> {
  try {
    const list = await fetchGameTypeList();
    return list.find((gt) => gt._id === typeId) ?? null;
  } catch {
    return null;
  }
}

/** Base crumb used for all detail pages. */
function baseCrumb(gt: GameType | null, typeId: string): ShellOpts["breadcrumb"] {
  return [
    { label: t("dashboard"), href: "#/admin" },
    { label: t("game_creation_management"), href: "#/gameManagement" },
    {
      label: gt?.name ?? typeId,
      href: `#/gameManagement?typeId=${encodeURIComponent(typeId)}`,
    },
  ];
}

/**
 * /gameManagement/:typeId/add — erstatning for legacy gameAdd.html (2 497 lines).
 * Re-eksportert fra GameManagementAddForm.ts slik at dispatcheren fortsatt
 * importerer herfra; Spill 1 får full konfigurasjon, andre typer får en
 * "ikke wired ennå"-placeholder (se GameManagementAddForm.renderNotYetSupportedShell).
 */
export { renderGameManagementAddPage } from "./GameManagementAddForm.js";

/** /gameManagement/:typeId/add-g3 — legacy game3Add.html (2 158 lines) */
export async function renderGameManagementAddG3Page(container: HTMLElement, typeId: string): Promise<void> {
  const gt = await resolveGameType(typeId);
  container.innerHTML = renderShell({
    title: `${t("add_game")} (Spill 3) — ${gt?.name ?? typeId}`,
    breadcrumb: [...baseCrumb(gt, typeId), { label: `${t("add_game")} (G3)` }],
    issue: "BIN-622",
    bannerText: "Venter på backend-endpoint for GameManagement CRUD (Game 3-variant med mønster-grid).",
    backHref: `#/gameManagement?typeId=${encodeURIComponent(typeId)}`,
    backLabel: t("back"),
  });
}

/** /gameManagement/:typeId/view/:id — legacy gameView.html (650 lines) */
export async function renderGameManagementViewPage(
  container: HTMLElement,
  typeId: string,
  id: string
): Promise<void> {
  const gt = await resolveGameType(typeId);
  container.innerHTML = renderShell({
    title: `${gt?.name ?? typeId} — ${escapeHtml(t("view"))} #${escapeHtml(id)}`,
    breadcrumb: [...baseCrumb(gt, typeId), { label: `${t("view")} #${id}` }],
    issue: "BIN-622",
    bannerText: "Venter på backend-endpoint for GameManagement detail-data.",
    backHref: `#/gameManagement?typeId=${encodeURIComponent(typeId)}`,
    backLabel: t("back"),
  });
}

/** /gameManagement/:typeId/view-g3/:id — legacy game3View.html (442 lines) */
export async function renderGameManagementViewG3Page(
  container: HTMLElement,
  typeId: string,
  id: string
): Promise<void> {
  const gt = await resolveGameType(typeId);
  container.innerHTML = renderShell({
    title: `${gt?.name ?? typeId} (Spill 3) — ${escapeHtml(t("view"))} #${escapeHtml(id)}`,
    breadcrumb: [...baseCrumb(gt, typeId), { label: `${t("view")} G3 #${id}` }],
    issue: "BIN-622",
    bannerText: "Venter på backend-endpoint for GameManagement Game-3 detaljer.",
    backHref: `#/gameManagement?typeId=${encodeURIComponent(typeId)}`,
    backLabel: t("back"),
  });
}

/** /gameManagement/:typeId/tickets/:id — legacy viewGameTickets.html + ticketView.html modal */
export async function renderGameManagementTicketsPage(
  container: HTMLElement,
  typeId: string,
  id: string
): Promise<void> {
  const gt = await resolveGameType(typeId);
  container.innerHTML = renderShell({
    title: `${t("ticket")} — ${gt?.name ?? typeId} #${escapeHtml(id)}`,
    breadcrumb: [...baseCrumb(gt, typeId), { label: `${t("ticket")} #${id}` }],
    issue: "BIN-622",
    bannerText: "Venter på backend-endpoint for ticket-listing per spill-runde.",
    backHref: `#/gameManagement?typeId=${encodeURIComponent(typeId)}`,
    backLabel: t("back"),
  });
}

/** /gameManagement/subGames/:typeId/:id — legacy mainSubGames.html (410 lines) */
export async function renderGameManagementSubGamesPage(
  container: HTMLElement,
  typeId: string,
  id: string
): Promise<void> {
  const gt = await resolveGameType(typeId);
  container.innerHTML = renderShell({
    title: `${t("sub_game")} — ${gt?.name ?? typeId} #${escapeHtml(id)}`,
    breadcrumb: [...baseCrumb(gt, typeId), { label: `${t("sub_game")} #${id}` }],
    issue: "BIN-622",
    bannerText: "Venter på backend-endpoint for nested sub-game composition.",
    backHref: `#/gameManagement?typeId=${encodeURIComponent(typeId)}`,
    backLabel: t("back"),
  });
}

/** /gameManagement/closeDay/:typeId/:id — legacy closeDay.html (480 lines) */
export async function renderGameManagementCloseDayPage(
  container: HTMLElement,
  typeId: string,
  id: string
): Promise<void> {
  const gt = await resolveGameType(typeId);
  container.innerHTML = renderShell({
    title: `${t("close_day")} — ${gt?.name ?? typeId} #${escapeHtml(id)}`,
    breadcrumb: [...baseCrumb(gt, typeId), { label: `${t("close_day")} #${id}` }],
    issue: "BIN-623",
    bannerText: "Venter på backend-endpoint for CloseDay — dagsavslutning av løpende spill-runde.",
    backHref: `#/gameManagement?typeId=${encodeURIComponent(typeId)}`,
    backLabel: t("back"),
  });
}
