/**
 * BIN-690 Spor 3 M3: MiniGameChestEngine — konkret Chest-implementasjon av
 * `MiniGame`-interfacet fra M1-framework.
 *
 * Kobler admin-konfig (`MiniGamesConfigService.getConfig("chest")`) mot
 * orchestrator (`Game1MiniGameOrchestrator`). Spilleren ser N luker (f.eks.
 * 6); velger én, og serveren trekker alle N verdiene server-autoritativt
 * (i [minNok, maxNok] — uniform range, eller weighted via `discreteTiers`).
 * Verdien til den valgte luken utbetales.
 *
 * Forskjell fra M2 Wheel:
 *   - Wheel: server avgjør alt, spiller trykker kun "Snurr" (choiceJson er
 *     tom/ignorert).
 *   - Chest: spiller sender `{ chosenIndex: N }` i choiceJson. Serveren
 *     trekker alle N verdiene og returnerer `winningIndex = chosenIndex`
 *     + hele verdi-matrisen (slik at klient kan animere "reveal all").
 *
 * Livsyklus (via orchestrator):
 *   1. Fullt Hus vinner → orchestrator kaller `trigger(context)`
 *      → vi leser `configSnapshot`, builder `TriggerPayload` med
 *      `chestCount` + `prizeRange` (preview — uten å avsløre faktiske
 *      verdier, for å hindre klient-juks).
 *   2. Klient viser N luker + "Velg luke"-UI; spilleren trykker luke N →
 *      socket sender `mini_game:choice { chosenIndex: N }`.
 *   3. Orchestrator kaller `handleChoice(input)` → vi trekker server-
 *      autoritativt N verdier via `crypto.randomInt`, picker value[chosenIndex],
 *      returnerer `payoutCents` + `resultJson` med `{ chosenIndex, prizeAmount,
 *      allValues, chestCount }`.
 *   4. Orchestrator utbetaler via walletAdapter.credit og UPDATE-er
 *      `app_game1_mini_game_results` med våre result_json + payout_cents.
 *
 * Regulatoriske krav:
 *   - Server-autoritativ RNG: `crypto.randomInt` (kryptografisk sikker,
 *     matcher `Game1DrawEngineService` + M2 WheelEngine-mønster).
 *   - Ingen klient-avgjøring: klient sender KUN `chosenIndex`. Selve
 *     verdiene genereres server-side, så selv om klient sender "chest 0"
 *     kan klienten ikke påvirke hva det faktisk ligger i chest 0.
 *   - Fail-closed: invalid chosenIndex → DomainError("INVALID_CHOICE")
 *     som orchestrator fanger og returnerer til socket-handler.
 *   - Payout via orchestrator.creditPayout → walletAdapter.credit med
 *     `to: "winnings"` (PR-W1 wallet-split). Idempotency-key er
 *     `g1-minigame-${resultId}` (satt av orchestrator).
 *   - Audit-event `game1_minigame.completed` fires av orchestrator med
 *     payoutCents + miniGameType; `resultJson` inneholder chosenIndex +
 *     allValues for audit-log forensics.
 *   - Idempotens: håndteres av orchestrator via `completed_at`-lås +
 *     idempotency-key. Samme resultId kan ikke resolve'es to ganger.
 *
 * Default-config:
 *   `{ numberOfChests: 6, prizeRange: { minNok: 400, maxNok: 4000 } }`
 *   → 6 luker, hver tilfeldig uniform i [400, 4000] kr. Matcher spec-
 *     linje 119-121 i SPILL1_FULL_VARIANT_CATALOG_2026-04-21.md
 *     (400-4000 kr per luke).
 *
 * Valgfri discrete-tiers:
 *   Hvis `discreteTiers: [{ amount, weight }]` er satt, brukes weighted
 *   sampling i stedet for uniform range. Nyttig hvis admin vil begrense
 *   til f.eks. kun 500/1000/2000/4000 kr med forskjellige vekter.
 *
 * Tester: `MiniGameChestEngine.test.ts` + `.integration.test.ts`.
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
 * Uniformt prize-range for chest. `minNok` / `maxNok` er inklusive i kroner.
 * F.eks. `{ minNok: 400, maxNok: 4000 }` gir heltall uniform tilfeldig mellom
 * 400 og 4000 kroner per luke.
 */
export interface ChestPrizeRange {
  readonly minNok: number;
  readonly maxNok: number;
}

/**
 * Valgfri discrete-tier for weighted sampling per luke. `weight` må være
 * positiv (heltall); trekning gjøres weighted via RNG.
 *
 * Hvis `discreteTiers` er satt i config, brukes den i stedet for
 * `prizeRange` (og omvendt). De to er gjensidig utelukkende.
 */
