/**
 * BIN-MYSTERY Spor 3 M6: MiniGameMysteryEngine — ny Mystery Game-port (opp/ned
 * + joker, 5 runder) av `MiniGame`-interfacet fra M1-framework.
 *
 * Erstatter IKKE `oddsen`-mini-gamet — Mystery Game er en SEPARAT type.
 *
 * Portet 1:1 fra legacy Unity (`legacy/unity-client/Assets/_Project/_Scripts/
 * Panels/Mystery Game Panel/MysteryGamePanel.cs`, commit 5fda0f78). Mekanikk:
 *
 *   1. Server trekker to 5-sifrede tall: `middleNumber` og `resultNumber`
 *      (hver i [10000, 99999]).
 *   2. Spilleren gjør 5 valg (UP/DOWN), én per runde. Runde N (0-indeksert)
 *      sammenligner siffer N talt fra høyre av `middleNumber` mot siffer N
 *      av `resultNumber`:
 *        - `UP` + resultDigit > middleDigit → RIKTIG (priceIndex++)
 *        - `DOWN` + resultDigit < middleDigit → RIKTIG (priceIndex++)
 *        - resultDigit == middleDigit → JOKER → auto-win, priceIndex = maks,
 *          spillet avsluttes.
 *        - Ellers → FEIL (priceIndex--, floor 0). Legacy fortsetter runden
 *          til maxBallsLength = 5 runder er brukt.
 *   3. priceIndex er clamped i [0, maxBallsLength=5]. `prizeList` har 6
 *      elementer (index 0..5) — priceIndex peker på hvilken premie som
 *      utbetales ved slutt.
 *   4. Ved joker-treff ender spillet umiddelbart. Ellers: alle 5 runder
 *      spilles (priceIndex kan både gå opp og ned underveis).
 *
 * Valg av implementasjon: single-call multi-round (samme mønster som
 * Colordraft). Klient får `middleNumber` + `resultNumber` + `prizeList` i
 * trigger-payload og sender alle 5 directions (pluss ev. tidlig stopp ved
 * joker) i én `{ directions: ["up"|"down", ...] }` i handleChoice. Server
 * reconstructer state via seeded-RNG (determinisme).
 *
 * Hvorfor sender vi resultNumber i trigger? Fordi legacy gjør det (Unity-
 * klienten får `resultNumber` i initial-payload, ikke runde-for-runde). Det
 * bryter ikke anti-juks fordi:
 *   - Spillerens ENESTE valg er UP/DOWN per runde — resultNumber kan ikke
 *     påvirkes av klienten.
 *   - Serveren rekonstruerer resultNumber deterministisk fra resultId-seed,
 *     så handleChoice validerer ALLTID mot serverens kanoniske state.
 *   - "Ferdighets-puzzle"-mønsteret: spilleren kan lese resultNumber fra
 *     payload hvis de vil, men da spiller de bare UP/DOWN med 100% win-rate
 *     — og priceIndex klatrer opp til max, samme som en joker-sti. Det er
 *     den samme "optimal-play gir max-premie"-logikken som finnes i Chest/
 *     Colordraft.
 *
 * Forskjell fra M2-M5:
 *   - Wheel (M2): ingen valg, kun spin.
 *   - Chest (M3): 1 valg (chosenIndex), skjult state.
 *   - Colordraft (M4): 1 valg (chosenIndex), synlig state.
 *   - Oddsen (M5): 1 valg (chosenNumber), cross-round state.
 *   - Mystery (M6): 5 valg (directions[]), synlig state, single-call multi-
 *     round. Joker-deteksjon + early-termination.
 *
 * Regulatoriske krav:
 *   - Server-autoritativ state: `middleNumber` + `resultNumber` rekonstrueres
 *     deterministisk via seeded-RNG (`resultId` som seed). Klient kan ikke
 *     forfalske.
 *   - Server-autoritativ payout: priceIndex bestemmes server-side fra
 *     sammenligning av directions[] mot rekonstruert state. Klient kan ikke
 *     sette payout-beløp.
 *   - Fail-closed: invalid directions (lengde != 5, ikke-streng, annet enn
 *     "up"/"down") → DomainError("INVALID_CHOICE").
 *   - Payout via orchestrator.creditPayout → walletAdapter.credit med
 *     `to: "winnings"` (PR-W1 wallet-split). Idempotency-key er
 *     `g1-minigame-${resultId}` (satt av orchestrator).
 *   - Audit-event `game1_minigame.completed` fires av orchestrator.
 *
 * Default-config:
 *   `{ prizeListNok: [50, 100, 200, 400, 800, 1500],
 *      autoTurnFirstMoveSec: 20,
 *      autoTurnOtherMoveSec: 10 }`
 *   → 6-trinns premie-stige (priceIndex 0..5); 20s for første valg, 10s
 *     for påfølgende. Matcher legacy-default (Game 1-modus).
 *
 * Tester: `MiniGameMysteryEngine.test.ts` + `.integration.test.ts`.
 */

