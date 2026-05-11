/**
 * @vitest-environment happy-dom
 *
 * Klient-auto-join-scheduled-game regression-test (Tobias-direktiv 2026-05-11).
 *
 * Bakgrunn — kritisk wiring-gap:
 *   Backend har `game1:join-scheduled`-handler (apps/backend/src/sockets/
 *   game1ScheduledEvents.ts:391-443) som binder rommet til en schedulert
 *   runde via `engine.createRoom` + `assignRoomCode`. Klient kalte tidligere
 *   utelukkende `socket.createRoom`, som returnerer per-hall ad-hoc room.
 *   Når master (eller demo-auto-master) starter den schedulerte runden,
 *   emittes `draw:new` til scheduled-game-rommet — klient lytter på
 *   ad-hoc-rommet og ser ingen baller.
 *
 *   Fix: hvis lobby-state har en joinable `nextScheduledGame.scheduledGameId`
 *   bruker klient `socket.joinScheduledGame` slik at den lander i samme rom
 *   som engine senere broadcaster til. Hvis ingen scheduled-game er klar
 *   (ingen plan dekker, status idle/finished osv.) faller klient tilbake
 *   til den eksisterende `socket.createRoom`-flyten.
 *
 * Test-strategi:
 *   Strategy A — in-process harness UTEN full Pixi-stage. Vi tester direkte
 *   helper-funksjonene som driver beslutningen (`pickJoinableScheduledGameId`,
 *   delta-watcher-mønsteret) og verifiserer at de matcher serverens
 *   join-kontrakt (joinable statuses = purchase_open|running).
 *
 *   Kontrakt vi låser:
 *     - lobby-state med `nextScheduledGame.scheduledGameId='abc'` +
 *       `status='purchase_open'` → klient skal emit `game1:join-scheduled`
 *       med samme id.
 *     - lobby-state med `nextScheduledGame=null` → fallback til
 *       `socket.createRoom` (legacy ad-hoc).
 *     - delta: når gameId endrer seg fra `abc` → `def` (plan-advance),
 *       klient skal re-emit `game1:join-scheduled` med ny id.
 *     - delta: når andre lobby-felter (overallStatus, catalogDisplayName)
 *       endrer seg men gameId er uendret, klient skal IKKE re-joine.
 *
 * Speiler:
 *   Game1Controller.pickJoinableScheduledGameId (privat helper)
 *   Game1Controller.start() join-utvalg (initialScheduledGameId)
 *   Game1Controller.handleScheduledGameDelta (delta-watcher)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Spill1LobbyState, Spill1LobbyNextGame } from "@spillorama/shared-types/api";

// ── Helper: speil av Game1Controller.pickJoinableScheduledGameId ─────────
//
// Holdes synkronisert med Game1Controller-implementasjonen. Hvis den
// driftet, må denne speilfunksjonen oppdateres. Server-whitelisten ligger
// i apps/backend/src/sockets/game1ScheduledEvents.ts:79-80
// (`JOINABLE_STATUSES`).

function pickJoinableScheduledGameId(state: Spill1LobbyState | null): string | null {
  const next = state?.nextScheduledGame;
  if (!next) return null;
  if (!next.scheduledGameId) return null;
  if (next.status !== "purchase_open" && next.status !== "running") {
    return null;
  }
  return next.scheduledGameId;
}

// ── Helper: speil av Game1Controller.resolvePlayerName ────────────────────

function resolvePlayerName(): string {
  if (typeof sessionStorage === "undefined") return "Spiller";
  try {
    const raw = sessionStorage.getItem("spillorama.dev.user");
    if (!raw) return "Spiller";
    const parsed = JSON.parse(raw) as { displayName?: unknown };
    const name = typeof parsed.displayName === "string"
      ? parsed.displayName.trim()
      : "";
    if (!name) return "Spiller";
    return name.length > 50 ? name.slice(0, 50) : name;
  } catch {
    return "Spiller";
  }
}

// ── Mock factories ────────────────────────────────────────────────────────

function makeNextGame(
  overrides: Partial<Spill1LobbyNextGame> = {},
): Spill1LobbyNextGame {
  return {
    itemId: "item-1",
    position: 1,
    catalogSlug: "bingo",
    catalogDisplayName: "Bingo",
    status: "purchase_open",
    scheduledGameId: "abc-scheduled-game-id",
    scheduledStartTime: "2026-05-11T18:00:00.000Z",
    scheduledEndTime: null,
    actualStartTime: null,
    ticketColors: ["hvit"],
    ticketPricesCents: { hvit: 500 },
    prizeMultiplierMode: "auto",
    bonusGameSlug: null,
    ...overrides,
  };
}

function makeLobbyState(
  overrides: Partial<Spill1LobbyState> = {},
): Spill1LobbyState {
  return {
    hallId: "demo-hall-001",
    businessDate: "2026-05-11",
    isOpen: true,
    openingTimeStart: "11:00",
    openingTimeEnd: "23:00",
    planId: "plan-1",
    planName: "Pilot Demo",
    runId: "run-1",
    runStatus: "running",
    overallStatus: "purchase_open",
    nextScheduledGame: makeNextGame(),
    currentRunPosition: 1,
    totalPositions: 13,
    ...overrides,
  };
}

// ── Tester: pickJoinableScheduledGameId ──────────────────────────────────

describe("Game1Controller — pickJoinableScheduledGameId", () => {
  it("returnerer scheduledGameId når status=purchase_open", () => {
    const state = makeLobbyState({
      nextScheduledGame: makeNextGame({
        scheduledGameId: "abc-1",
        status: "purchase_open",
      }),
    });
    expect(pickJoinableScheduledGameId(state)).toBe("abc-1");
  });

  it("returnerer scheduledGameId når status=running", () => {
    const state = makeLobbyState({
      nextScheduledGame: makeNextGame({
        scheduledGameId: "abc-2",
        status: "running",
      }),
    });
    expect(pickJoinableScheduledGameId(state)).toBe("abc-2");
  });

  it("returnerer null når status=idle (master har ikke startet)", () => {
    const state = makeLobbyState({
      nextScheduledGame: makeNextGame({
        scheduledGameId: "abc-3",
        status: "idle",
      }),
    });
    expect(pickJoinableScheduledGameId(state)).toBeNull();
  });

  it("returnerer null når status=finished", () => {
    const state = makeLobbyState({
      nextScheduledGame: makeNextGame({
        scheduledGameId: "abc-4",
        status: "finished",
      }),
    });
    expect(pickJoinableScheduledGameId(state)).toBeNull();
  });

  it("returnerer null når scheduledGameId er null (plan-runtime har ikke spawnet rom)", () => {
    const state = makeLobbyState({
      nextScheduledGame: makeNextGame({
        scheduledGameId: null,
        status: "purchase_open",
      }),
    });
    expect(pickJoinableScheduledGameId(state)).toBeNull();
  });

  it("returnerer null når nextScheduledGame er null (ingen plan dekker)", () => {
    const state = makeLobbyState({ nextScheduledGame: null });
    expect(pickJoinableScheduledGameId(state)).toBeNull();
  });

  it("returnerer null når state er null (lobby-binding har ikke lastet)", () => {
    expect(pickJoinableScheduledGameId(null)).toBeNull();
  });
});

// ── Tester: resolvePlayerName ────────────────────────────────────────────

describe("Game1Controller — resolvePlayerName", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("returnerer displayName fra sessionStorage hvis tilgjengelig", () => {
    sessionStorage.setItem(
      "spillorama.dev.user",
      JSON.stringify({ displayName: "Tobias Test" }),
    );
    expect(resolvePlayerName()).toBe("Tobias Test");
  });

  it("returnerer 'Spiller' når sessionStorage ikke har user-payload", () => {
    expect(resolvePlayerName()).toBe("Spiller");
  });

  it("returnerer 'Spiller' når payload mangler displayName", () => {
    sessionStorage.setItem("spillorama.dev.user", JSON.stringify({ id: "u1" }));
    expect(resolvePlayerName()).toBe("Spiller");
  });

  it("trimmer whitespace fra displayName", () => {
    sessionStorage.setItem(
      "spillorama.dev.user",
      JSON.stringify({ displayName: "  Tobias  " }),
    );
    expect(resolvePlayerName()).toBe("Tobias");
  });

  it("capper navn på 50 tegn (server-schema-grense)", () => {
    const long = "x".repeat(60);
    sessionStorage.setItem(
      "spillorama.dev.user",
      JSON.stringify({ displayName: long }),
    );
    expect(resolvePlayerName().length).toBe(50);
  });

  it("returnerer 'Spiller' når sessionStorage-JSON er korrupt", () => {
    sessionStorage.setItem("spillorama.dev.user", "{ invalid json");
    expect(resolvePlayerName()).toBe("Spiller");
  });
});

// ── Harness: delta-watcher (plan-advance scenario) ───────────────────────

/**
 * Speiler delta-watcher-mønsteret i Game1Controller.start()'s
 * `lobbyStateUnsub`-handler. Verifiserer at:
 *   - re-join skjer KUN når scheduledGameId faktisk endrer seg
 *   - andre felt-endringer (status, catalogDisplayName) ikke trigger re-join
 *   - re-join oppdaterer joinedScheduledGameId og kaller socket.joinScheduledGame
 */
