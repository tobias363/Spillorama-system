/**
 * Spill 2 — 6 jackpot/gain-slots i en horisontal rad. Rendres nå som ett
 * stort PNG-asset (`jackpots.png`) der ball-grafikken med tall-9/10/11/
 * 12/13/14-21 OG de røde premie-rektanglene under er innebygd. Premie-
 * beløp og active-slot-glow legges som Pixi-overlays oppå PNG.
 *
 * 2026-05-05 (Tobias-direktiv): JACKPOTS-PNG-ASSET ERSTATTER GRAPHICS.
 *   PNG er 1672×398 (aspect 4.20:1) og inneholder 6 røde baller med
 *   tall (sentrene ved x-ratio ~0.093, 0.256, 0.421, 0.582, 0.747,
 *   0.910 av total bredde) + 6 mørke-røde rektangler under for premie-
 *   tall. Vi måler ikke koordinater dynamisk — bruker hardkodede
 *   ratio-konstanter som ble håndmålt fra PNG-asset.
 *
 *   Ball-tallene (9, 10, ...) ER nå i PNG, så `numberText`-overlay er
 *   fjernet.
 *
 *   Active-slot-highlight implementeres som en gull-glow-Graphics-ring
 *   plassert rundt aktiv ball. Posisjonen følger ball-x-ratiene oppgitt
 *   over.
 *
 *   PNG skaleres med "fit-within"-strategi: skalerer til full bar-bredde,
 *   men cap'ed til en max-høyde så raden ikke vokser ut av ComboPanel.
 *   Hvis tilgjengelig bredde overskrider hva max-høyde × aspect tillater,
 *   sentreres PNG-en horisontalt med tomme marginer på begge sider.
 *
 * 2026-05-05 (Tobias-direktiv 2): "Jackpot"/"Gain"-labels OVER hver ball.
 *   PR #940 fjernet labels feilaktig — de skulle være med (i CSS, ikke
 *   Pixi). Re-implementert som HTML-overlay-DIVer over Pixi-canvas, lik
 *   mønsteret `Game1BuyPopup` bruker. Stil: italic-bold gull-gradient
 *   med drop-shadow + tekst-stroke for lesbarhet mot mørk bakgrunn.
 *
 *   Slot 9/10/11/12 → "Jackpot", slot 13/14-21 → "Gain".
 *
 *   Mounting: `attachLabels(canvas, overlayManager)` kalles av PlayScreen/
 *   LobbyScreen etter at JackpotsRow er lagt til Pixi-stage. Labels
 *   re-posisjoneres ved hver `applyLayout` (bredde-endring fra ComboPanel)
 *   OG ved window-resize (canvas kan flytte seg på viewport-resize).
 *
 * Kontrakt (uendret fra forrige versjon):
 *   - `update(list)` — full prize-liste fra `g2:jackpot:list-update`-event.
 *   - `setCurrentDrawCount(n)` — markerer aktiv slot med glow-ring.
 *   - `setBarWidth(w)` — sett tilgjengelig bredde, PNG skaleres innenfor.
 *   - `barWidth` — get returnerer current allotted bredde.
 *   - `barHeight` — get returnerer faktisk rendret høyde (kan være < panel
 *     pga aspect-cap).
 *
 * Ny kontrakt:
 *   - `attachLabels(canvas, overlayManager)` — mount HTML-labels over
 *     Pixi-canvas. Idempotent — kan kalles flere ganger med samme refs.
 *   - `detachLabels()` — fjern HTML-labels (kalles fra destroy-flow).
 */

import { Container, Graphics, Sprite, Text, Assets, type Texture } from "pixi.js";
import type { HtmlOverlayManager } from "../../game1/components/HtmlOverlayManager.js";

export interface JackpotSlotData {
  /** Slot-nøkkel: "9" | "10" | "11" | "12" | "13" | "14-21". */
  number: string;
  /** Premie i kroner (kommer ferdig-beregnet fra backend). */
  prize: number;
  /** Visuell label: "Jackpot" eller "Gain". */
  type: "gain" | "jackpot";
}

const SLOT_KEYS = ["9", "10", "11", "12", "13", "14-21"] as const;

/**
 * Label-tekst over hver ball. Tobias-direktiv 2026-05-05 (referansebilde):
 * 9, 10, 11, 12 → "Jackpot"; 13, 14-21 → "Gain".
 *
 * Indekser matcher `SLOT_KEYS`-rekkefølgen.
 */
