/**
 * @vitest-environment happy-dom
 *
 * Tobias-direktiv 2026-05-15 IMMUTABLE (post-round-flyt §5.8):
 *   PauseOverlay skal IKKE vises etter natural round-end (Fullt Hus eller
 *   alle 75 baller trukket). Selv om `state.isPaused === true` flyter
 *   gjennom fra en tidligere auto-pause (eks. Rad 4-pause som ikke ble
 *   resatt før status flippet til 'completed'), skal klienten gå rett til
 *   WinScreen → EndOfRoundOverlay → lobby + BuyPopup uten å vise
 *   "Spillet er pauset / Venter på hall-operatør"-budskapet.
 *
 * Bug-bakgrunn:
 *   - Engine setter `paused=true` i `app_game1_game_state` etter hver
 *     phase-won (Tobias-direktiv 2026-04-27, Spill 1 auto-pause).
 *   - Når Fullt Hus vinnes, settes `status='completed'` i
 *     `app_game1_scheduled_games`, men `paused`-flagget i
 *     `app_game1_game_state` resettes ikke i samme UPDATE.
 *   - Snapshot-builderen (`Game1ScheduledRoomSnapshot.ts:298`) speiler
 *     `paused`-flagget til `isPaused` i klient-state.
 *   - Klient-state har derfor `gameStatus="ENDED"` OG `isPaused=true`
 *     samtidig — overlay-conditionen i Game1Controller (pre-fix:
 *     `if (state.isPaused && !pauseOverlay?.isShowing())`) trigget
 *     overlay-en feilaktig.
 *
 * Fix (denne PR):
 *   Klient-side gate i Game1Controller.onStateChanged — vis PauseOverlay
 *   KUN når `state.isPaused && state.gameStatus === "RUNNING"`. Alle
 *   andre tilstander (NONE/WAITING/ENDED) er semantisk ikke "mid-round
 *   pause" og skal IKKE rendre overlay-en.
 *
 * Test-pattern:
 *   Pure-funksjons-mirror av decision-logikken i Game1Controller
 *   onStateChanged() rundt linje 1848-1873. Mønsteret er identisk med
 *   `PlayScreen.autoShowBuyPopupPerRound.test.ts` —
 *   pure function av prod-logikk speilet i test for deterministisk
 *   regresjons-coverage uten å instansiere full Pixi-stack.
 *
 *   Hvis prod-koden drifter, oppdater også denne mirror-funksjonen.
 *   Kontrakten er Tobias-direktiv 2026-05-15 §5.8.
 */
import { describe, it, expect } from "vitest";

type GameStatus = "NONE" | "WAITING" | "RUNNING" | "ENDED";

interface PauseOverlayInputs {
  /** `app_game1_game_state.paused` propagert til klient via room-snapshot. */
  isPaused: boolean;
  /** Klient sin GameStatus-projection av snapshot.currentGame.status. */
  gameStatus: GameStatus;
  /** Hva PauseOverlay-state var FØR denne update (pure-state mirror). */
  previouslyShowing: boolean;
}

type PauseOverlayAction = "show" | "update" | "hide" | "noop";

/**
 * Pure-function mirror av PauseOverlay-decision-logikken i
 * Game1Controller.onStateChanged (ca. linje 1848-1873).
 *
 * Returnerer hvilken action overlay-koden ville utført — show, update
 * (allerede vist, refresh content), hide, eller noop (ingen endring).
 */
function decidePauseOverlayAction(
  inputs: PauseOverlayInputs,
): PauseOverlayAction {
  const shouldShow =
    inputs.isPaused && inputs.gameStatus === "RUNNING";

  if (shouldShow && !inputs.previouslyShowing) return "show";
  if (shouldShow && inputs.previouslyShowing) return "update";
  if (!shouldShow && inputs.previouslyShowing) return "hide";
  return "noop";
}

