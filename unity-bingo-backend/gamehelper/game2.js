
const Sys = require('../Boot/Sys');
const moment = require('moment');
const { translate } = require('../Config/i18n');
const { getOnlinePlayers, compareTimeSlots, validateBalance, checkPlayerSpending, updatePlayerHallSpendingData, checkGamePlayAtSameTimeForRefund } = require('./all');
const Timeout = require('smart-timeout');

const validateGameTiming = async function(gameData, player) {
    try {
        // Check player break time
        if (player?.startBreakTime && player?.endBreakTime) {
            const currentTime = moment();
            if (currentTime.isBetween(player.startBreakTime, player.endBreakTime, null, '[]')) {
                return {
                    isValid: false,
                    error: 'break_started_not_purchase'
                };
            }
        }

        // Check if game has already started
        const isGameStarted = (gameData.gameMode === 'manual' && gameData.startDate <= Date.now()) || 
                             (gameData.gameMode === 'auto' && Sys.StartedGame.includes(gameData._id.toString()));
        
        if (isGameStarted) {
            return {
                isValid: false,
                error: 'game_time_over'
            };
        }

        // Get parent game data and check if game is closed
        const parentGameData = await Sys.Game.Game2.Services.GameServices.getSingleParentGame(
            { _id: gameData.parentGameId }, 
            { otherData: 1, days: 1 }
        );
        
        if (!parentGameData) {
            return { isValid: true };
        }

        const today = moment();
        const todayFormatted = today.format('YYYY-MM-DD');
        const todayDay = today.format('ddd');
        const gameStartDate = moment(gameData.startDate).format('YYYY-MM-DD');
        
        // Check if today is a valid game day and matches the game start date
        if (!parentGameData.days?.[todayDay] || gameStartDate !== todayFormatted) {
            return { isValid: true };
        }
        
        // Check if game is in a closed time slot
        // const currentTime = today.format('HH:mm');
        // const closeDays = parentGameData.otherData?.closeDay || [];
        
        // const isClosedNow = closeDays.some(closeDay => 
        //     closeDay.closeDate === todayFormatted && 
        //     compareTimeSlots(currentTime, closeDay.startTime, 'gte') && 
        //     compareTimeSlots(currentTime, closeDay.endTime, 'lte')
        // );
        
        // if (isClosedNow) {
        //     return {
        //         isValid: false,
        //         error: 'game2_closed'
        //     };
        // }

        return { isValid: true };
    } catch (error) {
        console.error("Error in validateGameTiming:", error);
        return {
            isValid: false,
            error: 'something_went_wrong'
        };
    }
}

// const validateBalance = async (player, totalAmount, purchaseType) => {
//     try {
//         if (purchaseType === 'points') {
//             return player.points >= totalAmount ? true : { isValid: false, error: 'Insufficient_balance' };
//         } else if (purchaseType === 'realMoney') {
//             return player.walletAmount >= totalAmount ? true : { isValid: false, error: 'Insufficient_balance' };
//         } else if (purchaseType === 'voucher') {
//             return { isValid: false, error: 'voucher_not_applied_for_game' };
//         } else {
//             return { isValid: false, error: 'something_went_wrong' };
//         }
//     } catch (error) {
//         console.error("Error in validateBalance:", error);
//         return false;
//     }
// };

/**
 * Adjusts player's wallet and monthly limit by deducting or crediting an amount.
 * 
 * @param {ObjectId} playerId - The ID of the player.
 * @param {Number} amount - The amount to deduct or credit.
 * @param {"deduct"|"credit"} action - Specify whether to deduct or credit.
 * @param {String} userType - The user's type (e.g., "Bot", "Online", etc.)
 */
const adjustPlayerBalance = async function(playerId, amount, action, purchaseType, userType = "") {

    const adjustment = action === "deduct" ? -amount : amount;
    const balanceField = purchaseType === 'points' ? 'points' : 'walletAmount';
    const updateObj = {
      $inc: {
        [balanceField]: adjustment
      }
    };
  
    if (userType !== "Bot") {
      updateObj.$inc.monthlyWalletAmountLimit = adjustment;
    }
  
    return await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer({ _id: playerId }, updateObj, { new: true });
}

// const processPurchase = async function(player, gameData, tickets, purchaseType, voucherData, purchasedTicketIds, luckyNumber, autoPlay, socket) {
//     try {
//         console.log("data", player, gameData, tickets, purchaseType, voucherData, purchasedTicketIds, luckyNumber, autoPlay)
//         const userType = player.userType === "Unique" ? "Unique" : 
//                          player.userType === "Bot" ? "Bot" : "Online";
//         // Calculate amounts
//         const ticketPrice = gameData.ticketPrice;
//         const totalAmount = ticketPrice * tickets.length;
        
//         // Validate balance
//         const balanceValidation = await validateBalance(player, totalAmount, purchaseType);
//         console.log("balanceValidation", balanceValidation)
//         if (balanceValidation !== true) {
//             return balanceValidation;
//         }
        
//         // Check monthly wallet limit if using real money
//         if (purchaseType === 'realMoney' && player.monthlyWallet && player.monthlyWalletAmountLimit < totalAmount) {
//             console.log("monthlyWalletAmountLimit", player.monthlyWalletAmountLimit, totalAmount)
//             return {
//                 isValid: false,
//                 error: 'update_wallet_limit',
//                 result: {
//                     playerId: player._id,
//                     username: player.username,
//                 }
//             };
//         }

//         console.log("purchasedTicketIds---", purchasedTicketIds, tickets)
//         // Check if any of the tickets being purchased are already purchased
//         if (purchasedTicketIds?.length && tickets.some(ticketId => purchasedTicketIds.includes(ticketId))) {
//             console.log("purchasedTicketIds1----", purchasedTicketIds, tickets)
//             return {
//                 isValid: false,
//                 error: 'game2_tickets_already_purchased',
//                 result: {
//                     playerId: player._id,
//                     username: player.username,
//                 }
//             };
//         }
        
//         // Check if player has already purchased 30 tickets
//         if (purchasedTicketIds.length + tickets.length > 30) {
//             console.log("purchasedTicketIds2----", purchasedTicketIds, tickets)
//             return {
//                 isValid: false,
//                 error: 'already_purchased_tickets',
//                 result: {
//                     playerId: player._id,
//                     username: player.username,
//                 }
//             };
//         }

//         // calculate purcahse amount for player
//         let payableAmount = gameData.ticketPrice;
//         let voucherAmount = 0;
//         if (voucherData) {
//             // Calculate discounted price directly
//             payableAmount = gameData.ticketPrice * (1 - voucherData.percentageOff / 100);
//             voucherAmount = (gameData.ticketPrice - payableAmount);
//             await Sys.Game.Common.Services.PlayerServices.updateOneTransaction({ _id: voucherData.transactionId }, { isVoucherUse: true });
//         }

//         // Deduct balance from player
//         const playerUpdated = await adjustPlayerBalance(player._id, payableAmount*tickets.length, "deduct", purchaseType, player.userType);
//         console.log("playerUpdated", playerUpdated)
//         // Create purchase records
//         const groupHall = gameData.groupHalls.find(grp => 
//             grp.halls.some(hall => hall.id.toString() === player.hall.id.toString())
//         );

//         let purchasingTicketDocs = await Sys.Game.Game2.Services.GameServices.getTicketByData(
//             { _id: { $in: tickets }, isPurchased: false },
//             { _id: 1, isPurchased: 1, gameId: 1, tickets: 1, supplier: 1, developer: 1, ticketId: 1 }
//         );

//         if(purchasingTicketDocs.length !== tickets.length) {
//             console.log("purchasingTicketDocs.length !== tickets.length", purchasingTicketDocs.length, tickets.length)
//             // Refund balance to player
//             await adjustPlayerBalance(player._id, payableAmount*tickets.length, "credit", purchaseType, player.userType);
//             return {
//                 isValid: false,
//                 error: 'game2_tickets_already_purchased',
//                 result: {
//                     playerId: player._id,
//                     username: player.username,
//                 }
//             };
//         }

//         // Update tickets in bulk
//         const updateTicketResult = await Sys.Game.Game2.Services.GameServices.updateMultiTicket(
//             { _id: { $in: tickets }, isPurchased: false },
//             {
//                 $set: {
//                     isPurchased: true,
//                     isCancelled: false,
//                     playerNameOfPurchaser: player.username,
//                     playerIdOfPurchaser: player._id.toString(),
//                     userType: player.userType,
//                     uniquePlayerId: (player.userType === "Online" || player.userType === "Bot") ? '' : player.uniqueId,
//                     ticketPurchasedFrom: purchaseType,
//                     isAgentTicket: player.userType === "Unique" && !isCreatedByAdmin,
//                     agentId: player.agentId,
//                     hallName: player.hall.name,
//                     groupHallName: groupHall.name,
//                     hallId: player.hall.id,
//                     groupHallId: groupHall.id,
//                     createdAt: new Date()
//                 }
//             }
//         );
//         console.log("updateTicketResult", updateTicketResult)
//         if (!updateTicketResult || updateTicketResult.modifiedCount !== tickets.length) {
//             console.log("updateTicketResult.modifiedCount !== tickets.length", updateTicketResult.modifiedCount, tickets.length)
//             // Refund balance to player
//             await adjustPlayerBalance(player._id, payableAmount*tickets.length, "credit", purchaseType, player.userType);
//             return {
//                 isValid: false,
//                 error: 'game2_tickets_already_purchased',
//                 result: {
//                     playerId: player._id,
//                     username: player.username,
//                 }
//             };
//         }

//         // create bulk transactions
//         let playerBalance = player.walletAmount;
//         let purchasedTickets = [];
//         let transactions = [];
//         let transactionPrefix = 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now());

//         for (let i = 0; i < purchasingTicketDocs.length; i++) {
//             let ticket = purchasingTicketDocs[i];
//             let transactionId = transactionPrefix + Math.floor(100000 + Math.random() * 900000);

