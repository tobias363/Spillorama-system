const Sys = require('../../../Boot/Sys');
const moment = require('moment');
const fs = require("fs");
const fastcsv = require("fast-csv");
const path = require('path');
const fortuna = require('javascript-fortuna');
fortuna.init();
const exactMath = require('exact-math');
const { i18next, translate } = require('../../../Config/i18n');
const Timeout = require('smart-timeout');
module.exports = {
    Game1Room: async function (socket, data) {
        try {
            let language = "nor";
            if (data.language) {
                language = data.language;
            }
            console.log("Game1Room Event Data", data);
            let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: data.playerId }, { hall: 1, selectedLanguage: 1, bankIdAuth: 1, isVerifiedByHall: 1, isAlreadyApproved: 1 });

            if (player) {
                // check if player is verified or already approved to play the game
                const isVerifiedByBankID = player?.bankIdAuth && Object.keys(player?.bankIdAuth).length > 0 && player?.bankIdAuth.status === "COMPLETED";
                const isVerifiedByHall = player?.isVerifiedByHall;
                const canPlayGames = player?.isAlreadyApproved || isVerifiedByBankID || isVerifiedByHall;
                if(!canPlayGames){
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "verify_to_play_game", language: player.selectedLanguage }),// 'There is no ongoing game. Please try again later',
                        statusCode: 400
                    }
                }
                if (player.hall && player.hall.hasOwnProperty('id') && player.hall.id != "" && player.hall.status == "Approved") {

                    let hall = await Sys.Game.Common.Services.GameServices.getHallData({ _id: player.hall.id, status: "active" });
                    if (hall.length <= 0) {
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({ key: "no_ongoing_game", language: player.selectedLanguage }),  //'There is no ongoing game. Please try again later',
                            statusCode: 400
                        }
                    }

                    let query = {
                        gameType: "game_1",
                        halls: { $in: [player.hall.id] },  // consider only one hall as player can select only 1 hall
                        //status: { $ne: "finish" },
                        $or: [
                            { status: { $ne: "finish" } },
                            { 'otherData.gameSecondaryStatus': "running" }
                        ],
                        stopGame: false,
                        'otherData.isClosed': false,
                        startDate: {
                            $gte: moment().startOf('day').toDate(),
                            $lt: moment().startOf('day').add(2, 'day').toDate()
                        }
                    }

                    let games = await Sys.Game.Game1.Services.GameServices.getByData(query, { gameName: 1, status: 1, players: 1, timerStart: 1, isNotificationSent: 1, stopGame: 1, sequence: 1, gameMode: 1, startDate: 1, graceDate: 1, subGames: 1, otherData: 1 }, { sort: { startDate: 1 } });
                    //let game =  await Sys.Game.Game1.Services.GameServices.getSingleByData(query, {parentGameId: 1}, {startDate: 1});
                    //let dailySchedule =  await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({_id: game.parentGameId}, {}, { });
                    if (games.length > 0) {

                        let status = { 'running': 1, 'active': 2, 'completed': 3, 'finish': 4 };
                        games.sort((a, b) => status[a.status] - status[b.status]);

                        //console.log("sorted games", games);

                        let runningGame = {};
                        let upcomingGame = {};
                        let index = games.findIndex(x => (x.status == 'running' || x.otherData.gameSecondaryStatus == "running"));

                        let replaceAmount = 0;
                        if (index >= 0) {
                            let gameType = "color";
                            if (games[index].gameName == "Elvis") {
                                gameType = "elvis";
                                replaceAmount = games[index].otherData.replaceTicketPrice;
                            } else if (games[index].gameName == "Traffic Light") {
                                gameType = "traffic-light"
                            }

                            let purchasedTicket = 0;
                            let playerIndex = games[index].players.findIndex(x => x.id == data.playerId);
                            if (playerIndex >= 0) {
                                purchasedTicket = games[index].players[playerIndex].totalPurchasedTickets
                            }
                            runningGame = {
                                gameId: games[index]._id,
                                gameName: games[index].gameName,
                                status: games[index].status,
                                purchasedTickets: purchasedTicket,
                                maxPurchaseTicket: 30,
                                gameType: gameType,
                                replaceAmount: replaceAmount
                            }
                        }

                        let upcomingIndex = games.findIndex(x => x.status == 'active');
                        if (upcomingIndex >= 0) {
                            let ticketTypes = [];
                            console.log("current & 1 hour before", moment(games[upcomingIndex].startDate), moment(games[upcomingIndex].startDate).subtract(1, 'h'), moment());
                            if (moment(games[upcomingIndex].startDate).subtract(24, 'h') > moment()) {
                                // return {
                                //     status: 'fail',
                                //     result: null,
                                //     message: 'There is no ongoing game. Please try again later',
                                //     statusCode: 400
                                // }
                            } else {
                                let gameType = "color";
                                if (games[upcomingIndex].gameName == "Elvis") {
                                    gameType = "elvis";
                                    ticketTypes.push({ name: "Elvis", price: games[upcomingIndex].subGames[0].options[0].ticketPrice })
                                } else if (games[upcomingIndex].gameName == "Traffic Light") {
                                    gameType = "traffic-light";
                                    ticketTypes.push({ name: "Traffic Light", price: games[upcomingIndex].subGames[0].options[0].ticketPrice })
                                }

                                if (gameType == "color") {
                                    if (games[upcomingIndex].subGames.length > 0 && games[upcomingIndex].subGames[0].options.length > 0) {
                                        for (let s = 0; s < games[upcomingIndex].subGames[0].options.length; s++) {
                                            ticketTypes.push({ name: games[upcomingIndex].subGames[0].options[s].ticketName, price: games[upcomingIndex].subGames[0].options[s].ticketPrice })
                                        }
                                    }
                                }

                                let purchasedTicket = 0;
                                let playerIndex = games[upcomingIndex].players.findIndex(x => x.id == data.playerId);
                                if (playerIndex >= 0) {
                                    purchasedTicket = games[upcomingIndex].players[playerIndex].totalPurchasedTickets;
                                }
                                upcomingGame = {
                                    gameId: games[upcomingIndex]._id,
                                    gameName: games[upcomingIndex].gameName,
                                    status: games[upcomingIndex].status,
                                    ticketTypes: ticketTypes,
                                    purchasedTickets: purchasedTicket,
                                    maxPurchaseTicket: 30,
                                    gameType: gameType
                                }
                            }

                        }


                        return {
                            status: 'success',
                            result: { runningGame: runningGame, upcomingGame: upcomingGame },
                            message: await translate({ key: "games_found", language: player.selectedLanguage }), //'Games Found',
                            statusCode: 200
                        }
                    } else {
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({ key: "no_ongoing_game", language: player.selectedLanguage }), //'There is no ongoing game. Please try again later',
                            statusCode: 400
                        }
                    }

                    // let dailySchedule = await Sys.Game.Game1.Services.GameServices.getSingleParentGameData(query);

                    // let finalResult = {};
                    // let currentDate = new Date();
                    // let currentDay = moment(currentDate).format('ddd');

                    // // console.log("game found", game ? true : false);
                    // if (game) {
                    //     // console.log("Checking for :::", game.gameName);
                    //     for (const day in game.days) {
                    //         if (Object.hasOwnProperty.call(game.days, day)) {
                    //             const timeSlot = game.days[day];
                    //             // console.log("day Comparison :::", currentDay, "===", day, "?", currentDay === day);
                    //             if (currentDay === day) {
                    //                 let hours = currentDate.getHours();
                    //                 hours = hours < 10 ? '0' + hours : hours;
                    //                 let minutes = currentDate.getMinutes();
                    //                 minutes = minutes < 10 ? '0' + minutes : minutes;
                    //                 let currentTime = `${hours}:${minutes}`;
                    //                 // console.log("currentHours", currentTime, timeSlot, currentTime <= timeSlot[1]);
                    //                 if (currentTime < timeSlot[1]) {
                    //                     console.log("Game available for today's Slot");
                    //                     finalResult = {
                    //                         gameId: game._id.toString(),
                    //                         gameName: game.gameName,
                    //                         namespaceString: 'Game3'
                    //                     }
                    //                 }
                    //                 break;
                    //             }
                    //         }
                    //     }
                    //     if (Object.keys(finalResult).length) {
                    //         return {
                    //             status: 'success',
                    //             result: finalResult,
                    //             message: 'game found',
                    //             statusCode: 200
                    //         }
                    //     } else {
                    //         return {
                    //             status: 'fail',
                    //             result: null,
                    //             message: 'Game not available for today slot',
                    //             statusCode: 400
                    //         }
                    //     }

                    // } else {
                    //     return {
                    //         status: 'fail',
                    //         result: null,
                    //         message: 'Game not available for today slot',
                    //         statusCode: 400
                    //     }
                    // }
                }
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "no_ongoing_game", language: player.selectedLanguage }),// 'There is no ongoing game. Please try again later',
                    statusCode: 400
                }
            } else {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language: language }), // 'Player Not Found',
                    statusCode: 400
                }
            }

        } catch (error) {
            console.log("Error In Game1Room", error);
            return {
                status: 'fail',
                result: null,
                message: await translate({ key: "something_went_wrong", language: language }), //'Something Went Wrong',
                statusCode: 400
            }
        }
    },

    subscribeRoom: async function (socket, data) {
        try {
            let language = "nor";
            if (data.language) {
                language = data.language;
            }

            // to prevent infinite recursive calls
            let callCount = 0;
            if(data?.isInternal && data.isInternal == true){
                callCount = data.callCount;
            }
            // else{
            //     data.gameId = "6644867c6be28008cb08b069";
            // }
            
            console.log("SubscribeRoom: ", data);
            if (data.playerId == null) {
                return {
                    status: 'fail',
                    result: null,
                    messageType: await translate({ key: "player_not_found", language: language }), // 'No Player Found!',
                    statusCode: 400
                }
            }
            if (!data.gameId) {
                return {
                    status: 'fail',
                    result: null,
                    messageType: await translate({ key: "no_ongoing_game", language: language }), // 'There is no ongoing game. Please try again later.',
                    statusCode: 400
                }
            }
            let player = await await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: data.playerId }, { status: 1, hall: 1, selectedLanguage: 1 });
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    messageType: await translate({ key: "player_not_found", language: player.selectedLanguage }), // 'No Player Found!',
                    statusCode: 401
                }
            }
            if (player.status.toLowerCase() != 'active') {
                return {
                    status: 'fail',
                    result: null,
                    messageType: await translate({ key: "player_not_active", language: player.selectedLanguage }), // 'Player is Not Active!',
                    statusCode: 401
                }
            }
            let query = {
                _id: data.gameId,
                halls: { $in: [player.hall.id] },  // consider only one hall as player can select only 1 hall
                //status: { $ne: "finish" },
                stopGame: false,
                'otherData.gameSecondaryStatus': { $ne: "finish" },
                'otherData.isClosed': false,
                startDate: {
                    $gte: moment().startOf('day').toDate(),
                    $lt: moment().startOf('day').add(2, 'day').toDate()
                }
            }
            let room = await Sys.Game.Game1.Services.GameServices.getSingleByData(query, { players: 1, subGames: 1, status: 1, withdrawNumberList: 1, winners: 1, gameName: 1, jackpotPrize: 1, parentGameId: 1, earnedFromTickets: 1, otherData: 1, sequence: 1, isNotificationSent: 1, adminWinners: 1, jackpotDraw: 1, countDownDateTime: 1 });

            if (room == null) {
                // if game not found then check for next game, if it is there then pass data for that game
                const resp= await module.exports.checkForUpcomingGameForSubscribeRoom(socket, {language: player.selectedLanguage, playerId: data.playerId, callCount: callCount}); 
                if(resp && resp.status == "fail"){
                    resp.messageType = resp.message;
                    return resp;
                }
                return resp;
                // return {
                //     status: 'fail',
                //     result: null,
                //     messageType: await translate({ key: "game_not_found", language: language }),
                //     message: await translate({ key: "game_not_found", language: language }),
                // };
            }

            if (room.gameName != "Mystery" && room.gameName != "Color Draft" && room.gameName != "Wheel of Fortune" && room.gameName != "Treasure Chest") {
                if (room.status == "finish") {
                    // if game not found then check for next game, if it is there then pass data for that game
                    const resp= await module.exports.checkForUpcomingGameForSubscribeRoom(socket, {language: player.selectedLanguage, playerId: data.playerId, callCount: callCount}); 
                    if(resp && resp.status == "fail"){
                        resp.messageType = resp.message;
                        return resp;
                    }
                    return resp;
                    // return {
                    //     status: 'fail',
                    //     result: null,
                    //     messageType: await translate({ key: "game_not_available", language: player.selectedLanguage }), // "No Game Available",
                    //         message: await translate({ key: "game_not_available", language: player.selectedLanguage }), // 'Game data is not found'
                    // }
                }
            } else {
                if (room.gameName == "Mystery") {
                    if (room.status == "finish" && room.otherData.mysteryTurnCounts > 4) {
                        // if game not found then check for next game, if it is there then pass data for that game
                        const resp= await module.exports.checkForUpcomingGameForSubscribeRoom(socket, {language: player.selectedLanguage, playerId: data.playerId, callCount: callCount}); 
                        if(resp && resp.status == "fail"){
                            resp.messageType = resp.message;
                            return resp;
                        }
                        return resp;
                        // return {
                        //     status: 'fail',
                        //     result: null,
                        //     messageType: await translate({ key: "game_not_available", language: player.selectedLanguage }), // "No Game Available",
                        //     message: await translate({ key: "game_not_available", language: player.selectedLanguage }), // 'Game data is not found'
                        //     selectedLanguage: player.selectedLanguage
                        // }
                    }
                } else if (room.gameName == "Color Draft" || room.gameName == "Wheel of Fortune" || room.gameName == "Treasure Chest") {
                    if (room.status == "finish" && room.otherData.isMinigameFinished == true) {
                        // if game not found then check for next game, if it is there then pass data for that game
                        const resp= await module.exports.checkForUpcomingGameForSubscribeRoom(socket, {language: player.selectedLanguage, playerId: data.playerId, callCount: callCount}); 
                        if(resp && resp.status == "fail"){
                            resp.messageType = resp.message;
                            return resp;
                        }
                        return resp;
                        // return {
                        //     status: 'fail',
                        //     result: null,
                        //     messageType: await translate({ key: "game_not_available", language: player.selectedLanguage }), // "No Game Available",
                        //     message: await translate({ key: "game_not_available", language: player.selectedLanguage }), // 'Game data is not found'
                        // }
                    }
                }

            }
            let playerTotalBetAmount = 0;
            if (room.players) {
                Sys.Game.Game1.Services.GameServices.updateGameNested({
                    _id: room._id, "players.id": data.playerId
                },
                    {
                        $set: {
                            "players.$.socketId": socket.id,
                            "players.$.isPlayerOnline": true
                        },
                    },
                    { new: true }
                );

                if (room.players.length > 0) {
                    let isPlayer = room.players.findIndex(x => x.id == data.playerId);
                    if (isPlayer >= 0) {
                        playerTotalBetAmount = room.players[isPlayer].ticketPrice;
                    }
                }
            }

            socket.join(room._id); // Subscribe Room.
            socket.myData = {};

            socket.myData.playerID = data.playerId;
            socket.myData.gameId = room._id;
            socket.myData.gameType = 'game_1';
            socket.myData.gameName = 'Spillorama';
            socket.myData.isAdmin = false;
            console.log("Socket While Join Room: ", socket.id, socket.myData);

            /*let patternListTemp = Object.keys(room.subGames[0].options[0].winning);
            if(room.gameName == "Super Nils"){
                patternListTemp = Object.keys(room.subGames[0].options[0].winning.B)
            }
            function getHighestPrice(pattern){
                if(room.gameName == "Super Nils"){
                    let allWinningOptions = room.subGames[0].options[0].winning;
                    //console.log("allWinningOptions--", allWinningOptions)
                    let highestWinning = 0;
                    for (const patterwinning in allWinningOptions) {
                        let winning = allWinningOptions[patterwinning][pattern];
                        //console.log("winning---", winning);
                        if(+winning > +highestWinning){
                            highestWinning = +winning;
                        }
                        //console.log("highestWinning", winning, highestWinning)
                    }
                    return highestWinning;
                }else if(room.gameName == "Spillerness Spill" || room.gameName == "Spillerness Spill 2" || room.gameName == "Spillerness Spill 3"){
                    let winningPercentage = room.subGames[0].options[0].winning[pattern];
                    let winningAmountSpill = +parseFloat(exactMath.div( exactMath.mul(room.earnedFromTickets, winningPercentage),  100) ).toFixed(2);
                    console.log("winningPercentage and amount of spillerness game", winningPercentage, winningAmountSpill)
                    if(room.gameName == "Spillerness Spill" || room.gameName == "Spillerness Spill 2"){
                        let minimumWinningAmount = room.subGames[0].options[0].minimumWinning[pattern];
                        if(minimumWinningAmount && minimumWinningAmount > 0){
                            if( minimumWinningAmount > winningAmountSpill ){
                                winningAmountSpill = minimumWinningAmount;
                            }
                        }
                    }
                    return winningAmountSpill;
                    
                }else{
                    let allWinningOptions = room.subGames[0].options;
                    let highestWinning = 0;
                    if(allWinningOptions.length > 0){
                        for(let i=0; i < allWinningOptions.length; i++){
                            let patternListTemp = allWinningOptions[i].winning;
                            if(room.gameName == "Super Nils"){
                                patternListTemp =  allWinningOptions[i].winning.B
                            }
                            //console.log("patternListTemp in finding highest winning", patternListTemp);
                            let winning = patternListTemp[pattern];
                            //console.log("winning---", winning)
                            if(+winning > +highestWinning){
                                highestWinning = +winning;
                            }
                            //console.log("highestWinning", winning, highestWinning)
                        }
                        return highestWinning;
                    }
                }
                
            }
            let patternList = [];
            if(patternListTemp.length > 0){
                for(let p=0; p< patternListTemp.length; p++){
                    if(patternListTemp[p] == "Row 1" ){ patternList.push({name: "Row 1", patternDesign : 1, patternDataList: [], amount: getHighestPrice("Row 1"), message: ""}) }
                    else if(patternListTemp[p] == "Row 2"){patternList.push({name: "Row 2", patternDesign : 2, patternDataList: [], amount: getHighestPrice("Row 2"), message: ""}) }
                    else if(patternListTemp[p] == "Row 3"){ patternList.push({name: "Row 3", patternDesign : 3, patternDataList: [], amount: getHighestPrice("Row 3"), message: ""}) }
                    else if(patternListTemp[p] == "Row 4"){ patternList.push({name: "Row 4", patternDesign : 4, patternDataList: [], amount: getHighestPrice("Row 4"), message: ""}) }
                    else if(patternListTemp[p] == "Picture"){patternList.push({name: "Picture", patternDesign : 0, patternDataList: [0,0,0,0,0, 0,1,1,1,0, 0,1,1,1,0, 0,1,1,1,0, 0,0,0,0,0], amount: getHighestPrice("Picture"), message: ""}) }
                    else if(patternListTemp[p] == "Frame"){patternList.push({name: "Frame", patternDesign : 0, patternDataList: [1,1,1,1,1, 1,0,0,0,1, 1,0,1,0,1, 1,0,0,0,1, 1,1,1,1,1], amount: getHighestPrice("Frame"), message: ""}) }
                    else if(patternListTemp[p] == "Full House"){ 
                        let winningAmount = 0;
                        let message = "";
                        if(room.gameName == "Jackpot"){
                            //winningAmount = room.jackpotPrize;
                            let jackpotPrizeTemp = Object.values(room.jackpotPrize);
                            console.log("jackpotPrizeTemp--", jackpotPrizeTemp)
                            winningAmount = Math.max(...jackpotPrizeTemp);
                            message = "Jackpot Winning"
                        }else if(room.gameName == "Wheel of Fortune" || room.gameName == "Treasure Chest"){
                            if(room.gameName == "Wheel of Fortune"){
                                message = "Spin Wheel of Fortune to Win";
                                let wheelOfFortuneList = await Sys.App.Services.otherGameServices.getByData({ slug: 'wheelOfFortune' });
                                winningAmount = Math.max.apply(null, wheelOfFortuneList.wheelOfFortuneprizeList);
                            }else{
                                message = "Open Treasure Chest to Win";
                                let treasureChestList = await Sys.App.Services.otherGameServices.getByData({ slug: 'treasureChest' });
                                winningAmount = Math.max.apply(null, treasureChestList.treasureChestprizeList);
                            }
                        }else if(room.gameName == "Oddsen 56"){
                            let oddsendPrize  = getHighestPrice("Full House Within 56 Balls");
                            let fullHousePrize = getHighestPrice("Full House");
                            console.log("oddsendPrize & fullHousePrize", oddsendPrize, fullHousePrize)
                            winningAmount = (oddsendPrize > fullHousePrize) ? oddsendPrize : fullHousePrize;
                        }else if(room.gameName == "Oddsen 57"){
                            let oddsendPrize  = getHighestPrice("Full House Within 57 Balls");
                            let fullHousePrize = getHighestPrice("Full House");
                            console.log("oddsendPrize & fullHousePrize", oddsendPrize, fullHousePrize)
                            winningAmount = (oddsendPrize > fullHousePrize) ? oddsendPrize : fullHousePrize;
                        }else if(room.gameName == "Oddsen 58"){
                            let oddsendPrize  = getHighestPrice("Full House Within 58 Balls");
                            let fullHousePrize = getHighestPrice("Full House");
                            console.log("oddsendPrize & fullHousePrize", oddsendPrize, fullHousePrize)
                            winningAmount = (oddsendPrize > fullHousePrize) ? oddsendPrize : fullHousePrize;
                        }else if(room.gameName == "Innsatsen"){
                            let dailySchedule = await Sys.App.Services.scheduleServices.getSingleDailySchedulesData({ _id: room.parentGameId},{innsatsenSales: 1},{});
                            console.log("dailySchedule---", dailySchedule.innsatsenSales);
                            let innBeforeSales = +parseFloat(dailySchedule.innsatsenSales).toFixed(2);
                            let fullhousePrize = +parseFloat(room.subGames[0].options[0].winning['Full House']).toFixed(2);;
                            console.log("fullhousePrize & sales", fullhousePrize, innBeforeSales);
                            if(room.status != "running"){
                                let currentGameSalesTemp = +parseFloat(room.earnedFromTickets).toFixed(2);
                                let currentGameSales = +parseFloat(exactMath.div( exactMath.mul(currentGameSalesTemp, 20),  100) ).toFixed(2);
                                winningAmount = ( (innBeforeSales + fullhousePrize + currentGameSales) >= 2000 ) ? 2000 : (innBeforeSales + fullhousePrize + currentGameSales);
                            }else{
                                winningAmount = (innBeforeSales + fullhousePrize);
                            }
                            
                        }else{
                            winningAmount = getHighestPrice("Full House");
                            
                        }
                        patternList.push({name: "Full House", patternDesign : 0, patternDataList: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], amount: winningAmount, message: message}) 
                    }
                }
            }*/

            let patternListing = await Sys.Game.Game1.Controllers.GameProcess.patternListing(room._id);
            let patternList = patternListing.patternList;
            console.log("patternListing---", patternListing, patternList);

            const winningCombinations = [...new Set(room.winners.map(item => item.lineType))];
            let finalPatternList = [];
            for (let p = 0; p < patternList.length; p++) {
                if (winningCombinations.includes(patternList[p].name) == false) {
                    patternList[p].isWon = false;
                    finalPatternList.push(patternList[p]);
                } else {
                    patternList[p].isWon = true;
                    finalPatternList.push(patternList[p]);
                }
            }
            //finalPatternList = finalPatternList.map(({patternDesign,patternDataList})  => ({patternDesign, patternDataList}));
            //console.log("patternList in subscribe", patternList, winningCombinations, finalPatternList)
            let allPurchasedTickets = await Sys.Game.Game1.Services.GameServices.getTicketListData({ playerIdOfPurchaser: player._id, gameId: room._id }, { ticketId: 1, ticketParentId: 1, ticketPrice: 1, hallName: 1, ticketColorName: 1, ticketColorType: 1, tickets: 1, isTicketSubmitted: 1, supplier: 1, developer: 1 });

            let ticketsArr = [];
            for (let i = 0; i < allPurchasedTickets.length; i++) {
                let ticketColor = allPurchasedTickets[i].ticketColorName;
                if (allPurchasedTickets[i].ticketColorType == "elvis") {
                    ticketColor = allPurchasedTickets[i].ticketColorName.slice(6);
                }
                let ticketCellNumberList = [];
                for (let t = 0; t < allPurchasedTickets[i].tickets.length; t++) {
                    for (let n = 0; n < allPurchasedTickets[i].tickets[t].length; n++) {
                        ticketCellNumberList.push(allPurchasedTickets[i].tickets[t][n].Number)
                    }
                }
                let ticketData = {
                    id: allPurchasedTickets[i].id,
                    ticketNumber: allPurchasedTickets[i].ticketId,
                    ticketPrice: allPurchasedTickets[i].ticketPrice,
                    ticketCellNumberList: ticketCellNumberList,
                    hallName: allPurchasedTickets[i].hallName,
                    ticketCompleted: allPurchasedTickets[i].ticketCompleted,
                    ticketColor: ticketColor,
                    ticketCompleted: allPurchasedTickets[i].isTicketSubmitted,
                    supplierName: allPurchasedTickets[i].supplier,
                    developerName: allPurchasedTickets[i].developer,
                }
                ticketsArr.push(ticketData);
            }

            let editLuckyFlag = (room.status == 'active') ? true : false;
            let playerLuckyNumber = room.players.find(item => JSON.stringify(item.id) == JSON.stringify(player._id));
            console.log("playerLuckyNumber---", playerLuckyNumber)
            let onlinePlayers = await getOnlinePlayers('/Game1', room._id);
            console.log("online players in subscribe room", onlinePlayers)
            Sys.Io.of(Sys.Config.Namespace.Game1).to(room._id).emit('GameOnlinePlayerCount', { onlinePlayerCount: onlinePlayers });
            // let mysteryGameData = {};
            // if(room.gameName == "Mystery"){
            //     mysteryGameData = {
            //         history: room.otherData.mysteryHistory,
            //         turnCounts: room.otherData.mysteryTurnCounts
            //     }
            // }
            let totalWon = 0;
            if (room.adminWinners.length > 0) {
                totalWon = (room.adminWinners).filter(i => i.playerId == data.playerId).reduce((acc, current) => acc + current.wonAmount, 0)
            }
            
            // Jackpot games count and winnings
            const jackPotData = await module.exports.getJackpotData(
                room.gameName,
                room.withdrawNumberList.length,
                room.jackpotDraw,
                room.jackpotPrize,
                room.subGames,
                room.parentGameId
            );
            console.log("subscribe player jackpotData---", jackPotData)
            let minigameData = {};
            if (room.status == "finish" && (room.gameName == "Wheel of Fortune" || room.gameName == "Treasure Chest")) {
                let prizeList = [];
                let currentTurnCountTimer = 10;
                if (room.gameName == "Wheel of Fortune") {
                    let wheelOfFortuneList = await Sys.App.Services.otherGameServices.getByData({ slug: 'wheelOfFortune' });
                    prizeList = wheelOfFortuneList.wheelOfFortuneprizeList;
                } else {
                    let treasureChestList = await Sys.App.Services.otherGameServices.getByData({ slug: 'treasureChest' });
                    prizeList = treasureChestList.treasureChestprizeList;
                }

                /*let currentTurnCountTimerTemp = room.otherData.miniGamestartTimeMs - ( (new Date()).getTime() - 10000 )
                if(currentTurnCountTimerTemp > 0){
                    currentTurnCountTimer =  Math.round(currentTurnCountTimerTemp/1000)
                }*/

                if (Timeout.exists(room._id.toString())) {
                    let currentTurnCountTimerTemp = Timeout.remaining(room._id.toString());
                    if (currentTurnCountTimerTemp) {
                        currentTurnCountTimer = Math.ceil(currentTurnCountTimerTemp / 1000);
                    }
                    console.log("timeout remianing of minigames", currentTurnCountTimer)
                }

                minigameData = {
                    "gameName": room.gameName,
                    "isDisplayWheel": true,
                    "isMinigameActivated": room.otherData.isMinigameActivated,
                    "isMinigamePlayed": room.otherData.isMinigamePlayed,
                    "isMinigameFinished": room.otherData.isMinigameFinished,
                    "wonAmount": (room.otherData.miniGameResults && room.otherData.miniGameResults.length > 0) ? room.otherData.miniGameResults[0].winningAmount : 0,
                    "prizeList": prizeList,
                    "turnTimer": parseInt(currentTurnCountTimer),
                    "isWofSpinStopped": room?.otherData?.isWofSpinStopped ?? false, // it will be true for wof after spin stopped broadcast sent
                }
            }

            minigameData.playerId = "";
            if (room.status == "finish" && room.otherData.isMinigameActivated == true) {
                if (room.winners.length > 0) {
                    let isIndex = room.winners.findIndex((e) => (e.enabledSpinner == true));
                    if (isIndex >= 0) {
                        minigameData.playerId = room.winners[isIndex].playerId;
                    }
                }
            }
            console.log("minigameData of reconnection", minigameData)
            let result = {
                activePlayers: onlinePlayers, //playerNewCouont,
                editLuckyNumber: editLuckyFlag, // [ True = Game Not Start ]
                luckyNumber: (playerLuckyNumber) ? playerLuckyNumber.luckyNumber : "",
                maxWithdrawCount: 75,
                patternList: finalPatternList,
                totalWithdrawCount: room.withdrawNumberList.length,
                withdrawNumberList: room.withdrawNumberList,
                ticketList: ticketsArr,
                gameId: room._id.toString(),
                replaceAmount: (room.gameName == "Elvis") ? room.otherData.replaceTicketPrice : 0,
                gameStatus: (room.status == "finish") ? "Finished" : room.status,
                gameName: (room.gameName == "Mystery") ? "Mystery" : room.gameName,
                //mysteryGameData: mysteryGameData
                gameCount: room.sequence,
                disableBuyAfterBalls: 3,
                totalBetAmount: playerTotalBetAmount,
                isReplaceDisabled: room.isNotificationSent,  // use for elvis replace ticket
                totalWon: +totalWon,
                jackPotData: jackPotData,
                minigameData: minigameData,
                isGamePaused: (room.otherData.isPaused == true) ? true : false,
                pauseGameMessage: await translate({ key: "pause_message", language: language }), //"Checking the claimed tickets."
                countDownDateTime: room.countDownDateTime
            };
            console.log("result of subscribe room", result)
            await Sys.Io.of(Sys.Config.Namespace.Game1).to(socket.id).emit('SubscribeRoom', result);
            return {
                status: 'success',
                result: result,
                message: 'Player Subscribed Successfuly.'
            };

        } catch (e) {
            console.log("Error in subscribeRoom : ", e);
            return new Error(e);
        }
    },

    PurchaseGame1Tickets: async function (socket, data) {
        try {

            let language = "nor";
            if (data.language) {
                language = data.language;
            }
            console.log("start purchase ticket", data)
            if (data.purchaseType == null) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "purchasetype_not_found", language: language }), // 'PurchaseType is not found',
                }
            }
            let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: data.playerId }, { userType: 1, uniqueExpiryDate: 1, isCreatedByAdmin: 1, hall: 1, username: 1, points: 1, walletAmount: 1, monthlyWallet: 1, monthlyWalletAmountLimit: 1, uniqueId: 1, socketId: 1, selectedLanguage: 1 });
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language: language }), // 'No Player Found!',
                    statusCode: 400
                }
            }
            let room = await await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, { halls: 1 });
            if (!room) {
                return {
                    status: 'fail',
                    result: null,
                    messageType: await translate({ key: "game_not_found", language: player.selectedLanguage }), // "No Game Available",
                    message: await translate({ key: "game_not_found", language: player.selectedLanguage }), // 'Game data is not found'
                }
            }

            let hallData = await Sys.Game.Common.Services.GameServices.getSingleHallData({ _id: player.hall.id })
            console.log("hallData>>>>", hallData.ip);
            let ip = socket.conn.remoteAddress
            console.log("socket.handshake",socket.handshake);
            ip = socket.handshake.headers['x-forwarded-for'] ? socket.handshake.headers['x-forwarded-for'].split(',')[0] : socket.conn.remoteAddress;
            ip = convertIPv6MappedToIPv4(ip);
            console.log("ip hall>>>>", hallData.ip);
            console.log("plyaer hall>>>>", ip);
            let userTicketType = ip == hallData.ip ? 'Terminal' : 'Web'
            // check for voucher 
            let voucherData = '';
            let vId = '';
            if (data.voucherCode != undefined && data.voucherCode != null && data.voucherCode != "") {

                let vocherTransaction = await Sys.Game.Common.Services.PlayerServices.transactionData({ playerId: data.playerId, voucherCode: data.voucherCode })
                //console.log('vocherTransaction2: ', vocherTransaction[0]);
                if (vocherTransaction.length == 0) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "vourcher_not_purchased", language: player.selectedLanguage }), // 'This Voucher Code is not Purchased by You..!!',
                        statusCode: 400
                    }
                }

                if (!vocherTransaction[0].isVoucherApplied) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "voucher_not_applied", language: player.selectedLanguage }), // 'This Voucher Code is not Applied by You..!!',
                        statusCode: 400
                    }
                }

                voucherData = await Sys.App.Services.VoucherServices.getSingleData({ _id: vocherTransaction[0].voucherId });
                vId = vocherTransaction[0]._id;
                if (!voucherData) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "voucher_not_valid", language: player.selectedLanguage }), //'This Voucher is not Vaild or Deleted by Admin!!',
                    }
                }

                if (voucherData.status != 'active') {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "voucher_blocked", language: player.selectedLanguage }), // 'This Voucher is Blocked by Admin!!',
                    }
                }

                let currentDate = Date.now();
                let expiryDate = new Date(voucherData.expiryDate);
                if (currentDate > expiryDate) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "voucher_expired", language: player.selectedLanguage }), //'This Voucher is Expired',
                    }
                }

            }

            //let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: data.playerId}, {userType: 1, uniqueExpiryDate: 1, isCreatedByAdmin: 1, hall: 1, username: 1, points: 1, walletAmount: 1, monthlyWallet: 1, monthlyWalletAmountLimit: 1, uniqueId: 1, socketId: 1});
            if (player) {

                let gameData = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId, status: { $in: ['active', 'running'] } }, { graceDate: 1, startDate: 1, halls: 1, subGames: 1, gameName: 1, gameNumber: 1, players: 1, disableTicketPurchase: 1, parentGameId: 1, day: 1, stopGame: 1 });

                if (gameData === null) {
                    console.log("something went wrong, game data not found")
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "game_started", language: player.selectedLanguage }), // 'Game Already Started',
                        statusCode: 401
                    }
                }

                // if (gameData.graceDate <= Date.now()) {
                //     return {
                //         status: 'fail',
                //         result: null,
                //         message: 'Game Time is Over',
                //         statusCode: 401
                //     }
                // }

                if (gameData.disableTicketPurchase == true) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "ticket_purchase_disabled", language: player.selectedLanguage }), // 'Ticket purchase has been disabled for this game',
                        statusCode: 401
                    }
                }
                if (gameData.stopGame == true) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "something_went_wrong", language: player.selectedLanguage }), // 'Something went wrong',
                        statusCode: 401
                    }
                }

                // check for game time and unique id expired time
                if (player.userType == "Unique") {
                    if (player.uniqueExpiryDate <= gameData.startDate) {
                        console.log("Your Unique Id will be Expired before starting of the game, please Contact Administrator.")
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({ key: "unique_id_will_expire", language: player.selectedLanguage }), // 'Your Unique Id will be Expired before starting of the game, please Contact Administrator.',
                            statusCode: 401
                        }
                    }
                }

                // check player is allowed or not to play in defined halls
                //console.log("halls of game and player", gameData.halls, player.hall);
                if (gameData.halls.length > 0) {
                    if (player.userType == "Unique" && player.isCreatedByAdmin == true) {
                        console.log("Unique userType with admin creator, so no need to check for hall")
                    } else {
                        let playerHalls = [];
                        if (player.hall.status == "Approved") {
                            playerHalls.push(player.hall.id.toString());
                        }
                        let gameHalls = gameData.halls.map(function (item) {
                            return item.toString();
                        });
                        console.log("player approved halls", playerHalls, gameHalls)
                        const isHallmatched = playerHalls.some(r => gameHalls.includes(r));
                        console.log("isHallmatched", isHallmatched)
                        if (isHallmatched == false) {
                            return {
                                status: 'fail',
                                result: null,
                                message: await translate({ key: "not_allowed_to_play_in_hall", language: player.selectedLanguage }), // 'You are not allowed to play in this hall!',
                                statusCode: 401
                            }
                        }
                    }
                }

                // Get total ticket price from subgame tickets
                let subgame = gameData.subGames[0].options;
                let TotalAmountOfTickets = 0;
                let ticketColorTypeArray = [];
                let ticketQnty = 0;
                const ticketDetails = {};
                let playerPurTickets = JSON.parse(data.purchasedTickets).list;
                //let playerPurTickets = [{ticketName: 'Large Yellow', ticketQty: 3}, {ticketName: 'Small Yellow', ticketQty: 3}]; //[{ticketName: 'Large Yellow', ticketQty: 3}, {ticketName: 'Small Yellow', ticketQty: 3}];
                console.log("playerPurTickets", playerPurTickets, typeof playerPurTickets)
                if (gameData.gameName == "Traffic Light") {
                    //let playerPurTicketsTemp = [{ticketName: 'Traffic Light', ticketQty: 4}];

                    /*let ticketQnty = playerPurTickets[0].ticketQty;
                    playerPurTickets = [];
                    if(gameData.subGames[0].ticketColorTypes.length > 0){
                        for(let t=0; t < gameData.subGames[0].ticketColorTypes.length; t++){
                            playerPurTickets.push({ticketName: gameData.subGames[0].ticketColorTypes[t], ticketQty: ticketQnty})
                        }
                    }*/
                    //playerPurTickets = [{ticketName: 'Small Red', ticketQty: playerPurTickets[0].ticketQty}, {ticketName: 'Small Yellow', ticketQty: playerPurTickets[0].ticketQty}, {ticketName: 'Small Green', ticketQty: playerPurTickets[0].ticketQty}]

                    let ticketQ = playerPurTickets[0].ticketQty;
                    playerPurTickets = [];
                    playerPurTickets.push({ ticketName: 'Traffic Light', ticketQty: ticketQ })

                } else if (gameData.gameName == "Elvis") {
                    //let playerPurTicketsTemp = [{ticketName: 'Elvis', ticketQty: 2}];
                    let elvisQnty = playerPurTickets[0].ticketQty;

                    let selectedElvisinAdminTemp = gameData.subGames[0].ticketColorTypes;
                    let selectedElvisinAdmin = [1, 2, 3, 4, 5];
                    if (gameData.subGames[0].ticketColorTypes.length > 0) {
                        selectedElvisinAdmin = selectedElvisinAdminTemp.map((element, index) => {
                            return parseInt(element.slice(11));
                        });
                    }
                    console.log("selectedElvisinAdmin", selectedElvisinAdmin);

                    let selected = randomWithProbability(elvisQnty, selectedElvisinAdmin);
                    //console.log("selected", selected);
                    playerPurTickets = [];
                    for (let s = 0; s < selected.length; s++) {
                        playerPurTickets.push({ ticketName: 'Small Elvis' + selected[s], ticketQty: 1 })
                    }
                    //console.log("playerPurTicketsTemp elvis tickets", playerPurTicketsTemp)
                }
                console.log("playerPurTickets final", playerPurTickets);
                if (subgame.length > 0) {
                    let isTicketsFound = false;

                    if (playerPurTickets.length > 0) {
                        for (let p = 0; p < playerPurTickets.length; p++) {
                            if (gameData.gameName == "Traffic Light" && playerPurTickets[p].ticketName == "Traffic Light") {
                                isTicketsFound = true;
                                TotalAmountOfTickets += subgame[0].ticketPrice * parseInt(playerPurTickets[p].ticketQty);
                                let availableTrafficLightTickets = [];
                                for (let t = 0; t < subgame.length; t++) {
                                    Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId }, {
                                        $inc: { 'subGames.$[].options.$[o].totalPurchasedTickets': (parseInt(playerPurTickets[p].ticketQty)) }
                                    }, { arrayFilters: [{ "o.ticketName": subgame[t].ticketName }], new: true });
                                    availableTrafficLightTickets.push(subgame[t].ticketName);
                                }
                                for (let c = 0; c < parseInt(playerPurTickets[p].ticketQty); c++) {
                                    for (let t = 0; t < availableTrafficLightTickets.length; t++) {
                                        if (availableTrafficLightTickets[t] == 'Small Red') {
                                            console.log("Small Red ticket found", availableTrafficLightTickets[t]);

                                            ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(1)).fill({ ticketName: availableTrafficLightTickets[t], price: subgame[0].ticketPrice, type: "traffic-red" }));
                                            ticketQnty = ticketQnty + 1;


                                        } else if (availableTrafficLightTickets[t] == 'Small Yellow') {
                                            console.log("Small Yellow ticket found", availableTrafficLightTickets[t]);

                                            ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(1)).fill({ ticketName: availableTrafficLightTickets[t], price: subgame[0].ticketPrice, type: "traffic-yellow" }));
                                            ticketQnty = ticketQnty + 1;

                                        } else if (availableTrafficLightTickets[t] == 'Small Green') {
                                            console.log("Small Green ticket found", availableTrafficLightTickets[t]);

                                            ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(1)).fill({ ticketName: availableTrafficLightTickets[t], price: subgame[0].ticketPrice, type: "traffic-green" }));
                                            ticketQnty = ticketQnty + 1;

                                        }
                                    }
                                }

                            } else {
                                const index = subgame.findIndex((e) => e.ticketName == playerPurTickets[p].ticketName);
                                if (index != -1) {
                                    isTicketsFound = true;
                                    console.log("subgame[s].ticketPrice & total tickets to purchase", playerPurTickets[p].ticketName, playerPurTickets[p].ticketQty);

                                    Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId }, {
                                        $inc: { 'subGames.$[].options.$[o].totalPurchasedTickets': (parseInt(playerPurTickets[p].ticketQty)) }
                                    }, { arrayFilters: [{ "o.ticketName": playerPurTickets[p].ticketName }], new: true });

                                    TotalAmountOfTickets += subgame[index].ticketPrice * parseInt(playerPurTickets[p].ticketQty);
                                    //ticketColorTypeArray.push({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice });

                                    if (gameData.gameName == "Traffic Light" && playerPurTickets[p].ticketName.includes('Small Red')) {
                                        console.log("Small Red ticket found", playerPurTickets[p].ticketName);

                                        ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "traffic-red" }));
                                        ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty);


                                    } else if (gameData.gameName == "Traffic Light" && playerPurTickets[p].ticketName.includes('Small Yellow')) {
                                        console.log("Small Yellow ticket found", playerPurTickets[p].ticketName);

                                        ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "traffic-yellow" }));
                                        ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty);

                                    } else if (gameData.gameName == "Traffic Light" && playerPurTickets[p].ticketName.includes('Small Green')) {
                                        console.log("Small Green ticket found", playerPurTickets[p].ticketName);

                                        ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "traffic-green" }));
                                        ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty);

                                    }

                                    else if (playerPurTickets[p].ticketName.toLowerCase().includes('elvis1')) {
                                        console.log("elvis1 ticket found", playerPurTickets[p].ticketName);

                                        ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty * 2)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "elvis" }));
                                        ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty * 2);

                                    } else if (playerPurTickets[p].ticketName.toLowerCase().includes('elvis2')) {
                                        console.log("elvis2 ticket found", playerPurTickets[p].ticketName);

                                        ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty * 2)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "elvis" }));
                                        ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty * 2);

                                    } else if (playerPurTickets[p].ticketName.toLowerCase().includes('elvis3')) {
                                        console.log("elvis3 ticket found", playerPurTickets[p].ticketName);

                                        ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty * 2)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "elvis" }));
                                        ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty * 2);

                                    } else if (playerPurTickets[p].ticketName.toLowerCase().includes('elvis4')) {
                                        console.log("elvis4 ticket found", playerPurTickets[p].ticketName);

                                        ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty * 2)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "elvis" }));
                                        ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty * 2);

                                    } else if (playerPurTickets[p].ticketName.toLowerCase().includes('elvis5')) {
                                        console.log("elvis5 ticket found", playerPurTickets[p].ticketName);

                                        ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty * 2)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "elvis" }));
                                        ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty * 2);

                                    }

                                    else if (playerPurTickets[p].ticketName.toLowerCase().includes('small')) {
                                        console.log("small ticket found", playerPurTickets[p].ticketName);
                                        ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "small" }));
                                        ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty);
                                    } else if (playerPurTickets[p].ticketName.toLowerCase().includes('large')) {
                                        console.log("large ticket found", playerPurTickets[p].ticketName);
                                        ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty * 3)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "large" }));
                                        ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty * 3);
                                    }

                                    //ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty)).fill({ ticketType: subgame[index].ticketType, price: subgame[index].ticketPrice, ticketColorName: subgame[index].ticketName }));

                                    //ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty);
                                } else {
                                    isTicketsFound = false;
                                    break;
                                }
                            }
                        }
                    } else {
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({ key: "select_tickets", language: player.selectedLanguage }), // 'Plese Select Tickets',
                        }
                    }

                    if (isTicketsFound == false) {
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({ key: "something_went_wrong", language: player.selectedLanguage }), // 'Something went wrong!',
                        }
                    }
                    //console.log("TotalAmountOfTickets and ticketColorTypeArray",ticketQnty, TotalAmountOfTickets, ticketColorTypeArray)

                } else {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "ticket_not_found", language: player.selectedLanguage }), // 'No tickets found',
                    }
                }

                // check how many tickets player can purchase
                let alreadyPurchaseCount = await Sys.Game.Game1.Services.GameServices.getTicketCount({ playerIdOfPurchaser: player._id, gameId: gameData._id });
                if (alreadyPurchaseCount >= 30) {
                    return {
                        status: 'fail',
                        result: {
                            playerId: player._id,
                            username: player.username,
                        },
                        message: await translate({ key: "already_purchased_tickets", language: player.selectedLanguage }), // 'Sorry ..!! You have already purchased 30 tickets , now can`t purchased anymore..!!  ',
                        statusCode: 401
                    }
                } else {
                    if (parseInt(alreadyPurchaseCount) + parseInt(ticketQnty) > 30) {
                        let purchaseCount = 30 - parseInt(alreadyPurchaseCount);
                        if (gameData.gameName == "Elvis") {
                            purchaseCount = parseInt(purchaseCount / 2);
                        } else if (gameData.gameName == "Traffic Light") {
                            purchaseCount = parseInt(purchaseCount / 3);
                        }
                        return {
                            status: 'fail',
                            result: {
                                playerId: player._id,
                                username: player.username,
                            },
                            message: await translate({ key: "purchase_limited_ticket", language: player.selectedLanguage, isDynamic: true, number: purchaseCount }), // 'Sorry ..!! You can purchase only ' + purchaseCount + ' tickets..!! ',
                            statusCode: 401
                        }
                    }
                }

                // deduct wallet and update voucher
                if (TotalAmountOfTickets > 0 && data.voucherCode != undefined && data.voucherCode != null && data.voucherCode != '') {
                    let offAmount = (TotalAmountOfTickets * voucherData.percentageOff) / 100;
                    TotalAmountOfTickets = (TotalAmountOfTickets - offAmount);
                    console.log("payable amount", payableAmount);
                    await Sys.Game.Common.Services.PlayerServices.updateOneTransaction({ _id: vId }, { isVoucherUse: true })
                }
                console.log("TotalAmountOfTickets after deducting voucher amount", TotalAmountOfTickets, ticketColorTypeArray);
                //Counting tickets for hall update
                const ticketFinalData = {};
                for (let i = 0; i < ticketColorTypeArray.length; i++) {
                    if (ticketDetails[ticketColorTypeArray[i].ticketName.split(' ').join('').toLowerCase()]) {
                        ticketDetails[ticketColorTypeArray[i].ticketName.split(' ').join('').toLowerCase()].count += 1;
                    } else {
                        ticketDetails[ticketColorTypeArray[i].ticketName.split(' ').join('').toLowerCase()] = {
                            type: ticketColorTypeArray[i].type,
                            count: 1
                        }
                    }
                }

                const tikectKeys = Object.keys(ticketDetails);

                for (let i = 0; i < tikectKeys.length; i++) {
                    if (ticketDetails[tikectKeys[i]].type == "large") {
                        ticketFinalData[tikectKeys[i]] = ticketDetails[tikectKeys[i]].count / 3;
                    } else {
                        ticketFinalData[tikectKeys[i]] = ticketDetails[tikectKeys[i]].count;
                    }
                }

                console.log("final ticket count data", ticketFinalData);

                let purchasedSlug = data.purchaseType;
                let deductUserWallet = "";
                if (purchasedSlug == 'points') {

                    if (player.points < TotalAmountOfTickets) {
                        return {
                            status: 'fail',
                            result: {
                                playerId: player._id,
                                username: player.username,
                            },
                            message: await translate({ key: "Insufficient_balance", language: player.selectedLanguage }), // 'Insufficient Balance ..!',
                            statusCode: 401
                        }
                    }
                    deductUserWallet = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: -TotalAmountOfTickets } });

                } else if (purchasedSlug == 'realMoney') {

                    if (player.walletAmount < TotalAmountOfTickets) {
                        return {
                            status: 'fail',
                            result: {
                                playerId: player._id,
                                username: player.username,
                            },
                            message: await translate({ key: "Insufficient_balance", language: player.selectedLanguage }), // 'Insufficient Balance ..!',
                            statusCode: 401
                        }
                    }
                    //[ Monthly Wallet Amount Limit ]
                    if (player.monthlyWallet == true && player.monthlyWalletAmountLimit < TotalAmountOfTickets) {
                        return {
                            status: 'fail',
                            result: {
                                playerId: player._id,
                                username: player.username,
                            },
                            message: await translate({ key: "update_wallet_limit", language: player.selectedLanguage }), // 'Please Update Your Monthly Wallet Amount Limit.!!',
                            statusCode: 401
                        }
                    }

                    deductUserWallet = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: -TotalAmountOfTickets, monthlyWalletAmountLimit: -TotalAmountOfTickets } });

                } else if (purchasedSlug == 'voucher') {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "voucher_not_applied_for_game", language: player.selectedLanguage }), // 'Voucher for this game can not applied now..!!',
                        statusCode: 401
                    }
                }

                //[ Normal Ticket Buying...!!! ]
                let finalDataTicketTemp = [];
                Sys.Log.info("ticket sample starts");
                //let ticketTemp = await Sys.Game.Game1.Services.GameServices.getSampleStaticTicketsData({ gameId: {$ne: data.gameId}, isPurchased: false }, { isPurchased: 1, tickets: 1, ticketId: 1 }, parseInt(ticketQnty) + 200)
                let ticketTemp = await Sys.Game.Game1.Services.GameServices.getStaticByData({ isPurchased: false, gameId: { $ne: data.gameId } }, { isPurchased: 1, tickets: 1, ticketId: 1 }, { limit: (parseInt(ticketQnty) + 1000) })
                Sys.Log.info("ticket sample ends");
                if (ticketTemp.length > 0 && ticketTemp.length >= ticketQnty) {
                    for (let i = 0; i < ticketTemp.length; i++) {
                        if (finalDataTicketTemp.length >= parseInt(ticketQnty)) { break; }
                        //console.log("purchasing static ticket number", ticketTemp[i]._id, ticketTemp[i])
                        let updatedTicket = await Sys.Game.Game1.Services.GameServices.updateStaticGameCustom({ _id: ticketTemp[i]._id, isPurchased: false }, { isPurchased: true, playerIdOfPurchaser: data.playerId, gameId: data.gameId });
                        //console.log("updatedTicket result of static ticket", updatedTicket)
                        if (updatedTicket == null) {
                            console.log("tickets not purchased while updating ticket", ticketTemp[i].id)
                        } else {
                            finalDataTicketTemp.push(ticketTemp[i])
                        }
                    }
                }
                //console.log("selected static ticket", finalDataTicketTemp, data.playerId);
                let userType = "Online";
                let playerTicketType = "Online";
                if (player.userType == "Unique") {
                    userType = "Unique";
                }
                if (data.hasOwnProperty('playerTicketType')) {
                    playerTicketType = data.playerTicketType
                }
                let groupOfHall = await Sys.App.Services.HallServices.getSingleHallData({ _id: player.hall.id }, { groupHall: 1 })
                let playerPurchasedTickets = [];
                if (finalDataTicketTemp.length >= parseInt(ticketQnty)) {

                    // let afterPurchaseBalance;
                    // let beforePurchaseBalance;
                    // if(purchasedSlug == 'realMoney'){
                    //     afterPurchaseBalance = +parseFloat(deductUserWallet.walletAmount).toFixed(2);
                    // }else if(purchasedSlug == 'points'){
                    //     afterPurchaseBalance = +parseFloat(deductUserWallet.points).toFixed(2);
                    // }
                    // beforePurchaseBalance = +parseFloat(afterPurchaseBalance - TotalAmountOfTickets).toFixed(2);
                    let dailySchedule = await Sys.App.Services.scheduleServices.getSingleDailySchedulesData({ _id: await Sys.Helper.bingo.obId(gameData.parentGameId) }, {}, {});
                    let ticketLargeArr = [];

                    for (let r = 0; r < finalDataTicketTemp.length; r++) {
                        let ticket = finalDataTicketTemp[r].tickets;
                        ticket[2][2] = { Number: 0, checked: true };
                        ticketLargeArr.push({
                            insertOne: {
                                document: {
                                    isAgentTicket: data.isAgentTicket,
                                    agentId: data.agentId,
                                    gameId: data.gameId,
                                    gameType: "game_1",
                                    gameName: gameData.gameName,
                                    ticketId: finalDataTicketTemp[r].ticketId,
                                    tickets: ticket,
                                    isPurchased: true,
                                    playerIdOfPurchaser: data.playerId,
                                    playerNameOfPurchaser: player.username,
                                    hallId: player.hall.id,
                                    hallName: player.hall.name, //"Hall_G1",
                                    groupHallId: groupOfHall.groupHall.id,
                                    groupHallName: groupOfHall.groupHall.name,
                                    ticketColorType: ticketColorTypeArray[r].type,
                                    ticketColorName: ticketColorTypeArray[r].ticketName,
                                    ticketPrice: ticketColorTypeArray[r].price,
                                    ticketParentId: finalDataTicketTemp[r].id,
                                    userType: userType,
                                    userTicketType: userTicketType,
                                    ticketPurchasedFrom: purchasedSlug,
                                    gameStartDate: gameData.startDate,
                                    uniquePlayerId: (userType == "Online") ? '' : player.uniqueId,
                                    playerTicketType: playerTicketType,
                                    supplier: "AIS",
                                    developer: "AIS_Developer",
                                    createdAt: Date.now(),
                                    dailyScheduleId: dailySchedule.dailyScheduleId,
                                    subGame1Id: dailySchedule.days[gameData.day][0]
                                    //'otherData.beforePurchaseBalance': beforePurchaseBalance,
                                    //'otherData.afterPurchaseBalance': afterPurchaseBalance
                                }
                            }
                        });
                    }

                    room?.halls.forEach(hall => {
                        console.log("Call getTicketDataRefresh",);
                        Sys.Io.of('admin').to(hall).emit('getTicketDataRefresh', { message: "Ticket Purchase" });
                    })

                    let latestGame = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, { disableTicketPurchase: 1 });
                    if (latestGame.disableTicketPurchase == true) {
                        if (data.voucherCode != undefined && data.voucherCode != null && data.voucherCode != '') {
                            await Sys.Game.Common.Services.PlayerServices.updateOneTransaction({ _id: vId }, { isVoucherUse: false })
                        }
                        if (purchasedSlug == 'points') {
                            await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: TotalAmountOfTickets } });
                        } else if (purchasedSlug == 'realMoney') {
                            await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: TotalAmountOfTickets, monthlyWalletAmountLimit: TotalAmountOfTickets } });
                        }
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({ key: "ticket_purchase_disabled", language: player.selectedLanguage }), // 'Ticket purchase has been disabled for this game',
                            statusCode: 401
                        }
                    }

                    let ticketInsert = await Sys.App.Services.GameService.bulkWriteTicketData(ticketLargeArr);
                    console.log("inserted ids", ticketInsert.insertedIds)
                    if (ticketInsert.insertedIds) {
                        playerPurchasedTickets = Object.values(ticketInsert.insertedIds)
                    }

                } else {
                    // revert player amount
                    if (data.voucherCode != undefined && data.voucherCode != null && data.voucherCode != '') {
                        await Sys.Game.Common.Services.PlayerServices.updateOneTransaction({ _id: vId }, { isVoucherUse: false })
                    }
                    if (purchasedSlug == 'points') {
                        await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: TotalAmountOfTickets } });
                    } else if (purchasedSlug == 'realMoney') {
                        await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: TotalAmountOfTickets, monthlyWalletAmountLimit: TotalAmountOfTickets } });
                    }

                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "tickets_not_available", language: player.selectedLanguage }), // 'Tickets Not Available!',
                        statusCode: 401
                    }
                }

                // afer deducting player wallet, update game stats
                console.log("Player after deducting wallet amount", deductUserWallet);
                let updatedGame = "";
                let luckyNumber = 0;
                if (data.luckyNumber == 0) {
                    luckyNumber = getRandomArbitrary(1, 75)
                } else {
                    luckyNumber = data.luckyNumber;
                }
                const isPurchasedUpdated = gameData.players.findIndex((e) => e.id == data.playerId);
                if (isPurchasedUpdated != -1) {
                    let totalPurchasedTickets = (gameData.players[isPurchasedUpdated].totalPurchasedTickets + ticketQnty);
                    updatedGame = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameData._id, 'players.id': gameData.players[isPurchasedUpdated].id },
                        {
                            $set: {
                                'players.$.luckyNumber': luckyNumber,
                            },
                            $inc: {
                                ticketSold: ticketQnty,
                                earnedFromTickets: TotalAmountOfTickets,
                                finalGameProfitAmount: TotalAmountOfTickets,
                                'players.$.ticketPrice': TotalAmountOfTickets,
                                'players.$.totalPurchasedTickets': ticketQnty,
                            }
                        },
                        { new: true }
                    );

                    let incObj = {};
                    let filterArr = [];
                    let tempAlpha = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z']

                    if (gameData.gameName == "Traffic Light") {
                        for (let s = 0; s < subgame.length; s++) {
                            incObj["players.$.purchaseTicketTypes.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = playerPurTickets[0].ticketQty;
                            filterArr.push({ [tempAlpha[s] + ".ticketName"]: subgame[s].ticketName })
                        }
                    } else if (gameData.gameName == "Elvis") {
                        for (let s = 0; s < subgame.length; s++) {
                            let purchaseCount = playerPurTickets.filter((obj) => obj.ticketName == subgame[s].ticketName).length;
                            incObj["players.$.purchaseTicketTypes.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = purchaseCount;
                            filterArr.push({ [tempAlpha[s] + ".ticketName"]: subgame[s].ticketName })
                        }
                    } else {
                        for (let s = 0; s < playerPurTickets.length; s++) {
                            incObj["players.$.purchaseTicketTypes.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = playerPurTickets[s].ticketQty;
                            filterArr.push({ [tempAlpha[s] + ".ticketName"]: playerPurTickets[s].ticketName })
                        }
                    }


                    Object.entries(ticketFinalData).forEach(([key, value]) => {
                        incObj[`groupHalls.$[group].halls.$[hall].ticketData.${key}`] = value
                        incObj[`groupHalls.$[group].halls.$[hall].userTicketType.${userTicketType}.${key}`] = value
                    });

                    filterArr.push({ "group.halls.id": player.hall.id.toString() }, { "hall.id": player.hall.id.toString() })


                    //console.log("update player tickets count", incObj, filterArr)
                    await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId, 'players.id': data.playerId }, {
                        $inc: incObj
                    }, { arrayFilters: filterArr, new: true });


                } else {
                    let purchaseTicketTypes = [];
                    for (let s = 0; s < subgame.length; s++) {
                        if (gameData.gameName == "Traffic Light") {
                            purchaseTicketTypes.push({ ticketName: subgame[s].ticketName, ticketPrice: subgame[s].ticketPrice, totalPurchasedTickets: playerPurTickets[0].ticketQty })
                        } else {
                            if (gameData.gameName == "Elvis") {
                                let purchaseCount = playerPurTickets.filter((obj) => obj.ticketName == subgame[s].ticketName).length;
                                purchaseTicketTypes.push({ ticketName: subgame[s].ticketName, ticketPrice: subgame[s].ticketPrice, totalPurchasedTickets: purchaseCount })
                            } else {
                                let purchaseCount = 0;
                                let index = playerPurTickets.findIndex((e) => e.ticketName == subgame[s].ticketName);
                                if (index != -1) {
                                    purchaseCount = playerPurTickets[index].ticketQty;
                                }
                                purchaseTicketTypes.push({ ticketName: subgame[s].ticketName, ticketPrice: subgame[s].ticketPrice, totalPurchasedTickets: purchaseCount })
                            }

                        }

                    }

                    let newPlayer = {
                        id: data.playerId,
                        name: player.username,
                        socketId: socket.id,
                        totalPurchasedTickets: ticketQnty,
                        ticketPrice: TotalAmountOfTickets,
                        isPlayerOnline: false,
                        userType: player.userType,
                        luckyNumber: luckyNumber,
                        purchaseTicketTypes: purchaseTicketTypes,
                        purchasedSlug: purchasedSlug,
                    }
                    const updateQuery = {
                        $push: { "players": newPlayer },
                        $inc: {
                            ticketSold: ticketQnty,
                            earnedFromTickets: TotalAmountOfTickets,
                            finalGameProfitAmount: TotalAmountOfTickets
                        }
                    }

                    Object.entries(ticketFinalData).forEach(([key, value]) => {
                        updateQuery["$inc"][`groupHalls.$[group].halls.$[hall].ticketData.${key}`] = value
                        updateQuery["$inc"][`groupHalls.$[group].halls.$[hall].userTicketType.${userTicketType}.${key}`] = value
                    });

                    updatedGame = await Sys.Game.Game1.Services.GameServices.updateGameNested(
                        { _id: gameData._id },
                        updateQuery,
                        {
                            arrayFilters: [{ "group.halls.id": player.hall.id.toString() }, { "hall.id": player.hall.id.toString() }],
                            new: true
                        }
                    );
                }

                //Sys.Io.of(Sys.Config.Namespace.Game1).to(data.gameId).emit('UpdatePlayerRegisteredCount', { playerRegisteredCount: updatedGame.players.length });

                let newExtraTransaction = {
                    playerId: player._id,
                    gameId: updatedGame._id,
                    transactionSlug: "extraTransaction",
                    typeOfTransaction: "Game Joined",
                    action: "debit", // debit / credit
                    purchasedSlug: purchasedSlug, // point /realMoney,
                    game1Slug: "buyTicket",
                    totalAmount: TotalAmountOfTickets,
                }

                Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);

                console.log("This Player [ ", player.username, " ] Tickets Purchased Successfully..!!");

                //if (player.enableNotification == true) {

                let TimeMessage = {
                    en: await translate({ key: "game1_ticket_purchase_notification", language: 'en', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName, number2: finalDataTicketTemp.length }),
                    nor: await translate({ key: "game1_ticket_purchase_notification", language: 'nor', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName, number2: finalDataTicketTemp.length })
                };

                //gameData.gameNumber + " [ " + gameData.gameName + " ] " + finalDataTicketTemp.length + " Tickets Purchased Successfully..!! ";

                let notificationDate = gameData.startDate;
                console.log("notificationDate", notificationDate)

                let ticketMessage = {
                    en: await translate({ key: "game1_purchase_noti", language: 'en', isDynamic: true, number: finalDataTicketTemp.length, number1: gameData.gameName }),
                    nor: await translate({ key: "game1_purchase_noti", language: 'nor', isDynamic: true, number: finalDataTicketTemp.length, number1: gameData.gameName })
                };

                let notification = {
                    notificationType: 'purchasedTickets',
                    message: TimeMessage,
                    ticketMessage: ticketMessage, // `You bought ${finalDataTicketTemp.length} ticket of "${gameData.gameName}" Game..!!`,
                    price: `${TotalAmountOfTickets}`,
                    date: notificationDate
                }

                let dataNotification = {
                    playerId: player._id,
                    gameId: gameData._id,
                    notification: notification
                }

                await Sys.Game.Common.Services.NotificationServices.create(dataNotification);
                //TimeMessage = await translate({key: "game1_ticket_purchase_notification", language: player.selectedLanguage, number: gameData.gameNumber, isDynamic: true, number1: gameData.gameName, number2: finalDataTicketTemp.length}),
                // await Sys.Io.to(player.socketId).emit('NotificationBroadcast', {
                //     notificationType: notification.notificationType,
                //     message: TimeMessage[player.selectedLanguage]
                // });

                let result = '';
                if (playerTicketType == "Physical") {
                    result = finalDataTicketTemp[0];
                }

                //add ticketIdForBalls
                //console.log("playerPurchasedTickets---", playerPurchasedTickets);
                let prTickets = await Sys.Game.Game1.Services.GameServices.getTicketListData({ _id: { $in: playerPurchasedTickets } }, { tickets: 1 })


                let bulupdateTicketData = [];
                let ticketsConfData = [];
                if (prTickets.length > 0) {
                    for (p = 0; p < prTickets.length; p++) {
                        //console.log(" prTickets[p]",  prTickets[p].tickets);
                        let ticketBallData = {};
                        for (let t = 0; t < prTickets[p].tickets.length; t++) {
                            for (let n = 0; n < prTickets[p].tickets[t].length; n++) {
                                //console.log("prTickets[p] inside", prTickets[p].tickets[t][n].Number, prTickets[p]._id)
                                if (+prTickets[p].tickets[t][n].Number != 0) {
                                    ticketBallData["ticketIdForBalls." + prTickets[p].tickets[t][n].Number] = { ticketId: prTickets[p]._id, position: t + ":" + n }
                                }

                            }

                        }
                        //console.log("ticketBallData", ticketBallData)
                        bulupdateTicketData.push({
                            updateOne: {
                                "filter": { _id: gameData._id },
                                "update": { $push: ticketBallData }
                            }
                        })
                        ticketsConfData.push(ticketBallData)
                    }
                }
                Sys.App.Services.GameService.bulkWriteGameData(bulupdateTicketData);

                Sys.Log.info("end purchase ticket");

                let ballDrawn = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, { withdrawNumberArray: 1 });
                //console.log("ballDrawn---", ballDrawn, ticketsConfData)
                if (ballDrawn && ballDrawn.withdrawNumberArray.length > 0) {
                    for (let t = 0; t < ballDrawn.withdrawNumberArray.length; t++) {
                        let bulkupdateTicketData = [];
                        for (let b = 0; b < ticketsConfData.length; b++) {
                            //console.log("ticketsConfData", ticketsConfData[b]);
                            let selectedelement = ticketsConfData[b]["ticketIdForBalls." + ballDrawn.withdrawNumberArray[t]]
                            //console.log("selectedelement---", selectedelement, ballDrawn.withdrawNumberArray[t])
                            if (selectedelement) {
                                let position = selectedelement.position.split(':');
                                let positionKey = 'tickets.' + position[0] + '.' + position[1] + '.checked'
                                bulkupdateTicketData.push({
                                    updateOne: {
                                        "filter": { _id: selectedelement.ticketId },
                                        "update": { $set: { [positionKey]: true } }
                                    }
                                })
                            }
                        }
                        if (bulkupdateTicketData.length > 0) {
                            console.log("bulkupdateTicketData---", JSON.stringify(bulkupdateTicketData));
                            await Sys.App.Services.GameService.bulkWriteTicketData(bulkupdateTicketData);
                        }
                    }
                }


                if (gameData.gameName == "Spillerness Spill" || gameData.gameName == "Spillerness Spill 2" || gameData.gameName == "Spillerness Spill 3" || gameData.gameName == "Innsatsen") {
                    Sys.Io.of(Sys.Config.Namespace.Game1).to(gameData._id).emit('adminRefreshRoom', {});
                    let patternListing = await Sys.Game.Game1.Controllers.GameProcess.patternListing(gameData._id);
                    let patternList = patternListing.patternList;
                    Sys.Io.of(Sys.Config.Namespace.Game1).to(gameData._id).emit('PatternChange', { patternList: patternList });
                }

                //let gameFinal = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, {ticketIdForBalls: 1});
                //console.log("final data", gameFinal.ticketIdForBalls)
                return {
                    status: 'success',
                    result: result,
                    message: await translate({ key: "tickets_purcahsed", language: player.selectedLanguage }), // 'Tickets purchased successfully..!!'
                }

            } else {
                return {
                    status: 'fail',
                    result: null,
                    message: 'No Player Found!',
                    statusCode: 400
                }
            }
        } catch (error) {
            console.log("Error game1TicketPurchased", error);
        }
    },

    cancelGameTickets: async function (socket, data) {
        try {
            let language = "nor";
            if (data.language) {
                language = data.language;
            }
            console.log("cancelGameTickets", data)
            let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: data.playerId }, { username: 1, selectedLanguage: 1, hall: 1 });
            if (player) {
                let gameData = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, { isNotificationSent: 1, status: 1, players: 1, gameNumber: 1, gameName: 1, disableTicketPurchase: 1, startDate: 1, otherData: 1, halls: 1 });
                if (gameData === null) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "game_not_found", language: player.selectedLanguage }), // 'Game data is not found',
                    }
                }
                console.log("gameData in cancel Game tickets", gameData)
                if (gameData.status != "cancel" && gameData.status != "running" && gameData.status != "finish" && gameData.otherData.disableCancelTicket == false) { // gameData.disableTicketPurchase == false
                    const isPurchased = gameData.players.findIndex((e) => e.id == data.playerId);
                    if (isPurchased == -1) {
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({ key: "error_cancelling_tickets", language: player.selectedLanguage }), // 'Error while cancelling Tickets!',

                        }
                    }
                    console.log("cancel player id", gameData.players[isPurchased].id, data.playerId, gameData.players[isPurchased].ticketPrice);
                    let tiketPrice = gameData.players[isPurchased].ticketPrice;
                    let ticketQty = gameData.players[isPurchased].totalPurchasedTickets;
                    let purchasedTickets = gameData.players[isPurchased].purchaseTicketTypes;
                    let purchasedSlug = gameData.players[isPurchased].purchasedSlug;
                    if (gameData.players[isPurchased].id == data.playerId) {
                        let updateGame = await Sys.Game.Game1.Services.GameServices.updateGameNested(
                            { _id: gameData._id, 'players.id': data.playerId },
                            {
                                $pull: { players: { id: data.playerId } },
                                $inc: {
                                    ticketSold: -ticketQty,
                                    earnedFromTickets: -tiketPrice,
                                    finalGameProfitAmount: -tiketPrice
                                }
                            },
                        );
                        //console.log("updatedGame in cancelTicket of player", data.playerId, data.gameId, updateGame)

                        if (updateGame instanceof Error || updateGame == null || updateGame == undefined) {
                            console.log("error in cancelling ticket");
                            return { status: 'fail', result: null, message: await translate({ key: "went_wrong_cancelling_tickets", language: player.selectedLanguage }), statusCode: 500 }
                        } else {
                            console.log("cancel ticket purchased, revert user amount", data.playerId);

                            if (purchasedSlug == "points") {
                                await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: tiketPrice } });
                                let newExtraTransaction = {
                                    playerId: player._id,
                                    gameId: gameData._id,
                                    transactionSlug: "extraTransaction",
                                    typeOfTransaction: "Cancel Ticket",
                                    action: "credit", // debit / credit
                                    purchasedSlug: "points", // point /realMoney
                                    totalAmount: tiketPrice,
                                    game1Slug: "cancelTicket"
                                }
                                await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                            } else if (purchasedSlug == "realMoney") {
                                await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: tiketPrice, monthlyWalletAmountLimit: tiketPrice } });
                                let newExtraTransaction = {
                                    playerId: player._id,
                                    gameId: gameData._id,
                                    transactionSlug: "extraTransaction",
                                    typeOfTransaction: "Cancel Ticket",
                                    action: "credit", // debit / credit
                                    purchasedSlug: "realMoney", // point /realMoney
                                    totalAmount: tiketPrice,
                                    game1Slug: "cancelTicket"
                                }
                                await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                            }

                            if (purchasedTickets.length > 0) {
                                let incObj = {};
                                let filterArr = [];
                                let tempAlpha = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z']
                                for (let s = 0; s < purchasedTickets.length; s++) {
                                    incObj["subGames.$[].options.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = -(purchasedTickets[s].totalPurchasedTickets);
                                    filterArr.push({ [tempAlpha[s] + ".ticketName"]: purchasedTickets[s].ticketName })
                                }
                                Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId }, {
                                    $inc: incObj
                                }, { arrayFilters: filterArr });
                            }



                            // update playerIDs in ticketIdForBalls object
                            let prTickets = await Sys.Game.Game1.Services.GameServices.getTicketListData({ gameId: data.gameId, playerIdOfPurchaser: data.playerId }, { tickets: 1, ticketColorName: 1, ticketColorType: 1, userTicketType: 1, hallId: 1 })

                            let bulupdateTicketData = [];
                            const ticketDetails = {};

                            if (prTickets.length > 0) {
                                for (p = 0; p < prTickets.length; p++) {
                                    //console.log(" prTickets[p]",  prTickets[p].tickets);
                                    if (ticketDetails[prTickets[p].ticketColorName.split(' ').join('').toLowerCase()]) {
                                        ticketDetails[prTickets[p].ticketColorName.split(' ').join('').toLowerCase()].count += 1;
                                    } else {
                                        ticketDetails[prTickets[p].ticketColorName.split(' ').join('').toLowerCase()] = {
                                            type: prTickets[p].ticketColorType,
                                            count: 1,

                                        }
                                    }
                                    let ticketBallData = {};
                                    for (let t = 0; t < prTickets[p].tickets.length; t++) {
                                        for (let n = 0; n < prTickets[p].tickets[t].length; n++) {
                                            //console.log("prTickets[p] inside", prTickets[p].tickets[t][n].Number, prTickets[p]._id)
                                            if (+prTickets[p].tickets[t][n].Number != 0) {
                                                ticketBallData["ticketIdForBalls." + prTickets[p].tickets[t][n].Number] = { ticketId: prTickets[p]._id }
                                            }

                                        }

                                    }
                                    //console.log("ticketBallData cancel", ticketBallData)
                                    bulupdateTicketData.push({
                                        updateOne: {
                                            "filter": { _id: gameData._id },
                                            "update": { $pull: ticketBallData }
                                        }
                                    })
                                }
                            }

                           /*let getCountTicket = prTickets.reduce((obj, userTicketType) => {
                                console.log("userTicketType---", userTicketType)
                                if (obj[userTicketType.userTicketType][userTicketType.ticketColorName.split(' ').join('').toLowerCase()]) {
                                    obj[userTicketType.userTicketType][userTicketType.ticketColorName.split(' ').join('').toLowerCase()].count += 1
                                } else {
                                    obj[userTicketType.userTicketType][userTicketType.ticketColorName.split(' ').join('').toLowerCase()] = {
                                        type: userTicketType.ticketColorType,
                                        count: 1
                                    }
                                }
                                return obj;
                            }, { Physical: {}, Terminal: {}, Web: {} });

                            console.log("getCountTicket", getCountTicket);

                            const ticketFinalData = {};
                            const tikectKeys = Object.keys(ticketDetails);
                            for (let i = 0; i < tikectKeys.length; i++) {
                                if (ticketDetails[tikectKeys[i]].type == "large") {
                                    ticketFinalData[tikectKeys[i]] = ticketDetails[tikectKeys[i]].count / 3;
                                } else {
                                    ticketFinalData[tikectKeys[i]] = ticketDetails[tikectKeys[i]].count;
                                }
                            }

                            const getCountKeys = Object.keys(getCountTicket);
                            console.log("getCountKeys", getCountKeys)

                            for (let i = 0; i < getCountKeys.length; i++) {
                                console.log(getCountTicket[getCountKeys[i]])
                                const getData = Object.keys(getCountTicket[getCountKeys[i]]);
                                for (let j = 0; j < getData.length; j++) {
                                    console.log(getData[j])
                                    if (getCountTicket[getCountKeys[i]][getData[j]].type == 'large') {
                                        getCountTicket[getCountKeys[i]][getData[j]].count = getCountTicket[getCountKeys[i]][getData[j]].count / 3;
                                    }

                                }
                            }

                            console.log("getCountTicket", getCountTicket);*/

                            // New logic to handle count update for agent according to ticket's hall
                            let getCountTicket = prTickets.reduce((obj, userTicketType) => {
                                const hallId = userTicketType.hallId; // Extract the hallId from the ticket
                            
                                // If hallId doesn't exist, initialize it
                                if (!obj[hallId]) {
                                    obj[hallId] = { Physical: {}, Terminal: {}, Web: {} };
                                }
                            
                                // Normalize the ticket color name
                                const colorKey = userTicketType.ticketColorName.split(' ').join('').toLowerCase();
                            
                                // Group by userTicketType and color (normalized)
                                if (obj[hallId][userTicketType.userTicketType][colorKey]) {
                                    obj[hallId][userTicketType.userTicketType][colorKey].count += 1;
                                } else {
                                    obj[hallId][userTicketType.userTicketType][colorKey] = {
                                        type: userTicketType.ticketColorType,
                                        count: 1
                                    };
                                }
                            
                                return obj;
                            }, {});
                            
                            // Adjust counts for 'large' tickets after the accumulation
                            Object.entries(getCountTicket).forEach(([hallId, ticketData]) => {
                                Object.entries(ticketData).forEach(([ticketType, ticketDetails]) => {
                                    Object.entries(ticketDetails).forEach(([colorKey, ticket]) => {
                                        if (ticket.type === 'large') {
                                            ticket.count = ticket.count / 3; // Adjust count for 'large' tickets
                                        }
                                    });
                                });
                            });
                            
                            console.log("getCountTicket", JSON.stringify(getCountTicket));
                            
                            Sys.App.Services.GameService.bulkWriteGameData(bulupdateTicketData);

                            //

                            Sys.App.Services.GameService.deleteTicketManydata({ playerIdOfPurchaser: data.playerId, gameId: data.gameId });
                            // update static tickets for predefined tickets flow
                            Sys.Game.Game1.Services.GameServices.updateManyStaticData({ playerIdOfPurchaser: data.playerId, isPurchased: true, gameId: gameData._id }, { isPurchased: false, playerIdOfPurchaser: "", gameId: "" });

                            // const updateQuery = {
                            //     $inc: {}
                            // }
                            
                            /*console.log("ticketFinalData", ticketFinalData);
                            Object.entries(ticketFinalData).forEach(([key, value]) => {
                                updateQuery["$inc"][`groupHalls.$[group].halls.$[hall].ticketData.${key}`] = -value;
                            });

                            Object.entries(getCountTicket).forEach(([key, value]) => {
                                Object.entries(value).forEach(([key1, value1]) => {
                                    console.log("value1", value1);
                                    updateQuery["$inc"][`groupHalls.$[group].halls.$[hall].userTicketType.${key}.${key1}`] = -value1.count;
                                })
                            });*/

                            gameData?.halls.forEach(hall => {
                                Sys.Io.of('admin').to(hall).emit('refresh', { scheduleId: gameData.parentGameId });
                            })

                            // console.log("updateQuery New ", updateQuery);

                            // await Sys.Game.Game1.Services.GameServices.updateGameNested(
                            //     { _id: gameData._id },
                            //     updateQuery,
                            //     { arrayFilters: [{ "group.halls.id": player.hall.id.toString() }, { "hall.id": player.hall.id.toString() }] }
                            // );

                            // Process and update ticket counts for each hallId
                            for (const [hallId, ticketData] of Object.entries(getCountTicket)) {
                                console.log("hallId and ticketData:", hallId, ticketData);

                                const updateQuery = { $inc: {} };

                                // Construct the update paths for all tickets within the current hallId
                                for (const [ticketType, ticketDetails] of Object.entries(ticketData)) {
                                    for (const [colorKey, ticket] of Object.entries(ticketDetails)) {
                                        const updatePath = `groupHalls.$[group].halls.$[hall].userTicketType.${ticketType}.${colorKey}`;
                                        const ticketDataPath = `groupHalls.$[group].halls.$[hall].ticketData.${colorKey}`;
                                        updateQuery.$inc[updatePath] = -ticket.count; 
                                        updateQuery.$inc[ticketDataPath] = -ticket.count;
                                    }
                                }
                                console.log("updateQuery----", updateQuery)
                                // Define array filters for the current hallId
                                const arrayFilters = [
                                    { "group.halls.id": hallId }, // Match the specific hallId
                                    { "hall.id": hallId }         // Ensure hallId matches within halls
                                ];

                               
                                await Sys.Game.Game1.Services.GameServices.updateGameNested(
                                    { _id: gameData._id },
                                    updateQuery,
                                    { arrayFilters }
                                );
                                    
                            }

                            let TimeMessage = {
                                en: await translate({ key: "game1_ticket_cancel_notification", language: 'en', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName }),
                                nor: await translate({ key: "game1_ticket_cancel_notification", language: 'nor', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName })
                            };

                            //gameData.gameNumber + " [ " + gameData.gameName + " ] Ticket Cancellation Successfully..!! ";

                            let notificationDate = gameData.startDate;

                            let ticketMessage = {
                                en: await translate({ key: "game1_ticket_cancel_message", language: 'en', isDynamic: true, number: ticketQty, number1: gameData.gameName }),
                                nor: await translate({ key: "game1_ticket_cancel_message", language: 'nor', isDynamic: true, number: ticketQty, number1: gameData.gameName })
                            };

                            let notification = {
                                notificationType: 'cancelTickets',
                                message: TimeMessage,
                                ticketMessage: ticketMessage, // `You cancelled these ${ticketQty} ticket for this ${gameData.gameName}..!!`,
                                price: tiketPrice,
                                date: notificationDate
                            }

                            let dataNotification = {
                                playerId: player._id,
                                gameId: gameData._id,
                                notification: notification
                            }

                            await Sys.Game.Common.Services.NotificationServices.create(dataNotification);
                            //TimeMessage = await translate({key: "game1_ticket_cancel_notification", language: player.selectedLanguage, number: gameData.gameNumber, isDynamic: true, number1: gameData.gameName}),
                            // await Sys.Io.to(player.socketId).emit('NotificationBroadcast', {
                            //     notificationType: notification.notificationType,
                            //     message: TimeMessage[player.selectedLanguage]
                            // });

                            if (gameData.gameName == "Spillerness Spill" || gameData.gameName == "Spillerness Spill 2" || gameData.gameName == "Spillerness Spill 3" || gameData.gameName == "Innsatsen") {
                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameData._id).emit('adminRefreshRoom', {});
                                let patternListing = await Sys.Game.Game1.Controllers.GameProcess.patternListing(gameData._id);
                                let patternList = patternListing.patternList;
                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameData._id).emit('PatternChange', { patternList: patternList });
                            }

                            return {
                                status: 'success',
                                result: '',
                                message: await translate({ key: "ticket_cancellation_success", language: player.selectedLanguage }), // 'Ticket cancellation successfully...!!!'
                            }
                        }
                    } else {
                        console.log("error in cancelling ticket, player mismatch");
                        return { status: 'fail', result: null, message: await translate({ key: "went_wrong_cancelling_tickets", language: player.selectedLanguage }), statusCode: 500 }
                    }
                }
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "can_not_cancel_ticket", language: player.selectedLanguage }), //'Can not cancel Ticket!',
                    statusCode: 400
                }

            } else {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language: language }), // 'No Player Found!',
                    statusCode: 400
                }
            }

        } catch (e) {
            console.log("Error in cancelGameTickets : ", e);
            return new Error(e);
        }
    },

    upcomingGames: async function (socket, data) {
        try {
            let language = "nor";
            if (data.language) {
                language = data.language;
            }
            console.log("upcomingGames Event Data", data);
            let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: data.playerId }, { hall: 1, selectedLanguage: 1 });
            if (player) {
                if (player.hall && player.hall.hasOwnProperty('id') && player.hall.id != "" && player.hall.status == "Approved") {

                    let hall = await Sys.Game.Common.Services.GameServices.getHallData({ _id: player.hall.id, status: "active" });
                    if (hall.length <= 0) {
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({ key: "no_ongoing_game", language: player.selectedLanguage }), // 'There is no ongoing game. Please try again later',
                            statusCode: 400
                        }
                    }

                    let scheduleParentId = "";
                    if (data.gameId) {
                        let gameschedule = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, { parentGameId: 1 }, {});
                        console.log("gameschedule", gameschedule);
                        scheduleParentId = gameschedule.parentGameId;
                    } else {
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({ key: "something_went_wrong", language: player.selectedLanguage }),  // 'Something Went Wrong',
                            statusCode: 400
                        }
                    }

                    let query = {
                        gameType: "game_1",
                        halls: { $in: [player.hall.id] },  // consider only one hall as player can select only 1 hall
                        status: { $in: ["active", "running"] }, //"active",
                        stopGame: false,
                        disableTicketPurchase: false,
                        'otherData.isClosed': false,
                        parentGameId: scheduleParentId,
                        startDate: {
                            $gte: moment().startOf('day').toDate(),
                            $lt: moment().startOf('day').add(2, 'day').toDate()
                        }
                    }

                    let games = await Sys.Game.Game1.Services.GameServices.getByData(query, { gameName: 1, status: 1, players: 1, timerStart: 1, isNotificationSent: 1, stopGame: 1, sequence: 1, gameMode: 1, startDate: 1, graceDate: 1, subGames: 1, otherData: 1, parentGameId: 1 }, { sort: { startDate: 1, sequence: 1 } }); //{startDate: 1} 
                    if (games.length > 0) {

                        let upcomingGame = [];
                        let gameSequence = 0;
                        for (let g = 0; g < games.length; g++) {
                            console.log("games[g].sequence--", games[g].sequence)
                            // check for today's game only start
                            if (games[g].sequence <= gameSequence) {
                                break;
                            }
                            gameSequence = games[g].sequence;
                            console.log("gameSequence---", gameSequence)
                            // check for today's game only ends

                            let ticketTypes = [];
                            // if(games[g].subGames.length > 0 && games[g].subGames[0].options.length > 0){
                            //     for(let s=0; s < games[g].subGames[0].options.length; s++ ){
                            //         ticketTypes.push({name: games[g].subGames[0].options[s].ticketName, price: games[g].subGames[0].options[s].ticketPrice })
                            //     }
                            // }

                            let replaceAmount = 0;
                            let gameType = "color";
                            if (games[g].gameName == "Elvis") {
                                gameType = "elvis";
                                ticketTypes.push({ name: "Elvis", price: games[g].subGames[0].options[0].ticketPrice })
                                replaceAmount = games[g].otherData.replaceTicketPrice;
                            } else if (games[g].gameName == "Traffic Light") {
                                gameType = "traffic-light";
                                ticketTypes.push({ name: "Traffic Light", price: games[g].subGames[0].options[0].ticketPrice })
                            }

                            if (gameType == "color") {
                                if (games[g].subGames.length > 0 && games[g].subGames[0].options.length > 0) {
                                    for (let s = 0; s < games[g].subGames[0].options.length; s++) {
                                        ticketTypes.push({ name: games[g].subGames[0].options[s].ticketName, price: games[g].subGames[0].options[s].ticketPrice })
                                    }
                                }
                            }

                            let purchasedTicket = 0;
                            let luckyNumber = 0;
                            let playerIndex = games[g].players.findIndex(x => x.id == data.playerId);
                            if (playerIndex >= 0) {
                                purchasedTicket = games[g].players[playerIndex].totalPurchasedTickets;
                                luckyNumber = games[g].players[playerIndex].luckyNumber;
                            }

                            upcomingGame.push({
                                gameId: games[g]._id,
                                gameName: games[g].gameName,
                                status: games[g].status,
                                ticketTypes: ticketTypes,
                                purchasedTickets: purchasedTicket,
                                maxPurchaseTicket: 30,
                                gameType: gameType,
                                replaceAmount: replaceAmount,
                                luckyNumber: luckyNumber,
                                isCancelAllowed: (games[g].otherData.disableCancelTicket == true) ? false : true
                            });
                        }


                        return {
                            status: 'success',
                            result: upcomingGame,
                            message: 'Games Found',
                            statusCode: 200
                        }
                    } else {
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({ key: "no_game_available", language: player.selectedLanguage }), // 'There is no Game available',
                            statusCode: 400
                        }
                    }

                }
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "no_game_available", language: player.selectedLanguage }), //'There is no Game available',
                    statusCode: 400
                }
            } else {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language: language }), // 'Player Not Found',
                    statusCode: 400
                }
            }
        } catch (error) {
            console.log("Error In upcomingGames function", error);
            return {
                status: 'fail',
                result: null,
                message: 'Something Went Wrong',
                statusCode: 400
            }
        }
    },

    // csvImportOld: async function(req, res) {
    //     try {
    //         //ticketId <= 138000, (ticketId > 138000 && ticketId <= 276000 ),(ticketId > 276000 && ticketId <= 414000 ),(ticketId > 414000 && ticketId <= 552000 ),(ticketId > 552000 && ticketId <= 690000 ),(ticketId > 690000 && ticketId <= 828000 ),(ticketId > 828000 && ticketId <= 993000 )

    //         let AllHalls = ["Open","Open", "Open", "Spillorama Stokke", "Spillorama Gulset", "Spillorama Hokksund",
    //                         "Teknobingo Skien", "Teknobingo Stathelle", "Teknobingo Kragerø",  "Teknobingo Brumunddal",
    //                         "Teknobingo Lillehammer", "Spillorama Hamar", "Teknobingo Vinstra", "Teknobingo Heimdal",
    //                         "Teknobingo Sunndalsøra", "Teknobingo Larvik", "Teknobingo Orkanger","Teknobingo Årnes","Spillorama Bodø","Teknobingo Skien","Teknobingo Finnsnes","Teknobingo Harstad","Teknobingo Fauske","Teknobingo Gran","Spillorama Notodden","ENSJØ BINGO AS","EIDSVOLL BINGO AS","SENTRUM-BINGO AS","SANDEFJORD FORENINGSBINGO AS","BINGODRIFT TROMSØ AS","SPILLMARTINS  Lillestrøm","Open","Martins Bingo Skjetten","Martins Bingo Ammerud","Martins Bingo Kløfta",
    //                         "Martins Bingo Lørenskog","Martins Bingo Råholt","Hexagon Ski","Hexagon Vestby","Hexagon Moss","Hexagon Fredrikstad","Hexagon Hønefoss","Hexagon Råde","Hexagon Borgenhaugen","Hexagon Sarpsborg","Open"]

    //         let halls = ["Open","Open", "Open", "Spillorama Stokke", "Spillorama Gulset", "Spillorama Hokksund",
    //                     "Teknobingo Skien", "Teknobingo Stathelle", "Teknobingo Kragerø",  "Teknobingo Brumunddal",
    //                     "Teknobingo Lillehammer", "Spillorama Hamar", "Teknobingo Vinstra", "Teknobingo Heimdal",
    //                     "Teknobingo Sunndalsøra", "Teknobingo Larvik", "Teknobingo Orkanger","Teknobingo Årnes","Spillorama Bodø","Teknobingo Skien","Teknobingo Finnsnes","Teknobingo Harstad","Teknobingo Fauske","Teknobingo Gran","Spillorama Notodden","ENSJØ BINGO AS","EIDSVOLL BINGO AS","SENTRUM-BINGO AS","SANDEFJORD FORENINGSBINGO AS","BINGODRIFT TROMSØ AS","SPILLMARTINS  Lillestrøm","Open","Martins Bingo Skjetten","Martins Bingo Ammerud","Martins Bingo Kløfta",
    //                     "Martins Bingo Lørenskog","Martins Bingo Råholt","Hexagon Ski","Hexagon Vestby","Hexagon Moss","Hexagon Fredrikstad","Hexagon Hønefoss","Hexagon Råde","Hexagon Borgenhaugen","Hexagon Sarpsborg","Open"]

    //         let trafficlightTemp = ['Small Red', 'Small Yellow', 'Small Green']; //["red", "yellow", "green"];
    //         let trafficlight = ['Small Red', 'Small Yellow', 'Small Green']; //["red", "yellow", "green"]


    //         const csvPath = path.join(__dirname, '../../../hallsTickets.csv');
    //         console.log("csv path", csvPath)
    //         let stream = fs.createReadStream(csvPath);
    //         let csvData = [];
    //         let cont = 0; 
    //         let isShift = false;
    //         let csvStream = fastcsv
    //             .parse({ delimiter: '\t' })
    //             .on("data", async function(data) {
    //                 let ticketId = data[0];
    //                 //if(ticketId && (ticketId > 930000 && ticketId <= 993000 ) ){  //993000
    //                 if(ticketId && (ticketId <= 993000 ) ){  //993000
    //                     if(csvData.length >= 3000){
    //                         isShift = true;
    //                     }
    //                     if(ticketId > 3000 && ticketId%3000 == 1 && isShift == true){
    //                         console.log("now change the hall", ticketId);
    //                         if(halls.length == 1){
    //                             console.log("Need to restore new halls before", halls)
    //                             halls = [...AllHalls];
    //                             console.log("Need to restore new halls after", halls)

    //                         }else{
    //                             halls.shift(); // theRemovedElement == 1
    //                         }


    //                         console.log("updated hall", halls[0])
    //                     }

    //                     let ticketColor = "";
    //                     let ticketType = "standard"
    //                     if( (ticketId >=1 && ticketId <=138000) || (ticketId > 276000 && ticketId <=414000) ){
    //                         //ticketColor = "yellow"
    //                         if(ticketId >=1 && ticketId <=138000){
    //                             ticketColor = "Large Yellow"
    //                         }else{
    //                             ticketColor = "Small Yellow"
    //                         }
    //                     }else if( (ticketId > 138000 && ticketId <= 276000) || (ticketId > 414000 && ticketId <=552000) ){
    //                         //ticketColor = "white"
    //                         if(ticketId > 138000 && ticketId <= 276000){
    //                             ticketColor = "Large White"
    //                         }else{
    //                             ticketColor = "Small White"
    //                         }
    //                     }else if( (ticketId > 552000 && ticketId <= 690000) ){

    //                         ticketColor = trafficlight[0];
    //                         trafficlight.shift();
    //                         if(trafficlight.length == 0){
    //                             trafficlight = [...trafficlightTemp];
    //                         }
    //                         ticketType = "traffic-light"

    //                     }else if( (ticketId > 690000 && ticketId <= 993000)  ){
    //                         //ticketColor = "purple"
    //                         if(ticketId > 690000 && ticketId <= 828000){
    //                             ticketColor = "Small Purple"
    //                         }else{
    //                             ticketColor = "Large Purple"
    //                         }
    //                     }
    //                     csvData.push({
    //                         ticketId: data[0],
    //                         tickets: [

    //                             [{ Number: data[1], checked: false }, { Number: data[2], checked: false }, { Number: data[3], checked: false }, { Number: data[4], checked: false }, { Number: data[5], checked: false }],

    //                             [{ Number: data[6], checked: false }, { Number: data[7], checked: false }, { Number: data[8], checked: false }, { Number: data[9], checked: false }, { Number: data[10], checked: false }],

    //                             [{ Number: data[11], checked: false }, { Number: data[12], checked: false }, { Number: data[13], checked: false }, { Number: data[14], checked: false }, { Number: data[15], checked: false }] ,  

    //                             [{ Number: data[16], checked: false }, { Number: data[17], checked: false }, { Number: data[18], checked: false }, { Number: data[19], checked: false }, { Number: data[20], checked: false }],

    //                             [{ Number: data[21], checked: false }, { Number: data[22], checked: false }, { Number: data[23], checked: false }, { Number: data[24], checked: false }, { Number: data[25], checked: false }],

    //                         ],
    //                         isPurchased: false,
    //                         playerIdOfPurchaser: "",
    //                         ticketType: ticketType,
    //                         ticketColor:ticketColor,
    //                         hallName: halls[0],
    //                         gameId: "",
    //                         supplier: "Bingo Entreprenøren AS"
    //                     });
    //                     //console.log("csvData1", csvData)

    //                     // if (csvData.length == 138000) {
    //                     //     cont += 138000;
    //                     //     //console.log("csvData2", csvData)
    //                     //     console.log("csvdata count 2", cont)
    //                     //     // DestinationModel is a moongose Model
    //                     //     // ticketModel.insertMany([...data], { ordered: false }, function(error, result){
    //                     //     //     if (error){
    //                     //     //         console.error("Error in inserting Documents 1");
    //                     //     //     }    
    //                     //     // });
    //                     //     await Sys.App.Services.GameService.insertManyStaticTicketData(csvData, { ordered: true });
    //                     //     csvData = [];
    //                     // }


    //                 }

    //             })
    //             .on("end", async function() {
    //                 // remove the first line: header
    //                 //csvData.shift();
    //                 //cont += csvData.length;
    //                 console.log("now insert data in database")
    //                 await Sys.App.Services.GameService.insertManyStaticPhysicalTicketData(csvData, { ordered: true });
    //                 res.send("Data inserted Successfully");
    //                 //console.log(csvData);
    //             });

    //         stream.pipe(csvStream);
    //     } catch (e) {
    //         console.log("error in importing data", e)
    //     }
    // },

    // generateStaticTickets: async function(req, res){
    //     try{
    //         let generateCount = 66088;

    //         let arrVal = 25;
    //         let currentCount = 933912;
    //         for(let i=0; i < generateCount; i++){
    //             currentCount = currentCount +1;
    //             let ticketArray = [];
    //             while(ticketArray.length < arrVal){
    //                 if( ticketArray.length % 5 == 0 ){
    //                     r = getRandomArbitrary(1, 16);
    //                 }else if(ticketArray.length % 5 == 1){
    //                     r = getRandomArbitrary(16, 31);
    //                 }else if(ticketArray.length % 5 == 2){
    //                     r = getRandomArbitrary(31, 46);
    //                 }else if(ticketArray.length % 5 == 3){
    //                     r = getRandomArbitrary(46, 61);
    //                 }else if(ticketArray.length % 5 == 4){
    //                     r = getRandomArbitrary(61, 76);
    //                 }
    //                 if(ticketArray.indexOf(r) === -1) ticketArray.push(r);
    //             }
    //             //console.log("ticketArray", ticketArray)
    //             ticketArray[12] = 0;
    //             //console.log("ticketArray after", ticketArray);
    //             console.log("currentCount", currentCount)
    //             let ticketData = {
    //                 ticketId: currentCount,
    //                 tickets: [

    //                     [{ Number: ticketArray[0], checked: false }, { Number: ticketArray[1], checked: false }, { Number: ticketArray[2], checked: false }, { Number: ticketArray[3], checked: false }, { Number: ticketArray[4], checked: false }],

    //                     [{ Number: ticketArray[5], checked: false }, { Number: ticketArray[6], checked: false }, { Number: ticketArray[7], checked: false }, { Number: ticketArray[8], checked: false }, { Number: ticketArray[9], checked: false }],

    //                     [{ Number: ticketArray[10], checked: false }, { Number: ticketArray[11], checked: false }, { Number: ticketArray[12], checked: false }, { Number: ticketArray[13], checked: false }, { Number: ticketArray[14], checked: false }] ,  

    //                     [{ Number: ticketArray[15], checked: false }, { Number: ticketArray[16], checked: false }, { Number: ticketArray[17], checked: false }, { Number: ticketArray[18], checked: false }, { Number: ticketArray[19], checked: false }],

    //                     [{ Number: ticketArray[20], checked: false }, { Number: ticketArray[21], checked: false }, { Number: ticketArray[22], checked: false }, { Number: ticketArray[23], checked: false }, { Number: ticketArray[24], checked: false }],

    //                 ],
    //                 isPurchased: false,
    //                 playerIdOfPurchaser: "",
    //                 ticketType: "",
    //                 ticketColor: "",
    //                 hallName: "",
    //                 gameId: ""
    //             };
    //             //console.log("ticketData", ticketData)

    //             await Sys.App.Services.GameService.insertStaticTicketData(ticketData);

    //         }



    //     }catch(e){
    //         console.log("error in generating static ticket data", e)
    //     }
    // },

    selectLuckyNumber: async function (socket, data) {
        try {
            let language = "nor";
            if (data.language) {
                language = data.language;
            }
            if (data.playerId == null) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "playerid_not_found", language: language }), // 'No PlayerId Found!',
                    statusCode: 400
                }
            }

            if (data.gameId == null) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "game_not_found", language: language }),  //'No GameId Found!',
                    statusCode: 400
                }
            }

            if (data.luckyNumber == null) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "lucky_number_not_found", language: language }), // 'luckyNumber is not found',
                    statusCode: 400
                }
            }

            let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: data.playerId }, { username: 1, selectedLanguage: 1 });
            if (player) {

                let gameData = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, { status: 1 });

                if (gameData === null) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "game_not_found", language: player.selectedLanguage }), //'Game data is not found',
                        statusCode: 400
                    }
                }

                // [ Game Status Active ]
                if (gameData.status == 'active') {

                    await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameData._id, 'players.id': data.playerId },
                        {
                            $set: {
                                'players.$.luckyNumber': data.luckyNumber,
                            },
                        },
                        { new: true }
                    );


                    Sys.Game.Game1.Services.GameServices.updateManyTicketData({ gameId: data.gameId, playerIdOfPurchaser: data.playerId }, { $set: { luckyNumber: data.luckyNumber } });

                    return {
                        status: 'success',
                        result: "",
                        message: await translate({ key: "lucky_number_updated", language: player.selectedLanguage }), // 'LuckyNumber is updated!!',
                        statusCode: 200
                    }
                } else {
                    return {
                        status: 'fail',
                        result: "",
                        message: await translate({ key: "game_already_started", language: player.selectedLanguage }), // 'Game already Started',
                        statusCode: 400
                    }
                }

            } else {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language: language }), // 'No Player Found!',
                    statusCode: 400
                }
            }
        } catch (error) {
            console.log("Error selectLuckyNumber", error);
        }
    },

    viewPurchasedTickets: async function (socket, data) {
        try {
            let language = "nor";
            if (data.language) {
                language = data.language;
            }
            console.log("viewPurchasedTickets: ", data);
            if (data.playerId == null) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "playerid_not_found", language: language }),  // 'playerId is miss',
                    statusCode: 400
                }
            }
            if (data.gameId == null) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "game_not_found", language: language }), // 'gameId is miss',
                    statusCode: 400
                }
            }
            let player = await await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: data.playerId }, { status: 1, selectedLanguage: 1 });
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language: language }), //'No Player Found!',
                    statusCode: 401
                }
            }
            if (player.status.toLowerCase() != 'active') {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_active", language: player.selectedLanguage }), // 'Player is Not Active!',
                    statusCode: 401
                }
            }

            let allPurchasedTickets = await Sys.Game.Game1.Services.GameServices.getTicketListData({ playerIdOfPurchaser: player._id, gameId: data.gameId }, { ticketId: 1, ticketParentId: 1, ticketPrice: 1, hallName: 1, ticketColorName: 1, ticketColorType: 1, tickets: 1, isTicketSubmitted: 1, supplier: 1, developer: 1 });
            let ticketsArr = [];
            for (let i = 0; i < allPurchasedTickets.length; i++) {
                let ticketColor = allPurchasedTickets[i].ticketColorName;
                if (allPurchasedTickets[i].ticketColorType == "elvis") {
                    ticketColor = allPurchasedTickets[i].ticketColorName.slice(6);
                }
                let ticketCellNumberList = [];
                for (let t = 0; t < allPurchasedTickets[i].tickets.length; t++) {
                    for (let n = 0; n < allPurchasedTickets[i].tickets[t].length; n++) {
                        ticketCellNumberList.push(allPurchasedTickets[i].tickets[t][n].Number)
                    }
                }
                let ticketData = {
                    id: allPurchasedTickets[i].id,
                    ticketNumber: allPurchasedTickets[i].ticketId,
                    ticketPrice: allPurchasedTickets[i].ticketPrice,
                    ticketCellNumberList: ticketCellNumberList,
                    hallName: allPurchasedTickets[i].hallName,
                    ticketCompleted: allPurchasedTickets[i].ticketCompleted,
                    ticketColor: ticketColor,
                    ticketCompleted: allPurchasedTickets[i].isTicketSubmitted,
                    supplierName: allPurchasedTickets[i].supplier,
                    developerName: allPurchasedTickets[i].developer,
                }
                ticketsArr.push(ticketData);
            }

            return {
                status: 'success',
                result: ticketsArr,
                message: await translate({ key: "player_purcahsed_tickets", language: player.selectedLanguage }), // 'Player Purchased Tickets.'
            };

        } catch (e) {
            console.log("Error in viewPurchasedTickets : ", e);
            return new Error(e);
        }
    },

    replaceElvisTickets: async function (soket, data) {
        try {
            let language = "nor";
            if (data.language) {
                language = data.language;
            }
            let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: data.playerId }, { status: 1, hall: 1, username: 1, points: 1, walletAmount: 1, selectedLanguage: 1 });
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language: language }), // 'No Player Found!',
                    statusCode: 401
                }
            }
            let game = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, { players: 1, status: 1, subGames: 1, gameName: 1, otherData: 1, isNotificationSent: 1 });
            if (!game || game.gameName != "Elvis") {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "game_not_found", language: player.selectedLanguage }), // 'Game data is not found',
                    statusCode: 401
                }
            }
            if (game.otherData && game.otherData.replaceTicketPrice) {
                if (+game.otherData.replaceTicketPrice != +data.replaceAmount) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "something_went_wrong", language: player.selectedLanguage }), // 'Something Went Wrong',
                        statusCode: 401
                    }
                }
            }
            if (game.isNotificationSent == true) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "can_not_replace_ticket", language: player.selectedLanguage }), // 'Can not replace ticket after game start Notification sent.',
                    statusCode: 401
                }
            }
            if (data.ticketId1 && data.ticketId2) {
                let tickets = await Sys.Game.Game1.Services.GameServices.getTicketListData({ playerIdOfPurchaser: player._id, gameId: data.gameId, _id: { $in: [data.ticketId1, data.ticketId2] } }, { ticketId: 1, ticketParentId: 1, ticketColorName: 1, ticketColorType: 1, tickets: 1, isTicketSubmitted: 1, supplier: 1, developer: 1 });
                if (tickets.length == 2) {

                    //remove old tickets ids
                    // update playerIDs in ticketIdForBalls object
                    let bulupdateTicketData = [];
                    let playerPurchasedTickets = [];
                    if (tickets.length > 0) {
                        for (p = 0; p < tickets.length; p++) {
                            //console.log(" tickets[p]",  tickets[p].tickets);
                            let ticketBallData = {};
                            for (let t = 0; t < tickets[p].tickets.length; t++) {
                                for (let n = 0; n < tickets[p].tickets[t].length; n++) {
                                    //console.log("tickets[p] inside", tickets[p].tickets[t][n].Number, tickets[p]._id)
                                    if (+tickets[p].tickets[t][n].Number != 0) {
                                        ticketBallData["ticketIdForBalls." + tickets[p].tickets[t][n].Number] = { ticketId: tickets[p]._id }
                                    }

                                }

                            }
                            console.log("ticketBallData in replace elvis ticket", ticketBallData)
                            bulupdateTicketData.push({
                                updateOne: {
                                    "filter": { _id: game._id },
                                    "update": { $pull: ticketBallData }
                                }
                            })
                            playerPurchasedTickets.push(tickets[p].id)
                        }
                    }
                    //

                    let selectedElvisinAdminTemp = game.subGames[0].ticketColorTypes;
                    let selectedElvisinAdmin = [1, 2, 3, 4, 5];
                    if (game.subGames[0].ticketColorTypes.length > 0) {
                        selectedElvisinAdmin = selectedElvisinAdminTemp.map((element, index) => {
                            return parseInt(element.slice(11));
                        });
                    }
                    console.log("selectedElvisinAdmin", selectedElvisinAdmin);

                    let selected = randomWithProbability(1, selectedElvisinAdmin);
                    //console.log("selected", selected);
                    ticketColorName = "";
                    for (let s = 0; s < selected.length; s++) {
                        ticketColorName = 'Small Elvis' + selected[s];
                    }

                    let newAddedTickets = ticketColorName.split(" ").join("").toLowerCase();
                    let removedTickets = tickets[0].ticketColorName.split(" ").join("").toLowerCase();

                    let purchasedSlug = data.purchaseType;
                    let TotalAmountOfTickets = +parseFloat(data.replaceAmount).toFixed(2);
                    let deductUserWallet = "";
                    if (purchasedSlug == 'points') {

                        if (player.points < TotalAmountOfTickets) {
                            return {
                                status: 'fail',
                                result: {
                                    playerId: player._id,
                                    username: player.username,
                                },
                                message: await translate({ key: "Insufficient_balance", language: player.selectedLanguage }), // 'Insufficient Balance ..!',
                                statusCode: 401
                            }
                        }
                        deductUserWallet = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: -TotalAmountOfTickets } });
                        if (deductUserWallet.points < 0) {
                            Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: TotalAmountOfTickets } });
                            return {
                                status: 'fail',
                                result: {
                                    playerId: player._id,
                                    username: player.username,
                                },
                                message: await translate({ key: "Insufficient_balance", language: player.selectedLanguage }), // 'Insufficient Balance ..!',
                                statusCode: 401
                            }
                        }
                    } else if (purchasedSlug == 'realMoney') {

                        if (player.walletAmount < TotalAmountOfTickets) {
                            return {
                                status: 'fail',
                                result: {
                                    playerId: player._id,
                                    username: player.username,
                                },
                                message: await translate({ key: "Insufficient_balance", language: player.selectedLanguage }), // 'Insufficient Balance ..!',
                                statusCode: 401
                            }
                        }
                        deductUserWallet = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: -TotalAmountOfTickets } });
                        if (deductUserWallet.walletAmount < 0) {
                            Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: TotalAmountOfTickets } });
                            return {
                                status: 'fail',
                                result: {
                                    playerId: player._id,
                                    username: player.username,
                                },
                                message: await translate({ key: "Insufficient_balance", language: player.selectedLanguage }), // 'Insufficient Balance ..!',
                                statusCode: 401
                            }
                        }
                    } else if (purchasedSlug == 'voucher') {
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({ key: "voucher_not_applied_for_game", language: player.selectedLanguage }), // 'Voucher for this game can not applied..!!',
                            statusCode: 401
                        }
                    }

                    let ticketQnty = 2;
                    let finalDataTicketTemp = [];
                    let ticketTemp = await Sys.Game.Game1.Services.GameServices.getStaticByData({ isPurchased: false, gameId: { $ne: data.gameId } }, { isPurchased: 1, tickets: 1, ticketId: 1 }, { limit: (parseInt(ticketQnty) + 100) })
                    if (ticketTemp.length > 0 && ticketTemp.length >= ticketQnty) {
                        for (let i = 0; i < ticketTemp.length; i++) {
                            if (finalDataTicketTemp.length >= parseInt(ticketQnty)) { break; }
                            //console.log("purchasing static ticket number", ticketTemp[i]._id, ticketTemp[i])
                            let updatedTicket = await Sys.Game.Game1.Services.GameServices.updateStaticGameCustom({ _id: ticketTemp[i]._id, isPurchased: false }, { isPurchased: true, playerIdOfPurchaser: data.playerId, gameId: data.gameId });
                            //console.log("updatedTicket result of static ticket", updatedTicket)
                            if (updatedTicket == null) {
                                console.log("tickets not purchased while updating ticket", ticketTemp[i].id)
                            } else {
                                finalDataTicketTemp.push(ticketTemp[i])
                            }
                        }
                    }

                    if (finalDataTicketTemp.length >= parseInt(ticketQnty)) {
                        let amount = parseFloat(TotalAmountOfTickets / finalDataTicketTemp.length).toFixed(2);
                        for (let r = 0; r < finalDataTicketTemp.length; r++) {
                            let ticket = finalDataTicketTemp[r].tickets;
                            ticket[2][2] = { Number: 0, checked: true };
                            let updatedTicket = { tickets: ticket, ticketColorName: ticketColorName, ticketId: finalDataTicketTemp[r].ticketId, ticketParentId: finalDataTicketTemp[r].id, }

                            await Sys.Game.Game1.Services.GameServices.findOneAndUpdateTicket({ _id: tickets[r]._id, playerIdOfPurchaser: data.playerId }, { $set: updatedTicket, $inc: { totalReplaceAmount: amount } }, { new: true });
                        }

                        // remvove old tickets ids and add new tickets
                        await Sys.App.Services.GameService.bulkWriteGameData(bulupdateTicketData);

                        console.log("playerPurchasedTickets in replace ticket", playerPurchasedTickets)
                        let prTickets = await Sys.Game.Game1.Services.GameServices.getTicketListData({ _id: { $in: playerPurchasedTickets } }, { tickets: 1 });
                        let bulupdateTicketDataNew = [];
                        if (prTickets.length > 0) {
                            for (p = 0; p < prTickets.length; p++) {
                                let ticketBallData = {};
                                for (let t = 0; t < prTickets[p].tickets.length; t++) {
                                    for (let n = 0; n < prTickets[p].tickets[t].length; n++) {
                                        if (+prTickets[p].tickets[t][n].Number != 0) {
                                            ticketBallData["ticketIdForBalls." + prTickets[p].tickets[t][n].Number] = { ticketId: prTickets[p]._id, position: t + ":" + n }
                                        }
                                    }

                                }
                                console.log("ticketBallData", ticketBallData)
                                bulupdateTicketDataNew.push({
                                    updateOne: {
                                        "filter": { _id: game._id },
                                        "update": {
                                            $push: ticketBallData,
                                        }
                                    }
                                })
                            }
                        }
                        Sys.App.Services.GameService.bulkWriteGameData(bulupdateTicketDataNew);

                        //Update count of the tickets in halls
                        await Sys.Game.Game1.Services.GameServices.updateGameNested(
                            { _id: game._id },
                            {
                                $inc: {
                                    [`groupHalls.$[group].halls.$[hall].ticketData.${newAddedTickets}`]: 2,
                                    [`groupHalls.$[group].halls.$[hall].ticketData.${removedTickets}`]: -2
                                }
                            },
                            {
                                arrayFilters: [{ "group.halls.id": player.hall.id.toString() }, { "hall.id": player.hall.id.toString() }],
                                new: true
                            }
                        );

                        //

                        let newExtraTransaction = {
                            playerId: player._id,
                            gameId: game._id,
                            transactionSlug: "extraTransaction",
                            typeOfTransaction: "Replaced Tickets",
                            action: "debit", // debit / credit
                            purchasedSlug: purchasedSlug, // point /realMoney
                            totalAmount: TotalAmountOfTickets,
                            game1Slug: "replaceTicket"
                        }

                        Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                        
                        await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: game._id},
                            {
                                $inc: {
                                'otherData.elvisReceivedReplaceAmount': TotalAmountOfTickets
                                }
                            },
                            { new: true }
                        );

                        
                        return {
                            status: 'success',
                            message: await translate({ key: "tickets_replaced", language: player.selectedLanguage }), // 'Tickets Replaced Successfully'
                        }

                    } else {
                        if (purchasedSlug == 'points') {
                            Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: TotalAmountOfTickets } });
                        } else if (purchasedSlug == 'realMoney') {
                            Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: TotalAmountOfTickets } });
                        }
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({ key: "something_went_wrong", language: player.selectedLanguage }), // 'Something Went Wrong',
                            statusCode: 401
                        }
                    }

                }
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "ticket_not_found", language: player.selectedLanguage }), // 'Tickets not found',
                    statusCode: 401
                }
            } else {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "provid_ticketds", language: player.selectedLanguage }), // 'Please provide ticket Ids',
                    statusCode: 401
                }
            }

        } catch (e) {
            console.log("Error in replaceElvisTickets : ", e);
            return {
                status: 'fail',
                message: 'Something Went Wrong'
            };
        }
    },

    sendGameChat: async function (socket, data) {
        try {
            let language = "nor";
            if (data.language) {
                language = data.language;
            }
            let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: data.playerId }, { username: 1, profilePic: 1, userProfilePic: 1, selectedLanguage: 1 });
            if (player) {
                let gameData = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, { status: 1 });

                if (gameData === null) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "game_not_found", language: player.selectedLanguage }), // 'Game data is not found',
                    }
                }

                let query = {
                    playerId: player.id,
                    name: player.username,
                    profilePic: player.userProfilePic ? player.userProfilePic : "/assets/profilePic/gameUser.jpg",
                    emojiId: data.emojiId,
                    roomId: gameData._id,
                    message: data.message,
                    socketId: socket.id,
                    createdAt: Date.now()
                }
                let chats = await Sys.Game.Game1.Services.ChatServices.insertData(query);

                let tmp = {
                    playerId: chats.playerId,
                    name: chats.name,
                    profilePic: chats.profilePic,
                    message: chats.message,
                    emojiId: chats.emojiId,
                    dateTime: await Sys.Helper.bingo.gameUTCTime(chats.createdAt)
                }

                await Sys.Io.of(Sys.Config.Namespace.Game1).to(gameData._id).emit('GameChat', tmp);

                return {
                    status: 'success',
                    result: '',
                    message: 'Chat boardcast send Successfully..!!'
                }

            } else {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language: language }),  // 'No Player Found!',
                    statusCode: 400
                }
            }


        } catch (error) {
            console.log("Error sendGameChat", error);
        }

    },

    gameChatHistory: async function (socket, data) {
        try {
            let language = "nor";
            if (data.language) {
                language = data.language;
            }
            let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: data.playerId }, { username: 1, profilePic: 1, selectedLanguage: 1 });
            if (player) {
                let gameData = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, { status: 1 });
                if (gameData === null) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "game_not_found", language: player.selectedLanguage }), // 'Game data is not found',
                    }
                }
                let history = [];
                let allChatData = await Sys.Game.Game1.Services.ChatServices.getByData({ roomId: gameData._id });

                for (var i = 0; i < allChatData.length; i++) {
                    let objData = {
                        playerId: allChatData[i].playerId,
                        name: allChatData[i].name,
                        profilePic: allChatData[i].profilePic,
                        message: allChatData[i].message,
                        emojiId: allChatData[i].emojiId,
                        dateTime: await Sys.Helper.bingo.gameUTCTime(allChatData[i].createdAt),
                    }
                    history.push(objData);
                }

                let onlinePlayers = await getOnlinePlayers('/Game1', gameData._id);
                await Sys.Io.of(Sys.Config.Namespace.Game1).to(gameData._id).emit('GameOnlinePlayerCount', { onlinePlayerCount: onlinePlayers });

                let result = {
                    onlinePlayerCount: onlinePlayers,
                    history: history
                }

                return {
                    status: 'success',
                    result: result,
                    message: 'Game Chat History send Successfully..!!'
                }

            } else {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language: language }), // 'No Player Found!',
                    statusCode: 400
                }
            }

        } catch (error) {
            console.log("Error sendGameChat", error);
        }

    },

    leftRoom: async function (socket, data) {
        try {
            console.log("leftroom called")
            let language = "nor";
            if (data.language) {
                language = data.language;
            }
            if (!data.gameId) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "game_not_found", language: language }), // 'Game data is not found',
                    statusCode: 400
                }
            }
            let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: data.playerId }, { username: 1, profilePic: 1, selectedLanguage: 1 });
            if (player) {
                let gameData = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, { status: 1 });
                if (gameData === null) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "game_not_found", language: player.selectedLanguage }), // 'Game data is not found',
                    }
                }

                socket.leave(data.gameId, async function () {
                    let onlinePlayers = await getOnlinePlayers('/Game1', data.gameId);
                    console.log("onlinePlayers in leftRoom", onlinePlayers)

                    Sys.Io.of(Sys.Config.Namespace.Game1).to(gameData._id).emit('GameOnlinePlayerCount', { onlinePlayerCount: onlinePlayers });
                });

                return {
                    status: 'success',
                    result: null,
                    message: await translate({ key: "player_left", language: player.selectedLanguage }), //'player left successfully!',
                }
            } else {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language: language }), // 'No Player Found!',
                    statusCode: 400
                }
            }
        } catch (e) {
            console.log("Error in leftRoom : ", e);
            return new Error(e);
        }
    },

    adminHallDisplayLogin: async function (socket, data) {
        try {
            let gameData = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.roomId }, { status: 1, withdrawNumberList: 1, winners: 1, adminWinners: 1, subGames: 1, gameName: 1, sequence: 1, jackpotPrize: 1, otherData: 1, earnedFromTickets: 1, parentGameId: 1, wofWinners: 1, tChectWinners: 1, mystryWinners: 1, colorDraftWinners: 1, multipleWinners: 1, countDownDateTime: 1, jackpotDraw: 1 });
            //console.log("gameData--", gameData)
            if (!gameData) {
                return {
                    status: 'fail',
                    result: null,
                    message: 'Game Not Found!',
                }
            }
            //console.log("socket before", socket)
            socket.join(data.roomId); // Subscribe Room.

            socket.myData = {};
            socket.myData.gameType = 'game_1';
            socket.myData.gameName = 'Spillorama';
            socket.myData.isAdmin = true;
            let gameStatus = gameData.status;
            let totalWithdrawCount = gameData.withdrawNumberList.length;
            let fullHouseWinners = 0;
            let patternsWon = 0;
            let withdrawNumberList = gameData.withdrawNumberList;
            let winningList = [];

            for (let w = 0; w < gameData.winners.length; w++) {
                if (gameData.winners[w].isFullHouse == true) {
                    fullHouseWinners = fullHouseWinners + 1;
                }
            }

            if (gameData.winners.length > 0) {
                const patternUnique = [...new Set(gameData.winners.map(item => item.lineType))];
                //console.log("patternUnique", patternUnique)
                patternsWon = patternUnique.length;
            }
            console.log("Socket While Join Room: ", socket.id, socket.myData);

            let winningListTemp = [];
            if (gameData.status == "finish") {
                if (gameData.winners.length) {
                    winningListTemp = [...gameData.winners.reduce((mp, o) => {
                        if (!mp.has(o.lineType)) mp.set(o.lineType, { ...o, count: 0, finalWonAmount: 0 });
                        mp.get(o.lineType).count++;
                        mp.get(o.lineType).finalWonAmount = +parseFloat(mp.get(o.lineType).finalWonAmount + +o.wonAmount).toFixed(4);
                        return mp;
                    }, new Map).values()];
                }
            } else {
                console.log("gameData.adminWinners", gameData.adminWinners)
                if (gameData.adminWinners && gameData.adminWinners.length) {
                    winningListTemp = [...gameData.adminWinners.reduce((mp, o) => {
                        if (!mp.has(o.lineType)) mp.set(o.lineType, { ...o, count: 0, finalWonAmount: 0 });
                        mp.get(o.lineType).count++;
                        mp.get(o.lineType).finalWonAmount = +parseFloat(mp.get(o.lineType).finalWonAmount + +o.wonAmount).toFixed(4);
                        return mp;
                    }, new Map).values()];
                }
            }


            for (let w = 0; w < winningListTemp.length; w++) {
                winningList.push({
                    "id": winningListTemp[w].lineType,
                    "displayName": winningListTemp[w].lineTypeDisplay,
                    "winnerCount": winningListTemp[w].count,
                    "prize": winningListTemp[w].finalWonAmount,
                    //"prize": (gameData.status == "finish") ? winningListTemp[w].finalWonAmount : 0,
                })
            }

            // check for all winning patterns 
            /*let allWinningPatterns = [];
            // let winningPatternsArray = [];
            if(gameData.subGames.length > 0 && gameData.subGames[0].options && gameData.subGames[0].options.length > 0 && gameData.subGames[0].options[0].winning && gameData.subGames[0].options[0].winning.length > 0 ){
                for(let w = 0; w < gameData.subGames[0].options[0].winning.length; w++){
                    allWinningPatterns.push({
                        "id": gameData.subGames[0].options[0].winning[w].winningPatternType,
                        "displayName": gameData.subGames[0].options[0].winning[w].winningPatternName,
                        "winnerCount": 0,
                        "prize":0,
                    })
                }   
            }else{
                 console.log("No winning pattern found, so no winners", data.roomId);
            }

            let finalWinningList = [];
            if(winningList.length > 0){
                if(allWinningPatterns.length > 0){
                    for(let p=0; p < allWinningPatterns.length; p++){
                        let index = winningList.findIndex((e) => e.id == allWinningPatterns[p].id);
                        if (index == -1) {
                            finalWinningList.push(allWinningPatterns[p]);
                        }else{
                            finalWinningList.push(winningList[index]);
                        }
                    }
                }
            }else{
                finalWinningList = allWinningPatterns;
            }
            console.log("finalWinningList----", finalWinningList)*/

            let patternListTemp = Object.keys(gameData.subGames[0].options[0].winning);
            if (gameData.gameName == "Super Nils") {
                patternListTemp = Object.keys(gameData.subGames[0].options[0].winning.B)
            }
            function getHighestPrice(pattern) {
                if (gameData.gameName == "Super Nils") {
                    let allWinningOptions = gameData.subGames[0].options[0].winning;
                    let highestWinning = 0;
                    for (const patterwinning in allWinningOptions) {
                        let winning = allWinningOptions[patterwinning][pattern];
                        if (+winning > +highestWinning) {
                            highestWinning = +winning;
                        }
                    }
                    return highestWinning;
                } else if (gameData.gameName == "Spillerness Spill" || gameData.gameName == "Spillerness Spill 2" || gameData.gameName == "Spillerness Spill 3") {
                    let winningPercentage = gameData.subGames[0].options[0].winning[pattern];
                    let winningAmountSpill = +parseFloat(exactMath.div(exactMath.mul(gameData.earnedFromTickets, winningPercentage), 100)).toFixed(2);
                    console.log("winningPercentage and amount of spillerness game", winningPercentage, winningAmountSpill)
                    if (gameData.gameName == "Spillerness Spill" || gameData.gameName == "Spillerness Spill 2") {
                        let minimumWinningAmount = gameData.subGames[0].options[0].minimumWinning[pattern];
                        if (minimumWinningAmount && minimumWinningAmount > 0) {
                            if (minimumWinningAmount > winningAmountSpill) {
                                winningAmountSpill = minimumWinningAmount;
                            }
                        }
                    }
                    return winningAmountSpill;

                } else {
                    let allWinningOptions = gameData.subGames[0].options;
                    let highestWinning = 0;
                    if (allWinningOptions.length > 0) {
                        for (let i = 0; i < allWinningOptions.length; i++) {
                            let patternListTemp = allWinningOptions[i].winning;
                            let winning = patternListTemp[pattern];
                            if (+winning > +highestWinning) {
                                highestWinning = +winning;
                            }
                        }
                        return highestWinning;
                    }
                }

            }
            let patternList = [];
            let jackPotData = { isDisplay: false };
            if (patternListTemp.length > 0) {
                for (let p = 0; p < patternListTemp.length; p++) {
                    if (patternListTemp[p] == "Row 1") { patternList.push({ id: "Row 1", displayName: "Row 1", winnerCount: 0, prize: Math.round(getHighestPrice("Row 1")) }) }
                    else if (patternListTemp[p] == "Row 2") { patternList.push({ id: "Row 2", displayName: "Row 2", winnerCount: 0, prize: Math.round(getHighestPrice("Row 2")) }) }
                    else if (patternListTemp[p] == "Row 3") { patternList.push({ id: "Row 3", displayName: "Row 3", winnerCount: 0, prize: Math.round(getHighestPrice("Row 3")) }) }
                    else if (patternListTemp[p] == "Row 4") { patternList.push({ id: "Row 4", displayName: "Row 4", winnerCount: 0, prize: Math.round(getHighestPrice("Row 4")) }) }
                    else if (patternListTemp[p] == "Picture") { patternList.push({ id: "Picture", displayName: "Picture", winnerCount: 0, prize: Math.round(getHighestPrice("Picture")) }) }
                    else if (patternListTemp[p] == "Frame") { patternList.push({ id: "Frame", displayName: "Frame", winnerCount: 0, prize: Math.round(getHighestPrice("Frame")) }) }
                    else if (patternListTemp[p] == "Full House") {
                        let winningAmount = 0;
                        let message = "";
                        
                        const setJackpotData = (draw, amount, isDisplay) => {
                            jackPotData = { draw, winningAmount: +amount, isDisplay, tvScreenWinningAmount: +amount, isDisplayOnTVScreen: true };
                        };

                        switch (gameData.gameName) {
                            case "Jackpot":
                                message = "Jackpot Winning";
                                if (totalWithdrawCount < (+gameData.jackpotDraw + 1)) {
                                    winningAmount = Math.max(...Object.values(gameData.jackpotPrize));
                                    setJackpotData(gameData.jackpotDraw, winningAmount, true);
                                }else{
                                    winningAmount = getHighestPrice("Full House");
                                    setJackpotData(gameData.jackpotDraw, winningAmount, false);
                                }
                                break;

                            case "Wheel of Fortune":
                            case "Treasure Chest": {
                                const slug = gameData.gameName === "Wheel of Fortune" ? "wheelOfFortune" : "treasureChest";
                                message = gameData.gameName === "Wheel of Fortune" ? "Spin Wheel of Fortune to Win" : "Open Treasure Chest to Win";

                                const { [`${slug}prizeList`]: prizeList } = await Sys.App.Services.otherGameServices.getByData({ slug });
                                winningAmount = Math.max(...prizeList);
                                break;
                            }

                            case "Oddsen 56":
                            case "Oddsen 57":
                            case "Oddsen 58": {
                                const ballCount = parseInt(gameData.gameName.split(" ")[1], 10);
                                const oddsenPrize = getHighestPrice(`Full House Within ${ballCount} Balls`);
                                const fullHousePrize = getHighestPrice("Full House");
                                
                                if (totalWithdrawCount < (ballCount + 1)) {
                                    winningAmount = Math.max(oddsenPrize, fullHousePrize, true);
                                    setJackpotData(ballCount, oddsenPrize, true);
                                }else{
                                    winningAmount = fullHousePrize;
                                    setJackpotData(gameData.jackpotDraw, winningAmount, false);
                                }
                                break;
                            }

                            case "Innsatsen": {
                                const { innsatsenSales } = await Sys.App.Services.scheduleServices.getSingleDailySchedulesData(
                                    { _id: gameData.parentGameId }, 
                                    { innsatsenSales: 1 }
                                );

                                const innBeforeSales = parseFloat(innsatsenSales ?? 0).toFixed(2);
                                const fullHousePrize = parseFloat(gameData.subGames[0].options[0].winning["Full House"]).toFixed(2);

                                if (totalWithdrawCount < (+gameData.jackpotDraw + 1)) {
                                    winningAmount = Math.min(2000, (parseFloat(innBeforeSales) + parseFloat(fullHousePrize)));
                                    setJackpotData(gameData.jackpotDraw, winningAmount, true);
                                }else{
                                    winningAmount = fullHousePrize;
                                    setJackpotData(gameData.jackpotDraw, winningAmount, false);
                                }
                                break;
                            }

                            case "Mystery": {
                                const { mysteryPrizeList } = await Sys.App.Services.otherGameServices.getByData({ slug: "mystery" });
                                winningAmount = Math.max(...mysteryPrizeList);
                                break;
                            }

                            case "Color Draft": {
                                message = "Play Color Draft game to Win";
                                const { colordraftPrizeList } = await Sys.App.Services.otherGameServices.getByData({ slug: "colorDraft" });

                                if (colordraftPrizeList?.length > 0) {
                                    winningAmount = colordraftPrizeList
                                    .sort((a, b) => b.amount - a.amount) // Sort in descending order
                                    .slice(0, 3) // Get top 3 elements (non-destructive)
                                    .reduce((sum, { amount }) => sum + +amount, 0); // Sum amounts
                                }
                                break;
                            }

                            default:
                                winningAmount = getHighestPrice("Full House");
                        }

                        winningAmount = Math.round(winningAmount);
                        patternList.push({ id: "Full House", displayName: "Full House", winnerCount: 0, prize: winningAmount });
                    }
                }
            }

            let finalWinningList = [];
            if (winningList.length > 0) {
                for (let p = 0; p < patternList.length; p++) {
                    let index = winningList.findIndex(x => x.id == patternList[p].id);
                    if (index >= 0) {
                        finalWinningList.push(winningList[index]);
                    } else {
                        finalWinningList.push(patternList[p]);
                    }
                }
            } else {
                finalWinningList = patternList
            }

            console.log("patternList and winningList---", patternList, winningList, finalWinningList)
            let minigameData = {};
            if (gameData.gameName == "Wheel of Fortune" || gameData.gameName == "Treasure Chest") {
                if (gameStatus == "finish") {
                    console.log("gameData.wofWinners--", gameData.wofWinners, gameData.otherData)
                    let isDisplayWheel = false;
                    if (gameData.wofWinners && gameData.wofWinners.length > 0) {
                        let onlinePlayerCount = gameData.wofWinners.filter(e => (e.playerType == "Unique" || e.playerType == "Online")).length;
                        console.log("onlinePlayerCount---", onlinePlayerCount)
                        if (onlinePlayerCount >= 1) {
                            isDisplayWheel = true;
                        }
                    }

                    let winningTicketNumbers = {};
                    let wonAmount = 0;
                    if (gameData.gameName == "Wheel of Fortune" && gameData.otherData.isMinigamePlayed == true) {
                        let physicalWinners = [], onlineWinners = [], uniqueWinners = [];
                        for (let w = 0; w < gameData.wofWinners.length; w++) {
                            if (gameData.wofWinners[w].playerType == "Physical") {
                                physicalWinners.push({ ticketNumber: gameData.wofWinners[w].ticketNumber, winningAmount: gameData.wofWinners[w].WinningAmount });
                            } else if (gameData.wofWinners[w].playerType == "Online") {
                                onlineWinners.push({ ticketNumber: gameData.wofWinners[w].ticketNumber, winningAmount: gameData.wofWinners[w].WinningAmount });
                            } else {
                                uniqueWinners.push({ ticketNumber: gameData.wofWinners[w].ticketNumber, winningAmount: gameData.wofWinners[w].WinningAmount });
                            }
                        }
                        wonAmount = gameData.wofWinners[0].WinningAmount;
                        winningTicketNumbers = { physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners }
                    }

                    if (gameData.gameName == "Treasure Chest" && gameData.otherData.isMinigamePlayed == true) {
                        let physicalWinners = [], onlineWinners = [], uniqueWinners = [];
                        if (gameData.tChectWinners && gameData.tChectWinners.length > 0) {
                            for (let w = 0; w < gameData.tChectWinners.length; w++) {
                                if (gameData.tChectWinners[w].playerType == "Physical") {
                                    physicalWinners.push({ ticketNumber: gameData.tChectWinners[w].ticketNumber, winningAmount: gameData.tChectWinners[w].WinningAmount });
                                } else if (gameData.tChectWinners[w].playerType == "Online") {
                                    onlineWinners.push({ ticketNumber: gameData.tChectWinners[w].ticketNumber, winningAmount: gameData.tChectWinners[w].WinningAmount });
                                } else {
                                    uniqueWinners.push({ ticketNumber: gameData.tChectWinners[w].ticketNumber, winningAmount: gameData.tChectWinners[w].WinningAmount });
                                }
                            }
                            wonAmount = gameData.tChectWinners[0].WinningAmount;
                            winningTicketNumbers = { physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners }
                        }

                    }
                    console.log("winningTicketNumbers & wonAmount", winningTicketNumbers, wonAmount)

                    let currentTurnCountTimer = 10;
                    if (gameData.gameName == "Wheel of Fortune" || gameData.gameName == "Treasure Chest") {
                        if (Timeout.exists(gameData._id.toString())) {
                            let currentTurnCountTimerTemp = Timeout.remaining(gameData._id.toString());
                            if (currentTurnCountTimerTemp) {
                                currentTurnCountTimer = Math.ceil(currentTurnCountTimerTemp / 1000);
                            }
                            console.log("timeout remianing of minigames", currentTurnCountTimer)
                        }
                    }


                    minigameData = {
                        "gameName": gameData.gameName,
                        //"isMinigameActivated": gameData.otherData.isMinigameActivated,
                        "isMinigamePlayed": gameData.otherData.isMinigamePlayed,
                        //"isMinigameFinished": gameData.otherData.isMinigameFinished
                        "isDisplayWheel": isDisplayWheel,
                        "isMinigameActivated": gameData.otherData.isMinigameActivated,
                        "isMinigameFinished": gameData.otherData.isMinigameFinished,
                        "wonAmount": wonAmount,
                        "winningTicketNumbers": winningTicketNumbers,
                        "turnTimer": parseInt(currentTurnCountTimer),
                        "isWofSpinStopped": gameData?.otherData?.isWofSpinStopped ?? false, // it will be true for wof after spin stopped broadcast sent
                    }
                }
            }
            let wonAmount = 0, winningTicketNumbers = [];
            if (gameData.gameName == "Mystery") {
                let physicalWinners = [], onlineWinners = [], uniqueWinners = [];
                if (gameData.mystryWinners && gameData.mystryWinners.length > 0) {
                    for (let w = 0; w < gameData.mystryWinners.length; w++) {
                        if (gameData.mystryWinners[w].playerType == "Physical") {
                            physicalWinners.push({ ticketNumber: gameData.mystryWinners[w].ticketNumber, winningAmount: gameData.mystryWinners[w].WinningAmount });
                        } else if (gameData.mystryWinners[w].playerType == "Online") {
                            onlineWinners.push({ ticketNumber: gameData.mystryWinners[w].ticketNumber, winningAmount: gameData.mystryWinners[w].WinningAmount });
                        } else {
                            uniqueWinners.push({ ticketNumber: gameData.mystryWinners[w].ticketNumber, winningAmount: gameData.mystryWinners[w].WinningAmount });
                        }
                    }
                    wonAmount = gameData.mystryWinners[0].WinningAmount;
                    winningTicketNumbers = { physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners }
                }
                minigameData = {
                    "gameName": gameData.gameName,
                    "isMinigamePlayed": gameData.otherData.isMinigamePlayed,
                    "isDisplayWheel": false,
                    "isMinigameActivated": gameData.otherData.isMinigameActivated,
                    "isMinigameFinished": gameData.otherData.isMinigameFinished,
                    "wonAmount": wonAmount,
                    "winningTicketNumbers": winningTicketNumbers,
                    //"mysteryHistory": gameData.otherData.mysteryHistory
                }
            } else if (gameData.gameName == "Color Draft") {
                let physicalWinners = [], onlineWinners = [], uniqueWinners = [];
                if (gameData.colorDraftWinners && gameData.colorDraftWinners.length > 0) {
                    for (let w = 0; w < gameData.colorDraftWinners.length; w++) {
                        if (gameData.colorDraftWinners[w].playerType == "Physical") {
                            physicalWinners.push({ ticketNumber: gameData.colorDraftWinners[w].ticketNumber, winningAmount: gameData.colorDraftWinners[w].WinningAmount });
                        } else if (gameData.colorDraftWinners[w].playerType == "Online") {
                            onlineWinners.push({ ticketNumber: gameData.colorDraftWinners[w].ticketNumber, winningAmount: gameData.colorDraftWinners[w].WinningAmount });
                        } else {
                            uniqueWinners.push({ ticketNumber: gameData.colorDraftWinners[w].ticketNumber, winningAmount: gameData.colorDraftWinners[w].WinningAmount });
                        }
                    }
                    wonAmount = gameData.colorDraftWinners[0].WinningAmount;
                    winningTicketNumbers = { physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners }
                }
                minigameData = {
                    "gameName": gameData.gameName,
                    "isMinigamePlayed": gameData.otherData.isMinigamePlayed,
                    "isDisplayWheel": false,
                    "isMinigameActivated": gameData.otherData.isMinigameActivated,
                    "isMinigameFinished": gameData.otherData.isMinigameFinished,
                    "wonAmount": wonAmount,
                    "winningTicketNumbers": winningTicketNumbers,
                    "miniGameHistory": gameData.otherData.miniGameHistory
                }
            }

            if (gameStatus == "finish" && gameData.otherData.isMinigameActivated == true) {
                if (gameData.winners.length > 0) {
                    let isIndex = gameData.winners.findIndex((e) => (e.enabledSpinner == true));
                    if (isIndex >= 0) {
                        minigameData.isForAdmin = (gameData.winners[isIndex].userType == "Physical") ? true : false
                    }
                }
            }

            // show last winning pattern
            let winningTickets = [];
            if (gameData.adminWinners && gameData.adminWinners.length > 0) {
                const lastLineTypeDisplay = gameData.adminWinners[gameData.adminWinners.length - 1].lineTypeDisplay;
                const adminWinners = gameData.adminWinners.filter(winner => winner.lineTypeDisplay === lastLineTypeDisplay);
                const resultArray = [...adminWinners.reduce((mp, o) => {
                    if (!mp.has(o.lineType)) mp.set(o.lineType, { ...o, winningTicket: [] });
                    mp.get(o.lineType).winningTicket.push({ ticket: o.ticketCellArray, wonElement: o.wonElements });
                    return mp;
                }, new Map).values()];
                console.log("lastLineTypeDisplay, adminWinners and resultArray", lastLineTypeDisplay, adminWinners, resultArray)
                for (let w = 0; w < resultArray.length; w++) {

                    if (resultArray[w].winningTicket && resultArray[w].winningTicket.length > 0) {
                        for (let i = 0; i < resultArray[w].winningTicket.length; i++) {
                            if (resultArray[w].lineType == "Frame") {
                                let frame = ["0:0", "0:1", "0:2", "0:3", "0:4", "1:0", "1:4", "2:0", "2:4", "3:0", "3:4", "4:0", "4:1", "4:2", "4:3", "4:4"];
                                const frameSet = new Set(frame);
                                const filteredArray = resultArray[w].winningTicket[i].ticket.map((row, rowIndex) =>
                                    row.map((item, colIndex) => {
                                        const coord = `${rowIndex}:${colIndex}`;
                                        return frameSet.has(coord) ? item : "";
                                    })
                                );
                                winningTickets.push({ numbers: filteredArray, patternName: resultArray[w].lineType });
                            } else if (resultArray[w].lineType == "Picture") {
                                let picture = ["1:1", "1:2", "1:3", "2:1", "2:2", "2:3", "3:1", "3:2", "3:3"];
                                const frameSet = new Set(picture);
                                const filteredArray = resultArray[w].winningTicket[i].ticket.map((row, rowIndex) =>
                                    row.map((item, colIndex) => {
                                        const coord = `${rowIndex}:${colIndex}`;
                                        return frameSet.has(coord) ? item : "";
                                    })
                                );
                                winningTickets.push({ numbers: filteredArray, patternName: resultArray[w].lineType });
                            } else if (resultArray[w].lineType == "Row 1" && resultArray[w].winningTicket[i].wonElement.columns.length > 0) {
                                const showColumnAsRow = (arr, columnIndex) => {
                                    const column = arr.map(row => row[columnIndex]);
                                    return arr.map((row, index) => index === columnIndex ? column : ["", "", "", "", ""]);
                                };
                                const result = showColumnAsRow(resultArray[w].winningTicket[i].ticket, (+resultArray[w].winningTicket[i].wonElement.columns[0]));
                                winningTickets.push({ numbers: result, patternName: resultArray[w].lineType });
                            } else {
                                const result = resultArray[w].winningTicket[i].ticket.map((row, index) => {
                                    return resultArray[w].winningTicket[i].wonElement.rows.includes(index) ? row : ["", "", "", "", ""];
                                });
                                winningTickets.push({ numbers: result, patternName: resultArray[w].lineType });
                            }
                        }
                    }
                }
            }
            let finalWinningTickets = [];
            if (winningTickets.length > 0) {
                finalWinningTickets = winningTickets.map(item => ({
                    numbers: item.numbers.flat().map(String),
                    patternName: item.patternName
                }));
            }

            // next withdraw number for tv screen
            let nextWithdrawBall = gameData.otherData?.nextWithdrawBall ?? { number: null, color: null };
            const lastWithdrawCount = withdrawNumberList.at(-1)?.totalWithdrawCount ?? -1;
            const newWithdrawNumberList = (lastWithdrawCount === -1) ? withdrawNumberList:  [...withdrawNumberList, {number: nextWithdrawBall.number, color: nextWithdrawBall.color, totalWithdrawCount: lastWithdrawCount + 1 }];
            let result = {
                gameStatus: (gameStatus == "finish") ? "Finished" : (gameStatus == "active") ? "Waiting" : (gameStatus == "running") ? "Running" : gameStatus, //gameStatus,
                totalWithdrawCount: totalWithdrawCount,
                fullHouseWinners: fullHouseWinners,
                patternsWon: patternsWon,
                withdrawNumberList: newWithdrawNumberList, // withdrawNumberList,
                winningList: finalWinningList,
                gameName: gameData.gameName,
                gameCount: gameData.sequence,
                totalBallsDrawn: withdrawNumberList.length,
                minigameData: minigameData,
                gameFinishAdminData: {
                    totalWithdrawCount: totalWithdrawCount,
                    fullHouseWinners: fullHouseWinners,
                    patternsWon: patternsWon, // gameData.multipleWinners.length,
                    winners: gameData.otherData.winnerAdminResultArray
                },
                gameId: data.roomId,
                isGamePaused: (gameData.otherData.isPaused == true) ? true : false,
                pauseGameMessage: "Checking the claimed tickets.",
                winningTickets: finalWinningTickets,
                countDownDateTime: gameData.countDownDateTime,
                nextNumber: nextWithdrawBall,
                jackPotData

            };
            console.log("result", result)

            await Sys.Io.of(Sys.Config.Namespace.Game1).to(socket.id).emit('SubscribeRoomAdmin', result);
            console.log("broadcast sent successfully.", socket.id)
            return {
                status: "success",
                message: "Game Found!"
            }
        } catch (e) {
            console.log("Error in adminHallDisplayLogin ", e);
        }
    },

    deleteDailySchedules: async function () {
        try {
            let queryGame1 = {
                status: { $in: ["active", "running"] },
                isSavedGame: false,
                endDate: { $lt: moment() },
            };
            let dailyScheduleList = await Sys.App.Services.scheduleServices.getDailySchedulesByData(queryGame1);
            console.log("dailyScheduleList---", dailyScheduleList)
            if (dailyScheduleList.length > 0) {
                for (let d = 0; d < dailyScheduleList.length; d++) {
                    let endDate = dailyScheduleList[d].endDate;
                    console.log("endDate of daily schedule", endDate, moment(endDate), moment());
                    if (moment() > moment(endDate)) {
                        await Sys.App.Services.scheduleServices.updateDailySchedulesData({ _id: dailyScheduleList[d]._id }, {
                            $set: { "status": "finish" }
                        });
                        await Sys.Game.Game1.Services.GameServices.updateManyData(
                            { "parentGameId": dailyScheduleList[d]._id },
                            { $set: { "status": "finish" } }
                        );
                        /*let game1Query = {
                            parentGameId: dailyScheduleList[d]._id,
                            status : { $in:["active","running"]},
                            gameType: "game_1",
    
                        }
                        let game1List = await Sys.Game.Common.Services.GameServices.getByData(game1Query, {gameType: 1,startDate: 1, graceDate: 1,status: 1, gameMode: 1});
                        console.log("game1List in delete daily schdule", game1List);
                        if(game1List.length > 0){
                            for(let g=0; g < game1List.length; g++){
                                let 
                                if(game1List[g].gameMode == "Manual"){
    
                                }else{
                                    
                                }
                            }
                        }*/
                    }
                }
            }

            // Restore all the registered tickets to default for all the halls
            console.log("Remove all the registered tickets")
            //Sys.App.Services.scheduleServices.deleteManyAgentRegisteredTicket({});

            // Now as we are not deleting or resetting registered ticket and we are removing hold tivkets 
            // Remove IDs in holdTicketIds from both soldTicketIds and holdTicketIds
            Sys.App.Services.scheduleServices.updateManyAgentRegisteredTicketData(
                {},
                [
                    {
                        $set: {
                          allRange: {
                            $map: {
                              input: "$allRange",
                              as: "range",
                              in: {
                                // Keep all the fields of the range object as they are
                                $mergeObjects: [
                                  "$$range", // Keep all fields of the range object unchanged
                                  {
                                    // Apply $setDifference to soldTicketIDs
                                    soldTicketIDs: {
                                      $setDifference: ["$$range.soldTicketIDs", "$$range.holdTicketIds"]
                                    },
                                    // Clear holdTicketIds
                                    holdTicketIds: []
                                  }
                                ]
                              }
                            }
                          }
                        }
                      }
                ]
            );
            Sys.App.Services.scheduleServices.deleteManyAgentSellPhysicalTicket({});

            return { status: "success" };
        } catch (error) {
            console.log("Error deleteDailySchedules", error);
        }
    },

    csvImport: async function (req, res) {
        try {
            // TEKNOBINGO 2, TEKNOBINGO 3 & TEKNOBINGO 4 Hall name and Ids will change in future
            let halls =
                [
                    { name: "Furuset Bingo", number: "1", uniqueHallName: "TEKNOBINGO 1", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [450001, 453000] }, { type: "Small Yellow", range: [453001, 456000] }, { type: "Large White", range: [456001, 459000] }, { type: "Large Yellow", range: [459001, 462000] }, { type: "traffic-light", range: [462001, 465000] }] },
                    { name: "Open", number: "123", uniqueHallName: "TEKNOBINGO 2", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [468001, 471000] }, { type: "Small Yellow", range: [471000, 474000] }, { type: "Large White", range: [474001, 477000] }, { type: "Large Yellow", range: [477001, 480000] }, { type: "traffic-light", range: [480001, 483000] }] },
                    { name: "Open", number: "123", uniqueHallName: "TEKNOBINGO 3", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [486001, 489000] }, { type: "Small Yellow", range: [489001, 492000] }, { type: "Large White", range: [492001, 495000] }, { type: "Large Yellow", range: [495001, 498000] }, { type: "traffic-light", range: [498001, 501000] }] },
                    { name: "Open", number: "123", uniqueHallName: "TEKNOBINGO 4", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [504001, 507000] }, { type: "Small Yellow", range: [507001, 510000] }, { type: "Large White", range: [510001, 513000] }, { type: "Large Yellow", range: [513001, 516000] }, { type: "traffic-light", range: [516001, 519000] }] },
                    //{name: "Spillorama Stokke", number: "8", uniqueHallName: "TEKNOBINGO 4", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [504001,507000] }, { type: "Small Yellow", range: [507001,510000] }, { type: "Large White", range: [510001,513000] }, { type: "Large Yellow", range: [513001,516000] }, { type: "traffic-light", range: [516001,519000] }] },
                    { name: "Spillorama Gulset", number: "790", uniqueHallName: "TEKNOBINGO 5", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [522001, 525000] }, { type: "Small Yellow", range: [525001, 528000] }, { type: "Large White", range: [528001, 531000] }, { type: "Large Yellow", range: [531001, 534000] }, { type: "traffic-light", range: [534001, 537000] }] },
                    { name: "Spillorama Hokksund", number: "120", uniqueHallName: "TEKNOBINGO 6", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [540001, 543000] }, { type: "Small Yellow", range: [543001, 546000] }, { type: "Large White", range: [546001, 549000] }, { type: "Large Yellow", range: [549001, 552000] }, { type: "traffic-light", range: [552001, 555000] }] },
                    { name: "Teknobingo Skien", number: "580", uniqueHallName: "TEKNOBINGO 7", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [558001, 561000] }, { type: "Small Yellow", range: [561001, 564000] }, { type: "Large White", range: [564001, 567000] }, { type: "Large Yellow", range: [567001, 570000] }, { type: "traffic-light", range: [570001, 573000] }] },
                    { name: "Teknobingo Stathelle", number: "260", uniqueHallName: "TEKNOBINGO 8", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [576001, 579000] }, { type: "Small Yellow", range: [579001, 582000] }, { type: "Large White", range: [582001, 585000] }, { type: "Large Yellow", range: [585001, 588000] }, { type: "traffic-light", range: [588001, 591000] }] },
                    { name: "Teknobingo Kragerø", number: "560", uniqueHallName: "TEKNOBINGO 9", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [600001, 603000] }, { type: "Small Yellow", range: [603001, 606000] }, { type: "Large White", range: [606001, 609000] }, { type: "Large Yellow", range: [609001, 612000] }, { type: "traffic-light", range: [612001, 615000] }] },
                    { name: "Teknobingo Brumunddal", number: "540", uniqueHallName: "TEKNOBINGO 10", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [618001, 621000] }, { type: "Small Yellow", range: [621001, 624000] }, { type: "Large White", range: [624001, 627000] }, { type: "Large Yellow", range: [627001, 630000] }, { type: "traffic-light", range: [630001, 633000] }] },
                    { name: "Teknobingo Lillehammer", number: "220", uniqueHallName: "TEKNOBINGO 11", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [636001, 639000] }, { type: "Small Yellow", range: [639001, 642000] }, { type: "Large White", range: [642001, 645000] }, { type: "Large Yellow", range: [645001, 648000] }, { type: "traffic-light", range: [648001, 651000] }] },
                    { name: "Spillorama Hamar", number: "100", uniqueHallName: "TEKNOBINGO 12", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [654001, 657000] }, { type: "Small Yellow", range: [657001, 660000] }, { type: "Large White", range: [660001, 663000] }, { type: "Large Yellow", range: [663001, 666000] }, { type: "traffic-light", range: [666001, 669000] }] },
                    { name: "Teknobingo Vinstra", number: "240", uniqueHallName: "TEKNOBINGO 13", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [672001, 675000] }, { type: "Small Yellow", range: [675001, 678000] }, { type: "Large White", range: [678001, 681000] }, { type: "Large Yellow", range: [681001, 684000] }, { type: "traffic-light", range: [684001, 687000] }] },
                    { name: "Teknobingo Heimdal", number: "600", uniqueHallName: "TEKNOBINGO 14", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [690001, 693000] }, { type: "Small Yellow", range: [693001, 696000] }, { type: "Large White", range: [696001, 699000] }, { type: "Large Yellow", range: [699001, 702000] }, { type: "traffic-light", range: [702001, 705000] }] },
                    { name: "Teknobingo Sunndalsøra", number: "300", uniqueHallName: "TEKNOBINGO 15", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [708001, 711000] }, { type: "Small Yellow", range: [711001, 714000] }, { type: "Large White", range: [714001, 717000] }, { type: "Large Yellow", range: [717001, 720000] }, { type: "traffic-light", range: [720001, 723000] }] },
                    { name: "Teknobingo Larvik", number: "140", uniqueHallName: "TEKNOBINGO 16", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [726001, 729000] }, { type: "Small Yellow", range: [729001, 732000] }, { type: "Large White", range: [732001, 735000] }, { type: "Large Yellow", range: [735001, 738000] }, { type: "traffic-light", range: [738001, 741000] }] },
                    { name: "Teknobingo Orkanger", number: "280", uniqueHallName: "TEKNOBINGO 17", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [750001, 753000] }, { type: "Small Yellow", range: [753001, 756000] }, { type: "Large White", range: [756001, 759000] }, { type: "Large Yellow", range: [759001, 762000] }, { type: "traffic-light", range: [762001, 765000] }] },
                    { name: "Teknobingo Årnes", number: "520", uniqueHallName: "TEKNOBINGO 18", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [768001, 771000] }, { type: "Small Yellow", range: [771001, 774000] }, { type: "Large White", range: [774001, 777000] }, { type: "Large Yellow", range: [777001, 780000] }, { type: "traffic-light", range: [780001, 783000] }] },
                    { name: "Spillorama Bodø", number: "620", uniqueHallName: "TEKNOBINGO 19", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [786001, 789000] }, { type: "Small Yellow", range: [789001, 792000] }, { type: "Large White", range: [792001, 795000] }, { type: "Large Yellow", range: [795001, 798000] }, { type: "traffic-light", range: [798001, 801000] }] },
                    { name: "Teknobingo Sortland", number: "460", uniqueHallName: "TEKNOBINGO 20", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [804001, 807000] }, { type: "Small Yellow", range: [807001, 810000] }, { type: "Large White", range: [810001, 813000] }, { type: "Large Yellow", range: [813001, 816000] }, { type: "traffic-light", range: [816001, 819000] }] },
                    { name: "Teknobingo Finnsnes", number: "440", uniqueHallName: "TEKNOBINGO 21", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [822001, 825000] }, { type: "Small Yellow", range: [825001, 828000] }, { type: "Large White", range: [828001, 831000] }, { type: "Large Yellow", range: [831001, 834000] }, { type: "traffic-light", range: [834001, 837000] }] },
                    { name: "Teknobingo Harstad", number: "480", uniqueHallName: "TEKNOBINGO 22", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [840001, 843000] }, { type: "Small Yellow", range: [843001, 846000] }, { type: "Large White", range: [846001, 849000] }, { type: "Large Yellow", range: [849001, 852000] }, { type: "traffic-light", range: [852001, 855000] }] },
                    { name: "Teknobingo Fauske", number: "500", uniqueHallName: "TEKNOBINGO 23", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [858001, 861000] }, { type: "Small Yellow", range: [861001, 864000] }, { type: "Large White", range: [864001, 867000] }, { type: "Large Yellow", range: [867001, 870000] }, { type: "traffic-light", range: [870001, 873000] }] },
                    { name: "Teknobingo Gran", number: "320", uniqueHallName: "TEKNOBINGO 24", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [876001, 879000] }, { type: "Small Yellow", range: [879001, 882000] }, { type: "Large White", range: [882001, 885000] }, { type: "Large Yellow", range: [885001, 888000] }, { type: "traffic-light", range: [888001, 891000] }] },
                    { name: "Spillorama Notodden", number: "160", uniqueHallName: "TEKNOBINGO 25", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [900001, 903000] }, { type: "Small Yellow", range: [903001, 906000] }, { type: "Large White", range: [906001, 909000] }, { type: "Large Yellow", range: [909001, 912000] }, { type: "traffic-light", range: [912001, 915000] }] },
                ];

            let trafficlightTemp = ['Small Red', 'Small Yellow', 'Small Green']; //["red", "yellow", "green"];
            let trafficlight = ['Small Red', 'Small Yellow', 'Small Green']; //["red", "yellow", "green"]

            const csvPath = path.join(__dirname, '../../../hallsTickets.csv');
            console.log("csv path", csvPath)

            let ticketsToInsert = [];
            const BATCH_SIZE = 1000;
            let ticketIds = []
            // fs.createReadStream(csvPath) 
            //     .pipe(fastcsv.parse({ headers: false, delimiter: '\t' }))
            //     .on("data", async function(data) {
            //         const ticketNumber = parseInt(data[0]);
            //         console.log("ticketNumber---", ticketNumber)
            //         for (const hall of halls) {
            //             const ticketType = findTicketType(hall, ticketNumber);
            //             console.log("ticketType11---", ticketType)
            //             if (ticketType) {
            //                 let ticketColor = "";
            //                 if(ticketType.type == "traffic-light"){
            //                     ticketColor = trafficlight[0];
            //                     trafficlight.shift();
            //                     if(trafficlight.length == 0){
            //                         trafficlight = [...trafficlightTemp];
            //                     }
            //                 }else{
            //                     ticketColor = ticketType.type;
            //                 }

            //                 const newTicket = {
            //                     ticketId: data[0],
            //                     tickets: [

            //                         [{ Number: data[1], checked: false }, { Number: data[2], checked: false }, { Number: data[3], checked: false }, { Number: data[4], checked: false }, { Number: data[5], checked: false }],

            //                         [{ Number: data[6], checked: false }, { Number: data[7], checked: false }, { Number: data[8], checked: false }, { Number: data[9], checked: false }, { Number: data[10], checked: false }],

            //                         [{ Number: data[11], checked: false }, { Number: data[12], checked: false }, { Number: data[13], checked: false }, { Number: data[14], checked: false }, { Number: data[15], checked: false }] ,  

            //                         [{ Number: data[16], checked: false }, { Number: data[17], checked: false }, { Number: data[18], checked: false }, { Number: data[19], checked: false }, { Number: data[20], checked: false }],

            //                         [{ Number: data[21], checked: false }, { Number: data[22], checked: false }, { Number: data[23], checked: false }, { Number: data[24], checked: false }, { Number: data[25], checked: false }],

            //                     ],
            //                     isPurchased: false,
            //                     playerIdOfPurchaser: "",
            //                     ticketType: (ticketType.type == "traffic-light") ? "traffic-light" : "standard",
            //                     ticketColor: ticketColor,
            //                     hallName: hall.name,
            //                     gameId: "",
            //                     hallNumber: hall.number,
            //                     uniqueHallName: hall.uniqueHallName,
            //                     supplier: hall.supplier,
            //                     contractor: hall.contractor,
            //                 };

            //                 ticketsToInsert.push(newTicket);
            //                 ticketIds.push(data[0])
            //                 // If we reach the batch size, insert all collected documents
            //                 if (ticketsToInsert.length === BATCH_SIZE) {console.log("inside----", ticketIds)
            //                     await Sys.App.Services.GameService.insertManyStaticPhysicalTicketData(ticketsToInsert, { ordered: true });
            //                     ticketsToInsert.length = 0; // Clear the array
            //                     ticketIds.length = 0;
            //                 }
            //             }
            //         }
            //     })
            //     .on('end', async () => {console.log("end--")
            //         // Insert any remaining documents
            //         if (ticketsToInsert.length > 0) {
            //             await Sys.App.Services.GameService.insertManyStaticPhysicalTicketData(ticketsToInsert, { ordered: true });
            //         }
            //         console.log('CSV file successfully processed');
            //     });


            return new Promise((resolve, reject) => {
                const csvStream = fs.createReadStream(csvPath)
                    .pipe(fastcsv.parse({ headers: false, delimiter: '\t' }))
                    .on('data', async (data) => {
                        csvStream.pause();  // Pause data stream to wait for async operations

                        const ticketNumber = parseInt(data[0]);
                        //console.log("ticketNumber---", ticketNumber)
                        for (const hall of halls) {
                            const ticketType = findTicketType(hall, ticketNumber);

                            if (ticketType) {
                                let ticketColor = "";
                                if (ticketType.type == "traffic-light") {
                                    ticketColor = trafficlight[0];
                                    trafficlight.shift();
                                    if (trafficlight.length == 0) {
                                        trafficlight = [...trafficlightTemp];
                                    }
                                } else {
                                    ticketColor = ticketType.type;
                                }

                                const newTicket = {
                                    ticketId: data[0],
                                    tickets: [

                                        [{ Number: data[1], checked: false }, { Number: data[2], checked: false }, { Number: data[3], checked: false }, { Number: data[4], checked: false }, { Number: data[5], checked: false }],

                                        [{ Number: data[6], checked: false }, { Number: data[7], checked: false }, { Number: data[8], checked: false }, { Number: data[9], checked: false }, { Number: data[10], checked: false }],

                                        [{ Number: data[11], checked: false }, { Number: data[12], checked: false }, { Number: data[13], checked: false }, { Number: data[14], checked: false }, { Number: data[15], checked: false }],

                                        [{ Number: data[16], checked: false }, { Number: data[17], checked: false }, { Number: data[18], checked: false }, { Number: data[19], checked: false }, { Number: data[20], checked: false }],

                                        [{ Number: data[21], checked: false }, { Number: data[22], checked: false }, { Number: data[23], checked: false }, { Number: data[24], checked: false }, { Number: data[25], checked: false }],

                                    ],
                                    isPurchased: false,
                                    playerIdOfPurchaser: "",
                                    ticketType: (ticketType.type == "traffic-light") ? "traffic-light" : "standard",
                                    ticketColor: ticketColor,
                                    hallName: hall.name,
                                    gameId: "",
                                    hallNumber: hall.number,
                                    uniqueHallName: hall.uniqueHallName,
                                    supplier: hall.supplier,
                                    contractor: hall.contractor,
                                };

                                ticketsToInsert.push(newTicket);
                                ticketIds.push(data[0])

                            }
                        }

                        if (ticketsToInsert.length >= BATCH_SIZE) {
                            try {
                                console.log("insert tickets---", ticketIds.length)
                                await Sys.App.Services.GameService.insertManyStaticPhysicalTicketData(ticketsToInsert, { ordered: true });
                                ticketsToInsert = [];
                                ticketIds.length = 0;
                            } catch (err) {
                                return reject(err);
                            }
                        }

                        csvStream.resume();
                    })
                    .on('end', async () => {
                        if (ticketsToInsert.length > 0) {
                            try {
                                console.log("insert tickets---", ticketIds.length)
                                await Sys.App.Services.GameService.insertManyStaticPhysicalTicketData(ticketsToInsert, { ordered: true });
                            } catch (err) {
                                return reject(err);
                            }
                        }
                        console.log('CSV file successfully processed');
                        res.send('Data inserted successfully!');
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error('Error reading CSV file:', err);
                        reject(err);
                    });
            });


        } catch (e) {
            console.log("error in importing data", e)
        }
    },

    // processCsvData: async function(){
    //     try{

    //     }catch(e){

    //     }
    // }

    cancelIndividualGameTickets: async function (socket, data) {
        try {
            console.log("cancelIndividualGameTickets called", data)
            const { playerId, gameId, ticketId1, ticketId2, ticketId3 } = data;
            let language = "nor";
            if (data.language) {
                language = data.language;
            }

            let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: playerId }, { username: 1, selectedLanguage: 1, hall: 1 });
            if (player) {
                let gameData = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, { isNotificationSent: 1, status: 1, players: 1, gameNumber: 1, gameName: 1, disableTicketPurchase: 1, startDate: 1, otherData: 1, subGames: 1, halls: 1, parentGameId: 1 });
                if (gameData === null) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "game_not_found", language: player.selectedLanguage }), // 'Game data is not found',
                    }
                }
                console.log("gameData in cancel Game tickets", gameData)
                if (gameData.status != "cancel" && gameData.status != "running" && gameData.status != "finish" && gameData.otherData.disableCancelTicket == false) { // gameData.disableTicketPurchase == false
                    const isPurchased = gameData.players.findIndex((e) => e.id == playerId);
                    if (isPurchased == -1) {
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({ key: "error_cancelling_tickets", language: player.selectedLanguage }), // 'Error while cancelling Tickets!',

                        }
                    }

                    let ticketIds = [];
                    if (ticketId1) ticketIds.push(ticketId1);
                    if (ticketId2) ticketIds.push(ticketId2);
                    if (ticketId3) ticketIds.push(ticketId3);
                    console.log("ticketIds---", ticketIds)
                    if (ticketIds.length == 0 || (gameData.gameName == "Elvis" && ticketIds.length != 2) || (gameData.gameName == "Traffic Light" && ticketIds.length != 3)) {
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({ key: "error_cancelling_tickets", language: player.selectedLanguage }), // 'Error while cancelling Tickets!',
                        }
                    }

                    let tickets = await Sys.Game.Game1.Services.GameServices.getTicketListData({ playerIdOfPurchaser: player._id, gameId: gameId, _id: { $in: ticketIds } }, { ticketId: 1, ticketParentId: 1, ticketColorName: 1, ticketColorType: 1, tickets: 1, ticketPrice: 1, userTicketType: 1, hallId: 1 });
                    if (!tickets || tickets.length == 0 || (gameData.gameName == "Elvis" && tickets.length != 2) || (gameData.gameName == "Traffic Light" && tickets.length != 3)) {
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({ key: "error_cancelling_tickets", language: player.selectedLanguage }), // 'Error while cancelling Tickets!',
                        }
                    }
                    const containsLargeColorType = tickets.some(ticket => ticket.ticketColorType === 'large');
                    if(containsLargeColorType == true &&  tickets.length != 3 ){
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({ key: "error_cancelling_tickets", language: player.selectedLanguage }), // 'Error while cancelling Tickets!',
                        }
                    }
                    console.log("tickets to cancel----", tickets);
                    let tiketPrice = 0;
                    let ticketQnty = tickets.length;
                    let purchasedSlug = "realMoney";
                    let subgame = gameData.subGames[0].options;
                    let incObj = {};
                    let filterArr = [];
                    let tempAlpha = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z']

                    if (gameData.gameName == "Traffic Light") {
                        let trafficColors = ["Small Red", "Small Yellow", "Small Green"];

                        for (let t = 0; t < tickets.length; t++) {
                            const colorIndex = trafficColors.indexOf(tickets[t].ticketColorName);
                            if (colorIndex !== -1) {
                                trafficColors.splice(colorIndex, 1);
                            } else {
                                return {
                                    status: 'fail',
                                    result: null,
                                    message: await translate({ key: "error_cancelling_tickets", language: player.selectedLanguage }), // 'Error while cancelling Tickets!',
                                }
                            }
                        }

                        for (let s = 0; s < subgame.length; s++) {
                            incObj["players.$.purchaseTicketTypes.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = -1;
                            incObj["subGames.$[].options.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = -1;
                            filterArr.push({ [tempAlpha[s] + ".ticketName"]: subgame[s].ticketName })
                        }
                        tiketPrice = subgame[0].ticketPrice;
                        ticketQnty = 3;
                    } else if (gameData.gameName == "Elvis") {
                        for (let s = 0; s < subgame.length; s++) {
                            if (subgame[s].ticketName == tickets[0].ticketColorName) {
                                incObj["players.$.purchaseTicketTypes.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = -1;
                                incObj["subGames.$[].options.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = -1;
                                filterArr.push({ [tempAlpha[s] + ".ticketName"]: tickets[0].ticketColorName });
                                break;
                            }
                        }
                        tiketPrice = subgame[0].ticketPrice;
                        ticketQnty = 2;
                    } else {
                        for (let s = 0; s < subgame.length; s++) {
                            if (subgame[s].ticketName == tickets[0].ticketColorName) {
                                incObj["players.$.purchaseTicketTypes.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = -1;
                                incObj["subGames.$[].options.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = -1;
                                filterArr.push({ [tempAlpha[s] + ".ticketName"]: tickets[0].ticketColorName });
                                break;
                            }
                        }
                        tiketPrice = tickets[0].ticketPrice;
                    }
                    console.log("tiketPrice---", tiketPrice)
                    // Need to work on this
                    // Object.entries(ticketFinalData).forEach(([key, value]) => {
                    //     incObj[`groupHalls.$[group].halls.$[hall].ticketData.${key}`] = value
                    //     incObj[`groupHalls.$[group].halls.$[hall].userTicketType.${userTicketType}.${key}`] = value
                    // });

                    // get player hall id from purchased ticket
                    const ticketHallId = tickets[0].hallId.toString(); //player.hall.id.toString()
                    filterArr.push({ "group.halls.id": ticketHallId }, { "hall.id": ticketHallId })

                    let updateGame = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId, 'players.id': playerId },
                        {
                            $inc: {
                                ticketSold: -ticketQnty,
                                earnedFromTickets: -tiketPrice,
                                finalGameProfitAmount: -tiketPrice,
                                'players.$.ticketPrice': -tiketPrice,
                                'players.$.totalPurchasedTickets': -ticketQnty,
                            }
                        },
                        { new: true }
                    );

                    if (updateGame instanceof Error || updateGame == null || updateGame == undefined) {
                        console.log("error in cancelling ticket");
                        return { status: 'fail', result: null, message: await translate({ key: "went_wrong_cancelling_tickets", language: player.selectedLanguage }), statusCode: 500 }
                    } else {
                        console.log("cancel ticket purchased, revert user amount", data.playerId);

                        if (purchasedSlug == "points") {
                            await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: tiketPrice } });
                            let newExtraTransaction = {
                                playerId: player._id,
                                gameId: gameData._id,
                                transactionSlug: "extraTransaction",
                                typeOfTransaction: "Cancel Ticket",
                                action: "credit", // debit / credit
                                purchasedSlug: "points", // point /realMoney
                                totalAmount: tiketPrice,
                                game1Slug: "cancelTicket"
                            }
                            await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                        } else if (purchasedSlug == "realMoney") {
                            await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: tiketPrice, monthlyWalletAmountLimit: tiketPrice } });
                            let newExtraTransaction = {
                                playerId: player._id,
                                gameId: gameData._id,
                                transactionSlug: "extraTransaction",
                                typeOfTransaction: "Cancel Ticket",
                                action: "credit", // debit / credit
                                purchasedSlug: "realMoney", // point /realMoney
                                totalAmount: tiketPrice,
                                game1Slug: "cancelTicket"
                            }
                            await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                        }

                        await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId, 'players.id': playerId }, {
                            $inc: incObj
                        }, { arrayFilters: filterArr, new: true });

                        let bulupdateTicketData = [];
                        const ticketDetails = {};

                        if (tickets.length > 0) {
                            for (p = 0; p < tickets.length; p++) {
                                //console.log(" tickets[p]",  tickets[p].tickets);
                                if (ticketDetails[tickets[p].ticketColorName.split(' ').join('').toLowerCase()]) {
                                    ticketDetails[tickets[p].ticketColorName.split(' ').join('').toLowerCase()].count += 1;
                                } else {
                                    ticketDetails[tickets[p].ticketColorName.split(' ').join('').toLowerCase()] = {
                                        type: tickets[p].ticketColorType,
                                        count: 1,

                                    }
                                }
                                let ticketBallData = {};
                                for (let t = 0; t < tickets[p].tickets.length; t++) {
                                    for (let n = 0; n < tickets[p].tickets[t].length; n++) {
                                        //console.log("tickets[p] inside", tickets[p].tickets[t][n].Number, tickets[p]._id)
                                        if (+tickets[p].tickets[t][n].Number != 0) {
                                            ticketBallData["ticketIdForBalls." + tickets[p].tickets[t][n].Number] = { ticketId: tickets[p]._id }
                                        }

                                    }

                                }
                                //console.log("ticketBallData cancel", ticketBallData)
                                bulupdateTicketData.push({
                                    updateOne: {
                                        "filter": { _id: gameData._id },
                                        "update": { $pull: ticketBallData }
                                    }
                                })
                            }
                        }
                        await Sys.App.Services.GameService.bulkWriteGameData(bulupdateTicketData);

                        let getCountTicket = tickets.reduce((obj, userTicketType) => {

                            if (obj[userTicketType.userTicketType][userTicketType.ticketColorName.split(' ').join('').toLowerCase()]) {
                                obj[userTicketType.userTicketType][userTicketType.ticketColorName.split(' ').join('').toLowerCase()].count += 1
                            } else {
                                obj[userTicketType.userTicketType][userTicketType.ticketColorName.split(' ').join('').toLowerCase()] = {
                                    type: userTicketType.ticketColorType,
                                    count: 1
                                }
                            }
                            return obj;
                        }, { Physical: {}, Terminal: {}, Web: {} });

                        console.log("getCountTicket", getCountTicket);
                        const updateQuery = {
                            $inc: {}
                        }
                        Object.entries(getCountTicket).forEach(([key, value]) => {
                            Object.entries(value).forEach(([key1, value1]) => {
                                console.log("value1", value1);
                                if (value1.type == "large") {
                                    updateQuery["$inc"][`groupHalls.$[group].halls.$[hall].userTicketType.${key}.${key1}`] = - (value1.count / 3);
                                } else {
                                    updateQuery["$inc"][`groupHalls.$[group].halls.$[hall].userTicketType.${key}.${key1}`] = -value1.count;
                                }

                            })
                        });

                        gameData?.halls.forEach(hall => {
                            Sys.Io.of('admin').to(hall).emit('refresh', { scheduleId: gameData.parentGameId });
                        })

                        console.log("updateQuery New ", updateQuery);

                        await Sys.Game.Game1.Services.GameServices.updateGameNested(
                            { _id: gameData._id },
                            updateQuery,
                            { arrayFilters: [{ "group.halls.id": ticketHallId }, { "hall.id": ticketHallId }] }
                        );

                        Sys.App.Services.GameService.deleteTicketManydata({ playerIdOfPurchaser: playerId, gameId: gameId, _id: { $in: ticketIds } });

                        let TimeMessage = {
                            en: await translate({ key: "game1_ticket_cancel_notification", language: 'en', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName }),
                            nor: await translate({ key: "game1_ticket_cancel_notification", language: 'nor', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName })
                        };

                        //gameData.gameNumber + " [ " + gameData.gameName + " ] Ticket Cancellation Successfully..!! ";

                        let notificationDate = gameData.startDate;

                        let ticketMessage = {
                            en: await translate({ key: "game1_ticket_cancel_message", language: 'en', isDynamic: true, number: ticketQnty, number1: gameData.gameName }),
                            nor: await translate({ key: "game1_ticket_cancel_message", language: 'nor', isDynamic: true, number: ticketQnty, number1: gameData.gameName })
                        };

                        let notification = {
                            notificationType: 'cancelTickets',
                            message: TimeMessage,
                            ticketMessage: ticketMessage, // `You cancelled these ${ticketQty} ticket for this ${gameData.gameName}..!!`,
                            price: tiketPrice,
                            date: notificationDate
                        }

                        let dataNotification = {
                            playerId: player._id,
                            gameId: gameData._id,
                            notification: notification
                        }

                        await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                        if (gameData.gameName == "Spillerness Spill" || gameData.gameName == "Spillerness Spill 2" || gameData.gameName == "Spillerness Spill 3" || gameData.gameName == "Innsatsen") {
                            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameData._id).emit('adminRefreshRoom', {});
                            let patternListing = await Sys.Game.Game1.Controllers.GameProcess.patternListing(gameData._id);
                            let patternList = patternListing.patternList;
                            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameData._id).emit('PatternChange', { patternList: patternList });
                        }

                        return {
                            status: 'success',
                            result: '',
                            message: await translate({ key: "ticket_cancellation_success", language: player.selectedLanguage }), // 'Ticket cancellation successfully...!!!'
                        }

                    }
                }
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "can_not_cancel_ticket", language: player.selectedLanguage }), //'Can not cancel Ticket!',
                    statusCode: 400
                }

            } else {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language: language }), // 'No Player Found!',
                    statusCode: 400
                }
            }

        } catch (e) {
            console.log("Error in cancelGameTickets : ", e);
            return new Error(e);
        }
    },

    checkForUpcomingGameForSubscribeRoom: async function(socket, data) {
        const { playerId, language, callCount } = data;
        const MAX_CALLS = 2; // Set a reasonable limit for recursive calls
        if (callCount > MAX_CALLS) {
            return {
                status: 'fail',
                result: null,
                messageType: await translate({ key: "game_not_found", language: language }),
                message: await translate({ key: "game_not_found", language: language }),
            };
        }
        try {
            let newGame = await module.exports.Game1Room(socket, { language: language, playerId: playerId });
            if (newGame && newGame.status == "success") {
                let nextGameId = null;
                if (newGame.result.runningGame && Object.keys(newGame.result.runningGame).length > 0) {
                    // runningGame is present and not empty
                    nextGameId = newGame.result.runningGame?.gameId ?? null;
                } else if (newGame.result.upcomingGame && Object.keys(newGame.result.upcomingGame).length > 0) {
                    // upcomingGame is present and not empty
                    nextGameId = newGame.result.upcomingGame?.gameId ?? null;
                }
                console.log("nextGameId in checkForUpcomingGameForSubscribeRoom---", nextGameId);
                if (nextGameId) {
                    // Handle the case where a valid gameId was found
                    let subscribeRoomRes = await module.exports.subscribeRoom(socket,  { language: language, playerId: playerId, gameId: nextGameId, callCount: (callCount + 1), isInternal: true });
                    return subscribeRoomRes;
                } else {
                    return {
                        status: 'fail',
                        result: null,
                        messageType: await translate({ key: "game_not_found", language: language }),
                        message: await translate({ key: "game_not_found", language: language }),
                    };
                }
            } else {
                return {
                    status: 'fail',
                    result: null,
                    messageType: await translate({ key: "game_not_found", language: language }),
                    message: await translate({ key: "game_not_found", language: language }),
                };
            }
        } catch (error) {
            return {
                status: 'fail',
                result: null,
                message: await translate({ key: "something_went_wrong", language: language }), //'Something Went Wrong',
                statusCode: 400
            }
        }
    },

    /**
     * Stop a running game for a player
     * @param {object} socket - The socket object
     * @param {object} data - The data object containing the playerId and language
     * @return {object} - The response object containing a status and a message
     */
    stopGameByPlayers: async function(socket, data){
        try {
            const { playerId, language = "nor" } = data;
            console.log("playerid and language", playerId, language)
            // Get player data with the provided playerId
            let player = null;
            if(playerId){
                player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: playerId, selectedLanguage: 1 }, { hall: 1 });
            }
            // If player found, update language with their selected language
            //const playerLanguageGame = player ? player.selectedLanguage : language;
            const playerLanguageAdmin = (player ? player.selectedLanguage : language) === "en" ? "english" : "norwegian";
            
            // Get player IP from socket
            let playerIp = socket.handshake.headers['x-forwarded-for'] ? socket.handshake.headers['x-forwarded-for'].split(',')[0] : socket.conn.remoteAddress;
            playerIp = playerIp.startsWith('::ffff:') ? playerIp.slice(7) : playerIp;
            console.log("playerIp---", playerIp);
            // Get hall by IP
            const hall = await Sys.App.Services.HallServices.getSingleHallData({ ip: playerIp }, { name: 1 });
    
            // If no hall or hall id doesn't match player's hall, return error
            if (!hall || (player && hall.id !== player.hall?.id)) {
                return {
                    status: 'fail',
                    message: await Sys.Helper.bingo.getSingleTraslateData(['you_are_not_allowed_to_perform_this_operation'], playerLanguageAdmin),
                };
            }

            const runningGame = await Sys.Game.Game1.Services.GameServices.getSingleByData(
                {
                    gameType: 'game_1',
                    halls: { $in: [hall.id] },
                    stopGame: false,
                    'otherData.isClosed': false,
                    startDate: {
                        $gte: moment().startOf('day').toDate(),
                        $lt: moment().endOf('day').toDate()
                    },
                    $or: [
                        { "status": "finish", "otherData.gameSecondaryStatus": "running" },
                        { "status": "running" },
                    ],
                },
                { gameNumber: 1, gameName: 1, otherData: 1, status: 1 }
            );

            if (!runningGame) {
                return {
                    status: "fail",
                    message: await Sys.Helper.bingo.getSingleTraslateData(['there_is_no_running_game_to_stop'], playerLanguageAdmin) || 'There is no ongoing game to stop',
                };
            }

            if (runningGame.otherData?.isPaused) {
                return {
                    status: "fail",
                    message: await Sys.Helper.bingo.getSingleTraslateData(['game_already_paused'], playerLanguageAdmin) || 'Game is already paused',
                };
            }

            if (runningGame.status === "finish") {
                if (
                    ["Wheel of Fortune", "Treasure Chest", "Mystery", "Color Draft"].includes(runningGame.gameName) &&
                    (runningGame.otherData?.isMinigameActivated || runningGame.otherData?.isMinigameExecuted)
                ) {
                    // Handle minigame-specific logic if needed
                } else {
                    return {
                        status: "fail",
                        message: await Sys.Helper.bingo.getSingleTraslateData(['game_already_finished'], playerLanguageAdmin) || 'Game is already finished',
                    };
                }
            }

            if (runningGame.status === "active" && !Timeout.exists(runningGame._id.toString())) {
                return res.send({
                    status: "fail",
                    message: await Sys.Helper.bingo.getSingleTraslateData(['pause_running_game_only'], playerLanguageAdmin) || 'You can only pause running game, Current game has not started yet'
                });
            }

            // Stop the game
            const stopGameResponse = await Sys.Game.Game1.Controllers.GameProcess.stopGame(runningGame.id, playerLanguageAdmin);
            if (stopGameResponse?.status === "success") {
                return {
                    status: "success",
                    message: await Sys.Helper.bingo.getSingleTraslateData(['game_paused_successfully'], playerLanguageAdmin) || 'Game is paused',
                };
            } else {
                return {
                    status: "fail",
                    message: stopGameResponse.message,
                };
            }
    
        } catch (e) {
            console.log("Error in stop game by players", e);
        }
    },

    tvscreenUrlForPlayers: async function(socket, data){
        try{
            console.log("tvscreenUrlForPlayers---", data);
            let { language = "en", deviceType } = data;
            const playerLanguageAdmin = language === "en" ? "english" : "norwegian";
            if(deviceType == "webgl"){
                deviceType = "web"
            }
            // Get player IP from socket
            let playerIp = socket.handshake.headers['x-forwarded-for'] ? socket.handshake.headers['x-forwarded-for'].split(',')[0] : socket.conn.remoteAddress;
            playerIp = playerIp.startsWith('::ffff:') ? playerIp.slice(7) : playerIp;
            console.log("playerIp---", playerIp);
            // Get hall by IP
            const hall = await Sys.App.Services.HallServices.getSingleHallData({ ip: playerIp }, { name: 1, groupHall: 1 });
            
            // If no hall or hall id doesn't match player's hall, return error
            if (!hall || !hall?.groupHall) {
                return {
                    status: 'fail',
                    result: "",
                    message: await Sys.Helper.bingo.getSingleTraslateData(['you_are_not_allowed_to_perform_this_operation'], playerLanguageAdmin),
                };
            }

            let goh = await Sys.App.Services.GroupHallServices.getGroupHall({ _id: hall?.groupHall?.id }, { tvId: 1 });
            if (!goh) {
                return {
                    status: 'fail',
                    result: "",
                    message: await Sys.Helper.bingo.getSingleTraslateData(['you_are_not_allowed_to_perform_this_operation'], playerLanguageAdmin),
                };
            }

            return {
                status: 'success',
                result:  `${Sys.Config.App[Sys.Config.Database.connectionType].url}tv/${goh.tvId}?deviceType=${deviceType}`,
                message: "TV Screen Url Found."
            }; 

        }catch(e){
            console.log("Error in tv screen by players", e);
        }
    },

    /**
     * @function getJackpotData
     * @description Get jackpot data to be shown on the game screen.
     * @param {string} gameName - The name of the game.
     * @param {number} withdrawCount - The number of balls withdrawn.
     * @param {number} jackpotDraw - The number of balls in the jackpot.
     * @param {object} jackpotPrize - The prize for the jackpot.
     * @param {object} subGames - The subgames object.
     * @param {string} parentGameId - The id of the parent game.
     * @returns {object} - The jackpot data.
     */
    getJackpotData: async function(gameName, withdrawCount, jackpotDraw, jackpotPrize, subGames, parentGameId) {
        let jackPotData = { isDisplay: false };
        try{
            const isJackpotGame = gameName === "Jackpot";
            const isOddsenGame = gameName.startsWith("Oddsen");
            const isInnsatsenGame = gameName === "Innsatsen";

            const jackpotFullHousePrize = await getJackpotHighestPrice({allWinningOptions: subGames[0].options, pattern:'Full House', defaultValue: +subGames[0].options[0].winning['Full House']});

            /**
             * @function setJackpotData
             * @description Set jackpot data.
             * @param {number} draw - The number of balls in the jackpot.
             * @param {number} winningAmount - The prize for the jackpot.
             * @param {boolean} isDisplay - Whether to display the jackpot data.
             * @returns {object} - The jackpot data.
             */
            const setJackpotData = (draw, winningAmount, isDisplay, tvScreenWinningAmount, isDisplayOnTVScreen) => ({
                draw, winningAmount, isDisplay, tvScreenWinningAmount, isDisplayOnTVScreen
            });
        
            // If it is a Jackpot game and the number of withdrawn balls is less than the jackpot draw,
            if (isJackpotGame) {
                const maxJackpotPrize = Math.max(...Object.values(jackpotPrize));
                if (withdrawCount < (+jackpotDraw + 1) ) {
                    return setJackpotData(jackpotDraw, maxJackpotPrize, true, maxJackpotPrize, true);
                }
                return setJackpotData(jackpotDraw, jackpotFullHousePrize, false, jackpotFullHousePrize, true);
            } 
            // If it is an Oddsen game and the number of withdrawn balls is less than the oddsen draw,
            if (isOddsenGame) {
                const oddsenDraw = parseInt(gameName.split(" ")[1], 10);
                if (withdrawCount < (oddsenDraw + 1)) {
                    const oddsenPrize = subGames[0].options[0].winning[`Full House Within ${oddsenDraw} Balls`];
                    return setJackpotData(oddsenDraw, oddsenPrize, true, oddsenPrize, true);
                }
                return setJackpotData(oddsenDraw, jackpotFullHousePrize, false, jackpotFullHousePrize, true);
                
            } 
            // If it is an Innsatsen game and the number of withdrawn balls is less than the jackpot draw,
            if (isInnsatsenGame) {
                const dailySchedule = await Sys.App.Services.scheduleServices.getSingleDailySchedulesData(
                    { _id: parentGameId }, 
                    { innsatsenSales: 1 }
                );
                const fullHousePrize = +parseFloat(subGames[0].options[0].winning["Full House"]).toFixed(2);
                if(dailySchedule && dailySchedule.innsatsenSales !== undefined){
                    // Get the amount before sales and the full house prize.
                    const innBeforeSales = +parseFloat(dailySchedule.innsatsenSales).toFixed(2);
                    if(withdrawCount < (+jackpotDraw + 1)){
                        // Calculate the winning amount.
                        const winningAmount = Math.min( (innBeforeSales + fullHousePrize), 2000);
                        return setJackpotData(jackpotDraw, winningAmount, true, winningAmount, true);
                    }
                }
                return setJackpotData(jackpotDraw, jackpotFullHousePrize, false, jackpotFullHousePrize, true);
            }

            return jackPotData;
        }catch(e){
            console.log("Error in getJackpotData---", getJackpotData)
            return { isDisplay: false };
        }
        
    
    }

}

