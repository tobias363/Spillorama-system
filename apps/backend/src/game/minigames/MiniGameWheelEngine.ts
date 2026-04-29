/**
 * BIN-690 Spor 3 M2: MiniGameWheelEngine — konkret Wheel-implementasjon av
 * `MiniGame`-interfacet fra M1-framework.
 *
 * Kobler admin-konfig (`MiniGamesConfigService.getConfig("wheel")`) mot
 * orchestrator (`Game1MiniGameOrchestrator`). Spilleren ser et hjul med N
 * "buckets" (f.eks. 50); serveren trekker server-autoritativt hvilken
 * bucket hjulet stopper på og orchestrator utbetaler bucket.amount.
 *
 * Livsyklus (via orchestrator):
 *   1. Fullt Hus vinner → orchestrator kaller `trigger(context)`
 *      → vi leser `configSnapshot` (pre-lest av orchestrator fra
 *      `app_mini_games_config.config_json`) og builder `TriggerPayload` med
 *      bucket-preview (uten avsløre vinner-index).
 *   2. Klient viser hjul + "Snurr"-knapp; spilleren trykker "Snurr" →
 *      socket sender `mini_game:choice { spin: true }`.
 *   3. Orchestrator kaller `handleChoice(input)` → vi trekker
 *      server-autoritativt winning bucket via crypto.randomInt (weighted av
 *      bucket.buckets-tellere), returnerer `payoutCents` + `resultJson`
 *      med `{ winningBucketIndex, amount, animationSeed }`.
 *   4. Orchestrator utbetaler via walletAdapter.credit og UPDATE-er
 *      `app_game1_mini_game_results` med våre result_json + payout_cents.
 *
 * Regulatoriske krav:
 *   - Server-autoritativ RNG: `crypto.randomInt` (kryptografisk sikker,
 *     matcher `Game1DrawEngineService` draw-rng-pattern).
 *   - Ingen klient-avgjøring: selv om klient sender `spin: true` gjør
 *     serveren ekte tilfeldig-trekning basert på configSnapshot (anti-juks).
 *   - Fail-closed: invalid config → DomainError, orchestrator fanger og
 *     lager audit-event `game1_minigame.trigger_failed` eller kaster
 *     INVALID_CHOICE hvis choice-fase feiler.
 *   - Payout via orchestrator.creditPayout → walletAdapter.credit med
 *     `to: "winnings"` (PR-W1 wallet-split). Idempotency-key er
 *     `g1-minigame-${resultId}` (satt av orchestrator).
 *   - Audit-event `mini_game.spin_resolved` fires by orchestrator via
 *     eksisterende `game1_minigame.completed`-event (detaljer inkluderer
 *     `winningBucketIndex`).
 *
 * Default-config (pre-pilot legacy-paritet):
 *   `[{ amount: 4000, buckets: 2 },
 *     { amount: 3000, buckets: 4 },
 *     { amount: 2000, buckets: 8 },
 *     { amount: 1000, buckets: 32 },
 *     { amount:  500, buckets: 4 }]`
 *   → 50 buckets totalt. Weighted trekning: bucket-index trekkes uniformt
 *     i [0, 50); weights bestemmer prize.
 *
 * Tester: `MiniGameWheelEngine.test.ts`.
 */

import { randomInt } from "node:crypto";
import { DomainError } from "../../errors/DomainError.js";
import type {
  MiniGame,
  MiniGameChoiceInput,
  MiniGameResult,
  MiniGameTriggerContext,
  MiniGameTriggerPayload,
} from "./types.js";

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Én gruppe med buckets som deler samme premie-beløp. `amount` er i kroner
 * (major units) for konsistens med legacy-config (legacy bruker kroner i
 * `MINIGAME_PRIZES`). Vi konverterer til øre (cents) før payout.
 *
 * `buckets` er hvor mange segmenter på hjulet som har denne premien
 * (f.eks. 32 buckets à kr 1000). Totalen av alle `buckets` = hjulets
 * segmenter (50 i legacy).
 */
export interface WheelPrize {
  readonly amount: number;
  readonly buckets: number;
}

/**
 * Full wheel-config, slik admin lagrer i `app_mini_games_config.config_json`.
 * `spinCount` er reservert for fremtidige multi-spin-spill (bonus-runder);
 * M2 støtter kun `spinCount: 1`.
 */
export interface WheelConfig {
  readonly prizes: readonly WheelPrize[];
  readonly spinCount?: number;
}

/** Default-config brukes når admin ikke har konfigurert wheel. */
export const DEFAULT_WHEEL_CONFIG: WheelConfig = {
  prizes: [
    { amount: 4000, buckets: 2 },
    { amount: 3000, buckets: 4 },
    { amount: 2000, buckets: 8 },
    { amount: 1000, buckets: 32 },
    { amount: 500, buckets: 4 },
  ],
  spinCount: 1,
};

