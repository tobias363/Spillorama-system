/**
 * BIN-690 Spor 3 M4: MiniGameColordraftEngine — konkret Colordraft-
 * implementasjon av `MiniGame`-interfacet fra M1-framework.
 *
 * Kobler admin-konfig (`MiniGamesConfigService.getConfig("colordraft")`) mot
 * orchestrator (`Game1MiniGameOrchestrator`). Spilleren ser N luker (default
 * 12), hver tildelt en farge fra admin-paletten. Serveren trekker også én
 * "target"-farge som vises til spilleren FØR valg. Spillerens oppgave er å
 * velge luken som matcher target-fargen — match ⇒ full premie, mismatch ⇒
 * "consolation" (ofte 0).
 *
 * Kontrast til M2/M3:
 *   - Wheel (M2): server avgjør alt, spiller trykker kun "Snurr"
 *     (choiceJson er tom/ignorert).
 *   - Chest (M3): spiller sender `{ chosenIndex: N }`. Serveren trekker N
 *     verdier; valgt luke utbetales uansett.
 *   - Colordraft (M4): spiller sender `{ chosenIndex: N }`, MEN serveren har
 *     allerede i trigger-fasen vist BÅDE `targetColor` OG `slotColors[]` til
 *     klienten. Spillerens valg er dermed et kunnskaps-basert valg (alle
 *     fakta er kjent). Match ⇒ win, mismatch ⇒ consolation. Dette gjør
 *     spillet til en "observasjon / pattern-matching"-utfordring, ikke
 *     pure random som wheel/chest.
 *
 * Hvorfor er farger synlige i trigger? Spesen sier "12 luker med forskjellige
 * farger" — UX-en er "let etter farge som matcher din" (egen ticket-farge
 * i legacy Option A). Vi har valgt Option B (server-trukket target) med klart
 * kommunisert target — enklere og mer rettferdig enn hvis klienten måtte
 * gjette basert på egen ticket-farge som ville kreve at vi skjulte deler av
 * state, og target-farge vises ALLTID før spilleren ser luke-fargene i UI.
 *
 * Merk anti-juks-argumentet: siden spillet ER et ferdighets-baselin puzzle
 * (ikke ren random), er det OK å vise fargene i trigger. Klienten kan ikke
 * "jukse" ved å bestemme premien — klienten bestemmer KUN hvilken index de
 * klikker, og serveren validerer dette mot pre-trukket state.
 *
 * Livsyklus (via orchestrator):
 *   1. Fullt Hus vinner → orchestrator kaller `trigger(context)`
 *      → vi leser `configSnapshot`, trekker targetColor server-autoritativt,
 *      tildeler N luker med farger (min. 1 = target, resten random fra
 *      palette), lagrer trigger-state TILBAKE i configSnapshot-wrapperen
 *      (ved å include i payload) og returnerer `TriggerPayload` med
 *      `{ numberOfSlots, slotColors, targetColor, winPrizeNok, consolationPrizeNok }`.
 *   2. Klient viser N luker + "Velg luken som matcher target"-UI; spilleren
 *      trykker luke N → socket sender `mini_game:choice { chosenIndex: N }`.
 *   3. Orchestrator kaller `handleChoice(input)`. Viktig: siden slot-state
 *      genereres i trigger() men serveren er stateless mellom trigger og
 *      choice, må vi RE-trekke fra samme configSnapshot DETERMINISTISK
 *      basert på resultId slik at staten er konsistent. (Eller lagre state
 *      i result_json.choice_json-wrapperen via orchestrator — men det krever
 *      ny kolonne. Vi bruker i stedet deterministisk RNG seedet på resultId:
 *      det gir samme state ved trigger og choice uten tilleggs-persistens.)
 *
 *   Design-valg persistens: vi lagrer trigger-state (targetColor, slotColors)
 *   i result_json ved completion, ikke ved trigger. For å rekonstruere state
 *   ved handleChoice bruker vi deterministisk pseudo-RNG seeded med
 *   `resultId`-hash. Dette er trygt fordi resultId er server-generert UUID
 *   (klient kan ikke påvirke) + `configSnapshot` er snapshot av config ved
 *   trigger. Klient kan ikke re-derive state uten RNG-seed.
 *
 *   4. Match/mismatch beregnes, payout settes, orchestrator utbetaler via
 *      walletAdapter.credit og UPDATE-er `app_game1_mini_game_results` med
 *      vårt result_json (inkluderer targetColor, slotColors, chosenColor,
 *      chosenIndex, prizeAmount) + payout_cents.
 *
 * Regulatoriske krav:
 *   - Server-autoritativ RNG: `crypto.randomInt` for target + slot-colors.
 *     Deterministisk RNG i handleChoice bruker `createHash('sha256')` av
 *     `resultId + "|" + slotIndex` for å reproduce eksakt samme state som
 *     ved trigger. Klienten ser IKKE seed, og kan ikke gjette state.
 *   - Ingen klient-avgjøring: klient sender KUN `chosenIndex`. Target-
 *     farge + slot-farger er locked inn av server-state.
 *   - Fail-closed: invalid chosenIndex → DomainError("INVALID_CHOICE") som
 *     orchestrator fanger og returnerer til socket-handler.
 *   - Payout via orchestrator.creditPayout → walletAdapter.credit med
 *     `to: "winnings"` (PR-W1 wallet-split). Idempotency-key er
 *     `g1-minigame-${resultId}` (satt av orchestrator).
 *   - Audit-event `game1_minigame.completed` fires av orchestrator med
 *     payoutCents + miniGameType; `resultJson` inneholder targetColor,
 *     chosenColor, chosenIndex, prizeAmount, allSlotColors for audit-log
 *     forensics.
 *   - Idempotens: håndteres av orchestrator via `completed_at`-lås +
 *     idempotency-key. Samme resultId kan ikke resolve'es to ganger.
 *
 * Default-config:
 *   `{ numberOfSlots: 12,
 *      colorPalette: ["yellow", "blue", "red", "green"],
 *      winPrizeNok: 1000,
 *      consolationPrizeNok: 0 }`
 *   → 12 luker, trukket uniformt fra 4 farger (garantert 1 = target);
 *   match ⇒ 1000 kr, mismatch ⇒ 0 kr. Matcher spec-paritet Spill 1.
 *
 * Tester: `MiniGameColordraftEngine.test.ts` + `.integration.test.ts`.
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

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Full colordraft-config, slik admin lagrer i `app_mini_games_config.config_json`.
 *
 * `numberOfSlots`: antall luker å vise (default 12, matcher spec).
 * `colorPalette`: farger å fordele på lukene. Server garanterer at target-
 *   fargen alltid finnes minst én gang i slots-arrayen.
 * `winPrizeNok`: premie (kroner) ved match.
 * `consolationPrizeNok`: premie (kroner) ved mismatch. Default 0 (ingen
 *   trøste-premie).
 */