//             purchasedTickets.push({
//                 gameId: ticket.gameId,
//                 ticketCellNumberList: ticket.tickets,
//                 isPurchased: true,
//                 playerIdOfPurchaser: player._id.toString(),
//                 hallName: player.hall.name,
//                 supplier: ticket.supplier,
//                 developer: ticket.developer,
//                 ticketNumber: ticket.ticketId,
//                 ticketId: ticket._id,
//                 purchasedSlug: purchaseType,
//                 socketId: socket.id,
//                 voucherTranasctionId: voucherData?.transactionId || "",
//                 voucherId: voucherData?.voucherId || "",
//                 voucherCode: voucherData?.voucherCode || "",
//                 isVoucherPayableAmount: voucherData ? payableAmount : "",
//                 totalAmount: payableAmount,
//                 ticketCompleted: false,
//                 userType,
//                 uniquePlayerId: (userType === "Online" || userType === "Bot") ? "" : player.uniqueId,
//                 hallId: player.hall.id,
//                 groupHallName: groupHall.name,
//                 groupHallId: groupHall.id
//             });

//             transactions.push({
//                 transactionId,
//                 playerId: player._id,
//                 playerName: player.username,
//                 gameId: gameData._id,
//                 gameNumber: gameData.gameNumber,
//                 gameName: gameData.gameName,
//                 gameType: gameData.gameType,
//                 gameStartDate: gameData.startDate,
//                 gameMode: gameData.gameMode,
//                 differenceAmount: payableAmount,
//                 ticketPrice: gameData.ticketPrice,
//                 ticketId: ticket._id,
//                 ticketNumber: ticket.ticketId,
//                 hallId: player.hall.id,
//                 groupHallId: groupHall.id,
//                 variantGame: "",
//                 ticketColorType: "",
//                 voucherId: voucherData ? voucherData.voucherId : "",
//                 voucherCode: voucherData?.voucherCode || "",
//                 voucherAmount: voucherData ? voucherAmount : "",
//                 isVoucherUse: !!voucherData,
//                 isVoucherApplied: !!voucherData,
//                 defineSlug: "buyTicket",
//                 category: "debit",
//                 status: "success",
//                 amtCategory: purchaseType,
//                 previousBalance: playerBalance,
//                 afterBalance: playerBalance - payableAmount,
//                 hall: {
//                     name: player.hall.name,
//                     id: player.hall.id
//                 },
//                 groupHall: {
//                     name: groupHall.name,
//                     id: groupHall.id
//                 },
//                 typeOfTransaction: "Game Join/Ticket Purchase",
//                 typeOfTransactionTotalAmount: payableAmount,
//                 remark: `Purchased ${ticket.ticketId} Ticket`,
//                 userType,
//                 createdAt: Date.now(),
//                 isBotGame: !!gameData?.otherData?.isBotGame
//             });

//             playerBalance -= payableAmount;
//         }
//         console.log("transactions", transactions)
//         // Bulk insert transactions
//         Sys.Game.Common.Services.PlayerServices.createBulkTransaction(transactions);


//         const updateQuery = [
//         {
//             $set: {
//                 // Update luckyNumber if player exists
//                 players: {
//                     $map: {
//                     input: "$players",
//                     as: "player",
//                     in: {
//                         $cond: [
//                             { $eq: ["$$player.id", playerUpdated._id] }, // Check if the player exists
//                             { $mergeObjects: ["$$player", { luckyNumber: luckyNumber }] }, // Update luckyNumber if exists
//                             "$$player" // Else, keep the player as it is
//                         ]
//                     }
//                     }
//                 },
//                 // Push the player to the array if they don't exist
//                 players: {
//                     $cond: [
//                         { $in: [playerUpdated._id, "$players.id"] },
//                         "$players", // If player exists, do nothing
//                         { $concatArrays: ["$players", [{
//                             id: playerUpdated._id,
//                             name: playerUpdated.username,
//                             status: 'Waiting',
//                             socketId: socket.id,
//                             purchasedSlug: purchaseType,
//                             points: playerUpdated.points,
//                             walletAmount: playerUpdated.walletAmount,
//                             luckyNumber: luckyNumber,
//                             autoPlay: autoPlay,
//                             isPlayerOnline: false,
//                             isLossAndWon: false
//                         }]] } // Otherwise, add new player
//                     ]
//                 },
//                 // Push purchased tickets (always add tickets)
//                 purchasedTickets: { $concatArrays: ["$purchasedTickets", purchasedTickets] }
//             }
//         }
//         ];

//         const updateGameTemp = await Sys.Game.Game2.Services.GameServices.updateSingleGame({ _id: gameData._id },updateQuery, { new: true });
//         console.log("updateGameTemp", updateGameTemp, purchasedTickets, payableAmount, tickets.length)
        
//         return {
//             isValid: true,
//             tickets: purchasedTickets,
//             updatedGame: updateGameTemp,
//             totalPayableAmount: payableAmount*tickets.length
//         };

//     } catch (error) {
//         console.error("Error in processPurchase:", error);
//         return {
//             isValid: false,
//             error: 'internal_server_error'
//         };
//     }
// }

