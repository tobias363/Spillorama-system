// PR-B6 (BIN-664) — admin risk-country API wrappers.
// Thin wrappers around `apps/backend/src/routes/adminSecurity.ts` for
// port av legacy `riskCountry/riskCountry.html`.
//
// Menypunktet lever under `/riskCountry` i admin-web (matcher legacy
// riskCountry/riskCountry.html), men selve endepunktet ligger under
// /api/admin/security/risk-countries for at backend-modularisering
// speiler pengespillforskriften-domenet "security" fremfor legacy-meny.
//
// Permissions:
//   - list:   SECURITY_READ  (ADMIN, HALL_OPERATOR, SUPPORT)
//   - add/del: SECURITY_WRITE (ADMIN kun)
//
// AML-compliance: risk-country-lista brukes av BankID-verifisering
// (BIN-587 B2) for å flagge innbyggere fra FATF high-risk jurisdictions
// og EU-listen. UI er ren CRUD; policy-ansvar å holde listen oppdatert
// er utenfor scope for denne frontend-porten.
//
// Regulatorisk: Alle mutasjoner audit-logges av backend via fireAudit()
// — se adminSecurity.ts:187-218.

import { apiRequest } from "./client.js";

export interface RiskCountry {
  countryCode: string;
  label: string;
  reason: string | null;
  addedBy: string | null;
  createdAt: string;
}

export interface ListRiskCountriesResponse {
  countries: RiskCountry[];
  count: number;
}

export function listRiskCountries(): Promise<ListRiskCountriesResponse> {
  return apiRequest<ListRiskCountriesResponse>(
    "/api/admin/security/risk-countries",
    { auth: true }
  );
}

export interface AddRiskCountryBody {
  /** ISO-3166 alpha-2 (backend normaliserer til uppercase). */
  countryCode: string;
  label: string;
  reason?: string | null;
}

export function addRiskCountry(body: AddRiskCountryBody): Promise<RiskCountry> {
  return apiRequest<RiskCountry>("/api/admin/security/risk-countries", {
    method: "POST",
    body,
    auth: true,
  });
}

export function deleteRiskCountry(
  countryCode: string
): Promise<{ removed: true }> {
  return apiRequest<{ removed: true }>(
    `/api/admin/security/risk-countries/${encodeURIComponent(countryCode)}`,
    { method: "DELETE", auth: true }
  );
}
