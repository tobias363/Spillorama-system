// PR-PT6 — Pending payouts-side (PT4).
//
// Lister fysiske-bong-pending payouts per spill eller bruker, og tilbyr:
//   - "Verifiser"               → verify med scan
//   - "Admin-godkjenning"       → admin-approve (kun ADMIN, ≥ 5000 kr)
//   - "Bekreft utbetaling"      → confirm-payout (etter verifisert)
//   - "Avvis"                   → reject med grunn
//
// Socket: lytter til `game1:physical-ticket-won` på /admin-game1-namespace.
// Toast + auto-reload når vi er subscribed til et gameId (admin velger game-ID
// i toolbar). For bruker-scope er socket-auto-reload ikke aktiv — admin må
// manuelt trykke refresh.

import { t } from "../../i18n/I18n.js";
import { getSession } from "../../auth/Session.js";
import { Modal } from "../../components/Modal.js";
import { Toast } from "../../components/Toast.js";
import { DataTable } from "../../components/DataTable.js";
import {
  listPendingPayouts,
  verifyPendingPayout,
  adminApprovePendingPayout,
  confirmPendingPayout,
  rejectPendingPayout,
  type PhysicalTicketPendingPayoutRow,
} from "../../api/admin-physical-tickets.js";
import { mapPhysicalTicketErrorMessage } from "./errorMap.js";
import { boxClose, boxOpen, contentHeader, escapeHtml, formatNOK } from "./shared.js";
import {
  connectPhysicalTicketWonSocket,
  type PhysicalTicketWonPayload,
  type PhysicalTicketWonSocketHandle,
} from "./physicalTicketWonSocket.js";

const ADMIN_APPROVAL_THRESHOLD_CENTS = 500_000;

interface PageState {
  pending: PhysicalTicketPendingPayoutRow[];
  scope: { gameId?: string; userId?: string };
  loading: boolean;
  socket: PhysicalTicketWonSocketHandle | null;
}

export interface RenderPendingPayoutsPageOptions {
  /** Test-hook: bytte ut socket-factory for komponent-tester. */
  _socketFactory?: (
    gameId: string,
    onWon: (payload: PhysicalTicketWonPayload) => void,
  ) => PhysicalTicketWonSocketHandle;
}

