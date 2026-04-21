// PR-B6 (BIN-664) — Blocked-IP add/edit modal.
// as a Bootstrap modal rather than a dedicated page — matches the emails
// pattern in PR-B4 and avoids a second route.
//
// Edit = DELETE + POST (GAP-G1). Two audit-events is MORE traceable than
// one in-place PATCH. Backend has no PATCH endpoint.
//
// Regulatorisk:
//   - SECURITY_WRITE gate enforced by backend (adminSecurity.ts:237)
//   - Client IP-validation is UX only; backend normalises + rejects bogus
//   - Fail-closed: API error → Toast.error, modal stays open for retry

import { t } from "../../i18n/I18n.js";
import { Toast } from "../../components/Toast.js";
import { Modal } from "../../components/Modal.js";
import { ApiError } from "../../api/client.js";
import {
  addBlockedIp,
  deleteBlockedIp,
  type BlockedIp,
} from "../../api/admin-security-blocked-ips.js";
import { escapeHtml, isValidIpLike } from "./shared.js";

/**
 * Open the add-or-edit modal for blocked IPs.
 *
 * @param existing - `null` for add, existing row for edit (delete + re-add).
 * @param onDone - fires after successful submit so caller can refresh.
 */
export function openAddBlockedIpModal(
  existing: BlockedIp | null,
  onDone: () => void
): void {
  const isEdit = existing !== null;
  const form = document.createElement("form");
  form.className = "form-horizontal";
  form.setAttribute(
    "data-testid",
    isEdit ? "edit-blocked-ip-form" : "add-blocked-ip-form"
  );
  form.innerHTML = `
    <div class="form-group">
      <label class="col-sm-4 control-label" for="bip-ip">${escapeHtml(t("ip_address"))}</label>
      <div class="col-sm-8">
        <input type="text" id="bip-ip" name="ipAddress" class="form-control" required
          placeholder="192.0.2.1"
          value="${escapeHtml(existing?.ipAddress ?? "")}">
      </div>
    </div>
    <div class="form-group">
      <label class="col-sm-4 control-label" for="bip-reason">${escapeHtml(t("reason"))}</label>
      <div class="col-sm-8">
        <input type="text" id="bip-reason" name="reason" class="form-control"
          value="${escapeHtml(existing?.reason ?? "")}">
      </div>
    </div>
    <div class="form-group">
      <label class="col-sm-4 control-label" for="bip-expires">${escapeHtml(t("expires_at"))}</label>
      <div class="col-sm-8">
        <input type="date" id="bip-expires" name="expiresAt" class="form-control"
          value="${escapeHtml(existing?.expiresAt ? existing.expiresAt.slice(0, 10) : "")}">
      </div>
    </div>`;

  const instance = Modal.open({
    title: isEdit ? t("edit_blocked_ip") : t("add_blocked_ip"),
    content: form,
    size: "lg",
    buttons: [
      { label: t("cancel_button"), variant: "default", action: "cancel" },
      {
        label: t("submit"),
        variant: "success",
        action: "submit",
        dismiss: false,
        onClick: async () => {
          const ipEl = form.querySelector<HTMLInputElement>("#bip-ip")!;
          const reasonEl = form.querySelector<HTMLInputElement>("#bip-reason")!;
          const expiresEl = form.querySelector<HTMLInputElement>("#bip-expires")!;

          const ipAddress = ipEl.value.trim();
          if (!ipAddress || !isValidIpLike(ipAddress)) {
            Toast.error(t("ip_address"));
            return;
          }
          const reason = reasonEl.value.trim();
          const expiresInput = expiresEl.value.trim();
          // date input → ISO timestamp at end-of-day UTC for backend.
          const expiresAt = expiresInput
            ? new Date(`${expiresInput}T23:59:59.000Z`).toISOString()
            : null;

          try {
            if (isEdit && existing) {
              // Edit = delete + re-add. See module header.
              await deleteBlockedIp(existing.id);
            }
            await addBlockedIp({
              ipAddress,
              reason: reason || null,
              expiresAt,
            });
            Toast.success(isEdit ? t("edit_blocked_ip") : t("add_blocked_ip"));
            instance.close("button");
            onDone();
          } catch (err) {
            Toast.error(
              err instanceof ApiError ? err.message : t("something_went_wrong")
            );
          }
        },
      },
    ],
  });
}
