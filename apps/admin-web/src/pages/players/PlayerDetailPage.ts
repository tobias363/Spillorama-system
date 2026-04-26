// PR-B2: Player detail — port of
//   legacy/.../player/viewPlayer.html (generic detail)
//   legacy/.../player/ApprovedPlayers/viewPlayer.html (tabbed approved detail)
//
// PM Q1: use the richer ApprovedPlayers/profile-style for approved, but the
// generic viewPlayer always-on fields remain here as the master detail view.
// Tabs: Profile · Audit log · Transactions · Game history · Login history
//       (BIN-629 placeholder) · Chips history (BIN-630 placeholder) ·
//       Cash transactions · Hall status.
//
// We lazy-load each tab; the profile-tab renders the base player data.

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { ApiError } from "../../api/client.js";
import {
  getPlayer,
  type PlayerSummary,
  softDeletePlayer,
  restorePlayer,
} from "../../api/admin-players.js";
import { openApprovePlayerModal } from "./modals/ApprovePlayerModal.js";
import { openRejectPlayerModal } from "./modals/RejectPlayerModal.js";
import { openResubmitPlayerModal } from "./modals/ResubmitPlayerModal.js";
import { openBankIdReverifyModal } from "./modals/BankIdReverifyModal.js";
import { openEditPlayerModal } from "./modals/EditPlayerModal.js";
import {
  contentHeader,
  escapeHtml,
  formatDate,
  formatDateTime,
  hashParam,
  kycBadgeHtml,
} from "./shared.js";
import { Modal } from "../../components/Modal.js";
import { mountProfileTab } from "./tabs/ProfileTab.js";
import { mountAuditTab } from "./tabs/AuditTab.js";
import { mountTransactionsTab } from "./tabs/TransactionsTab.js";
import { mountGameHistoryTab } from "./tabs/GameHistoryTab.js";
import { mountLoginHistoryTab } from "./tabs/LoginHistoryTab.js";
import { mountChipsHistoryTab } from "./tabs/ChipsHistoryTab.js";
import { mountHallStatusTab } from "./tabs/HallStatusTab.js";

export type PlayerDetailMode = "all" | "approved" | "pending" | "rejected";

export interface PlayerDetailOptions {
  mode: PlayerDetailMode;
}

/** Mounts the player detail page. `id` is read from the hash query string. */
export function renderPlayerDetailPage(container: HTMLElement, opts: PlayerDetailOptions): void {
  const id = hashParam("id");
  if (!id) {
    container.innerHTML = `
      ${contentHeader("player_details")}
      <section class="content">
        <div class="box box-danger"><div class="box-body">
          <p>${escapeHtml(t("player_not_found"))}</p>
          <a class="btn btn-primary" href="#/player"><i class="fa fa-arrow-left" aria-hidden="true"></i> ${escapeHtml(t("back"))}</a>
        </div></div>
      </section>`;
    return;
  }

  container.innerHTML = `
    ${contentHeader("player_details")}
    <section class="content">
      <div id="player-detail-root">
        <p class="text-muted">${escapeHtml(t("loading_ellipsis"))}</p>
      </div>
    </section>`;

  const root = container.querySelector<HTMLElement>("#player-detail-root")!;
  void loadAndRender(root, id, opts.mode);
}

async function loadAndRender(
  root: HTMLElement,
  id: string,
  mode: PlayerDetailMode
): Promise<void> {
  try {
    const player = await getPlayer(id);
    renderDetail(root, player, mode);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
    Toast.error(msg);
    root.innerHTML = `<div class="box box-danger"><div class="box-body">${escapeHtml(msg)}</div></div>`;
  }
}

