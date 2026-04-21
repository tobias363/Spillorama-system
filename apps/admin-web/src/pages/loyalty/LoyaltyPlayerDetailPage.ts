// BIN-700 — /loyaltyManagement/players/:userId (spiller-detalj + award +
// tier-override).
//
// Viser state-snapshot (lifetime/month points, tier, lock-flag), event-
// history (siste 50), og to admin-skjemaer:
//   1) Points-award (pointsDelta + reason → POST /award)
//   2) Manual tier-override (tier select + reason → PATCH /tier)

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  awardLoyaltyPoints,
  getLoyaltyPlayer,
  listLoyaltyTiers,
  overrideLoyaltyTier,
  type LoyaltyPlayerState,
  type LoyaltyEvent,
} from "../../api/admin-loyalty.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, formatPoints } from "./shared.js";

export function renderLoyaltyPlayerDetailPage(
  container: HTMLElement,
  userId: string
): void {
  container.innerHTML = `
    ${contentHeader("loyalty_player_detail_title")}
    <section class="content">
      <div class="row">
        <div class="col-md-6">
          ${boxOpen("loyalty_player_state_title", "info")}
            <div id="loyalty-player-state">${escapeHtml(t("loading_ellipsis"))}</div>
          ${boxClose()}
        </div>
        <div class="col-md-6">
          ${boxOpen("loyalty_points_award_title", "primary")}
            <form id="loyalty-award-form" class="form-horizontal" data-testid="loyalty-award-form">
              <div class="form-group">
                <label class="col-sm-4 control-label" for="lp-delta">${escapeHtml(t("loyalty_points_delta"))}</label>
                <div class="col-sm-8">
                  <input type="number" id="lp-delta" name="pointsDelta" class="form-control"
                    step="1" required data-testid="lp-delta">
                  <p class="help-block">${escapeHtml(t("loyalty_points_delta_help"))}</p>
                </div>
              </div>
              <div class="form-group">
                <label class="col-sm-4 control-label" for="lp-reason">${escapeHtml(t("loyalty_reason"))}</label>
                <div class="col-sm-8">
                  <input type="text" id="lp-reason" name="reason" class="form-control"
                    maxlength="500" required data-testid="lp-reason">
                </div>
              </div>
              <div class="form-group">
                <div class="col-sm-8 col-sm-offset-4">
                  <button type="submit" class="btn btn-success" data-testid="btn-award-points">
                    <i class="fa fa-plus-circle"></i> ${escapeHtml(t("loyalty_award_points"))}
                  </button>
                </div>
              </div>
            </form>
          ${boxClose()}
          ${boxOpen("loyalty_tier_override_title", "warning")}
            <form id="loyalty-override-form" class="form-horizontal" data-testid="loyalty-override-form">
              <div class="form-group">
                <label class="col-sm-4 control-label" for="lo-tier">${escapeHtml(t("loyalty_tier_select"))}</label>
                <div class="col-sm-8">
                  <select id="lo-tier" name="tierId" class="form-control" data-testid="lo-tier">
                    <option value="">${escapeHtml(t("loyalty_tier_override_clear"))}</option>
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label class="col-sm-4 control-label" for="lo-reason">${escapeHtml(t("loyalty_reason"))}</label>
                <div class="col-sm-8">
                  <input type="text" id="lo-reason" name="reason" class="form-control"
                    maxlength="500" required data-testid="lo-reason">
                </div>
              </div>
              <div class="form-group">
                <div class="col-sm-8 col-sm-offset-4">
                  <button type="submit" class="btn btn-warning" data-testid="btn-override-tier">
                    <i class="fa fa-lock"></i> ${escapeHtml(t("loyalty_tier_override_apply"))}
                  </button>
                </div>
              </div>
            </form>
          ${boxClose()}
        </div>
      </div>
      <div class="row">
        <div class="col-md-12">
          ${boxOpen("loyalty_events_title", "default")}
            <div id="loyalty-events-table">${escapeHtml(t("loading_ellipsis"))}</div>
          ${boxClose()}
        </div>
      </div>
    </section>`;

  const stateHost = container.querySelector<HTMLElement>("#loyalty-player-state")!;
  const eventsHost = container.querySelector<HTMLElement>("#loyalty-events-table")!;
  const tierSelect = container.querySelector<HTMLSelectElement>("#lo-tier")!;
  const awardForm = container.querySelector<HTMLFormElement>("#loyalty-award-form")!;
  const overrideForm = container.querySelector<HTMLFormElement>("#loyalty-override-form")!;

  void loadState(stateHost, eventsHost, userId);
  void populateTierSelect(tierSelect);

  awardForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submitAward(stateHost, eventsHost, awardForm, userId);
  });

  overrideForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submitOverride(stateHost, eventsHost, overrideForm, userId);
  });
}

async function loadState(
  stateHost: HTMLElement,
  eventsHost: HTMLElement,
  userId: string
): Promise<void> {
  try {
    const { state, events } = await getLoyaltyPlayer(userId);
    stateHost.innerHTML = renderState(state);
    eventsHost.innerHTML = renderEvents(events);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    stateHost.innerHTML = `<div class="callout callout-danger" data-testid="loyalty-player-detail-error">${escapeHtml(msg)}</div>`;
  }
}

