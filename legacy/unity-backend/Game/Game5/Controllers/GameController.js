let Sys = require('../../../Boot/Sys');
// Import the specific helper functions we need
const { 
    isGameAvailableForVerifiedPlayer, 
    createErrorResponse, 
    createSuccessResponse,
    isPlayerVerified,
    deductPlayerBalance,
    getPlayerIp,
    checkGamePlayAtSameTime
} = require('../../../gamehelper/all.js');
const Game5Helper = require('../../../gamehelper/game5.js');
const { isPlayerBlockedFromGame } = require('../../../gamehelper/player_common');
const { i18next, translate } = require('../../../Config/i18n');
const moment = require('moment');
module.exports = {
    // isGameAvailbaleForVerifiedPlayer function
    isGameAvailbaleForVerifiedPlayer: async function(socket, { playerId, language = 'nor' }) {
        try {
            // Use the directly imported helper function
            return await isGameAvailableForVerifiedPlayer({
                playerId,
                language,
                PlayerServices: Sys.Game.Game5.Services.PlayerServices,
                GameServices: Sys.Game.Game5.Services.GameServices,
                gameType: "game_5",
                socket
            });
        } catch (error) {
            console.error("Error in isGameAvailbaleForVerifiedPlayer:", error);
            return await createErrorResponse('something_went_wrong', language, 500);
        }
    },
    
    // GameData function
    GameData: async function(socket, data) {
        try {
            // Destructure variables at the top
            const { playerId, language = "nor", isBotGame: isBotGameParam } = data;
            const isBotGame = Object.hasOwn(data, 'isBotGame') === true;
            
            // Validate playerId
            if (!playerId) {
                return await createErrorResponse("playerid_not_found", language, 400);
            }
            
            // Fetch player and game data in parallel
            const [player, gameData] = await Promise.all([
                Sys.Game.Game5.Services.PlayerServices.getSingleData(
                    { _id: playerId }, 
                    {
                        userType: 1, 
                        uniqueId: 1, 
                        isCreatedByAdmin: 1, 
                        agentId: 1, 
                        email: 1, 
                        hall: 1, 
                        username: 1, 
                        selectedLanguage: 1,
                        groupHall: 1
                    }
                ),
                Sys.Game.Game5.Services.GameServices.getSingleGameData(
                    { gameType: 'game_5' }, 
                    {
                        gameTypeId: 1, 
                        totalNoTickets: 1, 
                        patternNamePrice: 1, 
                        betData: 1, 
                        ticketPrice: 1, 
                        seconds: 1, 
                        otherData: 1, 
                        startDate: 1, 
                        endDate: 1, 
                        days: 1,
                        seconds: 1
                    }
                )
            ]);

            if (!player) {
                return await createErrorResponse("player_not_found", language, 400);
            }
            
            const playerLanguage = player.selectedLanguage || language;
            
            if (!gameData) {
                return await createErrorResponse("game_not_found", playerLanguage, 400);
            }
            
            // Check game validation 
            if (!isBotGame) {
                const gameStatus = await Sys.Game.Common.Controllers.GameController.closeDayValidation({
                    'otherData': gameData.otherData, 
                    'startDate': gameData.startDate, 
                    'endDate': gameData.endDate, 
                    'days': gameData.days
                });
                
                if (!gameStatus || gameStatus.status !== "Open") {
                    return await createErrorResponse("game_closed", playerLanguage, 400);
                }
            }
            
            // First check Redis for the subgame data
            let subGameData = null;
            
            // Query MongoDB to find the game ID
            const subGameQuery = {
                'player.id': playerId, 
                parentGameId: gameData._id, 
                status: {$in: isBotGame ? ["Waiting"] : ["Waiting", "Running"]}
            };
            const subGameProjection = {gameNumber: 1, allPatternArray: 1, history: 1, status: 1, otherData: 1, seconds: 1, withdrawableBalls: 1};
            const subGameIdInfo = await Sys.Game.Game5.Services.GameServices.getSingleSubgameData(subGameQuery, subGameProjection);
            
            // Now get the full game data from Redis if we found an ID
            if (subGameIdInfo && subGameIdInfo._id) {
                // Try to get the game data from Redis using the game helper function
                subGameData = await Game5Helper.getGameDataFromRedis('game5', subGameIdInfo._id);
                
                // If we couldn't get the data from Redis, fall back to MongoDB
                if (!subGameData) {
                    subGameData = subGameIdInfo;
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

            // Create new subgame if needed 
            if (!subGameData) {
                // Create new subgame using the helper function
                subGameData = await Game5Helper.createNewSubgame({
                    data: {...data, gameType: "game_5"},
                    gameData,
                    player,
                    isBotGame,
                    GameServices: Sys.Game.Game5.Services.GameServices
                });
                
                // Setup ticket booking using the helper function
                await Game5Helper.setupTicketBooking({
                    subGameData,
                    gameData,
                    player,
                    data
                });
            }
            
            // Join socket to room if not bot game
            if (!isBotGame && socket) {
                socket.join(subGameData._id);
            }
            
            // Get tickets from Redis
            let tickets = await Game5Helper.getTicketFromRedisByGameId(subGameData._id, false);
            
            // If tickets not found in Redis, fall back to MongoDB and then cache in Redis
            if (!tickets || tickets.length === 0) {
                tickets = await Sys.Game.Game5.Services.GameServices.getTicketsByData(
                    { gameId: subGameData._id }, 
                    { tickets: 1, ticketColorName: 1, ticketPrice: 1, ticketId: 1, supplier: 1, developer: 1, _id: 1 }
                );
            }
            
            // Get minigame ticket from Redis if game is finished
            let miniGameTicket = null;
            if (subGameData.otherData && subGameData.otherData.gameInterState === "Finished") {
                // Try to find a ticket with minigames not yet played from Redis
                if (tickets && tickets.length > 0) {
                    miniGameTicket = tickets.find(t => 
                        t.isPurchased === true && 
                        t.isPlayerWon === true && 
                        (t.bonusWinningStats && t.bonusWinningStats.isMiniGamePlayed === false)
                    );
                }
            }
            
            // Process mini game data using the helper function
            const miniGameData = Game5Helper.processMiniGameData(miniGameTicket, subGameData);
            
            // Process tickets using the helper function
            const { ticketData, ticketIds } = Game5Helper.processTickets(tickets, player.hall.name);
            
            // Update MongoDB in background 
            await Sys.Game.Game5.Services.GameServices.updateSubgame(
                { _id: subGameData._id }, 
                { $set: { 'otherData.ticketIds': ticketIds } }
            );
            
            // Prepare result
            const result = {
                gameId: subGameData._id,
                patternList: subGameData.allPatternArray.map(({multiplier, pattern, extraWinningsType}) => ({
                    multiplier, 
                    pattern, 
                    extraWinningsType
                })),
                ticketList: ticketData,
                coins: [1, 5, 10, 20, 50],
                maximumBetAmount: 50,
                withdrawBalls: subGameData.history || [],
                rouletteData: [32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26],
                status: subGameData.status,
                totalWithdrawableBalls: subGameData.withdrawableBalls,
                miniGameData: miniGameData,
                BallDrawTime: subGameData.seconds,
                isSoundPlay: (gameData?.seconds >= 2000) ? true: false, 
            };
            
            // Return success response using the helper function
            return await createSuccessResponse(result, 'Game5 Created!', playerLanguage);
            
        } catch (error) {
            console.error("Error in GameData:", error);
            return await createErrorResponse('something_went_wrong', data.language || 'nor', 500);
        }
    },

    // replace/change ticket
    swapTicket: async function(socket, data) {
        try {
            // Destructure variables at the top
            const { playerId, gameId, ticketId, language = "nor" } = data;
            
            // Validate playerId
            if (!playerId) {
                return await createErrorResponse("playerid_not_found", language, 400);
            }
            
            // Fetch player, game data, and ticket in parallel
            const [player, gameData, ticket] = await Promise.all([
                // Get player data
                Sys.Game.Game5.Services.PlayerServices.getSingleData(
                    { _id: playerId },
                    { username: 1, selectedLanguage: 1 }
                ),
                
                // Get subgame data
                Sys.Game.Game5.Services.GameServices.getSingleSubgameData(
                    { _id: gameId, 'player.id': playerId },
                    { status: 1 }
                ),
                
                // Get ticket data
                Sys.Game.Game5.Services.GameServices.getSingleTicketData(
                    { _id: ticketId, gameId, playerIdOfPurchaser: playerId },
                    { tickets: 1, ticketColorName: 1, ticketPrice: 1 }
                )
            ]);
            
            // Basic validations
            const playerLanguage = player?.selectedLanguage || language;
            
            if (!player) {
                return await createErrorResponse("player_not_found", language, 400);
            }
            
            if (!gameData) {
                return await createErrorResponse("game_not_found", playerLanguage, 400);
            }
            
            if (gameData.status !== "Waiting") {
                return await createErrorResponse("game_started", playerLanguage, 400);
            }
            
            if (!ticket) {
                return await createErrorResponse("ticket_data_not_found", playerLanguage, 400);
            }
            
            // Generate new ticket of 9 number from 1 to 36
            const newTicket = await Game5Helper.generateRandomTicket(9, 36);
            
            // Update ticket with new numbers
            await Sys.Game.Game5.Services.GameServices.updateTicket(
                { _id: ticketId, gameId, playerIdOfPurchaser: playerId },
                { tickets: newTicket },
                { new: true }
            );
            
            // Return success response
            return await createSuccessResponse({
                id: ticketId,
                ticket: newTicket,
                color: ticket.ticketColorName,
                price: ticket.ticketPrice
            }, 'ticket updated successfully!', playerLanguage);
            
        } catch (error) {
            console.error("Error in swapTicket:", error);
            return await createErrorResponse('something_went_wrong', data.language || 'nor', 500);
        }
    },

    // When player clicks on play game buttton
    game5Play: async function(socket, data){
        try {
            const { playerId, gameId, purchasedTickets, language = "nor" } = data;
            
            if(!playerId) {
                return await createErrorResponse("playerid_not_found", language, 400);
            }

            // Fetch all required data in parallel
            const [player, mainGameData, gameData] = await Promise.all([
                Sys.Game.Game5.Services.PlayerServices.getSingleData(
                    {_id: playerId}, 
                    {username: 1, walletAmount: 1, monthlyWallet: 1, monthlyWalletAmountLimit: 1, selectedLanguage: 1, bankIdAuth: 1, isVerifiedByHall: 1, isAlreadyApproved: 1, hall: 1, blockRules: 1, startBreakTime: 1, endBreakTime: 1}
                ),
                Sys.Game.Game5.Services.GameServices.getSingleGameData(
                    { gameType: 'game_5' }, 
                    {gameTypeId: 1, totalNoTickets: 1, patternNamePrice: 1, betData: 1, ticketPrice: 1, seconds: 1, otherData: 1, startDate: 1, endDate: 1, days: 1}
                ),
                Sys.Game.Game5.Services.GameServices.getSingleSubgameData(
                    { _id: gameId, 'player.id': playerId}, 
                    {status: 1, gameNumber: 1, otherData: 1}
                )
            ]);

            const playerLanguage = player?.selectedLanguage || language;

            // Validate player and game data
            if (!player) return await createErrorResponse("player_not_found", language, 400);

            if (!gameData.otherData.isBotGame && !isPlayerVerified(player)) return await createErrorResponse("verify_to_play_game", playerLanguage, 400);
            if (!mainGameData || !gameData) return await createErrorResponse("game_not_found", playerLanguage, 400);
            if (gameData.status !== "Waiting") return await createErrorResponse("game_already_started", playerLanguage, 400);

            // Check game day validation for non-bot games
            if (!gameData.otherData.isBotGame) {

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
                    'otherData': mainGameData.otherData, 
                    'startDate': mainGameData.startDate, 
                    'endDate': mainGameData.endDate, 
                    'days': mainGameData.days
                });
                
                if(!gameStatus || gameStatus.status !== "Open") {
                    return await createErrorResponse("game_closed", playerLanguage, 400);
                }

                // Check player break time
                if (player?.startBreakTime && player?.endBreakTime) {
                    const currentTime = moment();
                    if (currentTime.isBetween(player.startBreakTime, player.endBreakTime, null, '[]')) {
                        return await createErrorResponse("break_started_not_purchase", playerLanguage);
                    }
                }
            }
            // Check if player is already in a running game
            const isRunningGame = await checkGamePlayAtSameTime(playerId,"game_5");
            if (isRunningGame.status) {
                return await createErrorResponse(`game_already_started_${isRunningGame.gameType}`, playerLanguage);
            }

            // Process tickets
            const playerPurTickets = JSON.parse(purchasedTickets).list;
            const ticketProcessResult = await Game5Helper.purchaseProcessTickets({
                playerPurTickets,
                gameId,
                playerLanguage,
            });
            
            if (ticketProcessResult.error) return ticketProcessResult.error;
            
            const { bulkupdateTicketData, soldTicketIds, totalAmountOfTickets, gameStartDate } = ticketProcessResult;
            
            // Validate wallet balance
            if (player.walletAmount < totalAmountOfTickets) {
                return await createErrorResponse("Insufficient_balance", playerLanguage, 400);
            }

            // Check monthly wallet limit for non-bot games
            if (!gameData.otherData.isBotGame && player.monthlyWallet && player.monthlyWalletAmountLimit < totalAmountOfTickets) {
                return await createErrorResponse("update_wallet_limit", playerLanguage, 400);
            }

            // Deduct player balance
            const deductUserWallet = await deductPlayerBalance(player, totalAmountOfTickets, 'realMoney');
            if (!deductUserWallet.success) {
                return await createErrorResponse(deductUserWallet.errorKey, playerLanguage, 401);
            }

            // Update game data
            await Sys.Game.Game5.Services.GameServices.updateSubgame(
                { _id: gameId }, 
                {   
                    $inc: { 
                        ticketSold: bulkupdateTicketData.length, 
                        earnedFromTickets: totalAmountOfTickets, 
                        finalGameProfitAmount: totalAmountOfTickets,
                    },
                    $set: {
                        createdAt: gameStartDate,
                        startDate: gameStartDate,
                        'otherData.ticketIds': soldTicketIds
                    } 
                },
                { new: true }
            );
            
            // Create transaction record
            const newExtraTransaction = {
                playerId,
                gameId,
                transactionSlug: "game5Transactions",
                typeOfTransaction: "Game Joined",
                action: "debit",
                purchasedSlug: "realMoney",
                defineSlug: "buyTicket",
                extraSlug: "Game5",
                remark: "Game 5 Joined",
                totalAmount: totalAmountOfTickets,
                previousBalance: deductUserWallet.deductResult?.walletAmount + totalAmountOfTickets || 0,
                afterBalance: deductUserWallet.deductResult?.walletAmount || 0
            };

            // Start background operations
            const promises = [
                Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction),
                bulkupdateTicketData.length > 0 ? 
                    Sys.Game.Game5.Services.GameServices.bulkWriteTicketData(bulkupdateTicketData) : 
                    Promise.resolve(),
                Sys.Game.Common.Controllers.PlayerController.checkBreakTime(playerId)
            ];

            // Create notification for real players
            if (!gameData.otherData.isBotGame) {
                const message = { 
                    en: await translate({
                        key: "game5_ticket_purchase", 
                        language: 'en', 
                        isDynamic: true, 
                        number: gameData.gameNumber, 
                        number1: bulkupdateTicketData.length
                    }), 
                    nor: await translate({
                        key: "game5_ticket_purchase", 
                        language: 'nor', 
                        isDynamic: true, 
                        number: gameData.gameNumber, 
                        number1: bulkupdateTicketData.length 
                    })
                };
                
                promises.push(Sys.Game.Common.Services.NotificationServices.create({
                    playerId,
                    gameId,
                    notification: {
                        notificationType: 'purchasedTickets',
                        message,
                        ticketMessage: message,
                        price: totalAmountOfTickets,
                        date: new Date()
                    }
                }));
            }

            // Start game process and execute background operations
            Sys.Game.Game5.Controllers.GameProcess.startGame(gameId,player.hall);
            Promise.all(promises).catch(err => console.error("Background operation error:", err));

            return await createSuccessResponse(null, 'ticket purchased successfully!', playerLanguage);
            
        } catch(error) {
            console.log("Error in game5Play:", error);
            return await createErrorResponse('something_went_wrong', data.language || 'nor', 500);
        }
    },

    // When player clicks on leave game button
    leftRoom: async function(socket, data) {
        try {
            const { playerId, gameId, language = "nor" } = data;
            
            // Fetch player and game data in parallel
            const [player, gameData] = await Promise.all([
                Sys.Game.Game5.Services.PlayerServices.getSingleData(
                    { _id: playerId }, 
                    { username: 1, selectedLanguage: 1 }
                ),
                Sys.Game.Game5.Services.GameServices.getSingleSubgameData(
                    { _id: gameId }, 
                    { status: 1 }
                )
            ]);
            
            // Check if player exists
            if (!player) {
                return await createErrorResponse('player_not_found', language, 400);
            }
            
            // Check if game exists
            if (!gameData) {
                return await createErrorResponse('game_not_found', player.selectedLanguage, 400);
            }
            
            // Leave the socket room
            socket.leave(gameId, () => {
                console.log("player left game 5", player.username, gameId);
            });
            
            return await createSuccessResponse(null, 'player left successfully!', player.selectedLanguage);
        } catch (error) {
            console.log("Error in leftRoom:", error);
            return await createErrorResponse('something_went_wrong', data.language || 'nor', 500);
        }
    },

    checkForBotGame5: async function(data){
        try{
            const { action } = data;
            console.log("check for game 5 bot game", data);
            
            const gameData = await Sys.Game.Game5.Services.GameServices.getSingleGameData(
                { gameType: 'game_5', 'otherData.isBotGame': true }, 
                {seconds: 1, otherData: 1}
            );

            if (!gameData) {
                return await createErrorResponse('Bot game Not Found!', 'nor', 400, false);
            }
            
            const { _id, otherData } = gameData;
            const { botGameCount, totalBotGamePlayed } = otherData;
            
            console.log("played game count", totalBotGamePlayed, botGameCount);
            
            if(totalBotGamePlayed < botGameCount){
                module.exports.startBotGame({parentGameId: _id, action});
            } else {
                await Sys.App.Services.GameService.updateGameData(
                    { _id }, 
                    { $set: {'otherData.isBotGameStarted': false } }
                );
            }
        } catch(e){
            console.log("Error in check for bot games", e);
            return await createErrorResponse('something_went_wrong', 'nor', 500);
        }
    },

    // Start bot game
    startBotGame: async function(data){
        try{
            const { parentGameId, action } = data;
            
            // Fetch game data
            const gameData = await Sys.Game.Game5.Services.GameServices.getSingleGameData(
                { 
                    _id: parentGameId, 
                    gameType: 'game_5', 
                    'otherData.isBotGame': true, 
                    $expr: {$lt: ["$otherData.totalBotGamePlayed","$otherData.botGameCount"]} 
                }, 
                { seconds: 1, otherData: 1 }
            );
            
            if (!gameData) {
                return await createErrorResponse('Bot game Not Found!', 'nor', 400, false);
            }
            
            // Find eligible bot player
            const players = await Sys.App.Services.PlayerServices.aggregateQuery([
                { $match: { "userType": "Bot", walletAmount: {$gte: 200} } },
                { $sample: { size: 1 } },
                { $project: {_id: 1} }
            ]);
            
            if(players.length === 0) {
                return module.exports.startBotGame(data);
            }
            
            const botPlayerId = players[0]._id.toString();
            
            // Get game data for bot
            const isGame = await module.exports.GameData(null, {
                playerId: botPlayerId, 
                isBotGame: true
            });
            
            if(isGame.status !== "success" || !isGame.result?.ticketList?.length) {
                console.log("game 5 GAmeData response is not success or ticket length is zero.");
                return module.exports.startBotGame(data);
            }
            
            // Prepare purchased tickets
            const ticketList = isGame.result.ticketList;
            const purchasedTickets = ticketList.map(ticket => ({
                id: ticket.id,
                price: Game5Helper.generateRandomTicketPrice(1, 50)
            }));
            
            // Prepare query for game5Play
            const query = {
                playerId: botPlayerId,
                gameId: isGame.result.gameId,
                purchasedTickets: `{"list": ${JSON.stringify(purchasedTickets)}}`
            };
            
            // Update parent game to mark bot game as started
            const updateResult = await Sys.App.Services.GameService.updateGameData(
                { _id: data.parentGameId, 'otherData.isBotGameStarted': false },
                { $set: {'otherData.isBotGameStarted': true } }
            );
            
            // Log action type and proceed if update was successful
            if(data.action === "gameEdited") {
                console.log("updatedParentGame----", updateResult);
                if(updateResult?.modifiedCount === 1) {
                    module.exports.game5Play(null, query);
                }
            } else {
                console.log("start game 5 play from bot");
                module.exports.game5Play(null, query);
            }
        } catch(e) {
            console.log("Error in start bot Game", e);
        }
    },

    // Refund players when game is not finished 
    refundGame5: async function(){
        try {
            // Fetch all running games in one query
            const games = await Sys.Game.Game5.Services.GameServices.getSubgameByData(
                { status: "Running" }, 
                { gameNumber: 1, earnedFromTickets: 1, status: 1, otherData: 1, player: 1 }
            );
            
            if (!games || games.length === 0) return;
            
            // Process games in batches to avoid memory issues with large number of games
            const BATCH_SIZE = 10; // Process 10 games at a time
            
            for (let i = 0; i < games.length; i += BATCH_SIZE) {
                const batch = games.slice(i, i + BATCH_SIZE);
                
                // Process current batch in parallel
                await Promise.all(batch.map(async (game) => {
                    try {
                        // Handle bot games
                        if (game.otherData.isBotGame) {
                            return Sys.Game.Game5.Services.GameServices.updateSubgame(
                                { _id: game._id }, 
                                { $set: { status: "Cancel" } },
                                { new: true }
                            );
                        }
                        
                        // Handle regular games
                        if (game.otherData.gameInterState === "Running") {
                            // Update player balance and create transaction in parallel
                            const [player] = await Promise.all([
                                Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                                    { _id: game.player.id }, 
                                    { $inc: { 
                                        walletAmount: +game.earnedFromTickets, 
                                        monthlyWalletAmountLimit: +game.earnedFromTickets 
                                    }}
                                ),
                                Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                                    type: "cancel",
                                    playerId: game.player.id,
                                    hallId: '',
                                    cancel: +game.earnedFromTickets
                                }),
                                Sys.Game.Game5.Services.GameServices.updateSubgame(
                                    { _id: game._id }, 
                                    { $set: {
                                        ticketSold: 0, 
                                        earnedFromTickets: 0, 
                                        finalGameProfitAmount: 0,
                                        status: "Cancel"
                                    }},
                                    { new: true }
                                ),
                                Sys.App.Services.GameService.deleteTicketMany(game._id)
                            ]);
                            
                            if (player) {
                                // Create transaction record
                                const newExtraTransaction = {
                                    playerId: game.player.id,
                                    gameId: game._id,
                                    transactionSlug: "game5Transactions",
                                    typeOfTransaction: "Cancel Ticket",
                                    action: "credit",
                                    purchasedSlug: "realMoney",
                                    defineSlug: "Cancel Ticket",
                                    extraSlug: "Game5",
                                    remark: "Game 5 Cancel Ticket",
                                    totalAmount: game.earnedFromTickets,
                                    previousBalance: player.walletAmount - (+game.earnedFromTickets),
                                    afterBalance: player.walletAmount
                                };
                                
                                // Don't await this operation to avoid blocking
                                Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                            }
                        } else {
                            // Update game status to Finished
                            return Sys.Game.Game5.Services.GameServices.updateSubgame(
                                { _id: game._id }, 
                                { $set: { status: "Finished" }},
                                { new: true }
                            );
                        }
                    } catch (gameError) {
                        console.error(`Error processing game ${game._id}:`, gameError);
                        // Continue with other games even if one fails
                    }
                }));
                
                // Small delay between batches to prevent overwhelming the server
                if (i + BATCH_SIZE < games.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        } catch (e) {
            console.log("Error in refunding game 5:", e);
        }
    }

}