/**
 * Change marker & background panel — matches Unity's ChangeMarkerBackgroundPanel.
 *
 * Two tabs:
 * - "Markør": 6 marker styles (different shapes/colors)
 * - "Bakgrunn": 5 background options
 *
 * Selections persist in localStorage.
 *
 * - ChangeMarkerBackgroundPanel.cs — OnMarkerButtonTap, OnBackgroundButtonTap
 * - UIManager.GamePresentation.cs — GetMarkerData(id), GetBackgroundSprite(id)
 */

const MARKER_STORAGE_KEY = "spillorama_game1_marker";
const BG_STORAGE_KEY = "spillorama_game1_background";

export interface MarkerStyle {
  id: number;
  label: string;
  color: string;
  shape: string; // CSS border-radius or clip-path
}

const MARKER_STYLES: MarkerStyle[] = [
  { id: 1, label: "Sirkel", color: "#7e001b", shape: "50%" },
  { id: 2, label: "Firkant", color: "#1a5ba8", shape: "4px" },
  { id: 3, label: "Diamant", color: "#6a006a", shape: "50% 0 50% 0" },
  { id: 4, label: "Stjerne", color: "#2a7a00", shape: "50%" },
  { id: 5, label: "Hjerte", color: "#c41030", shape: "50%" },
  { id: 6, label: "Kryss", color: "#8a7000", shape: "4px" },
];

const BG_OPTIONS = [
  { id: 0, label: "Mørk rød", color: "#2a0a0a" },
  { id: 1, label: "Mørk blå", color: "#0a0a2a" },
  { id: 2, label: "Mørk grønn", color: "#0a2a0a" },
  { id: 3, label: "Mørk lilla", color: "#1a0a2a" },
  { id: 4, label: "Sort", color: "#0a0a0a" },
];

export class MarkerBackgroundPanel {
  private backdrop: HTMLDivElement;
  private onMarkerChange: ((id: number) => void) | null = null;
  private onBgChange: ((id: number) => void) | null = null;
  private selectedMarkerId: number;
  private selectedBgId: number;

  constructor(container: HTMLElement) {
    this.selectedMarkerId = parseInt(localStorage.getItem(MARKER_STORAGE_KEY) ?? "1", 10);
    this.selectedBgId = parseInt(localStorage.getItem(BG_STORAGE_KEY) ?? "0", 10);

    this.backdrop = document.createElement("div");
    Object.assign(this.backdrop.style, {
      position: "absolute",
      inset: "0",
      background: "rgba(0,0,0,0.9)",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "65",
      pointerEvents: "auto",
    });
    this.backdrop.addEventListener("click", (e) => {
      if (e.target === this.backdrop) this.hide();
    });
    container.appendChild(this.backdrop);

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      background: "linear-gradient(180deg, #2a1a0a 0%, #1a0a00 100%)",
      border: "2px solid rgba(255,200,100,0.3)",
      borderRadius: "16px",
      padding: "24px",
      maxWidth: "420px",
      width: "90%",
    });
    this.backdrop.appendChild(panel);

    // Header
    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;";
    const title = document.createElement("h3");
    title.textContent = "Markør og bakgrunn";
    title.style.cssText = "color:#ffe83d;font-size:20px;font-weight:700;margin:0;";
    header.appendChild(title);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "\u2715";
    closeBtn.setAttribute("aria-label", "Lukk mark\u00f8r- og bakgrunnsvalg");
    closeBtn.title = "Lukk";
    closeBtn.style.cssText = "background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);border-radius:50%;width:32px;height:32px;color:#fff;font-size:16px;cursor:pointer;font-family:inherit;";
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Tab: Markers
    const markerSection = document.createElement("div");
    markerSection.style.cssText = "margin-bottom:20px;";
    const markerTitle = document.createElement("div");
    markerTitle.textContent = "Velg markør";
    markerTitle.style.cssText = "color:#ddd;font-size:14px;font-weight:600;margin-bottom:10px;";
    markerSection.appendChild(markerTitle);

    const markerGrid = document.createElement("div");
    markerGrid.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:10px;";
    for (const style of MARKER_STYLES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", `Velg markør: ${style.label}`);
      btn.setAttribute("aria-pressed", String(style.id === this.selectedMarkerId));
      Object.assign(btn.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "10px",
        background: style.id === this.selectedMarkerId ? "rgba(255,232,61,0.15)" : "rgba(0,0,0,0.3)",
        border: style.id === this.selectedMarkerId ? "2px solid #ffe83d" : "1px solid rgba(255,255,255,0.15)",
        borderRadius: "8px",
        cursor: "pointer",
        fontFamily: "inherit",
        color: "#ddd",
        fontSize: "12px",
      });
      const swatch = document.createElement("div");
      swatch.setAttribute("aria-hidden", "true");
      swatch.style.cssText = `width:24px;height:24px;background:${style.color};border-radius:${style.shape};flex-shrink:0;`;
      btn.appendChild(swatch);
      btn.appendChild(document.createTextNode(style.label));
      btn.addEventListener("click", () => {
        this.selectedMarkerId = style.id;
        localStorage.setItem(MARKER_STORAGE_KEY, String(style.id));
        this.onMarkerChange?.(style.id);
        this.hide();
      });
      markerGrid.appendChild(btn);
    }
    markerSection.appendChild(markerGrid);
    panel.appendChild(markerSection);

    // Tab: Backgrounds
    const bgSection = document.createElement("div");
    const bgTitle = document.createElement("div");
    bgTitle.textContent = "Velg bakgrunn";
    bgTitle.style.cssText = "color:#ddd;font-size:14px;font-weight:600;margin-bottom:10px;";
    bgSection.appendChild(bgTitle);

    const bgGrid = document.createElement("div");
    bgGrid.style.cssText = "display:grid;grid-template-columns:repeat(5,1fr);gap:8px;";
    for (const bg of BG_OPTIONS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", `Velg bakgrunn: ${bg.label}`);
      btn.setAttribute("aria-pressed", String(bg.id === this.selectedBgId));
      Object.assign(btn.style, {
        width: "100%",
        aspectRatio: "1",
        background: bg.color,
        border: bg.id === this.selectedBgId ? "3px solid #ffe83d" : "2px solid rgba(255,255,255,0.2)",
        borderRadius: "8px",
        cursor: "pointer",
      });
      btn.title = bg.label;
      btn.addEventListener("click", () => {
        this.selectedBgId = bg.id;
        localStorage.setItem(BG_STORAGE_KEY, String(bg.id));
        this.onBgChange?.(bg.id);
        this.hide();
      });
      bgGrid.appendChild(btn);
    }
    bgSection.appendChild(bgGrid);
    panel.appendChild(bgSection);
  }

  setOnMarkerChange(callback: (id: number) => void): void {
    this.onMarkerChange = callback;
  }

  setOnBgChange(callback: (id: number) => void): void {
    this.onBgChange = callback;
  }

  show(): void {
    this.backdrop.style.display = "flex";
  }

  hide(): void {
    this.backdrop.style.display = "none";
  }

  getSelectedMarkerId(): number {
    return this.selectedMarkerId;
  }

  getSelectedBgId(): number {
    return this.selectedBgId;
  }

  destroy(): void {
    this.backdrop.remove();
  }
}
