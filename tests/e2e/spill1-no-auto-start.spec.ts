import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  autoLogin,
  getLobbyState,
  markHallReady,
  masterStart,
  masterStop,
  resetPilotState,
} from "./helpers/rest.js";

/**
 * Spill 1 NO-AUTO-START regression test (Tobias-direktiv 2026-05-13).
 *
 * Isolerer bug-en Tobias rapporterte 2026-05-13:
 *
 *   > "fort satt feil pris. ... runden startet også automatisk etter jeg
 *   >  kjøpte bong. vises som 5 kr innsats og 20 kr forhåndskjøp."
 *
 * Spec (immutable):
 * - Spill 1 er MASTER-STYRT mellom runder (ikke perpetual som Spill 2/3).
 * - Status flytter `purchase_open` → `ready_to_start` AUTOMATISK når alle
 *   haller er klare (`Game1ScheduleTickService.transitionReadyToStartGames`),
 *   men ALDRI til `running` uten eksplisitt master-handling.
 * - Status flipper KUN til `running` via:
 *     • `POST /api/agent/game1/master/start` (MasterActionService.start)
 *     • `POST /api/admin/game1/games/:gameId/start` (Game1MasterControlService.startGame)
 * - Ingen buy-path skal noensinne sette status=`running`.
 *
 * Test-strategi:
 * 1. Setup: master `markHallReady` på pilot-hall (lazy-spawner scheduled-game
 *    i `purchase_open`-status). IKKE kall `masterStart`.
 * 2. Spiller kjøper bonger via REST `/api/game1/purchase`. Bekreft 200 OK.
 * 3. Vent 10 sekunder for eventuell auto-start-tick eller race.
 * 4. Verifiser at scheduled-game status fortsatt er `purchase_open` ELLER
 *    `ready_to_start` (IKKE `running`).
 * 5. Verifiser `actualStartTime` er `null` (ingen master-start har skjedd).
 * 6. Manuell master-start → status flipper til `running`, `actualStartTime`
 *    settes.
 */

const MASTER_EMAIL = "demo-agent-1@spillorama.no";
const HALL_ID = "demo-hall-001";

async function pickAvailablePlayer(): Promise<{
  email: string;
  accessToken: string;
  userId: string;
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
        console.log(
          `[pickAvailablePlayer] Selected ${email} (used=${used}, remaining=${remaining})`,
        );
        return {
          email,
          accessToken: player.accessToken,
          userId: player.userId,
          walletBalance: player.walletBalance,
        };
      }
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "Ingen demo-spiller har ledig dagsgrense. Vent til neste dag eller kjør `npm run dev:nuke` for reseed.",
  );
}

