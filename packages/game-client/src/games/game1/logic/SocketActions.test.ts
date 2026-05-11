/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Game1SocketActions, type SocketActionsDeps } from "./SocketActions.js";
import type { GameBridge, GameState } from "../../../bridge/GameBridge.js";
import type { SpilloramaSocket } from "../../../net/SpilloramaSocket.js";
import type { ToastNotification } from "../components/ToastNotification.js";
import type { PlayScreen } from "../screens/PlayScreen.js";

function makeDeps(overrides: Partial<SocketActionsDeps> = {}) {
  const socket = {
    armBet: vi.fn().mockResolvedValue({ ok: true }),
    startGame: vi.fn().mockResolvedValue({ ok: true }),
    submitClaim: vi.fn().mockResolvedValue({ ok: true }),
    cancelTicket: vi.fn().mockResolvedValue({ ok: true, data: { removedTicketIds: ["t1"], fullyDisarmed: false } }),
    setLuckyNumber: vi.fn().mockResolvedValue({ ok: true }),
    // Codex live-room-control-plane hardening 2026-05-11: scheduled REST-purchase
    // flow trigger room:state-resync så bridge får oppdatert snapshot etter
    // /api/game1/purchase. Mock returnerer snapshot=null så bridge.applySnapshot
    // ikke kalles i tester som ikke verifiserer resync-pathen eksplisitt.
    getRoomState: vi.fn().mockResolvedValue({ ok: true, data: { snapshot: null } }),
  } as unknown as SpilloramaSocket & {
    armBet: ReturnType<typeof vi.fn>;
    startGame: ReturnType<typeof vi.fn>;
    submitClaim: ReturnType<typeof vi.fn>;
    cancelTicket: ReturnType<typeof vi.fn>;
    setLuckyNumber: ReturnType<typeof vi.fn>;
    getRoomState: ReturnType<typeof vi.fn>;
  };

  const bridge = {
    getState: vi.fn().mockReturnValue({
      gameStatus: "WAITING",
      drawnNumbers: [],
    } as unknown as GameState),
  } as unknown as GameBridge & { getState: ReturnType<typeof vi.fn> };

  const toast = {
    info: vi.fn(),
    error: vi.fn(),
    win: vi.fn(),
  } as unknown as ToastNotification;

  const playScreen = {
    showBuyPopupResult: vi.fn(),
    showBuyPopupPartialResult: vi.fn(),
    updateBuyPopupLossState: vi.fn(),
    hideBuyPopup: vi.fn(),
    reset: vi.fn(),
    update: vi.fn(),
  } as unknown as PlayScreen;

  const onError = vi.fn();

  const deps: SocketActionsDeps = {
    socket,
    bridge,
    getRoomCode: () => "ROOM-1",
    getPhase: () => "WAITING",
    getPlayScreen: () => playScreen,
    toast,
    onError,
    ...overrides,
  };
  return { deps, socket, bridge, toast, playScreen, onError };
}

