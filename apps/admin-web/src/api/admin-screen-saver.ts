// Fase 1 MVP §24 — admin-screen-saver API-wrappers.
//
// Wireframe-katalog WIREFRAME_CATALOG.md §PDF 14: multi-image carousel for
// hall-TV / dedikerte terminaler. Bilder kan være globale (hallId=null) eller
// per-hall. På/av-toggle + idle-timeout ligger i system-settings-registreret
// (`branding.screen_saver_enabled` + `branding.screen_saver_timeout_minutes`).
// Denne wrapperen håndterer kun bildelisten.
//
// Backend-endpoints (alle ADMIN/SUPPORT for read, ADMIN-only for write):
//   GET    /api/admin/settings/screen-saver
//   POST   /api/admin/settings/screen-saver
//   GET    /api/admin/settings/screen-saver/:id
//   PUT    /api/admin/settings/screen-saver/:id
//   DELETE /api/admin/settings/screen-saver/:id
//   PUT    /api/admin/settings/screen-saver/order            (batch-reorder)
//   PUT    /api/admin/settings/screen-saver/:id/order        (single-reorder)
//
// Cloudinary-upload-flow:
//   Pilot-scope: admin-UI tar URL-input direkte (klient-side opplasting via
//   Cloudinary widget eller manuell URL). Server validerer http(s).

import { apiRequest } from "./client.js";

export interface ScreenSaverImage {
  id: string;
  /** NULL = globalt bilde (alle haller). */
  hallId: string | null;
  imageUrl: string;
  displayOrder: number;
  displaySeconds: number;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ListScreenSaverImagesParams {
  /**
   *   undefined → globale + per-hall (alle bilder)
   *   "null"     → kun globale
   *   string     → kun bilder for én hall (eksakt match)
   */
  hallId?: string | "null";
  activeOnly?: boolean;
  includeDeleted?: boolean;
}

export interface ListScreenSaverImagesResponse {
  images: ScreenSaverImage[];
  count: number;
}

export interface CreateScreenSaverImageBody {
  imageUrl: string;
  hallId?: string | null;
  displayOrder?: number;
  displaySeconds?: number;
  isActive?: boolean;
}

export interface UpdateScreenSaverImageBody {
  imageUrl?: string;
  displayOrder?: number;
  displaySeconds?: number;
  isActive?: boolean;
}

export interface ReorderEntry {
  id: string;
  displayOrder: number;
}

export interface ReorderResponse {
  images: ScreenSaverImage[];
  count: number;
}

/** List screensaver-bilder. Default: alle globale + per-hall. */
export async function listScreenSaverImages(
  params: ListScreenSaverImagesParams = {}
): Promise<ListScreenSaverImagesResponse> {
  const qs = new URLSearchParams();
  if (params.hallId !== undefined) qs.set("hallId", params.hallId);
  if (params.activeOnly) qs.set("activeOnly", "true");
  if (params.includeDeleted) qs.set("includeDeleted", "true");
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiRequest<ListScreenSaverImagesResponse>(
    `/api/admin/settings/screen-saver${suffix}`,
    { auth: true }
  );
}

export async function getScreenSaverImage(id: string): Promise<ScreenSaverImage> {
  return apiRequest<ScreenSaverImage>(
    `/api/admin/settings/screen-saver/${encodeURIComponent(id)}`,
    { auth: true }
  );
}

export async function createScreenSaverImage(
  body: CreateScreenSaverImageBody
): Promise<ScreenSaverImage> {
  return apiRequest<ScreenSaverImage>("/api/admin/settings/screen-saver", {
    method: "POST",
    body,
    auth: true,
  });
}

export async function updateScreenSaverImage(
  id: string,
  body: UpdateScreenSaverImageBody
): Promise<ScreenSaverImage> {
  return apiRequest<ScreenSaverImage>(
    `/api/admin/settings/screen-saver/${encodeURIComponent(id)}`,
    { method: "PUT", body, auth: true }
  );
}

export async function deleteScreenSaverImage(id: string): Promise<{
  deleted: true;
  id: string;
}> {
  return apiRequest<{ deleted: true; id: string }>(
    `/api/admin/settings/screen-saver/${encodeURIComponent(id)}`,
    { method: "DELETE", auth: true }
  );
}

/** Batch-reorder: send hele den nye sorterte listen. */
export async function reorderScreenSaverImages(
  entries: ReorderEntry[]
): Promise<ReorderResponse> {
  return apiRequest<ReorderResponse>("/api/admin/settings/screen-saver/order", {
    method: "PUT",
    body: { entries },
    auth: true,
  });
}