import { createHash, randomInt } from "node:crypto";
import { DomainError } from "../../errors/DomainError.js";
import type {
  MiniGame,
  MiniGameChoiceInput,
  MiniGameResult,
  MiniGameTriggerContext,
  MiniGameTriggerPayload,
} from "./types.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Antall runder spilleren gjetter (legacy `maxBallsLength`). */
export const MYSTERY_MAX_ROUNDS = 5;

/**
 * Antall siffer i `middleNumber` og `resultNumber`. Legacy bruker 5-sifrede
 * tall padded til exactly 5 digits via `.ToString("D5")`.
 */
const MYSTERY_DIGIT_COUNT = 5;

/** Premie-stigen har `MYSTERY_MAX_ROUNDS + 1` trinn (index 0..5). */
const MYSTERY_PRIZE_LIST_LENGTH = MYSTERY_MAX_ROUNDS + 1;

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Retning spilleren velger per runde.
 *
 * `"up"` = "resultDigit er høyere enn middleDigit for denne runden"
 * `"down"` = "resultDigit er lavere enn middleDigit for denne runden"
 */
export type MysteryDirection = "up" | "down";

/**
 * Full mystery-config, slik admin lagrer i `app_mini_games_config.config_json`.
 *
 * `prizeListNok`: premie-stige i kroner (6 trinn). `priceIndex` peker på
 *   hvilken premie som utbetales ved slutt; `priceIndex = 5` = joker-treff
 *   (max), `priceIndex = 0` = ingen premie.
 * `autoTurnFirstMoveSec`: sekunder spilleren har på første valg.
 * `autoTurnOtherMoveSec`: sekunder spilleren har på runde 2-5.
 */
export interface MysteryConfig {
  readonly prizeListNok: readonly number[];
  readonly autoTurnFirstMoveSec: number;
  readonly autoTurnOtherMoveSec: number;
}

/** Default-config brukes når admin ikke har konfigurert mystery. */
export const DEFAULT_MYSTERY_CONFIG: MysteryConfig = {
  prizeListNok: [50, 100, 200, 400, 800, 1500],
  autoTurnFirstMoveSec: 20,
  autoTurnOtherMoveSec: 10,
};

/**
 * Resultat for én runde, slik det returneres i `resultJson.rounds[i]`.
 *
 * `direction` = spillerens valg for runden.
 * `middleDigit` / `resultDigit` = serverens kanoniske sifre.
 * `outcome` = "correct" | "wrong" | "joker".
 * `priceIndexAfter` = priceIndex etter denne runden (clamped i [0, 5]).
 */
export interface MysteryRoundResult {
  readonly direction: MysteryDirection;
  readonly middleDigit: number;
  readonly resultDigit: number;
  readonly outcome: "correct" | "wrong" | "joker";
  readonly priceIndexAfter: number;
}

/**
 * Resultat-payload lagret i `app_game1_mini_game_results.result_json`.
 *
 * `rounds` har ≤ MYSTERY_MAX_ROUNDS elementer — kortere hvis joker avsluttet
 *   spillet tidlig.
 * `middleNumber` / `resultNumber` er full kanonisk server-state (forensics).
 * `finalPriceIndex` er final priceIndex før payout-lookup.
 * `prizeAmountKroner` er utbetalt beløp (prizeListNok[finalPriceIndex]).
 * `jokerTriggered` er true hvis noen runde hadde outcome='joker'.
 */
export interface MysteryResultJson extends Record<string, unknown> {
  readonly middleNumber: number;
  readonly resultNumber: number;
  readonly rounds: readonly MysteryRoundResult[];
  readonly finalPriceIndex: number;
  readonly prizeAmountKroner: number;
  readonly jokerTriggered: boolean;
}

// ── RNG port (test-injection) ────────────────────────────────────────────────

