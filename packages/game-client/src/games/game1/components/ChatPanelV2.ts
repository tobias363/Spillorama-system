import type { HtmlOverlayManager } from "./HtmlOverlayManager.js";
import type { ChatMessage } from "@spillorama/shared-types/socket-events";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";

const MAX_MESSAGES = 80;

/**
 * Pure HTML chat panel (right sidebar, 265px).
 *
 * Replaces the old hybrid PixiJS+HTML ChatPanel with a fully
 * DOM-based approach — no coordinate-syncing issues.
 */
export class ChatPanelV2 {
  private root: HTMLDivElement;
  private messagesEl: HTMLDivElement;
  private inputEl: HTMLInputElement;
  private activeCountEl: HTMLSpanElement;
  private socket: SpilloramaSocket;
  private roomCode: string;
  private messages: ChatMessage[] = [];
  private unsubChat: (() => void) | null = null;
  private collapsed = false;
  private toggleBtn: HTMLButtonElement;
  private body: HTMLDivElement;

  constructor(overlay: HtmlOverlayManager, socket: SpilloramaSocket, roomCode: string) {
    this.socket = socket;
    this.roomCode = roomCode;

    this.root = overlay.createElement("chat-panel", {
      width: "265px",
      flexShrink: "0",
      display: "flex",
      flexDirection: "column",
      background: "rgba(10,2,2,0.55)",
      borderLeft: "1px solid rgba(200,70,70,0.4)",
      backdropFilter: "blur(4px)",
      height: "100%",
    });

    // Header with toggle
    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:flex-end;padding:14px 12px 10px;border-bottom:1px solid rgba(200,70,70,0.3);";

    this.toggleBtn = document.createElement("button");
    this.toggleBtn.style.cssText = "display:flex;align-items:center;gap:4px;background:none;border:none;color:#ccc;font-size:13px;cursor:pointer;font-family:inherit;";
    this.toggleBtn.innerHTML = `Skjul chat <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>`;
    this.toggleBtn.addEventListener("click", () => this.toggleCollapse());
    header.appendChild(this.toggleBtn);
    this.root.appendChild(header);

    // Body (collapsible)
    this.body = document.createElement("div");
    this.body.style.cssText = "display:flex;flex-direction:column;flex:1;overflow:hidden;";

    // Active players bar
    const playersBar = document.createElement("div");
    playersBar.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(200,70,70,0.3);font-size:13px;color:#ccc;";
    playersBar.innerHTML = `<span>Aktive spillere</span>`;
    const countWrap = document.createElement("div");
    countWrap.style.cssText = "display:flex;align-items:center;gap:8px;";
    this.activeCountEl = document.createElement("span");
    this.activeCountEl.textContent = "0";
    countWrap.appendChild(this.activeCountEl);
    const dot = document.createElement("div");
    dot.style.cssText = "width:10px;height:10px;border-radius:50%;background:#4caf50;box-shadow:0 0 6px rgba(76,175,80,0.7);";
    countWrap.appendChild(dot);
    playersBar.appendChild(countWrap);
    this.body.appendChild(playersBar);

    // Messages area
    this.messagesEl = document.createElement("div");
    this.messagesEl.style.cssText = "flex:1;overflow-y:auto;padding:8px 12px;";
    this.body.appendChild(this.messagesEl);

    // Input row
    const inputRow = document.createElement("div");
    inputRow.style.cssText = "display:flex;align-items:center;gap:6px;padding:10px;border-top:1px solid rgba(200,70,70,0.3);";

    this.inputEl = document.createElement("input");
    this.inputEl.type = "text";
    this.inputEl.placeholder = "Skriv Meldingen";
    this.inputEl.maxLength = 100;
    this.inputEl.autocomplete = "off";
    Object.assign(this.inputEl.style, {
      flex: "1",
      background: "rgba(40,10,10,0.7)",
      border: "1px solid rgba(150,50,50,0.5)",
      borderRadius: "20px",
      padding: "8px 12px",
      fontSize: "13px",
      color: "#ccc",
      outline: "none",
      fontFamily: "inherit",
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.sendMessage();
      e.stopPropagation();
    });
    this.inputEl.addEventListener("keyup", (e) => e.stopPropagation());
    this.inputEl.addEventListener("keypress", (e) => e.stopPropagation());
    this.inputEl.addEventListener("focus", () => {
      this.inputEl.style.borderColor = "rgba(200,100,100,0.8)";
    });
    this.inputEl.addEventListener("blur", () => {
      this.inputEl.style.borderColor = "rgba(150,50,50,0.5)";
    });
    inputRow.appendChild(this.inputEl);

    // Emoji picker button + dropdown
    const emojiWrapper = document.createElement("div");
    emojiWrapper.style.cssText = "position:relative;";

    const emojiBtn = document.createElement("button");
    emojiBtn.style.cssText = "font-size:18px;cursor:pointer;background:none;border:none;";
    emojiBtn.textContent = "\u{1F60A}";
    emojiWrapper.appendChild(emojiBtn);

    const emojiGrid = document.createElement("div");
    Object.assign(emojiGrid.style, {
      display: "none",
      position: "absolute",
      bottom: "36px",
      right: "0",
      background: "#2a1a0a",
      border: "1px solid rgba(255,200,100,0.3)",
      borderRadius: "8px",
      padding: "8px",
      gridTemplateColumns: "repeat(6, 1fr)",
      gap: "4px",
      zIndex: "10",
      boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
    });
    const EMOJIS = ["\u{1F60A}", "\u{1F602}", "\u{1F44D}", "\u{1F389}", "\u{1F3B0}", "\u{1F525}",
                    "\u{2764}", "\u{1F60E}", "\u{1F622}", "\u{1F914}", "\u{1F4B0}", "\u{1F3C6}"];
    for (const emoji of EMOJIS) {
      const eb = document.createElement("button");
      eb.textContent = emoji;
      eb.style.cssText = "font-size:20px;cursor:pointer;background:none;border:none;padding:4px;border-radius:4px;";
      eb.addEventListener("mouseenter", () => { eb.style.background = "rgba(255,255,255,0.1)"; });
      eb.addEventListener("mouseleave", () => { eb.style.background = "none"; });
      eb.addEventListener("click", () => {
        this.inputEl.value += emoji;
        emojiGrid.style.display = "none";
        this.inputEl.focus();
      });
      emojiGrid.appendChild(eb);
    }
    emojiWrapper.appendChild(emojiGrid);

    emojiBtn.addEventListener("click", () => {
      const showing = emojiGrid.style.display === "grid";
      emojiGrid.style.display = showing ? "none" : "grid";
    });
    inputRow.appendChild(emojiWrapper);

    const sendBtn = document.createElement("button");
    Object.assign(sendBtn.style, {
      width: "32px",
      height: "32px",
      borderRadius: "50%",
      background: "#e65c00",
      border: "none",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      color: "#fff",
      fontSize: "14px",
      flexShrink: "0",
    });
    sendBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
    sendBtn.addEventListener("click", () => this.sendMessage());
    inputRow.appendChild(sendBtn);

    this.body.appendChild(inputRow);
    this.root.appendChild(this.body);

    this.loadHistory();
  }

