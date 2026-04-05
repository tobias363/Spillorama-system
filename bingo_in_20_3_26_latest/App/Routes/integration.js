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
  res.json({ status: 'ok', timestamp: Date.now() });
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

    // Fallback 1: Player with non-empty socketId AND authToken (= actively connected)
    const activePlayer = await Sys.Game.Common.Services.PlayerServices.getOneByData(
      { socketId: { $nin: [null, ''] }, 'otherData.authToken': { $exists: true, $ne: null } },
      { _id: 1, username: 1, 'otherData.authToken': 1, socketId: 1 }
    );

    if (activePlayer && activePlayer.otherData && activePlayer.otherData.authToken) {
      return res.json({
        authenticated: true,
        playerId: activePlayer._id.toString(),
        username: activePlayer.username,
        token: activePlayer.otherData.authToken,
        source: 'mongodb-active'
      });
    }

    // Fallback 2: Any player with a valid authToken (socketId may be empty after server restart)
    const tokenPlayer = await Sys.Game.Common.Services.PlayerServices.getOneByData(
      { 'otherData.authToken': { $exists: true, $ne: null }, userType: { $ne: 'Bot' } },
      { _id: 1, username: 1, 'otherData.authToken': 1, socketId: 1 }
    );

    if (tokenPlayer && tokenPlayer.otherData && tokenPlayer.otherData.authToken) {
      // Verify the stored token is still valid before returning it
      try {
        jwt.verify(tokenPlayer.otherData.authToken, JWT_SECRET);
        return res.json({
          authenticated: true,
          playerId: tokenPlayer._id.toString(),
          username: tokenPlayer.username,
          token: tokenPlayer.otherData.authToken,
          source: 'mongodb-token'
        });
      } catch (e) {
        // Token expired — generate a fresh one
        const freshToken = jwt.sign({ id: tokenPlayer._id.toString() }, JWT_SECRET, { expiresIn: '1d' });
        return res.json({
          authenticated: true,
          playerId: tokenPlayer._id.toString(),
          username: tokenPlayer.username,
          token: freshToken,
          source: 'mongodb-fresh-token'
        });
      }
    }

    return res.json({ authenticated: false, reason: 'no-active-player' });
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

// ─── GET /api/integration/candy-launch ──────────────────────────────────────
// Proxy-kall til candy-backend for å starte CandyMania for en innlogget spiller.
// Bruker IntegrationLaunchHandler via /api/integration/launch (med X-API-Key)
// for å opprette spillerkobling, wallet-konto, sesjon og launch-token.
// Faller tilbake til enkel admin-token-flyt dersom integration mode ikke er aktivt.
const CANDY_BACKEND_URL = process.env.CANDY_BACKEND_URL || 'https://bingosystem-staging.onrender.com';
const CANDY_ADMIN_TOKEN = process.env.CANDY_ADMIN_TOKEN || '';
const CANDY_INTEGRATION_API_KEY = process.env.CANDY_INTEGRATION_API_KEY || '';

router.get('/api/integration/candy-launch', async (req, res) => {
  try {
    // Hent innlogget spiller fra auth-beacon (MongoDB)
    let playerId = null;
    let sessionToken = null;

    const connected = Sys.ConnectedPlayers;
    if (connected && typeof connected === 'object') {
      const playerIds = Object.keys(connected);
      if (playerIds.length > 0) {
        playerId = playerIds[0];
        const authEntry = Sys._authStore && Sys._authStore[playerId];
        sessionToken = authEntry ? authEntry.token : null;
      }
    }

    // Fallback: Finn spiller i MongoDB
    if (!playerId) {
      const activePlayer = await Sys.Game.Common.Services.PlayerServices.getOneByData(
        { 'otherData.authToken': { $exists: true, $ne: null }, userType: { $ne: 'Bot' } },
        { _id: 1, 'otherData.authToken': 1 }
      );
      if (activePlayer) {
        playerId = activePlayer._id.toString();
        sessionToken = activePlayer.otherData?.authToken;
      }
    }

    if (!playerId) {
      return res.status(401).json({ success: false, error: 'Ingen innlogget spiller funnet' });
    }

    // Strategi 1: Prøv IntegrationLaunchHandler (full spillerkobling + sesjon)
    if (CANDY_INTEGRATION_API_KEY) {
      try {
        const response = await fetch(CANDY_BACKEND_URL + '/api/integration/launch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': CANDY_INTEGRATION_API_KEY
          },
          body: JSON.stringify({
            playerId: playerId,
            sessionToken: sessionToken || 'bingo-session-' + playerId
          })
        });

        const data = await response.json();
        if (response.ok && data.ok !== false) {
          const result = data.data || data;
          const embedUrl = result.embedUrl || result.launchUrl;
          const launchToken = result.launchToken;

          // Bygg iframe-URL
          let iframeUrl;
          if (embedUrl) {
            iframeUrl = embedUrl;
          } else if (launchToken) {
            iframeUrl = CANDY_BACKEND_URL + '/candy/#lt=' + encodeURIComponent(launchToken);
          }

          if (iframeUrl) {
            return res.json({
              success: true,
              data: { iframeUrl, expiresAt: result.expiresAt }
            });
          }
        }
        // Hvis integration launch feilet, fall gjennom til strategi 2
        console.warn('Integration launch returned unexpected response, falling back to admin token');
      } catch (integrationErr) {
        console.warn('Integration launch failed, falling back to admin token:', integrationErr.message);
      }
    }

    // Strategi 2: Fallback til enkel admin-token-flyt
    if (!CANDY_ADMIN_TOKEN) {
      return res.status(503).json({ success: false, error: 'Candy launch not configured' });
    }

    const response = await fetch(CANDY_BACKEND_URL + '/api/games/candy/launch-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CANDY_ADMIN_TOKEN
      },
      body: JSON.stringify({ hallId: 'hall-default' })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      return res.status(502).json({ success: false, error: data.error || 'Candy backend error' });
    }

    const launchToken = data.data.launchToken;
    const launchUrl = data.data.launchUrl || (CANDY_BACKEND_URL + '/candy/');
    const iframeUrl = launchUrl + '#lt=' + encodeURIComponent(launchToken);

    res.json({
      success: true,
      data: { iframeUrl, expiresAt: data.data.expiresAt }
    });
  } catch (err) {
    console.error('candy-launch proxy error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
