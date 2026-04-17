const Sys = require('../../../Boot/Sys');
const moment = require('moment');
const game1HallStausCache = new Map();
const { processGame2, 
    processGame3, 
    checkForChildGames, 
    getGameQueries, 
    processDailySchedules, 
    processGame1, 
    cleanupOldGames, 
    processGame1Notification, 
    updateGame23Status, 
    getFinalDates,
    getGameStatusFor24HoursNew,
    getGame1Status,
    getActiveGamesQuery
 } = require('../../../gamehelper/common');
const { 
    createErrorResponse, 
    createSuccessResponse, 
    getPlayerIp, getOnlinePlayers, 
    dateTimeFunction, compareTimeSlots, 
    fixedPatternByName, 
    isDateInRange 
} = require('../../../gamehelper/all');
const { countryNames } = require('../../../gamehelper/game1-process');

const createGame2JackpotDefinition = (subGame) => ([{
    9: { price: +subGame.priceNine, isCash: true },
    10: { price: +subGame.priceTen, isCash: true },
    11: { price: +subGame.priceEleven, isCash: true },
    12: { price: +subGame.priceTwelve, isCash: true },
    13: { price: +subGame.priceThirteen, isCash: true },
    1421: { price: +subGame.priceFourteenToTwentyone, isCash: true }
}]);