export interface ChestDiscreteTier {
  readonly amount: number;
  readonly weight: number;
}

/**
 * Full chest-config, slik admin lagrer i `app_mini_games_config.config_json`.
 * `numberOfChests` er antall luker. `prizeRange` er default uniform range;
 * `discreteTiers` overstyrer til weighted-sampling.
 */
export interface ChestConfig {
  readonly numberOfChests: number;
  readonly prizeRange: ChestPrizeRange;
  readonly discreteTiers?: readonly ChestDiscreteTier[];
}

/** Default-config brukes når admin ikke har konfigurert chest. */
export const DEFAULT_CHEST_CONFIG: ChestConfig = {
  numberOfChests: 6,
  prizeRange: { minNok: 400, maxNok: 4000 },
};

/**
 * Resultat-payload lagret i `app_game1_mini_game_results.result_json`.
 *
 * `allValues` inkluderer ALLE lukers verdier (også de spilleren ikke
 * valgte) — dette brukes av klient for "reveal all"-animasjon og av audit-
 * ledger for forensics ("var spillet rigget?").
 */
export interface ChestResultJson extends Record<string, unknown> {
  readonly chosenIndex: number;
  readonly prizeAmountKroner: number;
  readonly allValuesKroner: readonly number[];
  readonly chestCount: number;
}

// ── RNG port (test-injection) ────────────────────────────────────────────────

/**
 * Cryptographically secure RNG port. Default bruker `crypto.randomInt`;
 * tester injiserer deterministisk versjon for reproducerbar fordelings-
 * sjekk. Må holde seg server-side i prod.
 *
 * Bevisst separat fra WheelRng (M2) — lik signatur, men scope-isolasjon
 * gir oss frihet til å divergere senere (f.eks. hvis chest skal bruke
 * `randomBytes` for store verdier mens wheel ikke trenger det).
 */
export interface ChestRng {
  /** Returnerer et heltall i [0, max). */
  readonly nextInt: (max: number) => number;
}

const cryptoRng: ChestRng = {
  nextInt: (max: number) => randomInt(0, max),
};

// ── Config parsing / validation ──────────────────────────────────────────────

/**
 * Parser og validerer et `configSnapshot`-objekt fra orchestrator. Faller
 * tilbake til `DEFAULT_CHEST_CONFIG` hvis feltet mangler eller er tomt
 * (fail-closed mot client, men ikke mot runtime — vi har alltid en gyldig
 * default så spillet aldri henger).
 *
 * Valideringsregler:
 *   - `numberOfChests` må være heltall >= 2 (minst to luker å velge mellom).
 *   - `prizeRange.minNok` / `maxNok` må være heltall >= 0.
 *   - `prizeRange.minNok <= maxNok`.
 *   - `discreteTiers`, hvis satt, må være non-empty array av
 *     `{ amount >= 0, weight >= 1 }`. Overstyrer prizeRange for sampling.
 *
 * Kaster `DomainError("INVALID_CHEST_CONFIG", ...)` ved strukturelle feil
 * slik at orchestrator kan logge + audit-loge.
 */
