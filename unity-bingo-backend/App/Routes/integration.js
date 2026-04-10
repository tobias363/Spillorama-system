'use strict';

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Sys = require('../../Boot/Sys');

const walletApiKey =
  process.env.EXT_GAME_WALLET_API_KEY ||
  process.env.WALLET_API_KEY ||
  '';
const candyIntegrationApiKey = process.env.CANDY_INTEGRATION_API_KEY || '';
const candyBackendUrl = (process.env.CANDY_BACKEND_URL || 'https://candy-backend-ldvg.onrender.com').replace(/\/+$/, '');

const candyToBingoMap = new Map();

const candyMappingSchema = new mongoose.Schema(
  {
    candyId: { type: String, required: true, unique: true, index: true },
    bingoId: { type: String, required: true }
  },
  {
    timestamps: true
  }
);

const CandyMapping =
  mongoose.models.CandyMapping || mongoose.model('CandyMapping', candyMappingSchema);

async function persistMapping(candyId, bingoId) {
  if (!candyId || !bingoId) {
    return;
  }

  candyToBingoMap.set(String(candyId), String(bingoId));
  await CandyMapping.findOneAndUpdate(
    { candyId: String(candyId) },
    { candyId: String(candyId), bingoId: String(bingoId) },
    { upsert: true, new: true }
  );
}

async function resolveFromDb(candyId) {
  const doc = await CandyMapping.findOne({ candyId: String(candyId) }).lean();
  if (!doc) {
    return null;
  }

  candyToBingoMap.set(String(doc.candyId), String(doc.bingoId));
  return String(doc.bingoId);
}

async function loadMappingsFromDb() {
  try {
    const docs = await CandyMapping.find({}).lean();
    docs.forEach((doc) => {
      candyToBingoMap.set(String(doc.candyId), String(doc.bingoId));
    });
    console.log('[CANDY-INTEGRATION] Loaded mappings:', docs.length);
  } catch (error) {
    console.error('[CANDY-INTEGRATION] Failed to preload mappings:', error.message);
  }
}

setTimeout(() => {
  loadMappingsFromDb().catch((error) => {
    console.error('[CANDY-INTEGRATION] Mapping preload crashed:', error.message);
  });
}, 5000);

function sendLaunchError(res, statusCode, code, message, debug) {
  const payload = {
    ok: false,
    error: {
      code,
      message
    }
  };

  if (debug) {
    payload.debug = debug;
  }

  return res.status(statusCode).json(payload);
}

function verifyWalletApiKey(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res
      .status(401)
      .json({ success: false, balance: 0, errorCode: 'INVALID_API_KEY', errorMessage: 'Missing API key' });
  }

  if (!walletApiKey) {
    return res.status(401).json({
      success: false,
      balance: 0,
      errorCode: 'INVALID_API_KEY',
      errorMessage: 'Provider wallet API key is not configured'
    });
  }

  const providedKey = authHeader.split(' ')[1];
  if (providedKey !== walletApiKey) {
    return res.status(401).json({
      success: false,
      balance: 0,
      errorCode: 'INVALID_API_KEY',
      errorMessage: 'Invalid API key'
    });
  }

  next();
}

async function resolveBingoPlayerId(candyPlayerId) {
  const normalizedId = String(candyPlayerId || '').trim();
  if (!normalizedId) {
    return null;
  }

  const mapped = candyToBingoMap.get(normalizedId);
  if (mapped) {
    return mapped;
  }

  const dbMapped = await resolveFromDb(normalizedId);
  if (dbMapped) {
    return dbMapped;
  }

  try {
    const player = await Sys.App.Services.PlayerServices.getSinglePlayerData(
      { _id: normalizedId },
      { _id: 1 }
    );
    if (player) {
      return normalizedId;
    }
  } catch (_error) {
    // Ignore invalid ObjectId lookups and keep returning null below.
  }

  return null;
}

