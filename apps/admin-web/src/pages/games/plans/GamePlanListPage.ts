/**
 * Fase 2 (2026-05-07): GamePlan list-side.
 *
 * URL: /admin/#/games/plans
 *
 * Layout: tabell med Navn, Hall/Gruppe, Dager, Tidsvindu, Antall spill,
 * Aktiv, Handling. "Opprett plan"-knapp øverst (kun ADMIN).
 */

import { t } from "../../../i18n/I18n.js";
import { DataTable } from "../../../components/DataTable.js";
import { Toast } from "../../../components/Toast.js";
import { escapeHtml } from "../../../utils/escapeHtml.js";
import { getSession } from "../../../auth/Session.js";
import {
  fetchPlanList,
  deactivatePlan,
} from "./GamePlanState.js";
import type {
  GamePlan,
  Weekday,
} from "../../../api/admin-game-plans.js";
import { listHalls, type AdminHall } from "../../../api/admin-halls.js";

const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Man",
  tue: "Tir",
  wed: "Ons",
  thu: "Tor",
  fri: "Fre",
  sat: "Lør",
  sun: "Søn",
};

function canWrite(): boolean {
  const session = getSession();
  if (!session) return false;
  return session.role === "admin" || session.role === "super-admin";
}

export async function renderGamePlanListPage(
  container: HTMLElement,
): Promise<void> {
  container.innerHTML = renderShell();

  const tableHost = container.querySelector<HTMLElement>("#game-plan-list-table");
  if (!tableHost) return;

  const filterSelect = container.querySelector<HTMLSelectElement>(
    "#game-plan-filter",
  );
  filterSelect?.addEventListener("change", () => {
    void loadAndRender(tableHost, filterSelect.value);
  });

  const addBtn = container.querySelector<HTMLAnchorElement>(
    '[data-action="add-game-plan"]',
  );
  if (addBtn) {
    if (!canWrite()) {
      addBtn.style.display = "none";
    } else {
      addBtn.addEventListener("click", (e) => {
        e.preventDefault();
        window.location.hash = "#/games/plans/new";
      });
    }
  }

  await loadAndRender(tableHost, filterSelect?.value ?? "active");
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
    const [plans, halls] = await Promise.all([
      fetchPlanList(params),
      listHalls({ includeInactive: true }).catch(() => [] as AdminHall[]),
    ]);
    const hallById = new Map(halls.map((h) => [h.id, h]));
    renderTable(host, plans, hallById);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    host.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
  }
}

function renderShell(): string {
  return `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>Spilleplaner</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li>Spilladministrasjon</li>
          <li class="active">Spilleplaner</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">Spilleplaner</h6></div>
              <div class="pull-right">
                <select id="game-plan-filter" class="form-control" style="display:inline-block;width:auto;margin-right:8px">
                  <option value="all">Alle</option>
                  <option value="active" selected>Aktiv</option>
                  <option value="inactive">Inaktiv</option>
                </select>
                <a href="#/games/plans/new"
                  class="btn btn-primary btn-md"
                  data-action="add-game-plan">
                  <i class="fa fa-plus" aria-hidden="true"></i> Opprett plan
                </a>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in"><div class="panel-body">
              <p class="text-muted">
                En spilleplan definerer hvilken sekvens av spill som kjøres en gitt dag i en hall (eller gruppe haller).
                Plan-builderen lar deg dra spill fra katalogen inn i sekvensen og endre rekkefølgen.
              </p>
              <div class="table-wrap"><div class="table-responsive">
                <div id="game-plan-list-table"></div>
              </div></div>
            </div></div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

function renderWeekdayChips(days: Weekday[]): string {
  if (days.length === 0) return '<span class="text-muted">—</span>';
  return days
    .map(
      (d) =>
        `<span style="display:inline-block;padding:1px 6px;margin:0 2px 2px 0;border-radius:8px;font-size:10px;background:#e7f1ff;color:#0040b3;border:1px solid #b8d4ff">${escapeHtml(WEEKDAY_LABELS[d])}</span>`,
    )
    .join("");
}

function renderTable(
  host: HTMLElement,
  rows: GamePlan[],
  hallById: Map<string, AdminHall>,
): void {
  const writeAccess = canWrite();
  DataTable.mount(host, {
    className: "game-plan-list pb-30",
    emptyMessage:
      "Ingen spilleplaner ennå. Opprett din første plan via «Opprett plan».",
    rows,
    columns: [
      { key: "name", title: "Navn" },
      {
        key: "hallId",
        title: "Hall / Gruppe",
        render: (row) => {
          if (row.hallId) {
            const hall = hallById.get(row.hallId);
            return `<small><i class="fa fa-bank" aria-hidden="true"></i> ${escapeHtml(hall?.name ?? row.hallId)}</small>`;
          }
          if (row.groupOfHallsId) {
            return `<small><i class="fa fa-sitemap" aria-hidden="true"></i> Gruppe ${escapeHtml(row.groupOfHallsId)}</small>`;
          }
          return '<span class="text-muted">—</span>';
        },
      },
      {
        key: "weekdays",
        title: "Dager",
        render: (row) => renderWeekdayChips(row.weekdays),
      },
      {
        key: "startTime",
        title: "Tid",
        align: "center",
        render: (row) =>
          `<small>${escapeHtml(row.startTime)} – ${escapeHtml(row.endTime)}</small>`,
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
              <a href="#/games/plans/${encodeURIComponent(row.id)}"
                 class="btn btn-info btn-xs btn-rounded" title="Vis">
                <i class="fa fa-eye" aria-hidden="true"></i>
              </a>`;
          }
          return `
            <a href="#/games/plans/${encodeURIComponent(row.id)}"
               class="btn btn-warning btn-xs btn-rounded" title="Rediger">
              <i class="fa fa-edit" aria-hidden="true"></i>
            </a>
            ${
              row.isActive
                ? `<button type="button"
                     class="btn btn-danger btn-xs btn-rounded m-l-3"
                     title="Deaktiver"
                     data-action="deactivate-plan"
                     data-id="${escapeHtml(row.id)}"
                     data-name="${escapeHtml(row.name)}">
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
      .querySelectorAll<HTMLButtonElement>('button[data-action="deactivate-plan"]')
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
  const result = await deactivatePlan(id);
  if (result.ok) {
    Toast.success("Deaktivert.");
    const filterEl = document.querySelector<HTMLSelectElement>("#game-plan-filter");
    await loadAndRender(host, filterEl?.value ?? "all");
    return;
  }
  Toast.error(result.message);
}
