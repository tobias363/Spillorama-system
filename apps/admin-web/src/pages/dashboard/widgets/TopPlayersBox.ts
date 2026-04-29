// Top 5 players — legacy dashboard.html:537-595 (box-danger + ul.users-list).

import { t } from "../../../i18n/I18n.js";
import type { TopPlayerRow } from "../../../api/dashboard.js";
import type { Role } from "../../../auth/Session.js";
import { escapeHtml } from "../../../utils/escapeHtml.js";

export interface TopPlayersOptions {
  /** `null` = endpoint not yet available (BIN-A2-API-2). Show placeholder. */
  players: TopPlayerRow[] | null;
  role: Role;
}

export function renderTopPlayersBox(opts: TopPlayersOptions): HTMLElement {
  const box = document.createElement("div");
  box.className = "box box-danger";

  const header = document.createElement("div");
  header.className = "box-header with-border";
  header.innerHTML = `<h3 class="box-title">${escapeHtml(t("top_5_players"))}</h3>`;
  box.append(header);

  const body = document.createElement("div");
  body.className = "box-body no-padding";

  if (opts.players === null) {
    body.innerHTML = `
      <div style="text-align:center;padding:24px;">
        <p class="muted" style="color:#888;margin:0;">${escapeHtml(t("pending_backend_endpoint"))}</p>
        <small style="color:#aaa;">BIN-A2-API-2</small>
      </div>`;
  } else if (opts.players.length === 0) {
    body.innerHTML = `<div style="text-align:center;padding:24px;">${escapeHtml(t("no_data_available"))}</div>`;
  } else {
    const ul = document.createElement("ul");
    ul.className = "users-list clearfix";
    ul.id = "topPlayers";
    ul.setAttribute("style", "display: flex; flex-wrap: wrap; justify-content: center; gap: 30px; padding: 16px; list-style: none;");
    for (const p of opts.players) {
      const li = document.createElement("li");
      li.className = "item";
      li.setAttribute("style", "width: 23%; padding: 0; text-align: center;");
      const avatar = p.avatar || "/admin/legacy-skin/img/user.png";
      const isLinked = opts.role === "admin" || opts.role === "super-admin";
      const nameMarkup = isLinked
        ? `<a class="users-list-name" href="#/player/${encodeURIComponent(p.id)}">${escapeHtml(p.username)}</a>`
        : `<span class="users-list-name">${escapeHtml(p.username)}</span>`;
      li.innerHTML = `
        <img src="${escapeHtml(avatar)}" alt="User Image" style="border-radius:50%;max-width:100%;height:79px;">
        ${nameMarkup}
        <span class="users-list-data">${Math.floor(p.walletAmount)} Kr</span>`;
      ul.append(li);
    }
    body.append(ul);
  }
  box.append(body);

  const footer = document.createElement("div");
  footer.className = "box-footer text-center";
  if (opts.role === "admin" || opts.role === "super-admin") {
    footer.innerHTML = `<a href="#/player" class="uppercase">${escapeHtml(t("view_all_users"))}</a>`;
  }
  box.append(footer);
  return box;
}
