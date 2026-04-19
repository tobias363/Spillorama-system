import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";
import type { MiniGameActivatedPayload, MiniGamePlayResult } from "@spillorama/shared-types/socket-events";

const CHEST_COLORS = {
  closed: 0x8b4513,
  closedLight: 0xa0522d,
  lid: 0xdaa520,
  openBg: 0x2e0000,
  winner: 0xffe83d,
};

/** Auto-back delay after reveal, in seconds (Unity `TreasureChestPanel.cs:611`). */
const AUTO_BACK_SECONDS = 12;
const AUTO_SELECT_SECONDS = 10;

/** Bridge-state shape we actually read. */
interface PauseAwareBridge {
  getState(): { isPaused: boolean };
}

/**
 * Treasure Chest mini-game overlay for Game 1 (Classic Bingo).
 * Shows N chests — player picks one. Outcome is server-determined.
 * After reveal, all chests open showing prizes.
 *
 * Unity parity:
 *   - `TreasureChestPanel.cs:107` — auto-select after countdown.
 *   - `TreasureChestPanel.cs:541-542` — `OrderBy(Guid.NewGuid())` shuffle of prizes
 *     (client-side, cosmetic only — server still picks the winner).
 *   - `TreasureChestPanel.cs:611` — 12 s auto-back after reveal.
 *   - `TreasureChestPanel.cs:633,643` — pause-hook on countdowns.
 */
export class TreasureChestOverlay extends Container {
  private backdrop: Graphics;
  private chestContainer: Container;
  private resultText: Text;
  private titleText: Text;
  private timerText: Text;
  private prizeList: number[] = [];
  private chests: Container[] = [];
  private isRevealing = false;
  private onPlay: ((selectedIndex: number) => void) | null = null;
  private onDismiss: (() => void) | null = null;
  private autoSelectTimer: ReturnType<typeof setInterval> | null = null;
  private autoSelectCountdown = AUTO_SELECT_SECONDS;
  private bridge: PauseAwareBridge | null;

  constructor(private screenWidth: number, private screenHeight: number, bridge?: PauseAwareBridge) {
    super();
    this.bridge = bridge ?? null;

    // Semi-transparent backdrop
    this.backdrop = new Graphics();
    this.backdrop.rect(0, 0, screenWidth, screenHeight);
    this.backdrop.fill({ color: 0x000000, alpha: 0.75 });
    this.backdrop.eventMode = "static";
    this.addChild(this.backdrop);

    // Title
    this.titleText = new Text({
      text: "SKATTEKISTE!",
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 36,
        fontWeight: "bold",
        fill: 0xffe83d,
        align: "center",
      },
    });
    this.titleText.anchor.set(0.5);
    this.titleText.x = screenWidth / 2;
    this.titleText.y = 40;
    this.addChild(this.titleText);

    // Subtitle
    const subtitle = new Text({
      text: "Velg en kiste!",
      style: { fontFamily: "Arial", fontSize: 20, fill: 0xffffff, align: "center" },
    });
    subtitle.anchor.set(0.5);
    subtitle.x = screenWidth / 2;
    subtitle.y = 80;
    subtitle.name = "subtitle";
    this.addChild(subtitle);

    // Chest container
    this.chestContainer = new Container();
    this.addChild(this.chestContainer);

    // Timer text
    this.timerText = new Text({
      text: "",
      style: { fontFamily: "Arial", fontSize: 18, fill: 0xffffff, align: "center" },
    });
    this.timerText.anchor.set(0.5);
    this.timerText.x = screenWidth / 2;
    this.timerText.y = screenHeight - 80;
    this.addChild(this.timerText);

