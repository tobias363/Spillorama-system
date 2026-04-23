/**
 * BIN-690 Spor 3 M1: MiniGame framework — type-kontrakt.
 *
 * Denne filen definerer det felles interfacet alle konkrete mini-games
 * (M2 wheel / M3 chest / M4 colordraft / M5 oddsen) må implementere.
 *
 * Framework-scope (M1):
 *   - Definer `MiniGame`-interface med trigger/handleChoice/result.
 *   - Definer `MiniGameType`-discriminator (stabil streng-identifier per
 *     spill, matcher DB-CHECK i app_game1_mini_game_results.mini_game_type).
 *   - Definer context-type (scheduled_game, winner, draw-sequence-at-win,
 *     config-snapshot) som orchestrator passer inn til implementasjonen.
 *   - Definer `MiniGameResult`-shape som returnerer resultat + payout.
 *
 * M2-M5 vil:
 *   - Hver implementerer `MiniGame`-interface for sin type.
 *   - Registreres i `Game1MiniGameOrchestrator` via konstruktør-injeksjon.
 *   - Har fri-form `result_json` payload men må returnere `payoutCents`
 *     slik at orchestrator kan utbetale via wallet-adapter.
 *
 * Referanser:
 *   - `app_mini_games_config` (BIN-679) — admin-konfig per type.
 *   - `app_game1_mini_game_results` (M1 migrasjon) — runtime-historikk.
 *   - `BingoEngine.activateMiniGame` / `playMiniGame` (legacy-skisse, lever
 *     videre for host-player-room-scoped bruk — IKKE delt med dette framework).
 */

/**
 * Framework-type-discriminator. Matcher CHECK-listen i
 * `app_game1_mini_game_results.mini_game_type`. Utvides sammen med M2-M5.
 *
 * Merk: IKKE samme union som `BingoEngine.MiniGameType` (wheelOfFortune,
 * treasureChest, mysteryGame, colorDraft). Det er legacy-wired in host-
 * player-room-modus; denne union er for scheduled-games framework (M1+).
 */
export type MiniGameType =
  | "wheel"
  | "chest"
  | "colordraft"
  | "oddsen"
  | "mystery";

/** Alle støttede mini-game-typer (for iterasjon + validering). */
export const MINI_GAME_TYPES: readonly MiniGameType[] = [
  "wheel",
  "chest",
  "colordraft",
  "oddsen",
  "mystery",
] as const;

/**
 * Context som orchestrator passer inn når en mini-game trigges etter Fullt Hus.
 * Alle felt er read-only — konkrete implementasjoner skal ikke muterere.
 */
export interface MiniGameTriggerContext {
  /** UUID for mini-game-result-raden (genereres av orchestrator før trigger). */
  readonly resultId: string;
  /** ID på scheduled-game som utløste mini-game (Fullt Hus vunnet her). */
  readonly scheduledGameId: string;
  /** Bruker-ID til Fullt Hus-vinneren. */
  readonly winnerUserId: string;
  /** Wallet-ID til vinneren (for payout-destinasjon). */
  readonly winnerWalletId: string;
  /** Hall-ID vinneren spilte fra (for compliance-ledger). */
  readonly hallId: string;
  /** Draw-sekvens da Fullt Hus ble vunnet (for audit). */
  readonly drawSequenceAtWin: number;
  /**
   * Snapshot av admin-konfig for denne mini-game-typen. Hentet fra
   * app_mini_games_config.config_json på trigger-tidspunkt. Empty-object
   * hvis admin ikke har konfigurert typen ennå (M2-M5 må ha sane defaults).
   */
  readonly configSnapshot: Readonly<Record<string, unknown>>;
}

/**
 * Resultat fra en mini-game. Orchestrator bruker payoutCents for wallet-
 * credit, og lagrer hele resultJson i app_game1_mini_game_results.result_json.
 *
 * payoutCents = 0 er gyldig (spillet kan gi 0 kr premie).
 */
