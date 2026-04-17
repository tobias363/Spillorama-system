const Sys = require('../../../Boot/Sys');
const fortuna = require('javascript-fortuna');
const exactMath = require('exact-math');
const Timeout = require('smart-timeout');
fortuna.init();
const { i18next, translate } = require('../../../Config/i18n');
const { 
    sendWinnersScreenToAdmin,
    settlePendingWinners,
    nextGameCountDownStart,
    refreshGameOnFinish,
    refreshGameWithoutCountDown,
    checkIfAutoPauseGame,
    getWinnersOnWithdrawBall,
    splitByUserType,
    onlinePlayersAutoStopOnWinningNotification,
    isOnlyPhysicalWinner,
    updateUnclaimedWinForTicket,
    saveGameRedisobj
} = require('../../../gamehelper/game1-process');
const { getGameDataFromRedisHmset, saveGameDataToRedisHmset, cleanTimeAndData, checkPlayerSpending, updatePlayerHallSpendingData } = require('../../../gamehelper/all');
const { getAllJackpotPrizes } = require('../../../gamehelper/game1');
module.exports = {
    
    StartGame: async function(gameId) {
        let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {players: 1, subGames: 1, seconds: 1, gameName: 1, parentGameId: 1, earnedFromTickets: 1, startDate: 1, gameMode: 1});
        
        await Sys.Io.of(Sys.Config.Namespace.Game1).to(room._id).emit('GameStart', {});
    
        await Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, { $set: { status: 'running', timerStart: true, "otherData.gameSecondaryStatus": 'running' } });
        
        // update exact gamestart time in all the transaction of this game
        Sys.Game.Common.Services.PlayerServices.updateManyTransaction({gameType: "game_1", gameId: room._id },{ $set: { "otherData.exactGameStartTime": new Date(room.startDate) } });
        if(room.gameMode == "Manual"){
            Sys.Game.Common.Services.NotificationServices.updateManyData({ gameId: room._id, "notification.notificationType": "purchasedTickets" },{ $set: { "notification.date": new Date() } });
        }
        const playingPlayers = room.players.length ? room.players.map(player => player.id) : [];
        Sys.Game.Common.Controllers.PlayerController.checkBreakTimeForAllPlayers(playingPlayers);
        // save subgames data start
        let ticketsWinningPrices = [];
        if(room.subGames && room.subGames.length > 0 && room.subGames[0].options && room.subGames[0].options.length > 0 ){
            for(let o= 0; o < room.subGames[0].options.length; o++){
                if(room.subGames[0].options[o].winning && Object.keys(room.subGames[0].options[o].winning).length > 0){
                    let winningArray = [];
                    for (const key in room.subGames[0].options[o].winning) {
                        if (room.subGames[0].options[o].winning.hasOwnProperty(key)) {
                            if(room.gameName == "Spillerness Spill" || room.gameName == "Spillerness Spill 2"){
                                winningArray.push ({ pattern: key, winningValue: room.subGames[0].options[o].winning[key], minimumWinningValue: room.subGames[0].options[o].minimumWinning[key]});    
                            }else{
                                winningArray.push ({ pattern: key, winningValue: room.subGames[0].options[o].winning[key]});    
                            }
                            
                        }
                    }
                    ticketsWinningPrices[room.subGames[0].options[o].ticketName] = winningArray; 
                }   
            }      
        }else{
            console.log("No winning pattern found, so no winners in gameFinished", gameId);
        }
        console.log("room in StartGame ticketsWinningPrices:", JSON.stringify(room.ticketsWinningPrices));
        //console.log("ticketsWinningPrices---", ticketsWinningPrices, Object.assign({}, ticketsWinningPrices) )
        room = await Sys.Game.Game1.Services.GameServices.updateGameNew(room._id, { $set: { ticketsWinningPrices: Object.assign({}, ticketsWinningPrices)   } });
        const gameData = {
            _id: room._id, 
            players: room.players, 
            gameNumber: room.gameNumber,
            parentGameId: room.parentGameId,
            day: room.day,
            seconds: room.seconds,
            achiveBallArr: [],
            history: [],
            nextWithdrawBall: { number: null, color: null },
            lastBallDrawnTime: null,
            status: room.status,
            startDate: room.startDate,
            otherData: room.otherData,
            availableBalls: [],
            isBotGame: room.otherData?.isBotGame || false,
            jackPotNumber: room.jackPotNumber,
            totalTicketCount: room.totalNoPurchasedTickets,
            luckyNumberPrize: room.luckyNumberPrize,
            ticketPrice: room.ticketPrice,
            allPlayerIds: room.players.map(player => player.id),
            gameName: room.gameName,
            sequence: room.sequence,
            ballNumber: [],
            count: room.withdrawNumberArray.length,
            subGames: room.subGames,
            purchasedTickets: room.purchasedTickets,
            trafficLightExtraOptions:room.trafficLightExtraOptions,
            winners:room.winners,
            withdrawNumberArray:room.withdrawNumberArray,
            withdrawNumberList:room.withdrawNumberList,
            allHallsId:room.allHallsId,
            earnedFromTickets:room.earnedFromTickets,
            ticketsWinningPrices:room.ticketsWinningPrices,
            jackpotDraw:room.jackpotDraw,
            jackpotPrize:room.jackpotPrize,
            parentGameId:room.parentGameId,
            halls:room.halls,
            unclaimedWinners:room.otherData.unclaimedWinners,
            jackpotWinners:room.jackpotWinners,
            gameType:room.gameType,
            luckyNumberBonusWinners:room.luckyNumberBonusWinners,
            adminWinners:room.adminWinners,
            gameMode:room.gameMode,
        };
        // Store in Redis with TTL of 1 hour
        await saveGameDataToRedisHmset('game1', gameId, gameData);

        if(room.gameName == "Spillerness Spill" || room.gameName == "Spillerness Spill 2" || room.gameName == "Spillerness Spill 3"){
            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
            let {patternList, jackPotData} = await module.exports.patternListing(room._id);
            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('PatternChange',  { patternList, jackPotData } );
        }
        module.exports.gameInterval(gameId);
    },

    checkForWinners:async function(gameId, withdrawBall, lastBallDrawnTime, newAddedTickets = []){
        //checkForWinners: async function(SocketId, data){    
        try{
            Sys.Log.info('----checkForWinners start------: ' + gameId);
            const isForRunningGameAddedTickets = newAddedTickets.length
            let room = await getGameDataFromRedisHmset('game1', gameId, 
                [
                "gameName","gameNumber","subGames","purchasedTickets","trafficLightExtraOptions",
                "withdrawNumberArray","status","luckyNumberPrize","earnedFromTickets","ticketsWinningPrices",
                "jackpotDraw","jackpotPrize","parentGameId","halls","winners","otherData","_id"
            ]);
            if (!room || !room?._id) {
                console.log("Game not found in checkForWinners Redis!");
                room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, { players: 1, subGames: 1, seconds: 1, gameName: 1, parentGameId: 1, earnedFromTickets: 1, withdrawNumberArray: 1, withdrawNumberList: 1, jackpotDraw: 1, allHallsId: 1, halls: 1, otherData: 1, status: 1, gameNumber: 1, day: 1, startDate: 1, totalNoPurchasedTickets: 1, luckyNumberPrize: 1, ticketPrice: 1, sequence: 1, trafficLightExtraOptions: 1, winners: 1, earnedFromTickets: 1, ticketsWinningPrices: 1, jackpotPrize: 1, jackpotWinners: 1, gameType: 1, luckyNumberBonusWinners: 1, adminWinners: 1, gameMode: 1});
                if (!room) return;
                room = await saveGameRedisobj(room);
            }
            // let room = await Sys.Game.Game1.Services.GameServices.getSingleByData(
            //     { _id: gameId },
            //     { 
            //         gameName: 1, gameNumber: 1, subGames: 1, purchasedTickets: 1, 
            //         trafficLightExtraOptions: 1, withdrawNumberArray: 1, 
            //         status: 1, luckyNumberPrize: 1, earnedFromTickets: 1, ticketsWinningPrices: 1, 
            //         jackpotDraw: 1, jackpotPrize: 1, parentGameId: 1, halls: 1, winners: 1, 'otherData.unclaimedWinners': 1
            //     }
            // );

            // safely get last withdrawn ball
            const withdrawBallLatest = room.withdrawNumberArray?.at(-1);
            
            // overwrite withdrawBall with the final one
            if (withdrawBallLatest && withdrawBallLatest !== withdrawBall) {
                withdrawBall = withdrawBallLatest;
            }

            let ticketsRelatedBall = await Sys.Game.Game1.Services.GameServices.getBallMappingsByData(
                { gameId: gameId, ballNumber: withdrawBall },
                { tickets: 1 }
            );
            
            let allWinningPatternsWithPrize = Object.values(room.ticketsWinningPrices);
            
            // Optimize pattern filtering based on game name
            let allWinningPatterns =  Object.values(room.ticketsWinningPrices[0])[0] ;
            const gameNamePatterns = {
                "Super Nils": () => Object.keys(allWinningPatterns[0].winningValue)
                    .map(pattern => ({ pattern })),
                "Oddsen 56": () => allWinningPatterns.filter(p => p.pattern !== 'Full House Within 56 Balls'),
                "Oddsen 57": () => allWinningPatterns.filter(p => p.pattern !== 'Full House Within 57 Balls'),
                "Oddsen 58": () => allWinningPatterns.filter(p => p.pattern !== 'Full House Within 58 Balls')
            };

            allWinningPatterns = gameNamePatterns[room.gameName]?.() || allWinningPatterns;
            //console.log("allWinningPatterns", allWinningPatterns, room.ticketIdForBalls[withdrawBall], allWinningPatternsWithPrize, JSON.stringify(allWinningPatternsWithPrize))
            
            //let ticketsRelatedBall = room.ticketIdForBalls[withdrawBall];
            console.time("Game 1 tickets updation");
            let ballTickets = (ticketsRelatedBall[0] && ticketsRelatedBall[0].tickets) 
                            ? ticketsRelatedBall[0].tickets.map(ticket => ticket.ticketId)
                            : [];
            
            // if newAddedTickets is not empty, filter to intersection
            if (isForRunningGameAddedTickets) {
                const newTicketIds = newAddedTickets.map(t => t.toString());
                ballTickets = ballTickets.filter(id => newTicketIds.includes(id.toString()));
                console.log("ballTickets----", ballTickets, newAddedTickets, newTicketIds)
                if(!ballTickets.length){
                    return;
                }
            }

            if (ticketsRelatedBall.length > 0 && ballTickets.length > 0) {
                await Sys.Game.Game1.Services.GameServices.updateManyTicketData(
                    { 
                        _id: { $in: ballTickets }, // Filter multiple IDs
                    },
                    { $set: { "tickets.$[].$[inner].checked": true } },
                    {
                        arrayFilters: [
                            { "inner.Number": withdrawBall } // Filter inner objects where Number is 12
                        ]
                    }
                )
            }
            console.timeEnd("Game 1 tickets updation")

            let winners = [];
            let luckyNumberBonusWinners = [];
            if(allWinningPatterns.length > 0){
                const winningCombinations = [
                    ...new Set(
                      (isForRunningGameAddedTickets
                        ? room.winners.filter(w => w.drawNumber < room?.withdrawNumberArray?.length)
                        : room.winners
                      ).map(w => w.lineType)
                    )
                ];
                
                let lineTypesToCheck = allWinningPatterns
                    .filter(item => !winningCombinations.includes(item.pattern))
                    .map(el => el.pattern);
        
                console.log("lineTypesToCheck and winningCombinations---", lineTypesToCheck, winningCombinations)
                const currentPattern = lineTypesToCheck[0];

                // Update current patter in db to check unclaimed ticket verification
                Sys.Game.Game1.Services.GameServices.updateGameNew(gameId, { $set: { 'otherData.currentPattern': currentPattern } });
                console.time("Game 1 Pattern win logic");

                let tempPatternWinners = [];
                if (room.gameName === "Tv Extra") {
                    tempPatternWinners = await checkTVExtraWinningPattern(lineTypesToCheck, ballTickets, room._id);
                } else {
                    tempPatternWinners = await checkWinningPattern(currentPattern, ballTickets, room._id);
                }
                console.log("tempPatternWinners before checking unclaimed---", tempPatternWinners, room.gameName)
                let patternWinners = tempPatternWinners;

                // Only run duplicate check logic if winners exist and it's not a Full House
                if (tempPatternWinners.length > 0 && (room.gameName === "Tv Extra" || currentPattern !== "Full House")) {
                    patternWinners = await /** @type {Promise<any[]>} */(getWinnersOnWithdrawBall({
                        patternWinners: tempPatternWinners,
                        unclaimedWinners: room?.otherData?.unclaimedWinners ?? [],
                        currentPattern,
                        gameType: room.gameName,
                        withdrawBall,
                        isForRunningGameAddedTickets
                    }));
                }

                console.timeEnd("Game 1 Pattern win logic");
                console.log("winners----", patternWinners, winningCombinations, lineTypesToCheck);
                
                if(patternWinners.length > 0){
                    let wonPattern = lineTypesToCheck[0];
                    let withdrawNumberArray = room.withdrawNumberArray; // [];//room.withdrawNumberArray;
                    const withdrawBallCount = room.withdrawNumberArray.length;
                    withdrawNumberArray.push(0);
                    const lastBall = room.withdrawNumberArray[room.withdrawNumberArray.length - 2];
                    
                    const gameFlags = {
                        isWoF: false,
                        isTchest: false,
                        isMys: false,
                        isColorDraft: false
                    };

                    // Function to get the winning amount
                    const getWinningAmount = (winner, pattern) => {
                        const gameName = room.gameName;
                        const winningAmountTemp = allWinningPatternsWithPrize[0][winner.ticketColorName];
                       
                        if (gameName === "Super Nils") {
                            const position = ticketsRelatedBall[0]?.tickets?.find(t => t.ticketId.equals(winner._id))?.position?.split(':');
                            const winningColumn = position ? ["B", "I", "N", "G", "O"][+position[1]] : null;
                            return winningAmountTemp.find(x => x.pattern === winningColumn)?.winningValue[pattern] || 0;
                        }

                        if (["Spillerness Spill", "Spillerness Spill 2", "Spillerness Spill 3"].includes(gameName)) {
                            let percentage = winningAmountTemp.find(x => x.pattern === pattern)?.winningValue || 0;
                            let spillAmount = parseFloat((room.earnedFromTickets * percentage) / 100).toFixed(2);

                            if (gameName === "Spillerness Spill" || (gameName === "Spillerness Spill 2" && pattern === "Full House")) {
                                let minAmount = parseFloat(winningAmountTemp.find(x => x.pattern === pattern)?.minimumWinningValue || 0).toFixed(2);
                                return Math.max(spillAmount, minAmount);
                            }
                            return spillAmount;
                        }

                        if (["Oddsen 56", "Oddsen 57", "Oddsen 58"].includes(gameName) && pattern === "Full House") {
                            const threshold = parseInt(gameName.split(" ")[1], 10);
                            const patternToCheck = withdrawBallCount > threshold ? "Full House" : `Full House Within ${threshold} Balls`;
                            return winningAmountTemp.find(x => x.pattern === patternToCheck)?.winningValue || 0;
                        }

                        return winningAmountTemp?.find(x => x.pattern === pattern)?.winningValue || 0;
                    };

                    const getIndexes = (arr) => arr.reduce((acc, val, idx) => (val === 5 ? [...acc, idx] : acc), []);
                    winners = await Promise.all(
                        patternWinners.map(async (winner) => {
                            if (room.gameName === "Tv Extra") {
                                wonPattern = winner.wonPattern;
                            }
            
                            let winningAmount = +Math.round(getWinningAmount(winner, wonPattern) || 0);
                            let isJackpotWon = false;
            
                            // Jackpot & Game-Specific Adjustments
                            if (wonPattern === "Full House") {
                                switch (room.gameName) {
                                    case "Jackpot":
                                        if (withdrawBallCount <= room.jackpotDraw) {
                                            let ticketColorTemp = winner.ticketColorName.slice(6).toLowerCase();
                                            winningAmount = +room.jackpotPrize[ticketColorTemp] || 0;
                                            isJackpotWon = true;
                                        }
                                        break;
                                    case "Ball X 10":
                                        winningAmount = +(winningAmount + 10 * lastBall).toFixed(2);
                                        break;
                                    case "Wheel of Fortune":
                                        gameFlags.isWoF = true;
                                        winningAmount = 0;
                                        break;
                                    case "Treasure Chest":
                                        gameFlags.isTchest = true;
                                        winningAmount = 0;
                                        break;
                                    case "Mystery":
                                        gameFlags.isMys = true;
                                        winningAmount = 0;
                                        break;
                                    case "Color Draft":
                                        gameFlags.isColorDraft = true;
                                        winningAmount = 0;
                                        break;
                                    case "Innsatsen":
                                        if (withdrawBallCount <= room.jackpotDraw) {
                                            const dailySchedule = await Sys.App.Services.scheduleServices.getSingleDailySchedulesData(
                                                { _id: room.parentGameId },
                                                { innsatsenSales: 1 },
                                                {}
                                            );
                                            
                                            let innBeforeSales = +parseFloat(dailySchedule.innsatsenSales).toFixed(2);
                                            winningAmount = Math.min(winningAmount + innBeforeSales, 2000);
                                            isJackpotWon = true;
            
                                            await Sys.Game.Game1.Services.GameServices.updateGame(
                                                { _id: gameId },
                                                { $set: { 'otherData.isInnsatsenJackpotWon': true } }
                                            );
                                        }
                                        break;
                                }
                            }

                            let winnerObj =  {
                                playerId: winner.playerIdOfPurchaser,
                                playerName: winner.playerNameOfPurchaser,
                                ticketId: winner._id.toString(),
                                ticketNumber: winner.ticketId,
                                lineType: wonPattern,
                                wonAmount: winningAmount, //+parseFloat(winningAmount).toFixed(4),
                                lineTypeDisplay: wonPattern,
                                isFullHouse: (wonPattern == "Full House") ? true : false,
                                ticketPrice: winner.ticketPrice,
                                ticketColorType: winner.ticketColorType,
                                ticketColorName: winner.ticketColorName,
                                ballNumber: lastBall,
                                userType: winner.userType,
                                hallName: winner.hallName,
                                hallId: winner.hallId,
                                groupHallName: winner.groupHallName,
                                groupHallId: winner.groupHallId,
                                userTicketType: winner.userTicketType,
                                // isJackpotWon:  (lineTypesToCheck[l].isJackpot == true ) ? lineTypesToCheck[l].isJackpot : false,
                                isWoF : gameFlags.isWoF,
                                isTchest: gameFlags.isTchest,
                                isMys: gameFlags.isMys,
                                isColorDraft: gameFlags.isColorDraft,
                                drawNumber: withdrawNumberArray.length - 1,
                                // isGameTypeExtra: lineTypesToCheck[l].isGameTypeExtra,
                                // isWonLuckyNumberBonus: isWonLuckyNumberBonus,
                                
                                //wonElements: {rows: winner.rowChecks?.length ? getIndexes(winner.rowChecks): [], columns: winner.columnChecks?.length ? getIndexes(winner.columnChecks) : []  },
                                wonElements: {
                                    rows:
                                      room.gameName === "Tv Extra" && wonPattern === "Frame"
                                        ? [0, 4]
                                        : room.gameName === "Tv Extra" && wonPattern === "Full House"
                                        ? [0, 1, 2, 3, 4]
                                        : winner.rowChecks?.length
                                        ? getIndexes(winner.rowChecks)
                                        : [],
                                    columns:
                                      room.gameName === "Tv Extra" && wonPattern === "Frame"
                                        ? [0, 4]
                                        : room.gameName === "Tv Extra" && wonPattern === "Full House"
                                        ? [0, 1, 2, 3, 4]
                                        : winner.columnChecks?.length
                                        ? getIndexes(winner.columnChecks)
                                        : [],
                                    wonPatternAt: winner?.wonPatternAt
                                },
                                ticketCellArray: winner.tickets.map(ticket =>
                                    ticket.map(item => item.Number)
                                ),
                                isClaimed: (winner.userTicketType == "Physical") ? false: true,
                                tempWinningPrize: winningAmount
                            }
    
                            // room.halls.forEach(hall => {
                            //     console.log("Calling winnerDataRefresh for hall:", hall);
                            //     // Emit winner data to each hall, with a message
                            //     Sys.Io.of('admin').to(hall).emit('winnerDataRefresh', winnerObj, { message: "Ticket Purchase" });
                            // });

                            // Check for lucky number bonus
                            if( ( lastBall == +winner.luckyNumber) && wonPattern == "Full House"){
                                let luckyNumberPrize = Math.round(room.luckyNumberPrize);
                                luckyNumberBonusWinners.push({
                                    ...winnerObj,
                                    wonAmount: +parseFloat(luckyNumberPrize).toFixed(2),
                                    lineTypeDisplay: "Lucky Number Bonus",
                                    bonusType: "Lucky Number Bonus",
                                    isWonLuckyNumberBonus: true,
                                });
                            } 
    
                            return winnerObj;
                        })
                    );
                }

                // check for newly register tickets 
                // if(isForRunningGameAddedTickets && winners.length == 0){
                //     updateUnclaimedWinForTicket({gameId, newAddedTickets, lineTypesToCheck, gameName: room.gameName, withdrawNumberArray: room?.withdrawNumberArray, withdrawBall })
                // }
            }

            console.log("Ticket submitted winners all possibilities",gameId, winners, luckyNumberBonusWinners);
            
            // new logic of final winner check
            if (!winners?.length) {
                console.log("no winner found", gameId);
                return {
                    status: 'fail',
                    result: {ticketResult: false,rank: 0},
                    message: "No Winner Found."
                }
            }
        
            // Fetch game data once
            // const gameData = await Sys.Game.Game1.Services.GameServices.getSingleByData(
            //     { _id: gameId }, 
            //     { winners: 1, ticketsWinningPrices: 1, subGames: 1, trafficLightExtraOptions: 1, seconds: 1, 'otherData.isAutoStopped': 1, withdrawNumberArray: 1}
            // );
            let gameData = await getGameDataFromRedisHmset('game1', gameId,["_id","winners","ticketsWinningPrices","subGames","trafficLightExtraOptions","seconds","otherData","withdrawNumberArray"]);

            const existingWinners = new Set(
                (isForRunningGameAddedTickets
                  ? gameData.winners.filter(w => w.drawNumber < gameData?.withdrawNumberArray?.length)
                  : gameData.winners
                ).map(w => w.lineType)
            );
            
            // Filter winners and track already won lines
            const physicalWinners = [], onlineWinners = [];
            const physicalLuckyNumberWinners = [], onlineLuckyNumberWinners = [];
            
            // split winner online and physical only non-duplicate winners
            splitByUserType(winners, w => !existingWinners.has(w.lineType), physicalWinners, onlineWinners, room.withdrawNumberArray);

            // split all lucky number bonus winners by online and physical
            splitByUserType(luckyNumberBonusWinners, () => true, physicalLuckyNumberWinners, onlineLuckyNumberWinners);

            console.log("Ticket submitted Online and physical Winners", gameId, onlineWinners, physicalWinners, physicalLuckyNumberWinners, onlineLuckyNumberWinners );
        
            if (!physicalWinners.length && !onlineWinners.length) {
                return {
                    status: 'fail',
                    result: { ticketResult: false, rank: 0 },
                    message: "Already someone won, Better luck next time!"
                };
            }
            let updatedGameData = {
                $set: { 
                    'otherData.pendingWinners.onlineWinners': onlineWinners,
                    //'otherData.pendingWinners.finalWinners': onlineWinners,
                    'otherData.pendingWinners.onlineLuckyNumberBonusWinners': onlineLuckyNumberWinners,
                },
                $push: {
                    'otherData.unclaimedWinners': { $each: physicalWinners },
                    'otherData.unclaimedLuckyNumberBonusWinners': { $each: physicalLuckyNumberWinners } 
                }
            }
            // Update winners and luckynumber bonus as pending so that we can utilise at 1 second before 
            const updatedGame= await Sys.Game.Game1.Services.GameServices.updateGameNew(gameId, updatedGameData);
            saveGameDataToRedisHmset('game1', gameId, {otherData: updatedGame?.otherData});

            // const lineTypeMismatch =
            //     room?.otherData?.unclaimedWinners?.[0]?.lineType !== physicalWinners?.[0]?.lineType;
            // const updateQuery = {
            //     $set: {
            //         'otherData.pendingWinners.onlineWinners': onlineWinners,
            //         //'otherData.pendingWinners.finalWinners': onlineWinners,
            //         'otherData.pendingWinners.onlineLuckyNumberBonusWinners': onlineLuckyNumberWinners,
            //         ...(lineTypeMismatch && physicalWinners.length > 0 && { 'otherData.unclaimedWinners': physicalWinners })
            //     },
            //     $push: {
            //         ...(lineTypeMismatch
            //         ? {}
            //         : { 'otherData.unclaimedWinners': { $each: physicalWinners } }),
            //         'otherData.unclaimedLuckyNumberBonusWinners': { $each: physicalLuckyNumberWinners }
            //     }
            // };
            // const updatedGame = await Sys.Game.Game1.Services.GameServices.updateGameNew(gameId, updateQuery);

            const hasOnlineWinner = onlineWinners.length > 0;
            const isAutoStopped = gameData?.otherData?.isAutoStopped;
            const gameSeconds = gameData?.seconds ?? 3;
            const isAutoPauseGame = checkIfAutoPauseGame({ hasOnlineWinner, isAutoStopped, withdrawBallCount: gameData.withdrawNumberArray.length });
            // console.log("isAutoPauseGame----", isAutoPauseGame, hasOnlineWinner, isAutoStopped, gameSeconds)
            if (isAutoPauseGame) {
                const elapsedTime = Date.now() - lastBallDrawnTime;
                const timeToBingoAnnouncement = Math.max((gameSeconds - 1) * 1000 - elapsedTime, 0);
                
                // Sys.Log.info(`timeToBingoAnnouncement: ${timeToBingoAnnouncement}, elapsedTime: ${elapsedTime}`);

                Timeout.set(`${gameId}_announcement`, async () => {
                    try {
                        const autoPause = await module.exports.stopGame(gameId, "english", true, false);
                        console.log("autoPause status", autoPause);

                        if (autoPause?.status === "success") {
                            await Sys.Io.of(Sys.Config.Namespace.Game1).to(room._id).emit("BingoAnnouncement", {
                                message: "Bingo"
                            });

                            await Sys.Game.Game1.Services.GameServices.updateGame(
                                { _id: room._id },
                                { $set: { "otherData.pauseGameStats.isBingoAnnounced": true } }
                            );

                            Sys.Log.info("Do Bingo Announcement");
                        }
                    } catch (err) {
                        console.error("Error in autoPause announcement timeout:", err);
                    } finally {
                        Timeout.clear(`${gameId}_announcement`, erase = true);
                    }
                }, timeToBingoAnnouncement);
            }
            return true;
        
            // if(winners.length > 0){
            //     // check if line is alreay cash in
            //     let newRoom = await Sys.Game.Game1.Services.GameServices.getByData({ _id: gameId }, {winners: 1, ticketsWinningPrices: 1, subGames: 1, trafficLightExtraOptions: 1});
            //     let finalWinner = [];
            //     let alreadyWonLine = []
            //     for(let v=0; v < winners.length; v++){
            //         if (newRoom[0].winners.some(e => e.lineType == winners[v].lineType)) {
            //             // already won this line
            //             alreadyWonLine.push(winners[v].lineTypeDisplay);
            //         }else{
            //             finalWinner.push(winners[v]);
            //         }
            //     }
            //     console.log("Ticket submitted finalWinners",gameId, finalWinner)


            //     let returnData = await Sys.Game.Game1.Services.GameServices.updateGameNew(gameId , { $push: { winners: {$each : finalWinner}, luckyNumberBonusWinners: {$each : luckyNumberBonusWinners} } }); //{ _id: gameId }
            //     //console.log("Return Data after Game Winners Updated", returnData,returnData.winners);
            //     // hear bonus is jackpot
            //     let lineDisplay = [];
            //     let lineTypeTocheckBonus = [];
            //     let message;
            //     let isPhysicalWinner = false;
            //     if(finalWinner.length > 0){   //finalWinner
            //         //let messages = [];
            //         let winnigNotifications = [];
            //         for(let w=0; w < finalWinner.length; w++){
                       
            //             let isFullHouse = false;
            //             if(finalWinner[w].isFullHouse == true){
                           
            //                 isFullHouse = true;
            //             }
            //             if(finalWinner[w].isJackpotWon == true){
            //                 lineTypeTocheckBonus.push(finalWinner[w]);
            //             }
            //             if(finalWinner[w].userType == "Physical"){
            //                 isPhysicalWinner = true;
            //             }
                       
            //             winnigNotifications.push({ticketId:finalWinner[w].ticketId, fullHouse: isFullHouse, patternName: finalWinner[w].lineTypeDisplay, ticketNumber: finalWinner[w].ticketNumber, lineType: finalWinner[w].lineType, playerId: finalWinner[w].playerId});

            //             //messages.push(finalWinner[w].playerName + " has Won " + finalWinner[w].lineTypeDisplay )
            //         }
            //         console.log("winnigNotifications", winnigNotifications)
            //         if(winnigNotifications.length > 0){
            //             // admin webgl winners starts
            //             //remove finalWinner multiplied winning amount if condition 
            //             const isDuplicate = new Set(finalWinner.map(v => v.lineType));
            //             let winnerArray = [];
            //             if (isDuplicate.size < finalWinner.length) {
            //                 console.log('duplicates found', gameId);
            //                 const resultArray = [...finalWinner.reduce( (mp, o) => {
            //                     if (!mp.has(o.lineType)) mp.set(o.lineType, { ...o, count: 0, playerIdArray:[], ticketColorTypeArray: [] });
            //                     mp.get(o.lineType).count++;
            //                     mp.get(o.lineType).playerIdArray.push({playerId: o.playerId, playerName:o.playerName, ticketId: o.ticketId, ticketNumber: o.ticketNumber, ticketColorType: o.ticketColorType, ticketPrice: o.ticketPrice, winningAmount: o.wonAmount, ticketColorName: o.ticketColorName, ballNumber: o.ballNumber, userType: o.userType, hallName: o.hallName, wonElements: o.wonElements, isJackpotWon: o.isJackpotWon, ticketCellArray: o.ticketCellArray, hallId: o.hallId, groupHallName: o.groupHallName, groupHallId:o.groupHallId });
            //                     mp.get(o.lineType).ticketColorTypeArray.push(o.ticketColorType);
            //                     return mp;
            //                 }, new Map).values()];
            //                 console.log("resultArray in winners", resultArray, gameId)
            //                 for(let r = 0; r < resultArray.length; r++){
            //                     if(resultArray[r].count > 1){
            //                         console.log("winning distribution for same pattern won by multiple tickets", resultArray[r].playerIdArray);
            //                         let pLength =resultArray[r].playerIdArray.length;
            //                         //let winningAmount = exactMath.div(wonA, pLength);
            //                         //console.log("winningAmount",winningAmount, wonA , pLength)
            //                         for(let u = 0 ; u < resultArray[r].playerIdArray.length; u++){
            //                             let winAmount = Math.round( exactMath.div(resultArray[r].playerIdArray[u].winningAmount, pLength) ); //+parseFloat(exactMath.div(resultArray[r].playerIdArray[u].winningAmount, pLength) ).toFixed(4);
            //                             console.log("winAmount of distribution", winAmount)
            //                             winnerArray.push({
            //                                 playerId: resultArray[r].playerIdArray[u].playerId,
            //                                 playerName: resultArray[r].playerIdArray[u].playerName,
            //                                 ticketId: resultArray[r].playerIdArray[u].ticketId,
            //                                 ticketNumber: resultArray[r].playerIdArray[u].ticketNumber,
            //                                 lineType: resultArray[r].lineType,
            //                                 wonAmount: winAmount,
            //                                 lineTypeDisplay: resultArray[r].lineTypeDisplay,
            //                                 isFullHouse: resultArray[r].isFullHouse,
            //                                 ticketPrice: resultArray[r].playerIdArray[u].ticketPrice,
            //                                 ticketColorType: resultArray[r].playerIdArray[u].ticketColorType,
            //                                 ticketColorName: resultArray[r].playerIdArray[u].ticketColorName,
            //                                 isWoF : resultArray[r].isWoF,
            //                                 isTchest: resultArray[r].isTchest,
            //                                 isJackpotWon: resultArray[r].playerIdArray[u].isJackpotWon,
            //                                 isMys: resultArray[r].isMys,
            //                                 isColorDraft: resultArray[r].isColorDraft,
            //                                 // isGameTypeExtra: resultArray[r].isGameTypeExtra,
            //                                 userType: resultArray[r].playerIdArray[u].userType,
            //                                 hallName: resultArray[r].playerIdArray[u].hallName,
            //                                 hallId: resultArray[r].playerIdArray[u].hallId,
            //                                 groupHallName: resultArray[r].playerIdArray[u].groupHallName,
            //                                 groupHallId: resultArray[r].playerIdArray[u].groupHallId,
            //                                 wonElements: resultArray[r].playerIdArray[u].wonElements,
            //                                 ticketCellArray: resultArray[r].playerIdArray[u].ticketCellArray
            //                             })
            //                         }
                                     
            //                     }else{
            //                         winnerArray.push({
            //                             playerId: resultArray[r].playerId,
            //                             playerName: resultArray[r].playerName,
            //                             ticketId: resultArray[r].ticketId,
            //                             ticketNumber: resultArray[r].ticketNumber,
            //                             lineType: resultArray[r].lineType,
            //                             wonAmount: Math.round(resultArray[r].wonAmount), //+parseFloat(resultArray[r].wonAmount).toFixed(4),
            //                             lineTypeDisplay: resultArray[r].lineTypeDisplay,
            //                             isFullHouse: resultArray[r].isFullHouse,
            //                             ticketPrice: resultArray[r].ticketPrice,
            //                             ticketColorType: resultArray[r].ticketColorType,
            //                             ticketColorName: resultArray[r].ticketColorName,
            //                             isWoF : resultArray[r].isWoF,
            //                             isTchest: resultArray[r].isTchest,
            //                             isJackpotWon: resultArray[r].isJackpotWon,
            //                             isMys: resultArray[r].isMys,
            //                             isColorDraft: resultArray[r].isColorDraft,
            //                             // isGameTypeExtra: resultArray[r].isGameTypeExtra,
            //                             userType: resultArray[r].userType,
            //                             hallName: resultArray[r].hallName,
            //                             hallId: resultArray[r].hallId,
            //                             groupHallName: resultArray[r].groupHallName,
            //                             groupHallId: resultArray[r].groupHallId,
            //                             wonElements: resultArray[r].wonElements,
            //                             ticketCellArray: resultArray[r].ticketCellArray
            //                         })
            //                     }
            //                 }    
            //             }else{
            //                 winnerArray = finalWinner;
            //             }
            //             console.log("winnerArray after deciding amount for each player",gameId, winnerArray)
            //             let adminWinner = await Sys.Game.Game1.Services.GameServices.updateGameNew(gameId, { $push: { adminWinners: { $each: winnerArray } } }); //{ _id: gameId }
            //             console.log("Return Data after Game adminWinners Updated", adminWinner.adminWinners);
                        
            //             for(let s=0; s < winnigNotifications.length; s++){
            //                 let playerSocket = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: winnigNotifications[s].playerId  } , { socketId: 1 }, null);
            //                 console.log("playerSocket", playerSocket)
            //                 if(playerSocket){
            //                     let totalWon = (adminWinner.adminWinners).filter(i => i.playerId == winnigNotifications[s].playerId).reduce((acc, current) => acc + current.wonAmount, 0)
            //                     console.log("inside playerSocket , send broadcast to particualr player", totalWon)
            //                     await Sys.Io.of(Sys.Config.Namespace.Game1).to("/Game1#"+playerSocket.socketId).emit('PatternCompleted', {gameId: gameId, ticketList: winnigNotifications, totalWon: +totalWon  });
            //                 }
            //             }
                        
            //             // send nototfications to players
            //             if(winnerArray.length > 0){
                            
            //                 // update ticket winning data for particular ticket
            //                 for(let a=0; a < winnerArray.length; a++){
            //                     let isFullHouse = false;
            //                     if(winnerArray[a].isFullHouse == true){
            //                         isFullHouse = true;
            //                     }
            //                     const updateData = {
            //                         $set: {
            //                             isPlayerWon: true, isTicketSubmitted: true, isWonByFullhouse: isFullHouse,
            //                         },
            //                         $push: {
            //                             'otherData.winningStats': {
            //                                 lineType: winnerArray[a].lineTypeDisplay,
            //                                 wonElements: winnerArray[a].wonElements,
            //                                 wonAmount: winnerArray[a].wonAmount,
            //                                 isWinningDistributed: false,
            //                                 isJackpotWon: winnerArray[a].isJackpotWon,
            //                                 ballDrawned: room.withdrawNumberArray
            //                             }
            //                         },
            //                         $inc: { totalWinningOfTicket: +parseFloat(winnerArray[a].wonAmount).toFixed(4) } 
            //                     }
            //                     if (winnerArray[a].userType == "Physical") {
            //                         updateData['$set']['otherData.isWinningDistributed'] = false;
            //                     }
            //                     Sys.Game.Game1.Services.GameServices.updateTicket({ _id: winnerArray[a].ticketId, playerIdOfPurchaser: winnerArray[a].playerId }, updateData );
            //                 }
            //                 // update ticket winning data for particular ticket

            //                 let newArray = winnerArray.map(object => ({ ...object }))
            //                 let winnerPlayerPatternWise = Object.values(newArray.reduce(function(r, e) {
            //                     let key = e.playerId + '|' + e.lineType;
            //                     if (!r[key]) r[key] = e;
            //                     else {
            //                       r[key].wonAmount += e.wonAmount;
            //                     }
            //                     return r;
            //                 }, {}))
            //                 console.log("winnerPlayerPatternWise", winnerPlayerPatternWise, winnerArray)
            //                 let bulkArr = [];
            //                 for(let w=0; w < winnerPlayerPatternWise.length; w++){
            //                     if(winnerPlayerPatternWise[w].userType == "Physical"){
            //                         console.log("physical player found", winnerPlayerPatternWise[w])
            //                         continue;
            //                     }
            //                     let currentPlayer = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: winnerPlayerPatternWise[w].playerId}, {username: 1, walletAmount: 1, enableNotification: 1, socketId: 1, firebaseToken: 1, selectedLanguage: 1});
            //                     if(currentPlayer){
            //                         let message =  { en: await translate({key: "game1_individual_pattern", language: 'en', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: +parseFloat(winnerPlayerPatternWise[w].wonAmount).toFixed(2), number3: winnerPlayerPatternWise[w].lineTypeDisplay}), 
            //                                         nor: await translate({key: "game1_individual_pattern", language: 'nor', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: +parseFloat(winnerPlayerPatternWise[w].wonAmount).toFixed(2), number3: winnerPlayerPatternWise[w].lineTypeDisplay }) } ;
            //                         //room.gameNumber + " [ " + room.gameName + " ] Congratulations! You have won " + +parseFloat(winnerPlayerPatternWise[w].wonAmount).toFixed(2) + " Kr for Winning "  + winnerPlayerPatternWise[w].lineTypeDisplay + " Pattern. ";
            //                         if(winnerPlayerPatternWise[w].isWoF == true || winnerPlayerPatternWise[w].isTchest == true || winnerPlayerPatternWise[w].isMys == true || winnerPlayerPatternWise[w].isColorDraft == true){
            //                             if(winnerPlayerPatternWise[w].isWoF == true){
            //                                 message = { en: await translate({key: "game1_fullhouse_wof", language: 'en', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: winnerPlayerPatternWise[w].lineTypeDisplay}), 
            //                                 nor: await translate({key: "game1_fullhouse_wof", language: 'nor', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: winnerPlayerPatternWise[w].lineTypeDisplay}) }  //room.gameNumber + " [ " + room.gameName + " ] Congratulations! You have won " + winnerPlayerPatternWise[w].lineTypeDisplay + " Pattern, Spin Wheel of Fortune in order to win winning Amount. ";
            //                             }else if(winnerPlayerPatternWise[w].isTchest == true){
            //                                 message = { en: await translate({key: "game1_fullhouse_tc", language: 'en', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: winnerPlayerPatternWise[w].lineTypeDisplay}), 
            //                                 nor: await translate({key: "game1_fullhouse_tc", language: 'nor', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: winnerPlayerPatternWise[w].lineTypeDisplay}) }  //room.gameNumber + " [ " + room.gameName + " ] Congratulations! You have won " + winnerPlayerPatternWise[w].lineTypeDisplay + " Pattern, Open Treasure Chest in order to win winning Amount. ";
            //                             }else if(winnerPlayerPatternWise[w].isMys == true){
            //                                 message = { en: await translate({key: "game1_fullhouse_mystery", language: 'en', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: winnerPlayerPatternWise[w].lineTypeDisplay}), 
            //                                 nor: await translate({key: "game1_fullhouse_mystery", language: 'nor', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: winnerPlayerPatternWise[w].lineTypeDisplay}) }  //room.gameNumber + " [ " + room.gameName + " ] Congratulations! You have won " + winnerPlayerPatternWise[w].lineTypeDisplay + " Pattern, Play Mystery game in order to win winning Amount. ";
            //                             }else{
            //                                 message = { en: await translate({key: "game1_fullhouse_cd", language: 'en', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: winnerPlayerPatternWise[w].lineTypeDisplay}), 
            //                                 nor: await translate({key: "game1_fullhouse_cd", language: 'nor', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: winnerPlayerPatternWise[w].lineTypeDisplay}) }  //room.gameNumber + " [ " + room.gameName + " ] Congratulations! You have won " + winnerPlayerPatternWise[w].lineTypeDisplay + " Pattern, Play Color Draft game in order to win winning Amount. ";
            //                             }
            //                         }
            //                         if(room.gameName == "Jackpot" && winnerPlayerPatternWise[w].isJackpotWon == true){
            //                             message = { en: await translate({key: "game1_fullhouse_jackpot", language: 'en', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: +parseFloat(winnerPlayerPatternWise[w].wonAmount).toFixed(2), number3: winnerPlayerPatternWise[w].lineTypeDisplay}), 
            //                             nor: await translate({key: "game1_fullhouse_jackpot", language: 'nor', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: +parseFloat(winnerPlayerPatternWise[w].wonAmount).toFixed(2), number3: winnerPlayerPatternWise[w].lineTypeDisplay }) } ;
            //                             //room.gameNumber + " [ " + room.gameName + " ] Congratulations! You have won " + +parseFloat(winnerPlayerPatternWise[w].wonAmount).toFixed(2) + " Kr for Winning "  + winnerPlayerPatternWise[w].lineTypeDisplay + " Pattern (Jackpot Winning). ";
            //                         }
            //                         let notification ={
            //                             notificationType:'winning',
            //                             message: message
            //                         }
            //                         bulkArr.push({
            //                             insertOne: {
            //                                 document: {
            //                                     playerId: winnerPlayerPatternWise[w].playerId,
            //                                     gameId:room._id,
            //                                     notification: notification
            //                                 }
            //                             }
            //                         })
            //                     }
                                
                        
            //                 }
            //                 Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkArr);
            //             }
            //             console.log("winnerArray after notifications", winnerArray)
                        
            //             const resultArray = [...winnerArray.reduce( (mp, o) => {
            //                 if (!mp.has(o.lineType)) mp.set(o.lineType, { ...o, winnerCount: 0, playerIdArray:[], finalWonAmount: 0, ticketIdArray: [], winningTicket: [] });
                            
            //                 if(mp.get(o.lineType).playerIdArray.includes(o.playerId) == false ){
            //                     mp.get(o.lineType).winnerCount++;
            //                 }else{
            //                     console.log("dont include as already included", o.userType);
            //                     if(o.userType == "Physical"){
            //                         if(mp.get(o.lineType).ticketIdArray.includes(o.playerId + o.ticketId) == false ){
            //                             mp.get(o.lineType).winnerCount++;
            //                         }
            //                     }
            //                 }
            //                 mp.get(o.lineType).finalWonAmount= Math.round(mp.get(o.lineType).finalWonAmount + +o.wonAmount);  //+parseFloat(mp.get(o.lineType).finalWonAmount + +o.wonAmount).toFixed(4) ;
            //                 //mp.get(o.lineType).playerIdArray.push({"playerId": o.playerId, "ticketId": o.ticketId, "userType": o.userType});
            //                 mp.get(o.lineType).playerIdArray.push(o.playerId);
            //                 mp.get(o.lineType).ticketIdArray.push(o.playerId + o.ticketId);
            //                 mp.get(o.lineType).winningTicket.push({ticket: o.ticketCellArray, wonElement: o.wonElements});
            //                 return mp;
            //             }, new Map).values()];

            //             console.log("resultArray in winnigNotifications", resultArray, winnerArray)
            //             for(let w=0; w< resultArray.length; w++){
            //                 let winningTickets = [];
            //                 if( resultArray[w].winningTicket && resultArray[w].winningTicket.length > 0 ){
            //                     for(let i=0; i < resultArray[w].winningTicket.length; i++){
            //                         if(resultArray[w].lineType == "Frame"){
            //                             let frame = ["0:0", "0:1", "0:2", "0:3", "0:4", "1:0", "1:4", "2:0", "2:4", "3:0", "3:4", "4:0", "4:1", "4:2", "4:3", "4:4"];
            //                             const frameSet = new Set(frame);
            //                             const filteredArray = resultArray[w].winningTicket[i].ticket.map((row, rowIndex) =>
            //                                 row.map((item, colIndex) => {
            //                                     const coord = `${rowIndex}:${colIndex}`;
            //                                     return frameSet.has(coord) ? item : "";
            //                                 })
            //                             );
            //                             winningTickets.push({numbers: filteredArray, patternName: resultArray[w].lineType });
            //                         }else if(resultArray[w].lineType == "Picture"){
            //                             let picture = ["1:1", "1:2", "1:3", "2:1", "2:2", "2:3","3:1", "3:2", "3:3"];
            //                             const frameSet = new Set(picture);
            //                             const filteredArray = resultArray[w].winningTicket[i].ticket.map((row, rowIndex) =>
            //                                 row.map((item, colIndex) => {
            //                                     const coord = `${rowIndex}:${colIndex}`;
            //                                     return frameSet.has(coord) ? item : "";
            //                                 })
            //                             );
            //                             winningTickets.push({numbers: filteredArray, patternName: resultArray[w].lineType });
            //                         }else if(resultArray[w].lineType == "Row 1" && resultArray[w].winningTicket[i].wonElement.columns.length > 0){
            //                             const showColumnAsRow = (arr, columnIndex) => {
            //                                 const column = arr.map(row => row[columnIndex]);
            //                                 return arr.map((row, index) => index === columnIndex ? column : ["", "", "", "", ""]);
            //                             };
            //                             const result = showColumnAsRow(resultArray[w].winningTicket[i].ticket, (+resultArray[w].winningTicket[i].wonElement.columns[0]) );
            //                             winningTickets.push({numbers: result, patternName: resultArray[w].lineType });
            //                         }else{
            //                             const result = resultArray[w].winningTicket[i].ticket.map((row, index) => {
            //                                 return resultArray[w].winningTicket[i].wonElement.rows.includes(index) ? row : ["", "", "", "", ""];
            //                             });
            //                             winningTickets.push({numbers: result, patternName: resultArray[w].lineType });
            //                         }
            //                     }
            //                 }
            //                 let finalWinningTickets = [];
            //                 if(winningTickets.length > 0){
            //                     finalWinningTickets = winningTickets.map(item => ({
            //                         numbers: item.numbers.flat().map(String),
            //                         patternName: item.patternName
            //                     }));
            //                 }
            //                 console.log("winningTickets of admin----", JSON.stringify(finalWinningTickets))
            //                 console.log("admin winning notification", {"id": resultArray[w].lineType, "displayName": resultArray[w].lineTypeDisplay, "winnerCount": resultArray[w].winnerCount,"prize": resultArray[w].finalWonAmount, winningTickets: finalWinningTickets})
            //                 Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('BingoWinningAdmin', {"id": resultArray[w].lineType, "displayName": resultArray[w].lineTypeDisplay, "winnerCount": resultArray[w].winnerCount,"prize": resultArray[w].finalWonAmount, winningTickets: finalWinningTickets});
            //             }
   
            //         }
                   
            //         // check for fullhouse/pattern bonus

            //         // update remaining patterns
            //         console.log("update remaining patterns broadcast")
            //         let patternRoom = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {winners: 1, subGames: 1, jackpotPrize: 1, jackpotDraw: 1, gameName: 1, withdrawNumberArray: 1, otherData: 1, parentGameId: 1});
                   
            //         let patternListing = await module.exports.patternListing(room._id);
            //         let patternList = patternListing.patternList;
            //         //console.log("patternListing---", patternListing, patternList);

            //         const winningCombinations = [...new Set(patternRoom.winners.map(item => item.lineType))];
            //         let finalPatternList = [];
            //         for(let p=0; p < patternList.length; p++){
            //             if( winningCombinations.includes(patternList[p].name) == false ){
            //                 patternList[p].isWon = false;
            //                 finalPatternList.push(patternList[p]);
            //             }else{
            //                 patternList[p].isWon = true;
            //                 finalPatternList.push(patternList[p]);
            //             }
            //         }
            //         //finalPatternList = finalPatternList.map(({patternDesign,patternDataList})  => ({patternDesign, patternDataList}));
            //         console.log("finalPatternList when winner declared", finalPatternList)
                    
            //         // Jackpot games count and winnings
            //         const jackPotData = await Sys.Game.Game1.Controllers.GameController.getJackpotData(
            //             patternRoom.gameName,
            //             patternRoom.withdrawNumberArray.length,
            //             patternRoom.jackpotDraw,
            //             patternRoom.jackpotPrize,
            //             patternRoom.subGames,
            //             patternRoom.parentGameId
            //         );
            
            //         await Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('PatternChange',  { patternList: finalPatternList, jackPotData: jackPotData } );
            //         await Sys.Io.of('admin').to(gameId).emit('refreshTicketTable');
            //         clearInterval(Sys.GameTimers[gameId]);

            //         //if(isPhysicalWinner == true){
            //             let autoPause = await module.exports.stopGame(gameId, "english");
            //             console.log("autoPause status", autoPause);
            //             if(autoPause && autoPause.status == "success"){
            //                 return true;
            //             }
            //         //}

            //         return new Promise(resolve => {
            //             setTimeout(function () {
            //                 resolve();
            //                 module.exports.gameInterval(gameId);
            //                 return {
            //                     status: 'success',
            //                     result: {ticketResult: true,rank: 0},
            //                     //message: message
            //                 }
            //             }, 5000);
            //         });
            //     }else{
            //         message ="Already someone won, Better luck next time!";
            //         return {
            //             status: 'fail',
            //             result: {ticketResult: false,rank: 0},
            //             message: message
            //         }
            //     }    
            // }else{
            //     console.log("no winner found", gameId)
            // }
            // Sys.Log.info('----checkForWinners end------: ' + gameId);
            // return {
            //     status: 'fail',
            //     result: {ticketResult: false,rank: 0},
            //     message: "No Winner Found."
            // }
        }catch(e){
            console.log("error in checForWinners", e);
        }
    },

    checkForGameFinished: async function(gameId){
        try{
            // let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {ticketsWinningPrices: 1, winners: 1, gameName: 1});
            let room = await getGameDataFromRedisHmset('game1', gameId,['ticketsWinningPrices', 'winners', 'gameName', '_id']);
            if (!room || !room?._id) {
                room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, { players: 1, subGames: 1, seconds: 1, gameName: 1, parentGameId: 1, earnedFromTickets: 1, withdrawNumberArray: 1, withdrawNumberList: 1, jackpotDraw: 1, allHallsId: 1, halls: 1, otherData: 1, status: 1, gameNumber: 1, day: 1, startDate: 1, totalNoPurchasedTickets: 1, luckyNumberPrize: 1, ticketPrice: 1, sequence: 1, trafficLightExtraOptions: 1, winners: 1, earnedFromTickets: 1, ticketsWinningPrices: 1, jackpotPrize: 1, jackpotWinners: 1, gameType: 1, luckyNumberBonusWinners: 1, adminWinners: 1, gameMode: 1});
                if (!room) return false;
                room = await saveGameRedisobj(room);
            }
            if(room){
                let allWinningPatterns =  Object.values(room.ticketsWinningPrices[0])[0] ; 
                if(room.gameName == "Super Nils"){
                    let allWinningPatternsTemp  = allWinningPatterns[0];
                    allWinningPatterns = [];
                    for (const key in allWinningPatternsTemp.winningValue) {
                        allWinningPatterns.push({"pattern": key})
                    }
                }
                if(room.gameName == "Oddsen 56"){
                    allWinningPatterns = allWinningPatterns.filter(lineType => lineType.pattern != 'Full House Within 56 Balls');
                }else if(room.gameName == "Oddsen 57"){
                    allWinningPatterns = allWinningPatterns.filter(lineType => lineType.pattern != 'Full House Within 57 Balls');
                }else if(room.gameName == "Oddsen 58"){
                    allWinningPatterns = allWinningPatterns.filter(lineType => lineType.pattern != 'Full House Within 58 Balls');
                }
                const winningCombinations = [...new Set(room.winners.map(item => item.lineType))];
                let lineTypesToCheck = allWinningPatterns.filter((item) => !winningCombinations.includes(item.pattern));
                if(lineTypesToCheck.length == 0){
                    return true;
                }
                return false;
            }else{
                console.log("Room not found in checkForGameFinished");
                return false;
            }
        }catch(e){
            console.log("error in checkForGameFinished", e)
        }
    },

    gameFinished: async function(gameId){
        try{ 
            console.log("game finished final", gameId)
            
             // Clear any existing game timers for this game
            console.log('<======= || Clearing game timer for in gameFinished || =================>', gameId);
            await cleanTimeAndData(`${gameId}_timer`, 'game1', gameId);

            const room = await Sys.Game.Game1.Services.GameServices.getSingleByData(
                { _id: gameId },
                {
                    winners: 1, jackpotWinners: 1, gameType: 1, gameNumber: 1, gameName: 1,
                    withdrawNumberArray: 1, players: 1, subGames: 1, trafficLightExtraOptions: 1,
                    luckyNumberBonusWinners: 1, luckyNumberPrize: 1, earnedFromTickets: 1,
                    parentGameId: 1, adminWinners: 1, status: 1, otherData: 1, halls: 1,
                    startDate: 1, gameMode: 1
                }
            );
    
            if (!room || room.status === "finish") {
                console.log("room not found or already finished", gameId);
                return { status: 'error', message: "Room not found or already finished" };
            }
 

            // For entries without mini-games, we need to set both the primary and secondary statuses to "finish."
            // const isSpecialGame = ["Wheel of Fortune", "Treasure Chest", "Mystery", "Color Draft"].includes(room.gameName);
            // const hasWinners = room.winners.length > 0;
    
            // const statusUpdate = isSpecialGame && hasWinners
            //     ? { status: 'finish' }
            //     : { status: 'finish' }; //, "otherData.gameSecondaryStatus": 'finish'
                // Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, { $set: statusUpdate })
                // await saveGameDataToRedisHmset('game1', gameId, { status: 'finish' });
            await Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('GameFinishEndGame', {})
            
            updatePlayerStats(room.players); // update player game statistics

            const winnerArray = room.adminWinners;
            const MultiWinnig = processMultiWinnings(winnerArray); // Merge winning amount for multiple winnings
            
            console.log("---MultiWinnig player wise sorting---", MultiWinnig, gameId)
            Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                $set: {
                    status: 'finish',
                    winners: winnerArray,
                    multipleWinners:MultiWinnig,
                }
            });

            //assign winning amount to players
            const { allWinnersArray, winningNotificationBroadcast } = await distributeMultiWinnings(MultiWinnig, room);
            
            // update ticket for winning amount
            processTicketStats(winnerArray, gameId);
            
            // lucky Number Bonus Distribution start
            const winningLuckyNumberBroadcast = await processLuckyNumberBonus(room);

            console.log("winners, bonus & luckyNumber", winnerArray, room.luckyNumberBonusWinners, winningLuckyNumberBroadcast )

            // handle GameFinishAdmin broadcast
            //await broadcastAdminResults(winnerArray, gameId, room.withdrawNumberArray.length, MultiWinnig.length);
            await sendWinnersScreenToAdmin(gameId, room.gameName, winnerArray, room.withdrawNumberArray.length, false, true);
            
            console.log("allWinnersArray", allWinnersArray);
            
            handleLosers(allWinnersArray, room.players, gameId, room.gameNumber, room.gameName); //handle loosers
            
            if(winningNotificationBroadcast.length > 0){
                for(let w =0; w < winningNotificationBroadcast.length; w++){
                    await Sys.Io.of(Sys.Config.Namespace.Game1).to("/Game1#"+winningNotificationBroadcast[w].socketId).emit('GameFinish', {
                        message: winningNotificationBroadcast[w].message, gameId: gameId
                    });
                    
                }
            }

            if(winningLuckyNumberBroadcast.length > 0){
                for(let w =0; w < winningLuckyNumberBroadcast.length; w++){
                    await Sys.Io.to(winningLuckyNumberBroadcast[w].socketId).emit('NotificationBroadcast', {
                        notificationType: winningLuckyNumberBroadcast[w].notificationType,
                        message: winningLuckyNumberBroadcast[w].message
                    });
                }
            }
           
            Sys.Game.Game1.Services.GameServices.updateManyTicketData({gameId:gameId },{ $set: {status: 'Finished'} });
            
            // comment minigame data hear and use this as a function
            //await module.exports.checkForMinigames(gameId);
            
            //Tell Admin that Game Finished
            Sys.Io.of("admin").emit('GameFinish', { id: gameId });

            // refresh room to display new game screen
            const excludedGames = ["Wheel of Fortune", "Treasure Chest", "Mystery", "Color Draft"];
            if (!excludedGames.includes(room.gameName) || winnerArray.length === 0) {
                //refreshGameWithoutCountDown(gameId, room?.halls, 10000);
                //nextGameCountDownStart(room.halls, room.parentGameId, 10000);
    
                setTimeout(function () {
                    refreshGameWithoutCountDown(gameId, room?.halls, 0, room.parentGameId);
                    nextGameCountDownStart(room.halls, room.parentGameId, 2000);
                },10000);
                
            }else{
                await module.exports.checkForMinigames(gameId);
                Sys.Io.of('admin').emit('refreshSchedule', {scheduleId:  room.parentGameId});
                Sys.Game.Common.Controllers.GameController.game1StatusCron();
            }

            if(room.gameName == "Innsatsen"){
                const dailySchedule = await Sys.App.Services.scheduleServices.getSingleDailySchedulesData(
                    { _id: room.parentGameId },
                    { innsatsenSales: 1 }
                );
                let innBeforeSales = +parseFloat(dailySchedule?.innsatsenSales || 0).toFixed(2);
                // Fetch current and next game full house prize
                let fullhousePrize = +parseFloat(room.subGames?.[0]?.options?.[0]?.winning?.['Full House'] || 0).toFixed(2);
                const fullHousePrizeNextGame = await Sys.Game.Game1.Services.GameServices.getSingleByData(
                    { parentGameId: room.parentGameId, gameName: "Innsatsen", status: "active" },
                    { subGames: 1 }
                );
                if (fullHousePrizeNextGame) {
                    fullhousePrize = +parseFloat(fullHousePrizeNextGame.subGames?.[0]?.options?.[0]?.winning?.['Full House'] || 0).toFixed(2);
                }
                console.log("fullhousePrize & sales", fullhousePrize, innBeforeSales);
                
                // Calculate current game sales
                const currentGameSalesTemp = +parseFloat(room.earnedFromTickets || 0).toFixed(2);
                const currentGameSales = +parseFloat(exactMath.div(exactMath.mul(currentGameSalesTemp, 20), 100)).toFixed(2);
                console.log("currentGameSales---", currentGameSales);

                // Calculate total sales with cap at 2000
                let totalPreviousSales = +parseFloat(innBeforeSales + currentGameSales).toFixed(2);
                if (totalPreviousSales + fullhousePrize > 2000) {
                    totalPreviousSales -= (totalPreviousSales + fullhousePrize) - 2000;
                }

                console.log("totalPreviousSales---", totalPreviousSales)
                await Sys.App.Services.scheduleServices.updateDailySchedulesData({ _id: room.parentGameId },{
                    $set: { "innsatsenSales": Math.round(+totalPreviousSales)  }
                });
                
            }
            
            if(room.gameName == "Innsatsen" && room.otherData.isInnsatsenJackpotWon == true){
                console.log("update innsatsen sales to zero")
                await Sys.App.Services.scheduleServices.updateDailySchedulesData({ _id: room.parentGameId },{
                    $set: { "innsatsenSales": 0  }
                });
            }

            // Sys.Io.of('admin').emit('refreshSchedule', {scheduleId:  room.parentGameId});
            // Sys.Game.Common.Controllers.GameController.game1StatusCron();
            
            //Remove balls mapping data of game
            await Sys.Game.Game1.Services.GameServices.deleteManyBallMappingsByData({gameId: gameId})
            
            //module.exports.nextGameCountDownStart(room.halls);
            
            return {
                status: 'success',
                message: "Winners Found!"
            }    
        
        }catch(e){
            console.log("Error in gameFinished", e);
        }
    },

    wheelOfFortuneData: async function(socket, data) {
        try {
            let language = "nor";
            if(data.language){
                language = data.language;
            }
            console.log("WheelOfFortuneData: ", data);
            // [ Player Validation ]
            if(data.playerType == "Real"){
                let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: data.playerId}, {status: 1, username: 1, selectedLanguage: 1});
                if (!player) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "player_not_found", language: language}), // 'No Player Found!',
                        statusCode: 401
                    }
                }
                language = player.selectedLanguage;
            }
            let [wheelOfFortuneList, room] = await Promise.all([
                Sys.App.Services.otherGameServices.getByData({ slug: 'wheelOfFortune' }),
                Sys.Game.Game1.Services.GameServices.getSingleGameByData({ _id: data.gameId }, {'otherData.isPaused': 1})
            ]);
            console.log("wheelOfFortuneList.wheelOfFortuneprizeList", wheelOfFortuneList.wheelOfFortuneprizeList, room)
            return {
                status: 'success',
                result: {"prizeList": wheelOfFortuneList.wheelOfFortuneprizeList, isGamePaused: room?.otherData?.isPaused},
                message: 'Game 1 WheelOfFortuneData..!!'
            }

        } catch (error) {
            console.log("Error in WheelOfFortuneData Game1 : ", error);
            return new Error(error);
        }
    },

    playWheelOfFortune: async function(socket, data) {
        try {
            let language = "nor";
            if(data.language){
                language = data.language;
            }
            console.log("playWheelOfFortune game 1: ", data);
            // [ Player Validation ]
            let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: data.playerId}, {status: 1, username: 1, selectedLanguage: 1});
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "player_not_found", language: language}), //'No Player Found!',
                    statusCode: 401
                }
            }
            language = player.selectedLanguage;
            let room = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, {wofWinners: 1, gameNumber: 1, gameType: 1, subGames: 1, winners: 1, withdrawNumberArray: 1});
            
            if(room.length > 0){
                if(room[0].winners.length > 0){
                    let isIndex = room[0].winners.findIndex((e) =>  (e.playerId ==  data.playerId && e.enabledSpinner == true ) );
                    if(isIndex == -1){
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({key: "not_eligible_to_play_wof", language: player.selectedLanguage}), // 'You are not Eligible to play Wheel of Fortune!',
                            statusCode: 400
                        }
                    }
                    
                    // Dont allow to take turn when game is paused
                    if (room[0].otherData?.gameSecondaryStatus == "running" && room[0].otherData?.isPaused == true) {
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({key: "wait_to_take_turn_as_game_paused", language: language}), // 'You are not Eligible to play Wheel of Fortune!',
                            statusCode: 400
                        }
                    }
                    
                    let isUpdated = await Sys.Game.Game1.Services.GameServices.updateGame({ _id:  data.gameId, "otherData.isMinigamePlayed": false }, {
                        $set: {
                            'otherData.isMinigamePlayed': true,
                        }
                    });
                    console.log("isUpdated---", isUpdated.modifiedCount)
                    if(isUpdated && isUpdated.modifiedCount == 0){
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({key: "already_spinned_wof", language: player.selectedLanguage}), // 'Whell of fortune already spinned!',
                            statusCode: 400
                        }
                    }
                    
                    let wheelOfFortuneList = await Sys.App.Services.otherGameServices.getByData({ slug: 'wheelOfFortune' });
                    console.log("wheelOfFortuneList.wheelOfFortuneprizeList", wheelOfFortuneList.wheelOfFortuneprizeList)
                    
                    let winnerCount = room[0].wofWinners.length;
                   
                    let prizeList = wheelOfFortuneList.wheelOfFortuneprizeList;
                    const randomIndex = Math.floor(Math.random() * prizeList.length);
                    let amount = prizeList[randomIndex];
                    let afterDistributionAmount = Math.round(exactMath.div(amount, winnerCount) ); //+parseFloat(exactMath.div(amount, winnerCount) ).toFixed(2);
                    console.log('\x1b[36m%s\x1b[0m', '----------------------------------------------------------------------');
                    console.log('\x1b[36m%s\x1b[0m', '[ Mini Game (Game 1) [ Wheel of Fortune] Winner Amount:- ' + amount + ']', data.playerId);
                    console.log('\x1b[36m%s\x1b[0m', '----------------------------------------------------------------------');
                
                    const latestRoom = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId}, {
                        $set: {
                            'winners.$[current].wonAmount': afterDistributionAmount,
                        },
                    }, { arrayFilters: [ {"current.isWoF": true} ], new: true });

                    await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId}, {
                        $set: {
                            'wofWinners.$[].WinningAmount': afterDistributionAmount,
                            'otherData.miniGameResults': [{winningAmount: amount}]
                        },
                    }, {  new: true });

                    let physicalWinners = [], onlineWinners = [], uniqueWinners = [];
                    for(let w=0; w < room[0].wofWinners.length; w++){
                        if(room[0].wofWinners[w].playerType == "Physical"){
                            physicalWinners.push({ticketNumber: room[0].wofWinners[w].ticketNumber, winningAmount: afterDistributionAmount});
                        }else if(room[0].wofWinners[w].playerType == "Online"){
                            onlineWinners.push({ticketNumber: room[0].wofWinners[w].ticketNumber, winningAmount: afterDistributionAmount});
                        }else{
                            uniqueWinners.push({ticketNumber: room[0].wofWinners[w].ticketNumber, winningAmount: afterDistributionAmount});
                        }
                    }

                    // handle GameFinishAdmin broadcas
                    const adminResult = await sendWinnersScreenToAdmin(data.gameId, room[0].gameName, latestRoom.winners, room[0].withdrawNumberArray.length, true, false);
                    console.log("startSpinWheel broadcast--", JSON.stringify({
                        gameId: data.gameId,
                        amount: amount,
                        miniGameType: "wheelOfFortune",
                        winningTicketNumbers: {physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners}, 
                        winningScreen: adminResult
                    }));

                    Sys.Io.of(Sys.Config.Namespace.Game1).to(data.gameId).emit('startSpinWheel', {
                        gameId: data.gameId,
                        amount: amount,
                        miniGameType: "wheelOfFortune",
                        winningTicketNumbers: {physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners}, 
                        winningScreen: adminResult
                    });

                   
                    // Send stop wheel of fortuen broadcast to all players and TV Screen
                    Timeout.set(`${data.gameId}_wof_spin_wheel`, async () => {
                        try {
                            console.log("stopSpinWheel called")
                            await Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId }, {
                                $set: {
                                    'otherData.isWofSpinStopped': true,
                                }
                            });
                            Sys.Io.of(Sys.Config.Namespace.Game1).to(data.gameId).emit('stopSpinWheel', {
                                gameId: data.gameId,
                                amount: amount,
                                miniGameType: "wheelOfFortune",
                                winningTicketNumbers: {physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners}, 
                                winningScreen: adminResult
                            });
                        } catch (err) {
                            console.error("Error in autoPause announcement timeout:", err);
                        } finally {
                            Timeout.clear(`${data.gameId}_wof_spin_wheel`, erase = true);
                        }
                    }, 10000);
        
                    // Now if wheelOfFortuneFinished not called in 15 seconds, system will auto call
                    setTimeout(function () {
                        console.log("wheelOfFortuneFinished called from game");
                        module.exports.wheelOfFortuneFinished(null, {playerId: data.playerId, gameId: data.gameId})
                    },15000);

                    return {
                        status: 'success',
                        result: amount,
                        message: 'Game 1 WheelOfFortuneData Winner Amount ..!!'
                    }
               
                } 
            }else{
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "no_permission_wof", language: language}), // 'You are not Eligible to play Wheel of Fortune!',
                    statusCode: 400
                }
            }
          
        } catch (error) {
            console.log("Error in PlayWheelOfFortune Game1 : ", error);
            return new Error(error);
        }
    },

    wheelOfFortuneFinished: async function(socket, data) {
        try {
            let language = "nor";
            if(data.language){
                language = data.language;
            }
            console.log("WheelOfFortuneFinished Game 1: ", data);
            let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: data.playerId}, {status: 1, username: 1, selectedLanguage: 1});
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "player_not_found", language: language}), // 'No Player Found!',
                    statusCode: 401
                }
            }
            let room = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, {wofWinners: 1, gameNumber: 1, gameType: 1, subGames: 1, winners: 1, gameName: 1, otherData: 1, halls : 1, parentGameId: 1});
           
            if (room.length == 0) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "game_not_found", language: player.selectedLanguage}), // 'Game Not Found!',
                    statusCode: 400
                }
            }

            let isIndex = room[0].winners.findIndex((e) =>  (e.playerId ==  data.playerId && e.enabledSpinner == true ) );
            if(isIndex == -1){
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "something_went_wrong", language: player.selectedLanguage}), // 'Something Went Wrong!',
                    statusCode: 400
                }
            }

            if(room[0].otherData.isMinigamePlayed === false){
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "something_went_wrong", language: player.selectedLanguage}), // 'Something Went Wrong!',
                    statusCode: 400
                }
            }

            let isUpdated = await Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId, "otherData.isMinigameFinished": false }, {
                $set: {
                    'otherData.isMinigameFinished': true,
                    //'otherData.gameSecondaryStatus': 'finish'
                }
            });
            console.log("isUpdated---", isUpdated.modifiedCount)
            if(isUpdated && isUpdated.modifiedCount == 0){
                return {
                    status: 'success',
                    message: await translate({key: "wof_winner_already", language: player.selectedLanguage, isDynamic: true, number: room[0].otherData.wofWinningAmountValue }), //"Congratulations! You have won " + room[0].otherData.wofWinningAmountValue +" Kr In Wheel of Fortune."
                }
            }


            for(let w=0; w < room[0].wofWinners.length; w++){
                let ticketId = room[0].wofWinners[w].ticketId;
               
                let tempTicketData = await Sys.Game.Game1.Services.GameServices.getTicketListData({ _id: ticketId}, {ticketColorName: 1, ticketPrice: 1});
               
                if(room[0].wofWinners[w].playerType == "Physical"){
                    let transactionDataSend = {
                        playerId: room[0].wofWinners[w].playerId,
                        playerName: room[0].wofWinners[w].playerName,
                        gameId: data.gameId,
                        transactionSlug: "WOFPrizeGame1",
                        action: "debit",
                        purchasedSlug: "cash",
                        gameNumber: room[0].gameNumber,
                        gameType: room[0].gameType,
                        patternPrize: Math.round(room[0].wofWinners[w].WinningAmount),
                        //previousBalance: +player.points.toFixed(4),
                        variantGame: room[0].subGames[0].gameName,
                        ticketPrice: tempTicketData[0].ticketPrice,
                        ticketColorType: tempTicketData[0].ticketColorName,
                        ticketId: room[0].wofWinners[w].ticketId,
                        ticketNumber:  room[0].wofWinners[w].ticketNumber,
                        hallName: room[0].wofWinners[w].hallName,
                        game1Slug:"WOFPrizeGame1",
                        typeOfTransaction: "Wheel of Fortune Prize",
                        remark: "Win Prize " + Math.round(room[0].wofWinners[w].WinningAmount) + " in Game 1 Wheel of Fortune Game", //remark on transaction
                        userType: "Physical"
                    }
                    Sys.Helper.gameHelper.createTransactionAgent(transactionDataSend); 
                    Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                        type: "winning",
                        playerId: room[0].wofWinners[w].playerId,
                        hallId: room[0].wofWinners[w].hallId,
                        winning: Math.round(room[0].wofWinners[w].WinningAmount)
                    });
                    await updatePlayerHallSpendingData({ playerId: room[0].wofWinners[w].playerId, hallId: room[0].wofWinners[w].hallId, amount: Math.round(room[0].wofWinners[w].WinningAmount), type: 'normal', gameStatus: 3 });
                }else{
                    let transactionDataSend = {
                        playerId: room[0].wofWinners[w].playerId,
                        playerName: room[0].wofWinners[w].playerName,
                        gameId: data.gameId,
                        transactionSlug: "WOFPrizeGame1",
                        action: "credit",
                        purchasedSlug: "realMoney",
                        gameNumber: room[0].gameNumber,
                        gameType: room[0].gameType,
                        totalAmount: Math.round(room[0].wofWinners[w].WinningAmount),
                        //previousBalance: +player.points.toFixed(4),
                        variantGame: room[0].subGames[0].gameName,
                        ticketPrice: tempTicketData[0].ticketPrice,
                        ticketColorType: tempTicketData[0].ticketColorName,
                        ticketNumber:  room[0].wofWinners[w].ticketNumber,
                        hall: {
                            id: room[0].wofWinners[w].hallId,
                            name: room[0].wofWinners[w].hallName
                        },
                        groupHall: {
                            id: room[0].wofWinners[w].groupHallId,
                            name: room[0].wofWinners[w].groupHallName
                        }
                    }
                    Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend); 
                    Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                        type: "winning",
                        playerId: room[0].wofWinners[w].playerId,
                        hallId: room[0].wofWinners[w].hallId,
                        winning: Math.round(room[0].wofWinners[w].WinningAmount)
                    });
                    await updatePlayerHallSpendingData({ playerId: room[0].wofWinners[w].playerId, hallId: room[0].wofWinners[w].hallId, amount: Math.round(room[0].wofWinners[w].WinningAmount), type: 'normal', gameStatus: 3 });
                }
                
                Sys.Game.Game1.Services.GameServices.updateTicket({_id: ticketId, playerIdOfPurchaser: room[0].wofWinners[w].playerId }, { $push: { "wofWinners": {playerId: room[0].wofWinners[w].playerId,WinningAmount: (+room[0].wofWinners[w].WinningAmount), ticketId: ticketId} },  $inc: { totalWinningOfTicket: +parseFloat(room[0].wofWinners[w].WinningAmount).toFixed(2), "winningStats.finalWonAmount": +parseFloat(room[0].wofWinners[w].WinningAmount).toFixed(2), }  });
                Sys.Game.Game1.Services.GameServices.updateTicketNested({_id: ticketId}, {
                    $inc: {
                        'winningStats.lineTypeArray.$[current].wonAmount': Math.round(room[0].wofWinners[w].WinningAmount),
                        'otherData.winningStats.$[current].wonAmount': Math.round(room[0].wofWinners[w].WinningAmount)
                    },
                }, { arrayFilters: [ {"current.lineType": "Full House"} ], new: true });
               
                if((+room[0].wofWinners[w].WinningAmount) > 0){
                    await Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId }, { $inc: { totalWinning: (Math.round(room[0].wofWinners[w].WinningAmount)), finalGameProfitAmount: -( Math.round(room[0].wofWinners[w].WinningAmount) ) } });
                }
            }
            let playerWinningPopup = +room[0].wofWinners[0].WinningAmount;
            let totalWinningAmount = 0;
            if(room[0].wofWinners.length > 0){
                let newArray = room[0].wofWinners.map(object => ({ ...object }))
                let winnerPlayerPatternWise = Object.values(newArray.reduce(function(r, e) {
                    let key = e.playerId;
                    if (!r[key]) r[key] = e;
                    else {
                      r[key].WinningAmount += e.WinningAmount;
                    }
                    return r;
                }, {}))
                totalWinningAmount = room[0].wofWinners.reduce(
                    (sum, item) => item.playerId === data.playerId ? sum + item.WinningAmount : sum,
                    0
                  );
                // console.log("totalWinningAmount", totalWinningAmount)
                // console.log("winnerPlayerPatternWise", JSON.stringify(winnerPlayerPatternWise,null,2))
                let bulkArr = [];
                for(let w=0; w < winnerPlayerPatternWise.length; w++){
                    let currentPlayer = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: winnerPlayerPatternWise[w].playerId}, {username: 1, walletAmount: 1, enableNotification: 1, socketId: 1, firebaseToken: 1, selectedLanguage: 1});
                    if(currentPlayer){
                        let message = 
                        { en: await translate({key: "wof_winner", language: 'en', isDynamic: true, number: room[0].gameNumber, number1: room[0].gameName, number2: (+ parseFloat(winnerPlayerPatternWise[w].WinningAmount).toFixed(2) ) }), 
                        nor: await translate({key: "wof_winner", language: 'nor', isDynamic: true, number: room[0].gameNumber, number1: room[0].gameName, number2: (+ parseFloat(winnerPlayerPatternWise[w].WinningAmount).toFixed(2) )  }) };  //room[0].gameNumber + " [ " + room[0].gameName + " ] Congratulations! You have won " + (+ parseFloat(winnerPlayerPatternWise[w].WinningAmount).toFixed(2) ) + " Kr In Wheel of Fortune. ";
                        let notification ={
                            notificationType:'winning',
                            message: message
                        }

                        bulkArr.push({
                            insertOne: {
                                document: {
                                    playerId: winnerPlayerPatternWise[w].playerId,
                                    gameId:room[0]._id,
                                    notification: notification
                                }
                            }
                        });

                        await Sys.Io.to(currentPlayer.socketId).emit('NotificationBroadcast', {
                            notificationType: notification.notificationType,
                            message: notification.message[currentPlayer.selectedLanguage]
                        });
            
                        // if(currentPlayer.firebaseToken){
                        //     let messageNotification = {
                        //         notification: {
                        //             title: "Spillorama",
                        //             body: message[currentPlayer.selectedLanguage]
                        //         },
                        //         token : currentPlayer.firebaseToken
                        //     };
                        //     Sys.Helper.gameHelper.sendWinnersNotifications(messageNotification);
                        // }

                        if(winnerPlayerPatternWise[w].playerId == data.playerId){
                            playerWinningPopup = +parseFloat(winnerPlayerPatternWise[w].WinningAmount).toFixed(2);
                            Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId }, {
                                $set: {
                                    'otherData.wofWinningAmountValue': playerWinningPopup,
                                }
                            });
                        }
                    }
                }
                Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkArr);
            }

            // Refresh game on finish
            await refreshGameOnFinish(room[0]._id, room[0].halls, room[0].parentGameId);
            
            return {
                status: 'success',
                // message:  await translate({key: "wof_winner_already", language: player.selectedLanguage, isDynamic: true, number:  +room[0].wofWinners[0].WinningAmount}) //"Congratulations! You have won " + +room[0].wofWinners[0].WinningAmount +" Kr In Wheel of Fortune."
                message:  await translate({key: "wof_winner_already", language: player.selectedLanguage, isDynamic: true, number: +totalWinningAmount}) //"Congratulations! You have won " + +room[0].wofWinners[0].WinningAmount +" Kr In Wheel of Fortune."
            }


        } catch (error) {
            console.log("Error in WheelOfFortuneFinished Game1 : ", error);
            return new Error(error);
        }
    },

    TreasureChestData: async function(socket, data) {
        try {
            let language = "nor";
            if(data.language){
                language = data.language;
            }
            console.log("TreasureChestData: ", data);
            if(data.playerType == "Real"){
                let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: data.playerId}, {status: 1, username: 1, selectedLanguage: 1});
                if (!player) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "player_not_found", language: language}), // 'No Player Found!',
                        statusCode: 401
                    }
                }
                language = player.selectedLanguage;
            }
            let room = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, {tChestWinners: 1, gameNumber: 1, gameType: 1, subGames: 1, winners: 1, 'otherData.isSpinByAdmin': 1, 'otherData.isPaused': 1});
           
            if(room.length > 0){
                if(room[0].winners.length > 0){
                    
                    let treasureChestList = await Sys.App.Services.otherGameServices.getByData({ slug: 'treasureChest' });
                    console.log("treasureChestList", treasureChestList.treasureChestprizeList)
                    
                    let result = {
                        prizeList: treasureChestList.treasureChestprizeList,
                        showAutoTurnCount: room[0].otherData?.isSpinByAdmin ? false : true,
                        isGamePaused: room[0].otherData?.isPaused
                    }
        
                    return {
                        status: 'success',
                        result: result,
                        message: 'Game 1 TreasureChestData..!!'
                    }

                }
            }
            return {
                status: 'fail',
                result: null,
                message: await translate({key: "something_went_wrong", language: player.selectedLanguage}), //'Something Went Wrong!',
                statusCode: 400
            }
        } catch (error) {
            console.log("Error in TreasureChestData Game1 : ", error);
            return new Error(error);
        }
    },

    SelectTreasureChest: async function(socket, data) {
        try {
            let language = "nor";
            if(data.language){
                language = data.language;
            }
            console.log("SelectTreasureChest: ", data);
            let isPlayedByAdmin  = false;
            let isAutoTurn = false;
            if(data.playerType == "Real"){
                let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: data.playerId}, {status: 1, username: 1, selectedLanguage: 1});
                
                if (!player) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "player_not_found", language: language}), //'No Player Found!',
                        statusCode: 401
                    }
                }
                language = player.selectedLanguage;
            }else if(data.playerType == "Admin"){
                isPlayedByAdmin = true;
                language = "en";
            }else if(data.playerType == "Auto"){
                isAutoTurn = true;
            }
           
            let room = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, { tChestWinners: 1, gameNumber: 1, gameType: 1, subGames: 1, winners: 1, gameName: 1, otherData: 1, halls : 1, parentGameId: 1, withdrawNumberArray: 1});
        
            if (room.length == 0) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "game_not_found", language: language}), // 'Game Not Found!',
                    statusCode: 400
                }
            }

            if(isPlayedByAdmin == true){
                if(room[0].otherData?.isSpinByAdmin == false){
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "no_permission", language: language}), // 'You do not have permission to access.',
                        statusCode: 400
                    }
                } 
                // check if action taken is by master agent
                let ipOfAgent = getPlayerIp(socket);
                let masterHallId =  room[0].otherData.masterHallId;
                console.log("ipOfAgent and masterHallId", ipOfAgent, masterHallId)
                if(!ipOfAgent || !masterHallId){
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "no_permission", language: language}), // 'You do not have permission to access.',
                        statusCode: 400
                    }
                }
                let  masterHallIp = await Sys.App.Services.HallServices.getSingleHallData({_id: masterHallId }, ["ip"] );
                console.log("masterHallIp---", masterHallIp);
                if(masterHallIp?.ip == ipOfAgent){
                    console.log("Action taken by master agent", masterHallIp.ip, ipOfAgent);
                    // If only logged in master can take turn then we need to enable this
                    // const sess = socket.request.session;
                    // if (!sess || !sess?.login) {
                    //     return {
                    //         status: 'fail',
                    //         result: null,
                    //         message: await translate({key: "no_permission", language: language}), // 'You do not have permission to access.',
                    //         statusCode: 400
                    //     }
                    // }
                }else{
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "no_permission", language: language}), // 'You do not have permission to access.',
                        statusCode: 400
                    }
                }
            }
            
            // Dont allow to take turn when game is paused
            if (room[0].otherData?.gameSecondaryStatus == "running" && room[0].otherData?.isPaused == true) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "wait_to_take_turn_as_game_paused", language: language}), // 'You are not Eligible to play Wheel of Fortune!',
                    statusCode: 400
                }
            }

            let isUpdated = await Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId, "otherData.isMinigameFinished": false }, {
                $set: {
                    'otherData.isMinigamePlayed': true,
                    'otherData.isMinigameFinished': true,
                    //'otherData.gameSecondaryStatus': 'finish'
                }
            });
            console.log("isUpdated---", isUpdated.modifiedCount)
            if(isUpdated && isUpdated.modifiedCount == 0){
                return false;
            }

            if(room[0].winners.length > 0){
                if(isPlayedByAdmin == false && isAutoTurn == false){
                    let isIndex = room[0].winners.findIndex((e) =>  (e.playerId ==  data.playerId && e.enabledSpinner == true ) );
                    if(isIndex == -1){
                        console.log("You are not Eligible to play Treasure Chest Game!", data.playerId, data.gameId)
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({key: "no_permission_tchest", language: language}), // 'You are not Eligible to play Treasure Chest!',
                            statusCode: 400
                        }
                    }
                }

                let treasureChestList = await Sys.App.Services.otherGameServices.getByData({ slug: 'treasureChest' });
                console.log("treasureChestList", treasureChestList.treasureChestprizeList)

                let prizeList = treasureChestList.treasureChestprizeList;
                let amount = prizeList[Math.floor(Math.random() * prizeList.length)];
                let tChectWinners = room[0].tChestWinners;
                let afterDistributionAmount = Math.round(exactMath.div(amount, tChectWinners.length) ); //+parseFloat(exactMath.div(amount, tChectWinners.length) ).toFixed(2);
                console.log('\x1b[36m%s\x1b[0m', '----------------------------------------------------------------------');
                console.log('\x1b[36m%s\x1b[0m', '[ Mini Game (Game 1) [ TreasureChest] Winner Amount:- ' + amount + ']', data.playerId, afterDistributionAmount);
                console.log('\x1b[36m%s\x1b[0m', '----------------------------------------------------------------------');
                Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId}, {
                    $set: {
                        'otherData.miniGameResults': [{winningAmount: amount}]
                    },
                }, {  new: true });

                for(let w=0; w < room[0].winners.length; w++){
                    if(room[0].winners[w].isTchest == true){
                        let finalWinningAmount = afterDistributionAmount;
                        let winningTicketColor = room[0].winners[w].ticketColorName;
                        if(winningTicketColor == "Large Yellow" || winningTicketColor == "Small Yellow"){
                            finalWinningAmount = Math.round(2 * afterDistributionAmount); //+parseFloat(2 * afterDistributionAmount).toFixed(2);
                        }
                        console.log("finalWinningAmount of tre chest winners", finalWinningAmount, afterDistributionAmount, winningTicketColor)
                        await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId}, {
                            $set: {
                                'winners.$[current].wonAmount': finalWinningAmount,
                            },
                        }, { arrayFilters: [ {"current.isTchest": true, "current.ticketId": room[0].winners[w].ticketId} ], new: true })
                    
                    }
                }

                let currentPlayerWinningAmount = 0;
                let physicalWinners = [], onlineWinners = [], uniqueWinners = [];
                for(let w=0; w < tChectWinners.length; w++){
                   
                    let finalWinningAmount = afterDistributionAmount;
                    let winningTicketColor = tChectWinners[w].ticketColorName;
                    if(winningTicketColor == "Large Yellow" || winningTicketColor == "Small Yellow"){
                        finalWinningAmount = Math.round(2 * afterDistributionAmount); // +parseFloat(2 * afterDistributionAmount).toFixed(2);
                    }
                    console.log("finalWinningAmount of tre chest", finalWinningAmount, afterDistributionAmount, winningTicketColor)
                    
                    Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId}, {
                        $set: {
                            'tChestWinners.$[current].WinningAmount': finalWinningAmount,
                        },
                    }, { arrayFilters: [ {"current.ticketId": tChectWinners[w].ticketId} ], new: true })
                
                    let ticketId = tChectWinners[w].ticketId;

                    if(tChectWinners[w].playerType == "Physical"){
                        physicalWinners.push({ticketNumber: tChectWinners[w].ticketNumber, winningAmount: +finalWinningAmount});
                    }else{
                        let transactionDataSend = {
                            playerId: tChectWinners[w].playerId,
                            playerName: tChectWinners[w].playerName,
                            gameId: data.gameId,
                            transactionSlug: "TChestPrizeGame1",
                            action: "credit",
                            purchasedSlug: "realMoney",
                            gameNumber: room[0].gameNumber,
                            gameType: room[0].gameType,
                            totalAmount: +finalWinningAmount,
                            //previousBalance: +player.points.toFixed(4),
                            variantGame: room[0].subGames[0].gameName,
                            ticketPrice: tChectWinners[w].ticketPrice,
                            ticketColorType: tChectWinners[w].ticketColorName,
                            ticketNumber:  tChectWinners[w].ticketNumber,
                            hall: {
                                id: tChectWinners[w].hallId,
                                name: tChectWinners[w].hallName
                            },
                            groupHall: {
                                id: tChectWinners[w].groupHallId,
                                name: tChectWinners[w].groupHallName
                            }
                        }
                        Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend); 
                        Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                            type: "winning",
                            playerId: tChectWinners[w].playerId,
                            hallId: tChectWinners[w].hallId,
                            winning: +finalWinningAmount
                        });
                        await updatePlayerHallSpendingData({ playerId: tChectWinners[w].playerId, hallId: tChectWinners[w].hallId, amount: +finalWinningAmount, type: 'normal', gameStatus: 3 });
                        if(tChectWinners[w].playerType == "Online"){
                            onlineWinners.push({ticketNumber: tChectWinners[w].ticketNumber, winningAmount: +finalWinningAmount});
                        }else{
                            uniqueWinners.push({ticketNumber: tChectWinners[w].ticketNumber, winningAmount: +finalWinningAmount});
                        }
                    }
                
                    Sys.Game.Game1.Services.GameServices.updateTicket({_id: ticketId, playerIdOfPurchaser: tChectWinners[w].playerId }, { $push: { "tChestWinners": {playerId: tChectWinners[w].playerId,WinningAmount: (+finalWinningAmount), ticketId: ticketId} },  $inc: { totalWinningOfTicket: +parseFloat(finalWinningAmount).toFixed(2), "winningStats.finalWonAmount": +parseFloat(finalWinningAmount).toFixed(2) }  });
                    Sys.Game.Game1.Services.GameServices.updateTicketNested({_id: ticketId}, {
                        $inc: {
                            'winningStats.lineTypeArray.$[current].wonAmount': +finalWinningAmount,
                            'otherData.winningStats.$[current].wonAmount': +finalWinningAmount
                        },
                    }, { arrayFilters: [ {"current.lineType": "Full House"} ], new: true });
                   
                    if((+finalWinningAmount) > 0){
                        await Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId }, { $inc: { totalWinning: (+finalWinningAmount), finalGameProfitAmount: -(+finalWinningAmount) } });
                    }

                    if(data.playerId == tChectWinners[w].playerId){
                        currentPlayerWinningAmount +=  (+parseFloat(finalWinningAmount).toFixed(2) );
                    }
                }

                let latestRoom = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, {tChestWinners: 1, winners: 1});
                let tChectWinnersUpdated = latestRoom[0].tChestWinners;

                // handle GameFinishAdmin broadcas
                const adminResult = await sendWinnersScreenToAdmin(data.gameId, room[0].gameName, latestRoom[0].winners, room[0].withdrawNumberArray.length, true, false);
                console.log("openTreasureChest broadcast--", JSON.stringify({
                    gameId: data.gameId,
                    amount: amount,
                    playerFinalWinningAmount: +currentPlayerWinningAmount,
                    miniGameType: "treasureChest",
                    winningTicketNumbers: {physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners},
                    winningScreen: adminResult
                }));
                Sys.Io.of(Sys.Config.Namespace.Game1).to(data.gameId).emit('openTreasureChest', {
                    gameId: data.gameId,
                    //amount: +currentPlayerWinningAmount,
                    amount: amount,
                    playerFinalWinningAmount: +currentPlayerWinningAmount,
                    miniGameType: "treasureChest",
                    winningTicketNumbers: {physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners},
                    winningScreen: adminResult
                });



                if(tChectWinnersUpdated.length > 0){
                    let newArray = tChectWinnersUpdated.map(object => ({ ...object }))
                    let winnerPlayerPatternWise = Object.values(newArray.reduce(function(r, e) {
                        let key = e.playerId;
                        if (!r[key]) r[key] = e;
                        else {
                          r[key].WinningAmount += e.WinningAmount;
                        }
                        return r;
                    }, {}))
                    console.log("winnerPlayerPatternWise", winnerPlayerPatternWise, tChectWinnersUpdated)
                    let bulkArr = [];
                    for(let w=0; w < winnerPlayerPatternWise.length; w++){
                        let currentPlayer = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: winnerPlayerPatternWise[w].playerId}, {username: 1, walletAmount: 1, enableNotification: 1, socketId: 1, firebaseToken: 1, selectedLanguage: 1});
                        if(currentPlayer){
                            let message =  { en: await translate({key: "tc_winner", language: 'en', isDynamic: true, number: room[0].gameNumber, number1: room[0].gameName, number2: (+ parseFloat(winnerPlayerPatternWise[w].WinningAmount).toFixed(2) ) }), 
                                            nor: await translate({key: "tc_winner", language: 'nor', isDynamic: true, number: room[0].gameNumber, number1: room[0].gameName, number2: (+ parseFloat(winnerPlayerPatternWise[w].WinningAmount).toFixed(2) )  }) };  
                            //room[0].gameNumber + " [ " + room[0].gameName + " ] Congratulations! You have won " + (+ parseFloat(winnerPlayerPatternWise[w].WinningAmount).toFixed(2) ) + " Kr In Treasure Chest. ";
                            let notification ={
                                notificationType:'winning',
                                message: message
                            }
        
                            bulkArr.push({
                                insertOne: {
                                    document: {
                                        playerId: winnerPlayerPatternWise[w].playerId,
                                        gameId:room[0]._id,
                                        notification: notification
                                    }
                                }
                            });
        
                            await Sys.Io.to(currentPlayer.socketId).emit('NotificationBroadcast', {
                                notificationType: notification.notificationType,
                                message: notification.message[currentPlayer.selectedLanguage]
                            });
                
                            // if(currentPlayer.firebaseToken){
                            //     let message = {
                            //         notification: {
                            //             title: "Spillorama",
                            //             body: message[currentPlayer.selectedLanguage]
                            //         },
                            //         token : currentPlayer.firebaseToken
                            //     };
                            //     Sys.Helper.gameHelper.sendWinnersNotifications(message);
                            // }
                        }
                    }
                    Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkArr);
                }

                // Refresh game on finish
                await refreshGameOnFinish(room[0]._id, room[0]?.halls, room[0]?.parentGameId);

                let result = {
                    actualTChestWinningPrize: amount,
                    winningPrize: +currentPlayerWinningAmount,  // this is a prize after 2X for yellow tickets
                    isWinningInPoints: false
                }
                return {
                    status: 'success',
                    result: result,
                    message: await translate({key: "tc_winner_already", language: language, isDynamic: true, number:  +currentPlayerWinningAmount})   //"Congratulations! You have won " + +currentPlayerWinningAmount +" Kr In Treasure Chest."
                }

            }

            return {
                status: 'fail',
                result: null,
                message: await translate({key: "something_went_wrong", language: language}), //'Something Went Wrong!',
                statusCode: 400
            }  
        } catch (error) {
            console.log("Error in SelectTreasureChest Game4 : ", error);
            return new Error(error);
        }
    },

    patternListing: async function(gameId, room = null){
        try{
            console.log("update remaining patterns broadcast")
            if(!room){
                room = await getGameDataFromRedisHmset('game1', gameId,["winners","subGames","gameName","earnedFromTickets","parentGameId","jackpotPrize","jackpotDraw","withdrawNumberList","_id"]);
                console.log('patternListing room',room);
                if(!room._id){
                    room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {winners: 1, subGames: 1, gameName: 1, earnedFromTickets: 1, parentGameId: 1, jackpotPrize: 1, jackpotDraw: 1, withdrawNumberList: 1});
                    if (!room) {
                        return {
                            patternList: [],
                            jackPotData: { isDisplay: false }
                        }
                    }
                }
            }
            
            let patternListTemp = Object.keys(room.subGames[0].options[0].winning);
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
            let jackPotData = { isDisplay: false };
            if(patternListTemp.length > 0){
                for(let p=0; p< patternListTemp.length; p++){
                    if(patternListTemp[p] == "Row 1" ){ patternList.push({name: "Row 1", patternDesign : 1, patternDataList: [], amount: Math.round( getHighestPrice("Row 1") ), message: "", isWon: false, prizeArray: [] }) }
                    else if(patternListTemp[p] == "Row 2"){ patternList.push({name: "Row 2", patternDesign : 2, patternDataList: [], amount: Math.round( getHighestPrice("Row 2") ), message: "", isWon: false, prizeArray: [] }) }
                    else if(patternListTemp[p] == "Row 3"){ patternList.push({name: "Row 3", patternDesign : 3, patternDataList: [], amount: Math.round( getHighestPrice("Row 3") ), message: "", isWon: false, prizeArray: [] }) }
                    else if(patternListTemp[p] == "Row 4"){ patternList.push({name: "Row 4", patternDesign : 4, patternDataList: [], amount: Math.round( getHighestPrice("Row 4") ), message: "", isWon: false, prizeArray: [] }) }
                    else if(patternListTemp[p] == "Picture"){patternList.push({name: "Picture", patternDesign : 0, patternDataList: [0,0,0,0,0, 0,1,1,1,0, 0,1,1,1,0, 0,1,1,1,0, 0,0,0,0,0], amount: Math.round( getHighestPrice("Picture") ), message: "", isWon: false, prizeArray: [] }) }
                    else if(patternListTemp[p] == "Frame"){patternList.push({name: "Frame", patternDesign : 0, patternDataList: [1,1,1,1,1, 1,0,0,0,1, 1,0,1,0,1, 1,0,0,0,1, 1,1,1,1,1], amount: Math.round( getHighestPrice("Frame") ), message: "", isWon: false, prizeArray: [] }) }
                    else if(patternListTemp[p] == "Full House"){
                        let winningAmount = 0;
                        let message = "";
                        const totalWithdrawCount = room.withdrawNumberList.length;
                        let prizeArray = [];

                        const setJackpotData = (draw, amount, isDisplay, prizeArray = []) => {
                            jackPotData = {
                                draw,
                                winningAmount: +amount,
                                isDisplay,
                                tvScreenWinningAmount: +amount,
                                isDisplayOnTVScreen: true,
                                prizeArray
                            };
                        };

                        switch (room.gameName) {
                            case "Jackpot":
                                message = "Jackpot Winning";
                                if (totalWithdrawCount < (+room.jackpotDraw + 1)) {
                                    winningAmount = Math.max(...Object.values(room.jackpotPrize));
                                    prizeArray = await getAllJackpotPrizes({jackpotPrize: room.jackpotPrize, ticketColorTypes: room.subGames[0].ticketColorTypes});
                                    if(prizeArray.length == 0){
                                        prizeArray = Object.values(room.jackpotPrize);
                                    }
                                    prizeArray = prizeArray.sort((a, b) => a - b);
                                    setJackpotData(room.jackpotDraw, winningAmount, true, prizeArray);
                                }else{
                                    winningAmount = getHighestPrice("Full House");
                                    prizeArray = [...new Set(
                                        room.subGames.flatMap(g => g.options.map(o => +o.winning["Full House"]))
                                    )];
                                    prizeArray = prizeArray.sort((a, b) => a - b);
                                    setJackpotData(room.jackpotDraw, winningAmount, false, prizeArray);
                                }
                                break;

                            case "Wheel of Fortune":
                            case "Treasure Chest": {
                                const slug = room.gameName === "Wheel of Fortune" ? "wheelOfFortune" : "treasureChest";
                                message = room.gameName === "Wheel of Fortune" ? "Spin Wheel of Fortune to Win" : "Open Treasure Chest to Win";

                                const { [`${slug}prizeList`]: prizeList } = await Sys.App.Services.otherGameServices.getByData({ slug });
                                winningAmount = room.gameName === "Treasure Chest"
                                    ? exactMath.mul(Math.max(...prizeList), 2) // double for Treasure Chest
                                    : Math.max(...prizeList);  
                                break;
                            }

                            case "Oddsen 56":
                            case "Oddsen 57":
                            case "Oddsen 58": {
                                const ballCount = parseInt(room.gameName.split(" ")[1], 10);
                                const oddsenPrize = getHighestPrice(`Full House Within ${ballCount} Balls`);
                                const fullHousePrize = getHighestPrice("Full House");
                                
                                if (totalWithdrawCount < (ballCount + 1)) {
                                    winningAmount = Math.max(oddsenPrize, fullHousePrize, true);
                                    prizeArray = [...new Set(
                                        room.subGames.flatMap(g => g.options.map(o => +o.winning[`Full House Within ${ballCount} Balls`]))
                                    )];
                                    prizeArray = prizeArray.sort((a, b) => a - b);
                                    setJackpotData(ballCount, oddsenPrize, true, prizeArray);
                                }else{
                                    winningAmount = fullHousePrize;
                                    prizeArray = [...new Set(
                                        room.subGames.flatMap(g => g.options.map(o => +o.winning["Full House"]))
                                    )];
                                    prizeArray = prizeArray.sort((a, b) => a - b);
                                    setJackpotData(room.jackpotDraw, winningAmount, false, prizeArray);
                                }
                                break;
                            }

                            case "Innsatsen": {
                                const { innsatsenSales } = await Sys.App.Services.scheduleServices.getSingleDailySchedulesData(
                                    { _id: room.parentGameId }, 
                                    { innsatsenSales: 1 }
                                );

                                const innBeforeSales = +parseFloat(innsatsenSales ?? 0).toFixed(2);
                                const fullHousePrize = +parseFloat(room.subGames[0].options[0].winning["Full House"]).toFixed(2);

                                if (totalWithdrawCount < (+room.jackpotDraw + 1)) {
                                    winningAmount = Math.min(2000, (parseFloat(innBeforeSales) + parseFloat(fullHousePrize)));
                                    setJackpotData(room.jackpotDraw, winningAmount, true);
                                }else{
                                    winningAmount = fullHousePrize;
                                    setJackpotData(room.jackpotDraw, winningAmount, false);
                                }
                                break;
                            }

                            case "Mystery": {
                                const { mysteryPrizeList } = await Sys.App.Services.otherGameServices.getByData({ slug: "mystery" });
                                winningAmount = exactMath.mul(Math.max(...mysteryPrizeList), 2);
                                
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
                       
                        console.log("Winning amount without rounding", winningAmount);
                        winningAmount = Math.round(winningAmount);
                        console.log("Winning amount after rounding", winningAmount);
                        patternList.push({name: "Full House", patternDesign : 0, patternDataList: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], amount: winningAmount, message: message, isWon: false, prizeArray}) 
                    }
                }
            }
            return {
                patternList: patternList,
                jackPotData
            }
        }catch(e){
            console.log("Error in patternListing : ", e);
            return {
                patternList: []
            }
        }
    },

    setMysteryData: async function(data) {
        try {
            let language = "nor";
            if(data.language){
                language = data.language;
            }
            if(data.gameId){
                let room = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, {mystryWinners: 1, gameNumber: 1, gameType: 1, subGames: 1, winners: 1});
                //console.log("room--", room);
                if(room.length > 0){
                    let mysteryList = await Sys.App.Services.otherGameServices.getByData({ slug: 'mystery' });
                    
                    let FinalValue = [];
                    let allValue = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

                    function shuffle(array) {
                        array.sort(() => fortuna.random() - 0.5);
                    }
                    for (let i = 0; i < 2; i++) {
                        let numVals;
                        if (FinalValue.length > 0) {
                            shuffle(allValue);
                            numVals = allValue.join('');
                        } else {
                            numVals = Math.floor(10000 + fortuna.random() * 90000);
                            numVals = numVals.toString();
                            let values = [...numVals];
                            for (let j = 0; j < values.length; j++) {
                                let index = allValue.indexOf(Number(values[j]));
                                allValue.splice(index, 1);
                            }
                        }
                        FinalValue.push(numVals);
                    }
                    console.log("FinalValue: ", FinalValue);

                    let randomJocker = fortuna.random();
                    console.log("randomJocker value--", randomJocker)
                    if(randomJocker > 0.90){
                        let randomIndex = Math.floor(fortuna.random() * (4 - 0) + 0);
                        console.log("randomJocker random index", randomIndex)

                        let val1  = String(FinalValue[0]).split("").map((num)=>{
                            return Number(num)
                        })
                        let val2 = String(FinalValue[1]).split("").map((num)=>{
                            return Number(num)
                        })
                        val2[randomIndex] = val1[randomIndex];
                        FinalValue[0] = val1.join('');
                        FinalValue[1] = val2.join('');
                    }
                    console.log("final numebr after jocket index", FinalValue[0], FinalValue[1])

                    let result = {
                        prizeList: mysteryList.mysteryPrizeList,
                        middleNumber: FinalValue[1],
                        resultNumber: FinalValue[0],
                    }
                    console.log("result--", result);
                    await Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId }, {
                        $set: {
                            'otherData.mysteryGameResults': result,
                        }
                    });
                    return {
                        status: 'success',
                    }
                }
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "something_went_wrong", language: language}), // 'Something Went Wrong!',
                    statusCode: 400
                }
            }
            return {
                status: 'fail',
                result: null,
                message: await translate({key: "something_went_wrong", language: language}), // 'Something Went Wrong!',
                statusCode: 400
            }
            
        } catch (error) {
            console.log("Error in MysteryGameData Game1 : ", error);
            return {
                status: 'fail',
                result: null,
                message: await translate({key: "something_went_wrong", language: language}), // 'Something Went Wrong!',
                statusCode: 400
            }
        }
    },

    mysteryGameData: async function(socket, data) {
        try {
            let language = "nor";
            if(data.language){
                language = data.language;
            }
            console.log("MysteryGameData: ", data);
            if(data.playerType == "Real"){
                let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: data.playerId}, {status: 1, username: 1, selectedLanguage: 1});
                if (!player) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "player_not_found", language: language}), // 'No Player Found!',
                        statusCode: 401
                    }
                }
                language = player.selectedLanguage;
            }
            if(!data.gameId){
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "something_went_wrong", language: language}), // 'Something Went Wrong!',
                    statusCode: 400
                }
            }
            let room = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, {otherData: 1, status: 1});
            const isSpinByAdmin = room[0].otherData?.isSpinByAdmin;
            if(room.length > 0 && room[0].otherData && room[0].status == "finish"){
                console.log("result", room[0].otherData.mysteryGameResults)
                let currentTurnCountTimer = 10;
                if(room[0].otherData.mysteryTurnCounts >= 0 && isSpinByAdmin == false){
                
                    if (Timeout.exists(room[0]._id.toString())) {
                        let currentTurnCountTimerTemp = Timeout.remaining(room[0]._id.toString());
                        if(currentTurnCountTimerTemp){
                            currentTurnCountTimer = Math.ceil(currentTurnCountTimerTemp/1000);
                        }
                        console.log("timeout remianing of minigames", currentTurnCountTimer)
                    }

                }
                console.log("first and second timer of mysterygame", currentTurnCountTimer)
                return {
                    status: 'success',
                    result: {
                        prizeList: room[0].otherData.mysteryGameResults.prizeList,
                        middleNumber: room[0].otherData.mysteryGameResults.middleNumber,
                        autoTurnMoveTime: isSpinByAdmin ? 0 : 10,
                        autoTurnReconnectMovesTime: isSpinByAdmin ? 0 : (room[0].otherData?.isMinigameFinished == true ? 0 : currentTurnCountTimer),
                        mysteryGameData: {
                            history: room[0].otherData.mysteryHistory,
                            turnCounts: ("mysteryTurnCounts" in room[0].otherData) ? room[0].otherData.mysteryTurnCounts: 0, 
                        },
                        showAutoTurnCount: isSpinByAdmin ? false : true,
                        isGamePaused: room[0].otherData?.isPaused
                    },
                    message: 'Game 1 MysteryGameData..!!'
                }
                
            }
            return {
                status: 'fail',
                result: null,
                message: await translate({key: "something_went_wrong", language: language}), // 'Something Went Wrong!',
                statusCode: 400
            }
        } catch (error) {
            console.log("Error in MysteryGameData Game1 : ", error);
            return {
                status: 'fail',
                result: null,
                message: await translate({key: "something_went_wrong", language: language}), // 'Something Went Wrong!',
                statusCode: 400
            }
        }
    },

    selectMysteryAuto: async function(socket, data) {
        try {
            let language = "nor";
            if(data.language){
                language = data.language;
            }
            console.log("selectMysteryAuto: ", data);
            if(data.turnCount > 5){
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "something_went_wrong", language: language}), //'Something Went Wrong!',
                    statusCode: 400
                }  
            }
            let isPlayedByAdmin  = false;
            let isAutoTurn = false;
            if(data.playerType == "Real"){
                let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: data.playerId}, {status: 1, username: 1, selectedLanguage: 1});
                if (!player) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "player_not_found", language: language}), //'No Player Found!',
                        statusCode: 401
                    }
                }
                language = player.selectedLanguage;
            }else if(data.playerType == "Admin"){
                isPlayedByAdmin = true;
                language = "en";
            }else if(data.playerType == "Auto"){
                isAutoTurn = true;
            }
           
            let room = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, {mystryWinners: 1, gameNumber: 1, gameType: 1, subGames: 1, winners: 1, gameName: 1, otherData: 1});
        
            if (room.length == 0) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "game_not_found", language: language}), // 'Game Not Found!',
                    statusCode: 400
                }
            }
            
            // Dont allow to take turn when game is paused
            if (room[0].otherData?.gameSecondaryStatus == "running" && room[0].otherData?.isPaused == true) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "wait_to_take_turn_as_game_paused", language: language}), // 'You are not Eligible to play Wheel of Fortune!',
                    statusCode: 400
                }
            }

            if(isPlayedByAdmin == true){
                if(room[0].otherData?.isSpinByAdmin == false){
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "no_permission", language: language}), // 'You do not have permission to access.',
                        statusCode: 400
                    }
                } 
                // check if action taken is by master agent
                let ipOfAgent = getPlayerIp(socket);
                let masterHallId =  room[0].otherData.masterHallId;
                console.log("ipOfAgent and masterHallId", ipOfAgent, masterHallId)
                if(!ipOfAgent || !masterHallId){
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "no_permission", language: language}), // 'You do not have permission to access.',
                        statusCode: 400
                    }
                }
                let  masterHallIp = await Sys.App.Services.HallServices.getSingleHallData({_id: masterHallId }, ["ip"] );
                console.log("masterHallIp---", masterHallIp);
                if(masterHallIp?.ip == ipOfAgent){
                    console.log("Action taken by master agent", masterHallIp.ip, ipOfAgent);
                    // If only logged in master can take turn then we need to enable this
                    // const sess = socket.request.session;
                    // if (!sess || !sess?.login) {
                    //     return {
                    //         status: 'fail',
                    //         result: null,
                    //         message: await translate({key: "no_permission", language: language}), // 'You do not have permission to access.',
                    //         statusCode: 400
                    //     }
                    // }
                }else{
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "no_permission", language: language}), // 'You do not have permission to access.',
                        statusCode: 400
                    }
                }
            }

            if(room[0].winners.length > 0){
                console.log("isPlayedByAdmin & isAutoTurn", isPlayedByAdmin, isAutoTurn)
                if(isPlayedByAdmin == false && isAutoTurn == false){
                    let isIndex = room[0].winners.findIndex((e) =>  (e.playerId ==  data.playerId && e.enabledSpinner == true ) );
                    if(isIndex == -1){
                        console.log("You are not Eligible to play Mystery game!", data.playerId, data.gameId)
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({key: "no_permission_mys", language: language}), // 'You are not Eligible to play Mystery!',
                            statusCode: 400
                        }
                    }
                }

                let isGameUpdated = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId, "otherData.mysteryTurnCounts": +(+data.turnCount -1) }, {
                    $inc: {
                        'otherData.mysteryTurnCounts': 1,
                    }
                }, { new: true });
                //console.log("isGameUpdated---", isGameUpdated)
                if(!isGameUpdated){
                    console.log("Turn already taken")
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "this_turn_has_already_been_taken", language: language}), // 'Something Went Wrong!',
                        statusCode: 400
                    } 
                }

                let winningNumbers = room[0].otherData.mysteryGameResults.resultNumber.toString();
                console.log("winningNumners", winningNumbers);
                let selectedNumber = winningNumbers.charAt(winningNumbers.length - +data.turnCount);
                
                let lastSelectedNumbers = [];
                let resultNumberArray = winningNumbers.split("", 5).reverse();
                if(data.turnCount > 1){
                    for(let i=0; i< data.turnCount-1; i++){
                        lastSelectedNumbers.push(resultNumberArray[i])
                    }
                }
                
                let originalDisplayedNUmber = room[0].otherData.mysteryGameResults.middleNumber.toString();
                console.log("originalDisplayedNUmber", originalDisplayedNUmber);
                let originalIndexNumber = originalDisplayedNUmber.charAt(originalDisplayedNUmber.length - +data.turnCount);
                console.log("originalIndexNumber", originalIndexNumber);

                if(isAutoTurn == true){
                    if(originalIndexNumber >= 5){
                        data.isHigherNumber = false;
                    }else{
                        data.isHigherNumber = true;
                    }   
                    
                }
                console.log("isHigherNumber", data.isHigherNumber);
                let isWon = false;
                let isJocker = false;
                if(selectedNumber == originalIndexNumber){
                    isWon = true;
                    isJocker = true;
                }else{
                    if(data.isHigherNumber == true ){
                        if(selectedNumber > originalIndexNumber){
                            isWon = true;
                        }
                    }else{
                        if(selectedNumber < originalIndexNumber){
                            isWon = true;
                        }
                    }
                }   
                let isUpdated = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId, "otherData.mysteryTurnCounts": (+data.turnCount) }, {
                    $push: {
                        'otherData.mysteryHistory': {
                            playerId: data.playerId,
                            isWon: isWon,
                            isJocker: isJocker,
                            baseNumber: originalIndexNumber,
                            selectedNumber: selectedNumber,
                            isHigherNumber: data.isHigherNumber,
                        },
                    }
                }, {new: true});

                console.log("selectedNumber---", selectedNumber, lastSelectedNumbers);
                await Sys.Io.of(Sys.Config.Namespace.Game1).to(data.gameId).emit('selectMysteryBall', {
                    gameId: data.gameId,
                    selectedNumber: selectedNumber,
                    isHigherNumber: data.isHigherNumber,
                    lastSelectedNumbers: lastSelectedNumbers,
                    miniGameType: "Mystery",
                    turnCount: data.turnCount
                });

                if(isJocker == true || isUpdated.otherData.mysteryHistory.length >= 5){
                    module.exports.mysteryGameFinished(null, {playerId: data.playerId, gameId: data.gameId, playerType: data.playerType, turnCount: data.turnCount});
                }else if(isUpdated.otherData?.isSpinByAdmin == false){
                    Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId }, {
                        $set: {
                            'otherData.mysteryStartTimeMs': (new Date()).getTime(),
                        }
                    });

                    let tempIndex = Sys.Timers.indexOf(data.gameId.toString());
                    if (tempIndex !== -1) {
                        if (Timeout.exists(data.gameId.toString())) {
                            console.log("timeout already exists check in new timer set up", data.gameId.toString())
                            Timeout.clear(Sys.Timers[tempIndex], erase = true);
                        }
                        Sys.Timers.splice(tempIndex, 1);
                    }
                    let indexId = Sys.Timers.push(data.gameId.toString());
                    console.log("indexId---", indexId);

                    Timeout.set(Sys.Timers[(indexId - 1)], async () => {
                        try {
                            let index = Sys.Timers.indexOf(data.gameId.toString());
                            if (index !== -1) {
                                Timeout.clear(Sys.Timers[index], erase = true);
                                Sys.Timers.splice(index, 1);
                            }

                            let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, {otherData: 1});
                            console.log("room in mystery game turnCount", room, room.otherData.mysteryTurnCounts)
                            if(room && room.otherData.isMinigameFinished == false){
                                module.exports.selectMysteryAuto(null, {playerId: data.playerId, gameId: data.gameId, playerType: "Auto", turnCount: +data.turnCount+1, isHigherNumber: true});
                            }else{
                                return false;
                            }
                        } catch (e) {
                            console.log("error in timeout of game 1 start", e);
                        }

                    }, ( 10000 ));

                }

                return {
                    status: 'success',
                }
            }

            return {
                status: 'fail',
                result: null,
                message: await translate({key: "something_went_wrong", language: language}), // 'Something Went Wrong!',
                statusCode: 400
            }  
        } catch (error) {
            console.log("Error in selectMysteryAuto Game1 : ", error);
            return {
                status: 'fail',
                result: null,
                message: await translate({key: "something_went_wrong", language: language}), // 'Something Went Wrong!',
                statusCode: 400
            }  
        }
    },

    mysteryGameFinished: async function(socket, data) {
        try {
            let language = "nor";
            if(data.language){
                language = data.language;
            }
            console.log("MysteryGameFinished called: ", data);
            
            let isPlayedByAdmin  = false;
            if(data.playerType == "Real"){
                let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: data.playerId}, {status: 1, username: 1, selectedLanguage: 1});
                if (!player) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "player_not_found", language: language}), //'No Player Found!',
                        statusCode: 401
                    }
                }
                language = player.selectedLanguage;
            }else if(data.playerType == "Admin"){
                isPlayedByAdmin = true;
                language = "en";
            }
           
            let room = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, { mystryWinners: 1, gameNumber: 1, gameType: 1, subGames: 1, winners: 1, gameName: 1, otherData: 1, halls : 1, parentGameId: 1, withdrawNumberArray: 1});
        
            if (room.length == 0) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "game_not_found", language: language}), //'Game Not Found!',
                    statusCode: 400
                }
            }

            let isUpdated = await Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId, "otherData.isMinigameFinished": false }, {
                $set: {
                    'otherData.isMinigamePlayed': true,
                    'otherData.isMinigameFinished': true,
                    //'otherData.gameSecondaryStatus': 'finish'
                }
            });

            let winningAmount = 0;
            let winningPrizes = room[0].otherData.mysteryGameResults.prizeList;
            if(winningPrizes.length > 0){
                winningAmount = winningPrizes[0];
                if(room[0].otherData.mysteryHistory.length > 0){
                    let winningIndex = 0;
                    for(let i= 0; i < room[0].otherData.mysteryHistory.length; i++){
                        if(room[0].otherData.mysteryHistory[i].isJocker == true){
                            winningIndex = room[0].otherData.mysteryGameResults.prizeList.length-1;
                            console.log("winningIndex of jocket winner", winningIndex)
                            break;
                        }else{
                            if(room[0].otherData.mysteryHistory[i].isWon == true){
                                winningIndex += 1;
                            }else if(room[0].otherData.mysteryHistory[i].isWon == false){
                                if(winningIndex > 0){
                                    winningIndex -= 1;
                                }
                            }
                        }
                        
                    }
                    console.log("winningIndex of mystery---", winningIndex)
                    winningAmount = room[0].otherData.mysteryGameResults.prizeList[winningIndex];
                }
            }
            
            console.log("Winning of mystery---", winningAmount);

            let mystryWinners = room[0].mystryWinners;
            let afterDistributionAmount = Math.round(exactMath.div(winningAmount, mystryWinners.length) ); //+parseFloat(exactMath.div(amount, tChectWinners.length) ).toFixed(2);
            console.log('\x1b[36m%s\x1b[0m', '----------------------------------------------------------------------');
            console.log('\x1b[36m%s\x1b[0m', '[ Mini Game (Game 1) [ Mystery] Winner Amount:- ' + winningAmount + ']', data.playerId, afterDistributionAmount);
            console.log('\x1b[36m%s\x1b[0m', '----------------------------------------------------------------------');


            for(let w=0; w < room[0].winners.length; w++){
                if(room[0].winners[w].isMys == true){
                    let finalWinningAmount = afterDistributionAmount;
                    let winningTicketColor = room[0].winners[w].ticketColorName;
                    if(winningTicketColor == "Large Yellow" || winningTicketColor == "Small Yellow"){
                        finalWinningAmount = Math.round(2 * afterDistributionAmount); //+parseFloat(2 * afterDistributionAmount).toFixed(2);
                    }
                    console.log("finalWinningAmount of mystery winners", finalWinningAmount, winningTicketColor)
                    await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId}, {
                        $set: {
                            'winners.$[current].wonAmount': finalWinningAmount,
                        },
                    }, { arrayFilters: [ {"current.isMys": true, "current.ticketId": room[0].winners[w].ticketId} ], new: true });
                }
            }

            let currentPlayerWinningAmount = 0;
            let physicalWinners = [], onlineWinners = [], uniqueWinners = [];
            for(let w=0; w < mystryWinners.length; w++){
            
                let finalWinningAmount = afterDistributionAmount;
                let winningTicketColor = mystryWinners[w].ticketColorName;
                if(winningTicketColor == "Large Yellow" || winningTicketColor == "Small Yellow"){
                    finalWinningAmount = Math.round(2 * afterDistributionAmount); // +parseFloat(2 * afterDistributionAmount).toFixed(2);
                }
                console.log("finalWinningAmount of mystery", finalWinningAmount, afterDistributionAmount, winningTicketColor)
                
                Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId}, {
                    $set: {
                        'mystryWinners.$[current].WinningAmount': finalWinningAmount,
                    },
                }, { arrayFilters: [ {"current.ticketId": mystryWinners[w].ticketId} ], new: true })

                let ticketId = mystryWinners[w].ticketId;

                if(mystryWinners[w].playerType == "Physical"){
                    physicalWinners.push({ticketNumber: mystryWinners[w].ticketNumber, winningAmount: +finalWinningAmount});
                }else{
                    let transactionDataSend = {
                        playerId: mystryWinners[w].playerId,
                        playerName: mystryWinners[w].playerName,
                        gameId: data.gameId,
                        transactionSlug: "mysteryPrizeGame1",
                        action: "credit",
                        purchasedSlug: "realMoney",
                        gameNumber: room[0].gameNumber,
                        gameType: room[0].gameType,
                        totalAmount: +finalWinningAmount,
                        //previousBalance: +player.points.toFixed(4),
                        variantGame: room[0].subGames[0].gameName,
                        ticketPrice: mystryWinners[w].ticketPrice,
                        ticketColorType: mystryWinners[w].ticketColorName,
                        ticketNumber:  mystryWinners[w].ticketNumber,
                        hall: {
                            id: mystryWinners[w].hallId,
                            name: mystryWinners[w].hallName
                        },
                        groupHall: {
                            id: mystryWinners[w].groupHallId,
                            name: mystryWinners[w].groupHallName
                        }
                    }
                    Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend); 
                    Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                        type: "winning",
                        playerId: mystryWinners[w].playerId,
                        hallId: mystryWinners[w].hallId,
                        winning: +finalWinningAmount
                    });
                    await updatePlayerHallSpendingData({ playerId: mystryWinners[w].playerId, hallId: mystryWinners[w].hallId, amount: +finalWinningAmount, type: 'normal', gameStatus: 3 });
                    if(mystryWinners[w].playerType == "Online"){
                        onlineWinners.push({ticketNumber: mystryWinners[w].ticketNumber, winningAmount: +finalWinningAmount});
                    }else{
                        uniqueWinners.push({ticketNumber: mystryWinners[w].ticketNumber, winningAmount: +finalWinningAmount});
                    }
                }

                Sys.Game.Game1.Services.GameServices.updateTicket({_id: ticketId, playerIdOfPurchaser: mystryWinners[w].playerId }, { $push: { "mystryWinners": {playerId: mystryWinners[w].playerId,WinningAmount: (+finalWinningAmount), ticketId: ticketId} },  $inc: { totalWinningOfTicket: +parseFloat(finalWinningAmount).toFixed(2), "winningStats.finalWonAmount": +parseFloat(finalWinningAmount).toFixed(2) }  });
                Sys.Game.Game1.Services.GameServices.updateTicketNested({_id: ticketId}, {
                    $inc: {
                        'winningStats.lineTypeArray.$[current].wonAmount': +finalWinningAmount,
                        'otherData.winningStats.$[current].wonAmount': +finalWinningAmount
                    },
                }, { arrayFilters: [ {"current.lineType": "Full House"} ], new: true });
            
                if((+finalWinningAmount) > 0){
                    await Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId }, { $inc: { totalWinning: (+finalWinningAmount), finalGameProfitAmount: -(+finalWinningAmount) } });
                }

                if(data.playerId == mystryWinners[w].playerId){
                    currentPlayerWinningAmount +=  (+parseFloat(finalWinningAmount).toFixed(2) );
                }
            }

            let latestRoom = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, {mystryWinners: 1, winners: 1});
            let mysteryWinnersUpdated = latestRoom[0].mystryWinners;

            // handle GameFinishAdmin broadcas
            const adminResult = await sendWinnersScreenToAdmin(data.gameId, room[0].gameName, latestRoom[0].winners, room[0].withdrawNumberArray.length, true, false);
            
            console.log("broadcast---", JSON.stringify({
                gameId: data.gameId,
                amount: +winningAmount,
                playerFinalWinningAmount: +currentPlayerWinningAmount,
                miniGameType: "Mystery",
                winningTicketNumbers: {physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners},
                winningScreen: adminResult
            }));
            Sys.Io.of(Sys.Config.Namespace.Game1).to(data.gameId).emit('mysteryGameFinishedAdmin', {
                gameId: data.gameId,
                amount: +winningAmount,
                playerFinalWinningAmount: +currentPlayerWinningAmount,
                miniGameType: "Mystery",
                winningTicketNumbers: {physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners},
                winningScreen: adminResult
            });

            if(mysteryWinnersUpdated.length > 0){
                let newArray = mysteryWinnersUpdated.map(object => ({ ...object }))
                let winnerPlayerPatternWise = Object.values(newArray.reduce(function(r, e) {
                    let key = e.playerId;
                    if (!r[key]) r[key] = e;
                    else {
                      r[key].WinningAmount += e.WinningAmount;
                    }
                    return r;
                }, {}))
                console.log("winnerPlayerPatternWise", winnerPlayerPatternWise, mysteryWinnersUpdated)
                let bulkArr = [];
                for(let w=0; w < winnerPlayerPatternWise.length; w++){
                    let currentPlayer = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: winnerPlayerPatternWise[w].playerId}, {username: 1, walletAmount: 1, enableNotification: 1, socketId: 1, firebaseToken: 1, selectedLanguage: 1});
                    if(currentPlayer){
                        let message =  { en: await translate({key: "mystery_winner", language: 'en', isDynamic: true, number: room[0].gameNumber, number1: room[0].gameName, number2: (+ parseFloat(winnerPlayerPatternWise[w].WinningAmount).toFixed(2) ) }), 
                                        nor: await translate({key: "mystery_winner", language: 'nor', isDynamic: true, number: room[0].gameNumber, number1: room[0].gameName, number2: (+ parseFloat(winnerPlayerPatternWise[w].WinningAmount).toFixed(2) )  }) }; 
                        //room[0].gameNumber + " [ " + room[0].gameName + " ] Congratulations! You have won " + (+ parseFloat(winnerPlayerPatternWise[w].WinningAmount).toFixed(2) ) + " Kr In Mystry Game. ";
                        let notification ={
                            notificationType:'winning',
                            message: message
                        }
    
                        bulkArr.push({
                            insertOne: {
                                document: {
                                    playerId: winnerPlayerPatternWise[w].playerId,
                                    gameId:room[0]._id,
                                    notification: notification
                                }
                            }
                        });
    
                        await Sys.Io.to(currentPlayer.socketId).emit('NotificationBroadcast', {
                            notificationType: notification.notificationType,
                            message: notification.message[currentPlayer.selectedLanguage]
                        });
            
                        // if(currentPlayer.firebaseToken){
                        //     let message = {
                        //         notification: {
                        //             title: "Spillorama",
                        //             body: message[currentPlayer.selectedLanguage]
                        //         },
                        //         token : currentPlayer.firebaseToken
                        //     };
                        //     Sys.Helper.gameHelper.sendWinnersNotifications(message);
                        // }

                        Sys.Io.of(Sys.Config.Namespace.Game1).to("/Game1#"+currentPlayer.socketId).emit('mysteryGameFinished', {
                            gameId: data.gameId,
                            amount: +winningAmount,
                            playerFinalWinningAmount: +parseFloat(winnerPlayerPatternWise[w].WinningAmount).toFixed(2),
                            miniGameType: "Mystery",
                        });

                    }
                }
                Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkArr);
            }

            // Refresh game on finish
            await refreshGameOnFinish(room[0]._id, room[0]?.halls, room[0]?.parentGameId);
    
            return {
                status: 'success'
            }
            
        } catch (error) {
            console.log("Error in MysteryGameFinished Game4 : ", error);
            return new Error(error);
        }
    },

    setColorDraftData: async function(data) {
        try {console.log("setColorDraftData called...")
            let language = "nor";
            if(data.language){
                language = data.language;
            }
            if(data.gameId){
                let room = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, {colorDraftWinners: 1, gameNumber: 1, gameType: 1, subGames: 1, winners: 1});
                console.log("room--", room);
                if(room.length > 0){
                    let colordraft = await Sys.App.Services.otherGameServices.getByData({ slug: 'colorDraft' });
                    if(colordraft && colordraft.colordraftPrizeList && colordraft.colordraftPrizeList.length > 0){
                        let i, j, tempi, tempj;
                        for (let i = 0; i < colordraft.colordraftPrizeList.length; i += 1) {
                            j = Math.floor(fortuna.random() * (i + 1));
                            tempi = colordraft.colordraftPrizeList[i];
                            tempj = colordraft.colordraftPrizeList[j];
                            colordraft.colordraftPrizeList[i] = tempj;
                            colordraft.colordraftPrizeList[j] = tempi;
                        }
                    }
                    let result = {
                        prizeList: (colordraft) ? colordraft.colordraftPrizeList : [],
                    }
                    console.log("result--", result);
                    await Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId }, {
                        $set: {
                            'otherData.miniGameResults': result,
                        }
                    });
                    return {
                        status: 'success',
                    }
                }
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "something_went_wrong", language: language}), // 'Something Went Wrong!',
                    statusCode: 400
                }
            }
            return {
                status: 'fail',
                result: null,
                message: await translate({key: "something_went_wrong", language: language}), // 'Something Went Wrong!',
                statusCode: 400
            }
            
        } catch (error) {
            console.log("Error in MysteryGameData Game1 : ", error);
            return {
                status: 'fail',
                result: null,
                message: await translate({key: "something_went_wrong", language: language}), // 'Something Went Wrong!',
                statusCode: 400
            }
        }
    },

    colorDraftGameData: async function(socket, data) {
        try {
            let language = "nor";
            if(data.language){
                language = data.language;
            }
            console.log("colorDraftGameData: ", data);
            if(data.playerType == "Real"){
                let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: data.playerId}, {status: 1, username: 1, selectedLanguage: 1});
                if (!player) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "player_not_found", language: language}), // 'No Player Found!',
                        statusCode: 401
                    }
                }
                language = player.selectedLanguage;
            }
            if(!data.gameId){
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "something_went_wrong", language: language}),// 'Something Went Wrong!',
                    statusCode: 400
                }
            }
            let room = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, {otherData: 1, status: 1});
            console.log("room--", room)
        
            if(room.length > 0 && room[0].otherData && room[0].status == "finish"){
                console.log("result", room[0].otherData.miniGameResults)
                let currentTurnCountTimer = 10;
                const isSpinByAdmin = room[0].otherData?.isSpinByAdmin;
                if(room[0].otherData.mysteryTurnCounts >= 0 && isSpinByAdmin == false){
                    if (Timeout.exists(room[0]._id.toString())) {
                        let currentTurnCountTimerTemp = Timeout.remaining(room[0]._id.toString());
                        if(currentTurnCountTimerTemp){
                            currentTurnCountTimer = Math.ceil(currentTurnCountTimerTemp/1000);
                        }
                        console.log("timeout remianing of minigames", currentTurnCountTimer)
                    }
                }
                console.log("first and second timer of mysterygame", currentTurnCountTimer)
                return {
                    status: 'success',
                    result: {
                        //prizeList: room[0].otherData.miniGameResults,
                        autoTurnMoveTime: isSpinByAdmin ? 0 : 10,
                        autoTurnReconnectMovesTime: isSpinByAdmin ? 0 : (room[0].otherData?.isMinigameFinished == true ? 0 : currentTurnCountTimer),
                        miniGameData: {
                            history: room[0].otherData.miniGameHistory,
                            turnCounts: ("miniGameturnCounts" in room[0].otherData) ? room[0].otherData.miniGameturnCounts: 0, 
                        },
                        showAutoTurnCount: isSpinByAdmin ? false : true,
                        isGamePaused: room[0].otherData?.isPaused
                    },
                    message: 'Game 1 Color Draft data..!!'
                }
                
            }
            return {
                status: 'fail',
                result: null,
                message: await translate({key: "something_went_wrong", language: language}), //'Something Went Wrong!',
                statusCode: 400
            }
        } catch (error) {
            console.log("Error in Color Draft Game1 : ", error);
            return {
                status: 'fail',
                result: null,
                message: await translate({key: "something_went_wrong", language: language}), // 'Something Went Wrong!',
                statusCode: 400
            }
        }
    },

    selectColorDraftAuto: async function(socket, data) {
        try {
            let language = "nor";
            if(data.language){
                language = data.language;
            }
            console.log("selectColorDraftAuto: ", data);
            if(data.turnCount > 3){
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "something_went_wrong", language: language}), // 'Something Went Wrong!',
                    statusCode: 400
                }  
            }
            let isPlayedByAdmin  = false;
            let isAutoTurn = false;
            let alreadySelectedIndexes = [];
            if(data.playerType == "Real"){
                let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: data.playerId}, {status: 1, username: 1, selectedLanguage: 1});
                if (!player) {
                    return {
                        status: 'fail',
                        result: null,
                        message: 'No Player Found!',
                        statusCode: 401
                    }
                }
                language = player.selectedLanguage;
            }else if(data.playerType == "Admin"){
                isPlayedByAdmin = true;
                language = "en";
            }else if(data.playerType == "Auto"){
                isAutoTurn = true;
            }
           
            let room = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, {colorDraftWinners: 1, gameNumber: 1, gameType: 1, subGames: 1, winners: 1, gameName: 1, otherData: 1});
        
            if (room.length == 0) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "game_not_found", language: language}), // 'Game Not Found!',
                    statusCode: 400
                }
            }
            
            // Dont allow to take turn when game is paused
            if (room[0].otherData?.gameSecondaryStatus == "running" && room[0].otherData?.isPaused == true) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "wait_to_take_turn_as_game_paused", language: language}), // 'You are not Eligible to play Wheel of Fortune!',
                    statusCode: 400
                }
            }

            if(room[0].otherData.miniGameHistory && room[0].otherData.miniGameHistory.length >= 3){
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "max_door_cd", language: language}), // 'You can Open maximum 3 doors!',
                    statusCode: 400
                }  
            }else if(room[0].otherData.miniGameHistory && room[0].otherData.miniGameHistory.length == 2){
                if(room[0].otherData.miniGameHistory[0].color == room[0].otherData.miniGameHistory[1].color){
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "not_allow_cd", language: language}), // 'You are not allowed to open 3rd door!',
                        statusCode: 400
                    }  
                }
                for(let h=0; h < room[0].otherData.miniGameHistory.length; h++){
                    alreadySelectedIndexes.push(room[0].otherData.miniGameHistory[h].selectedIndex);
                }
                if(alreadySelectedIndexes.includes(data.selectedIndex) == true ){
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "select_other_door_cd", language: language}), // 'You have already selected that door, please select another!',
                        statusCode: 400
                    }  
                }
            }

            if(isPlayedByAdmin == true){
                if(room[0].otherData?.isSpinByAdmin == false){
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "no_permission", language: language}), // 'You do not have permission to access.',
                        statusCode: 400
                    }
                }
                 // check if action taken is by master agent
                 let ipOfAgent = getPlayerIp(socket);
                 let masterHallId =  room[0].otherData.masterHallId;
                 console.log("ipOfAgent and masterHallId", ipOfAgent, masterHallId)
                 if(!ipOfAgent || !masterHallId){
                     return {
                         status: 'fail',
                         result: null,
                         message: await translate({key: "no_permission", language: language}), // 'You do not have permission to access.',
                         statusCode: 400
                     }
                 }
                 let  masterHallIp = await Sys.App.Services.HallServices.getSingleHallData({_id: masterHallId }, ["ip"] );
                 console.log("masterHallIp---", masterHallIp);
                 if(masterHallIp?.ip == ipOfAgent){
                    console.log("Action taken by master agent", masterHallIp.ip, ipOfAgent);
                    // If only logged in master can take turn then we need to enable this
                    // const sess = socket.request.session;
                    // if (!sess || !sess?.login) {
                    //     return {
                    //         status: 'fail',
                    //         result: null,
                    //         message: await translate({key: "no_permission", language: language}), // 'You do not have permission to access.',
                    //         statusCode: 400
                    //     }
                    // }
                 }else{
                     return {
                         status: 'fail',
                         result: null,
                         message: await translate({key: "no_permission", language: language}), // 'You do not have permission to access.',
                         statusCode: 400
                     }
                 } 
            }

            if(room[0].winners.length > 0){
                console.log("isPlayedByAdmin & isAutoTurn", isPlayedByAdmin, isAutoTurn)
                if(isPlayedByAdmin == false && isAutoTurn == false){
                    let isIndex = room[0].winners.findIndex((e) =>  (e.playerId ==  data.playerId && e.enabledSpinner == true ) );
                    if(isIndex == -1){
                        console.log("You are not Eligible to play Color Draft game!", data.playerId, data.gameId)
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({key: "no_permission_cd", language: language}), // 'You are not Eligible to play Color Draft!',
                            statusCode: 400
                        }
                    }
                }

                let isGameUpdated = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId, "otherData.miniGameturnCounts": +(+data.turnCount -1) }, {
                    $inc: {
                        'otherData.miniGameturnCounts': 1,
                    }
                }, { new: true });
                if(!isGameUpdated){
                    console.log("Turn already taken")
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "this_turn_has_already_been_taken", language: language}), // 'Something Went Wrong!',
                        statusCode: 400
                    } 
                }

                let selectedIndex = data.selectedIndex;
                if(selectedIndex > 12){
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "something_went_wrong", language: language}), // 'Something Went Wrong!',
                        statusCode: 400
                    }
                }
                
                let selectedWinnings = room[0].otherData.miniGameResults.prizeList[+(selectedIndex-1)];
                console.log("selectedWinnings", room[0].otherData.miniGameResults.prizeList, selectedWinnings)
                let updatedGame = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId, "otherData.miniGameturnCounts": (+data.turnCount) }, {
                    $push: {
                        'otherData.miniGameHistory': {
                            playerId: data.playerId,
                            selectedIndex: selectedIndex,
                            color: selectedWinnings.color,
                            amount: selectedWinnings.amount
                        },
                    }
                }, {new: true});

                
                let isMinigameOver = false;
                if(updatedGame.otherData.miniGameHistory.length == 2){
                    console.log("updatedGame.otherData.miniGameHistory---", updatedGame.otherData.miniGameHistory, updatedGame.otherData.miniGameHistory[0], updatedGame.otherData.miniGameHistory[1])
                    if(updatedGame.otherData.miniGameHistory[0].color == updatedGame.otherData.miniGameHistory[1].color){
                        isMinigameOver = true;
                    }
                }else if(updatedGame.otherData.miniGameHistory.length > 2){
                    isMinigameOver = true;
                }

                console.log("selectedIndex---", selectedIndex, selectedWinnings, updatedGame.otherData);
                await Sys.Io.of(Sys.Config.Namespace.Game1).to(data.gameId).emit('selectColorDraftIndex', {
                    gameId: data.gameId,
                    selectedIndex: selectedIndex,
                    color: selectedWinnings.color,
                    amount: selectedWinnings.amount,
                    miniGameType: "Color Draft",
                    turnCount: data.turnCount,
                    isGameOver: isMinigameOver
                });

                if(isMinigameOver == true || updatedGame.otherData.miniGameHistory.length >= 3){
                    module.exports.colordraftGameFinished(null, {playerId: data.playerId, gameId: data.gameId, playerType: data.playerType, turnCount: data.turnCount});
                    console.log("minigame is finished")
                }else if(updatedGame.otherData?.isSpinByAdmin == false){
                    Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId }, {
                        $set: {
                            'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                        }
                    });

                    let tempIndex = Sys.Timers.indexOf(data.gameId.toString());
                    if (tempIndex !== -1) {
                        if (Timeout.exists(data.gameId.toString())) {
                            console.log("timeout already exists check in new timer set up", data.gameId.toString())
                            Timeout.clear(Sys.Timers[tempIndex], erase = true);
                        }
                        Sys.Timers.splice(tempIndex, 1);
                    }
                    let indexId = Sys.Timers.push(data.gameId.toString());
                    console.log("indexId---", indexId);

                    Timeout.set(Sys.Timers[(indexId - 1)], async () => {
                        try {
                            let index = Sys.Timers.indexOf(data.gameId.toString());
                            if (index !== -1) {
                                Timeout.clear(Sys.Timers[index], erase = true);
                                Sys.Timers.splice(index, 1);
                            }

                            let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, {otherData: 1});
                            console.log("room in Color Draft game turnCount", room, room.otherData.miniGameturnCounts)
                            if(room && room.otherData.isMinigameFinished == false){
                                alreadySelectedIndexes = [];
                                if(room.otherData.miniGameHistory.length > 0){
                                    for(let h=0; h < room.otherData.miniGameHistory.length; h++){
                                        alreadySelectedIndexes.push(room.otherData.miniGameHistory[h].selectedIndex)
                                    }
                                }
                                let allIndex = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
                                allIndex =  allIndex.filter( ( el ) => !alreadySelectedIndexes.includes( el ) );
                                let selectedIndexNew = allIndex[Math.floor(fortuna.random() * allIndex.length)];
                                console.log("remaning indexes and already used and selected new index", allIndex, alreadySelectedIndexes, selectedIndexNew)
                                module.exports.selectColorDraftAuto(null, {playerId: data.playerId, gameId: data.gameId, playerType: "Auto", turnCount: +data.turnCount+1, selectedIndex: selectedIndexNew});
                            }else{
                                return false;
                            }
                        } catch (e) {
                            console.log("error in timeout of game 1 start", e);
                        }

                    }, ( 10000 ));



                }

                return {
                    status: 'success',
                }
            }

            return {
                status: 'fail',
                result: null,
                message: await translate({key: "something_went_wrong", language: language}), // 'Something Went Wrong!',
                statusCode: 400
            }  
        } catch (error) {
            console.log("Error in selectColorDraftAuto Game1 : ", error);
            return {
                status: 'fail',
                result: null,
                message: await translate({key: "something_went_wrong", language: language}), // 'Something Went Wrong!',
                statusCode: 400
            }  
        }
    },

    colordraftGameFinished: async function(socket, data) {
        try {
            let language = "nor";
            if(data.language){
                language = data.language;
            }
            console.log("color draft gameFinished called: ", data);

            let isPlayedByAdmin  = false;
            if(data.playerType == "Real"){
                let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: data.playerId}, {status: 1, username: 1});
                if (!player) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "player_not_found", language: language}), // 'No Player Found!',
                        statusCode: 401
                    }
                }
                language = player.selectedLanguage;
            }else if(data.playerType == "Admin"){
                isPlayedByAdmin = true;
                language = "en";
            }
           
            let room = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, { parentGameId: 1, colorDraftWinners: 1, gameNumber: 1, gameType: 1, subGames: 1, winners: 1, gameName: 1, otherData: 1, halls : 1, withdrawNumberArray: 1});
        
            if (room.length == 0) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({key: "game_not_found", language: language}), // 'Game Not Found!',
                    statusCode: 400
                }
            }

            let isUpdated = await Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId, "otherData.isMinigameFinished": false }, {
                $set: {
                    'otherData.isMinigamePlayed': true,
                    'otherData.isMinigameFinished': true,
                    //'otherData.gameSecondaryStatus': 'finish'
                }
            });

            let winningAmount = 0;
            let colorDraftHistory = room[0].otherData.miniGameHistory;
            if(colorDraftHistory.length > 0){
                if(colorDraftHistory.length == 2){
                    if(colorDraftHistory[0].color == colorDraftHistory[0].color){
                        winningAmount = colorDraftHistory[0].amount;
                    }
                }else if(colorDraftHistory.length == 3){
                    let allColors = [colorDraftHistory[0].color, colorDraftHistory[1].color, colorDraftHistory[2].color];
                    const isUnique = (arrToTest) => arrToTest.length === new Set(arrToTest).size;
                    console.log("check if all 3 coors are unique", isUnique(allColors), allColors)
                    if(isUnique(allColors) == true){
                        winningAmount = +colorDraftHistory[0].amount + +colorDraftHistory[1].amount + +colorDraftHistory[2].amount; 
                    }else{
                        winningAmount = +colorDraftHistory[0].amount + +colorDraftHistory[1].amount;
                    }
                }
            }
            
            console.log("Winning of color draft---", winningAmount);

            let colorDraftWinners = room[0].colorDraftWinners;
            let afterDistributionAmount = Math.round(exactMath.div(winningAmount, room[0].colorDraftWinners.length) ); //+parseFloat(exactMath.div(amount, tChectWinners.length) ).toFixed(2);
            console.log('\x1b[36m%s\x1b[0m', '----------------------------------------------------------------------');
            console.log('\x1b[36m%s\x1b[0m', '[ Mini Game (Game 1) [ Color Draft] Winner Amount:- ' + winningAmount + ']', data.playerId, afterDistributionAmount);
            console.log('\x1b[36m%s\x1b[0m', '----------------------------------------------------------------------');


            for(let w=0; w < room[0].winners.length; w++){
                if(room[0].winners[w].isColorDraft == true){
                    let finalWinningAmount = afterDistributionAmount;
                    console.log("finalWinningAmount of color draft winners", finalWinningAmount)
                    await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId}, {
                        $set: {
                            'winners.$[current].wonAmount': finalWinningAmount,
                        },
                    }, { arrayFilters: [ {"current.isColorDraft": true, "current.ticketId": room[0].winners[w].ticketId} ], new: true });
                }
            }

            let currentPlayerWinningAmount = 0;
            let physicalWinners = [], onlineWinners = [], uniqueWinners = [];
            for(let w=0; w < colorDraftWinners.length; w++){
            
                let finalWinningAmount = afterDistributionAmount;
                
                console.log("finalWinningAmount of color draft", finalWinningAmount, afterDistributionAmount)
                
                Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId}, {
                    $set: {
                        'colorDraftWinners.$[current].WinningAmount': finalWinningAmount,
                    },
                }, { arrayFilters: [ {"current.ticketId": colorDraftWinners[w].ticketId} ], new: true })

                let ticketId = colorDraftWinners[w].ticketId;

                if(colorDraftWinners[w].playerType == "Physical"){
                    physicalWinners.push({ticketNumber: colorDraftWinners[w].ticketNumber, winningAmount: +finalWinningAmount});
                }else{
                    let transactionDataSend = {
                        playerId: colorDraftWinners[w].playerId,
                        playerName: colorDraftWinners[w].playerName,
                        gameId: data.gameId,
                        transactionSlug: "colordraftPrizeGame1",
                        action: "credit",
                        purchasedSlug: "realMoney",
                        gameNumber: room[0].gameNumber,
                        gameType: room[0].gameType,
                        totalAmount: +finalWinningAmount,
                        //previousBalance: +player.points.toFixed(4),
                        variantGame: room[0].subGames[0].gameName,
                        ticketPrice: colorDraftWinners[w].ticketPrice,
                        ticketColorType: colorDraftWinners[w].ticketColorName,
                        ticketNumber:  colorDraftWinners[w].ticketNumber,
                        hall: {
                            id: colorDraftWinners[w].hallId,
                            name: colorDraftWinners[w].hallName
                        },
                        groupHall: {
                            id: colorDraftWinners[w].groupHallId,
                            name: colorDraftWinners[w].groupHallName
                        }
                    }
                    Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend); 
                    Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                        type: "winning",
                        playerId: colorDraftWinners[w].playerId,
                        hallId: colorDraftWinners[w].hallId,
                        winning: +finalWinningAmount
                    });
                    await updatePlayerHallSpendingData({ playerId: colorDraftWinners[w].playerId, hallId: colorDraftWinners[w].hallId, amount: +finalWinningAmount, type: 'normal', gameStatus: 3 });
                    if(colorDraftWinners[w].playerType == "Online"){
                        onlineWinners.push({ticketNumber: colorDraftWinners[w].ticketNumber, winningAmount: +finalWinningAmount});
                    }else{
                        uniqueWinners.push({ticketNumber: colorDraftWinners[w].ticketNumber, winningAmount: +finalWinningAmount});
                    }
                }

                Sys.Game.Game1.Services.GameServices.updateTicket({_id: ticketId, playerIdOfPurchaser: colorDraftWinners[w].playerId }, { $push: { "colorDraftWinners": {playerId: colorDraftWinners[w].playerId,WinningAmount: (+finalWinningAmount), ticketId: ticketId} },  $inc: { totalWinningOfTicket: +parseFloat(finalWinningAmount).toFixed(2), "winningStats.finalWonAmount": +parseFloat(finalWinningAmount).toFixed(2) }  });
                Sys.Game.Game1.Services.GameServices.updateTicketNested({_id: ticketId}, {
                    $inc: {
                        'winningStats.lineTypeArray.$[current].wonAmount': +finalWinningAmount,
                        'otherData.winningStats.$[current].wonAmount': +finalWinningAmount
                    },
                }, { arrayFilters: [ {"current.lineType": "Full House"} ], new: true });
            
                if((+finalWinningAmount) > 0){
                    await Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId }, { $inc: { totalWinning: (+finalWinningAmount), finalGameProfitAmount: -(+finalWinningAmount) } });
                }

                if(data.playerId == colorDraftWinners[w].playerId){
                    currentPlayerWinningAmount +=  (+parseFloat(finalWinningAmount).toFixed(2) );
                }
            }

            let latestRoom = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, {colorDraftWinners: 1, winners: 1});
            let colordraftWinnersUpdated = latestRoom[0].colorDraftWinners;

            // handle GameFinishAdmin broadcas
            const adminResult = await sendWinnersScreenToAdmin(data.gameId, room[0].gameName, latestRoom[0].winners, room[0].withdrawNumberArray.length, true, false);
            
            console.log("broadcast---", JSON.stringify({
                gameId: data.gameId,
                amount: +winningAmount,
                playerFinalWinningAmount: +currentPlayerWinningAmount,
                miniGameType: "Color Draft",
                winningTicketNumbers: {physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners},
                winningScreen: adminResult
            }));
            Sys.Io.of(Sys.Config.Namespace.Game1).to(data.gameId).emit('colordraftGameFinishedAdmin', {
                gameId: data.gameId,
                amount: +winningAmount,
                playerFinalWinningAmount: +currentPlayerWinningAmount,
                miniGameType: "Color Draft",
                winningTicketNumbers: {physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners},
                winningScreen: adminResult
            });

            if(colordraftWinnersUpdated.length > 0){
                let newArray = colordraftWinnersUpdated.map(object => ({ ...object }))
                let winnerPlayerPatternWise = Object.values(newArray.reduce(function(r, e) {
                    let key = e.playerId;
                    if (!r[key]) r[key] = e;
                    else {
                      r[key].WinningAmount += e.WinningAmount;
                    }
                    return r;
                }, {}))
                console.log("winnerPlayerPatternWise", winnerPlayerPatternWise, colordraftWinnersUpdated)
                let bulkArr = [];
                for(let w=0; w < winnerPlayerPatternWise.length; w++){
                    let currentPlayer = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: winnerPlayerPatternWise[w].playerId}, {username: 1, walletAmount: 1, enableNotification: 1, socketId: 1, firebaseToken: 1, selectedLanguage: 1});
                    if(currentPlayer){
                        let message = { en: await translate({key: "cd_winner", language: 'en', isDynamic: true, number: room[0].gameNumber, number1: room[0].gameName, number2: (+ parseFloat(winnerPlayerPatternWise[w].WinningAmount).toFixed(2) ) }), 
                                        nor: await translate({key: "cd_winner", language: 'nor', isDynamic: true, number: room[0].gameNumber, number1: room[0].gameName, number2: (+ parseFloat(winnerPlayerPatternWise[w].WinningAmount).toFixed(2) )  }) };  
                        //room[0].gameNumber + " [ " + room[0].gameName + " ] Congratulations! You have won " + (+ parseFloat(winnerPlayerPatternWise[w].WinningAmount).toFixed(2) ) + " Kr In Color Draft. ";
                        let notification ={
                            notificationType:'winning',
                            message: message
                        }
    
                        bulkArr.push({
                            insertOne: {
                                document: {
                                    playerId: winnerPlayerPatternWise[w].playerId,
                                    gameId:room[0]._id,
                                    notification: notification
                                }
                            }
                        });
    
                        // if(currentPlayer.firebaseToken){
                        //     let message = {
                        //         notification: {
                        //             title: "Spillorama",
                        //             body: message[currentPlayer.selectedLanguage]
                        //         },
                        //         token : currentPlayer.firebaseToken
                        //     };
                        //     Sys.Helper.gameHelper.sendWinnersNotifications(message);
                        // }

                        Sys.Io.of(Sys.Config.Namespace.Game1).to("/Game1#"+currentPlayer.socketId).emit('colordraftGameFinished', {
                            gameId: data.gameId,
                            amount: +winningAmount,
                            playerFinalWinningAmount: +parseFloat(winnerPlayerPatternWise[w].WinningAmount).toFixed(2),
                            miniGameType: "Color Draft",
                        });

                    }
                }
                Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkArr);
            }

            // Refresh game on finish
            await refreshGameOnFinish(room[0]._id, room[0]?.halls, room[0]?.parentGameId);

            return {
                status: 'success'
            }
            
        } catch (error) {
            console.log("Error in colordraftGameFinished Game1 : ", error);
            return new Error(error);
        }
    },

    gameInterval: async function(gameId) {
        try {
            Sys.Log.info("game start interval called")
            const roomId = gameId.toString();
            const timerKey = `${roomId}_timer`;
        
            const cleanup = async () => {
                await cleanTimeAndData(timerKey, 'game1', roomId);
            };
        
            // let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, { players: 1, subGames: 1, seconds: 1, gameName: 1, parentGameId: 1, earnedFromTickets: 1, withdrawNumberArray: 1, withdrawNumberList: 1, jackpotDraw: 1, allHallsId: 1, halls: 1, otherData: 1, status: 1});
            let room = await getGameDataFromRedisHmset('game1', gameId,['players', 'subGames', 'seconds', 'gameName', 'parentGameId', 'earnedFromTickets', 'withdrawNumberArray', 'withdrawNumberList', 'jackpotDraw', 'allHallsId', 'halls', 'otherData', 'status',"_id"]);
            
            if (!room || !room?._id) {
                room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, { players: 1, subGames: 1, seconds: 1, gameName: 1, parentGameId: 1, earnedFromTickets: 1, withdrawNumberArray: 1, withdrawNumberList: 1, jackpotDraw: 1, allHallsId: 1, halls: 1, otherData: 1, status: 1, gameNumber: 1, day: 1, startDate: 1, totalNoPurchasedTickets: 1, luckyNumberPrize: 1, ticketPrice: 1, sequence: 1, trafficLightExtraOptions: 1, winners: 1, earnedFromTickets: 1, ticketsWinningPrices: 1, jackpotPrize: 1, jackpotWinners: 1, gameType: 1, luckyNumberBonusWinners: 1, adminWinners: 1, gameMode: 1});
                if (!room) {
                    await cleanup();
                    return;
                }
                room = await saveGameRedisobj(room);
            }
        
            if (room.status === 'running' && room.otherData?.isPaused) {
                await cleanup();
                return;
            }
        
            if (room.status === 'finish') {
                const minigames = ["Wheel of Fortune", "Treasure Chest", "Mystery", "Color Draft"];
                if (minigames.includes(room.gameName)) {
                    await cleanup();
                    if (!room.otherData?.isMinigameExecuted) {
                        await module.exports.checkForMinigames(gameId);
                    }
                    return;
                }
            }
        
            // ----------------------
            // STEP 1: Prepare Game Data
            // ----------------------
        
            const gameData = {
                ballNumber: [],
                count: room.withdrawNumberArray.length,
                achiveBallArr: [...room.withdrawNumberArray],
                history: [...room.withdrawNumberList],
                nextWithdrawBall: room.otherData?.nextWithdrawBall ?? { number: null, color: null },
                lastBallDrawnTime: null
            };
        
            for (let i = 1; i <= 75; i++) {
                if (!gameData.achiveBallArr.includes(i) && i !== gameData.nextWithdrawBall.number) {
                    gameData.ballNumber.push(i);
                }
            }
            
            // Shuffle the array using Fisher-Yates algorithm with fortuna for randomness
            for (let i = gameData.ballNumber.length - 1; i > 0; i--) {
                const j = Math.floor(fortuna.random() * (i + 1));
                [gameData.ballNumber[i], gameData.ballNumber[j]] = [gameData.ballNumber[j], gameData.ballNumber[i]];
            }
            
            // Select next ball if not already set
            if (!gameData.nextWithdrawBall.number && gameData.ballNumber.length > 0) {
                const chosen = gameData.ballNumber.splice(Math.floor(fortuna.random() * gameData.ballNumber.length), 1)[0];
                gameData.nextWithdrawBall = {
                    number: chosen,
                    color: getBallColor(chosen)
                };
            }
            // console.log("gameData in gameInterval:", JSON.stringify(gameData,null,2));
            await saveGameDataToRedisHmset('game1', roomId, gameData);
        
            // Check if game should be finished and broadcast next ball
            const isGameFinished = await module.exports.checkForGameFinished(roomId);
            
            if(gameData.count >= 75 || isGameFinished){
                await cleanup();
                await module.exports.gameFinished(roomId);
                return;
            }

            if (isGameFinished === false) {
                const currentNumber = gameData.achiveBallArr.length > 0
                    ? gameData.achiveBallArr[gameData.achiveBallArr.length - 1]
                    : null;
            
                // Update database with next ball info
                await Sys.Game.Game1.Services.GameServices.updateGame({ _id: roomId }, {
                    $set: { 'otherData.nextWithdrawBall': gameData.nextWithdrawBall }
                });
                // Broadcast current and next ball info
                await Sys.Io.of(Sys.Config.Namespace.Game1).to(roomId).emit('WithdrawBingoBall', {
                    number: currentNumber,
                    color: currentNumber ? getBallColor(currentNumber) : null,
                    nextNumber: gameData.nextWithdrawBall.number,
                    nextColor: gameData.nextWithdrawBall.color,
                    totalWithdrawCount: gameData.count,
                    isForPlayerApp: false
                });
            }
            
            // Clear any existing timer for this game
            if (Timeout.exists(timerKey)) Timeout.clear(timerKey, erase = true);
        
            // ----------------------
            // STEP 2: Define processNextBall
            // ----------------------
        
            const processNextBall = async () => {
                if (Timeout.exists(timerKey)) Timeout.clear(timerKey, erase = true);
            
                let gameData = await getGameDataFromRedisHmset('game1', roomId);
                console.log("redis game data--", JSON.stringify(gameData?.count))
                if (!gameData) {
                    await cleanup();
                    return;
                }

                // Sys.Log.info(`ballNumber length: ${gameData.ballNumber.length}, GameId: ${gameId}`);
            
                if (gameData.count === 3) {
                    await Sys.Game.Game1.Services.GameServices.updateGameNew(roomId, {
                        $set: { disableTicketPurchase: true }
                    });
                    Sys.App.Controllers.physicalTicketsController.deleteholdSellTicketsOfGame(roomId);
                }
                
                // Check if game should be finished
                let isFinished = false;
                if (gameData.count >= 24) {
                    isFinished = await module.exports.checkForGameFinished(roomId);
                }
    
                // Send Winning notofocations to online player if on previous ball someone won
                onlinePlayersAutoStopOnWinningNotification({gameId: roomId});

                if (gameData.count >= 75 || isFinished) {
                    await cleanup();
                    await module.exports.gameFinished(roomId);
                    return;
                }
                
                // Process current ball (which was the next ball from previous iteration)
                const withdrawBall = gameData.nextWithdrawBall.number;
                const withdrawColor = gameData.nextWithdrawBall.color;
                //const now = Date.now();
            
                gameData.count += 1;
                //gameData.lastBallDrawnTime = now;
                gameData.achiveBallArr.push(withdrawBall);
                gameData.withdrawNumberArray.push(withdrawBall);
                gameData.history.push({
                    number: withdrawBall,
                    color: withdrawColor,
                    totalWithdrawCount: gameData.count
                });
                gameData.withdrawNumberList.push({
                    number: withdrawBall,
                    color: withdrawColor,
                    totalWithdrawCount: gameData.count
                });
            
                // Select new next ball
                if (gameData.ballNumber.length > 0) {
                    const index = Math.floor(fortuna.random() * gameData.ballNumber.length);
                    const nextBall = gameData.ballNumber.splice(index, 1)[0]; // remove and get
                    gameData.nextWithdrawBall = {
                        number: nextBall,
                        color: getBallColor(nextBall)
                    };
                } else {
                    gameData.nextWithdrawBall = {
                        number: withdrawBall,
                        color: withdrawColor
                    };
                }
            
                // await saveGameDataToRedisHmset('game1', roomId, gameData);
            
                await Sys.Game.Game1.Services.GameServices.updateGame({ _id: roomId }, {
                    $set: {
                        withdrawNumberList: gameData.history,
                        withdrawNumberArray: gameData.achiveBallArr,
                        'otherData.nextWithdrawBall': gameData.nextWithdrawBall
                    }
                });

                // Handle special game types at specific ball counts
                // const specialGameCondition = 
                //     (room.gameName == "Jackpot" && gameData.count == (+room.jackpotDraw + 1)) || 
                //     (room.gameName == "Oddsen 56" && gameData.count == 57) || 
                //     (room.gameName == "Oddsen 57" && gameData.count == 58) || 
                //     (room.gameName == "Oddsen 58" && gameData.count == 59) || 
                //     (room.gameName == "Innsatsen" && gameData.count == (+room.jackpotDraw + 1));
            
                const specialRules = {
                    "Jackpot": (room) => +room.jackpotDraw + 1,
                    "Innsatsen": (room) => +room.jackpotDraw + 1,
                    "Oddsen 56": () => 57,
                    "Oddsen 57": () => 58,
                    "Oddsen 58": () => 59,
                    };
                const rule = specialRules[room.gameName];
                const specialGameCondition = rule ? gameData.count === rule(room) : false;
                if(specialGameCondition) {
                    saveGameDataToRedisHmset('game1', roomId, gameData);
                    // let patternRoom = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: roomId }, {winners: 1, subGames: 1, jackpotPrize: 1, jackpotDraw: 1, gameName: 1});
                    let patternRoom = await getGameDataFromRedisHmset('game1', roomId);
                    let {patternList, jackPotData} = await module.exports.patternListing(roomId);
                    const winningCombinations = [...new Set(patternRoom.winners.map(item => item.lineType))];
                    let finalPatternList = [];
                    for(let p=0; p < patternList.length; p++){
                        if( winningCombinations.includes(patternList[p].name) == false ){
                            patternList[p].isWon = false;
                            finalPatternList.push(patternList[p]);
                        }else{
                            patternList[p].isWon = true;
                            finalPatternList.push(patternList[p]);
                        }
                    }
                    //const jackpotFullHousePrize = await getJackpotHighestPrice({allWinningOptions: patternRoom?.subGames[0].options, pattern:'Full House', defaultValue: +patternRoom?.subGames[0].options[0].winning['Full House']});
                    await Sys.Io.of(Sys.Config.Namespace.Game1).to(roomId).emit('PatternChange',  { patternList: finalPatternList, jackPotData  } ); //jackPotData: {draw: patternRoom.jackpotDraw, winningAmount: jackpotFullHousePrize, isDisplay: false, tvScreenWinningAmount: jackpotFullHousePrize, isDisplayOnTVScreen: true}
                }
            
                await Sys.Io.of(Sys.Config.Namespace.Game1).to(roomId).emit('WithdrawBingoBall', {
                    number: withdrawBall,
                    color: withdrawColor,
                    totalWithdrawCount: gameData.count,
                    nextNumber: gameData.nextWithdrawBall.number,
                    nextColor: gameData.nextWithdrawBall.color,
                    isForPlayerApp: true
                });
            
                await Sys.Io.of('admin').emit('balls', {
                    balls: gameData.history,
                    id: roomId
                });
            
                room?.halls?.forEach(hall => {
                    Sys.Io.of('admin').to(hall).emit('onGoingBalls', {
                        balls: gameData.history
                    });
                });

                // Update ball draw time
                // const now = Date.now();
                gameData.lastBallDrawnTime = Date.now();
                saveGameDataToRedisHmset('game1', roomId, gameData);
                Sys.Log.info(`Game 1 ball Drawn--- ${roomId}  ${withdrawBall}`);
            
                await module.exports.checkForWinners(roomId, withdrawBall, gameData.lastBallDrawnTime);
            
                const timeToNext = Math.max((room.seconds * 1000) - (Date.now() - gameData.lastBallDrawnTime), 1000);
                Timeout.set(timerKey, async () => {
                    // const updatedRoom = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: roomId }, { otherData: 1 });
                    const updatedRoom = await getGameDataFromRedisHmset('game1', roomId,["otherData"]);
                    if (!updatedRoom?.otherData?.isPaused) {
                        await processNextBall();
                    } else {
                        Timeout.clear(timerKey, true);
                    }
                }, timeToNext);
            };
        
            // ----------------------
            // STEP 3: Start the interval
            // ----------------------
        
            Timeout.set(timerKey, processNextBall, room.seconds * 1000);
        } catch(e) {
            console.error("error in gameInterval", e);
        }
    },

    stopGame: async function(gameId, language, bySystem = false, isPauseWithoutAnnouncement = false) {
        try{
            let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, { status: 1, otherData: 1, gameName: 1, halls: 1, winners: 1 });
            if (room  && room.otherData.isPaused == false) { //room.status == "running"
                if(room.status == "running"){
                    
                }else if(room.status == "finish"){
                    if(room.gameName == "Wheel of Fortune" || room.gameName == "Treasure Chest" || room.gameName == "Mystery" || room.gameName == "Color Draft"){
                        if( room.otherData.isMinigameActivated == true && room.otherData.gameSecondaryStatus != "finish" && room.otherData.isMinigameFinished != true ){
                            // pause
                            if ( room.gameName === "Wheel of Fortune" || !(await isOnlyPhysicalWinner({ winners: room.winners })) ){// check if only  physical winner
                                if (Timeout.exists(room._id.toString())) {
                                    Timeout.pause(room._id.toString());
                                    console.log(`Paused timeout for game ID: ${room._id}`);
                                } else {
                                    Sys.Log.info("second pause check")
                                    let pauseGameUpdate = await pauseTimeout(room._id.toString());
                                    console.log("pauseGameUpdate status",pauseGameUpdate)
                                    if(pauseGameUpdate && pauseGameUpdate.status == "fail"){
                                        console.log(`No timeout to pause for game ID: ${room._id}`);
                                        return {status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(['something_went_wrong_try_again_later'], language), showSearch: false}
                                    }
                                }
                            } 
                            //return res.send({status: "fail", message: 'You can not pause the game, Minigame already started'})
                        }
                        // else if(room.otherData.isMinigameExecuted == true){
                        //     return res.send({status: "fail", message: 'You can not pause the game, Minigame already started'})
                        // }
                    }else{
                        return {status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(['game_already_finished'], language) }
                    }
                }
                console.log("next iteration called")
                //clearInterval(Sys.GameTimers[room.id]);
               
                // Clear the timer using the room ID as the timer key
                if (Timeout.exists(`${room._id}_timer`)) {
                    Timeout.clear(`${room._id}_timer`, erase = true);
                    console.log(`Cleared timer for game ID: ${room._id}`);
                }
                // update game status to paused and isPausedBySystem to true
                await Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, { $set: { "otherData.isPaused": true, "otherData.pauseGameStats.isPausedBySystem": bySystem,  "otherData.pauseGameStats.isWithoutAnnouncement": isPauseWithoutAnnouncement } });
                Sys.Io.of(Sys.Config.Namespace.Game1).to(room._id).emit('toggleGameStatus', {
                    gameId: room._id,
                    status: "Pause",
                    bySystem: bySystem,
                    isPauseWithoutAnnouncement,
                    message: "Checking the claimed tickets."
                });
                console.log(`Game paused in room ${gameId}.`);

                // update all halls isReady status to false as game stopped
                let updatedGame = await Sys.Game.Game1.Services.GameServices.updateGameNested(
                    { _id: room._id }, 
                    { $set: { "otherData.agents.$[].isReady": false } },
                    {new: true}
                );
                room?.halls.forEach(hall => {
                    Sys.Io.of('admin').to(hall).emit('toggleGameStatus', {
                        gameId: room._id,
                        status: "Pause",
                        bySystem: bySystem,
                        isPauseWithoutAnnouncement,
                        agents: updatedGame.otherData.agents,
                    });
                })
                // broadcast pending winners 1 second before so it need to be checked if game stops for pending winner handling
                const pendingWinners = updatedGame?.otherData?.pendingWinners || {};
                await settlePendingWinners(gameId, pendingWinners);
                saveGameDataToRedisHmset('game1', gameId, { otherData: updatedGame.otherData });
                return {status: "success"}
                
            } else {
                console.log(`No running game found in room ${gameId}.`);
                if(!room){
                    return {status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(['game_not_availbale'], language), showSearch: false}
                }else if(room.otherData.isPaused == true){
                    // broadcast pending winners 1 second before so it need to be checked if game stops for pending winner handling
                    const pendingWinners = room?.otherData?.pendingWinners || {};
                    await settlePendingWinners(gameId, pendingWinners);
                    return {status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(['game_already_paused'], language), showSearch: true}
                }else if(room.status == "finish"){
                    return {status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(['game_already_finished'], language), showSearch: true}
                }
                return {status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(['game_already_paused_or_not_available'], language), showSearch: false}
            }
        }catch(e){
            console.log("Error in stop game", e)
            return {status: "fail", message: 'Something went wrong', showSearch: false}
        } 
    },

    resumeGame: async function(data) {
        try{
            let keys = ["game_resume_success", "game_has_been_resumed", "game_is_already_running", "game_not_availbale", "something_went_wrong_try_again_later"];
            let translation = await Sys.Helper.bingo.getTraslateData(keys, data.language);
            let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, { status: 1, otherData: 1, gameName: 1 });
            
            if (room) {
                const roomIdString = room._id.toString();
                if(data.action == "Resume"){
                    if( (room.status == "running" || room.status == "finish" ) && room.otherData.isPaused == true){
                        if(room.status == "finish" && room.otherData.isMinigameExecuted == true ){
                            if (Timeout.exists(room._id.toString())) {
                                await Sys.Io.of(Sys.Config.Namespace.Game1).to(room._id).emit('toggleGameStatus', {
                                    gameId: room._id,
                                    status: "Resume",
                                    message: translation.game_has_been_resumed
                                });
                                const updatedGame = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: room._id }, { $set: { "otherData.isPaused": false } }, {new: true});
                                saveGameDataToRedisHmset('game1', roomIdString, { otherData: updatedGame.otherData });
                                Timeout.resume(room._id.toString());
                                console.log(`Resumed timeout for game ID: ${room._id}`);
                                return {status: "success", message: translation.game_resume_success}
                            } else {
                                if(room.gameName == "Wheel of Fortune" || room.gameName == "Treasure Chest" || room.gameName == "Mystery" || room.gameName == "Color Draft"){
                                    await Sys.Io.of(Sys.Config.Namespace.Game1).to(room._id).emit('toggleGameStatus', {
                                        gameId: room._id,
                                        status: "Resume",
                                        message: translation.game_has_been_resumed
                                    });
                                    const updatedGame = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: room._id }, { $set: { "otherData.isPaused": false } }, {new: true});
                                    saveGameDataToRedisHmset('game1', roomIdString, { otherData: updatedGame.otherData });
                                    module.exports.completeMinigamesIfNotTimeout(room._id.toString());
                                    return {status: "success", message: translation.game_resume_success}
                                }else{
                                    return {status: "fail", message: translation.something_went_wrong_try_again_later}
                                }
                                
                            }
                            //return {status: "fail", message: "Game is already running"}
                        }else{
                            const updatedGame = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: room._id }, { $set: { "otherData.isPaused": false } }, {new: true});
                            saveGameDataToRedisHmset('game1', roomIdString, { otherData: updatedGame.otherData });
                            Sys.Io.of(Sys.Config.Namespace.Game1).to(room._id).emit('toggleGameStatus', {
                                gameId: room._id,
                                status: "Resume",
                                message: translation.game_has_been_resumed
                            });
                            console.log(`Game resumed in room ${data.gameId}.`);
                            module.exports.gameInterval(data.gameId);
                            return {status: "success", message: translation.game_resume_success}
                        }
                        
                    }else{
                        return {status: "fail", message: translation.game_is_already_running}
                    }
                }else{
                    return {status: "fail", message: translation.something_went_wrong_try_again_later}
                }
               
            }else{
                return {status: "fail", message: translation.game_not_availbale}
            }

        }catch(e){
            console.log("error in resumeGame---", e);
        }
    },

    checkForMinigames: async function(gameId){
        try{
            Sys.Log.info("checkForMinigames called and registeredtimeout" + gameId);
            let extraGamesTimeout = setTimeout(async function () {
                
                let updatedGame = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId, 'otherData.isPaused': false }, { $set: { "otherData.isMinigameExecuted": true } }, {new: true});
                if(updatedGame){
                    if(updatedGame.otherData.isMinigameExecuted == false){
                        console.log("game status is not updated so don't execute, means game is paused");
                        clearTimeout(extraGamesTimeout);
                        return;
                    }
                }else{
                    console.log("game status is not updated so don't execute, means game is paused");
                    clearTimeout(extraGamesTimeout);
                    return;
                }
                console.log("game is not paused during wait time of check for minigames");
                
                clearTimeout(extraGamesTimeout);
                let winnersExtra =await Sys.Game.Game1.Services.GameServices.getByData({ _id: gameId },{winners: 1, halls: 1, 'otherData.masterHallId': 1, parentGameId: 1});
                console.log("winnersExtra", winnersExtra[0].winners)
                if(winnersExtra.length> 0 && winnersExtra[0].winners.length > 0){
                    // check for whell of fortune 
                    let wofWinners = [];
                    let wofWinnersPlayers = [];
                    let tChestWinners = [];
                    let tChestWinnersPlayers = [];
                    let mysteryWinners = [], mysteryWinnersPlayers = [];
                    let colorDraftWinners = [], colorDraftWinnersPlayers = [];
                    for(let e =0; e < winnersExtra[0].winners.length; e++){
                        if(winnersExtra[0].winners[e].isWoF == true){
                            if(winnersExtra[0].winners[e].userType == "Unique" || winnersExtra[0].winners[e].userType == "Online" || winnersExtra[0].winners[e].userType == "Physical"){
                                wofWinners.push(winnersExtra[0].winners[e].playerId);
                            }
                            wofWinnersPlayers.push({playerId: winnersExtra[0].winners[e].playerId,WinningAmount: 0, ticketId: winnersExtra[0].winners[e].ticketId, ticketNumber: winnersExtra[0].winners[e].ticketNumber, playerName: winnersExtra[0].winners[e].playerName, playerType: winnersExtra[0].winners[e].userType, hallName: winnersExtra[0].winners[e].hallName, hallId: winnersExtra[0].winners[e].hallId, groupHallName: winnersExtra[0].winners[e].groupHallName,  groupHallId: winnersExtra[0].winners[e].groupHallId});
                        }
                        if(winnersExtra[0].winners[e].isTchest == true){
                            if(winnersExtra[0].winners[e].userType == "Unique" || winnersExtra[0].winners[e].userType == "Online" || winnersExtra[0].winners[e].userType == "Physical"){
                                tChestWinners.push(winnersExtra[0].winners[e].playerId);
                            }
                            tChestWinnersPlayers.push({playerId: winnersExtra[0].winners[e].playerId,WinningAmount: 0, ticketId: winnersExtra[0].winners[e].ticketId,  lineType: winnersExtra[0].winners[e].lineType, ticketNumber: winnersExtra[0].winners[e].ticketNumber, playerName: winnersExtra[0].winners[e].playerName, ticketColorName: winnersExtra[0].winners[e].ticketColorName, ticketPrice: winnersExtra[0].winners[e].ticketPrice, playerType: winnersExtra[0].winners[e].userType, hallName: winnersExtra[0].winners[e].hallName,  hallId: winnersExtra[0].winners[e].hallId, groupHallName: winnersExtra[0].winners[e].groupHallName,  groupHallId: winnersExtra[0].winners[e].groupHallId});
                        }
                        if(winnersExtra[0].winners[e].isMys == true){
                            if(winnersExtra[0].winners[e].userType == "Unique" || winnersExtra[0].winners[e].userType == "Online" || winnersExtra[0].winners[e].userType == "Physical"){
                                mysteryWinners.push(winnersExtra[0].winners[e].playerId);
                            }
                            mysteryWinnersPlayers.push({playerId: winnersExtra[0].winners[e].playerId,WinningAmount: 0, ticketId: winnersExtra[0].winners[e].ticketId,  lineType: winnersExtra[0].winners[e].lineType, ticketNumber: winnersExtra[0].winners[e].ticketNumber, playerName: winnersExtra[0].winners[e].playerName, ticketColorName: winnersExtra[0].winners[e].ticketColorName, ticketPrice: winnersExtra[0].winners[e].ticketPrice, playerType: winnersExtra[0].winners[e].userType, hallName: winnersExtra[0].winners[e].hallName,  hallId: winnersExtra[0].winners[e].hallId, groupHallName: winnersExtra[0].winners[e].groupHallName,  groupHallId: winnersExtra[0].winners[e].groupHallId});
                        }
                        if(winnersExtra[0].winners[e].isColorDraft == true){
                            if(winnersExtra[0].winners[e].userType == "Unique" || winnersExtra[0].winners[e].userType == "Online" || winnersExtra[0].winners[e].userType == "Physical"){
                                colorDraftWinners.push(winnersExtra[0].winners[e].playerId);
                            }
                            colorDraftWinnersPlayers.push({playerId: winnersExtra[0].winners[e].playerId,WinningAmount: 0, ticketId: winnersExtra[0].winners[e].ticketId,  lineType: winnersExtra[0].winners[e].lineType, ticketNumber: winnersExtra[0].winners[e].ticketNumber, playerName: winnersExtra[0].winners[e].playerName, ticketColorName: winnersExtra[0].winners[e].ticketColorName, ticketPrice: winnersExtra[0].winners[e].ticketPrice, playerType: winnersExtra[0].winners[e].userType, hallName: winnersExtra[0].winners[e].hallName,  hallId: winnersExtra[0].winners[e].hallId, groupHallName: winnersExtra[0].winners[e].groupHallName,  groupHallId: winnersExtra[0].winners[e].groupHallId});
                        }
                    }
                    console.log("wofWinners, tChestWinners & Colordraftwinners---", wofWinners, wofWinnersPlayers, tChestWinners, tChestWinnersPlayers, colorDraftWinners, colorDraftWinnersPlayers);
                    Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                        $set: {
                            wofWinners: wofWinnersPlayers,
                            tChestWinners: tChestWinnersPlayers,
                            mystryWinners: mysteryWinnersPlayers,
                            colorDraftWinners: colorDraftWinnersPlayers
                        }
                    });
                    
                    
                    if(wofWinners.length >=1 ){
                        // check if only physical winners
                        let onlinePlayerCount = wofWinnersPlayers.filter(e => (e.playerType == "Unique" || e.playerType == "Online" ) ).length;
                        console.log("onlinePlayerCount---", onlinePlayerCount)
                        if(onlinePlayerCount > 0){
                            let physicalPlayerIds =  wofWinnersPlayers.filter(row => row.playerType == "Physical").map(ele=>ele.playerId);
                            console.log("physical and all playerIds ",wofWinners, physicalPlayerIds)
                            if(physicalPlayerIds.length > 0){
                                wofWinners = wofWinners.filter((item) => !physicalPlayerIds.includes(item));
                            }
                            console.log("after removing physical winner", wofWinners);
                            if(wofWinners.length > 0){
                                let sendWof = wofWinners[Math.floor(Math.random() * wofWinners.length)];
                                console.log("sendWof---", sendWof);
                            
                                let wofPlayerSockets = await Sys.Game.Common.Services.PlayerServices.getByDataPlayers({ "_id": { $in: wofWinners } }, { socketId: 1 });
                                console.log("wofPlayerSockets", wofPlayerSockets)
                                if(wofPlayerSockets.length > 0){
                                    for(w =0; w < wofPlayerSockets.length; w++){
                                        console.log("socketId", "/Game1#"+ wofPlayerSockets[w].socketId);
                                        //let showSpinnerButton = false;
                                        if(wofPlayerSockets[w]._id == sendWof){
                                            //showSpinnerButton = true;
                                            let winnerAfterEnaledSpinner = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId}, {
                                                $set: {
                                                    //'winners.$[current].playerName': "david",
                                                    'winners.$[current].enabledSpinner': true,
                                                    
                                                },
                                            }, { arrayFilters: [ {"current.playerId": wofPlayerSockets[w].id, "current.isWoF": true} ], new: true });
                                            //console.log("winnerAfterEnaledSpinner--", winnerAfterEnaledSpinner.winners, {"current.playerId": wofPlayerSockets[w]._id, "current.isWoF": true})
                                        }
                                        
                                    }
                                }

                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('ActivateMiniGame', {
                                    gameId: gameId,
                                    playerId: sendWof,
                                    miniGameType: "wheelOfFortune"
                                });
                                Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                    $set: {
                                        'otherData.isMinigameActivated': true,
                                        'otherData.isMinigamePlayed': false,
                                        'otherData.isMinigameFinished': false,
                                        'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                                    }
                                });

                                let tempIndex = Sys.Timers.indexOf(gameId.toString());
                                if (tempIndex !== -1) {
                                    if (Timeout.exists(gameId.toString())) {
                                        console.log("timeout already exists check in new timer set up", gameId.toString())
                                        return {
                                            "status": "fail",
                                            "message": "Mini Game is already started."
                                        };
                                    }
                                    Sys.Timers.splice(tempIndex, 1);
                                }
                                let indexId = Sys.Timers.push(gameId.toString());
                                console.log("indexId---", indexId);

                                Timeout.set(Sys.Timers[(indexId - 1)], async () => {
                                    try {
                                        let index = Sys.Timers.indexOf(gameId.toString());
                                        if (index !== -1) {
                                            Timeout.clear(Sys.Timers[index], erase = true);
                                            Sys.Timers.splice(index, 1);
                                        }

                                        console.log("playWheelOfFortune called from game");
                                        module.exports.playWheelOfFortune(null, {playerId: sendWof, gameId: gameId})
                                    } catch (e) {
                                        console.log("error in timeout of game 1 start", e);
                                    }

                                }, ( 10000 ));

                            }
                        }else{
                            console.log("Physical player won the wheel of fortune.");
                            let physicalTicketNum = wofWinnersPlayers.map(e => e.ticketNumber);;
                            console.log("physicalTicketIds----", physicalTicketNum, {
                                gameType: "Wheel of Fortune",
                                winner: {ticketNumbers: physicalTicketNum},
                                message: "Following Ticket number won Wheel of Fortune, Need to spin whell in the hall to win the prizes."
                            });
                            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminExtraGameNoti', {
                                gameType: "Wheel of Fortune",  //  adminExtraGameNoti
                                winner: {ticketNumbers: physicalTicketNum},
                                message: "Following Ticket number won Wheel of Fortune, Need to spin whell in the hall to win the prizes."
                            });

                            // Wheel of fortune minigame manual reward using agent panel popup
                            Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                $set: {
                                   'otherData.minigameManualRewardStatus': "Pending",    // Pending, Success
                                   'otherData.minigameManualReward': 0 // Pending, Success
                                }
                            });
                            Sys.Io.of('admin').emit('wofPopup', {gameId, hallId: winnersExtra[0]?.otherData?.masterHallId});
                            
                            // nextGameCountDownStart(updatedGame.halls, updatedGame.parentGameId, 5000);
                            // setTimeout(async function () {
                            //     await Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                            //         $set: {
                            //             'otherData.isMinigameFinished': true, 
                            //             'otherData.gameSecondaryStatus': 'finish',
                            //             'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                            //         }
                            //     });

                            //     refreshGameWithoutCountDown(gameId, winnersExtra[0]?.halls, 0);
                            //     Sys.Io.of('admin').emit('refreshSchedule', {scheduleId:  updatedGame.parentGameId});

                            // },5000);

                        }
                   
                    }else if(tChestWinners.length >= 1){
                        // check if only physical winners
                        let onlinePlayerCount = tChestWinnersPlayers.filter(e => (e.playerType == "Unique" || e.playerType == "Online" ) ).length;
                        console.log("onlinePlayerCount---", onlinePlayerCount)
                        if(onlinePlayerCount > 0){
                            let physicalPlayerIds =  tChestWinnersPlayers.filter(row => row.playerType == "Physical").map(ele=>ele.playerId);
                            console.log("physical and all playerIds ",tChestWinners, physicalPlayerIds)
                            if(physicalPlayerIds.length > 0){
                                tChestWinners = tChestWinners.filter((item) => !physicalPlayerIds.includes(item));
                            }
                            console.log("after removing physical winner", tChestWinners);

                            let sendTChest = tChestWinners[Math.floor(Math.random() * tChestWinners.length)];
                            console.log("sendTChest---", sendTChest);

                            let tChestPlayerSockets = await Sys.Game.Common.Services.PlayerServices.getByDataPlayers({ "_id": { $in: tChestWinners } }, { socketId: 1 });
                            console.log("tChestPlayerSockets", tChestPlayerSockets)
                            if(tChestPlayerSockets.length > 0){
                                for(w =0; w < tChestPlayerSockets.length; w++){
                                    console.log("socketId", "/Game1#"+ tChestPlayerSockets[w].socketId);
                                    //let showSpinnerButton = false;
                                    if(tChestPlayerSockets[w]._id == sendTChest){
                                        //showSpinnerButton = true;
                                        let winnerAfterEnaledSpinner = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId}, {
                                            $set: {
                                                //'winners.$[current].playerName': "david",
                                                'winners.$[current].enabledSpinner': true,
                                                
                                            },
                                        }, { arrayFilters: [ {"current.playerId": tChestPlayerSockets[w].id, "current.isTchest": true} ], new: true });
                                        console.log("winnerAfterEnaledSpinner--", winnerAfterEnaledSpinner.winners, {"current.playerId": tChestPlayerSockets[w]._id, "current.isTchest": true})
                                    }
                                }
                            }

                            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('ActivateMiniGame', {
                                gameId: gameId,
                                playerId: sendTChest,
                                miniGameType: "treasureChest",
                                isForAdmin: false
                            });
                          
                            let tempIndex = Sys.Timers.indexOf(gameId.toString());
                            if (tempIndex !== -1) {
                                if (Timeout.exists(gameId.toString())) {
                                    console.log("timeout already exists check in new timer set up", gameId.toString())
                                    return {
                                        "status": "fail",
                                        "message": "Mini Game is already started."
                                    };
                                }
                                Sys.Timers.splice(tempIndex, 1);
                            }
                            let indexId = Sys.Timers.push(gameId.toString());
                            console.log("indexId---", indexId);

                            Timeout.set(Sys.Timers[(indexId - 1)], async () => {
                                try {
                                    let index = Sys.Timers.indexOf(gameId.toString());
                                    if (index !== -1) {
                                        Timeout.clear(Sys.Timers[index], erase = true);
                                        Sys.Timers.splice(index, 1);
                                    }

                                    console.log("SelectTreasureChest called from game");
                                    module.exports.SelectTreasureChest(null, {playerId: sendTChest, gameId: gameId, playerType: "Auto"})
                                } catch (e) {
                                    console.log("error in timeout of game 1 start", e);
                                }

                            }, ( 10000 ));


                            Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                $set: {
                                    'otherData.isMinigameActivated': true,
                                    'otherData.isMinigamePlayed': false,
                                    'otherData.isMinigameFinished': false,
                                    'otherData.isSpinByAdmin': false,
                                    'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                                }
                            });
                        }else{
                            console.log("Physical player won the Treasure chest.");
                            let physicalTicketNum = tChestWinnersPlayers.map(e => e.ticketNumber);
                            
                            await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId}, {
                                $set: {
                                    'winners.$[current].enabledSpinner': true,
                                },
                            }, { arrayFilters: [ {"current.playerId": tChestWinnersPlayers[0].playerId, "current.isTchest": true} ], new: true });
                            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('ActivateMiniGame', {
                                gameId: gameId,
                                playerId: tChestWinnersPlayers[0].playerId,
                                miniGameType: "treasureChest",
                                isForAdmin: true
                            });
                           
                            // let tempIndex = Sys.Timers.indexOf(gameId.toString());
                            // if (tempIndex !== -1) {
                            //     if (Timeout.exists(gameId.toString())) {
                            //         console.log("timeout already exists check in new timer set up", gameId.toString())
                            //         return {
                            //             "status": "fail",
                            //             "message": "Mini Game is already started."
                            //         };
                            //     }
                            //     Sys.Timers.splice(tempIndex, 1);
                            // }
                            // let indexId = Sys.Timers.push(gameId.toString());
                            // console.log("indexId---", indexId);

                            // Timeout.set(Sys.Timers[(indexId - 1)], async () => {
                            //     try {
                            //         let index = Sys.Timers.indexOf(gameId.toString());
                            //         if (index !== -1) {
                            //             Timeout.clear(Sys.Timers[index], erase = true);
                            //             Sys.Timers.splice(index, 1);
                            //         }

                            //         console.log("SelectTreasureChest called from game");
                            //         module.exports.SelectTreasureChest(null, {playerId: tChestWinnersPlayers[0].playerId, gameId: gameId, playerType: "Auto"})
                            //     } catch (e) {
                            //         console.log("error in timeout of game 1 start", e);
                            //     }

                            // }, ( 10000 ));

                            Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                $set: {
                                    'otherData.isMinigameActivated': true,
                                    'otherData.isMinigamePlayed': false,
                                    'otherData.isMinigameFinished': false,
                                    'otherData.isSpinByAdmin': true,
                                    'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                                }
                            });
                        }
                        
                    }else if(mysteryWinners.length >= 1){
                        let setData = await module.exports.setMysteryData({gameId: gameId})
                        if(setData && setData.status == "success"){
                            // check if only physical winners
                            let onlinePlayerCount = mysteryWinnersPlayers.filter(e => (e.playerType == "Unique" || e.playerType == "Online" ) ).length;
                            console.log("onlinePlayerCount---", onlinePlayerCount)
                            if(onlinePlayerCount > 0){
                                let physicalPlayerIds =  mysteryWinnersPlayers.filter(row => row.playerType == "Physical").map(ele=>ele.playerId);
                                console.log("physical and all playerIds ",mysteryWinners, physicalPlayerIds)
                                if(physicalPlayerIds.length > 0){
                                    mysteryWinners = mysteryWinners.filter((item) => !physicalPlayerIds.includes(item));
                                }
                                console.log("after removing physical winner", mysteryWinners);

                                let sendMys = mysteryWinners[Math.floor(Math.random() * mysteryWinners.length)];
                                console.log("sendMys---", sendMys);

                                let mysPlayerSockets = await Sys.Game.Common.Services.PlayerServices.getByDataPlayers({ "_id": { $in: mysteryWinners } }, { socketId: 1 });
                                console.log("mysPlayerSockets", mysPlayerSockets)
                                if(mysPlayerSockets.length > 0){
                                    for(w =0; w < mysPlayerSockets.length; w++){
                                        console.log("socketId", "/Game1#"+ mysPlayerSockets[w].socketId);
                                        //let showSpinnerButton = false;
                                        if(mysPlayerSockets[w]._id == sendMys){
                                            //showSpinnerButton = true;
                                            let winnerAfterEnaledSpinner = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId}, {
                                                $set: {
                                                    //'winners.$[current].playerName': "david",
                                                    'winners.$[current].enabledSpinner': true,
                                                    
                                                },
                                            }, { arrayFilters: [ {"current.playerId": mysPlayerSockets[w].id, "current.isMys": true} ], new: true });
                                            console.log("winnerAfterEnaledSpinner--", winnerAfterEnaledSpinner.winners, {"current.playerId": mysPlayerSockets[w]._id, "current.isMys": true})
                                        }
                                        
                                    }
                                }

                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('ActivateMiniGame', {
                                    gameId: gameId,
                                    playerId: sendMys,
                                    miniGameType: "Mystery",
                                    isForAdmin: false
                                });
                                
                                Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                    $set: {
                                        'otherData.isMinigameActivated': true,
                                        'otherData.isMinigamePlayed': false,
                                        'otherData.isMinigameFinished': false,
                                        'otherData.isSpinByAdmin': false,
                                        'otherData.isMinigameInProgress': true,
                                        'otherData.mysteryTurnCounts': 0,
                                        'otherData.mysteryHistory': [],
                                        'otherData.mysteryStartTimeMs': (new Date()).getTime(),
                                    }
                                });

                                let tempIndex = Sys.Timers.indexOf(gameId.toString());
                                if (tempIndex !== -1) {
                                    if (Timeout.exists(gameId.toString())) {
                                        console.log("timeout already exists check in new timer set up", gameId.toString())
                                        return {
                                            "status": "fail",
                                            "message": "Mini Game is already started."
                                        };
                                    }
                                    Sys.Timers.splice(tempIndex, 1);
                                }
                                let indexId = Sys.Timers.push(gameId.toString());
                                console.log("indexId---", indexId);

                                Timeout.set(Sys.Timers[(indexId - 1)], async () => {
                                    try {
                                        let index = Sys.Timers.indexOf(gameId.toString());
                                        if (index !== -1) {
                                            Timeout.clear(Sys.Timers[index], erase = true);
                                            Sys.Timers.splice(index, 1);
                                        }
                                        
                                        let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                                        Sys.Log.info("room in mystery game"+ room)
                                        if(room && room.otherData.isMinigameFinished == false && room.otherData.mysteryTurnCounts == 0){
                                            module.exports.selectMysteryAuto(null, {playerId: sendMys, gameId: gameId, playerType: "Auto", turnCount: 1, isHigherNumber: true});
                                        }else{
                                            return false;
                                        }
                                    } catch (e) {
                                        console.log("error in timeout of game 1 start", e);
                                    }

                                }, ( 10000 ));


                            }else{
                                console.log("Physical player won the Mystery.");
                                let physicalTicketNum = mysteryWinnersPlayers.map(e => e.ticketNumber);
                                
                                await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId}, {
                                    $set: {
                                        'winners.$[current].enabledSpinner': true,
                                    },
                                }, { arrayFilters: [ {"current.playerId": mysteryWinnersPlayers[0].playerId, "current.isMys": true} ], new: true });
                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('ActivateMiniGame', {
                                    gameId: gameId,
                                    playerId: mysteryWinnersPlayers[0].playerId,
                                    miniGameType: "Mystery",
                                    isForAdmin: true
                                });

                                Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                    $set: {
                                        'otherData.isMinigameActivated': true,
                                        'otherData.isMinigamePlayed': false,
                                        'otherData.isMinigameFinished': false,
                                        'otherData.isSpinByAdmin': true,
                                        'otherData.isMinigameInProgress': true,
                                        'otherData.mysteryTurnCounts': 0,
                                        'otherData.mysteryHistory': [],
                                        'otherData.mysteryStartTimeMs': (new Date()).getTime(),
                                    }
                                });

                                // let tempIndex = Sys.Timers.indexOf(gameId.toString());
                                // if (tempIndex !== -1) {
                                //     if (Timeout.exists(gameId.toString())) {
                                //         console.log("timeout already exists check in new timer set up", gameId.toString())
                                //         return {
                                //             "status": "fail",
                                //             "message": "Mini Game is already started."
                                //         };
                                //     }
                                //     Sys.Timers.splice(tempIndex, 1);
                                // }
                                // let indexId = Sys.Timers.push(gameId.toString());
                                // console.log("indexId---", indexId);

                                // Timeout.set(Sys.Timers[(indexId - 1)], async () => {
                                //     try {
                                //         let index = Sys.Timers.indexOf(gameId.toString());
                                //         if (index !== -1) {
                                //             Timeout.clear(Sys.Timers[index], erase = true);
                                //             Sys.Timers.splice(index, 1);
                                //         }

                                //         let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                                //         Sys.Log.info("room in mystery game"+ room)
                                //         if(room && room.otherData.isMinigameFinished == false && room.otherData.mysteryTurnCounts == 0){
                                //             module.exports.selectMysteryAuto(null, {playerId: mysteryWinnersPlayers[0].playerId, gameId: gameId, playerType: "Auto", turnCount: 1, isHigherNumber: true});
                                //         }else{
                                //             return false;
                                //         }
                                //     } catch (e) {
                                //         console.log("error in timeout of game 1 start", e);
                                //     }

                                // }, ( 10000 ));
                                
                            }
                        }else{
                            refreshGameWithoutCountDown(gameId, winnersExtra[0]?.halls, 5000, winnersExtra[0]?.parentGameId);
                        }
                        
                    }else if(colorDraftWinners.length >= 1){
                        
                        let setData = await module.exports.setColorDraftData({gameId: gameId})
                        if(setData && setData.status == "success"){
                            // check if only physical winners
                            let onlinePlayerCount = colorDraftWinnersPlayers.filter(e => (e.playerType == "Unique" || e.playerType == "Online" ) ).length;
                            console.log("onlinePlayerCount---", onlinePlayerCount)
                            if(onlinePlayerCount > 0){
                                let physicalPlayerIds =  colorDraftWinnersPlayers.filter(row => row.playerType == "Physical").map(ele=>ele.playerId);
                                console.log("physical and all playerIds ",colorDraftWinners, physicalPlayerIds)
                                if(physicalPlayerIds.length > 0){
                                    colorDraftWinners = colorDraftWinners.filter((item) => !physicalPlayerIds.includes(item));
                                }
                                console.log("after removing physical winner", colorDraftWinners);

                                let sendColorDraft = colorDraftWinners[Math.floor(Math.random() * colorDraftWinners.length)];
                                console.log("sendColorDraft---", sendColorDraft);

                                let mysPlayerSockets = await Sys.Game.Common.Services.PlayerServices.getByDataPlayers({ "_id": { $in: colorDraftWinners } }, { socketId: 1 });
                                console.log("mysPlayerSockets", mysPlayerSockets)
                                if(mysPlayerSockets.length > 0){
                                    for(w =0; w < mysPlayerSockets.length; w++){
                                        console.log("socketId", "/Game1#"+ mysPlayerSockets[w].socketId);
                                        //let showSpinnerButton = false;
                                        if(mysPlayerSockets[w]._id == sendColorDraft){
                                            //showSpinnerButton = true;
                                            let winnerAfterEnaledSpinner = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId}, {
                                                $set: {
                                                    //'winners.$[current].playerName': "david",
                                                    'winners.$[current].enabledSpinner': true,
                                                    
                                                },
                                            }, { arrayFilters: [ {"current.playerId": mysPlayerSockets[w].id, "current.isColorDraft": true} ], new: true });
                                            console.log("winnerAfterEnaledSpinner--", winnerAfterEnaledSpinner.winners, {"current.playerId": mysPlayerSockets[w]._id, "current.isColorDraft": true})
                                        }
                                        
                                    }
                                }

                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('ActivateMiniGame', {
                                    gameId: gameId,
                                    playerId: sendColorDraft,
                                    miniGameType: "Color Draft",
                                    isForAdmin: false
                                });
                                
                                Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                    $set: {
                                        'otherData.isMinigameActivated': true,
                                        'otherData.isMinigamePlayed': false,
                                        'otherData.isMinigameFinished': false,
                                        'otherData.isSpinByAdmin': false,
                                        'otherData.isMinigameInProgress': true,
                                        'otherData.miniGameturnCounts': 0,
                                        'otherData.miniGameHistory': [],
                                        'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                                    }
                                });

                                let tempIndex = Sys.Timers.indexOf(gameId.toString());
                                if (tempIndex !== -1) {
                                    if (Timeout.exists(gameId.toString())) {
                                        console.log("timeout already exists check in new timer set up", gameId.toString())
                                        return {
                                            "status": "fail",
                                            "message": "Mini Game is already started."
                                        };
                                    }
                                    Sys.Timers.splice(tempIndex, 1);
                                }
                                let indexId = Sys.Timers.push(gameId.toString());
                                console.log("indexId---", indexId);

                                Timeout.set(Sys.Timers[(indexId - 1)], async () => {
                                    try {
                                        let index = Sys.Timers.indexOf(gameId.toString());
                                        if (index !== -1) {
                                            Timeout.clear(Sys.Timers[index], erase = true);
                                            Sys.Timers.splice(index, 1);
                                        }
                                        console.log("auto game stopped")
                                        let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                                        Sys.Log.info("room in color draft game"+ room)
                                        if(room && room.otherData.isMinigameFinished == false && room.otherData.miniGameturnCounts == 0){
                                            let allIndex = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
                                            let selectedIndex = allIndex[Math.floor(fortuna.random() * allIndex.length)];
                                            module.exports.selectColorDraftAuto(null, {playerId: sendColorDraft, gameId: gameId, playerType: "Auto", turnCount: 1, selectedIndex: selectedIndex});
                                        }else{
                                            return false;
                                        }
                                    } catch (e) {
                                        console.log("error in timeout of game 1 start", e);
                                    }

                                }, ( 10000 ));

                            }else{
                                console.log("Physical player won the Color Draft.");
                                let physicalTicketNum = colorDraftWinnersPlayers.map(e => e.ticketNumber);
                                
                                await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId}, {
                                    $set: {
                                        'winners.$[current].enabledSpinner': true,
                                    },
                                }, { arrayFilters: [ {"current.playerId": colorDraftWinnersPlayers[0].playerId, "current.isColorDraft": true} ], new: true });
                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('ActivateMiniGame', {
                                    gameId: gameId,
                                    playerId: colorDraftWinnersPlayers[0].playerId,
                                    miniGameType: "Color Draft",
                                    isForAdmin: true
                                });

                                Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                    $set: {
                                        'otherData.isMinigameActivated': true,
                                        'otherData.isMinigamePlayed': false,
                                        'otherData.isMinigameFinished': false,
                                        'otherData.isSpinByAdmin': true,
                                        'otherData.isMinigameInProgress': true,
                                        'otherData.miniGameturnCounts': 0,
                                        'otherData.miniGameHistory': [],
                                        'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                                    }
                                });

                                // let tempIndex = Sys.Timers.indexOf(gameId.toString());
                                // if (tempIndex !== -1) {
                                //     if (Timeout.exists(gameId.toString())) {
                                //         console.log("timeout already exists check in new timer set up", gameId.toString())
                                //         return {
                                //             "status": "fail",
                                //             "message": "Mini Game is already started."
                                //         };
                                //     }
                                //     Sys.Timers.splice(tempIndex, 1);
                                // }
                                // let indexId = Sys.Timers.push(gameId.toString());
                                // console.log("indexId---", indexId);

                                // Timeout.set(Sys.Timers[(indexId - 1)], async () => {
                                //     try {
                                //         let index = Sys.Timers.indexOf(gameId.toString());
                                //         if (index !== -1) {
                                //             Timeout.clear(Sys.Timers[index], erase = true);
                                //             Sys.Timers.splice(index, 1);
                                //         }

                                //         let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                                //         Sys.Log.info("room in color draft game"+ room)
                                //         if(room && room.otherData.isMinigameFinished == false && room.otherData.miniGameturnCounts == 0){
                                //             let allIndex = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
                                //             let selectedIndex = allIndex[Math.floor(fortuna.random() * allIndex.length)];
                                //             module.exports.selectColorDraftAuto(null, {playerId: colorDraftWinnersPlayers[0].playerId, gameId: gameId, playerType: "Auto", turnCount: 1, selectedIndex: selectedIndex});
                                //         }else{
                                //             return false;
                                //         }
                                //     } catch (e) {
                                //         console.log("error in timeout of game 1 start", e);
                                //     }

                                // }, ( 10000 ));
                                
                            }
                        }else{
                            refreshGameWithoutCountDown(gameId, winnersExtra[0]?.halls, 5000, winnersExtra[0]?.parentGameId);
                        }
                        
                    }else{
                        console.log("Online or Unique userType WOF winner not found.");
                        await Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                            $set: {
                                'otherData.isMinigameFinished': true, 
                                'otherData.gameSecondaryStatus': 'finish',
                            }
                        });
                        refreshGameWithoutCountDown(gameId, winnersExtra[0]?.halls, 5000, winnersExtra[0]?.parentGameId);
                    }
                
                }
            }, (1000) ); // we have set it to 1s from 5 seconds as client want to show minigames immediately after game resume if full house done
        }catch(e){
            console.error("error in check for minigames", e);
        }
    },

    completeMinigamesIfNotTimeout: async function(gameId){
        try{console.log("completeMinigamesIfNotTimeout called", gameId);
            let winnersExtra =await Sys.Game.Game1.Services.GameServices.getByData({ _id: gameId },{winners: 1, halls: 1, otherData: 1, parentGameId: 1});
            console.log("winnersExtra", winnersExtra[0].winners)
            if(winnersExtra.length> 0 && winnersExtra[0].winners.length > 0){
                // check for whell of fortune 
                let wofWinners = [];
                let wofWinnersPlayers = [];
                let tChestWinners = [];
                let tChestWinnersPlayers = [];
                let mysteryWinners = [], mysteryWinnersPlayers = [];
                let colorDraftWinners = [], colorDraftWinnersPlayers = [];

                let whellSpinBy, tchestOpenBy, mysteryplayedBy, colorDrPlayedBy;
                for(let e =0; e < winnersExtra[0].winners.length; e++){
                    if(winnersExtra[0].winners[e].isWoF == true){
                        if(winnersExtra[0].winners[e].userType == "Unique" || winnersExtra[0].winners[e].userType == "Online" || winnersExtra[0].winners[e].userType == "Physical"){
                            wofWinners.push(winnersExtra[0].winners[e].playerId);
                        }
                        if(winnersExtra[0].winners[e].enabledSpinner == true){
                            whellSpinBy = winnersExtra[0].winners[e].playerId;
                        }
                        wofWinnersPlayers.push({playerId: winnersExtra[0].winners[e].playerId,WinningAmount: 0, ticketId: winnersExtra[0].winners[e].ticketId, ticketNumber: winnersExtra[0].winners[e].ticketNumber, playerName: winnersExtra[0].winners[e].playerName, playerType: winnersExtra[0].winners[e].userType, hallName: winnersExtra[0].winners[e].hallName,  hallId: winnersExtra[0].winners[e].hallId, groupHallName: winnersExtra[0].winners[e].groupHallName,  groupHallId: winnersExtra[0].winners[e].groupHallId});
                    }
                    if(winnersExtra[0].winners[e].isTchest == true){
                        if(winnersExtra[0].winners[e].userType == "Unique" || winnersExtra[0].winners[e].userType == "Online" || winnersExtra[0].winners[e].userType == "Physical"){
                            tChestWinners.push(winnersExtra[0].winners[e].playerId);
                        }
                        if(winnersExtra[0].winners[e].enabledSpinner == true){
                            tchestOpenBy = winnersExtra[0].winners[e].playerId;
                        }
                        tChestWinnersPlayers.push({playerId: winnersExtra[0].winners[e].playerId,WinningAmount: 0, ticketId: winnersExtra[0].winners[e].ticketId,  lineType: winnersExtra[0].winners[e].lineType, ticketNumber: winnersExtra[0].winners[e].ticketNumber, playerName: winnersExtra[0].winners[e].playerName, ticketColorName: winnersExtra[0].winners[e].ticketColorName, ticketPrice: winnersExtra[0].winners[e].ticketPrice, playerType: winnersExtra[0].winners[e].userType, hallName: winnersExtra[0].winners[e].hallName,  hallId: winnersExtra[0].winners[e].hallId, groupHallName: winnersExtra[0].winners[e].groupHallName,  groupHallId: winnersExtra[0].winners[e].groupHallId});
                    }
                    if(winnersExtra[0].winners[e].isMys == true){
                        if(winnersExtra[0].winners[e].userType == "Unique" || winnersExtra[0].winners[e].userType == "Online" || winnersExtra[0].winners[e].userType == "Physical"){
                            mysteryWinners.push(winnersExtra[0].winners[e].playerId);
                        }
                        if(winnersExtra[0].winners[e].enabledSpinner == true){
                            mysteryplayedBy = winnersExtra[0].winners[e].playerId;
                        }
                        mysteryWinnersPlayers.push({playerId: winnersExtra[0].winners[e].playerId,WinningAmount: 0, ticketId: winnersExtra[0].winners[e].ticketId,  lineType: winnersExtra[0].winners[e].lineType, ticketNumber: winnersExtra[0].winners[e].ticketNumber, playerName: winnersExtra[0].winners[e].playerName, ticketColorName: winnersExtra[0].winners[e].ticketColorName, ticketPrice: winnersExtra[0].winners[e].ticketPrice, playerType: winnersExtra[0].winners[e].userType, hallName: winnersExtra[0].winners[e].hallName,  hallId: winnersExtra[0].winners[e].hallId, groupHallName: winnersExtra[0].winners[e].groupHallName,  groupHallId: winnersExtra[0].winners[e].groupHallId});
                    }
                    if(winnersExtra[0].winners[e].isColorDraft == true){
                        if(winnersExtra[0].winners[e].userType == "Unique" || winnersExtra[0].winners[e].userType == "Online" || winnersExtra[0].winners[e].userType == "Physical"){
                            colorDraftWinners.push(winnersExtra[0].winners[e].playerId);
                        }
                        if(winnersExtra[0].winners[e].enabledSpinner == true){
                            colorDrPlayedBy = winnersExtra[0].winners[e].playerId;
                        }
                        colorDraftWinnersPlayers.push({playerId: winnersExtra[0].winners[e].playerId,WinningAmount: 0, ticketId: winnersExtra[0].winners[e].ticketId,  lineType: winnersExtra[0].winners[e].lineType, ticketNumber: winnersExtra[0].winners[e].ticketNumber, playerName: winnersExtra[0].winners[e].playerName, ticketColorName: winnersExtra[0].winners[e].ticketColorName, ticketPrice: winnersExtra[0].winners[e].ticketPrice, playerType: winnersExtra[0].winners[e].userType, hallName: winnersExtra[0].winners[e].hallName,  hallId: winnersExtra[0].winners[e].hallId, groupHallName: winnersExtra[0].winners[e].groupHallName,  groupHallId: winnersExtra[0].winners[e].groupHallId});
                    }
                }
                console.log("wofWinners, tChestWinners & Colordraftwinners---", wofWinners, wofWinnersPlayers, tChestWinners, tChestWinnersPlayers, colorDraftWinners, colorDraftWinnersPlayers);
                Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                    $set: {
                        wofWinners: wofWinnersPlayers,
                        tChestWinners: tChestWinnersPlayers,
                        mystryWinners: mysteryWinnersPlayers,
                        colorDraftWinners: colorDraftWinnersPlayers
                    }
                });
                
                
                if(wofWinners.length >=1 ){
                    // check if only physical winners
                    let onlinePlayerCount = wofWinnersPlayers.filter(e => (e.playerType == "Unique" || e.playerType == "Online" ) ).length;
                    console.log("onlinePlayerCount---", onlinePlayerCount)
                    if(onlinePlayerCount > 0){
                        let physicalPlayerIds =  wofWinnersPlayers.filter(row => row.playerType == "Physical").map(ele=>ele.playerId);
                        console.log("physical and all playerIds ",wofWinners, physicalPlayerIds)
                        if(physicalPlayerIds.length > 0){
                            wofWinners = wofWinners.filter((item) => !physicalPlayerIds.includes(item));
                        }
                        console.log("after removing physical winner", wofWinners);
                        if(wofWinners.length > 0){
                            let sendWof;
                            if(!whellSpinBy){
                            
                                sendWof = wofWinners[Math.floor(Math.random() * wofWinners.length)];
                                console.log("sendWof---", sendWof);
                            
                                let wofPlayerSockets = await Sys.Game.Common.Services.PlayerServices.getByDataPlayers({ "_id": { $in: wofWinners } }, { socketId: 1 });
                                console.log("wofPlayerSockets", wofPlayerSockets)
                                if(wofPlayerSockets.length > 0){
                                    for(w =0; w < wofPlayerSockets.length; w++){
                                        console.log("socketId", "/Game1#"+ wofPlayerSockets[w].socketId);
                                        //let showSpinnerButton = false;
                                        if(wofPlayerSockets[w]._id == sendWof){
                                            //showSpinnerButton = true;
                                            let winnerAfterEnaledSpinner = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId}, {
                                                $set: {
                                                    //'winners.$[current].playerName': "david",
                                                    'winners.$[current].enabledSpinner': true,
                                                    
                                                },
                                            }, { arrayFilters: [ {"current.playerId": wofPlayerSockets[w].id, "current.isWoF": true} ], new: true });
                                            //console.log("winnerAfterEnaledSpinner--", winnerAfterEnaledSpinner.winners, {"current.playerId": wofPlayerSockets[w]._id, "current.isWoF": true})
                                        }
                                    }
                                }

                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('ActivateMiniGame', {
                                    gameId: gameId,
                                    playerId: sendWof,
                                    miniGameType: "wheelOfFortune"
                                });
                                Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                    $set: {
                                        'otherData.isMinigameActivated': true,
                                        'otherData.isMinigamePlayed': false,
                                        'otherData.isMinigameFinished': false,
                                        'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                                    }
                                });

                            }else{
                                sendWof = whellSpinBy;
                                console.log("minigame is already activated so continue", sendWof)
                            }

                            let tempIndex = Sys.Timers.indexOf(gameId.toString());
                            if (tempIndex !== -1) {
                                if (Timeout.exists(gameId.toString())) {
                                    console.log("timeout already exists check in new timer set up", gameId.toString())
                                    return {
                                        "status": "fail",
                                        "message": "Mini Game is already started."
                                    };
                                }
                                Sys.Timers.splice(tempIndex, 1);
                            }
                            let indexId = Sys.Timers.push(gameId.toString());
                            console.log("indexId---", indexId);

                            Timeout.set(Sys.Timers[(indexId - 1)], async () => {
                                try {
                                    let index = Sys.Timers.indexOf(gameId.toString());
                                    if (index !== -1) {
                                        Timeout.clear(Sys.Timers[index], erase = true);
                                        Sys.Timers.splice(index, 1);
                                    }

                                    console.log("playWheelOfFortune called from game");
                                    module.exports.playWheelOfFortune(null, {playerId: sendWof, gameId: gameId})
                                } catch (e) {
                                    console.log("error in timeout of game 1 start", e);
                                }

                            }, ( 10000 ));

                        }
                    }else{
                        console.log("Physical player won the wheel of fortune.");
                        await Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                            $set: {
                                'otherData.isMinigameFinished': true, 
                                'otherData.gameSecondaryStatus': 'finish',
                                'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                            }
                        });

                        refreshGameWithoutCountDown(gameId, winnersExtra[0]?.halls, 0, winnersExtra[0]?.parentGameId);
                    }
                  
                }else if(tChestWinners.length >= 1){
                    // check if only physical winners
                    let onlinePlayerCount = tChestWinnersPlayers.filter(e => (e.playerType == "Unique" || e.playerType == "Online" ) ).length;
                    console.log("onlinePlayerCount---", onlinePlayerCount)
                    if(onlinePlayerCount > 0){
                        let physicalPlayerIds =  tChestWinnersPlayers.filter(row => row.playerType == "Physical").map(ele=>ele.playerId);
                        console.log("physical and all playerIds ",tChestWinners, physicalPlayerIds)
                        if(physicalPlayerIds.length > 0){
                            tChestWinners = tChestWinners.filter((item) => !physicalPlayerIds.includes(item));
                        }
                        console.log("after removing physical winner", tChestWinners);
                        let sendTChest;
                        if(!tchestOpenBy){
                            sendTChest = tChestWinners[Math.floor(Math.random() * tChestWinners.length)];
                            console.log("sendTChest---", sendTChest);

                            let tChestPlayerSockets = await Sys.Game.Common.Services.PlayerServices.getByDataPlayers({ "_id": { $in: tChestWinners } }, { socketId: 1 });
                            console.log("tChestPlayerSockets", tChestPlayerSockets)
                            if(tChestPlayerSockets.length > 0){
                                for(w =0; w < tChestPlayerSockets.length; w++){
                                    console.log("socketId", "/Game1#"+ tChestPlayerSockets[w].socketId);
                                    //let showSpinnerButton = false;
                                    if(tChestPlayerSockets[w]._id == sendTChest){
                                        //showSpinnerButton = true;
                                        let winnerAfterEnaledSpinner = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId}, {
                                            $set: {
                                                //'winners.$[current].playerName': "david",
                                                'winners.$[current].enabledSpinner': true,
                                                
                                            },
                                        }, { arrayFilters: [ {"current.playerId": tChestPlayerSockets[w].id, "current.isTchest": true} ], new: true });
                                        console.log("winnerAfterEnaledSpinner--", winnerAfterEnaledSpinner.winners, {"current.playerId": tChestPlayerSockets[w]._id, "current.isTchest": true})
                                    }
                                }
                            }

                            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('ActivateMiniGame', {
                                gameId: gameId,
                                playerId: sendTChest,
                                miniGameType: "treasureChest",
                                isForAdmin: false
                            });
                           
                            Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                $set: {
                                    'otherData.isMinigameActivated': true,
                                    'otherData.isMinigamePlayed': false,
                                    'otherData.isMinigameFinished': false,
                                    'otherData.isSpinByAdmin': false,
                                    'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                                }
                            });
                        }else{
                            sendTChest = tchestOpenBy;
                        }

                        let tempIndex = Sys.Timers.indexOf(gameId.toString());
                        if (tempIndex !== -1) {
                            if (Timeout.exists(gameId.toString())) {
                                console.log("timeout already exists check in new timer set up", gameId.toString())
                                return {
                                    "status": "fail",
                                    "message": "Mini Game is already started."
                                };
                            }
                            Sys.Timers.splice(tempIndex, 1);
                        }
                        let indexId = Sys.Timers.push(gameId.toString());
                        console.log("indexId---", indexId);

                        Timeout.set(Sys.Timers[(indexId - 1)], async () => {
                            try {
                                let index = Sys.Timers.indexOf(gameId.toString());
                                if (index !== -1) {
                                    Timeout.clear(Sys.Timers[index], erase = true);
                                    Sys.Timers.splice(index, 1);
                                }

                                console.log("SelectTreasureChest called from game");
                                module.exports.SelectTreasureChest(null, {playerId: sendTChest, gameId: gameId, playerType: "Auto"})
                            } catch (e) {
                                console.log("error in timeout of game 1 start", e);
                            }

                        }, ( 10000 ));
                        
                    }else{
                        
                        if(!tchestOpenBy){
                            console.log("Physical player won the Treasure chest.");
                            let physicalTicketNum = tChestWinnersPlayers.map(e => e.ticketNumber);
                            
                            await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId}, {
                                $set: {
                                    'winners.$[current].enabledSpinner': true,
                                },
                            }, { arrayFilters: [ {"current.playerId": tChestWinnersPlayers[0].playerId, "current.isTchest": true} ], new: true });
                            
                            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('ActivateMiniGame', {
                                gameId: gameId,
                                playerId: tChestWinnersPlayers[0].playerId,
                                miniGameType: "treasureChest",
                                isForAdmin: true
                            });
                            
                            Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                $set: {
                                    'otherData.isMinigameActivated': true,
                                    'otherData.isMinigamePlayed': false,
                                    'otherData.isMinigameFinished': false,
                                    'otherData.isSpinByAdmin': true,
                                    'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                                }
                            });
                        }

                        // let tempIndex = Sys.Timers.indexOf(gameId.toString());
                        // if (tempIndex !== -1) {
                        //     if (Timeout.exists(gameId.toString())) {
                        //         console.log("timeout already exists check in new timer set up", gameId.toString())
                        //         return {
                        //             "status": "fail",
                        //             "message": "Mini Game is already started."
                        //         };
                        //     }
                        //     Sys.Timers.splice(tempIndex, 1);
                        // }
                        // let indexId = Sys.Timers.push(gameId.toString());
                        // console.log("indexId---", indexId);

                        // Timeout.set(Sys.Timers[(indexId - 1)], async () => {
                        //     try {
                        //         let index = Sys.Timers.indexOf(gameId.toString());
                        //         if (index !== -1) {
                        //             Timeout.clear(Sys.Timers[index], erase = true);
                        //             Sys.Timers.splice(index, 1);
                        //         }

                        //         console.log("SelectTreasureChest called from game");
                        //         module.exports.SelectTreasureChest(null, {playerId: tChestWinnersPlayers[0].playerId, gameId: gameId, playerType: "Auto"})
                        //     } catch (e) {
                        //         console.log("error in timeout of game 1 start", e);
                        //     }

                        // }, ( 10000 ));
                        
                    }
                    
                }else if(mysteryWinners.length >= 1){
                    let isNeedToSet = false;
                    // Check if mysteryGameResults exists and is not empty
                    if (!winnersExtra[0]?.otherData?.mysteryGameResults || Object.keys(winnersExtra[0].otherData.mysteryGameResults).length === 0) {
                        isNeedToSet = true;
                    }
                    
                    if(isNeedToSet == true){console.log("need to set mystery data")
                        let setData = await module.exports.setMysteryData({gameId: gameId});
                        if(setData && setData.status == "success"){
                            console.log("mystery game data is set")
                        }else{
                            refreshGameWithoutCountDown(gameId, winnersExtra[0]?.halls, 5000, winnersExtra[0]?.parentGameId);
                            return true;
                        }
                    }
                    
                   // check if only physical winners
                   let onlinePlayerCount = mysteryWinnersPlayers.filter(e => (e.playerType == "Unique" || e.playerType == "Online" ) ).length;
                   console.log("onlinePlayerCount---", onlinePlayerCount)
                   if(onlinePlayerCount > 0){
                       let physicalPlayerIds =  mysteryWinnersPlayers.filter(row => row.playerType == "Physical").map(ele=>ele.playerId);
                       console.log("physical and all playerIds ",mysteryWinners, physicalPlayerIds)
                       if(physicalPlayerIds.length > 0){
                           mysteryWinners = mysteryWinners.filter((item) => !physicalPlayerIds.includes(item));
                       }
                       console.log("after removing physical winner", mysteryWinners);

                       let sendMys;
                       let mysteryTurnCounts = 0;
                       if(!mysteryplayedBy){
                           sendMys = mysteryWinners[Math.floor(Math.random() * mysteryWinners.length)];
                           console.log("sendMys---", sendMys);

                           let mysPlayerSockets = await Sys.Game.Common.Services.PlayerServices.getByDataPlayers({ "_id": { $in: mysteryWinners } }, { socketId: 1 });
                           console.log("mysPlayerSockets", mysPlayerSockets)
                           if(mysPlayerSockets.length > 0){
                               for(w =0; w < mysPlayerSockets.length; w++){
                                   console.log("socketId", "/Game1#"+ mysPlayerSockets[w].socketId);
                                   //let showSpinnerButton = false;
                                   if(mysPlayerSockets[w]._id == sendMys){
                                       //showSpinnerButton = true;
                                       let winnerAfterEnaledSpinner = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId}, {
                                           $set: {
                                               //'winners.$[current].playerName': "david",
                                               'winners.$[current].enabledSpinner': true,
                                               
                                           },
                                       }, { arrayFilters: [ {"current.playerId": mysPlayerSockets[w].id, "current.isMys": true} ], new: true });
                                       console.log("winnerAfterEnaledSpinner--", winnerAfterEnaledSpinner.winners, {"current.playerId": mysPlayerSockets[w]._id, "current.isMys": true})
                                   }
                                   
                               }
                           }

                           Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('ActivateMiniGame', {
                               gameId: gameId,
                               playerId: sendMys,
                               miniGameType: "Mystery",
                               isForAdmin: false
                           });
                           
                           Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                               $set: {
                                   'otherData.isMinigameActivated': true,
                                   'otherData.isMinigamePlayed': false,
                                   'otherData.isMinigameFinished': false,
                                   'otherData.isSpinByAdmin': false,
                                   'otherData.isMinigameInProgress': true,
                                   'otherData.mysteryTurnCounts': 0,
                                   'otherData.mysteryHistory': [],
                                   'otherData.mysteryStartTimeMs': (new Date()).getTime(),
                               }
                           });
                           mysteryTurnCounts = 1;
                       }else{
                           sendMys = mysteryplayedBy;
                           mysteryTurnCounts = (+winnersExtra[0].otherData.mysteryTurnCounts)+1
                           console.log("mystery player laready found", sendMys, mysteryTurnCounts)
                       }

                       if(mysteryTurnCounts > 5){
                           module.exports.mysteryGameFinished(null, {playerId: sendMys, gameId: gameId, playerType: "Real", turnCount: mysteryTurnCounts});
                       }

                       let tempIndex = Sys.Timers.indexOf(gameId.toString());
                       if (tempIndex !== -1) {
                           if (Timeout.exists(gameId.toString())) {
                               console.log("timeout already exists check in new timer set up", gameId.toString())
                               return {
                                   "status": "fail",
                                   "message": "Mini Game is already started."
                               };
                           }
                           Sys.Timers.splice(tempIndex, 1);
                       }
                       let indexId = Sys.Timers.push(gameId.toString());
                       console.log("indexId of mystery turn from timeout not found---", indexId);

                       Timeout.set(Sys.Timers[(indexId - 1)], async () => {
                           try {
                               let index = Sys.Timers.indexOf(gameId.toString());
                               if (index !== -1) {
                                   Timeout.clear(Sys.Timers[index], erase = true);
                                   Sys.Timers.splice(index, 1);
                               }
                               
                               let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                               Sys.Log.info("room in mystery game from timeout not found"+ room)
                               if(room && room.otherData.isMinigameFinished == false){
                                   module.exports.selectMysteryAuto(null, {playerId: sendMys, gameId: gameId, playerType: "Auto", turnCount: mysteryTurnCounts, isHigherNumber: true});
                               }else{
                                   return false;
                               }
                           } catch (e) {
                               console.log("error in timeout of game 1 start", e);
                           }

                       }, ( 10000 ));


                   }else{
                       console.log("Physical player won the Mystery.");
                       let mysteryTurnCounts = 0;
                       if(!mysteryplayedBy){
                           let physicalTicketNum = mysteryWinnersPlayers.map(e => e.ticketNumber);
                       
                           await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId}, {
                               $set: {
                                   'winners.$[current].enabledSpinner': true,
                               },
                           }, { arrayFilters: [ {"current.playerId": mysteryWinnersPlayers[0].playerId, "current.isMys": true} ], new: true });
                           Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('ActivateMiniGame', {
                               gameId: gameId,
                               playerId: mysteryWinnersPlayers[0].playerId,
                               miniGameType: "Mystery",
                               isForAdmin: true
                           });

                           Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                               $set: {
                                   'otherData.isMinigameActivated': true,
                                   'otherData.isMinigamePlayed': false,
                                   'otherData.isMinigameFinished': false,
                                   'otherData.isSpinByAdmin': true,
                                   'otherData.isMinigameInProgress': true,
                                   'otherData.mysteryTurnCounts': 0,
                                   'otherData.mysteryHistory': [],
                                   'otherData.mysteryStartTimeMs': (new Date()).getTime(),
                               }
                           });
                           mysteryTurnCounts = 1;
                       }else{
                           mysteryTurnCounts = (+winnersExtra[0].otherData.mysteryTurnCounts)+1
                       }
                       
                       if(mysteryTurnCounts > 5){
                           module.exports.mysteryGameFinished(null, {playerId: mysteryWinnersPlayers[0].playerId, gameId: gameId, playerType: "Admin", turnCount: mysteryTurnCounts});
                       }
                      
                    //    let tempIndex = Sys.Timers.indexOf(gameId.toString());
                    //    if (tempIndex !== -1) {
                    //        if (Timeout.exists(gameId.toString())) {
                    //            console.log("timeout already exists check in new timer set up", gameId.toString())
                    //            return {
                    //                "status": "fail",
                    //                "message": "Mini Game is already started."
                    //            };
                    //        }
                    //        Sys.Timers.splice(tempIndex, 1);
                    //    }
                    //    let indexId = Sys.Timers.push(gameId.toString());
                    //    console.log("indexId---", indexId);

                    //    Timeout.set(Sys.Timers[(indexId - 1)], async () => {
                    //        try {
                    //            let index = Sys.Timers.indexOf(gameId.toString());
                    //            if (index !== -1) {
                    //                Timeout.clear(Sys.Timers[index], erase = true);
                    //                Sys.Timers.splice(index, 1);
                    //            }

                    //            let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                    //            Sys.Log.info("room in mystery game"+ room)
                    //            if(room && room.otherData.isMinigameFinished == false){
                    //                module.exports.selectMysteryAuto(null, {playerId: mysteryWinnersPlayers[0].playerId, gameId: gameId, playerType: "Auto", turnCount: 1, isHigherNumber: true});
                    //            }else{
                    //                return false;
                    //            }
                    //        } catch (e) {
                    //            console.log("error in timeout of game 1 start", e);
                    //        }

                    //    }, ( 10000 ));

                       
                   }
                    
                }else if(colorDraftWinners.length >= 1){
                    
                    let isNeedToSet = false;
                    // Check if mysteryGameResults exists and is not empty
                    if (!winnersExtra[0]?.otherData?.miniGameResults || Object.keys(winnersExtra[0].otherData.miniGameResults).length === 0) {
                        isNeedToSet = true;
                    }
                    
                    if(isNeedToSet == true){console.log("need to set color draft data")
                        let setData = await module.exports.setColorDraftData({gameId: gameId})
                        if(setData && setData.status == "success"){
                            console.log("color draft game data is set")
                        }else{
                            refreshGameWithoutCountDown(gameId, winnersExtra[0]?.halls, 5000, winnersExtra[0]?.parentGameId);
                            return true;
                        }
                    }

                    // check if only physical winners
                    let onlinePlayerCount = colorDraftWinnersPlayers.filter(e => (e.playerType == "Unique" || e.playerType == "Online" ) ).length;
                    console.log("onlinePlayerCount---", onlinePlayerCount)
                    if(onlinePlayerCount > 0){
                        let sendColorDraft; 
                        let cdTurnCounts = 0;
                        
                        if(!colorDrPlayedBy){
                            let physicalPlayerIds =  colorDraftWinnersPlayers.filter(row => row.playerType == "Physical").map(ele=>ele.playerId);
                            console.log("physical and all playerIds ",colorDraftWinners, physicalPlayerIds)
                            if(physicalPlayerIds.length > 0){
                                colorDraftWinners = colorDraftWinners.filter((item) => !physicalPlayerIds.includes(item));
                            }
                            console.log("after removing physical winner", colorDraftWinners);

                            sendColorDraft = colorDraftWinners[Math.floor(Math.random() * colorDraftWinners.length)];
                            console.log("sendColorDraft---", sendColorDraft);

                            let mysPlayerSockets = await Sys.Game.Common.Services.PlayerServices.getByDataPlayers({ "_id": { $in: colorDraftWinners } }, { socketId: 1 });
                            console.log("mysPlayerSockets", mysPlayerSockets)
                            if(mysPlayerSockets.length > 0){
                                for(w =0; w < mysPlayerSockets.length; w++){
                                    console.log("socketId", "/Game1#"+ mysPlayerSockets[w].socketId);
                                    //let showSpinnerButton = false;
                                    if(mysPlayerSockets[w]._id == sendColorDraft){
                                        //showSpinnerButton = true;
                                        let winnerAfterEnaledSpinner = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId}, {
                                            $set: {
                                                //'winners.$[current].playerName': "david",
                                                'winners.$[current].enabledSpinner': true,
                                                
                                            },
                                        }, { arrayFilters: [ {"current.playerId": mysPlayerSockets[w].id, "current.isColorDraft": true} ], new: true });
                                        console.log("winnerAfterEnaledSpinner--", winnerAfterEnaledSpinner.winners, {"current.playerId": mysPlayerSockets[w]._id, "current.isColorDraft": true})
                                    }
                                    
                                }
                            }

                            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('ActivateMiniGame', {
                                gameId: gameId,
                                playerId: sendColorDraft,
                                miniGameType: "Color Draft",
                                isForAdmin: false
                            });
                            
                            Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                $set: {
                                    'otherData.isMinigameActivated': true,
                                    'otherData.isMinigamePlayed': false,
                                    'otherData.isMinigameFinished': false,
                                    'otherData.isSpinByAdmin': false,
                                    'otherData.isMinigameInProgress': true,
                                    'otherData.miniGameturnCounts': 0,
                                    'otherData.miniGameHistory': [],
                                    'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                                }
                            });
                            cdTurnCounts = 1;
                        }else{
                            sendColorDraft = colorDrPlayedBy;
                            cdTurnCounts = (+winnersExtra[0].otherData.miniGameHistory.length)+1;
                        }
                        
                        let isMinigameOver = false;
                        if(winnersExtra[0].otherData.miniGameHistory.length == 2){
                            
                            if(winnersExtra[0].otherData.miniGameHistory[0].color == winnersExtra[0].otherData.miniGameHistory[1].color){
                                isMinigameOver = true;
                            }
                        }else if(winnersExtra[0].otherData.miniGameHistory.length > 2){
                            isMinigameOver = true;
                        }

                        if(isMinigameOver == true || winnersExtra[0].otherData.miniGameHistory.length >= 3){
                            module.exports.colordraftGameFinished(null, {playerId: sendColorDraft, gameId: gameId, playerType: "Real", turnCount: winnersExtra[0].otherData.miniGameHistory.length});
                            console.log("minigame is finished")
                        }

                        let tempIndex = Sys.Timers.indexOf(gameId.toString());
                        if (tempIndex !== -1) {
                            if (Timeout.exists(gameId.toString())) {
                                console.log("timeout already exists check in new timer set up", gameId.toString())
                            }
                            Sys.Timers.splice(tempIndex, 1);
                        }
                        let indexId = Sys.Timers.push(gameId.toString());
                        console.log("indexId---", indexId);

                        Timeout.set(Sys.Timers[(indexId - 1)], async () => {
                            try {
                                let index = Sys.Timers.indexOf(gameId.toString());
                                if (index !== -1) {
                                    Timeout.clear(Sys.Timers[index], erase = true);
                                    Sys.Timers.splice(index, 1);
                                }

                                let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                                Sys.Log.info("room in color draft game"+ room)
                                if(room && room.otherData.isMinigameFinished == false){
                                    let allIndex = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
                                    let selectedIndex = allIndex[Math.floor(fortuna.random() * allIndex.length)];
                                    module.exports.selectColorDraftAuto(null, {playerId: sendColorDraft, gameId: gameId, playerType: "Auto", turnCount: room.otherData.miniGameHistory.length+1, selectedIndex: selectedIndex});
                                }else{
                                    return false;
                                }
                            } catch (e) {
                                console.log("error in timeout of game 1 start", e);
                            }

                        }, ( 10000 ));

                    }else{
                        console.log("Physical player won the Color Draft.");
                        if(!colorDrPlayedBy){
                            let physicalTicketNum = colorDraftWinnersPlayers.map(e => e.ticketNumber);
                        
                            await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameId}, {
                                $set: {
                                    'winners.$[current].enabledSpinner': true,
                                },
                            }, { arrayFilters: [ {"current.playerId": colorDraftWinnersPlayers[0].playerId, "current.isMys": true} ], new: true });
                            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('ActivateMiniGame', {
                                gameId: gameId,
                                playerId: colorDraftWinnersPlayers[0].playerId,
                                miniGameType: "Color Draft",
                                isForAdmin: true
                            });

                            Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                $set: {
                                    'otherData.isMinigameActivated': true,
                                    'otherData.isMinigamePlayed': false,
                                    'otherData.isMinigameFinished': false,
                                    'otherData.isSpinByAdmin': true,
                                    'otherData.isMinigameInProgress': true,
                                    'otherData.miniGameturnCounts': 0,
                                    'otherData.miniGameHistory': [],
                                    'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                                }
                            });
                        }
                        
                        let isMinigameOver = false;
                        if(winnersExtra?.otherData?.miniGameHistory?.length == 2){
                            console.log("winnersExtra.otherData.miniGameHistory---", winnersExtra.otherData.miniGameHistory, winnersExtra.otherData.miniGameHistory[0], winnersExtra.otherData.miniGameHistory[1])
                            if(winnersExtra.otherData.miniGameHistory[0].color == winnersExtra.otherData.miniGameHistory[1].color){
                                isMinigameOver = true;
                            }
                        }else if(winnersExtra?.otherData?.miniGameHistory?.length > 2){
                            isMinigameOver = true;
                        }

                        if(isMinigameOver == true || winnersExtra?.otherData?.miniGameHistory?.length >= 3){
                            module.exports.colordraftGameFinished(null, {playerId: colorDraftWinnersPlayers[0].playerId, gameId: gameId, playerType: "Admin", turnCount: winnersExtra.otherData.miniGameHistory.length});
                            console.log("minigame is finished")
                        }

                        // let tempIndex = Sys.Timers.indexOf(gameId.toString());
                        // if (tempIndex !== -1) {
                        //     if (Timeout.exists(gameId.toString())) {
                        //         console.log("timeout already exists check in new timer set up", gameId.toString())
                        //         return {
                        //             "status": "fail",
                        //             "message": "Mini Game is already started."
                        //         };
                        //     }
                        //     Sys.Timers.splice(tempIndex, 1);
                        // }
                        // let indexId = Sys.Timers.push(gameId.toString());
                        // console.log("indexId---", indexId);

                        // Timeout.set(Sys.Timers[(indexId - 1)], async () => {
                        //     try {
                        //         let index = Sys.Timers.indexOf(gameId.toString());
                        //         if (index !== -1) {
                        //             Timeout.clear(Sys.Timers[index], erase = true);
                        //             Sys.Timers.splice(index, 1);
                        //         }

                        //         let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                        //         Sys.Log.info("room in color draft game"+ room)
                        //         if(room && room.otherData.isMinigameFinished == false){
                        //             let allIndex = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
                        //             let selectedIndex = allIndex[Math.floor(fortuna.random() * allIndex.length)];
                        //             module.exports.selectColorDraftAuto(null, {playerId: colorDraftWinnersPlayers[0].playerId, gameId: gameId, playerType: "Auto", turnCount: (+room.otherData.miniGameHistory.length)+1, selectedIndex: selectedIndex});
                        //         }else{
                        //             return false;
                        //         }

                        //     } catch (e) {
                        //         console.log("error in timeout of game 1 start", e);
                        //     }

                        // }, ( 10000 ));
                        
                    }
                    
                }else{
                    console.log("Online or Unique userType WOF winner not found.");
                    await Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                        $set: {
                            'otherData.isMinigameFinished': true, 
                            'otherData.gameSecondaryStatus': 'finish',
                        }
                    });
                    setTimeout(function () {
                        Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
                        winnersExtra[0]?.halls.forEach(hall => {
                                Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
                            })
                    },5000);
                }
            
            }
           
        }catch(e){
            console.error("error in check for minigames", e);
        }
    },

    initGame1: async function(){
        try{
            let query = {
                gameType: 'game_1', stopGame: false, 'otherData.isClosed': false, 
                $or : [{
                    "status": "finish",
                    "otherData.gameSecondaryStatus": "running",
                },{
                    "status": "running",
                }],
            }
            await Sys.Game.Common.Services.GameServices.updateManyData(query, { $set: { 'otherData.isPaused': true } });
            return true;
        }catch(e){
            Console.log("Error in initialising game 1");
        }
    },

}


