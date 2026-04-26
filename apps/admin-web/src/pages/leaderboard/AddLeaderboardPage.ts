// BIN-668 — /addLeaderboard (create) og /leaderboard/edit/:id (update).
//
// Ett form for både create og update. Felter: tierName, place, points,
// prizeAmount (NOK, nullable), prizeDescription, active, extra (JSON).

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  createLeaderboardTier,
  getLeaderboardTier,
  updateLeaderboardTier,
  type LeaderboardTier,
} from "../../api/admin-leaderboard.js";
import { boxClose, boxOpen, contentHeader, escapeHtml } from "./shared.js";

export function renderAddLeaderboardPage(container: HTMLElement, id: string | null): void {
  const titleKey = id ? "leaderboard_tier_update" : "leaderboard_tier_create";
  container.innerHTML = `
    ${contentHeader(titleKey)}
    <section class="content">
      ${boxOpen(titleKey, "primary")}
        <div id="leaderboard-form-host">${escapeHtml(t("loading_ellipsis"))}</div>
      ${boxClose()}
    </section>`;

  const host = container.querySelector<HTMLElement>("#leaderboard-form-host")!;
  void mount(host, id);
}

async function mount(host: HTMLElement, id: string | null): Promise<void> {
  let existing: LeaderboardTier | null = null;
  if (id) {
    try {
      existing = await getLeaderboardTier(id);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
      host.innerHTML = `<div class="callout callout-danger" data-testid="leaderboard-load-error">${escapeHtml(msg)}</div>`;
      return;
    }
  }

  host.innerHTML = renderForm(existing);

  const form = host.querySelector<HTMLFormElement>("#leaderboard-tier-form")!;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submit(form, id);
  });
}

function renderForm(tier: LeaderboardTier | null): string {
  return `
    <form id="leaderboard-tier-form" class="form-horizontal" data-testid="leaderboard-tier-form">
      <div class="form-group">
        <label class="col-sm-4 control-label" for="lb-tier-name">${escapeHtml(t("leaderboard_tier_name"))}</label>
        <div class="col-sm-8">
          <input type="text" id="lb-tier-name" name="tierName" class="form-control"
            maxlength="200" required data-testid="lb-tier-name"
            value="${escapeHtml(tier?.tierName ?? "default")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="lb-place">${escapeHtml(t("leaderboard_place"))}</label>
        <div class="col-sm-8">
          <input type="number" id="lb-place" name="place" class="form-control"
            min="1" step="1" required data-testid="lb-place"
            value="${escapeHtml(String(tier?.place ?? 1))}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="lb-points">${escapeHtml(t("leaderboard_points"))}</label>
        <div class="col-sm-8">
          <input type="number" id="lb-points" name="points" class="form-control"
            min="0" step="1" required data-testid="lb-points"
            value="${escapeHtml(String(tier?.points ?? 0))}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="lb-prize-amount">${escapeHtml(t("leaderboard_prize_amount"))}</label>
        <div class="col-sm-8">
          <input type="number" id="lb-prize-amount" name="prizeAmount" class="form-control"
            min="0" step="0.01" data-testid="lb-prize-amount"
            value="${escapeHtml(tier?.prizeAmount === null || tier?.prizeAmount === undefined ? "" : String(tier.prizeAmount))}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="lb-prize-description">${escapeHtml(t("leaderboard_prize_description"))}</label>
        <div class="col-sm-8">
          <input type="text" id="lb-prize-description" name="prizeDescription" class="form-control"
            maxlength="500" data-testid="lb-prize-description"
            value="${escapeHtml(tier?.prizeDescription ?? "")}">
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-4 control-label" for="lb-active">${escapeHtml(t("leaderboard_active"))}</label>
        <div class="col-sm-8">
          <input type="checkbox" id="lb-active" name="active" data-testid="lb-active" ${tier?.active !== false ? "checked" : ""}>
        </div>
      </div>
      <div class="form-group">
        <div class="col-sm-8 col-sm-offset-4">
          <button type="submit" class="btn btn-success" data-testid="btn-save-tier">
            <i class="fa fa-save" aria-hidden="true"></i>
            ${escapeHtml(tier ? t("leaderboard_tier_update") : t("leaderboard_tier_create"))}
          </button>
          <a href="#/leaderboard" class="btn btn-default">${escapeHtml(t("cancel"))}</a>
        </div>
      </div>
    </form>`;
}

async function submit(form: HTMLFormElement, id: string | null): Promise<void> {
  const tierName = (form.querySelector<HTMLInputElement>("#lb-tier-name")!).value.trim();
  const place = Number((form.querySelector<HTMLInputElement>("#lb-place")!).value);
  const points = Number((form.querySelector<HTMLInputElement>("#lb-points")!).value);
  const prizeAmountRaw = (form.querySelector<HTMLInputElement>("#lb-prize-amount")!).value.trim();
  const prizeDescription = (form.querySelector<HTMLInputElement>("#lb-prize-description")!).value;
  const active = (form.querySelector<HTMLInputElement>("#lb-active")!).checked;

  const prizeAmount: number | null = prizeAmountRaw === "" ? null : Number(prizeAmountRaw);

  try {
    if (id) {
      await updateLeaderboardTier(id, {
        tierName,
        place,
        points,
        prizeAmount,
        prizeDescription,
        active,
      });
      Toast.success(t("leaderboard_tier_updated"));
    } else {
      await createLeaderboardTier({
        tierName,
        place,
        points,
        prizeAmount,
        prizeDescription,
        active,
      });
      Toast.success(t("leaderboard_tier_created"));
    }
    window.location.hash = "#/leaderboard";
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(msg);
  }
}