describe("Game1Controller — PauseOverlay gating (Tobias 2026-05-15 §5.8)", () => {
  // ── Natural round-end scenarios (PRIMARY bug-coverage) ───────────────

  it("does NOT show PauseOverlay when gameStatus=ENDED + isPaused=true (Fullt Hus won, stale paused-flag)", () => {
    // Repro: engine auto-pauset etter Rad 4, master resumet, Fullt Hus
    // ble vunnet på neste draw. status='completed' settes men engine-
    // state.paused kan være true hvis ikke alle update-paths resetter
    // det. Klient skal IKKE vise overlay.
    const action = decidePauseOverlayAction({
      isPaused: true,
      gameStatus: "ENDED",
      previouslyShowing: false,
    });
    expect(action).toBe("noop");
  });

  it("does NOT show PauseOverlay when gameStatus=ENDED + isPaused=false (MAX_DRAWS_REACHED)", () => {
    // Repro: alle 75 baller trukket, ingen fant Fullt Hus. status='completed',
    // paused naturlig false. Overlay skal være skjult — dette er trivielt
    // tilfellet men inkludert for komplett-dekning.
    const action = decidePauseOverlayAction({
      isPaused: false,
      gameStatus: "ENDED",
      previouslyShowing: false,
    });
    expect(action).toBe("noop");
  });

  it("HIDES PauseOverlay when game transitions RUNNING+paused → ENDED+paused", () => {
    // Repro: spilleren ser overlay (master pauset midt i runden), så
    // master resumet og en spiller vinner Fullt Hus i samme draw.
    // Klient ser overlay → må gjemmes ved ENDED-overgang selv om
    // isPaused-flagget vedvarer.
    const action = decidePauseOverlayAction({
      isPaused: true,
      gameStatus: "ENDED",
      previouslyShowing: true,
    });
    expect(action).toBe("hide");
  });

  // ── Master-explicit-pause scenarios (must STILL work) ────────────────

  it("DOES show PauseOverlay when gameStatus=RUNNING + isPaused=true (master pause)", () => {
    // Master har eksplisitt pauset mid-round (eller engine auto-pause
    // etter rad-vinst). Status fortsatt RUNNING. Overlay SKAL vises.
    const action = decidePauseOverlayAction({
      isPaused: true,
      gameStatus: "RUNNING",
      previouslyShowing: false,
    });
    expect(action).toBe("show");
  });

  it("REFRESHES PauseOverlay content when gameStatus=RUNNING + isPaused=true + overlay already showing", () => {
    // Master forlenger pause-vinduet eller endrer pauseReason. Klient
    // skal oppdatere innholdet uten å re-fade overlay-en.
    const action = decidePauseOverlayAction({
      isPaused: true,
      gameStatus: "RUNNING",
      previouslyShowing: true,
    });
    expect(action).toBe("update");
  });

  it("HIDES PauseOverlay when master resumes (RUNNING+paused → RUNNING+not-paused)", () => {
    // Normal resume-flyt: master fortsetter spillet, isPaused → false,
    // status fortsatt RUNNING. Overlay må fade ut.
    const action = decidePauseOverlayAction({
      isPaused: false,
      gameStatus: "RUNNING",
      previouslyShowing: true,
    });
    expect(action).toBe("hide");
  });

  // ── Pre-game and WAITING scenarios (no-game-active) ──────────────────

  it("does NOT show PauseOverlay when gameStatus=WAITING + isPaused=true (no active round)", () => {
    // Edge case: scheduled-game er i WAITING-state men paused-flagget
    // er stale fra forrige runde. Ingen aktiv runde å pause — overlay
    // skal ikke vises.
    const action = decidePauseOverlayAction({
      isPaused: true,
      gameStatus: "WAITING",
      previouslyShowing: false,
    });
    expect(action).toBe("noop");
  });

  it("does NOT show PauseOverlay when gameStatus=NONE (no scheduled game at all)", () => {
    const action = decidePauseOverlayAction({
      isPaused: false,
      gameStatus: "NONE",
      previouslyShowing: false,
    });
    expect(action).toBe("noop");
  });

  it("HIDES PauseOverlay if it was showing but gameStatus transitions to NONE/WAITING", () => {
    // Defense-in-depth: hvis overlay vises og state plutselig transitioner
    // til NONE eller WAITING (room rebuild, scheduled-game cancelled),
    // skal overlay fade ut.
    const actionNone = decidePauseOverlayAction({
      isPaused: true,
      gameStatus: "NONE",
      previouslyShowing: true,
    });
    expect(actionNone).toBe("hide");

    const actionWaiting = decidePauseOverlayAction({
      isPaused: true,
      gameStatus: "WAITING",
      previouslyShowing: true,
    });
    expect(actionWaiting).toBe("hide");
  });

  // ── State-machine idempotency ────────────────────────────────────────

  it("is idempotent: repeated update() with same state → noop", () => {
    // Klient-poll-loop kaller onStateChanged ofte (hvert 100ms+). Når
    // ingenting endres mellom kall skal beslutningen returnere noop —
    // ikke gjentatte show()/update() som ville trigge fade-animasjon.
    const inputs = {
      isPaused: true,
      gameStatus: "ENDED" as const,
      previouslyShowing: false,
    };
    expect(decidePauseOverlayAction(inputs)).toBe("noop");
    expect(decidePauseOverlayAction(inputs)).toBe("noop");
  });

  // ── §5.8 full post-round flow integration shape ──────────────────────

  it("full post-round flow: RUNNING+paused → ENDED+paused → WAITING+no-paused → RUNNING (new round)", () => {
    // Speiler hele §5.8-flyten av et typisk natural end + ny runde-spawn:
    //   T0: mid-round, master paused (Rad 4 vunnet) → overlay viser
    //   T1: master resumer, ny ball trekkes, Fullt Hus vinnes → ENDED
    //       transition. Overlay SKAL hides (ikke vises på post-round).
    //   T2: room broadcast med ny scheduled-game → WAITING + paused=false
    //   T3: ny runde starter → RUNNING + paused=false

    // T0
    let showing = false;
    let action = decidePauseOverlayAction({
      isPaused: true,
      gameStatus: "RUNNING",
      previouslyShowing: showing,
    });
    expect(action).toBe("show");
    showing = true;

    // T1 — Fullt Hus vunnet, ENDED transition
    // Engine setter status='completed', men paused-flag ikke umiddelbart
    // resatt → klient ser isPaused=true + gameStatus=ENDED. Pre-fix:
    // overlay ville fortsette å vises. Post-fix: hides.
    action = decidePauseOverlayAction({
      isPaused: true,
      gameStatus: "ENDED",
      previouslyShowing: showing,
    });
    expect(action).toBe("hide");
    showing = false;

    // T2 — backend sender nytt lobby-state etter natural end
    action = decidePauseOverlayAction({
      isPaused: false,
      gameStatus: "WAITING",
      previouslyShowing: showing,
    });
    expect(action).toBe("noop");

    // T3 — ny runde starter
    action = decidePauseOverlayAction({
      isPaused: false,
      gameStatus: "RUNNING",
      previouslyShowing: showing,
    });
    expect(action).toBe("noop");
  });
});
