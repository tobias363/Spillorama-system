import { t } from "../../i18n/I18n.js";

const SECTION_BY_ROUTE: Record<string, string> = {
  "/live/dashboard": "dashboard",
  "/live/game-settings": "game-settings",
  "/live/games": "games",
  "/live/halls": "halls",
  "/live/hall-display": "hall-display",
  "/live/terminals": "terminals",
  "/live/hall-rules": "hall-rules",
  "/live/wallet-compliance": "wallet-compliance",
  "/live/prize-policy": "prize-policy",
  "/live/room-control": "room-control",
  "/live/payment-requests": "payment-requests",
};

export function mountLegacySection(container: HTMLElement, routePath: string): void {
  const section = SECTION_BY_ROUTE[routePath];
  if (!section) {
    container.innerHTML = `<div class="box box-danger"><div class="box-body">Ukjent Spillorama Live-seksjon: ${escapeHtml(routePath)}</div></div>`;
    return;
  }

  const src = `/admin/legacy-v1/index.html#${section}`;
  container.innerHTML = `
    <div class="box box-primary" style="margin-bottom: 0;">
      <div class="box-header with-border">
        <h3 class="box-title"><i class="fa fa-bolt"></i> Spillorama Live — ${escapeHtml(t("spillorama_" + section.replace(/-/g, "_")))}</h3>
        <div class="box-tools pull-right">
          <a href="${src}" target="_blank" class="btn btn-xs btn-default">
            <i class="fa fa-external-link"></i> Åpne i ny fane
          </a>
        </div>
      </div>
      <div class="box-body" style="padding: 0;">
        <iframe
          src="${src}"
          style="width: 100%; border: 0; display: block; min-height: 800px; background: #f5f7fb;"
          loading="lazy"
          title="Spillorama Live ${escapeHtml(section)}"></iframe>
      </div>
    </div>`;

  const iframe = container.querySelector<HTMLIFrameElement>("iframe");
  if (iframe) {
    iframe.addEventListener("load", () => autoResize(iframe));
    window.addEventListener("resize", () => autoResize(iframe));
  }
}

function autoResize(iframe: HTMLIFrameElement): void {
  const viewportHeight = window.innerHeight;
  const offset = iframe.getBoundingClientRect().top;
  const target = Math.max(600, viewportHeight - offset - 80);
  iframe.style.height = `${target}px`;
}

export function isLegacySectionRoute(routePath: string): boolean {
  return routePath in SECTION_BY_ROUTE;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
