'use strict';
const Sys = require('../Boot/Sys');
const { 
    formatDateTimeGameName,
    get2DArrayFromString,
    createErrorResponse,
    checkPlayerSpending,
    updatePlayerHallSpendingData
} = require('./all.js');
const exactMath = require('exact-math');
const { translate } = require('../Config/i18n');
const redis = require('../Config/Redis');
/**
 * Creates a subgame data object for Game4
 * @param {Object} gameData - Parent game data
 * @param {Object} player - Player data
 * @param {String} playerId - Player ID
 * @returns {Object} - Created subgame data
 */
const createSubGame = async function(gameData, player, playerId) {
    try {
        const isBot = player.userType === "Bot";
        const createID = formatDateTimeGameName(Date.now());
        
        // Create subgame
        const subGameData = await Sys.App.Services.GameService.insertSubGameData({
            gameName: gameData.gameName,
            gameNumber: `${createID}_G4`,
            gameType: gameData.gameType,
            gameTypeId: gameData.gameTypeId,
            parentGameId: gameData._id,
            ticketPrice: gameData.ticketPrice,
            totalNoTickets: gameData.totalNoTickets,
            totalEarning: 0,
            patternNamePrice: gameData.patternNamePrice,
            seconds: gameData.seconds,
            seconds2: gameData.seconds2,
            day: gameData.day,
            status: "active",
            startDate: Date.now(),
            createdAt: Date.now(),
            createrId: gameData.createrId,
            'otherData.isBotGame': isBot,
            'otherData.playerId': playerId,
            'otherData.isBallWithdrawn': false
        });
        
        return subGameData;
    } catch (error) {
        console.error('Error in createSubGame:', error);
        throw error;
    }
};

/**
 * Creates tickets for a subgame
 * @param {Object} subGameData - Subgame data
 * @param {Object} player - Player data
 * @returns {void}
 */
async function createSubGameTickets(subGameData, player) {
    try {console.log("createSubGameTickets called", subGameData?._id)
        const isBot = player.userType === "Bot";
        const playerUserType = player.userType === "Unique" ? "Unique" : (isBot ? "Bot" : "Online");
        
        await Sys.Helper.bingo.ticketBook({
            slug: "game_4",
            ticketSize: Number(subGameData.totalNoTickets),
            gameId: subGameData._id,
            userType: playerUserType,
            uniquePlayerId: playerUserType === "Online" ? '' : player.uniqueId,
            isAgentTicket: player.userType === "Unique" && !player.isCreatedByAdmin,
            agentId: player.agentId,
            gameName: subGameData.gameNumber
        });
        console.log("tickets created")
    } catch (error) {
        console.error('Error in createSubGameTickets:', error);
        throw error;
    }
};

/**
 * Processes pattern data for Game4
 * @param {Array} patterns - Array of pattern objects
 * @param {Object} prizeData - Prize data object
 * @returns {Array} - Processed pattern list
 */
const processPatterns = function(patterns, prizeData) {
    try {
        return patterns.map((pattern, index) => {
            const { _id, patternType, count, patternName } = pattern;
            const patternObj = {
                id: _id,
                patternDataList: get2DArrayFromString(patternType),
                count,
                extra: '',
                patternName,
                prize: Number(prizeData[`Pattern${index + 1}`])
            };

            // Set special pattern properties
            if (patternName === "Jackpot") {
                patternObj.patternName = 'Jackpot';
                patternObj.extra = "";
            } else if (patternName === "2L") {
                patternObj.patternName = "";
                patternObj.extra = '2L';
            } else if (patternName === "1L") {
                patternObj.patternName = "";
                patternObj.extra = '1L';
            }

            return patternObj;
        }).sort((a, b) => a.count - b.count);
    } catch (error) {
        console.error('Error in processPatterns:', error);
        return [];
    }
};

/**
 * Formats tickets for client response
 * @param {Array} tickets - Array of ticket objects
 * @returns {Array} - Formatted ticket data
 */