const processPurchase = async (player, gameData, tickets, purchaseType, voucherData, purchasedTicketIds = [], luckyNumber, autoPlay, socket) => {
    const userType = ["Unique", "Bot"].includes(player.userType) ? player.userType : "Online";
    const ticketPrice = gameData.ticketPrice;
    const ticketCount = tickets.length;
    const totalAmount = ticketPrice * ticketCount;

    try {
        const [balanceValidation] = await Promise.all([
            validateBalance(player, totalAmount, purchaseType)
        ]);

        if (balanceValidation !== true) {
            console.log("balanceValidation failed", balanceValidation);
            return balanceValidation;
        }

        if (purchaseType === 'realMoney' && player.monthlyWallet && player.monthlyWalletAmountLimit < totalAmount) {
            console.log("monthlyWalletAmountLimit exceeded", player.monthlyWalletAmountLimit, totalAmount);
            return { isValid: false, error: 'update_wallet_limit', result: { playerId: player._id, username: player.username } };
        }

        if (purchasedTicketIds.some(id => tickets.includes(id)) || (purchasedTicketIds.length + ticketCount > 30)) {
            console.log("Ticket purchase validation failed");
            return { isValid: false, error: 'game2_tickets_already_purchased', result: { playerId: player._id, username: player.username } };
        }
        let deductPlayerSpending = await checkPlayerSpending({ playerId: player._id, hallId: player.hall.id, amount: +totalAmount });
            if(!deductPlayerSpending.isValid){
                return { isValid: false, error: deductPlayerSpending.error, result: { playerId: player._id, username: player.username } };
            }

        // Voucher adjustment
        let payableAmount = ticketPrice;
        let voucherAmount = 0;

        if (voucherData) {
            payableAmount = ticketPrice * (1 - (voucherData.percentageOff ?? 0) / 100);
            voucherAmount = ticketPrice - payableAmount;
            await Sys.Game.Common.Services.PlayerServices.updateOneTransaction({ _id: voucherData.transactionId }, { isVoucherUse: true });
        }

        // Deduct balance
        const finalPayableAmount = +parseFloat((payableAmount * ticketCount).toFixed(2));
        const playerUpdated = await adjustPlayerBalance(player._id, finalPayableAmount, "deduct", purchaseType, player.userType);

        const groupHall = gameData.groupHalls.find(grp => grp.halls.some(hall => hall.id.toString() === player.hall.id.toString()));

        const purchasingTicketDocs = await Sys.Game.Game2.Services.GameServices.getTicketByData(
            { _id: { $in: tickets }, isPurchased: false },
            { _id: 1, isPurchased: 1, gameId: 1, tickets: 1, supplier: 1, developer: 1, ticketId: 1 }
        );

        if (purchasingTicketDocs.length !== ticketCount) {
            await adjustPlayerBalance(player._id, finalPayableAmount, "credit", purchaseType, player.userType);
            return { isValid: false, error: 'game2_tickets_already_purchased', result: { playerId: player._id, username: player.username } };
        }

        const updateTicketResult = await Sys.Game.Game2.Services.GameServices.updateMultiTicket(
            { _id: { $in: tickets }, isPurchased: false },
            {
                $set: {
                    isPurchased: true,
                    isCancelled: false,
                    playerNameOfPurchaser: player.username,
                    playerIdOfPurchaser: player._id.toString(),
                    userType: player.userType,
                    uniquePlayerId: (userType === "Online" || userType === "Bot") ? '' : player.uniqueId,
                    ticketPurchasedFrom: purchaseType,
                    isAgentTicket: player.userType === "Unique" && !isCreatedByAdmin,
                    agentId: player.agentId,
                    hallName: player.hall.name,
                    groupHallName: groupHall?.name ?? "",
                    hallId: player.hall.id,
                    groupHallId: groupHall?.id ?? "",
                    'otherData.payableAmount': payableAmount, // This is the exact amount that is used to pay for the ticket (will be used for voucher)
                    createdAt: new Date(),
                    
                }
            }
        );

        if (!updateTicketResult || updateTicketResult.modifiedCount !== ticketCount) {
            await adjustPlayerBalance(player._id, finalPayableAmount, "credit", purchaseType, player.userType);
            console.log("updateTicketResult mismatch", updateTicketResult.modifiedCount, ticketCount);
            return { isValid: false, error: 'game2_tickets_already_purchased', result: { playerId: player._id, username: player.username } };
        }

        // Prepare transactions and purchasedTickets
        const transactionPrefix = 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now());
        let playerBalance = player.walletAmount;

        const [transactions, purchasedTickets] = purchasingTicketDocs.reduce(([trx, pur], ticket) => {
            const transactionId = transactionPrefix + Math.floor(100000 + Math.random() * 900000);

            pur.push({
                gameId: ticket.gameId,
                ticketCellNumberList: ticket.tickets,
                isPurchased: true,
                playerIdOfPurchaser: player._id.toString(),
                hallName: player.hall.name,
                supplier: ticket.supplier,
                developer: ticket.developer,
                ticketNumber: ticket.ticketId,
                ticketId: ticket._id,
                purchasedSlug: purchaseType,
                socketId: socket.id,
                voucherTranasctionId: voucherData?.transactionId ?? "",
                voucherId: voucherData?.voucherId ?? "",
                voucherCode: voucherData?.voucherCode ?? "",
                isVoucherPayableAmount: voucherData ? payableAmount : "",
                totalAmount: payableAmount,
                ticketCompleted: false,
                userType,
                uniquePlayerId: (userType === "Online" || userType === "Bot") ? "" : player.uniqueId,
                hallId: player.hall.id,
                groupHallName: groupHall?.name ?? "",
                groupHallId: groupHall?.id ?? ""
            });

            trx.push({
                transactionId,
                playerId: player._id,
                playerName: player.username,
                gameId: gameData._id,
                gameNumber: gameData.gameNumber,
                gameName: gameData.gameName,
                gameType: gameData.gameType,
                gameStartDate: gameData.startDate,
                gameMode: gameData.gameMode,
                differenceAmount: payableAmount,
                ticketPrice: ticketPrice,
                ticketId: ticket._id,
                ticketNumber: ticket.ticketId,
                hallId: player.hall.id,
                groupHallId: groupHall?.id ?? "",
                variantGame: "",
                ticketColorType: "",
                voucherId: voucherData?.voucherId ?? "",
                voucherCode: voucherData?.voucherCode ?? "",
                voucherAmount: voucherData ? voucherAmount : "",
                isVoucherUse: !!voucherData,
                isVoucherApplied: !!voucherData,
                defineSlug: "buyTicket",
                category: "debit",
                status: "success",
                amtCategory: purchaseType,
                previousBalance: playerBalance.toFixed(2),
                afterBalance: (playerBalance - payableAmount).toFixed(2),
                hall: { name: player.hall.name, id: player.hall.id },
                groupHall: { name: groupHall?.name ?? "", id: groupHall?.id ?? "" },
                typeOfTransaction: "Game Join/Ticket Purchase",
                typeOfTransactionTotalAmount: payableAmount.toFixed(2),
                remark: `Purchased ${ticket.ticketId} Ticket`,
                userType,
                createdAt: Date.now(),
                isBotGame: !!gameData?.otherData?.isBotGame
            });

            playerBalance -= payableAmount;

            return [trx, pur];
        }, [[], []]);
        
        // Insert transactions in bulk
        await Sys.Game.Common.Services.PlayerServices.createBulkTransaction(transactions, {ordered: true});
        Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
            type: "purchase",
            playerId: player._id,
            hallId: player.hall.id,
            purchase: finalPayableAmount
        });
        await updatePlayerHallSpendingData({ playerId: player._id, hallId: player.hall.id, amount: +finalPayableAmount, type: deductPlayerSpending.type, gameStatus: 1 });
        const newExtraTransaction = {
            playerId: player._id,
            gameId: gameData._id,
            transactionSlug: "extraTransaction",
            typeOfTransaction: "Game Joined",
            action: "debit", // debit / credit
            purchasedSlug: purchaseType, // point /realMoney
            totalAmount: finalPayableAmount,
        }

        Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
        // Update Game
        // const updateQuery = [
        //     {
        //         $set: {
        //             // Update luckyNumber if player exists
        //             // players: {
        //             //     $map: {
        //             //         input: "$players",
        //             //         as: "player",
        //             //         in: {
        //             //             $cond: [
        //             //                 { $eq: ["$$player.id", playerUpdated._id] }, // Check if the player exists
        //             //                 { $mergeObjects: ["$$player", { luckyNumber: luckyNumber, ticketCount: { $add: ["$$player.ticketCount", ticketCount] } }] }, // Update luckyNumber if exists
        //             //                 "$$player" // Else, keep the player as it is
        //             //             ]
        //             //         }
        //             //     }
        //             // },
        //             // Push the player to the array if they don't exist
        //             // players: {
        //             //     $cond: [
        //             //         { $in: [playerUpdated._id, "$players.id"] },
        //             //         "$players", // If player exists, do nothing
        //             //         { $concatArrays: ["$players", [{
        //             //             id: playerUpdated._id,
        //             //             name: playerUpdated.username,
        //             //             status: 'Waiting',
        //             //             socketId: socket.id,
        //             //             purchasedSlug: purchaseType,
        //             //             points: playerUpdated.points,
        //             //             walletAmount: playerUpdated.walletAmount,
        //             //             luckyNumber: luckyNumber,
        //             //             autoPlay: autoPlay,
        //             //             isPlayerOnline: false,
        //             //             isLossAndWon: false,
        //             //             ticketCount: purchasedTickets.length
        //             //         }]] } // Otherwise, add new player
        //             //     ]
        //             // },

        //             players: {
        //                 $let: {
        //                     vars: {
        //                         playerExists: {
        //                             $in: [playerUpdated._id, "$players.id"]
        //                         }
        //                     },
        //                     in: {
        //                         $cond: [
        //                             "$$playerExists",
        //                             {
        //                                 $map: {
        //                                 input: "$players",
        //                                 as: "player",
        //                                 in: {
        //                                     $cond: [
        //                                     { $eq: ["$$player.id", playerUpdated._id] },
        //                                     {
        //                                         $mergeObjects: [
        //                                         "$$player",
        //                                         {
        //                                             luckyNumber: luckyNumber,
        //                                             ticketCount: {
        //                                             $add: [
        //                                                 { $ifNull: ["$$player.ticketCount", 0] },
        //                                                 ticketCount
        //                                             ]
        //                                             }
        //                                         }
        //                                         ]
        //                                     },
        //                                     "$$player"
        //                                     ]
        //                                 }
        //                                 }
        //                             },
        //                             {
        //                                 $concatArrays: [
        //                                 "$players",
        //                                 [{
        //                                     id: playerUpdated._id,
        //                                     name: playerUpdated.username,
        //                                     status: 'Waiting',
        //                                     socketId: socket.id,
        //                                     purchasedSlug: purchaseType,
        //                                     points: playerUpdated.points,
        //                                     walletAmount: playerUpdated.walletAmount,
        //                                     luckyNumber: luckyNumber,
        //                                     autoPlay: autoPlay,
        //                                     isPlayerOnline: false,
        //                                     isLossAndWon: false,
        //                                     ticketCount: ticketCount,
        //                                     hall: [{ id: player.hall.id, ticketCount: ticketCount }]
        //                                 }]
        //                                 ]
        //                             }
        //                         ]
        //                     }
        //                 }
        //             },
        //             // Push purchased tickets (always add tickets)
        //             purchasedTickets: { $concatArrays: ["$purchasedTickets", purchasedTickets] },
        //             totalNoPurchasedTickets: { $add: ["$totalNoPurchasedTickets", ticketCount] }
        //         }
        //     }
        // ];

        const updateQuery = [
            {
              $set: {
                players: {
                  $let: {
                    vars: {
                      playerExists: { $in: [playerUpdated._id, "$players.id"] }
                    },
                    in: {
                      $cond: [
                        "$$playerExists",
          
                        /* ================= PLAYER EXISTS ================= */
                        {
                          $map: {
                            input: "$players",
                            as: "player",
                            in: {
                              $cond: [
                                { $eq: ["$$player.id", playerUpdated._id] },
          
                                {
                                  $mergeObjects: [
                                    "$$player",
                                    {
                                      luckyNumber,
                                      ticketCount: {
                                        $add: [
                                          { $ifNull: ["$$player.ticketCount", 0] },
                                          ticketCount
                                        ]
                                      },
          
                                      /* -------- ADD HALL ID (NO DUPLICATE) -------- */
                                      hall: {
                                        $setUnion: [
                                          { $ifNull: ["$$player.hall", []] },
                                          [player.hall.id]
                                        ]
                                      }
                                    }
                                  ]
                                },
          
                                "$$player"
                              ]
                            }
                          }
                        },
          
                        /* ================= PLAYER DOES NOT EXIST ================= */
                        {
                          $concatArrays: [
                            "$players",
                            [{
                              id: playerUpdated._id,
                              name: playerUpdated.username,
                              status: "Waiting",
                              socketId: socket.id,
                              purchasedSlug: purchaseType,
                              points: playerUpdated.points,
                              walletAmount: playerUpdated.walletAmount,
                              luckyNumber,
                              autoPlay,
                              isPlayerOnline: false,
                              isLossAndWon: false,
                              ticketCount,
                              hall: [player.hall.id]
                            }]
                          ]
                        }
                      ]
                    }
                  }
                },
          
                purchasedTickets: {
                  $concatArrays: ["$purchasedTickets", purchasedTickets]
                },
                totalNoPurchasedTickets: {
                  $add: ["$totalNoPurchasedTickets", ticketCount]
                }
              }
            }
          ];

        let updatedGame = await Sys.Game.Game2.Services.GameServices.updateSingleGame({ _id: gameData._id }, updateQuery, { new: true });

        // for bot game
        if (updatedGame.otherData && updatedGame.otherData.isBotGame == true) {
            updatedGame = await Sys.Game.Game2.Services.GameServices.updateSingleGame({ _id: updatedGame._id }, { $inc: { 'otherData.alreadyPurchasedBotPot': finalPayableAmount, 'otherData.ticketPurchasedByBotCount': ticketCount } }, { new: true });
        }
        // for bot game

        return { isValid: true, tickets: purchasedTickets, updatedGame, totalPayableAmount: finalPayableAmount };

    } catch (error) {
        console.error("Error in processPurchase:", error);
        return { isValid: false, error: 'something_went_wrong' };
    }
};

