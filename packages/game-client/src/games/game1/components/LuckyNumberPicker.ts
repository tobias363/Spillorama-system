/**
 * Lucky number picker popup — matches Unity's SelectLuckyNumberPanel.
 *
 * Tobias 2026-04-30:
 *   - Utvidet fra 60 til 75 baller (5 col × 15 rader = Bingo75-kolonner B-I-N-G-O)
 *     for å matche hovedspillet (Spill 1 trekker fra 1-75, ikke 1-60).
 *     Tidligere brukte denne Databingo60-mapping (5 col × 12 rader) som var
 *     feil for Spill 1 — spillere kunne ikke velge lucky number > 60.
 *   - PNG-baller via `getBallAssetPath` (samme som BallTube/CalledNumbersOverlay)
 *     for visuell paritet med selve spillet.
 *
 * - SelectLuckyNumberPanel.cs — panel with number buttons
 * - Game1GamePlayPanel.Interactions.cs — OnLuckyNumberSelection()
 * - SpilloramaSocketManager.SetLuckyNumber()
 */

import { getBallAssetPath } from "./BallTube.js";

/**
 * Bingo75 column color for a given number (5 cols of 15, B-I-N-G-O).
 * Beholdes som CSS-fallback bak PNG-en — samme partisjon som BallTube +
 * CalledNumbersOverlay for å unngå tomme sirkler ved PNG-load-failure.
 */
function getColumnStyle(n: number): string {
  if (n <= 15) return "background:linear-gradient(135deg,#4a90d9,#1a5ba8);"; // B (1-15) - blue
  if (n <= 30) return "background:linear-gradient(135deg,#e05050,#a01818);"; // I (16-30) - red
  if (n <= 45) return "background:linear-gradient(135deg,#7c50c8,#4a1a90);"; // N (31-45) - purple
  if (n <= 60) return "background:linear-gradient(135deg,#4caf50,#1b5e20);"; // G (46-60) - green
  return "background:linear-gradient(135deg,#f0a020,#c07000);";              // O (61-75) - yellow
}

export class LuckyNumberPicker {
  private backdrop: HTMLDivElement;
  private selectedNumber: number | null = null;
  private onSelect: ((n: number) => void) | null = null;
  private buttons: HTMLButtonElement[] = [];

