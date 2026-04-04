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