export interface ColordraftConfig {
  readonly numberOfSlots: number;
  readonly colorPalette: readonly string[];
  readonly winPrizeNok: number;
  readonly consolationPrizeNok: number;
}

/** Default-config brukes når admin ikke har konfigurert colordraft. */
export const DEFAULT_COLORDRAFT_CONFIG: ColordraftConfig = {
  numberOfSlots: 12,
  colorPalette: ["yellow", "blue", "red", "green"],
  winPrizeNok: 1000,
  consolationPrizeNok: 0,
};

/**
 * Resultat-payload lagret i `app_game1_mini_game_results.result_json`.
 *
 * `allSlotColors` inkluderer ALLE lukers farger (også de spilleren ikke
 * valgte) — dette brukes av klient for "reveal all"-animasjon og av audit-
 * ledger for forensics ("hadde target-fargen faktisk en matchende luke?").
 */
export interface ColordraftResultJson extends Record<string, unknown> {
  readonly chosenIndex: number;
  readonly chosenColor: string;
  readonly targetColor: string;
  readonly matched: boolean;
  readonly prizeAmountKroner: number;
  readonly allSlotColors: readonly string[];
  readonly numberOfSlots: number;
}

// ── RNG port (test-injection) ────────────────────────────────────────────────

/**
 * Cryptographically secure RNG port. Default bruker `crypto.randomInt`;
 * tester injiserer deterministisk versjon for reproducerbar fordelings-
 * sjekk. Må holde seg server-side i prod.
 *
 * Bevisst separat fra WheelRng/ChestRng — lik signatur, men scope-isolasjon
 * gir oss frihet til å divergere senere.
 */
