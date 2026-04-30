import type { HtmlOverlayManager } from "./HtmlOverlayManager.js";
import { getBallAssetPath } from "./BallTube.js";

/**
 * Maps number to CSS ball color for Bingo75 columns (5 cols × 15 balls, B-I-N-G-O):
 *   Col B (1-15)  = blue
 *   Col I (16-30) = red
 *   Col N (31-45) = purple
 *   Col G (46-60) = green
 *   Col O (61-75) = yellow
 *
 * Game 1 (bingo) runs on the 75-ball bag — see backend/src/util/roomState.ts:115
 * where gameSlug "bingo" uses generateBingo75Ticket. The Unity reference uses
 * colour *strings* delivered by server (`blue`/`red`/…), but the Spillorama
 * backend doesn't emit colour strings, so we derive colour from the ball
 * number via the canonical 75-ball column mapping. Palette matches BallTube.ts
 * to keep the tube and "Oppleste tall" overlay visually consistent.
 *
 * **Tobias 2026-04-30:** CSS-gradient-en er beholdt som under-laget i
 * `render()` (bak PNG-bildet) slik at modal-en aldri viser tomme sirkler
 * hvis PNG-en ikke laster. Hovedrendering bruker `getBallAssetPath` (samme
 * som BallTube i spillet) for visuell paritet.
 */
export function getBallColorCSS(n: number): string {
  if (n <= 15) return "background:radial-gradient(circle at 38% 32%,#3a7adf,#0d2f8a 70%);box-shadow:0 0 8px rgba(40,80,220,0.4);";   // Blue  (B)
  if (n <= 30) return "background:radial-gradient(circle at 38% 32%,#e84040,#8b0000 70%);box-shadow:0 0 8px rgba(220,40,40,0.4);";   // Red   (I)
  if (n <= 45) return "background:radial-gradient(circle at 38% 32%,#cc44cc,#6a006a 70%);box-shadow:0 0 8px rgba(180,40,180,0.4);";   // Purple(N)
  if (n <= 60) return "background:radial-gradient(circle at 38% 32%,#6ecf3a,#2a7a00 70%);box-shadow:0 0 8px rgba(100,220,40,0.4);";   // Green (G)
  return "background:radial-gradient(circle at 38% 32%,#f0c020,#8a7000 70%);box-shadow:0 0 8px rgba(200,170,20,0.4);";                 // Yellow(O, 61-75)
}

/**
 * Fullscreen HTML overlay showing all drawn numbers as colored balls
 * in a grid layout, matching Unity's WithdrawNumberHistoryPanel.
 *
 * Opened via "Se oppleste tall" button.
 */
export class CalledNumbersOverlay {
  private backdrop: HTMLDivElement;
  private grid: HTMLDivElement;
  private countEl: HTMLSpanElement;
  private drawnNumbers: number[] = [];