const formatTickets = function(tickets) {
    return tickets.map(({ _id, tickets }) => ({
        id: _id,
        ticketCellNumberList: tickets
    }));
};

 /**
 * Process and validate a voucher code
 * @param {string} voucherCode - The voucher code to process
 * @param {string} playerId - The ID of the player using the voucher
 * @param {string} language - The player's selected language
 * @returns {Object} - Result object with status and voucher info
 */
 const processVoucherCode = async function(voucherCode, playerId, language) {
    try {
        // If no voucher code provided, return empty success
        if (!voucherCode) {
            return { status: 'success', voucherInfo: null };
        }
        
        // Verify voucher
        const vocherTransaction = await Sys.Game.Common.Services.PlayerServices.transactionData({
            playerId,
            voucherCode
        });
        
        if (vocherTransaction.length === 0) {
            return await createErrorResponse("vourcher_not_purchased", language);
        }
        
        if (!vocherTransaction[0].isVoucherApplied) {
            return await createErrorResponse("voucher_not_applied", language);
        }
        
        // Get voucher data
        const voucherData = await Sys.App.Services.VoucherServices.getSingleData({
            _id: vocherTransaction[0].voucherId
        });
        
        if (!voucherData) {
            return await createErrorResponse("voucher_not_valid", language);
        }
        
        if (voucherData.status !== 'active') {
            return await createErrorResponse("voucher_blocked", language);
        }
        
        // Check expiry
        if (Date.now() > new Date(voucherData.expiryDate)) {
            return await createErrorResponse("voucher_expired", language);
        }
        
        // Mark voucher as used
        await Sys.Game.Common.Services.PlayerServices.updateOneTransaction(
            { _id: vocherTransaction[0]._id },
            { isVoucherUse: true }
        );
        
        return {
            status: 'success',
            voucherInfo: {
                voucherCode,
                voucherId: voucherData._id,
                percentageOff: voucherData.percentageOff,
                transactionId: vocherTransaction[0]._id
            }
        };
    } catch (error) {
        console.error('Error in processVoucherCode:', error);
        return await createErrorResponse("something_went_wrong", language);
    }
}


/**
 * Process payment transaction for ticket purchase
 * @param {Object} player - Player data 
 * @param {Object} gameData - Game data
 * @param {Number} multiplierValue - Multiplier for ticket price
 * @param {Array} tickets - Array of tickets
 * @param {String} voucherInfo - Voucher information (optional)
 * @returns {Array} - Array of purchased tickets
 */