const LABEL_TEXTS = ["Jackpot", "Jackpot", "Jackpot", "Jackpot", "Gain", "Gain"] as const;

/** PNG-asset (1672×398). Aspect = 4.20:1. */
const JACKPOTS_PNG_URL = "/web/games/assets/game2/design/jackpots.png";
const PNG_ORIG_W = 1672;
const PNG_ORIG_H = 398;
const PNG_ASPECT = PNG_ORIG_W / PNG_ORIG_H; // ~4.201

/**
 * Maksimal rendret høyde for jackpots-raden. ComboPanel.panelH er 142px;
 * vi cap'er på 130 så raden får ~6px luft over og under. Ved bar-bredder
 * der `width / aspect > 130` skaleres PNG-en til 130 høyde og bredden
 * krymper proporsjonalt.
 */
const MAX_RENDERED_HEIGHT = 130;

/**
 * Slot-koordinater (ratio av PNG-dimensjoner) — håndmålt med en alpha-
 * scan på den faktiske PNG-asset 2026-05-05. Verdier brukes for å
 * plassere amount-text-overlays + active-glow-ring relativt til Sprite-en.
 */
const BALL_X_RATIOS = [0.0933, 0.2563, 0.4208, 0.5822, 0.7470, 0.9103] as const;
const BALL_Y_RATIO = 0.307;          // ball-senter ratio (av PNG-høyde)
const BALL_RADIUS_RATIO = 0.288;     // ball-radius ratio (av PNG-høyde)
const RECT_Y_RATIO = 0.872;          // rektangel-senter ratio
const RECT_WIDTH_RATIO = 0.131;      // rektangel-bredde ratio (per slot)
const RECT_HEIGHT_RATIO = 0.250;     // rektangel-høyde ratio
/**
 * Label-y-ratio relativt til PNG-høyde. Tobias-direktiv 2026-05-05:
 * label sitter en halv ball-radius OVER toppen av ballen, dvs. ~1.5
 * ball-radii over ball-senter. Dette plasserer label visuelt UNDER
 * ComboPanel-toppen men OVER ballen — overflow-en mot panel-padding
 * tolereres for å gi labelen synlig størrelse mot mørk bakgrunn.
 *
 * Formel: `cy = (BALL_Y_RATIO - BALL_RADIUS_RATIO * 1.5) * spriteH`.
 * Med BALL_Y_RATIO=0.307 og BALL_RADIUS_RATIO=0.288 → ratio = -0.125.
 * Negativ ratio betyr "over PNG top edge", dvs. label-senter ligger
 * `0.125 * spriteH` over JackpotsRow's top.
 */
const LABEL_Y_RATIO = -0.125;

/** Active-slot glow-ring stroke-farger (gull). */
const ACTIVE_GLOW_COLOR = 0xffd97a;
const ACTIVE_GLOW_ALPHA = 1.0;

/**
 * CSS-stil for "Jackpot"/"Gain"-labels. Tobias-direktiv 2026-05-05:
 * gull-italic-bold med drop-shadow + tekst-stroke for kontrast mot
 * mørk bakgrunn. Stilen matcher referanse-bilde fra Tobias —
 * ikke 100% likt PNG-mockupen (som ikke har labels) men matcher det
 * visuelle uttrykket han eksplisitt bestilte.
 *
 * Implementeres som DIV-overlay over Pixi-canvas via `HtmlOverlayManager`
 * (samme mønster som `Game1BuyPopup`). Plasseres med `position: absolute`
 * på root-DIV-en (som er body-relativ via `inset: 0`); koordinater
 * regnes som document-pixler.
 *
 * Gull-gradient bruker `background-clip: text` med transparent fill
 * så glyfene viser gradienten. `filter: drop-shadow` gir skygge på
 * faktiske glyf-pikslene (ikke bounding-box). `-webkit-text-stroke`
 * gir mørk-rød kontur for ekstra lesbarhet — fall-back: regulær
 * text-shadow når browser ikke støtter text-stroke.
 */
