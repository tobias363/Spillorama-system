// LOW-1: Spillopptak — admin replay-side.
//
// Path: /admin/replay/:gameId
//
// Data: GET /api/admin/games/:gameId/replay (Game1ReplayService).
// Permissions: GAME1_GAME_READ + PLAYER_KYC_READ.
//
// Viser tidslinje + filtrerbar event-type for et fullført Spill 1
// scheduled_game. PII er allerede redacted i backend; klient gjør
// ingen ekstra masking. Read-only — alle audit-events er append-only.

import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  fetchGameReplay,
  type Game1ReplayEvent,
  type Game1ReplayEventType,
  type Game1ReplayResult,
} from "../../api/admin-game-replay.js";
import { boxClose, boxOpen, contentHeader, escapeHtml } from "../amountwithdraw/shared.js";

interface PageState {
  replay: Game1ReplayResult | null;
  filterType: Game1ReplayEventType | "all";
}

const EVENT_TYPE_LABELS: Record<Game1ReplayEventType, string> = {
  room_created: "Spill opprettet",
  player_joined: "Spiller koblet til",
  tickets_purchased: "Bonger kjøpt",
  game_started: "Spill startet",
  draw: "Trekning",
  phase_won: "Fase vunnet",
  mini_game_triggered: "Mini-spill startet",
  mini_game_completed: "Mini-spill fullført",
  payout: "Utbetaling",
  game_paused: "Spill pauset",
  game_resumed: "Spill gjenopptatt",
  game_stopped: "Spill stoppet",
  hall_excluded: "Hall ekskludert",
  hall_included: "Hall inkludert",
  game_ended: "Spill avsluttet",
};

const EVENT_TYPE_BADGE_CLASS: Record<Game1ReplayEventType, string> = {
  room_created: "label-default",
  player_joined: "label-info",
  tickets_purchased: "label-info",
  game_started: "label-success",
  draw: "label-primary",
  phase_won: "label-warning",
  mini_game_triggered: "label-warning",
  mini_game_completed: "label-warning",
  payout: "label-success",
  game_paused: "label-default",
  game_resumed: "label-success",
  game_stopped: "label-danger",
  hall_excluded: "label-danger",
  hall_included: "label-success",
  game_ended: "label-default",
};