function groupBy( array , f ){
    let groups = {};
    array.forEach( function( o )
    {
        let group = JSON.stringify( f(o) );
        groups[group] = groups[group] || [];
        groups[group].push( o );  
    });
    return Object.keys(groups).map( function( group )
    {
        return groups[group]; 
    })
}

function pauseTimeout(roomId) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            if (Timeout.exists(roomId.toString())) {
                Timeout.pause(roomId.toString());
                console.log(`Paused timeout for game ID second time: ${roomId}`);
                resolve({status: "success"});
            } else {
                reject({status: "fail", message: 'Something went wrong, please try again'});
            }
        }, 3000);
    });
}

// Function to determine ball color
/* const getBallColor = (ball) => {
    if (ball <= 15) return "blue";
    else if (ball <= 30) return "red";
    else if (ball <= 45) return "purple";
    else if (ball <= 60) return "green";
    return "yellow";
}; */
const getBallColor = b =>["blue", "red", "purple", "green", "yellow"][Math.min((b - 1) / 15 | 0, 4)];

/**
 * Function to get the highest winning price for a given pattern.
 * @param {{allWinningOptions: Array<{winning: Object<string, number>}>, pattern: string, defaultValue: number}} options
 * @returns {number} The highest winning price for the given pattern.
 */
