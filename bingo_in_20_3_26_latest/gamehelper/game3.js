'use strict';
const Sys = require('../Boot/Sys');
const moment = require('moment');
const { compareTimeSlots, validateBalance, getGameTicketsFromRedis, createErrorResponse, checkPlayerSpending, updatePlayerHallSpendingData, checkGamePlayAtSameTimeForRefund } = require('./all');
const { createGameNotification } = require('./game2');
const { translate } = require('../Config/i18n');
const Timeout = require('smart-timeout');

const validateGameTiming = async function(gameData, player, parentGameData) {
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
        const indexP = Sys.StartedGame.indexOf(gameData._id.toString());
        if (indexP >= 0 && gameData.gameMode === 'auto') {
            return {
                isValid: false,
                error: 'game_time_over'
            };
        }
        
        // Get parent game data and check if game is closed
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

const processPurchase = async (player, gameData, ticketCount, purchaseType, voucherData, alreadyPurchasedTicketCount, gameTypeData, groupHall, parentGameData, socket) => {
    try {
        const userType = ["Unique", "Bot"].includes(player.userType) ? player.userType : "Online";
        const ticketPrice = gameData.ticketPrice;
        let totalAmount = ticketPrice * ticketCount;

        if (voucherData && voucherData.percentage) {
            const discount = (totalAmount * voucherData.percentage) / 100;
            totalAmount = totalAmount - discount;
        }
        const [balanceValidation] = await Promise.all([
            validateBalance(player, totalAmount, purchaseType)
        ]);

        if (balanceValidation !== true) {
            console.log("balanceValidation failed", balanceValidation);
            return balanceValidation;
        }

        if (purchaseType === 'realMoney' && userType !== "Bot" && player.monthlyWallet && player.monthlyWalletAmountLimit < totalAmount) {
            console.log("monthlyWalletAmountLimit exceeded", player.monthlyWalletAmountLimit, totalAmount);
            return { isValid: false, error: 'update_wallet_limit', result: { playerId: player._id, username: player.username } };
        }
        console.log("alreadyPurchasedTicketCount", alreadyPurchasedTicketCount, ticketCount, alreadyPurchasedTicketCount + ticketCount);
        if (alreadyPurchasedTicketCount + ticketCount > 30) {
            console.log("Ticket purchase validation failed");
            return { isValid: false, error: 'game2_tickets_already_purchased', result: { playerId: player._id, username: player.username } };
        }
        let deductPlayerSpending = await checkPlayerSpending({ playerId: player._id, hallId: player.hall.id, amount: +totalAmount });
            if(!deductPlayerSpending.isValid){
                return { isValid: false, error: deductPlayerSpending.error, result: { playerId: player._id, username: player.username } };
            }

        // prepare ticket booking data
        let sendData = {
            columns: gameTypeData.columns,
            slug: 'game_3',
            ticketSize: ticketCount,
            playerId: player._id,
            purchaseType: purchaseType,
            gameData: gameData,
            playerData: player,
            socketId: socket.id,
            gameId: gameData._id,
            voucherData: voucherData,
            voucherCode: voucherData?.voucherCode,
            vouhcerId: voucherData?._id,
            voucherTranasctionId: voucherData?.transactionId,
            ticketPrice: gameData.ticketPrice,
            userType: userType,
            uniquePlayerId: (userType == "Online" || userType == "Bot") ? '' : player.uniqueId,
            isAgentTicket: (player.userType == "Unique" && player.isCreatedByAdmin == false) ? true : false,
            agentId: player.agentId,
            hall: {
                name: player.hall.name,
                id: player.hall.id
            },
            groupOfHall: {
                name: groupHall.name,
                id: groupHall.id
            }
        }
        let ticketSdr = await Sys.Helper.bingo.ticketBook(sendData);
        let updatedGameData = await Sys.Game.Game3.Services.GameServices.getSingleGameData({ _id: gameData._id }, {winningType: 1, gameType: 1, totalNoPurchasedTickets: 1, withdrawNumberList: 1, minTicketCount: 1, day: 1, players: 1});
        if (!gameData?.otherData?.isBotGame){
            createGameNotification({
                playerId: player._id,
                gameData: {_id: gameData._id, gameNumber: gameData.gameNumber, gameName: gameData.gameName, startDate: gameData.startDate, graceDate: gameData.graceDate},
                ticketCount: ticketCount,
                totalPayableAmount: `${ticketSdr}`,
                type: "Purchase",
            });
            
            const dataSet = {};
            dataSet.gameId = gameData._id.toString();
            dataSet.patterns = gameData.allPatternArray.flat();
            dataSet.winningType = updatedGameData.winningType;
            dataSet.currentPool = updatedGameData.totalNoPurchasedTickets * gameData.ticketPrice;
            dataSet.count = updatedGameData.withdrawNumberList.length;
            patternPriceUpdateBroadcast(dataSet);
            Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                type: "purchase",
                playerId: player._id,
                hallId: player.hall.id,
                purchase: totalAmount
            });
            await updatePlayerHallSpendingData({ playerId: player._id, hallId: player.hall.id, amount: +totalAmount, type: deductPlayerSpending.type, gameStatus: 1 });
        }
        handleGameStart(updatedGameData, player, parentGameData, gameData?.otherData?.isBotGame);
        return { isValid: true };

    } catch (error) {
        console.error("Error in processPurchase:", error);
        return { isValid: false, error: 'something_went_wrong' };
    }
}

function get2DArrayFromString(s) {
    return s.split(/[.,]/).map(Number);
}

async function patternPriceUpdateBroadcast(data) {
    try {
        // Destructure at the top
        const { patterns: fstPatternList, count, winningType, currentPool, gameId } = data;
        const jackPotData = { draw: "", winningAmount: "", isDisplay: false };
        let dataPatternList = [];

        // Prepare all pattern objects in one pass
        dataPatternList = fstPatternList.map(pattern => {
            const {
                patternId, patternType, patternName, ballNumber,
                prize, prize1, isPatternWin
            } = pattern;

            let tmp = get2DArrayFromString(patternType);
            let patternDesign = 0;
            switch (patternName) {
                case 'Row 1': patternDesign = 1; break;
                case 'Row 2': patternDesign = 2; break;
                case 'Row 3': patternDesign = 3; break;
                case 'Row 4': patternDesign = 4; break;
            }

            let price = prize1 !== undefined ? prize1 : prize;
            if (winningType === 'percent') {
                price = currentPool > 0 ? +parseFloat((price * currentPool) / 100).toFixed(2) : 0;
            }

            // Round to whole number
            price = Math.round(price);

            const obj = {
                _id: patternId,
                patternDataList: tmp,
                patternDesign,
                name: patternName,
                patternName,
                ballNumber: Number(ballNumber),
                amount: price,
                isWon: (isPatternWin === 'true')
            };

            if (prize1 !== undefined) {
                obj.jackPotAmount = +parseFloat(prize).toFixed(2);
                jackPotData.draw = Number(ballNumber);
                jackPotData.winningAmount = obj.jackPotAmount;
                jackPotData.isDisplay = !obj.isWon;
            }

            return (count <= ballNumber || prize1 !== undefined) ? obj : null;
        }).filter(Boolean);

        // Emit the event (async, non-blocking)
        await Sys.Io.of(Sys.Config.Namespace.Game3)
            .to(`${gameId}_ticketPurchase`)
            .emit('PatternChange', {
                patternList: dataPatternList,
                jackPotData
            });

        return;
    } catch (error) {
        console.log("Error in patternPriceUpdateBroadcast", error);
        return await createErrorResponse("something_went_wrong", "nor");
    }
}

