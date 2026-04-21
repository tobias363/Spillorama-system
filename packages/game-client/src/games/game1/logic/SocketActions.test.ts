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
  } as unknown as SpilloramaSocket & {
    armBet: ReturnType<typeof vi.fn>;
    startGame: ReturnType<typeof vi.fn>;
    submitClaim: ReturnType<typeof vi.fn>;
    cancelTicket: ReturnType<typeof vi.fn>;
    setLuckyNumber: ReturnType<typeof vi.fn>;
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
    hideBuyPopup: vi.fn(),
    reset: vi.fn(),
    update: vi.fn(),
    resetClaimButton: vi.fn(),
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

    it("closes the buy popup on success", async () => {
      const { deps, playScreen } = makeDeps();
      await new Game1SocketActions(deps).buy();
      expect(playScreen.hideBuyPopup).toHaveBeenCalledOnce();
    });

    it("reports error + keeps popup open on failure", async () => {
      const socket = {
        armBet: vi.fn().mockResolvedValue({ ok: false, error: { message: "Wallet empty" } }),
      } as unknown as SpilloramaSocket;
      const { deps, onError, playScreen } = makeDeps({ socket });
      await new Game1SocketActions(deps).buy();
      expect(onError).toHaveBeenCalledWith("Wallet empty");
      expect(playScreen.hideBuyPopup).not.toHaveBeenCalled();
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

    it("surfaces server error as toast + resets button", async () => {
      const socket = {
        submitClaim: vi.fn().mockResolvedValue({ ok: false, error: { message: "Invalid claim" } }),
      } as unknown as SpilloramaSocket;
      const { deps, toast, playScreen } = makeDeps({ socket, getPhase: () => "PLAYING" });
      await new Game1SocketActions(deps).claim("LINE");
      expect(toast.error).toHaveBeenCalledWith("Invalid claim");
      expect(playScreen.resetClaimButton).toHaveBeenCalledWith("LINE");
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
