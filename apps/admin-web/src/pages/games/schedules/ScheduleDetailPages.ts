// Schedule detail pages — create (router-navigated) and view (read-only).
//
// `#/schedules/create` renders a thin wrapper that triggers the modal-based
// editor (same code path som list-siden sin Add-knapp). Dette matcher
// BIN-625-scope der den store legacy-builderen (5 382L) fortsatt er
// follow-up — de essensielle CRUD-feltene dekkes av modalen.
//
// `#/schedules/view/:id` viser read-only detalj + sub-games for malen.

import { t } from "../../../i18n/I18n.js";
import { Toast } from "../../../components/Toast.js";
import { Modal } from "../../../components/Modal.js";
import { ApiError } from "../../../api/client.js";
import { escapeHtml } from "../common/escape.js";
import {
  fetchSchedule,
  type ScheduleRow,
  type ScheduleSubgame,
} from "./ScheduleState.js";
import { openScheduleEditorModal } from "./ScheduleEditorModal.js";
import {
  listDailySchedules,
  type DailyScheduleRow,
} from "../../../api/admin-daily-schedules.js";
import { listHalls, type AdminHall } from "../../../api/admin-halls.js";

export type ScheduleDetailKind = "create" | "view";

export interface ScheduleDetailOpts {
  kind: ScheduleDetailKind;
  id?: string;
}

/**
 * Rydder opp rester av modal-DOM fra tidligere besøk. Uten dette stacker
 * `.modal.fade.in` + `.modal-backdrop` seg opp når admin navigerer
 * tilbake/frem til `/schedules/create` (memory-leak observert i QA).
 *
 * Vi bruker `Modal.closeAll(true)` for properly registrerte instanser, og
 * følger opp med et DOM-sweep for foreldreløse noder (f.eks. hvis en gammel
 * modal ble lagt til av legacy bootstrap.min.js eller en tidligere
 * feilhåndtering droppet referansen).
 */
function cleanupStaleModals(): void {
  Modal.closeAll(true);
  document
    .querySelectorAll(".modal.fade.in, .modal-backdrop")
    .forEach((el) => el.remove());
  document.body.classList.remove("modal-open");
}

export async function renderScheduleDetailPages(
  container: HTMLElement,
  opts: ScheduleDetailOpts
): Promise<void> {
  cleanupStaleModals();
  if (opts.kind === "create") {
    renderCreateShell(container);
    // Åpner modalen automatisk slik at URL-routen /schedules/create fortsatt
    // starter opprettingsflyten. Siden bak ligger som fallback hvis modalen
    // lukkes uten å lagre.
    await openScheduleEditorModal({
      mode: "create",
      onSaved: (row: ScheduleRow) => {
        Toast.success(t("schedule_created_success"));
        window.location.hash = `#/schedules/view/${encodeURIComponent(row.id)}`;
      },
    });
    return;
  }
  await renderViewPage(container, opts.id ?? "");
}

function renderCreateShell(container: HTMLElement): void {
  const title = `${t("add")} — ${t("schedule_management")}`;
  container.innerHTML = `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(title)}</h1>
        <ol class="breadcrumb pull-right">
          <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="#/schedules">${escapeHtml(t("schedule_management"))}</a></li>
          <li class="active">${escapeHtml(t("create_schedule"))}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(title)}</h6></div>
              <div class="pull-right">
                <a href="#/schedules" class="btn btn-default btn-sm">
                  <i class="fa fa-arrow-left" aria-hidden="true"></i> ${escapeHtml(t("back"))}
                </a>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <p class="text-muted">${escapeHtml(t("schedule_create_redirect_hint"))}</p>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

async function renderViewPage(container: HTMLElement, id: string): Promise<void> {
  const title = `${t("view_schedule")}${id ? ` #${id}` : ""}`;
  container.innerHTML = `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(title)}</h1>
        <ol class="breadcrumb pull-right">
          <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="#/schedules">${escapeHtml(t("schedule_management"))}</a></li>
          <li class="active">${escapeHtml(title)}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(t("view_schedule"))}</h6></div>
              <div class="pull-right">
                <a href="#/schedules" class="btn btn-default btn-sm">
                  <i class="fa fa-arrow-left" aria-hidden="true"></i> ${escapeHtml(t("back"))}
                </a>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body" id="schedule-view-body">
                <div class="text-center"><i class="fa fa-spinner fa-spin fa-2x" aria-hidden="true"></i></div>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;

  const body = container.querySelector<HTMLElement>("#schedule-view-body");
  if (!body || !id) {
    if (body) body.innerHTML = `<div class="alert alert-warning">${escapeHtml(t("schedule_not_found"))}</div>`;
    return;
  }
  try {
    const row = await fetchSchedule(id);
    if (!row) {
      body.innerHTML = `<div class="alert alert-warning">${escapeHtml(t("schedule_not_found"))}</div>`;
      return;
    }
    // Hent daily-schedules + halls parallelt for "Brukt av:"-seksjonen.
    // Backend listDailySchedules-filteret støtter ikke `scheduleId`-filter,
    // så vi henter aktive (limit 200) og filtrerer klient-side på
    // otherData.scheduleIdsByDay som refererer til mal-IDen. Begge kall
    // er best-effort — feil her skal IKKE skjule mal-detaljene.
    let dailySchedules: DailyScheduleRow[] = [];
    let halls: AdminHall[] = [];
    try {
      const [dsRes, hallList] = await Promise.all([
        listDailySchedules({ limit: 200 }),
        listHalls({ includeInactive: true }),
      ]);
      dailySchedules = dsRes.schedules;
      halls = hallList;
    } catch (linkedErr) {
      // Ikke fatal — vis schedule-detaljer + advarsel, men ikke alert-danger.
      console.warn("Kunne ikke hente koblede daily-schedules/halls", linkedErr);
    }
    const usedBy = filterDailySchedulesByScheduleId(dailySchedules, row.id);
    const hallNameById = new Map(halls.map((h) => [h.id, h.name]));
    body.innerHTML = renderDetail(row, usedBy, hallNameById);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
    body.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
  }
}

