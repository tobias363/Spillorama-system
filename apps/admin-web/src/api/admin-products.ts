// PR-B5 (BIN-660) — admin product/category/hall-products API wrappers.
// Thin wrappers around `apps/backend/src/routes/adminProducts.ts`
// (see file header for the full endpoint matrix).
//
// Envelope: apiRequest unwraps `{ ok, data }`. Category/product list
// endpoints return `{ items, count }`, so list wrappers unwrap `.items`
// here so callers get `T[]` like the wallet API.

import { apiRequest } from "./client.js";

// ── Shared types (mirror backend/ProductService.ts) ────────────────────────

export type ProductStatus = "ACTIVE" | "INACTIVE";

export interface ProductCategory {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  categoryId: string | null;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
}

export interface HallProduct {
  hallId: string;
  productId: string;
  isActive: boolean;
  addedAt: string;
  addedBy: string | null;
  product: Product;
}

export interface Hall {
  id: string;
  slug: string;
  name: string;
  region?: string;
  address?: string;
  isActive: boolean;
}

// Backend wraps list payloads in `{ items, count }` style envelopes.
interface CategoryListEnvelope {
  categories: ProductCategory[];
  count: number;
}

interface ProductListEnvelope {
  products: Product[];
  count: number;
}

interface HallProductsEnvelope {
  hallId: string;
  products: HallProduct[];
  count: number;
}

// ── Categories ─────────────────────────────────────────────────────────────

export function listCategories(
  opts: { includeInactive?: boolean } = {}
): Promise<ProductCategory[]> {
  const q = opts.includeInactive ? "?includeInactive=1" : "";
  return apiRequest<CategoryListEnvelope>(
    `/api/admin/product-categories${q}`,
    { auth: true }
  ).then((r) => r.categories);
}

export function createCategory(input: {
  name: string;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<ProductCategory> {
  return apiRequest<ProductCategory>("/api/admin/product-categories", {
    method: "POST",
    body: input,
    auth: true,
  });
}

export function updateCategory(
  id: string,
  input: { name?: string; sortOrder?: number; isActive?: boolean }
): Promise<ProductCategory> {
  return apiRequest<ProductCategory>(
    `/api/admin/product-categories/${encodeURIComponent(id)}`,
    { method: "PUT", body: input, auth: true }
  );
}

export function deleteCategory(id: string): Promise<{ deleted: true }> {
  return apiRequest<{ deleted: true }>(
    `/api/admin/product-categories/${encodeURIComponent(id)}`,
    { method: "DELETE", auth: true }
  );
}

// ── Products ───────────────────────────────────────────────────────────────

export function listProducts(
  filter: { categoryId?: string; status?: ProductStatus } = {}
): Promise<Product[]> {
  const params = new URLSearchParams();
  if (filter.categoryId) params.set("categoryId", filter.categoryId);
  if (filter.status) params.set("status", filter.status);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<ProductListEnvelope>(`/api/admin/products${suffix}`, {
    auth: true,
  }).then((r) => r.products);
}

export function getProduct(id: string): Promise<Product> {
  return apiRequest<Product>(`/api/admin/products/${encodeURIComponent(id)}`, {
    auth: true,
  });
}

export function createProduct(input: {
  name: string;
  priceCents: number;
  categoryId?: string;
  description?: string;
  status?: ProductStatus;
}): Promise<Product> {
  return apiRequest<Product>("/api/admin/products", {
    method: "POST",
    body: input,
    auth: true,
  });
}

export function updateProduct(
  id: string,
  input: {
    name?: string;
    priceCents?: number;
    categoryId?: string | null;
    description?: string | null;
    status?: ProductStatus;
  }
): Promise<Product> {
  return apiRequest<Product>(`/api/admin/products/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: input,
    auth: true,
  });
}

export function deleteProduct(id: string): Promise<{ deleted: true }> {
  return apiRequest<{ deleted: true }>(
    `/api/admin/products/${encodeURIComponent(id)}`,
    { method: "DELETE", auth: true }
  );
}

// ── Hall products ──────────────────────────────────────────────────────────

export function listHallProducts(
  hallId: string,
  opts: { activeOnly?: boolean } = {}
): Promise<HallProduct[]> {
  const q = opts.activeOnly === false ? "?activeOnly=0" : "";
  return apiRequest<HallProductsEnvelope>(
    `/api/admin/halls/${encodeURIComponent(hallId)}/products${q}`,
    { auth: true }
  ).then((r) => r.products);
}

export function setHallProducts(
  hallId: string,
  productIds: string[]
): Promise<{ hallId: string; added: number; removed: number; total: number }> {
  return apiRequest<{
    hallId: string;
    added: number;
    removed: number;
    total: number;
  }>(`/api/admin/halls/${encodeURIComponent(hallId)}/products`, {
    method: "PUT",
    body: { productIds },
    auth: true,
  });
}

// ── Halls (minimal — list only, for selector) ──────────────────────────────

export function listHalls(): Promise<Hall[]> {
  return apiRequest<Hall[]>("/api/admin/halls", { auth: true });
}
