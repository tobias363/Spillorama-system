/**
 * @vitest-environment happy-dom
 *
 * Tobias-bug 2026-05-12 (popup-visibility regresjon) — auto-show BuyPopup
 * må re-trigge ved hver runde, ikke bare én gang per PlayScreen-instans.
 *
 * Bakgrunn:
 *   Tobias-quote 2026-05-12: "popup av bonger ikke kommer opp slik det
 *   gjorde tidligere. Denne funksjonen er allerede vært aktiv og funket
 *   bra".
 *
 *   Symptom (2026-05-12 19:39 pilot-test):
 *     - Spill nådde 75/75 ball, `gameEnded`-event kom til klient
 *     - gameStatus gikk RUNNING → NONE
 *     - Master startet ny scheduled-game (sched-id i debug-HUD endret seg)
 *     - Men ingen BuyPopup viste seg
 *
 *   Root cause (todelt):
 *     1. PR #1163 (lobby-init-order, 2026-05-10) introduserte playScreen-
 *        REUSE i `transitionTo(WAITING/PLAYING/SPECTATING)` — pre-PR ble
 *        PlayScreen rebuilt ved hver phase-transition, hvilket nullstilte
 *        `autoShowBuyPopupDone` til false. Post-PR gjenbrukes instansen
 *        og flagget stayer true gjennom hele session.
 *     2. PR #1255 (Alternativ B, 2026-05-12) la til `waitingForMasterPurchase`-
 *        gate som ekstra blokkering. Den fixen var korrekt for bet:arm-
 *        orphan-tickets-buggen, men forsterket popup-visibility-regresjonen.
 *
 *   Tobias' state-matrise:
 *     | Spilltilstand                | Popup  |
 *     |------------------------------|--------|
 *     | Ingen planlagte spill        | Disabled |
 *     | scheduled (master Start)     | Aktiv  |
 *     | ready_to_start               | Aktiv  |
 *     | running (trekning pågår)     | Skjult |
 *     | paused                       | Skjult |
 *     | completed / finished         | Aktiv  |
 *     | Mellom runder                | Aktiv  |
 *
 *   Fix (2026-05-12): nullstill `autoShowBuyPopupDone` ved RUNNING →
 *   non-RUNNING transition (round-end). Match pre-#1163 oppførsel uten å
 *   gjenoppfinne PlayScreen-rebuild.
 *
 * Tester:
 *   Pure-funksjons-mirror av decision-logikken i PlayScreen.update().
 *   Speiler både `autoShowBuyPopupDone`-reset-logikken og auto-show-gate
 *   med alle conditions (hasLive, hasTicketTypes, waitingForMasterPurchase,
 *   preRoundTickets). Følger samme pattern som
 *   `PlayScreen.countdownGating.test.ts` + `PlayScreen.waitOnMasterPurchase.test.ts`.
 */
import { describe, it, expect } from "vitest";

type GameStatus = "NONE" | "WAITING" | "RUNNING" | "ENDED";

interface AutoShowInputs {
  /** State i forrige `update()`-tick. */
  previousGameStatus: GameStatus;
  /** State i denne `update()`-tick. */
  gameStatus: GameStatus;
  /** Antall live-brett spilleren har i nåværende runde. */
  myTicketCount: number;
  /** Antall pre-round-brett (kjøpt til neste runde, ikke startet ennå). */
  preRoundTicketCount: number;
  /** State.ticketTypes.length fra room:update (kan være tom pre-game). */
  stateTicketTypesLength: number;
  /** lobbyTicketConfig.ticketTypes.length fra plan-runtime (Fase 2 fallback). */
  lobbyTicketConfigLength: number;
  /** Wait-on-master-fix (PR #1255): scheduled-game ikke spawnet ennå. */
  waitingForMasterPurchase: boolean;
  /** Tidligere auto-show-state (akkumulert fra forrige update). */
  autoShowBuyPopupDone: boolean;
}

