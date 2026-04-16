/**
 * Manages HTML overlay elements positioned over the PixiJS canvas.
 *
 * Creates a root container div inside the game container with
 * pointer-events: none so PixiJS events pass through non-interactive areas.
 * Individual panels opt-in to pointer events as needed.
 */
export class HtmlOverlayManager {
  private root: HTMLDivElement;
  private container: HTMLElement;
  private resizeObserver: ResizeObserver | null = null;
  private children: HTMLElement[] = [];
  private destroyed = false;

  constructor(container: HTMLElement) {
    this.container = container;

    this.root = document.createElement("div");
    this.root.className = "g1-overlay-root";
    Object.assign(this.root.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "10",
      overflow: "hidden",
      display: "flex",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    });
    container.style.position = "relative";
    container.appendChild(this.root);

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.destroyed) this.onResize();
    });
    this.resizeObserver.observe(container);
  }

  /** Create a positioned child element inside the overlay root. */
  createElement(
    id: string,
    styles: Partial<CSSStyleDeclaration> = {},
  ): HTMLDivElement {
    const el = document.createElement("div");
    el.id = id;
    el.className = `g1-${id}`;
    Object.assign(el.style, {
      pointerEvents: "auto",
      ...styles,
    });
    this.root.appendChild(el);
    this.children.push(el);
    return el;
  }

  getRoot(): HTMLDivElement {
    return this.root;
  }

  getContainerBounds(): { width: number; height: number } {
    return {
      width: this.container.clientWidth,
      height: this.container.clientHeight,
    };
  }

  private onResize(): void {
    // Child panels handle their own resize via their update methods
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const el of this.children) {
      el.remove();
    }
    this.children = [];
    this.root.remove();
  }
}
