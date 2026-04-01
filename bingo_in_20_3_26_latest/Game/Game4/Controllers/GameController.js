let Sys = require('../../../Boot/Sys');
let playBot = false;
const emitter = Sys.App.get('eventEmitter');
const moment = require('moment');
const { 
    isGameAvailableForVerifiedPlayer, 
    createErrorResponse, 
    createSuccessResponse,
    isPlayerVerified,
    getPlayerIp,
    checkPlayerSpending,
    checkGamePlayAtSameTime,
    updatePlayerHallSpendingData
} = require('../../../gamehelper/all.js');
const {
    createSubGame,
    createSubGameTickets,
    processPatterns,
    formatTickets,
    generateBallSequence,
    processTicketPurchase,
    processPatternWinners,
    handleTicketCloneOrUpdates,
    processVoucherCode,
    formatGamePlayResponse,
    calculateTotalWinnings,
    createWinningPatternNotification,
    checkPatternsForTicket,
    checkForRuningGame
} = require('../../../gamehelper/game4.js');
const { saveGameDataToRedis, deleteRedisDataByTypeAndId} = require('../../../gamehelper/game5.js');
const { isPlayerBlockedFromGame } = require('../../../gamehelper/player_common');

let timeInterval
emitter.on('game4botcheckup', async function (data) {
    console.log("game4botcheckup event triggered", data);
    clearInterval(timeInterval)
    clearTimeout(timeInterval)
    if (data.botPlay) {
        playBot = true
    }
    timeInterval = setInterval(function () {
        if (playBot) {
            Sys.Game.Game4.Controllers.GameController.Game4BotInjection().then(res => {
                console.log("Response from Game4BotInjection", res);
                if (res.status == "success") {
                    console.log("Keep Injecting");
                } else {
                    if (res.clear) {
                        playBot = false
                        clearInterval(timeInterval)
                        clearTimeout(timeInterval)
                        timeInterval = null
                    }
                }
            }).catch(err => {
                console.log("Error occured in bot injection", err);
                clearInterval(timeInterval)
                clearTimeout(timeInterval);
                timeInterval = null
            });

        } else {
            clearInterval(timeInterval)
            clearTimeout(timeInterval)
            timeInterval = null
        }
    }, 20000)
})