async function handleGameStart(gameData, player, parentGameData, isBotGame) {
    if (gameData.totalNoPurchasedTickets >= gameData.minTicketCount && 
        gameData.day === moment().format('ddd') && 
        moment().toDate() >= moment(parentGameData?.days[gameData.day][0], 'HH:mm').toDate()) {
        if (isBotGame) {
            await Sys.Game.Common.Services.GameServices.updateGame(
                { _id: gameData._id },
                { "$set": { "otherData.botTicketPurcashed": true } }
            );
        }else{
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
                const isRunningGame = await checkGamePlayAtSameTimeForRefund(p, gameData._id);
                if (isRunningGame?.status) {
                    const socketId = p.socketId?.split('#')?.[1];
                    if (!socketId) return;
                    const data = {
                        playerId: p.id,
                        gameId: gameData._id,
                        hallIds: isRunningGame.hallIds
                    };
                    await Sys.Game.Common.Controllers.PlayerController.CheckForRefundAmount(
                        socketId,
                        data
                    );
                }
            })
        );
        await Sys.Game.Game3.Controllers.GameProcess.StartGameCheck(
            gameData._id,
            parentGameData.subGames.length
        );
    } else if (isBotGame) {
        await Sys.Game.Game3.Controllers.GameProcess.StartGameCheck(
            gameData._id,
            parentGameData.subGames.length
        );
    }
}

function preparePatternData(allPatternArray, pricePool, winningType, withdrawNumberList) {
    const jackPotData = { draw: "", winningAmount: "", isDisplay: false };
    const patternData = allPatternArray.flat().map(element => {
        element.isWon = (element.isPatternWin == "true");
        element.name = element.patternName;
        switch (element.patternName) {
            case "Row 1": element.patternDesign = 1; break;
            case "Row 2": element.patternDesign = 2; break;
            case "Row 3": element.patternDesign = 3; break;
            case "Row 4": element.patternDesign = 4; break;
            default: element.patternDesign = 0; break;
        }
        if (element.prize1 !== undefined) {
            element.jackPotAmount = Math.round(element.prize);;
            element.prize = element.prize1;
            jackPotData['draw'] = element.ballNumber;
            jackPotData['winningAmount'] = element.jackPotAmount;
            jackPotData['isDisplay'] = !element.isWon && withdrawNumberList.length <= element.ballNumber;
        }
        if (winningType == 'percent') {
            element.prize = pricePool > 0 ? +parseFloat((element.prize * pricePool) / 100) : 0;
        }
        element.prize = Math.round(element.prize);
        element.amount = Math.round(element.prize);
        element.patternDataList = get2DArrayFromString(element.patternType);
        return element;
    });
    return { patternData, jackPotData };
}

