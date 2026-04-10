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

async function collectionCount(db, name) {
  const exists = await db.listCollections({ name }).hasNext();
  if (!exists) return 0;
  return db.collection(name).countDocuments();
}

async function main() {
  const envPath = process.argv[2] || path.join(__dirname, '..', '.env.recovery');
  const vars = readEnvFile(envPath);
  const uri = vars.MONGO_URI;
  if (!uri) {
    throw new Error(`MONGO_URI mangler i ${envPath}`);
  }

  const parsed = new URL(uri);
  const dbName =
    parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.slice(1) : 'test';

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 20000,
    connectTimeoutMS: 20000,
  });

  const loginCritical = ['setting', 'hall', 'player', 'pattern', 'gameType'];
  const scheduleCritical = ['dailySchedule', 'schedules', 'assignedHalls'];
  const lobbyCritical = [
    'parentGame',
    'game',
    'subGame',
    'subGame1',
    'subGame5',
    'background',
    'theme',
    'slotmachines',
  ];

  try {
    await client.connect();
    const db = client.db(dbName);
    const counts = {};

    for (const name of [...loginCritical, ...scheduleCritical, ...lobbyCritical, 'user', 'agent']) {
      counts[name] = await collectionCount(db, name);
    }

    const [setting, hall, player, gameTypes, dailySchedule, schedule, assignedHall] = await Promise.all([
      db.collection('setting').findOne({}, { projection: { _id: 1, webgl_version: 1, screenSaver: 1, daily_spending: 1, monthly_spending: 1 } }),
      db.collection('hall').findOne({}, { projection: { _id: 1, name: 1, status: 1, agents: 1, groupHall: 1, hallId: 1 } }),
      db.collection('player').findOne({}, { projection: { _id: 1, username: 1, userType: 1, hall: 1, groupHall: 1, approvedHalls: 1, status: 1 } }),
      db.collection('gameType').find({}, { projection: { _id: 0, name: 1, photo: 1, type: 1 } }).toArray(),
      db.collection('dailySchedule').findOne({}, { projection: { _id: 1, name: 1, status: 1, startDate: 1, endDate: 1, days: 1, halls: 1, allHallsId: 1, groupHalls: 1, otherData: 1 } }),
      db.collection('schedules').findOne({}, { projection: { _id: 1, scheduleName: 1, scheduleType: 1, status: 1, subGames: 1, manualStartTime: 1, manualEndTime: 1 } }),
      db.collection('assignedHalls').findOne({}, { projection: { _id: 1, groupHallId: 1, hallId: 1, dailyScheduleId: 1, status: 1, startDate: 1, endDate: 1 } }),
    ]);

    const warnings = [];
    if (!counts.setting) warnings.push('setting mangler helt');
    if (!counts.hall) warnings.push('hall mangler helt');
    if (!counts.player) warnings.push('player mangler helt');
    if (!counts.gameType) warnings.push('gameType mangler helt');
    if (counts.dailySchedule === 0) warnings.push('dailySchedule er tom; parentGame og Game1-lobby kan ikke genereres');
    if (counts.schedules === 0) warnings.push('schedules er tom; Game1 child games kan ikke genereres fra schedule-laget');
    if (counts.assignedHalls === 0) warnings.push('assignedHalls er tom; hall-tilordning for daglige schedules mangler');
    if (counts.parentGame === 0) warnings.push('parentGame er tom; lobby kan ikke liste Game2/Game3-runder');
    if (counts.game === 0) warnings.push('game er tom; aktive og planlagte spill mangler');
    if (counts.subGame === 0 && counts.subGame1 === 0 && counts.subGame5 === 0) {
      warnings.push('subGame-collections er tomme; ticket- og planflyt mangler masterdata');
    }
    if (!player?.groupHall?.hallName && Array.isArray(player?.approvedHalls) && player.approvedHalls.length > 0) {
      warnings.push('player.groupHall er ikke satt selv om approvedHalls finnes; GetApprovedHallList vil bli tom');
    }
    if (Array.isArray(gameTypes)) {
      for (const gameType of gameTypes) {
        if (typeof gameType.photo === 'string' && gameType.photo.startsWith('profile/bingo/')) {
          warnings.push(`gameType.photo for "${gameType.name}" inneholder allerede profile/bingo/-prefix`);
        }
      }
    }

    let status = 'login_only';
    if (loginCritical.every((name) => counts[name] > 0)) {
      status = 'login_ready';
    }
    if (status === 'login_ready' && scheduleCritical.every((name) => counts[name] > 0)) {
      status = 'schedule_ready';
    }
    if (
      (status === 'schedule_ready' || status === 'login_ready') &&
      lobbyCritical.every((name) => counts[name] > 0)
    ) {
      status = 'lobby_candidate';
    }

    console.log(
      JSON.stringify(
        {
          dbName,
          auditedAt: new Date().toISOString(),
          status,
          counts,
          samples: {
            setting,
            hall,
            player,
            gameTypes,
            dailySchedule,
            schedule,
            assignedHall,
          },
          warnings,
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
