// BIN-676 — /cms list.
// Port of legacy/unity-backend/App/Views/CMS/cmsPage.html.
//
// Statisk 6-rad oversikt over CMS-sider. Hver rad peker til /view +
// /edit (som i legacy).

import { t } from "../../i18n/I18n.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "../adminUsers/shared.js";

interface CmsRow {
  id: number;
  labelKey: string;
  path: string;
  testId: string;
}

const CMS_ROWS: CmsRow[] = [
  { id: 1, labelKey: "faq", path: "#/faq", testId: "cms-row-faq" },
  { id: 2, labelKey: "terms_of_service", path: "#/TermsofService", testId: "cms-row-terms" },
  { id: 3, labelKey: "support", path: "#/Support", testId: "cms-row-support" },
  { id: 4, labelKey: "about_us", path: "#/Aboutus", testId: "cms-row-about" },
  { id: 5, labelKey: "responsible_gaming", path: "#/ResponsibleGameing", testId: "cms-row-responsible" },
  { id: 6, labelKey: "links_of_other_agencies", path: "#/LinksofOtherAgencies", testId: "cms-row-links" },
];

export function renderCmsListPage(container: HTMLElement): void {
  const rowsHtml = CMS_ROWS.map(
    (row) => `
    <tr data-testid="${escapeHtml(row.testId)}">
      <td>${row.id}</td>
      <td>${escapeHtml(t(row.labelKey))}</td>
      <td>
        <a href="${escapeHtml(row.path)}"
           class="btn btn-info btn-xs"
           data-action="cms-view"
           data-id="${row.id}">
          <i class="fa fa-eye" aria-hidden="true"></i>
        </a>
        <a href="${escapeHtml(row.path)}"
           class="btn btn-warning btn-xs"
           data-action="cms-edit"
           data-id="${row.id}"
           style="margin-left:4px">
          <i class="fa fa-pencil-square-o" aria-hidden="true"></i>
        </a>
      </td>
    </tr>`
  ).join("");

  container.innerHTML = `
    ${contentHeader("cms_management", "cms_management")}
    <section class="content">
      ${boxOpen("cms_management", "primary")}
        <table class="table table-bordered table-striped" data-testid="cms-table">
          <thead>
            <tr>
              <th>${escapeHtml(t("sr_no"))}</th>
              <th>${escapeHtml(t("cms_type"))}</th>
              <th>${escapeHtml(t("action"))}</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      ${boxClose()}
    </section>`;
}