async function cancelTickets({
    playerId,
    gameId,
    hallIds = null,
    ticketId, // optional: if present, cancel single ticket; else, cancel all tickets for player in game
    language = "nor",
    isRefund = false,
}) {
    try {
        // Parallel fetch: player, game, tickets
        const [
            player,
            gameData,
            tickets
        ] = await Promise.all([
            Sys.Game.Game2.Services.PlayerServices.getById(playerId, {
                selectedLanguage: 1, username: 1, hall: 1, walletAmount: 1, userType: 1, socketId: 1
            }),
            Sys.Game.Game3.Services.GameServices.getSingleGameData(
                { _id: gameId },
                {
                    totalNoPurchasedTickets: 1, gameNumber: 1, gameName: 1, gameType: 1, startDate: 1, graceDate: 1,
                    ticketPrice: 1, status: 1, isNotificationSent: 1, groupHalls: 1, allPatternArray: 1, parentGameId:1,
                    winningType: 1, withdrawNumberList: 1, players: 1, 'otherData.isBotGame': 1
                }
            ),
            ticketId
                ? Sys.Game.Game2.Services.GameServices.getSingleTicketData(
                    { _id: ticketId },
                    { ticketId: 1, ticketPrice: 1, ticketPurchasedFrom: 1, _id: 1, hallId: 1 }
                ).then(ticket => ticket ? [ticket] : [])
                : Sys.Game.Game3.Services.GameServices.getTicketByData(
                    { gameId: String(gameId), playerIdOfPurchaser: String(playerId), isCancelled: false, ...(hallIds && { hallId: { $in: hallIds } }) },
                    { _id: 1, ticketPrice: 1, ticketPurchasedFrom: 1, ticketId: 1, hallId: 1 }
                )
        ]);

        // Validation
        if (!player) return { error: await createErrorResponse("player_not_found", language) };
        language = player.selectedLanguage || language;
        if (!gameData) return { error: await createErrorResponse("game_not_found", language) };

        let indexp = Sys.Running.indexOf(`${gameData.gameNumber}`);
        console.log("gameData status, isNotificationSent, indexp", gameData.status, gameData.isNotificationSent, indexp)
        if (gameData.status !== 'active' || gameData.isNotificationSent === true || indexp > -1) {
            return { error: await createErrorResponse("game2_cancel_failed", language) };
        }
        console.log("tickets length", tickets.length);
        if (!tickets || tickets.length === 0) {
            return { error: await createErrorResponse("ticket_not_found", language) };
        }

        // Group tickets by purchase type
        const { pointsTickets, realMoneyTickets } = tickets.reduce((acc, ticket) => {
            if (ticket.ticketPurchasedFrom === "points") {
              acc.pointsTickets.push(ticket);
            } else {
              acc.realMoneyTickets.push(ticket);
            }
            return acc;
        }, { pointsTickets: [], realMoneyTickets: [] });

        // Create extra transactions for points and realMoney
        const extraTransactions = [];
        if (pointsTickets.length > 0) {
            const hallWiseTotals = [];
            pointsTickets.forEach(ticket => {
                const hallId = ticket.hallId || (player.hall && player.hall.id);
                const amount = ticket.ticketPrice;
                if (!hallId) return;
                const existing = hallWiseTotals.find(h => h.hallId === hallId);
                if (existing) {
                    existing.amount += amount;
                } else {
                    hallWiseTotals.push({ hallId: hallId, amount: amount });
                }
            });
            console.log("pointsTickets hallWiseTotals game3", hallWiseTotals);
            const totalAmount = Math.round( pointsTickets.reduce((n, { ticketPrice }) => n + ticketPrice, 0) );
            extraTransactions.push(Sys.Helper.gameHelper.createTransactionPlayer({
                playerId: player._id,
                gameId: gameData._id,
                transactionSlug: "extraTransaction",
                typeOfTransaction: isRefund ? "Refund" : "Cancel Ticket",
                action: "credit",
                purchasedSlug: "points",
                totalAmount: totalAmount,
            }));
            for(let hall of hallWiseTotals){
                Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                    type: "cancel",
                    playerId: player._id,
                    hallId: hall.hallId,
                    cancel: hall.amount
                });
                await updatePlayerHallSpendingData({ playerId: player._id, hallId: hall.hallId, amount: +hall.amount, type: 'normal', gameStatus: 2 });
            }
            // Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
            //     type: "cancel",
            //     playerId: player._id,
            //     hallId: player.hall.id,
            //     cancel: pointsTickets.reduce((n, { ticketPrice }) => n + ticketPrice, 0)
            // });
            // await updatePlayerHallSpendingData({ playerId: player._id, hallId: player.hall.id, amount: +pointsTickets.reduce((n, { ticketPrice }) => n + ticketPrice, 0), type: 'normal', gameStatus: 2 });
        }
        if (realMoneyTickets.length > 0) {
            const hallWiseTotals = [];
            realMoneyTickets.forEach(ticket => {
                const hallId = ticket.hallId || (player.hall && player.hall.id);
                const amount = ticket.ticketPrice;
                if (!hallId) return;
                const existing = hallWiseTotals.find(h => h.hallId === hallId);
                if (existing) {
                    existing.amount += amount;
                } else {
                    hallWiseTotals.push({ hallId: hallId, amount: amount });
                }
            });
            console.log("realMoneyTickets hallWiseTotals game3", hallWiseTotals);
            const totalAmount = Math.round( realMoneyTickets.reduce((n, { ticketPrice }) => n + ticketPrice, 0) );
            extraTransactions.push(Sys.Helper.gameHelper.createTransactionPlayer({
                playerId: player._id,
                gameId: gameData._id,
                transactionSlug: "extraTransaction",
                typeOfTransaction: isRefund ? "Refund" : "Cancel Ticket",
                action: "credit",
                purchasedSlug: "realMoney",
                totalAmount: totalAmount,
            }));
            for(let hall of hallWiseTotals){
                Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                    type: "cancel",
                    playerId: player._id,
                    hallId: hall.hallId,
                    cancel: hall.amount
                });
                await updatePlayerHallSpendingData({ playerId: player._id, hallId: hall.hallId, amount: +hall.amount, type: 'normal', gameStatus: 2 });
            }
            // Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
            //     type: "cancel",
            //     playerId: player._id,
            //     hallId: player.hall.id,
            //     cancel: realMoneyTickets.reduce((n, { ticketPrice }) => n + ticketPrice, 0)
            // });
            // await updatePlayerHallSpendingData({ playerId: player._id, hallId: player.hall.id, amount: +realMoneyTickets.reduce((n, { ticketPrice }) => n + ticketPrice, 0), type: 'normal', gameStatus: 2 });
        }
        await Promise.all(extraTransactions);

        // Prepare cancel transactions for each ticket
        let walletAmount = player.walletAmount;
        const createdAt = Date.now();
        const groupHall = gameData.groupHalls.filter(grp => grp.halls.some(hall => hall.id.toString() === player.hall.id.toString()));
        const cancelTransactions = await Promise.all(tickets.map(async (ticket) => {
            const transactionId = 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000);
            const trx = {
                transactionId,
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
                amtCategory: "realMoney",
                previousBalance: walletAmount,
                afterBalance: walletAmount + gameData.ticketPrice,
                hall: {
                    name: player.hall.name,
                    id: player.hall.id
                },
                groupHall: {
                    name: groupHall[0]?.name,
                    id: groupHall[0]?.id
                },
                hallId: player.hall.id,
                groupHallId: groupHall[0]?.id,
                typeOfTransactionTotalAmount: gameData.ticketPrice,
                remark: "Cancel Purchased " + ticket.ticketId + " Tickets",
                typeOfTransaction: "Cancel Tickets",
                userType: player.userType,
                createdAt,
                isBotGame: gameData?.otherData?.isBotGame || false
            };
            walletAmount += gameData.ticketPrice;
            return trx;
        }) );
        
        // Bulk insert cancel transactions
        const options = { ordered: true, rawResult: false, lean: true };
        Sys.Game.Common.Services.PlayerServices.createBulkTransaction(cancelTransactions, options);

        // Update tickets in bulk
        const ticketIdList = tickets.map(t => t._id);
        await Sys.Game.Common.Services.GameServices.updateManyTicketData({ _id: { $in: ticketIdList } }, {
            $set: {
                isPurchased: false,
                playerIdOfPurchaser: '',
                playerNameOfPurchaser: '',
                uniquePlayerId: "",
                ticketPurchasedFrom: "",
                hallName: "",
                groupHallName: "",
                hallId: "",
                groupHallId: "",
                isAgentTicket: false,
                isCancelled: true,
                agentId: ""
            }
        });

        // Update player wallet
        const totalPayableAmount =  +parseFloat((gameData.ticketPrice * tickets.length).toFixed(2))
        let updateObj = {
            $inc: {
                walletAmount: totalPayableAmount
            }
        };
        if (player.userType !== "Bot") {
            updateObj['$inc'].monthlyWalletAmountLimit = totalPayableAmount
        }
        await Sys.Game.Common.Services.PlayerServices.updatePlayerData({ _id: player._id }, updateObj);

        // Remove player from game if bulk, else just update purchasedTickets
        let playerIdObj = await Sys.Helper.bingo.obId(player._id);
        let updatedGame = null;
        if (!ticketId) {
            updatedGame = await Sys.Game.Game3.Services.GameServices.updateSingleGame(
                { _id: gameData._id },
                {
                  $pull: { players: { id: playerIdObj }, ticketIdArray: { $in: ticketIdList } },
                  $inc: { totalNoPurchasedTickets: -tickets.length }
                },
                { new: true }
              );
        }else{
            updatedGame = await Sys.Game.Game3.Services.GameServices.updateSingleGame(
                { _id: gameData._id },
                [
                  {
                    $set: {
                        players: {
                            $filter: {
                            input: {
                                $map: {
                                input: "$players",
                                as: "player",
                                in: {
                                    $cond: [
                                        { $eq: ["$$player.id", playerIdObj] },
                                        {
                                            $mergeObjects: [
                                                "$$player",
                                                { ticketCount: { $subtract: ["$$player.ticketCount", 1] } }
                                            ]
                                        },
                                        "$$player"
                                    ]
                                }
                                }
                            },
                            as: "p",
                            cond: { $gt: ["$$p.ticketCount", 0] }
                            }
                        },
                        totalNoPurchasedTickets: { $subtract: ["$totalNoPurchasedTickets", tickets.length] },
                        ticketIdArray: {
                            $filter: {
                                input: "$ticketIdArray",
                                as: "tid",
                                cond: { $not: { $in: ["$$tid", ticketIdList] } }
                            }
                        }
                    }
                  }
                ],
                { new: true, useFindAndModify: false }
            );
              
        }
        console.log("updatedGame after updattinmg game", updatedGame)
        // Notification
        createGameNotification({
            playerId: player._id,
            gameData: {
                _id: gameData._id,
                gameNumber: gameData.gameNumber,
                gameName: gameData.gameName,
                startDate: gameData.startDate,
                graceDate: gameData.graceDate
            },
            ticketCount: tickets.length,
            type: isRefund ? "Refund" : "Cancel",
            totalPayableAmount: totalPayableAmount
        });
    
        const dataSet = {
            gameId: updatedGame._id.toString(),
            patterns: updatedGame.allPatternArray.flat(),
            winningType: updatedGame.winningType,
            currentPool: Math.round(updatedGame.totalNoPurchasedTickets * updatedGame.ticketPrice),
            count: updatedGame.withdrawNumberList.length
        };
        patternPriceUpdateBroadcast(dataSet);

        // Notify all players to refresh game list
        let playerIds = updatedGame.players.map(p => p.id);
        let playerTokens = await Sys.Game.Common.Services.PlayerServices.getByDataPlayer({ "_id": { $in: playerIds } }, { socketId: 1 });
        let socketIds = playerTokens.map(p => p.socketId).filter(Boolean);
        socketIds.push(player.socketId);
        socketIds.forEach(sid => {
            if (sid) Sys.Io.to(sid).emit('GameListRefresh', { gameType: 3 });
        });
        //Sys.Io.to(player.socketId).emit('PlayerHallLimit', { });
        Sys.Io.of(Sys.Config.Namespace.Game3).to(gameData.parentGameId).emit('RefreshRoom', { gameId: gameData.parentGameId });
        return { success: true, language };
    } catch (error) {
        console.log("Error in cancelTicketsAndHandleAll", error);
        return { error: await createErrorResponse("something_went_wrong", language) };
    }
}

