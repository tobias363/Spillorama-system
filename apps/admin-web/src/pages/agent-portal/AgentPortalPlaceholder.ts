// Shared placeholder for agent-portal skeleton pages.
//
// Agent-portal skeleton PR only wires the route-tree + side-nav; the
// individual sub-pages (players, physical-tickets, games, cash-in-out,
// unique-id, physical-cashout) are placeholder-bokser med "Kommer snart".
// Fylles inn i oppfølger-PR-er per legacy V1.0/V2.0-wireframes.

import { t } from "../../i18n/I18n.js";

export interface AgentPortalPlaceholderOpts {
  /** i18n-key for side-tittel (f.eks. "add_physical_tickets"). */
  titleKey: string;
  /** Hash-route tilknyttet side — vises som metadata. */
  path: string;
  /** Valgfri ekstra-beskrivelse (i18n-key) for å forklare innhold. */
  descriptionKey?: string;
}

export function mountAgentPortalPlaceholder(
  container: HTMLElement,
  opts: AgentPortalPlaceholderOpts
): void {
  const title = t(opts.titleKey);
  const description = opts.descriptionKey ? t(opts.descriptionKey) : t("agent_placeholder_body");
  container.innerHTML = `
    <section class="content-header">
      <h1>${escapeHtml(title)}</h1>
      <ol class="breadcrumb">
        <li><a href="#/agent/dashboard"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
        <li class="active">${escapeHtml(title)}</li>
      </ol>
    </section>
    <section class="content">
      <div class="box box-default">
        <div class="box-header with-border">
          <h3 class="box-title">${escapeHtml(title)}</h3>
          <div class="box-tools pull-right">
            <span class="label label-warning" data-marker="coming-soon">${escapeHtml(t("agent_placeholder_coming_soon"))}</span>
          </div>
        </div>
        <div class="box-body">
          <p>${escapeHtml(description)}</p>
          <p class="muted"><small>Route: <code>${escapeHtml(opts.path)}</code></small></p>
        </div>
      </div>
    </section>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
