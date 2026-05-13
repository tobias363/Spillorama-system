import { expect, test } from "@playwright/test";
import {
  autoLogin,
  getLobbyState,
  markHallReady,
  masterStart,
  masterStop,
} from "./helpers/rest.js";
import {
  adminDrawNext,
  getGameStateSnapshot,
  masterPause,
  masterResume,
  resetPilotStateExt,
} from "./helpers/rad-vinst-helpers.js";

/**
 * Spill 1 Rad-vinst-flow E2E test (Tobias-direktiv 2026-05-13).
 *
 * Utvidelse av `spill1-pilot-flow.spec.ts` som dekker B-fase 2c (Rad-vinst +
 * Fortsett til neste rad/fase). Eksisterende test stopper etter buy-flow og
 * `ready_to_start`-state. Denne testen plukker opp tråden: starter runden,
 * trekker baller, verifiserer Rad-vinst, og kjører master Fortsett (pause +
 * resume).
 *
 * Hvorfor pause/resume og IKKE advance:
 *   - Spill 1 har Rad 1-4 + Fullt Hus innenfor SAMME scheduled-game (én plan-
 *     posisjon). Engine auto-pauser ETTER hver rad-vinst, og master må trykke
 *     "Fortsett" (= REST `/master/resume`) for å fortsette til neste rad.
 *   - Demo-hall-001 har `is_test_hall=TRUE` som BYPASSER auto-pause, så vi
 *     emulerer master-Fortsett-flyten via manuell `masterPause` + `masterResume`
 *     for å verifisere at REST-endpoint-ene fungerer og `scheduledGameId`
 *     preserveres på tvers av pause/resume.
 *   - `masterAdvance` er for å gå til NESTE plan-posisjon (eks. `bingo` →
 *     `kvikkis`) og hører ikke hjemme i en single-runde-test.
 *
 * Test-progresjon:
 *   1.  (REST) Auto-login master + admin + spiller
 *   2.  (REST) Reset pilot-state (destroyRooms: true så vi starter rent)
 *   3.  (REST) Mark hall ready → lazy-spawner scheduled-game
 *   4.  (REST) Master start → status=running
 *   5.  (UI)   Spiller åpner klient, klikker Bingo-tile, kjøper 12 brett
 *   6.  (UI)   Verifiser 6 cards rendret i ticket-grid (12 brett representert)
 *   7.  (REST) Trekk baller manuelt via `adminDrawNext` (raskere enn auto-tick)
 *             til Rad 1-vinst registreres
 *   8.  (UI)   Verifiser WinPopup (`data-test="win-popup-backdrop"`) ELLER
 *             engine-snapshot claimsCount > 0
 *   9.  (REST) Master Pause (engine.paused=true, draws stopper)
 *   10. (REST) Verifiser `scheduledGameId` uendret (samme runde)
 *   11. (REST) Master Resume / "Fortsett" → status=running igjen
 *   12. (REST) Verifiser SAMME `scheduledGameId` (ingen ny spawnet)
 *   13. (REST) Trekk videre til Rad 2-vinst
 *   14. (REST) Verifiser claimsCount økte ELLER game ended
 *   15. (Cleanup) masterStop (non-destructive — beholder rom)
 *
 * Forutsetning: `dev:all` kjører på port 4000 med `ENABLE_BUY_DEBUG=1`.
 *
 * Kjør:
 *   npx playwright test --config=tests/e2e/playwright.config.ts spill1-rad-vinst-flow
 *
 * NB: Demo-spillere har default 900 kr/dag tapsgrense. Vi roterer mellom
 * `demo-pilot-spiller-1..12` for å unngå at gjentatte test-kjøringer brenner
 * gjennom samme spiller.
 */

const MASTER_EMAIL = "demo-agent-1@spillorama.no";
const HALL_ID = "demo-hall-001";
const ADMIN_EMAIL = "tobias@nordicprofil.no";
const ROOM_CODE = "BINGO_DEMO-PILOT-GOH";

/**
 * Hent demo-spiller med ledig dagsgrense. Identisk implementasjon med
 * `spill1-pilot-flow.spec.ts`-helperen — kopiert hit for å unngå cross-test-
 * import-coupling (hver test-file er selvstendig).
 */