export function renderPendingPayoutsPage(
  container: HTMLElement,
  opts: RenderPendingPayoutsPageOptions = {},
): () => void {
  const session = getSession();
  const isAdmin = session?.role === "admin" || session?.role === "super-admin";

  const state: PageState = {
    pending: [],
    scope: {},
    loading: false,
    socket: null,
  };

  container.innerHTML = `
    ${contentHeader("pt_pending_payouts_title")}
    <section class="content">
      ${boxOpen("pt_pending_payouts_title", "primary")}
        <form id="pp-scope-form" class="form-inline" style="margin-bottom:10px;" novalidate>
          <div class="form-group" style="margin-right:10px;">
            <label for="pp-gameId" style="margin-right:6px;">${escapeHtml(t("pt_game_id"))}</label>
            <input id="pp-gameId" class="form-control" type="text" autocomplete="off"
              placeholder="${escapeHtml(t("pt_game_id_hint"))}" style="width:260px;">
          </div>
          <div class="form-group" style="margin-right:10px;">
            <label for="pp-userId" style="margin-right:6px;">${escapeHtml(t("pt_user_id"))}</label>
            <input id="pp-userId" class="form-control" type="text" autocomplete="off"
              placeholder="${escapeHtml(t("pt_user_id_hint"))}" style="width:220px;">
          </div>
          <button type="submit" class="btn btn-primary btn-sm" data-action="search">
            <i class="fa fa-search" aria-hidden="true"></i> ${escapeHtml(t("search"))}
          </button>
          <button type="button" class="btn btn-default btn-sm" id="pp-refresh" data-action="refresh" style="margin-left:6px;">
            <i class="fa fa-refresh" aria-hidden="true"></i> ${escapeHtml(t("refresh"))}
          </button>
          <span id="pp-socket-state" style="margin-left:12px;font-size:12px;color:#888;"></span>
        </form>
        <div id="pp-table" aria-live="polite">
          <div class="callout callout-info" style="margin:0;">${escapeHtml(t("pt_pending_select_scope"))}</div>
        </div>
      ${boxClose()}
    </section>`;

  const form = container.querySelector<HTMLFormElement>("#pp-scope-form")!;
  const gameIdInput = container.querySelector<HTMLInputElement>("#pp-gameId")!;
  const userIdInput = container.querySelector<HTMLInputElement>("#pp-userId")!;
  const refreshBtn = container.querySelector<HTMLButtonElement>("#pp-refresh")!;
  const tableHost = container.querySelector<HTMLElement>("#pp-table")!;
  const socketState = container.querySelector<HTMLElement>("#pp-socket-state")!;

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const gameId = (gameIdInput.value || "").trim();
    const userId = (userIdInput.value || "").trim();
    if (!gameId && !userId) {
      Toast.error(t("pt_err_scope_required"));
      return;
    }
    state.scope = {
      gameId: gameId || undefined,
      userId: userId || undefined,
    };
    void refresh();
    setupSocket(gameId || null);
  });

  refreshBtn.addEventListener("click", () => void refresh());

  async function refresh(): Promise<void> {
    if (!state.scope.gameId && !state.scope.userId) return;
    state.loading = true;
    tableHost.textContent = t("loading_ellipsis");
    try {
      const res = await listPendingPayouts(state.scope);
      state.pending = res.pending;
      renderTable();
    } catch (err) {
      const msg = mapPhysicalTicketErrorMessage(err);
      Toast.error(msg);
      tableHost.innerHTML = `<div class="callout callout-danger" style="margin:0;">${escapeHtml(msg)}</div>`;
    } finally {
      state.loading = false;
    }
  }

  function setupSocket(gameId: string | null): void {
    // Tear down any existing socket before creating new one.
    state.socket?.dispose();
    state.socket = null;
    if (!gameId) {
      socketState.textContent = "";
      return;
    }
    socketState.textContent = t("pt_socket_connecting");
    const factory = opts._socketFactory ?? connectPhysicalTicketWonSocket;
    state.socket = factory(gameId, (payload) => {
      if (payload.gameId !== gameId) return;
      Toast.warning(
        t("pt_socket_won_toast", {
          ticketId: payload.ticketId,
          amount: formatNOK(payload.expectedPayoutCents),
        }),
      );
      void refresh();
    });
    state.socket.onConnectionChange((connected) => {
      socketState.textContent = connected
        ? t("pt_socket_connected")
        : t("pt_socket_disconnected");
    });
  }

  function renderTable(): void {
    if (state.pending.length === 0) {
      tableHost.innerHTML = `<div class="callout callout-info" style="margin:0;">${escapeHtml(t("pt_pending_empty"))}</div>`;
      return;
    }
    DataTable.mount<PhysicalTicketPendingPayoutRow>(tableHost, {
      columns: [
        {
          key: "ticketId",
          title: t("pt_pending_ticket_id"),
          render: (p) => {
            const el = document.createElement("code");
            el.textContent = p.ticketId;
            return el;
          },
        },
        {
          key: "patternPhase",
          title: t("pt_pending_pattern"),
          render: (p) => escapeHtml(t(patternKey(p.patternPhase))),
        },
        { key: "hallId", title: t("pt_pending_hall") },
        { key: "color", title: t("pt_ticket_color") },
        {
          key: "expectedPayoutCents",
          title: t("pt_pending_expected_payout"),
          align: "right",
          render: (p) => formatNOK(p.expectedPayoutCents),
        },
        {
          key: "verifiedAt",
          title: t("pt_pending_status"),
          render: (p) => renderStatusCell(p),
        },
        {
          key: "id",
          title: t("action"),
          align: "center",
          render: (p) => renderActionCell(p, isAdmin),
        },
      ],
      rows: state.pending,
      emptyMessage: t("pt_pending_empty"),
    });
  }

  tableHost.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    if (!id) return;
    const action = btn.getAttribute("data-action");
    const pending = state.pending.find((p) => p.id === id);
    if (!pending) return;
    if (action === "verify") openVerifyModal(pending, refresh);
    else if (action === "admin-approve") openAdminApproveModal(pending, refresh);
    else if (action === "confirm-payout") openConfirmPayoutModal(pending, refresh);
    else if (action === "reject") openRejectModal(pending, refresh);
  });

  return () => {
    state.socket?.dispose();
    state.socket = null;
  };
}

function patternKey(pattern: PhysicalTicketPendingPayoutRow["patternPhase"]): string {
  switch (pattern) {
    case "row_1":
      return "pt_pattern_row_1";
    case "row_2":
      return "pt_pattern_row_2";
    case "row_3":
      return "pt_pattern_row_3";
    case "row_4":
      return "pt_pattern_row_4";
    case "full_house":
      return "pt_pattern_full_house";
    default:
      return String(pattern);
  }
}

