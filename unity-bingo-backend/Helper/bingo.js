var mongoose = require('mongoose');
var Sys = require('../Boot/Sys');
var request = require("request");
var dateFormat = require('dateformat');

const { divide } = require('numeral');
const { ConsoleTransportOptions } = require('winston/lib/winston/transports');

const fs = require("fs");
const fastcsv = require("fast-csv");
const path = require('path');
const moment = require('moment');
const { i18next, translate } = require('../Config/i18n');
module.exports = {
    // ticketGenerator: async function(data) {
    //     try {

    //         let howManyTicket = data.ticket;
    //         let rowColumns = data.rowColumns;



    //         return data;
    //     } catch (e) {
    //         console.log("")
    //         return 0;
    //     }
    // },
    dateTimeFunction: async function (dateData) {
        let dt = new Date(dateData);
        var dateTime = dateFormat(dt, "yyyymmdd_hhMMss");
        // let date = dt.getDate();
        // let month = parseInt(dt.getMonth() + 1);
        // let year = dt.getFullYear();
        // let hours = dt.getHours();
        // let minutes = dt.getMinutes();
        // let seconds = dt.getSeconds();
        // let ampm = hours >= 12 ? 'pm' : 'am';
        // hours = hours % 12;
        // hours = hours ? hours : 12;
        // hours = hours < 10 ?'0'+hours:hours;
        // minutes = minutes < 10 ? '0' + minutes : minutes;
        // seconds = seconds < 10 ? '0' + seconds : seconds;
        // let dateTime = year + '' + month + '' + date + '_' + hours + minutes + seconds;
        return dateTime; // Function returns the dateandtime
    },
    obId: async function (usId) {
        return new mongoose.Types.ObjectId(usId);
    },
    ordNumFunction: async function (dateData) {
        //20210216126
        let dt = new Date(dateData);
        let date = dt.getDate();
        let month = parseInt(dt.getMonth() + 1);
        let year = dt.getFullYear();
        let hours = dt.getHours();
        let minutes = dt.getMinutes();
        let ampm = hours >= 12 ? 'pm' : 'am';
        hours = hours % 12;
        hours = hours ? hours : 12;
        minutes = minutes < 10 ? '0' + minutes : minutes;
        let dateTime = year + '' + month + '' + date + '' + hours + '' + minutes;
        return dateTime; // Function returns the dateandtime
    },

    generateUniqueOrderNum: async function () {
        const now = moment();
        const year = now.year();
        const month = now.month() + 1;
        const day = now.date();
        const hour = now.hour();
        const minute = now.minute();
        const second = now.second();
        const millisecond = now.millisecond();
        const sortableId = `${year}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}${hour.toString().padStart(2, '0')}${minute.toString().padStart(2, '0')}${second.toString().padStart(2, '0')}${millisecond.toString().padStart(3, '0')}`;
        return sortableId;
    },

    gameFormateTime: async function (dateData) {
        //16-02-2021 1:26:00
        let dt = new Date(dateData);
        let date = dt.getUTCDate(); //dt.getDate(); //getUTCDate
        let month = parseInt(dt.getMonth() + 1);
        let year = dt.getFullYear();
        let hours = dt.getHours();
        let minutes = dt.getMinutes();
        let seconds = dt.getSeconds();
        let ampm = hours >= 12 ? 'pm' : 'am';
        date = date < 10 ? '0' + date : date;
        month = month < 10 ? '0' + month : month;
        hours = hours
        // hours = hours % 12;
        // hours = hours ? hours : 12;
        hours = hours < 10 ? '0' + hours : hours;
        minutes = minutes < 10 ? '0' + minutes : minutes;
        seconds = seconds < 10 ? '0' + seconds : seconds;
        let dateTime = date + '-' + month + '-' + year + ' ' + hours + ':' + minutes + ':' + seconds;
        return dateTime;
    },

    dobFormatCompare: async function (dateData) {
        //16-02
        let dt = new Date(dateData);
        let date = dt.getDate(); //getUTCDate
        let month = parseInt(dt.getMonth() + 1);
        date = date < 10 ? '0' + date : date;
        month = month < 10 ? '0' + month : month;
        let dateTime = date + '-' + month;
        return dateTime;
    },


    gameUTCTime: async function (dateData) {
        //let dateTime = moment(new Date(dateData)).tz('UTC').format('DD-MM-YYYY hh:mm:ss');
        let dt = new Date(dateData);
        let date = dt.getUTCDate(); //getUTCDate
        let month = parseInt(dt.getUTCMonth() + 1);
        let year = dt.getUTCFullYear();
        let hours = dt.getUTCHours();
        let minutes = dt.getUTCMinutes();
        let seconds = dt.getUTCSeconds();
        let ampm = hours >= 12 ? 'pm' : 'am';
        date = date < 10 ? '0' + date : date;
        month = month < 10 ? '0' + month : month;
        hours = hours
        // hours = hours % 12;
        // hours = hours ? hours : 12;
        hours = hours < 10 ? '0' + hours : hours;
        minutes = minutes < 10 ? '0' + minutes : minutes;
        seconds = seconds < 10 ? '0' + seconds : seconds;
        let dateTime = date + '-' + month + '-' + year + ' ' + hours + ':' + minutes + ':' + seconds;
        return dateTime;
    },

    dateFunctionTransactionHistory: async function (dateData) {
        //February 1 2021
        const monthNames = ["January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ];

        let dt = new Date(dateData.getTime() - dateData.getTimezoneOffset() * 60 * 1000);
        let date = dt.getDate(); //getUTCDate
        let month = parseInt(dt.getMonth());
        let year = dt.getFullYear();
        date = date < 10 ? '0' + date : date;
        let dateTime = monthNames[month] + ' ' + date + ' ' + year;
        return dateTime;
    },

    dateTimeFunctionTransactionHistory: async function (dateData) {
        //"September 10 12:00 PM"
        const monthNames = ["January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ];

        //let dt=date.local().toString();
        let dt = new Date(dateData.getTime() - dateData.getTimezoneOffset() * 60 * 1000);
        let date = dt.getDate(); //getUTCDate
        let month = parseInt(dt.getMonth());
        let hours = dt.getHours();
        let minutes = dt.getMinutes();
        hours = hours < 10 ? '0' + hours : hours;
        minutes = minutes < 10 ? '0' + minutes : minutes;
        let ampm = hours >= 12 ? 'pm' : 'am';
        date = date < 10 ? '0' + date : date;
        let dateTime = monthNames[month] + ' ' + date + ' ' + hours + ':' + minutes + ' ' + ampm;
        return dateTime;
    },

    paymentGetAPI: async (options) => {
        return new Promise((resolve, reject) => {
            request(options, (err, response, body) => {
                if (err) {
                    reject({ "status": false, "message": err });
                } else {
                    resolve({ "status": true, "message": "Ok", "data": body });
                }
            })
        });

    },

    errorCheck: async function (errorType, errorSection, ast, dataSend) {
        try {
            if (errorType == 'AuthenticationException' || errorType == 'BBSException' ||
                errorType == 'GenericError' || errorType == 'MerchantTranslationException' || errorType == 'NotSupportedException' ||
                errorType == 'SecurityException' || errorType == 'UniqueTransactionIdException' || errorType == 'ValidationException' ||
                errorType == 'QueryException') {

                if (errorType == 'BBSException') {

                    const xmlQuery = require('xml-query');
                    message = xmlQuery(ast).children().find('Message').text();
                    transactionID = xmlQuery(ast).children().find('TransactionId').text();
                    var ResponseCode = xmlQuery(ast).children().find('ResponseCode').text();
                    var ResponseSource = xmlQuery(ast).children().find('ResponseSource').text();
                    var IssuerId = xmlQuery(ast).find('IssuerId').text();

                    if (errorSection == 'Register') {
                        let deposit = await Sys.App.Services.depositMoneyServices.insertData({
                            playerId: await Sys.Helper.bingo.obId(dataSend.playerId),
                            hallId: dataSend.hallId,
                            orderNumber: dataSend.orderNumber,
                            amount: dataSend.amount,
                            CurrencyCode: Sys.Config.App[Sys.Config.App.connectionType].payment.CurrencyCode,
                            errorType: errorType,
                            errorSection: errorSection,
                            operation: errorSection,
                            responseCode: ResponseCode,
                            responseSource: ResponseSource,
                            transactionID: transactionID,
                            issuerId: IssuerId,
                            message: message,
                            status: "fail",
                            createdAt: Date.now(),
                            updatedAt: Date.now()
                        });
                        return message;
                    } else {
                        let depositUpdateerrorType = await Sys.App.Services.depositMoneyServices.updateData({ _id: dataSend.depositId }, {
                            errorType: errorType,
                            errorSection: errorSection,
                            operation: errorSection,
                            responseCode: ResponseCode,
                            responseSource: ResponseSource,
                            transactionID: transactionID,
                            issuerId: IssuerId,
                            message: message,
                            status: "fail",
                            updatedAt: Date.now()
                        });
                        console.log("error", errorSection, "depositUpdateerrorType", depositUpdateerrorType);
                        return message;
                    }
                } else {
                    const xmlQuery = require('xml-query');
                    message = xmlQuery(ast).children().find('Message').text();
                    if (errorSection == 'Register') {
                        let deposit = await Sys.App.Services.depositMoneyServices.insertData({
                            playerId: await Sys.Helper.bingo.obId(dataSend.playerId),
                            hallId: dataSend.hallId,
                            orderNumber: dataSend.orderNumber,
                            amount: dataSend.amount,
                            CurrencyCode: Sys.Config.App[Sys.Config.App.connectionType].payment.CurrencyCode,
                            errorType: errorType,
                            errorSection: errorSection,
                            operation: errorSection,
                            message: message,
                            status: "fail",
                            createdAt: Date.now(),
                            updatedAt: Date.now()
                        });
                        return message;
                    } else {
                        let depositUpdateerrorType = await Sys.App.Services.depositMoneyServices.updateData({ _id: dataSend.depositId }, {
                            errorType: errorType,
                            errorSection: errorSection,
                            message: message,
                            operation: errorSection,
                            status: "fail",
                            updatedAt: Date.now()
                        });
                        return message;
                    }
                }
            }
        } catch (error) {
            console.log("errorCheck in deposit", error);
        }
    },

    ticketBook: async function (data) {
        try {
            // console.log("ticketBook: ", data);
            // var usedNums = new Array(76);
            // console.log('usedNums: ', usedNums);

            // if (data.columns == null) {
            //     var errorMessage = "Game not Found"
            //     return errorMessage;
            // }

            // let rowCol = data.columns;
            // let tCon = (rowCol * rowCol) - 1;
            // const ticket = [];
            //console.log('tCon: ', tCon);
            //  newCard();
            let totalTicketAmount = 0;
            if (data.slug == "game_1") {
                let gameId = await Sys.Helper.bingo.obId(data.gameId);
                let playerId = await Sys.Helper.bingo.obId(data.playerId);

                for (var r = 0; r < data.ticketSize; r++) { //
                    let tc = await ticket(data);

                    let ticketToReturn = tc.slice();
                    const [list, chuckSize] = [tc, 5]
                    let finalTicket = new Array(Math.ceil(list.length / chuckSize)).fill().map(_ => list.splice(0, chuckSize))
                    let winningCombinations = {};
                    winningCombinations.horizontal1 = finalTicket[0];
                    winningCombinations.horizontal2 = finalTicket[1];
                    winningCombinations.horizontal3 = finalTicket[2];
                    winningCombinations.horizontal4 = finalTicket[3];
                    winningCombinations.horizontal5 = finalTicket[4];
                    winningCombinations.fullHouse = ticketToReturn;

                    console.log("winningCombinations", winningCombinations);

                    let ticketInsert = await Sys.App.Services.GameService.insertTicketData({
                        gameId: gameId,
                        ticketId: 'Tk' + '' + (await Sys.App.Services.GameService.getTicketCount({}) + parseInt("001")),
                        tickets: ticketToReturn,
                        isPurchased: true,
                        playerIdOfPurchaser: playerId,
                        winningCombinations: winningCombinations,
                        hallName: "Hall_G1",
                        supplier: "Smart Gaming",
                        developer: "Bingoentreprenøren AS",
                        createdAt: Date.now(),
                    });

                }

            } else if (data.slug == "game_2") {

                let ticketLargeArr = [];
                let counter = 0;
                let tmpLimit = 10;
                let ticketTotalSize = data.ticketSize;
                let ticketCount = await module.exports.updateAndGetTicketCount("game_2", ticketTotalSize); //await Sys.App.Services.GameService.getTicketCountGame3({});
                const startingTicketCount = ticketCount - ticketTotalSize;
                console.log("total ticket count", ticketCount, startingTicketCount);
                for (var r = 0; r < data.ticketSize; r++) {
                    let tc = await ticket(data);
                    //let newCount = ticketCount++;

                    ticketLargeArr.push({
                        insertOne: {
                            document: {
                                gameId: await Sys.Helper.bingo.obId(data.gameId),
                                parentGameId: data.parentId,
                                ticketId: 'Tk' + (startingTicketCount + r + 1), //'Tk' + '' + (newCount + 1),
                                tickets: tc,
                                isPurchased: false,
                                playerIdOfPurchaser: await Sys.Helper.bingo.obId(data.playerId),
                                hallName: "Hall_G2",
                                supplier: "Smart Gaming",
                                developer: "Bingoentreprenøren AS",
                                createdAt: Date.now(),
                                gameType: "game_2",
                                ticketPrice: data.ticketPrice,
                                ticketPurchasedFrom: "realMoney",
                                userType: data.userType
                            }
                        }
                    });

                    counter++;
                    ticketTotalSize--;

                    if (counter == tmpLimit) {
                        let tI = await addTicketData(ticketLargeArr);
                        ticketLargeArr.length = 0;
                        counter = 0;
                        if (tmpLimit > ticketTotalSize) {
                            tmpLimit = ticketTotalSize;
                        }
                    }

                }

            } else if (data.slug == "game_3") {
                
                const {
                    playerId, gameId, ticketSize, playerData, hall, groupOfHall, purchaseType,
                    userType, uniquePlayerId, isAgentTicket, agentId, gameData, socketId, voucherData
                } = data;
            
                const [gameIdObj, playerIdObj, ticketCount] = await Promise.all([
                    Sys.Helper.bingo.obId(gameId),
                    Sys.Helper.bingo.obId(playerId),
                    module.exports.updateAndGetTicketCount("game_3", ticketSize),
                ]);
          
                const startingTicketCount = ticketCount - ticketSize;
                const patterns = gameData.allPatternArray.flat();
                const createdAt = Date.now();
                const ticketPrice = gameData.ticketPrice;
                const payableAmount = ticketPrice;
                if (voucherData && voucherData.percentageOff) {
                    payableAmount = ticketPrice * (1 - (voucherData.percentageOff ?? 0) / 100);
                }
                let playerBalance = playerData.walletAmount;
            
                // Generate tickets and winning patterns
                const ticketBase = {
                    gameId: gameIdObj,
                    isPurchased: true,
                    playerIdOfPurchaser: playerIdObj,
                    playerNameOfPurchaser: playerData.username,
                    hallName: hall.name,
                    groupHallName: groupOfHall.name,
                    hallId: hall.id,
                    groupHallId: groupOfHall.id,
                    supplier: "Smart Gaming",
                    developer: "Bingoentreprenøren AS",
                    createdAt,
                    gameType: "game_3",
                    ticketPrice,
                    userType,
                    uniquePlayerId,
                    ticketPurchasedFrom: purchaseType,
                    isAgentTicket,
                    agentId,
                    parentGameId: gameData.parentGameId
                };
                const ticketsOBJArray = await Promise.all(Array.from({ length: ticketSize }, async (_, r) => {
                    const tc = await ticket(data);
                    const winningPatterns = await patternArrays(patterns, tc);
                    return {
                        ...ticketBase,
                        ticketId: 'Tk' + (startingTicketCount + r + 1),
                        tickets: tc,
                        winningCombinations: winningPatterns,
                    };
                }));
            
                // Bulk insert tickets
                const options = { ordered: true };
                const bulkTickets = await Sys.App.Services.GameService.insertBulkTicketData(ticketsOBJArray, options);
                const ticketIdArray = bulkTickets.map(t => t._id);
            
                // Create transactions
                const transactionBase = {
                    playerId: playerData._id,
                    playerName: playerData.username,
                    gameId: gameData._id,
                    gameNumber: gameData.gameNumber,
                    gameName: gameData.gameName,
                    gameType: gameData.gameType,
                    gameStartDate: gameData.startDate,
                    gameMode: 'auto',
                    hallId: playerData.hall.id,
                    groupHallId: groupOfHall.id,
                    variantGame: "",
                    ticketColorType: "",
                    voucherId: voucherData?._id || "",
                    voucherCode: voucherData?.code || "",
                    voucherAmount: "",
                    isVoucherUse: !!voucherData,
                    isVoucherApplied: !!voucherData,
                    defineSlug: "buyTicket",
                    category: "debit",
                    status: "success",
                    amtCategory: "realMoney",
                    hall,
                    groupHall: groupOfHall,
                    typeOfTransaction: "Game Join/Ticket Purchase",
                    userType: playerData.userType,
                    createdAt,
                    isBotGame: gameData?.otherData?.isBotGame || false
                };
                const transactions = bulkTickets.map(t => {
                    const transactionId = 'TRN' + Sys.Helper.bingo.ordNumFunction(Date.now()) + Math.floor(100000 + Math.random() * 900000);
                    const afterBalance = playerBalance - payableAmount;
                    const trx = {
                        ...transactionBase,
                        transactionId,
                        differenceAmount: payableAmount,
                        ticketPrice: ticketPrice,
                        ticketId: t._id,
                        ticketNumber: t.ticketId,
                        previousBalance: playerBalance,
                        afterBalance,
                        typeOfTransactionTotalAmount: payableAmount,
                        remark: "Purchased " + t.ticketId + " Ticket",
                    };
                    playerBalance = afterBalance;
                    return trx;
                });
          
                const bulkTransactionResult = await Sys.Game.Common.Services.PlayerServices.createBulkTransaction(transactions, options);
            
                // Handle wallet deduction
                let updatedPlayer = null;
                let totalAmount = ticketPrice * ticketSize;
                if (bulkTransactionResult.length) {
                    if (voucherData?.percentage) totalAmount -= (totalAmount * voucherData.percentage) / 100;
            
                    const updateObj = {
                    $inc: {
                        walletAmount: -totalAmount,
                        ...(playerData.userType !== "Bot" && { monthlyWalletAmountLimit: totalAmount })
                    }
                    };
                    updatedPlayer = await Sys.Game.Game3.Services.PlayerServices.updateSinglePlayer({ _id: playerId }, updateObj, { new: true });
                }
          
                // Update game player/ticket info
                const targetPlayer = gameData.players.find(p => String(p.id) === String(playerIdObj));
                
            
                if (!targetPlayer) {
                    const numbers = [...new Set(bulkTickets.flatMap(t => t.tickets))];
                    const luckyNumber = numbers[Math.floor(Math.random() * numbers.length)];
                    let gameUpdate = {
                        socketId,
                        $inc: { totalNoPurchasedTickets: ticketIdArray.length },
                        $push: { 
                            ticketIdArray: { $each: ticketIdArray },
                            players: {
                                id: updatedPlayer._id,
                                name: updatedPlayer.username,
                                status: 'Waiting',
                                socketId,
                                purchasedSlug: purchaseType,
                                points: updatedPlayer.points,
                                walletAmount: updatedPlayer.walletAmount,
                                isPlayerOnline: false,
                                luckyNumber,
                                isLossAndWon: false,
                                isBot: userType === "Bot",
                                ticketCount: ticketIdArray.length,
                                hall:[hall.id]
                            } 
                        }
                    };
                   await Sys.Game.Game3.Services.GameServices.updateSingleGame({_id: gameData._id}, gameUpdate, { new: true });
                }else{
                    let hallId = targetPlayer.hall;
                    if(!hallId.includes(hall.id)){
                        hallId.push(hall.id);
                    }
                    await Sys.Game.Game3.Services.GameServices.updateSingleGame(
                        { _id: gameData._id, "players.id": playerIdObj },
                        {
                          socketId,
                          $inc: {
                            totalNoPurchasedTickets: ticketIdArray.length,
                            "players.$.ticketCount": ticketIdArray.length
                          },
                          $push: {
                            ticketIdArray: { $each: ticketIdArray }
                          },
                          $set:{'players.$.hall': hallId}
                        },
                        { new: true }
                    );
                }
        
                Sys.Helper.gameHelper.createTransactionPlayer({
                    playerId,
                    gameId: gameIdObj,
                    transactionSlug: "extraTransaction",
                    typeOfTransaction: "Game Joined",
                    action: "debit",
                    purchasedSlug: purchaseType,
                    totalAmount: totalAmount,
                    isBot: userType === "Bot"
                });
                totalTicketAmount = totalAmount;
                
            } else if (data.slug == "game_4") {
                // Destructure data for cleaner code
                const { gameId, ticketSize, userType, uniquePlayerId, isAgentTicket, agentId, purchaseType, gameName, slug } = data;
                
                // Use the optimized updateAndGetTicketCount function to get and increment ticket count atomically
                const [ticketCount, game4Id] = await Promise.all([
                    module.exports.updateAndGetTicketCount("game_4", ticketSize),
                    module.exports.obId(gameId)
                ]);
                
                // Generate all tickets in parallel using ticketPromises
                const ticketPromises = Array(ticketSize).fill().map(() => ticket(data));
                
                // Get the starting ticket count
                const startingTicketCount = ticketCount - ticketSize;
                console.log("ticketCount and startingTicketCount", ticketCount, startingTicketCount);
                // Process tickets as they resolve and create bulk operations
                const bulkTickets = [];
                for (let index = 0; index < ticketPromises.length; index++) {
                    const tc = await ticketPromises[index];
                    bulkTickets.push({
                        insertOne: {
                            document: {
                                gameId: game4Id,
                                ticketId: 'Tk' + '' + (startingTicketCount + index + 1),
                                tickets: tc,
                                isPurchased: false,
                                playerIdOfPurchaser: '',
                                hallName: "Hall_G4",
                                supplier: "Smart Gaming",
                                developer: "Bingoentreprenøren AS",
                                createdAt: Date.now(),
                                gameType: "game_4",
                                userType,
                                uniquePlayerId,
                                isOriginalTicket: true,
                                isAgentTicket,
                                agentId,
                                ticketPurchasedFrom: purchaseType,
                                gameName
                            }
                        }
                    });
                }
                
                // Execute bulk write operation
                await Sys.App.Services.GameService.bulkWriteTicketData(bulkTickets);

            } else if (data.slug == "game_5") {
                const {
                    ticketSize, gameId, playerId, playerName, hallName, groupHallName, hallId, groupHallId, userType, uniquePlayerId, isAgentTicket, agentId, purchaseType, gameName
                } = data;
            
                // Define ticket colors map for faster lookup
                const ticketColors = {
                    0: 'blue',
                    1: 'green',
                    2: 'red',
                    3: 'purple'
                };
            
                // Get ticket count and game ID concurrently
                const [ticketCount, game5Id] = await Promise.all([
                    module.exports.updateAndGetTicketCount("game_5", ticketSize),
                    module.exports.obId(gameId)
                ]);
        
                const startingTicketCount = ticketCount - ticketSize;
                
                // Common ticket properties
                const commonTicketProps = {
                    gameId: game5Id,
                    playerIdOfPurchaser: playerId,
                    playerNameOfPurchaser: playerName,
                    hallName,
                    groupHallName,
                    hallId,
                    groupHallId,
                    supplier: "Smart Gaming",
                    developer: "Bingoentreprenøren AS",
                    gameType: "game_5",
                    userType,
                    uniquePlayerId,
                    isOriginalTicket: true,
                    isAgentTicket,
                    agentId,
                    ticketPurchasedFrom: purchaseType,
                    gameName,
                    isPurchased: false,
                    createdAt: Date.now()
                };
                // Generate tickets in parallel using Promise.all
                const bulkTickets = await Promise.all(
                    Array.from({ length: ticketSize }, async (_, index) => {
                        const tc = await ticket(data);
                        return {
                            insertOne: {
                                document: {
                                    ...commonTicketProps,
                                    ticketId: `Tk${startingTicketCount + index + 1}`,
                                    tickets: tc,
                                    ticketColorName: ticketColors[index] || 'blue'
                                }
                            }
                        };
                    })
                );
        
                await Sys.App.Services.GameService.bulkWriteTicketData(bulkTickets);
        
            } else {
                var errorMessage = "Game not Found"
                return errorMessage;
            }

            if (data.slug == "game_3") {
                return totalTicketAmount;
            } else {
                return true;
            }

        } catch (error) {
            console.log("TicketBook in error:::", error);
        }
    },

    csvImport: async function (req, res) {
        try {
            const csvPath = path.join(__dirname, '../t4.csv');
            console.log("csv path", csvPath)
            let stream = fs.createReadStream(csvPath);
            let csvData = [];

            let csvStream = fastcsv
                .parse({ delimiter: '\t' })
                .on("data", function (data) {
                    csvData.push({
                        ticketId: data[0],
                        tickets: [data[1], data[2], data[3], data[4], data[5], data[6], data[7], data[8], data[9], data[10], data[11], data[12], data[13], data[14], data[15], data[16], data[17], data[18], data[19], data[20], data[21], data[22], data[23], data[24], data[25], data[26]],
                        isPurchased: false,
                        playerIdOfPurchaser: ""
                    });
                })
                .on("end", async function () {
                    // remove the first line: header
                    csvData.shift();
                    await Sys.App.Services.GameService.insertManyStaticTicketData(csvData, { ordered: false });
                    res.send("Data inserted Successfully");
                    //console.log(csvData);
                });

            stream.pipe(csvStream);
        } catch (e) {
            console.log("error in importing data", e)
        }
    },

    cloneGameTickets: async function (data) {
        try {
            // Destructure data at the top for better readability
            const { gameId, currentGameId, ticketIds, userType, uniquePlayerId, isAgentTicket, agentId, purchaseType, gameName } = data;
            const purchasedTickets = JSON.parse(ticketIds);
            
            // Start multiple async operations in parallel
            const [allTickets, ticketCount, game4Id] = await Promise.all([
                Sys.Game.Game4.Services.GameServices.getTicketByData(
                    { gameId }, 
                    { tickets: 1 }, 
                    { sort: { createdAt: -1 }, limit: 4 }
                ),
                module.exports.updateAndGetTicketCount("game_4", 4),
                module.exports.obId(currentGameId)
            ]);
            console.log("cloneGameTickets purchased and alltickets of previous game", purchasedTickets, allTickets, gameId);
            // Calculate starting ticket number
            const startCount = ticketCount - 4 + 1;
            const insertedIds = [];
            const bulkTickets = [];
            let purchasedTicketIndices = [];
    
            // Prepare bulk operation without blocking event loop
            for (let t = 0; t < allTickets.length; t++) {
                let isPurchased = false;
                if(purchasedTickets.includes(allTickets[t]._id.toString())){
                    purchasedTicketIndices.push(t);
                    isPurchased = true;
                }
                bulkTickets.push({
                    insertOne: {
                        document: {
                            gameId: game4Id,
                            ticketId: 'Tk' + (startCount + t),
                            tickets: allTickets[t].tickets,
                            isPurchased: isPurchased, //purchasedTickets.includes(allTickets[t]._id.toString()),
                            playerIdOfPurchaser: '',
                            hallName: "Hall_G4",
                            supplier: "Smart Gaming",
                            developer: "Bingoentreprenøren AS",
                            createdAt: Date.now(),
                            gameType: "game_4",
                            userType,
                            uniquePlayerId,
                            isAgentTicket,
                            agentId,
                            ticketPurchasedFrom: purchaseType,
                            gameName
                        }
                    }
                });
            }
            
            // Execute bulk operation if there are tickets to insert
            if (bulkTickets.length > 0) {
                const bulkInsert = await Sys.App.Services.GameService.bulkWriteTicketData(bulkTickets);
                
                // Process results without blocking
                if (bulkInsert?.result?.insertedIds?.length > 0) {
                    bulkInsert.result.insertedIds.forEach(item => {
                        insertedIds.push(item._id.toString());
                    });
                }
            }

            // Map only purchased ticket IDs based on their indices
            const purchasedTicketIds = purchasedTicketIndices.map(i => insertedIds[i]).filter(Boolean);
            return {cloneTickets: insertedIds, purchasedTicketIds }
            //return insertedIds;
        } catch (error) {
            console.log("cloneGameTickets error", error);
            return []; // Return empty array on error to prevent undefined returns
        }
    },

    getTraslateData: async function (data, language) {
        try {
            language = language == 'english' ? 'en' : 'nor'
            let translateObj = {}
            const keys = [
                "online",
                "main_navigation",
                "dashboard",
                "player_management",
                "tracking_player_spending",
                "approved_players",
                "pending_requests",
                "reject_requests",
                "game_type",
                "game_management",
                "schedule_management",
                "game_creation_management",
                "saved_game_list",
                "other_games",
                "wheel_of_fortune",
                "treasure_chest",
                "mystery_game",
                "color_draft",
                "add_physical_tickets",
                "physical_ticket_management",
                "sold_tickets",
                "unique_id_modules",
                "generate_unique_id",
                "unique_id_list",
                "other_modules",
                "theme",
                "pattern_management",
                "admin_management",
                "agent_management",
                "hall_management",
                "group_of_halls_management",
                "product_management",
                "product_list",
                "category_list",
                "order_history",
                "role_management",
                "report_management",
                "game1",
                "game2",
                "game3",
                "game4",
                "game5",
                "red_flag_category",
                "total_revenue_report",
                "hall_specific_reports",
                "physical_ticket",
                "unique_ticket",
                "payout_management",
                "payout_for_players",
                "payout_for_ticket",
                "risk_country",
                "hall_account_report",
                "wallet_management",
                "transactions_management",
                "deposit_request",
                "deposit_history",
                "withdraw_management",
                "withdraw_request_in_hall",
                "withdraw_request_in_bank",
                "withdraw_history_hall",
                "withdraw_history_bank",
                "add_email_account",
                "leaderboard_management",
                "voucher_management",
                "loyalty_management",
                "players_loyalty_management",
                "loyalty_type",
                "cms_management",
                "settings",
                "cash_in_out",
                "physical_cash_out",
                "hall_product_management",
                "settlement_report",
                "sms_advertisement",
                "entries",
                "search",
                "show",
                "enter",
                "previous",
                "next",
                "showing",
                "no_data_available_in_table",
                "profile",
                "sign_out",
                "daily_balance",
                "cash_in_out",
                "system_information",
            ];

            data = data.concat(keys)

            for (let i = 0; i < data.length; i++) {
                let keytraslateData = await translate({ key: data[i], language: language }, "admin")
                translateObj[data[i]] = keytraslateData
            }

            return translateObj

        } catch (error) {
            console.log("error", error);
        }
    },
    getSingleTraslateData: async function (data, language, nameSpace = "admin") {
        try {
            language = language == 'english' ? 'en' : 'nor'

            let keytraslateData = await translate({ key: data[0], language: language }, nameSpace)

            return keytraslateData

        } catch (error) {
            console.log("error", error);
        }
    },


    getMultipleTranslateData: async function (items, language, nameSpace = "admin") {
        try {
            const lang = language === 'english' ? 'en' : 'nor';
            const result = {};
    
            for (let [key, values = {}] of items) {
                result[key] = await translate({
                    key,
                    language: lang,
                    isDynamic: true,
                    ...values
                }, nameSpace);
            }
    
            return result;
    
        } catch (error) {
            console.log("Translation error:", error);
        }
    },
    
    updateAndGetTicketCount: async function(gameSlug, incrementBy) {
        try {
            // Use findOneAndUpdate with $inc for atomic operation
            const result = await Sys.App.Services.SettingsServices.findOneAndUpdateSettingsData(
                {_id: Sys.Setting._id}, // empty filter to match the settings document
                {
                    $inc: {
                        [`gameTicketCounts.${gameSlug}`]: incrementBy
                    }
                },
                {
                    new: true, // return updated document
                    upsert: true, // create if doesn't exist
                    setDefaultsOnInsert: true,
                    projection: { gameTicketCounts: 1, _id: 0 }
                }
            );
    
            // Return the new count
            return result.gameTicketCounts[gameSlug];
        } catch (error) {
            console.log("Error in updateAndGetTicketCount:", error);
            throw error;
        }
    }
}

async function addTicketData(ArrayData) {
    let ticketInsert = await Sys.App.Services.GameService.bulkWriteTicketData(ArrayData);
    //console.log("ticketInsert", ticketInsert);
}

async function ticket(data) {
    let arrVal = 0;
    let divideNumb = 0;
    let ticketArray = [];
    let r = 0;
    if (data.slug == "game_1") {
        arrVal = 25;
        divideNumb = 5;

        while (ticketArray.length < arrVal) {
            if (ticketArray.length == 12) {
                r = 0;
            } else if (ticketArray.length % divideNumb == 0) {
                r = getRandomArbitrary(1, 18);
            } else if (ticketArray.length % divideNumb == 1) {
                r = getRandomArbitrary(19, 36);
            } else if (ticketArray.length % divideNumb == 2) {
                r = getRandomArbitrary(37, 54);
            } else if (ticketArray.length % divideNumb == 3) {
                r = getRandomArbitrary(55, 72);
            } else if (ticketArray.length % divideNumb == 4) {
                r = getRandomArbitrary(73, 90);
            }
            if (ticketArray.indexOf(r) === -1) ticketArray.push(r);
        }

    } else if (data.slug == 'game_2') {
        arrVal = 9;
        divideNumb = 3;

        while (ticketArray.length < arrVal) {

            //[This code is commented as per client requirement please do not remove]
            // if (ticketArray.length % 3 == 0) {
            //     r = getRandomArbitrary(1, 8);
            // } else if (ticketArray.length % 3 == 1) {
            //     r = getRandomArbitrary(8, 15);
            // } else if (ticketArray.length % 3 == 2) {
            //     r = getRandomArbitrary(15, 22);
            // }
            r = getRandomArbitrary(1, 22);
            if (ticketArray.indexOf(r) === -1) ticketArray.push(r);
        }

    } else if (data.slug == 'game_3') {
        arrVal = 25;
        divideNumb = 5;

        while (ticketArray.length < arrVal) {
            if (ticketArray.length % divideNumb == 0) {
                r = getRandomArbitrary(1, 16);
            } else if (ticketArray.length % divideNumb == 1) {
                r = getRandomArbitrary(16, 31);
            } else if (ticketArray.length % divideNumb == 2) {
                r = getRandomArbitrary(31, 46);
            } else if (ticketArray.length % divideNumb == 3) {
                r = getRandomArbitrary(46, 61);
            } else if (ticketArray.length % divideNumb == 4) {
                r = getRandomArbitrary(61, 76);
            }
            if (ticketArray.indexOf(r) === -1) ticketArray.push(r);
        }

    } else if (data.slug == 'game_4') {
        arrVal = 15;
        divideNumb = 5;
        let game4Ticket = new Set();

        while (game4Ticket.size < arrVal) {
            if (game4Ticket.size % divideNumb == 0) {
                r = getRandomArbitrary(1, 12);
            } else if (game4Ticket.size % divideNumb == 1) {
                r = getRandomArbitrary(13, 24);
            } else if (game4Ticket.size % divideNumb == 2) {
                r = getRandomArbitrary(25, 36);
            } else if (game4Ticket.size % divideNumb == 3) {
                r = getRandomArbitrary(37, 48);
            } else if (game4Ticket.size % divideNumb == 4) {
                r = getRandomArbitrary(49, 60);
            }
            game4Ticket.add(r);
        }
        return Array.from(game4Ticket);
        // while (ticketArray.length < arrVal) {
        //     if (ticketArray.length % divideNumb == 0) {
        //         r = getRandomArbitrary(1, 12);
        //     } else if (ticketArray.length % divideNumb == 1) {
        //         r = getRandomArbitrary(13, 24);
        //     } else if (ticketArray.length % divideNumb == 2) {
        //         r = getRandomArbitrary(25, 36);
        //     } else if (ticketArray.length % divideNumb == 3) {
        //         r = getRandomArbitrary(37, 48);
        //     } else if (ticketArray.length % divideNumb == 4) {
        //         r = getRandomArbitrary(49, 60);
        //     }
        //     if (ticketArray.indexOf(r) === -1) ticketArray.push(r);
        // }
    } else if (data.slug == 'game_5') {
        let game5Ticket = new Set();
        arrVal = 9;
        //divideNumb = 3;

        while (game5Ticket.size < arrVal) {
            game5Ticket.add(getRandomArbitrary(1, 37));
            //r = getRandomArbitrary(1, 37);
            //if (ticketArray.indexOf(r) === -1) ticketArray.push(r);
        }
        return Array.from(game5Ticket);
    }


    function getRandomArbitrary(max, min) {
        return Math.floor(Math.random() * (max - min) + min);
    }

    return ticketArray;









    // let arrVal = 0;
    // let colVal = 0;
    // if (data.slug == "game_1") {

    // } else if (data.slug == 'game_2') {
    //     arrVal = 21;
    //     colVal = 3;
    // } else if (data.slug == 'game_3') {
    //     arrVal = 76;
    //     colVal = 15;
    // } else if (data.slug == 'game_4') {
    //     arrVal = 90;
    //     colVal = 15;
    // }

    // // let arrVal = (data.slug == "game_3") ? 76 : 21;
    // // let colVal = (data.slug == "game_3") ? 15 : 3;
    // let rowCol;
    // let comCol;

    // if (data.slug == 'game_4') {
    //     rowCol = data.row;
    //     comCol = data.colums;
    // } else {
    //     rowCol = data.columns;
    // }
    // var usedNums = new Array(arrVal);
    // //console.log('usedNums: ', usedNums);

    // if (data.columns == null) {
    //     var errorMessage = "Game not Found"
    //     return errorMessage;
    // }

    // // let rowCol = data.columns;
    // let tCon;

    // if (data.slug == 'game_4') {
    //     rowCol = data.row;
    //     comCol = data.colums;
    //     tCon = (rowCol * comCol);
    // } else {
    //     rowCol = data.columns;
    //     tCon = (rowCol * rowCol);
    // }

    // const ticket = [];

    // newCard();

    // function newCard() {
    //     for (var i = 0; i < tCon; i++) {
    //         setSquare(i);
    //     }
    // }

    // function setSquare(thisSquare) {
    //     let sd = thisSquare;
    //     var colPlace = new Array();
    //     if (data.slug == 'game_4') {
    //         for (let i = 0; i < rowCol; i++) {
    //             for (let j = 0; j < comCol; j++) {
    //                 colPlace.push(i)
    //             }
    //         }
    //     } else {
    //         for (let i = 0; i < rowCol; i++) {
    //             for (let j = 0; j < rowCol; j++) {
    //                 colPlace.push(i)
    //             }
    //         }
    //     }

    //     // console.log('colPlace: ', colPlace);
    //     var colBasis = colPlace[thisSquare] * colVal;
    //     //console.log('colBasis: ', colBasis);
    //     var newNum;
    //     do {
    //         newNum = colBasis + getNewNum() + 1;
    //     }
    //     while (usedNums[newNum]);
    //     usedNums[newNum] = true;

    //     var innerObj = {};
    //     innerObj[sd] = newNum;
    //     //console.log("ticket innerObj", innerObj);
    //     ticket.push(innerObj);
    //     // console.log("ticket full", ticket);
    // }

    // function getNewNum() {
    //     if (data.slug == 'game_4') {
    //         return Math.floor(Math.random() * 30);
    //     } else {
    //         return Math.floor(Math.random() * 15);
    //     }
    // }
    // //console.log('ticket: ', ticket);


}

async function patternArrays(patterns, numArr) {
    try {
        // console.log("Creation of Winning Possible Patterns start", patterns.length, numArr.length);
        let finalData = {};
        //Remove duplicate patterns if any found
        let uniquePattern = patterns.filter((obj, index) => patterns.findIndex((item) => item.patternName === obj.patternName) === index);
        // console.log("unique patterns", uniquePattern.length);
        for (let index = 0; index < uniquePattern.length; index++) {
            switch (uniquePattern[index].patternName) {
                case "Row 1":
                    finalData["Row 1"] = [
                        [numArr[0], numArr[1], numArr[2], numArr[3], numArr[4]],
                        [numArr[5], numArr[6], numArr[7], numArr[8], numArr[9]],
                        [numArr[10], numArr[11], numArr[12], numArr[13], numArr[14]],
                        [numArr[15], numArr[16], numArr[17], numArr[18], numArr[19]],
                        [numArr[20], numArr[21], numArr[22], numArr[23], numArr[24]],
                        [numArr[0], numArr[5], numArr[10], numArr[15], numArr[20]],
                        [numArr[1], numArr[6], numArr[11], numArr[16], numArr[21]],
                        [numArr[2], numArr[7], numArr[12], numArr[17], numArr[22]],
                        [numArr[3], numArr[8], numArr[13], numArr[18], numArr[23]],
                        [numArr[4], numArr[9], numArr[14], numArr[19], numArr[24]]
                    ];
                    break;
                case "Row 2":
                    finalData["Row 2"] = [
                        [numArr[0], numArr[1], numArr[2], numArr[3], numArr[4], numArr[5], numArr[6], numArr[7], numArr[8], numArr[9]],
                        [numArr[5], numArr[6], numArr[7], numArr[8], numArr[9], numArr[10], numArr[11], numArr[12], numArr[13], numArr[14]],
                        [numArr[10], numArr[11], numArr[12], numArr[13], numArr[14], numArr[15], numArr[16], numArr[17], numArr[18], numArr[19]],
                        [numArr[15], numArr[16], numArr[17], numArr[18], numArr[19], numArr[20], numArr[21], numArr[22], numArr[23], numArr[24]],
                        [numArr[0], numArr[1], numArr[2], numArr[3], numArr[4], numArr[20], numArr[21], numArr[22], numArr[23], numArr[24]],
                        [numArr[0], numArr[1], numArr[2], numArr[3], numArr[4], numArr[10], numArr[11], numArr[12], numArr[13], numArr[14]],
                        [numArr[0], numArr[1], numArr[2], numArr[3], numArr[4], numArr[15], numArr[16], numArr[17], numArr[18], numArr[19]],
                        [numArr[5], numArr[6], numArr[7], numArr[8], numArr[9], numArr[15], numArr[16], numArr[17], numArr[18], numArr[19]],
                        [numArr[5], numArr[6], numArr[7], numArr[8], numArr[9], numArr[20], numArr[21], numArr[22], numArr[23], numArr[24]],
                        [numArr[10], numArr[11], numArr[12], numArr[13], numArr[14], numArr[20], numArr[21], numArr[22], numArr[23], numArr[24]],
                    ];
                    break;
                case "Row 3":
                    finalData["Row 3"] = [
                        [
                            //123
                            numArr[0], numArr[1], numArr[2], numArr[3], numArr[4],
                            numArr[5], numArr[6], numArr[7], numArr[8], numArr[9],
                            numArr[10], numArr[11], numArr[12], numArr[13], numArr[14]
                        ],
                        [
                            //124
                            numArr[0], numArr[1], numArr[2], numArr[3], numArr[4],
                            numArr[5], numArr[6], numArr[7], numArr[8], numArr[9],
                            numArr[15], numArr[16], numArr[17], numArr[18], numArr[19]
                        ],
                        [
                            //125
                            numArr[0], numArr[1], numArr[2], numArr[3], numArr[4],
                            numArr[5], numArr[6], numArr[7], numArr[8], numArr[9],
                            numArr[20], numArr[21], numArr[22], numArr[23], numArr[24]
                        ],
                        [
                            //134
                            numArr[0], numArr[1], numArr[2], numArr[3], numArr[4],
                            numArr[10], numArr[11], numArr[12], numArr[13], numArr[14],
                            numArr[15], numArr[16], numArr[17], numArr[18], numArr[19]
                        ],
                        [
                            //135
                            numArr[0], numArr[1], numArr[2], numArr[3], numArr[4],
                            numArr[10], numArr[11], numArr[12], numArr[13], numArr[14],
                            numArr[20], numArr[21], numArr[22], numArr[23], numArr[24]
                        ],
                        [
                            //145
                            numArr[0], numArr[1], numArr[2], numArr[3], numArr[4],
                            numArr[15], numArr[16], numArr[17], numArr[18], numArr[19],
                            numArr[20], numArr[21], numArr[22], numArr[23], numArr[24]
                        ],
                        [
                            //234
                            numArr[5], numArr[6], numArr[7], numArr[8], numArr[9],
                            numArr[10], numArr[11], numArr[12], numArr[13], numArr[14],
                            numArr[15], numArr[16], numArr[17], numArr[18], numArr[19]
                        ],
                        [
                            //245
                            numArr[5], numArr[6], numArr[7], numArr[8], numArr[9],
                            numArr[15], numArr[16], numArr[17], numArr[18], numArr[19],
                            numArr[20], numArr[21], numArr[22], numArr[23], numArr[24]
                        ],
                        [
                            //345
                            numArr[10], numArr[11], numArr[12], numArr[13], numArr[14],
                            numArr[15], numArr[16], numArr[17], numArr[18], numArr[19],
                            numArr[20], numArr[21], numArr[22], numArr[23], numArr[24]
                        ],

                    ];
                    break;
                case "Row 4":
                    finalData["Row 4"] = [
                        [
                            //1234
                            numArr[0], numArr[1], numArr[2], numArr[3], numArr[4],
                            numArr[5], numArr[6], numArr[7], numArr[8], numArr[9],
                            numArr[10], numArr[11], numArr[12], numArr[13], numArr[14],
                            numArr[15], numArr[16], numArr[17], numArr[18], numArr[19]

                        ],
                        [
                            //1235
                            numArr[0], numArr[1], numArr[2], numArr[3], numArr[4],
                            numArr[5], numArr[6], numArr[7], numArr[8], numArr[9],
                            numArr[10], numArr[11], numArr[12], numArr[13], numArr[14],
                            numArr[20], numArr[21], numArr[22], numArr[23], numArr[24]
                        ],
                        [
                            //1245
                            numArr[0], numArr[1], numArr[2], numArr[3], numArr[4],
                            numArr[5], numArr[6], numArr[7], numArr[8], numArr[9],
                            numArr[15], numArr[16], numArr[17], numArr[18], numArr[19],
                            numArr[20], numArr[21], numArr[22], numArr[23], numArr[24]
                        ],
                        [
                            //1345
                            numArr[0], numArr[1], numArr[2], numArr[3], numArr[4],
                            numArr[10], numArr[11], numArr[12], numArr[13], numArr[14],
                            numArr[15], numArr[16], numArr[17], numArr[18], numArr[19],
                            numArr[20], numArr[21], numArr[22], numArr[23], numArr[24]
                        ],
                        [
                            //2345
                            numArr[5], numArr[6], numArr[7], numArr[8], numArr[9],
                            numArr[10], numArr[11], numArr[12], numArr[13], numArr[14],
                            numArr[15], numArr[16], numArr[17], numArr[18], numArr[19],
                            numArr[20], numArr[21], numArr[22], numArr[23], numArr[24]
                        ]
                    ];
                    break;
                default:
                    let pattern = uniquePattern[index].patternType.replace(/\./g, ",").split(",");
                    pattern = pattern.map(e => parseInt(e));
                    if (!pattern.includes(0)) {
                        finalData[`${uniquePattern[index].patternName}`] = [numArr]
                    } else {
                        finalData[uniquePattern[index].patternName] = [];
                        let arr = [];
                        for (let i = 0; i < pattern.length; i++) {
                            if (pattern[i] == 1) {
                                arr.push(numArr[i]);
                            }
                        }
                        finalData[`${uniquePattern[index].patternName}`].push(arr);
                    }
                    break;
            }
        }
        // console.log("Final Winning Possibilities on this ticket.", Object.keys(finalData).lenght);
        return finalData;
    } catch (error) {
        console.log("Error in bingo Helper patternArrays", error);
    }
}