  constructor(private overlay: HtmlOverlayManager) {
    // Full-screen backdrop
    this.backdrop = document.createElement("div");
    Object.assign(this.backdrop.style, {
      position: "absolute",
      inset: "0",
      background: "rgba(0,0,0,0.88)",
      backdropFilter: "blur(4px)",
      display: "none",
      flexDirection: "column",
      alignItems: "center",
      padding: "30px 20px",
      zIndex: "50",
      pointerEvents: "auto",
      overflow: "auto",
    });
    overlay.getRoot().appendChild(this.backdrop);

    // Header row
    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;width:100%;max-width:700px;margin-bottom:20px;";

    const title = document.createElement("h2");
    title.textContent = "Oppleste tall";
    title.style.cssText = "font-size:22px;font-weight:700;color:#ffe83d;margin:0;";
    header.appendChild(title);

    this.countEl = document.createElement("span");
    this.countEl.style.cssText = "font-size:14px;color:#aaa;";
    header.appendChild(this.countEl);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "\u2715";
    closeBtn.setAttribute("aria-label", "Lukk oppleste tall");
    closeBtn.title = "Lukk";
    Object.assign(closeBtn.style, {
      background: "rgba(255,255,255,0.15)",
      border: "1px solid rgba(255,255,255,0.3)",
      borderRadius: "50%",
      width: "36px",
      height: "36px",
      color: "#fff",
      fontSize: "18px",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "inherit",
    });
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(closeBtn);

    this.backdrop.appendChild(header);

    // Ball grid
    this.grid = document.createElement("div");
    Object.assign(this.grid.style, {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, 52px)",
      gap: "8px",
      justifyContent: "center",
      width: "100%",
      maxWidth: "700px",
    });
    this.backdrop.appendChild(this.grid);
  }

  /** True hvis grid-DOM er ute av sync med `drawnNumbers`. Settes av
   *  setNumbers/clearNumbers/addNumber og tømmes av render(). Brukes for
   *  å utsette DOM-rebuild til overlay faktisk vises. */
  private dirty = false;

  /** Replace all drawn numbers (used on reconnect / initial load).
   *
   *  BIN-blink-permanent-fix: render() kjører KUN hvis overlay er synlig.
   *  PlayScreen.syncBallHistory kaller setNumbers hver state-update med
   *  samme array — tidligere trigget det full DOM-rebuild (innerHTML = ""
   *  + N × appendChild) selv om overlay var display:none. Nå markerer vi
   *  bare `dirty` og utsetter render til `show()` kjøres. Under spill
   *  med 70 baller trukket sparte dette 70 × updateRate ≈ hundrevis av
   *  mutasjoner per sekund i et usynlig element. */
  setNumbers(numbers: number[]): void {
    // Hopp over hvis innholdet er identisk (samme rekkefølge + lengde).
    if (this.drawnNumbers.length === numbers.length) {
      let identical = true;
      for (let i = 0; i < numbers.length; i++) {
        if (this.drawnNumbers[i] !== numbers[i]) { identical = false; break; }
      }
      if (identical) return;
    }
    this.drawnNumbers = [...numbers];
    this.dirty = true;
    if (this.isShowing()) this.render();
  }

  /** Clear all drawn numbers (used on game end / new round). */
  clearNumbers(): void {
    if (this.drawnNumbers.length === 0 && !this.dirty) return;
    this.drawnNumbers = [];
    this.dirty = false;
    this.grid.innerHTML = "";
    this.countEl.textContent = "0 tall trukket";
  }

  addNumber(number: number): void {
    this.drawnNumbers.push(number);
    this.dirty = true;
    if (this.isShowing()) this.render();
  }

  show(): void {
    if (this.dirty) this.render();
    this.backdrop.style.display = "flex";
  }

  hide(): void {
    this.backdrop.style.display = "none";
  }

  toggle(): void {
    if (this.isShowing()) this.hide();
    else this.show();
  }

  isShowing(): boolean {
    return this.backdrop.style.display !== "none";
  }

  private render(): void {
    this.grid.innerHTML = "";
    this.countEl.textContent = `${this.drawnNumbers.length} tall trukket`;

    for (const n of this.drawnNumbers) {
      // Tobias 2026-04-30: PNG-baller for visuell paritet med BallTube i
      // hovedspillet. CSS-gradient-en under bildet er fall-back hvis PNG-en
      // ikke laster (load-error → tomme-sirkler-bug unngås).
      const ball = document.createElement("div");
      ball.style.cssText = `
        width:48px;height:48px;border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        font-size:18px;font-weight:700;color:#fff;
        text-shadow:0 1px 2px rgba(0,0,0,0.6);
        flex-shrink:0;position:relative;
        ${getBallColorCSS(n)}
      `;
      const img = document.createElement("img");
      img.src = getBallAssetPath(n);
      img.alt = "";
      img.draggable = false;
      img.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;border-radius:50%;object-fit:cover;pointer-events:none;user-select:none;";
      ball.appendChild(img);

      const numberEl = document.createElement("span");
      numberEl.textContent = String(n);
      numberEl.style.cssText = "position:relative;z-index:1;";
      ball.appendChild(numberEl);

      this.grid.appendChild(ball);
    }
    this.dirty = false;
  }

  destroy(): void {
    this.backdrop.remove();
  }
}
