#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
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

async function main() {
  const envPath = process.argv[2] || path.join(__dirname, '..', '.env.recovery');
  const vars = readEnvFile(envPath);
  const uri = vars.MONGO_URI;
  if (!uri) {
    throw new Error(`MONGO_URI mangler i ${envPath}`);
  }

  const parsed = new URL(uri);
  const dbName = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.slice(1) : 'test';

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 20000,
    connectTimeoutMS: 20000,
  });

  try {
    await client.connect();
    const db = client.db(dbName);

    await db.collection('setting').updateOne(
      {},
      {
        $set: {
          daily_spending: 5000,
          monthly_spending: 50000,
        },
        $setOnInsert: {
          defaultChips: 0,
          rakePercenage: 0,
          chipsBought: 0,
          withdrawLimit: 0,
          amount: 0,
          commission: 0,
          processId: 0,
          android_version: 0,
          ios_version: 0,
          wind_linux_version: 0,
          webgl_version: 0,
          disable_store_link: 'Yes',
          android_store_link: '',
          ios_store_link: '',
          windows_store_link: '',
          webgl_store_link: '',
          multitable_status: 'off',
          systemChips: 0,
          adminExtraRakePercentage: 0,
          screenSaver: false,
          screenSaverTime: '5',
          imageTime: [],
          systemInformationData: '',
          gameTicketCounts: {},
        },
      },
      { upsert: true }
    );

    const hallResult = await db.collection('hall').findOneAndUpdate(
      { name: 'Spillorama Testhall' },
      {
        $set: {
          groupHall: {
            id: 'seed-group-1',
            hallName: 'Spillorama Testhall',
            name: 'Spillorama Testhall',
            status: 'Approved',
          },
          status: 'active',
          agents: ['seed-agent'],
          hallId: 'seed-hall-1',
        },
        $setOnInsert: {
          name: 'Spillorama Testhall',
          number: '1',
          ip: '',
          address: 'Seed Address 1',
          city: 'Oslo',
          isDeleted: false,
          products: [],
          activeAgents: [],
          hallCashBalance: 0,
          hallDropsafeBalance: 0,
          isSettled: true,
          otherData: {},
          controlDailyBalance: {
            dailyBalanceDiff: 0,
            hallCashBalanceDiff: 0,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    if (!hallResult.value) {
      throw new Error('Kunne ikke opprette eller hente seed-hall');
    }

    const player = await db.collection('player').findOne({});
    if (!player) {
      throw new Error('Fant ingen player-dokumenter i databasen');
    }

    const approvedHall = {
      id: hallResult.value._id.toString(),
      name: hallResult.value.name,
      status: 'Approved',
      groupHall: hallResult.value.groupHall || {
        id: 'seed-group-1',
        hallName: hallResult.value.name,
        name: hallResult.value.name,
        status: 'Approved',
      },
      dailySpending: 0,
      monthlySpending: 0,
      date: new Date().toISOString().slice(0, 10),
    };

    const existingApprovedHalls = Array.isArray(player.approvedHalls)
      ? player.approvedHalls.filter(
          (hall) => hall && hall.id && hall.id !== approvedHall.id
        )
      : [];

    await db.collection('player').updateOne(
      { _id: player._id },
      {
        $set: {
          hall: approvedHall,
          groupHall: {
            id: approvedHall.groupHall?.id || approvedHall.id,
            hallName: approvedHall.groupHall?.hallName || approvedHall.name,
            name: approvedHall.groupHall?.name || approvedHall.name,
            status: 'Approved',
          },
          approvedHalls: [approvedHall, ...existingApprovedHalls],
          isVerifiedByHall: true,
          isAlreadyApproved: true,
        },
      }
    );

    const counts = {};
    for (const name of ['setting', 'hall', 'player', 'pattern', 'gameType']) {
      counts[name] = await db.collection(name).countDocuments();
    }

    console.log(
      JSON.stringify(
        {
          dbName,
          hallId: hallResult.value._id.toString(),
          hallName: hallResult.value.name,
          playerId: player._id.toString(),
          counts,
        },
        null,
        2
      )
    );
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