module.exports = {
    /**
     * This function is added as there is no event when player enters game 4 theme panel
     * This function will check if the player is verified or already approved to play the game
     * @param {Object} data - The data object which contains the playerId and language
     * @param {String} data.playerId - The playerId of the player
     * @param {String} data.language - The language of the player (Default is nor)
     */
    isGameAvailbaleForVerifiedPlayer: async function(socket, { playerId, language = 'nor' }) {
        try {
            // Use the directly imported helper function
            return await isGameAvailableForVerifiedPlayer({
                playerId,
                language,
                PlayerServices: Sys.Game.Game4.Services.PlayerServices,
                GameServices: Sys.Game.Game4.Services.GameServices,
                gameType: "game_4",
                socket
            });
        } catch (error) {
            console.error("Error in isGameAvailbaleForVerifiedPlayer:", error);
            return await createErrorResponse('something_went_wrong', language, 500);
        }
    },

    // [ Ticket List with Pattern List ]
    Game4Data: async function (socket, data) {
        try {console.log("Game 4 Data---", data)
            // Destructure data and set defaults
            const { playerId, language = "nor" } = data;
            
            // Validate playerId
            if (!playerId) {
                return await createErrorResponse("playerid_not_found", language, 400);
            }

            // Fetch player and game data in parallel
            const [player, gameData] = await Promise.all([
                Sys.Game.Game4.Services.PlayerServices.getSingleData(
                    { _id: playerId }, 
                    { userType: 1, uniqueId: 1, isCreatedByAdmin: 1, agentId: 1, selectedLanguage: 1, 
                      bankIdAuth: 1, isVerifiedByHall: 1, isAlreadyApproved: 1 }
                ),
                Sys.Game.Game4.Services.GameServices.getSingleGameData(
                    { gameType: 'game_4' }, 
                    { gameName: 1, gameType: 1, gameTypeId: 1, ticketPrice: 1, totalNoTickets: 1,
                      patternNamePrice: 1, seconds: 1, seconds2: 1, day: 1, createrId: 1, 
                      betData: 1, otherData: 1, startDate: 1, endDate: 1, days: 1 }
                )
            ]);
            
            // Validate player and game
            if (!player) return await createErrorResponse("player_not_found", language, 400);
            if (!gameData) return await createErrorResponse("game_not_found", player.selectedLanguage || language, 400);
            
            const playerLanguage = player.selectedLanguage || language;
            const isBot = player.userType === "Bot";
            
            // Verify player (skip for bots)
            if (!isBot && !(isPlayerVerified(player))) {
                return await createErrorResponse("verify_to_play_game", playerLanguage, 400);
            }

            // Check game availability for non-bot players
            if (!isBot) {
                const gameStatus = await Sys.Game.Common.Controllers.GameController.closeDayValidation({
                    otherData: gameData.otherData,
                    startDate: gameData.startDate,
                    endDate: gameData.endDate,
                    days: gameData.days
                });
                
                if (!gameStatus || gameStatus.status !== "Open") {
                    return await createErrorResponse("game_closed", playerLanguage, 400);
                }

                // Check for running subgame for this player
                const runningGameData = await checkForRuningGame({
                    playerId,
                    socket,
                    patternNamePrice: gameData.patternNamePrice,
                    betData: gameData.betData
                });
               
                if (runningGameData && runningGameData.status === "running") {
                    return await createSuccessResponse(runningGameData, 'Running Game4 Found!', playerLanguage, false);
                }
            }
            
            // Check for existing subgame for this player
            let subGameData = await Sys.App.Services.GameService.getSingleSubGameData(
                {gameType: 'game_4', 'otherData.playerId': playerId, status: "active"}, 
                {_id: 1, seconds: 1, seconds2: 1, gameNumber: 1}
            );
    
            // if subgame data is not found for current player, create new subgame
            if (!subGameData) {
                subGameData = await createSubGame(gameData, player, playerId);
                await createSubGameTickets(subGameData, player);
                console.log("ticket creation completed")
            }
            
            // Join socket room for non-bot players
            if (!isBot) {
                socket.join(subGameData._id);
                socket.myData = {
                    playerID: playerId,
                    gameId: subGameData._id,
                    gameType: 'game_4',
                    gameName: 'Spillorama'
                };
            }

            // Get tickets and patterns in parallel
            const [tickets, patterns] = await Promise.all([
                Sys.Game.Game4.Services.GameServices.getTicketByData(
                    { gameId: subGameData._id }, 
                    { _id: 1, tickets: 1 }
                ),
                Sys.App.Services.patternServices.getPatternsByData({ gameType: 'game_4' }, {_id: 1, patternType: 1, patternName: 1, count: 1}, {sort: {count: 1}})
            ]);
            console.log("tickets----", tickets)
            // Format tickets and patterns
            const ticketData = formatTickets(tickets);

            // Process patterns using helper
            const patternListData = processPatterns(patterns, gameData.patternNamePrice[0]);
            
            // Return success response
            return await createSuccessResponse({
                status: "active",
                patternList: patternListData,
                ticketList: ticketData,
                ticketPrice: gameData.ticketPrice,
                betData: gameData.betData,
                gameId: subGameData._id,
                first18BallTime: (subGameData.seconds / 1000).toString(),
                last15BallTime: (subGameData.seconds2 / 1000).toString()
            }, 'Game4 Created!', playerLanguage, false);

        } catch (error) {
            console.log("Error Game4Data", error);
            return await createErrorResponse('something_went_wrong', data?.language || 'nor', 500);
        }
    },
    
    // [ Game4ChangeTickets ]
    Game4ChangeTickets: async function (socket, data) {
        try {
            // Destructure data at the top
            const { playerId, gameId, language = "nor" } = data;
            
            // Early validation for playerId
            if (!playerId) {
                return await createErrorResponse("playerid_not_found", language);
            }
            
            // Early validation for gameId
            if (!gameId) {
                return await createErrorResponse("game_not_found", language);
            }
            
            const todayStart = new Date(); todayStart.setHours(0,0,0,0);
            const todayEnd = new Date(); todayEnd.setHours(23,59,59,999);
            // Fetch player and game data in parallel for performance
            const [player, subGameData, runningGame] = await Promise.all([
                Sys.Game.Game4.Services.PlayerServices.getById(playerId, {
                    _id: 1, 
                    selectedLanguage: 1, 
                    userType: 1, 
                    uniqueId: 1, 
                    isCreatedByAdmin: 1, 
                    agentId: 1
                }),
                Sys.App.Services.GameService.getSingleSubGameData({ _id: gameId }, { gameNumber: 1, totalNoTickets: 1 }),
                Sys.App.Services.GameService.getSingleSubGameData(
                    {
                        gameType:'game_4',
                        status:{ $ne:'active' },
                        'otherData.playerId':playerId,
                        'otherData.isBallWithdrawn':false,
                        startDate:{ $gte: todayStart, $lt: todayEnd }
                    },
                    { startDate: 1 }
                )
            ]);
            
            // Validate player
            if (!player) {
                return await createErrorResponse("player_not_found", language);
            }

            if (runningGame) {
                console.log("Alredy runnig game found so can not change ticket");
                return await createErrorResponse("can_not_change_ticket_as_game_running", language);
            }
            
            // Extract needed values
            const { selectedLanguage } = player;
            
            // Cleanup any unpurchased tickets first
            await Sys.App.Services.GameService.deleteTicketManydata({
                gameId: gameId, 
                isPurchased: false
            });
            
            // Book new tickets
            await createSubGameTickets(subGameData, player);
            
            // Get the new tickets with minimal fields
            const tickets = await Sys.Game.Game4.Services.GameServices.getTicketByData(
                { gameId: gameId }, 
                { _id: 1, tickets: 1 }, 
                { sort: {createdAt: -1}, limit: 4 }
            );

            // Format tickets and patterns
            const ticketData = formatTickets(tickets);
            
            // Return success response
            return createSuccessResponse(ticketData, 'Ticket Changed Successfully', selectedLanguage, false);
            
        } catch (error) {
            console.log("Error Game4ChangeTickets", error);
            return await createErrorResponse('something_went_wrong', data?.language || 'nor', 500);
        }
    },

    // [ Game4Play ]
    Game4Play: async function (socket, data) {
        try {console.log("Game 4 play---", data)
            const { 
                playerId, gameId, ticketList: rawTicketList, multiplierValue,
                voucherCode = "", language = "nor" 
            } = data;

            // Check if player is already in a running game
            const isRunningGame = await checkGamePlayAtSameTime(playerId,"game_4");
            console.log("isRunningGame======================", isRunningGame);
            if (isRunningGame.status) {
                return await createErrorResponse(`game_already_started_${isRunningGame.gameType}`, language, 400);
            }

            // Get player data and game data in parallel
            const [player, _gameData, mainGame] = await Promise.all([
                Sys.Game.Game4.Services.PlayerServices.getSingleData(
                    { _id: playerId },
                    {
                        userType: 1, hall: 1, uniqueId: 1, isCreatedByAdmin: 1, agentId: 1, 
                        points: 1, walletAmount: 1, username: 1, monthlyWallet: 1, 
                        monthlyWalletAmountLimit: 1, selectedLanguage: 1, 
                        enableNotification: 1, socketId: 1, groupHall: 1, hall: 1,
                        blockRules: 1, startBreakTime: 1, 
                        endBreakTime: 1
                    }
                ),
                Sys.App.Services.GameService.getSingleSubGameData(
                    { _id: gameId },
                    {
                        gameName: 1, gameType: 1, gameTypeId: 1, ticketPrice: 1, 
                        totalNoTickets: 1, patternNamePrice: 1, seconds: 1, seconds2: 1, 
                        day: 1, createrId: 1, betData: 1, betAmount: 1, otherData: 1, 
                        parentGameId: 1, status: 1, gameNumber: 1
                    }
                ),
                Sys.Game.Game5.Services.GameServices.getSingleGameData(
                    { gameType: 'game_4' },
                    {
                        gameName: 1, gameType: 1, gameTypeId: 1, ticketPrice: 1, 
                        totalNoTickets: 1, patternNamePrice: 1, seconds: 1, seconds2: 1, 
                        day: 1, createrId: 1, betData: 1, betAmount: 1, otherData: 1, 
                        startDate: 1, endDate: 1, days: 1
                    }
                )
            ]);
            let gameData = _gameData;
            
            if (!player) {
                return await createErrorResponse("player_not_found", language);
            }
            
            if (!gameData) {
                return await createErrorResponse("game_not_found", player.selectedLanguage);
            }

            const isBot = player.userType === "Bot";

            // Check if game is closed (for non-bot players)
            if (!isBot) {

                // check if player is blocked from game
                const isPlayerBlocked = await isPlayerBlockedFromGame({
                    hallId: player.hall.id,
                    playerIp: getPlayerIp({
                        handshake: { headers: socket?.handshake?.headers },
                        conn: { remoteAddress: socket?.conn?.remoteAddress }
                    }),
                    gameType: "game",
                    blockRules: player?.blockRules,
                });

                if (isPlayerBlocked) {
                    return await createErrorResponse("player_blocked_game", player.selectedLanguage, 400);
                }

                const gameStatus = await Sys.Game.Common.Controllers.GameController.closeDayValidation({
                    otherData: mainGame.otherData, 
                    startDate: mainGame.startDate, 
                    endDate: mainGame.endDate, 
                    days: mainGame.days
                });
                
                if (!gameStatus || gameStatus.status !== "Open") {
                    return await createErrorResponse("game_closed", player.selectedLanguage);
                }

                // Check player break time
                if (player?.startBreakTime && player?.endBreakTime) {
                    const currentTime = moment();
                    if (currentTime.isBetween(player.startBreakTime, player.endBreakTime, null, '[]')) {
                        return await createErrorResponse("break_started_not_purchase", player.selectedLanguage);
                    }
                }
            }
            
            // Check if player has groupHall information
            if (!player.groupHall) {
                // Fetch the groupHall information if not available
                const playerGroupHall = await Sys.App.Services.HallServices.getSingleHallData(
                    { _id: player.hall.id }, 
                    ['groupHall']
                );
                
                // Assign the groupHall to player object
                if (playerGroupHall && playerGroupHall.groupHall) {
                    player.groupHall = playerGroupHall.groupHall;
                } else {
                    console.log(`Warning: Could not find groupHall for player ${playerId} with hall ID ${player.hall.id}`);
                    // Set a default or empty groupHall to prevent further errors
                    player.groupHall = { id: '', name: '' };
                }
            }
            
            // Parse ticket list
            let parsedTicketList = JSON.parse(rawTicketList);
            const purchasedTicketCount = parsedTicketList.length;

            const { updatedGameData, parsedTicketList: updatedParsedTicketList, allTicketIds } = await handleTicketCloneOrUpdates(
                gameData,
                mainGame,
                player,
                playerId,
                rawTicketList,
                parsedTicketList,
                gameId,
                isBot
            );
            gameData = updatedGameData;
            parsedTicketList = updatedParsedTicketList;
            console.log("Game 4 rawTicket and parsedTicket with length", JSON.parse(rawTicketList)?.length, parsedTicketList?.length, JSON.parse(rawTicketList), parsedTicketList, gameId)
            // Process voucher code and extract voucherInfo directly
            const { voucherInfo = null } = await processVoucherCode(
                voucherCode, 
                playerId, 
                player.selectedLanguage
            );
        
            // Calculate total ticket cost
            const totalAmountOfTickets = (gameData.ticketPrice * Number(multiplierValue)) * purchasedTicketCount;

            // Check minimum bet amount
            if (totalAmountOfTickets <= 0) {
                return await createErrorResponse("min_ticket_bet", player.selectedLanguage, 401, true, null, {playerId: player._id, username: player.username });
            }
            
            // Check if player has enough balance
            if (player.walletAmount < totalAmountOfTickets) {
                return await createErrorResponse("Insufficient_balance", player.selectedLanguage, 401, true, null, {playerId: player._id, username: player.username });
            }
            
            // Check monthly wallet limit if applicable
            if (player.userType !== "Bot" && player.monthlyWallet && player.monthlyWalletAmountLimit < totalAmountOfTickets) {
                return await createErrorResponse("update_wallet_limit", player.selectedLanguage, 401, true, null, {playerId: player._id, username: player.username });
            }
            let deductPlayerSpending = await checkPlayerSpending({ playerId: data.playerId, hallId: player.hall.id, amount: +totalAmountOfTickets });
            if(!deductPlayerSpending.isValid){
                return await createErrorResponse(deductPlayerSpending.error, player.selectedLanguage, 401, true, null, {playerId: player._id, username: player.username });
            }
            // Process ticket purchases
            const currentTicketList = await processTicketPurchase(
                player,
                {_id: gameData._id, ticketPrice: gameData.ticketPrice, isBotGame: isBot, gameNumber: gameData?.gameNumber, ticketCount: purchasedTicketCount},
                totalAmountOfTickets,
                multiplierValue,
                parsedTicketList,
                voucherInfo,
                {seconds: mainGame.seconds, seconds2: mainGame.seconds2},
                socket.id,
                deductPlayerSpending.type
            );

            // Join socket room for non-bot players
            if (!isBot) {
                socket.join(gameData._id);
                socket.myData = {
                    playerID: playerId,
                    gameId: gameData._id,
                    gameType: 'game_4',
                    gameName: 'Spillorama'
                };
            }
            
            // Generate ball sequence and get patterns in parallel
            const [patterns, achiveBallArr] = await Promise.all([
                Sys.App.Services.patternServices.getPatternsByData({ gameType: 'game_4' }, {_id: 1, patternType: 1, patternName: 1, count: 1}, {sort: {count: 1}}),
                generateBallSequence()
            ]);

            // Process patterns using helper
            const patternListData = processPatterns(patterns, mainGame.patternNamePrice[0]);
           
            if(!isBot){
                // Notify clients of pattern changes
                await Sys.Io.of(Sys.Config.Namespace.Game4).to(gameData._id).emit('PatternChange', {
                    patternList: patternListData,
                    betData: mainGame.betData,
                    first18BallTime: (mainGame.seconds / 1000).toString(),
                    last15BallTime: (mainGame.seconds2 / 1000).toString(),
                    isSoundPlay: (mainGame?.seconds >= 2000 && mainGame?.seconds2 >= 2000) ? true: false
                });
            }
            
            // Check for winning patterns
            const patternWinnerArray = await module.exports.checkForWinnings(patterns, gameData._id, achiveBallArr, multiplierValue);
            
            // Calculate total winnings amount
            const winnerAmount = await calculateTotalWinnings(patternWinnerArray, multiplierValue, playerId, gameData._id);
            // Update game status to finished with results
            const finalGameProfitAmount = totalAmountOfTickets - winnerAmount;
            const profitPercentage = +parseFloat((finalGameProfitAmount / totalAmountOfTickets) * 100).toFixed(2);
            await Sys.Game.Game4.Services.GameServices.updateSubGame(
                { _id: gameData._id },
                {
                    $set: {
                        status: 'finish',
                        history: achiveBallArr,
                        winners: [],
                        patternWinnerHistory: patternWinnerArray,
                        totalEarning: totalAmountOfTickets,
                        totalWinning: winnerAmount,
                        finalGameProfitAmount: finalGameProfitAmount,
                        'otherData.profitPercentage': profitPercentage
                    }
                }
            );
            // Update player statistics for game loss if no wins
            if (patternWinnerArray.length === 0) {
                Sys.Game.Game4.Services.PlayerServices.updateData(
                    { _id: player._id },
                    { $inc: { 'statisticsgame4.totalGamesLoss': 1 } }
                );
            }
            
            // Process pattern winners based on player type
            const timeoutTime = (Number(gameData.seconds) * 18 + Number(gameData.seconds2) * 15) + 1000;
            console.log("Game 4 seconds of gamedata and mainGame:", gameData.seconds, gameData.seconds2, mainGame.seconds, mainGame.seconds2);
            // create final reponse
            const {response, hasExtraGame} = await formatGamePlayResponse({
                patternWinnerArray,
                achiveBallArr,
                winnerAmount ,
                playerId,
                allTicketIds,
                parsedTicketList,
                gameId: gameData._id,
                currentTicketList,
                isSoundPlay: (mainGame?.seconds >= 2000 && mainGame?.seconds2 >= 2000) ? true: false
            });
            
            // For bots, process immediately
            if (isBot) {
               await processPatternWinners(patternWinnerArray, gameData._id, multiplierValue, winnerAmount, player?._id?.toString());
                
                // If bot wins mystery game, play it automatically
                if (hasExtraGame) {
                    await module.exports.Game4PlayMysteryGame({
                        playerId: player._id.toString(),
                        gameId: gameData._id.toString()
                    });
                }
            } else {
                // For non-bot players, process after animation
                await Sys.Game.Game4.Services.GameServices.updateSubGame(
                    { _id: gameData._id },
                    {
                        $set: {
                            startDate: Date.now() + 1000 // 1 seconds added
                        }
                    }
                );
                if (!isBot) {
                    // Redis Data update playerwise
                    const redisKey = `game4:${player._id}:${gameData._id}`;
                    //console.log("ticket list data--", allTicketIds, parsedTicketList, currentTicketList, rawTicketList)
                    const game4Data = {
                        patternList: patternListData,
                        patternWinnerArray,
                        achiveBallArr,
                        winnerAmount,
                        playerId,
                        allTicketIds,
                        parsedTicketList,
                        gameId: gameData._id,
                        currentTicketList,
                        isSoundPlay: (mainGame?.seconds >= 2000 && mainGame?.seconds2 >= 2000) ? true: false,
                        betData: mainGame.betData,
                        ticketPrice: gameData.ticketPrice,
                        totalAmountOfTickets: totalAmountOfTickets,
                        seconds: mainGame.seconds,
                        seconds2: mainGame.seconds2
                    };
                    // Set with timeout (game duration plus buffer)
                    // Fixing EXPIRE time to ensure correct duration: store for total animation timeout in seconds + 30 min buffer
                    //await redis.set(redisKey, JSON.stringify(game4Data), 'EX', Math.ceil((timeoutTime / 1000) + 1800));
                    saveGameDataToRedis("game4", player._id, game4Data, Math.ceil((timeoutTime / 1000) + 1800), gameData._id);
                }
                setTimeout(async () => {
                    try{
                        await processPatternWinners(patternWinnerArray, gameData._id, multiplierValue, winnerAmount, player?._id?.toString());
                         // Create and save notification
                         await createWinningPatternNotification({
                            patternWinnerArray,
                            gameData,
                            winnerAmount,
                            player
                        });
                        
                        // Update isBallWithdrawn status after game animation completes
                        Sys.Game.Game4.Services.GameServices.updateSubGame(
                            { _id: gameData._id },
                            { $set: { 'otherData.isBallWithdrawn': true } }
                        );

                        // Send PlayerHallLimit broadcast
                        if(winnerAmount > 0){
                            const latestPlayer = await Sys.Game.Game4.Services.PlayerServices.getSingleData(
                                { _id: player._id },
                                { socketId: 1 }
                            );
                            Sys.Io.to(latestPlayer?.socketId).emit('PlayerHallLimit', { }); 
                        }

                        // Clear redis data related to this game and player after the animation completes
                        // const redisKey = `game4:${player._id}:${gameData._id}`;
                        // await redis.del(redisKey);
                        deleteRedisDataByTypeAndId("game4", player._id, gameData._id);

                        // Check break time after game is finished
                        await Sys.Game.Common.Controllers.PlayerController.checkBreakTimeOnGameFinished(player._id, "Game4");
                    }catch (breakTimeError) {
                        console.error('Error processing winer for real player:', breakTimeError);
                    }
                    
                }, timeoutTime);
            }

            return createSuccessResponse(response, "Game 4 Winner Success!", player.selectedLanguage, false);
        } catch (error) {
            console.log("Error in Game4Play: ", error);
            return {
                status: 'error',
                message: 'Internal server error',
                statusCode: 500
            };
        }
    },

    checkForWinnings: async function (patternListData, subGameId, achiveBallArr, multiplierValue) {
        try {
            let patternWinnerArray = [];
    
            const { purchasedTickets, patternNamePrice } = await Sys.Game.Game4.Services.GameServices.getSingleSubGameData(
                { _id: subGameId },
                { purchasedTickets: 1, patternNamePrice: 1, isPattern: 1 }
            );
    
            for (const ticket of purchasedTickets) {
                // Skip if ticket already has a pattern win
                if (ticket.isPattern) continue;
    
                for (let q = 0; q < patternListData.length; q++) {
                    const pattern = patternListData[q];
                    const patternType = pattern.patternType;
    
                    let linePatterns = null;
    
                    // Define line patterns if needed
                    if (patternType === '1,1,1,1,1.0,0,0,0,0.0,0,0,0,0') {
                        linePatterns = [
                            { pattern: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
                            { pattern: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0] },
                            { pattern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1] }
                        ];
                    } else if (patternType === '1,1,1,1,1.1,1,1,1,1.0,0,0,0,0') {
                        linePatterns = [
                            { pattern: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0] },
                            { pattern: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1] },
                            { pattern: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }
                        ];
                    }
    
                    const winners = await checkPatternsForTicket({
                        patternListData: pattern,
                        subGameId,
                        achiveBallArr,
                        q,
                        ticket,
                        patternNamePrice,
                        patterns: linePatterns,
                        multiplierValue
                    });
    
                    if (winners.length > 0) {
                        patternWinnerArray.push(...winners);
                        break; // Stop checking other patterns once one matches for this ticket
                    }
                }
            }
    
            console.log("checkForWinnings-----", JSON.stringify(patternWinnerArray));
            return patternWinnerArray;
        } catch (e) {
            console.log("Error in checking winnings", e);
            return [];
        }
    },

    MysteryGameData: async function (socket, data) {
        try {
            const { playerId, language = "nor" } = data;
            
            // Run player validation and get mystery list in parallel
            const [player, mysteryList] = await Promise.all([
                Sys.Game.Game4.Services.PlayerServices.getById(playerId, {_id: 1}),
                Sys.App.Services.otherGameServices.getMinigameWinningsByData({ slug: 'mystery' }, { mysteryPrizeList: 1 })
            ]);
            
            if (!player) {
                return await createErrorResponse("player_not_found", language, 400);
            }

            // Generate two unique random numbers
            const FinalValue = [];
            const allValue = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
            
            // First number generation
            const firstNum = Math.floor(10000 + Math.random() * 90000);
            FinalValue.push(firstNum.toString());
            
            // Remove used digits from available pool
            const usedDigits = [...firstNum.toString()].map(Number);
            for (const digit of usedDigits) {
                const index = allValue.indexOf(digit);
                if (index !== -1) allValue.splice(index, 1);
            }
            
            // Second number generation - use remaining digits
            allValue.sort(() => Math.random() - 0.5);
            FinalValue.push(allValue.slice(0, 5).join(''));
            
            console.log("FinalValue: ", FinalValue);

            // Apply joker logic (10% chance)
            const randomJocker = Math.random();
            if (randomJocker > 0.90) {
                const randomIndex = Math.floor(Math.random() * 5);
                console.log("randomJocker value--", randomJocker, "randomIndex:", randomIndex);
                
                const val1 = [...FinalValue[0]].map(Number);
                const val2 = [...FinalValue[1]].map(Number);
                
                val2[randomIndex] = val1[randomIndex];
                
                FinalValue[0] = Number(val1.join(''));
                FinalValue[1] = Number(val2.join(''));
                
                console.log("final number after joker index", FinalValue[0], FinalValue[1]);
            }
            
            const result = {
                prizeList: mysteryList.mysteryPrizeList,
                middleNumber: FinalValue[1],
                resultNumber: FinalValue[0],
            };
            
            return createSuccessResponse(result, "Game 4 MysteryGameData..!!", language, false);

        } catch (error) {
            console.log("Error in MysteryGameData Game4 : ", error);
            return await createErrorResponse("something_went_wrong", data.language || "nor", 400);
        }
    },

    MysteryGameFinished: async function (socket, data) {
        try {
            console.log("MysteryGameFinished: ", data);
            let { playerId, gameId, winningPrize, language = "nor" } = data;
            winningPrize = +winningPrize;
        
            // Run player validation and game validation in parallel
            const [player, gameData] = await Promise.all([
                Sys.Game.Game4.Services.PlayerServices.getById(playerId, {_id: 1, selectedLanguage: 1}),
                Sys.Game.Game4.Services.GameServices.getSingleSubGameData({ _id: gameId }, {patternWinnerHistory: 1, totalEarning: 1, totalWinning: 1})
            ]);

            // Player validation
            if (!player) {
                return await createErrorResponse("player_not_found", language, 400);
            }

            // Game validation
            if (!gameData) {
                return await createErrorResponse("game_not_found", player.selectedLanguage, 400);
            }

            // Verify if the winning pattern is "O" before proceeding
            const oPatternWinner = gameData.patternWinnerHistory.find(winner => winner.patternName === "O");
            console.log("oPatternWinner", oPatternWinner);
            if (!oPatternWinner) {
                return await createErrorResponse("something_went_wrong", player.selectedLanguage, 400);
            }

            // Update ticket if there are winning tickets
            const { patternWinnerHistory: winningTickets } = gameData;
            if (winningTickets.length > 0) {
                const ticketId = oPatternWinner.ticketId;
                const ticketData = await Sys.Game.Game4.Services.GameServices.updateSingleTicket(
                    { _id: ticketId, playerIdOfPurchaser: playerId, "mystryWinners.0": { $exists: false } }, 
                    { 
                        $push: { 
                            "mystryWinners": { 
                                playerId, 
                                WinningAmount: (winningPrize), 
                                ticketId 
                            } 
                        }, 
                        $inc: { 
                            totalWinningOfTicket: +parseFloat(winningPrize).toFixed(4) 
                        } 
                    }
                );  
                // Check if the ticket was successfully updated
                if (!ticketData || ticketData?.mystryWinners?.length > 1) {
                    console.log("Failed to update ticket with mystery winner data");
                    return await createErrorResponse("something_went_wrong", player.selectedLanguage, 400);
                }
                const finalWinning = parseFloat(winningPrize + gameData.totalWinning).toFixed(2);
                const finalGameProfitAmount =  +gameData.totalEarning - finalWinning;
                const profitPercentage = +parseFloat((finalGameProfitAmount / +gameData.totalEarning) * 100).toFixed(2);
                await Sys.Game.Game4.Services.GameServices.updateSubGame(
                    { _id: gameData._id },
                    {
                        $inc: {
                            totalWinning: winningPrize,
                            finalGameProfitAmount: -winningPrize,
                        },
                        $set: {
                            'otherData.profitPercentage': profitPercentage
                        }
                    }
                );
            }

            // Create transaction
            const transactionData = {
                playerId: player._id,
                gameId: gameData._id,
                extraSlug: "Game4",
                transactionSlug: "mystery",
                action: "credit",
                purchasedSlug: "realMoney",
                totalAmount: Number(winningPrize),
            };
            
            // Create extra transaction
            const extraTransactionData = {
                ...transactionData,
                transactionSlug: "extraTransaction",
                typeOfTransaction: "Mystery"
            };

            // Process transactions and get updated player data in parallel
            await Promise.all([
                Sys.Helper.gameHelper.createTransactionPlayer(transactionData),
                Sys.Helper.gameHelper.createTransactionPlayer(extraTransactionData),
                
            ]);

            console.log('\x1b[36m%s\x1b[0m', '----------------------------------------------------------------------');
            console.log('\x1b[36m%s\x1b[0m', '[ Mini Game (Game 4) [ Mystery Game ] Winner Amount:- ' + winningPrize + ']');
            console.log('\x1b[36m%s\x1b[0m', '----------------------------------------------------------------------');

            const newPlayer = await Sys.Game.Game4.Services.PlayerServices.getById(playerId, {_id: 1, points: 1, walletAmount: 1, socketId: 1});
            const result = {
                points: parseFloat(newPlayer.points).toFixed(2),
                realMoney: parseFloat(newPlayer.walletAmount).toFixed(2),
                isWinningInPoints: false
            };

            // Send PlayerHallLimit broadcast
            Sys.Io.to(newPlayer?.socketId).emit('PlayerHallLimit', {  });
            

            console.log('Result[MysteryGameFinished]: ', result);
            
            return createSuccessResponse(result, 'Game 4 Mystery Game Winner Amount ..!!', language, false);

        } catch (error) {
            console.log("Error in MysteryGameFinished Game4 : ", error);
            return await createErrorResponse("something_went_wrong", data.language || "nor", 400);
        }
    },

    Game4ThemesData: async function (socket, data) {
        try {
            console.log("Game4ThemesData: ", data);
            const { playerId, language = "nor", os } = data;
            
            // Execute player and theme queries in parallel
            const [player, theme] = await Promise.all([
                Sys.Game.Game4.Services.PlayerServices.getById(playerId, {_id: 1, selectedLanguage: 1}),
                Sys.App.Services.OtherModules.getSingleThemeData()
            ]);
            
            // Player validation
            if (!player) {
                return await createErrorResponse("player_not_found", language, 400);
            }

            // Theme validation
            if (!theme) {
                return await createErrorResponse("theme_not_found", language, 400);
            }

            // Determine version and asset bundle URL based on OS
            let version, assetBundleUrl;
            switch(os) {
                case 'android':
                    version = theme.versionAndroid;
                    assetBundleUrl = theme.android;
                    break;
                case 'ios':
                    version = theme.versionIOS;
                    assetBundleUrl = theme.ios;
                    break;
                case 'webgl':
                    version = theme.versionWebGL;
                    assetBundleUrl = theme.webgl;
                    break;
                default:
                    version = 0;
                    assetBundleUrl = '';
            }
            return createSuccessResponse({ version: Number(version), assetBundleUrl }, 'Game 4 Theme Load Successfully..!!', language, false);

        } catch (error) {
            console.log("Error in Game4ThemesData Game4 : ", error);
            return await createErrorResponse("something_went_wrong", data.language || "nor", 400);
        }
    },

    Game4BotInjection: async function (data) {
        try {
            console.log("Bot injection function called....");
            // Get game data and find a suitable bot player in parallel
            const [gameData, botPlayer] = await Promise.all([
                Sys.Game.Game4.Services.GameServices.getSingleGameData(
                    { gameType: 'game_4' }, 
                    { otherData: 1 }
                ),
                Sys.Game.Game4.Services.PlayerServices.getPlayerAggregate([
                    {
                        "$match": {
                            "userType": "Bot",
                            "walletAmount": { "$gte": 2000 }
                        }
                    },
                    {
                        "$sample": {
                            "size": 1
                        }
                    }
                ])
            ]);
            
            // Validate game data
            if (!gameData || !gameData.otherData?.isBotGame || gameData.otherData?.totalBotGamePlayed >= gameData.otherData?.botGameCount) {
                if (gameData?.otherData?.totalBotGamePlayed >= gameData?.otherData?.botGameCount) {
                    playBot = false
                }
                return {
                    status: 'fail',
                    message: "Bot Game can not be played.",
                    clear: true
                };
            }
            
            // Validate bot player
            if (botPlayer.length === 0) {
                return {
                    status: 'fail',
                    message: "Bot Not found.",
                    clear: true
                };
            }
            
            const selectedBot = botPlayer[0];
            console.log("bot player found", selectedBot._id);
            
            const socket = { id: "botSocketId" };
            const botPlayerId = selectedBot._id.toString();
            
            // Generate ticket data
            const ticketData = await Sys.Game.Game4.Controllers.GameController.Game4Data(
                socket, 
                { playerId: botPlayerId }
            );
            
            if (!ticketData || ticketData.status === "fail") {
                return {
                    status: 'fail',
                    message: "Could not Generate ticket properly."
                };
            }
            
            const ticketResult = ticketData.result;
            const multiplierArray = ticketResult.betData.ticket4Multiplier;
            const multiplierIndex = Math.floor(Math.random() * (multiplierArray.length - 1));
            const multiplierValue = multiplierArray[multiplierIndex];
            
            // Prepare request data for game play
            const requestData = {
                playerId: botPlayerId,
                gameId: ticketResult.gameId.toString(),
                ticketList: JSON.stringify(ticketResult.ticketList.map(t => t.id.toString())),
                multiplierValue,
                multiplierIndex,
                purchaseType: "",
                voucherCode: ""
            };
            
            // Play the game
            const gamePlay = await Sys.Game.Game4.Controllers.GameController.Game4Play(socket, requestData);
            
            if (gamePlay.status === "fail") {
                return {
                    status: 'fail',
                    message: 'BOT Game could not played.'
                };
            } 
            
            // Update game data asynchronously without waiting for completion
            Sys.App.Services.GameService.updateGameData(
                { _id: gameData._id }, 
                { $inc: { 'otherData.totalBotGamePlayed': 1 } }
            ).catch(err => console.error("Error updating bot game count:", err));
            
            return gamePlay;

        } catch (error) {
            console.log("Something went wrong while injecting bot in game 4", error);
            return {
                status: 'fail',
                message: 'bot injection failed.',
                reason: error.message,
                clear: true
            };
        }
    },

    Game4PlayMysteryGame: async function (data) {
        try {
            console.log("Bot play Mystery Game Function Called", data);
            
            const socket = { id: "botsocketid" };
            // Get mystery data
            const mysteryData =await module.exports.MysteryGameData(socket, data);
            
            if (mysteryData.status !== "success") {
                console.log("There was an issue while playingbot mystery game");
                return;
            }
            
            // Destructure result data
            const { prizeList, middleNumber, resultNumber } = mysteryData.result;
            
            // Convert numbers to strings and split once
            const middleDigits = middleNumber.toString().split('');
            const resultDigits = resultNumber.toString().split('');
            
            // Pre-define guess options to avoid recreation in loop
            const guessOptions = ['up', 'down'];
            
            // Calculate prize index
            let priceIndex = 0;
            for (let i = middleDigits.length - 1; i >= 0; i--) {
                const randomIndex = Math.floor(Math.random() * 2);
                const guess = guessOptions[randomIndex];
                const middleDigit = middleDigits[i];
                const resultDigit = resultDigits[i];
                
                if ((guess === 'up' && middleDigit < resultDigit) || 
                    (guess === 'down' && middleDigit > resultDigit)) {
                    if (priceIndex < prizeList.length - 1) {
                        priceIndex++;
                    }
                } else {
                    if (priceIndex > 0) {
                        priceIndex--;
                    }
                }
            }

            console.log("Final won amount", prizeList[priceIndex]);
            
            // Set winning prize and finish game
            data.winningPrize = prizeList[priceIndex];
            
            // Start finishing the game without blocking
            module.exports.MysteryGameFinished(socket, data);
          
            return;
        } catch (error) {
            console.error("Error while mystery gameplay for bot player", error);
            return;
        }
    },

    handleServerRestart: async function () {
        try {
            console.log("handleServerRestart called for game 4");
            // Get today's day in required format
            const startOfDay = moment().startOf('day').toDate();
            const endOfDay = moment().endOf('day').toDate();
          
            //Step 1: Get all running subgames Real & Bot 
            const runningGames = await Sys.Game.Game4.Services.GameServices.getSubGameData(
                {
                    gameType: 'game_4',
                    status: { $in: ['running', 'finish'] },
                    startDate: { $gte: startOfDay, $lte: endOfDay },
                    'otherData.isBallWithdrawn': false,
                },
                { 
                    _id: 1, status: 1, gameNumber: 1, gameName: 1, totalEarning: 1, halls: 1, patternWinnerHistory: 1, totalWinning: 1, players: 1, otherData: 1
                }
            );
    
            // Process each game
            await Promise.all(runningGames.map(async (game) => {
                try {
                    const playerId = game?.otherData?.playerId || game?.players[0]?.id?.toString();
                    if (game.status === 'finish' && game.otherData && game.otherData.isBallWithdrawn === false) {
                        const winnerAmount = game?.totalWinning;
                        const patternWinnerArray = game?.patternWinnerHistory;
                        const multiplierValue = game?.otherData?.multiplierValue;
                        const latestPlayer = await Sys.Game.Game4.Services.PlayerServices.getSingleData(
                            { _id: playerId }, { enableNotification: 1, socketId: 1 }
                        );
                        
                        if(winnerAmount && winnerAmount > 0 && patternWinnerArray.length > 0 && multiplierValue){
                            await processPatternWinners(patternWinnerArray, game._id, multiplierValue, winnerAmount, playerId);
                            
                            // Create and save notification
                            await createWinningPatternNotification({
                                patternWinnerArray,
                                gameData: game,
                                winnerAmount,
                                player: latestPlayer
                            });
                        }
                        
                        // Update isBallWithdrawn status after game animation completes
                        Sys.Game.Game4.Services.GameServices.updateSubGame(
                            { _id: game._id },
                            { $set: { 'otherData.isBallWithdrawn': true } }
                        );
                        
                        Sys.Io.to(`Player:${playerId}`).emit('PlayerHallLimit', { });
                        
                        deleteRedisDataByTypeAndId("game4", latestPlayer._id, game._id);

                        // Check break time after game is finished
                        await Sys.Game.Common.Controllers.PlayerController.checkBreakTimeOnGameFinished(latestPlayer._id, "Game4");
                        
                    } else if (game.status === 'running') {
                        console.log("Runnig game 4 found");
                        const totalEarning = +game.totalEarning;
                        const [player] = await Promise.all([
                            Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                                { _id: playerId }, 
                                { $inc: { 
                                    walletAmount: totalEarning, 
                                    monthlyWalletAmountLimit: totalEarning 
                                }}
                            ),
                            Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                                type: "cancel",
                                playerId: playerId,
                                hallId: '',
                                cancel: totalEarning
                            }),
                            Sys.Game.Game4.Services.GameServices.updateSubGame(
                                { _id: game._id },
                                { $set: { status: "Cancel"} }
                            ),
                            //Sys.App.Services.GameService.deleteTicketMany(game._id)
                        ]);
                        
                        if (player) {
                            // Create transaction record
                            const newExtraTransaction = {
                                playerId: playerId,
                                gameId: game._id,
                                transactionSlug: "extraTransaction",
                                typeOfTransaction: "Refund",
                                action: "credit",
                                purchasedSlug: "realMoney",
                                defineSlug: "Refund",
                                extraSlug: "Game4",
                                remark: "Game 4 Refund",
                                totalAmount: totalEarning,
                                previousBalance: player.walletAmount - totalEarning,
                                afterBalance: player.walletAmount
                            };
                            
                            // Don't await this operation to avoid blocking
                            Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);

                            game?.halls?.[0]?.id && totalEarning && await updatePlayerHallSpendingData({ playerId, hallId: game.halls[0].id, amount: Number(totalEarning), type: 'normal', gameStatus: 2 });
                        }
                    }
                } catch (error) {
                    console.error(`Error processing game ${game._id}:`, error);
                }
            }));
    
        } catch (error) {
            console.error("Error in handleServerRestartAllGames of game 4:", error);
        }
    }

    // Below Functions are not used in this game now
    // [ Apply Voucher Code ]
    // ApplyVoucherCode: async function (socket, data) {
    //     try {
    //         const language = data.language || "nor";
    //         const { playerId, gameId, voucherCode, ticketQty } = data;
            
    //         // Execute parallel database queries
    //         const [player, gameData, vocherTransaction] = await Promise.all([
    //             Sys.Game.Game2.Services.PlayerServices.getById(playerId),
    //             Sys.Game.Game4.Services.GameServices.getSingleSubGameData({ _id: gameId }, {ticketPrice: 1}),
    //             Sys.Game.Common.Services.PlayerServices.transactionData({
    //                 playerId,
    //                 voucherCode,
    //                 isVoucherUse: true,
    //                 isVoucherApplied: true
    //             })
    //         ]);
            
    //         // Player validation
    //         if (!player) {
    //             return await createErrorResponse("player_not_found", language, 400);
    //         }
            
    //         const { selectedLanguage } = player;
            
    //         // Game validation
    //         if (!gameData) {
    //             return await createErrorResponse("game_not_found", selectedLanguage);
    //         }
            
    //         // Check if voucher already used
    //         if (vocherTransaction.length > 0) {
    //             return await createErrorResponse("voucher_already_used", selectedLanguage, 400);
    //         }
            
    //         // Get voucher transaction
    //         const voucherUpdatedTransaction = await Sys.Game.Common.Services.PlayerServices.transactionData({ 
    //             playerId, 
    //             voucherCode 
    //         });
            
    //         if (voucherUpdatedTransaction.length === 0) {
    //             return await createErrorResponse("invalid_voucher", selectedLanguage);
    //         }
            
    //         // Get voucher data
    //         const voucherData = await Sys.App.Services.VoucherServices.getSingleData({ 
    //             _id: voucherUpdatedTransaction[0].voucherId 
    //         });
            
    //         if (!voucherData) {
    //             return await createErrorResponse("voucher_not_valid", selectedLanguage);
    //         }
            
    //         // Check voucher status
    //         if (voucherData.status !== 'active') {
    //             return await createErrorResponse("voucher_blocked", selectedLanguage);
    //         }
            
    //         // Check expiry date
    //         const currentDate = Date.now();
    //         const expiryDate = new Date(voucherData.expiryDate);
            
    //         if (currentDate > expiryDate) {
    //             return await createErrorResponse("voucher_expired", selectedLanguage);
    //         }
            
    //         // Update transaction
    //         await Sys.Game.Common.Services.PlayerServices.updateOneTransaction(
    //             { _id: voucherUpdatedTransaction[0]._id }, 
    //             { isVoucherApplied: true }
    //         );
            
    //         // Calculate discount
    //         const totalAmountOfTickets = gameData.ticketPrice * ticketQty;
    //         const percentageAmount = (voucherData.percentageOff * totalAmountOfTickets) / 100;
    //         const payableAmount = totalAmountOfTickets - percentageAmount;
            
    //         const result = {
    //             discount: percentageAmount,
    //             payableAmount: payableAmount,
    //             percentageOff: voucherData.percentageOff
    //         };
            
    //         return createSuccessResponse(result, "voucher_applied_successfully", selectedLanguage, true);
            
    //     } catch (error) {
    //         console.log("Error ApplyVoucherCode", error);
    //         return await createErrorResponse('something_went_wrong', data?.language || 'nor', 500);
    //     }
    // },

    // WheelOfFortuneData: async function (socket, data) {
    //     try {
    //         console.log("WheelOfFortuneData: ", data);
    //         let language = "nor";
    //         if(data.language){
    //             language = data.language;
    //         }
    //         // [ Player Validation ]
    //         let player = await Sys.Game.Game4.Services.PlayerServices.getById(data.playerId);
    //         if (!player) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({key: "player_not_found", language: language}), // 'Player Not Found!',
    //                 statusCode: 400
    //             }
    //         }

    //         console.log('\x1b[36m%s\x1b[0m', '-----------------------------------------------');
    //         console.log('\x1b[36m%s\x1b[0m', '[ Mini Game Created (Game 4) [ WheelOfFortuneData]]');
    //         console.log('\x1b[36m%s\x1b[0m', '-----------------------------------------------');

    //         let wheelOfFortuneList = await Sys.App.Services.otherGameServices.getByData({ slug: 'wheelOfFortune' });


    //         let result = {
    //             prizeList: wheelOfFortuneList.wheelOfFortuneprizeList
    //         }

    //         return {
    //             status: 'success',
    //             result: result,
    //             message: 'Game 4 WheelOfFortuneData..!!'
    //         }


    //     } catch (error) {
    //         console.log("Error in WheelOfFortuneData Game4 : ", error);
    //         return new Error(error);
    //     }
    // },

    // PlayWheelOfFortune: async function (socket, data) {
    //     try {
    //         let language = "nor";
    //         if(data.language){
    //             language = data.language;
    //         }
    //         console.log("PlayWheelOfFortune: ", data);

    //         // [ Player Validation ]
    //         let player = await Sys.Game.Game4.Services.PlayerServices.getById(data.playerId);
    //         if (!player) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({key: "player_not_found", language: language}), // 'Player Not Found!',
    //                 statusCode: 400
    //             }
    //         }

    //         let wheelOfFortuneList = await Sys.App.Services.otherGameServices.getByData({ slug: 'wheelOfFortune' });
    //         let amount = wheelOfFortuneList.wheelOfFortuneprizeList[Math.floor(Math.random() * wheelOfFortuneList.wheelOfFortuneprizeList.length)];

    //         console.log('\x1b[36m%s\x1b[0m', '----------------------------------------------------------------------');
    //         console.log('\x1b[36m%s\x1b[0m', '[ Mini Game (Game 4) [ Treasure Chest] Winner Amount:- ' + amount + ']');
    //         console.log('\x1b[36m%s\x1b[0m', '----------------------------------------------------------------------');

    //         return {
    //             status: 'success',
    //             result: amount,
    //             message: 'Game 4 WheelOfFortuneData Winner Amount ..!!'
    //         }


    //     } catch (error) {
    //         console.log("Error in PlayWheelOfFortune Game4 : ", error);
    //         return new Error(error);
    //     }
    // },

    // WheelOfFortuneFinished: async function (socket, data) {
    //     try {
    //         let language = "nor";
    //         console.log("WheelOfFortuneFinished: ", data);

    //         // [ Player Validation ]
    //         let player = await Sys.Game.Game4.Services.PlayerServices.getById(data.playerId, {_id: 1, selectedLanguage: 1});
    //         if (!player) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({key: "player_not_found", language: language}), // 'Player Not Found!',
    //                 statusCode: 400
    //             }
    //         }

    //         // [ Game Validation ]
    //         let gameData = await Sys.Game.Game4.Services.GameServices.getSingleSubGameData({ _id: data.gameId }, {patternWinnerHistory: 1});
    //         if (!gameData) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({key: "game_not_found", language: player.selectedLanguage}), // 'Game Not Found!',
    //                 statusCode: 400
    //             }
    //         }


    //         let transactionDataSend = {
    //             playerId: player._id,
    //             gameId: gameData._id,
    //             extraSlug: "Game4",
    //             transactionSlug: "Spin",
    //             action: "credit", // debit / credit
    //             purchasedSlug: "realMoney", //'points', // point /realMoney
    //             totalAmount: Number(data.winningPrize),
    //         }
    //         await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);

    //         let newPlayer = await Sys.Game.Game4.Services.PlayerServices.getById(data.playerId, {_id: 1, points: 1, walletAmount: 1});

    //         let result = {
    //             points: parseFloat(newPlayer.points).toFixed(2), //newPlayer.points,
    //             realMoney: parseFloat(newPlayer.walletAmount).toFixed(2), //newPlayer.walletAmount,
    //             isWinningInPoints: false
    //         }

    //         console.log('Result[WheelOfFortuneFinished]: ', result);


    //         let newExtraTransaction = {
    //             playerId: player._id,
    //             gameId: gameData._id,
    //             extraSlug: "Game4",
    //             transactionSlug: "extraTransaction",
    //             typeOfTransaction: "Spin",
    //             action: "credit", // debit / credit
    //             purchasedSlug: "realMoney", // "points", // points /realMoney
    //             totalAmount: Number(data.winningPrize),
    //         }

    //         await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);

    //         let winningTickets = gameData.patternWinnerHistory;
    //         if (winningTickets.length > 0) {
    //             let ticketId = winningTickets[0].ticketId;
    //             Sys.Game.Game1.Services.GameServices.updateTicket({ _id: ticketId, playerIdOfPurchaser: data.playerId }, { $push: { "wofWinners": { playerId: data.playerId, WinningAmount: (+data.winningPrize), ticketId: ticketId } }, $inc: { totalWinningOfTicket: +parseFloat(data.winningPrize).toFixed(4) } });
    //         }

    //         return {
    //             status: 'success',
    //             result: result,
    //             message: 'Game 4 WheelOfFortuneFinished ..!!'
    //         }


    //     } catch (error) {
    //         console.log("Error in WheelOfFortuneFinished Game4 : ", error);
    //         return new Error(error);
    //     }
    // },

    // TreasureChestData: async function (socket, data) {
    //     try {
    //         console.log("TreasureChestData: ", data);


    //         // [ Player Validation ]
    //         let player = await Sys.Game.Game4.Services.PlayerServices.getById(data.playerId, {_id: 1});
    //         if (!player) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({key: "player_not_found", language: language}), // 'Player Not Found!',
    //                 statusCode: 400
    //             }
    //         }

    //         console.log('\x1b[36m%s\x1b[0m', '-----------------------------------------------');
    //         console.log('\x1b[36m%s\x1b[0m', '[ Mini Game Created (Game 4) [ Treasure Chest]]');
    //         console.log('\x1b[36m%s\x1b[0m', '-----------------------------------------------');

    //         let treasureChestList = await Sys.App.Services.otherGameServices.getByData({ slug: 'treasureChest' });


    //         let result = {
    //             prizeList: treasureChestList.treasureChestprizeList
    //         }

    //         return {
    //             status: 'success',
    //             result: result,
    //             message: 'Game 4 TreasureChestData..!!'
    //         }


    //     } catch (error) {
    //         console.log("Error in TreasureChestData Game4 : ", error);
    //         return new Error(error);
    //     }
    // },

    // SelectTreasureChest: async function (socket, data) {
    //     try {

    //         console.log("SelectTreasureChest: ", data);

    //         // [ Player Validation ]
    //         let player = await Sys.Game.Game4.Services.PlayerServices.getById(data.playerId, {_id: 1, selectedLanguage: 1});
    //         if (!player) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({key: "player_not_found", language: language}), // 'Player Not Found!',
    //                 statusCode: 400
    //             }
    //         }

    //         // [ Game Validation ]
    //         let gameData = await Sys.Game.Game4.Services.GameServices.getSingleSubGameData({ _id: data.gameId }, {patternWinnerHistory: 1});
    //         if (!gameData) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({key: "game_not_found", language: player.selectedLanguage}), // 'Game Not Found!',
    //                 statusCode: 400
    //             }
    //         }


    //         let treasureChestList = await Sys.App.Services.otherGameServices.getByData({ slug: 'treasureChest' });
    //         let amount = treasureChestList.treasureChestprizeList[Math.floor(Math.random() * treasureChestList.treasureChestprizeList.length)];

    //         console.log("amount", amount);
    //         let transactionDataSend = {
    //             playerId: player._id,
    //             gameId: gameData._id,
    //             extraSlug: "Game4",
    //             transactionSlug: "treasureChest",
    //             action: "credit", // debit / credit
    //             purchasedSlug: "realMoney", // "points", // point /realMoney
    //             totalAmount: Number(amount),
    //         }
    //         await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);

    //         console.log('\x1b[36m%s\x1b[0m', '----------------------------------------------------------------------');
    //         console.log('\x1b[36m%s\x1b[0m', '[ Mini Game (Game 4) [ Treasure Chest] Winner Amount:- ' + amount + ']');
    //         console.log('\x1b[36m%s\x1b[0m', '----------------------------------------------------------------------');

    //         let newPlayer = await Sys.Game.Game4.Services.PlayerServices.getById(data.playerId, {_id: 1, points: 1, walletAmount: 1});

    //         let result = {
    //             points: parseFloat(newPlayer.points).toFixed(2), //newPlayer.points,
    //             realMoney: parseFloat(newPlayer.walletAmount).toFixed(2), //newPlayer.walletAmount,
    //             winningPrize: parseFloat(amount).toFixed(2), //amount,
    //             isWinningInPoints: false
    //         }

    //         console.log('Result[SelectTreasureChest]: ', result);

    //         let newExtraTransaction = {
    //             playerId: player._id,
    //             gameId: gameData._id,
    //             extraSlug: "Game4",
    //             transactionSlug: "extraTransaction",
    //             typeOfTransaction: "Treasure Chest",
    //             action: "credit", // debit / credit
    //             purchasedSlug: "realMoney", // "points", // points /realMoney
    //             totalAmount: Number(amount),
    //         }

    //         await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);

    //         let winningTickets = gameData.patternWinnerHistory;
    //         if (winningTickets.length > 0) {
    //             let ticketId = winningTickets[0].ticketId;
    //             Sys.Game.Game1.Services.GameServices.updateTicket({ _id: ticketId, playerIdOfPurchaser: data.playerId }, { $push: { "tChestWinners": { playerId: data.playerId, WinningAmount: (+amount), ticketId: ticketId } }, $inc: { totalWinningOfTicket: +parseFloat(amount).toFixed(4) } });
    //         }

    //         return {
    //             status: 'success',
    //             result: result,
    //             message: 'Game 4 TreasureChest Winner Amount ..!!'
    //         }


    //     } catch (error) {
    //         console.log("Error in SelectTreasureChest Game4 : ", error);
    //         return new Error(error);
    //     }
    // },

}