async function getJackpotHighestPrice({ allWinningOptions = [], pattern, defaultValue = 0 }) {
    try {
        // Reduce the array of winning options to find the highest winning price
        return allWinningOptions.reduce((max, { winning }) => {
            // Get the winning amount for the current pattern
            const amount = Number(winning?.[pattern]) || 0;
            // Return the maximum of the current max and the current amount
            return Math.max(max, amount);
        }, defaultValue);
    } catch (error) {
        // Log the error
        console.error("Error in getJackpotHighestPrice:", error);
        // Return the default value
        return defaultValue;
    }
}

async function checkWinningPattern(winningType, ticketIds, gameId) {
    let aggregationPipeline = [
        { $match: { gameType: "game_1", gameId: gameId.toString(), _id: { $in: ticketIds } } }, // Fetch only relevant tickets
        { 
            $project: {
                ticketId: 1,
                playerIdOfPurchaser: 1,
                playerNameOfPurchaser: 1,
                ticketPrice: 1,
                ticketColorType: 1,
                ticketColorName: 1,
                luckyNumber: 1,
                userType: 1, 
                hallName: 1,
                hallId: 1,
                groupHallName: 1,
                groupHallId: 1,
                userTicketType: 1,
                tickets: 1,
                rowChecks: {
                    $map: {
                        input: "$tickets",
                        as: "row",
                        in: { $size: { $filter: { input: "$$row", as: "cell", cond: { $eq: ["$$cell.checked", true] } } } }
                    }
                },
                columnChecks: (winningType === "Row 1") ? {
                    $map: {
                        input: [0, 1, 2, 3, 4], // Column indices
                        as: "colIdx",
                        in: {
                            $size: {
                                $filter: {
                                    input: "$tickets", // Loop over rows
                                    as: "row",
                                    cond: {
                                        $eq: [{ $arrayElemAt: ["$$row.checked", "$$colIdx"] }, true] // Extract `.checked`
                                    }
                                }
                            }
                        }
                    }
                } : "$$REMOVE" // Remove column checks for other types
            }
        }
    ];
    
    let matchCondition = {};
    
    switch (winningType) {
        case "Row 1":
            matchCondition = { $or: [
                { rowChecks: { $in: [5] } },  // Any row fully checked
                { columnChecks: { $in: [5] } } // Any column fully checked
            ]};
            break;
        case "Row 2":
            matchCondition = { $expr: { $gte: [{ $size: { $filter: { input: "$rowChecks", cond: { $eq: ["$$this", 5] } } } }, 2] } };
            break;
        case "Row 3":
            matchCondition = { $expr: { $gte: [{ $size: { $filter: { input: "$rowChecks", cond: { $eq: ["$$this", 5] } } } }, 3] } };
            break;
        case "Row 4":
            matchCondition = { $expr: { $gte: [{ $size: { $filter: { input: "$rowChecks", cond: { $eq: ["$$this", 5] } } } }, 4] } };
            break;
        case "Full House":
            matchCondition = { $expr: { $eq: [{ $size: { $filter: { input: "$rowChecks", cond: { $eq: ["$$this", 5] } } } }, 5] } };
            break;
        default:
            return []; // Invalid winningType, return empty result
    }
    
    aggregationPipeline.push({ $match: matchCondition });
    
    let winners = await Sys.Game.Game1.Services.GameServices.aggregateQueryTickets(aggregationPipeline);
    console.log("winners length", winners.length);
    return winners;
}

