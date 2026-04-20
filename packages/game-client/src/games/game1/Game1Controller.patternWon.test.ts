/**
 * @vitest-environment happy-dom
 *
 * BIN-696: Game1Controller.onPatternWon — 3s fase-popup + multi-winner-split-forklaring.
 *
 * Per Tobias 2026-04-20:
 *   - ALLE spillere får en 3s popup: "Rad N er vunnet!" (eller "Fullt Hus
 *     er vunnet. Spillet er over." for siste fase)
 *   - KUN vinnerne får en ekstra win-toast med split-forklaring:
 *     "Du vant Rad 1! Din andel: 15 kr (premien delt på 3 spillere som vant samtidig)"
 *
 * Samme lettvekts-harness-pattern som Game1Controller.claim.test.ts —
 * mirrorer `onPatternWon`-logikken uten å boote hele controlleren.
 */
import { describe, it, expect, vi } from "vitest";
import type { PatternWonPayload } from "@spillorama/shared-types/socket-events";

interface ToastStub {
  info: ReturnType<typeof vi.fn>;
  win: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

/**
 * Mirror of Game1Controller.onPatternWon — kun meldings-delen, ikke
 * telemetry/audio/screen-kall (testes andre steder). Duplikat av 15
 * linjer produksjonslogikk.
 */
function harnessOnPatternWon(result: PatternWonPayload, ctx: {
  myPlayerId: string | null;
  toast: ToastStub;
}): void {
  const isFullHouse = result.claimType === "BINGO";
  const phaseMsg = isFullHouse
    ? "Fullt Hus er vunnet. Spillet er over."
    : `${result.patternName} er vunnet!`;
  ctx.toast.info(phaseMsg, 3000);

  const winnerIds = result.winnerIds ?? (result.winnerId ? [result.winnerId] : []);
  const isMe = ctx.myPlayerId !== null && winnerIds.includes(ctx.myPlayerId);
  const winnerCount = result.winnerCount ?? winnerIds.length;

  if (isMe) {
    const firstLine = isFullHouse
      ? "Du vant Fullt Hus!"
      : `Du vant ${result.patternName}!`;
    const secondLine = winnerCount > 1
      ? `Din gevinst: ${result.payoutAmount} kr (premien delt på ${winnerCount} spillere som vant samtidig)`
      : `Gevinst: ${result.payoutAmount} kr`;
    ctx.toast.win(`${firstLine}\n${secondLine}`, 5000);
  }
}

function makeToast(): ToastStub {
  return { info: vi.fn(), win: vi.fn(), error: vi.fn() };
}

function makePayload(overrides: Partial<PatternWonPayload> = {}): PatternWonPayload {
  return {
    patternId: "pattern-0",
    patternName: "1 Rad",
    winnerId: "player-1",
    wonAtDraw: 5,
    payoutAmount: 15,
    claimType: "LINE",
    gameId: "game-1",
    winnerIds: ["player-1"],
    winnerCount: 1,
    ...overrides,
  };
}

describe("BIN-696: fase-popup (info-toast) vises til alle", () => {
  it("Rad 1 vunnet → 'Rad 1 er vunnet!' i 3s til alle", () => {
    const toast = makeToast();
    harnessOnPatternWon(makePayload({ patternName: "1 Rad" }), {
      myPlayerId: "other",
      toast,
    });
    expect(toast.info).toHaveBeenCalledWith("1 Rad er vunnet!", 3000);
  });

  it("Rad 3 vunnet → 'Rad 3 er vunnet!'", () => {
    const toast = makeToast();
    harnessOnPatternWon(makePayload({ patternName: "3 Rader" }), {
      myPlayerId: "other",
      toast,
    });
    expect(toast.info).toHaveBeenCalledWith("3 Rader er vunnet!", 3000);
  });

  it("Fullt Hus → spesiell tekst 'Fullt Hus er vunnet. Spillet er over.'", () => {
    const toast = makeToast();
    harnessOnPatternWon(
      makePayload({ patternName: "Fullt Hus", claimType: "BINGO" }),
      { myPlayerId: "other", toast },
    );
    expect(toast.info).toHaveBeenCalledWith(
      "Fullt Hus er vunnet. Spillet er over.",
      3000,
    );
  });
});

describe("BIN-696: vinner-toast med split-forklaring", () => {
  it("solo vinner → 'Du vant 1 Rad!\\nGevinst: 15 kr' (ingen 'Din', ingen split-suffix)", () => {
    const toast = makeToast();
    harnessOnPatternWon(
      makePayload({
        patternName: "1 Rad",
        payoutAmount: 15,
        winnerIds: ["player-1"],
        winnerCount: 1,
      }),
      { myPlayerId: "player-1", toast },
    );
    expect(toast.win).toHaveBeenCalledWith(
      "Du vant 1 Rad!\nGevinst: 15 kr",
      5000,
    );
  });

  it("multi-winner split (3 spillere) → 'Din gevinst' + forklaring i parentes", () => {
    const toast = makeToast();
    harnessOnPatternWon(
      makePayload({
        patternName: "1 Rad",
        payoutAmount: 15,
        winnerIds: ["player-1", "player-2", "player-3"],
        winnerCount: 3,
      }),
      { myPlayerId: "player-1", toast },
    );
    expect(toast.win).toHaveBeenCalledWith(
      "Du vant 1 Rad!\nDin gevinst: 15 kr (premien delt på 3 spillere som vant samtidig)",
      5000,
    );
  });

  it("ikke vinner → ingen win-toast, kun info-toast", () => {
    const toast = makeToast();
    harnessOnPatternWon(
      makePayload({ winnerIds: ["player-1", "player-2"], winnerCount: 2 }),
      { myPlayerId: "player-3", toast },
    );
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.win).not.toHaveBeenCalled();
  });

  it("Fullt Hus vinner → 'Du vant Fullt Hus!\\nGevinst: 40 kr'", () => {
    const toast = makeToast();
    harnessOnPatternWon(
      makePayload({
        patternName: "Fullt Hus",
        claimType: "BINGO",
        payoutAmount: 40,
        winnerIds: ["player-1"],
        winnerCount: 1,
      }),
      { myPlayerId: "player-1", toast },
    );
    expect(toast.win).toHaveBeenCalledWith(
      "Du vant Fullt Hus!\nGevinst: 40 kr",
      5000,
    );
  });

  it("legacy payload uten winnerIds → bruker winnerId-fallback", () => {
    const toast = makeToast();
    harnessOnPatternWon(
      // Simuler eldre backend som ikke har BIN-696-feltene
      {
        patternId: "p",
        patternName: "1 Rad",
        winnerId: "player-1",
        wonAtDraw: 5,
        payoutAmount: 30,
        claimType: "LINE",
        gameId: "g1",
      } as PatternWonPayload,
      { myPlayerId: "player-1", toast },
    );
    expect(toast.win).toHaveBeenCalledWith(
      "Du vant 1 Rad!\nGevinst: 30 kr",
      5000,
    );
  });
});
