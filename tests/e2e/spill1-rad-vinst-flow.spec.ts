import { expect, test } from "@playwright/test";
import {
  autoLogin,
  getLobbyState,
  markHallReady,
  masterStart,
  openPurchaseWindow,
  masterStop,
} from "./helpers/rest.js";
import {
  getGameDetail,
  masterPause,
  masterResume,
  resetPilotStateExt,
  scheduledDrawNext,
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
 *   3.  (REST) Master åpner purchase_open-vindu uten å starte trekning
 *   4.  (UI)   Spiller åpner klient, klikker Bingo-tile, kjøper 12 brett
 *   5.  (REST) Mark hall ready + master start → status=running
 *   6.  (UI)   Verifiser 12 cards rendret i ticket-grid (1 per brett)
 *   7.  (REST) Trekk scheduled-game-baller eksplisitt via test-only
 *             `e2e-draw-next` til Rad 1-vinst registreres
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
 * Maks antall draws trekkes inline per fase. 75 kuler dekker hele B1-B75-
 * rommet og gjør testen deterministisk nok uten å lene seg på auto-tick-jobs.
 */

test.describe("Spill 1 Rad-vinst-flow", () => {
  test.describe.configure({ mode: "serial" });

  let masterToken: string;
  let playerEmail: string;
  let initialScheduledGameId: string;

  test.beforeAll(async () => {
    // 1. Auto-login master. Samme token brukes til test-only scheduled draws,
    //    slik at hall-scope og GAME1_MASTER_WRITE håndheves også i CI.
    const master = await autoLogin(MASTER_EMAIL);
    masterToken = master.accessToken;
    expect(master.hallId, "Master må være tilknyttet pilot-hall").toBe(HALL_ID);

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
    // Pilot-flow CI kjører med JOBS_ENABLED=false. Testen driver derfor draws
    // eksplisitt via scheduledDrawNext i stedet for å vente på auto-tick.
    test.setTimeout(300_000);

    // ── Steg 3: Åpne kjøpsvindu uten å starte trekning ────────────────────
    // Rekkefølge etter two-step master-flyt:
    // masterStart(purchase_open) → spiller buy → markHallReady → masterStart(running).
    // `markHallReady` FØR buy stenger salget for hallen.
    const opened = await openPurchaseWindow(masterToken);
    initialScheduledGameId = opened.scheduledGameId;
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

    // ── Steg 6: Verifiser 12 cards rendret ────────────────────────────────
    // Klienten rendrer én ticket-card per faktisk brett. Stor-bonger gir
    // derfor 3 cards hver, ikke én samlet spec-entry.
    const ticketCards = page.locator('[data-test="ticket-card"]');
    await expect(
      ticketCards,
      "Grid skal vise 12 cards (1 per faktisk brett)",
    ).toHaveCount(EXPECTED_TOTAL_BRETT, { timeout: 15_000 });

    console.log(
      `[test] ✓ Buy-flow ferdig: ${EXPECTED_TOTAL_BRETT} brett rendret som ${EXPECTED_TOTAL_BRETT} cards`,
    );

    // ── Steg 7: Master start → status=running ──────────────────────────────
    // Nå er spilleren satt opp med 12 brett i grid (preRoundTickets). Master
    // starter runden, engine konverterer preRoundTickets til ticket-purchases,
    // og draw-next-calls begynner å fungere mot engine.
    console.log("[test] Master start (etter buy)...");
    await markHallReady(masterToken, HALL_ID);
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
    const startDetail = await getGameDetail(masterToken, initialScheduledGameId);
    console.log(
      `[test] Etter start: gameStatus=${startDetail?.game.status ?? "n/a"}, drawsCompleted=${startDetail?.engineState?.drawsCompleted ?? "n/a"}, currentPhase=${startDetail?.engineState?.currentPhase ?? "n/a"}`,
    );

    // ── Steg 8: Trekk eksplisitt til Rad 1-vinst ───────────────────────────
    // Pilot-flow workflow har JOBS_ENABLED=false for å holde CI deterministisk.
    // Derfor bruker testen en test-only scheduled draw-driver i stedet for
    // game1-auto-draw-tick.
    //
    // Etter hvert eksplisitte draw sjekker vi enten:
    //   - winPopup på klient (spilleren er vinner)
    //   - claimsCount > 0 i engine-snapshot (annen spiller er vinner)
    //   - game.status = ENDED (runde ferdig, sjekk om claims registrert)
    //
    // Vi trekker maks 75 kuler. Hvis phase aldri øker fra 1 er enten
    // pattern-eval, ticket-assignment eller scheduled draw-driver broken.
    console.log("[test] Trekker scheduled draws mot Rad 1-vinst...");

    let rad1WonAtDraw: number | null = null;
    let rad1Phase: number | null = null;
    const winPopupLocator = page.locator('[data-test="win-popup-backdrop"]');

    const RAD1_MAX_DRAWS = 75;
    let lastDrawnCount = 0;
    let lastPhase = 1;

    // Primær state-source: /api/admin/game1/games/<id> som har
    // engineState.drawsCompleted + currentPhase. currentPhase går fra 1 → 2
    // etter Rad 1 vinnes, så vi detekterer rad-vinst via phase-advance.
    for (let attempt = 0; attempt < RAD1_MAX_DRAWS; attempt += 1) {
      const drawResult = await scheduledDrawNext(
        masterToken,
        initialScheduledGameId,
      );

      // Detect via WinPopup (player er vinner — tidlig-exit hvis det skjer)
      const popupVisible = await winPopupLocator
        .isVisible({ timeout: 50 })
        .catch(() => false);
      if (popupVisible) {
        const detail = await getGameDetail(masterToken, initialScheduledGameId);
        rad1WonAtDraw = detail?.engineState?.drawsCompleted ?? 0;
        rad1Phase = detail?.engineState?.currentPhase ?? null;
        console.log(
          `[test] ✓ WinPopup detected etter ${rad1WonAtDraw} draws, phase=${rad1Phase}`,
        );
        break;
      }

      const drawn = drawResult.engineState.drawsCompleted;
      const phase = drawResult.engineState.currentPhase;
      const isFinished = drawResult.engineState.isFinished;
      const isPaused = drawResult.engineState.isPaused;
      const pausedAtPhase = drawResult.engineState.pausedAtPhase;

      if (drawn !== lastDrawnCount || phase !== lastPhase) {
        console.log(
          `[test] Draw progress: drawn=${drawn}, phase=${phase}, isPaused=${isPaused}, lastBall=${drawResult.engineState.lastDrawnBall ?? "n/a"}`,
        );
        lastDrawnCount = drawn;
        lastPhase = phase;
      }

      // Rad 1 vunnet hvis phase advanced fra 1 til 2+, ELLER hvis engine
      // er paused at phase 1 (auto-pause på rad-vinst — på prod-hall).
      // På demo-hall (is_test_hall=TRUE) auto-pause er bypassed så phase
      // bare advanser uten å pause.
      if (phase > 1 || (isPaused && pausedAtPhase === 1)) {
        rad1WonAtDraw = drawn;
        rad1Phase = phase;
        console.log(
          `[test] ✓ Rad 1 vunnet — phase advanced fra 1 til ${phase} etter ${drawn} draws`,
        );
        break;
      }

      if (isFinished) {
        const detail = await getGameDetail(masterToken, initialScheduledGameId);
        console.log(
          `[test] Runde slutt-state: gameStatus=${detail?.game.status ?? "unknown"}, drawn=${drawn}, phase=${phase}`,
        );
        // Hvis runden er ferdig, har vi sannsynligvis vunnet alle faser.
        // Bekreft via phase > 1.
        if (phase > 1) {
          rad1WonAtDraw = drawn;
          rad1Phase = phase;
        }
        break;
      }
    }

    expect(
      rad1WonAtDraw,
      `Rad 1 (eller annen pattern) må vinnes innen ${RAD1_MAX_DRAWS} eksplisitte scheduled draws. Hvis dette feiler er enten ticket-assignment, pattern-eval eller Game1DrawEngineService.drawNext broken.`,
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
      // Player var IKKE vinneren — verifiser via engine-state (phase advanced).
      // En annen spiller vant Rad 1, så phase økte fra 1 til 2+.
      const detail = await getGameDetail(masterToken, initialScheduledGameId);
      expect(
        detail?.engineState?.currentPhase ?? 1,
        "Phase må være > 1 (Rad 1 vunnet av en annen spiller)",
      ).toBeGreaterThan(1);
      console.log(
        `[test] WinPopup ikke synlig — annen spiller vant. Phase=${detail?.engineState?.currentPhase}.`,
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

    // ── Steg 11: Trekk videre til Rad 2-vinst ─────────────────────────────
    console.log("[test] Trekker videre til Rad 2-vinst...");

    let rad2WonAtDraw: number | null = null;
    let rad2Phase: number | null = null;
    const phaseBeforeRad2 = rad1Phase ?? 2; // Rad 1 vunnet → phase=2

    console.log(
      `[test] Før Rad 2 draw-loop: phase=${phaseBeforeRad2}, looking for phase>${phaseBeforeRad2}`,
    );

    const RAD2_MAX_DRAWS = 75;
    let rad2LastPhase = phaseBeforeRad2;

    for (let attempt = 0; attempt < RAD2_MAX_DRAWS; attempt += 1) {
      const drawResult = await scheduledDrawNext(
        masterToken,
        initialScheduledGameId,
      );
      const drawn = drawResult.engineState.drawsCompleted;
      const phase = drawResult.engineState.currentPhase;
      const isFinished = drawResult.engineState.isFinished;
      const isPaused = drawResult.engineState.isPaused;

      if (phase !== rad2LastPhase) {
        console.log(
          `[test] Rad2 phase progress: phase=${phase}, drawn=${drawn}, isPaused=${isPaused}`,
        );
        rad2LastPhase = phase;
      }

      // Rad 2 vunnet hvis phase advanced beyond phaseBeforeRad2
      if (phase > phaseBeforeRad2) {
        rad2WonAtDraw = drawn;
        rad2Phase = phase;
        console.log(
          `[test] ✓ Rad 2 (eller senere) vunnet — phase ${phaseBeforeRad2} → ${phase} etter ${drawn} draws`,
        );
        break;
      }

      // Hvis runden er ferdig
      if (isFinished) {
        const detail = await getGameDetail(masterToken, initialScheduledGameId);
        console.log(
          `[test] Runde slutt-state: gameStatus=${detail?.game.status ?? "unknown"}, drawn=${drawn}, phase=${phase}`,
        );
        if (phase > phaseBeforeRad2) {
          rad2WonAtDraw = drawn;
          rad2Phase = phase;
        }
        break;
      }
    }

    expect(
      rad2WonAtDraw,
      `Rad 2 (eller senere fase) må vinnes innen ${RAD2_MAX_DRAWS} eksplisitte scheduled draws etter Rad 1. Hvis dette feiler er pattern-progresjon eller Game1DrawEngineHelpers broken.`,
    ).not.toBeNull();

    console.log("[test] ✓ HELE FLYTEN GRØNN — Rad 1 + Pause/Resume + Rad 2");
  });
});