async function checkTVExtraWinningPattern(winningType, ticketIds, gameId) {
    const framePositions = [
        "0:0", "0:1", "0:2", "0:3", "0:4",
        "1:0", "1:4", "2:0", "2:4", "3:0", "3:4",
        "4:0", "4:1", "4:2", "4:3", "4:4"
    ];

    const picturePositions = [
        "1:1", "1:2", "1:3",
        "2:1", "2:2", "2:3",
        "3:1", "3:2", "3:3"
    ];

    const aggregationPipeline = [
        { 
            $match: { 
                gameType: "game_1", 
                gameId: gameId.toString(), 
                _id: { $in: ticketIds } 
            } 
        },
        { 
            $project: {
                ticketId: 1,
                playerIdOfPurchaser: 1,
                playerNameOfPurchaser: 1,
                ticketPrice: 1,
                ticketColorType: 1,
                ticketColorName: 1,
                luckyNumber: 1,
                userType: 1, 
                hallName: 1,
                hallId: 1,
                groupHallName: 1,
                groupHallId: 1,
                userTicketType: 1,
                tickets: 1,
                checkedPositions: {
                    $reduce: {
                        input: "$tickets",
                        initialValue: [],
                        in: {
                            $concatArrays: [
                                "$$value",
                                {
                                    $filter: {
                                        input: {
                                            $map: {
                                                input: { $range: [0, { $size: "$$this" }] }, 
                                                as: "colIdx",
                                                in: {
                                                    $cond: {
                                                        if: { $eq: [{ $arrayElemAt: ["$$this.checked", "$$colIdx"] }, true] },
                                                        then: [{ $concat: [{ $toString: { $indexOfArray: ["$tickets", "$$this"] } }, ":", { $toString: "$$colIdx" }] }],
                                                        else: []
                                                    }
                                                }
                                            }
                                        },
                                        as: "pos",
                                        cond: { $ne: ["$$pos", []] }
                                    }
                                }
                            ]
                        }
                    }
                }
            }
        },
        {
            $set: {
                checkedPositions: {
                    $reduce: {
                        input: "$checkedPositions",
                        initialValue: [],
                        in: { $concatArrays: ["$$value", "$$this"] }
                    }
                },

            }
        },
        {
            $set: {
                frameCount: winningType.includes("Frame") 
                    ? { $size: { $setIntersection: ["$checkedPositions", framePositions] } } 
                    : "$$REMOVE",
                pictureCount: winningType.includes("Picture") 
                    ? { $size: { $setIntersection: ["$checkedPositions", picturePositions] } } 
                    : "$$REMOVE",
                fullHouseCount: { $size: "$checkedPositions" }
                // fullHouseCount: winningType.includes("Full House") 
                //     ? { $size: "$checkedPositions" } 
                //     : "$$REMOVE"
            }
        },
       
    ];

    //  Apply `$or` to allow any condition to be met
    const matchConditions = [];
    if (winningType.includes("Frame")) matchConditions.push({ frameCount: { $gte: 16 } });
    if (winningType.includes("Picture")) matchConditions.push({ pictureCount: { $gte: 9 } });
    if (winningType.includes("Full House")) matchConditions.push({ fullHouseCount: { $eq: 25 } });

    if (matchConditions.length > 0) {
        aggregationPipeline.push({ $match: { $or: matchConditions } });
    }

    let winners = await Sys.Game.Game1.Services.GameServices.aggregateQueryTickets(aggregationPipeline);
   
    if (winners.length > 0) {
        winners = processWinners(winners);
    }
    console.log("Winners length:", winners.length);
    return winners;
}