// Game Play Helper functions
const createGameData = (game, options = {}) => {
    try {
        const mergedOptions = {
            winnerArrFullHouse: [],
            patternWinnerArray: [],
            currentPatternList: [],
            isFullHouse: false,
            patternAvailable: true,
            jackpotRemoved: false,
            maxBallNumber: 75,
            cnt: 0,
            lastBallDrawnTime: null,
            ...options
        };

        const flatPatterns = game.allPatternArray?.flat() || [];

        return {
            _id: game._id,
            players: game.players,
            gameNumber: game.gameNumber,
            gameName: game.gameName,
            sequence: game.sequence,
            parentGameId: game.parentGameId,
            day: game.day,
            seconds: game.seconds,
            withdrawNumberList: game.withdrawNumberList || game.history,
            status: game.status,
            startDate: game.startDate,
            otherData: game.otherData,
            isBotGame: game.otherData?.isBotGame || false,
            totalNoPurchasedTickets: game.totalNoPurchasedTickets,
            luckyNumberPrize: game.luckyNumberPrize,
            ticketPrice: game.ticketPrice,
            allPlayerIds: game.players.map(p => p.id),
            allPatternArray: flatPatterns,
            currentLength: flatPatterns.length,
            winningType: game.winningType,
            ...mergedOptions,
            
        };
    } catch (error) {
        console.log("Error in createGameData:", error);
        return {};
    }
};

function getPatternDesignNumber(patternName) {
    try {
        return {
            'Row 1': 1,
            'Row 2': 2,
            'Row 3': 3,
            'Row 4': 4,
        }[patternName] || 0;
    } catch (error) {
        console.log("Error in getPatternDesignNumber:", error);
        return 0;
    }
}

async function evaluatePatternsAndUpdateGameData(gameData, isSendBroadcast = false) {
    try {
        
        const { withdrawNumberArray, allPatternArray, currentLength, jackpotRemoved, totalNoPurchasedTickets, ticketPrice, winningType } = gameData;
        const count = withdrawNumberArray?.length;
        const currentPatternList = []; // return
        const broadcastpattern = [];  // For broadcasting the pattern change to the clients
        let patternAvailable = true; // return
        let updatedJackpotRemoved = jackpotRemoved; // return

        const currentPool = Math.round(totalNoPurchasedTickets * ticketPrice);
        
        const jackPotData = { draw: "", winningAmount: "", isDisplay: false };

        let availablePatterns = allPatternArray.filter(obj => 
            (obj.ballNumber >= count && obj.isPatternWin === "false") ||
            (!obj.patternType.includes(0) && obj.patternType !== '' && obj.isPatternWin === "false")
        );

        if (availablePatterns.length === 0) {
            patternAvailable = false;
        }

        const fixedPatterns = new Set(['Row 1', 'Row 2', 'Row 3', 'Row 4']);
        const query = { $set: {} };
        for (const [i, pattern] of allPatternArray.entries()) {
            const { patternName, patternType, patternId, prize, prize1, ballNumber, isPatternWin } = pattern;

            const isFixed = fixedPatterns.has(patternName);
            const tmp = get2DArrayFromString(patternType);
            const patternDesign = getPatternDesignNumber(patternName);

            let calculatedPrize = prize1 ?? prize;
            
            if (winningType === 'percent') {
                calculatedPrize = currentPool > 0 ? ((calculatedPrize * currentPool) / 100) : 0;
            }

            // Round to nearest whole number
            calculatedPrize = Math.round(calculatedPrize);
           
            const parsedBallNumber = Number(ballNumber);
            const isWon = isPatternWin === "true";

            const finalObj = {
                _id: patternId,
                patternDataList: tmp,
                patternDesign,
                patternName,
                name: patternName,
                isFixedPtrn: isFixed,
                ballNumber: parsedBallNumber,
                amount: calculatedPrize,
                isWon,
            };

            if (prize1 !== undefined) {
                finalObj.jackPotAmount = Math.round(prize);
                jackPotData.draw = parsedBallNumber;
                jackPotData.winningAmount = finalObj.jackPotAmount;
                jackPotData.isDisplay = !isWon;

                if (count > parsedBallNumber && !updatedJackpotRemoved) {
                    updatedJackpotRemoved = true;
                    jackPotData.isDisplay = false;
                }
            }

            const patternHasNoZero = !patternType.includes(0) && patternType !== '';
            if (
                (parsedBallNumber >= count && isPatternWin === "false") ||
                (patternHasNoZero && isPatternWin === "false")
            ) {
                currentPatternList.push(finalObj);
            }

            if (!prize1 && parsedBallNumber < count) {
                finalObj.isWon = true;
            }

            broadcastpattern.push(finalObj);

            if (((patternType !== '' && patternType.includes(0)) && parsedBallNumber < count) ||
                (patternType === '' && parsedBallNumber < count) || isWon) {
                query.$set[`allPatternArray.${i}.isPatternWin`] = "true";
            }
        }

        // for game Notification when game is starting , no need to send other varibales or need to save anuthing
        if (isSendBroadcast) {
            await Sys.Io.of(Sys.Config.Namespace.Game3).to(gameData.parentGameId.toString()).emit('PatternChange', {
                patternList: broadcastpattern,
                jackPotData,
            });
            return;
        }

        // Update only if pattern list has changed
        if (currentPatternList.length !== currentLength || (!jackpotRemoved && updatedJackpotRemoved)) {
            if (Object.keys(query.$set).length > 0) {
                await Sys.Game.Game3.Services.GameServices.updateSingleGame({ _id: gameData._id }, query);
            }

            // Emit pattern change
            await Sys.Io.of(Sys.Config.Namespace.Game3).to(gameData.parentGameId.toString()).emit('PatternChange', {
                patternList: broadcastpattern,
                jackPotData,
            });
        }
        return {
            currentPatternList,
            patternAvailable,
            jackpotRemoved: updatedJackpotRemoved,
            currentLength: currentPatternList.length,
        };
    } catch (error) {
        console.log("Error in evaluatePatternsAndUpdateGameData:", error);
        return {
            currentPatternList: [],
            patternAvailable: false,
            jackpotRemoved: false,
            currentLength: 0,
        };
    }
}

// This used to check which paterrn need to be checked for each iteration
function getPatternToCheckWinner(patternList) {
    const rowPriority = ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Coverall'];
    
    try {
        const patternSet = new Set(patternList.map(p => p.patternName));
        const firstRow = rowPriority.find(row => patternSet.has(row));

        return Object.fromEntries(
            patternList
                .filter(p => p.patternName === firstRow || !rowPriority.includes(p.patternName))
                .map(p => [p.patternName, p])
        );
    } catch (error) {
        console.log("Error in getPatternToCheckWinner:", error);
        return {};
    }
}

