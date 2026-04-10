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

function emitAck(socket, event, data) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Timeout waiting for ${event}`));
      }
    }, 10000);

    socket.emit(event, data, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(response);
    });
  });
}

async function resolveDbSeed(envPath) {
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
      db.collection('player').findOne({}, { projection: { _id: 1, username: 1, hall: 1 } }),
      db.collection('hall').findOne({}, { projection: { _id: 1, name: 1 } }),
      db.collection('parentGame').findOne({ gameType: 'game_2' }, { projection: { _id: 1, gameName: 1 } }),
      db.collection('parentGame').findOne({ gameType: 'game_3' }, { projection: { _id: 1, gameName: 1 } }),
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

async function main() {
  const baseUrl = process.env.RECOVERY_BASE_URL || process.argv[2] || 'http://127.0.0.1:4010';
  const envPath =
    process.env.RECOVERY_ENV_FILE ||
    process.argv[3] ||
    path.join(__dirname, '..', '.env.recovery');
  const username = process.env.RECOVERY_USERNAME || process.argv[4] || 'martin';
  const password = process.env.RECOVERY_PASSWORD || process.argv[5] || 'martin';
  const appVersion = Number(process.env.RECOVERY_APP_VERSION || process.argv[6] || 1);

  const dbSeed = await resolveDbSeed(envPath);
  if (!dbSeed.hall?._id) {
    throw new Error('Fant ingen hall i recovery-databasen');
  }

  const defaultSocket = await connectSocket(baseUrl);
  const hallList = await emitAck(defaultSocket, 'HallList', {});
  const login = await emitAck(defaultSocket, 'LoginPlayer', {
    name: username,
    password,
    os: 'webgl',
    appVersion,
    hallId: dbSeed.hall._id.toString(),
  });

  const summary = {
    baseUrl,
    checkedAt: new Date().toISOString(),
    hallList,
    login,
  };

  defaultSocket.close();

  if (login?.status !== 'success' || !login?.result?.authToken) {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(2);
  }

  const authToken = login.result.authToken;
  const playerId = login.result.playerId;
  const hallId = login.result.hall;

  const authDefault = await connectSocket(baseUrl, {
    query: { authToken },
  });

  summary.getApprovedHallList = await emitAck(authDefault, 'GetApprovedHallList', {
    playerId,
  });
  summary.gameTypeList = await emitAck(authDefault, 'GameTypeList', {
    playerId,
  });
  summary.availableGames = await emitAck(authDefault, 'AvailableGames', {
    playerId,
    hallId,
  });
  authDefault.close();

  if (dbSeed.parentGame2?._id) {
    const game2Socket = await connectSocket(`${baseUrl}/Game2`, {
      query: { authToken },
    });
    summary.game2PlanList = await emitAck(game2Socket, 'Game2PlanList', {
      playerId,
      gameId: dbSeed.parentGame2._id.toString(),
    });
    game2Socket.close();
  } else {
    summary.game2PlanList = {
      status: 'skipped',
      message: 'Ingen parentGame for game_2 i databasen',
    };
  }

  if (dbSeed.parentGame3?._id) {
    const game3Socket = await connectSocket(`${baseUrl}/Game3`, {
      query: { authToken },
    });
    summary.game3PlanList = await emitAck(game3Socket, 'Game3PlanList', {
      playerId,
      gameId: dbSeed.parentGame3._id.toString(),
    });
    game3Socket.close();
  } else {
    summary.game3PlanList = {
      status: 'skipped',
      message: 'Ingen parentGame for game_3 i databasen',
    };
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
