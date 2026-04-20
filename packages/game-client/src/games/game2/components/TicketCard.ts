import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";
import type { Ticket } from "@spillorama/shared-types/game";
import { BingoGrid, type GridSize } from "../../../components/BingoGrid.js";
import type { BingoCellColors } from "../../../components/BingoCell.js";
import { ONE_TO_GO_COLOR } from "../../game1/colors/TicketColorThemes.js";

export interface TicketCardOptions {
  gridSize?: GridSize;
  cellSize?: number;
  /** Card-level color overrides (Unity TicketColorTheme) */
  cardBg?: number;
  headerBg?: number;
  headerText?: number;
  toGoColor?: number;
  toGoCloseColor?: number;
  /** Cell-level color overrides (Unity TicketColorData) */
  cellColors?: BingoCellColors;
  /**
   * BIN-692: show a × "cancel" button at the top-left of the header so
   * the player can drop a pre-round ticket (or its whole bundle). The
   * button only renders when `cancelable === true` — PlayScreen toggles
   * this based on game state (only true in WAITING).
   *
   * On click, `onCancel` is invoked with the ticket's `id` (the stable
   * `tkt-N` id from the display cache). The click also suppresses the
   * flip interaction so the card doesn't flip while being dismissed.
   */
  cancelable?: boolean;
  onCancel?: (ticketId: string) => void;
}

/**
 * Ticket card with Unity-matching design: header bar + BingoGrid + to-go counter.
 */
export class TicketCard extends Container {
  readonly grid: BingoGrid;
  private cardBg: Graphics;
  private headerBg: Graphics;
  private headerText: Text;
  private priceText: Text;
  private toGoText: Text;
  private ticket: Ticket | null = null;
  private cardW: number;
  private cardH: number;

  // Default Unity colors (overridable via options)
  private static readonly DEFAULT_CARD_BG = 0xfff2ce;
  private static readonly DEFAULT_HEADER_BG = 0x790001;
  private static readonly DEFAULT_HEADER_TEXT = 0xffe83d;
  private static readonly DEFAULT_TOGO_NORMAL = 0x790001;
  private static readonly DEFAULT_TOGO_CLOSE = 0xe63946;

  private toGoNormalColor: number;
  private toGoCloseColor: number;
  private cardBgColor: number;

  // Card-level animations (background blink, BINGO pulse)
  private bgBlinkTween: gsap.core.Tween | null = null;
  private bingoTimeline: gsap.core.Timeline | null = null;
  private bingoOverlay: Text | null = null;

  // ── Flip animation state ────────────────────────────────────────────
  private isFlipped = false;
  private isFlipping = false;
  private flipAutoTimer: ReturnType<typeof setTimeout> | null = null;
  private detailsOverlay: Container | null = null;
  private ticketIndex: number;
  private headerTextColor: number;

  // ── BIN-692: cancel-button state ────────────────────────────────────
  private cancelBtn: Container | null = null;
  private onCancel: ((ticketId: string) => void) | null = null;

  constructor(index: number, options?: TicketCardOptions) {
    super();
    this.ticketIndex = index;
    const gridSize = options?.gridSize ?? "3x5";
    const cellSize = options?.cellSize ?? (gridSize === "5x5" ? 36 : 44);

    // Theme colors (from Unity TicketColorTheme or defaults)
    const cardBgColor = options?.cardBg ?? TicketCard.DEFAULT_CARD_BG;
    this.cardBgColor = cardBgColor;
    const headerBgColor = options?.headerBg ?? TicketCard.DEFAULT_HEADER_BG;
    const headerTextColor = options?.headerText ?? TicketCard.DEFAULT_HEADER_TEXT;
    this.headerTextColor = headerTextColor;
    this.toGoNormalColor = options?.toGoColor ?? TicketCard.DEFAULT_TOGO_NORMAL;
    this.toGoCloseColor = options?.toGoCloseColor ?? TicketCard.DEFAULT_TOGO_CLOSE;

    // Grid first to get dimensions
    this.grid = new BingoGrid({ gridSize, cellSize, gap: 2, cellColors: options?.cellColors });
    this.cardW = this.grid.gridWidth + 16;
    const headerH = 28;
    const toGoH = 24;
    this.cardH = headerH + this.grid.gridHeight + toGoH + 20;

    // Card background
    this.cardBg = new Graphics();
    this.cardBg.roundRect(0, 0, this.cardW, this.cardH, 8);
    this.cardBg.fill(cardBgColor);
    this.addChild(this.cardBg);

    // Header bar
    this.headerBg = new Graphics();
    this.headerBg.roundRect(0, 0, this.cardW, headerH, 8);
    this.headerBg.fill(headerBgColor);
    this.addChild(this.headerBg);

    // Header text (ticket number)
    this.headerText = new Text({
      text: `${index + 1}-standard`,
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 13,
        fontWeight: "bold",
        fill: headerTextColor,
      },
    });
    this.headerText.x = 8;
    this.headerText.y = 5;
    this.addChild(this.headerText);

