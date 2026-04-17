const { GridFSBucketReadStream } = require('mongodb');
const Sys = require('../../../Boot/Sys');
const fortuna = require('javascript-fortuna');
const exactMath = require('exact-math');
const Timeout = require('smart-timeout');
fortuna.init();
const { i18next, translate } = require('../../../Config/i18n');
module.exports = {
    
    StartGame: async function(gameId) {
    //StartGame: async function(SocketId, data){   
        //console.log("game starting", data.gameId)
        //let gameId = data.gameId;
        let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {players: 1, subGames: 1, seconds: 1, gameName: 1, parentGameId: 1, earnedFromTickets: 1, startDate: 1});
        
        await Sys.Io.of(Sys.Config.Namespace.Game1).to(room._id).emit('GameStart', {});
    
        await Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, { $set: { status: 'running', timerStart: true, "otherData.gameSecondaryStatus": 'running' } });
        
        // update exact gamestart time in all the transaction of this game
        Sys.Game.Common.Services.PlayerServices.updateManyTransaction({gameType: "game_1", gameId: room._id },{ $set: { "otherData.exactGameStartTime": new Date(room.startDate) } });
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
        //console.log("ticketsWinningPrices---", ticketsWinningPrices, Object.assign({}, ticketsWinningPrices) )
        await Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, { $set: { ticketsWinningPrices: Object.assign({}, ticketsWinningPrices)   } });

        // save subames data end

        /*if(room.gameName == "Innsatsen"){
            let dailySchedule = await Sys.App.Services.scheduleServices.getSingleDailySchedulesData({ _id: room.parentGameId},{innsatsenSales: 1},{});
            console.log("dailySchedule---", dailySchedule.innsatsenSales);
            let innBeforeSales = +parseFloat(dailySchedule.innsatsenSales).toFixed(2);
            let fullhousePrize = +parseFloat(room.subGames[0].options[0].winning['Full House']).toFixed(2);;
            console.log("fullhousePrize & sales", fullhousePrize, innBeforeSales);

            let totalPreviousSales = innBeforeSales;

            let currentGameSalesTemp = +parseFloat(room.earnedFromTickets).toFixed(2);
            let currentGameSales = +parseFloat(exactMath.div( exactMath.mul(currentGameSalesTemp, 20),  100) ).toFixed(2);
            console.log("currentGameSales---", currentGameSales);
            //if( (innBeforeSales + fullhousePrize) < 2000 ){
                if( (innBeforeSales + fullhousePrize + currentGameSales) <= 2000 ){
                    totalPreviousSales = +parseFloat(innBeforeSales + currentGameSales).toFixed(2);
                }else{
                    let deductFromSales = (innBeforeSales + fullhousePrize + currentGameSales) - 2000; 
                    console.log("deductFromSales---", deductFromSales);
                    totalPreviousSales = +parseFloat( innBeforeSales + (currentGameSales - deductFromSales) ).toFixed(2);
                }

            // }else{

            // }
            console.log("totalPreviousSales---", totalPreviousSales)
            await Sys.App.Services.scheduleServices.updateDailySchedulesData({ _id: room.parentGameId },{
                $set: { "innsatsenSales": totalPreviousSales  }
            });
            
        }*/

        if(room.gameName == "Spillerness Spill" || room.gameName == "Spillerness Spill 2" || room.gameName == "Spillerness Spill 3"){
            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
            let patternListing = await module.exports.patternListing(room._id);
            let patternList = patternListing.patternList;
            //console.log("patternListing---", patternListing, patternList);
            //patternList = patternList.map(v => ({...v, isWon: false}));
            //console.log("after adding isWon patternChange", patternList)
            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('PatternChange',  { patternList: patternList } );
        }
        module.exports.gameInterval(gameId);
        /*let ballNumber = [];
        for (let b = 1; b <= 75; b++) {
            ballNumber.push(b);
        }

        let count = 0;
        let achiveBallArr = [];
        let history = [];

        //let subGamesData = await Sys.Game.Game1.Services.GameServices.getSingleGameData({ _id: room._id });
       
        let timerStart = setInterval(async function() {
            console.log("ballNumber length", ballNumber.length)
            let isFinished = false;
            if(count >= 24){
                isFinished = await module.exports.checkForGameFinished(room._id);
            }
            
            console.log("check game status, if already completed isFinished---", isFinished, room._id, count);
            if(ballNumber.length <= 0 || isFinished == true){
                console.log('<======= || Game was finish || =================>', timerStart);
                clearInterval(timerStart);
                let finishedResult =await module.exports.gameFinished(room._id);
                console.log("finishedResult", finishedResult)
                return false;
            }
            //[ Random Ball Pop ]
            //let withdrawBall = ballNumber[Math.floor(Math.random() * ballNumber.length)];
            let withdrawBall = ballNumber[ (Math.floor(fortuna.random() * ballNumber.length) ) ];
            ballNumber.splice(ballNumber.indexOf(withdrawBall), 1);

            //[ Ball Color Decide ]
            let withdrawColor = 'yellow';
            if (withdrawBall <= 15) {
                withdrawColor = "blue";
            } else if (withdrawBall <= 30) {
                withdrawColor = "red";
            } else if (withdrawBall <= 45) {
                withdrawColor = "purple";
            } else if (withdrawBall <= 60) {
                withdrawColor = "green";
            } 

            console.log("<=== || WithdrawBall :: ", withdrawBall, " || === || WithdrawColor :: ", withdrawColor, " || === || TotalWithdrawCount :: ", count, " || === || GAmeNUmber :: ", room._id, "==== >");
            count++;

            //[ Send Boardcast Unity with Ball + Ball color and Total withdraw count ]
            await Sys.Io.of(Sys.Config.Namespace.Game1).to(room._id).emit('WithdrawBingoBall', {
                number: withdrawBall,
                color: withdrawColor,
                totalWithdrawCount: count
            });

            //[ Once ball form array store in Achive Ball Array ]
            achiveBallArr.push(withdrawBall);

            let historyObj = {
                number: withdrawBall,
                color: withdrawColor,
                totalWithdrawCount: count
            }

            history.push(historyObj);

            // [ Reconnect Logic of Data Update in Database  ]
            await Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, {
                $set: {
                    withdrawNumberList: history,
                    withdrawNumberArray: achiveBallArr,
                }
            });
            //Send To Admin
            await Sys.Io.of('admin').emit('balls', {
                balls: history,
                id: room._id
            });
            let winners = await module.exports.checkForWinners(room._id, withdrawBall)
            Sys.Log.info("------check winners after-----:"+ room._id  )

        }, room.seconds*1000);*/
    },

    gameInterval1: async function(gameId){
        try{
            console.log("gameInterval called", gameId);
            let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, { players: 1, subGames: 1, seconds: 1, gameName: 1, parentGameId: 1, earnedFromTickets: 1, withdrawNumberArray: 1, withdrawNumberList: 1, jackpotDraw: 1, halls : 1});
            let ballNumber = [];
            for (let b = 1; b <= 75; b++) {
                if(room.withdrawNumberArray.includes(b) == false){
                    ballNumber.push(b);
                }
            }

            let count = room.withdrawNumberArray.length;
            let achiveBallArr = room.withdrawNumberArray;
            let history = room.withdrawNumberList;
            console.log("ballNumber, count, achiveBallArr,history", ballNumber, count, achiveBallArr, history)
            Sys.GameTimers[room.id] = setInterval(async function() {
                Sys.Log.info("ballNumber length and gameId: "+ ballNumber.length + " GameId: "+ gameId);
                if(count == 3){
                    console.log("ticket purchase has been disabled.")
                    await Sys.Game.Game1.Services.GameServices.updateGameNew(room._id, { $set: { disableTicketPurchase: true } });
                    //send broadcast to get updated ticket data
                    room?.halls.forEach(hall => {
                        Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
                    })
                }
                let isFinished = false;
                if(count >= 24){
                    isFinished = await module.exports.checkForGameFinished(room._id);
                }

                // To disable Jackpot Field
                if( ( room.gameName == "Jackpot" && count == (+room.jackpotDraw) ) || ( room.gameName == "Oddsen 56" && count == 56  ) || ( room.gameName == "Oddsen 57" && count == 57  ) || ( room.gameName == "Oddsen 58" && count == 58 ) ){
                    let patternRoom = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: room._id }, {winners: 1, subGames: 1, jackpotPrize: 1, jackpotDraw: 1, gameName: 1});
                    let patternListing = await module.exports.patternListing(room._id);
                    let patternList = patternListing.patternList;
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
                    await Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('PatternChange',  { patternList: finalPatternList, jackPotData: {isDisplay: false} } );
                }
                // To disable Jackpot Field

                
                Sys.Log.info("check game status, if already completed isFinished---"+ isFinished + " " + room._id + "  " + count);
                if(ballNumber.length <= 0 || isFinished == true){
                    console.log('<======= || Game was finish || =================>', Sys.GameTimers[room.id]);
                    clearInterval(Sys.GameTimers[room.id]);
                    let finishedResult =await module.exports.gameFinished(room._id);
                    console.log("finishedResult", finishedResult)
                    return false;
                }
                //[ Random Ball Pop ]
                //let withdrawBall = ballNumber[Math.floor(Math.random() * ballNumber.length)];
                let withdrawBall = ballNumber[ (Math.floor(fortuna.random() * ballNumber.length) ) ];
                ballNumber.splice(ballNumber.indexOf(withdrawBall), 1);
    
                //[ Ball Color Decide ]
                let withdrawColor = 'yellow';
                if (withdrawBall <= 15) {
                    withdrawColor = "blue";
                } else if (withdrawBall <= 30) {
                    withdrawColor = "red";
                } else if (withdrawBall <= 45) {
                    withdrawColor = "purple";
                } else if (withdrawBall <= 60) {
                    withdrawColor = "green";
                } 
    
                console.log("<=== || WithdrawBall :: ", withdrawBall, " || === || WithdrawColor :: ", withdrawColor, " || === || TotalWithdrawCount :: ", count, " || === || GAmeNUmber :: ", room._id, "==== >");
                count++;
    
                //[ Send Boardcast Unity with Ball + Ball color and Total withdraw count ]
                await Sys.Io.of(Sys.Config.Namespace.Game1).to(room._id).emit('WithdrawBingoBall', {
                    number: withdrawBall,
                    color: withdrawColor,
                    totalWithdrawCount: count
                });
    
                //[ Once ball form array store in Achive Ball Array ]
                achiveBallArr.push(withdrawBall);
    
                let historyObj = {
                    number: withdrawBall,
                    color: withdrawColor,
                    totalWithdrawCount: count
                }
    
                history.push(historyObj);
    
                // [ Reconnect Logic of Data Update in Database  ]
                await Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, {
                    $set: {
                        withdrawNumberList: history,
                        withdrawNumberArray: achiveBallArr,
                    }
                });
                //Send To Admin
                await Sys.Io.of('admin').emit('balls', {
                    balls: history,
                    id: room._id
                });
                room?.halls.forEach(hall => {
                    Sys.Io.of('admin').to(hall).emit('onGoingBalls', {
                        balls: history
                    });
                })
                let winners = await module.exports.checkForWinners(room._id, withdrawBall)
                Sys.Log.info("------check winners after-----:"+ room._id  )
    
            }, room.seconds*1000);
        }catch(e){
            console.error("error in gameInterval", e);
        }
    },

    checkForWinners:async function(gameId, withdrawBall){
        //checkForWinners: async function(SocketId, data){    
        try{
            //let gameId = data.gameId;
            //let withdrawBall = data.withdrawBall;
            Sys.Log.info('----checkForWinners start------: ' + gameId);
            let ticketIdWithdrawBall = `ticketIdForBalls.${withdrawBall}`
            let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {gameName: 1, gameNumber: 1,subGames: 1, purchasedTickets: 1, trafficLightExtraOptions: 1, winners: 1, withdrawNumberArray: 1, status: 1, luckyNumberPrize: 1, earnedFromTickets: 1, ticketsWinningPrices: 1, [ticketIdWithdrawBall]: 1, jackpotDraw: 1, jackpotPrize: 1, parentGameId: 1,halls:1});
            //console.log("tempRoom in submitTicket",gameId, room)
            // if(room){
            //     if(room.status == "finish"){
            //         console.log("Game Already Finished!");
            //         return {
            //             status: 'fail',
            //             message: "Game already Finished!"
            //         }
            //     }else if(room.status == "active" || room.status == "Waiting"){
            //         console.log("Game is not started yet!");
            //         return {
            //             status: 'fail',
            //             message: "Game is not started yet!"
            //         }
            //     }
                
            // }
            let allWinningPatterns =  Object.values(room.ticketsWinningPrices[0])[0] ;
            let allWinningPatternsWithPrize = Object.values(room.ticketsWinningPrices);
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
            //console.log("allWinningPatterns", allWinningPatterns, room.ticketIdForBalls[withdrawBall], allWinningPatternsWithPrize, JSON.stringify(allWinningPatternsWithPrize))
            
            let ticketsRelatedBall = room.ticketIdForBalls[withdrawBall];
            let bulupdateTicketData = [];
            Sys.Log.info("tickets updation start")
            if(ticketsRelatedBall.length > 0){
                for(let t=0; t < ticketsRelatedBall.length; t++){
                    let position = ticketsRelatedBall[t].position.split(':');
                    let positionKey = 'tickets.'+position[0]+'.'+position[1]+'.checked'
                    bulupdateTicketData.push({
                        updateOne: {
                            "filter" : { _id: ticketsRelatedBall[t].ticketId },
                            "update" : { $set : { [positionKey]: true } }
                        }
                    })
                }
            }
            await Sys.App.Services.GameService.bulkWriteTicketData(bulupdateTicketData);
            Sys.Log.info("tickets updated")


            let winners = [];
            let luckyNumberBonusWinners = [];
            if(allWinningPatterns.length > 0){
                let tempTicketData = await Sys.Game.Game1.Services.GameServices.getTicketListData({ gameId: gameId, _id: {$in: room.ticketIdForBalls[withdrawBall].map(function (el) { return el.ticketId; })  }}, {playerNameOfPurchaser: 1, playerIdOfPurchaser: 1, ticketId: 1, isTicketSubmitted: 1, tickets: 1, ticketPrice: 1, ticketColorType: 1, ticketColorName: 1, luckyNumber: 1, userType: 1, hallName: 1,hallId: 1,userTicketType:1, groupHallName: 1, groupHallId: 1});
                Sys.Log.info("tempTicketData"+ tempTicketData.length)
                
                if(tempTicketData.length > 0){
                    let ticketData = tempTicketData;
                    // check for winning combinations
                    let withdrawNumberArray = room.withdrawNumberArray; // [];//room.withdrawNumberArray;
                   
                    withdrawNumberArray.push(0);
                    const winningCombinations = [...new Set(room.winners.map(item => item.lineType))]
                    console.log("winningCombinations in winnercheack",gameId, winningCombinations)
                    
                    let lineTypesToCheckTemp =  allWinningPatterns.filter((item) => !winningCombinations.includes(item.pattern));
                    let lineTypesToCheck = lineTypesToCheckTemp.map(function (el) { return el.pattern; })
                    console.log("lineTypesToCheck", lineTypesToCheck);
                    if(lineTypesToCheck.length > 0){
                        
                        for(let i=0; i < ticketData.length; i++ ){
                            let currentPatternToCheck = lineTypesToCheck[0];

                            let ticket=  ticketData[i].tickets;
                            //console.log("currentPatternToCheck & tickets----",currentPatternToCheck, ticket);

                            let index =  ticketsRelatedBall.findIndex(x => x.ticketId == ticketData[i].id);
                            //console.log("index", index)
                            if(index >= 0){
                                let isWon = false;
                                let wonPattern = "";
                                let isTvExtrafullHouse = false; // to check tv extra full house
                                let wonElements = {rows: [], columns:[]};

                                if(room.gameName == "Tv Extra"){
                                    let frame = ["0:0", "0:1", "0:2", "0:3", "0:4", "1:0", "1:4", "2:0", "2:4", "3:0", "3:4", "4:0", "4:1", "4:2", "4:3", "4:4"];
                                    let picture = ["1:1", "1:2", "1:3", "2:1", "2:2", "2:3","3:1", "3:2", "3:3"];
                                    
                                    let picturePattern = true;
                                    let framePattern = true;
                                    

                                    if(lineTypesToCheck.includes("Picture") == true || lineTypesToCheck.includes("Frame") == true){
                                        //console.log("picture.includes(ticketsRelatedBall[index].position)", ticketsRelatedBall[index].position, picture.includes(ticketsRelatedBall[index].position))
                                        if(picture.includes(ticketsRelatedBall[index].position) == true && lineTypesToCheck.includes("Picture") == true ){
                                            console.log("check for picture pattern");
                                            framePattern = false;
                                            for(let p=0; p < picture.length; p++){
                                                let positionPicture = picture[p].split(':');
                                                //console.log("picture element", ticket[positionPicture[0]][positionPicture[1]])
                                                if( ticket[positionPicture[0]][positionPicture[1]].checked == false){
                                                    picturePattern = false;
                                                    break;
                                                }
                                            }
                                        }else if(frame.includes(ticketsRelatedBall[index].position) == true  && lineTypesToCheck.includes("Frame") == true ) {
                                            //console.log("check for frame pattern");
                                            picturePattern = false;
                                            for(let p=0; p < frame.length; p++){
                                                let positionFrame = frame[p].split(':');
                                                //console.log("picture element", ticket[positionFrame[0]][positionFrame[1]])
                                                if( ticket[positionFrame[0]][positionFrame[1]].checked == false){
                                                    framePattern = false;
                                                    break;
                                                }
                                            }
                                        }else{
                                            picturePattern = false;
                                            framePattern = false;
                                        }

                                        if(picturePattern == true){
                                            isWon = true;
                                            wonPattern = "Picture"
                                        }else if(framePattern == true){
                                            isWon = true;
                                            wonPattern = "Frame";

                                            // update frame winner as need to check for full house
                                            let winningAmountTemp = allWinningPatternsWithPrize[0][ticketData[i].ticketColorName];
                                            let winningAmount = winningAmountTemp.find(x => x.pattern == wonPattern ).winningValue; //currentPatternToCheck
                                            winningAmount = Math.round(winningAmount);
                                            //console.log("winningAmount of frame pattern", winningAmount )
                                            let winnerObj = {
                                                playerId: ticketData[i].playerIdOfPurchaser,
                                                playerName: ticketData[i].playerNameOfPurchaser,
                                                ticketId: ticketData[i].id,
                                                ticketNumber: ticketData[i].ticketId,
                                                lineType: wonPattern,
                                                wonAmount: winningAmount, //+parseFloat(winningAmount).toFixed(4),
                                                lineTypeDisplay: wonPattern,
                                                isFullHouse: (wonPattern == "Full House") ? true : false,
                                                ticketPrice: ticketData[i].ticketPrice,
                                                ticketColorType: ticketData[i].ticketColorType,
                                                ticketColorName: ticketData[i].ticketColorName,
                                                ballNumber: withdrawNumberArray[withdrawNumberArray.length - 2],
                                                userType: ticketData[i].userType,
                                                hallName: ticketData[i].hallName,
                                                hallId: ticketData[i].hallId,
                                                groupHallName: ticketData[i].groupHallName,
                                                groupHallId: ticketData[i].groupHallId,
                                                userTicketType: ticketData[i].userTicketType,
                                                // isJackpotWon:  (lineTypesToCheck[l].isJackpot == true ) ? lineTypesToCheck[l].isJackpot : false,
                                                isWoF : false,
                                                isTchest: false,
                                                isMys: false,
                                                isColorDraft: false,
                                                drawNumber: withdrawNumberArray.length - 1,
                                                // isGameTypeExtra: lineTypesToCheck[l].isGameTypeExtra,
                                                // isWonLuckyNumberBonus: isWonLuckyNumberBonus,
                                                
                                                wonElements: {rows: [0,4], columns:[0,4]},
                                                ticketCellArray: ticketData[i].tickets.map(ticket =>
                                                    ticket.map(item => item.Number)
                                                )
                                            }
                                            console.log("WinnerData push",wonPattern,winnerObj);
                                            winners.push(winnerObj);
                                            room?.halls.forEach(hall => {
                                                console.log("Call winnerDataRefresh",);
                                                Sys.Io.of('admin').to(hall).emit('winnerDataRefresh',winnerObj, { message: "Ticket Purchase" });
                                            })
                                            

                                            // Now check for full house pattern
                                            isWon = false;
                                            wonPattern = "";
                                            if(lineTypesToCheck.includes('Picture') == false){  // if only frame and fullhouse remained
                                                currentPatternToCheck = lineTypesToCheck[1];
                                                console.log("updated pattern to check after frame pattern for particular ticket", currentPatternToCheck, ticketData[i].id)
                                                isTvExtrafullHouse = true;
                                            }
                                            
                                        }

                                    }else{
                                        //console.log("check for full house pattern");
                                        isTvExtrafullHouse = true;
                                    }

                                }
                                //console.log("gamename and current pattern to check", room.gameName, currentPatternToCheck)
                                let winOnColumn = 0;
                                if(room.gameName != "Tv Extra" || (isTvExtrafullHouse == true && currentPatternToCheck == "Full House")  ){
                                    let position = ticketsRelatedBall[index].position.split(':');
                                    let row = position[0];
                                    let column = position[1];
                                    winOnColumn = column;
                                    //console.log("row and column", row, column)
                                    let isRowMatched = true;
                                    for(let r=0; r < ticket[row].length; r++ ){
                                        //console.log("ticket[row][r].checked", ticket[row][r])
                                        if( ticket[row][r].checked == false){
                                            isRowMatched = false;
                                            break;
                                        }
                                    }

                                    if(isRowMatched == true){
                                        wonElements.rows.push(+row);
                                    }

                                    if(currentPatternToCheck == "Row 1"){
                                        let isColumnMatched = true;
                                        if(isRowMatched == false){
                                            for(let r=0; r < ticket.length; r++ ){
                                                //console.log("ticket[r][column].checked", ticket[r][column])
                                                if(ticket[r][column].checked == false){
                                                    isColumnMatched = false;
                                                    break;
                                                }
                                                
                                            }
                                        }
                                        //console.log("isRowMatched & isColumnMatched", isRowMatched, isColumnMatched)
                                        if(isRowMatched == true || isColumnMatched == true){
                                            if(isRowMatched == false && isColumnMatched == true){
                                                console.log("Row 1 won by column");
                                                wonElements.columns.push(column);
                                            }
                                            isWon = true;
                                            wonPattern = "Row 1";
                                        }
                                    }else if( (currentPatternToCheck == "Row 2" || currentPatternToCheck == "Row 3" || currentPatternToCheck == "Row 4" || currentPatternToCheck == "Full House") && isRowMatched == true){
                                        //console.log("Now check for next row match or not")
                                        let rowsToCheck = [];
                                        for(let i=0; i < 5; i++){
                                            if(i != row){  
                                                rowsToCheck.push(i);
                                            }
                                        }
                                        console.log("rowsToCheck", rowsToCheck);
                                        let totalMatchedRow = 1;
                                        for(let i=0; i < rowsToCheck.length; i++){
                                            let nextRowMatched = true;
                                            for(let r=0; r < ticket[rowsToCheck[i]].length; r++ ){
                                                //console.log("ticket[i][r].checked", ticket[rowsToCheck[i]][r])
                                                if( ticket[rowsToCheck[i]][r].checked == false){
                                                    nextRowMatched = false;
                                                    break;
                                                }
                                            }
                                            //console.log("nextRowMatched--", nextRowMatched)
                                            if(nextRowMatched == true){
                                                totalMatchedRow += 1;
                                                wonElements.rows.push(rowsToCheck[i]);
                                            }
                                            //console.log("totalMatchedRow----", totalMatchedRow);
                                            if(currentPatternToCheck == "Row 2" && totalMatchedRow == 2){
                                                isWon = true;
                                                wonPattern = "Row 2"
                                                break;
                                            }else if(currentPatternToCheck == "Row 3" && totalMatchedRow == 3){
                                                isWon = true;
                                                wonPattern = "Row 3"
                                                break;
                                            }else if(currentPatternToCheck == "Row 4" && totalMatchedRow == 4){
                                                isWon = true;
                                                wonPattern = "Row 4"
                                                break;
                                            }else if(currentPatternToCheck == "Full House" && totalMatchedRow == 5){
                                                isWon = true;
                                                wonPattern = "Full House"
                                                break;
                                            }else{
                                                let remainedChecks = (rowsToCheck.length - i) -1 ;
                                                //console.log("remainedChecks---", remainedChecks, rowsToCheck.length, i)
                                                if(currentPatternToCheck == "Full House"){
                                                    if(remainedChecks + totalMatchedRow < 5){
                                                        //console.log("remainedChecks + totalMatchedRow is not possible for fullhouse", remainedChecks + totalMatchedRow)
                                                        break;
                                                    }
                                                }else if(currentPatternToCheck == "Row 4"){
                                                    if(remainedChecks + totalMatchedRow < 4){
                                                        //console.log("remainedChecks + totalMatchedRow is not possible for Row 4", remainedChecks + totalMatchedRow)
                                                        break;
                                                    }
                                                }else if(currentPatternToCheck == "Row 3"){
                                                    if(remainedChecks + totalMatchedRow < 3){
                                                        //console.log("remainedChecks + totalMatchedRow is not possible for Row 3", remainedChecks + totalMatchedRow)
                                                        break;
                                                    }
                                                }
                                               
                                                
                                            }
                                            
                                        }
                                        //console.log("isWon & wonPattern----", isWon, wonPattern)
                                    }
                                }
                                
                                
                                // check for winning row and update
                                if(isWon == true && wonPattern != ""){
                                    let winningAmount = 0;
                                    if(room.gameName == "Super Nils"){
                                        let winningColumn;
                                        if(winOnColumn == 0){
                                            winningColumn = "B";
                                        }else if(winOnColumn == 1){
                                            winningColumn = "I";
                                        }else if(winOnColumn == 2){
                                            winningColumn = "N";
                                        }else if(winOnColumn == 3){
                                            winningColumn = "G";
                                        }else if(winOnColumn == 4){
                                            winningColumn = "O";
                                        }
                                        let winningAmountTemp = allWinningPatternsWithPrize[0][ticketData[i].ticketColorName];
                                        //console.log("winningAmountTemp", winningAmountTemp);
                                        //console.log("winningAmountTemp1", allWinningPatternsWithPrize[0][ticketData[i].ticketColorName].winningColumn);
                                        winningAmount = winningAmountTemp.find(x => x.pattern == winningColumn ).winningValue[wonPattern]; //currentPatternToCheck
                                        console.log("final winning amount of game", winningAmount, winningColumn, wonPattern);
                                    }else if(room.gameName == "Spillerness Spill"){

                                        let winningAmountTemp = allWinningPatternsWithPrize[0][ticketData[i].ticketColorName];
                                        let winningPercentage = winningAmountTemp.find(x => x.pattern == wonPattern ).winningValue; //currentPatternToCheck
                                        //console.log("winningPercentage and sales", winningPercentage, room.earnedFromTickets);
                                        let winningAmountSpill = +parseFloat(exactMath.div( exactMath.mul(room.earnedFromTickets, winningPercentage),  100) ).toFixed(2);
                                        //console.log("winningAmount of spillerness spills", winningAmountSpill)
                                        let minimumWinningAmount = +parseFloat(winningAmountTemp.find(x => x.pattern == wonPattern ).minimumWinningValue).toFixed(2); 
                                        //console.log("minimumWinningAmount", minimumWinningAmount)
                                        winningAmount = winningAmountSpill;
                                        if(winningAmountSpill < minimumWinningAmount){
                                            winningAmount = minimumWinningAmount;
                                        }

                                        //console.log("final winning amount of spill pattern", winningAmount)
                                    }else if(room.gameName == "Spillerness Spill 2"){

                                        let winningAmountTemp = allWinningPatternsWithPrize[0][ticketData[i].ticketColorName];
                                        let winningPercentage = winningAmountTemp.find(x => x.pattern == wonPattern ).winningValue; //currentPatternToCheck
                                        //console.log("winningPercentage and sales", winningPercentage, room.earnedFromTickets);
                                        let winningAmountSpill = +parseFloat(exactMath.div( exactMath.mul(room.earnedFromTickets, winningPercentage),  100) ).toFixed(2);
                                        //console.log("winningAmount of spillerness spills", winningAmountSpill)
                                        winningAmount = winningAmountSpill;
                                        if(wonPattern == "Full House"){
                                            let minimumWinningAmount = +parseFloat(winningAmountTemp.find(x => x.pattern == wonPattern ).minimumWinningValue).toFixed(2); 
                                            console.log("minimumWinningAmount", minimumWinningAmount)
                                            if(winningAmountSpill < minimumWinningAmount){
                                                winningAmount = minimumWinningAmount;
                                            }
                                        }
                                        //console.log("final winning amount of spill pattern", winningAmount)
                                    }else if(room.gameName == "Spillerness Spill 3"){
                                        let winningAmountTemp = allWinningPatternsWithPrize[0][ticketData[i].ticketColorName];
                                        let winningPercentage = winningAmountTemp.find(x => x.pattern == wonPattern ).winningValue; //currentPatternToCheck
                                        //console.log("winningPercentage and sales", winningPercentage, room.earnedFromTickets);
                                        winningAmount = +parseFloat(exactMath.div( exactMath.mul(room.earnedFromTickets, winningPercentage),  100) ).toFixed(2);
                                        //console.log("final winning amount of spill 3 pattern", winningAmount)
                                    }else{
                                        let winningAmountTemp = allWinningPatternsWithPrize[0][ticketData[i].ticketColorName];
                                        if(room.gameName == "Oddsen 56" && wonPattern == "Full House"){
                                            let withdrawCount = room.withdrawNumberArray.length;
                                            if(withdrawCount > 56){
                                                console.log("full house after 56 balls")
                                                winningAmount = winningAmountTemp.find(x => x.pattern == wonPattern ).winningValue; //currentPatternToCheck
                                            }else{
                                                console.log("full house within 56 balls")
                                                winningAmount = winningAmountTemp.find(x => x.pattern == "Full House Within 56 Balls" ).winningValue; //currentPatternToCheck
                                            }
                                        }else if(room.gameName == "Oddsen 57" && wonPattern == "Full House"){
                                            let withdrawCount = room.withdrawNumberArray.length;
                                            if(withdrawCount > 57){
                                                console.log("full house after 57 balls")
                                                winningAmount = winningAmountTemp.find(x => x.pattern == wonPattern ).winningValue; //currentPatternToCheck
                                            }else{
                                                console.log("full house within 57 balls")
                                                winningAmount = winningAmountTemp.find(x => x.pattern == "Full House Within 57 Balls" ).winningValue; //currentPatternToCheck
                                            }
                                        }else if(room.gameName == "Oddsen 58" && wonPattern == "Full House"){
                                            let withdrawCount = room.withdrawNumberArray.length;
                                            if(withdrawCount > 58){
                                                console.log("full house after 58 balls")
                                                winningAmount = winningAmountTemp.find(x => x.pattern == wonPattern ).winningValue; //currentPatternToCheck
                                            }else{
                                                console.log("full house within 58 balls")
                                                winningAmount = winningAmountTemp.find(x => x.pattern == "Full House Within 58 Balls" ).winningValue; //currentPatternToCheck
                                            }
                                        }else{
                                            winningAmount = winningAmountTemp.find(x => x.pattern == wonPattern ).winningValue; //currentPatternToCheck
                                        }
                                        //console.log("pattern winnig amount", winningAmount)
                                    }
                                    
                                    let isJackpotWon = false;
                                    if(wonPattern == "Full House" && room.gameName == "Jackpot"){
                                        let withdrawCount = room.withdrawNumberArray.length;
                                        let jackpotDraw = room.jackpotDraw;
                                        //console.log("withdraw and jackpot count", withdrawCount, jackpotDraw)
                                        if(withdrawCount <= jackpotDraw){
                                            let ticketColorTemp = ticketData[i].ticketColorName.slice(6).toLowerCase();
                                            //console.log("ticketColorTemp in jackpot game--", ticketColorTemp);
                                            if(ticketColorTemp == "white"){
                                                winningAmount = room.jackpotPrize.white;
                                            }else if(ticketColorTemp == "yellow"){
                                                winningAmount = room.jackpotPrize.yellow;
                                            }else if(ticketColorTemp == "purple"){
                                                winningAmount = room.jackpotPrize.purple;
                                            }
                                            //winningAmount = room.jackpotPrize;
                                            isJackpotWon = true;
                                            //console.log("jackpot applied", isJackpotWon, winningAmount)
                                        }
                                    }

                                    if(wonPattern == "Full House" && room.gameName == "Ball X 10"){
                                        let ballXAmount = +parseFloat(10 * withdrawNumberArray[withdrawNumberArray.length - 2]).toFixed(2);
                                        //console.log("ballXAmount---", ballXAmount, typeof ballXAmount);
                                        winningAmount = parseFloat(+winningAmount + +ballXAmount).toFixed(2);
                                        //console.log("final winning ballXAmount---", winningAmount);
                                    }

                                    let isWoF = false;
                                    let isTchest = false;
                                    let isMys = false;
                                    let isColorDraft = false;
                                    if(wonPattern == "Full House" && room.gameName == "Wheel of Fortune"){
                                        winningAmount = 0;
                                        isWoF = true;
                                    }
                                    if(wonPattern == "Full House" && room.gameName == "Treasure Chest"){
                                        winningAmount = 0;
                                        isTchest = true;
                                    }
                                    if(wonPattern == "Full House" && room.gameName == "Mystery"){
                                        winningAmount = 0;
                                        isMys = true;
                                    }
                                    if(wonPattern == "Full House" && room.gameName == "Color Draft"){
                                        winningAmount = 0;
                                        isColorDraft = true;
                                    }

                                    if(wonPattern == "Full House" && room.gameName == "Innsatsen"){
                                        let withdrawCount = room.withdrawNumberArray.length;
                                        let jackpotDraw = room.jackpotDraw;
                                        //console.log("withdraw and jackpot count", withdrawCount, jackpotDraw)
                                        if(withdrawCount <= jackpotDraw){
                                            let dailySchedule = await Sys.App.Services.scheduleServices.getSingleDailySchedulesData({ _id: room.parentGameId},{innsatsenSales: 1},{});
                                            let innBeforeSales = +parseFloat(dailySchedule.innsatsenSales).toFixed(2);
                                            winningAmount = parseFloat(+winningAmount + innBeforeSales).toFixed(2);
                                            if(winningAmount > 2000){
                                                winningAmount = 2000;
                                            }
                                            isJackpotWon = true;
                                            console.log("jackpot applied for innsatsen game", isJackpotWon, winningAmount)
                                            Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                                $set: {
                                                    'otherData.isInnsatsenJackpotWon': true,
                                                }
                                            });
                                            //console.log("isJackpotWon", isJackpotWon)
                                        }
                                    }
                                    winningAmount = Math.round(winningAmount)
                                    //console.log("winningAmount", winningAmount )
                                   let winnerObj = {
                                        playerId: ticketData[i].playerIdOfPurchaser,
                                        playerName: ticketData[i].playerNameOfPurchaser,
                                        ticketId: ticketData[i].id,
                                        ticketNumber: ticketData[i].ticketId,
                                        lineType: wonPattern,
                                        wonAmount: winningAmount, //+parseFloat(winningAmount).toFixed(4),
                                        lineTypeDisplay: wonPattern,
                                        isFullHouse: (wonPattern == "Full House") ? true : false,
                                        ticketPrice: ticketData[i].ticketPrice,
                                        ticketColorType: ticketData[i].ticketColorType,
                                        ticketColorName: ticketData[i].ticketColorName,
                                        ballNumber: withdrawNumberArray[withdrawNumberArray.length - 2],
                                        userType: ticketData[i].userType,
                                        hallName: ticketData[i].hallName,
                                        hallId: ticketData[i].hallId,
                                        groupHallName: ticketData[i].groupHallName,
                                        groupHallId: ticketData[i].groupHallId,
                                        isJackpotWon: isJackpotWon,
                                        isWoF : isWoF,
                                        isTchest: isTchest,
                                        isMys: isMys,
                                        isColorDraft: isColorDraft,
                                        userTicketType: ticketData[i].userTicketType,
                                        drawNumber: withdrawNumberArray.length -1,
                                                // isGameTypeExtra: lineTypesToCheck[l].isGameTypeExtra,
                                                // isWonLuckyNumberBonus: isWonLuckyNumberBonus,
                                                
                                                wonElements: wonElements,
                                                ticketCellArray: ticketData[i].tickets.map(ticket =>
                                                    ticket.map(item => item.Number)
                                                )

                                            }
                                            console.log("WinnerData push",wonPattern,winnerObj);
                                            winners.push(winnerObj);
                                            room?.halls.forEach(hall => {
                                                console.log("Call winnerDataRefresh",);
                                                Sys.Io.of('admin').to(hall).emit('winnerDataRefresh',winnerObj, { message: "Ticket Purchase" });
                                            })

                                    // Check for lucky number bonus
                                    let isWonLuckyNumberBonus =false;
                                    let lastBall = withdrawNumberArray[withdrawNumberArray.length - 2];
                                    let playerLuckBall= +ticketData[i].luckyNumber;
                                    //console.log("lastBall and playerLuckBall", lastBall, playerLuckBall);
                                    
                                    if( (lastBall == playerLuckBall) && wonPattern == "Full House"){
                                        isWonLuckyNumberBonus = true;
                                        let luckyNumberPrize = Math.round(room.luckyNumberPrize);
                                        luckyNumberBonusWinners.push({
                                            playerId: ticketData[i].playerIdOfPurchaser,
                                            playerName: ticketData[i].playerNameOfPurchaser,
                                            ticketId: ticketData[i].id,
                                            ticketNumber: ticketData[i].ticketId,
                                            lineType: wonPattern,
                                            wonAmount: +parseFloat(luckyNumberPrize).toFixed(4),
                                            lineTypeDisplay: "Lucky Number Bonus",
                                            bonusType: "Lucky Number Bonus",
                                            isFullHouse: (wonPattern == "Full House") ? true : false,
                                            ticketPrice: ticketData[i].ticketPrice,
                                            ticketColorType: ticketData[i].ticketColorType,
                                            ticketColorName: ticketData[i].ticketColorName,
                                            ballNumber: withdrawNumberArray[withdrawNumberArray.length - 2],
                                            isWonLuckyNumberBonus: isWonLuckyNumberBonus,
                                            userType: ticketData[i].userType,
                                            hallName: ticketData[i].hallName,
                                            hallId: ticketData[i].hallId,
                                            groupHallName: ticketData[i].groupHallName,
                                            groupHallId: ticketData[i].groupHallId,
                                            // isJackpotWon:  (lineTypesToCheck[l].isJackpot == true ) ? lineTypesToCheck[l].isJackpot : false,
                                            isWoF : (wonPattern == "Full House" && room.gameName == "Wheel of Fortune") ? true : false,
                                            isTchest: (wonPattern == "Full House" && room.gameName == "Treasure Chest") ? true : false,
                                            isMys: (wonPattern == "Full House" && room.gameName == "Mystery") ? true : false,
                                            isColorDraft: (wonPattern == "Full House" && room.gameName == "Color Draft") ? true : false,
                                            // isGameTypeExtra: lineTypesToCheck[l].isGameTypeExtra,
                                            
                                        })
                                    }    
                                    
                                }
                                
                            }
                        }
                        
                    }else{
                        console.log("lineTypesToCheck is empty so no need to check for any other combinations", gameId)
                    }
                    
                }

            }else{
                console.log("No winners found", gameId);
            }

            console.log("Ticket submitted winners all possibilities",gameId, winners);
            
            if(winners.length > 0){
                // check if line is alreay cash in
                let newRoom = await Sys.Game.Game1.Services.GameServices.getByData({ _id: gameId }, {winners: 1, ticketsWinningPrices: 1, subGames: 1, trafficLightExtraOptions: 1});
                let finalWinner = [];
                let alreadyWonLine = []
                for(let v=0; v < winners.length; v++){
                    if (newRoom[0].winners.some(e => e.lineType == winners[v].lineType)) {
                        // already won this line
                        alreadyWonLine.push(winners[v].lineTypeDisplay);
                    }else{
                        finalWinner.push(winners[v]);
                    }
                }
                console.log("Ticket submitted finalWinners",gameId, finalWinner)


                let returnData = await Sys.Game.Game1.Services.GameServices.updateGameNew(gameId , { $push: { winners: {$each : finalWinner}, luckyNumberBonusWinners: {$each : luckyNumberBonusWinners} } }); //{ _id: gameId }
                //console.log("Return Data after Game Winners Updated", returnData,returnData.winners);
                // hear bonus is jackpot
                let lineDisplay = [];
                let lineTypeTocheckBonus = [];
                let message;
                let isPhysicalWinner = false;
                if(finalWinner.length > 0){   //finalWinner
                    //let messages = [];
                    let winnigNotifications = [];
                    for(let w=0; w < finalWinner.length; w++){
                       
                        let isFullHouse = false;
                        if(finalWinner[w].isFullHouse == true){
                           
                            isFullHouse = true;
                        }
                        if(finalWinner[w].isJackpotWon == true){
                            lineTypeTocheckBonus.push(finalWinner[w]);
                        }
                        if(finalWinner[w].userType == "Physical"){
                            isPhysicalWinner = true;
                        }
                        /*const updateData = {
                            $set: {
                                isPlayerWon: true, isTicketSubmitted: true, isWonByFullhouse: isFullHouse
                            }
                        }
                        if (finalWinner[w].userType == "Physical") {
                            updateData['$set']['otherData.isWinningDistributed'] = false;
                        }
                        Sys.Game.Game1.Services.GameServices.updateTicket({ _id: finalWinner[w].ticketId, playerIdOfPurchaser: finalWinner[w].playerId }, updateData );*/
                        
                        winnigNotifications.push({ticketId:finalWinner[w].ticketId, fullHouse: isFullHouse, patternName: finalWinner[w].lineTypeDisplay, ticketNumber: finalWinner[w].ticketNumber, lineType: finalWinner[w].lineType, playerId: finalWinner[w].playerId});

                        //messages.push(finalWinner[w].playerName + " has Won " + finalWinner[w].lineTypeDisplay )
                    }
                    console.log("winnigNotifications", winnigNotifications)
                    if(winnigNotifications.length > 0){
                        //await Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('PatternCompleted', {gameId: gameId, ticketList: winnigNotifications  });
                        /*for(let s=0; s < winnigNotifications.length; s++){
                            let playerSocket = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: winnigNotifications[s].playerId  } , { socketId: 1 }, null);
                            console.log("playerSocket", playerSocket)
                            if(playerSocket){
                                console.log("inside playerSocket , send broadcast to particualr player")
                                await Sys.Io.of(Sys.Config.Namespace.Game1).to("/Game1#"+playerSocket.socketId).emit('PatternCompleted', {gameId: gameId, ticketList: winnigNotifications  });
                            }
                        }*/

                        // admin webgl winners starts
                        //remove finalWinner multiplied winning amount if condition 
                        const isDuplicate = new Set(finalWinner.map(v => v.lineType));
                        let winnerArray = [];
                        if (isDuplicate.size < finalWinner.length) {
                            console.log('duplicates found', gameId);
                            const resultArray = [...finalWinner.reduce( (mp, o) => {
                                if (!mp.has(o.lineType)) mp.set(o.lineType, { ...o, count: 0, playerIdArray:[], ticketColorTypeArray: [] });
                                mp.get(o.lineType).count++;
                                mp.get(o.lineType).playerIdArray.push({playerId: o.playerId, playerName:o.playerName, ticketId: o.ticketId, ticketNumber: o.ticketNumber, ticketColorType: o.ticketColorType, ticketPrice: o.ticketPrice, winningAmount: o.wonAmount, ticketColorName: o.ticketColorName, ballNumber: o.ballNumber, userType: o.userType, hallName: o.hallName, wonElements: o.wonElements, isJackpotWon: o.isJackpotWon, ticketCellArray: o.ticketCellArray, hallId: o.hallId, groupHallName: o.groupHallName, groupHallId:o.groupHallId });
                                mp.get(o.lineType).ticketColorTypeArray.push(o.ticketColorType);
                                return mp;
                            }, new Map).values()];
                            console.log("resultArray in winners", resultArray, gameId)
                            for(let r = 0; r < resultArray.length; r++){
                                if(resultArray[r].count > 1){
                                    console.log("winning distribution for same pattern won by multiple tickets", resultArray[r].playerIdArray);
                                    let pLength =resultArray[r].playerIdArray.length;
                                    //let winningAmount = exactMath.div(wonA, pLength);
                                    //console.log("winningAmount",winningAmount, wonA , pLength)
                                    for(let u = 0 ; u < resultArray[r].playerIdArray.length; u++){
                                        let winAmount = Math.round( exactMath.div(resultArray[r].playerIdArray[u].winningAmount, pLength) ); //+parseFloat(exactMath.div(resultArray[r].playerIdArray[u].winningAmount, pLength) ).toFixed(4);
                                        console.log("winAmount of distribution", winAmount)
                                        winnerArray.push({
                                            playerId: resultArray[r].playerIdArray[u].playerId,
                                            playerName: resultArray[r].playerIdArray[u].playerName,
                                            ticketId: resultArray[r].playerIdArray[u].ticketId,
                                            ticketNumber: resultArray[r].playerIdArray[u].ticketNumber,
                                            lineType: resultArray[r].lineType,
                                            wonAmount: winAmount,
                                            lineTypeDisplay: resultArray[r].lineTypeDisplay,
                                            isFullHouse: resultArray[r].isFullHouse,
                                            ticketPrice: resultArray[r].playerIdArray[u].ticketPrice,
                                            ticketColorType: resultArray[r].playerIdArray[u].ticketColorType,
                                            ticketColorName: resultArray[r].playerIdArray[u].ticketColorName,
                                            isWoF : resultArray[r].isWoF,
                                            isTchest: resultArray[r].isTchest,
                                            isJackpotWon: resultArray[r].playerIdArray[u].isJackpotWon,
                                            isMys: resultArray[r].isMys,
                                            isColorDraft: resultArray[r].isColorDraft,
                                            // isGameTypeExtra: resultArray[r].isGameTypeExtra,
                                            userType: resultArray[r].playerIdArray[u].userType,
                                            hallName: resultArray[r].playerIdArray[u].hallName,
                                            hallId: resultArray[r].playerIdArray[u].hallId,
                                            groupHallName: resultArray[r].playerIdArray[u].groupHallName,
                                            groupHallId: resultArray[r].playerIdArray[u].groupHallId,
                                            wonElements: resultArray[r].playerIdArray[u].wonElements,
                                            ticketCellArray: resultArray[r].playerIdArray[u].ticketCellArray
                                        })
                                    }
                                     
                                }else{
                                    winnerArray.push({
                                        playerId: resultArray[r].playerId,
                                        playerName: resultArray[r].playerName,
                                        ticketId: resultArray[r].ticketId,
                                        ticketNumber: resultArray[r].ticketNumber,
                                        lineType: resultArray[r].lineType,
                                        wonAmount: Math.round(resultArray[r].wonAmount), //+parseFloat(resultArray[r].wonAmount).toFixed(4),
                                        lineTypeDisplay: resultArray[r].lineTypeDisplay,
                                        isFullHouse: resultArray[r].isFullHouse,
                                        ticketPrice: resultArray[r].ticketPrice,
                                        ticketColorType: resultArray[r].ticketColorType,
                                        ticketColorName: resultArray[r].ticketColorName,
                                        isWoF : resultArray[r].isWoF,
                                        isTchest: resultArray[r].isTchest,
                                        isJackpotWon: resultArray[r].isJackpotWon,
                                        isMys: resultArray[r].isMys,
                                        isColorDraft: resultArray[r].isColorDraft,
                                        // isGameTypeExtra: resultArray[r].isGameTypeExtra,
                                        userType: resultArray[r].userType,
                                        hallName: resultArray[r].hallName,
                                        hallId: resultArray[r].hallId,
                                        groupHallName: resultArray[r].groupHallName,
                                        groupHallId: resultArray[r].groupHallId,
                                        wonElements: resultArray[r].wonElements,
                                        ticketCellArray: resultArray[r].ticketCellArray
                                    })
                                }
                            }    
                        }else{
                            winnerArray = finalWinner;
                        }
                        console.log("winnerArray after deciding amount for each player",gameId, winnerArray)
                        let adminWinner = await Sys.Game.Game1.Services.GameServices.updateGameNew(gameId, { $push: { adminWinners: { $each: winnerArray } } }); //{ _id: gameId }
                        console.log("Return Data after Game adminWinners Updated", adminWinner.adminWinners);
                        
                        for(let s=0; s < winnigNotifications.length; s++){
                            let playerSocket = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: winnigNotifications[s].playerId  } , { socketId: 1 }, null);
                            console.log("playerSocket", playerSocket)
                            if(playerSocket){
                                let totalWon = (adminWinner.adminWinners).filter(i => i.playerId == winnigNotifications[s].playerId).reduce((acc, current) => acc + current.wonAmount, 0)
                                console.log("inside playerSocket , send broadcast to particualr player", totalWon)
                                await Sys.Io.of(Sys.Config.Namespace.Game1).to("/Game1#"+playerSocket.socketId).emit('PatternCompleted', {gameId: gameId, ticketList: winnigNotifications, totalWon: +totalWon  });
                            }
                        }
                        
                        // send nototfications to players
                        if(winnerArray.length > 0){
                            
                            // update ticket winning data for particular ticket
                            for(let a=0; a < winnerArray.length; a++){
                                let isFullHouse = false;
                                if(winnerArray[a].isFullHouse == true){
                                    isFullHouse = true;
                                }
                                const updateData = {
                                    $set: {
                                        isPlayerWon: true, isTicketSubmitted: true, isWonByFullhouse: isFullHouse,
                                    },
                                    $push: {
                                        'otherData.winningStats': {
                                            lineType: winnerArray[a].lineTypeDisplay,
                                            wonElements: winnerArray[a].wonElements,
                                            wonAmount: winnerArray[a].wonAmount,
                                            isWinningDistributed: false,
                                            isJackpotWon: winnerArray[a].isJackpotWon,
                                            ballDrawned: room.withdrawNumberArray
                                        }
                                    },
                                    $inc: { totalWinningOfTicket: +parseFloat(winnerArray[a].wonAmount).toFixed(4) } 
                                }
                                if (winnerArray[a].userType == "Physical") {
                                    updateData['$set']['otherData.isWinningDistributed'] = false;
                                }
                                Sys.Game.Game1.Services.GameServices.updateTicket({ _id: winnerArray[a].ticketId, playerIdOfPurchaser: winnerArray[a].playerId }, updateData );
                            }
                            // update ticket winning data for particular ticket

                            let newArray = winnerArray.map(object => ({ ...object }))
                            let winnerPlayerPatternWise = Object.values(newArray.reduce(function(r, e) {
                                let key = e.playerId + '|' + e.lineType;
                                if (!r[key]) r[key] = e;
                                else {
                                  r[key].wonAmount += e.wonAmount;
                                }
                                return r;
                            }, {}))
                            console.log("winnerPlayerPatternWise", winnerPlayerPatternWise, winnerArray)
                            let bulkArr = [];
                            for(let w=0; w < winnerPlayerPatternWise.length; w++){
                                if(winnerPlayerPatternWise[w].userType == "Physical"){
                                    console.log("physical player found", winnerPlayerPatternWise[w])
                                    continue;
                                }
                                let currentPlayer = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: winnerPlayerPatternWise[w].playerId}, {username: 1, walletAmount: 1, enableNotification: 1, socketId: 1, firebaseToken: 1, selectedLanguage: 1});
                                if(currentPlayer){
                                    let message =  { en: await translate({key: "game1_individual_pattern", language: 'en', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: +parseFloat(winnerPlayerPatternWise[w].wonAmount).toFixed(2), number3: winnerPlayerPatternWise[w].lineTypeDisplay}), 
                                                    nor: await translate({key: "game1_individual_pattern", language: 'nor', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: +parseFloat(winnerPlayerPatternWise[w].wonAmount).toFixed(2), number3: winnerPlayerPatternWise[w].lineTypeDisplay }) } ;
                                    //room.gameNumber + " [ " + room.gameName + " ] Congratulations! You have won " + +parseFloat(winnerPlayerPatternWise[w].wonAmount).toFixed(2) + " Kr for Winning "  + winnerPlayerPatternWise[w].lineTypeDisplay + " Pattern. ";
                                    if(winnerPlayerPatternWise[w].isWoF == true || winnerPlayerPatternWise[w].isTchest == true || winnerPlayerPatternWise[w].isMys == true || winnerPlayerPatternWise[w].isColorDraft == true){
                                        if(winnerPlayerPatternWise[w].isWoF == true){
                                            message = { en: await translate({key: "game1_fullhouse_wof", language: 'en', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: winnerPlayerPatternWise[w].lineTypeDisplay}), 
                                            nor: await translate({key: "game1_fullhouse_wof", language: 'nor', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: winnerPlayerPatternWise[w].lineTypeDisplay}) }  //room.gameNumber + " [ " + room.gameName + " ] Congratulations! You have won " + winnerPlayerPatternWise[w].lineTypeDisplay + " Pattern, Spin Wheel of Fortune in order to win winning Amount. ";
                                        }else if(winnerPlayerPatternWise[w].isTchest == true){
                                            message = { en: await translate({key: "game1_fullhouse_tc", language: 'en', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: winnerPlayerPatternWise[w].lineTypeDisplay}), 
                                            nor: await translate({key: "game1_fullhouse_tc", language: 'nor', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: winnerPlayerPatternWise[w].lineTypeDisplay}) }  //room.gameNumber + " [ " + room.gameName + " ] Congratulations! You have won " + winnerPlayerPatternWise[w].lineTypeDisplay + " Pattern, Open Treasure Chest in order to win winning Amount. ";
                                        }else if(winnerPlayerPatternWise[w].isMys == true){
                                            message = { en: await translate({key: "game1_fullhouse_mystery", language: 'en', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: winnerPlayerPatternWise[w].lineTypeDisplay}), 
                                            nor: await translate({key: "game1_fullhouse_mystery", language: 'nor', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: winnerPlayerPatternWise[w].lineTypeDisplay}) }  //room.gameNumber + " [ " + room.gameName + " ] Congratulations! You have won " + winnerPlayerPatternWise[w].lineTypeDisplay + " Pattern, Play Mystery game in order to win winning Amount. ";
                                        }else{
                                            message = { en: await translate({key: "game1_fullhouse_cd", language: 'en', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: winnerPlayerPatternWise[w].lineTypeDisplay}), 
                                            nor: await translate({key: "game1_fullhouse_cd", language: 'nor', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: winnerPlayerPatternWise[w].lineTypeDisplay}) }  //room.gameNumber + " [ " + room.gameName + " ] Congratulations! You have won " + winnerPlayerPatternWise[w].lineTypeDisplay + " Pattern, Play Color Draft game in order to win winning Amount. ";
                                        }
                                    }
                                    if(room.gameName == "Jackpot" && winnerPlayerPatternWise[w].isJackpotWon == true){
                                        message = { en: await translate({key: "game1_fullhouse_jackpot", language: 'en', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: +parseFloat(winnerPlayerPatternWise[w].wonAmount).toFixed(2), number3: winnerPlayerPatternWise[w].lineTypeDisplay}), 
                                        nor: await translate({key: "game1_fullhouse_jackpot", language: 'nor', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: +parseFloat(winnerPlayerPatternWise[w].wonAmount).toFixed(2), number3: winnerPlayerPatternWise[w].lineTypeDisplay }) } ;
                                        //room.gameNumber + " [ " + room.gameName + " ] Congratulations! You have won " + +parseFloat(winnerPlayerPatternWise[w].wonAmount).toFixed(2) + " Kr for Winning "  + winnerPlayerPatternWise[w].lineTypeDisplay + " Pattern (Jackpot Winning). ";
                                    }
                                    let notification ={
                                        notificationType:'winning',
                                        message: message
                                    }
                                    bulkArr.push({
                                        insertOne: {
                                            document: {
                                                playerId: winnerPlayerPatternWise[w].playerId,
                                                gameId:room._id,
                                                notification: notification
                                            }
                                        }
                                    })
                        
                                    // await Sys.Io.to(currentPlayer.socketId).emit('NotificationBroadcast', {
                                    //     notificationType: notification.notificationType,
                                    //     message: notification.message[currentPlayer.selectedLanguage]
                                    // });
                        
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
                                }
                                
                        
                            }
                            Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkArr);
                        }
                        console.log("winnerArray after notifications", winnerArray)
                        /*const resultArray = [...winnerArray.reduce( (mp, o) => {
                            if (!mp.has(o.lineType)) mp.set(o.lineType, { ...o, winnerCount: 0, playerIdArray:[], finalWonAmount: 0 });
                            
                            if(mp.get(o.lineType).playerIdArray.includes(o.playerId) == false ){
                                mp.get(o.lineType).winnerCount++;
                            }else{
                                console.log("dont include as already included");
                            }
                            mp.get(o.lineType).finalWonAmount= Math.round(mp.get(o.lineType).finalWonAmount + +o.wonAmount);  //+parseFloat(mp.get(o.lineType).finalWonAmount + +o.wonAmount).toFixed(4) ;
                            mp.get(o.lineType).playerIdArray.push(o.playerId);
                            return mp;
                        }, new Map).values()];*/

                        const resultArray = [...winnerArray.reduce( (mp, o) => {
                            if (!mp.has(o.lineType)) mp.set(o.lineType, { ...o, winnerCount: 0, playerIdArray:[], finalWonAmount: 0, ticketIdArray: [], winningTicket: [] });
                            
                            if(mp.get(o.lineType).playerIdArray.includes(o.playerId) == false ){
                                mp.get(o.lineType).winnerCount++;
                            }else{
                                console.log("dont include as already included", o.userType);
                                if(o.userType == "Physical"){
                                    if(mp.get(o.lineType).ticketIdArray.includes(o.playerId + o.ticketId) == false ){
                                        mp.get(o.lineType).winnerCount++;
                                    }
                                }
                            }
                            mp.get(o.lineType).finalWonAmount= Math.round(mp.get(o.lineType).finalWonAmount + +o.wonAmount);  //+parseFloat(mp.get(o.lineType).finalWonAmount + +o.wonAmount).toFixed(4) ;
                            //mp.get(o.lineType).playerIdArray.push({"playerId": o.playerId, "ticketId": o.ticketId, "userType": o.userType});
                            mp.get(o.lineType).playerIdArray.push(o.playerId);
                            mp.get(o.lineType).ticketIdArray.push(o.playerId + o.ticketId);
                            mp.get(o.lineType).winningTicket.push({ticket: o.ticketCellArray, wonElement: o.wonElements});
                            return mp;
                        }, new Map).values()];

                        console.log("resultArray in winnigNotifications", resultArray, winnerArray)
                        for(let w=0; w< resultArray.length; w++){
                            let winningTickets = [];
                            if( resultArray[w].winningTicket && resultArray[w].winningTicket.length > 0 ){
                                for(let i=0; i < resultArray[w].winningTicket.length; i++){
                                    if(resultArray[w].lineType == "Frame"){
                                        let frame = ["0:0", "0:1", "0:2", "0:3", "0:4", "1:0", "1:4", "2:0", "2:4", "3:0", "3:4", "4:0", "4:1", "4:2", "4:3", "4:4"];
                                        const frameSet = new Set(frame);
                                        const filteredArray = resultArray[w].winningTicket[i].ticket.map((row, rowIndex) =>
                                            row.map((item, colIndex) => {
                                                const coord = `${rowIndex}:${colIndex}`;
                                                return frameSet.has(coord) ? item : "";
                                            })
                                        );
                                        winningTickets.push({numbers: filteredArray, patternName: resultArray[w].lineType });
                                    }else if(resultArray[w].lineType == "Picture"){
                                        let picture = ["1:1", "1:2", "1:3", "2:1", "2:2", "2:3","3:1", "3:2", "3:3"];
                                        const frameSet = new Set(picture);
                                        const filteredArray = resultArray[w].winningTicket[i].ticket.map((row, rowIndex) =>
                                            row.map((item, colIndex) => {
                                                const coord = `${rowIndex}:${colIndex}`;
                                                return frameSet.has(coord) ? item : "";
                                            })
                                        );
                                        winningTickets.push({numbers: filteredArray, patternName: resultArray[w].lineType });
                                    }else if(resultArray[w].lineType == "Row 1" && resultArray[w].winningTicket[i].wonElement.columns.length > 0){
                                        const showColumnAsRow = (arr, columnIndex) => {
                                            const column = arr.map(row => row[columnIndex]);
                                            return arr.map((row, index) => index === columnIndex ? column : ["", "", "", "", ""]);
                                        };
                                        const result = showColumnAsRow(resultArray[w].winningTicket[i].ticket, (+resultArray[w].winningTicket[i].wonElement.columns[0]) );
                                        winningTickets.push({numbers: result, patternName: resultArray[w].lineType });
                                    }else{
                                        const result = resultArray[w].winningTicket[i].ticket.map((row, index) => {
                                            return resultArray[w].winningTicket[i].wonElement.rows.includes(index) ? row : ["", "", "", "", ""];
                                        });
                                        winningTickets.push({numbers: result, patternName: resultArray[w].lineType });
                                    }
                                }
                            }
                            let finalWinningTickets = [];
                            if(winningTickets.length > 0){
                                finalWinningTickets = winningTickets.map(item => ({
                                    numbers: item.numbers.flat().map(String),
                                    patternName: item.patternName
                                }));
                            }
                            console.log("winningTickets of admin----", JSON.stringify(finalWinningTickets))
                            console.log("admin winning notification", {"id": resultArray[w].lineType, "displayName": resultArray[w].lineTypeDisplay, "winnerCount": resultArray[w].winnerCount,"prize": resultArray[w].finalWonAmount, winningTickets: finalWinningTickets})
                            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('BingoWinningAdmin', {"id": resultArray[w].lineType, "displayName": resultArray[w].lineTypeDisplay, "winnerCount": resultArray[w].winnerCount,"prize": resultArray[w].finalWonAmount, winningTickets: finalWinningTickets});
                        }
   
                    }
                   
                    // check for fullhouse/pattern bonus

                    // update remaining patterns
                    console.log("update remaining patterns broadcast")
                    let patternRoom = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {winners: 1, subGames: 1, jackpotPrize: 1, jackpotDraw: 1, gameName: 1, withdrawNumberArray: 1, otherData: 1, parentGameId: 1});
                    /*let patternRoom = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {winners: 1, subGames: 1});
                    console.log("patternRoom", patternRoom)
                    let patternListTemp = Object.keys(patternRoom.subGames[0].options[0].winning);
                    if(room.gameName == "Super Nils"){
                        patternListTemp = Object.keys(patternRoom.subGames[0].options[0].winning.B)
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
                    console.log("patternRoom & patternList", patternRoom, patternListTemp)
                    if(patternListTemp.length > 0){
                        for(let p=0; p< patternListTemp.length; p++){
                            if(patternListTemp[p] == "Row 1" ){ patternList.push({name: "Row 1", patternDesign : 1, patternDataList: [], amount: getHighestPrice("Row 1"), message: ""}) }
                            else if(patternListTemp[p] == "Row 2"){ patternList.push({name: "Row 2", patternDesign : 2, patternDataList: [], amount: getHighestPrice("Row 2"), message: ""}) }
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
                    let patternListing = await module.exports.patternListing(room._id);
                    let patternList = patternListing.patternList;
                    //console.log("patternListing---", patternListing, patternList);

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
                    //finalPatternList = finalPatternList.map(({patternDesign,patternDataList})  => ({patternDesign, patternDataList}));
                    console.log("finalPatternList when winner declared", finalPatternList)
                    
                    // Jackpot games count and winnings
                    const jackPotData = await Sys.Game.Game1.Controllers.GameController.getJackpotData(
                        patternRoom.gameName,
                        patternRoom.withdrawNumberArray.length,
                        patternRoom.jackpotDraw,
                        patternRoom.jackpotPrize,
                        patternRoom.subGames,
                        patternRoom.parentGameId
                    );
            
                    await Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('PatternChange',  { patternList: finalPatternList, jackPotData: jackPotData } );
                    await Sys.Io.of('admin').to(gameId).emit('refreshTicketTable');
                    clearInterval(Sys.GameTimers[gameId]);

                    //if(isPhysicalWinner == true){
                        let autoPause = await module.exports.stopGame(gameId, "english");
                        console.log("autoPause status", autoPause);
                        if(autoPause && autoPause.status == "success"){
                            return true;
                        }
                    //}

                    return new Promise(resolve => {
                        setTimeout(function () {
                            resolve();
                            module.exports.gameInterval(gameId);
                            return {
                                status: 'success',
                                result: {ticketResult: true,rank: 0},
                                //message: message
                            }
                        }, 5000);
                    });
                }else{
                    message ="Already someone won, Better luck next time!";
                    return {
                        status: 'fail',
                        result: {ticketResult: false,rank: 0},
                        message: message
                    }
                }    
            }else{
                console.log("no winner found", gameId)
            }
            Sys.Log.info('----checkForWinners end------: ' + gameId);
            return {
                status: 'fail',
                result: {ticketResult: false,rank: 0},
                message: "No Winner Found."
            }
        }catch(e){
            console.log("error in checForWinners", e);
        }
    },

    checkForGameFinished: async function(gameId){
        try{
            let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {ticketsWinningPrices: 1, winners: 1, gameName: 1});
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
                console.log("chekfor game finished", allWinningPatterns,  winningCombinations, lineTypesToCheck)
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
        //gameFinished: async function(SocketId, data){
        try{ 
            //let gameId = data.gameId;
            console.log("game finished final", gameId)
            
            let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, { winners: 1, jackpotWinners: 1, gameType: 1, gameNumber: 1, gameName: 1, withdrawNumberArray: 1, players: 1, subGames: 1, trafficLightExtraOptions: 1, luckyNumberBonusWinners: 1, luckyNumberPrize: 1, earnedFromTickets: 1, parentGameId: 1, adminWinners: 1, status: 1, otherData: 1, halls : 1});
            if(room && room.status != "finish"){
                if(room.gameName != "Wheel of Fortune" && room.gameName != "Treasure Chest" && room.gameName != "Mystery" && room.gameName != "Color Draft"){
                    Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, {$set: {status: 'finish', "otherData.gameSecondaryStatus": 'finish'}});
                }else{
                    if(room.winners.length == 0){
                        Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, {$set: {status: 'finish', "otherData.gameSecondaryStatus": 'finish'}});
                    }else{
                        Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, {$set: {status: 'finish'}});
                    }
                }
                await Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('GameFinishEndGame',  { } );
               
                let allPlayers = [];
                for (let p in room.players) {
                    if(room.players[p].userType != "Physical"){
                        allPlayers.push(room.players[p].id);
                    }
                }
                if(allPlayers.length > 0){
                    Sys.Game.Game1.Services.PlayerServices.updateManyData(
                        { "_id" : {$in:allPlayers} },
                        { $inc: { "statisticsgame1.totalGames": 1  } }
                    );
                }

                let winnerArray = room.adminWinners;
                console.log("Winner Array in gameFinsihed", winnerArray)
                // Merge winning amount for multiple winnings
                
                // const MultiWinnig = [...winnerArray.reduce( (mp, o) => {
                //     if (!mp.has(o.playerId)) mp.set(o.playerId, { ...o,  lineTypeArray:[], wonAmountArray:[], finalWonAmount: 0, lineTypeArrayDisplay: [] });
                //     mp.get(o.playerId).finalWonAmount= Math.round(mp.get(o.playerId).finalWonAmount + +o.wonAmount);  //+parseFloat(mp.get(o.playerId).finalWonAmount + +o.wonAmount).toFixed(4) ;
                //     mp.get(o.playerId).lineTypeArray.push(o.lineTypeDisplay);
                //     mp.get(o.playerId).wonAmountArray.push( +o.wonAmount.toFixed(4) );
                //     mp.get(o.playerId).lineTypeArrayDisplay.push({'lineType':o.lineTypeDisplay, 'lineTypeAmount':+o.wonAmount.toFixed(4)  });
                //     return mp;
                // }, new Map).values()];

                const MultiWinnig = [...winnerArray.reduce((mp, o) => {
                    const key = `${o.playerId}_${o.hallId}`; // Composite key for playerId and hallId
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

                console.log("---MultiWinnig player wise sorting---", MultiWinnig, gameId)
                Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, {
                    $set: {
                        status: 'finish',
                        winners: winnerArray,
                        multipleWinners:MultiWinnig,
                    }
                });

                //assign winning amount to players
                let bulkArr = [];
                let winningNotificationBroadcast = [];
                let winningJackpotBroadcast = [];
                let allWinnersArray = [];
                const processedPlayerIds = new Set();
                for (let k = 0; k < MultiWinnig.length; k++) {
                    allWinnersArray.push(MultiWinnig[k].playerId);
                    if(MultiWinnig[k].userType == "Physical" ){
                        await Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, { $inc: { totalWinning: MultiWinnig[k].finalWonAmount, finalGameProfitAmount: -MultiWinnig[k].finalWonAmount } });
                        // let currentAgent = await Sys.App.Services.AgentServices.getSingleAgentDataForRole({ _id: MultiWinnig[k].playerId }, ['name', 'walletAmount']);
                        // if(currentAgent){
                        //     let transactionDataSend = {
                        //         playerId: MultiWinnig[k].playerId,
                        //         playerName: currentAgent.name,
                        //         gameId: room._id,
                        //         ticketId: MultiWinnig[k].ticketId,
                        //         ticketNumber: MultiWinnig[k].ticketNumber,
                        //         //patternId: MultiWinnig[k].bonusType,
                        //         //patternName: MultiWinnig[k].bonusType,
                        //         count: room.withdrawNumberArray.length,
                        //         transactionSlug: "patternPrizeGame1",
                        //         action: "debit",
                        //         purchasedSlug: "cash",
                        //         patternPrize: MultiWinnig[k].finalWonAmount,
                        //         gameNumber: room.gameNumber,
                        //         gameType: room.gameType,
                        //         gameStartDate: room.startDate,
                        //         gameMode: room.gameMode,
                        //         previousBalance: +currentAgent.walletAmount.toFixed(4),
                        //         variantGame: room.subGames[0].gameName,
                        //         ticketPrice: MultiWinnig[k].ticketPrice,
                        //         ticketColorType: MultiWinnig[k].ticketColorName,
                        //         hallName: MultiWinnig[k].hallName,
                        //         game1Slug:"patternPrizeGame1",
                        //         typeOfTransaction: "patternPrizeGame1",
                        //         userType: "Physical"
                        //     }
                        //     await Sys.Helper.gameHelper.createTransactionAgent(transactionDataSend); 
                        // }
                    }else{
                        let currentPlayer = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: MultiWinnig[k].playerId}, {username: 1, walletAmount: 1, enableNotification: 1, socketId: 1, firebaseToken: 1, selectedLanguage: 1});
                        if(currentPlayer){
                            let isStatisticsgame1Counted = true;
                            if (!processedPlayerIds.has(MultiWinnig[k].playerId)) {
                                // The playerId has not been processed yet and add to Set
                                processedPlayerIds.add(MultiWinnig[k].playerId);
                                isStatisticsgame1Counted = false;
                            }
                            let transactionDataSend = {
                                playerId: MultiWinnig[k].playerId,
                                playerName: currentPlayer.username,
                                gameId: room._id,
                                ticketId: MultiWinnig[k].ticketId,
                                ticketNumber: MultiWinnig[k].ticketNumber,
                                //patternId: MultiWinnig[k].bonusType,
                                //patternName: MultiWinnig[k].bonusType,
                                count: room.withdrawNumberArray.length,
                                transactionSlug: "patternPrizeGame1",
                                action: "credit",
                                purchasedSlug: "realMoney",
                                patternPrize: MultiWinnig[k].finalWonAmount,
                                gameNumber: room.gameNumber,
                                gameType: room.gameType,
                                gameStartDate: room.startDate,
                                gameMode: room.gameMode,
                                previousBalance: +currentPlayer.walletAmount.toFixed(4),
                                variantGame: room.subGames[0].gameName,
                                ticketPrice: MultiWinnig[k].ticketPrice,
                                ticketColorType: MultiWinnig[k].ticketColorName,
                                hall: {
                                    id: MultiWinnig[k].hallId,
                                    name: MultiWinnig[k].hallName
                                },
                                groupHall: {
                                    id: MultiWinnig[k].groupHallId,
                                    name: MultiWinnig[k].groupHallName
                                },
                                isStatisticsgame1Counted: isStatisticsgame1Counted
                            }
                            await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend); 
                            await Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, { $inc: { totalWinning: MultiWinnig[k].finalWonAmount, finalGameProfitAmount: -MultiWinnig[k].finalWonAmount } });
                            if (currentPlayer.enableNotification == true) {
                                let finalLineType = [...new Set(MultiWinnig[k].lineTypeArray)]
                                let winningMessage = 
                                { en: await translate({key: "game1_won_pattern", language: 'en', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: +parseFloat(MultiWinnig[k].finalWonAmount).toFixed(2), number3: finalLineType.join()}), 
                                nor: await translate({key: "game1_won_pattern", language: 'nor', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: +parseFloat(MultiWinnig[k].finalWonAmount).toFixed(2), number3: finalLineType.join() }) }  //room.gameNumber + " [ " + room.gameName + " ] Congratulations! You have won Total " + +parseFloat(MultiWinnig[k].finalWonAmount).toFixed(2) + " Kr for Winning "  + finalLineType.join() + " Patterns. ";
                                if(room.gameName == "Wheel of Fortune" && finalLineType.length == 1 && finalLineType.includes("Full House")){
                                    winningMessage = 
                                    { en: await translate({key: "game1_won_pattern_fullhouse", language: 'en', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: finalLineType.join()}), 
                                    nor: await translate({key: "game1_won_pattern_fullhouse", language: 'nor', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: finalLineType.join() }) } //room.gameNumber + " [ " + room.gameName + " ] Congratulations! You have won " + finalLineType.join() + " Pattern. ";
                                }
                                let notification ={
                                    notificationType:'winning',
                                    message: winningMessage

                                }
                                if(finalLineType.length > 1){
                                    bulkArr.push({
                                        insertOne: {
                                            document: {
                                                playerId: MultiWinnig[k].playerId,
                                                gameId:room._id,
                                                notification: notification
                                            }
                                        }
                                    })
                                }
                                
                                winningNotificationBroadcast.push({
                                    notificationType: notification.notificationType,
                                    socketId: currentPlayer.socketId,
                                    message: winningMessage[currentPlayer.selectedLanguage]
                                })

                                let message = {
                                    notification: {
                                        title: "Spillorama",
                                        body: winningMessage[currentPlayer.selectedLanguage]
                                    },
                                    token : currentPlayer.firebaseToken
                                };
                                if(currentPlayer.firebaseToken){
                                    Sys.Helper.gameHelper.sendWinnersNotifications(message);
                                }
                                
                            }
                            
                        }
                    }
                        
                }
                Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkArr);
                
                // update ticket for winning amount
                const ticketStats = [...winnerArray.reduce( (mp, o) => {
                    if (!mp.has(o.ticketId)) mp.set(o.ticketId, { ...o,  lineTypeArray:[], wonAmountArray:[], finalWonAmount: 0, lineTypeArrayDisplay: [] });
                    mp.get(o.ticketId).finalWonAmount= Math.round(mp.get(o.ticketId).finalWonAmount + +o.wonAmount); //+parseFloat(mp.get(o.ticketId).finalWonAmount + +o.wonAmount).toFixed(4) ;
                    mp.get(o.ticketId).lineTypeArray.push({lineType:o.lineTypeDisplay, wonAmount: o.wonAmount, isJackpotWon: o.isJackpotWon});
                    
                    return mp;
                }, new Map).values()];

                console.log("ticketStats of bingo game", ticketStats, gameId);
                if(ticketStats.length > 0){
                    for (let t = 0; t < ticketStats.length; t++) {
                        let winningStats = {
                            finalWonAmount:  +parseFloat(ticketStats[t].finalWonAmount).toFixed(4),
                            lineTypeArray: ticketStats[t].lineTypeArray,
                            walletType: "realMoney"
                        }
                        console.log("update ticket states")
                        Sys.Game.Game1.Services.GameServices.updateTicket({_id: ticketStats[t].ticketId, gameId:gameId, playerIdOfPurchaser: ticketStats[t].playerId }, { $set: {winningStats: winningStats, totalWinningOfTicket: +parseFloat(ticketStats[t].finalWonAmount).toFixed(4) }  });  // ,  $inc: { totalWinningOfTicket: +parseFloat(ticketStats[t].finalWonAmount).toFixed(4) } 
                    }
                }

                // Jackpot or Bonus Disstribution
                let bonusArray = [];
                // lucky Number Bonus Distribution start
                let winningLuckyNumberBroadcast = [];
                let luckyNumberBonus =  room.luckyNumberBonusWinners;
                console.log("initial luckyNumberBonus", luckyNumberBonus)
                let multiLuckyBonusWinningArray = [];
                let luckyNumberBonusArray = luckyNumberBonus; 
                if(luckyNumberBonus.length > 0){
                    
                    console.log("final lucky number bonus array ",gameId, luckyNumberBonusArray);
                    Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, {
                        $set: {
                            luckyNumberBonusWinners: luckyNumberBonusArray
                        }
                    });

                    // const MultiLuckyBonusWinnig = [...luckyNumberBonusArray.reduce( (mp, o) => {
                    //     if (!mp.has(o.playerId)) mp.set(o.playerId, { ...o,  lineTypeArray:[], wonAmountArray:[], finalWonAmount: 0 });
                    //     mp.get(o.playerId).finalWonAmount= Math.round(mp.get(o.playerId).finalWonAmount + +o.wonAmount); //+parseFloat(mp.get(o.playerId).finalWonAmount + +o.wonAmount).toFixed(4) ;
                    //     mp.get(o.playerId).lineTypeArray.push(o.lineTypeDisplay);
                    //     mp.get(o.playerId).wonAmountArray.push(+o.wonAmount.toFixed(4));
                    //     return mp;
                    // }, new Map).values()];

                    const MultiLuckyBonusWinnig = [...luckyNumberBonusArray.reduce((mp, o) => {
                        const key = `${o.playerId}_${o.hallId}`; // Composite key for playerId and hallId
                        if (!mp.has(key)) {
                            mp.set(key, { 
                                ...o,  
                                lineTypeArray: [], 
                                wonAmountArray: [], 
                                finalWonAmount: 0 
                            });
                        }
                        const current = mp.get(key);
                        current.finalWonAmount = Math.round(current.finalWonAmount + +o.wonAmount);
                        current.lineTypeArray.push(o.lineTypeDisplay);
                        current.wonAmountArray.push(+o.wonAmount.toFixed(4));
                        
                        return mp;
                    }, new Map()).values()];
                    

                    console.log("---MultiWinnig of Lucky number bonus---",gameId, MultiLuckyBonusWinnig)
                    let bulkLuckyBonusArray = [];
                    
                    for (let k = 0; k < MultiLuckyBonusWinnig.length; k++) { 
                        if(MultiLuckyBonusWinnig[k].userType == "Physical" ){
                            //await Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, { $inc: { totalWinning: MultiLuckyBonusWinnig[k].finalWonAmount, finalGameProfitAmount: -MultiLuckyBonusWinnig[k].finalWonAmount } });
                            // let currentAgent = await Sys.App.Services.AgentServices.getSingleAgentDataForRole({ _id: MultiLuckyBonusWinnig[k].playerId }, ['name', 'walletAmount']);
                            // if(currentAgent){
                            //     let transactionDataSend = {
                            //         playerId: MultiLuckyBonusWinnig[k].playerId,
                            //         playerName: currentAgent.name,
                            //         gameId: room._id,
                            //         ticketId: MultiLuckyBonusWinnig[k].ticketId,
                            //         ticketNumber: MultiLuckyBonusWinnig[k].ticketNumber,
                            //         patternId: MultiLuckyBonusWinnig[k].bonusType,
                            //         patternName: MultiLuckyBonusWinnig[k].bonusType,
                            //         count: room.withdrawNumberArray.length,
                            //         transactionSlug: "luckyNumberPrizeGame1",
                            //         action: "debit",
                            //         purchasedSlug: "cash",
                            //         patternPrize: MultiLuckyBonusWinnig[k].finalWonAmount,
                            //         gameNumber: room.gameNumber,
                            //         gameType: room.gameType,
                            //         gameStartDate: room.startDate,
                            //         gameMode: room.gameMode,
                            //         previousBalance: +currentAgent.walletAmount.toFixed(4),
                            //         variantGame: room.subGames[0].gameName,
                            //         ticketPrice: MultiLuckyBonusWinnig[k].ticketPrice,
                            //         ticketColorType: MultiLuckyBonusWinnig[k].ticketColorName,
                            //         hallName: MultiLuckyBonusWinnig[k].hallName,
                            //         game1Slug:"luckyNumberPrizeGame1",
                            //         typeOfTransaction: "luckyNumberPrizeGame1",
                            //         userType: "Physical"
                            //     }
                            //     await Sys.Helper.gameHelper.createTransactionAgent(transactionDataSend); 
                            // }
                        }else{
                            let currentPlayer = await Sys.Game.Game1.Services.PlayerServices.getOneByData({_id: MultiLuckyBonusWinnig[k].playerId}, {username: 1, walletAmount: 1, enableNotification: 1, socketId: 1, firebaseToken: 1, selectedLanguage: 1});
                            if(currentPlayer){
                                let transactionDataSend = {
                                    playerId: MultiLuckyBonusWinnig[k].playerId,
                                    playerName: currentPlayer.username,
                                    gameId: room._id,
                                    ticketId: MultiLuckyBonusWinnig[k].ticketId,
                                    ticketNumber: MultiLuckyBonusWinnig[k].ticketNumber,
                                    patternId: MultiLuckyBonusWinnig[k].bonusType,
                                    patternName: MultiLuckyBonusWinnig[k].bonusType,
                                    count: room.withdrawNumberArray.length,
                                    transactionSlug: "luckyNumberPrizeGame1",
                                    action: "credit",
                                    purchasedSlug: "realMoney",
                                    patternPrize: MultiLuckyBonusWinnig[k].finalWonAmount,
                                    gameNumber: room.gameNumber,
                                    gameType: room.gameType,
                                    gameStartDate: room.startDate,
                                    gameMode: room.gameMode,
                                    previousBalance: +currentPlayer.walletAmount.toFixed(4),
                                    variantGame: room.subGames[0].gameName,
                                    ticketPrice: MultiLuckyBonusWinnig[k].ticketPrice,
                                    ticketColorType: MultiLuckyBonusWinnig[k].ticketColorName,
                                    hall: {
                                        id: MultiLuckyBonusWinnig[k].hallId,
                                        name: MultiLuckyBonusWinnig[k].hallName
                                    },
                                    groupHall: {
                                        id: MultiLuckyBonusWinnig[k].groupHallId,
                                        name: MultiLuckyBonusWinnig[k].groupHallName
                                    }
                                }
                                await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);  
                                await Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, { $inc: { totalWinning: MultiLuckyBonusWinnig[k].finalWonAmount, finalGameProfitAmount: -MultiLuckyBonusWinnig[k].finalWonAmount } });
                                if (currentPlayer.enableNotification == true) {
                                    let finalLineType = [...new Set(MultiLuckyBonusWinnig[k].lineTypeArray)]
                                    let luckyNumberMessage = 
                                    { en: await translate({key: "game1_luckynumber_winnings", language: 'en', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: +parseFloat(MultiLuckyBonusWinnig[k].finalWonAmount).toFixed(2), number3: finalLineType.join()}), 
                                    nor: await translate({key: "game1_luckynumber_winnings", language: 'nor', isDynamic: true, number: room.gameNumber, number1: room.gameName, number2: +parseFloat(MultiLuckyBonusWinnig[k].finalWonAmount).toFixed(2), number3: finalLineType.join() }) } 
                                    let notification ={
                                        notificationType:'winning',
                                        message: luckyNumberMessage //room.gameNumber + " [ " + room.gameName + " ] Congratulations! You have won " + +parseFloat(MultiLuckyBonusWinnig[k].finalWonAmount).toFixed(2) + " Kr for Winning " + finalLineType.join()

                                    }
                                    bulkLuckyBonusArray.push({
                                        insertOne: {
                                            document: {
                                                playerId: MultiLuckyBonusWinnig[k].playerId,
                                                gameId:room._id,
                                                notification: notification
                                            }
                                        }
                                    })

                                    winningLuckyNumberBroadcast.push({
                                        notificationType: notification.notificationType,
                                        socketId: currentPlayer.socketId,
                                        message: luckyNumberMessage[currentPlayer.selectedLanguage] //room.gameNumber + " [ " + room.gameName + " ] Congratulations! You have won " + +parseFloat(MultiLuckyBonusWinnig[k].finalWonAmount).toFixed(2) + " Kr for Winning " + finalLineType.join()
                                    })

                                    let message = {
                                        notification: {
                                            title: "Spillorama",
                                            body: luckyNumberMessage[currentPlayer.selectedLanguage] //room.gameNumber + " [ " + room.gameName + " ] Congratulations! You have won " + +parseFloat(MultiLuckyBonusWinnig[k].finalWonAmount).toFixed(2) + " Kr for Winning " + finalLineType.join()
                                        },
                                        token : currentPlayer.firebaseToken
                                    };
                                    if(currentPlayer.firebaseToken){
                                        Sys.Helper.gameHelper.sendWinnersNotifications(message);
                                    }
                                    

                                }
                            }  
                        }
                        
                    }
                    Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkLuckyBonusArray);

                    for(let m =0; m < MultiLuckyBonusWinnig.length; m++){
                        if(MultiLuckyBonusWinnig[m].lineTypeArray.length >1 ){
                            MultiLuckyBonusWinnig[m].wonAmount = Math.round(MultiLuckyBonusWinnig[m].finalWonAmount);  //+parseFloat( parseFloat(MultiLuckyBonusWinnig[m].finalWonAmount) ).toFixed(4);
                        }
                    }
                    console.log("MultiLuckyBonusWinnig after final amount", MultiLuckyBonusWinnig)
                    //MultiLuckyBonusWinnig.sort((a, b) => parseFloat(b.wonAmount) - parseFloat(a.wonAmount));
                        // update ticket for bonus winning amount
                    const ticketLuckyBonusStats = [...luckyNumberBonusArray.reduce( (mp, o) => {
                        if (!mp.has(o.ticketId)) mp.set(o.ticketId, { ...o,  lineTypeArray:[], wonAmountArray:[], finalWonAmount: 0 });
                        mp.get(o.ticketId).finalWonAmount= Math.round(mp.get(o.ticketId).finalWonAmount + +o.wonAmount); //+parseFloat(mp.get(o.ticketId).finalWonAmount + +o.wonAmount).toFixed(4) ;
                        return mp;
                    }, new Map).values()];

                    console.log("ticketLuckyBonusStats of bingo game", ticketLuckyBonusStats, gameId);
                    if(ticketLuckyBonusStats.length > 0){
                        for (let t = 0; t < ticketLuckyBonusStats.length; t++) {
                            let winningStats = {
                                wonAmount: +parseFloat(ticketLuckyBonusStats[t].finalWonAmount).toFixed(4), 
                                //lineTypeArray: ticketLuckyBonusStats[t].lineTypeArray,
                                walletType: "realMoney",
                                lineType: "Lucky Number Bonus"
                            }
                            Sys.Game.Game1.Services.GameServices.updateTicket({_id: ticketLuckyBonusStats[t].ticketId,gameId:gameId, playerIdOfPurchaser: ticketLuckyBonusStats[t].playerId }, { $set: {luckyNumberWinningStats: winningStats }, $inc: { totalWinningOfTicket: +parseFloat(ticketLuckyBonusStats[t].finalWonAmount).toFixed(4) }  });
                        }
                    }

                    multiLuckyBonusWinningArray = MultiLuckyBonusWinnig;
    
                }
                
                // lucky Number Bonus Distribution end


                // webgl gameFinish broadcast

                console.log("winners, bonus & luckyNumber", winnerArray, bonusArray, luckyNumberBonusArray )

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

                
                console.log("fianl admin winner, bonus, lucky ", JSON.stringify(winnerAdminResultArray) )

                let fullHousewinners = 0;
                for(let f=0; f< winnerAdminResultArray.length; f++){
                    if(winnerAdminResultArray[f].isFullHouse == true){
                        fullHousewinners = fullHousewinners + parseInt(winnerAdminResultArray[f].count);
                    }

                    // check for hall and online players

                    /*let hallPlayers = [...winnerAdminResultArray[f].playerIdArray.reduce( (mp, o) => {
                        if (!mp.has(o.hallName)) mp.set(o.hallName, { ...o, count: 0 });
                        mp.get(o.hallName).count++;
                        return mp;
                    }, new Map).values()];

                    let playerTypes = [...winnerAdminResultArray[f].playerIdArray.reduce( (mp, o) => {
                        if (!mp.has(o.userType)) mp.set(o.userType, { ...o, count: 0 });
                        mp.get(o.userType).count++;
                        return mp;
                    }, new Map).values()];

                    let hallSpecificWinners = [];
                    let playerTypeSpecificWinners = [];
                    if(hallPlayers.length > 0){
                        for(let h =0; h < hallPlayers.length; h++){
                            hallSpecificWinners.push({hallName: hallPlayers[h].hallName, count: hallPlayers[h].count})
                        }
                    }

                    if(playerTypes.length > 0){
                        for(let h =0; h < playerTypes.length; h++){
                            playerTypeSpecificWinners.push({userType: playerTypes[h].userType, count: playerTypes[h].count})
                        }
                    }
                    winnerAdminResultArray[f].hallSpecificWinners = hallSpecificWinners;
                    winnerAdminResultArray[f].playerTypeSpecificWinners = playerTypeSpecificWinners;
                    console.log("Admin hallPlayers and playertypes", hallPlayers, playerTypes, hallSpecificWinners, playerTypeSpecificWinners, winnerAdminResultArray[f]) */


                    
                }
                //winnerAdminResultArray = winnerAdminResultArray.map(({lineType, hallSpecificWinners, playerTypeSpecificWinners, count})  => ({lineType, hallSpecificWinners, playerTypeSpecificWinners, count}));
                winnerAdminResultArray = winnerAdminResultArray.map(({lineType, finalWonAmount, playerIdArray, count, halls})  => ({lineType, finalWonAmount, playerIdArray, count, halls}));
                console.log("admin broadcast for game finish", JSON.stringify( {
                    "totalWithdrawCount": room.withdrawNumberArray.length,
                    "fullHouseWinners": fullHousewinners,
                    "patternsWon": MultiWinnig.length, //winnerAdminResultArray.length,
                    "winners": winnerAdminResultArray
                } ));
                
                Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                    $set: {
                        'otherData.winnerAdminResultArray': winnerAdminResultArray,
                    }
                });
                
                await Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('GameFinishAdmin', 
                {
                    "totalWithdrawCount": room.withdrawNumberArray.length,
                    "fullHouseWinners": fullHousewinners,
                    "patternsWon": winnerAdminResultArray.length,
                    "winners": winnerAdminResultArray
                });
                // webgl gameFinish broadcast

                console.log("allWinnersArray", allWinnersArray)
                let loosers = [];
                for(let l =0; l < room.players.length; l++){
                    console.log("room.players[l].id", room.players[l].id.toString(), room.players[l].id)
                    if( !allWinnersArray.includes( room.players[l].id.toString() )){
                        if(room.players[l].userType != "Physical"){
                            loosers.push(room.players[l].id)
                        }
                    }
                }
                console.log("loosers", loosers)
                if(loosers.length > 0){
                    let looserPlayers =  await Sys.Game.Game1.Services.PlayerServices.getByData({ "_id": { $in: loosers } }, {enableNotification: 1, socketId: 1, selectedLanguage: 1});
                    console.log("looserPlayers", looserPlayers);
                    let bulkLosserArr = [];
                    for(let w =0; w < looserPlayers.length; w++){
                        await Sys.Io.of(Sys.Config.Namespace.Game1).to("/Game1#"+looserPlayers[w].socketId).emit('GameFinish', {
                            message: await translate({key: "game1_not_won", language: looserPlayers[w].selectedLanguage}), gameId: gameId
                        });
                        if (looserPlayers[w].enableNotification == true) {
                            let notification ={
                                notificationType:'gameFinish',
                                message: { en: await translate({key: "game1_not_won_params", language: 'en', isDynamic: true, number: room.gameNumber, number1: room.gameName}), nor: await translate({key: "game1_not_won_params", language: 'nor', isDynamic: true, number: room.gameNumber, number1: room.gameName}) }  //room.gameNumber + " [ " + room.gameName + " ] Game over & you haven't won any patterns on your ticket(s).\n Better luck next time!",

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
                            // await Sys.Io.to(looserPlayers[w].socketId).emit('NotificationBroadcast', {
                            //     notificationType: notification.notificationType,
                            //     message: notification.message[looserPlayers[w].selectedLanguage] //notification.message
                            // });    
                        }
                    }
                    console.log("bulkLosserArr", bulkLosserArr)
                    if(bulkLosserArr.length > 0){
                        Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkLosserArr);
                    }
                    await Sys.Game.Game1.Services.PlayerServices.updateManyData({ "_id": { $in: loosers } },  { $inc: { "statisticsgame1.totalGamesLoss": 1  } });
                }else{
                    console.log("NO loosers", gameId);
                }

                if(winningNotificationBroadcast.length > 0){
                    for(let w =0; w < winningNotificationBroadcast.length; w++){
                        // console.log("send winning notification broadcast", winningNotificationBroadcast[w].socketId)
                        // await Sys.Io.to(winningNotificationBroadcast[w].socketId).emit('NotificationBroadcast', {
                        //     notificationType: winningNotificationBroadcast[w].notificationType,
                        //     message: winningNotificationBroadcast[w].message
                        // });

                        console.log("game finshed socket id 1", "/Game1#"+winningNotificationBroadcast[w].socketId )
                        await Sys.Io.of(Sys.Config.Namespace.Game1).to("/Game1#"+winningNotificationBroadcast[w].socketId).emit('GameFinish', {
                            message: winningNotificationBroadcast[w].message, gameId: gameId
                        });
                        
                    }
                }else{
                    console.log("NO notification", gameId);
                }

                if(winningJackpotBroadcast.length > 0){
                    for(let w =0; w < winningJackpotBroadcast.length; w++){
                        await Sys.Io.to(winningJackpotBroadcast[w].socketId).emit('NotificationBroadcast', {
                            notificationType: winningJackpotBroadcast[w].notificationType,
                            message: winningJackpotBroadcast[w].message
                        });
                    }
                }else{
                    console.log("NO Jackpot notification", gameId);
                }


                if(winningLuckyNumberBroadcast.length > 0){
                    for(let w =0; w < winningLuckyNumberBroadcast.length; w++){
                        await Sys.Io.to(winningLuckyNumberBroadcast[w].socketId).emit('NotificationBroadcast', {
                            notificationType: winningLuckyNumberBroadcast[w].notificationType,
                            message: winningLuckyNumberBroadcast[w].message
                        });
                    }
                }else{
                    console.log("NO Lucky winner notification", gameId);
                }
                // profit or loss for admin
            
                // send push notification after game completes to all winners
                //Sys.Helper.gameHelper.sendWinnersNotifications(room._id, sortedWinnerArray);
                Sys.Game.Game1.Services.GameServices.updateManyTicketData({gameId:gameId },{ $set: {status: 'Finished'} });
                
                // comment minigame data hear and use this as a function
                await module.exports.checkForMinigames(gameId);
                /*let extraGamesTimeout = setTimeout(async function () {
                    clearTimeout(extraGamesTimeout);
                    let winnersExtra =await Sys.Game.Game1.Services.GameServices.getByData({ _id: gameId },{winners: 1});
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
                                wofWinnersPlayers.push({playerId: winnersExtra[0].winners[e].playerId,WinningAmount: 0, ticketId: winnersExtra[0].winners[e].ticketId, ticketNumber: winnersExtra[0].winners[e].ticketNumber, playerName: winnersExtra[0].winners[e].playerName, playerType: winnersExtra[0].winners[e].userType, hallName: winnersExtra[0].winners[e].hallName});
                            }
                            if(winnersExtra[0].winners[e].isTchest == true){
                                if(winnersExtra[0].winners[e].userType == "Unique" || winnersExtra[0].winners[e].userType == "Online" || winnersExtra[0].winners[e].userType == "Physical"){
                                    tChestWinners.push(winnersExtra[0].winners[e].playerId);
                                }
                                tChestWinnersPlayers.push({playerId: winnersExtra[0].winners[e].playerId,WinningAmount: 0, ticketId: winnersExtra[0].winners[e].ticketId,  lineType: winnersExtra[0].winners[e].lineType, ticketNumber: winnersExtra[0].winners[e].ticketNumber, playerName: winnersExtra[0].winners[e].playerName, ticketColorName: winnersExtra[0].winners[e].ticketColorName, ticketPrice: winnersExtra[0].winners[e].ticketPrice, playerType: winnersExtra[0].winners[e].userType, hallName: winnersExtra[0].winners[e].hallName});
                            }
                            if(winnersExtra[0].winners[e].isMys == true){
                                if(winnersExtra[0].winners[e].userType == "Unique" || winnersExtra[0].winners[e].userType == "Online" || winnersExtra[0].winners[e].userType == "Physical"){
                                    mysteryWinners.push(winnersExtra[0].winners[e].playerId);
                                }
                                mysteryWinnersPlayers.push({playerId: winnersExtra[0].winners[e].playerId,WinningAmount: 0, ticketId: winnersExtra[0].winners[e].ticketId,  lineType: winnersExtra[0].winners[e].lineType, ticketNumber: winnersExtra[0].winners[e].ticketNumber, playerName: winnersExtra[0].winners[e].playerName, ticketColorName: winnersExtra[0].winners[e].ticketColorName, ticketPrice: winnersExtra[0].winners[e].ticketPrice, playerType: winnersExtra[0].winners[e].userType, hallName: winnersExtra[0].winners[e].hallName});
                            }
                            if(winnersExtra[0].winners[e].isColorDraft == true){
                                if(winnersExtra[0].winners[e].userType == "Unique" || winnersExtra[0].winners[e].userType == "Online" || winnersExtra[0].winners[e].userType == "Physical"){
                                    colorDraftWinners.push(winnersExtra[0].winners[e].playerId);
                                }
                                colorDraftWinnersPlayers.push({playerId: winnersExtra[0].winners[e].playerId,WinningAmount: 0, ticketId: winnersExtra[0].winners[e].ticketId,  lineType: winnersExtra[0].winners[e].lineType, ticketNumber: winnersExtra[0].winners[e].ticketNumber, playerName: winnersExtra[0].winners[e].playerName, ticketColorName: winnersExtra[0].winners[e].ticketColorName, ticketPrice: winnersExtra[0].winners[e].ticketPrice, playerType: winnersExtra[0].winners[e].userType, hallName: winnersExtra[0].winners[e].hallName});
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
                                            // console.log("showSpinnerButton---", showSpinnerButton, sendWof, wofPlayerSockets[w]._id, wofPlayerSockets[w].id)
                                            
                                            // Sys.Io.of(Sys.Config.Namespace.Game1).to("/Game1#"+wofPlayerSockets[w].socketId).emit('ActivateMiniGame', {
                                            //     gameId: gameId,
                                            //     showSpinnerButton: showSpinnerButton,
                                            //     miniGameType: "wheelOfFortune"
                                            // });
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

                                    setTimeout(function () {
                                        console.log("playWheelOfFortune called from game");
                                        module.exports.playWheelOfFortune(null, {playerId: sendWof, gameId: gameId})
                                    },10000);

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
                                setTimeout(function () {
                                    Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
                                },5000);
                                setTimeout(async function () {
                                    await Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                        $set: {
                                            'otherData.isMinigameFinished': true, 
                                            'otherData.gameSecondaryStatus': 'finish',
                                            'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                                        }
                                    });
                                    Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
                                    room?.allHallsId.forEach(hall => {
                                        Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
                                    })
                                },10000);
                            }
                            

                            // setTimeout(function () {
                            //     Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {"playerIdsNotTORefresh": wofWinners});
                            // },5000);

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
                                        //console.log("showSpinnerButton---", showSpinnerButton, sendTChest, tChestPlayerSockets[w]._id, tChestPlayerSockets[w].id)
                                        
                                        // Sys.Io.of(Sys.Config.Namespace.Game1).to("/Game1#"+tChestPlayerSockets[w].socketId).emit('ActivateMiniGame', {
                                        //     gameId: gameId,
                                        //     showSpinnerButton: showSpinnerButton,
                                        //     miniGameType: "treasureChest"
                                        // });
                                    }
                                }

                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('ActivateMiniGame', {
                                    gameId: gameId,
                                    playerId: sendTChest,
                                    miniGameType: "treasureChest",
                                    isForAdmin: false
                                });
                                setTimeout(function () {
                                    console.log("SelectTreasureChest called from game");
                                    module.exports.SelectTreasureChest(null, {playerId: sendTChest, gameId: gameId, playerType: "Real"})
                                },10000);
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
                                setTimeout(function () {
                                    console.log("SelectTreasureChest called from game");
                                    module.exports.SelectTreasureChest(null, {playerId: tChestWinnersPlayers[0].playerId, gameId: gameId, playerType: "Admin"})
                                },10000);
                                Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                    $set: {
                                        'otherData.isMinigameActivated': true,
                                        'otherData.isMinigamePlayed': false,
                                        'otherData.isMinigameFinished': false,
                                        'otherData.isSpinByAdmin': true,
                                        'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                                    }
                                });
                                // console.log("physicalTicketIds----", physicalTicketNum, {
                                //     gameType: "Treasure Chest",
                                //     winner: {ticketNumbers: physicalTicketNum},
                                //     message: "Following Ticket number won Treasure Chest, Need to open chest in the hall to win the prizes."
                                // });
                                // Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminExtraGameNoti', {
                                //     gameType: "Treasure Chest", //adminExtraGameNoti
                                //     winner: {ticketNumbers: physicalTicketNum},
                                //     message: "Following Ticket number won Treasure Chest, Need to open chest in the hall to win the prizes."
                                // });
                                // setTimeout(function () {
                                //     Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
                                // },5000);
                                // setTimeout(function () {
                                //     Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
                                // },10000);
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

                                    // let turnCount = 0;
                                    // let mysteryTunrCounter =  setInterval(async function() {
                                    //     let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                                    //     Sys.Log.info("room in mystery game"+ room)
                                    //     if(room && room.otherData.isMinigameFinished == false){
                                    //         turnCount += 1;
                                    //         if(turnCount >= 6){
                                    //             console.log('<======= || Game was finish || =================>', turnCount);
                                    //             clearInterval(mysteryTunrCounter);
                                    //             //module.exports.mysteryGameFinished(null, {playerId: sendMys, gameId: gameId, playerType: "Real", turnCount: turnCount});
                                    //             return false;
                                    //         }else{
                                    //             Sys.Log.info("auto turn called 1");
                                    //             let isHigherNumber = false;
                                    //             if( fortuna.random() >= 0.51 ){
                                    //                 isHigherNumber = true;
                                    //             }
                                    //             Sys.Log.info("auto turn called 2");
                                    //             await module.exports.selectMysteryAuto(null, {playerId: sendMys, gameId: gameId, playerType: "Auto", turnCount: turnCount, isHigherNumber: isHigherNumber})
                                    //         }
                                    //     }else{
                                    //         clearInterval(mysteryTunrCounter);
                                    //         return false;
                                    //     }
                                        
                                    // }, 11000);

                                    let mysteryTurnCount = setTimeout(async function () {
                                        clearTimeout(mysteryTurnCount);
                                        let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                                        Sys.Log.info("room in mystery game"+ room)
                                        if(room && room.otherData.isMinigameFinished == false && room.otherData.mysteryTurnCounts == 0){
                                            module.exports.selectMysteryAuto(null, {playerId: sendMys, gameId: gameId, playerType: "Auto", turnCount: 1, isHigherNumber: true});
                                        }else{
                                            clearTimeout(mysteryTurnCount);
                                            return false;
                                        }
                                    }, 10000 );

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

                                    // let turnCount = 0;
                                    // let mysteryTunrAdminCounter =  setInterval(async function() {
                                    //     let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                                    //     if(room && room.otherData.isMinigameFinished == false){
                                    //         turnCount += 1;
                                    //         if(turnCount >= 6){
                                    //             console.log('<======= || Game was finish || =================>', turnCount);
                                    //             clearInterval(mysteryTunrAdminCounter);
                                    //             module.exports.mysteryGameFinished(null, {playerId: sendMys, gameId: gameId, playerType: "Admin", turnCount: turnCount});
                                    //             return false;
                                    //         }else{
                                    //             let isHigherNumber = false;
                                    //             if( fortuna.random() >= 0.51 ){
                                    //                 isHigherNumber = true;
                                    //             }
                                    //             await module.exports.selectMysteryAuto(null, {playerId: sendMys, gameId: gameId, playerType: "Admin", turnCount: turnCount, isHigherNumber: isHigherNumber})
                                    //         }
                                    //     }else{
                                    //         clearInterval(mysteryTunrCounter);
                                    //         return false;
                                    //     }
                                        
                                    // }, 11000);
                                    
                                    let mysteryTurnCount = setTimeout(async function () {
                                        clearTimeout(mysteryTurnCount);
                                        let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                                        Sys.Log.info("room in mystery game"+ room)
                                        if(room && room.otherData.isMinigameFinished == false && room.otherData.mysteryTurnCounts == 0){
                                            module.exports.selectMysteryAuto(null, {playerId: mysteryWinnersPlayers[0].playerId, gameId: gameId, playerType: "Auto", turnCount: 1, isHigherNumber: true});
                                        }else{
                                            clearTimeout(mysteryTurnCount);
                                            return false;
                                        }
                                    }, 10000 );
                                    
                                }
                            }else{
                                setTimeout(function () {
                                    Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
                                    Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
                                    room?.allHallsId.forEach(hall => {
                                        Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
                                    })
                                },5000);
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

                                    let colorDraftTurnCount = setTimeout(async function () {
                                        clearTimeout(colorDraftTurnCount);
                                        let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                                        Sys.Log.info("room in color draft game"+ room)
                                        if(room && room.otherData.isMinigameFinished == false && room.otherData.miniGameturnCounts == 0){
                                            let allIndex = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
                                            let selectedIndex = allIndex[Math.floor(fortuna.random() * allIndex.length)];
                                            module.exports.selectColorDraftAuto(null, {playerId: sendColorDraft, gameId: gameId, playerType: "Auto", turnCount: 1, selectedIndex: selectedIndex});
                                        }else{
                                            clearTimeout(colorDraftTurnCount);
                                            return false;
                                        }
                                    }, 10000 );

                                }else{
                                    console.log("Physical player won the Color Draft.");
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
    
                                    let colorDraftTurnCount = setTimeout(async function () {
                                        clearTimeout(colorDraftTurnCount);
                                        let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                                        Sys.Log.info("room in color draft game"+ room)
                                        if(room && room.otherData.isMinigameFinished == false && room.otherData.miniGameturnCounts == 0){
                                            let allIndex = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
                                            let selectedIndex = allIndex[Math.floor(fortuna.random() * allIndex.length)];
                                            module.exports.selectColorDraftAuto(null, {playerId: colorDraftWinnersPlayers[0].playerId, gameId: gameId, playerType: "Auto", turnCount: 1, selectedIndex: selectedIndex});
                                        }else{
                                            clearTimeout(colorDraftTurnCount);
                                            return false;
                                        }
                                    }, 10000 );
                                    
                                }
                            }else{
                                setTimeout(function () {
                                    Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
                                    Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
                                     room?.allHallsId.forEach(hall => {
                                        Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
                                    })
                                },5000);
                            }
                            
                        }else{
                            console.log("Online or Unique userType WOF winner not found.");
                            setTimeout(function () {
                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
                                 room?.allHallsId.forEach(hall => {
                                        Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
                                    })
                            },5000);
                        }
                    
                    }
                }, (5000) );*/
                //winnersExtra and update parent game status Need to work 


                //Tell Admin that Game Finished
                Sys.Io.of("admin").emit('GameFinish', { id: gameId });
                // refresh room to display new game screen
                if( (room.gameName != "Wheel of Fortune" && room.gameName != "Treasure Chest" && room.gameName != "Mystery" && room.gameName != "Color Draft") || winnerArray.length == 0){
                    setTimeout(function () {
                        Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
                        module.exports.nextGameCountDownStart(room.halls);
                    },5000);
                    setTimeout(function () {
                        Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
                        room?.halls.forEach(hall => {
                            Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
                        })
                    },10000);
                }

                if(room.gameName == "Innsatsen"){
                    let dailySchedule = await Sys.App.Services.scheduleServices.getSingleDailySchedulesData({ _id: room.parentGameId},{innsatsenSales: 1},{});
                    console.log("dailySchedule---", dailySchedule.innsatsenSales);
                    let innBeforeSales = +parseFloat(dailySchedule.innsatsenSales).toFixed(2);
                    let fullhousePrize = +parseFloat(room.subGames[0].options[0].winning['Full House']).toFixed(2);
                    let fullHousePrizeNextGame = await Sys.Game.Game1.Services.GameServices.getSingleByData({ parentGameId: room.parentGameId, gameName: "Innsatsen", status: "active" }, {gameNumber:1, gameName: 1, subGames: 1});
                    console.log("fullHousePrizeNextGame---", fullHousePrizeNextGame);
                    if(fullHousePrizeNextGame){
                        fullhousePrize = +parseFloat(fullHousePrizeNextGame.subGames[0].options[0].winning['Full House']).toFixed(2);;
                    }
                    console.log("fullhousePrize & sales", fullhousePrize, innBeforeSales);
        
                    let totalPreviousSales = innBeforeSales;
        
                    let currentGameSalesTemp = +parseFloat(room.earnedFromTickets).toFixed(2);
                    let currentGameSales = +parseFloat(exactMath.div( exactMath.mul(currentGameSalesTemp, 20),  100) ).toFixed(2);
                    console.log("currentGameSales---", currentGameSales);
                    //if( (innBeforeSales + fullhousePrize) < 2000 ){
                        if( (innBeforeSales + fullhousePrize + currentGameSales) <= 2000 ){
                            totalPreviousSales = +parseFloat(innBeforeSales + currentGameSales).toFixed(2);
                        }else{
                            let deductFromSales = (innBeforeSales + fullhousePrize + currentGameSales) - 2000; 
                            console.log("deductFromSales---", deductFromSales);
                            totalPreviousSales = +parseFloat( innBeforeSales + (currentGameSales - deductFromSales) ).toFixed(2);
                        }
        
                    // }else{
        
                    // }
                    console.log("totalPreviousSales---", totalPreviousSales)
                    await Sys.App.Services.scheduleServices.updateDailySchedulesData({ _id: room.parentGameId },{
                        $set: { "innsatsenSales": Math.round(totalPreviousSales)  }
                    });
                    
                }
                
                if(room.gameName == "Innsatsen" && room.otherData.isInnsatsenJackpotWon == true){
                    console.log("update innsatsen sales to zero")
                    await Sys.App.Services.scheduleServices.updateDailySchedulesData({ _id: room.parentGameId },{
                        $set: { "innsatsenSales": 0  }
                    });
                }
                Sys.Io.of('admin').emit('refreshSchedule', {scheduleId:  room.parentGameId});
                Sys.Game.Common.Controllers.GameController.game1StatusCron();

                //module.exports.nextGameCountDownStart(room.halls);
                
                return {
                    status: 'success',
                    message: "Winners Found!"
                }    
            }else{
                console.log("room not found in gameFinsihed", gameId);
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
            let wheelOfFortuneList = await Sys.App.Services.otherGameServices.getByData({ slug: 'wheelOfFortune' });
            console.log("wheelOfFortuneList.wheelOfFortuneprizeList", wheelOfFortuneList.wheelOfFortuneprizeList)
            return {
                status: 'success',
                result: {"prizeList": wheelOfFortuneList.wheelOfFortuneprizeList},
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
            let room = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, {wofWinners: 1, gameNumber: 1, gameType: 1, subGames: 1, winners: 1});
            console.log("room--", room)
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
                    //let maximumAmount = parseInt(4000/winnerCount);
                    //let prizeList = wheelOfFortuneList.wheelOfFortuneprizeList.filter((e) => e <= maximumAmount );
                    //console.log("New PrizeList", winnerCount, maximumAmount, prizeList);
                    let prizeList = wheelOfFortuneList.wheelOfFortuneprizeList;
                    const randomIndex = Math.floor(Math.random() * prizeList.length);
                    let amount = prizeList[randomIndex];
                    let afterDistributionAmount = Math.round(exactMath.div(amount, winnerCount) ); //+parseFloat(exactMath.div(amount, winnerCount) ).toFixed(2);
                    console.log('\x1b[36m%s\x1b[0m', '----------------------------------------------------------------------');
                    console.log('\x1b[36m%s\x1b[0m', '[ Mini Game (Game 1) [ Wheel of Fortune] Winner Amount:- ' + amount + ']', data.playerId);
                    console.log('\x1b[36m%s\x1b[0m', '----------------------------------------------------------------------');
                
                    Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId}, {
                        $set: {
                            'winners.$[current].wonAmount': afterDistributionAmount,
                        },
                    }, { arrayFilters: [ {"current.isWoF": true} ], new: true });

                    Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId}, {
                        $set: {
                            'wofWinners.$[].WinningAmount': afterDistributionAmount,
                            'otherData.miniGameResults': [{winningAmount: amount}]
                        },
                    }, {  new: true });

                    // let wofWinners = room[0].wofWinners;
                    // let wofWinnersPlayers = [];
                    // if(wofWinners.length > 0){
                    //     for(let w=0; w < wofWinners.length; w++){
                    //         wofWinnersPlayers.push(wofWinners[w].playerId)
                    //     }

                    //     let wofPlayerSockets = await Sys.Game.Common.Services.PlayerServices.getByDataPlayers({ "_id": { $in: wofWinnersPlayers } }, { socketId: 1 });
                    //     console.log("wofPlayerSockets", wofPlayerSockets)
                    //     if(wofPlayerSockets.length > 0){
                    //         for(w =0; w < wofPlayerSockets.length; w++){
                    //             console.log("socketId", "/Game1#"+ wofPlayerSockets[w].socketId);
                    //             Sys.Io.of(Sys.Config.Namespace.Game1).to("/Game1#"+wofPlayerSockets[w].socketId).emit('startSpinWheel', {
                    //                 gameId: data.gameId,
                    //                 amount: amount,
                    //                 miniGameType: "wheelOfFortune"
                    //             });
                    //         }
                    //     }
                    // }

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

                    Sys.Io.of(Sys.Config.Namespace.Game1).to(data.gameId).emit('startSpinWheel', {
                        gameId: data.gameId,
                        amount: amount,
                        miniGameType: "wheelOfFortune",
                        winningTicketNumbers: {physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners} 
                    });
                    // Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId }, {
                    //     $set: {
                    //         'otherData.isMinigamePlayed': true,
                    //     }
                    // });

                    // Send stop wheel of fortuen broadcast to all players and TV Screen
                    setTimeout(async function () {
                        await Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId }, {
                            $set: {
                                'otherData.isWofSpinStopped': true,
                            }
                        });
                        Sys.Io.of(Sys.Config.Namespace.Game1).to(data.gameId).emit('stopSpinWheel', {
                            gameId: data.gameId,
                            amount: amount,
                            miniGameType: "wheelOfFortune",
                            winningTicketNumbers: {physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners} 
                        });
                    },10000);
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

            let isUpdated = await Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId, "otherData.isMinigameFinished": false }, {
                $set: {
                    'otherData.isMinigameFinished': true,
                    'otherData.gameSecondaryStatus': 'finish'
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
                console.log("ticketId", ticketId);
                let tempTicketData = await Sys.Game.Game1.Services.GameServices.getTicketListData({ _id: ticketId}, {ticketColorName: 1, ticketPrice: 1});
                console.log("tempTicketData", tempTicketData)
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
                //console.log("winnerPlayerPatternWise", winnerPlayerPatternWise, room[0].wofWinners)
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
            
                        if(currentPlayer.firebaseToken){
                            let messageNotification = {
                                notification: {
                                    title: "Spillorama",
                                    body: message[currentPlayer.selectedLanguage]
                                },
                                token : currentPlayer.firebaseToken
                            };
                            Sys.Helper.gameHelper.sendWinnersNotifications(messageNotification);
                        }

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

            setTimeout(async function () {
                Sys.Game.Common.Controllers.GameController.game1StatusCron();
            }, 5000);
            setTimeout(async function () {
                module.exports.nextGameCountDownStart(room[0].halls);
            }, 10000);

            room[0]?.halls.forEach(hall => {
                Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
            })

            await Sys.Io.of('admin').to(room[0]._id.toString()).emit('refreshTicketTable');
            Sys.Io.of('admin').emit('refreshSchedule', {scheduleId:  room[0].parentGameId});
            
            return {
                status: 'success',
                message:  await translate({key: "wof_winner_already", language: player.selectedLanguage, isDynamic: true, number:  +room[0].wofWinners[0].WinningAmount}) //"Congratulations! You have won " + +room[0].wofWinners[0].WinningAmount +" Kr In Wheel of Fortune."
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
            let room = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, {tChestWinners: 1, gameNumber: 1, gameType: 1, subGames: 1, winners: 1});
            console.log("room--", room)
        
            if(room.length > 0){
                if(room[0].winners.length > 0){
                    /*let isIndex = room[0].winners.findIndex((e) =>  (e.playerId ==  data.playerId && e.enabledSpinner == true ) );
                    if(isIndex == -1){
                        console.log("You are not Eligible to play Treasure Chest Game!", data.playerId, data.gameId)
                        return {
                            status: 'fail',
                            result: null,
                            message: 'You are not Eligible to play Treasure Chest!',
                            statusCode: 400
                        }
                    }*/

                    let treasureChestList = await Sys.App.Services.otherGameServices.getByData({ slug: 'treasureChest' });
                    console.log("treasureChestList", treasureChestList.treasureChestprizeList)
                    
                    let result = {
                        prizeList: treasureChestList.treasureChestprizeList
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
           
            let room = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, { tChestWinners: 1, gameNumber: 1, gameType: 1, subGames: 1, winners: 1, gameName: 1, otherData: 1, halls : 1, parentGameId: 1});
        
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
                    'otherData.gameSecondaryStatus': 'finish'
                }
            });
            console.log("isUpdated---", isUpdated.modifiedCount)
            if(isUpdated && isUpdated.modifiedCount == 0){
                return false;
            }

            if(room[0].winners.length > 0){
                if(isPlayedByAdmin == false){
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

                /*Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId}, {
                    $set: {
                        'winners.$[current].wonAmount': afterDistributionAmount,
                    },
                }, { arrayFilters: [ {"current.isTchest": true} ], new: true });

                Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId}, {
                    $set: {
                        'tChestWinners.$[].WinningAmount': afterDistributionAmount,
                    },
                }, {  new: true });*/
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
                        Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId}, {
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
                        // let transactionDataSend = {
                        //     playerId: tChectWinners[w].playerId,
                        //     playerName: tChectWinners[w].playerName,
                        //     gameId: data.gameId,
                        //     transactionSlug: "TChestPrizeGame1",
                        //     action: "debit",
                        //     purchasedSlug: "cash",
                        //     gameNumber: room[0].gameNumber,
                        //     gameType: room[0].gameType,
                        //     patternPrize: +finalWinningAmount,
                        //     //previousBalance: +player.points.toFixed(4),
                        //     variantGame: room[0].subGames[0].gameName,
                        //     ticketPrice: tChectWinners[w].ticketPrice,
                        //     ticketColorType: tChectWinners[w].ticketColorName,
                        //     ticketId: tChectWinners[w].ticketId,
                        //     ticketNumber:  tChectWinners[w].ticketNumber,
                        //     hallName: tChectWinners[w].hallName,
                        //     game1Slug:"TChestPrizeGame1",
                        //     typeOfTransaction: "Treasure Chest Prize",
                        //     remark: "Win Prize " + finalWinningAmount + " in Game 1 Treasure Chest Game", //remark on transaction
                        //     userType: "Physical"
                        // }
                        // Sys.Helper.gameHelper.createTransactionAgent(transactionDataSend); 
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

                let latestRoom = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, {tChestWinners: 1});
                let tChectWinnersUpdated = latestRoom[0].tChestWinners;

                /*let tChectPlayers = [];
                if(tChectWinnersUpdated.length > 0){
                    for(let w=0; w < tChectWinnersUpdated.length; w++){
                        tChectPlayers.push(tChectWinnersUpdated[w].playerId)
                    }

                    let tChectPlayerSockets = await Sys.Game.Common.Services.PlayerServices.getByDataPlayers({ "_id": { $in: tChectPlayers } }, { socketId: 1 });
                    console.log("tChectPlayerSockets", tChectPlayerSockets)
                    if(tChectPlayerSockets.length > 0){
                        for(w =0; w < tChectPlayerSockets.length; w++){
                            console.log("socketId", "/Game1#"+ tChectPlayerSockets[w].socketId);
                            Sys.Io.of(Sys.Config.Namespace.Game1).to("/Game1#"+tChectPlayerSockets[w].socketId).emit('openTreasureChest', {
                                gameId: data.gameId,
                                amount: +currentPlayerWinningAmount,
                                miniGameType: "treasureChest"
                            });
                        }
                    }
                }*/

                Sys.Io.of(Sys.Config.Namespace.Game1).to(data.gameId).emit('openTreasureChest', {
                    gameId: data.gameId,
                    //amount: +currentPlayerWinningAmount,
                    amount: amount,
                    playerFinalWinningAmount: +currentPlayerWinningAmount,
                    miniGameType: "treasureChest",
                    winningTicketNumbers: {physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners} 
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
                
                            if(currentPlayer.firebaseToken){
                                let message = {
                                    notification: {
                                        title: "Spillorama",
                                        body: message[currentPlayer.selectedLanguage]
                                    },
                                    token : currentPlayer.firebaseToken
                                };
                                Sys.Helper.gameHelper.sendWinnersNotifications(message);
                            }
                        }
                    }
                    Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkArr);
                }

                setTimeout(async function () {
                    Sys.Game.Common.Controllers.GameController.game1StatusCron();
                }, 5000);
                setTimeout(async function () {
                    module.exports.nextGameCountDownStart(room[0].halls);
                }, 10000);

                room[0]?.halls.forEach(hall => {
                    Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
                })

                await Sys.Io.of('admin').to(room[0]._id.toString()).emit('refreshTicketTable');
                Sys.Io.of('admin').emit('refreshSchedule', {scheduleId:  room[0].parentGameId});
                
                let result = {
                    winningPrize: +currentPlayerWinningAmount,
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

    patternListing: async function(gameId){
        try{
            console.log("update remaining patterns broadcast")
            let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {winners: 1, subGames: 1, gameName: 1, earnedFromTickets: 1, parentGameId: 1, jackpotPrize: 1});
            if (!room) {
                return {
                    patternList: []
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
            console.log("room & patternList", room, patternListTemp)
            if(patternListTemp.length > 0){
                for(let p=0; p< patternListTemp.length; p++){
                    if(patternListTemp[p] == "Row 1" ){ patternList.push({name: "Row 1", patternDesign : 1, patternDataList: [], amount: Math.round( getHighestPrice("Row 1") ), message: "", isWon: false}) }
                    else if(patternListTemp[p] == "Row 2"){ patternList.push({name: "Row 2", patternDesign : 2, patternDataList: [], amount: Math.round( getHighestPrice("Row 2") ), message: "", isWon: false}) }
                    else if(patternListTemp[p] == "Row 3"){ patternList.push({name: "Row 3", patternDesign : 3, patternDataList: [], amount: Math.round( getHighestPrice("Row 3") ), message: "", isWon: false}) }
                    else if(patternListTemp[p] == "Row 4"){ patternList.push({name: "Row 4", patternDesign : 4, patternDataList: [], amount: Math.round( getHighestPrice("Row 4") ), message: "", isWon: false}) }
                    else if(patternListTemp[p] == "Picture"){patternList.push({name: "Picture", patternDesign : 0, patternDataList: [0,0,0,0,0, 0,1,1,1,0, 0,1,1,1,0, 0,1,1,1,0, 0,0,0,0,0], amount: Math.round( getHighestPrice("Picture") ), message: "", isWon: false}) }
                    else if(patternListTemp[p] == "Frame"){patternList.push({name: "Frame", patternDesign : 0, patternDataList: [1,1,1,1,1, 1,0,0,0,1, 1,0,1,0,1, 1,0,0,0,1, 1,1,1,1,1], amount: Math.round( getHighestPrice("Frame") ), message: "", isWon: false}) }
                    else if(patternListTemp[p] == "Full House"){
                        let winningAmount = 0;
                        let message = "";
                        // if(room.gameName == "Jackpot"){
                        //     //winningAmount = room.jackpotPrize;
                        //     let jackpotPrizeTemp = Object.values(room.jackpotPrize);
                        //     console.log("jackpotPrizeTemp--", jackpotPrizeTemp)
                        //     winningAmount = Math.max(...jackpotPrizeTemp);
                        //     message = "Jackpot Winning"
                        // }else 
                        if(room.gameName == "Wheel of Fortune" || room.gameName == "Treasure Chest"){
                            if(room.gameName == "Wheel of Fortune"){
                                message = "Spin Wheel of Fortune to Win";
                                let wheelOfFortuneList = await Sys.App.Services.otherGameServices.getByData({ slug: 'wheelOfFortune' });
                                winningAmount = Math.max.apply(null, wheelOfFortuneList.wheelOfFortuneprizeList);
                            }else{
                                message = "Open Treasure Chest to Win";
                                let treasureChestList = await Sys.App.Services.otherGameServices.getByData({ slug: 'treasureChest' });
                                winningAmount = Math.max.apply(null, treasureChestList.treasureChestprizeList);
                            }
                        }
                        // else if(room.gameName == "Oddsen 56"){
                        //     let oddsendPrize  = getHighestPrice("Full House Within 56 Balls");
                        //     let fullHousePrize = getHighestPrice("Full House");
                        //     console.log("oddsendPrize & fullHousePrize", oddsendPrize, fullHousePrize)
                        //     winningAmount = (oddsendPrize > fullHousePrize) ? oddsendPrize : fullHousePrize;
                        // }else if(room.gameName == "Oddsen 57"){
                        //     let oddsendPrize  = getHighestPrice("Full House Within 57 Balls");
                        //     let fullHousePrize = getHighestPrice("Full House");
                        //     console.log("oddsendPrize & fullHousePrize", oddsendPrize, fullHousePrize)
                        //     winningAmount = (oddsendPrize > fullHousePrize) ? oddsendPrize : fullHousePrize;
                        // }else if(room.gameName == "Oddsen 58"){
                        //     let oddsendPrize  = getHighestPrice("Full House Within 58 Balls");
                        //     let fullHousePrize = getHighestPrice("Full House");
                        //     console.log("oddsendPrize & fullHousePrize", oddsendPrize, fullHousePrize)
                        //     winningAmount = (oddsendPrize > fullHousePrize) ? oddsendPrize : fullHousePrize;
                        // }
                        else if(room.gameName == "Innsatsen"){
                            let dailySchedule = await Sys.App.Services.scheduleServices.getSingleDailySchedulesData({ _id: room.parentGameId},{innsatsenSales: 1},{});
                            console.log("dailySchedule---", dailySchedule.innsatsenSales);
                            let innBeforeSales = +parseFloat(dailySchedule.innsatsenSales).toFixed(2);
                            let fullhousePrize = +parseFloat(room.subGames[0].options[0].winning['Full House']).toFixed(2);;
                            console.log("fullhousePrize & sales", fullhousePrize, innBeforeSales);
                            /*if(room.status != "running"){
                                let currentGameSalesTemp = +parseFloat(room.earnedFromTickets).toFixed(2);
                                let currentGameSales = +parseFloat(exactMath.div( exactMath.mul(currentGameSalesTemp, 20),  100) ).toFixed(2);
                                winningAmount = ( (innBeforeSales + fullhousePrize + currentGameSales) >= 2000 ) ? 2000 : (innBeforeSales + fullhousePrize + currentGameSales);
                            }else{
                                winningAmount = (innBeforeSales + fullhousePrize);
                            }*/
                            winningAmount = ( (innBeforeSales + fullhousePrize) > 2000 ) ? 2000 : (innBeforeSales + fullhousePrize);
                            
                        }else if(room.gameName == "Mystery"){
                            message = "Play Mystery game to Win";
                            let mysteryWinningList = await Sys.App.Services.otherGameServices.getByData({ slug: 'mystery' });
                            winningAmount = Math.max.apply(null, mysteryWinningList.mysteryPrizeList);
                        }else if(room.gameName == "Color Draft"){
                            message = "Play Color Draft game to Win";
                            let colordraftWinningList = await Sys.App.Services.otherGameServices.getByData({ slug: 'colorDraft' });
                            console.log("colordraftWinningList---", colordraftWinningList)
                            if(colordraftWinningList && colordraftWinningList.colordraftPrizeList && colordraftWinningList.colordraftPrizeList.length > 0){
                                let winningList = colordraftWinningList.colordraftPrizeList;
                                winningList.sort((x,y) => y.amount-x.amount);
                                let top3Winnings = winningList.splice(0,3);
                                winningAmount = top3Winnings.reduce((n, {amount}) => n + +amount, 0)
                            }
                        }else{
                            winningAmount = getHighestPrice("Full House");
                            
                        } 
                        console.log("Winning amount without rounding", winningAmount);
                        winningAmount = Math.round(winningAmount);
                        console.log("Winning amount after rounding", winningAmount);
                        patternList.push({name: "Full House", patternDesign : 0, patternDataList: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], amount: winningAmount, message: message, isWon: false}) 
                    }
                }
            }
            return {
                patternList: patternList
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
            
            if(room.length > 0 && room[0].otherData && room[0].status == "finish"){
                console.log("result", room[0].otherData.mysteryGameResults)
                let currentTurnCountTimer = 10;
                if(room[0].otherData.mysteryTurnCounts >= 0){
                    
                    /*let currentTurnCountTimerTemp = room[0].otherData.mysteryStartTimeMs - ( (new Date()).getTime() - 10000 )
                    if(currentTurnCountTimerTemp > 0){
                        currentTurnCountTimer =  Math.round(currentTurnCountTimerTemp/1000)
                    }*/

                    if (Timeout.exists(room[0]._id.toString())) {
                        let currentTurnCountTimerTemp = Timeout.remaining(room[0]._id.toString());
                        if(currentTurnCountTimerTemp){
                            currentTurnCountTimer = Math.ceil(currentTurnCountTimerTemp/1000);
                        }
                        console.log("timeout remianing of minigames", currentTurnCountTimer)
                    }

                    // if(room[0].otherData.mysteryTurnCounts == 0){
                    //     let autoTurnFirstMoveTimeTemp = room[0].otherData.mysteryStartTimeMs - ( (new Date()).getTime() - 12000 )
                    //     if(autoTurnFirstMoveTimeTemp > 0){
                    //         autoTurnFirstMoveTime =  Math.round(autoTurnFirstMoveTimeTemp/1000)
                    //     }
                    // }else{
                    //     let autoTurnOtherMovesTimeTemp = room[0].otherData.mysteryStartTimeMs - ( (new Date()).getTime() - 12000 )
                    //     if(autoTurnOtherMovesTimeTemp > 0){
                    //         autoTurnOtherMovesTime =  Math.round(autoTurnOtherMovesTimeTemp/1000)
                    //     }
                    // }
                }
                console.log("first and second timer of mysterygame", currentTurnCountTimer)
                return {
                    status: 'success',
                    result: {
                        prizeList: room[0].otherData.mysteryGameResults.prizeList,
                        middleNumber: room[0].otherData.mysteryGameResults.middleNumber,
                        autoTurnMoveTime: 10,
                        autoTurnReconnectMovesTime: currentTurnCountTimer,
                        mysteryGameData: {
                            history: room[0].otherData.mysteryHistory,
                            turnCounts: ("mysteryTurnCounts" in room[0].otherData) ? room[0].otherData.mysteryTurnCounts: 0, 
                        }
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
                if(room.otherData?.isSpinByAdmin == false){
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "no_permission", language: language}), // 'You do not have permission to access.',
                        statusCode: 400
                    }
                } 
                //

                let ipOfAgent = socket.handshake.headers["x-forwarded-for"];
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
                if(masterHallIp && masterHallIp.ip && masterHallIp.ip == ipOfAgent){
                    console.log("Action taken by master agent", masterHallIp.ip, ipOfAgent);
                }else{
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({key: "no_permission", language: language}), // 'You do not have permission to access.',
                        statusCode: 400
                    }
                }
                //
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
                        message: await translate({key: "something_went_wrong", language: language}), // 'Something Went Wrong!',
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
                }else{
                    Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId }, {
                        $set: {
                            'otherData.mysteryStartTimeMs': (new Date()).getTime(),
                        }
                    });

                    /*let mysteryTurnCount = setTimeout(async function () {
                        clearTimeout(mysteryTurnCount);
                        let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, {otherData: 1});
                        console.log("room in mystery game turnCount", room, room.otherData.mysteryTurnCounts)
                        if(room && room.otherData.isMinigameFinished == false){
                            module.exports.selectMysteryAuto(null, {playerId: data.playerId, gameId: data.gameId, playerType: "Auto", turnCount: +data.turnCount+1, isHigherNumber: true});
                        }else{
                            clearTimeout(mysteryTurnCount);
                            return false;
                        }
                    }, 10000 );*/

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
           
            let room = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, { mystryWinners: 1, gameNumber: 1, gameType: 1, subGames: 1, winners: 1, gameName: 1, otherData: 1, halls : 1, parentGameId: 1});
        
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
                    'otherData.gameSecondaryStatus': 'finish'
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
                    Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId}, {
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
                    // let transactionDataSend = {
                    //     playerId: mystryWinners[w].playerId,
                    //     playerName: mystryWinners[w].playerName,
                    //     gameId: data.gameId,
                    //     transactionSlug: "mysteryPrizeGame1",
                    //     action: "debit",
                    //     purchasedSlug: "cash",
                    //     gameNumber: room[0].gameNumber,
                    //     gameType: room[0].gameType,
                    //     patternPrize: +finalWinningAmount,
                    //     //previousBalance: +player.points.toFixed(4),
                    //     variantGame: room[0].subGames[0].gameName,
                    //     ticketPrice: mystryWinners[w].ticketPrice,
                    //     ticketColorType: mystryWinners[w].ticketColorName,
                    //     ticketId: mystryWinners[w].ticketId,
                    //     ticketNumber:  mystryWinners[w].ticketNumber,
                    //     hallName: mystryWinners[w].hallName,
                    //     game1Slug:"mysteryPrizeGame1",
                    //     typeOfTransaction: "Mystery Prize",
                    //     remark: "Win Prize " + finalWinningAmount + " in Game 1 Mystery Game", //remark on transaction
                    //     userType: "Physical"
                    // }
                    // Sys.Helper.gameHelper.createTransactionAgent(transactionDataSend); 
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

            let latestRoom = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, {mystryWinners: 1});
            let mysteryWinnersUpdated = latestRoom[0].mystryWinners;

            console.log("broadcast---", {
                gameId: data.gameId,
                amount: +winningAmount,
                playerFinalWinningAmount: +currentPlayerWinningAmount,
                miniGameType: "Mystery",
                winningTicketNumbers: {physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners} 
            })
            Sys.Io.of(Sys.Config.Namespace.Game1).to(data.gameId).emit('mysteryGameFinishedAdmin', {
                gameId: data.gameId,
                amount: +winningAmount,
                playerFinalWinningAmount: +currentPlayerWinningAmount,
                miniGameType: "Mystery",
                winningTicketNumbers: {physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners} 
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
            
                        if(currentPlayer.firebaseToken){
                            let message = {
                                notification: {
                                    title: "Spillorama",
                                    body: message[currentPlayer.selectedLanguage]
                                },
                                token : currentPlayer.firebaseToken
                            };
                            Sys.Helper.gameHelper.sendWinnersNotifications(message);
                        }

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
            setTimeout(async function () {
                Sys.Game.Common.Controllers.GameController.game1StatusCron();
            }, 5000);
            setTimeout(async function () {
                module.exports.nextGameCountDownStart(room[0].halls);
            }, 10000);

            room[0]?.halls.forEach(hall => {
                Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
            })

            await Sys.Io.of('admin').to(room[0]._id.toString()).emit('refreshTicketTable');
            Sys.Io.of('admin').emit('refreshSchedule', {scheduleId:  room[0].parentGameId});
            
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
                if(room[0].otherData.mysteryTurnCounts >= 0){
                    
                    /*let currentTurnCountTimerTemp = room[0].otherData.miniGamestartTimeMs - ( (new Date()).getTime() - 10000 )
                    if(currentTurnCountTimerTemp > 0){
                        currentTurnCountTimer =  Math.round(currentTurnCountTimerTemp/1000)
                    }*/

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
                        autoTurnMoveTime: 10,
                        autoTurnReconnectMovesTime: currentTurnCountTimer,
                        miniGameData: {
                            history: room[0].otherData.miniGameHistory,
                            turnCounts: ("miniGameturnCounts" in room[0].otherData) ? room[0].otherData.miniGameturnCounts: 0, 
                        }
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
                if(room.otherData?.isSpinByAdmin == false){
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
                        message: await translate({key: "something_went_wrong", language: language}), // 'Something Went Wrong!',
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
                }else{
                    Sys.Game.Game1.Services.GameServices.updateGame({ _id: data.gameId }, {
                        $set: {
                            'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                        }
                    });

                    /*let colorDraftTurnCount = setTimeout(async function () {
                        clearTimeout(colorDraftTurnCount);
                        let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, {otherData: 1});
                        console.log("room in Color Draft game turnCount", room, room.otherData.miniGameturnCounts)
                        if(room && room.otherData.isMinigameFinished == false){
                            //alreadySelectedIndexes.push(selectedIndex);
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
                            clearTimeout(colorDraftTurnCount);
                            return false;
                        }
                    }, 10000 );*/

                    
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
           
            let room = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, { parentGameId: 1, colorDraftWinners: 1, gameNumber: 1, gameType: 1, subGames: 1, winners: 1, gameName: 1, otherData: 1, halls : 1});
        
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
                    'otherData.gameSecondaryStatus': 'finish'
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
                    Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId}, {
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
                    // let transactionDataSend = {
                    //     playerId: colorDraftWinners[w].playerId,
                    //     playerName: colorDraftWinners[w].playerName,
                    //     gameId: data.gameId,
                    //     transactionSlug: "colordraftPrizeGame1",
                    //     action: "debit",
                    //     purchasedSlug: "cash",
                    //     gameNumber: room[0].gameNumber,
                    //     gameType: room[0].gameType,
                    //     patternPrize: +finalWinningAmount,
                    //     //previousBalance: +player.points.toFixed(4),
                    //     variantGame: room[0].subGames[0].gameName,
                    //     ticketPrice: colorDraftWinners[w].ticketPrice,
                    //     ticketColorType: colorDraftWinners[w].ticketColorName,
                    //     ticketId: colorDraftWinners[w].ticketId,
                    //     ticketNumber:  colorDraftWinners[w].ticketNumber,
                    //     hallName: colorDraftWinners[w].hallName,
                    //     game1Slug:"colordraftPrizeGame1",
                    //     typeOfTransaction: "Color Draft Prize",
                    //     remark: "Win Prize " + finalWinningAmount + " in Game 1 Color Draft Game", //remark on transaction
                    //     userType: "Physical"
                    // }
                    // Sys.Helper.gameHelper.createTransactionAgent(transactionDataSend); 
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

            let latestRoom = await Sys.Game.Game1.Services.GameServices.getByData({ _id: data.gameId }, {colorDraftWinners: 1});
            let colordraftWinnersUpdated = latestRoom[0].colorDraftWinners;

            console.log("broadcast---", {
                gameId: data.gameId,
                amount: +winningAmount,
                playerFinalWinningAmount: +currentPlayerWinningAmount,
                miniGameType: "Color Draft",
                winningTicketNumbers: {physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners} 
            })
            Sys.Io.of(Sys.Config.Namespace.Game1).to(data.gameId).emit('colordraftGameFinishedAdmin', {
                gameId: data.gameId,
                amount: +winningAmount,
                playerFinalWinningAmount: +currentPlayerWinningAmount,
                miniGameType: "Color Draft",
                winningTicketNumbers: {physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners} 
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
    
                        // await Sys.Io.to(currentPlayer.socketId).emit('NotificationBroadcast', {
                        //     notificationType: notification.notificationType,
                        //     message: notification.message
                        // });
            
                        if(currentPlayer.firebaseToken){
                            let message = {
                                notification: {
                                    title: "Spillorama",
                                    body: message[currentPlayer.selectedLanguage]
                                },
                                token : currentPlayer.firebaseToken
                            };
                            Sys.Helper.gameHelper.sendWinnersNotifications(message);
                        }

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
            setTimeout(async function () {
                Sys.Game.Common.Controllers.GameController.game1StatusCron();
            }, 5000);
            setTimeout(async function () {
                module.exports.nextGameCountDownStart(room[0].halls);
            }, 10000);

            room[0]?.halls.forEach(hall => {
                Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
            })
            
            await Sys.Io.of('admin').to(room[0]._id.toString()).emit('refreshTicketTable');
            Sys.Io.of('admin').emit('refreshSchedule', {scheduleId:  room[0].parentGameId});
            
            return {
                status: 'success'
            }
            
        } catch (error) {
            console.log("Error in colordraftGameFinished Game1 : ", error);
            return new Error(error);
        }
    },

    //  new functions for game 1

    // gameInterval: async function(gameId) {
    //     try{
    //         let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, { players: 1, subGames: 1, seconds: 1, gameName: 1, parentGameId: 1, earnedFromTickets: 1, withdrawNumberArray: 1, withdrawNumberList: 1, jackpotDraw: 1, allHallsId: 1, halls: 1, otherData: 1, status: 1});
    //         console.log("gameInterval called", gameId, room)
    //         if (room && room.status == "running" && room.otherData.isPaused == true) {
    //             console.log(`Game is paused, can not run interval ${gameId}.`);
    //             return;
    //         }

    //         if(room.status == "finish"){
    //             if(room.gameName == "Wheel of Fortune" || room.gameName == "Treasure Chest" || room.gameName == "Mystery" || room.gameName == "Color Draft"){
    //                 if(room.otherData.isMinigameExecuted == false){
    //                     await module.exports.checkForMinigames(gameId);
    //                     return;
    //                 }else{
    //                     console.log(`Game is finished and Minigame is already started, so no need to do amything ${gameId}.`);
    //                     return;
    //                 }
    //             }
    //         }

    //         console.log("gameInterval called", gameId);
            
    //         let ballNumber = [];
    //         for (let b = 1; b <= 75; b++) {
    //             if(room.withdrawNumberArray.includes(b) == false){
    //                 ballNumber.push(b);
    //             }
    //         }

    //         let count = room.withdrawNumberArray.length;
    //         let achiveBallArr = room.withdrawNumberArray;
    //         let history = room.withdrawNumberList;
    //         console.log("ballNumber, count, achiveBallArr,history", ballNumber, count, achiveBallArr, history)
            
    //         clearInterval(Sys.GameTimers[room.id]);

    //         Sys.GameTimers[room.id] = setInterval(async function() {
    //             Sys.Log.info("ballNumber length and gameId: "+ ballNumber.length + " GameId: "+ gameId);
    //             if(count == 3){
    //                 console.log("ticket purchase has been disabled.")
    //                 await Sys.Game.Game1.Services.GameServices.updateGameNew(room._id, { $set: { disableTicketPurchase: true } });
    //                 Sys.App.Controllers.physicalTicketsController.deleteholdSellTicketsOfGame(room._id.toString());
    //             }
    //             let isFinished = false;
    //             if(count >= 24){
    //                 isFinished = await module.exports.checkForGameFinished(room._id);
    //                 console.log("game finished status", isFinished)
    //             }

    //             // To disable Jackpot Field
    //             if( ( room.gameName == "Jackpot" && count == (+room.jackpotDraw) ) || ( room.gameName == "Oddsen 56" && count == 56  ) || ( room.gameName == "Oddsen 57" && count == 57  ) || ( room.gameName == "Oddsen 58" && count == 58 ) ){
    //                 let patternRoom = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: room._id }, {winners: 1, subGames: 1, jackpotPrize: 1, jackpotDraw: 1, gameName: 1});
    //                 let patternListing = await module.exports.patternListing(room._id);
    //                 let patternList = patternListing.patternList;
    //                 const winningCombinations = [...new Set(patternRoom.winners.map(item => item.lineType))];
    //                 let finalPatternList = [];
    //                 for(let p=0; p < patternList.length; p++){
    //                     if( winningCombinations.includes(patternList[p].name) == false ){
    //                         patternList[p].isWon = false;
    //                         finalPatternList.push(patternList[p]);
    //                     }else{
    //                         patternList[p].isWon = true;
    //                         finalPatternList.push(patternList[p]);
    //                     }
    //                 }
    //                 await Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('PatternChange',  { patternList: finalPatternList, jackPotData: {isDisplay: false} } );
    //             }
    //             // To disable Jackpot Field

                
    //             Sys.Log.info("check game status, if already completed isFinished---"+ isFinished + " " + room._id + "  " + count);
    //             if(ballNumber.length <= 0 || isFinished == true){
    //                 console.log('<======= || Game was finish || =================>', Sys.GameTimers[room.id]);
    //                 clearInterval(Sys.GameTimers[room.id]);
    //                 let finishedResult =await module.exports.gameFinished(room._id);
    //                 console.log("finishedResult", finishedResult)
    //                 return false;
    //             }
    //             //[ Random Ball Pop ]
    //             //let withdrawBall = ballNumber[Math.floor(Math.random() * ballNumber.length)];
    //             let withdrawBall = ballNumber[ (Math.floor(fortuna.random() * ballNumber.length) ) ];
    //             ballNumber.splice(ballNumber.indexOf(withdrawBall), 1);

    //             //[ Ball Color Decide ]
    //             let withdrawColor = 'yellow';
    //             if (withdrawBall <= 15) {
    //                 withdrawColor = "blue";
    //             } else if (withdrawBall <= 30) {
    //                 withdrawColor = "red";
    //             } else if (withdrawBall <= 45) {
    //                 withdrawColor = "purple";
    //             } else if (withdrawBall <= 60) {
    //                 withdrawColor = "green";
    //             } 

    //             console.log("<=== || WithdrawBall :: ", withdrawBall, " || === || WithdrawColor :: ", withdrawColor, " || === || TotalWithdrawCount :: ", count, " || === || GAmeNUmber :: ", room._id, "==== >");
    //             count++;

    //             //[ Send Boardcast Unity with Ball + Ball color and Total withdraw count ]
    //             await Sys.Io.of(Sys.Config.Namespace.Game1).to(room._id).emit('WithdrawBingoBall', {
    //                 number: withdrawBall,
    //                 color: withdrawColor,
    //                 totalWithdrawCount: count
    //             });

    //             //[ Once ball form array store in Achive Ball Array ]
    //             achiveBallArr.push(withdrawBall);

    //             let historyObj = {
    //                 number: withdrawBall,
    //                 color: withdrawColor,
    //                 totalWithdrawCount: count
    //             }

    //             history.push(historyObj);

    //             // [ Reconnect Logic of Data Update in Database  ]
    //             await Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, {
    //                 $set: {
    //                     withdrawNumberList: history,
    //                     withdrawNumberArray: achiveBallArr,
    //                 }
    //             });
    //             //Send To Admin
    //             await Sys.Io.of('admin').emit('balls', {
    //                 balls: history,
    //                 id: room._id
    //             });
    //             room?.halls.forEach(hall => {
    //                 Sys.Io.of('admin').to(hall).emit('onGoingBalls', {
    //                     balls: history
    //                 });
    //             })
    //             let winners = await module.exports.checkForWinners(room._id, withdrawBall)
    //             Sys.Log.info("------check winners after-----:"+ room._id  )

    //         }, room.seconds*1000);
    //     }catch(e){
    //         console.error("error in gameInterval", e);
    //     }
        

    // },

    gameInterval: async function(gameId) {
        try{
            let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, { players: 1, subGames: 1, seconds: 1, gameName: 1, parentGameId: 1, earnedFromTickets: 1, withdrawNumberArray: 1, withdrawNumberList: 1, jackpotDraw: 1, allHallsId: 1, halls: 1, otherData: 1, status: 1});
            console.log("gameInterval called", gameId, room)
            if (room && room.status == "running" && room.otherData.isPaused == true) {
                console.log(`Game is paused, can not run interval ${gameId}.`);
                return;
            }

            if(room.status == "finish"){
                if(room.gameName == "Wheel of Fortune" || room.gameName == "Treasure Chest" || room.gameName == "Mystery" || room.gameName == "Color Draft"){
                    if(room.otherData.isMinigameExecuted == false){
                        await module.exports.checkForMinigames(gameId);
                        return;
                    }else{
                        console.log(`Game is finished and Minigame is already started, so no need to do amything ${gameId}.`);
                        return;
                    }
                }
            }

            console.log("gameInterval called", gameId);
            
            let ballNumber = [];
            for (let b = 1; b <= 75; b++) {
                if(room.withdrawNumberArray.includes(b) == false  && b !== room.otherData?.nextWithdrawBall?.number){
                    ballNumber.push(b);
                }
            }

            let count = room.withdrawNumberArray.length;
            let achiveBallArr = room.withdrawNumberArray;
            let history = room.withdrawNumberList;
            let nextWithdrawBall = room.otherData?.nextWithdrawBall ?? { number: null, color: null };
            
            // If there's no next ball in the DB, pick one now
            if (!nextWithdrawBall.number) {console.log("check for next number")
                let chosenBall = ballNumber[Math.floor(Math.random() * ballNumber.length)];
                nextWithdrawBall = { number: chosenBall, color: getBallColor(chosenBall) };
                ballNumber.splice(ballNumber.indexOf(chosenBall), 1);
            }

            if(await module.exports.checkForGameFinished(room._id) == false ){
                let currentNumber = (room.withdrawNumberArray.length > 0) ? room.withdrawNumberArray[room.withdrawNumberArray.length - 1] : null;
                // Broadcast only the next ball first
                await Sys.Io.of(Sys.Config.Namespace.Game1).to(room._id).emit('WithdrawBingoBall', {
                    number: currentNumber,
                    color: currentNumber ? getBallColor(currentNumber) : null,
                    nextNumber: nextWithdrawBall.number,
                    nextColor: nextWithdrawBall.color,
                    totalWithdrawCount: count,
                    isForPlayerApp: false
                });
            }
            
            console.log("ballNumber, count, achiveBallArr,history", ballNumber, count, achiveBallArr, history)
            
            clearInterval(Sys.GameTimers[room.id]);

            Sys.GameTimers[room.id] = setInterval(async function() {
                Sys.Log.info("ballNumber length and gameId: "+ ballNumber.length + " GameId: "+ gameId);
                if(count == 3){
                    console.log("ticket purchase has been disabled.")
                    await Sys.Game.Game1.Services.GameServices.updateGameNew(room._id, { $set: { disableTicketPurchase: true } });
                    Sys.App.Controllers.physicalTicketsController.deleteholdSellTicketsOfGame(room._id.toString());
                }
                let isFinished = false;
                if(count >= 24){
                    isFinished = await module.exports.checkForGameFinished(room._id);
                    console.log("game finished status", isFinished)
                }

                // To disable Jackpot Field
                if( ( room.gameName == "Jackpot" && count == (+room.jackpotDraw) ) || ( room.gameName == "Oddsen 56" && count == 56  ) || ( room.gameName == "Oddsen 57" && count == 57  ) || ( room.gameName == "Oddsen 58" && count == 58 ) || ( room.gameName == "Innsatsen" && count == (+room.jackpotDraw)  ) ){
                    let patternRoom = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: room._id }, {winners: 1, subGames: 1, jackpotPrize: 1, jackpotDraw: 1, gameName: 1});
                    let patternListing = await module.exports.patternListing(room._id);
                    let patternList = patternListing.patternList;
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
                    const jackpotFullHousePrize = await getJackpotHighestPrice({allWinningOptions: patternRoom?.subGames[0].options, pattern:'Full House', defaultValue: +patternRoom?.subGames[0].options[0].winning['Full House']});
                    await Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('PatternChange',  { patternList: finalPatternList, jackPotData: {draw: patternRoom.jackpotDraw, winningAmount: jackpotFullHousePrize, isDisplay: false, tvScreenWinningAmount: jackpotFullHousePrize, isDisplayOnTVScreen: true} } );
                }
                // To disable Jackpot Field

                
                Sys.Log.info("check game status, if already completed isFinished---"+ isFinished + " " + room._id + "  " + count);
                if(count >= 75 || isFinished == true){ //ballNumber.length <= 0 
                    console.log('<======= || Game was finish || =================>', Sys.GameTimers[room.id]);
                    clearInterval(Sys.GameTimers[room.id]);
                    let finishedResult =await module.exports.gameFinished(room._id);
                    console.log("finishedResult", finishedResult)
                    return false;
                }
                
                // Current ball is the stored next ball
                let withdrawBall = nextWithdrawBall.number;
                let withdrawColor = nextWithdrawBall.color;
                console.log("<=== || WithdrawBall :: ", withdrawBall, " || === || WithdrawColor :: ", withdrawColor, " || === || TotalWithdrawCount :: ", count, " || === || GAmeNUmber :: ", room._id, "==== >");
                count++;

                // Choose new next ball
                let chosenBall = ballNumber[Math.floor(Math.random() * ballNumber.length)];
                nextWithdrawBall = { number: chosenBall, color: getBallColor(chosenBall) };
                ballNumber.splice(ballNumber.indexOf(chosenBall), 1);

                //[ Send Boardcast Unity with Ball + Ball color and Total withdraw count ]
                await Sys.Io.of(Sys.Config.Namespace.Game1).to(room._id).emit('WithdrawBingoBall', {
                    number: withdrawBall,
                    color: withdrawColor,
                    totalWithdrawCount: count,
                    nextNumber: nextWithdrawBall.number,
                    nextColor: nextWithdrawBall.color,
                    isForPlayerApp: true
                });

                //[ Once ball form array store in Achive Ball Array ]
                achiveBallArr.push(withdrawBall);

                let historyObj = {
                    number: withdrawBall,
                    color: withdrawColor,
                    totalWithdrawCount: count
                }

                history.push(historyObj);

                // [ Reconnect Logic of Data Update in Database  ]
                await Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, {
                    $set: {
                        withdrawNumberList: history,
                        withdrawNumberArray: achiveBallArr,
                        'otherData.nextWithdrawBall': nextWithdrawBall
                    }
                });
                //Send To Admin
                await Sys.Io.of('admin').emit('balls', {
                    balls: history,
                    id: room._id
                });
                room?.halls.forEach(hall => {
                    Sys.Io.of('admin').to(hall).emit('onGoingBalls', {
                        balls: history
                    });
                })
                let winners = await module.exports.checkForWinners(room._id, withdrawBall)
                Sys.Log.info("------check winners after-----:"+ room._id  )

            }, room.seconds*1000);
        }catch(e){
            console.error("error in gameInterval", e);
        }
        

    },

    stopGame: async function(gameId, language) {
        try{
            let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, { status: 1, otherData: 1, gameName: 1, halls: 1 });
            if (room  && room.otherData.isPaused == false) { //room.status == "running"
                if(room.status == "running"){
                    
                }else if(room.status == "finish"){
                    if(room.gameName == "Wheel of Fortune" || room.gameName == "Treasure Chest" || room.gameName == "Mystery" || room.gameName == "Color Draft"){
                        if( room.otherData.isMinigameActivated == true && room.otherData.gameSecondaryStatus != "finish" ){
                            // pause
    
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
        
                            //
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
                clearInterval(Sys.GameTimers[room.id]);
                await Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, { $set: { "otherData.isPaused": true } });
                Sys.Io.of(Sys.Config.Namespace.Game1).to(room._id).emit('toggleGameStatus', {
                    gameId: room._id,
                    status: "Pause",
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
                        agents: updatedGame.otherData.agents,
                    });
                })
                return {status: "success"}
                
            } else {
              console.log(`No running game found in room ${gameId}.`);
              if(!room){
                return {status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(['game_not_availbale'], language), showSearch: false}
              }else if(room.otherData.isPaused == true){
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
                if(data.action == "Resume"){
                    if( (room.status == "running" || room.status == "finish" ) && room.otherData.isPaused == true){
                        if(room.status == "finish" && room.otherData.isMinigameExecuted == true ){
                            if (Timeout.exists(room._id.toString())) {
                                await Sys.Io.of(Sys.Config.Namespace.Game1).to(room._id).emit('toggleGameStatus', {
                                    gameId: room._id,
                                    status: "Resume",
                                    message: translation.game_has_been_resumed
                                });
                                await Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, { $set: { "otherData.isPaused": false } });
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
                                    await Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, { $set: { "otherData.isPaused": false } });
                                    module.exports.completeMinigamesIfNotTimeout(room._id.toString());
                                    return {status: "success", message: translation.game_resume_success}
                                }else{
                                    return {status: "fail", message: translation.something_went_wrong_try_again_later}
                                }
                                
                            }
                            //return {status: "fail", message: "Game is already running"}
                        }else{
                            await Sys.Game.Game1.Services.GameServices.updateGame({ _id: room._id }, { $set: { "otherData.isPaused": false } });
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
            console.log("checkForMinigames called and registeredtimeout", gameId);
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
                let winnersExtra =await Sys.Game.Game1.Services.GameServices.getByData({ _id: gameId },{winners: 1, halls: 1});
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
                                        // console.log("showSpinnerButton---", showSpinnerButton, sendWof, wofPlayerSockets[w]._id, wofPlayerSockets[w].id)
                                        
                                        // Sys.Io.of(Sys.Config.Namespace.Game1).to("/Game1#"+wofPlayerSockets[w].socketId).emit('ActivateMiniGame', {
                                        //     gameId: gameId,
                                        //     showSpinnerButton: showSpinnerButton,
                                        //     miniGameType: "wheelOfFortune"
                                        // });
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

                                /*setTimeout(function () {
                                    console.log("playWheelOfFortune called from game");
                                    module.exports.playWheelOfFortune(null, {playerId: sendWof, gameId: gameId})
                                },10000);*/


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
                            setTimeout(async function () {
                                await Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                    $set: {
                                        'otherData.isMinigameFinished': true, 
                                        'otherData.gameSecondaryStatus': 'finish',
                                        'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                                    }
                                });
                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
                                winnersExtra[0]?.halls.forEach(hall => {
                                    Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
                                })
                                Sys.Io.of('admin').emit('refreshSchedule', {scheduleId:  updatedGame.parentGameId});

                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});

                                module.exports.nextGameCountDownStart(updatedGame.halls);
                            },5000);

                            /*setTimeout(async function () {
                                await Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                    $set: {
                                        'otherData.isMinigameFinished': true, 
                                        'otherData.gameSecondaryStatus': 'finish',
                                        'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                                    }
                                });
                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
                                winnersExtra[0]?.allHallsId.forEach(hall => {
                                    Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
                                })
                            },10000);*/

                        }
                        

                        // setTimeout(function () {
                        //     Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {"playerIdsNotTORefresh": wofWinners});
                        // },5000);

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
                                    //console.log("showSpinnerButton---", showSpinnerButton, sendTChest, tChestPlayerSockets[w]._id, tChestPlayerSockets[w].id)
                                    
                                    // Sys.Io.of(Sys.Config.Namespace.Game1).to("/Game1#"+tChestPlayerSockets[w].socketId).emit('ActivateMiniGame', {
                                    //     gameId: gameId,
                                    //     showSpinnerButton: showSpinnerButton,
                                    //     miniGameType: "treasureChest"
                                    // });
                                }
                            }

                            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('ActivateMiniGame', {
                                gameId: gameId,
                                playerId: sendTChest,
                                miniGameType: "treasureChest",
                                isForAdmin: false
                            });
                            /*setTimeout(function () {
                                console.log("SelectTreasureChest called from game");
                                module.exports.SelectTreasureChest(null, {playerId: sendTChest, gameId: gameId, playerType: "Real"})
                            },10000);*/

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
                                    module.exports.SelectTreasureChest(null, {playerId: sendTChest, gameId: gameId, playerType: "Real"})
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
                            /*setTimeout(function () {
                                console.log("SelectTreasureChest called from game");
                                module.exports.SelectTreasureChest(null, {playerId: tChestWinnersPlayers[0].playerId, gameId: gameId, playerType: "Admin"})
                            },10000);*/

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
                                    module.exports.SelectTreasureChest(null, {playerId: tChestWinnersPlayers[0].playerId, gameId: gameId, playerType: "Admin"})
                                } catch (e) {
                                    console.log("error in timeout of game 1 start", e);
                                }

                            }, ( 10000 ));

                            Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                                $set: {
                                    'otherData.isMinigameActivated': true,
                                    'otherData.isMinigamePlayed': false,
                                    'otherData.isMinigameFinished': false,
                                    'otherData.isSpinByAdmin': true,
                                    'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                                }
                            });
                            // console.log("physicalTicketIds----", physicalTicketNum, {
                            //     gameType: "Treasure Chest",
                            //     winner: {ticketNumbers: physicalTicketNum},
                            //     message: "Following Ticket number won Treasure Chest, Need to open chest in the hall to win the prizes."
                            // });
                            // Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminExtraGameNoti', {
                            //     gameType: "Treasure Chest", //adminExtraGameNoti
                            //     winner: {ticketNumbers: physicalTicketNum},
                            //     message: "Following Ticket number won Treasure Chest, Need to open chest in the hall to win the prizes."
                            // });
                            // setTimeout(function () {
                            //     Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
                            // },5000);
                            // setTimeout(function () {
                            //     Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
                            // },10000);
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

                                // let turnCount = 0;
                                // let mysteryTunrCounter =  setInterval(async function() {
                                //     let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                                //     Sys.Log.info("room in mystery game"+ room)
                                //     if(room && room.otherData.isMinigameFinished == false){
                                //         turnCount += 1;
                                //         if(turnCount >= 6){
                                //             console.log('<======= || Game was finish || =================>', turnCount);
                                //             clearInterval(mysteryTunrCounter);
                                //             //module.exports.mysteryGameFinished(null, {playerId: sendMys, gameId: gameId, playerType: "Real", turnCount: turnCount});
                                //             return false;
                                //         }else{
                                //             Sys.Log.info("auto turn called 1");
                                //             let isHigherNumber = false;
                                //             if( fortuna.random() >= 0.51 ){
                                //                 isHigherNumber = true;
                                //             }
                                //             Sys.Log.info("auto turn called 2");
                                //             await module.exports.selectMysteryAuto(null, {playerId: sendMys, gameId: gameId, playerType: "Auto", turnCount: turnCount, isHigherNumber: isHigherNumber})
                                //         }
                                //     }else{
                                //         clearInterval(mysteryTunrCounter);
                                //         return false;
                                //     }
                                    
                                // }, 11000);

                                /*let mysteryTurnCount = setTimeout(async function () {
                                    clearTimeout(mysteryTurnCount);
                                    let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                                    Sys.Log.info("room in mystery game"+ room)
                                    if(room && room.otherData.isMinigameFinished == false && room.otherData.mysteryTurnCounts == 0){
                                        module.exports.selectMysteryAuto(null, {playerId: sendMys, gameId: gameId, playerType: "Auto", turnCount: 1, isHigherNumber: true});
                                    }else{
                                        clearTimeout(mysteryTurnCount);
                                        return false;
                                    }
                                }, 10000 );*/


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

                                // let turnCount = 0;
                                // let mysteryTunrAdminCounter =  setInterval(async function() {
                                //     let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                                //     if(room && room.otherData.isMinigameFinished == false){
                                //         turnCount += 1;
                                //         if(turnCount >= 6){
                                //             console.log('<======= || Game was finish || =================>', turnCount);
                                //             clearInterval(mysteryTunrAdminCounter);
                                //             module.exports.mysteryGameFinished(null, {playerId: sendMys, gameId: gameId, playerType: "Admin", turnCount: turnCount});
                                //             return false;
                                //         }else{
                                //             let isHigherNumber = false;
                                //             if( fortuna.random() >= 0.51 ){
                                //                 isHigherNumber = true;
                                //             }
                                //             await module.exports.selectMysteryAuto(null, {playerId: sendMys, gameId: gameId, playerType: "Admin", turnCount: turnCount, isHigherNumber: isHigherNumber})
                                //         }
                                //     }else{
                                //         clearInterval(mysteryTunrCounter);
                                //         return false;
                                //     }
                                    
                                // }, 11000);
                                
                                /*let mysteryTurnCount = setTimeout(async function () {
                                    clearTimeout(mysteryTurnCount);
                                    let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                                    Sys.Log.info("room in mystery game"+ room)
                                    if(room && room.otherData.isMinigameFinished == false && room.otherData.mysteryTurnCounts == 0){
                                        module.exports.selectMysteryAuto(null, {playerId: mysteryWinnersPlayers[0].playerId, gameId: gameId, playerType: "Auto", turnCount: 1, isHigherNumber: true});
                                    }else{
                                        clearTimeout(mysteryTurnCount);
                                        return false;
                                    }
                                }, 10000 );*/




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
                                            module.exports.selectMysteryAuto(null, {playerId: mysteryWinnersPlayers[0].playerId, gameId: gameId, playerType: "Auto", turnCount: 1, isHigherNumber: true});
                                        }else{
                                            return false;
                                        }
                                    } catch (e) {
                                        console.log("error in timeout of game 1 start", e);
                                    }

                                }, ( 10000 ));
                                
                            }
                        }else{
                            setTimeout(function () {
                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
                                winnersExtra[0]?.halls.forEach(hall => {
                                    Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
                                })
                            },5000);
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

                                /*let colorDraftTurnCount = setTimeout(async function () {
                                    clearTimeout(colorDraftTurnCount);
                                    let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                                    Sys.Log.info("room in color draft game"+ room)
                                    if(room && room.otherData.isMinigameFinished == false && room.otherData.miniGameturnCounts == 0){
                                        let allIndex = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
                                        let selectedIndex = allIndex[Math.floor(fortuna.random() * allIndex.length)];
                                        module.exports.selectColorDraftAuto(null, {playerId: sendColorDraft, gameId: gameId, playerType: "Auto", turnCount: 1, selectedIndex: selectedIndex});
                                    }else{
                                        clearTimeout(colorDraftTurnCount);
                                        return false;
                                    }
                                }, 10000 );*/


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

                                /*let colorDraftTurnCount = setTimeout(async function () {
                                    clearTimeout(colorDraftTurnCount);
                                    let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                                    Sys.Log.info("room in color draft game"+ room)
                                    if(room && room.otherData.isMinigameFinished == false && room.otherData.miniGameturnCounts == 0){
                                        let allIndex = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
                                        let selectedIndex = allIndex[Math.floor(fortuna.random() * allIndex.length)];
                                        module.exports.selectColorDraftAuto(null, {playerId: colorDraftWinnersPlayers[0].playerId, gameId: gameId, playerType: "Auto", turnCount: 1, selectedIndex: selectedIndex});
                                    }else{
                                        clearTimeout(colorDraftTurnCount);
                                        return false;
                                    }
                                }, 10000 );*/


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
                                        Sys.Log.info("room in color draft game"+ room)
                                        if(room && room.otherData.isMinigameFinished == false && room.otherData.miniGameturnCounts == 0){
                                            let allIndex = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
                                            let selectedIndex = allIndex[Math.floor(fortuna.random() * allIndex.length)];
                                            module.exports.selectColorDraftAuto(null, {playerId: colorDraftWinnersPlayers[0].playerId, gameId: gameId, playerType: "Auto", turnCount: 1, selectedIndex: selectedIndex});
                                        }else{
                                            return false;
                                        }
                                    } catch (e) {
                                        console.log("error in timeout of game 1 start", e);
                                    }

                                }, ( 10000 ));
                                
                            }
                        }else{
                            setTimeout(function () {
                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
                                winnersExtra[0]?.halls.forEach(hall => {
                                    Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
                                })
                            },5000);
                        }
                        
                    }else{
                        console.log("Online or Unique userType WOF winner not found.");
                        setTimeout(function () {
                            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
                            winnersExtra[0]?.halls.forEach(hall => {
                                    Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
                                })
                        },5000);
                    }
                
                }
            }, (5000) );
        }catch(e){
            console.error("error in check for minigames", e);
        }
    },

    completeMinigamesIfNotTimeout: async function(gameId){
        try{console.log("completeMinigamesIfNotTimeout called", gameId);
            let winnersExtra =await Sys.Game.Game1.Services.GameServices.getByData({ _id: gameId },{winners: 1, halls: 1, otherData: 1});
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
                                        // console.log("showSpinnerButton---", showSpinnerButton, sendWof, wofPlayerSockets[w]._id, wofPlayerSockets[w].id)
                                        
                                        // Sys.Io.of(Sys.Config.Namespace.Game1).to("/Game1#"+wofPlayerSockets[w].socketId).emit('ActivateMiniGame', {
                                        //     gameId: gameId,
                                        //     showSpinnerButton: showSpinnerButton,
                                        //     miniGameType: "wheelOfFortune"
                                        // });
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

                        Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
                        
                        Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
                        winnersExtra[0]?.halls.forEach(hall => {
                            Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
                        })

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
                                    //console.log("showSpinnerButton---", showSpinnerButton, sendTChest, tChestPlayerSockets[w]._id, tChestPlayerSockets[w].id)
                                    
                                    // Sys.Io.of(Sys.Config.Namespace.Game1).to("/Game1#"+tChestPlayerSockets[w].socketId).emit('ActivateMiniGame', {
                                    //     gameId: gameId,
                                    //     showSpinnerButton: showSpinnerButton,
                                    //     miniGameType: "treasureChest"
                                    // });
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

                        /*setTimeout(function () {
                            console.log("SelectTreasureChest called from game");
                            module.exports.SelectTreasureChest(null, {playerId: sendTChest, gameId: gameId, playerType: "Real"})
                        },10000);*/

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
                                module.exports.SelectTreasureChest(null, {playerId: sendTChest, gameId: gameId, playerType: "Real"})
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

                        /*setTimeout(function () {
                            console.log("SelectTreasureChest called from game");
                            module.exports.SelectTreasureChest(null, {playerId: tChestWinnersPlayers[0].playerId, gameId: gameId, playerType: "Admin"})
                        },10000);*/

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
                                module.exports.SelectTreasureChest(null, {playerId: tChestWinnersPlayers[0].playerId, gameId: gameId, playerType: "Admin"})
                            } catch (e) {
                                console.log("error in timeout of game 1 start", e);
                            }

                        }, ( 10000 ));
                        
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
                            setTimeout(function () {
                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
                                winnersExtra[0]?.halls.forEach(hall => {
                                    Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
                                })
                            },5000);
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
                        //    Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('ActivateMiniGame', {
                        //        gameId: gameId,
                        //        playerId: sendMys,
                        //        miniGameType: "Mystery",
                        //        isForAdmin: false
                        //    });
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
                               if(room && room.otherData.isMinigameFinished == false){
                                   module.exports.selectMysteryAuto(null, {playerId: mysteryWinnersPlayers[0].playerId, gameId: gameId, playerType: "Auto", turnCount: 1, isHigherNumber: true});
                               }else{
                                   return false;
                               }
                           } catch (e) {
                               console.log("error in timeout of game 1 start", e);
                           }

                       }, ( 10000 ));

                       
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
                            setTimeout(function () {
                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
                                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
                                winnersExtra[0]?.halls.forEach(hall => {
                                    Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
                                })
                            },5000);
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
                        if(winnersExtra.otherData.miniGameHistory.length == 2){
                            console.log("winnersExtra.otherData.miniGameHistory---", winnersExtra.otherData.miniGameHistory, winnersExtra.otherData.miniGameHistory[0], winnersExtra.otherData.miniGameHistory[1])
                            if(winnersExtra.otherData.miniGameHistory[0].color == winnersExtra.otherData.miniGameHistory[1].color){
                                isMinigameOver = true;
                            }
                        }else if(winnersExtra.otherData.miniGameHistory.length > 2){
                            isMinigameOver = true;
                        }

                        if(isMinigameOver == true || winnersExtra.otherData.miniGameHistory.length >= 3){
                            module.exports.colordraftGameFinished(null, {playerId: colorDraftWinnersPlayers[0].playerId, gameId: gameId, playerType: "Admin", turnCount: winnersExtra.otherData.miniGameHistory.length});
                            console.log("minigame is finished")
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

                                let room = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: gameId }, {otherData: 1});
                                Sys.Log.info("room in color draft game"+ room)
                                if(room && room.otherData.isMinigameFinished == false){
                                    let allIndex = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
                                    let selectedIndex = allIndex[Math.floor(fortuna.random() * allIndex.length)];
                                    module.exports.selectColorDraftAuto(null, {playerId: colorDraftWinnersPlayers[0].playerId, gameId: gameId, playerType: "Auto", turnCount: (+room.otherData.miniGameHistory.length)+1, selectedIndex: selectedIndex});
                                }else{
                                    return false;
                                }

                            } catch (e) {
                                console.log("error in timeout of game 1 start", e);
                            }

                        }, ( 10000 ));
                        
                    }
                    
                }else{
                    console.log("Online or Unique userType WOF winner not found.");
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

    nextGameCountDownStart: async function (hallsId) {
        try {
            console.log("nextGameCountDownStart Call",hallsId);
            const startDate = new Date();
            const endDate = new Date();
            startDate.setHours(0, 0, 0);
            endDate.setHours(23, 59, 59);

            let nextGame = await Sys.Game.AdminEvents.Services.GameServices.getByData({
                gameType: 'game_1',
                halls: hallsId[0],
                status: "active",
                 stopGame: false,
                'otherData.isClosed': false,
                startDate: {
                    $gte: startDate,
                    $lte: endDate
                }
            },{
                sort: { startDate: 1, sequence: 1 }
            });

            nextGame = nextGame[0]
            let now = new Date();
            now.setMinutes(now.getMinutes() + nextGame.countDownTime);

            await Sys.Game.Game1.Services.GameServices.updateGame({ _id: nextGame._id }, { $set: { countDownDateTime: now }});
            await Sys.Io.of(Sys.Config.Namespace.Game1).emit('nextGameStartCountDownTime', {
                gameId: nextGame._id,
                countDownTime: now
            });
            
        } catch (error) {
            console.log("error",error);
        }
        
    }

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
const getBallColor = (ball) => {
    if (ball <= 15) return "blue";
    else if (ball <= 30) return "red";
    else if (ball <= 45) return "purple";
    else if (ball <= 60) return "green";
    return "yellow";
};

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


