// HIGH-11 — chatModeration dispatcher.
//
// Path: /admin/chat-moderation → ChatModerationPage

import { renderChatModerationPage } from "./ChatModerationPage.js";

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
  container.innerHTML = `<div class="box box-danger"><div class="box-body">Unknown chat-moderation route: ${path}</div></div>`;
}