// Provide pattern wise winners amount and notifications
async function processPatternWinners(winnersToBroadcast, gameData) {
    try {
        const patternWinnersArray = [];
        const patternLuckyWinnersArray = [];
        const allNotification = [];
        const allWinnersForCurretBall = [];
        let isFullHouse = false;

        // Process each pattern winner
        for (const winner of winnersToBroadcast) {
            const transactionData = createTransactionData(winner);
            const [currentWinning] = await Sys.Helper.gameHelper.createTransactionPlayer(transactionData);

            const prizeData = createPrizeData(winner, {
                players: gameData.players,
                _id: gameData._id,
                luckyNumberPrize: Math.round(gameData?.luckyNumberPrize || 0) ,
                isBotGame: gameData?.otherData?.isBotGame
            });

            const luckyResults = await checkLuckyNumber(prizeData);
            console.log("Lucky Results:", luckyResults); // should always be an array
            
            const [luckyPrize = null] = luckyResults;
            const luckyWinAmount =  Math.round(luckyPrize?.finalWonAmount || 0);
            const luckyWinText = luckyPrize ? " and Lucky Number" : "";
            
            let finalWin = Math.round(currentWinning.winningPrice + luckyWinAmount);
            winner.finalwin = finalWin;

            allWinnersForCurretBall.push({
                ...currentWinning,
                luckyNumberWinnings: luckyPrize
            });

            if (finalWin > 0) {
                patternWinnersArray.push(createPatternWinnerObject(winner, finalWin, luckyWinAmount, luckyWinText));
                if (luckyPrize) patternLuckyWinnersArray.push(luckyPrize);
                
                Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                    type: "winning",
                    playerId: winner.winnerPlayerId,
                    hallId: '',
                    winning: finalWin
                });
                await updatePlayerHallSpendingData({ playerId: winner.winnerPlayerId, hallId: '', amount: +finalWin, type: 'normal', gameStatus: 3 });
                
                // send pattern won broadcast
                const event = winner.isFullHouse ? 'TicketCompleted' : 'PatternWin';
                Sys.Io.of(Sys.Config.Namespace.Game3).to(winner?.socketId).emit(event, {
                    ticketId: winner?.ticketId,
                    gameId: winner?.gameId,
                    winningAmount: +finalWin
                });
            }
            if (winner.isFullHouse) {
                gameData.winnerArrFullHouse.push(createFullHouseWinnerObject(winner));
                isFullHouse = true;
            }

            allNotification.push({
                playerId: winner.winnerPlayerId,
                gameName: gameData.gameName,
                patternName: winner.patternName,
                luckyWin: luckyWinText,
                winningAmount: Math.round(currentWinning.winningPrice + luckyWinAmount),
                winningKey: winner.isFullHouse ? "game3_winning_fullhouse" : "game3_winning_pattern",
                isFullHouse: winner.isFullHouse
            });

            if(luckyPrize || luckyWinAmount > 0) {
                console.log("luckyPrize and luckyWinAmount, finalWin, patternLuckyWinnersArray", luckyPrize, luckyWinAmount, finalWin, patternLuckyWinnersArray);
            }
        }

        // Get player details for notifications
        const allPlayerIds = gameData.allPlayerIds;
        const allPlayerData = await Sys.Game.Game3.Services.PlayerServices.getByData(
            { _id: { $in: allPlayerIds } },
            { enableNotification: 1, selectedLanguage: 1, socketId: 1 }
        );
        const playerDataMap = new Map(allPlayerData.map(p => [p._id.toString(), p]));

        // Notify players
        await Promise.all(gameData.players.map(async (player) => {
            const playerId = player.id.toString();
            const playerData = playerDataMap.get(playerId);
            if (!playerData || !playerData.enableNotification) return;

            const playerWins = allNotification.filter(n => n.playerId.toString() === playerId);
            if (playerWins.length > 0) {
                let isFullHousePattern = false;
                let messageByLang = {};

                for (const win of playerWins) {
                    if (win.isFullHouse) isFullHousePattern = true;

                    messageByLang = {
                        en: await translate({
                            key: win.winningKey, language: "en", isDynamic: true,
                            number: win.gameName, number1: win.patternName,
                            number2: win.luckyWin, number3: Math.round(win.winningAmount)
                        }),
                        nor: await translate({
                            key: win.winningKey, language: "nor", isDynamic: true,
                            number: win.gameName, number1: win.patternName,
                            number2: win.luckyWin, number3: Math.round(win.winningAmount)
                        })
                    };

                    await Sys.Game.Common.Services.NotificationServices.create({
                        playerId, gameId: gameData._id,
                        notification: { notificationType: "Pattern Win", message: messageByLang }
                    });
                }

                if (isFullHousePattern) {
                    await Sys.Io.of(Sys.Config.Namespace.Game3).to(player.socketId).emit("GameFinish", {
                        message: messageByLang[playerData.selectedLanguage],
                        gameId: gameData._id
                    });
                }
            } else if (isFullHouse && !gameData.isBotGame) {
                const lostMessage = {
                    en: await translate({
                        key: "game3_lost", language: "en", isDynamic: true,
                        number: gameData.gameNumber, number1: gameData.gameName
                    }),
                    nor: await translate({
                        key: "game3_lost", language: "nor", isDynamic: true,
                        number: gameData.gameNumber, number1: gameData.gameName
                    })
                };

                await Sys.Game.Common.Services.NotificationServices.create({
                    playerId: player._id,
                    gameId: gameData._id,
                    notification: { notificationType: "Game Finish", message: lostMessage }
                });

                await Sys.Io.of(Sys.Config.Namespace.Game3).to(player.socketId).emit("GameFinish", {
                    message: lostMessage[player.selectedLanguage],
                    gameId: gameData._id
                });
            }
        }));

        console.log("Full house:", isFullHouse, gameData.winnerArrFullHouse);

        return {
            patternWinnersArray,
            patternLuckyWinnersArray,
            winnerArrFullHouse: gameData.winnerArrFullHouse,
            isFullHouse
        };
    } catch (error) {
        console.error("Error in processPatternWinners:", error);
        return {
            patternWinnersArray: [],
            patternLuckyWinnersArray: [],
            winnerArrFullHouse: []
        };
    }
}

function createTransactionData(winner) {
    try {
        return {
            playerId: winner.winnerPlayerId,
            gameId: winner.gameId,
            ticketId: winner.ticketId,
            patternId: winner.patternId,
            patternName: winner.patternName,
            count: winner.count,
            transactionSlug: "patternPrize",
            action: "credit",
            purchasedSlug: "realMoney",
            patternWinnerArray: winner.samePatterWinIds,
            isFullHouse: winner.isFullHouse,
            hallName: winner.hallName,
            hallId: winner.hallId,
            groupHallName: winner.groupHallName,
            groupHallId: winner.groupHallId,
        };
    } catch (error) {
        console.log("Error in createTransactionData:", error);
        return {};
    }
}

function createPrizeData(winner, room) {
    try {
        return {
            game: room,
            lastBall: winner.lastBall,
            totalWithdrawCount: winner.count,
            playerId: winner.winnerPlayerId,
            ticketId: winner.ticketId,
            hallName: winner.hallName,
            hallId: winner.hallId,
            groupHallName: winner.groupHallName,
            groupHallId: winner.groupHallId,
            patternId: winner.patternId,
        };
    } catch (error) {
        console.log("Error in createPrizeData:", error);
        return {};
    }
}

function createPatternWinnerObject(winner, finalWonAmount, luckyWinAmount, luckyWin) {
    try {
        return {
            playerId: winner.winnerPlayerId,
            gameId: winner.gameId,
            ticketId: winner.ticketId,
            patternId: winner.patternId,
            patternName: winner.patternName,
            count: winner.count,
            walletType: "realMoney",
            finalWonAmount: finalWonAmount,
            patternWonAmount: Math.round(finalWonAmount - luckyWinAmount),
            luckyWinAmount: Math.round(luckyWinAmount),
            lineTypeArray: winner.patternName,
            luckyWin: luckyWin,
            isFullHouse: winner.isFullHouse,
        };
    } catch (error) {
        console.log("Error in createPatternWinnerObject:", error);
        return {};
    }
}

function createFullHouseWinnerObject(winner) {
    try {
        return {
            gameId: winner.gameId,
            winnerPlayerId: winner.winnerPlayerId,
            ticketId: winner.ticketId,
            ticketNumber: winner.ticketNumber,
            purchasedSlug: "realMoney",
            ticketCellArr: winner.ticketNumber
        };
    } catch (error) {
        console.log("Error in createFullHouseWinnerObject:", error);
        return {};
    }
}

