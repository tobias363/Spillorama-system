// GAME1_SCHEDULE PR 3: master-konsoll for Game 1.
// GAME1_SCHEDULE PR 4d.3b: socket-live-oppdatering + polling-fallback.
//
// Backend: apps/backend/src/routes/adminGame1Master.ts + /admin-game1
// socket-namespace.
// API-adapter: apps/admin-web/src/api/admin-game1-master.ts.
//
// Viser ett spills ready-status per hall + master-actions (START / PAUSE /
// RESUME / STOP / EXCLUDE). Primær flyt er socket-subscription mot
// `/admin-game1`-namespacet — status-update/draw-progressed trigger
// umiddelbar refresh. REST-polling (5s) er fallback som starter hvis
// socket er frakoblet > 10s, og stopper automatisk ved reconnect.
//
// PR 4e.2 (2026-04-22):
//   - Stop-dialog viser refund-omfang (# digitale + # fysiske bonger per
//     hall, summert) før bekreftelse. NOK-total krever backend-endpoint
//     (post-pilot per design-dok §3.2.5).
//   - Master-hall-exclude: tooltip som forklarer hvorfor knapp er disabled.
//   - Audit-tabell: erstatt JSON.stringify-dump med nøkkel:verdi-pretty-print.

import { t } from "../../../i18n/I18n.js";
import { escapeHtml } from "../common/escape.js";
import { ApiError } from "../../../api/client.js";
import { Toast } from "../../../components/Toast.js";
import { Modal, type ModalInstance } from "../../../components/Modal.js";
import {
  fetchGame1Detail,
  fetchGame1HallStatus,
  startGame1,
  excludeGame1Hall,
  includeGame1Hall,
  pauseGame1,
  resumeGame1,
  stopGame1,
  type Game1GameDetail,
  type Game1HallDetail,
  type Game1JackpotState,
  type Game1HallStatus,
} from "../../../api/admin-game1-master.js";
import { AdminGame1Socket } from "./adminGame1Socket.js";

const POLL_INTERVAL_MS = 5000;

let activePoll: ReturnType<typeof setInterval> | null = null;
let activeSocket: AdminGame1Socket | null = null;
// PR 4e.2: siste vellykkede detail-fetch — brukes i stop-dialog for å vise
// refund-omfang uten å kreve ekstra API-kall.
let lastDetail: Game1GameDetail | null = null;
// TASK HS: siste fetched hall-status (farger + scan-data) cachet per hallId.
let lastHallStatus = new Map<string, Game1HallStatus>();
// TASK HS: eksplisitt bekreftelse fra master om at røde haller ekskluderes.
// Nullstilles når refresh-ing oppdager at hallene ikke er røde lenger.
let confirmedRedHallIds = new Set<string>();