export function renderGameReplayPage(
  container: HTMLElement,
  gameId: string
): void {
  const state: PageState = { replay: null, filterType: "all" };

  container.innerHTML = `
    ${contentHeader("game_replay_title", "game_replay_title")}
    <section class="content">
      ${boxOpen("game_replay_title", "primary")}
        <p class="text-muted">
          Rekonstruert event-strøm for Spill 1-runde
          <code data-testid="replay-game-id">${escapeHtml(gameId)}</code>.
          Alle PII (e-post, navn, lommebok-IDer) er maskert. Read-only audit-data.
        </p>
        <div id="replay-meta" data-testid="replay-meta">Laster…</div>
        <hr>
        <form id="replay-filter" class="row" style="margin-bottom:12px;" data-testid="replay-filter-form">
          <div class="col-sm-4">
            <label for="replay-filter-type">Event-type</label>
            <select id="replay-filter-type" class="form-control" data-testid="replay-filter-type">
              <option value="all">Alle (${Object.keys(EVENT_TYPE_LABELS).length} typer)</option>
              ${(Object.keys(EVENT_TYPE_LABELS) as Game1ReplayEventType[])
                .map(
                  (t) =>
                    `<option value="${t}">${escapeHtml(EVENT_TYPE_LABELS[t])}</option>`
                )
                .join("")}
            </select>
          </div>
        </form>
        <div id="replay-timeline" data-testid="replay-timeline">Laster…</div>
      ${boxClose()}
    </section>`;

  const metaHost = container.querySelector<HTMLElement>("#replay-meta")!;
  const timelineHost = container.querySelector<HTMLElement>("#replay-timeline")!;
  const filterSelect = container.querySelector<HTMLSelectElement>("#replay-filter-type")!;

  filterSelect.addEventListener("change", () => {
    state.filterType = (filterSelect.value as Game1ReplayEventType | "all") ?? "all";
    renderTimeline();
  });

  function renderMeta(): void {
    if (!state.replay) {
      metaHost.textContent = "Laster…";
      return;
    }
    const m = state.replay.meta;
    metaHost.innerHTML = `
      <div class="row">
        <div class="col-sm-3"><strong>Spill-ID:</strong> <code>${escapeHtml(m.scheduledGameId)}</code></div>
        <div class="col-sm-3"><strong>Status:</strong> ${escapeHtml(m.status)}</div>
        <div class="col-sm-3"><strong>Sub-spill:</strong> ${escapeHtml(m.subGameName)}</div>
        <div class="col-sm-3"><strong>Hendelser:</strong> ${m.eventCount}</div>
      </div>
      <div class="row" style="margin-top:8px;">
        <div class="col-sm-3"><strong>Master-hall:</strong> <code>${escapeHtml(m.masterHallId)}</code></div>
        <div class="col-sm-3"><strong>Hall-gruppe:</strong> <code>${escapeHtml(m.groupHallId)}</code></div>
        <div class="col-sm-3"><strong>Faktisk start:</strong> ${escapeHtml(formatTs(m.actualStartTime))}</div>
        <div class="col-sm-3"><strong>Faktisk slutt:</strong> ${escapeHtml(formatTs(m.actualEndTime))}</div>
      </div>
      <div class="row" style="margin-top:8px;">
        <div class="col-sm-12"><strong>Deltagende haller:</strong>
          ${m.participatingHallIds.map((h) => `<code>${escapeHtml(h)}</code>`).join(", ")}
          ${m.excludedHallIds.length > 0
            ? `<br><strong>Ekskluderte haller:</strong> ${m.excludedHallIds.map((h) => `<code>${escapeHtml(h)}</code>`).join(", ")}`
            : ""}
        </div>
      </div>`;
  }

  function renderTimeline(): void {
    if (!state.replay) {
      timelineHost.textContent = "Laster…";
      return;
    }
    const filtered =
      state.filterType === "all"
        ? state.replay.events
        : state.replay.events.filter((e) => e.type === state.filterType);

    if (filtered.length === 0) {
      timelineHost.innerHTML = `<div class="callout callout-warning">Ingen hendelser matcher filteret.</div>`;
      return;
    }

    timelineHost.innerHTML = `
      <ul class="timeline" data-testid="replay-events" style="list-style:none; padding:0;">
        ${filtered.map((e, idx) => renderEventRow(e, idx)).join("")}
      </ul>`;
  }

  function renderEventRow(event: Game1ReplayEvent, idx: number): string {
    const label = EVENT_TYPE_LABELS[event.type] ?? event.type;
    const badge = EVENT_TYPE_BADGE_CLASS[event.type] ?? "label-default";
    const actorLabel =
      event.actor.kind === "system"
        ? "<em>system</em>"
        : `${escapeHtml(event.actor.role ?? "user")}: <code>${escapeHtml(event.actor.userId ?? "?")}</code>` +
          (event.actor.hallId ? ` @ <code>${escapeHtml(event.actor.hallId)}</code>` : "");
    return `
      <li class="replay-event"
          data-testid="replay-event-row"
          data-event-type="${escapeHtml(event.type)}"
          data-event-index="${idx}"
          style="border-left: 3px solid #ccc; padding: 8px 12px; margin-bottom: 8px;">
        <div>
          <span class="label ${badge}">${escapeHtml(label)}</span>
          <small class="text-muted" style="margin-left:8px;">
            ${escapeHtml(formatTs(event.timestamp))}
          </small>
          <small class="text-muted" style="margin-left:8px;">
            #${event.sequence}
          </small>
        </div>
        <div style="margin-top:4px;">
          <strong>Actor:</strong> ${actorLabel}
        </div>
        <details style="margin-top:4px;">
          <summary>Data</summary>
          <pre style="font-size: 11px; max-height: 200px; overflow:auto;">${escapeHtml(
            JSON.stringify(event.data, null, 2)
          )}</pre>
        </details>
      </li>`;
  }

  function formatTs(ts: string | null): string {
    if (!ts) return "—";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toISOString().slice(0, 19).replace("T", " ");
  }

  async function loadReplay(): Promise<void> {
    metaHost.textContent = "Laster…";
    timelineHost.textContent = "Laster…";
    try {
      const replay = await fetchGameReplay(gameId);
      state.replay = replay;
      renderMeta();
      renderTimeline();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Kunne ikke laste replay.";
      Toast.error(msg);
      metaHost.innerHTML = `<div class="callout callout-danger">${escapeHtml(msg)}</div>`;
      timelineHost.innerHTML = "";
    }
  }

  void loadReplay();
}

export function isGameReplayRoute(path: string): boolean {
  return /^\/admin\/replay\/[^/]+$/.test(path);
}

export function extractGameIdFromReplayPath(path: string): string | null {
  const m = path.match(/^\/admin\/replay\/([^/]+)$/);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function mountGameReplayRoute(container: HTMLElement, path: string): void {
  container.innerHTML = "";
  const gameId = extractGameIdFromReplayPath(path);
  if (!gameId) {
    container.innerHTML = `<div class="box box-danger"><div class="box-body">Ugyldig replay-rute: ${escapeHtml(path)}</div></div>`;
    return;
  }
  renderGameReplayPage(container, gameId);
}
