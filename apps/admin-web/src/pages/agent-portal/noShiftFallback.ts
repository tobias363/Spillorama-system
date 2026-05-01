// Shared "no active shift"-banner for agent-portal sider som krever en åpen
// shift på backend. Når agenten logger inn UTEN aktiv shift og navigerer
// til en av disse sidene returnerer backend 400 NO_ACTIVE_SHIFT eller
// SHIFT_NOT_ACTIVE — vi viser et banner med en "Åpne skift"-knapp som
// kaller POST /api/agent/shift/start med agentens primary-hall.
//
// Mønsteret matcher det som ble innført på agent-dashboard i PR #793
// (AgentDashboardPage.ts:441-510) — samme i18n-nøkler, samme look-and-feel.
//
// Bug #5 fra docs/audit/BUG_WALKTHROUGH_2026-05-01.md.

import { ApiError } from "../../api/client.js";
import { startShift } from "../../api/agent-shift.js";
import { getSession } from "../../auth/Session.js";
import { Toast } from "../../components/Toast.js";
import { t } from "../../i18n/I18n.js";
import { escapeHtml } from "../../utils/escapeHtml.js";

/** Backend-error-kodene som signaliserer "ingen åpen shift". */
const NO_SHIFT_CODES = new Set(["NO_ACTIVE_SHIFT", "SHIFT_NOT_ACTIVE"]);

/**
 * True hvis feilen er 400 NO_ACTIVE_SHIFT / SHIFT_NOT_ACTIVE fra agent-API-et.
 * Andre 400-er (validering, etc.) skal fortsatt vises som vanlige feil.
 */
export function isNoShiftError(err: unknown): boolean {
  return err instanceof ApiError && NO_SHIFT_CODES.has(err.code);
}

/**
 * Render no-shift-banneret inni `container` og wirer "Åpne skift"-knappen.
 * Etter vellykket shift-start kalles `onStartSuccess` slik at den
 * kallende siden kan re-laste data uten full page-reload.
 *
 * Banneret er identisk visuelt med dashboard-banneret (PR #793) — gul
 * alert med tekst til venstre + grønn knapp til høyre.
 */
export function renderNoShiftBanner(
  container: HTMLElement,
  onStartSuccess: () => void,
): void {
  container.innerHTML = `
    <section class="content-header">
      <h1>${escapeHtml(t("agent_dashboard"))}</h1>
    </section>
    <section class="content">
      <div class="alert alert-warning" data-marker="agent-page-no-shift" role="alert"
           style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
        <div>
          <i class="fa fa-info-circle" aria-hidden="true"></i>
          ${escapeHtml(t("agent_dashboard_no_shift_warning"))}
        </div>
        <button class="btn btn-success" data-action="open-shift"
                data-marker="agent-page-open-shift-button"
                style="font-weight:600;">
          <i class="fa fa-play" aria-hidden="true"></i>
          ${escapeHtml(t("agent_dashboard_start_shift"))}
        </button>
      </div>
    </section>`;

  const btn = container.querySelector<HTMLButtonElement>(
    'button[data-action="open-shift"]',
  );
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const session = getSession();
    const hallId = session?.hall?.[0]?.id;
    if (!hallId) {
      Toast.error(t("hall_not_assigned") || "Ingen hall tildelt på sesjonen.");
      return;
    }
    btn.disabled = true;
    try {
      // Backend bruker bare hallId; openingBalance kreves av TS-signaturen
      // men ignoreres serverside (jf. apps/backend/src/routes/agent.ts:286).
      await startShift({ hallId, openingBalance: 0 });
      Toast.success(
        t("shift_started_successfully") || "Skift åpnet — laster siden …",
      );
      onStartSuccess();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : t("something_went_wrong");
      Toast.error(msg);
      btn.disabled = false;
    }
  });
}