function processWinners(winners) {
    return winners.map(winner => {
        return [
            winner.frameCount >= 16 ? { ...winner, wonPattern: "Frame" } : null,
            winner.pictureCount >= 9 ? { ...winner, wonPattern: "Picture"} : null,
            winner.fullHouseCount === 25 ? { ...winner, wonPattern: "Full House" } : null
        ].filter(Boolean); // Remove null values
    }).flat(); // Flatten the array
}

// Game Finish

async function updatePlayerStats(players) {
    const validPlayers = players
        .filter(p => p.userType !== "Physical")
        .map(p => p.id);
    
    if (validPlayers.length > 0) {
        return Sys.Game.Game1.Services.PlayerServices.updateManyData(
            { "_id": { $in: validPlayers } },
            { $inc: { "statisticsgame1.totalGames": 1 } }
        );
    }
}

function processMultiWinnings(winnerArray) {
    return [...winnerArray.reduce((mp, o) => {
        const key = `${o.playerId}_${o.hallId}`;
        if (!mp.has(key)) {
            mp.set(key, {
                ...o,
                lineTypeArray: [],
                wonAmountArray: [],
                finalWonAmount: 0,
                lineTypeArrayDisplay: []
            });
        }
        const current = mp.get(key);
        current.finalWonAmount = Math.round(current.finalWonAmount + +o.wonAmount);
        current.lineTypeArray.push(o.lineTypeDisplay);
        current.wonAmountArray.push(+o.wonAmount.toFixed(4));
        current.lineTypeArrayDisplay.push({
            lineType: o.lineTypeDisplay,
            lineTypeAmount: +o.wonAmount.toFixed(4)
        });
        return mp;
    }, new Map()).values()];
}

