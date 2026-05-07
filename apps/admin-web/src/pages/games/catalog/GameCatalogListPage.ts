/**
 * Fase 2 (2026-05-07): GameCatalog list-side.
 *
 * URL: /admin/#/games/catalog
 *
 * Layout (matches admin-web list-side-mønster, jf. GameTypeListPage):
 *   - Content header med tittel + breadcrumb
 *   - Panel med "Spillkatalog" + "Legg til spill"-knapp + filter-toggle
 *   - DataTable: Navn, Slug, Bongfarger (chips), Premier (sammendrag),
 *     Bonus-spill, Krever jackpot-setup, Aktiv, Handling
 *   - Action-cells: Edit-knapp + Deaktiver-knapp (kun ADMIN)
 */

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { Toast } from "../../../components/Toast.js";
import { escapeHtml } from "../../../utils/escapeHtml.js";
import { getSession } from "../../../auth/Session.js";
import {
  fetchCatalogList,
  deactivateCatalogEntry,
  centsToKr,
} from "./GameCatalogState.js";
import type {
  GameCatalogEntry,
  TicketColor,
} from "../../../api/admin-game-catalog.js";

const COLOR_LABELS: Record<TicketColor, string> = {
  gul: "Gul",
  hvit: "Hvit",
  lilla: "Lilla",
};

function canWrite(): boolean {
  const session = getSession();
  if (!session) return false;
  return session.role === "admin" || session.role === "super-admin";
}

export async function renderGameCatalogListPage(
  container: HTMLElement,
): Promise<void> {
  container.innerHTML = renderShell();

  const tableHost = container.querySelector<HTMLElement>(
    "#game-catalog-list-table",
  );
  if (!tableHost) return;

  // Filter-toggle
  const filterSelect = container.querySelector<HTMLSelectElement>(
    "#game-catalog-filter",
  );
  filterSelect?.addEventListener("change", () => {
    void loadAndRender(tableHost, filterSelect.value);
  });

  // Add-knapp — gated på role
  const addBtn = container.querySelector<HTMLAnchorElement>(
    '[data-action="add-game-catalog"]',
  );
  if (addBtn) {
    if (!canWrite()) {
      addBtn.style.display = "none";
    } else {
      addBtn.addEventListener("click", (e) => {
        e.preventDefault();
        window.location.hash = "#/games/catalog/new";
      });
    }
  }

  await loadAndRender(tableHost, filterSelect?.value ?? "all");
}

