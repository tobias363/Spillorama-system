/**
 * CandyMania Wallet Bridge
 *
 * Denne filen brukes av CandyWeb (React-appen) for å kommunisere med
 * bingo-lobbyen via PostMessage. Lobbyen videresender forespørslene
 * til /api/integration/wallet/* endepunktene.
 *
 * Bruk:
 *   import { walletBridge } from './wallet-bridge.js';
 *
 *   // Initialiser (kalles ved oppstart)
 *   await walletBridge.init();
 *
 *   // Hent saldo
 *   const { balance } = await walletBridge.getBalance();
 *
 *   // Trekk penger (innsats)
 *   const debitResult = await walletBridge.debit(50, 'game_123');
 *
 *   // Krediter penger (gevinst)
 *   const creditResult = await walletBridge.credit(200, 'game_123');
 *
 *   // Lukk spillet og gå tilbake til lobby
 *   walletBridge.close();
 */

const RESPONSE_TIMEOUT = 10000; // 10 sekunder timeout

// Pending-forespørsler som venter på svar fra lobbyen
const pendingRequests = new Map();

// Lytter på svar fra lobbyen
window.addEventListener('message', function(event) {
  const msg = event.data;
  if (!msg || !msg.requestId) return;

  const pending = pendingRequests.get(msg.requestId);
  if (pending) {
    pendingRequests.delete(msg.requestId);
    clearTimeout(pending.timer);

    if (msg.data && msg.data.error) {
      pending.reject(new Error(msg.data.error));
    } else {
      pending.resolve(msg.data);
    }
  }
});

/**
 * Send melding til lobby-vinduet og vent på svar
 */
function sendToLobby(type, payload) {
  return new Promise(function(resolve, reject) {
    const requestId = type + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    const timer = setTimeout(function() {
      pendingRequests.delete(requestId);
      reject(new Error('Wallet bridge timeout: ' + type));
    }, RESPONSE_TIMEOUT);

    pendingRequests.set(requestId, { resolve: resolve, reject: reject, timer: timer });

    const message = Object.assign({ type: type, requestId: requestId }, payload || {});
    window.parent.postMessage(message, '*');
  });
}

/**
 * Generer unik idempotency-nøkkel
 */
function generateIdempotencyKey(action, gameId) {
  return action + '_' + (gameId || 'none') + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
}

export const walletBridge = {
  _token: null,
  _ready: false,

  /**
   * Initialiser wallet-broen.
   * Sender 'candy:ready' til lobbyen og mottar spillertoken tilbake.
   */
  async init() {
    if (this._ready) return;

    try {
      const response = await sendToLobby('candy:ready');
      if (response && response.token) {
        this._token = response.token;
        this._ready = true;
        console.log('[WalletBridge] Initialisert');
      }
    } catch (err) {
      console.error('[WalletBridge] Init feilet:', err);
      throw err;
    }
  },

  /**
   * Hent spillerens nåværende saldo
   * @returns {{ balance: number, currency: string, playerId: string }}
   */
  async getBalance() {
    return sendToLobby('candy:getBalance');
  },

  /**
   * Trekk penger fra spillerens lommebok (innsats)
   * @param {number} amount - Beløp i NOK
   * @param {string} gameId - Candy game round ID
   * @param {string} [description] - Valgfri beskrivelse
   * @returns {{ transactionId: string, balance: number, debited: number }}
   */
  async debit(amount, gameId, description) {
    if (amount <= 0) throw new Error('Amount must be positive');
    return sendToLobby('candy:debit', {
      amount: amount,
      gameId: gameId,
      idempotencyKey: generateIdempotencyKey('debit', gameId),
      description: description || 'CandyMania Bet'
    });
  },

  /**
   * Krediter penger til spillerens lommebok (gevinst)
   * @param {number} amount - Beløp i NOK
   * @param {string} gameId - Candy game round ID
   * @param {string} [description] - Valgfri beskrivelse
   * @returns {{ transactionId: string, balance: number, credited: number }}
   */
  async credit(amount, gameId, description) {
    if (amount <= 0) throw new Error('Amount must be positive');
    return sendToLobby('candy:credit', {
      amount: amount,
      gameId: gameId,
      idempotencyKey: generateIdempotencyKey('credit', gameId),
      description: description || 'CandyMania Win'
    });
  },

  /**
   * Lukk spillet og gå tilbake til lobbyen
   */
  close() {
    window.parent.postMessage({ type: 'candy:close' }, '*');
  },

  /**
   * Sjekk om broen er initialisert
   */
  get isReady() {
    return this._ready;
  }
};
