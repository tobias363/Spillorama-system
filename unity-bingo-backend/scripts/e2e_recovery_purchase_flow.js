#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const io = require('socket.io-client');
const { MongoClient } = require('mongodb');

function readEnvFile(envPath) {
  const raw = fs.readFileSync(envPath, 'utf8');
  const vars = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    vars[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return vars;
}

function connectSocket(url, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 10000,
      forceNew: true,
      multiplex: false,
      ...options,
    });

    const onConnect = () => {
      cleanup();
      resolve(socket);
    };

    const onError = (error) => {
      cleanup();
      socket.close();
      reject(error);
    };

    const cleanup = () => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
      socket.off('error', onError);
    };

    socket.on('connect', onConnect);
    socket.on('connect_error', onError);
    socket.on('error', onError);
  });
}

function emitAck(socket, event, data, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Timeout waiting for ${event}`));
    }, timeoutMs);

    socket.emit(event, data, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(response);
    });
  });
}

function waitForEvent(socket, event, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      socket.off(event, onEvent);
      clearTimeout(timeout);
    };

    const onEvent = (payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(payload);
    };

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Timeout waiting for pushed ${event}`));
    }, timeoutMs);

    socket.on(event, onEvent);
  });
}

async function resolveSeed(envPath) {
  const vars = readEnvFile(envPath);
  const uri = vars.MONGO_URI;
  const parsed = new URL(uri);
  const dbName =
    parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.slice(1) : 'test';

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 20000,
    connectTimeoutMS: 20000,
  });

  try {
    await client.connect();
    const db = client.db(dbName);
    const [player, hall, parentGame2, parentGame3] = await Promise.all([
      db.collection('player').findOne({}, { projection: { _id: 1, username: 1 } }),
      db.collection('hall').findOne({ status: 'active' }, { projection: { _id: 1, name: 1 } }),
      db.collection('parentGame').findOne(
        { gameType: 'game_2', 'otherData.recoverySeed': true },
        { projection: { _id: 1, gameName: 1 } }
      ),
      db.collection('parentGame').findOne(
        { gameType: 'game_3', 'otherData.recoverySeed': true },
        { projection: { _id: 1, gameName: 1 } }
      ),
    ]);

    return {
      player,
      hall,
      parentGame2,
      parentGame3,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

function requireSuccess(response, label) {
  if (!response || response.status !== 'success') {
    throw new Error(`${label} failed: ${JSON.stringify(response)}`);
  }
  return response;
}

async function login(baseUrl, username, password, hallId) {
  const defaultSocket = await connectSocket(baseUrl);
  try {
    const loginResponse = await emitAck(defaultSocket, 'LoginPlayer', {
      name: username,
      password,
      os: 'webgl',
      appVersion: 1,
      hallId,
    });
    return requireSuccess(loginResponse, 'LoginPlayer');
  } finally {
    defaultSocket.close();
  }
}

async function runGame2Flow(baseUrl, authToken, playerId, parentGameId) {
  const socket = await connectSocket(`${baseUrl}/Game2`, {
    query: { authToken },
  });

  try {
    const planList = requireSuccess(
      await emitAck(socket, 'Game2PlanList', { playerId, gameId: parentGameId }),
      'Game2PlanList'
    );

    const child = planList?.result?.upcomingGames?.[0];
    if (!child?.id) {
      throw new Error(`Game2PlanList returned no upcomingGames: ${JSON.stringify(planList)}`);
    }

    const before = requireSuccess(
      await emitAck(socket, 'Game2TicketPurchaseData', {
        playerId,
        subGameId: child.id,
        language: 'nor',
      }),
      'Game2TicketPurchaseData(before)'
    );

    const purchase = requireSuccess(
      await emitAck(socket, 'Game2BuyBlindTickets', {
        playerId,
        subGameId: child.id,
        parentGameId,
        ticketCount: 1,
        luckyNumber: 9,
        purchaseType: 'realMoney',
        voucherCode: '',
        language: 'nor',
      }),
      'Game2BuyBlindTickets'
    );

    const after = requireSuccess(
      await emitAck(socket, 'Game2TicketPurchaseData', {
        playerId,
        subGameId: child.id,
        language: 'nor',
      }),
      'Game2TicketPurchaseData(after)'
    );

    const subscribedEventPromise = waitForEvent(socket, 'SubscribeRoom');
    requireSuccess(
      await emitAck(socket, 'SubscribeRoom', {
        playerId,
        gameId: parentGameId,
        language: 'nor',
      }),
      'Game2 SubscribeRoom'
    );
    const subscribed = await subscribedEventPromise;

    const cancel = requireSuccess(
      await emitAck(socket, 'CancelGameTickets', {
        playerId,
        subGameId: child.id,
        language: 'nor',
      }),
      'Game2 CancelGameTickets'
    );

    const finalState = requireSuccess(
      await emitAck(socket, 'Game2TicketPurchaseData', {
        playerId,
        subGameId: child.id,
        language: 'nor',
      }),
      'Game2TicketPurchaseData(final)'
    );

    return {
      childGameId: child.id,
      beforePurchasedTickets: before.result?.ownPurchasedTicketCount ?? null,
      afterPurchasedTickets: after.result?.ownPurchasedTicketCount ?? null,
      subscribedTicketCount: subscribed?.ticketList?.length ?? null,
      subscribedTotalBet: subscribed?.totalBetAmount ?? null,
      purchaseMessage: purchase.message,
      cancelMessage: cancel.message,
      finalPurchasedTickets: finalState.result?.ownPurchasedTicketCount ?? null,
    };
  } finally {
    socket.close();
  }
}

async function runGame3Flow(baseUrl, authToken, playerId, parentGameId) {
  const socket = await connectSocket(`${baseUrl}/Game3`, {
    query: { authToken },
  });

  try {
    const planList = requireSuccess(
      await emitAck(socket, 'Game3PlanList', { playerId, gameId: parentGameId }),
      'Game3PlanList'
    );

    const child = planList?.result?.upcomingGames?.[0];
    if (!child?.id) {
      throw new Error(`Game3PlanList returned no upcomingGames: ${JSON.stringify(planList)}`);
    }

    const before = requireSuccess(
      await emitAck(socket, 'GetGame3PurchaseData', {
        playerId,
        gameId: child.id,
        language: 'nor',
      }),
      'GetGame3PurchaseData(before)'
    );

    const purchase = requireSuccess(
      await emitAck(socket, 'PurchaseGame3Tickets', {
        playerId,
        subGameId: child.id,
        purchaseType: 'realMoney',
        ticketQty: 1,
        voucherCode: '',
        language: 'nor',
      }),
      'PurchaseGame3Tickets'
    );

    const after = requireSuccess(
      await emitAck(socket, 'GetGame3PurchaseData', {
        playerId,
        gameId: child.id,
        language: 'nor',
      }),
      'GetGame3PurchaseData(after)'
    );

    const subscribed = requireSuccess(
      await emitAck(socket, 'SubscribeRoom', {
        playerId,
        gameId: parentGameId,
        language: 'nor',
      }),
      'Game3 SubscribeRoom'
    );

    const cancel = requireSuccess(
      await emitAck(socket, 'CancelGameTickets', {
        playerId,
        subGameId: child.id,
        language: 'nor',
      }),
      'Game3 CancelGameTickets'
    );

    const finalState = requireSuccess(
      await emitAck(socket, 'GetGame3PurchaseData', {
        playerId,
        gameId: child.id,
        language: 'nor',
      }),
      'GetGame3PurchaseData(final)'
    );

    return {
      childGameId: child.id,
      beforePurchasedTickets: before.result?.purchasedTickets ?? null,
      afterPurchasedTickets: after.result?.purchasedTickets ?? null,
      subscribedTicketCount: subscribed.result?.ticketList?.length ?? null,
      subscribedTotalBet: subscribed.result?.totalBetAmount ?? null,
      purchaseMessage: purchase.message,
      cancelMessage: cancel.message,
      finalPurchasedTickets: finalState.result?.purchasedTickets ?? null,
    };
  } finally {
    socket.close();
  }
}

async function main() {
  const baseUrl = process.env.RECOVERY_BASE_URL || process.argv[2] || 'http://127.0.0.1:4010';
  const envPath =
    process.env.RECOVERY_ENV_FILE ||
    process.argv[3] ||
    path.join(__dirname, '..', '.env.recovery');
  const username = process.env.RECOVERY_USERNAME || process.argv[4] || 'martin';
  const password = process.env.RECOVERY_PASSWORD || process.argv[5] || 'martin';

  const seed = await resolveSeed(envPath);
  if (!seed.player?._id || !seed.hall?._id || !seed.parentGame2?._id || !seed.parentGame3?._id) {
    throw new Error('Manglende recovery-seed for player/hall/parentGame2/parentGame3');
  }

  const loginResult = await login(baseUrl, username, password, seed.hall._id.toString());
  const authToken = loginResult.result.authToken;
  const playerId = loginResult.result.playerId;

  const game2 = await runGame2Flow(
    baseUrl,
    authToken,
    playerId,
    seed.parentGame2._id.toString()
  );
  const game3 = await runGame3Flow(
    baseUrl,
    authToken,
    playerId,
    seed.parentGame3._id.toString()
  );

  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        baseUrl,
        login: {
          status: loginResult.status,
          playerId: loginResult.result.playerId,
          hallId: loginResult.result.hall,
        },
        game2,
        game3,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