const processTicketPurchase = async function(player, gameData, totalAmountOfTickets, multiplierValue, tickets, voucherInfo = {}, mainGame, socketIdValue, typeOfPurchase) {
    try {
        console.log("process ticket purchase game 4 tickets", tickets?.length, gameData);
        const purchasedTickets = [];
        const { _id, userType, uniqueId, groupHall } = player;
        const { voucherCode = '', voucherId, percentageOff = 0, transactionId = '' } = voucherInfo || {};

        // Get all tickets data in a single MongoDB call
        const ticketsData = await Sys.Game.Game4.Services.GameServices.getTicketByData({ gameId: gameData._id }, { _id: 1, tickets: 1, gameId: 1, hallId: 1, hallName: 1, supplier: 1, developer: 1, ticketId: 1, isPurchased: 1 });
        
        // Prepare bulk operations for updating tickets
        const bulkTicketUpdates = [];
        const ticketDataMap = {};
        const currentTicketList = []; // pass all the ticket, purcahsed or non purchased as front end uses this ticket in next game

        ticketsData.forEach(ticket => {
            // Only update tickets that are not already purchased
            if (ticket.isPurchased) {
                bulkTicketUpdates.push({
                    updateOne: {
                        filter: { _id: ticket._id },
                        update: {
                            $set: {
                                isPurchased: true,
                                playerIdOfPurchaser: _id,
                                betAmount: Number(gameData.ticketPrice) * Number(multiplierValue),
                                ticketPrice: Number(gameData.ticketPrice) * Number(multiplierValue),
                                userType: userType,
                                ticketPurchasedFrom: "realMoney",
                                gameStartDate: gameData.startDate,
                                hallId: player.hall.id,
                                hallName: player.hall.name,
                                groupHallName: groupHall.name,
                                groupHallId: groupHall.id
                            }
                        }
                    }
                });
                ticketDataMap[ticket._id.toString()] = ticket;
            }
            currentTicketList.push({id: ticket._id, ticketCellNumberList: ticket.tickets});
        });

        // Now use bulkTicketUpdates
        if(bulkTicketUpdates.length > 0){
            await Sys.Game.Game4.Services.GameServices.bulkWriteTicket(bulkTicketUpdates, { ordered: false });
        }
    
        // Pre-calculate common values outside the loop
        const baseTicketPrice = Number(gameData.ticketPrice) * Number(multiplierValue);
        const hasVoucher = voucherCode && percentageOff > 0;
        const voucherMultiplier = hasVoucher ? (100 - percentageOff) / 100 : 1;
        const playerUserType = userType === "Unique" ? "Unique" : 
                            (userType === "Bot" ? "Bot" : "Online");
        const uniquePlayerIdValue = playerUserType === "Online" ? '' : uniqueId;
        const socketIdValue = player.socketId || '';
        const voucherTransactionIdValue = transactionId || '';
        
        // Prepare transaction data for bulk operations
        const transactionPromises = [];
        
        // Process all tickets in a single pass
        for (const ticketId of tickets) {
            // Calculate payable amount with voucher if applicable
            const payableAmount = hasVoucher ? baseTicketPrice * voucherMultiplier : baseTicketPrice;
            // Queue transaction creation (will be executed in parallel)
            transactionPromises.push(
                Sys.Helper.gameHelper.createTransactionPlayer({
                    playerId: _id,
                    gameId: gameData._id,
                    extraSlug: "Game4",
                    ticketId: ticketId,
                    transactionSlug: "buyTicket",
                    voucherId: voucherId,
                    voucherCode: voucherCode,
                    action: "debit",
                    purchasedSlug: "realMoney",
                    multiplierValue: multiplierValue,
                    totalAmount: payableAmount,
                    groupHall: groupHall
                })
            );
            
            // Get ticket data from the map
            const ticketData = ticketDataMap[ticketId.toString()];
            if (ticketData) {
            // Build purchased ticket object
                purchasedTickets.push({
                    gameId: ticketData.gameId,
                    ticketCellNumberList: ticketData.tickets,
                    isPurchased: true,
                    playerIdOfPurchaser: _id,
                    hallName: ticketData.hallName,
                    supplier: ticketData.supplier,
                    developer: ticketData.developer,
                    ticketNumber: ticketData.ticketId,
                    ticketId: ticketId,
                    purchasedSlug: "realMoney",
                    socketId: socketIdValue,
                    voucherTranasctionId: voucherTransactionIdValue,
                    voucherId: voucherId,
                    voucherCode: voucherCode,
                    totalAmount: payableAmount,
                    userType: playerUserType,
                    uniquePlayerId: uniquePlayerIdValue
                });
            }
        }
        
        // Wait for all transactions to complete
        await Promise.all(transactionPromises);

        // Get updated player data for player info
        const playerUpdated = await Sys.Game.Game4.Services.PlayerServices.updateData(
            { _id: _id },
            { $inc: { 'statisticsgame4.totalGames': 1 } },
            { new: true }
        );

        // Update game with purchased tickets and player data
        await Sys.Game.Game4.Services.GameServices.updateSubGame(
            { _id: gameData._id },
            { 
                $set: { 
                    purchasedTickets,
                    players: [{
                        id: player._id,
                        name: player.username,
                        status: 'Playing',
                        socketId: socketIdValue,
                        purchasedSlug: "realMoney",
                        points: playerUpdated.points,
                        walletAmount: playerUpdated.walletAmount,
                        isPlayerOnline: true
                    }],
                    socketId: socketIdValue,
                    groupHalls: groupHall,
                    halls: [{ id: playerUpdated.hall.id, name: playerUpdated.hall.name }],
                    status: 'running',
                    timerStart: true,
                    seconds: mainGame.seconds,
                    seconds2: mainGame.seconds2,
                    'otherData.multiplierValue': multiplierValue,
                    totalEarning: +totalAmountOfTickets,
                    startDate: Date.now(), 
                    createdAt: Date.now(), 
                }
            }
        );
        
        // Trigger break time check
        Sys.Game.Common.Controllers.PlayerController.checkBreakTime(_id);
        
        // Create transaction for game joining
        await Sys.Helper.gameHelper.createTransactionPlayer({
            playerId: _id,
            extraSlug: "Game4",
            gameId: gameData._id,
            transactionSlug: "extraTransaction",
            typeOfTransaction: "Game Joined",
            action: "debit",
            purchasedSlug: "realMoney",
            totalAmount: totalAmountOfTickets
        });

        // Add Notification if not botgame
        if (!gameData?.isBotGame) {
            const message = { 
                en: await translate({
                    key: "game4_ticket_purchase", 
                    language: 'en', 
                    isDynamic: true, 
                    number: gameData.gameNumber, 
                    number1: gameData.ticketCount
                }), 
                nor: await translate({
                    key: "game4_ticket_purchase", 
                    language: 'nor', 
                    isDynamic: true, 
                    number: gameData.gameNumber, 
                    number1: gameData.ticketCount 
                })
            };
            
            Sys.Game.Common.Services.NotificationServices.create({
                playerId: player._id,
                gameId: gameData._id,
                notification: {
                    notificationType: 'purchasedTickets',
                    message,
                    ticketMessage: message,
                    price: totalAmountOfTickets,
                    date: new Date()
                }
            });
        }

        Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
            type: "purchase",
            playerId: player._id,
            hallId: player.hall.id,
            purchase: totalAmountOfTickets
        });
        await updatePlayerHallSpendingData({ playerId: player._id, hallId: player.hall.id, amount: +totalAmountOfTickets, type: typeOfPurchase, gameStatus: 1 });
        return currentTicketList;
    } catch (error) {
        console.error('Error in processTicketPurchase:', error);
        throw error;
    }
}