function renderState(state: LoyaltyPlayerState): string {
  const tier = state.currentTier
    ? `<span class="label label-primary">${escapeHtml(state.currentTier.name)} (rank ${state.currentTier.rank})</span>`
    : `<span class="label label-default">${escapeHtml(t("loyalty_no_tier"))}</span>`;
  const lock = state.tierLocked
    ? `<i class="fa fa-lock text-warning"></i> ${escapeHtml(t("loyalty_tier_lock_yes"))}`
    : `<span class="text-muted">${escapeHtml(t("loyalty_tier_lock_no"))}</span>`;
  const lastUpdated = state.lastUpdatedAt ? new Date(state.lastUpdatedAt).toLocaleString("nb-NO") : "";
  return `
    <dl class="dl-horizontal" data-testid="loyalty-player-state">
      <dt>${escapeHtml(t("loyalty_player_user_id"))}</dt>
      <dd><code>${escapeHtml(state.userId)}</code></dd>
      <dt>${escapeHtml(t("loyalty_tier_current"))}</dt>
      <dd>${tier}</dd>
      <dt>${escapeHtml(t("loyalty_tier_locked"))}</dt>
      <dd>${lock}</dd>
      <dt>${escapeHtml(t("loyalty_lifetime_points"))}</dt>
      <dd data-testid="loyalty-lifetime-points">${escapeHtml(formatPoints(state.lifetimePoints))}</dd>
      <dt>${escapeHtml(t("loyalty_month_points"))}</dt>
      <dd data-testid="loyalty-month-points">${escapeHtml(formatPoints(state.monthPoints))}</dd>
      <dt>${escapeHtml(t("loyalty_month_key"))}</dt>
      <dd>${escapeHtml(state.monthKey ?? "—")}</dd>
      <dt>${escapeHtml(t("loyalty_last_updated"))}</dt>
      <dd>${escapeHtml(lastUpdated)}</dd>
    </dl>`;
}

function renderEvents(events: LoyaltyEvent[]): string {
  if (events.length === 0) {
    return `<p class="text-muted" data-testid="loyalty-events-empty">${escapeHtml(t("no_data_available_in_table"))}</p>`;
  }
  const rows = events
    .map((ev) => {
      const when = new Date(ev.createdAt).toLocaleString("nb-NO");
      const reason =
        typeof ev.metadata?.reason === "string" ? ev.metadata.reason : "";
      return `
      <tr>
        <td>${escapeHtml(when)}</td>
        <td><code>${escapeHtml(ev.eventType)}</code></td>
        <td>${ev.pointsDelta > 0 ? `+${ev.pointsDelta}` : ev.pointsDelta}</td>
        <td>${escapeHtml(reason)}</td>
        <td>${escapeHtml(ev.createdByUserId ?? "—")}</td>
      </tr>`;
    })
    .join("");
  return `
    <table class="table table-striped" data-testid="loyalty-events-table-body">
      <thead>
        <tr>
          <th>${escapeHtml(t("loyalty_event_when"))}</th>
          <th>${escapeHtml(t("loyalty_event_type"))}</th>
          <th>${escapeHtml(t("loyalty_event_delta"))}</th>
          <th>${escapeHtml(t("loyalty_event_reason"))}</th>
          <th>${escapeHtml(t("loyalty_event_actor"))}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function populateTierSelect(select: HTMLSelectElement): Promise<void> {
  try {
    const { tiers } = await listLoyaltyTiers({ active: true });
    for (const tier of tiers) {
      const opt = document.createElement("option");
      opt.value = tier.id;
      opt.textContent = `${tier.name} (rank ${tier.rank})`;
      select.appendChild(opt);
    }
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(msg);
  }
}

async function submitAward(
  stateHost: HTMLElement,
  eventsHost: HTMLElement,
  form: HTMLFormElement,
  userId: string
): Promise<void> {
  const pointsDelta = Number(form.querySelector<HTMLInputElement>("#lp-delta")!.value);
  const reason = form.querySelector<HTMLInputElement>("#lp-reason")!.value.trim();
  if (!Number.isInteger(pointsDelta) || pointsDelta === 0) {
    Toast.error(t("loyalty_points_delta_nonzero"));
    return;
  }
  if (!reason) {
    Toast.error(t("loyalty_reason_required"));
    return;
  }

  try {
    const result = await awardLoyaltyPoints(userId, { pointsDelta, reason });
    Toast.success(
      result.tierChanged
        ? t("loyalty_points_awarded_tier_changed")
        : t("loyalty_points_awarded")
    );
    form.reset();
    await loadState(stateHost, eventsHost, userId);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(msg);
  }
}

async function submitOverride(
  stateHost: HTMLElement,
  eventsHost: HTMLElement,
  form: HTMLFormElement,
  userId: string
): Promise<void> {
  const tierIdRaw = form.querySelector<HTMLSelectElement>("#lo-tier")!.value;
  const reason = form.querySelector<HTMLInputElement>("#lo-reason")!.value.trim();
  if (!reason) {
    Toast.error(t("loyalty_reason_required"));
    return;
  }
  const tierId: string | null = tierIdRaw === "" ? null : tierIdRaw;

  try {
    await overrideLoyaltyTier(userId, { tierId, reason });
    Toast.success(
      tierId === null
        ? t("loyalty_tier_override_cleared")
        : t("loyalty_tier_override_applied")
    );
    form.reset();
    await loadState(stateHost, eventsHost, userId);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(msg);
  }
}