interface AutoShowDecision {
  /** Skal popup auto-åpnes denne tick? */
  shouldAutoShow: boolean;
  /** Ny `autoShowBuyPopupDone` etter denne tick (state-machine output). */
  nextAutoShowBuyPopupDone: boolean;
}

/**
 * Pure-function mirror av auto-show-popup-decision-logikken i
 * `PlayScreen.update()`. Hvis production-koden drifter, oppdater også
 * denne — kontrakten er Tobias' state-matrise.
 */
function decideAutoShowBuyPopup(inputs: AutoShowInputs): AutoShowDecision {
  // Round-end-reset: når RUNNING → non-RUNNING, nullstill flagget slik
  // at neste auto-show-conditions kan re-trigge popup-en.
  let autoShowDone = inputs.autoShowBuyPopupDone;
  if (
    inputs.previousGameStatus === "RUNNING"
    && inputs.gameStatus !== "RUNNING"
  ) {
    autoShowDone = false;
  }

  // Auto-show gate (identisk med PlayScreen.update linje ~626-639):
  const running = inputs.gameStatus === "RUNNING";
  const hasLive = running && inputs.myTicketCount > 0;
  const hasTicketTypes =
    inputs.stateTicketTypesLength > 0
    || inputs.lobbyTicketConfigLength > 0;

  // Popup-gate (Tobias-direktiv 2026-05-13): vises uavhengig av
  // waitingForMasterPurchase. Server konverterer armed → purchases ved
  // master-start, så det er trygt å la spilleren arm bonger før
  // scheduled-game er spawnet.
  const shouldAutoShow =
    !autoShowDone
    && !hasLive
    && hasTicketTypes
    && inputs.preRoundTicketCount === 0;

  return {
    shouldAutoShow,
    nextAutoShowBuyPopupDone: shouldAutoShow ? true : autoShowDone,
  };
}

function defaultInputs(
  overrides: Partial<AutoShowInputs> = {},
): AutoShowInputs {
  return {
    previousGameStatus: "NONE",
    gameStatus: "NONE",
    myTicketCount: 0,
    preRoundTicketCount: 0,
    stateTicketTypesLength: 3, // hvit/gul/lilla per standard hovedspill
    lobbyTicketConfigLength: 0,
    waitingForMasterPurchase: false,
    autoShowBuyPopupDone: false,
    ...overrides,
  };
}