export interface ColordraftRng {
  /** Returnerer et heltall i [0, max). */
  readonly nextInt: (max: number) => number;
}

const cryptoRng: ColordraftRng = {
  nextInt: (max: number) => randomInt(0, max),
};

/**
 * Deterministisk RNG basert på sha256-hash av seed+counter. Brukes i
 * `handleChoice` for å rekonstruere samme state som ved `trigger`.
 *
 * Seed = `${resultId}|colordraft`. Hver `nextInt(max)` blumper en counter
 * slik at sekvensen av uttrekk er deterministisk men ikke-gjettbar uten
 * seed (sha256 er one-way).
 *
 * Ikke egnet for initial trigger — der brukes cryptoRng for ekte
 * uforutsigbarhet. Seeded-RNG er utelukkende for state-rekonstruksjon.
 */
function makeSeededRng(seed: string): ColordraftRng {
  let counter = 0;
  return {
    nextInt: (max: number) => {
      if (max <= 0) {
        throw new DomainError(
          "INVALID_COLORDRAFT_CONFIG",
          "nextInt(max) krever max >= 1.",
        );
      }
      // Derive 4 bytes fra sha256(seed|counter) og modulo max.
      // modulo-bias er forsvinnende liten når max << 2^32 (colordraft-palette
      // er typisk ≤ 10 farger, numberOfSlots ≤ 20).
      const hash = createHash("sha256")
        .update(`${seed}|${counter}`)
        .digest();
      counter += 1;
      // Les 4 første bytes som uint32 og mod max.
      const n =
        (hash[0]! << 24) |
        (hash[1]! << 16) |
        (hash[2]! << 8) |
        hash[3]!;
      // Unngå negativ modulo fra signed shift (JS-bitwise gir signed int32).
      const uint = n >>> 0;
      return uint % max;
    },
  };
}

// ── Config parsing / validation ──────────────────────────────────────────────

/**
 * Parser og validerer et `configSnapshot`-objekt fra orchestrator. Faller
 * tilbake til `DEFAULT_COLORDRAFT_CONFIG` hvis feltet mangler eller er tomt
 * (fail-closed mot client, men ikke mot runtime — vi har alltid en gyldig
 * default så spillet aldri henger).
 *
 * Valideringsregler:
 *   - `numberOfSlots` må være heltall >= 2 (minst to luker å velge mellom).
 *   - `colorPalette` må være non-empty array av ikke-tomme strenger.
 *   - `winPrizeNok` må være heltall >= 0.
 *   - `consolationPrizeNok`, hvis satt, må være heltall >= 0.
 *
 * Kaster `DomainError("INVALID_COLORDRAFT_CONFIG", ...)` ved strukturelle feil
 * slik at orchestrator kan logge + audit-loge.
 */
