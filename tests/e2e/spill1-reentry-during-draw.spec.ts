import { expect, test } from "@playwright/test";
import {
  autoLogin,
  getLobbyState,
  markHallReady,
  masterStart,
  openPurchaseWindow,
  masterStop,
  resetPilotState,
} from "./helpers/rest.js";

/**
 * Spill 1 RE-ENTRY-DURING-DRAW regression test (Tobias-rapport 2026-05-13).
 *
 * Rapportert bug (I15):
 *
 *   > "etter at jeg starter spill går ut av lobbyen for deretter å gå inn
 *   >  igjen så kommer jeg ikke inn i rommet under en trekning, må vente
 *   >  til trekning er ferdig før jeg kan gå inn"
 *
 * Forventet atferd:
 *   - Spilleren skal kunne re-joine rommet mens trekning pågår.
 *   - Klienten skal lande på `#web-game-container` med live trekk synlig.
 *
 * Faktisk atferd (forventet failure inntil fix):
 *   - Re-join feiler med `PLAYER_ALREADY_IN_ROOM` (server-side) fordi
 *     `joinScheduledGame` i `game1ScheduledEvents.ts:288-365` kaller
 *     `engine.joinRoom` rett ut uten å sjekke for eksisterende
 *     player-record. `room:create` og `room:join` har korrekt re-attach-
 *     guard via `findPlayerInRoomByWallet` + `attachPlayerSocket`, men
 *     den scheduled-game-pathen mangler den.
 *   - Klienten lander i `Game1LobbyFallback`-overlay (R1/BIN-822), som
 *     viser "Stengt"/"Neste spill …" istedenfor å sync-e til pågående
 *     runde.
 *
 * Test-strategi:
 *   1. Setup: master åpner `purchase_open`, markerer hall klar, og kjører
 *      andre `masterStart` slik at en runde er `running` med minst 1 draw.
 *   2. Spiller åpner `/web/`, klikker bingo-tile, lander på play-screen.
 *   3. Verifiser at klient er i play-screen og ser draws.
 *   4. Spiller klikker tilbake (`returnToShellLobby()`) — lobby vises.
 *   5. Spiller klikker bingo-tile igjen (re-entry).
 *   6. Verifiser at klient lander på `#web-game-container` UTEN å falle
 *      tilbake til lobby-fallback-overlay.
 *
 * Forutsetning: `dev:all` kjører på port 4000.
 *
 * Forventet status: 🔴 RØD inntil fix lander (root cause i §I15-doc).
 */

const MASTER_EMAIL = "demo-agent-1@spillorama.no";
const HALL_ID = "demo-hall-001";