describe("PlayScreen auto-show BuyPopup per round (Tobias-bug 2026-05-12)", () => {
  // ── Pre-fix scenarier: popup MÅ vises ──────────────────────────────────

  it("scheduled / ready_to_start: popup auto-åpnes på første update", () => {
    // Master har trykket Start — `ready_to_start`-state. Klient har akkurat
    // mounted PlayScreen, ingen brett kjøpt enda. Popup skal vises.
    const result = decideAutoShowBuyPopup(defaultInputs({
      gameStatus: "WAITING",
      previousGameStatus: "NONE",
      myTicketCount: 0,
      preRoundTicketCount: 0,
      stateTicketTypesLength: 3,
      waitingForMasterPurchase: false,
    }));
    expect(result.shouldAutoShow).toBe(true);
    expect(result.nextAutoShowBuyPopupDone).toBe(true);
  });

  it("running (trekning pågår) + spiller har brett: popup IKKE auto-åpnes (hasLive)", () => {
    const result = decideAutoShowBuyPopup(defaultInputs({
      gameStatus: "RUNNING",
      previousGameStatus: "WAITING",
      myTicketCount: 5, // spiller har live-brett
    }));
    expect(result.shouldAutoShow).toBe(false);
  });

  it("running (trekning pågår) + spiller spectator: popup IKKE auto-åpnes (server eier rom-state)", () => {
    // En spectator midt i runden skal IKKE få popup pushet — popupen vises
    // når runden ender (gameStatus → !RUNNING).
    const result = decideAutoShowBuyPopup(defaultInputs({
      gameStatus: "RUNNING",
      previousGameStatus: "WAITING",
      myTicketCount: 0,
      autoShowBuyPopupDone: true, // forrige tick åpnet popup-en
    }));
    expect(result.shouldAutoShow).toBe(false);
  });

  // ── REGRESJON-fix: popup må re-åpne ved round-end ──────────────────────

  it("REGRESJON-FIX: RUNNING → non-RUNNING nullstiller autoShowBuyPopupDone", () => {
    // Pre-fix: autoShowBuyPopupDone var lifetime per PlayScreen-instans.
    // Med PR #1163 (playScreen-reuse) betød det at popup ble vist ÉN gang,
    // aldri igjen. Post-fix: nullstilles ved round-end (RUNNING → !RUNNING).
    //
    // Scenario: spiller har akkurat fullført runde 1, gameStatus gikk fra
    // RUNNING → NONE. Auto-show-flagget skal nullstilles slik at popup
    // kan auto-åpne for runde 2.
    const result = decideAutoShowBuyPopup(defaultInputs({
      previousGameStatus: "RUNNING",
      gameStatus: "NONE",
      myTicketCount: 0,
      preRoundTicketCount: 0,
      stateTicketTypesLength: 3,
      waitingForMasterPurchase: false,
      autoShowBuyPopupDone: true, // forrige runde åpnet popup-en
    }));
    expect(result.shouldAutoShow).toBe(true); // popup auto-åpnes for runde 2
    expect(result.nextAutoShowBuyPopupDone).toBe(true);
  });

  it("REGRESJON-FIX: RUNNING → ENDED nullstiller (kanonisk gameEnded-path)", () => {
    // Bridge kan sette gameStatus til "ENDED" i stedet for "NONE" når
    // engine signaliserer game-over. Reset-logikken må håndtere begge.
    const result = decideAutoShowBuyPopup(defaultInputs({
      previousGameStatus: "RUNNING",
      gameStatus: "ENDED",
      autoShowBuyPopupDone: true,
    }));
    expect(result.shouldAutoShow).toBe(true);
  });

  it("REGRESJON-FIX: RUNNING → WAITING nullstiller (mellom runder)", () => {
    // Mellom runder: master har advance-d til neste plan-item men trekning
    // har ikke startet ennå. Spiller skal se popup-en for å forhåndskjøpe
    // til neste runde.
    const result = decideAutoShowBuyPopup(defaultInputs({
      previousGameStatus: "RUNNING",
      gameStatus: "WAITING",
      autoShowBuyPopupDone: true,
    }));
    expect(result.shouldAutoShow).toBe(true);
  });

  // ── Reset MÅ IKKE skje på falske transitions ───────────────────────────

  it("NONE → WAITING nullstiller ikke (initial mount, ikke round-end)", () => {
    // Ny PlayScreen-instans får første update etter mount. autoShowBuyPopupDone
    // er allerede false, så ingen "reset" trengs. Men hvis flagget på en eller
    // annen måte var true (test-edge-case), skal det IKKE nullstilles av denne
    // transition-en — kun RUNNING → !RUNNING er round-end.
    const result = decideAutoShowBuyPopup(defaultInputs({
      previousGameStatus: "NONE",
      gameStatus: "WAITING",
      autoShowBuyPopupDone: true, // edge-case: pre-eksisterende flag
    }));
    // Flagget skal IKKE nullstilles av NONE → WAITING — kun RUNNING → !RUNNING
    // er round-end. Spillerens manuelle close av popup skal respekteres.
    expect(result.shouldAutoShow).toBe(false);
    expect(result.nextAutoShowBuyPopupDone).toBe(true);
  });

  it("WAITING → RUNNING nullstiller ikke flagget (round start, ikke round end)", () => {
    // Når master starter ny runde går gameStatus WAITING → RUNNING.
    // Verifiserer at vår reset-logikk IKKE fyrer på denne overgangen —
    // kun RUNNING → !RUNNING (round-end).
    //
    // Vi skiller her mellom "flag-reset-logikken" og "auto-show-gate":
    //   - flag-reset: skal IKKE skje (kun ved round-end)
    //   - auto-show: blokkeres uansett av hasLive (myTicketCount > 0)
    //
    // For å isolere flag-reset-testen bruker vi myTicketCount > 0 og
    // bekrefter at nextAutoShowBuyPopupDone bevarer input-flagget.
    const result = decideAutoShowBuyPopup(defaultInputs({
      previousGameStatus: "WAITING",
      gameStatus: "RUNNING",
      myTicketCount: 5, // har live-brett, hasLive=true blokkerer auto-show
      autoShowBuyPopupDone: true,
    }));
    expect(result.shouldAutoShow).toBe(false); // hasLive blokkerer
    expect(result.nextAutoShowBuyPopupDone).toBe(true); // flagget bevares (ingen reset)
  });

  it("RUNNING → RUNNING (samme runde, multiple draw-events): ingen reset", () => {
    // 75 draws genererer 75+ update()-calls. Hver skal IKKE reset-e flagget.
    const result = decideAutoShowBuyPopup(defaultInputs({
      previousGameStatus: "RUNNING",
      gameStatus: "RUNNING",
      myTicketCount: 5,
      autoShowBuyPopupDone: true,
    }));
    expect(result.shouldAutoShow).toBe(false);
    expect(result.nextAutoShowBuyPopupDone).toBe(true);
  });

  // ── State-matrise dekning (Tobias 2026-05-12) ──────────────────────────

  it("STATE-MATRISE: 'completed/finished/mellom runder' med scheduled-game spawnet → popup Aktiv", () => {
    // Tobias' state-matrise sier popup skal være AKTIV i `completed` og
    // `mellom runder`. Combined med wait-on-master-fix: scheduled-game
    // ER spawnet (waitingForMasterPurchase=false) og spiller har ingen
    // live brett.
    const result = decideAutoShowBuyPopup(defaultInputs({
      previousGameStatus: "RUNNING",
      gameStatus: "NONE",
      myTicketCount: 0,
      preRoundTicketCount: 0,
      stateTicketTypesLength: 3,
      waitingForMasterPurchase: false,
      autoShowBuyPopupDone: true,
    }));
    expect(result.shouldAutoShow).toBe(true);
  });

  it("STATE-MATRISE: 'mellom runder' UTEN scheduled-game (waiting-for-master) → popup VISES (Tobias 2026-05-13)", () => {
    // Tobias-direktiv 2026-05-13: popup MÅ vises uavhengig av om
    // scheduled-game er spawnet. Server-side
    // `Game1ArmedToPurchaseConversionService` konverterer armed bonger
    // til faktiske purchases ved master-start, så orphan-risiko er
    // eliminert. Tidligere blokker fra PR #1255 Alternativ B er fjernet.
    const result = decideAutoShowBuyPopup(defaultInputs({
      previousGameStatus: "RUNNING",
      gameStatus: "NONE",
      myTicketCount: 0,
      stateTicketTypesLength: 3,
      waitingForMasterPurchase: true, // ingen scheduled-game ennå — popup vises likevel
      autoShowBuyPopupDone: true,
    }));
    // Round-end reset gjør flagget false → popup vises på neste tick
    // uavhengig av waitingForMasterPurchase.
    expect(result.shouldAutoShow).toBe(true);
    expect(result.nextAutoShowBuyPopupDone).toBe(true);
  });

  it("STATE-MATRISE: FØRSTE entry UTEN scheduled-game (waiting-for-master, ingen kjørt runde) → popup VISES", () => {
    // Tobias-bug 2026-05-13: "det kom ikke popup hvor jeg kunne kjøpe
    // bonger til neste runde" på FØRSTE entry, FØR noen runde har kjørt.
    // Sjekk at popup vises selv om previousGameStatus=NONE (aldri RUNNING).
    const result = decideAutoShowBuyPopup(defaultInputs({
      previousGameStatus: "NONE",
      gameStatus: "NONE",
      myTicketCount: 0,
      preRoundTicketCount: 0,
      stateTicketTypesLength: 3,
      waitingForMasterPurchase: true, // master har ikke startet noe ennå
      autoShowBuyPopupDone: false,    // første entry
    }));
    expect(result.shouldAutoShow).toBe(true);
    expect(result.nextAutoShowBuyPopupDone).toBe(true);
  });

  it("STATE-MATRISE: 'mellom runder' med pre-round-brett → popup blokkert (allerede kjøpt)", () => {
    // Hvis spiller har allerede kjøpt brett til neste runde (preRoundTickets > 0),
    // skal popup IKKE auto-åpnes. Spilleren er klar.
    const result = decideAutoShowBuyPopup(defaultInputs({
      previousGameStatus: "RUNNING",
      gameStatus: "NONE",
      preRoundTicketCount: 4, // har allerede 4 brett til neste runde
      autoShowBuyPopupDone: true,
    }));
    expect(result.shouldAutoShow).toBe(false);
  });

  it("STATE-MATRISE: 'Ingen planlagte spill' (ingen ticketTypes) → popup blokkert", () => {
    // Hvis lobby ikke har levert ticket-data (verken state.ticketTypes eller
    // lobbyTicketConfig), kan vi ikke bygge popup-en — den må forbli lukket.
    const result = decideAutoShowBuyPopup(defaultInputs({
      gameStatus: "WAITING",
      previousGameStatus: "NONE",
      stateTicketTypesLength: 0,
      lobbyTicketConfigLength: 0,
    }));
    expect(result.shouldAutoShow).toBe(false);
  });

  // ── Full lifecycle: multi-round sequence ───────────────────────────────

  it("FULL LIFECYCLE: 3 runder, popup auto-åpnes for hver", () => {
    // Sequence av update()-calls som speiler en typisk multi-round sesjon.
    // Verifiserer at popup auto-åpner én gang per runde, ikke kun én gang
    // per session.

    // Tick 1: initial mount, intet ennå
    let flag = false;
    let prevStatus: GameStatus = "NONE";

    // Tick 2: lobby leverer ticket-data, WAITING-state (master har trykket Start)
    let result = decideAutoShowBuyPopup({
      previousGameStatus: prevStatus,
      gameStatus: "WAITING",
      myTicketCount: 0,
      preRoundTicketCount: 0,
      stateTicketTypesLength: 3,
      lobbyTicketConfigLength: 0,
      waitingForMasterPurchase: false,
      autoShowBuyPopupDone: flag,
    });
    expect(result.shouldAutoShow).toBe(true); // popup runde 1
    flag = result.nextAutoShowBuyPopupDone;
    prevStatus = "WAITING";

    // Tick 3: spiller kjøpte 2 brett, RUNNING-state
    result = decideAutoShowBuyPopup({
      previousGameStatus: prevStatus,
      gameStatus: "RUNNING",
      myTicketCount: 2,
      preRoundTicketCount: 0,
      stateTicketTypesLength: 3,
      lobbyTicketConfigLength: 0,
      waitingForMasterPurchase: false,
      autoShowBuyPopupDone: flag,
    });
    expect(result.shouldAutoShow).toBe(false); // hasLive blokkerer
    flag = result.nextAutoShowBuyPopupDone;
    prevStatus = "RUNNING";

    // Tick 4: runde 1 slutter, gameStatus RUNNING → NONE (round-end)
    result = decideAutoShowBuyPopup({
      previousGameStatus: prevStatus,
      gameStatus: "NONE",
      myTicketCount: 0,
      preRoundTicketCount: 0,
      stateTicketTypesLength: 3,
      lobbyTicketConfigLength: 0,
      waitingForMasterPurchase: false,
      autoShowBuyPopupDone: flag,
    });
    expect(result.shouldAutoShow).toBe(true); // popup runde 2 (REGRESJON-FIX)
    flag = result.nextAutoShowBuyPopupDone;
    prevStatus = "NONE";

    // Tick 5: ny runde starter (RUNNING)
    result = decideAutoShowBuyPopup({
      previousGameStatus: prevStatus,
      gameStatus: "RUNNING",
      myTicketCount: 3,
      preRoundTicketCount: 0,
      stateTicketTypesLength: 3,
      lobbyTicketConfigLength: 0,
      waitingForMasterPurchase: false,
      autoShowBuyPopupDone: flag,
    });
    expect(result.shouldAutoShow).toBe(false); // hasLive blokkerer
    flag = result.nextAutoShowBuyPopupDone;
    prevStatus = "RUNNING";

    // Tick 6: runde 2 slutter
    result = decideAutoShowBuyPopup({
      previousGameStatus: prevStatus,
      gameStatus: "NONE",
      myTicketCount: 0,
      preRoundTicketCount: 0,
      stateTicketTypesLength: 3,
      lobbyTicketConfigLength: 0,
      waitingForMasterPurchase: false,
      autoShowBuyPopupDone: flag,
    });
    expect(result.shouldAutoShow).toBe(true); // popup runde 3 (REGRESJON-FIX)
  });

  // ── Spectator-scenario (Tobias' faktiske bug-rapport) ──────────────────

  it("SPECTATOR: var i spillet, runde endte, ny runde startet → popup vises", () => {
    // Tobias' faktiske scenario 2026-05-12 19:39:
    //   - Spiller var med i runde 1 (myTickets > 0, RUNNING)
    //   - Runde 1 ferdig (75 draws), gameStatus RUNNING → NONE
    //   - Master startet runde 2, ny scheduledGameId i debug-HUD
    //   - Men popup viste seg ikke
    //
    // Med fix-en: round-end resetter flagget, neste auto-show-tick åpner popup.
    const result = decideAutoShowBuyPopup({
      previousGameStatus: "RUNNING",
      gameStatus: "NONE",
      myTicketCount: 0, // brett er konsumert
      preRoundTicketCount: 0,
      stateTicketTypesLength: 3,
      lobbyTicketConfigLength: 0,
      waitingForMasterPurchase: false, // ny scheduled-game er spawnet
      autoShowBuyPopupDone: true, // forrige runde åpnet popup-en
    });
    expect(result.shouldAutoShow).toBe(true);
  });

  // ── Spillerens manuelle close skal respekteres innenfor en runde ───────

  it("Spilleren lukker popup manuelt → re-åpnes ikke i samme runde", () => {
    // Pre-fix: popup-en kunne re-åpnes hvis update() ble kalt mange ganger.
    // Post-fix: kun round-end reset-er flagget. Innenfor samme runde
    // (WAITING → WAITING tick) skal flagget bevares.
    let flag = false;

    // Tick 1: popup auto-åpnes
    let result = decideAutoShowBuyPopup({
      previousGameStatus: "NONE",
      gameStatus: "WAITING",
      myTicketCount: 0,
      preRoundTicketCount: 0,
      stateTicketTypesLength: 3,
      lobbyTicketConfigLength: 0,
      waitingForMasterPurchase: false,
      autoShowBuyPopupDone: flag,
    });
    expect(result.shouldAutoShow).toBe(true);
    flag = result.nextAutoShowBuyPopupDone;

    // Tick 2: bruker lukker popup, mer state-updates kommer (WAITING → WAITING)
    result = decideAutoShowBuyPopup({
      previousGameStatus: "WAITING",
      gameStatus: "WAITING",
      myTicketCount: 0,
      preRoundTicketCount: 0,
      stateTicketTypesLength: 3,
      lobbyTicketConfigLength: 0,
      waitingForMasterPurchase: false,
      autoShowBuyPopupDone: flag,
    });
    expect(result.shouldAutoShow).toBe(false); // bruker har eksplisitt lukket
  });
});