function randomWithProbability(count, selectedElvisinAdmin) {

    let notRandomNumbersTemp = [1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 5];
    let notRandomNumbers = notRandomNumbersTemp.filter(function (el) {
        return selectedElvisinAdmin.includes(el);
    });
    console.log("notRandomNumbers", notRandomNumbers)
    let selected = [];
    for (let i = 0; i < count; i++) {
        let idx = Math.floor(Math.random() * notRandomNumbers.length);
        let number = notRandomNumbers[idx];
        if (selectedElvisinAdmin.length < 5) {
            notRandomNumbers.splice(idx, 1);
        }
        selected.push(number);
    }
    return selected;

    // const set = {1:0.4, 2:0.3, 3:0.15, 4:0.10, 5:0.05};

    // // get probabilities sum:
    // var sum = 0;
    // for(let j in set){
    //     sum += set[j];
    // }

    // // choose random integers:
    // return pick_random();

    // function pick_random(){
    //     var pick = Math.random()*sum;
    //     for(let j in set){
    //         pick -= set[j];
    //         if(pick <= 0){
    //             return j;
    //         }
    //     }
    // }

    // let weights = [0.4, 0.3, 0.15, 0.1, 0.05]; // probabilities
    // let results = [1, 2, 3, 4, 5]; // values to return
    // return getRandom();
    // function getRandom () {
    //     let num = Math.random(),
    //         s = 0,
    //         lastIndex = weights.length - 1;

    //     for (let i = 0; i < lastIndex; ++i) {
    //         s += weights[i];
    //         if (num < s) {
    //             return results[i];
    //         }
    //     }

    //     return results[lastIndex];
    // };
}