export async function renderGame1MasterConsole(
  container: HTMLElement,
  gameId: string
): Promise<void> {
  stopPolling();
  disposeSocket();
  container.innerHTML = renderShell(gameId);
  await refresh(container, gameId);

  // PR 4d.3b: abonnér på socket-events. Polling er fallback — den starter
  // kun hvis socket er frakoblet > 10s.
  activeSocket = new AdminGame1Socket({
    onStatusUpdate: () => {
      void refresh(container, gameId);
    },
    onDrawProgressed: () => {
      void refresh(container, gameId);
    },
    // Task 1.1: auto-pause etter phase-won → UI må vise Resume-knapp
    // umiddelbart. refresh() henter fresh engineState + viser banner.
    onAutoPaused: () => {
      void refresh(container, gameId);
    },
    // Task 1.1: manuell resume → UI må skjule Resume-knapp og banner
    // umiddelbart. refresh() henter oppdatert engineState.
    onResumed: () => {
      void refresh(container, gameId);
    },
    // TASK HS: ved per-hall farge-oppdatering — merge direkte i cache uten
    // full re-fetch, og re-render halls-seksjonen pluss action-knappene.
    onHallStatusUpdate: (payload) => {
      const cached = lastHallStatus.get(payload.hallId);
      lastHallStatus.set(payload.hallId, {
        hallId: payload.hallId,
        hallName: payload.hallName ?? cached?.hallName ?? payload.hallId,
        color: payload.color,
        playerCount: payload.playerCount,
        startScanDone: payload.startScanDone,
        finalScanDone: payload.finalScanDone,
        readyConfirmed: payload.readyConfirmed,
        soldCount: payload.soldCount,
        startTicketId: payload.startTicketId,
        finalScanTicketId: payload.finalScanTicketId,
        digitalTicketsSold: cached?.digitalTicketsSold ?? 0,
        physicalTicketsSold: cached?.physicalTicketsSold ?? 0,
        excludedFromGame: payload.excludedFromGame,
        excludedReason: cached?.excludedReason ?? null,
      });
      if (lastDetail) {
        renderHalls(container, lastDetail);
        renderActions(container, lastDetail);
      }
    },
    onFallbackActive: (active) => {
      if (active) {
        startPolling(container, gameId);
      } else {
        stopPolling();
      }
    },
  });
  activeSocket.subscribe(gameId);

  const observer = new MutationObserver(() => {
    if (!document.body.contains(container)) {
      stopPolling();
      disposeSocket();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function startPolling(container: HTMLElement, gameId: string): void {
  if (activePoll) return;
  activePoll = setInterval(() => {
    void refresh(container, gameId);
  }, POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (activePoll) {
    clearInterval(activePoll);
    activePoll = null;
  }
}

function disposeSocket(): void {
  if (activeSocket) {
    activeSocket.dispose();
    activeSocket = null;
  }
  lastDetail = null;
}

function renderShell(gameId: string): string {
  return `
    <div class="page-wrapper">
      <div class="container-fluid" id="g1-master-root" data-game-id="${escapeHtml(gameId)}">
        <section class="content-header">
          <h1>${escapeHtml(t("game1_master_console_title"))}</h1>
          <p class="text-muted" id="g1-master-subtitle">
            ${escapeHtml(t("game1_master_loading"))}
          </p>
        </section>
        <section class="content">
          <!-- Task 1.1: auto-pause-banner (skjult når ikke paused). -->
          <div id="g1-master-auto-pause-banner" style="display:none;"></div>
          <div id="g1-master-game-info"
               class="panel panel-default"
               style="padding:16px;"></div>
          <div id="g1-master-halls"
               class="panel panel-default"
               style="padding:16px;margin-top:16px;"></div>
          <div id="g1-master-actions"
               class="panel panel-default"
               style="padding:16px;margin-top:16px;"></div>
          <div id="g1-master-audit"
               class="panel panel-default"
               style="padding:16px;margin-top:16px;"></div>
        </section>
      </div>
    </div>
  `;
}

/**
 * Task 1.1: auto-pause-banner rendret øverst i console. Vises når engine
 * er auto-paused (engineState.isPaused=true OG pausedAtPhase != null) ELLER
 * manuelt paused (game.status='paused'). Skjules i alle andre tilstander.
 */
function renderAutoPauseBanner(
  container: HTMLElement,
  detail: Game1GameDetail
): void {
  const host = container.querySelector<HTMLElement>(
    "#g1-master-auto-pause-banner"
  );
  if (!host) return;

  const engine = detail.engineState ?? null;
  const autoPaused =
    engine !== null && engine.isPaused && engine.pausedAtPhase !== null;
  const manualPaused = detail.game.status === "paused";

  if (!autoPaused && !manualPaused) {
    host.style.display = "none";
    host.innerHTML = "";
    return;
  }

  host.style.display = "block";
  host.style.marginBottom = "16px";
  const phase = autoPaused ? engine!.pausedAtPhase : engine?.currentPhase ?? 1;
  const messageKey = autoPaused
    ? "game1_master_auto_pause_banner"
    : "game1_master_manual_pause_banner";
  const fallback = autoPaused
    ? `Spillet er pause etter fase ${phase} — trykk Resume for å fortsette`
    : "Spillet er pause — trykk Resume for å fortsette";
  const rawMsg = t(messageKey);
  const msg = rawMsg === messageKey ? fallback : rawMsg.replace("{phase}", String(phase));

  host.innerHTML = `
    <div class="alert alert-warning" style="margin-bottom:0;" role="status" aria-live="polite">
      <strong style="display:inline-block;margin-right:8px;">
        <i class="fa fa-pause-circle" aria-hidden="true"></i>
      </strong>
      <span data-testid="g1-master-pause-banner-text">${escapeHtml(msg)}</span>
    </div>
  `;
}

async function refresh(container: HTMLElement, gameId: string): Promise<void> {
  try {
    const [detail, hallStatusResp] = await Promise.all([
      fetchGame1Detail(gameId),
      // TASK HS: parallel fetch av farge-kode + scan-data. Soft-fail:
      // hvis endepunktet feiler, faller vi tilbake til å kun vise legacy
      // ready-status uten farge.
      fetchGame1HallStatus(gameId).catch(() => null),
    ]);
    lastDetail = detail;
    renderAutoPauseBanner(container, detail);
    if (hallStatusResp) {
      lastHallStatus = new Map(
        hallStatusResp.halls.map((h) => [h.hallId, h])
      );
      // Opprydd confirmed-liste: hvis en tidligere bekreftet rød hall ikke
      // lenger er rød (noen kjøpte bong), fjern fra confirmed.
      for (const hallId of Array.from(confirmedRedHallIds)) {
        const s = lastHallStatus.get(hallId);
        if (!s || s.color !== "red" || s.excludedFromGame) {
          confirmedRedHallIds.delete(hallId);
        }
      }
    }
    renderGameInfo(container, detail);
    renderHalls(container, detail);
    renderActions(container, detail);
    renderAudit(container, detail);
    const subtitle = container.querySelector<HTMLElement>("#g1-master-subtitle");
    if (subtitle) {
      subtitle.textContent = `${t("game1_master_status")}: ${detail.game.status}`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const host = container.querySelector<HTMLElement>("#g1-master-game-info");
    if (host) {
      host.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
    }
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      stopPolling();
    }
  }
}

function renderGameInfo(container: HTMLElement, detail: Game1GameDetail): void {
  const host = container.querySelector<HTMLElement>("#g1-master-game-info");
  if (!host) return;
  const game = detail.game;
  // MASTER_PLAN §2.3: vis jackpot-banner i header når state finnes.
  const jackpotBanner = renderJackpotBanner(detail.jackpot);
  host.innerHTML = `
    ${jackpotBanner}
    <h3 style="margin-top:0;">${escapeHtml(game.customGameName ?? game.subGameName)}</h3>
    <table class="table table-condensed" style="margin-bottom:0;">
      <tbody>
        <tr><td style="width:200px;">${escapeHtml(t("game1_master_game_id"))}</td>
            <td><code>${escapeHtml(game.id)}</code></td></tr>
        <tr><td>${escapeHtml(t("game1_master_scheduled_start"))}</td>
            <td>${escapeHtml(formatIso(game.scheduledStartTime))}</td></tr>
        <tr><td>${escapeHtml(t("game1_master_actual_start"))}</td>
            <td>${escapeHtml(formatIso(game.actualStartTime))}</td></tr>
        <tr><td>${escapeHtml(t("game1_master_status"))}</td>
            <td>${statusBadge(game.status)}</td></tr>
        <tr><td>${escapeHtml(t("game1_master_master_hall"))}</td>
            <td><code>${escapeHtml(game.masterHallId)}</code></td></tr>
        <tr><td>${escapeHtml(t("game1_master_group_hall"))}</td>
            <td><code>${escapeHtml(game.groupHallId)}</code></td></tr>
        <tr><td>${escapeHtml(t("game1_master_all_ready"))}</td>
            <td>${detail.allReady
              ? '<span class="label label-success">JA</span>'
              : '<span class="label label-warning">NEI</span>'}</td></tr>
      </tbody>
    </table>
  `;
}

/**
 * MASTER_PLAN §2.3 — header-banner som viser current jackpot-amount.
 * Returnerer tom streng når jackpot-state mangler (backend ikke wired).
 */
function renderJackpotBanner(jackpot: Game1JackpotState | null): string {
  if (!jackpot) return "";
  const kr = formatCentsAsNok(jackpot.currentAmountCents);
  const capKr = formatCentsAsNok(jackpot.maxCapCents);
  const atCap = jackpot.currentAmountCents >= jackpot.maxCapCents;
  const labelClass = atCap ? "label-warning" : "label-success";
  const capHint = atCap
    ? ` <span class="${labelClass}" style="margin-left:6px;">MAX</span>`
    : "";
  return `
    <div id="g1-master-jackpot-banner"
         data-test="jackpot-banner"
         style="background:#fff3cd;border:1px solid #f0ad4e;padding:8px 12px;margin-bottom:12px;border-radius:4px;">
      <strong style="font-size:14px;">
        ${escapeHtml(t("game1_master_jackpot_label"))}:
        <span data-test="jackpot-amount" style="font-size:16px;color:#8a6d3b;">${escapeHtml(kr)}</span>${capHint}
      </strong>
      <small class="text-muted" style="margin-left:12px;">
        ${escapeHtml(t("game1_master_jackpot_cap_hint"))}: ${escapeHtml(capKr)}
      </small>
    </div>
  `;
}

/** Format øre → "24 560 kr" med norsk tusen-separator. */
function formatCentsAsNok(cents: number): string {
  const nok = Math.round(cents / 100);
  return `${nok.toLocaleString("nb-NO")} kr`;
}

function renderHalls(container: HTMLElement, detail: Game1GameDetail): void {
  const host = container.querySelector<HTMLElement>("#g1-master-halls");
  if (!host) return;
  const rowsHtml = detail.halls
    .map((h) => {
      const hallStatus = lastHallStatus.get(h.hallId);
      const badge = hallStatus
        ? trafficLightBadge(hallStatus)
        : hallStatusBadge(h);
      const descriptionHtml = hallStatus
        ? hallStatusDescription(hallStatus)
        : "";
      const excludeBtn =
        h.excludedFromGame
          ? `<button class="btn btn-xs btn-default"
                     data-action="include-hall"
                     data-hall-id="${escapeHtml(h.hallId)}">
               ${escapeHtml(t("game1_master_include_hall"))}
             </button>`
          : h.hallId === detail.game.masterHallId
            ? `<span class="text-muted small"
                     title="${escapeHtml(t("game1_master_hall_exclude_disabled_tooltip"))}">
                 master
               </span>`
            : `<button class="btn btn-xs btn-warning"
                       data-action="exclude-hall"
                       data-hall-id="${escapeHtml(h.hallId)}"
                       title="${escapeHtml(t("game1_master_exclude_hall_tooltip"))}">
                 ${escapeHtml(t("game1_master_exclude_hall"))}
               </button>`;
      const soldCell =
        hallStatus && hallStatus.soldCount > 0
          ? `<small>(${hallStatus.soldCount})</small>`
          : "";
      return `
        <tr data-hall-id="${escapeHtml(h.hallId)}">
          <td><code>${escapeHtml(h.hallId)}</code><br>
              <small>${escapeHtml(h.hallName)}</small></td>
          <td>${badge}${descriptionHtml}</td>
          <td class="text-right">${h.digitalTicketsSold}</td>
          <td class="text-right">${h.physicalTicketsSold} ${soldCell}</td>
          <td>${excludeBtn}</td>
        </tr>
      `;
    })
    .join("");
  host.innerHTML = `
    <h3 style="margin-top:0;">${escapeHtml(t("game1_master_halls_title"))}</h3>
    <table class="table table-condensed">
      <thead>
        <tr>
          <th>${escapeHtml(t("hall"))}</th>
          <th>${escapeHtml(t("game1_master_ready_status"))}</th>
          <th class="text-right">${escapeHtml(t("game1_master_digital_tickets"))}</th>
          <th class="text-right">${escapeHtml(t("game1_master_physical_tickets"))}</th>
          <th style="width:150px;">${escapeHtml(t("actions"))}</th>
        </tr>
      </thead>
      <tbody>${rowsHtml || `<tr><td colspan="5" class="text-center text-muted">${escapeHtml(t("game1_master_no_halls"))}</td></tr>`}</tbody>
    </table>
  `;
  host.querySelectorAll<HTMLButtonElement>('[data-action="exclude-hall"]').forEach((btn) => {
    btn.addEventListener("click", () =>
      onExcludeHall(container, detail.game.id, btn.dataset.hallId ?? "")
    );
  });
  host.querySelectorAll<HTMLButtonElement>('[data-action="include-hall"]').forEach((btn) => {
    btn.addEventListener("click", () =>
      onIncludeHall(container, detail.game.id, btn.dataset.hallId ?? "")
    );
  });
}

/**
 * TASK HS: farge-kodet hall-badge med sirkel-ikon (🔴/🟠/🟢) + kompakt label.
 * Brukes i halls-tabellen for rask visuell statusoversikt.
 */
function trafficLightBadge(status: Game1HallStatus): string {
  if (status.excludedFromGame) {
    return `<span class="label label-default" data-marker="hall-color-excluded">⚫ ekskludert</span>`;
  }
  switch (status.color) {
    case "red":
      return `<span class="label label-danger" data-marker="hall-color-red">🔴 ${escapeHtml(
        t("game1_master_hall_red")
      )}</span>`;
    case "orange":
      return `<span class="label label-warning" data-marker="hall-color-orange">🟠 ${escapeHtml(
        t("game1_master_hall_orange")
      )}</span>`;
    case "green":
      return `<span class="label label-success" data-marker="hall-color-green">🟢 ${escapeHtml(
        t("game1_master_hall_green")
      )}</span>`;
  }
}

/**
 * TASK HS: kort, menneskelig beskrivelse under badge-en —
 * "0 spillere · Ekskludert", "5 spillere · Mangler slutt-scan", etc.
 */
function hallStatusDescription(status: Game1HallStatus): string {
  const parts: string[] = [`${status.playerCount} ${t("game1_master_players")}`];
  if (status.color === "red") {
    parts.push(t("game1_master_hall_red_desc"));
  } else if (status.color === "orange") {
    if (!status.finalScanDone) {
      parts.push(t("game1_master_hall_orange_no_final_scan"));
    } else if (!status.readyConfirmed) {
      parts.push(t("game1_master_hall_orange_no_ready"));
    } else {
      parts.push(t("game1_master_hall_orange_generic"));
    }
  } else if (status.color === "green") {
    parts.push(
      `${status.soldCount} ${t("game1_master_hall_sold_suffix")}`
    );
  }
  return `<br><small class="text-muted">${escapeHtml(parts.join(" · "))}</small>`;
}

function renderActions(container: HTMLElement, detail: Game1GameDetail): void {
  const host = container.querySelector<HTMLElement>("#g1-master-actions");
  if (!host) return;
  const status = detail.game.status;
  const engine = detail.engineState ?? null;
  // Task 1.1: auto-pause er en sidestate. isAutoPaused=true betyr
  // status='running' + engine.paused=true (paused_at_phase satt).
  const isAutoPaused =
    engine !== null && engine.isPaused && engine.pausedAtPhase !== null;

  // TASK HS: bruk farge-cache (hvis tilgjengelig) for start-knapp-logikk.
  // Oransje haller blokkerer start. Røde haller må bekreftes eksplisitt
  // via checkbox (confirmedRedHallIds).
  const hallStatusList = Array.from(lastHallStatus.values()).filter(
    (h) => !h.excludedFromGame
  );
  const orangeHalls = hallStatusList.filter((h) => h.color === "orange");
  const redHalls = hallStatusList.filter(
    (h) => h.color === "red" && h.hallId !== detail.game.masterHallId
  );
  const allRedConfirmed = redHalls.every((h) =>
    confirmedRedHallIds.has(h.hallId)
  );

  const hasHallStatusData = lastHallStatus.size > 0;
  // Når vi har farge-data: bruk TASK HS-regelen. Ellers fall tilbake til
  // legacy-allReady-flagget slik at konsollen fortsatt fungerer uten
  // hall-status-endepunktet tilgjengelig.
  const canStart = hasHallStatusData
    ? (status === "ready_to_start" || status === "purchase_open") &&
      orangeHalls.length === 0 &&
      allRedConfirmed
    : status === "ready_to_start" ||
      (status === "purchase_open" && detail.allReady);

  // Task 1.1: pause-knapp er kun aktuell når engine faktisk trekker kuler.
  // Når auto-paused er draw-engine allerede stoppet, så det er meningsløst å
  // pause på nytt.
  const canPause = status === "running" && !isAutoPaused;
  // Task 1.1: resume-knapp aktiveres for begge paused-varianter.
  const canResume = status === "paused" || isAutoPaused;
  const canStop = ["purchase_open", "ready_to_start", "running", "paused"].includes(
    status
  );

  const orangeWarning =
    orangeHalls.length > 0
      ? `<div class="alert alert-warning" data-marker="start-orange-warning" style="margin-top:12px;">
           <strong>${escapeHtml(
             t("game1_master_start_blocked_orange_title")
           )}</strong>
           <br><small>${escapeHtml(
             t("game1_master_start_blocked_orange_body")
           )}: ${escapeHtml(
               orangeHalls.map((h) => h.hallName || h.hallId).join(", ")
             )}</small>
         </div>`
      : "";

  const redCheckboxHtml =
    redHalls.length > 0
      ? `<div class="panel panel-warning" data-marker="red-halls-confirm" style="margin-top:12px;padding:12px;">
           <strong>${escapeHtml(
             t("game1_master_red_halls_title")
           )}</strong>
           <br><small>${escapeHtml(
             t("game1_master_red_halls_body")
           )}</small>
           <div style="margin-top:8px;">
             ${redHalls
               .map(
                 (h) => `
               <label style="display:block;">
                 <input type="checkbox" data-action="confirm-red-hall"
                        data-hall-id="${escapeHtml(h.hallId)}"
                        ${confirmedRedHallIds.has(h.hallId) ? "checked" : ""}>
                 ${escapeHtml(t("game1_master_exclude_hall_from_game"))}:
                 <strong>${escapeHtml(h.hallName || h.hallId)}</strong>
                 <small class="text-muted">(0 ${escapeHtml(t("game1_master_players"))})</small>
               </label>`
               )
               .join("")}
           </div>
         </div>`
      : "";

  const startTooltip =
    orangeHalls.length > 0
      ? `title="${escapeHtml(
          `${orangeHalls.length} ${t("game1_master_halls_not_ready_tooltip")}`
        )}"`
      : "";

  host.innerHTML = `
    <h3 style="margin-top:0;">${escapeHtml(t("game1_master_actions"))}</h3>
    <div class="btn-group" role="group">
      <button class="btn btn-success" data-action="start" ${startTooltip} ${canStart ? "" : "disabled"}>
        ${escapeHtml(t("game1_master_start"))}
      </button>
      <button class="btn btn-warning" data-action="pause" ${canPause ? "" : "disabled"}>
        ${escapeHtml(t("game1_master_pause"))}
      </button>
      <button class="btn btn-info" data-action="resume" ${canResume ? "" : "disabled"}>
        ${escapeHtml(t("game1_master_resume"))}
      </button>
      <button class="btn btn-danger" data-action="stop" ${canStop ? "" : "disabled"}>
        ${escapeHtml(t("game1_master_stop"))}
      </button>
    </div>
    ${orangeWarning}
    ${redCheckboxHtml}
    <p class="text-muted small" style="margin-top:12px;">
      ${escapeHtml(t("game1_master_poll_hint"))}
    </p>
  `;
  host.querySelector<HTMLButtonElement>('[data-action="start"]')?.addEventListener(
    "click",
    () => onStart(container, detail)
  );
  host.querySelector<HTMLButtonElement>('[data-action="pause"]')?.addEventListener(
    "click",
    () => onPause(container, detail.game.id)
  );
  host.querySelector<HTMLButtonElement>('[data-action="resume"]')?.addEventListener(
    "click",
    () => onResume(container, detail.game.id)
  );
  host.querySelector<HTMLButtonElement>('[data-action="stop"]')?.addEventListener(
    "click",
    () => onStop(container, detail.game.id)
  );
  host.querySelectorAll<HTMLInputElement>('[data-action="confirm-red-hall"]').forEach(
    (cb) => {
      cb.addEventListener("change", () => {
        const hallId = cb.dataset.hallId ?? "";
        if (!hallId) return;
        if (cb.checked) {
          confirmedRedHallIds.add(hallId);
        } else {
          confirmedRedHallIds.delete(hallId);
        }
        // Re-render actions for å oppdatere Start-knapp disabled-state.
        renderActions(container, detail);
      });
    }
  );
}

function renderAudit(container: HTMLElement, detail: Game1GameDetail): void {
  const host = container.querySelector<HTMLElement>("#g1-master-audit");
  if (!host) return;
  const rows = detail.auditRecent
    .map((a) => {
      return `
        <tr>
          <td>${escapeHtml(formatIso(a.createdAt))}</td>
          <td><code>${escapeHtml(a.action)}</code></td>
          <td><small>${escapeHtml(a.actorUserId)}</small></td>
          <td><small>${escapeHtml(a.actorHallId)}</small></td>
          <td>${formatAuditMetadata(a.metadata)}</td>
        </tr>
      `;
    })
    .join("");
  host.innerHTML = `
    <h3 style="margin-top:0;">${escapeHtml(t("game1_master_audit_title"))}</h3>
    <table class="table table-condensed">
      <thead>
        <tr>
          <th style="width:180px;">${escapeHtml(t("game1_master_timestamp"))}</th>
          <th>${escapeHtml(t("game1_master_action"))}</th>
          <th>${escapeHtml(t("game1_master_actor_user"))}</th>
          <th>${escapeHtml(t("game1_master_actor_hall"))}</th>
          <th>${escapeHtml(t("game1_master_metadata"))}</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="5" class="text-center text-muted">${escapeHtml(t("game1_master_no_audit"))}</td></tr>`}</tbody>
    </table>
  `;
}

// ── Action handlers ────────────────────────────────────────────────────────

async function onStart(container: HTMLElement, detail: Game1GameDetail): Promise<void> {
  const excludedHallIds = detail.halls
    .filter((h) => h.excludedFromGame)
    .map((h) => h.hallId);
  let confirmExcludedHalls: string[] | undefined;
  if (excludedHallIds.length > 0) {
    const ok = window.confirm(
      `${t("game1_master_confirm_excluded")}:\n${excludedHallIds.join(", ")}`
    );
    if (!ok) return;
    confirmExcludedHalls = excludedHallIds;
  }

  // TASK HS: send confirmedRedHallIds som `confirmExcludeRedHalls`. Backend
  // setter excluded_from_game=true for disse i samme transaksjon som start.
  const confirmExcludeRedHalls =
    confirmedRedHallIds.size > 0
      ? Array.from(confirmedRedHallIds)
      : undefined;

  // Task 1.5 + MASTER_PLAN §2.3 + TASK HS — kombinert override-flyt:
  //   1) Kall /start med confirmExcludedHalls + confirmExcludeRedHalls.
  //   2) HALLS_NOT_READY → popup med unready-liste + [Avbryt]/[Start uansett];
  //      ved [Start uansett] re-kall med `confirmUnreadyHalls`.
  //   3) JACKPOT_CONFIRM_REQUIRED → popup med pot-amount + thresholds;
  //      ved bekreft re-kall med `jackpotConfirmed=true`.
  //   Hver error håndteres én gang per onStart-kjøring; backend validerer
  //   typisk én ting av gangen, så et 2. retry (etter at f.eks.
  //   confirmUnreadyHalls er satt og det fortsatt kreves jackpot-confirm)
  //   plukkes opp i den andre catch-blokka under.
  let confirmedUnreadyHalls: string[] | undefined;
  let jackpotConfirmed = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await startGame1(
        detail.game.id,
        {
          confirmExcludedHalls,
          confirmExcludeRedHalls,
          confirmUnreadyHalls: confirmedUnreadyHalls,
        },
        jackpotConfirmed || undefined
      );
      Toast.success(t("saved"));
      await refresh(container, detail.game.id);
      return;
    } catch (err) {
      if (err instanceof ApiError && err.code === "HALLS_NOT_READY" && !confirmedUnreadyHalls) {
        const unready = extractUnreadyHalls(err);
        if (unready.length === 0) {
          Toast.error(err.message);
          return;
        }
        const proceed = await promptNotReadyDialog(detail, unready);
        if (!proceed) return;
        confirmedUnreadyHalls = unready;
        continue;
      }
      if (err instanceof ApiError && err.code === "JACKPOT_CONFIRM_REQUIRED" && !jackpotConfirmed) {
        const jackpotFromError = extractJackpotFromError(err);
        const jackpot = jackpotFromError ?? detail.jackpot;
        const confirmed = await openJackpotConfirmPopup(jackpot);
        if (!confirmed) return;
        jackpotConfirmed = true;
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      Toast.error(msg);
      return;
    }
  }
}

/**
 * Task 1.5: hent `unreadyHalls`-listen fra `ApiError.details`. Defensiv —
 * hvis backend ikke inkluderer details (legacy-respons), returner tom liste
 * så caller faller tilbake til generisk feil-toast.
 */
function extractUnreadyHalls(err: ApiError): string[] {
  const details = err.details;
  if (!details) return [];
  const value = details.unreadyHalls;
  if (!Array.isArray(value)) return [];
  return value.filter((v: unknown): v is string => typeof v === "string");
}

/**
 * Task 1.5: modal for "Agents not ready yet". Rendrer hall-navn (fra
 * `detail.halls`) for hver orange-hall-ID. Returnerer `true` kun hvis master
 * klikker "Start uansett". Backdrop = static slik at ved-siden-klikk ikke
 * lukker modalen (unngår utilsiktet start).
 */
function promptNotReadyDialog(
  detail: Game1GameDetail,
  unreadyHallIds: string[]
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const body = document.createElement("div");
    body.setAttribute("data-marker", "g1-master-not-ready-dialog");
    const listItems = unreadyHallIds
      .map((hallId) => {
        const hall = detail.halls.find((h) => h.hallId === hallId);
        const label = hall ? hall.hallName || hall.hallId : hallId;
        return `<li>${escapeHtml(label)}</li>`;
      })
      .join("");
    body.innerHTML = `
      <p>${escapeHtml(t("game1_master_not_ready_body"))}</p>
      <ul style="margin-top:12px;" data-testid="g1-master-not-ready-list">
        ${listItems}
      </ul>
      <p class="text-muted small" style="margin-top:12px;">
        ${escapeHtml(t("game1_master_not_ready_note"))}
      </p>`;
    let resolved = false;
    const finish = (value: boolean): void => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };
    Modal.open({
      title: t("game1_master_not_ready_title"),
      content: body,
      backdrop: "static",
      keyboard: true,
      className: "modal-g1-not-ready",
      buttons: [
        {
          label: t("no_cancle"),
          variant: "default",
          action: "cancel",
          onClick: () => finish(false),
        },
        {
          label: t("game1_master_start_anyway"),
          variant: "danger",
          action: "confirm",
          onClick: () => finish(true),
        },
      ],
      onClose: () => finish(false),
    });
  });
}

/**
 * MASTER_PLAN §2.3 — trekk ut jackpot-felt fra ApiError.details hvis
 * backend leverte dem. Faller tilbake til null slik at caller bruker
 * detail.jackpot fra siste fetch.
 */
function extractJackpotFromError(err: ApiError): Game1JackpotState | null {
  const d = err.details;
  if (!d) return null;
  const amount = Number(d.jackpotAmountCents);
  const cap = Number(d.maxCapCents);
  const incr = Number(d.dailyIncrementCents);
  const thresholdsRaw = Array.isArray(d.drawThresholds) ? d.drawThresholds : [];
  const thresholds: number[] = [];
  for (const v of thresholdsRaw) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) thresholds.push(n);
  }
  if (!Number.isFinite(amount)) return null;
  return {
    currentAmountCents: amount,
    maxCapCents: Number.isFinite(cap) ? cap : 3_000_000,
    dailyIncrementCents: Number.isFinite(incr) ? incr : 400_000,
    drawThresholds: thresholds.length > 0 ? thresholds : [50, 55, 56, 57],
    lastAccumulationDate: "",
  };
}

/**
 * MASTER_PLAN §2.3 — jackpot-confirm-popup. Viser current pot-amount +
 * draw-thresholds. Returner true når master bekrefter, false ved avbryt.
 */
async function openJackpotConfirmPopup(
  jackpot: Game1JackpotState | null
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const body = document.createElement("div");
    body.innerHTML = renderJackpotConfirmDialog(jackpot);
    Modal.open({
      title: t("game1_master_jackpot_confirm_title"),
      content: body,
      size: "sm",
      backdrop: "static",
      keyboard: true,
      className: "modal-jackpot-confirm",
      buttons: [
        {
          label: t("no_cancle"),
          variant: "default",
          action: "cancel",
          onClick: () => resolve(false),
        },
        {
          label: t("game1_master_jackpot_confirm_start"),
          variant: "success",
          action: "confirm",
          onClick: () => resolve(true),
        },
      ],
      onClose: () => resolve(false),
    });
  });
}

function renderJackpotConfirmDialog(jackpot: Game1JackpotState | null): string {
  if (!jackpot) {
    return `
      <p>${escapeHtml(t("game1_master_jackpot_confirm_no_state"))}</p>
    `;
  }
  const amountKr = formatCentsAsNok(jackpot.currentAmountCents);
  const capKr = formatCentsAsNok(jackpot.maxCapCents);
  const incrKr = formatCentsAsNok(jackpot.dailyIncrementCents);
  const thresholds = jackpot.drawThresholds.join(", ");
  return `
    <div data-test="jackpot-confirm-body">
      <div style="text-align:center;padding:16px 0;background:#fff3cd;border:1px solid #f0ad4e;border-radius:4px;margin-bottom:16px;">
        <div style="font-size:12px;color:#8a6d3b;">
          ${escapeHtml(t("game1_master_jackpot_label"))}
        </div>
        <div data-test="jackpot-confirm-amount" style="font-size:28px;font-weight:bold;color:#8a6d3b;">
          ${escapeHtml(amountKr)}
        </div>
      </div>
      <table class="table table-condensed" style="margin-bottom:12px;">
        <tbody>
          <tr>
            <td style="width:50%;">${escapeHtml(t("game1_master_jackpot_max_cap"))}</td>
            <td><strong>${escapeHtml(capKr)}</strong></td>
          </tr>
          <tr>
            <td>${escapeHtml(t("game1_master_jackpot_daily_increment"))}</td>
            <td>${escapeHtml(incrKr)}</td>
          </tr>
          <tr>
            <td>${escapeHtml(t("game1_master_jackpot_draw_thresholds"))}</td>
            <td data-test="jackpot-confirm-thresholds"><code>${escapeHtml(thresholds)}</code></td>
          </tr>
        </tbody>
      </table>
      <p class="text-muted" style="font-size:13px;">
        ${escapeHtml(t("game1_master_jackpot_confirm_hint"))}
      </p>
    </div>
  `;
}

async function onPause(container: HTMLElement, gameId: string): Promise<void> {
  const reason = window.prompt(t("game1_master_pause_reason_prompt"), "") ?? "";
  await callAction(container, gameId, async () => {
    await pauseGame1(gameId, reason);
  });
}

async function onResume(container: HTMLElement, gameId: string): Promise<void> {
  await callAction(container, gameId, async () => {
    await resumeGame1(gameId);
  });
}

/**
 * PR 4e.2: stop-dialog som viser forventet refund-omfang før bekreftelse.
 * Bruker siste fetched detail for å vise per-hall ticket-tellinger.
 *
 * Scope-avvik: NOK-total per hall krever aggregat-endpoint på backend
 * (post-pilot per design-dok §3.2.5 punkt 2) fordi pris-info per bong ikke
 * er i detail-responsen. Vi viser derfor bong-antall, ikke kroner.
 */
async function onStop(container: HTMLElement, gameId: string): Promise<void> {
  const detail = lastDetail;
  let instance: ModalInstance | null = null;
  await new Promise<void>((resolve) => {
    const body = document.createElement("div");
    body.innerHTML = renderStopDialog(detail);
    instance = Modal.open({
      title: t("game1_master_stop_dialog_title"),
      content: body,
      size: "lg",
      backdrop: "static",
      keyboard: true,
      className: "modal-stop-game",
      buttons: [
        {
          label: t("no_cancle"),
          variant: "default",
          action: "cancel",
          onClick: () => resolve(),
        },
        {
          label: t("game1_master_stop"),
          variant: "danger",
          action: "confirm",
          dismiss: false,
          onClick: async (modal) => {
            const reasonInput = body.querySelector<HTMLTextAreaElement>("#g1-stop-reason");
            const errorHost = body.querySelector<HTMLElement>("#g1-stop-error");
            const reason = reasonInput?.value.trim() ?? "";
            if (!reason) {
              if (errorHost) {
                errorHost.textContent = t("game1_master_stop_reason_required");
                errorHost.style.display = "block";
              }
              return;
            }
            try {
              await stopGame1(gameId, reason);
              Toast.success(t("saved"));
              modal.close("button");
              resolve();
              await refresh(container, gameId);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              if (errorHost) {
                errorHost.textContent = msg;
                errorHost.style.display = "block";
              }
              Toast.error(msg);
            }
          },
        },
      ],
      onClose: () => resolve(),
    });
  });
  // instance rydder seg selv via Modal-implementasjon; vi trenger ikke disposing.
  void instance;
}

/**
 * PR 4e.2: render HTML for stop-confirm-dialogen med refund-omfang.
 * `detail === null` er soft-case (f.eks. hvis detail ikke var lastet ved
 * trigger): vi viser warning og lar bruker fortsette uansett.
 */
function renderStopDialog(detail: Game1GameDetail | null): string {
  const includedHalls = detail
    ? detail.halls.filter((h) => !h.excludedFromGame)
    : [];
  let totalDigital = 0;
  let totalPhysical = 0;
  for (const h of includedHalls) {
    totalDigital += h.digitalTicketsSold ?? 0;
    totalPhysical += h.physicalTicketsSold ?? 0;
  }
  const hallRows = includedHalls
    .map((h) => {
      return `
        <tr>
          <td><small>${escapeHtml(h.hallName || h.hallId)}</small></td>
          <td class="text-right"><small>${h.digitalTicketsSold}</small></td>
          <td class="text-right"><small>${h.physicalTicketsSold}</small></td>
        </tr>`;
    })
    .join("");
  const summary = detail
    ? `
      <div class="alert alert-warning" style="margin-bottom:12px;">
        <strong>${escapeHtml(t("game1_master_stop_refund_summary"))}</strong><br>
        <small>
          ${escapeHtml(t("game1_master_stop_refund_digital"))}: <strong>${totalDigital}</strong>${" "}
          ${escapeHtml(t("game1_master_stop_refund_physical"))}: <strong>${totalPhysical}</strong>
        </small>
        <br>
        <small class="text-muted">${escapeHtml(t("game1_master_stop_refund_note"))}</small>
      </div>
      <table class="table table-condensed" style="font-size:12px;">
        <thead>
          <tr>
            <th>${escapeHtml(t("hall"))}</th>
            <th class="text-right">${escapeHtml(t("game1_master_digital_tickets"))}</th>
            <th class="text-right">${escapeHtml(t("game1_master_physical_tickets"))}</th>
          </tr>
        </thead>
        <tbody>
          ${hallRows || `<tr><td colspan="3" class="text-center text-muted"><small>—</small></td></tr>`}
        </tbody>
      </table>`
    : `<div class="alert alert-warning">
         <small>${escapeHtml(t("game1_master_stop_refund_unavailable"))}</small>
       </div>`;
  return `
    <div>
      ${summary}
      <p>${escapeHtml(t("game1_master_stop_confirm"))}</p>
      <div class="form-group">
        <label for="g1-stop-reason">${escapeHtml(t("game1_master_stop_reason_label"))} *</label>
        <textarea id="g1-stop-reason" class="form-control" rows="2"
                  placeholder="${escapeHtml(t("game1_master_stop_reason_prompt"))}"></textarea>
      </div>
      <p id="g1-stop-error" class="help-block"
         style="color:#a94442;display:none;margin-top:4px;"></p>
    </div>`;
}

async function onExcludeHall(
  container: HTMLElement,
  gameId: string,
  hallId: string
): Promise<void> {
  if (!hallId) return;
  const reason = window.prompt(
    `${t("game1_master_exclude_reason_prompt")} (${hallId})`,
    ""
  ) ?? "";
  if (!reason.trim()) {
    Toast.warning(t("game1_master_exclude_reason_required"));
    return;
  }
  await callAction(container, gameId, async () => {
    await excludeGame1Hall(gameId, hallId, reason);
  });
}

async function onIncludeHall(
  container: HTMLElement,
  gameId: string,
  hallId: string
): Promise<void> {
  if (!hallId) return;
  await callAction(container, gameId, async () => {
    await includeGame1Hall(gameId, hallId);
  });
}

async function callAction(
  container: HTMLElement,
  gameId: string,
  fn: () => Promise<void>
): Promise<void> {
  try {
    await fn();
    Toast.success(t("saved"));
    await refresh(container, gameId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Toast.error(msg);
  }
}

/**
 * PR 4e.2: pretty-print audit-metadata som nøkkel:verdi-par istedenfor
 * rå JSON.stringify. Scalar-verdier rendes inline (f.eks.
 * `excludedHallId: hall-2, reason: hall-closed`). Objekt/array-verdier
 * faller tilbake til kompakt JSON for å bevare info.
 */
function formatAuditMetadata(metadata: Record<string, unknown>): string {
  if (!metadata || typeof metadata !== "object") return "";
  const entries = Object.entries(metadata);
  if (entries.length === 0) return '<small class="text-muted">—</small>';
  const parts = entries.map(([key, value]) => {
    const keyHtml = `<span style="color:#666;">${escapeHtml(key)}:</span>`;
    let valueHtml: string;
    if (value === null || value === undefined) {
      valueHtml = '<span class="text-muted">null</span>';
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      valueHtml = escapeHtml(String(value));
    } else {
      // Fallback for objekter/arrays — kompakt JSON.
      try {
        valueHtml = `<code>${escapeHtml(JSON.stringify(value))}</code>`;
      } catch {
        valueHtml = '<span class="text-muted">[unserializable]</span>';
      }
    }
    return `${keyHtml} ${valueHtml}`;
  });
  return `<small>${parts.join("<br>")}</small>`;
}

function formatIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("no");
  } catch {
    return iso;
  }
}

function statusBadge(status: string): string {
  const cls = (() => {
    switch (status) {
      case "running":
        return "label-success";
      case "ready_to_start":
        return "label-info";
      case "paused":
        return "label-warning";
      case "cancelled":
      case "completed":
        return "label-default";
      default:
        return "label-primary";
    }
  })();
  return `<span class="label ${cls}">${escapeHtml(status)}</span>`;
}

function hallStatusBadge(h: Game1HallDetail): string {
  if (h.excludedFromGame) {
    return `<span class="label label-danger">ekskludert${
      h.excludedReason ? `: ${escapeHtml(h.excludedReason)}` : ""
    }</span>`;
  }
  if (h.isReady) {
    return '<span class="label label-success">klar</span>';
  }
  return '<span class="label label-warning">venter</span>';
}