    // Price text (right side of header)
    this.priceText = new Text({
      text: "20kr",
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 13,
        fontWeight: "bold",
        fill: headerTextColor,
      },
    });
    this.priceText.anchor.set(1, 0);
    this.priceText.x = this.cardW - 8;
    this.priceText.y = 5;
    this.addChild(this.priceText);

    // Grid
    this.grid.x = 8;
    this.grid.y = headerH + 4;
    this.addChild(this.grid);

    // "To go" text
    this.toGoText = new Text({
      text: "",
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 14,
        fontWeight: "bold",
        fill: this.toGoNormalColor,
        align: "center",
      },
    });
    this.toGoText.anchor.set(0.5, 0);
    this.toGoText.x = this.cardW / 2;
    this.toGoText.y = headerH + this.grid.gridHeight + 8;
    this.addChild(this.toGoText);

    // ── Flip interaction (tap/click to show ticket details) ───────────
    this.eventMode = "static";
    this.cursor = "pointer";
    this.on("pointerdown", () => {
      if (this.isFlipping) return;
      if (this.isFlipped) {
        this.flipToGrid();
      } else {
        this.flipToDetails();
      }
    });

    // ── BIN-692: optional cancel-button (×) in top-left of header ─────
    this.onCancel = options?.onCancel ?? null;
    if (options?.cancelable) {
      this.cancelBtn = this.createCancelButton(headerBgColor, headerTextColor);
      this.addChild(this.cancelBtn);
    }
  }

  /**
   * BIN-692: build a small circular × button anchored at the top-left of
   * the header. Intercepts pointerdown so it doesn't trigger the card's
   * own flip gesture, then fires `onCancel(ticketId)` if loadTicket was
   * already called.
   *
   * Unity parity: `Game1ViewPurchaseElvisTicket.cs:17,49-76` deleteBtn —
   * a per-ticket × that drops the armed ticket and (for Large/Elvis
   * bundles) the whole bundle it belongs to.
   */
  private createCancelButton(headerBgColor: number, headerTextColor: number): Container {
    const btn = new Container();
    btn.eventMode = "static";
    btn.cursor = "pointer";

    const BTN_SIZE = 18;
    btn.x = 4;
    btn.y = (28 - BTN_SIZE) / 2; // vertically centred in the 28px header

    // Contrast circle — slightly darker than the header so the × pops.
    const bg = new Graphics();
    bg.circle(BTN_SIZE / 2, BTN_SIZE / 2, BTN_SIZE / 2);
    bg.fill({ color: 0x000000, alpha: 0.35 });
    btn.addChild(bg);

    const cross = new Text({
      text: "\u00d7", // multiplication sign (Unity uses same)
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 16,
        fontWeight: "bold",
        fill: headerTextColor,
      },
    });
    cross.anchor.set(0.5, 0.5);
    cross.x = BTN_SIZE / 2;
    cross.y = BTN_SIZE / 2 - 1; // optical centring
    btn.addChild(cross);

    // Suppress the card-level flip pointerdown. `stopPropagation` on the
    // federated event bubbles up to the Container parent before the
    // card's listener fires.
    btn.on("pointerdown", (e) => {
      e.stopPropagation();
      const id = this.ticket?.id;
      if (id && this.onCancel) this.onCancel(id);
    });

    // Silence unused parameter lint while keeping the signature future-
    // proof (e.g. if we want to tint based on header bg later).
    void headerBgColor;
    return btn;
  }

  loadTicket(ticket: Ticket): void {
    this.ticket = ticket;
    this.grid.loadTicket(ticket);
    this.updateToGo();
  }

  markNumber(number: number): boolean {
    const marked = this.grid.markNumber(number);
    if (marked) this.updateToGo();
    return marked;
  }

  markNumbers(numbers: number[]): void {
    this.grid.markNumbers(numbers);
    this.updateToGo();
  }

  getRemainingCount(): number {
    return this.grid.getRemainingCount();
  }

  highlightLuckyNumber(luckyNumber: number): void {
    const cell = this.grid.getCell(luckyNumber);
    if (cell) cell.setHighlight(true);
  }

  reset(): void {
    this.grid.reset();
    this.updateToGo();
  }

  get cardWidth(): number {
    return this.cardW;
  }

  get cardHeight(): number {
    return this.cardH;
  }

  /** Update the header label (e.g. for Elvis variant: "Elvis 1" or Traffic Light colors). */
  setHeaderLabel(label: string): void {
    this.headerText.text = label;
  }

  /** Set the price display on the card (right side of header bar). */
  setPrice(amount: number): void {
    this.priceText.text = `${amount}kr`;
  }

  /** Stop all card-level animations (background blink, BINGO pulse, flip timer). */
  stopCardAnimations(): void {
    this.stopBgBlink();
    this.stopBingoAnimation();
    if (this.flipAutoTimer !== null) {
      clearTimeout(this.flipAutoTimer);
      this.flipAutoTimer = null;
    }
  }

  /**
   * Hard reset of ALL card + grid animations — used at game-end / scene reset.
   *
   * Called by Game1Controller.onGameEnded so that cells that were mid-blink,
   * cards mid-BINGO-pulse, or cards mid-flip do not keep animating after the
   * round ends and the UI transitions to the EndScreen / waiting mode.
   *
   * Unity reference: BingoTicket.Stop_Blink (legacy/unity-client/Assets/
   * _Project/_Scripts/Prefabs/Bingo Tickets/BingoTicket.cs:1011-1016) — the
   * Unity method cancels LeanTween tweens on both `imgTicket` (card bg) and
   * each cell's `txtNumber`/`imgCellOneToGo`, then calls `Set_Color_Callback`
   * to restore the original color. No scale animation on reset.
   *
   * Game-finish handler: Game1GamePlayPanel.OnGameFinish (legacy/unity-client/
   * Assets/_Project/_Scripts/Panels/Game/Game1GamePlayPanel.SocketFlow.cs:
   * 595-616) calls Stop_Blink on every ticket.
   *
   * Flip edge case: Unity has no mid-game flip animation, so there is nothing
   * to cancel at game-end Unity-side. Web-side we cancel the flip-tween and
   * force the card back to the grid view (no animation).
   */
  stopAllAnimations(): void {
    // 1. Card-level (bg blink, BINGO pulse, flip-auto timer).
    this.stopCardAnimations();

    // 2. Grid / cells (mark bounce, 1-to-go blink).
    this.grid.stopAllAnimations();

    // 3. Cancel any in-flight flip tween and snap to grid-view without
    //    animation (Unity has no flip at game-end — we fully reset).
    gsap.killTweensOf(this.scale);
    this.scale.set(1, 1);
    if (this.isFlipping || this.isFlipped) {
      // Restore grid-view visibility directly — no tween.
      this.grid.visible = true;
      this.toGoText.visible = true;
      this.headerBg.visible = true;
      this.headerText.visible = true;
      this.priceText.visible = true;
      this.cardBg.visible = true;
      if (this.detailsOverlay) this.detailsOverlay.visible = false;
      // Reset pivot / position offset applied by flipToDetails.
      if (this.pivot.x !== 0) {
        this.x -= this.pivot.x;
        this.pivot.x = 0;
      }
      this.isFlipping = false;
      this.isFlipped = false;
    }
  }

  /**
   * Hide this card's own header/price/to-go chrome so only the BingoGrid +
   * per-mini background remain visible. Used when this card lives inside a
   * TicketGroup (Elvis/Large/Traffic) where the group owns the outer chrome.
   *
   * Unity equivalent: PrefabBingoGame1LargeTicket5x5.Set_Ticket_Color
   * (legacy/unity-client/Assets/_Project/_Scripts/Prefabs/Bingo Tickets/
   * PrefabBingoGame1LargeTicket5x5.cs:18) sets
   *   Mini_Tickets[i].imgTicket.color = color.BG_Color
   * for EACH mini — i.e. every mini keeps its own per-theme BG image.
   * That per-mini BG is exactly what the 1-to-go blink animates
   * (BingoTicket.cs:1020-1033, `imgTicket.color` tween), so we MUST keep
   * `cardBg` visible here — previously hiding it made the blink invisible
   * when tickets were grouped (G5 bug).
   */
  setMiniMode(): void {
    // Keep cardBg visible so per-mini bg-blink is rendered (Unity: imgTicket
    // is always visible inside a Large/Elvis/Traffic group).
    this.cardBg.visible = true;
    this.headerBg.visible = false;
    this.headerText.visible = false;
    this.priceText.visible = false;
    this.toGoText.visible = false;
    // Tighten layout: drop the grid to the top so the card bounds are just
    // the grid itself.
    this.grid.x = 0;
    this.grid.y = 0;
    this.cardW = this.grid.gridWidth;
    this.cardH = this.grid.gridHeight;
    // Re-draw cardBg at the new (smaller) mini bounds so it sits exactly
    // under the grid. Uses the theme-provided cardBgColor from the
    // constructor — Unity's BG_Color per-mini.
    this.cardBg.clear();
    this.cardBg.roundRect(0, 0, this.cardW, this.cardH, 6);
    this.cardBg.fill(this.cardBgColor);
  }

  // ── Flip animation (Unity: Y-rotation 0→90→0 mapped to scaleX) ─────

  /**
   * Flip the card to show details (ticket number, hall, supplier, price,
   * bought-at). 5-row layout mirrors Unity BingoTicket.cs:374-399 (SetData) —
   * txtTicketNumber, txtHallName, txtSupplierName, txtTicketPrice plus a web-
   * only bought-at timestamp.
   *
   * GSAP animation: scaleX 1→0 (0.25s), swap content, scaleX 0→1 (0.25s).
   * Auto-flips back after 3.0s.
   */
  flipToDetails(): void {
    if (this.isFlipping || this.isFlipped) return;
    this.isFlipping = true;

    // Resolve detail strings with graceful fallback when the backend hasn't
    // populated a field (G15 optional shared-types fields).
    const t = this.ticket;
    const ticketNumStr = t?.ticketNumber ?? String(this.ticketIndex + 1);
    const hallStr = t?.hallName ?? "";
    const supplierStr = t?.supplierName ?? "";
    const priceStr = typeof t?.price === "number" ? `${Math.round(t.price)} kr` : this.priceText.text;
    const boughtStr = t?.boughtAt ? formatBoughtAt(t.boughtAt) : "";

    // Build details overlay if it doesn't exist yet
    if (!this.detailsOverlay) {
      this.detailsOverlay = new Container();

      // Background matching the card
      const bg = new Graphics();
      bg.roundRect(0, 0, this.cardW, this.cardH, 8);
      bg.fill(this.cardBgColor);
      this.detailsOverlay.addChild(bg);

      const centerX = this.cardW / 2;
      // Row layout: 5 rows stacked centrally. Dynamic row-height so the text
      // always fits inside `cardH` no matter the grid size (Unity anchors
      // rows proportionally; we approximate with even vertical spacing).
      const rowCount = 5;
      const rowGap = Math.max(14, Math.floor((this.cardH - 20) / (rowCount + 1)));
      const startY = Math.max(12, (this.cardH - rowGap * (rowCount - 1)) / 2);

      // Row 1: "Bong #123" (ticket number)
      const numText = new Text({
        text: `Bong #${ticketNumStr}`,
        style: {
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 15,
          fontWeight: "bold",
          fill: this.headerTextColor,
          align: "center",
        },
      });
      numText.anchor.set(0.5);
      numText.x = centerX;
      numText.y = startY;
      this.detailsOverlay.addChild(numText);

      // Row 2: hall name
      const hallInfo = new Text({
        text: hallStr,
        style: {
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 12,
          fill: 0x444444,
          align: "center",
        },
      });
      hallInfo.anchor.set(0.5);
      hallInfo.x = centerX;
      hallInfo.y = startY + rowGap;
      this.detailsOverlay.addChild(hallInfo);

      // Row 3: supplier/operator
      const supplierInfo = new Text({
        text: supplierStr,
        style: {
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 12,
          fill: 0x444444,
          align: "center",
        },
      });
      supplierInfo.anchor.set(0.5);
      supplierInfo.x = centerX;
      supplierInfo.y = startY + rowGap * 2;
      this.detailsOverlay.addChild(supplierInfo);

      // Row 4: price
      const priceInfo = new Text({
        text: priceStr,
        style: {
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 14,
          fontWeight: "bold",
          fill: 0x2a9d8f,
          align: "center",
        },
      });
      priceInfo.anchor.set(0.5);
      priceInfo.x = centerX;
      priceInfo.y = startY + rowGap * 3;
      this.detailsOverlay.addChild(priceInfo);

      // Row 5: bought-at time (HH:mm)
      const boughtInfo = new Text({
        text: boughtStr,
        style: {
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 11,
          fill: 0x666666,
          align: "center",
        },
      });
      boughtInfo.anchor.set(0.5);
      boughtInfo.x = centerX;
      boughtInfo.y = startY + rowGap * 4;
      this.detailsOverlay.addChild(boughtInfo);

      this.detailsOverlay.visible = false;
      this.addChild(this.detailsOverlay);
    }

    // Update details text to current values (tickets can change between flips).
    const detailTexts = this.detailsOverlay.children.filter(
      (c): c is Text => c instanceof Text,
    );
    if (detailTexts.length >= 5) {
      detailTexts[0].text = `Bong #${ticketNumStr}`;
      detailTexts[1].text = hallStr;
      detailTexts[2].text = supplierStr;
      detailTexts[3].text = priceStr;
      detailTexts[4].text = boughtStr;
    }

    // Animate: scale X to 0, swap, scale X back to 1
    const pivotX = this.cardW / 2;
    this.pivot.x = pivotX;
    this.x += pivotX;

    gsap.to(this.scale, {
      x: 0,
      duration: 0.25,
      ease: "power2.in",
      onComplete: () => {
        // Hide front, show back
        this.grid.visible = false;
        this.toGoText.visible = false;
        this.headerBg.visible = false;
        this.headerText.visible = false;
        this.priceText.visible = false;
        this.cardBg.visible = false;
        if (this.detailsOverlay) this.detailsOverlay.visible = true;

        gsap.to(this.scale, {
          x: 1,
          duration: 0.25,
          ease: "power2.out",
          onComplete: () => {
            this.isFlipping = false;
            this.isFlipped = true;

            // Auto-flip back after 3.0s
            this.flipAutoTimer = setTimeout(() => {
              this.flipAutoTimer = null;
              this.flipToGrid();
            }, 3000);
          },
        });
      },
    });
  }

  /**
   * Flip the card back to show the normal grid view.
   */
  flipToGrid(): void {
    if (this.isFlipping || !this.isFlipped) return;
    this.isFlipping = true;

    // Cancel auto-flip timer if still pending
    if (this.flipAutoTimer !== null) {
      clearTimeout(this.flipAutoTimer);
      this.flipAutoTimer = null;
    }

    gsap.to(this.scale, {
      x: 0,
      duration: 0.25,
      ease: "power2.in",
      onComplete: () => {
        // Show front, hide back
        this.grid.visible = true;
        this.toGoText.visible = true;
        this.headerBg.visible = true;
        this.headerText.visible = true;
        this.priceText.visible = true;
        this.cardBg.visible = true;
        if (this.detailsOverlay) this.detailsOverlay.visible = false;

        gsap.to(this.scale, {
          x: 1,
          duration: 0.25,
          ease: "power2.out",
          onComplete: () => {
            // BIN-687: reset pivot + x-offset applied by flipToDetails
            // (lines 439-441). Without this, each flip accumulates
            // `this.x += cardW/2`, drifting the card sideways until it
            // overlaps its neighbours. Mirrors the reset in
            // stopAllAnimations (lines 256-260).
            if (this.pivot.x !== 0) {
              this.x -= this.pivot.x;
              this.pivot.x = 0;
            }
            this.isFlipping = false;
            this.isFlipped = false;
          },
        });
      },
    });
  }

  private updateToGo(): void {
    const remaining = this.grid.getRemainingCount();
    if (remaining === 0) {
      this.toGoText.text = "Ferdig!";
      this.toGoText.style.fill = 0x2a9d8f;
      // Stop any one-to-go blink animations (Unity: Stop_Blink)
      this.grid.stopAllBlinks();
      this.stopBgBlink();
      // Play BINGO celebration animation (Unity: pattern complete pulse)
      this.playBingoAnimation();
    } else if (remaining === 1) {
      this.toGoText.text = "1 ToGo!";
      this.toGoText.style.fill = this.toGoCloseColor;
      // Blink the remaining unmarked cell with one-to-go color (Unity: Start_NumberBlink + imgCellOneToGo)
      this.grid.blinkCells(this.grid.getUnmarkedNumbers(), ONE_TO_GO_COLOR);
      // Blink the entire card background (Unity: Blink_On_1_Color, 0.5s ping-pong)
      this.startBgBlink();
    } else {
      this.toGoText.text = `${remaining} ToGo`;
      this.toGoText.style.fill = remaining <= 3 ? this.toGoCloseColor : this.toGoNormalColor;
      // Stop card-level blinks when no longer 1-to-go
      this.stopBgBlink();
    }
  }

  // ── Card background blink (Unity: Blink_On_1_Color) ──────────────────

  /** Highlight color for 1-to-go background blink (bright gold / yellow). */
  private static readonly BLINK_ON_1_COLOR = 0xffe83d;

  /**
   * Start blinking the card background between its normal color and
   * the highlight color.
   *
   * Unity reference: BingoTicket.cs:1020-1033 (Blink_On_1_Color path).
   *   LT.value(imgTicket, Set_Color_Callback, Current_Color, Blink_On_1_Color, 0.5f)
   *     .setOnComplete(() => LT.value(..., Blink_On_1_Color, Current_Color, 0.5f))
   *     .setLoopCount(-1)
   *
   * Behaviour: 0.5s from base → highlight, 0.5s back, infinite loop.
   * LeanTween default ease is `linear`, so we use `none`/`linear` in GSAP
   * for an identical interpolation curve.
   */
  private startBgBlink(): void {
    if (this.bgBlinkTween) return; // already blinking

    // GSAP color tween requires an object proxy — we interpolate a 0→1 ratio
    // and redraw the card background each frame. yoyo+repeat(-1) matches
    // the Unity up-then-down-then-up loop.
    const proxy = { t: 0 };
    this.bgBlinkTween = gsap.to(proxy, {
      t: 1,
      duration: 0.5,
      yoyo: true,
      repeat: -1,
      ease: "none", // Unity LeanTween.value default = linear
      onUpdate: () => {
        const blended = this.lerpColor(this.cardBgColor, TicketCard.BLINK_ON_1_COLOR, proxy.t);
        this.cardBg.clear();
        this.cardBg.roundRect(0, 0, this.cardW, this.cardH, 8);
        this.cardBg.fill(blended);
      },
    });
  }

  private stopBgBlink(): void {
    if (!this.bgBlinkTween) return;
    this.bgBlinkTween.kill();
    this.bgBlinkTween = null;
    // Restore original card background
    this.cardBg.clear();
    this.cardBg.roundRect(0, 0, this.cardW, this.cardH, 8);
    this.cardBg.fill(this.cardBgColor);
  }

  // ── BINGO pulse animation (Unity: scale 0.85→1.05, 0.25s, 6 reps) ───

  /**
   * Play the BINGO celebration animation when a pattern is completed.
   *
   * Unity reference: BingoTicket.Bingo_Highlight_Anim() at
   * legacy/unity-client/Assets/_Project/_Scripts/Prefabs/Bingo Tickets/
   * BingoTicket.cs:1035-1056.
   *
   * Unity flow (coroutine):
   *   Bingo.SetActive(true)                             // overlay visible immediately
   *   there:
   *     LT.scale(0.85, 0.25).onComplete(LT.scale(1.05, 0.25))
   *     yield WaitForSeconds(0.5)                       // scale sequence is 0.5s total
   *     if (callback < 5) { callback++; goto there; }   // 6 iterations total
   *
   * Web implementation: 6 back-to-back iterations of (0.85 @ 0.25s → 1.05 @
   * 0.25s) via gsap timeline — the 0.5s wait in Unity runs in parallel with
   * the scale sequence, so there is no gap between iterations.
   *
   * Trigger (Unity BingoTicket.cs:766-775): Set_Togo_Txt() checks if local
   * `count === 0` and only then launches this coroutine. Web equivalent is
   * `remaining === 0` in updateToGo() above. Text is hardcoded "BINGO!".
   */
  playBingoAnimation(): void {
    this.stopBingoAnimation();

    // Show "BINGO!" overlay text on the card (Unity: Bingo.SetActive(true)
    // fires at the very start of the coroutine, before any scale tween).
    if (!this.bingoOverlay) {
      this.bingoOverlay = new Text({
        text: "BINGO!",
        style: {
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 28,
          fontWeight: "bold",
          fill: 0xffe83d,
          stroke: { color: 0x790001, width: 3 },
          align: "center",
        },
      });
      this.bingoOverlay.anchor.set(0.5);
      this.bingoOverlay.x = this.cardW / 2;
      this.bingoOverlay.y = this.cardH / 2;
      this.addChild(this.bingoOverlay);
    }
    this.bingoOverlay.visible = true;
    this.bingoOverlay.alpha = 1;

    // Scale pulse timeline: 6 iterations × (0.85 @ 0.25s → 1.05 @ 0.25s).
    this.bingoTimeline = gsap.timeline();
    for (let i = 0; i < 6; i++) {
      this.bingoTimeline
        .to(this.scale, { x: 0.85, y: 0.85, duration: 0.25, ease: "power2.inOut" })
        .to(this.scale, { x: 1.05, y: 1.05, duration: 0.25, ease: "power2.inOut" });
    }
    // Settle back to 1.0 at the end (defensive: avoids lingering 1.05 scale
    // if the card later re-renders; Unity's prefab sits in a LayoutGroup that
    // absorbs this naturally).
    this.bingoTimeline.to(this.scale, { x: 1, y: 1, duration: 0.15, ease: "power2.out" });
  }

  private stopBingoAnimation(): void {
    if (this.bingoTimeline) {
      this.bingoTimeline.kill();
      this.bingoTimeline = null;
    }
    gsap.set(this.scale, { x: 1, y: 1 });
    if (this.bingoOverlay) {
      this.bingoOverlay.visible = false;
    }
  }

  // ── Utility ──────────────────────────────────────────────────────────

  /** Linear interpolation between two 0xRRGGBB colors. */
  private lerpColor(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return (r << 16) | (g << 8) | bl;
  }
}

/**
 * G15: format an ISO-8601 timestamp as "HH:mm" in the local timezone.
 * Falls back to the raw string if the Date parse fails (defensive).
 */
function formatBoughtAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
