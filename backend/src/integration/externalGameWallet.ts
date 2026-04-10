import { Router, type Request, type Response } from "express";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import { WalletError } from "../adapters/WalletAdapter.js";

interface ExternalGameWalletOptions {
  walletAdapter: WalletAdapter;
  apiKey: string;
}

export function createExternalGameWalletRouter(options: ExternalGameWalletOptions): Router {
  const { walletAdapter, apiKey } = options;
  const router = Router();

  function requireApiKey(req: Request, res: Response): boolean {
    const header = req.headers.authorization;
    if (!header || header !== `Bearer ${apiKey}`) {
      res.status(401).json({ success: false, errorCode: "UNAUTHORIZED", message: "Invalid or missing API key." });
      return false;
    }
    return true;
  }

  // GET /balance?playerId={walletId}
  router.get("/balance", async (req: Request, res: Response) => {
    if (!requireApiKey(req, res)) return;
    const playerId = typeof req.query.playerId === "string" ? req.query.playerId.trim() : "";
    if (!playerId) {
      res.status(400).json({ success: false, errorCode: "INVALID_INPUT", message: "playerId is required." });
      return;
    }
    try {
      const balance = await walletAdapter.getBalance(playerId);
      res.json({ balance, currency: "NOK" });
    } catch (error) {
      if (error instanceof WalletError && (error.code === "ACCOUNT_NOT_FOUND" || error.code === "NOT_FOUND")) {
        res.status(404).json({ success: false, errorCode: "PLAYER_NOT_FOUND", message: "Unknown wallet ID." });
        return;
      }
      res.status(500).json({ success: false, errorCode: "WALLET_ERROR", message: "Internal wallet error." });
    }
  });

  // POST /debit
  router.post("/debit", async (req: Request, res: Response) => {
    if (!requireApiKey(req, res)) return;
    const { playerId, amount, transactionId, roundId, currency } = req.body ?? {};

    const validationError = validateWalletRequest(playerId, amount, transactionId);
    if (validationError) {
      res.status(400).json(validationError);
      return;
    }

    try {
      const tx = await walletAdapter.debit(
        playerId,
        amount,
        `ext-game debit round=${roundId ?? "unknown"} currency=${currency ?? "NOK"}`,
        { idempotencyKey: transactionId }
      );
      const balance = await walletAdapter.getBalance(playerId);
      res.json({ success: true, balance, transactionId: tx.id });
    } catch (error) {
      handleWalletError(res, error, transactionId);
    }
  });

  // POST /credit
  router.post("/credit", async (req: Request, res: Response) => {
    if (!requireApiKey(req, res)) return;
    const { playerId, amount, transactionId, roundId, currency } = req.body ?? {};

    const validationError = validateWalletRequest(playerId, amount, transactionId);
    if (validationError) {
      res.status(400).json(validationError);
      return;
    }

    try {
      const tx = await walletAdapter.credit(
        playerId,
        amount,
        `ext-game credit round=${roundId ?? "unknown"} currency=${currency ?? "NOK"}`,
        { idempotencyKey: transactionId }
      );
      const balance = await walletAdapter.getBalance(playerId);
      res.json({ success: true, balance, transactionId: tx.id });
    } catch (error) {
      handleWalletError(res, error, transactionId);
    }
  });

  return router;
}

function validateWalletRequest(
  playerId: unknown,
  amount: unknown,
  transactionId: unknown
): { success: false; errorCode: string; message: string } | null {
  if (typeof playerId !== "string" || !playerId.trim()) {
    return { success: false, errorCode: "INVALID_INPUT", message: "playerId is required." };
  }
  if (typeof transactionId !== "string" || !transactionId.trim()) {
    return { success: false, errorCode: "INVALID_INPUT", message: "transactionId is required." };
  }
  const num = Number(amount);
  if (!Number.isFinite(num) || num <= 0) {
    return { success: false, errorCode: "INVALID_AMOUNT", message: "amount must be a positive number." };
  }
  return null;
}

function handleWalletError(res: Response, error: unknown, transactionId?: string): void {
  if (error instanceof WalletError) {
    switch (error.code) {
      case "INSUFFICIENT_FUNDS":
        res.status(402).json({ success: false, errorCode: "INSUFFICIENT_FUNDS", message: error.message });
        return;
      case "ACCOUNT_NOT_FOUND":
      case "NOT_FOUND":
        res.status(404).json({ success: false, errorCode: "PLAYER_NOT_FOUND", message: error.message });
        return;
      case "DUPLICATE_TRANSACTION":
      case "IDEMPOTENCY_CONFLICT":
        res.status(409).json({ success: false, errorCode: "DUPLICATE_TRANSACTION", message: error.message, transactionId });
        return;
    }
  }
  res.status(500).json({ success: false, errorCode: "WALLET_ERROR", message: "Internal wallet error." });
}
