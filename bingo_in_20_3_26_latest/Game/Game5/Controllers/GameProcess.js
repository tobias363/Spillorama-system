let Sys = require('../../../Boot/Sys.js');
const { translate } = require('../../../Config/i18n.js');
const { createErrorResponse, createSuccessResponse, checkPlayerSpending, updatePlayerHallSpendingData } = require('../../../gamehelper/all.js');
const { 
    getAvailableBalls, 
    getRandomBall, 
    getBallColor, 
    selectNumberWithProbablility, 
    determineRouletteOutcome, 
    sendGameNotification, 
    setGameTimer, 
    cleanTimeAndData,
    getGameDataFromRedis,
    saveGameDataToRedis,
    loadTicketsToRedis,
    saveTicketToRedis,
    getTicketFromRedis,
    getTicketFromRedisByGameId,
    processWinningTickets,
    syncGameToMongoDB,
    updateNestedFieldConditionally,
    deleteRedisDataByTypeAndId
} = require('../../../gamehelper/game5.js');

module.exports = {

    startGame: async function (gameId, hall) {
        try {
            console.log("Start game called.", gameId);
            const language = "en";
            
            // Define the update document with all needed fields
            const updateDoc = {
                status: "Running", 
                'otherData.gameInterState': "Running", 
                withdrawNumberArray: [],
                history: [],
                halls: [{id: hall.id, name: hall.name}],
                'otherData.wofWinnings': [3, 4, 6, 3, 5, 4, 3, 6, 4, 3, 5, 4, 3, 10, 5],
                'otherData.rouletteData': [
                    { number: 0, color: 'green' }, { number: 32, color: 'red' }, { number: 15, color: 'black' },
                    { number: 19, color: 'red' }, { number: 4, color: 'black' }, { number: 21, color: 'red' },
                    { number: 2, color: 'black' }, { number: 25, color: 'red' }, { number: 17, color: 'black' },
                    { number: 34, color: 'red' }, { number: 6, color: 'black' }, { number: 27, color: 'red' },
                    { number: 13, color: 'black' }, { number: 36, color: 'red' }, { number: 11, color: 'black' },
                    { number: 30, color: 'red' }, { number: 8, color: 'black' }, { number: 23, color: 'red' },
                    { number: 10, color: 'black' }, { number: 5, color: 'red' }, { number: 24, color: 'black' },
                    { number: 16, color: 'red' }, { number: 33, color: 'black' }, { number: 1, color: 'red' },
                    { number: 20, color: 'black' }, { number: 14, color: 'red' }, { number: 31, color: 'blcak' },
                    { number: 9, color: 'red' }, { number: 22, color: 'black' }, { number: 18, color: 'red' },
                    { number: 29, color: 'black' }, { number: 7, color: 'red' }, { number: 28, color: 'black' },
                    { number: 12, color: 'red' }, { number: 35, color: 'black' }, { number: 3, color: 'red' },
                    { number: 26, color: 'black' }
                ]
            };

            // Find game with status "Waiting" and update it in a single query
            const updatedGame = await Sys.Game.Game5.Services.GameServices.updateSubgame(
                { _id: gameId, status: "Waiting" },  // Only update if status is "Waiting"
                { $set: updateDoc }, 
                { new: true }  // Return the updated document
            );

            // If no game was updated (either not found or status wasn't "Waiting")
            if (!updatedGame) {
                // Check if game exists at all
                const gameExists = await Sys.Game.Game5.Services.GameServices.getSingleSubgameData(
                    { _id: gameId },
                    { status: 1 }
                );
                
                if (!gameExists) {
                    return await createErrorResponse("Game Not Found!", language, 400, false);
                } else {
                    return await createErrorResponse("Game already started.", language, 400, false);
                }

            }

            // Initialize game data for Redis
            const gameData = {
                _id: updatedGame._id,
                parentGameId: updatedGame.parentGameId,
                withdrawNumberArray: [],
                history: [],
                withdrawableBalls: updatedGame.withdrawableBalls,
                seconds: updatedGame.seconds,
                isBotGame: updatedGame.otherData?.isBotGame || false,
                botSeconds: updatedGame.otherData?.botSeconds || 0,
                allPatternArray: updatedGame.allPatternArray,
                player: updatedGame.player,
                status: "Running",
                gameNumber: updatedGame.gameNumber,
                startDate: updatedGame.startDate || Date.now(),
                otherData: updatedGame.otherData,
                availableBalls: getAvailableBalls([], 36), // All balls available at start
                earnedFromTickets: updatedGame.earnedFromTickets,
                finalGameProfitAmount: updatedGame.finalGameProfitAmount,
                pendingDbUpdates: {  }
            };
            // Store in Redis with TTL of 1 hour
            await saveGameDataToRedis('game5', gameId, gameData, 3600);
            
            // Load tickets for this game into Redis
            await loadTicketsToRedis(gameId);
            
            // Start gameplay process
            module.exports.gamePlay(gameId.toString());
            
            return { status: 'success', message: 'Game started successfully' };
        } catch (error) {
            console.log("Error in start game", error);
            return await createErrorResponse("Something went wrong.", language, 500, false);
        }
    },

    gamePlay: async function (gameId) {
        try {
            const timerKey = `${gameId}_timer`;
            // Get game data from Redis
            let gameData = await getGameDataFromRedis('game5', gameId);
            
            if (!gameData) {
                // Get only the necessary fields for gameplay
                const room = await Sys.Game.Game5.Services.GameServices.getSingleSubgameData(
                    { _id: gameId },
                    { withdrawNumberArray: 1, otherData: 1, seconds: 1, withdrawableBalls: 1, player: 1, status: 1, startDate: 1, gameNumber: 1, allPatternArray: 1, parentGameId: 1, earnedFromTickets: 1, finalGameProfitAmount: 1 }
                );
                
                if (!room) {
                    console.log("Error: Game not found for gamePlay", gameId);
                    return;
                }
                
                gameData = {
                    _id: room._id,
                    parentGameId: room.parentGameId,
                    withdrawNumberArray: [...room.withdrawNumberArray],
                    history: [],
                    withdrawableBalls: room.withdrawableBalls,
                    seconds: room.seconds,
                    isBotGame: room.otherData?.isBotGame || false,
                    botSeconds: room.otherData?.botSeconds || 0,
                    allPatternArray: room.allPatternArray,
                    player: room.player,
                    status: room.status, 
                    gameNumber: room.gameNumber,
                    startDate: room.startDate, 
                    otherData: room.otherData,
                    availableBalls: getAvailableBalls(room.withdrawNumberArray, 36),
                    earnedFromTickets: room.earnedFromTickets,
                    finalGameProfitAmount: room.finalGameProfitAmount,
                    pendingDbUpdates: {}
                };
                
                // Store in Redis with TTL of 1 hour
                await saveGameDataToRedis('game5', gameId, gameData, 3600);
                
                // Load tickets for this game into Redis
                await module.exports.loadTicketsToRedis(gameId);
            } else {
                // If we already have gameData, make sure availableBalls is properly set
                if (!gameData.availableBalls || gameData.availableBalls.length === 0) {
                    gameData.availableBalls = getAvailableBalls(gameData.withdrawNumberArray, 36);
                    await saveGameDataToRedis('game5', gameId, gameData, 3600);  // Update Redis with the corrected data
                }
            }
            
            // Check if we've reached the maximum number of balls or have no balls left
            if (gameData.withdrawNumberArray.length >= gameData.withdrawableBalls || 
                gameData.availableBalls.length === 0) {
                cleanTimeAndData(timerKey);
                return module.exports.checkForWinners(gameId);
            }
    
            // Get a random ball and its color
            const withdrawBall = getRandomBall(gameData.availableBalls);
            const withdrawColor = getBallColor(withdrawBall);
            
            const historyObj = {
                number: withdrawBall,
                color: withdrawColor,
                totalWithdrawCount: gameData.withdrawNumberArray.length + 1
            };
    
            // Update memory data in redis
            gameData.withdrawNumberArray.push(withdrawBall);
            gameData.history.push(historyObj);
            gameData.availableBalls = gameData.availableBalls.filter(n => n !== withdrawBall);
            
            // Mark fields as pending for MongoDB sync later
            gameData.pendingDbUpdates = gameData.pendingDbUpdates || {};
            gameData.pendingDbUpdates.withdrawNumberArray = true;
            gameData.pendingDbUpdates.history = true;
            
            // Save updated game data to Redis
            await saveGameDataToRedis('game5', gameId, gameData, 3600);
    
            // Emit event to clients
            Sys.Io.of(Sys.Config.Namespace.Game5).to(gameData._id).emit('WithdrawBingoBall', historyObj);
    
            // Check if we've reached the maximum after adding this ball
            if (gameData.withdrawNumberArray.length >= gameData.withdrawableBalls) {
                cleanTimeAndData(timerKey);
                return module.exports.checkForWinners(gameId);
            }
    
            // Set timer for next ball
            const withdrawTime = gameData.isBotGame ? gameData.botSeconds : gameData.seconds;
            setGameTimer(timerKey, () => {
                try {
                    module.exports.gamePlay(gameId);
                } catch (error) {
                    console.log("Error in gamePlay timer callback:", error);
                    // Try to recover
                    cleanTimeAndData(timerKey);
                    setImmediate(() => module.exports.checkForWinners(gameId));
                }
            }, withdrawTime);
    
        } catch (error) {
            console.log("Error in gamePlay--", error);
            // Try to recover on error by moving to winner check stage      
            cleanTimeAndData(`${gameId}_timer`);
            setImmediate(() => module.exports.checkForWinners(gameId));
        }
    },
    
    checkForWinners: async function (gameId) {
        try {
            // Clean up the timer
            cleanTimeAndData(`${gameId}_timer`);
            
            // Get game data from Redis
            let gameData = await getGameDataFromRedis('game5', gameId);
            
            if (!gameData) {
                return await createErrorResponse('Game not found in Redis!', "en", 400, false);
            }
            
            // Update game state in Redis
            gameData.otherData.gameInterState = "Finished";
            gameData.pendingDbUpdates = gameData.pendingDbUpdates || {};
            gameData.pendingDbUpdates['otherData.gameInterState'] = true;
            
            // Save updated game data to Redis
            await saveGameDataToRedis('game5', gameId, gameData, 3600);
            
            // to get all game tickets
            const tickets = await getTicketFromRedisByGameId(gameId, true);
           
            // Sort patterns by multiplier in descending order for optimal matching
            const winningPatterns = [...gameData.allPatternArray].sort((a, b) => b.multiplier - a.multiplier);
          
            // Process tickets for winners
            await processWinningTickets(gameId, gameData.withdrawNumberArray, winningPatterns, tickets);
           
            // Non-blocking transition to game finished state
            setImmediate(() => module.exports.gameFinished(gameId));
            
            return { status: 'success', message: 'Processed winners' };
        } catch (error) {
            console.log("Error in checkForWinners", error);
            // Try to sync data to MongoDB in case of error
            try {
                await syncGameToMongoDB(gameId, false);
            } catch (syncError) {
                console.log("Error syncing game data to MongoDB:", syncError);
            }
            return await createErrorResponse('Error checking for winners', "en", 500, false);
        }
    },
    
    gameFinished: async function (gameId) {
        try {
            cleanTimeAndData(`${gameId}_timer`);
            
            let gameData = await getGameDataFromRedis('game5', gameId);
            if (!gameData) {
                // Get from MongoDB instead
                const room = await Sys.Game.Game5.Services.GameServices.getSingleSubgameData(
                    { _id: gameId }, 
                    { player: 1, status: 1, withdrawNumberArray: 1, allPatternArray: 1, otherData: 1, gameNumber: 1, startDate: 1, parentGameId: 1, earnedFromTickets: 1, finalGameProfitAmount: 1 }
                );
                
                if (!room) {
                    return await createErrorResponse("Game Not Found!", "en", 400, false);
                }
                
                // Use MongoDB data since Redis data is missing
                gameData = room;
            }
            
            // Check if game is already finished
            if (gameData.status === "Finished") {
                return await createErrorResponse("game_finished", "en", 400);
            }
            
            // Get player language
            const player = await Sys.Game.Game5.Services.PlayerServices.getSingleData(
                { _id: gameData.player.id }, 
                { selectedLanguage: 1 }
            );
            
            // Get winning tickets from Redis
            const tickets = await getTicketFromRedisByGameId(gameId, true);
           
            // Process winning tickets
            const winningPatterns = [];
            let totalWonAmount = 0;
            const winningMultiplier = [];
            
            if (tickets && tickets.length > 0) {
                for (const ticket of tickets) {
                    if (ticket.isPlayerWon) {
                        if (!ticket.winningStats || !ticket.winningStats.patternWon) {
                            continue; // Skip invalid tickets
                        }
                        
                        const winningPattern = (({ multiplier, pattern }) => ({ multiplier, pattern }))(ticket.winningStats.patternWon);
                        const isJackpotWon = ticket.winningStats.patternWon.patternName === "Jackpot_1" || 
                                           ticket.winningStats.patternWon.patternName === "Jackpot_2";
                        
                        winningPatterns.push({ 
                            ticketId: ticket._id.toString(), 
                            pattern: winningPattern, 
                            wonAmount: ticket.totalWinningOfTicket, 
                            ticketColor: ticket.ticketColorName, 
                            wofSpins: 0, 
                            history: [], 
                            isJackpotWon 
                        });
                        
                        totalWonAmount += ticket.totalWinningOfTicket;
                        winningMultiplier.push(" x" + winningPattern.multiplier);
                    }
                }
            }
           
            // Update game data in Redis before syncing to MongoDB
            gameData.winners = winningPatterns;
            gameData.totalWinning = totalWonAmount;
            gameData.finalGameProfitAmount = gameData.finalGameProfitAmount 
                ? gameData.finalGameProfitAmount - totalWonAmount
                : -totalWonAmount;
          
            // Save final game state to Redis
            await saveGameDataToRedis('game5', gameId, gameData);
            
            // Handle winning or non-winning scenarios
            if (winningPatterns.length > 0) {
                // Sync all Redis data to MongoDB first
                await syncGameToMongoDB(gameId, false);
                
                // Update player with winnings
                const currentPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                    { _id: gameData.player.id }, 
                    { $inc: { 
                        walletAmount: totalWonAmount, 
                        "statisticsgame5.totalGames": 1, 
                        "statisticsgame5.totalGamesWin": 1, 
                        "statisticsgame5.totalWinning": totalWonAmount 
                    }}
                );
                
                if (currentPlayer) {
                    // Emit game finish event
                    Sys.Io.of(Sys.Config.Namespace.Game5).to("/Game5#" + currentPlayer.socketId).emit('GameFinish', {
                        gameId,
                        winningPatterns,
                        totalWonAmount,
                        isWon: true
                    });
                    
                    // Create transaction
                    const transactionDataSend = {
                        playerId: gameData.player.id,
                        gameId: gameData._id,
                        gameStartDate: gameData.startDate,
                        action: "credit",
                        purchasedSlug: "realMoney",
                        totalAmount: totalWonAmount,
                        previousBalance: currentPlayer.walletAmount - totalWonAmount,
                        afterBalance: currentPlayer.walletAmount,
                        defineSlug: "GameWon",
                        extraSlug: "Game5",
                        transactionSlug: "game5Transactions",
                        typeOfTransaction: "Game Won",
                        remark: "Won Game 5 pattern prize.",
                    };
                    
                    // Create transaction asynchronously
                    Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);
                    Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                        type: "winning",
                        playerId: gameData.player.id,
                        hallId: '',
                        winning: totalWonAmount
                    });
                    await updatePlayerHallSpendingData({ playerId: gameData.player.id, hallId: '', amount: +totalWonAmount, type: 'normal', gameStatus: 3 });
                    // Handle notifications for real player games
                    if (!gameData.otherData.isBotGame && currentPlayer.enableNotification) {
                        // Process notifications
                        sendGameNotification({
                            playerId: gameData.player.id,
                            gameId: gameId,
                            gameNumber: gameData.gameNumber,
                            totalWonAmount: totalWonAmount,
                            winningMultiplier: winningMultiplier,
                            firebaseToken: currentPlayer.firebaseToken,
                            notificationType: 'pattern'
                        });
                    }
                    
                    // Schedule extra winnings
                    const timerKey = `${gameId}_sch_extra_timer`;
                    const timeInterval = gameData.otherData.isBotGame ? 100 : 4000;
                    
                    setGameTimer(timerKey, async () => {
                        try {
                            module.exports.scheduleExtraWinnings(gameId);
                        } catch (error) {
                            console.log("Error in scheduleExtraWinnings timer:", error);
                            setImmediate(() => module.exports.scheduleExtraWinnings(gameId));
                        }
                    }, timeInterval);
                }
            } else {
                // No winners - sync to MongoDB and finish
                cleanTimeAndData(`${gameId}_timer`, gameId);
                
                // Calculate profit percentage
                const profitPercentage = +parseFloat((gameData.finalGameProfitAmount / gameData.earnedFromTickets) * 100).toFixed(2);
                
                // Set final game status in Redis
                gameData.status = "Finished";
                gameData.otherData.profitPercentage = profitPercentage;
                await saveGameDataToRedis('game5', gameId, gameData);
                
                // Sync to MongoDB
                await syncGameToMongoDB(gameId, true);
                
                // Update player stats
                const updatedPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                    { _id: gameData.player.id }, 
                    { $inc: { "statisticsgame5.totalGames": 1, "statisticsgame5.totalGamesLoss": 1 } }
                );
                
                // Emit game finish event
                await Sys.Io.of(Sys.Config.Namespace.Game5).to("/Game5#" + updatedPlayer.socketId).emit('GameFinish', {
                    gameId,
                    winningPatterns,
                    totalWonAmount,
                    isWon: false
                });
                
                // Handle bot game completion
                if (gameData.otherData.isBotGame) {
                    await Sys.App.Services.GameService.updateGameData(
                        { _id: gameData.parentGameId }, 
                        { $inc: { 'otherData.totalBotGamePlayed': 1 } }
                    );
                    Sys.Game.Game5.Controllers.GameController.checkForBotGame5({ action: "gameFinished" });
                }
                
                // Check break time if game is finished
                await Sys.Game.Common.Controllers.PlayerController.checkBreakTimeOnGameFinished(gameData.player.id, "Game5");
            }
            
            return {
                status: 'success',
                result: {
                    winningPatterns,
                    totalWonAmount
                },
                message: 'Game tickets data found!'
            };
        } catch (error) {
            console.log("Error in gameFinished", error);
            // Attempt emergency sync to MongoDB
            try {
                await syncGameToMongoDB(gameId, false);
            } catch (syncError) {
                console.error("Error in emergency sync to MongoDB:", syncError);
            }
            return await createErrorResponse("something_went_wrong", "en", 500);
        }
    },

    scheduleExtraWinnings: async function (gameId) {
        try {
           
            const room = await getGameDataFromRedis('game5', gameId);
            if (!room) {
                cleanTimeAndData(`${gameId}_sch_extra_timer`, gameId);
                return await createErrorResponse("Game Not Found!", "en", 400, false);
            }
            
            // Get player language for response messages
            const playerId = room.player.id;
            const playerLang = await Sys.Game.Game5.Services.PlayerServices.getSingleData(
                { _id: playerId }, 
                { selectedLanguage: 1 }
            );
            const language = playerLang?.selectedLanguage || "nor";
            
            // Check if a minigame is already running for this game
            const isMiniGameRunning = await getTicketFromRedis(gameId, "minigame_active");
            
            if (isMiniGameRunning) {
                return {
                    status: 'fail',
                    message: await translate({ key: "minigame_already_running", language: language })
                };
            }
            
            // Find the next eligible winning ticket for bonus games
            const redisTickets = await getTicketFromRedisByGameId(gameId, true);
            
            let ticket = null;
            if (redisTickets && redisTickets.length > 0) {
                ticket = redisTickets.find(t => 
                    t.isPurchased === true && 
                    t.isPlayerWon === true && 
                    t.bonusWinningStats?.isMiniWofGamePlayed === false && 
                    t.bonusWinningStats?.isMiniGamePlayed === false
                );
            }
            
            if (!ticket) {
                // No eligible tickets left, mark the game as finished
                return module.exports.checkMiniGameFinished(gameId);
            }
            
            // Mark the minigame as running in Redis (lock)
            await saveTicketToRedis(gameId, "minigame_active", { 
                ticketId: ticket._id.toString(),
                timestamp: Date.now() 
            }, 300); // 5 minute TTL on lock
            
            // Mark the ticket as being processed - update both Redis and MongoDB
            const updatedTicket = {
                ...ticket,
                bonusWinningStats: {
                    ...ticket.bonusWinningStats,
                    miniGameStatus: "Running"
                }
            };
            
            // Save to Redis
            await saveTicketToRedis(gameId, ticket._id.toString(), updatedTicket);
            
            // Define the timer key for this operation
            const timerKey = `${gameId}_sch_extra_timer`;
            
            // Clear any existing timer for this game/ticket
            cleanTimeAndData(timerKey);
            
            // Process the ticket based on the pattern won
            const patternName = ticket.winningStats.patternWon.patternName;
            
            if (patternName.startsWith("Jackpot_")) {
                // Handle Jackpot winning patterns
                await module.exports.processJackpotWin(ticket, gameId, timerKey);
            } 
            else if (patternName.startsWith("Bonus_")) {
                // Handle Bonus winning patterns - activate Wheel of Fortune
                await module.exports.processBonusWin(ticket, gameId, playerId, timerKey, room.otherData?.isBotGame);
            } 
            else {
                // Handle regular pattern wins - no extra games
                await module.exports.processRegularWin(ticket, gameId, timerKey, room.otherData?.isBotGame);
            }
            
            return { status: 'success' };
        } catch (error) {
            console.log("Error in scheduleExtraWinnings:", error);
            // Continue processing next tickets even if this one fails
            setImmediate(() => module.exports.scheduleExtraWinnings(gameId));
        }
    },

    // Helper functions for processing Jackpot Winning
    processJackpotWin: async function(ticket, gameId, timerKey) {
        try {
            // Update ticket status in Redis
            const updatedTicket = {
                ...ticket,
                bonusWinningStats: {
                    ...ticket.bonusWinningStats,
                    isMiniGamePlayed: true,
                    miniGameStatus: "Finished",
                    isJackpotWon: true
                }
            };
            
            // Save updated ticket to Redis
            await saveTicketToRedis(gameId, ticket._id.toString(), updatedTicket);
        
            // Clear minigame_active lock from Redis
            await deleteRedisDataByTypeAndId('game5_tickets', `${gameId}_minigame_active`);
            
            // Schedule next ticket processing with minimal delay
            const timeInterval = 100;
            setGameTimer(timerKey, () => module.exports.scheduleExtraWinnings(gameId), timeInterval);

            // disable jackpot prize distributiion as need to add new logic 
            /*Timeout.set(Sys.Game5Timers[(indexId - 1)], async () => {
                let index = Sys.Game5Timers.indexOf(room._id.toString());
                if (index !== -1) {
                    Timeout.clear(Sys.Game5Timers[index], erase = true);
                    Sys.Game5Timers.splice(index, 1);
                }
                let currentTicketWinningAmount = 0;
                if(ticket.winningStats.patternWon.patternName == "Jackpot_1"){
                    currentTicketWinningAmount = generateRandomNumber(1, 10000);
                }else if(ticket.winningStats.patternWon.patternName == "Jackpot_2"){
                    currentTicketWinningAmount = generateRandomNumber(1, 8000);
                }
                // else if(ticket.winningStats.patternWon.patternName == "Jackpot_3"){
                //     currentTicketWinningAmount = generateRandomNumber(1, 2500);
                // }
                //console.log("Winning price of jackpot", currentTicketWinningAmount, ticket.winningStats.patternWon.patternName);
    
                let currentPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: room.player.id }, { $inc: { walletAmount: currentTicketWinningAmount, "statisticsgame5.totalWinning": currentTicketWinningAmount } }); 
                //console.log("currentPlayer after jackpot winning update---", currentPlayer, )
                if(currentPlayer){
                    // console.log("send jackpot winning broadcast", {
                    //     gameId: gameId.toString(),
                    //     ticketId: ticket._id.toString(),
                    //     playerId: room.player.id,
                    //     totalWonAmount: currentTicketWinningAmount,
                    //     ticketColor: ticket.ticketColorName,
                    //     ticket: ticket.tickets,
                    // })
                    await Sys.Io.of(Sys.Config.Namespace.Game5).to("/Game5#"+currentPlayer.socketId).emit('jackpotsWinnigs', { 
                        gameId: gameId.toString(),
                        ticketId: ticket._id.toString(),
                        playerId: room.player.id,
                        totalWonAmount: currentTicketWinningAmount,
                        ticketColor: ticket.ticketColorName,
                        ticket: ticket.tickets,
                    });

                    await Sys.Game.Game5.Services.GameServices.updateSubgame({ _id: gameId}, {
                        $push: {
                            'winners.$[current].history': {
                                wonAmount: currentTicketWinningAmount
                            },
                        },
                    }, {  arrayFilters: [ {"current.ticketId": ticket._id.toString() } ], new: true });
                    
                    let updatedTicket = await Sys.Game.Game5.Services.GameServices.updateTicket({ _id: ticket._id}, {
                        $push: {
                            'bonusWinningStats.history': {
                                wonAmount: currentTicketWinningAmount
                            },
                        },
                        $inc: { 
                            'bonusWinningStats.finalWonAmount': currentTicketWinningAmount,
                            'totalWinningOfTicket': currentTicketWinningAmount
                        }
                    }, {  new: true });
                    let transactionDataSend = {
                        playerId: room.player.id,
                        gameId: gameId,
                        gameStartDate: room.startDate,
                        action: "credit",
                        purchasedSlug: "realMoney",
                        totalAmount: currentTicketWinningAmount,
                        previousBalance: currentPlayer.walletAmount - currentTicketWinningAmount,
                        afterBalance: currentPlayer.walletAmount,
                        ticketPrice: ticket.ticketPrice,
                        defineSlug:"GameWon",
                        extraSlug: "Game5",
                        transactionSlug: "game5Transactions",
                        typeOfTransaction: "Game 5 Jackpot's Prize",
                        remark: "Won Game 5 Jackpot's prize.",
                    }
                    await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);  
                    
                    Sys.Game.Game5.Services.GameServices.updateSubgame({ _id: gameId }, 
                    { 
                        $inc: { totalWinning: currentTicketWinningAmount, finalGameProfitAmount: -currentTicketWinningAmount }
                    },{new: true});
                    
                    if(room.otherData.isBotGame == false){console.log("Real player jackpot noti")
                        let bulkArr= [];
                        if (currentPlayer.enableNotification == true) {
                            let notiMessage = { en: await translate({key: "game5_jackpot_winning", language: 'en', isDynamic: true, number: room.gameNumber, number1: +parseFloat(currentTicketWinningAmount).toFixed(2)}), 
                                            nor: await translate({key: "game5_jackpot_winning", language: 'nor', isDynamic: true, number: room.gameNumber,  number1: +parseFloat(currentTicketWinningAmount).toFixed(2) }) } ;
                            bulkArr.push({
                                insertOne: {
                                    document: {
                                        playerId: room.player.id,
                                        gameId:room._id,
                                        notification: {
                                            notificationType:'winning',
                                            message: notiMessage // room.gameNumber + " [ Game 5 ] Congratulations! You have won " + +parseFloat(currentTicketWinningAmount).toFixed(2) + " Kr for Winning Jackpot's Prizes."
                    
                                        }
                                    }
                                }
                            })
                            let message = {
                                notification: {
                                    title: "Spillorama",
                                    body: notiMessage // room.gameNumber + " [ Game 5 ] Congratulations! You have won " + +parseFloat(currentTicketWinningAmount).toFixed(2) + " Kr for Winning Jackpot's Prizes."
                                },
                                token : currentPlayer.firebaseToken
                            };
                            if(currentPlayer.firebaseToken){
                                Sys.Helper.gameHelper.sendWinnersNotifications(message);
                            }
                        }
                        Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkArr);
                    }   
                    
                    
                }

                let indexTemp = Sys.Game5Timers.indexOf(room._id.toString());
                if (indexTemp !== -1) {
                    Timeout.clear(Sys.Game5Timers[indexTemp], erase = true);
                    Sys.Game5Timers.splice(indexTemp, 1);
                }
                let indexId = Sys.Game5Timers.push(room._id.toString());
                let timeInterval = 2000;
                if(room.otherData.isBotGame == true){
                    timeInterval = 100;
                }
                Timeout.set(Sys.Game5Timers[(indexId - 1)], async () => {
                    let index = Sys.Game5Timers.indexOf(room._id.toString());
                    if (index !== -1) {
                        Timeout.clear(Sys.Game5Timers[index], erase = true);
                        Sys.Game5Timers.splice(index, 1);
                    }
                    module.exports.scheduleExtraWinnings(gameId);
                }, timeInterval); // 2000
                
            }, 1000);*/

        } catch (error) {
            console.log("Error in processJackpotWin:", error);
            // Continue processing next tickets even if this one fails
            setImmediate(() => module.exports.scheduleExtraWinnings(gameId));
        }
    },

    // Helper functions for processing Bonus Winning
    processBonusWin: async function(ticket, gameId, playerId, timerKey, isBotGame) {
        try {
            // First set a short delay before activating the minigame
            setGameTimer(timerKey, async () => {
                try {
                    // Emit event to activate wheel of fortune minigame
                    await Sys.Io.of(Sys.Config.Namespace.Game5).to(gameId).emit('ActivateMiniGame', {
                        gameId: gameId,
                        playerId: playerId,
                        ticketId: ticket._id,
                        miniGameType: "wheelOfFortune",
                        ticketColor: ticket.ticketColorName,
                        ticket: ticket.tickets,
                    });

                    // Update ticket in Redis to mark wheel of fortune as activated
                    const updatedTicket = {
                        ...ticket,
                        bonusWinningStats: {
                            ...ticket.bonusWinningStats,
                            isJackpotWon: false,
                            isMiniWofActivated: true,
                            miniWofGamestartTimeMs: Date.now()
                        }
                    };
                    
                    // Save to Redis
                    await saveTicketToRedis(gameId, ticket._id.toString(), updatedTicket);

                    // Set timer for auto-play of wheel of fortune if player doesn't interact
                    const timeInterval = isBotGame ? 100 : 10000;
                    
                    cleanTimeAndData(timerKey);
                    setGameTimer(timerKey, async () => {
                        try {
                            // Check if ticket is still not played from Redis
                            const ticketData = await getTicketFromRedis(gameId, ticket._id.toString());
                            
                            if (ticketData?.bonusWinningStats?.isMiniWofGamePlayed === false) {
                                module.exports.selectWofAuto(null, { 
                                    playerId: playerId, 
                                    gameId: gameId.toString(), 
                                    ticketId: ticket._id.toString(), 
                                    playerType: "Auto" 
                                });
                            }
                        } catch (error) {
                            console.log("Error in wheelOfFortune auto-play timer:", error);
                            // Try to continue processing even on error
                            setImmediate(() => module.exports.scheduleExtraWinnings(gameId));
                        }
                    }, timeInterval);
                } catch (callbackError) {
                    console.log("Error in processBonusWin callback:", callbackError);
                    setImmediate(() => module.exports.scheduleExtraWinnings(gameId));
                }
            }, 2000);
        } catch (error) {
            console.log("Error in processBonusWin:", error);
            setImmediate(() => module.exports.scheduleExtraWinnings(gameId));
        }
    },

    // Helper functions for processing Regular Winning
    processRegularWin: async function(ticket, gameId, timerKey, isBotGame) {
        try {
            // Update ticket in Redis
            const updatedTicket = {
                ...ticket,
                bonusWinningStats: {
                    ...ticket.bonusWinningStats,
                    isMiniGamePlayed: true,
                    miniGameStatus: "Finished",
                    isJackpotWon: false
                }
            };
            
            // Save to Redis
            await saveTicketToRedis(gameId, ticket._id.toString(), updatedTicket);
            
            // Clear minigame_active lock from Redis
            await deleteRedisDataByTypeAndId('game5_tickets', `${gameId}_minigame_active`);
            
            // Schedule next ticket with minimal delay for bot games, slightly longer for real players
            const timeInterval = isBotGame ? 100 : 500;
            setGameTimer(timerKey, () => module.exports.scheduleExtraWinnings(gameId), timeInterval);
        } catch (error) {
            console.log("Error in processRegularWin:", error);
            setImmediate(() => module.exports.scheduleExtraWinnings(gameId));
        }
    },

    // Wheel of Fortune wheel data
    wheelOfFortuneData: async function (socket, data) {
        try {
            let language = data.language || "nor";
            
            // Get player data from MongoDB (rarely changes during gameplay)
            const player = await Sys.Game.Game5.Services.PlayerServices.getSingleData(
                { _id: data.playerId }, 
                { username: 1, selectedLanguage: 1 }
            );
            
            // Check if player exists
            if (!player) {
                return await createErrorResponse("player_not_found", language, 400, true);
            }
            
            // Use player's selected language for subsequent messages
            language = player.selectedLanguage;
            
            // Get game data from Redis
            const room = await getGameDataFromRedis('game5', data.gameId);

             // Check if room exists
             if (!room) {
                return await createErrorResponse("game_not_found", language, 400, true);
            }

            // Check if game is finished
            if (!room.otherData || room.otherData.gameInterState !== "Finished") {
                return await createErrorResponse("game_not_finished", language, 400, true);
            }
            
            // Extract winning multipliers
            const winningMultipliers = room.winners && room.winners.length > 0 
                ? room.winners.map(winner => winner.pattern.multiplier)
                : [];
            
            return await createSuccessResponse({
                prizeList: room.otherData.wofWinnings,
                redMultiplierValue: 2,
                blackMultiplierValue: 4,
                greenMultiplierValue: 50,
                winningMultipliers
            }, 'Game 5 WheelOfFortuneData..!!', language, false);
        } catch (error) {
            console.log("Error in wheel of fortune data", error);
            return await createErrorResponse("something_went_wrong", language, 500, true);
        }
    },

    // Process Auto/User action for Wheel of Fortune event
    selectWofAuto: async function (socket, data) {
        try {
            // Destructure with defaults in one step for better efficiency
            const { playerId, gameId, ticketId, language = "nor" } = data;

            // Get game data, player data, and ticket data in parallel
            let [room, player, ticket] = await Promise.all([
                getGameDataFromRedis('game5', gameId),
                Sys.Game.Game5.Services.PlayerServices.getSingleData(
                    { _id: playerId }, 
                    { username: 1, selectedLanguage: 1 }
                ),
                getTicketFromRedis(gameId, ticketId)
            ]);
            
            // Validate required data
            if (!player) {
                return await createErrorResponse("player_not_found", language, 400, true);
            }

            if (!room) {
                return await createErrorResponse("game_not_found", player.selectedLanguage, 400, true);
            }

            if (room.player && room.player.id !== playerId) {
                return await createErrorResponse("game5_not_authorized", player.selectedLanguage, 400, true);
            }

            if (!ticket) {
                return await createErrorResponse("game_5_ticket_not_found", player.selectedLanguage, 400, true);
            }

            // Check if ticket qualifies for wheel of fortune
            const { winningStats, bonusWinningStats } = ticket;
            const patternName = winningStats?.patternWon?.patternName || "";
            const isJackpotPattern = patternName.startsWith("Jackpot_");
            
            if (isJackpotPattern || !bonusWinningStats || bonusWinningStats.isMiniWofGamePlayed) {
                return await createErrorResponse("something_went_wrong", player.selectedLanguage, 400, true);
            }

            // Check and update using Redis to avoid race conditions
            const updateResult = await updateNestedFieldConditionally(
                'game5_tickets', 
                `${gameId}_${ticketId}`, 
                'bonusWinningStats.isMiniWofGamePlayed',
                {
                    condition: 'falsy', // Only proceed if the field is falsy (false, nil, 0)
                    newValue: true
                }
            );
           
            if (!updateResult.status) {
                if (updateResult.reason === "CONDITION_NOT_MET") {
                    return await createErrorResponse("wof_already_sppined", player.selectedLanguage, 400, true);
                } else {
                    return await createErrorResponse("wof_already_sppined", player.selectedLanguage, 500, true);
                }
            }
            
            // Get the latest ticket data after the atomic update
            ticket = await getTicketFromRedis(gameId, ticketId);
           
            // Select winning spins using probability distribution
            const wofWinnings = selectNumberWithProbablility({ 3: 60, 4: 20, 5: 12, 6: 5, 10: 3 });

            // Create an updated ticket object based on the current ticket
            const updatedTicket = {
                ...ticket,
                bonusWinningStats: {
                    ...ticket.bonusWinningStats,
                    wofWinnings: { wofSpins: +wofWinnings, playedSpins: 0 }
                }
            };

            await saveTicketToRedis(gameId, ticketId, updatedTicket);
            
            // Update game data in Redis - add wofSpins to winner info
            if (room.winners) {
                const updatedWinners = room.winners.map(winner => {
                    if (winner.ticketId === ticketId) {
                        return { ...winner, wofSpins: +wofWinnings };
                    }
                    return winner;
                });
                
                room.winners = updatedWinners;
                await saveGameDataToRedis('game5', gameId, room);
            }
            
            // Emit event to start spinning the wheel
            Sys.Io.of(Sys.Config.Namespace.Game5).to(gameId).emit('startSpinWheel', {
                gameId,
                ticketId,
                freeSpins: wofWinnings,
                miniGameType: "wheelOfFortune"
            });

            // Set up timer for transitioning to roulette game
            const timerKey = `${gameId}_sch_extra_timer`;
            const timeInterval = room.otherData.isBotGame ? 100 : 10000;

            setGameTimer(timerKey, async () => {
                try {
                    // Get latest ticket data from Redis
                    const currentTicket = await getTicketFromRedis(gameId, ticketId);
                    
                    // If ticket not in Redis, get from MongoDB
                    if (!currentTicket) {
                        await Sys.Game.Game5.Services.GameServices.updateTicket(
                            { _id: ticketId },
                            { $set: { 'bonusWinningStats.isMiniWofFinished': true } }
                        );
                    } else {
                        // Update in Redis
                        currentTicket.bonusWinningStats.isMiniWofFinished = true;
                        await saveTicketToRedis(gameId, ticketId, currentTicket);
                    }
                    
                    // Schedule roulette game 
                    setImmediate(() => module.exports.scheduleRouletteGame({ 
                        gameId: gameId.toString(), 
                        ticketId: ticketId.toString() 
                    }));
                } catch (error) {
                    console.log("Error in WoF timer callback:", error);
                    // Continue to next phase even if there's an error
                    setImmediate(() => module.exports.scheduleRouletteGame({ 
                        gameId: gameId.toString(), 
                        ticketId: ticketId.toString() 
                    }));
                }
            }, timeInterval);

            return await createSuccessResponse(
                { freeSpins: wofWinnings },
                'Game 5 WheelOfFortuneData Winner Amount ..!!',
                player.selectedLanguage,
                false
            );
        } catch (error) {
            console.log("Error in selectWofAuto Game5:", error);
            // Return generic error and log the specific issue
            return await createErrorResponse("something_went_wrong", data.language || "nor", 500, true);
        }
    },

    // Roulette game initial setup
    scheduleRouletteGame: async function (data) {
        try {
            const { gameId, ticketId } = data;
            
            // Get game data and ticket data in parallel
            const [room, ticket] = await Promise.all([
                getGameDataFromRedis('game5', gameId),
                getTicketFromRedis(gameId, ticketId)
            ]);
            
            // Validate required data
            if (!room) {
                return await createErrorResponse("Game Not Found!", "en", 400, false);
            }
            
            if (!ticket) {
                return await createErrorResponse("Ticket Not Found!", "en", 400, false);
            }
            
            // Check if ticket has available spins for roulette
            if (!ticket.bonusWinningStats?.wofWinnings?.wofSpins > 0) {
                // No spins available, move to next ticket processing
                return;
            }
            
            // Create spin details for the roulette game
            const spinDetails = { 
                totalSpins: ticket.bonusWinningStats.wofWinnings.wofSpins, 
                playedSpins: ticket.bonusWinningStats.wofWinnings.playedSpins, 
                currentSpinNumber: (ticket.bonusWinningStats.wofWinnings.playedSpins + 1), 
                spinHistory: [] 
            };
            
            // Update ticket in Redis with roulette activation
            const updatedTicket = {
                ...ticket,
                bonusWinningStats: {
                    ...ticket.bonusWinningStats,
                    isMiniRouletteActivated: true,
                    miniRouletteGamestartTimeMs: Date.now(),
                    isMiniRouletteTimerRunning: true
                }
            };
            
            await saveTicketToRedis(gameId, ticketId, updatedTicket);
         
            // Emit event to activate mini game
            Sys.Io.of(Sys.Config.Namespace.Game5).to(gameId).emit('ActivateMiniGame', {
                gameId,
                playerId: room.player.id,
                ticketId: ticket._id.toString(),
                miniGameType: "roulette",
                ticketColor: ticket.ticketColorName,
                ticket: ticket.tickets,
                spinDetails,
                rouletteData: room.otherData.rouletteData
            });
            
            // Set timer for auto-play of first roulette spin
            const timerKey = `${gameId}_sch_extra_timer`;
            const timeInterval = room.otherData.isBotGame ? 100 : 10000;
            
            setGameTimer(timerKey, async () => {
                // Get latest ticket status from Redis
                const currentTicket = await getTicketFromRedis(gameId, ticketId);
                
                // Check if minigame is still active and not already played
                if (currentTicket?.bonusWinningStats?.isMiniWofGamePlayed && 
                    !currentTicket.bonusWinningStats.isMiniGamePlayed) {
                    // Start first spin of roulette game
                    setImmediate(() => module.exports.selectRouletteAuto(null, { 
                        playerId: room.player.id, 
                        gameId, 
                        ticketId, 
                        playerType: "Auto", 
                        spinCount: 1 
                    }));
                }
            }, timeInterval);
            
            return await createSuccessResponse(
                { activated: true },
                'Roulette game scheduled successfully',
                "en",
                false
            );
        } catch (error) {
            console.log("Error in scheduleRouletteGame:", error);
            // Try to continue to next ticket even on error
            setImmediate(() => module.exports.scheduleExtraWinnings(data.gameId));
            return await createErrorResponse("something_went_wrong", "en", 500, false);
        }
    },

    // Process Auto/User action for Roulette event
    selectRouletteAuto: async function (socket, data) {
        try {
            // Extract language with default fallback and destructure needed properties
            const { language = "nor", playerId, gameId, ticketId, spinCount } = data;
            
            // Get all required data in parallel
            let [room, player, ticket] = await Promise.all([
                getGameDataFromRedis('game5', gameId),
                Sys.Game.Game5.Services.PlayerServices.getSingleData(
                    { _id: playerId }, 
                    { username: 1, selectedLanguage: 1 }
                ),
                getTicketFromRedis(gameId, ticketId)
            ]);
            
            // Validate required data
            if (!player) {
                return await createErrorResponse("player_not_found", language, 400, true);
            }
            
            if (!room) {
                return await createErrorResponse("game_not_found", player.selectedLanguage, 400, true);
            }
            
            if (room.player && room.player.id !== playerId) {
                return await createErrorResponse("game5_not_authorized", player.selectedLanguage, 400, true);
            }
            
            if (!ticket) {
                return await createErrorResponse("game_5_ticket_not_found", player.selectedLanguage, 400, true);
            }
            
            // Check if ticket is eligible for roulette game
            if (!ticket.bonusWinningStats || 
                !ticket.bonusWinningStats.isMiniWofGamePlayed || 
                ticket.bonusWinningStats.isMiniGamePlayed) {
                return await createErrorResponse("Ticket not eligible for roulette", player.selectedLanguage, 400, false);
            }
            
            // Validate spin count
            const expectedSpinCount = +spinCount - 1;
            const updateResult = await updateNestedFieldConditionally(
                'game5_tickets', 
                `${gameId}_${ticketId}`, 
                'bonusWinningStats.wofWinnings.playedSpins',
                {
                    condition: 'eq',                // Check if the current value equals the expected value
                    expectedValue: expectedSpinCount,
                    incrementBy: 1                  // Increment the value by 1
                }
            );
            
            if (!updateResult.status) {
                if (updateResult.reason === "CONDITION_NOT_MET") {
                    return await createErrorResponse("roulette_game_played_count", player.selectedLanguage, 400, true);
                } else {
                    return await createErrorResponse("roulette_game_played_count", player.selectedLanguage, 409, true);
                }
            }

            // Fetch the updated ticket with new spin count
            ticket = await getTicketFromRedis(gameId, ticketId);

            // Get roulette outcome using helper function
            const { rouletteBall, rouletteWinnings } = await determineRouletteOutcome(
                room.otherData.rouletteData,
                ticket.ticketPrice
            );

            // Make sure history is an array
            if (!ticket.bonusWinningStats.history || !Array.isArray(ticket.bonusWinningStats.history)) {
                ticket.bonusWinningStats.history = [];
            }

            // Create history object
            const historyObj = {
                spinCount: spinCount,
                rouletteBall: rouletteBall,
                wonAmount: rouletteWinnings
            };
            
            // Update ticket in Redis
            ticket.bonusWinningStats.history = [...ticket.bonusWinningStats.history, historyObj];
            ticket.bonusWinningStats.finalWonAmount = (ticket.bonusWinningStats.finalWonAmount || 0) + rouletteWinnings;
            ticket.totalWinningOfTicket = (ticket.totalWinningOfTicket || 0) + rouletteWinnings;
           
            await saveTicketToRedis(gameId, ticketId, ticket);
            
            // Update game data in Redis if winners exist
            if (room.winners) {
                const updatedWinners = room.winners.map(winner => {
                    if (winner.ticketId === ticketId) {
                        const history = [...(winner.history || []), historyObj];
                        return { ...winner, history };
                    }
                    return winner;
                });
                
                room.winners = updatedWinners;
                await saveGameDataToRedis('game5', gameId, room);
            }
           
            // Check if all spins are completed
            const totalSpinsCompletedCount = ticket.bonusWinningStats.history.length;
            const isMinigameOver = totalSpinsCompletedCount >= ticket.bonusWinningStats.wofWinnings.wofSpins;
            
            // Emit event to start spinning the wheel
            Sys.Io.of(Sys.Config.Namespace.Game5).to(gameId).emit('startSpinWheel', {
                gameId,
                ticketId,
                playerId: room.player.id,
                ticketColor: ticket.ticketColorName,
                ticket: ticket.tickets,
                spinDetails: {
                    totalSpins: ticket.bonusWinningStats.wofWinnings.wofSpins,
                    playedSpins: totalSpinsCompletedCount,
                    currentSpinNumber: totalSpinsCompletedCount,
                    spinHistory: ticket.bonusWinningStats.history
                },
                miniGameType: "roulette",
                rouletteStopAt: rouletteBall,
                isMinigameOver: isMinigameOver
            });
            
            // Update ticket status in Redis
            ticket.bonusWinningStats.isMiniRouletteTimerRunning = false;
            ticket.bonusWinningStats.isMiniRouletteSpinning = true;
            ticket.bonusWinningStats.miniRouletteGameFinishTimeMs = Date.now();
            
            await saveTicketToRedis(gameId, ticketId, ticket);
            
            // Define timer key for next step
            const timerKey = `${gameId}_sch_extra_timer`;
            const timeInterval = room.otherData.isBotGame ? 100 : 10000;
            
            // Set timer for next action
            setGameTimer(timerKey, async () => {
                try {
                    if (isMinigameOver) {
                        // Process end of minigame
                        await module.exports.processMinigameEnd(gameId, ticketId, room, ticket);
                    } else {
                        // Schedule next spin
                        await module.exports.scheduleNextSpin(gameId, ticketId, playerId, room, spinCount, ticket);
                    }
                } catch (error) {
                    console.log("Error in roulette timer callback:", error);
                    // Attempt to continue processing even on error
                    setImmediate(() => module.exports.scheduleExtraWinnings(gameId));
                }
            }, timeInterval);
            
            return await createSuccessResponse(
                {
                    totalSpins: ticket.bonusWinningStats.wofWinnings.wofSpins,
                    playedSpins: totalSpinsCompletedCount,
                    currentSpinNumber: totalSpinsCompletedCount,
                    spinHistory: ticket.bonusWinningStats.history
                },
                'Game 5 roulette game Winner Amount ..!!',
                player.selectedLanguage,
                false
            );
        } catch (error) {
            console.log("Error in selectRouletteAuto:", error);
            return await createErrorResponse("An error occurred", "en", 500, false);
        }
    },

    // Helper function to process the end of a minigame and move to next ticket processing
    processMinigameEnd: async function (gameId, ticketId, room, ticket) {
        try {
            // Update ticket in Redis to mark as fully processed
            const updatedTicket = {
                ...ticket,
                bonusWinningStats: {
                    ...ticket.bonusWinningStats,
                    isMiniGamePlayed: true,
                    miniGameStatus: "Finished"
                }
            };
            
            await saveTicketToRedis(gameId, ticketId, updatedTicket);
           
            // Clear the minigame_active lock in Redis
            await deleteRedisDataByTypeAndId('game5_tickets', `${gameId}_minigame_active`);

            // Process winnings if any
            if (ticket.bonusWinningStats.finalWonAmount > 0) {
                const currentTicketWinningAmount = ticket.bonusWinningStats.finalWonAmount;
                
                // Update player with winnings
                const currentPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                    { _id: room.player.id },
                    {
                        $inc: {
                            walletAmount: currentTicketWinningAmount,
                            "statisticsgame5.totalWinning": currentTicketWinningAmount
                        }
                    }
                );
                
                if (currentPlayer) {
                    // Emit winning event
                    await Sys.Io.of(Sys.Config.Namespace.Game5)
                        .to("/Game5#" + currentPlayer.socketId)
                        .emit('rouletteWinnigs', {
                            gameId,
                            ticketId,
                            playerId: room.player.id,
                            totalWonAmount: currentTicketWinningAmount,
                            ticketColor: ticket.ticketColorName,
                            ticket: ticket.tickets
                        });
                    
                    // Create transaction record
                    const transactionDataSend = {
                        playerId: room.player.id,
                        gameId,
                        gameStartDate: room.startDate,
                        action: "credit",
                        purchasedSlug: "realMoney",
                        totalAmount: currentTicketWinningAmount,
                        previousBalance: currentPlayer.walletAmount - currentTicketWinningAmount,
                        afterBalance: currentPlayer.walletAmount,
                        ticketPrice: ticket.ticketPrice,
                        defineSlug: "GameWon",
                        extraSlug: "Game5",
                        transactionSlug: "game5Transactions",
                        typeOfTransaction: "Game 5 Roulette Prize",
                        remark: "Won Game 5 Roulette prize."
                    };
                    
                    // Process transaction in background
                    setImmediate(() => Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend));
                    Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                        type: "winning",
                        playerId: room.player.id,
                        hallId: '',
                        winning: currentTicketWinningAmount
                    });
                    await updatePlayerHallSpendingData({ playerId: room.player.id, hallId: '', amount: +currentTicketWinningAmount, type: 'normal', gameStatus: 3 });
                    // Update game with winnings in Redis
                    if (room) {
                        room.totalWinning = (room.totalWinning || 0) + currentTicketWinningAmount;
                        room.finalGameProfitAmount = (room.finalGameProfitAmount || 0) - currentTicketWinningAmount;
                        await saveGameDataToRedis('game5', gameId, room);
                    }
                    
                    // Update game in MongoDB in background
                    setImmediate(() => Sys.Game.Game5.Services.GameServices.updateSubgame(
                        { _id: gameId },
                        {
                            $inc: {
                                totalWinning: currentTicketWinningAmount,
                                finalGameProfitAmount: -currentTicketWinningAmount
                            }
                        }
                    ));
                    
                    // Send notifications for real player games
                    if (!room.otherData.isBotGame && currentPlayer.enableNotification) {
                        // Send roulette winning notification to player
                        setImmediate(() => 
                            sendGameNotification({
                                playerId: room.player.id,
                                gameId: room._id,
                                gameNumber: room.gameNumber,
                                totalWonAmount: currentTicketWinningAmount,
                                firebaseToken: currentPlayer.firebaseToken,
                                notificationType: 'roulette'
                            })
                        );
                    }
                }
            }
            
            // Mark roulette as finished and schedule processing other tickets
            setGameTimer(`${gameId}_sch_extra_timer`, async () => {
                try {
                    // Update ticket in Redis
                    const finalTicket = await getTicketFromRedis(gameId, ticketId);
                    if (finalTicket) {
                        finalTicket.bonusWinningStats.isMiniRouletteFinished = true;
                        await saveTicketToRedis(gameId, ticketId, finalTicket);
                    }
                    // Move to next ticket processing
                    setImmediate(() => module.exports.scheduleExtraWinnings(gameId));
                } catch (error) {
                    console.log("Error in processMinigameEnd timer:", error);
                    // Continue to next ticket even on error
                    setImmediate(() => module.exports.scheduleExtraWinnings(gameId));
                }
            }, 2000);
        } catch (error) {
            console.log("Error in processMinigameEnd:", error);
            // Try to continue to next ticket even on error
            setImmediate(() => module.exports.scheduleExtraWinnings(gameId));
        }
    },

    // Helper function to schedule the next spin of roulette game
    scheduleNextSpin: async function (gameId, ticketId, playerId, room, spinCount, ticket) {
        try {
            // Update ticket timer status in Redis
            ticket.bonusWinningStats.miniRouletteGamestartTimeMs = Date.now();
            ticket.bonusWinningStats.isMiniRouletteSpinning = false;
            ticket.bonusWinningStats.isMiniRouletteTimerRunning = true;
            
            await saveTicketToRedis(gameId, ticketId, ticket);
           
            // Schedule next spin
            const nextSpinInterval = room.otherData.isBotGame ? 100 : 10000;
            
            setGameTimer(`${gameId}_sch_extra_timer`, async () => {
                // Verify ticket is still active from Redis
                const currentTicket = await getTicketFromRedis(gameId, ticketId);
                
                if (currentTicket && currentTicket.bonusWinningStats.isMiniGamePlayed === false) {
                    // Call next spin
                    setImmediate(() => module.exports.selectRouletteAuto(null, {
                        playerId,
                        gameId,
                        ticketId,
                        playerType: "Auto",
                        spinCount: (+spinCount + 1)
                    }));
                }
            }, nextSpinInterval);
        } catch (error) {
            console.log("Error in scheduleNextSpin:", error);
            // Try to continue anyway
            setImmediate(() => module.exports.selectRouletteAuto(null, {
                playerId,
                gameId,
                ticketId,
                playerType: "Auto",
                spinCount: (+spinCount + 1)
            }));
        }
    },

    // Check if mini game is finished
    checkMiniGameFinished: async function (gameId) {
        try {
            // Get game data from Redis
            const room = await getGameDataFromRedis('game5', gameId);
            
            // Calculate profit percentage
            const profitPercentage = +parseFloat((room.finalGameProfitAmount / room.earnedFromTickets) * 100).toFixed(2);
        
            room.status = "Finished";
            room.otherData.profitPercentage = profitPercentage;
            await saveGameDataToRedis('game5', gameId, room);
            
            // Sync all Redis data to MongoDB
            await syncGameToMongoDB(gameId, true);

            cleanTimeAndData(`${gameId}_timer`, gameId);

            // Get player socket ID for emitting event
            const currentPlayer = await Sys.Game.Game5.Services.PlayerServices.getSingleData(
                { _id: room.player.id }, 
                { socketId: 1 }
            );
            
            // Emit total winnings to player
            await Sys.Io.of(Sys.Config.Namespace.Game5).to("/Game5#" + currentPlayer.socketId).emit('totalGameWinnings', {
                gameId,
                playerId: room.player.id,
                totalWonAmount: room.totalWinning || 0,
            });
            
            // Handle bot game completion
            if (room.otherData.isBotGame === true) {
                console.log("Bot game 5 completed with winnings");
                await Sys.App.Services.GameService.updateGameData(
                    { _id: room.parentGameId }, 
                    { $inc: { 'otherData.totalBotGamePlayed': 1 } }
                );
                Sys.Game.Game5.Controllers.GameController.checkForBotGame5({ action: "gameFinished" });
            }
            
            // Check break time if game is finished
            await Sys.Game.Common.Controllers.PlayerController.checkBreakTimeOnGameFinished(room.player.id, "Game5");
            
            return {
                status: "success"
            };
        } catch (error) {
            console.log("Error in checkMiniGameFinished:", error);
            return await createErrorResponse("something_went_wrong", "en", 500, false);
        }
    },

}