async function pickAvailablePlayer(): Promise<{
  email: string;
  accessToken: string;
  userId: string;
  hallId: string | null;
  walletBalance: number;
}> {
  for (let n = 1; n <= 12; n += 1) {
    const email = `demo-pilot-spiller-${n}@example.com`;
    try {
      const player = await autoLogin(email);
      const complianceRes = await fetch(
        `http://localhost:4000/api/wallet/me/compliance?hallId=${encodeURIComponent(
          HALL_ID,
        )}`,
        {
          headers: { Authorization: `Bearer ${player.accessToken}` },
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
      if (remaining >= 100) {
        return {
          email,
          accessToken: player.accessToken,
          userId: player.userId,
          hallId: player.hallId,
          walletBalance: player.walletBalance,
        };
      }
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "Ingen demo-spiller har ledig dagsgrense. Kjør `npm run dev:nuke` for reseed.",
  );
}

test.describe("Spill 1 — re-entry during active draw (I15)", () => {
  test.describe.configure({ mode: "serial" });

  let masterToken: string;
  let player: {
    email: string;
    accessToken: string;
    userId: string;
    hallId: string | null;
    walletBalance: number;
  };

  test.beforeAll(async () => {
    const master = await autoLogin(MASTER_EMAIL);
    masterToken = master.accessToken;
    expect(master.hallId, "Master må være tilknyttet pilot-hall").toBe(HALL_ID);
    await resetPilotState(masterToken);
    player = await pickAvailablePlayer();
  });

  test.afterAll(async () => {
    if (masterToken) {
      await masterStop(masterToken, "reentry afterAll cleanup").catch(() => {
        /* ignore */
      });
    }
  });

  test("re-entry til rom under aktiv trekning skal lykkes (ikke fallback til lobby)", async ({
    page,
  }) => {
    // ── Steg 1: Master starter runden via to-stegs-flyt
    const opened = await openPurchaseWindow(masterToken);
    const scheduledGameId = opened.scheduledGameId;
    expect(scheduledGameId, "scheduled-game må spawnes").toBeTruthy();

    await markHallReady(masterToken, HALL_ID);
    const startResult = await masterStart(masterToken);
    expect(startResult.scheduledGameId).toBe(scheduledGameId);
    expect(startResult.scheduledGameStatus).toBe("running");

    const runningLobby = await getLobbyState(masterToken, HALL_ID);
    expect(runningLobby.scheduledGameMeta?.status).toBe("running");
    console.log(
      `[test] Master started game ${scheduledGameId}, status=running`,
    );

    // Wait briefly so at least one draw has happened (auto-draw-tick
    // is on ~4s interval per Game1AutoDrawTickService.defaultSeconds).
    console.log("[test] Wait 6s so first draw has fired…");
    await new Promise((resolve) => setTimeout(resolve, 6_000));

    // ── Steg 2: Spiller åpner klient og lander på play-screen
    // Capture-bøtte for re-entry-fasen — closure-scoped flag styrer
    // når vi fanger feil-meldinger fra console.
    let captureReentryFailures = false;
    const reentryFailures: string[] = [];

    page.on("console", (msg) => {
      const text = msg.text();
      if (
        text.includes("ALREADY_IN_ROOM") ||
        text.includes("Game1LobbyFallback") ||
        text.includes("Room join feilet") ||
        text.includes("[Game1]") ||
        text.includes("error")
      ) {
        console.log(`[client.${msg.type()}] ${text}`);
      }
      // Capture join-failures kun under re-entry-fasen.
      if (captureReentryFailures && text.includes("Room join feilet")) {
        reentryFailures.push(text);
      }
    });
    page.on("pageerror", (err) => {
      console.error(`[client.pageerror] ${err.message}`);
    });

    // Inject session direkte (samme pattern som spill1-pilot-flow).
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
    await expect(bingoTile, "Bingo-tile skal være synlig").toBeVisible({
      timeout: 20_000,
    });
    await expect(
      bingoTile,
      "Bingo-tile skal være enabled (compliance lastet)",
    ).toBeEnabled({
      timeout: 15_000,
    });
    await bingoTile.click();
    console.log("[test] Klikk bingo-tile → forventer play-screen");
    await expect(
      page.locator("#web-game-container"),
      "web-game-container skal vises etter første klikk",
    ).toBeVisible({ timeout: 15_000 });

    // Vent på at klienten faktisk er ferdig med initial join. Hvis vi
    // ikke venter her kan returnToShellLobby() trigges før socket er
    // bound og førsteg ang er bare et race-test, ikke faktisk re-entry.
    // Bruker chip-en med "Spiller deltar i rommet"-state via Pixi canvas.
    await expect(
      page.locator("#web-game-container canvas"),
      "Pixi canvas skal vises (klient mountet)",
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2_000);
    console.log("[test] Klient mountet OK — første gang");

    // ── Steg 3: Spiller går tilbake til lobbyen
    // `returnToShellLobby` er den faktiske back-knapp-handler i lobby.js.
    await page.evaluate(() => {
      const fn = (window as unknown as { returnToShellLobby?: () => void })
        .returnToShellLobby;
      if (typeof fn === "function") {
        fn();
      } else {
        throw new Error("returnToShellLobby ikke definert på window");
      }
    });
    await expect(
      page.locator("#web-game-container"),
      "web-game-container skal være hidden etter back",
    ).toBeHidden({ timeout: 5_000 });
    console.log("[test] returnToShellLobby() → tilbake i lobby");

    // ── Steg 4: Spiller klikker bingo-tile igjen
    // ENABLE capture-bøtte FØR re-entry så vi fanger join-feil-meldingen
    // som kommer fra Game1Controller.start() ved den nye mountGame.
    captureReentryFailures = true;
    const bingoTile2 = page.locator('[data-slug="bingo"]').first();
    await expect(
      bingoTile2,
      "Bingo-tile må fortsatt være synlig",
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      bingoTile2,
      "Bingo-tile må fortsatt være enabled",
    ).toBeEnabled({
      timeout: 5_000,
    });
    await bingoTile2.click();
    console.log("[test] Klikk bingo-tile → forventer re-join til pågående runde");

    // ── Steg 5: Verifiser at re-join lyktes.
    //
    // KRITISK FAILURE-DETEKSJON: Vi capturer console-warnings før vi
    // kalte returnToShellLobby() vs. etter, og asserter at den siste
    // `Room join feilet`-meldingen IKKE oppstår ved re-entry.
    //
    // Hvorfor capture-based: Game1LobbyFallback rendrer overlay som
    // automatisk lukker seg etter fetch-feil, så vi kan ikke alltid
    // se den i DOM-en når test polles. Men console-loggen er
    // append-only — vi vet med 100 % sikkerhet at re-join feilet
    // hvis [Game1] Room join feilet vises ETTER returnToShellLobby.
    await expect(
      page.locator("#web-game-container"),
      "web-game-container skal vises etter re-entry",
    ).toBeVisible({ timeout: 15_000 });

    // Vent på at re-join-flyten settler (server-ack + evt. fallback-mount).
    await page.waitForTimeout(3_000);

    // KJERNE-ASSERTION: hvis console fanget "Room join feilet"-warning
    // under re-entry-fasen, har bug-en fyrt. Server returnerte
    // PLAYER_ALREADY_IN_ROOM og klienten mountet Game1LobbyFallback.
    if (reentryFailures.length > 0) {
      throw new Error(
        `🚨 BUG I15 REPRODUSERT: re-join feilet med:\n` +
          reentryFailures.map((m) => `  - ${m}`).join("\n") +
          "\n\nServer-side trail: " +
          "engine.joinRoom (kalt via game1ScheduledEvents.ts:324) kaster " +
          "PLAYER_ALREADY_IN_ROOM fordi assertWalletNotAlreadyInRoom() finner " +
          "eksisterende player-record fra forrige session (detachSocket " +
          "rydder bare socketId, ikke selve player-record). Klient mounter " +
          "Game1LobbyFallback istedenfor å sync-e til pågående runde.",
      );
    }

    // Alternativ check: Game1LobbyFallback DOM-overlay finnes.
    const lobbyFallbackOverlay = page.locator(
      "[data-spill1-lobby-fallback='true']",
    );
    const fallbackCount = await lobbyFallbackOverlay.count();
    expect(
      fallbackCount,
      "🚨 BUG I15 REPRODUSERT: Klient mountet Game1LobbyFallback ved re-entry",
    ).toBe(0);

    console.log(
      "[test] ✅ Re-entry til pågående runde lyktes — bug I15 ikke reprodusert",
    );
  });
});