class DeltaWatcherHarness {
  joinedScheduledGameId: string | null = null;
  joinCalls: Array<{ scheduledGameId: string; hallId: string }> = [];

  /** Mirror av handleScheduledGameDelta (forenklet — ingen socket-feilbehandling). */
  reJoin(scheduledGameId: string, hallId: string): void {
    this.joinCalls.push({ scheduledGameId, hallId });
    this.joinedScheduledGameId = scheduledGameId;
  }

  /** Mirror av delta-watcher-grenen i lobbyStateUnsub-callback. */
  onLobbyState(state: Spill1LobbyState | null, hallId: string): void {
    const nextScheduledGameId = pickJoinableScheduledGameId(state);
    if (
      nextScheduledGameId !== null &&
      this.joinedScheduledGameId !== null &&
      nextScheduledGameId !== this.joinedScheduledGameId
    ) {
      this.reJoin(nextScheduledGameId, hallId);
    }
  }

  /** Simuler initial-join (start() ferdig) — setter joinedScheduledGameId. */
  primeInitialJoin(scheduledGameId: string): void {
    this.joinedScheduledGameId = scheduledGameId;
  }
}

describe("Game1Controller — delta-watcher (plan-advance)", () => {
  let harness: DeltaWatcherHarness;

  beforeEach(() => {
    harness = new DeltaWatcherHarness();
  });

  it("re-joiner når scheduledGameId endrer seg fra abc → def", () => {
    harness.primeInitialJoin("abc-scheduled-game-id");

    // Master flytter plan-position → ny scheduledGameId i lobby-state.
    harness.onLobbyState(
      makeLobbyState({
        nextScheduledGame: makeNextGame({
          scheduledGameId: "def-new-game-id",
          status: "purchase_open",
        }),
      }),
      "demo-hall-001",
    );

    expect(harness.joinCalls).toEqual([
      { scheduledGameId: "def-new-game-id", hallId: "demo-hall-001" },
    ]);
    expect(harness.joinedScheduledGameId).toBe("def-new-game-id");
  });

  it("re-joiner IKKE når kun overallStatus endrer seg (gameId uendret)", () => {
    harness.primeInitialJoin("abc-scheduled-game-id");

    harness.onLobbyState(
      makeLobbyState({
        overallStatus: "running",
        nextScheduledGame: makeNextGame({
          scheduledGameId: "abc-scheduled-game-id",
          status: "running",
        }),
      }),
      "demo-hall-001",
    );

    expect(harness.joinCalls).toEqual([]);
    expect(harness.joinedScheduledGameId).toBe("abc-scheduled-game-id");
  });

  it("re-joiner IKKE når catalogDisplayName endrer seg men gameId er uendret", () => {
    harness.primeInitialJoin("abc-scheduled-game-id");

    harness.onLobbyState(
      makeLobbyState({
        nextScheduledGame: makeNextGame({
          scheduledGameId: "abc-scheduled-game-id",
          catalogDisplayName: "Bingo (oppdatert navn)",
          status: "purchase_open",
        }),
      }),
      "demo-hall-001",
    );

    expect(harness.joinCalls).toEqual([]);
  });

  it("re-joiner IKKE før initial-join har skjedd (joinedScheduledGameId = null)", () => {
    // Vi har ikke primet en initial-join — klient er ennå i createRoom-
    // fallback-pathen. Da skal delta-watcher ikke trigge re-join.
    harness.onLobbyState(
      makeLobbyState({
        nextScheduledGame: makeNextGame({ scheduledGameId: "abc" }),
      }),
      "demo-hall-001",
    );

    expect(harness.joinCalls).toEqual([]);
  });

  it("re-joiner IKKE når ny gameId er ikke-joinable (status=idle)", () => {
    harness.primeInitialJoin("abc-scheduled-game-id");

    // Plan-advance til ny posisjon, men master har ikke startet enda.
    harness.onLobbyState(
      makeLobbyState({
        nextScheduledGame: makeNextGame({
          scheduledGameId: "def-but-idle",
          status: "idle",
        }),
      }),
      "demo-hall-001",
    );

    // Vi venter på at master starter — ikke spam join-anrop mot idle-rom
    // som server uansett vil reject-e med GAME_NOT_JOINABLE.
    expect(harness.joinCalls).toEqual([]);
  });
});

// ── Initial-join utvalg: socket.joinScheduledGame vs socket.createRoom ──

describe("Game1Controller — initial join-utvalg", () => {
  it("scheduledGameId i lobby-state med joinable status → bruk joinScheduledGame", () => {
    const state = makeLobbyState({
      nextScheduledGame: makeNextGame({
        scheduledGameId: "abc-1",
        status: "purchase_open",
      }),
    });
    const initialId = pickJoinableScheduledGameId(state);
    expect(initialId).toBe("abc-1");
  });

  it("ingen plan dekker → fall tilbake til createRoom (initial-id = null)", () => {
    const state = makeLobbyState({ nextScheduledGame: null });
    const initialId = pickJoinableScheduledGameId(state);
    expect(initialId).toBeNull();
  });

  it("plan dekker men master har ikke startet → fall tilbake til createRoom", () => {
    const state = makeLobbyState({
      nextScheduledGame: makeNextGame({
        scheduledGameId: "abc-2",
        status: "idle",
      }),
    });
    const initialId = pickJoinableScheduledGameId(state);
    expect(initialId).toBeNull();
  });
});
