// Detail pages for the GameManagement stack.
//
// BIN-684 wire-up (bolk 1): View (read-only) + SubGames er live mot
// `/api/admin/game-management/:typeId/:id`. Tickets-per-game mangler
// fortsatt backend-rute → placeholder. CloseDay er BIN-623 → placeholder.
// Add/Add-G3 er skjema med ~50 felt som ikke er skopet inn i wire-up — PR-A3b
// lander selve skjema-UI-en senere; her er knappen aktivert og viser
// placeholder med "kommer".
//
// Legacy files covered here (8 files, ~6 930 lines):
//   - viewGameDetails.html    (383L) → list-per-type (already covered by main list)
//   - gameAdd.html            (2497L) → add (placeholder: skjema-UI kommer)
//   - game3Add.html           (2158L) → add Game-3 (placeholder: skjema-UI kommer)
//   - gameView.html           ( 650L) → read-only view — NÅ LIVE
//   - game3View.html          ( 442L) → read-only view Game-3 — NÅ LIVE
//   - viewGameTickets.html    ( 585L) → ticket-list (backend-rute mangler)
//   - ticketView.html         ( 205L) → ticket-modal (backend-rute mangler)
//   - mainSubGames.html       ( 410L) → nested sub-games — NÅ LIVE (data-only)
//   - closeDay.html           ( 480L) → day-close confirm (BIN-623)

import { t } from "../../../i18n/I18n.js";
import { Toast } from "../../../components/Toast.js";
import { escapeHtml } from "../common/escape.js";
import { fetchGameTypeList } from "../gameType/GameTypeState.js";
import type { GameType } from "../common/types.js";
import {
  fetchGameManagement,
  fetchCloseDaySummary,
  closeDay,
  type GameManagementRow,
  type CloseDaySummary,
} from "./GameManagementState.js";
import { ApiError } from "../../../api/client.js";

