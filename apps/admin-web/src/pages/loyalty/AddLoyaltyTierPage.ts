// BIN-700 — /loyaltyManagement/new (create) og /loyaltyManagement/edit/:id (update).
//
// Ett form for begge. Felter: name, rank, minPoints, maxPoints (nullable),
// benefits (JSON), active.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  createLoyaltyTier,
  getLoyaltyTier,
  updateLoyaltyTier,
  type LoyaltyTier,
} from "../../api/admin-loyalty.js";
import { boxClose, boxOpen, contentHeader, escapeHtml } from "./shared.js";

export function renderAddLoyaltyTierPage(
  container: HTMLElement,
  id: string | null
): void {
  const titleKey = id ? "loyalty_tier_update" : "loyalty_tier_create";
  container.innerHTML = `
    ${contentHeader(titleKey)}
    <section class="content">
      ${boxOpen(titleKey, "primary")}
        <div id="loyalty-tier-form-host">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const host = container.querySelector<HTMLElement>("#loyalty-tier-form-host")!;
  void mount(host, id);
}

async function mount(host: HTMLElement, id: string | null): Promise<void> {
  let existing: LoyaltyTier | null = null;
  if (id) {
    try {
      existing = await getLoyaltyTier(id);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      host.innerHTML = `<div class="callout callout-danger" data-testid="loyalty-tier-load-error">${escapeHtml(msg)}</div>`;
      return;
    }
  }

  host.innerHTML = renderForm(existing);

  const form = host.querySelector<HTMLFormElement>("#loyalty-tier-form")!;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submit(form, id);
  });
}

function renderForm(tier: LoyaltyTier | null): string {
  const benefitsStr = tier?.benefits ? JSON.stringify(tier.benefits, null, 2) : "{}";
  return `
    <form id="loyalty-tier-form" class="form-horizontal" data-testid="loyalty-tier-form">
      <div class="form-group">
        <label class="col-sm-4 control-label" for="lt-name">${escapeHtml(t("loyalty_tier_name"))}</label>
        <div class="col-sm-8">
          <input type="text" id="lt-name" name="name" class="form-control"
            maxlength="200" required data-testid="lt-name"
            value="${escapeHtml(tier?.name ?? "")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="lt-rank">${escapeHtml(t("loyalty_tier_rank"))}</label>
        <div class="col-sm-8">
          <input type="number" id="lt-rank" name="rank" class="form-control"
            min="1" step="1" required data-testid="lt-rank"
            value="${escapeHtml(String(tier?.rank ?? 1))}">
          <p class="help-block">${escapeHtml(t("loyalty_tier_rank_help"))}</p>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="lt-min-points">${escapeHtml(t("loyalty_tier_min_points"))}</label>
        <div class="col-sm-8">
          <input type="number" id="lt-min-points" name="minPoints" class="form-control"
            min="0" step="1" required data-testid="lt-min-points"
            value="${escapeHtml(String(tier?.minPoints ?? 0))}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="lt-max-points">${escapeHtml(t("loyalty_tier_max_points"))}</label>
        <div class="col-sm-8">
          <input type="number" id="lt-max-points" name="maxPoints" class="form-control"
            min="0" step="1" data-testid="lt-max-points"
            value="${escapeHtml(tier?.maxPoints === null || tier?.maxPoints === undefined ? "" : String(tier.maxPoints))}">
          <p class="help-block">${escapeHtml(t("loyalty_tier_max_points_help"))}</p>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="lt-benefits">${escapeHtml(t("loyalty_tier_benefits"))}</label>
        <div class="col-sm-8">
          <textarea id="lt-benefits" name="benefits" class="form-control" rows="4"
            data-testid="lt-benefits">${escapeHtml(benefitsStr)}</textarea>
          <p class="help-block">${escapeHtml(t("loyalty_tier_benefits_help"))}</p>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="lt-active">${escapeHtml(t("loyalty_tier_active"))}</label>
        <div class="col-sm-8">
          <input type="checkbox" id="lt-active" name="active" data-testid="lt-active" ${tier?.active !== false ? "checked" : ""}>
        </div>
      </div>
      <div class="form-group">
        <div class="col-sm-8 col-sm-offset-4">
          <button type="submit" class="btn btn-success" data-testid="btn-save-loyalty-tier">
            <i class="fa fa-save" aria-hidden="true"></i>
            ${escapeHtml(tier ? t("loyalty_tier_update") : t("loyalty_tier_create"))}
          </button>
          <a href="#/loyaltyManagement" class="btn btn-default">${escapeHtml(t("cancel"))}</a>
        </div>
      </div>
    </form>`;
}

async function submit(form: HTMLFormElement, id: string | null): Promise<void> {
  const name = form.querySelector<HTMLInputElement>("#lt-name")!.value.trim();
  const rank = Number(form.querySelector<HTMLInputElement>("#lt-rank")!.value);
  const minPoints = Number(form.querySelector<HTMLInputElement>("#lt-min-points")!.value);
  const maxPointsRaw = form.querySelector<HTMLInputElement>("#lt-max-points")!.value.trim();
  const active = form.querySelector<HTMLInputElement>("#lt-active")!.checked;
  const benefitsRaw = form.querySelector<HTMLTextAreaElement>("#lt-benefits")!.value.trim();

  const maxPoints: number | null = maxPointsRaw === "" ? null : Number(maxPointsRaw);

  let benefits: Record<string, unknown> = {};
  if (benefitsRaw) {
    try {
      benefits = JSON.parse(benefitsRaw) as Record<string, unknown>;
      if (typeof benefits !== "object" || Array.isArray(benefits)) {
        throw new Error("not-object");
      }
    } catch {
      Toast.error(t("loyalty_tier_benefits_invalid_json"));
      return;
    }
  }

  try {
    if (id) {
      await updateLoyaltyTier(id, { name, rank, minPoints, maxPoints, benefits, active });
      Toast.success(t("loyalty_tier_updated"));
    } else {
      await createLoyaltyTier({ name, rank, minPoints, maxPoints, benefits, active });
      Toast.success(t("loyalty_tier_created"));
    }
    window.location.hash = "#/loyaltyManagement";
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(msg);
  }
}