async function pickAvailablePlayer(): Promise<string> {
  for (let n = 1; n <= 12; n += 1) {
    const email = `demo-pilot-spiller-${n}@example.com`;
    try {
      const res = await fetch(
        `http://localhost:4000/api/dev/auto-login?email=${encodeURIComponent(email)}`,
      );
      if (!res.ok) continue;
      const body = (await res.json()) as {
        ok: boolean;
        data?: { accessToken: string };
      };
      if (!body.ok || !body.data) continue;
      const complianceRes = await fetch(
        `http://localhost:4000/api/wallet/me/compliance?hallId=${encodeURIComponent(
          HALL_ID,
        )}`,
        {
          headers: { Authorization: `Bearer ${body.data.accessToken}` },
        },
      );
      if (!complianceRes.ok) continue;
      const compliance = (await complianceRes.json()) as {
        ok: boolean;
        data?: {
          netLoss?: { daily?: number };
          regulatoryLossLimits?: { daily?: number };
          restrictions?: { isBlocked?: boolean };
        };
      };
      if (!compliance.ok || !compliance.data) continue;
      if (compliance.data.restrictions?.isBlocked) continue;
      const used = compliance.data.netLoss?.daily ?? 0;
      const limit = compliance.data.regulatoryLossLimits?.daily ?? 900;
      const remaining = limit - used;
      if (remaining >= 200) {
        console.log(
          `[pickAvailablePlayer] Selected ${email} (used=${used}, remaining=${remaining})`,
        );
        return email;
      }
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "Ingen demo-spiller har ledig dagsgrense. Vent til neste dag eller `npm run dev:nuke` for reseed.",
  );
}

/**
 * Forventet pris-tabell — speil av `spill1-pilot-flow.spec.ts` (kanonisk
 * kilde). Hvis Tobias endrer ticket-prising må også her oppdateres.
 */
interface ExpectedRow {
  testSlug: string;
  bundlePriceKr: number;
  perBrettPriceKr: number;
  ticketCount: number;
}

const EXPECTED_ROWS: ExpectedRow[] = [
  { testSlug: "small-white", bundlePriceKr: 5, perBrettPriceKr: 5, ticketCount: 1 },
  { testSlug: "large-white", bundlePriceKr: 15, perBrettPriceKr: 5, ticketCount: 3 },
  { testSlug: "small-yellow", bundlePriceKr: 10, perBrettPriceKr: 10, ticketCount: 1 },
  { testSlug: "large-yellow", bundlePriceKr: 30, perBrettPriceKr: 10, ticketCount: 3 },
  { testSlug: "small-purple", bundlePriceKr: 15, perBrettPriceKr: 15, ticketCount: 1 },
  { testSlug: "large-purple", bundlePriceKr: 45, perBrettPriceKr: 15, ticketCount: 3 },
];

const EXPECTED_TOTAL_BRETT = EXPECTED_ROWS.reduce(
  (sum, r) => sum + r.ticketCount,
  0,
);

/**
 * Maks antall draws vi trekker per fase. Med 12 brett × 5 rader = 60 row-
 * muligheter, sannsynlighet at minst ett brett har 5/5 på en rad innen 25
 * draws er > 95%. 35 gir solid margin for å unngå flakiness.
 */
const MAX_DRAWS_TO_RAD1 = 35;
const MAX_DRAWS_TO_RAD2 = 30;

test.describe("Spill 1 Rad-vinst-flow", () => {
  test.describe.configure({ mode: "serial" });

  let masterToken: string;
  let adminToken: string;
  let playerEmail: string;
  let initialScheduledGameId: string;

  test.beforeAll(async () => {
    // 1. Auto-login master + admin (admin trengs for /api/admin/rooms/.../draw-next).
    const master = await autoLogin(MASTER_EMAIL);
    masterToken = master.accessToken;
    expect(master.hallId, "Master må være tilknyttet pilot-hall").toBe(HALL_ID);

    const admin = await autoLogin(ADMIN_EMAIL);
    adminToken = admin.accessToken;

    // 2. Hard-reset state (destroyRooms: true for fersh start)
    await resetPilotStateExt(masterToken, { destroyRooms: true });

    // 3. Pick available player
    playerEmail = await pickAvailablePlayer();
  });

  test.afterAll(async () => {
    // Non-destructive cleanup — bare masterStop, la rom stå urørt så
    // andre tester kan re-bruke det.
    if (masterToken) {
      await masterStop(masterToken, "rad-vinst-test afterAll cleanup").catch(
        () => {
          /* ignore */
        },
      );
    }
  });

  test("master + spiller + master Fortsett-flyt for Rad 1 → Rad 2", async ({
    page,
  }) => {
    // ── Steg 3: Mark master-hall ready ─────────────────────────────────────
    // Rekkefølge: ready → spiller buy → masterStart → trekk baller.
    // I `ready_to_start`-state kan spilleren kjøpe bonger som rendres i grid
    // umiddelbart (preRoundTickets). Master start konverterer preRoundTickets
    // til faktiske ticket-purchases og engine begynner å akseptere draws.
    const ready = await markHallReady(masterToken, HALL_ID);
    initialScheduledGameId = ready.gameId;
    expect(initialScheduledGameId, "scheduled-game must spawn").toBeTruthy();

    // Verifiser lobby er purchase-open
    const preStartLobby = await getLobbyState(masterToken, HALL_ID);
    expect(
      ["ready_to_start", "purchase_open"],
      "scheduled-game må være kjøps-åpen før klient buyer",
    ).toContain(preStartLobby.scheduledGameMeta?.status ?? "");

    // ── Steg 4: Spiller åpner klient + kjøper 12 brett (FØR master start) ──
    page.on("console", (msg) => {
      const text = msg.text();
      if (
        text.startsWith("[BUY-DEBUG]") ||
        text.startsWith("[Game1") ||
        text.includes("pattern_won") ||
        text.includes("pattern:won") ||
        text.includes("error") ||
        text.includes("ALREADY_IN_ROOM")
      ) {
        console.log(`[client.${msg.type()}] ${text}`);
      }
    });
    page.on("pageerror", (err) => {
      console.error(`[client.pageerror] ${err.message}`);
    });

    const player = await autoLogin(playerEmail);
    await page.goto("/web/");
    await page.evaluate(
      ({ token, user, hall }) => {
        sessionStorage.setItem("spillorama.accessToken", token);
        sessionStorage.setItem("spillorama.user", JSON.stringify(user));
        sessionStorage.setItem("lobby.activeHallId", hall);
      },
      {
        token: player.accessToken,
        user: {
          id: player.userId,
          email: player.email,
          hallId: player.hallId,
        },
        hall: HALL_ID,
      },
    );
    await page.goto("/web/?debug=1");

    const bingoTile = page.locator('[data-slug="bingo"]').first();
    await expect(bingoTile, "Bingo-tile skal vises i lobby").toBeVisible({
      timeout: 20_000,
    });
    await expect(
      bingoTile,
      "Bingo-tile må være enabled (compliance lastet)",
    ).toBeEnabled({ timeout: 15_000 });
    await bingoTile.click();
    await expect(
      page.locator("#web-game-container"),
      "web-game-container skal bli synlig",
    ).toBeVisible({ timeout: 15_000 });

    const popup = page.locator('[data-test="buy-popup-backdrop"]');
    await expect(popup, "Buy-popup skal mounte").toBeVisible({
      timeout: 30_000,
    });

    // Klikk + på hver rad (kjøp 1 av hver = 6 bonger / 12 brett)
    for (const row of EXPECTED_ROWS) {
      const plusBtn = page.locator(`[data-test="buy-popup-plus-${row.testSlug}"]`);
      await plusBtn.click();
    }

    // Bekreft kjøp
    const buyBtn = page.locator('[data-test="buy-popup-confirm"]');
    await expect(buyBtn).toBeEnabled();
    await buyBtn.click();

    // Vent på at popup lukker seg
    await expect(
      page.locator('[data-test="buy-popup-backdrop"]'),
      "Popup skal lukke seg etter kjøp",
    ).toBeHidden({ timeout: 10_000 });

    // ── Steg 6: Verifiser 6 cards rendret ─────────────────────────────────
    // Backend lagrer ÉN ticket-card per spec-entry — Stor representeres som 1
    // card men "telles" som 3 brett. Vi får derfor 6 cards (1 per bongfarge).
    // 12-brett-telling er kun i popup-totalen.
    const ticketCards = page.locator('[data-test="ticket-card"]');
    await expect(
      ticketCards,
      "Grid skal vise 6 cards (1 per spec-entry, 12 brett representert)",
    ).toHaveCount(EXPECTED_ROWS.length, { timeout: 15_000 });

    console.log(
      `[test] ✓ Buy-flow ferdig: ${EXPECTED_TOTAL_BRETT} brett representert som ${EXPECTED_ROWS.length} cards`,
    );

    // ── Steg 7: Master start → status=running ──────────────────────────────
    // Nå er spilleren satt opp med 12 brett i grid (preRoundTickets). Master
    // starter runden, engine konverterer preRoundTickets til ticket-purchases,
    // og draw-next-calls begynner å fungere mot engine.
    console.log("[test] Master start (etter buy)...");
    const started = await masterStart(masterToken);
    expect(started.status, "plan-run skal være running etter start").toBe(
      "running",
    );
    expect(
      started.scheduledGameId,
      "scheduledGameId fra start må matche ready.gameId",
    ).toBe(initialScheduledGameId);
    expect(
      started.scheduledGameStatus,
      "scheduled-game-status etter start skal være running",
    ).toBe("running");

    // Optional snapshot-diagnose (krever RESET_TEST_PLAYERS_TOKEN)
    const startSnapshot = await getGameStateSnapshot(ROOM_CODE);
    if (startSnapshot) {
      console.log(
        `[test] Snapshot etter start: status=${startSnapshot.engineRoom?.currentGame?.status ?? "n/a"}, drawn=${startSnapshot.engineRoom?.currentGame?.drawnCount ?? "n/a"}`,
      );
    } else {
      console.log(
        "[test] Snapshot-route ikke tilgjengelig (RESET_TEST_PLAYERS_TOKEN ikke satt)",
      );
    }

    // ── Steg 8: Trekk baller manuelt til Rad 1-vinst ───────────────────────
    // Bruker admin/draw-next istedenfor å vente på auto-tick (4s/draw).
    // Med 12 tickets × 5 rader = 60 row-muligheter er sannsynlighet at minst
    // én rad har 5/5 innen 25 draws ~95%. Vi trekker opptil MAX_DRAWS_TO_RAD1
    // for solid margin.
    console.log("[test] Starter å trekke baller manuelt mot Rad 1-vinst...");

    let rad1WonAtDraw: number | null = null;
    let rad1ClaimsCount = 0;

    // WinPopup-locator. Klient viser denne KUN hvis player er vinner (isMe).
    // Vi har ingen garanti for at testspiller vinner (12 brett av spill med
    // mange potensielle vinnere), så fallback er engine-snapshot claims-count.
    const winPopupLocator = page.locator('[data-test="win-popup-backdrop"]');

    for (let drawIdx = 1; drawIdx <= MAX_DRAWS_TO_RAD1; drawIdx++) {
      let drawResult: { number: number; drawIndex: number } | null = null;
      try {
        drawResult = await adminDrawNext(adminToken, ROOM_CODE);
      } catch (err) {
        // Hvis runden er ferdig (DRAW_BAG_EXHAUSTED eller GAME_FINISHED)
        const snap = await getGameStateSnapshot(ROOM_CODE);
        if (snap?.engineRoom?.currentGame?.status === "ENDED") {
          console.log(
            `[test] Runde endet ved draw ${drawIdx}: ${(err as Error).message}`,
          );
          break;
        }
        throw err;
      }
      console.log(
        `[test] Draw ${drawIdx}/${MAX_DRAWS_TO_RAD1}: ball=${drawResult.number}, drawIndex=${drawResult.drawIndex}`,
      );

      // Vent litt på at pattern-eval + socket-emit kjører
      await new Promise((r) => setTimeout(r, 150));

      // Detect via WinPopup (spiller vinner)
      const popupVisible = await winPopupLocator
        .isVisible({ timeout: 50 })
        .catch(() => false);
      if (popupVisible) {
        rad1WonAtDraw = drawResult.drawIndex;
        console.log(
          `[test] ✓ WinPopup detected at draw ${drawIdx}, drawIndex=${rad1WonAtDraw}`,
        );
        break;
      }

      // Detect via engine-snapshot (annen spiller vinner — også gyldig)
      const snap = await getGameStateSnapshot(ROOM_CODE);
      const claims = snap?.engineRoom?.currentGame?.claimsCount ?? 0;
      if (claims > 0) {
        rad1WonAtDraw = drawResult.drawIndex;
        rad1ClaimsCount = claims;
        console.log(
          `[test] ✓ Snapshot detected ${claims} claims at draw ${drawIdx} — Rad-vinst registrert`,
        );
        break;
      }

      // Stop hvis runden ender (eks. Fullt Hus med få trekk)
      const status = snap?.engineRoom?.currentGame?.status;
      if (status === "ENDED") {
        console.log(
          `[test] Runde endet ved draw ${drawIdx} (status=ENDED, reason=${snap?.engineRoom?.currentGame?.endedReason})`,
        );
        break;
      }
    }

    expect(
      rad1WonAtDraw,
      `Rad 1 (eller annen pattern) må vinnes innen ${MAX_DRAWS_TO_RAD1} draws (med 12 brett × 5 rader skal det skje med > 95% sannsynlighet). Hvis dette feiler er det enten flaks-problem eller engine pattern-eval er broken — sjekk Game1DrawEngineService.`,
    ).not.toBeNull();

    // ── Steg 8: Verifiser WinPopup-innhold (hvis synlig) ───────────────────
    if (await winPopupLocator.isVisible({ timeout: 100 }).catch(() => false)) {
      const rowsAttr = await winPopupLocator.getAttribute("data-test-win-rows");
      const amountAttr = await winPopupLocator.getAttribute("data-test-win-amount");
      const sharedAttr = await winPopupLocator.getAttribute("data-test-win-shared");
      console.log(
        `[test] WinPopup attrs: rows=${rowsAttr}, amount=${amountAttr}, shared=${sharedAttr}`,
      );
      expect(
        Number(rowsAttr),
        "rows skal være 1 (Rad 1 er første pattern engine evaluerer)",
      ).toBe(1);
      expect(
        Number(amountAttr),
        "amount må være positivt (Rad 1 = base × bong-multiplier)",
      ).toBeGreaterThan(0);
    } else {
      // Player var IKKE vinneren — verifiser via engine-snapshot
      const snap = await getGameStateSnapshot(ROOM_CODE);
      expect(
        snap?.engineRoom?.currentGame?.claimsCount ?? 0,
        "Minst én claim må eksistere (selv om vinneren ikke er current player)",
      ).toBeGreaterThan(0);
      console.log(
        "[test] WinPopup ikke synlig — spilleren var ikke vinner. Verifisert via claims-count.",
      );
    }

    // Vent på at WinPopup lukker seg auto (4s) før vi fortsetter med pause
    if (await winPopupLocator.isVisible({ timeout: 100 }).catch(() => false)) {
      await winPopupLocator
        .waitFor({ state: "hidden", timeout: 8_000 })
        .catch(() => {
          console.log(
            "[test] WinPopup lukket ikke seg auto innen 8s — fortsetter likevel",
          );
        });
    }

    // ── Steg 9: Master Pause ──────────────────────────────────────────────
    // Demo-hall-001 (is_test_hall=TRUE) bypasses engine auto-pause etter
    // rad-vinst, så vi simulerer master-Fortsett-flyten via manuell pause +
    // resume. Verifiserer at REST-endpoint-ene fungerer og scheduledGameId
    // preserveres.
    console.log("[test] Kaller masterPause...");
    const paused = await masterPause(masterToken, "rad-vinst-test pause");
    expect(paused.status, "plan-run skal være paused etter pause").toBe(
      "paused",
    );
    expect(
      paused.scheduledGameId,
      "scheduledGameId må preserveres på tvers av pause",
    ).toBe(initialScheduledGameId);
    console.log("[test] ✓ Master pause OK, scheduledGameId preservert");

    // Verifiser via lobby-state-aggregator
    const lobbyAfterPause = await getLobbyState(masterToken, HALL_ID);
    expect(
      lobbyAfterPause.planMeta?.planRunStatus,
      "lobby-aggregator skal vise paused",
    ).toBe("paused");
    expect(
      lobbyAfterPause.currentScheduledGameId,
      "currentScheduledGameId via lobby må fortsatt være samme",
    ).toBe(initialScheduledGameId);

    // ── Steg 10: Master Resume / "Fortsett" ────────────────────────────────
    console.log("[test] Kaller masterResume (Fortsett)...");
    const resumed = await masterResume(masterToken);
    expect(resumed.status, "plan-run skal være running etter resume").toBe(
      "running",
    );
    expect(
      resumed.scheduledGameId,
      "scheduledGameId må fortsatt være samme etter resume (SAMME runde)",
    ).toBe(initialScheduledGameId);
    expect(
      resumed.scheduledGameStatus,
      "scheduled-game-status skal være running etter resume",
    ).toBe("running");
    console.log(
      "[test] ✓ Master resume OK, scheduledGameId preservert gjennom pause/resume",
    );

    // Verifiser at samme runde fortsetter — IKKE ny scheduled-game
    const lobbyAfterResume = await getLobbyState(masterToken, HALL_ID);
    expect(
      lobbyAfterResume.currentScheduledGameId,
      "Samme scheduledGameId etter resume — ingen ny scheduled-game spawnet",
    ).toBe(initialScheduledGameId);

    // ── Steg 11: Trekk videre til Rad 2-vinst ──────────────────────────────
    console.log("[test] Trekker videre til Rad 2-vinst (eller annen ny pattern)...");

    let rad2WonAtDraw: number | null = null;
    const snapBeforeRad2 = await getGameStateSnapshot(ROOM_CODE);
    const claimsBeforeRad2 =
      snapBeforeRad2?.engineRoom?.currentGame?.claimsCount ?? rad1ClaimsCount;
    console.log(
      `[test] Før Rad 2: drawn=${snapBeforeRad2?.engineRoom?.currentGame?.drawnCount ?? "n/a"}, claims=${claimsBeforeRad2}`,
    );

    for (let drawIdx = 1; drawIdx <= MAX_DRAWS_TO_RAD2; drawIdx++) {
      let drawResult: { number: number; drawIndex: number } | null = null;
      try {
        drawResult = await adminDrawNext(adminToken, ROOM_CODE);
      } catch (err) {
        const snap = await getGameStateSnapshot(ROOM_CODE);
        if (snap?.engineRoom?.currentGame?.status === "ENDED") {
          console.log(
            `[test] Runde endet ved Rad 2-draw ${drawIdx}: ${(err as Error).message}`,
          );
          break;
        }
        throw err;
      }
      console.log(
        `[test] Rad2-draw ${drawIdx}/${MAX_DRAWS_TO_RAD2}: ball=${drawResult.number}, drawIndex=${drawResult.drawIndex}`,
      );

      await new Promise((r) => setTimeout(r, 150));

      const snap = await getGameStateSnapshot(ROOM_CODE);
      const currentClaims = snap?.engineRoom?.currentGame?.claimsCount ?? 0;
      if (currentClaims > claimsBeforeRad2) {
        rad2WonAtDraw = drawResult.drawIndex;
        console.log(
          `[test] ✓ Rad 2 vunnet ved draw ${drawIdx}, claims gikk fra ${claimsBeforeRad2} → ${currentClaims}`,
        );
        break;
      }

      const status = snap?.engineRoom?.currentGame?.status;
      if (status === "ENDED") {
        console.log(
          `[test] Runde ferdig ved draw ${drawIdx}, status=ENDED, reason=${snap?.engineRoom?.currentGame?.endedReason ?? "n/a"}`,
        );
        // Hvis runden er ENDED med flere claims enn før-Rad-2, regn det som
        // "Rad 2 (eller senere fase) vunnet" — vi gikk direkte til Fullt Hus
        // eller multiple faser i ett trekk.
        if (currentClaims > claimsBeforeRad2) {
          rad2WonAtDraw = drawResult.drawIndex;
        }
        break;
      }
    }

    expect(
      rad2WonAtDraw,
      `Rad 2 (eller senere fase) må vinnes innen ${MAX_DRAWS_TO_RAD2} draws etter Rad 1. Hvis dette feiler er det enten flaks eller engine pattern-eval er broken — sjekk PatternCycler og Game1DrawEngineHelpers.`,
    ).not.toBeNull();

    console.log("[test] ✓ HELE FLYTEN GRØNN — Rad 1 + Pause/Resume + Rad 2");
  });
});
