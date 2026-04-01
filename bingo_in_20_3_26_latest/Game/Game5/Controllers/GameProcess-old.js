let Sys = require('../../../Boot/Sys.js');
const exactMath = require('exact-math');
const { translate } = require('../../../Config/i18n.js');
const { createErrorResponse, createSuccessResponse } = require('../../../gamehelper/all.js');
const { 
    getAvailableBalls, 
    getRandomBall, 
    getBallColor, 
    selectNumberWithProbablility, 
    determineRouletteOutcome, 
    sendGameNotification, 
    setGameTimer, 
    cleanTimeAndData
} = require('../../../gamehelper/game5.js');

module.exports = {

    startGame: async function (gameId) {
        try {
            console.log("Start game called.", gameId);
            const language = "en";
            // Define the update document with all needed fields
            const updateDoc = {
                status: "Running", 
                'otherData.gameInterState': "Running", 
                withdrawNumberArray: [], 
                history: [], 
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
            
            // If we got here, the game was successfully updated, so start gameplay
            module.exports.gamePlay(gameId.toString());
        } catch (error) {
            console.log("Error in start game", error);
            return await createErrorResponse("Something went wrong.", language, 500, false);
        }
    },

    gamePlay: async function (gameId) {
        try {
            const timerKey = `${gameId}_timer`;
            const dataKey = `${gameId}_data`;
    
            let gameData = Sys.Game5Timers[dataKey];
    
            if (!gameData) {
                // Get only the necessary fields for gameplay
                const room = await Sys.Game.Game5.Services.GameServices.getSingleSubgameData(
                    { _id: gameId },
                    { withdrawNumberArray: 1, otherData: 1, seconds: 1, withdrawableBalls: 1 }
                );
                
                if (!room) {
                    console.log("Error: Game not found for gamePlay", gameId);
                    return;
                }
                
                gameData = {
                    _id: room._id,
                    withdrawNumberArray: [...room.withdrawNumberArray],
                    withdrawableBalls: room.withdrawableBalls,
                    seconds: room.seconds,
                    isBotGame: room.otherData?.isBotGame || false,
                    botSeconds: room.otherData?.botSeconds || 0,
                    history: [],
                    availableBalls: getAvailableBalls(room.withdrawNumberArray, 36)
                };
                
                Sys.Game5Timers[dataKey] = gameData;
            }

            // Check if we've reached the maximum number of balls or have no balls left
            if (gameData.withdrawNumberArray.length >= gameData.withdrawableBalls || 
                gameData.availableBalls.length === 0) {
                cleanTimeAndData(timerKey, dataKey);
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
    
            // Update memory data in one block
            gameData.withdrawNumberArray.push(withdrawBall);
            gameData.history.push(historyObj);
            gameData.availableBalls = gameData.availableBalls.filter(n => n !== withdrawBall);
    
            // Emit event to clients
            Sys.Io.of(Sys.Config.Namespace.Game5).to(gameData._id).emit('WithdrawBingoBall', historyObj);
    
            // Update database
            await Sys.Game.Game5.Services.GameServices.updateSubgame(
                { _id: gameData._id },
                {
                    $push: {
                        withdrawNumberArray: withdrawBall,
                        history: historyObj
                    }
                }
            );
    
            // Check if we've reached the maximum after adding this ball
            if (gameData.withdrawNumberArray.length >= gameData.withdrawableBalls) {
                cleanTimeAndData(timerKey, dataKey);
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
                    cleanTimeAndData(timerKey, dataKey);
                    setImmediate(() => module.exports.checkForWinners(gameId));
                }
            }, withdrawTime);
    
        } catch (error) {
            console.log("Error in gamePlay--", error);
            // Try to recover on error by moving to winner check stage      
            cleanTimeAndData(`${gameId}_timer`, `${gameId}_data`);
            setImmediate(() => module.exports.checkForWinners(gameId));
        }
    },
    
    checkForWinners: async function (gameId) {
        try {
            // Clean up the timer and data
            cleanTimeAndData(`${gameId}_timer`, `${gameId}_data`);
            
            // Get game data and update state in a single call to prevent race conditions
            const room = await Sys.Game.Game5.Services.GameServices.updateSubgame(
                { 
                    _id: gameId,
                    $or: [
                        { status: { $ne: "Finished" } },
                        { "otherData.gameInterState": { $ne: "Finished" } }
                    ]
                },
                { $set: { 'otherData.gameInterState': "Finished" } },
                { 
                    projection: { player: 1, status: 1, withdrawNumberArray: 1, allPatternArray: 1, otherData: 1 },
                    new: true // Return the updated document
                }
            );
            
            if (!room) {
                return createErrorResponse('Game Not Found or already Finished!', language, 400, false);
            }
            
            // Sort patterns by multiplier in descending order for optimal matching
            const winningPatterns = [...room.allPatternArray].sort((a, b) => b.multiplier - a.multiplier);
            
            // Get all purchased tickets for this game
            const tickets = await Sys.Game.Game5.Services.GameServices.getTicketsByData(
                { gameId: gameId, isPurchased: true }, 
                { ticketPrice: 1, tickets: 1 }
            );
            
            // Process tickets in parallel for better performance
            if (tickets && tickets.length > 0) {
                const ticketUpdatePromises = tickets.map(async (ticketData) => {
                    const ticket = ticketData.tickets;
                    
                    // Find the first winning pattern for this ticket
                    for (const pattern of winningPatterns) {
                        let patternWon = true;
                        
                        if (pattern.patternElement.length > 0) {
                            // Check each position in the pattern
                            for (let w = 0; w < pattern.pattern.length; w++) {
                                if (pattern.pattern[w] === 1 && !room.withdrawNumberArray.includes(ticket[w])) {
                                    patternWon = false;
                                    break;
                                }
                            }
                        } else {
                            // Check if any ticket number is in withdrawn numbers
                            const intersection = ticket.filter(element => room.withdrawNumberArray.includes(element));
                            if (intersection.length > 0) {
                                patternWon = false;
                            }
                        }
                        
                        if (patternWon) {
                            const wonAmount = Math.round(exactMath.mul(ticketData.ticketPrice, pattern.multiplier));
                            
                            // Update ticket with winning information
                            return Sys.Game.Game5.Services.GameServices.updateTicket(
                                { _id: ticketData._id },
                                {
                                    isPlayerWon: true,
                                    totalWinningOfTicket: wonAmount,
                                    'winningStats.patternWon': pattern,
                                    'winningStats.finalWonAmount': wonAmount,
                                    'bonusWinningStats.isMiniWofGamePlayed': false,
                                    'bonusWinningStats.isMiniWofActivated': false,
                                    'bonusWinningStats.miniWofGamestartTimeMs': Date.now(),
                                    'bonusWinningStats.isMiniWofFinished': false,
                                    'bonusWinningStats.isMiniGamePlayed': false,
                                    'bonusWinningStats.wofWinnings': {},
                                    'bonusWinningStats.history': [],
                                    'bonusWinningStats.finalWonAmount': 0,
                                    'bonusWinningStats.miniGameStatus': "Active",
                                    'bonusWinningStats.isMiniRouletteActivated': false,
                                    'bonusWinningStats.miniRouletteGamestartTimeMs': Date.now(),
                                    'bonusWinningStats.isMiniRouletteFinished': false,
                                    'bonusWinningStats.isMiniRouletteTimerRunning': false,
                                    'bonusWinningStats.isMiniRouletteSpinning': false,
                                    'bonusWinningStats.miniRouletteGameFinishTimeMs': Date.now()
                                }
                            );
                            
                            // Break after finding first winning pattern
                            break;
                        }
                    }
                    
                    // No winning pattern found for this ticket
                    return null;
                });
                
                // Wait for all ticket updates to complete
                await Promise.all(ticketUpdatePromises);
            }
            
            // Non-blocking transition to game finished state
            setImmediate(() => module.exports.gameFinished(gameId));
            
        } catch (error) {
            console.log("Error in checkForWinners", error);
            return createErrorResponse('Error checking for winners',  language, 500, false);
        }
    },

    gameFinished: async function (gameId) {
        try {
            // Clean up the timer and data
            cleanTimeAndData(`${gameId}_timer`, `${gameId}_data`);
             
            // Fetch game data, player info
            const room = await Sys.Game.Game5.Services.GameServices.getSingleSubgameData(
                { _id: gameId }, 
                { player: 1, status: 1, withdrawNumberArray: 1, allPatternArray: 1, otherData: 1, gameNumber: 1, startDate: 1, parentGameId: 1, earnedFromTickets: 1, finalGameProfitAmount: 1 }
            );
        
            if (!room) {
                return await createErrorResponse("Game Not Found!", language, 400, false);
            }
            
            // Check if game is already finished - early return
            if (room.status === "Finished") {
                return await createErrorResponse("game_finished", language, 400);
            }

            const player = await Sys.Game.Game5.Services.PlayerServices.getSingleData({ _id: room.player.id }, { selectedLanguage: 1 })
            
            // Use player's language if available, otherwise default to Norwegian
            const language = player?.selectedLanguage || "nor";
            
            // Start update and ticket fetch operations in parallel
            const [tickets] = await Promise.all([
                // Fetch winning tickets
                Sys.Game.Game5.Services.GameServices.getTicketsByData(
                    { gameId: gameId }, 
                    { isPlayerWon: 1, totalWinningOfTicket: 1, 'winningStats.patternWon': 1, ticketColorName: 1, '_id': 1 }
                ),
                // Update game state to Finished
                Sys.Game.Game5.Services.GameServices.updateSubgame(
                    { _id: gameId }, 
                    { $set: { 'otherData.gameInterState': "Finished" } }, 
                    { new: true }
                )
            ]);
            // Process winning tickets
            const winningPatterns = [];
            let totalWonAmount = 0;
            const winningMultiplier = [];
            
            if (tickets && tickets.length > 0) {
                for (const ticket of tickets) {
                    if (ticket.isPlayerWon) {
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
            
            // Log winning information
            console.log("winnings of game 5", gameId, JSON.stringify({
                winningPatterns,
                totalWonAmount
            }));
            
            // Handle winning or non-winning scenarios
            if (winningPatterns.length > 0) {
                // Update game with winners
                Sys.Game.Game5.Services.GameServices.updateSubgame(
                    { _id: gameId },
                    {
                        $set: { winners: winningPatterns },
                        $inc: { totalWinning: totalWonAmount, finalGameProfitAmount: -totalWonAmount }
                    }, 
                    { new: true }
                )

                const currentPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                    { _id: room.player.id }, 
                    { $inc: { 
                        walletAmount: totalWonAmount, 
                        "statisticsgame5.totalGames": 1, 
                        "statisticsgame5.totalGamesWin": 1, 
                        "statisticsgame5.totalWinning": totalWonAmount 
                    }}
                )
               
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
                        playerId: room.player.id,
                        gameId: room._id,
                        gameStartDate: room.startDate,
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
                    
                    // Create transaction asynchronously but don't wait for it
                    Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);
                    
                    
                    // Handle notifications for real player games
                    if (!room.otherData.isBotGame) {
                        console.log("Real player winnings");
                        
                        if (currentPlayer.enableNotification) {
                            // Process notifications
                            sendGameNotification({
                                playerId: room.player.id,
                                gameId: gameId,
                                gameNumber: room.gameNumber,
                                totalWonAmount: totalWonAmount,
                                winningMultiplier: winningMultiplier,
                                firebaseToken: currentPlayer.firebaseToken,
                                notificationType: 'pattern'
                            });
                        }
                    }
                    
                    // Schedule extra winnings
                    const timerKey = `${gameId}_sch_extra_timer`;
                    
                    // Clear any existing timer with this key
                    cleanTimeAndData(timerKey);
                    
                    // Set the appropriate time interval based on game type
                    const timeInterval = room.otherData.isBotGame ? 100 : 4000;
                    
                    // Schedule the extra winnings with the unique timer key
                    setGameTimer(timerKey, async () => {
                        try {
                            module.exports.scheduleExtraWinnings(gameId);
                        } catch (error) {
                            console.log("Error in scheduleExtraWinnings timer:", error);
                            // Try again on error
                            setImmediate(() => module.exports.scheduleExtraWinnings(gameId));
                        }
                    }, timeInterval);
                }
            } else {
                // Handle non-winning scenario
                const profitPercentage = +parseFloat((room.finalGameProfitAmount / room.earnedFromTickets) * 100).toFixed(2);
                
                // Update game and player in parallel
                const [subGameUpdate, updatedPlayer] = await Promise.all([
                    Sys.Game.Game5.Services.GameServices.updateSubgame(
                        { _id: gameId }, 
                        { $set: { status: "Finished", 'otherData.profitPercentage': profitPercentage } }, 
                        { new: true }
                    ),
                    Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                        { _id: room.player.id }, 
                        { $inc: { "statisticsgame5.totalGames": 1, "statisticsgame5.totalGamesLoss": 1 } }
                    )
                ]);
                
                // Emit game finish event
                await Sys.Io.of(Sys.Config.Namespace.Game5).to("/Game5#" + updatedPlayer.socketId).emit('GameFinish', {
                    gameId,
                    winningPatterns,
                    totalWonAmount,
                    isWon: false
                });
                
                // Handle bot game completion
                if (room.otherData.isBotGame) {
                    console.log("Bot game 5 completed without winning");
                    await Sys.App.Services.GameService.updateGameData(
                        { _id: room.parentGameId }, 
                        { $inc: { 'otherData.totalBotGamePlayed': 1 } }
                    );
                    Sys.Game.Game5.Controllers.GameController.checkForBotGame5({ action: "gameFinished" });
                }
                
                // Check break time if game is finished
                if (subGameUpdate.status === "Finished") {
                    console.log('check checkBreakTimeOnGameFinished game5', room.player.id);
                    await Sys.Game.Common.Controllers.PlayerController.checkBreakTimeOnGameFinished(room.player.id, "Game5");
                }
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
            return await createErrorResponse("something_went_wrong", "en", 500);
        }
    },

    scheduleExtraWinnings: async function (gameId) {
        try {
            // Get required game and player data
            // Fetch game data and player language in parallel
            const [room, isMiniGameRunning] = await Promise.all([
                Sys.Game.Game5.Services.GameServices.getSingleSubgameData(
                    { _id: gameId }, 
                    { player: 1, status: 1, startDate: 1, gameNumber: 1, otherData: 1 }
                ),
                Sys.Game.Game5.Services.GameServices.getSingleSubgameData(
                    { gameId: gameId, isPurchased: true, 'bonusWinningStats.miniGameStatus': { $in: ["Active", "Running"] } }, 
                    { ticketColorName: 1 }
                )
            ]);
            
            if (!room) {
                return await createErrorResponse("Game Not Found!", language, 400, false);
            }
            
            // Get player language for response messages
            const playerId = room.player.id;
            const playerLang = await Sys.Game.Game5.Services.PlayerServices.getSingleData(
                { _id: playerId }, 
                { selectedLanguage: 1 }
            );
            const language = playerLang?.selectedLanguage || "nor";
            
            // Check if a minigame is already running for this game
            if (isMiniGameRunning) {
                return {
                    status: 'fail',
                    message: await translate({ key: "minigame_already_running", language: language })
                };
            }
            
            // Find the next eligible winning ticket for bonus games
            const ticket = await Sys.Game.Game5.Services.GameServices.getSingleTicketData(
                { 
                    gameId: gameId, 
                    isPurchased: true, 
                    isPlayerWon: true, 
                    'bonusWinningStats.isMiniWofGamePlayed': false, 
                    'bonusWinningStats.isMiniGamePlayed': false 
                }, 
                { ticketPrice: 1, tickets: 1, ticketColorName: 1, winningStats: 1 }
            );
            
            if (!ticket) {
                // No eligible tickets left, mark the game as finished
                return module.exports.checkMiniGameFinished(gameId);
            }
            
            // Mark the ticket as being processed
            await Sys.Game.Game5.Services.GameServices.updateTicket(
                { _id: ticket._id }, 
                { 'bonusWinningStats.miniGameStatus': "Running" }, 
                { new: true }
            );
            
            // Define the timer key for this operation
            const timerKey = `${gameId}_sch_extra_timer`; // `${gameId}_${ticket._id}_timer`;
            
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
                await module.exports.processBonusWin(ticket, gameId, playerId, timerKey, room);
            } 
            else {
                // Handle regular pattern wins - no extra games
                await module.exports.processRegularWin(ticket, gameId, timerKey, room);
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
            // Update ticket status to mark as processed
            await Sys.Game.Game5.Services.GameServices.updateTicket(
                { _id: ticket._id }, 
                {
                    $set: {
                        'bonusWinningStats.isMiniGamePlayed': true,
                        'bonusWinningStats.miniGameStatus': "Finished",
                        'bonusWinningStats.isJackpotWon': true
                    }
                }, 
                { new: true }
            );
            
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
    processBonusWin: async function(ticket, gameId, playerId, timerKey, room) {
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

                    // Update ticket to mark wheel of fortune as activated
                    await Sys.Game.Game5.Services.GameServices.updateTicket(
                        { _id: ticket._id }, 
                        {
                            $set: {
                                'bonusWinningStats.isJackpotWon': false,
                                'bonusWinningStats.isMiniWofActivated': true,
                                'bonusWinningStats.miniWofGamestartTimeMs': Date.now()
                            }
                        }, 
                        { new: true }
                    );

                    // Set timer for auto-play of wheel of fortune if player doesn't interact
                    const timeInterval = room.otherData.isBotGame ? 100 : 10000;
                    
                    cleanTimeAndData(timerKey);
                    setGameTimer(timerKey, async () => {
                        try {
                            const ticketData = await Sys.Game.Game5.Services.GameServices.getSingleTicketData(
                                { _id: ticket._id }, 
                                { bonusWinningStats: 1 }
                            );
                            
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
    processRegularWin: async function(ticket, gameId, timerKey, room) {
        try {
            // Mark regular pattern win as completed without activating special games
            await Sys.Game.Game5.Services.GameServices.updateTicket(
                { _id: ticket._id }, 
                {
                    $set: {
                        'bonusWinningStats.isMiniGamePlayed': true,
                        'bonusWinningStats.miniGameStatus': "Finished",
                        'bonusWinningStats.isJackpotWon': false
                    }
                }, 
                { new: true }
            );
            
            // Schedule next ticket with minimal delay for bot games, slightly longer for real players
            const timeInterval = room.otherData.isBotGame ? 100 : 500;
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
            
            // Run player and room queries in parallel
            const [player, room] = await Promise.all([
                Sys.Game.Game5.Services.PlayerServices.getSingleData(
                    { _id: data.playerId }, 
                    { username: 1, selectedLanguage: 1 }
                ),
                Sys.Game.Game5.Services.GameServices.getSingleSubgameData(
                    { _id: data.gameId }, 
                    { winners: 1, status: 1, otherData: 1 }
                )
            ]);
            
            // Check if player exists
            if (!player) {
                return await createErrorResponse("player_not_found", language, 400, true);
            }
            
            // Use player's selected language for subsequent messages
            language = player.selectedLanguage;
            
            // Check if room exists
            if (!room) {
                return await createErrorResponse("game_not_found", language, 400, true);
            }
            
            // Check if game is finished
            if (room.otherData.gameInterState !== "Finished") {
                return await createErrorResponse("game_not_finished", language, 400, true);
            }
            
            // Extract winning multipliers
            const winningMultipliers = room.winners.length > 0 
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
            
            // Fetch player, game, and ticket data in parallel for efficiency
            const [player, room, ticket] = await Promise.all([
                Sys.Game.Game5.Services.PlayerServices.getSingleData({ _id: playerId }, { username: 1, selectedLanguage: 1 }),
                Sys.Game.Game5.Services.GameServices.getSingleSubgameData({ _id: gameId }, { player: 1, winners: 1, status: 1, otherData: 1 }),
                Sys.Game.Game5.Services.GameServices.getSingleTicketData({ _id: ticketId }, { winningStats: 1, bonusWinningStats: 1 })
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

            // Try to update the ticket - use atomic update operation
            const isUpdated = await Sys.Game.Game5.Services.GameServices.updateOneTicket(
                { _id: ticketId, "bonusWinningStats.isMiniWofGamePlayed": false },
                { $set: { 'bonusWinningStats.isMiniWofGamePlayed': true } },
                { new: true }
            );

            if (isUpdated && isUpdated.modifiedCount === 0) {
                return await createErrorResponse("wof_already_sppined", player.selectedLanguage, 400, true);
            }

            // Select winning spins using probability distribution
            const wofWinnings = selectNumberWithProbablility({ 3: 60, 4: 20, 5: 12, 6: 5, 10: 3 });

            // Update game and ticket data in parallel (non-blocking)
            await Promise.all([
                // Update winner info in the game
                Sys.Game.Game5.Services.GameServices.updateSubgame(
                    { _id: gameId },
                    { $set: { 'winners.$[current].wofSpins': +wofWinnings } },
                    { arrayFilters: [{ "current.ticketId": ticketId }], new: true }
                ),
                
                // Update ticket with wofWinnings
                Sys.Game.Game5.Services.GameServices.updateTicket(
                    { _id: ticketId },
                    { $set: { 'bonusWinningStats.wofWinnings': { wofSpins: +wofWinnings, playedSpins: 0 } } },
                    { new: true }
                )
            ]);

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
                    // Mark WoF as finished
                    await Sys.Game.Game5.Services.GameServices.updateTicket(
                        { _id: ticketId },
                        { $set: { 'bonusWinningStats.isMiniWofFinished': true } },
                        { new: true }
                    );
                    
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
            
            // Fetch room and ticket data in parallel
            const [room, ticket] = await Promise.all([
                Sys.Game.Game5.Services.GameServices.getSingleSubgameData(
                    { _id: gameId }, 
                    { player: 1, status: 1, otherData: 1 }
                ),
                Sys.Game.Game5.Services.GameServices.getSingleTicketData(
                    { 
                        gameId: gameId, 
                        isPurchased: true, 
                        isPlayerWon: true, 
                        'bonusWinningStats.isMiniGamePlayed': false 
                    }, 
                    { ticketPrice: 1, tickets: 1, ticketColorName: 1, winningStats: 1, bonusWinningStats: 1 }
                )
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
                //setImmediate(() => module.exports.scheduleExtraWinnings(gameId));
                return;
            }
            
            // Create spin details for the roulette game
            const spinDetails = { 
                totalSpins: ticket.bonusWinningStats.wofWinnings.wofSpins, 
                playedSpins: ticket.bonusWinningStats.wofWinnings.playedSpins, 
                currentSpinNumber: (ticket.bonusWinningStats.wofWinnings.playedSpins + 1), 
                spinHistory: [] 
            };
            
            // Emit event and update ticket status in parallel
            await Promise.all([
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
                }),
                
                // Update ticket status
                Sys.Game.Game5.Services.GameServices.updateTicket(
                    { _id: ticket._id }, 
                    {
                        $set: {
                            'bonusWinningStats.isMiniRouletteActivated': true,
                            'bonusWinningStats.miniRouletteGamestartTimeMs': Date.now(),
                            'bonusWinningStats.isMiniRouletteTimerRunning': true
                        }
                    }
                )
            ]);
            
            // Set timer for auto-play of first roulette spin
            const timerKey = `${gameId}_sch_extra_timer`;
            const timeInterval = room.otherData.isBotGame ? 100 : 10000;
            
            setGameTimer(timerKey, async () => {
                // Verify ticket status before starting auto play
                const ticketData = await Sys.Game.Game5.Services.GameServices.getSingleTicketData(
                    { _id: ticket._id }, 
                    { bonusWinningStats: 1 }
                );
                
                if (ticketData?.bonusWinningStats?.isMiniWofGamePlayed && 
                    !ticketData.bonusWinningStats.isMiniGamePlayed) {
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
            console.log("selectRouletteAuto called", data);
            // Extract language with default fallback and destructure needed properties
            const { language = "nor", playerId, gameId, ticketId, spinCount } = data;
            
            // Fetch player, game, and ticket data in parallel for efficiency
            const [player, room, ticket] = await Promise.all([
                Sys.Game.Game5.Services.PlayerServices.getSingleData(
                    { _id: playerId }, 
                    { username: 1, selectedLanguage: 1 }
                ),
                Sys.Game.Game5.Services.GameServices.getSingleSubgameData(
                    { _id: gameId }, 
                    { player: 1, winners: 1, status: 1, otherData: 1, startDate: 1, gameNumber: 1 }
                ),
                Sys.Game.Game5.Services.GameServices.getSingleTicketData(
                    { _id: ticketId }, 
                    { winningStats: 1, bonusWinningStats: 1, ticketPrice: 1, ticketColorName: 1, tickets: 1 }
                )
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
            
            // Update spin count using atomic update
            const isUpdated = await Sys.Game.Game5.Services.GameServices.updateOneTicket(
                { 
                    _id: ticketId, 
                    "bonusWinningStats.wofWinnings.playedSpins": +(+spinCount - 1) 
                },
                { 
                    $inc: { 'bonusWinningStats.wofWinnings.playedSpins': 1 } 
                },
                { new: true }
            );
            
            if (isUpdated && isUpdated.modifiedCount === 0) {
                return await createErrorResponse("roulette_game_played_count", player.selectedLanguage, 400, true);
            }
            
            // Get roulette outcome using helper function
            const { rouletteBall, rouletteWinnings } = await determineRouletteOutcome(
                room.otherData.rouletteData,
                ticket.ticketPrice
            );

            // Create history object
            const historyObj = {
                spinCount: spinCount,
                rouletteBall: rouletteBall,
                wonAmount: rouletteWinnings
            };
            
            // Update game and ticket data in parallel
            const [updatedTicket] = await Promise.all([
                // Update ticket with spin history and winnings
                Sys.Game.Game5.Services.GameServices.updateTicket(
                    { _id: ticketId },
                    {
                        $push: { 'bonusWinningStats.history': historyObj },
                        $inc: {
                            'bonusWinningStats.finalWonAmount': rouletteWinnings,
                            'totalWinningOfTicket': rouletteWinnings
                        }
                    },
                    { new: true }
                ),
                
                // Update game with spin history
                Sys.Game.Game5.Services.GameServices.updateSubgame(
                    { _id: gameId },
                    {
                        $push: { 'winners.$[current].history': historyObj }
                    },
                    { arrayFilters: [{ "current.ticketId": ticketId }] }
                )
            ]);
            
            // Check if all spins are completed
            const totalSpinsCompletedCount = updatedTicket.bonusWinningStats.history.length;
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
                    spinHistory: updatedTicket.bonusWinningStats.history
                },
                miniGameType: "roulette",
                rouletteStopAt: rouletteBall,
                isMinigameOver: isMinigameOver
            });
            
            // Update ticket status
            await Sys.Game.Game5.Services.GameServices.updateTicket(
                { _id: ticketId },
                {
                    $set: {
                        'bonusWinningStats.isMiniRouletteTimerRunning': false,
                        'bonusWinningStats.isMiniRouletteSpinning': true,
                        'bonusWinningStats.miniRouletteGameFinishTimeMs': Date.now()
                    }
                }
            );
            
            // Define timer key for next step
            const timerKey = `${gameId}_sch_extra_timer`;
            const timeInterval = room.otherData.isBotGame ? 100 : 10000;
            
            // Set timer for next action
            setGameTimer(timerKey, async () => {
                try {
                    console.log("isMinigameOver", isMinigameOver, ticket);
                    if (isMinigameOver) {
                        // Process end of minigame
                        await module.exports.processMinigameEnd(gameId, ticketId, room, ticket);
                    } else {
                        // Schedule next spin
                        console.log("scheduleNextSpin called", ticket);
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
                    spinHistory: updatedTicket.bonusWinningStats.history
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
            console.log("processMinigameEnd called", gameId, ticketId);
            // Mark the ticket as fully processed - use atomic update with consistent field format
            const finalTicket = await Sys.Game.Game5.Services.GameServices.updateTicket(
                { _id: ticketId, "bonusWinningStats.isMiniWofGamePlayed": true  },
                {
                    $set: {
                        'bonusWinningStats.isMiniGamePlayed': true,
                        'bonusWinningStats.miniGameStatus': "Finished"
                    }
                },
                { new: true }
            );

            // Process winnings if any
            if (finalTicket && finalTicket.bonusWinningStats.finalWonAmount > 0) {
                const currentTicketWinningAmount = finalTicket.bonusWinningStats.finalWonAmount;
                
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
                    
                    // Update game with winnings
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
                    await Sys.Game.Game5.Services.GameServices.updateTicket(
                        { _id: ticketId },
                        { $set: { 'bonusWinningStats.isMiniRouletteFinished': true } }
                    );
                    
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
            // Update ticket timer status
            await Sys.Game.Game5.Services.GameServices.updateTicket(
                { _id: ticket._id },
                {
                    $set: {
                        'bonusWinningStats.miniRouletteGamestartTimeMs': Date.now(),
                        'bonusWinningStats.isMiniRouletteSpinning': false,
                        'bonusWinningStats.isMiniRouletteTimerRunning': true
                    }
                }
            );
            // Schedule next spin
            const nextSpinInterval = room.otherData.isBotGame ? 100 : 10000;
            
            setGameTimer(`${gameId}_sch_extra_timer`, async () => {
                // Verify ticket is still active
                const ticketData = await Sys.Game.Game5.Services.GameServices.getSingleTicketData(
                    { _id: ticket._id },
                    { bonusWinningStats: 1 }
                );
                
                if (ticketData && ticketData.bonusWinningStats.isMiniGamePlayed === false) {
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
            console.log("checkMiniGameFinished called", gameId);
            
            // Get essential game data
            const room = await Sys.Game.Game5.Services.GameServices.getSingleSubgameData(
                { _id: gameId }, 
                { player: 1, status: 1, totalWinning: 1, otherData: 1, parentGameId: 1, earnedFromTickets: 1, finalGameProfitAmount: 1 }
            );
            
            if (!room) {
                return await createErrorResponse("Game Not Found!", "en", 400, false);
            }
            
            // Calculate profit percentage
            const profitPercentage = +parseFloat((room.finalGameProfitAmount / room.earnedFromTickets) * 100).toFixed(2);
            
            // Update game status to finished
            const subGameUpdate = await Sys.Game.Game5.Services.GameServices.updateSubgame(
                { _id: gameId }, 
                { $set: { status: "Finished", 'otherData.profitPercentage': profitPercentage } }, 
                { new: true }
            );
            
            // Check break time if game is finished
            if (subGameUpdate.status === "Finished") {
                console.log('check checkBreakTimeOnGameFinished game5', room.player.id);
                await Sys.Game.Common.Controllers.PlayerController.checkBreakTimeOnGameFinished(room.player.id, "Game5");
            }
            
            // Get player socket ID for emitting event
            const currentPlayer = await Sys.Game.Game5.Services.PlayerServices.getSingleData(
                { _id: room.player.id }, 
                { socketId: 1 }
            );
            
            // Emit total winnings to player
            await Sys.Io.of(Sys.Config.Namespace.Game5).to("/Game5#" + currentPlayer.socketId).emit('totalGameWinnings', {
                gameId,
                playerId: room.player.id,
                totalWonAmount: room.totalWinning,
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
            
            return {
                status: "success"
            };
        } catch (error) {
            console.log("Error in checkMiniGameFinished:", error);
            return await createErrorResponse("something_went_wrong", "en", 500, false);
        }
    },

}