import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";
import type { ChatMessage } from "@spillorama/shared-types/socket-events";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";

const PANEL_WIDTH = 280;
const MESSAGE_HEIGHT = 28;
const MAX_MESSAGES = 50;
const INPUT_HEIGHT = 40;

/**
 * Real-time chat panel for bingo games.
 * Displays messages and allows sending via socket.
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
  private inputText: Text;
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

    // Input area
    const inputY = panelHeight - INPUT_HEIGHT - 4;
    this.inputBg = new Graphics();
    this.inputBg.roundRect(8, inputY, PANEL_WIDTH - 16, INPUT_HEIGHT - 4, 6);
    this.inputBg.fill(0x3e0000);
    this.inputBg.eventMode = "static";
    this.inputBg.cursor = "pointer";
    this.inputBg.on("pointerdown", () => this.promptSendMessage());
    this.addChild(this.inputBg);

    this.inputText = new Text({
      text: "Skriv melding...",
      style: { fontFamily: "Arial", fontSize: 13, fill: 0x997766 },
    });
    this.inputText.x = 16;
    this.inputText.y = inputY + 8;
    this.addChild(this.inputText);

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
    super.destroy({ children: true });
  }

  // ── Private ───────────────────────────────────────────────────────────

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

  private promptSendMessage(): void {
    const message = prompt("Skriv melding:");
    if (message && message.trim()) {
      this.socket.sendChat({
        roomCode: this.roomCode,
        message: message.trim(),
      });
    }
  }
}