  constructor(container: HTMLElement) {
    // Full-screen backdrop
    this.backdrop = document.createElement("div");
    Object.assign(this.backdrop.style, {
      position: "absolute",
      inset: "0",
      background: "rgba(0,0,0,0.9)",
      backdropFilter: "blur(4px)",
      display: "none",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      zIndex: "60",
      pointerEvents: "auto",
    });
    container.appendChild(this.backdrop);

    // Panel
    const panel = document.createElement("div");
    Object.assign(panel.style, {
      background: "linear-gradient(180deg, #2a1a0a 0%, #1a0a00 100%)",
      border: "2px solid rgba(255,200,100,0.3)",
      borderRadius: "16px",
      padding: "24px",
      maxWidth: "500px",
      width: "100%",
      maxHeight: "80vh",
      overflow: "auto",
    });
    this.backdrop.appendChild(panel);

    // Header
    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;";

    const title = document.createElement("h3");
    title.textContent = "Velg heldig tall";
    title.style.cssText = "color:#ffe83d;font-size:20px;font-weight:700;margin:0;";
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Lukk velg heldig tall");
    closeBtn.title = "Lukk";
    closeBtn.textContent = "\u2715";
    Object.assign(closeBtn.style, {
      background: "rgba(255,255,255,0.15)",
      border: "1px solid rgba(255,255,255,0.3)",
      borderRadius: "50%",
      width: "32px",
      height: "32px",
      color: "#fff",
      fontSize: "16px",
      cursor: "pointer",
      fontFamily: "inherit",
    });
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Column headers (B I N G O)
    const colHeaders = document.createElement("div");
    colHeaders.style.cssText = "display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-bottom:8px;text-align:center;";
    for (const letter of ["B", "I", "N", "G", "O"]) {
      const lbl = document.createElement("div");
      lbl.textContent = letter;
      lbl.style.cssText = "color:#ffe83d;font-size:18px;font-weight:700;";
      colHeaders.appendChild(lbl);
    }
    panel.appendChild(colHeaders);

    // Number grid — 5 columns × 15 rows (Bingo75: B 1-15, I 16-30, N 31-45,
    // G 46-60, O 61-75). Tobias 2026-04-30: tidligere 12 rader (Databingo60)
    // — utvidet til 15 så hele Spill 1-bag-en er valgbar.
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(5,1fr);gap:4px;";

    // Layout: column-first to match Bingo75 columns of 15
    for (let row = 0; row < 15; row++) {
      for (let col = 0; col < 5; col++) {
        const num = col * 15 + row + 1;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("aria-label", `Velg tall ${num}`);
        btn.dataset.num = String(num);
        Object.assign(btn.style, {
          width: "100%",
          aspectRatio: "1",
          borderRadius: "50%",
          border: "2px solid transparent",
          color: "#fff",
          fontSize: "14px",
          fontWeight: "700",
          cursor: "pointer",
          fontFamily: "inherit",
          textShadow: "0 1px 2px rgba(0,0,0,0.6)",
          transition: "transform 0.15s, border-color 0.15s",
          position: "relative",
          padding: "0",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        });
        // CSS-gradient som under-lag for PNG-fallback (samme palette som BallTube).
        btn.style.cssText += getColumnStyle(num);

        // PNG-ball som hovedrendering (visuell paritet med BallTube).
        const img = document.createElement("img");
        img.src = getBallAssetPath(num);
        img.alt = "";
        img.draggable = false;
        img.style.cssText =
          "position:absolute;inset:0;width:100%;height:100%;border-radius:50%;object-fit:cover;pointer-events:none;user-select:none;";
        btn.appendChild(img);

        // Tall-tekst som span over PNG-en.
        const numberEl = document.createElement("span");
        numberEl.textContent = String(num);
        numberEl.style.cssText = "position:relative;z-index:1;pointer-events:none;";
        btn.appendChild(numberEl);

        btn.addEventListener("click", () => this.selectNumber(num));
        btn.addEventListener("mouseenter", () => { btn.style.transform = "scale(1.12)"; });
        btn.addEventListener("mouseleave", () => { btn.style.transform = "scale(1)"; });

        this.buttons.push(btn);
        grid.appendChild(btn);
      }
    }
    panel.appendChild(grid);

    // "Fjern heldig tall" button
    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Fjern heldig tall";
    Object.assign(clearBtn.style, {
      marginTop: "16px",
      width: "100%",
      padding: "10px",
      background: "rgba(255,255,255,0.1)",
      border: "1px solid rgba(255,255,255,0.3)",
      borderRadius: "8px",
      color: "#ccc",
      fontSize: "14px",
      cursor: "pointer",
      fontFamily: "inherit",
    });
    clearBtn.addEventListener("click", () => {
      this.selectedNumber = null;
      this.updateSelection();
      this.onSelect?.(0); // 0 = clear
      this.hide();
    });
    panel.appendChild(clearBtn);

    // Close on backdrop click
    this.backdrop.addEventListener("click", (e) => {
      if (e.target === this.backdrop) this.hide();
    });
  }

  setOnSelect(callback: (n: number) => void): void {
    this.onSelect = callback;
  }

  show(currentLucky: number | null = null): void {
    this.selectedNumber = currentLucky;
    this.updateSelection();
    this.backdrop.style.display = "flex";
  }

  hide(): void {
    this.backdrop.style.display = "none";
  }

  isShowing(): boolean {
    return this.backdrop.style.display !== "none";
  }

  destroy(): void {
    this.backdrop.remove();
  }

  private selectNumber(num: number): void {
    this.selectedNumber = num;
    this.updateSelection();
    this.onSelect?.(num);
    // Brief delay then close
    setTimeout(() => this.hide(), 300);
  }

  private updateSelection(): void {
    for (const btn of this.buttons) {
      const num = parseInt(btn.dataset.num ?? "0", 10);
      if (num === this.selectedNumber) {
        btn.style.borderColor = "#ffe83d";
        btn.style.boxShadow = "0 0 12px rgba(255,232,61,0.6)";
        btn.style.transform = "scale(1.15)";
      } else {
        btn.style.borderColor = "transparent";
        btn.style.boxShadow = "none";
        btn.style.transform = "scale(1)";
      }
    }
  }
}