/**
 * Generate random ball sequence for the game
 * @returns {Array} - Array of ball numbers
 */
const generateBallSequence = function() {
    try {
        const ballNumbers = Array.from({length: 60}, (_, i) => i + 1);
        const drawnBalls = [];
        
        // Draw 33 balls randomly
        for (let i = 0; i < 33; i++) {
            const randomIndex = Math.floor(Math.random() * ballNumbers.length);
            drawnBalls.push(ballNumbers[randomIndex]);
            ballNumbers.splice(randomIndex, 1);
        }
        
        return drawnBalls;
    } catch (error) {
        console.error('Error in generateBallSequence:', error);
        // Return a default sequence in case of error
        return Array.from({length: 33}, (_, i) => i + 1);
    }
};

// Helper functions
const processPatternWinners = async function(patternWinnerArray, gameId, multiplierValue, winnerAmount, playerId) {
    try {
        const patternWinnersArray = [];
        for (const pattern of patternWinnerArray) {
            const transactionData = {
                playerId: pattern.winnerPlayerId,
                gameId: pattern.gameId,
                ticketId: pattern.ticketId,
                patternId: pattern.patternId,
                patternName: pattern.patternName,
                patternPrize: pattern.patternPrize,
                transactionSlug: "patternPrizeGame4",
                extraSlug: "Game4",
                action: "credit",
                purchasedSlug: "realMoney",
                multiplierValue: multiplierValue
            };
            
            const winningAmount = await Sys.Helper.gameHelper.createTransactionPlayer(transactionData);
            
            if (Array.isArray(winningAmount) && winningAmount.length > 0 && winningAmount[0].winningPrice > 0) {
                patternWinnersArray.push({
                    playerId: pattern.winnerPlayerId,
                    gameId: pattern.gameId,
                    ticketId: pattern.ticketId,
                    patternId: pattern.patternId,
                    patternName: pattern.patternName,
                    walletType: "realMoney",
                    finalWonAmount: parseFloat(winningAmount[0].winningPrice).toFixed(2),
                    lineTypeArray: pattern.patternName
                });
                await Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                    type: "winning",
                    playerId: pattern.winnerPlayerId,
                    hallId: '',
                    winning: parseFloat(winningAmount[0].winningPrice).toFixed(2)
                });
                await updatePlayerHallSpendingData({ playerId: pattern.winnerPlayerId, hallId: '', amount: +parseFloat(winningAmount[0].winningPrice).toFixed(2), type: 'normal', gameStatus: 3 });
            }
        }
        
        // Update ticket stats with winnings
        await updateTicketWinningStats(patternWinnersArray, gameId);
        if(winnerAmount > 0 && playerId && gameId){
            // Create transaction for the total winnings
            const newExtraTransaction = {
                playerId: playerId,
                gameId: gameId,
                extraSlug: "Game4",
                transactionSlug: "extraTransaction",
                typeOfTransaction: "Pattern Prize",
                action: "credit",
                purchasedSlug: "realMoney",
                totalAmount: winnerAmount,
            };

            // Process the transaction and return the result
            Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
        }
        return true;
    } catch (error) {
        console.error('Error in processPatternWinners:', error);
        throw error;
    }
}

const calculateTotalWinnings = async function(patternWinnerArray, multiplierValue, playerId, gameId) {
    try {
        const totalWinnings = patternWinnerArray.reduce((total, pattern) => {
            return total + (Number(pattern.patternPrize) * Number(multiplierValue));
        }, 0);
        return totalWinnings;
    } catch (error) {
        console.error('Error in calculateTotalWinnings:', error);
        return 0;
    }
}

