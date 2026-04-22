// ── System settings + maintenance + CMS + FAQ wire schemas ─────────────────
// PR-R3: samlet fra schemas.ts:
//   - BIN-677: System settings + Maintenance
//   - BIN-676: CMS content + FAQ

import { z } from "zod";
import { IsoDateString } from "./_shared.js";

// ── BIN-677: System settings + maintenance wire schemas ─────────────────────
// Mirror av migration `20260425000500_system_settings_maintenance.sql`.
//
// System settings er key-value (se SYSTEM_SETTING_REGISTRY i
// apps/backend/src/admin/SettingsService.ts for kjente nøkler). Ukjente
// nøkler avvises server-side.
//
// Maintenance-vinduer er separate rader; max ett samtidig aktivt vindu
// (håndheves i MaintenanceService).

export const SystemSettingType = z.enum(["string", "number", "boolean", "object"]);
export type SystemSettingTypeT = z.infer<typeof SystemSettingType>;

export const SystemSettingRowSchema = z.object({
  key: z.string().min(1).max(200),
  /** JSONB value — type avhenger av `type`-feltet; valideres av service-laget. */
  value: z.unknown(),
  category: z.string().min(1).max(100),
  description: z.string(),
  type: SystemSettingType,
  /** true hvis verdien kommer fra registry-default (ingen DB-rad eksisterer). */
  isDefault: z.boolean(),
  updatedByUserId: z.string().nullable(),
  updatedAt: IsoDateString.nullable(),
});
export type SystemSettingRow = z.infer<typeof SystemSettingRowSchema>;

export const SystemSettingsListResponseSchema = z.object({
  settings: z.array(SystemSettingRowSchema),
  count: z.number().int().nonnegative(),
});
export type SystemSettingsListResponse = z.infer<
  typeof SystemSettingsListResponseSchema
>;

export const SystemSettingPatchEntrySchema = z.object({
  key: z.string().min(1).max(200),
  value: z.unknown(),
});
export type SystemSettingPatchEntry = z.infer<typeof SystemSettingPatchEntrySchema>;

export const PatchSystemSettingsSchema = z
  .object({
    patches: z.array(SystemSettingPatchEntrySchema).min(1),
  })
  .refine((v) => v.patches.length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type PatchSystemSettingsInput = z.infer<typeof PatchSystemSettingsSchema>;

export const MaintenanceStatus = z.enum(["active", "inactive"]);
export type MaintenanceStatusT = z.infer<typeof MaintenanceStatus>;

export const MaintenanceWindowRowSchema = z.object({
  id: z.string().min(1),
  maintenanceStart: IsoDateString,
  maintenanceEnd: IsoDateString,
  message: z.string(),
  showBeforeMinutes: z.number().int().nonnegative(),
  status: MaintenanceStatus,
  createdByUserId: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
  activatedAt: IsoDateString.nullable(),
  deactivatedAt: IsoDateString.nullable(),
});
export type MaintenanceWindowRow = z.infer<typeof MaintenanceWindowRowSchema>;

export const MaintenanceListResponseSchema = z.object({
  windows: z.array(MaintenanceWindowRowSchema),
  count: z.number().int().nonnegative(),
  /** Kort-referanse til aktivt vindu (om det finnes) for frontend-convenience. */
  active: MaintenanceWindowRowSchema.nullable(),
});
export type MaintenanceListResponse = z.infer<typeof MaintenanceListResponseSchema>;

export const CreateMaintenanceSchema = z.object({
  maintenanceStart: IsoDateString,
  maintenanceEnd: IsoDateString,
  message: z.string().max(2000).optional(),
  showBeforeMinutes: z.number().int().min(0).max(10_080).optional(),
  status: MaintenanceStatus.optional(),
});
export type CreateMaintenanceInput = z.infer<typeof CreateMaintenanceSchema>;

export const UpdateMaintenanceSchema = z
  .object({
    maintenanceStart: IsoDateString.optional(),
    maintenanceEnd: IsoDateString.optional(),
    message: z.string().max(2000).optional(),
    showBeforeMinutes: z.number().int().min(0).max(10_080).optional(),
    status: MaintenanceStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateMaintenanceInput = z.infer<typeof UpdateMaintenanceSchema>;

// ── BIN-676: CMS content + FAQ wire schemas ─────────────────────────────────
// Admin-CRUD for fem statiske sider (aboutus/terms/support/links/responsible-
// gaming) + full FAQ-CRUD. Mirror av migration `20260426000200_cms.sql`.
//
// Slug-whitelist er speilet fra `CmsService.CMS_SLUGS` i backend. Frontend
// bruker enum-varianten slik at UI-valg er i takt med service-validering.
// `responsible-gaming` er regulatorisk-gated (pengespillforskriften §11) —
// PUT returnerer FEATURE_DISABLED inntil BIN-680 lander.
//
// Legacy-opphav:
//   legacy/unity-backend/App/Models/cms.js (singleton-dokument med 5 felter)
//   legacy/unity-backend/App/Models/faq.js

export const CmsSlugSchema = z.enum([
  "aboutus",
  "terms",
  "support",
  "links",
  "responsible-gaming",
]);
export type CmsSlug = z.infer<typeof CmsSlugSchema>;

export const CmsContentSchema = z.object({
  slug: CmsSlugSchema,
  /** Rå tekst-innhold (HTML/markdown). Max 200k tegn. */
  content: z.string().max(200_000),
  updatedByUserId: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type CmsContentRow = z.infer<typeof CmsContentSchema>;

export const UpdateCmsContentSchema = z.object({
  content: z.string().max(200_000),
});
export type UpdateCmsContentInput = z.infer<typeof UpdateCmsContentSchema>;

export const FaqEntrySchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1).max(1_000),
  answer: z.string().min(1).max(10_000),
  sortOrder: z.number().int().nonnegative(),
  createdByUserId: z.string().nullable(),
  updatedByUserId: z.string().nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type FaqEntryRow = z.infer<typeof FaqEntrySchema>;

export const CreateFaqSchema = z.object({
  question: z.string().min(1).max(1_000),
  answer: z.string().min(1).max(10_000),
  sortOrder: z.number().int().nonnegative().optional(),
});
export type CreateFaqInput = z.infer<typeof CreateFaqSchema>;

export const UpdateFaqSchema = z
  .object({
    question: z.string().min(1).max(1_000).optional(),
    answer: z.string().min(1).max(10_000).optional(),
    sortOrder: z.number().int().nonnegative().optional(),
  })
  .refine((v: Record<string, unknown>) => Object.keys(v).length > 0, {
    message: "Ingen endringer oppgitt.",
  });
export type UpdateFaqInput = z.infer<typeof UpdateFaqSchema>;

export const FaqListResponseSchema = z.object({
  faqs: z.array(FaqEntrySchema),
  count: z.number().int().nonnegative(),
});
export type FaqListResponse = z.infer<typeof FaqListResponseSchema>;