    // Result text
    this.resultText = new Text({
      text: "",
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 28,
        fontWeight: "bold",
        fill: 0xffe83d,
        align: "center",
      },
    });
    this.resultText.anchor.set(0.5);
    this.resultText.x = screenWidth / 2;
    this.resultText.y = screenHeight - 40;
    this.resultText.visible = false;
    this.addChild(this.resultText);

    this.visible = false;
  }

  setOnPlay(callback: (selectedIndex: number) => void): void {
    this.onPlay = callback;
  }

  setOnDismiss(callback: () => void): void {
    this.onDismiss = callback;
  }

  show(data: MiniGameActivatedPayload): void {
    // Unity parity: TreasureChestPanel.cs:541-542 shuffles the prize list
    // client-side before assigning each chest a label (`OrderBy(Guid.NewGuid())`).
    // The server still determines the winning index — this is cosmetic only so
    // players don't see the same chest order every round.
    this.prizeList = shufflePrizes(data.prizeList);
    this.isRevealing = false;
    this.resultText.visible = false;
    const subtitle = this.getChildByName("subtitle") as Text | null;
    if (subtitle) subtitle.visible = true;
    this.buildChests();
    this.visible = true;

    // Auto-select countdown (10 s). Respects server-authoritative pause —
    // Unity: TreasureChestPanel.cs:633 freezes countdowns while room is paused.
    this.autoSelectCountdown = AUTO_SELECT_SECONDS;
    this.timerText.text = `Auto-valg om ${this.autoSelectCountdown}s`;
    this.autoSelectTimer = setInterval(() => {
      if (this.bridge?.getState().isPaused) return; // Pause-hook
      this.autoSelectCountdown -= 1;
      if (this.autoSelectCountdown <= 0) {
        this.clearAutoTimer();
        this.timerText.text = "";
        // Auto-select random chest
        const randomIdx = Math.floor(Math.random() * this.prizeList.length);
        this.handleChestClick(randomIdx);
      } else {
        this.timerText.text = `Auto-valg om ${this.autoSelectCountdown}s`;
      }
    }, 1000);
  }

  animateResult(result: MiniGamePlayResult): void {
    this.isRevealing = true;
    this.clearAutoTimer();
    this.timerText.text = "";
    const subtitle = this.getChildByName("subtitle") as Text | null;
    if (subtitle) subtitle.visible = false;

    // Reveal all chests with prizes
    for (let i = 0; i < this.chests.length; i++) {
      const chest = this.chests[i];
      const prize = result.prizeList[i] ?? 0;
      const isWinner = i === result.segmentIndex;
      this.revealChest(chest, i, prize, isWinner);
    }

    // Show result
    gsap.delayedCall(1, () => {
      this.resultText.text = `Du vant ${result.prizeAmount} kr!`;
      this.resultText.visible = true;
    });

    // Auto-back after 12 s — Unity parity (TreasureChestPanel.cs:611).
    gsap.delayedCall(AUTO_BACK_SECONDS, () => {
      this.visible = false;
      this.onDismiss?.();
    });
  }

  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.clearAutoTimer();
    gsap.killTweensOf(this);
    super.destroy(options);
  }

  private handleChestClick(index: number): void {
    if (this.isRevealing) return;
    this.clearAutoTimer();
    this.timerText.text = "";

    // Highlight selected chest
    const chest = this.chests[index];
    if (chest) {
      gsap.to(chest, { y: chest.y - 10, duration: 0.2, yoyo: true, repeat: 1 });
    }

    this.onPlay?.(index);
  }

  private clearAutoTimer(): void {
    if (this.autoSelectTimer) {
      clearInterval(this.autoSelectTimer);
      this.autoSelectTimer = null;
    }
  }

  private buildChests(): void {
    // Clear existing
    for (const chest of this.chests) chest.destroy({ children: true });
    this.chests = [];
    this.chestContainer.removeChildren();

    const count = this.prizeList.length;
    const chestSize = Math.min(70, Math.floor((this.screenWidth - 40) / count) - 10);
    const totalWidth = count * (chestSize + 10) - 10;
    const startX = (this.screenWidth - totalWidth) / 2;
    const centerY = this.screenHeight / 2;

    // Arrange in two rows if many chests
    const perRow = count <= 4 ? count : Math.ceil(count / 2);
    const rows = Math.ceil(count / perRow);

    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const rowCount = row === rows - 1 ? count - perRow * row : perRow;
      const rowWidth = rowCount * (chestSize + 10) - 10;
      const rowStartX = (this.screenWidth - rowWidth) / 2;

      const chest = this.drawClosedChest(chestSize, i + 1);
      chest.x = rowStartX + col * (chestSize + 10) + chestSize / 2;
      chest.y = centerY + row * (chestSize + 20) - (rows > 1 ? chestSize / 2 : 0);
      chest.eventMode = "static";
      chest.cursor = "pointer";
      const idx = i;
      chest.on("pointerdown", () => this.handleChestClick(idx));
      this.chestContainer.addChild(chest);
      this.chests.push(chest);
    }
  }

  private drawClosedChest(size: number, number: number): Container {
    const c = new Container();

    // Body
    const body = new Graphics();
    body.roundRect(-size / 2, -size / 2, size, size, 6);
    body.fill(CHEST_COLORS.closed);
    body.stroke({ color: CHEST_COLORS.lid, width: 2 });
    c.addChild(body);

    // Lid stripe
    const lid = new Graphics();
    lid.rect(-size / 2, -size / 2, size, size * 0.3);
    lid.fill(CHEST_COLORS.closedLight);
    lid.stroke({ color: CHEST_COLORS.lid, width: 1 });
    c.addChild(lid);

    // Lock
    const lock = new Graphics();
    lock.circle(0, -size * 0.05, size * 0.08);
    lock.fill(CHEST_COLORS.lid);
    c.addChild(lock);

    // Number
    const label = new Text({
      text: `${number}`,
      style: { fontFamily: "Arial", fontSize: Math.floor(size * 0.3), fill: 0xffffff, fontWeight: "bold" },
    });
    label.anchor.set(0.5);
    label.y = size * 0.15;
    c.addChild(label);

    return c;
  }

  private revealChest(chest: Container, _index: number, prize: number, isWinner: boolean): void {
    // Animate open
    gsap.to(chest, {
      alpha: 0.5,
      duration: 0.3,
      onComplete: () => {
        // Rebuild as open chest
        chest.removeChildren();
        chest.alpha = 1;

        const size = 70;

        // Open body
        const body = new Graphics();
        body.roundRect(-size / 2, -size / 2, size, size, 6);
        body.fill(isWinner ? CHEST_COLORS.winner : CHEST_COLORS.openBg);
        body.stroke({ color: isWinner ? 0xffffff : CHEST_COLORS.lid, width: isWinner ? 3 : 2 });
        chest.addChild(body);

        // Prize label
        const label = new Text({
          text: `${prize}\nkr`,
          style: {
            fontFamily: "Arial",
            fontSize: Math.floor(size * 0.22),
            fill: isWinner ? 0x000000 : 0xffffff,
            fontWeight: "bold",
            align: "center",
          },
        });
        label.anchor.set(0.5);
        chest.addChild(label);

        // Winner glow
        if (isWinner) {
          gsap.to(chest, { alpha: 0.7, duration: 0.4, yoyo: true, repeat: 3 });
        }
      },
    });
  }
}

/**
 * Fisher–Yates shuffle, emulating Unity's `prizes.OrderBy(_ => Guid.NewGuid())`.
 * Pure function + isolated to a helper so tests can assert determinism across
 * fixed seeds (Math.random is stubbed in test).
 */
export function shufflePrizes(prizes: number[]): number[] {
  const out = prizes.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Exposed for tests. */
export const __TreasureChest_AUTO_BACK_SECONDS__ = AUTO_BACK_SECONDS;

