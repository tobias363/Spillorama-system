const Sys = require('../../../Boot/Sys');
const moment = require('moment');
const { getAvailableBalls, getRandomBall, setGameTimer, cleanTimeAndData, saveGameDataToRedisHmset, getGameDataFromRedisHmset, loadTicketsToRedis, getGameTicketsFromRedis, createErrorResponse, setupGameStartTime, updateTicketsAndTransactions, sendNotificationsToPlayers } = require('../../../gamehelper/all');
const { createGameData, evaluatePatternsAndUpdateGameData, getPatternToCheckWinner, processPatternWinners, processTicketStats, processLuckyNumberStats, updateWinnerProfitAmount, updatePlayerStatistics, removeRoomFromRunning, handleNextGame, checkPreviousGameStatus, handleBotGame, handleNormalGame } = require('../../../gamehelper/game3');

module.exports = {

    StartGame: async function(room){
        try{
            const updatedGame = await Sys.Game.Game3.Services.GameServices.updateSingleGame(
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

            await Sys.Io.of(Sys.Config.Namespace.Game3).to(updatedGame.parentGameId.toString()).emit('GameStart', {});

            await loadTicketsToRedis(room._id, { winningCombinations: 1, gameId: 1, ticketId: 1, tickets: 1,  playerIdOfPurchaser: 1, hallName: 1, hallId: 1, groupHallName: 1, groupHallId: 1 }, "game3");

            // Initialize game data for Redis
            const gameData = createGameData(updatedGame, {
                availableBalls: [],
                withdrawNumberArray: [],
                patternWinnerHistory: []
            });
            // Store in Redis with TTL of 1 hour
            await saveGameDataToRedisHmset('game3', room._id, gameData, { setTTL: true, ttl: 3600 });

            const playerIds = gameData.allPlayerIds;
            if (playerIds.length) {
                playerIds.forEach(id => {
                    Sys.Game.Common.Controllers.PlayerController.checkBreakTime(id);
                });

                Sys.Game.Game3.Services.PlayerServices.updateManyPlayerData(
                    { _id: { $in: playerIds } },
                    { $inc: { 'statisticsgame3.totalGames': 1 } }
                );
            }

            // Start gameplay process
            module.exports.gamePlay(room._id);
        }catch(error){
            console.log("Error in startGame", error);
        }
    },

    gamePlay: async function (gameId) {
        const timerKey = `${gameId}_timer`;
    
        try {
            let gameData = await getGameDataFromRedisHmset('game3', gameId);
           
            if (!gameData) {
                const room = await Sys.Game.Game3.Services.GameServices.getSingleGameData(
                    { _id: gameId },
                    {
                        _id: 1, players: 1, gameNumber: 1, parentGameId: 1, day: 1,
                        seconds: 1, withdrawNumberList: 1, history: 1,
                        status: 1, startDate: 1, otherData: 1, totalNoPurchasedTickets: 1,
                        luckyNumberPrize: 1, ticketPrice: 1, gameName: 1,
                        allPatternArray: 1, winningType: 1, patternWinnerHistory: 1, sequence: 1
                    }
                );
    
                if (!room) {
                    console.error("Game not found for gamePlay", gameId);
                    return;
                }
    
                const withdrawNumberArray = room.withdrawNumberList?.map(h => h.number) || [];
                gameData = createGameData(room, {
                    availableBalls: getAvailableBalls(withdrawNumberArray, 75),
                    withdrawNumberArray: withdrawNumberArray,
                    patternWinnerHistory: room.patternWinnerHistory
                });
    
                await saveGameDataToRedisHmset('game3', gameId, gameData, { setTTL: true, ttl: 3600 });

            } else if (!gameData.availableBalls?.length) {
                gameData.availableBalls = getAvailableBalls(gameData.withdrawNumberArray, 75);
                await saveGameDataToRedisHmset('game3', gameId, { availableBalls: gameData.availableBalls });
            }
    
            if (gameData.withdrawNumberArray.length >= 75 || gameData.availableBalls.length === 0) {
                return module.exports.gameFinished(gameId);
            }
    
            const withdrawBall = getRandomBall(gameData.availableBalls);
            const withdrawColor = "yellow";
    
            const historyObj = {
                number: withdrawBall,
                color: withdrawColor,
                totalWithdrawCount: gameData.withdrawNumberArray.length + 1
            };
    
            gameData.withdrawNumberArray.push(withdrawBall);
            gameData.withdrawNumberList.push(historyObj);
            gameData.availableBalls = gameData.availableBalls.filter(n => n !== withdrawBall);
            
            // Save to Redis and Emit events concurrently
            await Promise.all([
                saveGameDataToRedisHmset('game3', gameId, {
                    withdrawNumberArray: gameData.withdrawNumberArray,
                    withdrawNumberList: gameData.withdrawNumberList,
                    history: gameData.history,
                    availableBalls: gameData.availableBalls,
                }),
                (async () => {
                    Sys.Io.of(Sys.Config.Namespace.Game3).to(gameData.parentGameId.toString()).emit('WithdrawBingoBall', historyObj);
                    Sys.Io.of('admin').emit('balls', {
                        id: gameData.parentGameId.toString(),
                        balls: gameData.withdrawNumberArray,
                        finish: false
                    });
                })()
            ]);
    
            const { currentPatternList, patternAvailable, jackpotRemoved, currentLength } =
                await evaluatePatternsAndUpdateGameData(gameData);
    
            Object.assign(gameData, {
                currentPatternList,
                patternAvailable,
                jackpotRemoved,
                currentLength,
                lastBallDrawnTime: Date.now()  // update time when ball is drawn
            });
    
            // Save updated pattern list and update DB in parallel
            await Promise.all([
                saveGameDataToRedisHmset('game3', gameId, {
                    currentPatternList,
                    patternAvailable,
                    jackpotRemoved,
                    currentLength,
                    lastBallDrawnTime: gameData.lastBallDrawnTime
                }),
                Sys.Game.Game3.Services.GameServices.updateGame(
                    { _id: gameId },
                    {
                        $set: {
                            withdrawNumberList: gameData.withdrawNumberList,
                            currentPatternList
                        }
                    }
                )
            ]);
    
            const withdrawTime = gameData.seconds;
    
            // If enough balls drawn, check for winners
            if (gameData.withdrawNumberArray.length >= 4) {
                const winnerArr = await module.exports.checkForWinners(gameId);

                const winnerTime = Math.max((winnerArr.winnerArr.length ? (winnerArr.secondsToWait || withdrawTime) : withdrawTime) - 
                            (winnerArr.winnerArr.length ? 0 : (Date.now() - gameData.lastBallDrawnTime)), 1000);
                console.log("winnerTime 1", winnerTime)
                if (
                    gameData.withdrawNumberArray.length >= 75 ||
                    gameData.currentLength === 0 ||
                    winnerArr.isCompleted === true
                ) {
                    console.log("Game is finished");
                    return module.exports.gameFinished(gameId);
                }
    
                setGameTimer(timerKey, () => {
                    try {
                        module.exports.gamePlay(gameId);
                    } catch (err) {
                        console.error("Error in gamePlay timer callback:", err);
                        cleanTimeAndData(timerKey, 'game3', gameId);
                    }
                }, winnerTime);
    
            } else {
                const winnerTime = Math.max(withdrawTime - (Date.now() - gameData.lastBallDrawnTime), 1000);
                console.log("winnerTime 2", winnerTime)
                // If not enough balls yet, continue as usual
                setGameTimer(timerKey, () => {
                    try {
                        module.exports.gamePlay(gameId);
                    } catch (err) {
                        console.error("Error in gamePlay timer callback:", err);
                        cleanTimeAndData(timerKey, 'game3', gameId);
                    }
                }, winnerTime);
            }
    
        } catch (error) {
            console.error("Error in gamePlay--", error);
            cleanTimeAndData(timerKey, 'game3', gameId);
        }
    },

    checkForWinners: async function (gameId) {
        try {
            const gameData = await getGameDataFromRedisHmset('game3', gameId);
            if (!gameData) return createErrorResponse('Game not found in Redis!', "en", 400, false);
    
            const { withdrawNumberArray, currentPatternList, seconds, gameName, gameNumber, allPatternArray, patternWinnerHistory = [], otherData } = gameData;
            const lastBall = withdrawNumberArray.at(-1);
            const patternMap = getPatternToCheckWinner(currentPatternList);
    
            if (!Object.keys(patternMap).length) return { winnerArr: [], isCompleted: true, secondsToWait: seconds };
    
            const ticketData = await getGameTicketsFromRedis({ gameId, gameType: "game3" });
            if (!ticketData.length) return { winnerArr: [], isCompleted: false, secondsToWait: seconds };
    
            const playerIds = new Set();
            const winningPatternsSet = new Set();
            const winnersToBroadcast = [];
            const patternWinnersMap = new Map(); // to add array of ticketIds for each pattern
    
            for (const ticket of ticketData) {
                for (const [patternName, pattern] of Object.entries(patternMap)) {
                    const combinations = ticket.winningCombinations?.[patternName];
                    if (!combinations) continue;
    
                    if (combinations.some(comb => comb.every(ball => withdrawNumberArray.includes(ball)))) {
                        playerIds.add(ticket.playerIdOfPurchaser);
                        winningPatternsSet.add(pattern.patternName);
    
                        // Create the winner object
                        const winnerObjectPattern = {
                            gameId: ticket.gameId,
                            gameName,
                            gameNumber,
                            winnerPlayerId: ticket.playerIdOfPurchaser,
                            ticketId: ticket._id,
                            patternId: pattern._id,
                            patternName: pattern.patternName,
                            patternPrize: Math.round(Number(pattern.amount)),
                            ballNumber: pattern.ballNumber,
                            ticketNumber: ticket.ticketNumber,
                            purchasedSlug: "realMoney",
                            ticketCellArr: ticket.tickets,
                            count: withdrawNumberArray.length,
                            lastBall,
                            isFullHouse: !pattern.patternDataList.includes(0),
                            hallName: ticket.hallName,
                            hallId: ticket.hallId,
                            groupHallName: ticket.groupHallName,
                            groupHallId: ticket.groupHallId,
                            samePatterWinIds: []
                        };
    
                        winnersToBroadcast.push(winnerObjectPattern);
    
                        // Update the patternWinnersMap with ticketId for each pattern
                        const patternId = winnerObjectPattern.patternId.toString();
                        if (!patternWinnersMap.has(patternId)) {
                            patternWinnersMap.set(patternId, []);
                        }
                        patternWinnersMap.get(patternId).push(winnerObjectPattern.ticketId);
                        
                    }
                }
            }
    
            if (!winnersToBroadcast.length) return { winnerArr: [], isCompleted: false, secondsToWait: seconds };
    
            const winnerPlayers = await Sys.Game.Game3.Services.PlayerServices.getByData({ _id: { $in: [...playerIds] } }, { socketId: 1 });
            const socketMap = new Map(winnerPlayers.map(p => [p._id.toString(), p.socketId]));
    
            const broadcastPromises = winnersToBroadcast.map(winner => {
                winner.samePatterWinIds = patternWinnersMap.get(winner.patternId.toString()) || [];
                const socketId = socketMap.get(winner.winnerPlayerId.toString());
                if (!socketId) return null;
                const fullSocketId = `/${Sys.Config.Namespace.Game3}#${socketId}`;
                winner.socketId = fullSocketId;
                // const event = winner.isFullHouse ? 'TicketCompleted' : 'PatternWin';
                // return Sys.Io.of(Sys.Config.Namespace.Game3).to(fullSocketId).emit(event, {
                //     ticketId: winner.ticketId,
                //     gameId: winner.gameId
                // });
            }).filter(Boolean);
    
            // Update pattern win status and save data in parallel
            await Promise.all([
                Promise.all(broadcastPromises),
                
                // Update Redis and MongoDB in parallel after updating pattern status
                (async () => {
                    allPatternArray.forEach(p => {
                        if (winningPatternsSet.has(p.patternName)) p.isPatternWin = "true";
                    });
                    
                    return Promise.all([
                        saveGameDataToRedisHmset('game3', gameId, {
                            allPatternArray,
                            patternWinnerArray: winnersToBroadcast
                        }),
                        Sys.Game.Game3.Services.GameServices.updateSingleGame(
                            { _id: gameId }, 
                            { $set: { allPatternArray } }
                        )
                    ]);
                })()
            ]);
    
            // Pattern wise winning and notifications to each player
            const {
                patternWinnersArray,
                patternLuckyWinnersArray,
                winnerArrFullHouse,
                isFullHouse
            } = await processPatternWinners(winnersToBroadcast, gameData);
    
            if (isFullHouse) {
                await Promise.all([
                    saveGameDataToRedisHmset('game3', gameId, { status: 'finish' }),
                    Sys.Game.Game3.Services.GameServices.updateSingleGame({ _id: gameId }, {
                        $set: {
                            //status: 'finish',
                            history: gameData.withdrawNumberList,
                            winners: winnerArrFullHouse,
                            updatedAt: new Date()
                        }
                    })
                ]);
            }
    
            const reduceMap = (arr, key, sumKey) => [...arr.reduce((m, o) => {
                if (!m.has(o[key])) m.set(o[key], { ...o, finalWonAmount: 0 });
                m.get(o[key]).finalWonAmount = +parseFloat(m.get(o[key]).finalWonAmount + o[sumKey]).toFixed(4);
                return m;
            }, new Map).values()];
    
            await Promise.all([
                processTicketStats(reduceMap(patternWinnersArray, "ticketId", "patternWonAmount"), gameData._id),
                processLuckyNumberStats(reduceMap(patternLuckyWinnersArray, "ticketId", "finalWonAmount"), gameData._id),
            ]);
    
            gameData.patternWinnerHistory = patternWinnerHistory.concat(winnersToBroadcast);
            await Promise.all([
                saveGameDataToRedisHmset('game3', gameId, { patternWinnerHistory: gameData.patternWinnerHistory }),
                Sys.Game.Game3.Services.GameServices.updateSingleGame({ _id: gameId }, {
                    $set: { patternWinnerHistory: gameData.patternWinnerHistory }
                }),
                updateWinnerProfitAmount(winnersToBroadcast, gameData.patternWinnerHistory) 
            ]);
    
            const delay = (!isFullHouse && !otherData?.isBotGame && winnersToBroadcast.length) ? 5000 : seconds;
            const pendingPatternCount = allPatternArray.filter(p => p.isPatternWin !== "true").length;
            return {
                winnerArr: winnersToBroadcast,
                isCompleted: pendingPatternCount === 0 || isFullHouse,
                secondsToWait: delay
            };
        } catch (error) {
            console.error("Error in checkForWinners", error);
            return createErrorResponse('Unexpected error occurred.', "en", 500, false);
        }
    },

    gameFinished: async function (gameId) {
        try {
            const timerKey = `${gameId}_timer`;
            
            // Get game data after status update
            const gameData = await getGameDataFromRedisHmset('game3', gameId);
            if (!gameData) return;
            
            // Process game completion tasks in parallel
            const parentGameId = gameData.parentGameId.toString();
            
            // Run these operations in parallel
            await Promise.all([
                updatePlayerStatistics(gameData),
                // Process player break times in parallel
                Promise.all(
                    Object.values(gameData.players || {}).map(player => 
                        Sys.Game.Common.Controllers.PlayerController.checkBreakTimeOnGameFinished(player.id, "Game3")
                    )
                )
            ]);
            // Schedule room refresh after other operations
            setTimeout(async () => {
                // Update game status in Redis and DB concurrently
                await Promise.all([
                    saveGameDataToRedisHmset('game3', gameId, { status: 'finish' }),
                    Sys.Game.Game3.Services.GameServices.updateSingleGame(
                        { _id: gameId, status: { $ne: 'finish' } }, 
                        { $set: { status: 'finish' } }
                    )
                ]);
                // Execute non-dependent operations concurrently
                removeRoomFromRunning(gameData);
                cleanTimeAndData(timerKey, 'game3', gameId);
                
                Sys.Io.of(Sys.Config.Namespace.Game3).to(parentGameId).emit('RefreshRoom', {
                    gameId: parentGameId
                });
                handleNextGame(gameData)
            }, 5000);
            
        } catch (error) {
            console.error("Error in gameFinished", error);
        }
    },

    StartGameCheck: async function (gameId, subGameNumbers) {
        try {
            console.log("StartGameCheck called", gameId, subGameNumbers)
            const game = await Sys.Game.Game3.Services.GameServices.getSingleGameData(
                { _id: gameId, status: 'active', isNotificationSent: false },
                { totalNoPurchasedTickets: 1, minTicketCount: 1, day: 1, players: 1, gameNumber: 1, parentGameId: 1, sequence: 1, status: 1, notificationStartTime: 1, 'otherData.isBotGame': 1, allPatternArray: 1, ticketPrice: 1, winningType: 1 }
            );
    
            if (!game) {
                console.log("Game Not Available or Already Started");
                return;
            }
    
            if (game.totalNoPurchasedTickets < game.minTicketCount || game.day !== moment().format('ddd')) {
                console.log("Insufficient tickets or invalid day");
                return;
            }
    
            // Process player break times in parallel
            if (game.players.length) {
                await Promise.all(
                    game.players.map(player => {
                        const socketId = player.socketId.split('#')[1];
                        return Sys.Game.Common.Controllers.PlayerController.CheckGame3PlayerBreakTime(socketId, {
                            playerId: player.id,
                            language: 'nor'
                        });
                    })
                );
                // Get updated totalNoPurchasedTickets after removing the players who are on break
                let updatedGame = await Sys.Game.Game3.Services.GameServices.getSingleGameData({ _id: gameId},{ totalNoPurchasedTickets: 1 });
                const totalNoPurchasedTickets = updatedGame.totalNoPurchasedTickets;
                console.log("totalNoPurchasedTickets in StartGameCheck", totalNoPurchasedTickets, game.minTicketCount)
                if(totalNoPurchasedTickets < game.minTicketCount){
                    console.log("Insufficient tickets");
                    return;
                }
            }
    
            const [, gameNumber] = game.gameNumber.split('_');
            const parsedGameNumber = parseInt(gameNumber);
            console.log("parsedGameNumber", parsedGameNumber)
            const gameStart = await checkPreviousGameStatus(game, parsedGameNumber);
            if (!gameStart) {
                console.log("Previous game still running");
                return;
            }
    
            if (Sys.Running.includes(game.gameNumber) || game.status !== 'active') {
                console.log("Game already running");
                return;
            }
    
            Sys.Running.push(game.gameNumber);
    
            // Setup game start time and notifications
            const { newStartDate, secondsToAdd, TimeMessage } = await setupGameStartTime(game);
                
            // Update game and related data in parallel
            await Sys.Game.Common.Services.GameServices.updateGame(
                { _id: gameId },
                {
                    $set: {
                        startDate: new Date(newStartDate),
                        isNotificationSent: true,
                    }
                }
            ),
            updateTicketsAndTransactions(game._id, newStartDate);
             
            // Only push this if it's not a bot game
            if (!game.otherData?.isBotGame) {
                sendNotificationsToPlayers(game, TimeMessage);
            }
              
            if (game?.otherData?.isBotGame) {
                console.log("handleBotGame called")
                await handleBotGame(game, subGameNumbers);
            } else {
                console.log("handleNormalGame called")
                await handleNormalGame(game, secondsToAdd, subGameNumbers, setGameTimer, cleanTimeAndData);
            }
    
            return true;
    
        } catch (error) {
            console.error('Error in startGameCheck:', error);
            return false;
        }
    },

    // This function will be used to purchase bot game 3 tickets
    populateGame3WithBots: async function (childGame) {
        try {
            console.log("Populating Game 3 with Bots:", childGame);
    
            const { gameId, minTicketCount, ticketPrice, allHallsId } = childGame;
    
            const ticketsPerBot = 30;
            const requiredBotCount = Math.ceil(minTicketCount / ticketsPerBot);
            const expensePerBot = Math.ceil(ticketPrice * ticketsPerBot);
    
            // Step 1: Get current game players
            const { players = [] } = await Sys.Game.Game3.Services.GameServices.getSingleGameData(
                { _id: gameId },
                { players: 1 }
            );
    
            const existingPlayerIds = players.map(p => p.id);
    
            // Step 2: Get available bots not in the current game
            const availableBots = await Sys.Game.Game3.Services.PlayerServices.getByData(
                {
                    _id: { $nin: existingPlayerIds },
                    "hall.id": { $in: allHallsId },
                    userType: "Bot",
                    walletAmount: { $gte: expensePerBot }
                },
                { _id: 1},
                { limit: requiredBotCount }
            );
            
            if (availableBots.length < requiredBotCount) {
                console.log("Not enough bots available for required halls.");
                return { status: "failed", message: "Not enough bots available." };
            }
    
            // Step 3: Update game state before bot purchases
            await Sys.Game.Common.Services.GameServices.updateGame(
                { _id: gameId },
                {
                    $set: {
                        "otherData.botTicketPurcasheStarted": true,
                        "otherData.botTicketPurcashed": false
                    }
                }
            );
    
            // Step 4: Purchase tickets concurrently
            let remainingTickets = minTicketCount;
            const socket = { id: "botsocketidexample" };
            const purchasePromises = [];
    
            for (const bot of availableBots) {
                if (remainingTickets <= 0) break;
            
                const ticketQty = Math.min(ticketsPerBot, remainingTickets);
                const data = {
                    purchaseType: "realMoney",
                    ticketQty,
                    playerId: bot._id.toString(),
                    subGameId: gameId.toString(),
                    voucherId: '',
                    voucherCode: ''
                };
    
                purchasePromises.push(
                    Sys.Game.Game3.Controllers.GameController.PurchaseGame3Tickets(socket, data)
                );
    
                remainingTickets -= ticketQty;
            }
    
            await Promise.allSettled(purchasePromises);
    
            return {
                status: "success",
                message: "Bot ticket purchase executed."
            };
    
        } catch (error) {
            console.error("!! Error while populating game 3:", error);
            throw new Error(error.message);
        }
    },

    // This function will be used to start all (Real + Bot) running subgames when server restarts  and also starts progress of bot games
    handleServerRestart: async function () {
        try {
            console.log("handleServerRestart called for game 3");
            // Get today's day in required format
            const startOfDay = moment().startOf('day').toDate();
            const endOfDay = moment().endOf('day').toDate();
            const today = moment().format('ddd');
           
            //Step 1: Get all running subgames Real & Bot 
            const runningGames = await Sys.Game.Game3.Services.GameServices.getByData(
                {
                    gameType: 'game_3',
                    status: { $in: ['running', 'active'] },
                    startDate: { $gte: startOfDay, $lte: endOfDay },
                    day: today,
                    isNotificationSent: true
                },
                { 
                    _id: 1,  status: 1, gameNumber: 1, parentGameId: 1, isNotificationSent: 1, notificationStartTime: 1, withdrawNumberArray: 1, sequence: 1, otherData: 1, day: 1
                }
            );
    
            // Process each game
            await Promise.all(runningGames.map(async (game) => {
                try {
                    if (game.status === 'running') {
                        // Resume game from where it left off
                        if (game.withdrawNumberArray.length < 75) {
                            await cleanTimeAndData(`${game._id}_timer`, 'game3', game._id);
                            await loadTicketsToRedis(game._id.toString(), { winningCombinations: 1, gameId: 1, ticketId: 1, tickets: 1,  playerIdOfPurchaser: 1, hallName: 1, hallId: 1, groupHallName: 1, groupHallId: 1 }, "game3");
                            module.exports.gamePlay(game._id);
                        } 
                    } 
                    // If game was active and notification was sent
                    else if (game.status === 'active' && game.isNotificationSent) {
                        // Setup game start time and notifications
                        const { secondsToAdd } = await setupGameStartTime({notificationStartTime: game.notificationStartTime, gameNumber: game.gameNumber});
                        
                        // get parebtgames count
                        const parentGame = await Sys.Game.Game3.Services.GameServices.getSingleParentGameData(
                            { _id: game.parentGameId },
                            { subGames: 1 }
                        );
    
                        if(!parentGame || !parentGame?.subGames?.length) {
                            console.log("Parent game not found or no subgames found");
                            return;
                        }
    
                        if(game.otherData?.isBotGame) {
                            // Handle Bot Game Start
                            await handleBotGame({_id: game._id, parentGameId: game.parentGameId, sequence: game.sequence, day: game.day}, parentGame?.subGames?.length);
                        } else {
                            // Handle Normal Game Start
                            await handleNormalGame({_id: game._id, parentGameId: game.parentGameId}, secondsToAdd || 10, parentGame?.subGames?.length, setGameTimer, cleanTimeAndData);
                        }
                    }
                } catch (error) {
                    console.error(`Error processing game ${game._id}:`, error);
                }
            }));
    
            //Step 2: Now check for Remainig bot games which parentgame is not checked and need to start bot games that were not running
            const day = moment().format('ddd');
            const parentGames = await Sys.Game.Game2.Services.GameServices.getByDataParent(
                { gameType: "game_3", status: "running", 'otherData.isBotGame': true, [`days.${day}`]: { $exists: true } },
                { _id: 1, subGames: 1 }
            );
    
            await Promise.all(parentGames.map(async parentGame => {
                const { _id: parentId, subGames } = parentGame;
                const games = await Sys.Game.Game3.Services.GameServices.getByData(
                    { parentGameId: parentId, status: 'active' },
                    {
                        otherData: 1, ticketPrice: 1, parentGameId: 1,
                        allHallsId: 1, minTicketCount: 1, sequence: 1,
                        totalNoPurchasedTickets: 1
                    }
                );
    
                const childGames = [];
                const startGamePromises = [];
    
                games.sort((a, b) => a.sequence - b.sequence);
    
                for (const game of games) {
                    const {
                        _id: gameId,
                        otherData,
                        minTicketCount,
                        allHallsId,
                        ticketPrice,
                        totalNoPurchasedTickets
                    } = game;
    
                    const {
                        botTicketPurcasheStarted,
                        botTicketPurcashed
                    } = otherData || {};
    
                    if (!botTicketPurcasheStarted) {
                        childGames.push({
                            gameId,
                            minTicketCount,
                            allHallsId: allHallsId.map(h => h.toString()),
                            ticketPrice
                        });
                    } else if (botTicketPurcashed && totalNoPurchasedTickets >= minTicketCount) {
                        startGamePromises.push(
                            module.exports.StartGameCheck(gameId, subGames.length)
                        );
                    } else if (botTicketPurcasheStarted && !botTicketPurcashed) {
                        if (minTicketCount > totalNoPurchasedTickets) {
                            childGames.push({
                                gameId,
                                minTicketCount,
                                allHallsId: allHallsId.map(h => h.toString()),
                                ticketPrice
                            });
                        } else {
                            await Sys.Game.Game3.Services.GameServices.updateSingleGame(
                                { _id: gameId },
                                { $set: { 'otherData.botTicketPurcashed': true } }
                            );
                            startGamePromises.push(
                                module.exports.StartGameCheck(gameId, subGames.length)
                            );
                        }
                    } else {
                        await Sys.Game.Game3.Controllers.GameController.processRefundAndFinishGame(gameId, null, true)
                    }
                }
    
                // Process bot filling concurrently
                const botPromises = childGames.map((childGame, i) => {
                    return module.exports.populateGame3WithBots(childGame)
                        .then(result => {
                            console.log(`Result for subgame number ${i + 1} for parent`, result);
                        }).catch(err => {
                            console.error(`Error for subgame number ${i + 1} for parent ${parentId}`, err);
                        });
                });
    
                await Promise.all([...startGamePromises, ...botPromises]);
            }));
    
        } catch (error) {
            console.error("Error in handleServerRestartAllGames of game 3:", error);
        }
    }

    // This function will be used to check if any bot game is running and if not then it will start the bot game when server restarts
    // handleServerRestart: async function (parentGameId) {
    //     try {
    //         console.log("handleServerRestart called for game 3", parentGameId);
    
    //         if (parentGameId != null) return; 

    //         // Handle Real games
    //         await module.exports.handleServerRestartRealGames();

    //         // Handle Bot games
    //         const day = moment().format('ddd');
    //         const parentGames = await Sys.Game.Game2.Services.GameServices.getByDataParent(
    //             { status: "running", 'otherData.isBotGame': true, [`days.${day}`]: { $exists: true } },
    //             { otherData: 1, subGames: 1 }
    //         );
    
    //         console.log("parentGames---", parentGames.length);
    //         await Promise.all(parentGames.map(async parentGame => {
    //             const { _id: parentId, subGames } = parentGame;
    
    //             // Refund all running subgames for this parent game in parallel
    //             const runningGames = await Sys.Game.Game3.Services.GameServices.getByData(
    //                 { parentGameId: parentId, status: "running" },
    //                 { _id: 1 }
    //             );
    
    //             await Promise.all(runningGames.map(g =>
    //                 Sys.Game.Game3.Controllers.GameController.processRefundAndFinishGame(g._id, null, true)
    //             ));
    
    //             console.log("Execute Game Starter Logic now");
    
    //             const games = await Sys.Game.Game3.Services.GameServices.getByData(
    //                 { parentGameId: parentId, status: 'active' },
    //                 {
    //                     otherData: 1, ticketPrice: 1, parentGameId: 1,
    //                     allHallsId: 1, minTicketCount: 1, sequence: 1,
    //                     totalNoPurchasedTickets: 1
    //                 }
    //             );
    
    //             const childGames = [];
    //             const startGamePromises = [];
    
    //             games.sort((a, b) => a.sequence - b.sequence);
    
    //             for (const game of games) {
    //                 const {
    //                     _id: gameId,
    //                     otherData,
    //                     minTicketCount,
    //                     allHallsId,
    //                     ticketPrice,
    //                     totalNoPurchasedTickets
    //                 } = game;
    
    //                 const {
    //                     botTicketPurcasheStarted,
    //                     botTicketPurcashed
    //                 } = otherData || {};
    
    //                 if (!botTicketPurcasheStarted) {
    //                     childGames.push({
    //                         gameId,
    //                         minTicketCount,
    //                         allHallsId: allHallsId.map(h => h.toString()),
    //                         ticketPrice
    //                     });
    //                 } else if (botTicketPurcashed && totalNoPurchasedTickets >= minTicketCount) {
    //                     startGamePromises.push(
    //                         module.exports.StartGameCheck(gameId, subGames.length)
    //                     );
    //                 } else if (botTicketPurcasheStarted && !botTicketPurcashed) {
    //                     if (minTicketCount > totalNoPurchasedTickets) {
    //                         childGames.push({
    //                             gameId,
    //                             minTicketCount,
    //                             allHallsId: allHallsId.map(h => h.toString()),
    //                             ticketPrice
    //                         });
    //                     } else {
    //                         await Sys.Game.Game3.Services.GameServices.updateSingleGame(
    //                             { _id: gameId },
    //                             { $set: { 'otherData.botTicketPurcashed': true } }
    //                         );
    //                         startGamePromises.push(
    //                             module.exports.StartGameCheck(gameId, subGames.length)
    //                         );
    //                     }
    //                 } else {
    //                     await Sys.Game.Game3.Controllers.GameController.processRefundAndFinishGame(gameId, null, true)
    //                 }
    //             }
    
    //             // Process bot filling concurrently
    //             const botPromises = childGames.map((childGame, i) => {
    //                 return module.exports.populateGame3WithBots(childGame)
    //                     .then(result => {
    //                         console.log(`Result for subgame number ${i + 1} for parent`, result);
    //                     }).catch(err => {
    //                         console.error(`Error for subgame number ${i + 1} for parent ${parentId}`, err);
    //                     });
    //             });
    
    //             await Promise.all([...startGamePromises, ...botPromises]);
    //         }));
    
    //     } catch (e) {
    //         console.error("Error in handleServerRestart of game 3", e);
    //     }
    // },

    // This function is used to resume running/already sent notification to start of today
    // handleServerRestartRealGames: async function () {
    //     try {
    //         console.log("handleServerRestartRealGames called for game 3");
            
    //         // Get today's day in required format
    //         const startOfDay = moment().startOf('day').toDate();
    //         const endOfDay = moment().endOf('day').toDate();
    //         const today = moment().format('ddd');
    //         // Get all running subgames
    //         const runningGames = await Sys.Game.Game3.Services.GameServices.getByData(
    //             {
    //                 gameType: 'game_3',
    //                 status: { $in: ['running', 'active'] },
    //                 startDate: { $gte: startOfDay, $lte: endOfDay },
    //                 day: today,
    //                 'otherData.isBotGame': false,
    //                 isNotificationSent: true
    //             },
    //             { 
    //                 _id: 1,  status: 1, gameNumber: 1, parentGameId: 1, isNotificationSent: 1, notificationStartTime: 1, withdrawNumberArray: 1
    //             }
    //         );

    //         if (!runningGames?.length) {
    //             console.log("No running games found for today");
    //             return;
    //         }

    //         // Process each game
    //         await Promise.all(runningGames.map(async (game) => {
    //             try {
    //                 if ( game.status === 'running' ) {
    //                     // Resume game from where it left off
    //                     if (game.withdrawNumberArray.length < 75) {
    //                         await cleanTimeAndData(`${game._id}_timer`, 'game3', game._id);
    //                         await loadTicketsToRedis(game._id.toString(), { winningCombinations: 1, gameId: 1, ticketId: 1, tickets: 1,  playerIdOfPurchaser: 1, hallName: 1, hallId: 1, groupHallName: 1, groupHallId: 1 }, "game3");
    //                         module.exports.gamePlay(game._id);
    //                     } 
    //                 } 
    //                 // If game was active and notification was sent
    //                 else if (game.status === 'active' && game.isNotificationSent) {
    //                     // Setup game start time and notifications
    //                     const { secondsToAdd } = await setupGameStartTime({notificationStartTime: game.notificationStartTime, gameNumber: game.gameNumber});
                        
    //                     // get parebtgames count
    //                     const parentGame = await Sys.Game.Game3.Services.GameServices.getSingleParentGameData(
    //                         { _id: game.parentGameId },
    //                         { subGames: 1 }
    //                     );

    //                     if(!parentGame || !parentGame?.subGames?.length) {
    //                         console.log("Parent game not found or no subgames found");
    //                         return;
    //                     }

    //                     // Handle Normal Game Start
    //                     await handleNormalGame({_id: game._id, parentGameId: game.parentGameId}, secondsToAdd || 10, parentGame?.subGames?.length, setGameTimer, cleanTimeAndData);
    //                 }
    //             } catch (error) {
    //                 console.error(`Error processing game ${game._id}:`, error);
    //             }
    //         }));

    //         return true;
    //     } catch (error) {
    //         console.error("Error in handleServerRestartRealGames of game 3:", error);
    //         return false;
    //     }
    // },

}