const LABEL_BASE_STYLES: Partial<CSSStyleDeclaration> = {
  position: "absolute",
  fontFamily: "Georgia, 'Times New Roman', serif",
  fontStyle: "italic",
  fontWeight: "700",
  // Gull-gradient: lysere topp, mørkere bunn (matcher Tobias' referanse).
  background: "linear-gradient(180deg, #ffe066 0%, #ffd700 50%, #b8860b 100%)",
  backgroundClip: "text",
  // Webkit-spesifikk for Safari/Chrome (Pixi-target).
  webkitBackgroundClip: "text",
  webkitTextFillColor: "transparent",
  color: "transparent",
  // Mørk-rød tekst-stroke for kontrast (synlig kontur rundt glyf).
  webkitTextStroke: "1px #4a0a0a",
  // Drop-shadow på glyf-pikslene (ikke bounding-box).
  filter: "drop-shadow(2px 2px 3px rgba(0,0,0,0.7))",
  // Beskytt mot å fange klikk/scroll — labels er rent dekorative.
  pointerEvents: "none",
  userSelect: "none",
  // Sentrer tekst på koordinaten via translate.
  transform: "translate(-50%, -50%)",
  whiteSpace: "nowrap",
  // Z-index over Pixi-canvas; HtmlOverlayManager sin root har zIndex: "10",
  // labels arver dette og rendres over PNG-en.
};

interface SlotVisual {
  /** Pixi Text-overlay for premie-beløpet under hver ball. */
  amountText: Text;
  /** HTML-DIV for "Jackpot"/"Gain"-label over ballen. Mountes via
   *  `attachLabels()`; null før mount eller etter detach. */
  labelEl: HTMLDivElement | null;
}

export class JackpotsRow extends Container {
  private slots: Map<string, SlotVisual> = new Map();
  private latestData: Map<string, JackpotSlotData> = new Map();
  private activeSlotKey: string | null = null;
  private rowWidth: number;
  private rowHeight: number;
  /** PNG-bakgrunn (Sprite av jackpots.png). Lazy-loadet. */
  private bgSprite: Sprite | null = null;
  /** Container som holder amount-text-overlay'ene; posisjoneres etter
   *  Sprite-skalering. Lar oss reposisjonere alle overlays atomisk. */
  private overlays: Container;
  /** Glow-ring rundt aktiv ball. Re-tegnes når aktiv slot endrer seg. */
  private activeGlow: Graphics;
  /** Har vi noen gang rendert? Brukes for å vite om vi må trigge layout
   *  etter at PNG-texture er lastet. */
  private spriteReady: boolean = false;

  // ── HTML-label-overlay (Tobias 2026-05-05 — "Jackpot"/"Gain") ───────────
  /** Canvas-ref for å regne ut DOM-koordinater. Null før `attachLabels()`. */
  private labelCanvas: HTMLCanvasElement | null = null;
  /** Overlay-manager-ref for å oppretthold lifecycle (vi rydder labels via
   *  egen `detachLabels()` som fjerner DIVer fra root). */
  private labelOverlay: HtmlOverlayManager | null = null;
  /** Window-resize-handler — trigget når viewport endres så labels følger
   *  canvas (typisk når devtools åpnes/lukkes eller browser-vindu rezises).
   *  Null før attach, ryddet i detach. */
  private windowResizeHandler: (() => void) | null = null;

  constructor() {
    super();
    // Default: minimum bredde basert på en rimelig minimum stride. ComboPanel
    // kaller `setBarWidth` like etter konstruksjon så slots distribueres jevnt.
    this.rowWidth = 540;
    this.rowHeight = MAX_RENDERED_HEIGHT;

    this.overlays = new Container();
    this.activeGlow = new Graphics();

    // Lazy-load PNG-bakgrunn. Mens vi venter rendrer vi fortsatt overlays
    // (de er bare "tall over tomhet" til PNG kommer på plass).
    this.loadBackground();

    this.buildOverlays();
  }

  /** Bredde av hele raden (brukt av `ComboPanel` for layout). */
  get barWidth(): number {
    return this.rowWidth;
  }

  /** Høyde av hele raden — faktisk rendret høyde av PNG (kan være < bar-
   *  bredde / aspect dersom cap'et til MAX_RENDERED_HEIGHT). */
  get barHeight(): number {
    return this.rowHeight;
  }

  /**
   * Sett tilgjengelig bredde. PNG-en skaleres til `width` med aspect-
   * preservation, men cap'ed til MAX_RENDERED_HEIGHT. Dersom cap'en
   * trer i kraft, sentrerer vi PNG-en horisontalt innenfor `width`.
   *
   * Idempotent — gjør ingenting hvis bredden ikke endret.
   */
  setBarWidth(width: number): void {
    if (width === this.rowWidth) return;
    this.rowWidth = width;
    this.applyLayout();
  }

