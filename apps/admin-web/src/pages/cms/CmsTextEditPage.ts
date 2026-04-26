// BIN-676 + BIN-680 — CMS-tekst-edit (gjenbruk for 5 sider).
//
// Port of:
//   - CMS/termsofservice.html      → backend slug "terms"
//   - CMS/support.html             → backend slug "support"
//   - CMS/aboutus.html             → backend slug "aboutus"
//   - CMS/LinksofOtherAgencies.html → backend slug "links"
//   - CMS/ResponsibleGameing.html  → backend slug "responsible-gaming"
//
// BIN-680 Lag 1: regulatoriske slugs (responsible-gaming) bruker versjonert
// redigerings-flyt:
//   draft → review → approved → live → retired
// UI viser:
//   - Textarea + "Lagre som ny draft"-knapp (erstatter direkte PUT)
//   - Versjons-historikk-panel med status + metadata + workflow-knapper
//   - 4-øyne: approve-knappen disables hvis gjeldende admin er creator
// Fortsatt audit på alle state-transitions. Backend håndhever alt —
// UI bare eksponerer knappene.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import { fetchMe } from "../../api/auth.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "../adminUsers/shared.js";
import {
  getCmsText,
  setCmsText,
  requiresVersionWorkflow,
  listCmsVersions,
  submitCmsVersion,
  approveCmsVersion,
  publishCmsVersion,
  type CmsTextKey,
  type CmsVersionRecord,
} from "../../api/admin-cms.js";

export function renderCmsTextEditPage(
  container: HTMLElement,
  key: CmsTextKey
): void {
  const isVersioned = requiresVersionWorkflow(key);
  const labelKey = key; // i18n-nøkler matcher CmsTextKey-enum

  container.innerHTML = `
    ${contentHeader(labelKey, "cms_management")}
    <section class="content">
      ${
        isVersioned
          ? `<div class="callout callout-info" data-testid="cms-regulatory-lock-banner">
              <i class="fa fa-history" aria-hidden="true"></i>
              <strong>${escapeHtml(t("cms_regulatory_locked_title"))}</strong>
              <p>${escapeHtml(t("cms_regulatory_locked_body"))}</p>
            </div>`
          : ""
      }
      ${boxOpen(labelKey, "primary")}
        <form id="cms-text-form" class="form-horizontal" data-testid="cms-text-form">
          <div class="form-group">
            <label class="col-sm-2 control-label" for="cms-body">${escapeHtml(t(labelKey))}</label>
            <div class="col-sm-10">
              <textarea
                id="cms-body"
                name="body"
                class="form-control"
                rows="12"
                data-testid="cms-body-textarea"
                placeholder="${escapeHtml(t("enter") + " " + t(labelKey))}"></textarea>
            </div>
          </div>
          <div class="form-group">
            <div class="col-sm-offset-2 col-sm-10">
              <button type="submit"
                      class="btn btn-success"
                      data-action="save-cms-text"
                      data-testid="cms-save-btn">
                <i class="fa fa-save" aria-hidden="true"></i> ${escapeHtml(
                  isVersioned ? t("submit") : t("submit")
                )}
              </button>
              <a class="btn btn-default" href="#/cms">${escapeHtml(t("cancel"))}</a>
            </div>
          </div>
        </form>
      ${boxClose()}
      ${
        isVersioned
          ? `${boxOpen("cms_version_history", "info")}
              <div id="cms-version-history" data-testid="cms-version-history">
                ${escapeHtml(t("loading_ellipsis"))}
              </div>
             ${boxClose()}`
          : ""
      }
    </section>`;

  const form = container.querySelector<HTMLFormElement>("#cms-text-form")!;
  const textarea = container.querySelector<HTMLTextAreaElement>("#cms-body")!;
  const historyHost = container.querySelector<HTMLElement>(
    "#cms-version-history"
  );

  void (async () => {
    try {
      const record = await getCmsText(key);
      textarea.value = record.body;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
    }
    if (isVersioned && historyHost) {
      await refreshHistory(historyHost, key);
    }
  })();

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void (async () => {
      try {
        await setCmsText(key, textarea.value);
        Toast.success(
          isVersioned ? t("cms_draft_created") : t("success")
        );
        if (isVersioned && historyHost) {
          await refreshHistory(historyHost, key);
        }
      } catch (err) {
        const msg =
          err instanceof ApiError ? err.message : t("something_went_wrong");
        Toast.error(msg);
      }
    })();
  });
}