async function distributeMultiWinnings(MultiWinning, room) {
    try {
        let bulkArr = [];
        let winningNotificationBroadcast = [];
        let allWinnersArray = [];
        let processedPlayerIds = new Map();
        let gameUpdates = [];

        const gameUpdatePromises = MultiWinning.map(async (winner) => {
            try {
                allWinnersArray.push(winner.playerId);

                if (winner.userType === "Physical") {
                    gameUpdates.push({
                        updateOne: {
                            filter: { _id: room._id },
                            update: { $inc: { totalWinning: winner.finalWonAmount, finalGameProfitAmount: -winner.finalWonAmount } }
                        }
                    });
                } else {
                    const currentPlayer = await Sys.Game.Game1.Services.PlayerServices.getOneByData(
                        { _id: winner.playerId },
                        { username: 1, walletAmount: 1, enableNotification: 1, socketId: 1, firebaseToken: 1, selectedLanguage: 1 }
                    );

                    if (!currentPlayer) return;

                    let isStatisticsgame1Counted = processedPlayerIds.has(winner.playerId);
                    processedPlayerIds.set(winner.playerId, true);

                    let transactionDataSend = {
                        playerId: winner.playerId,
                        playerName: currentPlayer.username,
                        gameId: room._id,
                        ticketId: winner.ticketId,
                        ticketNumber: winner.ticketNumber,
                        count: room.withdrawNumberArray.length,
                        transactionSlug: "patternPrizeGame1",
                        action: "credit",
                        purchasedSlug: "realMoney",
                        patternPrize: winner.finalWonAmount,
                        gameNumber: room.gameNumber,
                        gameType: room.gameType,
                        gameStartDate: room.startDate,
                        gameMode: room.gameMode,
                        previousBalance: +currentPlayer.walletAmount.toFixed(4),
                        variantGame: room.subGames[0].gameName,
                        ticketPrice: winner.ticketPrice,
                        ticketColorType: winner.ticketColorName,
                        hall: {
                            id: winner.hallId,
                            name: winner.hallName
                        },
                        groupHall: {
                            id: winner.groupHallId,
                            name: winner.groupHallName
                        },
                        isStatisticsgame1Counted
                    };

                    let transactionPromise = Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);
                    Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                        type: "winning",
                        playerId: winner.playerId,
                        hallId: winner.hallId,
                        winning: winner.finalWonAmount
                    });
                    await updatePlayerHallSpendingData({ playerId: winner.playerId, hallId: winner.hallId, amount: winner.finalWonAmount, type: 'normal', gameStatus: 3 });
                    gameUpdates.push({
                        updateOne: {
                            filter: { _id: room._id },
                            update: { $inc: { totalWinning: winner.finalWonAmount, finalGameProfitAmount: -winner.finalWonAmount } }
                        }
                    });

                    if (currentPlayer.enableNotification) {
                        let finalLineType = [...new Set(winner.lineTypeArray)];
                        
                        let englishMessage, norwegianMessage;

                        if (room.gameName === "Wheel of Fortune" && finalLineType.length === 1 && finalLineType.includes("Full House")) {
                            englishMessage = await translate({ key: "game1_won_pattern_fullhouse", language: 'en', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: finalLineType.join() });
                            norwegianMessage = await translate({ key: "game1_won_pattern_fullhouse", language: 'nor', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: finalLineType.join() });
                        } else {
                            englishMessage = await translate({ key: "game1_won_pattern", language: 'en', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: winner.finalWonAmount.toFixed(2), number3: finalLineType.join() });
                            norwegianMessage = await translate({ key: "game1_won_pattern", language: 'nor', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: winner.finalWonAmount.toFixed(2), number3: finalLineType.join() });
                        }

                        let notification = {
                            notificationType: 'winning',
                            message: {
                                en: englishMessage,
                                nor: norwegianMessage
                            }
                        };

                        if (finalLineType.length > 1) {
                            bulkArr.push({
                                insertOne: {
                                    document: {
                                        playerId: winner.playerId,
                                        gameId: room._id,
                                        notification
                                    }
                                }
                            });
                        }

                        winningNotificationBroadcast.push({
                            notificationType: notification.notificationType,
                            socketId: currentPlayer.socketId,
                            message: notification.message[currentPlayer.selectedLanguage]
                        });

                        // if (currentPlayer.firebaseToken) {
                        //     let message = {
                        //         notification: {
                        //             title: "Spillorama",
                        //             body: notification.message[currentPlayer.selectedLanguage]
                        //         },
                        //         token: currentPlayer.firebaseToken
                        //     };
                        //     await Sys.Helper.gameHelper.sendWinnersNotifications(message);
                        // }
                    }

                    return transactionPromise;
                }
            } catch (error) {
                console.error(`Error processing winner ${winner.playerId}:`, error);
            }
        });

        await Promise.allSettled(gameUpdatePromises);

        if (gameUpdates.length > 0) {
            await Sys.Game.Game1.Services.GameServices.bulkWriteGameData(gameUpdates, {order: false});
        }
        if (bulkArr.length > 0) {
            await Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkArr);
        }

        return { allWinnersArray, winningNotificationBroadcast };
    } catch (error) {
        console.error("Error distributing multiple winnings:", error);
    }
}