async function getPlayerForWallet(playerId, projection) {
  return Sys.App.Services.PlayerServices.getSinglePlayerData({ _id: playerId }, projection);
}

function getPlayerHallId(player) {
  if (typeof player?.hallId === 'string' && player.hallId.trim()) {
    return player.hallId.trim();
  }

  if (Array.isArray(player?.hallId)) {
    const firstHallId = player.hallId.find((value) => typeof value === 'string' && value.trim());
    if (firstHallId) {
      return firstHallId.trim();
    }
  }

  if (typeof player?.hall?.id === 'string' && player.hall.id.trim()) {
    return player.hall.id.trim();
  }

  return '';
}

router.post(
  '/api/games/candy/launch',
  Sys.App.Middlewares.Backend.authenticatePlayerGameToken,
  async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const sessionToken =
        authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : '';
      const bingoPlayerId = req.player && req.player.id ? String(req.player.id) : '';

      if (!sessionToken || !bingoPlayerId) {
        return sendLaunchError(res, 401, 'UNAUTHORIZED', 'Missing player session.');
      }

      if (!candyIntegrationApiKey) {
        return sendLaunchError(
          res,
          500,
          'INTEGRATION_NOT_CONFIGURED',
          'Candy integration API key is not configured.'
        );
      }

      const returnUrl =
        typeof req.body?.returnUrl === 'string' && req.body.returnUrl.trim()
          ? req.body.returnUrl.trim()
          : `${req.protocol}://${req.get('host')}/web/`;

      const response = await fetch(`${candyBackendUrl}/api/integration/launch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': candyIntegrationApiKey
        },
        body: JSON.stringify({
          sessionToken,
          playerId: bingoPlayerId,
          currency: 'NOK',
          language: typeof req.body?.language === 'string' ? req.body.language.trim() : 'nb-NO',
          returnUrl
        })
      });

      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok || !body?.data?.embedUrl) {
        return sendLaunchError(
          res,
          502,
          'LAUNCH_FAILED',
          'Could not launch Candy Mania.',
          { status: response.status, body }
        );
      }

      const internalPlayerId = body.data.internalPlayerId || '';
      const internalWalletId = body.data.internalWalletId || '';

      await persistMapping(internalPlayerId, bingoPlayerId);
      await persistMapping(internalWalletId, bingoPlayerId);

      return res.json({
        ok: true,
        data: {
          embedUrl: body.data.embedUrl,
          expiresAt: body.data.expiresAt,
          internalPlayerId,
          internalWalletId
        }
      });
    } catch (error) {
      console.error('[CANDY-INTEGRATION] Launch error:', error);
      return sendLaunchError(
        res,
        500,
        'LAUNCH_FAILED',
        error && error.message ? error.message : 'Unknown Candy launch error.'
      );
    }
  }
);

router.get('/api/ext-wallet/balance', verifyWalletApiKey, async (req, res) => {
  try {
    const candyPlayerId = String(req.query.playerId || '').trim();
    if (!candyPlayerId) {
      return res
        .status(400)
        .json({ balance: 0, errorCode: 'PLAYER_NOT_FOUND', errorMessage: 'playerId required' });
    }

    const bingoPlayerId = await resolveBingoPlayerId(candyPlayerId);
    if (!bingoPlayerId) {
      return res.status(404).json({
        balance: 0,
        errorCode: 'PLAYER_NOT_FOUND',
        errorMessage: `No bingo player mapped for candy ID: ${candyPlayerId}`
      });
    }

    const player = await getPlayerForWallet(bingoPlayerId, { walletAmount: 1 });
    if (!player) {
      return res
        .status(404)
        .json({ balance: 0, errorCode: 'PLAYER_NOT_FOUND', errorMessage: 'Bingo player not found' });
    }

    return res.json({
      balance: +parseFloat(player.walletAmount).toFixed(2),
      currency: 'NOK'
    });
  } catch (error) {
    console.error('[CANDY-INTEGRATION] Balance error:', error);
    return res.status(500).json({
      balance: 0,
      errorCode: 'INTERNAL_ERROR',
      errorMessage: error && error.message ? error.message : 'Unknown balance error'
    });
  }
});

router.post('/api/ext-wallet/debit', verifyWalletApiKey, async (req, res) => {
  try {
    const candyPlayerId = String(req.body?.playerId || '').trim();
    const amount = Number(req.body?.amount);
    const transactionId = String(req.body?.transactionId || '').trim();
    const roundId = String(req.body?.roundId || '').trim();

    if (!candyPlayerId || !transactionId || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        balance: 0,
        transactionId,
        errorCode: 'INVALID_AMOUNT',
        errorMessage: 'Missing required fields'
      });
    }

    const bingoPlayerId = await resolveBingoPlayerId(candyPlayerId);
    if (!bingoPlayerId) {
      return res.status(404).json({
        success: false,
        balance: 0,
        transactionId,
        errorCode: 'PLAYER_NOT_FOUND',
        errorMessage: `No bingo player for candy ID: ${candyPlayerId}`
      });
    }

    const existingTx = await Sys.Game.Common.Services.PlayerServices.getSingleTransactionByData({
      idempotencyKey: transactionId
    });
    if (existingTx) {
      return res.json({
        success: true,
        balance: existingTx.afterBalance,
        transactionId,
        errorCode: 'DUPLICATE_TRANSACTION'
      });
    }

    const player = await getPlayerForWallet(bingoPlayerId, {
      walletAmount: 1,
      username: 1,
      hallId: 1,
      hall: 1
    });
    if (!player) {
      return res.status(404).json({
        success: false,
        balance: 0,
        transactionId,
        errorCode: 'PLAYER_NOT_FOUND',
        errorMessage: 'Bingo player not found'
      });
    }

    const currentBalance = +parseFloat(player.walletAmount).toFixed(2);
    if (currentBalance < amount) {
      return res.status(402).json({
        success: false,
        balance: currentBalance,
        transactionId,
        errorCode: 'INSUFFICIENT_FUNDS',
        errorMessage: 'Insufficient balance'
      });
    }

    const updatedPlayer = await Sys.App.Services.PlayerServices.findOneandUpdatePlayer(
      { _id: bingoPlayerId },
      { $inc: { walletAmount: -amount } },
      { new: true }
    );

    const internalTxId =
      'TRN' +
      (await Sys.Helper.bingo.ordNumFunction(Date.now())) +
      Math.floor(100000 + Math.random() * 900000);

    await Sys.Game.Common.Services.PlayerServices.createTransaction({
      transactionId: internalTxId,
      idempotencyKey: transactionId,
      playerId: bingoPlayerId,
      playerName: player.username,
      hallId: getPlayerHallId(player),
      category: 'debit',
      differenceAmount: amount,
      typeOfTransactionTotalAmount: amount,
      typeOfTransaction: `CandyMania Bet${roundId ? ` (round: ${roundId})` : ''}`,
      previousBalance: currentBalance,
      afterBalance: +parseFloat(updatedPlayer.walletAmount).toFixed(2),
      defineSlug: 'candyGame',
      amtCategory: 'realMoney',
      status: 'success',
      paymentBy: 'Wallet',
      gameId: roundId || null,
      createdAt: Date.now()
    });

    return res.json({
      success: true,
      balance: +parseFloat(updatedPlayer.walletAmount).toFixed(2),
      transactionId
    });
  } catch (error) {
    console.error('[CANDY-INTEGRATION] Debit error:', error);
    return res.status(500).json({
      success: false,
      balance: 0,
      transactionId: String(req.body?.transactionId || ''),
      errorCode: 'WALLET_API_ERROR',
      errorMessage: error && error.message ? error.message : 'Unknown debit error'
    });
  }
});

router.post('/api/ext-wallet/credit', verifyWalletApiKey, async (req, res) => {
  try {
    const candyPlayerId = String(req.body?.playerId || '').trim();
    const amount = Number(req.body?.amount);
    const transactionId = String(req.body?.transactionId || '').trim();
    const roundId = String(req.body?.roundId || '').trim();

    if (!candyPlayerId || !transactionId || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        balance: 0,
        transactionId,
        errorCode: 'INVALID_AMOUNT',
        errorMessage: 'Missing required fields'
      });
    }

    const bingoPlayerId = await resolveBingoPlayerId(candyPlayerId);
    if (!bingoPlayerId) {
      return res.status(404).json({
        success: false,
        balance: 0,
        transactionId,
        errorCode: 'PLAYER_NOT_FOUND',
        errorMessage: `No bingo player for candy ID: ${candyPlayerId}`
      });
    }

    const existingTx = await Sys.Game.Common.Services.PlayerServices.getSingleTransactionByData({
      idempotencyKey: transactionId
    });
    if (existingTx) {
      return res.json({
        success: true,
        balance: existingTx.afterBalance,
        transactionId,
        errorCode: 'DUPLICATE_TRANSACTION'
      });
    }

    const player = await getPlayerForWallet(bingoPlayerId, {
      walletAmount: 1,
      username: 1,
      hallId: 1,
      hall: 1
    });
    if (!player) {
      return res.status(404).json({
        success: false,
        balance: 0,
        transactionId,
        errorCode: 'PLAYER_NOT_FOUND',
        errorMessage: 'Bingo player not found'
      });
    }

    const currentBalance = +parseFloat(player.walletAmount).toFixed(2);
    const updatedPlayer = await Sys.App.Services.PlayerServices.findOneandUpdatePlayer(
      { _id: bingoPlayerId },
      { $inc: { walletAmount: amount } },
      { new: true }
    );

    const internalTxId =
      'TRN' +
      (await Sys.Helper.bingo.ordNumFunction(Date.now())) +
      Math.floor(100000 + Math.random() * 900000);

    await Sys.Game.Common.Services.PlayerServices.createTransaction({
      transactionId: internalTxId,
      idempotencyKey: transactionId,
      playerId: bingoPlayerId,
      playerName: player.username,
      hallId: getPlayerHallId(player),
      category: 'credit',
      differenceAmount: amount,
      typeOfTransactionTotalAmount: amount,
      typeOfTransaction: `CandyMania Win${roundId ? ` (round: ${roundId})` : ''}`,
      winningPrice: amount,
      previousBalance: currentBalance,
      afterBalance: +parseFloat(updatedPlayer.walletAmount).toFixed(2),
      defineSlug: 'candyGame',
      amtCategory: 'realMoney',
      status: 'success',
      paymentBy: 'Wallet',
      gameId: roundId || null,
      createdAt: Date.now()
    });

    return res.json({
      success: true,
      balance: +parseFloat(updatedPlayer.walletAmount).toFixed(2),
      transactionId
    });
  } catch (error) {
    console.error('[CANDY-INTEGRATION] Credit error:', error);
    return res.status(500).json({
      success: false,
      balance: 0,
      transactionId: String(req.body?.transactionId || ''),
      errorCode: 'WALLET_API_ERROR',
      errorMessage: error && error.message ? error.message : 'Unknown credit error'
    });
  }
});

router.get('/api/ext-wallet/diag', async (_req, res) => {
  try {
    const docs = await CandyMapping.find({}).lean();
    return res.json({
      ok: true,
      walletApiKeyConfigured: !!walletApiKey,
      candyIntegrationKeyConfigured: !!candyIntegrationApiKey,
      candyBackendUrl,
      mappings: {
        inMemory: candyToBingoMap.size,
        persisted: docs.length
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error && error.message ? error.message : 'Unknown diag error'
    });
  }
});

module.exports = router;