/**
 * Cryptographically secure RNG port. Default bruker `crypto.randomInt`;
 * tester injiserer deterministisk versjon for reproducerbar fordelings-
 * sjekk. Må holde seg server-side i prod.
 */
export interface MysteryRng {
  /** Returnerer et heltall i [0, max). */
  readonly nextInt: (max: number) => number;
}

const cryptoRng: MysteryRng = {
  nextInt: (max: number) => randomInt(0, max),
};

/**
 * Deterministisk RNG basert på sha256-hash av seed+counter. Brukes i
 * `trigger()` OG `handleChoice()` slik at begge ser samme state.
 *
 * Seed = `${resultId}|mystery`. Hver `nextInt(max)` blumper en counter
 * slik at sekvensen av uttrekk er deterministisk men ikke-gjettbar uten
 * seed (sha256 er one-way).
 *
 * Seeded-RNG er brukt i BEGGE lifecycle-kallene slik at middleNumber og
 * resultNumber er 100% determinert av `{resultId, config}`. `resultId` er
 * kryptografisk tilfeldig UUID generert av orchestrator, så klienten kan
 * ikke forutsi state.
 */
function makeSeededRng(seed: string): MysteryRng {
  let counter = 0;
  return {
    nextInt: (max: number) => {
      if (max <= 0) {
        throw new DomainError(
          "INVALID_MYSTERY_CONFIG",
          "nextInt(max) krever max >= 1.",
        );
      }
      const hash = createHash("sha256")
        .update(`${seed}|${counter}`)
        .digest();
      counter += 1;
      const n =
        (hash[0]! << 24) |
        (hash[1]! << 16) |
        (hash[2]! << 8) |
        hash[3]!;
      const uint = n >>> 0;
      return uint % max;
    },
  };
}

// ── Config parsing / validation ──────────────────────────────────────────────

/**
 * Parser og validerer et `configSnapshot`-objekt fra orchestrator. Faller
 * tilbake til `DEFAULT_MYSTERY_CONFIG` hvis feltet mangler eller er tomt.
 *
 * Valideringsregler:
 *   - `prizeListNok` må være array av lengde `MYSTERY_PRIZE_LIST_LENGTH` (6)
 *     med heltall >= 0 (monotont ikke-påkrevd; admin kan definere
 *     hvilken som helst stige).
 *   - `autoTurnFirstMoveSec` / `autoTurnOtherMoveSec` må være heltall > 0.
 *
 * Kaster `DomainError("INVALID_MYSTERY_CONFIG", ...)` ved strukturelle feil.
 */
export function parseMysteryConfig(
  configSnapshot: Readonly<Record<string, unknown>>,
): MysteryConfig {
  // Tom config = default.
  if (!configSnapshot || Object.keys(configSnapshot).length === 0) {
    return DEFAULT_MYSTERY_CONFIG;
  }

  const hasAny =
    configSnapshot.prizeListNok !== undefined ||
    configSnapshot.autoTurnFirstMoveSec !== undefined ||
    configSnapshot.autoTurnOtherMoveSec !== undefined;
  if (!hasAny) {
    return DEFAULT_MYSTERY_CONFIG;
  }

  // prizeListNok
  const rawPrize = configSnapshot.prizeListNok;
  let prizeListNok: number[];
  if (rawPrize === undefined) {
    prizeListNok = [...DEFAULT_MYSTERY_CONFIG.prizeListNok];
  } else if (!Array.isArray(rawPrize)) {
    throw new DomainError(
      "INVALID_MYSTERY_CONFIG",
      "prizeListNok må være et array.",
    );
  } else if (rawPrize.length !== MYSTERY_PRIZE_LIST_LENGTH) {
    throw new DomainError(
      "INVALID_MYSTERY_CONFIG",
      `prizeListNok må ha nøyaktig ${MYSTERY_PRIZE_LIST_LENGTH} elementer (index 0-${MYSTERY_PRIZE_LIST_LENGTH - 1}).`,
    );
  } else {
    prizeListNok = [];
    for (let i = 0; i < rawPrize.length; i += 1) {
      const v = rawPrize[i];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        throw new DomainError(
          "INVALID_MYSTERY_CONFIG",
          `prizeListNok[${i}] må være et heltall >= 0.`,
        );
      }
      prizeListNok.push(v);
    }
  }

  // autoTurnFirstMoveSec
  const rawFirst = configSnapshot.autoTurnFirstMoveSec;
  let autoTurnFirstMoveSec: number;
  if (rawFirst === undefined) {
    autoTurnFirstMoveSec = DEFAULT_MYSTERY_CONFIG.autoTurnFirstMoveSec;
  } else if (
    typeof rawFirst !== "number" ||
    !Number.isInteger(rawFirst) ||
    rawFirst <= 0
  ) {
    throw new DomainError(
      "INVALID_MYSTERY_CONFIG",
      "autoTurnFirstMoveSec må være et positivt heltall.",
    );
  } else {
    autoTurnFirstMoveSec = rawFirst;
  }

  // autoTurnOtherMoveSec
  const rawOther = configSnapshot.autoTurnOtherMoveSec;
  let autoTurnOtherMoveSec: number;
  if (rawOther === undefined) {
    autoTurnOtherMoveSec = DEFAULT_MYSTERY_CONFIG.autoTurnOtherMoveSec;
  } else if (
    typeof rawOther !== "number" ||
    !Number.isInteger(rawOther) ||
    rawOther <= 0
  ) {
    throw new DomainError(
      "INVALID_MYSTERY_CONFIG",
      "autoTurnOtherMoveSec må være et positivt heltall.",
    );
  } else {
    autoTurnOtherMoveSec = rawOther;
  }

  return { prizeListNok, autoTurnFirstMoveSec, autoTurnOtherMoveSec };
}