// Update winning amount and pattern to each tickets and for each winning pattern
async function processTicketStats(ticketStats, gameId) {
    try {
        const bulkOps = ticketStats.map(ticket => {
            const finalWonAmount = Math.round(ticket.finalWonAmount);
            const lineTypeUpdate = {
                isPattern: true,
                lineType: ticket.lineTypeArray,
                wonAmount: finalWonAmount
            };

            return {
                updateOne: {
                    filter: {
                        _id: ticket.ticketId,
                        gameId,
                        playerIdOfPurchaser: ticket.playerId
                    },
                    update: {
                        $push: { 'winningStats.lineTypeArray': lineTypeUpdate },
                        $set: { 'winningStats.walletType': "realMoney" },
                        $inc: {
                            'winningStats.finalWonAmount': finalWonAmount,
                            totalWinningOfTicket: finalWonAmount
                        }
                    }
                }
            };
        });

        if (bulkOps.length > 0) {
            await Sys.Game.Game3.Services.GameServices.bulkWriteTickets(bulkOps, { ordered: false });
        }

    } catch (error) {
        console.error("Error in processTicketStats (bulkWrite):", error);
    }
}

// Update lucky winning amount to each tickets and for each winning pattern
async function processLuckyNumberStats(ticketLuckyBonusStats, gameId) {
    try {
        const bulkOps = ticketLuckyBonusStats.map(ticket => {
            const finalWonAmount = Math.round(ticket.finalWonAmount);
            
            return {
                updateOne: {
                    filter: {
                        _id: ticket.ticketId,
                        gameId,
                        playerIdOfPurchaser: ticket.playerId
                    },
                    update: [
                        {
                            $set: {
                                luckyNumberWinningStats: {
                                    $cond: {
                                        if: { $ifNull: ["$luckyNumberWinningStats", false] },
                                        then: {
                                            wonAmount: {
                                                $add: [
                                                    { $ifNull: ["$luckyNumberWinningStats.wonAmount", 0] },
                                                    finalWonAmount
                                                ]
                                            },
                                            walletType: "realMoney",
                                            lineType: "Lucky Number Bonus"
                                        },
                                        else: {
                                            wonAmount: finalWonAmount,
                                            walletType: "realMoney",
                                            lineType: "Lucky Number Bonus"
                                        }
                                    }
                                },
                                totalWinningOfTicket: {
                                    $add: [
                                        { $ifNull: ["$totalWinningOfTicket", 0] },
                                        finalWonAmount
                                    ]
                                }
                            }
                        }
                    ]
                }
            };
        });

        if (bulkOps.length > 0) {
            await Sys.Game.Game3.Services.GameServices.bulkWriteTickets(bulkOps, { ordered: false });
        }

    } catch (error) {
        console.error("Error in processLuckyNumberStats (bulkWrite):", error);
    }
}

// Send final winning amount broadcast to each winner for each winning pattern
async function updateWinnerProfitAmount(winnersToBroadcast, patternWinnerHistory) {
    try {
        // Step 1: Precompute total winnings for each winnerPlayerId
        const winningsMap = new Map();
        for (const w of patternWinnerHistory) {
            const key = w.winnerPlayerId.toString();
            const current = winningsMap.get(key) || 0;
            winningsMap.set(key, current + Number(w.finalwin));
        }

        // Step 2: Emit only once per unique winnerPlayerId
        const sent = new Set();
        for (const winner of winnersToBroadcast) {
            const winnerIdStr = winner.winnerPlayerId.toString();

            if (!sent.has(winnerIdStr)) {
                const totalWon = Math.round(winningsMap.get(winnerIdStr) || 0);
                console.log("winner socketId", winner.socketId);
                await Sys.Io.of(Sys.Config.Namespace.Game3)
                    .to(winner.socketId)
                    .emit('UpdateProfitAmount', { totalWon });

                sent.add(winnerIdStr);
            }
        }

    } catch (error) {
        console.log("Error in updateWinnerProfitAmount:", error);
    }
}

function removeRoomFromRunning(room) {
    try {
        const indexp = Sys.Running.indexOf(`${room.gameNumber}`);
        if (indexp > -1) {
            Sys.Running.splice(indexp, 1);
        }
        Sys.StartedGame.push(room._id);
        const indexS = Sys.StartedGame.indexOf(`${room._id.toString()}`);
        if (indexS > -1) {
            Sys.StartedGame.splice(indexS, 1);
        }
    } catch (error) {
        console.log("Error in removeRoomFromRunning:", error);
    }
}

async function updatePlayerStatistics(room) {
    try {
        if (room.patternWinnerHistory.length > 0) {
            const winnerIds = new Set(room.patternWinnerHistory.map(w => w.winnerPlayerId.toString()));
        
            const playerBulkOps = [];
            for (const player of room.players) {
                const playerIdStr = player.id.toString();
            
                if (winnerIds.has(playerIdStr)) {
                    // Player is a winner
                    playerBulkOps.push({
                        updateOne: {
                            filter: { _id: player.id },
                            update: { $inc: { 'statisticsgame3.totalGamesWin': 1 } }
                        }
                    });
                } else {
                    // Player is not a winner
                    if (player.isLossAndWon === false) {
                        playerBulkOps.push({
                            updateOne: {
                                filter: { _id: player.id },
                                update: { $inc: { 'statisticsgame3.totalGamesLoss': 1 } }
                            }
                        });
                    }
                }
            }
        
            // Execute bulk operations
            if (playerBulkOps.length > 0) {
                await Sys.Game.Game3.Services.PlayerServices.bulkWrite(playerBulkOps);
            }
            
            // update isLossAndWon for winners in room
            await Sys.Game.Game3.Services.GameServices.updateSingleGame(
                { _id: room._id },
                {
                    $set: { "players.$[elem].isLossAndWon": true }
                },
                {
                    arrayFilters: [
                        { "elem.id": { $in: Array.from(winnerIds) } }
                    ]
                }
            );
        }
    } catch (error) {
        console.log("Error in updatePlayerStatistics:", error);
    }
}

// Schedule next game and check for next game
async function handleNextGame(gameData) {
    try {
        const parentGame = await Sys.Game.Game3.Services.GameServices.getSingleParentGameData(
            { _id: gameData.parentGameId, stopGame: false }
        );

        if (!parentGame) {
            return console.log('Parent game not found — skipping next game check.');
        }

        const subGameNumbers = parentGame.subGames.length;
        const { sequence, gameNumber, parentGameId, day } = gameData;
        console.log("subGameNumbers, sequence, gameNumber, parentGameId, day", subGameNumbers, sequence, gameNumber, parentGameId, day);
        let nextGameQuery = null;

        if (subGameNumbers === 1) {
            console.log("Only one subgame created for this parent game.");
            nextGameQuery = { parentGameId, status: 'active', day };
        } else if (sequence < subGameNumbers) {
            const parts = gameNumber.split('_');
            const nextGameNumber = `CH_${sequence + 1}_${parts[2]}_${parts[3]}_G3`;
            nextGameQuery = { gameNumber: nextGameNumber };
        } else if (sequence === subGameNumbers) {
            nextGameQuery = {
                parentGameId,
                status: 'active',
                day,
                isNotificationSent: false,
                sequence: 1
            };
        }

        if (nextGameQuery) {
            const nextGame = await Sys.Game.Game3.Services.GameServices.getSingleGameData(
                nextGameQuery,
                { _id: 1, status: 1 }
            );

            if (nextGame && nextGame.status === 'active') {
                Sys.Game.Game3.Controllers.GameProcess.StartGameCheck(nextGame._id, subGameNumbers);
            } else {
                console.log("No active next game found.");
            }
        }
    } catch (error) {
        console.log("Error in handleNextGame:", error);
    }
}

