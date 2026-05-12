/**
 * @vitest-environment happy-dom
 *
 * Wait-on-master-purchase gating (Agent B, 2026-05-12 — Tobias-direktiv
 * 2026-05-12, Alternativ B).
 *
 * Bakgrunn:
 *   Tobias' pilot-test 2026-05-12 11:03-11:05: armed 4 bonger som spiller
 *   (4 × 5 kr = 160 kr) → master klikket Start → spillet kjørte 75 baller
 *   med `MyTickets: 0` — bongene "forsvant" fra HUD. Saldo redusert med
 *   160 kr (server hadde mottatt bet:arm), men ingen DB-rad i
 *   `app_game1_ticket_purchases` ble opprettet for noen av brettene.
 *
 *   Root cause (todelt):
 *     1. Backend: `GamePlanEngineBridge.createScheduledGameForPlanRunPosition`
 *        feilet med 23505 hvis stale aktiv rad allerede holdt room_code →
 *        bridge degraderte til lazy-binding (room_code=NULL). Klient
 *        kunne ikke joine fordi `io.to(NULL)` ikke broadcast-er. Armed
 *        tickets ble foreldreløse fordi server aldri konverterte dem til
 *        `app_game1_ticket_purchases`. (Fixed av Agent A, PR #1253.)
 *     2. Klient (denne fixen): klient sendte `bet:arm` (in-memory armed-
 *        state) FØR scheduled-game var spawnet av bridge. Selv etter
 *        Agent A's fix kunne armed-tickets bli foreldreløse hvis bridge
 *        spawnet ny scheduled-game-rad uten å vite om eksisterende
 *        armed-set.
 *
 *   Alternativ B (denne fixen): klient venter med kjøp til
 *   scheduled-game er spawned. Knapper disables med "Venter på master,
 *   kjøp åpner snart"-tekst. BuyPopup auto-open blokkeres.
 *
 * Tester:
 *   Pure-funksjons-mirror av decision-logikken i PlayScreen + Game1Controller.
 *   Speiler `pickJoinableScheduledGameId(state)` + auto-show-gate.
 *   Følger samme pattern som `PlayScreen.countdownGating.test.ts` —
 *   ingen Pixi/DOM-instansiering, kun ren state→decision-mapping.
 */
import { describe, it, expect } from "vitest";
import type {
  Spill1LobbyNextGame,
  Spill1LobbyOverallStatus,
} from "@spillorama/shared-types/api";

interface PurchaseGatingInputs {
  nextScheduledGame: Spill1LobbyNextGame | null;
}

/**
 * Pure-function mirror av `pickJoinableScheduledGameId(state)` i
 * Game1Controller.ts. Hvis production-koden drifter, oppdater også denne —
 * kontrakten er at klient bare tillater purchase når scheduled-game faktisk
 * er joinable.
 */
function decidePurchaseAllowed(inputs: PurchaseGatingInputs): boolean {
  const next = inputs.nextScheduledGame;
  if (!next) return false;
  if (!next.scheduledGameId) return false;
  if (
    next.status !== "purchase_open" &&
    next.status !== "ready_to_start" &&
    next.status !== "running" &&
    next.status !== "paused"
  ) {
    return false;
  }
  return true;
}

function makeNextScheduledGame(
  overrides: Partial<Spill1LobbyNextGame> = {},
): Spill1LobbyNextGame {
  return {
    itemId: "item-1",
    position: 1,
    catalogSlug: "bingo",
    catalogDisplayName: "Bingo",
    status: "purchase_open" as Spill1LobbyOverallStatus,
    scheduledGameId: "sg-1",
    scheduledStartTime: null,
    scheduledEndTime: null,
    actualStartTime: null,
    ticketColors: ["hvit", "gul", "lilla"],
    ticketPricesCents: { hvit: 500, gul: 1000, lilla: 1500 },
    prizeMultiplierMode: "auto",
    bonusGameSlug: null,
    ...overrides,
  };
}

