// /gameType/test — internal diagnostic page from
//
// Legacy purpose: image-preview modal used during initial dev for testing
// gameType.photo-rendering. Not production — not linked from any sidebar or
// breadcrumb in legacy. Portered as a minimal diagnostic stub in case an
// internal QA link still points here; otherwise it is effectively dead-code
// and could be removed post-pilot (see PR-A3-PLAN §1.5 estimate).

import { t } from "../../../i18n/I18n.js";
import { fetchGameTypeList } from "./GameTypeState.js";
import { escapeHtml } from "../common/escape.js";

export async function renderGameTypeTestPage(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>GameType Test</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li><a href="#/gameType">${escapeHtml(t("games"))}</a></li>
          <li class="active">Test</li>
        </ol>
      </section>
      <section class="content">
        <div class="box box-info">
          <div class="box-header with-border"><h3 class="box-title">Photo preview diagnostic</h3></div>
          <div class="box-body">
            <p>Internal developer diagnostic for GameType photo rendering.
               This page was not linked from the legacy sidebar and is a candidate
               for removal post-pilot.</p>
            <div id="gameType-test-thumbs" style="display:flex;gap:12px;flex-wrap:wrap;">
              <div class="text-muted"><i class="fa fa-spinner fa-spin" aria-hidden="true"></i> Loading…</div>
            </div>
          </div>
        </div>
      </section>
    </div></div>`;

  const host = container.querySelector<HTMLElement>("#gameType-test-thumbs");
  if (!host) return;

  try {
    const rows = await fetchGameTypeList();
    if (rows.length === 0) {
      host.innerHTML = `<div class="text-muted">${escapeHtml(t("no_data_available"))}</div>`;
      return;
    }
    host.innerHTML = rows
      .map(
        (gt) => `
        <div style="text-align:center;">
          <img src="/profile/bingo/${encodeURIComponent(gt.photo)}" alt="${escapeHtml(gt.name)}"
            style="height:120px;width:auto;border:1px solid #ddd;border-radius:4px;padding:4px;"/>
          <div style="margin-top:4px;font-size:12px;">${escapeHtml(gt.name)}</div>
        </div>`
      )
      .join("");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    host.innerHTML = `<div class="alert alert-danger">${escapeHtml(msg)}</div>`;
  }
}
