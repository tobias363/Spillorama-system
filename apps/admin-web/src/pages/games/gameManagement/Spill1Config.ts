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

/**
 * BIN-689: Spill 1-sub-varianter.
 *
 * - `"norsk-bingo"` — standard 5-fase (1 Rad → 2 Rader → 3 Rader → 4 Rader → Fullt Hus).
 *   Dette er default-valget og matcher `DEFAULT_NORSK_BINGO_CONFIG` i backend.
 * - `"kvikkis"` — hurtig-bingo med kun én pattern (Fullt Hus, 1000 kr fastpremie).
 *   Matcher `DEFAULT_QUICKBINGO_CONFIG` i backend. Admin-UI viser kun
 *   Fullt Hus-premie-kolonnen; rad 1-4 er skjult/disabled.
 *
 * Verdien lagres i `config.spill1.subVariant` og leses av backend-mapperen
 * for å bestemme hvilken default-patterns-liste som skal brukes.
 */
export const SPILL1_SUB_VARIANTS = ["norsk-bingo", "kvikkis"] as const;
export type Spill1SubVariant = (typeof SPILL1_SUB_VARIANTS)[number];

/** Pattern-sliste som er aktiv for en gitt sub-variant. */
export function patternsForSubVariant(subVariant: Spill1SubVariant): ReadonlyArray<Spill1Pattern> {
  return subVariant === "kvikkis" ? (["full_house"] as const) : SPILL1_PATTERNS;
}

/** Hvordan en admin-konfigurert pattern-gevinst tolkes. */
export type PatternPrizeMode =
  | "percent"
  | "fixed"
  | "multiplier-chain"
  | "column-specific"
  | "ball-value-multiplier";

/**
 * Admin-konfigurert gevinst for én fase på én farge.
 *
 * - `mode: "percent"` → `amount` er 0-100, prosent av total pot for den fasen.
 * - `mode: "fixed"`   → `amount` er hele kroner, flat utbetaling. Kan kappes
 *   av RTP-guards i backend `payoutPhaseWinner` hvis pool er for liten —
 *   vinner får da mindre enn lovet beløp (PM-vedtak 2026-04-21).
 * - `mode: "multiplier-chain"` (BIN-687 / PR-P2 Spillernes spill):
 *   Fase 1: `amount` = 0-100 (prosent av pot), `minPrizeNok` er gulvet.
 *   Fase N>1: `amount` = 0 (ubrukt), `phase1Multiplier` × fase 1 base,
 *   `minPrizeNok` er gulvet.
 *   Backend mapper til `PatternConfig.winningType = "multiplier-chain"` +
 *   `phase1Multiplier` + `minPrize` (kr).
 * - `mode: "column-specific"` (PR-P3 Super-NILS):
 *   Kun lovlig på `full_house`-pattern. `amount` er ubrukt.
 *   `columnPrizesNok` angir 5 kolonne-spesifikke premier (B/I/N/G/O),
 *   der kolonnen til siste trukne ball avgjør payout. Validator avviser
 *   mode på alle andre patterns enn full_house.
 * - `mode: "ball-value-multiplier"` (PR-P4 Ball × 10):
 *   Kun lovlig på `full_house`. `amount` er ubrukt.
 *   Final premie = `baseFullHousePrizeNok + lastBall × ballValueMultiplier`.
 *   Bruker rå ball-verdi (ikke kolonne). Begge felt er påkrevde; validator
 *   avviser på alle andre patterns enn full_house.
 */
export interface PatternPrize {
  mode: PatternPrizeMode;
  /**
   * percent-mode: prosent 0-100 av pot.
   * fixed-mode: kr-beløp ≥ 0.
   * multiplier-chain fase 1: prosent 0-100 av pot (samme som percent-mode).
   * multiplier-chain fase N>1: ubrukt (0), ignoreres av mapper.
   * column-specific: ubrukt (0), ignoreres av mapper.
   */
  amount: number;
  /**
   * BIN-687 / PR-P2: multiplier-of-phase-1. Kun satt i multiplier-chain-mode
   * på fase > 1. Absent på fase 1 (base-fasen som andre faser refererer til).
   */
  phase1Multiplier?: number;
  /**
   * BIN-687 / PR-P2: minimum gevinst i NOK (hele kroner) for denne fasen.
   * Hvis beregnet gevinst < minPrizeNok, brukes minPrizeNok. Gjelder alle
   * mode-er men typisk mest relevant for percent + multiplier-chain.
   */
  minPrizeNok?: number;
  /**
   * PR-P3 (Super-NILS): per-kolonne premie-matrise for Fullt Hus. Kun
   * brukt i `mode: "column-specific"` på `full_house`-pattern. Alle 5
   * kolonne-verdier må være ≥ 0. Validator avviser negative verdier og
   * bruk på ikke-full_house-patterns.
   */
  columnPrizesNok?: {
    B: number;
    I: number;
    N: number;
    G: number;
    O: number;
  };
  /**
   * PR-P4 (Ball × 10): base premie i NOK for Fullt Hus når
   * `mode === "ball-value-multiplier"`. Må være ≥ 0.
   */
  baseFullHousePrizeNok?: number;
  /**
   * PR-P4 (Ball × 10): multiplier per ball-verdi (NOK). Må være > 0.
   */
  ballValueMultiplier?: number;
}

