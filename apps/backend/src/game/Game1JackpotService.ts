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

/**
 * Per-farge jackpot-konfig. Kan bruke:
 *   - Farge-familie-navn: "yellow" | "white" | "purple" | "red" | "green" |
 *     "orange" (matcher resolveColorFamily-output for legacy-kompatibilitet).
 *   - Exact ticket-farger fra SPILL1_TICKET_COLORS: "small_yellow",
 *     "large_white", "elvis1", "elvis2", etc. (#316: admin lar konfigurere
 *     per farge).
 *
 * evaluate() slår opp FØRST på exact ticket-farge, så på farge-familie, så
 * returnerer 0 hvis hverken finnes.
 */
export type JackpotPrizeByColor = Record<string, number>;

export interface Game1JackpotConfig {
  /** Per-farge jackpot-beløp i kroner. 0/mangler = jackpot av for den fargen. */
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

/**
 * Farge-familier brukt for suffiks-basert oppslag. Utvidet fra originale
 * 3 (yellow/white/purple) til 7 etter #316 slik at alle 14 ticket-farger i
 * SPILL1_TICKET_COLORS kan ha jackpot.
 */
export type JackpotColorFamily =
  | "yellow"
  | "white"
  | "purple"
  | "red"
  | "green"
  | "orange"
  | "elvis"
  | "other";

export interface Game1JackpotEvaluationResult {
  /** true hvis jackpot utløses. */
  triggered: boolean;
  /** Jackpot-beløp i øre (0 hvis ikke utløst). Konvertert fra kroner-config. */
  amountCents: number;
  /**
   * Farge-familie brukt for fallback-lookup. Kun satt hvis eksakt
   * farge-match ikke ble funnet først. "other" = ikke en jackpot-farge.
   */
  colorFamily: JackpotColorFamily;
  /**
   * Hvordan lookup ble gjort: 'exact' = config.prizeByColor[ticketColor],
   * 'family' = config.prizeByColor[colorFamily], 'none' = ikke funnet.
   */
  lookupMatch: "exact" | "family" | "none";
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
    const pbc = input.jackpotConfig.prizeByColor ?? {};
    const ticketLc = (input.ticketColor ?? "").toLowerCase().trim();

    // Regel 1: kun Fullt Hus (fase 5).
    if (input.phase !== 5) {
      return {
        triggered: false,
        amountCents: 0,
        colorFamily,
        lookupMatch: "none",
      };
    }

    // Regel 2: kun hvis vunnet PÅ eller FØR jackpot.draw.
    const maxDraw = Math.floor(input.jackpotConfig.draw ?? 0);
    if (
      !Number.isFinite(input.drawSequenceAtWin) ||
      input.drawSequenceAtWin <= 0 ||
      input.drawSequenceAtWin > maxDraw
    ) {
      return {
        triggered: false,
        amountCents: 0,
        colorFamily,
        lookupMatch: "none",
      };
    }

    // Regel 3: oppslag. Først eksakt ticket-farge (#316), så farge-familie.
    let nok = 0;
    let lookupMatch: "exact" | "family" | "none" = "none";
    const exact = ticketLc ? pbc[ticketLc] : undefined;
    if (typeof exact === "number" && Number.isFinite(exact) && exact > 0) {
      nok = exact;
      lookupMatch = "exact";
    } else if (colorFamily !== "other") {
      const family = pbc[colorFamily];
      if (typeof family === "number" && Number.isFinite(family) && family > 0) {
        nok = family;
        lookupMatch = "family";
      }
    }

    if (nok <= 0) {
      // Regel 5: 0 eller mangler = av.
      return {
        triggered: false,
        amountCents: 0,
        colorFamily,
        lookupMatch: "none",
      };
    }

    const amountCents = Math.round(nok * 100);
    return { triggered: true, amountCents, colorFamily, lookupMatch };
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Map ticket-farge (f.eks. "small_yellow", "large_white", "elvis1") til en
 * jackpot-farge-familie. Etter #316 er det 7 familier + "other".
 *
 * Match-semantikk: case-insensitiv, matcher suffix (`_yellow`) og exact
 * name ("yellow"). `elvis1..elvis5` → "elvis" familien.
 */
export function resolveColorFamily(ticketColor: string): JackpotColorFamily {
  const lc = (ticketColor ?? "").toLowerCase().trim();
  if (lc === "yellow" || lc.endsWith("_yellow")) return "yellow";
  if (lc === "white" || lc.endsWith("_white")) return "white";
  if (lc === "purple" || lc.endsWith("_purple")) return "purple";
  if (lc === "red" || lc.endsWith("_red")) return "red";
  if (lc === "green" || lc.endsWith("_green")) return "green";
  if (lc === "orange" || lc.endsWith("_orange")) return "orange";
  if (/^elvis\d*$/.test(lc)) return "elvis";
  return "other";
}