export function parseChestConfig(
  configSnapshot: Readonly<Record<string, unknown>>,
): ChestConfig {
  // Tom config = default.
  if (!configSnapshot || Object.keys(configSnapshot).length === 0) {
    return DEFAULT_CHEST_CONFIG;
  }

  // Hvis verken numberOfChests eller prizeRange er satt, fall tilbake til
  // default. (Admin kan ha satt kun `active` på root-nivå.)
  const hasAny =
    configSnapshot.numberOfChests !== undefined ||
    configSnapshot.prizeRange !== undefined ||
    configSnapshot.discreteTiers !== undefined;
  if (!hasAny) {
    return DEFAULT_CHEST_CONFIG;
  }

  // numberOfChests
  const rawN = configSnapshot.numberOfChests;
  let numberOfChests: number;
  if (rawN === undefined) {
    numberOfChests = DEFAULT_CHEST_CONFIG.numberOfChests;
  } else if (typeof rawN !== "number" || !Number.isInteger(rawN) || rawN < 2) {
    throw new DomainError(
      "INVALID_CHEST_CONFIG",
      "numberOfChests må være et heltall >= 2.",
    );
  } else {
    numberOfChests = rawN;
  }

  // prizeRange
  let prizeRange: ChestPrizeRange;
  const rawRange = configSnapshot.prizeRange;
  if (rawRange === undefined) {
    prizeRange = DEFAULT_CHEST_CONFIG.prizeRange;
  } else if (!rawRange || typeof rawRange !== "object" || Array.isArray(rawRange)) {
    throw new DomainError(
      "INVALID_CHEST_CONFIG",
      "prizeRange må være et objekt { minNok, maxNok }.",
    );
  } else {
    const r = rawRange as Record<string, unknown>;
    const minNok = r.minNok;
    const maxNok = r.maxNok;
    if (
      typeof minNok !== "number" ||
      !Number.isInteger(minNok) ||
      minNok < 0
    ) {
      throw new DomainError(
        "INVALID_CHEST_CONFIG",
        "prizeRange.minNok må være et heltall >= 0.",
      );
    }
    if (
      typeof maxNok !== "number" ||
      !Number.isInteger(maxNok) ||
      maxNok < 0
    ) {
      throw new DomainError(
        "INVALID_CHEST_CONFIG",
        "prizeRange.maxNok må være et heltall >= 0.",
      );
    }
    if (minNok > maxNok) {
      throw new DomainError(
        "INVALID_CHEST_CONFIG",
        "prizeRange.minNok må være <= prizeRange.maxNok.",
      );
    }
    prizeRange = { minNok, maxNok };
  }

  // discreteTiers (optional)
  const rawTiers = configSnapshot.discreteTiers;
  let discreteTiers: ChestDiscreteTier[] | undefined;
  if (rawTiers !== undefined) {
    if (!Array.isArray(rawTiers)) {
      throw new DomainError(
        "INVALID_CHEST_CONFIG",
        "discreteTiers må være et array.",
      );
    }
    if (rawTiers.length === 0) {
      throw new DomainError(
        "INVALID_CHEST_CONFIG",
        "discreteTiers må ha minst én entry hvis satt.",
      );
    }
    discreteTiers = [];
    for (let i = 0; i < rawTiers.length; i += 1) {
      const entry = rawTiers[i];
      if (!entry || typeof entry !== "object") {
        throw new DomainError(
          "INVALID_CHEST_CONFIG",
          `discreteTiers[${i}] må være et objekt.`,
        );
      }
      const e = entry as Record<string, unknown>;
      const amount = e.amount;
      const weight = e.weight;
      if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) {
        throw new DomainError(
          "INVALID_CHEST_CONFIG",
          `discreteTiers[${i}].amount må være et heltall >= 0.`,
        );
      }
      if (typeof weight !== "number" || !Number.isInteger(weight) || weight < 1) {
        throw new DomainError(
          "INVALID_CHEST_CONFIG",
          `discreteTiers[${i}].weight må være et heltall >= 1.`,
        );
      }
      discreteTiers.push({ amount, weight });
    }
  }

  return discreteTiers
    ? { numberOfChests, prizeRange, discreteTiers }
    : { numberOfChests, prizeRange };
}

// ── Value-sampling helpers ───────────────────────────────────────────────────

/**
 * Trekk én tilfeldig kroneverdi fra config. Uniform i [minNok, maxNok] hvis
 * ingen discreteTiers; weighted over tiers hvis satt.
 *
 * Eksport'et for direkte unit-testing (fordelings-sjekk på 10k runs).
 */
export function sampleChestValue(
  config: ChestConfig,
  rng: ChestRng,
): number {
  if (config.discreteTiers && config.discreteTiers.length > 0) {
    // Weighted sampling over tiers.
    let totalWeight = 0;
    for (const t of config.discreteTiers) totalWeight += t.weight;
    if (totalWeight <= 0) {
      throw new DomainError(
        "INVALID_CHEST_CONFIG",
        "discreteTiers total-weight er 0.",
      );
    }
    const pick = rng.nextInt(totalWeight);
    let cursor = 0;
    for (const t of config.discreteTiers) {
      if (pick < cursor + t.weight) return t.amount;
      cursor += t.weight;
    }
    // Unreachable (pick < totalWeight alltid).
    throw new DomainError(
      "INVALID_CHEST_CONFIG",
      "Kunne ikke bestemme discrete-tier (logikk-feil).",
    );
  }

  // Uniform range i [minNok, maxNok] inkl. begge endepunkter.
  const { minNok, maxNok } = config.prizeRange;
  const span = maxNok - minNok + 1;
  return minNok + rng.nextInt(span);
}

/**
 * Trekk N verdier for alle luker. Sampling er uavhengig per luke.
 * Eksport'et for tests; produksjon kaller via `handleChoice`.
 */
export function sampleChestValues(
  config: ChestConfig,
  rng: ChestRng,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < config.numberOfChests; i += 1) {
    out.push(sampleChestValue(config, rng));
  }
  return out;
}

