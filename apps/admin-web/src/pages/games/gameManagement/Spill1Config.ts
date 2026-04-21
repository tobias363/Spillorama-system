// Spill 1 (Bingo 75-ball, 5x5)-spesifikk konfigurasjon + validering.
//
// Dette er datakontrakten som admin-UI bruker for Spill 1 Add-formen.
// Strukturen speiler legacy `ticketTypesData`, `jackpotData`, `elvisData`
// fra `legacy/unity-backend/App/Controllers/scheduleController.js:400-518`
// (createSchedulePostData-body) — men normalisert og typesikret.
//
// Alle verdier lagres i backend `GameManagement.config.spill1` som JSON
// siden backend-schema `config: Record<string, unknown>` tillater fri-form.
//
// Beløp oppgis i NOK (hele kroner) i UI-en og konverteres til øre ved
// submission (x100) for backend-feltet `ticketPrice` (smallest currency unit).

/** Tillatte billett-farger for Spill 1 (Bingo 75-ball). */
export const SPILL1_TICKET_COLORS = [
  "small_yellow",
  "large_yellow",
  "small_white",
  "large_white",
  "small_purple",
  "large_purple",
  "small_red",
  "small_green",
  "small_orange",
  "elvis1",
  "elvis2",
  "elvis3",
  "elvis4",
  "elvis5",
] as const;

export type Spill1TicketColor = (typeof SPILL1_TICKET_COLORS)[number];

/** Pattern-linjer for norsk 5-fase bingo (BIN-694). */
export const SPILL1_PATTERNS = ["row_1", "row_2", "row_3", "row_4", "full_house"] as const;

export type Spill1Pattern = (typeof SPILL1_PATTERNS)[number];

/** Per-farge pris + gevinst-fordeling per pattern. */
export interface TicketColorConfig {
  color: Spill1TicketColor;
  /** Pris per bong i NOK (hele kroner). */
  priceNok: number;
  /**
   * Gevinst per pattern, enten som prosent av pot (0-100) eller fast kr-beløp.
   * Legacy mønster: prize[color.slice(6)] — der 6 er "Small "/"Large " prefix.
   */
  prizePerPattern: Partial<Record<Spill1Pattern, number>>;
  /** Kun brukt for Spillerness-subspill. */
  minimumPrizeNok?: number;
}

/** Jackpot-konfigurasjon per farge.
 *
 * `prizeByColor` er en generisk map fra ticket-farge-slug til premie i NOK.
 * Tidligere var denne låst til `{ white, yellow, purple }`, men siden admin
 * nå kan konfigurere jackpot for en hvilken som helst av de 14 farger i
 * SPILL1_TICKET_COLORS, bruker vi `Record<string, number>` (backend
 * `jackpotData` er allerede `z.record(z.string(), z.unknown())`).
 *
 * Nøklene er farge-slugger som matcher SPILL1_TICKET_COLORS, f.eks.
 * `small_white`, `large_yellow`, `elvis1`. 0 = ingen jackpot for den fargen.
 */
export interface JackpotConfig {
  /** Jackpot-premie i NOK (hele kroner) per farge-slug. */
  prizeByColor: Record<string, number>;
  /** Antall kuler som må trekkes for å vinne jackpot (typisk 50-59). */
  draw: number;
}

/** Elvis-spesifikke felter. */
export interface ElvisConfig {
  /** Pris (NOK) for å erstatte en Elvis-billett. */
  replaceTicketPriceNok: number;
}

/** Timing-felter — sekunder mellom trekninger. */
export interface Spill1Timing {
  /** Minimum sekunder per kule-trekning. */
  minseconds: number;
  /** Maksimum sekunder per kule-trekning. */
  maxseconds: number;
  /** Total sekunder per kule (typisk samme som minseconds). */
  seconds: number;
  /** Sekunder før spill-start som varsling vises. Legacy var "5m" eller "60s". */
  notificationStartTimeSeconds: number;
}

/** Hele Spill 1-config-strukturen som lagres i backend `config.spill1`. */
export interface Spill1Config {
  /** Override av generisk `name`-felt; "" betyr ikke satt. */
  customGameName: string;
  /** Klokkeslett "HH:MM". */
  startTime: string;
  /** Klokkeslett "HH:MM". Kan være tom for det siste spillet i en plan. */
  endTime: string;
  timing: Spill1Timing;
  /** Valgte billett-farger m/priser + pattern-gevinst. */
  ticketColors: TicketColorConfig[];
  jackpot: JackpotConfig;
  elvis: ElvisConfig;
  /** Lucky number-premie i NOK (hele kroner). */
  luckyNumberPrizeNok: number;
}