module.exports = {
    // [ Cron Function ]
    startGameCron: async function () {
        try {
            const { queryTime, subGameQuery, parentGameQuery } = getGameQueries();
    
            // Process sub games in parallel for game 2,3 
            const subGameList = await Sys.Game.Game2.Services.GameServices.getByData(subGameQuery, { _id: 1, gameMode: 1, gameType: 1, gameNumber: 1, parentGameId: 1, minTicketCount: 1, totalNoTickets: 1, totalNoPurchasedTickets: 1, status: 1, otherData: 1, day: 1, startDate: 1, players: 1, isNotificationSent: 1}, {sort: {specialGame: -1}});
            await Promise.all(subGameList.map(async (game) => {
                if (game.gameType === 'game_2') {
                    await processGame2(game, queryTime);
                } else if (game.gameType === 'game_3') {
                    await processGame3(game, queryTime);
                }
            }));
    
            // Process parent games of game 2, 3
            const gameList = await Sys.Game.Game2.Services.GameServices.getByDataParent(parentGameQuery, {status: 1, stopGame: 1,  gameType: 1, days: 1, otherData: 1, isBotGame: 1, totalNumberOfGames: 1});
            await Promise.all(gameList.map(async (game) => {
                if (game.status === "running") {
                    await checkForChildGames(game, queryTime);
                } else if (game.status === "active") {
                    await Sys.Game.Game2.Services.GameServices.updateParentGame(
                        { _id: game._id }, 
                        { status: "running" }
                    );
                }
            }));
    
            // Remove old game 2 and 3
            const removeOldGame2and3Query = {
                status: { $in: ["active", "running"] },
                endDate: { $lt: moment().toDate() }
            }
            await Sys.Game.Common.Services.GameServices.updateManyParentData(removeOldGame2and3Query, { status: "finish" });
    
            // Process Game 1 Schedule 
            await processDailySchedules();
    
            // Process Game 1
            const game1Query = {
                status: "active",
                gameType: "game_1",
                startDate: { 
                    $gte: moment().toDate(), 
                    $lt: moment().add(1, 'minute').toDate()
                },
                stopGame: false,
                'otherData.isClosed': false
            };
    
            const game1List = await Sys.Game.Game2.Services.GameServices.getByData(game1Query, { gameType: 1, startDate: 1, gameMode: 1, halls: 1, parentGameId: 1 }, {sort: {specialGame: -1}});
            await Promise.all(game1List.map(processGame1));
    
            // Clean up old games
            await cleanupOldGames();
    
        } catch (error) {
            console.error('Error in startGameCron:', error);
        }
    },

    // [ Send Auto Game Start Notitication Of Game 1 ]
    sendGameStartNotifications: async function () {
        try {
            const now = moment();
            const preTimeQue = now.toDate();
            const aftTimeQue = moment().add(5, 'minutes').toDate();
    
            const query = {
                gameType: "game_1",
                status: "active",
                gameMode: "Auto",
                isNotificationSent: false,
                $or: [
                    { startDate: { $gte: preTimeQue, $lt: aftTimeQue } },
                    { graceDate: { $gte: preTimeQue, $lt: aftTimeQue } }
                ],
                'otherData.isClosed': false
            };
    
            const projection = {
                notificationStartTime: 1,
                players: 1,
                gameNumber: 1,
                startDate: 1,
                gameMode: 1
            };
    
            const sort = { sort: { specialGame: -1 } };
    
            const gameList = await Sys.Game.Game2.Services.GameServices.getByData(query, projection, sort);
            
            if (!Array.isArray(gameList) || !gameList.length) return;
    
            for (const game of gameList) {
                processGame1Notification(game).catch(err =>
                    console.error("Error processing game:", err)
                );
            }
        } catch (e) {
            console.error("Error in sendGameStartNotifications:", e);
        }
    },

    // [ Register Time Hall List Function ]
    hallList: async function (socket, data) {
        try {
            const { 
                android_version, ios_version, wind_linux_version: windows_version, webgl_version 
            } = Sys.Setting;

            // Get player IP early
            const playerIp = getPlayerIp({
                handshake: { headers: socket.handshake.headers },
                conn: { remoteAddress: socket.conn.remoteAddress }
            });
            
            // Create versions object once
            const versions = {
                android_version,
                ios_version,
                windows_version,
                webgl_version,
            };

            // DB query with minimal projection
            const hallList = await Sys.Game.Common.Services.GameServices.getHallData(
                { status: "active", agents: { $not: { $size: 0 } } },
                { name: 1, ip: 1 }  // Only select needed fields
            );

            // Optimize map operation with minimal data
            const updatedHalls = hallList.map(({ _id, name, ip }) => ({
                _id,
                name,
                isCurrentHall: ip === playerIp
            }));

            const countryList = countryNames.getCountries();
            const registerInfoText = {
                en: "The undersigned declares that the purpose of registering as a customer with Teknobingo/Spillorama is to participate in the hall’s game portfolio, and to enable payment for games and the transfer of winnings via the game card/user profile.",
                nor: "Undertegnede erklærer at formålet med å registrere seg som kunde hos Teknobingo/Spillorama, er å delta i hallens spillportefølje og slik at betaling for spill og overføring av gevinster kan skje via spillekortet/brukerprofilen",
            }
            return createSuccessResponse({
                hallList: updatedHalls,
                versions,
                countryList, 
                registerInfoText
            }, 'hallList List');

        } catch (error) {
            console.log("Error in hallList:", error);
            return createSuccessResponse({
                hallList: [],
                versions: {}
            }, 'hallList List');
        }
    },

    // [ Get Total Online Players, Connected to socket ]
    gameOnlinePlayerCount: async function (socket, data) {
        try {
            let getTotalOnlinePlayers = Sys.Io.engine.clientsCount;
            return createSuccessResponse({ onlinePlayerCount: getTotalOnlinePlayers}, 'getTotalOnlinePlayers List');
        } catch (error) {
            console.log("Error gameOnlinePlayerCount", error);
        }
    },

    // [ Clear Rooms Sockets For Game 2 & 3 and will be called from game 2 & 3 socket file ]
    clearRoomsSockets: async function (socket) {
        try {
            // Destructure at top
            const {
                Game2: game2Namespace,
                Game3: game3Namespace
            } = Sys.Config.Namespace;
            const validRooms = Object.keys(socket.rooms).filter(room => !room.startsWith("/"));
            
            if (validRooms.length === 0) {
                return { status: "fail" }
            }

            // Process all rooms in parallel
            await Promise.all(validRooms.map(async (roomId) => {
                console.log("clear socket from room", roomId);
                
                // Determine room ID and query type
                const [baseRoomId, hasSubRoom] = roomId.includes('_') 
                    ? [roomId.split('_')[0], true]
                    : [roomId, false];

                // Fetch game data
                const gameData = await (hasSubRoom
                    ? Sys.Game.Game2.Services.GameServices.getByData({ _id: baseRoomId }, { gameName: 1, gameType: 1 })
                    : Sys.Game.Game2.Services.GameServices.getByDataParent({ _id: baseRoomId }, { gameName: 1, gameType: 1 }));

                if (!gameData?.length) return;

                const { gameType } = gameData[0];
                
                // Handle different game types in parallel
                if (gameType === "game_2") {
                    const onlinePlayers = await getOnlinePlayers('Game2', roomId);
                    console.log("online players in disconnecting game2:", onlinePlayers);
                    
                    Sys.Io.of(game2Namespace)
                        .to(roomId)
                        .emit('GameOnlinePlayerCount', { 
                            onlinePlayerCount: onlinePlayers 
                        });

                } else if (gameType === "game_3") {
                    const onlinePlayers = await getOnlinePlayers('Game3', roomId);
                    console.log("online players in disconnecting game3:", onlinePlayers);
                    
                    const game3Io = Sys.Io.of(game3Namespace);
                    
                    // Emit both events simultaneously
                    await Promise.all([
                        game3Io.to(roomId).emit('GameOnlinePlayerCount', { 
                            onlinePlayerCount: onlinePlayers 
                        }),
                        game3Io.to(roomId.toString()).emit('UpdatePlayerRegisteredCount', { 
                            playerRegisteredCount: onlinePlayers 
                        })
                    ]);
                }
            }));

            return createSuccessResponse(null, 'Rooms cleared successfully');
        } catch (error) {
            console.error("Error in clearRoomsSockets:", error);
        }
    },

    //GameType List
    getGameTypeList: async function (socket, data) {
        try {
            // Get game types with minimal projection
            const gameTypes = await Sys.Game.Common.Services.GameServices.getListData(
                {}, // query
                { name: 1, photo: 1, type: 1, _id: 0 } // projection - only get needed fields
            );

            if (!gameTypes?.length) {
                return createErrorResponse( 'No game types found','en', 400, false);
            }

            const unityGameTypes = gameTypes
                .filter(({ type }) => typeof type === 'string' && /^game_\d+$/.test(type))
                .sort((left, right) => {
                    const leftNumber = Number((left.type || '').replace('game_', '')) || 0;
                    const rightNumber = Number((right.type || '').replace('game_', '')) || 0;
                    return leftNumber - rightNumber;
                });

            if (!unityGameTypes.length) {
                return createErrorResponse('No Unity game types found', 'en', 400, false);
            }

            // Transform data efficiently using map
            const gameList = unityGameTypes.map(({ name, photo }) => {
                const normalizedPhoto = typeof photo === 'string'
                    ? photo.replace(/^\/+/, '')
                    : '';
                return {
                    name,
                    img: normalizedPhoto.startsWith('profile/bingo/')
                        ? normalizedPhoto
                        : `profile/bingo/${normalizedPhoto}`
                };
            });

            return createSuccessResponse(
                { gameList },
                'Game types retrieved successfully',
                200
            );

        } catch (error) {
            console.error("Error in getGameTypeList:", error);
            return createErrorResponse( 'Failed to fetch game types','en', 400, false);
        }
    },

    // Used in server.js file on boot if not available in DB
    fixedPatternType: async function (patternName) {
        try {
            return await fixedPatternByName(patternName);
        } catch (error) {
            return [];
        }
    },

    // [ Create Child Game Sub Game Flow Wise For Game 2 & 3 ]
    createChildGame: async function (parentGameId, day, nextDay = false) {
        try {
            console.log("parentGameId, Day, NextDay:", parentGameId, day, nextDay);
    
            const parentGame = await Sys.Game.Game2.Services.GameServices.getSingleParentGame({_id: parentGameId, stopGame: false}, {days: 1, otherData: 1, gameType: 1, gameTypeId: 1, createrId: 1, minTicketCount: 1, totalNoTickets: 1, notificationStartTime: 1, luckyNumberPrize: 1, seconds: 1, groupHalls: 1, allHallsId: 1, subGames: 1});
    
            if (!parentGame) return console.log("Game will not be created.");
    
            const daySlots = parentGame.days[day];
            if (!daySlots || daySlots.length < 2) return console.log("Invalid time slots.");
    
            const parseTime = (time) => ({
                hour: parseInt(time.slice(0, 2)),
                minute: parseInt(time.slice(3, 5)),
                second: 0,
            });
    
            const now = moment();
            const startTime = moment().set(parseTime(daySlots[0]));
            const endTime = moment().set(parseTime(daySlots[1]));
            
            if (nextDay) {
                startTime.add(1, 'day');
                endTime.add(1, 'day');
                now.add(1, 'day').set(parseTime(daySlots[0]));
            }
    
            // If endtime is completing in 1 minute of current time then dont need to create game
            let addGame = endTime.diff(now, 'minutes') > 1; // It wiil be used as a flag if game should be created or not
            //let startDate = moment(now); // copy of now ( it will be based on today and nextgame time )
            let startDate = startTime;
            // Handle close day
            if (addGame && Array.isArray(parentGame.otherData?.closeDay)) {
                const currentDateStr = now.format('YYYY-MM-DD');
                const currentHour = now.format('HH:mm');
                for (const { closeDate, startTime, endTime } of parentGame.otherData.closeDay) {
                    if (
                        closeDate === currentDateStr &&
                        compareTimeSlots(currentHour, startTime, 'gte') &&
                        compareTimeSlots(currentHour, endTime, 'lte')
                    ) {
                        console.log(`Game blocked due to close day (${closeDate}: ${startTime}-${endTime})`);
                        addGame = false;
                        break;
                    }
                }
            }
    
            // Bot game always allowed
            const isBotGame = parentGame.otherData?.isBotGame === true;
            if (isBotGame) {
                addGame = true;
                startDate = moment();
            }
            
            if (!addGame) return console.log("Game creation skipped.");
    
            const createID = dateTimeFunction(Date.now());
            let childGames = [];
            let botGames = []
            const baseGameData = {
                gameMode: 'auto',
                gameType: parentGame.gameType,
                status: "active",
                gameTypeId: parentGame.gameTypeId,
                createrId: parentGame.createrId,
                startDate,
                groupHalls: parentGame.groupHalls,
                allHallsId: parentGame.allHallsId,
                parentGameId: parentGame._id,
                day,
                isChild: true,
                disableTicketPurchase: false,
                isBotGame,
                otherData: {
                    isBotGame: isBotGame,
                    botTicketPurcasheStarted: false,
                    botTicketPurcashed: false,
                    parentGameCount: parentGame.subGames.length,
                    startDate: startDate.toDate(),
                    endDate: moment(startDate).set(parseTime(daySlots[1])).toDate()
                }
            };
    
            for (let i = 0; i < parentGame.subGames.length; i++) {
                const subGame = parentGame.subGames[i];
                let gameNumber = `CH_${i + 1}_${createID}_${parentGame.gameType === 'game_2' ? 'G2' : 'G3'}`;
    
                let childGameData = {
                    ...baseGameData,
                    gameName: subGame.name,
                    gameNumber,
                    sequence: i + 1,
                    ticketPrice: subGame.ticketPrice,
                };
    
                if (parentGame.gameType === 'game_2') {
                    Object.assign(childGameData, {
                        minTicketCount: parentGame.minTicketCount,
                        totalNoTickets: parentGame.totalNoTickets,
                        totalNoPurchasedTickets: 0,
                        notificationStartTime: parentGame.notificationStartTime,
                        luckyNumberPrize: parentGame.luckyNumberPrize,
                        seconds: parentGame.seconds,
                        rocketLaunch: false,
                        purchasedTickets: [],
                        otherData: {
                            ...childGameData.otherData,
                            botTicketCount: 0,
                            botGameCount: isBotGame ? +parentGame.otherData.botGameCount : 0,
                            alreadyPurchasedBotPot: 0,
                            ticketPurchasedByBotCount: 0,
                        },
                        jackPotNumber: createGame2JackpotDefinition(subGame)
                    });
                } else if (parentGame.gameType === 'game_3') {
                    const pattern = subGame.patternGroupNumberPrize;
                    const sortedPatterns = [...pattern[0].PatternData].sort((a, b) => {
                        const countPattern = (p) => {
                            if (['Row 1', 'Row 2', 'Row 3', 'Row 4'].includes(p.patternName)) {
                                return parseInt(p.patternName.split(' ')[1]) * 5;
                            }
                            return p.patternType.replace(/\./g, ',').split(',').filter(val => val === '1').length;
                        };
                        return countPattern(a) - countPattern(b);
                    });
                    pattern[0].PatternData = sortedPatterns;
                    Object.assign(childGameData, {
                        minTicketCount: subGame.minTicketCount,
                        notificationStartTime: subGame.notificationStartTime,
                        luckyNumberPrize: subGame.luckyNumberPrize,
                        ticketPrice: subGame.ticketPrice,
                        seconds: subGame.seconds * 1000,
                        patternGroupNumberPrize: pattern,
                        allPatternArray: sortedPatterns,
                        winningType: subGame.winningType,
                        withdrawNumberList: [],
                        history: [],
                        patternWinnerHistory: []
                    });
                }
    
                const createdChild = await Sys.Game.Common.Services.GameServices.createChildGame(childGameData);
                if (createdChild && !(createdChild instanceof Error)) {
                    childGames.push(createdChild._id);
                    if (parentGame.gameType === 'game_3' && createdChild.isBotGame) {
                        botGames.push({
                            gameId: createdChild._id,
                            minTicketCount: createdChild.minTicketCount,
                            allHallsId: createdChild.allHallsId.map(h => h.toString()),
                            ticketPrice: createdChild.ticketPrice
                        })
                    }
                } else {
                    console.log(`Child game creation failed for subGame[${i}]`);
                }
            }
    
            if (childGames.length) {
                //Broadcast to admin
                Sys.Io.of('admin').emit('subGameCreated', { value: true });
                await Sys.Game.Game2.Services.GameServices.updateParentGame({_id: parentGame._id}, { $push: { childGameList: { $each: childGames } } });
                
                // Start Game 2 bot processing
                if (parentGame.gameType === 'game_2') {
                    setTimeout(() => {
                        Sys.Game.Game2.Controllers.GameProcess.checkForBotGames(parentGame._id);
                    }, 10000);
                }
                // Start Game 3 bot processing
                if (isBotGame && botGames.length > 0) {
                    Promise.all(botGames.map((game, index) => 
                        Sys.Game.Game3.Controllers.GameProcess.populateGame3WithBots(game)
                            .catch(error => {
                                console.log(`Error for subgame number ${index + 1} for parent ${parentGame._id}`, error);
                                return null; // Return null to prevent Promise.all from failing completely
                            })
                    ));
                }
            }
    
            return true;
    
        } catch (error) {
            console.error("Error in createChildGame:", error);
            return false;
        }
    },

    // [ Create Game 1 Child Games from Schedule ]
    createGame1FromSchedule: async function (dailySchedule, currentDayScheduleId, day, date, latestData) {
        try {
            
            const schedule =  await Sys.App.Services.scheduleServices.getSingleSchedulesData(
                { _id: currentDayScheduleId },
                {scheduleName: 1, scheduleType: 1, subGames: 1, manualStartTime: 1, manualEndTime: 1, createrId: 1, luckyNumberPrize: 1});
    
            if (!schedule || !schedule.subGames.length) return;
    
            const ID = Date.now();
            const createID = dateTimeFunction(ID);
            const parentStartDate = moment(date).startOf('day');
            let scheduleStartDate = moment();
    
            if (schedule.scheduleType === "Auto") {
                scheduleStartDate = moment(`${parentStartDate.format("YYYY-MM-DD")} ${schedule.subGames[0].start_time}`).tz('UTC');
            } else if (schedule.scheduleType === "Manual") {
                scheduleStartDate = moment(`${parentStartDate.format("YYYY-MM-DD")} ${schedule.manualStartTime}`).tz('UTC');
            }
    
            const halls = dailySchedule.groupHalls?.flatMap(g => g.selectedHalls.map(h => h.id)) || [];
    
            // Filter out previously used halls from latestData
            if (latestData.length) {
                dailySchedule.groupHalls = dailySchedule.groupHalls.map(ghall => {
                    ghall.selectedHalls = ghall.selectedHalls.filter(hall => !latestData[0].halls.includes(hall.id));
                    return ghall;
                }).filter(ghall => ghall.selectedHalls.length > 0);
    
                dailySchedule.allHallsId = dailySchedule.groupHalls.flatMap(group => group.selectedHalls.map(h => h.id));
                dailySchedule.halls = dailySchedule.groupHalls.flatMap(group => group.selectedHalls.map(h => h.id));
            }
    
            const hallData = await Sys.App.Services.HallServices.getAllHallDataSelect(
                { _id: { $in: halls } },
                { agents: 1, name: 1 }
            );
    
            const agents = hallData.flatMap(hall =>
                hall.agents.map(agent => ({
                    name: agent.name,
                    id: agent.id,
                    hallId: hall._id,
                    hallName: hall.name,
                    isReady: false,
                    scannedTickets: { isSold: false, isPending: false, isScanned: false }
                }))
            );

            if (schedule.subGames.length > 0) {
                // take the element at index 1
                const zeroGame = {
                  ...schedule.subGames[0], // copy everything
                };
                
                if(schedule.scheduleType === "Auto"){
                    zeroGame.start_time = moment(schedule.subGames[0].start_time, "HH:mm")
                    .subtract(30, "minutes")
                    .format("HH:mm");
                }
                // insert it at the beginning
                schedule.subGames.unshift(zeroGame);
            }
            for (let g = 0; g < schedule.subGames.length; g++) {
                // Create start and end date of specific schedule game
                let startDate, endDate;
    
                if (schedule.scheduleType === "Auto") {
                    startDate = moment(`${parentStartDate.format("YYYY-MM-DD")} ${schedule.subGames[g].start_time}`).tz('UTC');
                    endDate = moment(`${parentStartDate.format("YYYY-MM-DD")} ${schedule.subGames.at(-1).end_time}`).tz('UTC');
                } else {
                    startDate = moment(`${parentStartDate.format("YYYY-MM-DD")} ${schedule.manualStartTime}`).tz('UTC');
                    endDate = moment(`${parentStartDate.format("YYYY-MM-DD")} ${schedule.manualEndTime}`).tz('UTC');
                }
    
                // check if game is closed, if it founds any close day it will return and not check other closedates
                let isClosed = (dailySchedule.otherData.closeDay || []).some(closeDay => {
                    const { startTime, endTime } = closeDay.utcDates;
                    return schedule.scheduleType === "Manual"
                        ? isDateInRange(moment(endDate), startTime, endTime)
                        : isDateInRange(moment(startDate), startTime, endTime);
                });
    
                // Prepare ticket data
                let groupHallsCopy = JSON.parse(JSON.stringify(dailySchedule.groupHalls)); // deep copy of dailySchedule.groupHalls
                groupHallsCopy.forEach(group => {
                    group.halls.forEach(hall => {
                        hall.ticketData = {};
                        hall.userTicketType = { Physical: {}, Terminal: {}, Web: {} };
                        schedule.subGames[g].ticketTypesData.ticketType.forEach(type => {
                            const key = type.split(' ').join('').toLowerCase();
                            hall.ticketData[key] = 0;
                            hall.userTicketType.Physical[key] = 0;
                            hall.userTicketType.Terminal[key] = 0;
                            hall.userTicketType.Web[key] = 0;
                        });
                    });
                });
    
                const initialTicket = Object.fromEntries(Array.from({ length: 75 }, (_, i) => [i + 1, []]));
                let status = "active";
                if (schedule.scheduleType === "Auto" && startDate <= moment()) status = "finish";
    
                const gameObj = {
                    gameMode: schedule.scheduleType,
                    gameName: schedule.subGames[g].name,
                    gameNumber: `CH_${g}_${createID}_G1`,
                    gameType: "game_1",
                    sequence: g,
                    status,
                    createrId: schedule.createrId,
                    startDate,
                    graceDate: endDate,
                    notificationStartTime: schedule.subGames[g].notificationStartTime,
                    luckyNumberPrize: schedule.luckyNumberPrize,
                    seconds: schedule.subGames[g].seconds,
                    groupHalls: groupHallsCopy,
                    allHallsId: dailySchedule.allHallsId,
                    parentGameId: dailySchedule._id,
                    day,
                    isChild: true,
                    specialGame: dailySchedule.specialGame,
                    disableTicketPurchase: false,
                    subGames: {
                        ticketColorTypes: schedule.subGames[g].ticketTypesData.ticketType,
                        options: schedule.subGames[g].ticketTypesData.options
                    },
                    otherData: {
                        scheduleId: schedule._id,
                        scheduleName: schedule.scheduleName,
                        isAutoStopped: dailySchedule.otherData.isAutoStopped,
                        unclaimedWinners: [],
                        claimedWinners: [],
                        currentPattern: "",
                        agents,
                        replaceTicketPrice: schedule.subGames[g].elvisData?.replaceTicketPrice || 0,
                        gameSecondaryStatus: status,
                        isMinigameActivated: false,
                        isMinigamePlayed: false,
                        isMinigameFinished: false,
                        winnerAdminResultArray: [],
                        mysteryGameResults: [],
                        isMinigameInProgress: false,
                        isSpinByAdmin: false,
                        mysteryHistory: [],
                        mysteryStartTimeMs: 0,
                        mysteryTurnCounts: 0,
                        disableCancelTicket: false,
                        miniGameturnCounts: 0,
                        miniGameHistory: [],
                        miniGamestartTimeMs: 0,
                        miniGameResults: [],
                        scheduleStartDate: new Date(scheduleStartDate),
                        isClosed,
                        isPaused: false,
                        isMinigameExecuted: false,
                        masterHallId: dailySchedule.masterHall?.id,
                        elvisReceivedReplaceAmount: 0,
                        isWofSpinStopped: false,
                        minseconds: +(schedule.subGames[g].minseconds || 0),
                        maxseconds: +(schedule.subGames[g].maxseconds || 0),
                        isTestGame: g === 0 ? true: false,
                        customGameName: schedule.subGames[g].custom_game_name || schedule.subGames[g].name,
                    },
                    halls: dailySchedule.halls,
                    ticketIdForBalls: initialTicket,
                    jackpotDraw: schedule.subGames[g].jackpotData?.jackpotDraw || 0,
                    jackpotPrize: schedule.subGames[g].jackpotData?.jackpotPrize || 0,
                };
                // if(g == 0){
                //     const zeroGameObj = {
                //         ...gameObj, // copy everything
                //         gameNumber: `CH_${g}_${createID}_G1`,
                //         sequence: g,
                //         otherData: {
                //             ...gameObj.otherData,
                //             isTestGame: true
                //         }
                //     };
                //     await Sys.Game.Common.Services.GameServices.createChildGame(zeroGameObj);
                // }
                const game = await Sys.Game.Common.Services.GameServices.createChildGame(gameObj);
                for (let g = 0; g < halls.length; g++) {
                    Sys.Io.of('admin').to(halls[g].toString()).emit('refresh', {
                        status: "success",
                        data: { _id: game._id, gameName: game.gameName, gameNumber: game.gameNumber }
                    });
                }
                Sys.Io.of('admin').emit('refreshSchedule', { scheduleId: dailySchedule._id });
            }
            Sys.Game.Common.Controllers.GameController.game1StatusCron();
            Sys.Io.emit('newDailyScheduleCreated', { halls: halls }); // refresh if new game created
    
        } catch (err) {
            console.error("Error in createGame1FromSchedule:", err);
        }
    },

    // Game Status for Game 2,3,4,5
    availableGameTypes: async function (socket, data) {
        try {
            // Destructure commonly used variables at top
            const { hallId } = data;
            const currentDate = new Date();
            const today = moment().startOf('day');
            const nextDate = moment().add(1, 'day').startOf('day');
            const currentDay = today.format('ddd');
            const nextDay = nextDate.format('ddd');
            const currentTime = moment().format('HH:mm');
    
            // Check cache first
            if (Sys.AvailableGamesForHall[hallId]?.validity > Date.now()) {
                return {
                    status: "success",
                    statusCode: 200,
                    message: "Available Games For Today Found.",
                    result: Sys.AvailableGamesForHall[hallId].response
                };
            }
    
            // Initialize result object
            const result = {
                "game_2": { status: "Closed", date: null },
                "game_3": { status: "Closed", date: null },
                "game_4": { status: "Closed", date: null },
                "game_5": { status: "Closed", date: null },
            };
    
            // Prepare queries for parallel execution
            const regularGameQuery = {
                status:  { $in: ['active', 'running'] },
                gameType: { $in: ['game_2', 'game_3'] },
                allHallsId: hallId,
                stopGame: false,
                $or: [{ [`days.${currentDay}`]: { $exists: true } }, { [`days.${nextDay}`]: { $exists: true } }],
                endDate: { $gte: nextDate.toDate() },
                "otherData.isBotGame": false,
                childGameList: { $exists: true, $ne: [] }
            };
    
            const game45Query = { 
                gameType: { $in: ['game_4', 'game_5'] } 
            };
    
            // Execute DB queries in parallel
            const [availableGames, gameData] = await Promise.all([
                Sys.Game.Game2.Services.GameServices.getByDataParent(regularGameQuery, {days: 1, otherData: 1, gameType: 1, allHallsId: 1, startDate: 1, endDate: 1}),
                Sys.Game.Game2.Services.GameServices.getByData(game45Query, {days: 1, otherData: 1, gameType: 1, startDate: 1, endDate: 1})
            ]);
    
            // Process regular games
            for (const game of availableGames) {
                const { days = {}, otherData = {}, gameType } = game;
                const todaySlot = days[currentDay] || [];
                const nextDaySlot = days[nextDay] || [];

                const closeDayInfo = (otherData?.closeDay || []).reduce((acc, day) => {
                    const date = day.closeDate;
                    if (date === today.format('YYYY-MM-DD')) {
                        acc.today = { closed: true, slots: [day.startTime, day.endTime] };
                    } else if (date === nextDate.format('YYYY-MM-DD')) {
                        acc.tomorrow = { closed: true, slots: [day.startTime, day.endTime] };
                    }
                    return acc;
                }, { today: { closed: false, slots: [] }, tomorrow: { closed: false, slots: [] } });

                updateGame23Status(result, {
                    gameType,
                    todaySlot,
                    nextDaySlot,
                    currentTime,
                    closeDayInfo,
                });
            }

            const allGamesData = [...gameData, ...availableGames];
    
            // Process game 4 and 5
            await Promise.all(allGamesData.map(async game => {
                const closeDay = game?.otherData?.closeDay || [];
                const { scheduleStartDate, scheduleEndDate } = getFinalDates(game.startDate, game.endDate, game.days);
                const game4_5_status = getGameStatusFor24HoursNew(scheduleStartDate, scheduleEndDate, game.days, closeDay);
                console.log("game4_5_status--", game4_5_status, game.gameType)
                if (game4_5_status && Object.keys(game4_5_status).length > 0) {
                    result[game.gameType] = {
                        status: game4_5_status.status,
                        date: game4_5_status.date
                    };
                }
            }));
    
            // Update cache
            const cacheValidity = currentDate.getTime() + 30000;
            Sys.AvailableGamesForHall[hallId] = {
                response: result,
                validity: cacheValidity
            };
    
            // Update Game 4 and 5 status for all halls
            Object.values(Sys.AvailableGamesForHall).forEach(hall => {
                hall.response.game_4 = result.game_4;
                hall.response.game_5 = result.game_5;
            });
    
            return {
                status: "success",
                statusCode: 200,
                message: "Available Games For Today Found.",
                result
            };
    
        } catch (error) {
            console.error("Error in availableGameTypes API:", error);
            return {
                status: "fail",
                statusCode: 502,
                message: "Something Went Wrong.",
                result: null
            };
        }
    },

    // game1Status function for game 1 realtime status, Start at, Open, Closed
    game1Status: async function (socket, data) {
        try {
            // Parallel fetch player and hall data
            const [player] = await Promise.all([
                Sys.Game.Game1.Services.PlayerServices.getOneByData(
                    { _id: data.playerId }, 
                    { hall: 1 }
                )
            ]);

            if (!player) {
                return await createErrorResponse("player_not_found", socket.languageData || "en");
            }

            if (!player.hall?.id || player.hall.status !== "Approved" ) {
                return await createErrorResponse("no_ongoing_game", player.selectedLanguage || "en", 400, true, null, { status: "Closed" });
            }

            const games = await Sys.App.Services.GameService.getGamesByData(
                getActiveGamesQuery(player.hall.id),
                { gameMode: 1, startDate: 1, graceDate: 1, status: 1, otherData: 1 },
                { sort: { startDate: 1 }, limit: 1 }
            );

            if (!games.length) {
                return await createSuccessResponse({ status: "Closed" }, "Available Games For Today Found.", player.selectedLanguage || "en", false);
            }

            const result = await getGame1Status(games[0]);

            return await createSuccessResponse(result, "Available Games For Today Found.", player.selectedLanguage || "en", false);

        } catch (error) {
            console.error("Error in game1Status:", error);
            return {
                status: "fail",
                statusCode: 502,
                message: "Something Went Wrong.",
                result: null
            };
        }
    },

    // game1Status Cron to send broadcast periodically for status updates
    game1StatusCron: async function () {
        try {
            const preTime = moment().startOf('day').toDate();
            const aftTime = moment().add(24, 'hours').add(6, 'minutes').toDate();

            const gameAggregation = [
                {
                    $match: getActiveGamesQuery(null, preTime, aftTime)
                },
                { "$sort": { "startDate": 1 } },
                { $unwind: "$halls" },
                {
                    $group: {
                        _id: "$halls",
                        game: {
                            $first: {
                                id: "$id",
                                gameMode: "$gameMode",
                                startDate: "$startDate",
                                halls: "$halls",
                                scheduleStartDate: "$otherData.scheduleStartDate",
                                closeStartDate: "$otherData.closeStartDate",
                                closeEndDate: "$otherData.closeEndDate",
                                isPartialClose: "$otherData.isPartialClose",
                                status: "$status",
                                isClosed: "$otherData.isClosed",
                                gameId: "$_id",
                                gameSecondaryStatus: "$otherData.gameSecondaryStatus"
                            }
                        }
                    }
                }
            ];

            const [gameList, connectedSockets] = await Promise.all([
                Sys.Game.Common.Services.GameServices.aggregateQuery(gameAggregation),
                Object.keys(Sys.Io.sockets.sockets)
            ]);

            if (!gameList.length) {
                if (connectedSockets.length) {
                    connectedSockets.forEach(socketId => {
                        Sys.Io.to(socketId).emit('Game1Status', { status: "Closed" });
                    });
                }
                return;
            }

            const dateDifference = [];
            const remainingSockets = [...connectedSockets];

            await Promise.all(gameList.map(async ({ game }) => {
                const playerSockets = await Sys.Game.Game2.Services.PlayerServices.getByData(
                    { "socketId": { $in: remainingSockets }, 'hall.id': game.halls },
                    { socketId: 1 }
                );

                if (!playerSockets.length) return;

                const result = await getGame1Status(
                    {
                        status: game.status,
                        startDate: game.startDate,
                        gameMode: game.gameMode,
                        otherData: {
                            gameSecondaryStatus: game.gameSecondaryStatus,
                            isPartialClose: game.isPartialClose,
                            closeStartDate: game.closeStartDate,
                            closeEndDate: game.closeEndDate,
                            scheduleStartDate: game.scheduleStartDate
                        }
                    }
                );
                
                playerSockets.forEach(({ socketId }) => {
                    const index = remainingSockets.indexOf(socketId);
                    if (index > -1) {
                        remainingSockets.splice(index, 1);
                    }
                    Sys.Io.to(socketId).emit('Game1Status', {
                        status: result.status,
                        date: result.status === "Start at" ? result.date : "",
                        hall: game.halls
                    });
                });

                if (result?.date) {
                    const diff = moment(result.date).utc().diff(moment().utc());
                    const fiveMinutes = 5 * 60 * 1000;
                    const twentyFourHours = 24 * 60 * 60 * 1000;
                    if (diff > 0 && diff < fiveMinutes) {
                        dateDifference.push(diff);
                    } else if (diff >= twentyFourHours) {
                        const tempDiff = diff - twentyFourHours;
                        if (tempDiff > 0 && tempDiff < fiveMinutes) {
                            dateDifference.push(tempDiff);
                        }
                    }
                }
            }));

            // Handle remaining sockets
            if (remainingSockets.length) {
                remainingSockets.forEach(socketId => {
                    Sys.Io.to(socketId).emit('Game1Status', { status: "Closed" });
                });
            }
            
            // Schedule next cron if needed
            if (dateDifference.length) {
                const nextCronTime = Math.min(...dateDifference);
                setTimeout(() => module.exports.game1StatusCron(), nextCronTime);
            }

        } catch (error) {
            console.error("Error in game1StatusCron:", error);
            return {
                status: "fail",
                statusCode: 502,
                message: "Something Went Wrong.",
                result: null
            };
        }
    },

    updateClosedayGame1: async function (dailyScheduleId) {
        try {
            // Parallel DB calls for initial data fetch
            const [dailySchedule, games] = await Promise.all([
                Sys.App.Services.scheduleServices.getDailySingleSchedulesData(
                    { _id: dailyScheduleId },
                    { groupHalls: 1, allHallsId: 1, masterHall: 1, halls: 1, otherData: 1 }
                ),
                Sys.Game.Game2.Services.GameServices.getByData(
                    { parentGameId: dailyScheduleId, status: { $in: ["active", "running"] }, stopGame: false },
                    { 
                        _id: 1, gameMode: 1, startDate: 1, graceDate: 1, 'otherData.scheduleStartDate': 1 
                    },
                    { sort: { startDate: 1 } }
                ),
                Sys.App.Services.GameService.updateManyGameData(
                    { parentGameId: dailyScheduleId },
                    {
                        'otherData.isClosed': false,
                        'otherData.isPartialClose': false
                    }
                )
            ]);
    
            if (!games?.length || !dailySchedule?.otherData?.closeDay?.length) {
                await Sys.Game.Common.Controllers.GameController.game1StatusCron();
                return { status: "success" }
            }
    
            // Prepare bulk operations
            const bulkOperations = [];
            
            for (const game of games) {
                let updateData = null;
                
                for (const closeDay of dailySchedule.otherData.closeDay) {
                    const { startTime: startDate, endTime: endDate } = closeDay.utcDates;
                    const gameStartUtc = moment(game.startDate).utc();
                    const gameGraceUtc = moment(game.graceDate).utc();
                    const scheduleStartUtc = moment(game.otherData?.scheduleStartDate).utc();
                    const currentUtc = moment().utc();

                    const isFullyClosed = game.gameMode === "Manual"
                        ? (gameStartUtc >= startDate && gameGraceUtc <= endDate) || 
                        (currentUtc >= startDate && gameGraceUtc <= endDate)
                        : isDateInRange(gameStartUtc, startDate, endDate);

                    if (isFullyClosed) {
                        updateData = {
                            'otherData.isClosed': true,
                            'otherData.isPartialClose': false
                        };
                        break;
                    }

                    const isPartiallyClosed = game.gameMode === "Manual"
                        ? (gameStartUtc >= startDate && gameStartUtc <= endDate) ||
                        (gameGraceUtc >= startDate && gameGraceUtc <= endDate) ||
                        (gameStartUtc <= startDate && gameGraceUtc >= endDate)
                        : (scheduleStartUtc >= startDate && scheduleStartUtc <= endDate) ||
                        (gameGraceUtc >= startDate && gameGraceUtc <= endDate) ||
                        (scheduleStartUtc <= startDate && gameGraceUtc >= endDate);

                    if (isPartiallyClosed) {
                        updateData = {
                            'otherData.isClosed': false,
                            'otherData.isPartialClose': true,
                            'otherData.closeStartDate': startDate,
                            'otherData.closeEndDate': endDate,
                        };
                    }
                }

                // Only add to bulk operations if there's an update
                if (updateData) {
                    bulkOperations.push({
                        updateOne: {
                            filter: { _id: game._id },
                            update: { $set: updateData }
                        }
                    });
                }
            }

            // Execute bulk write if there are operations
            if (bulkOperations.length > 0) {
                await Sys.Game.Common.Services.GameServices.bulkWriteGames(bulkOperations);
            }

            // Update game status after all updates are complete
            await Sys.Game.Common.Controllers.GameController.game1StatusCron();
            
            return { status: "success" }
    
        } catch (error) {
            console.error("Error in updateClosedayGame1:", error);
            return {
                status: "fail",
                message: "Error in updating close days in game 1",
                statusCode: 400
            }
        }
    },

    closeDayValidation: async function (game) {
        try {
            if (game) {
                const closeDay = game?.otherData?.closeDay || [];
                const { scheduleStartDate, scheduleEndDate } = getFinalDates(game.startDate, game.endDate, game.days);
                const game4_5_status = getGameStatusFor24HoursNew(scheduleStartDate, scheduleEndDate, game.days, closeDay);
                if (game4_5_status) {
                    if (game4_5_status.status == "Open") {
                        return { status: "Open" };
                    } else {
                        return { status: "Closed" };
                    }
                }
            }
            return { status: "Closed" };
        } catch (e) {
            console.log("Error in closeDayValidation", error);
            return { status: "Closed" };
        }
    },
    // Check game 1 status fhall based 
    isHallClosed: async function (socket, data) {
        try {
            const { hallId } = data || {};
    
            if (!hallId) {
                return {
                    result: { isClosed: true },
                    message: "",
                    statusCode: 400
                };
            }
    
            const cacheKey = `hall_${hallId}`;
            const now = moment();
            const cached = game1HallStausCache.get(cacheKey);
    
            if (cached && now.isBefore(cached.expiry)) {
                return cached.response;
            }
    
            const endOfDay = now.clone().add(24, 'hours');
    
            const query = {
                gameType: "game_1",
                stopGame: false,
                'otherData.isClosed': false,
                $or: [
                    { status: { $in: ["active", "running"] } },
                    { 'otherData.gameSecondaryStatus': { $ne: "finish" } }
                ],
                halls: { $in: [hallId] },
                startDate: {
                    $gte: now.startOf('day').toDate(),
                    $lt: endOfDay.toDate()
                }
            };
    
            const games = await Sys.Game.Game2.Services.GameServices.getByData(query, { status: 1 }, { sort: { startDate: 1 }, limit: 1 });
    
            const isClosed = games.length === 0;
    
            const response = {
                result: { isClosed },
                message: "",
                statusCode: 200
            };
    
            // Cache result for 10 seconds
            game1HallStausCache.set(cacheKey, {
                response,
                expiry: now.add(10, 'seconds')
            });
    
            return response;
    
        } catch (error) {
            console.error("Error in isHallClosed:", error);
            return {
                result: { isClosed: true },
                statusCode: 502
            };
        }
    }

    // Not used functions

    //[ Loyalty points get player]  We are not using points money
    // loyaltyPointsPlayer: async function () {
    //     try {
    //         // [ Time Setup ]
    //         let newDay = new Date();
    //         newDay.setHours(0, 0, 0);

    //         let endFrom = new Date(Date.now());
    //         endFrom.setHours(23, 59, 59);

    //         var query = {
    //             ltime: {
    //                 $gte: newDay,
    //                 $lt: endFrom,
    //             },
    //             slug: ''
    //         }

    //         let data = await Sys.App.Services.LoyaltyService.getByDataLoyalty(query);

    //         let playerIsCheck = await Sys.App.Services.PlayerServices.updateManyDataDailyAttendance({ isDailyAttendance: true }, {
    //             $set: { isDailyAttendance: false }
    //         });


    //         let players = await Sys.Game.Common.Services.PlayerServices.getByDataLoyalty({});

    //         let today = '',
    //             loyaltyDay = '';
    //         if (data.length > 0) {
    //             for (let i = 0; i < data.length; i++) {
    //                 for (let j = 0; j < players.length; j++) {

    //                     today = await Sys.Helper.bingo.dobFormatCompare(new Date(Date.now()));
    //                     loyaltyDay = await Sys.Helper.bingo.dobFormatCompare(data[i].ltime);

    //                     if (JSON.stringify(today) == JSON.stringify(loyaltyDay)) {

    //                         var transactionDataSend = {
    //                             playerId: players[j]._id,
    //                             loyaltyId: data[i]._id,
    //                             transactionSlug: "loyalty",
    //                             action: "credit", // debit / credit
    //                             purchasedSlug: "points", // point /realMoney
    //                             totalAmount: data[i].points,
    //                         }

    //                         await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);
    //                     }
    //                 }
    //             }
    //         }


    //         let playerDob = '',
    //             newDateForDob = '';
    //         let dataSlug = await Sys.App.Services.LoyaltyService.getByDataLoyalty({ slug: "birthday" });
    //         for (let p = 0; p < players.length; p++) {

    //             if (dataSlug[0].slug == 'birthday') {

    //                 playerDob = await Sys.Helper.bingo.dobFormatCompare(players[p].dob);

    //                 newDateForDob = await Sys.Helper.bingo.dobFormatCompare(newDay);

    //                 if (JSON.stringify(playerDob) == JSON.stringify(newDateForDob)) {

    //                     var transactionDataSend = {
    //                         playerId: players[p]._id,
    //                         loyaltyId: dataSlug[0]._id,
    //                         transactionSlug: "loyalty",
    //                         action: "credit", // debit / credit
    //                         purchasedSlug: "points", // point /realMoney
    //                         totalAmount: dataSlug[l].points,
    //                     }

    //                     await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);
    //                 }

    //             }
    //         }

    //     } catch (error) {
    //         console.log("loyaltyPointsPlayer error", error);
    //     }
    // },

    //[ Leaderboard points get player]  We are not using points money
    // leaderboardPointsPlayer: async function () {
    //     try {

    //         let leaderboard = await Sys.App.Services.LeaderboardServices.getByDataAce({});

    //         let players = await Sys.Game.Common.Services.PlayerServices.getByData({}, ['points']);

    //         let StoreData = players;
    //         let top1120Arr = [];
    //         let top2140Arr = [];
    //         let top4160Arr = [];
    //         let top6180Arr = [];
    //         let top8100Arr = [];

    //         StoreData.slice([10], [19]).map((item, i) => {
    //             top1120Arr.push(item);
    //         });

    //         console.log("top1120Arr", top1120Arr);

    //         StoreData.slice([20], [39]).map((item, i) => {
    //             top2140Arr.push(item);
    //         });

    //         console.log("top2140Arr", top2140Arr);

    //         StoreData.slice([40], [59]).map((item, i) => {
    //             top4160Arr.push(item);
    //         });

    //         console.log("top4160Arr", top4160Arr);

    //         StoreData.slice([60], [79]).map((item, i) => {
    //             top6180Arr.push(item);
    //         });

    //         console.log("top6180Arr", top6180Arr);

    //         StoreData.slice([80], [99]).map((item, i) => {
    //             top8100Arr.push(item);
    //         });

    //         console.log("top8100Arr", top8100Arr);


    //         for (let i = 0; i < leaderboard.length; i++) {

    //             if (leaderboard[i].place == "11-20") {

    //                 for (let a = 0; a < top1120Arr.length; a++) {

    //                     let transactionDataSend = {
    //                         playerId: top1120Arr[a]._id,
    //                         leaderboardId: leaderboard[i]._id,
    //                         transactionSlug: "leaderboard",
    //                         action: "credit", // debit / credit
    //                         purchasedSlug: "points", // point /realMoney
    //                         totalAmount: leaderboard[i].points,
    //                     }

    //                     await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);

    //                 }

    //             } else if (leaderboard[i].place == "21-40") {

    //                 for (let b = 0; b < top2140Arr.length; b++) {

    //                     let transactionDataSend = {
    //                         playerId: top2140Arr[b]._id,
    //                         leaderboardId: leaderboard[i]._id,
    //                         transactionSlug: "leaderboard",
    //                         action: "credit", // debit / credit
    //                         purchasedSlug: "points", // point /realMoney
    //                         totalAmount: leaderboard[i].points,
    //                     }

    //                     await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);


    //                 }

    //             } else if (leaderboard[i].place == "41-60") {

    //                 for (let c = 0; c < top4160Arr.length; c++) {

    //                     let transactionDataSend = {
    //                         playerId: top4160Arr[c]._id,
    //                         leaderboardId: leaderboard[i]._id,
    //                         transactionSlug: "leaderboard",
    //                         action: "credit", // debit / credit
    //                         purchasedSlug: "points", // point /realMoney
    //                         totalAmount: leaderboard[i].points,
    //                     }

    //                     await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);


    //                 }

    //             } else if (leaderboard[i].place == "61-80") {

    //                 for (let e = 0; e < top6180Arr.length; e++) {


    //                     let transactionDataSend = {
    //                         playerId: top6180Arr[e]._id,
    //                         leaderboardId: leaderboard[i]._id,
    //                         transactionSlug: "leaderboard",
    //                         action: "credit", // debit / credit
    //                         purchasedSlug: "points", // point /realMoney
    //                         totalAmount: leaderboard[i].points,
    //                     }

    //                     await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);

    //                 }

    //             } else if (leaderboard[i].place == "81-100") {

    //                 for (let f = 0; f < top8100Arr.length; f++) {

    //                     let transactionDataSend = {
    //                         playerId: top8100Arr[f]._id,
    //                         leaderboardId: leaderboard[i]._id,
    //                         transactionSlug: "leaderboard",
    //                         action: "credit", // debit / credit
    //                         purchasedSlug: "points", // point /realMoney
    //                         totalAmount: leaderboard[i].points,
    //                     }

    //                     await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);

    //                 }

    //             } else {

    //                 let transactionDataSend = {
    //                     playerId: players[i]._id,
    //                     leaderboardId: leaderboard[i]._id,
    //                     transactionSlug: "leaderboard",
    //                     action: "credit", // debit / credit
    //                     purchasedSlug: "points", // point /realMoney
    //                     totalAmount: leaderboard[i].points,
    //                 }

    //                 await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);
    //             }

    //         }

    //     } catch (error) {
    //         console.log("leaderboardPointsPlayer error", error);
    //     }
    // },

    // [ Game Type List Function ]
    // home: async function (socket, data) {
    //     try {
    //         var gameList = await Sys.Game.Common.Services.GameServices.getListData({});
    //         console.log("gameList of home", gameList);
    //         return {
    //             status: 'success',
    //             result: gameList,
    //             message: 'Home List'
    //         }

    //     } catch (error) {
    //         console.log("Error home", error);
    //     }
    // },

    // groupHallList: async function (socket, data) {
    //     try {
    //         var gameList = await Sys.Game.Common.Services.GameServices.getGroupHallData({});
    //         console.log("groupHallList", gameList);
    //         return {
    //             status: 'success',
    //             result: gameList,
    //             message: 'hallList List'
    //         }

    //     } catch (error) {
    //         console.log("Error hallList", error);
    //     }
    // },

     // [ Game List Function ]
    // gameList: async function (socket, data) {
    //     try {

    //         let player = await Sys.Game.Common.Services.PlayerServices.getById(data.playerId);
    //         if (player) {
    //             let dataGameType, namespaceString;
    //             if (data.game == 1) {
    //                 dataGameType = "game_1";
    //                 namespaceString = Sys.Config.Namespace.Game1;
    //             }
    //             //  else if (data.game == 2) {
    //             //     dataGameType = "game_2";
    //             //     namespaceString = Sys.Config.Namespace.Game2;
    //             // } 
    //             else if (data.game == 3) {
    //                 dataGameType = "game_3";
    //                 namespaceString = Sys.Config.Namespace.Game3;
    //             } else if (data.game == 4) {
    //                 dataGameType = "game_4";
    //                 namespaceString = Sys.Config.Namespace.Game4;
    //             }

    //             //console.log("dataGameType", dataGameType);
    //             let query = {
    //                 gameType: dataGameType ? dataGameType : '',
    //                 status: { $ne: 'finish' },
    //                 allHallsId: { $in: [player.hall.id] },
    //                 startDate: { $gte: Date.now() }
    //             }
    //             if (data.game == 1) {
    //                 if (data.hall == "All") {
    //                     if (player.userType == "Unique" && player.isCreatedByAdmin == true) {
    //                         query = {
    //                             gameType: dataGameType,
    //                             status: { $ne: 'finish' },
    //                             isSubGame: true,
    //                         };
    //                     } else if (player.userType == "Unique" && player.isCreatedByAdmin == false) {
    //                         console.log("Unique userType with agent creator, so need to check for hall");
    //                         let agentHalls = await Sys.App.Services.HallServices.getAllHallDataSelect({ agents: { $elemMatch: { _id: player.createrId } } }, { name: 1 });
    //                         console.log("agent halls", agentHalls)
    //                         let playerHalls = [];
    //                         if (agentHalls.length > 0) {
    //                             for (let p = 0; p < agentHalls.length; p++) {
    //                                 playerHalls.push(agentHalls[p]._id);
    //                             }
    //                         }
    //                         query = {
    //                             gameType: dataGameType,
    //                             status: { $ne: 'finish' },
    //                             isSubGame: true,
    //                             halls: { $elemMatch: { _id: { $in: playerHalls } } },
    //                         };
    //                     } else {
    //                         let playerHalls = [];
    //                         // for (let p = 0; p < player.hall.length; p++) {
    //                         //     if (player.hall[p].status == "Approved") {
    //                         //         playerHalls.push(player.hall[p]._id);
    //                         //     }
    //                         // }
    //                         console.log("playerHalls in else", playerHalls)
    //                         query = {
    //                             gameType: dataGameType,
    //                             status: { $ne: 'finish' },
    //                             isSubGame: true,
    //                             // halls: { $elemMatch: { _id: { $in: playerHalls} }},
    //                             halls: { $elemMatch: { _id: { $in: [player.hall.id] } } },
    //                         };
    //                     }

    //                 } else {
    //                     console.log("dta.halls", data.hall, typeof data.hall, Array.isArray(data.hall))
    //                     if (Array.isArray(data.hall) == true) {
    //                         console.log("hall is array type", data.hall)
    //                         query = {
    //                             gameType: dataGameType,
    //                             status: { $ne: 'finish' },
    //                             halls: { $elemMatch: { name: { $in: data.hall } } },
    //                             isSubGame: true,
    //                         };
    //                     } else {
    //                         query = {
    //                             gameType: dataGameType,
    //                             status: { $ne: 'finish' },
    //                             halls: { $elemMatch: { name: data.hall } },
    //                             isSubGame: true,
    //                         };
    //                     }

    //                 }

    //             }
    //             //console.log("data", data, query)
    //             let gameList = await Sys.Game.Common.Services.GameServices.getByData(query);
    //             // console.log("gameList",gameList)

    //             let finalListing = [];
    //             for (let i = 0; i < gameList.length; i++) {
    //                 buyButton = false;
    //                 cancelButton = false;
    //                 playButton = false;

    //                 let startTime = moment(gameList[i].startDate);
    //                 let graceTime = moment(gameList[i].endDate);
    //                 let currentTime = Date.now();
    //                 let endTime = moment(currentTime);
    //                 let duration = moment.duration(startTime.diff(endTime));
    //                 let hours = parseInt(duration.asHours());
    //                 let minutes = parseInt(duration.asMinutes()) - hours * 60;
    //                 let seconds = parseInt(duration.asSeconds()) - minutes * 60;

    //                 // console.log("Game Start Time in:- ", minutes, "minutes", seconds, "seconds");
    //                 let gameName = "";
    //                 if (data.game == 1) {
    //                     gameName = gameList[i].mainGameName + "-" + gameList[i].subGames[0].gameName;
    //                 }

    //                 // [ Player Ticket (yesNo) ]
    //                 let playerTicketPurN = gameList[i].purchasedTickets.find(i => JSON.stringify(i.playerIdOfPurchaser) == JSON.stringify(player._id));

    //                 if (playerTicketPurN) {
    //                     if (data.game == 1) {

    //                         // if ( gameList[i].gameMode == 'auto' &&  gameList[i].graceDate <= Date.now()  ) {
    //                         //     continue;
    //                         // }
    //                         //let ownPurchasedTicketCount = gameList[i].purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(player._id));
    //                         // check for tickets availability
    //                         let isTicketAvailable = false;
    //                         if (gameList[i].subGames[0].options.length > 0) {
    //                             for (let o = 0; o < gameList[i].subGames[0].options.length; o++) {
    //                                 console.log("tickets count", gameList[i].subGames[0].options[o].totalPurchasedTickets)
    //                                 if (gameList[i].subGames[0].options[o].totalPurchasedTickets < gameList[i].subGames[0].options[o].ticketCount) {
    //                                     isTicketAvailable = true;
    //                                     break;
    //                                 }
    //                             }
    //                         }
    //                         console.log("isTicketAvailable", isTicketAvailable)

    //                         if (gameList[i].startDate <= Date.now()) {

    //                             if (gameList[i].gameMode == 'auto' && gameList[i].status == 'running' && isTicketAvailable == false) {
    //                                 console.log("all ticket purchased, so display play button, grace time ma minTicketCount shate game start thase to play button aavse..!!")
    //                                 playButton = true;
    //                             } else if (gameList[i].gameMode == 'auto' && gameList[i].graceDate <= Date.now() && gameList[i].status == 'active') {
    //                                 console.log("continue in loop 1")
    //                                 continue;
    //                             } else if ((gameList[i].gameMode == 'auto' || gameList[i].gameMode == 'manual') && isTicketAvailable == true) {
    //                                 console.log("ticket available 1")
    //                                 if (gameList[i].graceDate >= Date.now()) {
    //                                     console.log("game auto hoy and minimun ticket purchased kari hoy to play button ahiya aavse");
    //                                     let ownPurchasedTicketCount = gameList[i].purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(player._id));
    //                                     if (ownPurchasedTicketCount.length >= 30) {
    //                                         console.log("ticket available 2")
    //                                         playButton = true;
    //                                         cancelButton = true;
    //                                     } else {
    //                                         console.log("ticket available 3")
    //                                         playButton = true;
    //                                         buyButton = true;
    //                                         cancelButton = true;
    //                                     }
    //                                 } else {
    //                                     console.log("ticket available 4")
    //                                     playButton = true;
    //                                 }
    //                             } else if ((gameList[i].gameMode == 'auto' || gameList[i].gameMode == 'manual') && isTicketAvailable == false) {
    //                                 console.log("ticket not available 1")
    //                                 playButton = true;
    //                                 //cancelButton = true;
    //                             } else if (gameList[i].gameMode == 'manual' && gameList[i].totalNoTickets == gameList[i].purchasedTickets.length) {
    //                                 console.log("ticket available 1")
    //                                 playButton = true;
    //                             }
    //                             //else if (gameList[i].gameMode == 'manual' && gameList[i].status == 'active' && gameList[i].startDate <= Date.now()) {
    //                             else if (gameList[i].gameMode == 'manual' && gameList[i].status == 'active' && startTime <= endTime) {
    //                                 console.log("ahiya aave che paku");
    //                                 continue;
    //                             } else {
    //                                 console.log("grace time else")
    //                                 playButton = true;
    //                                 buyButton = true;
    //                                 cancelButton = true;
    //                             }

    //                         } else {
    //                             console.log("game in start time")
    //                             // [ Tickets Purchased ]
    //                             if (gameList[i].gameMode == 'auto' && gameList[i].status == 'running' && isTicketAvailable == false) {
    //                                 console.log("game in start time 1")
    //                                 playButton = true;
    //                             } else if (isTicketAvailable == false) {
    //                                 console.log("game in start time 2")
    //                                 playButton = true;
    //                             } else {
    //                                 console.log("game in start time 3")
    //                                 if (gameList[i].gameMode == 'manual' && isTicketAvailable == false) {
    //                                     console.log("game in start time 4")
    //                                     playButton = true;
    //                                 }
    //                                 //else if (gameList[i].gameMode == 'manual' && gameList[i].status == 'active' && gameList[i].startDate <= Date.now()) {
    //                                 else if (gameList[i].gameMode == 'manual' && gameList[i].status == 'active' && startTime <= endTime) {
    //                                     console.log("game in start time 5")
    //                                     continue;
    //                                 } else {
    //                                     console.log("game in start time 6")
    //                                     //if (gameList[i].gameMode == 'manual' || gameList[i].graceDate >= Date.now()) {
    //                                     if (gameList[i].gameMode == 'manual' || graceTime >= endTime) {
    //                                         console.log("game in start time 7")
    //                                         console.log("game auto hoy and minimun ticket purchased kari hoy to play button ahiya aavse");
    //                                         let ownPurchasedTicketCount = gameList[i].purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(player._id));
    //                                         if (ownPurchasedTicketCount.length >= 30) {
    //                                             console.log("game in start time 8")
    //                                             playButton = true;
    //                                             cancelButton = true;
    //                                         } else {
    //                                             console.log("game in start time 9")
    //                                             playButton = true;
    //                                             buyButton = true;
    //                                             cancelButton = true;
    //                                         }
    //                                     } else {
    //                                         console.log("game in start time 10")
    //                                         playButton = true;
    //                                     }
    //                                 }

    //                             }
    //                         }

    //                     } else if (data.game == 2 && gameList[i].gameMode == 'auto') {
    //                         let ownPurchasedTicketCount = gameList[i].purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(player._id));
    //                         if (gameList[i].status == 'running' && gameList[i].minTicketCount <= gameList[i].purchasedTickets.length) {
    //                             playButton = true;
    //                         } else if (gameList[i].status == 'active' && gameList[i].minTicketCount <= gameList[i].purchasedTickets.length) {
    //                             if (gameList[i].isNotificationSent == true) {
    //                                 playButton = true;
    //                             } else {
    //                                 if (ownPurchasedTicketCount.length >= 30) {
    //                                     playButton = true;
    //                                     cancelButton = true;
    //                                 } else {
    //                                     playButton = true;
    //                                     buyButton = true;
    //                                     cancelButton = true;
    //                                 }
    //                             }
    //                         } else {
    //                             if (ownPurchasedTicketCount.length >= 30) {
    //                                 playButton = true;
    //                                 cancelButton = true;
    //                             } else {
    //                                 playButton = true;
    //                                 buyButton = true;
    //                                 cancelButton = true;
    //                             }
    //                         }
    //                     }
    //                     else {
    //                         // [ Game Running ]
    //                         if (gameList[i].startDate <= Date.now()) {

    //                             // [ Game Auto && Minimum Ticket Validation ]
    //                             if (gameList[i].gameMode == 'auto' && gameList[i].status == 'running' && gameList[i].minTicketCount <= gameList[i].purchasedTickets.length) {
    //                                 console.log("grace time ma minTicketCount shate game start thase to play button aavse..!!")
    //                                 playButton = true;
    //                             } else if (gameList[i].gameMode == 'auto' && gameList[i].graceDate <= Date.now() && gameList[i].status == 'active') {
    //                                 continue;
    //                             } else if (gameList[i].gameMode == 'auto' && gameList[i].minTicketCount > gameList[i].purchasedTickets.length) {
    //                                 if (gameList[i].graceDate >= Date.now()) {
    //                                     console.log("game auto hoy and minimun ticket purchased kari hoy to play button ahiya aavse");
    //                                     if (gameList[i].totalNoTickets >= 31) {
    //                                         let ownPurchasedTicketCount = gameList[i].purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(player._id));
    //                                         if (ownPurchasedTicketCount.length >= 30 && gameList[i].graceDate >= Date.now()) {
    //                                             playButton = true;
    //                                             cancelButton = true;
    //                                         } else {
    //                                             playButton = true;
    //                                             buyButton = true;
    //                                             cancelButton = true;
    //                                         }
    //                                     } else {
    //                                         if (gameList[i].gameType == "game_2") {
    //                                             buyButton = true;
    //                                             cancelButton = true;
    //                                         } else {
    //                                             playButton = true;
    //                                             buyButton = true;
    //                                             cancelButton = true;
    //                                         }
    //                                     }
    //                                 } else {
    //                                     playButton = true;
    //                                 }
    //                             } else if (gameList[i].gameMode == 'auto' && gameList[i].status == 'running' && gameList[i].minTicketCount <= gameList[i].purchasedTickets.length) {
    //                                 playButton = true;
    //                             } else if (gameList[i].gameMode == 'auto' && gameList[i].minTicketCount <= gameList[i].purchasedTickets.length) {
    //                                 console.log("Grace Time 30/1000 Ticket", gameList[i].gameNumber, "gameList[i].status", gameList[i].status);
    //                                 let remaingTick = gameList[i].totalNoTickets - gameList[i].purchasedTickets.length;
    //                                 console.log("gameList[i].totalNoTickets", gameList[i].totalNoTickets);
    //                                 console.log("Grace Time Ticket", remaingTick, "check for 30/1000");
    //                                 if (gameList[i].totalNoTickets >= 31) {
    //                                     let ownPurchasedTicketCount = gameList[i].purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(player._id));
    //                                     if (ownPurchasedTicketCount.length >= 30 && gameList[i].graceDate >= Date.now()) {
    //                                         playButton = true;
    //                                         cancelButton = true;
    //                                     } else {

    //                                         if (gameList[i].totalNoTickets == gameList[i].purchasedTickets.length) {
    //                                             playButton = true;
    //                                             // cancelButton = true;
    //                                         } else {
    //                                             playButton = true;
    //                                             buyButton = true;
    //                                             cancelButton = true;
    //                                         }


    //                                     }
    //                                 } else {
    //                                     if (remaingTick > 0 && gameList[i].graceDate >= Date.now()) {

    //                                         if (gameList[i].gameType == "game_2") {
    //                                             buyButton = true;
    //                                             cancelButton = true;
    //                                         } else {
    //                                             playButton = true;
    //                                             buyButton = true;
    //                                             cancelButton = true;
    //                                         }


    //                                     } else {
    //                                         playButton = true;
    //                                     }
    //                                 }
    //                             } else if (gameList[i].gameMode == 'manual' && gameList[i].totalNoTickets == gameList[i].purchasedTickets.length) {
    //                                 playButton = true;
    //                             } else if (gameList[i].gameMode == 'manual' && gameList[i].status == 'active' && gameList[i].startDate <= Date.now()) {
    //                                 console.log("ahiya aave che paku");
    //                                 continue;
    //                             } else {
    //                                 if (gameList[i].gameType == "game_2") {
    //                                     buyButton = true;
    //                                     cancelButton = true;
    //                                 } else {
    //                                     playButton = true;
    //                                     buyButton = true;
    //                                     cancelButton = true;
    //                                 }
    //                             }

    //                         } else {
    //                             // [ Tickets Purchased ]
    //                             if (gameList[i].gameMode == 'auto' && gameList[i].status == 'running' && gameList[i].minTicketCount <= gameList[i].purchasedTickets.length) {

    //                                 playButton = true;

    //                             } else if (gameList[i].totalNoTickets == gameList[i].purchasedTickets.length) { // 30 == 30

    //                                 let targetObjectAllPurchased = gameList[i].purchasedTickets.find(i => JSON.stringify(i.playerIdOfPurchaser) == JSON.stringify(player._id));
    //                                 if (targetObjectAllPurchased) {
    //                                     playButton = true;
    //                                 }

    //                             } else {
    //                                 //[ 1000 Tickets ]
    //                                 console.log("gameList[i].totalNoTickets", gameList[i].totalNoTickets);
    //                                 if (gameList[i].totalNoTickets >= 31) {
    //                                     let ownPurchasedTicketCount = gameList[i].purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(player._id));
    //                                     console.log("Game 2 Button 1000 :ownPurchasedTicketCount.length > 30 1 ", ownPurchasedTicketCount.length > 30);
    //                                     console.log(gameList[i].gameNumber, "gameList[i].status", gameList[i].status);
    //                                     if (ownPurchasedTicketCount.length >= 30) {
    //                                         playButton = true;
    //                                         cancelButton = true;
    //                                     } else {
    //                                         if (gameList[i].status == 'running') {
    //                                             playButton = true;
    //                                         } else {
    //                                             playButton = true;
    //                                             buyButton = true;
    //                                             cancelButton = true;
    //                                         }
    //                                     }
    //                                 } else if (gameList[i].gameMode == 'manual' && gameList[i].totalNoTickets == gameList[i].purchasedTickets.length) {
    //                                     playButton = true;
    //                                 } else if (gameList[i].gameMode == 'manual' && gameList[i].status == 'active' && gameList[i].startDate <= Date.now()) {
    //                                     console.log("ahiya aave che 1");
    //                                     continue;
    //                                 } else {
    //                                     if (gameList[i].gameType == "game_2") {
    //                                         console.log("ahiya aave che 2 ");
    //                                         if (gameList[i].gameMode == 'manual' && gameList[i].status == 'active' && gameList[i].startDate <= Date.now()) {
    //                                             console.log("ahiya aave che 3");
    //                                             continue;
    //                                         } else {
    //                                             buyButton = true;
    //                                             cancelButton = true;
    //                                         }
    //                                     } else {
    //                                         playButton = true;
    //                                         buyButton = true;
    //                                         cancelButton = true;
    //                                     }
    //                                 }
    //                             }
    //                         }
    //                     }

    //                 }

    //                 // [ No Ticket Purchase ]
    //                 else {
    //                     if (data.game == 1) {
    //                         // if ( gameList[i].gameMode == 'auto' &&  gameList[i].graceDate <= Date.now()  ) {
    //                         //     continue;
    //                         // }
    //                         // check for available tickets
    //                         let isTicketAvailable = false;
    //                         if (gameList[i].subGames[0].options.length > 0) {
    //                             for (let o = 0; o < gameList[i].subGames[0].options.length; o++) {
    //                                 console.log("tickets count in first time", gameList[i].subGames[0].options[o].totalPurchasedTickets)
    //                                 if (gameList[i].subGames[0].options[o].totalPurchasedTickets < gameList[i].subGames[0].options[o].ticketCount) {
    //                                     //if(gameList[i].subGames[0].options[o].totalPurchasedTickets > 0){
    //                                     isTicketAvailable = true;
    //                                     break;
    //                                 }
    //                             }
    //                         }
    //                         console.log("isTicketAvailable", isTicketAvailable)
    //                         if (gameList[i].gameMode == 'auto' && gameList[i].graceDate <= Date.now() && gameList[i].status == 'active') {
    //                             continue;
    //                         } else if (gameList[i].gameMode == 'manual' && gameList[i].status == 'active' && startTime <= endTime) {
    //                             console.log("ahiya aave che paku");
    //                             continue;
    //                         } else if (isTicketAvailable == true && gameList[i].status != 'running') {
    //                             buyButton = true;
    //                         } else {
    //                             continue;
    //                         }

    //                     }
    //                     else if (data.game == 2 && gameList[i].gameMode == 'auto') {
    //                         if (gameList[i].status == 'running' && gameList[i].minTicketCount >= gameList[i].purchasedTickets.length) {
    //                             continue;
    //                         } else if (gameList[i].gameMode == 'auto' && gameList[i].status == 'active' && gameList[i].minTicketCount >= gameList[i].purchasedTickets.length) {
    //                             buyButton = true;
    //                         } else {
    //                             if (gameList[i].gameMode == 'auto' && gameList[i].status == 'active' && gameList[i].totalNoTickets > gameList[i].purchasedTickets.length) {
    //                                 buyButton = true;
    //                             } else {
    //                                 continue;
    //                             }
    //                         }
    //                     }
    //                     else {
    //                         if (gameList[i].startDate <= Date.now()) {
    //                             // [ Game Auto && Minimum Ticket Validation ]
    //                             if (gameList[i].gameMode == 'auto' && gameList[i].status == 'running' && gameList[i].minTicketCount >= gameList[i].purchasedTickets.length && gameList[i].graceDate >= Date.now()) {
    //                                 continue;
    //                             } else if (gameList[i].gameMode == 'auto' && gameList[i].status == 'active' && gameList[i].minTicketCount >= gameList[i].purchasedTickets.length && gameList[i].graceDate >= Date.now()) {
    //                                 buyButton = true;
    //                             } else {
    //                                 if (gameList[i].gameMode == 'auto' && gameList[i].status == 'active' && gameList[i].graceDate >= Date.now() && gameList[i].totalNoTickets > gameList[i].purchasedTickets.length) {
    //                                     buyButton = true;
    //                                 } else {
    //                                     continue;
    //                                 }

    //                             }
    //                         } else if (gameList[i].totalNoTickets == gameList[i].purchasedTickets.length) { // 30 == 30
    //                             continue;
    //                         } else {
    //                             buyButton = true;
    //                         }
    //                     }

    //                 }

    //                 let gameTime = gameList[i].startDate;

    //                 // [ Auto ]
    //                 if (gameList[i].gameMode == 'auto') {

    //                     // [ Game Start + Ticket Not Purchase(Player) = Grace Time ]
    //                     if (currentTime > gameTime && gameList[i].status == 'active') {
    //                         gameTime = gameList[i].graceDate;
    //                     }

    //                     // [ Inner List ]
    //                     else if (currentTime > gameList[i].graceDate && gameList[i].status == 'running') {
    //                         gameTime = gameList[i].graceDate;
    //                     } else if (gameList[i].gameType == 'game_2') {
    //                         gameTime = gameList[i].startDate;
    //                     }

    //                 }
    //                 let halls = [];
    //                 //Halls will be selected from allHallIds for game_2
    //                 if (gameList[i].gameType == "game_2") {
    //                     halls = await Sys.App.Services.HallServices.getAllHallDataSelect({ _id: { "$in": gameList[i].allHallsId } }, { name: 1, _id: 0 });
    //                 } else {
    //                     if (gameList[i].halls.length > 0) {
    //                         for (let h = 0; h < gameList[i].halls.length; h++) {
    //                             halls.push(gameList[i].halls[h].name);
    //                         }
    //                     }
    //                 }
    //                 if (gameList[i].gameType == "game_2" && gameList[i].isNotificationSent) {
    //                     buyButton = false;
    //                     cancelButton = false;
    //                 }
    //                 // console.log("gameList halls", halls)
    //                 let dataGame = {
    //                     gameId: gameList[i]._id,
    //                     namespaceString: namespaceString,
    //                     gameNumber: gameList[i].gameNumber,
    //                     startingTime: moment(new Date(gameTime)).tz('UTC').format('DD-MM-YYYY HH:mm:ss'),  //await Sys.Helper.bingo.gameFormateTime(gameTime),
    //                     playButton: playButton,
    //                     buyButton: buyButton,
    //                     cancelButton: cancelButton,
    //                     gameName: gameName,
    //                     halls: halls
    //                 }

    //                 if (gameList[i].gameMode == 'auto' && gameList[i].graceDate == null && data.game !== 2) {
    //                     continue;
    //                 }

    //                 finalListing.push(dataGame);
    //             }
    //             console.log("finalListing", finalListing); //JSON.stringify(finalListing)
    //             return {
    //                 status: 'success',
    //                 result: finalListing,
    //                 message: 'gameList List'
    //             }
    //         }
    //         return {
    //             status: 'fail',
    //             result: null,
    //             message: 'No Player Found!',
    //             statusCode: 400
    //         }

    //     } catch (error) {
    //         console.log("Error in gameList", error);
    //         return {
    //             status: 'fail',
    //             result: null,
    //             message: 'Game not Found!',
    //             statusCode: 400
    //         }
    //     }
    // },

    // leaderboard: async function (socket, data) {
    //     try {
    //         let player = await Sys.Game.Common.Services.PlayerServices.getById(data.playerId);
    //         if (player) {

    //             let players = await Sys.Game.Common.Services.PlayerServices.getByData({}, ['nickname', 'points']);

    //             return {
    //                 status: 'success',
    //                 result: players,
    //                 message: 'leaderboard List'
    //             }
    //         } else {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: 'No Player Found!',
    //                 statusCode: 400
    //             }
    //         }
    //     } catch (error) {
    //         console.log("Error leaderboard", error);
    //     }
    // },

    // Used to add ticketId ball wise in game_1
    // updateGame1TicketIds: async function (gameId) {
    //     try {
    //         console.log("updateGame1TicketIds", gameId)
    //         let gameData = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, { status: 1, disableTicketPurchase: 1 });
    //         if (gameData && gameData.status == "active" && gameData.disableTicketPurchase == true) {
    //             let prTickets = await Sys.Game.Game1.Services.GameServices.getTicketListData({ gameId: gameId }, { tickets: 1 })
    //             console.log("prTickets in updateGame1TicketIds", prTickets.length)
    //             let bulupdateTicketData = [];
    //             if (prTickets.length > 0) {
    //                 for (p = 0; p < prTickets.length; p++) {
    //                     //console.log(" prTickets[p]",  prTickets[p].tickets);
    //                     let ticketBallData = {};
    //                     for (let t = 0; t < prTickets[p].tickets.length; t++) {
    //                         for (let n = 0; n < prTickets[p].tickets[t].length; n++) {
    //                             //console.log("prTickets[p] inside", prTickets[p].tickets[t][n].Number, prTickets[p]._id)
    //                             if (+prTickets[p].tickets[t][n].Number != 0) {
    //                                 ticketBallData["ticketIdForBalls." + prTickets[p].tickets[t][n].Number] = { ticketId: prTickets[p]._id, position: t + ":" + n }
    //                             }

    //                         }

    //                     }
    //                     //console.log("ticketBallData", ticketBallData)
    //                     bulupdateTicketData.push({
    //                         updateOne: {
    //                             "filter": { _id: gameData._id },
    //                             "update": { $push: ticketBallData }
    //                         }
    //                     })
    //                 }
    //             }
    //             await Sys.App.Services.GameService.bulkWriteGameData(bulupdateTicketData);
    //             return { status: "success", message: "Updated ticketIds" }
    //         } else {
    //             return { status: "fail", message: "Can not update ticketIds" }
    //         }
    //     } catch (error) {
    //         console.log("Error updateGame1TicketIds", error);
    //         return { status: "fail", message: "Can not update ticketIds", gameData }
    //     }
    // },

}