const handleAutoPlay = async function(player, gameData, purchaseType, finalDataTicket, totalPayableAmount, socketId, luckyNumber) {
    try {
        const autoPlayData = {
            playerId: player._id,
            gameId: gameData._id,
            purchasedSlug: purchaseType,
            ticketLength: finalDataTicket,
            luckyNumber: luckyNumber,
            autoPlay: true,
            socketId: socketId, 
        };

        const result = await Sys.Helper.gameHelper.autoBuyTicket(autoPlayData);
        
        if (result.isAuto) {
            await createGameNotification({
                playerId: player._id,
                gameData,
                ticketCount: finalDataTicket,
                totalPayableAmount: +parseFloat(totalPayableAmount + result.totalOfTicketAmount).toFixed(2),
                isAutoPlay: true,
                autoPlayResult: result,
                type: "AutoPlay"
            });
        }

        return result;
    } catch (error) {
        console.error("Error in handleAutoPlay:", error);
        return { isAuto: false };
    }
}

const checkAndStartGame = async (gameData, player, socket, purchasedTickets) => {
    try {
        const parentGameData = await Sys.Game.Game2.Services.GameServices.getSingleParentGame(
            { _id: gameData.parentGameId },
            { days: 1, subGames: 1, otherData: 1 }
        );
        if (gameData.totalNoPurchasedTickets >= gameData.minTicketCount && 
            gameData.day === moment().format('ddd') && 
            moment().toDate() >= moment(parentGameData?.days[gameData.day][0], 'HH:mm').toDate()) {

            if(!gameData.otherData?.isBotGame){
                const isGameOpen = !parentGameData.otherData.closeDay.some(closeDay => 
                    closeDay.closeDate === moment().format('YYYY-MM-DD') && 
                    compareTimeSlots(moment().format('HH:mm'), closeDay.startTime, 'gte') && 
                    compareTimeSlots(moment().format('HH:mm'), closeDay.endTime, 'lte')
                );
               
                if(!isGameOpen){
                    // Dont start game as game is not open
                    return;
                }
            }
            
            await Promise.all(
                gameData.players.map(async (p) => {
                    const isRunningGame = await checkGamePlayAtSameTimeForRefund(
                        p,
                        gameData._id
                    );
                    if (isRunningGame?.status) {
                        const socketId = p.socketId?.split('#')?.[1];
                        if (!socketId) return;
                        const data = {
                            playerId: p.id,
                            gameId: gameData._id,
                            hallIds: isRunningGame.hallIds
                        };
                        Sys.Game.Common.Controllers.PlayerController.CheckForRefundAmount(
                            socketId,
                            data
                        );
                    }
                })
            );
                
            for (let p of gameData.players) {
                let socketId = p.socketId.split('#')[1];
                Sys.Game.Common.Controllers.PlayerController.CheckGame2PlayerBreakTime(socketId, {
                    playerId: p.id,
                    language: player.selectedLanguage
                });
            }
        
            if (gameData.otherData?.isBotGame) {
                if (gameData.otherData.ticketPurchasedByBotCount >= gameData.minTicketCount) {
                    Sys.Game.Game2.Controllers.GameProcess.StartGameCheck(gameData._id, parentGameData.subGames.length);
                }
            } else {
                Sys.Game.Game2.Controllers.GameProcess.StartGameCheck(gameData._id, parentGameData.subGames.length);
            }
        }else if (gameData.otherData?.isBotGame && gameData.otherData.ticketPurchasedByBotCount >= gameData.minTicketCount) {
            Sys.Game.Game2.Controllers.GameProcess.StartGameCheck(gameData._id, parentGameData.subGames.length);
        }

        let playerIds = gameData.players.map(p => p.id);
        let playerTokens = await Sys.Game.Common.Services.PlayerServices.getByDataPlayer({ "_id": { $in: playerIds } }, { socketId: 1 });
        let socketIds = playerTokens.map(p => p.socketId).filter(Boolean);

        socketIds.forEach(id => {
            Sys.Io.to(id).emit('GameListRefresh', { gameType: 2 });
        });
    } catch (error) {
        console.error("Error in checkAndStartGame:", error);
        throw error;
    }
};

const getUpdatedTickets = async function(gameId, playerId, gameData) {
    try {
        const tickets = await Sys.Game.Game2.Services.GameServices.getTicketByData(
            { gameId, playerIdOfPurchaser: playerId },
            ['_id', 'tickets', 'isPurchased', 'ticketId', 'playerIdOfPurchaser']
        );

        return tickets.map(ticket => ({
            id: ticket._id,
            ticketNumber: ticket.ticketId,
            ticketPrice: gameData.ticketPrice,
            ticketCellNumberList: ticket.tickets,
            isPurchased: ticket.isPurchased,
            playerIdOfPurchaser: ticket.playerIdOfPurchaser
        }));
    } catch (error) {
        console.error("Error in getUpdatedTickets:", error);
        return [];
    }
}

const createGameNotification = async ({ 
    playerId, 
    gameData, 
    ticketCount, 
    totalPayableAmount, 
    isAutoPlay = false,
    autoPlayResult = null,
    type = "Purchase",
    key = null
}) => {
    try {
        const notificationDate = gameData.startDate <= Date.now() ? gameData.graceDate : gameData.startDate;
        
        let TimeMessage;
        let ticketMessage;
        let notificationType = "Purchased Tickets";
        if (isAutoPlay) {
            // Handle auto-play notifications
            if (autoPlayResult.isMessage) {
                TimeMessage = {
                    en: await translate({ key: "game2_auto_purchase_failed", language: 'en', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName, number2: autoPlayResult.totalTicketsPurchasedByPlayer, number3: ticketCount }),
                    nor: await translate({ key: "game2_auto_purchase_failed", language: 'nor', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName, number2: autoPlayResult.totalTicketsPurchasedByPlayer, number3: ticketCount })
                };
            } else {
                TimeMessage = {
                    en: await translate({ key: "game2_auto_purchase_success", language: 'en', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName, number2: autoPlayResult.totalTicketsPurchasedByPlayer, number3: ticketCount }),
                    nor: await translate({ key: "game2_auto_purchase_success", language: 'nor', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName, number2: autoPlayResult.totalTicketsPurchasedByPlayer, number3: ticketCount })
                };
            }

            ticketMessage = {
                en: await translate({ key: "game2_auto_purchase_noti", language: 'en', isDynamic: true, number: autoPlayResult.totalTicketsPurchasedByPlayer, number1: ticketCount, number2: gameData.gameName }),
                nor: await translate({ key: "game2_auto_purchase_noti", language: 'nor', isDynamic: true, number: autoPlayResult.totalTicketsPurchasedByPlayer, number1: ticketCount, number2: gameData.gameName })
            };
        } else if (type === "Purchase") {
            // Handle regular purchase notifications
            TimeMessage = {
                en: await translate({ key: "game2_purchase_success", language: 'en', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName, number2: ticketCount }),
                nor: await translate({ key: "game2_purchase_success", language: 'nor', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName, number2: ticketCount })
            };

            ticketMessage = {
                en: await translate({ key: "game2_purchase_noti", language: 'en', isDynamic: true, number: ticketCount, number1: gameData.gameName }),
                nor: await translate({ key: "game2_purchase_noti", language: 'nor', isDynamic: true, number: ticketCount, number1: gameData.gameName })
            };
        } else if (type === "Cancel") {
            // Handle cancel notifications
            TimeMessage = {
                en: await translate({ key: "game2_cancel_message", language: 'en', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName, number2: ticketCount }),
                nor: await translate({ key: "game2_cancel_message", language: 'nor', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName, number2: ticketCount })
            };

            ticketMessage = {
                en: await translate({ key: "game2_cancel_noti", language: 'en', isDynamic: true, number: ticketCount, number1: gameData.gameName }),
                nor: await translate({ key: "game2_cancel_noti", language: 'nor', isDynamic: true, number: ticketCount, number1: gameData.gameName })
            };
            notificationType = "Cancel Tickets";
        } else if (type === "Refund") {
            // Handle cancel notifications
            TimeMessage = {
                en: await translate({ key: "refund_tickets", language: 'en', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName, number2: ticketCount }),
                nor: await translate({ key: "refund_tickets", language: 'nor', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName, number2: ticketCount })
            };

            ticketMessage = {
                en: await translate({ key: "refund_tickets", language: 'en', isDynamic: true, number: ticketCount, number1: gameData.gameName }),
                nor: await translate({ key: "refund_tickets", language: 'nor', isDynamic: true, number: ticketCount, number1: gameData.gameName })
            };
            notificationType = "refundTickets";
        } else if(type === "Game Finish") {
            if(key === "game2_winning_noti") {
                TimeMessage = {
                    en: await translate({ key: "game2_winning_noti", language: 'en', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName, number2: totalPayableAmount }),
                    nor: await translate({ key: "game2_winning_noti", language: 'nor', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName, number2: totalPayableAmount })
                };
            } else if(key === "game2_loss_noti") {
                TimeMessage = {
                    en: await translate({ key: "game2_loss_noti", language: 'en', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName }),
                    nor: await translate({ key: "game2_loss_noti", language: 'nor', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName })
                };
            }
            Sys.Game.Common.Services.NotificationServices.create({
                playerId: playerId,
                gameId: gameData._id,
                notification: {
                    notificationType: 'Game Finish',
                    message: TimeMessage
                }
            });
            return true;
        }

        const dataNotification = {
            playerId,
            gameId: gameData._id,
            notification: {
                notificationType: notificationType,
                message: TimeMessage,
                ticketMessage: ticketMessage,
                price: totalPayableAmount,
                date: notificationDate
            }
        };
        
        Sys.Game.Common.Services.NotificationServices.create(dataNotification);
        return true;
    } catch (error) {
        console.error(`Error in ${isAutoPlay ? 'auto-play' : 'regular'} game notification:`, error);
        return false;
    }
};

