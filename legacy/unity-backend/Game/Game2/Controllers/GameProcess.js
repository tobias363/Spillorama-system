const Sys = require('../../../Boot/Sys');
const moment = require('moment');
let eventEmitter = Sys.App.get('eventEmitter');
let stopBotInsertion = "";
eventEmitter.on('stopBotTicketPurchase', (data) => {
    stopBotInsertion = data.parentGameId;
});
const { translate } = require('../../../Config/i18n');
const {
    calculateBotTicketCount,
    checkIfGameCanStart,
    checkJackPot,
    checkLuckyNumber,
    cleanupExistingBotGames,
    createGameNotification,
    processBotPlayerTicket,
    validateBotGame
} = require('../../../gamehelper/game2');

const {
    cleanTimeAndData,
    createErrorResponse,
    getAvailableBalls,
    getGameDataFromRedis,
    getGameDataFromRedisHmset,
    getGameTicketsFromRedis,
    getRandomBall,
    loadTicketsToRedis,
    saveGameDataToRedis,
    saveGameDataToRedisHmset,
    setGameTimer,
    syncGameToMongoDB,
    sendNotificationsToPlayers,
    setupGameStartTime,
    updateTicketsAndTransactions,
} = require('../../../gamehelper/all');
  
module.exports = {
    
    // [ Game Start ]
    StartGame: async function(room){
        try{
            await loadTicketsToRedis(room._id, { playerIdOfPurchaser: 1, ticketId: 1, tickets: 1, hallName: 1, hallId: 1, groupHallName: 1, groupHallId: 1 }, "game2");
            
            const updatedGame = await Sys.Game.Game2.Services.GameServices.updateSingleGame(
                { _id: room._id },
                [
                  {
                    $set: {
                      players: {
                        $map: {
                          input: "$players",
                          as: "player",
                          in: {
                            $mergeObjects: ["$$player", { status: "Playing" }]
                          }
                        }
                      },
                      status: "running",
                      timerStart: true,
                      disableTicketPurchase: true // used when game started after resart if notification sent but not started
                    }
                  }
                ],
                { new: true }
            );
            await Sys.Io.of(Sys.Config.Namespace.Game2).to(updatedGame.parentGameId.toString()).emit('GameStart', {});
            const players = updatedGame.players.map(player => player.id);
            if (players.length) {
                await Sys.Game.Game2.Services.PlayerServices.updateManyData(
                    { _id: { $in: players } },
                    { $inc: { 'statisticsgame2.totalGames': 1 } }
                );
            
                // Call checkBreakTime for each (this is still needed if it's side-effect logic)
                players.forEach(playerId => {
                    Sys.Game.Common.Controllers.PlayerController.checkBreakTime(playerId);
                });
            }

             // Initialize game data for Redis
            const gameData = {
                _id: updatedGame._id, 
                players: updatedGame.players, 
                gameNumber: updatedGame.gameNumber,
                parentGameId: updatedGame.parentGameId,
                day: updatedGame.day,
                seconds: updatedGame.seconds,
                withdrawNumberArray: updatedGame.withdrawNumberArray,
                history: updatedGame.history,
                status: updatedGame.status,
                startDate: updatedGame.startDate,
                otherData: updatedGame.otherData,
                availableBalls: [],
                isBotGame: updatedGame.otherData?.isBotGame || false,
                jackPotNumber: updatedGame.jackPotNumber,
                totalTicketCount: updatedGame.totalNoPurchasedTickets,
                luckyNumberPrize: updatedGame.luckyNumberPrize,
                ticketPrice: updatedGame.ticketPrice,
                allPlayerIds: updatedGame.players.map(player => player.id),
                gameName: updatedGame.gameName,
                sequence: updatedGame.sequence,
                isWinningDistributed: false,
                isWinningTicketStatsUpdated: false,
                isLuckyNumberUpdated: false
            };
            // Store in Redis with TTL of 1 hour
            await saveGameDataToRedisHmset('game2', room._id, gameData, { setTTL: true, ttl: 3600 });
            // Start gameplay process
            module.exports.gamePlay(room._id);
        }catch(error){
            console.log("Error in startGame", error);
        }
    },

    gamePlay: async function (gameId, isServerRestart = false) {
        try {
            console.log("game 2 play started", gameId, isServerRestart)
            const timerKey = `${gameId}_timer`;
            // Get game data from Redis
            let gameData = await getGameDataFromRedisHmset('game2', gameId);
            if (!gameData) {
                // Get only the necessary fields for gameplay
                const room = await Sys.Game.Game2.Services.GameServices.getSingleGameByData(
                    { _id: gameId },
                    { _id: 1, players: 1, gameNumber: 1, parentGameId: 1, day: 1, seconds: 1, withdrawNumberList: 1, history: 1, status: 1, startDate: 1, otherData: 1, isBotGame: 1, jackPotNumber: 1, totalNoPurchasedTickets: 1, luckyNumberPrize: 1, ticketPrice: 1, gameName: 1 }
                );
                
                if (!room) {
                    console.log("Error: Game not found for gamePlay", gameId);
                    return;
                }
                const withdrawNumberArray = room.withdrawNumberList?.map(h => h.number) || [];
                gameData = {
                    _id: room._id, 
                    players: room.players, 
                    gameNumber: room.gameNumber,
                    parentGameId: room.parentGameId,
                    day: room.day,
                    seconds: room.seconds,
                    withdrawNumberArray: withdrawNumberArray,
                    history: room.withdrawNumberList,
                    status: room.status,
                    startDate: room.startDate,
                    otherData: room.otherData,
                    availableBalls: getAvailableBalls(withdrawNumberArray, 21),
                    isBotGame: room.otherData?.isBotGame || false,
                    jackPotNumber: room.jackPotNumber,
                    totalTicketCount: room.totalNoPurchasedTickets,
                    luckyNumberPrize: room.luckyNumberPrize,
                    ticketPrice: room.ticketPrice,
                    allPlayerIds: room.players.map(player => player.id),
                    gameName: room.gameName,
                    sequence: room.sequence,
                    isWinningDistributed: room?.otherData?.isWinningDistributed || false,
                    isWinningTicketStatsUpdated: room?.otherData?.isWinningTicketStatsUpdated || false,
                    isLuckyNumberUpdated: room?.otherData?.isLuckyNumberUpdated || false
                };
                // Store in Redis with TTL of 1 hour
                await saveGameDataToRedisHmset('game2', gameId, gameData, { setTTL: true, ttl: 3600 });
                
                // Load tickets for this game into Redis
                //await module.exports.loadTicketsToRedis(gameId);
            } else {
                // If we already have gameData, make sure availableBalls is properly set
                if (!gameData.availableBalls || gameData.availableBalls.length === 0) {
                    gameData.availableBalls = getAvailableBalls(gameData.withdrawNumberArray, 21);
                    //await saveGameDataToRedis('game2', gameId, gameData, 3600);  // Update Redis with the corrected data
                    await saveGameDataToRedisHmset('game2', gameId, { availableBalls: gameData.availableBalls });
                }
            }
            
            // Check if we've reached the maximum number of balls or have no balls left
            const shouldStopGame =
                gameData.withdrawNumberArray.length >= 21 ||
                gameData.availableBalls.length === 0 ||
                isServerRestart;

            if (shouldStopGame) {
                const winnerArr = await module.exports.checkForWinners(gameId);

                if (isServerRestart && winnerArr.length > 0) {
                    return module.exports.gameFinished(gameId);
                }

                // Normal game stop (max draws or no balls)
                if (!isServerRestart) {
                    return winnerArr;
                }
            }
    
            // Get a random ball and its color
            const withdrawBall = getRandomBall(gameData.availableBalls);
            const withdrawColor = "yellow";
            
            const historyObj = {
                number: withdrawBall,
                color: withdrawColor,
                totalWithdrawCount: gameData.withdrawNumberArray.length + 1
            };
            // Update memory data in redis
            gameData.withdrawNumberArray.push(withdrawBall);
            gameData.history.push(historyObj);
            gameData.availableBalls = gameData.availableBalls.filter(n => n !== withdrawBall);
            // Save updated game data to Redis
            await saveGameDataToRedisHmset('game2', gameId, {
                withdrawNumberArray: gameData.withdrawNumberArray,
                history: gameData.history,
                availableBalls: gameData.availableBalls,
            });
           
            // Required for admin
            await Sys.Game.Game2.Services.GameServices.updateGame({ _id: gameId }, {
                $set: {
                    withdrawNumberList: gameData.history    
                }
            });

            // Emit event to clients
            Sys.Io.of(Sys.Config.Namespace.Game2).to(gameData.parentGameId.toString()).emit('WithdrawBingoBall', historyObj);
            
            Sys.Io.of('admin').emit('balls', {
                id: gameData.parentGameId.toString(),
                balls: gameData.withdrawNumberArray,
                finish: false
            });
            // Check winning once more than 9 balls are withdrawn
            if (gameData.withdrawNumberArray.length >= 9) {
                const winnerArr = await module.exports.checkForWinners(gameId);
                if(winnerArr.length > 0){
                    return module.exports.gameFinished(gameId);
                }
            }
    
            // Set timer for next ball
            const withdrawTime = gameData.seconds;
            setGameTimer(timerKey, () => {
                try {
                    module.exports.gamePlay(gameId);
                } catch (error) {
                    console.log("Error in gamePlay timer callback:", error);
                    // Try to recover
                    cleanTimeAndData(timerKey, 'game2', gameId);
                }
            }, withdrawTime);
    
        } catch (error) {
            console.log("Error in gamePlay--", error);
            // Try to recover on error by moving to winner check stage      
            cleanTimeAndData(`${gameId}_timer`, 'game2', gameId);
        }
    },

    checkForWinners: async function (gameId) {
        try {
            // Clean up the timer
            cleanTimeAndData(`${gameId}_timer`);
    
            // Step 1: Get game data from Redis
            let gameData = await getGameDataFromRedisHmset('game2', gameId);
            if (!gameData) {
                return await createErrorResponse('Game not found in Redis!', "en", 400, false);
            }
    
            // Step 2: Get all tickets from DB
            // const tickets = await Sys.Game.Game2.Services.GameServices.getTicketByData(
            //     { gameId, isPurchased: true },
            //     { playerIdOfPurchaser: 1, ticketNumber: 1, tickets: 1, hallName: 1, hallId: 1, groupHallName: 1, groupHallId: 1 }
            // );
            console.time('get redis tickets');
            const tickets = await getGameTicketsFromRedis({ gameId, gameType: "game2" });
            console.timeEnd('get redis tickets');
    
            const CHUNK_SIZE = 50;
            const winnerArr = [];
            const playerIdsSet = new Set();
            const ticketUpdatePromises = [];
    
            // Step 3: Process tickets in chunks
            for (let i = 0; i < tickets.length; i += CHUNK_SIZE) {
                const chunk = tickets.slice(i, i + CHUNK_SIZE);
    
                ticketUpdatePromises.push(Promise.resolve().then(() => {
                    const chunkUpdates = [];
    
                    for (const ticket of chunk) {
                        const matched = ticket.tickets.filter(n => gameData.withdrawNumberArray.includes(n));
                        if (matched.length > 8) {
                            // Collect winner info
                            winnerArr.push({
                                gameId,
                                winnerPlayerId: ticket.playerIdOfPurchaser,
                                ticketId: ticket._id,
                                ticketNumber: ticket.ticketNumber,
                                purchasedSlug: "realMoney",
                                ticketCellArr: ticket.tickets,
                                hallName: ticket.hallName,
                                hallId: ticket.hallId,
                                groupHallName: ticket.groupHallName,
                                groupHallId: ticket.groupHallId,
                            });
    
                            // Prepare bulk update
                            chunkUpdates.push({
                                updateOne: {
                                    filter: { _id: ticket._id },
                                    update: { $set: { isPlayerWon: true } }
                                }
                            });
    
                            playerIdsSet.add(String(ticket.playerIdOfPurchaser));
                        }
                    }
    
                    return chunkUpdates;
                }));
            }
    
            // Wait for chunk processing
            const updateBatches = await Promise.all(ticketUpdatePromises);
            const allUpdates = updateBatches.flat();
            const playerIds = Array.from(playerIdsSet);
            if(winnerArr.length > 0){
                await saveGameDataToRedis('game2_winners', gameId, JSON.stringify(winnerArr), 3600);
            }
    
            // Immediately return after winner list is created
            setImmediate(async () => {
                try {
                    // Step 4: Perform bulk update
                    if (allUpdates.length > 0) {
                        await Sys.Game.Game2.Services.GameServices.bulkWriteTickets(allUpdates);
                    }
    
                    // Step 5: Fetch player socket IDs
                    const players = await Sys.Game.Game2.Services.PlayerServices.getByData(
                        { _id: { $in: playerIds } },
                        { _id: 1, socketId: 1 }
                    );
    
                    const playerSocketMap = new Map(players.map(p => [String(p._id), p.socketId]));
    
                    // Step 6: Emit TicketCompleted to winners
                    for (const winner of winnerArr) {
                        const socketId = playerSocketMap.get(String(winner.winnerPlayerId));
                        if (socketId) {
                            Sys.Io.of(Sys.Config.Namespace.Game2)
                                .to(socketId)
                                .emit('TicketCompleted', {
                                    ticketId: winner.ticketId,
                                    gameId: winner.gameId
                                });
                        }
                    }
                } catch (err) {
                    console.error("Background winner update error:", err);
                }
            });
    
            //returns immediately
            return winnerArr;
    
        } catch (error) {
            console.error("Error in checkForWinners", error);
            return await createErrorResponse('Unexpected error occurred.', "en", 500, false);
        }
    },

    gameFinished: async function (gameId) {
        try {
            cleanTimeAndData(`${gameId}_timer`);
            
            let gameData = await getGameDataFromRedisHmset('game2', gameId);
            if (!gameData) {
                // Get from MongoDB instead
                const room = await Sys.Game.Game2.Services.GameServices.getSingleSubgameData(
                    { _id: gameId }, 
                    { player: 1, status: 1, gameNumber: 1, startDate: 1, parentGameId: 1 }
                );
                
                if (!room) {
                    return await createErrorResponse("Game Not Found!", "en", 400, false);
                }
                
                // Use MongoDB data since Redis data is missing
                gameData = room;
            }
            
            // Check if game is already finished
            if (gameData.status === "finish") {
                return await createErrorResponse("game_finished", "en", 400);
            }
            
            // Get winning tickets from Redis
            const winnerArr = await getGameDataFromRedis('game2_winners', gameId);
            
            if(!winnerArr){
                return await createErrorResponse("No winner data found in Redis.", "en", 400);
            }

            // Update Game Status to Finished
            await Sys.Game.Game2.Services.GameServices.updateSingleGame({ _id: gameId }, {
                $set: { history: gameData.history, winners: winnerArr, updatedAt: new Date() } //status: 'finish'
            });
            
            const prizeData = {
                game: {jackPotNumber: gameData.jackPotNumber, ticketCount: gameData.totalTicketCount, ticketPrice: +parseFloat(gameData.ticketPrice).toFixed(2), players: gameData.players, luckyNumberPrize: +parseFloat(gameData.luckyNumberPrize).toFixed(2)},
                lastBall: gameData.withdrawNumberArray[gameData.withdrawNumberArray.length - 1],
                totalWithdrawCount: gameData.withdrawNumberArray.length,
                winnerArr: winnerArr
            }

            let [checkJackPotPrize, luckynumberPrize] = await Promise.all([
                checkJackPot(prizeData, gameData?.isWinningDistributed),
                checkLuckyNumber(prizeData, gameData?.isWinningDistributed)
            ]);

            await saveGameDataToRedisHmset('game2', gameId, {
                isWinningDistributed: true
            });

            const updatedWinnerArr = winnerArr.map(winner => {
                const prize = checkJackPotPrize.find(
                    p => String(p.ticketId) === String(winner.ticketId)
                );
            
                return {
                    ...winner,
                    finalWonAmount: prize ? prize.finalWonAmount : 0
                };
            });
           
            await saveGameDataToRedis('game2_winners', gameId, JSON.stringify(updatedWinnerArr), 3600);
            await Sys.Game.Game2.Services.GameServices.updateGame( { _id: gameId }, { $set: { 'otherData.isWinningDistributed': true, winners: updatedWinnerArr } });
    
            // Unique player Ids for broadcast
            const resArr = [...new Set(winnerArr.map(data => data.winnerPlayerId))];

            console.log("----------------------------------------------");
            console.log('\x1b[36m%s\x1b[0m', 'Winner List: ', resArr);
            console.log("----------------------------------------------");
            
            if(!gameData?.isWinningTicketStatsUpdated){
                // Fetch all player data in one go
                const allPlayersData = await Sys.Game.Game2.Services.PlayerServices.getByData(
                    { _id: { $in: gameData.allPlayerIds } },
                    { selectedLanguage: 1, enableNotification: 1 }
                );

                // Create a lookup map for fast access
                const playerDataMap = {};
                allPlayersData.forEach(player => {
                    playerDataMap[player._id.toString()] = player;
                });

                let playerPromises = gameData.players.map(async (player) => {
                    let amount = 0;
                    const isWinner = resArr.includes(player.id);

                    if (isWinner) {
                        checkJackPotPrize.forEach((prize) => {
                            if (prize.playerId === player.id) amount += prize.finalWonAmount;
                        });
                        luckynumberPrize.forEach((prize) => {
                            if (prize.playerId === player.id) amount += prize.finalWonAmount;
                        });
                    }

                    // Round KR currency to nearest whole number
                    const roundedAmount = Math.round(amount);

                    const playerUpdated = playerDataMap[player.id];
                    const language = playerUpdated?.selectedLanguage || "en";
                    const enableNotification = playerUpdated?.enableNotification;

                    const messageKey = isWinner ? "game2_winning_message" : "game2_loss_message";
                    const notificationKey = isWinner ? "game2_winning_noti" : "game2_loss_noti";

                    const message = await translate({
                        key: messageKey,
                        language: language,
                        ...(isWinner ? { isDynamic: true, number: roundedAmount } : {})
                    });

                    await Sys.Io.of(Sys.Config.Namespace.Game2).to(player.socketId).emit('GameFinish', {
                        message,
                        gameId: gameId,
                        winningAmount: Math.round((roundedAmount || 0) / ((winnerArr?.length || 1)))
                    });
                    
                    if(enableNotification){
                        createGameNotification({
                            playerId: player.id,
                            gameData: {
                                gameId,
                                gameNumber: gameData.gameNumber,
                                gameName: gameData.gameName,
                            },
                            type: "Game Finish",
                            key: notificationKey,
                            ...(isWinner ? { totalPayableAmount: roundedAmount } : {})
                        });
                    }
                });

                // Wait for all player promises
                await Promise.all(playerPromises);

                // Check if any ticket won and update
                const ticketStats = [...checkJackPotPrize.reduce((mp, o) => {
                    if (!mp.has(o.ticketId)) {
                        mp.set(o.ticketId, { ...o, finalWonAmount: 0 });
                    }
                    const existing = mp.get(o.ticketId);
                    existing.finalWonAmount += +o.finalWonAmount;
                    return mp;
                }, new Map()).values()];

                if (ticketStats.length > 0) {
                    const bulkOps = ticketStats.map(ticket => {
                        const roundedAmount = Math.round(Number(ticket.finalWonAmount) || 0);
                        const winningStats = {
                            finalWonAmount: roundedAmount,
                            lineTypeArray: [{
                                lineType: "Bingo",
                                wonAmount: roundedAmount,
                                ballNumber: prizeData.lastBall,
                                remarks: `Win JackPot Prize on this number ${prizeData.lastBall} in Ticket`
                            }],
                            walletType: "realMoney"
                        };
                
                        return {
                            updateOne: {
                                filter: {
                                    _id: ticket.ticketId,
                                    gameId: gameId,
                                    playerIdOfPurchaser: ticket.playerId
                                },
                                update: {
                                    $set: { winningStats },
                                    $inc: { totalWinningOfTicket: roundedAmount }
                                }
                            }
                        };
                    });
                
                    Sys.Game.Game2.Services.GameServices.bulkWriteTickets(bulkOps);
                }
                await saveGameDataToRedisHmset('game2', gameId, {
                    isWinningTicketStatsUpdated: true
                });
                await Sys.Game.Game2.Services.GameServices.updateGame( { _id: gameId }, { $set: { 'otherData.isWinningTicketStatsUpdated': true } });
            }
            
            
            // Lucky number winning stats
            if(!gameData?.isLuckyNumberUpdated){
                const ticketLuckyBonusStats = [...luckynumberPrize.reduce((mp, o) => {
                    if (!mp.has(o.ticketId)) {
                        mp.set(o.ticketId, { ...o, finalWonAmount: 0 });
                    }
                    const existing = mp.get(o.ticketId);
                    existing.finalWonAmount += +o.finalWonAmount;
                    return mp;
                }, new Map()).values()];
                
                if (ticketLuckyBonusStats.length > 0) {
                    const bulkOps = ticketLuckyBonusStats.map(ticket => {
                        const roundedAmount = Math.round(Number(ticket.finalWonAmount) || 0);
                        const luckyStats = {
                            wonAmount: roundedAmount,
                            walletType: "realMoney",
                            ballNumber: prizeData.lastBall,
                            remarks: `Win Lucky number Prize on this number ${prizeData.lastBall} in Ticket..!!`,
                            lineType: "Lucky Number Bonus"
                        };
                
                        return {
                            updateOne: {
                                filter: {
                                    _id: ticket.ticketId,
                                    gameId: gameId,
                                    playerIdOfPurchaser: ticket.playerId
                                },
                                update: {
                                    $set: { luckyNumberWinningStats: luckyStats },
                                    $inc: { totalWinningOfTicket: roundedAmount }
                                }
                            }
                        };
                    });
                
                    Sys.Game.Game2.Services.GameServices.bulkWriteTickets(bulkOps);
                }
                
                await saveGameDataToRedisHmset('game2', gameId, {
                    isLuckyNumberUpdated: true
                });
                await Sys.Game.Game2.Services.GameServices.updateGame( { _id: gameId }, { $set: { 'otherData.isLuckyNumberUpdated': true } });
            }
            

            setTimeout(async function () {
                //Re-Join Room So Data updated
                console.log("RefreshRoom called of completed game"); 
                await Sys.Game.Game2.Services.GameServices.updateSingleGame({ _id: gameId }, {
                    $set: { status: 'finish' }
                });
                Sys.Io.of(Sys.Config.Namespace.Game2).to(gameData.parentGameId.toString()).emit('RefreshRoom', {
                    gameId: gameData.parentGameId.toString()
                });

                // Remove Room From Global Array of Running
                let indexp = Sys.Running.indexOf(`${gameData.gameNumber}`);
                if (indexp > -1) {
                    Sys.Running.splice(indexp, 1);
                }

                const parentGame = await Sys.Game.Common.Services.GameServices.getSingleParentGameData({
                    _id: gameData.parentGameId,
                    stopGame: false
                });
                
                if (parentGame) {
                    const subGameCount = parentGame.subGames.length;
                
                    const startNextGame = async (query, projection = {_id: 1}, sendNotification = false) => {
                        const nextGame = await Sys.Game.Game2.Services.GameServices.getSingleGameByData(query, projection);
            
                        if (nextGame && nextGame.status === 'active') {
                            Sys.Game.Game2.Controllers.GameProcess.StartGameCheck(nextGame._id, subGameCount);
                    
                            // Bot game check
                            if (nextGame.otherData?.isBotGame) {
                                Sys.Game.Game2.Controllers.GameProcess.checkForBotGames(nextGame.parentGameId);
                            }
                        } else if (sendNotification) {
                            console.log("Next game not found or not active for notification.");
                        } else{
                            console.log("There is no active game 2 to start");
                        }
                    };
                    
                    if (subGameCount === 1) {
                        await startNextGame({
                            parentGameId: gameData.parentGameId,
                            status: 'active',
                            day: gameData.day
                        }, { status: 1, otherData: 1, parentGameId: 1 });
                    } else if (gameData.sequence < subGameCount) {
                        const [prefix, , part3, part4] = gameData.gameNumber.split('_');
                        const nextGameNumber = `CH_${gameData.sequence + 1}_${part3}_${part4}_G2`;
                    
                        await startNextGame({ gameNumber: nextGameNumber }, { status: 1, otherData: 1, parentGameId: 1 });
                    } else if (gameData.sequence === subGameCount) {
                        await startNextGame({
                            parentGameId: gameData.parentGameId,
                            status: 'active',
                            day: gameData.day,
                            isNotificationSent: false,
                            sequence: 1
                        }, { status: 1, otherData: 1, parentGameId: 1 });
                    }
                }else {
                    console.log('parentGame not found so not taking any action');
                }
                
                //Let the admin know
                Sys.Io.of('admin').emit('balls', {
                    id: gameData.parentGameId,
                    balls: [],
                    finish: true
                });

            }, 5000);

            if (!gameData.otherData?.isBotGame) {
                for (let p in gameData.players) {
                    await Sys.Game.Common.Controllers.PlayerController.checkBreakTimeOnGameFinished(gameData.players[p].id, "Game2");
                }
            }
            await syncGameToMongoDB(gameId, true, 'game2');
            return {
                status: 'success',
                message: 'Game tickets data found!'
            };
        } catch (error) {
            console.log("Error in gameFinished", error);
            // Attempt emergency sync to MongoDB
            // try {
            //     await syncGameToMongoDB(gameId, false);
            // } catch (syncError) {
            //     console.error("Error in emergency sync to MongoDB:", syncError);
            // }
            await syncGameToMongoDB(gameId, false, 'game2');
            cleanTimeAndData(`${gameId}_timer`, 'game2', gameId);
            return await createErrorResponse("something_went_wrong", "en", 500);
        }
    },

    StartGameCheck: async function (gameId, subGameNumbers) {
        try {
            // Get minimal required game data initially
            const game = await Sys.Game.Game2.Services.GameServices.getSingleGameByData(
                { _id: gameId, status: 'active', isNotificationSent: false },
                { totalNoPurchasedTickets: 1, minTicketCount: 1, day: 1, players: 1, gameNumber: 1, parentGameId: 1, sequence: 1, status: 1, notificationStartTime: 1, jackPotNumber: 1, ticketPrice: 1, otherData: 1 }
            );
            
            if (!game || game.totalNoPurchasedTickets < game.minTicketCount || game.day !== moment().format('ddd')) return;
            
            // Check if player is break time
            if (game?.otherData?.isBotGame === false){
                const playerChecks = game.players.map(player => {
                    const socketId = player.socketId.split('#')[1];
                    Sys.Game.Common.Controllers.PlayerController.CheckGame2PlayerBreakTime(socketId, {
                        playerId: player.id,
                        language: 'nor'
                    });
                });
                await Promise.all(playerChecks);
            }
            
            // Check if game can start
            const canStart = await checkIfGameCanStart(game);
            console.log("canStart--", canStart)
            if (!canStart) return;
    
            // Check if game is already running
            if (Sys.Running.includes(game.gameNumber) || game.status !== 'active') {
                console.log("Game already running or not active");
                return;
            }
    
            // Add game to running list
            Sys.Running.push(game.gameNumber);
    
            // Setup game start time and notifications
            const { newStartDate, secondsToAdd, TimeMessage } = await setupGameStartTime(game);
            
            // Update game and related data in parallel
            await Promise.all([
                Sys.Game.Common.Services.GameServices.updateGame(
                    { _id: gameId },
                    {
                        $set: {
                            startDate: new Date(newStartDate),
                            isNotificationSent: true,
                            rocketLaunch: true
                        }
                    }
                ),
                updateTicketsAndTransactions(game._id, newStartDate), // Update tickets and transactions
                sendNotificationsToPlayers(game, TimeMessage) // Send notifications to players
            ]);
    
            // Emit rocket launch event
            Sys.Io.of(Sys.Config.Namespace.Game2).to(game._id.toString()).emit('Game2RocketLaunch', {
                gameId: game._id.toString()
            });
    
            const timerKey = `${game._id}_game_start`;
            let time = secondsToAdd;
            let isDisableTicket = false;

            const createJackpotEvent = (tickets) => ({
                gameId: game.parentGameId.toString(),
                subGameId: game._id.toString(),
                jackpotData: game.jackPotNumber,
                tickets: tickets ?? game.totalNoPurchasedTickets, // use provided value or fallback
                ticketPrice: game.ticketPrice
            });
           
            const timerTick = async () => {
                try {
                    time--;
            
                    // When timer reaches negative -> start the game
                    if (time < 0) {
                        const updatedGame = await Sys.Game.Game2.Services.GameServices.updateSingleGame(
                            { _id: game._id, status: "active" },
                            { $set: { status: 'running', disableTicketPurchase: true } },
                            { new: true }
                        );
            
                        if (!updatedGame) return cleanTimeAndData(timerKey);
            
                        cleanTimeAndData(timerKey);
            
                        if (time < 6) {
                            const latestGame = await Sys.Game.Game2.Services.GameServices.getSingleGameByData(
                                { _id: gameId },
                                { totalNoPurchasedTickets: 1 }
                            );
                            Sys.Game.Game2.Controllers.GameController.game2JackpotUpdate(createJackpotEvent(latestGame?.totalNoPurchasedTickets));
                        }
            
                        if (!Sys.StartedGame.includes(updatedGame._id.toString())) {
                            Sys.StartedGame.push(updatedGame._id.toString());
                        }
            
                        await Sys.Game.Game2.Controllers.GameProcess.StartGame({
                            _id: updatedGame._id,
                            sequence: updatedGame.sequence,
                            parentGameId: updatedGame.parentGameId,
                            day: updatedGame.day
                        });
            
                        if (updatedGame.sequence === subGameNumbers) {
                            await Sys.Game.Common.Controllers.GameController.createChildGame(
                                updatedGame.parentGameId,
                                updatedGame.day
                            );
                        }
            
                        return;
                    }
            
                    // Jackpot update at 6 seconds
                    if (time === 6) {
                        const latestGame = await Sys.Game.Game2.Services.GameServices.getSingleGameByData(
                            { _id: gameId },
                            { totalNoPurchasedTickets: 1 }
                        );
                        Sys.Game.Game2.Controllers.GameController.game2JackpotUpdate(createJackpotEvent(latestGame?.totalNoPurchasedTickets));
                    }
            
                    // Disable ticket purchase at 5 seconds or below
                    if (time <= 5 && !isDisableTicket) {
                        console.log("Player cannot purchase ticket now.");
                        Sys.StartedGame.push(game._id.toString());
                        await Sys.Game.Common.Services.GameServices.updateGame(
                            { _id: game._id },
                            { $set: { disableTicketPurchase: true } }
                        );
                        isDisableTicket = true;
                    }
            
                    // Emit timer update
                    Sys.Io.of(Sys.Config.Namespace.Game2)
                        .to(game.parentGameId.toString())
                        .emit('StartTimer', {
                            remainingTime: time,
                            totalSeconds: secondsToAdd
                        });
            
                    setGameTimer(timerKey, timerTick, 1000);
                } catch (error) {
                    console.error("Error in game timer:", error);
                    cleanTimeAndData(timerKey);
            
                    const index = Sys.Running.indexOf(game.gameNumber);
                    if (index > -1) Sys.Running.splice(index, 1);
                }
            };
            
            setGameTimer(timerKey, timerTick, 1000);
        } catch (error) {
            console.error("Error in StartGameCheck:", error);
            cleanTimeAndData(`${gameId}_game_start`);
            return;
        }
    },

    checkForBotGames: async function(parentGameId) {
        try {
            console.log("checkForBotGames called", parentGameId);
            
            // Handle single parent game or all bot games
            const projection = { otherData: 1, subGames: 1 };
        
            if (parentGameId) {
                const parentGames = await Sys.Game.Game2.Services.GameServices.getByDataParent(
                    { 
                        _id: parentGameId, 
                        'otherData.isBotGame': true 
                    }, 
                    projection
                );
                if(parentGames.length > 0){
                    module.exports.insertBotsInGame(parentGameId); 
                    return;                
                }
            }else{
                //check if any running games are there for today, if yes then complete, it should be called if parentGameId is not provided  
                module.exports.handleServerRestart();
            }

            // If no parentGameId provided, get all eligible bot games
            const parentGames = await Sys.Game.Game2.Services.GameServices.getByDataParent(
                {
                    gameType: "game_2",
                    status: "running",
                    'otherData.isBotGame': true,
                    $expr: { $lte: ["$otherData.totalBotGamePlayed", "$otherData.botGameCount"] }
                }, 
                projection
            );

            if (!parentGames?.length) {
                console.log("No eligible bot games found");
                return;
            }
    
             // Process all eligible bot games
            await Promise.all(parentGames.map(async (parentGame) => {
                try {
                    // Clean up existing bot games and transactions
                    await cleanupExistingBotGames(parentGame._id);

                    // Get the active game for this parent
                    const game = await Sys.Game.Game2.Services.GameServices.getSingleGameByData(
                        { parentGameId: parentGame._id, status: 'active' },
                        {
                            earnedFromTickets: 1,
                            otherData: 1,
                            ticketPrice: 1,
                            parentGameId: 1,
                            players: 1,
                            groupHalls: 1,
                            minTicketCount: 1
                        }
                    );
                    
                    if (!game) return;
                    
                    // Insert bot players or check for start game in this active game
                    if (!game.otherData.botTicketPurcasheStarted) {
                        await module.exports.insertBotsInGame(parentGame);
                        return;
                    }
                
                    if (game.otherData.botTicketPurcasheStarted && game.otherData.botTicketPurcashed) {
                        await module.exports.StartGameCheck(game._id, parentGame.subGames.length);
                        return;
                    }
                
                    if(game.otherData.botTicketPurcasheStarted && !game.otherData.botTicketPurcashed){
                        if (game.minTicketCount <= game.otherData.ticketPurchasedByBotCount) {
                            await Promise.all([
                                Sys.Game.Game2.Services.GameServices.updateGame(
                                    { _id: game._id },
                                    { $set: { 'otherData.botTicketPurcashed': true } }
                                ),
                                module.exports.StartGameCheck(game._id, parentGame.subGames.length)
                            ]);
                            return;
                        }

                        // Process bot ticket purchase
                        const remainingTickets = game.minTicketCount - game.otherData.ticketPurchasedByBotCount;
                        const botCount = Math.ceil(remainingTickets / game.otherData.botTicketCount);

                        // Get player and hall IDs in parallel
                        const [playerIds, hallIDs] = await Promise.all([
                            game.players.map(p => p.id),
                            game.groupHalls.flatMap(gh => gh.halls.map(h => h.id))
                        ]);

                        // Get eligible bot players
                        const players = await Sys.Game.Game2.Services.PlayerServices.getByData(
                            {
                                userType: "Bot",
                                _id: { $nin: playerIds },
                                'hall.id': { $in: hallIDs },
                                walletAmount: { $gte: 1000 }
                            },
                            { username: 1, socketId: 1 },
                            { limit: botCount }
                        );

                        if (players.length) {
                            // Process bot ticket purchases in parallel batches
                            const BATCH_SIZE = 10;
                            for (let i = 0; i < players.length && stopBotInsertion !== parentGameId; i += BATCH_SIZE) {
                                const batch = players.slice(i, Math.min(i + BATCH_SIZE, players.length));
                                await Promise.all(batch.map(player => 
                                    processBotPlayerTicket(player, game, game.otherData.botTicketCount)
                                ));
                            }

                            // Update game status if minimum tickets reached
                            const updatedGame = await Sys.Game.Game2.Services.GameServices.updateGame(
                                { 
                                    _id: game._id,
                                    $expr: { $gte: ["$otherData.ticketPurchasedByBotCount", "$minTicketCount"] }
                                },
                                { $set: { 'otherData.botTicketPurcashed': true } }
                            );

                            if (updatedGame?.modifiedCount > 0) {
                                await Sys.Game.Game2.Services.GameServices.updateParentGame(
                                    { _id: game.parentGameId },
                                    { $inc: { 'otherData.totalBotGamePlayed': 1 } }
                                );
                            }
                        }
                    }
                } catch (err) {
                    console.error(`Error processing parent game ${parentGame._id}:`, err);
                }
            }));
    
        } catch(e) {
            console.log("Error in check for bot games", e);
            throw e;
        }
    },

    insertBotsInGame: async function(parentGameId) {
        try {
            console.log("insertBotsInGame called", parentGameId)
            // Get initial game and parent data in parallel
            const [game, parentGame] = await Promise.all([
                Sys.Game.Game2.Services.GameServices.getSingleGameByData(
                    { 
                        parentGameId, 
                        status: 'active', 
                        isNotificationSent: false 
                    },
                    {
                        otherData: 1,
                        parentGameId: 1,
                        groupHalls: 1,
                        minTicketCount: 1
                    }
                ),
                Sys.Game.Game2.Services.GameServices.getSingleParentGame(
                    { _id: parentGameId },
                    { otherData: 1 }
                )
            ]);
            
            if (!game?.otherData || !parentGame?.otherData) {
                console.log("game or parent game not found")
                return { status: "fail", message: "Game or parent game not found" };
            }
    
            // Early validation checks
            if (!await validateBotGame(game, parentGame)) {
                console.log("validation failed for bot game")
                return { status: "fail", message: "Validation failed for bot game" };
            }
    
            // Get hall IDs
            const hallIDs = game.groupHalls.flatMap(gh => 
                gh.halls.map(h => h.id)
            );
    
            // Calculate bot ticket count
            const botTicketCount = await calculateBotTicketCount(game, hallIDs);
            if (typeof botTicketCount === 'object') { // Error response
                return botTicketCount;
            }
    
            // Update game with bot ticket settings
            const isUpdated = await Sys.Game.Game2.Services.GameServices.updateGame(
                { 
                    _id: game._id,
                    "otherData.botTicketPurcasheStarted": false 
                },
                {
                    $set: {
                        'otherData.botTicketPurcasheStarted': true,
                        'otherData.botTicketCount': botTicketCount
                    }
                },
                { new: true }
            );
            if(isUpdated && isUpdated.modifiedCount == 0){
                console.log("ticket insertion already started so don't call it again.")
                return {
                    status: 'fail',
                    message: "Ticket insertion already stayred so don't call it again.",
                }
            }
            
            // Process bot tickets
            //await processBotTickets(game, hallIDs, botTicketCount, parentGameId);

            if (game.minTicketCount <= game.otherData.ticketPurchasedByBotCount) return;

            const botCount = Math.ceil(game.minTicketCount / botTicketCount);
    
            // Get bot players and update wallets in parallel if needed
            let players = await Sys.Game.Game2.Services.PlayerServices.getByData(
                {
                    userType: "Bot",
                    'hall.id': { $in: hallIDs },
                    walletAmount: { $gte: 1000 }
                },
                { username: 1, socketId: 1 },
                { limit: botCount }
            );
           
            if (players.length < botCount) {
                await Sys.Game.Game2.Services.PlayerServices.updateManyData(
                    { userType: "Bot", 'hall.id': { $in: hallIDs } },
                    { walletAmount: 100000000 }
                );
                players = await Sys.Game.Game2.Services.PlayerServices.getByData(
                    { userType: "Bot", 'hall.id': { $in: hallIDs }, walletAmount: { $gte: 1000 } },
                    { username: 1, socketId: 1 },
                    { limit: botCount }
                );
            }

            // Process bot tickets in batches
            const BATCH_SIZE = 10;
            for (let i = 0; i < players.length && stopBotInsertion !== parentGameId; i += BATCH_SIZE) {
                const batch = players.slice(i, Math.min(i + BATCH_SIZE, players.length));
                await Promise.all(batch.map(player => 
                    processBotPlayerTicket(player, game, botTicketCount)
                ));
            }

            // Update game status if needed
            const updatedGame = await Sys.Game.Game2.Services.GameServices.updateGame(
                { 
                    _id: game._id,
                    $expr: { $gte: ["$otherData.ticketPurchasedByBotCount", "$minTicketCount"] }
                },
                { $set: { 'otherData.botTicketPurcashed': true } }
            );

            if (updatedGame?.modifiedCount > 0) {
                await Sys.Game.Game2.Services.GameServices.updateParentGame(
                    { _id: game.parentGameId },
                    { $inc: { 'otherData.totalBotGamePlayed': 1 } }
                );
            }
    
            return { status: "success" };
    
        } catch(e) {
            console.error("Error in inserting bots in game:", e);
            throw e;
        }
    },

    handleServerRestart: async function() {
        try {
            console.log("Handling server restart - checking for running games...");
            
            // Get today's day in required format
            const startOfDay = moment().startOf('day').toDate();
            const endOfDay = moment().endOf('day').toDate();
            const today = moment().format('ddd');
            
            // Fetch all running games from today
            const runningGames = await Sys.Game.Game2.Services.GameServices.getByData(
                {
                    gameType: 'game_2',
                    status: { $in: ['running', 'active'] },
                    startDate: { $gte: startOfDay, $lte: endOfDay },
                    day: today,
                    'otherData.isBotGame': false,
                    isNotificationSent: true
                },
                {
                    _id: 1,
                    status: 1,
                    gameNumber: 1,
                    withdrawNumberList: 1,
                    parentGameId: 1,
                    sequence: 1,
                    day: 1,
                    startDate: 1,
                    otherData: 1,
                    isNotificationSent: 1
                }
            );
    
            if (!runningGames?.length) {
                console.log("No running games found for today");
                return;
            }
            // Process each game
            await Promise.all(runningGames.map(async (game) => {
                try {
                    if ( game.status === 'running' ) {
                        // Resume game from where it left off
                        if (game.withdrawNumberList.length <= 21) {
                            console.log(`Resuming game ${game.gameNumber} from current state`);
                            await cleanTimeAndData(`${game._id}_timer`, 'game2', game._id);
                            await loadTicketsToRedis(game._id, { playerIdOfPurchaser: 1, ticketId: 1, tickets: 1, hallName: 1, hallId: 1, groupHallName: 1, groupHallId: 1 }, "game2");
                            module.exports.gamePlay(game._id, true);
                        } 
                    } 
                    // If game was active and notification was sent
                    else if (game.status === 'active' && game.isNotificationSent) {
                        // Start Game
                        module.exports.StartGame({_id: game._id, sequence: game.sequence, parentGameId: game.parentGameId, day: game.day});
                        
                        // Create upcoming games if it is the last game
                        const parentGame = await Sys.Game.Game2.Services.GameServices.getSingleParentGame({
                            _id: game.parentGameId,
                            stopGame: false
                        }, {subGames: 1});
                    
                        if (parentGame?.subGames?.length > 0 && game.sequence === parentGame.subGames.length) {
                            await Sys.Game.Common.Controllers.GameController.createChildGame(
                                game.parentGameId,
                                game.day
                            );
                        }
                        // Refund the game
                        //await Sys.Game.Game2.Controllers.GameController.processRefundAndFinishGame(game._id, null);
                    }
                } catch (error) {
                    console.error(`Error processing game ${game.gameNumber}:`, error);
                }
            }));
        } catch (error) {
            console.error("Error in handleServerRestart:", error);
        }
    },
    
}