describe("PlayScreen wait-on-master-purchase gating (Alternativ B)", () => {
  // ── Pre-fix scenarier: kjøp skal IKKE være tillatt ─────────────────────

  it("nextScheduledGame=null → purchase disabled (ingen plan dekker)", () => {
    const allowed = decidePurchaseAllowed({ nextScheduledGame: null });
    expect(allowed).toBe(false);
  });

  it("scheduledGameId=null → purchase disabled (bridge har ikke spawnet runden)", () => {
    const allowed = decidePurchaseAllowed({
      nextScheduledGame: makeNextScheduledGame({ scheduledGameId: null }),
    });
    expect(allowed).toBe(false);
  });

  it("status=idle → purchase disabled (lobby venter mellom runder)", () => {
    const allowed = decidePurchaseAllowed({
      nextScheduledGame: makeNextScheduledGame({
        scheduledGameId: "sg-1",
        status: "idle",
      }),
    });
    expect(allowed).toBe(false);
  });

  it("status=closed → purchase disabled (ingen aktiv plan eller utenfor åpningstid)", () => {
    const allowed = decidePurchaseAllowed({
      nextScheduledGame: makeNextScheduledGame({
        scheduledGameId: "sg-1",
        status: "closed",
      }),
    });
    expect(allowed).toBe(false);
  });

  it("status=finished → purchase disabled (spilleplan ferdig for dagen)", () => {
    const allowed = decidePurchaseAllowed({
      nextScheduledGame: makeNextScheduledGame({
        scheduledGameId: "sg-1",
        status: "finished",
      }),
    });
    expect(allowed).toBe(false);
  });

  // ── Joinable statuser: kjøp tillates ───────────────────────────────────

  it("status=purchase_open + scheduledGameId → purchase ALLOWED", () => {
    const allowed = decidePurchaseAllowed({
      nextScheduledGame: makeNextScheduledGame({
        scheduledGameId: "sg-1",
        status: "purchase_open",
      }),
    });
    expect(allowed).toBe(true);
  });

  it("status=ready_to_start → purchase ALLOWED (siste sjanse før master starter)", () => {
    const allowed = decidePurchaseAllowed({
      nextScheduledGame: makeNextScheduledGame({
        scheduledGameId: "sg-1",
        status: "ready_to_start",
      }),
    });
    expect(allowed).toBe(true);
  });

  it("status=running → purchase ALLOWED (forhåndskjøp til NESTE planlagte spill)", () => {
    // Mid-round forhåndskjøp: server tillater kjøp av brett til neste
    // posisjon i spilleplanen mens nåværende runde fortsatt kjører. UI-
    // siden av dette er at "Kjøp flere brett"-knappen disables under
    // RUNNING (setGameRunning), men "Forhåndskjøp til dagens spill" er
    // synlig.
    const allowed = decidePurchaseAllowed({
      nextScheduledGame: makeNextScheduledGame({
        scheduledGameId: "sg-1",
        status: "running",
      }),
    });
    expect(allowed).toBe(true);
  });

  it("status=paused → purchase ALLOWED (master pauset midt i runde)", () => {
    const allowed = decidePurchaseAllowed({
      nextScheduledGame: makeNextScheduledGame({
        scheduledGameId: "sg-1",
        status: "paused",
      }),
    });
    expect(allowed).toBe(true);
  });

  // ── Edge-cases ─────────────────────────────────────────────────────────

  it("master starter: idle → purchase_open → kjøp aktiveres", () => {
    const before = decidePurchaseAllowed({
      nextScheduledGame: makeNextScheduledGame({
        scheduledGameId: "sg-1",
        status: "idle",
      }),
    });
    expect(before).toBe(false);

    // Bridge spawner scheduled-game, status flippes til purchase_open
    const after = decidePurchaseAllowed({
      nextScheduledGame: makeNextScheduledGame({
        scheduledGameId: "sg-1",
        status: "purchase_open",
      }),
    });
    expect(after).toBe(true);
  });

  it("regresjon-vakt: empty string scheduledGameId → falsy → disabled", () => {
    // TypeScript-signaturen tillater string|null, men ved JSON-deserialisering
    // kan empty-string slippe gjennom hvis backend har en bug. Gating-logikken
    // skal være defensive — empty-string er ikke en valid id.
    const allowed = decidePurchaseAllowed({
      nextScheduledGame: makeNextScheduledGame({
        scheduledGameId: "",
        status: "purchase_open",
      }),
    });
    expect(allowed).toBe(false);
  });

  it("statuser som ikke er i Spill1LobbyOverallStatus-enum → disabled (defensiv)", () => {
    // Speiler whitelist-pattern i pickJoinableScheduledGameId. Server kan
    // teoretisk sende en ukjent status hvis backend-skjema utvides uten
    // klient-bumping. Klient skal være konservativ og disable purchase.
    const allowed = decidePurchaseAllowed({
      nextScheduledGame: makeNextScheduledGame({
        scheduledGameId: "sg-1",
        // @ts-expect-error — tester runtime-safety mot future-extended enum
        status: "unknown_future_status",
      }),
    });
    expect(allowed).toBe(false);
  });
});
