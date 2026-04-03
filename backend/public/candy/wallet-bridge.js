/**
 * Wallet Bridge — ES module for CandyWeb (iframe) to communicate with
 * the bingo-system lobby via PostMessage + REST API.
 *
 * Usage in CandyWeb React:
 *   import { walletBridge } from './wallet-bridge.js';
 *   await walletBridge.init();
 *   const balance = await walletBridge.getBalance();
 *   await walletBridge.debit(50, gameId);
 *   await walletBridge.credit(200, gameId);
 *   walletBridge.close();
 */

let authToken = null;
let apiBaseUrl = null;
let requestId = 0;
const pendingRequests = new Map();

// ---------------------------------------------------------------------------
// PostMessage listener — receives responses from lobby parent
// ---------------------------------------------------------------------------
function handleMessage(event) {
  const data = event.data;
  if (!data || typeof data !== "object" || typeof data.type !== "string") return;
  if (!data.type.startsWith("wallet:")) return;

  if (data.type === "wallet:token") {
    authToken = data.payload.token;
    apiBaseUrl = data.payload.apiBaseUrl || "";
    return;
  }

  // Resolve pending request
  if (data.requestId !== undefined && pendingRequests.has(data.requestId)) {
    const { resolve, reject } = pendingRequests.get(data.requestId);
    pendingRequests.delete(data.requestId);
    if (data.error) {
      reject(new Error(data.error));
    } else {
      resolve(data.payload);
    }
  }
}

window.addEventListener("message", handleMessage);

// ---------------------------------------------------------------------------
// Send request to lobby parent via PostMessage
// ---------------------------------------------------------------------------
function sendToLobby(type, payload) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    pendingRequests.set(id, { resolve, reject });
    window.parent.postMessage({ type, payload, requestId: id }, "*");

    // Timeout after 10 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error("Wallet bridge timeout"));
      }
    }, 10000);
  });
}

// ---------------------------------------------------------------------------
// Direct REST API calls (used when authToken is available)
// ---------------------------------------------------------------------------
async function apiCall(method, path, body) {
  if (!authToken) {
    throw new Error("Wallet bridge not initialized — no auth token.");
  }
  const url = `${apiBaseUrl}/api/integration/wallet${path}`;
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`
    }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json.error || "Wallet API error");
    err.code = json.error;
    err.status = res.status;
    throw err;
  }
  return json;
}

function generateIdempotencyKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export const walletBridge = {
  /**
   * Initialize the wallet bridge. Call once when CandyWeb loads in iframe.
   * Requests auth token from the lobby parent via PostMessage.
   */
  async init() {
    window.parent.postMessage({ type: "candy:ready" }, "*");
    // Wait for wallet:token message from parent (up to 5 seconds)
    if (!authToken) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Wallet token timeout")), 5000);
        const check = setInterval(() => {
          if (authToken) {
            clearInterval(check);
            clearTimeout(timeout);
            resolve();
          }
        }, 100);
      });
    }
  },

  /**
   * Get current player balance.
   * @returns {Promise<{ balance: number, currency: string }>}
   */
  async getBalance() {
    if (authToken) {
      return apiCall("GET", "/balance");
    }
    return sendToLobby("candy:getBalance", {});
  },

  /**
   * Debit (deduct) from player wallet for a game round.
   * @param {number} amount
   * @param {string} [gameId]
   * @returns {Promise<{ transactionId: string, previousBalance: number, afterBalance: number }>}
   */
  async debit(amount, gameId) {
    const idempotencyKey = generateIdempotencyKey();
    if (authToken) {
      return apiCall("POST", "/debit", { amount, gameId, idempotencyKey });
    }
    return sendToLobby("candy:debit", { amount, gameId, idempotencyKey });
  },

  /**
   * Credit (add) to player wallet after winning.
   * @param {number} amount
   * @param {string} [gameId]
   * @returns {Promise<{ transactionId: string, previousBalance: number, afterBalance: number }>}
   */
  async credit(amount, gameId) {
    const idempotencyKey = generateIdempotencyKey();
    if (authToken) {
      return apiCall("POST", "/credit", { amount, gameId, idempotencyKey });
    }
    return sendToLobby("candy:credit", { amount, gameId, idempotencyKey });
  },

  /**
   * Close the game — tells lobby to remove the iframe overlay.
   */
  close() {
    window.parent.postMessage({ type: "candy:close" }, "*");
  },

  /** Check if wallet bridge has an active token. */
  get isInitialized() {
    return !!authToken;
  }
};
