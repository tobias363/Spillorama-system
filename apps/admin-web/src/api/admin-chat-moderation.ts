// HIGH-11 — admin-chat-moderation API wrapper.
//
// GET  /api/admin/chat/messages?hallId&roomCode&fromDate&toDate&search&includeDeleted&limit&offset
//   → { messages: ChatModerationMessage[], total: number, limit: number, offset: number }
// POST /api/admin/chat/messages/:id/delete
//   body: { reason: string }
//   → { message: ChatModerationMessage, wasAlreadyDeleted: boolean }
//
// RBAC: CHAT_MODERATION_READ (ADMIN + HALL_OPERATOR + SUPPORT) for GET,
// CHAT_MODERATION_WRITE (ADMIN + HALL_OPERATOR) for delete.

import { apiRequest } from "./client.js";

export interface ChatModerationMessage {
  id: string;
  hallId: string;
  roomCode: string;
  playerId: string;
  playerName: string;
  message: string;
  emojiId: number;
  createdAt: string;
  deletedAt: string | null;
  deletedByUserId: string | null;
  deleteReason: string | null;
}

export interface ListChatModerationParams {
  hallId?: string;
  roomCode?: string;
  fromDate?: string;
  toDate?: string;
  search?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListChatModerationResponse {
  messages: ChatModerationMessage[];
  total: number;
  limit: number;
  offset: number;
}

export async function listChatMessages(
  params: ListChatModerationParams = {}
): Promise<ListChatModerationResponse> {
  const qs = new URLSearchParams();
  if (params.hallId) qs.set("hallId", params.hallId);
  if (params.roomCode) qs.set("roomCode", params.roomCode);
  if (params.fromDate) qs.set("fromDate", params.fromDate);
  if (params.toDate) qs.set("toDate", params.toDate);
  if (params.search) qs.set("search", params.search);
  if (params.includeDeleted) qs.set("includeDeleted", "1");
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiRequest<ListChatModerationResponse>(
    `/api/admin/chat/messages${suffix}`,
    { auth: true }
  );
}

export async function deleteChatMessage(
  id: string,
  reason: string
): Promise<{ message: ChatModerationMessage; wasAlreadyDeleted: boolean }> {
  return apiRequest<{
    message: ChatModerationMessage;
    wasAlreadyDeleted: boolean;
  }>(`/api/admin/chat/messages/${encodeURIComponent(id)}/delete`, {
    method: "POST",
    auth: true,
    body: { reason },
  });
}