  /**
   * Backend-driver: oppdater prize-listen.
   *
   * Tobias-direktiv 2026-05-04: under nedtelling til ny runde sender
   * server prize=0 for alle slots fordi forrige rundes prizePool er
   * resetet og ny runde ikke har armed-spillere ennå. Skjul disse
   * "alle-null"-oppdateringene så premiene fra forrige runde fortsatt
   * vises gjennom countdown-fasen — gir bedre UX.
   *
   * Hvis vi ALDRI har hatt non-zero verdier (helt nytt rom), tillater
   * vi 0-update så slots viser "0" som default.
   */
  update(list: JackpotSlotData[]): void {
    const allZero = list.every((entry) => !entry.prize || entry.prize <= 0);
    const haveExistingValues = Array.from(this.latestData.values()).some(
      (e) => e.prize > 0,
    );
    if (allZero && haveExistingValues) {
      // Behold forrige rundes priser under countdown.
      return;
    }
    for (const entry of list) {
      this.latestData.set(entry.number, entry);
    }
    this.renderValues();
  }

  /**
   * Markér slot som matcher current draw count som aktiv.
   *   draws 1-8  → ingen aktiv slot
   *   draws 9-13 → slot "9".."13" aktiv
   *   draws 14-21 → slot "14-21" aktiv
   */
  setCurrentDrawCount(drawCount: number): void {
    let key: string | null = null;
    if (drawCount >= 9 && drawCount <= 13) {
      key = String(drawCount);
    } else if (drawCount >= 14 && drawCount <= 21) {
      key = "14-21";
    }
    if (key === this.activeSlotKey) return;
    this.activeSlotKey = key;
    this.renderActiveGlow();
  }

  /**
   * Mount HTML-labels ("Jackpot"/"Gain") over Pixi-canvas. Tobias-direktiv
   * 2026-05-05 (referansebilde): labels skal være over hver ball med gull-
   * italic CSS-stil, IKKE Pixi-Text. Implementeres som DIVer i `overlayManager`
   * sin root.
   *
   * Idempotent — kan kalles flere ganger. Re-mount oppretter ikke duplikate
   * DIVer; eksisterende DIVer reposisjoneres bare. Dette gjør det trygt å
   * kalle ved screen-bytte eller resize uten ekstra tear-down.
   *
   * Lifecycle:
   *   1. PlayScreen/LobbyScreen kaller `attachLabels(canvas, overlayManager)`
   *      etter at JackpotsRow er lagt til Pixi-stage.
   *   2. `repositionLabels()` regner ut DOM-koordinater fra Pixi-globalpos
   *      + `canvas.getBoundingClientRect()` (med autoDensity matcher stage-
   *      koords CSS-pixler 1:1).
   *   3. Window-resize-handler trigger reposisjonering ved viewport-endring.
   *   4. `detachLabels()` (eller Container.destroy) rydder DIVer + handler.
   */
  attachLabels(canvas: HTMLCanvasElement, overlayManager: HtmlOverlayManager): void {
    if (!canvas || !overlayManager) return;
    // Skip i SSR/test der document mangler — JackpotsRow rendrer fortsatt
    // Pixi-overlays uten labels (testen sjekker ikke DOM-noder).
    if (typeof document === "undefined") return;

    this.labelCanvas = canvas;
    this.labelOverlay = overlayManager;

    const overlayRoot = overlayManager.getRoot();
    if (!overlayRoot) return;

    // Opprett label-DIVer hvis de ikke allerede eksisterer.
    SLOT_KEYS.forEach((key, idx) => {
      const slot = this.slots.get(key);
      if (!slot) return;
      if (slot.labelEl) return; // Allerede mount-ed.
      const div = document.createElement("div");
      div.className = `g2-jackpot-label g2-jackpot-label-${idx}`;
      div.textContent = LABEL_TEXTS[idx];
      Object.assign(div.style, LABEL_BASE_STYLES);
      overlayRoot.appendChild(div);
      slot.labelEl = div;
    });

    // Window-resize-handler: viewport-endring kan flytte canvas-rect.
    if (!this.windowResizeHandler) {
      this.windowResizeHandler = () => {
        if (this.destroyed) return;
        this.repositionLabels();
      };
      window.addEventListener("resize", this.windowResizeHandler);
    }

    // Reposisjoner umiddelbart slik at labels havner riktig fra første frame.
    this.repositionLabels();
  }