/**
 * Resultat-payload lagret i `app_game1_mini_game_results.result_json`.
 * Klient bruker `winningBucketIndex` + `animationSeed` for deterministisk
 * hjul-animasjon (samme seed → samme roterings-path).
 */
export interface WheelResultJson extends Record<string, unknown> {
  readonly winningBucketIndex: number;
  readonly prizeGroupIndex: number;
  readonly amountKroner: number;
  readonly totalBuckets: number;
  readonly animationSeed: number;
}

// ── RNG port (test-injection) ────────────────────────────────────────────────

/**
 * Cryptographically secure RNG port. Default bruker `crypto.randomInt`;
 * tester injiserer determistisk versjon for reproducerbar fordelings-
 * sjekk. Både prod og test må holde seg server-side.
 */
export interface WheelRng {
  /** Returnerer et heltall i [0, max). */
  readonly nextInt: (max: number) => number;
}

const cryptoRng: WheelRng = {
  nextInt: (max: number) => randomInt(0, max),
};

// ── Config parsing / validation ──────────────────────────────────────────────

/**
 * Parser og validerer et `configSnapshot`-objekt fra orchestrator. Faller
 * tilbake til `DEFAULT_WHEEL_CONFIG` hvis feltet mangler eller er malformed
 * (fail-closed mot client, men ikke mot runtime — vi har alltid en gyldig
 * default så spillet aldri henger).
 *
 * Valideringsregler:
 *   - `prizes` må være array med minst én entry.
 *   - Hver `prize.amount` må være et heltall >= 0.
 *   - Hver `prize.buckets` må være et heltall >= 1.
 *   - `spinCount`, hvis satt, må være 1 (M2-scope).
 *
 * Kaster `DomainError("INVALID_WHEEL_CONFIG", ...)` ved strukturelle feil
 * slik at orchestrator kan logge + audit-loge — men default-fallback er
 * implisitt: tomt configSnapshot = default-config.
 */
export function parseWheelConfig(
  configSnapshot: Readonly<Record<string, unknown>>,
): WheelConfig {
  // Tom config = default. Dekker både {} og { prizes: undefined }.
  if (!configSnapshot || Object.keys(configSnapshot).length === 0) {
    return DEFAULT_WHEEL_CONFIG;
  }

  const rawPrizes = configSnapshot.prizes;
  if (rawPrizes === undefined) {
    // Admin har satt noe annet (f.eks. active=false, men ikke prizes);
    // fall tilbake til default.
    return DEFAULT_WHEEL_CONFIG;
  }
  if (!Array.isArray(rawPrizes)) {
    throw new DomainError(
      "INVALID_WHEEL_CONFIG",
      "prizes må være et array.",
    );
  }
  if (rawPrizes.length === 0) {
    throw new DomainError(
      "INVALID_WHEEL_CONFIG",
      "prizes må ha minst én entry.",
    );
  }

  const prizes: WheelPrize[] = [];
  for (let i = 0; i < rawPrizes.length; i += 1) {
    const entry = rawPrizes[i];
    if (!entry || typeof entry !== "object") {
      throw new DomainError(
        "INVALID_WHEEL_CONFIG",
        `prizes[${i}] må være et objekt.`,
      );
    }
    const e = entry as Record<string, unknown>;
    const amount = e.amount;
    const buckets = e.buckets;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) {
      throw new DomainError(
        "INVALID_WHEEL_CONFIG",
        `prizes[${i}].amount må være et heltall >= 0.`,
      );
    }
    if (typeof buckets !== "number" || !Number.isInteger(buckets) || buckets < 1) {
      throw new DomainError(
        "INVALID_WHEEL_CONFIG",
        `prizes[${i}].buckets må være et heltall >= 1.`,
      );
    }
    prizes.push({ amount, buckets });
  }

  const spinCountRaw = configSnapshot.spinCount;
  let spinCount: number | undefined;
  if (spinCountRaw !== undefined) {
    if (typeof spinCountRaw !== "number" || spinCountRaw !== 1) {
      throw new DomainError(
        "INVALID_WHEEL_CONFIG",
        "spinCount må være 1 (kun 1 spin støttes i M2).",
      );
    }
    spinCount = 1;
  }

  return { prizes, spinCount };
}

/**
 * Summerer total antall buckets på hjulet (f.eks. 50 i default-config).
 * Brukes for weighted trekning: vi trekker en heltalls-index i [0, total)
 * og mapper til prize-gruppen som eier den index.
 */
export function totalBuckets(config: WheelConfig): number {
  let sum = 0;
  for (const p of config.prizes) sum += p.buckets;
  return sum;
}