const updateTicketWinningStats = async function(patternWinnersArray, gameId) {
    try {
        // Group by ticket ID and sum winnings
        const ticketStats = [...patternWinnersArray.reduce((map, item) => {
            if (!map.has(item.ticketId)) {
                map.set(item.ticketId, { ...item, finalWonAmount: 0 });
            }
            map.get(item.ticketId).finalWonAmount = parseFloat(
                parseFloat(map.get(item.ticketId).finalWonAmount) + 
                parseFloat(item.finalWonAmount)
            ).toFixed(4);
            return map;
        }, new Map).values()];
        
        // Prepare bulk operations
        const bulkOperations = ticketStats.map(ticket => {
            const winningStats = {
                finalWonAmount: parseFloat(ticket.finalWonAmount).toFixed(4),
                lineTypeArray: [{
                    isPattern: true,
                    lineType: ticket.lineTypeArray,
                    wonAmount: parseFloat(ticket.finalWonAmount).toFixed(4)
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
                        $set: { winningStats: winningStats }, 
                        $inc: { totalWinningOfTicket: parseFloat(ticket.finalWonAmount).toFixed(4) } 
                    }
                }
            };
        });
        
        // Execute bulk operations if there are any tickets to update
        if (bulkOperations.length > 0) {
            await Sys.Game.Game4.Services.GameServices.bulkWriteTicket(bulkOperations, { ordered: false });
        }
    } catch (error) {
        console.error('Error in updateTicketWinningStats:', error);
        throw error;
    }
}

const handleTicketCloneOrUpdates = async function(gameData, mainGame, player, playerId, rawTicketList, parsedTicketList, gameId, isBot) {
    try {
        let allTicketIds = [];
        if (gameData.status === 'finish') {
            // Create new subgame
            const subGameData = await createSubGame(mainGame, player, playerId);
            
            // Clone tickets
            const sendData = {
                ticketIds: rawTicketList,
                gameId: gameId,
                userType: player.userType === "Unique" ? "Unique" : (isBot ? "Bot" : "Online"),
                uniquePlayerId: (player.userType === "Online" || isBot) ? '' : player.uniqueId,
                isAgentTicket: (player.userType === "Unique" && !player.isCreatedByAdmin),
                agentId: player.agentId,
                currentGameId: subGameData._id,
                gameName: subGameData.gameNumber,
                parsedTicketList: parsedTicketList
            };
            
            const { cloneTickets, purchasedTicketIds } = await Sys.Helper.bingo.cloneGameTickets(sendData);
            console.log("cloneTickets, purchasedTicketIds with length",cloneTickets.length, purchasedTicketIds.length, cloneTickets, purchasedTicketIds)
            parsedTicketList.length = 0;
            parsedTicketList = purchasedTicketIds; //parsedTicketList.push(...cloneTickets);
            allTicketIds = cloneTickets;
            return { updatedGameData: subGameData, parsedTicketList, allTicketIds };
        } else {
            // Get existing tickets and update dates of subgame
            const [, allTickets] = await Promise.all([
                Sys.Game.Game4.Services.GameServices.updateSubGame(
                    { _id: gameData._id }, { $set: {  startDate: new Date(), createdAt: new Date() } }
                ),
                Sys.Game.Game4.Services.GameServices.getTicketByData(
                    { gameId, isOriginalTicket: true },
                    { _id: 1 }
                )
            ]);
            
            if (allTickets.length > 0) {
                // Create a Set for faster lookups
                const ticketSet = new Set(parsedTicketList);
                
                // Prepare bulk update operations
                const updateOperations = [];
                
                // Process all tickets in one loop
                allTickets.forEach(ticket => {
                    const ticketIdStr = ticket._id.toString();
                    allTicketIds.push(ticketIdStr);
                    
                    if (ticketSet.has(ticketIdStr)) {
                        updateOperations.push({
                            updateOne: {
                                filter: { _id: ticket._id },
                                update: { isPurchased: true }
                            }
                        });
                    }
                });
                
                // Execute bulk update if needed
                if (updateOperations.length > 0) {
                    await Sys.Game.Game4.Services.GameServices.bulkWriteTicket(updateOperations, { ordered: false });
                }
            }
            return { updatedGameData: gameData, parsedTicketList, allTicketIds };
        }
    } catch (error) {
        console.error('Error in handleTicketCloneOrUpdates:', error);
        throw error;
    }
}