//Cancel Ticket
const processCancelTickets = async ({playerId, subGameId, hallIds = null, ticketId = null, language = "nor", singleDelete = false, isRefund = false, createErrorResponse, createSuccessResponse}) => {
    try {
        // Prepare ticket query (conditionally includes _id)
        const ticketQuery = {
            gameId: String(subGameId),
            playerIdOfPurchaser: String(playerId),
            isCancelled: false,
            isPurchased: true,
            ...(hallIds && { hallId: { $in: hallIds } }),
            ...(ticketId && { _id: ticketId })
        };
        console.log("🚀 ~ processCancelTickets:***********game2:", ticketQuery);
        // Parallel DB calls for initial data
        const [player, gameData, ticketData] = await Promise.all([
            Sys.Game.Game2.Services.PlayerServices.getById(playerId, {
                selectedLanguage: 1, 
                username: 1, 
                hall: 1, 
                walletAmount: 1, 
                userType: 1, 
                socketId: 1
            }),
            Sys.Game.Game2.Services.GameServices.getSingleGameByData(
                { _id: subGameId }, 
                {
                    purchasedTickets: 1,
                    gameNumber: 1,
                    status: 1,
                    groupHalls: 1,
                    gameName: 1,
                    gameType: 1,
                    startDate: 1,
                    graceDate: 1,
                    ticketPrice: 1,
                    otherData: 1,
                    isNotificationSent: 1,
                    parentGameId: 1,
                    jackPotNumber: 1,
                    players: 1
                }
            ),
            Sys.Game.Game2.Services.GameServices.getTicketByData(ticketQuery, {
                ticketId: 1, 
                ticketPrice: 1, 
                otherData: 1,
                purchasedSlug: 1,
                hallId:1,
                _id: 1
            })
        ]);
        let parentGameId = gameData.parentGameId;
        // Validation checks
        if (!player) return await createErrorResponse("player_not_found", language);
        if (!gameData) return await createErrorResponse("game_not_found", player.selectedLanguage);
        
        let indexp = Sys.Running.indexOf(`${gameData.gameNumber}`);
        console.log("gameData status, isNotificationSent, indexp", gameData.status, gameData.isNotificationSent, indexp)
        if (!(gameData.status === 'active' && !gameData.isNotificationSent && indexp <= -1)) {
            console.log("game2_cancel_failed");
            return await createErrorResponse("game2_cancel_failed", player.selectedLanguage);
        }
            
        // if (gameData.status !== 'active' && gameData.isNotificationSent === true && indexp > -1) {
        //     console.log("game2_cancel_failed");
        //     return await createErrorResponse("game2_cancel_failed", player.selectedLanguage);
        // }
        console.log("ticketData length", ticketData.length);
        if(ticketData.length === 0) return await createErrorResponse("ticket_not_found", player.selectedLanguage);
        // Process tickets and create transactions
        const processedData = await processTicketsAndTransactions(player, gameData, ticketData, isRefund);
        // Update game state and emit events
        await updateGameStateAndNotify(processedData, gameData, player, subGameId, singleDelete, isRefund);
        //Sys.Io.to(player.socketId).emit('PlayerHallLimit', { });
        Sys.Io.of(Sys.Config.Namespace.Game2).to(parentGameId).emit('RefreshRoom', { gameId: parentGameId });
        return await createSuccessResponse(null, "game2_cancel_success", player.selectedLanguage, true);

    } catch (error) {
        console.error("Error in processCancelTickets:", error);
        throw error;
    }
}

const processTicketsAndTransactions = async (player, gameData, ticketData, isRefund) => {
    const groupHall = gameData.groupHalls.find(grp => 
        grp.halls.some(hall => hall.id.toString() === player.hall.id.toString())
    );

    const processed = ticketData.reduce((acc, ticket) => {
        const key = ticket.purchasedSlug === "points" ? "pointTickets" : "realTickets";
        const payableAmount = ticket.otherData?.payableAmount || 0;
        
        acc[key].push(ticket);
        acc.ticketIds.push(ticket._id);
        acc.totalPayableAmount += payableAmount;
        acc.cancelOBJArray.push(createTransactionObject(player, gameData, ticket, acc.walletAmount, payableAmount, groupHall));
        
        acc.walletAmount += payableAmount;
        return acc;
    }, { 
        pointTickets: [], 
        realTickets: [], 
        cancelOBJArray: [], 
        ticketIds: [],
        walletAmount: player.walletAmount,
        totalPayableAmount: 0,
        createdAt: Date.now()
    });

    await executeTransactions(processed, player, gameData, isRefund);
    return processed;
}

const createTransactionObject = (player, gameData, ticket, currentWalletAmount, payableAmount, groupHall) => ({
    transactionId: `TRN${Sys.Helper.bingo.ordNumFunction(Date.now())}${Math.floor(100000 + Math.random() * 900000)}`,
    playerId: player._id,
    playerName: player.username,
    gameId: gameData._id,
    gameNumber: gameData.gameNumber,
    gameName: gameData.gameName,
    gameType: gameData.gameType,
    gameStartDate: gameData.startDate,
    ticketPrice: gameData.ticketPrice,
    ticketId: ticket._id,
    ticketNumber: ticket.ticketId,
    differenceAmount: gameData.ticketPrice,
    variantGame: "",
    ticketColorType: "",
    voucherId: "",
    voucherCode: "",
    voucherAmount: "",
    isVoucherUse: false,
    isVoucherApplied: false,
    defineSlug: "cancelTicket",
    category: "credit",
    status: "success",
    amtCategory: ticket.purchasedSlug === "points" ? "points" : "realMoney",
    previousBalance: +parseFloat(currentWalletAmount).toFixed(2),
    afterBalance: +parseFloat((currentWalletAmount + payableAmount).toFixed(2)),
    hall: { 
        name: player.hall.name, 
        id: player.hall.id 
    },
    groupHall: { 
        name: groupHall?.name || "", 
        id: groupHall?.id || "" 
    },
    hallId: player.hall.id,
    groupHallId: groupHall?.id || "",
    typeOfTransactionTotalAmount: gameData.ticketPrice,
    remark: `Cancel Purchased ${ticket.ticketId} Tickets`,
    typeOfTransaction: "Cancel Tickets",
    userType: player.userType,
    createdAt: Date.now(),
    isBotGame: gameData?.otherData?.isBotGame || false
});

const executeTransactions = async (processedData, player, gameData, isRefund) => {
    const transactionPromises = [];

    // Handle point tickets
    if (processedData.pointTickets.length) {
        const hallWiseTotals = [];
        processedData.realTickets.forEach(ticket => {
            const hallId = ticket.hallId || (player.hall && player.hall.id);
            const amount = ticket.otherData?.payableAmount || 0;
            if (!hallId) return;
            const existing = hallWiseTotals.find(h => h.hallId === hallId);
            if (existing) {
                existing.amount += amount;
            } else {
                hallWiseTotals.push({ hallId: hallId, amount: amount });
            }
        });
        console.log("pointTickets hallWiseTotals game2", hallWiseTotals);
        const totalAmount = processedData.pointTickets.reduce((sum, t) => sum + (t.otherData?.payableAmount || 0), 0);
        transactionPromises.push(
            Sys.Helper.gameHelper.createTransactionPlayer({
                playerId: player._id,
                gameId: gameData._id,
                transactionSlug: "extraTransaction",
                typeOfTransaction: isRefund ? "Refund" : "Cancel Ticket",
                action: "credit",
                purchasedSlug: "points",
                totalAmount
            }),
            Sys.Game.Common.Services.PlayerServices.updatePlayerData(
                { _id: player._id },
                { $inc: { walletAmount: totalAmount } }
            )
        );
        hallWiseTotals.forEach(async hall => {
            Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                type: "cancel",
                playerId: player._id,
                hallId: hall.hallId,
                cancel: hall.amount
            });
            await updatePlayerHallSpendingData({ playerId: player._id, hallId: hall.hallId, amount: +hall.amount, type: 'normal', gameStatus: 2 });
        });
        // Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
        //     type: "cancel",
        //     playerId: player._id,
        //     hallId: player.hall.id,
        //     cancel: totalAmount
        // });
        // await updatePlayerHallSpendingData({ playerId: player._id, hallId: player.hall.id, amount: +totalAmount, type: 'normal', gameStatus: 2 });
    }

    // Handle real money tickets
    if (processedData.realTickets.length) {
        const hallWiseTotals = [];
        processedData.realTickets.forEach(ticket => {
            const hallId = ticket.hallId || (player.hall && player.hall.id);
            const amount = ticket.otherData?.payableAmount || 0;
            if (!hallId) return;
            const existing = hallWiseTotals.find(h => h.hallId === hallId);
            if (existing) {
                existing.amount += amount;
            } else {
                hallWiseTotals.push({ hallId: hallId, amount: amount });
            }
        });
        console.log("realTickets hallWiseTotals game2", hallWiseTotals);
        const totalAmount = processedData.realTickets.reduce((sum, t) => sum + (t.otherData?.payableAmount || 0), 0);
        const updateData = { $inc: { walletAmount: totalAmount } };
        if (player.userType !== "Bot") {
            updateData.$inc.monthlyWalletAmountLimit = totalAmount;
        }
        
        transactionPromises.push(
            Sys.Helper.gameHelper.createTransactionPlayer({
                playerId: player._id,
                gameId: gameData._id,
                transactionSlug: "extraTransaction",
                typeOfTransaction: isRefund ? "Refund" : "Cancel Ticket",
                action: "credit",
                purchasedSlug: "realMoney",
                totalAmount
            }),
            Sys.Game.Common.Services.PlayerServices.updatePlayerData(
                { _id: player._id },
                updateData
            )
        );
        hallWiseTotals.forEach(async hall => {
            Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                type: "cancel",
                playerId: player._id,
                hallId: hall.hallId,
                cancel: hall.amount
            });
            await updatePlayerHallSpendingData({ playerId: player._id, hallId: hall.hallId, amount: +hall.amount, type: 'normal', gameStatus: 2 });
        });
    }

    // Execute all updates in parallel
    await Promise.all([
        ...transactionPromises,
        Sys.Game.Common.Services.PlayerServices.createBulkTransaction(
            processedData.cancelOBJArray,
            {
                ordered: true,
                rawResult: false,
                lean: true
            }
        ),
        Sys.Game.Common.Services.GameServices.updateManyTicketData(
            { _id: { $in: processedData.ticketIds } },
            {
                $set: {
                    playerNameOfPurchaser: '',
                    uniquePlayerId: "",
                    ticketPurchasedFrom: "",
                    hallName: "",
                    groupHallName: "",
                    hallId: "",
                    groupHallId: "",
                    isAgentTicket: false,
                    isCancelled: true,
                    isPurchased: false,
                    agentId: ""
                }
            }
        )
    ]);
};

