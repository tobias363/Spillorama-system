// BIN-676 — /addFAQ + /faqEdit/:id.
// Port of legacy/unity-backend/App/Views/CMS/addFAQ.html.
//
// Wrapper over CmsService FAQ CRUD. Validerer question + answer (påkrevd),
// speiler backend-grenser (question ≤ 1000 tegn, answer ≤ 10000 tegn).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  boxClose,
  boxOpen,
  contentHeader,
  escapeHtml,
} from "../adminUsers/shared.js";
import {
  getFaq,
  createFaq,
  updateFaq,
  type FaqRecord,
} from "../../api/admin-cms.js";

const QUESTION_MAX = 1_000;
const ANSWER_MAX = 10_000;

export function renderFaqFormPage(
  container: HTMLElement,
  editId: string | null
): void {
  const isEdit = editId !== null;
  const titleKey = isEdit ? "edit_faq" : "add_faq";

  container.innerHTML = `
    ${contentHeader(titleKey, "cms_management")}
    <section class="content">
      ${boxOpen(titleKey, "primary")}
        <div id="faq-form-host">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const host = container.querySelector<HTMLElement>("#faq-form-host")!;
  void mount(host, editId);
}

async function mount(
  host: HTMLElement,
  editId: string | null
): Promise<void> {
  let existing: FaqRecord | null = null;
  if (editId) {
    try {
      existing = await getFaq(editId);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : t("something_went_wrong");
      host.innerHTML = `<div class="callout callout-danger" data-testid="faq-error-banner">${escapeHtml(msg)}</div>`;
      return;
    }
    if (!existing) {
      host.innerHTML = `<div class="callout callout-danger" data-testid="faq-error-banner">${escapeHtml(t("something_went_wrong"))}</div>`;
      return;
    }
  }

  host.innerHTML = `
    <form id="faq-form" class="form-horizontal" data-testid="faq-form">
      <div class="form-group">
        <label class="col-sm-2 control-label" for="ff-question">${escapeHtml(t("question"))}</label>
        <div class="col-sm-10">
          <input type="text" id="ff-question" name="question" class="form-control" required
            maxlength="${QUESTION_MAX}"
            data-testid="faq-question-input"
            value="${escapeHtml(existing?.question ?? "")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-2 control-label" for="ff-answer">${escapeHtml(t("answer"))}</label>
        <div class="col-sm-10">
          <textarea id="ff-answer" name="answer" class="form-control" rows="6" required
            maxlength="${ANSWER_MAX}"
            data-testid="faq-answer-input">${escapeHtml(existing?.answer ?? "")}</textarea>
        </div>
      </div>
      <div class="form-group">
        <div class="col-sm-offset-2 col-sm-10">
          <button type="submit" class="btn btn-success" data-action="save-faq" data-testid="faq-save-btn">
            <i class="fa fa-save" aria-hidden="true"></i> ${escapeHtml(t("submit"))}
          </button>
          <a class="btn btn-default" href="#/faq">${escapeHtml(t("cancel"))}</a>
        </div>
      </div>
    </form>`;

  const form = host.querySelector<HTMLFormElement>("#faq-form")!;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submit(form, existing);
  });
}

async function submit(
  form: HTMLFormElement,
  existing: FaqRecord | null
): Promise<void> {
  const question = form.querySelector<HTMLInputElement>("#ff-question")!.value.trim();
  const answer = form.querySelector<HTMLTextAreaElement>("#ff-answer")!.value.trim();

  if (!question || !answer) {
    Toast.error(t("all_fields_are_required"));
    return;
  }

  try {
    if (existing) {
      await updateFaq(existing.id, { question, answer });
    } else {
      await createFaq({ question, answer });
    }
    Toast.success(t("success"));
    window.location.hash = "#/faq";
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(msg);
  }
}
