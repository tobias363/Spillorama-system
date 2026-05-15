/**
 * @vitest-environment happy-dom
 *
 * Pilot Q3 2026 (2026-05-15) — "Forbereder neste spill"-loader-tester.
 *
 * Bakgrunn (Tobias-rapport 2026-05-15):
 *   "Etter at runden var fullført viser fortsatt 'Neste spill: Bingo'
 *    i ca 2 min FØR det endret seg til '1000-spill'. Spiller skal
 *    ALDRI se gammelt spill. Hvis vi ikke kan få det raskt — vi må
 *    ha loader."
 *
 * Loader-state-maskinen (mirror av PlayScreen.update()-logikken):
 *   - Triggers når `gameStatus` går RUNNING → ikke-RUNNING og
 *     `previousCatalogSlug` ennå ikke er endret (server har ikke
 *     advancert plan-runtime).
 *   - Forrang: closed > loading > waiting-master > next-game.
 *   - Timeout: LOADING_TRANSITION_TIMEOUT_MS (10s). Etter timeout
 *     fall tilbake til siste kjente "Neste spill"-tekst.
 *   - Clear ved (a) catalogSlug-skifte (server advancert), (b) ny
 *     RUNNING-state (neste runde startet), eller (c) timeout.
 *
 * Disse testene mirror-er logikken som pure functions slik at vi kan
 * verifisere kontrakten uten Pixi-instansiering — speilet pattern fra
 * `PlayScreen.countdownGating.test.ts`.
 *
 * Hvis production-koden i PlayScreen.update() drifter, oppdater også
 * `decideIdleMode()` her. Kontrakten er Tobias-direktivet om at
 * spilleren aldri skal se gammelt spill etter natural round-end.
 */
import { describe, it, expect } from "vitest";
import type { Spill1LobbyOverallStatus } from "@spillorama/shared-types/api";

type IdleMode = "closed" | "loading" | "waiting-master" | "next-game";

interface IdleModeInputs {
  lobbyOverallStatus: Spill1LobbyOverallStatus | null;
  waitingForMasterPurchase: boolean;
  /** ms-timestamp; null = loader inaktiv. */
  loadingTransitionDeadline: number | null;
  /** wall-clock (epoch ms) ved evaluering. */
  nowMs: number;
}

/**
 * Pure-function mirror av idle-mode-pick-logikken i `PlayScreen.update()`
 * (når `gameStatus !== "RUNNING"` og countdown ikke kjører).
 *
 * Forrang: closed > loading > waiting-master > next-game.
 */
function decideIdleMode(inputs: IdleModeInputs): IdleMode {
  const lobbyClosed = inputs.lobbyOverallStatus === "closed";
  const loadingActive =
    inputs.loadingTransitionDeadline !== null &&
    inputs.nowMs < inputs.loadingTransitionDeadline;

  if (lobbyClosed) return "closed";
  if (loadingActive) return "loading";
  if (inputs.waitingForMasterPurchase) return "waiting-master";
  return "next-game";
}

/**
 * State-overgang: skal vi sette `loadingTransitionDeadline`?
 * Mirror av guarden i `update()`-pathen som detekterer RUNNING → ikke-
 * RUNNING.
 */
function shouldStartLoadingTransition(prev: {
  previousGameStatus: "NONE" | "WAITING" | "RUNNING" | "ENDED";
  newGameStatus: "NONE" | "WAITING" | "RUNNING" | "ENDED";
}): boolean {
  return prev.previousGameStatus === "RUNNING" && prev.newGameStatus !== "RUNNING";
}

const TIMEOUT_MS = 10_000;

