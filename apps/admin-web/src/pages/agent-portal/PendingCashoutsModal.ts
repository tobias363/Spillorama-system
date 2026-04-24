// Wireframe Gap #9 (PDF 17.6): "View Cashout Details"-modal.
//
// Åpnes fra Shift Log Out-popupen for å vise ventende cashouts agenten er
// ansvarlig for. Hver rad viser (dato, spill, mønster, beløp, bong, evt.
// admin-godkjenning). CTA: "Gå til fysisk cashout" navigerer til den
// eksisterende AgentPhysicalCashoutPage via hash-router.
//
// Merk: modalen kalles kun når logout-dialogen allerede er åpen, så den
// stacker seg over. Vi bruker vanlig backdrop (ikke static) for å tillate
// Cancel-X uten å låse.

import { t } from "../../i18n/I18n.js";
import { Modal } from "../../components/Modal.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  agentListPendingCashouts,
  type AgentPendingCashoutSummary,
} from "../../api/agent-shift.js";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatNOK(cents: number): string {
  if (!Number.isFinite(cents)) return "—";
  return (cents / 100).toFixed(2);
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("nb-NO", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function patternLabel(p: string): string {
  // Bruk eksisterende pattern-i18n-keys hvis de finnes.
  const known = ["row_1", "row_2", "row_3", "row_4", "full_house"];
  if (known.includes(p)) {
    return t(`pattern_label_${p}`);
  }
  return p;
}

/**
 * Hovedinngangspunkt. Åpner en modal over eksisterende logout-popup, laster
 * pending cashouts, og rendrer tabell eller "ingen ventende".
 */
export function openPendingCashoutsModal(
  opts: { onNavigateToCashout?: () => void } = {}
): void {
  // Lazy-load: åpner modalen i loading-state først, deretter fyller inn.
  const body = document.createElement("div");
  body.innerHTML = `<p data-marker="pending-loading">${escapeHtml(t("loading_ellipsis"))}</p>`;

  const modal = Modal.open({
    title: t("agent_cash_in_out_pending_cashouts_title"),
    content: body,
    size: "lg",
    buttons: [
      {
        label: t("agent_cash_in_out_goto_physical_cashout"),
        variant: "primary",
        action: "goto-cashout",
        onClick: () => {
          // Navigér til fysisk-cashout-siden. Hash-routing, ingen full reload.
          if (opts.onNavigateToCashout) {
            opts.onNavigateToCashout();
          } else {
            window.location.hash = "#/agent/physical-cashout";
          }
        },
      },
      {
        label: t("agent_cash_in_out_close"),
        variant: "default",
        action: "close",
      },
    ],
  });

  void loadAndRender(body);
  void modal; // hold referansen for TS
}

async function loadAndRender(body: HTMLElement): Promise<void> {
  try {
    const res = await agentListPendingCashouts();
    renderList(body, res.pendingCashouts);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(msg);
    body.innerHTML = `<div class="alert alert-danger" data-marker="pending-error">${escapeHtml(msg)}</div>`;
  }
}

function renderList(body: HTMLElement, items: AgentPendingCashoutSummary[]): void {
  if (items.length === 0) {
    body.innerHTML = `<p class="callout callout-info" data-marker="pending-empty">
      ${escapeHtml(t("agent_cash_in_out_no_pending_cashouts"))}
    </p>`;
    return;
  }
  const rows = items
    .map(
      (item) => `<tr data-id="${escapeHtml(item.id)}">
      <td>${escapeHtml(formatDate(item.detectedAt))}</td>
      <td><code>${escapeHtml(item.scheduledGameId)}</code></td>
      <td>${escapeHtml(patternLabel(item.patternPhase))}</td>
      <td class="text-right">${formatNOK(item.expectedPayoutCents)}</td>
      <td><code>${escapeHtml(item.ticketId)}</code></td>
      <td>${
        item.adminApprovalRequired
          ? `<span class="label label-warning">${escapeHtml(t("agent_cash_in_out_pending_col_admin_approval"))}</span>`
          : ""
      }</td>
    </tr>`
    )
    .join("");
  body.innerHTML = `
    <table class="table table-condensed table-bordered" data-marker="pending-table">
      <thead>
        <tr>
          <th>${escapeHtml(t("agent_cash_in_out_pending_col_detected"))}</th>
          <th>${escapeHtml(t("agent_cash_in_out_pending_col_game"))}</th>
          <th>${escapeHtml(t("agent_cash_in_out_pending_col_pattern"))}</th>
          <th class="text-right">${escapeHtml(t("agent_cash_in_out_pending_col_amount"))}</th>
          <th>${escapeHtml(t("agent_cash_in_out_pending_col_ticket"))}</th>
          <th>${escapeHtml(t("agent_cash_in_out_pending_col_admin_approval"))}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}