function renderStatusCell(p: PhysicalTicketPendingPayoutRow): Node {
  const el = document.createElement("div");
  el.style.cssText = "display:flex;flex-direction:column;gap:2px;font-size:12px;";
  if (p.rejectedAt) {
    el.innerHTML = `<span style="color:#c62828;"><i class="fa fa-ban" aria-hidden="true"></i> ${escapeHtml(t("pt_pending_status_rejected"))}</span>`;
    return el;
  }
  if (p.paidOutAt) {
    el.innerHTML = `<span style="color:#2e7d32;"><i class="fa fa-check" aria-hidden="true"></i> ${escapeHtml(t("pt_pending_status_paid"))}</span>`;
    return el;
  }
  const parts: string[] = [];
  if (p.verifiedAt) {
    parts.push(`<span style="color:#2e7d32;"><i class="fa fa-check" aria-hidden="true"></i> ${escapeHtml(t("pt_pending_status_verified"))}</span>`);
  } else {
    parts.push(`<span style="color:#ef6c00;"><i class="fa fa-clock-o" aria-hidden="true"></i> ${escapeHtml(t("pt_pending_status_unverified"))}</span>`);
  }
  if (p.adminApprovalRequired) {
    if (p.adminApprovedAt) {
      parts.push(`<span style="color:#2e7d32;"><i class="fa fa-shield" aria-hidden="true"></i> ${escapeHtml(t("pt_pending_status_admin_approved"))}</span>`);
    } else {
      parts.push(`<span style="color:#c62828;"><i class="fa fa-shield" aria-hidden="true"></i> ${escapeHtml(t("pt_pending_status_admin_required"))}</span>`);
    }
  }
  el.innerHTML = parts.join("");
  return el;
}

function renderActionCell(
  p: PhysicalTicketPendingPayoutRow,
  isAdmin: boolean,
): Node {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:inline-flex;gap:4px;flex-wrap:wrap;";
  const mk = (
    action: string,
    labelKey: string,
    variant: string,
    icon: string,
    disabled = false,
  ): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn btn-${variant} btn-xs`;
    b.innerHTML = `<i class="fa fa-${icon}" aria-hidden="true"></i> ${escapeHtml(t(labelKey))}`;
    b.setAttribute("data-action", action);
    b.setAttribute("data-id", p.id);
    if (disabled) b.disabled = true;
    return b;
  };
  const isTerminal = Boolean(p.rejectedAt || p.paidOutAt);
  const canVerify = !isTerminal && !p.verifiedAt;
  const canAdminApprove = !isTerminal
    && p.verifiedAt
    && p.adminApprovalRequired
    && !p.adminApprovedAt;
  const needsApproval = p.adminApprovalRequired && !p.adminApprovedAt;
  const canConfirm = !isTerminal && p.verifiedAt && !needsApproval;
  const canReject = !isTerminal;

  wrap.append(mk("verify", "pt_action_verify", "primary", "qrcode", !canVerify));
  if (isAdmin) {
    wrap.append(
      mk(
        "admin-approve",
        "pt_action_admin_approve",
        "warning",
        "shield",
        !canAdminApprove,
      ),
    );
  }
  wrap.append(
    mk(
      "confirm-payout",
      "pt_action_confirm_payout",
      "success",
      "money",
      !canConfirm,
    ),
  );
  wrap.append(mk("reject", "pt_action_reject", "danger", "ban", !canReject));
  return wrap;
}

function openVerifyModal(
  p: PhysicalTicketPendingPayoutRow,
  onDone: () => Promise<void> | void,
): void {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <p>${escapeHtml(t("pt_verify_desc"))}</p>
    <div class="form-group">
      <label>${escapeHtml(t("pt_pending_expected_payout"))}</label>
      <div class="form-control" style="background:#f5f5f5;">${formatNOK(p.expectedPayoutCents)}</div>
    </div>
    <div class="form-group">
      <label for="vf-scanned">${escapeHtml(t("pt_verify_scanned_ticket"))}</label>
      <input id="vf-scanned" class="form-control" type="text" autocomplete="off" required
        placeholder="${escapeHtml(t("pt_verify_scanned_ticket_hint"))}">
    </div>`;
  Modal.open({
    title: t("pt_action_verify"),
    content: wrap,
    buttons: [
      { label: t("cancel_button"), variant: "default", action: "cancel" },
      {
        label: t("submit"),
        variant: "primary",
        action: "confirm",
        onClick: async (instance) => {
          const scannedTicketId = (wrap.querySelector<HTMLInputElement>("#vf-scanned")!.value || "").trim();
          if (!scannedTicketId) {
            Toast.error(t("pt_err_scanned_required"));
            return;
          }
          try {
            const res = await verifyPendingPayout(p.id, { scannedTicketId });
            if (res.needsAdminApproval) {
              Toast.warning(t("pt_verify_needs_admin"));
            } else {
              Toast.success(t("pt_verify_success"));
            }
            await onDone();
            instance.close("programmatic");
          } catch (err) {
            Toast.error(mapPhysicalTicketErrorMessage(err));
          }
        },
      },
    ],
  });
}

