/**
 * Manuell LINE/BINGO-claim-knapp.
 *
 * Brukes av:
 *   - Spill 1 PlayScreen (game1/screens/PlayScreen.ts) — synlig knapp,
 *     men auto-claim-on-draw siden BIN-689 betyr knappen sjelden trigges
 *   - Game5 PlayScreen (post-pilot)
 *
 * Status: åpent spørsmål om Spill 1 fortsatt skal vise denne. Se
 * CLEANUP_AUDIT_2026-05-05 §3.B.6 + §8 åpent spørsmål 2.
 */

import { Container, Graphics, Text } from "pixi.js";
import gsap from "gsap";

export type ClaimType = "LINE" | "BINGO";
/**
 * Claim button lifecycle:
 *   hidden    — nothing to claim yet
 *   ready     — pattern complete; pulsing, clickable
 *   submitted — click → awaiting server ack (disabled, "Sendt...")
 *   pending   — alias retained for clarity in tests and Gap #2 rationale.
 *
 * On server NACK the controller calls `reset()` or `setState("ready")` so the
 * user can retry. On server ACK → button stays submitted and is hidden when
 * the round transitions (matches Unity behaviour).
 */
type ClaimState = "hidden" | "ready" | "submitted";

/**
 * Claim button matching Unity Spillorama design — maroon with yellow text.
 */
export class ClaimButton extends Container {
  private bg: Graphics;
  private btnText: Text;
  private claimType: ClaimType;
  private state: ClaimState = "hidden";
  private pulseTween: gsap.core.Tween | null = null;
  private onClaim: ((type: ClaimType) => void) | null = null;
  private btnWidth: number;
  private btnHeight: number;

  private static readonly COLORS = {
    LINE: { bg: 0x790001, ready: 0xa00020, text: "Rekke!" },
    BINGO: { bg: 0x790001, ready: 0xc41030, text: "Bingo!" },
  };

  constructor(type: ClaimType, width = 160, height = 50) {
    super();
    this.claimType = type;
    this.btnWidth = width;
    this.btnHeight = height;
    const colors = ClaimButton.COLORS[type];

    this.bg = new Graphics();
    this.bg.roundRect(0, 0, width, height, 10);
    this.bg.fill(colors.bg);
    this.bg.stroke({ color: 0xffe83d, width: 2 });
    this.addChild(this.bg);

    this.btnText = new Text({
      text: colors.text,
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 22,
        fontWeight: "bold",
        fill: 0xffe83d,
        align: "center",
      },
    });
    this.btnText.anchor.set(0.5);
    this.btnText.x = width / 2;
    this.btnText.y = height / 2;
    this.addChild(this.btnText);

    this.eventMode = "static";
    this.cursor = "pointer";
    this.on("pointerdown", () => {
      if (this.state === "ready" && this.onClaim) {
        this.setState("submitted");
        this.onClaim(this.claimType);
      }
    });

    this.visible = false;
  }

  setOnClaim(callback: (type: ClaimType) => void): void {
    this.onClaim = callback;
  }

  setState(state: ClaimState): void {
    this.state = state;
    this.visible = state !== "hidden";

    if (this.pulseTween) {
      this.pulseTween.kill();
      this.pulseTween = null;
      this.scale.set(1);
    }

    const colors = ClaimButton.COLORS[this.claimType];

    if (state === "ready") {
      this.alpha = 1;
      this.cursor = "pointer";
      this.bg.clear();
      this.bg.roundRect(0, 0, this.btnWidth, this.btnHeight, 10);
      this.bg.fill(colors.ready);
      this.bg.stroke({ color: 0xffe83d, width: 2 });
      this.pulseTween = gsap.to(this.scale, {
        x: 1.06,
        y: 1.06,
        duration: 0.5,
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut",
      });
    } else if (state === "submitted") {
      this.alpha = 0.6;
      this.cursor = "default";
      this.btnText.text = "Sendt...";
    }
  }

  reset(): void {
    this.setState("hidden");
    this.btnText.text = ClaimButton.COLORS[this.claimType].text;
  }
}