async function processTicketStats(winnerArray, gameId) {
    try {
        const ticketStats = [...winnerArray.reduce((map, winner) => {
            if (!map.has(winner.ticketId)) {
                map.set(winner.ticketId, {
                    ...winner,
                    lineTypeArray: [],
                    finalWonAmount: 0
                });
            }
            let ticket = map.get(winner.ticketId);
            ticket.finalWonAmount = Math.round(ticket.finalWonAmount + +winner.wonAmount);
            ticket.lineTypeArray.push({
                lineType: winner.lineTypeDisplay,
                wonAmount: winner.wonAmount,
                isJackpotWon: winner.isJackpotWon
            });

            return map;
        }, new Map()).values()];

        console.log("Ticket Stats of Bingo Game:", ticketStats, gameId);

        if (ticketStats.length === 0) return;

        const updatePromises = ticketStats.map(async (ticket) => {
            try {
                let winningStats = {
                    finalWonAmount: +parseFloat(ticket.finalWonAmount).toFixed(4),
                    lineTypeArray: ticket.lineTypeArray,
                    walletType: "realMoney"
                };

                console.log("Updating ticket stats:", ticket.ticketId);
                await Sys.Game.Game1.Services.GameServices.updateTicket(
                    { _id: ticket.ticketId, gameId: gameId, playerIdOfPurchaser: ticket.playerId },
                    { 
                        $set: { 
                            winningStats: winningStats, 
                            totalWinningOfTicket: +parseFloat(ticket.finalWonAmount).toFixed(4) 
                        } 
                    }
                );
            } catch (error) {
                console.error(`Error updating ticket ${ticket.ticketId}:`, error);
            }
        });

        await Promise.allSettled(updatePromises);
        console.log("All tickets updated successfully.");
    } catch (error) {
        console.error("Error processing ticket stats:", error);
    }
}

