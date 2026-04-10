const Sys = require('../../../Boot/Sys');
const moment = require('moment');
const { translate } = require('../../../Config/i18n');
const { 
    createErrorResponse, 
    createSuccessResponse,
    isPlayerVerified,
    processVoucherCode,
    sendGameChatCommon,
    gameChatHistoryCommon,
    checkPlayerBreakTimeWithActiveGames,
    emitBreakTimeStatus,
    findAvailableGameForDay,
    checkGameAvailability,
    getGameDataFromRedisHmset,
    getPlayerIp,
    checkGamePlayAtSameTime
} = require('../../../gamehelper/all.js');
const {
    validateGameTiming,
    processPurchase,
    handleAutoPlay,
    checkAndStartGame,
    getUpdatedTickets,
    createGameNotification,
    processCancelTickets,
    getOnlinePlayers,
    normalizeGame2JackpotData,
    processJackpotNumbers,
    processRefundAndFinishGameCron
} = require('../../../gamehelper/game2');
const { isPlayerBlockedFromGame } = require('../../../gamehelper/player_common.js');

module.exports = {

    game2Room: async function (socket, data) {
        const {  playerId, language: _language = "nor", hall: hallId } = data;
        
        const currentTime = moment();
        const currentDay = currentTime.format('ddd');

        try {
            // Execute all initial DB queries in parallel
            const [player, hall, game] = await Promise.all([
                Sys.Game.Game2.Services.PlayerServices.getById(playerId, {
                    selectedLanguage: 1,
                    startBreakTime: 1,
                    endBreakTime: 1,
                    socketId: 1,
                    userType: 1,
                    bankIdAuth: 1,
                    isVerifiedByHall: 1,
                    isAlreadyApproved: 1,
                    hall: 1,
                    blockRules: 1
                }),
                Sys.Game.Common.Services.GameServices.getSingleHallByData({ 
                    _id: hallId, 
                    status: "active" 
                }, {_id: 1}),
                Sys.Game.Game2.Services.GameServices.getSingleParentGame({
                    gameType: "game_2",
                    stopGame: false,
                    status: { $ne: "finish" },
                    allHallsId: { $in: [hallId] },
                }, {gameName: 1, days: 1, otherData: 1})
            ]);

            // Player validation
            if (!player) {
                return await createErrorResponse("player_not_found", _language);
            }

            const language = player.selectedLanguage || _language;

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
                return await createErrorResponse("player_blocked_game", language, 400);
            }

            // Verify player (skip for bots)
            if (player.userType !== "Bot" && !(isPlayerVerified(player))) {
                return await createErrorResponse("verify_to_play_game", language, 400);
            }
            
            // Hall validation
            if (!hall) {
                return await createErrorResponse("game_not_found", language);
            }

            // Game validation
            if (!game) {
                return await createErrorResponse("game2_slot_not_available", language);
            }

            // Process break time check and emit
            const isBreak = await checkPlayerBreakTimeWithActiveGames(player._id, player?.startBreakTime, player?.endBreakTime, currentTime);
            emitBreakTimeStatus(player.socketId, player?.startBreakTime, player?.endBreakTime, isBreak);
            
            // Check current day and next day games
            const finalResult = await findAvailableGameForDay(game, currentTime, currentDay, player?.startBreakTime, player?.endBreakTime, isBreak, "Game2");
           
            if (Object.keys(finalResult).length) {
                return await createSuccessResponse(
                    finalResult,
                    'game found',
                    language
                );
            }

            // Check next day games if no current day games found
            const nextDay = moment().add(1, 'day');
            const nextDayName = nextDay.format('ddd');
            const nextDayResult = await findAvailableGameForDay(game, nextDay, nextDayName, player?.startBreakTime, player?.endBreakTime, isBreak, "Game2");
            
            if (Object.keys(nextDayResult).length) {
                return await createSuccessResponse(
                    nextDayResult,
                    'game found',
                    language
                );
            }
            // NO game slot found for current user and hall
            return await createErrorResponse( "game2_slot_not_available", language);

        } catch (error) {
            console.error("Error In Game2Room function:", error);
            return await createErrorResponse(
                "something_went_wrong", 
                data.language || "nor"
            );
        }
    },

    subscribeRoom: async function (socket, data) {
        try {
            const { playerId, gameId, language: reqLanguage = "nor", previousGameId } = data;
            
            // Parallel fetch of initial data
            const [player, gameData] = await Promise.all([
                Sys.Game.Game2.Services.PlayerServices.getById(playerId, {
                    selectedLanguage: 1,
                    bankIdAuth: 1,
                    isVerifiedByHall: 1,
                    isAlreadyApproved: 1,
                    userType: 1
                }),
                Sys.Game.Game2.Services.GameServices.getSingleParentGame(
                    { 
                        _id: gameId, 
                        stopGame: false, 
                        status: { $in: ['running', 'active'] }, 
                        "otherData.isBotGame": false 
                    },
                    { days: 1, otherData: 1 }
                )
            ]);
    
            // Validation checks
            if (!player) {
                return await createErrorResponse("player_not_found", reqLanguage);
            }
    
            if (!gameData) {
                return await createErrorResponse("game_not_found", player.selectedLanguage);
            }
    
            // Verify player (skip for bots)
            if (player.userType !== "Bot" && !(isPlayerVerified(player))) {
                return await createErrorResponse("verify_to_play_game", player.selectedLanguage, 400);
            }
            
            // Check game availability
            const currentTime = moment().format('HH:mm');
            const room = await checkGameAvailability(gameData, currentTime);
    
            if (!room || room.length === 0) {
                return await createErrorResponse("game2_not_available", player.selectedLanguage);
            }
    
            // Get active room
            const activeRoom = room.find(r => r.status === 'running') || room[0];
    
            // Setup socket
            socket.join(gameId.toString());
            socket.join(`${activeRoom._id.toString()}_ticketPurchase`);
            socket.myData = {
                playerID: playerId,
                gameId: gameId.toString(),
                gameType: 'game_2',
                gameName: 'MartinBingo'
            };
    
            // Process room data in parallel
            const [
                onlinePlayers,
                updatedGame,
                playerTickets
            ] = await Promise.all([
                getOnlinePlayers('/Game2', gameId),
                Sys.Game.Game2.Services.GameServices.updateSingleGame(
                    { _id: activeRoom._id, "players.id": playerId },
                    {
                        $set: {
                            "players.$.socketId": socket.id,
                            "players.$.isPlayerOnline": true
                        }
                    },
                    {new: false}
                ),
                Sys.Game.Game2.Services.GameServices.getTicketByData({
                    gameId: activeRoom._id,
                    playerIdOfPurchaser: playerId,
                    isCancelled: false,
                    isPurchased: true,
                }, {
                    ticketId: 1,  
                    ticketNumber: 1,
                    tickets: 1,
                    hallName: 1,
                    supplier: 1,
                    developer: 1,
                    isPlayerWon: 1,  // ticketCompleted we need to map this with room data so need to update ticket also
                    totalWinningOfTicket: 1
                })
            ]);

            // const winnersMap = new Map(
            //     (activeRoom?.winners || []).map(w => [
            //         String(w.ticketId),
            //         w.finalWonAmount
            //     ])
            // );
            // Process tickets and jackpot
            const processedTickets = playerTickets.map(ticket => {
                //const winningAmount = winnersMap.get(String(ticket._id));
            
                return {
                    id: ticket._id,
                    ticketNumber: ticket.ticketId,
                    ticketPrice: +activeRoom?.ticketPrice,
                    ticketCellNumberList: ticket.tickets,
                    hallName: ticket.hallName,
                    supplierName: ticket.supplier,
                    developerName: ticket.developer,
                    ticketCompleted: ticket.isPlayerWon,
                    winningAmount: ticket?.totalWinningOfTicket || 0
                };
            });
            
            const jackPotNumberList = processJackpotNumbers(
                activeRoom.jackPotNumber,
                activeRoom.totalNoPurchasedTickets,
                activeRoom.ticketPrice
            );
            
            // Calculate total bet amount
            const betAmount = Math.round( processedTickets.length * activeRoom.ticketPrice );
    
            // Check if cancel button should be disabled
            const disableCancelButton = 
                activeRoom.status !== 'active' || 
                activeRoom.isNotificationSent || 
                Sys.Running.indexOf(`${activeRoom.gameNumber}`) > -1;
    
            // Get player specific data
            const playerData = activeRoom.players.find(
                item => item.id.toString() === playerId.toString()
            );
            let withdrawNumberList = Array.isArray(activeRoom.withdrawNumberList)
                ? activeRoom.withdrawNumberList
                : [];
            if(Sys.Running.indexOf(activeRoom.gameNumber) > -1 || activeRoom.status == 'running'){
                const history = await getGameDataFromRedisHmset('game2', activeRoom._id.toString(), 'history');
                if (Array.isArray(history)) withdrawNumberList = history;
            }
            // Prepare response
            const result = {
                luckyNumber: playerData?.luckyNumber || '',
                autoPlay: playerData?.autoPlay || false,
                activePlayers: onlinePlayers,
                totalWithdrawCount: withdrawNumberList.length,
                jackpotList: jackPotNumberList,
                withdrawNumberList: withdrawNumberList,
                ticketList: processedTickets,
                gameId: gameId.toString(),
                subGameId: activeRoom._id.toString(),
                gameStarted: Sys.StartedGame.indexOf(activeRoom._id.toString()) >= 0,
                totalBetAmount: betAmount,
                disableCancelButton,
                isSoundPlay: (activeRoom?.seconds >= 2000) ? true: false, 
            };
            
            // Emit updates
            Sys.Io.of(Sys.Config.Namespace.Game2).to(gameId).emit(
                'UpdatePlayerRegisteredCount',
                { playerRegisteredCount: onlinePlayers }
            ),
            Sys.Io.of(Sys.Config.Namespace.Game2).to(socket.id).emit(
                'SubscribeRoom',
                result
            )
    
            return await createSuccessResponse(
                '',
                "Player subscribed successfuly",
                player.selectedLanguage,
                false
            );
    
        } catch (error) {
            console.error("Error in subscribeRoom:", error);
            throw error;
        }
    },

    // [ Game 2 Listing ]
    game2List: async function (socket, data) {
        try {
            const { playerId, language: reqLanguage = "nor", gameId } = data;
            const RunningGames = Sys.StartedGame;
            const currentDate = moment().format('YYYY-MM-DD');

            const player = await Sys.Game.Game2.Services.PlayerServices.getById(playerId, {
                selectedLanguage: 1,
                hall: 1
            });

            if (!player) return await createErrorResponse("player_not_found", reqLanguage);
            const language = player.selectedLanguage || reqLanguage;

            const gameQuery = {
                _id: { $nin: RunningGames },
                gameType: "game_2",
                parentGameId: await Sys.Helper.bingo.obId(gameId),
                status: 'active',
                "otherData.isBotGame": false,
                allHallsId: { $in: [player.hall.id.toString()] },
            };

            const gameProjection = { startDate: 1, players: 1, gameName: 1, ticketPrice: 1 };
            const gamesData = await Sys.Game.Game2.Services.GameServices.getByData(gameQuery, gameProjection)
            if (!gamesData.length) return await createErrorResponse("no_game_available", language);

            // Process games in parallel using Promise.all and map
            const finalListing = await Promise.all(
                gamesData.map(async game => {
                    // Skip outdated games
                    if (moment(game.startDate).format('YYYY-MM-DD') < currentDate) {
                        // Fire and forget refund operation
                        module.exports.refundGame({ gameId: game._id }).catch(err => 
                            console.error(`Refund failed for game ${game._id}:`, err)
                        );
                        return null;
                    }

                    // Efficient player and ticket lookup
                    const playerInGame = game.players.find(p => p.id.toString() === playerId);
                    // const playerTickets = game.purchasedTickets.filter(
                    //     ticket => ticket.playerIdOfPurchaser.toString() === playerId
                    // );
                    //const ticketCount = playerTickets.length;
                    const ticketCount = playerInGame?.ticketCount || 0;
                    const index = Sys.Running.indexOf(game.gameNumber);

                    return {
                        id: game._id.toString(),
                        name: game.gameName,
                        purchasedTicket: ticketCount,
                        maxTicket: 30,
                        luckyNumber: playerInGame?.luckyNumber || 0,
                        ticketPrice: game.ticketPrice,
                        cancelButton: index >= 0 ? false : ticketCount > 0
                    };
                })
            );

            // Filter out null entries (from outdated games)
            const validGames = finalListing.filter(Boolean);

            return await createSuccessResponse(
                { upcomingGames: validGames },
                'gameList List',
                language
            );
        } catch (error) {
            console.log("Error In Game2 Listing function", error);
            return {
                status: 'fail',
                result: null,
                message: await translate({ key: "something_went_wrong", language: language }), // 'Something Went Wrong',
                statusCode: 400
            }
        }
    },

    /**
     * [ Ticket List ]
     * Handles fetching and generating tickets for a player in Game 2.
     * @param {Object} socket - The socket object for real-time communication.
     * @param {Object} data - Contains player ID, sub game ID, and language settings.
     * @returns {Object} Response object with status, result, and message.
     */
    game2Ticket: async function (socket, data) {
        try {
            const { playerId, subGameId, language = "nor" } = data;
            // Fields to fetch from tickets
            const ticketFields = { _id: 1, tickets: 1, isPurchased: 1, ticketId: 1, playerIdOfPurchaser: 1 };
            
            // Fetch player, game and ticket data concurrently
            const [player, gameData, _tickets] = await Promise.all([
                Sys.Game.Game2.Services.PlayerServices.getOneByData({_id: playerId}, { selectedLanguage: 1 }),
                Sys.Game.Game2.Services.GameServices.getSingleGameByData(
                    { _id: subGameId, status: "active" },
                    { status: 1, players: 1, ticketPrice: 1, minTicketCount: 1, rocketLaunch: 1, jackPotNumber: 1, parentGameId: 1, gameTypeId: 1 }
                ),
                Sys.Game.Game2.Services.GameServices.getTicketByData(
                    { gameId: subGameId, playerIdOfPurchaser: playerId },
                    ticketFields
                )
            ]);
            let tickets = _tickets;
            // Validate player existence
            if (!player) {
                return await createErrorResponse("player_not_found", language, 400);
            }

            // Validate game data
            if (!gameData) {
                return await createErrorResponse("game_already_started", player.selectedLanguage, 400, true, "something_went_wrong");
            }

            // Check if the game is active and not already started
            if (gameData.status !== "active" || Sys.StartedGame.includes(gameData._id.toString())) {
                return await createErrorResponse("game_already_started", player.selectedLanguage, 400);
            }

            // Determine if tickets need to be generated
            let shouldGenerateTickets = tickets.length === 0;

            if (shouldGenerateTickets) {
                // Generate tickets if none exist
                const ticketData = {
                    columns: 3,
                    slug: "game_2",
                    ticketSize: 40,
                    gameId: gameData._id,
                    parentId: gameData.parentGameId,
                    ticketPrice: Math.round(parseFloat(gameData.ticketPrice)),
                    playerId: player._id,
                };

                await Sys.Helper.bingo.ticketBook(ticketData);
                tickets = await Sys.Game.Game2.Services.GameServices.getTicketByData(
                    { gameId: subGameId, playerIdOfPurchaser: playerId }, 
                    ticketFields
                );
            }

            // Process tickets in a single loop using reduce
            const { ticketsArr, purchasedCount } = tickets.reduce((acc, ticket) => {
                // Map the ticket structure
                acc.ticketsArr.push({
                    id: ticket._id,
                    ticketNumber: ticket.ticketId,
                    ticketPrice: Math.round(parseFloat(gameData.ticketPrice)),
                    ticketCellNumberList: ticket.tickets,
                    isPurchased: ticket.isPurchased,
                    playerIdOfPurchaser: ticket.playerIdOfPurchaser
                });

                // Count purchased tickets
                if (ticket.isPurchased) {
                    acc.purchasedCount++;
                }

                return acc;
            }, { ticketsArr: [], purchasedCount: 0 });

            // Find player's lucky number and autoplay status
            let { luckyNumber = 0, autoPlay = false } = gameData.players.find(p => p.id.toString() === player._id.toString()) || {};

            // Create result object
            let result = {
                luckyNumber,
                autoPlay,
                ownPurchasedTicketCount: purchasedCount,
                ticketPrice: Math.round(parseFloat(gameData.ticketPrice)),
                ticketList: ticketsArr,
                rocketLaunch: gameData.rocketLaunch,
                minimumTicket: gameData.minTicketCount,
                totalTicketsPurchased: purchasedCount
            };

            // Join socket rooms for real-time updates
            await Promise.all([
                socket.join(gameData._id.toString()),
                socket.join(`${gameData._id.toString()}_ticketPurchase`)
            ]);

            // Update jackpot data
            this.game2JackpotUpdate({
                gameId: gameData.parentGameId.toString(),
                subGameId: subGameId,
                jackpotData: gameData.jackPotNumber,
                tickets: purchasedCount,
                ticketPrice: Math.round(parseFloat(gameData.ticketPrice)),
            });

            return await createSuccessResponse(result, "game2 Ticket List with Lucky number");
        } catch (error) {
            console.error("Error game2Ticket", error);
            return await createErrorResponse("something_went_wrong", data.language || "nor");
        }
    },

    // [ Blind Ticket Purchase ] It will be called for ticket purchase by frontend
    blindTicketPurchase: async function (socket, data) {
        try {
            // Destructure all required data at top
            const {
                playerId,
                subGameId,
                parentGameId,
                ticketCount,
                luckyNumber,
                purchaseType,
                voucherCode,
                language = 'nor'
            } = data;

            // Validate required fields
            if (!playerId || !subGameId || !parentGameId) {
                return await createErrorResponse('game_not_found', language);
            }

            // Validate ticket count
            if (ticketCount <= 0 || ticketCount > 30) {
                return await createErrorResponse('select_valid_ticket_count', language);
            }

            // Validate lucky number
            if (luckyNumber <= 0 || luckyNumber > 21) {
                return await createErrorResponse('select_valid_luckynumber', language);
            }

            // Parallel DB calls for initial data
            const [player, game, tickets] = await Promise.all([
                Sys.Game.Game2.Services.PlayerServices.getOneByData(
                    { _id: playerId },
                    { selectedLanguage: 1, userType: 1, hall: 1, blockRules: 1 }
                ),
                Sys.Game.Game2.Services.GameServices.getSingleGameByData(
                    { _id: subGameId, status: "active" },
                    { status: 1, gameTypeId: 1, otherData: 1, parentGameId: 1, ticketPrice: 1 }
                ),
                Sys.Game.Game2.Services.GameServices.getTicketByData(
                    { gameId: subGameId, playerIdOfPurchaser: playerId },
                    { _id: 1, tickets: 1, isPurchased: 1, ticketId: 1, hallName: 1, supplier: 1, developer: 1, playerIdOfPurchaser: 1 }
                )
            ]);

            if (!player) {
                return await createErrorResponse('player_not_found', language);
            }

            if(!game) {
                return await createErrorResponse('game_already_started', language);
            }

            // Use player's language for all subsequent messages
            const playerLanguage = player.selectedLanguage;

            // check if player is blocked from game
            if(!game?.otherData?.isBotGame){
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
                    return await createErrorResponse("player_blocked_game", playerLanguage, 400);
                }
            }
        
            if (!game || game.status !== 'active' || Sys.StartedGame.includes(game._id.toString())) {
                return await createErrorResponse('game_already_started', playerLanguage);
            }

            let selectedTickets;
            if (tickets.length) {
                // Handle existing tickets
                const availableTickets = tickets.filter(t => !t.isPurchased);
                const purchasedCount = tickets.length - availableTickets.length;

                if (availableTickets.length < ticketCount || purchasedCount + ticketCount > 30) {
                    return await createErrorResponse('game2_max_ticket', playerLanguage);
                }
                // Suffle available tikcet and selecr defined count of tickets
                selectedTickets = availableTickets
                    .map(t => t._id.toString())
                    .sort(() => 0.5 - Math.random())
                    .slice(0, ticketCount);
            } else {
                // Generate new tickets
                const ticketSize = game.otherData?.isBotGame ? +ticketCount : 40;
                const ticketData = {
                    columns: 3,
                    slug: "game_2",
                    ticketSize,
                    gameId: game._id,
                    parentId: game.parentGameId,
                    ticketPrice: Math.round(parseFloat(game.ticketPrice)),
                    playerId: player._id,
                    userType: player.userType
                };

                await Sys.Helper.bingo.ticketBook(ticketData);
                
                const newTickets = await Sys.Game.Game2.Services.GameServices.getTicketByData(
                    { gameId: subGameId, playerIdOfPurchaser: playerId },
                    {_id: 1}
                );

                if (!newTickets.length) {
                    return await createErrorResponse('internal_server_error', playerLanguage);
                }

                selectedTickets = newTickets
                    .map(t => t._id.toString())
                    .sort(() => 0.5 - Math.random())
                    .slice(0, ticketCount);
            }

            // Process final purchase
            if (selectedTickets.length) {
                const purchaseData = {
                    subGameId,
                    playerId,
                    luckyNumber,
                    ticketNumberList: JSON.stringify(selectedTickets),
                    autoPlay: false,
                    purchaseType,
                    voucherCode,
                    language: playerLanguage,
                    isBlindTicketPurchase: true,
                };

                return await module.exports.game2TicketPurchased(socket, purchaseData);
            }

            return await createErrorResponse('internal_server_error', playerLanguage);
        } catch (error) {
            console.error("Error in Game2 Blind Ticket Purchase:", error);
            return await createErrorResponse('something_went_wrong', data.language || 'nor', 500);
        }
    },

    // [ Ticket Purchase ] it will be called when choosing tickets
    game2TicketPurchased: async function (socket, data) {
        try {
            // Destructure all required data at top
            const {
                playerId,
                subGameId,
                luckyNumber,
                ticketNumberList,
                autoPlay = false,
                purchaseType,
                voucherCode = '',
                isBlindTicketPurchase = false,
            } = data;
            let language = data.language || "nor";
            // Basic validations
            if (data.purchaseType == null) {
                return await createErrorResponse('purchasetype_not_found', language);
            }
    
            if (data.luckyNumber == null) {
                return await createErrorResponse('lucky_number_not_found', language);
            }

            // Validate lucky number
            if (luckyNumber <= 0 || luckyNumber > 21) {
                return await createErrorResponse('game2_luckynumber_selection', language);
            }

            if (data.ticketNumberList == null) {
                return await createErrorResponse('ticketid_not_found', language);
            }

            // Parse and validate ticket list
            let finalDataTicket = JSON.parse(ticketNumberList.replace(/\\/g, ""));
            if (!Array.isArray(finalDataTicket) || !finalDataTicket.length) {
                return await createErrorResponse('game2_purchase_failed', language);
            }
            
            // Parallel fetch initial data
            const [player, _gameData, voucherData, purchasedTickets] = await Promise.all([
                Sys.Game.Game2.Services.PlayerServices.getById(playerId, {
                    selectedLanguage: 1,
                    points: 1,
                    username: 1,
                    userType: 1,
                    uniqueId: 1,
                    walletAmount: 1,
                    monthlyWallet: 1,
                    monthlyWalletAmountLimit: 1,
                    hall: 1,
                    startBreakTime: 1,
                    endBreakTime: 1,
                    blockRules: 1,
                    socketId: 1,
                }),
                Sys.Game.Game2.Services.GameServices.getSingleGameByData(
                    { _id: subGameId, status: 'active' },
                    {
                        startDate: 1,
                        gameNumber: 1,
                        gameName: 1,
                        gameType: 1,
                        gameMode: 1,
                        ticketPrice: 1,
                        purchasedTickets: 1,
                        groupHalls: 1,
                        players: 1,
                        minTicketCount: 1,
                        parentGameId: 1,
                        otherData: 1,
                        totalNoPurchasedTickets:1
                    }
                ),
                voucherCode ? await processVoucherCode(voucherCode, playerId, language, false) : null,
                Sys.Game.Game2.Services.GameServices.getTicketByData(
                    { gameId: subGameId, playerIdOfPurchaser: playerId, isPurchased: true },
                    { _id: 1 }
                )
            ]);
            let gameData = _gameData;
            language = player.selectedLanguage || language;
            // Validate core data
            if (!player) {
                return await createErrorResponse('player_not_found', language);
            }

            if (!gameData) {
                return await createErrorResponse('game_already_started', language);
            }

            if((gameData.totalNoPurchasedTickets + Number(finalDataTicket.length)) >= gameData.minTicketCount){
                // Check if player is already in a running game
                const isRunningGame = await checkGamePlayAtSameTime(playerId,"game_2");
                if (isRunningGame.status) {
                    return await createErrorResponse(`game_already_started_${isRunningGame.gameType}`, language);
                }
            }

            // check if player is blocked from game
            if(!gameData.otherData?.isBotGame){
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
                    return await createErrorResponse("player_blocked_game", language, 400);
                }
            }
            
            // Check game timing and status
            const timingValidation = await validateGameTiming(gameData, player);
            if (!timingValidation.isValid) {
                return await createErrorResponse(timingValidation.error, language);
            }

            // Process purchase
            const purchasedTicketIds = purchasedTickets.map(t => t._id.toString());
            const purchaseResult = await processPurchase(
                player,
                gameData,
                finalDataTicket,
                purchaseType,
                voucherData,
                purchasedTicketIds,
                luckyNumber,
                autoPlay,
                socket
            );

            if (!purchaseResult.isValid) {
                return await createErrorResponse(purchaseResult.error, language, 400, true, null, purchaseResult?.result);
            }

            const {
                updatedGame = null,
                tickets = null,
                totalPayableAmount: updatedAmount = null
            } = purchaseResult;
            
            if (updatedGame) gameData = updatedGame;
            //if (tickets) purchasedTickets = tickets;
            if (updatedAmount) totalPayableAmount = updatedAmount;

            // Update player count for frontend
            let onlinePlayers = await getOnlinePlayers('/Game2', gameData.parentGameId.toString());
            const purchasedTicketsCount = Array.isArray(gameData.purchasedTickets)
                ? gameData.purchasedTickets.length
                : (gameData.totalNoPurchasedTickets || 0);
            Sys.Io.of(Sys.Config.Namespace.Game2).to(data.subGameId).emit('UpdatePlayerRegisteredCount', { playerRegisteredCount: onlinePlayers });
            Sys.Io.of(Sys.Config.Namespace.Game2).to(data.subGameId).emit('game2PurchasedTicketsCount', { purchasedTicketsCount });
            !isBlindTicketPurchase && Sys.Io.to(player.socketId).emit('PlayerHallLimit', { }); // Required as it is not re subscribing
            // Handle auto-play if enabled
            if (autoPlay) {
                await handleAutoPlay(player, gameData, purchaseType, finalDataTicket.length, totalPayableAmount, socket.id, luckyNumber);
            }

            // Update game state and emit events
            await checkAndStartGame(gameData,  player, socket, purchaseResult.tickets);

            if(!autoPlay){
                const jacpotEvent = {
                    gameId: gameData.parentGameId.toString(),
                    subGameId: data.subGameId,
                    jackpotData: normalizeGame2JackpotData(gameData.jackPotNumber),
                    tickets: purchasedTicketsCount,
                    ticketPrice: gameData.ticketPrice
                }

                this.game2JackpotUpdate(jacpotEvent);
    
                createGameNotification({
                    playerId,
                    gameData:  {_id: gameData._id, gameNumber: gameData.gameNumber, gameName: gameData.gameName, startDate: gameData.startDate, graceDate: gameData.graceDate},
                    ticketCount: finalDataTicket.length,    
                    totalPayableAmount,
                    type: "Purchase"
                });
                
            }

            // Return success response
            return createSuccessResponse(
                await getUpdatedTickets(subGameId, playerId, gameData),
                "tickets_purchased", language, true
            );

        } catch (error) {
            console.error("Error in game2TicketPurchased:", error);
            return createErrorResponse('something_went_wrong', data?.language || 'nor', 500);
        }
    },

    game2JackpotUpdate: async function (data) {
        try {
            const { jackpotData, tickets, ticketPrice, subGameId } = data;

            const jackPotNumberList = processJackpotNumbers(
                jackpotData,
                tickets,
                ticketPrice
            );
            
            Sys.Io.of(Sys.Config.Namespace.Game2)
                .to(`${subGameId}_ticketPurchase`)
                .emit('JackpotListUpdate', { jackpotList: jackPotNumberList });
                
            return jackPotNumberList; // Return for potential future use
        } catch (error) {
            console.log("Error in game2JackpotUpdate function:", error);
            return []; // Return empty array on error
        }
    },
    
    // [ Cancel all Ticket ]
    cancelGameTickets: async function (socket, data) {
        try {
            const { playerId, language, subGameId, hallIds = null, isRefund = false } = data;
            return await processCancelTickets({
                playerId,
                subGameId,
                hallIds,
                language,
                singleDelete: false,
                isRefund,
                createErrorResponse,
                createSuccessResponse
            });
        } catch (error) {
            console.error("Error in cancelGameTickets:", error);
            return await createErrorResponse('something_went_wrong', data?.language || 'nor', 500);
        }
    },

    // [ Cancel Single Ticket ]
    cancelTicket: async function (socket, data) {
        try {
            const { playerId, language, gameId, ticketId } = data;
            return await processCancelTickets({
                playerId,
                subGameId: gameId,
                ticketId,
                language,
                singleDelete: true,
                createErrorResponse,
                createSuccessResponse
            });
        } catch (error) {
            console.log("Error in game2 Lucky Number Selection", error);
            return await createErrorResponse('something_went_wrong', data?.language || 'nor', 500);
        }
    },

    // [ Left Room ]
    leftRoom: async function (socket, data) {
        try {
            const { playerId, gameId, language = 'nor' } = data;
            
            const player = await Sys.Game.Game2.Services.PlayerServices.getById(playerId, { _id: 1 });
            if (!player) {
                return await createErrorResponse("player_not_found", language);
            }
    
            await new Promise((resolve, reject) => {
                socket.leave(gameId, (err) => {
                    if (err) reject(err);
                    else {
                        console.log("player left game2", gameId)
                        resolve();
                    }
                });
            });
    
            const onlinePlayers = await getOnlinePlayers('/Game2', gameId);
            console.log("onlinePlayers", onlinePlayers)
            Sys.Io.of(Sys.Config.Namespace.Game2).to(gameId).emit('UpdatePlayerRegisteredCount', {
                playerRegisteredCount: onlinePlayers
            });
            Sys.Io.of(Sys.Config.Namespace.Game2).to(gameId).emit('GameOnlinePlayerCount', { onlinePlayerCount: onlinePlayers });
    
            return await createSuccessResponse(null, "player left successfully!", language);
        } catch (e) {
            console.error("Error in leftRoom:", e);
            return await createErrorResponse("something_went_wrong", language, 500);
        }
    },
    
    // [ Chat ]
    sendGameChat: async function (socket, data) {
        try {
            return await sendGameChatCommon({
                data,
                PlayerServices: Sys.Game.Game2.Services.PlayerServices,
                getGameServices: Sys.Game.Game2.Services.GameServices.getSingleParentGame,
                ChatServices: Sys.Game.Game2.Services.ChatServices,
                IoNamespace: Sys.Io.of(Sys.Config.Namespace.Game2),
                socketId: socket.id
            });
        } catch (error) {
            console.log("Error sendGameChat", error);
            return await createErrorResponse("something_went_wrong", language, 500);
        }
    },

    // [ Chat History ]
    gameChatHistory: async function (socket, data) {
        try {
            return await gameChatHistoryCommon({
                data,
                PlayerServices: Sys.Game.Game2.Services.PlayerServices,
                getGameServices: Sys.Game.Game2.Services.GameServices.getSingleParentGame,
                ChatServices: Sys.Game.Game2.Services.ChatServices,
                IoNamespace: Sys.Io.of(Sys.Config.Namespace.Game2),
                namespace: "/Game2"
            });
        } catch (error) {   
            return await createErrorResponse("something_went_wrong", data?.language || 'nor', 500);
        }
    },

    // [ Left Rocket Room ]
    leftRocketRoom: async function (socket, data) {
        try {
            socket.leave(data.gameId);
            return;
        } catch (e) {
            console.log("Error in leftRoom : ", e);
            return new Error(e);
        }
    },

    //[Game 2 Lucky Number]
    
    game2LuckyNumber: async function (socket, data) {
        try {
            // Destructure all required data at the top
            const { playerId, gameId, luckyNumber, language: userLanguage = 'nor' } = data;
            let language = userLanguage;

            // Validate required fields first
            if (!playerId) {
                return await createErrorResponse('playerid_not_found', language);
            }

            if (!gameId) {
                return await createErrorResponse('game_not_found', language);
            }

            if (!luckyNumber) {
                return await createErrorResponse('lucky_number_not_found', language);
            }

            if (luckyNumber < 1 || luckyNumber > 21) {
                return await createErrorResponse('select_valid_luckynumber', language);
            }

            // Make parallel DB calls
            const [player, game] = await Promise.all([
                Sys.Game.Game2.Services.PlayerServices.getById(playerId, { selectedLanguage: 1 }),
                Sys.Game.Game2.Services.GameServices.getSingleGameByData(
                    { _id: gameId, status: 'active' },
                    { _id: 1 }
                )
            ]);

            // Update language based on player preference
            if (!player) {
                return await createErrorResponse('player_not_found', language);
            } 
            language = player.selectedLanguage;
            

            if (!game) {
                return await createErrorResponse('game_not_found', language, 400, true, "something_went_wrong");
            }

            // Check if game already started
            const gameIndex = Sys.StartedGame.indexOf(game._id.toString());
            if (gameIndex >= 0) {
                return await createErrorResponse('not_change_luckynumber', language, 400, true, "something_went_wrong");
            }

            // Update game with new lucky number
            const updateQuery = {
                $set: { 'players.$[player].luckyNumber': luckyNumber }
            };

            const options = {
                arrayFilters: [{ "player.id": player._id }],
                new: true
            };

            const updatedGame = await Sys.Game.Game2.Services.GameServices.updateSingleGame(
                { _id: gameId },
                updateQuery,
                options
            );

            if (!updatedGame) {
                return await createErrorResponse('something_went_wrong', language);
            }

            return await createSuccessResponse(null, 'lucky_number_updated', language, true);

        } catch (error) {
            console.error("Error in game2 Lucky Number Selection:", error);
            return await createErrorResponse('something_went_wrong', language || 'nor');
        }
    },

    /**
     * Refund Game by canceling tickets for each player in the game.
     * 
     * @param {Object} data - The data containing gameId to fetch game and players information.
     */
    refundGame: async function (data) {
        try {
            // Fetch the game players and parent game ID from the database
            let gamePlayers = await Sys.Game.Game2.Services.GameServices.getSingleGameByData({ _id: data.gameId }, { players: 1, parentGameId: 1 });
            
            // Check if there are any players in the game
            if (gamePlayers?.players.length > 0) {
                // Prepare data for canceling tickets in Game 3
                let game2DataArray = gamePlayers.players.map(player => ({
                    playerId: player.id,
                    parentGameId: gamePlayers.parentGameId,
                    subGameId: gamePlayers._id,
                    gameId: gamePlayers._id,
                    socketId: player.socketId,
                }));
                // Call cancelGameTickets method in Game 3 Controller for each player
                await Promise.all(game2DataArray.map(game2Data => module.exports.cancelGameTickets({ socket: { id: game2Data.socketId } }, game2Data)));
            }
            await Sys.Game.Game2.Services.GameServices.updateGame({ _id: data.gameId }, {
                $set: {
                    status: 'finish'
                }
            });
        } catch (error) {
            console.log("Error in refundGame", error); 
        }
    },

    processRefundAndFinishGame: async (gameId, parentGame) => {
        return await processRefundAndFinishGameCron(gameId, parentGame);
    }

    // Not used in Game 2
    // [ Apply Voucher Code ]
    // ApplyVoucherCode: async function (socket, data) {
    //     try {
    //         let language = "nor";
    //         if (data.language) {
    //             language = data.language;
    //         }
    //         console.log('ApplyVoucherCode Game 2: ', data);

    //         // [ Player ]
    //         let player = await Sys.Game.Game2.Services.PlayerServices.getById(data.playerId, {selectedLanguage: 1});
    //         if (!player) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({ key: "player_not_found", language: language }), // 'No Player Found!!',
    //                 statusCode: 400
    //             }
    //         }

    //         // [ Game ]
    //         let gameData = await Sys.Game.Game2.Services.GameServices.getSingleGameByData({ _id: data.gameId, status: "active" }, {ticketPrice: 1});
    //         if (!gameData) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({ key: "game_not_found", language: player.selectedLanguage }), // 'Game Not Found!!',
    //             }
    //         }


    //         let vocherTransaction = await Sys.Game.Common.Services.PlayerServices.transactionData({
    //             playerId: data.playerId,
    //             voucherCode: data.voucherCode,
    //             isVoucherUse: true,
    //             isVoucherApplied: true
    //         });

    //         console.log('vocherTransaction: ', vocherTransaction);
    //         if (vocherTransaction.length > 0) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({ key: "voucher_already_used", language: player.selectedLanguage }), // 'Sorry This Voucher is Already Applied..!!',
    //                 statusCode: 400
    //             }
    //         }


    //         let voucherUpdatedTransaction = await Sys.Game.Common.Services.PlayerServices.transactionData({ playerId: data.playerId, voucherCode: data.voucherCode })
    //         console.log('voucherUpdatedTransaction: ', voucherUpdatedTransaction);

    //         if (voucherUpdatedTransaction.length == 0) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({ key: "invalid_voucher", language: player.selectedLanguage }), // 'Please Enter Valid Voucher!!',
    //             }
    //         }

    //         let voucherData = await Sys.App.Services.VoucherServices.getSingleData({ _id: voucherUpdatedTransaction[0].voucherId });
    //         console.log('voucherData: ', voucherData);
    //         if (!voucherData) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({ key: "voucher_not_valid", language: player.selectedLanguage }), // 'This Voucher is not Vaild or Deleted by Admin!!',
    //             }
    //         }

    //         if (voucherData.status != 'active') {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({ key: "voucher_blocked", language: player.selectedLanguage }), // 'This Voucher is Blocked by Admin!!',
    //             }
    //         }

    //         let currentDate = Date.now();
    //         let expiryDate = new Date(voucherData.expiryDate);
    //         if (currentDate > expiryDate) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({ key: "voucher_expired", language: player.selectedLanguage }), // 'This Voucher is Expired!!',
    //             }
    //         }


    //         await Sys.Game.Common.Services.PlayerServices.updateOneTransaction({ _id: voucherUpdatedTransaction[0]._id }, { isVoucherApplied: true })

    //         let TotalAmountOfTickets = gameData.ticketPrice * data.ticketQty;

    //         // [ Percentage Calculate ]
    //         let percentageAmount = (voucherData.percentageOff * TotalAmountOfTickets) / 100;

    //         let payableAmount = TotalAmountOfTickets - percentageAmount;

    //         return {
    //             status: 'success',
    //             result: {
    //                 "discount": percentageAmount,
    //                 "payableAmount": payableAmount,
    //                 "percentageOff": voucherData.percentageOff
    //             },
    //             message: 'Voucher Code Applied!!'
    //         }

    //     } catch (error) {
    //         console.log("Error ApplyVoucherCode", error);
    //     }
    // },

    // Helper function to find available game for current day
    // findAvailableGame: async function(game, currentDay, currentTime, startBreakTime, endBreakTime, isBreak) {
    //     const timeSlot = game.days[currentDay];
    //     if (!timeSlot) return {};

    //     const isDayClosed = this.isDayClosed(game, currentTime);
    //     if (isDayClosed) return {};

    //     if (compareTimeSlots(currentTime.format('HH:mm'), timeSlot[1], 'lt')) {
    //         const childGames = await this.getChildGamesCount(game, currentTime, currentDay);
    //         if (childGames >= 1) {
    //             return {
    //                 gameId: game._id.toString(),
    //                 gameName: game.gameName,
    //                 namespaceString: 'Game2',
    //                 isBreak: isBreak,
    //                 startBreakTime: startBreakTime,
    //                 endBreakTime: endBreakTime
    //             };
    //         }
    //     }
    //     return {};
    // },

    // Helper function to check next day games
    // checkNextDayGames: async function(game, startBreakTime, endBreakTime, isBreak) {
    //     const nextDay = moment().add(1, 'day');
    //     const nextDayFormat = nextDay.format('ddd');
    //     const timeSlotNext = game.days[nextDayFormat];

    //     if (!timeSlotNext) return {};

    //     const isNextDayClosed = this.isDayClosed(game, nextDay);
    //     if (isNextDayClosed) return {};

    //     const childGames = await this.getChildGamesCount(game, nextDay, nextDayFormat);
    //     if (childGames >= 1) {
    //         return {
    //             gameId: game._id.toString(),
    //             gameName: game.gameName,
    //             namespaceString: 'Game2',
    //             isBreak: isBreak,
    //             startBreakTime: startBreakTime,
    //             endBreakTime: endBreakTime
    //         };
    //     }
    //     return {};
    // },

    // Helper function to check if a day is closed
    // isDayClosed: function(game, date) {
    //     if (!game.otherData?.closeDay?.length) return false;

    //     const dateStr = date.format('YYYY-MM-DD');
    //     const startTime = game.days[date.format('ddd')][0];

    //     return game.otherData.closeDay.some(closeDay => 
    //         closeDay.closeDate === dateStr && 
    //         compareTimeSlots(startTime, closeDay.startTime, 'gte') && 
    //         compareTimeSlots(startTime, closeDay.endTime, 'lte')
    //     );
    // },

    // Helper function to get child games count
    // getChildGamesCount: async function(game, date, day) {
    //     const startTime = date.startOf('day').toDate();
    //     const endTime = date.endOf('day').toDate();

    //     return await Sys.Game.Game2.Services.GameServices.getGameCount({
    //         parentGameId: game._id,
    //         status: 'active',
    //         startDate: {
    //             $gte: startTime,
    //             $lte: endTime
    //         },
    //         day: day
    //     });
    // },
}