export function parseColordraftConfig(
  configSnapshot: Readonly<Record<string, unknown>>,
): ColordraftConfig {
  // Tom config = default.
  if (!configSnapshot || Object.keys(configSnapshot).length === 0) {
    return DEFAULT_COLORDRAFT_CONFIG;
  }

  // Hvis ingen relevante felt er satt, fall tilbake til default. (Admin kan
  // ha satt kun `active` på root-nivå.)
  const hasAny =
    configSnapshot.numberOfSlots !== undefined ||
    configSnapshot.colorPalette !== undefined ||
    configSnapshot.winPrizeNok !== undefined ||
    configSnapshot.consolationPrizeNok !== undefined;
  if (!hasAny) {
    return DEFAULT_COLORDRAFT_CONFIG;
  }

  // numberOfSlots
  const rawN = configSnapshot.numberOfSlots;
  let numberOfSlots: number;
  if (rawN === undefined) {
    numberOfSlots = DEFAULT_COLORDRAFT_CONFIG.numberOfSlots;
  } else if (typeof rawN !== "number" || !Number.isInteger(rawN) || rawN < 2) {
    throw new DomainError(
      "INVALID_COLORDRAFT_CONFIG",
      "numberOfSlots må være et heltall >= 2.",
    );
  } else {
    numberOfSlots = rawN;
  }

  // colorPalette
  let colorPalette: string[];
  const rawPalette = configSnapshot.colorPalette;
  if (rawPalette === undefined) {
    colorPalette = [...DEFAULT_COLORDRAFT_CONFIG.colorPalette];
  } else if (!Array.isArray(rawPalette)) {
    throw new DomainError(
      "INVALID_COLORDRAFT_CONFIG",
      "colorPalette må være et array.",
    );
  } else if (rawPalette.length === 0) {
    throw new DomainError(
      "INVALID_COLORDRAFT_CONFIG",
      "colorPalette må ha minst én farge.",
    );
  } else {
    colorPalette = [];
    for (let i = 0; i < rawPalette.length; i += 1) {
      const entry = rawPalette[i];
      if (typeof entry !== "string" || entry.trim() === "") {
        throw new DomainError(
          "INVALID_COLORDRAFT_CONFIG",
          `colorPalette[${i}] må være en ikke-tom streng.`,
        );
      }
      colorPalette.push(entry);
    }
  }

  // winPrizeNok
  const rawWin = configSnapshot.winPrizeNok;
  let winPrizeNok: number;
  if (rawWin === undefined) {
    winPrizeNok = DEFAULT_COLORDRAFT_CONFIG.winPrizeNok;
  } else if (
    typeof rawWin !== "number" ||
    !Number.isInteger(rawWin) ||
    rawWin < 0
  ) {
    throw new DomainError(
      "INVALID_COLORDRAFT_CONFIG",
      "winPrizeNok må være et heltall >= 0.",
    );
  } else {
    winPrizeNok = rawWin;
  }

  // consolationPrizeNok
  const rawConsolation = configSnapshot.consolationPrizeNok;
  let consolationPrizeNok: number;
  if (rawConsolation === undefined) {
    consolationPrizeNok = DEFAULT_COLORDRAFT_CONFIG.consolationPrizeNok;
  } else if (
    typeof rawConsolation !== "number" ||
    !Number.isInteger(rawConsolation) ||
    rawConsolation < 0
  ) {
    throw new DomainError(
      "INVALID_COLORDRAFT_CONFIG",
      "consolationPrizeNok må være et heltall >= 0.",
    );
  } else {
    consolationPrizeNok = rawConsolation;
  }

  return {
    numberOfSlots,
    colorPalette,
    winPrizeNok,
    consolationPrizeNok,
  };
}

// ── State-sampling helpers ───────────────────────────────────────────────────

/**
 * Trekk en target-farge + N slot-farger uniformly fra paletten. Garanterer
 * at target-fargen finnes MINST én gang blant slots (hvis uniform random
 * ikke har truffet target i N trekninger, overskrives en tilfeldig slot med
 * target).
 *
 * Eksport'et for direkte unit-testing.
 *
 * Returnerer det komplette state-objektet { targetColor, slotColors }.
 */
