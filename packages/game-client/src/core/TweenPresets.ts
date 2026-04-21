import gsap from "gsap";
import type { Container } from "pixi.js";

/**
 * Reusable GSAP animation presets for bingo game UI.
 */
export const TweenPresets = {
  /** Continuous scale ping-pong (1-to-go blink). */
  blink(target: Container, scale = 1.15, duration = 0.4): gsap.core.Tween {
    return gsap.to(target.scale, {
      x: scale,
      y: scale,
      duration,
      yoyo: true,
      repeat: -1,
      ease: "sine.inOut",
    });
  },

  /** Single pulse and return (number marked). */
  pulse(target: Container, scale = 1.2, duration = 0.25): gsap.core.Tween {
    return gsap.to(target.scale, {
      x: scale,
      y: scale,
      duration,
      yoyo: true,
      repeat: 1,
      ease: "power2.out",
    });
  },

  /** Slide in from direction. */
  slideIn(
    target: Container,
    from: "left" | "right" | "top" | "bottom",
    distance = 200,
    duration = 0.4,
  ): gsap.core.Tween {
    const prop = from === "left" || from === "right" ? "x" : "y";
    const offset = from === "left" || from === "top" ? -distance : distance;
    const original = target[prop];
    target[prop] = original + offset;
    return gsap.to(target, { [prop]: original, duration, ease: "power2.out" });
  },

  /** Fade in. */
  fadeIn(target: Container, duration = 0.3): gsap.core.Tween {
    target.alpha = 0;
    return gsap.to(target, { alpha: 1, duration, ease: "power1.in" });
  },

  /** Fade out. */
  fadeOut(target: Container, duration = 0.3): gsap.core.Tween {
    return gsap.to(target, { alpha: 0, duration, ease: "power1.out" });
  },

  /** Wheel/roulette spin to target angle. */
  spinTo(
    target: Container,
    targetAngle: number,
    fullRotations = 3,
    duration = 3,
  ): gsap.core.Tween {
    const totalAngle = fullRotations * 360 + targetAngle;
    return gsap.to(target, {
      rotation: (totalAngle * Math.PI) / 180,
      duration,
      ease: "power3.out",
    });
  },
} as const;