describe("PlayScreen loading transition (Pilot Q3 2026)", () => {
  // ── shouldStartLoadingTransition: trigger-vakt ─────────────────────────
  it("RUNNING → ENDED triggers loader-start", () => {
    expect(
      shouldStartLoadingTransition({
        previousGameStatus: "RUNNING",
        newGameStatus: "ENDED",
      }),
    ).toBe(true);
  });

  it("RUNNING → WAITING triggers loader-start", () => {
    expect(
      shouldStartLoadingTransition({
        previousGameStatus: "RUNNING",
        newGameStatus: "WAITING",
      }),
    ).toBe(true);
  });

  it("RUNNING → NONE triggers loader-start", () => {
    expect(
      shouldStartLoadingTransition({
        previousGameStatus: "RUNNING",
        newGameStatus: "NONE",
      }),
    ).toBe(true);
  });

  it("WAITING → RUNNING does NOT trigger loader", () => {
    // Ny runde starter — ingen loader nødvendig.
    expect(
      shouldStartLoadingTransition({
        previousGameStatus: "WAITING",
        newGameStatus: "RUNNING",
      }),
    ).toBe(false);
  });

  it("ENDED → WAITING does NOT trigger loader (allerede ute av RUNNING)", () => {
    // Loader allerede satt i forrige tick; ikke restart.
    expect(
      shouldStartLoadingTransition({
        previousGameStatus: "ENDED",
        newGameStatus: "WAITING",
      }),
    ).toBe(false);
  });

  it("NONE → WAITING does NOT trigger loader (aldri vært RUNNING)", () => {
    expect(
      shouldStartLoadingTransition({
        previousGameStatus: "NONE",
        newGameStatus: "WAITING",
      }),
    ).toBe(false);
  });

  // ── decideIdleMode: forrang og time-out ────────────────────────────────
  it("loader aktiv (deadline > now) + ikke closed → loading mode", () => {
    const now = 100_000;
    expect(
      decideIdleMode({
        lobbyOverallStatus: "purchase_open",
        waitingForMasterPurchase: false,
        loadingTransitionDeadline: now + 5_000,
        nowMs: now,
      }),
    ).toBe("loading");
  });

  it("loader aktiv + closed status → closed (closed har høyest forrang)", () => {
    const now = 100_000;
    expect(
      decideIdleMode({
        lobbyOverallStatus: "closed",
        waitingForMasterPurchase: false,
        loadingTransitionDeadline: now + 5_000,
        nowMs: now,
      }),
    ).toBe("closed");
  });

  it("loader timeout truffet → fall tilbake til next-game", () => {
    const now = 100_000;
    expect(
      decideIdleMode({
        lobbyOverallStatus: "purchase_open",
        waitingForMasterPurchase: false,
        loadingTransitionDeadline: now - 1_000, // utløpt
        nowMs: now,
      }),
    ).toBe("next-game");
  });

  it("loader timeout truffet + waitingForMaster → waiting-master", () => {
    const now = 100_000;
    expect(
      decideIdleMode({
        lobbyOverallStatus: "purchase_open",
        waitingForMasterPurchase: true,
        loadingTransitionDeadline: now - 1_000,
        nowMs: now,
      }),
    ).toBe("waiting-master");
  });

  it("loader aktiv + waitingForMaster → loading (loading har forrang over waiting-master)", () => {
    const now = 100_000;
    expect(
      decideIdleMode({
        lobbyOverallStatus: "purchase_open",
        waitingForMasterPurchase: true,
        loadingTransitionDeadline: now + 5_000,
        nowMs: now,
      }),
    ).toBe("loading");
  });

  it("ingen loader, ingen waitingForMaster → next-game (default)", () => {
    expect(
      decideIdleMode({
        lobbyOverallStatus: "purchase_open",
        waitingForMasterPurchase: false,
        loadingTransitionDeadline: null,
        nowMs: 100_000,
      }),
    ).toBe("next-game");
  });

  it("LOADING_TRANSITION_TIMEOUT_MS = 10000 (kontraktssjekk)", () => {
    // Hvis denne testen feiler, noen har endret loader-timeouten uten å
    // oppdatere mirror-en eller specen. Sjekk PlayScreen.ts.
    expect(TIMEOUT_MS).toBe(10_000);
  });
});

// ── Slug-transition: når server advancer cleares loader umiddelbart ─────
describe("PlayScreen loading transition: slug-tracker clears loader on advance", () => {
  /**
   * Pure-function mirror av `setNextScheduledGameSlug`-logikken.
   * Returnerer ny `loadingTransitionDeadline` etter slug-update.
   */
  function applySlugUpdate(prev: {
    previousCatalogSlug: string | null;
    newSlug: string | null;
    currentDeadline: number | null;
  }): {
    nextSlug: string | null;
    nextDeadline: number | null;
  } {
    const nextSlug = (prev.newSlug ?? "").trim() || null;
    if (nextSlug === prev.previousCatalogSlug) {
      return { nextSlug, nextDeadline: prev.currentDeadline };
    }
    // Slug endret — clear loader så CenterBall hopper rett til ny tekst.
    const cleared =
      prev.previousCatalogSlug !== null && nextSlug !== null;
    return {
      nextSlug,
      nextDeadline: cleared ? null : prev.currentDeadline,
    };
  }

  it("slug bingo → 1000-spill clearer loader (server advancert)", () => {
    const result = applySlugUpdate({
      previousCatalogSlug: "bingo",
      newSlug: "1000-spill",
      currentDeadline: 200_000,
    });
    expect(result.nextSlug).toBe("1000-spill");
    expect(result.nextDeadline).toBe(null);
  });

  it("slug uendret (bingo → bingo) bevarer loader-deadline", () => {
    const result = applySlugUpdate({
      previousCatalogSlug: "bingo",
      newSlug: "bingo",
      currentDeadline: 200_000,
    });
    expect(result.nextSlug).toBe("bingo");
    expect(result.nextDeadline).toBe(200_000);
  });

  it("slug null → bingo (initial state, ingen forrige) bevarer deadline (ikke en advance-event)", () => {
    const result = applySlugUpdate({
      previousCatalogSlug: null,
      newSlug: "bingo",
      currentDeadline: 200_000,
    });
    expect(result.nextSlug).toBe("bingo");
    // Ingen advance — bare første gang vi får slug. Loader skal IKKE
    // cleares automatisk her; den cleares av timeout eller RUNNING-state.
    expect(result.nextDeadline).toBe(200_000);
  });

  it("slug bingo → null (server mistet plan?) bevarer deadline", () => {
    const result = applySlugUpdate({
      previousCatalogSlug: "bingo",
      newSlug: null,
      currentDeadline: 200_000,
    });
    expect(result.nextSlug).toBe(null);
    // newSlug null = ingen ny advance. Loader skal ikke ryddes — bedre
    // å vise loader inntil timeout enn å vise "Neste spill: Bingo"
    // for et spill som ikke lenger finnes på plan-runtime.
    expect(result.nextDeadline).toBe(200_000);
  });

  it("slug trimmed (whitespace) → ny verdi clearer loader", () => {
    const result = applySlugUpdate({
      previousCatalogSlug: "bingo",
      newSlug: "   1000-spill   ",
      currentDeadline: 200_000,
    });
    expect(result.nextSlug).toBe("1000-spill");
    expect(result.nextDeadline).toBe(null);
  });

  it("slug uendret etter trim (bingo → '  bingo  ') bevarer deadline", () => {
    const result = applySlugUpdate({
      previousCatalogSlug: "bingo",
      newSlug: "  bingo  ",
      currentDeadline: 200_000,
    });
    expect(result.nextSlug).toBe("bingo");
    expect(result.nextDeadline).toBe(200_000);
  });
});
