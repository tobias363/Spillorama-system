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
const mongoose = require('mongoose');
const Sys = require('../../Boot/Sys');

const JWT_SECRET = process.env.JWT_SECRET;
const INTEGRATION_API_KEY = process.env.CANDY_INTEGRATION_API_KEY;

// ─── Player mapping: candyUserId → bingoPlayerId ────────────────────────────
// In-memory cache + MongoDB persistence. Survives restarts via DB.
const _candyToBingoMap = new Map(); // candyUserId → bingoPlayerId
const _bingoToCandyMap = new Map(); // bingoPlayerId → candyUserId

// ─── MongoDB model for persistent wallet mapping ────────────────────────────
const candyMappingSchema = new mongoose.Schema({
  candyId: { type: String, required: true, unique: true, index: true },
  bingoId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
const CandyMapping = mongoose.model('CandyMapping', candyMappingSchema);

// Persist a mapping to MongoDB + in-memory cache
async function persistMapping(candyId, bingoId) {
  _candyToBingoMap.set(String(candyId), String(bingoId));
  try {
    await CandyMapping.findOneAndUpdate(
      { candyId: String(candyId) },
      { candyId: String(candyId), bingoId: String(bingoId), updatedAt: new Date() },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error('[EXT-WALLET] Failed to persist mapping to DB:', err.message);
  }
}

// Load a mapping from DB if not in memory
async function resolveFromDb(candyId) {
  const doc = await CandyMapping.findOne({ candyId: String(candyId) });
  if (doc) {
    _candyToBingoMap.set(doc.candyId, doc.bingoId); // Warm cache
    return doc.bingoId;
  }
  return null;
}

// Load all mappings from DB on startup
async function loadMappingsFromDb() {
  try {
    const docs = await CandyMapping.find({});
    for (const doc of docs) {
      _candyToBingoMap.set(doc.candyId, doc.bingoId);
    }
    console.log('[EXT-WALLET] Loaded', docs.length, 'mappings from DB');
  } catch (err) {
    console.error('[EXT-WALLET] Failed to load mappings from DB:', err.message);
  }
}
// Load on module init (will run once Mongoose is connected)
setTimeout(() => loadMappingsFromDb(), 5000);

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

// ─── Middleware: Verifiser API-nøkkel (for ext-wallet kall fra candy-backend) ─
function verifyApiKey(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[EXT-WALLET] AUTH FAIL: Missing Bearer header on', req.method, req.url);
    return res.status(401).json({ success: false, errorCode: 'INVALID_API_KEY', errorMessage: 'Missing API key' });
  }
  const key = authHeader.split(' ')[1];
  if (!INTEGRATION_API_KEY) {
    console.log('[EXT-WALLET] AUTH FAIL: CANDY_INTEGRATION_API_KEY not set on bingo-system!');
    return res.status(401).json({ success: false, errorCode: 'INVALID_API_KEY', errorMessage: 'Server API key not configured' });
  }
  if (key !== INTEGRATION_API_KEY) {
    console.log('[EXT-WALLET] AUTH FAIL: Key mismatch. Received prefix:', key.substring(0, 4), 'Expected prefix:', INTEGRATION_API_KEY.substring(0, 4));
    return res.status(401).json({ success: false, errorCode: 'INVALID_API_KEY', errorMessage: 'Invalid API key' });
  }
  next();
}

// ─── GET /api/integration/health ─────────────────────────────────────────────
router.get('/api/integration/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    version: 'wallet-bridge-v1',
    walletMappings: _candyToBingoMap.size,
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
    // Only count players with status "Online" — disconnect sets "Offline" but
    // does not delete the entry, so stale entries must be filtered out.
    const connected = Sys.ConnectedPlayers;
    if (connected && typeof connected === 'object') {
      const onlineIds = Object.keys(connected).filter(
        id => connected[id] && connected[id].status === 'Online'
      );
      if (onlineIds.length > 0) {
        const playerId = onlineIds[0];
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

// ─── POST /api/integration/candy-launch ─────────────────────────────────────
// Bruker candy-backendets integrasjons-launch endepunkt (designet for dette).
// Returnerer embedUrl med launch token (?lt=TOKEN) som React SPA håndterer.
router.post('/api/integration/candy-launch', verifyIntegrationToken, async (req, res) => {
  const CANDY_BACKEND_URL = process.env.CANDY_BACKEND_URL || 'https://candy-backend-ldvg.onrender.com';
  const CANDY_API_KEY = process.env.CANDY_INTEGRATION_API_KEY;

  try {
    // Kall candy-backendets integration launch endepunkt
    // Dette oppretter en intern spiller, wallet-mapping og launch token i ett kall
    var launchRes = await fetch(CANDY_BACKEND_URL + '/api/integration/launch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': CANDY_API_KEY
      },
      body: JSON.stringify({
        sessionToken: req.headers.authorization.split(' ')[1], // bingo JWT
        playerId: req.playerId,
        currency: 'NOK'
      })
    });
    var launchData = await launchRes.json();

    if (!launchRes.ok || !launchData.ok) {
      console.error('candy integration launch failed:', launchData);
      return res.status(502).json({
        success: false,
        error: 'Integration launch failed: ' + (launchData.error?.message || launchData.error?.code || 'unknown'),
        debug: { status: launchRes.status, data: launchData }
      });
    }

    var embedUrl = launchData.data.embedUrl;
    var internalPlayerId = launchData.data.internalPlayerId;
    var internalWalletId = launchData.data.internalWalletId;

    // Lagre mapping for wallet-bridge (ExternalWalletAdapter sender internalWalletId som playerId)
    // Persisteres til MongoDB så mappinger overlever restarter.
    if (internalWalletId) {
      await persistMapping(internalWalletId, req.playerId);
      console.log('BIN-134: Mapped walletId=' + internalWalletId + ' → bingo=' + req.playerId);
    }
    if (internalPlayerId) {
      await persistMapping(internalPlayerId, req.playerId);
      console.log('BIN-134: Mapped playerId=' + internalPlayerId + ' → bingo=' + req.playerId);
    }
    _bingoToCandyMap.set(req.playerId, String(internalWalletId || internalPlayerId || ''));

    res.json({
      success: true,
      embedUrl: embedUrl,
      bingoPlayerId: req.playerId,
      internalPlayerId: internalPlayerId,
      internalWalletId: internalWalletId
    });
  } catch (err) {
    console.error('candy-launch error:', err.message);
    res.status(502).json({
      success: false,
      error: 'Failed to launch candy: ' + err.message
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// External Wallet API — kalles av candy-backend ExternalWalletAdapter
// Autentiseres med API-nøkkel, IKKE JWT.
// ═════════════════════════════════════════════════════════════════════════════

// Helper: Resolve candyPlayerId → bingoPlayerId
// Checks: 1) in-memory cache, 2) MongoDB, 3) direct bingo player lookup
async function resolveBingoPlayerId(candyPlayerId) {
  // 1. In-memory cache (fastest)
  const mapped = _candyToBingoMap.get(candyPlayerId);
  if (mapped) return mapped;

  // 2. MongoDB (survives restarts)
  const dbMapped = await resolveFromDb(candyPlayerId);
  if (dbMapped) return dbMapped;

  // 3. Fallback: the candyPlayerId might BE the bingoPlayerId (direct mapping)
  try {
    const player = await Sys.App.Services.PlayerServices.getSinglePlayerData(
      { _id: candyPlayerId },
      { _id: 1 }
    );
    if (player) return candyPlayerId;
  } catch (_) { /* not a valid ObjectId, continue */ }

  return null;
}

// ─── GET /api/integration/ext-wallet/balance ────────────────────────────────
router.get('/api/integration/ext-wallet/balance', verifyApiKey, async (req, res) => {
  const t0 = Date.now();
  console.log('[EXT-WALLET] GET /balance', { playerId: req.query.playerId, ts: new Date().toISOString() });
  try {
    const candyPlayerId = req.query.playerId;
    if (!candyPlayerId) {
      console.log('[EXT-WALLET] /balance → 400 missing playerId');
      return res.status(400).json({ balance: 0, errorCode: 'PLAYER_NOT_FOUND', errorMessage: 'playerId required' });
    }

    const bingoPlayerId = await resolveBingoPlayerId(String(candyPlayerId));
    console.log('[EXT-WALLET] /balance resolve:', { candyPlayerId, bingoPlayerId, mapSize: _candyToBingoMap.size });
    if (!bingoPlayerId) {
      console.log('[EXT-WALLET] /balance → 404 no mapping. Current mappings:', [..._candyToBingoMap.entries()].map(([k,v]) => k.substring(0,20) + '→' + v.substring(0,10)));
      return res.status(404).json({ balance: 0, errorCode: 'PLAYER_NOT_FOUND', errorMessage: 'No bingo player mapped for candy ID: ' + candyPlayerId });
    }

    const player = await Sys.App.Services.PlayerServices.getSinglePlayerData(
      { _id: bingoPlayerId },
      { walletAmount: 1 }
    );

    if (!player) {
      console.log('[EXT-WALLET] /balance → 404 bingo player not found in DB:', bingoPlayerId);
      return res.status(404).json({ balance: 0, errorCode: 'PLAYER_NOT_FOUND', errorMessage: 'Bingo player not found' });
    }

    const balance = +parseFloat(player.walletAmount).toFixed(2);
    console.log('[EXT-WALLET] /balance → 200 OK', { balance, ms: Date.now() - t0 });
    res.json({ balance, currency: 'NOK' });
  } catch (err) {
    console.error('[EXT-WALLET] /balance → 500 ERROR', { error: err.message, ms: Date.now() - t0 });
    res.status(500).json({ balance: 0, errorCode: 'INTERNAL_ERROR', errorMessage: err.message });
  }
});

// ─── POST /api/integration/ext-wallet/debit ─────────────────────────────────
router.post('/api/integration/ext-wallet/debit', verifyApiKey, async (req, res) => {
  console.log('[EXT-WALLET] POST /debit', { playerId: req.body?.playerId, amount: req.body?.amount, txId: req.body?.transactionId });
  try {
    const { playerId: candyPlayerId, amount, transactionId, roundId, currency } = req.body;

    if (!candyPlayerId || !amount || amount <= 0 || !transactionId) {
      return res.status(400).json({ success: false, balance: 0, transactionId: transactionId || '', errorCode: 'INVALID_AMOUNT', errorMessage: 'Missing required fields' });
    }

    const bingoPlayerId = await resolveBingoPlayerId(String(candyPlayerId));
    if (!bingoPlayerId) {
      return res.status(404).json({ success: false, balance: 0, transactionId, errorCode: 'PLAYER_NOT_FOUND', errorMessage: 'No bingo player for candy ID: ' + candyPlayerId });
    }

    // Idempotency: check if this transactionId already processed
    const existingTx = await Sys.Game.Common.Services.PlayerServices.getTransactionByData({ idempotencyKey: transactionId });
    if (existingTx) {
      return res.json({ success: true, balance: existingTx.afterBalance, transactionId, errorCode: 'DUPLICATE_TRANSACTION' });
    }

    // Get player and check balance
    const player = await Sys.App.Services.PlayerServices.getSinglePlayerData(
      { _id: bingoPlayerId },
      { walletAmount: 1, username: 1, hallId: 1 }
    );
    if (!player) {
      return res.status(404).json({ success: false, balance: 0, transactionId, errorCode: 'PLAYER_NOT_FOUND', errorMessage: 'Bingo player not found' });
    }

    if (player.walletAmount < amount) {
      return res.status(402).json({ success: false, balance: +parseFloat(player.walletAmount).toFixed(2), transactionId, errorCode: 'INSUFFICIENT_FUNDS', errorMessage: 'Insufficient balance' });
    }

    // Debit
    const updatedPlayer = await Sys.App.Services.PlayerServices.findOneandUpdatePlayer(
      { _id: bingoPlayerId },
      { $inc: { walletAmount: -amount } },
      { new: true }
    );

    // Transaction log
    const internalTxId = 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000);
    await Sys.Game.Common.Services.PlayerServices.createTransaction({
      transactionId: internalTxId,
      idempotencyKey: transactionId,
      playerId: bingoPlayerId,
      playerName: player.username,
      hallId: player.hallId,
      category: 'debit',
      differenceAmount: amount,
      typeOfTransactionTotalAmount: amount,
      typeOfTransaction: 'CandyMania Bet (round: ' + (roundId || 'unknown') + ')',
      previousBalance: +parseFloat(player.walletAmount).toFixed(2),
      afterBalance: +parseFloat(updatedPlayer.walletAmount).toFixed(2),
      defineSlug: 'candyGame',
      amtCategory: 'realMoney',
      status: 'success',
      paymentBy: 'Wallet',
      gameId: roundId || null,
      createdAt: Date.now(),
    });

    res.json({
      success: true,
      balance: +parseFloat(updatedPlayer.walletAmount).toFixed(2),
      transactionId: transactionId
    });
  } catch (err) {
    console.error('ext-wallet/debit error:', err);
    res.status(500).json({ success: false, balance: 0, transactionId: req.body?.transactionId || '', errorCode: 'WALLET_API_ERROR', errorMessage: err.message });
  }
});

// ─── POST /api/integration/ext-wallet/credit ────────────────────────────────
router.post('/api/integration/ext-wallet/credit', verifyApiKey, async (req, res) => {
  console.log('[EXT-WALLET] POST /credit', { playerId: req.body?.playerId, amount: req.body?.amount, txId: req.body?.transactionId });
  try {
    const { playerId: candyPlayerId, amount, transactionId, roundId, currency } = req.body;

    if (!candyPlayerId || !amount || amount <= 0 || !transactionId) {
      return res.status(400).json({ success: false, balance: 0, transactionId: transactionId || '', errorCode: 'INVALID_AMOUNT', errorMessage: 'Missing required fields' });
    }

    const bingoPlayerId = await resolveBingoPlayerId(String(candyPlayerId));
    if (!bingoPlayerId) {
      return res.status(404).json({ success: false, balance: 0, transactionId, errorCode: 'PLAYER_NOT_FOUND', errorMessage: 'No bingo player for candy ID: ' + candyPlayerId });
    }

    // Idempotency
    const existingTx = await Sys.Game.Common.Services.PlayerServices.getTransactionByData({ idempotencyKey: transactionId });
    if (existingTx) {
      return res.json({ success: true, balance: existingTx.afterBalance, transactionId, errorCode: 'DUPLICATE_TRANSACTION' });
    }

    // Get player
    const player = await Sys.App.Services.PlayerServices.getSinglePlayerData(
      { _id: bingoPlayerId },
      { walletAmount: 1, username: 1, hallId: 1 }
    );
    if (!player) {
      return res.status(404).json({ success: false, balance: 0, transactionId, errorCode: 'PLAYER_NOT_FOUND', errorMessage: 'Bingo player not found' });
    }

    // Credit
    const updatedPlayer = await Sys.App.Services.PlayerServices.findOneandUpdatePlayer(
      { _id: bingoPlayerId },
      { $inc: { walletAmount: amount } },
      { new: true }
    );

    // Transaction log
    const internalTxId = 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000);
    await Sys.Game.Common.Services.PlayerServices.createTransaction({
      transactionId: internalTxId,
      idempotencyKey: transactionId,
      playerId: bingoPlayerId,
      playerName: player.username,
      hallId: player.hallId,
      category: 'credit',
      differenceAmount: amount,
      typeOfTransactionTotalAmount: amount,
      typeOfTransaction: 'CandyMania Win (round: ' + (roundId || 'unknown') + ')',
      winningPrice: amount,
      previousBalance: +parseFloat(player.walletAmount).toFixed(2),
      afterBalance: +parseFloat(updatedPlayer.walletAmount).toFixed(2),
      defineSlug: 'candyGame',
      amtCategory: 'realMoney',
      status: 'success',
      paymentBy: 'Wallet',
      gameId: roundId || null,
      createdAt: Date.now(),
    });

    res.json({
      success: true,
      balance: +parseFloat(updatedPlayer.walletAmount).toFixed(2),
      transactionId: transactionId
    });
  } catch (err) {
    console.error('ext-wallet/credit error:', err);
    res.status(500).json({ success: false, balance: 0, transactionId: req.body?.transactionId || '', errorCode: 'WALLET_API_ERROR', errorMessage: err.message });
  }
});

// ─── GET /api/integration/ext-wallet/mapping ────────────────────────────────
// Debug: sjekk gjeldende mapping
router.get('/api/integration/ext-wallet/mapping', (req, res) => {
  const mappings = [];
  _candyToBingoMap.forEach((bingoId, candyId) => {
    mappings.push({ candyId, bingoId });
  });
  res.json({ count: mappings.length, mappings });
});

// ─── GET /api/integration/ext-wallet/diag ────────────────────────────────────
// Diagnostikk-endepunkt: sjekk hele wallet-bridge kjeden uten API-key.
// Returnerer detaljert status for debugging.
router.get('/api/integration/ext-wallet/diag', async (req, res) => {
  const diag = {
    timestamp: new Date().toISOString(),
    apiKeyConfigured: !!INTEGRATION_API_KEY,
    apiKeyLength: INTEGRATION_API_KEY ? INTEGRATION_API_KEY.length : 0,
    apiKeyPrefix: INTEGRATION_API_KEY ? INTEGRATION_API_KEY.substring(0, 4) + '...' : 'NOT_SET',
    memoryMappings: {
      count: _candyToBingoMap.size,
      entries: []
    },
    dbMappings: {
      count: 0,
      entries: []
    },
    testBalance: null
  };

  // List in-memory mappings
  _candyToBingoMap.forEach((bingoId, candyId) => {
    diag.memoryMappings.entries.push({ candyId, bingoId });
  });

  // List DB mappings
  try {
    const dbDocs = await CandyMapping.find({}).lean();
    diag.dbMappings.count = dbDocs.length;
    diag.dbMappings.entries = dbDocs.map(d => ({ candyId: d.candyId, bingoId: d.bingoId, updatedAt: d.updatedAt }));
  } catch (err) {
    diag.dbMappings.error = err.message;
  }

  // If playerId provided, test the full balance chain
  const testPlayerId = req.query.playerId;
  if (testPlayerId) {
    try {
      const bingoId = await resolveBingoPlayerId(String(testPlayerId));
      if (!bingoId) {
        diag.testBalance = { step: 'resolve', error: 'No mapping found for: ' + testPlayerId };
      } else {
        const player = await Sys.App.Services.PlayerServices.getSinglePlayerData(
          { _id: bingoId },
          { walletAmount: 1, username: 1 }
        );
        if (!player) {
          diag.testBalance = { step: 'db-lookup', bingoId, error: 'Player not found in DB' };
        } else {
          diag.testBalance = {
            step: 'success',
            bingoId,
            username: player.username,
            balance: +parseFloat(player.walletAmount).toFixed(2)
          };
        }
      }
    } catch (err) {
      diag.testBalance = { step: 'exception', error: err.message };
    }
  }

  res.json(diag);
});

// ─── Image proxy: bypass CORS for images from external server ────────────────
// Unity WebGL loads images via XHR and fetch() from spillorama.aistechnolabs.info,
// which doesn't send CORS headers for the Render domain. This proxies those
// requests same-origin. Handles both /admin/images/* and /profile/bingo/* paths.
router.get('/api/proxy/extimg/*', async (req, res) => {
  const imgPath = req.params[0];
  // Whitelist: only allow image file extensions
  if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(imgPath)) {
    return res.status(400).json({ error: 'Only image files allowed' });
  }
  // Only allow known safe path prefixes
  if (!/^(admin\/images|profile\/bingo)\//.test(imgPath)) {
    return res.status(400).json({ error: 'Path not allowed' });
  }
  const upstream = 'https://spillorama.aistechnolabs.info/' + imgPath;
  try {
    const imgRes = await fetch(upstream);
    if (!imgRes.ok) {
      return res.status(imgRes.status).end();
    }
    res.set('Content-Type', imgRes.headers.get('content-type') || 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Access-Control-Allow-Origin', '*');
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('Image proxy error:', err.message);
    res.status(502).end();
  }
});

module.exports = router;
