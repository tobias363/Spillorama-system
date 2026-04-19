import { t } from "../i18n/I18n.js";
import type { RouteDef } from "../router/routes.js";

export function renderPlaceholder(container: HTMLElement, route: RouteDef): void {
  const title = t(route.titleKey);
  container.innerHTML = `
    <div class="box box-default">
      <div class="box-header with-border">
        <h3 class="box-title">${escapeHtml(title)}</h3>
        <div class="box-tools pull-right">
          <span class="label label-warning">${escapeHtml(t("placeholder_coming_soon"))}</span>
        </div>
      </div>
      <div class="box-body">
        <p>${escapeHtml(t("placeholder_body"))}</p>
        <p class="muted"><small>Route: <code>${escapeHtml(route.path)}</code></small></p>
      </div>
    </div>`;
}

export function renderUnknown(container: HTMLElement, path: string): void {
  container.innerHTML = `
    <div class="box box-danger">
      <div class="box-header with-border"><h3 class="box-title">404</h3></div>
      <div class="box-body">
        <p>Ukjent rute: <code>${escapeHtml(path)}</code></p>
        <a href="#/admin" class="btn btn-primary btn-sm">← ${escapeHtml(t("dashboard"))}</a>
      </div>
    </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