/**
 * Formats the final response for Game4Play
 * @param {Object} params - Parameters for formatting response
 * @param {Array} params.patternWinnerArray - Array of pattern winners
 * @param {Array} params.achiveBallArr - Array of withdrawn balls
 * @param {number} params.winnerAmount - Total winning amount
 * @param {Object} params.updatedPlayer - Updated player data
 * @param {Array} params.allTicketIds - Array of all ticket IDs
 * @param {Array} params.parsedTicketList - Array of parsed tickets
 * @param {string} params.gameId - Game ID
 * @param {Array} params.currentTicketList - Current ticket list
 * @returns {Object} - Formatted response object
 */
const formatGamePlayResponse =async function({
    patternWinnerArray,
    achiveBallArr,
    winnerAmount,
    playerId,
    allTicketIds,
    parsedTicketList,
    gameId,
    currentTicketList,
    isSoundPlay
}) {
    try {
        // Format winning tickets
        const winnerTicket = patternWinnerArray.map(winner => {
            const result = {
                ticketId: winner.ticketId,
                winningPatternIdList: [winner.patternId],
                winningAmount: winner?.winningAmount
            };
            
            if ('row1L_2L_winningPattern' in winner) {
                result.row1L_2L_winningPattern = winner.row1L_2L_winningPattern;
            }
            
            return result;
        });

        // Check for mystery game pattern
        const hasExtraGame = patternWinnerArray.some(pattern => 
            pattern.patternType === "1,1,1,1,1.1,0,0,0,1.1,1,1,1,1"
        );

        const updatedPlayer = await Sys.Game.Game4.Services.PlayerServices.getById(
            playerId,
            { _id: 1, points: 1, walletAmount: 1 }
        );

        // Build response object
        const response = {
            withdrawNumberList: achiveBallArr,
            winningPrize: winnerAmount,
            winningTicketList: winnerTicket,
            pointsAfterWinning: updatedPlayer.points,
            points: updatedPlayer.points,
            realMoney: parseFloat(updatedPlayer.walletAmount).toFixed(2),
            realMoneyAfterWinning: parseFloat(+updatedPlayer.walletAmount + +winnerAmount).toFixed(2),
            currentTicketIdList: allTicketIds.length > 0 ? allTicketIds : parsedTicketList,
            miniGameId: gameId.toString(),
            todaysBalance: parseFloat(updatedPlayer.walletAmount).toFixed(2),
            ticketList: currentTicketList,
            extraGamePlay: hasExtraGame,
            isSoundPlay,
            ballsShouldBeWithdrawn: 0
        };

        return {response, hasExtraGame};
    } catch (error) {
        console.error('Error in formatGamePlayResponse:', error);
        throw error;
    }
}

/**
 * Creates and saves a winning pattern notification
 * @param {Object} params - Parameters for creating notification
 * @param {Array} params.patternWinnerArray - Array of pattern winners
 * @param {Object} params.gameData - Game data object
 * @param {number} params.winnerAmount - Total winning amount
 * @param {Object} params.player - Player data object
 * @returns {Promise<void>} - Resolves when notification is created and saved
 */
const createWinningPatternNotification = async function({
    patternWinnerArray,
    gameData,
    winnerAmount,
    player
}) {
    try {
        // Only proceed if there are winners and notifications are enabled
        if (!patternWinnerArray.length || !player.enableNotification) {
            return;
        }

        // Generate list of winning pattern names
        const winningPatterns = [...new Set(patternWinnerArray.map(obj => obj.patternName))].join(", ");
        const patternText = patternWinnerArray.length > 1 ? " Patterns" : " Pattern";

        // Create notification messages in parallel
        const enMessage = await translate({
            key: "game4_winining_noti",
            language: 'en',
            isDynamic: true,
            number: gameData.gameNumber,
            number1: gameData.gameName,
            number2: +winnerAmount,
            number3: winningPatterns + patternText
        });
        
        const norMessage = await translate({
            key: "game4_winining_noti",
            language: 'nor',
            isDynamic: true,
            number: gameData.gameNumber,
            number1: gameData.gameName,
            number2: +winnerAmount,
            number3: winningPatterns + patternText
        });

        // Save notification
        await Sys.Game.Common.Services.NotificationServices.create({
            playerId: player._id,
            gameId: gameData._id,
            notification: {
                notificationType: 'patternWin',
                message: {
                    en: enMessage,
                    nor: norMessage
                }
            }
        });
    } catch (error) {
        console.error('Error creating winning pattern notification:', error);
    }
};