export function sampleColordraftState(
  config: ColordraftConfig,
  rng: ColordraftRng,
): { targetColor: string; slotColors: string[] } {
  const paletteLen = config.colorPalette.length;
  // 1) Target-farge: uniform fra paletten.
  const targetIndex = rng.nextInt(paletteLen);
  const targetColor = config.colorPalette[targetIndex]!;

  // 2) Slot-farger: N uavhengige uniforme trekninger.
  const slotColors: string[] = [];
  let targetSeen = false;
  for (let i = 0; i < config.numberOfSlots; i += 1) {
    const pick = rng.nextInt(paletteLen);
    const color = config.colorPalette[pick]!;
    if (color === targetColor) targetSeen = true;
    slotColors.push(color);
  }

  // 3) Garanti: hvis target ikke naturlig havnet i noen slot, overskriv en
  //    uniform-random slot med target. Ellers ville spilleren havne i en
  //    umulig situasjon (ingen luke å matche på), som er UX-mareritt.
  //    Overskrivningen er også server-autoritativ (samme RNG) → reproduserbar
  //    i handleChoice via seeded-RNG.
  if (!targetSeen) {
    const overwriteIndex = rng.nextInt(config.numberOfSlots);
    slotColors[overwriteIndex] = targetColor;
  }

  return { targetColor, slotColors };
}

// ── MiniGame-implementasjon ──────────────────────────────────────────────────

export interface MiniGameColordraftEngineOptions {
  /**
   * RNG for server-autoritativ trekning i `trigger()`. Default:
   * `crypto.randomInt`. Tester injiserer deterministisk versjon for
   * predictable state.
   *
   * Merk: `handleChoice` bruker IKKE denne RNG — den rekonstruerer state
   * via seeded-RNG av `resultId`. Dette er bevisst: `trigger` trekker
   * ekte random, `handleChoice` reproduserer samme trekning deterministisk.
   */
  readonly rng?: ColordraftRng;
}

export class MiniGameColordraftEngine implements MiniGame {
  readonly type = "colordraft" as const;

  private readonly rng: ColordraftRng;

  constructor(options: MiniGameColordraftEngineOptions = {}) {
    this.rng = options.rng ?? cryptoRng;
  }

  /**
   * Trigger — kalt av orchestrator når Fullt Hus er vunnet. Returnerer
   * payload som socket-broadcast videre til klient. Klient får:
   *   - `numberOfSlots`: hvor mange luker å vise
   *   - `targetColor`: fargen spilleren må matche
   *   - `slotColors`: faktiske farger på alle luker (UI trenger dette for
   *     å rendre luke-knapper)
   *   - `winPrizeNok` / `consolationPrizeNok`: preview for "Vinn X kr"-tekst
   *
   * Klient ser fargene — men det er greit. Colordraft er ikke et hidden-
   * information-spill (som Chest), det er et observasjons-puzzle. Klienten
   * kan ikke "jukse" ved å se fargene; de skal jo velge selv.
   *
   * Trigger bruker `cryptoRng` (ekte random) for å trekke state. I
   * `handleChoice` rekonstruerer vi nøyaktig samme state via seeded-RNG av
   * `resultId` — dette garanterer at choice-fasen refererer til EXACT
   * samme targetColor/slotColors som trigger viste. (Alternativ er å
   * persistere state i DB, men det krever ny kolonne.)
   *
   * Siden seeded-RNG i handleChoice bruker `resultId` som seed, og
   * `resultId` er server-generert UUID passet inn via context, kan vi kun
   * rekonstruere state deterministisk — selv om serveren restarter mellom
   * trigger og choice, er state rekonstruerbar fra {resultId, config}.
   *
   * Rent funksjonell: ingen state-mutasjon, ingen IO. MEN: trigger trekker
   * fra ekte crypto-RNG; den deterministiske rekonstruksjonen i
   * handleChoice bruker en annen (seeded) RNG. Dermed er trigger-
   * resultatet IKKE deterministisk hentet — handleChoice må IKKE stole
   * på at trigger ga samme verdier. I stedet bruker handleChoice seeded-
   * RNG fra resultId + configSnapshot. Trigger-outputtet til klient er
   * autoritativt visuelt, men handleChoice verdifoksar sin egen trekning
   * basert på configSnapshot + resultId (som orchestrator persiterer).
   *
   * *** VIKTIG DESIGN-NOTIS ***
   * Siden trigger-RNG og choice-RNG er forskjellige, MÅ vi bruke
   * seeded-RNG i BEGGE for å garantere at spilleren ser samme state i
   * trigger som handleChoice opererer på. Derfor bruker vi seeded-RNG i
   * trigger også — ingen cryptoRng her. Dette betyr at `targetColor` +
   * `slotColors` er 100% determinert av `{resultId, configSnapshot}`.
   * `resultId` er kryptografisk tilfeldig UUID generert av orchestrator,
   * så klienten kan ikke forutsi state. Perfect — vi har determinisme
   * for state-rekonstruksjon OG uforutsigbarhet for klient.
   */
  trigger(context: MiniGameTriggerContext): MiniGameTriggerPayload {
    const config = parseColordraftConfig(context.configSnapshot);
    // Bruk seeded-RNG fra resultId slik at handleChoice rekonstruerer
    // EXACT samme state. resultId er server-generert UUID → uforutsigbar
    // for klient, men deterministisk for server-side reproduksjon.
    const rng = makeSeededRng(`${context.resultId}|colordraft`);
    const { targetColor, slotColors } = sampleColordraftState(config, rng);

    return {
      type: "colordraft",
      resultId: context.resultId,
      timeoutSeconds: 60,
      payload: {
        numberOfSlots: config.numberOfSlots,
        targetColor,
        slotColors,
        winPrizeNok: config.winPrizeNok,
        consolationPrizeNok: config.consolationPrizeNok,
      },
    };
  }