export interface MiniGameResult {
  /** Utbetalt beløp i øre (0 hvis ingen premie). */
  readonly payoutCents: number;
  /** Spill-spesifikt resultat-payload. Persisteres i result_json. */
  readonly resultJson: Readonly<Record<string, unknown>>;
}

/**
 * Input når spilleren gjør sitt valg. `choiceJson` er fri-form; hver
 * implementasjon validerer sitt eget schema og kaster DomainError ved
 * invalid input.
 */
export interface MiniGameChoiceInput {
  readonly resultId: string;
  readonly context: MiniGameTriggerContext;
  readonly choiceJson: Readonly<Record<string, unknown>>;
}

/**
 * MiniGame-interface: alle konkrete mini-games (M2-M5) implementerer dette.
 *
 * Livssyklus:
 *   1. Orchestrator kaller `trigger(context)` → implementasjon returnerer
 *      TriggerPayload (f.eks. "her er 50 segmenter å velge mellom") som
 *      sendes via socket til klient.
 *   2. Klient viser UI og kaller `mini_game:choice` med valg.
 *   3. Orchestrator kaller `handleChoice(input)` → implementasjonen
 *      beregner + returnerer `MiniGameResult` (payout + resultJson).
 *   4. Orchestrator utbetaler payoutCents via wallet-adapter og UPDATE-er
 *      app_game1_mini_game_results med result_json + payout_cents +
 *      completed_at.
 *
 * For wheel-type (ingen valg): `handleChoice` kalles automatisk av
 * orchestrator med tom choiceJson rett etter trigger, siden spilleren bare
 * trykker "spin" uten å velge noe.
 */
export interface MiniGame {
  /** Framework-type (matcher MiniGameType). Brukes for dispatch. */
  readonly type: MiniGameType;

  /**
   * Kalt når mini-game trigges. Returnerer payload som sendes til klient
   * via `mini_game:trigger`-event. Typisk inneholder prize-liste eller
   * antall-luker for at klient kan vise korrekt UI.
   *
   * Implementasjonen skal IKKE mutere noen extern state — alle skriv-ops
   * skjer i orchestrator (for transaksjonssikkerhet).
   */
  trigger(context: MiniGameTriggerContext): MiniGameTriggerPayload;

  /**
   * Kalt når spilleren har gjort sitt valg. Beregner resultat + payout.
   *
   * Implementasjonen er server-autoritativ: selv om klient sender
   * selectedIndex, skal serveren gjøre ekte tilfeldig-trekning basert på
   * config-snapshot (anti-juks).
   *
   * Implementasjonen skal IKKE utføre wallet-transfer selv — den returnerer
   * bare `payoutCents` og orchestrator utfører transfer.
   *
   * Kan kaste DomainError ved ugyldig input. Orchestrator fanger og logger
   * men krasher ikke draw-transaksjonen.
   */
  handleChoice(input: MiniGameChoiceInput): Promise<MiniGameResult>;
}

/**
 * Trigger-payload som sendes til klient. Fri-form for hver type;
 * discriminert via `type`-feltet slik at klient kan render korrekt UI.
 *
 * Alle typer må inkludere `resultId` slik at klienten sender riktig ID
 * tilbake i `mini_game:choice`-kallet.
 */
export interface MiniGameTriggerPayload {
  readonly type: MiniGameType;
  readonly resultId: string;
  /** Valgfri timeout i sekunder — klient viser nedtelling. */
  readonly timeoutSeconds?: number;
  /**
   * Spill-spesifikt UI-data. Fri-form:
   *   - wheel: { segments: [{ label, prizeAmount, weight, color }] }
   *   - chest: { chestCount: 3, prizes: [...] (skjult til etter valg) }
   *   - colordraft: { slots: 12, colors: ["red", "blue", ...] }
   *   - oddsen: { totalBalls: 75, betRange: [min, max] }
   *   - mystery: { middleNumber, resultNumber, prizeListNok, maxRounds,
   *       autoTurnFirstMoveSec, autoTurnOtherMoveSec }
   */
  readonly payload: Readonly<Record<string, unknown>>;
}
