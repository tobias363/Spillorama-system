// BIN-676 — /faq list.
// Port of legacy/unity-backend/App/Views/CMS/faq.html.
//
// Viser FAQ-oppføringer sortert på sort_order ASC, created_at ASC.
// Opp/ned-knapper for enkel sort_order-bytting (PATCH /api/admin/cms/faq/:id
// med sortOrder). Drag-to-reorder er ute av scope for BIN-676 (§7 note).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import { DataTable } from "../../components/DataTable.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "../adminUsers/shared.js";
import {
  listFaq,
  deleteFaq,
  updateFaq,
  type FaqRecord,
} from "../../api/admin-cms.js";

export function renderFaqListPage(container: HTMLElement): void {
  container.innerHTML = `
    ${contentHeader("faq_management", "cms_management")}
    <section class="content">
      ${boxOpen("faq_management", "primary")}
        <div id="faq-table">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const tableHost = container.querySelector<HTMLElement>("#faq-table")!;

  async function refresh(): Promise<void> {
    tableHost.textContent = t("loading_ellipsis");
    try {
      const rows = await listFaq();
      DataTable.mount<FaqRecord>(tableHost, {
        id: "faq-datatable",
        columns: [
          {
            key: "queId",
            title: t("question_id"),
            render: (r) => String(r.queId),
          },
          {
            key: "question",
            title: t("question"),
            render: (r) => escapeHtml(r.question),
          },
          {
            key: "answer",
            title: t("answer"),
            render: (r) => escapeHtml(r.answer),
          },
          {
            key: "id",
            title: t("action"),
            align: "center",
            render: (r) => rowActions(r, rows, () => void refresh()),
          },
        ],
        rows,
        emptyMessage: t("no_data_available_in_table"),
        toolbar: {
          extra: (host) => {
            const addBtn = document.createElement("a");
            addBtn.className = "btn btn-primary btn-sm";
            addBtn.setAttribute("data-action", "add-faq");
            addBtn.setAttribute("data-testid", "faq-add-btn");
            addBtn.href = "#/addFAQ";
            addBtn.innerHTML = `<i class="fa fa-plus" aria-hidden="true"></i> ${escapeHtml(t("add_faq"))}`;
            host.append(addBtn);
          },
        },
      });
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : t("something_went_wrong");
      tableHost.innerHTML = `<div class="callout callout-danger" data-testid="faq-error-banner">${escapeHtml(msg)}</div>`;
    }
  }

  void refresh();
}

function rowActions(
  row: FaqRecord,
  all: FaqRecord[],
  onChange: () => void
): Node {
  const wrap = document.createElement("div");
  wrap.style.whiteSpace = "nowrap";

  const idx = all.findIndex((f) => f.id === row.id);
  const canMoveUp = idx > 0;
  const canMoveDown = idx >= 0 && idx < all.length - 1;

  const mkBtn = (
    cls: string,
    icon: string,
    title: string,
    action: string,
    disabled: boolean,
    onClick?: () => void
  ): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn ${cls} btn-xs`;
    b.setAttribute("data-action", action);
    b.setAttribute("data-id", row.id);
    b.style.marginLeft = "4px";
    b.innerHTML = `<i class="fa ${icon}" aria-hidden="true"></i>`;
    b.title = title;
    if (disabled) b.disabled = true;
    if (onClick) b.addEventListener("click", onClick);
    return b;
  };

  const up = mkBtn(
    "btn-default",
    "fa-arrow-up",
    t("move_up"),
    "move-up-faq",
    !canMoveUp,
    () => {
      if (!canMoveUp) return;
      const other = all[idx - 1]!;
      void (async () => {
        try {
          await updateFaq(row.id, { sortOrder: other.sortOrder });
          await updateFaq(other.id, { sortOrder: row.sortOrder });
          onChange();
        } catch (err) {
          Toast.error(
            err instanceof ApiError ? err.message : t("something_went_wrong")
          );
        }
      })();
    }
  );
  up.style.marginLeft = "0";
  wrap.append(up);

  wrap.append(
    mkBtn(
      "btn-default",
      "fa-arrow-down",
      t("move_down"),
      "move-down-faq",
      !canMoveDown,
      () => {
        if (!canMoveDown) return;
        const other = all[idx + 1]!;
        void (async () => {
          try {
            await updateFaq(row.id, { sortOrder: other.sortOrder });
            await updateFaq(other.id, { sortOrder: row.sortOrder });
            onChange();
          } catch (err) {
            Toast.error(
              err instanceof ApiError ? err.message : t("something_went_wrong")
            );
          }
        })();
      }
    )
  );

  const edit = document.createElement("a");
  edit.className = "btn btn-warning btn-xs";
  edit.setAttribute("data-action", "edit-faq");
  edit.setAttribute("data-id", row.id);
  edit.href = `#/faqEdit/${encodeURIComponent(row.id)}`;
  edit.innerHTML = `<i class="fa fa-edit" aria-hidden="true"></i>`;
  edit.title = t("edit_faq");
  edit.setAttribute("aria-label", t("edit_faq"));
  edit.style.marginLeft = "4px";
  wrap.append(edit);

  wrap.append(
    mkBtn(
      "btn-danger",
      "fa-trash",
      t("delete"),
      "delete-faq",
      false,
      () => {
        if (!window.confirm(`${t("are_you_sure")}\n\n${t("delete_player_message")}`))
          return;
        void (async () => {
          try {
            await deleteFaq(row.id);
            Toast.success(t("faq_deleted_succesfully"));
            onChange();
          } catch (err) {
            Toast.error(
              err instanceof ApiError ? err.message : t("something_went_wrong")
            );
          }
        })();
      }
    )
  );

  return wrap;
}
