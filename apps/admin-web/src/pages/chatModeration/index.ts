// HIGH-11 — chatModeration dispatcher.
//
// Path: /admin/chat-moderation → ChatModerationPage

import { renderChatModerationPage } from "./ChatModerationPage.js";
import { renderUnknownRoute } from "../../utils/escapeHtml.js";

export function isChatModerationRoute(path: string): boolean {
  return path === "/admin/chat-moderation";
}

export function mountChatModerationRoute(
  container: HTMLElement,
  path: string
): void {
  container.innerHTML = "";
  if (path === "/admin/chat-moderation") {
    return renderChatModerationPage(container);
  }
  container.innerHTML = renderUnknownRoute("chat-moderation", path);
}