/** Per-farge pris + gevinst-fordeling per pattern. */
export interface TicketColorConfig {
  color: Spill1TicketColor;
  /** Pris per bong i NOK (hele kroner). */
  priceNok: number;
  /**
   * Gevinst per pattern. Hver fase kan være prosent av pot eller fast kr —
   * valgbart per (farge, fase) via `PatternPrize.mode`. Mangler en fase
   * tolkes det i backend-mapper som "bruk default for den fasen" (PR B).
   */
  prizePerPattern: Partial<Record<Spill1Pattern, PatternPrize>>;
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

/**
 * BIN-690 M1: Minispill (mini-games) som skal trigges etter Fullt Hus.
 *
 * Admin velger hvilke spill som skal være aktive for dette Spill 1-spillet.
 * Orchestrator (Game1MiniGameOrchestrator) plukker første aktive type i
 * rotasjonen etter Fullt Hus. Tom array = ingen mini-game.
 *
 * Framework-typer (må matche backend MiniGameType i
 * apps/backend/src/game/minigames/types.ts):
 *   - "wheel"      — Lykkehjulet (M2)
 *   - "chest"      — Skattekisten (M3)
 *   - "colordraft" — Fargekladden, 12-luker (M4)
 *   - "oddsen"     — Oddsen, cross-round ball-number-bet (M5)
 *
 * M1-framework støtter alle typer; konkrete implementasjoner lander i M2-M5.
 */
export type Spill1MiniGameType = "wheel" | "chest" | "colordraft" | "oddsen";

/** Alle tilgjengelige mini-game-typer (for UI-iterasjon). */
export const SPILL1_MINI_GAME_TYPES: readonly Spill1MiniGameType[] = [
  "wheel",
  "chest",
  "colordraft",
  "oddsen",
] as const;

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
  /**
   * BIN-689: Sub-variant. `"norsk-bingo"` = 5-fase (default), `"kvikkis"` =
   * hurtig-bingo (kun Fullt Hus). Kan være undefined i legacy-konfig —
   * tolkes da som `"norsk-bingo"` i UI + mapper for bakoverkompat.
   */
  subVariant?: Spill1SubVariant;
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
  /**
   * BIN-690 M1: valgte mini-game-typer som trigges etter Fullt Hus.
   * Tom array = ingen mini-game. Backend orchestrator plukker første aktive
   * type i rotasjonen. Se `SPILL1_MINI_GAME_TYPES` for tilgjengelige verdier.
   */
  miniGames: Spill1MiniGameType[];
  /**
   * PR-P5 (Extra-variant): egendefinerte concurrent patterns.
   *
   * MVP-scope: admin redigerer dette feltet via config-JSON foreløpig.
   * Full mask-editor-UI + per-farge-payout-matrise kommer i PR-P5b
   * (post-pilot). Foreløpig validerer vi bare strukturen.
   *
   * Mutually exclusive med standard pattern-flyt: når `customPatterns` er
   * satt og ikke-tom, må admin bruke egendefinerte mønstre og ikke
   * `prizePerPattern` (row_1-4+full_house). Backend-validator i
   * startGame enforcer dette med DomainError("CUSTOM_AND_STANDARD_EXCLUSIVE")
   * hvis `patternsByColor` samtidig er satt.
   *
   * TODO (PR-P5b): bygg mask-editor widget (gjenbruker `wireGrid` fra
   * apps/admin-web/src/pages/games/patternManagement/PatternAddPage.ts)
   * og per-farge-payout-matrise per custom pattern.
   */
  customPatterns?: AdminCustomPattern[];
}

/**
 * PR-P5 (Extra-variant): admin-konfigurert concurrent pattern.
 * Speiler `CustomPatternDefinition` i backend `variantConfig.ts`.
 */