async function processLuckyNumberBonus(room) {
    try {
        let winningLuckyNumberBroadcast = [];
        let luckyNumberBonusArray = room.luckyNumberBonusWinners || [];

        console.log("Initial luckyNumberBonus", luckyNumberBonusArray);

        if (luckyNumberBonusArray.length > 0) {
            console.log("Final lucky number bonus array", room._id, luckyNumberBonusArray);

            await Sys.Game.Game1.Services.GameServices.updateGame(
                { _id: room._id },
                { $set: { luckyNumberBonusWinners: luckyNumberBonusArray } }
            );
            
            // Reduce to unique playerId and hallId combinations
            const multiLuckyBonusWinningArray = [...luckyNumberBonusArray.reduce((mp, o) => {
                const key = `${o.playerId}_${o.hallId}`;
                if (!mp.has(key)) {
                    mp.set(key, { ...o, lineTypeArray: [], wonAmountArray: [], finalWonAmount: 0 });
                }
                const current = mp.get(key);
                current.finalWonAmount = Math.round(current.finalWonAmount + +o.wonAmount);
                current.lineTypeArray.push(o.lineTypeDisplay);
                current.wonAmountArray.push(+o.wonAmount.toFixed(4));
                return mp;
            }, new Map()).values()];

            console.log("---MultiWinning of Lucky Number Bonus---", room._id, multiLuckyBonusWinningArray);

            let bulkLuckyBonusArray = [];

            // Process each winner in parallel
            const winnerPromises = multiLuckyBonusWinningArray.map(async (winner) => {
                try {
                    if (winner.userType !== "Physical") {
                        const currentPlayer = await Sys.Game.Game1.Services.PlayerServices.getOneByData(
                            { _id: winner.playerId },
                            { username: 1, walletAmount: 1, enableNotification: 1, socketId: 1, firebaseToken: 1, selectedLanguage: 1 }
                        );

                        if (currentPlayer) {
                            const transactionDataSend = {
                                playerId: winner.playerId,
                                playerName: currentPlayer.username,
                                gameId: room._id,
                                ticketId: winner.ticketId,
                                ticketNumber: winner.ticketNumber,
                                patternId: winner.bonusType,
                                patternName: winner.bonusType,
                                count: room.withdrawNumberArray.length,
                                transactionSlug: "luckyNumberPrizeGame1",
                                action: "credit",
                                purchasedSlug: "realMoney",
                                patternPrize: winner.finalWonAmount,
                                gameNumber: room.gameNumber,
                                gameType: room.gameType,
                                gameStartDate: room.startDate,
                                gameMode: room.gameMode,
                                previousBalance: +currentPlayer.walletAmount.toFixed(4),
                                variantGame: room.subGames[0].gameName,
                                ticketPrice: winner.ticketPrice,
                                ticketColorType: winner.ticketColorName,
                                hall: { id: winner.hallId, name: winner.hallName },
                                groupHall: { id: winner.groupHallId, name: winner.groupHallName }
                            };

                            return Promise.allSettled([
                                Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend),
                                Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                                    type: "winning",
                                    playerId: winner.playerId,
                                    hallId: winner.hallId,
                                    winning: winner.finalWonAmount
                                }),
                                await updatePlayerHallSpendingData({ playerId: winner.playerId, hallId: winner.hallId, amount: winner.finalWonAmount, type: 'normal', gameStatus: 3 }),
                                Sys.Game.Game1.Services.GameServices.updateGame(
                                    { _id: room._id },
                                    { $inc: { totalWinning: winner.finalWonAmount, finalGameProfitAmount: -winner.finalWonAmount } }
                                ),
                                (async () => {
                                    try {
                                        if (currentPlayer.enableNotification) {
                                            let finalLineType = [...new Set(winner.lineTypeArray)];
                                            let luckyNumberMessage = {
                                                en: await translate({
                                                    key: "game1_luckynumber_winnings",
                                                    language: "en",
                                                    isDynamic: true,
                                                    number: room.gameNumber,
                                                    number1: room.gameName,
                                                    number2: +parseFloat(winner.finalWonAmount).toFixed(2),
                                                    number3: finalLineType.join()
                                                }),
                                                nor: await translate({
                                                    key: "game1_luckynumber_winnings",
                                                    language: "nor",
                                                    isDynamic: true,
                                                    number: room.gameNumber,
                                                    number1: room.gameName,
                                                    number2: +parseFloat(winner.finalWonAmount).toFixed(2),
                                                    number3: finalLineType.join()
                                                })
                                            };

                                            let notification = {
                                                notificationType: "winning",
                                                message: luckyNumberMessage
                                            };

                                            bulkLuckyBonusArray.push({
                                                insertOne: {
                                                    document: {
                                                        playerId: winner.playerId,
                                                        gameId: room._id,
                                                        notification
                                                    }
                                                }
                                            });

                                            winningLuckyNumberBroadcast.push({
                                                notificationType: notification.notificationType,
                                                socketId: currentPlayer.socketId,
                                                message: luckyNumberMessage[currentPlayer.selectedLanguage]
                                            });

                                            
                                            // if (currentPlayer.firebaseToken) {
                                            //     let message = {
                                            //         notification: {
                                            //             title: "Spillorama",
                                            //             body: luckyNumberMessage[currentPlayer.selectedLanguage]
                                            //         },
                                            //         token: currentPlayer.firebaseToken
                                            //     };
                                            //     return Sys.Helper.gameHelper.sendWinnersNotifications(message);
                                            // }
                                        }
                                    } catch (error) {
                                        console.error("Error processing notifications:", error);
                                    }
                                })()
                            ]);
                        }
                    }
                } catch (error) {
                    console.error("Error processing winner:", error);
                }
            });

            // Wait for all winners to be processed without blocking
            await Promise.allSettled(winnerPromises);

            // Perform bulk notifications
            if (bulkLuckyBonusArray.length > 0) {
                await Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkLuckyBonusArray);
            }

            // Adjust wonAmount based on line types
            multiLuckyBonusWinningArray.forEach((winner) => {
                if (winner.lineTypeArray.length > 1) {
                    winner.wonAmount = Math.round(winner.finalWonAmount);
                }
            });

            console.log("MultiLuckyBonusWinning after final amount", multiLuckyBonusWinningArray);

            const ticketLuckyBonusStats = [...luckyNumberBonusArray.reduce((mp, o) => {
                if (!mp.has(o.ticketId)) {
                    mp.set(o.ticketId, { ...o, lineTypeArray: [], wonAmountArray: [], finalWonAmount: 0 });
                }
                const current = mp.get(o.ticketId);
                current.finalWonAmount = Math.round(current.finalWonAmount + +o.wonAmount);
                return mp;
            }, new Map()).values()];

            console.log("Ticket Lucky Bonus Stats of Bingo Game", ticketLuckyBonusStats);
            
            let bulkUpdateOps = ticketLuckyBonusStats.map((ticket) => ({
                updateOne: {
                    filter: { _id: ticket.ticketId, gameId: room._id, playerIdOfPurchaser: ticket.playerId },
                    update: {
                        $set: { 
                            luckyNumberWinningStats: { 
                                wonAmount: +parseFloat(ticket.finalWonAmount).toFixed(4), 
                                walletType: "realMoney",
                                lineType: "Lucky Number Bonus"
                            }
                        },
                        $inc: { totalWinningOfTicket: +parseFloat(ticket.finalWonAmount).toFixed(4) }
                    }
                }
            }));

            await Sys.Game.Game1.Services.GameServices.bulkWriteTicketData(bulkUpdateOps, {order: false});
        }
        return winningLuckyNumberBroadcast;
    } catch (error) {
        console.error("Error in processLuckyNumberBonus:", error);
    }
}

async function broadcastAdminResults(winnerArray, gameId, totalWithdrawCount, patternsWon) {
    try{
        let winnerAdminResultArray = [...winnerArray.reduce( (mp, o) => {
            if (!mp.has(o.lineType)) mp.set(o.lineType, { ...o, count: 0, finalWonAmount: 0, playerIdArray:[], halls: [] });
            mp.get(o.lineType).count++;
            mp.get(o.lineType).finalWonAmount= Math.round(mp.get(o.lineType).finalWonAmount + +o.wonAmount); //+parseFloat(mp.get(o.lineType).finalWonAmount + +o.wonAmount).toFixed(4) ;
            mp.get(o.lineType).playerIdArray.push({playerId: o.playerId, userType: o.userType, hallName: o.hallName, ticketNumber: o.ticketNumber, playerName: o.playerName, wonAmount: +o.wonAmount  });
            if (!mp.get(o.lineType).halls.includes(o.hallName)) {
                mp.get(o.lineType).halls.push(o.hallName);
            }
            return mp;
        }, new Map).values()];
        const fullHouseWinners = winnerAdminResultArray.reduce((sum, w) => sum + (w.isFullHouse ? w.count : 0), 0);
        
        winnerAdminResultArray = winnerAdminResultArray.map(({lineType, finalWonAmount, playerIdArray, count, halls})  => ({lineType, finalWonAmount, playerIdArray, count, halls}));
        
        await Promise.all([
            Sys.Game.Game1.Services.GameServices.updateGame(
                { _id: gameId },
                { $set: { 'otherData.winnerAdminResultArray': winnerAdminResultArray } }
            ),
            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('GameFinishAdmin', {
                totalWithdrawCount: totalWithdrawCount,
                fullHouseWinners,
                patternsWon: winnerAdminResultArray.length,
                winners: winnerAdminResultArray
            })
        ]);
    }catch(e){
        console.log("Error processing broadcastAdminResults")
    }
}

async function handleLosers(allWinnersArray, players, gameId, gameNumber, gameName) {
    try {
        const bulkLosserArr = [];
        
        const loosers = players
            .filter(player => !allWinnersArray.includes(player.id.toString()) && player.userType !== "Physical")
            .map(player => player.id);
        
        if (loosers.length === 0) {
            console.log("NO losers", gameId);
            return;
        }

        // Fetch loser players' data in a single query
        const looserPlayers = await Sys.Game.Game1.Services.PlayerServices.getByData(
            { "_id": { $in: loosers } },
            { enableNotification: 1, socketId: 1, selectedLanguage: 1 }
        );

        if (!looserPlayers.length) return;

        for(let w =0; w < looserPlayers.length; w++){
            await Sys.Io.of(Sys.Config.Namespace.Game1).to("/Game1#"+looserPlayers[w].socketId).emit('GameFinish', {
                message: await translate({key: "game1_not_won", language: looserPlayers[w].selectedLanguage}), gameId: gameId
            });
            if (looserPlayers[w].enableNotification == true) {
                let notification ={
                    notificationType:'gameFinish',
                    message: { en: await translate({key: "game1_not_won_params", language: 'en', isDynamic: true, number: gameNumber, number1: gameName}), nor: await translate({key: "game1_not_won_params", language: 'nor', isDynamic: true, number: gameNumber, number1: gameName}) }  //room.gameNumber + " [ " + room.gameName + " ] Game over & you haven't won any patterns on your ticket(s).\n Better luck next time!",

                }
                bulkLosserArr.push({
                    insertOne: {
                        document: {
                            playerId: looserPlayers[w].id,
                            gameId:gameId,
                            notification: notification
                        }
                    }
                }) 
            }
        }

        if(bulkLosserArr.length > 0){
            Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkLosserArr);
        }
        await Sys.Game.Game1.Services.PlayerServices.updateManyData({ "_id": { $in: loosers } },  { $inc: { "statisticsgame1.totalGamesLoss": 1  } });
        
    } catch (error) {
        console.error("Unexpected error handling losers:", error);
    }
}

function getPlayerIp(socket) {
    let playerIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() 
                   || socket.conn.remoteAddress;
    return playerIp?.startsWith('::ffff:') ? playerIp.slice(7) : playerIp;
}