// Start Game Check Helpers
async function checkPreviousGameStatus(game, gameNumber) {
    try {
        if (gameNumber === 1) {
            const startTime = moment().subtract(24, 'hours');
            const endTime = moment().endOf('day');
            
            const prevGame = await Sys.Game.Game3.Services.GameServices.getGameCount({
                gameType: 'game_3',
                parentGameId: game.parentGameId,
                gameNumber: { $ne: game.gameNumber },
                $or: [
                    { status: 'running' },
                    { status: 'active', isNotificationSent: true }
                ],
                day: moment(new Date()).format('ddd'),
                createdAt: { $gte: startTime, $lte: endTime }
            });
            return !prevGame;
        }

        const gameNumberArray = game.gameNumber.split('_');
        const prevGameNumber = `CH_${game.sequence - 1}_${gameNumberArray[2]}_${gameNumberArray[3]}_G3`;
        
        const prevGame = await Sys.Game.Game3.Services.GameServices.getSingleGameData(
            { parentGameId: game.parentGameId, gameNumber: prevGameNumber },
            { _id: 1, status: 1 }
        );

        return !prevGame || ['finish', 'cancel'].includes(prevGame.status);
    } catch (error) {
        console.error('Error in checkPreviousGameStatus:', error);
        throw error;
    }
}

// Game 3 Bot Game Helpers
async function handleBotGame(game, subGameNumbers) {
    try {
        Sys.Game.Game3.Controllers.GameProcess.StartGame(game);
        
        if (game.sequence === subGameNumbers) {
            const [parentGame, childGameCount] = await Promise.all([
                Sys.Game.Game3.Services.GameServices.getSingleParentGameData(
                    { _id: game.parentGameId },
                    { totalNumberOfGames: 1 }
                ),
                Sys.Game.Common.Services.GameServices.getGameCount({
                    parentGameId: game.parentGameId
                })
            ]);

            if (childGameCount < parentGame.totalNumberOfGames) {
                Sys.Game.Common.Controllers.GameController.createChildGame(game.parentGameId, game.day);
            } else {
                await Sys.Game.Common.Services.GameServices.updateParentGame(
                    { _id: game.parentGameId },
                    { $set: { stopGame: true } }
                );
            }
        }
    } catch (error) {
        console.error('Error in handleBotGame:', error);
        throw error;
    }
}

// handle normal game notitification
async function handleNormalGame(game, secondsToAdd, subGameNumbers, setGameTimer, cleanTimeAndData) {
    try {
        const timerKey = `${game._id}_game_start`;
        let time = secondsToAdd;
        let isDisableTicket = false;
            
        // Set the game timer using the existing utility
        const timerTick = async () => {
            try {
                time--;
                
                if (time < 0) {
                    const updatedGame = await Sys.Game.Game3.Services.GameServices.updateSingleGame(
                        { _id: game._id, status: "active" },
                        { $set: { status: 'running' } },
                        { new: true }
                    );

                    if (!updatedGame) {
                        cleanTimeAndData(timerKey);
                        return;
                    }

                    cleanTimeAndData(timerKey);

                    // Emit pattern change
                    await evaluatePatternsAndUpdateGameData(updatedGame, true);

                    Sys.Game.Game3.Controllers.GameProcess.StartGame(updatedGame);
                    
                    if (updatedGame.sequence === subGameNumbers) {  
                        await Sys.Game.Common.Controllers.GameController.createChildGame(
                            updatedGame.parentGameId,
                            updatedGame.day
                        );
                    }
                } else {
                    if (time <= 5 && !isDisableTicket) {
                        console.log("Player Cannot purchase ticket now.");
                        Sys.StartedGame.push(game._id.toString());
                        
                        // Get updated game data for pattern change
                        const gameData = await Sys.Game.Game3.Services.GameServices.getSingleGameData(
                            { _id: game._id },
                            {
                                totalNoPurchasedTickets: 1,
                                ticketPrice: 1,
                                allPatternArray: 1,
                                winningType: 1,
                                parentGameId: 1
                            }
                        );
    
                        // Emit pattern change
                        await evaluatePatternsAndUpdateGameData(gameData, true);
    
                        await Sys.Game.Common.Services.GameServices.updateGame(
                            { _id: game._id },
                            { $set: { 'disableTicketPurchase': true } }
                        );
                        isDisableTicket = true;
                    }
    
                    Sys.Io.of(Sys.Config.Namespace.Game3)
                        .to(game.parentGameId.toString())
                        .emit('StartTimer', {
                            remainingTime: time,
                            totalSeconds: parseInt(secondsToAdd)
                        });
                    // Set next timer tick
                    setGameTimer(timerKey, timerTick, 1000);
                }
            } catch (error) {
                console.error("Error in game timer:", error);
                cleanTimeAndData(timerKey);
                cleanupGameState(game);
            }
        }
        setGameTimer(timerKey, timerTick, 1000);
    } catch (error) {
        console.error('Error in startNormalGame:', error);
        throw error;
    }
}

async function cleanupGameState(game) {
    try {
        const indexp = Sys.Running.indexOf(`${game.gameNumber}`);
        if (indexp > -1) {
            Sys.Running.splice(indexp, 1);
        }
        
        const indexy = Sys.StartedGame.indexOf(`${game._id.toString()}`);
        if (indexy > -1) {
            Sys.StartedGame.splice(indexy, 1);
        }
    } catch (error) {
        console.error('Error in cleanupGameState:', error);
    }
}

async function getPlayerTicketsRedis({ gameId, playerId, gameStatus }) {
    try {
        if (gameStatus === 'running') {
            // Try Redis first
            const redisTickets = await getGameTicketsFromRedis({ gameId, gameType: 'game3', playerId });
            if (Array.isArray(redisTickets) && redisTickets.length > 0) {
                return redisTickets;
            }
            // If Redis has no data, fallback to MongoDB
        }

        // Fallback or non-running: Fetch from MongoDB
        const allPurchasedTickets = await Sys.Game.Game3.Services.GameServices.getTicketByData(
            { gameId, playerIdOfPurchaser: playerId, isCancelled: false },
            {
                _id: 1, playerIdOfPurchaser: 1, gameId: 1, ticketPrice: 1,
                ticketPurchasedFrom: 1, ticketId: 1, tickets: 1, hallName: 1, supplier: 1, developer: 1
            }
        );
        return allPurchasedTickets;

    } catch (error) {
        console.error('Error in getPlayerTicketsRedis:', error);
        return [];
    }
}

async function checkLuckyNumber(data) {
    try {
        console.log("checkLuckyNumber called", data)
        const { playerId, ticketId, game, lastBall, hallName, hallId, groupHallName, groupHallId, patternId } = data;

        const player = game.players.find(p => p.id === playerId);
        if (!player || player.luckyNumber !== lastBall) return [];

        const baseTransactionData = {
            playerId: playerId,
            gameId: game._id,
            totalAmount: Math.round(game.luckyNumberPrize),
            isBot: game.isBotGame || false,
            hallName,
            hallId,
            groupHallName,
            groupHallId
        };

        const transactionDataSend = {
            ...baseTransactionData,
            ticketId,
            transactionSlug: "luckyPrize",
            action: "credit",
            purchasedSlug: "realMoney",
            lastBall
        };

        const extraTransaction = {
            ...baseTransactionData,
            transactionSlug: "extraTransaction",
            typeOfTransaction: "Lucky number prize",
            action: "credit",
            purchasedSlug: "realMoney"
        };

        await Promise.all([
            Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend),
            Sys.Helper.gameHelper.createTransactionPlayer(extraTransaction)
        ]);

        return [{
            playerId,
            gameId: game._id,
            ticketId,
            walletType: "realMoney",
            finalWonAmount: Math.round(game.luckyNumberPrize),
            lineTypeArray: "Lucky Number",
            patternId
        }];
    } catch (e) {
        console.error("luckynumberPrize", e);
        return [];
    }
}