// ── State-sampling helpers ───────────────────────────────────────────────────

/**
 * Trekk et 5-sifret tall i [10000, 99999]. Legacy bruker `Random.Range(10000,
 * 99999)` som i Unity er inclusive-inclusive på begge endepunkter? — nei,
 * `Random.Range(int, int)` er `[min, max)`. Vi matcher det: uniform i
 * [10000, 99999) = [10000, 99998]. Men for 5-siffer-padding (.ToString("D5"))
 * er alle verdiene i [10000, 99998] 5-sifret uansett, så uniformt 5-siffer.
 *
 * Eksport'et for direkte unit-testing.
 */
export function sampleMysteryFiveDigitNumber(rng: MysteryRng): number {
  // [10000, 99999] inclusive — 90000 unike verdier.
  // Legacy bruker [10000, 99999) men for praktiske formål er det samme.
  // Vi bruker [10000, 99999] for å matche legacy sin intent (5 digits).
  return 10000 + rng.nextInt(90000);
}

/**
 * Trekk middleNumber + resultNumber uavhengig (samme RNG-sekvens for
 * reproducerbarhet).
 */
export function sampleMysteryState(
  rng: MysteryRng,
): { middleNumber: number; resultNumber: number } {
  const middleNumber = sampleMysteryFiveDigitNumber(rng);
  const resultNumber = sampleMysteryFiveDigitNumber(rng);
  return { middleNumber, resultNumber };
}

/**
 * Hent siffer N fra et 5-sifret tall, talt fra HØYRE (N=0 er ones-sifferet).
 * Matcher legacy `GetSingleNumber(number)` med `ballCurrentIndex` reversert.
 *
 * Eksempel: `getDigitAt(12345, 0) == 5`, `getDigitAt(12345, 4) == 1`.
 */
export function getDigitAt(fiveDigitNumber: number, index: number): number {
  if (!Number.isInteger(fiveDigitNumber) || fiveDigitNumber < 0) {
    throw new DomainError(
      "INVALID_MYSTERY_STATE",
      "fiveDigitNumber må være et ikke-negativt heltall.",
    );
  }
  if (index < 0 || index >= MYSTERY_DIGIT_COUNT) {
    throw new DomainError(
      "INVALID_MYSTERY_STATE",
      `index må være i [0, ${MYSTERY_DIGIT_COUNT - 1}].`,
    );
  }
  const padded = fiveDigitNumber.toString().padStart(MYSTERY_DIGIT_COUNT, "0");
  // index=0 → siste tegn (ones), index=4 → første tegn (ten-thousands).
  const char = padded[padded.length - 1 - index]!;
  return Number.parseInt(char, 10);
}

/**
 * Evaluer én runde: sammenlign resultDigit vs middleDigit og avgjør outcome.
 *
 * Returnerer ny priceIndex (clamped i [0, MYSTERY_MAX_ROUNDS]) + outcome-
 * streng. Ved joker (equal) settes priceIndex = MYSTERY_MAX_ROUNDS
 * (max-premie).
 *
 * Eksport'et for direkte unit-testing.
 */