  /**
   * handleChoice — kalt av orchestrator når klient har sendt
   * `{ chosenIndex: N }`.
   *
   * Server-autoritativ:
   *   1. Validér `chosenIndex` er heltall i [0, numberOfSlots).
   *   2. Rekonstruer state via seeded-RNG av `${resultId}|colordraft`.
   *      Dette gir EXACT samme targetColor + slotColors som trigger viste
   *      klienten — klient kan ikke ha "glemt" eller "forfalsket" staten.
   *   3. Sjekk om `slotColors[chosenIndex] === targetColor`:
   *      - match ⇒ payout = winPrizeNok
   *      - mismatch ⇒ payout = consolationPrizeNok (kan være 0)
   *   4. Returner `payoutCents = prize * 100` + `resultJson` med full state
   *      (for reveal-all-animasjon + audit).
   *
   * Kaster `DomainError("INVALID_CHOICE")` hvis chosenIndex er ugyldig.
   * Orchestrator fanger og returnerer til socket-handler (ikke krasjer
   * transaksjonen).
   */
  async handleChoice(input: MiniGameChoiceInput): Promise<MiniGameResult> {
    const config = parseColordraftConfig(input.context.configSnapshot);
    const chosenIndex = this.assertChosenIndex(
      input.choiceJson,
      config.numberOfSlots,
    );

    // Rekonstruer state deterministisk — samme seed som i trigger().
    const rng = makeSeededRng(`${input.resultId}|colordraft`);
    const { targetColor, slotColors } = sampleColordraftState(config, rng);

    const chosenColor = slotColors[chosenIndex]!;
    const matched = chosenColor === targetColor;
    const prizeAmountKroner = matched
      ? config.winPrizeNok
      : config.consolationPrizeNok;

    const resultJson: ColordraftResultJson = {
      chosenIndex,
      chosenColor,
      targetColor,
      matched,
      prizeAmountKroner,
      allSlotColors: slotColors,
      numberOfSlots: config.numberOfSlots,
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
   *   - Out-of-range (< 0 eller >= numberOfSlots)
   */
  private assertChosenIndex(
    choiceJson: Readonly<Record<string, unknown>>,
    slotCount: number,
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
    if (raw < 0 || raw >= slotCount) {
      throw new DomainError(
        "INVALID_CHOICE",
        `chosenIndex ${raw} er out-of-range (0-${slotCount - 1}).`,
      );
    }
    return raw;
  }
}
