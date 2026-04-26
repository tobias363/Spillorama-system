import { t } from "../i18n/I18n.js";
import type { RouteDef } from "../router/routes.js";

export function renderBreadcrumb(container: HTMLElement, route: RouteDef | undefined, path: string): void {
  container.innerHTML = "";
  const section = document.createElement("section");
  section.className = "content-header";
  const title = route ? t(route.titleKey) : path;
  section.innerHTML = `
    <h1>${escapeHtml(title)}</h1>
    <ol class="breadcrumb">
      <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("home"))}</a></li>
      <li class="active">${escapeHtml(title)}</li>
    </ol>`;
  container.append(section);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
