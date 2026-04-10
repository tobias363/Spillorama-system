#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { ObjectId, MongoClient } = require('mongodb');

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

function nowStamp() {
  const now = new Date();
  const parts = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ];
  return parts.join('');
}

function dayAbbreviation(date) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
}

function localTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function createGame2JackpotDefinition(prices) {
  return [{
    9: { price: prices.priceNine, isCash: true },
    10: { price: prices.priceTen, isCash: true },
    11: { price: prices.priceEleven, isCash: true },
    12: { price: prices.priceTwelve, isCash: true },
    13: { price: prices.priceThirteen, isCash: true },
    1421: { price: prices.priceFourteenToTwentyone, isCash: true },
  }];
}

async function main() {
  const envPath = process.argv[2] || path.join(__dirname, '..', '.env.recovery');
  const apply = process.argv.includes('--apply');
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

  await client.connect();
  const db = client.db(dbName);

  try {
    const [hall, player, user, existingGroupHall, existingSchedule, existingDaily, gameTypes, patterns] =
      await Promise.all([
        db.collection('hall').findOne({ status: 'active' }),
        db.collection('player').findOne({ status: { $in: ['Active', 'active'] } }),
        db.collection('user').findOne({}),
        db.collection('groupHall').findOne({ 'otherData.recoverySeed': true }),
        db.collection('schedules').findOne({ scheduleName: 'Recovery Auto Schedule', 'otherData.recoverySeed': true }),
        db.collection('dailySchedule').findOne({ name: 'Recovery Daily Schedule', 'otherData.recoverySeed': true }),
        db.collection('gameType').find({}).toArray(),
        db
          .collection('pattern')
          .find({ patternType: { $exists: true, $ne: '' } }, { projection: { _id: 1, patternName: 1, patternType: 1 } })
          .limit(12)
          .toArray(),
      ]);

    if (!hall) throw new Error('Ingen aktiv hall funnet i hall-collection');
    if (!player) throw new Error('Ingen aktiv spiller funnet i player-collection');
    if (!user) throw new Error('Ingen user funnet i user-collection');

    const photoPool = [
      '1701071119307.png',
      '1701071170694.png',
      '1714382741343.png',
      '1714382747893.png',
    ];

    const groupHallId = existingGroupHall?._id || new ObjectId();
    const groupHallName = 'Recovery Group Hall';

    const baseGroupHall = {
      _id: groupHallId,
      name: groupHallName,
      groupHallId: `RGH_${groupHallId.toString().slice(-8)}`,
      halls: [
        {
          id: hall._id.toString(),
          name: hall.name,
          status: 'active',
        },
      ],
      agents: ensureArray(hall.agents).map((agent) => ({
        id: typeof agent === 'string' ? agent : agent?.id || agent?._id?.toString() || 'seed-agent',
        name: typeof agent === 'string' ? agent : agent?.name || 'seed-agent',
      })),
      products: [],
      status: 'active',
      otherData: {
        recoverySeed: true,
        createdBy: 'seed_staging_lobby_bootstrap',
      },
    };

    const current = new Date();
    const start = addMinutes(current, 20);
    const end = addMinutes(start, 70);
    const parentEnd = endOfLocalDay(addDays(start, 1));
    const currentDay = dayAbbreviation(start);
    const nextStamp = nowStamp();

    const scheduleId = existingSchedule?._id || new ObjectId();
    const dailyScheduleId = existingDaily?._id || new ObjectId();

    const groupHallsEmbedded = [
      {
        id: groupHallId.toString(),
        name: groupHallName,
        halls: [
          {
            id: hall._id.toString(),
            name: hall.name,
            status: 'active',
            userTicketType: { Physical: 0, Terminal: 0, Web: 0 },
          },
        ],
        selectedHalls: [
          {
            id: hall._id.toString(),
            name: hall.name,
            status: 'active',
          },
        ],
      },
    ];

    const scheduleSubGames = [
      {
        name: 'Recovery Bingo 1',
        custom_game_name: 'Recovery Bingo 1',
        start_time: localTime(start),
        end_time: localTime(end),
        notificationStartTime: '30s',
        minseconds: 3,
        maxseconds: 5,
        seconds: 3,
        ticketTypesData: {
          ticketType: ['Small Red'],
          options: [],
        },
        jackpotData: { jackpotPrize: 0, jackpotDraw: 0 },
        elvisData: { replaceTicketPrice: 0 },
      },
    ];

    const scheduleDoc = {
      _id: scheduleId,
      createrId: user._id.toString(),
      isAdminSchedule: true,
      scheduleName: 'Recovery Auto Schedule',
      scheduleType: 'Auto',
      scheduleNumber: `SID_REC_${nextStamp}`,
      luckyNumberPrize: 0,
      status: 'active',
      subGames: scheduleSubGames,
      manualStartTime: localTime(start),
      manualEndTime: localTime(end),
      updatedAt: new Date(),
      createdAt: existingSchedule?.createdAt || new Date(),
      otherData: {
        recoverySeed: true,
        createdBy: 'seed_staging_lobby_bootstrap',
      },
    };

    const dailyScheduleDoc = {
      _id: dailyScheduleId,
      createrId: user._id.toString(),
      dailyScheduleId: `DSN_REC_${nextStamp}`,
      startDate: startOfLocalDay(start),
      endDate: endOfLocalDay(start),
      name: 'Recovery Daily Schedule',
      day: currentDay,
      days: {
        [currentDay]: scheduleId.toString(),
      },
      groupHalls: groupHallsEmbedded,
      halls: [hall._id.toString()],
      allHallsId: [hall._id.toString()],
      masterHall: {
        id: hall._id.toString(),
        name: hall.name,
      },
      stopGame: false,
      status: 'running',
      isSavedGame: false,
      isAdminSavedGame: false,
      innsatsenSales: 0,
      startTime: localTime(start),
      endTime: localTime(end),
      specialGame: false,
      otherData: {
        closeDay: [],
        scheduleStartDate: start,
        scheduleEndDate: end,
        isAutoStopped: false,
        recoverySeed: true,
        createdBy: 'seed_staging_lobby_bootstrap',
      },
      updatedAt: new Date(),
      createdAt: existingDaily?.createdAt || new Date(),
    };

    const assignedHallDoc = {
      groupHallId: groupHallId.toString(),
      groupHallName,
      hallId: hall._id.toString(),
      hallName: hall.name,
      dailyScheduleId: dailyScheduleId.toString(),
      startDate: dailyScheduleDoc.startDate,
      endDate: dailyScheduleDoc.endDate,
      updatedAt: new Date(),
      createdAt: new Date(),
      status: 'active',
      otherData: {
        recoverySeed: true,
        createdBy: 'seed_staging_lobby_bootstrap',
      },
    };

    const existingTypesByType = new Map(gameTypes.map((doc) => [doc.type, doc]));
    const typeBootstrap = [
      {
        type: 'game_1',
        name: 'Recovery Bingo 1',
        photo: photoPool[2],
        row: '5',
        columns: '5',
        totalNoTickets: '30',
        userMaxTickets: '30',
        pickLuckyNumber: [],
        rangeMin: '1',
        rangeMax: '75',
      },
      {
        type: 'game_2',
        name: 'Recovery Game 2',
        photo: photoPool[0],
        row: '3',
        columns: '3',
        totalNoTickets: '30',
        userMaxTickets: '30',
        pickLuckyNumber: [9, 10, 11, 12, 13, 14],
        rangeMin: '1',
        rangeMax: '21',
      },
      {
        type: 'game_3',
        name: 'Recovery Game 3',
        photo: photoPool[1],
        row: '5',
        columns: '5',
        totalNoTickets: '30',
        userMaxTickets: '30',
        pickLuckyNumber: [],
        rangeMin: '1',
        rangeMax: '75',
      },
    ];

    const patternGroupNumberPrize = [
      {
        GroupName: 'A',
        PatternData: patterns.map((pattern, index) => ({
          patternName: pattern.patternName,
          patternId: pattern._id.toString(),
          ballNumber: String(index + 5),
          prize: String(Math.max(100, 5000 - index * 300)),
          patternType: pattern.patternType,
        })),
      },
    ];

    const game1TypeId = existingTypesByType.get('game_1')?._id || new ObjectId();
    const game2TypeId = existingTypesByType.get('game_2')?._id || new ObjectId();
    const game3TypeId = existingTypesByType.get('game_3')?._id || new ObjectId();

    const game2ParentId = new ObjectId();
    const game3ParentId = new ObjectId();
    const game2ChildId = new ObjectId();
    const game3ChildId = new ObjectId();

    const game2Parent = {
      _id: game2ParentId,
      gameMode: 'auto',
      gameName: 'Recovery Game 2',
      gameNumber: `${nextStamp}_G2`,
      gameType: 'game_2',
      status: 'active',
      gameTypeId: game2TypeId.toString(),
      createrId: user._id.toString(),
      startDate: start,
      endDate: parentEnd,
      minTicketCount: 1,
      totalNoTickets: 30,
      totalNoPurchasedTickets: 0,
      notificationStartTime: '30s',
      luckyNumberPrize: 5000,
      ticketPrice: 5,
      seconds: 3000,
      groupHalls: [
        {
          id: groupHallId.toString(),
          name: groupHallName,
          halls: [{ id: hall._id.toString(), name: hall.name, status: 'active' }],
        },
      ],
      halls: [hall._id.toString()],
      allHallsId: [hall._id.toString()],
      days: {
        [currentDay]: [localTime(start), localTime(end)],
      },
      isParent: true,
      jackPotNumber: createGame2JackpotDefinition({
        priceNine: 50,
        priceTen: 100,
        priceEleven: 250,
        priceTwelve: 500,
        priceThirteen: 1000,
        priceFourteenToTwentyone: 2500,
      }),
      subGames: [
        {
          name: 'Recovery Game 2 Heat 1',
          ticketPrice: 5,
          priceNine: 50,
          priceTen: 100,
          priceEleven: 250,
          priceTwelve: 500,
          priceThirteen: 1000,
          priceFourteenToTwentyone: 2500,
        },
      ],
      stopGame: false,
      childGameList: [game2ChildId],
      otherData: {
        isBotGame: false,
        closeDay: [],
        recoverySeed: true,
        createdBy: 'seed_staging_lobby_bootstrap',
      },
      updatedAt: new Date(),
      createdAt: new Date(),
    };

    const game2Child = {
      _id: game2ChildId,
      gameMode: 'auto',
      gameType: 'game_2',
      status: 'active',
      gameTypeId: game2TypeId.toString(),
      createrId: user._id.toString(),
      startDate: start,
      graceDate: end,
      endDate: end,
      groupHalls: game2Parent.groupHalls,
      halls: [hall._id.toString()],
      allHallsId: [hall._id.toString()],
      parentGameId: game2ParentId,
      day: currentDay,
      isChild: true,
      stopGame: false,
      disableTicketPurchase: false,
      isBotGame: false,
      otherData: {
        isBotGame: false,
        botTicketPurcasheStarted: false,
        botTicketPurcashed: false,
        parentGameCount: 1,
        startDate: start,
        endDate: end,
        closeDay: [],
        recoverySeed: true,
        createdBy: 'seed_staging_lobby_bootstrap',
      },
      gameName: 'Recovery Game 2 Heat 1',
      gameNumber: `CH_1_${nextStamp}_G2`,
      sequence: 1,
      ticketPrice: 5,
      minTicketCount: 1,
      totalNoTickets: 30,
      totalNoPurchasedTickets: 0,
      purchasedTickets: [],
      withdrawNumberList: [],
      history: [],
      ticketIdArray: [],
      notificationStartTime: '30s',
      luckyNumberPrize: 5000,
      seconds: 3000,
      rocketLaunch: false,
      jackPotNumber: game2Parent.jackPotNumber,
      players: [],
      updatedAt: new Date(),
      createdAt: new Date(),
    };

    const game3Parent = {
      _id: game3ParentId,
      gameMode: 'auto',
      gameName: 'Recovery Game 3',
      gameNumber: `${nextStamp}_G3`,
      status: 'active',
      gameType: 'game_3',
      gameTypeId: game3TypeId.toString(),
      days: {
        [currentDay]: [localTime(start), localTime(end)],
      },
      createrId: user._id.toString(),
      startDate: start,
      endDate: parentEnd,
      groupHalls: game2Parent.groupHalls,
      halls: [hall._id.toString()],
      allHallsId: [hall._id.toString()],
      subGames: [
        {
          name: 'Recovery Game 3 Heat 1',
          minTicketCount: 1,
          notificationStartTime: '30s',
          luckyNumberPrize: 5000,
          ticketPrice: 5,
          seconds: 3,
          winningType: 'pattern',
          patternGroupNumberPrize,
        },
      ],
      stopGame: false,
      isParent: true,
      childGameList: [game3ChildId],
      otherData: {
        closeDay: [],
        isBotGame: false,
        recoverySeed: true,
        createdBy: 'seed_staging_lobby_bootstrap',
      },
      updatedAt: new Date(),
      createdAt: new Date(),
    };

    const game3Child = {
      _id: game3ChildId,
      gameMode: 'auto',
      gameType: 'game_3',
      status: 'active',
      gameTypeId: game3TypeId.toString(),
      createrId: user._id.toString(),
      startDate: start,
      graceDate: end,
      endDate: end,
      groupHalls: game3Parent.groupHalls,
      halls: [hall._id.toString()],
      allHallsId: [hall._id.toString()],
      parentGameId: game3ParentId,
      day: currentDay,
      isChild: true,
      stopGame: false,
      disableTicketPurchase: false,
      isBotGame: false,
      otherData: {
        isBotGame: false,
        parentGameCount: 1,
        startDate: start,
        endDate: end,
        closeDay: [],
        recoverySeed: true,
        createdBy: 'seed_staging_lobby_bootstrap',
      },
      gameName: 'Recovery Game 3 Heat 1',
      gameNumber: `CH_1_${nextStamp}_G3`,
      sequence: 1,
      ticketPrice: 5,
      minTicketCount: 1,
      notificationStartTime: '30s',
      luckyNumberPrize: 5000,
      seconds: 3000,
      patternGroupNumberPrize,
      allPatternArray: patternGroupNumberPrize[0].PatternData,
      winningType: 'pattern',
      players: [],
      withdrawNumberList: [],
      history: [],
      patternWinnerHistory: [],
      updatedAt: new Date(),
      createdAt: new Date(),
    };

    const preview = {
      mode: apply ? 'apply' : 'dry-run',
      dbName,
      hall: { id: hall._id.toString(), name: hall.name },
      player: { id: player._id.toString(), username: player.username },
      currentDay,
      startTime: localTime(start),
      endTime: localTime(end),
      create: {
        groupHall: !existingGroupHall,
        schedules: !existingSchedule,
        dailySchedule: !existingDaily,
        gameTypes: typeBootstrap.filter((doc) => !existingTypesByType.has(doc.type)).map((doc) => doc.type),
        parentGames: ['game_2', 'game_3'],
        childGames: ['game_2', 'game_3'],
      },
    };

    if (!apply) {
      console.log(JSON.stringify(preview, null, 2));
      return;
    }

    await db.collection('groupHall').updateOne(
      { _id: groupHallId },
      { $set: baseGroupHall },
      { upsert: true }
    );

    await db.collection('hall').updateOne(
      { _id: hall._id },
      {
        $set: {
          groupHall: {
            id: groupHallId.toString(),
            hallName: hall.name,
            name: groupHallName,
            status: 'Approved',
          },
          approvedHalls: ensureArray(player.approvedHalls).map((approvedHall) => {
            if (approvedHall?.id !== hall._id.toString()) {
              return approvedHall;
            }
            return {
              ...approvedHall,
              groupHall: {
                id: groupHallId.toString(),
                hallName: hall.name,
                name: groupHallName,
                status: 'Approved',
              },
            };
          }),
        },
      }
    );

    await db.collection('player').updateOne(
      { _id: player._id },
      {
        $set: {
          groupHall: {
            id: groupHallId.toString(),
            hallName: hall.name,
            name: groupHallName,
            status: 'Approved',
          },
        },
      }
    );

    for (let index = 0; index < typeBootstrap.length; index += 1) {
      const typeData = typeBootstrap[index];
      const existing = existingTypesByType.get(typeData.type);
      await db.collection('gameType').updateOne(
        {
          _id:
            existing?._id
            || (
              typeData.type === 'game_1'
                ? game1TypeId
                : typeData.type === 'game_2'
                  ? game2TypeId
                  : game3TypeId
            ),
        },
        {
          $set: {
            ...typeData,
            updatedAt: new Date(),
            createdAt: existing?.createdAt || new Date(),
          },
        },
        { upsert: true }
      );
    }

    await db.collection('schedules').updateOne(
      { _id: scheduleId },
      { $set: scheduleDoc },
      { upsert: true }
    );

    await db.collection('dailySchedule').updateOne(
      { _id: dailyScheduleId },
      { $set: dailyScheduleDoc },
      { upsert: true }
    );

    await db.collection('assignedHalls').updateOne(
      {
        dailyScheduleId: dailyScheduleId.toString(),
        hallId: hall._id.toString(),
      },
      { $set: assignedHallDoc },
      { upsert: true }
    );

    await db.collection('parentGame').deleteMany({ 'otherData.recoverySeed': true });
    await db.collection('game').deleteMany({ 'otherData.recoverySeed': true });

    await db.collection('parentGame').insertMany([game2Parent, game3Parent]);
    await db.collection('game').insertMany([game2Child, game3Child]);

    console.log(
      JSON.stringify(
        {
          ...preview,
          seededParentGames: [game2ParentId.toString(), game3ParentId.toString()],
          seededChildGames: [game2ChildId.toString(), game3ChildId.toString()],
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