const updateGameStateAndNotify = async (processedData, gameData, player, subGameId, singleDelete, isRefund) => {
    let gameDataUpdated;
    if(singleDelete){
        const ticketQuery = {
            gameId: subGameId,
            playerIdOfPurchaser: player._id,
            isCancelled: false,
            isPurchased: true,
        }
        let avaibaleTicketCount = await Sys.Game.Game2.Services.GameServices.getTicketCount(ticketQuery);

        // const pullQuery = {
        //     purchasedTickets: { ticketId: { $in: processedData.ticketIds } }
        // };
        
        // if (avaibaleTicketCount === 0) {
        //     pullQuery.players = { id: player._id };
        // }

        const updateQuery = {
            $pull: {
                purchasedTickets: { ticketId: { $in: processedData.ticketIds } }
            },
            $inc: {
                totalNoPurchasedTickets: -processedData.ticketIds.length
            }
        };
        const options = { new: true };

        if (avaibaleTicketCount === 0) {
            updateQuery.$pull = {
                ...updateQuery.$pull,
                players: { id: player._id }
            };
        } else {
            updateQuery.$inc["players.$[elem].ticketCount"] = -processedData.ticketIds.length;
            options.arrayFilters = [{ "elem.id": player._id }];
        }
        
        gameDataUpdated = await Sys.Game.Game2.Services.GameServices.updateSingleGame(
            { _id: gameData._id },
            updateQuery,
            options
        );
    }else{
        gameDataUpdated = await Sys.Game.Game2.Services.GameServices.updateSingleGame(
            { _id: gameData._id }, 
            { 
                $pull: {
                    players: { id: player._id },
                    purchasedTickets: { ticketId: { $in: processedData.ticketIds } }
                },
                $inc: {
                    totalNoPurchasedTickets: -processedData.ticketIds.length
                }
            },
            {new: true}
        );
    }
    
    const [onlinePlayers, playerTokens] = await Promise.all([
        getOnlinePlayers('/Game2', gameData.parentGameId.toString()),
        Sys.Game.Game2.Services.PlayerServices.getByData(
            { _id: { $in: gameDataUpdated.players.map(p => p.id) } },
            { socketId: 1 }
        )
    ]);

    const socketIds = [
        ...playerTokens.map(p => p.socketId),
        player.socketId
    ].filter(Boolean);

     // Create notification
     await createGameNotification({
        playerId: player._id,
        gameData: {
            _id: gameDataUpdated._id,
            gameNumber: gameDataUpdated.gameNumber,
            gameName: gameDataUpdated.gameName,
            startDate: gameDataUpdated.startDate,
            graceDate: gameDataUpdated.graceDate
        },
        ticketCount: processedData.ticketIds.length,
        type: isRefund ? "Refund" : "Cancel",
        totalPayableAmount: processedData.totalPayableAmount
    });

     // Emit all events in parallel
     await Promise.all([
        // Emit to specific sockets
        ...socketIds.map(socketId =>
            Sys.Io.to(socketId).emit('GameListRefresh', { gameType: 2 })
        ),
        
        // Emit to namespace
        Sys.Io.of(Sys.Config.Namespace.Game2).to(subGameId).emit('UpdatePlayerRegisteredCount', {
            playerRegisteredCount: onlinePlayers
        }),
        Sys.Io.of(Sys.Config.Namespace.Game2).to(subGameId).emit('game2PurchasedTicketsCount', {
            purchasedTicketsCount: Array.isArray(gameDataUpdated.purchasedTickets)
                ? gameDataUpdated.purchasedTickets.length
                : (gameDataUpdated.totalNoPurchasedTickets || 0)
        })
    ]);

    // Jackpot update
    Sys.Game.Game2.Controllers.GameController.game2JackpotUpdate({
        gameId: gameDataUpdated.parentGameId.toString(),
        subGameId: subGameId,
        jackpotData: gameDataUpdated.jackPotNumber,
        tickets: Array.isArray(gameDataUpdated.purchasedTickets)
            ? gameDataUpdated.purchasedTickets.length
            : (gameDataUpdated.totalNoPurchasedTickets || 0),
        ticketPrice: gameDataUpdated.ticketPrice
    });
}

// const compareTimeSlots = (timeSlot1, timeSlot2, operation) => {
//     const [hours1, minutes1] = timeSlot1.split(':').map(Number);
//     const [hours2, minutes2] = timeSlot2.split(':').map(Number);
    
//     const time1 = hours1 * 60 + minutes1;
//     const time2 = hours2 * 60 + minutes2;
    
//     switch (operation) {
//         case 'lt': return time1 < time2;
//         case 'lte': return time1 <= time2;
//         case 'gt': return time1 > time2;
//         case 'gte': return time1 >= time2;
//         default: return time1 < time2;
//     }
// };

// const getOnlinePlayers = (namespace, roomId) => {
//     return new Promise((resolve, reject) => {
//         Sys.Io.of(namespace).in(roomId).clients((error, clients) => {
//             if (error)
//                 return reject(error);
//             resolve(clients.length);
//         });
//     });
// }

const normalizeGame2JackpotData = (jackPotNumber) => {
    if (!jackPotNumber) return {};

    const rawData = Array.isArray(jackPotNumber) ? (jackPotNumber[0] || {}) : jackPotNumber;
    if (!rawData || typeof rawData !== 'object') return {};

    return Object.fromEntries(
        Object.entries(rawData).map(([number, value]) => {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                return [number, {
                    price: parseFloat(value.price ?? 0),
                    isCash: value.isCash !== false
                }];
            }

            return [number, {
                price: parseFloat(value ?? 0),
                isCash: true
            }];
        })
    );
}

const processJackpotNumbers = (jackPotNumber, purchasedTickets, ticketPrice) => {
    const normalizedJackpotData = normalizeGame2JackpotData(jackPotNumber);

    return Object.entries(normalizedJackpotData).map(([number, value]) => {
        const rawPrize = value.isCash
            ? parseFloat(value.price)
            : (parseFloat(value.price) * purchasedTickets * parseFloat(ticketPrice)) / 100;

        // Round to nearest whole number
        const prize = Math.round(rawPrize);

        return {
            number: number === "1421" ? "14-21" : number,
            prize,
            type: number === "13" || number === "1421" ? "gain" : "jackpot"
        };
    });
}

// [ Game 2 Winner ( Jackpot Prize ) ]
const checkJackPot = async (data, isWinningDistributed= false) => {
    try {
        // Destructure all required data at the top
        const { 
            winnerArr, 
            game: { 
                jackPotNumber, 
                ticketCount, 
                ticketPrice 
            }, 
            totalWithdrawCount 
        } = data;

        const winnerCount = winnerArr.length;
        const jackPotObj = normalizeGame2JackpotData(jackPotNumber);
        const numberList = Object.keys(jackPotObj);
        const valueList = Object.values(jackPotObj);
        
        // Process winners in parallel without unnecessary player fetching
        const jackpotPromises = winnerArr.map(async (winner) => {
            if (winner.purchasedSlug !== 'realMoney') return null;

            const results = [];

            for (let r = 0; r < numberList.length; r++) {
                const currentNumber = numberList[r];
                const currentValue = valueList[r];

                // Special case for "1421"
                if (currentNumber === "1421") {
                    const tempArr = [14, 15, 16, 17, 18, 19, 20, 21];
                    if (!tempArr.includes(totalWithdrawCount)) continue;
                } else if (currentNumber != totalWithdrawCount) {
                    continue;
                }

                // Calculate winner amount
                let multiWinnerAmT = 0;
                const percent = !currentValue.isCash;
                
                if (currentValue.isCash) {
                    multiWinnerAmT = parseFloat(currentValue.price) / winnerCount;
                } else {
                    const finalPrice = (parseFloat(currentValue.price) * (ticketCount * ticketPrice)) / 100;
                    multiWinnerAmT = finalPrice / winnerCount;
                }

                const finalAmount = Math.round(multiWinnerAmT);
                
                // Prepare transaction objects
                // Create base transaction object with common properties
                if(!isWinningDistributed){
                    const baseTransaction = {
                        playerId: await Sys.Helper.bingo.obId(winner.winnerPlayerId),
                        gameId: winner.gameId,
                        action: "credit",
                        purchasedSlug: "realMoney",
                        totalAmount: finalAmount,
                        percentWin: percent,
                        hallName: winner.hallName,
                        hallId: winner.hallId,
                        groupHallName: winner.groupHallName,
                        groupHallId: winner.groupHallId,
                    };
                    Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                        type: "winning",
                        playerId: await Sys.Helper.bingo.obId(winner.winnerPlayerId),
                        hallId: winner.hallId,
                        winning: finalAmount
                    });
                    await updatePlayerHallSpendingData({ playerId: await Sys.Helper.bingo.obId(winner.winnerPlayerId), hallId: winner.hallId, amount: +finalAmount, type: 'normal', gameStatus: 3 });
                    // Create both transactions by extending the base object
                    const transactions = [
                        {
                            ...baseTransaction,
                            ticketId: winner.ticketId,
                            transactionSlug: "winJackpot",
                            winningPrice: finalAmount,
                            totalWithdrawCount,
                        },
                        {
                            ...baseTransaction,
                            transactionSlug: "extraTransaction",
                            typeOfTransaction: "Game Won",
                            isConsiderHallData: true,
                        }
                    ];
                    
                    // Execute transactions in parallel
                    await Promise.all(
                        transactions.map(tx => Sys.Helper.gameHelper.createTransactionPlayer(tx))
                    );
                }
                
                results.push({
                    playerId: winner.winnerPlayerId, // Using winnerPlayerId directly
                    gameId: winner.gameId,
                    ticketId: winner.ticketId,
                    walletType: "realMoney",
                    finalWonAmount: finalAmount,
                    totalWithdrawCount,
                    percentWin: percent,
                    lineTypeArray: "Bingo"
                });
            }
            return results;
        });

        // Wait for all operations to complete and flatten results
        const results = await Promise.all(jackpotPromises);
        return results.flat().filter(Boolean);

    } catch (e) {
        console.log("Error in checkJackPotPrize", e);
        throw e;
    }
}

