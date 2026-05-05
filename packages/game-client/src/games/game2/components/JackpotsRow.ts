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
 *   fjernet. Label-text ("Jackpot"/"gain") er IKKE i PNG-mockupen, så
 *   den er også fjernet — mockup-paritet.
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
 * Kontrakt (uendret fra forrige versjon):
 *   - `update(list)` — full prize-liste fra `g2:jackpot:list-update`-event.
 *   - `setCurrentDrawCount(n)` — markerer aktiv slot med glow-ring.
 *   - `setBarWidth(w)` — sett tilgjengelig bredde, PNG skaleres innenfor.
 *   - `barWidth` — get returnerer current allotted bredde.
 *   - `barHeight` — get returnerer faktisk rendret høyde (kan være < panel
 *     pga aspect-cap).
 */

import { Container, Graphics, Sprite, Text, Assets, type Texture } from "pixi.js";

export interface JackpotSlotData {
  /** Slot-nøkkel: "9" | "10" | "11" | "12" | "13" | "14-21". */
  number: string;
  /** Premie i kroner (kommer ferdig-beregnet fra backend). */
  prize: number;
  /** Visuell label: "Jackpot" eller "Gain". */
  type: "gain" | "jackpot";
}

const SLOT_KEYS = ["9", "10", "11", "12", "13", "14-21"] as const;

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

/** Active-slot glow-ring stroke-farger (gull). */
const ACTIVE_GLOW_COLOR = 0xffd97a;
const ACTIVE_GLOW_ALPHA = 1.0;

interface SlotVisual {
  /** Pixi Text-overlay for premie-beløpet under hver ball. */
  amountText: Text;
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
      this.slots.set(key, { amountText });
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