function openAdminApproveModal(
  p: PhysicalTicketPendingPayoutRow,
  onDone: () => Promise<void> | void,
): void {
  Modal.open({
    title: t("pt_action_admin_approve"),
    content: `<p>${escapeHtml(t("pt_admin_approve_desc"))}</p>
      <p><strong>${escapeHtml(t("pt_pending_ticket_id"))}:</strong> <code>${escapeHtml(p.ticketId)}</code></p>
      <p><strong>${escapeHtml(t("pt_pending_expected_payout"))}:</strong> ${formatNOK(p.expectedPayoutCents)}</p>
      <p class="text-warning">${escapeHtml(
        t("pt_admin_approve_threshold_warn", {
          threshold: formatNOK(ADMIN_APPROVAL_THRESHOLD_CENTS),
        }),
      )}</p>`,
    backdrop: "static",
    keyboard: false,
    buttons: [
      { label: t("cancel_button"), variant: "default", action: "cancel" },
      {
        label: t("pt_confirm_admin_approve"),
        variant: "warning",
        action: "confirm",
        onClick: async (instance) => {
          try {
            await adminApprovePendingPayout(p.id);
            Toast.success(t("pt_admin_approve_success"));
            await onDone();
            instance.close("programmatic");
          } catch (err) {
            Toast.error(mapPhysicalTicketErrorMessage(err));
          }
        },
      },
    ],
  });
}

function openConfirmPayoutModal(
  p: PhysicalTicketPendingPayoutRow,
  onDone: () => Promise<void> | void,
): void {
  Modal.open({
    title: t("pt_action_confirm_payout"),
    content: `<p>${escapeHtml(t("pt_confirm_payout_desc"))}</p>
      <p><strong>${escapeHtml(t("pt_pending_ticket_id"))}:</strong> <code>${escapeHtml(p.ticketId)}</code></p>
      <p><strong>${escapeHtml(t("pt_pending_expected_payout"))}:</strong> ${formatNOK(p.expectedPayoutCents)}</p>`,
    backdrop: "static",
    keyboard: false,
    buttons: [
      { label: t("cancel_button"), variant: "default", action: "cancel" },
      {
        label: t("pt_confirm_payout_button"),
        variant: "success",
        action: "confirm",
        onClick: async (instance) => {
          try {
            const res = await confirmPendingPayout(p.id);
            Toast.success(
              t("pt_confirm_payout_success", {
                amount: formatNOK(res.paidOutAmountCents),
              }),
            );
            await onDone();
            instance.close("programmatic");
          } catch (err) {
            Toast.error(mapPhysicalTicketErrorMessage(err));
          }
        },
      },
    ],
  });
}

function openRejectModal(
  p: PhysicalTicketPendingPayoutRow,
  onDone: () => Promise<void> | void,
): void {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <p>${escapeHtml(t("pt_reject_desc"))}</p>
    <p><strong>${escapeHtml(t("pt_pending_ticket_id"))}:</strong> <code>${escapeHtml(p.ticketId)}</code></p>
    <div class="form-group">
      <label for="rj-reason">${escapeHtml(t("pt_reject_reason"))}</label>
      <textarea id="rj-reason" class="form-control" rows="3" required
        placeholder="${escapeHtml(t("pt_reject_reason_hint"))}"></textarea>
    </div>`;
  Modal.open({
    title: t("pt_action_reject"),
    content: wrap,
    backdrop: "static",
    keyboard: false,
    buttons: [
      { label: t("cancel_button"), variant: "default", action: "cancel" },
      {
        label: t("pt_confirm_reject"),
        variant: "danger",
        action: "confirm",
        onClick: async (instance) => {
          const reason = (wrap.querySelector<HTMLTextAreaElement>("#rj-reason")!.value || "").trim();
          if (!reason) {
            Toast.error(t("pt_err_reason_required"));
            return;
          }
          try {
            await rejectPendingPayout(p.id, { reason });
            Toast.success(t("pt_reject_success"));
            await onDone();
            instance.close("programmatic");
          } catch (err) {
            Toast.error(mapPhysicalTicketErrorMessage(err));
          }
        },
      },
    ],
  });
}
