const Sys = require('../../../Boot/Sys');
const moment = require('moment');
const { translate } = require('../../../Config/i18n');
const { 
    createErrorResponse, 
    createSuccessResponse,
    isPlayerVerified,
    checkPlayerBreakTimeWithActiveGames,
    emitBreakTimeStatus,
    findAvailableGameForDay,
    findGroupHall,
    processVoucherCode,
    checkGameAvailability,
    getOnlinePlayers,
    sendGameChatCommon,
    gameChatHistoryCommon,
    getPlayerIp,
    checkGamePlayAtSameTime
} = require('../../../gamehelper/all.js');
const {
    validateGameTiming,
    processPurchase,
    preparePatternData,
    cancelTickets,
    getPlayerTicketsRedis,
    processRefundAndFinishGameCron
} = require('../../../gamehelper/game3.js');
const { isPlayerBlockedFromGame } = require('../../../gamehelper/player_common.js');
module.exports = {

    // [ Game 3 Room 
    game3Room: async function (socket, data) {
        const { playerId, language: _language = "nor", hall: hallId } = data;
        const currentTime = moment();
        const currentDay = currentTime.format('ddd');
        let language = _language;

        try {
            // Parallel DB calls for player and hall
            const [player, hall, game] = await Promise.all([
                Sys.Game.Game2.Services.PlayerServices.getById(playerId, {
                    selectedLanguage: 1, status: 1, startBreakTime: 1, endBreakTime: 1, socketId: 1, bankIdAuth: 1, isVerifiedByHall: 1, isAlreadyApproved: 1, hall: 1, blockRules: 1
                }),
                Sys.Game.Common.Services.GameServices.getSingleHallByData({ _id: hallId, status: "active" }, {_id: 1}),
                Sys.Game.Game3.Services.GameServices.getSingleParentGameData(
                    {
                        gameType: "game_3",
                        stopGame: false,
                        status: { $ne: "finish" },
                        allHallsId: { $in: [hallId] },
                        //'otherData.isBotGame': false
                    },
                    { days: 1, otherData: 1, gameName: 1, gameNumber: 1 }
                )
            ]);

            // Player validation
            if (!player) {
                return await createErrorResponse("player_not_found", language);
            }
            language = player.selectedLanguage || language;

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


            // Hall validation
            if (!hall || hall.length <= 0) {
                return await createErrorResponse("game_not_found", language, 400);
            }

            // Verify player (skip for bots)
            if (player.userType !== "Bot" && !(isPlayerVerified(player))) {
                return await createErrorResponse("verify_to_play_game", language, 400);
            }
        
            if (!game) {
                return await createErrorResponse("game2_slot_not_available", language, 400);
            }

            // Process break time check and emit
            const isBreak = await checkPlayerBreakTimeWithActiveGames(player._id, player?.startBreakTime, player?.endBreakTime, currentTime, "game_3");
            emitBreakTimeStatus(player.socketId, player?.startBreakTime, player?.endBreakTime, isBreak);

            // Check current day and next day games
            const finalResult = await findAvailableGameForDay(game, currentTime, currentDay, player?.startBreakTime, player?.endBreakTime, isBreak, "Game3");
           
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
            console.error("Error In Game3Room function:", error);
            return await createErrorResponse("something_went_wrong", language);
        }
    },

    // [ Game 3 Listing ]
    game3List: async function (socket, data) {
        try {
            // Destructure all required variables at top
            const { playerId, language: reqLanguage = "nor", gameId } = data;
            const RunningGames = Sys.StartedGame;
            
            // Get player data
            const player = await Sys.Game.Game3.Services.PlayerServices.getById(playerId, {
                selectedLanguage: 1, 
                hall: 1
            });
            
            if (!player) return await createErrorResponse("player_not_found", reqLanguage);
            const language = player.selectedLanguage || reqLanguage;

            const query = {
                _id: { $nin: RunningGames },
                parentGameId: await Sys.Helper.bingo.obId(gameId),
                gameType: "game_3",
                status: 'active',
                allHallsId: { $in: [player.hall.id.toString()] },
                'otherData.isBotGame': false
            };

            const projection = {
                _id: 1, 
                gameName: 1, 
                gameNumber: 1, 
                ticketPrice: 1, 
                players: 1, 
                luckyNumber: 1
            };

            // Get games data
            const games = await Sys.Game.Game3.Services.GameServices.getByData(query, projection);
            if (!games.length) return await createErrorResponse("game_not_found", language);

            // Process games in parallel using Promise.all
            const finalListing = await Promise.all(
                games.map(async game => {
                    // Run ticket count query in parallel with other operations
                    // const ticketCountPromise = Sys.Game.Game3.Services.GameServices.getTicketCount({
                    //     gameId: game._id.toString(),
                    //     playerIdOfPurchaser: playerId,
                    //     isCancelled: false
                    // });

                    const playerInGame = game.players.find(p => p.id.toString() === playerId);
                    const index = Sys.Running.indexOf(`${game.gameNumber}`);
                    
                    // Wait for ticket count
                    const ticketCount = playerInGame?.ticketCount || 0; //await ticketCountPromise;

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

            return await createSuccessResponse(
                { upcomingGames: finalListing },
                'gameList List',
                language
            );

        } catch (error) {
            console.log("Error In Game3 Listing function", error);
            return await createErrorResponse("something_went_wrong", reqLanguage || "nor");
        }
    },

    // [ Subscribe Room ]
    subscribeRoom: async function (socket, data) {
        try {
            // Destructure at the top
            const { playerId, gameId, language: reqLanguage = "nor" } = data;
           
            if (!playerId) return await createErrorResponse("playerid_not_found", reqLanguage);
            if (!gameId) return await createErrorResponse("game_not_found", reqLanguage);
    
            // Parallel fetch player and game data
            const [player, gameData] = await Promise.all([
                Sys.Game.Game3.Services.PlayerServices.getById(playerId, { selectedLanguage: 1, status: 1 }),
                Sys.Game.Game3.Services.GameServices.getSingleParentGameData(
                    {
                        _id: gameId,
                        status: { $in: ['running', 'active'] },
                        stopGame: false,
                        'otherData.isBotGame': false
                    },
                    { _id: 1, days: 1, otherData: 1, status: 1 }
                ),
               
            ]);
    
            if (!player) return await createErrorResponse("player_not_found", reqLanguage);
            const language = player.selectedLanguage || reqLanguage;
            if (player.status.toLowerCase() !== 'active') return await createErrorResponse("player_not_active", language);
    
            if (!gameData) {
                return await createErrorResponse("game_not_found", language, { messageType: await translate({ key: "game_not_available", language }) });
            }
    
            // Check game availability
            const currentTime = moment().format('HH:mm');
            const projection = {status: 1, ticketPrice: 1, players: 1, gameNumber: 1, isNotificationSent: 1, withdrawNumberList: 1, totalNoPurchasedTickets: 1, patternWinnerHistory: 1, allPatternArray: 1, winningType: 1, parentGameId: 1, patternGroupNumberPrize: 1, sequence: 1, gameName: 1, seconds: 1};
            const room = await checkGameAvailability(gameData, currentTime, projection);
           
            if (!room || room.length < 1) {
                return await createErrorResponse("game3_pur_failed_started", language, 401, true, "game_not_available");
            }
    
            // Pick running or first room
            let selectedRoom = room.find(r => r.status === 'running') || room[0];
    
            // Update player socketId and online status in parallel for all players in room
            if (selectedRoom.players && selectedRoom.players.length) {
                Sys.Game.Game3.Services.GameServices.updateSingleGame(
                    { _id: selectedRoom._id, "players.id": playerId },
                    {
                        $set: {
                            "players.$.socketId": socket.id,
                            "players.$.isPlayerOnline": true
                        }
                    },
                    { new: false }
                );
            }
    
            // Join socket rooms
            socket.join(gameData._id.toString());
            socket.join(`${selectedRoom._id.toString()}_ticketPurchase`);
            socket.myData = {
                playerID: playerId,
                gameId: selectedRoom._id,
                gameType: 'game_3',
                gameName: 'Spillorama'
            };

            // Get total Winnigns and winning patterns
            const { totalWon, winsByTicketId } = (selectedRoom?.patternWinnerHistory || []).reduce(
                (acc, item) => {
                  // Player-specific winnings
                  if (item?.winnerPlayerId?.toString() === playerId.toString()) {
                    const roundedWin = Math.round(Number(item?.finalwin || 0));
                    acc.totalWon += roundedWin;
                    const key = item?.ticketId?.toString();
                    if (key) {
                      if (!acc.winsByTicketId[key]) acc.winsByTicketId[key] = [];
                      acc.winsByTicketId[key].push({
                        patternName: item?.patternName || '',
                        patternPrize: Math.round(Number(item?.patternPrize || 0))
                      });
                    }
                  }
              
                  return acc;
                },
                { totalWon: 0, winsByTicketId: Object.create(null) }
            );
            // Prepare tickets array
            const allPurchasedTickets = await getPlayerTicketsRedis({ gameId: selectedRoom._id.toString(), playerId: playerId, gameStatus: selectedRoom.status });
           
            const ticketsArr = allPurchasedTickets.map(t => ({
                id: t._id,
                ticketNumber: t.ticketId || t.ticketNumber,
                ticketPrice: selectedRoom.ticketPrice,
                ticketCellNumberList: t.tickets,
                hallName: t.hallName,
                supplierName: t.supplier || "Smart Gaming",
                developerName: t.developer || "Bingoentreprenøren AS",
                ticketCompleted: false,
                winningPatterns: winsByTicketId[t._id.toString()] || []
            }));
            
            // Calculate total won
            // const totalWon = (selectedRoom?.patternWinnerHistory || []).reduce(
            //     (sum, item) => sum + Number(item.finalwin || 0),
            //     0
            // );
        
            let editLuckyFlag = (selectedRoom.status == 'active');
            const playerLuckynumberWithAutoplay = selectedRoom.players.find(item => JSON.stringify(item.id) == JSON.stringify(player._id));
            
            // Prepare pattern data
            const withdrawNumberList = Array.isArray(selectedRoom.withdrawNumberList)
                ? selectedRoom.withdrawNumberList
                : [];
            const pricePool = Math.round(selectedRoom.totalNoPurchasedTickets * selectedRoom.ticketPrice);
            const { patternData, jackPotData } = preparePatternData(
                selectedRoom.allPatternArray,
                pricePool,
                selectedRoom.winningType,
                withdrawNumberList
            );
            
            // Cancel button logic
            let disableCancelButton = false;
            let indexp = Sys.Running.indexOf(`${selectedRoom.gameNumber}`);
            if (selectedRoom.status != 'active' || selectedRoom.isNotificationSent == true || indexp > -1) {
                disableCancelButton = true;
            }

            // Emit player count update
            const onlinePlayers = await getOnlinePlayers('Game3', gameData._id)
            await Sys.Io.of(Sys.Config.Namespace.Game3).to(gameData._id.toString()).emit('UpdatePlayerRegisteredCount', { playerRegisteredCount: onlinePlayers });
    
            // Prepare result
            let result = {
                activePlayers: onlinePlayers,
                editLuckyNumber: editLuckyFlag,
                luckyNumber: playerLuckynumberWithAutoplay ? playerLuckynumberWithAutoplay.luckyNumber : '',
                maxWithdrawCount: 75,
                patternList: patternData,
                totalWithdrawCount: withdrawNumberList.length,
                jackpotList: selectedRoom.patternGroupNumberPrize,
                withdrawNumberList,
                ticketList: ticketsArr,
                totalBetAmount: Math.round(ticketsArr.length * selectedRoom.ticketPrice),
                totalWon: totalWon,
                gameId: gameData._id.toString(),
                subGameId: selectedRoom._id.toString(),
                gameCount: selectedRoom.sequence,
                gameName: selectedRoom.gameName,
                jackPotData: jackPotData,
                disableCancelButton: disableCancelButton,
                isSoundPlay: (selectedRoom?.seconds >= 2000) ? true: false, 
            };
            
            // Emit result to socket
            await Sys.Io.of(Sys.Config.Namespace.Game3).to(socket.id).emit('SubscribeRoom', result);
            
            // Success response
            return await createSuccessResponse(result, 'Player Subscribed Successfully.', language);
    
        } catch (e) {
            console.log("Error in subscribeRoom : ", e);
            return await createErrorResponse("something_went_wrong", "nor");
        }
    },

    // [ When Player Fetch Ticket Data ]
    GetGame3PurchaseData: async function (socket, data) {
        try {
            // Destructure all required variables at top
            const { playerId, language: reqLanguage = "nor", gameId } = data;

            // Basic validation checks
            if (!playerId) return await createErrorResponse("playerid_not_found", reqLanguage);
            if (!gameId) return await createErrorResponse("game_not_found", reqLanguage);

            // Run player and game queries in parallel
            const [player, gameData] = await Promise.all([
                Sys.Game.Game3.Services.PlayerServices.getPlayerCount(playerId),
                Sys.Game.Game3.Services.GameServices.getSingleGameData(
                    { _id: gameId }, 
                    { ticketPrice: 1, players: 1 }
                )
            ]);

            // Player validation
            if (!player) return await createErrorResponse("player_not_found", reqLanguage);
            const language = player.selectedLanguage || reqLanguage;

            // Game validation
            if (!gameData) return await createErrorResponse("game3_pur_failed_started", language, 401, true, "something_went_wrong");

            // Get ticket count
            const playerInGame = gameData.players.find(p => p.id.toString() === playerId);
            const ticketCount = playerInGame?.ticketCount || 0;
            return await createSuccessResponse(
                {
                    minQty: 1,
                    maxQty: 30,
                    price: gameData.ticketPrice,
                    purchasedTickets: ticketCount
                },
                'Ticket Data Load Successfully..',
                language
            );

        } catch (error) {
            console.log("Error GetGame3PurchaseData", error);
            return await createErrorResponse("something_went_wrong", reqLanguage);
        }
    },

    // [ Ticket Purchase ]
    PurchaseGame3Tickets: async function (socket, data) {
        try {
            
            // Destructure all required variables at top
            const {
                playerId,
                language: reqLanguage = "nor",
                subGameId,
                purchaseType,
                ticketQty,
                voucherCode
            } = data;
    
            // Early validation checks
            if (!subGameId) return await createErrorResponse("game_not_found", reqLanguage);
            if (!purchaseType) return await createErrorResponse("purchasetype_not_found", reqLanguage);
            if (!ticketQty || Number(ticketQty) < 1) return await createErrorResponse("game3_ticket_count", reqLanguage);
            if (!playerId) return await createErrorResponse("playerid_not_found", reqLanguage);
            
            // Run initial parallel queries
            const [player, gameData, voucherData] = await Promise.all([
                Sys.Game.Game3.Services.PlayerServices.getById(playerId, {
                    selectedLanguage: 1, status: 1, hall: 1, username: 1, points: 1,
                    walletAmount: 1, userType: 1, monthlyWallet: 1, monthlyWalletAmountLimit: 1,
                    uniqueId: 1, isCreatedByAdmin: 1, agentId: 1, startBreakTime: 1, endBreakTime: 1, blockRules: 1
                }),
                Sys.Game.Game3.Services.GameServices.getSingleGameData(
                    { _id: subGameId, status: 'active' },
                    {
                        parentGameId: 1, startDate: 1, graceDate: 1, gameMode: 1,
                        groupHalls: 1, ticketPrice: 1, gameTypeId: 1, isBotGame: 1, totalNoPurchasedTickets:1, minTicketCount:1,
                        gameNumber: 1, gameName: 1, allPatternArray: 1, players: 1, 'otherData.isBotGame': 1, gameType: 1
                    }
                ),
                voucherCode ? await processVoucherCode(voucherCode, playerId, language, false) : null,
            ]);
    
            // Player validations
            if (!player) return await createErrorResponse("player_not_found", reqLanguage);
            const language = player.selectedLanguage || reqLanguage;

            if((gameData.totalNoPurchasedTickets + Number(ticketQty)) >= gameData.minTicketCount){
                // Check if player is already in a running game
                const isRunningGame = await checkGamePlayAtSameTime(playerId,"game_3");
                if (isRunningGame.status) {
                    return await createErrorResponse(`game_already_started_${isRunningGame.gameType}`, reqLanguage);
                }
            }

             // check if player is blocked from game
            if(!gameData?.otherData?.isBotGame) {
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
             
            if (player.status.toLowerCase() !== 'active') {
                return await createErrorResponse("player_not_active", language);
            }
    
            // Game validations
            if (!gameData) return await createErrorResponse("game3_pur_failed_started", language, 401, true, "something_went_wrong");
    
            // Check game timing and status
            const parentGameData = await Sys.Game.Game3.Services.GameServices.getSingleParentGameData(
                { _id: gameData.parentGameId }, 
                { otherData: 1, days: 1, subGames: 1 }
            );
            const timingValidation = await validateGameTiming({ _id: gameData._id, gameMode: gameData.gameMode}, {startBreakTime: player?.startBreakTime, endBreakTime: player?.endBreakTime}, parentGameData);
            if (!timingValidation.isValid) {
                return await createErrorResponse(timingValidation.error, language);
            }
    
            // Ticket purchase limit validation
            const playerInGame = gameData.players.find(p => p.id.toString() === playerId);
            const alreadyPurchasedTicketCount = playerInGame?.ticketCount || 0;
            if (alreadyPurchasedTicketCount >= 30) return await createErrorResponse("already_purchased_tickets", language, 401, true, null, { playerId: player._id, username: player.username });
            
            // Group hall validation
            const groupHall = await findGroupHall(gameData.groupHalls, player.hall.id);
            if (!groupHall) return await createErrorResponse("not_allowed_to_play_in_hall", language);
            
            // Process purchase
            const purchaseResult = await processPurchase(
                player,
                gameData,
                ticketQty,
                purchaseType,
                voucherData,
                alreadyPurchasedTicketCount,
                {columns: 5, rows: 5},
                groupHall,
                parentGameData,
                {id: socket.id}
            );
    
            if (!purchaseResult.isValid) {
                return await createErrorResponse(purchaseResult.error, language, 400, true, null, purchaseResult?.result);
            }

            return await createSuccessResponse(
                '',
                'tickets_purcahsed',
                language,
                true
            );
            
        } catch (error) {
            console.log("Error PurchaseGame3Tickets", error);
            return await createErrorResponse("something_went_wrong", reqLanguage);
        }
    },
    
    // [ Cancel Tickets ]
    cancelGameTickets: async function (socket, data) {
        try {
            const { playerId, subGameId, hallIds = null, language: reqLanguage = "nor", isRefund = false } = data;
            const { error, success, language } = await cancelTickets({
                playerId,
                gameId: subGameId,
                hallIds,
                language: reqLanguage,
                isRefund,
            });
            if (error) return error;
            return await createSuccessResponse('', "game2_cancel_success", reqLanguage, true);
        } catch (error) {
            console.log("Error cancelGameTickets", error);
            return await createErrorResponse("something_went_wrong", data.language || "nor");
        }
    },
    
    cancelTicket: async function (socket, data) {
        try {
            const { playerId, gameId, ticketId, language: reqLanguage = "nor", isRefund = false } = data;
            const { error, success, language } = await cancelTickets({
                playerId,
                gameId,
                ticketId,
                language: reqLanguage,
                isRefund,
            });
            if (error) return error;
            return await createSuccessResponse('', "game2_cancel_success", reqLanguage, true);
        } catch (error) {
            console.log("Error cancelTicket", error);
            return await createErrorResponse("something_went_wrong", data.language || "nor");
        }
    },

    leftRoom: async function (socket, data) {
        try {
            const { playerId, gameId, language: reqLanguage = "nor" } = data;
            let language = reqLanguage;

            // Parallel fetch player and game data
            const [player, gameData] = await Promise.all([
                Sys.Game.Game3.Services.PlayerServices.getById(playerId, { selectedLanguage: 1, status: 1 }),
                Sys.Game.Game3.Services.GameServices.getSingleParentGameData({ _id: gameId }, { _id: 1 })
            ]);

            if (!player) return await createErrorResponse("player_not_found", language);
            language = player.selectedLanguage || language;

            if (!gameData) return await createErrorResponse("game_not_found", language);

            // Leave the room and update online player count
            await new Promise((resolve, reject) => {
                socket.leave(gameId, (err) => {
                    if (err) reject(err);
                    else {
                        resolve();
                    }
                });
            });
           
            // Update online player count in parallel
            const onlinePlayers = await getOnlinePlayers('Game3', gameId);
            Sys.Io.of(Sys.Config.Namespace.Game3).to(gameData._id).emit('UpdatePlayerRegisteredCount', {
                playerRegisteredCount: onlinePlayers
            });
            Sys.Io.of(Sys.Config.Namespace.Game3).to(gameId.toString()).emit('GameOnlinePlayerCount', { onlinePlayerCount: onlinePlayers });

            return await createSuccessResponse(null, 'player left successfully!', language);

        } catch (e) {
            console.log("Error in leftRoom : ", e);
            return await createErrorResponse("something_went_wrong", data.language || "nor");
        }
    },

    SelectLuckyNumber: async function (socket, data) {
        try {
            const { playerId, gameId, luckyNumber, language: reqLanguage = "nor" } = data;
        
            // validation
            if (!playerId) return await createErrorResponse("playerid_not_found", reqLanguage);
            if (!gameId) return await createErrorResponse("game_not_found", reqLanguage);
            if (luckyNumber == null) return await createErrorResponse("lucky_number_not_found", reqLanguage);

            // Parallel fetch player and game data
            const [player, gameData] = await Promise.all([
                Sys.Game.Game3.Services.PlayerServices.getById(playerId, { selectedLanguage: 1, status: 1 }),
                Sys.Game.Game3.Services.GameServices.getSingleGameData({ _id: gameId }, { status: 1 })
            ]);

            if (!player) return await createErrorResponse("player_not_found", reqLanguage);
            const language = player.selectedLanguage || reqLanguage;
            if (!gameData) return await createErrorResponse("game_not_found", language);

            const indexP = Sys.StartedGame.indexOf(gameData._id.toString());
            if (gameData.status === 'active' && indexP < 0) {
                await Sys.Game.Game3.Services.GameServices.updateSingleGame(
                    { _id: gameData._id, "players.id": player._id },
                    { $set: { "players.$.luckyNumber": luckyNumber } },
                    { new: true }
                );
                return await createSuccessResponse( "", "lucky_number_updated", language, true);
            } else {
                return await createErrorResponse("game3_luckynumber_game_started", language);
            }
        } catch (error) {
            console.log("Error in SelectLuckyNumber", error);
            return await createErrorResponse("something_went_wrong", data.language || "nor");
        }
    },

    // [ Chat ]
    sendGameChat: async function (socket, data) {
        try {
            return await sendGameChatCommon({
                data,
                PlayerServices: Sys.Game.Game3.Services.PlayerServices,
                getGameServices: Sys.Game.Game3.Services.GameServices.getSingleParentGameData,
                ChatServices: Sys.Game.Game3.Services.ChatServices,
                IoNamespace: Sys.Io.of(Sys.Config.Namespace.Game3),
                socketId: socket.id
            });
        } catch (error) {
            console.log("Error sendGameChat", error);
            return await createErrorResponse("something_went_wrong", data.language || "nor", 500);
        }

    },

    // [ Chat History ]
    gameChatHistory: async function (socket, data) {
        try {
            return await gameChatHistoryCommon({
                data,
                PlayerServices: Sys.Game.Game3.Services.PlayerServices,
                getGameServices: Sys.Game.Game3.Services.GameServices.getSingleParentGameData,
                ChatServices: Sys.Game.Game3.Services.ChatServices,
                IoNamespace: Sys.Io.of(Sys.Config.Namespace.Game3),
                namespace: "/Game3"
            });
        } catch (error) {
            console.log("Error gameChatHistory", error);
            return await createErrorResponse("something_went_wrong", data.language || "nor", 500);
        }

    },

    // [ Refund and Finish Game will be used in common cron and app/gamecontroller for next game refund]
    processRefundAndFinishGame: async (gameId, parentGame, isBotGame = false) => {
        try {
            return await processRefundAndFinishGameCron(gameId, parentGame, isBotGame);
        } catch (error) {
            console.log("Error in processRefundAndFinishGame:", error);
            throw error;
        }
    },

    // [ Apply Voucher Code - Not using ] 
    // ApplyVoucherCode: async function (socket, data) {
    //     try {
    //         let language = "nor";
    //         if(data.language){
    //             language = data.language;
    //         }
    //         // [ Player ]
    //         let player = await Sys.Game.Game2.Services.PlayerServices.getById(data.playerId, {selectedLanguage: 1});
    //         if (!player) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({key: "player_not_found", language: language}), // 'No Player Found!!',
    //                 statusCode: 400
    //             }
    //         }
    //         language = player.selectedLanguage;
    //         // [ Game ]
    //         let gameData = await Sys.Game.Game3.Services.GameServices.getSingleGameData({ _id: data.gameId, status: "active" }, {_id: 1, ticketPrice: 1});
    //         if (!gameData) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({key: "game_not_found", language: language}), // 'Game Not Found!!',
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
    //                 message: await translate({key: "voucher_already_used", language: language}), // 'Sorry This Voucher is Already Applied..!!',
    //                 statusCode: 400
    //             }
    //         }


    //         let voucherUpdatedTransaction = await Sys.Game.Common.Services.PlayerServices.transactionData({ playerId: data.playerId, voucherCode: data.voucherCode })
    //         console.log('voucherUpdatedTransaction: ', voucherUpdatedTransaction);

    //         if (voucherUpdatedTransaction.length == 0) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({key: "invalid_voucher", language: language}), // 'Please Enter Valid Voucher!!',
    //             }
    //         }

    //         let voucherData = await Sys.App.Services.VoucherServices.getSingleData({ _id: voucherUpdatedTransaction[0].voucherId });
    //         console.log('voucherData: ', voucherData);
    //         if (!voucherData) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({key: "voucher_not_valid", language: language}), // 'This Voucher is not Vaild or Deleted by Admin!!',
    //             }
    //         }

    //         if (voucherData.status != 'active') {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({key: "voucher_blocked", language: language}), // 'This Voucher is Blocked by Admin!!',
    //             }
    //         }

    //         let currentDate = Date.now();
    //         let expiryDate = new Date(voucherData.expiryDate);
    //         if (currentDate > expiryDate) {
    //             return {
    //                 status: 'fail',
    //                 result: null,
    //                 message: await translate({key: "voucher_expired", language: language}), // 'This Voucher is Expired!!',
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
}
