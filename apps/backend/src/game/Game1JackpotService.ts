/**
 * GAME1_SCHEDULE PR 4c Bolk 3: Game1JackpotService.
 *
 * Beregner ekstra jackpot-utbetaling for Fullt Hus-vinnere i Spill 1.
 *
 * Regler (PM-avklaring 2026-04-21):
 *   1) Kun Fullt Hus (fase 5) kan utløse jackpot. Faser 1..4 ignoreres.
 *   2) Jackpot utløses kun hvis Fullt Hus vunnet PÅ eller FØR
 *      scheduled_game.jackpot.draw (konfigurert 50..59 i admin-form).
 *      Formel: drawSequenceAtWin <= jackpot.draw.
 *   3) Jackpot-beløpet er farge-basert:
 *        yellow (Small Yellow, Large Yellow) → prizeByColor.yellow
 *        white  (Small White, Large White)   → prizeByColor.white
 *        purple (Small Purple, Large Purple) → prizeByColor.purple
 *      Andre farger (red, green, orange, elvis1-5) → 0 jackpot.
 *   4) Prize i config er oppgitt i NOK (hele kroner) i admin-form; lagret i
 *      ticket_config_json.jackpot.prizeByColor som NOK. Service konverterer
 *      til øre for PayoutService.
 *   5) 0-prize for en farge = ingen jackpot for den fargen (implisitt
 *      "jackpot av"). Per-spill-aktivering (hvilke spill som har jackpot)
 *      utsettes — ikke implementert i PR 4c.
 *
 * Referanse:
 *   - Spill1Config.ts (admin-form): jackpot.prizeByColor + draw.
 *   - `.claude/legacy-ref/Game1/Controllers/GameProcess.js:1780-1805`
 *     ("Large Yellow" / "Small Yellow" dobling — forenklet til generisk
 *     prizeByColor per farge-familie i PR 4c).
 *   - `.claude/legacy-ref/Game1/Controllers/GameProcess.js:5502-5518`
 *     (getJackpotHighestPrice — legacy mønster-oppslag, erstattet av
 *     direkte lookup her).
 */

export interface JackpotPrizeByColor {
  /** Jackpot-premie for gul-familie (Small/Large Yellow) i kroner. */
  yellow: number;
  /** Jackpot-premie for hvit-familie (Small/Large White) i kroner. */
  white: number;
  /** Jackpot-premie for lilla-familie (Small/Large Purple) i kroner. */
  purple: number;
}

export interface Game1JackpotConfig {
  /** Per-farge jackpot-beløp i kroner. 0 = jackpot av for den fargen. */
  prizeByColor: JackpotPrizeByColor;
  /**
   * Maks draw-sekvens (inklusiv) for jackpot-trigger. Hvis Fullt Hus
   * vunnet PÅ eller FØR denne sekvensen → jackpot. Legacy 50..59.
   */
  draw: number;
}

export interface Game1JackpotEvaluationInput {
  /** Fasen som ble vunnet. Kun 5 (Fullt Hus) gir jackpot. */
  phase: number;
  /** Draw-sekvens som utløste winnen. */
  drawSequenceAtWin: number;
  /** Ticket-farge fra assignment (f.eks. "small_yellow", "elvis1"). */
  ticketColor: string;
  /** Jackpot-config fra scheduled_game.ticket_config_json.spill1.jackpot. */
  jackpotConfig: Game1JackpotConfig;
}

export interface Game1JackpotEvaluationResult {
  /** true hvis jackpot utløses. */
  triggered: boolean;
  /**
   * Jackpot-beløp i øre (0 hvis ikke utløst). Konvertert fra kroner-config.
   */
  amountCents: number;
  /**
   * Farge-familie brukt for lookup ("yellow" | "white" | "purple" |
   * "other"). "other" = utløses ikke (ikke en jackpot-farge).
   */
  colorFamily: "yellow" | "white" | "purple" | "other";
}

/**
 * Pure service — ingen DB, ingen I/O. Kan brukes i drawNext-transaksjonen
 * uten bekymring for side-effekter.
 */
export class Game1JackpotService {
  /**
   * Evaluér om en Fullt Hus-vinner utløser jackpot basert på
   * draw-sekvens og ticket-farge.
   */
  evaluate(input: Game1JackpotEvaluationInput): Game1JackpotEvaluationResult {
    const colorFamily = resolveColorFamily(input.ticketColor);

    // Regel 1: kun Fullt Hus (fase 5).
    if (input.phase !== 5) {
      return { triggered: false, amountCents: 0, colorFamily };
    }

    // Regel 2: kun hvis vunnet PÅ eller FØR jackpot.draw.
    const maxDraw = Math.floor(input.jackpotConfig.draw ?? 0);
    if (
      !Number.isFinite(input.drawSequenceAtWin) ||
      input.drawSequenceAtWin <= 0 ||
      input.drawSequenceAtWin > maxDraw
    ) {
      return { triggered: false, amountCents: 0, colorFamily };
    }

    // Regel 3 + 4: farge-basert beløp.
    if (colorFamily === "other") {
      return { triggered: false, amountCents: 0, colorFamily };
    }
    const nok = input.jackpotConfig.prizeByColor[colorFamily] ?? 0;
    if (!Number.isFinite(nok) || nok <= 0) {
      // Regel 5: 0 = av.
      return { triggered: false, amountCents: 0, colorFamily };
    }

    const amountCents = Math.round(nok * 100);
    return { triggered: true, amountCents, colorFamily };
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Map ticket-farge (f.eks. "small_yellow", "large_white", "purple", "elvis1")
 * til en jackpot-farge-familie.
 *
 * Match-semantikk: case-insensitiv, matcher `_yellow`/`_white`/`_purple`
 * suffiks og også bare "yellow"/"white"/"purple" alene (legacy-form).
 * Elvis/red/green/orange → "other" (ingen jackpot).
 */
export function resolveColorFamily(
  ticketColor: string
): "yellow" | "white" | "purple" | "other" {
  const lc = (ticketColor ?? "").toLowerCase().trim();
  // Eksakte match eller suffix-match.
  if (lc === "yellow" || lc.endsWith("_yellow")) return "yellow";
  if (lc === "white" || lc.endsWith("_white")) return "white";
  if (lc === "purple" || lc.endsWith("_purple")) return "purple";
  return "other";
}