async function loadAndRender(
  host: HTMLElement,
  filterValue: string,
): Promise<void> {
  host.innerHTML = `<div class="text-center"><i class="fa fa-spinner fa-spin fa-2x" aria-hidden="true"></i></div>`;
  try {
    const params: { isActive?: boolean } = {};
    if (filterValue === "active") params.isActive = true;
    else if (filterValue === "inactive") params.isActive = false;
    const rows = await fetchCatalogList(params);
    renderTable(host, rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    host.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
  }
}

function renderShell(): string {
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>Spillkatalog</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li>Spilladministrasjon</li>
          <li class="active">Spillkatalog</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">Spillkatalog</h6></div>
              <div class="pull-right">
                <select id="game-catalog-filter" class="form-control" style="display:inline-block;width:auto;margin-right:8px">
                  <option value="all">Alle</option>
                  <option value="active" selected>Aktiv</option>
                  <option value="inactive">Inaktiv</option>
                </select>
                <a href="#/games/catalog/new"
                  class="btn btn-primary btn-md"
                  data-action="add-game-catalog">
                  <i class="fa fa-plus" aria-hidden="true"></i> Legg til spill
                </a>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <p class="text-muted">
                  Definér hver type spill (Jackpot, Innsatsen, Trafikklys osv.)
                  med bongfarger, priser, premier og bonus-spill-konfigurasjon.
                  Hver entry er en gjenbrukbar mal som plan-builderen plukker
                  fra når en spilleplan settes opp.
                </p>
                <div class="table-wrap"><div class="table-responsive">
                  <div id="game-catalog-list-table"></div>
                </div></div>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

function renderColorChips(colors: TicketColor[]): string {
  if (colors.length === 0) return '<span class="text-muted">—</span>';
  const colorBg: Record<TicketColor, string> = {
    gul: "background:#fff3cd;color:#856404;border:1px solid #ffeeba",
    hvit: "background:#f8f9fa;color:#383d41;border:1px solid #d6d8db",
    lilla: "background:#e2d9f3;color:#491f80;border:1px solid #cfbcf2",
  };
  return colors
    .map(
      (c) =>
        `<span style="display:inline-block;padding:2px 8px;margin:0 4px 2px 0;border-radius:10px;font-size:11px;${colorBg[c]}">${escapeHtml(COLOR_LABELS[c])}</span>`,
    )
    .join("");
}

function renderPrizesSummary(entry: GameCatalogEntry): string {
  const rad = `R1-R4: ${centsToKr(entry.prizesCents.rad1)} kr`;
  const bingo = (Object.entries(entry.prizesCents.bingo) as [TicketColor, number][])
    .map(([c, cents]) => `${COLOR_LABELS[c]} ${centsToKr(cents)}`)
    .join(", ");
  const bingoSummary = bingo ? `Bingo: ${bingo} kr` : "Bingo: —";
  return `<small>${escapeHtml(rad)}<br>${escapeHtml(bingoSummary)}</small>`;
}

const BONUS_LABELS: Record<string, string> = {
  mystery: "Mystery",
  wheel_of_fortune: "Lykkehjul",
  treasure_chest: "Skattkiste",
  color_draft: "Color Draft",
};

function renderTable(host: HTMLElement, rows: GameCatalogEntry[]): void {
  const writeAccess = canWrite();
  DataTable.mount(host, {
    className: "game-catalog-list pb-30",
    emptyMessage:
      "Ingen spill i katalogen ennå. Legg til ditt første spill via «Legg til spill».",
    rows,
    columns: [
      { key: "displayName", title: "Navn" },
      {
        key: "slug",
        title: "Slug",
        render: (row) => `<code>${escapeHtml(row.slug)}</code>`,
      },
      {
        key: "ticketColors",
        title: "Bongfarger",
        render: (row) => renderColorChips(row.ticketColors),
      },
      {
        key: "prizesCents",
        title: "Premier",
        render: (row) => renderPrizesSummary(row),
      },
      {
        key: "bonusGameSlug",
        title: "Bonus-spill",
        align: "center",
        render: (row) =>
          row.bonusGameEnabled && row.bonusGameSlug
            ? escapeHtml(BONUS_LABELS[row.bonusGameSlug] ?? row.bonusGameSlug)
            : '<span class="text-muted">—</span>',
      },
      {
        key: "requiresJackpotSetup",
        title: "Jackpot-setup",
        align: "center",
        render: (row) =>
          row.requiresJackpotSetup
            ? '<span class="label label-warning">Ja</span>'
            : '<span class="text-muted">Nei</span>',
      },
      {
        key: "isActive",
        title: "Status",
        align: "center",
        render: (row) =>
          row.isActive
            ? '<span class="label label-success">Aktiv</span>'
            : '<span class="label label-default">Inaktiv</span>',
      },
      {
        key: "id",
        title: "Handling",
        align: "center",
        render: (row) => {
          if (!writeAccess) {
            return `
              <a href="#/games/catalog/${encodeURIComponent(row.id)}"
                 class="btn btn-info btn-xs btn-rounded"
                 title="Vis">
                <i class="fa fa-eye" aria-hidden="true"></i>
              </a>`;
          }
          return `
            <a href="#/games/catalog/${encodeURIComponent(row.id)}"
               class="btn btn-warning btn-xs btn-rounded"
               title="Rediger">
              <i class="fa fa-edit" aria-hidden="true"></i>
            </a>
            ${
              row.isActive
                ? `<button type="button"
                     class="btn btn-danger btn-xs btn-rounded m-l-3"
                     title="Deaktiver"
                     data-action="deactivate-catalog"
                     data-id="${escapeHtml(row.id)}"
                     data-name="${escapeHtml(row.displayName)}">
                     <i class="fa fa-trash" aria-hidden="true"></i>
                   </button>`
                : ""
            }`;
        },
      },
    ],
  });

  if (writeAccess) {
    host
      .querySelectorAll<HTMLButtonElement>(
        'button[data-action="deactivate-catalog"]',
      )
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.id;
          const name = btn.dataset.name ?? "";
          if (!id) return;
          if (!window.confirm(`Deaktiver «${name}»?`)) return;
          void handleDeactivate(host, id);
        });
      });
  }
}

async function handleDeactivate(
  host: HTMLElement,
  id: string,
): Promise<void> {
  const result = await deactivateCatalogEntry(id);
  if (result.ok) {
    Toast.success("Deaktivert.");
    // Re-load list
    const filterEl = document.querySelector<HTMLSelectElement>(
      "#game-catalog-filter",
    );
    await loadAndRender(host, filterEl?.value ?? "all");
    return;
  }
  Toast.error(result.message);
}