/**
 * Filtrerer daily-schedules som refererer til mal-IDen. Schedule (mal) er
 * koblet til DailySchedule via `otherData.scheduleIdsByDay` — et objekt
 * `{ monday: ["sched-1"], tuesday: [...], ... }`. En daily-schedule "bruker"
 * malen hvis ID-en finnes i noen av ukedagene.
 *
 * Aksepterer også at malen kan være referert via `scheduleNumber`-feltet
 * i fri-form `otherData` (legacy-data tolerant).
 */
function filterDailySchedulesByScheduleId(
  schedules: DailyScheduleRow[],
  scheduleId: string
): DailyScheduleRow[] {
  return schedules.filter((s) => {
    const other = s.otherData as Record<string, unknown> | undefined;
    if (!other) return false;
    const byDay = other.scheduleIdsByDay;
    if (!byDay || typeof byDay !== "object") return false;
    for (const ids of Object.values(byDay as Record<string, unknown>)) {
      if (Array.isArray(ids) && ids.includes(scheduleId)) return true;
    }
    return false;
  });
}

function renderDetail(
  row: ScheduleRow,
  usedBy: DailyScheduleRow[],
  hallNameById: Map<string, string>
): string {
  const rows = [
    [t("schedules_name"), row.scheduleName],
    [t("schedules_id"), row.scheduleNumber],
    [t("schedules_type"), row.scheduleType],
    [t("lucky_number_prize"), String(row.luckyNumberPrize)],
    [t("status"), row.status],
    [t("manual_start_time"), row.manualStartTime || "—"],
    [t("manual_end_time"), row.manualEndTime || "—"],
    [t("creation_date_time"), row.createdAt],
  ];
  const detailHtml = rows
    .map(
      ([label, value]) =>
        `<tr><th style="width:30%;">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
    )
    .join("");
  return `
    <table class="table table-striped">${detailHtml}</table>
    ${renderUsedBySection(usedBy, hallNameById)}
    ${renderSubGamesSection(row.subGames)}`;
}

function renderUsedBySection(
  usedBy: DailyScheduleRow[],
  hallNameById: Map<string, string>
): string {
  const heading = `<h4>${escapeHtml(t("schedule_used_by"))} (${usedBy.length})</h4>`;
  if (usedBy.length === 0) {
    return `${heading}<div class="alert alert-info">${escapeHtml(t("schedule_used_by_empty"))}</div>`;
  }
  const rows = usedBy
    .map((ds) => {
      const masterId = ds.hallIds?.masterHallId ?? ds.hallId ?? null;
      const masterName = masterId
        ? (hallNameById.get(masterId) ?? masterId)
        : "—";
      const memberCount = ds.hallIds?.hallIds?.length ?? 0;
      const groupCount = ds.hallIds?.groupHallIds?.length ?? 0;
      const dateRange = formatDateRange(ds.startDate, ds.endDate);
      return `
        <tr>
          <td>${escapeHtml(ds.name)}</td>
          <td>${escapeHtml(masterName)}</td>
          <td class="text-center">${memberCount}</td>
          <td class="text-center">${groupCount}</td>
          <td>${escapeHtml(dateRange)}</td>
          <td>${renderStatusBadge(ds.status)}</td>
        </tr>`;
    })
    .join("");
  return `
    ${heading}
    <div class="table-responsive">
      <table class="table table-striped table-bordered">
        <thead>
          <tr>
            <th>${escapeHtml(t("name"))}</th>
            <th>${escapeHtml(t("master_hall"))}</th>
            <th class="text-center">${escapeHtml(t("schedule_member_halls"))}</th>
            <th class="text-center">${escapeHtml(t("group_of_halls"))}</th>
            <th>${escapeHtml(t("date_range"))}</th>
            <th>${escapeHtml(t("status"))}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderStatusBadge(status: DailyScheduleRow["status"]): string {
  const map: Record<DailyScheduleRow["status"], string> = {
    active: `<span class="label label-success">${escapeHtml(t("active"))}</span>`,
    running: `<span class="label label-primary">${escapeHtml(status)}</span>`,
    finish: `<span class="label label-default">${escapeHtml(status)}</span>`,
    inactive: `<span class="label label-danger">${escapeHtml(t("inactive"))}</span>`,
  };
  return map[status] ?? escapeHtml(status);
}

function formatDateRange(startDate: string, endDate: string | null): string {
  const start = formatDate(startDate);
  if (!endDate) return start;
  return `${start} → ${formatDate(endDate)}`;
}

function formatDate(iso: string): string {
  // Backend returnerer ISO-streng; vis kun YYYY-MM-DD i tabellen.
  const idx = iso.indexOf("T");
  return idx >= 0 ? iso.slice(0, idx) : iso;
}

function renderSubGamesSection(subGames: ScheduleSubgame[]): string {
  const heading = `<h4>${escapeHtml(t("sub_games"))} (${subGames.length})</h4>`;
  if (subGames.length === 0) {
    return `${heading}<div class="alert alert-info">${escapeHtml(t("no_data_available"))}</div>`;
  }
  const rows = subGames
    .map((sg, idx) => {
      const name = sg.customGameName || sg.name || `#${idx + 1}`;
      const type = sg.subGameType ?? "STANDARD";
      const ticketSummary = summarizeTicketColors(sg);
      const prizeSummary = summarizePrizes(sg);
      const colorCount = countTicketColors(sg);
      const timing = formatTiming(sg);
      return `
        <tr>
          <td>${escapeHtml(name)}</td>
          <td><span class="label label-info">${escapeHtml(type)}</span></td>
          <td>${escapeHtml(timing)}</td>
          <td>${escapeHtml(ticketSummary)}</td>
          <td>${escapeHtml(prizeSummary)}</td>
          <td class="text-center">${colorCount}</td>
        </tr>`;
    })
    .join("");
  return `
    ${heading}
    <div class="table-responsive">
      <table class="table table-striped table-bordered">
        <thead>
          <tr>
            <th>${escapeHtml(t("name"))}</th>
            <th>${escapeHtml(t("schedules_type"))}</th>
            <th>${escapeHtml(t("manual_start_time"))} / ${escapeHtml(t("manual_end_time"))}</th>
            <th>${escapeHtml(t("price"))}</th>
            <th>${escapeHtml(t("lucky_number_prize"))}</th>
            <th class="text-center">${escapeHtml(t("ticket_color"))}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function formatTiming(sg: ScheduleSubgame): string {
  const start = sg.startTime || "";
  const end = sg.endTime || "";
  if (!start && !end) return "—";
  return `${start || "—"} / ${end || "—"}`;
}

function countTicketColors(sg: ScheduleSubgame): number {
  if (!sg.ticketTypesData || typeof sg.ticketTypesData !== "object") return 0;
  return Object.keys(sg.ticketTypesData).length;
}

/**
 * Komprimer ticketTypesData til en kort streng. Forventet shape er fri-form
 * `Record<color, { price?: number, ... }>` per legacy-paritet, så vi prøver
 * å lese første-nivå-pris-felter og ramler tilbake til antall farger.
 */
function summarizeTicketColors(sg: ScheduleSubgame): string {
  const data = sg.ticketTypesData;
  if (!data || typeof data !== "object") return "—";
  const entries = Object.entries(data);
  if (entries.length === 0) return "—";
  const prices = entries
    .map(([color, val]) => {
      if (val && typeof val === "object" && "price" in (val as object)) {
        const price = (val as { price?: unknown }).price;
        if (typeof price === "number") return `${color}: ${price}`;
      }
      return color;
    })
    .slice(0, 4);
  const more = entries.length > 4 ? ` (+${entries.length - 4})` : "";
  return prices.join(", ") + more;
}

/**
 * Komprimer pattern-/jackpot-prizes til en kort streng. Schedule-malen har
 * fri-form `jackpotData` + ad-hoc prize-felter, så vi gjør et best-effort
 * sammendrag (jackpot count + elvis-flag).
 */
function summarizePrizes(sg: ScheduleSubgame): string {
  const parts: string[] = [];
  if (sg.jackpotData && typeof sg.jackpotData === "object") {
    const count = Object.keys(sg.jackpotData).length;
    if (count > 0) parts.push(`Jackpot×${count}`);
  }
  if (sg.elvisData && typeof sg.elvisData === "object") {
    const count = Object.keys(sg.elvisData).length;
    if (count > 0) parts.push(`Elvis×${count}`);
  }
  if (sg.spill1Overrides) parts.push("Spill1-override");
  return parts.length === 0 ? "—" : parts.join(", ");
}