/** Valideringsresultat fra `validateSpill1Config`. */
export interface ValidationError {
  /** Feltnavn i dot-path form, f.eks. "ticketColors[0].priceNok". */
  path: string;
  /** i18n-nøkkel eller rå tekst-melding. */
  message: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };

/** Default tom Spill 1-config — brukt for nye skjema-inits. */
export function emptySpill1Config(): Spill1Config {
  return {
    customGameName: "",
    startTime: "",
    endTime: "",
    timing: {
      minseconds: 3,
      maxseconds: 6,
      seconds: 5,
      notificationStartTimeSeconds: 300,
    },
    ticketColors: [],
    jackpot: {
      prizeByColor: {},
      draw: 50,
    },
    elvis: { replaceTicketPriceNok: 0 },
    luckyNumberPrizeNok: 0,
  };
}

/** Sjekk om et HH:MM-tidspunkt er gyldig. */
function isValidHhMm(s: string): boolean {
  return /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(s);
}

/** Sekunder mellom to HH:MM-tidspunkter (kun sammenligning for A<B). */
function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Valider Spill 1-config. Returnerer alle feil som fanges.
 *
 * Regler (matcher legacy + PM-spec):
 *   - startTime < endTime (hvis endTime satt)
 *   - Minst én ticket-farge valgt
 *   - Per ticket-farge: priceNok > 0
 *   - Per ticket-farge: sum av prizePerPattern ≤ 100 (% av pot)
 *   - minseconds < maxseconds, minseconds >= 3
 *   - notificationStartTime > 0
 *   - Jackpot draw mellom 50 og 59
 *   - Jackpot prize: 0 eller mellom 5000 og 50000 NOK (per regulatorisk spec)
 */