describe("Game1SocketActions", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  describe("buy", () => {
    it("sends ticketSelections when provided", async () => {
      const { deps, socket } = makeDeps();
      await new Game1SocketActions(deps).buy([{ type: "small", qty: 2, name: "Small Yellow" }]);
      expect(socket.armBet).toHaveBeenCalledWith({
        roomCode: "ROOM-1",
        armed: true,
        ticketSelections: [{ type: "small", qty: 2, name: "Small Yellow" }],
      });
    });

    it("falls back to ticketCount=1 when no selections", async () => {
      const { deps, socket } = makeDeps();
      await new Game1SocketActions(deps).buy();
      expect(socket.armBet).toHaveBeenCalledWith({
        roomCode: "ROOM-1",
        armed: true,
        ticketCount: 1,
      });
    });

    it("closes the buy popup on success via showBuyPopupResult(true) auto-hide", async () => {
      // Tobias 2026-04-29: ny semantikk — showBuyPopupResult(true) auto-skjuler
      // popup-en via setTimeout i Game1BuyPopup. Eksplisitt hideBuyPopup-kall
      // er fjernet fra SocketActions.buy() så bruker faktisk får sett
      // success-meldingen før popup-en lukkes.
      const { deps, playScreen } = makeDeps();
      await new Game1SocketActions(deps).buy();
      expect(playScreen.showBuyPopupResult).toHaveBeenCalledWith(true);
    });

    it("reports error + keeps popup open on failure (showBuyPopupResult(false))", async () => {
      const socket = {
        armBet: vi.fn().mockResolvedValue({ ok: false, error: { message: "Wallet empty" } }),
      } as unknown as SpilloramaSocket;
      const { deps, onError, playScreen } = makeDeps({ socket });
      await new Game1SocketActions(deps).buy();
      expect(onError).toHaveBeenCalledWith("Wallet empty");
      expect(playScreen.showBuyPopupResult).toHaveBeenCalledWith(false, "Wallet empty");
      expect(playScreen.hideBuyPopup).not.toHaveBeenCalled();
    });

    it("partial-buy ack triggers showBuyPopupPartialResult med rejected/accepted", async () => {
      // Tobias 2026-04-29: server returnerer lossLimit i ack med rejected > 0
      // når partial-buy. SocketActions skal kalle showBuyPopupPartialResult
      // i stedet for showBuyPopupResult(true).
      const socket = {
        armBet: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            armed: true,
            snapshot: { code: "ROOM-1" },
            lossLimit: {
              requested: 3,
              accepted: 2,
              rejected: 1,
              rejectionReason: "DAILY_LIMIT",
              dailyUsed: 100,
              dailyLimit: 100,
              monthlyUsed: 200,
              monthlyLimit: 4400,
              walletBalance: 0,
            },
          },
        }),
      } as unknown as SpilloramaSocket;
      const { deps, playScreen } = makeDeps({ socket });
      await new Game1SocketActions(deps).buy([{ type: "small", qty: 3, name: "Small Yellow" }]);
      expect(playScreen.showBuyPopupPartialResult).toHaveBeenCalledOnce();
      expect(playScreen.showBuyPopupPartialResult).toHaveBeenCalledWith({
        accepted: 2,
        rejected: 1,
        rejectionReason: "DAILY_LIMIT",
        lossState: {
          dailyUsed: 100,
          dailyLimit: 100,
          monthlyUsed: 200,
          monthlyLimit: 4400,
          walletBalance: 0,
        },
      });
      // showBuyPopupResult skal IKKE være kalt
      expect(playScreen.showBuyPopupResult).not.toHaveBeenCalled();
      // updateBuyPopupLossState SKAL være kalt med ferskt tap-state
      expect(playScreen.updateBuyPopupLossState).toHaveBeenCalled();
    });

    it("full-buy med lossLimit (rejected=0) triggers showBuyPopupResult(true) + lossState update", async () => {
      const socket = {
        armBet: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            armed: true,
            snapshot: { code: "ROOM-1" },
            lossLimit: {
              requested: 2,
              accepted: 2,
              rejected: 0,
              rejectionReason: null,
              dailyUsed: 20,
              dailyLimit: 900,
              monthlyUsed: 50,
              monthlyLimit: 4400,
              walletBalance: 480,
            },
          },
        }),
      } as unknown as SpilloramaSocket;
      const { deps, playScreen } = makeDeps({ socket });
      await new Game1SocketActions(deps).buy();
      expect(playScreen.showBuyPopupResult).toHaveBeenCalledWith(true);
      expect(playScreen.showBuyPopupPartialResult).not.toHaveBeenCalled();
      expect(playScreen.updateBuyPopupLossState).toHaveBeenCalledWith({
        dailyUsed: 20,
        dailyLimit: 900,
        monthlyUsed: 50,
        monthlyLimit: 4400,
        walletBalance: 480,
      });
    });

    it("uses scheduled purchase API before master start", async () => {
      sessionStorage.setItem("spillorama.accessToken", "token-1");
      sessionStorage.setItem("spillorama.user", JSON.stringify({ id: "user-1" }));
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ ok: true, data: { purchaseId: "p-1" } }),
      });
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
      const { deps, socket, playScreen } = makeDeps({
        getScheduledPurchaseContext: () => ({
          scheduledGameId: "sg-1",
          hallId: "hall-1",
          overallStatus: "purchase_open",
          ticketConfig: {
            entryFee: 5,
            ticketTypes: [
              { name: "Small Yellow", type: "small", priceMultiplier: 2, ticketCount: 1 },
              { name: "Large Yellow", type: "large", priceMultiplier: 6, ticketCount: 3 },
            ],
          },
        }),
      });

      await new Game1SocketActions(deps).buy([
        { type: "small", qty: 2, name: "Small Yellow" },
        { type: "large", qty: 1, name: "Large Yellow" },
      ]);

      expect(socket.armBet).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith("/api/game1/purchase", expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token-1" }),
      }));
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toMatchObject({
        scheduledGameId: "sg-1",
        buyerUserId: "user-1",
        hallId: "hall-1",
        paymentMethod: "digital_wallet",
        idempotencyKey: "web-game1-uuid-1",
      });
      expect(body.ticketSpec).toEqual([
        { color: "yellow", size: "small", count: 2, priceCentsEach: 1000 },
        { color: "yellow", size: "large", count: 1, priceCentsEach: 2000 },
      ]);
      expect(playScreen.showBuyPopupResult).toHaveBeenCalledWith(true);
    });
  });

  describe("claim", () => {
    it("blocks spectators with an info toast", async () => {
      const { deps, socket, toast } = makeDeps({ getPhase: () => "SPECTATING" });
      await new Game1SocketActions(deps).claim("LINE");
      expect(socket.submitClaim).not.toHaveBeenCalled();
      expect(toast.info).toHaveBeenCalledWith("Tilskuere kan ikke gjøre claims");
    });

    it("sends claim for active players", async () => {
      const { deps, socket } = makeDeps({ getPhase: () => "PLAYING" });
      await new Game1SocketActions(deps).claim("BINGO");
      expect(socket.submitClaim).toHaveBeenCalledWith({ roomCode: "ROOM-1", type: "BINGO" });
    });

    it("surfaces server error as toast (Bølge G — claim-knapp fjernet)", async () => {
      // Bølge G (2026-05-05): tidligere kalte denne også
      // `playScreen.resetClaimButton(type)`. Den knappen finnes ikke
      // lenger i game1/game3-PlayScreen — server eier auto-claim-on-draw
      // (BIN-689). Toast-error-på-NACK er fortsatt riktig kontrakt for
      // evt. eksterne callere av `Game1SocketActions.claim()`.
      const socket = {
        submitClaim: vi.fn().mockResolvedValue({ ok: false, error: { message: "Invalid claim" } }),
      } as unknown as SpilloramaSocket;
      const { deps, toast } = makeDeps({ socket, getPhase: () => "PLAYING" });
      await new Game1SocketActions(deps).claim("LINE");
      expect(toast.error).toHaveBeenCalledWith("Invalid claim");
    });
  });

  describe("cancelAll", () => {
    it("disarms + refreshes play screen on success", async () => {
      const { deps, socket, playScreen } = makeDeps();
      await new Game1SocketActions(deps).cancelAll();
      expect(socket.armBet).toHaveBeenCalledWith({ roomCode: "ROOM-1", armed: false });
      expect(playScreen.reset).toHaveBeenCalledOnce();
      expect(playScreen.update).toHaveBeenCalledOnce();
    });

    it("shows error toast on failure", async () => {
      const socket = {
        armBet: vi.fn().mockResolvedValue({ ok: false, error: { message: "Server error" } }),
      } as unknown as SpilloramaSocket;
      const { deps, toast, playScreen } = makeDeps({ socket });
      await new Game1SocketActions(deps).cancelAll();
      expect(toast.error).toHaveBeenCalledWith("Server error");
      expect(playScreen.reset).not.toHaveBeenCalled();
    });
  });

  describe("cancelTicket", () => {
    it("refuses during RUNNING with info-toast", async () => {
      const { deps, socket, toast } = makeDeps({
        bridge: {
          getState: vi.fn().mockReturnValue({ gameStatus: "RUNNING", drawnNumbers: [] } as unknown as GameState),
        } as unknown as GameBridge,
      });
      await new Game1SocketActions(deps).cancelTicket("t1");
      expect(socket.cancelTicket).not.toHaveBeenCalled();
      expect(toast.info).toHaveBeenCalledWith("Kan ikke avbestille mens runden pågår.");
    });

    it("calls backend with the ticket id in WAITING", async () => {
      const { deps, socket } = makeDeps();
      await new Game1SocketActions(deps).cancelTicket("t1");
      expect(socket.cancelTicket).toHaveBeenCalledWith({ roomCode: "ROOM-1", ticketId: "t1" });
    });

    it("shows 'fullyDisarmed' vs partial count in toast", async () => {
      const socketFull = {
        cancelTicket: vi.fn().mockResolvedValue({ ok: true, data: { fullyDisarmed: true, removedTicketIds: ["t1", "t2", "t3"] } }),
      } as unknown as SpilloramaSocket;
      const { deps, toast } = makeDeps({ socket: socketFull });
      await new Game1SocketActions(deps).cancelTicket("t1");
      expect(toast.info).toHaveBeenCalledWith("Alle brett avbestilt");
    });
  });

  describe("startGame + setLuckyNumber + elvisReplace", () => {
    it("startGame surfaces backend error via toast", async () => {
      const socket = {
        startGame: vi.fn().mockResolvedValue({ ok: false, error: { message: "Not enough players" } }),
      } as unknown as SpilloramaSocket;
      const { deps, toast } = makeDeps({ socket });
      await new Game1SocketActions(deps).startGame();
      expect(toast.error).toHaveBeenCalledWith("Not enough players");
    });

    it("setLuckyNumber sends lucky number to backend", async () => {
      const { deps, socket } = makeDeps();
      await new Game1SocketActions(deps).setLuckyNumber(42);
      expect(socket.setLuckyNumber).toHaveBeenCalledWith({ roomCode: "ROOM-1", luckyNumber: 42 });
    });

    it("elvisReplace disarms then re-arms + refreshes screen", async () => {
      const { deps, socket, playScreen, toast } = makeDeps();
      await new Game1SocketActions(deps).elvisReplace();
      expect(socket.armBet).toHaveBeenCalledTimes(2);
      expect(socket.armBet).toHaveBeenNthCalledWith(1, { roomCode: "ROOM-1", armed: false });
      expect(socket.armBet).toHaveBeenNthCalledWith(2, { roomCode: "ROOM-1", armed: true });
      expect(toast.info).toHaveBeenCalledWith("Bonger byttet!");
      expect(playScreen.reset).toHaveBeenCalledOnce();
    });
  });
});
