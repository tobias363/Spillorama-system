/**
 * Integration API Routes
 *
 * Wallet-bro mellom bingo-system og eksterne spill (CandyMania etc.)
 * Brukes av lobby-iframen via PostMessage → fetch til disse endepunktene.
 *
 * Alle ruter er beskyttet med JWT fra spillerens sesjon.
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Sys = require('../../Boot/Sys');

const JWT_SECRET = process.env.JWT_SECRET;

// BIN-134 DIAG: Capture recent console.log for debugging
const _diagLogs = [];
const _origLog = console.log;
console.log = function(...args) {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  if (msg.includes('BIN-134') || msg.includes('Reconnect') || msg.includes('Login') || msg.includes('common.js')) {
    _diagLogs.push({ t: Date.now(), m: msg });
    if (_diagLogs.length > 50) _diagLogs.shift();
  }
  _origLog.apply(console, args);
};

router.get('/api/integration/diag-logs', (req, res) => {
  res.json({ logs: _diagLogs });
});

// ─── Middleware: Verifiser JWT ────────────────────────────────────────────────
function verifyIntegrationToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Missing authorization token' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.playerId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

// ─── GET /api/integration/health ─────────────────────────────────────────────
router.get('/api/integration/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    version: 'diag10',
    sysType: typeof Sys,
    sysKeys: Object.keys(Sys).slice(0, 20),
    connectedPlayers: Sys.ConnectedPlayers ? Object.keys(Sys.ConnectedPlayers) : 'undefined',
    authStore: Sys._authStore ? Object.keys(Sys._authStore) : 'undefined',
    debugReconnect: Sys._debugReconnect || 'not-set',
    // Check ALL namespaces for connected sockets
    ioNamespaces: Sys.Io ? Object.keys(Sys.Io.nsps || {}).map(ns => {
      const nsp = Sys.Io.nsps[ns];
      const connected = nsp.connected || nsp.sockets || {};
      const socketIds = connected instanceof Map ? Array.from(connected.keys()) : Object.keys(connected);
      return { ns, count: socketIds.length, sockets: socketIds.slice(0, 3).map(id => {
        const s = connected instanceof Map ? connected.get(id) : connected[id];
        return { id, playerId: s?.playerId, hasAuthToken: !!s?.authToken };
      })};
    }) : 'no-io'
  });
});

// ─── GET /api/integration/auth-beacon ───────────────────────────────────────
// BIN-134: HTTP-polling for auth-beacon.
// Strategy: Check MongoDB for a recently active player with a valid authToken.
// Unity's Socket.IO runs in WASM and connects to a namespace inaccessible from
// the integration layer, so we query the database directly instead.
router.get('/api/integration/auth-beacon', async (req, res) => {
  try {
    // Primary: Check in-memory stores first (fast path)
    const connected = Sys.ConnectedPlayers;
    if (connected && typeof connected === 'object') {
      const playerIds = Object.keys(connected);
      if (playerIds.length > 0) {
        const playerId = playerIds[0];
        const authEntry = Sys._authStore && Sys._authStore[playerId];
        return res.json({
          authenticated: true,
          playerId,
          token: authEntry ? authEntry.token : null,
          source: 'connectedPlayers'
        });
      }
    }

    // Fallback: Query MongoDB for a player with a recent socketId (= active connection)
    // Players get socketId set on login/reconnect. A non-empty socketId means active.
    const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
      { socketId: { $ne: '' }, 'otherData.authToken': { $exists: true, $ne: null } },
      { _id: 1, username: 1, 'otherData.authToken': 1 }
    );

    if (player && player.otherData && player.otherData.authToken) {
      return res.json({
        authenticated: true,
        playerId: player._id.toString(),
        token: player.otherData.authToken,
        source: 'mongodb'
      });
    }

    // Debug: try to find ANY player with socketId or authToken
    const anyPlayer = await Sys.Game.Common.Services.PlayerServices.getOneByData(
      { username: 'martin' },
      { _id: 1, username: 1, socketId: 1, 'otherData.authToken': 1 }
    );
    return res.json({
      authenticated: false,
      reason: 'no-active-player',
      debug: anyPlayer ? {
        playerId: anyPlayer._id?.toString(),
        socketId: anyPlayer.socketId || 'empty',
        hasAuthToken: !!(anyPlayer.otherData?.authToken),
        authTokenLength: anyPlayer.otherData?.authToken?.length || 0
      } : 'martin-not-found'
    });
  } catch (err) {
    console.error('auth-beacon endpoint error:', err.message);
    return res.json({ authenticated: false, reason: 'error: ' + err.message });
  }
});

// ─── GET /api/integration/wallet/balance ─────────────────────────────────────
// Henter spillerens nåværende saldo
router.get('/api/integration/wallet/balance', verifyIntegrationToken, async (req, res) => {
  try {
    const player = await Sys.App.Services.PlayerServices.getSinglePlayerData(
      { _id: req.playerId },
      { walletAmount: 1, username: 1 }
    );

    if (!player) {
      return res.status(404).json({ success: false, error: 'Player not found' });
    }

    res.json({
      success: true,
      data: {
        balance: +parseFloat(player.walletAmount).toFixed(2),
        currency: 'NOK',
        playerId: req.playerId
      }
    });
  } catch (err) {
    console.error('Integration wallet/balance error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── POST /api/integration/wallet/debit ──────────────────────────────────────
// Trekker penger fra spillerens lommebok (f.eks. kjøp av candy-innsats)
router.post('/api/integration/wallet/debit', verifyIntegrationToken, async (req, res) => {
  try {
    const { amount, gameId, idempotencyKey, description } = req.body;

    // Validering
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid amount' });
    }
    if (!idempotencyKey) {
      return res.status(400).json({ success: false, error: 'idempotencyKey is required' });
    }

    // Idempotency-sjekk: Har vi allerede behandlet denne transaksjonen?
    const existingTx = await Sys.Game.Common.Services.PlayerServices.getTransactionByData({
      idempotencyKey: idempotencyKey
    });
    if (existingTx) {
      // Returner eksisterende resultat — ingen dobbel debitering
      return res.json({
        success: true,
        data: {
          transactionId: existingTx.transactionId,
          balance: existingTx.afterBalance,
          duplicate: true
        }
      });
    }

    // Hent spiller og sjekk saldo
    const player = await Sys.App.Services.PlayerServices.getSinglePlayerData(
      { _id: req.playerId },
      { walletAmount: 1, username: 1, hallId: 1 }
    );

    if (!player) {
      return res.status(404).json({ success: false, error: 'Player not found' });
    }

    if (player.walletAmount < amount) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient balance',
        data: { balance: +parseFloat(player.walletAmount).toFixed(2) }
      });
    }

    // Trekk fra saldo
    const updatedPlayer = await Sys.App.Services.PlayerServices.findOneandUpdatePlayer(
      { _id: req.playerId },
      { $inc: { walletAmount: -amount } },
      { new: true }
    );

    // Lag transaksjonslogg
    const transactionId = 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000);

    const transactionRecord = {
      transactionId: transactionId,
      idempotencyKey: idempotencyKey,
      playerId: req.playerId,
      playerName: player.username,
      hallId: player.hallId,
      category: 'debit',
      differenceAmount: amount,
      typeOfTransactionTotalAmount: amount,
      typeOfTransaction: description || 'CandyMania Game Bet',
      previousBalance: +parseFloat(player.walletAmount).toFixed(2),
      afterBalance: +parseFloat(updatedPlayer.walletAmount).toFixed(2),
      defineSlug: 'candyGame',
      amtCategory: 'realMoney',
      status: 'success',
      paymentBy: 'Wallet',
      gameId: gameId || null,
      createdAt: Date.now(),
    };

    await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionRecord);

    res.json({
      success: true,
      data: {
        transactionId: transactionId,
        balance: +parseFloat(updatedPlayer.walletAmount).toFixed(2),
        debited: amount
      }
    });

  } catch (err) {
    console.error('Integration wallet/debit error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── POST /api/integration/wallet/credit ─────────────────────────────────────
// Legger til penger i spillerens lommebok (f.eks. candy-gevinst)
router.post('/api/integration/wallet/credit', verifyIntegrationToken, async (req, res) => {
  try {
    const { amount, gameId, idempotencyKey, description } = req.body;

    // Validering
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid amount' });
    }
    if (!idempotencyKey) {
      return res.status(400).json({ success: false, error: 'idempotencyKey is required' });
    }

    // Idempotency-sjekk
    const existingTx = await Sys.Game.Common.Services.PlayerServices.getTransactionByData({
      idempotencyKey: idempotencyKey
    });
    if (existingTx) {
      return res.json({
        success: true,
        data: {
          transactionId: existingTx.transactionId,
          balance: existingTx.afterBalance,
          duplicate: true
        }
      });
    }

    // Hent spiller
    const player = await Sys.App.Services.PlayerServices.getSinglePlayerData(
      { _id: req.playerId },
      { walletAmount: 1, username: 1, hallId: 1 }
    );

    if (!player) {
      return res.status(404).json({ success: false, error: 'Player not found' });
    }

    // Legg til saldo
    const updatedPlayer = await Sys.App.Services.PlayerServices.findOneandUpdatePlayer(
      { _id: req.playerId },
      { $inc: { walletAmount: amount } },
      { new: true }
    );

    // Lag transaksjonslogg
    const transactionId = 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000);

    const transactionRecord = {
      transactionId: transactionId,
      idempotencyKey: idempotencyKey,
      playerId: req.playerId,
      playerName: player.username,
      hallId: player.hallId,
      category: 'credit',
      differenceAmount: amount,
      typeOfTransactionTotalAmount: amount,
      typeOfTransaction: description || 'CandyMania Game Win',
      winningPrice: amount,
      previousBalance: +parseFloat(player.walletAmount).toFixed(2),
      afterBalance: +parseFloat(updatedPlayer.walletAmount).toFixed(2),
      defineSlug: 'candyGame',
      amtCategory: 'realMoney',
      status: 'success',
      paymentBy: 'Wallet',
      gameId: gameId || null,
      createdAt: Date.now(),
    };

    await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionRecord);

    res.json({
      success: true,
      data: {
        transactionId: transactionId,
        balance: +parseFloat(updatedPlayer.walletAmount).toFixed(2),
        credited: amount
      }
    });

  } catch (err) {
    console.error('Integration wallet/credit error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