// ── MiniGame-implementasjon ──────────────────────────────────────────────────

export interface MiniGameChestEngineOptions {
  /** RNG for server-autoritativ trekning. Default: crypto.randomInt. */
  readonly rng?: ChestRng;
}

export class MiniGameChestEngine implements MiniGame {
  readonly type = "chest" as const;

  private readonly rng: ChestRng;

  constructor(options: MiniGameChestEngineOptions = {}) {
    this.rng = options.rng ?? cryptoRng;
  }

  /**
   * Trigger — kalt av orchestrator når Fullt Hus er vunnet. Returnerer
   * payload som socket-broadcast videre til klient. Klient får:
   *   - `chestCount`: hvor mange luker å vise
   *   - `prizeRange`: preview-spenn for UI (f.eks. "Vinn 400-4000 kr")
   *   - `hasDiscreteTiers`: flagg hvis admin bruker discrete-mode (UI kan
   *     vise "Velg blant faste premier" i stedet)
   *
   * Klient får IKKE faktiske verdier — de genereres først i handleChoice
   * (anti-juks: klienten kan ikke vite hva som ligger i hver luke).
   *
   * Rent funksjonell: ingen state-mutasjon, ingen IO.
   */
  trigger(context: MiniGameTriggerContext): MiniGameTriggerPayload {
    const config = parseChestConfig(context.configSnapshot);
    return {
      type: "chest",
      resultId: context.resultId,
      timeoutSeconds: 60,
      payload: {
        chestCount: config.numberOfChests,
        prizeRange: {
          minNok: config.prizeRange.minNok,
          maxNok: config.prizeRange.maxNok,
        },
        hasDiscreteTiers: Boolean(
          config.discreteTiers && config.discreteTiers.length > 0,
        ),
      },
    };
  }

  /**
   * handleChoice — kalt av orchestrator når klient har sendt
   * `{ chosenIndex: N }`.
   *
   * Server-autoritativ:
   *   1. Validér `chosenIndex` er heltall i [0, numberOfChests).
   *   2. Trekk `numberOfChests` verdier via RNG (uniform eller weighted).
   *   3. Picker value[chosenIndex] som premien.
   *   4. Returner `payoutCents = value * 100` + `resultJson` med alle
   *      verdier (for reveal-all-animasjon i klient).
   *
   * Kaster `DomainError("INVALID_CHOICE")` hvis chosenIndex er ugyldig.
   * Orchestrator fanger og returnerer til socket-handler (ikke krasjer
   * transaksjonen).
   */
  async handleChoice(input: MiniGameChoiceInput): Promise<MiniGameResult> {
    const config = parseChestConfig(input.context.configSnapshot);
    const chosenIndex = this.assertChosenIndex(
      input.choiceJson,
      config.numberOfChests,
    );

    // Trekk verdier for alle luker (server-autoritativt).
    const allValuesKroner = sampleChestValues(config, this.rng);
    const prizeAmountKroner = allValuesKroner[chosenIndex]!;

    const resultJson: ChestResultJson = {
      chosenIndex,
      prizeAmountKroner,
      allValuesKroner,
      chestCount: config.numberOfChests,
    };

    // Kroner → øre for wallet.credit.
    const payoutCents = prizeAmountKroner * 100;

    return {
      payoutCents,
      resultJson,
    };
  }

  /**
   * Validér at klient-sendt choiceJson inneholder en gyldig `chosenIndex`.
   *
   * Aksepterer:
   *   - `{ chosenIndex: 0 }` … `{ chosenIndex: N-1 }`
   *
   * Kaster INVALID_CHOICE ved:
   *   - Manglende felt
   *   - Ikke-heltall
   *   - Out-of-range (< 0 eller >= numberOfChests)
   */
  private assertChosenIndex(
    choiceJson: Readonly<Record<string, unknown>>,
    chestCount: number,
  ): number {
    const raw = choiceJson.chosenIndex;
    if (raw === undefined || raw === null) {
      throw new DomainError(
        "INVALID_CHOICE",
        "chosenIndex er påkrevd i choice-payload.",
      );
    }
    if (typeof raw !== "number" || !Number.isInteger(raw)) {
      throw new DomainError(
        "INVALID_CHOICE",
        "chosenIndex må være et heltall.",
      );
    }
    if (raw < 0 || raw >= chestCount) {
      throw new DomainError(
        "INVALID_CHOICE",
        `chosenIndex ${raw} er out-of-range (0-${chestCount - 1}).`,
      );
    }
    return raw;
  }
}