// [ Game 2 Winner ( Lucky Number Prize ) ]
const checkLuckyNumber = async (data, isWinningDistributed= false) => {
    try {
        const {
            winnerArr,
            game: { players, luckyNumberPrize },
            lastBall
        } = data;

         // Round KR value once at the start
         const roundedPrize = Math.round(parseFloat(luckyNumberPrize));

        // Preprocess: Create a map of playerId => player
        const playerMap = new Map();
        for (const player of players) {
            playerMap.set(player.id.toString(), { luckyNumber: player.luckyNumber });
        }
        
        const luckyWinnerPromises = winnerArr.map(async (winner) => {
            if (winner.purchasedSlug !== 'realMoney') return null;

            const player = playerMap.get(winner.winnerPlayerId.toString());

            if (!player || player.luckyNumber !== lastBall) return null;

            // Create common transaction properties
            if(!isWinningDistributed){
                const commonProps = {
                    playerId: await Sys.Helper.bingo.obId(winner.winnerPlayerId),
                    gameId: winner.gameId,
                    action: "credit",
                    purchasedSlug: "realMoney",
                    totalAmount: roundedPrize, // ✅ Rounded KR amount
                    hallName: winner.hallName,
                    hallId: winner.hallId,
                    groupHallName: winner.groupHallName,
                    groupHallId: winner.groupHallId,
                };
                Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                    type: "winning",
                    playerId: await Sys.Helper.bingo.obId(winner.winnerPlayerId),
                    hallId: winner.hallId,
                    winning: roundedPrize
                });
                await updatePlayerHallSpendingData({ playerId: await Sys.Helper.bingo.obId(winner.winnerPlayerId), hallId: winner.hallId, amount: roundedPrize, type: 'normal', gameStatus: 3 });
                // Create both transactions with shared properties
                const transactions = [
                    {
                        ...commonProps,
                        ticketId: winner.ticketId,
                        transactionSlug: "luckyPrize",
                        lastBall,
                        krValue: 100,
                    },
                    {
                        ...commonProps,
                        transactionSlug: "extraTransaction",
                        typeOfTransaction: "Lucky number prize",
                        isConsiderHallData: true,
                    }
                ];
    
                // Process both transactions in parallel
                await Promise.all(
                    transactions.map(tx => Sys.Helper.gameHelper.createTransactionPlayer(tx))
                );
            }
            
            return {
                playerId: winner.winnerPlayerId,
                gameId: winner.gameId,
                ticketId: winner.ticketId,
                walletType: "realMoney",
                finalWonAmount: roundedPrize,
                lineTypeArray: "Lucky Number"
            };
        });

        const results = await Promise.all(luckyWinnerPromises);
        return results.filter(Boolean);

    } catch (e) {
        console.error("checkLuckyNumberPrize error:", e);
        throw e;
    }
};

const checkIfGameCanStart = async (game) => {
    try {
        const gameNumber = parseInt(game.gameNumber.split('_')[1]);
        
        if (gameNumber === 1) {
            const prevGame = await Sys.Game.Game2.Services.GameServices.getGameCount({
                parentGameId: game.parentGameId,
                gameNumber: { $ne: game.gameNumber },
                day: moment().format('ddd'),
                $or: [
                    { status: 'running' },
                    { status: 'active', isNotificationSent: true }
                ]
            });
            
            return !prevGame;
        } else {
            const [_, sequence, ...rest] = game.gameNumber.split('_');
            const prevGameNumber = `CH_${game.sequence - 1}_${rest.join('_')}`;
            const prevGame = await Sys.Game.Game2.Services.GameServices.getSingleGameByData(
                { parentGameId: game.parentGameId, gameNumber: prevGameNumber },
                { status: 1 }
            );
            
            return !prevGame || ['finish', 'cancel'].includes(prevGame.status);
        }
    } catch (error) {
        console.error("Error in checkIfGameCanStart:", error);
        return false;
    }
};

const setupGameStartTime = async (game) => {
    try {
        const newStartDate = new Date();
        const TimeType = game.notificationStartTime.slice(-1);
        const notificationTime = parseInt(game.notificationStartTime); // Extract number part safely
        let secondsToAdd, TimeMessage;

        if (TimeType === "m") {
            secondsToAdd = (notificationTime * 60) + 3;
            newStartDate.setSeconds(newStartDate.getSeconds() + secondsToAdd);
            TimeMessage = await getTranslatedMessages(game.gameNumber, notificationTime, 'minutes');
        } else {
            secondsToAdd = notificationTime;
            let newSec = (secondsToAdd * 1) + 10;
            newStartDate.setSeconds(newStartDate.getSeconds() + newSec);
            TimeMessage = await getTranslatedMessages(game.gameNumber, secondsToAdd, 'seconds');
        }

        return { newStartDate, secondsToAdd, TimeMessage };
    } catch (error) {
        console.error("Error in setupGameStartTime:", error);
        return { 
            newStartDate: new Date(Date.now() + 10000), // Default 10 seconds
            secondsToAdd: 10,
            TimeMessage: { 
                en: `Game will start soon`, 
                nor: `Spillet starter snart` 
            }
        };
    }
};

const getTranslatedMessages = async (gameNumber, time, type) => {
    try {
        const enMessage = await translate({
            key: `game1_start_noti_${type}`,
            language: 'en',
            isDynamic: true,
            number: gameNumber,
            number1: time
        });
    
        const norMessage = await translate({
            key: `game1_start_noti_${type}`,
            language: 'nor',
            isDynamic: true,
            number: gameNumber,
            number1: time
        });
        
        return { en: enMessage, nor: norMessage };
    } catch (error) {
        console.error("Error in getTranslatedMessages:", error);
        return { 
            en: `Game ${gameNumber} will start in ${time} ${type}`,
            nor: `Spill ${gameNumber} vil starte om ${time} ${type}`
        };
    }
}

const updateTicketsAndTransactions = async (gameId, startDate) => {
    try {
        let ticketUpdate = [
            {
                'updateMany': {
                    "filter": { "gameId": gameId.toString() },
                    "update": { '$set': { "gameStartDate": Date.now() } }
                }
            }
        ]
        let transactionUpdate = [
            {
                'updateMany': {
                    "filter": { "gameId": gameId.toString() },
                    "update": { '$set': { "gameStartDate": Date.now(), "otherData.exactGameStartTime": startDate } }
                }
            }
        ]
        await Sys.App.Services.GameService.bulkWriteTicketData(ticketUpdate);
        await Sys.App.Services.GameService.bulkWriteTransactionData(transactionUpdate);
    } catch (error) {
        console.error("Error in updateTicketsAndTransactions:", error);
    }
}

const sendNotificationsToPlayers = async (game, TimeMessage) => {
    try {
        // Single map operation to get both notifications and playerIds
        const { notifications, playerIds } = game.players.reduce((acc, player) => {
            acc.notifications.push({
                insertOne: {
                    document: {
                        playerId: player.id,
                        gameId: game._id,
                        notification: {
                            notificationType: 'Game Start Reminder',
                            message: TimeMessage
                        }
                    }
                }
            });
            acc.playerIds.push(player.id);
            return acc;
        }, { notifications: [], playerIds: [] });

        // Execute notifications in parallel
        await Promise.all([
            Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(notifications),
            Sys.Helper.gameHelper.sendNotificationToPlayers(
                game, 
                playerIds, 
                TimeMessage, 
                'Game Start Reminder'
            )
        ]);

        return true;
    } catch (error) {
        console.error("Error in sendNotificationsToPlayers:", error);
        throw error;
    }
}

const cleanupExistingBotGames = async (parentGameId) => {
    // Get games to remove and execute cleanup operations in parallel
    const gamesToRemove = await Sys.Game.Game2.Services.GameServices.getByData(
            { 
                gameType: "game_2", 
                parentGameId: parentGameId,
                $or: [
                    { status: 'running' },
                    { status: 'active', isNotificationSent: true }
                ]
            },
            { _id: 1 }
    );

    if (gamesToRemove.length) {
        const gameIds = gamesToRemove.map(g => g._id);
        
        // Execute cleanup operations in parallel
        await Promise.all([
            // Delete transactions
            Sys.App.Services.transactionServices.deleteManyTransactions({
                gameId: { $in: gameIds },
                userType: "Bot",
                gameType: "game_2"
            }),
            // Delete games
            Sys.Game.Game2.Services.GameServices.deleteManyGames({
                parentGameId,
                $or: [
                    { status: 'running' },
                    { status: 'active', isNotificationSent: true }
                ]
            }),
            // Update parent game count
            Sys.Game.Game2.Services.GameServices.updateParentGame(
                { _id: parentGameId },
                { $inc: { 'otherData.totalBotGamePlayed': -gamesToRemove.length } }
            )
        ]);
    }
}

const validateBotGame = async (game, parentGame) => {
    if (!parentGame.otherData.isBotGame) return false;
    if (parentGame.otherData.totalBotGamePlayed >= parentGame.otherData.botGameCount) return false;
    if (game.otherData.botTicketPurcasheStarted) return false;
    return true;
}