function getOnlinePlayers(namespace, roomId) {
    return new Promise((resolve, reject) => {
        const sockets = Object.values(Sys.Io.of(namespace).in(roomId).clients().connected);
        let adminCounts = 0;
        for (let s = 0; s < sockets.length; s++) {
            let socket = sockets[s];
            if (socket.myData && socket.myData.isAdmin) {
                console.log("socket has property", socket.myData.isAdmin)
                if (socket.myData.isAdmin == true) {
                    adminCounts = adminCounts + 1;
                }
            }
        }
        if (adminCounts < 0) {
            adminCounts = 0;
        }

        Sys.Io.of(namespace).in(roomId).clients((error, clients) => {
            if (error) {
                return reject(error);
            } else {
                let finalCount = clients.length;
                if (clients.length > 1 && adminCounts > 0) {
                    finalCount = parseInt(clients.length - adminCounts)
                }
                console.log("finalCount--", adminCounts, clients.length)
                resolve(finalCount);
            }
        });
    });
}

function getRandomArbitrary(min, max) {
    //return Math.floor(Math.random() * (max - min) + min);
    return Math.floor(fortuna.random() * (max - min) + min);
}

// Function to find ticket type based on number
function findTicketType(hall, ticketNumber) {
    for (const ticket of hall.tickets) {
        if (ticketNumber >= ticket.range[0] && ticketNumber <= ticket.range[1]) {
            return ticket;
        }
    }
    return null;
}

function convertIPv6MappedToIPv4(ip) {
    // Check if the input is an IPv6-to-IPv4 mapped address
    const isIPv6Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.test(ip);

    if (isIPv6Mapped) {
        // Extract the IPv4 portion (last 32 bits) and return it as an IPv4 address
        const ipv4Address = ip.replace(/^::ffff:/, '');
        return ipv4Address;
    }
    return ip;
}

async function getJackpotHighestPrice(data){
    try{
        const { allWinningOptions, pattern, defaultValue=0 } = data;
        let highestWinning = 0;
        if(allWinningOptions.length > 0){
            for(let i=0; i < allWinningOptions.length; i++){
                let patternListTemp = allWinningOptions[i].winning;
                let winning = patternListTemp[pattern];
                if(+winning > +highestWinning){
                    highestWinning = +winning;
                }
            }
            return highestWinning;
        }
        return defaultValue;
    }catch(e){
        return defaultValue;
    }
    
}