interface ShellOpts {
  title: string;
  breadcrumb: Array<{ label: string; href?: string }>;
  backHref: string;
  backLabel: string;
  /** HTML content for the panel body. */
  body: string;
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
                  <i class="fa fa-arrow-left" aria-hidden="true"></i> ${escapeHtml(opts.backLabel)}
                </a>
              </div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">${opts.body}</div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

function placeholderBody(issue: string, text: string): string {
  return `
    <div class="alert alert-warning" data-testid="gm-placeholder">
      <i class="fa fa-info-circle" aria-hidden="true"></i>
      ${escapeHtml(text)}
      <strong>${escapeHtml(issue)}</strong>
    </div>`;
}

function loadingBody(): string {
  return `<div class="text-center" data-testid="gm-detail-loading"><i class="fa fa-spinner fa-spin fa-2x" aria-hidden="true"></i></div>`;
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

/** Format ApiError til kontekstuell feilmelding. */
function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return t("permission_denied");
    if (err.status === 404) return t("not_found");
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Tabell-rad helper. */
function kvRow(label: string, value: string | number | null | undefined): string {
  return `<tr><th style="width:30%;">${escapeHtml(label)}</th><td>${escapeHtml(String(value ?? ""))}</td></tr>`;
}

/** Felles view-tabell brukt av både view og view-g3. */
function renderGameView(row: GameManagementRow): string {
  return `
    <div data-testid="gm-view-details">
      <table class="table table-bordered" style="max-width:700px;">
        <tbody>
          ${kvRow(t("game_id"), row._id)}
          ${kvRow(t("child_id"), row.childId ?? "")}
          ${kvRow(t("game_name"), row.name)}
          ${kvRow(t("ticket_type"), row.ticketType ?? "")}
          ${kvRow(t("ticket_price"), row.ticketPrice)}
          ${kvRow(t("start_date"), row.startDate)}
          ${kvRow(t("end_date"), row.endDate ?? "")}
          ${kvRow(t("status"), row.status)}
          ${kvRow(t("total_sold"), row.totalSold ?? 0)}
          ${kvRow(t("total_earning"), row.totalEarning ?? 0)}
          ${kvRow(t("created_at"), row.createdAt)}
        </tbody>
      </table>
    </div>`;
}

// ── Add / Add-G3 ───────────────────────────────────────────────────────────

/**
 * /gameManagement/:typeId/add — erstatning for legacy gameAdd.html (2 497 lines).
 *
 * Spill 1 (game_1) får full skjema-UI via GameManagementAddForm.
 * Andre varianter (game_2, game_5) får en "ikke wired ennå"-placeholder
 * fra samme modul inntil de også blir implementert.
 */
export { renderGameManagementAddPage } from "./GameManagementAddForm.js";

/** /gameManagement/:typeId/add-g3 — skjema-UI kommer i egen PR. */
export async function renderGameManagementAddG3Page(container: HTMLElement, typeId: string): Promise<void> {
  const gt = await resolveGameType(typeId);
  container.innerHTML = renderShell({
    title: `${t("add_game")} (Spill 3) — ${gt?.name ?? typeId}`,
    breadcrumb: [...baseCrumb(gt, typeId), { label: `${t("add_game")} (G3)` }],
    backHref: `#/gameManagement?typeId=${encodeURIComponent(typeId)}`,
    backLabel: t("back"),
    body: placeholderBody(
      "BIN-622",
      "Add Game-3-skjema (pattern-grid + sub-games) er under arbeid. CRUD-endpoint er klar."
    ),
  });
}

// ── View / View-G3: LIVE ───────────────────────────────────────────────────

/** /gameManagement/:typeId/view/:id — live detail view. */
export async function renderGameManagementViewPage(
  container: HTMLElement,
  typeId: string,
  id: string
): Promise<void> {
  const gt = await resolveGameType(typeId);
  const title = `${gt?.name ?? typeId} — ${t("view")} #${id}`;
  container.innerHTML = renderShell({
    title,
    breadcrumb: [...baseCrumb(gt, typeId), { label: `${t("view")} #${id}` }],
    backHref: `#/gameManagement?typeId=${encodeURIComponent(typeId)}`,
    backLabel: t("back"),
    body: loadingBody(),
  });
  const body = container.querySelector<HTMLElement>(".panel-body");
  if (!body) return;
  try {
    const row = await fetchGameManagement(typeId, id);
    if (!row) {
      body.innerHTML = `<div class="alert alert-warning" data-testid="gm-not-found">${escapeHtml(t("not_found"))}</div>`;
      return;
    }
    body.innerHTML = renderGameView(row);
  } catch (err) {
    body.innerHTML = `<div class="alert alert-danger" data-testid="gm-error">${escapeHtml(formatError(err))}</div>`;
  }
}

/** /gameManagement/:typeId/view-g3/:id — live detail view Game-3. */
export async function renderGameManagementViewG3Page(
  container: HTMLElement,
  typeId: string,
  id: string
): Promise<void> {
  const gt = await resolveGameType(typeId);
  const title = `${gt?.name ?? typeId} (Spill 3) — ${t("view")} #${id}`;
  container.innerHTML = renderShell({
    title,
    breadcrumb: [...baseCrumb(gt, typeId), { label: `${t("view")} G3 #${id}` }],
    backHref: `#/gameManagement?typeId=${encodeURIComponent(typeId)}`,
    backLabel: t("back"),
    body: loadingBody(),
  });
  const body = container.querySelector<HTMLElement>(".panel-body");
  if (!body) return;
  try {
    const row = await fetchGameManagement(typeId, id);
    if (!row) {
      body.innerHTML = `<div class="alert alert-warning" data-testid="gm-not-found">${escapeHtml(t("not_found"))}</div>`;
      return;
    }
    body.innerHTML = renderGameView(row);
  } catch (err) {
    body.innerHTML = `<div class="alert alert-danger" data-testid="gm-error">${escapeHtml(formatError(err))}</div>`;
  }
}

// ── Tickets — backend-rute mangler (ikke i BIN-622 scope) ──────────────────

/** /gameManagement/:typeId/tickets/:id — tickets-per-game (placeholder). */
export async function renderGameManagementTicketsPage(
  container: HTMLElement,
  typeId: string,
  id: string
): Promise<void> {
  const gt = await resolveGameType(typeId);
  container.innerHTML = renderShell({
    title: `${t("ticket")} — ${gt?.name ?? typeId} #${id}`,
    breadcrumb: [...baseCrumb(gt, typeId), { label: `${t("ticket")} #${id}` }],
    backHref: `#/gameManagement?typeId=${encodeURIComponent(typeId)}`,
    backLabel: t("back"),
    body: placeholderBody(
      "BIN-622",
      "Ticket-listing per spill-runde: backend-rute mangler (legacy slo sammen 4 tabeller). Kommer i egen PR."
    ),
  });
}

// ── SubGames — LIVE (data fra samme GameManagement GET) ────────────────────

/** /gameManagement/subGames/:typeId/:id — nested sub-games. */
export async function renderGameManagementSubGamesPage(
  container: HTMLElement,
  typeId: string,
  id: string
): Promise<void> {
  const gt = await resolveGameType(typeId);
  const title = `${t("sub_game")} — ${gt?.name ?? typeId} #${id}`;
  container.innerHTML = renderShell({
    title,
    breadcrumb: [...baseCrumb(gt, typeId), { label: `${t("sub_game")} #${id}` }],
    backHref: `#/gameManagement?typeId=${encodeURIComponent(typeId)}`,
    backLabel: t("back"),
    body: loadingBody(),
  });
  const body = container.querySelector<HTMLElement>(".panel-body");
  if (!body) return;
  try {
    const row = await fetchGameManagement(typeId, id);
    if (!row) {
      body.innerHTML = `<div class="alert alert-warning" data-testid="gm-not-found">${escapeHtml(t("not_found"))}</div>`;
      return;
    }
    // Sub-game komposisjon ligger i `config.subGames` inntil BIN-621/627 ─
    // vi rendrer foreldre-row + info om koblet parent (hvis finnes).
    const parentRow = row.childId
      ? `<p><strong>${escapeHtml(t("parent_game"))}:</strong> ${escapeHtml(row.childId)}</p>`
      : "";
    body.innerHTML = `
      <div data-testid="gm-subgames">
        <p><strong>${escapeHtml(t("game_name"))}:</strong> ${escapeHtml(row.name)}</p>
        ${parentRow}
        <div class="alert alert-info">
          <i class="fa fa-info-circle" aria-hidden="true"></i>
          Sub-game-komposisjon normaliseres først når BIN-621 SubGame CRUD lander (Agent C).
          Inntil da lagres slots opaque i <code>config.subGames</code>.
        </div>
      </div>`;
  } catch (err) {
    body.innerHTML = `<div class="alert alert-danger" data-testid="gm-error">${escapeHtml(formatError(err))}</div>`;
  }
}

// ── CloseDay (BIN-623) — live ──────────────────────────────────────────────

/** Returnerer dagens dato som "YYYY-MM-DD" (lokal tidssone). */
function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Tabell-rad som formatterer tall + ISO-tid. */
function summaryRow(label: string, value: string | number): string {
  return `<tr><th style="width:40%;">${escapeHtml(label)}</th><td>${escapeHtml(String(value))}</td></tr>`;
}

function renderCloseDayBody(row: GameManagementRow, summary: CloseDaySummary, closeDate: string): string {
  const warn = summary.alreadyClosed
    ? `<div class="alert alert-info" data-testid="cd-already-closed">
         <i class="fa fa-info-circle" aria-hidden="true"></i>
         ${escapeHtml(t("already_closed"))} — ${escapeHtml(summary.closedAt ?? "")}
       </div>`
    : `<div class="alert alert-warning">
         <i class="fa fa-warning" aria-hidden="true"></i>
         ${escapeHtml(t("close_day_confirm_warning"))}
       </div>`;

  return `
    <div data-testid="cd-summary">
      <h4>${escapeHtml(row.name)} — ${escapeHtml(closeDate)}</h4>
      ${warn}
      <table class="table table-bordered" style="max-width:700px;">
        <tbody>
          ${summaryRow(t("total_sold"), summary.totalSold)}
          ${summaryRow(t("total_earning"), summary.totalEarning)}
          ${summaryRow(t("tickets_sold"), summary.ticketsSold)}
          ${summaryRow(t("winners_count"), summary.winnersCount)}
          ${summaryRow(t("payouts_total"), summary.payoutsTotal)}
          ${summaryRow(t("jackpots_total"), summary.jackpotsTotal)}
          ${summaryRow(t("captured_at"), summary.capturedAt)}
        </tbody>
      </table>
      <div style="padding-top:16px;">
        <input type="hidden" id="cd-close-date" value="${escapeHtml(closeDate)}">
        <input type="hidden" id="cd-game-id" value="${escapeHtml(row._id)}">
        <button type="button" class="btn btn-danger btn-lg"
          data-action="confirm-close-day"
          ${summary.alreadyClosed ? "disabled" : ""}>
          <i class="fa fa-lock" aria-hidden="true"></i> ${escapeHtml(t("close_day"))}
        </button>
      </div>
    </div>`;
}

/** /gameManagement/closeDay/:typeId/:id — live CloseDay (BIN-623). */
export async function renderGameManagementCloseDayPage(
  container: HTMLElement,
  typeId: string,
  id: string
): Promise<void> {
  const gt = await resolveGameType(typeId);
  const closeDate = todayIsoDate();
  container.innerHTML = renderShell({
    title: `${t("close_day")} — ${gt?.name ?? typeId} #${id}`,
    breadcrumb: [...baseCrumb(gt, typeId), { label: `${t("close_day")} #${id}` }],
    backHref: `#/gameManagement?typeId=${encodeURIComponent(typeId)}`,
    backLabel: t("back"),
    body: loadingBody(),
  });
  const body = container.querySelector<HTMLElement>(".panel-body");
  if (!body) return;
  try {
    const [row, summary] = await Promise.all([
      fetchGameManagement(typeId, id),
      fetchCloseDaySummary(id, closeDate),
    ]);
    if (!row) {
      body.innerHTML = `<div class="alert alert-warning" data-testid="gm-not-found">${escapeHtml(t("not_found"))}</div>`;
      return;
    }
    if (!summary) {
      body.innerHTML = `<div class="alert alert-danger" data-testid="cd-summary-missing">${escapeHtml(t("not_found"))}</div>`;
      return;
    }
    body.innerHTML = renderCloseDayBody(row, summary, closeDate);
    wireCloseDayConfirm(body, typeId, id);
  } catch (err) {
    body.innerHTML = `<div class="alert alert-danger" data-testid="gm-error">${escapeHtml(formatError(err))}</div>`;
  }
}

function wireCloseDayConfirm(host: HTMLElement, _typeId: string, gameId: string): void {
  const btn = host.querySelector<HTMLButtonElement>('button[data-action="confirm-close-day"]');
  if (!btn) return;
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    const dateEl = host.querySelector<HTMLInputElement>("#cd-close-date");
    const closeDate = dateEl?.value ?? todayIsoDate();
    if (!window.confirm(t("close_day_confirm_prompt"))) return;
    void doCloseDay(btn, gameId, closeDate);
  });
}

async function doCloseDay(btn: HTMLButtonElement, gameId: string, closeDate: string): Promise<void> {
  btn.disabled = true;
  try {
    const result = await closeDay({ gameId, closeDate, gameTypeId: "" });
    if (result.ok) {
      Toast.success(t("close_day_success"));
      // Navigate back to list after successful close.
      setTimeout(() => {
        window.location.hash = "#/gameManagement";
      }, 500);
      return;
    }
    if (result.reason === "ALREADY_CLOSED") {
      Toast.info(t("already_closed"));
      return;
    }
    Toast.error(result.message ?? t("something_went_wrong"));
  } finally {
    btn.disabled = false;
  }
}