/**
 * Mapper en bucket-index [0, totalBuckets) til prize-gruppe-index.
 * Eksempel med default (2+4+8+32+4 = 50):
 *   - bucketIndex 0 → gruppe 0 (amount 4000)
 *   - bucketIndex 1 → gruppe 0 (amount 4000)
 *   - bucketIndex 2 → gruppe 1 (amount 3000)
 *   - bucketIndex 45 → gruppe 3 (amount 1000)
 *   - bucketIndex 46 → gruppe 4 (amount 500)
 *
 * Kaster DomainError hvis index er out-of-range (programmerings-feil).
 */
export function bucketIndexToPrizeGroup(
  config: WheelConfig,
  bucketIndex: number,
): { prizeGroupIndex: number; amountKroner: number } {
  if (bucketIndex < 0 || bucketIndex >= totalBuckets(config)) {
    throw new DomainError(
      "INVALID_WHEEL_BUCKET",
      `bucketIndex ${bucketIndex} er out-of-range.`,
    );
  }
  let cursor = 0;
  for (let g = 0; g < config.prizes.length; g += 1) {
    const p = config.prizes[g]!;
    if (bucketIndex < cursor + p.buckets) {
      return { prizeGroupIndex: g, amountKroner: p.amount };
    }
    cursor += p.buckets;
  }
  // Unreachable.
  throw new DomainError(
    "INVALID_WHEEL_BUCKET",
    `bucketIndex ${bucketIndex} falt ikke innenfor noen gruppe.`,
  );
}

// ── MiniGame-implementasjon ──────────────────────────────────────────────────

export interface MiniGameWheelEngineOptions {
  /** RNG for server-autoritativ trekning. Default: crypto.randomInt. */
  readonly rng?: WheelRng;
}

export class MiniGameWheelEngine implements MiniGame {
  readonly type = "wheel" as const;

  private readonly rng: WheelRng;

  constructor(options: MiniGameWheelEngineOptions = {}) {
    this.rng = options.rng ?? cryptoRng;
  }

  /**
   * Trigger — kalt av orchestrator når Fullt Hus er vunnet. Returnerer
   * payload som socket-broadcast videre til klient. Klient får hele
   * bucket-strukturen (for å render hjulet) men IKKE winning-index —
   * det bestemmes i handleChoice.
   *
   * Rent funksjonell: ingen state-mutasjon, ingen IO.
   */
  trigger(context: MiniGameTriggerContext): MiniGameTriggerPayload {
    const config = parseWheelConfig(context.configSnapshot);
    const total = totalBuckets(config);
    return {
      type: "wheel",
      resultId: context.resultId,
      timeoutSeconds: 60,
      payload: {
        totalBuckets: total,
        // Klient får prize-layout slik at hjulet kan rendres med riktige
        // segmenter. Klient kan IKKE regne ut vinner-index — det kommer
        // tilbake i `mini_game:result` etter handleChoice.
        prizes: config.prizes.map((p) => ({
          amount: p.amount,
          buckets: p.buckets,
        })),
        spinCount: config.spinCount ?? 1,
      },
    };
  }

  /**
   * handleChoice — kalt av orchestrator når klient har sendt `spin: true`.
   * Server-autoritativ trekning:
   *   1. Parse config (samme snapshot som ble brukt i trigger).
   *   2. Trekk uniformt tilfeldig bucket-index i [0, totalBuckets).
   *   3. Map bucket-index → prize-gruppe → amount.
   *   4. Returner `payoutCents = amount * 100` + `resultJson` med
   *      winningBucketIndex + animationSeed.
   *
   * `choiceJson` er ignorert (spilleren bestemmer ikke utfallet). Vi
   * aksepterer både `{}` og `{ spin: true }`. Hvis klient sender noe
   * uventet — kaster vi ikke, bare ignorerer (server-autoritativt).
   */
  async handleChoice(input: MiniGameChoiceInput): Promise<MiniGameResult> {
    const config = parseWheelConfig(input.context.configSnapshot);
    const total = totalBuckets(config);
    if (total < 1) {
      throw new DomainError(
        "INVALID_WHEEL_CONFIG",
        "Wheel-config har 0 totale buckets.",
      );
    }

    const winningBucketIndex = this.rng.nextInt(total);
    const { prizeGroupIndex, amountKroner } = bucketIndexToPrizeGroup(
      config,
      winningBucketIndex,
    );

    // AnimationSeed er et separat tilfeldig tall som klient bruker for å
    // variere roteringens akselerasjonskurve uten at det påvirker utfall.
    // Gjenbruker nextInt for å slippe to RNG-injections i tester.
    const animationSeed = this.rng.nextInt(1_000_000);

    const resultJson: WheelResultJson = {
      winningBucketIndex,
      prizeGroupIndex,
      amountKroner,
      totalBuckets: total,
      animationSeed,
    };

    // Kroner → øre for wallet.credit.
    const payoutCents = amountKroner * 100;

    return {
      payoutCents,
      resultJson,
    };
  }
}