export function validateSpill1Config(config: Spill1Config, baseName: string): ValidationResult {
  const errors: ValidationError[] = [];

  // Base name må finnes (generisk `name`-felt fra GameManagement).
  if (!baseName || !baseName.trim()) {
    errors.push({ path: "name", message: "game_name_required" });
  }

  // startTime er påkrevd; endTime er valgfritt men hvis satt må < startTime.
  if (!config.startTime || !isValidHhMm(config.startTime)) {
    errors.push({ path: "startTime", message: "start_time_required_hhmm" });
  }
  if (config.endTime) {
    if (!isValidHhMm(config.endTime)) {
      errors.push({ path: "endTime", message: "end_time_invalid_hhmm" });
    } else if (
      isValidHhMm(config.startTime) &&
      hhmmToMinutes(config.startTime) >= hhmmToMinutes(config.endTime)
    ) {
      errors.push({
        path: "endTime",
        message: "end_time_must_be_greater_than_start_time",
      });
    }
  }

  // Timing.
  if (config.timing.minseconds < 3) {
    errors.push({
      path: "timing.minseconds",
      message: "minimum_seconds_must_be_greater_than_3",
    });
  }
  if (config.timing.minseconds >= config.timing.maxseconds) {
    errors.push({
      path: "timing.maxseconds",
      message: "maxsecond_muts_be_greater_than_minsecond",
    });
  }
  if (config.timing.notificationStartTimeSeconds <= 0) {
    errors.push({
      path: "timing.notificationStartTimeSeconds",
      message: "notification_start_time_must_be_positive",
    });
  }

  // Minst én ticket-farge valgt.
  if (config.ticketColors.length === 0) {
    errors.push({ path: "ticketColors", message: "please_select_at_least_one_ticket_color" });
  }

  // Per ticket-farge.
  config.ticketColors.forEach((tc, i) => {
    if (!Number.isFinite(tc.priceNok) || tc.priceNok <= 0) {
      errors.push({
        path: `ticketColors[${i}].priceNok`,
        message: "please_enter_ticket_price",
      });
    }
    // Pattern-prize-prosent-total.
    const total = Object.values(tc.prizePerPattern).reduce<number>(
      (sum, v) => sum + (Number.isFinite(v) ? (v ?? 0) : 0),
      0
    );
    if (total > 100) {
      errors.push({
        path: `ticketColors[${i}].prizePerPattern`,
        message: "row_pattern_prize_percentage_must_be_less_or_equal_to_100",
      });
    }
  });

  // Jackpot.
  if (!Number.isInteger(config.jackpot.draw) || config.jackpot.draw < 50 || config.jackpot.draw > 59) {
    errors.push({ path: "jackpot.draw", message: "jackpot_draw_between_50_57" });
  }
  // Jackpot-premie per farge: 0 betyr "ingen jackpot"; ellers må være 5000-50000 kr.
  // Nøklene er fri-form (en hvilken som helst farge-slug) — men vi validerer
  // bare nummerisk range, ikke om slug tilhører SPILL1_TICKET_COLORS (form-UI
  // er kilden til sannhet for hvilke farger som er aktuelle).
  for (const [color, prize] of Object.entries(config.jackpot.prizeByColor)) {
    if (!Number.isFinite(prize)) {
      errors.push({
        path: `jackpot.prizeByColor.${color}`,
        message: "jackpot_prize_must_between_5k_50k",
      });
      continue;
    }
    if (prize !== 0 && (prize < 5000 || prize > 50000)) {
      errors.push({
        path: `jackpot.prizeByColor.${color}`,
        message: "jackpot_prize_must_between_5k_50k",
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}

/**
 * Bygg submit-payload til `/api/admin/game-management`-POST.
 * Mapper NOK-beløp til øre (x100) for backend-primitive `ticketPrice`.
 * Hele Spill 1-config-objektet legges i `config.spill1`.
 *
 * `startDate` er en ISO-dato med tidspunkt — kombinasjonen av dato-input og
 * `startTime`. Dato er valgt i hoved-formen og kommer inn som `isoDate`.
 */
export function buildSpill1Payload(input: {
  gameTypeId: string;
  name: string;
  isoDate: string; // YYYY-MM-DD (dato-del av ISO)
  spill1: Spill1Config;
  /** Defaults til laveste pris (pris til små hvite i legacy). */
  defaultTicketTypePriceNok?: number;
}): {
  gameTypeId: string;
  name: string;
  ticketType: "Large" | "Small" | null;
  ticketPrice: number;
  startDate: string;
  endDate: string | null;
  status: "active";
  config: { spill1: Spill1Config };
} {
  // Bestemme primær ticket-type: velg "Large" hvis noen av valgte farger
  // har prefix "large_", ellers "Small".
  let ticketType: "Large" | "Small" | null = null;
  if (input.spill1.ticketColors.length > 0) {
    const hasLarge = input.spill1.ticketColors.some((tc) => tc.color.startsWith("large_"));
    ticketType = hasLarge ? "Large" : "Small";
  }

  // Primær ticketPrice (øre): laveste prisen blant valgte farger, for kompat.
  // UI-en viser full per-farge-matrix i `config.spill1.ticketColors`.
  let ticketPriceOere = 0;
  if (input.spill1.ticketColors.length > 0) {
    const min = Math.min(...input.spill1.ticketColors.map((tc) => tc.priceNok));
    ticketPriceOere = Math.round((Number.isFinite(min) ? min : 0) * 100);
  } else if (input.defaultTicketTypePriceNok) {
    ticketPriceOere = Math.round(input.defaultTicketTypePriceNok * 100);
  }

  const startIso = input.spill1.startTime
    ? `${input.isoDate}T${input.spill1.startTime}:00.000Z`
    : `${input.isoDate}T00:00:00.000Z`;
  const endIso = input.spill1.endTime
    ? `${input.isoDate}T${input.spill1.endTime}:00.000Z`
    : null;

  // Normaliser jackpot.prizeByColor: dropp farger med 0 eller ikke-endelige
  // verdier slik at backend får bare aktive jackpot-farger. Bevar original
  // struktur for alle andre felter.
  const normalizedPrizeByColor: Record<string, number> = {};
  for (const [color, prize] of Object.entries(input.spill1.jackpot.prizeByColor)) {
    if (Number.isFinite(prize) && prize > 0) {
      normalizedPrizeByColor[color] = prize;
    }
  }
  const normalizedSpill1: Spill1Config = {
    ...input.spill1,
    jackpot: {
      ...input.spill1.jackpot,
      prizeByColor: normalizedPrizeByColor,
    },
  };

  return {
    gameTypeId: input.gameTypeId,
    name: input.name,
    ticketType,
    ticketPrice: ticketPriceOere,
    startDate: startIso,
    endDate: endIso,
    status: "active",
    config: { spill1: normalizedSpill1 },
  };
}