async function processRefundAndFinishGameCron(gameId, parentGame, isBotGame = false) {
    try {
        console.log("processRefundAndFinishGameCron called", gameId, parentGame, isBotGame);
        const gameData = await Sys.Game.Common.Services.GameServices.getSingleGameData({ _id: gameId }, { _id: 1, players: 1, ticketPrice: 1, gameNumber: 1, gameName: 1, patternWinnerHistory: 1 });
        const playerIds = gameData.players.map(p => p.id.toString());

        // Fetch all tickets of the game in one go
        const allTickets = await Sys.Game.Game3.Services.GameServices.getTicketByData({
            gameId: gameData._id.toString(),
            isCancelled: false
        }, {
            _id: 1, playerIdOfPurchaser: 1, gameId: 1, ticketPurchasedFrom: 1, ticketPrice: 1
        });

        // Group tickets by playerId
        const ticketsByPlayer = allTickets.reduce((acc, ticket) => {
            const playerId = ticket.playerIdOfPurchaser.toString();
            if (!acc[playerId]) acc[playerId] = [];
            acc[playerId].push(ticket);
            return acc;
        }, {});

        // Fetch all players in parallel
        const playerDetails = await Sys.Game.Game2.Services.PlayerServices.getByData({ _id: { $in: playerIds } }, { selectedLanguage: 1, username: 1, socketId: 1, hall: 1 });

        // Build a map of playerId to details
        const playerMap = Object.fromEntries(playerDetails.map(p => [p._id.toString(), p]));


        // Create Notification Message
        const message = {
            en: await translate({ key: "refund_tickets", language: 'en', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName }),
            nor: await translate({ key: "refund_tickets", language: 'nor', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName })
        };

        const notification = {
            notificationType: 'Refund Tickets',
            message
        };

        // Prepare all operations
        const operations = [];
        const socketIds = [];
        for (const playerId of playerIds) {
            const tickets = ticketsByPlayer[playerId] || [];
            const player = playerMap[playerId];
            if (!player || tickets.length === 0) continue;

            const baseTransactions = tickets.map(ticket => ({
                playerId: ticket.playerIdOfPurchaser,
                gameId: ticket.gameId,
                ticketId: ticket._id,
                transactionSlug: "refund",
                action: "credit",
                purchasedSlug: ticket.ticketPurchasedFrom,
                totalAmount: gameData.ticketPrice
            }));

            let pointTotal = 0, realTotal = 0;
            for (const t of tickets) {
                if (t.ticketPurchasedFrom === 'points') {
                    pointTotal += t.ticketPrice;
                } else if (t.ticketPurchasedFrom === 'realMoney') {
                    realTotal += t.ticketPrice;
                }
            }
            const extraTransactions = [];

            if (pointTotal > 0) {
                extraTransactions.push({
                  playerId,
                  gameId: gameData._id,
                  transactionSlug: "extraTransaction",
                  typeOfTransaction: "Refund",
                  action: "credit",
                  purchasedSlug: "points",
                  totalAmount: pointTotal
                });
                Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                    type: "cancel",
                    playerId: player._id,
                    hallId: player.hall.id,
                    cancel: pointTotal
                });
                await updatePlayerHallSpendingData({ playerId: player._id, hallId: player.hall.id, amount: +pointTotal, type: 'normal', gameStatus: 2 });
            }
              
            if (realTotal > 0) {
                extraTransactions.push({
                    playerId,
                    gameId: gameData._id,
                    transactionSlug: "extraTransaction",
                    typeOfTransaction: "Refund",
                    action: "credit",
                    purchasedSlug: "realMoney",
                    totalAmount: realTotal
                });
                Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                    type: "cancel",
                    playerId: player._id,
                    hallId: player.hall.id,
                    cancel: realTotal
                });
                await updatePlayerHallSpendingData({ playerId: player._id, hallId: player.hall.id, amount: +realTotal, type: 'normal', gameStatus: 2 });
            }

            // Notifications
            const dataNotification = {
                playerId,
                gameId: gameData._id,
                notification
            };

            operations.push(
                ...baseTransactions.map(t => Sys.Helper.gameHelper.createTransactionPlayer(t)),
                ...extraTransactions.map(t => Sys.Helper.gameHelper.createTransactionPlayer(t)),
                Sys.Game.Common.Services.NotificationServices.create(dataNotification),
            );

            // Only send notification if not a bot game
            if (!isBotGame) {
                socketIds.push(player.socketId);
                operations.push(
                    Sys.Helper.gameHelper.sendNotificationToOnePlayer(
                        gameData._id,
                        playerId,
                        message[player.selectedLanguage],
                        gameData.gameName,
                        notification.notificationType
                    )
                );
            }
        }

        // Execute all queued operations in parallel
        await Promise.all(operations);

        // Send PlayerHallLimit broadcast to all refunded players
        if (socketIds.length > 0) {
            for (const sid of socketIds) {
                Sys.Io.to(sid).emit('PlayerHallLimit', { });
            }
        }

        await Promise.all([
            Sys.Game.Common.Services.GameServices.updateManyData({ gameId: gameId.toString() }, { $set: { isCancelled: true } }),
            Sys.Game.Common.Services.GameServices.updateGame({ _id: gameId }, { status: "finish" })
        ]);

        if (parentGame?.stopGame) {
            await Sys.Game.Common.Services.GameServices.updateParentGame({
                _id: parentGame._id
            }, {
                status: "finish"
            });
        }

        let index = Sys.Timers.indexOf(gameId.toString());
        if (index !== -1) {
            Timeout.clear(Sys.Timers[index], erase = true);
            Sys.Timers.splice(index, 1);
        }

        // For bot games Revert the winning on patterns
        if (isBotGame) {
            const promises = gameData.patternWinnerHistory.map(history => {
                console.log(`Reverting winning amount of ${history.finalwin} for pattern ${history.patternName} from ${history.winnerPlayerId}`);
        
                const newExtraTransaction = {
                    playerId: history.winnerPlayerId,
                    gameId: gameData._id,
                    transactionSlug: "extraTransaction",
                    typeOfTransaction: "Revert",
                    action: "debit",
                    purchasedSlug: "realMoney",
                    totalAmount: Math.round(history.finalwin)
                };
        
                // Return a promise that runs both operations in parallel
                return Promise.all([
                    Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction),
                    Sys.Game.Common.Services.PlayerServices.updatePlayerData(
                        { _id: history.winnerPlayerId },
                        { $inc: { walletAmount: -history.finalwin } }
                    )
                ]);
            });
        
            // Await all operations concurrently
            await Promise.all(promises);
        }
    } catch (error) {
        console.error("Error in processRefundAndFinishGameCron:", error);
    }
}


module.exports = {
    validateGameTiming,
    processPurchase,
    handleGameStart,
    preparePatternData,
    patternPriceUpdateBroadcast,
    cancelTickets,
    createGameData,
    evaluatePatternsAndUpdateGameData,
    getPatternToCheckWinner,
    processPatternWinners,
    processTicketStats,
    processLuckyNumberStats,
    updateWinnerProfitAmount,
    updatePlayerStatistics,
    handleNextGame,
    removeRoomFromRunning,
    handleBotGame,
    handleNormalGame,
    cleanupGameState,
    checkPreviousGameStatus,
    getPlayerTicketsRedis,
    processRefundAndFinishGameCron
};