export interface AdminCustomPattern {
  /** Unik ID innen config, f.eks. "bilde", "ramme", "full_bong". */
  patternId: string;
  /** Display-navn vist i UI og popup. */
  name: string;
  /** 25-bit bitmask for 5×5 grid. Min 1 celle satt. */
  mask: number;
  /** claimType: "LINE" for del-patterns, "BINGO" for full-house-lignende. */
  claimType: "LINE" | "BINGO";
  /** Gevinst-modus. Gjenbruker eksisterende winning-types fra P2/P3/P4. */
  winningType?: PatternPrizeMode;
  /** Payout-felter — brukes avhengig av winningType (samme som PatternPrize). */
  prizePercent?: number;
  prize1Nok?: number;
  phase1Multiplier?: number;
  minPrizeNok?: number;
  columnPrizesNok?: {
    B: number;
    I: number;
    N: number;
    G: number;
    O: number;
  };
  baseFullHousePrizeNok?: number;
  ballValueMultiplier?: number;
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
    subVariant: "norsk-bingo",
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
    miniGames: [],
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
 *   - Per ticket-farge: sum av prizePerPattern-entries med mode="percent"
 *     ≤ 100. Entries med mode="fixed" teller ikke mot taket (kan fritt
 *     overstige pot; kappes av RTP-guards i backend ved utbetaling).
 *   - Per prize-entry: amount er et endelig tall ≥ 0.
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

  // BIN-689: for Kvikkis er det kun Fullt Hus-fasen som konfigureres —
  // andre pattern-entries ignoreres av UI-en men må ikke feile validering
  // hvis de ligger fra gammelt av i state.
  const activePatterns = new Set(
    patternsForSubVariant(config.subVariant ?? "norsk-bingo") as ReadonlyArray<string>,
  );