/**
 * Checks if a pattern matches the ticket cells
 * @param {Array} ticketCells - Array of ticket cell numbers
 * @param {Array} pattern - Pattern to check against
 * @param {Array} achiveBallArr - Array of withdrawn ball numbers
 * @returns {boolean} - Whether pattern matches
 */
const isPatternMatching = function(ticketCells, pattern, achiveBallArr) {
    const patternTicketTemp = ticketCells.map((cell, index) => {
        if (!achiveBallArr.includes(cell)) return 0;
        return pattern[index] === 1 ? 1 : 0;
    });
    
    return JSON.stringify(patternTicketTemp) === JSON.stringify(pattern);
};

/**
 * Updates ticket pattern status in game
 * @param {string} gameId - Game ID
 * @param {string} ticketId - Ticket ID
 * @returns {Promise<void>}
 */
const updateTicketPatternStatus = async function(gameId, ticketId) {
    try {
        await Sys.Game.Game4.Services.GameServices.updateSubGame(
            {
                _id: gameId,
                "purchasedTickets.ticketId": ticketId
            },
            {
                $set: {
                    "purchasedTickets.$.isPattern": true
                }
            },
            { new: true }
        );
    } catch (error) {
        console.error('Error updating ticket pattern status:', error);
    }
};


/**
 * Creates a winner object for a pattern match
 * @param {Object} params - Parameters for creating winner object
 * @returns {Object} - Winner object
 */
const createWinnerObject = function({
    gameId,
    playerId,
    ticketId,
    patternId,
    count,
    patternName,
    patternPrize,
    patternType,
    ticketNumber,
    ticketCells,
    winningPattern = null,
    winningAmount
}) {
    const winnerObj = {
        gameId,
        winnerPlayerId: playerId,
        ticketId,
        patternId,
        count,
        patternName,
        patternPrize,
        patternType,
        ticketNumber,
        purchasedSlug: "realMoney",
        ticketCellArr: ticketCells,
        isPattern: true,
        winningAmount
    };

    if (winningPattern) {
        winnerObj.row1L_2L_winningPattern = winningPattern;
    }

    return winnerObj;
};

/**
 * Checks patterns for a specific ticket
 * @param {Object} params - Parameters for pattern checking
 * @returns {Promise<Array>} - Array of winners
 */
const checkPatternsForTicket = async function ({
    patternListData,
    subGameId,
    achiveBallArr,
    q,
    ticket,
    patternNamePrice,
    patterns = null,
    multiplierValue
}) {
    try {
        const winners = [];
        const patternPrice = patternNamePrice[0][`Pattern${q + 1}`];

        const patternsToCheck = patterns || [{ pattern: get2DArrayFromString(patternListData.patternType) }];

        for (const { pattern } of patternsToCheck) {
            if (isPatternMatching(ticket.ticketCellNumberList, pattern, achiveBallArr)) {
                console.log('\x1b[36m%s\x1b[0m', '-----------------------------');
                console.log('\x1b[36m%s\x1b[0m', `Pattern Win: [ ${patternListData.patternName} ]`);
                console.log('\x1b[36m%s\x1b[0m', '-----------------------------');

                const winner = createWinnerObject({
                    gameId: ticket.gameId,
                    playerId: ticket.playerIdOfPurchaser,
                    ticketId: ticket.ticketId,
                    patternId: patternListData._id,
                    count: patternListData.count,
                    patternName: patternListData.patternName,
                    patternPrize: patternPrice,
                    patternType: patternListData.patternType,
                    ticketNumber: ticket.ticketNumber,
                    ticketCells: ticket.ticketCellNumberList,
                    winningPattern: patterns ? pattern : null,
                    winningAmount: +exactMath.mul(patternPrice, multiplierValue).toFixed(2)
                });

                await updateTicketPatternStatus(subGameId, ticket.ticketId);

                winners.push(winner);
                break; // Stop on first winning pattern for this ticket
            }
        }

        return winners;
    } catch (e) {
        console.log("Error in checkPatternsForTicket", e);
        return [];
    }
};

