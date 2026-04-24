/**
 * @vitest-environment happy-dom
 *
 * KRITISK BLINK-REGRESJONSTEST (2026-04-24)
 * =========================================
 *
 * Spec: Ingen `.prize-pill`, `#chat-panel`, eller `#center-top`-knapp skal ha
 * `backdrop-filter` som ikke er 'none'. Kun popup-backdrop får bruke
 * backdrop-filter (der elementet er kort-levd og intensjonell fokus-effekt).
 *
 * Bakgrunn: Pixi-canvas rendrer kontinuerlig (60-120+ fps). HTML-elementer
 * som ligger over canvas med `backdrop-filter: blur()` tvinger GPU til å
 * re-kjøre blur-shader per frame for hver slik region. Resultat: konstant
 * visuell flimring som ikke ble adressert av tidligere blink-runder (de
 * målte kun DOM-mutasjoner, ikke GPU-shader-cost).
 *
 * Historikk:
 *   2026-04-24 profilering (Chrome DevTools) identifiserte 12 HTML-elementer
 *   over Pixi-canvas med `backdrop-filter: blur(X)`:
 *     - 5× `.prize-pill` (145×24 px hver) — INTRODUSERT i blink-fiks runde 1
 *       (23caea5b i fix/spill1-visual-polish) som regresjon.
 *     - 1× `#chat-panel.g1-chat-panel` (110×887 px full-høyde).
 *     - 3× knapper på `#center-top`.
 *     - 3× toaster (flytende).
 *
 * Fix i denne testen/PR:
 *   Fjerner backdrop-filter fra alle UI-elementer. Beholder bare på
 *   popup-backdrop (Game1BuyPopup, WinPopup, LuckyNumberPicker,
 *   CalledNumbersOverlay) der det er intensjonell, kort-levd effekt.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CenterTopPanel } from "../components/CenterTopPanel.js";
import { ChatPanelV2 } from "../components/ChatPanelV2.js";
import { ToastNotification } from "../components/ToastNotification.js";
import { HtmlOverlayManager } from "../components/HtmlOverlayManager.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";

function ensureResizeObserver(): void {
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
}

/** Minimal stub matching the subset of SpilloramaSocket that ChatPanelV2 uses. */
function stubSocket(): SpilloramaSocket {
  return {
    sendChat: () => {},
    getChatHistory: async () => ({ ok: true, data: { messages: [] } }),
  } as unknown as SpilloramaSocket;
}

/**
 * Checks both `element.style.backdropFilter` (inline-style, what happy-dom
 * reports most reliably) AND the computed-style where available.
 *
 * Happy-dom does not fully simulate vendor-prefix resolution, so we assert
 * on the inline style directly — this is the only mechanism the production
 * code uses to set backdrop-filter (no CSS stylesheets in game1 overlays).
 */
function readBackdropFilter(el: HTMLElement): string {
  const inline = el.style.backdropFilter || "";
  const computed = globalThis.getComputedStyle?.(el).backdropFilter || "";
  // Return first non-empty, non-"none" value — empty + "none" both count as
  // "not set" for our purposes.
  const raw = (inline || computed || "").trim();
  return raw === "none" ? "" : raw;
}