const calculateBotTicketCount = async (game, hallIDs) => {
    if (game.otherData.botTicketCount > 0) {
        return game.otherData.botTicketCount;
    }

    const totalBotAvailable = await Sys.App.Services.PlayerServices.getPlayerCount({
        userType: "Bot",
        'hall.id': { $in: hallIDs }
    });

    if (!totalBotAvailable || (totalBotAvailable * 30) <= game.minTicketCount) {
        return {
            status: 'fail',
            message: "Required Number of Bot Not Available to purchase the ticket."
        };
    }

    const gameMinTicketCount = game.minTicketCount;
    if (gameMinTicketCount > 5000 && gameMinTicketCount <= 10000) {
        if ((totalBotAvailable * 20) >= game.minTicketCount) return 20;
        if (gameMinTicketCount > 10000) return 30;
    }
    return 10;
}

const processBotPlayerTicket = async (player, game, botTicketCount) => {
    const luckyNumber = Math.floor(Math.random() * 21) + 1;
    const ticketToGenerate = {
        playerId: player._id,
        parentGameId: game.parentGameId,
        subGameId: game._id,
        luckyNumber,
        ticketCount: botTicketCount,
        purchaseType: 'realMoney',
        voucherCode: ''
    };
    return Sys.Game.Game2.Controllers.GameController.blindTicketPurchase(
        { id: player.socketId },
        ticketToGenerate
    );
}

const processRefundAndFinishGameCron = async (gameId, parentGame) => {
    try {
        let updatedDataOfGame = await Sys.Game.Game2.Services.GameServices.getSingleGameByData({ _id: gameId }, {otherData: 1, players: 1, ticketPrice: 1, gameNumber: 1, gameName: 1});
        console.log('\x1b[36m%s\x1b[0m', 'Game Not Start ( Grace Time Over) [ Refund Process- processRefundAndFinishGame ]');

        const isBotGame = updatedDataOfGame.otherData?.isBotGame;

        if (isBotGame) {
            await Sys.Game.Game2.Services.GameServices.updateSingleGame({ _id: gameId }, { status: "finish" });
        }

        const allTickets = await Sys.Game.Game2.Services.GameServices.getTicketByData(
            { gameId, isPurchased: true },
            {
                playerIdOfPurchaser: 1,
                'otherData.payableAmount': 1,
                ticketPurchasedFrom: 1,
                hallId:1
            }
        );

        const ticketsByPlayer = {};
        const refundTransactions = allTickets.map(ticket => {
            const pid = ticket.playerIdOfPurchaser.toString();
            if (!ticketsByPlayer[pid]) {
                ticketsByPlayer[pid] = { points: [], realMoney: [] };
            }
            const group = ticket.ticketPurchasedFrom === "points" ? "points" : "realMoney";
            ticketsByPlayer[pid][group].push(ticket);

            return Sys.Helper.gameHelper.createTransactionPlayer({
                playerId: ticket.playerIdOfPurchaser,
                gameId,
                ticketId: ticket._id,
                transactionSlug: "refund",
                action: "credit",
                purchasedSlug: ticket.ticketPurchasedFrom,
                totalAmount: Math.round( parseFloat(ticket.otherData?.payableAmount || updatedDataOfGame.ticketPrice) ), 
            });
        });

        await Promise.all(refundTransactions);

        const playerIds = updatedDataOfGame.players.map(p => p.id.toString());
        const allPlayers = await Sys.Game.Game2.Services.PlayerServices.getByData(
            { _id: { $in: playerIds } },
            { selectedLanguage: 1, username: 1, socketId: 1, hall: 1 }
        );
        const playerMap = new Map(allPlayers.map(p => [p._id.toString(), p]));

        for (const playerId of playerIds) {
            const player = playerMap.get(playerId);
            if (!player) continue;

            const lang = player.selectedLanguage;

            const message = {
                en: await translate({ key: "refund_tickets", language: 'en', isDynamic: true, number: updatedDataOfGame.gameNumber, number1: updatedDataOfGame.gameName }),
                nor: await translate({ key: "refund_tickets", language: 'nor', isDynamic: true, number: updatedDataOfGame.gameNumber, number1: updatedDataOfGame.gameName })
            };

            const notification = {
                notificationType: 'refundTickets',
                message: message
            };

            await Sys.Game.Common.Services.NotificationServices.create({
                playerId,
                gameId,
                notification
            });

            Sys.Helper.gameHelper.sendNotificationToOnePlayer(
                gameId,
                playerId,
                message[lang],
                updatedDataOfGame.gameName,
                notification.notificationType
            );

            await Sys.Io.to(player.socketId).emit('GameListRefresh', { gameType: 2 });

            const tickets = ticketsByPlayer[playerId] || { points: [], realMoney: [] };

            for (const type of ['points', 'realMoney']) {
                if (tickets[type].length === 0) continue;

                // Calculate total refund and round to nearest whole number (KR currency)
                const total = Math.round(
                    tickets[type].reduce(
                        (sum, t) => sum + parseFloat(t.otherData?.payableAmount || t.ticketPrice),
                        0
                    )
                );
                
                await Sys.Helper.gameHelper.createTransactionPlayer({
                    playerId,
                    gameId,
                    transactionSlug: "extraTransaction",
                    typeOfTransaction: "Refund",
                    action: "credit",
                    purchasedSlug: type,
                    totalAmount: total
                });
                Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                    type: "cancel",
                    playerId: playerId,
                    hallId: player.hall.id,
                    cancel: total
                });
                await updatePlayerHallSpendingData({ playerId: playerId, hallId: player.hall.id, amount: total, type: 'normal', gameStatus: 2 });
            }

            Sys.Io.to(player.socketId).emit('PlayerHallLimit', { playerId: playerId });

        }

        await Sys.Game.Game2.Services.GameServices.updateSingleGame({ _id: gameId }, { status: "finish" });

        if (parentGame && parentGame.stopGame) {
            await Sys.Game.Game2.Services.GameServices.updateParentGame({ _id: parentGame._id }, { status: "finish" });
        }
        let index = Sys.Timers.indexOf(gameId.toString());
        if (index !== -1) {
            Timeout.clear(Sys.Timers[index], erase = true);
            Sys.Timers.splice(index, 1);
        }
    } catch (error) {
        console.error("Error in processRefundAndFinishGameCron:", error);
    }
}

// Load tickets for a game into Redis, used all.js dynamic functions, if required will use below function
// async function loadTicketsToRedis(gameId, projection = {}) {
//     try {
//         // Get all purchased tickets for this game from MongoDB
//         const tickets = await Sys.Game.Game5.Services.GameServices.getTicketsByData(
//             { gameId: gameId, isPurchased: true }, 
//             projection
//         );
//         console.log("tickets---", tickets)
//         if (!tickets || tickets.length === 0) {
//             return false;
//         }
        
//         const BATCH_SIZE = 1000;
//         for (let i = 0; i < tickets.length; i += BATCH_SIZE) {
//             const batch = tickets.slice(i, i + BATCH_SIZE);
//             await insertTicketDataToRedis(batch, gameId);
//         }
        
//         return true;
//     } catch (error) {
//         console.error("Error loading tickets to Redis:", error);
//         return false;
//     }
// }

// const insertTicketDataToRedis = async (tickets, gameId) => {
//     const pipeline = redis.pipeline();

//     for (const ticket of tickets) {
//         const ticketId = ticket._id.toString();
//         const keySet = `game2_tickets:${gameId}_${ticketId}`;
//         const keyMeta = `game2_ticket_meta:${gameId}_${ticketId}`;
//         const numbers = ticket.tickets || [];

//         if (numbers.length === 0) continue;
       
//         // Store ticket numbers as set
//         pipeline.sadd(keySet, ...numbers);
//         pipeline.expire(keySet, 3600);
        
//         // Store metadata as hash
//         pipeline.hmset(keyMeta, {
//             _id: ticket._id.toString(),
//             playerIdOfPurchaser: ticket.playerIdOfPurchaser?.toString() || '',
//             ticketNumber: ticket.ticketId || '',
//             hallName: ticket.hallName || '',
//             hallId: ticket.hallId || '',
//             groupHallName: ticket.groupHallName || '',
//             groupHallId: ticket.groupHallId || '',
//             tickets: JSON.stringify(ticket.tickets || [])
//         });
//         pipeline.expire(keyMeta, 3600);
//     }

//     await pipeline.exec();
// };

// const getGameTicketsFromRedis = async (gameId) => {
//     let cursor = '0';
//     const keys = [];
//     const pattern = `game2_ticket_meta:${gameId}_*`;

//     // Step 1: Collect all matching keys using SCAN
//     do {
//         const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
//         cursor = result[0];
//         keys.push(...result[1]);
//     } while (cursor !== '0');

//     if (keys.length === 0) return [];

//     // Step 2: Fetch data for each key using pipeline
//     const pipeline = redis.pipeline();
//     keys.forEach(key => pipeline.hgetall(key));
//     const results = await pipeline.exec();

//     // Step 3: Format results
//     const formatted = results.map(([err, data], i) => {
//         if (err) {
//             console.error(`Error fetching ${keys[i]}:`, err);
//             return null;
//         }

//         return {
//             key: keys[i],
//             _id: data._id.toString(),
//             playerIdOfPurchaser: data.playerIdOfPurchaser || '',
//             ticketNumber: data.ticketNumber || '',
//             hallName: data.hallName || '',
//             hallId: data.hallId || '',
//             groupHallName: data.groupHallName || '',
//             groupHallId: data.groupHallId || '',
//             tickets: JSON.parse(data.tickets || '[]')
//         };
//     });

//     // Filter out failed/null entries
//     return formatted.filter(Boolean);
// }







module.exports = {
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
    //compareTimeSlots,
    checkJackPot,
    checkLuckyNumber,
    checkIfGameCanStart,
    setupGameStartTime,
    updateTicketsAndTransactions,
    sendNotificationsToPlayers,
    cleanupExistingBotGames,
    validateBotGame,
    calculateBotTicketCount,
    processBotPlayerTicket,
    processRefundAndFinishGameCron
};
