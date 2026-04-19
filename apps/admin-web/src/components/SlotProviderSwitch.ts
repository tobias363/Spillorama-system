// SlotProviderSwitch — resolve the active slot-machine provider for a hall.
//
// Legacy `cash-inout/cash_in-out.html` has a single "Slot Machine" button.
// The hall-model determines which provider the UI talks to. `slot_provider` is
// not yet a column on `app_halls` (verified in
// `apps/backend/migrations/20260413000001_initial_schema.sql`) — follow-up
// issue BIN-TBD tracks adding it. Until then, halls will resolve to `null`
// and the caller must surface `slot_provider_not_configured` to the user.

import { t } from "../i18n/I18n.js";
import { Toast } from "./Toast.js";
import type { SlotProvider } from "../api/agent-slot.js";

export interface HallLike {
  id: string;
  name?: string;
  /**
   * Value read from `hall.slot_provider`. Currently always `undefined` because
   * the column has not been added yet (see BIN-TBD follow-up).
   */
  slotProvider?: SlotProvider | string | null;
}

/**
 * Returns the resolved provider, or `null` if the hall has none configured.
 * Performs no side-effects — pair with `requireSlotProvider` for the toast flow.
 */
export function resolveSlotProvider(hall: HallLike | null | undefined): SlotProvider | null {
  if (!hall) return null;
  const raw = hall.slotProvider;
  if (raw === "metronia" || raw === "okbingo") return raw;
  return null;
}

/**
 * Returns the resolved provider or `null`, surfacing a toast error when the
 * hall has no provider configured. Use from UI handlers before opening the
 * slot-machine modal.
 */
export function requireSlotProvider(hall: HallLike | null | undefined): SlotProvider | null {
  const provider = resolveSlotProvider(hall);
  if (!provider) {
    Toast.error(t("slot_provider_not_configured"));
    return null;
  }
  return provider;
}

/** Human-readable label for a provider. */
export function slotProviderLabel(provider: SlotProvider): string {
  switch (provider) {
    case "metronia":
      return "Metronia";
    case "okbingo":
      return "OK Bingo";
  }
}

export const SlotProviderSwitch = {
  resolve: resolveSlotProvider,
  require: requireSlotProvider,
  label: slotProviderLabel,
};