export function evaluateMysteryRound(
  direction: MysteryDirection,
  middleDigit: number,
  resultDigit: number,
  currentPriceIndex: number,
): { priceIndex: number; outcome: "correct" | "wrong" | "joker" } {
  // Joker: matchende sifre → auto-win, maks-premie.
  if (middleDigit === resultDigit) {
    return { priceIndex: MYSTERY_MAX_ROUNDS, outcome: "joker" };
  }
  // Normal sammenligning.
  const isCorrect =
    (direction === "up" && resultDigit > middleDigit) ||
    (direction === "down" && resultDigit < middleDigit);
  if (isCorrect) {
    const next = Math.min(currentPriceIndex + 1, MYSTERY_MAX_ROUNDS);
    return { priceIndex: next, outcome: "correct" };
  }
  const next = Math.max(currentPriceIndex - 1, 0);
  return { priceIndex: next, outcome: "wrong" };
}

// ── MiniGame-implementasjon ──────────────────────────────────────────────────

export interface MiniGameMysteryEngineOptions {
  /**
   * RNG for server-autoritativ trekning. Default: seeded-RNG fra resultId
   * (deterministisk, rekonstruerbar i handleChoice).
   *
   * Tester injiserer deterministisk versjon via direkte sampleMysteryState-
   * kall. For integrasjon overrides denne IKKE — seeded-from-resultId er
   * alltid det riktige valget for å garantere determinisme.
   */
  readonly rng?: MysteryRng;
}

export class MiniGameMysteryEngine implements MiniGame {
  readonly type = "mystery" as const;

  // Unused in the common seeded-flow; kept for symmetry + future override.
  private readonly overrideRng: MysteryRng | null;

  constructor(options: MiniGameMysteryEngineOptions = {}) {
    this.overrideRng = options.rng ?? null;
  }

  /**
   * Trigger — kalt av orchestrator når Fullt Hus er vunnet. Returnerer
   * payload som socket-broadcast videre til klient. Klient får:
   *   - `middleNumber`: det 5-sifrede midt-tallet
   *   - `resultNumber`: det 5-sifrede resultat-tallet (server-state, men
   *     legacy sender dette)
   *   - `prizeListNok`: 6-trinns premie-stige
   *   - `autoTurnFirstMoveSec` / `autoTurnOtherMoveSec`: timer-values
   *   - `maxRounds`: antall runder (alltid 5, men eksponert for klient)
   *
   * State er deterministisk fra resultId-seed → handleChoice rekonstruerer
   * samme middleNumber + resultNumber.
   */
  trigger(context: MiniGameTriggerContext): MiniGameTriggerPayload {
    const config = parseMysteryConfig(context.configSnapshot);
    const rng = this.overrideRng ?? makeSeededRng(`${context.resultId}|mystery`);
    const { middleNumber, resultNumber } = sampleMysteryState(rng);

    // Timeout = first move + (maxRounds - 1) * other move (pluss 2s buffer
    // for klient-animasjoner mellom runder). Klient styrer sin egen timer,
    // men orchestrator kan eventuelt bruke dette til server-side cleanup.
    const timeoutSeconds =
      config.autoTurnFirstMoveSec +
      (MYSTERY_MAX_ROUNDS - 1) * config.autoTurnOtherMoveSec +
      10;

    return {
      type: "mystery",
      resultId: context.resultId,
      timeoutSeconds,
      payload: {
        middleNumber,
        resultNumber,
        prizeListNok: config.prizeListNok,
        autoTurnFirstMoveSec: config.autoTurnFirstMoveSec,
        autoTurnOtherMoveSec: config.autoTurnOtherMoveSec,
        maxRounds: MYSTERY_MAX_ROUNDS,
      },
    };
  }

