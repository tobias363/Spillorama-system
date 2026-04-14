import { Container, Graphics, Text } from "pixi.js";
import type { ChatMessage } from "@spillorama/shared-types/socket-events";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";

const PANEL_WIDTH = 280;
const MESSAGE_HEIGHT = 28;
const MAX_MESSAGES = 50;
const INPUT_HEIGHT = 40;

/**
 * Real-time chat panel for bingo games.
 * Uses an HTML <input> overlay for text entry (PixiJS has no native text input).
 */
export class ChatPanel extends Container {
  private socket: SpilloramaSocket;
  private roomCode: string;
  private messages: ChatMessage[] = [];
  private messageContainer: Container;
  private scrollMask: Graphics;
  private panelHeight: number;
  private bg: Graphics;
  private inputBg: Graphics;
  private htmlInput: HTMLInputElement | null = null;
  private unsubChat: (() => void) | null = null;

  constructor(
    socket: SpilloramaSocket,
    roomCode: string,
    panelHeight: number,
  ) {
    super();
    this.socket = socket;
    this.roomCode = roomCode;
    this.panelHeight = panelHeight;

    // Background
    this.bg = new Graphics();
    this.bg.roundRect(0, 0, PANEL_WIDTH, panelHeight, 8);
    this.bg.fill(0x2e0000);
    this.addChild(this.bg);

    // Title
    const title = new Text({
      text: "Chat",
      style: { fontFamily: "Arial", fontSize: 16, fontWeight: "bold", fill: 0xffe83d },
    });
    title.x = 12;
    title.y = 8;
    this.addChild(title);

    // Message area with mask
    const messageAreaY = 34;
    const messageAreaHeight = panelHeight - messageAreaY - INPUT_HEIGHT - 8;

    this.scrollMask = new Graphics();
    this.scrollMask.rect(0, messageAreaY, PANEL_WIDTH, messageAreaHeight);
    this.scrollMask.fill(0xffffff);
    this.addChild(this.scrollMask);

    this.messageContainer = new Container();
    this.messageContainer.y = messageAreaY;
    this.messageContainer.mask = this.scrollMask;
    this.addChild(this.messageContainer);

    // Input area background (visual only — real input is HTML overlay)
    const inputY = panelHeight - INPUT_HEIGHT - 4;
    this.inputBg = new Graphics();
    this.inputBg.roundRect(8, inputY, PANEL_WIDTH - 16, INPUT_HEIGHT - 4, 6);
    this.inputBg.fill(0x3e0000);
    this.addChild(this.inputBg);

    // Create HTML input overlay
    this.createHtmlInput();

    // Load chat history
    this.loadHistory();
  }

  /** Subscribe to incoming chat messages. */
  subscribeToBridge(onChat: (listener: (msg: ChatMessage) => void) => () => void): void {
    this.unsubChat = onChat((msg) => this.addMessage(msg));
  }

  addMessage(msg: ChatMessage): void {
    this.messages.push(msg);
    if (this.messages.length > MAX_MESSAGES) {
      this.messages.shift();
    }
    this.renderMessages();
  }

  destroy(): void {
    this.unsubChat?.();
    this.htmlInput?.remove();
    this.htmlInput = null;
    super.destroy({ children: true });
  }

  // ── Private ───────────────────────────────────────────────────────────

  private createHtmlInput(): void {
    const container = document.getElementById("web-game-container");
    if (!container) return;

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Skriv melding...";
    input.maxLength = 100;
    input.autocomplete = "off";

    Object.assign(input.style, {
      position: "absolute",
      width: `${PANEL_WIDTH - 32}px`,
      height: `${INPUT_HEIGHT - 12}px`,
      border: "1px solid #790001",
      borderRadius: "6px",
      background: "#3e0000",
      color: "#fff2ce",
      fontFamily: "Arial, sans-serif",
      fontSize: "13px",
      padding: "0 8px",
      outline: "none",
      zIndex: "1000",
      // Position will be updated once we know our global coords
      display: "none",
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const message = input.value.trim();
        if (message) {
          this.socket.sendChat({ roomCode: this.roomCode, message });
          input.value = "";
        }
      }
      // Prevent PixiJS/game from capturing these keys
      e.stopPropagation();
    });

    container.appendChild(input);
    this.htmlInput = input;

    // Position the input once the panel is rendered (next frame)
    requestAnimationFrame(() => this.positionHtmlInput());
  }

  private positionHtmlInput(): void {
    if (!this.htmlInput) return;

    const canvas = document.querySelector("#web-game-container canvas") as HTMLCanvasElement | null;
    if (!canvas) return;

    // Get world position of this container
    const globalPos = this.getGlobalPosition();

    // Convert PixiJS coords to CSS coords (account for resolution scaling)
    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = canvasRect.width / canvas.width;
    const scaleY = canvasRect.height / canvas.height;
    const resolution = window.devicePixelRatio || 1;

    const inputY = this.panelHeight - INPUT_HEIGHT - 4;
    const cssX = canvasRect.left + (globalPos.x + 16) * scaleX * resolution;
    const cssY = canvasRect.top + (globalPos.y + inputY + 4) * scaleY * resolution;

    Object.assign(this.htmlInput.style, {
      left: `${cssX}px`,
      top: `${cssY}px`,
      display: "block",
    });
  }

  private async loadHistory(): Promise<void> {
    const result = await this.socket.getChatHistory({ roomCode: this.roomCode });
    if (result.ok && result.data?.messages) {
      this.messages = result.data.messages.slice(-MAX_MESSAGES);
      this.renderMessages();
    }
  }

  private renderMessages(): void {
    this.messageContainer.removeChildren();

    const messageAreaHeight = this.panelHeight - 34 - INPUT_HEIGHT - 8;
    const startY = Math.max(0, this.messages.length * MESSAGE_HEIGHT - messageAreaHeight);

    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i];
      const y = i * MESSAGE_HEIGHT - startY;

      if (y < -MESSAGE_HEIGHT || y > messageAreaHeight) continue;

      const nameText = new Text({
        text: `${msg.playerName}: `,
        style: { fontFamily: "Arial", fontSize: 12, fontWeight: "bold", fill: 0xffe83d },
      });
      nameText.x = 8;
      nameText.y = y;
      this.messageContainer.addChild(nameText);

      const msgText = new Text({
        text: msg.message.substring(0, 30),
        style: { fontFamily: "Arial", fontSize: 12, fill: 0xfff2ce },
      });
      msgText.x = 8 + nameText.width;
      msgText.y = y;
      this.messageContainer.addChild(msgText);
    }
  }
}