  // Per ticket-farge.
  config.ticketColors.forEach((tc, i) => {
    if (!Number.isFinite(tc.priceNok) || tc.priceNok <= 0) {
      errors.push({
        path: `ticketColors[${i}].priceNok`,
        message: "please_enter_ticket_price",
      });
    }
    // Per-entry sanity: amount må være endelig og ≥ 0.
    let percentTotal = 0;
    for (const [pattern, prize] of Object.entries(tc.prizePerPattern)) {
      if (!prize) continue;
      // Kvikkis: kun full_house er aktiv — hopp over validering for
      // inaktive fase-entries (UI-en viser dem ikke uansett).
      if (!activePatterns.has(pattern)) continue;
      if (!Number.isFinite(prize.amount) || prize.amount < 0) {
        errors.push({
          path: `ticketColors[${i}].prizePerPattern.${pattern}`,
          message: "pattern_prize_amount_must_be_non_negative",
        });
        continue;
      }
      if (prize.mode === "percent") {
        percentTotal += prize.amount;
      }
      // PR-P4: ball-value-multiplier-modus (Ball × 10) validering.
      if (prize.mode === "ball-value-multiplier") {
        if (pattern !== "full_house") {
          errors.push({
            path: `ticketColors[${i}].prizePerPattern.${pattern}.mode`,
            message: "ball_value_multiplier_only_on_full_house",
          });
        }
        if (
          typeof prize.baseFullHousePrizeNok !== "number" ||
          !Number.isFinite(prize.baseFullHousePrizeNok) ||
          prize.baseFullHousePrizeNok < 0
        ) {
          errors.push({
            path: `ticketColors[${i}].prizePerPattern.${pattern}.baseFullHousePrizeNok`,
            message: "ball_value_base_must_be_non_negative",
          });
        }
        if (
          typeof prize.ballValueMultiplier !== "number" ||
          !Number.isFinite(prize.ballValueMultiplier) ||
          prize.ballValueMultiplier <= 0
        ) {
          errors.push({
            path: `ticketColors[${i}].prizePerPattern.${pattern}.ballValueMultiplier`,
            message: "ball_value_multiplier_must_be_positive",
          });
        }
      }
      // PR-P3: column-specific-modus (Super-NILS) validering.
      if (prize.mode === "column-specific") {
        // Kun gyldig på full_house.
        if (pattern !== "full_house") {
          errors.push({
            path: `ticketColors[${i}].prizePerPattern.${pattern}.mode`,
            message: "column_specific_only_on_full_house",
          });
        }
        // columnPrizesNok påkrevd og alle 5 verdier må være ≥ 0.
        if (!prize.columnPrizesNok) {
          errors.push({
            path: `ticketColors[${i}].prizePerPattern.${pattern}.columnPrizesNok`,
            message: "column_specific_requires_all_five_columns",
          });
        } else {
          for (const col of ["B", "I", "N", "G", "O"] as const) {
            const v = prize.columnPrizesNok[col];
            if (!Number.isFinite(v) || v < 0) {
              errors.push({
                path: `ticketColors[${i}].prizePerPattern.${pattern}.columnPrizesNok.${col}`,
                message: "column_specific_prize_must_be_non_negative",
              });
            }
          }
        }
      }
      // BIN-687 / PR-P2 validering for multiplier-chain-modus.
      if (prize.mode === "multiplier-chain") {
        // isPhase1 = fravær av phase1Multiplier-felt. `0` er eksplisitt
        // ugyldig (avvises nedenfor), ikke tolket som phase-1-marker.
        const isPhase1 = prize.phase1Multiplier === undefined;
        if (isPhase1) {
          // Fase 1: amount = prosent 0-100. Brukes i percent-total-summen
          // for cascade-base-beregning.
          if (prize.amount > 100) {
            errors.push({
              path: `ticketColors[${i}].prizePerPattern.${pattern}.amount`,
              message: "multiplier_chain_phase1_percent_must_be_0_to_100",
            });
          }
          percentTotal += prize.amount;
        } else {
          // Fase N > 1: phase1Multiplier må være > 0.
          if (
            !Number.isFinite(prize.phase1Multiplier) ||
            (prize.phase1Multiplier ?? 0) <= 0
          ) {
            errors.push({
              path: `ticketColors[${i}].prizePerPattern.${pattern}.phase1Multiplier`,
              message: "multiplier_chain_multiplier_must_be_positive",
            });
          }
        }
      }
      // minPrizeNok (valgfri, gjelder alle moduser) må være ≥ 0 hvis satt.
      if (
        prize.minPrizeNok !== undefined &&
        (!Number.isFinite(prize.minPrizeNok) || prize.minPrizeNok < 0)
      ) {
        errors.push({
          path: `ticketColors[${i}].prizePerPattern.${pattern}.minPrizeNok`,
          message: "pattern_prize_min_must_be_non_negative",
        });
      }
    }
    if (percentTotal > 100) {
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

  // BIN-690 M1: mini-games. Valgfritt (tom array er OK). Valider at hver
  // entry er en kjent type — ingen begrensninger på antall eller kombinasjon.
  if (!Array.isArray(config.miniGames)) {
    errors.push({ path: "miniGames", message: "mini_games_invalid" });
  } else {
    const allowed = new Set<string>(SPILL1_MINI_GAME_TYPES);
    config.miniGames.forEach((mg, i) => {
      if (!allowed.has(mg)) {
        errors.push({
          path: `miniGames[${i}]`,
          message: "mini_games_unknown_type",
        });
      }
    });
  }

  // PR-P5: customPatterns-validering (Extra-variant).
  if (config.customPatterns && config.customPatterns.length > 0) {
    const seenIds = new Set<string>();
    const seenMasks = new Set<number>();
    config.customPatterns.forEach((cp, idx) => {
      // patternId må være unik innen config.
      if (!cp.patternId || typeof cp.patternId !== "string" || cp.patternId.trim() === "") {
        errors.push({
          path: `customPatterns[${idx}].patternId`,
          message: "custom_pattern_id_required",
        });
      } else if (seenIds.has(cp.patternId)) {
        errors.push({
          path: `customPatterns[${idx}].patternId`,
          message: "custom_pattern_id_duplicate",
        });
      } else {
        seenIds.add(cp.patternId);
      }
      // name påkrevd.
      if (!cp.name || typeof cp.name !== "string" || cp.name.trim() === "") {
        errors.push({
          path: `customPatterns[${idx}].name`,
          message: "custom_pattern_name_required",
        });
      }
      // mask: 25-bit, min 1 celle satt, max 0x1FFFFFF.
      if (
        typeof cp.mask !== "number" ||
        !Number.isFinite(cp.mask) ||
        cp.mask <= 0 ||
        cp.mask > 0x1ffffff
      ) {
        errors.push({
          path: `customPatterns[${idx}].mask`,
          message: "custom_pattern_mask_invalid",
        });
      } else if (seenMasks.has(cp.mask)) {
        errors.push({
          path: `customPatterns[${idx}].mask`,
          message: "custom_pattern_mask_duplicate",
        });
      } else {
        seenMasks.add(cp.mask);
      }
      // winningType-spesifikk validering:
      if (cp.winningType === "fixed" && (typeof cp.prize1Nok !== "number" || cp.prize1Nok < 0)) {
        errors.push({
          path: `customPatterns[${idx}].prize1Nok`,
          message: "custom_pattern_fixed_requires_prize1",
        });
      }
      if (
        cp.winningType === "percent" &&
        (typeof cp.prizePercent !== "number" || cp.prizePercent < 0 || cp.prizePercent > 100)
      ) {
        errors.push({
          path: `customPatterns[${idx}].prizePercent`,
          message: "custom_pattern_percent_0_to_100",
        });
      }
    });
    // Minst 1 pattern (redundant med length > 0, men eksplisitt melding hvis
    // admin setter customPatterns til []-liste ved feil — hmm, i det tilfellet
    // faller vi uansett tilbake til standard-flyt per regresjonstesten.
    // Så her aksepterer vi length > 0 uten ytterligere min-check.
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
