// BIN-720: Profile Settings API-wrappers.
// Mirrors apps/backend/src/routes/userProfile.ts.

import { apiRequest } from "./client.js";

export type SupportedLanguage = "nb-NO" | "en-US";
export type SelfExcludeDuration = "1d" | "7d" | "30d" | "1y" | "permanent";

export interface ProfileSettingsView {
  userId: string;
  walletId: string;
  language: SupportedLanguage;
  hallId: string | null;
  lossLimits: {
    daily: number;
    monthly: number;
    regulatory: { daily: number; monthly: number };
  };
  pendingLossLimits: {
    daily?: { value: number; effectiveAt: string };
    monthly?: { value: number; effectiveAt: string };
  };
  block: {
    blockedUntil: string | null;
    reason: string | null;
    selfExcludedUntil: string | null;
  };
  pause: {
    pausedUntil: string | null;
  };
}

export async function getProfileSettings(): Promise<ProfileSettingsView> {
  return await apiRequest<ProfileSettingsView>("/api/user/profile/settings", {
    method: "GET",
    auth: true,
  });
}

export async function updateLossLimits(input: {
  daily?: number;
  monthly?: number;
}): Promise<ProfileSettingsView> {
  return await apiRequest<ProfileSettingsView>("/api/user/profile/loss-limits", {
    method: "POST",
    auth: true,
    body: input,
  });
}

export async function selfExclude(duration: SelfExcludeDuration): Promise<ProfileSettingsView> {
  return await apiRequest<ProfileSettingsView>("/api/user/profile/self-exclude", {
    method: "POST",
    auth: true,
    body: { duration },
  });
}

export async function setLanguage(language: SupportedLanguage): Promise<ProfileSettingsView> {
  return await apiRequest<ProfileSettingsView>("/api/user/profile/language", {
    method: "POST",
    auth: true,
    body: { language },
  });
}

export async function setPause(durationMinutes: number): Promise<ProfileSettingsView> {
  return await apiRequest<ProfileSettingsView>("/api/user/profile/pause", {
    method: "POST",
    auth: true,
    body: { durationMinutes },
  });
}