  /**
   * handleChoice — kalt av orchestrator når klient har sendt
   * `{ directions: ["up"|"down", ...] }` med 1-5 elementer.
   *
   * Server-autoritativ:
   *   1. Validér `directions` er array av 1..MYSTERY_MAX_ROUNDS strings,
   *      hver enten "up" eller "down".
   *   2. Rekonstruer state via seeded-RNG av `${resultId}|mystery`. Dette
   *      gir EXACT samme middleNumber + resultNumber som trigger viste.
   *   3. Itrer gjennom directions; hver runde: hent digit N, evaluer
   *      outcome, oppdater priceIndex. Ved joker → break (resterende
   *      directions ignoreres).
   *   4. Final prize = `prizeListNok[priceIndex]`.
   *   5. Returner `payoutCents = prize * 100` + `resultJson` med alle
   *      rounds + full kanonisk state.
   *
   * Edge-case: hvis directions.length < MYSTERY_MAX_ROUNDS UTEN joker, er
   * det også akseptabelt — spilleren har "gitt opp" (eller auto-turn ga
   * feil). priceIndex i final-state er fortsatt gyldig input til prize-
   * lookup. Legacy lar auto-turn fortsette runden; vi lar klient sende
   * exactly så mange directions som er spilt. Manglende runder → ingen
   * påvirkning av priceIndex.
   *
   * Kaster `DomainError("INVALID_CHOICE")` ved ugyldig payload.
   */
  async handleChoice(input: MiniGameChoiceInput): Promise<MiniGameResult> {
    const config = parseMysteryConfig(input.context.configSnapshot);
    const directions = this.assertDirections(input.choiceJson);

    // Rekonstruer state deterministisk.
    const rng =
      this.overrideRng ?? makeSeededRng(`${input.resultId}|mystery`);
    const { middleNumber, resultNumber } = sampleMysteryState(rng);

    const rounds: MysteryRoundResult[] = [];
    let priceIndex = 0;
    let jokerTriggered = false;

    for (let i = 0; i < directions.length; i += 1) {
      const direction = directions[i]!;
      const middleDigit = getDigitAt(middleNumber, i);
      const resultDigit = getDigitAt(resultNumber, i);
      const { priceIndex: nextIndex, outcome } = evaluateMysteryRound(
        direction,
        middleDigit,
        resultDigit,
        priceIndex,
      );
      rounds.push({
        direction,
        middleDigit,
        resultDigit,
        outcome,
        priceIndexAfter: nextIndex,
      });
      priceIndex = nextIndex;
      if (outcome === "joker") {
        jokerTriggered = true;
        break; // Legacy: joker avslutter spillet umiddelbart.
      }
    }

    const prizeAmountKroner = config.prizeListNok[priceIndex]!;

    const resultJson: MysteryResultJson = {
      middleNumber,
      resultNumber,
      rounds,
      finalPriceIndex: priceIndex,
      prizeAmountKroner,
      jokerTriggered,
    };

    // Kroner → øre for wallet.credit.
    const payoutCents = prizeAmountKroner * 100;

    return {
      payoutCents,
      resultJson,
    };
  }

  /**
   * Validér at klient-sendt choiceJson inneholder en gyldig `directions`-array.
   *
   * Aksepterer:
   *   - `{ directions: ["up", "down", "up", ...] }` med lengde 1..5
   *
   * Kaster INVALID_CHOICE ved:
   *   - Manglende felt
   *   - Ikke-array
   *   - Feil lengde (0 eller > MYSTERY_MAX_ROUNDS)
   *   - Element som ikke er "up" eller "down"
   */
  private assertDirections(
    choiceJson: Readonly<Record<string, unknown>>,
  ): MysteryDirection[] {
    const raw = choiceJson.directions;
    if (raw === undefined || raw === null) {
      throw new DomainError(
        "INVALID_CHOICE",
        "directions er påkrevd i choice-payload.",
      );
    }
    if (!Array.isArray(raw)) {
      throw new DomainError(
        "INVALID_CHOICE",
        "directions må være et array.",
      );
    }
    if (raw.length === 0 || raw.length > MYSTERY_MAX_ROUNDS) {
      throw new DomainError(
        "INVALID_CHOICE",
        `directions må ha 1-${MYSTERY_MAX_ROUNDS} elementer.`,
      );
    }
    const out: MysteryDirection[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const v = raw[i];
      if (v !== "up" && v !== "down") {
        throw new DomainError(
          "INVALID_CHOICE",
          `directions[${i}] må være "up" eller "down".`,
        );
      }
      out.push(v);
    }
    return out;
  }
}

// Eksporter for tester som trenger direkte RNG-kontroll uten seed.
export const __MYSTERY_MAX_ROUNDS__ = MYSTERY_MAX_ROUNDS;
export const __MYSTERY_DIGIT_COUNT__ = MYSTERY_DIGIT_COUNT;