/** Rydd opp og render historikk-panel. */
async function refreshHistory(
  host: HTMLElement,
  key: CmsTextKey
): Promise<void> {
  host.textContent = t("loading_ellipsis");
  let rows: CmsVersionRecord[];
  let currentUserId: string | null = null;
  try {
    [rows, currentUserId] = await Promise.all([
      listCmsVersions(key),
      fetchMe()
        .then((s) => s.id)
        .catch(() => null),
    ]);
  } catch (err) {
    const msg =
      err instanceof ApiError ? err.message : t("something_went_wrong");
    host.innerHTML = `<div class="callout callout-danger" data-testid="cms-history-error">${escapeHtml(msg)}</div>`;
    return;
  }

  if (rows.length === 0) {
    host.innerHTML = `<p data-testid="cms-history-empty">${escapeHtml(t("no_data_available_in_table"))}</p>`;
    return;
  }

  const frag = document.createElement("div");
  frag.setAttribute("data-testid", "cms-history-list");
  const tbl = document.createElement("table");
  tbl.className = "table table-striped";
  tbl.innerHTML = `
    <thead>
      <tr>
        <th>${escapeHtml(t("cms_version_number"))}</th>
        <th>${escapeHtml(t("status"))}</th>
        <th>${escapeHtml(t("cms_created_by"))}</th>
        <th>${escapeHtml(t("cms_created_at"))}</th>
        <th>${escapeHtml(t("cms_approved_by"))}</th>
        <th>${escapeHtml(t("action"))}</th>
      </tr>
    </thead>
    <tbody></tbody>`;
  const tbody = tbl.querySelector("tbody")!;
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.setAttribute("data-testid", `cms-version-row-${row.id}`);
    tr.setAttribute("data-version-id", row.id);
    tr.setAttribute("data-status", row.status);
    tr.appendChild(td(`#${row.versionNumber}`));
    tr.appendChild(td(statusBadge(row.status)));
    tr.appendChild(td(escapeHtml(row.createdByUserId)));
    tr.appendChild(td(escapeHtml(formatIso(row.createdAt))));
    tr.appendChild(
      td(
        row.approvedByUserId
          ? escapeHtml(row.approvedByUserId)
          : "<em>—</em>"
      )
    );
    const actionCell = document.createElement("td");
    actionCell.appendChild(
      renderWorkflowButtons(row, currentUserId, key, host)
    );
    tr.appendChild(actionCell);
    tbody.appendChild(tr);
  }
  frag.appendChild(tbl);
  host.innerHTML = "";
  host.appendChild(frag);
}

function td(html: string): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.innerHTML = html;
  return cell;
}

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    draft: "label-default",
    review: "label-warning",
    approved: "label-info",
    live: "label-success",
    retired: "label-default",
  };
  const cls = map[status] ?? "label-default";
  return `<span class="label ${cls}" data-testid="cms-version-status-${status}">${escapeHtml(status)}</span>`;
}

function formatIso(iso: string): string {
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 19);
  } catch {
    return iso;
  }
}

function renderWorkflowButtons(
  row: CmsVersionRecord,
  currentUserId: string | null,
  key: CmsTextKey,
  host: HTMLElement
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.whiteSpace = "nowrap";

  if (row.status === "draft") {
    const btn = mkBtn(
      "btn-primary",
      "fa-paper-plane",
      t("cms_version_submit"),
      `cms-submit-${row.id}`,
      async () => {
        try {
          await submitCmsVersion(key, row.id);
          Toast.success(t("cms_version_submitted"));
          await refreshHistory(host, key);
        } catch (err) {
          Toast.error(
            err instanceof ApiError ? err.message : t("something_went_wrong")
          );
        }
      }
    );
    btn.setAttribute("data-action", "cms-version-submit");
    wrap.appendChild(btn);
  } else if (row.status === "review") {
    // 4-øyne: approve-knappen disables hvis gjeldende admin er creator.
    const canApprove =
      currentUserId !== null && currentUserId !== row.createdByUserId;
    const btn = mkBtn(
      canApprove ? "btn-success" : "btn-default",
      "fa-check",
      canApprove
        ? t("cms_version_approve")
        : t("cms_version_approve_four_eyes_blocked"),
      `cms-approve-${row.id}`,
      async () => {
        try {
          await approveCmsVersion(key, row.id);
          Toast.success(t("cms_version_approved"));
          await refreshHistory(host, key);
        } catch (err) {
          Toast.error(
            err instanceof ApiError ? err.message : t("something_went_wrong")
          );
        }
      }
    );
    btn.setAttribute("data-action", "cms-version-approve");
    if (!canApprove) {
      btn.disabled = true;
      btn.title = t("cms_version_approve_four_eyes_blocked");
    }
    wrap.appendChild(btn);
  } else if (row.status === "approved") {
    const btn = mkBtn(
      "btn-success",
      "fa-cloud-upload",
      t("cms_version_publish"),
      `cms-publish-${row.id}`,
      async () => {
        if (!window.confirm(t("cms_version_publish_confirm"))) return;
        try {
          await publishCmsVersion(key, row.id);
          Toast.success(t("cms_version_published"));
          await refreshHistory(host, key);
        } catch (err) {
          Toast.error(
            err instanceof ApiError ? err.message : t("something_went_wrong")
          );
        }
      }
    );
    btn.setAttribute("data-action", "cms-version-publish");
    wrap.appendChild(btn);
  }
  // live / retired: no actions.
  if (wrap.childElementCount === 0) {
    wrap.innerHTML = "<em>—</em>";
  }
  return wrap;
}

function mkBtn(
  cls: string,
  icon: string,
  label: string,
  testId: string,
  onClick: () => Promise<void> | void
): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `btn ${cls} btn-xs`;
  b.setAttribute("data-testid", testId);
  b.innerHTML = `<i class="fa ${icon}" aria-hidden="true"></i> ${escapeHtml(label)}`;
  b.addEventListener("click", () => {
    void onClick();
  });
  return b;
}