async function buyOneSmallWhite(input: {
  scheduledGameId: string;
  buyerToken: string;
  buyerUserId: string;
  hallId: string;
}): Promise<{ purchaseId: string; totalAmountCents: number }> {
  const idempotencyKey = `e2e-no-auto-start-${randomUUID()}`;
  const res = await fetch("http://localhost:4000/api/game1/purchase", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.buyerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      scheduledGameId: input.scheduledGameId,
      buyerUserId: input.buyerUserId,
      hallId: input.hallId,
      paymentMethod: "digital_wallet",
      idempotencyKey,
      ticketSpec: [
        {
          color: "white",
          size: "small",
          count: 1,
          priceCentsEach: 500,
        },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`buyOneSmallWhite failed: HTTP ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    ok: boolean;
    data?: { purchaseId: string; totalAmountCents: number };
    error?: { code?: string; message?: string };
  };
  if (!json.ok || !json.data) {
    throw new Error(`buyOneSmallWhite not OK: ${JSON.stringify(json.error)}`);
  }
  return json.data;
}

test.describe("Spill 1 — no auto-start regression", () => {
  test.describe.configure({ mode: "serial" });

  let masterToken: string;
  let player: {
    email: string;
    accessToken: string;
    userId: string;
    walletBalance: number;
  };

  test.beforeAll(async () => {
    const master = await autoLogin(MASTER_EMAIL);
    masterToken = master.accessToken;
    expect(master.hallId, "Master må være tilknyttet pilot-hall").toBe(
      HALL_ID,
    );
    await resetPilotState(masterToken);
    player = await pickAvailablePlayer();
  });

  test.afterAll(async () => {
    if (masterToken) {
      await masterStop(masterToken, "no-auto-start afterAll cleanup").catch(
        () => {
          /* ignore */
        },
      );
    }
  });

  test("buy etter markHallReady skal IKKE auto-starte runden", async () => {
    const ready = await markHallReady(masterToken, HALL_ID);
    const scheduledGameId = ready.gameId;
    expect(scheduledGameId, "scheduled-game må spawnes").toBeTruthy();

    const initialLobby = await getLobbyState(masterToken, HALL_ID);
    expect(initialLobby.currentScheduledGameId).toBe(scheduledGameId);

    const initialStatus = initialLobby.scheduledGameMeta?.status ?? "";
    expect(
      ["purchase_open", "ready_to_start"],
      `Status etter markHallReady — actual: '${initialStatus}'`,
    ).toContain(initialStatus);

    expect(initialLobby.scheduledGameMeta?.actualStartTime).toBeNull();

    console.log(
      `[test] Initial state OK: status=${initialStatus}, scheduledGameId=${scheduledGameId}`,
    );

    const buyResult = await buyOneSmallWhite({
      scheduledGameId,
      buyerToken: player.accessToken,
      buyerUserId: player.userId,
      hallId: HALL_ID,
    });
    expect(buyResult.totalAmountCents).toBe(500);

    console.log(
      `[test] Buy completed: purchaseId=${buyResult.purchaseId}, totalCents=${buyResult.totalAmountCents}`,
    );

    console.log("[test] Venter 10s for å se om auto-start trigges…");
    await new Promise((resolve) => setTimeout(resolve, 10_000));

    const afterBuyLobby = await getLobbyState(masterToken, HALL_ID);
    expect(afterBuyLobby.currentScheduledGameId).toBe(scheduledGameId);

    const afterBuyStatus = afterBuyLobby.scheduledGameMeta?.status ?? "";
    console.log(`[test] Status etter 10s wait: ${afterBuyStatus}`);

    expect(
      afterBuyStatus,
      `🚨 AUTO-START BUG REPRODUSERT: status='${afterBuyStatus}'. Spill 1 er master-styrt — buy skal IKKE trigge auto-start.`,
    ).not.toBe("running");

    expect(
      ["purchase_open", "ready_to_start"],
      `Status skal forbli kjøps-åpen — actual: '${afterBuyStatus}'`,
    ).toContain(afterBuyStatus);

    expect(
      afterBuyLobby.scheduledGameMeta?.actualStartTime,
      `🚨 actualStartTime satt UTEN master-start — auto-start-bug bekreftet`,
    ).toBeNull();

    expect(afterBuyLobby.currentScheduledGameId).toBe(scheduledGameId);

    console.log(`[test] ✅ Steg 1-5 grønne — ingen auto-start observert.`);

    const startResult = await masterStart(masterToken);
    expect(startResult.scheduledGameId).toBe(scheduledGameId);
    expect(startResult.scheduledGameStatus).toBe("running");

    const runningLobby = await getLobbyState(masterToken, HALL_ID);
    expect(runningLobby.scheduledGameMeta?.status).toBe("running");
    expect(runningLobby.scheduledGameMeta?.actualStartTime).toBeTruthy();

    console.log(
      `[test] ✅ Master-start grønn: status=${runningLobby.scheduledGameMeta?.status}, actualStart=${runningLobby.scheduledGameMeta?.actualStartTime}`,
    );
  });

  test("flere buys i rask rekkefølge skal IKKE auto-starte (stress-variant)", async () => {
    await resetPilotState(masterToken);

    const stressPlayer = await pickAvailablePlayer();

    const ready = await markHallReady(masterToken, HALL_ID);
    const scheduledGameId = ready.gameId;
    expect(scheduledGameId).toBeTruthy();

    const initialLobby = await getLobbyState(masterToken, HALL_ID);
    expect(initialLobby.scheduledGameMeta?.actualStartTime).toBeNull();

    console.log("[test] Kjører 3 buys i rask rekkefølge…");
    const buyPromises: Promise<{ purchaseId: string }>[] = [];
    for (let i = 0; i < 3; i++) {
      buyPromises.push(
        buyOneSmallWhite({
          scheduledGameId,
          buyerToken: stressPlayer.accessToken,
          buyerUserId: stressPlayer.userId,
          hallId: HALL_ID,
        }),
      );
    }
    const buyResults = await Promise.all(buyPromises);
    console.log(`[test] Alle 3 buys fullført: ${buyResults.map((r) => r.purchaseId.slice(0, 12)).join(", ")}`);

    console.log("[test] Venter 15s for å la schedule-tick kjøre minst én gang…");
    await new Promise((resolve) => setTimeout(resolve, 15_000));

    const afterStressLobby = await getLobbyState(masterToken, HALL_ID);
    const finalStatus = afterStressLobby.scheduledGameMeta?.status ?? "";
    console.log(`[test] Status etter stress-buys + 15s wait: ${finalStatus}`);

    expect(
      finalStatus,
      `🚨 AUTO-START BUG (stress-variant): status='${finalStatus}' etter 3 buys + 15s wait.`,
    ).not.toBe("running");

    expect(afterStressLobby.scheduledGameMeta?.actualStartTime).toBeNull();
    expect(afterStressLobby.currentScheduledGameId).toBe(scheduledGameId);

    console.log("[test] ✅ Stress-variant grønn — 3 raske buys + 15s wait ga ingen auto-start.");
  });
});