  /**
   * Fjern HTML-labels og clean-up window-resize-handler. Idempotent.
   * Kalles fra PlayScreen.destroy / LobbyScreen.destroy via parent-cascade.
   */
  detachLabels(): void {
    SLOT_KEYS.forEach((key) => {
      const slot = this.slots.get(key);
      if (!slot || !slot.labelEl) return;
      slot.labelEl.remove();
      slot.labelEl = null;
    });
    if (this.windowResizeHandler) {
      window.removeEventListener("resize", this.windowResizeHandler);
      this.windowResizeHandler = null;
    }
    this.labelCanvas = null;
    this.labelOverlay = null;
  }

  /**
   * Override Container.destroy så vi rydder DOM-labels før Pixi-destroy.
   * Pixi-Container.destroy fjerner ikke HTML-elementer som lever i
   * HtmlOverlayManager.root — vi må selv detache.
   */
  destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.detachLabels();
    super.destroy(options);
  }

  // ── interne tegne-rutiner ─────────────────────────────────────────────────

  /**
   * Last `jackpots.png` lazy. Hvis cachen har den allerede (typisk for
   * andre JackpotsRow-instanser i samme sesjon — eks. preview-mode)
   * hopper vi direkte til attach.
   */
  private loadBackground(): void {
    const cached = Assets.cache.get(JACKPOTS_PNG_URL) as Texture | undefined;
    if (cached) {
      this.attachBgSprite(cached);
      return;
    }
    void Assets.load(JACKPOTS_PNG_URL)
      .then((tex: Texture) => {
        if (this.destroyed) return;
        this.attachBgSprite(tex);
      })
      .catch(() => {
        // Stille fallback — testene kjører uten WebGL-renderer og kan
        // fortsatt instansiere komponenten via overlays.
      });
  }

  private attachBgSprite(texture: Texture): void {
    enableMipmaps(texture);
    const sprite = new Sprite(texture);
    this.bgSprite = sprite;
    this.spriteReady = true;
    // Z-orden: bakgrunn → glow-ring → amount-tekst.
    this.addChildAt(sprite, 0);
    this.applyLayout();
  }

  /**
   * Bygg amount-text-objektene (én per slot). Posisjon settes i
   * `applyLayout` etter at sprite-størrelse er kjent. Glow-ring + overlays
   * legges til som children for korrekt z-orden.
   */
  private buildOverlays(): void {
    // Glow-ring under amount-overlays (slik at amount-text er klikkbar/
    // synlig over glow). I praksis er glow-ring kun visuell — hverken
    // har eventer eller overlapper med amount-rektangelet.
    this.addChild(this.activeGlow);
    this.addChild(this.overlays);

    SLOT_KEYS.forEach((key) => {
      const amountText = new Text({
        text: "0",
        style: {
          fontFamily: "Inter, system-ui, Helvetica, sans-serif",
          fontSize: 16,
          fontWeight: "700",
          fill: 0xffffff,
          align: "center",
        },
      });
      amountText.anchor.set(0.5, 0.5);
      this.overlays.addChild(amountText);
      // labelEl mountes lazy via `attachLabels()` etter at JackpotsRow
      // er lagt til Pixi-stage og parent screen har en canvas-ref.
      this.slots.set(key, { amountText, labelEl: null });
    });

    this.renderValues();
  }

  /**
   * Skaleringsstrategi: PNG skal fylle `rowWidth` × MAX_RENDERED_HEIGHT-
   * rektangelet, med aspect-preservation. To muligheter:
   *   1. Width-bound:  rowWidth / PNG_ASPECT ≤ MAX_RENDERED_HEIGHT
   *      → spriteW = rowWidth, spriteH = rowWidth / PNG_ASPECT
   *      → spriteX = 0
   *   2. Height-bound: rowWidth / PNG_ASPECT > MAX_RENDERED_HEIGHT
   *      → spriteH = MAX_RENDERED_HEIGHT, spriteW = MAX_RENDERED_HEIGHT × PNG_ASPECT
   *      → spriteX = (rowWidth - spriteW) / 2  (center)
   *
   * `barHeight` er alltid den faktiske rendret høyde — ComboPanel bruker
   * den for vertikal centering.
   */
  private applyLayout(): void {
    const widthBoundH = this.rowWidth / PNG_ASPECT;
    let spriteW: number;
    let spriteH: number;
    let spriteX: number;
    if (widthBoundH <= MAX_RENDERED_HEIGHT) {
      spriteW = this.rowWidth;
      spriteH = widthBoundH;
      spriteX = 0;
    } else {
      spriteH = MAX_RENDERED_HEIGHT;
      spriteW = spriteH * PNG_ASPECT;
      spriteX = (this.rowWidth - spriteW) / 2;
    }
    this.rowHeight = spriteH;

    if (this.bgSprite) {
      this.bgSprite.x = spriteX;
      this.bgSprite.y = 0;
      this.bgSprite.width = spriteW;
      this.bgSprite.height = spriteH;
    }

    // Plasser amount-text relativt til scaled sprite. Positions er
    // ratio-baserte så de skalerer automatisk med PNG-størrelse.
    SLOT_KEYS.forEach((key, idx) => {
      const slot = this.slots.get(key);
      if (!slot) return;
      const cx = spriteX + BALL_X_RATIOS[idx] * spriteW;
      const cy = RECT_Y_RATIO * spriteH;
      slot.amountText.x = cx;
      slot.amountText.y = cy;
      // Skaler font-size proporsjonalt med rektangelet — bredere PNG
      // gir større tekst. Cap'er nedover for lesbarhet ved svært små.
      const rectH = RECT_HEIGHT_RATIO * spriteH;
      const fontSize = Math.max(11, Math.min(20, Math.round(rectH * 0.55)));
      slot.amountText.style.fontSize = fontSize;
    });

    this.renderActiveGlow();
    // Reposisjoner HTML-labels ved hver layout-endring (typisk når ComboPanel
    // re-distribuerer JackpotsRow ved screen-resize). No-op hvis labels ikke
    // er mountet ennå.
    this.repositionLabels();
  }

  /**
   * Re-posisjoner HTML-labels (DIVer) over Pixi-canvas. Beregner DOM-
   * koordinater basert på:
   *   - JackpotsRow's globale Pixi-posisjon (`getGlobalPosition`)
   *   - Canvas' viewport-rect (`getBoundingClientRect`) + page-scroll
   *   - Sprite-skaleringen (BALL_X_RATIOS gir x i lokal sprite-space)
   *   - LABEL_Y_RATIO posisjonerer over ballen
   *
   * Med Pixi `autoDensity: true` + `resolution: dpr` matcher stage-coords
   * CSS-pikslene 1:1 (canvas-style.width = stage-width). Med harness
   * `resolution: 1, autoDensity: false` matcher de også 1:1.
   *
   * No-op hvis labels ikke er mountet (canvas/overlay null) eller hvis
   * sprite ikke er ready (PNG ikke lastet).
   */
  private repositionLabels(): void {
    if (!this.labelCanvas) return;
    if (this.destroyed) return;
    const sprite = this.bgSprite;
    // Selv før sprite er lastet kan vi posisjonere labels mot row-bredden;
    // det er kun fontSize-skaleringen som krever sprite-høyden.
    const spriteW = sprite ? sprite.width : this.rowWidth;
    const spriteH = sprite ? sprite.height : this.rowHeight;
    const spriteX = sprite ? sprite.x : 0;
    if (spriteW <= 0 || spriteH <= 0) return;

    // Canvas viewport-position. `getBoundingClientRect` gir rect i viewport-
    // space; pluss page-scroll for absolute-positioned DIVer i body.
    //
    // Pixi stage-coords matcher CSS-coords 1:1 i begge konfigurasjoner:
    //   - Produksjon: `autoDensity: true, resolution: dpr` → canvas.style.width
    //     = stage-bredde (CSS-pikler), backing-buffer = stage * dpr.
    //   - Visual-harness: `autoDensity: false, resolution: 1` → canvas.style
    //     er ikke satt; clientWidth = stage-bredde.
    // Begge gir stage-coords = CSS-pikler, så vi trenger ingen ekstra skalering.
    const rect = this.labelCanvas.getBoundingClientRect();
    const pageOffsetX = rect.left + window.scrollX;
    const pageOffsetY = rect.top + window.scrollY;

    // JackpotsRow's globale Pixi-posisjon.
    const globalPos = this.getGlobalPosition();

    // Beregn font-size så "Jackpot" passer innenfor ball-spacing-en
    // (avstand mellom to ball-sentre). PNG har 6 balls; minimum ball-
    // spacing ~ spriteW * (BALL_X_RATIOS[1] - BALL_X_RATIOS[0]) ≈ 0.163 * spriteW.
    // Ved typisk spriteW=489 → ~80px per slot. "Jackpot" (7 tegn) i
    // italic Georgia trenger ~0.55 * fontSize per char → 7 * 0.55 * fs.
    // Solving for fs: fs ≈ slot-bredde / (7 * 0.55) = slot * 0.26.
    // Gir ~21 ved slot=80 men det overlapper 5-7px med naboene.
    // Reduser til 0.22 så vi har 1-2px margin: fs ≈ slot * 0.22.
    const slotW = spriteW * 0.163; // ball-spacing approx
    const fontSize = Math.max(10, Math.min(18, Math.round(slotW * 0.22)));

    SLOT_KEYS.forEach((key, idx) => {
      const slot = this.slots.get(key);
      if (!slot || !slot.labelEl) return;
      // Lokal x i JackpotsRow-space.
      const localX = spriteX + BALL_X_RATIOS[idx] * spriteW;
      const localY = LABEL_Y_RATIO * spriteH;
      // DOM-koordinat = page-offset + canvas-offset + global-pos + local.
      const domX = pageOffsetX + globalPos.x + localX;
      const domY = pageOffsetY + globalPos.y + localY;
      slot.labelEl.style.left = `${domX}px`;
      slot.labelEl.style.top = `${domY}px`;
      slot.labelEl.style.fontSize = `${fontSize}px`;
    });
  }

  /** Tegn glow-ring rundt aktiv ball (eller skjul hvis ingen aktiv). */
  private renderActiveGlow(): void {
    this.activeGlow.clear();
    if (!this.activeSlotKey || !this.spriteReady) return;
    const idx = SLOT_KEYS.indexOf(this.activeSlotKey as (typeof SLOT_KEYS)[number]);
    if (idx < 0) return;
    const sprite = this.bgSprite;
    if (!sprite) return;
    const spriteW = sprite.width;
    const spriteH = sprite.height;
    const spriteX = sprite.x;
    const cx = spriteX + BALL_X_RATIOS[idx] * spriteW;
    const cy = BALL_Y_RATIO * spriteH;
    const radius = BALL_RADIUS_RATIO * spriteH;
    // Tegn én kraftig gull-ring litt utenfor PNG-ballen, og en svakere
    // ytre glød. Det gir en synlig "selected"-aksent uten å overstyre
    // ball-grafikken som allerede er i PNG.
    this.activeGlow
      .circle(cx, cy, radius + 4)
      .stroke({ color: ACTIVE_GLOW_COLOR, alpha: ACTIVE_GLOW_ALPHA, width: 3 });
    this.activeGlow
      .circle(cx, cy, radius + 9)
      .stroke({ color: ACTIVE_GLOW_COLOR, alpha: 0.35, width: 4 });
  }

  /** Skriv premie-beløp inn i amount-overlay-Text-objektene. */
  private renderValues(): void {
    for (const key of SLOT_KEYS) {
      const slot = this.slots.get(key);
      if (!slot) continue;
      const data = this.latestData.get(key);
      slot.amountText.text = data ? formatPrize(data.prize) : "0";
    }
  }
}

function formatPrize(prize: number): string {
  if (!Number.isFinite(prize) || prize <= 0) return "0";
  if (Number.isInteger(prize)) return String(prize);
  return prize.toFixed(0);
}

/**
 * Speilet av Spill 1's `enableMipmaps`. Uten mipmaps får skalert PNG-
 * tekstur stygg aliasing. Pixi støtter ikke mipmaps før vi eksplisitt
 * slår det på per-source.
 */
function enableMipmaps(texture: Texture): void {
  const src = texture.source as unknown as {
    autoGenerateMipmaps?: boolean;
    scaleMode?: string;
    updateMipmaps?: () => void;
  };
  if (src && !src.autoGenerateMipmaps) {
    src.autoGenerateMipmaps = true;
    src.scaleMode = "linear";
    src.updateMipmaps?.();
  }
}
