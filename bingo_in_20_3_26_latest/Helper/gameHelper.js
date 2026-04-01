var mongoose = require('mongoose');
var Sys = require('../Boot/Sys');
var request = require("request");
var dateFormat = require('dateformat');
const fcm = require('fcm-notification');
const { ConsoleTransportOptions } = require('winston/lib/winston/transports');
const { compareSync } = require('bcryptjs');
const FCM = new fcm('spillorama-214ee-firebase-adminsdk-p37do-a798378568.json');
var token = 'AAAAvrnsIbc:APA91bHcrNe3mF_YC5u7rIfdbe_zfDXx9DFioj0teSnHrvEt50qmyHG2DGBNY5yb8YJnbIU3qgN0qxGLZKJQvxVsJWxnjFZJDhpKtH-X7RLf7zDuN48xuzOYvnIPREOXWshmGLpHtCdc';

const path = require('path');
const fs = require('fs').promises;

module.exports = {
   
    sendNotificationToPlayers: async function (game, players, TimeMessage, notificationType) {
        try {
            console.log("---players, send notifications for the game---", game._id, players)
            let playerTokens = await Sys.Game.Common.Services.PlayerServices.getByDataPlayers({ "_id": { $in: players } }, { firebaseToken: 1, socketId: 1, selectedLanguage: 1 });
            //console.log("playerTokens", playerTokens);
            // let Tokens = [];
            let socketIds = [];
            for (let p = 0; p < playerTokens.length; p++) {
                // if (playerTokens[p].firebaseToken != "") {
                //     Tokens.push(playerTokens[p].firebaseToken);
                // }
                socketIds.push({socketId: playerTokens[p].socketId, language: playerTokens[p].selectedLanguage});
            }
            //console.log("tokens", Tokens)

            // send broadcast to all players
            console.log("---socketIds---", socketIds, game._id)
            for (let p = 0; p < socketIds.length; p++) {
                if (socketIds[p].socketId != "") {
                    Sys.Io.to(socketIds[p].socketId).emit('NotificationBroadcast', {
                        notificationType: notificationType,
                        message: TimeMessage[socketIds[p].language]
                    });
                }
            }


            // let message = {
            //     notification: {
            //         title: 'Spillorama',
            //         body: TimeMessage
            //     }
            // };
            //console.log(message)

            // FCM.sendToMultipleToken(message, Tokens, function(err, response) {
            //     if (err) {
            //         console.log('err--', err);
            //     } else {
            //         console.log('response of gamestart notification-----', response);
            //     }
            // });
        } catch (e) {
            console.log("sendNotificationToPlayer", e);
        }
    },

    // [ Push Notification - ( Player ) ]
    sendNotificationToOnePlayer: async function (game, players, TimeMessage, gameName, notificationType) {
        try {

            console.log("--- [ sendNotificationToOnePlayer ] player, send notifications for the game---", game, players)

            let player = await Sys.Game.Common.Services.PlayerServices.getById(players);

            // let message = {
            //     notification: {
            //         title: 'Spillorama',
            //         body: TimeMessage
            //     },
            //     token: player.firebaseToken,
            // };
            //console.log("fcm message in sendNotificationToOnePlayer", message)
            Sys.Io.to(player.socketId).emit('NotificationBroadcast', {
                notificationType: notificationType,
                message: TimeMessage
            });

            // FCM.send(message, function(err, response) {
            //     if (err) {
            //         console.log('err--', err);
            //     } else {
            //         console.log('response-----', response);
            //     }
            // });

        } catch (e) {
            console.log("sendNotificationToOnePlayer", e);
        }
    },

    //[ Rocket Takeoff OLD]
    RocketTakeOffGame2: async function (data) {
        try {
            console.log("RocketTakeOffGame2 Data", data);

            let gameDataUpdatedPlayer = await Sys.Game.Game2.Services.GameServices.getSingleGameByData({ _id: data.gameId }, {players: 1, totalNoPurchasedTickets: 1, totalNoTickets: 1, startDate: 1, graceDate: 1, gameNumber: 1, gameName: 1});

            if (gameDataUpdatedPlayer.totalNoTickets >= 31) {
                console.log("1000 :gameDataUpdatedPlayer.totalNoTickets >= 31 ", gameDataUpdatedPlayer.totalNoTickets >= 31);
                /*for (let j = 0; j < gameDataUpdatedPlayer.players.length; j++) {
                    let ownPurchasedTicketCount = gameDataUpdatedPlayer.purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(gameDataUpdatedPlayer.players[j].id));
                    console.log("1000 :ownPurchasedTicketCount.length > 30 1 ", ownPurchasedTicketCount.length > 30);
                    if (ownPurchasedTicketCount.length >= 30) {
                        console.log("1000 :ownPurchasedTicketCount.length > 30 2", ownPurchasedTicketCount.length > 30);
                        await Sys.Io.of(Sys.Config.Namespace.Game2).to(gameDataUpdatedPlayer.players[j].socketId).emit('Game2RocketLaunch', {
                            gameId: gameDataUpdatedPlayer._id
                        });
                    }
                }*/

                //console.log("players--", gameDataUpdatedPlayer.players.length, gameDataUpdatedPlayer.players)
                for (let j = (gameDataUpdatedPlayer.players.length - 1); j >= 0; j--) {
                    //console.log("players",j,  gameDataUpdatedPlayer.players[j])
                    let ownPurchasedTicketCount = gameDataUpdatedPlayer.players[j].ticketCount; //gameDataUpdatedPlayer.purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(gameDataUpdatedPlayer.players[j].id));
                    console.log("1000 :ownPurchasedTicketCount.length >= 30 1 ", ownPurchasedTicketCount.length >= 30);
                    if (ownPurchasedTicketCount.length >= 30 && gameDataUpdatedPlayer.players[j].id >= data.playerId) {
                        console.log("inside rocket launch")
                        console.log("1000 :ownPurchasedTicketCount.length >= 30 2", ownPurchasedTicketCount.length >= 30);
                        let playerSockets = await Sys.Game.Common.Services.PlayerServices.getByData({ "_id": { $in: data.playerId } }, { socketId: 1 });
                        console.log("player socket while rocket take off 1000 tickets", playerSockets, gameDataUpdatedPlayer._id)
                        await Sys.Io.of(Sys.Config.Namespace.Game2).to("/" + Sys.Config.Namespace.Game2 + "#" + playerSockets[0].socketId).emit('Game2RocketLaunch', {
                            gameId: gameDataUpdatedPlayer._id
                        });
                        break;
                    }
                }
            }


            if (gameDataUpdatedPlayer.totalNoPurchasedTickets == gameDataUpdatedPlayer.totalNoTickets) {
                console.log("30 : gameDataUpdatedPlayer.purchasedTickets.length == gameDataUpdatedPlayer.totalNoTickets", gameDataUpdatedPlayer.totalNoPurchasedTickets == gameDataUpdatedPlayer.totalNoTickets);
                /*for (let f = 0; f < gameDataUpdatedPlayer.players.length; f++) {
                    console.log("gameDataUpdatedNewPlayer.players[f].socketId", gameDataUpdatedPlayer.players[f].socketId);
                    await Sys.Io.of(Sys.Config.Namespace.Game2).to(gameDataUpdatedPlayer.players[f].socketId).emit('Game2RocketLaunch', {
                        gameId: gameDataUpdatedPlayer._id
                    });
                }*/
                let playerIds = [];
                for (let p = 0; p < gameDataUpdatedPlayer.players.length; p++) {
                    playerIds.push(gameDataUpdatedPlayer.players[p].id)
                }
                if (playerIds.length > 0) {
                    let playerSockets = await Sys.Game.Common.Services.PlayerServices.getByData({ "_id": { $in: playerIds } }, { socketId: 1 });
                    console.log("playerSockets----", playerSockets)
                    for (let f = 0; f < playerSockets.length; f++) {
                        console.log("playerSockets ids", playerSockets[f].socketId);

                        await Sys.Io.of(Sys.Config.Namespace.Game2).to("/" + Sys.Config.Namespace.Game2 + "#" + playerSockets[f].socketId).emit('Game2RocketLaunch', {
                            gameId: gameDataUpdatedPlayer._id
                        });
                    }
                }
            }
            await Sys.Game.Game3.Services.GameServices.updateSingleGame({ _id: gameDataUpdatedPlayer._id }, {
                $set: {
                    rocketLaunch: true
                }
            });
            return true;

        } catch (error) {
            console.log("RocketTakeOffGame2 error", error);
        }
    },

    // [ Auto Buy ( Game 2 ) ]
    autoBuyTicket: async function (data) {
        try {

            // [ Player ]
            let player = await Sys.Game.Game2.Services.PlayerServices.getById({ _id: await Sys.Helper.bingo.obId(data.playerId) }, {points: 1, walletAmount: 1});
            if (player) {

                let playerBalance = player.points;
                let playerRealMoney = player.walletAmount;
                let totalOfTicketAmount = 0;
                let totalTicketsPurchasedByPlayer = 0;
                console.log("data.autoPlay", data);

                let game = await Sys.Game.Game2.Services.GameServices.getSingleGameByData({ _id: await Sys.Helper.bingo.obId(data.gameId) }, {_id: 1});

                let startFrom = new Date(Date.now());
                let endFrom = new Date(Date.now());
                endFrom.setHours(23, 59, 59);
                console.log("start & end date of auto play ticket purchase", startFrom, endFrom);
                /*let query = {
                    startDate: {
                        $lt: endFrom,
                        $gte: startFrom,
                    },
                    status: "active",
                    gameType: "game_2",
                    _id: {
                        $ne: game._id
                    }
                }*/
                let query = {
                    status: "active",
                    gameType: "game_2",
                    _id: {
                        $ne: game._id
                    },
                    $or: [{ startDate: { $gte: startFrom, $lt: endFrom } }, { graceDate: { $gte: startFrom, $lt: endFrom } }]
                }

                let gameList = await Sys.Game.Game2.Services.GameServices.getByData(query, {totalNoPurchasedTickets: 1, ticketPrice: 1, gameNumber: 1, gameName: 1, players: 1});
                console.log("gameList length", gameList.length, gameList)
                let purchasedTickets = [];
                let playersData = [];

                // [ In Future Game List ]
                for (let i = 0; i < gameList.length; i++) {
                    console.log("gameList count id", i)
                    let ticketLimit = data.ticketLength;
                    if (gameList[i].totalNoPurchasedTickets >= 0) {
                        //const purchasedCount = gameList[i].purchasedTickets.filter((obj) => obj.playerIdOfPurchaser == data.playerId).length;
                        const player = gameList[i].players.find((obj) => obj.id == data.playerId);
                        const purchasedCount = player ? player.ticketCount : 0;
                        console.log("already purchasedCount --", purchasedCount)
                        if (purchasedCount >= 30) {
                            ticketLimit = 0;
                            continue;
                        } else {
                            let remainingPurchaedCount = 30 - parseInt(purchasedCount);
                            if (ticketLimit > remainingPurchaedCount) {
                                ticketLimit = remainingPurchaedCount;
                            } else {
                                ticketLimit = parseInt(data.ticketLength);
                            }
                        }
                        console.log("Final Auto play purchase tickets for game--", gameList[i]._id, ticketLimit)
                    }
                    let queryTicket = {
                        isPurchased: false,
                        gameId: gameList[i]._id
                    };
                    let start = 0;
                    // [ Remaining Ticket ]
                    let limitTicketData = await Sys.Game.Game2.Services.GameServices.getTicketByData(queryTicket, {tickets: 1, hallName: 1, supplier: 1, developer: 1, ticketId: 1}, {skip: start, limit: (ticketLimit + 150)});

                    //check if player have Insufficient Balance for Ticket buying
                    let TotalAmountOfTickets = gameList[i].ticketPrice * parseInt(ticketLimit);
                    console.log("TotalAmountOfTickets in auto play ticket buy", TotalAmountOfTickets)
                    player = await Sys.Game.Game2.Services.PlayerServices.getById({ _id: await Sys.Helper.bingo.obId(data.playerId) }, {points: 1, walletAmount: 1, monthlyWallet: 1, monthlyWalletAmountLimit: 1, username: 1});
                    if (data.purchasedSlug == 'points') {
                        if (player.points < TotalAmountOfTickets) {
                            let dataSend = {
                                totalOfTicketAmount: totalOfTicketAmount,
                                totalTicketsPurchasedByPlayer: totalTicketsPurchasedByPlayer,
                                isAuto: true,
                                isMessage: true,
                            }
                            return dataSend;
                        }

                    } else if (data.purchasedSlug == 'realMoney') {

                        if (player.walletAmount < TotalAmountOfTickets) {
                            let dataSend = {
                                totalOfTicketAmount: totalOfTicketAmount,
                                totalTicketsPurchasedByPlayer: totalTicketsPurchasedByPlayer,
                                isAuto: true,
                                isMessage: true,

                            }
                            return dataSend;
                        }

                    } else if (data.purchasedSlug == 'voucher') {
                        return false;
                    }

                    //[ Monthly Wallet Amount Limit ]
                    if (data.purchasedSlug == 'realMoney') {
                        if (player.monthlyWallet == true && player.monthlyWalletAmountLimit < TotalAmountOfTickets) {
                            let dataSend = {
                                totalOfTicketAmount: totalOfTicketAmount,
                                totalTicketsPurchasedByPlayer: totalTicketsPurchasedByPlayer,
                                isAuto: true,
                                isMessage: true,
                            }
                            return dataSend;
                        }
                    }

                    purchasedTickets.length = 0;
                    console.log("limitTicketData length---", limitTicketData.length, ticketLimit)
                    for (let j = 0; j < limitTicketData.length; j++) {
                        console.log("limitTicketData loop", j)
                        let gameDataTicket = {
                            gameId: gameList[i]._id,
                            ticketCellNumberList: limitTicketData[j].tickets,
                            isPurchased: true,
                            playerIdOfPurchaser: player._id,
                            hallName: limitTicketData[j].hallName,
                            supplier: limitTicketData[j].supplier,
                            developer: limitTicketData[j].developer,
                            ticketNumber: limitTicketData[j].ticketId,
                            ticketId: limitTicketData[j]._id,
                            purchasedSlug: data.purchasedSlug,
                            socketId: data.socketId,
                            playerRemeaningNumber: 9,
                            totalAmount: gameList[i].ticketPrice,
                            ticketCompleted: false
                        }
                        //purchasedTickets.push(gameDataTicket);

                        let transactionDataSend = {
                            playerId: player._id,
                            gameId: gameList[i]._id,
                            ticketId: limitTicketData[j]._id,
                            transactionSlug: "autoTicket",
                            action: "debit", // debit / credit
                            purchasedSlug: data.purchasedSlug, // point /realMoney
                            totalAmount: gameList[i].ticketPrice
                        }

                        let isTicketPurchased = await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);
                        console.log("isTicketPurchased in autobuy---", limitTicketData[j]._id, player._id, isTicketPurchased)
                        if (isTicketPurchased != false) {
                            purchasedTickets.push(gameDataTicket);
                        }
                        console.log("purchasedTickets.length", purchasedTickets.length)
                        if (purchasedTickets.length >= ticketLimit) {
                            break;
                        }
                        // console.log("testing", testing);
                        // if (testing == false) {
                        //     return {
                        //         status: 'fail',
                        //         result: {
                        //             playerId: player._id,
                        //             username: player.username,
                        //         },
                        //         message: 'Sorry ..!! Some few tickets purchased already. So try with new one..!!',
                        //         statusCode: 401
                        //     }
                        // }
                    }

                    let ownPurchasedTicketCount = purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(player._id));

                    console.log("Total of ownPurchasedTicket Amount [ Game 2 Auto ] ::--->> ", ownPurchasedTicketCount.reduce((n, { totalAmount }) => n + totalAmount, 0))

                    let newExtraTransaction = {
                        playerId: player._id,
                        gameId: gameList[i]._id,
                        transactionSlug: "extraTransaction",
                        typeOfTransaction: "Game Joined ( Auto )",
                        action: "debit", // debit / credit
                        purchasedSlug: data.purchasedSlug, // point /realMoney
                        totalAmount: ownPurchasedTicketCount.reduce((n, { totalAmount }) => n + totalAmount, 0),
                    }

                    await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);

                    totalOfTicketAmount += newExtraTransaction.totalAmount;
                    totalTicketsPurchasedByPlayer += purchasedTickets.length;


                    let playersNEwDAta = await Sys.Game.Game2.Services.GameServices.getSingleGameByData({ _id: gameList[i]._id, status: 'active' }, {players: 1});
                    let targetObject = playersNEwDAta.players.find(item => JSON.stringify(item.id) == JSON.stringify(player._id));
                    let updateGameTemp;
                    if (targetObject) {
                        //finalPlayer = playersNEwDAta.players
                        updateGameTemp = await Sys.Game.Game3.Services.GameServices.updateSingleGame({ _id: gameList[i]._id }, { $push: { "purchasedTickets": { $each: purchasedTickets } } }, { new: true });
                    } else {
                        let playerUpdated = await Sys.Game.Game2.Services.PlayerServices.getById(player._id, {_id: 1});
                        let players = {
                            id: player._id,
                            name: player.username,
                            status: 'Waiting',
                            socketId: data.socketId,
                            purchasedSlug: data.purchasedSlug,
                            points: playerBalance,
                            walletAmount: playerRealMoney,
                            luckyNumber: data.luckyNumber,
                            autoPlay: data.autoPlay,
                            isPlayerOnline: false,
                            isLossAndWon: false
                        }
                        //playersData.push(players);
                        //let beforePlayer = playersNEwDAta.players
                        //finalPlayer = beforePlayer.concat(playersData);
                        updateGameTemp = await Sys.Game.Game3.Services.GameServices.updateSingleGame({ _id: gameList[i]._id }, { $push: { "players": players, "purchasedTickets": { $each: purchasedTickets } } }, { new: true });
                    }
                    console.log("game 2 ticketPurchased updates", updateGameTemp)
                    let updateGameNEwData = await Sys.Game.Game2.Services.GameServices.getSingleGameByData({ _id: gameList[i]._id, status: 'active' }, {purchasedTickets: 1});
                   

                    let gameDataUpdatedPlayer = await Sys.Game.Game2.Services.GameServices.getSingleGameByData({ _id: gameList[i]._id }, {startDate: 1, graceDate: 1, gameNumber: 1, gameName: 1});
                    let sendRocket = { gameId: gameDataUpdatedPlayer._id, playerId: player._id }
                    let RocketTakeOff = await Sys.Helper.gameHelper.RocketTakeOffGame2(sendRocket);
                    console.log("RocketTakeOff", RocketTakeOff);



                    let TimeMessage = gameList[i].gameNumber + " [ " + gameList[i].gameName + " ] " + purchasedTickets.length + " Tickets Buying Successfully..!! ";

                    let notificationDate = gameDataUpdatedPlayer.startDate;
                    if (gameDataUpdatedPlayer.startDate <= Date.now()) {
                        notificationDate = gameDataUpdatedPlayer.graceDate;
                    }

                    let notification = {
                        notificationType: 'purchasedTickets',
                        message: TimeMessage,
                        ticketMessage: `You bought ${purchasedTickets.length} ticket for this ${gameDataUpdatedPlayer.gameName}..!!`,
                        price: `${ownPurchasedTicketCount.reduce((n, { totalAmount }) => n + totalAmount, 0)}`,
                        date: notificationDate
                    }

                    let dataNotification = {
                        playerId: player._id,
                        gameId: gameDataUpdatedPlayer._id,
                        notification: notification
                    }

                    await Sys.Game.Common.Services.NotificationServices.create(dataNotification);
                }

                let dataSendNew = {
                    totalOfTicketAmount: totalOfTicketAmount,
                    totalTicketsPurchasedByPlayer: totalTicketsPurchasedByPlayer,
                    isAuto: true
                }

                return dataSendNew;
            } else {
                return {
                    status: 'fail',
                    result: null,
                    message: 'No Player Found!',
                    statusCode: 400
                }
            }

        } catch (e) {
            console.log("autoBuyTicket", e);
        }
    },

    createTransactionPlayer: async function (data) {
        // let session = await mongoose.startSession();
        // await session.startTransaction();
        try {

            // console.log(" createTransactionPlayer createTransactionPlayer : ",data)

            // let optSession = { session: session };
            let slug = data.transactionSlug;
            let player = await Sys.Game.Common.Services.PlayerServices.getById({ _id: data.playerId });
            let game;
            let groupHall;

            // console.log("", data);

            if (data.extraSlug == "Game4") {
                game = await Sys.Game.Common.Services.GameServices.getSingleSubGameData({ _id: data.gameId });
            } else if (data.extraSlug == "Game5") {
                game = await Sys.Game.Game5.Services.GameServices.getSingleSubgameData({ _id: data.gameId });
            } else {
                game = await Sys.Game.Common.Services.GameServices.getSingleGameData({ _id: data.gameId });
            }
            
            if (!player) {
                console.log("This (" + data.playerId + ") Player Detail Not Found.");
                await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                    playerId: data.playerId,
                    gameId: data.gameId,
                    action: data.action,
                    amtCategory: data.purchasedSlug,
                    amount: data.totalAmount,
                    remark: "This (" + data.playerId + ") Player Detail Not Found.",
                    createdAt: Date.now()
                });
                throw { "status": "Error", "message": "This Player Detail Not Found." };
            }

            if (slug == "loyalty") {
                let loyalty = await Sys.App.Services.LoyaltyService.getLoyaltyById(data.loyaltyId);
                if (!loyalty) {
                    console.log("This (" + data.loyaltyId + ") Loyalty Detail Not Found.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        loyaltyId: data.loyaltyId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.loyaltyId + ") Loyalty Detail Not Found.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This Loyalty Detail Not Found." };
                }
            } else if (slug == "voucher") {
                let voucher = await Sys.App.Services.VoucherServices.getById(data.voucherId);
                if (!voucher) {
                    console.log("This (" + data.voucherId + ") Voucher Detail Not Found.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        voucherId: data.voucherId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.voucherId + ") Voucher Detail Not Found.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This Voucher Detail Not Found." };
                }
            } else if (slug == "leaderboard") {
                let leaderboard = await Sys.App.Services.LeaderboardServices.getById(data.leaderboardId);
                if (!leaderboard) {
                    console.log("This (" + data.leaderboardId + ") Leaderboard Detail Not Found.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        leaderboardId: data.leaderboardId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.leaderboardId + ") Leaderboard Detail Not Found.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This Leaderboard Detail Not Found." };
                }
            } else {
                if ((!game) && (slug != 'unique')) {
                    console.log("This (" + data.gameId + ") Game Detail Not Found.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        gameId: data.gameId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.gameId + ") Game Detail Not Found.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This Game Detail Not Found." };
                }
            }

            let userType = "Online";
            if (player.userType == "Unique") {
                userType = "Unique"
            } else if (player.userType == "Bot") {
                userType = "Bot"
            }
            if (game && data.extraSlug != "Game4" && data.extraSlug != "Game5") {
                //console.log("groupHalls of game", game.groupHalls)
                groupHall = game.groupHalls.filter(grp => grp.halls.some(hall => hall.id.toString() === player.hall.id.toString()))
            }
            if (slug == "buyTicket") { // buyticket for all games
                //   console.log("buyTicket action :", data.action);
                if (data.action == "debit") {
                    //console.log("debit 1")
                    if (data.purchasedSlug == "points") {
                        console.log("point debit")

                        let currentUser = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: -data.totalAmount } }); //optSession
                        console.log("currentUser---", currentUser)
                        let ticketData = await Sys.Game.Common.Services.GameServices.getSingleTicketData({ _id: data.ticketId });
                        let Vid = await Sys.Helper.bingo.obId(data.voucherId);

                        let voucher = await Sys.App.Services.VoucherServices.getSingle({ _id: Vid });


                        if (game.gameType == 'game_2') {
                            if (ticketData.isPurchased == true) {
                                return false;
                            } else {
                                // let updated = {
                                //     isPurchased: true,
                                //     playerIdOfPurchaser: await Sys.Helper.bingo.obId(currentUser._id),
                                // }
                                // await Sys.Game.Game2.Services.GameServices.updateTicket({ _id: ticketData._id }, updated);

                                let pId = await Sys.Helper.bingo.obId(currentUser._id);
                                let updatedTicket = await Sys.Game.Game2.Services.GameServices.updateSingleTicket({
                                    _id: ticketData._id,
                                    isPurchased: false
                                },
                                    {
                                        isPurchased: true,
                                        playerIdOfPurchaser: pId,
                                        userType: userType,
                                        playerNameOfPurchaser: currentUser.username,
                                        uniquePlayerId: (userType !== "Unique") ? '' : player.uniqueId,
                                        ticketPurchasedFrom: data.purchasedSlug,
                                        isAgentTicket: (player.userType == "Unique" && player.isCreatedByAdmin == false) ? true : false,
                                        agentId: player.agentId,
                                        hallName: player.hall.name,
                                        groupHallName: groupHall[0].name,
                                        hallId: player.hall.id,
                                        groupHallId: groupHall[0].id,
                                        createdAt: new Date()
                                    }, {new: true});
                                if (updatedTicket == null) {
                                    console.log("tickets not purchased while updating ticket")
                                    return false;
                                }
                                console.log("ticket purchased successfully!----")
                            }
                        }

                        let transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentUser._id,
                            playerName: currentUser.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameMode: game.gameMode,
                            differenceAmount: data.totalAmount,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            ticketPrice: (data.extraSlug == "Game4") ? data.totalAmount : (game.gameType == "game_1") ? data.totalAmount : game.ticketPrice,
                            ticketId: ticketData._id,
                            ticketNumber: ticketData.ticketId,
                            variantGame: (data.variantGame) ? data.variantGame : "",
                            ticketColorType: (data.ticketColorType) ? data.ticketColorType : "",
                            voucherId: (data.voucherId) ? voucher._id : "",
                            voucherCode: (data.voucherId) ? data.voucherCode : "",
                            voucherAmount: (data.voucherId) ? voucher.points : "",
                            isVoucherUse: (data.voucherId) ? true : false,
                            isVoucherApplied: (data.voucherId) ? true : false,
                            defineSlug: "buyTicket",
                            category: "debit",
                            status: "success",
                            amtCategory: "points",
                            previousBalance: currentUser.points + data.totalAmount,
                            afterBalance: currentUser.points,
                            hall: {
                                name: player.hall.name,
                                id: player.hall.id
                            },
                            groupHall: (data.extraSlug != "Game4") ? {
                                name: groupHall[0].name,
                                id: groupHall[0].id
                            } : {},
                            hallId: player.hall.id,
                            groupHallId: (data.extraSlug != "Game4") ? groupHall[0].id : '',
                            remark: (data.extraSlug == "Game4") ? "Purchased " + ticketData.ticketId + "Ticket Game Ticket Price" + game.ticketPrice + " with Multipler " + data.multiplierValue : "Purchased " + ticketData.ticketId + " Ticket", //remark on transaction
                            userType: userType,
                            createdAt: Date.now(),
                            isBotGame: ((game.otherData && game.otherData.isBotGame && game.otherData.isBotGame == true) || game.isBotGame) ? true : false
                        }
                        console.log("transactionPointData", transactionPointData)
                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);

                    } else if (data.purchasedSlug == "realMoney") {
                        const updateQuery = { $inc: { walletAmount: -data.totalAmount } }
                        if (player.userType !== "Bot") {
                            updateQuery.$inc.monthlyWalletAmountLimit = -data.totalAmount
                        }
                        let currentPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, updateQuery); //, optSession

                        let ticketData = await Sys.Game.Common.Services.GameServices.getSingleTicketData({ _id: data.ticketId });
                        console.log("ticketData of transaction---", data.ticketId);
                        let Vid = await Sys.Helper.bingo.obId(data.voucherId);
                        let voucher = await Sys.App.Services.VoucherServices.getSingle({ _id: Vid });

                        if (game.gameType == 'game_2') {
                            if (ticketData.isPurchased == true) {
                                return false;
                            } else {
                                // let updated = {
                                //     isPurchased: true,
                                //     playerIdOfPurchaser: await Sys.Helper.bingo.obId(currentPlayer._id),
                                // }
                                // await Sys.Game.Game2.Services.GameServices.updateTicket({ _id: ticketData._id }, updated);
                                let pId = await Sys.Helper.bingo.obId(currentPlayer._id);
                                let updatedTicket = await Sys.Game.Game2.Services.GameServices.updateSingleTicket({
                                    _id: ticketData._id,
                                    isPurchased: false
                                },
                                    {
                                        isPurchased: true,
                                        playerNameOfPurchaser: currentPlayer.username,
                                        playerIdOfPurchaser: pId,
                                        userType: userType,
                                        uniquePlayerId: (userType == "Online") ? '' : player.uniqueId,
                                        ticketPurchasedFrom: data.purchasedSlug,
                                        isAgentTicket: (player.userType == "Unique" && player.isCreatedByAdmin == false) ? true : false,
                                        agentId: player.agentId,
                                        hallName: player.hall.name,
                                        groupHallName: groupHall[0].name,
                                        hallId: player.hall.id,
                                        groupHallId: groupHall[0].id,
                                        createdAt: new Date()
                                    }, {new: true});
                                if (updatedTicket == null) {
                                    console.log("tickets not purchased while updating ticket")
                                    return false;
                                }
                                //console.log("ticket purchased successfully realmoney!----")
                            }
                        }

                        let transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentPlayer._id,
                            playerName: currentPlayer.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            gameMode: game.gameMode,
                            differenceAmount: data.totalAmount,
                            ticketPrice: (data.extraSlug == "Game4") ? data.totalAmount : (game.gameType == "game_1") ? data.totalAmount : game.ticketPrice,
                            ticketId: ticketData?._id,
                            ticketNumber: ticketData?.ticketId,
                            hallId: player.hall.id,
                            groupHallId: (data.extraSlug != "Game4") ? groupHall[0].id : data.groupHall.id, //game.groupHalls[0].id,
                            variantGame: (data.variantGame) ? data.variantGame : "",
                            ticketColorType: (data.ticketColorType) ? data.ticketColorType : "",
                            voucherId: (data.voucherId) ? voucher._id : "",
                            voucherCode: (data.voucherId) ? data.voucherCode : "",
                            voucherAmount: (data.voucherId) ? voucher.points : "",
                            isVoucherUse: (data.voucherId) ? true : false,
                            isVoucherApplied: (data.voucherId) ? true : false,
                            defineSlug: "buyTicket",
                            category: "debit",
                            status: "success",
                            amtCategory: "realMoney",
                            previousBalance: currentPlayer.walletAmount + data.totalAmount,
                            afterBalance: currentPlayer.walletAmount,
                            hall: {
                                name: player.hall.name,
                                id: player.hall.id
                            },
                            groupHall: (data.extraSlug != "Game4") ? {
                                name: groupHall[0].name,
                                id: groupHall[0].id
                            } : {
                                name: data.groupHall.name,
                                id: data.groupHall.id
                            },
                            typeOfTransaction: "Game Join/Ticket Purchase",
                            typeOfTransactionTotalAmount: data.totalAmount,
                            remark: (data.extraSlug == "Game4") ? "Purchased " + ticketData.ticketId + "Ticket Game Ticket Price" + game.ticketPrice + " with Multipler " + data.multiplierValue : "Purchased " + ticketData.ticketId + " Ticket", //remark on transaction
                            userType: userType,
                            createdAt: Date.now(),
                            isBotGame: ((game.otherData && game.otherData.isBotGame && game.otherData.isBotGame == true) || game.isBotGame) ? true : false
                        }

                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);

                    }
                } else {
                    console.log("This (" + data.action + ") in Buy Ticket Not Found.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        gameId: data.gameId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") in Buy Ticket  Not Found.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ") in Buy Ticket Not Found." };
                }
            } else if (slug == "autoTicket") { // auto ticket only game 2 
                //console.log("autoTicket action :", data.action);
                if (data.action == "debit") {

                    if (data.purchasedSlug == "points") {

                        let currentUser = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: -data.totalAmount } }); //, optSession

                        let ticketData = await Sys.Game.Common.Services.GameServices.getSingleTicketData({ _id: data.ticketId });

                        if (game.gameType == 'game_2') {
                            if (ticketData.isPurchased == true) {
                                //console.log("tickets already purchased 1",data.ticketId, currentPlayer._id )
                                return false;
                            } else {
                                //console.log("tickets already purchased 2",data.ticketId, currentPlayer._id )
                                // let updated = {
                                //     isPurchased: true,
                                //     playerIdOfPurchaser: await Sys.Helper.bingo.obId(currentUser._id),
                                // }
                                // await Sys.Game.Game2.Services.GameServices.updateTicket({ _id: ticketData._id }, updated);

                                let pId = await Sys.Helper.bingo.obId(currentUser._id);
                                let updatedTicket = await Sys.Game.Game2.Services.GameServices.updateSingleTicket({
                                    _id: ticketData._id,
                                    isPurchased: false
                                }, {
                                    isPurchased: true,
                                    playerIdOfPurchaser: pId,
                                    playerNameOfPurchaser: currentUser.username,
                                    userType: userType,
                                    uniquePlayerId: (userType == "Online") ? '' : player.uniqueId,
                                    ticketPurchasedFrom: data.purchasedSlug,
                                    isAgentTicket: (player.userType == "Unique" && player.isCreatedByAdmin == false) ? true : false,
                                    agentId: player.agentId,
                                    hallName: player.groupHall.hallName,
                                    groupHallName: player.groupHall.name,
                                    createdAt: new Date()
                                }, {new: true});
                                console.log("--updatedTicket in autoTickets---", updatedTicket)
                                if (updatedTicket == null) {
                                    return false;
                                }
                            }
                        }


                        let transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentUser._id,
                            playerName: currentUser.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            ticketPrice: game.ticketPrice,
                            gameMode: game.gameMode,
                            differenceAmount: data.totalAmount,
                            ticketId: ticketData._id,
                            ticketNumber: ticketData.ticketId,
                            variantGame: (data.variantGame) ? data.variantGame : "",
                            ticketColorType: (data.ticketColorType) ? data.ticketColorType : "",
                            defineSlug: "autoTicket",
                            category: "debit",
                            status: "success",
                            amtCategory: "points",
                            previousBalance: currentUser.points + data.totalAmount,
                            afterBalance: currentUser.points,
                            hall: {
                                name: player.groupHall.hallName
                            },
                            groupHall: {
                                name: player.groupHall.name,
                                id: player.groupHall.id
                            },
                            hallId: player.hall.id,
                            groupHallId: groupHall[0].id,
                            remark: "Purchased " + ticketData.ticketId + " Ticket", //remark on transaction
                            createdAt: Date.now(),
                            isBotGame: ((game.otherData && game.otherData.isBotGame && game.otherData.isBotGame == true) || game.isBotGame) ? true : false
                        }

                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);

                    } else if (data.purchasedSlug == "realMoney") {

                        let currentPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: -data.totalAmount, monthlyWalletAmountLimit: -data.totalAmount } }); //, optSession

                        let ticketData = await Sys.Game.Common.Services.GameServices.getSingleTicketData({ _id: data.ticketId });

                        if (game.gameType == 'game_2') {
                            if (ticketData.isPurchased == true) {
                                //console.log("tickets already purchased 1",data.ticketId, currentPlayer._id )
                                return false;
                            } else {
                                //console.log("tickets already purchased 2",data.ticketId, currentPlayer._id )
                                // let updated = {
                                //     isPurchased: true,
                                //     playerIdOfPurchaser: await Sys.Helper.bingo.obId(currentPlayer._id),
                                // }
                                // await Sys.Game.Game2.Services.GameServices.updateTicket({ _id: ticketData._id }, updated);

                                let pId = await Sys.Helper.bingo.obId(currentPlayer._id);
                                let updatedTicket = await Sys.Game.Game2.Services.GameServices.updateSingleTicket({
                                    _id: ticketData._id,
                                    isPurchased: false
                                }, {
                                    isPurchased: true,
                                    playerIdOfPurchaser: pId,
                                    userType: userType,
                                    uniquePlayerId: (userType == "Online") ? '' : player.uniqueId,
                                    ticketPurchasedFrom: data.purchasedSlug,
                                    isAgentTicket: (player.userType == "Unique" && player.isCreatedByAdmin == false) ? true : false,
                                    agentId: player.agentId,
                                    hallName: player.groupHall.hallName,
                                    groupHallName: player.groupHall.name,
                                    createdAt: new Date()
                                }, {new: true});
                                console.log("--updatedTicket in autoTickets---", updatedTicket)
                                if (updatedTicket == null) {
                                    return false;
                                }
                            }
                        }


                        let transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentPlayer._id,
                            playerName: currentPlayer.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            gameMode: game.gameMode,
                            differenceAmount: data.totalAmount,
                            ticketPrice: game.ticketPrice,
                            ticketId: ticketData._id,
                            ticketNumber: ticketData.ticketId,
                            variantGame: (data.variantGame) ? data.variantGame : "",
                            ticketColorType: (data.ticketColorType) ? data.ticketColorType : "",
                            defineSlug: "autoTicket",
                            category: "debit",
                            status: "success",
                            amtCategory: "realMoney",
                            previousBalance: currentPlayer.walletAmount + data.totalAmount,
                            afterBalance: currentPlayer.walletAmount,
                            hall: {
                                name: player.groupHall.hallName
                            },
                            groupHall: {
                                name: player.groupHall.name,
                                id: player.groupHall.id
                            },
                            hallId: player.hall.id,
                            groupHallId: groupHall[0].id,
                            remark: "Purchased " + ticketData.ticketId + " Ticket", //remark on transaction
                            createdAt: Date.now(),
                        }

                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);

                    }

                } else {
                    console.log("This (" + data.action + ") in Auto Ticket Detail Not Found.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        gameId: data.gameId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") in Auto Ticket Detail Not Found.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ") in Auto Ticket Detail Not Found." };
                }
            } else if (slug == "cancelTicket") { // cancel for all games
                //  console.log("cancelTicket action :", data.action);
                if (data.action == "credit") {

                    if (data.purchasedSlug == "points") {

                        let currentUser = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: data.totalAmount } }); //, optSession

                        let ticketData = await Sys.Game.Common.Services.GameServices.getSingleTicketData({ _id: data.ticketId });

                        let Vid = await Sys.Helper.bingo.obId(data.voucherId);
                        let voucher = await Sys.App.Services.VoucherServices.getSingle({ _id: Vid });

                        if (game.gameType != "game_1") {
                            let one = await Sys.Game.Game2.Services.GameServices.updateSingleTicket({ _id: ticketData._id }, {
                                $set: {
                                    isPurchased: false,
                                    playerIdOfPurchaser: game.gameType !== "game_4" ? ticketData.playerIdOfPurchaser : '',
                                    playerNameOfPurchaser: '',
                                    userType: "Online",
                                    uniquePlayerId: "",
                                    ticketPurchasedFrom: "",
                                    hallName: "",
                                    groupHallName: "",
                                    hallId: "",
                                    groupHallId: "",
                                    isAgentTicket: false,
                                    agentId: ""
                                }
                            }, {new: true});
                            console.log("one", one);
                        }


                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentUser._id,
                            playerName: currentUser.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            ticketPrice: (game.gameType == "game_1") ? data.totalAmount : game.ticketPrice,
                            gameMode: game.gameMode,
                            differenceAmount: data.totalAmount,
                            ticketId: ticketData._id,
                            ticketNumber: ticketData.ticketId,
                            variantGame: (data.variantGame) ? data.variantGame : "",
                            ticketColorType: (data.ticketColorType) ? data.ticketColorType : "",
                            voucherId: (data.voucherId) ? voucher._id : "",
                            voucherCode: (data.voucherId) ? data.voucherCode : "",
                            voucherAmount: (data.voucherId) ? voucher.points : "",
                            isVoucherUse: (data.voucherId) ? true : false,
                            isVoucherApplied: (data.voucherId) ? true : false,
                            defineSlug: "cancelTicket",
                            category: "credit",
                            status: "success",
                            amtCategory: "points",
                            previousBalance: currentUser.points - data.totalAmount,
                            afterBalance: currentUser.points,
                            hall: {
                                name: player.hall.name,
                                id: player.hall.id,
                            },
                            groupHall: {
                                name: groupHall[0].name,
                                id: groupHall[0].id
                            },
                            hallId: player.hall.id,
                            groupHallId: groupHall[0].id,
                            typeOfTransactionTotalAmount: data.totalAmount,
                            remark: "Cancel Purchased " + ticketData.ticketId + " Tickets", //remark on transaction
                            typeOfTransaction: "Cancel Tickets",
                            userType: userType,
                            createdAt: Date.now(),
                            isBotGame: ((game.otherData && game.otherData.isBotGame && game.otherData.isBotGame == true) || game.isBotGame) ? true : false
                        }

                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);

                    } else if (data.purchasedSlug == "realMoney") {

                        var currentPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: data.totalAmount, monthlyWalletAmountLimit: data.totalAmount } }); //, optSession

                        var ticketData = await Sys.Game.Common.Services.GameServices.getSingleTicketData({ _id: data.ticketId });

                        let Vid
                        let voucher
                        if (data.voucherId) {
                            Vid = await Sys.Helper.bingo.obId(data.voucherId);
                            voucher = await Sys.App.Services.VoucherServices.getSingle({ _id: Vid });
                        }

                        // if (game.gameType == 'game_2') {
                        //     if (ticketData.isPurchased == true) {
                        //         await Sys.Game.Game2.Services.GameServices.updateTicket({ _id: ticketData._id }, {
                        //             $set: {
                        //                 isPurchased: false,
                        //                 playerIdOfPurchaser: '',
                        //             }
                        //         });
                        //     } else {
                        //         return false;
                        //     }
                        // }
                        if (game.gameType != "game_1") {
                            let one = await Sys.Game.Game2.Services.GameServices.updateSingleTicket({ _id: ticketData._id }, {
                                $set: {
                                    isPurchased: false,
                                    playerIdOfPurchaser: game.gameType !== "game_4" ? ticketData.playerIdOfPurchaser : '',
                                    playerNameOfPurchaser: '',
                                    userType: "Online",
                                    uniquePlayerId: "",
                                    ticketPurchasedFrom: "",
                                    hallName: "",
                                    groupHallName: "",
                                    hallId: "",
                                    groupHallId: "",
                                    isAgentTicket: false,
                                    agentId: ""
                                }
                            }, {new: true});
                            console.log("one realmoney", one);
                        }


                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentPlayer._id,
                            playerName: currentPlayer.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            ticketPrice: (game.gameType == "game_1") ? data.totalAmount : game.ticketPrice,
                            ticketId: ticketData._id,
                            ticketNumber: ticketData.ticketId,
                            differenceAmount: data.totalAmount,
                            variantGame: (data.variantGame) ? data.variantGame : "",
                            ticketColorType: (data.ticketColorType) ? data.ticketColorType : "",
                            voucherId: (data.voucherId) ? voucher._id : "",
                            voucherCode: (data.voucherId) ? data.voucherCode : "",
                            voucherAmount: (data.voucherId) ? voucher.points : "",
                            isVoucherUse: (data.voucherId) ? true : false,
                            isVoucherApplied: (data.voucherId) ? true : false,
                            defineSlug: "cancelTicket",
                            category: "credit",
                            status: "success",
                            amtCategory: "realMoney",
                            previousBalance: currentPlayer.walletAmount - data.totalAmount,
                            afterBalance: currentPlayer.walletAmount,
                            hall: {
                                name: player.hall.name,
                                id: player.hall.id
                            },
                            groupHall: {
                                name: groupHall[0].name,
                                id: groupHall[0].id
                            },
                            hallId: player.hall.id,
                            groupHallId: groupHall[0].id,
                            typeOfTransactionTotalAmount: data.totalAmount,
                            remark: "Cancel Purchased " + ticketData.ticketId + " Tickets", //remark on transaction
                            typeOfTransaction: "Cancel Tickets",
                            userType: userType,
                            createdAt: Date.now(),
                            isBotGame: ((game.otherData && game.otherData.isBotGame && game.otherData.isBotGame == true) || game.isBotGame) ? true : false
                        }

                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);

                    }

                } else {
                    console.log("This (" + data.action + ") in Cancel Ticket Detail Not Found.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        gameId: data.gameId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") in Cancel Ticket Detail Not Found.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ") in Cancel Ticket Detail Not Found." };
                }
            } else if (slug == "winJackpot") { // Game 2 
                //  console.log("winJackpot action :", data.action);
                console.log("winJackpot slug called for game 2")
                if (data.action == "credit") {

                    if (data.purchasedSlug == "realMoney") {

                        // await Sys.Game.Game2.Services.PlayerServices.updateGameWininng(game._id, data.playerId, {
                        //     $inc: { 'statisticsgame2.totalGamesWin': 1, 'statisticsgame2.totalWinning': data.totalAmount }
                        // });
                        await Sys.Game.Game2.Services.PlayerServices.updateGameWininng(game._id, data.playerId, {
                            $inc: { 'statisticsgame2.totalGamesWin': 1 }
                        });
                        Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer(data.playerId, {
                            $inc: { 'statisticsgame2.totalWinning': data.totalAmount }
                        });

                        await Sys.Game.Game2.Services.GameServices.updateSingleGame({ _id: game._id, "players.id": data.playerId }, {
                            $set: {
                                "players.$.isLossAndWon": true
                            }
                        });

                        var currentPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: data.totalAmount } }); //optSession

                        var ticketData = await Sys.Game.Common.Services.GameServices.getSingleTicketData({ _id: data.ticketId });


                        let txHall=  {
                            name: player.hall.name,
                            id: player.hall.id
                        }
                        let txGroupHall= {
                            name: groupHall[0]?.name,
                            id: groupHall[0]?.id
                        }
                        let txHallId= player.hall.id;
                        let txGroupHallId= groupHall[0]?.id;
                        if ('hallId' in data && 'hallName' in data && 'groupHallName' in data && 'groupHallId' in data ) { 
                            txHall=  {
                                name: data.hallName,
                                id: data.hallId
                            }
                            txGroupHall= {
                                name: data.groupHallName,
                                id: data.groupHallId
                            }
                            txHallId= data.hallId;
                            txGroupHallId= data.groupHallId;
                        }

                        
                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentPlayer._id,
                            playerName: currentPlayer.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            ticketPrice: game.ticketPrice,
                            gameMode: game.gameMode,
                            ticketId: ticketData._id,
                            ticketNumber: ticketData.ticketId,
                            variantGame: (data.variantGame) ? data.variantGame : "",
                            ticketColorType: (data.ticketColorType) ? data.ticketColorType : "",
                            defineSlug: "winJackpot",
                            category: "credit",
                            status: "success",
                            amtCategory: "realMoney",
                            winningPrice: data.winningPrice,
                            previousBalance: currentPlayer.walletAmount - data.totalAmount,
                            afterBalance: currentPlayer.walletAmount,
                            winningJackpotNumber: data.totalWithdrawCount,
                            remark: "Win JackPot Prize on this number " + data.totalWithdrawCount + " in Ticket", //remark on transaction
                            userType: userType,
                            createdAt: Date.now(),
                            // hall: {
                            //     name: player.hall.name,
                            //     id: player.hall.id
                            // },
                            // groupHall: {
                            //     name: groupHall[0].name,
                            //     id: groupHall[0].id
                            // },
                            // hallId: player.hall.id,
                            // groupHallId: groupHall[0].id,
                            hall: txHall,
                            groupHall: txGroupHall,
                            hallId: txHallId,
                            groupHallId: txGroupHallId,
                            typeOfTransaction: "Game Won Price",
                            typeOfTransactionTotalAmount: data.totalAmount,
                            percentWin: data.percentWin,
                            isBotGame: ((game.otherData && game.otherData.isBotGame && game.otherData.isBotGame == true) || game.isBotGame) ? true : false,
                            "otherData.exactGameStartTime": new Date(game.startDate),
                        }

                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);

                    }

                } else {
                    console.log("This (" + data.action + ") in Win Jackpot Detail Not Found.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        gameId: data.gameId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") in Win Jackpot Detail Not Found.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ") in Win Jackpot Detail Not Found." };
                }
            } else if (slug == "luckyPrize") { // For Game 2 and Game 3
                //console.log("luckyPrize action :", data.action);
                if (data.action == "credit") {

                    if (data.purchasedSlug == "realMoney") {

                        if (game.gameType == 'game_2') {
                            //Extra 100kr win
                            var currentUser = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: data.krValue } }); //, optSession
                            await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer({ _id: data.playerId }, {
                                $inc: { 'statisticsgame2.totalWinning': data.totalAmount } // + data.krValue
                            })
                            //, 'statisticsgame2.totalGamesWin': 1
                        } else {
                            await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer({ _id: data.playerId }, {
                                $inc: { 'statisticsgame3.totalWinning': data.totalAmount }
                            })
                            //, 'statisticsgame3.totalGamesWin': 1
                        }


                        var currentPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: data.totalAmount } }); //, optSession

                        var ticketData = await Sys.Game.Common.Services.GameServices.getSingleTicketData({ _id: data.ticketId });
                        
                        let txHall=  {
                            name: player.hall.name,
                            id: player.hall.id
                        }
                        let txGroupHall= {
                            name: groupHall[0]?.name,
                            id: groupHall[0]?.id
                        }
                        let txHallId= player.hall.id;
                        let txGroupHallId= groupHall[0]?.id;
                        if ('hallId' in data && 'hallName' in data && 'groupHallName' in data && 'groupHallId' in data ) { 
                            txHall=  {
                                name: data.hallName,
                                id: data.hallId
                            }
                            txGroupHall= {
                                name: data.groupHallName,
                                id: data.groupHallId
                            }
                            txHallId= data.hallId;
                            txGroupHallId= data.groupHallId;
                        }

                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentPlayer._id,
                            playerName: currentPlayer.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            ticketPrice: game.ticketPrice,
                            gameMode: game.gameMode,
                            ticketId: ticketData._id,
                            ticketNumber: ticketData.ticketId,
                            variantGame: (data.variantGame) ? data.variantGame : "",
                            ticketColorType: (data.ticketColorType) ? data.ticketColorType : "",
                            defineSlug: "luckyPrize",
                            category: "credit",
                            status: "success",
                            amtCategory: "realMoney",
                            winningPrice: data.totalAmount, //(game.gameType == 'game_2') ? data.totalAmount + data.krValue : data.totalAmount, =>>Commented in martin bingo.
                            previousBalance: (game.gameType == 'game_2') ? currentUser.walletAmount - data.totalAmount + data.krValue : currentPlayer.walletAmount - data.totalAmount,
                            afterBalance: currentPlayer.walletAmount,
                            winningJackpotNumber: data.lastBall,
                            remark: "Win Lucky number Prize on this number " + data.lastBall + " in Ticket..!! And Get 100kr Extra", //remark on transaction
                            createdAt: Date.now(),
                            // hall: {
                            //     name: player.hall.name,
                            //     id: player.hall.id
                            // },
                            // groupHall: {
                            //     name: groupHall[0].name,
                            //     id: groupHall[0].id
                            // },
                            // hallId: player.hall.id,
                            // groupHallId: groupHall[0].id,
                            hall: txHall,
                            groupHall: txGroupHall,
                            hallId: txHallId,
                            groupHallId: txGroupHallId,
                            typeOfTransaction: "Lucky Number Price.",
                            typeOfTransactionTotalAmount: data.totalAmount,
                            userType: userType,
                            isBotGame: ((game.otherData && game.otherData.isBotGame && game.otherData.isBotGame == true) || game.isBotGame) ? true : false,
                            "otherData.exactGameStartTime": new Date(game.startDate),
                        }

                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);

                    }

                } else {
                    console.log("This (" + data.action + ") in lucky prize Detail Not Found.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        gameId: data.gameId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ")  in lucky prize Detail Not Found.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ") in lucky prize Detail Not Found." };
                }
            } else if (slug == "refund") { // refund for all games
                //   console.log("refund action :", data.action);
                if (data.action == "credit") {
                    if (data.purchasedSlug == "points") {

                        var currentUser = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: data.totalAmount } }); //, optSession

                        var ticketData = await Sys.Game.Common.Services.GameServices.getSingleTicketData({ _id: data.ticketId });

                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentUser._id,
                            playerName: currentUser.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            ticketPrice: game.ticketPrice,
                            gameMode: game.gameMode,
                            differenceAmount: data.totalAmount,
                            ticketId: ticketData._id,
                            ticketNumber: ticketData.ticketId,
                            variantGame: (data.variantGame) ? data.variantGame : "",
                            ticketColorType: (data.ticketColorType) ? data.ticketColorType : "",
                            defineSlug: "refund",
                            category: "credit",
                            status: "success",
                            amtCategory: "points",
                            previousBalance: currentUser.points - data.totalAmount,
                            afterBalance: currentUser.points,
                            remark: "Get Refund on Purchased " + ticketData.ticketId + " Tickets", //remark on transaction
                            hall: {
                                name: player.hall.name,
                                id: player.hall.id
                            },
                            groupHall: {
                                name: groupHall[0].name,
                                id: groupHall[0].id
                            },
                            hallId: player.hall.id,
                            groupHallId: groupHall[0].id,
                            typeOfTransactionTotalAmount: data.totalAmount,
                            typeOfTransaction: "Refund",
                            createdAt: Date.now(),
                            isBotGame: ((game.otherData && game.otherData.isBotGame && game.otherData.isBotGame == true) || game.isBotGame) ? true : false
                        }

                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);

                    } else if (data.purchasedSlug == "realMoney") {

                        var currentPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: data.totalAmount, monthlyWalletAmountLimit: data.totalAmount } }); //, optSession

                        var ticketData = await Sys.Game.Common.Services.GameServices.getSingleTicketData({ _id: data.ticketId });

                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentPlayer._id,
                            playerName: currentPlayer.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            differenceAmount: data.totalAmount,
                            ticketPrice: game.ticketPrice,
                            ticketId: ticketData._id,
                            ticketNumber: ticketData.ticketId,
                            variantGame: (data.variantGame) ? data.variantGame : "",
                            ticketColorType: (data.ticketColorType) ? data.ticketColorType : "",
                            defineSlug: "refund",
                            category: "credit",
                            status: "success",
                            amtCategory: "realMoney",
                            previousBalance: currentPlayer.walletAmount - data.totalAmount,
                            afterBalance: currentPlayer.walletAmount,
                            hall: {
                                name: player?.hall?.name,
                                id: player.hall.id
                            },
                            groupHall: {
                                name: groupHall?.[0]?.name || null,
                                id: groupHall?.[0]?.id || null
                            },
                            hallId: player?.hall?.id,
                            groupHallId: groupHall?.[0]?.id || null,
                            typeOfTransactionTotalAmount: data.totalAmount,
                            remark: "Get Refund on Purchased " + ticketData.ticketId + " Tickets", //remark on transaction
                            typeOfTransaction: "Refund",
                            createdAt: Date.now(),
                            isBotGame: ((game.otherData && game.otherData.isBotGame && game.otherData.isBotGame == true) || game.isBotGame) ? true : false
                        }
                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                    }
                } else {
                    console.log("This (" + data.action + ") in Refund action Detail Not Found.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        gameId: data.gameId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") in Refund action Detail Not Found.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ") in Refund action Detail Not Found." };
                }
            } else if (slug == "patternPrize") { //For Game 3
                //     console.log("pattern prize action:", data.action);
                if (data.action == "credit") {

                    if (data.purchasedSlug == "realMoney") {

                        const currentGame = game; // await Sys.Game.Common.Services.GameServices.getSingleGameData({ _id: game._id });

                        //Winning will be distributed from this amount if game winningType is Percent
                        const currentPool = Math.round(Number(currentGame.totalNoPurchasedTickets) * Number(currentGame.ticketPrice));

                        let PercentWin = false;
                        console.log('data.count: ', data.count);

                        //console.log("patternWinnerArray", data.patternWinnerArray);

                        // let cnt = Number(data.count) - 1; // [ Manual Winner ]
                        let cnt = Number(data.count); // [ Automatic Winner ]
                        let dataPatternList = currentGame.allPatternArray.flat() //currentGame.currentPatternList;
                        // let PatternListData = dataPatternList.filter(obj => obj.patternName == data.patternName);
                        let PatternListData = dataPatternList.filter(obj => obj.patternId == data.patternId);
                        // let filterSamePatternWon = data.patternWinnerArray.filter(obj => Number(obj.count) == cnt).length;
                        //console.log("PatternListData: ", PatternListData);

                        let CheckPrize = (PatternListData.length && PatternListData[0] && PatternListData[0].prize != undefined) ? PatternListData[0].prize : 0;

                        if (currentGame.winningType == 'percent' && CheckPrize > 0) {
                            CheckPrize = Math.round((Number(CheckPrize) * currentPool) / 100);
                            PercentWin = true
                        }


                        if (PatternListData[0].prize1 != undefined) {
                            CheckPrize = Math.round(Number(PatternListData[0].prize)); //This Price always will be cash (Full  House Jackpot Price)
                            PercentWin = false
                            if (cnt > PatternListData[0].ballNumber) {
                                CheckPrize = PatternListData[0].prize1;
                                if (currentGame.winningType == 'percent' && CheckPrize > 0) {
                                    CheckPrize = Math.round((Number(CheckPrize) * currentPool) / 100);
                                    PercentWin = true
                                }
                            }
                        }

                        let patternPrice = Math.round(Number(CheckPrize)); // KR rounding;
                        console.log("patternPrice", patternPrice);
                        // let newPrize = patternPrice / filterSamePatternWon;
                        let newPrize = Math.round(Number(patternPrice) / data.patternWinnerArray.length);
                        // let newPrize = patternPrice / PatternListData.length;
                        console.log("newPrize:-,", newPrize);

                        if (patternPrice != null) {
                            if (patternPrice > 0) {
                                const currentPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: newPrize } }); //, optSession

                                const ticketData = await Sys.Game.Common.Services.GameServices.getSingleTicketData({ _id: data.ticketId });

                                //let tpatternPrice = (newPrize == 0) ? '' : newPrize;

                                await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer({ _id: data.playerId }, {
                                    $inc: { 'statisticsgame3.totalWinning': Number(newPrize) }
                                });

                                // [ This Ticket Pattern Achive multiple pattern so this is now pattern is prize slipt ]
                                await Sys.Game.Game3.Services.GameServices.updateSingleGame({_id: game._id, "patternWinnerHistory.ticketId": data.ticketId}, {
                                    $set: {
                                        "patternWinnerHistory.$.patternPrize": Number(newPrize)
                                    }
                                });

                                let txHall=  {
                                    name: player.hall.name,
                                    id: player.hall.id
                                }
                                let txGroupHall= {
                                    name: groupHall[0]?.name,
                                    id: groupHall[0]?.id
                                }
                                let txHallId= player.hall.id;
                                let txGroupHallId= groupHall[0]?.id;
                                if ('hallId' in data && 'hallName' in data && 'groupHallName' in data && 'groupHallId' in data ) { 
                                    txHall=  {
                                        name: data.hallName,
                                        id: data.hallId
                                    }
                                    txGroupHall= {
                                        name: data.groupHallName,
                                        id: data.groupHallId
                                    }
                                    txHallId= data.hallId;
                                    txGroupHallId= data.groupHallId;
                                }

                                const transactionPointData = {
                                    transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                                    playerId: currentPlayer._id,
                                    playerName: currentPlayer.username,
                                    gameId: game._id,
                                    gameNumber: game.gameNumber,
                                    gameName: game.gameName,
                                    gameType: game.gameType,
                                    gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                                    ticketPrice: game.ticketPrice,
                                    gameMode: game.gameMode,
                                    ticketId: ticketData._id,
                                    ticketNumber: ticketData.ticketId,
                                    patternId: PatternListData[0]._id,
                                    patternName: PatternListData[0].patternName,
                                    variantGame: (data.variantGame) ? data.variantGame : "",
                                    ticketColorType: (data.ticketColorType) ? data.ticketColorType : "",
                                    defineSlug: "patternPrize",
                                    category: "credit",
                                    status: "success",
                                    amtCategory: "realMoney",
                                    previousBalance: currentPlayer.walletAmount - newPrize,
                                    winningPrice: newPrize,
                                    afterBalance: currentPlayer.walletAmount,
                                    hall: txHall,
                                    groupHall: txGroupHall,
                                    hallId: txHallId,
                                    groupHallId: txGroupHallId,
                                    // hall: {
                                    //     name: player.hall.name,
                                    //     id: player.hall.id
                                    // },
                                    // groupHall: {
                                    //     name: groupHall[0].name,
                                    //     id: groupHall[0].id
                                    // },
                                    // hallId: player.hall.id,
                                    // groupHallId: groupHall[0].id,
                                    remark: "Win Pattern Prize" + ticketData.ticketId + " Tickets", //remark on transaction
                                    typeOfTransactionTotalAmount: newPrize,
                                    typeOfTransaction: "Pattern Price",
                                    createdAt: Date.now(),
                                    userType: userType,
                                    percentWin: PercentWin,
                                    isBotGame: ((game.otherData && game.otherData.isBotGame && game.otherData.isBotGame == true) || game.isBotGame) ? true : false,
                                    "otherData.exactGameStartTime": new Date(game.startDate),
                                }

                                await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);

                                //Unnecessary : Commeted on Jul 19,2023.
                                // var newExtraTransaction = {
                                //     transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                                //     playerId: currentPlayer._id,
                                //     defineSlug: "extraTransaction",
                                //     typeOfTransaction: "Pattern Prize",
                                //     category: "credit",
                                //     status: "success",
                                //     typeOfTransactionTotalAmount: newPrize, //patternPrice,
                                //     amtCategory: "realMoney",
                                //     createdAt: Date.now(),
                                //     userType: userType
                                // }
                                // await Sys.Game.Common.Services.PlayerServices.createTransaction(newExtraTransaction);
                                return [{ patternId: PatternListData[0]._id, patternName: PatternListData[0].patternName, winningPrice: newPrize, isFullHouse: data.isFullHouse, playerId: currentPlayer._id.toString() }];
                            } else {
                                return true;
                            }
                        }


                    }
                } else {
                    console.log("This (" + data.action + ") not found in Pattern Prize Detail.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        gameId: data.gameId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") not found in Pattern Prize Detail.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ") not found in Pattern Prize Detail." };
                }
            } else if (slug == "patternPrizeGame4") { // For Game 4
                if (data.action == "credit") {
                    if (data.purchasedSlug == "realMoney") {

                        let patternPrize = Number(data.patternPrize) * Number(data.multiplierValue);

                        var currentPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(data.playerId, { $inc: { walletAmount: patternPrize } }); //, optSession

                        var ticketData = await Sys.Game.Common.Services.GameServices.getSingleTicketData({ _id: data.ticketId });

                        await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer({ _id: data.playerId }, {
                            $inc: { 'statisticsgame4.totalWinning': patternPrize, 'statisticsgame4.totalGamesWin': 1 }
                        });

                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentPlayer._id,
                            playerName: currentPlayer.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            ticketPrice: game.ticketPrice,
                            ticketId: ticketData._id,
                            ticketNumber: ticketData.ticketId,
                            patternId: data.patternId,
                            patternName: data.patternName,
                            gameMode: game.gameMode,
                            variantGame: (data.variantGame) ? data.variantGame : "",
                            ticketColorType: (data.ticketColorType) ? data.ticketColorType : "",
                            defineSlug: "patternPrizeGame4",
                            category: "credit",
                            status: "success",
                            amtCategory: "realMoney",
                            previousBalance: currentPlayer.walletAmount - patternPrize,
                            winningPrice: patternPrize,
                            afterBalance: currentPlayer.walletAmount,
                            typeOfTransactionTotalAmount: patternPrize,
                            typeOfTransaction: "Pattern Price",
                            remark: "Win Pattern Prize" + ticketData.ticketId + " Tickets with multiplierValue" + data.multiplierValue, //remark on transaction
                            createdAt: Date.now(),
                            userType: userType,
                            hall: {
                                name: player.hall.name,
                                id: player.hall.id
                            },
                            groupHall: {
                                name: game.groupHalls[0].name,
                                id: game.groupHalls[0].id
                            },
                            hallId: player.hall.id,
                            groupHallId: game.groupHalls[0].id,
                            isBotGame: ((game.otherData && game.otherData.isBotGame && game.otherData.isBotGame == true) || game.isBotGame) ? true : false
                        }

                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                        return [{ patternId: data.patternId, patternName: data.patternName, winningPrice: patternPrize }];
                    }
                } else {
                    console.log("This (" + data.action + ") not found in Game 4  Pattern Prize Detail.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        gameId: data.gameId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") not found in Pattern Prize Detail.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ") not found in Game 4 Pattern Prize Detail." };
                }
            } else if (slug == "treasureChest") { // game4 mini game
                if (data.action == "credit") {
                    if (data.purchasedSlug == "points") {
                        let currentUser = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: data.totalAmount } }); //, optSession
                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentUser._id,
                            playerName: currentUser.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            ticketPrice: game.ticketPrice,
                            gameMode: game.gameMode,
                            ticketNumber: "",
                            defineSlug: "treasureChest",
                            category: "credit",
                            status: "success",
                            amtCategory: "points",
                            previousBalance: currentUser.points - data.totalAmount,
                            winningPrice: data.totalAmount,
                            typeOfTransactionTotalAmount: data.totalAmount,
                            afterBalance: currentUser.points,
                            remark: "Win Prize " + data.totalAmount + " in Mini Game Treasure Chest", //remark on transaction
                            createdAt: Date.now(),
                        }
                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);

                    } else if (data.purchasedSlug == "realMoney") {
                        let currentUser = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: data.totalAmount } }); //, optSession
                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentUser._id,
                            playerName: currentUser.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            ticketPrice: game.ticketPrice,
                            gameMode: game.gameMode,
                            ticketNumber: "",
                            defineSlug: "treasureChest",
                            category: "credit",
                            status: "success",
                            amtCategory: "realMoney",
                            previousBalance: currentUser.walletAmount - data.totalAmount,
                            winningPrice: data.totalAmount,
                            afterBalance: currentUser.walletAmount,
                            remark: "Win Prize " + data.totalAmount + " in Mini Game Treasure Chest", //remark on transaction
                            createdAt: Date.now(),
                            hall: {
                                name: player.hall.name,
                                id: player.hall.id
                            },
                            groupHall: {
                                name: game.groupHalls[0].name,
                                id: game.groupHalls[0].id
                            },
                            hallId: player.hall.id,
                            groupHallId: game.groupHalls[0].id,
                        }
                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                        await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer({ _id: currentUser._id }, {
                            $inc: { 'statisticsgame4.totalWinning': data.totalAmount }
                        });
                    }
                } else {
                    console.log("This (" + data.action + ") not found in Mini Game Treasure Chest Detail.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") not found in Mini Game Treasure Chest Detail.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ")not found in Mini Game Treasure Chest Detail." };
                }
            } else if (slug == "mystery") { // game4 mini game
                if (data.action == "credit") {
                    if (data.purchasedSlug == "points") {
                        let currentUser = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: data.totalAmount } }); //, optSession
                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentUser._id,
                            playerName: currentUser.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            ticketPrice: game.ticketPrice,
                            gameMode: game.gameMode,
                            ticketNumber: "",
                            defineSlug: "mystery",
                            category: "credit",
                            status: "success",
                            amtCategory: "points",
                            previousBalance: currentUser.points - data.totalAmount,
                            winningPrice: data.totalAmount,
                            afterBalance: currentUser.points,
                            typeOfTransactionTotalAmount: data.totalAmount,
                            remark: "Win Prize " + data.totalAmount + " in Mini Game Mystery Game", //remark on transaction
                            createdAt: Date.now(),
                        }
                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                    } else if (data.purchasedSlug == "realMoney") {
                        let currentUser = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: data.totalAmount } }); //, optSession
                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentUser._id,
                            playerName: currentUser.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            ticketPrice: game.ticketPrice,
                            gameMode: game.gameMode,
                            ticketNumber: "",
                            defineSlug: "mystery",
                            category: "credit",
                            status: "success",
                            amtCategory: "realMoney",
                            previousBalance: currentUser.walletAmount - data.totalAmount,
                            winningPrice: data.totalAmount,
                            afterBalance: currentUser.walletAmount,
                            remark: "Win Prize " + data.totalAmount + " in Mini Game Mystery Game", //remark on transaction
                            createdAt: Date.now(),
                            hall: {
                                name: player.hall.name,
                                id: player.hall.id
                            },
                            groupHall: {
                                name: game.groupHalls[0].name,
                                id: game.groupHalls[0].id
                            },
                            hallId: player.hall.id,
                            groupHallId: game.groupHalls[0].id,
                            isBotGame: ((game.otherData && game.otherData.isBotGame && game.otherData.isBotGame == true) || game.isBotGame) ? true : false
                        }
                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                        await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer({ _id: currentUser._id }, {
                            $inc: { 'statisticsgame4.totalWinning': data.totalAmount }
                        });
                    }
                } else {
                    console.log("This (" + data.action + ") not found in Mini Game Mystery Game Detail.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") not found in Mini Game Mystery Game Detail.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ")not found in Mini Game Mystery Game Detail." };
                }
            } else if (slug == "Spin") { // game4 mini game
                if (data.action == "credit") {
                    if (data.purchasedSlug == "points") {
                        let currentUser = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: data.totalAmount } }); //, optSession
                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentUser._id,
                            playerName: currentUser.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            ticketPrice: game.ticketPrice,
                            gameMode: game.gameMode,
                            ticketNumber: "",
                            defineSlug: "Spin",
                            category: "credit",
                            status: "success",
                            amtCategory: "points",
                            previousBalance: currentUser.points - data.totalAmount,
                            winningPrice: data.totalAmount,
                            afterBalance: currentUser.points,
                            typeOfTransactionTotalAmount: data.totalAmount,
                            remark: "Win Prize " + data.totalAmount + " in Mini Game Spin Game", //remark on transaction
                            createdAt: Date.now(),
                        }
                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                    } else if (data.purchasedSlug == "realMoney") {
                        let currentUser = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: data.totalAmount } }); //, optSession
                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentUser._id,
                            playerName: currentUser.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            ticketPrice: game.ticketPrice,
                            gameMode: game.gameMode,
                            ticketNumber: "",
                            defineSlug: "Spin",
                            category: "credit",
                            status: "success",
                            amtCategory: "realMoney",
                            previousBalance: currentUser.walletAmount - data.totalAmount,
                            winningPrice: data.totalAmount,
                            afterBalance: currentUser.walletAmount,
                            remark: "Win Prize " + data.totalAmount + " in Mini Game Spin Game", //remark on transaction
                            createdAt: Date.now(),
                            hall: {
                                name: player.hall.name,
                                id: player.hall.id
                            },
                            groupHall: {
                                name: game.groupHalls[0].name,
                                id: game.groupHalls[0].id
                            },
                            hallId: player.hall.id,
                            groupHallId: game.groupHalls[0].id,
                        }
                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                        await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer({ _id: currentUser._id }, {
                            $inc: { 'statisticsgame4.totalWinning': data.totalAmount }
                        });
                    }
                } else {
                    console.log("This (" + data.action + ") not found in Mini Game Spin Game Detail.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") not found in Mini Game Spin Game Detail.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ")not found in Mini Game Spin Game Detail." };
                }
            } else if (slug == "voucher") {
                if (data.action == "debit") {
                    if (data.purchasedSlug == "points") {

                        let currentUser = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: -data.totalAmount } }); //, optSession

                        let voucher = await Sys.App.Services.VoucherServices.getById(data.voucherId);

                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentUser._id,
                            playerName: currentUser.username,
                            voucherId: voucher._id,
                            voucherCode: data.voucherCode,
                            voucherAmount: voucher.points,
                            differenceAmount: data.totalAmount,
                            defineSlug: "voucher",
                            category: "debit",
                            status: "success",
                            amtCategory: "points",
                            previousBalance: currentUser.points + data.totalAmount,
                            afterBalance: currentUser.points,
                            remark: "Purchased This Voucher in " + data.totalAmount, //remark on transaction
                            createdAt: Date.now(),
                        }
                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                    }
                } else {
                    console.log("This (" + data.action + ") not found in voucher detail.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") not found in voucher detail.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ") not found in voucher detail.." };
                }
            } else if (slug == "loyalty") {
                if (data.action == "credit") {
                    if (data.purchasedSlug == "points") {

                        let currentUser = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: data.totalAmount, loyaltyPoints: data.totalAmount } }); //, optSession
                        console.log("currentUser", currentUser.username);
                        let loyalty = await Sys.App.Services.LoyaltyService.getLoyaltyById(data.loyaltyId);

                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentUser._id,
                            playerName: currentUser.username,
                            loyaltyId: loyalty._id,
                            loyaltyAmount: loyalty.points,
                            differenceAmount: data.totalAmount,
                            defineSlug: "loyalty",
                            category: "credit",
                            status: "success",
                            amtCategory: "points",
                            previousBalance: currentUser.points - data.totalAmount,
                            afterBalance: currentUser.points,
                            remark: "Get Loyalty " + data.totalAmount + " on " + loyalty.name, //remark on transaction
                            typeOfTransaction: "Loyalty Price.",
                            createdAt: Date.now(),
                        }
                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                    }
                } else {
                    console.log("This (" + data.action + ") not found in loyalty detail.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") not found in loyalty detail.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ") not found in loyalty detail.." };
                }
            } else if (slug == "leaderboard") {
                if (data.action == "credit") {
                    if (data.purchasedSlug == "points") {

                        let currentUser = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: data.totalAmount } }); //, optSession
                        console.log("currentUser", currentUser.username);
                        let leaderboard = await Sys.App.Services.LeaderboardServices.getById(data.leaderboardId);

                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentUser._id,
                            playerName: currentUser.username,
                            leaderboardId: leaderboard._id,
                            leaderboardAmount: leaderboard.points,
                            differenceAmount: data.totalAmount,
                            defineSlug: "leaderboard",
                            category: "credit",
                            status: "success",
                            amtCategory: "points",
                            previousBalance: currentUser.points - data.totalAmount,
                            afterBalance: currentUser.points,
                            remark: "Get leaderboard points" + data.totalAmount, //remark on transaction
                            typeOfTransaction: "Leaderboard Price",
                            createdAt: Date.now(),
                        }
                        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                    }
                } else {
                    console.log("This (" + data.action + ") not found in leaderboard detail.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") not found in leaderboard detail.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ") not found in leaderboard detail.." };
                }
            } else if (slug == "extraTransaction") {

                let txHall=  {
                    name: player.hall.name,
                    id: player.hall.id
                }
                let txGroupHall= (data.extraSlug != "Game4") ? {
                    name: groupHall[0]?.name,
                    id: groupHall[0]?.id
                } : {
                    name: game.groupHalls[0]?.name,
                    id: game.groupHalls[0]?.id
                }
                let txHallId= player.hall.id;
                let txGroupHallId= (data.extraSlug != "Game4") ? groupHall[0]?.id : '';
                if ('hallId' in data && 'hallName' in data && 'groupHallName' in data && 'groupHallId' in data ) { 
                    txHall=  {
                        name: data.hallName,
                        id: data.hallId
                    }
                    txGroupHall= {
                        name: data.groupHallName,
                        id: data.groupHallId
                    }
                    txHallId= data.hallId;
                    txGroupHallId= data.groupHallId;
                }

                var transactionPointData = {
                    transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                    playerId: player._id,
                    playerName: player.username,
                    defineSlug: "extraTransaction",
                    typeOfTransaction: data.typeOfTransaction,
                    gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                    gameId: game._id,
                    gameNumber: game.gameNumber,
                    gameType: game.gameType,
                    gameName: game.gameName,
                    category: data.action,
                    status: "success",
                    typeOfTransactionTotalAmount: data.totalAmount,
                    // hallId: player.hall.id,
                    // groupHallId: (data.extraSlug != "Game4") ? groupHall[0].id : '',
                    // hall: {
                    //     name: player.hall.name,
                    //     id: player.hall.id
                    // },
                    // groupHall: (data.extraSlug != "Game4") ? {
                    //     name: groupHall[0].name,
                    //     id: groupHall[0].id
                    // } : {
                    //     name: game.groupHalls[0].name,
                    //     id: game.groupHalls[0].id
                    // },
                    hall: txHall,
                    groupHall: txGroupHall,
                    hallId: txHallId,
                    groupHallId: txGroupHallId,
                    game1Slug: data?.game1Slug,
                    amtCategory: data.purchasedSlug,
                    userType: userType,
                    createdAt: Date.now(),
                    isBotGame: ((game.otherData && game.otherData.isBotGame && game.otherData.isBotGame == true) || game.isBotGame) ? true : false,
                    "otherData.exactGameStartTime": new Date(game.startDate),
                }
                await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
            } else if (slug == "patternPrizeGame1") { // For Game 4
                if (data.action == "credit") {
                    if (data.purchasedSlug == "realMoney") {
                        let updatedPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: data.patternPrize } })
                        //console.log("updated player in game 1 pattern winning", updatedPlayer)
                        if (updatedPlayer instanceof Error) {
                            console.log("Error in distributing game 1 winning amount", data.playerId, data.patternPrize);
                        } else {
                            
                            if (data.hasOwnProperty('isStatisticsgame1Counted') ) {
                                if(data.isStatisticsgame1Counted === false){
                                    await Sys.Game.Game1.Services.PlayerServices.update({ _id: data.playerId }, {
                                        $inc: { 'statisticsgame1.totalWinning': data.patternPrize, 'statisticsgame1.totalGamesWin': 1 }
                                    });
                                }else{
                                    await Sys.Game.Game1.Services.PlayerServices.update({ _id: data.playerId }, {
                                        $inc: { 'statisticsgame1.totalWinning': data.patternPrize }
                                    });
                                }
                            } else {
                                await Sys.Game.Game1.Services.PlayerServices.update({ _id: data.playerId }, {
                                    $inc: { 'statisticsgame1.totalWinning': data.patternPrize, 'statisticsgame1.totalGamesWin': 1 }
                                });
                            }

                            

                            let transactionPointData = {
                                transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                                playerId: data.playerId,
                                playerName: data.playerName,
                                gameId: data.gameId,
                                gameNumber: data.gameNumber,
                                gameName: game.gameName,
                                gameType: data.gameType,
                                gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                                ticketPrice: data.ticketPrice,
                                ticketId: data.ticketId,
                                ticketNumber: data.ticketNumber,
                                patternId: data.patternId,
                                patternName: data.patternName,
                                gameMode: data.gameMode,
                                variantGame: (data.variantGame) ? data.variantGame : "",
                                ticketColorType: data.ticketColorType,
                                defineSlug: "patternPrizeGame1",
                                category: "credit",
                                status: "success",
                                amtCategory: "realMoney",
                                previousBalance: data.previousBalance,
                                winningPrice: data.patternPrize,
                                typeOfTransactionTotalAmount: data.patternPrize,
                                afterBalance: updatedPlayer.walletAmount,
                                hall: {
                                    name: data.hall.name, //player.hall.name,
                                    id: data.hall.id //player.hall.id
                                },
                                groupHall: {
                                    name: data.groupHall.name, //groupHall[0].name,
                                    id: data.groupHall.id, //groupHall[0].id
                                },
                                hallId: data.hall.id, // player.hall.id,
                                groupHallId: data.groupHall.id, // groupHall[0].id,
                                remark: "Won Pattern prize", //remark on transaction
                                createdAt: Date.now(),
                                typeOfTransaction: "Pattern Prize",
                                "otherData.exactGameStartTime": new Date(game.startDate),
                            }

                            await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                        }
                    }
                } else {
                    console.log("This (" + data.action + ") not found in Game 1 Jackpot  Pattern Prize Detail.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        gameId: data.gameId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.patternPrize,
                        remark: "This (" + data.action + ") not found in jackpot Prize Game1 Pattern Prize Detail.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ") not found in Game 4 Pattern Prize Detail." };
                }
            } else if (slug == "jackpotPrizeGame1") { // For Game 4
                if (data.action == "credit") {
                    if (data.purchasedSlug == "realMoney") {
                        let updatedPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: data.patternPrize } })
                        //console.log("updated player in bonus", updatedPlayer)
                        if (updatedPlayer instanceof Error) {
                            console.log("Error in distributing bonus winning amount", data.playerId, data.patternPrize);
                        } else {
                            let transactionPointData = {
                                transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                                playerId: data.playerId,
                                playerName: data.playerName,
                                gameId: data.gameId,
                                gameNumber: data.gameNumber,
                                gameName: game.gameName,
                                gameType: data.gameType,
                                gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                                ticketPrice: data.ticketPrice,
                                ticketId: data.ticketId,
                                ticketNumber: data.ticketNumber,
                                patternId: data.patternId,
                                patternName: data.patternName,
                                gameMode: data.gameMode,
                                variantGame: (data.variantGame) ? data.variantGame : "",
                                ticketColorType: data.ticketColorType,
                                defineSlug: "jackpotPrizeGame1",
                                category: "credit",
                                status: "success",
                                amtCategory: "realMoney",
                                previousBalance: data.previousBalance,
                                winningPrice: data.patternPrize,
                                typeOfTransactionTotalAmount: data.patternPrize,
                                afterBalance: updatedPlayer.walletAmount,
                                hall: {
                                    name: player.hall.name,
                                    id: player.hall.id
                                },
                                groupHall: {
                                    name: groupHall[0].name,
                                    id: groupHall[0].id
                                },
                                hallId: player.hall.id,
                                groupHallId: groupHall[0].id,
                                remark: "Won Bonus", //remark on transaction
                                createdAt: Date.now(),
                                typeOfTransaction: "Jackpot Prize",
                                "otherData.exactGameStartTime": new Date(game.startDate),
                            }

                            if (data.patternPrize > 0) {
                                await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                                await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer({ _id: data.playerId }, {
                                    $inc: { 'statisticsgame1.totalWinning': data.patternPrize }
                                });
                            }

                        }
                    }
                } else {
                    console.log("This (" + data.action + ") not found in Game 1 Jackpot  Pattern Prize Detail.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        gameId: data.gameId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.patternPrize,
                        remark: "This (" + data.action + ") not found in jackpot Prize Game1 Pattern Prize Detail.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ") not found in Game 4 Pattern Prize Detail." };
                }
            } else if (slug == "WOFPrizeGame1") { // game4 mini game
                if (data.action == "credit") {
                    if (data.purchasedSlug == "realMoney") {
                        let currentUser
                        if (!data.userType) {
                            currentUser = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: data.totalAmount } }); //, optSession
                        }
                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: data.userType ? "Physical" : currentUser._id,
                            playerName: data.userType ? "Physical" : currentUser.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            ticketPrice: data.ticketPrice,
                            ticketId: data.ticketId,
                            variantGame: (data.variantGame) ? data.variantGame : "",
                            ticketColorType: data.ticketColorType,
                            gameMode: game.gameMode,
                            ticketNumber: data.ticketNumber,
                            defineSlug: "WOFPrizeGame1",
                            category: "credit",
                            status: "success",
                            amtCategory: "realMoney",
                            previousBalance: (data.userType) ? 0 : currentUser.walletAmount - data.totalAmount,
                            winningPrice: data.totalAmount,
                            typeOfTransactionTotalAmount: data.totalAmount,
                            afterBalance: (data.userType) ? data.totalAmount : currentUser.walletAmount,
                            hall: {
                                name: data.hall.name,  //player.hall.name,
                                id: data.hall.id, //player.hall.id
                            },
                            groupHall: {
                                name: data.groupHall.name, // groupHall[0].name,
                                id: data.groupHall.id // groupHall[0].id
                            },
                            hallId: data.hall.id, // //player.hall.id,
                            groupHallId: data.groupHall.id, // groupHall[0].id,
                            remark: "Win Prize " + data.totalAmount + " in Game 1 Wheel of Fortune Game", //remark on transaction
                            createdAt: Date.now(),
                            userType: data.userType ? data.userType : "Online",
                            typeOfTransaction: "Wheel of Fortune Prize",
                            "otherData.exactGameStartTime": new Date(game.startDate),
                        }
                        //console.log("transactionPointData in WOF", transactionPointData)
                        if (data.totalAmount > 0) {
                            await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                            if (!data.userType) {
                                await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer({ _id: currentUser._id }, {
                                    $inc: { 'statisticsgame1.totalWinning': data.totalAmount }
                                });
                            }
                        }

                    }
                } else {
                    console.log("This (" + data.action + ") not found in Game 1 Wheel of Fortune Game.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") not found in Game 1 Wheel of Fortune Game.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ")not found in Game 1 Wheel of Fortune Game." };
                }
            } else if (slug == "TChestPrizeGame1") { // game4 mini game
                if (data.action == "credit") {
                    if (data.purchasedSlug == "realMoney") {
                        let currentUser
                        if (!data.userType) {
                            currentUser = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: data.totalAmount } }); //, optSession
                        }
                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: data.userType ? "Physical" : currentUser._id,
                            playerName: data.userType ? "Physical" : currentUser.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            ticketPrice: data.ticketPrice,
                            variantGame: (data.variantGame) ? data.variantGame : "",
                            ticketColorType: data.ticketColorType,
                            gameMode: game.gameMode,
                            ticketNumber: data.ticketNumber,
                            defineSlug: "TChestPrizeGame1",
                            category: "credit",
                            status: "success",
                            amtCategory: "realMoney",
                            previousBalance: currentUser.walletAmount - data.totalAmount,
                            winningPrice: data.totalAmount,
                            typeOfTransactionTotalAmount: data.totalAmount,
                            afterBalance: currentUser.walletAmount,
                            hall: {
                                name: data.hall.name,  //player.hall.name,
                                id: data.hall.id, //player.hall.id
                            },
                            groupHall: {
                                name: data.groupHall.name, // groupHall[0].name,
                                id: data.groupHall.id // groupHall[0].id
                            },
                            hallId: data.hall.id, // //player.hall.id,
                            groupHallId: data.groupHall.id, // groupHall[0].id,
                            remark: "Win Prize " + data.totalAmount + " in Game 1 Treasure Chest Game", //remark on transaction
                            createdAt: Date.now(),
                            typeOfTransaction: "Treasure Chest Prize",
                            "otherData.exactGameStartTime": new Date(game.startDate),
                        }
                        //console.log("transactionPointData in WOF", transactionPointData)
                        if (data.totalAmount > 0) {
                            await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                            if (!data.userType) {
                                await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer({ _id: currentUser._id }, {
                                    $inc: { 'statisticsgame1.totalWinning': data.totalAmount }
                                });
                            }
                        }

                    }
                } else {
                    console.log("This (" + data.action + ") not found in Game 1 Treasure Chest Game.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") not found in Game 1 Treasure Chest Game.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ")not found in Game 1 Treasure Chest Game." };
                }
            } else if (slug == "mysteryPrizeGame1") { // game4 mini game
                if (data.action == "credit") {
                    if (data.purchasedSlug == "realMoney") {
                        let currentUser = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: data.totalAmount } }); //, optSession
                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentUser._id,
                            playerName: currentUser.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            ticketPrice: data.ticketPrice,
                            variantGame: (data.variantGame) ? data.variantGame : "",
                            ticketColorType: data.ticketColorType,
                            gameMode: game.gameMode,
                            ticketNumber: data.ticketNumber,
                            defineSlug: "mysteryPrizeGame1",
                            category: "credit",
                            status: "success",
                            amtCategory: "realMoney",
                            previousBalance: currentUser.walletAmount - data.totalAmount,
                            winningPrice: data.totalAmount,
                            typeOfTransactionTotalAmount: data.totalAmount,
                            afterBalance: currentUser.walletAmount,
                            hall: {
                                name: data.hall.name,  //player.hall.name,
                                id: data.hall.id, //player.hall.id
                            },
                            groupHall: {
                                name: data.groupHall.name, // groupHall[0].name,
                                id: data.groupHall.id // groupHall[0].id
                            },
                            hallId: data.hall.id, // //player.hall.id,
                            groupHallId: data.groupHall.id, // groupHall[0].id,
                            remark: "Win Prize " + data.totalAmount + " in Game 1 Mystery Game", //remark on transaction
                            createdAt: Date.now(),
                            typeOfTransaction: "Mystery Prize",
                            "otherData.exactGameStartTime": new Date(game.startDate),
                        }
                        //console.log("transactionPointData in WOF", transactionPointData)
                        if (data.totalAmount > 0) {
                            await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                            await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer({ _id: currentUser._id }, {
                                $inc: { 'statisticsgame1.totalWinning': data.totalAmount }
                            });
                        }

                    }
                } else {
                    console.log("This (" + data.action + ") not found in Game 1 Mystry Game.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") not found in Game 1 Mystry Game.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ")not found in Game 1 Mystry Game." };
                }
            } else if (slug == "colordraftPrizeGame1") { // game4 mini game
                if (data.action == "credit") {
                    if (data.purchasedSlug == "realMoney") {
                        let currentUser = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: data.totalAmount } }); //, optSession
                        var transactionPointData = {
                            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            playerId: currentUser._id,
                            playerName: currentUser.username,
                            gameId: game._id,
                            gameNumber: game.gameNumber,
                            gameName: game.gameName,
                            gameType: game.gameType,
                            gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                            ticketPrice: data.ticketPrice,
                            variantGame: (data.variantGame) ? data.variantGame : "",
                            ticketColorType: data.ticketColorType,
                            gameMode: game.gameMode,
                            ticketNumber: data.ticketNumber,
                            defineSlug: "colordraftPrizeGame1",
                            category: "credit",
                            status: "success",
                            amtCategory: "realMoney",
                            previousBalance: currentUser.walletAmount - data.totalAmount,
                            winningPrice: data.totalAmount,
                            typeOfTransactionTotalAmount: data.totalAmount,
                            afterBalance: currentUser.walletAmount,
                            hall: {
                                name: data.hall.name,  //player.hall.name,
                                id: data.hall.id, //player.hall.id
                            },
                            groupHall: {
                                name: data.groupHall.name, // groupHall[0].name,
                                id: data.groupHall.id // groupHall[0].id
                            },
                            hallId: data.hall.id, // //player.hall.id,
                            groupHallId: data.groupHall.id, // groupHall[0].id,
                            remark: "Win Prize " + data.totalAmount + " in Game 1 Color Draft", //remark on transaction
                            createdAt: Date.now(),
                            typeOfTransaction: "Color Draft Prize",
                            "otherData.exactGameStartTime": new Date(game.startDate),
                        }
                        //console.log("transactionPointData in WOF", transactionPointData)
                        if (data.totalAmount > 0) {
                            await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                            await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer({ _id: currentUser._id }, {
                                $inc: { 'statisticsgame1.totalWinning': data.totalAmount }
                            });
                        }

                    }
                } else {
                    console.log("This (" + data.action + ") not found in Game 1 Color Draft Game.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") not found in Game 1 Color Draft Game.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ")not found in Game 1 Mystry Game." };
                }
            } else if (slug == "luckyNumberPrizeGame1") { // For Game 4
                if (data.action == "credit") {
                    if (data.purchasedSlug == "realMoney") {
                        let updatedPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: data.patternPrize } })
                        //console.log("updated player in bonus", updatedPlayer)
                        if (updatedPlayer instanceof Error) {
                            console.log("Error in distributing Lucky bonus winning amount", data.playerId, data.patternPrize);
                        } else {
                            let transactionPointData = {
                                transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                                playerId: data.playerId,
                                playerName: data.playerName,
                                gameId: data.gameId,
                                gameNumber: data.gameNumber,
                                gameName: game.gameName,
                                gameType: data.gameType,
                                gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                                ticketPrice: data.ticketPrice,
                                ticketId: data.ticketId,
                                ticketNumber: data.ticketNumber,
                                patternId: data.patternId,
                                patternName: data.patternName,
                                gameMode: data.gameMode,
                                variantGame: (data.variantGame) ? data.variantGame : "",
                                ticketColorType: data.ticketColorType,
                                defineSlug: "luckyNumberPrizeGame1",
                                category: "credit",
                                status: "success",
                                amtCategory: "realMoney",
                                previousBalance: data.previousBalance,
                                winningPrice: data.patternPrize,
                                typeOfTransactionTotalAmount: data.patternPrize,
                                afterBalance: updatedPlayer.walletAmount,
                                hall: {
                                    name: data.hall.name,  //player.hall.name,
                                    id: data.hall.id, //player.hall.id
                                },
                                groupHall: {
                                    name: data.groupHall.name, // groupHall[0].name,
                                    id: data.groupHall.id // groupHall[0].id
                                },
                                hallId: data.hall.id, // //player.hall.id,
                                groupHallId: data.groupHall.id, // groupHall[0].id,
                                remark: "Won Lucky Number Bonus", //remark on transaction
                                createdAt: Date.now(),
                                typeOfTransaction: "Lucky Number Winning Prize",
                                "otherData.exactGameStartTime": new Date(game.startDate),
                            }

                            if (data.patternPrize > 0) {
                                await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                                await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer({ _id: data.playerId }, {
                                    $inc: { 'statisticsgame1.totalWinning': data.patternPrize }
                                });
                            }

                        }
                    }
                } else {
                    console.log("This (" + data.action + ") not found in Game 1 Lucky Bonus Prize Detail.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        gameId: data.gameId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.patternPrize,
                        remark: "This (" + data.action + ") not found in Lucky Bonus Prize Game1 Pattern Prize Detail.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ") not found Lucky Bonus Prize Game1 Pattern Prize Detail." };
                }
            } else if (slug == "unique") {
                var transactionPointData = {
                    transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                    playerId: player._id,
                    defineSlug: "unique",
                    typeOfTransaction: data.typeOfTransaction,
                    category: data.action,
                    status: "success",
                    typeOfTransactionTotalAmount: data.totalAmount,
                    amtCategory: data.purchasedSlug,
                    createdAt: Date.now(),
                }
                await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
            } else if (slug == "game5Transactions") {
                if (data.action == "debit" || data.action == "credit") {
                    let transactionPointData = {
                        transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                        playerId: player._id,
                        playerName: player.username,
                        gameId: game._id,
                        gameNumber: game.gameNumber,
                        gameName: game.gameName,
                        gameType: game.gameType,
                        gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                        differenceAmount: data.totalAmount,
                        ticketPrice: (data.ticketPrice) ? data.ticketPrice : 0,
                        hallId: player.hall.id,
                        groupHallId: game.groupHalls[0].id,
                        defineSlug: "extraTransaction",
                        category: data.action,
                        status: "success",
                        amtCategory: "realMoney",
                        previousBalance: data.previousBalance,
                        afterBalance: data.afterBalance,
                        hall: {
                            name: player.hall.name,
                            id: player.hall.id
                        },
                        groupHall: game.groupHalls[0],
                        typeOfTransaction: data.typeOfTransaction,
                        typeOfTransactionTotalAmount: data.totalAmount,
                        remark: data.remark,
                        winningPrice: (data.action == "credit" && data.typeOfTransaction != "Cancel Ticket") ? data.totalAmount : 0,
                        isBotGame: ((game.otherData && game.otherData.isBotGame && game.otherData.isBotGame == true)) ? true : false,
                        createdAt: Date.now(),
                    }

                    await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                } else {
                    console.log("This (" + data.action + ") action not found in Game 5 Transaction.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        gameId: data.gameId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") action not found in Game 5 Transaction.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ") action not found in Game 5 Transaction." };
                }
            }
            // await session.commitTransaction();
            // await session.endSession();

        } catch (error) {
            console.log("trasaction error", error)

            console.log("This thing not found (" + error + ")  in Trasaction Detail.");
            await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                playerId: data.playerId,
                gameId: data.gameId,
                action: error,
                createdAt: Date.now()
            });
            throw { "status": "Error", "message": "This thing not found (" + error + ")  in Trasaction Detail." };
            // await session.abortTransaction();
            // await session.endSession();
            // throw error; // Rethrow so calling function sees error
        }
    },

    sendWinnersNotifications: async function (message) {
        try {
            console.log("---players, send notifications for the game winners sendWinnersNotifications---", message)
            FCM.send(message, function (err, response) {
                if (err) {
                    console.log('err--', err);
                } else {
                    console.log('response of winners notifications-----', response);
                    console.log('response of sendWinnersNotifications push notification-----');
                }
            });
        } catch (e) {
            console.log("sendWinnersNotifications", e);
        }
    },

    createTransactionAgent: async function (data) {
        try {
            let agent = await Sys.App.Services.AgentServices.getSingleAgentDataForRole({ _id: data.playerId }, ['name', 'chips', 'walletAmount']);
            let game = await Sys.Game.Common.Services.GameServices.getSingleGameData({ _id: data.gameId });
            let slug = data.transactionSlug;
            if (!agent) {
                await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                    playerId: data.playerId,
                    gameId: data.gameId,
                    action: data.action,
                    amtCategory: data.purchasedSlug,
                    amount: data.totalAmount,
                    remark: "This (" + data.playerId + ") Agemt Detail Not Found.",
                    createdAt: Date.now()
                });
                throw { "status": "Error", "message": "This Player Detail Not Found." };
            }

            if (slug == "extraTransaction" || slug == "patternPrizeGame1" || slug == "WOFPrizeGame1" || slug == "TChestPrizeGame1" || slug == "luckyNumberPrizeGame1" || slug == "mysteryPrizeGame1" || slug == "colordraftPrizeGame1") {
                let hallDetails = await Sys.App.Services.HallServices.getSingleHallData({ name: data.hallName }, ["name", "groupHall"]);
                if (data.action == "credit") {
                    let currentUser = await Sys.App.Services.AgentServices.FindOneUpdate(data.playerId, { $inc: { walletAmount: data.totalAmount } });
                    let transactionPointData = {
                        transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                        playerId: agent._id,
                        defineSlug: slug,
                        typeOfTransaction: data.typeOfTransaction,
                        gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                        gameId: game._id,
                        gameNumber: game.gameNumber,
                        gameType: game.gameType,
                        gameName: game.gameName,
                        category: data.action,
                        status: "success",
                        typeOfTransactionTotalAmount: data.totalAmount,
                        previousBalance: +agent.walletAmount.toFixed(4),
                        afterBalance: +currentUser.walletAmount,
                        hallId: data.hallId,
                        groupHallId: data.groupHallId,
                        game1Slug: data?.game1Slug,
                        groupHall: {
                            name: hallDetails?.groupHall?.name,
                            id: hallDetails?.groupHall?.id
                        },
                        hall: {
                            name: hallDetails?.name,
                            id: hallDetails?._id
                        },
                        amtCategory: data.purchasedSlug,
                        userType: data.userType,
                        createdAt: Date.now(),
                    }
                    await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);

                } else if (data.action == "debit") {
                    let currentUser = await Sys.App.Services.AgentServices.FindOneUpdate(data.playerId, { $inc: { walletAmount: - data.patternPrize } });
                    //let hallDetails = await Sys.App.Services.HallServices.getSingleHallData({ name: data.hallName}, ["name", "groupHall"]);
                    let transactionPointData = {
                        transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                        playerId: agent._id,
                        defineSlug: slug,
                        typeOfTransaction: data.typeOfTransaction,
                        gameStartDate: (game.isGraceTimeCheck == true) ? game.graceDate : game.startDate,
                        gameId: game._id,
                        gameNumber: game.gameNumber,
                        gameType: game.gameType,
                        gameName: game.gameName,
                        gameMode: data.gameMode,
                        category: data.action,
                        status: "success",
                        typeOfTransactionTotalAmount: data.patternPrize,
                        winningPrice: data.patternPrize,
                        previousBalance: +agent.walletAmount.toFixed(4),
                        afterBalance: +currentUser.walletAmount,
                        hallId: hallDetails?._id,
                        groupHallId: hallDetails?.groupHall?.id,
                        game1Slug: data?.game1Slug,
                        groupHall: {
                            name: hallDetails?.groupHall?.name,
                            id: hallDetails?.groupHall?.id
                        },
                        hall: {
                            name: hallDetails?.name,
                            id: hallDetails?._id
                        },
                        amtCategory: data.purchasedSlug,
                        userType: data.userType,
                        createdAt: Date.now(),
                    }
                    await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                } else {
                    console.log("This (" + data.action + ") in Buy Ticket Not Found.");
                    await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                        playerId: data.playerId,
                        gameId: data.gameId,
                        action: data.action,
                        amtCategory: data.purchasedSlug,
                        amount: data.totalAmount,
                        remark: "This (" + data.action + ") in Buy Ticket  Not Found.",
                        createdAt: Date.now()
                    });
                    throw { "status": "Error", "message": "This (" + data.action + ") in Buy Ticket Not Found." };
                }
            }

        } catch (error) {
            console.log("trasaction error", error)
            console.log("This thing not found (" + error + ")  in Trasaction Detail.");
            await Sys.Game.Common.Services.PlayerServices.createErrorLog({
                playerId: data.playerId,
                gameId: data.gameId,
                action: error,
                createdAt: Date.now()
            });
            throw { "status": "Error", "message": "This thing not found (" + error + ")  in Trasaction Detail." };

        }
    },

    dailyBalanceTransfer: async function(data){
        try{
            if (data.action == "debit" || data.action == "credit") {
                let addBalance = null;
                if(data.action == "credit"){
                    addBalance = await Sys.App.Services.HallServices.updateHall({ _id: data.hallId, "activeAgents.id": data.agentId }, { $inc: { "activeAgents.$.dailyBalance": +data.amount, "activeAgents.$.totalDailyBalanceIn": +data.amount, hallCashBalance: - data.amount } }, { new: true });
                }else if(data.action == "debit"){
                    addBalance = await Sys.App.Services.HallServices.updateHall({ _id: data.hallId, "activeAgents.id": data.agentId }, { $inc: { "activeAgents.$.dailyBalance": - data.amount, "activeAgents.$.totalDailyBalanceIn": - data.amount, hallCashBalance: +data.amount } }, { new: true });
                }
                console.log("addBalance after", addBalance, data);
                if(!addBalance){
                    return {status: "fail", message: "Something went wrong, please try again later."}
                }
                let updatedtxIndex = addBalance.activeAgents.findIndex((e) => e.id == data.agentId);
                let updatedBalance = addBalance.activeAgents[updatedtxIndex].dailyBalance;
                let shiftId = addBalance.activeAgents[updatedtxIndex].shiftId;

                let txId = 'HTRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000);
                let transaction = {
                    transactionId: txId,
                    shiftId: shiftId,
                    hallId: data.hallId,
                    agentId: data.agentId,
                    playerId: data.playerId,
                    agentName: data.agentName,
                    playerName: data.playerName,
                    category: data.action, // debit / credit
                    amount: data.amount,
                    typeOfTransaction: data.typeOfTransaction,
                    hall: data.hall,
                    groupHall: data.groupHall,
                    previousBalance: (data.action == "credit") ? +parseFloat(updatedBalance - (+data.amount)).toFixed(2) : +parseFloat(updatedBalance + (+data.amount)).toFixed(2),
                    afterBalance: +parseFloat(updatedBalance).toFixed(2),
                    createdAt: Date.now(),
                }
                await Sys.App.Services.AgentServices.insertAgentTransactionData(transaction);

                let shiftData = null;
                if(data.action == "credit"){
                    shiftData =  await Sys.App.Services.AgentServices.updateShiftData({ _id: addBalance.activeAgents[updatedtxIndex].shiftId, hallId: data.hallId, agentId: data.agentId }, { $inc: { dailyBalance: +data.amount, totalDailyBalanceIn: +data.amount } }, { new: true });
                }else if(data.action == "debit"){
                    shiftData = await Sys.App.Services.AgentServices.updateShiftData({ _id: addBalance.activeAgents[updatedtxIndex].shiftId, hallId: data.hallId, agentId: data.agentId }, { $inc: { dailyBalance: - data.amount, totalDailyBalanceIn: - data.amount } }, { new: true });
                }

                
                //send balance update broadcast 
                Sys.Helper.gameHelper.sendHallBalanceUpdateBroadcast({
                    shiftId: shiftData._id.toString(),
                    hallId: shiftData.hallId,
                    dailyBalance: shiftData.dailyBalance,
                    totalDailyBalanceIn: shiftData.totalDailyBalanceIn,
                    totalCashIn: shiftData.totalCashIn,
                    totalCashOut: shiftData.totalCashOut,
                    toalCardIn: shiftData.toalCardIn,
                    totalCardOut: shiftData.totalCardOut,
                    totalHallCashBalance: addBalance.hallCashBalance
                });

                let hallTransaction = {
                    transactionId: txId,
                    shiftId: shiftId,
                    hallId: data.hallId,
                    agentId: data.agentId,
                    type: data.typeOfTransaction,
                    category: (data.action == "debit") ? "credit" : "debit",
                    amount: +data.amount,
                    previousBalance: (data.action == "credit") ? +parseFloat(addBalance.hallCashBalance + (+data.amount)).toFixed(2) : +parseFloat(addBalance.hallCashBalance - (+data.amount)).toFixed(2),
                    afterBalance: +parseFloat(addBalance.hallCashBalance).toFixed(2),
                    createdAt: Date.now(),
                }
                await Sys.App.Services.HallServices.insertCashSafeData(hallTransaction);
                
                return {status: "success", message: "Daily Balance Trasferred Successfully.", dailyBalance: shiftData.dailyBalance }
                // update transaction of cash safe

                
            } else {
                console.log("This (" + data.action + ") action not found in hall transactions.");
                throw { "status": "Error", "message": "This (" + data.action + ") action not found in hall transactions." };
            }
        }catch(e){
            console.log("dailyBalanceTransfer error", e)
        }
    },

    transferMoneyByHall: async function(data){
        try{
            const { isPlayerTxAlreadyDone = false } = data;
            //const incValueAgent = (data.operation == 'add') ? -data.amount : data.amount;
            const incValuePlayer = (data.operation == 'add') ? data.amount : -data.amount;
            const hall = await Sys.App.Services.HallServices.getSingleHallData({_id: data.hallId}, {activeAgents: 1},);
            if (!hall) {
                throw new Error('Hall not found');
            }

            let updatedHall = null;
            if(data.paymentType == "Cash"){
                if(data.operation == "add"){
                    updatedHall = await Sys.App.Services.HallServices.updateHall({_id: hall.id, "activeAgents.id": data.agentId}, { $inc: { "activeAgents.$.dailyBalance": (data.amount), "activeAgents.$.totalCashIn": (data.amount) } }, {new: true});
                }else{
                    updatedHall = await Sys.App.Services.HallServices.updateHall({_id: hall.id, "activeAgents.id": data.agentId}, { $inc: { "activeAgents.$.dailyBalance": -(data.amount),  "activeAgents.$.totalCashOut": (data.amount) } }, {new: true});
                }
            }else{
                if(data.operation == "add"){
                    updatedHall = await Sys.App.Services.HallServices.updateHall({_id: hall.id, "activeAgents.id": data.agentId}, { $inc: {  "activeAgents.$.toalCardIn": (data.amount) } }, {new: true});
                }else{
                    updatedHall = await Sys.App.Services.HallServices.updateHall({_id: hall.id, "activeAgents.id": data.agentId}, { $inc: {  "activeAgents.$.totalCardOut":  (data.amount) } }, {new: true});
                }
            }

            let index = updatedHall.activeAgents.findIndex((e) => e.id == data.agentId);
            let updatedHallBalance = updatedHall.activeAgents[index].dailyBalance;

            let updatedPlayer;
            if (!isPlayerTxAlreadyDone) {
                updatedPlayer = await Sys.App.Services.PlayerServices.findOneandUpdatePlayer({_id: data.playerId}, {$inc: {walletAmount: incValuePlayer} }, {new: true});
                const playerTransactionRecord = {
                    transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                    shiftId: updatedHall.activeAgents[index].shiftId,
                    hallId: data.hallId,
                    agentId: data.agentId,
                    playerId: data.playerId,
                    agentName: data.agentName,
                    playerName: updatedPlayer.username,
                    category: data.action, // debit / credit
                    differenceAmount: data.amount,
                    typeOfTransactionTotalAmount: data.amount,
                    typeOfTransaction: data.typeOfTransaction,
                    hall: data.hall,
                    groupHall: data.groupHall,
                    previousBalance: ( data.action == "credit" ) ? (+parseFloat(updatedPlayer.walletAmount - data.amount).toFixed(2) ) : (+parseFloat(updatedPlayer.walletAmount + data.amount).toFixed(2) ),
                    afterBalance:  +parseFloat(updatedPlayer.walletAmount).toFixed(2),
                    defineSlug: "extraTransaction",
                    amtCategory: "realMoney",
                    status: "success",
                    paymentBy: data.paymentType, 
                    userType: data.userType,
                    createdAt: Date.now(),
                };
                await Sys.Game.Common.Services.PlayerServices.createTransaction(playerTransactionRecord);
            } else {
                updatedPlayer = await Sys.Game.Common.Services.PlayerServices.getOneByData({_id: data.playerId}, { username: 1, walletAmount: 1});
            }
            
            let agentPreviousBalance = ( data.action == "credit" ) ? (+parseFloat(updatedHallBalance - data.amount).toFixed(2) ) : (+parseFloat(updatedHallBalance + data.amount).toFixed(2) );
            if(data.paymentType != "Cash"){
                agentPreviousBalance =  +parseFloat(updatedHallBalance).toFixed(2);
            }

            const agentTransactionRecord = {
                transactionId: 'HTRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                shiftId: updatedHall.activeAgents[index].shiftId,
                hallId: data.hallId,
                agentId: data.agentId,
                playerId: data.playerId,
                agentName: data.agentName,
                playerName: updatedPlayer.username,
                category: data.action, //(data.action == "credit") ? "debit" : "credit",
                amount: data.amount,
                typeOfTransaction: data.typeOfTransaction,
                hall: data.hall,
                groupHall: data.groupHall,
                previousBalance: agentPreviousBalance,
                afterBalance:  +parseFloat(updatedHallBalance).toFixed(2),
                paymentBy: data.paymentType, 
                userType: data.userType,
                createdAt: Date.now(),
            };
    
            
            await Sys.App.Services.AgentServices.insertAgentTransactionData(agentTransactionRecord);
            let shiftData
            if(data.paymentType == "Cash"){
                if(data.operation == "add"){
                    shiftData = await Sys.App.Services.AgentServices.updateShiftData({ _id: updatedHall.activeAgents[index].shiftId, hallId: data.hallId, agentId: data.agentId  }, { $inc: { dailyBalance: (data.amount), totalCashIn: (data.amount) } },{new : true} );
                }else{
                    shiftData = await Sys.App.Services.AgentServices.updateShiftData({ _id: updatedHall.activeAgents[index].shiftId, hallId: data.hallId, agentId: data.agentId }, { $inc: { dailyBalance: -(data.amount), totalCashOut: (data.amount) } }, { new: true } ); 
                }
                //send balance update broadcast 
                Sys.Helper.gameHelper.sendHallBalanceUpdateBroadcast({
                    shiftId: shiftData._id.toString(),
                    hallId: shiftData.hallId,
                    dailyBalance: shiftData.dailyBalance,
                    totalDailyBalanceIn: shiftData.totalDailyBalanceIn,
                    totalCashIn: shiftData.totalCashIn,
                    totalCashOut: shiftData.totalCashOut,
                    toalCardIn: shiftData.toalCardIn,
                    totalCardOut: shiftData.totalCardOut,
                    totalHallCashBalance: updatedHall.hallCashBalance
                });
            }else{
                if(data.operation == "add"){
                    shiftData = await Sys.App.Services.AgentServices.updateShiftData({ _id: updatedHall.activeAgents[index].shiftId, hallId: data.hallId, agentId: data.agentId  }, { $inc: { toalCardIn: (data.amount) } } ); 
                }else{
                    shiftData = await Sys.App.Services.AgentServices.updateShiftData({ _id: updatedHall.activeAgents[index].shiftId, hallId: data.hallId, agentId: data.agentId  }, { $inc: { totalCardOut: (data.amount) } } ); 
                }
            }
            return {status: "success", userwallet: +parseFloat(updatedPlayer.walletAmount).toFixed(2), dailyBalance: +parseFloat(updatedHallBalance).toFixed(2)}
        }catch(e){
            console.log("transferMoneyByHall error", e)
            throw new Error('Something went wrong, please try again later');
        }
    },

    assignWinningToAllPhysicalTicket: async function (data) {
        try {
            console.log("assign Winning To All(winning) Physical Ticket called",data);
            let keys = [
                "not_enough_amount_to_reward"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, data.language);
            const queryforTicket = {
                isPhysicalTicket: true,
                gameType: "game_1",
                isPlayerWon: true,
                totalWinningOfTicket: { $gt: 0 },
                // "otherData.shiftId": data.shiftId,
                // "otherData.isWinningDistributed": false,
                "otherData.winningStats.isWinningDistributed": false,
            }

            //if giving out for given game
            if (data.gameId) {
                queryforTicket['gameId'] = data.gameId.toString()
            }else{
            //if giving out while logging out for the day
                queryforTicket['otherData.shiftId'] = data.shiftId.toString()
            }


            if (data?.tickets?.length) {
                queryforTicket['_id'] = { $in: data.tickets }
            }
            const winningPhysicalTickets = await Sys.Game.Game1.Services.GameServices.getTicketListData(queryforTicket, { 
                tickets: 1, 
                gameId: 1, 
                dailyScheduleId: 1, 
                playerIdOfPurchaser: 1, 
                ticketColorType: 1, 
                ticketColorName: 1, 
                ticketPrice: 1, 
                userType: 1, 
                ticketPurchasedFrom: 1, 
                totalWinningOfTicket : 1,
                otherData : 1,
                ticketId : 1
            });
            
            let totalAmount = 0;
            const ticketIds = [];
            if (winningPhysicalTickets.length) {
                const finalTicketData = [];
                let totalToPay = 0;
                for (let i = 0; i < winningPhysicalTickets.length; i++) {
                    totalAmount = totalAmount + winningPhysicalTickets[i].totalWinningOfTicket;
                    //ticketIds.push(winningPhysicalTickets[i]._id);

                    if (winningPhysicalTickets[i]?.otherData?.winningStats?.length) {
                        winningPhysicalTickets[i]?.otherData?.winningStats.forEach(pattern => {
                            if (!pattern.isWinningDistributed) {
                                ticketIds.push(winningPhysicalTickets[i]._id);
                                totalToPay += pattern.wonAmount;
                                finalTicketData.push({ 
                                    ticketId: winningPhysicalTickets[i]._id.toString(), 
                                    ticketNumber: winningPhysicalTickets[i].ticketId, 
                                    ticketPrice: winningPhysicalTickets[i].ticketPrice, 
                                    gameId: winningPhysicalTickets[i].gameId, 
                                    patternPrize: pattern.wonAmount, 
                                    patternName: pattern.lineType,
                                    userType: winningPhysicalTickets[i].userType,
                                    ticketPurchasedFrom: winningPhysicalTickets[i].ticketPurchasedFrom,
                                    tickets: winningPhysicalTickets[i].tickets,
                                    dailyScheduleId: winningPhysicalTickets[i].dailyScheduleId,
                                    playerIdOfPurchaser: winningPhysicalTickets[i].playerIdOfPurchaser,
                                    ticketColorType: winningPhysicalTickets[i].ticketColorType,
                                    ticketColorName: winningPhysicalTickets[i].ticketColorName,
                                })
                            }
                        });
                    }
                }

                if (data.dailyBalance < totalToPay) {
                    throw new Error(translate.not_enough_amount_to_reward)
                }

                //console.log("finalTicketData--", finalTicketData)

                if (finalTicketData.length) {
                    const ticketsGroupedByGameId = finalTicketData.reduce((acc, ticket) => ({
                        ...acc,
                        [ticket.gameId]: [...(acc[ticket.gameId] || []), ticket],
                    }), {});
                
                    const gameIds = Object.keys(ticketsGroupedByGameId);
                    console.log("gameIds---", gameIds)
                    for (let i = 0; i < gameIds.length; i++) {
                        const gameId = gameIds[i];
                        console.log(`Game ID: ${gameId}`);
                        let gameData =  await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {gameNumber: 1, gameName: 1, gameMode: 1, startDate: 1 });
                        const gameTickets = ticketsGroupedByGameId[gameId];
                        for (let j = 0; j < gameTickets.length; j++) {
                            console.log(gameTickets[j]);

                            const playerTransactionObject = {
                                transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                                gameType : "game_1",
                                gameId: gameId,
                                agentId: data.agentId,
                                agentName: data.agentName,
                                ticketId:gameTickets[j].ticketId,
                                ticketNumber: gameTickets[j].ticketNumber,
                                ticketPrice: gameTickets[j].ticketPrice,
                                patternPrize: gameTickets[j].patternPrize,
                                shiftId: data.shiftId,
                                hallId: data.hallId,
                                playerId: data.agentId,
                                playerName: "Physical",
                                typeOfTransaction: "Physical Ticket Winning",
                                category: "credit",
                                typeOfTransactionTotalAmount: gameTickets[j].patternPrize,
                                groupHallId: data.groupHall.id,
                                hall: {
                                    name: data.hallName,
                                    id: data.hallId.toString()
                                },
                                groupHall: {
                                    id: data.groupHall.id,
                                    name: data.groupHall.name
                                },
                                otherData : {
                                    ticketData : gameTickets[j]
                                },
                                previousBalance:0,
                                afterBalance: gameTickets[j].patternPrize,
                                userType: "Physical",
                                paymentBy: "Cash",
                                defineSlug: "extraTransaction",
                                amtCategory: "realMoney",
                                status: "success",
                                differenceAmount: gameTickets[j].patternPrize,
                                winningPrice: gameTickets[j].patternPrize,
                                gameNumber: gameData.gameNumber,
                                gameName: gameData.gameName,
                                gameMode: gameData.gameMode,
                                gameStartDate: gameData.startDate,
                                createdAt: Date.now(),
                            }
                            await Sys.Game.Common.Services.PlayerServices.createTransaction(playerTransactionObject);

                        }

                        
                    }

                    Sys.App.Services.GameService.bulkWriteTicketData([{
                        updateMany: {
                            filter: { _id: { $in: ticketIds } },
                            update: {
                                $set: {
                                    "otherData.isWinningDistributed": true,
                                    "otherData.winningStats.$[elem].isWinningDistributed": true
                                },
                            },
                            arrayFilters: [{ "elem.isWinningDistributed": false }]
                        }
                    }])

                    const transactionObject = {
                        agentId: data.agentId,
                        agentName: data.agentName,
                        shiftId: data.shiftId,
                        hallId: data.hallId,
                        typeOfTransaction: "Physical Ticket Winning Distribution.",
                        action: "debit",
                        totalAmount: totalToPay,
                        groupHallId: data.groupHall.id,
                        hall: {
                            name: data.hallName,
                            id: data.hallId.toString()
                        },
                        groupHall: {
                            id: data.groupHall.id,
                            name: data.groupHall.name
                        },
                        ticketData: finalTicketData,
                        userType: "Physical",
                        paymentType: "Cash"
                    }
                    await Sys.Helper.gameHelper.physicalTicketTransactionsInHall(transactionObject);

                }

                

                /*if (finalTicketData.length) {

                    const transactionObject = {
                        agentId: data.agentId,
                        agentName: data.agentName,
                        shiftId: data.shiftId,
                        hallId: data.hallId,
                        typeOfTransaction: "Physical Ticket Winning Distribution.",
                        action: "debit",
                        totalAmount: totalToPay,
                        groupHallId: data.groupHall.id,
                        hall: {
                            name: data.hallName,
                            id: data.hallId.toString()
                        },
                        groupHall: {
                            id: data.groupHall.id,
                            name: data.groupHall.name
                        },
                        ticketData: finalTicketData,
                        userType: "Physical",
                        paymentType: "Cash"
                    }
    
                    const playerTransactionObject = {
                        transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                        gameType : "game_1",
                        agentId: data.agentId,
                        agentName: data.agentName,
                        shiftId: data.shiftId,
                        hallId: data.hallId,
                        playerId: data.agentId,
                        playerName: "Physical",
                        typeOfTransaction: "Physical Ticket Winning",
                        category: "credit",
                        typeOfTransactionTotalAmount: totalToPay,
                        groupHallId: data.groupHall.id,
                        hall: {
                            name: data.hallName,
                            id: data.hallId.toString()
                        },
                        groupHall: {
                            id: data.groupHall.id,
                            name: data.groupHall.name
                        },
                        otherData : {
                            ticketData : finalTicketData
                        },
                        previousBalance:0,
                        afterBalance: totalToPay,
                        userType: "Physical",
                        paymentBy: "Cash",
                        defineSlug: "extraTransaction",
                        amtCategory: "realMoney",
                        status: "success",
                        differenceAmount: totalToPay,
                        createdAt: Date.now(),
                    }
    
                    Sys.App.Services.GameService.bulkWriteTicketData([{
                        updateMany: {
                            filter: { _id: { $in: ticketIds } },
                            update: {
                                $set: {
                                    "otherData.isWinningDistributed": true,
                                    "otherData.winningStats.$[elem].isWinningDistributed": true
                                },
                            },
                            arrayFilters: [{ "elem.isWinningDistributed": false }]
                        }
                    }])
                    await Sys.Game.Common.Services.PlayerServices.createTransaction(playerTransactionObject);
                    await Sys.Helper.gameHelper.physicalTicketTransactionsInHall(transactionObject);
                }*/

            }

            return true;


        } catch (error) {
            console.error("Error while assigning winning to physical tickets",error);
            throw new Error(error.message || "Something went wrong.");
        }
    },

    physicalTicketTransactionsInHall: async function (data) {
        try {
           //This will add transaction for all the physical ticket purchased and all the payouts given for physical ticket
            console.log("physical ticket transactions in hall called ::",data);

            const hall = await Sys.App.Services.HallServices.getSingleHallData({ _id: data.hallId }, { activeAgents: 1 },);
            if (!hall) {
                throw new Error('Hall not found');
            }

            let updatedHall;
            let shiftData;
            if (data.action == "credit") {
                updatedHall = await Sys.App.Services.HallServices.updateHall({ _id: hall.id, "activeAgents.id": data.agentId }, { $inc: { "activeAgents.$.dailyBalance": (data.totalAmount), "activeAgents.$.totalCashIn": (data.totalAmount) } }, { new: true });
                shiftData = await Sys.App.Services.AgentServices.updateShiftData({ _id: data.shiftId, hallId: data.hallId, agentId: data.agentId }, { $inc: { dailyBalance: (data.totalAmount), totalCashIn: (data.totalAmount) } }, { new: true }); 
            } else {
                updatedHall = await Sys.App.Services.HallServices.updateHall({ _id: hall.id, "activeAgents.id": data.agentId.toString() }, { $inc: { "activeAgents.$.dailyBalance": -(data.totalAmount), "activeAgents.$.totalCashOut": (data.totalAmount) } }, { new: true });
                shiftData = await Sys.App.Services.AgentServices.updateShiftData({ _id: data.shiftId, hallId: data.hallId, agentId: data.agentId }, { $inc: { dailyBalance: -(data.totalAmount), totalCashOut: (data.totalAmount) } }, { new: true }); 
            }


            const agentTransactionRecord = {
                transactionId: 'HTRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                shiftId: data.shiftId,
                hallId: data.hallId,
                agentId: data.agentId,
                playerId: data.agentId,
                agentName: data.agentName,
                playerName: "Physical",
                category: data.action,
                amount: data.totalAmount,
                typeOfTransaction: data.typeOfTransaction,
                hall: data.hall,
                groupHall: data.groupHall,
                previousBalance: (data.action == "credit") ? +parseFloat(shiftData.dailyBalance - data.totalAmount).toFixed(2) : +parseFloat(shiftData.dailyBalance + data.totalAmount).toFixed(2),
                afterBalance: +parseFloat(shiftData.dailyBalance).toFixed(2),
                paymentBy: data.paymentType,
                userType: data.userType,
                otherData: {
                    ticketData : data.ticketData
                },
                createdAt: Date.now(),
            };

            await Sys.App.Services.AgentServices.insertAgentTransactionData(agentTransactionRecord);
            Sys.Helper.gameHelper.sendHallBalanceUpdateBroadcast({
                shiftId: shiftData._id.toString(),
                hallId: shiftData.hallId,
                dailyBalance: shiftData.dailyBalance,
                totalDailyBalanceIn: shiftData.totalDailyBalanceIn,
                totalCashIn: shiftData.totalCashIn,
                totalCashOut: shiftData.totalCashOut,
                toalCardIn: shiftData.toalCardIn,
                totalCardOut: shiftData.totalCardOut,
                totalHallCashBalance: updatedHall?.hallCashBalance
            });
            return true;

        } catch (e) {
            console.log("transferMoneyByHall error", e)
            throw new Error('Something went wrong, please try again later');
        }
    },

    // This function is used to add wallet transaction done by agent 
    physicalTicketWalletTransactionsInHall: async function (data) {
        try {
            // Destructure upfront for clarity
            const {
                hallId,
                shiftId,
                agentId,
                agentName,
                playerData,
                action: category,
                totalAmount: amount,
                typeOfTransaction,
                hall,
                groupHall,
                paymentType: paymentBy,
                userType,
                ticketData
            } = data;
    
            // Fetch hall and agent shift
            const [hallData, shiftData] = await Promise.all([
                Sys.App.Services.HallServices.getSingleHallData(
                    { _id: hallId },
                    { activeAgents: 1 }
                ),
                Sys.App.Services.AgentServices.getSingleShiftData(
                    { _id: shiftId, agentId, hallId },
                    { dailyBalance: 1 }
                )
            ]);

            if (!hallData) {
                throw new Error("Hall not found");
            }
    
            const balance = +parseFloat(shiftData?.dailyBalance || 0).toFixed(2);
    
            // Build agent transaction record
            const agentTransactionRecord = {
                transactionId:
                    "HTRN" +
                    (await Sys.Helper.bingo.ordNumFunction(Date.now())) +
                    Math.floor(100000 + Math.random() * 900000),
                shiftId,
                hallId,
                agentId,
                playerId: playerData?.id,
                agentName,
                playerName: playerData.username,
                category,
                amount,
                typeOfTransaction,
                hall,
                groupHall,
                previousBalance: balance,
                afterBalance: balance,
                paymentBy,
                userType,
                otherData: { ticketData },
                createdAt: Date.now(),
            };
    
            await Sys.App.Services.AgentServices.insertAgentTransactionData(agentTransactionRecord);
            return true;
        } catch (e) {
            console.error("transferMoneyByHall error", e);
            throw new Error("Something went wrong, please try again later");
        }
    },
    

    productTransactionInHall : async function (data) {
        try {
            console.log("Creating transaction for product sale in hall",data);
            const { hallId,orderId, shiftId, cartId,productList,category, totalAmount, userType, userId, userName, agentId, paymentType, agentName, hall, typeOfTransaction } = data;
            const hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: data.hallId }, { activeAgents: 1 },);
            if (!hallData) {
                throw new Error('Hall not found');
            }

            let updatedHall = null;
            if (paymentType == "Cash") {
                updatedHall = await Sys.App.Services.HallServices.updateHall({ _id: hallData._id, "activeAgents.id": agentId.toString() }, { $inc: { "activeAgents.$.dailyBalance": totalAmount, "activeAgents.$.totalCashIn": totalAmount } }, { new: true });
            } else {
                updatedHall = await Sys.App.Services.HallServices.updateHall({ _id: hallData._id, "activeAgents.id": agentId.toString() }, { $inc: { "activeAgents.$.toalCardIn": totalAmount } }, { new: true });
            }
            console.log("update hall", updatedHall)

            let index = updatedHall.activeAgents.findIndex((e) => e.id == agentId);
            let updatedHallBalance = updatedHall.activeAgents[index].dailyBalance;
            let agentPreviousBalance = +parseFloat(updatedHallBalance - totalAmount).toFixed(2) ;
            if (data.paymentType != "Cash") {
                agentPreviousBalance = +parseFloat(updatedHallBalance).toFixed(2);
            }
            let userTransaction = null;
            if (userType !== "Physical") {
                let updatedPlayer = await Sys.App.Services.PlayerServices.getSinglePlayerData({ _id: userId });
                userTransaction = {
                    transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                    shiftId: updatedHall.activeAgents[index].shiftId,
                    hallId: hallId,
                    agentId: agentId,
                    playerId: userId,
                    agentName: agentName,
                    playerName: userName,
                    category: "debit",
                    differenceAmount: totalAmount,
                    typeOfTransactionTotalAmount: totalAmount,
                    typeOfTransaction: data.typeOfTransaction,
                    hall: hall,
                    previousBalance: +parseFloat(updatedPlayer.walletAmount).toFixed(2),
                    afterBalance:  +parseFloat(updatedPlayer.walletAmount).toFixed(2),
                    defineSlug: "extraTransaction",
                    amtCategory: "realMoney",
                    status: "success",
                    paymentBy: paymentType, 
                    userType: userType,
                    otherData : {
                        cartId : cartId,
                        orderId : orderId,
                        productList : productList,
                        totalAmount : totalAmount
                    },
                    createdAt: Date.now(),
                };
            }

            const transactionObject = {
                transactionId: 'HTRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                shiftId: shiftId,
                hallId: hallId,
                agentId: agentId,
                playerId: userId,
                agentName: agentName,
                playerName: userName,
                category: category,
                amount: totalAmount,
                typeOfTransaction: typeOfTransaction,
                hall: hall,
                previousBalance: agentPreviousBalance,
                afterBalance: +parseFloat(updatedHallBalance).toFixed(2),
                paymentBy: paymentType,
                userType: userType,
                otherData : {
                    cartId: cartId,
                    orderId: orderId,
                    totalAmount : totalAmount,
                    productList : productList
                },
                createdAt: Date.now(),
            }
            if (userTransaction) {
                await Sys.Game.Common.Services.PlayerServices.createTransaction(userTransaction);
            }
            await Sys.App.Services.AgentServices.insertAgentTransactionData(transactionObject);
            if (data.paymentType == "Cash") {
                shiftData = await Sys.App.Services.AgentServices.updateShiftData({ 
                    _id: updatedHall.activeAgents[index].shiftId, 
                    hallId: hallId, 
                    agentId: agentId 
                }, { 
                    $inc: { 
                        dailyBalance: totalAmount, 
                        totalCashIn: totalAmount 
                    } 
                }, { 
                    new: true 
                });

                //send balance update broadcast 
                Sys.Helper.gameHelper.sendHallBalanceUpdateBroadcast({
                    shiftId: shiftData._id.toString(),
                    hallId: shiftData.hallId,
                    dailyBalance: shiftData.dailyBalance,
                    totalDailyBalanceIn: shiftData.totalDailyBalanceIn,
                    totalCashIn: shiftData.totalCashIn,
                    totalCashOut: shiftData.totalCashOut,
                    toalCardIn: shiftData.toalCardIn,
                    totalCardOut: shiftData.totalCardOut,
                    totalHallCashBalance: updatedHall.hallCashBalance
                });
            } else {
                shiftData = await Sys.App.Services.AgentServices.updateShiftData({ _id: updatedHall.activeAgents[index].shiftId, hallId: data.hallId, agentId: data.agentId }, { $inc: { toalCardIn: (data.amount) } });
            }

            return {
                status : "success",
                messgae : "Transaction created successfully"
            }

        } catch (error) {
            console.error("Error while committing transaction in product sales",error);
            throw new Error(error.message);
        }
    },

    // transferMoneyByHallSession: async function(data){
    //     const session = await mongoose.startSession();
    //     session.startTransaction();
    
    //     try {
    //         //const user = await Sys.App.Services.PlayerServices.getSinglePlayerSession({_id: data.playerId}, {walletAmount: 1}, {}, session);
    //         const hall = await Sys.App.Services.HallServices.getSingleHallSession({_id: data.hallId}, {activeAgents: 1}, {}, session);
    
    //         if (!hall) {
    //             throw new Error('Hall not found');
    //         }
            
    //         //const previousUserBalance = user.walletAmount;
    //         //const previousAgentBalance = hall.activeAgents[index].dailyBalance;
    
    //         let updatedHall = await Sys.App.Services.HallServices.updateHallSession({_id: hall.id, "activeAgents.id": data.agentId}, { $inc: { "activeAgents.$.dailyBalance": -(data.amount) } }, {new: true}, session);
    //         let updatedPlayer = await Sys.App.Services.PlayerServices.updatePlayerSession({_id: user.id}, {$inc: {walletAmount: amount} }, {new: true}, session);
    //         console.log("update hall and player", updatedHall, updatedPlayer)
            
    //         let index = updatedHall.activeAgents.findIndex((e) => e.id == data.agentId);
    //         let updatedHallBalance = updatedHall.activeAgents[index].dailyBalance;
            
    //         const playerTransactionRecord = {
    //             transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
    //             shiftId: updatedHall.activeAgents[index].shiftId,
    //             hallId: data.hallId,
    //             agentId: data.agentId,
    //             playerId: data.playerId,
    //             agentName: data.agentName,
    //             playerName: updatedPlayer.username,
    //             category: data.action, // debit / credit
    //             amount: data.amount,
    //             typeOfTransaction: data.typeOfTransaction,
    //             hall: data.hall,
    //             groupHall: data.groupHall,
    //             previousBalance: +parseFloat(updatedPlayer.walletAmount - data.amount).toFixed(2),
    //             afterBalance:  +parseFloat(updatedPlayer.walletAmount).toFixed(2),
    //             transactionSlug: "extraTransaction",
    //             purchasedSlug: "realMoney",
    //             createdAt: Date.now(),
    //         };
    
    //         const agentTransactionRecord = {
    //             transactionId: 'HTRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
    //             shiftId: updatedHall.activeAgents[index].shiftId,
    //             hallId: data.hallId,
    //             agentId: data.agentId,
    //             playerId: data.playerId,
    //             agentName: data.agentName,
    //             playerName: updatedPlayer.username,
    //             category: (data.action == "credit") ? "debit" : "credit",
    //             amount: data.amount,
    //             typeOfTransaction: data.typeOfTransaction,
    //             hall: data.hall,
    //             groupHall: data.groupHall,
    //             previousBalance: +parseFloat(updatedHallBalance + data.amount).toFixed(2),
    //             afterBalance:  +parseFloat(updatedHallBalance).toFixed(2),
    //             createdAt: Date.now(),
    //         };
    
    //         await Sys.App.Services.PlayerServices.insertPlayerTransactionSession(playerTransactionRecord, session);
    //         await Sys.App.Services.AgentServices.insertAgentTransactionSession(agentTransactionRecord, session);
            
    //         await Sys.App.Services.AgentServices.updateShiftSession({ _id: updatedHall.activeAgents[index].shiftId, hallId: data.hallId, agentId: data.agentId  }, { $inc: { dailyBalance: -amount } }, { new: true }, session); 

    //         await session.commitTransaction();
    //         session.endSession();
    //         console.log('Transaction committed');
    //     } catch (error) {
    //         await session.abortTransaction();
    //         session.endSession();
    //         console.error('Transaction aborted due to error: ', error);
    //     }
    // }

    sendHallBalanceUpdateBroadcast : function (data) {
        try {
            console.log("Sending Hall Balance Broadcast to Given session",data);
            Sys.Io.of('admin').to(data.hallId.toString()).emit("hallBalanceBroadcast",data)
        } catch (error) {
            console.error("error while sending hall balance broadcast",error);
        }
    },

    cashoutPhyscialTicketPatternbyPattern: async function (data) {
        try {
            //let updateGameData =  await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId }, { $inc: { totalWinning: data.totalAmount, finalGameProfitAmount: -(data.totalAmount) } }, {new: true});
            let gameData =  await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, {gameNumber: 1, gameName: 1, gameMode: 1, startDate: 1 });
            const transactionObject = {
                agentId: data.agentId,
                agentName: data.agentName,
                shiftId: data.shiftId,
                hallId: data.hallId,
                typeOfTransaction: "Physical Ticket Winning Distribution.",
                action: "debit",
                totalAmount: data.totalAmount,
                groupHallId: data.groupHall.id,
                hall: {
                    name: data.hallName,
                    id: data.hallId.toString()
                },
                groupHall: {
                    id: data.groupHall.id,
                    name: data.groupHall.name
                },
                userType: "Physical",
                paymentType: (data?.isTransferToWallet && data?.playerData?.id) ? "Wallet": "Cash", //"Cash",  // wallet if transfer to online player wallet
                ticketData: [{ticketId: data.ticketId, ticketNumber: data.ticketNumber, ticketPrice: data.ticketPrice, gameId: data.gameId, patternPrize: data.totalAmount, patternName: data.lineType}],
                playerData: data?.playerData ?? null
            }

            const playerTransactionObject = {
                transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                gameType : "game_1",
                gameId: data.gameId,
                agentId: data.agentId,
                ticketId:data.ticketId,
                ticketNumber: data.ticketNumber,
                agentName: data.agentName,
                patternPrize: data.totalAmount,
                ticketPrice: data.ticketPrice,
                shiftId: data.shiftId,
                hallId: data.hallId,
                playerId: (data?.isTransferToWallet && data?.playerData?.id) ? data?.playerData?.id : data.agentId, //data.agentId,
                playerName: (data?.isTransferToWallet && data?.playerData?.username) ? data?.playerData?.username : "Physical",  //"Physical",
                typeOfTransaction: "Physical Ticket Winning",
                category: "credit",
                typeOfTransactionTotalAmount: data.totalAmount,
                groupHallId: data.groupHall.id,
                hall: {
                    name: data.hallName,
                    id: data.hallId.toString()
                },
                groupHall: {
                    id: data.groupHall.id,
                    name: data.groupHall.name
                },
                otherData : {
                    ticketData : transactionObject.ticketData
                },
                previousBalance:0,
                afterBalance: data.totalAmount,
                userType: "Physical",
                paymentBy: (data?.isTransferToWallet && data?.playerData?.id) ? "Wallet": "Cash", //"Cash",
                defineSlug: "extraTransaction",
                amtCategory: "realMoney",
                status: "success",
                differenceAmount: data.totalAmount,
                winningPrice: data.totalAmount,
                gameNumber: gameData.gameNumber,
                gameName: gameData.gameName,
                gameMode: gameData.gameMode,
                gameStartDate: gameData.startDate,
                createdAt: Date.now(),
            }
            await Sys.Game.Common.Services.PlayerServices.createTransaction(playerTransactionObject);
            if(data?.isTransferToWallet){
                await module.exports.physicalTicketWalletTransactionsInHall(transactionObject)
            }else{
                await Sys.Helper.gameHelper.physicalTicketTransactionsInHall(transactionObject);
            }
        } catch (error) {
            console.error("Error while cash out physical ticket by pattern",error);
            throw new Error('Something went wrong, please try again later');
        }
    },

    transferMoneyByAdmin: async function(data){
        try{
            //const incValueAgent = (data.operation == 'add') ? -data.amount : data.amount;
            const incValuePlayer = (data.operation == 'add') ? data.amount : -data.amount;
            const hall = await Sys.App.Services.HallServices.getSingleHallData({_id: data.hallId}, {activeAgents: 1, groupHall: 1},);
            if (!hall) {
                throw new Error('Hall not found');
            }

            let updatedPlayer = await Sys.App.Services.PlayerServices.findOneandUpdatePlayer({_id: data.playerId}, {$inc: {walletAmount: incValuePlayer} }, {new: true});
            
            const playerTransactionRecord = {
                transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                hallId: data.hallId,
                agentId: data.agentId,
                playerId: data.playerId,
                agentName: data.agentName,
                playerName: updatedPlayer.username,
                category: data.action, // debit / credit
                differenceAmount: data.amount,
                typeOfTransactionTotalAmount: data.amount,
                typeOfTransaction: data.typeOfTransaction,
                hall: data.hall,
                groupHall: hall.groupHall,
                previousBalance: ( data.action == "credit" ) ? (+parseFloat(updatedPlayer.walletAmount - data.amount).toFixed(2) ) : (+parseFloat(updatedPlayer.walletAmount + data.amount).toFixed(2) ),
                afterBalance:  +parseFloat(updatedPlayer.walletAmount).toFixed(2),
                defineSlug: "extraTransaction",
                amtCategory: "realMoney",
                status: "success",
                paymentBy: data.paymentType, 
                userType: data.userType,
                createdAt: Date.now(),
            };
            
            await Sys.Game.Common.Services.PlayerServices.createTransaction(playerTransactionRecord);
            return {status: "success", userwallet: +parseFloat(updatedPlayer.walletAmount).toFixed(2)}
        }catch(e){
            console.log("transferMoneyByHall error", e)
            throw new Error('Something went wrong, please try again later');
        }
    },

    updateSession: async function(data) {console.log("data updatesession", data)
        const sessionsDir = path.join(__dirname, '../sessions');
        const agentId = data.agentId; 
        const shiftId = data.shiftId; 
        const hallId = data.hallId;
        try {
            const files = await fs.readdir(sessionsDir);
            console.log("files---", files);
            let sessionFound = false;
    
            for (const file of files) {
                const sessionFile = path.join(sessionsDir, file);
                let sessionData;
    
                try {
                    const data = await fs.readFile(sessionFile, 'utf8');
                    sessionData = JSON.parse(data);
                } catch (err) {
                    console.log(`Error reading session file ${sessionFile}:`, err.message);
                    continue; // Skip this file and move to the next one
                }
    
                if (sessionData && sessionData.details) {
                    console.log("agent and shift id", agentId, shiftId);
                    if (sessionData.details.is_admin == "no" && sessionData.details.id == agentId && sessionData.details.hall[0].id == hallId && sessionData.details.shiftId == shiftId) {
                        // Update session fields
                        console.log("sessionData.dailyBalance before", sessionData.details);

                        let agentShift = await Sys.App.Services.AgentServices.getSingleShiftData({_id: shiftId, agentId: agentId, hallId: hallId}, {dailyBalance: 1});
                        if(agentShift && agentShift.dailyBalance >= 0){ 
                            sessionData.details.dailyBalance = agentShift.dailyBalance;
                            await fs.writeFile(sessionFile, JSON.stringify(sessionData, null, 2), 'utf8');
                        }
                        sessionFound = true;
                        break;
                    }
                }
            }
    
            if (sessionFound) {
                return { message: 'Session updated successfully' };
            } else {
                return { message: 'Session not found' };
            }
        } catch (err) {
            console.log('Error processing sessions:', err.message);
            return { message: 'Internal server error' };
        }
    },

    sellProductTransactionInHall : async function (data) {
        try {
            console.log("Creating transaction for product sale in hall",data);
            const { hallId,orderId, shiftId, cartId,productList,category, totalAmount, userType, userId, userName, agentId, paymentType, agentName, hall, typeOfTransaction } = data;
            const hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: data.hallId }, { activeAgents: 1, groupHall: 1 });
            console.log("hallData---", hallData)
            if (!hallData) {
                throw new Error('Hall not found');
            }

            let updatedHall = null;
            if (paymentType == "Cash") {
                updatedHall = await Sys.App.Services.HallServices.updateHall({ _id: hallData._id, "activeAgents.id": agentId.toString() }, { $inc: { "activeAgents.$.dailyBalance": totalAmount, "activeAgents.$.totalCashIn": totalAmount } }, { new: true });
            } else if(paymentType == "Card") {
                updatedHall = await Sys.App.Services.HallServices.updateHall({ _id: hallData._id, "activeAgents.id": agentId.toString() }, { $inc: { "activeAgents.$.toalCardIn": totalAmount } }, { new: true });
            } else if(paymentType == "customerNumber"){
                updatedHall = await Sys.App.Services.HallServices.updateHall({ _id: hallData._id, "activeAgents.id": agentId.toString() }, { $inc: { "activeAgents.$.sellingByCustomerNumber": totalAmount } }, { new: true });
            }
            console.log("update hall", updatedHall)

            let index = updatedHall ? updatedHall.activeAgents.findIndex((e) => e.id == agentId) : -1;
            let updatedHallBalance = updatedHall ? updatedHall.activeAgents[index].dailyBalance : 0;
            let agentPreviousBalance = updatedHall ? +parseFloat(updatedHallBalance - totalAmount).toFixed(2) : 0 ;
            if (data.paymentType != "Cash") {
                agentPreviousBalance = +parseFloat(updatedHallBalance).toFixed(2);
            }
            let userTransaction = null;
            if (userType != "Card" && userType != "Cash") {
                let updatedPlayer = await Sys.App.Services.PlayerServices.findOneandUpdatePlayer({_id: userId}, {$inc: {walletAmount: - totalAmount} }, {new: true});
                
                userTransaction = {
                    transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                    shiftId: shiftId, //updatedHall.activeAgents[index].shiftId,
                    hallId: hallId,
                    agentId: agentId,
                    playerId: userId,
                    agentName: agentName,
                    playerName: userName,
                    category: "debit",
                    differenceAmount: totalAmount,
                    typeOfTransactionTotalAmount: totalAmount,
                    typeOfTransaction: typeOfTransaction,
                    hall: hall,
                    previousBalance: +parseFloat(updatedPlayer.walletAmount - totalAmount).toFixed(2),
                    afterBalance:  +parseFloat(updatedPlayer.walletAmount).toFixed(2),
                    defineSlug: "extraTransaction",
                    amtCategory: "realMoney",
                    status: "success",
                    paymentBy: paymentType, 
                    userType: userType,
                    otherData : {
                        cartId : cartId,
                        orderId : orderId,
                        productList : productList,
                        totalAmount : totalAmount
                    },
                    groupHallId: hallData.groupHall.id,
                    groupHall: hallData.groupHall,
                    createdAt: Date.now(),
                };
            }

            const transactionObject = {
                transactionId: 'HTRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                shiftId: shiftId,
                hallId: hallId,
                agentId: agentId,
                playerId: userId,
                agentName: agentName,
                playerName: userName,
                category: category,
                amount: totalAmount,
                typeOfTransaction: typeOfTransaction,
                hall: hall,
                previousBalance: agentPreviousBalance,
                afterBalance: +parseFloat(updatedHallBalance).toFixed(2),
                paymentBy: paymentType,
                userType: userType,
                otherData : {
                    cartId: cartId,
                    orderId: orderId,
                    totalAmount : totalAmount,
                    productList : productList
                },
                groupHall: hallData.groupHall,
                createdAt: Date.now(),
            }
            if (userTransaction) {
                await Sys.Game.Common.Services.PlayerServices.createTransaction(userTransaction);
            }
            await Sys.App.Services.AgentServices.insertAgentTransactionData(transactionObject);
            let shiftData = null;
            if (data.paymentType == "Cash") {
                shiftData = await Sys.App.Services.AgentServices.updateShiftData({ 
                    _id: updatedHall.activeAgents[index].shiftId, 
                    hallId: hallId, 
                    agentId: agentId 
                }, { 
                    $inc: { 
                        dailyBalance: totalAmount, 
                        totalCashIn: totalAmount 
                    } 
                }, { 
                    new: true 
                });

                //send balance update broadcast 
                Sys.Helper.gameHelper.sendHallBalanceUpdateBroadcast({
                    shiftId: shiftData._id.toString(),
                    hallId: shiftData.hallId,
                    dailyBalance: shiftData.dailyBalance,
                    totalDailyBalanceIn: shiftData.totalDailyBalanceIn,
                    totalCashIn: shiftData.totalCashIn,
                    totalCashOut: shiftData.totalCashOut,
                    toalCardIn: shiftData.toalCardIn,
                    totalCardOut: shiftData.totalCardOut,
                    totalHallCashBalance: updatedHall.hallCashBalance
                });
               
                
            } else if(data.paymentType == "Card") {
                shiftData = await Sys.App.Services.AgentServices.updateShiftData({ _id: updatedHall.activeAgents[index].shiftId, hallId: data.hallId, agentId: data.agentId }, { $inc: { toalCardIn: (totalAmount) } }, {new: true} );
            } else if(data.paymentType == "customerNumber") {
                shiftData = await Sys.App.Services.AgentServices.updateShiftData({ _id: updatedHall.activeAgents[index].shiftId, hallId: data.hallId, agentId: data.agentId }, { $inc: { sellingByCustomerNumber: (totalAmount) } }, {new: true} );
            }
            console.log("shiftData updated", shiftData)
            return {
                status : "success",
                messgae : "Transaction created successfully",
                result: {dailyBalance: shiftData ? shiftData.dailyBalance : null}
            }

        } catch (error) {
            console.error("Error while committing transaction in product sales",error);
            throw new Error(error.message);
        }
    },

    controlDailyBalance: async function(data){
        try{
            console.log("controlDailyBalance data---", data)
            if (data.action == "debit" || data.action == "credit") {
                let addBalance = null;
                if(data.action == "credit"){
                    addBalance = await Sys.App.Services.HallServices.updateHall({ _id: data.hallId, "activeAgents.id": data.agentId }, { $inc: { "activeAgents.$.dailyBalance": +data.amount } }, { new: true });
                }else if(data.action == "debit"){
                    addBalance = await Sys.App.Services.HallServices.updateHall({ _id: data.hallId, "activeAgents.id": data.agentId }, { $inc: { "activeAgents.$.dailyBalance": - data.amount } }, { new: true });
                }
                console.log("addBalance after", addBalance);
                if(!addBalance){
                    return {status: "fail", message: "Something went wrong, please try again later."}
                }
                let updatedtxIndex = addBalance.activeAgents.findIndex((e) => e.id == data.agentId);
                let updatedBalance = addBalance.activeAgents[updatedtxIndex].dailyBalance;
                let shiftId = addBalance.activeAgents[updatedtxIndex].shiftId;

                let txId = 'HTRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000);
                let transaction = {
                    transactionId: txId,
                    shiftId: shiftId,
                    hallId: data.hallId,
                    agentId: data.agentId,
                    playerId: data.playerId,
                    agentName: data.agentName,
                    playerName: data.playerName,
                    category: data.action, // debit / credit
                    amount: data.amount,
                    typeOfTransaction: data.typeOfTransaction,
                    hall: data.hall,
                    groupHall: data.groupHall,
                    previousBalance: (data.action == "credit") ? +parseFloat(updatedBalance - (+data.amount)).toFixed(2) : +parseFloat(updatedBalance + (+data.amount)).toFixed(2),
                    afterBalance: +parseFloat(updatedBalance).toFixed(2),
                    createdAt: Date.now(),
                }
                await Sys.App.Services.AgentServices.insertAgentTransactionData(transaction);

                let shiftData = null;
                if(data.action == "credit"){
                    shiftData =  await Sys.App.Services.AgentServices.updateShiftData({ _id: addBalance.activeAgents[updatedtxIndex].shiftId, hallId: data.hallId, agentId: data.agentId }, { $inc: { dailyBalance: +data.amount } }, { new: true });
                }else if(data.action == "debit"){
                    shiftData = await Sys.App.Services.AgentServices.updateShiftData({ _id: addBalance.activeAgents[updatedtxIndex].shiftId, hallId: data.hallId, agentId: data.agentId }, { $inc: { dailyBalance: - data.amount } }, { new: true });
                }

                //send balance update broadcast 
                Sys.Helper.gameHelper.sendHallBalanceUpdateBroadcast({
                    shiftId: shiftData._id.toString(),
                    hallId: shiftData.hallId,
                    dailyBalance: shiftData.dailyBalance,
                    totalDailyBalanceIn: shiftData.totalDailyBalanceIn,
                    totalCashIn: shiftData.totalCashIn,
                    totalCashOut: shiftData.totalCashOut,
                    toalCardIn: shiftData.toalCardIn,
                    totalCardOut: shiftData.totalCardOut,
                    totalHallCashBalance: addBalance.hallCashBalance
                });

                return {status: "success", message: "Daily Balance Trasferred Successfully.", dailyBalance: shiftData.dailyBalance }
                // update transaction of cash safe

                
            } else {
                console.log("This (" + data.action + ") action not found in hall transactions.");
                throw { "status": "Error", "message": "This (" + data.action + ") action not found in hall transactions." };
            }
        }catch(e){
            console.log("dailyBalanceTransfer error", e)
        }
    },

    // settlement: async function(data){
    //     try{
    //         if (data.action == "debit" || data.action == "credit") {
    //             let addBalance = null;
    //             if(data.action == "credit"){
    //                 addBalance = await Sys.App.Services.HallServices.updateHall({ _id: data.hallId, "activeAgents.id": data.agentId }, { $inc: { "activeAgents.$.dailyBalance": +data.amount } }, { new: true });
    //             }else if(data.action == "debit"){
    //                 addBalance = await Sys.App.Services.HallServices.updateHall({ _id: data.hallId, "activeAgents.id": data.agentId }, { $inc: { "activeAgents.$.dailyBalance": - data.amount } }, { new: true });
    //             }
    //             console.log("addBalance after", addBalance);
    //             if(!addBalance){
    //                 return {status: "fail", message: "Something went wrong, please try again later."}
    //             }
    //             let updatedtxIndex = addBalance.activeAgents.findIndex((e) => e.id == data.agentId);
    //             let updatedBalance = addBalance.activeAgents[updatedtxIndex].dailyBalance;
    //             let shiftId = addBalance.activeAgents[updatedtxIndex].shiftId;

    //             let txId = 'HTRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000);
    //             let transaction = {
    //                 transactionId: txId,
    //                 shiftId: shiftId,
    //                 hallId: data.hallId,
    //                 agentId: data.agentId,
    //                 playerId: data.playerId,
    //                 agentName: data.agentName,
    //                 playerName: data.playerName,
    //                 category: data.action, // debit / credit
    //                 amount: data.amount,
    //                 typeOfTransaction: data.typeOfTransaction,
    //                 hall: data.hall,
    //                 groupHall: data.groupHall,
    //                 previousBalance: (data.action == "credit") ? +parseFloat(updatedBalance - (+data.amount)).toFixed(2) : +parseFloat(updatedBalance + (+data.amount)).toFixed(2),
    //                 afterBalance: +parseFloat(updatedBalance).toFixed(2),
    //                 createdAt: Date.now(),
    //             }
    //             await Sys.App.Services.AgentServices.insertAgentTransactionData(transaction);

    //             let shiftData = null;
    //             if(data.action == "credit"){
    //                 shiftData =  await Sys.App.Services.AgentServices.updateShiftData({ _id: addBalance.activeAgents[updatedtxIndex].shiftId, hallId: data.hallId, agentId: data.agentId }, { $inc: { dailyBalance: +data.amount } }, { new: true });
    //             }else if(data.action == "debit"){
    //                 shiftData = await Sys.App.Services.AgentServices.updateShiftData({ _id: addBalance.activeAgents[updatedtxIndex].shiftId, hallId: data.hallId, agentId: data.agentId }, { $inc: { dailyBalance: - data.amount } }, { new: true });
    //             }

    //             //send balance update broadcast 
    //             Sys.Helper.gameHelper.sendHallBalanceUpdateBroadcast({
    //                 shiftId: shiftData._id.toString(),
    //                 hallId: shiftData.hallId,
    //                 dailyBalance: shiftData.dailyBalance,
    //                 totalDailyBalanceIn: shiftData.totalDailyBalanceIn,
    //                 totalCashIn: shiftData.totalCashIn,
    //                 totalCashOut: shiftData.totalCashOut,
    //                 toalCardIn: shiftData.toalCardIn,
    //                 totalCardOut: shiftData.totalCardOut,
    //                 totalHallCashBalance: addBalance.hallCashBalance
    //             });

    //             return {status: "success", message: "Daily Balance Trasferred Successfully.", dailyBalance: shiftData.dailyBalance }
    //             // update transaction of cash safe

                
    //         } else {
    //             console.log("This (" + data.action + ") action not found in hall transactions.");
    //             throw { "status": "Error", "message": "This (" + data.action + ") action not found in hall transactions." };
    //         }
    //     }catch(e){
    //         console.log("dailyBalanceTransfer error", e)
    //     }
    // },

    transferToDropSafe: async function(data){
        try{
            if (data.action == "debit" || data.action == "credit") {
                let addBalance = null;
                let shiftData = null;
                if(data.action == "credit"){
                    addBalance = await Sys.App.Services.HallServices.updateHall({ _id: data.hallId, "activeAgents.id": data.agentId }, { $inc: { "activeAgents.$.hallDropsafeBalance": +data.amount, hallDropsafeBalance: +data.amount, hallCashBalance: -data.amount } }, { new: true });
                    shiftData =  await Sys.App.Services.AgentServices.updateShiftData({ _id: data.shiftId, hallId: data.hallId, agentId: data.agentId }, { $inc: { hallDropsafeBalance: +data.amount} }, { new: true });
                }else if(data.action == "debit"){
                    addBalance = await Sys.App.Services.HallServices.updateHall({ _id: data.hallId, "activeAgents.id": data.agentId }, { $inc: { "activeAgents.$.hallDropsafeBalance": - data.amount, hallDropsafeBalance: - data.amount, hallCashBalance: +data.amount } }, { new: true });
                    shiftData = await Sys.App.Services.AgentServices.updateShiftData({ _id: data.shiftId, hallId: data.hallId, agentId: data.agentId }, { $inc: { hallDropsafeBalance: - data.amount} }, { new: true });
                }
                console.log("addBalance after", addBalance, data, shiftData);
                if(!addBalance){
                    return {status: "fail", message: "Something went wrong, please try again later."}
                }
                let hallTransaction = {
                    transactionId: 'HTRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                    shiftId: data.shiftId,
                    hallId: data.hallId,
                    agentId: data.agentId,
                    type: (data.typeOfTransaction == "Add Hall Safe Balance") ? "Deduct Hall Cash As Added in DropSafe" : "Add Hall Cash As Deducted From DropSafe",
                    category: (data.action == "debit") ? "credit" : "debit",
                    amount: +data.amount,
                    previousBalance: (data.action == "credit") ? +parseFloat(addBalance.hallCashBalance + (+data.amount)).toFixed(2) : +parseFloat(addBalance.hallCashBalance - (+data.amount)).toFixed(2),
                    afterBalance: +parseFloat(addBalance.hallCashBalance).toFixed(2),
                    hall: data.hall,
                    groupHall: data.groupHall,
                    createdAt: Date.now(),
                }
                await Sys.App.Services.HallServices.insertCashSafeData(hallTransaction);

                let txId = 'HTRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000);
                let hallTransaction1 = {
                    transactionId: txId,
                    shiftId: data.shiftId,
                    hallId: data.hallId,
                    agentId: data.agentId,
                    type: data.typeOfTransaction,
                    category: data.action,
                    amount: +data.amount,
                    previousBalance: (data.action == "credit") ? +parseFloat(addBalance.hallDropsafeBalance - (data.amount)).toFixed(2) : +parseFloat(addBalance.hallDropsafeBalance + (data.amount)).toFixed(2),
                    afterBalance: +parseFloat(addBalance.hallDropsafeBalance).toFixed(2),
                    hall: data.hall,
                    groupHall: data.groupHall,
                    createdAt: Date.now(),
                }
                await Sys.App.Services.HallServices.insertCashSafeData(hallTransaction1);
                
                return {status: "success", message: "Drop Safe Balance Trasferred Successfully." }
            } else {
                console.log("This (" + data.action + ") action not found in hall transactions.");
                throw { "status": "Error", "message": "This (" + data.action + ") action not found in hall transactions." };
            }
        }catch(e){
            console.log("transferToDropSafe error", e)
        }
    },

    checkForLogout: async function(data){
        try{
            const {agentId, hallIDs} = data;
            const sessionsDir = path.join(__dirname, '../sessions');
            const files = await fs.readdir(sessionsDir);
            
            for (const file of files) {
                const sessionFile = path.join(sessionsDir, file);
                let sessionData;
    
                try {
                    const data = await fs.readFile(sessionFile, 'utf8');
                    sessionData = JSON.parse(data);
                } catch (err) {
                    continue; // Skip this file and move to the next one
                }
    
                if (sessionData && sessionData.details) {
                   
                    if (sessionData.details.is_admin == "no" && sessionData.details.id == agentId && hallIDs.includes(sessionData.details.hall[0].id) == true ) {
                        await fs.unlink(sessionFile);
                        break;
                    }
                }
            }
        }catch(e){
            console.log("Error in checkForLogout",e);
        }
    },

    machineApiTransactionsByAgent: async function(data){
        try {
            // Destructure all necessary variables from the `data` object
            const {
                hallId, agentId, playerId, agentName, username, operation, paymentType, amount,
                action, typeOfTransaction, hall, groupHall, userType, playerAfterBalance, machineName,
                machineTicketId, machineTicketNumber
            } = data;
            const hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1 });
            if (!hallData) throw new Error('Hall not found');

            // Update the hall
            const updateFields = {
                "activeAgents.$.dailyBalance":  (paymentType === 'Cash') ? (operation === 'add' ? amount : -amount) : 0,
                "activeAgents.$.totalCashIn": paymentType === "Cash" && operation === 'add' ? amount : 0,
                "activeAgents.$.totalCashOut": paymentType === "Cash" && operation !== 'add' ? amount : 0,
                "activeAgents.$.toalCardIn": paymentType === "Card" && operation === 'add' ? amount : 0,
                "activeAgents.$.totalCardOut": paymentType === "Card" && operation !== 'add' ? amount : 0,
            };

            const updatedHall = await Sys.App.Services.HallServices.updateHall(
                { _id: hallId, "activeAgents.id": agentId },
                { $inc: updateFields },
                { new: true }
            );

            // Update player and agent transactions
            const agent = updatedHall?.activeAgents?.find(e => e.id === agentId);
            const updatedBalance = agent?.dailyBalance;
            const createTransactionRecord = async (type) => {
                console.log("playerAfterBalance--", playerAfterBalance, updatedBalance, amount, paymentType)
                const prevBalance =
                    type === "P" && paymentType !== "customerNumber"
                        ? playerAfterBalance
                        : type === "P"
                            ? action === "credit"
                                ? +parseFloat(playerAfterBalance + amount).toFixed(2)
                                : +parseFloat(playerAfterBalance - amount).toFixed(2)
                            : action === "credit"
                                ? updatedBalance - amount
                                : updatedBalance + amount;
            
                const baseRecord = {
                    transactionId: `${type}TRN${await Sys.Helper.bingo.ordNumFunction(Date.now())}${Math.floor(100000 + Math.random() * 900000)}`,
                    shiftId: agent?.shiftId,
                    hallId, agentId, playerId, agentName, playerName: username, 
                    typeOfTransaction, hall, groupHall, paymentBy: paymentType, userType,
                    previousBalance: type === "H" && paymentType !== "Cash" ? updatedBalance : prevBalance,
                    afterBalance: type === "H" ? updatedBalance : +parseFloat(playerAfterBalance).toFixed(2),
                    createdAt: Date.now(), 'otherData.machineName': machineName, 'otherData.machineTicketId': machineTicketId,
                    'otherData.machineTicketNumber': machineTicketNumber,
                    status: "success",
                };
            
                if (type === "H") {
                    baseRecord.amount = amount; // Include `amount` only for agent transactions
                    baseRecord.category = action;
                }
            
                if (type === "P") {
                    baseRecord.category = action === "credit" ? "debit" : "credit";
                    baseRecord.differenceAmount = amount;
                    baseRecord.typeOfTransactionTotalAmount = amount;
                    baseRecord.defineSlug = "extraTransaction";
                    baseRecord.amtCategory = "realMoney";
                }
                return baseRecord;
            };
            await Sys.Game.Common.Services.PlayerServices.createTransaction(
                await createTransactionRecord("P")
            );

            // If agent not found, mostly when auto close ticket called form server so return
            if(!agent){
                return {
                    status: "success",
                    userwallet: +parseFloat(playerAfterBalance).toFixed(2),
                };
            }
            await Sys.App.Services.AgentServices.insertAgentTransactionData(
                await createTransactionRecord("H")
            );
           
            // update shift record
            const shiftUpdateFields = {
                dailyBalance: (paymentType === "Cash" && operation === 'add' ? amount : (paymentType === "Cash" ? -amount : 0)),
                totalCashIn: (paymentType === "Cash" && operation === 'add' ? amount : 0),
                totalCashOut: (paymentType === "Cash" && operation !== 'add' ? amount : 0),
                toalCardIn: (paymentType === "Card" && operation === 'add' ? amount : 0),
                totalCardOut: (paymentType === "Card" && operation !== 'add' ? amount : 0),
            };
            let shiftData = await Sys.App.Services.AgentServices.updateShiftData(
                { _id: agent.shiftId, hallId: hallId, agentId: agentId },
                { $inc: shiftUpdateFields },
                { new: true }
            );
            
            // Send balance update broadcast if paymentType is Cash
            if (paymentType === "Cash") {
                Sys.Helper.gameHelper.sendHallBalanceUpdateBroadcast({
                    shiftId: shiftData._id.toString(),
                    hallId: shiftData.hallId,
                    dailyBalance: shiftData.dailyBalance,
                    totalDailyBalanceIn: shiftData.totalDailyBalanceIn,
                    totalCashIn: shiftData.totalCashIn,
                    totalCashOut: shiftData.totalCashOut,
                    toalCardIn: shiftData.toalCardIn,
                    totalCardOut: shiftData.totalCardOut,
                    totalHallCashBalance: updatedHall.hallCashBalance
                });
            }
    
            return {
                status: "success",
                userwallet: +parseFloat(playerAfterBalance).toFixed(2),
                dailyBalance: +parseFloat(shiftData.dailyBalance).toFixed(2)
            };
        } catch (e) {
            console.log("machineApiTransactionsByAgent error", e);
            throw new Error('Something went wrong, please try again later');
        }
    },
    
    sendPushNotificationMultiple: async function (message, tokens) {
        return new Promise((resolve, reject) => {
            try {
                FCM.sendToMultipleToken(message, tokens, function (err, response) {
                    if (err) {
                        console.log('Push notification error:', err);
                        reject(err);
                    } else {
                        console.log('Push notification response:', response);
                        resolve();
                    }
                });
            } catch (e) {
                console.log("Unexpected error in sendPushNotificationMultiple:", e);
                reject(e);
            }
        });
    }

}