// By using redis data
const checkForRuningGame = async ({ playerId, socket}) => {
    try {
        const todayStart = new Date(); todayStart.setHours(0,0,0,0);
        const todayEnd = new Date(); todayEnd.setHours(23,59,59,999);

        const runningGame = await Sys.App.Services.GameService.getSingleSubGameData(
            {
                gameType:'game_4',
                status:{ $ne:'active' },
                'otherData.playerId':playerId,
                'otherData.isBallWithdrawn':false,
                startDate:{ $gte: todayStart, $lt: todayEnd }
            },
            { startDate: 1, createdAt: 1 }
        );
        if (!runningGame) return { status:false };

        const { _id: gameId, startDate, createdAt } = runningGame;

        const redisKey = `game4:${playerId}:${gameId}`;
        

        const cached = await getCachedGame4Data(redisKey, gameId);
        if (!cached) {
            return { status: false };
        }

        let game4Data;
        try {
            game4Data = JSON.parse(cached);
        } catch (e) {
            console.error('Invalid Redis JSON:', e);
            return { status: false };
        }

        const { patternList, ticketPrice, totalAmountOfTickets, betData, patternWinnerArray, achiveBallArr, winnerAmount, seconds, seconds2, allTicketIds, parsedTicketList, currentTicketList } = game4Data;
        const { response } = await formatGamePlayResponse({
            patternWinnerArray,
            achiveBallArr,
            winnerAmount,
            playerId,
            gameId,
            isSoundPlay: seconds>=2000 && seconds2>=2000,
            allTicketIds,
            parsedTicketList,
            currentTicketList
        });

        // Join Socket in Game
        socket?.join?.(gameId);
        if (socket) socket.myData={ playerID: playerId, gameId, gameType:'game_4', gameName:'Spillorama' };
        
        // Calculate total balls withdrawn count till now
        const ballsShouldBeWithdrawn = calculateBallsWithdrawn({
            startDate,
            createdAt,
            seconds,
            seconds2
        });

        response.ballsShouldBeWithdrawn = ballsShouldBeWithdrawn;
        // Remove ticketList from the response object if present
        // if ('ticketList' in response) {
        //     delete response.ticketList;
        // }

        // Re verify if key is there and if present then send this reponse otherwise need to start new game
        // const isCached = await getCachedGame4Data(redisKey, gameId);
        // if(!isCached) return { status:false };

        return  { status:'running', patternList, ticketList: currentTicketList, parsedTicketList, ticketPrice:ticketPrice, totalAmountOfTickets, betData, gameId, first18BallTime: (seconds/1000).toString(), last15BallTime: (seconds2/1000).toString(), response };

    } catch (e) {
        console.error('checkForRuningGame:', e);
        return { status:false, error:'something_went_wrong' };
    }
};

// Calculate balls withdrawn and game finish time with a helper function
function calculateBallsWithdrawn({ startDate, createdAt, seconds, seconds2 }) {
    try {
        const phase1Balls = 18, totalBalls = 33;
        const start = new Date(startDate || createdAt).getTime();
        if (isNaN(start)) {
            throw new Error('Invalid start date or createdAt provided to calculateBallsWithdrawn.');
        }
        const elapsed = Math.max(Date.now() - start, 0);

        let ballsShouldBeWithdrawn = 0;

        if (start && Number.isFinite(seconds) && Number.isFinite(seconds2)) {
            const t1 = seconds,
                  t2 = seconds2,
                  p1Time = phase1Balls * t1;

            const balls =
                Math.floor(Math.min(elapsed, p1Time) / t1) +
                Math.floor(Math.max(elapsed - p1Time, 0) / t2);

            ballsShouldBeWithdrawn = Math.min(balls, totalBalls);
        }
        return ballsShouldBeWithdrawn;
    } catch (error) {
        console.error('Error in calculateBallsWithdrawn:', error);
        return 0;
    }
}

// Function to get redis data and if not present then update game 
const getCachedGame4Data = async (redisKey, gameId) => {
    try {
        const cached = await redis.get(redisKey);
        if (!cached) {
            await Sys.Game.Game4.Services.GameServices.updateSubGame(
                { _id: gameId },
                { $set: { 'otherData.isBallWithdrawn': true } }
            );
            return null;
        }
        return cached;
    } catch (err) {
        console.error("Error in getCachedGame4Data:", err);
        return null;
    }
};


module.exports = {
    createSubGame,
    createSubGameTickets,
    processPatterns,
    formatTickets,
    generateBallSequence,
    processTicketPurchase,
    processPatternWinners,
    calculateTotalWinnings,
    updateTicketWinningStats,
    handleTicketCloneOrUpdates,
    processVoucherCode,
    formatGamePlayResponse,
    createWinningPatternNotification,
    checkPatternsForTicket,
    checkForRuningGame
}; 