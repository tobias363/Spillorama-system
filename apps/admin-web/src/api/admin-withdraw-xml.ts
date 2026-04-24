// Admin withdraw XML-eksport API wrappers (wireframe 16.20).
// Tynn wrapper rundt `apps/backend/src/routes/adminWithdrawXml.ts`.
//
// Permissions:
//   - list/get:   PAYMENT_REQUEST_READ (ADMIN, HALL_OPERATOR, SUPPORT)
//   - export/resend: PAYMENT_REQUEST_WRITE (ADMIN, HALL_OPERATOR)

import { apiRequest } from "./client.js";

export interface XmlExportBatch {
  id: string;
  agentUserId: string | null;
  generatedAt: string;
  xmlFilePath: string;
  emailSentAt: string | null;
  recipientEmails: string[];
  withdrawRequestCount: number;
}

export interface WithdrawExportRow {
  id: string;
  userId: string;
  hallId: string | null;
  amountCents: number;
  bankAccountNumber: string | null;
  bankName: string | null;
  accountHolder: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

export interface EmailSendOutcome {
  sent: boolean;
  skipped: boolean;
  deliveredTo: string[];
  failedFor: Array<{ email: string; error: string }>;
}

export interface ListXmlBatchesResponse {
  batches: XmlExportBatch[];
  count: number;
}

export interface GetXmlBatchResponse {
  batch: XmlExportBatch;
  rows: WithdrawExportRow[];
}

export interface ExportXmlResponse {
  batch: XmlExportBatch;
  rowCount: number;
  email: EmailSendOutcome;
}

export interface ResendXmlResponse {
  batch: XmlExportBatch | null;
  email: EmailSendOutcome;
}

export function listXmlBatches(
  params: { agentUserId?: string; limit?: number } = {}
): Promise<ListXmlBatchesResponse> {
  const q = new URLSearchParams();
  if (params.agentUserId) q.set("agentUserId", params.agentUserId);
  if (params.limit != null) q.set("limit", String(params.limit));
  const qs = q.toString();
  return apiRequest<ListXmlBatchesResponse>(
    `/api/admin/withdraw/xml-batches${qs ? `?${qs}` : ""}`,
    { auth: true }
  );
}

export function getXmlBatch(id: string): Promise<GetXmlBatchResponse> {
  return apiRequest<GetXmlBatchResponse>(
    `/api/admin/withdraw/xml-batches/${encodeURIComponent(id)}`,
    { auth: true }
  );
}

export function triggerXmlExport(
  body: { agentUserId?: string | null } = {}
): Promise<ExportXmlResponse> {
  return apiRequest<ExportXmlResponse>(
    "/api/admin/withdraw/xml-batches/export",
    { method: "POST", body, auth: true }
  );
}

export function resendXmlBatch(id: string): Promise<ResendXmlResponse> {
  return apiRequest<ResendXmlResponse>(
    `/api/admin/withdraw/xml-batches/${encodeURIComponent(id)}/resend`,
    { method: "POST", body: {}, auth: true }
  );
}