  subscribeToBridge(
    onChat: (listener: (msg: ChatMessage) => void) => () => void,
  ): void {
    this.unsubChat = onChat((msg) => this.addMessage(msg));
  }

  updatePlayerCount(count: number): void {
    this.activeCountEl.textContent = String(count);
  }

  addMessage(msg: ChatMessage): void {
    this.messages.push(msg);
    if (this.messages.length > MAX_MESSAGES) this.messages.shift();
    this.renderLastMessage(msg);
  }

  private renderLastMessage(msg: ChatMessage): void {
    const msgEl = document.createElement("div");
    msgEl.style.cssText = "padding:3px 0;font-size:13px;color:#ccc;word-break:break-word;";

    const nameSpan = document.createElement("span");
    nameSpan.style.cssText = "font-weight:700;color:#ffe83d;";
    nameSpan.textContent = `${msg.playerName}: `;
    msgEl.appendChild(nameSpan);

    msgEl.appendChild(document.createTextNode(msg.message));
    this.messagesEl.appendChild(msgEl);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private sendMessage(): void {
    const message = this.inputEl.value.trim();
    if (!message) return;
    this.socket.sendChat({ roomCode: this.roomCode, message });
    this.inputEl.value = "";
  }

  private toggleCollapse(): void {
    this.collapsed = !this.collapsed;
    this.body.style.display = this.collapsed ? "none" : "flex";
    this.root.style.width = this.collapsed ? "auto" : "265px";
    this.toggleBtn.innerHTML = this.collapsed
      ? `Vis chat <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M14 6l1.41 1.41L10.83 12l4.58 4.59L14 18l-6-6z"/></svg>`
      : `Skjul chat <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>`;
  }

  private async loadHistory(): Promise<void> {
    const result = await this.socket.getChatHistory({ roomCode: this.roomCode });
    if (result.ok && result.data?.messages) {
      for (const msg of result.data.messages.slice(-MAX_MESSAGES)) {
        this.addMessage(msg);
      }
    }
  }

  destroy(): void {
    this.unsubChat?.();
    this.root.remove();
  }
}