describe("Blink-regresjon 2026-04-24 — ingen backdrop-filter over Pixi-canvas", () => {
  let container: HTMLElement;
  let overlay: HtmlOverlayManager;

  beforeEach(() => {
    ensureResizeObserver();
    container = document.createElement("div");
    document.body.appendChild(container);
    overlay = new HtmlOverlayManager(container);
  });

  afterEach(() => {
    overlay.destroy();
    container.remove();
  });

  describe("CenterTopPanel — prize-pill + action-buttons", () => {
    it("prize-pill har IKKE backdrop-filter (regresjon introdusert 2026-04-24)", () => {
      const panel = new CenterTopPanel(overlay);
      // Trigger placeholder render (5 pills)
      panel.updatePatterns([], []);

      const pills = container.querySelectorAll<HTMLDivElement>(".prize-pill");
      expect(pills.length).toBeGreaterThan(0);
      for (const pill of Array.from(pills)) {
        const bf = readBackdropFilter(pill);
        expect(
          bf,
          `prize-pill har backdrop-filter="${bf}" — blink-regresjon. Se ARCHITECTURE.md.`,
        ).toBe("");
      }

      panel.destroy();
    });

    it("action-buttons på #center-top har IKKE backdrop-filter", () => {
      const panel = new CenterTopPanel(overlay);
      panel.updatePatterns([], []);

      const centerTop = container.querySelector("#center-top");
      expect(centerTop).not.toBeNull();
      const buttons = centerTop!.querySelectorAll<HTMLButtonElement>("button");
      expect(buttons.length).toBeGreaterThan(0);
      for (const btn of Array.from(buttons)) {
        const bf = readBackdropFilter(btn);
        expect(
          bf,
          `#center-top button "${btn.textContent}" har backdrop-filter="${bf}" — blink-regresjon.`,
        ).toBe("");
      }

      panel.destroy();
    });
  });

  describe("ChatPanelV2 — full-høyde sidebar", () => {
    it("#chat-panel.g1-chat-panel har IKKE backdrop-filter", () => {
      const socket = stubSocket();
      const chat = new ChatPanelV2(overlay, socket, "test-room");

      const chatRoot = container.querySelector("#chat-panel");
      expect(chatRoot).not.toBeNull();
      expect(chatRoot!.classList.contains("g1-chat-panel")).toBe(true);

      const bf = readBackdropFilter(chatRoot as HTMLElement);
      expect(
        bf,
        `#chat-panel har backdrop-filter="${bf}" — 110×887 px full-høyde sidebar tvinger GPU til å re-kjøre blur-shader per Pixi-frame. Se ARCHITECTURE.md.`,
      ).toBe("");

      chat.destroy();
    });
  });

  describe("ToastNotification — flytende meldinger", () => {
    it("toast-elementer har IKKE backdrop-filter", () => {
      const toaster = new ToastNotification(container);
      toaster.info("Test-toast");
      toaster.win("Vant 100 kr!");
      toaster.error("Feil");

      // Toast container children = toast-elementer.
      const toasts = container.querySelectorAll<HTMLDivElement>("div > div");
      // Bare de som faktisk har tekst (filter ut wrapper/container).
      const actualToasts = Array.from(toasts).filter(
        (t) => t.textContent && /^(Test-toast|Vant 100 kr!|Feil)$/.test(t.textContent),
      );
      expect(actualToasts.length).toBe(3);

      for (const t of actualToasts) {
        const bf = readBackdropFilter(t);
        expect(
          bf,
          `Toast "${t.textContent}" har backdrop-filter="${bf}" — svever over Pixi per frame.`,
        ).toBe("");
      }

      toaster.destroy();
    });
  });

  describe("Popup-backdrops — UNNTAK (må beholde backdrop-filter)", () => {
    /**
     * Denne seksjonen er et "guard-rail" som dokumenterer hvilke elementer
     * som BEVISST beholder backdrop-filter. Hvis noen senere flytter en
     * popup-backdrop til et persistent UI-element, skal reviewer flagge det.
     *
     * Regelen: popup-backdrop er OK fordi det er kort-levd (vises kun mens
     * popup er åpen, typisk sekunder, ikke hele spillet). Pixi-canvas
     * blir maskert når popup er åpen, så blur-kostnad er begrenset til
     * åpen-periode.
     */
    it("dokumenterer unntaks-lista (eksplisitt allow-list)", () => {
      const ALLOWED_POPUP_BACKDROP_FILES = [
        "components/Game1BuyPopup.ts",
        "components/WinPopup.ts",
        "components/LuckyNumberPicker.ts",
        "components/CalledNumbersOverlay.ts",
      ];
      // Hvis denne listen vokser/krymper — sjekk om det nye elementet er
      // en popup-backdrop (OK) eller et persistent UI-element (IKKE OK).
      expect(ALLOWED_POPUP_BACKDROP_FILES.length).toBe(4);
    });
  });
});
