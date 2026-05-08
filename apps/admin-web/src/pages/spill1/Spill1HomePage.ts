/**
 * Spill 1 — landingsside som samler de tre admin-modulene under én sidebar-
 * entry. Erstatter de tre tidligere ekspanderbare sidebar-leaves
 * («Spillkatalog», «Spilleplaner», «Hallgrupper-administrasjon») med ett
 * felles inngangspunkt i venstre sidebar.
 *
 * Layout-mønster: tre `card-link`-kort i en 3-kolonne-grid (matcher
 * AdminLTE-stilen brukt resten av admin-panelet). Hvert kort navigerer til
 * den eksisterende underliggende ruten, som fortsatt er registrert i
 * routes.ts og kan deep-lenkes direkte.
 *
 * RBAC-merknad: hallgrupper-kortet er kun synlig for ADMIN/super-admin —
 * samme rolle-gate som routes.ts håndhever på `/groupHall`.
 */

import { t } from "../../i18n/I18n.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { getSession } from "../../auth/Session.js";

interface Spill1Card {
  href: string;
  icon: string;
  titleKey: string;
  descriptionKey: string;
  /**
   * Hvis satt: kortet skjules for roller som ikke matcher. Null/undefined
   * betyr åpent for alle roller som har lov å åpne Spill 1-siden i det
   * hele tatt (sidebar-route-guarden filtrerer allerede).
   */
  adminOnly?: boolean;
}

const CARDS: Spill1Card[] = [
  {
    href: "#/games/catalog",
    icon: "fa fa-puzzle-piece",
    titleKey: "game_catalog_title",
    descriptionKey: "spill1_card_catalog_description",
  },
  {
    href: "#/games/plans",
    icon: "fa fa-calendar",
    titleKey: "game_plans_title",
    descriptionKey: "spill1_card_plans_description",
  },
  {
    href: "#/groupHall",
    icon: "fa fa-sitemap",
    titleKey: "group_of_halls_management",
    descriptionKey: "spill1_card_group_halls_description",
    adminOnly: true,
  },
];

function isAdmin(): boolean {
  const session = getSession();
  if (!session) return false;
  return session.role === "admin" || session.role === "super-admin";
}

export function renderSpill1HomePage(container: HTMLElement): void {
  const adminAccess = isAdmin();
  const visibleCards = CARDS.filter((c) => (c.adminOnly ? adminAccess : true));

  container.innerHTML = `
    <div class="page-wrapper"><div class="container-fluid">
      <section class="content-header">
        <h1>${escapeHtml(t("spill1_home_title"))}</h1>
        <ol class="breadcrumb">
          <li><a href="#/admin"><i class="fa fa-dashboard" aria-hidden="true"></i> ${escapeHtml(t("dashboard"))}</a></li>
          <li>${escapeHtml(t("game_management"))}</li>
          <li class="active">${escapeHtml(t("spill1_home_title"))}</li>
        </ol>
      </section>
      <section class="content">
        <div class="row"><div class="col-sm-12">
          <div class="panel panel-default card-view">
            <div class="panel-heading">
              <div class="pull-left"><h6 class="panel-title txt-dark">${escapeHtml(t("spill1_home_title"))}</h6></div>
              <div class="clearfix"></div>
            </div>
            <div class="panel-wrapper collapse in">
              <div class="panel-body">
                <p class="text-muted">${escapeHtml(t("spill1_home_intro"))}</p>
                <div class="row">
                  ${visibleCards.map(renderCard).join("")}
                </div>
              </div>
            </div>
          </div>
        </div></div>
      </section>
    </div></div>`;
}

function renderCard(card: Spill1Card): string {
  return `
    <div class="col-md-4 col-sm-6 col-xs-12">
      <a href="${escapeHtml(card.href)}"
         class="panel panel-default card-view"
         style="display:block;text-decoration:none;color:inherit;margin-bottom:20px;"
         data-spill1-card="${escapeHtml(card.titleKey)}">
        <div class="panel-body" style="padding:24px;">
          <div style="display:flex;align-items:flex-start;gap:16px;">
            <div style="flex:0 0 auto;font-size:32px;color:#5d9cec;">
              <i class="${escapeHtml(card.icon)}" aria-hidden="true"></i>
            </div>
            <div style="flex:1 1 auto;">
              <h4 class="txt-dark" style="margin:0 0 8px 0;font-weight:600;">
                ${escapeHtml(t(card.titleKey))}
              </h4>
              <p class="text-muted" style="margin:0;font-size:13px;line-height:1.5;">
                ${escapeHtml(t(card.descriptionKey))}
              </p>
            </div>
          </div>
        </div>
      </a>
    </div>`;
}