function renderDetail(root: HTMLElement, player: PlayerSummary, mode: PlayerDetailMode): void {
  const backHref =
    mode === "pending"
      ? "#/pendingRequests"
      : mode === "rejected"
        ? "#/rejectedRequests"
        : "#/player";

  root.innerHTML = `
    <div class="row">
      <div class="col-md-12">
        <div class="box box-primary">
          <div class="box-header with-border">
            <h3 class="box-title">
              ${escapeHtml(player.displayName || player.email)}
              ${kycBadgeHtml(player.kycStatus)}
            </h3>
            <div class="pull-right">
              <a href="${backHref}" class="btn btn-default btn-sm">
                <i class="fa fa-arrow-left" aria-hidden="true"></i> ${escapeHtml(t("back"))}
              </a>
            </div>
          </div>
          <div class="box-body">
            <div id="player-action-row" class="btn-toolbar" role="toolbar" style="margin-bottom:12px;"></div>
            <ul class="nav nav-tabs" role="tablist" id="player-tabs">
              <li role="presentation" class="active"><a href="#tab-profile" data-tab="profile" data-toggle="tab">${escapeHtml(t("profile"))}</a></li>
              <li role="presentation"><a href="#tab-audit" data-tab="audit" data-toggle="tab">${escapeHtml(t("audit_log"))}</a></li>
              <li role="presentation"><a href="#tab-tx" data-tab="transactions" data-toggle="tab">${escapeHtml(t("transactions"))}</a></li>
              <li role="presentation"><a href="#tab-game" data-tab="game-history" data-toggle="tab">${escapeHtml(t("game_history"))}</a></li>
              <li role="presentation"><a href="#tab-cash" data-tab="cash" data-toggle="tab">${escapeHtml(t("cash_transaction_history"))}</a></li>
              <li role="presentation"><a href="#tab-login" data-tab="login" data-toggle="tab">${escapeHtml(t("login_history"))}</a></li>
              <li role="presentation"><a href="#tab-chips" data-tab="chips" data-toggle="tab">${escapeHtml(t("chips_history"))}</a></li>
              <li role="presentation"><a href="#tab-hall" data-tab="hall" data-toggle="tab">${escapeHtml(t("hall_status"))}</a></li>
            </ul>
            <div class="tab-content" style="padding:16px 8px;">
              <div role="tabpanel" class="tab-pane active" id="tab-profile"></div>
              <div role="tabpanel" class="tab-pane" id="tab-audit"></div>
              <div role="tabpanel" class="tab-pane" id="tab-tx"></div>
              <div role="tabpanel" class="tab-pane" id="tab-game"></div>
              <div role="tabpanel" class="tab-pane" id="tab-cash"></div>
              <div role="tabpanel" class="tab-pane" id="tab-login"></div>
              <div role="tabpanel" class="tab-pane" id="tab-chips"></div>
              <div role="tabpanel" class="tab-pane" id="tab-hall"></div>
            </div>
            <div class="box-footer text-muted">
              <small>
                <strong>${escapeHtml(t("created_at"))}:</strong> ${escapeHtml(formatDateTime(player.createdAt))}
                &nbsp;·&nbsp;
                <strong>${escapeHtml(t("updated_at"))}:</strong> ${escapeHtml(formatDateTime(player.updatedAt))}
                ${player.kycVerifiedAt ? `&nbsp;·&nbsp;<strong>${escapeHtml(t("verified_at"))}:</strong> ${escapeHtml(formatDateTime(player.kycVerifiedAt))}` : ""}
                ${player.kycProviderRef ? `&nbsp;·&nbsp;<strong>${escapeHtml(t("provider_ref"))}:</strong> ${escapeHtml(player.kycProviderRef)}` : ""}
                &nbsp;·&nbsp;<strong>${escapeHtml(t("date_of_birth"))}:</strong> ${escapeHtml(formatDate(player.birthDate))}
              </small>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  renderActionRow(root, player);
  wireTabs(root, player);
  // render profile tab eagerly
  const profileHost = root.querySelector<HTMLElement>("#tab-profile")!;
  mountProfileTab(profileHost, player);
}

function renderActionRow(root: HTMLElement, player: PlayerSummary): void {
  const host = root.querySelector<HTMLElement>("#player-action-row")!;
  const buttons: string[] = [];

  if (player.kycStatus === "PENDING") {
    buttons.push(
      `<button class="btn btn-success btn-flat" data-action="approve">
         <i class="fa fa-check" aria-hidden="true"></i> ${escapeHtml(t("approve"))}
       </button>`,
      `<button class="btn btn-danger btn-flat" data-action="reject">
         <i class="fa fa-times" aria-hidden="true"></i> ${escapeHtml(t("reject"))}
       </button>`
    );
  }
  if (player.kycStatus === "REJECTED") {
    buttons.push(
      `<button class="btn btn-primary btn-flat" data-action="resubmit">
         <i class="fa fa-refresh" aria-hidden="true"></i> ${escapeHtml(t("yes_resubmit_it"))}
       </button>`
    );
  }
  if (player.kycStatus === "VERIFIED" || player.kycStatus === "REJECTED") {
    buttons.push(
      `<button class="btn btn-warning btn-flat" data-action="bankid-reverify">
         <i class="fa fa-id-card" aria-hidden="true"></i> ${escapeHtml(t("bankid_reverify"))}
       </button>`
    );
  }
  buttons.push(
    `<button class="btn btn-info btn-flat" data-action="edit">
       <i class="fa fa-pencil" aria-hidden="true"></i> ${escapeHtml(t("edit_player"))}
     </button>`,
    `<button class="btn btn-default btn-flat" data-action="soft-delete">
       <i class="fa fa-trash" aria-hidden="true"></i> ${escapeHtml(t("soft_delete_player"))}
     </button>`,
    `<button class="btn btn-default btn-flat" data-action="restore" style="display:none;">
       <i class="fa fa-undo" aria-hidden="true"></i> ${escapeHtml(t("restore_player"))}
     </button>`
  );

  host.innerHTML = buttons.join(" ");

  host.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action!;
    switch (action) {
      case "approve":
        openApprovePlayerModal({
          player,
          onApproved: () => window.location.reload(),
        });
        break;
      case "reject":
        openRejectPlayerModal({
          player,
          onRejected: () => window.location.reload(),
        });
        break;
      case "resubmit":
        openResubmitPlayerModal({
          player,
          onResubmitted: () => window.location.reload(),
        });
        break;
      case "bankid-reverify":
        openBankIdReverifyModal({
          player,
          onReverified: () => window.location.reload(),
        });
        break;
      case "edit":
        openEditPlayerModal({
          player,
          onUpdated: () => window.location.reload(),
        });
        break;
      case "soft-delete":
        confirmSoftDelete(player.id);
        break;
      case "restore":
        confirmRestore(player.id);
        break;
    }
  });
}

function confirmSoftDelete(id: string): void {
  Modal.open({
    title: t("soft_delete_player"),
    content: `<p>${escapeHtml(t("soft_delete_confirm"))}</p>`,
    backdrop: "static",
    keyboard: false,
    buttons: [
      { label: t("no_cancle"), variant: "default", action: "cancel" },
      {
        label: t("yes_approve_it"),
        variant: "danger",
        action: "confirm",
        onClick: async () => {
          try {
            await softDeletePlayer(id);
            Toast.success(t("player_soft_deleted"));
            window.location.reload();
          } catch (err) {
            const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
            Toast.error(msg);
            throw err;
          }
        },
      },
    ],
  });
}

function confirmRestore(id: string): void {
  Modal.open({
    title: t("restore_player"),
    content: `<p>${escapeHtml(t("restore_confirm"))}</p>`,
    backdrop: "static",
    keyboard: false,
    buttons: [
      { label: t("no_cancle"), variant: "default", action: "cancel" },
      {
        label: t("confirm"),
        variant: "primary",
        action: "confirm",
        onClick: async () => {
          try {
            await restorePlayer(id);
            Toast.success(t("player_restored"));
            window.location.reload();
          } catch (err) {
            const msg = err instanceof ApiError ? err.message : t("something_went_wrong");
            Toast.error(msg);
            throw err;
          }
        },
      },
    ],
  });
}

function wireTabs(root: HTMLElement, player: PlayerSummary): void {
  const loaded: Record<string, boolean> = { profile: true };

  const tabLinks = root.querySelectorAll<HTMLAnchorElement>("#player-tabs a[data-tab]");
  tabLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const tab = link.dataset.tab!;

      // visual active-state
      tabLinks.forEach((l) => l.parentElement?.classList.remove("active"));
      link.parentElement?.classList.add("active");

      root.querySelectorAll<HTMLElement>(".tab-pane").forEach((p) => {
        p.classList.remove("active");
      });
      const targetId = link.getAttribute("href")!.slice(1);
      const panel = root.querySelector<HTMLElement>("#" + targetId);
      if (!panel) return;
      panel.classList.add("active");

      // lazy-load
      if (!loaded[tab]) {
        loaded[tab] = true;
        switch (tab) {
          case "audit":
            mountAuditTab(panel, player.id);
            break;
          case "transactions":
            mountTransactionsTab(panel, player.id);
            break;
          case "game-history":
            mountGameHistoryTab(panel, player.id);
            break;
          case "cash":
            mountTransactionsTab(panel, player.id, { onlyCash: true });
            break;
          case "login":
            mountLoginHistoryTab(panel, player.id);
            break;
          case "chips":
            mountChipsHistoryTab(panel, player.id);
            break;
          case "hall":
            mountHallStatusTab(panel, player.id);
            break;
        }
      }
    });
  });
}
