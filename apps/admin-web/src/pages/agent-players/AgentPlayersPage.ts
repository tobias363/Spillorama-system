// Agent player-list — viser spillere i agentens nåværende hall + CSV-export-
// knapp per rad. Søkefelt med 500ms debounce. Treffer /api/agent/players +
// /api/agent/players/:id/export.csv.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import {
  downloadAgentPlayerExport,
  listAgentPlayers,
  type AgentPlayer,
  type AgentPlayerList,
} from "../../api/agent-dashboard.js";
import {
  isNoShiftError,
  renderNoShiftBanner,
} from "../agent-portal/noShiftFallback.js";

const SEARCH_DEBOUNCE_MS = 500;

export function mountAgentPlayers(container: HTMLElement): void {
  // Bug #5: pre-flight light call — backend returnerer 400 NO_ACTIVE_SHIFT
  // hvis agenten ikke har åpen shift. Vi catcher feilen ved første
  // listing-kall i loadAndRender og bytter ut hele containeren med
  // no-shift-banneret + "Åpne skift"-knappen.
  void renderInitial(container);
}

function renderInitial(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("agent_players_title")}
    <section class="content">
      <div class="box box-primary">
        <div class="box-header with-border">
          <h3 class="box-title">${escapeHtml(t("agent_players_title"))}</h3>
          <div class="box-tools pull-right" style="width:280px;">
            <input type="text" id="agent-players-search" class="form-control"
                   placeholder="${escapeHtml(t("agent_players_search"))}" autocomplete="off">
          </div>
        </div>
        <div class="box-body" id="agent-players-body">
          <div class="text-center"><i class="fa fa-spinner fa-spin fa-2x" aria-hidden="true"></i><br><br>${escapeHtml(t("loading"))}</div>
        </div>
      </div>
    </section>`;

  const searchInput = container.querySelector<HTMLInputElement>("#agent-players-search");
  const body = container.querySelector<HTMLElement>("#agent-players-body");
  if (!searchInput || !body) return;

  void loadAndRender(container, body, "");

  let typingTimer: number | null = null;
  searchInput.addEventListener("input", () => {
    if (typingTimer !== null) window.clearTimeout(typingTimer);
    typingTimer = window.setTimeout(() => {
      void loadAndRender(container, body, searchInput.value.trim());
    }, SEARCH_DEBOUNCE_MS);
  });

  body.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>("[data-export-id]");
    if (!btn) return;
    const playerId = btn.dataset.exportId;
    if (!playerId) return;
    void exportRow(btn, playerId);
  });
}

async function loadAndRender(
  container: HTMLElement,
  body: HTMLElement,
  query: string,
): Promise<void> {
  try {
    const list = await listAgentPlayers(query ? { query } : undefined);
    renderList(body, list);
  } catch (err) {
    if (isNoShiftError(err)) {
      // Bytt ut hele siden med no-shift-banneret. Etter shift-start
      // re-mounter vi siden via renderInitial.
      renderNoShiftBanner(container, () => renderInitial(container));
      return;
    }
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    body.innerHTML = `<div class="callout callout-danger"><p>${escapeHtml(msg)}</p></div>`;
  }
}

function renderList(body: HTMLElement, list: AgentPlayerList): void {
  if (list.players.length === 0) {
    body.innerHTML = `<p class="muted">${escapeHtml(t("agent_players_no_results"))}</p>`;
    return;
  }
  const rows = list.players.map(renderRow).join("");
  body.innerHTML = `
    <p class="muted"><small>${escapeHtml(t("hall_name"))}: <strong>${escapeHtml(list.hallId)}</strong> — ${list.count} ${escapeHtml(t("players"))}</small></p>
    <table class="table table-striped table-bordered" id="agent-players-table">
      <thead>
        <tr>
          <th>${escapeHtml(t("name"))}</th>
          <th>${escapeHtml(t("email"))}</th>
          <th>${escapeHtml(t("phone") || "Phone")}</th>
          <th>${escapeHtml(t("agent_players_kyc_status"))}</th>
          <th>${escapeHtml(t("agent_players_created_at"))}</th>
          <th style="width:160px;"></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderRow(p: AgentPlayer): string {
  const name = [p.displayName, p.surname].filter(Boolean).join(" ").trim() || p.displayName;
  return `
    <tr>
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(p.email)}</td>
      <td>${escapeHtml(p.phone ?? "")}</td>
      <td><span class="label label-${p.kycStatus === "VERIFIED" ? "success" : "warning"}">${escapeHtml(p.kycStatus)}</span></td>
      <td><small>${escapeHtml(formatDate(p.createdAt))}</small></td>
      <td>
        <button class="btn btn-sm btn-primary" data-export-id="${escapeHtml(p.id)}">
          <i class="fa fa-download" aria-hidden="true"></i> ${escapeHtml(t("agent_players_export_csv"))}
        </button>
      </td>
    </tr>`;
}

async function exportRow(btn: HTMLElement, playerId: string): Promise<void> {
  const buttonEl = btn as HTMLButtonElement;
  const original = buttonEl.innerHTML;
  buttonEl.disabled = true;
  buttonEl.innerHTML = `<i class="fa fa-spinner fa-spin" aria-hidden="true"></i>`;
  try {
    await downloadAgentPlayerExport(playerId);
    Toast.success(t("agent_players_export_success"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : t("agent_players_export_failed");
    Toast.error(msg);
  } finally {
    buttonEl.disabled = false;
    buttonEl.innerHTML = original;
  }
}

function contentHeader(titleKey: string): string {
  const title = escapeHtml(t(titleKey));
  return `
    <section class="content-header">
      <h1>${title}</h1>
      <ol class="breadcrumb">
        <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
        <li class="active">${title}</li>
      </ol>
    </section>`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}
